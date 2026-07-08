"""
나스닥 어댑터 - yfinance 기반

설치: pip install yfinance

주의사항:
- yfinance는 현재 상장 종목만 제공 → 백테스트 시 생존편향 발생
  정확한 백테스트에는 상장폐지 이력 포함 데이터(예: FMP 유료, Sharadar) 필요
- 재무데이터의 '공시일'을 yfinance는 제공하지 않음 → 대략 분기말 + 45일 지연 가정으로
  보수적으로 처리하거나, SEC EDGAR에서 10-Q filing date를 직접 확인할 것
- 종목 리스트: nasdaqtrader.com 공개 파일 사용
- 공매도: shortPercentOfFloat은 격주 발표라 시의성 제한적. 본 어댑터는 실행 시마다
  스냅샷을 캐시에 저장하고, '이전 실행 스냅샷 대비 변화'를 short_ratio_change로 계산
  (최초 실행 시에는 비교 대상이 없어 NaN → 두 번째 실행부터 유효)
- 스냅샷 수집은 종목별 .info 호출이라 느림 → 전 종목 대신 max_tickers로 제한하거나
  (기본 500, 시총 상위가 아니라 알파벳순임에 주의), 캐시를 활용해 재실행 비용 절감
"""

import io
import time
import urllib.request

import numpy as np
import pandas as pd

from .base import MarketAdapter
import cache

try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False

NASDAQ_LIST_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"


class NasdaqAdapter(MarketAdapter):
    market_name = "NASDAQ"
    has_flow_data = False  # 외국인/기관 수급 개념 없음

    def __init__(self, max_tickers: int | None = 500,
                 request_interval: float = 0.2, use_cache: bool = True):
        if not YF_AVAILABLE:
            raise ImportError("yfinance가 설치되지 않았습니다: pip install yfinance")
        self.max_tickers = max_tickers  # None = 전 종목 (매우 느림)
        self.request_interval = request_interval
        self.use_cache = use_cache

    # ──────────────────────────────────────
    def get_tickers(self, as_of: str) -> list[str]:
        # 주의: 이 리스트는 '현재' 상장 종목 (과거 시점 재현 불가 → 생존편향)
        with urllib.request.urlopen(NASDAQ_LIST_URL, timeout=30) as r:
            raw = r.read().decode()
        df = pd.read_csv(io.StringIO(raw), sep="|")
        df = df[df["Test Issue"] == "N"]
        tickers = df["Symbol"].dropna().tolist()
        if self.max_tickers:
            tickers = tickers[: self.max_tickers]
        return tickers

    # ──────────────────────────────────────
    def get_price_data(self, as_of: str, lookback_days: int = 300) -> pd.DataFrame:
        if self.use_cache:
            hit = cache.load("price", self.market_name, as_of)
            if hit is not None:
                return hit

        end = pd.Timestamp(as_of)
        start = end - pd.Timedelta(days=int(lookback_days * 1.6))
        tickers = self.get_tickers(as_of)

        rows = []
        # yf.download는 배치 다운로드 지원 (100개씩 묶어서 호출)
        for i in range(0, len(tickers), 100):
            batch = tickers[i:i + 100]
            data = yf.download(batch, start=start, end=end,
                               auto_adjust=True, group_by="ticker",
                               progress=False, threads=True)
            for t in batch:
                try:
                    df = data[t].dropna(subset=["Close"]).reset_index()
                except (KeyError, TypeError):
                    continue
                if df.empty:
                    continue
                df = df.rename(columns={
                    "Date": "date", "Open": "open", "High": "high",
                    "Low": "low", "Close": "close", "Volume": "volume"})
                df["trading_value"] = df["close"] * df["volume"]
                df["ticker"] = t
                rows.append(df[["ticker", "date", "open", "high", "low",
                                "close", "volume", "trading_value"]])
            time.sleep(self.request_interval)

        result = self.validate_price_data(pd.concat(rows, ignore_index=True))
        if self.use_cache:
            cache.save("price", self.market_name, as_of, result)
        return result

    # ──────────────────────────────────────
    def get_snapshot(self, as_of: str) -> pd.DataFrame:
        if self.use_cache:
            hit = cache.load("snapshot", self.market_name, as_of)
            if hit is not None:
                return hit

        tickers = self.get_tickers(as_of)
        rows = []
        for t in tickers:
            try:
                info = yf.Ticker(t).info
            except Exception:
                continue
            rows.append({
                "ticker": t,
                "name": info.get("shortName", t),
                "market_cap": info.get("marketCap"),
                "per": info.get("trailingPE"),
                "pbr": info.get("priceToBook"),
                "roe": info.get("returnOnEquity"),
                "debt_ratio": info.get("debtToEquity"),
                "op_margin": info.get("operatingMargins"),
                # float 대비 공매도 잔고 % (격주 발표, FINRA 기준)
                "short_pct_float": info.get("shortPercentOfFloat"),
                "foreign_net_buy_20d": None,  # 해당 없음
                "inst_net_buy_20d": None,     # 해당 없음
            })
            time.sleep(self.request_interval)

        snap = pd.DataFrame(rows)
        snap["short_ratio_change"] = self._short_ratio_change(snap, as_of)

        result = self.validate_snapshot(snap)
        if self.use_cache:
            # short_pct_float은 validate_snapshot에서 잘리므로 이력용으로 별도 보존
            cache.save("snapshot_raw", self.market_name, as_of, snap)
            cache.save("snapshot", self.market_name, as_of, result)
        return result

    # ──────────────────────────────────────
    def _short_ratio_change(self, snap: pd.DataFrame, as_of: str) -> pd.Series:
        """
        공매도 잔고 비중 변화 = 현재 shortPercentOfFloat - 직전 실행 시점 값
        직전 스냅샷 캐시(snapshot_raw)가 있어야 계산 가능. 없으면 NaN.
        """
        current = pd.to_numeric(snap["short_pct_float"], errors="coerce")
        prev = cache.latest_before("snapshot_raw", self.market_name, as_of) \
            if self.use_cache else None
        if prev is None:
            return pd.Series(np.nan, index=snap.index)

        _, prev_df = prev
        if "short_pct_float" not in prev_df.columns:
            return pd.Series(np.nan, index=snap.index)
        prev_map = (prev_df.assign(
            v=pd.to_numeric(prev_df["short_pct_float"], errors="coerce"))
            .set_index("ticker")["v"])
        return current - snap["ticker"].map(prev_map)

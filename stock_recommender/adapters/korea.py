"""
한국 시장 어댑터 (KOSPI / KOSDAQ) - pykrx 기반

설치: pip install pykrx

주의사항:
- pykrx는 KRX 웹사이트를 비공식적으로 호출하므로 과도한 요청 시 차단될 수 있음
  → 종목 순회 시 time.sleep()으로 간격을 두며, 수집 결과는 로컬 캐시에 저장됨
    (같은 기준일 재실행 시 API 호출 없이 즉시 로드)
- PER/PBR/시총은 pykrx, ROE/부채비율/영업이익률은 DART Open API 연동
  → DART API키 필요: https://opendart.fss.or.kr 무료 발급 후
    환경변수 DART_API_KEY 설정 (없으면 해당 팩터만 NaN으로 두고 계속 진행)
- 공매도: 일별 공매도 비중을 조회해 '최근 5일 평균 - 직전 20일 평균' 변화를 계산
  공매도 금지 구간 등으로 조회가 실패하면 NaN 처리 (스코어링에서 자동 제외)
"""

import time
import numpy as np
import pandas as pd

from .base import MarketAdapter
import cache
import dart

try:
    from pykrx import stock as krx
    PYKRX_AVAILABLE = True
except ImportError:
    PYKRX_AVAILABLE = False


class KoreaAdapter(MarketAdapter):
    has_flow_data = True

    def __init__(self, market: str = "KOSPI", request_interval: float = 0.3,
                 dart_api_key: str | None = None, use_cache: bool = True):
        assert market in ("KOSPI", "KOSDAQ")
        self.market_name = market
        self.request_interval = request_interval
        self.dart_api_key = dart_api_key
        self.use_cache = use_cache
        if not PYKRX_AVAILABLE:
            raise ImportError("pykrx가 설치되지 않았습니다: pip install pykrx")

    # ──────────────────────────────────────
    def get_tickers(self, as_of: str) -> list[str]:
        date = as_of.replace("-", "")
        tickers = krx.get_market_ticker_list(date, market=self.market_name)
        # 보통주만 (종목코드 끝자리 '0'): 우선주는 같은 회사가 중복 추천되는 문제 방지
        return [t for t in tickers if t.endswith("0")]

    # ──────────────────────────────────────
    def get_price_data(self, as_of: str, lookback_days: int = 300) -> pd.DataFrame:
        if self.use_cache:
            hit = cache.load("price", self.market_name, as_of)
            if hit is not None:
                return hit
            # 검증(validate.py)이 수집해 둔 더 긴 가격 이력이 있으면 재사용
            hist = cache.load("price_hist", self.market_name, as_of)
            if hist is not None:
                return hist

        date = pd.Timestamp(as_of)
        start = (date - pd.Timedelta(days=int(lookback_days * 1.6))).strftime("%Y%m%d")
        end = date.strftime("%Y%m%d")

        rows = []
        for ticker in self.get_tickers(as_of):
            df = krx.get_market_ohlcv(start, end, ticker, adjusted=True)
            if df.empty:
                continue
            df = df.reset_index().rename(columns={
                "날짜": "date", "시가": "open", "고가": "high",
                "저가": "low", "종가": "close", "거래량": "volume",
                "거래대금": "trading_value",
            })
            if "trading_value" not in df.columns:
                df["trading_value"] = df["close"] * df["volume"]
            df["ticker"] = ticker
            rows.append(df[["ticker", "date", "open", "high", "low",
                            "close", "volume", "trading_value"]])
            time.sleep(self.request_interval)  # KRX 요청 제한 회피

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

        date = as_of.replace("-", "")

        # 1) 시총 + PER/PBR (pykrx 제공)
        cap = krx.get_market_cap(date, market=self.market_name).reset_index()
        cap = cap.rename(columns={"티커": "ticker", "시가총액": "market_cap"})
        fund = krx.get_market_fundamental(date, market=self.market_name).reset_index()
        fund = fund.rename(columns={"티커": "ticker", "PER": "per", "PBR": "pbr"})

        snap = cap[["ticker", "market_cap"]].merge(
            fund[["ticker", "per", "pbr"]], on="ticker", how="left")
        snap["name"] = snap["ticker"].map(
            lambda t: krx.get_market_ticker_name(t))

        # 스팩(기업인수목적회사)은 실적·팩터 의미가 없으므로 제외
        snap = snap[~snap["name"].astype(str).str.contains("스팩", na=False)]
        snap = snap.reset_index(drop=True)

        # 업종 분류 (KRX 업종분류현황, 시장당 1회 호출 — 표시/쏠림 점검용)
        try:
            sec = krx.get_market_sector_classifications(date, self.market_name)
            snap["sector"] = snap["ticker"].map(sec["업종명"]) \
                if sec is not None and not sec.empty else pd.NA
        except Exception:
            snap["sector"] = pd.NA

        # 2) 수급: 외국인/기관 20일 순매수 대금
        start = (pd.Timestamp(as_of) - pd.Timedelta(days=40)).strftime("%Y%m%d")
        try:
            inv = krx.get_market_net_purchases_of_equities(
                start, date, self.market_name, "외국인").reset_index()
            snap = snap.merge(
                inv.rename(columns={"티커": "ticker",
                                    "순매수거래대금": "foreign_net_buy_20d"})
                [["ticker", "foreign_net_buy_20d"]], on="ticker", how="left")
            inv2 = krx.get_market_net_purchases_of_equities(
                start, date, self.market_name, "기관합계").reset_index()
            snap = snap.merge(
                inv2.rename(columns={"티커": "ticker",
                                     "순매수거래대금": "inst_net_buy_20d"})
                [["ticker", "inst_net_buy_20d"]], on="ticker", how="left")
        except Exception:
            snap["foreign_net_buy_20d"] = pd.NA
            snap["inst_net_buy_20d"] = pd.NA

        # 3) 공매도 비중 변화 (금지 구간이면 조회 실패 → NaN)
        short_change = self._get_short_ratio_change(as_of)
        if short_change is not None:
            snap = snap.merge(short_change, on="ticker", how="left")
        else:
            snap["short_ratio_change"] = pd.NA

        # 4) 재무비율 (ROE, 부채비율, 영업이익률) — DART 공시기한 기준
        try:
            fin = dart.fetch_financial_ratios(
                snap["ticker"].tolist(), as_of, api_key=self.dart_api_key)
            snap = snap.merge(fin, on="ticker", how="left")
        except ValueError as e:  # API키 미설정 → 퀄리티 팩터 없이 진행
            print(f"      [경고] {e}")
            print("      → ROE/부채비율/영업이익률 없이 진행합니다 (가중치 자동 재정규화)")
            snap["roe"] = pd.NA
            snap["debt_ratio"] = pd.NA
            snap["op_margin"] = pd.NA

        result = self.validate_snapshot(snap)
        if self.use_cache:
            cache.save("snapshot", self.market_name, as_of, result)
        return result

    # ──────────────────────────────────────
    def _get_short_ratio_change(self, as_of: str,
                                recent_days: int = 5,
                                base_days: int = 20) -> pd.DataFrame | None:
        """
        종목별 공매도 비중 변화 = 최근 5영업일 평균 비중 - 직전 20영업일 평균 비중
        (양수 = 공매도 증가 중 → config에서 direction=-1 부정 신호로 사용)

        일별 전종목 공매도 현황을 날짜당 1회 호출로 수집 (총 ~25회 호출)
        공매도 금지 구간 등으로 데이터가 없으면 None 반환 → 팩터 전체 NaN 처리
        """
        end = pd.Timestamp(as_of)
        dates = pd.bdate_range(end=end, periods=recent_days + base_days)

        daily = []
        for d in dates:
            try:
                df = krx.get_shorting_volume_by_ticker(
                    d.strftime("%Y%m%d"), market=self.market_name)
            except Exception:
                continue
            if df is None or df.empty:
                continue  # 휴장일 또는 공매도 금지 구간
            df = df.reset_index().rename(columns={"티커": "ticker"})
            ratio_col = next((c for c in df.columns if "비중" in c), None)
            if ratio_col is None:
                continue
            daily.append(df[["ticker", ratio_col]]
                         .rename(columns={ratio_col: "short_ratio"})
                         .assign(date=d))
            time.sleep(self.request_interval)

        # 유효 영업일이 너무 적으면 (금지 구간 등) 팩터 무효화
        if len(daily) < (recent_days + base_days) // 2:
            return None

        panel = pd.concat(daily, ignore_index=True).sort_values("date")
        valid_dates = sorted(panel["date"].unique())
        recent_set = set(valid_dates[-recent_days:])

        pivot = panel.pivot_table(index="ticker", columns="date",
                                  values="short_ratio", aggfunc="mean")
        recent_cols = [c for c in pivot.columns if c in recent_set]
        base_cols = [c for c in pivot.columns if c not in recent_set]
        if not recent_cols or not base_cols:
            return None

        change = (pivot[recent_cols].mean(axis=1)
                  - pivot[base_cols].mean(axis=1))
        return (change.rename("short_ratio_change")
                .replace([np.inf, -np.inf], np.nan)
                .reset_index())

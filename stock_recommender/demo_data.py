"""
데모 어댑터: 합성 데이터로 파이프라인 전체를 테스트
- 실제 API 연결 전에 스코어링 로직이 정상 작동하는지 검증하는 용도
- 시장별 특성 반영: 한국은 수급 데이터 있음, 나스닥은 없음
"""

import numpy as np
import pandas as pd

from adapters.base import MarketAdapter


class DemoAdapter(MarketAdapter):
    has_flow_data = True

    def __init__(self, market: str = "KOSPI", n_stocks: int = 200, seed: int = 42):
        self.market_name = market
        self.n_stocks = n_stocks
        self.rng = np.random.default_rng(seed)
        self.is_korea = market in ("KOSPI", "KOSDAQ")
        self.has_flow_data = self.is_korea
        prefix = {"KOSPI": "KS", "KOSDAQ": "KQ", "NASDAQ": "NQ"}[market]
        self._tickers = [f"{prefix}{i:04d}" for i in range(n_stocks)]

    def get_tickers(self, as_of: str) -> list[str]:
        return self._tickers

    def get_price_data(self, as_of: str, lookback_days: int = 300) -> pd.DataFrame:
        end = pd.Timestamp(as_of)
        dates = pd.bdate_range(end=end, periods=lookback_days)
        rows = []
        for t in self._tickers:
            drift = self.rng.normal(0.0002, 0.0008)
            vol = abs(self.rng.normal(0.02, 0.008))
            rets = self.rng.normal(drift, vol, len(dates))
            close = 10_000 * np.exp(np.cumsum(rets)) if self.is_korea \
                else 100 * np.exp(np.cumsum(rets))
            volume = self.rng.lognormal(12 if self.is_korea else 13, 1, len(dates))
            df = pd.DataFrame({
                "ticker": t, "date": dates,
                "open": close * (1 - vol / 2), "high": close * (1 + vol),
                "low": close * (1 - vol), "close": close,
                "volume": volume, "trading_value": close * volume,
            })
            rows.append(df)
        return self.validate_price_data(pd.concat(rows, ignore_index=True))

    def get_snapshot(self, as_of: str) -> pd.DataFrame:
        n = self.n_stocks
        cap_scale = 1e12 if self.is_korea else 1e10  # 원화 vs 달러 규모 차이
        snap = pd.DataFrame({
            "ticker": self._tickers,
            "name": [f"데모종목{i}" for i in range(n)],
            "market_cap": self.rng.lognormal(0, 1.2, n) * cap_scale * 0.3,
            "per": self.rng.lognormal(2.6, 0.6, n),           # 중앙값 ~13
            "pbr": self.rng.lognormal(0.2, 0.6, n),           # 중앙값 ~1.2
            "roe": self.rng.normal(0.08, 0.10, n),
            "debt_ratio": abs(self.rng.normal(80, 50, n)),
            "op_margin": self.rng.normal(0.07, 0.08, n),
        })
        if self.is_korea:
            snap["foreign_net_buy_20d"] = self.rng.normal(0, 5e9, n)
            snap["inst_net_buy_20d"] = self.rng.normal(0, 3e9, n)
            snap["short_ratio_change"] = self.rng.normal(0, 0.5, n)
        else:
            # 나스닥: 한국식 수급 데이터 없음 → 가중치 재정규화 로직 검증용
            snap["foreign_net_buy_20d"] = np.nan
            snap["inst_net_buy_20d"] = np.nan
            snap["short_ratio_change"] = self.rng.normal(0, 0.5, n)
        return self.validate_snapshot(snap)

"""
MarketAdapter: 시장별 데이터 소스를 통일된 인터페이스로 추상화

모든 어댑터는 아래 두 개의 DataFrame을 반환해야 함:

1. get_price_data(as_of) → DataFrame
   index: (ticker, date) MultiIndex 또는 long format
   columns: ["ticker", "date", "open", "high", "low", "close", "volume", "trading_value"]
   * close는 수정주가(adjusted) 기준

2. get_snapshot(as_of) → DataFrame (as_of 시점에 '알 수 있었던' 최신 값)
   columns: [
     "ticker", "name", "market_cap",
     "per", "pbr", "roe", "debt_ratio", "op_margin",     # 재무 (공시일 기준!)
     "foreign_net_buy_20d", "inst_net_buy_20d",           # 수급 (한국만, 없으면 NaN)
     "short_ratio_change",                                # 공매도 (없으면 NaN)
   ]

핵심 원칙:
- 재무데이터는 반드시 '공시일' 기준으로 as_of 시점에 공개된 최신 분기 데이터만 사용
  (결산일 기준으로 쓰면 lookahead bias 발생)
- 상장폐지 종목도 과거 시점 조회 시 포함되어야 생존편향 방지
"""

from abc import ABC, abstractmethod
import pandas as pd


PRICE_COLUMNS = ["ticker", "date", "open", "high", "low", "close", "volume", "trading_value"]

SNAPSHOT_COLUMNS = [
    "ticker", "name", "market_cap",
    "per", "pbr", "roe", "debt_ratio", "op_margin",
    "foreign_net_buy_20d", "inst_net_buy_20d", "short_ratio_change",
]


class MarketAdapter(ABC):
    """시장별 데이터 어댑터 공통 인터페이스"""

    market_name: str = "BASE"
    has_flow_data: bool = False  # 기관/외국인 수급 데이터 존재 여부

    @abstractmethod
    def get_tickers(self, as_of: str) -> list[str]:
        """as_of 시점의 상장 종목 리스트 (상장폐지 종목 포함 이력 조회 권장)"""

    @abstractmethod
    def get_price_data(self, as_of: str, lookback_days: int = 300) -> pd.DataFrame:
        """as_of 기준 과거 lookback_days 만큼의 일별 시세 (long format)"""

    @abstractmethod
    def get_snapshot(self, as_of: str) -> pd.DataFrame:
        """as_of 시점에 알 수 있었던 종목별 최신 재무/수급 스냅샷"""

    # ── 공통 유틸 ──
    def validate_price_data(self, df: pd.DataFrame) -> pd.DataFrame:
        missing = set(PRICE_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"[{self.market_name}] 가격 데이터 컬럼 누락: {missing}")
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"])
        return df.sort_values(["ticker", "date"]).reset_index(drop=True)

    def validate_snapshot(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        for col in SNAPSHOT_COLUMNS:
            if col not in df.columns:
                df[col] = pd.NA  # 없는 팩터는 NaN 처리 (스코어링에서 가중치 재정규화)
        return df[SNAPSHOT_COLUMNS]

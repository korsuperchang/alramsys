"""
팩터 계산 모듈
- 가격 데이터(long format)로부터 기술적 팩터(모멘텀, RSI, 거래량 급증 등) 계산
- 스냅샷 데이터(재무/수급)와 병합하여 종목별 팩터 테이블 생성
"""

import numpy as np
import pandas as pd


def compute_rsi(close: pd.Series, window: int = 14) -> float:
    """마지막 시점의 RSI (Wilder 방식 근사)"""
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, min_periods=window).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, min_periods=window).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    return float(rsi.iloc[-1]) if not rsi.empty else np.nan


def compute_price_factors(price_df: pd.DataFrame) -> pd.DataFrame:
    """
    종목별 기술적 팩터 계산 (as_of 시점 기준)

    입력: validate_price_data를 통과한 long format 가격 데이터
    출력: ticker별 1행 — mom_12_1, mom_3m, rsi_14, volume_surge, avg_trading_value_20d
    """
    results = []
    for ticker, g in price_df.groupby("ticker"):
        g = g.sort_values("date")
        close = g["close"].reset_index(drop=True)
        tv = g["trading_value"].reset_index(drop=True)
        n = len(close)

        row = {"ticker": ticker}

        # 12-1 모멘텀: 12개월 전 → 1개월 전 수익률 (최근 1개월 제외해 단기반전 보정)
        if n >= 252:
            row["mom_12_1"] = close.iloc[-21] / close.iloc[-252] - 1
        elif n >= 120:  # 데이터 부족 시 6-1 모멘텀으로 대체
            row["mom_12_1"] = close.iloc[-21] / close.iloc[0] - 1
        else:
            row["mom_12_1"] = np.nan

        # 3개월 수익률
        row["mom_3m"] = close.iloc[-1] / close.iloc[-63] - 1 if n >= 63 else np.nan

        # RSI(14)
        row["rsi_14"] = compute_rsi(close) if n >= 15 else np.nan

        # 거래량 급증률: 최근 5일 평균 거래대금 / 직전 20일 평균 거래대금
        if n >= 25:
            recent = tv.iloc[-5:].mean()
            base = tv.iloc[-25:-5].mean()
            row["volume_surge"] = recent / base - 1 if base > 0 else np.nan
        else:
            row["volume_surge"] = np.nan

        # 유니버스 필터용: 20일 평균 거래대금
        row["avg_trading_value_20d"] = tv.iloc[-20:].mean() if n >= 20 else np.nan

        results.append(row)

    return pd.DataFrame(results)


def build_factor_table(price_df: pd.DataFrame, snapshot_df: pd.DataFrame) -> pd.DataFrame:
    """가격 팩터 + 스냅샷(재무/수급)을 병합한 최종 팩터 테이블"""
    tech = compute_price_factors(price_df)
    table = snapshot_df.merge(tech, on="ticker", how="inner")

    # PER 음수(적자)는 밸류 팩터로 의미 없음 → NaN 처리
    table.loc[table["per"].astype(float) <= 0, "per"] = np.nan

    return table

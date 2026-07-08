"""
Walk-forward 백테스트 골격

원칙:
1. 시간 순서 유지 — 리밸런싱 시점마다 '그 시점에 알 수 있었던' 데이터만으로 스코어링
2. 거래비용 반영 — 한국: 매도세+수수료 약 0.25%, 슬리피지 0.1% 가정 / 미국: 0.05%+0.1%
3. 평가지표 — 누적수익률 하나가 아니라 Sharpe, MDD, 승률, 지수 대비 초과수익
4. 벤치마크 — 시장지수 + 동일가중 랜덤 포트폴리오 (랜덤보다 나은지 확인)

주의: 실전 백테스트에는 '과거 각 시점의 스냅샷 데이터'가 필요함
      → 재무데이터를 공시일 기준으로 시점 복원할 수 있어야 하며 (DART/EDGAR),
        yfinance의 .info는 현재값만 제공하므로 나스닥 백테스트에는 별도 이력 데이터 필요
"""

import numpy as np
import pandas as pd

TRANSACTION_COSTS = {
    "KOSPI": 0.0035,   # 왕복: 매도세 0.15%(2026 기준 확인 필요) + 수수료 + 슬리피지
    "KOSDAQ": 0.0035,
    "NASDAQ": 0.0015,
}


def evaluate_portfolio(returns: pd.Series, benchmark: pd.Series | None = None,
                       periods_per_year: int = 12) -> dict:
    """리밸런싱 주기별 포트폴리오 수익률 시리즈 → 평가지표"""
    r = returns.dropna()
    if r.empty:
        return {}
    cum = (1 + r).cumprod()
    peak = cum.cummax()
    mdd = ((cum - peak) / peak).min()
    ann_ret = cum.iloc[-1] ** (periods_per_year / len(r)) - 1
    ann_vol = r.std() * np.sqrt(periods_per_year)
    metrics = {
        "누적수익률": cum.iloc[-1] - 1,
        "연환산수익률": ann_ret,
        "연환산변동성": ann_vol,
        "Sharpe": ann_ret / ann_vol if ann_vol > 0 else np.nan,
        "MDD": mdd,
        "승률": (r > 0).mean(),
        "리밸런싱횟수": len(r),
    }
    if benchmark is not None:
        excess = r - benchmark.reindex(r.index)
        metrics["평균초과수익(기간당)"] = excess.mean()
        te = excess.std() * np.sqrt(periods_per_year)
        metrics["정보비율(IR)"] = (excess.mean() * periods_per_year / te
                                   if te > 0 else np.nan)
    return metrics


def walk_forward(score_fn, price_history: pd.DataFrame, snapshot_history: dict,
                 market: str, rebalance_dates: list[str],
                 horizon_days: int, top_n: int = 5) -> pd.DataFrame:
    """
    score_fn: (price_df, snapshot_df, market) → 종목별 점수 DataFrame
    snapshot_history: {date_str: snapshot_df} — 각 시점에 알 수 있었던 스냅샷
    rebalance_dates: 리밸런싱 시점 리스트 (시간순)

    각 시점 t에서:
      1. t 이전 데이터만으로 스코어링 → 상위 top_n 선정
      2. t ~ t+horizon_days 실현 수익률 계산 (동일가중)
      3. 거래비용 차감
    """
    cost = TRANSACTION_COSTS[market]
    results = []

    price_history = price_history.copy()
    price_history["date"] = pd.to_datetime(price_history["date"])

    for date_str in rebalance_dates:
        t = pd.Timestamp(date_str)

        # 1) t 시점까지의 데이터만 사용 (미래정보 차단)
        past_prices = price_history[price_history["date"] <= t]
        snapshot = snapshot_history.get(date_str)
        if snapshot is None or past_prices.empty:
            continue

        scored = score_fn(past_prices, snapshot, market)
        picks = scored.nlargest(top_n, "score_composite")["ticker"].tolist()

        # 2) 보유기간 실현 수익률
        future = price_history[
            (price_history["date"] > t)
            & (price_history["ticker"].isin(picks))
        ].sort_values("date")

        period_rets = []
        for tk in picks:
            f = future[future["ticker"] == tk]
            if len(f) < horizon_days:
                continue  # 상장폐지/거래정지 → 보수적으로 제외하되 로그 남길 것
            entry = f["close"].iloc[0]
            exit_ = f["close"].iloc[horizon_days - 1]
            period_rets.append(exit_ / entry - 1)

        if period_rets:
            results.append({
                "date": date_str,
                "portfolio_return": np.mean(period_rets) - cost,  # 3) 비용 차감
                "n_picks": len(period_rets),
            })

    return pd.DataFrame(results).set_index("date")

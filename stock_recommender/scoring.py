"""
2단계 스코어링 모델
- 시장 내 횡단면 percentile rank 정규화
- 호라이즌별(단기/중기/장기) 가중치로 카테고리 점수 → 종합 점수
- 결측 팩터는 제외하고 가중치 재정규화 (한국/미국 데이터 차이 흡수)
"""

import numpy as np
import pandas as pd

from config import (FACTORS, HORIZON_WEIGHTS, COMPOSITE_WEIGHTS,
                    UNIVERSE_FILTERS, WINSORIZE_PCT, TOP_N,
                    COVERAGE_PENALTY, MIN_COVERAGE, VALUE_TRAP,
                    PENALTY_FACTORS, ESSENTIAL_CATEGORIES)


def apply_universe_filter(table: pd.DataFrame, market: str) -> pd.DataFrame:
    """거래 가능성 필터: 시총/거래대금/주가 하한 미달 종목 제외"""
    f = UNIVERSE_FILTERS[market]
    mask = (
        (table["market_cap"].astype(float) >= f["min_market_cap"])
        & (table["avg_trading_value_20d"].astype(float) >= f["min_avg_trading_value"])
    )
    if "min_price" in f and "last_close" in table.columns:
        mask &= table["last_close"].astype(float) >= f["min_price"]
    if market in ("KOSPI", "KOSDAQ"):
        # 우선주 차단 (종목코드 끝자리 0이 아니면 우선주/신형우선주 등)
        # 어댑터에서도 거르지만 과거 캐시 등으로 섞여 들어올 수 있어 이중 방어
        mask &= table["ticker"].astype(str).str.endswith("0")
    return table[mask.fillna(False)].reset_index(drop=True)


def winsorize(s: pd.Series, pct: float = WINSORIZE_PCT) -> pd.Series:
    """상하위 pct 절단으로 극단값 영향 완화"""
    lo, hi = s.quantile(pct), s.quantile(1 - pct)
    return s.clip(lo, hi)


def normalize_factors(table: pd.DataFrame) -> pd.DataFrame:
    """
    각 팩터를 시장 내 percentile rank(0~1)로 변환
    direction=-1인 팩터는 순위를 뒤집어 '높을수록 좋음'으로 통일
    """
    normed = table.copy()
    for category, factors in FACTORS.items():
        for name, direction in factors.items():
            if name not in normed.columns:
                normed[f"rank_{name}"] = np.nan
                continue
            s = pd.to_numeric(normed[name], errors="coerce")
            if name in PENALTY_FACTORS:
                # 페널티형: 0(해당 없음)은 제외(NaN), 초과분이 있는 종목만
                # 전체 대비 rank → 상위 급등/과열일수록 0에 가까운 하위 rank
                rank = 1 - s.rank(pct=True)
                rank[s <= 0] = np.nan
                normed[f"rank_{name}"] = rank
                continue
            if s.notna().sum() < 5:  # 유효값이 너무 적으면 팩터 무효화
                normed[f"rank_{name}"] = np.nan
                continue
            s = winsorize(s)
            rank = s.rank(pct=True)
            normed[f"rank_{name}"] = rank if direction > 0 else 1 - rank
    return normed


def category_scores(normed: pd.DataFrame) -> pd.DataFrame:
    """카테고리별 점수 = 해당 카테고리 내 유효 팩터 rank의 평균"""
    out = normed.copy()
    for category, factors in FACTORS.items():
        cols = [f"rank_{name}" for name in factors]
        cols = [c for c in cols if c in out.columns]
        out[f"cat_{category}"] = out[cols].mean(axis=1, skipna=True)
    return out


def horizon_score(scored: pd.DataFrame, horizon: str) -> pd.Series:
    """
    호라이즌별 종합 점수
    - 결측 카테고리는 제외하고 나머지 가중치를 재정규화
      (예: 나스닥은 flow 데이터가 없으므로 flow 제외 후 나머지로 100% 구성)
    """
    weights = HORIZON_WEIGHTS[horizon]
    num = pd.Series(0.0, index=scored.index)
    den = pd.Series(0.0, index=scored.index)
    for category, w in weights.items():
        col = scored[f"cat_{category}"]
        valid = col.notna()
        num[valid] += col[valid] * w
        den[valid] += w
    score = (num / den.replace(0, np.nan)) * 100  # 0~100점 스케일

    # 필수 카테고리 게이트: 핵심 근거가 모두 결측이면 이 호라이즌 점수 무효
    # (예: 재무 데이터 없는 종목이 모멘텀만으로 장기 점수를 받는 것 방지)
    essential = ESSENTIAL_CATEGORIES.get(horizon)
    if essential:
        has_core = pd.concat(
            [scored[f"cat_{c}"].notna() for c in essential], axis=1).any(axis=1)
        score[~has_core] = np.nan
    return score


def data_coverage(normed: pd.DataFrame) -> pd.Series:
    """
    종목별 데이터 커버리지 = 유효 팩터 수 / 이 시장에서 산출 가능한 팩터 수
    시장 전체가 결측인 팩터(예: 나스닥 수급)는 분모에서 제외 → 시장 간 불이익 없음
    """
    # 페널티형 팩터는 '해당 없음=NaN'이 정상이므로 커버리지 계산에서 제외
    all_rank_cols = [f"rank_{name}" for factors in FACTORS.values()
                     for name in factors if name not in PENALTY_FACTORS]
    usable = [c for c in all_rank_cols
              if c in normed.columns and normed[c].notna().any()]
    if not usable:
        return pd.Series(1.0, index=normed.index)
    return normed[usable].notna().mean(axis=1)


def _coverage_multiplier(cov: float) -> float:
    for lo, mult in COVERAGE_PENALTY:
        if cov >= lo:
            return mult
    return np.nan


def run_scoring(table: pd.DataFrame, market: str) -> pd.DataFrame:
    """팩터 테이블 → 유니버스 필터 → 정규화 → 커버리지 → 호라이즌별/종합 점수"""
    universe = apply_universe_filter(table, market)
    if universe.empty:
        raise ValueError(f"[{market}] 유니버스 필터 통과 종목이 없습니다. 필터 기준 확인 필요.")

    normed = normalize_factors(universe)

    # 데이터 커버리지: 결측 재정규화의 부작용(팩터 1~2개만으로 고득점) 방지
    normed["coverage_ratio"] = data_coverage(normed)
    normed = normed[normed["coverage_ratio"] >= MIN_COVERAGE].reset_index(drop=True)
    if normed.empty:
        raise ValueError(f"[{market}] 데이터 커버리지 {MIN_COVERAGE:.0%} 이상 종목이 없습니다.")

    scored = category_scores(normed)

    # 가치 함정 필터: 저평가 상위권인데 모멘텀 최하위 = 싼 이유가 있을 가능성
    # → 가치 점수를 감점하고 플래그를 남겨 추천 이유에 경고 표시
    trap = ((scored["cat_value"] >= VALUE_TRAP["value_min"])
            & (scored["cat_momentum"] <= VALUE_TRAP["momentum_max"]))
    scored["value_trap"] = trap.fillna(False)
    scored.loc[scored["value_trap"], "cat_value"] *= VALUE_TRAP["dampen"]

    penalty = scored["coverage_ratio"].map(_coverage_multiplier)
    for h in HORIZON_WEIGHTS:
        scored[f"score_{h}"] = horizon_score(scored, h) * penalty

    # 종합점수: 세 호라이즌이 모두 유효한 종목만 대상
    # (한 호라이즌이라도 필수 카테고리 미달로 무효면, 그 종목의 '종합'은
    #  남은 호라이즌의 재탕일 뿐이므로 종합 랭킹에서 제외)
    num = pd.Series(0.0, index=scored.index)
    den = pd.Series(0.0, index=scored.index)
    for h, w in COMPOSITE_WEIGHTS.items():
        col = scored[f"score_{h}"]
        valid = col.notna()
        num[valid] += col[valid] * w
        den[valid] += w
    scored["score_composite"] = num / den.replace(0, np.nan)
    all_valid = pd.concat([scored[f"score_{h}"].notna()
                           for h in COMPOSITE_WEIGHTS], axis=1).all(axis=1)
    scored.loc[~all_valid, "score_composite"] = np.nan
    return scored


def top_recommendations(scored: pd.DataFrame, n: int = TOP_N) -> dict[str, pd.DataFrame]:
    """
    호라이즌별 + 종합 상위 N개 추천
    - 전체 컬럼(원값·rank 포함)을 유지해 반환 → 추천 이유 생성(explain.py)에 사용
    - 화면 출력용 컬럼 선별은 각 출력단(recommend.py/app.py)에서 수행
    """
    result = {}
    for key in list(HORIZON_WEIGHTS) + ["composite"]:
        col = f"score_{key}"
        result[key] = (scored.dropna(subset=[col])
                       .nlargest(n, col)
                       .reset_index(drop=True))
    return result

"""
추천 이유 생성
- 각 팩터의 rank(방향 보정된 시장 내 백분위)와 원값을 사람이 읽는 한 줄로 변환
- 상위 20% 이내 팩터 = 강점으로 언급 (최대 3개), 하위 20% = 주의점으로 언급 (최대 2개)
- 해당 호라이즌에서 가중치가 0인 카테고리는 언급하지 않음
  (예: 장기 추천에서 심리 팩터는 설명에 안 나옴)
"""

import pandas as pd

from config import FACTORS, HORIZON_WEIGHTS

POS_TH = 0.80   # 이 이상이면 강점
NEG_TH = 0.20   # 이 이하면 주의점


def _money_kr(v: float) -> str:
    return f"{abs(v) / 1e8:,.0f}억"


# 팩터 원값 → 표시 문구 (rank가 방향을 이미 보정했으므로 여기선 사실만 기술)
FORMATTERS = {
    "rsi_overbought": lambda v: f"RSI {70 + v:.0f} 과열",
    "per": lambda v: f"PER {v:.1f}배",
    "pbr": lambda v: f"PBR {v:.2f}배",
    "roe": lambda v: f"ROE {v*100:.1f}%",
    "debt_ratio": lambda v: f"부채비율 {v:.0f}%",
    "op_margin": lambda v: f"영업이익률 {v*100:.1f}%",
    "short_ratio_change": lambda v: f"공매도 비중 {v:+.2f}%p",
    "volume_surge": lambda v: "주가·거래대금 흐름 양호" if v > 0 else "하락 속 거래 급증",
}


def _factor_text(row: pd.Series, name: str) -> str | None:
    # 위험조정 모멘텀: 점수는 조정값 기준이지만 표시는 원수익률이 직관적
    if name in ("mom_12_1_adj", "mom_3m_adj"):
        raw = row.get(name.replace("_adj", ""))
        if raw is None or pd.isna(raw):
            return None
        label = "12개월 모멘텀" if name.startswith("mom_12") else "3개월 수익률"
        return f"{label} {raw*100:+.0f}% (변동성 조정)"
    # 과열: 원재료인 최근 1개월 수익률로 표시
    if name == "overheat_20d":
        r20 = row.get("ret_20d")
        if r20 is None or pd.isna(r20):
            return None
        return f"최근 1개월 {r20*100:+.0f}% 급등 과열"
    # 수급 intensity: 시총 대비 비율로 표시하되 원금액(억)이 있으면 함께 표기
    if name in ("foreign_net_buy_intensity", "inst_net_buy_intensity"):
        v = row.get(name)
        if v is None or pd.isna(v):
            return None
        who = "외국인" if name.startswith("foreign") else "기관"
        action = "순매수" if v > 0 else "순매도"
        text = f"{who} 20일 {action} 시총 대비 {abs(v)*100:.1f}%"
        raw = row.get(name.replace("_intensity", "_20d"))
        if raw is not None and not pd.isna(raw):
            text += f" ({_money_kr(float(raw))})"
        return text
    # volume_surge는 원재료(5일 수익률, 거래대금 증감)가 있으면 상황을 해석해서 표시
    if name == "volume_surge":
        r5, surge = row.get("ret_5d"), row.get("tv_surge")
        if r5 is not None and surge is not None \
                and not (pd.isna(r5) or pd.isna(surge)):
            if r5 > 0 and surge > 0:
                label = "상승 속 거래 증가"
            elif r5 < 0 and surge < 0:
                label = "하락에도 투매 없음"
            elif r5 < 0 and surge > 0:
                label = "하락 속 거래 급증"
            else:
                label = "상승했지만 거래 감소"
            return f"{label} (5일 {r5*100:+.1f}%, 거래대금 {surge*100:+.0f}%)"
    fmt = FORMATTERS.get(name)
    if fmt is None:
        return None
    try:
        return fmt(float(row[name]))
    except (TypeError, ValueError, KeyError):
        return None


def build_reason(row: pd.Series, horizon: str) -> str:
    """스코어링된 한 종목(row) → 추천 근거 한 줄"""
    if horizon == "composite":
        # 종합은 어느 호라이즌에서든 비중 있게 쓰인 카테고리를 모두 고려
        weights = {c: max(w.get(c, 0) for w in HORIZON_WEIGHTS.values())
                   for c in FACTORS}
    else:
        weights = HORIZON_WEIGHTS[horizon]

    pos, neg = [], []
    for category, factors in FACTORS.items():
        if weights.get(category, 0) <= 0:
            continue
        for name in factors:
            rank = row.get(f"rank_{name}")
            if rank is None or pd.isna(rank):
                continue
            text = _factor_text(row, name)
            if text is None:
                continue
            if rank >= POS_TH:
                top_pct = max((1 - rank) * 100, 1)
                pos.append((rank, f"{text} (상위 {top_pct:.0f}%)"))
            elif rank <= NEG_TH:
                neg.append((rank, text))

    pos.sort(key=lambda x: -x[0])
    neg.sort(key=lambda x: x[0])

    warnings = [t for _, t in neg[:2]]
    if row.get("value_trap"):
        warnings.append("저평가이나 하락 추세 (가치 함정 가능)")

    out = " · ".join(t for _, t in pos[:3]) if pos \
        else "특정 팩터 쏠림 없이 전반적으로 고른 상위권"
    if warnings:
        out += "  /  주의: " + ", ".join(warnings[:3])

    # 데이터가 부족한 종목은 점수 신뢰도가 낮음을 표시 (커버리지 페널티와 연동)
    cov = row.get("coverage_ratio")
    if cov is not None and not pd.isna(cov) and cov < 0.8:
        out += f"  /  데이터 커버리지 {cov*100:.0f}%"
    return out

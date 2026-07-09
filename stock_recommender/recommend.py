"""
종목 추천 실행 스크립트

사용법:
    python recommend.py --market KOSPI
    python recommend.py --market KOSDAQ
    python recommend.py --market NASDAQ
    python recommend.py --market NASDAQ --demo   # 합성 데이터로 파이프라인 테스트

출력: 단기/중기/장기/종합 각 상위 5개 종목 + 카테고리별 근거 점수
"""

import argparse
import sys

import pandas as pd

from factors import build_factor_table
from scoring import run_scoring, top_recommendations
from config import HORIZONS


HORIZON_LABELS = {
    "short": f"단기 ({HORIZONS['short']}영업일)",
    "mid": f"중기 ({HORIZONS['mid']}영업일)",
    "long": f"장기 ({HORIZONS['long']}영업일)",
    "composite": "종합",
}


def get_adapter(market: str, demo: bool):
    if demo:
        from demo_data import DemoAdapter
        return DemoAdapter(market)
    if market in ("KOSPI", "KOSDAQ"):
        from adapters.korea import KoreaAdapter
        return KoreaAdapter(market)
    if market == "NASDAQ":
        from adapters.nasdaq import NasdaqAdapter
        return NasdaqAdapter()
    raise ValueError(f"지원하지 않는 시장: {market}")


def format_table(df: pd.DataFrame) -> str:
    display_cols = [c for c in df.columns
                    if c in ("ticker", "name") or c.startswith(("cat_", "score_"))]
    df = df[display_cols].copy()
    for c in df.columns:
        if c.startswith(("cat_", "score_")):
            df[c] = pd.to_numeric(df[c], errors="coerce").round(1)
    rename = {
        "cat_momentum": "모멘텀", "cat_value": "가치", "cat_quality": "퀄리티",
        "cat_flow": "수급", "cat_sentiment": "심리",
        "score_short": "단기점수", "score_mid": "중기점수",
        "score_long": "장기점수", "score_composite": "종합점수",
    }
    return df.rename(columns=rename).to_string(index=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", required=True,
                        choices=["KOSPI", "KOSDAQ", "NASDAQ"])
    parser.add_argument("--as-of", default=None,
                        help="기준일 (YYYY-MM-DD), 기본값: 오늘")
    parser.add_argument("--demo", action="store_true",
                        help="합성 데이터로 파이프라인 테스트")
    args = parser.parse_args()

    as_of = args.as_of or pd.Timestamp.today().strftime("%Y-%m-%d")

    print(f"\n{'='*70}")
    print(f" 종목 추천 | 시장: {args.market} | 기준일: {as_of}"
          + ("  [DEMO 모드 - 합성 데이터]" if args.demo else ""))
    print(f"{'='*70}\n")

    adapter = get_adapter(args.market, args.demo)

    print("[1/4] 가격 데이터 수집 중...")
    price_df = adapter.get_price_data(as_of)
    print(f"      → {price_df['ticker'].nunique()}개 종목, {len(price_df):,}행")

    print("[2/4] 재무/수급 스냅샷 수집 중...")
    snapshot_df = adapter.get_snapshot(as_of)

    print("[3/4] 팩터 계산 및 스코어링...")
    table = build_factor_table(price_df, snapshot_df)
    scored = run_scoring(table, args.market)
    print(f"      → 유니버스 필터 통과: {len(scored)}개 종목")

    print("[4/4] 추천 종목 산출\n")
    recs = top_recommendations(scored)

    from explain import build_reason
    for key, df in recs.items():
        print(f"── {HORIZON_LABELS[key]} 상위 {len(df)}개 " + "─" * 40)
        print(format_table(df))
        for _, r in df.iterrows():
            sector = r.get("sector")
            tag = f" [{sector}]" if sector is not None and not pd.isna(sector) else ""
            print(f"   · {r['name']}{tag}: {build_reason(r, key)}")
        if "sector" in df.columns and not df.empty:
            counts = df["sector"].fillna("미분류").value_counts()
            dist = ", ".join(f"{s} {c}" for s, c in counts.items())
            warn = "  ⚠ 섹터 쏠림 주의" \
                if counts.index[0] != "미분류" \
                and counts.iloc[0] >= max(3, len(df) - 1) else ""
            print(f"   섹터 분포: {dist}{warn}")
        print()

    print("※ 본 결과는 정량 모델의 참고자료이며 투자 판단과 손실 책임은 투자자 본인에게 있습니다.")
    print("※ 점수는 시장 내 상대순위 기반 (100점 = 해당 팩터군 최상위)\n")


if __name__ == "__main__":
    sys.exit(main())

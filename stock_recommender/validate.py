"""
경량 검증 백테스트 — "매매 시뮬레이션"이 아니라 "점수의 예측력 성적표"

과거 리밸런싱 시점마다 그 시점까지의 데이터로 점수를 매기고,
실제 이후 20/60/120영업일 수익률과 대조한다.

사용법:
    python3 validate.py --market KOSPI              # 최근 12개월 검증
    python3 validate.py --market KOSPI --months 18
    python3 validate.py --market KOSPI --demo       # 합성 데이터로 파이프라인 확인

산출 지표 (호라이즌별, 시점 평균):
    Rank IC      : 점수와 미래수익률의 스피어만 순위상관.
                   횡단면 모델은 0.03~0.05만 일관되게 나와도 유의미
    IC>0 비율    : 시점별 IC가 양수였던 비율 (일관성)
    Top5 초과수익: 상위 5종목 평균수익 - 유니버스 동일가중 평균수익
    적중률       : Top5가 유니버스 평균을 이긴 시점 비율
    Q5-Q1 스프레드: 점수 상위 20%와 하위 20%의 수익률 차이 (변별력)

한계 (의도된 단순화):
    - 체결가: 신호일 다음 영업일 종가 (t+1) 가정. 거래비용/슬리피지 미반영
      → 직접 매매 전제의 '추천 품질' 검증 목적이므로 생략
    - 한국: pykrx/DART가 과거 시점 조회를 지원해 시점 재현이 대체로 정확
    - 나스닥: yfinance 재무 스냅샷은 '현재값'만 제공 → 과거 시점 재현 불가.
      가격 기반 팩터(모멘텀 등)만 유효하고 결과는 참고용 (실행 시 경고 출력)
    - 현재 상장 종목 기준이라 상장폐지 종목이 빠짐(생존편향) → 성과가
      실제보다 다소 낙관적으로 나올 수 있음을 감안할 것
"""

import argparse
import sys

import numpy as np
import pandas as pd

import cache
from config import HORIZONS, TOP_N
from factors import build_factor_table
from scoring import run_scoring
from recommend import get_adapter

# 12-1 모멘텀에 252영업일이 필요 → 첫 리밸런싱은 그 이후부터
FACTOR_WARMUP_DAYS = 260


def fetch_price_history(adapter, end_str: str, lookback_days: int,
                        demo: bool) -> pd.DataFrame:
    """
    검증에는 (검증구간 + 팩터 룩백 + 장기 호라이즌)만큼의 가격 이력이 필요.
    어댑터 자체 캐시는 as_of만 키로 써서 300일짜리 캐시가 잘못 재사용될 수 있음
    → 검증 전용 캐시 키(price_hist)로 분리 저장
    """
    if demo:
        return adapter.get_price_data(end_str, lookback_days=lookback_days)

    hit = cache.load("price_hist", adapter.market_name, end_str)
    if hit is not None:
        span = hit.groupby("ticker")["date"].count().max()
        if span >= lookback_days * 0.9:
            return hit

    original = adapter.use_cache
    adapter.use_cache = False  # 짧은 lookback의 일반 캐시를 건너뛰고 새로 수집
    try:
        df = adapter.get_price_data(end_str, lookback_days=lookback_days)
    finally:
        adapter.use_cache = original
    cache.save("price_hist", adapter.market_name, end_str, df)
    return df


def evaluate_cross_section(scored: pd.DataFrame, fwd: pd.Series,
                           score_col: str, top_n: int) -> dict | None:
    """한 리밸런싱 시점의 점수 vs 실현 미래수익률 지표"""
    s = pd.to_numeric(scored.set_index("ticker")[score_col],
                      errors="coerce").dropna()
    fr = fwd.reindex(s.index)
    m = fr.notna()
    s, fr = s[m], fr[m]
    if len(s) < 30:  # 표본이 너무 적으면 통계 의미 없음
        return None

    top = s.nlargest(top_n)
    bench = fr.mean()
    top_ret = fr.loc[top.index].mean()
    q_hi = fr[s >= s.quantile(0.8)].mean()
    q_lo = fr[s <= s.quantile(0.2)].mean()
    return {
        "ic": s.rank().corr(fr.rank()),   # 순위 간 Pearson = Spearman
        "top_ret": top_ret,
        "bench_ret": bench,
        "top_excess": top_ret - bench,
        "spread": q_hi - q_lo,
        "n_stocks": len(s),
    }


def run_validation(market: str, months: int, step: int, demo: bool,
                   top_n: int = TOP_N) -> pd.DataFrame:
    adapter = get_adapter(market, demo)
    today = pd.Timestamp.today().normalize()
    end_str = today.strftime("%Y-%m-%d")

    lookback = months * 21 + FACTOR_WARMUP_DAYS + HORIZONS["long"] + 10
    print(f"[1/3] 가격 이력 수집 중 ({lookback}영업일치, 첫 실행은 오래 걸림)...")
    price = fetch_price_history(adapter, end_str, lookback, demo)
    price = price.copy()
    price["date"] = pd.to_datetime(price["date"])

    close = (price.pivot_table(index="date", columns="ticker", values="close")
             .sort_index())
    days = close.index
    print(f"      → {close.shape[1]}개 종목 × {len(days)}영업일")

    # 리밸런싱 시점: 워밍업 이후 ~ 단기 호라이즌 평가가 가능한 마지막 시점
    last_idx = len(days) - HORIZONS["short"] - 2
    rebal_idx = list(range(FACTOR_WARMUP_DAYS, last_idx, step))
    if not rebal_idx:
        raise ValueError("검증 가능한 리밸런싱 시점이 없습니다. --months를 늘리세요.")
    print(f"[2/3] {len(rebal_idx)}개 시점 검증 "
          f"({days[rebal_idx[0]].date()} ~ {days[rebal_idx[-1]].date()}, "
          f"{step}영업일 간격)")

    # 평가 대상: 각 호라이즌 점수 + 종합(중기 창으로 평가)
    targets = [(h, HORIZONS[h], f"score_{h}") for h in HORIZONS]
    targets.append(("composite", HORIZONS["mid"], "score_composite"))

    records = []
    for i, t_idx in enumerate(rebal_idx, 1):
        t = days[t_idx]
        t_str = t.strftime("%Y-%m-%d")
        print(f"      [{i}/{len(rebal_idx)}] {t.date()} ", end="", flush=True)

        try:
            snap = adapter.get_snapshot(t_str)
            past = price[price["date"] <= t]
            scored = run_scoring(build_factor_table(past, snap), market)
        except Exception as e:
            print(f"건너뜀 ({type(e).__name__}: {e})")
            continue

        parts = []
        for key, h_days, col in targets:
            entry_idx = t_idx + 1            # t일 신호 → t+1일 종가 진입
            exit_idx = entry_idx + h_days
            if exit_idx >= len(days) or col not in scored.columns:
                continue
            fwd = close.iloc[exit_idx] / close.iloc[entry_idx] - 1
            met = evaluate_cross_section(scored, fwd, col, top_n)
            if met is None:
                continue
            met.update({"date": t_str, "horizon": key})
            records.append(met)
            parts.append(f"{key} IC {met['ic']:+.2f}")
        print(" | ".join(parts) if parts else "평가 불가 (표본 부족)")

    return pd.DataFrame(records)


def print_report(detail: pd.DataFrame, market: str, top_n: int):
    order = list(HORIZONS) + ["composite"]
    labels = {"short": f"단기({HORIZONS['short']}일)",
              "mid": f"중기({HORIZONS['mid']}일)",
              "long": f"장기({HORIZONS['long']}일)",
              "composite": f"종합({HORIZONS['mid']}일 창)"}

    print(f"\n{'='*72}")
    print(f" 검증 결과 요약 | 시장: {market} | Top{top_n} 기준")
    print(f"{'='*72}")
    header = (f"{'호라이즌':<12}{'시점수':>5}{'평균IC':>8}{'IC>0':>7}"
              f"{'Top초과수익':>12}{'적중률':>8}{'Q5-Q1':>9}")
    print(header)
    print("-" * 72)
    for key in order:
        g = detail[detail["horizon"] == key]
        if g.empty:
            print(f"{labels[key]:<12}{'—':>5}   (평가 가능한 시점 없음)")
            continue
        print(f"{labels[key]:<12}"
              f"{len(g):>5}"
              f"{g['ic'].mean():>8.3f}"
              f"{(g['ic'] > 0).mean():>6.0%}"
              f"{g['top_excess'].mean():>11.2%}"
              f"{(g['top_excess'] > 0).mean():>7.0%}"
              f"{g['spread'].mean():>8.2%}")
    print("-" * 72)
    print("""읽는 법:
  · 평균IC: +0.03 이상이 일관되면 예측력 있음, 0 근처면 랜덤과 동일
  · Top초과수익: 추천 상위 종목이 유니버스 평균 대비 얼마나 더 올랐는가
  · 적중률: 50%를 꾸준히 넘어야 의미. Q5-Q1이 음수면 점수가 역효과
  · 시점 수가 적으면(10개 미만) 우연일 수 있으니 --months를 늘려 재확인
※ 생존편향(상장폐지 종목 누락)으로 실제보다 낙관적일 수 있음""")


def main():
    parser = argparse.ArgumentParser(description="추천 점수 예측력 검증")
    parser.add_argument("--market", required=True,
                        choices=["KOSPI", "KOSDAQ", "NASDAQ"])
    parser.add_argument("--months", type=int, default=12,
                        help="검증 구간 개월 수 (기본 12)")
    parser.add_argument("--step", type=int, default=21,
                        help="리밸런싱 간격 영업일 (기본 21 = 월간)")
    parser.add_argument("--demo", action="store_true",
                        help="합성 데이터로 파이프라인 확인")
    args = parser.parse_args()

    if args.market == "NASDAQ" and not args.demo:
        print("⚠ 나스닥 주의: yfinance 재무 스냅샷은 현재값만 제공되어 과거 시점의")
        print("  가치/퀄리티 팩터에 미래 정보가 섞입니다. 모멘텀 위주로만 해석하세요.\n")

    detail = run_validation(args.market, args.months, args.step, args.demo)
    if detail.empty:
        print("\n검증 결과가 없습니다. 데이터 수집 실패 여부를 확인하세요.")
        return 1

    print("[3/3] 리포트 생성")
    print_report(detail, args.market, TOP_N)

    # 개선 전/후 비교를 위해 실행 시각까지 파일명에 포함 (덮어쓰기 방지)
    out = f"data/validation_{args.market}_{pd.Timestamp.today():%Y%m%d_%H%M}.csv"
    try:
        from pathlib import Path
        Path("data").mkdir(exist_ok=True)
        detail.to_csv(out, index=False)
        print(f"\n시점별 상세 결과 저장: {out}")
    except OSError as e:
        print(f"\n상세 결과 저장 실패: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

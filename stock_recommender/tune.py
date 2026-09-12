"""
축적된 실측 데이터로 전략 파라미터 권장값을 산출

    python3 tune.py

왜 필요한가:
    파라미터를 눈대중으로 바꾸면 며칠치 데이터에 맞추는 과적합이 된다.
    이 도구는 scan_history.json(후보 선정 이력)과 paper_trades.json(체결·탈락
    기록)을 읽어, 각 조건이 실제로 무엇을 걸러냈고 그게 옳았는지를 숫자로
    보여준다. 데이터가 쌓일수록 다시 돌려 재조정하면 된다.

읽는 것 (모두 .cache/):
    scan_history.json   일자별 통과·탈락 집계, 실측 박스폭 분포
    paper_trades.json   체결 거래·청산 후 추적·탈락 후보 추적

출력은 권고일 뿐 자동 반영하지 않는다. 표본이 부족하면 그렇다고 말한다.
"""

import json
from collections import defaultdict

from paths import CACHE_DIR
import scanner as S

HISTORY_PATH = CACHE_DIR / "scan_history.json"
TRADES_PATH = CACHE_DIR / "paper_trades.json"

# 이 미만이면 권고하지 않고 "표본 부족"이라고만 말한다
MIN_SAMPLES = 20
# 박스폭 상한 권장값: 후보가 이 비율은 통과하도록 잡는다
TARGET_PASS_RATE = 0.60


def _load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(len(s) * p))]


def _head(title):
    print(f"\n{'─' * 62}\n{title}\n{'─' * 62}")


# ── 1. 박스폭 상한 ────────────────────────────

def box_width(hist):
    _head("① 박스폭 상한")
    by_market = defaultdict(list)
    for day in hist.values():
        for s in (day.get("morning") or {}).get("box_samples") or []:
            if s.get("market") and s.get("width") is not None:
                by_market[s["market"]].append(s["width"])

    if not by_market:
        print("  박스폭 표본 없음 — 오전 스캔이 돌아야 쌓입니다.")
        return
    for market, widths in sorted(by_market.items()):
        cur = (S.MORNING_MAX_BOX_WIDTH_KOSDAQ if market == "코스닥"
               else S.MORNING_MAX_BOX_WIDTH) * 100
        passed = sum(1 for w in widths if w <= cur)
        print(f"\n  {market}  n={len(widths)}  현재 기준 {cur:.1f}% "
              f"→ 통과 {passed}/{len(widths)} ({passed / len(widths):.0%})")
        print(f"    실측 중앙값 {_pct(widths, .5):.2f}%  "
              f"상위25% {_pct(widths, .75):.2f}%  최대 {max(widths):.2f}%")
        if len(widths) < MIN_SAMPLES:
            print(f"    → 표본 부족 (최소 {MIN_SAMPLES}개 권장). 판단 보류")
            continue
        rec = _pct(widths, TARGET_PASS_RATE)
        if abs(rec - cur) < 0.2:
            print("    → 현재 기준이 적절합니다")
        else:
            print(f"    → 권장 {rec:.1f}% "
                  f"(통과율 {TARGET_PASS_RATE:.0%} 기준, 현재 {cur:.1f}%)")


# ── 2. 진입 조건: 걸러낸 게 옳았나 ──────────────

def entry_conditions(paper):
    _head("② 진입 조건 — 탈락시킨 종목이 이후 어떻게 됐나")
    misses = paper.get("misses") or []
    summary = paper.get("miss_summary") or {}
    if not misses:
        print("  탈락 후보 기록 없음 — 돌파가 발생해야 쌓입니다.")
        return

    print("  (양수 = 그 조건이 수익 기회를 막았다는 뜻 / 음수 = 손실을 피했다)")
    for reason, slot in sorted(summary.items()):
        n = slot.get("n", 0)
        print(f"\n  {reason}  {n}건")
        for key in ("+30m", "d0_1520", "d1_close"):
            s = slot.get(key)
            if not (s and s.get("n")):
                continue
            print(f"    {key:9s} 평균 {s['avg']:+6.2f}%  "
                  f"상승 {s['up']}/{s['n']}")
        best = slot.get("d0_1520") or slot.get("+30m")
        if not (best and best.get("n", 0) >= MIN_SAMPLES):
            print(f"    → 표본 부족 (최소 {MIN_SAMPLES}건). 판단 보류")
        elif best["avg"] > 0.3:
            print("    → 걸러낸 종목이 평균적으로 올랐습니다. 조건 완화 검토")
        elif best["avg"] < -0.3:
            print("    → 걸러낸 종목이 평균적으로 내렸습니다. 조건 유지")
        else:
            print("    → 유의미한 차이 없음. 조건 유지")

    # 거래량 배수는 연속값이므로 구간별로 본다
    buckets = defaultdict(list)
    for m in misses:
        r, fu = m.get("vol_ratio"), (m.get("followup") or {})
        v = fu.get("d0_1520") or fu.get("+30m")
        if r is None or not v or v.get("pct") is None:
            continue
        b = "2.5~3.0배" if r >= 2.5 else ("2.0~2.5배" if r >= 2.0 else "2.0배 미만")
        buckets[b].append(v["pct"])
    if buckets:
        print(f"\n  거래량 배수 구간별 이후 변동 (현재 기준 "
              f"{S.BREAKOUT_VOL_MULTIPLIER}배)")
        for b in ("2.5~3.0배", "2.0~2.5배", "2.0배 미만"):
            vals = buckets.get(b)
            if not vals:
                continue
            avg = sum(vals) / len(vals)
            print(f"    {b:10s} n={len(vals):3d}  평균 {avg:+.2f}%")
        near = buckets.get("2.5~3.0배") or []
        if len(near) >= MIN_SAMPLES:
            avg = sum(near) / len(near)
            print(f"    → 기준 직전(2.5~3.0배) 평균 {avg:+.2f}% "
                  f"— {'2.5배로 완화 검토' if avg > 0.3 else '현재 기준 유지'}")
        else:
            print(f"    → 기준 직전 구간 표본 {len(near)}건. 판단 보류")


# ── 3. 청산 규칙 ──────────────────────────────

def exit_rules(paper):
    _head("③ 청산 규칙 — 청산 후 더 갔나")
    stats = paper.get("stats") or {}
    fu = paper.get("followup") or {}
    n = stats.get("trades", 0)
    if not n:
        print("  체결 기록 없음 — 신호가 나와야 쌓입니다.")
        return

    print(f"  거래 {n}건 · 승률 {stats.get('win_rate')}% · "
          f"누적 {stats.get('total_pnl', 0):+,}원 · "
          f"손익비 {stats.get('profit_factor')}")
    print(f"  청산 사유 {stats.get('by_reason')} · "
          f"평균 보유 {stats.get('avg_hold_min')}분")
    print(f"  거래비용 누계 {stats.get('total_cost', 0):,}원 "
          f"(건당 {stats.get('total_cost', 0) / n:,.0f}원)")

    print("\n  (양수 = 청산 후 더 올랐다 → 더 들고 있을 근거)")
    for reason, slot in sorted(fu.items()):
        cnt = slot.get("trades", 0)
        print(f"\n  {reason}  {cnt}건")
        for key in ("+30m", "d0_1130", "d0_1520", "d1_close"):
            s = slot.get(key)
            if not (s and s.get("n")):
                continue
            print(f"    {key:9s} 평균 {s['avg']:+6.2f}%  상승 {s['up']}/{s['n']}")

        if cnt < MIN_SAMPLES:
            print(f"    → 표본 부족 (최소 {MIN_SAMPLES}건). 판단 보류")
            continue
        if reason.startswith("손절"):
            back = slot.get("d0_1130") or slot.get("+30m")
            if back and back.get("n") and back["avg"] > 0.5:
                print(f"    → 손절 후 평균 {back['avg']:+.2f}% 회복. "
                      f"손절폭 완화 검토 (현재 박스폭 × "
                      f"{S.STOP_LOSS_BOX_MULT})")
            else:
                print("    → 손절이 손실을 키우지 않았습니다. 유지")
        elif "청산" in reason:
            late = slot.get("d0_1520")
            if late and late.get("n") and late["avg"] > 0.5:
                print(f"    → 청산 후 15:20까지 평균 {late['avg']:+.2f}%. "
                      f"보유 시간 연장 검토")
            else:
                print("    → 더 들고 있어도 나아지지 않았습니다. 유지")


# ── 4. 추천 모델 ──────────────────────────────

def recommendations():
    _head("④ 종목 추천 성과")
    perf = _load(CACHE_DIR / "rec_performance.json")
    summary = perf.get("summary") or {}
    if not summary:
        n = len(perf.get("records") or [])
        print(f"  평가 완료된 추천 없음 (대기 {n}건). "
              f"기록 후 5영업일부터 채워집니다.")
        return
    for horizon, slots in sorted(summary.items()):
        print(f"\n  {horizon}")
        for days, s in sorted(slots.items(), key=lambda kv: int(kv[0])):
            mark = "" if s["n"] >= MIN_SAMPLES else "  (표본 부족)"
            print(f"    {days:>3s}일  평균 {s['avg']:+6.2f}%  "
                  f"승률 {s['win_rate']:5.1f}%  n={s['n']}{mark}")
    print("\n  주의: 시장 전체가 오른 구간이면 이 숫자도 같이 오릅니다.")
    print("        모델의 변별력은 validate.py의 Rank IC로 확인하세요.")


def main():
    hist = _load(HISTORY_PATH)
    paper = _load(TRADES_PATH)

    print("=" * 62)
    print("전략 파라미터 진단")
    print("=" * 62)
    print(f"  스캔 이력 {len(hist)}일 · 체결 {len((paper.get('trades') or []))}건 "
          f"· 탈락 기록 {len((paper.get('misses') or []))}건")

    box_width(hist)
    entry_conditions(paper)
    exit_rules(paper)
    recommendations()

    print(f"\n{'=' * 62}")
    print("  권고는 참고용입니다. 표본이 충분한 항목만 반영하세요.")
    print("  수정 위치: scanner.py 상단 파라미터")
    print("=" * 62)


if __name__ == "__main__":
    main()

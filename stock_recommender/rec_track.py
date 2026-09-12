"""
종목 추천 성과 추적 — 추천한 종목이 실제로 올랐는지 기록

추천을 내기만 하고 맞았는지 확인하지 않으면 모델을 개선할 근거가 없다.
config.py의 팩터 가중치도 "통상적 관행 기반" 추정값이라 주석에 적혀 있고,
아직 실측으로 검증된 적이 없다.

validate.py가 과거 데이터로 예측력을 검증한다면, 이 모듈은 앞으로 내는
추천이 실제로 맞는지를 기록한다. 둘은 보완 관계다.

기록 방식:
    추천 시점의 종목·가격을 남기고, 5·20·60영업일 뒤 가격을 채워 넣는다.
    비교 기준은 같은 날 추천된 종목들의 평균이 아니라 시장 전체 흐름이어야
    하지만, 지금은 단순 수익률만 본다 (벤치마크는 추후 과제).

저장: .cache/rec_performance.json
"""

import json
from datetime import datetime, timedelta

import kst
from paths import CACHE_DIR

PERF_PATH = CACHE_DIR / "rec_performance.json"

# 평가 시점 (영업일). 단기/중기/장기 호라이즌과 맞춘다.
HORIZON_DAYS = (5, 20, 60)

# 보관 기간 — 60영업일 평가를 마치려면 최소 3개월은 들고 있어야 한다
KEEP_DAYS = 400


def _bdays_after(start: datetime, n: int) -> datetime:
    """n 영업일 뒤 (공휴일 미고려 — 그 경우 하루 이틀 늦게 채워진다)"""
    d, left = start, n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return d


class RecTracker:
    """추천 스냅샷 저장 + 이후 수익률 채우기"""

    def __init__(self):
        self.records: list[dict] = []
        self._load()

    def _load(self):
        if not PERF_PATH.exists():
            return
        try:
            self.records = json.loads(
                PERF_PATH.read_text(encoding="utf-8")).get("records", [])
        except Exception:
            self.records = []

    def save(self):
        cutoff = (kst.now().replace(tzinfo=None)
                  - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
        self.records = [r for r in self.records if r["date"] >= cutoff]
        CACHE_DIR.mkdir(exist_ok=True)
        PERF_PATH.write_text(json.dumps({
            "records": self.records,
            "summary": self.summary(),
            "updated": kst.now().strftime("%Y-%m-%d %H:%M:%S"),
        }, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 기록 ──────────────────────────────────

    def snapshot(self, market: str, as_of: str,
                 recommendations: dict, prices: dict[str, int]) -> int:
        """
        추천 결과를 저장. 같은 (시장, 기준일, 호라이즌)은 덮어쓰지 않는다.
        반환: 새로 기록한 종목 수
        """
        added = 0
        for horizon, sec in recommendations.items():
            for row in sec.get("rows", []):
                ticker = row.get("ticker")
                price = prices.get(ticker)
                if not ticker or not price:
                    continue
                key = (market, as_of, horizon, ticker)
                if any((r["market"], r["date"], r["horizon"], r["ticker"]) == key
                       for r in self.records):
                    continue
                self.records.append({
                    "market": market, "date": as_of, "horizon": horizon,
                    "ticker": ticker, "name": row.get("name", ""),
                    "score": row.get("score"), "price": price,
                    "sector": row.get("sector"),
                })
                added += 1
        if added:
            self.save()
        return added

    def due(self, now: datetime | None = None) -> list[tuple[int, int]]:
        """평가 시점이 지났는데 아직 안 채운 항목 → [(인덱스, 영업일수)]"""
        now = (now or kst.now()).replace(tzinfo=None)
        out = []
        for i, r in enumerate(self.records):
            try:
                base = datetime.strptime(r["date"], "%Y-%m-%d")
            except ValueError:
                continue
            got = r.get("fwd") or {}
            for n in HORIZON_DAYS:
                if str(n) in got:
                    continue
                if now >= _bdays_after(base, n).replace(hour=15, minute=20):
                    out.append((i, n))
        return out

    def record_return(self, index: int, days: int, price: int):
        if not (0 <= index < len(self.records)):
            return
        r = self.records[index]
        base = r.get("price") or 0
        r.setdefault("fwd", {})[str(days)] = {
            "price": price,
            "pct": round((price - base) / base * 100, 2) if base else None,
        }

    # ── 집계 ──────────────────────────────────

    def summary(self) -> dict:
        """
        호라이즌별 평균 수익률·승률.

        주의: 시장 전체가 오른 구간이면 이 숫자도 같이 오른다. 모델의
        변별력을 보려면 지수 대비 초과수익이 필요하다 (추후 과제).
        """
        out: dict[str, dict] = {}
        for r in self.records:
            for n in HORIZON_DAYS:
                v = (r.get("fwd") or {}).get(str(n))
                if not v or v.get("pct") is None:
                    continue
                slot = out.setdefault(r["horizon"], {}).setdefault(
                    str(n), {"n": 0, "up": 0, "sum": 0.0,
                             "best": -999.0, "worst": 999.0})
                slot["n"] += 1
                slot["up"] += 1 if v["pct"] > 0 else 0
                slot["sum"] += v["pct"]
                slot["best"] = max(slot["best"], v["pct"])
                slot["worst"] = min(slot["worst"], v["pct"])
        for horizon in out.values():
            for slot in horizon.values():
                if slot["n"]:
                    slot["avg"] = round(slot["sum"] / slot["n"], 2)
                    slot["win_rate"] = round(slot["up"] / slot["n"] * 100, 1)
                    del slot["sum"]
        return out

    def pending_count(self) -> int:
        return sum(1 for r in self.records
                   if len(r.get("fwd") or {}) < len(HORIZON_DAYS))

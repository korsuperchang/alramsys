"""거시경제 일정 캘린더 (FOMC, 한국 금통위, CPI, NFP 등)."""
from datetime import date, timedelta

# ── 하드코딩 일정 (연간 공식 발표 기준) ──────────────────────

# FOMC 금리결정일 (현지 기준, 결정 발표일)
_FOMC = [
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
    "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
]

# 한국 금통위 기준금리 결정일
_BOK = [
    "2025-01-16", "2025-02-25", "2025-04-17", "2025-05-29",
    "2025-07-10", "2025-08-28", "2025-10-16", "2025-11-27",
    "2026-01-15", "2026-02-26", "2026-04-16", "2026-05-28",
    "2026-07-09", "2026-08-27", "2026-10-15", "2026-11-26",
]

# 미국 CPI 발표일 (BLS 공식 일정)
_US_CPI = [
    "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10",
    "2025-05-13", "2025-06-11", "2025-07-15", "2025-08-12",
    "2025-09-10", "2025-10-15", "2025-11-13", "2025-12-10",
    "2026-01-14", "2026-02-11", "2026-03-11", "2026-04-09",
    "2026-05-13", "2026-06-10", "2026-07-15", "2026-08-12",
    "2026-09-09", "2026-10-14", "2026-11-12", "2026-12-09",
]

# 미국 NFP (고용지표, 매월 첫째 금요일)
def _first_friday(y: int, m: int) -> date:
    d = date(y, m, 1)
    days_to_fri = (4 - d.weekday()) % 7
    return d + timedelta(days=days_to_fri)

def _gen_nfp(start_year: int = 2025, years: int = 2) -> list[str]:
    result = []
    for y in range(start_year, start_year + years):
        for m in range(1, 13):
            result.append(_first_friday(y, m).strftime("%Y-%m-%d"))
    return result

_US_NFP = _gen_nfp()

# FOMC 의사록 (금리결정 약 3주 후 수요일)
def _fomc_minutes_date(decision_str: str) -> str:
    d = date.fromisoformat(decision_str) + timedelta(days=21)
    while d.weekday() != 2:  # 수요일
        d += timedelta(days=1)
    return d.strftime("%Y-%m-%d")

_FOMC_MINUTES = [_fomc_minutes_date(d) for d in _FOMC]


# ── 이벤트 정의 ────────────────────────────────────────────────

_ALL_EVENTS = (
    [{"date": d, "title": "🇺🇸 FOMC 금리결정", "importance": "S",
      "time_kst": "03:00", "country": "US",
      "hint": "기준금리 동결·인상·인하 결정. 시장 전체 변동성 최대 이벤트"} for d in _FOMC] +
    [{"date": d, "title": "🇺🇸 FOMC 의사록 공개", "importance": "A",
      "time_kst": "03:00", "country": "US",
      "hint": "내부 논의 공개로 향후 금리 방향 힌트 제공"} for d in _FOMC_MINUTES] +
    [{"date": d, "title": "🇰🇷 한국 금통위 기준금리", "importance": "S",
      "time_kst": "10:00", "country": "KR",
      "hint": "한국 기준금리 결정. 원달러·채권 동시 변동"} for d in _BOK] +
    [{"date": d, "title": "🇺🇸 미국 CPI 발표", "importance": "A",
      "time_kst": "21:30", "country": "US",
      "hint": "예상 상회 시 금리 인하 기대 후퇴 → 성장주 약세"} for d in _US_CPI] +
    [{"date": d, "title": "🇺🇸 미국 NFP (고용지표)", "importance": "A",
      "time_kst": "21:30", "country": "US",
      "hint": "고용 강세 = 금리 인하 지연 가능성. 달러 강세 유발"} for d in _US_NFP]
)


def get_upcoming_events(days: int = 3) -> list[dict]:
    """오늘부터 N일 이내 경제 일정 반환 (중요도순 정렬)."""
    today = date.today()
    end   = today + timedelta(days=days)

    events = [
        e for e in _ALL_EVENTS
        if today <= date.fromisoformat(e["date"]) <= end
    ]

    order = {"S": 0, "A": 1, "B": 2}
    return sorted(events, key=lambda e: (e["date"], order.get(e["importance"], 9)))

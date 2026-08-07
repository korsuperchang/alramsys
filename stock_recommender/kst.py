"""
한국 시장 시각 (KST)

서버가 UTC로 돌아가면 datetime.now()는 09:30 KST를 00:30으로 본다.
장중 시간대로 단계를 판정하는 스캐너에서는 치명적이라 — 오전 스캔이
18:30 KST에 돌게 된다 — 시장 시각은 반드시 이 모듈을 거친다.

zoneinfo가 tzdata 없이 실패할 수 있으므로 고정 UTC+9로 폴백한다.
한국은 서머타임이 없어 고정 오프셋으로도 정확하다.
"""

from datetime import datetime, timedelta, timezone

_FALLBACK = timezone(timedelta(hours=9), "KST")

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:                     # tzdata 미설치 등
    KST = _FALLBACK


def now() -> datetime:
    """현재 한국 시각 (타임존 인식)"""
    return datetime.now(KST)


def today() -> str:
    return now().strftime("%Y-%m-%d")


def hm() -> tuple[int, int]:
    """(시, 분) — 시간대 구간 판정용"""
    n = now()
    return n.hour, n.minute

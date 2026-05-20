"""텔레그램 메시지 포맷터."""
from datetime import datetime


def format_event(event: dict) -> str:
    market_flag = "🇰🇷" if event["market"] == "KR" else "🇺🇸"
    lines = [
        f"{event['event_type']}",
        f"{market_flag} {event['name']} ({event['code']})",
        f"📅 {event['date']}",
    ]
    if event.get("title") and event["title"] != event.get("name"):
        lines.append(f"📋 {event['title']}")
    if event.get("url"):
        lines.append(f"🔗 {event['url']}")
    return "\n".join(lines)


def format_event_list(events: list[dict]) -> str:
    if not events:
        return "새로운 이벤트가 없습니다."
    parts = []
    for e in events:
        parts.append(format_event(e))
    return "\n\n".join(parts)


def format_watchlist(stocks: list[dict]) -> str:
    if not stocks:
        return "관심종목이 없습니다.\n/add <종목코드> 로 추가하세요."

    kr = [s for s in stocks if s["market"] == "KR"]
    us = [s for s in stocks if s["market"] == "US"]

    lines = [f"📋 관심종목 ({len(stocks)}개)"]

    if kr:
        lines.append("\n🇰🇷 국내주식")
        for s in kr:
            lines.append(f"  • {s['name'] or s['code']}  ({s['code']})")

    if us:
        lines.append("\n🇺🇸 미국주식")
        for s in us:
            lines.append(f"  • {s['name'] or s['code']}  ({s['code']})")

    return "\n".join(lines)


def format_daily_summary(kr_events: list[dict], us_events: list[dict]) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"🌅 일일 관심종목 이벤트 요약\n({now} 기준)\n"]

    all_events = kr_events + us_events
    if not all_events:
        lines.append("향후 예정된 이벤트가 없습니다.")
        return "\n".join(lines)

    lines.append(f"총 {len(all_events)}건의 이벤트가 예정되어 있습니다.\n")
    for e in all_events:
        flag = "🇰🇷" if e["market"] == "KR" else "🇺🇸"
        lines.append(
            f"{e['event_type']}  {flag} {e['name']} ({e['code']})  📅 {e['date']}"
        )

    return "\n".join(lines)


def format_help() -> str:
    return (
        "📌 알람시스 (주식 이벤트 알림봇)\n\n"
        "명령어:\n"
        "  /add <코드>    — 관심종목 추가\n"
        "  /remove <코드> — 관심종목 삭제\n"
        "  /list          — 관심종목 목록\n"
        "  /check         — 이벤트 즉시 체크\n"
        "  /help          — 도움말\n\n"
        "국내주식: 6자리 종목코드 (예: 005930)\n"
        "미국주식: 티커 심볼 (예: AAPL, TSLA)\n\n"
        "자동 체크:\n"
        "  • 매시간  — 국내 DART 공시\n"
        "  • 6시간마다 — 미국 이벤트\n"
        "  • 매일 오전 8시 — 이벤트 일일 요약\n\n"
        "국내 공시 알림은 DART API 키 설정 필요\n"
        "(opendart.fss.or.kr 에서 무료 발급)"
    )

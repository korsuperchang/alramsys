"""텔레그램 메시지 포맷터."""
from datetime import datetime, timedelta


DISCLOSURE_EN = {
    "계약 체결": "Single Sales/Supply Contract",
    "유상증자 결정": "Paid-in Capital Increase",
    "무상증자 결정": "Free Share Distribution",
    "배당 결정": "Dividend Decision",
    "자사주 취득": "Share Buyback",
    "자사주 소각": "Share Cancellation",
    "주주총회 소집": "Shareholders' Meeting",
}

_SENTIMENT_EMOJI = {"긍정": "🟢", "중립": "🟡", "부정": "🔴"}


def _is_tomorrow(date_str: str) -> bool:
    try:
        target = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
        tomorrow = (datetime.now() + timedelta(days=1)).date()
        return target == tomorrow
    except Exception:
        return False


def _is_supply_demand(event_type: str) -> bool:
    return any(k in event_type for k in ("순매수", "순매도", "거래량", "공매도"))


# ── 포맷 함수 ──────────────────────────────────────────────────


def format_dart_disclosure(event: dict) -> str:
    name = event.get("name", "")
    date = event.get("date", "")
    title = event.get("title", "")
    detail = event.get("detail", {})
    event_type = event.get("event_type", "")

    lines = [
        f"📢 [공시 알림] {name}",
        f"🕐 {date}",
        f"📋 {title}",
    ]

    if detail.get("amount_kr"):
        lines.append(f"💰 계약금액: {detail['amount_kr']}")
    if detail.get("partner"):
        lines.append(f"🤝 계약상대: {detail['partner']}")
    if detail.get("revenue_ratio"):
        lines.append(f"📊 매출액 대비: {detail['revenue_ratio']}%")
    if detail.get("record_date"):
        lines.append(f"📅 신주배정기준일: {detail['record_date']}")
    if detail.get("allot_ratio"):
        lines.append(f"📈 배정비율: {detail['allot_ratio']}")

    clean_type = event_type.lstrip("📢🎁💰🔄🔥📝🏛📄⚡💸⚠️🚨✅🧬📊🔀 ")
    en_label = DISCLOSURE_EN.get(clean_type)

    if en_label and (detail.get("amount_en") or detail.get("partner")):
        lines.append("")
        lines.append(f"[번역] {en_label}")
        if detail.get("amount_en"):
            lines.append(f"Amount: {detail['amount_en']}")
        if detail.get("partner"):
            lines.append(f"Partner: {detail['partner']}")
        if detail.get("revenue_ratio"):
            lines.append(f"Revenue ratio: {detail['revenue_ratio']}%")

    return "\n".join(lines)


def format_ex_rights_alert(event: dict) -> str:
    code = event.get("code", "")
    name = event.get("name", "")
    event_date = event.get("event_date") or event.get("date", "")
    rights_type = event.get("rights_type", "")

    tomorrow = _is_tomorrow(event_date)

    if tomorrow:
        header = "📅 [일정 알림] 내일 권리락"
    else:
        header = f"📅 [일정 알림] {event_date} 권리락"

    lines = [
        header,
        f"📌 {name} ({code})",
        f"⚡ {rights_type} 권리락",
        f"📅 {event_date}",
    ]

    if tomorrow:
        lines.append("⚠️ 오늘 장 마감 전까지 보유 필요")

    return "\n".join(lines)


def format_us_earnings(event: dict) -> str:
    code = event.get("code", "")
    name = event.get("name", "")
    date = event.get("date", "")
    detail = event.get("detail", {})

    tomorrow = _is_tomorrow(date)
    time_kr = detail.get("time", "")

    if tomorrow:
        timing = "내일 " + time_kr if time_kr else "내일"
    else:
        timing = date

    lines = [
        f"🇺🇸 [실적발표] {timing}",
        f"📌 {name} ({code})",
        f"📅 {date}",
    ]

    eps = detail.get("eps_estimate")
    if eps is not None:
        try:
            lines.append(f"📊 예상 EPS: ${float(eps):+.2f}")
        except (ValueError, TypeError):
            pass

    revenue_str = detail.get("revenue_str")
    if revenue_str:
        lines.append(f"📊 예상 매출: {revenue_str}")

    return "\n".join(lines)


def format_us_exdiv(event: dict) -> str:
    code = event.get("code", "")
    name = event.get("name", "")
    date = event.get("date", "")

    tomorrow = _is_tomorrow(date)

    if tomorrow:
        header = "🇺🇸 [일정 알림] 내일 배당락"
    else:
        header = f"🇺🇸 [일정 알림] {date} 배당락"

    lines = [
        header,
        f"📌 {name} ({code})",
        f"📅 {date}",
    ]

    if tomorrow:
        lines.append("⚠️ 오늘 장 마감 전까지 보유 필요")

    return "\n".join(lines)


def format_supply_demand(event: dict) -> str:
    name = event.get("name", "")
    code = event.get("code", "")
    event_type = event.get("event_type", "")
    date = event.get("date", "")
    detail = event.get("detail", {})

    lines = [
        f"📡 [수급 알림] {name} ({code})",
        f"📅 {date}",
        f"⚡ {event_type.lstrip('📈📊🩳 ')}",
    ]

    investor = detail.get("investor")
    direction = detail.get("direction")
    if investor and direction:
        lines.append(f"💹 {investor} 5일 연속 {direction}")

    if detail.get("volume_ratio"):
        lines.append(f"📊 20일 평균 대비 {detail['volume_ratio']}배 거래량")

    if detail.get("short_ratio"):
        lines.append(f"🩳 5거래일 대비 {detail['short_ratio']}배 공매도 잔고")

    return "\n".join(lines)


# ── 공통 추가 함수 ─────────────────────────────────────────────


def append_grade_info(text: str, event_type: str) -> str:
    from bot.alert_grade import get_grade_info
    grade, guide = get_grade_info(event_type)
    if guide:
        return text + f"\n\n{grade} | {guide}"
    return text + f"\n\n{grade}"


def append_ai_analysis(text: str, analysis: str | None) -> str:
    if not analysis:
        return text
    sentiment_tag = ""
    body = analysis
    for s in ("긍정", "중립", "부정"):
        prefix = f"[{s}]"
        if analysis.startswith(prefix):
            emoji = _SENTIMENT_EMOJI[s]
            sentiment_tag = f" [{emoji} {s}]"
            body = analysis[len(prefix):].strip(": \n").strip()
            break
    return text + f"\n\n🤖 AI 분석{sentiment_tag}\n{body}"


# ── 메인 디스패처 ─────────────────────────────────────────────


def format_event(event: dict) -> str:
    market = event.get("market", "")
    event_type = event.get("event_type", "")

    if market == "KR":
        if "권리락" in event_type:
            msg = format_ex_rights_alert(event)
        elif _is_supply_demand(event_type):
            msg = format_supply_demand(event)
        else:
            msg = format_dart_disclosure(event)
        return append_grade_info(msg, event_type)

    if market == "US":
        if "실적" in event_type:
            msg = format_us_earnings(event)
        elif "배당락" in event_type:
            msg = format_us_exdiv(event)
        else:
            name = event.get("name", "")
            code = event.get("code", "")
            date = event.get("date", "")
            lines = [event_type, f"🇺🇸 {name} ({code})", f"📅 {date}"]
            title = event.get("title", "")
            if title and title != name:
                lines.append(f"📋 {title}")
            url = event.get("url", "")
            if url:
                lines.append(f"🔗 {url}")
            msg = "\n".join(lines)
        return append_grade_info(msg, event_type)

    # 시장 미분류
    name = event.get("name", "")
    code = event.get("code", "")
    date = event.get("date", "")
    flag = "🇰🇷" if market == "KR" else "🇺🇸"
    lines = [event_type, f"{flag} {name} ({code})", f"📅 {date}"]
    title = event.get("title", "")
    if title and title != name:
        lines.append(f"📋 {title}")
    url = event.get("url", "")
    if url:
        lines.append(f"🔗 {url}")
    return append_grade_info("\n".join(lines), event_type)


# ── 목록·요약 ────────────────────────────────────────────────


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
        "  • 매시간       — 국내 DART 공시\n"
        "  • 6시간마다    — 미국 이벤트\n"
        "  • 매일 오전 8시 — 이벤트 일일 요약\n"
        "  • 매일 오전 8시 30분 — 권리락 D-1 알림\n"
        "  • 매일 오후 4시 30분 — 수급 이벤트 체크\n\n"
        "국내 공시 알림은 DART API 키 설정 필요\n"
        "(opendart.fss.or.kr 에서 무료 발급)\n\n"
        "알림 등급:\n"
        "  🔴 S등급 — 즉시 확인 필요\n"
        "  🟡 A등급 — 중요 이벤트\n"
        "  🟢 B등급 — 참고 이벤트"
    )

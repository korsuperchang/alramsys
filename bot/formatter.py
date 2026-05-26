"""텔레그램 메시지 포맷터."""
from datetime import datetime, timedelta

_SEP = "─" * 24
_WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"]


def _arrow(pct: float) -> str:
    return "▲" if pct >= 0 else "▼"


def _pct(pct: float) -> str:
    sign = "+" if pct >= 0 else ""
    return f"{_arrow(pct)} {sign}{pct:.1f}%"


def _flow(val: int) -> str:
    eok = val / 1_0000_0000
    arrow = "▲ +" if eok >= 0 else "▼ "
    return f"{arrow}{abs(eok):.0f}억"


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


# ── 거시경제 포맷 ─────────────────────────────────────────────


def format_morning_briefing(snap: dict, events: list) -> str:
    now = datetime.now()
    date_str = f"{now.month}월 {now.day}일 {_WEEKDAY[now.weekday()]}요일"

    lines = [f"🌅 모닝 브리핑  ·  {date_str}", _SEP]

    # 간밤 미국 시장
    us_parts = []
    for key, label in [("sp500", "S&P"), ("nasdaq", "나스닥"), ("dow", "다우")]:
        d = snap.get(key)
        if d:
            us_parts.append(f"{label} {_pct(d['pct'])}")
    if us_parts:
        lines.append("🌏 간밤 미국")
        lines.append("  " + "  ·  ".join(us_parts))

    # 매크로 지표
    macro_parts = []
    for key, label, fmt in [
        ("tnx",  "10년물", lambda d: f"{d['value']:.2f}% ({'+' if d['pct']>=0 else ''}{(d['value']-d['prev'])*100:.0f}bp)"),
        ("vix",  "VIX",   lambda d: f"{d['value']:.1f} ({_pct(d['pct'])})"),
        ("dxy",  "달러",   lambda d: f"{d['value']:.1f} ({_pct(d['pct'])})"),
        ("krw",  "원달러", lambda d: f"{d['value']:,.0f}원 ({_pct(d['pct'])})"),
        ("oil",  "유가",   lambda d: f"${d['value']:.1f} ({_pct(d['pct'])})"),
    ]:
        d = snap.get(key)
        if d:
            macro_parts.append(f"  {label}  {fmt(d)}")
    if macro_parts:
        lines.append("")
        lines.extend(macro_parts)

    # 오늘 경제 일정
    if events:
        lines.append("")
        lines.append("📅 오늘 주요 일정")
        imp_emoji = {"S": "🔴", "A": "🟡", "B": "🟢"}
        for e in events[:5]:
            badge = imp_emoji.get(e.get("importance", "B"), "🟢")
            time  = f"{e['time_kst']}  " if e.get("time_kst") else ""
            lines.append(f"  {badge} {time}{e['title']}")
            if e.get("hint"):
                lines.append(f"      └ {e['hint']}")

    lines.append(_SEP)
    return "\n".join(lines)


def _stock_row(s: dict, is_kr: bool) -> str:
    name  = (s.get("name") or s["code"])[:8]
    pct   = s["pct"]
    arrow = "▲" if pct >= 0 else "▼"
    sign  = "+" if pct >= 0 else ""
    price = f"{s['price']:,.0f}" if is_kr else f"${s['price']:,.2f}"
    return f"  {arrow} {sign}{pct:.1f}%  {name}  {price}"


def format_evening_summary(snap: dict, sectors: list, flow: dict,
                            kr_prices: list | None = None,
                            us_prices: list | None = None) -> str:
    now = datetime.now()
    date_str = f"{now.month}월 {now.day}일 {_WEEKDAY[now.weekday()]}요일"

    lines = [f"📊 장 마감 요약  ·  {date_str}", _SEP]

    # 지수
    idx_lines = []
    for key, label in [("kospi", "코스피"), ("kosdaq", "코스닥"), ("krw", "원달러")]:
        d = snap.get(key)
        if d:
            val = f"{d['value']:,.0f}원" if key == "krw" else f"{d['value']:,.0f}"
            idx_lines.append(f"  {label}  {val}  {_pct(d['pct'])}")
    if idx_lines:
        lines.append("📈 지수")
        lines.extend(idx_lines)

    # 수급
    if flow:
        lines.append("")
        lines.append("💹 수급 (코스피)")
        if "foreign" in flow:
            lines.append(f"  외국인  {_flow(flow['foreign'])}")
        if "institution" in flow:
            lines.append(f"  기관    {_flow(flow['institution'])}")

    # 섹터 성과
    if sectors:
        gainers = [s for s in sectors if s["pct"] > 0][:3]
        losers  = [s for s in reversed(sectors) if s["pct"] < 0][:3]
        lines.append("")
        lines.append("🔄 섹터")
        if gainers:
            g = "  ".join(f"{s['sector']} +{s['pct']:.1f}%" for s in gainers)
            lines.append(f"  ▲ {g}")
        if losers:
            l = "  ".join(f"{s['sector']} {s['pct']:.1f}%" for s in losers)
            lines.append(f"  ▼ {l}")

    # 관심종목 - 국내
    if kr_prices:
        lines.append("")
        lines.append("🇰🇷 관심종목")
        for s in kr_prices:
            lines.append(_stock_row(s, is_kr=True))

    # 관심종목 - 미국
    if us_prices:
        lines.append("")
        lines.append("🇺🇸 관심종목")
        for s in us_prices:
            lines.append(_stock_row(s, is_kr=False))

    lines.append(_SEP)
    return "\n".join(lines)


def format_anomaly_alert(anomalies: list, snap: dict) -> str:
    lines = ["🚨 시장 이상 징후 감지", _SEP]

    for a in anomalies:
        key = a["indicator"]
        val = a["value"]
        if key == "krw":
            val_str = f"{val:,.0f}원"
        elif key == "tnx":
            bp = a.get("bp", 0)
            val_str = f"{val:.2f}% (+{bp:.0f}bp)"
        elif key == "vix":
            val_str = f"{val:.1f}"
        else:
            val_str = f"{val:,.0f}"
        lines.append(f"  {a['label']:<8}  {_pct(a['pct'])}  ({val_str})")

    lines.append(_SEP)
    lines.append("🔴 S등급  즉시 확인 필요")
    return "\n".join(lines)


def append_macro_summary(text: str, summary: str | None) -> str:
    if not summary:
        return text
    return text + f"\n\n💡 AI 핵심\n{summary}"


def format_us_close_summary(snap: dict) -> str:
    now = datetime.now()
    date_str = f"{now.month}월 {now.day}일 {_WEEKDAY[now.weekday()]}요일"

    lines = [f"🌃 미장 마감 요약  ·  {date_str}", _SEP]

    # 주요 지수
    idx_lines = []
    for key, label in [("sp500", "S&P 500"), ("nasdaq", "나스닥"), ("dow", "다우")]:
        d = snap.get(key)
        if d:
            idx_lines.append(f"  {label:<10}  {d['value']:,.0f}  {_pct(d['pct'])}")
    if idx_lines:
        lines.append("📈 지수")
        lines.extend(idx_lines)

    # 매크로 지표
    macro_parts = []
    for key, label, fmt in [
        ("vix",  "VIX",    lambda d: f"{d['value']:.1f} ({_pct(d['pct'])})"),
        ("tnx",  "10년물",  lambda d: f"{d['value']:.2f}% ({'+' if d['pct']>=0 else ''}{(d['value']-d['prev'])*100:.0f}bp)"),
        ("dxy",  "달러인덱스", lambda d: f"{d['value']:.1f} ({_pct(d['pct'])})"),
        ("krw",  "원달러",  lambda d: f"{d['value']:,.0f}원 ({_pct(d['pct'])})"),
        ("oil",  "WTI 유가", lambda d: f"${d['value']:.1f} ({_pct(d['pct'])})"),
    ]:
        d = snap.get(key)
        if d:
            macro_parts.append(f"  {label:<10}  {fmt(d)}")
    if macro_parts:
        lines.append("")
        lines.append("🔢 주요 지표")
        lines.extend(macro_parts)

    lines.append(_SEP)
    return "\n".join(lines)


def format_us_premarket_briefing(snap: dict, events: list) -> str:
    now = datetime.now()
    date_str = f"{now.month}월 {now.day}일 {_WEEKDAY[now.weekday()]}요일"

    lines = [f"🌙 미장 개장 전 브리핑  ·  {date_str}", _SEP]

    # 오늘 밤 주요 일정
    us_events = [e for e in events if e.get("country") == "US"]
    if us_events:
        lines.append("📅 오늘 밤 미국 주요 일정")
        imp_emoji = {"S": "🔴", "A": "🟡", "B": "🟢"}
        for e in us_events[:5]:
            badge = imp_emoji.get(e.get("importance", "B"), "🟢")
            time  = f"{e['time_kst']}  " if e.get("time_kst") else ""
            lines.append(f"  {badge} {time}{e['title']}")
            if e.get("hint"):
                lines.append(f"      └ {e['hint']}")
    else:
        lines.append("📅 오늘 밤 주요 경제 일정 없음")

    # 현재 시장 지표
    macro_parts = []
    for key, label, fmt in [
        ("sp500",  "S&P 500",  lambda d: f"{d['value']:,.0f} ({_pct(d['pct'])})"),
        ("nasdaq", "나스닥",   lambda d: f"{d['value']:,.0f} ({_pct(d['pct'])})"),
        ("vix",    "VIX",      lambda d: f"{d['value']:.1f} ({_pct(d['pct'])})"),
        ("krw",    "원달러",   lambda d: f"{d['value']:,.0f}원 ({_pct(d['pct'])})"),
    ]:
        d = snap.get(key)
        if d:
            macro_parts.append(f"  {label:<10}  {fmt(d)}")
    if macro_parts:
        lines.append("")
        lines.append("📊 현재 지표")
        lines.extend(macro_parts)

    lines.append(_SEP)
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
        "  • 매시간          — 국내 DART 공시\n"
        "  • 6시간마다       — 미국 이벤트\n"
        "  • 매일 06:00      — 미장 마감 요약\n"
        "  • 매일 08:00      — 모닝 브리핑\n"
        "  • 매일 08:30      — 권리락 D-1 알림\n"
        "  • 매일 16:30      — 수급 이벤트 체크\n"
        "  • 매일 16:45      — 장 마감 요약\n"
        "  • 매일 22:00      — 미장 개장 전 브리핑\n\n"
        "국내 공시 알림은 DART API 키 설정 필요\n"
        "(opendart.fss.or.kr 에서 무료 발급)\n\n"
        "알림 등급:\n"
        "  🔴 S등급 — 즉시 확인 필요\n"
        "  🟡 A등급 — 중요 이벤트\n"
        "  🟢 B등급 — 참고 이벤트"
    )

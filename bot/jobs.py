"""스케줄 기반 이벤트 체크 Job 모음."""
import asyncio
import logging
from datetime import datetime, time as dt_time

import pytz
from telegram import Bot
from telegram.ext import Application, ContextTypes

from config import Config
from db import database as db
from fetchers import dart, us_stock
from fetchers.ai_analysis import get_analysis, get_macro_summary
from fetchers.supply_demand import get_supply_demand_events
from fetchers.market_indicators import get_snapshot, check_anomalies
from fetchers.sector_monitor import get_sector_performance, get_market_flow
from fetchers.macro_calendar import get_upcoming_events
from bot import formatter

logger = logging.getLogger(__name__)

KST = pytz.timezone("Asia/Seoul")


async def _send(bot: Bot, text: str):
    try:
        await bot.send_message(
            chat_id=Config.TELEGRAM_CHAT_ID,
            text=text,
            disable_web_page_preview=True,
        )
    except Exception as exc:
        logger.error("텔레그램 발송 실패: %s", exc)


async def _process_events(bot: Bot, events: list[dict]) -> list[dict]:
    sent = []
    for event in events:
        msg = formatter.format_event(event)
        analysis = await asyncio.to_thread(get_analysis, event)
        msg = formatter.append_ai_analysis(msg, analysis)
        await _send(bot, msg)
        db.mark_alert_sent(event["code"], event["alert_key"])
        sent.append(event)
    return sent


# ── 개별 종목 Jobs ────────────────────────────────────────────


async def check_kr_disclosures(context: ContextTypes.DEFAULT_TYPE):
    """국내 DART 공시 체크 (매시간)."""
    if not Config.DART_API_KEY:
        return
    for stock in db.get_kr_stocks():
        events = dart.get_new_events(stock)
        if events:
            await _process_events(context.bot, events)
            logger.info("KR 공시 알림: %s %d건", stock["code"], len(events))


async def check_us_events(context: ContextTypes.DEFAULT_TYPE):
    """미국 주식 이벤트 체크 (6시간마다)."""
    for stock in db.get_us_stocks():
        events = us_stock.get_upcoming_events(stock)
        if events:
            await _process_events(context.bot, events)
            logger.info("US 이벤트 알림: %s %d건", stock["code"], len(events))


async def check_scheduled_events(context: ContextTypes.DEFAULT_TYPE):
    """권리락 D-1 알림 (매일 08:30 KST)."""
    for event in db.get_upcoming_scheduled_events(days=1):
        msg = formatter.format_ex_rights_alert(event)
        msg = formatter.append_grade_info(msg, event.get("event_type", ""))
        analysis = await asyncio.to_thread(get_analysis, {
            "market": "KR", "code": event["code"],
            "name": event.get("name", ""), "event_type": event.get("event_type", ""),
            "date": event.get("event_date", ""), "detail": {},
        })
        msg = formatter.append_ai_analysis(msg, analysis)
        await _send(context.bot, msg)
        db.mark_scheduled_event_alerted(event["source_key"])
        logger.info("예정 이벤트 알림: %s %s", event["code"], event["event_type"])


async def check_supply_demand(context: ContextTypes.DEFAULT_TYPE):
    """수급 이벤트 체크 (매일 16:30 KST, 장 마감 후)."""
    for stock in db.get_kr_stocks():
        events = await asyncio.to_thread(get_supply_demand_events, stock)
        if events:
            await _process_events(context.bot, events)
            logger.info("수급 알림: %s %d건", stock["code"], len(events))


# ── 거시경제 Jobs ────────────────────────────────────────────


async def check_market_anomalies(context: ContextTypes.DEFAULT_TYPE):
    """시장 이상 징후 감지 (매시간). 임계값 초과 시 즉시 알림."""
    snap = await asyncio.to_thread(get_snapshot)
    cfg = {
        "kospi_drop":   Config.ANOMALY_KOSPI_DROP,
        "kosdaq_drop":  Config.ANOMALY_KOSDAQ_DROP,
        "vix_level":    Config.ANOMALY_VIX_LEVEL,
        "vix_spike":    Config.ANOMALY_VIX_SPIKE,
        "krw_spike":    Config.ANOMALY_KRW_SPIKE,
        "tnx_spike_bp": Config.ANOMALY_TNX_BP,
    }
    anomalies = check_anomalies(snap, cfg)
    if not anomalies:
        return

    today = datetime.now().strftime("%Y-%m-%d")
    new_anomalies = [
        a for a in anomalies
        if not db.is_alert_sent(f"ANOMALY:{a['indicator']}:{today}")
    ]
    if not new_anomalies:
        return

    for a in new_anomalies:
        db.mark_alert_sent("MARKET", f"ANOMALY:{a['indicator']}:{today}")

    msg = formatter.format_anomaly_alert(new_anomalies, snap)

    # AI 분석 (이상 징후 컨텍스트)
    ctx = "\n".join(
        f"{a['label']}: {_arrow(a['pct'])}{a['pct']:+.1f}% ({a['value']:.1f})"
        for a in new_anomalies
    )
    analysis = await asyncio.to_thread(get_analysis, {
        "market": "MACRO", "event_type": "시장 이상 징후",
        "name": "시장전체", "code": "MARKET",
        "date": today, "detail": {"context": ctx},
    })
    msg = formatter.append_ai_analysis(msg, analysis)
    await _send(context.bot, msg)
    logger.info("시장 이상 징후 알림: %d건", len(new_anomalies))


async def morning_briefing(context: ContextTypes.DEFAULT_TYPE):
    """모닝 브리핑 (매일 08:00 KST): 간밤 미국 시장 + 오늘 거시 일정."""
    snap   = await asyncio.to_thread(get_snapshot)
    events = get_upcoming_events(days=1)

    msg     = formatter.format_morning_briefing(snap, events)
    summary = await asyncio.to_thread(get_macro_summary, msg)
    msg     = formatter.append_macro_summary(msg, summary)

    await _send(context.bot, msg)
    logger.info("모닝 브리핑 발송")


async def evening_market_summary(context: ContextTypes.DEFAULT_TYPE):
    """장 마감 요약 (매일 16:45 KST): 지수 + 섹터 + 수급."""
    snap    = await asyncio.to_thread(get_snapshot)
    sectors = await asyncio.to_thread(get_sector_performance)
    flow    = await asyncio.to_thread(get_market_flow)

    msg     = formatter.format_evening_summary(snap, sectors, flow)
    summary = await asyncio.to_thread(get_macro_summary, msg)
    msg     = formatter.append_macro_summary(msg, summary)

    await _send(context.bot, msg)
    logger.info("장 마감 요약 발송")


# ── /check 즉시 실행 ─────────────────────────────────────────


async def run_all_checks(bot: Bot) -> tuple[list[dict], list[dict]]:
    kr_sent, us_sent = [], []

    for stock in db.get_kr_stocks():
        sent = await _process_events(bot, dart.get_new_events(stock))
        kr_sent.extend(sent)
        sent = await _process_events(bot, await asyncio.to_thread(get_supply_demand_events, stock))
        kr_sent.extend(sent)

    for stock in db.get_us_stocks():
        sent = await _process_events(bot, us_stock.get_upcoming_events(stock))
        us_sent.extend(sent)

    return kr_sent, us_sent


# ── 스케줄 등록 ──────────────────────────────────────────────


def _arrow(pct: float) -> str:
    return "▲" if pct >= 0 else "▼"


def schedule_jobs(app: Application):
    jq = app.job_queue

    jq.run_repeating(check_kr_disclosures,
                     interval=Config.KR_CHECK_INTERVAL, first=30,
                     name="kr_disclosures")

    jq.run_repeating(check_us_events,
                     interval=Config.US_CHECK_INTERVAL, first=60,
                     name="us_events")

    jq.run_repeating(check_market_anomalies,
                     interval=Config.ANOMALY_CHECK_INTERVAL, first=120,
                     name="market_anomalies")

    jq.run_daily(morning_briefing,
                 time=dt_time(8, 0, tzinfo=KST), name="morning_briefing")

    jq.run_daily(check_scheduled_events,
                 time=dt_time(8, 30, tzinfo=KST), name="scheduled_events")

    jq.run_daily(check_supply_demand,
                 time=dt_time(16, 30, tzinfo=KST), name="supply_demand")

    jq.run_daily(evening_market_summary,
                 time=dt_time(16, 45, tzinfo=KST), name="evening_summary")

    logger.info("스케줄 Job 등록 완료")

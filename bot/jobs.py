"""스케줄 기반 이벤트 체크 Job 모음."""
import logging
from datetime import time as dt_time

import pytz
from telegram import Bot
from telegram.ext import Application, ContextTypes

from config import Config
from db import database as db
from fetchers import dart, us_stock
from bot import formatter

logger = logging.getLogger(__name__)

KST = pytz.timezone("Asia/Seoul")


async def _send(bot: Bot, text: str):
    """봇으로 메시지 발송."""
    try:
        await bot.send_message(
            chat_id=Config.TELEGRAM_CHAT_ID,
            text=text,
            disable_web_page_preview=True,
        )
    except Exception as exc:
        logger.error("텔레그램 발송 실패: %s", exc)


async def _process_events(bot: Bot, events: list[dict]) -> list[dict]:
    """이벤트 목록을 순회하며 발송 + DB 기록, 발송된 목록 반환."""
    sent = []
    for event in events:
        msg = formatter.format_event(event)
        await _send(bot, msg)
        db.mark_alert_sent(event["code"], event["alert_key"])
        sent.append(event)
    return sent


async def check_kr_disclosures(context: ContextTypes.DEFAULT_TYPE):
    """국내 주식 DART 공시 체크 (주기 Job)."""
    if not Config.DART_API_KEY:
        return

    kr_stocks = db.get_kr_stocks()
    if not kr_stocks:
        return

    for stock in kr_stocks:
        events = dart.get_new_events(stock)
        if events:
            await _process_events(context.bot, events)
            logger.info("KR 공시 알림 발송: %s %d건", stock["code"], len(events))


async def check_us_events(context: ContextTypes.DEFAULT_TYPE):
    """미국 주식 이벤트 체크 (주기 Job)."""
    us_stocks = db.get_us_stocks()
    if not us_stocks:
        return

    for stock in us_stocks:
        events = us_stock.get_upcoming_events(stock)
        if events:
            await _process_events(context.bot, events)
            logger.info("US 이벤트 알림 발송: %s %d건", stock["code"], len(events))


async def morning_briefing(context: ContextTypes.DEFAULT_TYPE):
    """매일 아침 8시 관심종목 이벤트 요약 발송."""
    kr_stocks = db.get_kr_stocks()
    us_stocks = db.get_us_stocks()

    if not kr_stocks and not us_stocks:
        return

    kr_events: list[dict] = []
    us_events: list[dict] = []

    for stock in kr_stocks:
        if Config.DART_API_KEY:
            kr_events.extend(dart.get_new_events(stock))

    for stock in us_stocks:
        us_events.extend(us_stock.get_upcoming_events(stock))

    summary = formatter.format_daily_summary(kr_events, us_events)
    await _send(context.bot, summary)


async def run_all_checks(bot: Bot) -> tuple[list[dict], list[dict]]:
    """
    /check 명령어에서 즉시 실행용.
    (kr_sent, us_sent) 튜플 반환.
    """
    kr_sent: list[dict] = []
    us_sent: list[dict] = []

    for stock in db.get_kr_stocks():
        events = dart.get_new_events(stock)
        sent = await _process_events(bot, events)
        kr_sent.extend(sent)

    for stock in db.get_us_stocks():
        events = us_stock.get_upcoming_events(stock)
        sent = await _process_events(bot, events)
        us_sent.extend(sent)

    return kr_sent, us_sent


def schedule_jobs(app: Application):
    """Application 에 모든 주기적 Job 을 등록."""
    jq = app.job_queue

    # 국내 DART 공시: 매시간 (장 운영 시간 우선, 단순화해서 항상 체크)
    jq.run_repeating(
        check_kr_disclosures,
        interval=Config.KR_CHECK_INTERVAL,
        first=30,
        name="kr_disclosures",
    )

    # 미국 이벤트: 6시간마다
    jq.run_repeating(
        check_us_events,
        interval=Config.US_CHECK_INTERVAL,
        first=60,
        name="us_events",
    )

    # 매일 오전 8시 (KST) 요약
    jq.run_daily(
        morning_briefing,
        time=dt_time(8, 0, 0, tzinfo=KST),
        name="morning_briefing",
    )

    logger.info("스케줄 Job 등록 완료")

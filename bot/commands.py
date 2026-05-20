"""텔레그램 봇 커맨드 핸들러."""
import logging

from telegram import Update
from telegram.ext import ContextTypes

from config import Config
from db import database as db
from fetchers import krx, us_stock
from bot import formatter
from bot.jobs import run_all_checks

logger = logging.getLogger(__name__)


def _only_owner(func):
    """봇 소유자만 명령 실행 가능하도록 제한."""
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_id = str(update.effective_user.id)
        if Config.TELEGRAM_CHAT_ID and user_id != Config.TELEGRAM_CHAT_ID:
            await update.message.reply_text("⛔ 권한이 없습니다.")
            return
        return await func(update, context)
    wrapper.__name__ = func.__name__
    return wrapper


@_only_owner
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 알람시스에 오신 것을 환영합니다!\n"
        "/help 로 사용법을 확인하세요."
    )


@_only_owner
async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(formatter.format_help())


@_only_owner
async def cmd_add(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args
    if not args:
        await update.message.reply_text(
            "사용법: /add <종목코드>\n예) /add 005930  또는  /add AAPL"
        )
        return

    code = args[0].strip().upper()

    if db.stock_exists(code):
        await update.message.reply_text(f"이미 관심종목에 있습니다: {code}")
        return

    await update.message.reply_text(f"⏳ {code} 정보를 조회 중...")

    if krx.is_kr_code(code):
        name = krx.get_stock_name(code)
        if not name:
            await update.message.reply_text(
                f"❌ 종목코드를 찾을 수 없습니다: {code}\n"
                "KRX에 상장된 6자리 코드인지 확인하세요."
            )
            return
        market = "KR"
    else:
        info = us_stock.get_us_stock_info(code)
        if not info:
            await update.message.reply_text(
                f"❌ 티커를 찾을 수 없습니다: {code}\n"
                "올바른 미국 주식 티커인지 확인하세요."
            )
            return
        name = info["name"]
        market = "US"

    flag = "🇰🇷" if market == "KR" else "🇺🇸"
    if db.add_stock(code, name, market):
        await update.message.reply_text(
            f"✅ 관심종목 추가 완료\n{flag} {name} ({code})"
        )
    else:
        await update.message.reply_text(f"이미 관심종목에 있습니다: {code}")


@_only_owner
async def cmd_remove(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args
    if not args:
        await update.message.reply_text("사용법: /remove <종목코드>\n예) /remove 005930")
        return

    code = args[0].strip().upper()
    if db.remove_stock(code):
        await update.message.reply_text(f"✅ 관심종목 삭제 완료: {code}")
    else:
        await update.message.reply_text(
            f"❌ 목록에 없는 종목입니다: {code}\n/list 로 현재 목록을 확인하세요."
        )


@_only_owner
async def cmd_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    stocks = db.get_watchlist()
    await update.message.reply_text(formatter.format_watchlist(stocks))


@_only_owner
async def cmd_check(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔍 이벤트를 즉시 체크합니다...")
    kr_events, us_events = await run_all_checks(context.bot)

    total = len(kr_events) + len(us_events)
    if total == 0:
        await update.message.reply_text("✅ 새로운 이벤트가 없습니다.")
    else:
        await update.message.reply_text(f"✅ {total}건의 이벤트를 발송했습니다.")

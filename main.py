#!/usr/bin/env python3
"""알람시스 - 주식 이벤트 텔레그램 알림 봇."""
import logging
import sys

from telegram.ext import Application, CommandHandler

from config import Config
from db.database import init_db
from bot.commands import cmd_start, cmd_help, cmd_add, cmd_remove, cmd_list, cmd_check
from bot.jobs import schedule_jobs

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("alramsys.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def main():
    errors = Config.validate()
    if errors:
        for e in errors:
            logger.error(e)
        logger.error(".env 파일을 확인하고 필수 값을 설정하세요.")
        sys.exit(1)

    init_db()
    logger.info("DB 초기화 완료")

    app = (
        Application.builder()
        .token(Config.TELEGRAM_TOKEN)
        .build()
    )

    # 커맨드 핸들러 등록 (한국어 / 영어 모두 지원)
    for cmd in ("start",):
        app.add_handler(CommandHandler(cmd, cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("add", cmd_add))
    app.add_handler(CommandHandler("remove", cmd_remove))
    app.add_handler(CommandHandler("list", cmd_list))
    app.add_handler(CommandHandler("check", cmd_check))

    schedule_jobs(app)

    logger.info("알람시스 봇 시작 ✅")
    app.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    TELEGRAM_TOKEN: str = os.getenv("TELEGRAM_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")
    DART_API_KEY: str = os.getenv("DART_API_KEY", "")
    FINNHUB_API_KEY: str = os.getenv("FINNHUB_API_KEY", "")
    DB_PATH: str = os.getenv("DB_PATH", "alramsys.db")

    KR_CHECK_INTERVAL: int = int(os.getenv("KR_CHECK_INTERVAL", "3600"))
    US_CHECK_INTERVAL: int = int(os.getenv("US_CHECK_INTERVAL", "21600"))
    ALERT_DAYS_AHEAD: int = int(os.getenv("ALERT_DAYS_AHEAD", "7"))

    @classmethod
    def validate(cls) -> list[str]:
        errors = []
        if not cls.TELEGRAM_TOKEN:
            errors.append("TELEGRAM_TOKEN이 설정되지 않았습니다.")
        if not cls.TELEGRAM_CHAT_ID:
            errors.append("TELEGRAM_CHAT_ID가 설정되지 않았습니다.")
        return errors

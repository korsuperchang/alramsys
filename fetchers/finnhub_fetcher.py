"""Finnhub API를 이용한 미국 주식 실적발표 일정 조회."""
import logging
from datetime import datetime, timedelta

import requests

from config import Config

logger = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"

HOUR_KR = {"bmo": "장전", "amc": "장후", "dmh": "장중"}


def format_revenue(amount) -> str | None:
    if amount is None:
        return None
    try:
        amount = float(amount)
    except (ValueError, TypeError):
        return None
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.2f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.2f}M"
    if amount >= 1_000:
        return f"${amount / 1_000:.2f}K"
    return f"${amount:.2f}"


def get_upcoming_earnings(ticker: str) -> dict | None:
    if not Config.FINNHUB_API_KEY:
        return None

    today = datetime.now()
    to_date = today + timedelta(days=Config.ALERT_DAYS_AHEAD)

    try:
        resp = requests.get(
            f"{FINNHUB_BASE}/calendar/earnings",
            params={
                "symbol": ticker.upper(),
                "from": today.strftime("%Y-%m-%d"),
                "to": to_date.strftime("%Y-%m-%d"),
                "token": Config.FINNHUB_API_KEY,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.debug("Finnhub 실적 조회 실패 (%s): %s", ticker, exc)
        return None

    earnings_calendar = data.get("earningsCalendar", [])
    if not earnings_calendar:
        return None

    entry = earnings_calendar[0]
    date_str = entry.get("date", "")
    hour_raw = entry.get("hour", "")
    eps_estimate = entry.get("epsEstimate")
    revenue_estimate = entry.get("revenueEstimate")

    time_kr = HOUR_KR.get(hour_raw, "")
    revenue_str = format_revenue(revenue_estimate)

    return {
        "date": date_str,
        "time": time_kr,
        "eps_estimate": eps_estimate,
        "revenue_estimate": revenue_estimate,
        "revenue_str": revenue_str,
    }

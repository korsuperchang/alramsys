"""yfinance 를 이용한 미국 주식 이벤트 조회."""
import logging
from datetime import datetime, timedelta, timezone

import yfinance as yf

from config import Config
from db import database as db

logger = logging.getLogger(__name__)


def get_us_stock_info(ticker: str) -> dict | None:
    """티커로 미국 주식 기본 정보 조회. 유효하지 않으면 None."""
    try:
        t = yf.Ticker(ticker.upper())
        info = t.info
        name = info.get("longName") or info.get("shortName") or ticker.upper()
        # 유효성: quoteType 이 존재하면 정상 종목
        if not info.get("quoteType"):
            return None
        return {"ticker": ticker.upper(), "name": name}
    except Exception as exc:
        logger.debug("yfinance 정보 조회 실패 (%s): %s", ticker, exc)
        return None


def _to_date_str(value) -> str | None:
    """Timestamp / datetime / str 을 'YYYY-MM-DD' 문자열로 변환."""
    if value is None:
        return None
    try:
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d")
        return str(value)[:10]
    except Exception:
        return None


def get_upcoming_events(stock: dict) -> list[dict]:
    """
    미국 주식의 예정 이벤트(실적발표, 배당락) 중 아직 발송하지 않은 것을 반환.
    Config.ALERT_DAYS_AHEAD 이내 이벤트만 포함.
    """
    ticker = stock["code"]
    events = []
    now = datetime.now(tz=timezone.utc)
    horizon = now + timedelta(days=Config.ALERT_DAYS_AHEAD)

    try:
        t = yf.Ticker(ticker)
        _collect_earnings(t, stock, now, horizon, events)
        _collect_dividend(t, stock, now, horizon, events)
    except Exception as exc:
        logger.warning("yfinance 이벤트 조회 실패 (%s): %s", ticker, exc)

    return events


def _collect_earnings(t, stock, now, horizon, events: list):
    """실적발표 이벤트 수집."""
    try:
        df = t.earnings_dates
        if df is None or df.empty:
            return
        for ts, _ in df.iterrows():
            if ts is None:
                continue
            # tz-aware 변환
            if hasattr(ts, "tzinfo") and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if now <= ts <= horizon:
                date_str = _to_date_str(ts)
                alert_key = f"US_EARNINGS:{stock['code']}:{date_str}"
                if not db.is_alert_sent(alert_key):
                    events.append({
                        "market":     "US",
                        "code":       stock["code"],
                        "name":       stock.get("name", stock["code"]),
                        "event_type": "📊 실적발표 예정",
                        "title":      f"{stock.get('name', stock['code'])} 실적발표",
                        "date":       date_str,
                        "url":        f"https://finance.yahoo.com/quote/{stock['code']}",
                        "alert_key":  alert_key,
                    })
                break  # 가장 가까운 것 하나만
    except Exception as exc:
        logger.debug("earnings_dates 조회 실패 (%s): %s", stock["code"], exc)


def _collect_dividend(t, stock, now, horizon, events: list):
    """배당락일 이벤트 수집."""
    try:
        cal = t.calendar
        if not cal:
            return

        # yfinance 버전에 따라 dict 또는 DataFrame
        if hasattr(cal, "to_dict"):
            cal = cal.to_dict()

        ex_div = cal.get("Ex-Dividend Date") or cal.get("exDividendDate")
        if ex_div is None:
            return

        # 리스트인 경우 첫 번째 값 사용
        if isinstance(ex_div, (list, tuple)):
            ex_div = ex_div[0] if ex_div else None
        if ex_div is None:
            return

        if hasattr(ex_div, "tzinfo") and ex_div.tzinfo is None:
            ex_div = ex_div.replace(tzinfo=timezone.utc)

        if now <= ex_div <= horizon:
            date_str = _to_date_str(ex_div)
            alert_key = f"US_EXDIV:{stock['code']}:{date_str}"
            if not db.is_alert_sent(alert_key):
                events.append({
                    "market":     "US",
                    "code":       stock["code"],
                    "name":       stock.get("name", stock["code"]),
                    "event_type": "💸 배당락일 예정",
                    "title":      f"{stock.get('name', stock['code'])} 배당락",
                    "date":       date_str,
                    "url":        f"https://finance.yahoo.com/quote/{stock['code']}",
                    "alert_key":  alert_key,
                })
    except Exception as exc:
        logger.debug("calendar 조회 실패 (%s): %s", stock["code"], exc)

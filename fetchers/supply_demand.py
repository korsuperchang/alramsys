"""pykrx 기반 국내 주식 수급 이벤트 모니터링."""
import logging
from datetime import datetime, timedelta

from db import database as db

logger = logging.getLogger(__name__)

CONSECUTIVE_DAYS = 5
VOLUME_SPIKE_RATIO = 3.0
SHORT_SPIKE_RATIO = 1.5


def _date_range(days: int = 30) -> tuple[str, str]:
    end = datetime.now()
    start = end - timedelta(days=days)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def _find_col(df, *keywords) -> str | None:
    for kw in keywords:
        for col in df.columns:
            if kw in str(col):
                return col
    return None


def get_supply_demand_events(stock: dict) -> list[dict]:
    """국내 주식 수급 이벤트 반환 (외국인/기관 연속 순매수, 거래량 급증, 공매도 잔고 급증)."""
    if stock.get("market") != "KR":
        return []

    ticker = stock["code"]
    name = stock.get("name", ticker)
    today_str = datetime.now().strftime("%Y-%m-%d")
    events = []
    start, end = _date_range(35)

    try:
        from pykrx import stock as pykrx_stock

        # 외국인/기관 연속 순매수·순매도
        try:
            df = pykrx_stock.get_market_trading_value_by_date(start, end, ticker)
            if df is not None and not df.empty and len(df) >= CONSECUTIVE_DAYS:
                for hint, label in [("외국인", "외국인"), ("기관", "기관")]:
                    col = _find_col(df, hint + "합계", hint)
                    if col is None:
                        continue
                    recent = list(df[col].iloc[-CONSECUTIVE_DAYS:])
                    if all(v > 0 for v in recent):
                        direction = "순매수"
                    elif all(v < 0 for v in recent):
                        direction = "순매도"
                    else:
                        continue
                    alert_key = f"FLOW:{ticker}:{label}:{direction}:{today_str}"
                    if not db.is_alert_sent(alert_key):
                        events.append({
                            "market":     "KR",
                            "code":       ticker,
                            "name":       name,
                            "event_type": f"📈 {label} {CONSECUTIVE_DAYS}일 연속 {direction}",
                            "title":      f"{label} {CONSECUTIVE_DAYS}일 연속 {direction}",
                            "date":       today_str,
                            "alert_key":  alert_key,
                            "detail":     {"investor": label, "direction": direction},
                        })
        except Exception as exc:
            logger.debug("투자자 수급 조회 실패 (%s): %s", ticker, exc)

        # 거래량 급증 (20일 평균 대비)
        try:
            df = pykrx_stock.get_market_ohlcv_by_date(start, end, ticker)
            if df is not None and not df.empty and len(df) >= 21:
                col = _find_col(df, "거래량")
                if col:
                    last_vol = df[col].iloc[-1]
                    avg_vol = df[col].iloc[-21:-1].mean()
                    if avg_vol > 0 and last_vol >= avg_vol * VOLUME_SPIKE_RATIO:
                        ratio = round(last_vol / avg_vol, 1)
                        alert_key = f"VOLUME:{ticker}:{today_str}"
                        if not db.is_alert_sent(alert_key):
                            events.append({
                                "market":     "KR",
                                "code":       ticker,
                                "name":       name,
                                "event_type": f"📊 거래량 {ratio}배 급증",
                                "title":      f"거래량 {ratio}배 급증",
                                "date":       today_str,
                                "alert_key":  alert_key,
                                "detail":     {"volume_ratio": ratio},
                            })
        except Exception as exc:
            logger.debug("거래량 조회 실패 (%s): %s", ticker, exc)

        # 공매도 잔고 급증 (5거래일 전 대비)
        try:
            df = pykrx_stock.get_market_shorting_balance_by_date(start, end, ticker)
            if df is not None and not df.empty and len(df) >= 6:
                col = _find_col(df, "공매도잔고", "잔고")
                if col:
                    recent = df[col].iloc[-1]
                    prev = df[col].iloc[-6]
                    if prev > 0 and recent >= prev * SHORT_SPIKE_RATIO:
                        ratio = round(recent / prev, 1)
                        alert_key = f"SHORT:{ticker}:{today_str}"
                        if not db.is_alert_sent(alert_key):
                            events.append({
                                "market":     "KR",
                                "code":       ticker,
                                "name":       name,
                                "event_type": f"🩳 공매도 잔고 {ratio}배 급증",
                                "title":      f"공매도 잔고 {ratio}배 급증",
                                "date":       today_str,
                                "alert_key":  alert_key,
                                "detail":     {"short_ratio": ratio},
                            })
        except Exception as exc:
            logger.debug("공매도 잔고 조회 실패 (%s): %s", ticker, exc)

    except ImportError:
        logger.warning("pykrx 미설치: 수급 이벤트 조회 불가")
    except Exception as exc:
        logger.warning("수급 이벤트 조회 실패 (%s): %s", ticker, exc)

    return events

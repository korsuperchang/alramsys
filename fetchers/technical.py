"""기술적 매매신호 (RSI 과매도/과매수, 골든크로스/데드크로스)."""
import logging
from datetime import datetime, timedelta

import pandas as pd

from config import Config
from db import database as db

logger = logging.getLogger(__name__)


def _rsi(closes: pd.Series, period: int = 14) -> float | None:
    """Wilder RSI 계산. 마지막 값 반환."""
    if len(closes) < period + 1:
        return None
    delta = closes.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    if avg_loss.iloc[-1] == 0:
        return 100.0
    rs = avg_gain.iloc[-1] / avg_loss.iloc[-1]
    return round(100 - (100 / (1 + rs)), 1)


def _ma_cross(closes: pd.Series, short: int = 5, long: int = 20) -> str | None:
    """5일선이 20일선을 상향(golden)/하향(dead) 돌파했는지 판정."""
    if len(closes) < long + 1:
        return None
    ma_s = closes.rolling(short).mean()
    ma_l = closes.rolling(long).mean()
    if pd.isna(ma_s.iloc[-2]) or pd.isna(ma_l.iloc[-2]):
        return None
    prev_diff = ma_s.iloc[-2] - ma_l.iloc[-2]
    curr_diff = ma_s.iloc[-1] - ma_l.iloc[-1]
    if prev_diff <= 0 < curr_diff:
        return "golden"
    if prev_diff >= 0 > curr_diff:
        return "dead"
    return None


def _get_closes(stock: dict) -> pd.Series | None:
    """종목의 최근 종가 시계열 반환 (약 3개월)."""
    code = stock["code"]
    market = stock.get("market", "")
    try:
        if market == "KR":
            from pykrx import stock as pykrx_stock
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=120)).strftime("%Y%m%d")
            df = pykrx_stock.get_market_ohlcv_by_date(start, end, code)
            if df is None or df.empty:
                return None
            col = next((c for c in df.columns if "종가" in str(c)), None)
            return df[col].astype(float) if col else None
        else:
            import yfinance as yf
            hist = yf.Ticker(code).history(period="4mo", interval="1d")
            if hist is None or hist.empty:
                return None
            return hist["Close"].astype(float)
    except Exception as exc:
        logger.debug("종가 조회 실패 (%s): %s", code, exc)
        return None


def get_technical_signals(stock: dict, today_str: str) -> list[dict]:
    """한 종목의 기술적 신호 이벤트 반환."""
    closes = _get_closes(stock)
    if closes is None or len(closes) < 21:
        return []

    code = stock["code"]
    name = stock.get("name") or code
    market = stock.get("market", "")
    events = []

    rsi = _rsi(closes)
    if rsi is not None:
        signal = None
        if rsi <= Config.RSI_OVERSOLD:
            signal = ("과매도", f"📉 RSI 과매도 ({rsi})", "🟢 반등 가능 구간 — 분할 매수 관점 검토")
        elif rsi >= Config.RSI_OVERBOUGHT:
            signal = ("과매수", f"📈 RSI 과매수 ({rsi})", "🔴 과열 구간 — 차익 실현·비중 점검")
        if signal:
            key = f"RSI:{code}:{today_str}:{signal[0]}"
            if not db.is_alert_sent(key):
                events.append({
                    "code": code, "name": name, "market": market,
                    "signal_type": signal[1], "guide": signal[2],
                    "value": rsi, "alert_key": key,
                })

    cross = _ma_cross(closes)
    if cross == "golden":
        key = f"CROSS:{code}:{today_str}:golden"
        if not db.is_alert_sent(key):
            events.append({
                "code": code, "name": name, "market": market,
                "signal_type": "✨ 골든크로스 (5·20일선)",
                "guide": "🟢 단기 상승 추세 전환 신호", "value": None,
                "alert_key": key,
            })
    elif cross == "dead":
        key = f"CROSS:{code}:{today_str}:dead"
        if not db.is_alert_sent(key):
            events.append({
                "code": code, "name": name, "market": market,
                "signal_type": "💀 데드크로스 (5·20일선)",
                "guide": "🔴 단기 하락 추세 전환 신호", "value": None,
                "alert_key": key,
            })

    return events

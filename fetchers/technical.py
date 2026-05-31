"""기술적 매매신호 (RSI, MA크로스, MACD, 볼린저밴드, 52주 신고가, 거래량 동반 급등)."""
import logging
from datetime import datetime, timedelta

import pandas as pd

from config import Config
from db import database as db

logger = logging.getLogger(__name__)


# ── 지표 계산 ─────────────────────────────────────────────────

def _rsi(closes: pd.Series, period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    delta = closes.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    if avg_loss.iloc[-1] == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_gain.iloc[-1] / avg_loss.iloc[-1])), 1)


def _ma_cross(closes: pd.Series, short: int = 5, long: int = 20) -> str | None:
    """5일선이 20일선을 상향/하향 돌파."""
    if len(closes) < long + 1:
        return None
    ma_s = closes.rolling(short).mean()
    ma_l = closes.rolling(long).mean()
    if pd.isna(ma_s.iloc[-2]) or pd.isna(ma_l.iloc[-2]):
        return None
    prev = ma_s.iloc[-2] - ma_l.iloc[-2]
    curr = ma_s.iloc[-1] - ma_l.iloc[-1]
    if prev <= 0 < curr:
        return "golden"
    if prev >= 0 > curr:
        return "dead"
    return None


def _macd_signal(closes: pd.Series) -> str | None:
    """MACD(12,26) 가 시그널선(9)을 상향/하향 돌파."""
    if len(closes) < 35:
        return None
    ema12 = closes.ewm(span=12, adjust=False).mean()
    ema26 = closes.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    if len(hist) < 2:
        return None
    if hist.iloc[-2] <= 0 < hist.iloc[-1]:
        return "bullish"   # 매수 신호
    if hist.iloc[-2] >= 0 > hist.iloc[-1]:
        return "bearish"   # 매도 신호
    return None


def _bollinger(closes: pd.Series, period: int = 20, std: float = 2.0
               ) -> str | None:
    """볼린저밴드 상단/하단 터치 여부."""
    if len(closes) < period:
        return None
    ma = closes.rolling(period).mean()
    sd = closes.rolling(period).std()
    upper = (ma + sd * std).iloc[-1]
    lower = (ma - sd * std).iloc[-1]
    price = closes.iloc[-1]
    if price >= upper:
        return "upper"   # 과매수 영역
    if price <= lower:
        return "lower"   # 과매도 영역
    return None


def _week52_high(closes: pd.Series) -> bool:
    """52주(약 252거래일) 신고가 돌파 여부."""
    if len(closes) < 60:
        return False
    window = closes.iloc[-252:] if len(closes) >= 252 else closes
    prev_high = window.iloc[:-1].max()
    return closes.iloc[-1] > prev_high


def _volume_breakout(ohlcv: pd.DataFrame) -> bool:
    """오늘 종가 +3% 이상 + 거래량 20일 평균 2배 이상."""
    if ohlcv is None or len(ohlcv) < 22:
        return False
    try:
        close_col = next((c for c in ohlcv.columns if "종가" in str(c)), None)
        vol_col = next((c for c in ohlcv.columns if "거래량" in str(c)), None)
        if not close_col or not vol_col:
            return False
        closes = ohlcv[close_col].astype(float)
        volumes = ohlcv[vol_col].astype(float)
        pct = (closes.iloc[-1] - closes.iloc[-2]) / closes.iloc[-2] * 100
        avg_vol = volumes.iloc[-21:-1].mean()
        return pct >= 3.0 and avg_vol > 0 and volumes.iloc[-1] >= avg_vol * 2
    except Exception:
        return False


# ── 데이터 로드 ───────────────────────────────────────────────

def _get_ohlcv(stock: dict) -> tuple[pd.Series | None, pd.DataFrame | None]:
    """(종가 시리즈, OHLCV DataFrame) 반환. US는 DataFrame None."""
    code = stock["code"]
    market = stock.get("market", "")
    try:
        if market == "KR":
            from pykrx import stock as pykrx_stock
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=400)).strftime("%Y%m%d")
            df = pykrx_stock.get_market_ohlcv_by_date(start, end, code)
            if df is None or df.empty:
                return None, None
            col = next((c for c in df.columns if "종가" in str(c)), None)
            return df[col].astype(float) if col else None, df
        else:
            import yfinance as yf
            hist = yf.Ticker(code).history(period="15mo", interval="1d")
            if hist is None or hist.empty:
                return None, None
            closes = hist["Close"].astype(float)
            # US OHLCV를 pykrx 스타일로 변환 (거래량 동반 급등용)
            df_fake = pd.DataFrame({
                "종가": hist["Close"], "거래량": hist["Volume"]
            })
            return closes, df_fake
    except Exception as exc:
        logger.debug("OHLCV 조회 실패 (%s): %s", code, exc)
        return None, None


# ── 신호 통합 ─────────────────────────────────────────────────

def get_technical_signals(stock: dict, today_str: str) -> list[dict]:
    """한 종목의 모든 기술적 신호 이벤트 반환."""
    closes, ohlcv = _get_ohlcv(stock)
    if closes is None or len(closes) < 30:
        return []

    code = stock["code"]
    name = stock.get("name") or code
    market = stock.get("market", "")
    events = []

    def _add(key_tag: str, signal_type: str, guide: str, value=None):
        key = f"{key_tag}:{code}:{today_str}"
        if not db.is_alert_sent(key):
            events.append({
                "code": code, "name": name, "market": market,
                "signal_type": signal_type, "guide": guide,
                "value": value, "alert_key": key,
            })

    # RSI
    rsi = _rsi(closes)
    if rsi is not None:
        if rsi <= Config.RSI_OVERSOLD:
            _add("RSI:OVER_SOLD", f"📉 RSI 과매도 ({rsi})",
                 "🟢 반등 가능 구간 — 분할 매수 관점 검토", rsi)
        elif rsi >= Config.RSI_OVERBOUGHT:
            _add("RSI:OVER_BOUGHT", f"📈 RSI 과매수 ({rsi})",
                 "🔴 과열 구간 — 차익 실현·비중 점검", rsi)

    # MA 크로스
    cross = _ma_cross(closes)
    if cross == "golden":
        _add("MA_CROSS:GOLDEN", "✨ 골든크로스 (5·20일선)",
             "🟢 단기 상승 추세 전환 — 추가 매수 타이밍 검토")
    elif cross == "dead":
        _add("MA_CROSS:DEAD", "💀 데드크로스 (5·20일선)",
             "🔴 단기 하락 추세 전환 — 손절·비중 축소 검토")

    # MACD
    macd = _macd_signal(closes)
    if macd == "bullish":
        _add("MACD:BULL", "📊 MACD 매수 신호",
             "🟢 모멘텀 상승 전환 — RSI·거래량 함께 확인 후 진입")
    elif macd == "bearish":
        _add("MACD:BEAR", "📊 MACD 매도 신호",
             "🔴 모멘텀 하락 전환 — 비중 축소·관망 고려")

    # 볼린저밴드
    bb = _bollinger(closes)
    if bb == "lower":
        _add("BB:LOWER", "📐 볼린저밴드 하단 터치",
             "🟢 과매도 밴드 — 단기 반등 가능, 손절선 설정 후 소량 진입")
    elif bb == "upper":
        _add("BB:UPPER", "📐 볼린저밴드 상단 터치",
             "🔴 과매수 밴드 — 단기 조정 가능, 차익 실현 검토")

    # 52주 신고가
    if _week52_high(closes):
        price = closes.iloc[-1]
        _add("W52:HIGH", "🏆 52주 신고가 돌파",
             f"🟢 강한 상승 모멘텀 — 추세 추종 관점 유효 ({price:,.0f}원)" if market == "KR"
             else f"🟢 강한 상승 모멘텀 — 추세 추종 관점 유효 (${price:,.2f})")

    # 거래량 동반 급등
    if ohlcv is not None and _volume_breakout(ohlcv):
        _add("VOL:BREAKOUT", "💥 거래량 동반 급등 (+3%·거래량 2배)",
             "🟢 강한 매수세 유입 신호 — 추가 상승 가능성 점검")

    return events

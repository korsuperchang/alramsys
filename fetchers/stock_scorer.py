"""종목별 종합 추세 점수 계산 (기술적 지표 기반)."""
import logging

logger = logging.getLogger(__name__)


def score_stock(stock: dict) -> dict | None:
    """기술적 지표를 집계해 점수·신호 요약 dict 반환. 데이터 부족 시 None."""
    from fetchers.technical import (
        _get_ohlcv, _rsi, _ma_cross, _macd_signal,
        _bollinger, _week52_high, _volume_breakout,
    )

    closes, ohlcv = _get_ohlcv(stock)
    if closes is None or len(closes) < 30:
        return None

    code    = stock["code"]
    name    = stock.get("name") or code
    market  = stock.get("market", "")
    score   = 0
    bull: list[str] = []
    bear: list[str] = []

    # RSI
    rsi = _rsi(closes)
    if rsi is not None:
        if rsi <= 30:
            score += 2; bull.append(f"RSI과매도({rsi:.0f})")
        elif rsi <= 45:
            score += 1; bull.append(f"RSI회복권({rsi:.0f})")
        elif rsi >= 75:
            score -= 1; bear.append(f"RSI과매수({rsi:.0f})")

    # MA 크로스 (5·20일)
    cross = _ma_cross(closes)
    if cross == "golden":
        score += 2; bull.append("골든크로스")
    elif cross == "dead":
        score -= 2; bear.append("데드크로스")

    # MACD
    macd = _macd_signal(closes)
    if macd == "bullish":
        score += 2; bull.append("MACD상향")
    elif macd == "bearish":
        score -= 2; bear.append("MACD하향")

    # 볼린저밴드
    bb = _bollinger(closes)
    if bb == "lower":
        score += 1; bull.append("볼린저하단")
    elif bb == "upper":
        score -= 1; bear.append("볼린저상단")

    # 52주 신고가
    if _week52_high(closes):
        score += 3; bull.append("52주신고가")

    # 거래량 동반 급등
    if ohlcv is not None and _volume_breakout(ohlcv):
        score += 2; bull.append("거래량급등")

    # 가격 vs MA20
    if len(closes) >= 20:
        ma20 = closes.rolling(20).mean().iloc[-1]
        if closes.iloc[-1] > ma20:
            score += 1; bull.append("MA20위")
        else:
            score -= 1; bear.append("MA20아래")

    # 5일 추세
    pct_5d = 0.0
    if len(closes) >= 6:
        pct_5d = (closes.iloc[-1] - closes.iloc[-6]) / closes.iloc[-6] * 100
        if pct_5d >= 5:
            score += 1; bull.append(f"5일+{pct_5d:.1f}%")
        elif pct_5d <= -5:
            score -= 1; bear.append(f"5일{pct_5d:.1f}%")

    price  = closes.iloc[-1]
    pct_1d = (closes.iloc[-1] - closes.iloc[-2]) / closes.iloc[-2] * 100 if len(closes) >= 2 else 0.0
    pct_20d = (closes.iloc[-1] - closes.iloc[-21]) / closes.iloc[-21] * 100 if len(closes) >= 21 else 0.0

    return {
        "code": code, "name": name, "market": market,
        "score": score,
        "bull_signals": bull,
        "bear_signals": bear,
        "price": price,
        "pct_1d":  round(pct_1d,  2),
        "pct_5d":  round(pct_5d,  2),
        "pct_20d": round(pct_20d, 2),
        "rsi": rsi,
    }

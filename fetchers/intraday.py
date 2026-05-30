"""장중 급등락 감지 (관심종목 실시간 변동률 모니터링)."""
import logging

import yfinance as yf

from config import Config
from db import database as db
from fetchers.krx import get_yf_ticker

logger = logging.getLogger(__name__)


def _band(pct: float) -> int:
    """변동률을 임계값 단위 밴드로 변환. 예) 임계 5% → ±5,±10,±15..."""
    step = Config.INTRADAY_SPIKE_PCT
    return int(abs(pct) // step) * int(step)


def _fetch_changes(stocks: list[dict]) -> dict[str, dict]:
    """관심종목들의 전일 종가 대비 현재 변동률 조회."""
    result: dict[str, dict] = {}
    if not stocks:
        return result

    code_map = {get_yf_ticker(s["code"]): s for s in stocks}
    yf_tickers = list(code_map.keys())

    try:
        data = yf.download(yf_tickers, period="2d", interval="1d",
                           auto_adjust=True, progress=False, threads=True)
        close = data.get("Close")
        if close is None or close.empty:
            return result

        for yt, stock in code_map.items():
            try:
                col = close[yt] if len(yf_tickers) > 1 else close
                col = col.dropna()
                if len(col) < 2:
                    continue
                prev = float(col.iloc[-2])
                curr = float(col.iloc[-1])
                if prev <= 0:
                    continue
                pct = (curr - prev) / prev * 100
                result[stock["code"]] = {
                    "name": stock.get("name") or stock["code"],
                    "price": curr, "pct": round(pct, 2),
                    "market": stock.get("market", ""),
                }
            except Exception as exc:
                logger.debug("장중 변동 파싱 실패 (%s): %s", yt, exc)
    except Exception as exc:
        logger.warning("장중 변동 조회 실패: %s", exc)

    return result


def get_spike_events(stocks: list[dict], today_str: str) -> list[dict]:
    """임계값(밴드)을 새로 돌파한 종목의 급등락 이벤트 반환."""
    events = []
    changes = _fetch_changes(stocks)

    for code, d in changes.items():
        pct = d["pct"]
        if abs(pct) < Config.INTRADAY_SPIKE_PCT:
            continue
        band = _band(pct)
        direction = "급등" if pct > 0 else "급락"
        # 밴드+방향별로 하루 한 번만 알림 (예: -5%, -10% 각각)
        alert_key = f"SPIKE:{code}:{today_str}:{direction}:{band}"
        if db.is_alert_sent(alert_key):
            continue
        events.append({
            "code": code,
            "name": d["name"],
            "market": d["market"],
            "pct": pct,
            "price": d["price"],
            "direction": direction,
            "band": band,
            "alert_key": alert_key,
        })

    return events

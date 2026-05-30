"""신규 종목 발굴 스크리너 (거래대금 + 등락률 + 외국인 순매수 교차)."""
import logging

from config import Config
from db import database as db

logger = logging.getLogger(__name__)


def _find_col(df, *keywords):
    for kw in keywords:
        for col in df.columns:
            if kw in str(col):
                return col
    return None


def _scan_market(pykrx_stock, date_str: str, market: str,
                 owned: set[str]) -> list[dict]:
    """단일 시장(KOSPI/KOSDAQ)에서 후보 종목 발굴."""
    candidates = []
    try:
        ohlcv = pykrx_stock.get_market_ohlcv(date_str, market=market)
        if ohlcv is None or ohlcv.empty:
            return []

        val_col = _find_col(ohlcv, "거래대금")
        pct_col = _find_col(ohlcv, "등락률")
        close_col = _find_col(ohlcv, "종가")
        if not (val_col and pct_col and close_col):
            return []

        # 외국인 순매수 (실패해도 가격/거래대금만으로 진행)
        net_map: dict[str, float] = {}
        try:
            net = pykrx_stock.get_market_net_purchases_of_equities(
                date_str, date_str, market, "외국인")
            if net is not None and not net.empty:
                ncol = _find_col(net, "순매수거래대금")
                if ncol:
                    net_map = net[ncol].to_dict()
        except Exception as exc:
            logger.debug("외국인 순매수 조회 실패 (%s): %s", market, exc)

        min_val = Config.SCREENER_MIN_VALUE_EOK * 1_0000_0000

        for ticker, row in ohlcv.iterrows():
            if ticker in owned:
                continue
            try:
                pct = float(row[pct_col])
                value = float(row[val_col])
                close = float(row[close_col])
            except (ValueError, TypeError):
                continue

            if not (Config.SCREENER_MIN_PCT <= pct <= Config.SCREENER_MAX_PCT):
                continue
            if value < min_val:
                continue

            foreign_net = net_map.get(ticker, 0)
            # 점수: 외국인 순매수가 있으면 가산, 거래대금·등락률 반영
            score = pct + (value / min_val) + (5 if foreign_net > 0 else 0)

            try:
                name = pykrx_stock.get_market_ticker_name(ticker)
            except Exception:
                name = ticker

            candidates.append({
                "code": ticker, "name": name, "market_kr": market,
                "pct": round(pct, 2), "value": value, "close": close,
                "foreign_net": foreign_net, "score": score,
            })
    except Exception as exc:
        logger.warning("스크리너 시장 스캔 실패 (%s): %s", market, exc)

    return candidates


def find_new_candidates() -> list[dict]:
    """오늘(최근 거래일) 기준 신규 발굴 후보 상위 N개 반환."""
    try:
        from pykrx import stock as pykrx_stock
    except ImportError:
        logger.warning("pykrx 미설치: 스크리너 불가")
        return []

    try:
        date_str = pykrx_stock.get_nearest_business_day_in_a_week()
    except Exception as exc:
        logger.warning("최근 거래일 조회 실패: %s", exc)
        return []

    owned = {s["code"] for s in db.get_kr_stocks()}

    all_candidates = []
    for market in ("KOSPI", "KOSDAQ"):
        all_candidates.extend(_scan_market(pykrx_stock, date_str, market, owned))

    all_candidates.sort(key=lambda x: x["score"], reverse=True)
    return all_candidates[:Config.SCREENER_TOP_N]

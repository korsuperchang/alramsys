"""관심종목 당일 등락률 조회."""
import logging
from datetime import datetime, timedelta

import yfinance as yf

logger = logging.getLogger(__name__)


def get_kr_prices(stocks: list[dict]) -> list[dict]:
    """국내 관심종목 당일 종가 및 등락률 조회 (pykrx)."""
    results = []
    if not stocks:
        return results
    try:
        from pykrx import stock as pykrx_stock
        end   = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")

        for s in stocks:
            code = s["code"]
            name = s.get("name") or code
            try:
                df = pykrx_stock.get_market_ohlcv_by_date(start, end, code)
                if df is None or df.empty or len(df) < 2:
                    continue
                prev = float(df["종가"].iloc[-2])
                curr = float(df["종가"].iloc[-1])
                pct  = (curr - prev) / prev * 100 if prev else 0.0
                results.append({"code": code, "name": name,
                                 "price": curr, "pct": round(pct, 2)})
            except Exception as exc:
                logger.debug("KR 가격 조회 실패 (%s): %s", code, exc)
    except Exception as exc:
        logger.warning("KR 가격 전체 조회 실패: %s", exc)

    return sorted(results, key=lambda x: x["pct"], reverse=True)


def get_us_prices(stocks: list[dict]) -> list[dict]:
    """미국 관심종목 당일 종가 및 등락률 조회 (yfinance)."""
    results = []
    if not stocks:
        return results

    tickers = [s["code"] for s in stocks]
    name_map = {s["code"]: s.get("name") or s["code"] for s in stocks}

    try:
        data = yf.download(tickers, period="2d", interval="1d",
                           auto_adjust=True, progress=False)
        close = data.get("Close")
        if close is None or close.empty:
            raise ValueError("빈 데이터")

        for code in tickers:
            try:
                col = close[code] if len(tickers) > 1 else close
                col = col.dropna()
                if len(col) < 2:
                    continue
                prev = float(col.iloc[-2])
                curr = float(col.iloc[-1])
                pct  = (curr - prev) / prev * 100 if prev else 0.0
                results.append({"code": code, "name": name_map[code],
                                 "price": curr, "pct": round(pct, 2)})
            except Exception as exc:
                logger.debug("US 가격 파싱 실패 (%s): %s", code, exc)
    except Exception as exc:
        logger.warning("US 가격 전체 조회 실패: %s", exc)
        # 개별 조회 폴백
        for s in stocks:
            code = s["code"]
            try:
                hist = yf.Ticker(code).history(period="2d", interval="1d")
                if len(hist) < 2:
                    continue
                prev = float(hist["Close"].iloc[-2])
                curr = float(hist["Close"].iloc[-1])
                pct  = (curr - prev) / prev * 100 if prev else 0.0
                results.append({"code": code, "name": name_map[code],
                                 "price": curr, "pct": round(pct, 2)})
            except Exception as e:
                logger.debug("US 개별 조회 실패 (%s): %s", code, e)

    return sorted(results, key=lambda x: x["pct"], reverse=True)

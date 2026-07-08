"""
현재가 조회 모듈 — '조회하는 시점'에만 시세를 가져옴 (상시 폴링 없음)

시장별 소스:
- KOSPI/KOSDAQ: 네이버 금융 실시간 시세 API (개인 조회용, 요청 1회로 다종목 조회)
                실패 시 pykrx 최근 종가로 폴백
- NASDAQ: yfinance fast_info (약 15분 지연) → 실패 시 최근 종가로 폴백

반환 형식 (get_quotes):
    {ticker: {"price": 현재가, "prev_close": 전일종가, "source": 출처}}
    조회 실패 종목은 결과에서 빠짐 (dashboard가 '조회불가'로 표시)
"""

import numpy as np


NAVER_POLLING_URL = "https://polling.finance.naver.com/api/realtime"
_UA = {"User-Agent": "Mozilla/5.0 (personal portfolio viewer)"}


# ─────────────────────────────────────────────
def get_quotes(market: str, tickers: list[str],
               demo: bool = False, demo_hint: dict | None = None) -> dict:
    if not tickers:
        return {}
    if demo:
        return _demo_quotes(tickers, demo_hint)
    if market in ("KOSPI", "KOSDAQ"):
        q = _naver_quotes(tickers)
        missing = [t for t in tickers if t not in q]
        if missing:
            q.update(_pykrx_close(missing))
        return q
    if market == "NASDAQ":
        return _yf_quotes(tickers)
    raise ValueError(f"지원하지 않는 시장: {market}")


# ─────────────────────────────────────────────
def _naver_quotes(tickers: list[str]) -> dict:
    """네이버 실시간 시세: nv=현재가, sv=전일종가 (장 중 실시간, 장 마감 후 종가)"""
    import requests
    try:
        query = "SERVICE_ITEM:" + ",".join(tickers)
        r = requests.get(NAVER_POLLING_URL, params={"query": query},
                         headers=_UA, timeout=10)
        r.raise_for_status()
        body = r.json()
        out = {}
        for area in body.get("result", {}).get("areas", []):
            for d in area.get("datas", []):
                if d.get("nv"):
                    out[d["cd"]] = {"price": float(d["nv"]),
                                    "prev_close": float(d.get("sv") or "nan"),
                                    "source": "네이버(실시간)"}
        return out
    except Exception:
        return {}


def _pykrx_close(tickers: list[str]) -> dict:
    """폴백: pykrx 최근 종가 (당일 장 마감 전이면 전 영업일 종가)"""
    try:
        import pandas as pd
        from pykrx import stock as krx
    except ImportError:
        return {}
    end = pd.Timestamp.today()
    start = (end - pd.Timedelta(days=10)).strftime("%Y%m%d")
    out = {}
    for t in tickers:
        try:
            df = krx.get_market_ohlcv(start, end.strftime("%Y%m%d"), t)
            if len(df) >= 1:
                out[t] = {
                    "price": float(df["종가"].iloc[-1]),
                    "prev_close": float(df["종가"].iloc[-2]) if len(df) >= 2
                    else float("nan"),
                    "source": "KRX(종가)",
                }
        except Exception:
            continue
    return out


def _yf_quotes(tickers: list[str]) -> dict:
    try:
        import yfinance as yf
    except ImportError:
        return {}
    out = {}
    for t in tickers:
        try:
            fi = yf.Ticker(t).fast_info
            price = fi["last_price"]
            if price is None:
                continue
            out[t] = {"price": float(price),
                      "prev_close": float(fi["previous_close"] or "nan"),
                      "source": "Yahoo(지연시세)"}
        except Exception:
            continue
    return out


# ─────────────────────────────────────────────
def _demo_quotes(tickers: list[str], hint: dict | None) -> dict:
    """
    데모: 평균매입가(hint) 주변 ±수%의 합성 현재가 생성
    조회할 때마다 값이 조금씩 달라져서 '조회 시점 갱신' 동작을 확인할 수 있음
    """
    rng = np.random.default_rng()
    out = {}
    for t in tickers:
        base = (hint or {}).get(t, 10_000.0)
        prev = base * (1 + rng.normal(0, 0.02))
        out[t] = {"price": round(prev * (1 + rng.normal(0.002, 0.015)), 2),
                  "prev_close": round(prev, 2),
                  "source": "DEMO(합성)"}
    return out

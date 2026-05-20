"""yfinance 기반 주요 시장 지표 조회 및 이상 징후 감지."""
import logging

import yfinance as yf

logger = logging.getLogger(__name__)

SYMBOLS = {
    "kospi":  "^KS11",
    "kosdaq": "^KQ11",
    "sp500":  "^GSPC",
    "nasdaq": "^IXIC",
    "dow":    "^DJI",
    "vix":    "^VIX",
    "tnx":    "^TNX",      # 미국 10년물 금리 (%)
    "dxy":    "DX-Y.NYB",  # 달러인덱스
    "krw":    "KRW=X",     # 원달러 (USD 1 = KRW X)
    "oil":    "CL=F",      # WTI 유가
}


def get_snapshot() -> dict:
    """주요 지표 현재값 + 전일 대비 변화율 반환."""
    result = {}
    for key, sym in SYMBOLS.items():
        try:
            hist = yf.Ticker(sym).history(period="2d", interval="1d")
            if len(hist) >= 2:
                prev = float(hist["Close"].iloc[-2])
                curr = float(hist["Close"].iloc[-1])
                pct  = (curr - prev) / prev * 100 if prev else 0.0
                result[key] = {"value": curr, "prev": prev, "pct": pct}
            elif len(hist) == 1:
                curr = float(hist["Close"].iloc[-1])
                result[key] = {"value": curr, "prev": curr, "pct": 0.0}
        except Exception as exc:
            logger.debug("지표 조회 실패 (%s): %s", sym, exc)
    return result


def check_anomalies(snap: dict, cfg: dict) -> list[dict]:
    """
    임계값 초과 이상 징후 목록 반환.
    cfg keys: kospi_drop, kosdaq_drop, vix_level, vix_spike, krw_spike, tnx_spike_bp
    """
    anomalies = []

    def _check(key, label, condition_fn, direction):
        d = snap.get(key)
        if d and condition_fn(d):
            anomalies.append({
                "indicator": key,
                "label":     label,
                "value":     d["value"],
                "prev":      d["prev"],
                "pct":       d["pct"],
                "direction": direction,
            })

    _check("kospi",  "코스피",
           lambda d: d["pct"] <= cfg.get("kospi_drop",  -3.0), "급락")
    _check("kosdaq", "코스닥",
           lambda d: d["pct"] <= cfg.get("kosdaq_drop", -3.0), "급락")
    _check("vix",    "VIX",
           lambda d: d["value"] >= cfg.get("vix_level", 30.0)
                  or d["pct"]   >= cfg.get("vix_spike", 20.0), "급등")
    _check("krw",    "원달러",
           lambda d: d["pct"] >= cfg.get("krw_spike",  1.0), "급등")

    # 10년물: bp 단위 변화
    tnx = snap.get("tnx")
    if tnx:
        bp = (tnx["value"] - tnx["prev"]) * 100
        if bp >= cfg.get("tnx_spike_bp", 10.0):
            anomalies.append({
                "indicator": "tnx",
                "label":     "미국 10년물",
                "value":     tnx["value"],
                "prev":      tnx["prev"],
                "pct":       tnx["pct"],
                "direction": "급등",
                "bp":        round(bp, 1),
            })

    return anomalies

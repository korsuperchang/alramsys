"""pykrx 기반 KOSPI 섹터 성과 및 시장 수급 조회."""
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# KOSPI 섹터 인덱스 코드 (KRX 공식)
SECTOR_INDICES = {
    "1028": "IT·반도체",
    "1030": "에너지·화학",
    "1034": "산업재·방산",
    "1036": "헬스케어·바이오",
    "1037": "금융",
    "1038": "커뮤니케이션",
}


def _lookback(days: int = 10) -> tuple[str, str]:
    end   = datetime.now()
    start = end - timedelta(days=days)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def get_sector_performance() -> list[dict]:
    """오늘의 KOSPI 섹터별 등락률 반환 (내림차순)."""
    results = []
    try:
        from pykrx import stock
        start, end = _lookback(10)

        for code, label in SECTOR_INDICES.items():
            try:
                df = stock.get_index_ohlcv_by_date(start, end, code)
                if df is None or df.empty or len(df) < 2:
                    continue
                prev = float(df["종가"].iloc[-2])
                curr = float(df["종가"].iloc[-1])
                if prev > 0:
                    pct = (curr - prev) / prev * 100
                    results.append({"sector": label, "pct": round(pct, 2)})
            except Exception as exc:
                logger.debug("섹터 조회 실패 (%s %s): %s", code, label, exc)

    except ImportError:
        logger.warning("pykrx 미설치: 섹터 조회 불가")
    except Exception as exc:
        logger.warning("섹터 성과 조회 실패: %s", exc)

    return sorted(results, key=lambda x: x["pct"], reverse=True)


def get_market_flow() -> dict:
    """코스피 외국인·기관 당일 순매수 금액(원) 반환."""
    result = {}
    try:
        from pykrx import stock
        start, end = _lookback(5)

        df = stock.get_market_trading_value_by_investor(start, end, "KOSPI")
        if df is None or df.empty:
            return result

        row = df.iloc[-1]
        for col in df.columns:
            col_str = str(col)
            if "외국인" in col_str:
                result["foreign"] = int(row[col])
            elif "기관" in col_str and "기타" not in col_str:
                result["institution"] = int(row[col])

    except Exception as exc:
        logger.debug("시장 수급 조회 실패: %s", exc)

    return result

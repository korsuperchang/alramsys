"""pykrx 를 이용한 국내 주식 정보 조회."""
import logging

logger = logging.getLogger(__name__)

_name_cache: dict[str, str] = {}


def get_stock_name(code: str) -> str | None:
    """6자리 종목코드로 한국 주식 이름 조회."""
    if code in _name_cache:
        return _name_cache[code]

    try:
        from pykrx import stock as pykrx_stock
        name = pykrx_stock.get_market_ticker_name(code)
        if name:
            _name_cache[code] = name
            return name
    except Exception as exc:
        logger.debug("pykrx 종목명 조회 실패 (%s): %s", code, exc)

    return None


def validate_kr_code(code: str) -> bool:
    """6자리 숫자인지 + KRX 상장 여부 확인."""
    if not (code.isdigit() and len(code) == 6):
        return False
    return get_stock_name(code) is not None


def is_kr_code(code: str) -> bool:
    """6자리 숫자면 국내 주식 코드로 판단."""
    return code.isdigit() and len(code) == 6


_market_cache: dict[str, str] = {}  # code -> "KS" / "KQ"


def _load_market_map():
    """KOSPI/KOSDAQ 티커 목록을 한 번 로드해 캐시."""
    if _market_cache:
        return
    try:
        from pykrx import stock as pykrx_stock
        from datetime import datetime
        today = datetime.now().strftime("%Y%m%d")
        for mkt, suffix in [("KOSPI", "KS"), ("KOSDAQ", "KQ")]:
            try:
                for t in pykrx_stock.get_market_ticker_list(today, market=mkt):
                    _market_cache[t] = suffix
            except Exception as exc:
                logger.debug("티커 목록 로드 실패 (%s): %s", mkt, exc)
    except Exception as exc:
        logger.debug("시장 맵 로드 실패: %s", exc)


def get_yf_ticker(code: str) -> str:
    """국내 6자리 코드를 yfinance 형식(005930.KS / 263750.KQ)으로 변환.

    미국 티커는 그대로 반환.
    """
    if not is_kr_code(code):
        return code
    _load_market_map()
    suffix = _market_cache.get(code, "KS")  # 기본 KOSPI
    return f"{code}.{suffix}"

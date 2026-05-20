"""pykrx / FinanceDataReader 를 이용한 국내 주식 정보 조회."""
import logging

logger = logging.getLogger(__name__)

_name_cache: dict[str, str] = {}


def get_stock_name(code: str) -> str | None:
    """6자리 종목코드로 한국 주식 이름 조회."""
    if code in _name_cache:
        return _name_cache[code]

    # pykrx 우선
    try:
        from pykrx import stock as pykrx_stock
        name = pykrx_stock.get_market_ticker_name(code)
        if name:
            _name_cache[code] = name
            return name
    except Exception as exc:
        logger.debug("pykrx 종목명 조회 실패 (%s): %s", code, exc)

    # FinanceDataReader 폴백
    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("KRX")
        row = df[df["Code"] == code]
        if not row.empty:
            name = row.iloc[0]["Name"]
            _name_cache[code] = name
            return name
    except Exception as exc:
        logger.debug("FDR 종목명 조회 실패 (%s): %s", code, exc)

    return None


def validate_kr_code(code: str) -> bool:
    """6자리 숫자인지 + KRX 상장 여부 확인."""
    if not (code.isdigit() and len(code) == 6):
        return False
    return get_stock_name(code) is not None


def is_kr_code(code: str) -> bool:
    """6자리 숫자면 국내 주식 코드로 판단."""
    return code.isdigit() and len(code) == 6

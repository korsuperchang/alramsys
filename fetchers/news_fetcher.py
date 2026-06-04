"""관심종목 최근 뉴스 헤드라인 수집 (네이버 금융 / yfinance)."""
import logging
from datetime import datetime

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def get_kr_news(code: str, max_items: int = 5) -> list[str]:
    """네이버 금융 종목 뉴스 헤드라인 반환."""
    try:
        url = f"https://finance.naver.com/item/news_news.naver?code={code}"
        resp = requests.get(url, headers=_HEADERS, timeout=8)
        resp.encoding = "euc-kr"
        soup = BeautifulSoup(resp.text, "html.parser")
        headlines = []
        for td in soup.select("td.title"):
            a = td.find("a")
            if a:
                title = a.get_text(strip=True)
                if title and len(title) > 5:
                    headlines.append(title)
                    if len(headlines) >= max_items:
                        break
        return headlines
    except Exception as exc:
        logger.debug("네이버 뉴스 조회 실패 (%s): %s", code, exc)
        return []


def get_us_news(code: str, max_items: int = 5) -> list[str]:
    """yfinance 뉴스 헤드라인 반환 (3일 이내)."""
    try:
        import yfinance as yf
        cutoff = datetime.now().timestamp() - 3 * 86400
        headlines = []
        for n in yf.Ticker(code).news or []:
            if n.get("providerPublishTime", 0) >= cutoff:
                title = n.get("title", "")
                if title:
                    headlines.append(title)
                    if len(headlines) >= max_items:
                        break
        return headlines
    except Exception as exc:
        logger.debug("US 뉴스 조회 실패 (%s): %s", code, exc)
        return []


def get_stock_news(stock: dict, max_items: int = 5) -> list[str]:
    code = stock["code"]
    if stock.get("market") == "KR":
        return get_kr_news(code, max_items)
    return get_us_news(code, max_items)

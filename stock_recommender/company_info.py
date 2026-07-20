"""
업체정보(기업개요) 조회 — 추천 종목이 뭐 하는 회사인지 한 줄 표시

소스: 네이버 금융 종목 페이지의 기업개요 텍스트
캐시: .cache/company_desc.json  (업체정보는 거의 안 바뀌므로 장기 캐시)
"""

import json
import re
from pathlib import Path

import requests

from cache import CACHE_DIR

_CACHE_PATH = CACHE_DIR / "company_desc.json"
_cache: dict[str, str] = {}
_loaded = False
_UA = {"User-Agent": "Mozilla/5.0 (personal portfolio viewer)"}


def _load_cache():
    global _cache, _loaded
    if _loaded:
        return
    if _CACHE_PATH.exists():
        try:
            _cache = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            _cache = {}
    _loaded = True


def _save_cache():
    CACHE_DIR.mkdir(exist_ok=True)
    _CACHE_PATH.write_text(
        json.dumps(_cache, ensure_ascii=False, indent=1), encoding="utf-8")


def _fetch_from_naver(ticker: str) -> str | None:
    """네이버 금융 종목 페이지에서 기업개요 파싱"""
    try:
        url = f"https://finance.naver.com/item/main.naver?code={ticker}"
        r = requests.get(url, headers=_UA, timeout=10)
        r.raise_for_status()
        html = r.text

        # 방법 1: summary_info 영역 (기업개요 요약 한 줄)
        m = re.search(
            r'<p\s+class="summary_info"[^>]*>(.*?)</p>', html, re.DOTALL)
        if m:
            text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if len(text) >= 5:
                return text

        # 방법 2: wrap_company 내부 기업개요 텍스트
        m = re.search(
            r'class="wrap_company".*?<p>(.*?)</p>', html, re.DOTALL)
        if m:
            text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if len(text) >= 5:
                return text

        # 방법 3: meta description
        m = re.search(
            r'<meta\s+name="description"\s+content="([^"]+)"', html)
        if m:
            text = m.group(1).strip()
            if "종목" not in text[:10] and len(text) >= 10:
                return text

    except Exception:
        pass
    return None


def _fetch_from_naver_mobile(ticker: str) -> str | None:
    """네이버 모바일 증권 API에서 기업개요"""
    try:
        url = f"https://m.stock.naver.com/api/stock/{ticker}/integration"
        r = requests.get(url, headers=_UA, timeout=10)
        if r.status_code != 200:
            return None
        data = r.json()
        for info in data.get("totalInfos", []):
            if info.get("code") == "overview":
                desc = info.get("value", "")
                if desc and len(desc) >= 5:
                    return desc.strip()
        corp = data.get("corporationSummary") or data.get("description")
        if corp and len(str(corp)) >= 5:
            return str(corp).strip()
    except Exception:
        pass
    return None


def _fetch_from_navercomp(ticker: str) -> str | None:
    """네이버 CompanyGuide (wisereport) 기업개요"""
    try:
        url = (f"https://navercomp.wisereport.co.kr/v2/company/"
               f"c1010001.aspx?cmp_cd={ticker}")
        r = requests.get(url, headers=_UA, timeout=10)
        r.raise_for_status()
        m = re.search(
            r'기업개요.*?<td[^>]*>(.*?)</td>', r.text, re.DOTALL)
        if m:
            text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            text = re.sub(r'\s+', ' ', text)
            if len(text) >= 5:
                return text[:200]
    except Exception:
        pass
    return None


def get_company_desc(ticker: str) -> str | None:
    _load_cache()
    if ticker in _cache:
        return _cache[ticker]

    desc = (_fetch_from_naver(ticker)
            or _fetch_from_naver_mobile(ticker)
            or _fetch_from_navercomp(ticker))

    if desc:
        desc = desc[:200]
        _cache[ticker] = desc
        _save_cache()
    return desc


def get_company_descs(tickers: list[str]) -> dict[str, str]:
    """여러 종목의 업체정보를 한 번에 조회 (캐시 활용)"""
    _load_cache()
    result = {}
    to_fetch = []
    for t in tickers:
        if t in _cache:
            result[t] = _cache[t]
        else:
            to_fetch.append(t)

    for t in to_fetch:
        desc = (_fetch_from_naver(t)
                or _fetch_from_naver_mobile(t)
                or _fetch_from_navercomp(t))
        if desc:
            desc = desc[:200]
            _cache[t] = desc
            result[t] = desc

    if to_fetch:
        _save_cache()
    return result

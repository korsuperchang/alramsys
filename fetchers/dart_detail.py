"""DART 공시 문서 상세 파싱 모듈."""
import io
import logging
import re
import zipfile

import requests
from bs4 import BeautifulSoup

from config import Config

logger = logging.getLogger(__name__)

DART_BASE = "https://opendart.fss.or.kr/api"


def _fetch_html(rcept_no: str) -> str | None:
    if not Config.DART_API_KEY:
        return None
    try:
        resp = requests.get(
            f"{DART_BASE}/document.xml",
            params={"rcpNo": rcept_no, "crtfc_key": Config.DART_API_KEY},
            timeout=15,
        )
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            htm_files = [n for n in zf.namelist() if n.lower().endswith(".htm")]
            if not htm_files:
                return None
            largest = max(htm_files, key=lambda n: zf.getinfo(n).file_size)
            raw = zf.read(largest)
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("euc-kr", errors="replace")
    except Exception as exc:
        logger.debug("DART 문서 fetch 실패 (%s): %s", rcept_no, exc)
        return None


def _extract_table_pairs(html: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    try:
        soup = BeautifulSoup(html, "html.parser")
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all(["td", "th"])
                for i in range(len(cells) - 1):
                    key = cells[i].get_text(separator=" ", strip=True)
                    val = cells[i + 1].get_text(separator=" ", strip=True)
                    if key:
                        pairs[key] = val
    except Exception as exc:
        logger.debug("테이블 파싱 실패: %s", exc)
    return pairs


def _normalize_key(key: str) -> str:
    return re.sub(r"[\s()\[\]·\-_.※]", "", key)


def _find(pairs: dict[str, str], *keywords: str) -> str | None:
    norm_map = {_normalize_key(k): v for k, v in pairs.items()}
    for kw in keywords:
        nkw = _normalize_key(kw)
        for nk, v in norm_map.items():
            if nkw in nk or nk in nkw:
                return v
    return None


def _parse_amount(s: str) -> int | None:
    if not s:
        return None
    try:
        digits = re.sub(r"[^\d]", "", s)
        return int(digits) if digits else None
    except Exception:
        return None


def format_krw(amount: int) -> tuple[str, str]:
    if amount >= 1_0000_0000_0000:
        jo = amount / 1_0000_0000_0000
        kr = f"{jo:.1f}조원".rstrip("0").rstrip(".")
        if jo == int(jo):
            kr = f"{int(jo)}조원"
        en = f"KRW {jo:.1f}T"
        return kr, en
    if amount >= 1_0000_0000:
        eok = amount / 1_0000_0000
        if eok == int(eok):
            kr = f"{int(eok)}억원"
            en = f"KRW {int(eok)}B"
        else:
            kr = f"{eok:.1f}억원"
            en = f"KRW {eok:.1f}B"
        return kr, en
    if amount >= 1_0000:
        man = amount / 1_0000
        if man == int(man):
            kr = f"{int(man)}만원"
            en = f"KRW {int(man)}M"
        else:
            kr = f"{man:.1f}만원"
            en = f"KRW {man:.1f}M"
        return kr, en
    return f"{amount}원", f"KRW {amount}"


def parse_contract(pairs: dict[str, str]) -> dict:
    partner = _find(pairs, "계약상대방", "거래상대방", "계약상대")
    amount_raw = _find(pairs, "계약금액", "공급금액")
    revenue_ratio_raw = _find(pairs, "계약금액매출액", "매출액대비", "매출액비율")

    result: dict = {}
    if partner:
        result["partner"] = partner.strip()

    if amount_raw:
        amount_int = _parse_amount(amount_raw)
        if amount_int:
            kr, en = format_krw(amount_int)
            result["amount_kr"] = kr
            result["amount_en"] = en

    if revenue_ratio_raw:
        m = re.search(r"[\d.]+", revenue_ratio_raw)
        if m:
            result["revenue_ratio"] = m.group(0)

    return result


def parse_rights_offering(pairs: dict[str, str]) -> dict:
    record_date_raw = _find(pairs, "신주배정기준일", "기준일")
    allot_ratio_raw = _find(pairs, "배정비율", "1주당배정", "주당배정")
    method_raw = _find(pairs, "증자방식", "발행방법")
    issue_price_raw = _find(pairs, "발행가액", "신주발행가액", "주당발행가액")

    result: dict = {}

    if record_date_raw:
        m = re.search(r"(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})", record_date_raw)
        if m:
            result["record_date"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    if allot_ratio_raw:
        result["allot_ratio"] = allot_ratio_raw.strip()

    if method_raw:
        result["method"] = method_raw.strip()

    if issue_price_raw:
        result["issue_price_raw"] = issue_price_raw.strip()

    return result


def detect_report_type(report_nm: str) -> str:
    clean = report_nm.replace(" ", "").replace("ㆍ", "").replace("·", "")
    if "단일판매" in clean or "공급계약" in clean:
        return "contract"
    if "유상증자" in clean or "무상증자" in clean:
        return "rights"
    return "other"


def get_disclosure_detail(rcept_no: str, report_type: str) -> dict:
    if not Config.DART_API_KEY:
        return {}
    try:
        html = _fetch_html(rcept_no)
        if not html:
            return {}
        pairs = _extract_table_pairs(html)
        if not pairs:
            return {}
        if report_type == "contract":
            return parse_contract(pairs)
        if report_type == "rights":
            return parse_rights_offering(pairs)
        return {}
    except Exception as exc:
        logger.debug("공시 상세 파싱 실패 (%s): %s", rcept_no, exc)
        return {}

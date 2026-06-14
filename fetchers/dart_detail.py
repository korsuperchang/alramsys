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
        logger.warning("DART 문서 fetch 실패 (%s): %s", rcept_no, exc)
        return None


def _extract_table_pairs(html: str) -> dict[str, str]:
    """테이블에서 키-값 쌍 추출.

    DART 공시는 여러 레이아웃이 섞여 있으므로 우선순위대로 수집한다
    (먼저 넣은 쌍이 _find 에서 우선 매칭됨):
    1. 2셀 행 → key:val (가장 신뢰도 높음)
    2. 컬럼 정렬: 같은 셀 수의 연속 두 행 → 헤더[j]:값[j]
       (계약금액·매출액대비 등 '헤더 위 / 값 아래' 표 처리)
    3. 4열 이상 짝수 행 → [k,v,k,v] 가로 패턴
    4. 인접 단일셀 행 쌍
    """
    pairs: dict[str, str] = {}

    def _put(key: str, val: str):
        # 먼저 넣은 신뢰도 높은 쌍을 덮어쓰지 않음
        if key and key not in pairs:
            pairs[key] = val

    try:
        soup = BeautifulSoup(html, "html.parser")
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            row_cells: list[list[str]] = []
            for row in rows:
                cells = row.find_all(["td", "th"])
                texts = [c.get_text(separator=" ", strip=True) for c in cells]
                row_cells.append(texts)

            # 1. 2셀 행 → key:val
            for texts in row_cells:
                if len(texts) == 2 and texts[0]:
                    _put(texts[0], texts[1])

            # 2. 컬럼 정렬 (연속 두 행이 같은 셀 수, 2~6칸)
            for i in range(len(row_cells) - 1):
                top, bot = row_cells[i], row_cells[i + 1]
                if 2 <= len(top) <= 6 and len(top) == len(bot):
                    for j in range(len(top)):
                        if top[j] and bot[j] and top[j] != bot[j]:
                            _put(top[j], bot[j])

            # 3. 4열 이상 짝수 행 → [k,v,k,v]
            for texts in row_cells:
                n = len(texts)
                if n >= 4 and n % 2 == 0:
                    for j in range(0, n - 1, 2):
                        if texts[j]:
                            _put(texts[j], texts[j + 1])

            # 4. 인접 단일셀 행 쌍
            for i in range(len(row_cells) - 1):
                if len(row_cells[i]) == 1 and row_cells[i][0]:
                    if row_cells[i + 1]:
                        _put(row_cells[i][0], row_cells[i + 1][0])

    except Exception as exc:
        logger.warning("테이블 파싱 실패: %s", exc)
    return pairs


def _normalize_key(key: str) -> str:
    return re.sub(r"[\s()\[\]·\-_.※%원]", "", key)


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
    # 조/억/만 단위 직접 표기 처리
    s_clean = s.replace(",", "").replace(" ", "")
    m_jo = re.search(r"([\d.]+)조", s_clean)
    if m_jo:
        try:
            return int(float(m_jo.group(1)) * 1_0000_0000_0000)
        except ValueError:
            pass
    m_eok = re.search(r"([\d.]+)억", s_clean)
    if m_eok:
        try:
            return int(float(m_eok.group(1)) * 1_0000_0000)
        except ValueError:
            pass
    m_man = re.search(r"([\d.]+)만", s_clean)
    if m_man:
        try:
            return int(float(m_man.group(1)) * 1_0000)
        except ValueError:
            pass
    # 순수 숫자
    digits = re.sub(r"[^\d]", "", s)
    try:
        return int(digits) if digits else None
    except Exception:
        return None


def format_krw(amount: int) -> tuple[str, str]:
    if amount >= 1_0000_0000_0000:
        jo = amount / 1_0000_0000_0000
        kr = f"{int(jo)}조원" if jo == int(jo) else f"{jo:.1f}조원"
        en = f"KRW {jo:.1f}T"
        return kr, en
    if amount >= 1_0000_0000:
        eok = amount / 1_0000_0000
        kr = f"{int(eok)}억원" if eok == int(eok) else f"{eok:.1f}억원"
        en = f"KRW {int(eok)}B" if eok == int(eok) else f"KRW {eok:.1f}B"
        return kr, en
    if amount >= 1_0000:
        man = amount / 1_0000
        kr = f"{int(man)}만원" if man == int(man) else f"{man:.1f}만원"
        en = f"KRW {int(man)}M" if man == int(man) else f"KRW {man:.1f}M"
        return kr, en
    return f"{amount}원", f"KRW {amount}"


def _extract_amount_from_text(html: str) -> int | None:
    """HTML 전체에서 계약금액 패턴을 직접 추출 (테이블 파싱 실패 시 폴백)."""
    patterns = [
        r"계약금액[^0-9조억만원]{0,20}([\d,]+)원",
        r"계약금액[^0-9조억만원]{0,20}([\d.]+)억\s*원",
        r"계약금액[^0-9조억만원]{0,20}([\d.]+)조\s*원",
        r"공급금액[^0-9조억만원]{0,20}([\d,]+)원",
    ]
    text = BeautifulSoup(html, "html.parser").get_text(" ")
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return _parse_amount(m.group(0))
    return None


def _extract_ratio_from_text(html: str) -> str | None:
    """HTML 전체에서 매출액 대비 비율을 직접 추출."""
    text = BeautifulSoup(html, "html.parser").get_text(" ")
    patterns = [
        r"매출액\s*대비[^0-9]{0,10}([\d.]+)\s*%",
        r"최근\s*매출액\s*대비[^0-9]{0,10}([\d.]+)",
        r"매출액\s*비율[^0-9]{0,10}([\d.]+)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1)
    return None


def _extract_partner_from_text(html: str) -> str | None:
    """HTML 전체에서 계약상대방을 직접 추출."""
    text = BeautifulSoup(html, "html.parser").get_text(" ")
    patterns = [
        r"계약상대방\s*[:\s]\s*([^\n]{2,60}?)(?:\s{2,}|계약금액|공급금액|거래금액|매출액|$)",
        r"거래상대방\s*[:\s]\s*([^\n]{2,60}?)(?:\s{2,}|계약금액|공급금액|$)",
        r"계약상대방[^가-힣\w]{0,10}([가-힣\w()（）\s,\.\-&]+?)(?:\n|계약금액|공급금액|거래)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            val = m.group(1).strip().rstrip(",:").strip()
            if 2 <= len(val) <= 60:
                return val
    return None


def parse_contract(pairs: dict[str, str], html: str = "") -> dict:
    partner = _find(pairs,
                    "계약상대방", "거래상대방", "계약상대",
                    "상대방회사명", "상대방")
    amount_raw = _find(pairs,
                       "계약금액", "공급금액", "거래금액",
                       "계약총금액", "공급총금액")
    revenue_ratio_raw = _find(pairs,
                               "매출액대비", "최근매출액대비", "매출액비율",
                               "매출액에서차지하는비율", "비율")

    result: dict = {}

    if partner:
        result["partner"] = partner.strip()
    elif html:
        p = _extract_partner_from_text(html)
        if p:
            result["partner"] = p

    if amount_raw:
        amount_int = _parse_amount(amount_raw)
        if amount_int:
            kr, en = format_krw(amount_int)
            result["amount_kr"] = kr
            result["amount_en"] = en
    elif html:
        amount_int = _extract_amount_from_text(html)
        if amount_int:
            kr, en = format_krw(amount_int)
            result["amount_kr"] = kr
            result["amount_en"] = en

    if revenue_ratio_raw:
        m = re.search(r"[\d.]+", revenue_ratio_raw)
        if m:
            result["revenue_ratio"] = m.group(0)
    elif html:
        ratio = _extract_ratio_from_text(html)
        if ratio:
            result["revenue_ratio"] = ratio

    return result


def parse_rights_offering(pairs: dict[str, str]) -> dict:
    record_date_raw = _find(pairs, "신주배정기준일", "기준일")
    allot_ratio_raw = _find(pairs, "배정비율", "1주당배정", "주당배정")
    method_raw      = _find(pairs, "증자방식", "발행방법")
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
        if report_type == "contract":
            return parse_contract(pairs, html)
        if report_type == "rights":
            return parse_rights_offering(pairs)
        return {}
    except Exception as exc:
        logger.warning("공시 상세 파싱 실패 (%s): %s", rcept_no, exc)
        return {}

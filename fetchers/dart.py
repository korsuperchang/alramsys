"""DART 전자공시 API 연동 모듈."""
import io
import logging
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import pandas as pd
import requests

from config import Config
from db import database as db
from fetchers.dart_detail import get_disclosure_detail, detect_report_type

logger = logging.getLogger(__name__)

DART_BASE = "https://opendart.fss.or.kr/api"

# 감시할 공시 유형 키워드 -> 한국어 레이블 매핑
KEYWORDS: dict[str, str] = {
    # 자본 관련
    "유상증자결정":           "📢 유상증자 결정",
    "무상증자결정":           "🎁 무상증자 결정",
    "감자결정":               "⚠️ 감자 결정",
    "주식분할결정":           "📊 액면분할 결정",
    "액면분할":               "📊 액면분할 결정",
    "액면병합":               "📊 액면병합 결정",
    "합병결정":               "🔀 합병 결정",
    # 배당·자사주
    "현금배당":               "💰 배당 결정",
    "현물배당":               "💰 배당 결정",
    "현금": "💰 배당 결정",
    "자기주식취득결정":       "🔄 자사주 취득",
    "자기주식소각결정":       "🔥 자사주 소각",
    # 계약·영업
    "단일판매":               "📝 계약 체결",
    "계약해지":               "📝 계약 종료",
    "계약종료":               "📝 계약 종료",
    # 주주총회·경영
    "주주총회소집결의":       "🏛 주주총회 소집",
    # 채권
    "주요사항보고서(전환사채": "📄 전환사채 발행",
    "신주인수권부사채":       "📄 신주인수권부사채 발행",
    # 거래소 이벤트
    "권리락":                 "⚡ 권리락",
    "배당락":                 "💸 배당락",
    "관리종목지정":           "🚨 관리종목 지정",
    "관리종목해제":           "✅ 관리종목 해제",
    "매매거래재개":           "✅ 거래재개",
    "상장폐지":               "🚨 상장폐지 결정",
    # 바이오
    "임상시험":               "🧬 임상 관련",
    "품목허가":               "🧬 품목허가",
    "식품의약품안전처":       "🧬 식약처 결정",
}

# 공시 유형 코드 (B=주요사항보고, C=발행공시, I=거래소공시)
PBLNTF_TYPES = ["B", "C", "I"]


def sync_corp_codes() -> int:
    """DART에서 전체 종목코드-고유번호 매핑을 다운로드해 캐시에 저장."""
    if not Config.DART_API_KEY:
        return 0
    try:
        resp = requests.get(
            f"{DART_BASE}/corpCode.xml",
            params={"crtfc_key": Config.DART_API_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            xml_data = zf.read("CORPCODE.xml")
        root = ET.fromstring(xml_data)

        mappings = []
        for corp in root.findall("list"):
            stock_code = (corp.findtext("stock_code") or "").strip()
            corp_code  = (corp.findtext("corp_code")  or "").strip()
            corp_name  = (corp.findtext("corp_name")  or "").strip()
            if stock_code:  # 상장사만
                mappings.append((stock_code, corp_code, corp_name))

        db.upsert_corp_codes(mappings)
        logger.info("DART corp_code 캐시 갱신 완료: %d건", len(mappings))
        return len(mappings)
    except Exception as exc:
        logger.error("DART corp_code 동기화 실패: %s", exc)
        return 0


def ensure_corp_codes():
    """캐시가 비어 있으면 자동으로 동기화."""
    if db.dart_cache_count() == 0:
        sync_corp_codes()


def fetch_disclosures(corp_code: str, days: int = 2) -> list[dict]:
    """특정 기업의 최근 공시 목록을 반환."""
    if not Config.DART_API_KEY or not corp_code:
        return []

    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    end   = datetime.now().strftime("%Y%m%d")
    results = []

    for ptype in PBLNTF_TYPES:
        try:
            resp = requests.get(
                f"{DART_BASE}/list.json",
                params={
                    "crtfc_key":  Config.DART_API_KEY,
                    "corp_code":  corp_code,
                    "bgn_de":     start,
                    "end_de":     end,
                    "pblntf_ty":  ptype,
                    "page_count": 20,
                },
                timeout=10,
            )
            data = resp.json()
            if data.get("status") == "000":
                results.extend(data.get("list", []))
        except Exception as exc:
            logger.warning("DART 공시 조회 실패 (%s): %s", corp_code, exc)

    return results


def classify(report_nm: str) -> str | None:
    """공시명에서 이벤트 유형 레이블 반환."""
    clean = report_nm.replace(" ", "").replace("ㆍ", "").replace("·", "")
    for keyword, label in KEYWORDS.items():
        if keyword.replace(" ", "") in clean:
            return label
    return None


def get_new_events(stock: dict) -> list[dict]:
    """
    관심종목 한 개에 대해 새로운 DART 이벤트 목록을 반환.
    이미 발송된 알림은 제외.
    """
    if not Config.DART_API_KEY:
        return []

    ensure_corp_codes()
    corp_code = db.get_corp_code(stock["code"])
    if not corp_code:
        return []

    events = []
    for item in fetch_disclosures(corp_code):
        report_nm = item.get("report_nm", "")
        label = classify(report_nm)
        if not label:
            continue

        rcept_no  = item.get("rcept_no", "")
        alert_key = f"DART:{stock['code']}:{rcept_no}"
        if db.is_alert_sent(alert_key):
            continue

        rtype  = detect_report_type(report_nm)
        detail = get_disclosure_detail(rcept_no, rtype)

        if rtype == "rights" and detail.get("record_date"):
            rights_type = "무상증자" if "무상증자" in report_nm else "유상증자"
            try:
                ex_date = (
                    pd.Timestamp(detail["record_date"]) - pd.offsets.BDay(1)
                ).strftime("%Y-%m-%d")
                source_key = f"EXRIGHTS:{stock['code']}:{ex_date}"
                db.add_scheduled_event(
                    code=stock["code"],
                    name=stock.get("name", stock["code"]),
                    event_type="권리락",
                    event_date=ex_date,
                    rights_type=rights_type,
                    source_key=source_key,
                )
            except Exception as exc:
                logger.debug("권리락 일정 저장 실패 (%s): %s", stock["code"], exc)

        events.append({
            "market":     "KR",
            "code":       stock["code"],
            "name":       stock.get("name", stock["code"]),
            "event_type": label,
            "title":      report_nm,
            "date":       item.get("rcept_dt", ""),
            "url":        f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}",
            "alert_key":  alert_key,
            "detail":     detail,
        })

    return events

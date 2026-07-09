"""
DART Open API 연동 — 한국 상장사 재무비율 (ROE, 부채비율, 영업이익률)

사용 준비:
1. https://opendart.fss.or.kr 에서 무료 API키 발급
2. 환경변수 설정: export DART_API_KEY=발급받은키
   (또는 KoreaAdapter(dart_api_key="...") 로 직접 전달)

시점 정합성 (lookahead bias 방지) 처리 방식:
- 보고서별 '법정 제출기한'이 지난 보고서만 사용하는 보수적 방식
  · 사업보고서: 결산 후 90일 (12월 결산 → 3/31)
  · 분기/반기보고서: 분기 말 후 45일 (Q1 → 5/15, 반기 → 8/14, Q3 → 11/14)
- 예: 기준일이 4/10이면 전년도 사업보고서까지만 사용 (당해 Q1은 아직 미공시 가정)
- 실제 공시일은 기한보다 빠른 경우가 많으므로 이 방식은 '데이터가 다소 늦게 반영'되는
  쪽으로 보수적임 → 백테스트가 과대평가되는 방향의 편향은 없음

비율 계산 주의:
- 분기보고서의 손익 항목은 누적 기준이므로 절대 수준(연환산)은 부정확할 수 있으나,
  같은 보고서 기준으로 전 종목을 비교하는 횡단면 랭킹에서는 문제 없음
"""

import io
import os
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests

from cache import CACHE_DIR

BASE_URL = "https://opendart.fss.or.kr/api"

# 계정명 → 표준 키 매핑 (fnlttMultiAcnt 주요계정 응답 기준)
ACCOUNT_MAP = {
    "자본총계": "equity",
    "부채총계": "debt",
    "매출액": "revenue",
    "영업이익": "op_income",
    "당기순이익": "net_income",
}

# 보고서 코드: 사업보고서 / 반기 / 1분기 / 3분기
REPRT_ANNUAL, REPRT_HALF, REPRT_Q1, REPRT_Q3 = "11011", "11012", "11013", "11014"


def get_api_key(explicit: str | None = None) -> str | None:
    return explicit or os.environ.get("DART_API_KEY")


def resolve_available_report(as_of: str) -> tuple[str, str]:
    """
    기준일에 '법정 기한상 확실히 공시 완료된' 최신 보고서의 (사업연도, 보고서코드)
    12월 결산 법인 기준 (한국 상장사의 절대다수)
    """
    d = pd.Timestamp(as_of)
    y, md = d.year, (d.month, d.day)
    if md >= (11, 15):
        return str(y), REPRT_Q3
    if md >= (8, 15):
        return str(y), REPRT_HALF
    if md >= (5, 16):
        return str(y), REPRT_Q1
    if md >= (4, 1):
        return str(y - 1), REPRT_ANNUAL
    return str(y - 1), REPRT_Q3


def load_corp_codes(api_key: str) -> pd.DataFrame:
    """
    DART 고유번호(corp_code) ↔ 종목코드(stock_code) 매핑
    최초 1회 다운로드 후 로컬 캐시 (파일이 크므로 재사용)
    """
    cache_path = CACHE_DIR / "dart_corp_codes.pkl"
    if cache_path.exists():
        return pd.read_pickle(cache_path)

    r = requests.get(f"{BASE_URL}/corpCode.xml",
                     params={"crtfc_key": api_key}, timeout=60)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        xml_data = z.read(z.namelist()[0])

    rows = []
    for el in ET.fromstring(xml_data).iter("list"):
        stock_code = (el.findtext("stock_code") or "").strip()
        if stock_code:  # 상장사만
            rows.append({"corp_code": el.findtext("corp_code"),
                         "ticker": stock_code})
    df = pd.DataFrame(rows).drop_duplicates(subset="ticker")

    CACHE_DIR.mkdir(exist_ok=True)
    df.to_pickle(cache_path)
    return df


def _fetch_multi_acnt(api_key: str, corp_codes: list[str],
                      bsns_year: str, reprt_code: str) -> list[dict]:
    """다중회사 주요계정 API (최대 수십 개 corp_code를 콤마로 묶어 1회 호출)"""
    r = requests.get(f"{BASE_URL}/fnlttMultiAcnt.json", params={
        "crtfc_key": api_key,
        "corp_code": ",".join(corp_codes),
        "bsns_year": bsns_year,
        "reprt_code": reprt_code,
    }, timeout=60)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "000":  # 013 = 조회 데이터 없음 (정상 케이스)
        return []
    return body.get("list", [])


def _to_num(s) -> float:
    try:
        return float(str(s).replace(",", ""))
    except (ValueError, TypeError):
        return float("nan")


def fetch_financial_ratios(tickers: list[str], as_of: str,
                           api_key: str | None = None,
                           batch_size: int = 50,
                           request_interval: float = 0.2) -> pd.DataFrame:
    """
    종목코드 리스트 → ticker별 [roe, debt_ratio, op_margin] DataFrame

    - 기준일에 공시 완료가 확실한 최신 보고서 기준 (resolve_available_report)
    - 연결(CFS) 우선, 없으면 별도(OFS) 재무제표 사용
    - (사업연도, 보고서) 단위로 캐시 → 같은 분기 내 재실행 시 API 호출 없음
    """
    api_key = get_api_key(api_key)
    if not api_key:
        raise ValueError(
            "DART API키가 없습니다. https://opendart.fss.or.kr 에서 발급 후 "
            "환경변수 DART_API_KEY 를 설정하세요.")

    bsns_year, reprt_code = resolve_available_report(as_of)

    # (사업연도, 보고서) 단위 캐시 — 시장별 실행이 같은 파일을 공유하므로
    # '캐시에 없는 종목만' 추가 수집해서 누적 (KOSPI 먼저 실행 후 KOSDAQ을
    # 돌리면 캐시가 KOSPI 종목뿐이라 KOSDAQ 전체가 NaN 되던 버그 수정)
    cache_path = CACHE_DIR / f"dart_fin_{bsns_year}_{reprt_code}.pkl"
    cached = pd.read_pickle(cache_path) if cache_path.exists() \
        else pd.DataFrame(columns=["ticker", "roe", "debt_ratio", "op_margin"])
    missing = [t for t in tickers if t not in set(cached["ticker"])]
    if not missing:
        return cached[cached["ticker"].isin(tickers)].reset_index(drop=True)

    corp_map = load_corp_codes(api_key)
    corp_map = corp_map[corp_map["ticker"].isin(missing)]
    code_to_ticker = dict(zip(corp_map["corp_code"], corp_map["ticker"]))
    corp_codes = corp_map["corp_code"].tolist()

    # corp_code → {fs_div → {계정 → 금액}}
    raw: dict[str, dict[str, dict[str, float]]] = {}
    for i in range(0, len(corp_codes), batch_size):
        batch = corp_codes[i:i + batch_size]
        try:
            items = _fetch_multi_acnt(api_key, batch, bsns_year, reprt_code)
        except requests.RequestException:
            time.sleep(2)  # 일시 오류 1회 재시도
            try:
                items = _fetch_multi_acnt(api_key, batch, bsns_year, reprt_code)
            except requests.RequestException:
                continue
        for it in items:
            key = ACCOUNT_MAP.get(it.get("account_nm"))
            if key is None:
                continue
            fs = it.get("fs_div", "OFS")  # CFS=연결, OFS=별도
            raw.setdefault(it["corp_code"], {}).setdefault(fs, {})[key] = \
                _to_num(it.get("thstrm_amount"))
        time.sleep(request_interval)

    rows = []
    for corp_code, by_fs in raw.items():
        acc = by_fs.get("CFS") or by_fs.get("OFS") or {}
        equity, debt = acc.get("equity"), acc.get("debt")
        revenue, op = acc.get("revenue"), acc.get("op_income")
        net = acc.get("net_income")
        rows.append({
            "ticker": code_to_ticker[corp_code],
            "roe": net / equity if _valid_denom(net, equity) else float("nan"),
            "debt_ratio": debt / equity * 100 if _valid_denom(debt, equity) else float("nan"),
            "op_margin": op / revenue if _valid_denom(op, revenue) else float("nan"),
        })

    # 조회했지만 데이터가 없던 종목도 NaN으로 기록 → 재실행 시 반복 조회 방지
    got = {r["ticker"] for r in rows}
    rows += [{"ticker": t, "roe": float("nan"), "debt_ratio": float("nan"),
              "op_margin": float("nan")} for t in missing if t not in got]

    new_df = pd.DataFrame(rows, columns=["ticker", "roe", "debt_ratio", "op_margin"])
    merged = (pd.concat([cached, new_df], ignore_index=True)
              .drop_duplicates(subset="ticker", keep="first"))
    CACHE_DIR.mkdir(exist_ok=True)
    merged.to_pickle(cache_path)
    return merged[merged["ticker"].isin(tickers)].reset_index(drop=True)


def _valid_denom(numer, denom) -> bool:
    return (numer == numer and denom == denom  # NaN 체크
            and denom is not None and numer is not None and denom > 0)

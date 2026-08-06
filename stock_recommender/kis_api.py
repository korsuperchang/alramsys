"""
한국투자증권 KIS Developers REST API 클라이언트

환경변수:
    KIS_APP_KEY    — 앱 키
    KIS_APP_SECRET — 앱 시크릿

토큰은 24시간 유효하므로 파일 캐시 후 재사용.
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path

import requests

from paths import CACHE_DIR

BASE_URL = "https://openapi.koreainvestment.com:9443"
TOKEN_PATH = CACHE_DIR / "kis_token.json"

# ETF/ETN 브랜드 접두어 — 국내 ETF는 "브랜드 + 공백 + 기초자산" 형식이다
# (예: "KODEX 레버리지", "ACE 미국30년국채").  공백을 필수로 두지 않으면
# 'ACE침대', 'BNK금융지주', '파워로직스' 같은 실제 종목까지 걸러버린다.
_ETF_BRANDS = (
    "KODEX", "TIGER", "KBSTAR", "ARIRANG", "HANARO", "ACE", "SOL",
    "PLUS", "RISE", "KOSEF", "TREX", "FOCUS", "VITA", "TIMEFOLIO",
    "UNICORN", "히어로즈", "마이티", "네비게이터", "에셋플러스",
    "마이다스", "우리", "하나", "신한", "삼성", "미래에셋", "한투",
)
# 지수·파생 추종 상품에만 쓰이는 키워드 (개별종목명엔 등장하지 않음)
_ETF_KEYWORDS = ("레버리지", "인버스", "ETN", "선물 ", "(H)", "합성", "TR)")


def is_etf_like(name: str) -> bool:
    """종목명으로 ETF/ETN/지수추종 상품 여부 판별"""
    if not name:
        return False
    upper = name.upper()
    # 브랜드는 반드시 뒤에 공백이 와야 ETF로 인정
    if any(upper.startswith(b.upper() + " ") for b in _ETF_BRANDS):
        return True
    return any(k in name for k in _ETF_KEYWORDS)


class KISClient:

    def __init__(self, app_key: str | None = None, app_secret: str | None = None):
        self.app_key = app_key or os.environ.get("KIS_APP_KEY", "")
        self.app_secret = app_secret or os.environ.get("KIS_APP_SECRET", "")
        if not self.app_key or not self.app_secret:
            raise ValueError(
                "KIS API 키가 없습니다. 환경변수 KIS_APP_KEY, KIS_APP_SECRET 설정 필요")
        self._token: str | None = None
        self._token_expires: float = 0
        self._load_cached_token()

    # ── 인증 ──────────────────────────────────

    def _load_cached_token(self):
        if TOKEN_PATH.exists():
            try:
                data = json.loads(TOKEN_PATH.read_text())
                if data.get("expires", 0) > time.time() + 600:
                    self._token = data["token"]
                    self._token_expires = data["expires"]
            except Exception:
                pass

    def _save_token(self):
        CACHE_DIR.mkdir(exist_ok=True)
        TOKEN_PATH.write_text(json.dumps({
            "token": self._token,
            "expires": self._token_expires,
        }))

    def _ensure_token(self):
        if self._token and time.time() < self._token_expires - 600:
            return
        r = requests.post(f"{BASE_URL}/oauth2/tokenP", json={
            "grant_type": "client_credentials",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
        }, timeout=10)
        r.raise_for_status()
        body = r.json()
        self._token = body["access_token"]
        exp_str = body.get("access_token_token_expired", "")
        if exp_str:
            try:
                self._token_expires = datetime.strptime(
                    exp_str, "%Y-%m-%d %H:%M:%S").timestamp()
            except ValueError:
                self._token_expires = time.time() + 86000
        else:
            self._token_expires = time.time() + 86000
        self._save_token()

    def _headers(self, tr_id: str) -> dict:
        self._ensure_token()
        return {
            "Content-Type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self._token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "custtype": "P",
        }

    def _get(self, path: str, tr_id: str, params: dict,
             retries: int = 2) -> dict:
        for attempt in range(retries + 1):
            try:
                r = requests.get(f"{BASE_URL}{path}",
                                 headers=self._headers(tr_id),
                                 params=params, timeout=10)
                r.raise_for_status()
                return r.json()
            except requests.RequestException:
                if attempt < retries:
                    time.sleep(1)
                else:
                    raise

    # ── 현재가 조회 ──────────────────────────────

    def get_price(self, ticker: str) -> dict | None:
        """현재가 시세 — 가격, 거래대금, 고/저/시가 등"""
        try:
            body = self._get(
                "/uapi/domestic-stock/v1/quotations/inquire-price",
                "FHKST01010100",
                {"FID_COND_MRKT_DIV_CODE": "J",
                 "FID_INPUT_ISCD": ticker})
            o = body.get("output", {})
            if not o or not o.get("stck_prpr"):
                return None
            return {
                "price": int(o["stck_prpr"]),
                "open": int(o.get("stck_oprc", 0)),
                "high": int(o.get("stck_hgpr", 0)),
                "low": int(o.get("stck_lwpr", 0)),
                "prev_close": int(o.get("stck_sdpr", 0)),
                "volume": int(o.get("acml_vol", 0)),
                "trade_value": int(o.get("acml_tr_pbmn", 0)),
                "change_pct": float(o.get("prdy_ctrt", 0)),
            }
        except Exception as e:
            print(f"  [KIS] get_price({ticker}) 실패: {e}")
            return None

    # ── 분봉 조회 ──────────────────────────────

    def get_minute_candles(self, ticker: str,
                          start_time: str = "090000") -> list[dict]:
        """당일 1분봉 조회 (최대 30개씩, 자동 페이징)"""
        candles = []
        hour = start_time
        for _ in range(10):  # 최대 300개 (09:00~14:00 충분)
            try:
                body = self._get(
                    "/uapi/domestic-stock/v1/quotations/"
                    "inquire-time-itemchartprice",
                    "FHKST03010200",
                    {"FID_COND_MRKT_DIV_CODE": "J",
                     "FID_INPUT_ISCD": ticker,
                     "FID_INPUT_HOUR_1": hour,
                     "FID_PW_DATA_INCU_YN": "Y",
                     "FID_ETC_CLS_CODE": ""})
                rows = body.get("output2", [])
                if not rows:
                    break
                for r in rows:
                    t = r.get("stck_cntg_hour", "")
                    if not t:
                        continue
                    candles.append({
                        "time": t,
                        "close": int(r.get("stck_prpr", 0)),
                        "open": int(r.get("stck_oprc", 0)),
                        "high": int(r.get("stck_hgpr", 0)),
                        "low": int(r.get("stck_lwpr", 0)),
                        "volume": int(r.get("cntg_vol", 0)),
                    })
                last_time = rows[-1].get("stck_cntg_hour", "")
                if last_time <= hour or len(rows) < 30:
                    break
                hour = last_time
                time.sleep(0.1)
            except Exception:
                break
        candles.sort(key=lambda c: c["time"])
        return candles

    # ── 거래대금 상위 종목 ──────────────────────

    def get_volume_rank(self, market: str = "0000",
                        exclude_etf: bool = True) -> list[dict]:
        """
        거래대금 상위 종목 (0000=전체, 0001=코스피, 1001=코스닥)

        API 1회 응답 상한이 30개이므로, 후보를 넓히려면 코스피/코스닥을
        따로 호출해 합칠 것. ETF/ETN이 상위권을 상시 차지하므로
        exclude_etf=True면 API 파라미터 + 종목명 양쪽으로 걸러낸다.
        """
        # 제외 대상 구분 코드: 자릿수별 의미가 문서마다 달라 신뢰도가 낮으므로
        # 우선주/관리종목/거래정지 등만 켜고, ETF/ETN은 종목명으로 재차 필터링
        exls = "1111111111" if exclude_etf else "0000000000"
        try:
            body = self._get(
                "/uapi/domestic-stock/v1/quotations/volume-rank",
                "FHPST01710000",
                {"FID_COND_MRKT_DIV_CODE": "J",
                 "FID_COND_SCR_DIV_CODE": "20171",
                 "FID_INPUT_ISCD": market,
                 "FID_DIV_CLS_CODE": "1",       # 보통주
                 "FID_BLNG_CLS_CODE": "3",       # 거래금액순
                 "FID_TRGT_CLS_CODE": "111111111",
                 "FID_TRGT_EXLS_CLS_CODE": exls,
                 "FID_INPUT_PRICE_1": "",
                 "FID_INPUT_PRICE_2": "",
                 "FID_VOL_CNT": "",
                 "FID_INPUT_DATE_1": ""})
            results = []
            for r in body.get("output", []):
                ticker = r.get("mksc_shrn_iscd", "")
                if not ticker:
                    continue
                name = r.get("hts_kor_isnm", "")
                if exclude_etf and is_etf_like(name):
                    continue
                results.append({
                    "ticker": ticker,
                    "name": name,
                    "price": int(r.get("stck_prpr", 0)),
                    "change_pct": float(r.get("prdy_ctrt", 0)),
                    "volume": int(r.get("acml_vol", 0)),
                    "trade_value": int(r.get("acml_tr_pbmn", 0)),
                })
            return results
        except Exception as e:
            print(f"  [KIS] get_volume_rank 실패: {e}")
            return []

    def get_volume_rank_multi(self, markets: tuple[str, ...] = ("0001", "1001"),
                              exclude_etf: bool = True) -> list[dict]:
        """
        여러 시장의 거래대금 상위를 합쳐서 반환 (중복 종목은 1회만)

        전체(0000) 1회 호출은 거래대금 큰 코스피가 상위를 독식해
        코스닥 종목이 거의 안 잡힌다. 시장별로 나눠 부르면 각 30개씩
        확보되어 코스닥 중소형주가 후보에 포함된다.
        """
        merged: list[dict] = []
        seen: set[str] = set()
        for m in markets:
            for row in self.get_volume_rank(m, exclude_etf=exclude_etf):
                if row["ticker"] in seen:
                    continue
                seen.add(row["ticker"])
                merged.append(row)
            time.sleep(0.1)
        merged.sort(key=lambda r: r["trade_value"], reverse=True)
        return merged

    # ── 기관/외국인 순매수 상위 ──────────────────

    def get_institution_buy_rank(self, market: str = "0001",
                                 investor: str = "2") -> list[dict]:
        """
        기관/외국인 순매수 상위 종목
        market: 0001=코스피, 1001=코스닥
        investor: 1=외국인, 2=기관계
        """
        try:
            body = self._get(
                "/uapi/domestic-stock/v1/quotations/"
                "foreign-institution-total",
                "FHPTJ04400000",
                {"FID_COND_MRKT_DIV_CODE": "V",
                 "FID_COND_SCR_DIV_CODE": "16449",
                 "FID_INPUT_ISCD": market,
                 "FID_DIV_CLS_CODE": "1",        # 금액 기준
                 "FID_RANK_SORT_CLS_CODE": "0",  # 순매수 상위
                 "FID_ETC_CLS_CODE": investor})
            results = []
            for r in body.get("output", []):
                ticker = r.get("mksc_shrn_iscd", "")
                if not ticker:
                    continue
                results.append({
                    "ticker": ticker,
                    "name": r.get("hts_kor_isnm", ""),
                    "net_buy": int(r.get("ntby_qty", 0)),
                    "net_buy_amount": int(r.get("ntby_tr_pbmn", 0)),
                })
            return results
        except Exception as e:
            print(f"  [KIS] get_institution_buy_rank 실패: {e}")
            return []

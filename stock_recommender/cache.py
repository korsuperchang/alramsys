"""
로컬 파일 캐시
- 어댑터의 수집 결과를 (시장, 기준일, 데이터종류) 키로 저장/재사용
- 같은 기준일로 재실행하면 API 호출 없이 즉시 로드 → 실행 속도 대폭 개선
- 나스닥 공매도 '변화' 계산을 위한 스냅샷 이력 조회 기능 포함

저장 위치: stock_recommender/.cache/ (git 추적 제외)
포맷: pandas pickle (외부 의존성 불필요)
"""

import re
from pathlib import Path

import pandas as pd

CACHE_DIR = Path(__file__).resolve().parent / ".cache"


def _path(kind: str, market: str, as_of: str) -> Path:
    date = as_of.replace("-", "")
    return CACHE_DIR / f"{market}_{kind}_{date}.pkl"


def load(kind: str, market: str, as_of: str) -> pd.DataFrame | None:
    """캐시가 있으면 DataFrame, 없으면 None"""
    p = _path(kind, market, as_of)
    if p.exists():
        try:
            return pd.read_pickle(p)
        except Exception:
            p.unlink(missing_ok=True)  # 손상된 캐시는 삭제 후 재수집
    return None


def save(kind: str, market: str, as_of: str, df: pd.DataFrame) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    df.to_pickle(_path(kind, market, as_of))


def latest_before(kind: str, market: str, as_of: str) -> tuple[str, pd.DataFrame] | None:
    """
    as_of '이전' 날짜의 가장 최근 캐시 반환 (날짜 문자열, DataFrame)
    나스닥 공매도 잔고처럼 '이전 스냅샷 대비 변화'가 필요한 팩터에 사용
    """
    if not CACHE_DIR.exists():
        return None
    cutoff = as_of.replace("-", "")
    pattern = re.compile(rf"^{re.escape(market)}_{re.escape(kind)}_(\d{{8}})\.pkl$")
    candidates = []
    for p in CACHE_DIR.iterdir():
        m = pattern.match(p.name)
        if m and m.group(1) < cutoff:
            candidates.append((m.group(1), p))
    if not candidates:
        return None
    date, path = max(candidates)
    try:
        return date, pd.read_pickle(path)
    except Exception:
        return None

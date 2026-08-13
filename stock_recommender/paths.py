"""
공용 경로 상수 — 무거운 의존성 없이 임포트할 수 있어야 한다.

cache.py는 pandas를 쓰지만, 스캐너/모의매매처럼 경로만 필요한 모듈이
cache.py를 임포트하면 pandas(약 55MB)가 통째로 딸려온다. 1GB 서버에서는
무시할 수 없는 낭비라 경로만 여기로 분리했다.
"""

import os
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env():
    """
    저장소 루트의 .env를 환경변수로 올린다 (이미 설정된 값은 건드리지 않음).

    systemd 서비스는 EnvironmentFile로 .env를 읽지만, 셸에서 직접
    `python3 scanner.py --test`를 돌리면 그 경로를 타지 않아 키가 없다는
    오류가 난다. 수동 실행에서도 같은 파일을 쓰도록 여기서 맞춰 준다.
    """
    if not ENV_PATH.exists():
        return
    try:
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)
    except Exception:
        pass    # .env가 깨져 있어도 기존 환경변수로 동작할 수 있어야 한다

"""
공용 경로 상수 — 무거운 의존성 없이 임포트할 수 있어야 한다.

cache.py는 pandas를 쓰지만, 스캐너/모의매매처럼 경로만 필요한 모듈이
cache.py를 임포트하면 pandas(약 55MB)가 통째로 딸려온다. 1GB 서버에서는
무시할 수 없는 낭비라 경로만 여기로 분리했다.
"""

from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / ".cache"

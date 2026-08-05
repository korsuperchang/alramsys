"""
장중 실시간 스캐너 — 시간대별 자동 매매 신호 탐지

전략 요약:
  09:00~09:30  관찰 (매매 금지)
  09:30        1차 스캔 → 횡보 후보 선정 (박스 생성)
  10:00~11:30  박스 돌파 + 거래량 + 기관 매수 감시
  13:00~14:50  매매 금지
  14:50        2차 스캔 → 오후 후보 선정
  15:00~15:25  전고점 돌파 + 거래량 감시
  15:25        강제 청산 시점

실행:
  python scanner.py              # 장중 자동 실행
  python scanner.py --test       # 현재 시간 무시하고 즉시 스캔 테스트

결과는 .cache/scanner_state.json 에 저장 → app.py 가 읽어서 대시보드에 표시
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from cache import CACHE_DIR
from kis_api import KISClient

STATE_PATH = CACHE_DIR / "scanner_state.json"

# ── 전략 파라미터 ──────────────────────────────

# 오전 스캔 (09:30)
MORNING_MIN_TRADE_VALUE = 15_000_000_000     # 누적 거래대금 150억
MORNING_CHANGE_LOW = 1.5                      # 등락률 하한 %
MORNING_CHANGE_HIGH = 5.0                     # 등락률 상한 %
MORNING_MAX_BOX_WIDTH = 0.015                 # 박스폭 1.5% 이내

# 오전 감시 (10:00~11:30)
BREAKOUT_VOL_MULTIPLIER = 3.0                 # 거래량 3배 이상
STOP_LOSS_PCT = -2.0                          # 손절 -2%
TAKE_PROFIT_PCT = 5.0                         # 익절 +5%

# 오후 스캔 (14:50)
AFTERNOON_MIN_TRADE_VALUE = 50_000_000_000   # 거래대금 500억
AFTERNOON_MAX_DIP = -2.0                      # 장중 저가 시가 대비 -2% 이내

# 오후 감시 (15:00~15:25)
AFTERNOON_VOL_MULTIPLIER = 3.0

POLL_INTERVAL = 60  # 폴링 간격 (초)


class DayScanner:

    def __init__(self):
        self.kis = KISClient()
        self.morning_candidates: list[dict] = []
        self.afternoon_candidates: list[dict] = []
        self.signals: list[dict] = []
        self.state = {
            "date": "",
            "phase": "대기",
            "morning_candidates": [],
            "afternoon_candidates": [],
            "signals": [],
            "last_update": "",
        }

    # ── 상태 저장 ──────────────────────────────

    def _save_state(self):
        self.state["last_update"] = datetime.now().strftime("%H:%M:%S")
        self.state["morning_candidates"] = self.morning_candidates
        self.state["afternoon_candidates"] = self.afternoon_candidates
        self.state["signals"] = self.signals
        CACHE_DIR.mkdir(exist_ok=True)
        STATE_PATH.write_text(
            json.dumps(self.state, ensure_ascii=False, indent=1),
            encoding="utf-8")

    def _log(self, msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [{ts}] {msg}")

    # ── 09:30 오전 스캔 ────────────────────────

    def morning_scan(self):
        self._log("=== 오전 스캔 시작 ===")
        self.state["phase"] = "오전 스캔 중"
        self._save_state()

        # 거래대금 상위 종목 조회
        ranked = self.kis.get_volume_rank("0000")
        self._log(f"거래대금 상위 {len(ranked)}개 종목 조회됨")

        candidates = []
        for stock in ranked:
            tv = stock["trade_value"]
            pct = stock["change_pct"]

            if tv < MORNING_MIN_TRADE_VALUE:
                continue
            if not (MORNING_CHANGE_LOW <= pct <= MORNING_CHANGE_HIGH):
                continue

            # 개별 시세 조회 → 박스폭 계산
            price = self.kis.get_price(stock["ticker"])
            if not price:
                continue
            high, low = price["high"], price["low"]
            if low <= 0:
                continue
            box_width = (high - low) / low
            if box_width > MORNING_MAX_BOX_WIDTH:
                continue

            candidate = {
                "ticker": stock["ticker"],
                "name": stock["name"],
                "box_high": high,
                "box_low": low,
                "box_width_pct": round(box_width * 100, 2),
                "change_pct": pct,
                "trade_value_억": round(tv / 1e8),
                "entry_price": None,
                "status": "감시중",
            }
            candidates.append(candidate)
            self._log(
                f"  후보: {stock['name']}({stock['ticker']}) "
                f"박스 {low:,}~{high:,} ({candidate['box_width_pct']}%) "
                f"등락 {pct:+.1f}% 거래대금 {candidate['trade_value_억']}억")
            time.sleep(0.1)

        self.morning_candidates = candidates
        self._log(f"오전 후보 {len(candidates)}개 선정")
        self.state["phase"] = "오전 감시 대기"
        self._save_state()

    # ── 10:00~11:30 오전 감시 ──────────────────

    def morning_monitor(self):
        if not self.morning_candidates:
            self._log("오전 후보 없음 — 감시 건너뜀")
            return

        self._log("=== 오전 감시 시작 (10:00~11:30) ===")
        self.state["phase"] = "오전 감시 중"
        self._save_state()

        # 기관 순매수 상위 종목 (참조용 — 주기적 갱신)
        inst_set: set[str] = set()

        while True:
            now = datetime.now()
            if now.hour >= 11 and now.minute > 30:
                break
            if now.hour < 10:
                time.sleep(30)
                continue

            # 기관 순매수 목록 갱신 (5분마다)
            if now.minute % 5 == 0:
                inst_buys = self.kis.get_institution_buy_rank("0001", "2")
                inst_buys += self.kis.get_institution_buy_rank("1001", "2")
                inst_set = {s["ticker"] for s in inst_buys[:50]}
                self._log(f"기관 순매수 상위 {len(inst_set)}개 갱신")

            for c in self.morning_candidates:
                if c["status"] != "감시중":
                    continue

                price = self.kis.get_price(c["ticker"])
                if not price:
                    continue

                current = price["price"]

                # 돌파 확인
                if current <= c["box_high"]:
                    continue

                # 거래량 확인 (분봉으로 직전 20분 평균 대비)
                vol_ok = self._check_volume_surge(
                    c["ticker"], BREAKOUT_VOL_MULTIPLIER)

                # 기관 매수 확인
                inst_ok = c["ticker"] in inst_set

                if vol_ok and inst_ok:
                    c["entry_price"] = current
                    c["entry_time"] = now.strftime("%H:%M")
                    c["status"] = "진입"
                    c["stop_loss"] = round(current * (1 + STOP_LOSS_PCT / 100))
                    c["take_profit"] = round(
                        current * (1 + TAKE_PROFIT_PCT / 100))
                    signal = {
                        "type": "오전 돌파",
                        "time": now.strftime("%H:%M"),
                        "ticker": c["ticker"],
                        "name": c["name"],
                        "price": current,
                        "box_high": c["box_high"],
                        "reason": f"박스 상단 {c['box_high']:,}원 돌파 "
                                  f"(현재 {current:,}원) + 거래량 급증 + 기관 매수",
                        "stop_loss": c["stop_loss"],
                        "take_profit": c["take_profit"],
                        "deadline": "11:30",
                    }
                    self.signals.append(signal)
                    self._log(
                        f"*** 신호: {c['name']} {current:,}원 진입 "
                        f"(손절 {c['stop_loss']:,} / "
                        f"익절 {c['take_profit']:,}) ***")
                elif vol_ok and not inst_ok:
                    self._log(
                        f"  {c['name']} 돌파+거래량 OK, 기관 미확인 — 보류")

                # 진입 후 손절/익절 체크
                if c["status"] == "진입" and c["entry_price"]:
                    pnl = (current - c["entry_price"]) / c["entry_price"] * 100
                    if pnl <= STOP_LOSS_PCT:
                        c["status"] = f"손절 ({pnl:+.1f}%)"
                        self._log(f"  {c['name']} 손절 {current:,}원 "
                                  f"({pnl:+.1f}%)")
                    elif pnl >= TAKE_PROFIT_PCT:
                        c["status"] = f"익절 ({pnl:+.1f}%)"
                        self._log(f"  {c['name']} 익절 {current:,}원 "
                                  f"({pnl:+.1f}%)")

                time.sleep(0.1)

            self._save_state()
            time.sleep(POLL_INTERVAL)

        # 11:30 강제 청산
        for c in self.morning_candidates:
            if c["status"] == "진입":
                c["status"] = "11:30 청산"
                self._log(f"  {c['name']} 11:30 강제 청산")
        self.state["phase"] = "점심 휴식"
        self._save_state()

    # ── 14:50 오후 스캔 ────────────────────────

    def afternoon_scan(self):
        self._log("=== 오후 스캔 시작 ===")
        self.state["phase"] = "오후 스캔 중"
        self._save_state()

        ranked = self.kis.get_volume_rank("0000")
        candidates = []

        for stock in ranked:
            tv = stock["trade_value"]
            if tv < AFTERNOON_MIN_TRADE_VALUE:
                continue

            price = self.kis.get_price(stock["ticker"])
            if not price:
                continue

            # 장중 저가가 시가 대비 -2% 아래로 빠진 적 없어야 함
            open_p = price["open"]
            low_p = price["low"]
            if open_p <= 0:
                continue
            dip_pct = (low_p - open_p) / open_p * 100
            if dip_pct < AFTERNOON_MAX_DIP:
                continue

            candidate = {
                "ticker": stock["ticker"],
                "name": stock["name"],
                "day_high": price["high"],
                "current": price["price"],
                "trade_value_억": round(tv / 1e8),
                "change_pct": price["change_pct"],
                "dip_pct": round(dip_pct, 1),
                "status": "감시중",
            }
            candidates.append(candidate)
            self._log(
                f"  후보: {stock['name']}({stock['ticker']}) "
                f"고가 {price['high']:,} 등락 {price['change_pct']:+.1f}% "
                f"거래대금 {candidate['trade_value_억']}억")
            time.sleep(0.1)

        self.afternoon_candidates = candidates
        self._log(f"오후 후보 {len(candidates)}개 선정")
        self.state["phase"] = "오후 감시 대기"
        self._save_state()

    # ── 15:00~15:25 오후 감시 ──────────────────

    def afternoon_monitor(self):
        if not self.afternoon_candidates:
            self._log("오후 후보 없음 — 감시 건너뜀")
            return

        self._log("=== 오후 감시 시작 (15:00~15:25) ===")
        self.state["phase"] = "오후 감시 중"
        self._save_state()

        while True:
            now = datetime.now()
            if now.hour >= 15 and now.minute >= 25:
                break
            if now.hour < 15:
                time.sleep(30)
                continue

            for c in self.afternoon_candidates:
                if c["status"] != "감시중":
                    continue

                price = self.kis.get_price(c["ticker"])
                if not price:
                    continue

                current = price["price"]

                # 전고점 돌파 확인
                if current <= c["day_high"]:
                    continue

                # 거래량 폭발 확인
                vol_ok = self._check_volume_surge(
                    c["ticker"], AFTERNOON_VOL_MULTIPLIER)

                if vol_ok:
                    c["entry_price"] = current
                    c["entry_time"] = now.strftime("%H:%M")
                    c["status"] = "진입"
                    signal = {
                        "type": "오후 돌파",
                        "time": now.strftime("%H:%M"),
                        "ticker": c["ticker"],
                        "name": c["name"],
                        "price": current,
                        "day_high": c["day_high"],
                        "reason": f"전고점 {c['day_high']:,}원 돌파 "
                                  f"(현재 {current:,}원) + 거래량 폭발",
                        "deadline": "15:25",
                    }
                    self.signals.append(signal)
                    self._log(
                        f"*** 신호: {c['name']} {current:,}원 진입 "
                        f"(15:25 청산) ***")

                time.sleep(0.1)

            self._save_state()
            time.sleep(POLL_INTERVAL)

        # 15:25 강제 청산
        for c in self.afternoon_candidates:
            if c["status"] == "진입":
                c["status"] = "15:25 청산"
                self._log(f"  {c['name']} 15:25 강제 청산")
        self.state["phase"] = "장 마감"
        self._save_state()

    # ── 거래량 급증 확인 ──────────────────────

    def _check_volume_surge(self, ticker: str,
                            multiplier: float) -> bool:
        """분봉 거래량이 직전 20분 평균의 N배 이상인지 확인"""
        try:
            candles = self.kis.get_minute_candles(ticker)
            if len(candles) < 21:
                return False
            recent = candles[-1]["volume"]
            avg_20 = sum(c["volume"] for c in candles[-21:-1]) / 20
            if avg_20 <= 0:
                return False
            return recent >= avg_20 * multiplier
        except Exception:
            return False

    # ── 메인 루프 ──────────────────────────────

    def run(self, test: bool = False):
        today = datetime.now().strftime("%Y-%m-%d")
        self.state["date"] = today
        self._log(f"스캐너 시작 ({today})")

        if test:
            self._log("테스트 모드 — 즉시 오전 스캔 실행")
            self.morning_scan()
            return

        while True:
            now = datetime.now()
            h, m = now.hour, now.minute

            # 09:30 오전 스캔
            if h == 9 and m == 30:
                self.morning_scan()
                time.sleep(60)

            # 10:00~11:30 오전 감시
            elif h == 10 and m == 0:
                self.morning_monitor()
                time.sleep(60)

            # 14:50 오후 스캔
            elif h == 14 and m == 50:
                self.afternoon_scan()
                time.sleep(60)

            # 15:00~15:25 오후 감시
            elif h == 15 and m == 0:
                self.afternoon_monitor()
                time.sleep(60)

            # 15:30 종료
            elif h >= 15 and m >= 30:
                self._log("장 마감 — 스캐너 종료")
                self.state["phase"] = "종료"
                self._save_state()
                break

            # 대기
            else:
                phase = "관찰 (09:00~09:30)" if h == 9 and m < 30 \
                    else "점심 휴식" if 11 < h < 14 or (h == 14 and m < 50) \
                    else "대기"
                self.state["phase"] = phase
                self._save_state()
                time.sleep(30)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="장중 실시간 스캐너")
    parser.add_argument("--test", action="store_true",
                        help="즉시 오전 스캔 테스트")
    args = parser.parse_args()
    DayScanner().run(test=args.test)

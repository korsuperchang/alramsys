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

import kst
from paths import CACHE_DIR
from kis_api import KISClient
from paper import PaperTrader

STATE_PATH = CACHE_DIR / "scanner_state.json"

# ── 전략 파라미터 ──────────────────────────────

# 후보 조회 대상 시장 (전체 1회 호출은 코스피가 상위를 독식하므로 분리 호출)
SCAN_MARKETS = ("0001", "1001")               # 코스피, 코스닥

# 오전 스캔 (09:30)
MORNING_MIN_TRADE_VALUE = 5_000_000_000      # 누적 거래대금 50억 (9:30 시점 기준)
MORNING_CHANGE_LOW = 1.0                      # 등락률 하한 %
MORNING_CHANGE_HIGH = 7.0                     # 등락률 상한 %
MORNING_MAX_BOX_WIDTH = 0.025                 # 박스폭 2.5% 이내 (아침 변동 감안)

# 박스 계산 (분봉 기반)
BOX_END_TIME = "093000"       # 박스 구간 종료 시각 — 스캔이 늦게 돌아도 고정
BOX_SKIP_OPEN_MIN = 10        # 시초가 급변동 구간(09:00~09:10) 제외
BOX_WINDOW_MIN = 20           # 박스로 볼 구간 길이 (09:10~09:30)
BOX_MIN_CANDLES = 10          # 박스 판정에 필요한 최소 분봉 수

# 오전 감시 (10:00~11:30)
BREAKOUT_VOL_MULTIPLIER = 3.0                 # 거래량 3배 이상
MAX_CHASE_PCT = 1.0           # 돌파 기준선 대비 +1% 이내에서만 진입 (추격 방지)
STOP_LOSS_PCT = -3.0                          # 손절 -3% (돌파 후 눌림목 감안)
TAKE_PROFIT_PCT = 5.0                         # 익절 +5%

# 오후 스캔 (14:50)
AFTERNOON_MIN_TRADE_VALUE = 50_000_000_000   # 거래대금 500억
AFTERNOON_MAX_DIP = -2.0                      # 장중 저가 시가 대비 -2% 이내

# 오후 감시 (15:00~15:25)
AFTERNOON_VOL_MULTIPLIER = 3.0

POLL_INTERVAL = 60  # 폴링 간격 (초)


class DayScanner:

    def __init__(self, paper: bool = True):
        self.kis = KISClient()
        # 모의매매 기록기 — 실제 주문은 내지 않고 가상 체결만 남긴다
        self.paper = PaperTrader() if paper else None
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
        self.state["last_update"] = kst.now().strftime("%H:%M:%S")
        self.state["morning_candidates"] = self.morning_candidates
        self.state["afternoon_candidates"] = self.afternoon_candidates
        self.state["signals"] = self.signals
        self.state["funnel"] = self._funnel()
        if self.paper:
            self.state["paper"] = self.paper.stats()
        CACHE_DIR.mkdir(exist_ok=True)
        STATE_PATH.write_text(
            json.dumps(self.state, ensure_ascii=False, indent=1),
            encoding="utf-8")

    def _log(self, msg: str):
        ts = kst.now().strftime("%H:%M:%S")
        print(f"  [{ts}] {msg}")

    def _funnel(self) -> dict:
        """
        감시 단계 병목 집계 — 후보가 어느 조건에서 막혀 있는지 센다.
        신호가 계속 0건일 때 어떤 조건이 과한지 판단하는 근거가 된다.
        """
        out = {}
        for label, rows in (("morning", self.morning_candidates),
                            ("afternoon", self.afternoon_candidates)):
            if not rows:
                continue
            blocked: dict[str, int] = {}
            for c in rows:
                key = c.get("blocked_by")
                if key:
                    blocked[key] = blocked.get(key, 0) + 1
            out[label] = {
                "candidates": len(rows),
                "breakout": sum(1 for c in rows if c.get("chk_breakout")),
                "entered": sum(1 for c in rows if c.get("entry_price")),
                "blocked": blocked,
            }
        return out

    # ── 모의매매 기록 ────────────────────────────

    def _paper_buy(self, c: dict, price: int, kind: str):
        if not self.paper:
            return
        pos = self.paper.buy(c["ticker"], c["name"], price, kind,
                             c.get("stop_loss"), c.get("take_profit"))
        if pos:
            self._log(f"  [모의] 매수 {pos['qty']}주 × {price:,}원 "
                      f"= {pos['cost']:,}원")

    def _paper_sell(self, c: dict, price: int, reason: str):
        if not self.paper:
            return
        t = self.paper.sell(c["ticker"], price, reason)
        if t:
            self._log(f"  [모의] 매도 {price:,}원 → "
                      f"실현손익 {t['net_pnl']:+,}원 ({t['pnl_pct']:+.2f}%, "
                      f"비용차감전 {t['gross_pct']:+.2f}%)")

    # ── 청산 조건 확인 ────────────────────────────

    def _check_exit(self, c: dict, current: int) -> bool:
        """
        보유 중인 후보의 손절/익절 확인 → 청산했으면 True

        폴링마다 호출되어야 하므로 '진입' 상태를 걸러내지 말 것.
        """
        entry = c.get("entry_price")
        if not entry:
            return False
        pnl = (current - entry) / entry * 100
        c["pnl_pct"] = round(pnl, 2)
        c["last_price"] = current

        if pnl <= STOP_LOSS_PCT:
            c["status"] = f"손절 ({pnl:+.1f}%)"
            c["exit_price"] = current
            self._log(f"  {c['name']} 손절 {current:,}원 ({pnl:+.1f}%)")
            self._paper_sell(c, current, "손절")
            return True
        if pnl >= TAKE_PROFIT_PCT:
            c["status"] = f"익절 ({pnl:+.1f}%)"
            c["exit_price"] = current
            self._log(f"  {c['name']} 익절 {current:,}원 ({pnl:+.1f}%)")
            self._paper_sell(c, current, "익절")
            return True
        return False

    def _force_close(self, c: dict, label: str):
        """시간 마감에 따른 강제 청산 — 마지막 시세로 손익 확정"""
        price = self.kis.get_price(c["ticker"])
        current = price["price"] if price else c.get("last_price")
        if current and c.get("entry_price"):
            pnl = (current - c["entry_price"]) / c["entry_price"] * 100
            c["pnl_pct"] = round(pnl, 2)
            c["exit_price"] = current
            c["status"] = f"{label} ({pnl:+.1f}%)"
            self._log(f"  {c['name']} {label} {current:,}원 ({pnl:+.1f}%)")
            self._paper_sell(c, current, label)
        else:
            c["status"] = label
            self._log(f"  {c['name']} {label}")

    # ── 박스(횡보 구간) 계산 ──────────────────────

    def _calc_box(self, ticker: str) -> tuple[int, int, float] | None:
        """
        분봉으로 박스 저점·고점·폭을 계산 → (low, high, width)

        당일 고가/저가를 그대로 쓰면 시초가 급변동이 섞여 박스가 아니라
        '하루 변동폭'이 된다. 09:00~09:10 구간을 버리고 그 뒤 BOX_WINDOW_MIN
        분(기본 09:10~09:30)만 본다.

        구간을 BOX_END_TIME(09:30)에 고정해, 스캐너가 늦게 기동해 09:43에
        스캔하더라도 09:10~09:30이라는 같은 박스를 본다.
        """
        # 09:01~09:30 30개를 받아 앞 10분(시초가 변동)을 버린다
        candles = self.kis.get_minute_candles(
            ticker, end_time=BOX_END_TIME,
            count=BOX_SKIP_OPEN_MIN + BOX_WINDOW_MIN)
        if len(candles) <= BOX_SKIP_OPEN_MIN:
            return None
        window = candles[BOX_SKIP_OPEN_MIN:]
        if len(window) < BOX_MIN_CANDLES:
            return None

        highs = [c["high"] for c in window if c["high"] > 0]
        lows = [c["low"] for c in window if c["low"] > 0]
        if not highs or not lows:
            return None

        high, low = max(highs), min(lows)
        if low <= 0:
            return None
        return low, high, (high - low) / low

    # ── 09:30 오전 스캔 ────────────────────────

    def morning_scan(self):
        self._log("=== 오전 스캔 시작 ===")
        self.state["phase"] = "오전 스캔 중"
        self._save_state()

        # 거래대금 상위 종목 조회 (코스피/코스닥 분리 호출, ETF·ETN 제외)
        ranked = self.kis.get_volume_rank_multi(SCAN_MARKETS)
        self._log(f"거래대금 상위 {len(ranked)}개 종목 조회됨 "
                  f"(ETF/ETN 제외, {'+'.join(SCAN_MARKETS)})")

        candidates = []
        rejected: list[dict] = []
        skip_tv, skip_pct, skip_box, skip_nodata = 0, 0, 0, 0

        def reject(stock, reason, **extra):
            """탈락 종목도 실제 수치와 함께 남긴다 — 조건이 과한지 눈으로 보려고"""
            if len(rejected) < 20:
                rejected.append({
                    "ticker": stock["ticker"], "name": stock["name"],
                    "change_pct": stock["change_pct"],
                    "trade_value_억": round(stock["trade_value"] / 1e8),
                    "reason": reason, **extra})

        for stock in ranked:
            tv = stock["trade_value"]
            pct = stock["change_pct"]

            if tv < MORNING_MIN_TRADE_VALUE:
                skip_tv += 1
                reject(stock, "거래대금 미달")
                continue
            if not (MORNING_CHANGE_LOW <= pct <= MORNING_CHANGE_HIGH):
                skip_pct += 1
                reject(stock, "등락률 범위 밖")
                continue

            # 분봉으로 박스(횡보 구간) 계산 — 시초가 급변동 구간은 제외
            box = self._calc_box(stock["ticker"])
            if box is None:
                skip_nodata += 1
                reject(stock, "분봉 없음")
                continue
            low, high, box_width = box
            if box_width > MORNING_MAX_BOX_WIDTH:
                skip_box += 1
                reject(stock, "박스폭 초과",
                       box_width_pct=round(box_width * 100, 2))
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
        self.state["morning_filter"] = {
            "total": len(ranked),
            "passed": len(candidates),
            "skip_trade_value": skip_tv,
            "skip_change_pct": skip_pct,
            "skip_box_width": skip_box,
            "skip_no_data": skip_nodata,
            "rejected": rejected,
        }
        self._log(f"오전 후보 {len(candidates)}개 선정 "
                  f"(탈락: 거래대금 {skip_tv}, 등락률 {skip_pct}, "
                  f"박스폭 {skip_box}, 분봉없음 {skip_nodata})")
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
            now = kst.now()
            # (시, 분) 튜플 비교 — 'hour>=11 and minute>30' 은 12:00에 False가 되어
            # 마감 시각을 지나쳐 계속 도는 문제가 있었다
            if (now.hour, now.minute) >= (11, 30):
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
                # 감시중(진입 대기) 또는 진입(보유 중)만 처리
                if c["status"] not in ("감시중", "진입"):
                    continue

                price = self.kis.get_price(c["ticker"])
                if not price:
                    continue

                current = price["price"]

                # ── 보유 중이면 손절/익절만 확인 ──
                if c["status"] == "진입":
                    self._check_exit(c, current)
                    time.sleep(0.1)
                    continue

                # ── 진입 대기: 조건별 현재 상태를 매 폴링마다 기록 ──
                # (웹에서 어느 조건에서 막혀 있는지 실시간으로 보기 위함)
                gap = (current - c["box_high"]) / c["box_high"] * 100
                inst_ok = c["ticker"] in inst_set
                c.update({
                    "current": current,
                    "gap_pct": round(gap, 2),      # 박스 상단 대비 (음수=미달)
                    "chk_breakout": current > c["box_high"],
                    "chk_inst": inst_ok,
                    "checked_at": now.strftime("%H:%M"),
                })

                if not c["chk_breakout"]:
                    c["vol_ratio"] = None          # 돌파 전엔 거래량 미확인
                    c["blocked_by"] = "돌파 대기"
                    continue

                # 추격 방지 — 돌파 기준선 대비 +MAX_CHASE_PCT% 초과면 이미 늦음.
                # 후보를 죽이지는 않는다: 눌림목에서 박스 상단으로 되돌아오면
                # 그때가 오히려 좋은 진입 자리이므로 다음 폴링에 다시 본다.
                if gap > MAX_CHASE_PCT:
                    c["blocked_by"] = "추격 회피"
                    if not c.get("chase_logged"):
                        c["chase_logged"] = True
                        self._log(f"  {c['name']} 박스 상단 대비 +{gap:.1f}% "
                                  f"— 추격 회피, 눌림목 대기")
                    continue

                # 거래량 확인 (분봉으로 직전 20분 평균 대비)
                ratio = self._volume_ratio(c["ticker"])
                c["vol_ratio"] = ratio
                vol_ok = ratio is not None and ratio >= BREAKOUT_VOL_MULTIPLIER

                if not vol_ok:
                    c["blocked_by"] = "거래량 부족"
                elif not inst_ok:
                    c["blocked_by"] = "기관 미확인"
                else:
                    c["blocked_by"] = None

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
                    self._paper_buy(c, current, "오전 돌파")
                    self._log(
                        f"*** 신호: {c['name']} {current:,}원 진입 "
                        f"(손절 {c['stop_loss']:,} / "
                        f"익절 {c['take_profit']:,}) ***")
                elif vol_ok and not inst_ok:
                    self._log(
                        f"  {c['name']} 돌파+거래량 OK, 기관 미확인 — 보류")

                time.sleep(0.1)

            self._save_state()
            time.sleep(POLL_INTERVAL)

        # 11:30 강제 청산
        for c in self.morning_candidates:
            if c["status"] == "진입":
                self._force_close(c, "11:30 청산")
        self.state["phase"] = "점심 휴식"
        self._save_state()

    # ── 14:50 오후 스캔 ────────────────────────

    def afternoon_scan(self):
        self._log("=== 오후 스캔 시작 ===")
        self.state["phase"] = "오후 스캔 중"
        self._save_state()

        ranked = self.kis.get_volume_rank_multi(SCAN_MARKETS)
        self._log(f"거래대금 상위 {len(ranked)}개 종목 조회됨 (ETF/ETN 제외)")
        candidates = []
        rejected: list[dict] = []
        skip_tv, skip_dip = 0, 0

        def reject(stock, reason, **extra):
            if len(rejected) < 20:
                rejected.append({
                    "ticker": stock["ticker"], "name": stock["name"],
                    "change_pct": stock["change_pct"],
                    "trade_value_억": round(stock["trade_value"] / 1e8),
                    "reason": reason, **extra})

        for stock in ranked:
            tv = stock["trade_value"]
            if tv < AFTERNOON_MIN_TRADE_VALUE:
                skip_tv += 1
                reject(stock, "거래대금 미달")
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
                skip_dip += 1
                reject(stock, "낙폭 초과", dip_pct=round(dip_pct, 1))
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
        self.state["afternoon_filter"] = {
            "total": len(ranked),
            "passed": len(candidates),
            "skip_trade_value": skip_tv,
            "skip_dip": skip_dip,
            "rejected": rejected,
        }
        self._log(f"오후 후보 {len(candidates)}개 선정 "
                  f"(탈락: 거래대금 {skip_tv}, 낙폭 {skip_dip})")
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
            now = kst.now()
            if (now.hour, now.minute) >= (15, 25):
                break
            if now.hour < 15:
                time.sleep(30)
                continue

            for c in self.afternoon_candidates:
                if c["status"] not in ("감시중", "진입"):
                    continue

                price = self.kis.get_price(c["ticker"])
                if not price:
                    continue

                current = price["price"]

                # 보유 중이면 손절/익절만 확인
                if c["status"] == "진입":
                    self._check_exit(c, current)
                    time.sleep(0.1)
                    continue

                # 조건별 현재 상태 기록 (웹 실시간 표시용)
                gap = (current - c["day_high"]) / c["day_high"] * 100
                c.update({
                    "current": current,
                    "gap_pct": round(gap, 2),
                    "chk_breakout": current > c["day_high"],
                    "checked_at": now.strftime("%H:%M"),
                })

                if not c["chk_breakout"]:
                    c["vol_ratio"] = None
                    c["blocked_by"] = "돌파 대기"
                    continue

                # 추격 방지 (후보는 유지 — 되돌림 시 재진입 기회)
                if gap > MAX_CHASE_PCT:
                    c["blocked_by"] = "추격 회피"
                    if not c.get("chase_logged"):
                        c["chase_logged"] = True
                        self._log(f"  {c['name']} 전고점 대비 +{gap:.1f}% "
                                  f"— 추격 회피, 되돌림 대기")
                    continue

                # 거래량 폭발 확인
                ratio = self._volume_ratio(c["ticker"])
                c["vol_ratio"] = ratio
                vol_ok = ratio is not None and ratio >= AFTERNOON_VOL_MULTIPLIER
                c["blocked_by"] = None if vol_ok else "거래량 부족"

                if vol_ok:
                    c["entry_price"] = current
                    c["entry_time"] = now.strftime("%H:%M")
                    c["status"] = "진입"
                    c["stop_loss"] = round(current * (1 + STOP_LOSS_PCT / 100))
                    c["take_profit"] = round(
                        current * (1 + TAKE_PROFIT_PCT / 100))
                    signal = {
                        "type": "오후 돌파",
                        "time": now.strftime("%H:%M"),
                        "ticker": c["ticker"],
                        "name": c["name"],
                        "price": current,
                        "day_high": c["day_high"],
                        "reason": f"전고점 {c['day_high']:,}원 돌파 "
                                  f"(현재 {current:,}원) + 거래량 폭발",
                        "stop_loss": c["stop_loss"],
                        "take_profit": c["take_profit"],
                        "deadline": "15:25",
                    }
                    self.signals.append(signal)
                    self._paper_buy(c, current, "오후 돌파")
                    self._log(
                        f"*** 신호: {c['name']} {current:,}원 진입 "
                        f"(손절 {c['stop_loss']:,} / 15:25 청산) ***")

                time.sleep(0.1)

            self._save_state()
            time.sleep(POLL_INTERVAL)

        # 15:25 강제 청산
        for c in self.afternoon_candidates:
            if c["status"] == "진입":
                self._force_close(c, "15:25 청산")
        self.state["phase"] = "장 마감"
        self._save_state()

    # ── 거래량 급증 확인 ──────────────────────

    def _volume_ratio(self, ticker: str) -> float | None:
        """
        직전 1분봉 거래량이 그 앞 20분 평균의 몇 배인지 반환 (없으면 None)

        불리언 대신 배수를 돌려주어 '2.1배 / 필요 3.0배'처럼 얼마나
        모자란지 화면에 보여줄 수 있게 한다.
        """
        try:
            # 현재 시각까지의 최근 21개 (직전 1분 + 그 앞 20분)
            candles = self.kis.get_minute_candles(ticker, count=21)
            if len(candles) < 21:
                return None
            recent = candles[-1]["volume"]
            avg_20 = sum(c["volume"] for c in candles[-21:-1]) / 20
            if avg_20 <= 0:
                return None
            return round(recent / avg_20, 2)
        except Exception:
            return None

    # ── 메인 루프 ──────────────────────────────

    def run(self, test: bool = False):
        today = kst.now().strftime("%Y-%m-%d")
        self.state["date"] = today
        self._log(f"스캐너 시작 ({today})")

        if test:
            self._log("테스트 모드 — 즉시 오전+오후 스캔 실행")
            self.morning_scan()
            self.afternoon_scan()
            return

        # 한 번 띄워두면 매 거래일을 알아서 처리한다 (종료하지 않음).
        # 각 단계는 '정확한 분'이 아니라 '구간'으로 판정한다. 정각 조건은
        # 스캔이 1분 넘게 걸리거나 늦게 기동하면 그날 단계를 통째로 건너뛴다.
        done: set[str] = set()
        cur_date: str | None = None

        while True:
            now = kst.now()
            today = now.strftime("%Y-%m-%d")

            if today != cur_date:          # 날짜가 바뀌면 하루치 상태 초기화
                cur_date = today
                done.clear()
                self._reset_day(today)

            if now.weekday() >= 5:         # 토/일은 조회 자체가 무의미
                self.state["phase"] = "휴장 (주말)"
                self._save_state()
                time.sleep(600)
                continue

            hm = (now.hour, now.minute)

            if "m_scan" not in done and (9, 30) <= hm < (10, 0):
                done.add("m_scan")
                self.morning_scan()
            elif "m_mon" not in done and (10, 0) <= hm < (11, 30):
                done.add("m_mon")
                self.morning_monitor()
            elif "a_scan" not in done and (14, 50) <= hm < (15, 0):
                done.add("a_scan")
                self.afternoon_scan()
            elif "a_mon" not in done and (15, 0) <= hm < (15, 25):
                done.add("a_mon")
                self.afternoon_monitor()
            else:
                self.state["phase"] = self._idle_phase(hm)
                self._save_state()
                time.sleep(30)

    def _idle_phase(self, hm: tuple[int, int]) -> str:
        if hm < (9, 0):
            return "장 시작 전"
        if hm < (9, 30):
            return "관찰 (09:00~09:30)"
        if hm < (10, 0):
            return "오전 감시 대기"
        if hm < (14, 50):
            return "점심 휴식"
        if hm < (15, 25):
            return "오후 감시 대기"
        return "장 마감"

    def _reset_day(self, today: str):
        """새 거래일 시작 — 전일 후보/신호를 비우고 미청산 포지션을 정리"""
        self.state["date"] = today
        self.morning_candidates = []
        self.afternoon_candidates = []
        self.signals = []
        if self.paper:
            dropped = self.paper.drop_stale(today)
            for d in dropped:
                self._log(f"  [모의] {d['name']} 전일 미청산 포지션 폐기 "
                          f"(청산가 불명 — 성과 집계에서 제외)")
        self.state["phase"] = "대기"
        self._save_state()
        self._log(f"=== {today} 거래일 시작 ===")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="장중 실시간 스캐너")
    parser.add_argument("--test", action="store_true",
                        help="즉시 오전 스캔 테스트")
    args = parser.parse_args()
    DayScanner().run(test=args.test)

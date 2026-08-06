"""
모의매매(페이퍼 트레이딩) 기록 — 스캐너 신호대로 가상 매매하고 성과를 집계

실제 주문은 전혀 내지 않는다. 스캐너가 진입/청산 신호를 낼 때마다
가상 체결을 기록해 두고, 승률·손익비·누적 수익을 계산한다.
조건(박스폭, 손절폭, 거래량 배수 등)이 실제로 먹히는지 검증하는 용도.

메모리/용량:
    pandas를 쓰지 않고 dict + json만 사용한다. 거래 1건이 약 250바이트라
    1,000건을 쌓아도 250KB 수준. 1GB 서버에서 부담 없다.
    파일이 무한정 커지지 않도록 최근 MAX_TRADES건만 보관한다.

저장: .cache/paper_trades.json
"""

import json
from datetime import datetime

from paths import CACHE_DIR

TRADES_PATH = CACHE_DIR / "paper_trades.json"

# 1회 매매당 투입 금액 (실제 계좌와 무관한 가상 금액)
POSITION_SIZE = 1_000_000

# 거래비용 — 증권사·세법에 따라 다르므로 실제 조건에 맞게 조정할 것
FEE_RATE = 0.00015   # 위탁수수료: 매수/매도 각각 부과 (온라인 기준 약 0.015%)
TAX_RATE = 0.0015    # 증권거래세+농어촌특별세: 매도 시에만 부과 (약 0.15%)

MAX_TRADES = 2000    # 보관할 최대 거래 건수 (초과 시 오래된 것부터 삭제)


class PaperTrader:
    """가상 포지션 관리 + 성과 집계"""

    def __init__(self, position_size: int = POSITION_SIZE):
        self.position_size = position_size
        self.trades: list[dict] = []      # 청산 완료된 거래
        self.open: dict[str, dict] = {}   # 보유 중 (ticker -> 포지션)
        self._load()

    # ── 저장/로드 ──────────────────────────────

    def _load(self):
        if not TRADES_PATH.exists():
            return
        try:
            data = json.loads(TRADES_PATH.read_text(encoding="utf-8"))
            self.trades = data.get("trades", [])
            self.open = data.get("open", {})
        except Exception:
            self.trades, self.open = [], {}

    def save(self):
        if len(self.trades) > MAX_TRADES:
            self.trades = self.trades[-MAX_TRADES:]
        CACHE_DIR.mkdir(exist_ok=True)
        TRADES_PATH.write_text(json.dumps({
            "trades": self.trades,
            "open": self.open,
            "stats": self.stats(),
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 매매 ──────────────────────────────────

    def buy(self, ticker: str, name: str, price: int, kind: str,
            stop_loss: int | None = None,
            take_profit: int | None = None) -> dict | None:
        """
        가상 매수. 이미 보유 중이면 중복 진입하지 않는다.
        반환: 생성된 포지션 (진입 불가면 None)
        """
        if ticker in self.open or price <= 0:
            return None
        qty = self.position_size // price
        if qty < 1:          # 1주도 못 사는 고가주는 건너뜀
            return None

        cost = qty * price
        pos = {
            "ticker": ticker,
            "name": name,
            "kind": kind,                 # "오전 돌파" / "오후 돌파"
            "date": datetime.now().strftime("%Y-%m-%d"),
            "entry_time": datetime.now().strftime("%H:%M:%S"),
            "entry_price": price,
            "qty": qty,
            "cost": cost,
            "entry_fee": round(cost * FEE_RATE),
            "stop_loss": stop_loss,
            "take_profit": take_profit,
        }
        self.open[ticker] = pos
        self.save()
        return pos

    def sell(self, ticker: str, price: int, reason: str) -> dict | None:
        """
        가상 매도 → 수수료·세금을 반영한 실현 손익을 기록.
        반환: 청산된 거래 (보유 중이 아니면 None)
        """
        pos = self.open.pop(ticker, None)
        if pos is None or price <= 0:
            return None

        qty = pos["qty"]
        proceeds = qty * price
        exit_fee = round(proceeds * FEE_RATE)
        tax = round(proceeds * TAX_RATE)
        invested = pos["cost"] + pos["entry_fee"]
        net = proceeds - exit_fee - tax - invested

        trade = {
            **pos,
            "exit_time": datetime.now().strftime("%H:%M:%S"),
            "exit_price": price,
            "exit_fee": exit_fee,
            "tax": tax,
            "reason": reason,
            "net_pnl": net,
            "pnl_pct": round(net / invested * 100, 2) if invested else 0.0,
            # 비용을 뺀 순수 가격 변동분 (비용 영향을 가늠하는 용도)
            "gross_pct": round(
                (price - pos["entry_price"]) / pos["entry_price"] * 100, 2),
        }
        self.trades.append(trade)
        self.save()
        return trade

    def has(self, ticker: str) -> bool:
        return ticker in self.open

    # ── 성과 집계 ──────────────────────────────

    def stats(self, kind: str | None = None) -> dict:
        """승률·손익비·누적 손익. kind를 주면 해당 유형만 집계."""
        rows = [t for t in self.trades
                if kind is None or t.get("kind") == kind]
        if not rows:
            return {"trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
                    "total_pnl": 0, "avg_pnl_pct": 0.0, "avg_win_pct": 0.0,
                    "avg_loss_pct": 0.0, "profit_factor": 0.0,
                    "total_cost": 0, "best_pct": 0.0, "worst_pct": 0.0}

        wins = [t for t in rows if t["net_pnl"] > 0]
        losses = [t for t in rows if t["net_pnl"] <= 0]
        gain = sum(t["net_pnl"] for t in wins)
        loss = abs(sum(t["net_pnl"] for t in losses))
        pcts = [t["pnl_pct"] for t in rows]

        def avg(xs):
            return round(sum(xs) / len(xs), 2) if xs else 0.0

        return {
            "trades": len(rows),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(rows) * 100, 1),
            "total_pnl": sum(t["net_pnl"] for t in rows),
            "avg_pnl_pct": avg(pcts),
            "avg_win_pct": avg([t["pnl_pct"] for t in wins]),
            "avg_loss_pct": avg([t["pnl_pct"] for t in losses]),
            # 총이익/총손실 — 1.0 미만이면 전략이 돈을 잃고 있다는 뜻
            "profit_factor": round(gain / loss, 2) if loss else 0.0,
            "total_cost": sum(t["entry_fee"] + t["exit_fee"] + t["tax"]
                              for t in rows),
            "best_pct": max(pcts),
            "worst_pct": min(pcts),
        }

    def summary(self) -> dict:
        """웹 표시용 — 전체 + 유형별 성과와 최근 거래 내역"""
        return {
            "position_size": self.position_size,
            "overall": self.stats(),
            "morning": self.stats("오전 돌파"),
            "afternoon": self.stats("오후 돌파"),
            "open": list(self.open.values()),
            "recent": list(reversed(self.trades[-30:])),
            "fee_rate_pct": FEE_RATE * 100,
            "tax_rate_pct": TAX_RATE * 100,
        }

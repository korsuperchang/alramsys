"""
보유 종목 장부 (포트폴리오 원장)
- 주식앱에서 실제 체결한 매수/매도를 여기에 기록하면 dashboard.py가 손익을 계산
- 저장: data/portfolio.json (개인 데이터 → git 추적 제외)
- 평균단가: 이동평균법 (매수 시 평단 갱신, 매도 시 평단 유지 + 실현손익 기록)

사용법:
    python portfolio.py add  --market KOSPI  --ticker 005930 --qty 10 --price 71000 --name 삼성전자
    python portfolio.py add  --market NASDAQ --ticker AAPL   --qty 5  --price 230.5
    python portfolio.py sell --market KOSPI  --ticker 005930 --qty 3  --price 75000
    python portfolio.py list          # 거래 내역
    python portfolio.py holdings      # 현재 보유 현황 (현재가 조회 없음)
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
LEDGER_PATH = DATA_DIR / "portfolio.json"

MARKETS = ("KOSPI", "KOSDAQ", "NASDAQ")


# ─────────────────────────────────────────────
# 원장 입출력
# ─────────────────────────────────────────────
def load_ledger(path: Path = LEDGER_PATH) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def save_ledger(ledger: list[dict], path: Path = LEDGER_PATH) -> None:
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2),
                    encoding="utf-8")


def add_transaction(ledger: list[dict], side: str, market: str, ticker: str,
                    qty: float, price: float, name: str | None = None,
                    tx_date: str | None = None) -> list[dict]:
    assert side in ("buy", "sell")
    assert market in MARKETS, f"지원 시장: {MARKETS}"
    assert qty > 0 and price > 0, "수량/가격은 양수여야 합니다"

    if side == "sell":
        held = holdings(ledger).get((market, ticker), {}).get("qty", 0)
        if qty > held:
            raise ValueError(
                f"매도 수량({qty})이 보유 수량({held})을 초과합니다: {market}/{ticker}")

    ledger.append({
        "date": tx_date or date.today().isoformat(),
        "market": market,
        "ticker": ticker,
        "name": name or _existing_name(ledger, market, ticker) or ticker,
        "side": side,
        "qty": qty,
        "price": price,
    })
    return ledger


def _existing_name(ledger: list[dict], market: str, ticker: str) -> str | None:
    for tx in reversed(ledger):
        if tx["market"] == market and tx["ticker"] == ticker:
            return tx.get("name")
    return None


# ─────────────────────────────────────────────
# 보유 현황 계산 (이동평균법)
# ─────────────────────────────────────────────
def holdings(ledger: list[dict]) -> dict[tuple[str, str], dict]:
    """
    (market, ticker) → {name, qty, avg_price, invested, realized_pnl}
    - invested = 현재 보유분의 매입원가 (qty × avg_price)
    - realized_pnl = 매도로 확정된 손익 누적
    """
    pos: dict[tuple[str, str], dict] = {}
    for tx in sorted(ledger, key=lambda t: t["date"]):
        key = (tx["market"], tx["ticker"])
        p = pos.setdefault(key, {"name": tx.get("name", tx["ticker"]),
                                 "qty": 0.0, "avg_price": 0.0,
                                 "realized_pnl": 0.0})
        p["name"] = tx.get("name", p["name"])
        if tx["side"] == "buy":
            total_cost = p["avg_price"] * p["qty"] + tx["price"] * tx["qty"]
            p["qty"] += tx["qty"]
            p["avg_price"] = total_cost / p["qty"]
        else:  # sell
            p["realized_pnl"] += (tx["price"] - p["avg_price"]) * tx["qty"]
            p["qty"] -= tx["qty"]

    for p in pos.values():
        p["invested"] = p["qty"] * p["avg_price"]
    return pos


def active_holdings(ledger: list[dict]) -> dict[tuple[str, str], dict]:
    """수량이 남아있는 종목만 (전량 매도 종목은 실현손익 집계에만 반영)"""
    return {k: v for k, v in holdings(ledger).items() if v["qty"] > 1e-9}


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="보유 종목 장부 관리")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for side in ("add", "sell"):
        p = sub.add_parser(side, help="매수 기록" if side == "add" else "매도 기록")
        p.add_argument("--market", required=True, choices=MARKETS)
        p.add_argument("--ticker", required=True)
        p.add_argument("--qty", required=True, type=float)
        p.add_argument("--price", required=True, type=float)
        p.add_argument("--name", default=None, help="종목명 (최초 기록 시)")
        p.add_argument("--date", default=None, help="체결일 YYYY-MM-DD (기본: 오늘)")

    sub.add_parser("list", help="거래 내역 출력")
    sub.add_parser("holdings", help="보유 현황 출력 (현재가 조회 없음)")

    args = parser.parse_args()
    ledger = load_ledger()

    if args.cmd in ("add", "sell"):
        side = "buy" if args.cmd == "add" else "sell"
        add_transaction(ledger, side, args.market, args.ticker,
                        args.qty, args.price, args.name, args.date)
        save_ledger(ledger)
        verb = "매수" if side == "buy" else "매도"
        print(f"기록 완료: [{args.market}] {args.ticker} {verb} "
              f"{args.qty:g}주 @ {args.price:,g}")

    elif args.cmd == "list":
        if not ledger:
            print("거래 내역이 없습니다. 'python portfolio.py add ...'로 기록하세요.")
            return
        for tx in sorted(ledger, key=lambda t: t["date"]):
            verb = "매수" if tx["side"] == "buy" else "매도"
            print(f"{tx['date']}  [{tx['market']}] {tx['name']}({tx['ticker']}) "
                  f"{verb} {tx['qty']:g}주 @ {tx['price']:,g}")

    elif args.cmd == "holdings":
        pos = active_holdings(ledger)
        if not pos:
            print("보유 종목이 없습니다.")
            return
        for (market, ticker), p in pos.items():
            print(f"[{market}] {p['name']}({ticker}): {p['qty']:g}주, "
                  f"평단 {p['avg_price']:,.2f}, 매입금액 {p['invested']:,.0f}")


if __name__ == "__main__":
    sys.exit(main())

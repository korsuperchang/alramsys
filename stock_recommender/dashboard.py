"""
투자 손익 대시보드 — '조회' 시점에만 현재가를 가져와 평가손익을 계산 (상시 폴링 없음)

사용법:
    python dashboard.py                # 터미널에 1회 조회 결과 출력
    python dashboard.py --web          # 로컬 웹 대시보드 (브라우저에서 [조회] 버튼 클릭 시 갱신)
    python dashboard.py --web --port 8899
    python dashboard.py --demo         # 장부 없이 합성 데이터로 화면 확인

전제: portfolio.py 로 매수/매도 내역을 기록해둘 것
    python portfolio.py add --market KOSPI --ticker 005930 --qty 10 --price 71000 --name 삼성전자
"""

import argparse
import json
import math
import sys
from datetime import datetime

import portfolio
import quotes

CURRENCY = {"KOSPI": "원", "KOSDAQ": "원", "NASDAQ": "$"}


# ─────────────────────────────────────────────
# 평가 계산 (조회 1회 = 시세 조회 1회)
# ─────────────────────────────────────────────
def build_snapshot(ledger: list[dict], demo: bool = False) -> dict:
    """
    보유 종목 → 현재가 조회 → 종목별/시장별 평가손익
    반환: {"as_of": ..., "rows": [...], "totals": {market: {...}}, "realized": {...}}
    """
    pos = portfolio.active_holdings(ledger)
    all_pos = portfolio.holdings(ledger)

    # 시장별로 묶어 시세 조회 (시장당 1회)
    by_market: dict[str, list[str]] = {}
    for (market, ticker) in pos:
        by_market.setdefault(market, []).append(ticker)

    quote_map: dict[tuple[str, str], dict] = {}
    for market, tickers in by_market.items():
        hint = {t: pos[(market, t)]["avg_price"] for t in tickers}
        q = quotes.get_quotes(market, tickers, demo=demo, demo_hint=hint)
        for t, v in q.items():
            quote_map[(market, t)] = v

    rows, totals = [], {}
    for (market, ticker), p in pos.items():
        q = quote_map.get((market, ticker))
        row = {
            "market": market, "ticker": ticker, "name": p["name"],
            "qty": p["qty"], "avg_price": p["avg_price"],
            "invested": p["invested"],
        }
        if q:
            price, prev = q["price"], q.get("prev_close")
            value = price * p["qty"]
            row.update({
                "price": price,
                "day_change_pct": (price / prev - 1) * 100
                if prev and not math.isnan(prev) and prev > 0 else None,
                "value": value,
                "pnl": value - p["invested"],
                "pnl_pct": (value / p["invested"] - 1) * 100
                if p["invested"] > 0 else None,
                "source": q["source"],
            })
            t = totals.setdefault(market, {"invested": 0.0, "value": 0.0})
            t["invested"] += p["invested"]
            t["value"] += value
        else:
            row.update({"price": None, "day_change_pct": None, "value": None,
                        "pnl": None, "pnl_pct": None, "source": "조회불가"})
        rows.append(row)

    for t in totals.values():
        t["pnl"] = t["value"] - t["invested"]
        t["pnl_pct"] = (t["value"] / t["invested"] - 1) * 100 \
            if t["invested"] > 0 else None

    realized = {}
    for (market, _), p in all_pos.items():
        if abs(p["realized_pnl"]) > 1e-9:
            realized[market] = realized.get(market, 0.0) + p["realized_pnl"]

    return {"as_of": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "rows": rows, "totals": totals, "realized": realized}


# ─────────────────────────────────────────────
# 터미널 출력
# ─────────────────────────────────────────────
def _fmt(v, market, decimals=None):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    d = decimals if decimals is not None else (0 if market != "NASDAQ" else 2)
    return f"{v:,.{d}f}"


def print_snapshot(snap: dict) -> None:
    print(f"\n{'='*86}")
    print(f" 투자 손익 대시보드 | 조회시각: {snap['as_of']}")
    print(f"{'='*86}")

    if not snap["rows"]:
        print("\n보유 종목이 없습니다. 'python portfolio.py add ...'로 기록하세요.\n")
        return

    header = (f"{'시장':<7}{'종목':<14}{'수량':>8}{'평단':>12}{'현재가':>12}"
              f"{'전일比%':>9}{'평가금액':>14}{'평가손익':>13}{'수익률%':>9}")
    print(header)
    print("-" * 86)
    for r in snap["rows"]:
        m = r["market"]
        print(f"{m:<7}"
              f"{r['name'][:12]:<14}"
              f"{r['qty']:>8g}"
              f"{_fmt(r['avg_price'], m):>12}"
              f"{_fmt(r['price'], m):>12}"
              f"{_fmt(r['day_change_pct'], m, 2):>9}"
              f"{_fmt(r['value'], m):>14}"
              f"{_fmt(r['pnl'], m):>13}"
              f"{_fmt(r['pnl_pct'], m, 2):>9}")

    print("-" * 86)
    for market, t in snap["totals"].items():
        unit = CURRENCY[market]
        print(f"[{market}] 매입 {_fmt(t['invested'], market)}{unit} → "
              f"평가 {_fmt(t['value'], market)}{unit} | "
              f"손익 {_fmt(t['pnl'], market)}{unit} "
              f"({_fmt(t['pnl_pct'], market, 2)}%)")
    for market, v in snap["realized"].items():
        print(f"[{market}] 실현손익(매도 확정): {_fmt(v, market)}{CURRENCY[market]}")
    print()


# ─────────────────────────────────────────────
# 웹 대시보드 (stdlib http.server — [조회] 버튼을 누를 때만 시세 조회)
# ─────────────────────────────────────────────
HTML_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>투자 손익 대시보드</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif;
         max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.3rem; }
  button { font-size: 1rem; padding: .55rem 1.6rem; cursor: pointer;
           border-radius: 8px; border: 1px solid #888; }
  button:disabled { opacity: .5; cursor: wait; }
  #asof { color: #888; margin-left: 1rem; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { padding: .45rem .6rem; text-align: right;
           border-bottom: 1px solid #ddd; white-space: nowrap; }
  th:nth-child(-n+2), td:nth-child(-n+2) { text-align: left; }
  .up { color: #d32f2f; }    /* 한국식: 상승 = 빨강 */
  .down { color: #1976d2; }  /* 하락 = 파랑 */
  .totals { margin-top: 1rem; line-height: 1.7; }
  .note { color: #888; font-size: .85rem; margin-top: 1.5rem; }
  .wrap { overflow-x: auto; }
</style></head><body>
<h1>투자 손익 대시보드</h1>
<p>
  <button id="btn" onclick="refresh()">조회</button>
  <span id="asof">아직 조회하지 않음 — [조회]를 누르면 현재 시세를 가져옵니다</span>
</p>
<div class="wrap"><table id="tbl" style="display:none">
  <thead><tr><th>시장</th><th>종목</th><th>수량</th><th>평단</th><th>현재가</th>
  <th>전일比</th><th>평가금액</th><th>평가손익</th><th>수익률</th></tr></thead>
  <tbody></tbody>
</table></div>
<div class="totals" id="totals"></div>
<p class="note">※ [조회]를 누른 시점에만 시세를 가져옵니다 (상시 모니터링 아님).
시세 출처: 네이버(한국, 실시간) / Yahoo(나스닥, 약 15분 지연).
본 화면은 참고용이며 투자 손실 책임은 투자자 본인에게 있습니다.</p>
<script>
function fmt(v, market, d) {
  if (v === null || v === undefined) return '-';
  const dec = (d !== undefined) ? d : (market === 'NASDAQ' ? 2 : 0);
  return v.toLocaleString('ko-KR', {minimumFractionDigits: dec, maximumFractionDigits: dec});
}
function cls(v) { return v === null || v === undefined ? '' : (v > 0 ? 'up' : v < 0 ? 'down' : ''); }
function sign(v, s) { return (v > 0 ? '+' : '') + s; }
async function refresh() {
  const btn = document.getElementById('btn');
  btn.disabled = true; btn.textContent = '조회 중…';
  try {
    const snap = await (await fetch('/api/refresh')).json();
    document.getElementById('asof').textContent = '조회시각: ' + snap.as_of;
    const tbody = document.querySelector('#tbl tbody');
    tbody.innerHTML = '';
    for (const r of snap.rows) {
      const unit = r.market === 'NASDAQ' ? '$' : '';
      tbody.insertAdjacentHTML('beforeend', `<tr>
        <td>${r.market}</td><td>${r.name}<br><small style="color:#888">${r.ticker}</small></td>
        <td>${fmt(r.qty, r.market, 0)}</td>
        <td>${unit}${fmt(r.avg_price, r.market)}</td>
        <td>${r.price === null ? '조회불가' : unit + fmt(r.price, r.market)}</td>
        <td class="${cls(r.day_change_pct)}">${r.day_change_pct === null ? '-' : sign(r.day_change_pct, fmt(r.day_change_pct, r.market, 2) + '%')}</td>
        <td>${unit}${fmt(r.value, r.market)}</td>
        <td class="${cls(r.pnl)}">${r.pnl === null ? '-' : sign(r.pnl, unit + fmt(r.pnl, r.market))}</td>
        <td class="${cls(r.pnl_pct)}">${r.pnl_pct === null ? '-' : sign(r.pnl_pct, fmt(r.pnl_pct, r.market, 2) + '%')}</td>
      </tr>`);
    }
    document.getElementById('tbl').style.display = snap.rows.length ? '' : 'none';
    let html = '';
    for (const [m, t] of Object.entries(snap.totals)) {
      const unit = m === 'NASDAQ' ? '$' : '원';
      html += `<b>[${m}]</b> 매입 ${fmt(t.invested, m)}${unit} → 평가 ${fmt(t.value, m)}${unit}
        | 손익 <span class="${cls(t.pnl)}">${sign(t.pnl, fmt(t.pnl, m) + unit)}
        (${sign(t.pnl_pct, fmt(t.pnl_pct, m, 2))}%)</span><br>`;
    }
    for (const [m, v] of Object.entries(snap.realized))
      html += `<b>[${m}]</b> 실현손익(매도 확정): <span class="${cls(v)}">${sign(v, fmt(v, m) + (m === 'NASDAQ' ? '$' : '원'))}</span><br>`;
    if (!snap.rows.length) html = '보유 종목이 없습니다. portfolio.py로 매수 내역을 기록하세요.';
    document.getElementById('totals').innerHTML = html;
  } catch (e) {
    document.getElementById('asof').textContent = '조회 실패: ' + e;
  } finally {
    btn.disabled = false; btn.textContent = '조회';
  }
}
</script></body></html>"""


def serve_web(port: int, demo: bool) -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/" or self.path.startswith("/index"):
                body = HTML_PAGE.encode("utf-8")
                self._respond(body, "text/html; charset=utf-8")
            elif self.path.startswith("/api/refresh"):
                # 버튼을 누른 이 시점에만 장부 재로드 + 시세 조회
                ledger = _load_ledger(demo)
                snap = build_snapshot(ledger, demo=demo)
                body = json.dumps(snap, ensure_ascii=False).encode("utf-8")
                self._respond(body, "application/json; charset=utf-8")
            else:
                self.send_error(404)

        def _respond(self, body: bytes, ctype: str):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):  # 요청 로그 간소화
            if "/api/" in (args[0] if args else ""):
                print(f"  조회 요청 처리: {datetime.now().strftime('%H:%M:%S')}")

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\n대시보드 실행 중: http://127.0.0.1:{port}"
          + ("  [DEMO 모드]" if demo else ""))
    print("브라우저에서 [조회] 버튼을 누를 때만 시세를 가져옵니다. 종료: Ctrl+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n대시보드를 종료합니다.")


# ─────────────────────────────────────────────
def _demo_ledger() -> list[dict]:
    """화면 확인용 가상 장부"""
    ledger: list[dict] = []
    for args in [
        ("buy", "KOSPI", "005930", 10, 71000, "삼성전자", "2026-06-15"),
        ("buy", "KOSPI", "005930", 5, 74000, "삼성전자", "2026-06-29"),
        ("buy", "KOSDAQ", "247540", 3, 195000, "에코프로비엠", "2026-06-20"),
        ("buy", "NASDAQ", "AAPL", 8, 228.5, "Apple", "2026-06-18"),
        ("buy", "NASDAQ", "NVDA", 4, 172.3, "NVIDIA", "2026-06-25"),
        ("sell", "KOSPI", "005930", 3, 76500, "삼성전자", "2026-07-03"),
    ]:
        portfolio.add_transaction(ledger, *args[:1], *args[1:6], tx_date=args[6])
    return ledger


def _load_ledger(demo: bool) -> list[dict]:
    if demo:
        return _demo_ledger()
    return portfolio.load_ledger()


def main():
    parser = argparse.ArgumentParser(description="투자 손익 대시보드 (조회형)")
    parser.add_argument("--web", action="store_true",
                        help="로컬 웹 대시보드 실행 (버튼 클릭 시 갱신)")
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--demo", action="store_true",
                        help="가상 장부 + 합성 시세로 화면 확인")
    args = parser.parse_args()

    if args.web:
        serve_web(args.port, args.demo)
    else:
        snap = build_snapshot(_load_ledger(args.demo), demo=args.demo)
        print_snapshot(snap)


if __name__ == "__main__":
    sys.exit(main())

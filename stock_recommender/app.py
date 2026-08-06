"""
종목추천 + 포트폴리오 통합 웹 대시보드

오라클 서버에서 실행 → 브라우저로 접속

    python app.py                        # http://0.0.0.0:8899
    python app.py --port 9000            # 포트 지정
    python app.py --demo                 # 합성 데이터로 화면 확인 (API 불필요)

오라클 클라우드 방화벽(인그레스 규칙)에서 해당 포트를 열어야 외부 접속 가능.
"""

import argparse
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pandas as pd

import cache
import portfolio
import quotes
from config import HORIZONS

# ─────────────────────────────────────────────
# 추천 엔진 (recommend.py 로직 재사용)
# ─────────────────────────────────────────────
def run_recommend(market: str, demo: bool, as_of: str | None = None,
                  set_stage=lambda s: None):
    from factors import build_factor_table
    from scoring import run_scoring, top_recommendations

    as_of = as_of or pd.Timestamp.today().strftime("%Y-%m-%d")

    if demo:
        from demo_data import DemoAdapter
        adapter = DemoAdapter(market)
    elif market in ("KOSPI", "KOSDAQ"):
        from adapters.korea import KoreaAdapter
        adapter = KoreaAdapter(market)
    else:
        from adapters.nasdaq import NasdaqAdapter
        adapter = NasdaqAdapter()

    set_stage("가격 데이터 수집 중 (첫 실행은 수십 분 소요, 이후엔 캐시로 단축)")
    price_df = adapter.get_price_data(as_of)
    set_stage("재무/수급 스냅샷 수집 중")
    snapshot_df = adapter.get_snapshot(as_of)
    set_stage("팩터 계산 및 스코어링 중")
    table = build_factor_table(price_df, snapshot_df)
    try:
        scored = run_scoring(table, market)
    except ValueError:
        prev_day = (pd.Timestamp(as_of)
                    - pd.tseries.offsets.BDay(1)).strftime("%Y-%m-%d")
        set_stage(f"당일 데이터 부족 — {prev_day} 기준 재시도 중")
        price_df = adapter.get_price_data(prev_day)
        snapshot_df = adapter.get_snapshot(prev_day)
        table = build_factor_table(price_df, snapshot_df)
        scored = run_scoring(table, market)
        as_of = prev_day
    recs = top_recommendations(scored)

    horizon_labels = {
        "short": f"단기 ({HORIZONS['short']}일)",
        "mid": f"중기 ({HORIZONS['mid']}일)",
        "long": f"장기 ({HORIZONS['long']}일)",
        "composite": "종합",
    }

    from explain import build_reason

    # 추천 종목의 업체정보(기업개요) 일괄 조회
    all_tickers = list({
        r.get("ticker", "") for df in recs.values() for _, r in df.iterrows()
        if r.get("ticker")})
    if market in ("KOSPI", "KOSDAQ") and all_tickers:
        set_stage("업체정보 조회 중")
        try:
            from company_info import get_company_descs
            descs = get_company_descs(all_tickers)
        except Exception:
            descs = {}
    else:
        descs = {}

    result = {}
    for key, df in recs.items():
        rows = []
        sectors = []
        for _, r in df.iterrows():
            sector = r.get("sector")
            sector = None if sector is None or pd.isna(sector) else str(sector)
            sectors.append(sector or "미분류")
            ticker = r.get("ticker", "")
            rows.append({
                "ticker": ticker,
                "name": r.get("name", ""),
                "sector": sector,
                "desc": descs.get(ticker),
                "momentum": _safe(r, "cat_momentum"),
                "value": _safe(r, "cat_value"),
                "quality": _safe(r, "cat_quality"),
                "flow": _safe(r, "cat_flow"),
                "sentiment": _safe(r, "cat_sentiment"),
                "score": _safe(r, f"score_{key}"),
                "reason": build_reason(r, key),
            })
        # 섹터 분포 요약 (쏠림 육안 점검용)
        counts = pd.Series(sectors).value_counts() if sectors else pd.Series(dtype=int)
        summary = " · ".join(f"{s} {c}" for s, c in counts.items())
        # 쏠림 경고는 실제 업종에만 (미분류는 데이터 부재이지 쏠림이 아님)
        if len(counts) and counts.index[0] != "미분류" \
                and counts.iloc[0] >= max(3, len(sectors) - 1):
            summary += " ⚠ 섹터 쏠림 주의"
        result[key] = {"label": horizon_labels[key], "rows": rows,
                       "sector_summary": summary}

    return {"market": market, "as_of": as_of,
            "universe_count": len(scored), "recommendations": result}


def _safe(row, col):
    v = row.get(col)
    if v is None or pd.isna(v):
        return None
    return round(float(v), 1)


# ─────────────────────────────────────────────
# 포트폴리오 손익 (dashboard.py 로직 재사용)
# ─────────────────────────────────────────────
def portfolio_snapshot(demo: bool):
    import dashboard
    ledger = dashboard._load_ledger(demo)
    return dashboard.build_snapshot(ledger, demo=demo)


# ─────────────────────────────────────────────
# 종목 검색 (포트폴리오 입력 자동완성)
# ─────────────────────────────────────────────
_stock_list_cache: dict[str, dict] = {}


def _get_stock_list(market: str) -> list[dict]:
    today = pd.Timestamp.today().strftime("%Y%m%d")
    cached = _stock_list_cache.get(market)
    if cached and cached["date"] == today:
        return cached["stocks"]
    stocks = []
    if market in ("KOSPI", "KOSDAQ"):
        try:
            from pykrx import stock as krx
            tickers = krx.get_market_ticker_list(today, market=market)
            for t in tickers:
                try:
                    stocks.append({"ticker": t,
                                   "name": krx.get_market_ticker_name(t) or t})
                except Exception:
                    stocks.append({"ticker": t, "name": t})
        except Exception:
            pass
    _stock_list_cache[market] = {"date": today, "stocks": stocks}
    return stocks


def _search_stocks(market: str, query: str, limit: int = 15) -> list[dict]:
    if not query:
        return []
    stocks = _get_stock_list(market)
    q = query.strip().lower()
    exact, partial = [], []
    for s in stocks:
        if q == s["ticker"].lower() or q == s["name"].lower():
            exact.append(s)
        elif q in s["ticker"].lower() or q in s["name"].lower():
            partial.append(s)
    return (exact + partial)[:limit]


def _lookup_stock(market: str, ticker: str) -> dict:
    result = {"ticker": ticker}
    if market in ("KOSPI", "KOSDAQ"):
        try:
            from pykrx import stock as krx
            result["name"] = krx.get_market_ticker_name(ticker) or ""
        except Exception:
            result["name"] = ""
    elif market == "NASDAQ":
        try:
            import yfinance as yf
            info = yf.Ticker(ticker).info
            result["name"] = info.get("shortName") or info.get("longName") or ""
        except Exception:
            result["name"] = ""
    q = quotes.get_quotes(market, [ticker])
    if ticker in q:
        result["price"] = q[ticker]["price"]
    return result


# ─────────────────────────────────────────────
# 추천 백그라운드 작업 관리
# HTTP 요청 하나로 수십 분을 버티면 모바일 브라우저가 타임아웃되므로,
# 작업은 스레드로 돌리고 브라우저는 몇 초마다 상태만 폴링한다.
# 완료된 결과는 디스크에 저장되어 서버 재시작/다른 기기에서도 재사용.
# ─────────────────────────────────────────────
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def _recs_cache_kind(demo: bool) -> str:
    return "recs_demo" if demo else "recs"


def _start_job(market: str, demo: bool) -> dict:
    job = {"status": "running", "stage": "준비 중", "started": time.time()}
    JOBS[market] = job

    def work():
        try:
            result = run_recommend(
                market, demo,
                set_stage=lambda s: job.__setitem__("stage", s))
            job["result"] = result
            job["status"] = "done"
            cache.save(_recs_cache_kind(demo), market, result["as_of"], result)
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)
            print(f"[추천 실패] {market}: {traceback.format_exc()}")

    threading.Thread(target=work, daemon=True).start()
    return job


def _job_status(market: str, demo: bool, force: bool) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(market)
        if job and job["status"] == "running":
            return {"status": "running", "stage": job["stage"],
                    "elapsed": int(time.time() - job["started"])}
        if force:
            _start_job(market, demo)
            return {"status": "running", "stage": "준비 중", "elapsed": 0}

    if job and job["status"] == "done":
        return {"status": "done", "result": job["result"]}
    if job and job["status"] == "error":
        kind = _recs_cache_kind(demo)
        today = pd.Timestamp.today().strftime("%Y-%m-%d")
        prev = cache.latest_before(kind, market, today)
        if prev:
            return {"status": "done", "result": prev[1], "cached": True}
        return {"status": "error", "error": job.get("error", "알 수 없는 오류")}

    # 실행 이력이 없으면 디스크에 저장된 지난 결과라도 보여줌
    kind = _recs_cache_kind(demo)
    today = pd.Timestamp.today().strftime("%Y-%m-%d")
    cached = cache.load(kind, market, today)
    if cached is None:
        prev = cache.latest_before(kind, market, today)
        cached = prev[1] if prev else None
    if cached is not None:
        return {"status": "done", "result": cached, "cached": True}
    return {"status": "idle"}


# ─────────────────────────────────────────────
# HTTP 서버
# ─────────────────────────────────────────────
class DashboardHandler(BaseHTTPRequestHandler):
    demo = False
    pin = None  # 환경변수 DASH_PIN 설정 시 /api/* 요청에 PIN 요구

    def _authorized(self) -> bool:
        if not self.pin:
            return True
        return self.headers.get("X-Dash-Pin") == self.pin

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query)

        if path.startswith("/api/") and not self._authorized():
            self._json({"error": "PIN 필요"}, 401)
            return

        if path == "/":
            self._html(HTML_PAGE)
        elif path == "/api/recommend":
            market = params.get("market", ["KOSPI"])[0]
            force = params.get("force", ["0"])[0] == "1"
            try:
                self._json(_job_status(market, self.demo, force))
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif path == "/api/portfolio":
            try:
                self._json(portfolio_snapshot(self.demo))
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif path == "/api/portfolio/history":
            ledger = portfolio.load_ledger() if not self.demo else []
            self._json({"transactions": ledger})
        elif path == "/api/stock/search":
            market = params.get("market", ["KOSPI"])[0]
            query = params.get("q", [""])[0]
            try:
                self._json({"results": _search_stocks(market, query)})
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif path == "/api/stock/price":
            market = params.get("market", ["KOSPI"])[0]
            ticker = params.get("ticker", [""])[0]
            if not ticker:
                self._json({"error": "종목코드 필요"}, 400)
            else:
                try:
                    self._json(_lookup_stock(market, ticker))
                except Exception as e:
                    self._json({"error": str(e)}, 500)
        elif path == "/api/scanner":
            try:
                sp = Path(__file__).resolve().parent / ".cache" / "scanner_state.json"
                if sp.exists():
                    self._json(json.loads(sp.read_text(encoding="utf-8")))
                else:
                    self._json({"phase": "미실행",
                                "signals": [], "morning_candidates": [],
                                "afternoon_candidates": []})
            except Exception as e:
                self._json({"error": str(e)}, 500)
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if not self._authorized():
            self._json({"error": "PIN 필요"}, 401)
            return

        if self.demo:  # 데모 화면에서 실제 장부가 조작되는 사고 방지
            self._json({"error": "데모 모드에서는 거래 기록을 수정할 수 없습니다. "
                                 "--demo 없이 실행하세요."}, 400)
            return

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._json({"error": "잘못된 JSON"}, 400)
            return

        if path == "/api/portfolio/add":
            try:
                ledger = portfolio.load_ledger()
                portfolio.add_transaction(
                    ledger, "buy", data["market"], data["ticker"],
                    float(data["qty"]), float(data["price"]),
                    data.get("name"), data.get("date"))
                portfolio.save_ledger(ledger)
                self._json({"ok": True})
            except Exception as e:
                self._json({"error": str(e)}, 400)

        elif path == "/api/portfolio/sell":
            try:
                ledger = portfolio.load_ledger()
                portfolio.add_transaction(
                    ledger, "sell", data["market"], data["ticker"],
                    float(data["qty"]), float(data["price"]),
                    data.get("name"), data.get("date"))
                portfolio.save_ledger(ledger)
                self._json({"ok": True})
            except Exception as e:
                self._json({"error": str(e)}, 400)

        elif path == "/api/portfolio/delete":
            try:
                idx = int(data["index"])
                ledger = portfolio.load_ledger()
                if 0 <= idx < len(ledger):
                    removed = ledger.pop(idx)
                    portfolio.save_ledger(ledger)
                    self._json({"ok": True, "removed": removed})
                else:
                    self._json({"error": "잘못된 인덱스"}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
        else:
            self.send_error(404)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, text):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        req = args[0] if args else ""
        if "/api/" in req:
            print(f"  [{datetime.now().strftime('%H:%M:%S')}] {req}")


# ─────────────────────────────────────────────
# HTML (전체 대시보드 — 단일 페이지, 탭 구성)
# ─────────────────────────────────────────────
HTML_PAGE = r"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>주식 종목추천 & 포트폴리오</title>
<style>
:root {
  --bg: #f5f6fa; --card: #fff; --text: #222; --sub: #888;
  --border: #e0e0e0; --accent: #2563eb; --accent2: #1d4ed8;
  --up: #dc2626; --down: #2563eb; --green: #16a34a;
  --input-bg: #f9fafb;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#0f172a; --card:#1e293b; --text:#e2e8f0; --sub:#94a3b8;
  --border:#334155; --accent:#60a5fa; --accent2:#93bbfd;
  --up:#f87171; --down:#60a5fa; --green:#4ade80;
  --input-bg:#1e293b;
}}
*{box-sizing:border-box; margin:0; padding:0;}
body{font-family:-apple-system,'Malgun Gothic','Noto Sans KR',sans-serif;
     background:var(--bg); color:var(--text); line-height:1.5;}

/* 헤더 */
.header{background:var(--card); border-bottom:1px solid var(--border);
        padding:.8rem 1.2rem; display:flex; align-items:center; gap:1rem;
        position:sticky; top:0; z-index:10;}
.header h1{font-size:1.1rem; font-weight:700; white-space:nowrap;}

/* 탭 */
.tabs{display:flex; gap:0; margin-left:auto;}
.tab{padding:.5rem 1.2rem; cursor:pointer; border:none; background:none;
     font-size:.95rem; color:var(--sub); border-bottom:2px solid transparent;
     transition:all .15s;}
.tab.active{color:var(--accent); border-bottom-color:var(--accent); font-weight:600;}
.tab:hover{color:var(--text);}

/* 컨텐츠 */
.container{max-width:1000px; margin:0 auto; padding:1rem;}
.page{display:none;} .page.active{display:block;}
.card{background:var(--card); border:1px solid var(--border);
      border-radius:10px; padding:1.2rem; margin-bottom:1rem;}

/* 버튼 */
.btn{padding:.5rem 1.4rem; border:none; border-radius:7px; cursor:pointer;
     font-size:.9rem; font-weight:500; transition:background .15s;}
.btn-primary{background:var(--accent); color:#fff;}
.btn-primary:hover{background:var(--accent2);}
.btn-primary:disabled{opacity:.5; cursor:wait;}
.btn-sm{padding:.35rem .8rem; font-size:.82rem;}
.btn-danger{background:#ef4444; color:#fff;}
.btn-outline{background:none; border:1px solid var(--border); color:var(--text);}

/* 테이블 */
.tbl-wrap{overflow-x:auto; -webkit-overflow-scrolling:touch;}
table{border-collapse:collapse; width:100%; font-size:.88rem;}
th{text-align:left; padding:.55rem .5rem; border-bottom:2px solid var(--border);
   color:var(--sub); font-weight:600; font-size:.8rem; white-space:nowrap;}
td{padding:.55rem .5rem; border-bottom:1px solid var(--border); white-space:nowrap;}
.r{text-align:right;} .c{text-align:center;}
.up{color:var(--up);} .down{color:var(--down);} .green{color:var(--green);}

/* 폼 */
.form-row{display:flex; flex-wrap:wrap; gap:.5rem; align-items:flex-end;}
.form-group{display:flex; flex-direction:column; gap:.2rem;}
.form-group label{font-size:.78rem; color:var(--sub); font-weight:600;}
.form-group input,.form-group select{
  padding:.4rem .6rem; border:1px solid var(--border); border-radius:6px;
  font-size:.88rem; background:var(--input-bg); color:var(--text); width:auto;}
.form-group input:focus,.form-group select:focus{outline:none; border-color:var(--accent);}

/* 셀렉터 행 */
.ctrl-row{display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; margin-bottom:1rem;}
.market-btn{padding:.4rem 1rem; border:1px solid var(--border); border-radius:20px;
            background:var(--card); cursor:pointer; font-size:.88rem; color:var(--text);
            transition:all .15s;}
.market-btn.active{background:var(--accent); color:#fff; border-color:var(--accent);}

/* 점수 바 */
.score-bar{display:inline-block; height:6px; border-radius:3px;
           background:var(--accent); opacity:.6; vertical-align:middle;}

/* 요약 카드 */
.summary{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
         gap:.8rem; margin-bottom:1rem;}
.stat{text-align:center; padding:.8rem;}
.stat .val{font-size:1.4rem; font-weight:700;}
.stat .lbl{font-size:.78rem; color:var(--sub); margin-top:.15rem;}

/* 알림 */
.toast{position:fixed; bottom:1.5rem; right:1.5rem; background:#1e293b; color:#fff;
       padding:.7rem 1.2rem; border-radius:8px; font-size:.88rem; z-index:100;
       opacity:0; transition:opacity .3s; pointer-events:none;}
.toast.show{opacity:1;}

/* 모바일 */
@media(max-width:600px){
  .header{flex-wrap:wrap;} .tabs{margin-left:0; width:100%;}
  .tab{flex:1; text-align:center; font-size:.85rem; padding:.5rem .4rem;}
  .form-row{flex-direction:column;} .form-group{width:100%;}
  .form-group input,.form-group select{width:100%;}
  .summary{grid-template-columns:1fr 1fr;}
}

.note{font-size:.78rem; color:var(--sub); margin-top:1rem; line-height:1.6;}
.spinner{display:inline-block; width:16px; height:16px; border:2px solid var(--border);
         border-top-color:var(--accent); border-radius:50%; animation:spin .6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}

.search-wrap{position:relative;}
.search-dd{position:absolute;left:0;right:0;top:100%;background:var(--card);
  border:1px solid var(--border);border-radius:0 0 8px 8px;max-height:220px;
  overflow-y:auto;z-index:20;display:none;box-shadow:0 4px 12px rgba(0,0,0,.15);}
.search-dd.show{display:block;}
.sdi{padding:.55rem .8rem;cursor:pointer;font-size:.88rem;
  border-bottom:1px solid var(--border);}
.sdi:hover,.sdi:active{background:var(--accent);color:#fff;}
.sdi small{color:var(--sub);margin-left:.4rem;}
.sdi:hover small,.sdi:active small{color:rgba(255,255,255,.7);}
</style></head><body>

<!-- 헤더 + 탭 -->
<div class="header">
  <h1>Stock Dashboard</h1>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('rec')">종목 추천</button>
    <button class="tab" onclick="switchTab('scan')">실시간 스캔</button>
    <button class="tab" onclick="switchTab('port')">내 포트폴리오</button>
  </div>
</div>

<div class="container">

<!-- ====== 탭1: 종목 추천 ====== -->
<div id="page-rec" class="page active">
  <div class="card">
    <div class="ctrl-row">
      <button class="market-btn active" onclick="selMarket(this,'KOSPI')">KOSPI</button>
      <button class="market-btn" onclick="selMarket(this,'KOSDAQ')">KOSDAQ</button>
      <button class="market-btn" onclick="selMarket(this,'NASDAQ')">NASDAQ</button>
      <button class="btn btn-primary" id="rec-btn" onclick="loadRec()">추천 실행</button>
      <span id="rec-status" style="font-size:.82rem;color:var(--sub)"></span>
    </div>
  </div>
  <div id="rec-results"></div>
</div>

<!-- ====== 탭2: 실시간 스캔 ====== -->
<div id="page-scan" class="page">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <span style="font-weight:600;">장중 실시간 스캐너</span>
        <span id="scan-phase" style="margin-left:.5rem;font-size:.82rem;color:var(--sub);"></span>
      </div>
      <button class="btn btn-primary" onclick="loadScan()">새로고침</button>
    </div>
    <div style="font-size:.75rem;color:var(--sub);margin-top:.3rem;">
      09:30 스캔 → 10:00~11:30 감시 → 14:50 스캔 → 15:00~15:25 감시
    </div>
  </div>
  <div id="scan-signals"></div>
  <div id="scan-morning"></div>
  <div id="scan-afternoon"></div>
</div>

<!-- ====== 탭3: 포트폴리오 ====== -->
<div id="page-port" class="page">

  <!-- 매수/매도 입력 -->
  <div class="card">
    <div style="font-weight:600; margin-bottom:.6rem;">거래 기록</div>
    <div class="form-row" style="margin-bottom:.5rem;">
      <div class="form-group">
        <label>시장</label>
        <select id="tx-market" onchange="onMarketChg()"><option>KOSPI</option><option>KOSDAQ</option><option>NASDAQ</option></select>
      </div>
      <div class="form-group" style="flex:1;min-width:160px;">
        <label>종목 검색</label>
        <div class="search-wrap">
          <input id="tx-search" placeholder="종목명 또는 코드 입력" autocomplete="off"
                 oninput="onStockSearch()" style="width:100%;">
          <div id="search-dd" class="search-dd"></div>
        </div>
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        <button class="btn btn-outline btn-sm" type="button" onclick="lookupPrice()">시세</button>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>종목코드</label>
        <input id="tx-ticker" placeholder="005930" style="width:100px;" readonly>
      </div>
      <div class="form-group">
        <label>종목명</label>
        <input id="tx-name" placeholder="삼성전자" style="width:100px;" readonly>
      </div>
      <div class="form-group">
        <label>수량</label>
        <input id="tx-qty" type="number" min="1" placeholder="10" style="width:80px;">
      </div>
      <div class="form-group">
        <label>가격</label>
        <input id="tx-price" type="number" min="0" step="any" placeholder="71000" style="width:110px;">
      </div>
      <div class="form-group">
        <label>체결일</label>
        <input id="tx-date" type="date">
      </div>
      <div class="form-group" style="justify-content:flex-end;">
        <div style="display:flex;gap:.4rem;">
          <button class="btn btn-primary btn-sm" onclick="addTx('buy')">매수</button>
          <button class="btn btn-danger btn-sm" onclick="addTx('sell')">매도</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 손익 현황 -->
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.6rem;">
      <div style="font-weight:600;">보유 종목 손익</div>
      <button class="btn btn-primary btn-sm" id="pf-btn" onclick="loadPortfolio()">조회</button>
    </div>
    <div id="pf-summary" class="summary" style="display:none;"></div>
    <div id="pf-status" style="font-size:.82rem;color:var(--sub);margin-bottom:.5rem;"></div>
    <div class="tbl-wrap"><table id="pf-table" style="display:none;">
      <thead><tr>
        <th>시장</th><th>종목</th><th class="r">수량</th><th class="r">평단</th>
        <th class="r">현재가</th><th class="r">전일比</th><th class="r">평가금액</th>
        <th class="r">평가손익</th><th class="r">수익률</th>
      </tr></thead>
      <tbody></tbody>
    </table></div>
    <div id="pf-totals" style="margin-top:.6rem;font-size:.9rem;"></div>
  </div>

  <!-- 거래 내역 -->
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.6rem;">
      <div style="font-weight:600;">거래 내역</div>
      <button class="btn btn-outline btn-sm" onclick="loadHistory()">불러오기</button>
    </div>
    <div class="tbl-wrap"><table id="hist-table" style="display:none;">
      <thead><tr><th>일자</th><th>시장</th><th>종목</th><th class="c">구분</th>
        <th class="r">수량</th><th class="r">가격</th><th></th>
      </tr></thead>
      <tbody></tbody>
    </table></div>
  </div>
</div>

</div><!-- /container -->

<p class="note" style="text-align:center; padding:0 1rem 2rem;">
  ※ 투자 판단의 참고자료이며 손실 책임은 투자자 본인에게 있습니다.
  시세: 한국 네이버(실시간) / 미국 Yahoo(15분 지연). [조회]를 누른 시점에만 가져옵니다.
</p>

<div class="toast" id="toast"></div>

<script>
// ── 탭 ──
function switchTab(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  document.querySelector(`.tab[onclick*="${id}"]`).classList.add('active');
}

// ── 마켓 선택 ──
let curMarket = 'KOSPI';
function selMarket(el, m) {
  curMarket = m;
  document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadRec(false);  // 시장 전환 시 저장된 결과/진행 상태 자동 표시
}

// ── 공통 fetch (PIN 인증 헤더 자동 첨부) ──
async function api(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers);
  const pin = localStorage.getItem('dashpin');
  if (pin) opts.headers['X-Dash-Pin'] = pin;
  const r = await fetch(url, opts);
  if (r.status === 401) {
    const p = prompt('대시보드 PIN을 입력하세요');
    if (p) { localStorage.setItem('dashpin', p); return api(url, opts); }
  }
  return r;
}

// ── 유틸 ──
function fmt(v, m, d) {
  if (v === null || v === undefined) return '-';
  const dec = d !== undefined ? d : (m === 'NASDAQ' ? 2 : 0);
  return Number(v).toLocaleString('ko-KR', {minimumFractionDigits:dec, maximumFractionDigits:dec});
}
function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
function sign(v, s) { return (v > 0 ? '+' : '') + s; }
function unit(m) { return m === 'NASDAQ' ? '$' : '원'; }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── 종목 추천 (백그라운드 작업 + 폴링) ──
let recTimer = null;
function fmtElapsed(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
async function loadRec(force = true) {
  const btn = document.getElementById('rec-btn');
  const st = document.getElementById('rec-status');
  clearTimeout(recTimer);
  try {
    const r = await api('/api/recommend?market=' + curMarket + (force ? '&force=1' : ''));
    const d = await r.json();
    if (d.status === 'running') {
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      st.textContent = `분석 중 ${fmtElapsed(d.elapsed || 0)} — ${d.stage || ''}`;
      recTimer = setTimeout(() => loadRec(false), 4000);  // 4초마다 상태 확인
      return;
    }
    btn.disabled = false; btn.textContent = '추천 실행';
    if (d.status === 'error') { st.textContent = '오류: ' + d.error; return; }
    if (d.status === 'idle') {
      st.textContent = '저장된 추천이 없습니다. [추천 실행]을 누르세요.';
      document.getElementById('rec-results').innerHTML = '';
      return;
    }
    renderRec(d.result, d.cached);
  } catch(e) {
    btn.disabled = false; btn.textContent = '추천 실행';
    st.textContent = '네트워크 오류: ' + e;
  }
}
function renderRec(d, cached) {
  const st = document.getElementById('rec-status');
  st.textContent = `${d.market} | 기준일 ${d.as_of} | 유니버스 ${d.universe_count}개 종목`
    + (cached ? ' (저장된 결과)' : '');
  let html = '';
  for (const [key, sec] of Object.entries(d.recommendations)) {
    html += `<div class="card"><div style="font-weight:600;margin-bottom:.2rem;">${sec.label} 상위 5</div>`;
    if (sec.sector_summary) {
      html += `<div style="font-size:.75rem;color:var(--sub);margin-bottom:.5rem;">섹터: ${sec.sector_summary}</div>`;
    }
    html += `<div class="tbl-wrap"><table><thead><tr>
      <th>종목</th><th class="r">모멘텀</th><th class="r">가치</th><th class="r">퀄리티</th>
      <th class="r">수급</th><th class="r">심리</th><th class="r">점수</th>
      </tr></thead><tbody>`;
    for (const s of sec.rows) {
      const sc = s.score || 0;
      html += `<tr>
        <td>${s.name}<br><small style="color:var(--sub)">${s.ticker}${s.sector ? ' · ' + s.sector : ''}</small></td>
        <td class="r">${fmtScore(s.momentum)}</td>
        <td class="r">${fmtScore(s.value)}</td>
        <td class="r">${fmtScore(s.quality)}</td>
        <td class="r">${fmtScore(s.flow)}</td>
        <td class="r">${fmtScore(s.sentiment)}</td>
        <td class="r" style="font-weight:700">${sc !== null ? sc.toFixed(1) : '-'}
          <span class="score-bar" style="width:${sc ? sc*0.6 : 0}px"></span></td>
      </tr>`;
      let detail = '';
      if (s.desc) {
        detail += `<div style="color:var(--fg);margin-bottom:2px;">📋 ${s.desc}</div>`;
      }
      if (s.reason) {
        detail += `<div>└ ${s.reason}</div>`;
      }
      if (detail) {
        html += `<tr><td colspan="7" style="font-size:.78rem;color:var(--sub);
          padding:0 .5rem .6rem 1.2rem;border-bottom:1px solid var(--border);
          white-space:normal;line-height:1.5;">${detail}</td></tr>`;
      }
    }
    html += '</tbody></table></div></div>';
  }
  document.getElementById('rec-results').innerHTML = html;
}
// 페이지 열 때 저장된 결과/진행 중인 작업 자동 표시
window.addEventListener('load', () => { loadRec(false); loadScan(); });
function fmtScore(v) {
  if (v === null || v === undefined) return '<span style="color:var(--sub)">-</span>';
  const pct = Math.round(v * 100);
  const c = pct >= 70 ? 'up' : pct <= 30 ? 'down' : '';
  return `<span class="${c}">${pct}</span>`;
}

// ── 포트폴리오 ──
async function loadPortfolio() {
  const btn = document.getElementById('pf-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  document.getElementById('pf-status').textContent = '시세 조회 중…';
  try {
    const d = await (await api('/api/portfolio')).json();
    if (d.error) { document.getElementById('pf-status').textContent = d.error; return; }
    document.getElementById('pf-status').textContent = '조회시각: ' + d.as_of;

    // 요약 카드
    const sumEl = document.getElementById('pf-summary');
    if (Object.keys(d.totals).length) {
      let sh = '';
      for (const [m, t] of Object.entries(d.totals)) {
        const u = unit(m);
        sh += `<div class="stat card">
          <div class="lbl">${m} 평가손익</div>
          <div class="val ${cls(t.pnl)}">${sign(t.pnl, fmt(t.pnl, m) + u)}</div>
          <div class="lbl">${sign(t.pnl_pct, fmt(t.pnl_pct, m, 2))}%</div>
        </div>`;
      }
      for (const [m, v] of Object.entries(d.realized)) {
        sh += `<div class="stat card">
          <div class="lbl">${m} 실현손익</div>
          <div class="val ${cls(v)}">${sign(v, fmt(v, m) + unit(m))}</div>
          <div class="lbl">매도 확정</div>
        </div>`;
      }
      sumEl.innerHTML = sh; sumEl.style.display = '';
    } else { sumEl.style.display = 'none'; }

    // 종목 테이블
    const tbody = document.querySelector('#pf-table tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      document.getElementById('pf-table').style.display = 'none';
      document.getElementById('pf-totals').innerHTML =
        '<span style="color:var(--sub)">보유 종목이 없습니다. 위에서 매수를 기록하세요.</span>';
    } else {
      for (const r of d.rows) {
        const m = r.market, u = m === 'NASDAQ' ? '$' : '';
        tbody.insertAdjacentHTML('beforeend', `<tr>
          <td>${m}</td>
          <td>${r.name}<br><small style="color:var(--sub)">${r.ticker}</small></td>
          <td class="r">${fmt(r.qty,m,0)}</td>
          <td class="r">${u}${fmt(r.avg_price,m)}</td>
          <td class="r">${r.price===null?'조회불가':u+fmt(r.price,m)}</td>
          <td class="r ${cls(r.day_change_pct)}">${r.day_change_pct===null?'-':sign(r.day_change_pct,fmt(r.day_change_pct,m,2)+'%')}</td>
          <td class="r">${u}${fmt(r.value,m)}</td>
          <td class="r ${cls(r.pnl)}">${r.pnl===null?'-':sign(r.pnl,u+fmt(r.pnl,m))}</td>
          <td class="r ${cls(r.pnl_pct)}">${r.pnl_pct===null?'-':sign(r.pnl_pct,fmt(r.pnl_pct,m,2)+'%')}</td>
        </tr>`);
      }
      document.getElementById('pf-table').style.display = '';
      document.getElementById('pf-totals').innerHTML = '';
    }
  } catch(e) { document.getElementById('pf-status').textContent = '오류: '+e; }
  finally { btn.disabled = false; btn.textContent = '조회'; }
}

// ── 매수/매도 ──
async function addTx(side) {
  const data = {
    market: document.getElementById('tx-market').value,
    ticker: document.getElementById('tx-ticker').value.trim(),
    name: document.getElementById('tx-name').value.trim() || undefined,
    qty: document.getElementById('tx-qty').value,
    price: document.getElementById('tx-price').value,
    date: document.getElementById('tx-date').value || undefined,
  };
  if (!data.ticker || !data.qty || !data.price) { toast('종목코드, 수량, 가격을 입력하세요'); return; }
  const url = side === 'buy' ? '/api/portfolio/add' : '/api/portfolio/sell';
  try {
    const r = await api(url, {method:'POST', headers:{'Content-Type':'application/json'},
                              body: JSON.stringify(data)});
    const d = await r.json();
    if (d.error) { toast('오류: ' + d.error); return; }
    toast((side==='buy'?'매수':'매도') + ' 기록 완료');
    document.getElementById('tx-search').value = '';
    document.getElementById('tx-ticker').value = '';
    document.getElementById('tx-name').value = '';
    document.getElementById('tx-qty').value = '';
    document.getElementById('tx-price').value = '';
  } catch(e) { toast('네트워크 오류'); }
}

// ── 거래 내역 ──
async function loadHistory() {
  try {
    const d = await (await api('/api/portfolio/history')).json();
    const tbody = document.querySelector('#hist-table tbody');
    tbody.innerHTML = '';
    if (!d.transactions.length) { toast('거래 내역이 없습니다'); return; }
    d.transactions.forEach((tx, i) => {
      const verb = tx.side === 'buy' ? '매수' : '매도';
      const vc = tx.side === 'buy' ? 'up' : 'down';
      tbody.insertAdjacentHTML('beforeend', `<tr>
        <td>${tx.date}</td><td>${tx.market}</td>
        <td>${tx.name||tx.ticker}<br><small style="color:var(--sub)">${tx.ticker}</small></td>
        <td class="c ${vc}">${verb}</td>
        <td class="r">${Number(tx.qty).toLocaleString()}</td>
        <td class="r">${Number(tx.price).toLocaleString()}</td>
        <td><button class="btn btn-outline btn-sm" onclick="deleteTx(${i})">삭제</button></td>
      </tr>`);
    });
    document.getElementById('hist-table').style.display = '';
  } catch(e) { toast('오류: '+e); }
}

async function deleteTx(idx) {
  if (!confirm('이 거래 기록을 삭제하시겠습니까?')) return;
  try {
    const r = await api('/api/portfolio/delete', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({index: idx})});
    const d = await r.json();
    if (d.error) { toast(d.error); return; }
    toast('삭제 완료'); loadHistory();
  } catch(e) { toast('오류'); }
}

// ── 종목 검색 자동완성 ──
let _sTimer;
function onStockSearch(){
  clearTimeout(_sTimer);
  const q=document.getElementById('tx-search').value.trim();
  const dd=document.getElementById('search-dd');
  if(q.length<1){dd.classList.remove('show');return;}
  const market=document.getElementById('tx-market').value;
  _sTimer=setTimeout(async()=>{
    try{
      const r=await api('/api/stock/search?market='+market+'&q='+encodeURIComponent(q));
      const d=await r.json();
      const list=d.results||[];
      if(!list.length){dd.classList.remove('show');return;}
      dd._data=list;
      dd.innerHTML=list.map((s,i)=>
        '<div class="sdi" data-i="'+i+'"><b>'+escH(s.name)+'</b><small>'+s.ticker+'</small></div>'
      ).join('');
      dd.classList.add('show');
    }catch(e){}
  },300);
}
function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function onMarketChg(){
  document.getElementById('tx-search').value='';
  document.getElementById('tx-ticker').value='';
  document.getElementById('tx-name').value='';
  document.getElementById('tx-price').value='';
  document.getElementById('search-dd').classList.remove('show');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.search-wrap'))document.getElementById('search-dd').classList.remove('show');
});
document.getElementById('search-dd').addEventListener('click',function(e){
  const el=e.target.closest('.sdi');
  if(!el)return;
  const s=this._data[+el.dataset.i];
  document.getElementById('tx-ticker').value=s.ticker;
  document.getElementById('tx-name').value=s.name;
  document.getElementById('tx-search').value=s.name+' ('+s.ticker+')';
  this.classList.remove('show');
  lookupPrice();
});
async function lookupPrice(){
  const market=document.getElementById('tx-market').value;
  let ticker=document.getElementById('tx-ticker').value.trim();
  if(!ticker){
    ticker=document.getElementById('tx-search').value.trim().toUpperCase();
    if(ticker)document.getElementById('tx-ticker').value=ticker;
  }
  if(!ticker){toast('종목코드를 입력하세요');return;}
  toast('시세 조회 중...');
  try{
    const r=await api('/api/stock/price?market='+market+'&ticker='+ticker);
    const d=await r.json();
    if(d.name)document.getElementById('tx-name').value=d.name;
    if(d.price)document.getElementById('tx-price').value=d.price;
    toast(d.price?'현재가 조회 완료':'시세 조회 실패');
  }catch(e){toast('시세 조회 실패');}
}
// ── 실시간 스캐너 ──
async function loadScan() {
  try {
    const r = await api('/api/scanner');
    const d = await r.json();
    renderScan(d);
  } catch(e) {
    document.getElementById('scan-signals').innerHTML =
      '<div class="card" style="color:var(--sub)">스캐너 데이터 없음 (scanner.py 실행 필요)</div>';
  }
}
function renderScan(d) {
  const phaseEl = document.getElementById('scan-phase');
  phaseEl.textContent = d.phase ? `[${d.phase}] ${d.last_update || ''}` : '';

  // 신호
  let sh = '';
  if (d.signals && d.signals.length) {
    sh += '<div class="card"><div style="font-weight:600;margin-bottom:.4rem;">매매 신호</div>';
    for (const s of d.signals) {
      const color = s.type.includes('오전') ? '#4fc3f7' : '#ffb74d';
      sh += `<div style="padding:.4rem 0;border-bottom:1px solid var(--border);">
        <span style="background:${color};color:#000;padding:1px 6px;border-radius:3px;
          font-size:.75rem;font-weight:600;">${s.type} ${s.time}</span>
        <strong style="margin-left:.4rem;">${s.name}</strong>
        <span style="color:var(--sub);font-size:.82rem;">(${s.ticker})</span>
        <div style="font-size:.8rem;margin-top:.2rem;">${s.reason}</div>`;
      if (s.stop_loss) sh += `<div style="font-size:.75rem;color:var(--sub);">
        손절 ${Number(s.stop_loss).toLocaleString()}원 / 익절 ${Number(s.take_profit).toLocaleString()}원 / ${s.deadline} 청산</div>`;
      else if (s.deadline) sh += `<div style="font-size:.75rem;color:var(--sub);">${s.deadline} 강제 청산</div>`;
      sh += '</div>';
    }
    sh += '</div>';
  }
  document.getElementById('scan-signals').innerHTML = sh;

  // 오전 후보
  let mh = '';
  if (d.morning_candidates && d.morning_candidates.length) {
    mh += '<div class="card"><div style="font-weight:600;margin-bottom:.4rem;">오전 후보 (09:30 박스)</div>';
    mh += '<div class="tbl-wrap"><table><thead><tr>';
    mh += '<th>종목</th><th class="r">박스</th><th class="r">폭</th>';
    mh += '<th class="r">등락</th><th class="r">거래대금</th><th>상태</th>';
    mh += '</tr></thead><tbody>';
    for (const c of d.morning_candidates) {
      const stColor = c.status === '감시중' ? 'var(--sub)' :
        c.status === '진입' ? '#4fc3f7' :
        c.status.includes('익절') ? '#66bb6a' :
        c.status.includes('손절') ? '#ef5350' : 'var(--sub)';
      mh += `<tr>
        <td>${c.name}<br><small style="color:var(--sub)">${c.ticker}</small></td>
        <td class="r">${Number(c.box_low).toLocaleString()}~${Number(c.box_high).toLocaleString()}</td>
        <td class="r">${c.box_width_pct}%</td>
        <td class="r">${c.change_pct >= 0 ? '+' : ''}${c.change_pct}%</td>
        <td class="r">${c.trade_value_억}억</td>
        <td style="color:${stColor};font-weight:600;font-size:.82rem;">${c.status}</td>
      </tr>`;
    }
    mh += '</tbody></table></div></div>';
  }
  document.getElementById('scan-morning').innerHTML = mh;

  // 오후 후보
  let ah = '';
  if (d.afternoon_candidates && d.afternoon_candidates.length) {
    ah += '<div class="card"><div style="font-weight:600;margin-bottom:.4rem;">오후 후보 (14:50 스캔)</div>';
    ah += '<div class="tbl-wrap"><table><thead><tr>';
    ah += '<th>종목</th><th class="r">전고점</th><th class="r">현재가</th>';
    ah += '<th class="r">등락</th><th class="r">거래대금</th><th>상태</th>';
    ah += '</tr></thead><tbody>';
    for (const c of d.afternoon_candidates) {
      const stColor = c.status === '감시중' ? 'var(--sub)' :
        c.status === '진입' ? '#ffb74d' : 'var(--sub)';
      ah += `<tr>
        <td>${c.name}<br><small style="color:var(--sub)">${c.ticker}</small></td>
        <td class="r">${Number(c.day_high).toLocaleString()}</td>
        <td class="r">${Number(c.current).toLocaleString()}</td>
        <td class="r">${c.change_pct >= 0 ? '+' : ''}${c.change_pct}%</td>
        <td class="r">${c.trade_value_억}억</td>
        <td style="color:${stColor};font-weight:600;font-size:.82rem;">${c.status}</td>
      </tr>`;
    }
    ah += '</tbody></table></div></div>';
  }
  document.getElementById('scan-afternoon').innerHTML = ah;

  if (!sh && !mh && !ah) {
    let msg = '';
    if (d.phase === '미실행') {
      msg = '스캐너가 실행되지 않았습니다. 서버에서 scanner.py를 실행하세요.';
    } else if (d.morning_filter) {
      const f = d.morning_filter;
      msg = `조건 통과 종목 없음 (${f.total}개 중)<br>`
        + `<span style="font-size:.8rem;">`
        + `거래대금 미달: ${f.skip_trade_value}개 · `
        + `등락률 범위 밖: ${f.skip_change_pct}개 · `
        + `박스폭 초과: ${f.skip_box_width}개</span>`;
    } else {
      msg = '아직 스캔 결과가 없습니다. (현재: ' + (d.phase || '대기') + ')';
    }
    document.getElementById('scan-signals').innerHTML =
      `<div class="card" style="color:var(--sub)">${msg}</div>`;
  }
}
</script></body></html>"""


def main():
    parser = argparse.ArgumentParser(description="종목추천 + 포트폴리오 통합 웹 대시보드")
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--demo", action="store_true",
                        help="합성 데이터로 화면 확인 (API/장부 불필요)")
    args = parser.parse_args()

    DashboardHandler.demo = args.demo
    DashboardHandler.pin = os.environ.get("DASH_PIN") or None
    server = ThreadingHTTPServer(("0.0.0.0", args.port), DashboardHandler)
    mode = " [DEMO]" if args.demo else ""
    print(f"\n  종목추천 + 포트폴리오 대시보드{mode}")
    print(f"  http://0.0.0.0:{args.port}")
    if DashboardHandler.pin:
        print("  PIN 인증: 활성화 (환경변수 DASH_PIN)")
    else:
        print("  [주의] PIN 미설정 — 공개 IP라면 export DASH_PIN=숫자 설정 권장")
    print(f"  종료: Ctrl+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")


if __name__ == "__main__":
    sys.exit(main())

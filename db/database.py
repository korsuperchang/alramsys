import sqlite3
from config import Config


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(Config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS watchlist (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            code    TEXT    NOT NULL UNIQUE,
            name    TEXT,
            market  TEXT    NOT NULL,
            added_at TEXT   DEFAULT (datetime('now', 'localtime'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS sent_alerts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            code       TEXT NOT NULL,
            alert_key  TEXT NOT NULL UNIQUE,
            sent_at    TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)

    # DART 고유번호 캐시 (종목코드 -> corp_code)
    c.execute("""
        CREATE TABLE IF NOT EXISTS dart_corp_codes (
            stock_code TEXT PRIMARY KEY,
            corp_code  TEXT NOT NULL,
            corp_name  TEXT,
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)

    conn.commit()
    conn.close()


# ── 관심종목 ────────────────────────────────────────────────


def add_stock(code: str, name: str, market: str) -> bool:
    try:
        conn = get_conn()
        conn.execute(
            "INSERT INTO watchlist (code, name, market) VALUES (?, ?, ?)",
            (code.upper(), name, market.upper()),
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False


def remove_stock(code: str) -> bool:
    conn = get_conn()
    cur = conn.execute("DELETE FROM watchlist WHERE code = ?", (code.upper(),))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def get_watchlist() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT code, name, market FROM watchlist ORDER BY market, code"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_kr_stocks() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT code, name FROM watchlist WHERE market='KR'"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_us_stocks() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT code, name FROM watchlist WHERE market='US'"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def stock_exists(code: str) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM watchlist WHERE code=?", (code.upper(),)
    ).fetchone()
    conn.close()
    return row is not None


# ── 중복 알림 방지 ───────────────────────────────────────────


def is_alert_sent(alert_key: str) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM sent_alerts WHERE alert_key=?", (alert_key,)
    ).fetchone()
    conn.close()
    return row is not None


def mark_alert_sent(code: str, alert_key: str):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO sent_alerts (code, alert_key) VALUES (?, ?)",
            (code, alert_key),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()


# ── DART 고유번호 캐시 ───────────────────────────────────────


def upsert_corp_codes(mappings: list[tuple[str, str, str]]):
    """(stock_code, corp_code, corp_name) 리스트를 일괄 저장"""
    conn = get_conn()
    conn.executemany(
        """
        INSERT INTO dart_corp_codes (stock_code, corp_code, corp_name)
        VALUES (?, ?, ?)
        ON CONFLICT(stock_code) DO UPDATE SET
            corp_code=excluded.corp_code,
            corp_name=excluded.corp_name,
            updated_at=datetime('now','localtime')
        """,
        mappings,
    )
    conn.commit()
    conn.close()


def get_corp_code(stock_code: str) -> str | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT corp_code FROM dart_corp_codes WHERE stock_code=?", (stock_code,)
    ).fetchone()
    conn.close()
    return row["corp_code"] if row else None


def dart_cache_count() -> int:
    conn = get_conn()
    row = conn.execute("SELECT COUNT(*) as cnt FROM dart_corp_codes").fetchone()
    conn.close()
    return row["cnt"]

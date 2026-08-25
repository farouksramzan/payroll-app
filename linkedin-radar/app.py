"""LinkedIn Radar — auto-message accepted connection requests via Unipile.

Flow: you connect your LinkedIn account through Unipile's hosted auth, register
a Unipile "users" webhook pointing back at this app, and every time someone
accepts one of your connection requests Unipile fires a `new_relation` event
here. The person lands in a queue and, after a randomized human-like delay,
gets your templated opener sent through Unipile's chat API.

Safety rails: dry-run mode (on by default), a daily send cap, randomized
delays, per-person dedupe, and an auto-send toggle so nothing goes out until
you flip it on. Works locally (http://localhost:5601) and deployed (set
BASE_URL, RADAR_PASSWORD, RADAR_SECRET).
"""

import json
import os
import random
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests as http
from flask import Flask, jsonify, redirect, render_template, request, session

PORT = int(os.environ.get("PORT", 5601))
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
IS_LOCAL = BASE_URL.startswith("http://localhost")
PASSWORD = os.environ.get("RADAR_PASSWORD", "")

BASE_DIR = Path(__file__).resolve().parent
# Railway mounts a volume at /data; fall back to the app dir locally.
DB_PATH = os.environ.get("RADAR_DB") or (
    "/data/linkedin-radar.db" if Path("/data").is_dir() else str(BASE_DIR / "radar.db")
)

DEFAULT_TEMPLATE = (
    "Hi {{first_name}}, thanks for connecting! "
    "I'm exploring roles in the space and would love to hear how things "
    "are going at your end. Open to a quick chat sometime?"
)

app = Flask(__name__)
app.secret_key = os.environ.get("RADAR_SECRET") or (
    "local-dev-only-secret" if IS_LOCAL else os.urandom(32)
)
app.config.update(
    TEMPLATES_AUTO_RELOAD=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=not IS_LOCAL,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)


# ------------------------------------------------------------------ database

def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY, value TEXT
            );
            CREATE TABLE IF NOT EXISTS queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              provider_id TEXT UNIQUE NOT NULL,
              full_name TEXT, public_identifier TEXT, profile_url TEXT,
              received_at TEXT NOT NULL, scheduled_at TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'queued',  -- queued|sent|dry_run|failed|skipped
              sent_at TEXT, message_text TEXT, error TEXT
            );
            """
        )
    if get_setting("webhook_secret") is None:
        set_setting("webhook_secret", secrets.token_hex(16))
    for key, val in (
        ("template", DEFAULT_TEMPLATE), ("daily_cap", "20"),
        ("delay_min", "8"), ("delay_max", "45"),
        ("auto_send", "0"), ("dry_run", "1"),
    ):
        if get_setting(key) is None:
            set_setting(key, val)


def get_setting(key, default=None):
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    with db() as conn:
        conn.execute(
            "INSERT INTO settings (key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------- unipile

def unipile_base():
    dsn = (get_setting("dsn") or "").strip().rstrip("/")
    if dsn and not dsn.startswith("http"):
        dsn = "https://" + dsn
    return dsn


def unipile_headers():
    return {"X-API-KEY": get_setting("api_key") or "", "accept": "application/json"}


def unipile_configured():
    return bool(unipile_base() and get_setting("api_key"))


def render_message(template, full_name):
    name = (full_name or "").strip()
    first = name.split()[0] if name else "there"
    out = template.replace("{{first_name}}", first).replace("{{name}}", name or "there")
    return re.sub(r"\{\{\w+\}\}", "", out).strip()


def send_opener(provider_id, text):
    """Start a new chat with an accepted connection. Returns (ok, error)."""
    account_id = get_setting("account_id")
    if not account_id:
        return False, "No LinkedIn account connected yet"
    try:
        resp = http.post(
            f"{unipile_base()}/api/v1/chats",
            headers=unipile_headers(),
            files={  # multipart/form-data, as Unipile's chat endpoint expects
                "account_id": (None, account_id),
                "attendees_ids": (None, provider_id),
                "text": (None, text),
            },
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return True, None
        return False, f"HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as exc:
        return False, str(exc)


# -------------------------------------------------------------- sender loop

def sent_today(conn):
    cutoff = iso(now_utc().replace(hour=0, minute=0, second=0, microsecond=0))
    row = conn.execute(
        "SELECT COUNT(*) n FROM queue WHERE status='sent' AND sent_at >= ?", (cutoff,)
    ).fetchone()
    return row["n"]


def process_due(force_id=None):
    """Send queued items whose delay has elapsed (or one item, forced)."""
    if not unipile_configured():
        return
    template = get_setting("template") or DEFAULT_TEMPLATE
    dry_run = get_setting("dry_run") == "1"
    cap = int(get_setting("daily_cap") or 20)
    with db() as conn:
        if force_id is not None:
            rows = conn.execute(
                "SELECT * FROM queue WHERE id=? AND status='queued'", (force_id,)
            ).fetchall()
        elif get_setting("auto_send") == "1":
            rows = conn.execute(
                "SELECT * FROM queue WHERE status='queued' AND scheduled_at <= ? "
                "ORDER BY scheduled_at", (iso(now_utc()),)
            ).fetchall()
        else:
            return
        for row in rows:
            if not dry_run and sent_today(conn) >= cap:
                break  # cap reached; items stay queued for tomorrow
            text = render_message(template, row["full_name"])
            if dry_run:
                conn.execute(
                    "UPDATE queue SET status='dry_run', sent_at=?, message_text=? WHERE id=?",
                    (iso(now_utc()), text, row["id"]),
                )
                continue
            ok, err = send_opener(row["provider_id"], text)
            conn.execute(
                "UPDATE queue SET status=?, sent_at=?, message_text=?, error=? WHERE id=?",
                ("sent" if ok else "failed", iso(now_utc()), text, err, row["id"]),
            )
            time.sleep(random.uniform(4, 12))  # never fire back-to-back sends


def sender_loop():
    while True:
        try:
            process_due()
        except Exception as exc:
            print(f"[sender] error: {exc}", flush=True)
        time.sleep(30)


# ---------------------------------------------------------------- auth gate

def authed():
    return IS_LOCAL or not PASSWORD or session.get("authed") is True


@app.post("/api/login")
def login():
    if PASSWORD and secrets.compare_digest(request.json.get("password", ""), PASSWORD):
        session.permanent = True
        session["authed"] = True
        return jsonify(ok=True)
    return jsonify(ok=False, error="Wrong password"), 401


# -------------------------------------------------------------------- pages

@app.get("/")
def index():
    return render_template(
        "index.html",
        needs_login=not authed(),
        password_missing=(not IS_LOCAL and not PASSWORD),
    )


@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.get("/api/state")
def state():
    if not authed():
        return jsonify(error="unauthorized"), 401
    with db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM queue ORDER BY id DESC LIMIT 200"
        ).fetchall()]
        today = sent_today(conn)
    api_key = get_setting("api_key") or ""
    return jsonify(
        dsn=get_setting("dsn") or "",
        api_key_set=bool(api_key),
        account_id=get_setting("account_id") or "",
        webhook_id=get_setting("webhook_id") or "",
        webhook_url=f"{BASE_URL}/api/unipile/webhook",
        base_url=BASE_URL,
        is_local=IS_LOCAL,
        template=get_setting("template"),
        daily_cap=int(get_setting("daily_cap") or 20),
        delay_min=int(get_setting("delay_min") or 8),
        delay_max=int(get_setting("delay_max") or 45),
        auto_send=get_setting("auto_send") == "1",
        dry_run=get_setting("dry_run") == "1",
        sent_today=today,
        queue=rows,
    )


@app.post("/api/settings")
def save_settings():
    if not authed():
        return jsonify(error="unauthorized"), 401
    body = request.json or {}
    if body.get("dsn") is not None:
        set_setting("dsn", body["dsn"].strip())
    if body.get("api_key"):  # only overwrite when a new key is typed
        set_setting("api_key", body["api_key"].strip())
    if body.get("template") is not None:
        set_setting("template", body["template"])
    for key in ("daily_cap", "delay_min", "delay_max"):
        if body.get(key) is not None:
            set_setting(key, max(0, int(body[key])))
    for key in ("auto_send", "dry_run"):
        if body.get(key) is not None:
            set_setting(key, "1" if body[key] else "0")
    return jsonify(ok=True)


# ------------------------------------------------- unipile account + webhook

@app.post("/api/connect")
def connect_linkedin():
    """Create a Unipile hosted-auth link and hand its URL to the browser."""
    if not authed():
        return jsonify(error="unauthorized"), 401
    if not unipile_configured():
        return jsonify(error="Save your Unipile DSN and API key first"), 400
    try:
        resp = http.post(
            f"{unipile_base()}/api/v1/hosted/accounts/link",
            headers={**unipile_headers(), "Content-Type": "application/json"},
            json={
                "type": "create",
                "providers": ["LINKEDIN"],
                "api_url": unipile_base(),
                "expiresOn": iso(now_utc() + timedelta(hours=2)),
                "notify_url": f"{BASE_URL}/api/unipile/notify",
                "name": "linkedin-radar",
                "success_redirect_url": BASE_URL,
                "failure_redirect_url": BASE_URL,
            },
            timeout=30,
        )
        data = resp.json()
        if resp.status_code in (200, 201) and data.get("url"):
            return jsonify(ok=True, url=data["url"])
        return jsonify(error=f"Unipile said: {resp.status_code} {json.dumps(data)[:300]}"), 502
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.post("/api/unipile/notify")
def unipile_notify():
    """Hosted-auth callback: Unipile tells us which account_id was connected."""
    body = request.get_json(silent=True) or request.form.to_dict() or {}
    account_id = body.get("account_id")
    if account_id and body.get("name") == "linkedin-radar":
        set_setting("account_id", account_id)
    return jsonify(ok=True)


@app.post("/api/register-webhook")
def register_webhook():
    if not authed():
        return jsonify(error="unauthorized"), 401
    if not unipile_configured():
        return jsonify(error="Save your Unipile DSN and API key first"), 400
    if IS_LOCAL:
        return jsonify(error="Webhooks need a public URL — deploy first or set BASE_URL"), 400
    try:
        resp = http.post(
            f"{unipile_base()}/api/v1/webhooks",
            headers={**unipile_headers(), "Content-Type": "application/json"},
            json={
                "source": "users",
                "request_url": f"{BASE_URL}/api/unipile/webhook",
                "name": "linkedin-radar new_relation",
                "format": "json",
                "headers": [
                    {"key": "X-Radar-Secret", "value": get_setting("webhook_secret")},
                    {"key": "Content-Type", "value": "application/json"},
                ],
            },
            timeout=30,
        )
        data = resp.json() if resp.text else {}
        if resp.status_code in (200, 201):
            set_setting("webhook_id", data.get("webhook_id") or data.get("id") or "registered")
            return jsonify(ok=True)
        return jsonify(error=f"Unipile said: {resp.status_code} {json.dumps(data)[:300]}"), 502
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.post("/api/unipile/webhook")
def unipile_webhook():
    """new_relation event: someone accepted a connection request."""
    secret = get_setting("webhook_secret")
    supplied = request.headers.get("X-Radar-Secret") or request.args.get("secret")
    if not (supplied and secrets.compare_digest(supplied, secret)):
        return jsonify(error="bad secret"), 403
    body = request.get_json(silent=True) or request.form.to_dict() or {}
    provider_id = body.get("user_provider_id")
    if not provider_id:
        return jsonify(ok=True, ignored=True)  # 200 so Unipile doesn't retry
    delay_min = int(get_setting("delay_min") or 8)
    delay_max = max(delay_min, int(get_setting("delay_max") or 45))
    scheduled = now_utc() + timedelta(minutes=random.uniform(delay_min, delay_max))
    with db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO queue "
            "(provider_id, full_name, public_identifier, profile_url, received_at, scheduled_at) "
            "VALUES (?,?,?,?,?,?)",
            (
                provider_id,
                body.get("user_full_name"),
                body.get("user_public_identifier"),
                body.get("user_profile_url"),
                iso(now_utc()),
                iso(scheduled),
            ),
        )
    return jsonify(ok=True)


# ------------------------------------------------------------- queue actions

@app.post("/api/queue/<int:item_id>/send-now")
def send_now(item_id):
    if not authed():
        return jsonify(error="unauthorized"), 401
    process_due(force_id=item_id)
    with db() as conn:
        row = conn.execute("SELECT * FROM queue WHERE id=?", (item_id,)).fetchone()
    if not row:
        return jsonify(error="not found"), 404
    return jsonify(ok=row["status"] in ("sent", "dry_run"), status=row["status"], error=row["error"])


@app.post("/api/queue/<int:item_id>/skip")
def skip_item(item_id):
    if not authed():
        return jsonify(error="unauthorized"), 401
    with db() as conn:
        conn.execute("UPDATE queue SET status='skipped' WHERE id=? AND status='queued'", (item_id,))
    return jsonify(ok=True)


@app.post("/api/queue/<int:item_id>/requeue")
def requeue_item(item_id):
    if not authed():
        return jsonify(error="unauthorized"), 401
    with db() as conn:
        conn.execute(
            "UPDATE queue SET status='queued', sent_at=NULL, error=NULL, scheduled_at=? "
            "WHERE id=? AND status IN ('skipped','failed','dry_run')",
            (iso(now_utc()), item_id),
        )
    return jsonify(ok=True)


init_db()
threading.Thread(target=sender_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=IS_LOCAL)

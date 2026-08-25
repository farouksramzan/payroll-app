"""Mail Blast — Gmail email automation, multi-user.

Anyone signs in with their own Gmail via Google OAuth; their token lives in
their own browser session (signed cookie), so every visitor sends from their
own account. Works locally (http://localhost:5599) and deployed (set BASE_URL,
GOOGLE_CLIENT_CONFIG, EMAIL_TOOL_SECRET).
"""

import base64
import csv
import io
import json
import os
import re
import time
from datetime import timedelta
from email.mime.text import MIMEText
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, session

PORT = int(os.environ.get("PORT", 5599))
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
REDIRECT_URI = f"{BASE_URL}/oauth2callback"
IS_LOCAL = BASE_URL.startswith("http://localhost")

if IS_LOCAL:
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
OUTREACH_CSV = BASE_DIR.parent / "dc-outreach-radar" / "people-list.csv"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
MAX_RECIPIENTS_PER_SEND = 100  # keep well under Gmail daily quota / request timeout

app = Flask(__name__)
app.secret_key = os.environ.get("EMAIL_TOOL_SECRET") or (
    "local-dev-only-secret" if IS_LOCAL else os.urandom(32)
)
app.config.update(
    TEMPLATES_AUTO_RELOAD=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=not IS_LOCAL,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)


# ---------------------------------------------------------------- auth helpers

def client_config():
    """OAuth client config: env var in production, credentials.json locally."""
    env = os.environ.get("GOOGLE_CLIENT_CONFIG")
    if env:
        try:
            return json.loads(env)
        except Exception:
            return None
    if CREDENTIALS_FILE.exists():
        try:
            return json.loads(CREDENTIALS_FILE.read_text())
        except Exception:
            return None
    return None


def load_creds():
    """Per-user credentials from this visitor's own session cookie."""
    raw = session.get("creds")
    if not raw:
        return None
    try:
        creds = Credentials.from_authorized_user_info(json.loads(raw), SCOPES)
    except Exception:
        return None
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleRequest())
            session["creds"] = creds.to_json()
        except Exception:
            session.pop("creds", None)
            return None
    return creds if creds.valid else None


def gmail_service(creds):
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# --------------------------------------------------------------------- routes

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    email = session.get("email")
    if email and not session.get("creds"):
        email = None
    return jsonify({
        "has_credentials_file": client_config() is not None,
        "managed": bool(os.environ.get("GOOGLE_CLIENT_CONFIG")),
        "connected": bool(email),
        "email": email,
        "outreach_list_available": IS_LOCAL and OUTREACH_CSV.exists(),
    })


@app.route("/auth")
def auth():
    config = client_config()
    if not config:
        return redirect("/")
    flow = Flow.from_client_config(config, scopes=SCOPES, redirect_uri=REDIRECT_URI)
    auth_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )
    session["oauth_state"] = state
    session["code_verifier"] = flow.code_verifier  # PKCE: reuse in the callback
    return redirect(auth_url)


@app.route("/oauth2callback")
def oauth2callback():
    if request.args.get("error") or not request.args.get("code"):
        return redirect("/?auth=denied")
    if request.args.get("state") != session.get("oauth_state"):
        return redirect("/?auth=denied")
    flow = Flow.from_client_config(
        client_config(), scopes=SCOPES,
        state=session.get("oauth_state"), redirect_uri=REDIRECT_URI,
    )
    flow.code_verifier = session.get("code_verifier")
    try:
        # Exchange the code directly — avoids scheme mismatches behind proxies.
        flow.fetch_token(code=request.args["code"])
    except Exception:
        return redirect("/?auth=failed")

    creds = flow.credentials
    session.permanent = True
    session["creds"] = creds.to_json()
    try:
        profile = gmail_service(creds).users().getProfile(userId="me").execute()
        session["email"] = profile.get("emailAddress")
    except Exception:
        session["email"] = None
    session.pop("oauth_state", None)
    session.pop("code_verifier", None)
    return redirect("/?auth=ok")


@app.route("/api/upload-credentials", methods=["POST"])
def api_upload_credentials():
    """Accept the OAuth client JSON downloaded from Google Cloud Console.

    Local-only convenience — disabled on a deployed server, where the client
    config comes from the GOOGLE_CLIENT_CONFIG env var.
    """
    if not IS_LOCAL or os.environ.get("GOOGLE_CLIENT_CONFIG"):
        return jsonify({"error": "Not available on this server"}), 403
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file received"}), 400
    try:
        data = json.loads(f.read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "That file isn't valid JSON"}), 400
    if "web" not in data and "installed" not in data:
        return jsonify({"error": "That doesn't look like a Google OAuth client file "
                                 "(missing 'web' or 'installed' section)"}), 400
    client = data.get("web") or data.get("installed")
    uris = client.get("redirect_uris") or []
    warning = None
    if REDIRECT_URI not in uris:
        warning = (f"Heads up: this client has no redirect URI {REDIRECT_URI} — "
                   "add it in Google Cloud Console if sign-in fails.")
    CREDENTIALS_FILE.write_text(json.dumps(data, indent=2))
    return jsonify({"ok": True, "warning": warning})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- recipients

def rows_to_recipients(rows):
    """Normalize dict rows into [{email, name}] keeping only rows with an email."""
    out, seen = [], set()
    for r in rows:
        email = (r.get("email") or "").strip().lower()
        if not email or not EMAIL_RE.fullmatch(email) or email in seen:
            continue
        seen.add(email)
        out.append({"email": email, "name": (r.get("name") or "").strip()})
    return out


@app.route("/api/outreach-list")
def api_outreach_list():
    if not IS_LOCAL or not OUTREACH_CSV.exists():
        return jsonify({"recipients": []})
    with open(OUTREACH_CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return jsonify({"recipients": rows_to_recipients(rows)})


@app.route("/api/parse", methods=["POST"])
def api_parse():
    """Parse pasted text or an uploaded CSV into recipients."""
    text = ""
    if "file" in request.files:
        text = request.files["file"].read().decode("utf-8", errors="replace")
    else:
        text = (request.get_json(silent=True) or {}).get("text", "")

    recipients = []
    # Try CSV with headers first
    try:
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames and any(
            (h or "").strip().lower() == "email" for h in reader.fieldnames
        ):
            normalized = [
                {(k or "").strip().lower(): v for k, v in row.items()}
                for row in reader
            ]
            recipients = rows_to_recipients(normalized)
    except Exception:
        recipients = []

    if not recipients:
        # Fall back: pull anything email-shaped, use "Name <email>" names when present
        for line in text.splitlines():
            for email in EMAIL_RE.findall(line):
                name = ""
                m = re.match(r"\s*\"?([^\"<,]+?)\"?\s*<", line)
                if m and email in line:
                    name = m.group(1).strip()
                recipients.append({"email": email.lower(), "name": name})
        recipients = rows_to_recipients(recipients)

    return jsonify({"recipients": recipients})


# --------------------------------------------------------------------- send

def personalize(template, recipient):
    name = recipient.get("name") or ""
    first = name.split()[0] if name else "there"
    return (
        template.replace("{{name}}", name or "there")
        .replace("{{first_name}}", first)
        .replace("{{email}}", recipient["email"])
    )


@app.route("/api/send", methods=["POST"])
def api_send():
    creds = load_creds()
    if not creds:
        return jsonify({"error": "Not connected to Gmail"}), 401
    data = request.get_json(force=True)
    subject = (data.get("subject") or "").strip()
    body = data.get("body") or ""
    recipients = data.get("recipients") or []
    if not subject or not body.strip() or not recipients:
        return jsonify({"error": "Missing subject, body, or recipients"}), 400
    if len(recipients) > MAX_RECIPIENTS_PER_SEND:
        return jsonify({"error": f"Max {MAX_RECIPIENTS_PER_SEND} recipients per "
                                 "send — split your list into batches"}), 400

    service = gmail_service(creds)
    results = []
    for i, r in enumerate(recipients):
        try:
            msg = MIMEText(personalize(body, r))
            msg["To"] = f"{r['name']} <{r['email']}>" if r.get("name") else r["email"]
            msg["Subject"] = personalize(subject, r)
            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            service.users().messages().send(userId="me", body={"raw": raw}).execute()
            results.append({"email": r["email"], "ok": True})
        except Exception as e:
            results.append({"email": r["email"], "ok": False, "error": str(e)[:200]})
        if i < len(recipients) - 1:
            time.sleep(0.6)  # gentle pacing between individual sends

    sent = sum(1 for r in results if r["ok"])
    return jsonify({"sent": sent, "failed": len(results) - sent, "results": results})


# ------------------------------------------------------------------- replies

@app.route("/api/replies", methods=["POST"])
def api_replies():
    """Check the signed-in user's inbox for messages from the given addresses."""
    creds = load_creds()
    if not creds:
        return jsonify({"error": "Not connected to Gmail"}), 401
    emails = (request.get_json(force=True) or {}).get("emails") or []
    emails = [e for e in emails if EMAIL_RE.fullmatch(e)][:40]
    if not emails:
        return jsonify({"replies": []})
    service = gmail_service(creds)
    query = "in:inbox (" + " OR ".join(f"from:{e}" for e in emails) + ")"
    try:
        resp = service.users().messages().list(
            userId="me", q=query, maxResults=20
        ).execute()
        replies = []
        for m in resp.get("messages", []):
            msg = service.users().messages().get(
                userId="me", id=m["id"], format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
            headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
            replies.append({
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "date": headers.get("Date", ""),
                "snippet": msg.get("snippet", ""),
            })
        return jsonify({"replies": replies})
    except Exception as e:
        return jsonify({"error": str(e)[:200]}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1" if IS_LOCAL else "0.0.0.0", port=PORT, debug=False)

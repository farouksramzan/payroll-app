"""Simple Gmail email automation tool.

Flow:
  1. Connect your Gmail via Google OAuth (you grant permission on Google's own page).
  2. Load recipients (outreach list, CSV upload, or paste).
  3. Compose one message, review exactly what will be sent, confirm, send individually.

Requires a Google OAuth client file at email-tool/credentials.json
(see README.md — the app walks you through it if the file is missing).
"""

import base64
import csv
import io
import json
import os
import re
import time
from email.mime.text import MIMEText
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, session

os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")  # http://localhost redirect

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"
OUTREACH_CSV = BASE_DIR.parent / "dc-outreach-radar" / "people-list.csv"

PORT = 5599
REDIRECT_URI = f"http://localhost:{PORT}/oauth2callback"
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

app = Flask(__name__)
app.secret_key = os.environ.get("EMAIL_TOOL_SECRET", "local-dev-only-secret")
app.config["TEMPLATES_AUTO_RELOAD"] = True


# ---------------------------------------------------------------- auth helpers

def load_creds():
    if not TOKEN_FILE.exists():
        return None
    try:
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    except Exception:
        return None
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleRequest())
            TOKEN_FILE.write_text(creds.to_json())
        except Exception:
            return None
    return creds if creds and creds.valid else None


def gmail_service(creds):
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def connected_email(creds):
    try:
        profile = gmail_service(creds).users().getProfile(userId="me").execute()
        return profile.get("emailAddress")
    except Exception:
        return None


# --------------------------------------------------------------------- routes

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    creds = load_creds()
    email = connected_email(creds) if creds else None
    return jsonify({
        "has_credentials_file": CREDENTIALS_FILE.exists(),
        "connected": bool(email),
        "email": email,
        "outreach_list_available": OUTREACH_CSV.exists(),
    })


@app.route("/auth")
def auth():
    if not CREDENTIALS_FILE.exists():
        return redirect("/")
    flow = Flow.from_client_secrets_file(
        str(CREDENTIALS_FILE), scopes=SCOPES, redirect_uri=REDIRECT_URI
    )
    auth_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent"
    )
    session["oauth_state"] = state
    return redirect(auth_url)


@app.route("/oauth2callback")
def oauth2callback():
    if request.args.get("error"):
        return redirect("/?auth=denied")
    flow = Flow.from_client_secrets_file(
        str(CREDENTIALS_FILE),
        scopes=SCOPES,
        state=session.get("oauth_state"),
        redirect_uri=REDIRECT_URI,
    )
    flow.fetch_token(authorization_response=request.url)
    TOKEN_FILE.write_text(flow.credentials.to_json())
    return redirect("/?auth=ok")


@app.route("/api/logout", methods=["POST"])
def api_logout():
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()
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
    if not OUTREACH_CSV.exists():
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
    """Check the inbox for recent messages from any of the given addresses."""
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
    app.run(host="127.0.0.1", port=PORT, debug=False)

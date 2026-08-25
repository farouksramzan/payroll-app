# LinkedIn Radar — message people the moment they accept your connection request

Watches your LinkedIn account through [Unipile](https://www.unipile.com) and,
when someone accepts a connection request you sent, queues your templated
opener and sends it after a randomized human-like delay.

**Be aware:** this automates a personal LinkedIn account through Unipile's
unofficial API, which is against LinkedIn's User Agreement and carries real
account-restriction risk. The safety rails (dry run, daily cap, random delays)
reduce the risk; they don't remove it.

## How it works

1. **Unipile account** — you bring your own Unipile subscription (7-day free
   trial, then ~€49/mo). Paste your DSN + API key into the dashboard.
2. **Hosted LinkedIn auth** — the Connect button opens Unipile's hosted
   sign-in; this app never sees your LinkedIn password, only an `account_id`.
3. **Webhook** — one click registers a Unipile `users` webhook (event
   `new_relation`) pointing at `/api/unipile/webhook`, secured with a shared
   secret header. Every accepted invite lands in the queue instantly.
4. **Queue → send** — each person is scheduled `delay_min`–`delay_max` minutes
   out (default 8–45). A background loop sends due openers through Unipile's
   `POST /chats`, spacing sends 4–12s apart, stopping at the daily cap
   (default 20). Each person is messaged at most once, ever.

## Safety rails (all in the dashboard)

- **Dry run** starts ON — events are logged with the exact message that
  *would* have been sent, but nothing sends until you turn it off.
- **Auto-send** starts OFF — until you enable it, queued people wait and you
  can trigger each send manually ("send now") or skip them.
- **Daily cap**, **randomized delay window**, and per-person dedupe.

## Run locally

```bash
cd linkedin-radar
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://localhost:5601. Locally you can configure everything and test
dry-run sends, but webhooks need a public URL — deploy for the real flow.

## Deploy (Railway)

Create a new Railway service from this repo with root directory
`linkedin-radar`, attach a volume mounted at `/data`, and set:

| Variable | Value |
|---|---|
| `BASE_URL` | the public URL Railway gives the service |
| `RADAR_PASSWORD` | dashboard password (required in production) |
| `RADAR_SECRET` | any long random string (session signing) |

Then in the dashboard: save DSN + API key → Connect LinkedIn → Register
webhook → set your template → flip off dry run and turn on auto-send when
you're ready.

The SQLite DB lives at `/data/linkedin-radar.db` (or `radar.db` locally);
`radar.db*` is git-ignored.

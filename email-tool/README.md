# Mail Blast — simple Gmail email automation

Send one composed message to a list of people, **individually** (each person gets
their own email), with a confirmation screen before anything goes out. Sign-in is
real Google OAuth — you approve permissions on Google's own page; the app never
sees your password.

## Run it

```bash
cd email-tool
.venv/bin/python app.py
```

Then open http://localhost:5599

## One-time Google setup (~3 minutes)

Google requires every app that sends Gmail to have its own OAuth key:

1. Go to https://console.cloud.google.com/ and create a project (any name).
2. Search **Gmail API** → Enable.
3. **APIs & Services → OAuth consent screen** → External → fill the app name,
   and add your own Gmail as a **test user**.
4. **Credentials → Create credentials → OAuth client ID** → *Web application* →
   add authorized redirect URI: `http://localhost:5599/oauth2callback`
5. Download the JSON and save it as `email-tool/credentials.json`.
6. Refresh the page and click **Sign in with Google**.

`credentials.json` and `token.json` are git-ignored — never commit them.

## Features

- **Recipients**: load `dc-outreach-radar/people-list.csv` in one click, upload
  any CSV with `name,email` columns, or paste emails / `Name <email>` lines.
- **Personalization**: use `{{first_name}}`, `{{name}}`, or `{{email}}` in the
  subject or body; live preview shows exactly what the first recipient sees.
- **Confirmation**: a review screen lists every recipient and the rendered
  message before you confirm; nothing sends until you click.
- **Individual sends** with gentle pacing (0.6s apart) and per-recipient
  success/failure status.
- **Replies**: after connecting, the tool can list inbox messages from people
  on your recipient list.

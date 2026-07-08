#!/usr/bin/env python3
"""Pull TikTok capper candidates from Apify and emit DC Outreach Radar import JSON.

Usage:
    APIFY_TOKEN=apify_api_xxx python3 apify_pull.py [hashtag ...]
    (or save the token to ~/.apify_token and omit the env var)

Runs clockworks/tiktok-scraper on the given hashtags (defaults below), keeps
only authors in the cult-size band (3k-60k followers), computes real engagement
from their scraped posts, and writes apify-candidates.json in this folder —
paste its contents into the radar's ＋ import.

Cost: ~$1.70 per 1,000 scraped items on Apify's pay-per-result pricing;
a default run (3 hashtags x 50 results) is ~$0.25 and fits free credits.
"""
import json
import os
import ssl
import statistics
import sys
import time
import urllib.request

try:
    import certifi  # macOS python.org builds ship without CA certs
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

ACTOR = "clockworks~tiktok-scraper"
DEFAULT_HASHTAGS = ["sportspicks", "bettingpicks", "capper"]
RESULTS_PER_HASHTAG = 50
MIN_FOLLOWERS, MAX_FOLLOWERS = 3_000, 60_000
MAX_POSTS_PER_AUTHOR = 5


def load_token():
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if tok:
        return tok
    path = os.path.expanduser("~/.apify_token")
    if os.path.exists(path):
        return open(path).read().strip()
    sys.exit("No token. Set APIFY_TOKEN or save it to ~/.apify_token")


TOKEN = load_token()


def api(path, payload=None):
    sep = "&" if "?" in path else "?"
    url = f"https://api.apify.com/v2/{path}{sep}token={TOKEN}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=SSL_CTX) as r:
        return json.load(r)


def main():
    args = sys.argv[1:]
    run_id = None
    if args and args[0] == "--run":            # re-transform an existing run's dataset (free, no new scrape)
        run_id, args = args[1], args[2:]
    hashtags = args or DEFAULT_HASHTAGS

    if run_id:
        print(f"re-using existing run {run_id} (no new scrape)")
    else:
        print(f"scraping #{' #'.join(hashtags)} ({RESULTS_PER_HASHTAG} results each)…")
        run = api(f"acts/{ACTOR}/runs", {
            "hashtags": hashtags,
            "resultsPerPage": RESULTS_PER_HASHTAG,
        })
        run_id = run["data"]["id"]
        print(f"run {run_id} started — polling")

    while True:
        st = api(f"actor-runs/{run_id}")["data"]
        print(f"  {st['status']}")
        if st["status"] in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            break
        time.sleep(10)
    if st["status"] != "SUCCEEDED":
        sys.exit(f"run ended: {st['status']} — check the run in the Apify console")

    items = api(f"datasets/{st['defaultDatasetId']}/items?clean=true&format=json")
    print(f"{len(items)} items scraped")

    by_author = {}
    for it in items:
        meta = it.get("authorMeta") or {}
        handle = meta.get("name")
        if not handle:
            continue
        by_author.setdefault(handle, {"meta": meta, "posts": []})["posts"].append(it)

    now = time.time()
    out = []
    for handle, d in by_author.items():
        fans = d["meta"].get("fans") or 0
        if not (MIN_FOLLOWERS <= fans <= MAX_FOLLOWERS):
            continue
        posts = d["posts"][:MAX_POSTS_PER_AUTHOR]
        # TikTok reach is FYP-driven, so likes/followers measures virality, not
        # follower devotion. Median (likes+comments)/views is the cult-ness
        # proxy: of the people who saw it, how many cared — outlier-resistant.
        view_rates = [(p.get("diggCount", 0) + p.get("commentCount", 0)) / p["playCount"] * 100
                      for p in posts if p.get("playCount")]
        fol_rates = [(p.get("diggCount", 0) + p.get("commentCount", 0)) / fans * 100 for p in posts]
        if view_rates:
            eng, basis = round(statistics.median(view_rates), 1), "view"
        elif fol_rates:
            eng, basis = round(statistics.median(fol_rates), 1), "follower"
        else:
            eng, basis = 0, "follower"
        links = [d["meta"]["bioLink"]] if d["meta"].get("bioLink") else []
        out.append({
            "name": d["meta"].get("nickName") or handle,
            "handle": "@" + handle,
            "platform": "TT",
            "followers": fans,
            "engagementPct": eng,
            "engBasis": basis,
            "bio": d["meta"].get("signature") or "",
            "links": links,
            "posts": [{
                "caption": p.get("text", ""),
                "likes": p.get("diggCount", 0),
                "comments": p.get("commentCount", 0),
                "daysAgo": max(0, int((now - (p.get("createTime") or now)) / 86400)),
            } for p in posts],
        })

    out.sort(key=lambda c: -c["engagementPct"])
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apify-candidates.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"{len(out)} cult-size candidates ({MIN_FOLLOWERS}-{MAX_FOLLOWERS} followers) → {dest}")
    print("paste its contents into the radar's ＋ import")


if __name__ == "__main__":
    main()

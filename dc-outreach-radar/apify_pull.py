#!/usr/bin/env python3
"""Pull capper candidates from Apify (TikTok and/or Instagram) and emit
DC Outreach Radar import JSON.

Usage:
    python3 apify_pull.py [hashtag ...]              # TikTok sweep (default tags below)
    python3 apify_pull.py --ig [hashtag ...]         # Instagram two-pass sweep
    python3 apify_pull.py --run <runId>              # re-transform an existing TikTok run (free)

Token: APIFY_TOKEN env var, or ~/.apify_token.

Output: apify-candidates.json in this folder — merged by handle across runs,
so TikTok and Instagram sweeps accumulate into one file. Paste its contents
into the radar's ＋ import.

Engagement bases:
  TikTok    → median (likes+comments)/views  ("view" basis — FYP-adjusted)
  Instagram → median (likes+comments)/followers ("follower" basis — reach is
              follower-driven there, so per-follower devotion is the signal)

Cost (Apify pay-per-result): TikTok ~ $0.25 per default sweep;
Instagram ~ $0.50-1.00 (two passes: hashtag posts, then profile details).
"""
import json
import os
import ssl
import statistics
import sys
import time
import urllib.request
from datetime import datetime, timezone

try:
    import certifi  # macOS python.org builds ship without CA certs
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

TT_ACTOR = "clockworks~tiktok-scraper"
IG_HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"
IG_PROFILE_ACTOR = "apify~instagram-profile-scraper"

DEFAULT_TT_HASHTAGS = ["sportspicks", "bettingpicks", "parlaypicks"]
DEFAULT_IG_HASHTAGS = ["sportsbettingpicks", "parlaypicks", "dailypicks"]
RESULTS_PER_HASHTAG = 50
MAX_IG_PROFILES = 60          # cap the profile-details pass to bound cost
MIN_FOLLOWERS, MAX_FOLLOWERS = 3_000, 60_000   # override floor with --min
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


def wait_for_run(run_id):
    while True:
        st = api(f"actor-runs/{run_id}")["data"]
        print(f"  {st['status']}")
        if st["status"] in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            break
        time.sleep(10)
    if st["status"] != "SUCCEEDED":
        sys.exit(f"run ended: {st['status']} — check the run in the Apify console")
    return st


def run_and_fetch(actor, payload):
    run = api(f"acts/{actor}/runs", payload)
    run_id = run["data"]["id"]
    print(f"{actor} run {run_id} started — polling")
    st = wait_for_run(run_id)
    items = api(f"datasets/{st['defaultDatasetId']}/items?clean=true&format=json")
    print(f"  {len(items)} items")
    return items


def median_pct(rates):
    return round(statistics.median(rates), 1) if rates else 0


def days_ago_from_ts(ts, now):
    """ts may be unix seconds (int) or an ISO string."""
    if ts is None:
        return 0
    if isinstance(ts, (int, float)):
        secs = ts
    else:
        try:
            secs = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0
    return max(0, int((now - secs) / 86400))


# ---------------------------------------------------------------- TikTok ----

def collect_tiktok(hashtags, run_id=None):
    if run_id:
        print(f"re-using existing TikTok run {run_id} (no new scrape)")
        st = wait_for_run(run_id)
        items = api(f"datasets/{st['defaultDatasetId']}/items?clean=true&format=json")
        print(f"  {len(items)} items")
    else:
        print(f"TikTok: scraping #{' #'.join(hashtags)} ({RESULTS_PER_HASHTAG} results each)…")
        items = run_and_fetch(TT_ACTOR, {"hashtags": hashtags, "resultsPerPage": RESULTS_PER_HASHTAG})

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
        # TikTok reach is FYP-driven: median per-view engagement measures how
        # many actual viewers cared (outlier-resistant vs one viral hit).
        view_rates = [(p.get("diggCount", 0) + p.get("commentCount", 0)) / p["playCount"] * 100
                      for p in posts if p.get("playCount")]
        fol_rates = [(p.get("diggCount", 0) + p.get("commentCount", 0)) / fans * 100 for p in posts]
        eng, basis = (median_pct(view_rates), "view") if view_rates else (median_pct(fol_rates), "follower")
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
                "daysAgo": days_ago_from_ts(p.get("createTime"), now),
            } for p in posts],
        })
    return out


# ------------------------------------------------------------- Instagram ----

def collect_instagram(hashtags, handles=None):
    posts_by_owner = {}
    if handles:
        owners = [h.lstrip("@") for h in handles][:MAX_IG_PROFILES]
        print(f"Instagram: profile details for {len(owners)} given handles…")
    else:
        print(f"Instagram pass 1: scraping #{' #'.join(hashtags)} posts ({RESULTS_PER_HASHTAG} each)…")
        posts = run_and_fetch(IG_HASHTAG_ACTOR, {
            "hashtags": hashtags,
            "resultsLimit": RESULTS_PER_HASHTAG,
        })
        # collect unique post authors, keeping their hashtag-pass posts as fallback
        for p in posts:
            owner = p.get("ownerUsername") or (p.get("owner") or {}).get("username")
            if owner:
                posts_by_owner.setdefault(owner, []).append(p)
        owners = list(posts_by_owner.keys())[:MAX_IG_PROFILES]
        if not owners:
            sys.exit("Instagram pass 1 returned no post authors — try different hashtags")
        print(f"Instagram pass 2: profile details for {len(owners)} unique authors…")
    profiles = run_and_fetch(IG_PROFILE_ACTOR, {"usernames": owners})

    now = time.time()
    out = []
    for pr in profiles:
        handle = pr.get("username")
        if not handle or pr.get("private"):
            continue
        fans = pr.get("followersCount") or 0
        if not (MIN_FOLLOWERS <= fans <= MAX_FOLLOWERS):
            continue

        latest = pr.get("latestPosts") or posts_by_owner.get(handle, [])
        latest = latest[:MAX_POSTS_PER_AUTHOR]
        # IG reach is follower-driven → per-follower devotion is the cult
        # signal; median resists outliers; skip posts with hidden like counts.
        rates = [(p.get("likesCount", 0) + p.get("commentsCount", 0)) / fans * 100
                 for p in latest if (p.get("likesCount") or 0) >= 0 and fans]

        links = []
        ext = pr.get("externalUrls") or pr.get("externalUrl") or []
        if isinstance(ext, str):
            links = [ext]
        else:
            for e in ext:
                links.append(e.get("url") if isinstance(e, dict) else e)
        links = [l for l in links if l]

        bio = pr.get("biography") or ""
        category = pr.get("businessCategoryName") or pr.get("categoryName")
        if category:
            bio = f"{bio} · IG category: {category}" if bio else f"IG category: {category}"

        out.append({
            "name": pr.get("fullName") or handle,
            "handle": "@" + handle,
            "platform": "IG",
            "followers": fans,
            "engagementPct": median_pct(rates),
            "engBasis": "follower",
            "bio": bio,
            "links": links,
            "posts": [{
                "caption": p.get("caption") or p.get("text") or "",
                "likes": max(0, p.get("likesCount") or 0),
                "comments": p.get("commentsCount") or 0,
                "daysAgo": days_ago_from_ts(p.get("timestamp"), now),
            } for p in latest],
        })
    return out


# ------------------------------------------------------------------ main ----

def main():
    global MIN_FOLLOWERS
    args = sys.argv[1:]
    mode, run_id, handles = "tt", None, None
    while args and args[0].startswith("--"):
        if args[0] == "--ig":
            mode, args = "ig", args[1:]
        elif args[0] == "--ig-handles":              # profile-scrape specific handles (e.g. IG handles from TT bio links)
            mode, handles, args = "ig", [h for h in args[1].split(",") if h], args[2:]
        elif args[0] == "--run":
            run_id, args = args[1], args[2:]
        elif args[0] == "--min":                     # lower the follower floor (e.g. --min 500 to catch baby cappers)
            MIN_FOLLOWERS, args = int(args[1]), args[2:]
        else:
            sys.exit(f"unknown flag {args[0]}")

    if mode == "ig":
        candidates = collect_instagram(args or DEFAULT_IG_HASHTAGS, handles=handles)
    else:
        candidates = collect_tiktok(args or DEFAULT_TT_HASHTAGS, run_id=run_id)

    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apify-candidates.json")
    merged = {}
    if os.path.exists(dest):
        try:
            for c in json.load(open(dest)):
                merged[c["handle"].lower()] = c
        except (ValueError, KeyError):
            pass
    fresh = 0
    for c in candidates:
        if c["handle"].lower() not in merged:
            fresh += 1
        merged[c["handle"].lower()] = c
    result = sorted(merged.values(), key=lambda c: -c["engagementPct"])
    with open(dest, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\n{len(candidates)} cult-size candidates this sweep ({fresh} new) — "
          f"{len(result)} total in {os.path.basename(dest)}")
    print("paste its contents into the radar's ＋ import")


if __name__ == "__main__":
    main()

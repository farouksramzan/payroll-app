#!/usr/bin/env python3
"""Pull capper candidates from Apify (TikTok and/or Instagram) and emit
DC Outreach Radar import JSON.

Usage:
    python3 apify_pull.py [hashtag ...]              # TikTok sweep (default tags below)
    python3 apify_pull.py --ig [search term ...]     # Instagram combo: username search + hub-comment mining
    python3 apify_pull.py --ig-hashtags [tag ...]    # Instagram legacy hashtag route (weak yield)
    python3 apify_pull.py --ig-handles a,b,c         # Instagram: profile-scrape specific handles
    python3 apify_pull.py --hubs a,b --ig            # override comment-mining hub accounts
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
import re
import ssl
import statistics
import sys
import time
import urllib.error
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
IG_SEARCH_ACTOR = "apify~instagram-search-scraper"
IG_SEARCH_FALLBACK_ACTOR = "apify~instagram-scraper"   # search mode on the mega-actor
IG_COMMENT_ACTOR = "apify~instagram-comment-scraper"

DEFAULT_TT_HASHTAGS = ["sportspicks", "bettingpicks", "parlaypicks"]
# Legacy hashtag route (IG shows only a few "top" posts per tag — weak yield)
DEFAULT_IG_HASHTAGS = ["sportsbettingpicks", "parlaypicks", "dailypicks", "freepicks",
                       "bettingtips", "sportsbettingadvice", "prizepicks", "mlbpicks",
                       "nbapicks", "nflpicks"]
# IG combo discovery: username keyword search + hub-comment mining.
# Cappers self-label in handles; small cappers self-promote in hub comments.
DEFAULT_IG_SEARCH_TERMS = ["picks", "parlay", "locks", "betting picks"]
DEFAULT_IG_HUBS = ["pikkit", "br_betting", "actionnetworkhq"]
POSTS_PER_HUB = 2
COMMENTS_PER_POST = 60
SEARCH_RESULTS_PER_TERM = 30

CAPPER_NAME_RE = re.compile(
    r"(pick|parlay|lock|bets?\b|betz|cap+er|prop|odds|wager|slip|moneyline|underdog|degen)", re.I)
SELF_PROMO_RE = re.compile(
    r"(my (page|picks|card|group)|full card|link in bio|dm me|check (my|the) (page|profile|bio)"
    r"|free picks?|telegram|whop|winible|cash ?app)", re.I)
RESULTS_PER_HASHTAG = 50
MAX_IG_PROFILES = 60          # cap the profile-details pass to bound cost
MIN_FOLLOWERS, MAX_FOLLOWERS = 3_000, 60_000   # override floor with --min
MAX_POSTS_PER_AUTHOR = 5
# Cult filter: drop weak-engagement accounts at the source. Bases differ —
# ~2% of viewers engaging is a decent TikTok floor; ~1% of followers is a
# decent IG floor (small IG accounts with 0.2% medians are dead audiences).
MIN_ENGAGEMENT = {"view": 2.0, "follower": 1.0}


_TOKEN = None


def get_token():
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if not tok:
        path = os.path.expanduser("~/.apify_token")
        if os.path.exists(path):
            tok = open(path).read().strip()
    if not tok:
        raise RuntimeError("No Apify token. Set APIFY_TOKEN or save it to ~/.apify_token")
    _TOKEN = tok
    return tok


def api(path, payload=None):
    sep = "&" if "?" in path else "?"
    url = f"https://api.apify.com/v2/{path}{sep}token={get_token()}"
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
        raise RuntimeError(f"run ended: {st['status']} — check the run in the Apify console")
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

def ig_search_usernames(terms):
    """Username keyword search — cappers self-label their handles/names."""
    users = set()
    for term in terms:
        print(f"IG user search: “{term}”…")
        try:
            items = run_and_fetch(IG_SEARCH_ACTOR, {
                "search": term, "searchType": "user", "searchLimit": SEARCH_RESULTS_PER_TERM,
            })
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            items = run_and_fetch(IG_SEARCH_FALLBACK_ACTOR, {
                "search": term, "searchType": "user", "resultsLimit": SEARCH_RESULTS_PER_TERM,
            })
        for it in items:
            u = it.get("username") or it.get("ownerUsername")
            if u:
                users.add(u.lower())
    print(f"  user search found {len(users)} unique accounts")
    return users


def ig_hub_commenters(hubs):
    """Comment mining — small cappers self-promote in the comments of big
    betting hub accounts. Keep commenters with capper-flavored usernames or
    self-promo comment text."""
    print(f"IG hub comments: pulling recent posts from {', '.join('@' + h for h in hubs)}…")
    profiles = run_and_fetch(IG_PROFILE_ACTOR, {"usernames": list(hubs)})
    post_urls = []
    for pr in profiles:
        for p in (pr.get("latestPosts") or [])[:POSTS_PER_HUB]:
            if p.get("url"):
                post_urls.append(p["url"])
    if not post_urls:
        print("  no hub posts found — skipping comment mining")
        return set()
    print(f"  scraping comments on {len(post_urls)} hub posts…")
    items = run_and_fetch(IG_COMMENT_ACTOR, {
        "directUrls": post_urls, "resultsLimit": COMMENTS_PER_POST,
    })
    users = set()
    for c in items:
        u = c.get("ownerUsername") or c.get("username")
        if not u:
            continue
        if CAPPER_NAME_RE.search(u) or SELF_PROMO_RE.search(c.get("text") or ""):
            users.add(u.lower())
    print(f"  comment mining kept {len(users)} capper-pattern commenters")
    return users


def collect_instagram(handles=None, search_terms=None, hubs=None, hashtags=None):
    posts_by_owner = {}
    if handles:
        owners = [h.lstrip("@") for h in handles][:MAX_IG_PROFILES]
        print(f"Instagram: profile details for {len(owners)} given handles…")
    elif hashtags:
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
            raise RuntimeError("Instagram pass 1 returned no post authors — try different hashtags")
        print(f"Instagram pass 2: profile details for {len(owners)} unique authors…")
    else:
        # combo discovery: username search + hub-comment mining
        hubs = hubs or DEFAULT_IG_HUBS
        found = ig_search_usernames(search_terms or DEFAULT_IG_SEARCH_TERMS)
        found |= ig_hub_commenters(hubs)
        found -= {h.lower() for h in hubs}
        if not found:
            raise RuntimeError("IG combo discovery found no candidates — try different search terms/hubs")
        owners = sorted(found)[:MAX_IG_PROFILES]
        print(f"Instagram: profile details for {len(owners)} discovered accounts…")
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

def passes_engagement_floor(c):
    return c.get("engagementPct", 0) >= MIN_ENGAGEMENT.get(c.get("engBasis", "follower"), 0)


def merge_into_file(candidates):
    """Merge candidates into apify-candidates.json by handle, applying the
    engagement floor to new and existing entries. Returns (total, fresh, dropped, dest)."""
    kept = [c for c in candidates if passes_engagement_floor(c)]
    dropped = len(candidates) - len(kept)
    if dropped:
        print(f"engagement floor dropped {dropped} weak candidate{'s' if dropped != 1 else ''} "
              f"(view<{MIN_ENGAGEMENT['view']}% / follower<{MIN_ENGAGEMENT['follower']}%)")

    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apify-candidates.json")
    merged = {}
    if os.path.exists(dest):
        try:
            for c in json.load(open(dest)):
                if passes_engagement_floor(c):     # retroactive cleanup of old entries
                    merged[c["handle"].lower()] = c
        except (ValueError, KeyError):
            pass
    fresh = 0
    for c in kept:
        if c["handle"].lower() not in merged:
            fresh += 1
        merged[c["handle"].lower()] = c
    result = sorted(merged.values(), key=lambda c: -c["engagementPct"])
    with open(dest, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    return len(result), fresh, dropped, dest


def main():
    global MIN_FOLLOWERS
    args = sys.argv[1:]
    mode, run_id, handles, hubs = "tt", None, None, None
    while args and args[0].startswith("--"):
        if args[0] == "--ig":                        # combo: username search + hub comments (args = search terms)
            mode, args = "ig", args[1:]
        elif args[0] == "--ig-hashtags":             # legacy hashtag route (args = tags)
            mode, args = "ig-hash", args[1:]
        elif args[0] == "--ig-handles":              # profile-scrape specific handles
            mode, handles, args = "ig", [h for h in args[1].split(",") if h], args[2:]
        elif args[0] == "--hubs":                    # override comment-mining hub accounts
            hubs, args = [h.lstrip("@") for h in args[1].split(",") if h], args[2:]
        elif args[0] == "--run":
            run_id, args = args[1], args[2:]
        elif args[0] == "--min":                     # lower the follower floor (e.g. --min 500 to catch baby cappers)
            MIN_FOLLOWERS, args = int(args[1]), args[2:]
        else:
            sys.exit(f"unknown flag {args[0]}")

    try:
        if mode == "ig":
            candidates = collect_instagram(handles=handles, search_terms=(args or None), hubs=hubs)
        elif mode == "ig-hash":
            candidates = collect_instagram(hashtags=args or DEFAULT_IG_HASHTAGS)
        else:
            candidates = collect_tiktok(args or DEFAULT_TT_HASHTAGS, run_id=run_id)
    except RuntimeError as e:
        sys.exit(str(e))

    total, fresh, dropped, dest = merge_into_file(candidates)
    print(f"\n{len(candidates) - dropped} cult candidates this sweep ({fresh} new, {dropped} below engagement floor) — "
          f"{total} total in {os.path.basename(dest)}")
    print("paste its contents into the radar's ＋ import")


if __name__ == "__main__":
    main()

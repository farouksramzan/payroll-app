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

TT_ACTOR = "clockworks~tiktok-scraper"          # default; verified working on the FREE tier
TT_COMMENTS_ACTOR = "clockworks~tiktok-comments-scraper"
# apidojo is ~5x cheaper ($0.30 vs $1.70/1k) BUT verified (2026-07) to return
# {"noResults": true} on Apify's free plan ("subscribe to a paid plan" message).
# Only usable once on a paid Apify plan — where its schema mapping (channel.*)
# still needs a first-run field check. Keep clockworks as the free-tier default.
TT_ACTOR_CHEAP = "apidojo~tiktok-scraper"
IG_HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"
IG_PROFILE_ACTOR = "apify~instagram-profile-scraper"
IG_SEARCH_ACTOR = "apify~instagram-search-scraper"
IG_SEARCH_FALLBACK_ACTOR = "apify~instagram-scraper"   # search mode on the mega-actor
IG_COMMENT_ACTOR = "apify~instagram-comment-scraper"

DEFAULT_TT_HASHTAGS = ["sportspicks", "bettingpicks", "parlaypicks"]
DEEP_TT_HASHTAGS = ["sportspicks", "bettingpicks", "parlaypicks", "sportsbetting", "prizepicks",
                    "mlbpicks", "nbapicks", "nflpicks", "bettingtips", "freepicks",
                    "sportsgambling", "bettingslips", "picksandparlays", "underdogfantasy", "propbets"]
# TikTok keyword search (clockworks searchQueries) — a second discovery vein
# beyond hashtags: catches videos/captions that never used the tags.
DEFAULT_TT_SEARCH_TERMS = ["sports picks", "betting picks"]
DEEP_TT_SEARCH_TERMS = ["sports picks", "betting picks", "parlay picks", "free picks",
                        "nba picks", "nfl picks"]
# TikTok comment mining — big betting hub accounts whose comment sections
# attract small cappers self-promoting ("full card on my page").
DEFAULT_TT_HUBS = ["sportsbettingtiktok", "bookitwithtrent", "hoovelocks"]
TT_HUB_VIDEOS = 2
TT_COMMENTS_PER_VIDEO = 40
MAX_TT_COMMENTER_PROFILES = 15

# --- Source rotation ---------------------------------------------------------
# Repeated scans over identical sources mostly re-catch known accounts (dedupe
# absorbs them → low fresh yield). Each scan instead takes the next slice of
# these pools — all three discovery veins rotate: hashtag pages, keyword
# search, and comment-mining hubs. Cursors persist in rotation-state.json so
# consecutive scans fish different water until the pool wraps.
POOL_TT_HASHTAGS = DEEP_TT_HASHTAGS + [
    "playerprops", "parlay", "lockoftheday", "nhlpicks", "ufcpicks",
    "soccerpicks", "sportsbettingpicks", "dailypicks", "fanduel", "draftkings",
    "sportsbettor", "bettingadvice", "plusev", "handicapper", "pikkit"]
POOL_TT_SEARCH_TERMS = DEEP_TT_SEARCH_TERMS + [
    "lock of the day", "player props", "prizepicks locks", "mlb picks",
    "betting slips", "sports handicapper"]
# Hubs can't be invented (fake handles waste a scraper stage), so the hub pool
# grows itself: accounts the net catches that are too BIG to pitch (>=100k)
# are exactly the aggregators whose comment sections small cappers promote in.
MIN_HUB_FANS = 100_000
MAX_DISCOVERED_HUBS = 40
ROTATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rotation-state.json")
# Legacy hashtag route (IG shows only a few "top" posts per tag — weak yield)
DEFAULT_IG_HASHTAGS = ["sportsbettingpicks", "parlaypicks", "dailypicks", "freepicks",
                       "bettingtips", "sportsbettingadvice", "prizepicks", "mlbpicks",
                       "nbapicks", "nflpicks"]
# IG combo discovery: username keyword search + hub-comment mining.
# Cappers self-label in handles; small cappers self-promote in hub comments.
DEFAULT_IG_SEARCH_TERMS = ["picks", "parlay", "locks", "betting picks"]
DEEP_IG_SEARCH_TERMS = ["picks", "parlay", "locks", "betting picks", "sports picks", "daily picks",
                        "mlb picks", "nba picks", "nfl picks", "props", "free picks", "lock of the day"]
DEFAULT_IG_HUBS = ["pikkit", "br_betting", "actionnetworkhq"]
DEEP_IG_HUBS = ["pikkit", "br_betting", "actionnetworkhq", "prizepicks", "whop"]
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
# typical TikTok like-rate is 4-8% of viewers, so 3% is a real floor; on IG,
# 1.5% of followers engaging is solid for small accounts. Engagement is
# power-law distributed, so candidates pile up just above any floor — raise
# these (radar ⚙ settings, or scan opts minEng) to trade quantity for heat.
MIN_ENGAGEMENT = {"view": 3.0, "follower": 1.5}


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


RETRYABLE_STATUS = {403, 429, 500, 502, 503, 504}  # Apify throws transient 403s on free tier

def api(path, payload=None, retries=4):
    sep = "&" if "?" in path else "?"
    url = f"https://api.apify.com/v2/{path}{sep}token={get_token()}"
    data = json.dumps(payload).encode() if payload is not None else None
    delay = 3
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, context=SSL_CTX) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # retry transient rejections (esp. Apify's flaky free-tier 403s); re-raise the rest
            if e.code in RETRYABLE_STATUS and attempt < retries:
                print(f"  Apify {e.code} — retrying in {delay}s ({attempt + 1}/{retries})")
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise
        except urllib.error.URLError as e:
            if attempt < retries:
                print(f"  network error ({e}) — retrying in {delay}s ({attempt + 1}/{retries})")
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise


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


def field(d, *keys, default=None):
    """First present, non-None key — tolerates differing actor schemas."""
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default


def _load_rotation():
    try:
        with open(ROTATION_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_rotation(rot):
    try:
        with open(ROTATION_FILE, "w") as f:
            json.dump(rot, f, indent=1)
    except OSError:
        pass


def rotate_slice(key, pool, n):
    """Next n items of pool, resuming where the last scan left off (wraps)."""
    if not pool:
        return []
    if n >= len(pool):
        return list(pool)
    rot = _load_rotation()
    cur = int(rot.get("cursors", {}).get(key, 0)) % len(pool)
    picked = [pool[(cur + i) % len(pool)] for i in range(n)]
    rot.setdefault("cursors", {})[key] = (cur + n) % len(pool)
    _save_rotation(rot)
    return picked


def rotating_tt_sources(deep=False):
    """One scan's slice of all three TikTok discovery veins."""
    discovered = _load_rotation().get("discoveredHubs", [])
    known = {h.lower() for h in DEFAULT_TT_HUBS}
    hub_pool = DEFAULT_TT_HUBS + [h for h in discovered if h.lower() not in known]
    return {
        "hashtags": rotate_slice("tt_hashtags", POOL_TT_HASHTAGS, 8 if deep else 3),
        "search_terms": rotate_slice("tt_search", POOL_TT_SEARCH_TERMS, 4 if deep else 2),
        "hubs": rotate_slice("tt_hubs", hub_pool, 5 if deep else 3),
    }


def record_hub_prospects(items):
    """Harvest future comment-mining hubs from a scrape's oversized catches.

    Accounts above MIN_HUB_FANS are too big to pitch, but if their name/bio
    reads betting-flavored they're aggregators — the water small cappers
    self-promote in. Returns how many new hubs were added to the rotation."""
    names = []
    for it in items or []:
        a = it.get("authorMeta") or it.get("channel") or {}
        fans = int(field(a, "fans", "followers", default=0) or 0)
        name = str(field(a, "name", "username", default="") or "").strip().lstrip("@")
        bio = str(field(a, "signature", "bio", default="") or "")
        if fans >= MIN_HUB_FANS and name and CAPPER_NAME_RE.search(f"{name} {bio}"):
            names.append(name)
    if not names:
        return 0
    rot = _load_rotation()
    hubs = rot.get("discoveredHubs", [])
    known = {h.lower() for h in hubs} | {h.lower() for h in DEFAULT_TT_HUBS}
    added = 0
    for n in names:
        if n.lower() not in known:
            hubs.append(n)
            known.add(n.lower())
            added += 1
    if added:
        rot["discoveredHubs"] = hubs[-MAX_DISCOVERED_HUBS:]
        _save_rotation(rot)
    return added


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

def tt_hub_commenters(hubs, videos_per_hub=TT_HUB_VIDEOS, comments_per_video=TT_COMMENTS_PER_VIDEO):
    """TikTok comment mining — pull recent videos from big betting hub
    accounts, scrape their comments, and keep commenters whose username
    matches capper patterns or whose comment text reads as self-promo."""
    print(f"TikTok hub comments: recent videos from {', '.join('@' + h for h in hubs)}…")
    vids = run_and_fetch(TT_ACTOR, {"profiles": list(hubs), "resultsPerPage": videos_per_hub})
    urls = [v.get("webVideoUrl") for v in vids if v.get("webVideoUrl")]
    if not urls:
        print("  no hub videos found — skipping TikTok comment mining")
        return set()
    print(f"  scraping comments on {len(urls)} hub videos…")
    comments = run_and_fetch(TT_COMMENTS_ACTOR, {"postURLs": urls, "commentsPerPost": comments_per_video})
    users = set()
    for c in comments:
        u = field(c, "uniqueId", "username") or field(c.get("user") or {}, "uniqueId", "username")
        text = field(c, "text", "comment", default="")
        if not u:
            continue
        if CAPPER_NAME_RE.search(u) or SELF_PROMO_RE.search(text):
            users.add(u.lower().lstrip("@"))
    users -= {h.lower() for h in hubs}
    print(f"  comment mining kept {len(users)} capper-pattern commenters")
    return users


def collect_tiktok(hashtags, run_id=None, results_per_tag=RESULTS_PER_HASHTAG, cheap=False,
                   search_terms=None, hubs=None, videos_per_hub=TT_HUB_VIDEOS,
                   comments_per_video=TT_COMMENTS_PER_VIDEO,
                   max_commenter_profiles=MAX_TT_COMMENTER_PROFILES):
    """Unified TikTok discovery: hashtags + keyword search in one sweep,
    plus hub-comment mining (commenters get a profile pass). All sources
    merge into one candidate transform."""
    if run_id:
        print(f"re-using existing TikTok run {run_id} (no new scrape)")
        st = wait_for_run(run_id)
        items = api(f"datasets/{st['defaultDatasetId']}/items?clean=true&format=json")
        print(f"  {len(items)} items")
        return tiktok_items_to_candidates(items)

    items = []
    actor = TT_ACTOR_CHEAP if cheap else TT_ACTOR
    # Sources 1+2: hashtag sweep + keyword search in a single run
    if cheap:
        payload = {
            "startUrls": [f"https://www.tiktok.com/tag/{h.lstrip('#')}" for h in hashtags],
            "maxItems": results_per_tag * (len(hashtags) + len(search_terms or [])),
        }
        if search_terms:
            payload["keywords"] = list(search_terms)
    else:
        payload = {"hashtags": hashtags, "resultsPerPage": results_per_tag}
        if search_terms:
            payload["searchQueries"] = list(search_terms)
    srcs = f"#{' #'.join(hashtags)}" + (f" + search: {', '.join(search_terms)}" if search_terms else "")
    print(f"TikTok: scraping {srcs} via {actor}…")
    items += run_and_fetch(actor, payload)
    harvested = record_hub_prospects(items)
    if harvested:
        print(f"  hub harvest: +{harvested} big betting accounts added to the comment-mining rotation")

    # Source 3: hub-comment mining → profile pass on capper-pattern commenters
    # (uses clockworks actors regardless of cheap mode — the comments actor
    # has no apidojo equivalent wired here)
    if hubs:
        commenters = tt_hub_commenters(hubs, videos_per_hub, comments_per_video)
        if commenters:
            profs = sorted(commenters)[:max_commenter_profiles]
            print(f"  profiling {len(profs)} commenters…")
            items += run_and_fetch(TT_ACTOR, {"profiles": profs, "resultsPerPage": 3})

    return tiktok_items_to_candidates(items)


def tiktok_items_to_candidates(items, now=None):
    """Transform raw TikTok scrape items (clockworks OR apidojo schema) into
    radar candidates. Pure function — no network — so it's unit-testable
    against both actors' documented schemas."""
    now = now or time.time()
    by_author = {}
    for it in items:
        # author object differs by actor: clockworks=authorMeta, apidojo=channel
        meta = it.get("authorMeta") or it.get("channel") or it.get("author") or {}
        # handle: apidojo=username, clockworks=name (its unique handle). Prefer
        # username/uniqueId first so apidojo's channel.name (display) isn't mistaken for the handle.
        handle = field(meta, "uniqueId", "username", "userName", "name") or field(it, "authorName")
        if not handle:
            continue
        by_author.setdefault(handle, {"meta": meta, "posts": []})["posts"].append(it)

    out = []
    for handle, d in by_author.items():
        fans = field(d["meta"], "fans", "followers", "followerCount", "fansCount", default=0)
        if not (MIN_FOLLOWERS <= fans <= MAX_FOLLOWERS):
            continue
        posts = d["posts"][:MAX_POSTS_PER_AUTHOR]

        def likes(p): return field(p, "diggCount", "likes", "likeCount", default=0)
        def comments(p): return field(p, "commentCount", "comments", default=0)
        def plays(p): return field(p, "playCount", "views", default=0)
        # TikTok reach is FYP-driven: median per-view engagement measures how
        # many actual viewers cared (outlier-resistant vs one viral hit).
        view_rates = [(likes(p) + comments(p)) / plays(p) * 100
                      for p in posts if plays(p)]
        fol_rates = [(likes(p) + comments(p)) / fans * 100 for p in posts]
        eng, basis = (median_pct(view_rates), "view") if view_rates else (median_pct(fol_rates), "follower")
        # clockworks exposes an external bio link (bioLink); apidojo exposes only
        # the profile URL (channel.url) — keep a real external link if present.
        bio_link = field(d["meta"], "bioLink")
        links = [bio_link] if bio_link else []
        out.append({
            # display name: apidojo=channel.name, clockworks=authorMeta.nickName
            "name": field(d["meta"], "nickName", "nickname", "name", "fullName", default=handle),
            "handle": "@" + handle,
            "platform": "TT",
            "followers": fans,
            "engagementPct": eng,
            "engBasis": basis,
            "bio": field(d["meta"], "signature", "bio", "desc", default=""),
            "links": links,
            "posts": [{
                "caption": field(p, "text", "desc", "title", default=""),
                "likes": likes(p),
                "comments": comments(p),
                "daysAgo": days_ago_from_ts(
                    field(p, "createTime", "createTimeISO", "uploadedAt", "created"), now),
                # video thumbnail — the radar's vision pass reads these for
                # bet-slip screenshots and tracker watermarks
                "cover": field(p.get("videoMeta") or {}, "coverUrl", "originalCoverUrl")
                         or field(p, "coverUrl", "cover", "thumbnail", default="") or "",
            } for p in posts],
        })
    return out


# ------------------------------------------------------------- Instagram ----

def ig_search_usernames(terms, search_limit=SEARCH_RESULTS_PER_TERM):
    """Username keyword search — cappers self-label their handles/names."""
    users = set()
    for term in terms:
        print(f"IG user search: “{term}”…")
        try:
            items = run_and_fetch(IG_SEARCH_ACTOR, {
                "search": term, "searchType": "user", "searchLimit": search_limit,
            })
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            items = run_and_fetch(IG_SEARCH_FALLBACK_ACTOR, {
                "search": term, "searchType": "user", "resultsLimit": search_limit,
            })
        for it in items:
            u = it.get("username") or it.get("ownerUsername")
            if u:
                users.add(u.lower())
    print(f"  user search found {len(users)} unique accounts")
    return users


def ig_hub_commenters(hubs, posts_per_hub=POSTS_PER_HUB, comments_per_post=COMMENTS_PER_POST):
    """Comment mining — small cappers self-promote in the comments of big
    betting hub accounts. Keep commenters with capper-flavored usernames or
    self-promo comment text."""
    print(f"IG hub comments: pulling recent posts from {', '.join('@' + h for h in hubs)}…")
    profiles = run_and_fetch(IG_PROFILE_ACTOR, {"usernames": list(hubs)})
    post_urls = []
    for pr in profiles:
        for p in (pr.get("latestPosts") or [])[:posts_per_hub]:
            if p.get("url"):
                post_urls.append(p["url"])
    if not post_urls:
        print("  no hub posts found — skipping comment mining")
        return set()
    print(f"  scraping comments on {len(post_urls)} hub posts…")
    items = run_and_fetch(IG_COMMENT_ACTOR, {
        "directUrls": post_urls, "resultsLimit": comments_per_post,
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


def collect_instagram(handles=None, search_terms=None, hubs=None, hashtags=None,
                      search_limit=SEARCH_RESULTS_PER_TERM, posts_per_hub=POSTS_PER_HUB,
                      comments_per_post=COMMENTS_PER_POST, max_profiles=MAX_IG_PROFILES):
    posts_by_owner = {}
    if handles:
        owners = [h.lstrip("@") for h in handles][:max_profiles]
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
        owners = list(posts_by_owner.keys())[:max_profiles]
        if not owners:
            raise RuntimeError("Instagram pass 1 returned no post authors — try different hashtags")
        print(f"Instagram pass 2: profile details for {len(owners)} unique authors…")
    else:
        # combo discovery: username search + hub-comment mining
        hubs = hubs or DEFAULT_IG_HUBS
        found = ig_search_usernames(search_terms or DEFAULT_IG_SEARCH_TERMS, search_limit=search_limit)
        found |= ig_hub_commenters(hubs, posts_per_hub=posts_per_hub, comments_per_post=comments_per_post)
        found -= {h.lower() for h in hubs}
        if not found:
            raise RuntimeError("IG combo discovery found no candidates — try different search terms/hubs")
        owners = sorted(found)[:max_profiles]
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
    mode, run_id, handles, hubs, cheap = "tt", None, None, None, False
    while args and args[0].startswith("--"):
        if args[0] == "--cheap":                     # use apidojo TikTok actor (~5x cheaper; verify schema)
            cheap, args = True, args[1:]
        elif args[0] == "--ig":                      # combo: username search + hub comments (args = search terms)
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
            candidates = collect_tiktok(args or DEFAULT_TT_HASHTAGS, run_id=run_id, cheap=cheap)
    except RuntimeError as e:
        sys.exit(str(e))

    total, fresh, dropped, dest = merge_into_file(candidates)
    print(f"\n{len(candidates) - dropped} cult candidates this sweep ({fresh} new, {dropped} below engagement floor) — "
          f"{total} total in {os.path.basename(dest)}")
    print("paste its contents into the radar's ＋ import")


if __name__ == "__main__":
    main()

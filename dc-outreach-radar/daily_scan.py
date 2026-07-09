#!/usr/bin/env python3
"""Unattended daily capper sweep for the DC Outreach Radar.

Runs the widest sweep the budget allows, dedupes against everything ever
seen, and appends only genuinely-new cult-size cappers to
apify-candidates.json. Designed to be run once a day by launchd/cron so
the radar refills overnight — open it in the morning and the new accounts
auto-load (the radar reads this file on open).

Config via env vars (all optional):
  RADAR_PLATFORMS   "tt" | "ig" | "both"   (default "both")
  RADAR_DEEP        "1" for deep nets        (default "1")
  RADAR_CHEAP       "1" for cheaper actors   (default "1" — apidojo TikTok)
  RADAR_MIN_VIEW    TikTok eng/view floor %  (default 3)
  RADAR_MIN_FOL     IG eng/follower floor %  (default 1.5)
  APIFY_TOKEN       (or ~/.apify_token)

Honest expectation: yield is high the first few runs, then settles to the
market's daily replenishment (dozens–low hundreds), because the pool of
cult-size cappers is finite. A run log is written to daily_scan.log.
"""
import os
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import apify_pull as a  # noqa: E402

LOG = os.path.join(DIR, "daily_scan.log")


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def main():
    platforms = os.environ.get("RADAR_PLATFORMS", "both")
    deep = os.environ.get("RADAR_DEEP", "1") == "1"
    cheap = os.environ.get("RADAR_CHEAP", "1") == "1"
    a.MIN_ENGAGEMENT["view"] = float(os.environ.get("RADAR_MIN_VIEW", a.MIN_ENGAGEMENT["view"]))
    a.MIN_ENGAGEMENT["follower"] = float(os.environ.get("RADAR_MIN_FOL", a.MIN_ENGAGEMENT["follower"]))

    log(f"daily scan start — platforms={platforms} deep={deep} cheap={cheap} "
        f"floors(view={a.MIN_ENGAGEMENT['view']}, fol={a.MIN_ENGAGEMENT['follower']})")

    candidates = []
    try:
        if platforms in ("tt", "both"):
            rot = a.rotating_tt_sources(deep)
            log(f"tt sources — tags: {rot['hashtags']} · search: {rot['search_terms']} · hubs: {rot['hubs']}")
            candidates += a.collect_tiktok(
                rot["hashtags"],
                results_per_tag=100 if deep else a.RESULTS_PER_HASHTAG,
                cheap=cheap,
                search_terms=rot["search_terms"],
                hubs=rot["hubs"],
                videos_per_hub=3 if deep else 2,
                comments_per_video=100 if deep else a.TT_COMMENTS_PER_VIDEO,
                max_commenter_profiles=40 if deep else a.MAX_TT_COMMENTER_PROFILES,
            )
        if platforms in ("ig", "both"):
            if deep:
                candidates += a.collect_instagram(
                    search_terms=a.DEEP_IG_SEARCH_TERMS, hubs=a.DEEP_IG_HUBS,
                    search_limit=80, posts_per_hub=4, comments_per_post=120, max_profiles=400)
            else:
                candidates += a.collect_instagram()
    except Exception as e:  # never crash the scheduler; log and move on
        log(f"ERROR during scrape: {type(e).__name__}: {e}")
        sys.exit(1)

    total, fresh, dropped, _ = a.merge_into_file(candidates)
    log(f"done — {len(candidates) - dropped} passed floors, {fresh} NEW, "
        f"{dropped} below floor, {total} total in file")


if __name__ == "__main__":
    main()

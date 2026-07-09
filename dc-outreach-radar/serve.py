#!/usr/bin/env python3
"""DC Outreach Radar app server.

Serves the radar (static files in this folder) and exposes one endpoint:

    POST /api/scan   {"platforms": ["tt","ig"], "ttHashtags": [...], "igHashtags": [...],
                      "min": 3000, "ttRun": "<existing run id>"}   (all fields optional)

Runs the live Apify sweeps via apify_pull.py, merges results into
apify-candidates.json, and returns the new candidates as JSON so the app
can import them directly. Requires the Apify token (APIFY_TOKEN env var
or ~/.apify_token) — without it, /api/scan returns the error message.

Usage: PORT=4174 python3 serve.py
"""
import json
import os
import sys
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import apify_pull  # noqa: E402

# TikTok/IG CDNs 403 plain fetches but accept a browser UA — the radar's
# vision pass fetches thumbnails through this same-origin proxy, then sends
# them to Anthropic as base64. Host-restricted so this isn't an open proxy.
ALLOWED_IMG_HOSTS = (".tiktokcdn.com", ".tiktokcdn-us.com", ".ttwstatic.com",
                     ".cdninstagram.com", ".fbcdn.net")
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/cover?"):
            self._proxy_cover()
            return
        super().do_GET()

    def _proxy_cover(self):
        url = (parse_qs(urlparse(self.path).query).get("url") or [""])[0]
        host = urlparse(url).hostname or ""
        if not url.startswith("https://") or not any(host.endswith(h) for h in ALLOWED_IMG_HOSTS):
            self.send_error(400, "unsupported image host")
            return
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": BROWSER_UA, "Referer": "https://www.tiktok.com/"})
            with urllib.request.urlopen(req, context=apify_pull.SSL_CTX, timeout=20) as r:
                data = r.read()
                ctype = r.headers.get("Content-Type", "image/jpeg")
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(502, f"cover fetch failed: {e}")

    def do_POST(self):
        if self.path != "/api/scan":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            opts = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if opts.get("min"):
                apify_pull.MIN_FOLLOWERS = int(opts["min"])
            if isinstance(opts.get("minEng"), dict):
                for k in ("view", "follower"):
                    if opts["minEng"].get(k) is not None:
                        apify_pull.MIN_ENGAGEMENT[k] = float(opts["minEng"][k])
            platforms = opts.get("platforms") or ["tt", "ig"]
            deep = bool(opts.get("deep"))

            candidates = []
            sources = None
            if "tt" in platforms:
                # each scan fishes the next slice of the source pools — all
                # three veins rotate (hashtags, keyword search, comment hubs)
                rot = apify_pull.rotating_tt_sources(deep)
                tags = opts.get("ttHashtags") or rot["hashtags"]
                terms = opts.get("ttSearch") or rot["search_terms"]
                hubs = None if opts.get("noComments") else (opts.get("ttHubs") or rot["hubs"])
                sources = {"hashtags": tags, "searchTerms": terms, "hubs": hubs or []}
                candidates += apify_pull.collect_tiktok(
                    tags,
                    run_id=opts.get("ttRun"),
                    results_per_tag=100 if deep else apify_pull.RESULTS_PER_HASHTAG,
                    cheap=bool(opts.get("cheap")),
                    search_terms=terms,
                    hubs=hubs,
                    videos_per_hub=3 if deep else 2,
                    comments_per_video=100 if deep else apify_pull.TT_COMMENTS_PER_VIDEO,
                    max_commenter_profiles=40 if deep else apify_pull.MAX_TT_COMMENTER_PROFILES,
                )
            if "ig" in platforms:
                if opts.get("igHashtags"):
                    candidates += apify_pull.collect_instagram(hashtags=opts["igHashtags"])
                elif deep:
                    candidates += apify_pull.collect_instagram(
                        search_terms=opts.get("igSearch") or apify_pull.DEEP_IG_SEARCH_TERMS,
                        hubs=opts.get("igHubs") or apify_pull.DEEP_IG_HUBS,
                        search_limit=80, posts_per_hub=4, comments_per_post=120, max_profiles=400)
                else:
                    candidates += apify_pull.collect_instagram(
                        search_terms=opts.get("igSearch"), hubs=opts.get("igHubs"))
            total, fresh, dropped, _ = apify_pull.merge_into_file(candidates)
            kept = [c for c in candidates if apify_pull.passes_engagement_floor(c)]
            self._json(200, {"candidates": kept, "fresh": fresh, "dropped": dropped,
                             "totalInFile": total, "sources": sources})
        except RuntimeError as e:
            self._json(500, {"error": str(e)})
        except Exception as e:  # keep the server alive on unexpected failures
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(os.environ.get("PORT") or 4174)
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=DIR))
    print(f"DC Outreach Radar serving on http://localhost:{port} (POST /api/scan enabled)")
    server.serve_forever()


if __name__ == "__main__":
    main()

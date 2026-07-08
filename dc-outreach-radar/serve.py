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
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import apify_pull  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
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
            if "tt" in platforms:
                candidates += apify_pull.collect_tiktok(
                    opts.get("ttHashtags") or (apify_pull.DEEP_TT_HASHTAGS if deep else apify_pull.DEFAULT_TT_HASHTAGS),
                    run_id=opts.get("ttRun"),
                    results_per_tag=100 if deep else apify_pull.RESULTS_PER_HASHTAG,
                    cheap=bool(opts.get("cheap")),
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
            self._json(200, {"candidates": kept, "fresh": fresh, "dropped": dropped, "totalInFile": total})
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

"""Poll /health, /ready, /status on a port and append every response to a JSONL log.

Stops when /ready returns 200 three times in a row, or after a timeout.
"""
import json
import sys
import time
import urllib.error
import urllib.request

port = int(sys.argv[1])
out = sys.argv[2]
timeout_s = float(sys.argv[3]) if len(sys.argv) > 3 else 900
paths = ["/health", "/ready", "/status"]
start = time.time()
ready_streak = 0


def fetch(path):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:  # connection refused etc.
        return None, {}, f"{type(e).__name__}: {e}"


with open(out, "a") as f:
    while time.time() - start < timeout_s:
        for p in paths:
            code, headers, body = fetch(p)
            f.write(json.dumps({"t": round(time.time() - start, 3), "path": p, "code": code,
                                "headers": headers, "body": body}) + "\n")
            f.flush()
            if p == "/ready":
                ready_streak = ready_streak + 1 if code == 200 else 0
        if ready_streak >= 3:
            break
        time.sleep(0.4)

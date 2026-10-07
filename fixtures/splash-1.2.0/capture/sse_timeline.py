"""POST a JSON body and record every SSE line with its arrival time (ms since request start).

usage: sse_timeline.py URL BODY_JSON_FILE OUT_TIMELINE_JSONL [EXTRA_HEADER ...]
"""
import http.client
import json
import sys
import time
from urllib.parse import urlparse

url, body_file, out = sys.argv[1:4]
extra = sys.argv[4:]
u = urlparse(url)
body = open(body_file, "rb").read()
conn = http.client.HTTPConnection(u.hostname, u.port, timeout=600)
headers = {"Content-Type": "application/json", "Content-Length": str(len(body))}
for h in extra:
    k, v = h.split(":", 1)
    headers[k.strip()] = v.strip()
t0 = time.monotonic()
conn.request("POST", u.path, body=body, headers=headers)
resp = conn.getresponse()
with open(out, "w") as f:
    f.write(json.dumps({"t_ms": round((time.monotonic() - t0) * 1000, 3), "status": resp.status,
                        "headers": dict(resp.getheaders())}) + "\n")
    while True:
        line = resp.fp.readline()
        if not line:
            break
        f.write(json.dumps({"t_ms": round((time.monotonic() - t0) * 1000, 3),
                            "line": line.decode("utf-8", "replace").rstrip("\n")}) + "\n")
        f.flush()

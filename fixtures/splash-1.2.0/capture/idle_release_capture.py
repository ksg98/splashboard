"""Start splash serve, wait for the 10-minute idle weight release, then capture
/health, /ready, /status while released and while weights restore on the next
request. Stops the server at the end (SIGINT, then SIGTERM)."""
import json
import os
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request

F = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
S = os.environ.get("CAPTURE_TMP", "/tmp/splash-capture")
PORT = 8011
B = f"http://127.0.0.1:{PORT}"
LOG = f"{F}/serve_idle_release.log"
TRACE = f"{S}/idle_release_trace.jsonl"
t0 = time.time()


def note(**kw):
    kw["t"] = round(time.time() - t0, 3)
    with open(TRACE, "a") as f:
        f.write(json.dumps(kw) + "\n")


def get(path, timeout=5):
    try:
        with urllib.request.urlopen(B + path, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return None, f"{type(e).__name__}: {e}".encode()


def log_text():
    try:
        return open(LOG).read()
    except OSError:
        return ""


log = open(LOG, "w")
proc = subprocess.Popen(
    ["splash", "serve", "--model", "incoai/Qwen3.8-27B-Splash", "--port", str(PORT), "--offline"],
    stdout=log, stderr=subprocess.STDOUT)
open(f"{S}/serve3.pid", "w").write(str(proc.pid))
note(event="started", pid=proc.pid)

try:
    while time.time() - t0 < 240:
        code, _ = get("/ready", 1)
        if code == 200:
            break
        time.sleep(0.5)
    note(event="ready")
    # One request so the idle clock starts from a real request.
    req = urllib.request.Request(B + "/v1/chat/completions", data=json.dumps(
        {"messages": [{"role": "user", "content": "Say OK."}], "reasoning_effort": "none", "max_tokens": 8}).encode(),
        headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=120).read()
    last_request = time.time()
    note(event="warm_request_done")

    released_at = None
    while time.time() - last_request < 15 * 60:
        rc, rb = get("/ready")
        sc, sb = get("/status", 10)
        entry = {"event": "poll", "ready_code": rc, "ready": rb.decode(errors="replace")}
        try:
            st = json.loads(sb)
            entry.update(status_ready=st.get("ready"), current_bytes=st["memory_actual"]["current_bytes"],
                         allocated_bytes=st["memory_actual"]["allocated_bytes"],
                         charged=st["memory_governor"]["charged_bytes"], transport=st["transport"])
        except Exception as e:
            entry["status_error"] = str(e)
        note(**entry)
        if released_at is None and "Weights released" in log_text():
            released_at = time.time()
            note(event="released_line_seen")
        if released_at is not None and time.time() - released_at > 6:
            break
        time.sleep(5)

    for name, path in (("health_idle_released.json", "/health"), ("ready_idle_released.json", "/ready"),
                       ("status_idle_released.json", "/status"), ("metrics_idle_released.txt", "/metrics")):
        code, body = get(path, 10)
        open(f"{F}/{name}", "wb").write(body)
        note(event="saved", name=name, code=code)

    # Next request restores the weights; poll while it runs.
    body = {"model": "incoai/Qwen3.8-27B-Splash", "messages": [{"role": "user", "content": "Say hello in one word."}],
            "stream": True, "stream_options": {"include_usage": True}, "return_progress": True,
            "reasoning_effort": "none", "max_tokens": 16}
    json.dump(body, open(f"{F}/req_chat_stream_after_idle.json", "w"))
    done = threading.Event()

    def run_stream():
        subprocess.run(["python3", f"{S}/sse_timeline.py", B + "/v1/chat/completions",
                        f"{F}/req_chat_stream_after_idle.json", f"{F}/chat_stream_after_idle.timeline.jsonl"])
        done.set()

    threading.Thread(target=run_stream, daemon=True).start()
    t_req = time.time()
    saved_restoring = False
    seen = set()
    while not done.is_set() and time.time() - t_req < 300:
        rc, rb = get("/ready", 2)
        sc, sb = get("/status", 2)
        key = (rc, rb)
        entry = {"event": "restore_poll", "dt": round(time.time() - t_req, 3), "ready_code": rc,
                 "ready": rb.decode(errors="replace")}
        try:
            st = json.loads(sb)
            entry.update(status_ready=st.get("ready"), current_bytes=st["memory_actual"]["current_bytes"],
                         transport=st["transport"], scheduler=st["scheduler"], admission=st["admission"])
            if not saved_restoring:
                open(f"{F}/status_restoring.json", "wb").write(sb)
                saved_restoring = True
        except Exception as e:
            entry["status_error"] = str(e)[:200]
        note(**entry)
        if key not in seen:
            seen.add(key)
            if rc == 503:
                open(f"{F}/ready_restoring.json", "wb").write(rb)
        time.sleep(0.25)
    note(event="stream_done", dt=round(time.time() - t_req, 3))
    time.sleep(2)
    code, body = get("/status", 10)
    open(f"{F}/status_after_restore.json", "wb").write(body)
finally:
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(30)
        note(event="stopped", returncode=proc.returncode)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(30)
            note(event="terminated", returncode=proc.returncode)
        except subprocess.TimeoutExpired:
            proc.kill()
            note(event="killed")
    log.close()

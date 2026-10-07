"""Write fixtures/splash-1.2.0/manifest.json describing every fixture file."""
import json
import os

F = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MAIN = ["splash", "serve", "--model", "incoai/Qwen3.8-27B-Splash", "--port", "8011", "--offline"]
CORS = MAIN + ["--allowed-origin", "tauri://localhost", "--allowed-origin", "http://localhost:1420"]
SESSIONS = {
    "main": {"argv": MAIN, "env": {}, "log": "serve.log"},
    "cors_apikey": {"argv": CORS, "env": {"SPLASH_API_KEY": "splashboard-test-key"}, "log": "serve_cors_apikey.log"},
    "idle_release": {"argv": MAIN, "env": {}, "log": "serve_idle_release.log"},
}
C = "/v1/chat/completions"
E = {
    # file: (session, method, path, request_body_file_or_inline, http_status, kind, note)
    "serve.log": ("main", None, None, None, None, "log", "stdout+stderr of the main session, startup to Stopping"),
    "startup_probe.jsonl": ("main", "GET", "/health,/ready,/status", None, None, "probe-log",
                            "poller during startup: t (seconds since the poller started; splash serve was spawned at t~3), path, code (null = network error: refused, then connect timeouts), body"),
    "serve_cors_apikey.log": ("cors_apikey", None, None, None, None, "log", "second session"),
    "serve_port_in_use.log": ("cors_apikey", None, None, None, None, "log",
                              "a second `splash serve --port 8011` while cors_apikey ran: launcher refusal, exit 1"),
    "serve_idle_release.log": ("idle_release", None, None, None, None, "log", "third session: idle weight release/restore"),
    "idle_release_trace.jsonl": ("idle_release", "GET", "/ready,/status", None, None, "probe-log",
                                 "polls every 5 s while idle, then every 0.25 s during restore"),
    "health.json": ("main", "GET", "/health", None, 200, "json", None),
    "health.headers.txt": ("main", "GET", "/health", None, 200, "headers", None),
    "ready.json": ("main", "GET", "/ready", None, 200, "json", None),
    "ready.headers.txt": ("main", "GET", "/ready", None, 200, "headers", None),
    "status_idle.json": ("main", "GET", "/status", None, 200, "json", "right after Ready, before any request"),
    "status_busy.json": ("main", "GET", "/status", None, 200, "json",
                         "2.013 s into req_chat_stream_long.json (single lane decoding)"),
    "status_busy_2.json": ("main", "GET", "/status", None, 200, "json", "1.006 s after status_busy.json"),
    "status_saturated.json": ("main", "GET", "/status", None, 200, "json",
                              "4 lanes decoding + 1 request waiting for concurrency"),
    "status_after_cancel.json": ("main", "GET", "/status", None, 200, "json", "1 s after chat_stream_cancelled"),
    "status_after.json": ("main", "GET", "/status", None, 200, "json", "after all main-session chat captures"),
    "metrics.txt": ("main", "GET", "/metrics", None, 200, "prometheus", None),
    "metrics.headers.txt": ("main", "GET", "/metrics", None, 200, "headers", None),
    "models.json": ("main", "GET", "/v1/models", None, 200, "json", None),
    "models.headers.txt": ("main", "GET", "/v1/models", None, 200, "headers", None),
    "model_get.json": ("main", "GET", "/v1/models/incoai/Qwen3.8-27B-Splash", None, 200, "json", None),
    "chat_stream_thinking.sse": ("main", "POST", C, "req_chat_stream_thinking.json", 200, "sse", "default effort"),
    "chat_stream_thinking.headers.txt": ("main", "POST", C, "req_chat_stream_thinking.json", 200, "headers", None),
    "chat_stream_no_thinking.sse": ("main", "POST", C, "req_chat_stream_no_thinking.json", 200, "sse", None),
    "chat_stream_no_thinking.headers.txt": ("main", "POST", C, "req_chat_stream_no_thinking.json", 200, "headers", None),
    "chat_stream_tools.sse": ("main", "POST", C, "req_chat_tools_stream.json", 200, "sse", None),
    "chat_stream_cancelled.sse": ("main", "POST", C,
                                  {"messages": [{"role": "user", "content": "Count from 1 to 500, one number per line."}],
                                   "stream": True, "reasoning_effort": "none", "max_tokens": 2000},
                                  200, "sse", "client closed the connection after 1.5 s; truncated, no [DONE]"),
    "chat_stream_long.timeline.jsonl": ("main", "POST", C, "req_chat_stream_long.json", 200, "sse-timeline",
                                        "first line = status+headers; then {t_ms, line} per SSE line"),
    "chat_stream_long_prompt.timeline.jsonl": ("main", "POST", C, "req_chat_stream_long_prompt.json", 200, "sse-timeline",
                                               "13,116-token prompt, return_progress"),
    "chat_stream_queued.timeline.jsonl": ("main", "POST", C, "req_chat_stream_queued.json", 200, "sse-timeline",
                                          "sent while 4 other 350-token requests occupied every lane"),
    "chat_nonstream.json": ("main", "POST", C, "req_chat_nonstream.json", 200, "json", None),
    "chat_nonstream.headers.txt": ("main", "POST", C, "req_chat_nonstream.json", 200, "headers", None),
    "chat_nonstream_enable_thinking_false.json": ("main", "POST", C,
                                                  {"messages": [{"role": "user", "content": "Say hi."}],
                                                   "chat_template_kwargs": {"enable_thinking": False}, "max_tokens": 32},
                                                  200, "json", None),
    "chat_nonstream_effort_low.json": ("main", "POST", C,
                                       {"messages": [{"role": "user", "content": "Say hi."}],
                                        "reasoning_effort": "low", "max_tokens": 256}, 200, "json", None),
    "chat_nonstream_json_schema.json": ("main", "POST", C,
                                        {"messages": [{"role": "user", "content": "Give me a JSON object with name and age for a fictional person."}],
                                         "reasoning_effort": "none",
                                         "response_format": {"type": "json_schema", "json_schema": {"name": "person", "schema": {
                                             "type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
                                             "required": ["name", "age"], "additionalProperties": False}}},
                                         "max_tokens": 128}, 200, "json", None),
    "chat_nonstream_image.json": ("main", "POST", C, "req_chat_image.json", 200, "json", "64x64 red PNG data URL"),
    "completions_nonstream.json": ("main", "POST", "/v1/completions",
                                   {"model": "incoai/Qwen3.8-27B-Splash", "prompt": "The capital of France is",
                                    "max_tokens": 8, "temperature": 0}, 200, "json", None),
    "responses_stream.sse": ("main", "POST", "/v1/responses",
                             {"model": "incoai/Qwen3.8-27B-Splash", "input": "In five words, what is Splash?",
                              "reasoning": {"effort": "low"}, "max_output_tokens": 256, "stream": True},
                             200, "sse", "ends response.incomplete (budget spent in reasoning)"),
    "messages_stream.sse": ("main", "POST", "/v1/messages",
                            {"model": "incoai/Qwen3.8-27B-Splash", "max_tokens": 256,
                             "messages": [{"role": "user", "content": "In five words, what is the sky?"}],
                             "thinking": {"type": "enabled", "budget_tokens": 1024}, "stream": True},
                            200, "sse", "stop_reason max_tokens"),
    "tokenize.json": ("main", "POST", "/tokenize", {"content": "Hello world"}, 200, "json", None),
    "apply_template.json": ("main", "POST", "/apply-template",
                            {"messages": [{"role": "user", "content": "Hello"}], "reasoning_effort": "low"}, 200, "json", None),
    "error_400.json": ("main", "POST", C, "req_error_400.json", 400, "json", "temperature 5"),
    "error_400.headers.txt": ("main", "POST", C, "req_error_400.json", 400, "headers", None),
    "error_404.json": ("main", "GET", "/v1/nope", None, 404, "json", None),
    "error_model_not_found.json": ("main", "POST", C, {"model": "nope/model", "messages": [{"role": "user", "content": "hi"}]},
                                   404, "json", None),
    "error_reasoning_effort.json": ("main", "POST", C, {"messages": [{"role": "user", "content": "hi"}],
                                                        "reasoning_effort": "turbo", "max_tokens": 8}, 400, "json", None),
    "error_context_length.json": ("main", "POST", C, {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 300000},
                                  400, "json", None),
    "origin_forbidden.json": ("main", "GET", "/health", None, 403, "json", "header Origin: tauri://localhost"),
    "origin_forbidden.headers.txt": ("main", "GET", "/health", None, 403, "headers", "header Origin: tauri://localhost"),
    "origin_forbidden_chat.json": ("main", "POST", C, "req_error_400.json", 403, "json", "header Origin: tauri://localhost"),
    "origin_preflight_forbidden.json": ("main", "OPTIONS", C, None, 403, "json",
                                        "Origin: tauri://localhost, Access-Control-Request-Method: POST"),
    "origin_preflight_forbidden.headers.txt": ("main", "OPTIONS", C, None, 403, "headers", None),
    "host_forbidden.json": ("main", "GET", "/health", None, 403, "json", "header Host: mymac.local"),
    "error_401.json": ("cors_apikey", "GET", "/status", None, 401, "json", "no Authorization header"),
    "cors_preflight_allowed.headers.txt": ("cors_apikey", "OPTIONS", C, None, 204, "headers",
                                           "Origin: tauri://localhost; Access-Control-Request-Headers: authorization,content-type"),
    "cors_status_allowed.headers.txt": ("cors_apikey", "GET", "/status", None, 200, "headers",
                                        "Origin: tauri://localhost + Bearer key"),
    "cors_stream_allowed.headers.txt": ("cors_apikey", "POST", C,
                                        {"messages": [{"role": "user", "content": "Say OK."}], "reasoning_effort": "none",
                                         "max_tokens": 8, "stream": True}, 200, "headers",
                                        "Origin: tauri://localhost + Bearer key"),
    "health_idle_released.json": ("idle_release", "GET", "/health", None, 200, "json", "after 'Weights released' log line"),
    "ready_idle_released.json": ("idle_release", "GET", "/ready", None, 200, "json", "after 'Weights released' log line"),
    "status_idle_released.json": ("idle_release", "GET", "/status", None, 200, "json", "after 'Weights released' log line"),
    "metrics_idle_released.txt": ("idle_release", "GET", "/metrics", None, 200, "prometheus", "after release"),
    "status_restore_start.json": ("idle_release", "GET", "/status", None, 200, "json",
                                  "taken 4 ms after sending the post-idle request, before it was queued: still the released state; mid-restore values are in idle_release_trace.jsonl"),
    "chat_stream_after_idle.timeline.jsonl": ("idle_release", "POST", C, "req_chat_stream_after_idle.json", 200,
                                              "sse-timeline", "first request after release; includes restore wait"),
    "status_after_restore.json": ("idle_release", "GET", "/status", None, 200, "json", "2 s after that request finished"),
}

files = sorted(f for f in os.listdir(F) if os.path.isfile(os.path.join(F, f)) and f != "manifest.json")
out = {"splash_version": "1.2.0", "status_schema_version": 6, "captured": "2026-10-04",
       "machine": "MacBook Pro M3 Max, 40-core GPU, 64 GB, macOS 26.6.2",
       "model": "incoai/Qwen3.8-27B-Splash (legacy Splash package, vision on, context 262144)",
       "note": "Throughput numbers were measured while the machine ran other work; do not treat them as benchmarks.",
       "sessions": SESSIONS,
       "capture_scripts_note": "capture/*.py document how these fixtures were produced; their path constants (scratchpad and fixture dirs) must be edited before re-running.",
       "files": {}}
for f in files:
    if f.startswith("req_"):
        out["files"][f] = {"kind": "request-body"}
        continue
    meta = E.get(f)
    if meta is None:
        out["files"][f] = {"kind": "unknown"}
        continue
    session, method, path, req, status, kind, note = meta
    entry = {"session": session, "kind": kind}
    if method:
        entry["method"] = method
    if path:
        entry["path"] = path
    if isinstance(req, str):
        entry["request_body_file"] = req
    elif req is not None:
        entry["request_body"] = req
    if status is not None:
        entry["http_status"] = status
    if note:
        entry["note"] = note
    entry["provenance"] = "observed"
    out["files"][f] = entry
missing = sorted(set(E) - set(files))
out["expected_but_absent"] = missing
with open(os.path.join(F, "manifest.json"), "w") as fh:
    json.dump(out, fh, indent=2)
    fh.write("\n")
print("files", len(files), "unknown", [k for k, v in out["files"].items() if v["kind"] == "unknown"], "absent", missing)

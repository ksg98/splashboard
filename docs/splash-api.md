# Splash HTTP API contract for Splashboard

Single source of truth for the Splashboard UI's integration with the Splash local
inference server. It covers what the UI calls, what comes back, and how the server
behaves from outside.

- **Target:** Splash **1.2.0** (Homebrew `incoai/tap/splash`, `release.json` version
  `1.2.0`, native wire protocol 7, `/status` `schema_version` 6).
- **Sources:** the 1.2.0 source (`splash-src/server/*.py`, `install/*.py`,
  `runtime/engine/*`, `README.md`, `DEVELOPMENT.md`, `docs/`), `splash --help` and
  `splash serve --help`, the GitHub release notes for 1.0 to 1.2.0, older tags'
  files fetched read-only with `gh api .../contents?ref=<tag>`, and **live captures**
  from `splash serve --model incoai/Qwen3.8-27B-Splash --port 8011 --offline` on an
  M3 Max (40-core GPU, 64 GB, macOS 26.6.2) on 2026-10-04.
- **Fixtures:** `fixtures/splash-1.2.0/`. They are referenced inline as
  `[fx: file]`. `fixtures/splash-1.2.0/manifest.json` maps every file to its request,
  server flags and kind (observed or source-derived). The capture scripts are in
  `fixtures/splash-1.2.0/capture/`.
- **Markers:** **[observed]** means seen live in this capture. **[source]** means
  read from code and not reproduced live.

> **Performance numbers below are what this run measured, on a machine that was
> also running other work.** Examples: 4 concurrent lanes ran at about 9 tok/s each,
> and a 13K-token prefill ran at 183 tok/s. That is well below the README's M3 Max
> figures (92 tok/s decode for the 27B GGUF). Never hard-code speed expectations.

---

## 1. Transport basics

| Fact | Detail |
| --- | --- |
| Base URL | `http://127.0.0.1:<port>`, default port `8000` (`--port` or `SPLASH_PORT`). Bind address `--host`, default `127.0.0.1`. |
| HTTP | HTTP/1.1, `Server: Splash`. **Every response carries `Connection: close`** [observed], so there is no keep-alive or pooling. Each poll is a fresh TCP connection. |
| Request bodies | `Content-Type: application/json` (or `application/*+json`), exactly one `Content-Length`. No `Transfer-Encoding` (400) and no `Content-Encoding` (415). A wrong type gives `415 "Content-Type must be application/json"` [observed]. Limit 128 MiB (`--max-request-size`), 413 above it. |
| JSON errors (OpenAI dialect, all non-`/v1/messages` routes) | `{"error":{"message":str,"type":"invalid_request_error"\|"server_error","code":str}}`. `type` is `server_error` when status ≥ 500. [fx: error_400.json] |
| JSON errors (Anthropic dialect, `/v1/messages*`) | `{"type":"error","error":{"type":<anthropic type>,"message":str}}`. The type is mapped from the status: 401 `authentication_error`, 403 `permission_error`, 404 `not_found_error`, 408/504 `timeout_error`, 413 `request_too_large`, 429 `rate_limit_error`, 503 `overloaded_error`, other ≥500 `api_error`, else `invalid_request_error`. |
| Retry hints | Every 503 carries `Retry-After: 1`. Every 401 carries `WWW-Authenticate: Bearer`. |
| IDs | Chat `chatcmpl-<32 hex>`, text completion `cmpl-<hex>`, Responses `resp_<hex>`, Messages `msg_<hex>`. Tool call ids are `call_<request hex>_<n>`. `created` is unix seconds. |
| Model name | Responses report the loaded `--model` id (for example `incoai/Qwen3.8-27B-Splash`) unless `--announce-served-name` is set. The `model` field is optional in requests. If present, it must be one of the names `/v1/models` lists, otherwise `404 model_not_found` [fx: error_model_not_found.json]. |

## 2. Route table (1.2.0)

Every route first passes the **Host/Origin check** (section 3). That includes
`/health` and `/ready`: a disallowed Origin gets 403 even on `/health`
[fx: origin_forbidden.json]. "Public" in the table means public with respect to the
API key only.

| Method | Path | Purpose | API key (when `--api-key`/`SPLASH_API_KEY` set) | Fixture |
| --- | --- | --- | --- | --- |
| GET/HEAD | `/health` | Liveness of the HTTP process. Always `200 {"status":"ok"}` once the socket listens. | public | health.json |
| GET/HEAD | `/ready` | `200 {"status":"ready"}` while the engine's own `ready` is true, else `503 {"status":"unavailable"}` | public | ready.json |
| GET/HEAD | `/status` | Full JSON status, schema 6 (section 9) | **required** | status_idle.json, status_busy.json |
| GET/HEAD | `/metrics` | Prometheus text 0.0.4 built from `/status` | **required** | metrics.txt |
| GET/HEAD | `/v1/models` | Model list (OpenAI shape plus a TypeSafe `models` array) | required | models.json |
| GET/HEAD | `/v1/models/{id}` | One model. The id may contain `/`, e.g. `/v1/models/incoai/Qwen3.8-27B-Splash`. Unknown gives `404 model_not_found`. | required | model_get.json |
| POST | `/v1/chat/completions` | OpenAI Chat, streaming or not (sections 5 and 6) | required | chat_*.json/.sse |
| POST | `/v1/completions` | OpenAI legacy text completion (1.2+) | required | completions_nonstream.json |
| POST | `/v1/responses` | OpenAI Responses, streaming or not, with stored history | required | responses_stream.sse |
| GET | `/v1/responses/{resp_id}` | Fetch a stored response (`404 not_found_error` if evicted or unknown) | required | — |
| DELETE | `/v1/responses/{resp_id}` | Delete stored history: `{"id","object":"response","deleted":true}`. **Not** cancellation. | required | — |
| POST | `/v1/messages` | Anthropic Messages, streaming or not | required | messages_stream.sse |
| POST | `/v1/messages/count_tokens` | `{"input_tokens":N}` for an Anthropic-shaped body; counts image tokens too | required | (observed `{"input_tokens":13}`) |
| POST | `/tokenize` | `{"content":str,"add_special":bool}` returns `{"tokens":[int]}` | required | tokenize.json |
| POST | `/apply-template` | Chat `messages`, `tools`, reasoning options return `{"prompt":str}`, the exact rendered prompt | required | apply_template.json |
| POST | `/v1/judgments`, `/v1/systemone` | Score-only multiple-choice APIs (1.0.2+). Not needed by the UI. | required | — |
| GET | `/`, `/index.html`, `/favicon.ico` | Built-in chat page and icon (404 with `--no-webui`) | public | — |
| OPTIONS | any | `204`. CORS preflight answer when the Origin is admitted. | public | cors_preflight_allowed.headers.txt |
| any other | | `404 {"error":{"message":"not found","code":"not_found"}}` | | error_404.json |

**Cancellation:** there is no cancel endpoint. **Close the HTTP connection.** The
server polls for client disconnect every 0.1 s and cancels the native request
[observed: after aborting a stream at 1.5 s, `requests.cancelled` went from 0 to 1,
`scheduler.decoding` returned to 0, and the log printed
`Cancelled · input 27 · cached 0 · output 168 · TTFT 0.3s · 128.9 tok/s`]
[fx: chat_stream_cancelled.sse, status_after_cancel.json]. In a browser or webview,
`AbortController.abort()` on the fetch does this. A request still waiting for a lane
or still uploading is cancelled the same way.

## 3. Host, Origin, API key (Tauri webview implications)

The order of checks for every request is: **Host**, then **Origin**, then **API key**
(skipped for public routes).

### 3.1 Host check

The `Host` header's hostname must be one of: the bind address, `localhost`,
`127.0.0.1`, `::1`, or a `--allowed-host NAME`. Otherwise the response is
`403 {"error":{"message":"Host mymac.local is not allowed; restart the server with --allowed-host mymac.local to accept it","type":"invalid_request_error","code":"forbidden"}}`
[fx: host_forbidden.json]. This blocks DNS rebinding. `--allowed-host` does not
change the bind address.

### 3.2 Origin check (1.2.0, `server/http_security.py:validate_headers`)

1. No `Origin` header: allowed, and no CORS headers are added. curl, Rust `reqwest`
   and Python behave this way.
2. `--allowed-origin '*'` is set: any Origin is allowed and the response carries
   `Access-Control-Allow-Origin: *`.
3. The Origin parses as `scheme://host[:port]`. Anything else, including `null`, gives
   `403 "invalid Origin header"`. `Origin: null` (file:// pages, sandboxed frames) is
   admitted only by `'*'`.
4. Same-origin (http/https whose host:port equals the `Host` header) is allowed with
   no CORS headers [source]. For example `Origin: http://127.0.0.1:8011` with Host
   `127.0.0.1:8011` returns 200 [observed status only].
5. The Origin exactly matches an `--allowed-origin` value (scheme, host and port
   compared; the default port is filled in for http/https): allowed. **Every**
   response to it, including errors, 401s and event streams, gets:
   ```
   Access-Control-Allow-Origin: tauri://localhost
   Vary: Origin
   Access-Control-Expose-Headers: Retry-After, WWW-Authenticate
   ```
   [fx: cors_status_allowed.headers.txt, cors_stream_allowed.headers.txt]
6. Otherwise:
   `403 {"error":{"message":"Origin tauri://localhost is not allowed; restart the server with --allowed-origin tauri://localhost to accept it","type":"invalid_request_error","code":"forbidden"}}`
   [fx: origin_forbidden.json, origin_forbidden_chat.json]. The server logs once per
   origin, on stderr:
   `HH:MM:SS Refused · Origin tauri://localhost · restart with --allowed-origin tauri://localhost to accept it`.

**Preflight:** `OPTIONS` with `Origin` and `Access-Control-Request-Method` from an
admitted origin gives `204` with `Allow`, `Access-Control-Allow-Methods: GET, HEAD,
POST, DELETE, OPTIONS`, `Access-Control-Allow-Headers: <echo of the request header>`,
`Access-Control-Max-Age: 600` and the three CORS headers above
[fx: cors_preflight_allowed.headers.txt]. A preflight from a non-admitted origin gets
the same 403 JSON [fx: origin_preflight_forbidden.headers.txt]. Origins match exactly.
`--allowed-origin 'tauri://*'` is **rejected at startup** with an argparse error.
`'*'` without `--api-key` prints a startup warning.

**What this means for a Tauri 2 app on macOS.** The webview's origin is
`tauri://localhost`, and `http://localhost:1420` under `tauri dev` with Vite.
`fetch("http://127.0.0.1:8000/...")` from the webview is cross-origin:

- **Default server (no flag): every route returns 403**, `/health` included. WebKit
  hides the 403 from the page, so the page sees a generic network or CORS failure.
  The UI cannot tell "not running" from "forbidden" through webview fetch alone.
- **Option A, which Splashboard can enforce when it launches the server:** run
  `splash serve ... --allowed-origin tauri://localhost`, and add
  `--allowed-origin http://localhost:1420` in dev. The flag is repeatable. CORS then
  works for JSON and SSE [observed in the second capture session,
  fx: serve_cors_apikey.log].
- **Option B:** do the HTTP from Rust (`reqwest` / `ureq`, which send no `Origin`)
  and forward results or SSE to the webview over Tauri IPC or a channel. This works
  against any Splash server (1.0+), including ones the user started without the flag.
  It is the only option for servers older than 1.2, which have no `--allowed-origin`
  and refuse every cross-origin request with
  `403 "cross-origin requests are not allowed"`.
- **Unverified, builders must check:** whether `@tauri-apps/plugin-http`'s `fetch`
  injects an `Origin` header (behaviour has varied between plugin versions). If it
  does, it gets the same 403 as webview fetch.

### 3.3 API key

Set by `--api-key KEY` or the `SPLASH_API_KEY` env var. The launcher passes the
secret to the server through the environment, never argv. Send
`Authorization: Bearer KEY` or `x-api-key: KEY`; both may be sent, but each at most
once and both must match. A missing or wrong key gives
`401 {"error":{"message":"invalid or missing API key","type":"invalid_request_error","code":"authentication_error"}}`
plus `WWW-Authenticate: Bearer` [fx: error_401.json]. Public without a key: `/health`,
`/ready`, `/`, `/index.html`, `/favicon.ico`, and any `OPTIONS`. **`/status`,
`/metrics` and `/v1/models` require the key** [observed]. Default: no auth.

## 4. Engine lifecycle (as seen from outside)

### 4.1 Process model

`splash serve` (launcher, Python `install/launcher.py`) takes the locks, checks the
port, verifies or installs the model, then **`execve`s into the server** (`python3 -u
-P -m server.server <model_root> --tokenizer ... --model ... --binary
.../engine/splash --port N [flags]`). **The PID you spawned is the server PID**
[observed: `/status.instance.pid` = spawned pid]. The server spawns one native child,
`.../libexec/engine/splash serve-native <model_root> auto auto [...]`, and restarts it
if it crashes. `SIGINT` or `SIGTERM` to the server PID gives a clean stop
(`HH:MM:SS Stopping · releasing engine resources`). It exited within about 1 s with
code 0 and left no child [observed twice]. A second SIGINT during cleanup kills the
engine immediately. The launcher, if interrupted before exec, returns 130 (SIGINT)
or 143 (SIGTERM).

### 4.2 Startup phases, observed with `--offline` and the model cached

Times are seconds after `splash serve` was spawned (00:18:12).
`startup_probe.jsonl`'s `t` counts from the poller's start, which was 3 s earlier, so
subtract 3.

| t after spawn (s) | Socket state | `/health` `/ready` `/status` from a client | Log line |
| --- | --- | --- | --- |
| 0 to about 6 | not bound (launcher plus Python imports) | **`ECONNREFUSED`** | `Splash model incoai/Qwen3.8-27B-Splash is already installed in /Users/.../Splash/models/incoai/Qwen3.8-27B-Splash` (launcher, no timestamp) |
| about 6 to about 27 | **bound but not listening** (the server binds early to fail fast on duplicates and calls `listen()` only after the engine is Ready; `/status.instance.started_at` = bind time, 00:18:18.47) | **The TCP connect hangs: the SYN is unanswered (client stuck in `SYN_SENT`) until listen().** A 5 s client timeout expired three times. There is no HTTP response of any kind during loading. | `00:18:18 Loading · incoai/Qwen3.8-27B-Splash`, then `00:18:19 Chat template · renders later system messages in place, generation prompt 5-7 tokens`, then `00:18:22 Weights loaded in 3.59 s.`, then `00:18:22 Kernel policy for GPU family 9 with 40 cores.` |
| (warmup, about 17 s) | still not listening | hang | (no line). The engine runs warmup: 2048-row prefill and decode at batch widths 1 to 4. `status.warmup` lists what ran. |
| about 27 | listening | `200 {"status":"ok"}`, `200 {"status":"ready"}`, `200` status (`ready:true`). A queued SYN completes once `listen()` happens. First 200 at probe t = 29.9. | `00:18:39 Ready · incoai/Qwen3.8-27B-Splash · context 256K · http://127.0.0.1:8011` |

[fx: startup_probe.jsonl (every probe with its t and outcome), serve.log,
serve_cors_apikey.log, serve_idle_release.log]. The task asked for
`health_loading.json` and `ready_loading.json`; **they cannot exist**, because
Splash serves no HTTP before Ready. The probe log is the evidence. A second and third
start took 23 s and 18 s to Ready, with weights loading in 3.1 s each (warm page
cache). A cold page cache or an external disk is much slower: weights are read from
the original HF files on every start (1.2).

`/ready` returning `503 {"status":"unavailable"}` can only happen **after** the
listener is up: engine recovering, critical memory pressure, or a stale engine
status (sections 4.3 and 4.4).

**UI rule:** probe with a connect timeout of 1 s or less. While the child process you
spawned is alive and the probe is refused or timing out, show "Starting". Use log
lines (stdout) to sub-label the phase. `Ready ·` on stdout or `/ready` 200 means
ready. If the child exits before Ready, show the last `error:` or `Error ·` line.

### 4.3 States after the listener is up

| State | `/health` | `/ready` | `/status` signals | POST generation | Evidence |
| --- | --- | --- | --- | --- | --- |
| Ready, idle | 200 | 200 | `ready:true`, `scheduler.prefilling+decoding==0`, `http.requests.active==0` | normal | [observed] status_idle.json |
| Busy | 200 | 200 (keeps its last answer while the loop is busy, for up to 30 s without a status answer) | `scheduler.decoding>0` or `prefilling>0`, `transport.pending>0`, `http.requests.active>0` | normal, or queued (headers delayed, see 6.4) | [observed] status_busy.json, status_saturated.json |
| Lanes saturated | 200 | 200 | `admission.waiting_concurrency>0`, `admission.oldest_wait_ms`, `scheduler.waiting_resources>0` | stream waits with `: splash-keepalive` comments | [observed] status_saturated.json, chat_stream_queued.timeline.jsonl |
| Idle, weights released (1.2: after 600 s with no generation request) | 200 | **200** (`ready`) | `ready:true`, **no dedicated field**. `memory_actual.current_bytes` drops by the weight size (18.9 GB → 1.5 GB). | accepted. Waits before START while weights restore (`scheduler.queued:1`), about one weight-load time (3.07 s here). | [observed] section 4.5 |
| Engine recovering (crash, or loop unresponsive for 30 s) | 200 | 503 `unavailable` | `ready:false`, `transport.recovering:true`, `transport.error:<last failure>`, `transport.restarts` increments | `503 {"error":{"code":"engine_recovering","message":"engine is recovering; retry shortly (last failure: ...)"}}` plus `Retry-After: 1` | [source] backend.py `refusal()` |
| Engine failed permanently (3rd failure within 60 s of a start; restarts are immediate, then 5 s backoff) | 200 | 503 | `transport.stopped:true`, `transport.error` | `500 engine_failed` naming the crash trace, until the server is restarted | [source] |
| Critical macOS memory pressure | 200 | 503 | `memory_pressure:"critical"`, `memory_governor.system_pressure` | running requests continue; growth suspended | [source] DEVELOPMENT.md. Warning pressure keeps `/ready` 200. |
| Shutting down | 200 or refused | — | — | `503 server_shutdown` | [source] |
| Stopped | ECONNREFUSED | | | | [observed] |

If the `/status` snapshot cannot be refreshed (loop busy), the last snapshot is
returned with `transport.status_stale:true` and `transport.status_age_ms`. Show a
"stale" badge. When no snapshot exists, the body is only
`{"schema_version":6,"ready":false,"transport":{...}}`, so tolerate missing
sections. **Detect restarts:** `instance.id` (random per server process) and
`instance.started_at` change when the server restarts. `transport.restarts` increments
per engine relaunch, and the native counters (`requests.*`, `metrics.*`) then reset
to 0. HTTP-side histograms (`latency.*`) survive engine restarts.

### 4.4 Log line grammar (stdout and stderr, line-buffered, one write per line)

Server lines are `^(\d\d:\d\d:\d\d) (<Label>)( · <field>)*$`. The time is local
`HH:MM:SS`. The separator is ` · ` (U+00B7 with spaces). Errors go to **stderr**;
the rest go to stdout. The native engine writes its own lines to the shared stderr.

| Pattern | Stream | Meaning |
| --- | --- | --- |
| `Loading · <model>` | out | tokenizer and template load starting |
| `Chat template · <description>` | out | template probe result |
| `Weights loaded in <s> s.` | engine | weights in memory |
| `Kernel policy for GPU family <n> with <cores> cores.` | engine | kernels chosen; warmup follows |
| `Ready · <model> · context <N>K[ · language only] · http://<host>:<port>` | out | **listening**. Parse the context, address and vision state from it. |
| `Done · input <n> · cached <n> · output <n>[ · tools <k>·<sig>] · TTFT <s>s[ · <r> tok/s]` | out | request completed |
| `Cancelled · input ... ` (same fields) | out | client disconnected |
| `Error · <code> · <METHOD> <path>` | err | API error returned (4xx/5xx) |
| `Refused · Origin <o> · restart with --allowed-origin <o> to accept it` | err | Origin 403 (once per origin, 32 max) |
| `Warning · --allowed-origin '*' without --api-key ...` | err | startup warning |
| `Weights released after 600 s without a request; the next request restores them` | engine | idle release (1.2) |
| `Weights restored in <s> s` | engine | restore done (1.2) |
| `Engine restarted` | out | recovery succeeded |
| `Memory: growth paused; waiting=<n>; suspended=<n>[; held=<n>][; waiting for resident requests to finish]` and `Memory: growth available; resource wait cleared` | engine | memory-pressure transitions |
| `Template error · <Exc> · <file>:<line>` | err | template render failure (request gets 400) |
| `Stopping · releasing engine resources` | out | clean shutdown started |
| `Error · <message>` then exit 1 | err | fatal startup error (engine unhealthy, thinking key, template, `unable to start HTTP server: ...`) |
| `error: <message>` (no timestamp) then exit 1 | err | launcher error, e.g. `error: Splash is already serving (PID 75278, model incoai/Qwen3.8-27B-Splash, port 8011); stop it with Ctrl+C first` [fx: serve_port_in_use.log], `error: cannot bind 127.0.0.1:8011: ...`, `error: model download or verification failed`, `error: Splash installation is busy; ...` |

Installer and launcher lines have **no timestamp** (stdout, before exec):
`Splash model <id> is already installed in <path>`,
`Installed verified Splash model <id> in <link>` (legacy packages),
`Selected <file> from <repo>.`,
`Installing <id> as <family> (<format>); draft <repo>; vision enabled|disabled.`,
`Fetching <n> file(s), <X.XX> GB, from <repo>@<rev12>; cached files are reused.`,
`Updating <id>: ...`, `Reinstalling <id>: ...`,
`Could not reach the Hub (<reason>); using the installed <repo>@<rev12>.`,
`Another Splash model installation is running; waiting...`,
`Using a verified cached model while offline.`, `Warning: ...` (stderr).
**Download progress** comes from huggingface_hub `snapshot_download` (tqdm bars on
stderr, `\r`-updated). It was **not captured** because everything was cached. Do not
parse tqdm. Instead, after `Fetching N file(s), X GB`, compute progress by summing
file sizes under `~/.cache/huggingface/hub/models--<owner>--<repo>/blobs/` (partial
files end in `.incomplete`; `HF_HUB_CACHE` or `HF_HOME` relocate this) against the
announced total.

### 4.5 Idle weight release and restore (1.2)

[observed; third session, fx: serve_idle_release.log, idle_release_trace.jsonl,
health_idle_released.json, ready_idle_released.json, status_idle_released.json,
metrics_idle_released.txt, status_restore_start.json,
chat_stream_after_idle.timeline.jsonl, status_after_restore.json]

- **Trigger:** 600 s (`metal::kResidencyKeepAliveSeconds`, not configurable) with no
  generation request and the engine idle. `/status`, `/ready` and `/health` polls
  every 5 s **did not** prevent it. Release came between 596 s and 601 s after the
  last request.
- **Log (engine, stderr, no timestamp prefix):**
  `Weights released after 600 s without a request; the next request restores them`.
- **HTTP while released:** `/health` returns `200 {"status":"ok"}`. **`/ready` returns
  `200 {"status":"ready"}`**. `/status.ready` is `true`, and `transport.*` is
  unchanged. **No status field names the released state.** The only external signals:
  - `memory_actual.current_bytes` fell from 18,878,824,448 to **1,522,892,800**
    (`allocated_bytes` likewise).
  - `memory_governor.charged_bytes` fell from 19.68 GB to 2.33 GB, and
    `headroom_bytes` rose by the same amount.
  - The weight sizes are `memory_plan.model.memory.{target,draft,vision}_weights_bytes`.
    The drop is about 17.4 GB here.
  - The log line.
  - Heuristic: "no generation for 600 s or more" (track the last request time
    client-side, or watch `requests.submitted` stop changing).
- **Next request:** it is accepted normally but waits **before START**.
  - `/status` showed `scheduler.queued:1` and `transport.pending:1`, while
    `current_bytes` climbed about 1.7 GB per 0.3 s from 1.5 GB back to 18.9 GB.
  - `/ready` stayed 200 throughout. No 503 was observed, so `ready_restoring.json`
    does not exist.
  - The SSE stream sent headers plus `: splash-keepalive` at 2.08 s and the start
    chunk at 3.07 s. Then prefill started (`scheduler.prefilling:1`), then the
    progress chunks, then the tokens.
  - The engine logged `Weights restored in 3.07 s`. The request's
    `metrics.request_latency.queue_to_start_ms` was **3070.6** and `ttft_ms` was
    3401.8 (log `Done · ... TTFT 3.4s`).
  - Restore time is about one startup weight load: 3 s here with the files in the
    page cache, much longer from a cold or external disk. It is **not** the full
    cold-start time, because warmup is not repeated.
- `status_restore_start.json` was taken 4 ms after sending, before the request was
  queued, so it still shows the released state. The mid-restore values are in
  `idle_release_trace.jsonl` (`event:"restore_poll"`).
- **UI:** keep a "weights resident / released" indicator, driven by
  `memory_actual.current_bytes` falling well below
  `target_weights_bytes + draft_weights_bytes` (or by the log line). When a request is
  sent in the released state, show "Waking model (reloading weights)..." until the
  start chunk arrives. Use `queue_to_start_ms` afterwards to report how long the
  wake took. A delayed-headers stream plus `scheduler.queued>0` with no other load is
  the restore signature.

## 5. `POST /v1/chat/completions` request

Unknown top-level fields are ignored, except those listed as rejected below.
`null` for a sampling field, `n`, `max_tokens`, `max_completion_tokens`, `stream` or
`parallel_tool_calls` means "use the default".

### 5.1 Fields

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `model` | string | loaded model | must be a listed name, else 404 `model_not_found` |
| `messages` | non-empty array | — | roles `system`, `developer` (merged into the leading system message), `user`, `assistant`, `tool`. **Must contain a user message** (400 `messages must include a user message`). A later `system` message renders in place (`/status.chat_template.later_system:"native"` for this model). |
| `stream` | bool | false | |
| `stream_options.include_usage` | bool | false | adds the usage chunk (6.2). Any other non-bool value gives 400 `invalid streaming options`. |
| `max_tokens` / `max_completion_tokens` | int > 0 | **remaining context** (1.2) | prompt plus value greater than the context gives 400 `context_length_exceeded` naming both numbers [fx: error_context_length.json]. **The UI should always send a limit.** Before 1.2 the implicit cap was 32,768. |
| `temperature` | number in [0, 2] | **1.0** | 0 is greedy. A non-zero value below 0.01 is raised to 0.01. 5 gives 400 `temperature must be a number in [0, 2]` [fx: error_400.json] |
| `top_p` | (0, 1] | **0.95** | |
| `top_k` | int ≥ -1 | **20** | 0 or -1 disables it. Other values give 400 [observed]. |
| `min_p` | [0, 1] | 0 | 1.2+ (400 before 1.2 if non-zero) |
| `presence_penalty`, `frequency_penalty` | [-2, 2] | 0 | 1.2+ (400 before 1.2 if non-zero). Qwen recommends `presence_penalty: 1.5` for non-thinking use; send it explicitly. |
| `repetition_penalty` | > 0 | 1.0 | 1.2+ |
| `seed` | uint64 | random | not reproducible across versions or concurrent schedules |
| `stop` | string or 1 to 4 non-empty strings | none | cannot be combined with tools or `response_format` (400) |
| `ignore_eos` | bool | false | 1.2+. Not with tools or schema. |
| `reasoning_effort` | `none`\|`minimal`\|`low`\|`medium`\|`high`\|`xhigh`\|`max` | server `--default-reasoning-effort`, else the **template default** | `none` turns thinking off. Anything else gives 400 `invalid reasoning_effort` [fx: error_reasoning_effort.json]. See 5.2. |
| `chat_template_kwargs` | object | {} | 1.2+. Passed to the Jinja template and **outranks `reasoning_effort`**. It may not set `add_generation_prompt`, `chat_template`, `continue_final_message`, `conversation`, `documents`, `messages`, `return_dict`, `tokenize`, `tools` (400 `chat_template_kwargs cannot set tools` [observed]). |
| `preserve_thinking` | bool | template | keep earlier turns' reasoning in the rendered history |
| `tools` | array of `{"type":"function","function":{name,description?,parameters,strict?}}` | — | name `[A-Za-z0-9_-]{1,128}`. Only function tools. No remote `$ref`. |
| `tool_choice` | `"auto"`\|`"none"`\|`"required"`\|`{"type":"function","function":{"name":...}}` | auto | `required` and named choices are enforced by grammar |
| `parallel_tool_calls` | bool | true | |
| `response_format` | `{"type":"text"}`\|`{"type":"json_object"}`\|`{"type":"json_schema","json_schema":{"name"?,"schema":{...},"strict"?}}` | text | grammar-constrained and validated. It does not add instructions to the prompt. [fx: chat_nonstream_json_schema.json] |
| `return_progress` | bool | false | **stream only** (400 otherwise). Emits `prompt_progress` chunks during prefill (6.3). |
| `priority` | `foreground`\|`normal`\|`background` | normal | lane preemption priority |
| `timeout` | number of seconds > 0 | none (or `--request-timeout`) | can only shorten the server timeout. On expiry: 504 `request_timeout`. |
| `logprobs` | must be false or null | | `true` gives 400 `n and logprobs are not currently supported` |
| `n` | must be 1 | | 400 otherwise |
| `logit_bias` | null or {} only | | non-empty gives 400 `logit_bias is not supported` |

**User content parts** (`messages[].content` as an array): `{"type":"text"|"input_text","text":...}`,
`{"type":"image_url","image_url":{"url":"data:image/<fmt>;base64,..."}}` (also
`image_url` as a bare string), and `{"type":"file","file":{...base64 PDF...}}` (up to
64 pages and 64 MiB of source). **Images must be base64 `data:` URLs**: an https URL
gives 400 `only data: image URLs are supported` [observed]. Limits: at most 32 MiB
decoded per image, at most 64 images per request, resized to at most 4,194,304 px
(`--max-image-pixels`), aspect ratio under 200. `video`, `video_url` and
`input_audio` give 400 [observed]. Images and PDFs need `vision:true`
(`--language-only` disables it and they get 400). Assistant messages accept
`content` (text), `reasoning_content`, and `tool_calls`. Tool messages accept
`tool_call_id` and text or image content. [fx: req_chat_image.json,
chat_nonstream_image.json: a 64×64 PNG cost 87 prompt tokens in total]

### 5.2 Reasoning (thinking) control

- Thinking is **on by default** for Qwen3.8/3.6. The template default for Qwen3.8-27B
  is `reasoning_effort = "xhigh"`.
- Splash passes `enable_thinking = (effort != "none")` and `reasoning_effort` to the
  template. This template accepts only `xhigh`, `medium` and `low`. Splash retries a
  rejected effort with an alias: **`high`→`xhigh`, `max`→`xhigh`, `minimal`→`low`**.
  The UI should therefore offer Off (`none`), Low, Medium and High (sent as `xhigh`,
  or `high`).
- Thinking adds a system prompt (about 40 tokens for "Hi"/"Say hi."). Compare 53 vs 15
  prompt tokens [fx: apply_template.json shows the low-effort text
  `Reasoning effort is set to low. Keep your thinking brief ...`, and the generation
  prompt ends with `<think>\n`].
- `chat_template_kwargs.enable_thinking` wins over `reasoning_effort`:
  `reasoning_effort:"none"` plus `chat_template_kwargs:{"enable_thinking":true}`
  produced thinking [observed]. `{"enable_thinking":false}` alone turns it off
  [fx: chat_nonstream_enable_thinking_false.json]. If the requested
  `enable_thinking` disagrees with what the template's generation prompt does, the
  response is 400 `chat template does not support the requested thinking mode`.
- Server-wide default: `--default-reasoning-effort` or
  `SPLASH_DEFAULT_REASONING_EFFORT` (1.0.2+). An explicit request value wins.
- Anthropic `/v1/messages`: thinking is **off** unless
  `thinking:{"type":"enabled"|"adaptive"}`. Effort comes from
  `output_config.effort` (default `high`). `budget_tokens` is ignored.

## 6. Chat completion responses

### 6.1 Non-streaming [fx: chat_nonstream.json]

```json
{
  "id": "chatcmpl-b14513fc4bb684f3afcfc6fff5bd74bc",
  "object": "chat.completion",
  "created": 1791098377,
  "model": "incoai/Qwen3.8-27B-Splash",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Red, yellow, and blue.",
      "reasoning_content": "User asks: ... Keep concise.\n"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 62, "completion_tokens": 102, "total_tokens": 164,
    "prompt_tokens_details": {"cached_tokens": 32},
    "completion_tokens_details": {"reasoning_tokens": 92}
  },
  "metrics": {
    "prefill": {"tokens": 30},
    "decode": {"tokens": 94},
    "request_latency": {
      "start_to_first_token_ms": 326.34, "first_token_to_done_ms": 1485.481,
      "wall_ms": 1819.344, "ttft_ms": 333.863, "queue_to_start_ms": 7.523,
      "stream_tokens_per_second": 63.279
    },
    "cache": {"status": "hit", "matched_tokens": 32, "lane": 0}
  },
  "timings": {
    "prompt_n": 62, "prompt_ms": 326.34, "prompt_per_second": 91.93,
    "predicted_n": 102, "predicted_ms": 1485.481, "predicted_per_second": 63.279,
    "cache_n": 32
  }
}
```

- `message.content` is `null` when empty (for example tool-call-only replies).
  `reasoning_content` is present only when non-empty. `tool_calls` is present only
  when calls were made.
- `finish_reason`: `stop` | `length` | `tool_calls` (only when not cut by length).
- `usage.prompt_tokens_details.cached_tokens` is the prefix-cache hit
  (32-token granularity: KV block = 32 tokens). `reasoning_tokens` counts tokens
  inside `<think>`.
- `metrics` (Splash-specific):
  - `prefill.tokens` is the uncached prompt tokens actually computed.
  - `decode.tokens` = `completion_tokens` minus the tokens of the first emission.
    The first native emission may already hold a speculative block.
  - `request_latency.*` are ms intervals measured by the engine:
    - `start_to_first_token_ms`: native start to first emission (prefill time).
    - `first_token_to_done_ms`
    - `wall_ms`: engine receipt to done.
    - `ttft_ms`: wall minus first_token_to_done.
    - `queue_to_start_ms`
    - `stream_tokens_per_second` = `decode.tokens` / `first_token_to_done_ms`.
  - `cache.status` is `"hit"` or `"miss"`. `lane` is an int, or null.
- `timings` is llama-server compatible (1.1+):
  - `prompt_ms` is native start to first emission.
  - `prompt_per_second` uses **uncached** tokens only.
  - `predicted_per_second` excludes the first emission. It is **0 when the whole
    output came in one emission**.
  - These intervals exclude the admission queue.
- Per-request **draft/speculative counters are not reported**. Draft acceptance
  exists only at batch level in `/status` (section 9).

### 6.2 Streaming SSE grammar

Headers: `200`, `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: close` (plus CORS headers if the Origin was admitted). Each event is one
`data: <json>\n\n` frame or one comment `: splash-keepalive\n\n`. There are no
`event:` names on the Chat stream. Every JSON chunk carries the same `id`, `object`
(`chat.completion.chunk`), `created` and `model`.

Order of frames [fx: chat_stream_thinking.sse (116 lines: 1 role chunk, 27 reasoning,
27 content, finish, usage, DONE), chat_stream_no_thinking.sse]:

1. *(only if the request waits for a lane or admission before START)*:
   `: splash-keepalive` comment every **2 s**. **Response headers are not sent until
   the first keepalive or START.** In the queued capture, status 200 arrived at
   2.06 s and the first token at 38 s [fx: chat_stream_queued.timeline.jsonl].
2. **Start chunk**, sent at native START (admission, *before* prefill). It is not a
   token:
   `{"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`
3. *(with `return_progress:true`)* **progress chunks** during prefill:
   `{"choices":[{"index":0,"delta":{},"finish_reason":null}],"prompt_progress":{"total":13116,"cache":0,"processed":2048,"time_ms":9399.76}}`.
   - `total` is the prompt tokens.
   - `cache` is the cached tokens at the start.
   - `processed` is the completed tokens, cache included. It is monotonic.
   - `time_ms` is ms since prefill admission.
   - The first one comes at once with `processed:0`. Then one comes per completed
     2048-token prefill chunk, and a final one at `processed == total`.
   [fx: chat_stream_long_prompt.timeline.jsonl]
4. **Idle keepalive chunk** after START when nothing was written for 2 s (long
   prefill, buffered tool arguments): an empty-delta chunk
   `{"choices":[{"index":0,"delta":{},"finish_reason":null}]}`. It is **not** a token
   and **not** a stall. Observed every about 2.07 s during a 71 s prefill.
5. **Reasoning deltas** (thinking on):
   `{"choices":[{"index":0,"delta":{"reasoning_content":" need"},"finish_reason":null}]}`.
   About one token per chunk. The last reasoning delta ends with `"\n"`.
6. **Answer deltas**: `{"delta":{"content":"The"}}`. A chunk never carries both
   `reasoning_content` and `content`. The newlines right after `</think>` are
   stripped by the server. With `reasoning_effort:"none"` there are no reasoning
   chunks at all.
7. **Tool call deltas** (when tools are present) [fx: chat_stream_tools.sse]:
   - First the header delta:
     `{"delta":{"tool_calls":[{"index":0,"id":"call_<hex>_0","type":"function","function":{"name":"get_weather"}}]}}`
   - Then argument fragments:
     `{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}`,
     then `"\"city\":\""`, `"Paris"`, `"\""`, `"}"`.
   - Reasoning (when on) streams before the call. The finish is `"tool_calls"`.
8. **Finish chunk** (always, even without include_usage):
   `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"timings":{"prompt_n":62,"prompt_ms":607.576,"prompt_per_second":102.04,"predicted_n":57,"predicted_ms":651.889,"predicted_per_second":75.17,"cache_n":0}}`
9. **Usage chunk** (only with `stream_options.include_usage:true`):
   `{"choices":[],"usage":{"prompt_tokens":62,"completion_tokens":57,"total_tokens":119,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":27}},"metrics":{"prefill":{"tokens":62},"decode":{"tokens":49},"request_latency":{"start_to_first_token_ms":607.576,"first_token_to_done_ms":651.889,"wall_ms":1259.526,"ttft_ms":607.637,"queue_to_start_ms":0.061,"stream_tokens_per_second":75.17},"cache":{"status":"miss","matched_tokens":0,"lane":0}}}`
10. `data: [DONE]`. Then the server closes the connection.

**Mid-stream error frame** [source only; not reproduced]. After headers are sent, an
error becomes:
`data: {"error":{"message":"...","type":"invalid_request_error"|"server_error","code":"..."}}`
then `data: [DONE]`. Before headers, the client gets a normal HTTP error status with
the JSON body. Possible codes include `mask_timeout` (503, retryable; a grammar mask
was not answered within 5 s), `resource_timeout`, `capacity_exhausted` (400; the
request cannot fit even alone), `invalid_model_output` (500), `request_timeout`
(504), and `internal_server_error`.

**Speculative bursts:** tokens arrive in bursts of 1 to 8 (one per DFlash verify
cycle), each token still in its own SSE frame. In a 400-token run: 400 content
frames in 160 bursts, a mean of 2.5 tokens per burst, a maximum of 7, and a median
of 60 ms between bursts [fx: chat_stream_long.timeline.jsonl]. The UI should render
per frame and smooth if desired. `itl_ms` in `/status` is per native event, not per
token.

### 6.3 Per-turn statistics for the UI

- **Final numbers** (exact): from the finish chunk's `timings` and the usage chunk.
  - TTFT = `metrics.request_latency.ttft_ms`. Or measure client-side from request
    send to the first `reasoning_content`/`content` delta; that includes HTTP and
    queueing.
  - Decode tok/s = `timings.predicted_per_second`. If it is 0, fall back to
    `completion_tokens / (first_token_to_done_ms/1000)` or show "—".
  - Prefill tok/s = `timings.prompt_per_second` (uncached tokens).
  - Cache hit = `usage.prompt_tokens_details.cached_tokens / prompt_tokens`.
  - Reasoning share = `completion_tokens_details.reasoning_tokens / completion_tokens`.
- **Live while streaming** (approximate): count delta frames (one frame is about one
  token) over wall time since the first token delta. Ignore the start, progress and
  empty keepalive chunks. Label it approximate; it is replaced by the final numbers.
- Prefill progress bar: `prompt_progress.processed / total`. Updates every 2048
  tokens. `time_ms` is elapsed time, not an ETA.

### 6.4 Queueing, capacity and errors before the stream starts

- About 4 requests generate concurrently (`memory_plan.budget.maximum_batch_width`
  = 4, `frontend.preparation_capacity` = 4). More wait for a lane: headers are delayed
  and keepalive comments sent. In the 5-request capture the fifth waited 38 s
  [observed].
- `--queue-size` (default 32) caps requests admitted (running plus waiting). Beyond
  it: `503 frontend_overloaded "frontend request capacity is exhausted"` plus
  `Retry-After: 1`. Connection slots number 96 (32 + 64 control). Excess
  connections get a raw 503 `frontend_overloaded`.

## 7. Other generation endpoints (summaries)

- **`/v1/completions`** (1.2+): `prompt` is a string or an int array. `max_tokens`
  defaults to **16**. Chat sampling fields, `seed`, `stop`, `priority`, `timeout`,
  `stream` and `stream_options` work as in Chat. No template, reasoning, tools or
  images. Response `object:"text_completion"`, `choices[0].text`, `logprobs:null`,
  plus `usage`, `metrics` and `timings` [fx: completions_nonstream.json]. Stream
  chunks are `object:"text_completion"` with `choices[0].text`. `suffix`, `echo`,
  `logprobs`, `best_of≠1` and `n≠1` give 400.
- **`/v1/responses`**: `input` is a string or an item array (message, reasoning,
  function_call, function_call_output). Also `instructions`, `reasoning.effort`,
  `max_output_tokens`, `text.format`, `tools` (function and namespace),
  `tool_choice`, `store` (default true), `previous_response_id` (404
  `previous_response_not_found` once evicted; the store is 64 MiB LRU and
  process-local). `background`, `conversation`, `truncation≠disabled` and
  `context_management` give 400. SSE uses named events, each with an increasing
  `sequence_number`:
  `response.created`, `response.in_progress`, `response.output_item.added`,
  `response.reasoning_summary_part.added`, `response.reasoning_summary_text.delta`,
  `response.reasoning_summary_text.done`, `response.reasoning_summary_part.done`,
  `response.content_part.added`, `response.output_text.delta`,
  `response.output_text.done`, `response.content_part.done`,
  `response.function_call_arguments.delta|done`, `response.output_item.done`, then
  the terminal `response.completed` | `response.incomplete` | `response.failed`.
  Keepalive is a repeated `response.in_progress` before output, then
  `: splash-keepalive`. Progress is `response.in_progress` with `prompt_progress`.
  Usage is in the terminal event: `input_tokens`,
  `input_tokens_details.{cached_tokens,cache_write_tokens}`, `output_tokens`,
  `output_tokens_details.reasoning_tokens`. [fx: responses_stream.sse: ran out of
  output tokens inside reasoning, giving `response.incomplete`]
- **`/v1/messages`** (Anthropic): `max_tokens` is required. A final assistant
  message (prefill) gives 400. SSE events: `message_start`, `content_block_start`
  (`thinking` | `text` | `tool_use`), `content_block_delta` (`thinking_delta` |
  `text_delta` | `input_json_delta` | `signature_delta`), `content_block_stop`,
  `message_delta` (`stop_reason`: `end_turn` | `max_tokens` | `stop_sequence` |
  `tool_use` | `model_context_window_exceeded`, plus `usage.output_tokens`),
  `message_stop`. `ping` is the keepalive; `ping` with `prompt_progress` is
  progress. `error` events carry the Anthropic error type. Usage is `input_tokens`
  (uncached), `cache_read_input_tokens` and `output_tokens`. There are no
  timings or metrics. [fx: messages_stream.sse]

## 8. `GET /v1/models` [fx: models.json]

```json
{"object":"list",
 "data":[{"id":"incoai/Qwen3.8-27B-Splash","object":"model","created":0,"owned_by":"splash",
          "max_model_len":262144,"context_length":262144,"vision":true,
          "input_modalities":["text","image","pdf"]}],
 "models":[{"name":"incoai/Qwen3.8-27B-Splash","description":"Splash resident model","release_date":""}]}
```

- `data[0]` is the name responses report. Aliases (`--served-model-name`) appear as
  extra entries with `"root": <loaded id>`.
- `owned_by == "splash"` is the launcher's way of identifying a Splash server
  (with `context_length` an int > 0).
- `max_model_len`, `context_length`, `vision` and `input_modalities` are 1.1+. On
  older servers fall back to `/status.maximum_context_tokens` (all versions).
- Header `x-typesafe-request-id: req_<hex>` is present on `/v1/models*`.

## 9. `GET /status` (schema_version 6)

Kinds: **C** = cumulative counter since engine start (resets on engine restart);
**G** = gauge (current value); **L** = lifetime ratio or percentile (not live; derive
live values from C deltas); **S** = static for the process. Units are in the field
names: `_bytes`, `_ms`, `_tokens`. Native sections come from the engine. `transport`,
`frontend`, `*_cache`, `response_store`, `latency`, `instance` and `http` come from
the Python server. [fx: status_idle.json, status_busy.json, status_busy_2.json,
status_saturated.json, status_after_cancel.json, status_after.json]

| Path | Kind | Meaning |
| --- | --- | --- |
| `schema_version` | S | 6 in 1.2.0. 5 in 1.0 to 1.1. |
| `ready` | G | engine ready, folding in memory pressure, Metal health and transport (what `/ready` returns) |
| `maximum_context_tokens` | S | effective context limit (262144 here) |
| `memory_pressure` | G | `normal` \| `warning` \| `critical` |
| `admission.waiting` / `waiting_memory` / `waiting_concurrency` / `held_behind_refusal` / `restoring` / `suspended` | G | requests waiting, by reason (`restoring` = waiting for a disk restore) |
| `admission.draining` | G | recovery draining resident requests |
| `admission.oldest_wait_ms` | G | age of the oldest current wait |
| `loop.max_tick_ms` | L | longest native loop pass |
| `identity.cache.*`, `identity.kv.*` | S | model layout hash, build id, KV dtype and layout |
| `memory_plan.device.*` | S | `device_name`, `macos_version`, `apple_gpu_family`, `gpu_core_count`, `physical_memory_bytes`, `recommended_max_working_set_bytes`, ... |
| `memory_plan.model.*` | S | `model_name` ("Qwen3.8-27B"), `attention_layers`, `kv_heads`, `head_dimension`, `kv_page_tokens`, `kv_format`, `kv_page_bytes`, `memory.{target,draft,vision}_weights_bytes`, ... |
| `memory_plan.budget.*` | S | `hard_budget_bytes`, `fixed_runtime_bytes`, `dynamic_budget_bytes`, `maximum_batch_width` (4), `kv_capacity_pages` (32768), `kv_capacity_tokens` (1,048,576), `kv_page_bytes`, `kv_extent_pages`, `kv_extent_bytes`, `minimum_required_bytes`, `deficit_bytes`, `configured_memory_limit_bytes` (0 = auto) |
| `memory_actual.allocated_bytes` / `current_bytes` | G | Metal allocations (not RSS). About 18.9 GB idle with weights resident here. |
| `memory_actual.peak_bytes` | L | |
| `memory_governor.limit_bytes` | S | budget ceiling |
| `memory_governor.charged_bytes`, `headroom_bytes`, `growth_allowed`, `system_pressure`, `host_available_bytes`, `host_headroom_bytes`, `host_reserve_bytes`, `host_measurement_valid` | G | |
| `memory_governor.denied_reservations` | C | |
| `memory_audit.*` | S (startup) | allocation audit at warmup |
| `kv.block_tokens` | S | 32 |
| `kv.pages_allocated`, `pages_active` (held by running requests), `pages_cache` (held by the prefix cache), `pages_free` (free pages of allocated extents, **not** remaining capacity), `allocated_bytes`, `reclaimable_bytes` | G | |
| `kv.extent_allocations`, `extent_releases`, `extent_compactions`, `pages_moved` | C | |
| `kv.*_max_ms` | L | |
| `state.entries`, `pinned`, `in_use`, `bytes`, `allocated_bytes`, `active_lanes`, `idle_gdn_cells`, `idle_draft_rings`, `checkpoint_entries`, `checkpoint_bytes`, `disk_bytes` | G | recurrent (GDN) state cache |
| other `state.*` counters (`publications`, `evictions`, `in_use_evictions`, `disk_hits`, `offloads`, ...) | C | |
| `disk.capacity_bytes` | S | `--max-cache-disk` (0 = off) |
| `disk.persistent` | S | |
| `disk.used_bytes`, `file_bytes`, `kv_blocks`, `kv_bytes`, `kv_pending_pages`, `write_behind.waiting` | G | |
| `disk.read_bytes`, `written_bytes`, `kv_demotions`, `kv_restores`, `*_failures`, `taken_back.*`, `write_behind.{durable,unneeded,refused}` | C | |
| `cache.hits`, `cold_misses`, `kv_hit_tokens`, `kv_disk_hit_tokens`, `reused_tokens`, `lost_state_misses`, `*_publications`, `resource_suspensions`, `priority_suspensions`, `resource_resumptions`, `resource_replay_tokens`, `lazy_junctions`, ... | C | prefix-cache activity |
| `cache.hit_rate` | L | |
| `draft_context.*` | C | draft-model context bookkeeping |
| `model_timing.prefill.{last_gpu_ms,last_wall_ms}`, `model_timing.decode.{last_gpu_ms,last_wall_ms}` | G (last command) | |
| `model_timing.*.total_gpu_ms`, `total_wall_ms` | C | **includes warmup** |
| `constraint_masks.overlap_batches`, `overlap_requests`, `total_*_ms` | C | grammar-mask overlap |
| `constraint_masks.last_*_ms` | G | |
| `images.encodes`, `embedding_reuses` | C | |
| `images.arena_bytes`, `cached_bytes`, `state_held_bytes`, `rows_bytes` | G | |
| `scheduler.queued`, `waiting_resources`, `waiting_prefix`, `prefilling`, `decoding`, `waiting_mask`, `terminal` | G | **busy signal: `prefilling + decoding > 0`** |
| `scheduler.prefill_batches`, `prefill_rows`, `decode_batches`, `decode_batches_by_width.{b1..b4}` | C | |
| `requests.submitted`, `completed`, `cancelled`, `failed` | C | native requests since engine start |
| `metrics.ttft_ms.{p50,p95,samples}`, `metrics.itl_ms.{p50,p95,samples}` | L | percentiles over the last 4096 samples. ITL is per native event divided by the tokens in it. |
| `metrics.prefill_input_tokens`, `prefill_wall_ms`, `decode_output_tokens`, `decode_wall_ms`, `decode_cycle_ms`, `drafted_tokens`, `accepted_draft_tokens`, `capacity_failures`, `metal_failures` | C | batch-level totals. `decode_wall_ms` is the GPU command time from submission to completion. `decode_cycle_ms` (1.2+) adds host work between commands. These **exclude warmup** (all 0 at idle start). |
| `metrics.prefill_tokens_per_second`, `decode_tokens_per_second`, `draft_acceptance_rate` | L | lifetime ratios of the counters above. **Not live.** |
| `metrics.current_prefill_batch`, `metrics.current_decode_batch` = `{valid,width,input_tokens,output_tokens,drafted_tokens,accepted_draft_tokens,wall_ms,tokens_per_second}` | G (**last completed batch**) | stays `valid:true` after the work ends. **Do not use it as a busy signal.** |
| `warmup.*` | S | `prefill_2048`, `decode_b1..b4`, `composite_state_restore` (bools), `memory_limited_steps`, `detail` |
| `metal.healthy`, `metal.failure_reason` | G | |
| `transport.ready`, `recovering`, `stopped`, `pending`, `status_stale`, `status_age_ms`, `last_crash_trace`, `error`? | G | Python-side engine supervision |
| `transport.pending_limit` | S | = `--queue-size` |
| `transport.restarts` | C (process lifetime) | |
| `vision`, `input_modalities` | S | |
| `chat_template.later_system` | S | `native` \| `patched` \| `unsupported` |
| `frontend.preparation_capacity` | S | |
| `frontend.active`, `waiting` | G | request-preparation slots |
| `grammar_cache.*`, `response_store.*`, `image_cache.*`, `tokenizer_cache.*` | G and C | `entries`, `bytes` and `budget_bytes` are gauges; `hits`, `misses` and `evictions` are counters |
| `latency.<stage>.{buckets{"0.001".."1800","+Inf"},count,sum}` | C (HTTP-process lifetime) | cumulative histograms in **seconds**. Stages: `http_request`, `upload`, `preparation_queue`, `preparation`, `template`, `tokenization`, `grammar`, `images`, `native_queue`, `http_ttft` (1.2; `ttft` before), `output_interval`. |
| `instance.id` | S | random per server process |
| `instance.pid`, `model` (always the loaded id), `host`, `port` | S | |
| `instance.started_at` | S | unix seconds, float |
| `http.requests.{active,capacity}`, `http.request_body_bytes.{active,capacity}`, `http.token_counts.{active,capacity}`, `http.connections.{active,capacity}` | G | `connections.active` counts your own poll (it was 1 at idle) |
| `http.max_request_bytes` | S | |

### 9.1 Deriving live values from two polls A and B (Δ = B − A, dt = wall seconds between polls)

Worked example: `status_busy.json` taken 2.013 s into a single 400-token generation,
and `status_busy_2.json` taken 1.006 s later.

| Metric | Formula | Example |
| --- | --- | --- |
| Live aggregate decode tok/s (wall-clock, all lanes) | Δ`metrics.decode_output_tokens` / dt | 42 / 1.006 = **41.7 tok/s** (the stream's own `predicted_per_second` was 41.72) |
| GPU-busy decode tok/s | Δ`decode_output_tokens` / Δ`decode_wall_ms` × 1000 | 42 / 993.5 ms = 42.3 |
| Including host overhead | Δ`decode_output_tokens` / Δ`decode_cycle_ms` × 1000 | |
| Live prefill tok/s | Δ`prefill_input_tokens` / dt (wall) or / Δ`prefill_wall_ms` (GPU) | 0 in this window: no prefill |
| Draft acceptance (live) | Δ`accepted_draft_tokens` / Δ`drafted_tokens` | 25 / 119 = **0.21** (the lifetime `draft_acceptance_rate` read 0.32 to 0.34) |
| Tokens per decode cycle | Δ`decode_output_tokens` / Δ`decode_batches` | 42 / 17 = 2.47. Each cycle drafts 7 per lane; a lane emits accepted + 1. |
| Mean batch width | Σ width×Δb_width / Δ`decode_batches` | 1 here; 4 in status_saturated.json |
| KV utilisation of capacity | (`kv.pages_active` + `kv.pages_cache`) / `memory_plan.budget.kv_capacity_pages` | (5+12)/32768 = 0.05%. Active-only for "in use": 5/32768. |
| KV resident vs allocated | `kv.allocated_bytes`, (`pages_allocated` − `pages_free`)/`pages_allocated` | 13/128 |
| Context used by a turn | `usage.prompt_tokens + completion_tokens` vs `maximum_context_tokens` | |
| Metal memory use | `memory_actual.current_bytes` / `memory_governor.limit_bytes` | 19.07 GB / 54.55 GB = 35% |
| Memory headroom | `memory_governor.headroom_bytes` (budget), `host_headroom_bytes` (macOS) | 34.9 GB |
| Request rate | Δ`requests.completed` / dt | |
| Busy indicator | `scheduler.prefilling + scheduler.decoding > 0` or `http.requests.active > 0` | |
| Queue depth | `admission.waiting`, `scheduler.queued + waiting_resources + waiting_prefix` | 1 waiting in status_saturated.json (`oldest_wait_ms` 1240) |

Guards: if `instance.id` or `transport.restarts` changed between polls, or any C value
decreased, drop the sample. Ignore polls with `transport.status_stale:true`. Clamp
negative or NaN values to "—". **Poll at 2 Hz or slower.** Each `/status` is a native
round trip (`/metrics` is the same data in Prometheus text). `/ready` is cheaper but
still asks the engine.

## 10. `GET /metrics` [fx: metrics.txt]

Prometheus text (`text/plain; version=0.0.4; charset=utf-8`). It contains
`splash_info{runtime="native"} 1`,
`splash_memory_pressure{state="normal|warning|critical"}` (0/1), and gauges and
counters mapped one-to-one from `/status`:

- `splash_ready`, `splash_metal_healthy`, `splash_transport_pending`
- `splash_requests_{submitted,completed,cancelled,failed}_total`
- `splash_scheduler_*`
- `splash_kv_*`
- `splash_state_*`
- `splash_cache_*`
- `splash_memory_{current,peak,limit,headroom}_bytes`
- `splash_admission_*`
- `splash_ttft_p50_milliseconds` (and p95)
- `splash_itl_p50_milliseconds` (and p95)
- `splash_{prefill,decode}_tokens_per_second`
- `splash_decode_output_tokens_total`
- `splash_decode_wall_milliseconds_total`
- `splash_decode_cycle_milliseconds_total`
- `splash_drafted_tokens_total`, `splash_accepted_draft_tokens_total`
- `splash_draft_acceptance_ratio`
- `splash_response_store_*`

It also contains histograms `splash_<stage>_seconds_bucket{le=...}`, `_count` and
`_sum` for every `latency` stage. 1.2 renamed `splash_ttft_seconds` to
`splash_http_ttft_seconds`. A metric whose `/status` field is missing is omitted.
The UI can ignore `/metrics` and use `/status`.

## 11. Error catalogue (status → `error.code`)

| HTTP | code | When |
| --- | --- | --- |
| 400 | `invalid_request_error` | validation failures (the message names the field) |
| 400 | `context_length_exceeded` | prompt ≥ context, or prompt + max_tokens > context |
| 400 | `capacity_exhausted` | the request cannot fit in memory even alone |
| 400 | `invalid_thinking_signature` | Anthropic thinking signature from another key |
| 401 | `authentication_error` | missing or wrong key |
| 403 | `forbidden` | Host or Origin refused, or more than one Host/Origin header |
| 404 | `not_found`, `model_not_found`, `not_found_error`, `previous_response_not_found` | |
| 408 | `request_timeout` | upload I/O timeout (30 s of inactivity) |
| 413 | `request_too_large` | body > `--max-request-size` |
| 415 | `invalid_request_error` | wrong Content-Type or Content-Encoding |
| 500 | `engine_failed` | restarts stopped |
| 500 | `internal_server_error` | |
| 500 | `invalid_model_output`, `scoring_unsupported` | |
| 503 | `engine_recovering` | engine restarting (retry) |
| 503 | `server_shutdown` | |
| 503 | `frontend_overloaded` | queue, body budget, preparation slots or connections full |
| 503 | `mask_timeout` | grammar stalled |
| 504 | `request_timeout` | `timeout` / `--request-timeout` expired |
| 505 | | HTTP version not supported |

## 12. CLI, environment, disk layout, connectors

### 12.1 `splash --help` (1.2.0)

`splash [-h] [--version] {serve,claude,opencode,codex,hermes,pi} ...`.
`splash --version` prints `Splash 1.2.0`, read from `<libexec>/release.json`
(`{"version":"1.2.0","binary_sha256":...,"metallib_sha256":...}`).

### 12.2 `splash serve` flags (1.2.0)

| Flag | Default | Notes |
| --- | --- | --- |
| `--model OWNER/REPO[:VARIANT]` | required | HF repo id. GGUF variant after `:` (e.g. `unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M`). Legacy packages `incoai/*-Splash` have no variant. |
| `--port PORT` | `SPLASH_PORT` or 8000 | 1 to 65535 |
| `--host HOST` | 127.0.0.1 | `0.0.0.0` for LAN (then set `--api-key`) |
| `--revision REV` | repo default | upstream only |
| `--draft-model REPO\|DIR` | auto DFlash2 | upstream only |
| `--language-only` | off | no vision. `/v1/models` then reports `vision:false`, `["text"]`. Upstream only. |
| `--offline` | off | sets `HF_HUB_OFFLINE=1`. Starts an installed model with no Hub request. Does not download. |
| `--served-model-name NAME` | — | repeatable alias |
| `--announce-served-name` | off | needs `--served-model-name` |
| `--default-reasoning-effort E` | `SPLASH_DEFAULT_REASONING_EFFORT` or template | |
| `--kv-format int8\|bf16` | int8 | |
| `--max-memory SIZE` | auto | e.g. `28G` (K/M/G, KiB-based) |
| `--max-cache-disk SIZE` | 0 (off) | SSD KV/state tier |
| `--persistent-cache` | off | needs `--max-cache-disk` |
| `--cache-dir DIR` | `~/Library/Caches/Splash/prefix-cache` | needs `--persistent-cache` |
| `--max-context N\|NK\|auto` | auto | at most 256K (K = 1024). Startup fails if it does not fit. |
| `--decode-share F` | 0.5 | ≥ 0 |
| `--allowed-host HOST` | — | repeatable |
| `--allowed-origin ORIGIN\|'*'` | — | repeatable, exact match |
| `--max-request-size SIZE` | 128M | |
| `--max-image-pixels N` | 4194304 | 65536 to 4194304 |
| `--request-timeout S` | none | |
| `--queue-size N` | 32 | |
| `--api-key KEY` | `SPLASH_API_KEY` | |
| `--no-webui` | off | |

Arguments after `--` are rejected for `serve` and passed through for agent commands.

### 12.3 Environment variables

| Var | Effect |
| --- | --- |
| `SPLASH_PORT` | default port for `serve` **and** the port agent connectors use |
| `SPLASH_API_KEY` | server key, and the key connectors send |
| `SPLASH_DEFAULT_REASONING_EFFORT` | default effort |
| `SPLASH_CRASH_TRACE=1` | write full crash traces (may contain conversation data) |
| `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE` | same as `--offline`. Also suppresses the catalog refresh. |
| `HF_HUB_CACHE`, `HF_HOME` | Hugging Face download cache location |
| `HF_TOKEN` | private or gated repos, and the catalog fetch |
| `HF_ENDPOINT` | Hub endpoint for the catalog fetch |
| (removed in 1.2) `SPLASH_WEIGHT_CACHE` | |

### 12.4 Disk layout (Homebrew 1.2.0)

| Path | Content |
| --- | --- |
| `/opt/homebrew/opt/splash/libexec/` | `release.json`, `engine/splash` (native binary), `python/bin/python3` (bundled), `server/`, `install/` (`install/completions/official-models.txt` bundled catalog, `suggested-models.txt`) |
| `~/Library/Application Support/Splash/` | data dir (`paths.DATA`) |
| `.../models/<owner>/<repo>[:<variant>]` | **selection links** (symlinks), one per installed model selection. A link to a dir with `manifest.json` is a legacy Splash package (here it points into the HF cache snapshot). A dir with `model.json` is an upstream assembly (`models/.resolved/<sha256>`). |
| `.../models/.selections/<sha256>` | selections made with `--revision`, `--language-only` or `--draft-model` (no readable name; read the target's `model.json`) |
| `.../models/.resolved/`, `.../models/.metadata/`, `.../models/.install.lock` | assemblies, GGUF-derived tokenizer metadata, installer lock |
| `.../catalog/official-models.txt` | refreshed official catalog (one repo id per line), written by `splash serve` in a detached background process when older than 24 h, from `https://huggingface.co/api/collections/incoai/splash-6aac69afeba907af0511ec14` |
| `.../runtime/serve.lock` | shared flock held by every running server (installation lock) |
| `.../runtime/serve-<port>.lock` | exclusive flock per port. JSON `{"pid":int,"model":str,"port":int}`. **Content persists after exit (stale)**, so check liveness with `flock(LOCK_EX\|LOCK_NB)` failing, or `kill(pid,0)` plus a `/health` probe. Never trust the content alone. [observed] |
| `.../thinking.key` | Fernet key (mode 0600) for Anthropic hidden-thinking signatures |
| `~/.cache/huggingface/hub/models--<owner>--<repo>/` | actual weights. Kept on disk; read at every start and at every restore after idle (1.2). |
| `~/Library/Caches/Splash/prefix-cache/` | persistent prefix cache (opt-in) |

**Official catalog for a model picker:** the union of
`<libexec>/install/completions/official-models.txt` (bundled) and
`~/Library/Application Support/Splash/catalog/official-models.txt` (cache), with
invalid lines dropped. On this machine both list `incoai/Qwen3.6-35B-A3B-Splash` and
`incoai/Qwen3.8-27B-Splash`. Upstream ids worth suggesting are in
`suggested-models.txt` (`mlx-community/Qwen3.6-35B-A3B-4bit`,
`mlx-community/Qwen3.8-27B-4bit`), and the README lists
`unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M` and `unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M`.
The UI can also run `install/catalog.py --list` with the bundled python.

**Installed models:** for each `models/*/*` entry that is a symlink, it is installed
if `<link>/model.json` or `<link>/manifest.json` exists. The name is `owner/repo` (or
`owner/repo:VARIANT`). This is the same rule as shell completion (`install/completions/models`).
On this machine: `incoai/Qwen3.8-27B-Splash` only. Note: an upstream
checkpoint in the HF cache (e.g. `lmstudio-community/Qwen3.8-27B-MLX-4bit`) is **not**
"installed" until `splash serve --model` has assembled it once. The first start
needs the Hub, for draft resolution, unless it is already assembled. There is also
`install/models.py --model ID link` (prints the selection link path) and
`verify [--full]`.

### 12.5 Agent connectors (`splash claude|opencode|codex|hermes|pi`)

They always connect to `http://127.0.0.1:${SPLASH_PORT:-8000}` (loopback only). They
`GET /v1/models` with `Authorization: Bearer $SPLASH_API_KEY` if that is set. They
require `data[0].owned_by=="splash"` and an int `context_length`, and `data[0].id`
becomes the model. On success they print
`Starting <client>: <model> · <context> context tokens` and exec the client:

- `claude`: `ANTHROPIC_BASE_URL=<base>`, `ANTHROPIC_AUTH_TOKEN=<key or "local">`, all
  model vars set to the model, `--disallowedTools WebSearch --permission-mode default`.
- `codex`: `-c model_providers.splash={base_url=<base>/v1, env_key=SPLASH_API_KEY, wire_api="responses"}`, context window, auto-compact at 90%.
- `opencode`: `OPENCODE_CONFIG_CONTENT` provider `splash` (`@ai-sdk/openai-compatible`,
  `<base>/v1`), effort variants; `--standalone` on v2.
- `hermes`: profile `~/.hermes/profiles/splash[-<port>]`, `custom` provider.
- `pi`: writes provider `splash[-<port>]` into `~/.pi/agent/models.json`.

Errors: `No ready Splash server at http://127.0.0.1:8000. Run 'splash serve --model <HF_REPO_ID>' in another terminal first.`,
`Could not identify the local Splash server`,
`Splash authentication failed; set SPLASH_API_KEY to the server's key`. A UI that
launches the server on a non-default port must pass `SPLASH_PORT` (and
`SPLASH_API_KEY`) to any connector it spawns.

## 13. Version gates

Verified by reading each tag's `server/server.py`, `protocol.py`, `frontend.py`,
`metrics.py`, `http_security.py` and `install/launcher.py` through
`gh api repos/incoai/splash/contents/<f>?ref=<tag>`, plus the release notes.
Releases: 1.0 (2026-09-18), 1.0.1 (09-20), 1.0.2 (09-21), 1.1.0 (09-26),
1.2.0 (10-04). **Feature-detect** where possible (the `/status.schema_version` and
the presence of `/v1/models` fields) rather than parsing `splash --version`. When
Splashboard launches the server itself, `splash --version` is fine.

| Feature | 1.0 | 1.0.1 | 1.0.2 | 1.1.0 | 1.2.0 |
| --- | --- | --- | --- | --- | --- |
| `/health`, `/ready`, `/status`, `/metrics`, `/v1/models`, chat, responses, messages, count_tokens, tokenize, apply-template | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/status.schema_version` | 5 | 5 | 5 | 5 | **6** |
| native protocol | 5 | 5 | 6 | 6 | 7 |
| `delta.reasoning_content`, `usage.*_details`, `metrics` object, `stream_options.include_usage`, `return_progress`/`prompt_progress`, `: splash-keepalive` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--api-key`/`SPLASH_API_KEY`, `x-api-key`, `--allowed-host` | ✓ | ✓ | ✓ | ✓ | ✓ (Bearer and x-api-key together: 1.2) |
| `--port` / `SPLASH_PORT` (default 8000 before that), `--max-request-size` | — | ✓ | ✓ | ✓ | ✓ |
| `--host` via launcher, `--served-model-name`, `--default-reasoning-effort`, `/v1/judgments`, `/v1/systemone`, `latency` histograms | — | — | ✓ | ✓ | ✓ |
| Upstream MLX/GGUF models (`OWNER/REPO:VARIANT`), `--revision`, `--draft-model`, `--language-only`, `--kv-format`, `--max-cache-disk`, `splash pi` | — | — | — | ✓ | ✓ |
| `/v1/models` `max_model_len`/`context_length`/`vision`/`input_modalities` | — | — | — | ✓ | ✓ |
| `timings` object (chat) | — | — | — | ✓ | ✓ |
| `--allowed-origin` (CORS). Before this, any cross-origin `Origin` gives 403 `cross-origin requests are not allowed`. | — | — | — | — | ✓ |
| `/v1/completions`, `ignore_eos`, `chat_template_kwargs` | — | — | — | — | ✓ |
| `min_p`, `presence/frequency/repetition_penalty` (non-zero gives 400 before 1.2) | — | — | — | — | ✓ |
| Omitted `max_tokens` = remaining context (before 1.2: 32,768 cap) | — | — | — | — | ✓ |
| `--offline`, `--persistent-cache`, `--cache-dir`, `--decode-share`, `--announce-served-name`, `--request-timeout`/`--queue-size` via `splash serve` | — | — | — | — | ✓ |
| Idle weight release after 600 s, plus restore on next request | — | — | — | — | ✓ |
| `metrics.decode_cycle_ms`, `latency.http_ttft` (was `latency.ttft`), `splash_http_ttft_seconds` | — | — | — | — | ✓ |
| `/ready` 503 under critical memory pressure. Engine recovery when idle, `engine_failed`. | — | — | — | — | ✓ |
| Default request timeout | 1800 s | 1800 s | 1800 s | 1800 s | none |

Degrade gracefully:

- With no `vision` in `/v1/models`, assume text plus image (1.0 packages had vision)
  but hide PDF.
- With no `timings`, compute rates from `metrics.request_latency`.
- On schema 5, read `latency.ttft` instead of `http_ttft`, expect no
  `decode_cycle_ms`, and tolerate differently named cache, KV and lane fields.
- Before 1.2, never send penalties or `min_p`, and use Rust-side HTTP (no CORS).

## 14. UI implications (summary for builders)

1. **Connectivity layer.**
   - Do HTTP from Rust (no Origin) for every server. Or, when Splashboard spawns
     `splash serve` itself, add `--allowed-origin tauri://localhost` (plus the dev
     origin) and use webview fetch.
   - Expect `Connection: close` everywhere. A failed webview fetch against a
     user-started server is probably the Origin 403, not "down".
2. **Starting a server.**
   - Spawn `splash serve --model <id> --port <p> [--offline]` and keep the PID (the
     server PID after exec).
   - Stream stdout and stderr. Map `Loading ·` → `Weights loaded in` → `Kernel policy`
     → `Ready ·` to a progress stepper. Warmup between the last two takes about 15 s.
     Downloads show `Fetching N file(s), X GB`, and progress comes from the HF blob
     sizes.
   - Probe `/ready` with a 1 s or shorter connect timeout. Refused or timeout while
     the PID lives means "starting".
   - Exit before Ready means failure: show the last `error:` or `Error ·` line.
   - Before spawning, check `runtime/serve-<port>.lock` with flock or the PID and
     probe the port, to offer "attach to running server".
3. **Stopping.** Send SIGINT, wait up to about 10 s, then SIGTERM. A second SIGINT
   kills the engine. Verify nothing listens on the port.
4. **Status polling.**
   - Poll `/status` at 1 to 2 Hz while the dashboard is visible and slower in the
     background.
   - Compute live tok/s and acceptance from deltas (9.1). Never display the lifetime
     `*_per_second` and `draft_acceptance_rate` as "current".
   - The busy pill is `scheduler.prefilling+decoding>0`.
   - Show memory as `current_bytes/limit_bytes`. Show KV as active/cache pages vs
     `kv_capacity_pages`.
   - Surface `memory_pressure`, `transport.recovering`, `transport.stopped`,
     `status_stale` and `admission.waiting*` as banners.
   - Reset charts when `instance.id` or `transport.restarts` changes.
5. **Chat streaming.**
   - Always send `stream:true`, `stream_options:{include_usage:true}`, an explicit
     `max_tokens`, and `return_progress:true`.
   - Render `reasoning_content` into a collapsible thinking block and `content` into
     the answer.
   - Ignore the role/start chunk, `prompt_progress` chunks (use them for a prefill
     bar), empty-delta keepalives and `: splash-keepalive` comments.
   - Final stats come from the finish chunk's `timings` and the usage chunk
     (`cached_tokens`, `reasoning_tokens`, `metrics.request_latency.ttft_ms`).
   - Stop = abort the fetch (close the socket).
   - A stream that has not sent headers for more than 2 s is queued: show "Waiting
     for a free slot" using `/status.admission`.
6. **Reasoning control.** Offer Off/Low/Medium/High, mapped to
   `none`/`low`/`medium`/`xhigh`. Prefer `reasoning_effort` and do not also send
   `chat_template_kwargs.enable_thinking`, because the kwarg silently wins. Budget
   about 40 extra prompt tokens for the thinking system prompt; `/apply-template`
   shows the exact prompt.
7. **Sampling defaults are Qwen's**, not OpenAI's: temperature 1.0, top_p 0.95,
   top_k 20. Show these as the defaults and send only what the user changed.
8. **Weights reload after idle** (1.2), observed.
   - After 600 s with no generation request the engine frees the weight memory.
   - `/health` and `/ready` both stay 200 and `/status.ready` stays true. Only
     `memory_actual.current_bytes` (18.9 GB → 1.5 GB) and the stderr line
     `Weights released after 600 s ...` reveal it.
   - The next request is queued before START while the weights restore (3.07 s
     here). Headers are delayed, a `: splash-keepalive` comment arrives at 2 s, then
     the start chunk, prefill and tokens. Its `queue_to_start_ms` equals the restore
     time.
   - In the UI, show a "Waking model..." state from send until the start chunk when
     memory indicates released weights (or 600 s or more since the last request).
     Show a resident/released indicator on the dashboard. Do not treat it as an
     error or as "not ready".
9. **Images and PDFs.** Encode as base64 `data:` URLs client-side, at most 32 MiB
   each and at most 64 per request. Gate attachments on `/v1/models[].vision` and
   `input_modalities`.
10. **Model picker.** Show installed models (selection links), the official catalog
    (bundled plus cache) and suggested upstream ids. The context limit comes from
    `/v1/models.context_length` or the `Ready · ... context NK` line.

## 15. Fixture index (`fixtures/splash-1.2.0/`)

See `manifest.json` for the machine-readable form (request body, server flags, HTTP
status per file).

| File | What |
| --- | --- |
| `serve.log` | main session stdout+stderr: startup, Done/Cancelled/Error/Refused lines, Stopping |
| `startup_probe.jsonl` | every `/health` `/ready` `/status` probe during startup (refused, then timeouts, then 200s) |
| `serve_cors_apikey.log` | second session with `SPLASH_API_KEY` set and `--allowed-origin tauri://localhost --allowed-origin http://localhost:1420` |
| `serve_port_in_use.log` | launcher refusal when the port's server is already running |
| `serve_idle_release.log`, `idle_release_trace.jsonl` | third session: idle release and restore (4.5) |
| `health_idle_released.json`, `ready_idle_released.json`, `status_idle_released.json`, `metrics_idle_released.txt` | probes while weights were released (all 200; memory 1.5 GB) |
| `status_restore_start.json`, `chat_stream_after_idle.timeline.jsonl`, `status_after_restore.json` | the wake-up request: delayed headers, keepalive, start chunk at 3.07 s, `queue_to_start_ms` 3070.6 |
| `health.json`, `ready.json`, `*.headers.txt` | probes when ready, with raw headers |
| `status_idle.json` / `status_busy.json` / `status_busy_2.json` / `status_saturated.json` / `status_after_cancel.json` / `status_after.json` | `/status` snapshots |
| `metrics.txt` | `/metrics` after startup |
| `models.json`, `model_get.json` | model discovery |
| `chat_stream_thinking.sse` | raw SSE, default effort (thinking on), include_usage |
| `chat_stream_no_thinking.sse` | raw SSE, `reasoning_effort:"none"` |
| `chat_stream_tools.sse` | raw SSE with a tool call (`reasoning_effort:"low"`) |
| `chat_stream_cancelled.sse` | stream aborted by the client at 1.5 s (truncated mid-generation) |
| `chat_stream_long.timeline.jsonl` | 400-token stream with per-line arrival ms and `return_progress` (shows bursts) |
| `chat_stream_long_prompt.timeline.jsonl` | 13,116-token prompt: `prompt_progress` every 2048 tokens plus empty-delta keepalives |
| `chat_stream_queued.timeline.jsonl` | request queued behind 4 lanes: delayed headers, `: splash-keepalive` every 2 s |
| `chat_nonstream.json`, `chat_nonstream_effort_low.json`, `chat_nonstream_enable_thinking_false.json`, `chat_nonstream_json_schema.json`, `chat_nonstream_image.json` | non-streaming variants |
| `completions_nonstream.json`, `responses_stream.sse`, `messages_stream.sse`, `tokenize.json`, `apply_template.json` | other endpoints |
| `error_400.json` (temperature 5), `error_401.json`, `error_404.json`, `error_model_not_found.json`, `error_reasoning_effort.json`, `error_context_length.json`, `origin_forbidden.json` (`/health` with `Origin: tauri://localhost`), `origin_forbidden_chat.json`, `origin_preflight_forbidden.*`, `host_forbidden.json` | error bodies |
| `cors_preflight_allowed.headers.txt`, `cors_status_allowed.headers.txt`, `cors_stream_allowed.headers.txt` | CORS headers when the origin is admitted |
| `req_*.json` | exact request bodies used |
| `capture/` | `poller.py`, `sse_timeline.py`, `idle_release_capture.py` used to produce the above |

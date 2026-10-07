# Mock Splash server

A zero-dependency Node server (Node 22+) that replays the recorded Splash 1.2.0
fixtures in `fixtures/splash-1.2.0/` over real HTTP, so the UI can run in a
browser or Playwright without Apple silicon, a model or a GPU.

```sh
node dev/mock-splash/server.mjs                 # http://127.0.0.1:8090
SPLASH_URL=http://127.0.0.1:8090 pnpm web       # browser UI against the mock
```

There is deliberately no `package.json` script for it.

## Options

| Flag                 | Default                 | Meaning                                                                                                                             |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--port N`           | `SPLASH_PORT` or 8090   | `0` picks a free port                                                                                                               |
| `--host H`           | 127.0.0.1               |                                                                                                                                     |
| `--speed X`          | 1                       | pacing multiplier: `10` replays 10x faster                                                                                          |
| `--status MODE`      | `cycle`                 | `/status` snapshots: `cycle` (idle → busy → busy_2 → after_cancel → after → saturated), `busy` (busy ↔ busy_2), `idle`, `saturated` |
| `--status-step-ms N` | 1000                    | wall time per `/status` step                                                                                                        |
| `--idle-release S`   | off                     | simulate the 1.2 idle weight release after S seconds without a chat request                                                         |
| `--api-key KEY`      | `SPLASH_API_KEY`        | require `Authorization: Bearer KEY` or `x-api-key` on non-public routes (401 + `WWW-Authenticate: Bearer` otherwise)                |
| `--allowed-origin O` | none                    | admit this `Origin` with CORS headers (repeatable; `*` = any). Other Origins get Splash's 403                                       |
| `--fixtures DIR`     | `fixtures/splash-1.2.0` |                                                                                                                                     |
| `--quiet`            | off                     | no request log                                                                                                                      |

Programmatic use (tests): `import { startMockSplash } from 'dev/mock-splash/server.mjs'`,
then `const mock = await startMockSplash({ port: 0, speed: 50 })`, use `mock.url`,
read `mock.stats`, and `await mock.close()`. Options mirror the flags
(`statusAdvance: 'poll'` advances `/status` one step per poll for deterministic tests).

## Routes

| Route                                                  | Response                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/HEAD /health`, `/ready`                           | `health.json`, `ready.json`                                                                                                                                                                                                                                                      |
| `GET /status`                                          | the status mode's snapshots. Counters are offset on every wrap so they never decrease; `instance` is the mock's own (id, pid, port). While released (`--idle-release`), memory and scheduler come from `status_idle_released.json`, and `scheduler.queued: 1` during the restore |
| `GET /metrics`                                         | `metrics.txt`                                                                                                                                                                                                                                                                    |
| `GET /v1/models`, `/v1/models/{id}`                    | `models.json`, `model_get.json` (404 `model_not_found` for other ids)                                                                                                                                                                                                            |
| `POST /v1/chat/completions`                            | non-streaming: `chat_nonstream*.json` by request shape. Streaming: see scenarios                                                                                                                                                                                                 |
| `POST /v1/completions`, `/tokenize`, `/apply-template` | the matching fixture                                                                                                                                                                                                                                                             |
| `OPTIONS *`                                            | 204 preflight                                                                                                                                                                                                                                                                    |
| `GET /__mock/stats`                                    | mock-only: request, poll and stream counters (`streams.cancelled` counts client disconnects)                                                                                                                                                                                     |
| anything else                                          | `error_404.json`                                                                                                                                                                                                                                                                 |

Chat requests are validated like Splash: a user message is required, a `model`
must be listed (404), `reasoning_effort` must be valid, `temperature` in [0, 2]
(`error_400.json`), `return_progress` only with `stream: true`.

## Streaming scenarios

Picked from the request: `tools` → `chat_stream_tools.sse`; `reasoning_effort: "none"`
or `chat_template_kwargs.enable_thinking: false` → `chat_stream_no_thinking.sse`;
otherwise `chat_stream_thinking.sse`. Force one with `?scenario=NAME` or the
header `x-mock-scenario: NAME`:

| Name                               | Fixture                                  | Pacing                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thinking`, `no_thinking`, `tools` | `chat_stream_*.sse`                      | start chunk at once, first token after the fixture's `timings.prompt_ms`, then the speculative-burst gaps recorded in `chat_stream_long.timeline.jsonl` |
| `long`                             | `chat_stream_long.timeline.jsonl`        | recorded                                                                                                                                                |
| `long_prompt`                      | `chat_stream_long_prompt.timeline.jsonl` | recorded (71 s prefill, progress chunks, empty-delta keepalives)                                                                                        |
| `queued`                           | `chat_stream_queued.timeline.jsonl`      | recorded (headers after 2 s, `: splash-keepalive` every 2 s, START at 38 s)                                                                             |
| `after_idle`                       | `chat_stream_after_idle.timeline.jsonl`  | recorded (weight restore: keepalive at 2 s, START at 3.07 s)                                                                                            |

The usage chunk is sent only with `stream_options.include_usage: true`, and
`prompt_progress` chunks only with `return_progress: true`. Closing the
connection stops the replay (Splash cancels the request the same way).

## Error injection

Add `?mock_error=CODE` to any URL, or send the header `x-mock-error: CODE`:

| CODE         | Response                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `400`        | `error_400.json` (temperature)                                                                                 |
| `context`    | 400 `error_context_length.json`                                                                                |
| `401`        | `error_401.json` + `WWW-Authenticate: Bearer`                                                                  |
| `403`        | `origin_forbidden.json`                                                                                        |
| `404`        | `error_model_not_found.json`                                                                                   |
| `500`        | 500 `engine_failed`                                                                                            |
| `503`        | 503 `frontend_overloaded` + `Retry-After: 1`                                                                   |
| `recovering` | 503 `engine_recovering` + `Retry-After: 1`                                                                     |
| `midstream`  | (streaming chat) a 200 stream that sends ~10 tokens, then `{"error":{...,"code":"mask_timeout"}}` and `[DONE]` |

In browser dev the Vite proxy forwards the query string and headers, so
`/splash/v1/chat/completions?mock_error=503` works from the UI.

# Splashboard terminal → UI parity spec

Everything people do with Splash in a terminal, and the Splashboard surface that replaces it. Every `splash serve` flag, every environment variable that matters and every per-request chat parameter gets a UI control here, with its default, range, validation, version gate and help text.

- **Target:** Splash **1.2.0** (Homebrew `incoai/tap/splash`). Older releases are handled by the version gates (`min_version`).
- **Machine-readable twin:** [`splash-params.json`](splash-params.json). Sections 3, 4, 5 and 7 below are rendered from the same data; build forms from the JSON, not from these tables.
- **HTTP contract:** [`splash-api.md`](splash-api.md) owns routes, `/status` fields, SSE grammar, log line grammar and error bodies. This document links to it rather than repeating it.
- **Sources:** `splash-src/` is the 1.2.0 source (`https://github.com/incoai/splash/blob/1.2.0/<path>`); its `install/` and `server/` are byte-identical to the Homebrew libexec. Older tags (1.0, 1.0.1, 1.0.2, 1.1.0) were read for version gates. Community evidence links to GitHub issues (`#N` = `https://github.com/incoai/splash/issues/N`) and other repos. `<libexec>` means `/opt/homebrew/opt/splash/libexec`.
- **Counts:** 25 `splash serve` flags, 16 environment variables in the form (4 paired with a flag, 12 env-only), 5 agent-launch env options, 28 request parameters, 20 presets, 5 agent connectors, 4 copy-config client cards.

**How column legend.** *Native (child process)*: Splashboard spawns a non-interactive program and streams its output. *Native (HTTP / files / env / signals / macOS API)*: done in-process. *Embedded terminal (PTY)*: an xterm.js pane backed by a pseudo-terminal, needed only for interactive programs. *Copy config + open*: Splashboard shows the settings to paste into another app and can apply the server-side half. *Not offered*: deliberately absent, with the reason.

## 1. Ground rules for a terminal-free Splash

1. **Always go through `splash serve`.** Spawn `/opt/homebrew/bin/splash serve ...` (or the detected wrapper) as a plain child process in its own process group, with no PTY. Never run `python -m server.server` or `engine/splash serve-native` directly: they skip the port and installation locks, the model install, the device check and the assembly hold.
2. **Secrets travel in the environment.** Pass the API key as `SPLASH_API_KEY` and the Hugging Face token as `HF_TOKEN`, never as `--api-key` (the launcher's argv is visible in `ps` until it execs). Store both in the macOS Keychain.
3. **One PID.** The launcher execs into the server, so the spawned PID is the server PID and is the PID in `runtime/serve-<port>.lock`. Stop with SIGINT, escalate to SIGTERM, and SIGKILL the process group only after a confirmed Force stop.
4. **Talk HTTP from Rust, or admit the webview.** Webview `fetch` sends `Origin: tauri://localhost`, which every Splash server refuses with 403 unless started with `--allowed-origin tauri://localhost` (1.2.0+). Servers Splashboard starts get the flag automatically; servers started elsewhere are reached from Rust, which sends no Origin (see splash-api.md section 3).
5. **Resolve PATH like a shell.** Apps opened from Finder do not inherit the shell PATH. Resolve `splash`, `brew` and agent binaries with `zsh -lc 'command -v <name>'`, falling back to `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`.
6. **Gate on the installed version.** Read `release.json` once per launch. A control whose `min_version` is newer than the installed Splash is disabled with 'Needs Splash X.Y', so the 'unrecognized arguments' failures from #82, #163 and #185 cannot happen.
7. **Validate before spawning.** Apply each field's `validation` and the cross-field rules (section 3.9) in the form; startup-time failures (context too large, model too big, unsupported architecture) are explained from the log when they happen.
8. **Keep loopback off any proxy.** When `HTTP(S)_PROXY`/`ALL_PROXY` is set, add `NO_PROXY=127.0.0.1,localhost` for the server, downloads and agent launches.

## 2. Parity matrix: terminal action → Splashboard surface

Screens follow the app's feature folders: Onboarding, Engine (dashboard, logs, servers), Models, Settings (launch profile, general, storage, network, updates, advanced), Chat, Connect (agents and other apps), Benchmark, Diagnostics.

### 2.1 Install, upgrade and remove Splash

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| Check this Mac can run Splash | `sysctl hw.memsize`, `sw_vers`; after install `<libexec>/engine/splash device-check` | Onboarding &gt; Compatibility checklist (chip and GPU family, macOS, RAM, free disk, Homebrew) | Runs on first launch. Plain yes/no per row with the reason: M3 or newer (GPU family 9), macOS 26.4+, RAM tier (24 GB works with small GGUFs, 36 GB minimum for 4-bit, 48 GB recommended), ~25 GB free per model. After install, `device-check` (exit 0, silent) is the authority; its last stderr line is the message. | Native (child process + sysctl) | 1.0 (device-check verified in 1.2.0) |
| Install Homebrew (prerequisite) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` | Onboarding &gt; 'Install Homebrew' step | The installer asks for an admin password and confirmation, so it runs in the embedded terminal pane. Offer a link to brew.sh as the alternative. Re-detect brew when the pane exits. | Embedded terminal (PTY) | n/a |
| Install Splash | `brew install incoai/tap/splash` | Onboarding &gt; 'Install Splash' button with a live log pane | Non-interactive; stream stdout and stderr. Success re-runs detection and device-check. Failure keeps the log open with 'Copy log'. The formula refuses macOS older than 26.4 ('Splash requires macOS 26.4 or newer.'). | Native (child process) | 1.0 |
| See the installed version | `splash --version` | Version badge in the title bar; Settings &gt; About | Read `<brew --prefix incoai/tap/splash>/libexec/release.json` `.version`. Also recognise the tester install (`~/Library/Application Support/Splash/app/current`) and a source checkout ('Splash (source checkout)'). The version drives every version gate below. | Native (file read) | 1.0 |
| Check for a newer Splash | `brew update && brew outdated incoai/tap/splash` | Settings &gt; Updates: 'Check now', plus a badge when a newer release exists | Compare release.json with GitHub `repos/incoai/splash/releases/latest` (tags are x.y.z, no 'v'). Run the slow `brew update` only as part of an upgrade. | Native (HTTP) | 1.0 |
| Upgrade Splash | Stop servers (Ctrl+C), then `brew update && brew upgrade incoai/tap/splash` | Settings &gt; Updates &gt; 'Upgrade' | Confirm dialog lists the running servers that will stop (Homebrew does not take Splash's serve.lock, and a server left running fails later with 'native engine executable is missing'). Stop each, run brew with a log, re-read the version, re-evaluate version gates, then offer 'Start &lt;profile&gt; again'. Models, downloads, thinking.key and agent profiles are kept. | Native (child process) | 1.0 |
| Downgrade or pin a Splash version | Not possible with Homebrew bottles (#96) | Settings &gt; Updates note | Not offered. Explain that Homebrew keeps no previous bottle. | Not offered | — |
| Uninstall Splash | `brew uninstall incoai/tap/splash` (optionally `brew untap incoai/tap`); leftovers by hand | Settings &gt; Danger zone &gt; 'Uninstall Splash' | Typed confirmation. A checklist, all unchecked by default with sizes: data folder (~/Library/Application Support/Splash), ~/Library/Caches/Splash, ~/Library/Logs/Splash, Hugging Face downloads used only by Splash installations, ~/.hermes/profiles/splash*, providers.splash* in ~/.pi/agent/models.json. Stops servers first. | Native (child process + files) | 1.0 |
| Delete the obsolete weight cache | `rm -rf ~/Library/Caches/Splash/weights` | Settings &gt; Storage (shown only when the folder exists) | Shows size; confirm. 1.2.0 never reads it. | Native (files) | 1.2.0 |

### 2.2 Models

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| See which models I can serve | `<libexec>/install/completions/models [PREFIX]`, `python install/catalog.py --list`, README table | Models &gt; Discover: Official, Suggested, Installed; 'fits this Mac' badges | Union of bundled official-models.txt and suggested-models.txt, the cached catalog/official-models.txt and installed selections. Add the README's GGUF and MLX examples and the 24 GB picks. Family and size come from the Hugging Face API. | Native (files + HTTP) | 1.0 |
| Refresh the official catalog | `<libexec>/python/bin/python3 <libexec>/install/catalog.py --refresh --force` | Models &gt; Discover &gt; 'Refresh' | Child process; exit 1 shows 'Could not refresh; showing the cached list'. Skipped when offline. | Native (child process) | 1.0 |
| Pick a GGUF variant | Browse the repo on huggingface.co, then type `--model OWNER/REPO:VARIANT` | Add model dialog: repo field, variant dropdown with file sizes and a fit estimate | List root *.gguf files (excluding mmproj*) from the HF tree API. Mark UD-Q8_K_XL and BF16 targets unsupported. If the repo has no BF16/F32 mmproj (or several), preselect Text only. Validate the ID with the --model pattern before any download. | Native (HTTP) | 1.1.0 |
| Download a model without serving it | Run `splash serve` once and wait, or `<libexec>/engine/splash device-check` then `<libexec>/python/bin/python3 <libexec>/install/models.py --model ID [--revision R] [--draft-model D] [--language-only] prepare` (cwd &lt;libexec&gt;) | Models &gt; 'Download' with a progress bar (bytes, speed, ETA) and Cancel | Disk-space precheck. Spawn with HF_HUB_DISABLE_PROGRESS_BARS=1 plus HF_* env. Read 'Fetching N file(s), X GB, from repo@rev' then sum blob sizes (including *.incomplete) under the HF cache. Cancel = SIGINT (exit 130); partial files resume next time. Installs queue on models/.install.lock ('Another Splash model installation is running; waiting...'). | Native (child process) | 1.2.0 verified (installer CLI in earlier tags unverified) |
| Verify a model's files | `models.py --model ID verify` / `verify --full` | Model detail &gt; 'Check files' and 'Deep check' | Quick check by default. Deep check warns that it re-reads tens of GB. | Native (child process) | 1.2.0 verified |
| List installed models | No command; `ls ~/Library/Application Support/Splash/models` | Models &gt; Installed | Enumerate symlinks models/&lt;owner&gt;/&lt;repo&gt;[:VARIANT] and models/.selections/&lt;sha256&gt; (the shell helper skips the hidden .selections). model.json = upstream assembly, manifest.json = legacy package. Hashed selections carry no readable options, so Splashboard records the revision/draft/text-only it used for each one. | Native (files) | 1.0 (assemblies 1.1.0) |
| See model details and disk use | `cat <link>/model.json`, `du` the HF cache | Model detail drawer | Family, format (mlx-affine, gguf, package), vision, target and draft repo@commit, size on disk (linked blobs), 'in use by server on port N'. | Native (files) | 1.1.0 |
| Remove a model | No command; delete the link, the Splash pins and the HF cache folder by hand | Model &gt; 'Remove...' | Refuse while served (assembly held: an exclusive flock attempt on its model.json fails). Dialog: 'Remove from Splash' (selection link and refs/splash pins), plus optional 'Also free downloaded files' listing only repos no other installation links (the DFlash2 draft is shared per family; the HF cache is shared with other tools). Hold models/.install.lock while deleting. | Native (files) | 1.1.0 |
| Update a model, or freeze it | Automatic at each start; `--revision <commit>` to pin; `--offline` to skip | Model detail &gt; Updates: Follow default branch / Follow branch or tag / Pin current commit / Never check | Pin writes the commit from model.json into the profile's revision (a separate installation, re-assembled from cached files). 'Never check' sets offline. Log lines such as '&lt;repo&gt; moved from a to b.' show as a toast. | Native | 1.1.0 (offline 1.2.0) |
| Use a private or gated model | `export HF_TOKEN=...` or `hf auth login` | Settings &gt; Hugging Face: token field, 'Test', 'Save as hf login' | Token in the Keychain, passed as HF_TOKEN to serve and downloads. Test runs `hf auth whoami`. Save runs `<libexec>/python/bin/python3 <libexec>/python/bin/hf auth login --token <t>`: the bundled `hf` script's shebang is broken in 1.2.0, so call it through the bundled python. | Native (child process) | 1.0 |
| Keep models on another disk | `HF_HUB_CACHE=/Volumes/Models/huggingface splash serve ...` | Settings &gt; Storage &gt; 'Model download folder' | Sets HF_HUB_CACHE for servers and downloads. Warns that existing downloads stay where they are and the disk must stay mounted (originals are read at every start and after idle). | Native (env) | 1.0 |
| Free disk used by downloads | `hf cache scan` / `hf cache rm` | Settings &gt; Storage: per-repo sizes for Splash-related repos | Scoped to repos Splash installations link; never lists unrelated HF models for deletion. | Native (files) | 1.1.0 |

### 2.3 Serving and the server's lifecycle

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| Start the server | `splash serve --model ID [flags]`, then keep the terminal open | Engine &gt; Start (uses the active launch profile); menu bar Start | Spawn `splash serve` as a plain child in its own process group; no PTY. Secrets go in env (SPLASH_API_KEY, HF_TOKEN). Phase stepper: locks and port check -&gt; device check -&gt; download/verify -&gt; Loading -&gt; Weights loaded -&gt; Kernel policy (warm-up) -&gt; Ready. Probe /ready with a connect timeout of 1 s or less. Exit before Ready shows the last `error:` / `Error ·` line. | Native (child process) | 1.0 |
| Set any `splash serve` flag or env var | Add `--flag value` or `ENV=value` to the command | Settings &gt; Launch profile (form generated from splash-params.json, section 3) | Changing a field while a server runs shows 'Restart to apply'. Controls the installed Splash lacks are disabled with 'Needs Splash X.Y'. Cross-field rules grey out dependent controls. | Native | per field |
| Stop the server | Ctrl+C (a second Ctrl+C kills the engine at once) | Engine &gt; Stop; menu bar Stop | SIGINT to the server PID (the launcher execs into the server, so the PID stays the same). After the grace period SIGTERM; 'Force stop' (SIGKILL to the process group) only after a confirm. During a download, confirm 'Stop the download? It resumes next time.' | Native (signals) | 1.0 |
| Restart to apply settings | Ctrl+C, then run the command again | 'Restart to apply' banner | If requests are running, confirm 'N requests in progress will be cancelled'. | Native | 1.0 |
| Switch to another model | Ctrl+C, then `splash serve --model OTHER ...` | Model switcher in the title bar | Confirm the restart. Each model remembers its own launch profile (named profiles). | Native | 1.0 |
| Run several servers | `splash serve --port 8001 ...` in another terminal | Engine &gt; Servers list &gt; 'New server' with a port field | Refuse a port whose lock is held or that fails the bind probe. Warn that servers share the GPU and RAM; each has its own memory budget. | Native | 1.0.1 |
| Find a server started elsewhere | `ps`, `lsof -iTCP:8000`, read runtime/serve-&lt;port&gt;.lock | Engine banner: 'Splash is running on port P (PID, model)' with Attach / Stop | flock(LOCK_EX\|LOCK_NB) on each runtime/serve-*.lock: failure means live; then read {pid, model, port} and confirm GET /v1/models owned_by == 'splash'. Lock files stay after exit, so never trust the content alone. Attached servers get monitoring, chat and agents, but no logs. | Native (files + HTTP) | 1.0.1 |
| Keep the server running in the background | `nohup`, tmux, or a LaunchAgent with KeepAlive | Settings &gt; General: 'Keep server running when Splashboard quits'; menu bar extra | Spawn detached (setsid) with logs to ~/Library/Logs/Splashboard/&lt;port&gt;.log; re-attach through the lock file on next launch. | Native | 1.0 |
| Start at login | LaunchAgent plist (community convention ai.splash.serve.plist) | Settings &gt; General: 'Open Splashboard at login', 'Start server at login with profile ...' | Login item via SMAppService; the app starts the chosen profile. | Native (macOS API) | 1.0 |
| Restart automatically if the server dies | launchd KeepAlive | Settings &gt; General: 'Restart server if it exits unexpectedly' | At most 3 restarts in 5 minutes, then stop and notify. No restart after a clean stop or a launcher error (port busy, bad flag, download failed). Splash already restarts a crashed engine itself; this covers the server process. | Native | 1.0 |
| Keep the Mac awake while serving | `caffeinate -i -s -m splash serve ...` | Settings &gt; General: 'Prevent sleep while serving' (on by default) | IOPMAssertion PreventUserIdleSystemSleep while the server runs, or `caffeinate -i -w <pid>`. | Native (macOS API) | 1.0 |
| Start without internet | `splash serve ... --offline` or `HF_HUB_OFFLINE=1` | Launch profile &gt; Model &gt; 'Offline start'; offered automatically when the Hub is unreachable | Only for an installed selection; greyed out for a model never installed. | Native | 1.2.0 (env 1.1.0) |
| Share on the LAN with an API key | `splash serve ... --host 0.0.0.0 --api-key KEY --allowed-host mymac.local` | Settings &gt; Network &gt; 'Share on my network' guided toggle | Generates a key if none, adds `<LocalHostName>.local` to allowed hosts, shows LAN IPs and a copyable base URL and key, warns on public networks. Restart required. | Native | 1.0.2 |
| Let a browser or webview app call the API | `--allowed-origin ORIGIN` (repeatable) | Launch profile &gt; Security &gt; 'Allowed web origins' | Splashboard's own origin is added automatically when its webview calls Splash directly. | Native | 1.2.0 |
| Open Splash's built-in chat page | Open http://127.0.0.1:8000 | Engine &gt; 'Open Splash chat page' (hidden with Disable built-in chat page) | Opens the default browser. | Native | 1.0 |

### 2.4 Status, logs and troubleshooting

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| Is it ready, and what is it doing? | `curl /health /ready /status /metrics` | Engine dashboard: state, context, vision, memory, KV, tok/s, TTFT, acceptance, queue | Fields and derivations are in docs/splash-api.md sections 9 and 10. | Native (HTTP) | 1.0 |
| Read the server log | Terminal scrollback | Engine &gt; Logs: live, filter by stream (server, engine, installer, errors), search, copy, export | Splash writes no log file; capture stdout and stderr. Grammar in docs/splash-api.md 4.4. Keep a rolling file per server. | Native | 1.0 |
| Understand an error message | Read the text, search the issues | Inline 'What this means' cards in the log and banners | Known messages map to a plain-language fix (section 10). | Native | 1.0 |
| Record a crash trace | `SPLASH_CRASH_TRACE=1 splash serve ...` | Settings &gt; Advanced &gt; 'Record crash traces'; Diagnostics &gt; Crash traces list | Privacy confirm when enabling; restart required. Lists ~/Library/Logs/Splash/crash/splash-crash-g&lt;N&gt;-&lt;time&gt;.json with Reveal in Finder and Delete. | Native (env + files) | 1.0 |
| Report a bug | Copy `splash --version`, the log, `/status` and the crash file into an issue | Diagnostics &gt; 'Copy bug report' | Bundles version, macOS, chip, RAM, power source, profile flags (key redacted), the last 300 log lines and /status. Crash-trace contents only if the user ticks them. | Native | 1.0 |
| Recover from an engine crash loop | Read the log, Ctrl+C, start again | Banner from /status transport.recovering / transport.stopped with 'Restart server' | Splash restarts the engine itself; after 3 quick failures it stops and needs a server restart. | Native | 1.0 |
| Check the power source | `pmset -g batt` | Dashboard warning on battery or a weak adapter | A 15 W USB-C source cut decode from 84 to 16 tok/s in #37. | Native | n/a |
| Reset the thinking-signature key | `rm ~/Library/Application Support/Splash/thinking.key` | Settings &gt; Advanced (server stopped) | Warn that clients replaying older hidden reasoning get 400 invalid_thinking_signature. Also the fix for 'Thinking key must be a user-owned regular file with mode 0400 or 0600'. | Native (files) | 1.0 |
| Clear the persistent cache | `rm -rf ~/Library/Caches/Splash/prefix-cache` | Settings &gt; Storage &gt; Persistent cache (size, Clear) | Only while no server uses it. | Native (files) | 1.2.0 |

### 2.5 Benchmarking

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| Benchmark this Mac | curl a fixed prompt with temperature 0 and read `timings` with jq; `uvx llama-benchy ...`; community scripts; `make benchmark-*` (source checkouts only) | Benchmark tab: Quick decode, 32K prefill, Cached replay (TTFT), Concurrency 1/2/4, Fixed length | HTTP-driven, no extra tools: a random nonce prefix defeats the prefix cache, temperature 0, fixed max_tokens (ignore_eos on 1.2.0), read timings and usage, and /metrics deltas for draft acceptance. Warn on battery. Save results with Splash version, model and profile. | Native (HTTP) | 1.0 (fixed length 1.2.0) |
| Check speculative decoding works | `curl /metrics \| grep draft_acceptance` | Dashboard acceptance gauge | Warn if acceptance stays at 0 after 100+ drafted tokens (the 1.0.2 M3 Ultra bug, #96). | Native (HTTP) | 1.0.1 |

### 2.6 Coding agents and other apps

| Terminal action | What people run | Splashboard surface & control | Behaviour, confirmations | How | Min Splash |
| --- | --- | --- | --- | --- | --- |
| Launch Claude Code against Splash | `splash claude [ARGS]` in a second terminal, after Ready | Connect &gt; Claude Code card: 'Open in Splashboard terminal', 'Open in Terminal.app', 'Ask once' | Embedded PTY runs `splash claude ARGS` with SPLASH_PORT and SPLASH_API_KEY of the selected server. 'Ask once' runs `splash claude --print --output-format stream-json --verbose` with the prompt on stdin, without a PTY, and renders the JSON events (the same invocation Splash's own real-agent test uses). | Embedded terminal (PTY) | 1.0 |
| Launch OpenCode | `splash opencode [ARGS]` | Connect &gt; OpenCode card | As above; 'Ask once' runs `splash opencode run --format json` with the prompt on stdin. Optional fields: extra OpenCode JSON config and OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX. | Embedded terminal (PTY) | 1.0 (OpenCode 2 handling 1.1.0) |
| Launch Codex | `splash codex [ARGS]`, e.g. `splash codex resume --last` | Connect &gt; Codex card with quick picks 'Resume last' and 'Ask once' | PTY for interactive. 'Ask once' runs `splash codex exec --json -` with the prompt on stdin, without a PTY. | Embedded terminal (PTY) | 1.0 |
| Launch Hermes | `splash hermes [ARGS]`, e.g. `splash hermes chat -q "Hello"` | Connect &gt; Hermes card | First launch confirms: 'Writes ~/.hermes/profiles/splash[-PORT]/config.yaml, including the API key in plain text.' 'Ask once' runs `splash hermes chat --oneshot --query-file -` with the prompt on stdin. | Embedded terminal (PTY) | 1.0 (profile layout 1.2.0) |
| Launch Pi | `splash pi [ARGS]` | Connect &gt; Pi card | First launch confirms: 'Adds provider splash[-PORT] to ~/.pi/agent/models.json; other providers are kept.' 'Ask once' runs `splash pi --print --mode json` with the prompt on stdin. | Embedded terminal (PTY) | 1.1.0 |
| Pass extra arguments to an agent | Anything after `splash <agent>` (one leading `--` is stripped) | Agent card &gt; 'Arguments' field (shell-style split, shown as the final command) | Passed through unchanged. `splash <agent> --help` shows the agent's help only once a server is ready. | Embedded terminal (PTY) | 1.0 |
| Point an agent at a non-default port or a keyed server | `SPLASH_PORT=8001 SPLASH_API_KEY=... splash opencode` | Automatic: the card targets the selected server | Splashboard sets SPLASH_PORT and SPLASH_API_KEY for the PTY. Agents always dial 127.0.0.1, so a server bound to one non-loopback IP cannot be used by agents; the card says so. | Native (env) | 1.0.1 |
| Undo what a launcher wrote | Edit ~/.pi/agent/models.json; `hermes profile delete splash` | Agent card &gt; 'Remove Splash settings' | Pi: remove providers.splash[-PORT] atomically, keep everything else. Hermes: run `hermes profile delete <name>` in the PTY (whether it prompts is unverified; hermes was not installed where this was written) or delete the folder after a confirm. Claude, OpenCode and Codex write nothing, so there is nothing to undo. | Native (files) / Embedded terminal (PTY) | 1.1.0 |
| Install a missing agent | Follow each agent's install docs | Agent card shows 'Not installed' with the install link | Detect with a login shell (`zsh -lc 'command -v claude'`): apps opened from Finder do not inherit the shell PATH. Optional 'Run install command' in the PTY. | External link / Embedded terminal (PTY) | n/a |
| Finish the Hermes 1.1.0 migration | `hermes pm install`, then delete ~/Library/Application Support/Splash/runtime/hermes | Hermes card banner when the old folder exists | Run `hermes pm install` in the PTY, then offer to delete the old folder. | Embedded terminal (PTY) | 1.2.0 |
| Connect Open WebUI, Jan, Cursor, Cline, Continue, SDKs, Claude-style apps | Configure each app by hand; start Splash with matching flags | Connect &gt; Other apps: copy-config cards (base URL, key, model, required server settings) | 'Apply required settings' adds the needed flags to the profile (restart). | Copy config + open | per app |

## 3. Launch settings: every `splash serve` flag and env var

All 25 flags printed by `splash serve --help` (1.2.0) plus the environment variables Splash or its bundled libraries read. Every flag needs a **server restart** (Splashboard shows 'Restart to apply'). Env-only rows are passed in the spawned process's environment; those marked 'Restart: no' are only read by downloads and the install step, so they apply to the next download or start without touching a running server. 'Validation' gives the rule the form enforces; the exact Splash error text is in the JSON.

### 3.1 Model

What to serve, which revision and draft, vision on or off, and where downloads come from.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--model` | Model | model-picker | required | — | — | Required. OWNER/REPO[:VARIANT]; repo name at most 96 characters; no '--', '..' or '.git'. Legacy incoai/*-Splash packages take no :VARIANT, revision, draft or text-only option. | The Hugging Face model to serve. Use OWNER/REPO for an MLX 4-bit model or an Inco Splash package, or OWNER/REPO:VARIANT to pick one GGUF file, for example unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M. Splash recognises the model from its files and downloads the matching speed-up draft for you. Only the Qwen3.8-27B and Qwen3.6-35B-A3B families are supported. This name is also the model name in the API. | yes | 1.0 |
| `--revision` | Model revision | revision-picker | repo default branch | — | — | Branch, tag or 40-hex commit. Not for legacy packages. A different value is a separate installation (re-assembled, unchanged files reused). | Which version of the model repository to use: a branch, a tag or a full 40-character commit. Leave empty to follow the default branch; Splash then checks for a newer version at each start (one request, at most 5 s) and downloads only changed files. Pin a commit to freeze the model. | yes | 1.1.0 |
| `--draft-model` | Draft model | combobox+directory-picker | family DFlash2 draft | — | — | Repo ID or an existing folder (send an absolute path: a relative one resolves against the launcher's working directory). Must match the model family. | Override the small draft model Splash uses to speed up generation. Leave empty to use the matching DFlash2 draft (incoai/Qwen3.8-27B-DFlash2 or incoai/Qwen3.6-35B-A3B-DFlash2). Accepts a Hugging Face repo or a local folder. | yes | 1.1.0 |
| `--language-only` | Text only (no vision) | toggle | off | — | — | Not for legacy packages. A separate installation from the same model with vision. | Skip the vision part of the model. Frees memory for a longer context (the 27B UD-IQ3_XXS on a 24 GB Mac goes from 73,721 to 102,393 tokens) but images and PDFs are refused. Recommended for coding agents on 24 GB Macs, and the fix when a GGUF repo has no usable vision projector. | yes | 1.1.0 |
| `--offline`<br>env `HF_HUB_OFFLINE` | Offline start | toggle | off | — | — | Model must already be installed. Same as HF_HUB_OFFLINE=1 (or TRANSFORMERS_OFFLINE=1), which also works on 1.1.0. | Start without contacting Hugging Face. Use it with no internet, or to skip the update check at start. Works only for a model that is already installed; a model that was never installed still needs the Hub once. | yes | 1.2.0 |
| env `HF_TOKEN` | Hugging Face token | secret | unset | — | — | Optional. A 401/403 during download means the token is missing or lacks access. Alternative: save it as the hf login (~/.cache/huggingface/token). | Access token for private or gated models only; public models need none. Splashboard keeps it in the macOS Keychain and passes it only to downloads and server starts. | no | 1.0 |
| env `HF_HUB_CACHE` | Model download folder | directory-picker | ~/.cache/huggingface/hub | — | — | Writable folder. Warn if on a removable volume; check it is mounted before start. | Where new model downloads go, for example a folder on an external disk. Existing downloads are not moved. Splash reads the original files at every start and after 10 idle minutes, so the disk must stay connected. | no | 1.0 |

### 3.2 Server & network

Port, bind address, host names, model aliases and the built-in chat page.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--port`<br>env `SPLASH_PORT` | Port | number | 8000 | 1 – 65535 | — | Integer 1-65535. Must be free. 8000 is also used by oMLX, vLLM and others; pick another port if it clashes. | Network port for this server. Each port is a separate server with its own model and memory budget. Agents launched from Splashboard are given this port automatically. | yes | 1.0.1 |
| `--host` | Listen on | select | 127.0.0.1 | 127.0.0.1 / 0.0.0.0 / &lt;interface address&gt; | — | IPv4 only. Non-loopback without an API key gets a warning. Agents always dial 127.0.0.1, so keep loopback or 0.0.0.0. | Where the server listens. 'This Mac only' is the safe default. 'All networks' lets other devices on your network connect; turn on an API key when you do. IPv6 is not supported. | yes | 1.0.2 |
| `--allowed-host` | Extra host names | multi-value-list | none | — | — | Host names, one per entry. Splashboard suggests this Mac's .local name. | Host names clients may use in the URL besides IP addresses and localhost, such as mymac.local or a proxy name. Without it, requests that address the server by name get 403. It does not change who can connect. | yes | 1.0 |
| `--served-model-name` | Model aliases | multi-value-list | none | — | — | Non-empty; no spaces, control characters, \ % ? #, or empty/./.. path segments. | Extra names clients may use for the model, such as 'local-qwen' or model names an app has hard-coded. Responses still report the real model ID unless 'Announce first alias' is on. | yes | 1.0.2 |
| `--announce-served-name` | Announce first alias | toggle | off | — | — | Needs at least one alias; disable the toggle until one exists. | Report the first alias as the model name in responses and list it first in /v1/models, for clients that reject a reply whose model name differs from the one they asked for. Agents launched by Splash then use the alias. /status keeps the real ID. | yes | 1.2.0 |
| `--no-webui` | Disable built-in chat page | toggle | off | — | — | None. | Turn off Splash's own chat page at http://127.0.0.1:PORT/. The API keeps working, and Splashboard does not need the page. | yes | 1.0 |

- `--port`: Before 1.0.1 the port was fixed at 8000.

### 3.3 Memory & context

GPU memory budget, context length and image size limits.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--max-memory` | GPU memory limit | slider+auto | auto | ≥ 1; max computed at runtime | GiB | 'auto' or a size such as 28G (K/M/G = 1024-based). Slider max = the Mac's own GPU budget; above it has no effect. Too small for the model fails at startup. | Upper limit on the GPU memory Splash may use. 'Auto' uses as much as macOS considers safe for the GPU. Lower it to leave room for other apps; the automatic context length shrinks with it. It limits GPU allocations, not the total shown in Activity Monitor. | yes | 1.0 |
| `--max-context` | Context length | slider+auto | auto | 1 – 262144 | tokens | 'auto' or 1-262144 tokens (K = 1024). Above the memory-derived limit fails at startup, not when parsed. | Longest conversation (prompt plus reply) the server accepts. 'Auto' picks the most your memory budget allows, up to 256K. Coding agents need about 100K. A value above what memory allows stops the server at startup, so Splashboard caps this slider at the last measured automatic value. | yes | 1.0 |
| `--max-image-pixels` | Max image size | slider | 4194304 | 65536 – 4194304 | pixels | Integer 65,536-4,194,304 (about 0.07-4.2 MP). Hidden when text only. | Largest size an image is scaled to before the model sees it. Lower values use less memory per image (about 600 MiB at the default) and fewer tokens, at the cost of detail. No effect in text-only mode. | yes | 1.0 |

### 3.4 KV & caches

KV cache precision and the optional SSD cache tier.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--kv-format` | KV cache precision | segmented | int8 | int8 / bf16 | — | int8 or bf16. Changes the automatic context limit; re-measure it. | How the model's working memory (KV cache) is stored. 8-bit fits about twice the context. BF16 avoids quantizing it but uses about twice the KV memory and can be slower at long contexts. Model weights are unchanged. | yes | 1.1.0 |
| `--max-cache-disk` | SSD cache size | slider+off | 0 | ≥ 0; max computed at runtime | GiB | 0 (off) or a size such as 16G. Below one state (109/187 MiB) it silently does nothing. Keep below free disk space. | Let Splash move cached conversation data to the SSD when memory runs short, so long prompts do not have to be read again. 0 turns it off. It does not raise the context limit. It writes to your SSD, up to about 50 GB per hour on a busy 24 GB Mac. | yes | 1.1.0 |
| `--persistent-cache` | Keep SSD cache across restarts | toggle | off | — | — | Needs SSD cache size above 0; disable the toggle until it is. | Keep the SSD cache through restarts, upgrades and crashes, so long system prompts and conversations are ready right after a restart. Uses the SSD cache size above. A model's cache unused for 14 days is deleted. | yes | 1.2.0 |
| `--cache-dir` | Persistent cache folder | directory-picker | ~/Library/Caches/Splash/prefix-cache | — | — | Needs the persistent cache on. Send only when it differs from the default. | Folder for the persistent cache. Leave the default unless you want it on another disk. Only one server uses a folder at a time; another waits 20 s, then uses temporary files. | yes | 1.2.0 |

### 3.5 Performance & scheduling

How requests share the engine, queue limits, timeouts and request size.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--decode-share` | Decode share during long prompts | slider | 0.5 | ≥ 0 | ratio | Number &gt;= 0 (no upper bound; UI slider to 4 with free entry). Engine default 0.5. | How Splash balances one long prompt against replies already streaming. Higher keeps other chats and agents flowing while a long prompt is read, but that prompt finishes later. 0 alternates one step each. | yes | 1.2.0 |
| `--queue-size` | Request queue size | number | 32 | ≥ 1 | requests | Integer &gt;= 1. | How many requests the server accepts at once, running plus waiting. More get 'busy, retry later' (503). This is not parallelism: Splash runs at most 4 requests at a time and there is no setting for that. | yes | 1.2.0 |
| `--request-timeout` | Request time limit | number+none | no limit | &gt; 0 | seconds | Empty (no limit) or seconds &gt; 0. | Give up on any request that takes longer than this (error 504). Empty means no limit. It also limits upload time. A request's own timeout can only be shorter. | yes | 1.2.0 |
| `--max-request-size` | Max request size | number | 128M | ≥ 1 | MiB | Positive size such as 256M. | Largest single request body; images and PDFs travel inside it. Bigger requests get 413. All requests in flight share a budget of at least 512 MiB, or twice this value. | yes | 1.0.1 |

- `--queue-size`: 1.0-1.1.0: server-only flag, fixed at 32 through `splash serve`.
- `--request-timeout`: 1.0-1.1.0: fixed 1800 s and not settable through `splash serve` (#185).

### 3.6 Reasoning defaults

Server-wide default for how much the model thinks.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--default-reasoning-effort`<br>env `SPLASH_DEFAULT_REASONING_EFFORT` | Default thinking effort | select | model template | unset / none / minimal / low / medium / high / xhigh / max | — | One of the seven names, or unset. An invalid SPLASH_DEFAULT_REASONING_EFFORT stops startup. | How much the model thinks before answering when a request does not say. 'Model default' keeps the template's own (xhigh for Qwen3.8-27B). 'Off' turns thinking off unless a request asks for it. Anthropic-style requests are not affected. | yes | 1.0.2 |

### 3.7 Security

API key and which web origins may call the API.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--api-key`<br>env `SPLASH_API_KEY` | API key | secret+generate | unset | — | — | Visible ASCII only, no spaces. Passed as env SPLASH_API_KEY, never as --api-key. | A password clients must send (Authorization: Bearer KEY or x-api-key). Needed when sharing on a network. Health checks and the chat page stay public. Splashboard keeps it in the Keychain and hands it to the server and to agents as SPLASH_API_KEY, never on a command line. | yes | 1.0 |
| `--allowed-origin` | Allowed web origins | multi-value-list | none | — | — | Exact scheme://host[:port], or a bare '*'. No wildcards inside. '*' without a key warns. | Web pages or app webviews allowed to call the API from a browser, such as tauri://localhost or http://localhost:3000. '*' allows every site; use it only with an API key. Splashboard adds its own origin automatically when it starts the server. | yes | 1.2.0 |

### 3.8 Advanced

Diagnostics, Hugging Face download tuning and proxies.

| Flag / env | Label | UI control | Default | Range / choices | Unit | Validation | Help text (plain English) | Restart | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| env `SPLASH_CRASH_TRACE` | Record crash traces | toggle | off | — | — | Sets SPLASH_CRASH_TRACE=1 (only exactly '1' works). Confirm the privacy note. | When the engine crashes, save its last messages to ~/Library/Logs/Splash/crash/ for a bug report (newest 4 files, 64 MiB at most). Traces can contain your conversation text; review before sharing. | yes | 1.0 |
| env `HF_HOME` | Hugging Face home folder | directory-picker | ~/.cache/huggingface | — | — | Writable folder. HF_HUB_CACHE, when set, wins for downloads. | Moves the whole Hugging Face folder: downloads and the saved login. Prefer 'Model download folder' unless you need this. | no | 1.0 |
| env `HF_ENDPOINT` | Hugging Face endpoint | text | https://huggingface.co | — | — | http(s) URL. | Use a Hugging Face mirror or proxy for downloads and the catalog refresh. | no | 1.0 |
| env `HF_HUB_DOWNLOAD_TIMEOUT` | Download timeout | number | 10 | ≥ 1 | seconds | Integer seconds &gt;= 1 (read by the bundled huggingface_hub 1.28). | Network timeout for model downloads. Raise it on slow or flaky connections. Splash's own update check at start always uses 5 s. | no | 1.2.0 |
| env `HF_HUB_ETAG_TIMEOUT` | Metadata timeout | number | 10 | ≥ 1 | seconds | Integer seconds &gt;= 1. | Timeout for the Hub's file-metadata requests during downloads. | no | 1.2.0 |
| env `HF_HUB_DISABLE_XET` | Disable Xet transfers | toggle | off | — | — | Sets HF_HUB_DISABLE_XET=1. | Download with plain HTTP instead of the Xet transfer backend. Try it if downloads stall. | no | 1.2.0 |
| env `HF_XET_HIGH_PERFORMANCE` | High-performance downloads | toggle | off | — | — | Sets HF_XET_HIGH_PERFORMANCE=1. | Let the Xet backend use more connections and memory for faster downloads. | no | 1.2.0 |
| env `HTTPS_PROXY` | HTTPS proxy | text | unset | — | — | URL. When set, Splashboard also sets NO_PROXY for loopback. | Proxy for downloads and the catalog refresh. Splashboard inherits the system or shell value by default. HTTP_PROXY and ALL_PROXY are honoured the same way. | no | 1.0 |
| env `NO_PROXY` | Bypass proxy for | text | unset | — | — | Comma list; Splashboard keeps 127.0.0.1 and localhost in it. | Hosts that skip the proxy. Must include 127.0.0.1 and localhost, or agent launchers may not find the local server ('No ready Splash server'). | no | 1.0 |
| env `HF_HUB_DISABLE_PROGRESS_BARS` | (internal) Disable download progress bars | internal | off | — | — | Always 1 on Splashboard-spawned installs. | Set by Splashboard on download child processes so stderr is not flooded with tqdm redraws; progress is computed from file sizes instead. Not shown in the form. | no | 1.0 |

- `NO_PROXY`: Unset by default. Splashboard fills in 127.0.0.1,localhost automatically whenever a proxy variable is set.
- `HF_HUB_DISABLE_PROGRESS_BARS`: Unset by default (bars shown). Splashboard always sets 1 on the download children it spawns.

### 3.9 Cross-field rules

| Rule | When Splash checks it | Splash's message | UI behaviour |
| --- | --- | --- | --- |
| Announce first alias needs at least one alias | parse (exit 2) | --announce-served-name needs --served-model-name | Toggle disabled until the alias list is non-empty. |
| Keep SSD cache across restarts needs an SSD cache size &gt; 0 | parse (exit 2) | --persistent-cache needs --max-cache-disk | Toggle disabled while size is 0. |
| Persistent cache folder needs the persistent cache | parse (exit 2) | --cache-dir needs --persistent-cache | Folder picker hidden until the toggle is on; send only if not the default. |
| No arguments after `--` for serve | parse (exit 2) | arguments after -- are only supported for coding clients | Free-form 'Additional flags' field rejects `--`. |
| Legacy incoai/*-Splash packages take no :VARIANT, revision, draft or text only | install (exit 1) | this runtime package has no variants; drop the :VARIANT suffix / source selection options require an upstream model ID | Disable those controls when the model is a legacy package. |
| A multi-GGUF repo needs a :VARIANT | install (exit 1) | select a GGUF with OWNER/REPO:VARIANT (files in the repository root: ...) | Variant dropdown required for GGUF repos with several root files. |
| Context must fit the memory budget | engine startup (exit 1) | --max-context N exceeds the M tokens ... | Slider capped at the last measured automatic value (3.10). |
| '*' origin without an API key | startup warning only | Warning · --allowed-origin '*' without --api-key ... | Inline warning; suggest generating a key. |
| Non-loopback host without an API key | not checked by Splash | — | Inline warning (docs pair --host 0.0.0.0 with --api-key). |
| Max image size has no effect when text only | not checked | — | Hide the slider when Text only is on. |
| Revision, draft and text only create separate installations | install | — | Show 'Changing this re-assembles the model (no re-download of unchanged files)'. |

### 3.10 Capacity rules the form must design around

- **GPU memory limit (`--max-memory`).** Splash's automatic budget is `recommendedMaxWorkingSetSize − max(1 GiB, 2%)` (`runtime/engine/MemoryPlan.hpp`), and a larger user value is silently clamped to it. Read `MTLDevice.recommendedMaxWorkingSetSize` from Rust (objc2-metal) and use it as the slider maximum; fall back to physical RAM with a warning band above ~75%. On top of that the engine keeps min(RAM/10, 2 GiB) free for macOS and grows caches only while 1 GiB more is free.
- **Context length (`--max-context`).** The real ceiling depends on the model, revision, draft, text only, memory limit, KV precision and SSD tier, and is only known after a start: an explicit value above it fails startup. Rule: start with Auto, record `maximum_context_tokens` (from `/status`, `/v1/models` `context_length`, or the `Ready · ... context NK` line) keyed by that tuple, and cap the slider there. Changing any part of the tuple resets the cap to 'unknown, use Auto'. Show a hint when the measured value is under 100K and a coding agent is configured.
- **SSD cache size (`--max-cache-disk`).** Bound by free space on the cache volume; below one state (109 MiB for the 35B, 187 MiB for the 27B) the tier silently disables. Show the SSD-wear note (~50 GB/hour on a busy 24 GB Mac).
- **Idle weight release.** After 600 s without a generation request 1.2.0 frees the weights and the next request reloads them (not configurable). See splash-api.md 4.5 for the UI state.

### 3.11 Version gates at a glance

| Splash | `splash serve` flags first accepted |
| --- | --- |
| 1.0 | `--model`, `--allowed-host`, `--no-webui`, `--max-memory`, `--max-context`, `--max-image-pixels`, `--api-key` |
| 1.0.1 | `--port`, `--max-request-size` |
| 1.0.2 | `--host`, `--served-model-name`, `--default-reasoning-effort` |
| 1.1.0 | `--revision`, `--draft-model`, `--language-only`, `--kv-format`, `--max-cache-disk` |
| 1.2.0 | `--offline`, `--announce-served-name`, `--persistent-cache`, `--cache-dir`, `--decode-share`, `--queue-size`, `--request-timeout`, `--allowed-origin` |

Also: `splash pi` from 1.1.0; `--request-timeout` and `--queue-size` existed only on the internal server before 1.2.0 (fixed 1800 s and 32 through `splash serve`); `--max-new-tokens` (server-only, default 32768) was removed in 1.2.0. Verified by reading `install/launcher.py` at every tag.

### 3.12 Environment variables not in the form

| Variable | Why not |
| --- | --- |
| SPLASH_WEIGHT_CACHE | Obsolete. 1.1.0 kept prepared weights in ~/Library/Caches/Splash/weights or here; 1.2.0 reads neither. Offer a cleanup instead. |
| TRANSFORMERS_OFFLINE | Same effect as HF_HUB_OFFLINE; covered by the Offline toggle. |
| PYTHONUNBUFFERED, TRANSFORMERS_VERBOSITY, PYTHONPATH, PYTHONDONTWRITEBYTECODE | Set by the launcher or the brew wrapper. Never set them yourself. |
| HF_TOKEN_PATH | Where the saved hf login lives (default ~/.cache/huggingface/token). Splashboard writes the token there only when the user picks 'Save as hf login'. |
| HF_HUB_DISABLE_TELEMETRY, HF_HUB_DISABLE_IMPLICIT_TOKEN, HF_HUB_DISABLE_UPDATE_CHECK, HF_DEBUG, HF_XET_CACHE | huggingface_hub knobs with no user-visible effect for Splash; not exposed. |

## 4. Recommended presets by Mac RAM

Evidence levels: *measured* (Splash's own docs), *documented* (README guidance), *observed* (a real user's working configuration in an issue; observations, not recommendations), *inferred* (no direct evidence). Presets leave every other field at its default; `max_memory` stays Auto unless the evidence is a deliberate cap. The 'Observed' column lists real flags people used, including `--max-memory` values that are not part of the preset.

| RAM | Preset id | Label | Serve settings | Evidence | Observed in the wild | Alternatives | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 GB | `ram24-agent-27b` | 24 GB: coding agents (27B, text only) | model=unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS, language_only=true | measured | — | — | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs` |
| 24 GB | `ram24-fast-35b` | 24 GB: fastest (35B-A3B, 256K) | model=unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q2_K_XL | measured | #220: a 24 GB M4 Pro served the 35B-A3B for ~12 h with --max-memory 16G | — | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs`, [#220](https://github.com/incoai/splash/issues/220) |
| 24 GB | `ram24-small-vision` | 24 GB: smallest with vision (Bonsai PQ2_0) | model=prism-ml/Ternary-Bonsai-2-27B-gguf:PQ2_0 | documented | — | — | `splash-src/README.md#models`, [#166](https://github.com/incoai/splash/pull/166) |
| 32 GB | `ram32-inferred` | 32 GB: 27B low-bit with vision | model=unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS | inferred | — | unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q2_K_XL | `inferred from splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs and the 36 GB minimum in splash-src/README.md#quick-start` |
| 36 GB | `ram36-27b` | 36 GB: 27B 4-bit (minimum for 4-bit) | model=unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M | documented+observed | #90: 36 GB M5 Max ran `splash serve --max-context 131072 --no-webui` (1.0.1); #10: 36 GB M3 Max served both incoai packages behind llama-swap | mlx-community/Qwen3.8-27B-4bit, incoai/Qwen3.8-27B-Splash, unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M | `splash-src/README.md#quick-start`, [#90](https://github.com/incoai/splash/issues/90), [#10](https://github.com/incoai/splash/issues/10) |
| 48 GB | `ram48-27b` | 48 GB: 27B 4-bit (recommended) | model=unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M | documented+observed | #90 (comment): 48 GB M4 Pro ran incoai/Qwen3.8-27B-Splash with --max-memory 40G | unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M, mlx-community/Qwen3.6-35B-A3B-4bit | `splash-src/README.md#quick-start`, `splash-src/docs/performance.md`, [#90](https://github.com/incoai/splash/issues/90) |
| 64 GB | `ram64-agent` | 64 GB: 27B + persistent SSD cache for agents | model=unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M, max_cache_disk=32G, persistent_cache=true | observed | #177: 64 GB M5 Pro, --max-memory 46G --max-cache-disk 32G; maintainer recipe --persistent-cache --max-cache-disk 32G; docs/splash-api.md capture: 64 GB M3 Max, incoai/Qwen3.8-27B-Splash, auto context 256K | incoai/Qwen3.8-27B-Splash | [#177](https://github.com/incoai/splash/issues/177), `docs/splash-api.md#42-startup-phases-observed-with---offline-and-the-model-cached` |
| 96 GB | `ram96-quality` | 96 GB: 27B Q8_0 + BF16 KV, 256K | model=unsloth/Qwen3.8-27B-GGUF:Q8_0, kv_format=bf16, max_context=256K, max_cache_disk=40G | observed | #220: 96 GB M5 Ultra, --kv-format bf16 --max-memory 48G --max-context 256K --max-cache-disk 40G; #96: 96 GB M3 Ultra, incoai/Qwen3.8-27B-Splash with --max-memory 30G | unsloth/Qwen3.8-27B-GGUF:UD-Q6_K_XL | [#220](https://github.com/incoai/splash/issues/220), [#96](https://github.com/incoai/splash/issues/96) |
| 128 GB | `ram128-longctx` | 128 GB: 27B UD-Q4_K_XL, 256K, 64G cap | model=unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL, max_memory=64G, max_context=256K | observed | #220: 128 GB M5 Max, UD-Q4_K_XL --max-memory 64G --max-context 220-256K (1.1.0); #41: 128 GB M5 Max with --max-memory 28G and 64G | unsloth/Qwen3.8-27B-GGUF:Q8_0 with kv_format bf16 | [#220](https://github.com/incoai/splash/issues/220), [#41](https://github.com/incoai/splash/issues/41) |

RAM tiers between rows (for example 18 GB or 192 GB) pick the nearest lower preset. Macs under 24 GB are not supported by Splash's docs (#236 asks for a clear answer); the compatibility check says so. 96 GB and 128 GB rows reflect long-context agent use; the 35B-A3B UD-Q4_K_M is the faster alternative on any Mac with 36 GB or more (175-210 tok/s on M5 Pro / M3 Max, README).

## 5. Per-request chat parameters

For `POST /v1/chat/completions`, which the Chat screen uses. Request changes never need a restart. Only send fields the user changed from the default (Splash's defaults are Qwen's, not OpenAI's). Response handling is in splash-api.md sections 5-6.

| Field | Label | Group | UI control | Default | Range / choices | Validation | Help text | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages[role=system]` | System prompt | Prompt & model | textarea | unset | — | Optional text. The conversation must still contain a user message. | Instructions placed before the conversation. Sent as the first message with role 'system' (a 'developer' message is merged into it). Later system messages render in place when the template supports it. | 1.0 |
| `model` | Model name | Prompt & model | select | &lt;loaded model ID&gt; | — | Optional; must be a name /v1/models lists. | Which of the server's names to send. Only the loaded model and its aliases are accepted. | 1.0 |
| `temperature` | Temperature | Sampling | slider | 1.0 | 0 – 2 | 0-2. A nonzero value below 0.01 is raised to 0.01. | Randomness. 0 always picks the most likely token; higher is more varied. The default 1.0 follows Qwen's recommendation for thinking mode. | 1.0 |
| `top_p` | Top P | Sampling | slider | 0.95 | &gt; 0, ≤ 1 | Greater than 0, at most 1. | Consider only the most likely tokens whose probabilities add up to this share. | 1.0 |
| `top_k` | Top K | Sampling | number | 20 | ≥ -1 | Integer &gt;= -1; 0 and -1 disable it (1.2.0+; earlier versions need &gt;= 1). | Consider only this many most likely tokens. 0 or -1 turns the limit off. | 1.0 |
| `min_p` | Min P | Sampling | slider | 0.0 | 0 – 1 | 0-1. Before 1.2.0 a nonzero value gives 400. | Drop tokens whose probability is below this fraction of the most likely token's. | 1.2.0 |
| `seed` | Seed | Sampling | number+random | unset | 0 – 18446744073709551615 | Empty (random) or 0 to 2^64-1. Send as a JSON integer, not a float. | Fixes the random choices so a reply can repeat. Repeats only when the request runs alone with the same cached prefixes, on the same Splash version. | 1.0 |
| `presence_penalty` | Presence penalty | Penalties | slider | 0.0 | -2 – 2 | -2 to 2. Before 1.2.0 a nonzero value gives 400. | Discourages reusing any token that already appeared. Qwen recommends 1.5 when thinking is off. | 1.2.0 |
| `frequency_penalty` | Frequency penalty | Penalties | slider | 0.0 | -2 – 2 | -2 to 2. Before 1.2.0 a nonzero value gives 400. | Discourages tokens in proportion to how often they already appeared. | 1.2.0 |
| `repetition_penalty` | Repetition penalty | Penalties | slider | 1.0 | &gt; 0, ≤ 2 | Positive number (UI 0.01-2). Silently ignored before 1.2.0. | Multiplicative penalty on repeated tokens. 1.0 is off; above 1 discourages repeats. | 1.2.0 |
| `max_completion_tokens` | Max reply length | Length & stopping | number+auto | unset | ≥ 1; max computed at runtime | Integer &gt;= 1, at most the context the prompt leaves. | Most tokens the reply (thinking included) may use. Empty lets it use the rest of the context. Splashboard always sends a value so a runaway reply cannot fill the context. | 1.0 |
| `stop` | Stop sequences | Length & stopping | multi-value-list | none | 0 – 4 | 1-4 non-empty strings. Not with callable tools or a response format. | Stop the reply when any of these texts appears. Up to four. | 1.0 |
| `ignore_eos` | Ignore end of text | Length & stopping | toggle | off | — | Boolean. Not with tools or a response format. Silently dropped before 1.2.0. | Keep generating to the length limit even when the model would stop. For benchmarks only. | 1.2.0 |
| `reasoning_effort` | Thinking | Reasoning | select | unset | unset / none / minimal / low / medium / high / xhigh / max | One of seven names or unset. Show Off/Low/Medium/High(xhigh) for the 27B, On/Off for the 35B. | How much the model thinks before answering. 'Off' skips thinking. Unset uses the server default, then the model's own (xhigh for Qwen3.8-27B). | 1.0 |
| `chat_template_kwargs.enable_thinking` | Force thinking on/off | Reasoning | tri-state | unset | — | Unset, true or false. Wins over reasoning_effort. | Advanced override passed straight to the chat template. It wins over Thinking. Prefer the Thinking control; do not send both. | 1.2.0 |
| `chat_template_kwargs` | Template variables (JSON) | Reasoning | json-editor | unset | — | JSON object; must not set reserved keys (tools, messages, ...). | Extra variables for the model's chat template, as vLLM and SGLang accept them. | 1.2.0 |
| `preserve_thinking` | Keep earlier thinking | Reasoning | tri-state | unset | — | Unset, true or false. | Keep previous turns' reasoning in the prompt instead of dropping it. Unset follows the template. | 1.0 |
| `response_format` | Response format | Structured output & tools | select+json-schema-editor | {"type": "text"} | text / json_object / json_schema | text, json_object, or json_schema with json_schema.schema. No remote $ref. | Force the reply to be JSON, optionally matching a JSON Schema. The constraint is enforced while generating; it adds nothing to the prompt, so also describe the format in your instructions. | 1.0 |
| `tools` | Tools | Structured output & tools | tool-list-editor | unset | — | type function only; names [A-Za-z0-9_-]{1,128}, unique. | Functions the model may call, each with a JSON Schema for its arguments. Arguments are enforced while generating. Hosted web search is not available. | 1.0 |
| `tool_choice` | Tool choice | Structured output & tools | select | auto | auto / none / required / {"type": "function", "function": {"name": "&lt;name&gt;"}} | auto, none, required, or a named function present in tools. | Whether and which tool the model must call. | 1.0 |
| `parallel_tool_calls` | Parallel tool calls | Structured output & tools | toggle | on | — | Boolean. Forced off for a named tool_choice. | Allow several tool calls in one reply. | 1.0 |
| `messages[].content[type=image_url]` | Images | Attachments | file-attach | unset | 0 – 64 | JPEG/PNG/WEBP/GIF as data: URLs, 32 MiB each, 64 per request; vision only. | Attach pictures. Splashboard encodes them as base64 data: URLs; web links are not fetched. Needs a model with vision (not text-only). | 1.0 |
| `messages[].content[type=file]` | PDFs | Attachments | file-attach | unset | 0 – 64 | application/pdf base64, 64 MiB and 64 pages per request in total; vision only. | Attach PDFs inline (base64). Pages are rendered to text and images, so this needs vision. | 1.0 |
| `stream` | Stream reply | Streaming & scheduling | internal | off | — | UI always sends true. | Splashboard always streams (true) so text appears as it is generated. | 1.0 |
| `stream_options.include_usage` | Include usage | Streaming & scheduling | internal | off | — | UI always sends true. | Adds token counts at the end of a stream. Splashboard always sends true. | 1.0 |
| `return_progress` | Prompt progress | Streaming & scheduling | internal | off | — | Streaming only. UI always sends true. | Streams prompt-reading progress so the UI can show a bar for long prompts. | 1.0 |
| `priority` | Priority | Streaming & scheduling | segmented | normal | foreground / normal / background | foreground, normal or background. | Higher priority can pause lower-priority requests and skip their waits. Use Background for batch jobs so interactive chats stay fast. | 1.0.2 |
| `timeout` | Time limit | Streaming & scheduling | number+none | unset | &gt; 0 | Empty or seconds &gt; 0; min(this, --request-timeout) applies. | Give up after this many seconds (504). Can only be shorter than the server's limit. | 1.0 |

### 5.1 Reasoning control per model

- **Qwen3.8-27B** is a dial. Its template accepts `low`, `medium`, `xhigh` and off (`none`); Splash renders `high` and `max` as `xhigh` and `minimal` as `low`. Show **Off / Low / Medium / High** and send `none` / `low` / `medium` / `xhigh`. The template default is `xhigh`.
- **Qwen3.6-35B-A3B** is a switch. Show **On / Off**: Off sends `none`, On sends nothing (template default).
- Thinking adds about 40 prompt tokens. Do not send `chat_template_kwargs.enable_thinking` together with `reasoning_effort`: the kwarg silently wins.

### 5.2 Same controls on the other endpoints

| Chat Completions field | Responses API | Anthropic Messages |
| --- | --- | --- |
| `messages[role=system]` | instructions | system |
| `model` | model | model (required) |
| `temperature` | temperature | temperature |
| `top_p` | top_p | top_p |
| `top_k` | top_k | top_k |
| `min_p` | min_p | — |
| `seed` | seed | seed |
| `presence_penalty` | presence_penalty | — |
| `frequency_penalty` | frequency_penalty | — |
| `repetition_penalty` | repetition_penalty | — |
| `max_completion_tokens` | max_output_tokens | max_tokens (required; clamped to the context) |
| `stop` | stop | stop_sequences |
| `ignore_eos` | — | — |
| `reasoning_effort` | reasoning.effort | thinking.type + output_config.effort (low\|medium\|high\|xhigh\|max, default high); off when thinking is omitted |
| `chat_template_kwargs.enable_thinking` | — | — |
| `chat_template_kwargs` | — | — |
| `preserve_thinking` | — | context_management.edits clear_thinking keep:all |
| `response_format` | text.format | output_config.format / output_format (json_schema) |
| `tools` | tools | tools (custom) |
| `tool_choice` | tool_choice | tool_choice |
| `parallel_tool_calls` | parallel_tool_calls | tool_choice.disable_parallel_tool_use |
| `messages[].content[type=image_url]` | input_image | image (base64 source) |
| `messages[].content[type=file]` | input_file | document (base64 application/pdf) |
| `stream` | stream | stream |
| `stream_options.include_usage` | — | — |
| `return_progress` | return_progress | return_progress |
| `priority` | priority | priority |
| `timeout` | timeout | timeout |

### 5.3 Fields not to offer

| Field | Why |
| --- | --- |
| n | Must be 1 (or null); anything else gives 400 'n and logprobs are not currently supported'. |
| logprobs / top_logprobs | Only false or null. Do not offer. |
| logit_bias | Only null or {}; a non-empty map gives 400 'logit_bias is not supported'. |
| image URLs over http(s) | 400 'only data: image URLs are supported'. Encode files client-side. |
| audio / video parts | input_audio, video and video_url give 400. |
| hosted web search | Not provided. Agents get it disabled (claude --disallowedTools WebSearch, codex web_search=disabled). |
| max_new_tokens (server flag) | Removed in 1.2.0; set max_tokens per request instead. |

## 6. Common recipes → one-click presets and guided flows

Recipes people run in the terminal (README, docs, issues, community tools), each turned into a Splashboard flow. Recipe presets are in `presets[]` with `kind: "recipe"` or `"sampling"`.

| Recipe | Splashboard flow | Surface / preset | Sources |
| --- | --- | --- | --- |
| Quick start | One 'Get started' flow: compatibility check, install Splash, pick a model that fits, download with progress, start, open chat. | Onboarding wizard | `splash-src/README.md#quick-start`, [#69](https://github.com/incoai/splash/issues/69), [#90](https://github.com/incoai/splash/issues/90) |
| Pick flags for my Mac's RAM | Wizard keyed on detected RAM proposes a RAM preset (section 4) and shows the measured context after the first start. | Guided flow + presets ram24-* .. ram128-* | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs`, `splash-src/README.md#quick-start`, [#209](https://github.com/incoai/splash/pull/209), [#220](https://github.com/incoai/splash/issues/220) |
| Coding agent on a 24 GB Mac | 27B UD-IQ3_XXS with Text only for ~100K context, then launch the agent. | Preset ram24-agent-27b + Connect | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs` |
| Agent on another port or with a key | Handled automatically: agents inherit the selected server's port and key. | Connect cards | `splash-src/DEVELOPMENT.md#server-configuration`, [#140](https://github.com/incoai/splash/issues/140), [github.com/hometrix/SplashMonitor](https://github.com/hometrix/SplashMonitor) |
| Share a Mac mini/Studio on the LAN | 'Share on my network' toggle: 0.0.0.0, generated key, .local name, copyable URL. | Preset recipe-lan-share | [#27](https://github.com/incoai/splash/issues/27), [#142](https://github.com/incoai/splash/issues/142), [#177](https://github.com/incoai/splash/issues/177) |
| Open WebUI front end | Copy card plus preset (LAN, key, chat page off) and the maintainer's checklist. | Preset recipe-open-webui + client card | [#214](https://github.com/incoai/splash/issues/214) |
| Jan or another Tauri app | Adds tauri://localhost to allowed origins. | Preset recipe-webview-app + client card | [#232](https://github.com/incoai/splash/issues/232) |
| Apps with hard-coded model names | Alias list editor seeded with the names the app sends; Announce toggle. | Preset recipe-fixed-model-names | [github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift](https://github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift), [#81](https://github.com/incoai/splash/issues/81) |
| Generic OpenAI/Anthropic client | Copy base URL, key and model ID; context from /v1/models. | Client card openai-compatible / anthropic-compatible | `splash-src/README.md#use-the-api`, [#72](https://github.com/incoai/splash/issues/72), [#118](https://github.com/incoai/splash/issues/118) |
| Run in the background / at login | Keep-running and login toggles, menu bar status, graceful stop with escalation. | App settings | [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard), [github.com/davehardy20/pi-splash-provider](https://github.com/davehardy20/pi-splash-provider), [#185](https://github.com/incoai/splash/issues/185) |
| Keep the Mac awake for long runs | 'Prevent sleep while serving' on by default. | App setting prevent_sleep | [#41](https://github.com/incoai/splash/issues/41), [#275](https://github.com/incoai/splash/issues/275), [#291](https://github.com/incoai/splash/pull/291) |
| Keep a long agent prompt warm | Persistent SSD cache preset; cache hit rate on the dashboard. | Preset recipe-warm-prompt | [#177](https://github.com/incoai/splash/issues/177) |
| Benchmark my Mac | Benchmark tab with fixed workloads and a power-source check. | Benchmark tab + preset sampling-benchmark | [#37](https://github.com/incoai/splash/issues/37), [#131](https://github.com/incoai/splash/issues/131), [#176](https://github.com/incoai/splash/issues/176), [#205](https://github.com/incoai/splash/issues/205), [gist.github.com/Paul-Kyle/984146e2e61ceb1ccb0f28ae5c1bcc5c](https://gist.github.com/Paul-Kyle/984146e2e61ceb1ccb0f28ae5c1bcc5c), [gist.github.com/alvarorsouza-arch/d0c3a879b4ae3cb6ee96053fc3306e22](https://gist.github.com/alvarorsouza-arch/d0c3a879b4ae3cb6ee96053fc3306e22) |
| Models on an external disk | Folder picker sets HF_HUB_CACHE; mount check before start. | Preset recipe-external-disk | [#5](https://github.com/incoai/splash/issues/5) |
| Air-gapped start | Offline toggle; auto-offered when the Hub is unreachable. | Preset recipe-offline | [#263](https://github.com/incoai/splash/issues/263) |
| Switch models | Title-bar switcher restarts with that model's saved profile. | Model switcher + named profiles | [#212](https://github.com/incoai/splash/pull/212), [note.com/ai_driven/n/nca9a2e866982?hl=en](https://note.com/ai_driven/n/nca9a2e866982?hl=en), [github.com/flyingnobita/llml](https://github.com/flyingnobita/llml) |
| Several models at once | Servers list with per-server ports and a combined memory warning. | Engine &gt; Servers | [#10](https://github.com/incoai/splash/issues/10), [#112](https://github.com/incoai/splash/issues/112), [#212](https://github.com/incoai/splash/pull/212) |
| Diagnose a crash | Crash banner, restart button, crash-trace toggle, bug-report bundle. | Diagnostics | [#41](https://github.com/incoai/splash/issues/41), [#220](https://github.com/incoai/splash/issues/220), [#96](https://github.com/incoai/splash/issues/96) |
| Install a model ahead of time | Download button runs the bundled installer with progress. | Models &gt; Download | [#256](https://github.com/incoai/splash/issues/256), [#73](https://github.com/incoai/splash/issues/73), [github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift](https://github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift) |
| Sampling presets | Thinking / Instruct / Greedy / Benchmark buttons above the sampling controls. | Presets sampling-* | [#204](https://github.com/incoai/splash/issues/204), [#86](https://github.com/incoai/splash/issues/86), [#176](https://github.com/incoai/splash/issues/176), [#205](https://github.com/incoai/splash/issues/205) |
| Per-model reasoning control | Off/Low/Medium/High for Qwen3.8-27B, On/Off for Qwen3.6-35B-A3B. | Chat &gt; Thinking control | [#123](https://github.com/incoai/splash/issues/123), [#125](https://github.com/incoai/splash/issues/125), [huggingface.co/incoai/Qwen3.8-27B-Splash](https://huggingface.co/incoai/Qwen3.8-27B-Splash), [huggingface.co/incoai/Qwen3.6-35B-A3B-Splash](https://huggingface.co/incoai/Qwen3.6-35B-A3B-Splash) |

| Preset id | Kind | Label | Settings | Min Splash | Source |
| --- | --- | --- | --- | --- | --- |
| `recipe-lan-share` | recipe | Share on my network | serve: host=0.0.0.0, api_key=&lt;generate&gt;, allowed_host=["&lt;LocalHostName&gt;.local"] | — | `splash-src/DEVELOPMENT.md#server-configuration`, [#27](https://github.com/incoai/splash/issues/27), [#142](https://github.com/incoai/splash/issues/142) |
| `recipe-open-webui` | recipe | Back end for Open WebUI | serve: host=0.0.0.0, api_key=&lt;generate&gt;, no_webui=true | — | [#214](https://github.com/incoai/splash/issues/214) |
| `recipe-webview-app` | recipe | Allow Jan / Tauri apps | serve: allowed_origin=["tauri://localhost"] | — | [#232](https://github.com/incoai/splash/issues/232), `splash-src/DEVELOPMENT.md#server-configuration` |
| `recipe-warm-prompt` | recipe | Keep long agent prompts warm | serve: max_cache_disk=32G, persistent_cache=true | — | [#177](https://github.com/incoai/splash/issues/177), `splash-src/DEVELOPMENT.md#persistent-cache` |
| `recipe-offline` | recipe | Offline / air-gapped start | serve: offline=true | — | [#263](https://github.com/incoai/splash/issues/263), `splash-src/DEVELOPMENT.md#revisions` |
| `recipe-fixed-model-names` | recipe | Answer to fixed model names (Claude Desktop-style apps) | serve: served_model_name=["claude-sonnet-4-5", "claude-opus-4-7", "claude-haiku-4-5"], announce_served_name=false | — | [github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift](https://github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift), `splash-src/DEVELOPMENT.md#api-model-aliases` |
| `recipe-external-disk` | recipe | Store models on an external disk | serve: hf_hub_cache=&lt;chosen folder&gt; | — | [#5](https://github.com/incoai/splash/issues/5), `splash-src/DEVELOPMENT.md#model-cache` |
| `sampling-thinking` | sampling | Thinking (Qwen recommended) | request: temperature=1.0, top_p=0.95, top_k=20, min_p=0.0, presence_penalty=0.0, repetition_penalty=1.0 | — | [#204](https://github.com/incoai/splash/issues/204), `splash-src/server/frontend.py` |
| `sampling-instruct` | sampling | Instruct (thinking off) | request: reasoning_effort="none", temperature=0.7, top_p=0.8, top_k=20, min_p=0.0, presence_penalty=1.5, repetition_penalty=1.0 | 1.2.0 | [#204](https://github.com/incoai/splash/issues/204), `splash-src/DEVELOPMENT.md` |
| `sampling-greedy` | sampling | Deterministic (greedy) | request: temperature=0, seed=1 | — | [#176](https://github.com/incoai/splash/issues/176) |
| `sampling-benchmark` | sampling | Benchmark: fixed length | request: temperature=0, reasoning_effort="none", ignore_eos=true, max_tokens=1024 | 1.2.0 | [#205](https://github.com/incoai/splash/issues/205) |

## 7. Coding agents

All five `splash <agent>` subcommands share one flow: check the agent binary is on PATH, `GET http://127.0.0.1:<SPLASH_PORT|8000>/v1/models` (2 s, Bearer `SPLASH_API_KEY` if set), require `data[0].owned_by == "splash"` and an int `context_length`, configure the agent for that model and context, print `Starting <agent>: <model> · <ctx> context tokens`, then exec the agent's interactive program. Client subcommands have no flags of their own; the port comes only from `SPLASH_PORT`.

| Agent | Command | What it does | Needs terminal | Writes files | Extra env options | Captured one-shot | Undo | Min Splash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `splash claude [ARGS...]` | env + argv, then exec: `claude --disallowedTools WebSearch --model <model> --permission-mode default <ARGS>` with ANTHROPIC_BASE_URL=http://127.0.0.1:&lt;port&gt;, ANTHROPIC_AUTH_TOKEN=&lt;key\|local&gt;, ANTHROPIC_MODEL and ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL and ANTHROPIC_SMALL_FAST_MODEL=&lt;model&gt;, CLAUDE_CODE_MAX_CONTEXT_TOKENS and CLAUDE_CODE_AUTO_COMPACT_WINDOW=&lt;context&gt;, CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY=0; ANTHROPIC_API_KEY removed | yes | no | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (number): Raise Claude Code's own per-reply output limit; Splash does not set it. | `splash claude --print --output-format stream-json --verbose` (prompt on stdin) | nothing to undo | 1.0 |
| OpenCode | `splash opencode [ARGS...]` | env OPENCODE_CONFIG_CONTENT (merged into any existing JSON object): provider 'splash' (@ai-sdk/openai-compatible, baseURL http://127.0.0.1:&lt;port&gt;/v1), model and small_model and agents build/plan/general/explore/title/compaction = splash/&lt;model&gt;, reasoning variants none..xhigh, limit {context, input, output=min(32768, ctx/4)}; adds --standalone for OpenCode 2+ unless --standalone/--server given | yes | no | `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` (number): OpenCode caps output at 32,000 tokens unless this raises it.; `OPENCODE_CONFIG_CONTENT` (json-editor): Extra OpenCode config (JSON object) that Splash merges its provider into. | `splash opencode run --format json` (prompt on stdin) | nothing to undo | 1.0 (auto --standalone for OpenCode 2: 1.1.0) |
| Codex | `splash codex [ARGS...]` | argv -c overrides at the root level: model, web_search=disabled, model_provider=splash, model_providers.splash={base_url=http://127.0.0.1:&lt;port&gt;/v1, env_key=SPLASH_API_KEY, wire_api=responses}, model_context_window=&lt;ctx&gt;, model_auto_compact_token_limit=&lt;ctx*0.9&gt;; env SPLASH_API_KEY=&lt;key\|local&gt;; the user's own -c overrides follow in order | yes | no | — | `splash codex exec --json -` (prompt on stdin) | nothing to undo | 1.0 |
| Hermes | `splash hermes [ARGS...]` | creates profile with `hermes profile create splash[-<port>] --no-alias` on first use, atomically rewrites &lt;root&gt;/profiles/splash[-&lt;port&gt;]/config.yaml model.{default, provider custom, base_url, api_key, api_mode chat_completions, supports_vision, context_length, max_tokens}; exec `hermes --provider custom --model <model> <ARGS>` with HERMES_HOME=&lt;profile&gt;, CUSTOM_BASE_URL, OPENAI_BASE_URL, OPENAI_API_KEY | yes | ~/.hermes/profiles/splash[-&lt;port&gt;]/config.yaml (API key in plain text) | `HERMES_HOME` (directory-picker): Hermes root (default ~/.hermes); the profile goes under &lt;root&gt;/profiles/. | `splash hermes chat --oneshot --query-file -` (prompt on stdin) | hermes profile delete splash[-&lt;port&gt;] (whether it prompts is unverified: hermes was not installed here), or delete the profile folder | 1.0 (profile under ~/.hermes: 1.2.0) |
| Pi | `splash pi [ARGS...]` | atomically rewrites &lt;PI_CODING_AGENT_DIR or ~/.pi/agent&gt;/models.json (following symlinks), setting providers['splash' or 'splash-&lt;port&gt;'] = {baseUrl, api openai-completions, apiKey '$SPLASH_API_KEY' or 'local', models [{id, reasoning, thinkingLevelMap {off: none}, input, contextWindow, maxTokens 32768}]}; exec `pi --provider <name> --model <model> <ARGS>` | yes | ~/.pi/agent/models.json (provider splash or splash-&lt;port&gt;; other providers kept) | `PI_CODING_AGENT_DIR` (directory-picker): Pi's agent folder (default ~/.pi/agent). | `splash pi --print --mode json` (prompt on stdin) | remove providers.splash (or splash-&lt;port&gt;) from models.json | 1.1.0 |

### 7.1 Embedded terminal design

- Rust: `portable-pty` spawns `splash <agent> ARGS` in a PTY sized to the pane; bytes stream to the webview over a Tauri channel; keystrokes and resizes come back. Frontend: `@xterm/xterm` with the fit and web-links addons.
- Environment: the login-shell PATH, `SPLASH_PORT` and `SPLASH_API_KEY` of the selected server, `NO_PROXY` when a proxy is set, `TERM=xterm-256color`, and the card's env options. Working directory: a project folder the user picks per launch (agents act on the current directory).
- Before launch the card checks: binary found, server Ready on that port, key matches (a 401 from `/v1/models` means 'Splash authentication failed'), and for Hermes and Pi a one-time confirmation of the files they write.
- Tabs: several agent sessions at once. On exit show the exit code and 'Relaunch'. Closing a tab sends SIGHUP to the PTY's process group after a confirm if the agent is still running.
- 'Open in Terminal.app' builds the same command line with the env exported inline and runs it through `osascript`. Never put the API key on that command line: export it from a temporary file readable only by the user, deleted after launch.
- Rebuilding the agent's env/argv in Rust (instead of running `splash <agent>`) is possible for claude, opencode and codex, which only set env and argv; keep `splash <agent>` as the default so behaviour tracks Splash upgrades.

### 7.2 Other apps (copy-config cards)

| App | Base URL | API key | Model | Server settings it needs | Steps / notes | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Any OpenAI-compatible app (Cursor, Cline, Continue, SDKs) | `http://127.0.0.1:<port>/v1` | &lt;key or any text, e.g. local&gt; | &lt;model ID or alias&gt; | none | Context limit: /v1/models context_length. Use the LAN IP + key from other machines. | `splash-src/README.md#use-the-api`, [#72](https://github.com/incoai/splash/issues/72), [#118](https://github.com/incoai/splash/issues/118) |
| Anthropic-compatible apps and SDKs | `http://127.0.0.1:<port>` | &lt;key or local&gt; | &lt;model ID or alias&gt; | served_model_name=names the app hard-codes, if any | Messages API at /v1/messages; thinking is off unless the request enables it. | `splash-src/README.md#use-the-api`, [github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift](https://github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/SplashService.swift) |
| Open WebUI | `http://<this Mac's LAN IP>:<port>/v1` | &lt;key&gt; | &lt;model ID&gt; | host=0.0.0.0, api_key=set, no_webui=optional | Admin &gt; Connections &gt; OpenAI: add the base URL and key; Model &gt; Advanced Params &gt; Function Calling = native (for tools); Enable Web Search in Admin and in the chat if you want its search tool | [#214](https://github.com/incoai/splash/issues/214) |
| Jan and other Tauri/webview apps | `http://127.0.0.1:<port>/v1` | &lt;key or local&gt; | &lt;model ID&gt; | allowed_origin=["tauri://localhost"], min_version=1.2.0 | Before 1.2.0 these apps need a CORS proxy. | [#232](https://github.com/incoai/splash/issues/232) |

### 7.3 Splashboard-only settings that replace shell habits

| Setting | Control | Default | Replaces | Behaviour | Source |
| --- | --- | --- | --- | --- | --- |
| Keep server running when Splashboard quits | toggle | off | nohup / tmux / launchd | Leave the server running in the background; Splashboard re-attaches via the port lock next time. | [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard), [#185](https://github.com/incoai/splash/issues/185) |
| Open Splashboard at login | toggle | off | LaunchAgent plist | Registers a login item (SMAppService). | [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard) |
| Start server at login with profile | select | — | launchd ProgramArguments | Start the chosen launch profile when Splashboard opens at login. | [#185](https://github.com/incoai/splash/issues/185) |
| Restart server if it exits unexpectedly | toggle | on | launchd KeepAlive | At most 3 restarts in 5 minutes, then stop and notify. Never restarts after a clean stop or a launcher error (bad flag, port busy, model failed). | [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard) |
| Prevent sleep while serving | toggle | on | caffeinate -i -s -m | Holds a PreventUserIdleSystemSleep assertion (or runs caffeinate -i -w &lt;server pid&gt;) while the server runs; the display may still sleep. | [#41](https://github.com/incoai/splash/issues/41), [#275](https://github.com/incoai/splash/issues/275), [#291](https://github.com/incoai/splash/pull/291) |
| Stop grace period | number | 20 | Ctrl+C, pkill | Time between SIGINT and SIGTERM when stopping; SIGKILL only after a confirmed Force stop. | [github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/ServerTermination.swift](https://github.com/hometrix/SplashMonitor/blob/main/Sources/SplashMonitor/Services/ServerTermination.swift) |
| (internal) Add Splashboard's webview origin | internal | on | manual --allowed-origin | Adds --allowed-origin tauri://localhost (and the dev origin in dev builds) to servers Splashboard starts, when the webview talks to Splash directly. | [#232](https://github.com/incoai/splash/issues/232) |
| (internal) Keep loopback off the proxy | internal | on | export NO_PROXY=... | When any *_PROXY is set, ensure NO_PROXY contains 127.0.0.1,localhost for the server, downloads and agents. | `splash-src/dev/tests/engine/test_clients.py` |

## 8. Community pain points and how the UI answers them

Roughly ordered by how often they come up in the 121 incoai/splash issues, the release notes and the community GUIs (SplashMonitor, splash-dashboard, splash-mlx, llml).

| Pain point | Splashboard answer | Evidence |
| --- | --- | --- |
| Two terminals, and the server terminal must stay open | Server runs as a managed child; agents open in embedded terminal tabs; optional keep-running and menu bar. | [#17](https://github.com/incoai/splash/issues/17), [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard), [github.com/mmmrt/splash-mlx](https://github.com/mmmrt/splash-mlx) |
| Port 8000 clashes (oMLX polls it, vLLM/llama-swap use it) and agents need the same SPLASH_PORT | Port field with in-use detection; agents inherit the port automatically; 'Error · not_found · GET /api/status' explained. | [#7](https://github.com/incoai/splash/issues/7), [#140](https://github.com/incoai/splash/issues/140), [#10](https://github.com/incoai/splash/issues/10) |
| Which model, quant and flags fit my RAM, and the real context before starting | RAM wizard and presets; context slider capped at the measured automatic limit; 'fits this Mac' badges. | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs`, [#209](https://github.com/incoai/splash/pull/209), [#125](https://github.com/incoai/splash/issues/125) |
| LAN sharing traps: --allowed-host vs --host, strict Host 403, forgotten key | 'Share on my network' toggle sets host, key and .local name together; 403 messages explained. | [#27](https://github.com/incoai/splash/issues/27), [#142](https://github.com/incoai/splash/issues/142) |
| Seeing tok/s, cache hits and draft acceptance without curling /status and /metrics | Dashboard cards from status deltas; acceptance gauge with a zero-acceptance warning. | [#96](https://github.com/incoai/splash/issues/96), [#176](https://github.com/incoai/splash/issues/176), [github.com/rickhuizinga/splash-dashboard](https://github.com/rickhuizinga/splash-dashboard) |
| Engine died after the Mac slept | 'Prevent sleep while serving' on by default; crash banner with restart. | [#41](https://github.com/incoai/splash/issues/41), [#275](https://github.com/incoai/splash/issues/275), [#291](https://github.com/incoai/splash/pull/291) |
| No download progress, no disk check, no model library or delete | Download with progress/ETA/cancel, disk precheck, Installed list with verify and safe delete. | [#69](https://github.com/incoai/splash/issues/69), [#73](https://github.com/incoai/splash/issues/73), [#256](https://github.com/incoai/splash/issues/256) |
| Switching models means Ctrl+C and retyping flags | Model switcher with per-model saved profiles. | [#212](https://github.com/incoai/splash/pull/212), [note.com/ai_driven/n/nca9a2e866982?hl=en](https://note.com/ai_driven/n/nca9a2e866982?hl=en) |
| Reasoning and sampling are hard to control (LM Studio maps xhigh/low to medium; penalties rejected before 1.2.0) | Per-model Thinking control; sampling presets; penalties shown only on 1.2.0+. | [#123](https://github.com/incoai/splash/issues/123), [#125](https://github.com/incoai/splash/issues/125), [#204](https://github.com/incoai/splash/issues/204) |
| Connecting Open WebUI, Jan, Claude Desktop, Cursor, Cline needs hand-written config | Copy-config cards that also apply required server flags. | [#214](https://github.com/incoai/splash/issues/214), [#232](https://github.com/incoai/splash/issues/232), [#72](https://github.com/incoai/splash/issues/72) |
| 'unrecognized arguments' because the README documents flags before Homebrew ships them | Version gates disable controls the installed Splash lacks; upgrade button. | [#82](https://github.com/incoai/splash/issues/82), [#163](https://github.com/incoai/splash/issues/163), [#185](https://github.com/incoai/splash/issues/185) |
| Requests killed at 30 minutes on 1.1.0 | Request time limit control on 1.2.0+ (default none); explains the 1.1.0 fixed 1800 s. | [#185](https://github.com/incoai/splash/issues/185) |
| Thinking replies cut at 32,000 tokens | Max reply length control; agent cards expose CLAUDE_CODE_MAX_OUTPUT_TOKENS and OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX. | [#221](https://github.com/incoai/splash/issues/221) |
| New Mac users do not know tricks like caffeinate or NO_PROXY | Both handled automatically (prevent sleep, NO_PROXY for loopback). | [#41](https://github.com/incoai/splash/issues/41) |
| Long cold first prompt for agents (90-110 s TTFT) | Prompt-progress bar from return_progress; warm-prompt preset with persistent cache. | [#90](https://github.com/incoai/splash/issues/90), [#177](https://github.com/incoai/splash/issues/177) |
| Unsupported Macs fail late (M1/M2, macOS 15, 16 GB) | Compatibility checklist before install with a clear yes/no. | [#9](https://github.com/incoai/splash/issues/9), [#124](https://github.com/incoai/splash/issues/124), [#236](https://github.com/incoai/splash/issues/236) |
| Upgrades while a server runs leave a broken engine | Upgrade flow stops servers first and offers a restart. | [github.com/incoai/splash/releases/tag/1.2.0](https://github.com/incoai/splash/releases/tag/1.2.0), `splash-src/DEVELOPMENT.md#build-and-run` |

## 9. Error messages → plain-language fixes

Shown as 'What this means' cards next to the log line or banner. Match on the stable prefix.

| Message (prefix) | What to tell the user | Source |
| --- | --- | --- |
| `Error · not_found · GET /api/status (repeating)` | Another app (oMLX's menu bar) polls port 8000. Harmless; move Splash to another port. | [#7](https://github.com/incoai/splash/issues/7), [#140](https://github.com/incoai/splash/issues/140) |
| `403 Host X is not allowed; restart the server with --allowed-host X` | The client used a name the server does not know. Add it under Extra host names. | [#142](https://github.com/incoai/splash/issues/142) |
| `403 Origin X is not allowed; restart the server with --allowed-origin X` | A web page or app webview is calling the API. Add it under Allowed web origins. | [#232](https://github.com/incoai/splash/issues/232) |
| `unrecognized arguments: --flag` | The installed Splash is older than that option. Upgrade, or the control stays disabled. | [#82](https://github.com/incoai/splash/issues/82), [#163](https://github.com/incoai/splash/issues/163), [#185](https://github.com/incoai/splash/issues/185) |
| `repository has no Splash runtime package manifest.json` | Splash 1.0.x cannot load upstream MLX/GGUF repos. Upgrade to 1.1.0+. | [#163](https://github.com/incoai/splash/issues/163) |
| `no supported model has this architecture (...)` | Not a Qwen3.8-27B or Qwen3.6-35B-A3B model. Pick a supported one. | `splash-src/install/families.py` |
| `select a GGUF with OWNER/REPO:VARIANT (files in the repository root: ...)` | The repo has several GGUF files. Choose a variant. | `splash-src/install/upstream.py` |
| `this runtime package has no variants; drop the :VARIANT suffix` | Legacy incoai packages take no variant (or revision, draft, text only). | `splash-src/install/legacy.py` |
| `--max-context N exceeds the M tokens ... allow; omit it or pass at most M` | Context too long for the memory budget. Use Auto or at most M. | `splash-src/runtime/engine/Bootstrap.mm` |
| `memory plan cannot hold one model token / memory_plan_json: ...` | The model does not fit the memory limit. Raise the GPU memory limit or pick a smaller model. | `splash-src/runtime/engine/Bootstrap.mm` |
| `Waiting for sufficient available memory to start ...` | Other apps hold the memory. Close some; Splash retries. | `splash-src/runtime/main.mm` |
| `503 resource_timeout` | A request could not get memory in time. Close memory-heavy apps or use Text only. | `splash-src/docs/performance.md#smaller-ggufs-on-24-gb-macs` |
| `503 engine_recovering / 500 engine_failed` | The engine crashed (and stopped restarting after 3 quick failures). Restart the server; turn on crash traces to report it. | `splash-src/DEVELOPMENT.md#build-and-run` |
| `504 request_timeout` | The request hit the time limit (fixed 1800 s before 1.2.0). Raise or clear Request time limit. | [#185](https://github.com/incoai/splash/issues/185) |
| `413 (request too large)` | Body over Max request size; raise it for large images or PDFs. | [#19](https://github.com/incoai/splash/issues/19) |
| `error: Splash is already serving (PID p, model m, port n)` | A server already owns that port. Attach to it, stop it, or pick another port. | `splash-src/install/launcher.py` |
| `error: Splash installation is busy; ...` | An upgrade holds the installation. Wait for it to finish. | `splash-src/install/launcher.py` |
| `error: cannot bind HOST:PORT: ...` | Another program uses the port. Choose another. | `splash-src/install/launcher.py` |
| `error: model download or verification failed` | See the installer lines above it. A 401/403 means the model needs a Hugging Face token. | `splash-src/install/hub.py` |
| `Splash needs Apple GPU family 9 or newer (M3 or later) on macOS 26.4 or newer ...` | This Mac cannot run Splash. | `splash-src/runtime/metal/DeviceCapabilities.cpp` |
| `native engine executable is missing; the installation may have been upgraded or removed` | Splash was upgraded under a running server. Restart the server. | `splash-src/server/runtime.py` |
| `Thinking key must be a user-owned regular file with mode 0400 or 0600` | Fix the file's permissions or reset the key (Settings &gt; Advanced). | `splash-src/server/thinking.py` |
| `No ready Splash server at http://127.0.0.1:PORT (agent)` | Server not ready, a port mismatch, or a proxy without NO_PROXY for 127.0.0.1. | `splash-src/install/launcher.py` |
| `Splash authentication failed; set SPLASH_API_KEY to the server's key (agent)` | The agent got a different key. Splashboard passes the server's key; check a key set in the shell profile. | `splash-src/install/launcher.py` |
| `<agent> is not installed or is not on PATH` | Install the agent, or the GUI could not see your shell PATH; Splashboard resolves PATH through a login shell. | `splash-src/install/clients.py` |
| `chat template does not support the requested thinking mode` | enable_thinking contradicts the template. Clear the 'Force thinking' override. | `splash-src/server/frontend.py` |

## 10. What genuinely needs a terminal, and the fallback

Everything else in this document runs without a terminal: `brew install/upgrade/uninstall`, `splash serve`, the model installer (`install/models.py prepare|verify`), the catalog refresh, `hf auth login --token`, device-check, status, logs, benchmarks and every file edit are plain child processes or in-process work.

| What | Why it needs a terminal | Fallback in Splashboard |
| --- | --- | --- |
| Interactive coding agents (claude, opencode, codex, hermes, pi) | Each `splash <agent>` ends by replacing itself with the agent's full-screen TUI. | Embedded terminal pane: portable-pty (Rust) + xterm.js, running `splash <agent> ARGS` with SPLASH_PORT, SPLASH_API_KEY, NO_PROXY and the login-shell PATH, so the launcher's own checks, config writes and messages stay exact. Fallback 'Open in Terminal.app' via osascript (`tell application "Terminal" to do script "SPLASH_PORT=8001 splash claude"`). Captured one-shots without a PTY, as Splash's own real-agent test runs them: `claude --print`, `opencode run --format json`, `codex exec --json -`, `pi --print --mode json`, `hermes chat --oneshot --query-file -`. |
| Installing Homebrew itself | The official installer prompts for an admin password and confirmation; Homebrew refuses to run as root, so an admin GUI prompt cannot run it. | Embedded terminal running the installer, or a link to brew.sh. Splash itself installs non-interactively. |
| Third-party prompts: `hermes pm install`, possibly `hermes profile delete`, agent install scripts | Owned by other tools; they may ask questions (not verified here: hermes was not installed on this Mac). | Run in the embedded terminal; Splashboard checks the result afterwards (files present, profile gone). |
| Anything a future Splash adds before Splashboard supports it | New subcommands or flags. | Settings &gt; Advanced &gt; 'Run a splash command' opens the embedded terminal with the selected server's env; extra serve flags can also go in a free-form 'Additional flags' field, checked against `splash serve --help`. |

Optional, not needed by Splash: raising the GPU wired-memory limit (`sudo sysctl iogpu.wired_limit_mb=...`, seen in #220) can be done without a terminal through an admin prompt (`osascript -e 'do shell script "sysctl iogpu.wired_limit_mb=N" with administrator privileges'`). It resets at reboot and can starve macOS; keep it out of the default UI or behind a strong warning.

## 11. Knobs people ask for that do not exist (do not fake them)

| Requested | Reality | Source |
| --- | --- | --- |
| --skip-memory-check / --memory-reserve | Asked in #10; 1.0.1 relaxed the startup gate instead. | [#10](https://github.com/incoai/splash/issues/10) |
| --models-dir / SPLASH_MODELS_DIR | Use HF_HUB_CACHE (Model download folder). | [#5](https://github.com/incoai/splash/issues/5) |
| Batch width / concurrency | The engine runs at most 4 requests at once; --queue-size only limits admission. | [#37](https://github.com/incoai/splash/issues/37) |
| --kernel-choices (load tune-kernels results) | Not supported; 1.2.0 adopted the calibration itself. | [#154](https://github.com/incoai/splash/issues/154) |
| Named cache pins, --max-pinned-memory, prefill-only warm-up | Still open; use the persistent cache. | [#177](https://github.com/incoai/splash/issues/177) |
| --prefill-bound-ms / SPLASH_PREFILL_BOUND_MS | Only in the community M1 fork (splash-m1). | [#131](https://github.com/incoai/splash/issues/131) |
| --max-new-tokens | Removed in 1.2.0 (was a server-only flag); set max tokens per request. | [github.com/incoai/splash/releases/tag/1.2.0](https://github.com/incoai/splash/releases/tag/1.2.0) |
| --allow-idle-sleep and the built-in sleep assertion | Unreleased (PR #291). Splashboard's own prevent-sleep covers it. | [#291](https://github.com/incoai/splash/pull/291) |
| Idle weight-release timeout | Fixed at 600 s in 1.2.0; not configurable. | `docs/splash-api.md#45-idle-weight-release-and-restore-12` |
| A 'splash models' / 'splash pull' command | Closed as not planned (#73); Splashboard calls install/models.py directly. | [#73](https://github.com/incoai/splash/issues/73) |

## Appendix A. Developer-only commands (not in the UI)

These need a source checkout (Xcode 26+, Python 3.12-3.14) or are internal. None ship in the Homebrew libexec except the internal Python modules, which a UI must not call.

| Command / target | What it is | Where |
| --- | --- | --- |
| make all / make -j4, install, install-environment, platform-check, preflight, serve, clean | Build and run from a source checkout (Xcode 26+, Metal 4 tools). | Makefile; DEVELOPMENT.md#build-and-run |
| make check, check-native-cpu, check-native-metal, check-python-engine, test, test-python, test-models, test-engine-cpu, test-engine-metal, test-sanitizers, architecture-check, install-development, verify-build-identity | Tests without model weights. | dev/Makefile; dev/native.mk |
| make test-real, test-http-real, test-agent-real, test-release-real, verify-models, release-check | Real-model and release validation; drive all five agents (AGENT_CLIENTS, AGENT_SCENARIO). | dev/Makefile; DEVELOPMENT.md#validate |
| make test-performance-real, benchmark-backend, benchmark-prefill, benchmark-decode, benchmark-decode-profile, benchmark-attention-sweep, benchmark-gguf-projection, benchmark-gguf-moe, tune-kernels; python -m dev.benchmarks.http_regression | Engine benchmarks and kernel tuning. Not shipped in the Homebrew libexec; Splashboard's Benchmark tab is HTTP-based instead. | dev/native.mk; DEVELOPMENT.md#local-benchmarks |
| make package, package-bottle, package-check, publish-test; dev/tools/install.sh; dev/tools/update_model_catalog.py | Release tooling and the curl\|sh tester installer. | dev/Makefile; DEVELOPMENT.md#package |
| python -m server.crash_trace &lt;trace&gt; | Replays a crash trace on the GPU from a source checkout. Splashboard offers Reveal in Finder instead. | server/crash_trace.py |
| python -m server.server ... | What `splash serve` execs into. Never call it directly: it skips the locks, install, device check and assembly hold. | server/server.py |
| engine/splash serve-native ... | The engine, spoken to over a binary stdin/stdout protocol by server.server. Not usable from a UI. | runtime/main.mm |
| install/models.py ... link | Prints a selection link path; useful for debugging only. | install/models.py |
| Shell completions (_splash, splash.bash, splash.fish) | Replaced by the model picker; the `models` helper script can feed it. | install/completions/ |

## Appendix B. Contradictions and corrections found while checking the sweeps against the source

| Topic | Sweep said | Source says |
| --- | --- | --- |
| --decode-share default | Both sweeps say 0.5. | Correct in effect, but `splash serve` passes nothing by default (serve_options default None); 0.5 is the engine's EngineConfig default (runtime/engine/Engine.hpp:44). Send the flag only when the user changes it. |
| Request-field version gates | CLI sweep marks sampling, seed, stop, reasoning, priority, tools, response_format, stream options as '1.2.0 (earlier not checked)'. | Old tags' frontend.py show seed, stop, tools/tool_choice/parallel_tool_calls, response_format, preserve_thinking, reasoning_effort, return_progress, include_usage, timeout and PDFs since 1.0; priority since 1.0.2; top_k 0/-1 as 'disabled', min_p, the three penalties, ignore_eos and chat_template_kwargs only in 1.2.0 (top_k had to be &gt;= 1 before). |
| stop with tools or JSON output | Neither sweep mentions it. | 400 'stop cannot be combined with tools or structured output' (frontend.py:935, present since 1.0). The UI must disable Stop sequences when tools or a response format are set. |
| Image inputs | Sweeps say 'images need vision'. | Also: data: URLs only (http(s) URLs get 400), JPEG/PNG/WEBP/GIF, 32 MiB each, at most 64 per request; PDFs 64 pages and 64 MiB per request (images.py, documents.py). |
| Memory reserve: '2 GiB free' vs '3 GiB free' | Web sweep: Splash keeps 2 GiB for macOS and grows while 1 GiB more is free. docs/performance.md: grows only while macOS has 3 GiB free. | Not a contradiction. hostAvailableReserveBytes = min(RAM/10, 2 GiB) (MemoryPlan.hpp:90) plus a 1 GiB growth margin = 3 GiB free on Macs with 20 GB or more. |
| --max-cache-disk example '5G' | A web snippet claimed --persistent-cache 'defaults to 5 GiB'. | False: the cache tier defaults to 0 (off) and --persistent-cache needs --max-cache-disk. The help text's example 'e.g. 5G' is probably where the snippet came from. |
| HF_HUB_CACHE minimum version | Web sweep: 1.0. CLI sweep: 1.1.0. | It is huggingface_hub's own variable, honoured in every release; Splash first documented it in 1.1.0. Recorded as 1.0. |
| Listing installed models with a '*/*' glob | CLI sweep: 'enumerate models/*/* (this includes .selections/&lt;hash&gt;)'. | True for Python's pathlib glob (used by selection_links), false for the shell helper install/completions/models, which skips the hidden .selections folder. A Rust implementation must list .selections explicitly. |
| --max-memory upper bound | Web sweep suggests 'a slider bounded by RAM'. | A value above the Mac's own GPU budget is silently clamped (hardBudgetBytes = min(user, recommendedMaxWorkingSetSize - max(1 GiB, 2%))). Bound the slider by that number, read from Metal in Rust; physical RAM only as a fallback. |
| Benchmark targets | Web sweep lists `make benchmark-*` and dev.benchmarks as benchmark workflows. | Neither the Makefile nor dev/ ships in the Homebrew libexec (only engine/, install/, python/, server/, release.json). The UI benchmark must be HTTP-driven. |
| Bundled hf CLI | CLI sweep: the bundled hf has a broken shebang. | Confirmed: first line points at /Users/jianchen/.../python/bin/python3. Invoke it through &lt;libexec&gt;/python/bin/python3. |
| --port error text | CLI sweep quotes one message. | Two exist: 'port must be an integer from 1 to 65535' (not a number) and 'port must be between 1 and 65535' (out of range); launcher.py:339-348. |

## Appendix C. Keeping the two files in sync

Both files were generated together from the same data, so sections 3, 4, 5 and 7 match `splash-params.json` entry for entry. When Splash adds or changes a flag, update the JSON entry first (all 18 keys, with `min_version`), then the matching table row. This check must print two empty lists (run from the repo root with Splash installed):

```sh
python3 -m json.tool docs/splash-params.json > /dev/null && python3 - <<'EOF'
import json, re, subprocess
usage = subprocess.run(['splash', 'serve', '--help'], capture_output=True, text=True).stdout.split('\n\n')[0]
want = set(re.findall(r'(--[a-z][a-z-]*)', usage))
have = {e['flag'] for e in json.load(open('docs/splash-params.json'))['serve'] if e['flag']}
print('missing:', sorted(want - have), 'unknown:', sorted(have - want))
EOF
```


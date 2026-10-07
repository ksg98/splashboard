# Splashboard: direction "Minimal"

This direction is how OpenAI would build Splashboard. It looks like the ChatGPT macOS app: a monochrome window, a quiet sidebar, one large rounded composer, and almost no chrome. The engine screens (Activity, Models, Connect, Launch settings, Settings) use the same restraint and native macOS controls, laid out like System Settings.

Files in this folder:

| File | What it is |
| --- | --- |
| `index.html` | A single self-contained prototype: every screen, both themes, inline CSS and a little vanilla JS. It makes no network requests. |
| `tokens.css` | Every design token as a CSS custom property, for light and dark. The React app imports it once at the root. `index.html` inlines the same file, byte for byte. |
| `shots/` | 1440×900 screenshots of every screen and state in light and dark, rendered in WebKit (the engine behind WKWebView), plus `*-1280x820-*.png` checks and `chat-reduced-motion-*.png` (rendered with `prefers-reduced-motion: reduce`). |

## Viewing and scripting

Open `index.html` in Safari, or serve the folder and open it in any browser. URL parameters:

| Parameter | Values | Effect |
| --- | --- | --- |
| `screen` | Chat: `chat`, `chat-done`, `chat-stats`, `chat-collapsed`, `chat-effort`, `model-menu`, `engine`, `engine-collapsed`, `new-chat`. Server not running: `chat-stopped`, `chat-stopped-draft`, `new-chat-stopped`, `chat-starting`, `engine-stopped`, `engine-starting`, `activity-stopped`, `activity-starting`, `models-stopped`, `connect-stopped`. Search: `search`, `search-results`, `search-empty`. Engine screens: `activity`, `activity-details`, `activity-details-end`, `activity-log`, `models`, `models-versions`, `launch-settings`, `launch-other`, `launch-network`, `launch-more`, `launch-command`, `connect`, `agent-terminal`. Settings: `settings`, `settings-chat`, `settings-chat-custom`, `settings-downloads`, `settings-updates`. First run: `first-run`, `first-run-install`, `first-run-download`, `first-run-download-sheet`, `first-run-start`, `first-run-starting` | Opens that screen or state. `chat-done` is the finished turn with a draft and an image in the composer; `chat-stopped-draft` is the same draft while the server is stopped, so Send is enabled and will start it; `chat-collapsed` hides the sidebar; `activity-details-end` scrolls to the last detail group and Show log; `models-versions` opens the Version pop-up on the Qwen3.8-27B row; `launch-other` is Launch settings opened from the Qwen3.6-35B-A3B row; `launch-network` scrolls to Cache and Network & security; `launch-more` opens Advanced › More options. |
| `engine` | `stopped`, `starting` | Holds the server in that state on any screen (sidebar row, popover, chat, Activity, Models, Connect). Applies to the first screen only; after that, Start, Send and Stop decide. |
| `q` | any text | Opens Search chats with that query, for example `q=Splash` or `q=benchmark` (no match). |
| `theme` | `light`, `dark` | Forces a theme. Without it the page follows the system. |
| `state` | `thinking`, `streaming`, `done` | Freezes the latest chat turn in one state. Without it the turn plays: thinking, then streaming text, then done. |
| `still` | `1` | Turns off all motion and timers so screenshots are deterministic. |

Example: `index.html?screen=activity&engine=stopped&theme=dark&still=1`.

From the console, `SB.setEngine("stopped" | "starting" | "ready" | "busy")` re-renders every screen in that state, the open popover included. `SB.startEngine()` and `SB.stopEngine()` do what the Start and Stop buttons do.

Inside the prototype, the sidebar switches screens. The gear next to the engine row opens Settings (also ⌘,). Start, Stop and Restart work: Start plays the real startup phases (Preparing, Loading weights, Warming up) in 9 seconds instead of about 25, then the server is Ready. Typing a message and pressing Send while the server is stopped starts it too. On first run, Install, Download and Start move through the three steps. Appearance lives only in Settings › General (System, Light, Dark; System by default), so the toolbar corner stays empty as in ChatGPT. For reviewing the mockup, ⇧⌘L flips light and dark; it is not a product shortcut.

### Keyboard and the menu bar

Every destination has a shortcut, and each one is written in three places: the View menu, the sidebar item's tooltip, and a hint that appears at the right end of the sidebar row on hover. With the sidebar hidden, the shortcuts and the engine popover's menu (Open Activity ⌘2, Open Models ⌘3) still reach every page.

| Menu bar › View | Shortcut |
| --- | --- |
| Chat (returns to the open conversation) | ⌘1 |
| Activity | ⌘2 |
| Models | ⌘3 |
| Connect | ⌘4 |
| Show Sidebar / Hide Sidebar | ⌃⌘S |

File › New Chat is ⌘N, Edit › Search Chats is ⌘K, Splashboard › Settings… is ⌘,. Esc closes any popover, sheet or dialog (and clears the search field).

## Principles

1. **One thing per screen.** Chat is the conversation. Activity is four numbers and one speed chart. Models is the running model and a list. Everything else waits behind a disclosure, a hover, a popover or a sheet.
2. **Gray does the work.** Hierarchy comes from size, weight, the three text grays, whitespace and very light fills. There are no borders around sections, no decorative gradients, no glows and no illustrations. The only gradient you can see is the soft highlight that moves across the "Thinking…" label. The scroll edges (see Components) are written as `linear-gradient` too, but only as a `mask-image`: a mask hides content near an edge and adds no colour of its own. They sit on scroll containers only: the chat thread, the Activity, Models and Connect pages, sheet and Settings bodies, and the terminal text.
3. **Colour means something.** The system accent appears in exactly four places. Green, orange and red appear only as 8 px status dots, always next to a word that says the same thing. The one exception is red text on an action that removes something (Uninstall Splash…), as in System Settings.
4. **Native first.** Switches, segmented controls, pop-up buttons with up-down chevrons, steppers, sliders on a plain track, and inset grouped forms with footnotes, sized and spaced like macOS System Settings. Grouped forms are always one column.
5. **Plain words.** Sentence case everywhere, no all-caps labels, no jargon a person doesn't need. Footnotes explain an option in one or two sentences, taken from the Splash docs. Engine units are translated: memory is in GB, never pages; concurrency is "1 of 4 at once", never lanes.
6. **Real numbers, few of them.** Every number on screen is something Splash reports (see "Where the numbers come from"). A number earns a place at a glance only if someone acts on it. When the server is off there is no number to show, so the card says so instead of describing data that doesn't exist.
7. **One way to do each thing.** One icon tile, one button rule, one naming rule for model versions, one status line for a server that isn't running. A treatment that appears on one screen looks the same on every other.

## Tokens

All values live in `tokens.css`. The tables below are the reference.

### Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-window` | `#FFFFFF` | `#212121` | Main content |
| `--bg-sidebar` | `#F9F9F9` | `#171717` | Sidebar |
| `--bg-elevated` | `#FFFFFF` | `#383838` | Popovers, menus. In dark it is lighter than everything it can cover, the `#303030` composer included, so menus float instead of sinking |
| `--bg-composer` | `#FFFFFF` | `#303030` | Composer |
| `--bg-sheet` | `#FFFFFF` | `#262626` | Sheets, Settings dialog |
| `--bg-group` | `#F7F7F8` | `rgba(255,255,255,.05)` | Inset groups, the four Activity summary cards, the running-model card. Nothing else is boxed: the chart sits on the window |
| `--bg-bubble` | `#F4F4F4` | `#303030` | User message |
| `--bg-code` | `#F7F7F8` | `#171717` | Code blocks |
| `--bg-terminal` | `#1C1C1E` | `#141414` | Embedded terminal (dark in both themes) |
| `--text-primary` | `#0D0D0D` | `#F5F5F7` | Body text, labels |
| `--text-secondary` | `#6E6E73` | `#A1A1A6` | Secondary lines, footnotes, values, placeholders |
| `--text-tertiary` | `#8E8E93` | `#6E6E73` | Disabled text only (see Accessibility) |
| `--text-destructive` | `#D70015` | `#FF6961` | Text of an action that removes something. These are the increased-contrast system reds; `--status-error` is only 3.3:1 as small text |
| `--hairline` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.08)` | Row separators, sheet footer |
| `--hairline-strong` | `rgba(0,0,0,.14)` | `rgba(255,255,255,.14)` | Chip outlines, thinking rule, focused composer |
| `--chart-grid` / `--chart-baseline` | 7% / 14% black | 8% / 16% white | Chart gridlines (40, 80, 120) and the zero baseline |
| `--fill-hover` / `--fill-selected` | 4% / 6% black | 6% / 8% white | Hover and selected rows |
| `--fill-control` / `--fill-control-hover` | 5% / 8% black | 8% / 12% white | Secondary buttons, pop-ups, fields, segmented track |
| `--fill-tile` | = `--fill-control` | = `--fill-control` | Every icon tile (see Icon tile) |
| `--fill-track` | 10% black | 14% white | Slider, progress and meter tracks |
| `--fill-meter` | `#0D0D0D` | `#F5F5F7` | Progress and memory bars (gray, never accent) |
| `--primary-bg` / `--primary-fg` | `#0D0D0D` / `#FFFFFF` | `#F5F5F7` / `#0D0D0D` | Primary buttons and the send button |
| `--accent` | `AccentColor`, fallback `#0A84FF` | same | See below |
| `--status-ok` / `--status-warn` / `--status-error` | `#34C759` / `#FF9F0A` / `#FF3B30` | same | Status dots only (red text uses `--text-destructive`) |
| `--scrim` | 20% black | 50% black | Behind sheets and dialogs |

The accent appears in exactly four places: the keyboard focus ring (around the rounded search field it is a 3 px halo at 35%), a switch that is on, the line on the Activity chart, and the text caret. Primary buttons are black on white (white on black in dark), as in ChatGPT, so they never use the accent. Progress bars, the startup progress line, the download ring, the memory meter, the 7-dot acceptance indicator, syntax highlighting and sliders are gray.

### Type

The system font only: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`. Code, numbers in code, paths and commands use `ui-monospace, "SF Mono", Menlo, monospace`. Live numbers use `font-variant-numeric: tabular-nums`. No manual letter-spacing: WebKit applies SF's optical sizes.

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `--text-title-1` | 28 / 34 | 600 | Page titles, empty-state question, big numbers |
| `--text-title-2` | 20 / 26 | 600 | Settings page titles |
| `--text-title-3` | 17 / 22 | 600 | Sheet titles, running model name |
| `--text-body` | 16 / 1.65 | 400 | Chat messages, composer; the toolbar title pop-up is 16 / 600 |
| `--text-lg` | 15 / 1.45 | 400 | First-run subtitle |
| `--text-md` | 14 / 1.55 | 400 | Thinking text, "Thought for…" row |
| `--text-sm` | 13 / 18 | 400, 500, 600 | UI base: sidebar, rows, buttons, menus, group and section titles (600) |
| `--text-xs` | 12 / 1.35–1.45 | 400 | Row help, footnotes, captions, code-block header |
| `--text-2xs` | 11 | 400 | Chart axes |
| `--mono-size` | 13 / 1.6 | 400, 600 | Code blocks (12 in logs, 12.5 in the terminal) |

### Spacing, shape, depth

- Spacing is a 4 px scale: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radii: 6 (pop-ups, fields, menu items), 8 (sidebar rows, icon buttons, small tiles), 10 (inset groups, medium tiles), 12 (code blocks, popovers, cards), 14 (the large first-run tile), 16 (sheets, dialogs), 20 (user bubble), 26 (composer). Pills (999) are used only for buttons, the composer controls, suggestion chips and the search field, as ChatGPT does.
- Scroll edges: `--scroll-edge` 16 px (toolbar, sheet headers, the Settings title) and `--scroll-edge-bottom` 32 px (above the composer, clear for the last 8 px).
- Shadows exist only on things that float: popovers and menus (`--shadow-popover`), the composer (`--shadow-composer`) and sheets (`--shadow-sheet`). Cards, groups and tiles have no shadow and no border; a light fill separates them.

### Layout grid

| Measure | Value |
| --- | --- |
| Window | 1440×900 reference, checked at 1280×820 |
| Sidebar | 260 px, full height, collapsible. Traffic lights at x 20, y 20 (12 px, 8 px apart), vertically centred on the 52 px toolbar line |
| Toolbar | 52 px, unified with the content, no title strip and no divider. Content scrolled under it fades out over `--scroll-edge` (16 px) instead of being cut |
| Composer edge | While more of the thread is below, the thread fades out over `--scroll-edge-bottom` (32 px) above the composer and is fully clear for the last 8 px, so nothing peeks above it |
| Chat column | 760 px max, centred, 24 px side padding. User bubbles max 72% of it |
| Page column | 880 px max, centred, 40 px gutters (32 px below 1340 px). Activity, Models and Connect share it so titles never jump |
| Page header | Title line (34 px) and one status line (18 px) in every state. Anything that comes and goes (the start progress) lives inside the status line, so the content below never moves between Ready, Starting… and Stopped |
| Model list columns | Name and description · format 168 px · size 60 px · action slot 60 px (`--action-slot`) · chevron 12 px, 16 px gaps. Run, Get and the download ring share the action slot's centre |
| Sheets | 640 px (forms), 560 px (install), 860 px (log); the agent terminal is 1040 px (window − 80 px when narrower) and 90% of the window height. Max height = window − 80 px, body scrolls |
| Settings dialog | 800×620, 208 px tab column, fixed 20 px page title, scrolling body |
| Vertical rhythm | 24 between a user message and the reply, 32 between turns, 28 above a group title (24 in Activity details), 36 from the summary cards to the chart label, 8 from a group to its footnote |

## Components and states

| Component | Anatomy | States |
| --- | --- | --- |
| Window chrome | Traffic lights over the sidebar, unified 52 px toolbar with nothing in the top-right corner | Sidebar shown; collapsed (lights stay; the toolbar gains Show sidebar and New chat icon buttons on the left and the engine state, a dot and Ready / Thinking / Starting… / Stopped, at the right end, which opens the engine popover); first run (no sidebar) |
| Scroll edge | A mask on a scroll container: content fades to nothing over 16 px under the toolbar, a sheet header or the Settings title (8 px in the terminal), and over 32 px above the composer | Off at rest; the top fade appears once the container is scrolled, the bottom fade (thread only) while more is below |
| Sidebar row | 18 px line icon, 13 px label, 32 px tall, 8 px radius; a tooltip with the shortcut ("Activity (⌘2)") and the same shortcut as a hint at the row's right end on hover | Rest, hover (4% fill), current page (6% fill), keyboard focus (ring). New chat and Search chats are actions, so they never take the current-page fill; only a conversation, Activity, Models or Connect can be current |
| Search chats | Row that becomes an inline rounded field with a clear button. The focus ring is a 3 px accent halo at 35% around the rounded field, never a square outline on the bare input | Row; field focused; typing (matches stay under their Today / Previous 7 days label, the matched words semibold, empty groups hidden); no match ("No results" and one plain line naming the query). Esc or clearing an empty field returns to the row |
| Chat history | Group label (12 px secondary) and 32 px rows | Rest, hover, current |
| Engine row | Status dot, model name, state word, then the Settings gear | Ready (green), Thinking (green, slow pulse), Starting… (orange), Stopped (hollow gray ring); pressed opens the engine popover |
| Engine popover | Name and state; then by state. Ready / Thinking: Splash version, address and uptime, three numbers in a quiet inset (Speed, Drafts accepted, Memory), Restart and Stop. Starting…: version and address, an inset with the phase ("Loading weights"), the seconds so far and a thin gray progress line, one Stop. Stopped: "Last ran today at 11:27", one line on what Start does, one black Start pill and no numbers. Always, below a separator: Open Activity ⌘2, Open Models ⌘3, Launch settings… | Open, closed; numbers and phase update live; the popover keeps its anchor when its height changes |
| Composer status line | One line of 13 px secondary text inside the top of the composer, above the field: a dot, a sentence, and at most one text button. No box of its own | Stopped: hollow dot, "Qwen3.8-27B isn’t running. Sending a message starts it.", and a "Start now" text button. Starting…: orange dot, "Starting Qwen3.8-27B…", the phase and seconds, and a 96 px progress line at the end of the line. Hidden when Ready or Thinking |
| Title pop-up (model) | 16 px semibold name and chevron in the toolbar | Rest, hover, open (menu of installed models with a check on the running one, each named by the version rule below, and a "Switching models restarts the server" note) |
| User message | Gray bubble, right-aligned, 20 px radius. An image sent with it sits above the bubble as a 232×144 thumbnail with a 16 px radius and a hairline edge, as in ChatGPT | Text only, with image |
| Assistant message | Plain text on the window, no bubble; paragraphs, lists, inline code, code blocks | Streaming (dot cursor at the end), done |
| Thinking | "Thought for N seconds ›" row (14 px, secondary); expanded body is 14 px secondary text with a 2 px rule on the left | Live (shimmering "Thinking…", body open, streaming), collapsed, expanded |
| Code block | Language label and Copy in a 36 px header, 13 px mono body, gray syntax tint (keywords semibold, strings and comments secondary) | Rest, Copy hover, Copied (check icon, 1.4 s) |
| Message actions | Copy, Regenerate, Info (30 px icon buttons) | Hidden until hover on older turns, always visible on the latest finished turn; Info toggles an inline line of per-turn stats |
| Composer | Optional status line, attachment row, 16 px text field, bar with "+", the thinking pop-up and the round send button | Empty (send disabled, 30% opacity), typing (gray outline), draft with attachment (send enabled), generating (empty field, send becomes a black square stop button). The composer is never disabled: with the server stopped or starting it looks and works the same, the status line says what will happen, and Send starts the server (or waits for it) and then sends. Once a message is sent its attachment moves into the thread, so a chip never sits in the composer while a reply streams |
| Attachment chip | 38 px rounded-square thumbnail of the actual image, name, type and size, remove button | Rest, remove hover |
| Thinking pop-up | Bulb icon, "Medium thinking" (or "Low thinking", "High thinking", "Thinking off"), chevron; menu titled Thinking with None, Low, Medium, High and one-line explanations | Each value; maps to `reasoning_effort` none, low, medium, xhigh. The bulb means thinking and nothing else |
| Suggestion chip | Outline pill, 16 px icon, 13 px label | Rest, hover |
| Button | Pill, 28 px (36 px for the one primary action on a page) | Primary (black; Start is always primary), secondary (5% fill), disabled (40%); hover; focus ring. **One rule for icons: text buttons carry no icon.** Restart, Stop, Start, Show log, Run, Get, Open and Launch settings are words only, wherever they appear. The only glyph a text button may carry is a trailing ↗ when the action leaves Splashboard (Get ↗ for Hermes, Open in Terminal ↗). Every action at the trailing end of a form row (Edit…, Choose…, Test, Manage…, Check for updates) is the same 28 px gray pill, like a macOS bezeled push button |
| Text button | 13 px (12 px inside a help line) medium-weight primary text, no fill until hover | Used where an action belongs to a line of text rather than to a row: "Start now" in the composer status line, "Regenerate…" under the masked API key. Rest, hover (4% fill), focus ring |
| Icon button | 32 px, 18 px icon, secondary colour | Rest, hover, pressed/expanded |
| Icon tile | A rounded square with the `--fill-tile` gray fill, no border, no shadow, and a 1.5 px line glyph in the primary text colour. Three sizes: 32 px / 8 px radius (agents in Connect and the terminal sheet), 44 px / 10 px (the running model card), 64 px / 14 px (first run) | Static. It is the same treatment on a white window and on a gray card |
| Pop-up button | Value and up-down chevrons on a 5% fill, 24 px | Rest, hover, open |
| Segmented control | 2 px inset track; selected segment is white (20% white in dark) with a hairline shadow | Selected, unselected, hover |
| Switch | 32×18 track, 16 px white knob | Off (gray track), on (accent), disabled (45%), focus ring |
| Slider | 4 px plain gray track, 16 px white knob, value at the right in tabular figures. Where the number means nothing to people, five tick marks and named ends below the track instead ("Long prompt first" … "Replies first"), default in the middle | Rest, dragging, focus ring |
| Number field and stepper | 24 px field, right-aligned tabular value, 15 px stepper | Rest, focus, invalid (not shown) |
| Inset group | 10 px radius, light fill, rows of 44 px min with inset hairlines, optional 12 px help line under a label. A help line explains the row it sits in; the group footnote explains the group as a whole. A last row "More options ›" or "Customize ›" can grow the same group | Rows can hold any control above; collapsed, expanded; a row's extra lines can appear with its switch (Require an API key shows the masked key and Regenerate… only while it is on) |
| Destructive row button | Full-width row in its own group, 13 px `--text-destructive` label, footnote below saying what is removed and what is kept | Rest, hover |
| Group title and footnote | 13 px semibold above, 12 px secondary below | Static |
| Disclosure | Chevron and label ("Show details" / "Hide details") | Collapsed, expanded (chevron turns 90°, panel grows) |
| Summary card | Label, 28 px number with small unit, one 16 px footer line (text, the 7-dot acceptance indicator or a thin meter) | Live; server off: an em dash for the number and the footer says "Not running" (stopped) or "Starting…" in secondary text, so no card describes data that doesn't exist |
| Line chart | Drawn straight on the window, no card: a 13 px semibold section label ("Tokens per second") with the readout on the right ("Last minute"), a single 2 px accent line, three light gridlines, a hairline zero baseline, axis labels on the right, start and end labels below | Rest, hover (vertical hairline, ring on the point, readout replaces "Last minute"), server off (no line; one sentence in the middle says why) |
| Meter / progress | 4 px track (6 px in sheets), gray fill | Value, indeterminate (not shown). Startup progress follows Splash's phases (Preparing, Loading weights, Warming up), never the accent |
| Download ring | 28 px App Store ring: 2 px track, 2 px progress arc and a 7 px stop square, all in the primary text colour, centred in the same 60 px action slot as Run and Get | Downloading (the row's second line reads "Downloading · 8.6 of 20.6 GB · about 3 min"), hover (light fill); pressing stops the download |
| Running model card | 44 px icon tile, name, one meta line of three facts (format, size, context); repo ID and vision on hover and in Launch settings; the engine word, Launch settings, then Stop or Start | Ready / Thinking (Stop), Starting… (Stop), Stopped (black Start) |
| Model row | Name, description led by the publisher, a gray format column with the file format and quantisation ("Splash package", "GGUF · Q4_K_M"), size, action. **Naming rule:** the Splash package carries the plain model name; any other version of a model that is also on screen carries its version in the title, "Qwen3.8-27B (GGUF 4-bit)", in the list, the title pop-up and Launch settings alike. In Available, a model with several downloadable versions is one row, App Store style: plain name, "3 more versions" in its help line, and a Version pop-up in the format column whose menu lists each version with publisher, size and the Mac it suits; choosing one updates the size, the help line and what Get downloads | Installed (Run, a trailing chevron and a light hover fill, because the row opens that model's launch settings), available (Get), downloading (ring) |
| Agent row | 32 px icon tile, name, description, action | Installed (Open), not installed ("Not installed" and Get ↗) |
| Copy row | Label, monospace value, copy button (and reveal for the key) | Rest, copied, revealed |
| Sheet | Title and subtitle, close button, scrolling body, optional footer with status note and buttons | Opening (rises 10 px and fades), open, closing. Launch settings follows the model it was opened from: for the running model the footer says "Restart required to apply changes" once a setting differs from what the server runs (here the 128K context) and the primary is Save and restart; for another installed model the footer says "Stops Qwen3.8-27B and starts this model." and the primary is Run Qwen3.6-35B-A3B. **First-run sheets** don't hide the welcome: it stays under the scrim and lifts (250 ms) so its title, subtitle and three steps sit at the top of the window, the mark, the button and the compatibility line fade, and the sheet hangs 28 px below the steps, so you can see which step it belongs to |
| Settings dialog | Close button, vertical tab list, a fixed 20 px page title, a scrolling panel of inset groups below it | One tab selected; scrolled (rows fade under the title over 16 px, exactly like a sheet header) |
| Terminal | Dark monospace panel filling a 90%-height sheet; header with the agent's icon tile, folder and an "Open in Terminal ↗" pill; footer saying "Claude Code is running · Hide keeps the session going" with End session and Hide (the default). There is no ✕, so closing never ends an agent by accident. Text sits on a 20 px line grid (boxes add exactly one line), scrolls inside the clipped panel and fades over 8 px at the top | Running, exited (not shown); opens scrolled to the prompt and snapped to a whole line, so no box or glyph is sliced at the top |
| Log | Monospace lines in two columns: a time on every line (Splashboard stamps each line as it arrives) and the message, at most 84 characters wide, which wraps with a hanging indent under itself; model ids never break at their hyphens; a red dot in the gutter for errors; All/Requests/Errors filter | Scrolled to the newest line on open |
| First-run steps | Numbered rows in one inset group, one black primary below | Upcoming (outlined number), current (filled black number), done (check on a light fill, and the help line says what was done: "Splash 1.2.0 is installed.", "Downloaded, 17.6 GB."), starting (the Start row shows the phase and a progress line; the primary reads Starting… and is disabled) |

## Screens

1. **Chat** (home). Mid-conversation: an earlier finished turn with a collapsed "Thought for 8 seconds", a paragraph, a code block and a list; the latest question carries a screenshot above its bubble; the latest turn shows the shimmering "Thinking…" with its live reasoning, then streams the answer. The engine row reads Thinking, the composer is empty and the send button is a stop button while it runs. `chat-stats` scrolls up to the earlier turn and shows its inline stats; `chat-done` is the finished turn with a new draft and an image chip in the composer; `chat-collapsed` and `engine-collapsed` show the hidden sidebar; `chat-effort` shows the thinking menu; `model-menu` the title pop-up; `engine` shows the engine popover; `new-chat` is the empty state (nothing in the sidebar is selected). `search`, `search-results` and `search-empty` show Search chats focused, filtered to "Splash", and with no match.
2. **Server stopped or starting** (every screen). The sidebar row, the collapsed-toolbar pill, the model menu and the Models card all use the same four words: Ready, Thinking, Starting…, Stopped. `chat-stopped` keeps the conversation readable and the composer fully usable, with the status line "Qwen3.8-27B isn’t running. Sending a message starts it." inside its top edge; `chat-stopped-draft` shows a typed draft with an image and an enabled Send; `new-chat-stopped` is the empty state with the same line. `engine-stopped` is the popover with one black Start and no numbers; `chat-starting` and `engine-starting` show the orange dot, "Starting…" and "Loading weights · 3 s" with a thin progress line. `activity-stopped` swaps Restart and Stop for Start, shows dashes with "Not running" under them and an empty chart that says why; `activity-starting` puts the phase and progress line at the end of the status line, says "Starting…" on each card and offers one Stop. Nothing below the header moves between the three states. `models-stopped` and `connect-stopped` show the same state on those pages; Connect says "Opening an agent starts it first", which is how Send behaves too.
3. **Activity**. Engine state with Restart and Stop, centred on the title's line; four summary cards: Speed ("Average over 10 seconds"), Draft acceptance (7 dots, "5.6 of 7 kept"), Memory (31.4 of 48 GB and a meter) and Prompt cache ("Reused in the last hour"). Below them, drawn on the window with no box, the tokens-per-second chart for the last minute. "Show details" reveals one column of six small groups in this order: Requests ("1 of 4 at once"), Speed, Working memory (in GB), Prompt cache, Engine, Images; then a "Show log" button that opens the log sheet.
4. **Models**. The running model on top, then Installed and Available lists with Run, Get and one download in progress, all in one 60 px action column. Each row's title is unique: other versions of a model carry their version in the title, and the three downloadable versions of Qwen3.8-27B are one row with a Version pop-up (`models-versions`). Installed rows carry a chevron and open their own launch settings.
5. **Launch settings** (sheet). A preset pop-up ("Recommended for this Mac (64 GB)"), then Model (model, draft model with its help line, default thinking, text only, offline), Memory & context, Cache (working memory as Compact (8-bit) or Full (16-bit), SSD cache), Network & security (port, listen on, Require an API key with the masked key and a Regenerate… text button under it while it's on, allowed web origins) and Advanced groups built from the real `splash serve` flags, each with a plain-English help line or footnote. Advanced ends in "More options" with Model revision, Model aliases, Extra host names, Largest request and SSD cache folder. Subtitle, Model pop-up, preset footnote, context and the command all follow the model the sheet was opened for (`launch-other`). "Show command" reveals the equivalent `splash serve …` command, rebuilt live from the sheet, with Copy; every value is written `--flag=value`, exactly as Splashboard spawns it.
6. **Connect**. Claude Code, OpenCode, Codex, Hermes (not installed) and Pi, each with Open; the API base URL, key and model with copy buttons. `agent-terminal` shows the large terminal sheet that Open launches, with Hide and End session.
7. **Settings** (dialog, ChatGPT layout). General (appearance, startup, server behaviour), Chat (default model and thinking; one sampling decision, the preset, with its values summarised and the seven controls behind "Customize", each with a one-line plain-English help; longest reply, seed), Downloads (Hugging Face token, folder, space used) and Updates (Splash 1.2.0, Check for updates, and Uninstall Splash… as a red row in its own group). The page title stays fixed while the panel scrolls. `settings-chat-custom`, `settings-downloads` and `settings-updates` show those states.
8. **First run**. A centred welcome with three steps and one primary button that names the next step: Install Splash, then Download Qwen3.8-27B, then Start. `first-run-install` and `first-run-download-sheet` show the progress sheets ("214 of 418 MB", "8.6 of 17.6 GB · about 3 min") hanging below the lifted title and steps, with "Show details" closed; `first-run-download` and `first-run-start` show steps already done with a check; `first-run-starting` shows the short start progress in the Start row. When Ready, the window opens on a new chat.

## Motion

| What | Duration | Easing |
| --- | --- | --- |
| Hover fills, colour changes, switch track | 150 ms | `cubic-bezier(.2,.8,.2,1)` (ease-out) |
| Popovers (fade, rise 4 px from 98% scale), disclosures (height and fade), switch knob, chevron rotation | 200 ms | ease-out |
| Sheets and dialogs (scrim fade, rise 10 px from 98.5%); the first-run welcome lifting under its sheet and its button fading | 250 ms | ease-out |
| "Thinking…" shimmer | 1.8 s loop | linear, a soft highlight across secondary gray text |
| Busy dot, streaming cursor, terminal caret | 1.2–1.6 s | gentle opacity pulse |

Nothing bounces, overshoots or ripples. With `prefers-reduced-motion: reduce`, the duration tokens drop to 0 (tokens.css) and every loop stops (index.html sets `animation: none` on `.shimmer`, `.dot.is-busy`, `.cursor` and the terminal caret, removes the shimmer gradient, so "Thinking…" is plain secondary text, and removes the easing on progress lines and the download ring, so they jump to each new value). Text still streams, because streaming is content, not decoration. `shots/chat-reduced-motion-*.png` are rendered with the setting on.

## Accessibility

Measured WCAG 2.2 contrast ratios:

| Text | On | Light | Dark |
| --- | --- | --- | --- |
| Primary | window / sidebar / group / bubble | 19.4 / 18.5 / 18.2 / 17.7 | 14.8 / 16.5 / 12.8 / 12.1 |
| Secondary | window / sidebar / group / bubble | 5.1 / 4.8 / 4.7 / 4.6 | 6.3 / 7.0 / 5.4 / 5.1 |
| Secondary | sheet group / popover / composer | 4.7 / 5.1 / 5.1 | 5.1 / 4.6 / 5.1 |
| Destructive (`--text-destructive`) | group | 5.0 | 4.7 |
| Tertiary | window | 3.3 (fails AA for small text) | 3.2 (fails) |
| Primary button label | primary button | 19.4 | 17.9 |
| Terminal dim text | terminal | 5.9 | 6.4 |

- Every readable piece of text, including placeholders, footnotes, the composer status line and code comments, uses primary or secondary. Tertiary is reserved for disabled text and the em dash on a summary card, which has the words "Not running" or "Starting…" under it and as its label.
- **Focus**: every control shows a 2 px accent ring with a 2 px offset on keyboard focus (`:focus-visible`), 3.6:1 against white and 4.4:1 against `#212121`. The composer shows a gray outline while focused, and the caret marks the field.
- **Colour is never the only signal**: every status dot sits next to a word (Ready, Thinking, Starting…, Stopped, Normal, Restart required). The error line in the log also says "Error". The red Uninstall row says what it does in its label and footnote.
- **Keyboard**: everything is a real `button`, `input` or `textarea`; model rows that open settings get `role="button"`, `tabindex="0"` and Enter/Space, and their Run button is labelled with the full row title and format. The Version pop-up is a menu button (`aria-haspopup="menu"`) whose label names the chosen version, and Get is labelled with the model and version it will download. Search chats keeps focus on the field while the clear button is pressed; Esc clears and closes it. While a popover, sheet or dialog is open, the window behind it is `inert` and Tab cycles through the overlay's controls, buttons included (WKWebView, like Safari, otherwise tabs to buttons only when macOS Keyboard navigation is on). Esc closes the top popover, sheet or dialog, and focus returns to the control that opened it. ⌘1–⌘4 reach every page with the sidebar hidden.
- **Semantics**: menus use `role="menu"` and `menuitemradio` with `aria-checked`; disclosures and pop-up triggers use `aria-expanded` and `aria-controls`; sheets are `role="dialog"` with `aria-modal`; the Settings tab list uses `tablist`, `tab`, `aria-selected` and `tabpanel`, and every panel is labelled by the fixed page title; meters and progress bars carry `role`, `aria-valuenow` and labels; the chart has a text alternative; icon-only buttons all have `aria-label`; the composer status line is `role="status"`. The streaming turn is not a live region (word-by-word updates would flood VoiceOver); a hidden `role="status"` element announces "Qwen3.8-27B is thinking" and "Response ready" instead.
- **Targets** are at least 24 px (the Regenerate… text button under the API key) and 28 px for everything else (icon buttons 30–36 px), at or above the 24 px WCAG 2.2 minimum.
- **Known gap**: the off-state switch track (10% black) is light, as on macOS. Its state is also carried by the knob position and the native checkbox role.

## Decisions and departures from the brief

- **One vocabulary for the engine.** Ready, Thinking, Starting… and Stopped, everywhere: the sidebar row, the toolbar pill, the popover, the model menu ("Splash package · Ready"), the Models card and Activity. "Running" is not used for the server (the terminal footer names the agent: "Claude Code is running"). Starting… keeps its ellipsis because it is a state in progress, as in macOS.
- **Start is always the black primary** where Start is a button: the popover, Activity and the Models card. Stop and Restart stay gray. In the composer the server needs no button at all, because Send starts it; the status line offers a quiet "Start now" text button for someone who wants it warm before they finish typing.
- **The stopped composer is not disabled.** An earlier round put a gray "isn’t running · Start" box above a half-disabled composer. Connect already promises "Opening an agent starts it first", so chat now keeps the same promise: the composer stays fully enabled, Send starts the server and the message goes once it's ready, and the notice is one line inside the composer. This replaces the "stopped and starting notices above the composer" of the previous round.
- **Scroll edges fade instead of a toolbar hairline.** Both are macOS behaviours; the fade keeps the window free of lines, as ChatGPT does, and it also solves the composer edge and the Settings title, which a hairline cannot.
- **The model picker lives in the title, not the composer.** The direction asks for a title-style pop-up at the top left, like ChatGPT. Having a second model pop-up in the composer would be redundant, so the composer carries only "+", the attachment chip, the thinking pop-up and send/stop.
- **One name per model version.** "Qwen3.8-27B" alone always means the Splash package. Another version that is installed or downloading carries its version in the title ("Qwen3.8-27B (GGUF 4-bit)", "Qwen3.6-35B-A3B (GGUF 4-bit)") in the Models list, the title pop-up and Launch settings, and the downloadable versions of one model are one row with a Version pop-up, as the App Store groups an app's editions. No two rows on any screen share a title.
- **"Open Models ⌘3" rather than "Models…"** in the engine popover. An ellipsis in a macOS menu means "asks for more before acting"; going to a page doesn't, and the item sits under "Open Activity ⌘2", so it reads as the pair. Connect stays one key away (⌘4) and one click away with the sidebar shown; the engine popover keeps to the engine's own pages.
- **Reasoning is called Thinking** in the composer, its menu and Settings, as splash-params.json labels the `reasoning_effort` request field. The levels are None / Low / Medium / High, as the brief asks, and map to `none`, `low`, `medium` and `xhigh` (splash-api.md §14.6). The pill names the level with the noun ("Medium thinking") so it reads on its own.
- **Context is 128K** as the brief specifies. The launch settings show it as a user change from "Automatic (256K)", which is what a 64 GB M3 Max measures, so the "Restart required" note has a real cause.
- **Working memory precision is "Compact (8-bit)" or "Full (16-bit)"**, not "8-bit | BF16", which supersedes the previous round's labels. BF16 is a number format, not a word people use; the footnote says what each choice costs. The flag values (`int8`, `bf16`) are unchanged in the command.
- **Sliders use a plain gray track** with no accent fill. Bipolar ranges (penalties) would otherwise look half-set at zero, and many sliders on one page turned the accent into decoration.
- **Settings is a ChatGPT-style dialog** with a left tab list, but its rows are System Settings inset groups and its title is fixed like a sheet header, so all forms in the app look and scroll the same.
- **"Thinking" is the busy label** for the engine row, as specified. The Activity header and the collapsed-sidebar toolbar use the same word so they never disagree.
- **One name per cache.** "Prompt cache" is prefix reuse (the Activity card and its detail group); "SSD cache" is its disk tier (size, keep across restarts, folder); "Working memory" is the KV cache, a term that appears only once, in a footnote, to explain it. Working memory is shown in GB: Splash reports pages, Splashboard multiplies by the page size. The per-turn stats keep "cached tokens", the API's own word.
- **"Average over 10 seconds"** on the Speed card, rather than the longer "Average over the last 10 seconds": at 12 px the longer line is 186 px and the card's text column is 175 px, so it would run into the padding. "5.6 of 7 kept" is shortened for the same reason.
- **The chart has no box.** Four filled cards and a filled chart read as a dashboard template. The chart is drawn on the window under a section label, like the charts in Health and Stocks, and the fill stays on the four numbers that are meant to be read at a glance.
- **No `--verbose` row.** It is not a `splash serve` flag: splash-params.json lists it only as an argument Splash passes to Claude Code's headless mode. Diagnostics that do exist are Record crash traces (`SPLASH_CRASH_TRACE`) and the log sheet, which shows everything Splash prints. Every flag in "Show command" exists in splash-params.json, and every value is written `--flag=value` (`--port=8000 --max-context=128K --max-cache-disk=32G`), the form `conventions.pass_as.argv` specifies, so what is copied is exactly what Splashboard spawns. Switches (`--persistent-cache`) stay bare.
- **Reply share uses five stops** (0, 0.25, 0.5, 1, 2) so Splash's default, 0.5, sits in the middle of the track. `--decode-share` has no upper bound and the UI soft maximum is 4, but a linear 0–4 track would park the default near "Long prompt first". The command lists the flag only when it differs from 0.5.
- **Red text, once.** Uninstall uses `--text-destructive`, the increased-contrast system red, rather than `--status-error`, because the dot red is 3.3:1 as 13 px text.
- **The attachment chip appears only on a draft.** The brief asks for an image chip in the composer. A chip left there while a reply streams reads as "not sent yet", so the sent image moves above its bubble in the thread and the composer stays empty while generating; the chip is shown in `chat-done` and `chat-stopped-draft`, on the next message being drafted. The new-chat composer stays empty so its send button stays disabled.
- **First-run logs start closed.** The install and download sheets open with "Show details" collapsed, so each sheet fits below the welcome's steps at 1280×820. The log is one click away and the exact command is always in the footer.
- **The light/dark toggle is Settings › General › Appearance** (System by default), not a toolbar button, so the top-right corner stays empty as in ChatGPT. ⇧⌘L flips the theme for reviewing the mockup only.
- **Images in the thread are content.** The screenshot above the user's bubble and the chart in the chip are drawn as inline SVG so the file stays self-contained; they are the user's images, not interface colour.

## Where the numbers come from

So the React build can wire each number to Splash (see `docs/splash-api.md`):

| UI | Source |
| --- | --- |
| Speed (tok/s), chart | Δ`metrics.decode_output_tokens` / Δt between two `/status` polls (§9.1), 1–2 Hz; the card averages the last 10 s |
| Draft acceptance, 7 dots | Δ`accepted_draft_tokens` / Δ`drafted_tokens`; 7 drafted per step, so 0.80 ≈ 5.6 of 7 kept |
| Memory 31.4 of 48 GB | `memory_actual.current_bytes` / `memory_governor.limit_bytes` |
| Prompt cache, reused in the last hour | Δ`cache.kv_hit_tokens` / (Δ`cache.kv_hit_tokens` + Δ`metrics.prefill_input_tokens`) over the last hour (derived; `cache.hit_rate` is lifetime only) |
| In progress "1 of 4 at once", waiting | `scheduler.prefilling + decoding` of `memory_plan.budget.maximum_batch_width` (4), `admission.waiting` |
| Working memory in use 5.5 of 16 GB, kept for the prompt cache 4.6 GB | Pages × `memory_plan.budget.kv_page_bytes` (512 KiB here): in use = (`kv.pages_active` + `kv.pages_cache`) = 11,240 pages; kept = `kv.pages_cache` = 9,410 pages; capacity = `kv_capacity_pages` = 32,768 pages = 16 GB. Kept is always part of in use |
| Models use 54.8 GB | Sum of installed sizes: 17.6 + 20.4 + 16.8 GB (the download in progress is not counted) |
| Time to first token, typical and slowest 5% | `metrics.ttft_ms.p50` / `p95` |
| Per-turn stats line | Finish chunk `timings.predicted_per_second`, `metrics.request_latency.ttft_ms`, `usage.prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` |
| Engine state word | Ready = `/ready` 200 and idle; Thinking = `prefilling + decoding > 0`; Starting… = child alive and the probe refused or timing out (§4.2); Stopped = no child and refused |
| Start phase and progress | stdout lines `Loading ·` (Loading weights), `Weights loaded in` and `Kernel policy` (Warming up), `Ready ·` (done); seconds since spawn. About 25 s on this Mac, of which weights take about 3 s |
| Last ran today at 11:27 | Time of the last log line Splashboard received before the server stopped |
| Download progress | `Fetching N file(s), X GB` then the sum of blob sizes under the HF cache, `*.incomplete` included (§4.4); time left from the last 10 s of bytes |
| Model versions in the Version pop-up | The Hub repos and variants Splashboard knows for that model (`OWNER/REPO:VARIANT`), with each file's size from the Hub listing |
| Log lines | stdout/stderr grammar in §4.4, shown verbatim, each prefixed with the time Splashboard received it |
| Launch settings | `serve` entries in `docs/splash-params.json`; the command preview never includes the API key or HF token (they go in the environment) |

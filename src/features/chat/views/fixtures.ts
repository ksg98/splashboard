/**
 * Demo props for the chat views (gallery and tests). The numbers are the
 * reference's: a MacBook Pro M3 Max with 64 GB running Qwen3.8-27B as a Splash
 * package at about 92 tok/s, Splash 1.2.0 on 127.0.0.1:8000. Models are Splash
 * packages and MLX 4-bit models only.
 */
import type {
  AssistantTurn,
  ChatImage,
  ChatTurn,
  ComposerEngine,
  HistoryGroup,
  PickerModel,
  SearchableChat,
  Suggestion,
  UserTurn,
} from './types';

/* ---------- Images (the user's content, drawn as SVG so the fixtures stay self-contained) ---------- */

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const SANS = '-apple-system, Helvetica, sans-serif';

/** A terminal screenshot: the 503 the user hit. */
export const busyErrorImage: ChatImage = {
  id: 'img-busy',
  name: 'busy-error.png',
  alt: 'Terminal showing openai.InternalServerError 503 frontend_overloaded',
  sizeBytes: 182_000,
  src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 144" width="464" height="288">
<rect width="232" height="144" fill="#1E1E1E"/>
<g font-family="${MONO}" font-size="8" fill="#C7C7CC">
<text x="12" y="20"><tspan fill="#8E8E93">%</tspan> python ttft.py</text>
<text x="12" y="32.5">Traceback (most recent call last):</text>
<text x="17" y="45" fill="#8E8E93">File "ttft.py", line 5, in &lt;module&gt;</text>
<text x="22" y="57.5" fill="#8E8E93">for chunk in client.chat.completions</text>
<text x="12" y="70" fill="#F2F2F7" font-weight="600">openai.InternalServerError: Error code:</text>
<text x="12" y="82.5">503 - {'error': {'code':</text>
<text x="12" y="95">'frontend_overloaded', 'message':</text>
<text x="12" y="107.5">'frontend request capacity is exhausted'}}</text>
<text x="12" y="125"><tspan fill="#8E8E93">%</tspan></text>
</g>
<rect x="22" y="118.5" width="5" height="8.5" fill="#C7C7CC"/>
</svg>`),
};

const bars = [81.6, 11, 9.8, 10.6, 9.4, 17, 10.2, 9.6, 11.4, 10, 9.2, 10.8]
  .map(
    (h, i) =>
      `<rect x="${34 + i * 16}" y="${(112 - h).toFixed(1)}" width="10" height="${h}" rx="1.5"/>`,
  )
  .join('');

/** A chart the user is about to send: time to first token per request. */
export const ttftChartImage: ChatImage = {
  id: 'img-ttft',
  name: 'ttft-chart.png',
  alt: 'Bar chart of time to first token: the first request takes 3.4 s, the rest about 0.4 s',
  sizeBytes: 421_888,
  src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 144" width="464" height="288">
<rect width="232" height="144" fill="#FFFFFF"/>
<text x="14" y="20" font-family="${SANS}" font-size="9" font-weight="600" fill="#1C1C1E">Time to first token (s)</text>
<g stroke="#E5E5EA" stroke-width="0.8"><path d="M30 40H224M30 64H224M30 88H224M30 112H224"/></g>
<g font-family="${SANS}" font-size="7" fill="#8E8E93">
<text x="24" y="42.5" text-anchor="end">3</text><text x="24" y="66.5" text-anchor="end">2</text>
<text x="24" y="90.5" text-anchor="end">1</text><text x="24" y="114.5" text-anchor="end">0</text>
<text x="34" y="128">Request 1</text><text x="220" y="128" text-anchor="end">12</text>
</g>
<g fill="#3A3A3C">${bars}</g>
</svg>`),
};

/* ---------- Conversation ---------- */

const CODE_TTFT = [
  '```python',
  'import time',
  'from openai import OpenAI',
  'client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="local")',
  'start = time.perf_counter()',
  'for chunk in client.chat.completions.create(model="incoai/Qwen3.8-27B-Splash",',
  '        messages=[{"role": "user", "content": "Hello"}], stream=True):',
  '    if chunk.choices and chunk.choices[0].delta.content:',
  '        print(f"First token after {time.perf_counter() - start:.2f} s")',
  '        break',
  '```',
].join('\n');

const CODE_RETRY = [
  '```python',
  'import time',
  'from openai import OpenAI, APIStatusError',
  '',
  'client = OpenAI(base_url="http://127.0.0.1:8000/v1",',
  '                api_key="local", max_retries=0)',
  '',
  'def create_with_retry(attempts=5, **kwargs):',
  '    for _ in range(attempts):',
  '        try:',
  '            return client.chat.completions.create(**kwargs)',
  '        except APIStatusError as e:',
  '            if e.status_code != 503:',
  '                raise',
  '            time.sleep(float(e.response.headers.get("Retry-After", 1)))',
  '    raise RuntimeError("Splash stayed busy")',
  '```',
].join('\n');

const turnA: [UserTurn, AssistantTurn] = [
  { id: 'u1', role: 'user', content: 'What does draft acceptance mean on the Activity screen?' },
  {
    id: 'a1',
    role: 'assistant',
    status: 'done',
    content:
      'It’s the share of drafted tokens the main model keeps. A small draft model guesses 7 tokens ahead, and Qwen3.8-27B checks all of them in a single pass. At 0.8, about 5.6 of every 7 are kept, so each pass produces several tokens instead of one. That’s where most of the speed comes from.',
    stats: {
      tokensPerSecond: 88,
      timeToFirstTokenSeconds: 0.31,
      promptTokens: 2_530,
      cachedTokens: 2_402,
      thinkingTokens: 0,
      outputTokens: 74,
      finishReason: 'stop',
    },
  },
];

const turnB: [UserTurn, AssistantTurn] = [
  { id: 'u2', role: 'user', content: 'How do I measure time to first token from Python?' },
  {
    id: 'a2',
    role: 'assistant',
    status: 'done',
    thinkingSeconds: 8,
    reasoning:
      'They want time to first token from a script. Splash speaks the OpenAI API, so the official client with stream=True is the simplest path. The first chunk is the role chunk and carries no text, so skip chunks until one has content.\n\nWith thinking on, the first visible chunks are reasoning_content, which also counts. Worth mentioning that the first request after a long idle reloads the weights.',
    content: [
      'Stream the reply and time the first chunk that carries text. The OpenAI client works as is:',
      '',
      CODE_TTFT,
      '',
      '- It includes reading the prompt, so long prompts start later.',
      '- With thinking on, the first chunks carry `reasoning_content`. Count those too.',
      '- After 10 idle minutes Splash reloads the weights, which adds about 3 s once.',
    ].join('\n'),
    stats: {
      tokensPerSecond: 94,
      timeToFirstTokenSeconds: 0.42,
      promptTokens: 3_120,
      cachedTokens: 2_786,
      thinkingTokens: 418,
      outputTokens: 642,
      finishReason: 'stop',
    },
  },
];

const userC: UserTurn = {
  id: 'u3',
  role: 'user',
  content: 'Now make it retry when the server is busy.',
  images: [busyErrorImage],
};

const REASONING_C =
  'When the request queue is full, Splash answers 503 with the code frontend_overloaded and a Retry-After header. The OpenAI client already retries some errors by itself, so I’ll turn that off and honour Retry-After in a small loop, giving up after a few attempts.';

const ANSWER_C = [
  'When its request queue is full, Splash answers `503` with the code `frontend_overloaded` and a `Retry-After` header. Wait that long and try again, up to a few times:',
  '',
  CODE_RETRY,
  '',
  '`max_retries=0` turns off the client’s own retries, so the only wait is the one the server asks for.',
  '',
  '- Splash works on up to 4 requests at once and queues 32 more. Raise the queue in Launch settings › Advanced if your agents fill it.',
  '- `Retry-After` is in seconds, so the loop never asks faster than the server allows.',
].join('\n');

const statsC = {
  tokensPerSecond: 92,
  timeToFirstTokenSeconds: 0.38,
  promptTokens: 3_690,
  cachedTokens: 3_412,
  thinkingTokens: 286,
  outputTokens: 702,
  finishReason: 'stop' as const,
};

const history: ChatTurn[] = [...turnA, ...turnB, userC];

/** The latest reply is thinking: shimmering "Thinking…" over live reasoning. */
export const thinkingTurns: ChatTurn[] = [
  ...history,
  {
    id: 'a3',
    role: 'assistant',
    status: 'thinking',
    reasoning: REASONING_C.slice(0, 214) + '…',
    content: '',
  },
];

/** The answer is streaming; the reasoning has collapsed. */
export const streamingTurns: ChatTurn[] = [
  ...history,
  {
    id: 'a3',
    role: 'assistant',
    status: 'streaming',
    thinkingSeconds: 6,
    reasoning: REASONING_C,
    content: ANSWER_C.slice(0, ANSWER_C.indexOf('    for _ in range')).trimEnd(),
  },
];

/** The latest turn is finished. */
export const doneTurns: ChatTurn[] = [
  ...history,
  {
    id: 'a3',
    role: 'assistant',
    status: 'done',
    thinkingSeconds: 6,
    reasoning: REASONING_C,
    content: ANSWER_C,
    stats: statsC,
  },
];

/** The reply failed part way; Retry sends the same request again. */
export const errorTurns: ChatTurn[] = [
  ...history,
  {
    id: 'a3',
    role: 'assistant',
    status: 'error',
    thinkingSeconds: 6,
    reasoning: REASONING_C,
    content: ANSWER_C.slice(0, ANSWER_C.indexOf('```python')).trimEnd(),
    error: 'Splash stopped before the reply finished. The server log has the details.',
  },
];

/** The user pressed Stop while the answer streamed. */
export const cancelledTurns: ChatTurn[] = [
  ...history,
  {
    id: 'a3',
    role: 'assistant',
    status: 'cancelled',
    thinkingSeconds: 6,
    reasoning: REASONING_C,
    content: ANSWER_C.slice(0, ANSWER_C.indexOf('```python')).trimEnd(),
    stats: { ...statsC, outputTokens: 318, finishReason: 'cancelled' },
  },
];

/** A draft with an image, waiting in the composer. */
export const draftText = 'Here’s TTFT after the change. Why is the first request still slow?';
export const draftAttachments: ChatImage[] = [ttftChartImage];

/* ---------- Engine ---------- */

export const MODEL_NAME = 'Qwen3.8-27B';

export const engineReady: ComposerEngine = { state: 'ready', modelName: MODEL_NAME };
export const engineBusy: ComposerEngine = { state: 'busy', modelName: MODEL_NAME };
export const engineStopped: ComposerEngine = { state: 'stopped', modelName: MODEL_NAME };
export const engineStarting: ComposerEngine = {
  state: 'starting',
  modelName: MODEL_NAME,
  phase: 'Loading weights',
  elapsedSeconds: 3,
  progress: 0.3,
};

/* ---------- Model pop-up: Splash packages and MLX models only ---------- */

export const pickerModels: PickerModel[] = [
  { id: 'incoai/Qwen3.8-27B-Splash', name: 'Qwen3.8-27B', detail: 'Splash package · Ready' },
  {
    id: 'incoai/Qwen3.6-35B-A3B-Splash',
    name: 'Qwen3.6-35B-A3B',
    detail: 'Splash package · 20.4 GB',
  },
  {
    id: 'mlx-community/Qwen3.8-27B-4bit',
    name: 'Qwen3.8-27B (MLX 4-bit)',
    detail: 'mlx-community · 15.6 GB',
  },
  {
    id: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
    name: 'Qwen3.8-27B (MLX 4-bit, LM Studio)',
    detail: 'lmstudio-community · 15.6 GB',
  },
];

export const pickerValue = 'incoai/Qwen3.8-27B-Splash';

/* ---------- New chat ---------- */

export const suggestions: Suggestion[] = [
  {
    id: 's-diff',
    label: 'Review a diff',
    icon: 'code',
    prompt: 'Review this diff and point out bugs:\n\n',
  },
  {
    id: 's-script',
    label: 'Write a script',
    icon: 'terminal',
    prompt: 'Write a shell script that ',
  },
  {
    id: 's-shot',
    label: 'Describe a screenshot',
    icon: 'image',
    prompt: 'Describe this screenshot.',
  },
  { id: 's-explain', label: 'Explain a concept', icon: 'book', prompt: 'Explain ' },
];

/* ---------- Sidebar history ---------- */

export const historyGroups: HistoryGroup[] = [
  {
    label: 'Today',
    items: [
      { id: 'c-ttft', title: 'Time to first token in Python' },
      { id: 'c-compare', title: 'Compare 27B and 35B-A3B' },
      { id: 'c-backoff', title: 'Status poller backoff' },
    ],
  },
  {
    label: 'Yesterday',
    items: [{ id: 'c-pty', title: 'PTY bridge for coding agents' }],
  },
  {
    label: 'Previous 7 days',
    items: [
      { id: 'c-notes', title: 'Summarize the Splash 1.2 notes' },
      { id: 'c-context', title: 'Context length for coding agents' },
      { id: 'c-regex', title: 'Regex for Splash log lines' },
      { id: 'c-sidebar', title: 'Sidebar animation timing' },
    ],
  },
  {
    label: 'Older',
    items: [
      { id: 'c-models', title: 'Plan the Models screen' },
      { id: 'c-mlx', title: 'Convert a model to MLX 4-bit' },
    ],
  },
];

export const activeChatId = 'c-ttft';

/* ---------- Search chats ---------- */

const chatText: Record<string, string> = {
  'c-ttft':
    'How do I measure time to first token from Python? Stream the reply and time the first chunk that carries text. When its request queue is full, Splash answers 503 with the code frontend_overloaded and a Retry-After header.',
  'c-compare':
    'Qwen3.6-35B-A3B is a mixture of experts: 35B weights, about 3B active per token, so it writes faster than the dense 27B on the same Mac.',
  'c-backoff':
    'Poll /status once a second while a request runs and every five seconds when idle. Back off to 30 seconds if the server stops answering.',
  'c-pty':
    'Open the agent in a pseudo-terminal so Claude Code keeps its colours and its prompt. Hide keeps the session going.',
  'c-notes':
    'Splash 1.2 accepts chat_template_kwargs in chat requests and renames the ttft latency stage to http_ttft.',
  'c-context':
    'Coding agents send long prompts. With 128K context and the SSD cache on, the prompt cache keeps them ready across restarts.',
  'c-regex':
    'Each Splash log line starts with a level and a component. Match Loading, Weights loaded in and Ready to follow the start phases.',
  'c-sidebar':
    'Animate the sidebar width over 250 ms with an ease-out curve, and drop it to 0 ms when reduced motion is on.',
  'c-models':
    'The Models screen lists the running model on top, then Installed and Available, with Run and Get in one column.',
  'c-mlx': 'mlx-community/Qwen3.8-27B-4bit is a plain 4-bit MLX conversion that Splash can run.',
};

export const searchableChats: SearchableChat[] = historyGroups.flatMap((group) =>
  group.items.map((item) => ({
    id: item.id,
    title: item.title,
    group: group.label,
    text: chatText[item.id],
  })),
);

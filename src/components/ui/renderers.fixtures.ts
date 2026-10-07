/*
 * Demo props for the renderer primitives (Markdown, CodeBlock, Chart,
 * StatCard, MeterBar, DotsMeter). Gallery and tests only; not used by the app.
 *
 * Sample machine: MacBook Pro, M3 Max, 64 GB, Splash 1.2.0 on 127.0.0.1:8000.
 * Models are Splash packages and MLX 4-bit builds only.
 */
import type { ChartData } from './Chart';

export const answerMarkdown = `Both run well on a 64 GB M3 Max. The short version: **Qwen3.8-27B** is the steadier choice for long coding sessions, and **Qwen3.6-35B-A3B** answers faster, because only about 3B of its parameters work on each token.

## Side by side

| | Qwen3.8-27B | Qwen3.6-35B-A3B |
| --- | ---: | ---: |
| Package | \`incoai/Qwen3.8-27B-Splash\` | \`incoai/Qwen3.6-35B-A3B-Splash\` |
| Speed on this Mac | 92 tok/s | 118 tok/s |
| Drafts kept | 5.6 of 7 | 5.1 of 7 |
| Memory at 128K context | 31.4 GB | 36.2 GB |

## Try it yourself

Start the server with the model you want. Every value is written \`--flag=value\`, the way Splashboard launches it:

\`\`\`bash
splash serve --model=incoai/Qwen3.8-27B-Splash --port=8000 --max-context=128K
\`\`\`

Then time the first token from any OpenAI client:

\`\`\`python
import time
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="local")
start = time.perf_counter()
for chunk in client.chat.completions.create(
    model="incoai/Qwen3.8-27B-Splash",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
):
    if chunk.choices and chunk.choices[0].delta.content:
        print(f"First token after {time.perf_counter() - start:.2f} s")
        break
\`\`\`

## Which one to pick

1. **Coding agents** (Claude Code, OpenCode, Codex): Qwen3.8-27B. Its tool calls stay reliable deep into a long context.
2. **Quick questions and drafts**: Qwen3.6-35B-A3B.
3. **Short on memory**: an MLX 4-bit build such as \`mlx-community/Qwen3.8-27B-4bit\`.
   - Its weights take about 16 GB.
   - Pick it under Models › Versions.

> Splash keeps the weights in memory for 10 minutes after the last request. The first request after that reloads them, which adds about 3 s once.

- [x] Installed \`incoai/Qwen3.8-27B-Splash\`
- [ ] Try \`lmstudio-community/Qwen3.8-27B-MLX-4bit\`

The [model card](https://huggingface.co/incoai/Qwen3.8-27B-Splash) lists the full benchmark table.`;

/** The same reply, cut off while the Python block is still arriving. */
export const streamingInCode = answerMarkdown.slice(
  0,
  answerMarkdown.indexOf('    stream=True,') + '    stream=True,'.length,
);

/** A shorter reply cut off mid-sentence in a list item. */
export const streamingInList = `When its request queue is full, Splash answers \`503\` with the code \`frontend_overloaded\` and a \`Retry-After\` header. Wait that long and try again:

- Splash works on up to 4 requests at once and queues 32 more.
- \`Retry-After\` is in seconds, so the loop never asks faster than`;

export const codeSamples = {
  python: `import time
from openai import OpenAI, APIStatusError

client = OpenAI(base_url="http://127.0.0.1:8000/v1",
                api_key="local", max_retries=0)

def create_with_retry(attempts=5, **kwargs):
    for _ in range(attempts):
        try:
            return client.chat.completions.create(**kwargs)
        except APIStatusError as e:
            if e.status_code != 503:
                raise
            time.sleep(float(e.response.headers.get("Retry-After", 1)))
    raise RuntimeError("Splash stayed busy")`,
  bash: `# Serve the MLX 4-bit build on the default port
splash serve --model=mlx-community/Qwen3.8-27B-4bit --port=8000 --max-context=128K

curl -s http://127.0.0.1:8000/v1/models | jq '.data[].id'`,
  json: `{
  "id": "incoai/Qwen3.8-27B-Splash",
  "object": "model",
  "owned_by": "incoai",
  "max_model_len": 131072,
  "vision": true
}`,
  long: `splash serve --model=incoai/Qwen3.6-35B-A3B-Splash --port=8000 --max-context=128K --max-cache-disk=32G --persistent-cache --queue-size=32 --decode-share=0.5`,
};

/* ---------- Activity ---------- */

export const statSample = {
  speed: { value: '92', unit: 'tok/s', caption: 'Average over 10 seconds' },
  acceptance: { value: '80', unit: '%', kept: 5.6, of: 7, caption: '5.6 of 7 kept' },
  memory: { value: '31.4', unit: 'of 48 GB', used: 31.4, total: 48 },
  cache: { value: '87', unit: '%', caption: 'Reused in the last hour' },
};

/** Decode speed, as in the reference: steady near 92 tok/s with one dip while a long prompt is read. */
export function tokensPerSecondAt(step: number): number {
  const value =
    92 +
    2.4 * Math.sin(step * 0.9) +
    1.7 * Math.sin(step * 2.3 + 1) +
    1.0 * Math.sin(step * 5.1 + 2) -
    31 * Math.exp(-((step - 35) ** 2) / 5);
  return Math.round(value * 10) / 10;
}

/** One minute of samples at 1 Hz, ending at `end` (unix seconds). */
export function tokensPerSecondMinute(end = 1_780_000_000): ChartData {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let step = 0; step < 60; step += 1) {
    xs.push(end - 59 + step);
    ys.push(tokensPerSecondAt(step));
  }
  return [xs, ys];
}

/** Same minute with a 6 s gap where the server was not answering. */
export function tokensPerSecondWithGap(end = 1_780_000_000): ChartData {
  const [xs, ys = []] = tokensPerSecondMinute(end);
  return [xs, ys.map((value, index) => (index >= 14 && index < 20 ? null : value))];
}

export const chartSeries = [{ label: 'Tokens per second', unit: 'tok/s' }];

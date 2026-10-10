#!/usr/bin/env python3
"""Decode speed of any OpenAI-compatible local server (Splash, MTPLX, oMLX...).

    python3 scripts/bench-decode.py http://127.0.0.1:8000 incoai/Qwen3.8-27B-Splash splash

One warm-up request, then RUNS streamed requests (512 tokens, temperature 0,
thinking off). Decode tok/s is (completion tokens - 1) / (last token time -
first token time), so prompt processing is left out. Prints each run and the
median. Standard library only.
"""
import json
import statistics
import sys
import time
import urllib.request

PROMPT = (
    "Write a detailed, well-structured explanation of how a hash map works, "
    "including hashing, collisions, resizing and complexity. Use plain prose."
)


def run_once(base: str, model: str, max_tokens: int) -> dict:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": True,
        "stream_options": {"include_usage": True},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    request = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        json.dumps(body).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer local"},
    )
    start = time.time()
    first = last = None
    chunks = 0
    usage = None
    with urllib.request.urlopen(request, timeout=900) as response:
        for raw in response:
            line = raw.decode().strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except ValueError:
                continue
            if event.get("usage"):
                usage = event["usage"]
            for choice in event.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning"):
                    now = time.time()
                    chunks += 1
                    first = first or now
                    last = now
    tokens = (usage or {}).get("completion_tokens") or chunks
    decode = (tokens - 1) / (last - first) if first and last and last > first else 0.0
    return {"ttft_s": first - start if first else None, "tokens": tokens, "decode_tps": decode}


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    base, model, label = sys.argv[1:4]
    runs = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    max_tokens = int(sys.argv[5]) if len(sys.argv) > 5 else 512
    run_once(base, model, max_tokens)  # warm-up
    results = [run_once(base, model, max_tokens) for _ in range(runs)]
    for result in results:
        print(label, json.dumps({k: round(v, 2) if isinstance(v, float) else v for k, v in result.items()}))
    print(f"{label}: median decode {statistics.median(r['decode_tps'] for r in results):.1f} tok/s")


if __name__ == "__main__":
    main()

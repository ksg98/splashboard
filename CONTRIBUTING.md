# Contributing to Splashboard

Thanks for helping. A few ground rules keep parallel work painless.

## Setup

See [README.md](README.md#requirements). Then run `pnpm install` and `pnpm dev`
(desktop) or `pnpm web` (browser).

## Before you open a PR

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm check:rust    # if you touched src-tauri
```

All four must pass, and lint must report no warnings.

## Where to put things

- Feature work stays inside `src/features/<name>/`. Features don't import
  each other. Put shared code in `src/lib` or `src/components/ui`, through a PR
  that says why.
- Styling uses Tailwind utilities backed by tokens (`bg-surface`, `text-fg`).
  If you need raw CSS, use `var(--sb-*)`. Don't use literal colours, radii or
  font names.
- Talk to Splash only through `getSplashClient()` / `getTransport()`, never
  with `fetch`. The webview's origin is refused by Splash.
- Don't change the frozen files listed in the README (dependency manifests,
  configs, app shell, transport) as part of a feature PR. If you need a change
  there, open a separate PR for it.
- Every feature folder keeps its own tests (`*.test.ts(x)` next to the code).

## Commits and PRs

Keep PRs small and focused on one thing. In the description, say what changed
and how you checked it. By contributing, you agree that your contributions are
licensed under Apache-2.0.

Splashboard is not affiliated with Inco. Don't copy code or assets from
other Splash front-ends into this repository.

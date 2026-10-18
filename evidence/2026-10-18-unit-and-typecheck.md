# Unit and typechecking validation — 2026-10-18 UTC

Scope: mocked extension lifecycle and pure pool selection only. **Not** LT-01–LT-07; no live OMP process or provider response was exercised.

- Repository branch: `feat/instance-model-pool-runtime`.
- Runtime: Node 22.16.0 (via `npx node@22.16.0`), npm 10.8.2 for installation.
- TypeScript: 5.8.3; published `@oh-my-pi/pi-coding-agent@18.12.1` type definitions; `@types/node@22.20.5`.
- Install: `NODE_OPTIONS=--max-old-space-size=384 npm ci --ignore-scripts --omit=optional --maxsockets=2 --no-audit --no-fund` — completed. A prior unbounded `npm ci` was killed by the sandbox's 1 GiB memory limit.
- Typecheck: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — exit 0.
- Tests: `npx --yes node@22.16.0 --experimental-strip-types --test test/*.test.ts` — **28 passed, 0 failed, 0 skipped**.
- New regressions: named `branch` and `btw` session identities acquire independent pins; overlapping same-session notifications share one pending initialization and do not double-draw; activations across distinct sessions serialize and stale operations cannot append to a newer session; rollback rehydrates the originating persisted assignment; post-resume model restoration is corrected once, while later drift still halts.

Current upstream lifecycle inspection additionally used [OMP source](https://github.com/can1357/oh-my-pi/tree/dc4a66a84c6144a4d5f57233e3b150cd5e3b49cf) for event order and rollback. GitHub Actions CI for this new head must be checked separately.\n\nAdditional mocked regressions cover a stale activation rejection, a failed resume reassertion leaving the activation queue usable, and explicit stderr diagnostics without a TUI. See also the [actual OMP binary smoke](2026-10-18-headless-omp-synthetic.md), which uses a synthetic provider and remains outside LT-01–LT-07.\n\nThis validates TypeScript compatibility with published OMP types and internal mocked behavior, **not** OMP event delivery, actual first-request cancellation in headless mode, Advisor request-scoped abort, prewalk handoff prevention, authenticated providers, or live-provider pin immutability. Merge remains blocked by the acceptance requirements in [PLAN.md](../PLAN.md).

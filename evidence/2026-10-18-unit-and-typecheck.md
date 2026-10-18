# Unit and typechecking validation — 2026-10-18 UTC

Scope: mocked extension lifecycle and pure pool selection only. **Not** LT-01–LT-07; no live OMP process or provider response was exercised.

- Repository branch: `feat/instance-model-pool-runtime`.
- Runtime: Node 22.16.0 (via `npx node@22.16.0`), npm 10.8.2 for installation.
- TypeScript: 5.8.3; published `@oh-my-pi/pi-coding-agent@18.12.1` type definitions; `@types/node@22.20.5`.
- Install: `NODE_OPTIONS=--max-old-space-size=384 npm ci --ignore-scripts --omit=optional --maxsockets=2 --no-audit --no-fund` — completed. A prior unbounded `npm ci` was killed by the sandbox's 1 GiB memory limit.
- Typecheck: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — exit 0.
- Tests: `npx --yes node@22.16.0 --experimental-strip-types --test test/*.test.ts` — **22 passed, 0 failed, 0 skipped**.
- New regressions: named `branch` and `btw` session identities acquire independent pins; overlapping lifecycle callbacks share one pending initialization and do not double-draw.

This validates TypeScript compatibility with published OMP types and internal mocked behavior, **not** OMP event delivery, actual first-request cancellation in headless mode, Advisor request-scoped abort, prewalk handoff prevention, authenticated providers, or live-provider pin immutability. Merge remains blocked by the acceptance requirements in [PLAN.md](../PLAN.md).

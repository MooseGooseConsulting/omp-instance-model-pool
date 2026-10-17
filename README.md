# OMP Instance Model Pool

An OMP-native TypeScript extension that draws **one model per new main session or subagent**, then pins that instance to its assigned model. No per-turn classification, random switching, or external proxy.

## Status

**Experimental implementation for review; real OMP/provider live tests have not yet run.** The deterministic pure-selection and mocked lifecycle tests pass locally (20 tests, Node 22.14.0). See [the detailed plan](PLAN.md) and [installation and caveats](docs/INSTALL.md).

## Implemented

- Weighted random and optional in-process shuffle-bag distribution.
- Separate main, named-agent, and default subagent pools.
- Strict authenticated-model eligibility; empty subagent pools block dispatch.
- `before_subagent_spawn` chooses once per child and returns a concrete model.
- `session_start`, `session_switch`, and `session_branch` handle new, resumed, and forked main sessions.
- Model assignment saved as OMP custom session state; no re-draw on resume.
- Detection of unexpected model drift or fallback requests session shutdown.
- `/model-pool` reports the current assignment.

## Start

1. Copy [example pool JSON](examples/instance-model-pool.json) and replace the placeholder model IDs.
2. **Set `retry.modelFallback: false` in OMP** and avoid other model-routing extensions.
3. Install the entrypoint in [`src/extension.ts`](src/extension.ts) (with its adjacent `pool.ts`).
4. Run `npm test` for the deterministic and mocked tests.

**Caveat:** Detecting a native fallback after it happens does not guarantee interception before a request reaches the fallback model. Actual no-switch behavior and stop-on-error must be proven with live OMP/provider request traces before release. Optional shuffle-bag diversity is currently only process-local, not cross-process.

## Current review blockers

- Real OMP/provider acceptance scenarios LT-01–LT-07 are not yet validated. Unit tests only exercise a mocked OMP context.
- Native `ctx.shutdown()` can be a no-op in headless modes; the extension additionally invokes `ctx.abort()` at provider-request boundaries, but this must be proved against a real request path before pinning can be called fail-closed.
- OMP's `task.prewalk` and agent-level prewalk can deliberately change models mid-child. Disable prewalk in OMP config/agent definitions until real instrumentation confirms that this plugin can reject internal handoffs safely.
- Codex review is connected, but Codex coding tasks currently return “create an environment for this repo”; see [Codex environments](https://chatgpt.com/codex/cloud/settings/environments).

## Review sequence

- PR 1 — planning/design and acceptance gates (`initial-project-plan` into `main`).
- PR 2 — implementation, tests, example config, and CI (`feat/instance-model-pool-runtime` into `initial-project-plan`).

Merge the design PR first, then retarget the runtime PR to `main` for normal merging. No PR claims live-test success.

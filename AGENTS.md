# Repository development policy

Purpose: OMP-native extension selecting exactly one model **per newly created instance** (main session or subagent); never per prompt, tool invocation, or tool-loop continuation.

## Code Review Rules

- Verify behavior against *current upstream OMP code and actual event ordering*, not assumptions imported from Pi. Prefer source links for every OMP runtime claim.
- Check startup `--fork`, interactive fork, session switch and resume, and multiple notifications for a single destination identity.
- Reject changes that allow automatic provider fallback, prewalk, context promotion, internal model handoff, or manual switches to change the provider/model **within one instance** without detection and a fail-closed response.
- A model label in the TUI is not proof of backend identity: require provider request metadata or logs.
- A successful mocked unit test does not prove real OMP extension callbacks, tool-loop behavior, or provider failure handling.
- Avoid cosmetic or hypothetical findings not grounded in an executable path; prioritize concrete regressions, missing error barriers, and test gaps.
- Read `PLAN.md` for mandatory live acceptance scenarios LT-01 through LT-07. Never describe a mock-only PR as live-validated.
- Require passing CI and resolved valid review threads before merge. The integration PR must also provide evidence of real OMP and provider validation, including startup fork, headless, and prewalk cases.

## Routing limitations

OMP `before_subagent_spawn` fires once per *actual* child dispatch according to upstream `docs/extensions.md` (not during preflight). The plugin must assign exactly one concrete selector. In-process shuffle-bag diversity does not guarantee different models across independent OMP processes.

## External coding agents

Codex GitHub `@codex review` is connected in this repository. `@codex <coding task>` requires a separately configured Codex Cloud environment for this repository; do not report review connectivity as evidence that coding tasks are enabled. CodeRabbit/Devin/CodeAnt can independently identify findings, but reviewer comments are not fixes.

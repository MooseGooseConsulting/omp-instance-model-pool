# OMP Instance Model Pool — Implementation Plan

**Status:** Design prepared; implementation and live tests not started.  
**Target repository:** `MooseGooseConsulting/omp-instance-model-pool`

## 1. Deliverables

- Installable OMP TypeScript extension.
- Configurable model pools for main sessions and named subagents.
- Weighted random selection at instance creation, pinned for the instance lifetime.
- Durable assignments across resume, with reselection for new sessions and forks.
- Optional shuffle-bag distribution for parallel agents.
- `/model-pool` diagnostic command showing the selected model and routing reason.
- Automated tests, integration tests, and reproducible live-test results.

## 2. Implementation phases

### Phase A — Validate OMP lifecycle

- Pin and record the tested OMP version.
- Use `session_start` for initial session selection.
- Handle `session_switch` (new, resume, fork) and `session_branch` appropriately.
- Check `ctx.agent.kind` so spawned subagents are not rerouted by the main-session handler.
- Use `before_subagent_spawn` once per actual child dispatch.
- Confirm model assignment happens before the first provider request, in TUI and headless modes.
- Verify explicit `--model` overrides and interactions with other extensions.

**Exit criterion:** A minimal extension demonstrably selects an eligible model for a new instance without changing models during its execution.

### Phase B — Model pool engine

Implement a typed configuration file with independent pools:

```yaml
version: 1
strategy: weighted-random
pools:
  main:
    - model: provider/model-a
      weight: 3
    - model: provider/model-b
      weight: 2
  reviewer:
    - model: provider/model-c
      weight: 1
    - model: provider/model-d
      weight: 1
  subagent-default:
    - model: provider/model-a
      weight: 1
    - model: provider/model-b
      weight: 1
```

Requirements:

- Resolve selectors through OMP’s model registry.
- Exclude unavailable or unauthenticated models before drawing.
- Validate positive finite weights, malformed selectors, and missing pools.
- Make random-number generation injectable for deterministic tests.
- Do not silently introduce additional providers or paid fallback models.
- Return a clear error when no eligible model exists.

### Phase C — Session persistence

- Persist the selected model in an OMP custom session entry via `pi.appendEntry`.
- Restore from the session branch on resume.
- Treat a fork as a distinct instance even if it inherits parent session entries.
- Avoid duplicate selections during reloads or repeated lifecycle notifications.
- Keep existing assignments stable after pool configuration changes.
- Define explicit behavior when a persisted model is no longer available.

### Phase D — Subagent routing

- Select through `before_subagent_spawn` using the agent name, model role, and optional spawn key.
- Return one concrete model selector and a readable routing note.
- Handle concurrent subagent launches without shared-state races.
- Ensure retries and dispatch preflight do not consume additional random draws.
- Optionally implement shuffle-bag allocation with cross-process-safe state.
- Do not add model fallback chains that violate instance pinning.

### Phase E — Diagnostics and packaging

- Provide a `/model-pool` command for active assignment, pool membership, weights, and selection history.
- Produce structured diagnostics with session ID, agent role, selected provider/model, reason, OMP version, and outcome.
- Package using OMP’s supported extension conventions.
- Add installation and rollback instructions.
- Add CI for tests, linting, and TypeScript checks.

## 3. Automated test matrix

| Test | Required result |
|---|---|
| Weighted drawing | Deterministic seeds select expected models |
| Distribution | Large samples agree with configured probabilities within statistical tolerance |
| Invalid configuration | Rejected with actionable error |
| No eligible model | Explicit failure rather than unauthorized fallback |
| Repeat prompts | Original assignment unchanged |
| Subagent dispatch | Exactly one draw per child |
| Parallel launches | No duplicate assignment events or corrupted state |
| Resume | Original model restored |
| Fork | New assignment recorded |
| Provider failure | Assignment remains pinned; no silent model switch |
| Persisted missing model | Explicitly reported |
| Configuration change | Existing instances remain unaffected |

## 4. Mandatory live tests

Run the actual installed OMP binary against at least two functioning model/provider configurations. Record the version, model selectors, and provider responses. Mocked provider responses alone do not count as live validation.

### LT-01 — Real model diversity

Use deterministic pool configurations or individually pinned provider-selection fixtures to prove that **each** of at least two real provider/model endpoints can serve a new OMP instance. Separately launch at least 20 randomized new sessions to verify eligibility, assignment recording, and no in-session switching. Do not require both models to appear in a small independent random sample: even a correct weighted lottery can draw the same model every time. Statistical weight accuracy is covered by a large-seed automated distribution test, not by 20 live draws.

### LT-02 — Instance immutability

Send at least five sequential prompts and tool-driven continuations to a single instance. Verify every main request uses the same actual provider/model.

### LT-03 — Session boundaries

Exercise startup, `/new`, `/resume`, and `/fork`. Verify restoration and reselection against persisted assignment records.

### LT-04 — Parallel subagents

Spawn eight subagents concurrently, then make multiple calls within each. Verify independent selection, stable identity, and no routing races. Test shuffle-bag diversity separately from independent weighted sampling.

### LT-05 — Provider errors

Use a controlled provider returning 429/503, alongside a real working provider. Verify native OMP retry behavior cannot silently switch the pinned instance to another model.

### LT-06 — Actual provider verification

Compare the plugin’s selected model against provider-served model metadata or logs. Do not rely solely on the OMP UI label, especially with gateways that may implement internal routing.

### LT-07 — Headless execution

Repeat startup, routing, and resume checks in OMP’s supported noninteractive modes.

Each live test must produce a retained evidence artifact containing the executed command or interaction, selected model, actual request destination, expected outcome, observed outcome, and pass/fail result.

## 5. Acceptance gates

The first implementation is complete only when:

- Automated tests pass.
- Real OMP execution has demonstrated selection across at least two models.
- Main sessions and parallel subagents retain their assignments.
- Resume and fork semantics pass.
- No unapproved fallback or mid-instance model switching is observed.
- Live-test results and installation instructions are committed.

## 6. Reference implementations

- [OMP extension APIs and lifecycle, including documented `pi.appendEntry` persistence](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md#session-and-state-patterns).
- OMP subagent dispatch behavior.
- OMP extension event types.
- `pi-weighted-model-router`.

The weighted-router project provides reusable ideas for probability selection and persistence. The OMP-native extension should use OMP’s own lifecycle hooks rather than transplant Pi-specific assumptions.

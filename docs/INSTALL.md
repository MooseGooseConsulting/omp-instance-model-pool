# Installation and validation

**Status:** Experimental, not validated against live OMP or model providers. This is an initial implementation for review.

1. Install Oh My Pi (OMP) and authenticate at least two real models.
2. In `~/.omp/agent/config.yml`, configure `retry.modelFallback: false`; disable other extensions that route models mid-session. Native fallback and manual `/model` switching invalidate the instance-pinning guarantee.
3. Copy [the example pool](../examples/instance-model-pool.json) to `~/.omp/agent/instance-model-pool.json` and replace all placeholder selectors with exact authenticated `provider/model` IDs available in OMP.
4. Point OMP's `extensions` list at `src/extension.ts` in a local checkout (it imports `src/pool.ts` via a relative path), or install both files together at `~/.omp/agent/extensions/instance-model-pool/`.
5. Launch a new OMP instance and run `/model-pool` for the pinned model.

Set `OMP_INSTANCE_MODEL_POOL_CONFIG=/absolute/path/pools.json` to override the pool configuration file. A project-local `.omp/instance-model-pool.json` takes precedence over the global path when the environment override is unset.

## Validation status

`npm test` runs deterministic pure-selection tests and mocked OMP lifecycle tests, without real provider credentials. **Eleven local tests passed** on Node 22.16.0. This does **not** establish real OMP compatibility.

The acceptance plan in [PLAN.md](../PLAN.md) requires real OMP execution against two functioning models/providers, parallel subagents, resume/fork cycles, and provider-observed traffic. A UI model label does not prove which backend served a request.

Important limitation: `retry_fallback_applied` is emitted *after* a fallback and cannot proactively prevent it. `retry.modelFallback: false` is mandatory until real OMP tests establish end-to-end pinning, including provider failures. A failure to select the main model requests session shutdown; this must also be verified across TUI/headless modes.

Shuffle-bag state is held in the parent instance's process; there is no cross-process shared allocation in this initial implementation. Treat cross-process uniqueness as a separate enhancement and do not claim it here.

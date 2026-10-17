# OMP Instance Model Pool

An OMP-native TypeScript extension that selects a model once for each main session or subagent, pins that selection for the instance lifetime, and makes routing decisions observable.

## Status

Design prepared. Implementation and live-model validation have not started. See [PLAN.md](./PLAN.md) for the implementation phases and acceptance gates.

## Intended behavior

- Weighted random model selection when a main session or subagent instance is created.
- One pinned model per instance, with no prompt- or tool-call-level switching.
- Independent role pools for parallel agents, with optional shuffle-bag diversity.
- Resume restores the existing assignment; a fork receives a new assignment.
- Unavailable models and provider failures are reported explicitly, without silently switching to paid alternatives.

## Development status

The first milestone is to validate the OMP lifecycle and model-assignment APIs against a pinned OMP version. The extension should not be considered complete until the required automated tests and real OMP sessions using functioning providers have passed.

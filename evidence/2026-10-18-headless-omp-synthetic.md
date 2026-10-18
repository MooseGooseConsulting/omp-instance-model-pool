# Native OMP headless smoke — synthetic provider, 2026-10-18 UTC

**Status: narrow OMP-runtime integration proof, NOT a passing LT-01–LT-07 acceptance scenario.** PLAN.md requires two *real* functioning providers and retained traces across all seven live scenarios. This test uses an intentionally synthetic loopback HTTP server, so it cannot meet that requirement.

## Environment and setup

- OMP: published `@oh-my-pi/pi-coding-agent@18.12.1` CLI (`omp/18.12.1`); Bun 1.3.14; Linux x64.
- Tested extension: `feat/instance-model-pool-runtime` at `c3cf3c31fdb56eeca5b627aa570cc9f709cd662b`.
- Test provider: [loopback fixture](../test/fixtures/mock-openai-provider.py), `http://127.0.0.1:18771/v1`, OpenAI Chat Completions SSE. This server only echoes the requested model in its output and logs `path`, `model` and `stream`.
- Isolated OMP profile `omp-pool-lab` at `~/.omp/profiles/omp-pool-lab/agent/`, with `models.yml`:

```yaml
providers:
  fake:
    baseUrl: http://127.0.0.1:18771/v1
    api: openai-completions
    apiKey: local-test-only
    models:
      - { id: one, name: Synthetic One, contextWindow: 8192, maxTokens: 512 }
      - { id: two, name: Synthetic Two, contextWindow: 8192, maxTokens: 512 }
```

`config.yml`: `modelRoles.default: fake/two`; `retry.modelFallback: false`.

The loopback server ran as `python3 test/fixtures/mock-openai-provider.py`. The OMP command in both cases was:

```bash
OMP_INSTANCE_MODEL_POOL_CONFIG=/tmp/omp-instance-pool-fake.json \
  npx --yes bun@1.3.14 node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js \
  --profile omp-pool-lab --no-session --no-tools --no-title \
  --model fake/two -e ./src/extension.ts -p --mode json 'Say OK only'
```

For the negative case, substitute `/tmp/omp-instance-pool-fail.json`. Each config used `version:1`, `strategy:"weighted-random"`, and `subagent-default:[{model:"fake/two",weight:1}]`. The normal `main` pool contained only `fake/one` at weight 1; the negative `main` pool contained only nonexistent `fake/not-registered`.

## Observed results

| Check | Expected | Observation | Status |
|---|---|---|---|
| Headless selected endpoint | Select `fake/one` despite host startup `--model fake/two` | Exactly one logged `POST /v1/chat/completions` with JSON `model:"one", stream:true`; assistant response `synthetic ok`; process exit 0 | Pass (synthetic) |
| Empty eligible pool abort | No provider request on invalid pool | Exactly zero logged requests; stderr `[omp-instance-model-pool] initialization failed: Error: no authenticated/available models in pool main; refusing to route` | Pass (synthetic) |
| Failure exit semantics | Headless failure should be machine-detectable | **Exit code 0 despite abort**, with only a stderr diagnostic. The extension cannot rely on `ctx.shutdown()` to set a failing exit status | Open limitation |

The test used the actual OMP binary and native extension loader, not the mocked TypeScript test harness. The HTTP endpoint, responses and request tracing were synthetic, with no real model inference or authenticated provider.

## Remaining mandatory gates

No successful LT-01–LT-07 real-provider traces have been committed. In particular this does not establish first-provider-request cancellation for request-scoped Advisors, prevention of native prewalk model handoffs, an actual provider 429/503 fallback trace, session/fork boundary behavior, parallel subagent routing, or identity matching against genuine provider-side metadata. These remain merge blockers in [PLAN.md](../PLAN.md).

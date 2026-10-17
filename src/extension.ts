/** OMP-native entrypoint. Routing happens only at instance creation boundaries. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent';
import { PoolSelector, validateConfig, type Selection } from './pool.ts';

const ENTRY = 'dev.moosegoose.omp-instance-model-pool.assignment';
const ENV = 'OMP_INSTANCE_MODEL_POOL_CONFIG';
type Assignment = Selection & { at: string };
type Ctx = ExtensionContext;

function getConfigPath(cwd: string): string {
  if (process.env[ENV]) return process.env[ENV]!;
  const project = join(cwd, '.omp', 'instance-model-pool.json');
  if (existsSync(project)) return project;
  return join(homedir(), '.omp', 'agent', 'instance-model-pool.json');
}
function availableModels(ctx: Ctx): Set<string> {
  return new Set(ctx.models.list().map(m => `${m.provider}/${m.id}`));
}
function persisted(ctx: Ctx): Assignment | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== 'custom' || entry.customType !== ENTRY) continue;
    const record = entry.data as Partial<Assignment>;
    if (typeof record.model === 'string' && typeof record.pool === 'string' &&
        (record.strategy === 'weighted-random' || record.strategy === 'shuffle-bag'))
      return record as Assignment;
  }
  return undefined;
}

export default function instanceModelPool(pi: ExtensionAPI): void {
  let selector: PoolSelector | undefined;
  let assignment: Assignment | undefined;
  let halted = false;

  function getSelector(ctx: Ctx): PoolSelector {
    if (!selector) {
      const path = getConfigPath(ctx.cwd);
      selector = new PoolSelector(validateConfig(JSON.parse(readFileSync(path, 'utf8'))));
    }
    return selector;
  }
  function stop(ctx: Ctx, message: string): void {
    halted = true;
    ctx.ui.notify(`Model pool: ${message}`, 'error');
    ctx.shutdown();
  }
  async function apply(ctx: Ctx, selected: Assignment, append: boolean): Promise<void> {
    if (!availableModels(ctx).has(selected.model)) {
      stop(ctx, `pinned model unavailable: ${selected.model}`);
      return;
    }
    const model = ctx.models.resolve(selected.model);
    if (!model || `${model.provider}/${model.id}` !== selected.model || !await pi.setModel(model)) {
      stop(ctx, `cannot activate model ${selected.model}`);
      return;
    }
    assignment = selected;
    if (append) pi.appendEntry(ENTRY, selected);
    ctx.ui.setStatus('instance-model-pool', `pinned: ${selected.model}`);
  }
  async function initialize(ctx: Ctx, redraw: boolean): Promise<void> {
    if (ctx.agent.kind === 'sub') {
      // Parent before_subagent_spawn selected this model. Never draw twice.
      const model = ctx.models.current();
      if (!model) { stop(ctx, 'subagent started without a resolved model'); return; }
      assignment = {model:`${model.provider}/${model.id}`, pool:ctx.agent.name,
        strategy:'weighted-random', at:new Date().toISOString()};
      return;
    }
    try {
      const old = redraw ? undefined : persisted(ctx);
      if (old) { await apply(ctx, old, false); return; }
      const selection = getSelector(ctx).choose('main', availableModels(ctx));
      await apply(ctx, {...selection, at:new Date().toISOString()}, true);
    } catch (error) {
      stop(ctx, `initialization failed: ${String(error)}`);
    }
  }

  pi.on('session_start', async (_event, ctx) => initialize(ctx, false));
  pi.on('session_switch', async (event, ctx) => {
    halted = false;
    assignment = undefined;
    await initialize(ctx, event.reason !== 'resume');
  });
  pi.on('session_branch', async (event, ctx) => {
    if (event.reason !== 'fork') return;
    halted = false;
    assignment = undefined;
    await initialize(ctx, true);
  });
  pi.on('before_subagent_spawn', (event, ctx) => {
    if (halted) return {block:true, reason:'instance model pool initialization failed'};
    try {
      const selection = getSelector(ctx).choose(event.agent.toLowerCase(), availableModels(ctx));
      return {model:selection.model, note:`instance pool ${selection.pool}: pinned ${selection.model}`};
    } catch (error) {
      return {block:true, reason:`instance model pool: ${String(error)}`};
    }
  });
  pi.on('before_agent_start', (_event, ctx) => {
    if (halted) { ctx.shutdown(); return; }
    const actual = ctx.models.current();
    if (assignment && (!actual || `${actual.provider}/${actual.id}` !== assignment.model))
      stop(ctx, `model drift detected; expected ${assignment.model}`);
  });
  pi.on('retry_fallback_applied', (event, ctx) => {
    if (assignment) stop(ctx, `unexpected model fallback ${event.from} -> ${event.to}`);
  });
  pi.registerCommand('model-pool', {
    description:'Show the model pinned to this instance',
    handler: async (_args, ctx) => {
      ctx.ui.notify(assignment ? `Pinned ${assignment.model} from ${assignment.pool} (${assignment.strategy})`
        : 'No model-pool assignment recorded', 'info');
    },
  });
}

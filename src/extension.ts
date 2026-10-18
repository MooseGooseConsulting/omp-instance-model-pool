/** OMP-native entrypoint. Routing happens only at instance creation boundaries. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent';
import { PoolSelector, validateConfig, type Strategy } from './pool.ts';

const ENTRY = 'dev.moosegoose.omp-instance-model-pool.assignment';
const ENV = 'OMP_INSTANCE_MODEL_POOL_CONFIG';
type Assignment = { model: string; pool?: string; strategy?: Strategy; sessionId?: string; at: string };
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
  let selectorPath: string | undefined;
  let selectorContents: string | undefined;
  let assignment: Assignment | undefined;
  let assignedSessionId: string | undefined;
  let halted = false;
  // Concurrent lifecycle notifications for one destination must share one draw.
  const pendingInitialization = new Map<string, Promise<void>>();
  // OMP's transition scopes overlap; serialize activations across destination IDs.
  let activationTail: Promise<void> = Promise.resolve();
  // OMP overwrites the selected model *after* emitting session_switch(resume).
  let resumeReassertionId: string | undefined;

  function getSelector(ctx: Ctx): PoolSelector {
    const path = getConfigPath(ctx.cwd);
    const contents = readFileSync(path, 'utf8');
    // Reuse shuffle-bag state only for the exact same effective configuration.
    // A new project or changed config must never inherit another pool's selector.
    if (!selector || selectorPath !== path || selectorContents !== contents) {
      const config = validateConfig(JSON.parse(contents));
      selector = new PoolSelector(config);
      selectorPath = path;
      selectorContents = contents;
    }
    return selector;
  }
  function stop(ctx: Ctx, message: string): void {
    halted = true;
    ctx.ui.notify(`Model pool: ${message}`, 'error');
    // Headless OMP may supply a no-op shutdown callback. Abort the active turn too.
    // Optional: a context without abort must still reach shutdown.
    // Real provider tests are still required to establish whether this stops dispatch.
    ctx.abort?.();
    ctx.shutdown();
  }
  async function apply(ctx: Ctx, selected: Assignment, append: boolean): Promise<void> {
    // Never apply a selection belonging to a transition that another session superseded.
    if (selected.sessionId !== ctx.sessionManager.getSessionId()) return;
    if (!availableModels(ctx).has(selected.model)) {
      stop(ctx, `pinned model unavailable: ${selected.model}`);
      return;
    }
    const model = ctx.models.resolve(selected.model);
    if (!model || `${model.provider}/${model.id}` !== selected.model) {
      stop(ctx, `cannot resolve model ${selected.model}`);
      return;
    }
    const activated = await pi.setModel(model);
    // A different transition may have started while setModel was pending.
    if (selected.sessionId !== ctx.sessionManager.getSessionId()) return;
    if (!activated) {
      stop(ctx, `cannot activate model ${selected.model}`);
      return;
    }
    assignment = selected;
    assignedSessionId = selected.sessionId;
    if (append) pi.appendEntry(ENTRY, selected);
    ctx.ui.setStatus('instance-model-pool', `pinned: ${selected.model}`);
  }
  async function initialize(ctx: Ctx, redraw: boolean): Promise<void> {
    if (ctx.agent.kind === 'sub') {
      // Parent before_subagent_spawn selected this model. Never draw twice.
      const model = ctx.models.current();
      if (!model) { stop(ctx, 'subagent started without a resolved model'); return; }
      // Child only receives the chosen model. Parent pool/strategy metadata
      // is not transmitted by OMP; don't invent those values for diagnostics.
      assignment = {model:`${model.provider}/${model.id}`, at:new Date().toISOString()};
      return;
    }
    // Forks can produce both session_switch and session_branch notifications.
    // One destination session gets exactly one draw.
    const id = ctx.sessionManager.getSessionId();
    if (assignedSessionId === id && assignment) return;
    const pending = pendingInitialization.get(id);
    if (pending) { await pending; return; }
    const prior = activationTail;
    const initialization = (async () => {
      try {
        await prior;
        if (ctx.sessionManager.getSessionId() !== id) return;
        const old = redraw ? undefined : persisted(ctx);
        const inherited = old && (
          (old.sessionId && old.sessionId !== id) ||
          (!old.sessionId && !!ctx.sessionManager.getHeader()?.parentSession)
        );
        if (old && !inherited) {
          // Migrate legacy entries so future CLI startup forks can be distinguished.
          await apply(ctx, {...old, sessionId:id}, !old.sessionId);
          return;
        }
        const selection = getSelector(ctx).choose('main', availableModels(ctx));
        await apply(ctx, {...selection, sessionId:id, at:new Date().toISOString()}, true);
      } catch (error) {
        // A failed activation is not allowed to kill the newer session.
        if (ctx.sessionManager.getSessionId() === id)
          stop(ctx, `initialization failed: ${String(error)}`);
      }
    })();
    activationTail = initialization;
    pendingInitialization.set(id, initialization);
    try { await initialization; }
    finally {
      if (pendingInitialization.get(id) === initialization) pendingInitialization.delete(id);
    }
  }

  pi.on('session_start', async (_event, ctx) => initialize(ctx, false));
  pi.on('session_switch', async (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    if (assignedSessionId === id && assignment) return;
    halted = false;
    assignment = undefined;
    resumeReassertionId = undefined;
    await initialize(ctx, event.reason !== 'resume');
    if (event.reason === 'resume' && assignedSessionId === id && assignment)
      resumeReassertionId = id;
  });
  pi.on('session_branch', async (event, ctx) => {
    // Current OMP uses a new session identity for fork, branch and BTW promotion.
    // session_tree is the in-place rewind event; all new identities draw exactly once.
    if (assignedSessionId === ctx.sessionManager.getSessionId() && assignment) return;
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
  pi.on('before_agent_start', async (_event, ctx) => {
    if (ctx.agent.kind !== 'sub' && assignedSessionId !== ctx.sessionManager.getSessionId()) {
      // A failed OMP resume restores its original session but emits no rollback event.
      // Recover only its *persisted* pin, never re-draw at a request boundary.
      const id = ctx.sessionManager.getSessionId();
      const old = persisted(ctx);
      if (!old || (old.sessionId && old.sessionId !== id)) {
        stop(ctx, `no matching persisted pin for active session ${id}`);
        return;
      }
      halted = false;
      resumeReassertionId = undefined;
      await initialize(ctx, false);
    }
    if (halted) { ctx.abort?.(); ctx.shutdown(); return; }
    if (ctx.agent.kind !== 'sub' && resumeReassertionId === ctx.sessionManager.getSessionId() && assignment) {
      // The host's post-event model restore may have overridden our saved pin.
      // Reassert once for this resume, not once per prompt or tool call.
      const selected = assignment;
      const actualAfterSwitch = ctx.models.current();
      resumeReassertionId = undefined;
      if (!actualAfterSwitch || `${actualAfterSwitch.provider}/${actualAfterSwitch.id}` !== selected.model) {
        const prior = activationTail;
        const restore = (async () => {
          try {
            await prior;
            await apply(ctx, selected, false);
          } catch (error) {
            // Keep the activation queue usable after a failed resume correction.
            if (ctx.sessionManager.getSessionId() === selected.sessionId)
              stop(ctx, `failed to restore pinned model ${selected.model}: ${String(error)}`);
          }
        })();
        activationTail = restore;
        await restore;
      }
      if (halted) { ctx.abort?.(); ctx.shutdown(); return; }
    }
    const actual = ctx.models.current();
    if (assignment && (!actual || `${actual.provider}/${actual.id}` !== assignment.model))
      stop(ctx, `model drift detected; expected ${assignment.model}`);
  });
  pi.on('before_provider_request', (event, ctx) => {
    const actual = ctx.model ?? ctx.models.current();
    if (halted || !assignment || !actual || `${actual.provider}/${actual.id}` !== assignment.model)
      stop(ctx, `provider request attempted on ${actual ? `${actual.provider}/${actual.id}` : 'unknown'}; expected ${assignment?.model ?? 'no assignment'}`);
    // This hook provides best-effort abort, not a native request-blocking return.
    return event.payload;
  });
  pi.on('retry_fallback_applied', (event, ctx) => {
    if (assignment) stop(ctx, `unexpected model fallback ${event.from} -> ${event.to}`);
  });
  pi.registerCommand('model-pool', {
    description:'Show the model pinned to this instance',
    handler: async (_args, ctx) => {
      ctx.ui.notify(assignment ? `Pinned ${assignment.model}; ${assignment.pool ? `pool ${assignment.pool} (${assignment.strategy})` : 'parent-selected model; pool/strategy not supplied to child'}`
        : 'No model-pool assignment recorded', 'info');
    },
  });
}

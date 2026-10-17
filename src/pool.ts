/** Pure, deterministic instance-level model pool selection; no provider calls. */
export type Strategy = "weighted-random" | "shuffle-bag";
export type Candidate = { model: string; weight: number };
export type PoolConfig = {
  version: 1;
  strategy?: Strategy;
  pools: Record<string, Candidate[]>;
};
export type Selection = { model: string; pool: string; strategy: Strategy };
export type Random = () => number;

export function validateConfig(input: unknown): PoolConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("pool config must be an object");
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) throw new Error("pool config version must be 1");
  if (obj.strategy !== undefined && obj.strategy !== "weighted-random" && obj.strategy !== "shuffle-bag")
    throw new Error("strategy must be weighted-random or shuffle-bag");
  if (!obj.pools || typeof obj.pools !== "object" || Array.isArray(obj.pools))
    throw new Error("pools must be a map");
  const pools = obj.pools as Record<string, unknown>;
  if (!Array.isArray(pools.main) || !Array.isArray(pools["subagent-default"]))
    throw new Error("main and subagent-default pools are required");
  for (const [name, entries] of Object.entries(pools)) {
    if (name !== name.toLowerCase())
      throw new Error(`pool name ${name} must be lowercase`);
    if (!name.trim() || !Array.isArray(entries) || entries.length === 0)
      throw new Error(`pool ${name} must be a nonempty array`);
    const seen = new Set<string>();
    for (const raw of entries) {
      const c = raw as Candidate;
      // Provider and model id are split on the first slash. Model ids may contain
      // further slashes (for example OpenRouter ids such as anthropic/claude-sonnet-4).
      if (!c || typeof c.model !== "string" || !/^[^\s/]+\/\S+$/.test(c.model) || c.model.endsWith("/"))
        throw new Error(`invalid provider/model selector in ${name}`);
      if (!Number.isFinite(c.weight) || c.weight <= 0)
        throw new Error(`weights must be positive finite numbers in ${name}`);
      if (seen.has(c.model)) throw new Error(`duplicate model ${c.model} in ${name}`);
      if (obj.strategy === "shuffle-bag" && (!Number.isSafeInteger(c.weight) || c.weight > 1000))
        throw new Error(`shuffle-bag weights must be integers between 1 and 1000 in ${name}`);
      seen.add(c.model);
    }
    if (obj.strategy === "shuffle-bag" && (entries as Candidate[]).reduce((s, c) => s + c.weight, 0) > 2000)
      throw new Error(`shuffle-bag pool ${name} is too large (max 2000 slots)`);
  }
  return input as PoolConfig;
}

export class PoolSelector {
  private bags = new Map<string, string[]>();
  private readonly config: PoolConfig;
  private readonly random: Random;
  constructor(config: PoolConfig, random: Random = Math.random) { this.config = config; this.random = random; }

  choose(agent: string, available: ReadonlySet<string>): Selection {
    const pool = agent === "main" ? "main" : Object.hasOwn(this.config.pools, agent) ? agent : "subagent-default";
    const entries = this.config.pools[pool]!.filter((c) => available.has(c.model));
    if (entries.length === 0) throw new Error(`no authenticated/available models in pool ${pool}; refusing to route`);
    const strategy = this.config.strategy ?? "weighted-random";
    const pick = (max: number) => {
      const n = this.random();
      if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error("RNG must return a number in [0,1)");
      return Math.floor(n * max);
    };
    let model: string;
    if (strategy === "shuffle-bag") {
      const key = pool + "|" + entries.map((e) => e.model).join("|");
      let bag = this.bags.get(key);
      if (!bag?.length) {
        bag = entries.flatMap((c) => Array.from({ length: c.weight }, () => c.model));
        for (let i = bag.length - 1; i > 0; i--) {
          const j = pick(i + 1);
          [bag[i], bag[j]] = [bag[j]!, bag[i]!];
        }
        this.bags.set(key, bag);
      }
      model = bag.pop()!;
    } else {
      const total = entries.reduce((sum, c) => sum + c.weight, 0);
      if (!Number.isFinite(total)) throw new Error(`weight total overflow in ${pool}`);
      const n = this.random();
      if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error("RNG must return a number in [0,1)");
      let draw = n * total;
      model = entries[entries.length - 1]!.model;
      for (const entry of entries) {
        draw -= entry.weight;
        if (draw < 0) { model = entry.model; break; }
      }
    }
    return { model, pool, strategy };
  }
}

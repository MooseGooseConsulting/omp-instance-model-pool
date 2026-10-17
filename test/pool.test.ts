import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PoolSelector, validateConfig, type PoolConfig } from '../src/pool.ts';

const config: PoolConfig = {
  version: 1,
  pools: {
    main: [{model:'one/a',weight:3},{model:'two/b',weight:1}],
    reviewer: [{model:'three/c',weight:1}],
    'subagent-default': [{model:'one/a',weight:1},{model:'two/b',weight:1}],
  },
};
const available = new Set(['one/a','two/b','three/c']);

test('validate rejects malformed model or weights', () => {
  assert.throws(() => validateConfig({...config, version:2}), /version/);
  assert.throws(() => validateConfig({...config, pools:{...config.pools, main:[{model:'x',weight:1}]}}), /selector/);
  assert.throws(() => validateConfig({...config, pools:{...config.pools, main:[{model:'one/a',weight:0}]}}), /weights/);
});
test('selects at boundaries with injected RNG', () => {
  assert.equal(new PoolSelector(config,()=>0).choose('main',available).model,'one/a');
  assert.equal(new PoolSelector(config,()=>0.999).choose('main',available).model,'two/b');
  assert.equal(new PoolSelector(config,()=>0.123).choose('reviewer',available).model,'three/c');
});
test('unavailable candidates never selected and empty eligibility fails closed', () => {
  const s = new PoolSelector(config,()=>0.9);
  assert.equal(s.choose('main',new Set(['one/a'])).model,'one/a');
  assert.throws(()=>s.choose('main',new Set()), /no authenticated/);
});
test('shuffle-bag cycles through distinct models without replacement', () => {
  const c = {...config, strategy:'shuffle-bag' as const,
    pools: {...config.pools, main:[{model:'one/a',weight:1},{model:'two/b',weight:1}]}};
  const s = new PoolSelector(validateConfig(c),()=>0.5);
  assert.deepEqual(new Set([s.choose('main',available).model,s.choose('main',available).model]),new Set(['one/a','two/b']));
});
test('weighted random distribution approximates intended shares', () => {
  let seed = 7; const rng=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/2**32);
  const s = new PoolSelector(config,rng);
  let count=0; for(let i=0;i<10000;i++) count += s.choose('main',available).model==='one/a' ? 1 : 0;
  assert.ok(count>7200&&count<7800,`count=${count}`);
});
test('rejects non-integer shuffle weights and invalid RNG', () => {
  assert.throws(()=>validateConfig({...config,strategy:'shuffle-bag',pools:{...config.pools,main:[{model:'one/a',weight:1.5}]}}),/integers/);
  assert.throws(()=>new PoolSelector(config,()=>1).choose('main',available),/RNG/);
});

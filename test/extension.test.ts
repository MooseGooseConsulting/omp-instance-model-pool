import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../src/extension.ts';

function harness(options: { sub?: boolean; eligible?: string[] } = {}) {
  const handlers = new Map<string, Function>();
  const entries: any[] = [];
  const models = (options.eligible ?? ['one/a','two/b','three/c']).map(s => {
    const [provider, id] = s.split('/'); return {provider,id};
  });
  let current: any = models[0];
  let stopped = false;
  let setCalls = 0;
  const pi = {
    on(name: string, fn: Function) {handlers.set(name,fn);},
    registerCommand() {},
    appendEntry(customType:string,data:unknown) {entries.push({type:'custom',customType,data});},
    async setModel(model:any) {current=model;setCalls++;return true;},
  };
  const ctx = {
    cwd: process.cwd(),
    agent: {kind:options.sub?'sub':'main',name:options.sub?'reviewer':'main'},
    models: {list:()=>models, current:()=>current,
      resolve:(spec:string)=>models.find(m=>`${m.provider}/${m.id}`===spec)},
    sessionManager: {getBranch:()=>entries},
    ui: {notify() {}, setStatus() {}},
    shutdown() {stopped=true;},
  };
  extension(pi as any);
  const emit = async (name:string, payload:object={}) => {
    const handler=handlers.get(name);assert.ok(handler,`missing event ${name}`);
    return await handler!(payload,ctx);
  };
  return {emit,ctx,entries,pi,models,get current(){return current},get stopped(){return stopped},get setCalls(){return setCalls}};
}

const temp = mkdtempSync(join(tmpdir(),'omp-model-pool-'));
writeFileSync(join(temp,'pool.json'), JSON.stringify({version:1,pools:{
  main:[{model:'one/a',weight:1},{model:'two/b',weight:1}],
  reviewer:[{model:'three/c',weight:1}],
  'subagent-default':[{model:'two/b',weight:1}],
}}));
process.env.OMP_INSTANCE_MODEL_POOL_CONFIG=join(temp,'pool.json');

test('main session chooses once, preserves selection across prompts and resumes',async()=>{
  const h=harness();
  await h.emit('session_start');
  const original=h.current.id;
  assert.equal(h.entries.length,1);
  await h.emit('before_agent_start');
  await h.emit('before_agent_start');
  assert.equal(h.entries.length,1);
  assert.equal(h.current.id,original);
  await h.emit('session_switch',{reason:'resume'});
  assert.equal(h.current.id,original);
  assert.equal(h.entries.length,1);
});
test('new and fork create new assignment records',async()=>{
  const h=harness(); await h.emit('session_start');
  await h.emit('session_switch',{reason:'new'});
  assert.equal(h.entries.length,2);
  await h.emit('session_branch',{reason:'fork'});
  assert.equal(h.entries.length,3);
});
test('parent dispatch picks distinct named pool; child never rerolls',async()=>{
  const h=harness();await h.emit('session_start');
  const choice=await h.emit('before_subagent_spawn',{agent:'reviewer',patterns:[],invocationKind:'task'});
  assert.equal(choice.model,'three/c');
  const child=harness({sub:true});
  await child.emit('session_start');
  assert.equal(child.entries.length,0);
});
test('no eligible model blocks a child spawn',async()=>{
  const h=harness({eligible:['one/a']});await h.emit('session_start');
  const choice=await h.emit('before_subagent_spawn',{agent:'reviewer',patterns:[],invocationKind:'task'});
  assert.equal(choice.block,true);
  assert.match(choice.reason,/no authenticated/);
});
test('drift and fallback cause shutdown',async()=>{
  const h=harness();await h.emit('session_start');
  await h.emit('retry_fallback_applied',{from:'one/a',to:'two/b'});
  assert.equal(h.stopped,true);
});
process.on('exit',()=>{delete process.env.OMP_INSTANCE_MODEL_POOL_CONFIG;rmSync(temp,{recursive:true,force:true});});

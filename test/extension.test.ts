import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../src/extension.ts';

function harness(options: { sub?: boolean; eligible?: string[]; hasUI?: boolean } = {}) {
  const handlers = new Map<string, Function>();
  const entries: any[] = [];
  const notifications: string[] = [];
  const models = (options.eligible ?? ['one/a','two/b','three/c']).map(s => {
    const slash = s.indexOf('/');
    return {provider:s.slice(0, slash), id:s.slice(slash + 1)};
  });
  let current: any = models[0];
  let sessionId = 'session-0';
  let parentSession: string | undefined;
  let stopped = false;
  let aborted = false;
  let setCalls = 0;
  const pi = {
    on(name: string, fn: Function) {handlers.set(name,fn);},
    registerCommand(_name:string, command:any) {handlers.set('command', command.handler);},
    appendEntry(customType:string,data:unknown) {entries.push({type:'custom',customType,data});},
    async setModel(model:any) {current=model;setCalls++;return true;},
  };
  const ctx = {
    cwd: process.cwd(),
    hasUI: options.hasUI !== false,
    agent: {kind:options.sub?'sub':'main',name:options.sub?'reviewer':'main'},
    models: {list:()=>models, current:()=>current,
      resolve:(spec:string)=>models.find(m=>`${m.provider}/${m.id}`===spec)},
    sessionManager: {getBranch:()=>entries,getSessionId:()=>sessionId,getHeader:()=>({id:sessionId,parentSession})},
    ui: {notify(msg:string) {notifications.push(msg);}, setStatus() {}}, 
    shutdown() {stopped=true;},
    abort() {aborted=true;},
  };
  extension(pi as any);
  const emit = async (name:string, payload:object={}) => {
    const handler=handlers.get(name);assert.ok(handler,`missing event ${name}`);
    return await handler!(payload,ctx);
  };
  return {emit,ctx,entries,pi,models,notifications,setSession:(id:string)=>{sessionId=id;},setParent:(id?:string)=>{parentSession=id;},
    get current(){return current},get stopped(){return stopped},get aborted(){return aborted},get setCalls(){return setCalls}};
}

const temp = mkdtempSync(join(tmpdir(),'omp-model-pool-'));
writeFileSync(join(temp,'pool.json'), JSON.stringify({version:1,pools:{
  main:[{model:'one/a',weight:1},{model:'two/b',weight:1}],
  reviewer:[{model:'three/c',weight:1}],
  'subagent-default':[{model:'two/b',weight:1}],
}}));
process.env.OMP_INSTANCE_MODEL_POOL_CONFIG=join(temp,'pool.json');

test('headless fail-closed startup reports the error on stderr',async()=>{
  const previous=console.error;
  const lines:string[]=[];
  console.error=(...parts:unknown[])=>{lines.push(parts.map(String).join(' '));};
  try {
    const h=harness({eligible:['three/c'],hasUI:false});
    await h.emit('session_start');
    assert.equal(h.stopped,true);
    assert.equal(h.aborted,true);
    assert.match(lines.join(' '),/no authenticated\/available models in pool main/);
  } finally { console.error=previous; }
});
test('main session chooses once, preserves selection across prompts and resumes',async()=>{
  const h=harness();
  await h.emit('session_start');
  const original=h.current.id;
  assert.equal(h.entries.length,1);
  await h.emit('before_agent_start');
  await h.emit('before_agent_start');
  await h.emit('session_start');
  assert.equal(h.entries.length,1);
  assert.equal(h.current.id,original);
  await h.emit('session_switch',{reason:'resume'});
  assert.equal(h.current.id,original);
  assert.equal(h.entries.length,1);
});
test('fresh extension restores the persisted assignment instead of drawing again',async()=>{
  const first=harness();
  await first.emit('session_start');
  const saved=first.entries.map(entry=>({...entry,data:{...entry.data}}));
  const modelId=first.current.id;
  const resumed=harness();
  resumed.entries.push(...saved);
  await resumed.emit('session_start');
  assert.equal(resumed.current.id,modelId);
  assert.equal(resumed.entries.length,1);
  assert.equal(resumed.setCalls,1);
  await resumed.emit('session_switch',{reason:'resume'});
  assert.equal(resumed.entries.length,1);
  assert.equal(resumed.current.id,modelId);
});
test('new and fork create exactly one record each, even with both fork notifications',async()=>{
  const h=harness(); await h.emit('session_start');
  h.setSession('session-1');
  await h.emit('session_switch',{reason:'new'});
  assert.equal(h.entries.length,2);
  h.setSession('session-2');
  await h.emit('session_switch',{reason:'fork'});
  await h.emit('session_branch',{reason:'fork'});
  assert.equal(h.entries.length,3);
  await h.emit('session_branch',{reason:'branch'});
  assert.equal(h.entries.length,3);
});
test('named branch and BTW promotion each pin a newly created session',async()=>{
  const h=harness();
  await h.emit('session_start');
  h.setSession('named-branch');
  await h.emit('session_branch',{reason:'branch'});
  assert.equal(h.entries.length,2);
  assert.equal(h.entries[1].data.sessionId,'named-branch');
  const branchModel=h.current.id;
  await h.emit('session_branch',{reason:'branch'});
  await h.emit('session_switch',{reason:'resume'});
  assert.equal(h.entries.length,2);
  assert.equal(h.current.id,branchModel);
  h.setSession('btw-promoted');
  await h.emit('session_branch',{reason:'btw'});
  assert.equal(h.entries.length,3);
  assert.equal(h.entries[2].data.sessionId,'btw-promoted');
  const btwModel=h.current.id;
  await h.emit('session_branch',{reason:'btw'});
  assert.equal(h.current.id,btwModel);
  assert.equal(h.entries.length,3);
});
test('overlapping lifecycle notifications share exactly one pending draw',async()=>{
  const h=harness();
  const originalSetModel=h.pi.setModel.bind(h.pi);
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  h.pi.setModel=async (model:any)=>{await gate;return originalSetModel(model);};
  const start=h.emit('session_start');
  const duplicate=h.emit('session_start');
  const branchNotification=h.emit('session_branch',{reason:'fork'});
  release();
  await Promise.all([start,duplicate,branchNotification]);
  assert.equal(h.entries.length,1);
  assert.equal(h.entries[0].data.sessionId,'session-0');
  assert.equal(h.setCalls,1);
});
test('an activation superseded by another session never writes to its destination',async()=>{
  const h=harness();
  let release!:()=>void;
  let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const originalSet=h.pi.setModel.bind(h.pi);
  let activations=0;
  h.pi.setModel=async(model:any)=>{
    activations++;
    if(activations===1) {started();await gate;}
    return originalSet(model);
  };
  const first=h.emit('session_start');
  await entered;
  h.setSession('session-1');
  const second=h.emit('session_switch',{reason:'new'});
  release();
  await Promise.all([first,second]);
  assert.equal(h.entries.length,1);
  assert.equal(h.entries[0].data.sessionId,'session-1');
  assert.equal(activations,2);
  assert.equal(h.stopped,false);
  await h.emit('before_agent_start');
  assert.equal(h.aborted,false);
});
test('resume rollback restores the originating pin without another draw',async()=>{
  const h=harness();
  await h.emit('session_start');
  const sourceEntry=h.entries[0];
  const sourceModel=h.current;
  const target=h.models.find(m=>m.id!==sourceModel.id)!;
  const destinationEntry={type:'custom',customType:sourceEntry.customType,
    data:{...sourceEntry.data,model:`${target.provider}/${target.id}`,sessionId:'resumed-1'}};
  h.entries.splice(0,h.entries.length,destinationEntry);
  h.setSession('resumed-1');
  await h.emit('session_switch',{reason:'resume'});
  assert.equal(h.current.id,target.id);
  // OMP restores both the prior session and its model after a failed transition;
  // it does not emit a compensating session_switch event.
  h.entries.splice(0,h.entries.length,sourceEntry);
  h.setSession('session-0');
  await h.pi.setModel(sourceModel);
  await h.emit('before_agent_start');
  await h.emit('command');
  assert.equal(h.current.id,sourceModel.id);
  assert.equal(h.entries.length,1);
  assert.equal(h.stopped,false);
  assert.equal(h.aborted,false);
  assert.match(h.notifications.join(' '),new RegExp(`Pinned ${sourceModel.provider}/${sourceModel.id}`));
});
test('resume reasserts its persisted pin once after OMP post-hook restore',async()=>{
  const h=harness();
  await h.emit('session_start');
  const initial=h.current;
  const selected=h.models.find(m=>m.id!==initial.id)!;
  const saved=h.entries[0];
  h.setSession('resumed-1');
  h.entries.splice(0,h.entries.length,{type:'custom',customType:saved.customType,
    data:{...saved.data,model:`${selected.provider}/${selected.id}`,sessionId:'resumed-1'}});
  await h.emit('session_switch',{reason:'resume'});
  assert.equal(h.current.id,selected.id);
  // Upstream OMP restores its saved session model after emitting session_switch,
  // potentially replacing the extension's pin before the first request.
  await h.pi.setModel(initial);
  await h.emit('before_agent_start');
  assert.equal(h.current.id,selected.id);
  assert.equal(h.entries.length,1);
  assert.equal(h.stopped,false);
  const activationCount=h.setCalls;
  await h.emit('before_agent_start');
  assert.equal(h.setCalls,activationCount);
  // A later manual/model fallback change in the same instance is *not* allowed.
  await h.pi.setModel(initial);
  await h.emit('before_agent_start');
  assert.equal(h.stopped,true);
  assert.equal(h.aborted,true);
});
test('rejected stale activation cannot halt its successor session',async()=>{
  const h=harness();
  let entered!:()=>void;
  let release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const original=h.pi.setModel.bind(h.pi);
  let count=0;
  h.pi.setModel=async(model:any)=>{
    count++;
    if(count===1) {
      entered();
      await gate;
      throw new Error('obsolete activation failed');
    }
    return original(model);
  };
  const first=h.emit('session_start');
  await started;
  h.setSession('successor');
  const successor=h.emit('session_switch',{reason:'new'});
  release();
  await Promise.all([first,successor]);
  assert.equal(h.entries.length,1);
  assert.equal(h.entries[0].data.sessionId,'successor');
  assert.equal(h.stopped,false);
  assert.equal(h.aborted,false);
  await h.emit('before_agent_start');
  assert.equal(h.stopped,false);
});
test('failed resume model reassertion halts without rejecting future activation queue',async()=>{
  const h=harness();
  await h.emit('session_start');
  const source=h.current;
  const saved=h.entries[0];
  const selected=h.models.find(m=>m.id!==source.id)!;
  h.setSession('resumed');
  h.entries.splice(0,h.entries.length,{type:'custom',customType:saved.customType,
    data:{...saved.data,model:`${selected.provider}/${selected.id}`,sessionId:'resumed'}});
  await h.emit('session_switch',{reason:'resume'});
  await h.pi.setModel(source); // upstream reverts its model after the session-switch hook
  const original=h.pi.setModel.bind(h.pi);
  let attempts=0;
  h.pi.setModel=async(model:any)=>{
    attempts++;
    if(attempts===1) throw new Error('injected restore error');
    return original(model);
  };
  // An extension handler must contain the error and abort, not silently proceed.
  await h.emit('before_agent_start');
  assert.equal(h.aborted,true);
  assert.equal(h.stopped,true);
  assert.match(h.notifications.join(' '),/failed to restore pinned model/);
  // A future session must not await a rejected activationTail forever.
  h.setSession('later-new-session');
  await h.emit('session_switch',{reason:'new'});
  assert.equal(h.entries.at(-1).data.sessionId,'later-new-session');
  assert.ok(attempts>=2);
});
test('unqualified entry branch draws once for the new session',async()=>{
  const h=harness(); await h.emit('session_start');
  h.setSession('entry-branch');
  await h.emit('session_branch',{});
  assert.equal(h.entries.length,2);
  assert.equal(h.entries[1].data.sessionId,'entry-branch');
  await h.emit('session_branch',{});
  assert.equal(h.entries.length,2);
});
test('CLI startup fork redraws when the source assignment is copied',async()=>{
  const h=harness();await h.emit('session_start');
  const inherited=h.entries[0].data;
  assert.equal(inherited.sessionId,'session-0');
  h.setParent('session-0');h.setSession('forked-session');
  // --fork creates the child before extensions load; it emits only session_start.
  await h.emit('session_start');
  assert.equal(h.entries.length,2);
  assert.equal(h.entries[1].data.sessionId,'forked-session');
  await h.emit('session_start');
  assert.equal(h.entries.length,2);
});
test('main pool follows new project config without sharing cached selector',async()=>{
  const previous=process.env.OMP_INSTANCE_MODEL_POOL_CONFIG;
  const a=mkdtempSync(join(temp,'projectA-'));
  const b=mkdtempSync(join(temp,'projectB-'));
  for(const [dir,model] of [[a,'one/a'],[b,'two/b']]){
    mkdirSync(join(dir,'.omp'));
    writeFileSync(join(dir,'.omp','instance-model-pool.json'),JSON.stringify({version:1,pools:{
      main:[{model,weight:1}], 'subagent-default':[{model,weight:1}],
    }}));
  }
  delete process.env.OMP_INSTANCE_MODEL_POOL_CONFIG;
  try {
    const h=harness(); h.ctx.cwd=a;
    await h.emit('session_start'); assert.equal(h.current.id,'a');
    h.ctx.cwd=b; h.setSession('project-b-new-session');
    await h.emit('session_switch',{reason:'new'});
    assert.equal(h.current.id,'b');
    assert.equal(h.entries.length,2);
  } finally {
    process.env.OMP_INSTANCE_MODEL_POOL_CONFIG=previous;
  }
});
test('parent dispatch uses named pool; child never redraws or invents pool metadata',async()=>{
  const h=harness();await h.emit('session_start');
  const choice=await h.emit('before_subagent_spawn',{agent:'reviewer',patterns:[],invocationKind:'task'});
  assert.equal(choice.model,'three/c');
  const child=harness({sub:true,eligible:['three/c']});
  await child.emit('session_start');
  await child.emit('command');
  assert.equal(child.entries.length,0);
  assert.match(child.notifications.join(' '),/pool\/strategy not supplied/);
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
  assert.equal(h.aborted,true);
});
test('model drift before agent start causes shutdown',async()=>{
  const h=harness();await h.emit('session_start');
  const other=h.models.find(m=>m.id!==h.current.id)!;
  await h.pi.setModel(other);
  await h.emit('before_agent_start');
  assert.equal(h.stopped,true);
  assert.equal(h.aborted,true);
});
test('halted agent start still aborts when shutdown would be a no-op',async()=>{
  const h=harness();await h.emit('session_start');
  await h.emit('retry_fallback_applied',{from:'one/a',to:'two/b'});
  const ctx=h.ctx as {abort?:()=>void; shutdown:()=>void};
  let abortedAgain=false;
  let shutdowns=0;
  ctx.abort=()=>{abortedAgain=true;};
  ctx.shutdown=()=>{shutdowns++;};
  await h.emit('before_agent_start');
  assert.equal(abortedAgain,true);
  assert.equal(shutdowns,1);
});
test('provider request aborts when an assignment is missing',async()=>{
  const h=harness();await h.emit('session_start');
  await h.emit('before_provider_request',{payload:{request:true}});
  assert.equal(h.aborted,false);
  const missing=harness();
  await missing.emit('before_provider_request',{payload:{request:true}});
  assert.equal(missing.aborted,true);
});
process.on('exit',()=>{delete process.env.OMP_INSTANCE_MODEL_POOL_CONFIG;rmSync(temp,{recursive:true,force:true});});

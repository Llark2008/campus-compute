import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {fixture,testRegistration,submission,testRuntime} from '../fixtures/core.ts';
import {createStore} from '../../src/server/store.ts';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const two=(f:ReturnType<typeof fixture>)=>({...f.input,variants:[f.input.variants[0],{...f.input.variants[0],id:'B',instruction:'Another instruction'}]});

test('recording starts with connected zero contributors and captures zero-work join and exit',()=>{
 const f=fixture();try{
  const initial=f.store.register({...testRegistration,name:'initial'}),old=f.store.register({...testRegistration,name:'old'});f.store.leave(old.workerId);
  const e=f.store.create(two(f));let trace=f.store.trace(e.experimentId);
  expect(trace.schemaVersion).toBe(1);expect(trace.scope).toBe('group-pool-during-experiment');
  expect(trace.frames[0].workers.map(w=>({id:w.workerId,completed:w.completed}))).toEqual([{id:initial.workerId,completed:0}]);
  f.advance(100);const late=f.store.register({...testRegistration,name:'late'});f.advance(100);f.store.leave(late.workerId);
  trace=f.store.trace(e.experimentId);expect(trace.workers.map(w=>w.workerId)).toEqual([initial.workerId,late.workerId]);
  expect(trace.events.filter(v=>v.workerId===late.workerId).map(v=>v.kind)).toEqual(['registered','left']);
  expect(f.store.snapshot(e.experimentId).workers).toEqual([]);
  expect(JSON.stringify(trace)).not.toContain(initial.token);expect(JSON.stringify(trace)).not.toContain(late.token);
 }finally{f.store.close();}
});
test('observed state/level changes and offline recovery are recorded without heartbeat duplicates',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create(two(f));
  const hb={state:'paused' as const,level:'low' as const,lease:null};f.store.heartbeat(w.workerId,hb);
  f.store.heartbeat(w.workerId,hb);let events=f.store.trace(e.experimentId).events;
  expect(events.filter(v=>v.kind==='state_changed')).toHaveLength(1);expect(events.filter(v=>v.kind==='level_changed')).toHaveLength(1);
  f.advance(20001);f.store.sweep();f.advance(1);f.store.heartbeat(w.workerId,{...hb,state:'ready'});
  events=f.store.trace(e.experimentId).events;expect(events.some(v=>v.kind==='offline')).toBe(true);expect(events.some(v=>v.kind==='online')).toBe(true);
 }finally{f.store.close();}
});
test('two-second frames contain only this experiment contributions and remain frozen at completion',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),prior=f.store.create(f.input);f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));
  const input=two(f);input.variants=input.variants.map(v=>({...v,instruction:v.instruction+' new'}));const e=f.store.create(input);
  expect(f.store.trace(e.experimentId).frames[0].workers[0].completed).toBe(0);
  const lease=f.store.claim(w.workerId)!;f.advance(100);f.store.accept(w.workerId,submission(lease));
  f.advance(1899);f.store.sweep();expect(f.store.trace(e.experimentId).frames).toHaveLength(1);
  f.advance(1);f.store.sweep();let trace=f.store.trace(e.experimentId);
  expect(trace.frames.at(-1)).toMatchObject({at:f.now(),progress:{planned:2,fresh:1,cached:0,queued:1,leased:0}});
  expect(trace.frames.at(-1)!.workers[0]).toMatchObject({completed:1,credits:1});
  const last=f.store.claim(w.workerId)!;f.advance(100);f.store.accept(w.workerId,submission(last));trace=f.store.trace(e.experimentId);
  expect(trace.recording.endedAt).toBe(f.now());expect(trace.frames.at(-1)!.progress.fresh).toBe(2);
  f.advance(9999);f.store.sweep();f.store.leave(w.workerId);expect(f.store.trace(e.experimentId)).toEqual(trace);
  expect(trace.events.filter(v=>v.kind==='accepted')).toHaveLength(2);
 }finally{f.store.close();}
});
test('released work and reassignment retain attempt identities without double contribution',()=>{
 const f=fixture();try{
  const a=f.store.register({...testRegistration,name:'a'}),b=f.store.register({...testRegistration,name:'b'}),e=f.store.create(f.input);
  const first=f.store.claim(a.workerId)!;f.advance(100);f.store.leave(a.workerId);const last=f.store.claim(b.workerId)!;
  f.advance(100);f.store.accept(b.workerId,submission(last));const trace=f.store.trace(e.experimentId);
  expect(trace.events.filter(v=>v.kind==='claimed').map(v=>v.data.leaseId)).toEqual([first.leaseId,last.leaseId]);
  expect(trace.events.find(v=>v.kind==='released')?.data.attemptState).toBe('released');
  expect(trace.frames.at(-1)!.workers.map(w=>w.completed)).toEqual([0,1]);
  expect(trace.frames.at(-1)!.progress).toMatchObject({fresh:1,queued:0,leased:0});
 }finally{f.store.close();}
});
test('cache-only and canceled evaluations have explicit terminal recordings',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create(f.input);f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));
  const cached=f.store.create(f.input),trace=f.store.trace(cached.experimentId);
  expect(trace.recording.endedAt).not.toBeNull();expect(trace.frames.at(-1)!.progress).toMatchObject({fresh:0,cached:1});
  expect(trace.events.filter(v=>v.kind==='accepted')).toEqual([]);
  const cancel=f.store.create(two(f));f.advance(100);f.store.cancel(cancel.experimentId);
  const stopped=f.store.trace(cancel.experimentId);expect(stopped.frames.at(-1)!.progress).toMatchObject({cached:1,canceled:1});
  expect(stopped.events.some(v=>v.kind==='canceled')).toBe(true);expect(stopped.recording.endedAt).toBe(f.now());
 }finally{f.store.close();}
});
test('durable installation identity groups sessions without guessing from names',()=>{
 const f=fixture();try{
  const deviceId='995c346b-6b16-4a6b-a948-32c52e899cc6',a=f.store.register({...testRegistration,deviceId}),e=f.store.create(two(f));
  f.store.leave(a.workerId);const b=f.store.register({...testRegistration,deviceId}),legacy=f.store.register(testRegistration);
  const trace=f.store.trace(e.experimentId),aa=trace.workers.find(w=>w.workerId===a.workerId)!,bb=trace.workers.find(w=>w.workerId===b.workerId)!,ll=trace.workers.find(w=>w.workerId===legacy.workerId)!;
  expect(aa.deviceId).toBe(deviceId);expect(bb.deviceId).toBe(deviceId);expect(aa.identityKind).toBe('installation');expect(ll.identityKind).toBe('session');expect(ll.deviceId).not.toBe(deviceId);
 }finally{f.store.close();}
});
test('active recording persists over reopen and declares the observation gap',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campus-trace-'));dirs.push(dir);const filename=join(dir,'test.sqlite'),f=fixture(filename);
 const w=f.store.register(testRegistration),e=f.store.create(two(f));f.advance(2000);f.store.sweep();f.store.close();f.advance(5000);
 const reopened=createStore({filename,runtime:testRuntime,examples:[],now:f.now});try{
  const trace=reopened.trace(e.experimentId);expect(trace.recording.hasGaps).toBe(true);
  expect(trace.events.find(v=>v.kind==='recording_resumed')?.data).toMatchObject({gapFrom:1002000,gapTo:1007000});
  expect(trace.frames.some(v=>v.at===1000000)).toBe(true);expect(trace.frames.at(-1)!.at).toBe(1007000);
  expect(trace.workers.some(v=>v.workerId===w.workerId)).toBe(true);
 }finally{reopened.close();}
});
test('legacy experiments never receive invented initial recording history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campus-trace-legacy-'));dirs.push(dir);const filename=join(dir,'test.sqlite'),f=fixture(filename),e=f.store.create(f.input);
 f.store.close();const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');db.prepare('DELETE FROM experiment_recordings WHERE experiment_id=?').run(e.experimentId);db.close();
 const reopened=createStore({filename,runtime:testRuntime,examples:[],now:f.now});try{
  expect(reopened.snapshot(e.experimentId).recording.available).toBe(false);
  expect(()=>reopened.trace(e.experimentId)).toThrow('No process recording');
 }finally{reopened.close();}
});

test('cancellation identifies every affected task and freezes equal-time boundary frames',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create(two(f)),lease=f.store.claim(w.workerId)!;
  f.store.cancel(e.experimentId);const trace=f.store.trace(e.experimentId),events=trace.events.filter(v=>v.kind==='task_canceled');
  expect(new Set(events.map(v=>v.taskId))).toEqual(new Set(trace.tasks.map(t=>t.taskId)));
  expect(events.find(v=>v.taskId===lease.taskId)?.data).toMatchObject({leaseId:lease.leaseId,attemptState:'canceled',taskState:'canceled'});
  expect(trace.frames.map(v=>v.reason)).toEqual(['initial','terminal']);expect(trace.frames[0].at).toBe(trace.frames[1].at);expect(trace.frames[1].seq).toBeGreaterThan(trace.frames[0].seq);
 }finally{f.store.close();}
});
test('the final expired attempt records offline before the terminal frame and omits raw fault details',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create(f.input);
  for(let i=0;i<2;i++)f.store.fault(w.workerId,{...f.store.claim(w.workerId)!,code:'ENGINE_ERROR',message:'PRIVATE_TOKEN and /local/private/model-path'});
  f.store.claim(w.workerId);f.advance(20001);f.store.sweep();const trace=f.store.trace(e.experimentId);
  expect(trace.frames.at(-1)!.progress.failed).toBe(1);expect(trace.frames.at(-1)!.workers[0].state).toBe('offline');
  expect(trace.events.find(v=>v.kind==='offline')!.seq).toBeLessThan(trace.events.find(v=>v.kind==='recording_ended')!.seq);
  expect(JSON.stringify(trace)).not.toContain('PRIVATE_TOKEN');expect(JSON.stringify(trace)).not.toContain('/local/private');
 }finally{f.store.close();}
});
test('a failed trace write rolls back its result and task transition in the same transaction',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campus-trace-rollback-'));dirs.push(dir);const filename=join(dir,'test.sqlite'),f=fixture(filename),db=new DatabaseSync(filename);
 try{
  const w=f.store.register(testRegistration),e=f.store.create(f.input),lease=f.store.claim(w.workerId)!;
  db.exec("CREATE TRIGGER block_recording_accept BEFORE INSERT ON recording_events WHEN NEW.kind='accepted' BEGIN SELECT RAISE(ABORT,'test trace unavailable'); END");
  expect(()=>f.store.accept(w.workerId,submission(lease))).toThrow('test trace unavailable');
  expect(f.store.snapshot(e.experimentId)).toMatchObject({fresh:0,leased:1});expect(f.store.trace(e.experimentId).events.filter(v=>v.kind==='accepted')).toEqual([]);
  db.exec('DROP TRIGGER block_recording_accept');f.store.accept(w.workerId,submission(lease));expect(f.store.trace(e.experimentId).frames.at(-1)!.progress.fresh).toBe(1);
 }finally{db.close();f.store.close();}
});

test('a stale zero-work session observed before the sweep is included on unchanged heartbeat',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration);f.advance(20001);const e=f.store.create(two(f));
  expect(f.store.trace(e.experimentId).workers).toEqual([]);
  f.store.heartbeat(w.workerId,{state:'ready',level:'medium',lease:null});f.advance(2000);f.store.sweep();
  const trace=f.store.trace(e.experimentId);expect(trace.workers.map(v=>v.workerId)).toEqual([w.workerId]);
  expect(trace.frames.at(-1)!.workers[0]).toMatchObject({completed:0,state:'ready'});
 }finally{f.store.close();}
});
test('mixed cache/fresh recording preserves immutable initial task states and cached result identity',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),prior=f.store.create(f.input);const receipt=f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));
  const e=f.store.create(two(f)),initial=f.store.trace(e.experimentId).tasks;
  expect(initial.find(t=>t.variantId==='A')).toMatchObject({initialState:'completed',initialSource:'cache',initialResultId:receipt.resultId});
  expect(initial.find(t=>t.variantId==='B')).toMatchObject({initialState:'queued',initialSource:null,initialResultId:null});
  f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));expect(f.store.trace(e.experimentId).tasks).toEqual(initial);
 }finally{f.store.close();}
});

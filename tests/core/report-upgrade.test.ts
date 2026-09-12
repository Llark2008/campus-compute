import {expect,test} from 'vitest';
import {fixture,testRegistration,submission} from '../fixtures/core.ts';

test('elapsed time includes queue waiting and freezes after completion',()=>{
 const f=fixture();try{
  const created=f.now(),e=f.store.create(f.input);
  f.advance(2000);expect(f.store.snapshot(e.experimentId)).toMatchObject({createdAt:created,elapsedMs:2000,executionElapsedMs:null});
  const w=f.store.register(testRegistration),l=f.store.claim(w.workerId)!;
  f.advance(1200);expect(f.store.snapshot(e.experimentId)).toMatchObject({elapsedMs:3200,executionElapsedMs:1200});
  f.store.accept(w.workerId,submission(l));f.advance(9000);
  expect(f.store.report(e.experimentId).snapshot).toMatchObject({elapsedMs:3200,executionElapsedMs:1200});
 }finally{f.store.close();}
});
test('canceled and entirely cached evaluations do not invent execution time',()=>{
 const f=fixture();try{
  const canceled=f.store.create(f.input);f.advance(700);f.store.cancel(canceled.experimentId);f.advance(1000);
  expect(f.store.snapshot(canceled.experimentId)).toMatchObject({elapsedMs:700,executionElapsedMs:null});
  const e=f.store.create(f.input),w=f.store.register(testRegistration),l=f.store.claim(w.workerId)!;f.advance(50);f.store.accept(w.workerId,submission(l));
  const cached=f.store.create(f.input);f.advance(1000);
  expect(f.store.snapshot(cached.experimentId)).toMatchObject({fresh:0,cached:1,elapsedMs:0,executionElapsedMs:null,workers:[]});
 }finally{f.store.close();}
});
test('only this experiments newly accepted contributors appear, even after leaving',()=>{
 const f=fixture();try{
  const old=f.store.register({...testRegistration,name:'old'}),idle=f.store.register({...testRegistration,name:'idle'});
  const prior=f.store.create(f.input);f.store.accept(old.workerId,submission(f.store.claim(old.workerId)!));f.store.leave(old.workerId);
  const current=f.store.register({...testRegistration,name:'current'});
  const input={...f.input,variants:[{...f.input.variants[0],instruction:'A different instruction'}]};
  const run=f.store.create(input);
  expect(f.store.snapshot(run.experimentId).workers).toEqual([]);
  const l=f.store.claim(current.workerId)!;expect(f.store.snapshot(run.experimentId).workers).toEqual([]);
  f.store.accept(current.workerId,submission(l));f.store.leave(current.workerId);
  expect(f.store.snapshot(run.experimentId).workers.map(w=>({id:w.id,completed:w.completed,state:w.state}))).toEqual([{id:current.workerId,completed:1,state:'stopped'}]);
  expect(f.store.snapshot(prior.experimentId).workers.map(w=>w.id)).toEqual([old.workerId]);
  const events=f.store.snapshot(run.experimentId).events;
  expect(events.some(e=>e.workerId===old.workerId||e.workerId===idle.workerId)).toBe(false);
 }finally{f.store.close();}
});
test('workload identity ignores name/mode but changes with ordered inputs',()=>{
 const f=fixture();try{
  const a=f.store.create(f.input),b=f.store.create({...f.input,name:'Renamed'}),c=f.store.create({...f.input,variants:[{...f.input.variants[0],instruction:'Different'}]});
  const first=f.store.snapshot(a.experimentId).workloadFingerprint;
  expect(first).toMatch(/^[a-f0-9]{64}$/);expect(f.store.snapshot(b.experimentId).workloadFingerprint).toBe(first);
  expect(f.store.snapshot(c.experimentId).workloadFingerprint).not.toBe(first);
 }finally{f.store.close();}
});

test('held benchmark execution begins at first dispatch, not release',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create({...f.input,mode:'benchmark',benchmark:{policy:'dynamic',workerIds:[w.workerId],held:true}});
  f.advance(1000);f.store.start(e.experimentId);f.advance(2000);
  expect(f.store.snapshot(e.experimentId)).toMatchObject({startedAt:f.now()-2000,elapsedMs:3000,executionElapsedMs:null});
  const l=f.store.claim(w.workerId)!;f.advance(500);f.store.accept(w.workerId,submission(l));
  expect(f.store.snapshot(e.experimentId)).toMatchObject({elapsedMs:3500,executionElapsedMs:500});
 }finally{f.store.close();}
});
test('finished experiment events exclude later activity from its contributor',()=>{
 const f=fixture();try{
  const w=f.store.register(testRegistration),e=f.store.create(f.input);f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));
  const before=f.store.report(e.experimentId).events;
  f.advance(1000);f.store.leave(w.workerId);
  expect(f.store.report(e.experimentId).events).toEqual(before);
 }finally{f.store.close();}
});

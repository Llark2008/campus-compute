import {expect,test} from 'vitest';
import {median,assertComparable,summarizeRuns,assertBenchmarkReport,workersReadyAfter} from '../../scripts/benchmark.ts';
import {fixture,testRegistration,submission} from '../fixtures/core.ts';
test('only complete uncached fault-free benchmark results enter speed comparisons',()=>{
 expect(median([900,100,200])).toBe(200);expect(median([10,20])).toBe(15);expect(()=>median([])).toThrow();
 for(const patch of [{mode:'normal'},{cached:1},{failed:1},{fresh:9}])expect(()=>assertComparable({mode:'benchmark',cached:0,failed:0,expected:10,fresh:10,...patch})).toThrow();
 expect(()=>assertComparable({mode:'benchmark',cached:0,failed:0,expected:10,fresh:10})).not.toThrow();
 expect(summarizeRuns([])).toEqual([]);
});
test('intentional exit and reassignment invalidate a speed measurement',()=>{
 const f=fixture(),a=f.store.register(testRegistration),b=f.store.register(testRegistration);
 const e=f.store.create({...f.input,mode:'benchmark',benchmark:{policy:'dynamic',workerIds:[a.workerId,b.workerId],held:true}});f.store.start(e.experimentId);
 f.store.claim(a.workerId);f.advance(1000);f.store.leave(a.workerId);const l=f.store.claim(b.workerId)!;f.advance(1000);f.store.accept(b.workerId,submission(l));
 const report=f.store.report(e.experimentId);expect(report.snapshot.retries).toBe(0);expect(()=>assertBenchmarkReport(report)).toThrow('Interrupted');f.store.close();
});
test('ready from an old heartbeat cannot release the next benchmark',()=>{
 const f=fixture(),w=f.store.register(testRegistration),e=f.store.create(f.input);
 const s=f.store.listWorkers(),barrier={[w.workerId]:s[0].lastSeenAt};
 expect(workersReadyAfter(s,[w.workerId],barrier)).toBe(false);
 f.advance(1);f.store.heartbeat(w.workerId,{state:'resting',level:'medium',lease:null});expect(workersReadyAfter(f.store.listWorkers(),[w.workerId],barrier)).toBe(false);
 f.advance(1);f.store.heartbeat(w.workerId,{state:'ready',level:'medium',lease:null});expect(workersReadyAfter(f.store.listWorkers(),[w.workerId],barrier)).toBe(true);f.store.close();
});

test('level changes remain visible after a contributor leaves the connected pool',async()=>{
 const {levelsChanged}=await import('../../scripts/benchmark.ts');
 const f=fixture();try{
  const w=f.store.register(testRegistration),levels=new Map([[w.workerId,'medium']]);
  const e=f.store.create({...f.input,mode:'benchmark',benchmark:{policy:'dynamic',workerIds:[w.workerId],held:true}});
  f.store.start(e.experimentId);const l=f.store.claim(w.workerId)!;
  f.store.heartbeat(w.workerId,{state:'computing',level:'high',lease:{experimentId:l.experimentId,taskId:l.taskId,leaseId:l.leaseId,workerId:l.workerId}});f.advance(10);
  f.store.accept(w.workerId,submission(l));f.store.leave(w.workerId);
  const report=f.store.report(e.experimentId);expect(()=>assertBenchmarkReport(report)).not.toThrow();
  expect(f.store.listWorkers()).toEqual([]);
  expect(levelsChanged([...f.store.listWorkers(),...report.snapshot.workers],levels)).toBe(true);
 }finally{f.store.close();}
});

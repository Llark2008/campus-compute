import {expect,test} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,testRegistration,submission,testRuntime} from '../fixtures/core.ts';
import {createStore} from '../../src/server/store.ts';

test('third fault fails, while intentional releases consume no fault budget',()=>{
 const f=fixture(), w=f.store.register(testRegistration), e=f.store.create(f.input);
 for(let i=0;i<4;i++){const l=f.store.claim(w.workerId)!;f.store.release(w.workerId,l);f.store.release(w.workerId,l);}
 expect(f.store.snapshot(e.experimentId).failed).toBe(0);
 for(let i=0;i<3;i++){const l=f.store.claim(w.workerId)!;f.store.fault(w.workerId,{...l,code:'ENGINE_ERROR',message:'fixture fault'});}
 expect(f.store.snapshot(e.experimentId)).toMatchObject({failed:1,state:'completed-with-errors'}); f.store.close();
});
test('accepted receipt survives restart and heartbeat acknowledgement loss',()=>{
 const dir=mkdtempSync(join(tmpdir(),'campus-restart-'));
 try {const f=fixture(join(dir,'db.sqlite')), w=f.store.register(testRegistration); f.store.create(f.input);
 const l=f.store.claim(w.workerId)!, receipt=f.store.accept(w.workerId,submission(l));f.store.close();
 const s=createStore({filename:join(dir,'db.sqlite'),runtime:testRuntime,examples:[],now:f.now});
 expect(s.workerForToken(w.token)).toBe(w.workerId);
 expect(s.accept(w.workerId,submission(l))).toEqual(receipt);
 expect(s.heartbeat(w.workerId,{lease:{experimentId:l.experimentId,taskId:l.taskId,leaseId:l.leaseId,workerId:l.workerId},state:'uploading',level:'low'})).toMatchObject({receipt,leaseValid:false});s.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cache is rescored with changed gold and benchmark cannot populate cache',()=>{
 const f=fixture(), w=f.store.register(testRegistration);f.store.create(f.input);
 f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!));
 const d=f.store.importDataset({name:'new gold',source:'test',revision:'test',license:'test',jsonl:JSON.stringify({id:'q1',question:'Which is liquid?',choices:[{label:'A',text:'Ice'},{label:'B',text:'Water'}],answerKey:'A'})});
 const changed=f.store.create({...f.input,datasetId:d.id});
 expect(changed.preview.cached).toBe(1);
 expect(f.store.report(changed.experimentId).rows[0].score).toMatchObject({correct:false,answer:'B'});
 const variants=[{...f.input.variants[0],instruction:'New instruction'}];
 const bench=f.store.create({...f.input,variants,mode:'benchmark',benchmark:{policy:'dynamic',workerIds:[w.workerId],held:true}});
 f.store.start(bench.experimentId);expect(f.store.accept(w.workerId,submission(f.store.claim(w.workerId)!)).credit).toBe(0);
 expect(f.store.preview({...f.input,variants}).cached).toBe(0);f.store.close();
});
test('cancel rejects outstanding result, preserves accepted credit and stopped worker cannot revive',()=>{
 const f=fixture(), w=f.store.register(testRegistration); const e=f.store.create(f.input), l=f.store.claim(w.workerId)!;
 f.store.cancel(e.experimentId); expect(()=>f.store.accept(w.workerId,submission(l))).toThrow();
 const e2=f.store.create(f.input);const l2=f.store.claim(w.workerId)!;const r=f.store.accept(w.workerId,submission(l2));
 f.store.cancel(e2.experimentId);expect(f.store.accept(w.workerId,submission(l2))).toEqual(r);
 expect(f.store.snapshot(e2.experimentId).workers[0].credits).toBe(1);
 f.store.leave(w.workerId);expect(()=>f.store.heartbeat(w.workerId,{state:'ready',level:'high',lease:null})).toThrow();f.store.close();
});
test('lease identities cannot cross sessions and experiments rotate fairly',()=>{
 const f=fixture(), a=f.store.register(testRegistration),b=f.store.register(testRegistration);
 const input={...f.input,variants:[f.input.variants[0],{...f.input.variants[0],id:'B'}]};
 const e1=f.store.create(input),e2=f.store.create(input),l1=f.store.claim(a.workerId)!;
 expect(l1.experimentId).toBe(e1.experimentId);const l2=f.store.claim(b.workerId)!;expect(l2.experimentId).toBe(e2.experimentId);
 expect(()=>f.store.heartbeat(b.workerId,{state:'ready',level:'medium',lease:{experimentId:l1.experimentId,taskId:l1.taskId,leaseId:l1.leaseId,workerId:l1.workerId}})).toThrow();
 expect(()=>f.store.accept(b.workerId,submission(l1))).toThrow();
 f.store.accept(a.workerId,submission(l1));expect(()=>f.store.accept(b.workerId,submission(l1))).toThrow();f.store.close();
});

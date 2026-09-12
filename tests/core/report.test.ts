import {expect,test} from 'vitest';
import {comparison} from '../../src/server/report.ts';
import type {ReportRow} from '../../src/shared/contracts.ts';
import {fixture,testRegistration,submission} from '../fixtures/core.ts';
test('quality uses common completed questions, including unparseable answers',()=>{
 const row=(sampleId:string,variantId:string,correct=true):ReportRow=>({taskId:sampleId+variantId,sampleId,variantId,state:'completed',source:'computed',resultId:'r',workerId:'w',backend:'cpu',output:{text:correct?'ANSWER: B':'unparseable',finishReason:'stop',inputTokens:10,outputTokens:4,inferenceMs:1},score:{answer:correct?'B':null,correct,formatOk:correct},acceptedAt:100,error:null});
 const result=comparison([row('q1','A'),row('q2','A'),row('q1','B',false),row('q3','B')],['A','B']);
 expect(result.commonIds).toEqual(['q1']);expect(result.variants[0].commonCorrect).toBe(1);expect(result.variants[1].commonCorrect).toBe(0);expect(result.variants[1].received).toBe(2);
});
test('recent throughput ages out after completion',()=>{
 const f=fixture(),w=f.store.register(testRegistration),e=f.store.create(f.input),l=f.store.claim(w.workerId)!;
 f.advance(1000);f.store.accept(w.workerId,submission(l));expect(f.store.snapshot(e.experimentId).throughput).toBe(1);
 f.advance(60000);expect(f.store.snapshot(e.experimentId).throughput).toBe(0);f.store.close();
});

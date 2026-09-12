import {Context,uid} from './db.ts';
import {active,receiptFor} from './leases.ts';
import {scoreAnswer} from '../domain/score.ts';
import {DomainError} from '../shared/errors.ts';
import {SubmitSchema} from '../shared/schemas.ts';
import type {SubmitInput,Receipt,RuntimeLock} from '../shared/contracts.ts';
export function accept(c:Context,workerId:string,raw:SubmitInput):Receipt{
 const input=SubmitSchema.parse(raw);c.worker(workerId);
 const prior=receiptFor(c,workerId,input);if(prior)return prior;
 const {a,t,e}=active(c,workerId,input),runtime=JSON.parse(e.runtime_json) as RuntimeLock;
 const reg=c.registration(c.worker(workerId));
 if(input.inferenceKey!==runtime.inferenceKey||reg.inferenceKey!==runtime.inferenceKey||input.backend!==reg.backend)throw new DomainError('CONFIG_MISMATCH','Result runtime does not match assignment');
 const score=scoreAnswer(input.output.text,c.sample(e,t.sample_id),c.variant(e,t.variant_id).responseMode);
 const receipt:Receipt={taskId:t.id,resultId:uid(),acceptedAt:c.now(),credit:e.mode==='normal'?1:0};
 c.run('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)',receipt.resultId,t.id,a.id,workerId,input.backend,JSON.stringify(input.output),JSON.stringify(receipt),c.now());
 c.run("UPDATE tasks SET state='completed',source='computed',result_id=?,score_json=?,completed_at=?,error=NULL WHERE id=?",receipt.resultId,JSON.stringify(score),c.now(),t.id);
 c.run("UPDATE attempts SET state='accepted',ended_at=? WHERE id=?",c.now(),a.id);
 if(e.mode==='normal'){
  c.run('INSERT INTO credits VALUES(?,?,1)',t.id,workerId);
  c.run('INSERT OR IGNORE INTO result_cache VALUES(?,?)',t.work_key,receipt.resultId);
 }
 c.event('accepted',e.id,t.id,workerId,score.correct?'Correct answer':'Answer scored');c.finish(e.id);return receipt;
}

import {Context,uid,type AttemptRow,type TaskRow,type ExperimentRow,type ResultRow} from './db.ts';
import {observeWorker} from './recording.ts';
import {DomainError} from '../shared/errors.ts';
import {LIMITS} from '../shared/limits.ts';
import type {Lease,LeaseRef,Heartbeat,HeartbeatReply,Receipt,FaultInput,RuntimeLock} from '../shared/contracts.ts';

export function receiptFor(c:Context,workerId:string,ref:LeaseRef):Receipt|null{
 if(workerId!==ref.workerId)throw new DomainError('UNAUTHORIZED','Worker identity mismatch');
 const r=c.get<ResultRow>('SELECT * FROM results WHERE lease_id=?',ref.leaseId);if(!r)return null;
 if(r.worker_id!==workerId||r.task_id!==ref.taskId||c.task(r.task_id).experiment_id!==ref.experimentId)throw new DomainError('UNAUTHORIZED','Lease identity mismatch');
 return JSON.parse(r.receipt_json);
}
export function active(c:Context,workerId:string,ref:LeaseRef):{a:AttemptRow;t:TaskRow;e:ExperimentRow}{
 if(workerId!==ref.workerId)throw new DomainError('UNAUTHORIZED','Worker identity mismatch');
 const a=c.get<AttemptRow>('SELECT * FROM attempts WHERE id=?',ref.leaseId);
 if(!a||a.worker_id!==workerId||a.task_id!==ref.taskId)throw new DomainError('LEASE_LOST','Lease not owned by this session');
 const t=c.task(a.task_id),e=c.experiment(t.experiment_id);
 if(t.experiment_id!==ref.experimentId||a.state!=='active'||a.expires_at<=c.now()||a.deadline_at<=c.now()||t.state!=='leased'||e.canceled_at!==null)throw new DomainError('LEASE_LOST','Lease expired or task no longer available');
 return {a,t,e};
}
function lease(c:Context,a:AttemptRow):Lease{
 const t=c.task(a.task_id),e=c.experiment(t.experiment_id),runtime=JSON.parse(e.runtime_json) as RuntimeLock;
 return {experimentId:e.id,taskId:t.id,leaseId:a.id,workerId:a.worker_id,inferenceKey:runtime.inferenceKey,messages:JSON.parse(t.messages_json),generation:runtime.generation,remainingLeaseMs:Math.max(0,a.expires_at-c.now()),remainingAttemptMs:Math.max(0,a.deadline_at-c.now())};
}
function end(c:Context,a:AttemptRow,state:string,isFault:boolean,message:string,permanent=false){
 const t=c.task(a.task_id);const faults=t.faults+(isFault?1:0),failed=permanent||faults>=LIMITS.maxFaults;
 c.run('UPDATE attempts SET state=?,ended_at=? WHERE id=?',state,c.now(),a.id);
 c.run('UPDATE tasks SET state=?,faults=?,error=? WHERE id=?',failed?'failed':'queued',faults,message||null,t.id);
 c.event(state,t.experiment_id,t.id,a.worker_id,message);c.finish(t.experiment_id);
}
export function sweep(c:Context){
 for(const w of c.all<{id:string}>("SELECT id FROM workers WHERE last_seen_at<=? AND state NOT IN ('offline','stopped')",c.now()-LIMITS.leaseMs)){
  c.run("UPDATE workers SET state='offline' WHERE id=?",w.id);c.event('offline',null,null,w.id,'Heartbeat missing');
 }
 for(const a of c.all<AttemptRow>("SELECT * FROM attempts WHERE state='active' AND (expires_at<=? OR deadline_at<=?)",c.now(),c.now()))end(c,a,'expired',true,'Worker lease expired');
}
export function claim(c:Context,workerId:string):Lease|null{
 sweep(c);const w=c.worker(workerId);
 if(['stopping','stopped','offline'].includes(w.state)||w.last_seen_at<=c.now()-LIMITS.leaseMs)return null;
 const prior=c.get<AttemptRow>("SELECT * FROM attempts WHERE worker_id=? AND state='active'",workerId);if(prior)return lease(c,prior);
 if(w.state!=='ready')return null;
 const registration=c.registration(w);
 for(const e of c.all<ExperimentRow>('SELECT * FROM experiments WHERE held=0 AND canceled_at IS NULL AND finished_at IS NULL ORDER BY last_dispatch,created_at,rowid')){
  const runtime=JSON.parse(e.runtime_json) as RuntimeLock,input=c.input(e);
  if(runtime.inferenceKey!==registration.inferenceKey||input.benchmark&&!input.benchmark.workerIds.includes(workerId))continue;
  const t=c.get<TaskRow>("SELECT * FROM tasks WHERE experiment_id=? AND state='queued' AND (assigned_worker IS NULL OR assigned_worker=?) ORDER BY ordinal LIMIT 1",e.id,workerId);if(!t)continue;
  const a:AttemptRow={id:uid(),task_id:t.id,worker_id:workerId,state:'active',started_at:c.now(),expires_at:c.now()+LIMITS.leaseMs,deadline_at:c.now()+LIMITS.attemptMs,ended_at:null};
  c.run('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)',a.id,a.task_id,a.worker_id,a.state,a.started_at,a.expires_at,a.deadline_at,a.ended_at);
  c.run("UPDATE tasks SET state='leased' WHERE id=?",t.id);
  c.run('UPDATE experiments SET started_at=COALESCE(started_at,?),last_dispatch=(SELECT COALESCE(MAX(last_dispatch),0)+1 FROM experiments) WHERE id=?',c.now(),e.id);
  c.event('claimed',e.id,t.id,workerId,t.faults?'Reassigned after an interrupted attempt':'');return lease(c,a);
 }return null;
}
export function heartbeat(c:Context,workerId:string,input:Heartbeat):HeartbeatReply{
 const w=c.worker(workerId);if(w.state==='stopped')throw new DomainError('UNAUTHORIZED','Session has left; register again');
 if(input.lease&&input.lease.workerId!==workerId)throw new DomainError('UNAUTHORIZED','Worker identity mismatch');
 c.run('UPDATE workers SET state=?,level=?,last_seen_at=? WHERE id=?',input.state,input.level,c.now(),workerId);
 observeWorker(c,workerId);
 if((w.state==='offline'||c.now()-w.last_seen_at>=LIMITS.leaseMs)&&input.state!=='offline')c.event('online',null,null,workerId,'Heartbeat resumed');
 if(w.state!==input.state)c.event('state_changed',null,null,workerId,`${w.state} → ${input.state}`,{from:w.state,to:input.state});
 if(w.level!==input.level)c.event('level_changed',null,null,workerId,`${w.level} → ${input.level}`,{from:w.level,to:input.level});
 const empty:HeartbeatReply={leaseValid:false,remainingLeaseMs:0,remainingAttemptMs:0,receipt:null};if(!input.lease)return empty;
 const receipt=receiptFor(c,workerId,input.lease);if(receipt)return {...empty,receipt};
 try{
  const {a}=active(c,workerId,input.lease),expires=Math.min(c.now()+LIMITS.leaseMs,a.deadline_at);
  c.run('UPDATE attempts SET expires_at=? WHERE id=?',expires,a.id);
  return {leaseValid:true,remainingLeaseMs:expires-c.now(),remainingAttemptMs:a.deadline_at-c.now(),receipt:null};
 }catch(e){if(e instanceof DomainError&&e.code==='LEASE_LOST')return empty;throw e;}
}
export function release(c:Context,workerId:string,ref:LeaseRef){
 if(ref.workerId!==workerId)throw new DomainError('UNAUTHORIZED','Worker identity mismatch');
 const a=c.get<AttemptRow>('SELECT * FROM attempts WHERE id=?',ref.leaseId);
 if(a&&a.worker_id===workerId&&a.task_id===ref.taskId&&c.task(a.task_id).experiment_id===ref.experimentId&&a.state==='released')return;
 if(receiptFor(c,workerId,ref))return;
 const v=active(c,workerId,ref);end(c,v.a,'released',false,'Released by owner');
}
export function fault(c:Context,workerId:string,ref:FaultInput){
 if(receiptFor(c,workerId,ref))return;
 const a=c.get<AttemptRow>('SELECT * FROM attempts WHERE id=?',ref.leaseId);
 if(a?.state==='faulted'&&a.worker_id===workerId&&a.task_id===ref.taskId&&c.task(a.task_id).experiment_id===ref.experimentId)return;
 const v=active(c,workerId,ref);end(c,v.a,'faulted',true,`${ref.code}: ${ref.message}`,['INPUT_TOO_LONG','CONFIG_MISMATCH','VALIDATION'].includes(ref.code));
}
export function leave(c:Context,workerId:string){
 c.worker(workerId);for(const a of c.all<AttemptRow>("SELECT * FROM attempts WHERE worker_id=? AND state='active'",workerId))end(c,a,'released',false,'Worker left');
 c.run("UPDATE workers SET state='stopped',last_seen_at=? WHERE id=?",c.now(),workerId);c.event('left',null,null,workerId);
}

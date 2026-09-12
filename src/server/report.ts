import {Context,type TaskRow,type ResultRow,type WorkerRow} from './db.ts';
import {recordingStatus} from './recording.ts';
import {hashJson} from '../domain/keys.ts';
import {LIMITS} from '../shared/limits.ts';
import type {ReportRow,VariantSummary,Snapshot,Report,WorkerView,PoolWorkerView,EventRow,DatasetMeta} from '../shared/contracts.ts';
export function commonSampleIds(rows:ReportRow[],variantIds:string[]):string[]{
 if(!variantIds.length)return [];
 const sets=variantIds.map(v=>new Set(rows.filter(r=>r.variantId===v&&r.state==='completed'&&r.output!==null).map(r=>r.sampleId)));
 return [...sets[0]].filter(id=>sets.every(s=>s.has(id))).sort();
}
export function comparison(rows:ReportRow[],variantIds:string[]):{commonIds:string[];variants:VariantSummary[]}{
 const commonIds=commonSampleIds(rows,variantIds),common=new Set(commonIds);
 return {commonIds,variants:variantIds.map(id=>{const vr=rows.filter(r=>r.variantId===id);return {id,received:vr.filter(r=>r.state==='completed').length,planned:vr.length,failed:vr.filter(r=>r.state==='failed').length,truncated:vr.filter(r=>r.output?.finishReason==='length').length,commonCorrect:vr.filter(r=>common.has(r.sampleId)&&r.score?.correct).length,commonFormatOk:vr.filter(r=>common.has(r.sampleId)&&r.score?.formatOk).length};})};
}
function rows(c:Context,id:string):ReportRow[]{return c.all<TaskRow>('SELECT * FROM tasks WHERE experiment_id=? ORDER BY ordinal',id).map(t=>{
 const r=t.result_id?c.get<ResultRow>('SELECT * FROM results WHERE id=?',t.result_id):null;
 return {taskId:t.id,sampleId:t.sample_id,variantId:t.variant_id,state:t.state as ReportRow['state'],source:t.source,resultId:t.result_id,workerId:r?.worker_id??null,backend:(r?.backend??null) as ReportRow['backend'],output:r?JSON.parse(r.output_json):null,score:t.score_json?JSON.parse(t.score_json):null,acceptedAt:t.completed_at,error:t.error};
});}
function events(c:Context,id:string,limit?:number):EventRow[]{
 const e=c.experiment(id),end=e.finished_at??e.canceled_at??c.now();
 const sql=`SELECT id,at,kind,task_id AS taskId,worker_id AS workerId,detail FROM events
 WHERE experiment_id=? OR (experiment_id IS NULL AND at>=? AND at<=? AND worker_id IN
 (SELECT a.worker_id FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.experiment_id=?))`;
 const args=[id,e.created_at,end,id];
 return limit?c.all<EventRow>(sql+' ORDER BY id DESC LIMIT ?',...args,limit).reverse():c.all<EventRow>(sql+' ORDER BY id',...args);
}
function poolWorker(c:Context,w:WorkerRow,now:number):PoolWorkerView{
 return {...c.registration(w),id:w.id,state:(w.state!=='stopped'&&now-w.last_seen_at>=LIMITS.leaseMs?'offline':w.state) as PoolWorkerView['state'],level:w.level as PoolWorkerView['level'],lastSeenAt:w.last_seen_at};
}
export function connectedWorkers(c:Context):PoolWorkerView[]{
 const now=c.now();
 return c.all<WorkerRow>('SELECT * FROM workers ORDER BY rowid').map(w=>poolWorker(c,w,now)).filter(w=>!['offline','stopped'].includes(w.state));
}
export function snapshot(c:Context,id:string):Snapshot{
 const now=c.now(),e=c.experiment(id),rr=rows(c,id),comp=comparison(rr,c.input(e).variants.map(v=>v.id));
 const counts=(state:string)=>rr.filter(r=>r.state===state).length;
 const fresh=rr.filter(r=>r.source==='computed').length,cached=rr.filter(r=>r.source==='cache').length;
 const contributorCounts=new Map<string,number>();
 for(const r of rr)if(r.source==='computed'&&r.workerId)contributorCounts.set(r.workerId,(contributorCounts.get(r.workerId)??0)+1);
 const workers:WorkerView[]=c.all<WorkerRow>('SELECT * FROM workers ORDER BY rowid').filter(w=>contributorCounts.has(w.id)).map(w=>({
  ...poolWorker(c,w,now),completed:contributorCounts.get(w.id)!,
  credits:c.get<{n:number}>('SELECT COALESCE(SUM(value),0) n FROM credits WHERE worker_id=? AND task_id IN (SELECT id FROM tasks WHERE experiment_id=?)',w.id,id)!.n,
 }));
 const terminalAt=e.finished_at??e.canceled_at??now;
 const firstDispatch=c.get<{at:number|null}>('SELECT MIN(a.started_at) AS at FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.experiment_id=?',id)!.at;
 const elapsedMs=Math.max(0,terminalAt-e.created_at),executionElapsedMs=firstDispatch===null?null:Math.max(0,terminalAt-firstDispatch);
 const workloadFingerprint=hashJson(c.all<{work_key:string}>('SELECT work_key FROM tasks WHERE experiment_id=? ORDER BY ordinal',id).map(t=>t.work_key));
 const endTime=now,windowStart=e.started_at===null?endTime:Math.max(e.started_at,endTime-LIMITS.throughputWindowMs),windowMs=Math.max(0,endTime-windowStart);
 const recent=rr.filter(r=>r.source==='computed'&&r.acceptedAt!==null&&r.acceptedAt>=windowStart&&r.acceptedAt<=endTime).length;
 const throughput=windowMs>0?recent/(windowMs/1000):0;
 const changed=c.get<{at:number}>("SELECT MAX(at) at FROM events WHERE kind IN ('registered','left','offline')")?.at??0;
 const eta=e.finished_at===null&&fresh>=10&&e.started_at!==null&&now-e.started_at>=30000&&now-changed>=30000&&throughput>0?(counts('queued')+counts('leased'))/throughput:null;
 return {recording:recordingStatus(c,id),createdAt:e.created_at,elapsedMs,executionElapsedMs,workloadFingerprint,experimentId:id,name:c.input(e).name,mode:e.mode,state:e.canceled_at!==null?'canceled':e.finished_at!==null?(counts('failed')?'completed-with-errors':'completed'):e.started_at===null?'queued':'running',planned:rr.length,fresh,cached,leased:counts('leased'),queued:counts('queued'),failed:counts('failed'),canceled:counts('canceled'),retries:c.get<{n:number}>('SELECT COALESCE(SUM(faults),0) n FROM tasks WHERE experiment_id=?',id)!.n,commonCount:comp.commonIds.length,variants:comp.variants,workers,throughput,windowMs,etaSeconds:eta,startedAt:e.started_at,finishedAt:e.finished_at,events:events(c,id,100)};
}
export function report(c:Context,id:string):Report{
 const e=c.experiment(id),input=c.input(e);
 return {snapshot:snapshot(c,id),dataset:JSON.parse(c.get<{meta_json:string}>('SELECT meta_json FROM datasets WHERE id=?',e.dataset_id)!.meta_json) as DatasetMeta,samples:input.sampleIds.map(id=>c.sample(e,id)),variants:input.variants,runtime:JSON.parse(e.runtime_json),scoringVersion:'answer-line-v1',rows:rows(c,id),attempts:c.all('SELECT a.id AS leaseId,a.task_id AS taskId,a.worker_id AS workerId,a.state,a.started_at AS startedAt,a.ended_at AS endedAt FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.experiment_id=? ORDER BY a.started_at,a.rowid',id),events:events(c,id)};
}

import type {Context,WorkerRow,AttemptRow} from './db.ts';
import type {RecordingStatus,ExperimentTrace,TraceWorker,TraceFrame,TraceProgress,RuntimeLock} from '../shared/contracts.ts';
import {LIMITS} from '../shared/limits.ts';
import {DomainError} from '../shared/errors.ts';

interface RecordingRow {experiment_id:string;started_at:number;ended_at:number|null;last_frame_at:number|null;last_observed_at:number;has_gaps:number;initial_tasks_json:string}
const row=(c:Context,id:string)=>c.get<RecordingRow>('SELECT * FROM experiment_recordings WHERE experiment_id=?',id);
function addEvent(c:Context,id:string,kind:string,at:number,data:Record<string,unknown>={},workerId:string|null=null,taskId:string|null=null){
 c.run('INSERT INTO recording_events(experiment_id,at,kind,worker_id,task_id,data_json) VALUES(?,?,?,?,?,?)',id,at,kind,workerId,taskId,JSON.stringify(data));
 c.run('UPDATE experiment_recordings SET last_observed_at=? WHERE experiment_id=?',at,id);
}
function rememberWorker(c:Context,id:string,workerId:string,at:number){
 if(c.get('SELECT 1 FROM recording_workers WHERE experiment_id=? AND worker_id=?',id,workerId))return;
 const w=c.worker(workerId),r=c.registration(w);
 const metadata:TraceWorker={...r,workerId,deviceId:r.deviceId??`session:${workerId}`,identityKind:r.deviceId?'installation':'session',firstObservedAt:at};
 c.run('INSERT INTO recording_workers VALUES(?,?,?)',id,workerId,JSON.stringify(metadata));
}
function activeRows(c:Context):RecordingRow[]{return c.all<RecordingRow>('SELECT * FROM experiment_recordings WHERE ended_at IS NULL');}

export function recordingStatus(c:Context,id:string):RecordingStatus{
 const r=row(c,id);
 if(!r)return {available:false,startedAt:null,endedAt:null,eventCount:0,frameCount:0,hasGaps:false};
 return {available:true,startedAt:r.started_at,endedAt:r.ended_at,hasGaps:Boolean(r.has_gaps),
  eventCount:c.get<{n:number}>('SELECT COUNT(*) n FROM recording_events WHERE experiment_id=?',id)!.n,
  frameCount:c.get<{n:number}>('SELECT COUNT(*) n FROM recording_frames WHERE experiment_id=?',id)!.n};
}
export function startRecording(c:Context,id:string){
 const at=c.now(),tasks=c.all("SELECT id taskId,sample_id sampleId,variant_id variantId,ordinal,state initialState,source initialSource,result_id initialResultId FROM tasks WHERE experiment_id=? ORDER BY ordinal",id);
 c.run('INSERT INTO experiment_recordings(experiment_id,started_at,last_observed_at,initial_tasks_json) VALUES(?,?,?,?)',id,at,at,JSON.stringify(tasks));
 for(const w of c.all<WorkerRow>("SELECT * FROM workers WHERE state NOT IN ('stopped','offline') AND last_seen_at>? ORDER BY rowid",at-LIMITS.leaseMs))rememberWorker(c,id,w.id,at);
 addEvent(c,id,'recording_started',at,{scope:'group-pool-during-experiment'});captureFrame(c,id,'initial');
}

export function observeWorker(c:Context,workerId:string){
 for(const r of activeRows(c))if(!c.get('SELECT 1 FROM recording_workers WHERE experiment_id=? AND worker_id=?',r.experiment_id,workerId)){
  const w=c.worker(workerId);rememberWorker(c,r.experiment_id,workerId,c.now());
  addEvent(c,r.experiment_id,'worker_observed',c.now(),{observedState:w.state,level:w.level},workerId);
 }
}

export function recordEvent(c:Context,input:{experimentId:string|null;kind:string;at:number;workerId:string|null;taskId:string|null;data?:Record<string,unknown>}){
 const targets=input.experimentId?[row(c,input.experimentId)].filter((r):r is RecordingRow=>Boolean(r&&r.ended_at===null)):activeRows(c);
 for(const r of targets){
  if(input.workerId)rememberWorker(c,r.experiment_id,input.workerId,input.at);
  // Only structured recorder fields are exported; raw worker fault text can contain local paths or credentials.
  const data:Record<string,unknown>={...input.data};
  if(input.taskId){
   const t=c.task(input.taskId),a=c.get<AttemptRow>('SELECT * FROM attempts WHERE task_id=? ORDER BY rowid DESC LIMIT 1',t.id);
   Object.assign(data,{sampleId:t.sample_id,variantId:t.variant_id,taskState:t.state,source:t.source,resultId:t.result_id,leaseId:a?.id??null,attemptState:a?.state??null});
  }
  if(input.workerId){const w=c.worker(input.workerId);Object.assign(data,{observedState:w.state,level:w.level});}
  addEvent(c,r.experiment_id,input.kind,input.at,data,input.workerId,input.taskId);
 }
}

function progress(c:Context,id:string):TraceProgress{
 return c.get<TraceProgress>(`SELECT COUNT(*) planned,
 COALESCE(SUM(source='computed'),0) fresh,COALESCE(SUM(source='cache'),0) cached,
 COALESCE(SUM(state='queued'),0) queued,COALESCE(SUM(state='leased'),0) leased,
 COALESCE(SUM(state='failed'),0) failed,COALESCE(SUM(state='canceled'),0) canceled,COALESCE(SUM(faults),0) retries
 FROM tasks WHERE experiment_id=?`,id)!;
}
export function captureFrame(c:Context,id:string,reason:TraceFrame['reason']){
 const r=row(c,id);if(!r||r.ended_at!==null)return;
 const at=c.now();
 const counts=new Map(c.all<{workerId:string;completed:number;credits:number}>(`SELECT r.worker_id workerId,COUNT(*) completed,COALESCE(SUM(cr.value),0) credits
 FROM results r JOIN tasks t ON t.id=r.task_id LEFT JOIN credits cr ON cr.task_id=t.id WHERE t.experiment_id=? AND t.source='computed' GROUP BY r.worker_id`,id).map(v=>[v.workerId,v]));
 const active=new Map<string,string[]>();
 for(const a of c.all<{workerId:string;taskId:string}>(`SELECT a.worker_id workerId,a.task_id taskId FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.experiment_id=? AND a.state='active' ORDER BY a.rowid`,id))active.set(a.workerId,[...(active.get(a.workerId)??[]),a.taskId]);
 const workers=c.all<WorkerRow&{metadata_json:string}>(`SELECT w.*,rw.metadata_json FROM recording_workers rw JOIN workers w ON w.id=rw.worker_id WHERE rw.experiment_id=? ORDER BY rw.rowid`,id).map(w=>{
  const meta=JSON.parse(w.metadata_json) as TraceWorker;
  return {workerId:w.id,deviceId:meta.deviceId,state:(w.state!=='stopped'&&at-w.last_seen_at>=LIMITS.leaseMs?'offline':w.state) as TraceFrame['workers'][number]['state'],level:w.level as TraceFrame['workers'][number]['level'],lastSeenAt:w.last_seen_at,completed:counts.get(w.id)?.completed??0,credits:counts.get(w.id)?.credits??0,activeTaskIds:active.get(w.id)??[]};
 });
 const frame:Omit<TraceFrame,'seq'>={at,reason,eventCursor:c.get<{n:number}>('SELECT COALESCE(MAX(seq),0) n FROM recording_events WHERE experiment_id=?',id)!.n,progress:progress(c,id),workers};
 c.run('INSERT INTO recording_frames(experiment_id,at,frame_json) VALUES(?,?,?)',id,at,JSON.stringify(frame));
 c.run('UPDATE experiment_recordings SET last_frame_at=?,last_observed_at=? WHERE experiment_id=?',at,at,id);
}
export function captureDue(c:Context){for(const r of activeRows(c))if(r.last_frame_at===null||c.now()-r.last_frame_at>=LIMITS.recordingFrameMs)captureFrame(c,r.experiment_id,'periodic');}
export function finishRecording(c:Context,id:string){
 const r=row(c,id);if(!r||r.ended_at!==null)return;
 addEvent(c,id,'recording_ended',c.now(),{state:c.experiment(id).canceled_at!==null?'canceled':'finished'});
 captureFrame(c,id,'terminal');c.run('UPDATE experiment_recordings SET ended_at=? WHERE experiment_id=?',c.now(),id);
}
export function checkpointRecordings(c:Context){for(const r of activeRows(c)){addEvent(c,r.experiment_id,'recording_paused',c.now(),{reason:'coordinator_stopped'});captureFrame(c,r.experiment_id,'checkpoint');}}
export function resumeRecordings(c:Context){
 for(const r of activeRows(c)){
  c.run('UPDATE experiment_recordings SET has_gaps=1 WHERE experiment_id=?',r.experiment_id);
  addEvent(c,r.experiment_id,'recording_resumed',c.now(),{gapFrom:r.last_observed_at,gapTo:c.now(),reason:'coordinator_restarted'});
  captureFrame(c,r.experiment_id,'resume');
 }
}
export function exportTrace(c:Context,id:string):ExperimentTrace{
 const e=c.experiment(id),recording=recordingStatus(c,id);if(!recording.available)throw new DomainError('NOT_FOUND','No process recording exists for this legacy experiment');
 const input=c.input(e),runtime=JSON.parse(e.runtime_json) as RuntimeLock;
 return {schemaVersion:1,scope:'group-pool-during-experiment',timeUnit:'unix-ms',frameIntervalMs:LIMITS.recordingFrameMs,recording,
  experiment:{id,name:input.name,mode:e.mode,datasetId:e.dataset_id,questionCount:input.sampleIds.length,promptCount:input.variants.length,model:runtime.modelRepo,inferenceKey:runtime.inferenceKey},
  tasks:JSON.parse(row(c,id)!.initial_tasks_json),
  workers:c.all<{metadata_json:string}>('SELECT metadata_json FROM recording_workers WHERE experiment_id=? ORDER BY rowid',id).map(w=>JSON.parse(w.metadata_json) as TraceWorker),
  events:c.all<{seq:number;at:number;kind:string;workerId:string|null;taskId:string|null;data_json:string}>('SELECT seq,at,kind,worker_id workerId,task_id taskId,data_json FROM recording_events WHERE experiment_id=? ORDER BY seq',id).map(({data_json,...v})=>({...v,data:JSON.parse(data_json)})),
  frames:c.all<{seq:number;frame_json:string}>('SELECT seq,frame_json FROM recording_frames WHERE experiment_id=? ORDER BY seq',id).map(v=>({...JSON.parse(v.frame_json),seq:v.seq})),
 };
}

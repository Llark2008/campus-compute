import type {ExperimentTrace,TraceEvent,TraceFrame,TraceProgress,TraceWorker,WorkerState,Level,TaskState} from '../shared/contracts.ts';

export interface ReplayTiming {createdAt:number;finishedAt:number}
export interface ReplayDevice {
 id:string;workerIds:string[];name:string;cpu:string;memoryBytes:number;backend:string;identityKind:'installation'|'session';
 state:WorkerState;level:Level;connected:boolean;completed:number;credits:number;activeTaskIds:string[];joinedAt:number;lastAcceptedAt:number|null;
}
export interface Milestone {id:string;at:number;kind:'start'|'join'|'leave'|'handoff'|'finish';title:string;detail:string;workerId?:string}
export interface Handoff {
 taskId:string;sampleId:string;variantId:string;fromId:string;toId:string;fromName:string;toName:string;
 releasedAt:number;claimedAt:number;acceptedAt:number|null;releasedLeaseId:string;claimedLeaseId:string;claimDelayMs:number;completionDelayMs:number|null;
}
export interface ReplayState {at:number;elapsedMs:number;progress:TraceProgress;devices:ReplayDevice[];gap:boolean;rate:number}
export interface ReplayIndex {
 trace:ExperimentTrace;startAt:number;durationMs:number;points:ReplayState[];milestones:Milestone[];handoffs:Handoff[];
 gaps:{from:number;to:number}[];acceptedTimes:number[];
}
type Session=TraceFrame['workers'][number]&{joinedAt:number;lastAcceptedAt:number|null};
const connected=(state:WorkerState)=>state!=='stopped'&&state!=='offline';
const number=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const taskKinds=new Set(['claimed','accepted','released','expired','faulted','task_canceled']);

export function createReplay(trace:ExperimentTrace,timing?:ReplayTiming):ReplayIndex {
 if(!trace.frames.length||trace.schemaVersion!==1)throw new Error('This recording has no supported progress frames.');
 const first=trace.frames[0];
 const startAt=timing?.createdAt??trace.recording.startedAt??first.at;
 const endAt=timing?.finishedAt??trace.recording.endedAt??trace.frames.at(-1)!.at;
 const durationMs=Math.max(0,endAt-startAt);
 const metadata=new Map(trace.workers.map(w=>[w.workerId,w]));
 const sessions=new Map<string,Session>();
 const tasks=new Map(trace.tasks.map(t=>[t.taskId,t.initialState as TaskState]));
 const accepted=new Set<string>();
 const acceptedTimes:number[]=[];
 const gaps=trace.events.filter(e=>e.kind==='recording_resumed').map(e=>({from:number(e.data.gapFrom,e.at),to:number(e.data.gapTo,e.at)}));
 let progress:TraceProgress={...first.progress};
 for(const worker of first.workers)sessions.set(worker.workerId,{...worker,activeTaskIds:[...worker.activeTaskIds],joinedAt:startAt,lastAcceptedAt:null});
 const snapshot=(at:number):ReplayState=>{
  const grouped=new Map<string,ReplayDevice>();
  for(const [workerId,session] of sessions){
   const meta=metadata.get(workerId);if(!meta)continue;
   const id=meta.deviceId;
   const existing=grouped.get(id);
   if(existing){
    existing.workerIds.push(workerId);existing.completed+=session.completed;existing.credits+=session.credits;
    existing.activeTaskIds.push(...session.activeTaskIds);
    if(session.joinedAt>=existing.joinedAt){existing.state=session.state;existing.level=session.level;}
    existing.connected ||= connected(session.state);
    existing.lastAcceptedAt=Math.max(existing.lastAcceptedAt??0,session.lastAcceptedAt??0)||null;
   }else grouped.set(id,{id,workerIds:[workerId],name:meta.name,cpu:meta.cpu,memoryBytes:meta.memoryBytes,backend:meta.backend,identityKind:meta.identityKind,
    state:session.state,level:session.level,connected:connected(session.state),completed:session.completed,credits:session.credits,
    activeTaskIds:[...session.activeTaskIds],joinedAt:session.joinedAt,lastAcceptedAt:session.lastAcceptedAt});
  }
  return {at,elapsedMs:Math.max(0,at-startAt),progress:{...progress},devices:[...grouped.values()],gap:false,rate:0};
 };
 const points:ReplayState[]=[snapshot(startAt)];
 const ensure=(id:string,at:number):Session|null=>{
  let worker=sessions.get(id);
  if(!worker){
   const meta=metadata.get(id);if(!meta)return null;
   worker={workerId:id,deviceId:meta.deviceId,state:'ready',level:'medium',lastSeenAt:at,completed:0,credits:0,activeTaskIds:[],joinedAt:at,lastAcceptedAt:null};
   sessions.set(id,worker);
  }
  return worker;
 };
 const bucket=(state:TaskState)=>state==='completed'?'fresh':state;
 const apply=(event:TraceEvent)=>{
  const worker=event.workerId?ensure(event.workerId,event.at):null;
  if(worker){
   if(typeof event.data.observedState==='string')worker.state=event.data.observedState as WorkerState;
   if(typeof event.data.level==='string')worker.level=event.data.level as Level;
   worker.lastSeenAt=event.at;
  }
  if(event.taskId&&taskKinds.has(event.kind)){
   const previous=tasks.get(event.taskId);
   const next=event.data.taskState as TaskState|undefined;
   if(previous&&next&&previous!==next){progress[bucket(previous)]--;progress[bucket(next)]++;tasks.set(event.taskId,next);}
   for(const session of sessions.values())session.activeTaskIds=session.activeTaskIds.filter(id=>id!==event.taskId);
   if(event.kind==='claimed'&&worker)worker.activeTaskIds.push(event.taskId);
   if(event.kind==='accepted'&&!accepted.has(event.taskId)){
    accepted.add(event.taskId);acceptedTimes.push(event.at);
    if(worker){worker.completed++;worker.credits++;worker.lastAcceptedAt=event.at;}
   }
   if(event.kind==='faulted')progress.retries++;
  }
 };
 // Frames follow the last event they contain. Cursor ordering also resolves equal-millisecond boundaries.
 const entries=[...trace.events.map(event=>({at:event.at,order:event.seq*2,event})),...trace.frames.map(frame=>({at:frame.at,order:frame.eventCursor*2+1,frame}))]
  .sort((a,b)=>a.at-b.at||a.order-b.order);
 for(const entry of entries){
  if('event' in entry)apply(entry.event);
  else{
   progress={...entry.frame.progress};
   for(const observed of entry.frame.workers){
    const previous=ensure(observed.workerId,entry.frame.at);
    if(previous)Object.assign(previous,observed,{activeTaskIds:[...observed.activeTaskIds]});
   }
  }
  points.push(snapshot(entry.at));
 }
 const handoffs:Handoff[]=[];
 for(const release of trace.events.filter(e=>e.kind==='released'&&e.taskId&&e.workerId)){
  const claim=trace.events.find(e=>e.seq>release.seq&&e.taskId===release.taskId&&e.kind==='claimed');
  if(!claim?.workerId||claim.workerId===release.workerId||claim.data.leaseId===release.data.leaseId)continue;
  const completion=trace.events.find(e=>e.seq>claim.seq&&e.taskId===release.taskId&&e.kind==='accepted'&&e.data.leaseId===claim.data.leaseId);
  handoffs.push({taskId:release.taskId!,sampleId:String(release.data.sampleId),variantId:String(release.data.variantId),fromId:release.workerId!,toId:claim.workerId,
   fromName:metadata.get(release.workerId!)?.name??'Device',toName:metadata.get(claim.workerId)?.name??'Device',releasedAt:release.at,claimedAt:claim.at,acceptedAt:completion?.at??null,
   releasedLeaseId:String(release.data.leaseId),claimedLeaseId:String(claim.data.leaseId),claimDelayMs:claim.at-release.at,completionDelayMs:completion?completion.at-release.at:null});
 }
 const milestones:Milestone[]=[{id:'start',at:startAt,kind:'start',title:'One laptop. A shared queue.',detail:`${trace.experiment.questionCount.toLocaleString()} questions × ${trace.experiment.promptCount} prompts. Real model inference on donated laptop capacity.`}];
 for(const event of trace.events){
  if(event.kind==='registered'||event.kind==='worker_observed'){
   if(event.at<=first.at)continue;
   const name=metadata.get(event.workerId??'')?.name??'A device';
   milestones.push({id:`event-${event.seq}`,at:event.at,kind:'join',workerId:event.workerId??undefined,title:`${name} joins the pool.`,detail:'The coordinator can now assign work to another laptop. Its contribution starts at zero.'});
  }
  if(event.kind==='left'||event.kind==='offline'){
   const name=metadata.get(event.workerId??'')?.name??'A device';
   milestones.push({id:`event-${event.seq}`,at:event.at,kind:'leave',workerId:event.workerId??undefined,title:`${name} ${event.kind==='left'?'leaves':'goes offline'}.`,detail:'Accepted work stays credited. The remaining devices keep processing the queue.'});
  }
 }
 for(const h of handoffs)milestones.push({id:`handoff-${h.taskId}`,at:h.acceptedAt??h.claimedAt,kind:'handoff',title:'The task finds its next laptop.',detail:`${h.toName} takes over the released task${h.acceptedAt?' and completes it':''}. No accepted result is lost.`});
 const final=points.at(-1)!.progress;
 milestones.push({id:'finish',at:startAt+durationMs,kind:'finish',title:final.failed||final.canceled?'The run has ended.':'Every task accounted for.',detail:`${final.fresh.toLocaleString()} fresh results accepted · ${final.cached} cached · ${final.failed} failed · ${final.canceled} canceled.`});
 milestones.sort((a,b)=>a.at-b.at);
 return {trace,startAt,durationMs,points,milestones,handoffs,gaps,acceptedTimes};
}
function upperBound<T>(values:T[],at:number,key:(value:T)=>number):number{
 let lo=0,hi=values.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(key(values[mid])<=at)lo=mid+1;else hi=mid;}
 return lo;
}
export function stateAt(index:ReplayIndex,elapsedMs:number):ReplayState{
 const elapsed=Math.max(0,Math.min(Number.isNaN(elapsedMs)?0:elapsedMs,index.durationMs));
 const at=index.startAt+elapsed;
 const point=index.points[Math.max(0,upperBound(index.points,at,p=>p.at)-1)];
 const window=Math.min(elapsed,30_000);
 const count=upperBound(index.acceptedTimes,at,v=>v)-upperBound(index.acceptedTimes,at-window,v=>v);
 return {...point,elapsedMs:elapsed,at,gap:index.gaps.some(g=>at>g.from&&at<g.to),rate:window>0?count/(window/1000):0};
}
export const formatTime=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
export const deviceColor=(index:number)=>['#66dbc4','#8db7ff','#ffc681','#d5a6f2'][index%4];

export function chartSeries(index:ReplayIndex,state:ReplayState):{elapsed:number;fresh:number}[][]{
 const samples=[{at:index.startAt,fresh:index.points[0].progress.fresh},
  ...index.trace.frames.filter(f=>f.at<=state.at).map(f=>({at:f.at,fresh:f.progress.fresh})),
  {at:state.at,fresh:state.progress.fresh}];
 const segments:{elapsed:number;fresh:number}[][]=[];
 let previousAt:number|undefined;
 for(const sample of samples){
  if(index.gaps.some(g=>sample.at>g.from&&sample.at<g.to))continue;
  if(previousAt===undefined||index.gaps.some(g=>previousAt!<=g.from&&sample.at>=g.to))segments.push([]);
  segments.at(-1)!.push({elapsed:sample.at-index.startAt,fresh:sample.fresh});previousAt=sample.at;
 }
 return segments;
}

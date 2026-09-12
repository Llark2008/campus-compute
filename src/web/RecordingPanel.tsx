import React from 'react';
import type {RecordingStatus,ExperimentTrace} from '../shared/contracts.ts';
import type {Api} from './api.ts';
import {LatestRequest} from './view-model.ts';

export function RecordingPanel({api,id,status}:{api:Api;id:string;status?:RecordingStatus}){
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState<string|null>(null);
 const requests=React.useRef(new LatestRequest()).current,abort=React.useRef<AbortController|null>(null);
 React.useEffect(()=>{setBusy(false);setError(null);return()=>{requests.invalidate();abort.current?.abort();};},[api,id,requests]);
 async function download(){
  if(!status?.available)return;
  abort.current?.abort();const controller=new AbortController();abort.current=controller;
  const request=requests.begin();setBusy(true);setError(null);
  try{
   const trace=await api.get<ExperimentTrace>(`/api/experiments/${encodeURIComponent(id)}/trace`,controller.signal);
   if(!request.isCurrent()||controller.signal.aborted)return;
   const url=URL.createObjectURL(new Blob([JSON.stringify(trace,null,2)],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download=`campus-compute-replay-${id}.json`;
   document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
  }catch(cause){if(request.isCurrent()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Unable to export recording.');}
  finally{if(request.isCurrent()){setBusy(false);if(abort.current===controller)abort.current=null;}}
 }
 return <section className="recording-panel" aria-label="Experiment process recording">
  <div><p className="eyebrow">Process recording</p><h2>{!status?.available?'No process recording':status.endedAt===null?'Recording automatically':'Recording complete'}</h2>
   <p>{status?.available?'Pool joins, exits and task events are saved on the coordinator. Progress frames are captured every 2 seconds, even with this page closed.':'This run predates process recording. Start a new evaluation to capture its full timeline.'}</p>
   {status?.available&&<span className="recording-counts">{status.eventCount.toLocaleString()} events · {status.frameCount.toLocaleString()} frames · includes devices with zero accepted work</span>}
   {status?.hasGaps&&<p className="recording-gap">This recording contains an observation gap. The exported timeline marks where the coordinator restarted.</p>}
   {error&&<p className="form-error" role="alert">{error}</p>}
  </div>
  {status?.available&&<div style={{display:'flex',gap:10,flexWrap:'wrap',flexShrink:0}}>
   {id==='90a8719c-4f0d-41f3-b5df-13046c68faf8'&&<a className="button primary" href="/showcase.html" target="_blank" rel="noreferrer">Watch replay ↗</a>}
   <button className="button secondary" type="button" disabled={busy} onClick={()=>void download()}>{busy?'Exporting…':'Export replay JSON'}</button>
  </div>}
 </section>;
}

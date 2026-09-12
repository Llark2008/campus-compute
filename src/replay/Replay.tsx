import React from 'react';
import type {ExperimentTrace} from '../shared/contracts.ts';
import {createReplay,stateAt,formatTime,deviceColor,type ReplayTiming} from './model.ts';
import {Network} from './Network.tsx';
import './replay.css';

export function Replay({trace,timing}:{trace:ExperimentTrace;timing?:ReplayTiming}){
 const index=React.useMemo(()=>createReplay(trace,timing),[trace,timing]);
 const [elapsed,setElapsed]=React.useState(0),[playing,setPlaying]=React.useState(false),[speed,setSpeed]=React.useState(24);
 const [full,setFull]=React.useState(false),[message,setMessage]=React.useState('');
 const state=React.useMemo(()=>stateAt(index,elapsed),[index,elapsed]);
 const end=elapsed>=index.durationMs;
 const stage=index.milestones.filter(m=>m.at<=state.at).at(-1)??index.milestones[0];
 const stageNumber=Math.max(0,index.milestones.indexOf(stage));
 const terminal=state.progress.fresh+state.progress.cached+state.progress.failed+state.progress.canceled;
 const percent=state.progress.planned?terminal/state.progress.planned*100:0;
 const handoff=index.handoffs.find(h=>h.releasedAt<=state.at);
 const handoffComplete=Boolean(handoff?.acceptedAt&&handoff.acceptedAt<=state.at);
 const handoffClaimed=Boolean(handoff&&handoff.claimedAt<=state.at);
 React.useEffect(()=>{
  if(!playing)return;
  let previous:number|undefined,frame:number;
  const tick=(now:number)=>{
   // Capture the delta before React may defer the updater and previous advances.
   const delta=previous===undefined?0:now-previous;
   if(delta>0)setElapsed(value=>Math.min(index.durationMs,value+delta*speed));
   previous=now;frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[playing,speed,index.durationMs]);
 React.useEffect(()=>{if(end)setPlaying(false);},[end]);
 const toggle=React.useCallback(()=>{if(end)setElapsed(0);setPlaying(p=>!p);},[end]);
 React.useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.code!=='Space'||(event.target instanceof HTMLElement&&event.target.closest('button,input,select,textarea,a,[contenteditable]')))return;
   event.preventDefault();toggle();
  };
  const visibility=()=>{if(document.hidden)setPlaying(false);};
  const fullscreen=()=>setFull(Boolean(document.fullscreenElement));
  document.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);document.addEventListener('fullscreenchange',fullscreen);
  return()=>{document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('fullscreenchange',fullscreen);};
 },[toggle]);
 const seek=(value:number)=>{setElapsed(Math.max(0,Math.min(value,index.durationMs)));setPlaying(false);};
 async function fullscreen(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{setMessage('Fullscreen is unavailable here. Open this page in a browser window.');}
 }
 function download(){
  const url=URL.createObjectURL(new Blob([JSON.stringify(trace,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`campus-compute-replay-${trace.experiment.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const chapters=index.milestones;
 return <div className="replay-app">
  <header className="replay-header"><a className="replay-brand" href="#" onClick={e=>{e.preventDefault();seek(0);}}><span className="replay-mark"><i/><i/><i/></span>Campus<span>Compute</span></a>
   <div className="recorded-badge"><span/> REAL EXPERIMENT <b>REPLAY</b></div><button className="icon-button fullscreen-button" onClick={()=>void fullscreen()} aria-label={full?'Exit fullscreen':'Enter fullscreen'}>{full?'↙':'⛶'}<span>{full?'Exit fullscreen':'Fullscreen'}</span></button>
  </header>
  <main className="replay-main">
   <section className="replay-intro"><div><p className="section-label">SHARED CAPACITY. ON YOUR TERMS.</p><h1>Every laptop moves us forward<span>.</span></h1></div><div className="run-description"><strong>1,000 science questions. 3 prompts.</strong><span>Qwen2.5 1.5B · ARC-Challenge · {trace.experiment.name}</span></div></section>
   <section className="progress-panel" aria-label="Total experiment progress">
    <div className="progress-primary"><span className="section-label">TOTAL PROGRESS</span><div className="progress-number"><strong data-testid="completed-count">{state.progress.fresh.toLocaleString()}</strong><span>/ {state.progress.planned.toLocaleString()} tasks</span><b>{percent.toFixed(1)}%</b></div>
    </div>
    <div className="stat-block"><span>EXPERIMENT TIME</span><strong data-testid="experiment-time">{formatTime(elapsed)}<small> / {formatTime(index.durationMs)}</small></strong></div>
    <div className="stat-block"><span>CONNECTED NOW</span><strong data-testid="connected-count">{state.devices.filter(d=>d.connected).length}<small> {state.devices.filter(d=>d.connected).length===1?'laptop':'laptops'}</small></strong></div>
    <div className="stat-block"><span>FRESH COMPUTATION</span><strong>{state.progress.cached}<small> cached results</small></strong></div>
    <div className="progress-breakdown">
     <div className="total-progress" role="progressbar" aria-label="Experiment completion by device" aria-valuenow={terminal} aria-valuemin={0} aria-valuemax={state.progress.planned}>
      {state.devices.map((device,i)=><span key={device.id} className="device-progress-segment" data-device={device.name} data-completed={device.completed} title={`${device.name}: ${device.completed.toLocaleString()} accepted tasks`} style={{width:`${device.completed/(state.progress.planned||1)*100}%`,backgroundColor:deviceColor(i)}}/>)}
      {state.progress.cached>0&&<span className="cached-progress" title={`${state.progress.cached} cached results`} style={{width:`${state.progress.cached/(state.progress.planned||1)*100}%`}}/>}
      {state.progress.failed+state.progress.canceled>0&&<span className="failed-progress" title="Failed or canceled tasks" style={{width:`${(state.progress.failed+state.progress.canceled)/(state.progress.planned||1)*100}%`}}/>}
     </div>
     <div className="progress-key" aria-label="Progress color legend">
      {state.devices.map((device,i)=><span key={device.id}><i style={{backgroundColor:deviceColor(i)}}/><span>{device.name}</span><b>{device.completed.toLocaleString()}</b></span>)}
      <span className="remaining-key"><i/>{(state.progress.queued+state.progress.leased).toLocaleString()} remaining</span>
     </div>
    </div>
   </section>
   {state.gap&&<div className="gap-warning" role="status">Recording gap — coordinator observations are unavailable here. Counters show the last recorded state.</div>}
   <div className="replay-grid">
    <Network state={state} playing={playing}/>
    <section className="contributions" aria-label="Device contributions"><div className="panel-heading"><span className="section-label">EVERY CONTRIBUTION COUNTS</span><span>{state.devices.length} seen</span></div>
     <div className="contribution-list">{state.devices.map((d,i)=><article className={`contribution-card ${!d.connected?'has-left':''}`} key={d.id} style={{'--device-color':deviceColor(i)} as React.CSSProperties}>
      <div className="contributor-head"><div><span className="contributor-dot"/><strong>{d.name}</strong></div><span className={`device-state ${!d.connected?'left':''}`}>{!d.connected?'Left the pool':end?'Run finished':d.activeTaskIds.length?'Computing':'Connected'}</span></div>
      <div className="contributor-value"><strong>{d.completed.toLocaleString()}</strong><span>accepted tasks <b>·</b> {d.level} setting</span></div>
      <div className="contribution-bar"><span style={{width:`${d.completed/state.progress.planned*100}%`}}/></div>
     </article>)}</div>
     {state.devices.length<3&&<div className="invitation-note"><span>＋</span><p>More capacity can join at any time.<small>New devices begin with zero contribution.</small></p></div>}
     <div className="contribution-total"><span>Fresh results accepted</span><strong>{state.progress.fresh.toLocaleString()}</strong></div>
    </section>
    <section className={`story-panel ${handoff?'handoff-story':''}`} aria-label="Current replay event" aria-live="polite">
     <div className="story-top"><span className="section-label">{end?'RUN COMPLETE':handoff?'THE HANDOFF':'THE STORY SO FAR'}</span><span>{formatTime(stage.at-index.startAt)} <b>•</b> {String(stageNumber+1).padStart(2,'0')}</span></div>
     {handoff?<><h2>{end?'Every task accounted for.':handoffComplete?'A laptop leaves. Work continues.':handoffClaimed?'Another laptop picks it up.':'An unfinished task returns to the queue.'}</h2>
      <div className="handoff-path"><span>{handoff.fromName}</span><b>→</b><span>{handoffClaimed?handoff.toName:'Shared queue'}</span><i>{handoffComplete?'ACCEPTED':handoffClaimed?'IN FLIGHT':'RELEASED'}</i></div>
      <p>{handoffClaimed?<><strong>{handoff.claimDelayMs} ms</strong> to reassign{handoffComplete&&<> · <strong>{((handoff.completionDelayMs??0)/1000).toFixed(3)} s</strong> from release to acceptance</>}</>:'The coordinator recorded the release. The next claim has not happened yet.'}</p>
      <small>Handoff at {formatTime(handoff.releasedAt-index.startAt)} · {handoff.sampleId} / prompt {handoff.variantId}</small>
     </>:<><h2>{stage.title}</h2><p>{stage.detail}</p><div className="story-foot">{end?'All counts come from accepted results.':'Real inference. Independent tasks. Shared progress.'}</div></>}
    </section>
   </div>
   <nav className="chapter-nav" aria-label="Jump to recorded milestones">{chapters.map((m,i)=><button key={m.id} className={`${m.at<=state.at?'reached':''} ${stage.at>=m.at&&(chapters[i+1]?.at??Infinity)>state.at?'current':''}`} onClick={()=>seek(m.at-index.startAt)} title={m.title}>
    <span>{String(i+1).padStart(2,'0')}</span><strong>{m.kind==='start'?'Start':m.kind==='finish'?'Complete':m.kind==='leave'?'Device exits':m.kind==='handoff'?'Task handed off':`${trace.workers.find(w=>w.workerId===m.workerId)?.name??'Device'} joins`}</strong><small>{formatTime(m.at-index.startAt)}</small>
   </button>)}</nav>
  </main>
  <footer className="transport">
   <div className="transport-inner"><div className="transport-controls"><button className="play-button" onClick={toggle} aria-label={end?'Replay from start':playing?'Pause replay':'Play replay'}><span>{end?'↻':playing?'Ⅱ':'▶'}</span>{end?'Replay':playing?'Pause':'Play replay'}</button><button className="reset-button" onClick={()=>seek(0)} aria-label="Reset to beginning">↺</button></div>
    <div className="timeline-control"><div className="timeline-label"><span>{formatTime(elapsed)}<b> / {formatTime(index.durationMs)}</b></span><span>RECORDED TIME <i>·</i> {playing?'PLAYING':end?'FINISHED':'PAUSED'}</span></div><input aria-label="Replay timeline" type="range" min="0" max={index.durationMs} step="1" value={elapsed} onChange={e=>seek(Number(e.target.value))} style={{'--played':`${elapsed/(index.durationMs||1)*100}%`} as React.CSSProperties}/></div>
    <label className="speed-control"><span>REPLAY SPEED</span><select aria-label="Replay speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,3,6,12,24,48,96].map(s=><option key={s} value={s}>{s}×</option>)}</select></label>
    <div className="playback-note"><strong>~{Math.round(index.durationMs/speed/1000)} sec</strong><span>for the full replay</span></div>
   </div>
   <div className="source-footer"><span>Recorded Sep 12, 2026 · {trace.events.length.toLocaleString()} events · {trace.frames.length} snapshots · No simulated results</span><button onClick={download}>Download source recording ↗</button></div>
   {message&&<p className="fullscreen-message" role="status">{message}</p>}
  </footer>
 </div>;
}

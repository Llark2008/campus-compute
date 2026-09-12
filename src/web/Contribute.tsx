import React from "react";
import type {ControlCommand, Level, LocalStatus} from "../shared/contracts.ts";
import type {Api} from "./api.ts";
import {exitIsDisabled, formatTime} from "./view-model.ts";

export interface ContributeProps {api:Api}

const levels:{id:Level;name:string;description:string}[] = [
  {id:"low",name:"Low",description:"Rest twice as long as the last inference"},
  {id:"medium",name:"Medium",description:"Rest as long as the last inference"},
  {id:"high",name:"High",description:"Continue without an intentional break"},
];

function stateLabel(state:string):string {
  return state.charAt(0).toUpperCase()+state.slice(1);
}

export function Contribute({api}:ContributeProps) {
  const [status,setStatus] = React.useState<LocalStatus|null>(null);
  const [connectionError,setConnectionError] = React.useState<string|null>(null);
  const [updatedAt,setUpdatedAt] = React.useState<number|null>(null);
  const [pending,setPending] = React.useState<Set<string>>(()=>new Set());
  const [error,setError] = React.useState<string|null>(null);
  const [coordinatorUrl,setCoordinatorUrl] = React.useState("");
  const [joinCode,setJoinCode] = React.useState("");
  const [deviceName,setDeviceName] = React.useState("");
  const latestControl = React.useRef(0);
  const controlsInFlight = React.useRef(0);

  React.useEffect(()=>{
    const abort = new AbortController(); let busy = false;
    const refresh = async () => {
      if (busy || controlsInFlight.current > 0) return;
      busy = true;
      const controlVersion = latestControl.current;
      try {
        const next = await api.get<LocalStatus>("/api/local/status",abort.signal);
        if (!abort.signal.aborted && controlVersion === latestControl.current && controlsInFlight.current === 0) {
          setStatus(next); setConnectionError(null); setUpdatedAt(Date.now());
          setCoordinatorUrl(current=>current || next.coordinatorUrl);
          setDeviceName(current=>current || next.name);
        }
      } catch (cause) {
        if (!abort.signal.aborted) setConnectionError(cause instanceof Error ? cause.message : "Local control connection lost");
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(()=>void refresh(),2000);
    return ()=>{abort.abort();window.clearInterval(timer);};
  },[api]);

  async function control(command:ControlCommand) {
    const action = command.action;
    const sequence = ++latestControl.current;
    controlsInFlight.current += 1;
    setPending(current=>new Set(current).add(action)); setError(null);
    try {
      const next = await api.post<LocalStatus>("/api/local/control",command);
      if (sequence === latestControl.current) { setStatus(next); setUpdatedAt(Date.now()); setConnectionError(null); }
    } catch (cause) {
      if (sequence === latestControl.current) setError(cause instanceof Error ? cause.message : "Local control failed");
    } finally {
      controlsInFlight.current -= 1;
      setPending(current=>{const next = new Set(current);next.delete(action);return next;});
    }
  }
  function configure(event:React.FormEvent) {
    event.preventDefault();
    if (!coordinatorUrl.trim() || !joinCode || !deviceName.trim()) { setError("Coordinator address, join code, and device name are required."); return; }
    void control({action:"configure",coordinatorUrl:coordinatorUrl.trim(),joinCode,name:deviceName.trim()});
  }

  const state = status?.state ?? "connecting";
  const exited = state === "stopped";
  const startDisabled = pending.size > 0 || status === null || state === "initializing" || state === "stopping";
  const pauseDisabled = pending.size > 0 || exited;
  const exitDisabled = exitIsDisabled(status?.state ?? null,pending);

  return <div className="local-shell">
    <header className="local-topbar"><a className="brand brand-compact" href="#top" aria-label="Campus Compute local control"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span><strong>Campus</strong><small>Compute</small></span></a><span className="local-label"><i />Local device control</span></header>
    <main className="local-page" id="top">
      <header className="local-hero"><div><p className="eyebrow">Contribute from this device</p><h1>Share capacity on your terms.</h1><p>This private page controls the worker running on this computer. You decide when it starts, rests, pauses, and exits.</p></div><div className={`machine-state ${state}`}><span>Worker state</span><strong>{stateLabel(state)}</strong><small>{status?.workerId ? `Session ${status.workerId}` : "No active worker session"}</small></div></header>

      {connectionError && <div className="notice stale"><strong>Local connection interrupted</strong><span>Last confirmed {formatTime(updatedAt)}. Controls will report whether the local service can accept your request.</span></div>}
      {error && <div className="notice error" role="alert"><strong>Control request failed</strong><span>{error}</span></div>}

      <div className="local-grid">
        <section className="panel local-panel" aria-labelledby="connection-heading"><div className="section-heading"><div><p className="eyebrow">Step 1</p><h2 id="connection-heading">Connect to your group</h2></div>{status?.coordinatorUrl && <span className="saved-mark">Configured</span>}</div>
          <form onSubmit={configure} className="configuration-form">
            <label>Coordinator address<input type="url" value={coordinatorUrl} onChange={e=>setCoordinatorUrl(e.target.value)} placeholder="http://coordinator.local:3000" /></label>
            <div className="field-grid two"><label>Group join code<input type="password" value={joinCode} onChange={e=>setJoinCode(e.target.value)} autoComplete="off" /></label><label>Device name<input value={deviceName} onChange={e=>setDeviceName(e.target.value)} maxLength={100} placeholder="e.g. Freddy’s MacBook" /></label></div>
            <p className="field-note">Engine and model paths come from this worker’s local configuration file and are not shown here.</p>
            <button className="button secondary" disabled={pending.has("configure")}>{pending.has("configure") ? "Saving…" : "Save connection"}</button>
          </form>
        </section>

        <section className="panel local-panel" aria-labelledby="level-heading"><div className="section-heading"><div><p className="eyebrow">Step 2</p><h2 id="level-heading">Choose a contribution level</h2></div><span className="section-hint">Affects the next task</span></div>
          <div className="level-grid">{levels.map(level=><button type="button" key={level.id} className={`level-card ${status?.level === level.id ? "selected" : ""}`} aria-pressed={status?.level === level.id} onClick={()=>void control({action:"set-level",level:level.id})} disabled={pending.has("set-level")}><span><strong>{level.name}</strong>{status?.level === level.id && <i>Current</i>}</span><small>{level.description}</small></button>)}</div>
          <p className="field-note">Levels control the rest between tasks. They are not percentages of CPU or GPU use.</p>
        </section>

        <section className="panel local-panel control-panel" aria-labelledby="control-heading"><div className="section-heading"><div><p className="eyebrow">Step 3</p><h2 id="control-heading">Run the worker</h2></div><span className={`status-pill ${state}`}>{stateLabel(state)}</span></div>
          <div className="local-stats"><div><span>Backend</span><strong>{status?.backend?.toUpperCase() ?? "—"}</strong></div><div><span>Accepted tasks</span><strong>{status ? status.completed : "—"}</strong></div><div><span>Current task</span><strong>{status ? status.taskId ?? "None" : "—"}</strong></div></div>
          {status?.lastError && <div className="inline-error"><strong>Worker error</strong><span>{status.lastError}</span></div>}
          <div className="control-actions"><button className="button primary" disabled={startDisabled} onClick={()=>void control({action:"start"})}>{pending.has("start") ? "Starting…" : "Start / Resume"}</button><button className="button secondary" disabled={pauseDisabled} onClick={()=>void control({action:"pause"})}>{pending.has("pause") ? "Pausing…" : "Pause after this task"}</button><button className="button exit-button" disabled={exitDisabled} onClick={()=>void control({action:"exit"})}>{pending.has("exit") ? "Exiting…" : "Exit now"}</button></div>
          <div className="exit-note"><strong>Use Exit now to stop contributing.</strong><span>Closing this page does not stop the worker. Exit now remains available while the model is initializing or Start is pending.</span></div>
        </section>
      </div>
    </main>
    <footer className="local-footer"><span>Only this device can use these controls.</span><span>Local token held in memory</span></footer>
  </div>;
}

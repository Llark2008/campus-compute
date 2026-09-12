import React from "react";
import type {Created, DatasetMeta} from "../shared/contracts.ts";
import {createApi} from "./api.ts";
import {Publish} from "./Publish.tsx";
import {Experiment} from "./Experiment.tsx";
import {Contribute} from "./Contribute.tsx";

type Bootstrap = {surface:"coordinator"}|{surface:"worker";token:string};
const JOIN_KEY = "campus-compute:join-code";

function readSession(key:string):string {
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}
function writeSession(key:string,value:string):void {
  try { sessionStorage.setItem(key,value); } catch { /* Session storage can be unavailable. */ }
}
function removeSession(key:string):void {
  try { sessionStorage.removeItem(key); } catch { /* Session storage can be unavailable. */ }
}

function experimentFromHash():string|null {
  const match = /^#\/experiments\/([^/?#]+)$/.exec(location.hash);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function Brand({compact=false}:{compact?:boolean}) {
  return <a className={`brand ${compact ? "brand-compact" : ""}`} href="#/" aria-label="Campus Compute home">
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
    <span><strong>Campus</strong><small>Compute</small></span>
  </a>;
}

function JoinGate({onJoin}:{onJoin:(token:string)=>void}) {
  const [value,setValue] = React.useState("");
  const [busy,setBusy] = React.useState(false);
  const [error,setError] = React.useState<string|null>(null);
  async function join(event:React.FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token) { setError("Enter your group join code."); return; }
    setBusy(true); setError(null);
    try {
      await createApi(token).get<DatasetMeta[]>("/api/datasets");
      writeSession(JOIN_KEY,token);
      onJoin(token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to join this workspace.");
    } finally { setBusy(false); }
  }
  return <main className="gate-shell">
    <div className="gate-brand"><Brand /></div>
    <section className="gate-copy" aria-labelledby="gate-heading">
      <p className="eyebrow">Distributed evaluation, owned by your campus</p>
      <h1 id="gate-heading">Turn nearby laptops into a careful AI test bench.</h1>
      <p className="lede">Publish a real prompt evaluation, follow every answer, and let contributors stay in control of their own machines.</p>
      <div className="principles" aria-label="Platform principles">
        <span>Shared capacity</span><span>Traceable results</span><span>Owner controlled</span>
      </div>
    </section>
    <section className="gate-card" aria-labelledby="join-heading">
      <p className="step-label">Group access</p>
      <h2 id="join-heading">Enter the workspace</h2>
      <p>Your coordinator gave your team a private join code.</p>
      <form onSubmit={join}>
        <label htmlFor="join-code">Group join code</label>
        <input id="join-code" type="password" value={value} onChange={event=>setValue(event.target.value)} autoComplete="current-password" autoFocus />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary wide" disabled={busy}>{busy ? "Checking…" : "Enter workspace"}</button>
      </form>
      <p className="privacy-note">The code stays in this browser session and never appears in the URL.</p>
    </section>
  </main>;
}

function Coordinator({initialToken}:{initialToken:string}) {
  const [token,setToken] = React.useState(initialToken);
  const [experimentId,setExperimentId] = React.useState(experimentFromHash);
  const [openId,setOpenId] = React.useState("");
  const api = React.useMemo(()=>createApi(token),[token]);

  React.useEffect(()=>{
    const change = () => setExperimentId(experimentFromHash());
    window.addEventListener("hashchange",change);
    return () => window.removeEventListener("hashchange",change);
  },[]);

  if (!token) return <JoinGate onJoin={setToken} />;

  function onCreated(created:Created) {
    writeSession(`owner:${created.experimentId}`,created.ownerToken);
    location.hash = `#/experiments/${encodeURIComponent(created.experimentId)}`;
  }
  function signOut() {
    removeSession(JOIN_KEY);
    setToken("");
    location.hash = "#/";
  }
  function openExperiment(event:React.FormEvent) {
    event.preventDefault();
    if (openId.trim()) location.hash = `#/experiments/${encodeURIComponent(openId.trim())}`;
  }

  return <div className="app-shell">
    <header className="topbar">
      <Brand compact />
      <nav aria-label="Primary navigation">
        <a className={!experimentId ? "active" : ""} href="#/">New evaluation</a>
        <form className="open-run" onSubmit={openExperiment}>
          <label className="sr-only" htmlFor="open-experiment">Experiment ID</label>
          <input id="open-experiment" placeholder="Experiment ID" value={openId} onChange={event=>setOpenId(event.target.value)} />
          <button className="button ghost" type="submit">Open</button>
        </form>
      </nav>
      <button className="text-button" type="button" onClick={signOut}>Leave workspace</button>
    </header>
    {experimentId
      ? <Experiment key={experimentId} api={api} id={experimentId} ownerToken={readSession(`owner:${experimentId}`) || null} />
      : <Publish api={api} onCreated={onCreated} />}
    <footer className="site-footer"><span>Campus Compute</span><span>Real work. Shared carefully.</span></footer>
  </div>;
}

function WorkerSurface({token}:{token:string}) {
  const api = React.useMemo(()=>createApi(token),[token]);
  return <Contribute api={api} />;
}

export function App() {
  const [bootstrap,setBootstrap] = React.useState<Bootstrap|null>(null);
  const [error,setError] = React.useState<string|null>(null);
  const [retry,setRetry] = React.useState(0);
  React.useEffect(()=>{
    const abort = new AbortController();
    setError(null);
    fetch("/api/bootstrap",{signal:abort.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Bootstrap request failed");
        return response.json() as Promise<Bootstrap>;
      })
      .then(value => { if (!abort.signal.aborted) setBootstrap(value); })
      .catch(cause => {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to open Campus Compute.");
      });
    return ()=>abort.abort();
  },[retry]);

  if (error) return <main className="center-state"><Brand /><h1>We couldn’t reach this Campus Compute service.</h1><p>{error}</p><button className="button primary" onClick={()=>setRetry(value=>value+1)}>Try again</button></main>;
  if (!bootstrap) return <main className="center-state" aria-live="polite"><div className="loader" /><p>Opening Campus Compute…</p></main>;
  if (bootstrap.surface === "worker") return <WorkerSurface token={bootstrap.token} />;
  return <Coordinator initialToken={readSession(JOIN_KEY)} />;
}

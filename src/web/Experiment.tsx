import React from "react";
import type {EventRow, Report, ReportRow, Sample, Snapshot, Variant, WorkerView} from "../shared/contracts.ts";
import type {Api} from "./api.ts";
import {createApi} from "./api.ts";
import {LatestRequest, formatDuration, formatTime, isReport, percentage, rowsForSample} from "./view-model.ts";

import {RecordingPanel} from "./RecordingPanel.tsx";
import {comparisonCsv, formatElapsed} from "./report-export.ts";

export interface ExperimentProps {api:Api;id:string;ownerToken:string|null}

const terminalStates = new Set(["completed","completed-with-errors","canceled"]);

function statusLabel(state:string):string {
  return state.split("-").map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ");
}

function workerDetail(worker:WorkerView):string {
  return [worker.platform,worker.arch,worker.backend.toUpperCase()].filter(Boolean).join(" · ");
}

function eventLabel(event:EventRow):string {
  return event.kind.split(/[-_]/).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ");
}

function AnswerCard({row,variant,sample}:{row:ReportRow|undefined;variant:Variant;sample:Sample}) {
  return <article className="answer-card">
    <header><span className="variant-badge">{variant.id}</span><div><h4>{variant.name}</h4><p>{variant.responseMode === "answer-only" ? "Exact answer line" : "Explanation + answer line"}</p></div>{row?.source && <span className={`source-badge ${row.source}`}>{row.source === "cache" ? "Reused cache" : "New compute"}</span>}</header>
    <details className="input-detail"><summary>Prompt input</summary><div className="input-copy"><strong>Instruction</strong><p>{variant.instruction}</p>{variant.examples.length > 0 && <p>{variant.examples.length} fixed examples precede this question.</p>}<strong>Question</strong><p>{sample.question}</p><ul>{sample.choices.map(choice=><li key={choice.label}><b>{choice.label}.</b> {choice.text}</li>)}</ul></div></details>
    {!row ? <p className="answer-empty">No task record for this prompt.</p> : row.output ? <>
      <div className="raw-output"><span>Raw model answer</span><pre>{row.output.text || "(empty output)"}</pre></div>
      <dl className="answer-facts">
        <div><dt>Parsed</dt><dd>{row.score?.answer ?? "No valid answer"}</dd></div>
        <div><dt>Expected</dt><dd>{sample.answerKey}</dd></div>
        <div><dt>Correct</dt><dd className={row.score?.correct ? "good" : "bad"}>{row.score?.correct ? "Yes" : "No"}</dd></div>
        <div><dt>Format</dt><dd className={row.score?.formatOk ? "good" : "bad"}>{row.score?.formatOk ? "Valid" : "Invalid"}</dd></div>
        <div><dt>Backend</dt><dd>{row.backend?.toUpperCase() ?? "—"}</dd></div>
        <div><dt>Finish</dt><dd>{row.output.finishReason}</dd></div>
      </dl>
    </> : <div className="answer-empty"><strong>{statusLabel(row.state)}</strong><span>{row.error ?? "No model output was accepted."}</span></div>}
  </article>;
}

function downloadReport(report:Report,csv=false) {
  const blob = new Blob([csv ? comparisonCsv(report) : JSON.stringify(report,null,2)],{type:csv ? "text/csv;charset=utf-8" : "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `campus-compute-${report.snapshot.experimentId}.${csv ? "csv" : "json"}`;
  document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

function ReportExplorer({report,prior=false}:{report:Report;prior?:boolean}) {
  const [selectedId,setSelectedId] = React.useState(report.samples[0]?.id ?? "");
  React.useEffect(()=>setSelectedId(report.samples[0]?.id ?? ""),[report]);
  const sample = report.samples.find(item=>item.id === selectedId) ?? report.samples[0];
  const rows = sample ? rowsForSample(report,sample.id) : [];
  const byVariant = new Map(rows.map(row=>[row.variantId,row]));
  return <section className={`report-panel ${prior ? "prior-report" : ""}`} aria-labelledby={prior ? "prior-report-heading" : "answers-heading"}>
    <header className="report-heading">
      <div><p className="eyebrow">{prior ? "Imported archive" : "Detailed report"}</p><h2 id={prior ? "prior-report-heading" : "answers-heading"}>{prior ? "Previously completed run" : "Raw answers by question"}</h2><p>{report.snapshot.name} · {report.snapshot.experimentId}</p></div>
      <div className="header-actions"><button className="button secondary" type="button" onClick={()=>downloadReport(report,true)}>Export comparison CSV</button><button className="button secondary" type="button" onClick={()=>downloadReport(report)}>Export JSON</button></div>
    </header>
    {prior && <div className="archive-banner"><strong>Previously completed run</strong><span>This report is shown separately from the live experiment and does not change its metrics.</span></div>}
    <RunTiming snapshot={report.snapshot} archive />
    {!sample ? <p className="empty-state">This report contains no questions.</p> : <>
      <label className="sample-picker">Question<select value={sample.id} onChange={event=>setSelectedId(event.target.value)}>{report.samples.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.id} — {item.question}</option>)}</select></label>
      <div className="question-card"><span className="question-id">{sample.id}</span><h3>{sample.question}</h3><ul>{sample.choices.map(choice=><li key={choice.label}><b>{choice.label}</b><span>{choice.text}</span></li>)}</ul></div>
      <div className="answer-grid">{report.variants.map(variant=><AnswerCard key={variant.id} variant={variant} sample={sample} row={byVariant.get(variant.id)} />)}</div>
    </>}
  </section>;
}

function RunTiming({snapshot,archive=false}:{snapshot:Snapshot;archive?:boolean}) {
  return <section className={`timing-grid ${archive ? "archive-timing" : ""}`} aria-label="Evaluation elapsed time">
    <div><span>Total elapsed time</span><strong>{formatElapsed(snapshot.elapsedMs)}</strong><small>Since publication · includes queue and pauses</small></div>
    <div><span>Execution elapsed time</span><strong>{formatElapsed(snapshot.executionElapsedMs)}</strong><small>Since first task dispatch · includes pauses and retries</small></div>
  </section>;
}

function WorkerTable({workers}:{workers:WorkerView[]}) {
  if (!workers.length) return <div className="empty-state compact"><strong>No accepted contributions yet</strong><span>A device appears after its first fresh result is accepted for this experiment.</span></div>;
  return <div className="table-wrap"><table><thead><tr><th>Device</th><th>Status</th><th>Level</th><th>Accepted work</th><th>Credits</th><th>Last seen</th></tr></thead><tbody>{workers.map(worker=><tr key={worker.id}><td><strong>{worker.name}</strong><small>{workerDetail(worker)}</small></td><td><span className={`state-dot ${worker.state}`} />{statusLabel(worker.state)}</td><td>{statusLabel(worker.level)}</td><td>{worker.completed}</td><td>{worker.credits}</td><td>{formatTime(worker.lastSeenAt)}</td></tr>)}</tbody></table></div>;
}

export function Experiment({api,id,ownerToken}:ExperimentProps) {
  const [snapshot,setSnapshot] = React.useState<Snapshot|null>(null);
  const [connectionError,setConnectionError] = React.useState<string|null>(null);
  const [updatedAt,setUpdatedAt] = React.useState<number|null>(null);
  const [report,setReport] = React.useState<Report|null>(null);
  const [reportBusy,setReportBusy] = React.useState(false);
  const [actionError,setActionError] = React.useState<string|null>(null);
  const [canceling,setCanceling] = React.useState(false);
  const [priorReport,setPriorReport] = React.useState<Report|null>(null);
  const [importError,setImportError] = React.useState<string|null>(null);
  const ownerApi = React.useMemo(()=>ownerToken ? createApi(ownerToken) : null,[ownerToken]);
  const reportRequests = React.useRef(new LatestRequest()).current;
  const cancelRequests = React.useRef(new LatestRequest()).current;
  const importRequests = React.useRef(new LatestRequest()).current;
  const reportAbort = React.useRef<AbortController|null>(null);
  const cancelAbort = React.useRef<AbortController|null>(null);
  const answersRef = React.useRef<HTMLDivElement|null>(null);
  React.useEffect(()=>{ if (report) answersRef.current?.scrollIntoView({behavior:"smooth",block:"start"}); },[report]);

  React.useEffect(()=>{
    reportRequests.invalidate(); cancelRequests.invalidate(); importRequests.invalidate();
    reportAbort.current?.abort(); cancelAbort.current?.abort();
    setSnapshot(null); setReport(null); setPriorReport(null); setConnectionError(null); setUpdatedAt(null);
    setReportBusy(false); setCanceling(false); setActionError(null); setImportError(null);
    const abort = new AbortController(); let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await api.get<Snapshot>(`/api/experiments/${encodeURIComponent(id)}`,abort.signal);
        if (!abort.signal.aborted) { setSnapshot(next); setConnectionError(null); setUpdatedAt(Date.now()); }
      } catch (cause) {
        if (!abort.signal.aborted) setConnectionError(cause instanceof Error ? cause.message : "Connection lost");
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(()=>void refresh(),2000);
    return ()=>{
      abort.abort(); window.clearInterval(timer);
      reportRequests.invalidate(); cancelRequests.invalidate(); importRequests.invalidate();
      reportAbort.current?.abort(); cancelAbort.current?.abort();
    };
  },[api,id,reportRequests,cancelRequests,importRequests]);

  async function loadReport() {
    reportAbort.current?.abort();
    const abort = new AbortController();
    const request = reportRequests.begin();
    reportAbort.current = abort;
    setReportBusy(true); setActionError(null);
    try {
      const next = await api.get<Report>(`/api/experiments/${encodeURIComponent(id)}/report`,abort.signal);
      if (request.isCurrent() && !abort.signal.aborted) setReport(next);
    } catch (cause) {
      if (request.isCurrent() && !abort.signal.aborted) setActionError(cause instanceof Error ? cause.message : "Unable to load answers.");
    } finally {
      if (request.isCurrent()) {
        if (reportAbort.current === abort) reportAbort.current = null;
        setReportBusy(false);
      }
    }
  }
  async function cancel() {
    if (!ownerApi) return;
    cancelAbort.current?.abort();
    const abort = new AbortController();
    const request = cancelRequests.begin();
    cancelAbort.current = abort;
    setCanceling(true); setActionError(null);
    try { await ownerApi.post<{ok:true}>(`/api/experiments/${encodeURIComponent(id)}/cancel`,{},abort.signal); }
    catch (cause) {
      if (request.isCurrent() && !abort.signal.aborted) setActionError(cause instanceof Error ? cause.message : "Unable to cancel this evaluation.");
    } finally {
      if (request.isCurrent()) {
        if (cancelAbort.current === abort) cancelAbort.current = null;
        setCanceling(false);
      }
    }
  }
  async function importReport(event:React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = importRequests.begin();
    setImportError(null);
    try {
      const value:unknown = JSON.parse(await file.text());
      if (!isReport(value)) throw new Error("This JSON file is not a Campus Compute report.");
      if (request.isCurrent()) setPriorReport(value);
    } catch (cause) {
      if (request.isCurrent()) setImportError(cause instanceof Error ? cause.message : "Unable to read this report.");
    }
    finally { event.target.value = ""; }
  }

  const terminal = snapshot ? terminalStates.has(snapshot.state) : false;
  const resolved = snapshot ? snapshot.fresh + snapshot.cached + snapshot.failed + snapshot.canceled : 0;
  const progress = snapshot?.planned ? Math.min(100,100 * resolved / snapshot.planned) : 0;

  return <main className="page experiment-page">
    <a className="back-link" href="#/">← New evaluation</a>
    {!snapshot ? <section className="hero-panel loading-panel"><div className="loader" /><div><p className="eyebrow">Experiment {id}</p><h1>Connecting to the live run…</h1><p>{connectionError ?? "Requesting the first coordinator snapshot."}</p></div></section> : <>
      <header className="experiment-header">
        <div><div className="run-kicker"><span className={`status-pill ${snapshot.state}`}>{statusLabel(snapshot.state)}</span><span>{snapshot.mode} mode</span><span>#{snapshot.experimentId}</span></div><h1>{snapshot.name}</h1><p>{terminal ? "This evaluation has ended. All accepted results are saved." : snapshot.workers.length ? "Live work from the campus pool, refreshed every two seconds." : "Waiting for the first accepted contribution to this evaluation."}</p></div>
        <div className="header-actions">{ownerApi && !terminal && <button className="button danger-button" type="button" disabled={canceling} onClick={()=>void cancel()}>{canceling ? "Canceling…" : "Cancel evaluation"}</button>}<button className="button secondary" type="button" disabled={reportBusy} onClick={()=>void loadReport()}>{reportBusy ? "Loading…" : report ? "Refresh answers" : "View answers"}</button></div>
      </header>

      {connectionError && <div className="notice stale" role="status"><strong>Live connection interrupted</strong><span>Showing the last confirmed snapshot from {formatTime(updatedAt)}. ETA is hidden until the connection returns. {connectionError}</span></div>}
      {actionError && <div className="notice error" role="alert"><strong>Action failed</strong><span>{actionError}</span></div>}

      <section className="progress-panel" aria-labelledby="progress-heading">
        <div className="progress-copy"><p className="eyebrow">Evaluation progress</p><h2 id="progress-heading"><strong>{resolved.toLocaleString()}</strong><span> / {snapshot.planned.toLocaleString()} terminal tasks</span></h2><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={snapshot.planned} aria-valuenow={resolved}><i style={{width:`${progress}%`}} /></div></div>
        <div className="eta-block"><span>{snapshot.finishedAt !== null ? "Evaluation status" : connectionError ? "Estimate stale" : "Estimated time left"}</span><strong>{snapshot.finishedAt !== null ? snapshot.state === "canceled" ? "Canceled" : snapshot.failed ? "Finished with errors" : "Complete" : connectionError ? "—" : formatDuration(snapshot.etaSeconds)}</strong></div>
      </section>

      <RunTiming snapshot={snapshot} />
      <RecordingPanel api={api} id={id} status={snapshot.recording} />

      <section className="metric-grid" aria-label="Experiment metrics">
        <div className="metric-card accent"><span>Fresh results accepted</span><strong>{snapshot.fresh}</strong><small>Real new inference</small></div>
        <div className="metric-card"><span>Reused cache</span><strong>{snapshot.cached}</strong><small>Shown separately</small></div>
        <div className="metric-card"><span>In flight</span><strong>{snapshot.leased}</strong><small>{snapshot.queued} still queued</small></div>
        <div className="metric-card"><span>Execution failures</span><strong>{snapshot.failed}</strong><small>{snapshot.retries} retries recorded</small></div>
        <div className="metric-card"><span>Effective throughput</span><strong>{snapshot.throughput.toFixed(2)}</strong><small>new tasks/sec · {(snapshot.windowMs/1000).toFixed(0)}s window</small></div>
      </section>

      <section className="panel dashboard-panel" aria-labelledby="devices-heading"><div className="section-heading"><div><p className="eyebrow">Campus pool</p><h2 id="devices-heading">Contributing devices</h2></div><span className="section-hint">{snapshot.workers.length} contributors to this run · includes devices that later left</span></div><WorkerTable workers={snapshot.workers} /></section>

      <section className="panel dashboard-panel" aria-labelledby="quality-heading">
        <div className="section-heading"><div><p className="eyebrow">Fair prompt comparison</p><h2 id="quality-heading">Quality on a common sample</h2></div><div className="common-count"><strong>{snapshot.commonCount}</strong><span>questions completed by every prompt</span></div></div>
        {snapshot.commonCount === 0 && <p className="zero-note">Percentages appear after at least one question has an accepted answer for every prompt.</p>}
        <div className="table-wrap"><table><thead><tr><th>Prompt</th><th>Accuracy</th><th>Format compliance</th><th>Received</th><th>Truncated</th><th>Execution failures</th></tr></thead><tbody>{snapshot.variants.map(variant=><tr key={variant.id}><td><span className="variant-badge small">{variant.id}</span></td><td className="big-cell">{percentage(variant.commonCorrect,snapshot.commonCount)}</td><td className="big-cell">{percentage(variant.commonFormatOk,snapshot.commonCount)}</td><td>{variant.received}/{variant.planned}</td><td>{variant.truncated}</td><td>{variant.failed}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel dashboard-panel" aria-labelledby="events-heading"><div className="section-heading"><div><p className="eyebrow">Audit trail</p><h2 id="events-heading">Recent task events</h2></div><span className="section-hint">Coordinator timestamps</span></div>{snapshot.events.length ? <ol className="event-list">{snapshot.events.map(event=><li key={event.id}><time>{formatTime(event.at)}</time><span className="event-mark" /><div><strong>{eventLabel(event)}</strong><p>{event.detail}</p><small>{[event.workerId && `Device ${event.workerId}`,event.taskId && `Task ${event.taskId}`].filter(Boolean).join(" · ")}</small></div></li>)}</ol> : <p className="empty-state">No events have been recorded yet.</p>}</section>
    </>}

    {report && <div className="answers-anchor" ref={answersRef}><ReportExplorer report={report} /></div>}
    <section className="import-panel"><div><p className="eyebrow">Compare with an archive</p><h2>Open a prior JSON report</h2><p>Imported results stay visibly separate from this live experiment.</p></div><label className="button secondary file-button">Import prior report<input type="file" accept="application/json,.json" onChange={event=>void importReport(event)} /></label>{importError && <p className="form-error" role="alert">{importError}</p>}</section>
    {priorReport && <ReportExplorer report={priorReport} prior />}
  </main>;
}

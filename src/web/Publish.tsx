import React from "react";
import type {CreateInput, Created, DatasetMeta, ImportInput, Preview, RuntimeLock, Variant} from "../shared/contracts.ts";
import type {Api} from "./api.ts";
import {ApiError} from "./api.ts";
import {LatestRequest, sampleIdsForRun} from "./view-model.ts";

export interface PublishProps {api:Api;onCreated:(created:Created)=>void}
type Defaults = {variants:Variant[];runtime:RuntimeLock};

function errorText(error:unknown,fallback:string):string {
  return error instanceof Error ? error.message : fallback;
}

export function Publish({api,onCreated}:PublishProps) {
  const [datasets,setDatasets] = React.useState<DatasetMeta[]>([]);
  const [defaults,setDefaults] = React.useState<Defaults|null>(null);
  const [datasetId,setDatasetId] = React.useState("");
  const [name,setName] = React.useState("");
  const [questionCount,setQuestionCount] = React.useState("200");
  const [variants,setVariants] = React.useState<Variant[]>([]);
  const [preview,setPreview] = React.useState<Preview|null>(null);
  const [loading,setLoading] = React.useState(true);
  const [busy,setBusy] = React.useState<"preview"|"publish"|"upload"|null>(null);
  const [error,setError] = React.useState<string|null>(null);
  const [file,setFile] = React.useState<File|null>(null);
  const [uploadName,setUploadName] = React.useState("");
  const [uploadSource,setUploadSource] = React.useState("");
  const [uploadRevision,setUploadRevision] = React.useState("");
  const [uploadLicense,setUploadLicense] = React.useState("");
  const [uploadError,setUploadError] = React.useState<string|null>(null);
  const inputRevision = React.useRef(0);
  const previewRequests = React.useRef(new LatestRequest()).current;
  const previewAbort = React.useRef<AbortController|null>(null);

  React.useEffect(()=>{
    const abort = new AbortController();
    setLoading(true); setError(null);
    Promise.all([
      api.get<DatasetMeta[]>("/api/datasets",abort.signal),
      api.get<Defaults>("/api/defaults",abort.signal),
    ]).then(([nextDatasets,nextDefaults])=>{
      if (abort.signal.aborted) return;
      setDatasets(nextDatasets);
      setDefaults(nextDefaults);
      setDatasetId(nextDatasets[0]?.id ?? "");
      setQuestionCount(String(Math.min(200,nextDatasets[0]?.sampleIds.length ?? 200)));
      setVariants(nextDefaults.variants.slice(0,3));
    }).catch(cause=>{
      if (!abort.signal.aborted) setError(errorText(cause,"Unable to load evaluation defaults."));
    }).finally(()=>{ if (!abort.signal.aborted) setLoading(false); });
    return ()=>abort.abort();
  },[api]);

  React.useEffect(()=>()=>{
    previewRequests.invalidate();
    previewAbort.current?.abort();
  },[previewRequests]);

  const dataset = datasets.find(item=>item.id === datasetId) ?? null;
  const sampleIds = dataset ? sampleIdsForRun(dataset,Number(questionCount)) : [];
  const input:CreateInput = React.useMemo(()=>({
    name:name.trim(),datasetId,sampleIds,variants,mode:"normal",
  }),[name,datasetId,sampleIds.join("\u0000"),variants]);

  function invalidate() {
    inputRevision.current += 1;
    previewRequests.invalidate();
    previewAbort.current?.abort();
    previewAbort.current = null;
    setBusy(current=>current === "preview" || current === "publish" ? null : current);
    setPreview(null); setError(null);
  }
  function updateVariant(index:number,patch:Partial<Variant>) {
    setVariants(current=>current.map((variant,i)=>i === index ? {...variant,...patch} : variant));
    invalidate();
  }
  function removeVariant(index:number) {
    setVariants(current=>current.filter((_,i)=>i !== index));
    invalidate();
  }
  function addVariant() {
    const available = defaults?.variants.find(candidate=>!variants.some(current=>current.id === candidate.id));
    if (available) setVariants(current=>[...current,available]);
    invalidate();
  }
  function validate():string|null {
    if (!name.trim()) return "Name this evaluation before continuing.";
    if (!dataset || !sampleIds.length) return `Enter a whole number of questions between 1 and ${dataset?.sampleIds.length ?? 1}.`;
    if (!variants.length || variants.length > 3) return "Choose between one and three prompts.";
    if (variants.some(variant=>!variant.instruction.trim())) return "Every prompt needs an instruction.";
    return null;
  }
  async function requestPreview() {
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    previewAbort.current?.abort();
    const abort = new AbortController();
    const request = previewRequests.begin();
    const revision = inputRevision.current;
    previewAbort.current = abort;
    setBusy("preview"); setError(null);
    try {
      const next = await api.post<Preview>("/api/experiments/preview",input,abort.signal);
      if (request.isCurrent() && revision === inputRevision.current && !abort.signal.aborted) setPreview(next);
    } catch (cause) {
      if (request.isCurrent() && revision === inputRevision.current && !abort.signal.aborted) setError(errorText(cause,"Unable to preview this evaluation."));
    } finally {
      if (request.isCurrent() && revision === inputRevision.current) {
        if (previewAbort.current === abort) previewAbort.current = null;
        setBusy(current=>current === "preview" ? null : current);
      }
    }
  }
  async function publish() {
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    previewAbort.current?.abort();
    const request = previewRequests.begin();
    const revision = inputRevision.current;
    setBusy("publish"); setError(null);
    try {
      const latest = await api.post<Preview>("/api/experiments/preview",input);
      if (!request.isCurrent() || revision !== inputRevision.current) return;
      setPreview(latest);
      const created = await api.post<Created>("/api/experiments",input);
      if (!request.isCurrent() || revision !== inputRevision.current) return;
      try { sessionStorage.setItem(`owner:${created.experimentId}`,created.ownerToken); } catch { /* Optional session convenience. */ }
      onCreated(created);
    } catch (cause) {
      if (request.isCurrent() && revision === inputRevision.current) setError(errorText(cause,"Unable to publish this evaluation."));
    } finally {
      if (request.isCurrent() && revision === inputRevision.current) setBusy(null);
    }
  }
  async function uploadDataset(event:React.FormEvent) {
    event.preventDefault();
    if (!file) { setUploadError("Choose a UTF-8 JSONL file."); return; }
    if (file.size > 2_000_000) { setUploadError("This file is larger than the 2 MB limit."); return; }
    if (!uploadName.trim()) { setUploadError("Give this dataset a name."); return; }
    setBusy("upload"); setUploadError(null);
    try {
      const body:ImportInput = {
        name:uploadName.trim(),jsonl:await file.text(),
        source:uploadSource.trim() || `user-upload:${file.name}`,
        revision:uploadRevision.trim() || "not-specified",
        license:uploadLicense.trim() || "not-specified",
      };
      const imported = await api.post<DatasetMeta>("/api/datasets",body);
      setDatasets(current=>[...current.filter(item=>item.id !== imported.id),imported]);
      setDatasetId(imported.id); setQuestionCount(String(Math.min(200,imported.sampleIds.length))); setFile(null); setUploadName("");
      setUploadSource(""); setUploadRevision(""); setUploadLicense(""); invalidate();
    } catch (cause) {
      const line = cause instanceof ApiError && cause.line ? `Line ${cause.line}: ` : "";
      setUploadError(`${line}${errorText(cause,"Unable to import this dataset.")}`);
    } finally { setBusy(null); }
  }

  if (loading) return <main className="page"><div className="loader" /><p className="muted">Loading datasets and prompts…</p></main>;
  if (!defaults || !datasets.length) return <main className="page"><div className="notice error" role="alert"><strong>Evaluation setup is unavailable.</strong><span>{error ?? "The coordinator did not provide any datasets or prompt defaults."}</span></div></main>;

  return <main className="page publish-page">
    <header className="page-intro split-intro">
      <div><p className="eyebrow">New evaluation</p><h1>Compare prompts on real local inference.</h1></div>
      <p>Pick the questions, refine up to three prompts, and inspect the workload before the campus pool begins.</p>
    </header>

    {error && <div className="notice error" role="alert"><strong>Couldn’t continue</strong><span>{error}</span></div>}

    <div className="publish-grid">
      <div className="publish-main">
        <section className="panel numbered" aria-labelledby="basics-heading">
          <div className="section-number">01</div><div className="section-body">
            <div className="section-heading"><div><p className="eyebrow">Evaluation brief</p><h2 id="basics-heading">Name the run</h2></div><span className="section-hint">Visible in reports</span></div>
            <label htmlFor="experiment-name">Evaluation name</label>
            <input id="experiment-name" disabled={busy === "publish"} value={name} onChange={event=>{setName(event.target.value);invalidate();}} maxLength={100} placeholder="e.g. Science assistant prompt review" />
          </div>
        </section>

        <section className="panel numbered" aria-labelledby="dataset-heading">
          <div className="section-number">02</div><div className="section-body">
            <div className="section-heading"><div><p className="eyebrow">Question set</p><h2 id="dataset-heading">Choose the evidence</h2></div><span className="section-hint">Pinned server order</span></div>
            <div className="dataset-options">
              {datasets.map(item=><label className={`choice-card ${datasetId === item.id ? "selected" : ""}`} key={item.id}>
                <input type="radio" name="dataset" value={item.id} disabled={busy === "publish"} checked={datasetId === item.id} onChange={()=>{setDatasetId(item.id);setQuestionCount(String(Math.min(Number(questionCount)||200,item.sampleIds.length)));invalidate();}} />
                <span><strong>{item.name}</strong><small>{item.sampleIds.length} questions · {item.license || "License not specified"}</small></span>
                <i aria-hidden="true" />
              </label>)}
            </div>
            {dataset && <div className="dataset-meta"><span>Revision {dataset.revision || "not specified"}</span><span>Source {dataset.source || "not specified"}</span></div>}
            {dataset && <div className="question-count-control">
              <label htmlFor="question-count">Questions in this run</label>
              <input id="question-count" type="number" min={1} max={dataset.sampleIds.length} step={1} disabled={busy === "publish"} value={questionCount} onChange={event=>{setQuestionCount(event.target.value);invalidate();}} />
              <div className="count-presets">{[20,200,500,1000].filter(n=>n<dataset.sampleIds.length).map(n=><button key={n} className={`button ghost ${Number(questionCount)===n ? "selected" : ""}`} type="button" disabled={busy === "publish"} onClick={()=>{setQuestionCount(String(n));invalidate();}}>{n}</button>)}<button className={`button ghost ${Number(questionCount)===dataset.sampleIds.length ? "selected" : ""}`} type="button" disabled={busy === "publish"} onClick={()=>{setQuestionCount(String(dataset.sampleIds.length));invalidate();}}>All {dataset.sampleIds.length.toLocaleString()}</button></div>
              <p className="field-note">Uses the first N questions in this dataset’s fixed order. Keep the same count and prompts when comparing devices.</p>
            </div>}


            <details className="upload-disclosure">
              <summary>Import custom JSONL</summary>
              <form className="upload-form" onSubmit={uploadDataset}>
                <p className="privacy-banner">Up to 2,000 questions / 2 MB. Questions and prompt text are sent to participating devices. Standard answers stay with the coordinator for scoring.</p>
                <div className="field-grid two">
                  <label>Dataset name<input value={uploadName} onChange={e=>setUploadName(e.target.value)} maxLength={100} /></label>
                  <label>UTF-8 JSONL file<input type="file" accept=".jsonl,application/x-ndjson,application/json" onChange={e=>{setFile(e.target.files?.[0] ?? null);setUploadError(null);}} /></label>
                  <label>Source <span className="optional">optional</span><input value={uploadSource} onChange={e=>setUploadSource(e.target.value)} placeholder={file ? `user-upload:${file.name}` : "Dataset URL or citation"} /></label>
                  <label>Revision <span className="optional">optional</span><input value={uploadRevision} onChange={e=>setUploadRevision(e.target.value)} placeholder="not-specified" /></label>
                  <label>License <span className="optional">optional</span><input value={uploadLicense} onChange={e=>setUploadLicense(e.target.value)} placeholder="not-specified" /></label>
                </div>
                {uploadError && <p className="form-error" role="alert">{file ? `${file.name} · ` : ""}{uploadError}</p>}
                <button className="button secondary" disabled={busy !== null}>{busy === "upload" ? "Importing…" : "Import dataset"}</button>
              </form>
            </details>
          </div>
        </section>

        <section className="panel numbered" aria-labelledby="prompts-heading">
          <div className="section-number">03</div><div className="section-body">
            <div className="section-heading"><div><p className="eyebrow">Prompt variants</p><h2 id="prompts-heading">Shape the comparison</h2></div><span className="section-hint">1–3 prompts</span></div>
            <div className="prompt-stack">
              {variants.map((variant,index)=><article className="prompt-card" key={variant.id}>
                <div className="prompt-card-head"><span className="variant-badge">{variant.id}</span><label>Display name<input disabled={busy === "publish"} value={variant.name} onChange={e=>updateVariant(index,{name:e.target.value})} maxLength={100} /></label>{variants.length > 1 && <button className="text-button danger" disabled={busy === "publish"} type="button" onClick={()=>removeVariant(index)}>Remove</button>}</div>
                <label>Instruction<textarea rows={5} disabled={busy === "publish"} value={variant.instruction} onChange={e=>updateVariant(index,{instruction:e.target.value})} maxLength={6000} /></label>
                <div className="prompt-meta"><span>{variant.examples.length ? `${variant.examples.length} fixed examples included` : "No examples"}</span><span>{variant.responseMode === "answer-only" ? "Exact answer line" : "Brief explanation + answer line"}</span></div>
              </article>)}
            </div>
            {variants.length < Math.min(3,defaults.variants.length) && <button className="button ghost add-button" disabled={busy === "publish"} type="button" onClick={addVariant}>+ Add another default prompt</button>}
          </div>
        </section>
      </div>

      <aside className="run-summary" aria-labelledby="summary-heading">
        <div className="summary-top"><p className="eyebrow">Workload</p><h2 id="summary-heading">Ready to inspect</h2></div>
        <div className="equation"><strong>{sampleIds.length || "—"}</strong><span>questions</span><b>×</b><strong>{variants.length || "—"}</strong><span>prompts</span></div>
        <div className="task-total"><span>Inference tasks</span><strong>{sampleIds.length * variants.length}</strong></div>
        {preview ? <div className="preview-result" aria-live="polite">
          <div><span>Total</span><strong>{preview.total}</strong></div><div><span>Fresh to run</span><strong>{preview.fresh}</strong></div><div><span>Reusable cache</span><strong>{preview.cached}</strong></div>
        </div> : <p className="summary-placeholder">Preview asks the coordinator what can be reused. Elapsed time is shown once you publish.</p>}
        <dl className="runtime-summary">
          <div><dt>Model</dt><dd>{defaults.runtime.modelRepo}</dd></div>
          <div><dt>Context</dt><dd>{defaults.runtime.generation.contextSize.toLocaleString()} tokens</dd></div>
          <div><dt>Output cap</dt><dd>{defaults.runtime.generation.maxTokens} tokens</dd></div>
          <div><dt>Temperature</dt><dd>{defaults.runtime.generation.temperature}</dd></div>
        </dl>
        <div className="summary-actions"><button className="button secondary wide" type="button" disabled={busy !== null} onClick={()=>void requestPreview()}>{busy === "preview" ? "Checking…" : "Preview workload"}</button><button className="button primary wide" type="button" disabled={busy !== null} onClick={()=>void publish()}>{busy === "publish" ? "Publishing…" : "Publish evaluation"}</button></div>
      </aside>
    </div>
  </main>;
}

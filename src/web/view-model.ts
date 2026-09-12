import type {DatasetMeta, Report, ReportRow, WorkerState} from "../shared/contracts.ts";

export class LatestRequest {
  private generation = 0;

  begin():{isCurrent:()=>boolean} {
    const captured = ++this.generation;
    return {isCurrent:()=>this.generation === captured};
  }

  invalidate():void {
    this.generation += 1;
  }
}

export function exitIsDisabled(state:WorkerState|null,pending:ReadonlySet<string>):boolean {
  return pending.has("exit") || (state === "stopped" && !pending.has("start"));
}

export function sampleIdsForRun(dataset:DatasetMeta,count:number):string[] {
  return Number.isInteger(count) && count > 0 && count <= dataset.sampleIds.length ? dataset.sampleIds.slice(0,count) : [];
}

export function percentage(numerator:number,denominator:number):string {
  return denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : "—";
}

export function rowsForSample(report:Report,sampleId:string):ReportRow[] {
  const rank = new Map(report.variants.map((variant,index) => [variant.id,index]));
  return report.rows
    .filter(row => row.sampleId === sampleId)
    .sort((a,b) => (rank.get(a.variantId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.variantId) ?? Number.MAX_SAFE_INTEGER));
}

export function isReport(value:unknown):value is Report {
  const object = (candidate:unknown):candidate is Record<string,unknown> => typeof candidate === "object" && candidate !== null;
  const choice = (candidate:unknown) => object(candidate) && typeof candidate.label === "string" && typeof candidate.text === "string";
  const sample = (candidate:unknown) => object(candidate) && typeof candidate.id === "string" &&
    typeof candidate.question === "string" && typeof candidate.answerKey === "string" &&
    Array.isArray(candidate.choices) && candidate.choices.every(choice);
  const variant = (candidate:unknown) => object(candidate) && typeof candidate.id === "string" &&
    typeof candidate.name === "string" && typeof candidate.instruction === "string" &&
    Array.isArray(candidate.examples) && candidate.examples.every(sample) &&
    ["answer-only","explanation"].includes(String(candidate.responseMode));
  const row = (candidate:unknown) => {
    if (!object(candidate) || typeof candidate.taskId !== "string" || typeof candidate.sampleId !== "string" ||
      typeof candidate.variantId !== "string" || typeof candidate.state !== "string") return false;
    if (![null,"computed","cache"].includes(candidate.source as string|null) ||
      ![null,"metal","cuda","cpu"].includes(candidate.backend as string|null) ||
      !(candidate.error === null || typeof candidate.error === "string")) return false;
    if (candidate.output !== null && (!object(candidate.output) || typeof candidate.output.text !== "string" ||
      typeof candidate.output.finishReason !== "string")) return false;
    return candidate.score === null || (object(candidate.score) &&
      (candidate.score.answer === null || typeof candidate.score.answer === "string") &&
      typeof candidate.score.correct === "boolean" && typeof candidate.score.formatOk === "boolean");
  };
  if (!object(value) || !object(value.snapshot)) return false;
  return typeof value.snapshot.experimentId === "string" && typeof value.snapshot.name === "string" &&
    Array.isArray(value.samples) && value.samples.every(sample) && Array.isArray(value.variants) &&
    value.variants.every(variant) && Array.isArray(value.rows) && value.rows.every(row);
}

export function formatDuration(totalSeconds:number|null):string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "Waiting for enough live results";
  if (totalSeconds < 60) return `${Math.ceil(totalSeconds)} sec`;
  const minutes = Math.ceil(totalSeconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function formatTime(value:number|null):string {
  return value === null ? "—" : new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",second:"2-digit"}).format(value);
}

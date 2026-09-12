import type {Report} from '../shared/contracts.ts';

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const seconds=(value:unknown):number|null=>finite(value)?value/1000:null;
const text=(value:unknown):string|null=>typeof value==='string'?value:null;

export function formatElapsed(ms:number|null|undefined):string{
 if(!finite(ms))return '—';
 const tenths=Math.floor(ms/100),hours=Math.floor(tenths/36000),minutes=Math.floor(tenths/600)%60,secs=((tenths%600)/10).toFixed(1);
 if(hours)return `${hours}h ${String(minutes).padStart(2,'0')}m ${secs.padStart(4,'0')}s`;
 return minutes?`${minutes}m ${secs.padStart(4,'0')}s`:`${secs}s`;
}

export function comparisonRecord(report:Report):Record<string,string|number|null>{
 const s=report.snapshot;
 const contributors=new Set(report.rows.filter(r=>r.source==='computed'&&typeof r.workerId==='string').map(r=>r.workerId));
 const benchmarkMs=s.mode==='benchmark'&&finite(s.startedAt)&&finite(s.finishedAt)&&s.finishedAt>=s.startedAt?s.finishedAt-s.startedAt:null;
 return {
  experiment_id:s.experimentId,name:s.name,state:text(s.state),mode:text(s.mode),
  dataset:text(report.dataset?.name),dataset_sha256:text(report.dataset?.sha256),
  question_count:report.samples.length,prompt_count:report.variants.length,
  planned_tasks:finite(s.planned)?s.planned:null,fresh_results:finite(s.fresh)?s.fresh:null,cached_results:finite(s.cached)?s.cached:null,
  contributing_devices:contributors.size,
  total_elapsed_seconds:seconds(s.elapsedMs),execution_elapsed_seconds:seconds(s.executionElapsedMs),benchmark_release_elapsed_seconds:seconds(benchmarkMs),
  failed_tasks:finite(s.failed)?s.failed:null,canceled_tasks:finite(s.canceled)?s.canceled:null,retries:finite(s.retries)?s.retries:null,
  attempt_count:Array.isArray(report.attempts)?report.attempts.length:null,
  model:text(report.runtime?.modelRepo),inference_key:text(report.runtime?.inferenceKey),workload_fingerprint:text(s.workloadFingerprint),
 };
}

export function csvCell(value:string|number|null):string{
 let str=value===null?'':String(value);
 if(typeof value==='string'&&/^\s*[=+@-]/u.test(str))str="'"+str;
 return '"'+str.replaceAll('"','""')+'"';
}

export function comparisonCsv(report:Report):string{
 const record=comparisonRecord(report);
 return '\uFEFF'+[Object.keys(record).map(csvCell).join(','),Object.values(record).map(csvCell).join(',')].join('\r\n')+'\r\n';
}

import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {VariantSchema} from '../src/shared/schemas.ts';
import type {Variant,Report,Snapshot,Created,PoolWorkerView} from '../src/shared/contracts.ts';
export interface BenchmarkConfig {coordinatorUrl:string;joinCode:string;datasetId:string;sampleIds:string[];variants:Variant[];singleWorkerId:string;allWorkerIds:string[];repeats:3;outputDir:string}
export interface BenchmarkRun {runId:string;condition:'single'|'pooled-dynamic'|'pooled-static';repeat:number;experimentId:string;workerIds:string[];startedAt:number;finishedAt:number;elapsedMs:number;fresh:number;failed:number;report:Report}
const Config=z.object({coordinatorUrl:z.string().url().refine(x=>['http:','https:'].includes(new URL(x).protocol)&&!new URL(x).username&&!new URL(x).password),joinCode:z.string().min(1),datasetId:z.string().min(1),sampleIds:z.array(z.string().min(1)).min(1),variants:z.array(VariantSchema).min(1).max(3),singleWorkerId:z.string().min(1),allWorkerIds:z.array(z.string().min(1)).min(2),repeats:z.literal(3),outputDir:z.string().min(1)}).strict().refine(x=>new Set(x.allWorkerIds).size===x.allWorkerIds.length&&x.allWorkerIds.includes(x.singleWorkerId),'Distinct workers must include the baseline worker');
export function median(values:number[]):number{
 if(!values.length||values.some(x=>!Number.isFinite(x)||x<0))throw new Error('No valid measurements');
 const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;
}
export function assertComparable(v:{mode:string;cached:number;failed:number;expected:number;fresh:number}):void{
 if(v.mode!=='benchmark'||v.cached!==0||v.failed!==0||v.expected<=0||v.fresh!==v.expected)throw new Error('Run is not a complete, uncached, fault-free evaluation');
}
export function assertBenchmarkReport(report:Report):void{
 const s=report.snapshot;
 assertComparable({mode:s.mode,cached:s.cached,failed:s.failed,expected:s.planned,fresh:s.fresh});
 if(s.retries>0||report.attempts.length!==s.planned||report.attempts.some(a=>a.state!=='accepted'))throw new Error('Interrupted or repeated attempts cannot enter a speed comparison');
}
export function workersReadyAfter(workers:PoolWorkerView[],ids:string[],barriers:Record<string,number>):boolean{
 return ids.every(id=>workers.some(w=>w.id===id&&w.state==='ready'&&w.lastSeenAt>(barriers[id]??0)));
}
export function levelsChanged(workers:Pick<PoolWorkerView,'id'|'level'>[],expected:ReadonlyMap<string,string>):boolean{
 return workers.some(w=>expected.has(w.id)&&expected.get(w.id)!==w.level);
}
export function summarizeRuns(runs:BenchmarkRun[]){
 for(const r of runs){assertBenchmarkReport(r.report);if(r.elapsedMs<=0||!Number.isFinite(r.elapsedMs))throw new Error('Invalid time');}
 return [...new Set(runs.map(r=>r.condition))].map(condition=>{const ms=runs.filter(r=>r.condition===condition).map(r=>r.elapsedMs);return {condition,runs:ms.length,medianMs:median(ms),minMs:Math.min(...ms),maxMs:Math.max(...ms)};});
}
export async function runBenchmark(raw:BenchmarkConfig):Promise<BenchmarkRun[]>{
 const config=Config.parse(raw),runId=randomUUID(),out=resolve(config.outputDir,runId);await mkdir(out,{recursive:true});
 const {joinCode,...publicConfig}=config;await writeFile(join(out,'configuration.json'),JSON.stringify(publicConfig,null,2));
 async function request<T>(path:string,body?:unknown,secret=joinCode):Promise<T>{
  const response=await fetch(new URL(path,config.coordinatorUrl),{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${secret}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Benchmark request failed (${response.status}); inspect the dedicated queue before retrying`);return response.json() as Promise<T>;
 }
 async function ready(ids:string[]){
  const before=await request<PoolWorkerView[]>('/api/workers');
  const barriers=Object.fromEntries(before.map(w=>[w.id,w.lastSeenAt]));
  const deadline=Date.now()+360000;
  for(;;){const workers=await request<PoolWorkerView[]>('/api/workers');if(workersReadyAfter(workers,ids,barriers))return workers;
   if(Date.now()>deadline)throw new Error('Workers did not become ready within 6 minutes');await delay(2000);}
 }
 const orders=[['single','pooled-dynamic','pooled-static'],['pooled-static','pooled-dynamic','single'],['pooled-dynamic','single','pooled-static']] as const;
 const valid:BenchmarkRun[]=[];const levels=new Map<string,string>();
 for(const [round,order] of orders.entries())for(const condition of order){
  const workerIds=condition==='single'?[config.singleWorkerId]:config.allWorkerIds;
  const created=await request<Created>('/api/experiments',{name:`Benchmark ${round+1} · ${condition}`,datasetId:config.datasetId,sampleIds:config.sampleIds,variants:config.variants,mode:'benchmark',benchmark:{policy:condition==='pooled-static'?'static':'dynamic',workerIds,held:true}});
  const id=created.experimentId;let ended=false;
  try{
   const initial=await ready(config.allWorkerIds);
   for(const w of initial.filter(w=>config.allWorkerIds.includes(w.id))){if(levels.has(w.id)&&levels.get(w.id)!==w.level)throw new Error('Owner contribution level changed between runs');levels.set(w.id,w.level);}
   await writeFile(join(out,`${round+1}-${condition}-workers.json`),JSON.stringify(initial.filter(w=>config.allWorkerIds.includes(w.id)),null,2));
   await request(`/api/experiments/${id}/start`,{},created.ownerToken);
   const deadline=Date.now()+Math.min(7200000,Math.max(300000,config.sampleIds.length*config.variants.length*120000));
   let changed=false;
   for(;;){const s=await request<Snapshot>(`/api/experiments/${id}`);
    const pool=await request<PoolWorkerView[]>('/api/workers');
    if(levelsChanged([...pool,...s.workers],levels))changed=true;
    if(['completed','completed-with-errors','canceled'].includes(s.state))break;
    if(Date.now()>deadline)throw new Error('Benchmark exceeded its finite run deadline');await delay(2000);
   }
   ended=true;const report=await request<Report>(`/api/experiments/${id}/report`),s=report.snapshot;
   const result:BenchmarkRun={runId,condition,repeat:round+1,experimentId:id,workerIds,startedAt:s.startedAt??0,finishedAt:s.finishedAt??0,elapsedMs:(s.finishedAt??0)-(s.startedAt??0),fresh:s.fresh,failed:s.failed,report};
   let invalid:string|null=null;
   try{assertBenchmarkReport(report);assertComparable({mode:s.mode,cached:s.cached,failed:s.failed,expected:config.sampleIds.length*config.variants.length,fresh:s.fresh});if(changed||levelsChanged(s.workers,levels)||s.state!=='completed'||result.elapsedMs<=0)throw new Error('Owner level changed or incomplete timing');}
   catch(e){invalid=e instanceof Error?e.message:'Invalid run';}
   await writeFile(join(out,`${round+1}-${condition}.json`),JSON.stringify({valid:invalid===null,invalid,...result},null,2));
   if(!invalid)valid.push(result);console.log(`${round+1}/3 ${condition}: ${invalid??`${result.elapsedMs} ms`}`);
  }catch(e){
   if(!ended)await request(`/api/experiments/${id}/cancel`,{},created.ownerToken).catch(()=>undefined);
   const partial=await request<Report>(`/api/experiments/${id}/report`).catch(()=>null);
   await writeFile(join(out,`${round+1}-${condition}-interrupted.json`),JSON.stringify({valid:false,experimentId:id,error:e instanceof Error?e.message:'Run interrupted',report:partial},null,2));throw e;
  }
 }
 const summary=summarizeRuns(valid),time=(condition:string)=>summary.find(s=>s.condition===condition&&s.runs===3)?.medianMs;
 const single=time('single'),dynamic=time('pooled-dynamic'),stat=time('pooled-static');
 await writeFile(join(out,'summary.json'),JSON.stringify({runId,validRuns:valid.length,expectedRuns:9,summary,singleToDynamic:single&&dynamic?single/dynamic:null,staticToDynamic:stat&&dynamic?stat/dynamic:null,scope:'One task per physical device; excludes cold loading, result cache and faulted runs. Not a comparison to an optimized batched single GPU.'},null,2));
 return valid;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const i=process.argv.indexOf('--config');if(i<0||!process.argv[i+1]){console.error('Usage: npm run benchmark -- --config local-benchmark.json');process.exitCode=1;}
 else await runBenchmark(JSON.parse(await readFile(process.argv[i+1],'utf8'))).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
}

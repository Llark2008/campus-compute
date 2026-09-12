import {createHash} from 'node:crypto';
import {Context,uid,type TaskRow,type ResultRow} from './db.ts';
import {token,digest} from './auth.ts';
import {parseJsonl} from '../domain/dataset.ts';
import {hashJson,workKey} from '../domain/keys.ts';
import {renderMessages} from '../domain/prompts.ts';
import {scoreAnswer} from '../domain/score.ts';
import {CreateSchema,ImportSchema} from '../shared/schemas.ts';
import {DomainError} from '../shared/errors.ts';
import type {CreateInput,ImportInput,DatasetMeta,Sample,Variant,Preview,Created} from '../shared/contracts.ts';

export function importDataset(c:Context,raw:ImportInput):DatasetMeta{
 const input=ImportSchema.parse(raw), samples=parseJsonl(input.jsonl);
 const sha256=createHash('sha256').update(input.jsonl).digest('hex');
 const id=hashJson({sha256,name:input.name,source:input.source,revision:input.revision,license:input.license});
 const prior=c.get<{meta_json:string}>('SELECT meta_json FROM datasets WHERE id=?',id);if(prior)return JSON.parse(prior.meta_json);
 const meta:DatasetMeta={id,name:input.name,sha256,source:input.source,revision:input.source.startsWith('user-upload:')?`content-sha256:${sha256}`:input.revision,license:input.license,sampleIds:samples.map(s=>s.id)};
 c.run('INSERT INTO datasets VALUES(?,?)',id,JSON.stringify(meta));
 for(const sample of samples)c.run('INSERT INTO samples VALUES(?,?,?)',id,sample.id,JSON.stringify(sample));return meta;
}
export function taskOrder(samples:Sample[],variants:Variant[]){return samples.flatMap((sample,si)=>variants.map((variant,vi)=>({sample,variant,ordinal:si*variants.length+vi})));}
function prepare(c:Context,raw:CreateInput){
 const input=CreateSchema.parse(raw);
 if(!c.get('SELECT id FROM datasets WHERE id=?',input.datasetId))throw new DomainError('NOT_FOUND','Dataset not found');
 const samples=input.sampleIds.map(id=>{const r=c.get<{sample_json:string}>('SELECT sample_json FROM samples WHERE dataset_id=? AND id=?',input.datasetId,id);if(!r)throw new DomainError('VALIDATION',`Unknown question: ${id}`);return JSON.parse(r.sample_json) as Sample;});
 for(const v of input.variants)for(const e of v.examples){
  if(input.sampleIds.includes(e.id))throw new DomainError('VALIDATION','Example overlaps evaluation questions');
  if(e.originalLabels.length!==e.choices.length||new Set(e.originalLabels).size!==e.choices.length||e.choices.some((x,i)=>x.label!==String.fromCharCode(65+i))||!e.choices.some(x=>x.label===e.answerKey))throw new DomainError('VALIDATION','Example labels must be normalized');
 }
 if(input.benchmark)for(const id of input.benchmark.workerIds){const w=c.worker(id);if(c.registration(w).inferenceKey!==c.options.runtime.inferenceKey)throw new DomainError('CONFIG_MISMATCH','Benchmark worker model differs');}
 const tasks=taskOrder(samples,input.variants).map(t=>({...t,key:workKey(t.sample,t.variant,c.options.runtime)}));
 return {input,tasks};
}
export function preview(c:Context,raw:CreateInput):Preview{
 const {input,tasks}=prepare(c,raw);const cached=input.mode==='benchmark'?0:tasks.filter(t=>c.get('SELECT result_id FROM result_cache WHERE work_key=?',t.key)).length;
 return {total:tasks.length,cached,fresh:tasks.length-cached};
}
export function createExperiment(c:Context,raw:CreateInput):Created{
 const {input,tasks}=prepare(c,raw),experimentId=uid(),ownerToken=token();
 c.run('INSERT INTO experiments(id,dataset_id,input_json,runtime_json,owner_hash,mode,held,created_at) VALUES(?,?,?,?,?,?,?,?)',experimentId,input.datasetId,JSON.stringify(input),JSON.stringify(c.options.runtime),digest(ownerToken),input.mode,input.benchmark?.held?1:0,c.now());
 let cached=0;
 for(const t of tasks){
  const id=uid();let assigned:string|null=null;
  if(input.benchmark?.policy==='static')assigned=input.benchmark.workerIds[Math.floor(t.ordinal*input.benchmark.workerIds.length/tasks.length)];
  const hit=input.mode==='normal'?c.get<{result_id:string}>('SELECT result_id FROM result_cache WHERE work_key=?',t.key):undefined;
  const result=hit?c.get<ResultRow>('SELECT * FROM results WHERE id=?',hit.result_id):undefined;
  const score=result?scoreAnswer(JSON.parse(result.output_json).text,t.sample,t.variant.responseMode):null;
  c.run('INSERT INTO tasks(id,experiment_id,sample_id,variant_id,ordinal,work_key,messages_json,state,assigned_worker,source,result_id,score_json,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,experimentId,t.sample.id,t.variant.id,t.ordinal,t.key,JSON.stringify(renderMessages(t.sample,t.variant)),result?'completed':'queued',assigned,result?'cache':null,result?.id??null,score?JSON.stringify(score):null,result?c.now():null);
  if(result)cached++;
 }
 c.startRecording(experimentId);
 c.event('created',experimentId,null,null,`${tasks.length} tasks; ${cached} cached`);c.finish(experimentId);
 return {experimentId,ownerToken,preview:{total:tasks.length,cached,fresh:tasks.length-cached}};
}
export function cancel(c:Context,id:string){
 const e=c.experiment(id);if(e.canceled_at!==null)return;
 const affected=c.all<{id:string}>("SELECT id FROM tasks WHERE experiment_id=? AND state IN ('queued','leased') ORDER BY ordinal",id);
 c.run('UPDATE experiments SET canceled_at=? WHERE id=?',c.now(),id);
 c.run("UPDATE attempts SET state='canceled',ended_at=? WHERE state='active' AND task_id IN (SELECT id FROM tasks WHERE experiment_id=?)",c.now(),id);
 c.run("UPDATE tasks SET state='canceled' WHERE experiment_id=? AND state IN ('queued','leased')",id);
 for(const task of affected)c.event('task_canceled',id,task.id);
 c.event('canceled',id);c.finish(id);
}
export function start(c:Context,id:string){
 const e=c.experiment(id);if(e.mode!=='benchmark'||!e.held||e.canceled_at!==null||e.finished_at!==null)throw new DomainError('VALIDATION','Experiment is not a held benchmark');
 c.run('UPDATE experiments SET held=0,started_at=? WHERE id=?',c.now(),id);c.event('started',id);
}

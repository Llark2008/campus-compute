import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {recordEvent,startRecording,finishRecording} from './recording.ts';
import {DomainError} from '../shared/errors.ts';
import type {RuntimeLock,Sample,Registration,CreateInput,Variant} from '../shared/contracts.ts';

export function openDb(filename:string):DatabaseSync {
 const db=new DatabaseSync(filename);db.exec('PRAGMA busy_timeout=5000');
 db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));return db;
}
export function transaction<T>(db:DatabaseSync,fn:()=>T):T{
 db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
}
export interface ExperimentRow {id:string;dataset_id:string;input_json:string;runtime_json:string;owner_hash:string;mode:'normal'|'benchmark';held:number;canceled_at:number|null;created_at:number;started_at:number|null;finished_at:number|null;last_dispatch:number}
export interface TaskRow {id:string;experiment_id:string;sample_id:string;variant_id:string;ordinal:number;work_key:string;messages_json:string;state:string;faults:number;assigned_worker:string|null;source:'computed'|'cache'|null;result_id:string|null;score_json:string|null;error:string|null;completed_at:number|null}
export interface AttemptRow {id:string;task_id:string;worker_id:string;state:string;started_at:number;expires_at:number;deadline_at:number;ended_at:number|null}
export interface WorkerRow {id:string;token_hash:string;registration_json:string;state:string;level:string;last_seen_at:number}
export interface ResultRow {id:string;task_id:string;lease_id:string;worker_id:string;backend:string;output_json:string;receipt_json:string;accepted_at:number}
export class Context {
 readonly db:DatabaseSync;readonly now:()=>number;
 constructor(readonly options:{filename:string;runtime:RuntimeLock;examples:Sample[];now?:()=>number}){this.db=openDb(options.filename);this.now=options.now??Date.now;}
 get<T>(sql:string,...values:SQLInputValue[]):T|undefined{return this.db.prepare(sql).get(...values) as T|undefined;}
 all<T>(sql:string,...values:SQLInputValue[]):T[]{return this.db.prepare(sql).all(...values) as T[];}
 run(sql:string,...values:SQLInputValue[]){return this.db.prepare(sql).run(...values);}
 tx<T>(fn:()=>T):T{return transaction(this.db,fn);}
 experiment(id:string):ExperimentRow{const e=this.get<ExperimentRow>('SELECT * FROM experiments WHERE id=?',id);if(!e)throw new DomainError('NOT_FOUND','Experiment not found');return e;}
 worker(id:string):WorkerRow{const w=this.get<WorkerRow>('SELECT * FROM workers WHERE id=?',id);if(!w)throw new DomainError('UNAUTHORIZED','Unknown worker session');return w;}
 task(id:string):TaskRow{const t=this.get<TaskRow>('SELECT * FROM tasks WHERE id=?',id);if(!t)throw new DomainError('NOT_FOUND','Task not found');return t;}
 sample(e:ExperimentRow,id:string):Sample{const r=this.get<{sample_json:string}>('SELECT sample_json FROM samples WHERE dataset_id=? AND id=?',e.dataset_id,id);if(!r)throw new DomainError('VALIDATION','Unknown question');return JSON.parse(r.sample_json);}
 input(e:ExperimentRow):CreateInput{return JSON.parse(e.input_json);}
 variant(e:ExperimentRow,id:string):Variant{const v=this.input(e).variants.find(v=>v.id===id);if(!v)throw new DomainError('VALIDATION','Unknown prompt');return v;}
 registration(w:WorkerRow):Registration{return JSON.parse(w.registration_json);}
 event(kind:string,experimentId:string|null=null,taskId:string|null=null,workerId:string|null=null,detail='',data?:Record<string,unknown>){
  const at=this.now();
  this.run('INSERT INTO events(experiment_id,at,kind,task_id,worker_id,detail) VALUES(?,?,?,?,?,?)',experimentId,at,kind,taskId,workerId,detail);
  recordEvent(this,{experimentId,kind,at,taskId,workerId,data});
 }
 startRecording(id:string){startRecording(this,id);}
 finish(id:string){
  const n=this.get<{n:number}>("SELECT COUNT(*) n FROM tasks WHERE experiment_id=? AND state IN ('queued','leased')",id)!.n;
  if(n===0){this.run('UPDATE experiments SET finished_at=COALESCE(finished_at,?) WHERE id=?',this.now(),id);finishRecording(this,id);}
 }
}
export const uid=()=>randomUUID();

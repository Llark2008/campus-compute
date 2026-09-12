import {Context,uid,type WorkerRow} from './db.ts';
import * as experiments from './experiments.ts';
import * as leases from './leases.ts';
import * as results from './results.ts';
import * as recording from './recording.ts';
import * as reports from './report.ts';
import {token,digest,tokenMatches} from './auth.ts';
import {defaultVariants} from '../domain/prompts.ts';
import {DomainError} from '../shared/errors.ts';
import {RegistrationSchema,HeartbeatSchema} from '../shared/schemas.ts';
import type {RuntimeLock,Sample,ImportInput,DatasetMeta,CreateInput,Registration,Heartbeat,SubmitInput,LeaseRef,FaultInput} from '../shared/contracts.ts';
export function createStore(options:{filename:string;runtime:RuntimeLock;examples:Sample[];now?:()=>number}){
 const c=new Context(options);
 c.tx(()=>recording.resumeRecordings(c));
 return {
  runtime:structuredClone(options.runtime),
  importDataset:(input:ImportInput)=>c.tx(()=>experiments.importDataset(c,input)),
  listDatasets:()=>c.all<{meta_json:string}>('SELECT meta_json FROM datasets ORDER BY rowid').map(x=>JSON.parse(x.meta_json) as DatasetMeta),
  listWorkers:()=>reports.connectedWorkers(c),
  defaultVariants:()=>defaultVariants(options.examples),
  preview:(input:CreateInput)=>experiments.preview(c,input),
  create:(input:CreateInput)=>c.tx(()=>experiments.createExperiment(c,input)),
  register:(raw:Registration)=>c.tx(()=>{const input=RegistrationSchema.parse(raw);if(input.inferenceKey!==options.runtime.inferenceKey)throw new DomainError('CONFIG_MISMATCH','Model configuration differs from coordinator');const workerId=uid(),secret=token();c.run("INSERT INTO workers(id,token_hash,registration_json,state,last_seen_at) VALUES(?,?,?,'ready',?)",workerId,digest(secret),JSON.stringify(input),c.now());c.event('registered',null,null,workerId,input.name);return {workerId,token:secret};}),
  workerForToken:(secret:string)=>{const w=c.get<WorkerRow>('SELECT * FROM workers WHERE token_hash=?',digest(secret));if(!w)throw new DomainError('UNAUTHORIZED','Invalid worker token');return w.id;},
  authorizeOwner:(id:string,secret:string)=>{if(!tokenMatches(secret,c.experiment(id).owner_hash))throw new DomainError('UNAUTHORIZED','Invalid experiment owner token');},
  heartbeat:(id:string,input:Heartbeat)=>c.tx(()=>leases.heartbeat(c,id,HeartbeatSchema.parse(input))),
  claim:(id:string)=>c.tx(()=>leases.claim(c,id)),
  accept:(id:string,input:SubmitInput)=>c.tx(()=>results.accept(c,id,input)),
  release:(id:string,input:LeaseRef)=>c.tx(()=>leases.release(c,id,input)),
  fault:(id:string,input:FaultInput)=>c.tx(()=>leases.fault(c,id,input)),
  leave:(id:string)=>c.tx(()=>leases.leave(c,id)),
  sweep:()=>c.tx(()=>{leases.sweep(c);recording.captureDue(c);}),
  cancel:(id:string)=>c.tx(()=>experiments.cancel(c,id)),
  start:(id:string)=>c.tx(()=>experiments.start(c,id)),
  snapshot:(id:string)=>reports.snapshot(c,id),
  report:(id:string)=>reports.report(c,id),
  trace:(id:string)=>recording.exportTrace(c,id),
  close:()=>{c.tx(()=>recording.checkpointRecordings(c));c.db.close();},
 };
}
export type Store=ReturnType<typeof createStore>;

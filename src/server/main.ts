import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,isAbsolute,relative,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {RuntimeLockSchema,SampleSchema} from '../shared/schemas.ts';
import {computeInferenceKey} from '../worker/engine.ts';
import {createStore} from './store.ts';
import {buildServer} from './app.ts';
import {LIMITS} from '../shared/limits.ts';

const Config=z.object({host:z.string().min(1),port:z.number().int().min(1).max(65535),dataDir:z.string().refine(isAbsolute,'Use an absolute local data directory'),joinCode:z.string().min(8),runtimeLockPath:z.string(),datasetPath:z.string(),examplesPath:z.string(),datasetManifestPath:z.string().optional()}).strict();
const bundledTestDataset=new URL('../../data/arc-test.jsonl',import.meta.url);
const bundledTestManifest=new URL('../../data/arc-test.lock.json',import.meta.url);
export async function startServer(configPath:string){
 const config=Config.parse(JSON.parse(readFileSync(configPath,'utf8')));
 const rel=relative(process.cwd(),config.dataDir);
 if(rel===''||!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('SQLite dataDir must be outside the project/synced folder');
 const runtime=RuntimeLockSchema.parse(JSON.parse(readFileSync(config.runtimeLockPath,'utf8')));
 if(computeInferenceKey(runtime)!==runtime.inferenceKey)throw new Error('Runtime lock fingerprint is invalid; rerun the verified probe');
 const examples=z.array(SampleSchema).length(2).parse(JSON.parse(readFileSync(config.examplesPath,'utf8')));
 const manifest=config.datasetManifestPath?JSON.parse(readFileSync(config.datasetManifestPath,'utf8')) as {source:string;revision:string;license:string}:null;
 mkdirSync(config.dataDir,{recursive:true,mode:0o700});
 const store=createStore({filename:join(config.dataDir,'campus.sqlite'),runtime,examples});
  try{
  store.importDataset({name:'ARC-Challenge · fixed 200',jsonl:readFileSync(config.datasetPath,'utf8'),source:manifest?.source??'https://huggingface.co/datasets/allenai/ai2_arc',revision:manifest?.revision??'local-file',license:manifest?.license??'CC BY-SA 4.0'});
  const hasBundledTestDataset=existsSync(bundledTestDataset),hasBundledTestManifest=existsSync(bundledTestManifest);
  if(hasBundledTestDataset!==hasBundledTestManifest)throw new Error('Bundled ARC test dataset and lock must both be present');
  if(hasBundledTestDataset){
   const testManifest=JSON.parse(readFileSync(bundledTestManifest,'utf8')) as {source:string;revision:string;license:string};
   store.importDataset({name:'ARC-Challenge · 1,172 test questions',jsonl:readFileSync(bundledTestDataset,'utf8'),source:testManifest.source,revision:testManifest.revision,license:testManifest.license});
  }
  const app=buildServer({store,joinCode:config.joinCode,webRoot:resolve('dist/web')});
  const timer=setInterval(()=>{try{store.sweep();}catch(e){console.error('Queue recovery failed:',e instanceof Error?e.message:'unknown');}},LIMITS.sweepMs);
  timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);store.close();});
  try{await app.listen({host:config.host,port:config.port});}catch(e){await app.close();throw e;}
  let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await app.close();};
  process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
  console.log(`Campus Compute coordinator: http://${config.host}:${config.port}`);
  return {app,store,shutdown};
 }catch(e){try{store.close();}catch{}throw e;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const index=process.argv.indexOf('--config');
 if(index<0||!process.argv[index+1]){console.error('Usage: npm run server -- --config /absolute/path/server.json');process.exitCode=1;}
 else await startServer(resolve(process.argv[index+1])).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
}

import {expect,test} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {fixture,testRuntime} from '../fixtures/core.ts';
import {buildServer} from '../../src/server/app.ts';
import {createCoordinatorClient} from '../../src/worker/client.ts';
import {createRunner} from '../../src/worker/runner.ts';
import type {Engine} from '../../src/worker/engine.ts';
import type {WorkerConfig} from '../../src/shared/contracts.ts';

// Real HTTP/SQLite/Runner integration. Only native model execution is a test double.
test('native protocol runner completes work through HTTP and returns to stopped',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'});
 const url=await app.listen({host:'127.0.0.1',port:0});let running=false;
 const engine:Engine={start:async()=>{running=true;},stop:async()=>{running=false;},pid:()=>running?999999:null,
  describe:async()=>({engineVersion:'test',chatTemplate:'test',totalSlots:1,contextSize:2048}),
  infer:async()=>({text:'ANSWER: B',finishReason:'stop',inputTokens:20,outputTokens:4,inferenceMs:1})};
 const config:WorkerConfig={name:'http-test-only',coordinatorUrl:url,joinCode:'test-group',backend:'cpu',engineBin:'test-only',enginePrefix:[],modelPath:'test-only',enginePort:8081,controlPort:3001,stateDir:'/tmp/campus-test-only'};
 const runner=createRunner({engine,client:createCoordinatorClient(url),config,runtime:testRuntime});
 try{
  const e=f.store.create({...f.input,variants:[f.input.variants[0],{...f.input.variants[0],id:'B',instruction:'Second prompt'}]});
  await runner.control({action:'set-level',level:'high'});await runner.control({action:'start'});
  const deadline=Date.now()+10000;while(f.store.snapshot(e.experimentId).fresh<2&&Date.now()<deadline)await delay(25);
  const r=f.store.report(e.experimentId);expect(r.snapshot.state,JSON.stringify(runner.status())).toBe('completed');expect(r.snapshot.fresh).toBe(2);expect(r.rows.every(x=>x.score?.correct)).toBe(true);
  await runner.control({action:'exit'});expect(runner.status()).toMatchObject({state:'stopped',enginePid:null});
 }finally{await runner.close();await app.close();f.store.close();}
});

test('coordinator shutdown closes an idle speculative TCP connection',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'});
 const url=new URL(await app.listen({host:'127.0.0.1',port:0}));
 const socket=createConnection({host:url.hostname,port:Number(url.port)});
 await once(socket,'connect');
 const closing=app.close();
 try{
  const outcome=await Promise.race([closing.then(()=>"closed" as const),delay(250).then(()=>"timeout" as const)]);
  expect(outcome).toBe('closed');
 }finally{socket.destroy();await closing;f.store.close();}
});

test('coordinator shutdown closes a client that stalls during a partial request',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'});
 const url=new URL(await app.listen({host:'127.0.0.1',port:0}));
 const socket=createConnection({host:url.hostname,port:Number(url.port)});
 await once(socket,'connect');
 socket.write(`POST /api/tasks/claim HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
 await delay(20);
 const closing=app.close();
 try{
  const outcome=await Promise.race([closing.then(()=>"closed" as const),delay(250).then(()=>"timeout" as const)]);
  expect(outcome).toBe('closed');
 }finally{socket.destroy();await closing;f.store.close();}
});

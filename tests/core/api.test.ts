import {expect,test} from 'vitest';
import {fixture,testRegistration,submission} from '../fixtures/core.ts';
import {buildServer} from '../../src/server/app.ts';
test('HTTP publish, authenticated competition, submit and traceable report',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'}), group={authorization:'Bearer test-group'};
 try {
 const created=await app.inject({method:'POST',url:'/api/experiments',headers:group,payload:f.input});expect(created.statusCode).toBe(200);
 const id=created.json().experimentId;const workers=[f.store.register(testRegistration),f.store.register(testRegistration)];
 const rs=await Promise.all(workers.map(w=>app.inject({method:'POST',url:'/api/tasks/claim',headers:{authorization:`Bearer ${w.token}`}})));
 expect(rs.map(r=>r.statusCode).sort()).toEqual([200,204]); const i=rs.findIndex(r=>r.statusCode===200),lease=rs[i].json();
 expect(JSON.stringify(lease)).not.toContain('answerKey');
 const r=await app.inject({method:'POST',url:`/api/tasks/${lease.taskId}/result`,headers:{authorization:`Bearer ${workers[i].token}`},payload:submission(lease)});expect(r.statusCode).toBe(200);
 const report=await app.inject({url:`/api/experiments/${id}/report`,headers:group});expect(report.json().rows[0].score.correct).toBe(true);
 expect((await app.inject({method:'POST',url:'/api/tasks/claim'})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:`/api/experiments/${id}/cancel`,headers:group})).statusCode).toBe(401);
 expect((await app.inject({url:'/api/nonexistent'})).statusCode).toBe(404);
 }finally{await app.close();f.store.close();}
});
test('malformed JSON and unsupported media are client validation errors',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'});
 try{for(const [contentType,payload,status] of [['application/json','{bad',400],['application/xml','<bad/>',415]] as const){
  const r=await app.inject({method:'POST',url:'/api/experiments',headers:{authorization:'Bearer test-group','content-type':contentType},payload});
  expect(r.statusCode).toBe(status);expect(r.json().error.code).toBe('VALIDATION');
 }}finally{await app.close();f.store.close();}
});

test('connected pool is authenticated and separate from experiment contributors',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'}),headers={authorization:'Bearer test-group'};
 try{
  const w=f.store.register(testRegistration),stopped=f.store.register({...testRegistration,name:'stopped'});f.store.leave(stopped.workerId);
  const e=f.store.create({...f.input,mode:'benchmark',benchmark:{policy:'dynamic',workerIds:[w.workerId],held:true}});
  expect((await app.inject({url:'/api/workers'})).statusCode).toBe(401);
  const response=await app.inject({url:'/api/workers',headers});expect(response.statusCode).toBe(200);
  expect(response.json().map((item:{id:string})=>item.id)).toEqual([w.workerId]);
  expect(JSON.stringify(response.json())).not.toContain(w.token);
  expect(f.store.snapshot(e.experimentId).workers).toEqual([]);
  f.advance(20000);expect((await app.inject({url:'/api/workers',headers})).json()).toEqual([]);
 }finally{await app.close();f.store.close();}
});

test('process recording export is group-authenticated and includes zero-contribution pool sessions',async()=>{
 const f=fixture(),app=buildServer({store:f.store,joinCode:'test-group'}),headers={authorization:'Bearer test-group'};
 try{
  const w=f.store.register(testRegistration),e=f.store.create(f.input),url=`/api/experiments/${e.experimentId}/trace`;
  expect((await app.inject({url})).statusCode).toBe(401);
  const response=await app.inject({url,headers});expect(response.statusCode).toBe(200);
  const trace=response.json();expect(trace.frames[0].workers[0]).toMatchObject({workerId:w.workerId,completed:0});
  expect(trace.schemaVersion).toBe(1);expect(response.body).not.toContain('test-group');expect(response.body).not.toContain(w.token);
  const live=await app.inject({url:`/api/experiments/${e.experimentId}`,headers});expect(live.json().recording).toMatchObject({available:true,endedAt:null,frameCount:1});
 }finally{await app.close();f.store.close();}
});

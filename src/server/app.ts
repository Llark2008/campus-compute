import Fastify, {type FastifyRequest, type HTTPMethods} from "fastify";
import fastifyStatic from "@fastify/static";
import {createHash,timingSafeEqual} from "node:crypto";
import {ZodError,z} from "zod";
import { DomainError } from "../shared/errors.ts";
import {ImportSchema,CreateSchema,RegistrationSchema,HeartbeatSchema,SubmitSchema,LeaseRefSchema,FaultSchema} from "../shared/schemas.ts";
import type { Store } from "./store.ts";
export function buildServer({store,joinCode,webRoot}:{store:Store;joinCode:string;webRoot?:string}) {
  const app=Fastify({bodyLimit:4_200_000,logger:false,forceCloseConnections:true});
  const digest=(value:string)=>createHash("sha256").update(value).digest();
  const groupHash=digest(joinCode);
  const bearer=(r:FastifyRequest) => {
    const h=r.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new DomainError("UNAUTHORIZED","需要身份令牌");
    return h.slice(7);
  };
  const wid=(r:FastifyRequest)=>store.workerForToken(bearer(r));
  const eid=(r:FastifyRequest)=>z.object({id:z.string().min(1).max(100)}).parse(r.params).id;
  const same=(a:string,b:string)=>{if(a!==b)throw new DomainError("VALIDATION","路径与请求身份不一致");};
  function bind(method:HTTPMethods,url:string,role:"group"|"worker"|"owner",run:(r:FastifyRequest)=>unknown) {
    app.route({method,url,handler:async(r,reply)=>{
      if (role==="group" && !timingSafeEqual(digest(bearer(r)),groupHash)) throw new DomainError("UNAUTHORIZED","加入码无效");
      if (role==="worker") wid(r);
      if (role==="owner") store.authorizeOwner(eid(r),bearer(r));
      const value=run(r);
      if (value===null) return reply.code(204).send();
      return value===undefined ? {ok:true} : value;
    }});
  }
  app.get("/api/bootstrap",()=>({surface:"coordinator"}));
  bind("GET","/api/datasets","group",()=>store.listDatasets());
  bind("GET","/api/workers","group",()=>store.listWorkers());
  bind("GET","/api/defaults","group",()=>({variants:store.defaultVariants(),runtime:store.runtime}));
  bind("POST","/api/datasets","group",r=>store.importDataset(ImportSchema.parse(r.body)));
  bind("POST","/api/experiments/preview","group",r=>store.preview(CreateSchema.parse(r.body)));
  bind("POST","/api/experiments","group",r=>store.create(CreateSchema.parse(r.body)));
  bind("POST","/api/workers/register","group",r=>store.register(RegistrationSchema.parse(r.body)));
  bind("POST","/api/workers/:id/heartbeat","worker",r=>{const worker=wid(r);same(eid(r),worker);return store.heartbeat(worker,HeartbeatSchema.parse(r.body));});
  bind("POST","/api/tasks/claim","worker",r=>store.claim(wid(r)));
  bind("POST","/api/tasks/:id/result","worker",r=>{const input=SubmitSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.accept(wid(r),input);});
  bind("POST","/api/tasks/:id/release","worker",r=>{const input=LeaseRefSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.release(wid(r),input);});
  bind("POST","/api/tasks/:id/error","worker",r=>{const input=FaultSchema.parse(r.body);same(eid(r),input.taskId);same(wid(r),input.workerId);return store.fault(wid(r),input);});
  bind("POST","/api/workers/:id/leave","worker",r=>{same(eid(r),wid(r));return store.leave(wid(r));});
  bind("GET","/api/experiments/:id","group",r=>store.snapshot(eid(r)));
  bind("GET","/api/experiments/:id/trace","group",r=>store.trace(eid(r)));
  bind("GET","/api/experiments/:id/report","group",r=>store.report(eid(r)));
  bind("POST","/api/experiments/:id/cancel","owner",r=>store.cancel(eid(r)));
  bind("POST","/api/experiments/:id/start","owner",r=>store.start(eid(r)));
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:{code:"VALIDATION",message:error.issues[0]?.message??"输入无效"}});
    if(error instanceof DomainError){
      const status=error.code==="UNAUTHORIZED"?401:error.code==="NOT_FOUND"?404:
        ["LEASE_LOST","CONFIG_MISMATCH"].includes(error.code)?409:400;
      return reply.code(status).send({error:{code:error.code,message:error.message,line:error.line}});
    }
    const status=(error as {statusCode?:number}).statusCode;
    if(status && status>=400 && status<500)return reply.code(status).send({error:{code:"VALIDATION",message:error instanceof Error?error.message:"Invalid request"}});
    request.log.error({message:error instanceof Error?error.message:"unknown error"},"request failed");
    return reply.code(500).send({error:{code:"ENGINE_ERROR",message:"服务内部错误"}});
  });
  if(webRoot)app.register(fastifyStatic,{root:webRoot,index:"index.html"});
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:"NOT_FOUND",message:"接口或页面不存在"}}));
  return app;
}

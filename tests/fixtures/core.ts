// tests/fixtures/core.ts
import { GENERATION } from "../../src/shared/limits.ts";
import { createStore } from "../../src/server/store.ts";
import type { RuntimeLock, Registration, CreateInput, Lease, SubmitInput } from "../../src/shared/contracts.ts";
export const testRuntime:RuntimeLock = {
  adapterVersion:"llama-completion-v1",
  modelRepo:"test-only",modelRevision:"0".repeat(40),modelFile:"test-only.gguf",
  modelSha256:"0".repeat(64),engineVersion:"test-only",chatTemplateSha256:"0".repeat(64),
  generation:GENERATION,inferenceKey:"a".repeat(64),artifacts:[],
};
export const testRegistration:Registration = {name:"fixture",platform:"test",arch:"test",cpu:"test",memoryBytes:8_000_000_000,backend:"cpu",inferenceKey:testRuntime.inferenceKey};
export function fixture(filename=":memory:") {
  let time=1_000_000;
  const store=createStore({filename,runtime:testRuntime,examples:[],now:()=>time});
  const dataset=store.importDataset({name:"fixture",source:"test-only",revision:"test-only",license:"test-only",
    jsonl:JSON.stringify({id:"q1",question:"Which is liquid?",choices:[{label:"A",text:"Ice"},{label:"B",text:"Water"}],answerKey:"B"})});
  const input:CreateInput={name:"fixture",datasetId:dataset.id,sampleIds:["q1"],mode:"normal",
    variants:[{id:"A",name:"direct",instruction:"Answer with ANSWER: X",examples:[],responseMode:"answer-only"}]};
  return {store,input,advance:(ms:number)=>{time+=ms;},now:()=>time};
}
export function submission(lease:Lease):SubmitInput {
  return {experimentId:lease.experimentId,taskId:lease.taskId,leaseId:lease.leaseId,workerId:lease.workerId,
    inferenceKey:lease.inferenceKey,backend:"cpu",
    output:{text:"ANSWER: B",finishReason:"stop",inputTokens:20,outputTokens:4,inferenceMs:100}};
}

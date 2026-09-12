import {readFileSync} from 'node:fs';
import {describe,expect,test} from 'vitest';
import type {ExperimentTrace} from '../../src/shared/contracts.ts';
import {createReplay,stateAt} from '../../src/replay/model.ts';
const trace=JSON.parse(readFileSync(new URL('../../data/showcase/join-and-out.json',import.meta.url),'utf8')) as ExperimentTrace;
const timing={createdAt:1789225770214,finishedAt:1789226303457};
const index=createReplay(trace,timing);
const relative=(at:number)=>at-timing.createdAt;
describe('the real join_and_out replay',()=>{
 test('opens at zero without disclosing future devices or contributions',()=>{
  const state=stateAt(index,0);
  expect(state.progress).toMatchObject({planned:3000,fresh:0,queued:3000,cached:0});
  expect(state.devices.map(d=>d.name)).toEqual(['local-mac']);
  expect(state.devices[0].completed).toBe(0);
 });
 test('introduces a device at the exact observed join, with zero work',()=>{
  const join=trace.events.find(e=>e.kind==='registered')!;
  expect(stateAt(index,relative(join.at)-1).devices).toHaveLength(1);
  const state=stateAt(index,relative(join.at));
  expect(state.devices).toHaveLength(2);
  expect(state.devices.find(d=>d.name==='optional')).toMatchObject({completed:0,connected:true});
 });
 test('preserves a departed device and its contribution, but removes it from the connected pool',()=>{
  const left=trace.events.find(e=>e.kind==='left')!;
  const state=stateAt(index,relative(left.at));
  expect(state.devices.find(d=>d.name==='optional')).toMatchObject({completed:638,connected:false,state:'stopped'});
  expect(state.devices.filter(d=>d.connected)).toHaveLength(2);
 });
 test('tracks a released task across different attempts and workers',()=>{
  expect(index.handoffs).toHaveLength(1);
  expect(index.handoffs[0]).toMatchObject({fromName:'optional',toName:'cindy-mac',claimDelayMs:28,completionDelayMs:1016});
  expect(index.handoffs[0].releasedLeaseId).not.toBe(index.handoffs[0].claimedLeaseId);
 });
 test('all contributions agree with the accepted results and can be rewound',()=>{
  const final=stateAt(index,index.durationMs);
  expect(index.durationMs).toBe(533243);
  expect(final.progress).toMatchObject({fresh:3000,cached:0,queued:0,leased:0,failed:0,canceled:0});
  expect(final.devices.map(d=>d.completed)).toEqual([1769,638,593]);
  expect(stateAt(index,0).devices).toHaveLength(1);
  expect(stateAt(index,-1000).progress.fresh).toBe(0);
  expect(stateAt(index,Infinity).progress.fresh).toBe(3000);
 });
 test('reconciles counts at every checkpoint without counting accepted results twice',()=>{
  for(const frame of trace.frames){
   const s=stateAt(index,relative(frame.at));
   // At an equal millisecond, later events may already be visible. Compare with all accepted events through that time.
   const n=trace.events.filter(e=>e.kind==='accepted'&&e.at<=Math.min(frame.at,timing.finishedAt)).length;
   expect(s.progress.fresh).toBe(n);
   expect(s.devices.reduce((sum,d)=>sum+d.completed,0)).toBe(n);
   expect(s.progress.queued+s.progress.leased+s.progress.fresh+s.progress.cached+s.progress.failed+s.progress.canceled).toBe(3000);
  }
 });
 test('does not mutate the source recording',()=>{
  expect(trace.frames[0].workers).toHaveLength(1);
  expect(trace.frames[0].progress.fresh).toBe(0);
 });
});

describe('recording boundaries beyond the bundled run',()=>{
 test('keeps cached work uncredited and marks a restart gap without plotting through it',async()=>{
  const {chartSeries}=await import('../../src/replay/model.ts');
  const fixture=structuredClone(trace);
  fixture.tasks=fixture.tasks.slice(0,2);
  Object.assign(fixture.tasks[0],{initialState:'completed',initialSource:'cache',initialResultId:'cached-result'});
  fixture.workers=fixture.workers.slice(0,1);
  const workerId=fixture.workers[0].workerId;
  const initial={planned:2,fresh:0,cached:1,queued:1,leased:0,failed:0,canceled:0,retries:0};
  const finished={...initial,fresh:1,queued:0};
  const worker={...fixture.frames[0].workers[0],completed:0,credits:0,activeTaskIds:[]};
  fixture.frames=[
   {seq:1,at:1000,eventCursor:0,reason:'initial',progress:initial,workers:[worker]},
   {seq:2,at:3000,eventCursor:1,reason:'checkpoint',progress:finished,workers:[{...worker,completed:1,credits:1}]},
   {seq:3,at:8000,eventCursor:2,reason:'resume',progress:finished,workers:[{...worker,completed:1,credits:1}]},
  ];
  fixture.events=[
   {seq:1,at:3000,kind:'accepted',workerId,taskId:fixture.tasks[1].taskId,data:{taskState:'completed',source:'computed'}},
   {seq:2,at:8000,kind:'recording_resumed',workerId:null,taskId:null,data:{gapFrom:3000,gapTo:8000}},
  ];
  fixture.recording={available:true,startedAt:1000,endedAt:10000,hasGaps:true,eventCount:2,frameCount:3};
  const replay=createReplay(fixture);
  expect(stateAt(replay,0).progress.cached).toBe(1);
  expect(stateAt(replay,0).devices[0].completed).toBe(0);
  expect(stateAt(replay,5000)).toMatchObject({gap:true,progress:{fresh:1,cached:1}});
  expect(stateAt(replay,9000).gap).toBe(false);
  const series=chartSeries(replay,stateAt(replay,9000));
  expect(series).toHaveLength(2);
  expect(series[0].at(-1)!.elapsed).toBe(2000);
  expect(series[1][0].elapsed).toBe(7000);
 });
});

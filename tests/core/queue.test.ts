// tests/core/queue.test.ts
import { expect, test } from "vitest";
import { fixture, testRegistration, submission } from "../fixtures/core.ts";
test("失联重分配、迟到拒绝、成功重放不重复结算", () => {
  const f=fixture(); const {experimentId}=f.store.create(f.input);
  const a=f.store.register({...testRegistration,name:"a"});
  const b=f.store.register({...testRegistration,name:"b"});
  const first=f.store.claim(a.workerId)!;
  expect(f.store.claim(a.workerId)?.leaseId).toBe(first.leaseId);
  expect(f.store.claim(b.workerId)).toBeNull();
  f.advance(20_001); f.store.sweep();
  f.store.heartbeat(b.workerId,{state:"ready",level:"high",lease:null});
  const second=f.store.claim(b.workerId)!;
  expect(second.taskId).toBe(first.taskId);
  expect(second.leaseId).not.toBe(first.leaseId);
  expect(() => f.store.accept(a.workerId,submission(first))).toThrow();
  const receipt=f.store.accept(b.workerId,submission(second));
  f.advance(200_000);
  expect(f.store.accept(b.workerId,submission(second))).toEqual(receipt);
  const snapshot=f.store.snapshot(experimentId);
  expect(snapshot.fresh).toBe(1);
  expect(snapshot.workers.reduce((n,w)=>n+w.credits,0)).toBe(1);
  f.store.close();
});

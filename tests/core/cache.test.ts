// tests/core/cache.test.ts
import { expect, test } from "vitest";
import { fixture, testRegistration, submission } from "../fixtures/core.ts";
test("缓存复用不增积分，基准强制计算且不写缓存", () => {
  const f=fixture(); const w=f.store.register(testRegistration);
  const first=f.store.create(f.input);
  const lease=f.store.claim(w.workerId)!;
  f.store.accept(w.workerId,submission(lease));
  const reused=f.store.create(f.input);
  expect(reused.preview.cached).toBe(1);
  expect(f.store.snapshot(reused.experimentId).fresh).toBe(0);
  const bench=f.store.create({...f.input,mode:"benchmark",benchmark:{policy:"dynamic",workerIds:[w.workerId],held:true}});
  expect(bench.preview.cached).toBe(0);
  expect(f.store.claim(w.workerId)).toBeNull();
  f.store.start(bench.experimentId);
  const bl=f.store.claim(w.workerId)!;
  expect(f.store.accept(w.workerId,submission(bl)).credit).toBe(0);
  expect(f.store.snapshot(first.experimentId).fresh).toBe(1);
  f.store.close();
});

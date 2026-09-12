import { expect, test } from "vitest";
import { SubmitSchema } from "../../src/shared/schemas.ts";
const input = {
  experimentId: "e1", taskId: "t1", leaseId: "l1", workerId: "w1",
  inferenceKey: "a".repeat(64), backend: "cpu",
  output: {text: "", finishReason: "stop", inputTokens: 10, outputTokens: 0, inferenceMs: 25},
};
test("空回答是可评分结果，非法耗时不是", () => {
  expect(SubmitSchema.safeParse(input).success).toBe(true);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, inferenceMs: -1}}).success).toBe(false);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, inferenceMs: Infinity}}).success).toBe(false);
  expect(SubmitSchema.safeParse({...input, output: {...input.output, text: "字".repeat(22000)}}).success).toBe(false);
});

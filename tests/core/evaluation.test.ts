import { expect, test } from "vitest";
import type { RuntimeLock, Sample, Variant } from "../../src/shared/contracts.ts";
import { normalizeRow, parseJsonl } from "../../src/domain/dataset.ts";
import { hashJson, workKey } from "../../src/domain/keys.ts";
import { defaultVariants, renderMessages } from "../../src/domain/prompts.ts";
import { scoreAnswer } from "../../src/domain/score.ts";

const raw = {
  id: "q1",
  question: "Which is liquid?",
  choices: [
    { label: "1", text: "Ice" },
    { label: "2", text: "Water" },
  ],
  answerKey: "2",
};

const runtime: RuntimeLock = {
  adapterVersion: "llama-completion-v1",
  modelRepo: "test/model",
  modelRevision: "1".repeat(40),
  modelFile: "test.gguf",
  modelSha256: "2".repeat(64),
  engineVersion: "test-only",
  chatTemplateSha256: "3".repeat(64),
  generation: {
    contextSize: 2048,
    maxTokens: 128,
    temperature: 0,
    seed: 42,
    cachePrompt: false,
  },
  inferenceKey: "4".repeat(64),
  artifacts: [],
};

test("numeric labels are normalized while answers and format are scored separately", () => {
  const sample = normalizeRow(raw, 1);

  expect(sample.answerKey).toBe("B");
  expect(sample.originalLabels).toEqual(["1", "2"]);
  expect(sample.choices).toEqual([
    { label: "A", text: "Ice" },
    { label: "B", text: "Water" },
  ]);
  expect(scoreAnswer("Because it flows.\nANSWER: B", sample, "answer-only")).toEqual({
    answer: "B",
    correct: true,
    formatOk: false,
  });
  expect(scoreAnswer("ANSWER: Z", sample, "explanation")).toEqual({
    answer: null,
    correct: false,
    formatOk: false,
  });
});

test("answer parsing requires a strict final non-empty answer line", () => {
  const sample = normalizeRow(raw, 1);

  expect(scoreAnswer("  ANSWER: B\r\n", sample, "answer-only")).toEqual({
    answer: "B",
    correct: true,
    formatOk: true,
  });
  expect(scoreAnswer("ANSWER: A", sample, "answer-only")).toEqual({
    answer: "A",
    correct: false,
    formatOk: true,
  });
  expect(scoreAnswer("ANSWER: B\ntrailing words", sample, "explanation")).toEqual({
    answer: null,
    correct: false,
    formatOk: false,
  });
  expect(scoreAnswer("answer: B", sample, "explanation")).toEqual({
    answer: null,
    correct: false,
    formatOk: false,
  });
  expect(scoreAnswer("", sample, "answer-only")).toEqual({
    answer: null,
    correct: false,
    formatOk: false,
  });
});

test("JSONL parsing ignores blank lines but reports original line numbers", () => {
  const valid = JSON.stringify(raw);
  expect(parseJsonl(`\uFEFF${valid}\n\n${JSON.stringify({ ...raw, id: "q2" })}\n`)).toHaveLength(2);

  expect(() => parseJsonl(`${valid}\n\n{bad json}`)).toThrowError(
    expect.objectContaining({ code: "VALIDATION", line: 3 }),
  );
  expect(() => parseJsonl(`${valid}\n\n${valid}`)).toThrowError(
    expect.objectContaining({ code: "VALIDATION", line: 3 }),
  );
});

test("dataset validation rejects duplicate labels, absent answers, and empty input", () => {
  expect(() =>
    normalizeRow(
      { ...raw, choices: [{ label: "x", text: "Ice" }, { label: "x", text: "Water" }] },
      7,
    ),
  ).toThrowError(expect.objectContaining({ code: "VALIDATION", line: 7 }));
  expect(() => normalizeRow({ ...raw, answerKey: "missing" }, 9)).toThrowError(
    expect.objectContaining({ code: "VALIDATION", line: 9 }),
  );
  expect(() => parseJsonl("\n\r\n")).toThrowError(expect.objectContaining({ code: "VALIDATION" }));
});

test("messages expose demonstration answers but never the evaluated gold answer", () => {
  const sample = normalizeRow(raw, 1);
  const example = normalizeRow({ ...raw, id: "example", answerKey: "1" }, 1);
  const variant: Variant = {
    id: "B",
    name: "Two examples",
    instruction: "Return the answer.",
    examples: [example],
    responseMode: "answer-only",
  };

  const messages = renderMessages(sample, variant);
  expect(messages).toEqual([
    { role: "system", content: "Return the answer." },
    { role: "user", content: "Which is liquid?\nA. Ice\nB. Water" },
    { role: "assistant", content: "ANSWER: A" },
    { role: "user", content: "Which is liquid?\nA. Ice\nB. Water" },
  ]);
  expect(messages.at(-1)?.content).not.toContain(`ANSWER: ${sample.answerKey}`);
});

test("default variants require the two fixed examples", () => {
  const first = normalizeRow({ ...raw, id: "example-1" }, 1);
  const second = normalizeRow({ ...raw, id: "example-2", answerKey: "1" }, 2);

  expect(() => defaultVariants([])).toThrow("需要两道固定示例");
  expect(() => defaultVariants([first])).toThrow("需要两道固定示例");
  expect(() => defaultVariants([first, second, first])).toThrow("需要两道固定示例");

  const variants = defaultVariants([first, second]);
  expect(variants.map(({ id, responseMode, examples }) => ({ id, responseMode, examples: examples.length }))).toEqual([
    { id: "A", responseMode: "answer-only", examples: 0 },
    { id: "B", responseMode: "answer-only", examples: 2 },
    { id: "C", responseMode: "explanation", examples: 0 },
  ]);
});

test("canonical JSON hashing is key-order independent and rejects non-JSON values", () => {
  expect(hashJson({ b: [true, null, 2], a: "x" })).toBe(
    hashJson({ a: "x", b: [true, null, 2] }),
  );
  expect(hashJson({ b: [true, null, 2], a: "x" })).toMatch(/^[a-f0-9]{64}$/);
  expect(() => hashJson({ missing: undefined })).toThrow(TypeError);
  expect(() => hashJson(Number.NaN)).toThrow(TypeError);
});

test("work identity excludes the evaluated gold answer and includes generation inputs", () => {
  const sample = normalizeRow(raw, 1);
  const variant: Variant = {
    id: "A",
    name: "Direct answer",
    instruction: "Return exactly one answer line.",
    examples: [],
    responseMode: "answer-only",
  };
  const initial = workKey(sample, variant, runtime);
  const rescored: Sample = { ...sample, answerKey: "A" };

  expect(workKey(rescored, variant, runtime)).toBe(initial);
  expect(workKey({ ...sample, question: `${sample.question}!` }, variant, runtime)).not.toBe(initial);
  expect(workKey(sample, { ...variant, instruction: `${variant.instruction} Now.` }, runtime)).not.toBe(initial);
  expect(workKey(sample, variant, { ...runtime, inferenceKey: "5".repeat(64) })).not.toBe(initial);
  expect(
    workKey(sample, variant, {
      ...runtime,
      generation: { ...runtime.generation, cachePrompt: true },
    } as unknown as RuntimeLock),
  ).not.toBe(initial);
});

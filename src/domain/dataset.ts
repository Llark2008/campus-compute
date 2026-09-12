import { DomainError } from "../shared/errors.ts";
import { LIMITS } from "../shared/limits.ts";
import { RawSampleSchema } from "../shared/schemas.ts";
import type { Sample } from "../shared/contracts.ts";

export function normalizeRow(raw: unknown, line: number): Sample {
  const parsed = RawSampleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "题目格式无效", line);
  }

  const value = parsed.data;
  const originalLabels = value.choices.map((choice) => choice.label);
  const answerIndex = originalLabels.indexOf(value.answerKey);
  if (new Set(originalLabels).size !== originalLabels.length || answerIndex < 0) {
    throw new DomainError("VALIDATION", "标签重复或答案不存在", line);
  }

  return {
    id: value.id,
    question: value.question,
    choices: value.choices.map((choice, index) => ({
      label: String.fromCharCode(65 + index),
      text: choice.text,
    })),
    answerKey: String.fromCharCode(65 + answerIndex),
    originalLabels,
  };
}

export function parseJsonl(text: string): Sample[] {
  if (Buffer.byteLength(text, "utf8") > LIMITS.maxDatasetBytes) {
    throw new DomainError("VALIDATION", "文件超过 2 MB");
  }

  const samples: Sample[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const [index, sourceLine] of lines.entries()) {
    if (!sourceLine.trim()) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(sourceLine);
    } catch {
      throw new DomainError("VALIDATION", "无效 JSON", index + 1);
    }

    const sample = normalizeRow(raw, index + 1);
    if (seen.has(sample.id)) {
      throw new DomainError("VALIDATION", "题目 ID 重复", index + 1);
    }
    seen.add(sample.id);
    samples.push(sample);

    if (samples.length > LIMITS.maxSamples) {
      throw new DomainError("VALIDATION", `题目超过 ${LIMITS.maxSamples}`, index + 1);
    }
  }

  if (samples.length === 0) {
    throw new DomainError("VALIDATION", "题库为空");
  }
  return samples;
}

import { createHash } from "node:crypto";
import type { PublicSample, RuntimeLock, Variant } from "../shared/contracts.ts";
import { renderMessages } from "./prompts.ts";

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("哈希输入不是有限 JSON 值");
  }
  if (ancestors.has(value)) {
    throw new TypeError("哈希输入包含循环引用");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("哈希输入不是有限 JSON 值");
        }
        items.push(canonical(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("哈希输入不是有限 JSON 值");
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function workKey(
  sample: PublicSample,
  variant: Variant,
  runtime: RuntimeLock,
): string {
  return hashJson({
    question: sample.question,
    choices: sample.choices,
    messages: renderMessages(sample, variant),
    inferenceKey: runtime.inferenceKey,
    generation: runtime.generation,
  });
}

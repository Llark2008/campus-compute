import type { ResponseMode, Sample, Score } from "../shared/contracts.ts";

export function scoreAnswer(text: string, sample: Sample, mode: ResponseMode): Score {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const lastLine = lines.at(-1) ?? "";
  const parsedLabel = /^ANSWER: ([A-H])$/.exec(lastLine)?.[1] ?? null;
  const answer = sample.choices.some((choice) => choice.label === parsedLabel)
    ? parsedLabel
    : null;

  return {
    answer,
    correct: answer === sample.answerKey,
    formatOk: answer !== null && (mode === "explanation" || trimmed === lastLine),
  };
}

import type { Message, PublicSample, Sample, Variant } from "../shared/contracts.ts";

function questionText(sample: PublicSample): string {
  const choices = sample.choices.map((choice) => `${choice.label}. ${choice.text}`).join("\n");
  return `${sample.question}\n${choices}`;
}

export function renderMessages(sample: PublicSample, variant: Variant): Message[] {
  const messages: Message[] = [{ role: "system", content: variant.instruction }];
  for (const example of variant.examples) {
    messages.push(
      { role: "user", content: questionText(example) },
      { role: "assistant", content: `ANSWER: ${example.answerKey}` },
    );
  }
  messages.push({ role: "user", content: questionText(sample) });
  return messages;
}

export function defaultVariants(examples: Sample[]): Variant[] {
  if (examples.length !== 2) {
    throw new Error("需要两道固定示例");
  }

  const answerOnlyInstruction =
    "Answer the science multiple-choice question. Return exactly one line: ANSWER: X, where X is the chosen option label.";
  return [
    {
      id: "A",
      name: "Direct answer",
      instruction: answerOnlyInstruction,
      examples: [],
      responseMode: "answer-only",
    },
    {
      id: "B",
      name: "Two examples",
      instruction: answerOnlyInstruction,
      examples,
      responseMode: "answer-only",
    },
    {
      id: "C",
      name: "Brief explanation",
      instruction:
        "Answer the science multiple-choice question. Explain briefly in one or two sentences. End with a separate line: ANSWER: X, where X is the chosen option label.",
      examples: [],
      responseMode: "explanation",
    },
  ];
}

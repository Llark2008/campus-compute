export const LIMITS = Object.freeze({
  heartbeatMs: 3_000, leaseMs: 20_000, sweepMs: 1_000,
  idlePollMs: 2_000, attemptMs: 120_000, maxFaults: 3,
  maxDatasetBytes: 2_000_000, maxSamples: 2_000,
  minChoices: 2, maxChoices: 8, maxQuestionChars: 4_000,
  maxChoiceChars: 1_000, maxVariants: 3, maxInstructionChars: 6_000,
  maxOutputBytes: 64_000, snapshotPollMs: 2_000,
  recordingFrameMs: 2_000,
  throughputWindowMs: 30_000,
});
export const GENERATION = Object.freeze({
  contextSize: 2048, maxTokens: 128, temperature: 0,
  seed: 42, cachePrompt: false,
} as const);

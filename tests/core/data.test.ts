import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parseJsonl } from "../../src/domain/dataset.ts";
import { hashJson } from "../../src/domain/keys.ts";
import type { Sample } from "../../src/shared/contracts.ts";

const dataDir = new URL("../../data/", import.meta.url);

test("the checked-in ARC demo is a validated fixed 200-item real-data selection", async () => {
  const [jsonl, lockText] = await Promise.all([
    readFile(new URL("arc-demo.jsonl", dataDir), "utf8"),
    readFile(new URL("dataset.lock.json", dataDir), "utf8"),
  ]);
  const samples = parseJsonl(jsonl);
  const lock = JSON.parse(lockText) as {
    dataset: string;
    config: string;
    validationCount: number;
    selectedCount: number;
    seed: number;
    algorithm: string;
    selectedIds: string[];
    demoSha256: string;
    license: string;
    revision: string;
  };

  expect(samples).toHaveLength(200);
  expect(new Set(samples.map((sample) => sample.id)).size).toBe(200);
  expect(lock).toMatchObject({
    dataset: "allenai/ai2_arc",
    config: "ARC-Challenge",
    validationCount: 299,
    selectedCount: 200,
    seed: 42,
    algorithm: "sha256-rank-v1",
    license: "CC BY-SA 4.0",
  });
  expect(lock.selectedIds).toEqual(samples.map((sample) => sample.id));
  expect(lock.demoSha256).toBe(createHash("sha256").update(jsonl).digest("hex"));
  expect(lock.demoSha256).toBe("6a86d0dd25163f080279e89fc6ce5654ce0dc2790408fc51cee5a7c2cf9ac5cc");
  expect(lock.revision).toBe(
    "viewer-snapshot:025fd851d163deb4af842a9851ce5f914bdf0809bbf6a0af45d5a983bab65084",
  );
});

test("the checked-in ARC snapshot contains all validation rows and the two fixed train examples", async () => {
  const [snapshotText, examplesText, lockText] = await Promise.all([
    readFile(new URL("arc-source.snapshot.json", dataDir), "utf8"),
    readFile(new URL("arc-examples.json", dataDir), "utf8"),
    readFile(new URL("dataset.lock.json", dataDir), "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotText) as {
    validation: unknown[];
    trainExamples: Array<{ id: string }>;
  };
  const examples = JSON.parse(examplesText) as Sample[];
  const lock = JSON.parse(lockText) as {
    snapshotSha256: string;
    snapshotFileSha256: string;
    exampleIds: string[];
  };
  const expectedIds = ["Mercury_SC_415702", "MCAS_2009_5_6516"];

  expect(snapshot.validation).toHaveLength(299);
  expect(snapshot.trainExamples.map((row) => row.id)).toEqual(expectedIds);
  expect(examples.map((sample) => sample.id)).toEqual(expectedIds);
  expect(examples.every((sample) => /^[A-H]$/.test(sample.answerKey))).toBe(true);
  expect(examples.every((sample) => sample.originalLabels.length === sample.choices.length)).toBe(true);
  expect(lock.exampleIds).toEqual(expectedIds);
  expect(lock.snapshotSha256).toBe(hashJson(snapshot));
  expect(lock.snapshotSha256).toBe("025fd851d163deb4af842a9851ce5f914bdf0809bbf6a0af45d5a983bab65084");
  expect(lock.snapshotFileSha256).toBe(
    createHash("sha256").update(snapshotText).digest("hex"),
  );
  expect(lock.snapshotFileSha256).toBe(
    "53c15c12e3b4ea897caedd212564787d78f00b2c660ddb23c58ec193f14905fe",
  );
});

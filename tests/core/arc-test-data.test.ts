import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { parseJsonl } from "../../src/domain/dataset.ts";
import { hashJson } from "../../src/domain/keys.ts";

const dataDir = new URL("../../data/", import.meta.url);
const TEST_COUNT = 1_172;
const SEED = 42;
const execFileAsync = promisify(execFile);

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("the checked-in ARC test dataset is the complete deterministic 1,172-row split", async () => {
  const [jsonl, snapshotText, lockText] = await Promise.all([
    readFile(new URL("arc-test.jsonl", dataDir), "utf8"),
    readFile(new URL("arc-test-source.snapshot.json", dataDir), "utf8"),
    readFile(new URL("arc-test.lock.json", dataDir), "utf8"),
  ]);
  const samples = parseJsonl(jsonl);
  const snapshot = JSON.parse(snapshotText) as { test: Array<{ id: string }> };
  const lock = JSON.parse(lockText) as {
    dataset: string;
    config: string;
    split: string;
    numRowsTotal: number;
    downloadedCount: number;
    selectedCount: number;
    seed: number;
    algorithm: string;
    selectedIds: string[];
    requestedUrls: string[];
    datasetSha256: string;
    snapshotSha256: string;
    snapshotFileSha256: string;
    revision: string;
    license: string;
    licenseSpdx: string;
  };

  expect(lock).toMatchObject({
    dataset: "allenai/ai2_arc",
    config: "ARC-Challenge",
    split: "test",
    numRowsTotal: TEST_COUNT,
    downloadedCount: TEST_COUNT,
    selectedCount: TEST_COUNT,
    seed: SEED,
    algorithm: "sha256-rank-v1",
    license: "CC BY-SA 4.0",
    licenseSpdx: "CC-BY-SA-4.0",
  });
  expect(snapshot.test).toHaveLength(TEST_COUNT);
  expect(samples).toHaveLength(TEST_COUNT);
  expect(new Set(snapshot.test.map((row) => row.id)).size).toBe(TEST_COUNT);
  expect(new Set(samples.map((sample) => sample.id)).size).toBe(TEST_COUNT);
  expect(lock.selectedIds).toEqual(samples.map((sample) => sample.id));
  expect(lock.selectedIds).toEqual(
    [...snapshot.test]
      .sort((left, right) =>
        hashJson([SEED, left.id]).localeCompare(hashJson([SEED, right.id])),
      )
      .map((row) => row.id),
  );
  expect(lock.requestedUrls).toHaveLength(12);
  expect(lock.requestedUrls.at(0)).toContain("offset=0&length=100");
  expect(lock.requestedUrls.at(-1)).toContain("offset=1100&length=100");
  expect(lock.datasetSha256).toBe(sha256(jsonl));
  expect(lock.datasetSha256).toBe(
    "0f846a8ceb817a24ec58e55d6c87ecfe9b5439cf6cd1eb6fadd0f2279711090d",
  );
  expect(lock.snapshotSha256).toBe(hashJson(snapshot));
  expect(lock.snapshotSha256).toBe(
    "ca9c6326c1b31cc0f0186f007ba5f9ef1041e097f58dd4c424cff80a5e5b418e",
  );
  expect(lock.snapshotFileSha256).toBe(sha256(snapshotText));
  expect(lock.snapshotFileSha256).toBe(
    "a70bc85bc1370c2d094ddefdbef3893deb6dc6262d229fe240fe7b229b325086",
  );
  expect(lock.revision).toBe(
    "viewer-snapshot:ca9c6326c1b31cc0f0186f007ba5f9ef1041e097f58dd4c424cff80a5e5b418e",
  );
  expect(samples.length * 3).toBe(3_516);
});

test("the preparation command rebuilds from the pinned snapshot without changing provenance", async () => {
  const lockUrl = new URL("arc-test.lock.json", dataDir);
  const before = await readFile(lockUrl, "utf8");
  const projectDir = fileURLToPath(new URL("../../", import.meta.url));
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-arc-test.ts"],
    { cwd: projectDir },
  );

  expect(JSON.parse(stdout)).toMatchObject({
    mode: "snapshot",
    downloaded: TEST_COUNT,
    selected: TEST_COUNT,
  });
  expect(await readFile(lockUrl, "utf8")).toBe(before);
});

test("the ARC test split does not overlap the fixed validation set or train examples", async () => {
  const [testText, originalSnapshotText] = await Promise.all([
    readFile(new URL("arc-test.jsonl", dataDir), "utf8"),
    readFile(new URL("arc-source.snapshot.json", dataDir), "utf8"),
  ]);
  const testIds = new Set(parseJsonl(testText).map((sample) => sample.id));
  const originalSnapshot = JSON.parse(originalSnapshotText) as {
    validation: Array<{ id: string }>;
    trainExamples: Array<{ id: string }>;
  };
  const comparisonIds = [
    ...originalSnapshot.validation.map((sample) => sample.id),
    ...originalSnapshot.trainExamples.map((sample) => sample.id),
  ];

  expect(comparisonIds).toHaveLength(301);
  expect(comparisonIds.filter((id) => testIds.has(id))).toEqual([]);
});

test("the original validation artifacts stay byte-identical", async () => {
  const artifacts = [
    ["arc-demo.jsonl", "6a86d0dd25163f080279e89fc6ce5654ce0dc2790408fc51cee5a7c2cf9ac5cc"],
    ["arc-examples.json", "42df7940939b0454f6c9bed73670bbb458a15644e948602a227dd4943d04ace3"],
    ["arc-source.snapshot.json", "53c15c12e3b4ea897caedd212564787d78f00b2c660ddb23c58ec193f14905fe"],
    ["dataset.lock.json", "9fcff11ea742108af5b19b99d54e2162c951566155c738603cf1a8bc4398f6a6"],
  ] as const;

  for (const [name, expected] of artifacts) {
    expect(sha256(await readFile(new URL(name, dataDir), "utf8"))).toBe(expected);
  }
});

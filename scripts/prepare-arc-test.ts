import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseJsonl } from "../src/domain/dataset.ts";
import { hashJson } from "../src/domain/keys.ts";

const DATASET = "allenai/ai2_arc";
const CONFIG = "ARC-Challenge";
const SPLIT = "test";
const SOURCE = "https://huggingface.co/datasets/allenai/ai2_arc";
const ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows";
const EXPECTED_COUNT = 1_172;
const PAGE_LENGTH = 100;
const SEED = 42;
const dataDirectory = new URL("../data/", import.meta.url);

interface ArcRow {
  id: string;
  question: string;
  choices: { label: string[]; text: string[] };
  answerKey: string;
}

interface ViewerRow {
  row_idx: number;
  row: ArcRow;
  truncated_cells?: string[];
}

interface ViewerPage {
  rows: ViewerRow[];
  num_rows_total: number;
  partial: boolean;
}

interface ArcTestLock {
  schemaVersion: number;
  dataset: string;
  config: string;
  source: string;
  rowsEndpoint: string;
  requestedUrls: string[];
  downloadedAt: string;
  revision: string;
  license: string;
  licenseSpdx: string;
  split: string;
  numRowsTotal: number;
  downloadedCount: number;
  selectedCount: number;
  seed: number;
  algorithm: string;
  selectedIds: string[];
  datasetSha256: string;
  snapshotSha256: string;
  snapshotFileSha256: string;
}

function pageUrl(offset: number): string {
  const query = new URLSearchParams({
    dataset: DATASET,
    config: CONFIG,
    split: SPLIT,
    offset: String(offset),
    length: String(PAGE_LENGTH),
  });
  return `${ROWS_ENDPOINT}?${query}`;
}

const requestedUrls = Array.from(
  { length: Math.ceil(EXPECTED_COUNT / PAGE_LENGTH) },
  (_, page) => pageUrl(page * PAGE_LENGTH),
);

function expectedPageLength(offset: number): number {
  return Math.min(PAGE_LENGTH, EXPECTED_COUNT - offset);
}

async function fetchPage(url: string, offset: number): Promise<ArcRow[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`ARC test download at offset ${offset}: ${response.status}`);
  }

  const page = (await response.json()) as ViewerPage;
  if (
    !page ||
    !Array.isArray(page.rows) ||
    page.num_rows_total !== EXPECTED_COUNT ||
    page.partial !== false ||
    page.rows.length !== expectedPageLength(offset)
  ) {
    throw new Error(`ARC test page ${offset} is incomplete or the dataset version changed`);
  }

  for (const [index, entry] of page.rows.entries()) {
    if (
      !entry ||
      entry.row_idx !== offset + index ||
      !entry.row ||
      !Array.isArray(entry.truncated_cells) ||
      entry.truncated_cells.length > 0
    ) {
      throw new Error(`ARC test page ${offset} contains an invalid or truncated row`);
    }
  }
  return page.rows.map((entry) => entry.row);
}

function toInput(row: ArcRow): unknown {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.question !== "string" ||
    typeof row.answerKey !== "string" ||
    !row.choices ||
    !Array.isArray(row.choices.label) ||
    !Array.isArray(row.choices.text) ||
    row.choices.label.length !== row.choices.text.length ||
    !row.choices.label.every((label) => typeof label === "string") ||
    !row.choices.text.every((text) => typeof text === "string")
  ) {
    throw new Error(`Invalid ARC test row: ${row?.id ?? "unknown"}`);
  }
  return {
    id: row.id,
    question: row.question,
    choices: row.choices.label.map((label, index) => ({
      label,
      text: row.choices.text[index],
    })),
    answerKey: row.answerKey,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function validateRows(test: ArcRow[]): void {
  if (test.length !== EXPECTED_COUNT) {
    throw new Error(`ARC test split has ${test.length} rows; expected ${EXPECTED_COUNT}`);
  }
  if (new Set(test.map((row) => row.id)).size !== EXPECTED_COUNT) {
    throw new Error("ARC test split contains duplicate IDs");
  }
  test.forEach((row) => toInput(row));
}

function buildDataset(test: ArcRow[]): { jsonl: string; selectedIds: string[] } {
  validateRows(test);
  const ranked = test
    .map((row) => ({ row, rank: hashJson([SEED, row.id]) }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map(({ row }) => row);
  const jsonl = `${ranked.map((row) => JSON.stringify(toInput(row))).join("\n")}\n`;
  const normalized = parseJsonl(jsonl);
  if (normalized.length !== EXPECTED_COUNT) {
    throw new Error("Normalized ARC test dataset failed validation");
  }
  return { jsonl, selectedIds: normalized.map((sample) => sample.id) };
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function rebuildFromSnapshot(): Promise<{ test: ArcRow[]; lock: ArcTestLock }> {
  let snapshotText: string;
  let lockText: string;
  try {
    [snapshotText, lockText] = await Promise.all([
      readFile(new URL("arc-test-source.snapshot.json", dataDirectory), "utf8"),
      readFile(new URL("arc-test.lock.json", dataDirectory), "utf8"),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Pinned ARC test snapshot is missing; run with --download to create it");
    }
    throw error;
  }

  const snapshot = JSON.parse(snapshotText) as { test?: ArcRow[] };
  const lock = JSON.parse(lockText) as ArcTestLock;
  if (!snapshot || !Array.isArray(snapshot.test)) {
    throw new Error("Pinned ARC test snapshot has an invalid shape");
  }
  const test = snapshot.test;
  validateRows(test);
  const snapshotValue = { test };
  if (
    lock.schemaVersion !== 1 ||
    lock.dataset !== DATASET ||
    lock.config !== CONFIG ||
    lock.source !== SOURCE ||
    lock.rowsEndpoint !== ROWS_ENDPOINT ||
    lock.split !== SPLIT ||
    lock.numRowsTotal !== EXPECTED_COUNT ||
    lock.downloadedCount !== EXPECTED_COUNT ||
    lock.selectedCount !== EXPECTED_COUNT ||
    lock.seed !== SEED ||
    lock.algorithm !== "sha256-rank-v1" ||
    lock.license !== "CC BY-SA 4.0" ||
    lock.licenseSpdx !== "CC-BY-SA-4.0" ||
    !sameStrings(lock.requestedUrls, requestedUrls) ||
    lock.snapshotSha256 !== hashJson(snapshotValue) ||
    lock.snapshotFileSha256 !== sha256(snapshotText) ||
    lock.revision !== `viewer-snapshot:${lock.snapshotSha256}`
  ) {
    throw new Error("Pinned ARC test snapshot does not match its lock provenance");
  }

  const built = buildDataset(test);
  if (
    lock.datasetSha256 !== sha256(built.jsonl) ||
    !sameStrings(lock.selectedIds, built.selectedIds)
  ) {
    throw new Error("Pinned ARC test dataset does not reproduce its locked selection");
  }
  const datasetUrl = new URL("arc-test.jsonl", dataDirectory);
  let existing: string | null = null;
  try { existing = await readFile(datasetUrl, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // A verified rebuild of unchanged data must not truncate a file other readers use.
  if (existing !== built.jsonl) await writeFile(datasetUrl, built.jsonl, "utf8");
  return { test, lock };
}

async function downloadSnapshot(): Promise<{ test: ArcRow[]; lock: ArcTestLock }> {
  const pages = await Promise.all(
    requestedUrls.map((url, page) => fetchPage(url, page * PAGE_LENGTH)),
  );
  const test = pages.flat();
  const built = buildDataset(test);

  const snapshot = { test };
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const snapshotSha256 = hashJson(snapshot);
  const lock: ArcTestLock = {
    schemaVersion: 1,
    dataset: DATASET,
    config: CONFIG,
    source: SOURCE,
    rowsEndpoint: ROWS_ENDPOINT,
    requestedUrls,
    downloadedAt: new Date().toISOString(),
    revision: `viewer-snapshot:${snapshotSha256}`,
    license: "CC BY-SA 4.0",
    licenseSpdx: "CC-BY-SA-4.0",
    split: SPLIT,
    numRowsTotal: EXPECTED_COUNT,
    downloadedCount: test.length,
    selectedCount: built.selectedIds.length,
    seed: SEED,
    algorithm: "sha256-rank-v1",
    selectedIds: built.selectedIds,
    datasetSha256: sha256(built.jsonl),
    snapshotSha256,
    snapshotFileSha256: sha256(snapshotText),
  };
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;

  await mkdir(dataDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("arc-test.jsonl", dataDirectory), built.jsonl, "utf8"),
    writeFile(new URL("arc-test-source.snapshot.json", dataDirectory), snapshotText, "utf8"),
    writeFile(new URL("arc-test.lock.json", dataDirectory), lockText, "utf8"),
  ]);
  return { test, lock };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--download")) {
    throw new Error("Usage: prepare-arc-test.ts [--download]");
  }
  const mode = args[0] === "--download" ? "download" : "snapshot";
  const { test, lock } = mode === "download"
    ? await downloadSnapshot()
    : await rebuildFromSnapshot();

  console.log(
    JSON.stringify({
      mode,
      outputDirectory: fileURLToPath(dataDirectory),
      split: SPLIT,
      downloaded: test.length,
      selected: lock.selectedCount,
      pages: requestedUrls.length,
      revision: lock.revision,
    }),
  );
}

await main();

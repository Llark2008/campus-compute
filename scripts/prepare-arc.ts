import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeRow, parseJsonl } from "../src/domain/dataset.ts";
import { hashJson } from "../src/domain/keys.ts";

const DATASET = "allenai/ai2_arc";
const CONFIG = "ARC-Challenge";
const SOURCE = "https://huggingface.co/datasets/allenai/ai2_arc";
const ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows";
const EXAMPLE_IDS = ["Mercury_SC_415702", "MCAS_2009_5_6516"] as const;
const VALIDATION_COUNT = 299;
const SELECTED_COUNT = 200;
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
  row: ArcRow;
  truncated_cells?: string[];
}

interface ViewerPage {
  rows: ViewerRow[];
}

interface ExistingLock {
  selectedIds?: unknown;
}

const requestedUrls: string[] = [];

async function fetchRows(split: string, stopIds?: ReadonlySet<string>): Promise<ArcRow[]> {
  const rows: ArcRow[] = [];
  for (let offset = 0; ; offset += PAGE_LENGTH) {
    const query = new URLSearchParams({
      dataset: DATASET,
      config: CONFIG,
      split,
      offset: String(offset),
      length: String(PAGE_LENGTH),
    });
    const url = `${ROWS_ENDPOINT}?${query}`;
    requestedUrls.push(url);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`ARC download: ${response.status}`);
    }

    const page = (await response.json()) as ViewerPage;
    if (
      !Array.isArray(page.rows) ||
      page.rows.some(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          !entry.row ||
          (Array.isArray(entry.truncated_cells) && entry.truncated_cells.length > 0),
      )
    ) {
      throw new Error("ARC 页面无效或被截断");
    }

    rows.push(...page.rows.map((entry) => entry.row));
    if (stopIds && [...stopIds].every((id) => rows.some((row) => row.id === id))) {
      return rows;
    }
    if (page.rows.length < PAGE_LENGTH) {
      return rows;
    }
  }
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
    row.choices.label.length !== row.choices.text.length
  ) {
    throw new Error(`ARC 题目格式无效：${row?.id ?? "unknown"}`);
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

async function storedSelection(): Promise<string[] | null> {
  try {
    const text = await readFile(new URL("dataset.lock.json", dataDirectory), "utf8");
    const lock = JSON.parse(text) as ExistingLock;
    if (!Array.isArray(lock.selectedIds)) {
      throw new Error("现有数据清单缺少 selectedIds");
    }
    if (
      lock.selectedIds.length !== SELECTED_COUNT ||
      !lock.selectedIds.every((id): id is string => typeof id === "string") ||
      new Set(lock.selectedIds).size !== SELECTED_COUNT
    ) {
      throw new Error("现有数据清单的 selectedIds 无效");
    }
    return lock.selectedIds;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function main(): Promise<void> {
  const [validation, train] = await Promise.all([
    fetchRows("validation"),
    fetchRows("train", new Set(EXAMPLE_IDS)),
  ]);
  if (validation.length !== VALIDATION_COUNT) {
    throw new Error("验证集数量发生变化，先核对数据版本");
  }
  if (new Set(validation.map((row) => row.id)).size !== validation.length) {
    throw new Error("ARC 验证集包含重复 ID");
  }

  const trainExamples = EXAMPLE_IDS.map((id) => {
    const row = train.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`固定示例缺失：${id}`);
    return row;
  });

  const priorIds = await storedSelection();
  const selected = priorIds
    ? priorIds.map((id) => {
        const row = validation.find((candidate) => candidate.id === id);
        if (!row) throw new Error(`清单题目不在当前验证快照中：${id}`);
        return row;
      })
    : validation
        .map((row) => ({ row, rank: hashJson([SEED, row.id]) }))
        .sort((left, right) =>
          left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0,
        )
        .slice(0, SELECTED_COUNT)
        .map(({ row }) => row);

  const jsonl = `${selected.map((row) => JSON.stringify(toInput(row))).join("\n")}\n`;
  const normalizedDemo = parseJsonl(jsonl);
  if (normalizedDemo.length !== SELECTED_COUNT) {
    throw new Error("ARC 演示题库校验失败");
  }
  const normalizedExamples = trainExamples.map((row, index) =>
    normalizeRow(toInput(row), index + 1),
  );
  const examplesText = `${JSON.stringify(normalizedExamples, null, 2)}\n`;

  const snapshot = { validation, trainExamples };
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const snapshotSha256 = hashJson(snapshot);
  const lock = {
    schemaVersion: 1,
    dataset: DATASET,
    config: CONFIG,
    source: SOURCE,
    rowsEndpoint: ROWS_ENDPOINT,
    requestedUrls,
    downloadedAt: new Date().toISOString(),
    revision: `viewer-snapshot:${snapshotSha256}`,
    license: "CC BY-SA 4.0",
    validationSplit: "validation",
    validationCount: validation.length,
    exampleSplit: "train",
    exampleIds: [...EXAMPLE_IDS],
    selectedCount: normalizedDemo.length,
    seed: SEED,
    algorithm: "sha256-rank-v1",
    selectedIds: normalizedDemo.map((sample) => sample.id),
    demoSha256: sha256(jsonl),
    examplesSha256: sha256(examplesText),
    snapshotSha256,
    snapshotFileSha256: sha256(snapshotText),
  };
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;

  await mkdir(dataDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("arc-demo.jsonl", dataDirectory), jsonl, "utf8"),
    writeFile(new URL("arc-examples.json", dataDirectory), examplesText, "utf8"),
    writeFile(new URL("arc-source.snapshot.json", dataDirectory), snapshotText, "utf8"),
    writeFile(new URL("dataset.lock.json", dataDirectory), lockText, "utf8"),
  ]);

  console.log(
    JSON.stringify({
      outputDirectory: fileURLToPath(dataDirectory),
      validation: validation.length,
      selected: normalizedDemo.length,
      examples: normalizedExamples.map((sample) => sample.id),
      revision: lock.revision,
      reusedSelection: priorIds !== null,
    }),
  );
}

await main();

export type Level = "low" | "medium" | "high";
export type Backend = "metal" | "cuda" | "cpu";
export type Mode = "normal" | "benchmark";
export type ResponseMode = "answer-only" | "explanation";
export type TaskState = "queued" | "leased" | "completed" | "failed" | "canceled";
export type WorkerState = "initializing" | "ready" | "computing" | "uploading" |
  "resting" | "pausing" | "paused" | "stopping" | "stopped" | "error" | "offline";
export type ExperimentState = "queued" | "running" | "completed" |
  "completed-with-errors" | "canceled";
export type ErrorCode = "VALIDATION" | "UNAUTHORIZED" | "NOT_FOUND" |
  "LEASE_LOST" | "CONFIG_MISMATCH" | "INPUT_TOO_LONG" | "ENGINE_ERROR" |
  "EXECUTION_TIMEOUT" | "NETWORK" | "STOPPED";
export interface Choice { label: string; text: string }
export interface PublicSample { id: string; question: string; choices: Choice[] }
export interface Sample extends PublicSample {
  answerKey: string;
  originalLabels: string[];
}
export interface Variant {
  id: string; name: string; instruction: string;
  examples: Sample[]; responseMode: ResponseMode;
}
export interface Message { role: "system" | "user" | "assistant"; content: string }
export interface Generation {
  contextSize: 2048; maxTokens: 128; temperature: 0;
  seed: 42; cachePrompt: false;
}
export interface RuntimeLock {
  adapterVersion: "llama-completion-v1";
  modelRepo: string; modelRevision: string; modelFile: string;
  modelSha256: string; engineVersion: string; chatTemplateSha256: string;
  generation: Generation; inferenceKey: string;
  artifacts: { platform: string; arch: string; backend: Backend;
    binarySha256: string; executable: string; prefix: string[] }[];
}
export interface DatasetMeta {
  id: string; name: string; sha256: string; source: string;
  revision: string; license: string; sampleIds: string[];
}
export interface ImportInput { name: string; jsonl: string; source: string; revision: string; license: string }
export interface CreateInput {
  name: string; datasetId: string; sampleIds: string[];
  variants: Variant[]; mode: Mode;
  benchmark?: { policy: "dynamic" | "static"; workerIds: string[]; held: boolean };
}
export interface Preview { total: number; cached: number; fresh: number }
export interface Created { experimentId: string; ownerToken: string; preview: Preview }
export interface Registration {
  deviceId?: string;
  name: string; platform: string; arch: string; cpu: string; memoryBytes: number;
  backend: Backend; inferenceKey: string;
}
export interface WorkerSession { workerId: string; token: string }
export interface LeaseRef { experimentId: string; taskId: string; leaseId: string; workerId: string }
export interface Lease extends LeaseRef {
  inferenceKey: string; messages: Message[]; generation: Generation;
  remainingLeaseMs: number; remainingAttemptMs: number;
}
export interface InferenceOutput {
  text: string; finishReason: "stop" | "length";
  inputTokens: number; outputTokens: number; inferenceMs: number;
}
export interface SubmitInput extends LeaseRef {
  inferenceKey: string; backend: Backend; output: InferenceOutput;
}
export interface Receipt { taskId: string; resultId: string; acceptedAt: number; credit: number }
export interface FaultInput extends LeaseRef { code: ErrorCode; message: string }
export interface Heartbeat {
  state: WorkerState; level: Level; lease: LeaseRef | null;
}
export interface HeartbeatReply {
  leaseValid: boolean; remainingLeaseMs: number; remainingAttemptMs: number;
  receipt: Receipt | null;
}
export interface Score { answer: string | null; correct: boolean; formatOk: boolean }
export interface EventRow { id: number; at: number; kind: string; taskId: string | null; workerId: string | null; detail: string }
export interface PoolWorkerView extends Registration {
  id: string; state: WorkerState; level: Level; lastSeenAt: number;
}
export interface WorkerView extends PoolWorkerView {
  completed: number; credits: number;
}
export interface VariantSummary {
  id: string; received: number; planned: number; failed: number; truncated: number;
  commonCorrect: number; commonFormatOk: number;
}
export interface Snapshot {
  experimentId: string; name: string; mode: Mode; state: ExperimentState;
  planned: number; fresh: number; cached: number; leased: number;
  queued: number; failed: number; canceled: number; retries: number;
  commonCount: number; variants: VariantSummary[]; workers: WorkerView[];
  throughput: number; windowMs: number; etaSeconds: number | null;
  createdAt: number; elapsedMs: number; executionElapsedMs: number | null;
  workloadFingerprint: string; recording: RecordingStatus;
  startedAt: number | null; finishedAt: number | null; events: EventRow[];
}
export interface ReportRow {
  taskId: string; sampleId: string; variantId: string; state: TaskState;
  source: "computed" | "cache" | null; resultId: string | null;
  workerId: string | null; backend: Backend | null;
  output: InferenceOutput | null; score: Score | null;
  acceptedAt: number | null; error: string | null;
}
export interface AttemptRow {
  leaseId: string; taskId: string; workerId: string; state: string;
  startedAt: number; endedAt: number | null;
}
export interface Report {
  snapshot: Snapshot; dataset: DatasetMeta; samples: Sample[];
  variants: Variant[]; runtime: RuntimeLock; scoringVersion: "answer-line-v1";
  rows: ReportRow[]; attempts: AttemptRow[]; events: EventRow[];
}
export interface WorkerConfig {
  coordinatorUrl: string; joinCode: string; name: string; backend: Backend;
  engineBin: string; enginePrefix: string[]; modelPath: string;
  enginePort: number; controlPort: number; stateDir: string;
}
export type ControlCommand =
  { action: "configure"; coordinatorUrl: string; joinCode: string; name: string } |
  { action: "start" } | { action: "pause" } | { action: "exit" } |
  { action: "set-level"; level: Level };
export interface LocalStatus {
  state: WorkerState; level: Level; workerId: string | null;
  taskId: string | null; enginePid: number | null;
  coordinatorUrl: string; name: string; backend: Backend;
  completed: number; lastError: string | null;
}

export interface RecordingStatus {
  available:boolean; startedAt:number|null; endedAt:number|null;
  eventCount:number; frameCount:number; hasGaps:boolean;
}
export interface TraceWorker extends Registration {
  workerId:string; deviceId:string; identityKind:'installation'|'session'; firstObservedAt:number;
}
export interface TraceEvent {
  seq:number; at:number; kind:string; workerId:string|null; taskId:string|null;
  data:Record<string,unknown>;
}
export interface TraceProgress {
  planned:number; fresh:number; cached:number; queued:number; leased:number;
  failed:number; canceled:number; retries:number;
}
export interface TraceFrame {
  seq:number; at:number; eventCursor:number;
  reason:'initial'|'periodic'|'terminal'|'resume'|'checkpoint'; progress:TraceProgress;
  workers:{workerId:string;deviceId:string;state:WorkerState;level:Level;lastSeenAt:number;completed:number;credits:number;activeTaskIds:string[]}[];
}
export interface ExperimentTrace {
  schemaVersion:1; scope:'group-pool-during-experiment'; timeUnit:'unix-ms'; frameIntervalMs:number;
  recording:RecordingStatus;
  experiment:{id:string;name:string;mode:Mode;datasetId:string;questionCount:number;promptCount:number;model:string;inferenceKey:string};
  tasks:{taskId:string;sampleId:string;variantId:string;ordinal:number;initialState:'queued'|'completed';initialSource:'cache'|null;initialResultId:string|null}[];
  workers:TraceWorker[];events:TraceEvent[];frames:TraceFrame[];
}

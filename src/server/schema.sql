PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, meta_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS samples (
  dataset_id TEXT NOT NULL REFERENCES datasets(id), id TEXT NOT NULL,
  sample_json TEXT NOT NULL, PRIMARY KEY(dataset_id,id)
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id),
  input_json TEXT NOT NULL, runtime_json TEXT NOT NULL, owner_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('normal','benchmark')),
  held INTEGER NOT NULL DEFAULT 0, canceled_at INTEGER,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  last_dispatch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
  registration_json TEXT NOT NULL, state TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'medium', last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
  sample_id TEXT NOT NULL, variant_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  work_key TEXT NOT NULL, messages_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','leased','completed','failed','canceled')),
  faults INTEGER NOT NULL DEFAULT 0, assigned_worker TEXT REFERENCES workers(id),
  source TEXT CHECK(source IN ('computed','cache')),
  result_id TEXT REFERENCES results(id), score_json TEXT, error TEXT,
  completed_at INTEGER, UNIQUE(experiment_id,sample_id,variant_id)
);
CREATE INDEX IF NOT EXISTS task_queue ON tasks(experiment_id,state,ordinal);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), state TEXT NOT NULL,
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS task_one_active ON attempts(task_id) WHERE state='active';
CREATE UNIQUE INDEX IF NOT EXISTS worker_one_active ON attempts(worker_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  lease_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), backend TEXT NOT NULL,
  output_json TEXT NOT NULL, receipt_json TEXT NOT NULL, accepted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS result_cache (
  work_key TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES results(id)
);
CREATE TABLE IF NOT EXISTS credits (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  worker_id TEXT NOT NULL REFERENCES workers(id), value INTEGER NOT NULL CHECK(value=1)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, experiment_id TEXT REFERENCES experiments(id),
  at INTEGER NOT NULL, kind TEXT NOT NULL, task_id TEXT, worker_id TEXT,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiment_recordings (
  experiment_id TEXT PRIMARY KEY REFERENCES experiments(id),
  started_at INTEGER NOT NULL, ended_at INTEGER,
  last_frame_at INTEGER, last_observed_at INTEGER NOT NULL, initial_tasks_json TEXT NOT NULL,
  has_gaps INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recording_workers (
  experiment_id TEXT NOT NULL REFERENCES experiment_recordings(experiment_id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES workers(id), metadata_json TEXT NOT NULL,
  PRIMARY KEY(experiment_id,worker_id)
);
CREATE TABLE IF NOT EXISTS recording_events (
  seq INTEGER PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiment_recordings(experiment_id) ON DELETE CASCADE,
  at INTEGER NOT NULL, kind TEXT NOT NULL, worker_id TEXT, task_id TEXT, data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recording_event_order ON recording_events(experiment_id,seq);
CREATE TABLE IF NOT EXISTS recording_frames (
  seq INTEGER PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiment_recordings(experiment_id) ON DELETE CASCADE,
  at INTEGER NOT NULL, frame_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recording_frame_order ON recording_frames(experiment_id,seq);

/**
 * SQLite-backed memory store (the default backend).
 *
 * Uses Node's built-in `node:sqlite` — no npm dependency, no native module to
 * compile — so the database starts with the plugin and installs cleanly for
 * anyone using it. One file holds every memory:
 *
 *   - `memories`: one row per memory, vectors as little-endian float32 BLOBs plus
 *     lifecycle fields (tier/revision/superseded_by/usage counters);
 *   - `memory_revisions`: append-only JSON snapshots for history and rollback;
 *   - `memories_fts`: FTS5 keyword index over pre-tokenized text. CJK text is
 *     split into bigrams first (the same tokenizer the in-memory backend uses)
 *     and stored space-separated, which makes the stock `unicode61` tokenizer
 *     work for Chinese instead of treating a whole sentence as one token;
 *   - `meta`: settings and schema version.
 *
 * Keyword retrieval runs in SQL (BM25 via FTS5). Vector retrieval still scans
 * the in-memory vector map exactly; an ANN index can be added on top later
 * without changing this contract.
 */
import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { tokenize } from './text.js'

const SCHEMA_VERSION = 7
const REVISION_KEEP = 20
const SETTINGS_META_KEY = 'settings'

const CREATE_MEMORIES = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace TEXT,
  session_id TEXT,
  tags TEXT NOT NULL,
  importance INTEGER NOT NULL,
  vec BLOB,
  model TEXT,
  dim INTEGER,
  hash TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  signature TEXT,
  tier TEXT NOT NULL DEFAULT 'semantic',
  revision INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  valid_from INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  review_reason TEXT,
  valid_until INTEGER
)`

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS memories_workspace ON memories(scope, workspace);
CREATE INDEX IF NOT EXISTS memories_session ON memories(scope, session_id)`

const CREATE_FTS = `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, tokens)`

const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS memory_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  run_id TEXT,
  duration_ms INTEGER,
  tokens INTEGER,
  calls INTEGER,
  count INTEGER,
  error TEXT,
  detail TEXT,
  session_id TEXT,
  workspace TEXT
);
CREATE INDEX IF NOT EXISTS memory_events_at ON memory_events(at DESC);
CREATE INDEX IF NOT EXISTS memory_events_kind ON memory_events(kind, at DESC)`

const CREATE_FEEDBACK = `
CREATE TABLE IF NOT EXISTS memory_feedback (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  memory_id TEXT NOT NULL,
  query_hash TEXT,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  detail TEXT,
  axis TEXT NOT NULL DEFAULT 'relevance'
);
CREATE INDEX IF NOT EXISTS memory_feedback_memory ON memory_feedback(memory_id, at DESC);
CREATE INDEX IF NOT EXISTS memory_feedback_at ON memory_feedback(at DESC)`

const CREATE_RECALLS = `
CREATE TABLE IF NOT EXISTS memory_recalls (
  recall_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  turn INTEGER,
  source TEXT NOT NULL,
  query_hash TEXT,
  memory_ids TEXT NOT NULL,
  config_hash TEXT,
  detail TEXT,
  reviewed_at INTEGER,
  query_vec BLOB,
  workspace TEXT
);
CREATE INDEX IF NOT EXISTS memory_recalls_session ON memory_recalls(session_id, at DESC);
CREATE INDEX IF NOT EXISTS memory_recalls_at ON memory_recalls(at DESC)`

const CREATE_QUALITY = `
CREATE TABLE IF NOT EXISTS memory_quality_daily (
  day TEXT PRIMARY KEY,
  metrics TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_CONFLICTS = `
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  similarity REAL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  detail TEXT,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS memory_conflicts_status ON memory_conflicts(status, at DESC);
CREATE INDEX IF NOT EXISTS memory_conflicts_new ON memory_conflicts(new_id);
CREATE INDEX IF NOT EXISTS memory_conflicts_old ON memory_conflicts(old_id)`

const CREATE_CONTEXT_FEEDBACK = `
CREATE TABLE IF NOT EXISTS memory_context_feedback (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  recall_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  workspace TEXT,
  query_vec BLOB,
  relevance REAL,
  rating TEXT,
  source TEXT,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS memory_context_feedback_memory ON memory_context_feedback(memory_id, at DESC);
CREATE INDEX IF NOT EXISTS memory_context_feedback_at ON memory_context_feedback(at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS memory_context_feedback_pair ON memory_context_feedback(recall_id, memory_id)`

const CREATE_REVISIONS = `
CREATE TABLE IF NOT EXISTS memory_revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_revisions_memory ON memory_revisions(memory_id, seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS memory_revisions_unique ON memory_revisions(memory_id, revision, action)`

const CREATE_GRAPH = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT,
  project TEXT,
  label TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS graph_edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  evidence TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (src, dst, relation)
);
CREATE INDEX IF NOT EXISTS graph_edges_src ON graph_edges(src);
CREATE INDEX IF NOT EXISTS graph_edges_dst ON graph_edges(dst);
CREATE TABLE IF NOT EXISTS extract_state (
  session_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT -1,
  project TEXT,
  last_run_at INTEGER NOT NULL DEFAULT 0
)`

const INSERT_SQL = `
INSERT OR REPLACE INTO memories
  (id, text, kind, scope, workspace, session_id, tags, importance, vec, model, dim, hash, source, created_at, updated_at, details, status, signature, tier, revision, superseded_by, valid_from, archived_at, last_used_at, use_count, helpful_count, quality_score, needs_review, review_reason, valid_until)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

export class SqliteStore {
  /**
   * @param {{ dataDir: string, logger?: { warn?: (message: string) => void } }} options
   */
  constructor({ dataDir, logger }) {
    this.dataDir = dataDir
    this.logger = logger
    /** @type {any} */
    this.db = null
    /** @type {Map<string, Record<string, any>>} */
    this.records = new Map()
    this.globalValue = {}
    this.statements = null
  }

  get size() {
    return this.records.size
  }

  get location() {
    return path.join(this.dataDir, 'memory.db')
  }

  /**
   * Upgrade older databases to schema v3. A backup is written before any
   * mutation; the upgrade itself runs in one transaction and records a baseline
   * revision snapshot for every existing memory.
   */
  migrateSchema() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(memories)').all().map((row) => row.name))
    const versionRow = this.db.prepare('PRAGMA user_version').get()
    const userVersion = typeof versionRow?.user_version === 'number' ? versionRow.user_version : 0
    if (userVersion >= SCHEMA_VERSION) return

    // v1 -> v2 columns.
    if (!columns.has('details')) this.db.exec('ALTER TABLE memories ADD COLUMN details TEXT')
    if (!columns.has('status')) this.db.exec("ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    if (!columns.has('signature')) this.db.exec('ALTER TABLE memories ADD COLUMN signature TEXT')

    // v2 -> v3 columns. Fresh databases already have them via CREATE_MEMORIES.
    if (!columns.has('tier')) this.db.exec("ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'semantic'")
    if (!columns.has('revision')) this.db.exec('ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
    if (!columns.has('superseded_by')) this.db.exec('ALTER TABLE memories ADD COLUMN superseded_by TEXT')
    if (!columns.has('valid_from')) this.db.exec('ALTER TABLE memories ADD COLUMN valid_from INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('archived_at')) this.db.exec('ALTER TABLE memories ADD COLUMN archived_at INTEGER')
    if (!columns.has('last_used_at')) this.db.exec('ALTER TABLE memories ADD COLUMN last_used_at INTEGER')
    if (!columns.has('use_count')) this.db.exec('ALTER TABLE memories ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('helpful_count')) this.db.exec('ALTER TABLE memories ADD COLUMN helpful_count INTEGER NOT NULL DEFAULT 0')
    // v3 -> v4: feedback-derived quality and the human review queue.
    if (!columns.has('quality_score')) this.db.exec('ALTER TABLE memories ADD COLUMN quality_score REAL NOT NULL DEFAULT 0')
    if (!columns.has('needs_review')) this.db.exec('ALTER TABLE memories ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('review_reason')) this.db.exec('ALTER TABLE memories ADD COLUMN review_reason TEXT')
    if (!columns.has('valid_until')) this.db.exec('ALTER TABLE memories ADD COLUMN valid_until INTEGER')
    this.db.exec(CREATE_REVISIONS)
    this.db.exec(CREATE_CONFLICTS)
    const conflictColumns = new Set(this.db.prepare('PRAGMA table_info(memory_conflicts)').all().map((row) => row.name))
    if (!conflictColumns.has('detail')) this.db.exec('ALTER TABLE memory_conflicts ADD COLUMN detail TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS memories_status ON memories(status)')
    this.db.exec('CREATE INDEX IF NOT EXISTS memories_tier ON memories(tier)')

    const existing = this.db.prepare('SELECT COUNT(*) AS count FROM memories').get()
    if ((existing?.count ?? 0) > 0) this.backupDatabase(userVersion)

    this.transaction(() => {
      this.db.exec(
        "UPDATE memories SET tier = CASE WHEN scope = 'session' THEN 'working' WHEN kind = 'summary' THEN 'episodic' ELSE 'semantic' END WHERE tier IS NULL OR tier = '' OR (tier = 'semantic' AND (scope = 'session' OR kind = 'summary'))",
      )
      this.db.exec('UPDATE memories SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = 0')
      this.db.exec('UPDATE memories SET revision = 1 WHERE revision IS NULL OR revision < 1')
      this.db.exec('UPDATE memories SET use_count = 0 WHERE use_count IS NULL')
      this.db.exec('UPDATE memories SET helpful_count = 0 WHERE helpful_count IS NULL')
      this.db.exec('UPDATE memories SET status = \'active\' WHERE status IS NULL')
      // Baseline revision so history/rollback starts from the pre-v3 state.
      const rows = this.db.prepare('SELECT * FROM memories').all()
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO memory_revisions (memory_id, revision, action, actor, reason, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const row of rows) {
        const record = rowToRecord(row)
        insert.run(
          record.id,
          record.revision ?? 1,
          'migrate',
          'system',
          `schema v${userVersion || 'pre3'} -> v${SCHEMA_VERSION}`,
          JSON.stringify(revisionSnapshot(record)),
          record.updatedAt,
        )
      }
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(JSON.stringify(SCHEMA_VERSION))
    })
    this.logger?.info?.(`dsh-memory: migrated database schema to v${SCHEMA_VERSION}`)
  }

  /**
   * Consistent copy of the database before migration. VACUUM INTO needs to run
   * outside a transaction, hence this is called before the upgrade.
   * @param {number} fromVersion
   */
  backupDatabase(fromVersion) {
    return this.backup(`v${fromVersion || 'pre3'}`, 5)
  }

  /**
   * Write a consistent database copy under `<dataDir>/backups` and rotate.
   * @param {string} [label] short label used in the filename (auto/manual/pre-restore/v2...)
   * @param {number} [keep] number of backup files to keep
   */
  backup(label = 'manual', keep = 10) {
    const directory = path.join(this.dataDir, 'backups')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const safeLabel = String(label).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'manual'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(directory, `memory-${safeLabel}-${stamp}.db`)
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
    this.logger?.info?.(`dsh-memory: database backed up to ${target}`)
    this.pruneBackups(directory, keep)
    return target
  }

  /** @param {string} directory @param {number} keep */
  pruneBackups(directory, keep = 10) {
    let entries
    try {
      entries = readdirSync(directory)
        .filter((name) => /^memory-.*\.db$/.test(name))
        .map((name) => ({ name, mtime: statSync(path.join(directory, name)).mtimeMs }))
        .sort((left, right) => right.mtime - left.mtime)
    } catch {
      return
    }
    for (const entry of entries.slice(Math.max(0, keep))) {
      try {
        rmSync(path.join(directory, entry.name), { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** @returns {{ name: string, path: string, size: number, createdAt: number, label: string }[]} */
  listBackups() {
    const directory = path.join(this.dataDir, 'backups')
    try {
      return readdirSync(directory)
        .filter((name) => /^memory-.*\.db$/.test(name))
        .map((name) => {
          const file = path.join(directory, name)
          const info = statSync(file)
          const label = name.replace(/^memory-/, '').replace(/-\d{4}-\d{2}-\d{2}.*$/, '')
          return { name, path: file, size: info.size, createdAt: info.mtimeMs, label }
        })
        .sort((left, right) => right.createdAt - left.createdAt)
    } catch {
      return []
    }
  }

  /**
   * All revision snapshots, optionally filtered to given memory ids.
   * @param {Set<string> | null} [memoryIds]
   */
  exportRevisions(memoryIds = null) {
    if (this.db === null) return []
    const rows = this.db.prepare('SELECT * FROM memory_revisions ORDER BY memory_id, seq').all()
    return rows
      .filter((row) => memoryIds === null || memoryIds.has(row.memory_id))
      .map((row) => ({
        memory_id: row.memory_id,
        revision: row.revision,
        action: row.action,
        actor: row.actor,
        reason: row.reason ?? null,
        snapshot: parseJson(row.snapshot, null),
        created_at: row.created_at,
      }))
  }

  /**
   * Import revision snapshots without touching current memory rows.
   * @param {Array<Record<string, any>>} rows
   */
  async importRevisions(rows) {
    if (!Array.isArray(rows) || this.db === null) return 0
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO memory_revisions (memory_id, revision, action, actor, reason, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    let inserted = 0
    this.transaction(() => {
      for (const row of rows) {
        if (row === null || typeof row !== 'object') continue
        const memoryId = typeof row.memory_id === 'string' ? row.memory_id : typeof row.memoryId === 'string' ? row.memoryId : ''
        if (memoryId === '' || this.get(memoryId) === undefined) continue
        const revision = Number.parseInt(row.revision, 10)
        if (!Number.isFinite(revision) || revision < 1) continue
        const action = typeof row.action === 'string' && row.action !== '' ? row.action : 'import'
        const actor = typeof row.actor === 'string' && row.actor !== '' ? row.actor : 'system'
        const snapshot = typeof row.snapshot === 'string' ? row.snapshot : JSON.stringify(row.snapshot ?? {})
        const createdAt = Number.isFinite(row.created_at ?? row.createdAt) ? Number(row.created_at ?? row.createdAt) : Date.now()
        const result = insert.run(memoryId, revision, action, actor, row.reason ?? null, snapshot, createdAt)
        if (result.changes > 0) inserted += 1
      }
    })
    return inserted
  }

  /** @param {string} id */
  get(id) {
    return this.records.get(id)
  }

  *entries() {
    yield* this.records.entries()
  }

  async open() {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    // Loaded lazily so the domain backend never pays the experimental-API warning.
    const { DatabaseSync } = await import('node:sqlite')
    this.db = new DatabaseSync(this.location)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec(CREATE_MEMORIES)
    this.db.exec(CREATE_INDEXES)
    this.db.exec(CREATE_FTS)
    this.db.exec(CREATE_GRAPH)
    this.db.exec(CREATE_REVISIONS)
    this.db.exec(CREATE_EVENTS)
    this.db.exec(CREATE_FEEDBACK)
    this.db.exec(CREATE_RECALLS)
    this.db.exec(CREATE_QUALITY)
    this.db.exec(CREATE_CONTEXT_FEEDBACK)
    this.db.exec(CREATE_CONFLICTS)
    this.migrateRecallColumns()
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    this.migrateFeedbackColumns()
    this.migrateSchema()
    this.statements = {
      insert: this.db.prepare(INSERT_SQL),
      delete: this.db.prepare('DELETE FROM memories WHERE id = ?'),
      ftsDelete: this.db.prepare('DELETE FROM memories_fts WHERE id = ?'),
      ftsInsert: this.db.prepare('INSERT INTO memories_fts (id, tokens) VALUES (?, ?)'),
      selectAll: this.db.prepare('SELECT * FROM memories'),
      ftsSearch: this.db.prepare(
        'SELECT id, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?',
      ),
      readMeta: this.db.prepare('SELECT value FROM meta WHERE key = ?'),
      writeMeta: this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
      insertRevision: this.db.prepare(
        'INSERT OR IGNORE INTO memory_revisions (memory_id, revision, action, actor, reason, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      selectRevisions: this.db.prepare('SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY seq DESC LIMIT ?'),
      selectRevisionSeqs: this.db.prepare(
        "SELECT seq FROM memory_revisions WHERE memory_id = ? AND action <> 'migrate' ORDER BY seq DESC",
      ),
      deleteRevision: this.db.prepare('DELETE FROM memory_revisions WHERE seq = ?'),
      insertEvent: this.db.prepare(
        'INSERT INTO memory_events (at, kind, status, run_id, duration_ms, tokens, calls, count, error, detail, session_id, workspace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      selectEvents: this.db.prepare('SELECT * FROM memory_events WHERE (? IS NULL OR kind = ?) ORDER BY seq DESC LIMIT ?'),
      deleteOldEvents: this.db.prepare('DELETE FROM memory_events WHERE at < ?'),
      deleteEventOverflow: this.db.prepare(
        'DELETE FROM memory_events WHERE seq <= (SELECT seq FROM memory_events ORDER BY seq DESC LIMIT 1 OFFSET ?)',
      ),
      countEvents: this.db.prepare('SELECT COUNT(*) AS count FROM memory_events'),
      countRevisions: this.db.prepare('SELECT COUNT(*) AS count FROM memory_revisions'),
      insertFeedback: this.db.prepare(
        'INSERT INTO memory_feedback (at, memory_id, query_hash, action, source, detail) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      selectFeedback: this.db.prepare('SELECT * FROM memory_feedback WHERE (? IS NULL OR memory_id = ?) ORDER BY seq DESC LIMIT ?'),
      feedbackSummary: this.db.prepare(
        'SELECT action, COUNT(*) AS count FROM memory_feedback WHERE at >= ? GROUP BY action',
      ),
      feedbackDaily: this.db.prepare(
        "SELECT DATE(at / 1000, 'unixepoch', 'localtime') AS day, action, COUNT(*) AS count FROM memory_feedback WHERE at >= ? GROUP BY day, action",
      ),
      countFeedback: this.db.prepare('SELECT COUNT(*) AS count FROM memory_feedback'),
      insertRecall: this.db.prepare(
        'INSERT OR REPLACE INTO memory_recalls (recall_id, at, session_id, turn, source, query_hash, memory_ids, config_hash, detail, query_vec, workspace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      selectRecallsSession: this.db.prepare('SELECT * FROM memory_recalls WHERE session_id = ? AND reviewed_at IS NULL ORDER BY at DESC LIMIT ?'),
      markRecallReviewed: this.db.prepare('UPDATE memory_recalls SET reviewed_at = ? WHERE recall_id = ?'),
      selectRecallsSince: this.db.prepare('SELECT * FROM memory_recalls WHERE at >= ? ORDER BY at ASC LIMIT ?'),
      selectRecall: this.db.prepare('SELECT * FROM memory_recalls WHERE recall_id = ?'),
      countRecalls: this.db.prepare('SELECT COUNT(*) AS count FROM memory_recalls'),
      deleteOldRecalls: this.db.prepare('DELETE FROM memory_recalls WHERE at < ?'),
      deleteRecallOverflow: this.db.prepare(
        'DELETE FROM memory_recalls WHERE recall_id IN (SELECT recall_id FROM memory_recalls ORDER BY at DESC LIMIT -1 OFFSET ?)',
      ),
      deleteRating: this.db.prepare(
        "DELETE FROM memory_feedback WHERE recall_id = ? AND memory_id = ? AND axis = ? AND rating_source = 'explicit'",
      ),
      deleteContentIssues: this.db.prepare(
        "DELETE FROM memory_feedback WHERE memory_id = ? AND axis = 'content' AND rating IN ('outdated','incorrect','duplicate') AND rating_source = 'explicit'",
      ),
      selectRating: this.db.prepare(
        "SELECT * FROM memory_feedback WHERE recall_id = ? AND memory_id = ? AND axis = ? AND rating_source = 'explicit' ORDER BY seq DESC LIMIT 1",
      ),
      insertRating: this.db.prepare(
        'INSERT INTO memory_feedback (at, memory_id, query_hash, action, source, detail, recall_id, rating, rating_source, note, axis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      selectRatingsForRecall: this.db.prepare(
        "SELECT * FROM memory_feedback WHERE recall_id IN (SELECT recall_id FROM memory_recalls WHERE session_id = ?) AND rating IS NOT NULL ORDER BY at DESC",
      ),
      selectRatingsSince: this.db.prepare('SELECT * FROM memory_feedback WHERE rating IS NOT NULL AND at >= ? ORDER BY at DESC'),
      ratingStatsByMemory: this.db.prepare(
        `SELECT memory_id,
          COUNT(*) AS total,
          SUM(CASE WHEN rating = 'valid' THEN 1 ELSE 0 END) AS positive,
          SUM(CASE WHEN rating IN ('outdated','incorrect','duplicate') THEN 1 ELSE 0 END) AS negative,
          SUM(CASE WHEN rating = 'outdated' THEN 1 ELSE 0 END) AS outdated,
          SUM(CASE WHEN rating = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
          SUM(CASE WHEN rating = 'duplicate' THEN 1 ELSE 0 END) AS duplicate
        FROM memory_feedback
        WHERE rating IS NOT NULL AND rating_source = 'explicit' AND axis = 'content'
        GROUP BY memory_id`,
      ),
      ratingStatsForMemory: this.db.prepare(
        `SELECT memory_id,
          COUNT(*) AS total,
          SUM(CASE WHEN rating = 'valid' THEN 1 ELSE 0 END) AS positive,
          SUM(CASE WHEN rating IN ('outdated','incorrect','duplicate') THEN 1 ELSE 0 END) AS negative,
          SUM(CASE WHEN rating = 'outdated' THEN 1 ELSE 0 END) AS outdated,
          SUM(CASE WHEN rating = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
          SUM(CASE WHEN rating = 'duplicate' THEN 1 ELSE 0 END) AS duplicate
        FROM memory_feedback
        WHERE rating IS NOT NULL AND rating_source = 'explicit' AND axis = 'content' AND memory_id = ?
        GROUP BY memory_id`,
      ),
      selectStaleVotes: this.db.prepare(
        "SELECT memory_id, COUNT(*) AS count FROM memory_feedback WHERE rating = 'outdated' AND axis = 'content' AND rating_source = 'explicit' GROUP BY memory_id HAVING COUNT(*) >= 2",
      ),
      deleteContextFeedback: this.db.prepare('DELETE FROM memory_context_feedback WHERE recall_id = ? AND memory_id = ?'),
      insertContextFeedback: this.db.prepare(
        'INSERT INTO memory_context_feedback (at, recall_id, memory_id, workspace, query_vec, relevance, rating, source, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      selectContextFeedbackSince: this.db.prepare('SELECT * FROM memory_context_feedback WHERE at >= ? ORDER BY at DESC LIMIT ?'),
      pruneContextFeedback: this.db.prepare('DELETE FROM memory_context_feedback WHERE at < ?'),
      countContextFeedback: this.db.prepare('SELECT COUNT(*) AS count FROM memory_context_feedback'),
      insertConflict: this.db.prepare(
        'INSERT INTO memory_conflicts (id, at, old_id, new_id, similarity, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      selectConflicts: this.db.prepare("SELECT * FROM memory_conflicts WHERE (? IS NULL OR status = ?) ORDER BY at DESC LIMIT ?"),
      selectConflict: this.db.prepare('SELECT * FROM memory_conflicts WHERE id = ?'),
      resolveConflict: this.db.prepare(
        "UPDATE memory_conflicts SET status = ?, resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
      ),
      countConflicts: this.db.prepare("SELECT COUNT(*) AS count FROM memory_conflicts WHERE status = 'open'"),
      readQuality: this.db.prepare('SELECT * FROM memory_quality_daily WHERE day = ?'),
      listQuality: this.db.prepare('SELECT * FROM memory_quality_daily WHERE day >= ? ORDER BY day ASC'),
      writeQuality: this.db.prepare(
        'INSERT OR REPLACE INTO memory_quality_daily (day, metrics, updated_at) VALUES (?, ?, ?)',
      ),
    }
    for (const row of this.statements.selectAll.all()) this.records.set(row.id, rowToRecord(row))
    const meta = this.statements.readMeta.get(SETTINGS_META_KEY)
    this.globalValue = meta === undefined ? {} : parseJson(meta.value, {})
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      JSON.stringify(SCHEMA_VERSION),
    )
    return this.records
  }

  /** @param {Record<string, any>} record */
  async put(record) {
    this.transaction(() => this.writeRow(record))
    this.records.set(record.id, record)
  }

  /**
   * @param {string} id
   * @param {(current: Record<string, any>) => Record<string, any>} transform
   */
  async update(id, transform) {
    const current = this.records.get(id)
    if (current === undefined) throw new Error(`memory '${id}' does not exist`)
    const next = transform(current)
    this.transaction(() => this.writeRow(next))
    this.records.set(id, next)
    return next
  }

  /** @param {string} id */
  async delete(id) {
    const existed = this.records.delete(id)
    if (existed) {
      this.transaction(() => {
        this.statements.delete.run(id)
        this.statements.ftsDelete.run(id)
      })
    }
    return existed
  }

  readGlobal() {
    return this.globalValue
  }

  async writeGlobal(value) {
    this.globalValue = value
    this.statements.writeMeta.run(SETTINGS_META_KEY, JSON.stringify(value))
  }

  /**
   * FTS5/BM25 keyword retrieval.
   * @param {string[]} tokens
   * @param {{ allowed?: Set<string>, limit?: number }} [options]
   * @returns {{ id: string, score: number }[]}
   */
  keywordSearch(tokens, { allowed, limit = 50 } = {}) {
    const unique = [...new Set(tokens)].filter((token) => token !== '')
    if (unique.length === 0) return []
    const match = unique.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    const rows = this.statements.ftsSearch.all(match, Math.min(limit * 5, 1000))
    const hits = []
    for (const row of rows) {
      if (allowed !== undefined && !allowed.has(row.id)) continue
      hits.push({ id: row.id, score: -Number(row.rank) })
      if (hits.length >= limit) break
    }
    return hits
  }

  async close() {
    try {
      this.db?.close()
    } catch {
      // best effort during teardown
    }
    this.db = null
  }

  // ------------------------------------------------------------------- graph

  /**
   * Replace one memory's outgoing graph edges. Hubs are project paths, error
   * signatures and tags; recursion over hub nodes gives cheap 2-hop neighbors.
   * @param {Record<string, any>} record
   */
  async setGraphForMemory(record) {
    const now = Date.now()
    const memoryNode = `mem:${record.id}`
    const hubEdges = []
    if (typeof record.workspace === 'string' && record.workspace !== '') {
      hubEdges.push([`project:${record.workspace}`, 'project', 'same_project', record.workspace])
    }
    if (typeof record.signature === 'string' && record.signature !== '') {
      hubEdges.push([`sig:${record.signature}`, 'error_signature', 'mentions', record.signature])
    }
    for (const tag of record.tags ?? []) {
      hubEdges.push([`topic:${tag.toLowerCase()}`, 'topic', 'topic', tag])
    }
    const project = typeof record.workspace === 'string' ? record.workspace : null
    this.transaction(() => {
      this.db.prepare('DELETE FROM graph_edges WHERE src = ?').run(memoryNode)
      this.db
        .prepare('INSERT OR REPLACE INTO graph_nodes (id, kind, ref, project, label, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(memoryNode, 'memory', record.id, project, record.text.slice(0, 80), now)
      for (const [hubId, kind, relation, label] of hubEdges) {
        this.db
          .prepare('INSERT OR REPLACE INTO graph_nodes (id, kind, ref, project, label, updated_at) VALUES (?, ?, NULL, ?, ?, ?)')
          .run(hubId, kind, kind === 'project' ? label : project, String(label), now)
        this.db
          .prepare('INSERT OR REPLACE INTO graph_edges (src, dst, relation, weight, evidence, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(memoryNode, hubId, relation, 1, null, now)
      }
    })
  }

  /** @param {string} id */
  async removeGraphForMemory(id) {
    const memoryNode = `mem:${id}`
    this.transaction(() => {
      this.db.prepare('DELETE FROM graph_edges WHERE src = ? OR dst = ?').run(memoryNode, memoryNode)
      this.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(memoryNode)
    })
  }

  async clearGraph() {
    this.db.exec('DELETE FROM graph_edges')
    this.db.exec('DELETE FROM graph_nodes')
  }

  /**
   * Memories connected through shared hubs (project / error signature / tag).
   * One hop uses the hub index directly; multiple hops traverse the graph with
   * a bounded recursive CTE (each logical hop is two edge steps).
   * @param {string[]} memoryIds
   * @param {{ limit?: number, maxHops?: number }} [options]
   * @returns {{ id: string, via: string, depth?: number }[]}
   */
  graphRelated(memoryIds, { limit = 20, maxHops = 1 } = {}) {
    if (memoryIds.length === 0) return []
    const nodeIds = memoryIds.map((id) => `mem:${id}`)
    if (maxHops > 1) return this.graphRelatedRecursive(nodeIds, memoryIds, { limit, maxHops })
    const marks = nodeIds.map(() => '?').join(', ')
    const hubs = this.db
      .prepare(
        `SELECT DISTINCT dst AS hub FROM graph_edges WHERE src IN (${marks}) AND (dst LIKE 'project:%' OR dst LIKE 'sig:%' OR dst LIKE 'topic:%')`,
      )
      .all(...nodeIds)
      .map((row) => row.hub)
    if (hubs.length === 0) return []
    const hubMarks = hubs.map(() => '?').join(', ')
    const memoryMarks = memoryIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT n.ref AS id, SUBSTR(e.dst, 1, INSTR(e.dst, ':') - 1) AS via
         FROM graph_edges e JOIN graph_nodes n ON n.id = e.src
         WHERE e.dst IN (${hubMarks}) AND n.kind = 'memory' AND n.ref NOT IN (${memoryMarks})
         GROUP BY n.ref LIMIT ?`,
      )
      .all(...hubs, ...memoryIds, limit)
    return rows.map((row) => ({ id: row.id, via: row.via }))
  }

  /**
   * Bounded recursive traversal: seed memory -> hub -> memory -> hub -> memory.
   * `maxHops` logical hops are `maxHops * 2` edge steps; UNION dedupes visited
   * (node, depth) pairs, so the depth bound is the only cycle guard needed.
   * @param {string[]} nodeIds prefixed `mem:` seed node ids
   * @param {string[]} memoryIds unprefixed seed record ids
   * @param {{ limit: number, maxHops: number }} options
   */
  graphRelatedRecursive(nodeIds, memoryIds, { limit, maxHops }) {
    const seedMarks = nodeIds.map(() => '?').join(', ')
    const memoryMarks = memoryIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `WITH RECURSIVE walk(node, depth) AS (
           SELECT id, 0 FROM graph_nodes WHERE id IN (${seedMarks})
           UNION
           SELECT CASE WHEN e.src = walk.node THEN e.dst ELSE e.src END, walk.depth + 1
           FROM walk JOIN graph_edges e ON (e.src = walk.node OR e.dst = walk.node)
           WHERE walk.depth < ?
         )
         SELECT n.ref AS id, MIN(walk.depth) AS depth
         FROM walk JOIN graph_nodes n ON n.id = walk.node
         WHERE n.kind = 'memory' AND n.ref NOT IN (${memoryMarks})
         GROUP BY n.ref
         ORDER BY depth, id
         LIMIT ?`,
      )
      .all(...nodeIds, maxHops * 2, ...memoryIds, limit)
    return rows.map((row) => ({ id: row.id, via: 'graph', depth: row.depth }))
  }

  // ------------------------------------------------------------ extraction

  /** @param {string} sessionId */
  readExtractState(sessionId) {
    const row = this.db.prepare('SELECT * FROM extract_state WHERE session_id = ?').get(sessionId)
    if (row === undefined) return undefined
    return { sessionId: row.session_id, lastSeq: row.last_seq, project: row.project, lastRunAt: row.last_run_at }
  }

  /** @param {{ sessionId: string, lastSeq: number, project?: string | null, lastRunAt?: number }} state */
  async writeExtractState(state) {
    this.db
      .prepare('INSERT OR REPLACE INTO extract_state (session_id, last_seq, project, last_run_at) VALUES (?, ?, ?, ?)')
      .run(state.sessionId, state.lastSeq, state.project ?? null, state.lastRunAt ?? Date.now())
  }
  /**
   * Append one revision snapshot (callers bump `record.revision` first).
   * @param {Record<string, any>} record
   * @param {{ action: string, actor?: string, reason?: string | null }} options
   */
  appendRevision(record, { action, actor = 'system', reason = null } = {}) {
    if (this.statements?.insertRevision === undefined) return
    this.statements.insertRevision.run(
      record.id,
      record.revision ?? 1,
      action,
      actor,
      reason,
      JSON.stringify(revisionSnapshot(record)),
      Date.now(),
    )
    this.pruneRevisions(record.id)
  }

  /**
   * Newest-first revision snapshots for one memory.
   * @param {string} memoryId
   * @param {number} [limit]
   */
  listRevisions(memoryId, limit = 50) {
    if (this.statements?.selectRevisions === undefined) return []
    return this.statements.selectRevisions.all(memoryId, clampInteger(limit, 50, 1, 200)).map((row) => ({
      seq: row.seq,
      revision: row.revision,
      action: row.action,
      actor: row.actor,
      reason: row.reason ?? null,
      snapshot: parseJson(row.snapshot, null),
      createdAt: row.created_at,
    }))
  }

  /** Keep the baseline snapshot and the newest revisions. @param {string} memoryId */
  pruneRevisions(memoryId) {
    if (this.statements?.selectRevisionSeqs === undefined) return
    const rows = this.statements.selectRevisionSeqs.all(memoryId)
    for (const row of rows.slice(REVISION_KEEP)) this.statements.deleteRevision.run(row.seq)
  }

  /**
   * Append one observability event (bounded; events are not part of memory data).
   * @param {Record<string, any>} event
   * @param {{ keep?: number, maxAgeMs?: number }} [options]
   */
  appendEvent(event, { keep = 10000, maxAgeMs = 30 * 86400000 } = {}) {
    if (this.statements?.insertEvent === undefined) return
    this.statements.insertEvent.run(
      Number.isFinite(event.at) ? event.at : Date.now(),
      typeof event.kind === 'string' ? event.kind : 'unknown',
      typeof event.status === 'string' ? event.status : 'ok',
      typeof event.runId === 'string' ? event.runId : null,
      Number.isFinite(event.durationMs) ? Math.round(event.durationMs) : null,
      Number.isFinite(event.tokens) ? Math.round(event.tokens) : null,
      Number.isFinite(event.calls) ? Math.round(event.calls) : null,
      Number.isFinite(event.count) ? Math.round(event.count) : null,
      typeof event.error === 'string' ? event.error.slice(0, 1000) : null,
      event.detail === undefined ? null : JSON.stringify(event.detail).slice(0, 8000),
      typeof event.sessionId === 'string' ? event.sessionId : null,
      typeof event.workspace === 'string' ? event.workspace : null,
    )
    const count = this.statements.countEvents.get().count
    if (count > keep + 100) {
      const cutoff = Date.now() - maxAgeMs
      this.statements.deleteOldEvents.run(cutoff)
      this.statements.deleteEventOverflow.run(keep)
    }
  }

  /**
   * Newest-first events.
   * @param {{ limit?: number, kind?: string | null }} [options]
   */
  listEvents({ limit = 100, kind = null } = {}) {
    if (this.statements?.selectEvents === undefined) return []
    const size = clampInteger(limit, 100, 1, 2000)
    return this.statements.selectEvents.all(kind, kind, size).map(eventRow)
  }

  /** Drop events older than maxAge and keep at most `keep` rows. */
  pruneEvents({ keep = 10000, maxAgeMs = 30 * 86400000 } = {}) {
    if (this.statements?.deleteOldEvents === undefined) return
    this.statements.deleteOldEvents.run(Date.now() - maxAgeMs)
    this.statements.deleteEventOverflow.run(keep)
  }

  countEvents() {
    return this.statements?.countEvents === undefined ? 0 : this.statements.countEvents.get().count
  }

  countRevisions() {
    return this.statements?.countRevisions === undefined ? 0 : this.statements.countRevisions.get().count
  }

  /**
   * Append one relevance/quality feedback row.
   * @param {{ at?: number, memoryId: string, queryHash?: string | null, action: string, source?: string, detail?: any }} input
   */
  appendFeedback(input) {
    if (this.statements?.insertFeedback === undefined) return
    this.statements.insertFeedback.run(
      Number.isFinite(input.at) ? input.at : Date.now(),
      input.memoryId,
      typeof input.queryHash === 'string' ? input.queryHash : null,
      input.action,
      input.source ?? 'panel',
      input.detail === undefined ? null : JSON.stringify(input.detail).slice(0, 4000),
    )
  }

  /** @param {{ limit?: number, memoryId?: string | null }} [options] */
  listFeedback({ limit = 100, memoryId = null } = {}) {
    if (this.statements?.selectFeedback === undefined) return []
    return this.statements.selectFeedback.all(memoryId, memoryId, clampInteger(limit, 100, 1, 2000)).map((row) => ({
      seq: row.seq,
      at: row.at,
      memoryId: row.memory_id,
      queryHash: row.query_hash ?? null,
      action: row.action,
      source: row.source,
      detail: parseJson(row.detail, null),
    }))
  }

  /** @param {{ since?: number, days?: number }} [options] */
  feedbackSummary({ since = Date.now() - 86400000 } = {}) {
    if (this.statements?.feedbackSummary === undefined) return {}
    const summary = {}
    for (const row of this.statements.feedbackSummary.all(since)) summary[row.action] = row.count
    return summary
  }

  /** @param {{ days?: number }} [options] */
  feedbackDaily({ days = 7 } = {}) {
    if (this.statements?.feedbackDaily === undefined) return []
    const rows = this.statements.feedbackDaily.all(Date.now() - days * 86400000)
    return rows.map((row) => ({ day: row.day, action: row.action, count: row.count }))
  }

  countFeedback() {
    return this.statements?.countFeedback === undefined ? 0 : this.statements.countFeedback.get().count
  }

  /** Add columns to databases created before the recall-review feature. */
  migrateRecallColumns() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(memory_recalls)').all().map((row) => row.name))
    if (!columns.has('reviewed_at')) this.db.exec('ALTER TABLE memory_recalls ADD COLUMN reviewed_at INTEGER')
    if (!columns.has('query_vec')) this.db.exec('ALTER TABLE memory_recalls ADD COLUMN query_vec BLOB')
    if (!columns.has('workspace')) this.db.exec('ALTER TABLE memory_recalls ADD COLUMN workspace TEXT')
  }

  /** Add the rating columns to databases created before the recall-quality feature. */
  migrateFeedbackColumns() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(memory_feedback)').all().map((row) => row.name))
    if (!columns.has('recall_id')) this.db.exec('ALTER TABLE memory_feedback ADD COLUMN recall_id TEXT')
    if (!columns.has('rating')) this.db.exec('ALTER TABLE memory_feedback ADD COLUMN rating TEXT')
    if (!columns.has('rating_source')) this.db.exec('ALTER TABLE memory_feedback ADD COLUMN rating_source TEXT')
    if (!columns.has('note')) this.db.exec('ALTER TABLE memory_feedback ADD COLUMN note TEXT')
    const hadAxis = columns.has('axis')
    if (!hadAxis) this.db.exec("ALTER TABLE memory_feedback ADD COLUMN axis TEXT NOT NULL DEFAULT 'relevance'")
    if (!hadAxis) {
      // v4 -> v5: "outdated" is a content-quality signal, never a relevance one.
      this.db.exec("UPDATE memory_feedback SET axis = 'content' WHERE rating = 'outdated'")
      this.db.exec("UPDATE memory_feedback SET axis = 'relevance' WHERE axis IS NULL OR axis = ''")
      this.db.exec('UPDATE memories SET quality_score = 0, needs_review = 0, review_reason = NULL')
    }
  }

  /**
   * Record one recall group (ids only; text is resolved live by the API).
   * @param {{ recallId: string, at?: number, sessionId: string, turn?: number | null, source: string, queryHash?: string | null, memoryIds: string[], configHash?: string | null, detail?: any }} recall
   * @param {{ keep?: number, maxAgeMs?: number }} [options]
   */
  appendRecall(recall, { keep = 10000, maxAgeMs = 90 * 86400000 } = {}) {
    if (this.statements?.insertRecall === undefined) return
    this.statements.insertRecall.run(
      recall.recallId,
      Number.isFinite(recall.at) ? recall.at : Date.now(),
      recall.sessionId,
      Number.isFinite(recall.turn) ? recall.turn : null,
      recall.source,
      typeof recall.queryHash === 'string' ? recall.queryHash : null,
      JSON.stringify(recall.memoryIds ?? []),
      typeof recall.configHash === 'string' ? recall.configHash : null,
      recall.detail === undefined ? null : JSON.stringify(recall.detail).slice(0, 4000),
      typeof recall.queryVec === 'string' && recall.queryVec !== '' ? Buffer.from(recall.queryVec, 'base64') : null,
      typeof recall.workspace === 'string' && recall.workspace !== '' ? recall.workspace : null,
    )
    const count = this.statements.countRecalls.get().count
    if (count > keep + 100) {
      this.statements.deleteOldRecalls.run(Date.now() - maxAgeMs)
      this.statements.deleteRecallOverflow.run(keep)
    }
  }

  /**
   * Mark recall groups as reviewed, so the temporary rating window does not
   * show them again after submit/close. Reviewed recalls stay in history and
   * quality aggregation; they are only hidden from `listRecalls`.
   * @param {{ recallIds: string[], reviewed?: boolean }} input
   */
  markRecallsReviewed({ recallIds = [], reviewed = true } = {}) {
    if (this.statements?.markRecallReviewed === undefined) return 0
    const value = reviewed ? Date.now() : null
    let updated = 0
    this.transaction(() => {
      for (const recallId of recallIds) {
        if (typeof recallId !== 'string' || recallId === '') continue
        this.statements.markRecallReviewed.run(value, recallId)
        updated += 1
      }
    })
    return updated
  }

  /** @param {{ sessionId?: string | null, limit?: number }} [options] */
  listRecalls({ sessionId = null, limit = 20 } = {}) {
    if (this.statements?.selectRecallsSession === undefined) return []
    if (typeof sessionId !== 'string' || sessionId === '') return []
    return this.statements.selectRecallsSession.all(sessionId, clampInteger(limit, 20, 1, 200)).map(recallRow)
  }

  /** @param {{ since?: number, limit?: number }} [options] */
  recallsSince({ since = Date.now() - 30 * 86400000, limit = 5000 } = {}) {
    if (this.statements?.selectRecallsSince === undefined) return []
    return this.statements.selectRecallsSince.all(since, clampInteger(limit, 5000, 1, 20000)).map(recallRow)
  }

  /** @param {string} recallId */
  getRecall(recallId) {
    if (this.statements?.selectRecall === undefined) return undefined
    const row = this.statements.selectRecall.get(recallId)
    return row === undefined ? undefined : recallRow(row)
  }

  countRecalls() {
    return this.statements?.countRecalls === undefined ? 0 : this.statements.countRecalls.get().count
  }

  pruneRecalls({ keep = 10000, maxAgeMs = 90 * 86400000 } = {}) {
    if (this.statements?.deleteOldRecalls === undefined) return
    this.statements.deleteOldRecalls.run(Date.now() - maxAgeMs)
    this.statements.deleteRecallOverflow.run(keep)
  }

  /**
   * Upsert one explicit rating for (recall, memory).
   * @param {{ at?: number, memoryId: string, recallId: string, queryHash?: string | null, rating: string, source?: string, note?: string | null, detail?: any }} input
   */
  rateFeedback(input) {
    if (this.statements?.insertRating === undefined) return
    this.transaction(() => {
      this.statements.deleteRating.run(input.recallId, input.memoryId, input.axis ?? 'relevance')
      this.statements.insertRating.run(
        Number.isFinite(input.at) ? input.at : Date.now(),
        input.memoryId,
        typeof input.queryHash === 'string' ? input.queryHash : null,
        'rating',
        input.source ?? 'panel',
        input.detail === undefined ? null : JSON.stringify(input.detail).slice(0, 4000),
        input.recallId,
        input.rating,
        'explicit',
        typeof input.note === 'string' ? input.note.slice(0, 1000) : null,
        input.axis ?? 'relevance',
      )
    })
  }

  /** Latest explicit rating for one recall+memory, if any. */
  getFeedbackRating(recallId, memoryId, axis = 'relevance') {
    if (this.statements?.selectRating === undefined) return undefined
    const row = this.statements.selectRating.get(recallId, memoryId, axis)
    if (row === undefined) return undefined
    return { recallId: row.recall_id, memoryId: row.memory_id, rating: row.rating, ratingSource: row.rating_source, at: row.at }
  }

  /** Remove all explicit outdated votes for a memory ("keep" clears stale signals). */
  deleteContentIssues(memoryId) {
    if (this.statements?.deleteContentIssues === undefined) return 0
    return this.statements.deleteContentIssues.run(memoryId).changes ?? 0
  }

  /** Remove one explicit rating (undo). */
  deleteFeedbackRating(recallId, memoryId, axis = 'relevance') {
    if (this.statements?.deleteRating === undefined) return
    this.statements.deleteRating.run(recallId, memoryId, axis)
  }

  /** Ratings for all recalls of one session, newest first. @param {string} sessionId */
  ratingsForSession(sessionId) {
    if (this.statements?.selectRatingsForRecall === undefined) return []
    return this.statements.selectRatingsForRecall.all(sessionId).map((row) => ({
      seq: row.seq,
      at: row.at,
      memoryId: row.memory_id,
      recallId: row.recall_id,
      rating: row.rating,
      axis: row.axis ?? 'relevance',
      ratingSource: row.rating_source,
      source: row.source,
      note: row.note ?? null,
    }))
  }

  /** @param {{ since?: number }} [options] */
  ratingsSince({ since = Date.now() - 30 * 86400000 } = {}) {
    if (this.statements?.selectRatingsSince === undefined) return []
    return this.statements.selectRatingsSince.all(since).map((row) => ({
      seq: row.seq,
      at: row.at,
      memoryId: row.memory_id,
      recallId: row.recall_id,
      rating: row.rating,
      axis: row.axis ?? 'relevance',
      ratingSource: row.rating_source,
      source: row.source,
      note: row.note ?? null,
    }))
  }

  /** Feedback aggregates for every rated memory. */
  ratingStatsByMemory() {
    if (this.statements?.ratingStatsByMemory === undefined) return []
    return this.statements.ratingStatsByMemory.all().map((row) => ({
      memoryId: row.memory_id,
      total: row.total ?? 0,
      positive: row.positive ?? 0,
      negative: row.negative ?? 0,
      outdated: row.outdated ?? 0,
      incorrect: row.incorrect ?? 0,
      duplicate: row.duplicate ?? 0,
    }))
  }

  /** Feedback aggregates for one memory. */
  ratingStatsForMemory(memoryId) {
    if (this.statements?.ratingStatsForMemory === undefined) return { memoryId, total: 0, positive: 0, negative: 0, outdated: 0, incorrect: 0, duplicate: 0 }
    const row = this.statements.ratingStatsForMemory.get(memoryId)
    if (row === undefined) return { memoryId, total: 0, positive: 0, negative: 0, outdated: 0, incorrect: 0, duplicate: 0 }
    return {
      memoryId,
      total: row.total ?? 0,
      positive: row.positive ?? 0,
      negative: row.negative ?? 0,
      outdated: row.outdated ?? 0,
      incorrect: row.incorrect ?? 0,
      duplicate: row.duplicate ?? 0,
    }
  }

  /**
   * Remember how a memory was judged in one query context. Query vectors are
   * only used to find similar future contexts; raw query text is not stored.
   * @param {{ at?: number, recallId: string, memoryId: string, workspace?: string | null, queryVec?: string | null, relevance?: number | null, rating: string, source?: string, expiresAt?: number | null }} input
   */
  upsertContextFeedback(input) {
    if (this.statements?.insertContextFeedback === undefined) return
    this.transaction(() => {
      this.statements.deleteContextFeedback.run(input.recallId, input.memoryId)
      this.statements.insertContextFeedback.run(
        Number.isFinite(input.at) ? input.at : Date.now(),
        input.recallId,
        input.memoryId,
        typeof input.workspace === 'string' && input.workspace !== '' ? input.workspace : null,
        typeof input.queryVec === 'string' && input.queryVec !== '' ? Buffer.from(input.queryVec, 'base64') : null,
        Number.isFinite(input.relevance) ? input.relevance : null,
        input.rating,
        input.source ?? 'dock',
        Number.isFinite(input.expiresAt) ? input.expiresAt : null,
      )
    })
  }

  deleteContextFeedback(recallId, memoryId) {
    if (this.statements?.deleteContextFeedback === undefined) return
    this.statements.deleteContextFeedback.run(recallId, memoryId)
  }

  /** @param {{ since?: number, limit?: number }} [options] */
  listContextFeedback({ since = Date.now() - 180 * 86400000, limit = 20000 } = {}) {
    if (this.statements?.selectContextFeedbackSince === undefined) return []
    return this.statements.selectContextFeedbackSince.all(since, clampInteger(limit, 20000, 1, 50000)).map((row) => ({
      seq: row.seq,
      at: row.at,
      recallId: row.recall_id,
      memoryId: row.memory_id,
      workspace: row.workspace ?? null,
      queryVec: row.query_vec === null || row.query_vec === undefined ? null : Buffer.from(row.query_vec).toString('base64'),
      relevance: row.relevance,
      rating: row.rating,
      source: row.source,
      expiresAt: row.expires_at ?? null,
    }))
  }

  pruneContextFeedback({ maxAgeMs = 180 * 86400000 } = {}) {
    if (this.statements?.pruneContextFeedback === undefined) return
    this.statements.pruneContextFeedback.run(Date.now() - maxAgeMs)
  }

  countContextFeedback() {
    return this.statements?.countContextFeedback === undefined ? 0 : this.statements.countContextFeedback.get().count
  }

  /** @param {{ id: string, at?: number, oldId: string, newId: string, similarity?: number | null }} input */
  appendConflict(input) {
    if (this.statements?.insertConflict === undefined) return
    this.statements.insertConflict.run(
      input.id,
      Number.isFinite(input.at) ? input.at : Date.now(),
      input.oldId,
      input.newId,
      Number.isFinite(input.similarity) ? input.similarity : null,
      'open',
    )
  }

  /** @param {{ status?: string | null, limit?: number }} [options] */
  listConflicts({ status = 'open', limit = 50 } = {}) {
    if (this.statements?.selectConflicts === undefined) return []
    return this.statements.selectConflicts.all(status ?? null, status ?? null, limit).map(conflictRow)
  }

  getConflict(id) {
    if (this.statements?.selectConflict === undefined) return undefined
    const row = this.statements.selectConflict.get(id)
    return row === undefined ? undefined : conflictRow(row)
  }

  resolveConflict(id, resolution) {
    if (this.statements?.resolveConflict === undefined) return 0
    return this.statements.resolveConflict.run('resolved', resolution, Date.now(), id).changes ?? 0
  }

  countConflicts() {
    return this.statements?.countConflicts === undefined ? 0 : this.statements.countConflicts.get().count
  }

  /** Memories with at least two explicit outdated votes. */
  staleVotes() {
    if (this.statements?.selectStaleVotes === undefined) return []
    return this.statements.selectStaleVotes.all().map((row) => ({ memoryId: row.memory_id, count: row.count }))
  }

  /** @param {string} day */
  readQuality(day) {
    if (this.statements?.readQuality === undefined) return undefined
    const row = this.statements.readQuality.get(day)
    return row === undefined ? undefined : { day: row.day, metrics: parseJson(row.metrics, null), updatedAt: row.updated_at }
  }

  /** @param {{ days?: number }} [options] */
  listQuality({ days = 90 } = {}) {
    if (this.statements?.listQuality === undefined) return []
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    return this.statements.listQuality.all(start).map((row) => ({
      day: row.day,
      metrics: parseJson(row.metrics, null),
      updatedAt: row.updated_at,
    }))
  }

  /** @param {string} day @param {Record<string, any>} metrics */
  writeQuality(day, metrics) {
    if (this.statements?.writeQuality === undefined) return
    this.statements.writeQuality.run(day, JSON.stringify(metrics), Date.now())
  }

  /** @param {string} key */
  readMeta(key) {
    const row = this.statements.readMeta.get(key)
    return row === undefined ? undefined : parseJson(row.value, undefined)
  }

  /** @param {string} key @param {unknown} value */
  async writeMeta(key, value) {
    this.statements.writeMeta.run(key, JSON.stringify(value))
  }

  // ------------------------------------------------------------------ internal

  /** @param {Record<string, any>} record */
  writeRow(record) {
    const vector = record.vec === null || record.vec === undefined ? null : Buffer.from(record.vec, 'base64')
    this.statements.insert.run(
      record.id,
      record.text,
      record.kind,
      record.scope,
      record.workspace ?? null,
      record.sessionId ?? null,
      JSON.stringify(record.tags ?? []),
      record.importance,
      vector,
      record.model ?? null,
      record.dim ?? null,
      record.hash,
      JSON.stringify(record.source ?? {}),
      record.createdAt,
      record.updatedAt,
      record.details === null || record.details === undefined ? null : JSON.stringify(record.details),
      record.status ?? 'active',
      record.signature ?? null,
      record.tier ?? tierFor(record.scope, record.kind),
      record.revision ?? 1,
      record.supersededBy ?? null,
      record.validFrom ?? record.createdAt,
      record.archivedAt ?? null,
      record.lastUsedAt ?? null,
      record.useCount ?? 0,
      record.helpfulCount ?? 0,
      record.qualityScore ?? 0,
      record.needsReview === true || record.needsReview === 1 ? 1 : 0,
      record.reviewReason ?? null,
      record.validUntil ?? null,
    )
    this.statements.ftsDelete.run(record.id)
    this.statements.ftsInsert.run(record.id, tokenize(record.text).join(' '))
  }

  /** @param {() => void} operation */
  transaction(operation) {
    this.db.exec('BEGIN')
    try {
      operation()
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // the original failure is the useful one
      }
      throw error
    }
  }
}

/** @param {any} row */
function rowToRecord(row) {
  return {
    v: 1,
    id: row.id,
    text: row.text,
    kind: row.kind,
    scope: row.scope,
    workspace: row.workspace ?? null,
    sessionId: row.session_id ?? null,
    tags: parseJson(row.tags, []),
    importance: row.importance,
    vec: row.vec === null || row.vec === undefined ? null : Buffer.from(row.vec).toString('base64'),
    model: row.model ?? null,
    dim: row.dim ?? null,
    hash: row.hash,
    source: parseJson(row.source, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    details: row.details === null || row.details === undefined ? null : parseJson(row.details, null),
    status: row.status ?? 'active',
    signature: row.signature ?? null,
    v: 3,
    tier: row.tier ?? tierFor(row.scope, row.kind),
    revision: row.revision ?? 1,
    supersededBy: row.superseded_by ?? null,
    validFrom: row.valid_from ?? row.created_at,
    archivedAt: row.archived_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    useCount: row.use_count ?? 0,
    helpfulCount: row.helpful_count ?? 0,
    qualityScore: row.quality_score ?? 0,
    needsReview: (row.needs_review ?? 0) === 1,
    reviewReason: row.review_reason ?? null,
    validUntil: row.valid_until ?? null,
  }
}

/**
 * Read records + revisions from a backup database file without opening it as
 * the live store. Used by one-click restore.
 * @param {string} filePath
 */
export async function readBackupDatabase(filePath) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(filePath)
  try {
    const records = db.prepare('SELECT * FROM memories').all().map(rowToRecord)
    let revisions = []
    try {
      revisions = db.prepare('SELECT * FROM memory_revisions ORDER BY memory_id, seq').all().map((row) => ({
        memory_id: row.memory_id,
        revision: row.revision,
        action: row.action,
        actor: row.actor,
        reason: row.reason ?? null,
        snapshot: parseJson(row.snapshot, null),
        created_at: row.created_at,
      }))
    } catch {
      revisions = []
    }
    return { records, revisions }
  } finally {
    db.close()
  }
}

/** @param {any} row */
function conflictRow(row) {
  return {
    id: row.id,
    at: row.at,
    oldId: row.old_id,
    newId: row.new_id,
    similarity: row.similarity,
    status: row.status,
    resolution: row.resolution ?? null,
    detail: parseJson(row.detail, null),
    resolvedAt: row.resolved_at ?? null,
  }
}

/** @param {any} row */
function recallRow(row) {
  return {
    recallId: row.recall_id,
    at: row.at,
    sessionId: row.session_id,
    turn: row.turn ?? null,
    source: row.source,
    queryHash: row.query_hash ?? null,
    memoryIds: parseJson(row.memory_ids, []),
    configHash: row.config_hash ?? null,
    detail: parseJson(row.detail, null),
    reviewedAt: row.reviewed_at ?? null,
    queryVec: row.query_vec === null || row.query_vec === undefined ? null : Buffer.from(row.query_vec).toString('base64'),
    workspace: row.workspace ?? null,
  }
}

/** @param {any} row */
function eventRow(row) {
  return {
    seq: row.seq,
    at: row.at,
    kind: row.kind,
    status: row.status,
    runId: row.run_id ?? null,
    durationMs: row.duration_ms ?? null,
    tokens: row.tokens ?? null,
    calls: row.calls ?? null,
    count: row.count ?? null,
    error: row.error ?? null,
    detail: parseJson(row.detail, null),
    sessionId: row.session_id ?? null,
    workspace: row.workspace ?? null,
  }
}

/** Tier from what the memory represents; session facts are working memory. */
export function tierFor(scope, kind) {
  if (scope === 'session') return 'working'
  if (kind === 'summary') return 'episodic'
  return 'semantic'
}

/** Serializable snapshot for the revision table (vectors are re-created on restore). */
function revisionSnapshot(record) {
  return {
    v: 3,
    id: record.id,
    text: record.text,
    kind: record.kind,
    scope: record.scope,
    workspace: record.workspace ?? null,
    sessionId: record.sessionId ?? null,
    tags: record.tags ?? [],
    importance: record.importance,
    source: record.source ?? {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    details: record.details ?? null,
    status: record.status ?? 'active',
    signature: record.signature ?? null,
    tier: record.tier ?? tierFor(record.scope, record.kind),
    revision: record.revision ?? 1,
    supersededBy: record.supersededBy ?? null,
    validFrom: record.validFrom ?? record.createdAt,
    archivedAt: record.archivedAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
    useCount: record.useCount ?? 0,
    helpfulCount: record.helpfulCount ?? 0,
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

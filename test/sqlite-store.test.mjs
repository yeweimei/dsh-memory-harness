import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteStore } from '../lib/sqlite-store.js'
import { tokenize } from '../lib/text.js'

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-sqlite-'))
}

function record(overrides) {
  const now = Date.now()
  return {
    v: 1,
    id: overrides.id,
    text: overrides.text,
    kind: overrides.kind ?? 'knowledge',
    scope: overrides.scope ?? 'global',
    workspace: overrides.workspace ?? null,
    sessionId: null,
    tags: overrides.tags ?? [],
    importance: 3,
    vec: overrides.vec ?? null,
    model: overrides.model ?? null,
    dim: overrides.dim ?? null,
    hash: overrides.hash ?? 'a'.repeat(40),
    source: { sessionId: null, cwd: null, turn: null },
    createdAt: now,
    updatedAt: now,
    details: overrides.details ?? null,
    status: overrides.status ?? 'active',
    signature: overrides.signature ?? null,
    observedAt: overrides.observedAt ?? now,
  }
}

test('recursive graph traversal honours maxHops', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    const nodes = [
      { id: 'm_1', tags: ['chain-a'], workspace: '/w1' },
      { id: 'm_2', tags: ['chain-a', 'chain-b'], workspace: '/w2' },
      { id: 'm_3', tags: ['chain-b'], workspace: '/w3' },
    ]
    for (const node of nodes) {
      const value = record({ id: node.id, text: node.id, scope: 'workspace', workspace: node.workspace, tags: node.tags })
      await store.put(value)
      await store.setGraphForMemory(value)
    }
    const oneHop = store.graphRelated(['m_1'], { limit: 10, maxHops: 1 }).map((entry) => entry.id)
    assert.deepEqual(oneHop, ['m_2'])
    const twoHop = store.graphRelated(['m_1'], { limit: 10, maxHops: 2 })
    assert.deepEqual(twoHop.map((entry) => entry.id), ['m_2', 'm_3'])
    assert.equal(twoHop.find((entry) => entry.id === 'm_3').depth, 4)
    await store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('observedAt persists across reopen', async () => {
  const dir = tempDir()
  try {
    const observedAt = Date.parse('2024-01-02T03:04:05.000Z')
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    await store.put(record({ id: 'm_time', text: 'time-aware', observedAt }))
    await store.close()
    const reopened = new SqliteStore({ dataDir: dir })
    await reopened.open()
    assert.equal(reopened.get('m_time').observedAt, observedAt)
    await reopened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('graphSnapshot returns live memory nodes and hub edges', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    const a = record({ id: 'm_g1', text: 'graph one', scope: 'workspace', workspace: '/w', tags: ['g'] })
    const b = record({ id: 'm_g2', text: 'graph two', scope: 'workspace', workspace: '/w', tags: ['g'] })
    await store.put(a); await store.setGraphForMemory(a)
    await store.put(b); await store.setGraphForMemory(b)
    const snapshot = store.graphSnapshot({ limit: 50 })
    assert.equal(snapshot.nodes.filter((node) => node.kind === 'memory').length, 2)
    assert.ok(snapshot.edges.some((edge) => edge.relation === 'topic'))
    assert.equal(snapshot.truncated, false)
    await store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('SQLite store migrates a v1 database to the v2 columns', async () => {
  const dir = tempDir()
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const legacy = new DatabaseSync(path.join(dir, 'memory.db'))
    legacy.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
      workspace TEXT, session_id TEXT, tags TEXT NOT NULL, importance INTEGER NOT NULL,
      vec BLOB, model TEXT, dim INTEGER, hash TEXT NOT NULL, source TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    legacy.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, tokens)`)
    legacy
      .prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('m_old', '旧记录', 'knowledge', 'global', null, null, '[]', 3, null, null, null, 'a'.repeat(40), '{}', 1, 2)
    legacy.close()

    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    const migrated = store.get('m_old')
    assert.equal(migrated.status, 'active')
    assert.equal(migrated.details, null)
    assert.equal(migrated.signature, null)
    assert.equal(migrated.tier, 'semantic')
    assert.equal(migrated.revision, 1)
    assert.equal(migrated.validFrom, 1)
    await store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite store migrates a legacy database to v7 with a backup and baseline revisions', async () => {
  const dir = tempDir()
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const legacy = new DatabaseSync(path.join(dir, 'memory.db'))
    legacy.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
      workspace TEXT, session_id TEXT, tags TEXT NOT NULL, importance INTEGER NOT NULL,
      vec BLOB, model TEXT, dim INTEGER, hash TEXT NOT NULL, source TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      details TEXT, status TEXT NOT NULL DEFAULT 'active', signature TEXT)`)
    legacy.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, tokens)`)
    legacy
      .prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'm_v2', '会话记忆', 'decision', 'session', null, 's1', '[]', 3,
        null, null, null, 'b'.repeat(40), '{}', 10, 20,
        '{"confidence":0.9}', 'active', null,
      )
    legacy.exec('PRAGMA user_version = 0')
    legacy.close()

    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    const migrated = store.get('m_v2')
    assert.equal(migrated.tier, 'working')
    assert.equal(migrated.revision, 1)
    assert.equal(migrated.validFrom, 10)
    assert.equal(migrated.observedAt, 10)
    const revisions = store.listRevisions('m_v2')
    assert.equal(revisions.length, 1)
    assert.equal(revisions[0].action, 'migrate')
    assert.equal(revisions[0].snapshot.text, '会话记忆')
    const backups = readdirSync(path.join(dir, 'backups'))
    assert.equal(backups.length, 1)
    const version = store.db.prepare('PRAGMA user_version').get().user_version
    assert.equal(version, 8)
    assert.equal(migrated.qualityScore, 0)
    assert.equal(migrated.needsReview, false)
    await store.close()

    const reopened = new SqliteStore({ dataDir: dir })
    await reopened.open()
    assert.equal(reopened.listRevisions('m_v2').length, 1, 'migration must be idempotent')
    await reopened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite store appends, lists and prunes observability events', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    store.appendEvent({ kind: 'extract', status: 'ok', durationMs: 12, count: 2, detail: { sessions: 1 } })
    store.appendEvent({ kind: 'admission', status: 'error', error: 'boom', count: 1 })
    assert.equal(store.countEvents(), 2)
    const events = store.listEvents({ limit: 10 })
    assert.equal(events[0].kind, 'admission')
    assert.equal(events[0].error, 'boom')
    assert.deepEqual(events[1].detail, { sessions: 1 })
    assert.equal(store.listEvents({ limit: 10, kind: 'extract' }).length, 1)
    store.pruneEvents({ keep: 1, maxAgeMs: 86400000 })
    assert.equal(store.countEvents(), 1)
    await store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite store records retrieval feedback and summaries', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    store.appendFeedback({ memoryId: 'm_1', action: 'relevant', source: 'panel', queryHash: 'abc' })
    store.appendFeedback({ memoryId: 'm_2', action: 'irrelevant', source: 'panel' })
    assert.equal(store.countFeedback(), 2)
    assert.equal(store.listFeedback({ limit: 10 }).length, 2)
    assert.equal(store.listFeedback({ limit: 10, memoryId: 'm_1' }).length, 1)
    const summary = store.feedbackSummary()
    assert.equal(summary.relevant, 1)
    assert.equal(summary.irrelevant, 1)
    assert.equal(store.feedbackDaily({ days: 7 }).length, 2)
    await store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite store persists recall groups, ratings and daily quality', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    store.appendRecall({
      recallId: 'rc_1', sessionId: 's1', turn: 2, source: 'search', memoryIds: ['m_1', 'm_2'], queryHash: 'abc', configHash: 'cfg', workspace: '/work', queryVec: Buffer.from(new Float32Array([1, 0, 0]).buffer).toString('base64'),
    })
    store.appendRecall({ recallId: 'rc_2', sessionId: 's1', turn: 3, source: 'hint', memoryIds: ['m_2'] })
    assert.equal(store.listRecalls({ sessionId: 's1' }).length, 2)
    store.markRecallsReviewed({ recallIds: ['rc_2'], reviewed: true })
    assert.equal(store.listRecalls({ sessionId: 's1' }).length, 1)
    store.markRecallsReviewed({ recallIds: ['rc_2'], reviewed: false })
    assert.equal(store.listRecalls({ sessionId: 's1' }).length, 2)
    assert.equal(store.getRecall('rc_1').memoryIds.length, 2)
    assert.equal(store.getRecall('rc_1').workspace, '/work')
    assert.equal(store.recallsSince({ since: 0 }).length, 2)
    store.rateFeedback({ recallId: 'rc_1', memoryId: 'm_1', rating: 'very_relevant' })
    store.rateFeedback({ recallId: 'rc_1', memoryId: 'm_1', rating: 'relevant' })
    const ratings = store.ratingsForSession('s1')
    assert.equal(ratings.length, 1)
    assert.equal(ratings[0].rating, 'relevant')
    assert.equal(ratings[0].axis, 'relevance')
    store.rateFeedback({ recallId: 'rc_2', memoryId: 'm_2', rating: 'outdated', axis: 'content' })
    store.rateFeedback({ recallId: 'rc_1', memoryId: 'm_2', rating: 'outdated', axis: 'content' })
    assert.deepEqual(store.staleVotes(), [{ memoryId: 'm_2', count: 2 }])
    store.upsertContextFeedback({ recallId: 'rc_1', memoryId: 'm_1', workspace: '/work', queryVec: Buffer.from(new Float32Array([1, 0, 0]).buffer).toString('base64'), relevance: 0, rating: 'irrelevant' })
    assert.equal(store.listContextFeedback({ since: 0 }).length, 1)
    store.deleteContextFeedback('rc_1', 'm_1')
    assert.equal(store.listContextFeedback({ since: 0 }).length, 0)
    store.writeQuality('2026-11-19', { accuracy: 1 })
    assert.deepEqual(store.readQuality('2026-11-19').metrics, { accuracy: 1 })
    assert.equal(store.listQuality({ days: 90 }).length, 1)
    await store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SQLite store persists records, vectors, keywords and settings', async () => {
  const dir = tempDir()
  try {
    const store = new SqliteStore({ dataDir: dir })
    await store.open()
    assert.equal(store.size, 0)

    const vector = new Float32Array([0.25, -0.5, 0.75, 1])
    const first = record({
      id: 'm_1',
      text: '用户偏好 TypeScript 和 pnpm。',
      vec: Buffer.from(vector.buffer).toString('base64'),
      model: 'm',
      dim: 4,
      details: { symptom: 'ERR_X', fix: 'pnpm install' },
      signature: 'sig-a',
      scope: 'workspace',
      workspace: '/work',
      tags: ['pnpm'],
    })
    const second = record({ id: 'm_2', text: '项目部署在 NAS 上，用 Docker Compose 管理。', scope: 'workspace', workspace: '/work', tags: ['pnpm'] })
    await store.put(first)
    await store.put(second)
    assert.equal(store.size, 2)
    assert.equal(store.get('m_1').text, first.text)
    assert.deepEqual({ ...store.get('m_1').details }, { symptom: 'ERR_X', fix: 'pnpm install' })
    assert.equal(store.get('m_1').status, 'active')
    assert.equal(store.get('m_1').signature, 'sig-a')
    assert.deepEqual([...store.get('m_1').tags], ['pnpm'])
    assert.equal(Buffer.from(store.get('m_1').vec, 'base64').byteLength, 16)

    // FTS5 keyword search over pre-tokenized CJK bigrams.
    const chinese = store.keywordSearch(tokenize('TypeScript 偏好'), { limit: 5 })
    assert.equal(chinese[0].id, 'm_1')
    const docker = store.keywordSearch(tokenize('Docker'), { limit: 5 })
    assert.equal(docker[0].id, 'm_2')
    assert.deepEqual(store.keywordSearch(tokenize('不存在的词'), { limit: 5 }), [])

    // Metadata filter stays in the caller; the store only returns ids.
    const filtered = store.keywordSearch(tokenize('TypeScript'), { allowed: new Set(['m_2']), limit: 5 })
    assert.equal(filtered.length, 0)

    // Update rewrites the row and its FTS document.
    const updated = await store.update('m_1', (current) => ({ ...current, text: '用户偏好 Rust。', updatedAt: current.updatedAt + 1 }))
    assert.equal(updated.text, '用户偏好 Rust。')
    assert.equal(store.keywordSearch(tokenize('Rust'), { limit: 5 })[0]?.id, 'm_1')
    assert.equal(store.keywordSearch(tokenize('TypeScript'), { limit: 5 }).length, 0)

    // Settings live in the meta table.
    await store.writeGlobal({ version: 1, retrieval: { defaultLimit: 6 } })
    assert.deepEqual(store.readGlobal(), { version: 1, retrieval: { defaultLimit: 6 } })

    // Graph hubs connect memories that share a project/signature/tag.
    await store.setGraphForMemory(first)
    await store.setGraphForMemory(second)
    assert.equal(store.graphRelated(['m_1'], { limit: 5 })[0]?.id, 'm_2')

    await store.delete('m_2')
    assert.equal(store.size, 1)
    await store.close()

    // Reopen: rows, vectors, FTS and settings all survive.
    const reopened = new SqliteStore({ dataDir: dir })
    await reopened.open()
    assert.equal(reopened.size, 1)
    assert.equal(reopened.get('m_1').text, '用户偏好 Rust。')
    assert.equal(reopened.keywordSearch(tokenize('Rust'), { limit: 5 })[0]?.id, 'm_1')
    assert.deepEqual(reopened.readGlobal(), { version: 1, retrieval: { defaultLimit: 6 } })
    await reopened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

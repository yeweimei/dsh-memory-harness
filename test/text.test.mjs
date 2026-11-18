import test from 'node:test'
import assert from 'node:assert/strict'
import { Bm25Index, cosine, decodeVector, encodeVector, hashText, normalizeText, rrfFuse, tokenize } from '../lib/text.js'
import { resolveConfig } from '../lib/config.js'

test('normalizeText lowercases, NFKC-normalizes and collapses whitespace', () => {
  assert.equal(normalizeText('  ＴｙｐｅＳｃｒｉｐｔ\n\t和  pnpm  '), 'typescript 和 pnpm')
})

test('tokenize splits CJK into bigrams and latin into words', () => {
  assert.deepEqual(tokenize('记忆插件设计'), ['记忆', '忆插', '插件', '件设', '设计'])
  assert.deepEqual(tokenize('TypeScript 和 pnpm'), ['typescript', '和', 'pnpm'])
  assert.deepEqual(tokenize('记忆'), ['记忆'])
  assert.deepEqual(tokenize('记'), ['记'])
  assert.deepEqual(tokenize('  '), [])
})

test('hashText is stable across whitespace and case', () => {
  assert.equal(hashText('Hello  World'), hashText('hello world'))
  assert.notEqual(hashText('hello world'), hashText('hello there'))
})

test('BM25 ranks the matching document first', () => {
  const index = new Bm25Index()
  index.add('a', tokenize('用户偏好 TypeScript 和 pnpm，不喜欢 npm。'))
  index.add('b', tokenize('项目部署在 NAS 上，用 Docker Compose 管理。'))
  index.add('c', tokenize('用户喜欢用 Python 写脚本。'))
  const hits = index.search(tokenize('TypeScript 偏好'))
  assert.equal(hits[0].id, 'a')
  assert.ok(hits[0].score > 0)
  index.remove('a')
  assert.equal(index.search(tokenize('TypeScript')).length, 0)
})

test('BM25 honours the allowed id filter', () => {
  const index = new Bm25Index()
  index.add('a', tokenize('TypeScript 偏好'))
  index.add('b', tokenize('TypeScript 项目'))
  const hits = index.search(tokenize('TypeScript'), { allowed: new Set(['b']) })
  assert.deepEqual(hits.map((hit) => hit.id), ['b'])
})

test('RRF prefers documents ranked by both routes', () => {
  const fused = rrfFuse([
    ['a', 'b'],
    ['b', 'c'],
  ])
  assert.deepEqual(fused.map((entry) => entry.id), ['b', 'a', 'c'])
})

test('vector codec round-trips normalized float32 values', () => {
  const vector = new Float32Array([0.25, -0.5, 0.75, 1])
  const payload = encodeVector(vector)
  const decoded = decodeVector(payload)
  assert.equal(decoded.length, vector.length)
  for (let index = 0; index < vector.length; index += 1) assert.ok(Math.abs(decoded[index] - vector[index]) < 1e-6)
  const normalized = vector.map((value) => value / Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)))
  const normalizedDecoded = decoded.map((value) => value / Math.sqrt(decoded.reduce((sum, item) => sum + item * item, 0)))
  assert.ok(Math.abs(cosine(normalizedDecoded, normalized) - 1) < 1e-6)
})

test('resolveConfig normalizes the endpoint and validates values', () => {
  const empty = resolveConfig({})
  assert.equal(empty.embedding.endpoint, '')
  assert.equal(empty.embedding.model, '')
  const config = resolveConfig({ embedding: { baseURL: 'http://127.0.0.1:9999/v1/', apiKey: 'k' } })
  assert.equal(config.embedding.endpoint, 'http://127.0.0.1:9999/v1/embeddings')
  assert.equal(config.embedding.dimensions, 1024)
  assert.equal(config.capture.defaultScope, 'workspace')
  assert.throws(() => resolveConfig({ embedding: { baseURL: 'ftp://x' } }), /embedding\.baseURL/)
  assert.throws(() => resolveConfig({ embedding: { dimensions: 0 } }), /embedding\.dimensions/)
  assert.throws(() => resolveConfig({ retrieval: { defaultLimit: 30, maxLimit: 10 } }), /maxLimit/)

  const storage = resolveConfig({ storage: { backend: 'domain', dataDir: '/tmp/dsh-memory-test' } })
  assert.equal(storage.storage.backend, 'domain')
  assert.equal(storage.storage.dataDir, '/tmp/dsh-memory-test')
  assert.equal(resolveConfig({}).storage.backend, 'sqlite')
  const capture = resolveConfig({
    capture: {
      llm: { baseURL: 'http://127.0.0.1:9999/v1/', model: 'test-chat-model', contextWindow: 16384, maxOutputTokens: 2000, timeoutMs: 60000 },
      extractDebounceMs: 20000,
    },
  })
  assert.equal(capture.capture.llm.baseURL, 'http://127.0.0.1:9999/v1')
  assert.equal(capture.capture.llm.model, 'test-chat-model')
  assert.equal(capture.capture.llm.contextWindow, 16384)
  assert.equal(capture.capture.extractDebounceMs, 20000)
  assert.equal(resolveConfig({}).capture.llm.baseURL, '')
  const defaults = resolveConfig({})
  assert.equal(defaults.capture.admission.enabled, true)
  assert.equal(defaults.capture.admission.minConfidence, 0.7)
  const admission = resolveConfig({ capture: { admission: { enabled: false, minConfidence: 0.9, maxPerRun: 3, includeRules: false } } })
  assert.equal(admission.capture.admission.enabled, false)
  assert.equal(admission.capture.admission.minConfidence, 0.9)
  assert.equal(admission.capture.admission.maxPerRun, 3)
  const maintenance = resolveConfig({ maintenance: { consolidateIntervalHours: 6, nearMergeSimilarity: 0.9, staleAfterDays: 30, maxConsolidateOps: 5 } })
  assert.equal(maintenance.maintenance.consolidateIntervalHours, 6)
  assert.equal(maintenance.maintenance.nearMergeSimilarity, 0.9)
  assert.equal(maintenance.maintenance.staleAfterDays, 30)
  assert.equal(resolveConfig({}).inject.budgets.digest, 600)
  assert.equal(resolveConfig({}).maintenance.backupsKeep, 10)
  assert.equal(resolveConfig({}).maintenance.backupIntervalHours, 24)
  assert.equal(resolveConfig({}).maintenance.eventKeep, 10000)
  assert.equal(resolveConfig({}).maintenance.eventRetentionDays, 30)
  assert.throws(() => resolveConfig({ maintenance: { nearMergeSimilarity: 2 } }), /nearMergeSimilarity/)
  assert.throws(() => resolveConfig({ capture: { extractDebounceMs: 10 } }), /extractDebounceMs/)
  assert.throws(() => resolveConfig({ capture: { llm: { baseURL: 'ftp://x' } } }), /llm\.baseURL/)
  assert.throws(() => resolveConfig({ capture: { llm: { contextWindow: 10 } } }), /llm\.contextWindow/)
  assert.throws(() => resolveConfig({ storage: { backend: 'redis' } }), /storage\.backend/)
})

#!/usr/bin/env node
/**
 * LongMemEval oracle retrieval-only evaluation.
 *
 * This evaluates the plugin's hybrid retrieval layer without extraction or an
 * LLM reader. Each turn from the oracle history is stored as a session-scoped
 * memory; a question is queried through MemoryService.search and judged against
 * LongMemEval's session-level and turn-level evidence labels.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../../lib/config.js'
import { EmbeddingClient } from '../../lib/embed.js'
import { MemoryService } from '../../lib/service.js'
import { SqliteStore } from '../../lib/sqlite-store.js'
import { encodeVector, hashText } from '../../lib/text.js'

const DEFAULTS = {
  data: fileURLToPath(new URL('./data/longmemeval_oracle.json', import.meta.url)),
  limit: 50,
  seed: 42,
  k: '5,10',
  baseURL: process.env.LONGMEMEVAL_BASE_URL ?? 'http://127.0.0.1:7000/v1',
  model: process.env.LONGMEMEVAL_MODEL ?? 'Qwen3-embedding-0.6B',
  dimensions: Number(process.env.LONGMEMEVAL_DIMENSIONS ?? 1024),
  timeoutMs: Number(process.env.LONGMEMEVAL_TIMEOUT_MS ?? 60000),
  batchSize: Number(process.env.LONGMEMEVAL_BATCH_SIZE ?? 4),
  maxChars: Number(process.env.LONGMEMEVAL_MAX_CHARS ?? 1000),
  out: '',
  includeAbstention: false,
  granularity: 'turn',
}

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: DEFAULTS.data },
    limit: { type: 'string', default: String(DEFAULTS.limit) },
    seed: { type: 'string', default: String(DEFAULTS.seed) },
    k: { type: 'string', default: DEFAULTS.k },
    'base-url': { type: 'string', default: DEFAULTS.baseURL },
    model: { type: 'string', default: DEFAULTS.model },
    dimensions: { type: 'string', default: String(DEFAULTS.dimensions) },
    'timeout-ms': { type: 'string', default: String(DEFAULTS.timeoutMs) },
    'batch-size': { type: 'string', default: String(DEFAULTS.batchSize) },
    'max-chars': { type: 'string', default: String(DEFAULTS.maxChars) },
    out: { type: 'string', default: DEFAULTS.out },
    'include-abstention': { type: 'boolean', default: DEFAULTS.includeAbstention },
    granularity: { type: 'string', default: DEFAULTS.granularity },
  },
  allowNegative: false,
})

const limit = Math.max(1, Math.min(500, Number.parseInt(values.limit, 10) || DEFAULTS.limit))
const ks = [...new Set(values.k.split(',').map((value) => Number.parseInt(value, 10)).filter((value) => value > 0 && value <= 20))].sort((a, b) => a - b)
if (ks.length === 0) throw new Error('--k must contain at least one positive integer <= 20')
const maxK = Math.max(...ks)
const granularity = values.granularity === 'session' ? 'session' : 'turn'

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Round-robin sample across question types so a 50-question run is not one type. */
function sampleQuestions(all, count, seed) {
  const random = seededRandom(seed)
  const groups = new Map()
  for (const item of all) {
    if (!Array.isArray(item.answer_session_ids) || item.answer_session_ids.length === 0) continue
    const type = item.question_type ?? 'unknown'
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(item)
  }
  for (const rows of groups.values()) {
    for (let index = rows.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1))
      ;[rows[index], rows[swap]] = [rows[swap], rows[index]]
    }
  }
  const queues = [...groups.values()]
  const sampled = []
  while (sampled.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const item = queue.shift()
      if (item !== undefined) sampled.push(item)
      if (sampled.length >= count) break
    }
  }
  return sampled
}

function dcgAtK(relevances, k) {
  let value = 0
  for (let index = 0; index < Math.min(k, relevances.length); index += 1) {
    if (relevances[index] === 1) value += 1 / Math.log2(index + 2)
  }
  return value
}

function ndcgAtK(relevances, k) {
  const ideal = Math.min(k, relevances.filter((value) => value === 1).length)
  if (ideal === 0) return null
  return dcgAtK(relevances, k) / dcgAtK(Array(ideal).fill(1), k)
}

function firstRelevantRank(relevances) {
  const index = relevances.findIndex((value) => value === 1)
  return index < 0 ? null : index + 1
}

function summarize(rows, ks) {
  const result = { questions: rows.length, session: {}, turn: {} }
  for (const [label, key] of [['session', 'sessionRelevance'], ['turn', 'turnRelevance']]) {
    const useful = rows.filter((row) => Array.isArray(row[key]) && row[key].some((value) => value === 1))
    const mrrRows = rows.filter((row) => firstRelevantRank(row[key]) !== null)
    result[label].mrr = mrrRows.length === 0 ? null : mrrRows.reduce((sum, row) => sum + 1 / firstRelevantRank(row[key]), 0) / rows.length
    result[label].ndcg = rows.reduce((sum, row) => sum + (ndcgAtK(row[key], Math.max(...ks)) ?? 0), 0) / rows.length
    for (const k of ks) {
      result[label][`recall@${k}`] = rows.reduce((sum, row) => sum + (row[key].slice(0, k).some((value) => value === 1) ? 1 : 0), 0) / rows.length
    }
    result[label].questionsWithEvidence = useful.length
  }
  return result
}

function formatMetric(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}

async function main() {
  const all = JSON.parse(readFileSync(values.data, 'utf8'))
  const candidates = values['include-abstention']
    ? all
    : all.filter((item) => !String(item.question_id).endsWith('_abs'))
  const questions = sampleQuestions(candidates, limit, Number(values.seed) || DEFAULTS.seed)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-longmemeval-'))
  const rawConfig = {
    storage: { backend: 'sqlite', dataDir },
    embedding: {
      baseURL: values['base-url'],
      model: values.model,
      dimensions: Number(values.dimensions) || DEFAULTS.dimensions,
      timeoutMs: Number(values['timeout-ms']) || DEFAULTS.timeoutMs,
      batchSize: Math.max(1, Math.min(64, Number(values['batch-size']) || DEFAULTS.batchSize)),
    },
    capture: { mode: 'off', conflictDetection: false },
    graph: { enabled: false },
    retention: { maxRecords: 200000 },
  }
  const config = resolveConfig(rawConfig)
  const store = new SqliteStore({ dataDir })
  const embedder = new EmbeddingClient(config.embedding, { warn: (message) => console.warn(`[embed] ${message}`) })
  const service = new MemoryService({ ctx: {}, rawConfig, store, embedder, logger: { warn: () => {} } })
  await service.load()
  try {
    console.log(`dataset: ${values.data}`)
    console.log(`granularity: ${granularity}`)
    console.log(`questions: ${questions.length} / ${candidates.length} eligible (seed ${values.seed}, abstention ${values['include-abstention'] ? 'included' : 'excluded'})`)
    console.log(`embedding: ${values['base-url']} model=${values.model} dim=${values.dimensions}`)
    let seeded = 0
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const question = questions[questionIndex]
      const evalSessionId = `eval-${question.question_id}`
      const units = []
      const maxChars = Math.max(1, Number(values['max-chars']) || DEFAULTS.maxChars)
      for (let sessionIndex = 0; sessionIndex < question.haystack_sessions.length; sessionIndex += 1) {
        const sessionId = question.haystack_session_ids[sessionIndex]
        const turns = question.haystack_sessions[sessionIndex]
        if (granularity === 'session') {
          const text = turns
            .filter((turn) => typeof turn?.content === 'string' && turn.content.trim() !== '')
            .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content.trim()}`)
            .join('\n')
          if (text === '') continue
          units.push({ sessionId, turnIndex: null, hasAnswer: turns.some((turn) => turn?.has_answer === true), text: text.slice(0, maxChars) })
          continue
        }
        for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
          const turn = turns[turnIndex]
          if (typeof turn?.content !== 'string' || turn.content.trim() === '') continue
          units.push({
            sessionId,
            turnIndex,
            hasAnswer: turn.has_answer === true,
            text: `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content.trim().slice(0, maxChars)}`,
          })
        }
      }
      if (units.length === 0) continue
      const batchSize = Math.max(1, Math.min(64, Number(values['batch-size']) || DEFAULTS.batchSize))
      const vectors = []
      for (let offset = 0; offset < units.length; offset += batchSize) {
        const chunk = units.slice(offset, offset + batchSize)
        const chunkVectors = await embedder.documents(chunk.map((unit) => unit.text))
        if (chunkVectors.length !== chunk.length) throw new Error(`embedding returned ${chunkVectors.length}/${chunk.length} vectors for ${question.question_id}`)
        vectors.push(...chunkVectors)
      }
      for (let index = 0; index < units.length; index += 1) {
        const unit = units[index]
        const vector = vectors[index]
        if (vector === undefined) throw new Error(`embedding returned no vector for ${question.question_id} unit ${index}`)
        const id = `m_lme_${questionIndex}_${index}`
        const record = {
          v: 1,
          id,
          text: unit.text,
          kind: 'other',
          scope: 'session',
          workspace: null,
          sessionId: evalSessionId,
          tags: ['longmemeval'],
          importance: 3,
          vec: encodeVector(vector),
          model: config.embedding.model,
          dim: config.embedding.dimensions,
          hash: hashText(unit.text),
          source: { kind: 'evaluation', questionId: question.question_id },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          details: {
            evaluation: {
              questionId: question.question_id,
              evidenceSessionId: unit.sessionId,
              turnIndex: unit.turnIndex,
              hasAnswer: unit.hasAnswer,
            },
          },
          status: 'active',
          signature: null,
          tier: 'working',
          revision: 1,
          supersededBy: null,
          validFrom: Date.now(),
          archivedAt: null,
          lastUsedAt: null,
          useCount: 0,
          helpfulCount: 0,
          qualityScore: 0,
          needsReview: false,
          reviewReason: null,
          validUntil: null,
        }
        await store.put(record)
        service.indexRecord(record)
        seeded += 1
      }
    }
    console.log(`seeded memories: ${seeded}`)
    const rows = []
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const question = questions[questionIndex]
      const evalSessionId = `eval-${question.question_id}`
      const answerSessions = new Set(question.answer_session_ids ?? [])
      const result = await service.search(
        { query: question.question, scope: 'session', limit: maxK, status: 'active' },
        { sessionId: evalSessionId, workspace: null },
        { recordRecall: false },
      )
      const sessionRelevance = []
      const turnRelevance = []
      const retrieved = []
      for (const memory of result.memories) {
        const record = store.get(memory.id)
        const evaluation = record?.details?.evaluation
        const relevantSession = evaluation !== undefined && answerSessions.has(evaluation.evidenceSessionId)
        sessionRelevance.push(relevantSession ? 1 : 0)
        turnRelevance.push(evaluation?.hasAnswer === true ? 1 : 0)
        retrieved.push({
          sessionId: evaluation?.evidenceSessionId ?? null,
          turnIndex: evaluation?.turnIndex ?? null,
          hasAnswer: evaluation?.hasAnswer === true,
          sessionRelevant: relevantSession,
          text: memory.text.slice(0, 180),
        })
      }
      rows.push({
        questionId: question.question_id,
        questionType: question.question_type,
        question: question.question,
        answer: question.answer,
        answerSessions: [...answerSessions],
        sessionRelevance,
        turnRelevance,
        retrieved,
      })
      if ((questionIndex + 1) % 10 === 0 || questionIndex + 1 === questions.length) {
        console.log(`retrieved ${questionIndex + 1}/${questions.length}`)
      }
    }
    const overall = summarize(rows, ks)
    const byType = {}
    for (const type of [...new Set(rows.map((row) => row.questionType))].sort()) {
      byType[type] = summarize(rows.filter((row) => row.questionType === type), ks)
    }
    if (granularity === 'session') {
      overall.turn = { unsupported: 'session-granularity run has no turn-level labels' }
      for (const metrics of Object.values(byType)) metrics.turn = { unsupported: 'session-granularity run has no turn-level labels' }
    }
    const report = { generatedAt: new Date().toISOString(), dataset: values.data, granularity, limit, seed: Number(values.seed), ks, embedding: { baseURL: values['base-url'], model: values.model, dimensions: Number(values.dimensions) }, overall, byType, questions: rows }
    if (values.out !== '') {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(values.out, JSON.stringify(report, null, 2))
      console.log(`report: ${values.out}`)
    }
    console.log('\n== overall (session-level / turn-level) ==')
    console.log(`session recall@${ks.join('/')}: ${ks.map((k) => formatMetric(overall.session[`recall@${k}`])).join(' / ')}  MRR ${formatMetric(overall.session.mrr)}  nDCG@${maxK} ${formatMetric(overall.session.ndcg)}`)
    console.log(`turn    recall@${ks.join('/')}: ${ks.map((k) => formatMetric(overall.turn[`recall@${k}`])).join(' / ')}  MRR ${formatMetric(overall.turn.mrr)}  nDCG@${maxK} ${formatMetric(overall.turn.ndcg)}`)
    console.log('\n== by question type (session recall@10 / turn recall@10) ==')
    for (const [type, metrics] of Object.entries(byType)) {
      console.log(`${type.padEnd(28)} n=${String(metrics.questions).padStart(3)}  session ${formatMetric(metrics.session[`recall@${ks[ks.length - 1]}`])}  turn ${formatMetric(metrics.turn[`recall@${ks[ks.length - 1]}`])}`)
    }
    const misses = rows.filter((row) => !row.sessionRelevance.slice(0, ks[ks.length - 1]).some((value) => value === 1)).slice(0, 3)
    if (misses.length > 0) {
      console.log('\n== sample misses (session level) ==')
      for (const miss of misses) {
        console.log(`- ${miss.questionId} [${miss.questionType}] ${miss.question}`)
        console.log(`  answer: ${String(miss.answer).slice(0, 160)}`)
        console.log(`  targets: ${miss.answerSessions.join(', ')}`)
        console.log(`  top: ${miss.retrieved.slice(0, 3).map((item) => `${item.sessionId}${item.hasAnswer ? '✓' : ''}`).join(' | ')}`)
      }
    }
  } finally {
    await service.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})

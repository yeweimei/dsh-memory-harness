/** Shared sampling and seeding helpers for LongMemEval evaluations. */
import { encodeVector, hashText } from '../../lib/text.js'

export function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Stratified sample across question types. */
export function sampleQuestions(all, { limit = 50, seed = 42, abstentionLimit = 0, includeAbstention = false } = {}) {
  const random = seededRandom(seed)
  const normal = all.filter((item) => !String(item.question_id).endsWith('_abs'))
  const abstention = all.filter((item) => String(item.question_id).endsWith('_abs'))
  const groups = new Map()
  for (const item of normal) {
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
  while (sampled.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const item = queue.shift()
      if (item !== undefined) sampled.push(item)
      if (sampled.length >= limit) break
    }
  }
  if (includeAbstention && abstentionLimit > 0) {
    const pool = abstention.slice()
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1))
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    sampled.push(...pool.slice(0, abstentionLimit))
  }
  return sampled
}

export function sessionUnits(question, { granularity = 'session', maxChars = 2000 } = {}) {
  const units = []
  for (let sessionIndex = 0; sessionIndex < question.haystack_sessions.length; sessionIndex += 1) {
    const sessionId = question.haystack_session_ids[sessionIndex]
    const turns = question.haystack_sessions[sessionIndex]
    const date = Array.isArray(question.haystack_dates) ? question.haystack_dates[sessionIndex] : ''
    const prefix = typeof date === 'string' && date !== '' ? `[Session date: ${date}]\n` : ''
    if (granularity === 'session' || granularity === 'chunk') {
      const text = turns
        .filter((turn) => typeof turn?.content === 'string' && turn.content.trim() !== '')
        .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content.trim()}`)
        .join('\n')
      if (text === '') continue
      const full = `${prefix}${text}`
      const hasAnswer = turns.some((turn) => turn?.has_answer === true)
      if (granularity === 'session') {
        units.push({ sessionId, turnIndex: null, hasAnswer, text: full.slice(0, maxChars) })
      } else {
        const size = Math.max(200, maxChars)
        const overlap = Math.min(200, Math.floor(size * 0.15))
        for (let offset = 0; offset < full.length; offset += size - overlap) {
          units.push({ sessionId, turnIndex: null, chunkIndex: Math.floor(offset / (size - overlap)), hasAnswer, text: full.slice(offset, offset + size) })
          if (offset + size >= full.length) break
        }
      }
      continue
    }
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex]
      if (typeof turn?.content !== 'string' || turn.content.trim() === '') continue
      units.push({
        sessionId,
        turnIndex,
        hasAnswer: turn.has_answer === true,
        text: `${prefix}${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content.trim()}`.slice(0, maxChars),
      })
    }
  }
  return units
}

/** Seed one question's units as session-scoped memories. */
export async function seedQuestion({ service, store, embedder, config, question, questionIndex, granularity = 'session', maxChars = 2000, batchSize = 8 }) {
  const evalSessionId = `eval-${question.question_id}`
  const units = sessionUnits(question, { granularity, maxChars })
  if (units.length === 0) return { evalSessionId, seeded: 0 }
  const vectors = []
  const size = Math.max(1, Math.min(64, batchSize))
  for (let offset = 0; offset < units.length; offset += size) {
    const chunk = units.slice(offset, offset + size)
    const chunkVectors = await embedder.documents(chunk.map((unit) => unit.text))
    if (chunkVectors.length !== chunk.length) throw new Error(`embedding returned ${chunkVectors.length}/${chunk.length} vectors for ${question.question_id}`)
    vectors.push(...chunkVectors)
  }
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]
    const record = {
      v: 1,
      id: `m_lme_${questionIndex}_${index}`,
      text: unit.text,
      kind: 'other',
      scope: 'session',
      workspace: null,
      sessionId: evalSessionId,
      tags: ['longmemeval'],
      importance: 3,
      vec: encodeVector(vectors[index]),
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
          chunkIndex: unit.chunkIndex ?? null,
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
  }
  return { evalSessionId, seeded: units.length }
}

export async function retrieve(service, question, { evalSessionId, topK = 10 }) {
  return service.search(
    { query: question.question, scope: 'session', limit: topK, status: 'active' },
    { sessionId: evalSessionId, workspace: null },
    { recordRecall: false },
  )
}

export function normalizeAnswer(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenF1(prediction, reference) {
  const pred = normalizeAnswer(prediction).split(' ').filter(Boolean)
  const ref = normalizeAnswer(reference).split(' ').filter(Boolean)
  if (pred.length === 0 || ref.length === 0) return 0
  const predCounts = new Map()
  for (const token of pred) predCounts.set(token, (predCounts.get(token) ?? 0) + 1)
  let overlap = 0
  for (const token of ref) {
    const count = predCounts.get(token) ?? 0
    if (count > 0) {
      overlap += 1
      predCounts.set(token, count - 1)
    }
  }
  if (overlap === 0) return 0
  const precision = overlap / pred.length
  const recall = overlap / ref.length
  return (2 * precision * recall) / (precision + recall)
}

export function isAbstention(question) {
  return String(question.question_id).endsWith('_abs')
}

export function parseJudge(raw) {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  if (open < 0 || close <= open) return null
  try {
    const parsed = JSON.parse(text.slice(open, close + 1))
    if (typeof parsed?.correct !== 'boolean') return null
    return { correct: parsed.correct, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
  } catch {
    const match = /"correct"\s*:\s*(true|false)/i.exec(text)
    if (match === null) return null
    return { correct: match[1].toLowerCase() === 'true', reason: '' }
  }
}

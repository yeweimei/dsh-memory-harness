/**
 * Text utilities shared by the memory index: normalization, tokenization
 * (CJK bigrams + latin words), BM25, reciprocal-rank fusion and vector codecs.
 *
 * Everything here is pure and dependency-free so it can be unit-tested with
 * `node --test` outside the harness.
 */
import { createHash } from 'node:crypto'

const HAN_RUN = /\p{Script=Han}+/u
const WORD_RUN = /[\p{Letter}\p{Number}_]+/gu
const CJK_CHAR = /\p{Script=Han}/u

/**
 * Canonical comparison form: NFKC, lowercase, collapsed whitespace.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Stable content hash used for the exact-duplicate fast path.
 * @param {string} value
 * @returns {string}
 */
export function hashText(value) {
  return createHash('sha1').update(normalizeText(value)).digest('hex')
}

/**
 * Split text into index terms. CJK runs become overlapping bigrams (with a
 * single-character fallback for one-character runs); other scripts become
 * whitespace/punctuation-delimited lowercase words.
 * @param {string} value
 * @returns {string[]}
 */
export function tokenize(value) {
  const normalized = normalizeText(value)
  if (normalized === '') return []
  const tokens = []
  const runs = normalized.match(/[\p{Script=Han}]+|[\p{Letter}\p{Number}_]+/gu) ?? []
  for (const run of runs) {
    if (HAN_RUN.test(run) && CJK_CHAR.test(run[0])) {
      const chars = Array.from(run)
      if (chars.length === 1) tokens.push(chars[0])
      else for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(chars[i] + chars[i + 1])
    } else {
      tokens.push(run.toLowerCase())
    }
  }
  return tokens
}

/**
 * BM25 inverted index over an in-memory corpus.
 *
 * `add` replaces the document's postings; `remove` drops them. `search`
 * returns the best-scoring documents, optionally restricted to an allowed id
 * set (metadata filters are applied before scoring by the caller).
 */
export class Bm25Index {
  /**
   * @param {{ k1?: number, b?: number }} [options]
   */
  constructor({ k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1
    this.b = b
    /** @type {Map<string, Map<string, number>>} document id -> term frequencies */
    this.documents = new Map()
    /** @type {Map<string, Map<string, number>>} term -> (document id -> frequency) */
    this.postings = new Map()
    /** @type {Map<string, number>} document id -> token count */
    this.lengths = new Map()
    this.totalLength = 0
  }

  get size() {
    return this.documents.size
  }

  /**
   * @param {string} id
   * @param {string[]} tokens
   */
  add(id, tokens) {
    this.remove(id)
    if (tokens.length === 0) return
    const frequencies = new Map()
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    this.documents.set(id, frequencies)
    this.lengths.set(id, tokens.length)
    this.totalLength += tokens.length
    for (const [token, frequency] of frequencies) {
      let posting = this.postings.get(token)
      if (posting === undefined) {
        posting = new Map()
        this.postings.set(token, posting)
      }
      posting.set(id, frequency)
    }
  }

  /** @param {string} id */
  remove(id) {
    const frequencies = this.documents.get(id)
    if (frequencies === undefined) return
    this.documents.delete(id)
    this.totalLength -= this.lengths.get(id) ?? 0
    this.lengths.delete(id)
    for (const token of frequencies.keys()) {
      const posting = this.postings.get(token)
      if (posting === undefined) continue
      posting.delete(id)
      if (posting.size === 0) this.postings.delete(token)
    }
  }

  /**
   * @param {string[]} queryTokens
   * @param {{ allowed?: Set<string> | undefined, limit?: number }} [options]
   * @returns {{ id: string, score: number }[]}
   */
  search(queryTokens, { allowed, limit = 50 } = {}) {
    const documentCount = this.documents.size
    if (documentCount === 0 || queryTokens.length === 0) return []
    const averageLength = this.totalLength / documentCount || 1
    /** @type {Map<string, number>} */
    const scores = new Map()
    for (const token of new Set(queryTokens)) {
      const posting = this.postings.get(token)
      if (posting === undefined) continue
      const documentFrequency = posting.size
      const inverseDocumentFrequency = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
      for (const [id, frequency] of posting) {
        if (allowed !== undefined && !allowed.has(id)) continue
        const length = this.lengths.get(id) ?? 0
        const denominator = frequency + this.k1 * (1 - this.b + (this.b * length) / averageLength)
        const score = inverseDocumentFrequency * ((frequency * (this.k1 + 1)) / denominator)
        scores.set(id, (scores.get(id) ?? 0) + score)
      }
    }
    return [...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }))
  }
}

/**
 * Reciprocal-rank fusion. Lists are ranked id arrays; the returned entries are
 * ordered by fused score descending. RRF only uses ranks, so cosine
 * similarities and BM25 scores never need a shared scale.
 * @param {readonly string[][]} lists
 * @param {number} [k]
 * @returns {{ id: string, score: number }[]}
 */
export function rrfFuse(lists, k = 60) {
  const scores = new Map()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const id = list[rank]
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
    }
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id, score]) => ({ id, score }))
}

/** @param {Float32Array} vector */
export function normalizeVector(vector) {
  let sum = 0
  for (let index = 0; index < vector.length; index += 1) sum += vector[index] * vector[index]
  if (sum === 0) return vector
  const scale = 1 / Math.sqrt(sum)
  const normalized = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index] * scale
  return normalized
}

/**
 * @param {Float32Array} left normalized
 * @param {Float32Array} right normalized
 * @returns {number}
 */
export function cosine(left, right) {
  const length = Math.min(left.length, right.length)
  let score = 0
  for (let index = 0; index < length; index += 1) score += left[index] * right[index]
  return score
}

/**
 * @param {Float32Array} vector
 * @returns {string} base64 little-endian float32 payload
 */
export function encodeVector(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')
}

/**
 * @param {string} payload
 * @returns {Float32Array}
 */
export function decodeVector(payload) {
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) {
    throw new Error('memory vector payload has an invalid byte length')
  }
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Float32Array(copy)
}

/**
 * Redact secret-shaped tokens before storing evidence or sending text to a model.
 * @param {string} value
 * @returns {string}
 */
export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/\b(?:sk|ghp|gho|ghu|ghs|xox[baprs])-[A-Za-z0-9_-]{10,}\b/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '<hex>')
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g

/**
 * Normalize an error into a stable signature key. Volatile ids, uuids, timestamps,
 * paths and line numbers are removed so the same failure matches across runs.
 * @param {string} value
 * @returns {string}
 */
export function normalizeErrorText(value) {
  const cleaned = redactSecrets(String(value ?? '')).replace(ANSI_ESCAPE, '')
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\[(?:stderr|stdout|exit code|error)\]\s*/i, '').trim())
    .filter((line) => line !== '')
  const specific = /(?:no such file|not found|permission denied|err_[a-z0-9]+|enoent|eacces|error[:\s]|exception|traceback|command not found|already exists|conflict|invalid)/i
  const general = /(?:failed|failure|fatal)/i
  const selected = lines.find((line) => specific.test(line)) ?? lines.find((line) => general.test(line)) ?? lines[0] ?? ''
  const firstLine = selected
  return firstLine
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<time>')
    .replace(/:\d+\b/g, ':<line>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 240)
}

/**
 * Stable short key for a failure signature.
 * @param {string} value
 * @returns {string}
 */
export function errorSignature(value) {
  const normalized = normalizeErrorText(value)
  if (normalized === '') return ''
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16)
}

/** @param {number} timestamp */
export function daysSince(timestamp) {
  const now = Date.now()
  const then = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : now
  return Math.max(0, (now - then) / 86400000)
}

/** @param {number} value @param {number} [digits] */
export function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * OpenAI-compatible embedding client for a user-configured endpoint.
 *
 * Responsibilities stay narrow: format the request (documents raw, queries with
 * the optional `Instruct/Query` prefix), enforce a timeout, normalize vectors, and
 * trip a short circuit breaker so a dead endpoint does not add seconds to every
 * memory call.
 */
import { normalizeVector } from './text.js'

const BREAKER_COOLDOWN_MS = 30000

/**
 * @typedef {object} EmbeddingConfig
 * @property {string} endpoint
 * @property {string} apiKey
 * @property {string} model
 * @property {number} dimensions
 * @property {number} timeoutMs
 * @property {string} queryInstruction
 */

export class EmbeddingClient {
  /**
   * @param {EmbeddingConfig} config
   * @param {{ warn?: (message: string) => void }} [logger]
   */
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.blockedUntil = 0
    this.lastError = null
  }

  /**
   * @param {string[]} texts
   * @param {{ signal?: AbortSignal, query?: boolean, ignoreBreaker?: boolean }} [options]
   * @returns {Promise<Float32Array[]>}
   */
  async embed(texts, { signal, query = false, ignoreBreaker = false } = {}) {
    const list = Array.isArray(texts) ? texts : [texts]
    if (list.length === 0) return []
    if (this.config.endpoint === '') throw new Error('embedding endpoint is not configured; set embedding.baseURL and embedding.model in settings')
    if (!ignoreBreaker && Date.now() < this.blockedUntil) {
      throw new Error('embedding service is cooling down after a recent failure')
    }
    const payload = list.map((text) => this.formatInput(text, query))
    const body = JSON.stringify({ model: this.config.model, input: payload })
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const composite = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    /** @type {Response} */
    let response
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: composite,
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      this.trip(error)
      throw new Error(`embedding request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const detail = await safeText(response)
      this.trip(`status ${response.status}`)
      throw new Error(`embedding endpoint returned ${response.status}${detail === '' ? '' : `: ${detail}`}`)
    }
    let parsed
    try {
      parsed = await response.json()
    } catch (error) {
      this.trip(error)
      throw new Error(`embedding endpoint returned invalid JSON: ${String(error)}`)
    }
    const rows = parsed?.data
    if (!Array.isArray(rows) || rows.length !== list.length) {
      this.trip('unexpected response shape')
      throw new Error(`embedding endpoint returned ${Array.isArray(rows) ? rows.length : 'no'} vectors for ${list.length} inputs`)
    }
    return rows.map((row, index) => this.toVector(row, index))
  }

  /**
   * Embed one query (with the instruction prefix).
   * @param {string} text
   * @param {{ signal?: AbortSignal, ignoreBreaker?: boolean }} [options]
   * @returns {Promise<Float32Array>}
   */
  async query(text, options = {}) {
    const vectors = await this.embed([text], { ...options, query: true })
    return vectors[0]
  }

  /**
   * Embed documents (no instruction prefix).
   * @param {string[]} texts
   * @param {{ signal?: AbortSignal, ignoreBreaker?: boolean }} [options]
   * @returns {Promise<Float32Array[]>}
   */
  async documents(texts, options = {}) {
    return this.embed(texts, { ...options, query: false })
  }

  /** Probe the endpoint for the settings page and `stats`. */
  async health() {
    const startedAt = Date.now()
    try {
      const vector = await this.query('记忆服务健康检查', { ignoreBreaker: true })
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        dimensions: vector.length,
        model: this.config.model,
      }
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        model: this.config.model,
        error: error instanceof Error ? error.message : String(error),
        coolingDown: Date.now() < this.blockedUntil,
      }
    }
  }

  /** Reset the breaker (used after a successful health probe from the UI). */
  resetBreaker() {
    this.blockedUntil = 0
  }

  /**
   * @param {string} text
   * @param {boolean} query
   * @returns {string}
   */
  formatInput(text, query) {
    if (!query || this.config.queryInstruction === '') return text
    return `Instruct: ${this.config.queryInstruction}\nQuery: ${text}`
  }

  headers() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.config.apiKey !== '') headers.Authorization = `Bearer ${this.config.apiKey}`
    return headers
  }

  /**
   * @param {{ embedding?: unknown }} row
   * @param {number} index
   * @returns {Float32Array}
   */
  toVector(row, index) {
    const embedding = row?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      this.trip('vector missing from response')
      throw new Error(`embedding row ${index} carries no vector`)
    }
    if (embedding.length !== this.config.dimensions) {
      this.trip('dimension mismatch')
      throw new Error(
        `embedding dimension mismatch: configured ${this.config.dimensions}, received ${embedding.length}`,
      )
    }
    const vector = new Float32Array(embedding.length)
    for (let position = 0; position < embedding.length; position += 1) {
      const value = embedding[position]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        this.trip('non-numeric vector value')
        throw new Error(`embedding row ${index} contains a non-numeric value at ${position}`)
      }
      vector[position] = value
    }
    return normalizeVector(vector)
  }

  /** @param {unknown} cause */
  trip(cause) {
    this.blockedUntil = Date.now() + BREAKER_COOLDOWN_MS
    this.lastError = cause instanceof Error ? cause.message : String(cause)
    this.logger?.warn?.(`dsh-memory: embedding endpoint unavailable (${this.lastError}); falling back to keyword retrieval`)
  }
}

async function safeText(response) {
  try {
    const text = await response.text()
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

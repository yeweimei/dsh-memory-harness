/**
 * Embedding API-key persistence through the Harness credential seam.
 *
 * The key never enters plugin settings, the profile patch, or the memory
 * database. It lives in one durable credential record owned by this plugin:
 * `dsh-memory/embedding-api-key`. An absent record means "no override"
 * (the loader row's apiKey or DSH_MEMORY_API_KEY applies); a record holding an
 * empty string is a deliberate clear and outranks every fallback.
 */

export const EMBEDDING_KEY = 'dsh-memory/embedding-api-key'
export const EXTRACTION_KEY = 'dsh-memory/extraction-api-key'

export class ApiKeyStore {
  /**
   * @param {any} credentials `ctx.credentials` service, when available
   * @param {string} [recordKey] credential record key owned by this store
   */
  constructor(credentials, recordKey = EMBEDDING_KEY) {
    this.credentials = credentials ?? null
    this.recordKey = recordKey
  }

  get available() {
    return this.credentials !== null && this.credentials !== undefined
  }

  /**
   * Read the persisted override.
   * @returns {Promise<string | undefined>} `undefined` when no record exists
   */
  async read() {
    if (!this.available) return undefined
    try {
      const record = await this.credentials.readRecord(this.recordKey)
      const payload = record?.payload
      if (payload === null || typeof payload !== 'object') return undefined
      return typeof payload.apiKey === 'string' ? payload.apiKey : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Persist an override. An empty string is stored deliberately so "cleared"
   * keeps meaning cleared even when the loader row ships a default key.
   * @param {string} apiKey
   */
  async set(apiKey) {
    if (typeof apiKey !== 'string') throw new Error('embedding API key must be a string')
    if (!this.available) throw new Error('credential store is unavailable; cannot save the embedding API key')
    await this.credentials.modifyRecord(this.recordKey, async () => ({
      kind: 'grant',
      payload: { version: 1, apiKey },
    }))
  }
}

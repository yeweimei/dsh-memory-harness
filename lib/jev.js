/**
 * TypeSafe Jev assessor for recall relevance.
 *
 * Jev is a System One model: it takes a state plus typed questions and returns
 * probabilities, not generated text. We use one `noul` question per recalled
 * memory: "this memory is relevant to the current query".
 *
 * The assessor is deliberately optional and never blocks retrieval. The caller
 * decides whether scores are shadow-only or used for reranking.
 */

function endpointFor(baseURL) {
  const trimmed = String(baseURL ?? '').trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  return /\/systemone$/i.test(trimmed) ? trimmed : `${trimmed}/systemone`
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export class JevAssessor {
  /**
   * @param {{ enabled?: boolean, baseURL?: string, model?: string, timeoutMs?: number, topK?: number, apiKey?: string }} config
   * @param {{ logger?: { warn?: (message: string) => void } }} [deps]
   */
  constructor(config, deps = {}) {
    this.config = config ?? {}
    this.logger = deps.logger
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch
  }

  get enabled() {
    return (
      this.config.enabled === true &&
      typeof this.fetchImpl === 'function' &&
      typeof this.config.baseURL === 'string' &&
      this.config.baseURL.trim() !== '' &&
      typeof this.config.model === 'string' &&
      this.config.model.trim() !== ''
    )
  }

  /**
   * Score the recalled records against one query.
   * @param {{ query: string, records: Record<string, any>[] }} input
   * @returns {Promise<{ model: string, latencyMs: number, results: { id: string, score: number | null, label: string | null, confidence: number | null, error?: string }[], usage?: any }>}
   */
  async assess({ query, records }) {
    if (!this.enabled) return { model: String(this.config.model ?? ''), latencyMs: 0, results: [] }
    const candidates = (Array.isArray(records) ? records : []).slice(0, Math.max(1, Math.min(20, Number(this.config.topK) || 10)))
    if (candidates.length === 0) return { model: this.config.model, latencyMs: 0, results: [] }
    const startedAt = Date.now()
    const state = [
      `User query: ${clip(query, 2000)}`,
      '',
      'Memory candidates:',
      ...candidates.map((record, index) => `Candidate ${index}: ${clip(record.text, 1000)}`),
    ].join('\n')
    const questions = {}
    for (let index = 0; index < candidates.length; index += 1) {
      questions[`m${index}`] = {
        type: 'noul',
        instructions: `Memory candidate ${index} is relevant to the user's current query.`,
      }
    }
    const response = await this.fetchImpl(endpointFor(this.config.baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(typeof this.config.apiKey === 'string' && this.config.apiKey.trim() !== ''
          ? { authorization: `Bearer ${this.config.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({ model: this.config.model, state, questions }),
      signal: AbortSignal.timeout(Math.max(500, Math.min(60000, Number(this.config.timeoutMs) || 10000))),
    })
    const text = await response.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Jev returned non-JSON (${response.status}): ${text.slice(0, 240)}`)
    }
    if (!response.ok) throw new Error(`Jev returned ${response.status}: ${JSON.stringify(parsed).slice(0, 300)}`)
    const answers = parsed?.answers ?? {}
    const results = candidates.map((record, index) => {
      const answer = answers[`m${index}`]
      const score = typeof answer?.noul === 'number' && Number.isFinite(answer.noul) ? Math.max(0, Math.min(1, answer.noul)) : null
      return {
        id: record.id,
        score,
        label: score === null ? null : score >= 0.5 ? 'relevant' : 'irrelevant',
        confidence: typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : null,
        ...(score === null ? { error: 'Jev did not return a noul probability' } : {}),
      }
    })
    return { model: typeof parsed?.model === 'string' ? parsed.model : String(this.config.model), latencyMs: Date.now() - startedAt, results, usage: parsed?.usage }
  }
}

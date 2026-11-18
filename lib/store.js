/**
 * Durable record store for dsh-memory.
 *
 * Records live in a profile storage domain (`ctx.storageDomain`) routed to the
 * configured backend — in this deployment the JSON backend under
 * `$DSH_HOME/storages`, with one document per memory. The domain validates each
 * record on open and makes every write durable before it resolves; the
 * in-memory index in `service.js` is a derived cache over these records.
 *
 * The domain spec is a hand-built object instead of a `defineDomain()` call:
 * this bundle is linked from the workspace, so bare package imports (zod and
 * `@deepseek-ai/dsh-storage-domain`) do not resolve. The runtime contract the
 * facility relies on is `tables[name].valueSchema.parse(record)`; schemas are
 * therefore implemented here as tiny validating objects.
 */
import { KINDS, SCOPES } from './config.js'
import { sanitizeStoredSettings } from './settings.js'

export const DOMAIN_NAME = 'dsh_memory'
export const DOMAIN_VERSION = 3
export const TABLE_NAME = 'records'
const RECORD_VERSION = 3
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const HASH_PATTERN = /^[0-9a-f]{40}$/
const MAX_TEXT_CHARS = 20000
const MAX_TAGS = 16

const SCOPES_SET = new Set(SCOPES)
const KINDS_SET = new Set(KINDS)

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeRecord(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('memory record must be an object')
  }
  const record = /** @type {Record<string, unknown>} */ (raw)
  if (record.v !== undefined && (typeof record.v !== 'number' || record.v < 1 || record.v > RECORD_VERSION)) {
    throw new Error(`memory record has unsupported version ${String(record.v)}`)
  }
  const id = requireString(record.id, 'id', 64)
  if (!ID_PATTERN.test(id)) throw new Error(`memory record id '${id}' is not a safe key`)
  const text = requireString(record.text, 'text', MAX_TEXT_CHARS)
  const kind = requireString(record.kind, 'kind', 32)
  if (!KINDS_SET.has(kind)) throw new Error(`memory record '${id}' has unknown kind '${kind}'`)
  const scope = requireString(record.scope, 'scope', 32)
  if (!SCOPES_SET.has(scope)) throw new Error(`memory record '${id}' has unknown scope '${scope}'`)
  const hash = requireString(record.hash, 'hash', 40)
  if (!HASH_PATTERN.test(hash)) throw new Error(`memory record '${id}' has an invalid hash`)
  const importance = integer(record.importance ?? 3, 'importance', 1, 5)
  const createdAt = timestamp(record.createdAt, 'createdAt')
  const updatedAt = timestamp(record.updatedAt ?? record.createdAt, 'updatedAt')
  const tags = normalizeTags(record.tags)
  const workspace = optionalString(record.workspace, 'workspace')
  const sessionId = optionalString(record.sessionId, 'sessionId')
  const vec = record.vec === null || record.vec === undefined ? null : requireString(record.vec, 'vec', 20000)
  const model = optionalString(record.model, 'model')
  const dimensions = record.dim === null || record.dim === undefined ? null : integer(record.dim, 'dim', 1, 8192)
  if ((vec === null) !== (model === null) || (vec === null) !== (dimensions === null)) {
    throw new Error(`memory record '${id}' must carry vec, model and dim together`)
  }
  const source = normalizeSource(record.source)
  const details = normalizeDetails(record.details)
  const status = normalizeStatus(record.status)
  const signature = optionalString(record.signature, 'signature')
  const tier = normalizeTier(record.tier, scope, kind)
  const revision = integer(record.revision ?? 1, 'revision', 1, 1000000)
  const supersededBy = optionalString(record.supersededBy, 'supersededBy')
  if (supersededBy !== null && !ID_PATTERN.test(supersededBy)) {
    throw new Error(`memory record '${id}' has an invalid supersededBy key`)
  }
  const validFrom = timestamp(record.validFrom ?? createdAt, 'validFrom')
  const archivedAt = record.archivedAt === null || record.archivedAt === undefined ? null : timestamp(record.archivedAt, 'archivedAt')
  const lastUsedAt = record.lastUsedAt === null || record.lastUsedAt === undefined ? null : timestamp(record.lastUsedAt, 'lastUsedAt')
  const useCount = integer(record.useCount ?? 0, 'useCount', 0, 1000000000)
  const helpfulCount = integer(record.helpfulCount ?? 0, 'helpfulCount', 0, 1000000000)
  const qualityScore = Number.isFinite(record.qualityScore) ? Math.max(-1, Math.min(1, Number(record.qualityScore))) : 0
  const needsReview = record.needsReview === true || record.needsReview === 1
  const reviewReason = optionalString(record.reviewReason, 'reviewReason')
  const validUntil = record.validUntil === null || record.validUntil === undefined ? null : timestamp(record.validUntil, 'validUntil')
  return {
    v: RECORD_VERSION,
    id,
    text,
    kind,
    scope,
    workspace,
    sessionId,
    tags,
    importance,
    vec,
    model,
    dim: dimensions,
    hash,
    source,
    createdAt,
    updatedAt,
    details,
    status,
    signature,
    tier,
    revision,
    supersededBy,
    validFrom,
    archivedAt,
    lastUsedAt,
    useCount,
    helpfulCount,
    qualityScore,
    needsReview,
    reviewReason,
    validUntil,
  }
}

function normalizeTier(value, scope, kind) {
  if (value === 'working' || value === 'semantic' || value === 'episodic') return value
  if (scope === 'session') return 'working'
  if (kind === 'summary') return 'episodic'
  return 'semantic'
}

function normalizeStatus(value) {
  if (value === undefined || value === null) return 'active'
  const allowed = ['active', 'candidate', 'dismissed', 'superseded', 'archived']
  if (!allowed.includes(value)) {
    throw new Error(`memory record status must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`)
  }
  return value
}

function normalizeDetails(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('memory record details must be an object')
  const json = JSON.stringify(value)
  if (json.length > 8000) throw new Error('memory record details exceed 8000 characters')
  return JSON.parse(json)
}

/** @param {unknown} raw */
function normalizeSource(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { sessionId: null, cwd: null, turn: null }
  }
  const source = /** @type {Record<string, unknown>} */ (raw)
  return {
    sessionId: optionalString(source.sessionId, 'source.sessionId'),
    cwd: optionalString(source.cwd, 'source.cwd'),
    turn: source.turn === null || source.turn === undefined ? null : integer(source.turn, 'source.turn', 0, 1e9),
  }
}

/** @param {unknown} raw */
function normalizeTags(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('memory record tags must be an array')
  if (raw.length > MAX_TAGS) throw new Error(`memory record carries more than ${MAX_TAGS} tags`)
  return raw.map((tag) => {
    if (typeof tag !== 'string' || tag.trim() === '') throw new Error('memory record tags must be non-empty strings')
    return tag.trim().slice(0, 64)
  })
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`memory record ${field} must be a non-empty string`)
  if (value.length > maxLength) throw new Error(`memory record ${field} exceeds ${maxLength} characters`)
  return value
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`memory record ${field} must be a string when present`)
  return value.length === 0 ? null : value
}

function integer(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`memory record ${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

function timestamp(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`memory record ${field} must be a non-negative timestamp`)
  }
  return value
}

/**
 * The domain declaration handed to `ctx.storageDomain.open()`.
 * `per-record` layout keeps one sizeable document (the 1024-d vector) per
 * memory, so point writes stay cheap and a corrupt document is quarantined
 * instead of rejecting the whole store.
 */
export const DOMAIN_SPEC = {
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    [TABLE_NAME]: {
      valueSchema: {
        /** @param {unknown} raw */
        parse(raw) {
          return normalizeRecord(raw)
        },
      },
    },
  },
  global: {
    /** Settings live in the global slot; a corrupt global degrades to `{}` instead of failing the open. */
    schema: {
      /** @param {unknown} raw */
      parse(raw) {
        return sanitizeStoredSettings(raw)
      },
    },
    initial: {},
  },
}

export class MemoryStore {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {import('@deepseek-ai/dsh-storage-domain').Domain<typeof DOMAIN_SPEC> | undefined} */
    this.domain = undefined
    /** @type {any} */
    this.table = undefined
    /** @type {any} */
    this.global = undefined
    /** @type {Map<string, Record<string, any>>} */
    this.records = new Map()
  }

  get size() {
    return this.records.size
  }

  get location() {
    return `storage-domain:${DOMAIN_NAME}`
  }

  /**
   * Open the domain and load every record into memory.
   * @returns {Promise<Map<string, Record<string, any>>>}
   */
  async open() {
    this.domain = await this.ctx.storageDomain.open(DOMAIN_SPEC)
    this.table = this.domain.table(TABLE_NAME)
    this.global = this.domain.global
    /** @type {Map<string, Record<string, any>>} */
    const records = new Map()
    for (const [id, record] of this.table.entries()) records.set(id, record)
    this.records = records
    return records
  }

  /** @param {string} id */
  get(id) {
    return this.records.get(id)
  }

  /** Current persisted user settings (empty object when nothing was saved). */
  readGlobal() {
    try {
      return this.global?.get?.() ?? {}
    } catch {
      return {}
    }
  }

  /** Persist the user settings layer. */
  async writeGlobal(value) {
    await this.global?.set?.(value)
  }

  *entries() {
    yield* this.records.entries()
  }

  /** @param {Record<string, any>} record */
  async put(record) {
    await this.table.put(record.id, record)
    this.records.set(record.id, record)
  }

  /**
   * Atomic read-modify-write; the transform runs on the domain's write chain.
   * @param {string} id
   * @param {(current: Record<string, any>) => Record<string, any>} transform
   */
  async update(id, transform) {
    const next = await this.table.update(id, transform)
    this.records.set(id, next)
    return next
  }

  /** @param {string} id */
  async delete(id) {
    const existed = await this.table.delete(id)
    this.records.delete(id)
    return existed
  }

  async close() {
    try {
      await this.domain?.close()
    } catch {
      // Closing is best effort during plugin teardown; the facility also
      // closes domains still open when it unmounts.
    }
  }
}

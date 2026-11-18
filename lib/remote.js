/**
 * Settings-page transport: package-private Remote service over the shared
 * `/api` channel.
 *
 * The browser calls `connection.rpc.call('/api', 'dsh-memory/<method>', { args })`
 * and receives `{ ok, value } | { ok: false, error }`.
 *
 * Why a Service instead of an RPC interceptor: the shared `/api` channel
 * accepts exactly ONE interceptor per process and the stock
 * `@deepseek-ai/dsh-api-gateway` owns it (`client-connection` throws
 * `shared RPC channel "/api" already has an interceptor` for a second
 * registration). Host packages therefore expose endpoints by declaring a
 * Typert Remote Service — the gateway claims every `<namespace>/<method>` that
 * an active Service exports and dispatches there after its own access check.
 *
 * This plugin is loaded straight from source with no build step and no package
 * dependencies of its own, so it declares the two pieces the protocol contract
 * actually reads, using its documented runtime shapes:
 *
 *   - `typertRemote` — a frozen `{ service, serviceKey, namespace }` binding
 *     (what `bindTypertRemote()` returns), read by the gateway's source-mode
 *     discovery;
 *   - Remote method markers on the class prototype under the protocol's marker
 *     key — the same record the `@Remote` decorator writes, which decorator
 *     syntax could not express here because decorators need a compiler.
 *
 * Source mode turns each marked method's declared parameter names into JSON
 * wire fields (`src-json` codec); a trailing `signal` parameter is injected as
 * cooperative cancellation.
 */
import { KINDS, SCOPES } from './config.js'
import { contextOf } from './service.js'

/** Wire namespace; endpoints are `dsh-memory/<method>`. */
const NAMESPACE = 'dsh-memory'

/** Exact Cordis service key the gateway resolves the receiver through. */
const SERVICE_KEY = 'memoryRemote'

/**
 * Property the Typert protocol reads Remote markers from
 * (`@deepseek-ai/dsh-typert-protocol` REMOTE_METHOD_DESCRIPTOR). Spelled out as
 * a string on purpose: another installed copy of the protocol package reads the
 * same key, which is what keeps cross-copy discovery working.
 */
const REMOTE_METHODS_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Mark one public instance method as a direct Remote endpoint, reproducing the
 * `@Remote` decorator's initializer without decorator syntax.
 * @param {object} prototype - Service prototype owning the method.
 * @param {string} method - public instance method name, also the wire method.
 */
function markDirect(prototype, method) {
  const current = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHODS_KEY)?.value
  const methods = current === undefined ? [] : [...current.methods]
  if (methods.some((marker) => marker.method === method)) return
  methods.push(Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))
  Object.defineProperty(prototype, REMOTE_METHODS_KEY, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze(methods) }),
  })
}

export class MemoryRemote {
  /**
   * @param {import('./service.js').MemoryService} service - the live memory service.
   * @param {{ workingDirectory?: any }} [deps] - workspace resolver for scoping.
   */
  constructor(service, deps = {}) {
    this.service = service
    this.deps = deps
    // Shape read by the gateway's `readBinding()`: the same frozen record
    // `bindTypertRemote()` produces, without importing the protocol package.
    this.typertRemote = Object.freeze({ service: this, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  }

  /** Call-scoped retrieval context: the settings page carries no session. */
  context() {
    return contextOf(undefined, this.deps.workingDirectory)
  }

  /**
   * Browse memories without a query.
   * @param {string} [query] unused; accepted for parity with search's filters.
   * @param {string} [scope] scope filter.
   * @param {string} [kind] kind filter.
   * @param {string[]} [tags] tag filter.
   * @param {number} [limit] page size.
   * @param {number} [offset] page offset.
   * @param {boolean} [full] include full records (defaults to true).
   */
  async list(query, scope, kind, tags, limit, offset, full) {
    return this.service.list(
      { query, scope, kind, tags, limit, offset, full: full !== false },
      this.context(),
    )
  }

  /**
   * Hybrid retrieval.
   * @param {string} query search text.
   * @param {string} [scope] scope filter.
   * @param {string} [kind] kind filter.
   * @param {string[]} [tags] tag filter.
   * @param {number} [limit] result cap.
   * @param {number} [offset] unused; accepted because the page shares its filter object.
   * @param {AbortSignal} [signal] injected cancellation.
   */
  async search(query, scope, kind, tags, limit, offset, explain, signal) {
    return this.service.search({ query, scope, kind, tags, limit, explain: explain === true }, this.context(), { signal })
  }

  /**
   * Capture one memory.
   * @param {string} text memory sentence.
   * @param {string} [kind] memory kind.
   * @param {string} [scope] memory scope.
   * @param {string[]} [tags] tags.
   * @param {number} [importance] 1–5 importance.
   * @param {AbortSignal} [signal] injected cancellation.
   */
  async save(text, kind, scope, tags, importance, signal) {
    return this.service.save({ text, kind, scope, tags, importance }, this.context(), { signal })
  }

  /**
   * Edit one memory.
   * @param {string} id memory id.
   * @param {string} [text] replacement text.
   * @param {string} [kind] replacement kind.
   * @param {string} [scope] replacement scope.
   * @param {string[]} [tags] replacement tags.
   * @param {number} [importance] replacement importance.
   * @param {AbortSignal} [signal] injected cancellation.
   */
  async update(id, text, kind, scope, tags, importance, signal) {
    return this.service.update({ id, text, kind, scope, tags, importance }, this.context(), { signal })
  }

  /**
   * Forget one memory.
   * @param {string} id memory id.
   */
  async delete(id) {
    return this.service.forget(id)
  }

  /** Aggregate counts and embedder health for the settings page header. */
  async stats() {
    return this.service.stats()
  }

  /** Enumerated scopes and kinds for the page's filter controls. */
  async options() {
    return { scopes: SCOPES, kinds: KINDS }
  }

  /**
   * Auto-captured entries awaiting confirmation (or dismissed history).
   * @param {number} [limit] page size.
   * @param {number} [offset] page offset.
   * @param {string} [status] candidate | dismissed | active.
   */
  async candidates(limit, offset, status) {
    return this.service.listCandidates({ limit, offset, status })
  }

  /**
   * @param {string} id candidate memory id.
   * @param {string} [supersedes] active memory id this candidate replaces.
   */
  async confirmCandidate(id, supersedes) {
    return this.service.confirmCandidate(id, { supersedes: supersedes ?? null })
  }

  /** @param {string} id candidate memory id. */
  async dismissCandidate(id) {
    return this.service.dismissCandidate(id)
  }

  /** @param {string} id memory id to archive. */
  async archive(id) {
    return this.service.archive(id)
  }

  /** @param {string} id archived/superseded/dismissed memory id. */
  async restore(id) {
    return this.service.restore(id)
  }

  /** @param {string} id archived memory id. @param {number} [limit] */
  async history(id, limit) {
    return this.service.revisions(id, limit)
  }

  /** @param {string} oldId replaced memory id. @param {string} newId replacement memory id. */
  async supersede(oldId, newId) {
    return this.service.supersede(oldId, newId)
  }

  /** Run the LLM admission judge now (panel / debugging). */
  async admitNow() {
    return this.deps.admitNow === undefined ? { skipped: true } : this.deps.admitNow()
  }

  /**
   * Run consolidation (near-duplicate merge + stale archival) now.
   * @param {boolean} [dryRun] report what would change without writing.
   */
  async consolidateNow(dryRun) {
    return this.deps.consolidateNow === undefined ? { skipped: true } : this.deps.consolidateNow(dryRun === true)
  }

  /** Restore one revision as a new revision. */
  async rollback(id, revision) {
    return this.service.rollback(id, revision)
  }

  /**
   * Diff a revision against the current record (or another revision).
   * @param {string} id
   * @param {number} fromRevision
   * @param {number} [toRevision]
   */
  async diffRevisions(id, fromRevision, toRevision) {
    return this.service.diffRevisions(id, fromRevision, toRevision ?? null)
  }

  /** Import a portable JSON bundle (already parsed). */
  async importData(bundle, fileName) {
    return this.service.importBundle(bundle, { fileName: fileName ?? null })
  }

  /** Import a JSON export from a local path (server-side). */
  async importFile(filePath) {
    return this.service.importFile(filePath)
  }

  /** Create one database backup and rotate older files. */
  async createBackup(label) {
    return this.service.createBackup(label ?? 'manual')
  }

  /** List available database backups (newest first). */
  async listBackups() {
    return this.service.listBackups()
  }

  /** One-click merge restore from a backup file (with a pre-restore safety copy). */
  async restoreBackup(name) {
    return this.service.restoreBackup(name)
  }

  /** Health snapshot: health, queues, budget, last runs, backups and warnings. */
  async diagnostics() {
    return this.service.diagnostics()
  }

  /** Recent observability events. */
  async events(limit, kind) {
    return this.service.listEvents({ limit: limit ?? 100, kind: kind ?? null })
  }

  /** Write a diagnostics bundle under `<dataDir>/exports` and return its path. */
  async exportDiagnostics() {
    return this.service.exportDiagnostics()
  }

  /**
   * Record explicit relevance feedback for one memory.
   * @param {string} id memory id.
   * @param {string} action relevant|irrelevant|helpful|unhelpful.
   * @param {string} [query] the query that surfaced it (hashed, not stored raw).
   */
  async feedback(id, action, query) {
    return this.service.feedback(id, action, { query: query ?? null, source: 'panel' })
  }

  /** Recall groups for one session (for the conversation rating dock). */
  async recalls(sessionId, limit) {
    return this.service.recallsForSession(sessionId ?? null, { limit: limit ?? 20 })
  }

  /** Rate one recalled memory with the five-level scale. */
  async rateRecall(recallId, memoryId, rating, note, axis) {
    // Backward compatibility: older clients sent "outdated" without an axis.
    const selectedAxis = axis === 'content' || (axis === undefined && rating === 'outdated') ? 'content' : 'relevance'
    return this.service.rateRecall(recallId, memoryId, rating, { note: note ?? null, source: 'dock', axis: selectedAxis })
  }

  /** Remove a submitted rating so the user can re-rate after undo. */
  async clearRecallRating(recallId, memoryId, axis) {
    return this.service.clearRecallRating(recallId, memoryId, { source: 'undo', axis: axis === 'content' ? 'content' : 'relevance' })
  }

  /** Hide submitted recall groups from the temporary rating window (or restore them on undo). */
  async markRecallsReviewed(recallIds, reviewed) {
    return this.service.markRecallsReviewed(recallIds ?? [], { reviewed: reviewed !== false })
  }

  /** Active memories queued for human review after negative/outdated feedback. */
  async reviewQueue(limit, offset) {
    return this.service.reviewQueue({ limit: limit ?? 50, offset: offset ?? 0 })
  }

  /** Keep a flagged memory as-is and clear its review flag. */
  async keepReview(id) {
    return this.service.keepReview(id)
  }

  /** Open possible conflicts between old and new memories. */
  async conflicts() {
    return this.service.conflicts()
  }

  /** Resolve a conflict: supersede the old memory, keep both, or dismiss. */
  async resolveConflict(id, resolution) {
    return this.service.resolveConflict(id, resolution)
  }

  /** Recall quality aggregation for the diagnostics chart. */
  async quality(days) {
    return this.service.qualityReport({ days: days ?? 7 })
  }

  /** Project rows for the panel's Projects tab. */
  async projects() {
    return this.service.projects()
  }

  /** Trigger one periodic extraction run on demand (settings page / debugging). */
  async extractNow() {
    return this.deps.extractNow === undefined ? { skipped: true } : this.deps.extractNow()
  }

  /**
   * Dry-run extraction for one session (or the newest project session) without
   * writing candidates; used by the panel's evaluation button.
   * @param {string} [sessionId] target session.
   */
  async previewExtraction(sessionId) {
    return this.deps.previewExtraction === undefined ? { skipped: true } : this.deps.previewExtraction(sessionId)
  }

  /**
   * Write a portable export under the storage directory.
   * @param {string} [format] json | markdown.
   * @param {string} [status] active | candidate | dismissed | all.
   */
  async exportData(format, status) {
    return this.service.exportBundle({ format, status })
  }

  /** Effective editable settings (the API key is reported as `apiKeySet` only). */
  async getSettings() {
    return this.service.settingsView()
  }

  /**
   * Apply one settings patch and return the new effective view.
   * @param {Record<string, any>} patch settings sections to change.
   */
  async setSettings(patch) {
    return this.service.updateSettings(patch ?? {})
  }
}

for (const method of [
  'list',
  'search',
  'save',
  'update',
  'delete',
  'stats',
  'options',
  'getSettings',
  'setSettings',
  'candidates',
  'confirmCandidate',
  'dismissCandidate',
  'archive',
  'restore',
  'history',
  'supersede',
  'admitNow',
  'consolidateNow',
  'rollback',
  'diffRevisions',
  'importData',
  'importFile',
  'createBackup',
  'listBackups',
  'restoreBackup',
  'diagnostics',
  'events',
  'exportDiagnostics',
  'feedback',
  'recalls',
  'rateRecall',
  'clearRecallRating',
  'markRecallsReviewed',
  'reviewQueue',
  'keepReview',
  'conflicts',
  'resolveConflict',
  'quality',
  'projects',
  'extractNow',
  'previewExtraction',
  'exportData',
]) {
  markDirect(MemoryRemote.prototype, method)
}

/**
 * Publish the Remote service on the owning Context so the gateway can see it.
 * @param {object} ctx - owning Host Context (the plugin row's fiber).
 * @param {import('./service.js').MemoryService} service - the live memory service.
 * @param {{ workingDirectory?: any }} [deps] - workspace resolver for scoping.
 * @returns {MemoryRemote} the registered service instance.
 */
export function provideMemoryRemote(ctx, service, deps = {}) {
  const remote = new MemoryRemote(service, deps)
  ctx.provide(SERVICE_KEY, remote)
  return remote
}

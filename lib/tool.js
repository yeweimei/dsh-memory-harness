/**
 * The model-facing `memory` tool.
 *
 * One tool with an `action` discriminator keeps the tool list small: saving and
 * searching are the frequent operations, while list/update/forget/stats are
 * maintenance calls that share the same parameters and result vocabulary.
 */
import { KINDS, SCOPES } from './config.js'
import { contextOf } from './service.js'

const TOOL_KINDS = KINDS.filter((kind) => kind !== 'summary')

const DESCRIPTION = [
  'Persistent memory that survives sessions. Use action "save" to remember a durable, self-contained fact;',
  'action "search" to recall memories before asking the user again; action "list" to browse;',
  'action "update" or "forget" to maintain one entry; action "archive" / "restore" to manage the cold tier;',
  'action "history" to inspect revisions; action "stats" to inspect the store.',
  'Use validUntil (ISO date) for temporary facts that should expire into review.',
  'fix is the command or change that worked. Save only what is worth recalling later: user preferences,',
  'project conventions, decisions and their reasons, corrections, pitfalls, and cross-session task state.',
  'Do not save transient task details, file contents, secrets, or guesses. Search uses hybrid semantic +',
  'keyword ranking plus one-hop graph expansion; natural-language queries work better than keywords.',
  'scope "global" applies everywhere, "workspace" to this working directory, "session" only to the current session.',
  'Auto-captured candidates are normally admitted automatically by the configured extraction model; actions',
  '"candidates", "confirm" and "dismiss" remain for manual review/override.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['save', 'search', 'list', 'update', 'forget', 'candidates', 'confirm', 'dismiss', 'archive', 'restore', 'history', 'rollback', 'diff', 'stats'],
      description:
        'save = persist one memory; search = hybrid recall; list = browse without a query; update/forget = maintain one id; candidates = list auto-captured entries awaiting confirmation; confirm/dismiss = review one candidate; archive/restore = move between active and cold tiers; history = revision snapshots; rollback = restore a revision; diff = compare a revision with the current record; stats = counts and embedder health.',
    },
    text: {
      type: 'string',
      description:
        'For save: one self-contained sentence in the user\'s language. For update: the replacement text. Do not store secrets or large excerpts.',
    },
    query: {
      type: 'string',
      description: 'For search: a natural-language description of what you are trying to remember.',
    },
    explain: {
      type: 'boolean',
      description: 'For search: include per-result route/rank/score explanations.',
    },
    id: { type: 'string', description: 'For update/forget: the memory id returned by save/search/list.' },
    kind: {
      type: 'string',
      enum: TOOL_KINDS,
      description:
        'memory category. pitfall = a resolved non-obvious problem; preference/knowledge default to global scope; project/decision default to workspace scope.',
    },
    details: {
      type: 'object',
      additionalProperties: false,
      description: 'Optional structured fields for a pitfall (or other evidence-backed memory).',
      properties: {
        symptom: { type: 'string', description: 'Exact error text or failing command as observed.' },
        cause: { type: 'string', description: 'Root cause, when known.' },
        fix: { type: 'string', description: 'The command or change that actually resolved it.' },
        environment: { type: 'string', description: 'OS, tool, version or other context that makes the pitfall specific.' },
      },
    },
    scope: {
      type: 'string',
      enum: SCOPES,
      description: 'global = every project; workspace = this working directory; session = only the current session.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
      description: 'Optional labels for filtering (for example a project or topic name).',
    },
    revision: {
      type: 'integer',
      minimum: 1,
      description: 'For rollback/diff: the revision number to restore or compare from.',
    },
    compareRevision: {
      type: 'integer',
      minimum: 1,
      description: 'For diff: compare against this revision instead of the current record.',
    },
    importance: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Optional 1-5; higher entries are preferred for session-start core-memory injection.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: 'Optional maximum results for search/list (default 5, cap 20).',
    },
    offset: { type: 'integer', minimum: 0, description: 'Optional list offset for paging.' },
    validUntil: {
      type: 'string',
      description: 'For save/update: optional expiration date (ISO 8601). Expired memories go to human review instead of disappearing.',
    },
  },
}

/**
 * @param {import('./service.js').MemoryService} service
 * @param {{ workingDirectory?: any }} deps
 */
export function createMemoryTool(service, deps) {
  return {
    name: 'memory',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    timeoutMs: 20000,
    output: {
      schema: { type: 'object' },
      render(args, value) {
        return [{ type: 'text', text: renderResult(args, value) }]
      },
    },
    async execute(args, exec) {
      const action = args?.action
      const context = contextOf(exec?.agent, deps.workingDirectory)
      const signal = exec?.signal
      switch (action) {
        case 'save':
          return service.save(
            {
              text: args.text,
              kind: args.kind,
              scope: args.scope,
              tags: args.tags,
              importance: args.importance,
              details: args.details,
              validUntil: args.validUntil,
            },
            { ...context, turn: turnOf(exec) },
            { signal },
          )
        case 'search':
          return service.search(
            { query: args.query, scope: args.scope, kind: args.kind, tags: args.tags, limit: args.limit, explain: args.explain === true },
            { ...context, turn: turnOf(exec) },
            { signal },
          )
        case 'list':
          return service.list(
            { scope: args.scope, kind: args.kind, tags: args.tags, limit: args.limit, offset: args.offset, full: false },
            context,
          )
        case 'update':
          return service.update(
            {
              id: args.id,
              text: args.text,
              kind: args.kind,
              scope: args.scope,
              tags: args.tags,
              importance: args.importance,
              validUntil: args.validUntil,
            },
            context,
            { signal },
          )
        case 'forget':
          return service.forget(args.id)
        case 'candidates':
          return service.listCandidates({ limit: args.limit ?? 20, offset: args.offset ?? 0, status: 'candidate' })
        case 'confirm':
          return service.confirmCandidate(args.id)
        case 'archive':
      return `Archived ${args.id}`
    case 'restore':
      return `Restored ${args.id}`
    case 'rollback':
      return `Rolled back ${args.id} to r${args.revision}`
    case 'diff': {
      const result = service.diffRevisions(args.id, args.revision, args.compareRevision ?? null)
      const fields = result.fields.map((field) => `${field.field}: ${JSON.stringify(field.before)} -> ${JSON.stringify(field.after)}`)
      return [`diff r${result.from.revision} -> r${result.to.revision}`, ...fields, '', result.text].join('\n')
    }
    case 'history': {
      const result = service.revisions(args.id, 20)
      if (result.revisions.length === 0) return `${args.id} has no revisions`
      return result.revisions.map((revision) => `r${revision.revision} ${revision.action}/${revision.actor} ${new Date(revision.createdAt).toISOString()}`).join('\n')
    }
    case 'dismiss':
          return service.dismissCandidate(args.id)
        case 'archive':
          return service.archive(args.id)
        case 'restore':
          return service.restore(args.id)
        case 'history':
          return service.revisions(args.id, 20)
        case 'rollback':
          return service.rollback(args.id, args.revision)
        case 'diff':
          return service.diffRevisions(args.id, args.revision, args.compareRevision ?? null)
        case 'stats':
          return service.stats()
        default:
          throw new Error(`unknown memory action '${String(action)}'; expected save, search, list, update, forget, archive, restore, history, or stats`)
      }
    },
  }
}

/**
 * @param {any} args
 * @param {any} value
 */
export function renderResult(args, value) {
  switch (args?.action) {
    case 'search':
      return renderMemories('memories', value)
    case 'list':
      return renderMemories('memories', value)
    case 'save':
      return `Saved ${value?.id} (${value?.status}${value?.similarity === undefined ? '' : `, similarity ${value.similarity}`}).`
    case 'update':
      return `Updated ${value?.id}.`
    case 'forget':
      return value?.deleted === true ? `Forgot ${value?.id}.` : `No memory named ${value?.id}.`
    case 'candidates':
      return renderCandidates(value)
    case 'confirm':
      return `Confirmed candidate ${value?.id} as an active memory.`
    case 'archive':
      return `Archived ${args.id}`
    case 'restore':
      return `Restored ${args.id}`
    case 'rollback':
      return `Rolled back ${args.id} to r${args.revision}`
    case 'diff': {
      const result = service.diffRevisions(args.id, args.revision, args.compareRevision ?? null)
      const fields = result.fields.map((field) => `${field.field}: ${JSON.stringify(field.before)} -> ${JSON.stringify(field.after)}`)
      return [`diff r${result.from.revision} -> r${result.to.revision}`, ...fields, '', result.text].join('\n')
    }
    case 'history': {
      const result = service.revisions(args.id, 20)
      if (result.revisions.length === 0) return `${args.id} has no revisions`
      return result.revisions.map((revision) => `r${revision.revision} ${revision.action}/${revision.actor} ${new Date(revision.createdAt).toISOString()}`).join('\n')
    }
    case 'dismiss':
      return `Dismissed candidate ${value?.id}.`
    case 'stats':
      return JSON.stringify(value, null, 2)
    default:
      return JSON.stringify(value, null, 2)
  }
}

function renderMemories(label, value) {
  const memories = Array.isArray(value?.memories) ? value.memories : []
  if (memories.length === 0) {
    const degraded = value?.degraded === true ? ` (degraded: ${value?.degradedReason ?? 'semantic route unavailable'})` : ''
    return `No ${label} matched${degraded}.`
  }
  const header = [
    `${memories.length} ${label}`,
    value?.total === undefined ? '' : `of ${value.total}`,
    value?.degraded === true ? `[degraded: ${value?.degradedReason ?? 'semantic route unavailable'}]` : '',
  ]
    .filter((part) => part !== '')
    .join(' ')
  const lines = memories.map((memory, index) => {
    const meta = [`${memory.kind}/${memory.scope}`]
    if (memory.score !== undefined) meta.push(`score=${memory.score}`)
    if (memory.match !== undefined) meta.push(`match=${memory.match}`)
    if (memory.similarity !== undefined && memory.similarity !== null) meta.push(`sim=${memory.similarity}`)
    if (memory.ageDays !== undefined) meta.push(`age=${memory.ageDays}d`)
    meta.push(`id=${memory.id}`)
    const details = memory.details
    const hint = details !== null && typeof details === 'object' && (details.symptom !== undefined || details.fix !== undefined)
      ? ` (症状: ${oneLine(details.symptom ?? '')}${details.fix ? `；修复: ${oneLine(details.fix)}` : ''})`
      : ''
    return `${index + 1}. [${meta.join(' ')}] ${oneLine(memory.text)}${hint}`
  })
  return [header, ...lines].join('\n')
}

function renderCandidates(value) {
  const memories = Array.isArray(value?.memories) ? value.memories : []
  if (memories.length === 0) return 'No candidates are waiting for confirmation.'
  const lines = memories.map((memory, index) => {
    const meta = [memory.kind, memory.scope, memory.details?.source ?? 'auto']
    if (typeof memory.details?.confidence === 'number') meta.push(`confidence=${memory.details.confidence}`)
    meta.push(`id=${memory.id}`)
    return `${index + 1}. [${meta.join(' ')}] ${oneLine(memory.text)}`
  })
  return `${memories.length} candidate(s) awaiting confirmation:
${lines.join('\n')}`
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function turnOf(exec) {
  const turn = exec?.turn
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : null
}

/**
 * Effective configuration for dsh-memory.
 *
 * The plugin intentionally declares no schemastery `Config` export: it is a
 * zero-dependency, locally linked bundle, and bare package imports do not
 * resolve from a workspace checkout. The row's `config` is therefore merged
 * over {@link DEFAULTS} and validated here at activation; a bad value fails
 * the plugin with a message that names the offending field.
 */

import os from 'node:os'
import path from 'node:path'

export const SCOPES = ['global', 'workspace', 'session']
export const KINDS = ['preference', 'project', 'decision', 'knowledge', 'pitfall', 'summary', 'task', 'other']

export const DEFAULTS = {
  embedding: {
    /** OpenAI-compatible base URL, with or without the trailing `/embeddings`. */
    /** Leave empty in the package default; each user fills this in settings. */
    baseURL: '',
    /** Sent as `Authorization: Bearer <apiKey>` when non-empty. */
    apiKey: '',
    /** Leave empty in the package default; each user fills this in settings. */
    model: '',
    /** Expected vector width; a mismatched response is rejected loudly. */
    dimensions: 1024,
    timeoutMs: 3000,
    /** Optional instruction prefix used for queries only (supported by some embedding models). */
    queryInstruction: 'Given a user query, retrieve relevant durable personal memories',
    batchSize: 16,
  },
  retrieval: {
    defaultLimit: 5,
    maxLimit: 20,
    /** Candidates taken from each retrieval route before fusion. */
    candidates: 50,
    /** Reciprocal-rank-fusion constant. */
    rrfK: 60,
    /** Drop semantic-only hits below this cosine similarity (0 disables). */
    minVectorSimilarity: 0,
    /** 0 disables recency decay in the fused ordering. */
    recencyHalfLifeDays: 0,
    /** 0 disables the importance multiplier in the fused ordering. */
    importanceBoost: 0,
  },
  capture: {
    defaultScope: 'workspace',
    /** Cosine similarity at which a new memory is merged into an existing one. */
    dedupeThreshold: 0.93,
    maxChars: 4000,
    maxImportance: 5,
    /** Auto-capture: off | rules | rules+llm. */
    mode: 'rules+llm',
    /** 0 = only event-triggered extraction; N = also extract every N turns. */
    extractEveryTurns: 0,
    dailyTokenBudget: 50000,
    candidateTtlDays: 30,
    minConfidence: 0.6,
    /** LLM admission: decide automatically whether a candidate becomes active. */
    admission: {
      enabled: true,
      minConfidence: 0.7,
      maxPerRun: 8,
      includeRules: true,
    },
    /**
     * Extraction provider: an OpenAI-compatible chat endpoint. Empty baseURL
     * or model falls back to the agent default model. The API key lives in the
     * credential store, never in configuration.
     */
    llm: {
      baseURL: '',
      model: '',
      contextWindow: 32768,
      maxOutputTokens: 1600,
      timeoutMs: 80000,
    },
    /** Coalesce dirty turns before one extraction run. */
    extractDebounceMs: 15000,
    /** Flag similar-but-not-duplicate active memories as possible conflicts. */
    conflictDetection: true,
    conflictSimilarity: 0.82,
    /** LLM conflict judge: similarity only shortlists, the model decides relation. */
    conflictJudge: {
      enabled: true,
      minSimilarity: 0.6,
      autoApplyConfidence: 0.85,
      reviewConfidence: 0.5,
      maxCandidates: 5,
      timeoutMs: 15000,
      autoContradictNewWins: false,
    },
  },
  recall: {
    /** Attach known-pitfall hints to failed tool results. */
    failureHints: true,
    failureHintMinSimilarity: 0.45,
    failureHintMaxPerSession: 3,
    /** In-conversation recall rating tray. */
    ratings: {
      enabled: true,
      defaultRating: 'unknown',
      maxGroups: 3,
      maxMemoriesPerGroup: 5,
    },
  },
  periodic: {
    enabled: true,
    intervalMinutes: 30,
    maxExtractionsPerDay: 12,
    projectDigest: true,
    maxSummaryChars: 1400,
  },
  graph: {
    enabled: true,
    maxHops: 2,
    expansionWeight: 0.5,
  },
  inject: {
    /** Number of core memories injected at the start of a fresh session (0 disables). */
    coreMemories: 10,
    coreMinImportance: 3,
    /** Total character budget for the injected core-memory block. */
    coreMaxChars: 900,
    /** Include memories scoped to the session's working directory. */
    includeWorkspace: true,
    /** Recent workspace pitfalls injected at session start (0 disables). */
    corePitfalls: 3,
    /** Explicit per-layer character budgets inside coreMaxChars. */
    budgets: {
      digest: 600,
      pitfall: 600,
    },
    /** First-turn contextual recall: after the first user message, inject memories matching it. */
    proactiveRecall: {
      enabled: true,
      maxMemories: 5,
      minSimilarity: 0.33,
      maxChars: 1200,
    },
  },
  storage: {
    /** `sqlite` = one portable database file (default); `domain` = JSON records through ctx.storageDomain. */
    backend: 'sqlite',
    /** Directory holding `memory.db`. Defaults to `$DSH_HOME/memory`. */
    dataDir: '',
  },
  retention: {
    /** Session-scoped memories older than this many days are removed at startup (0 disables). */
    sessionMemoryDays: 14,
    /** Hard cap; saving beyond it fails with a cleanup hint instead of evicting silently. */
    maxRecords: 20000,
  },
  maintenance: {
    backfillIntervalMs: 60000,
    backfillBatch: 16,
    /** Consolidation: merge near-duplicates, archive stale actives, fold expiring session memories into the next digest. */
    consolidateIntervalHours: 24,
    nearMergeSimilarity: 0.92,
    staleAfterDays: 90,
    staleMaxImportance: 2,
    maxConsolidateOps: 20,
    digestQueueMaxItems: 200,
    digestQueueMaxChars: 6000,
    /** Automatic database backups + rotation. */
    backupIntervalHours: 24,
    backupsKeep: 10,
    /** Observability event log bounds. */
    eventKeep: 10000,
    eventRetentionDays: 30,
    recallKeep: 10000,
    recallRetentionDays: 90,
  },
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function merge(base, override) {
  if (!isPlainObject(override)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(base[key]) && isPlainObject(value) ? merge(base[key], value) : value
  }
  return out
}

function fail(field, message) {
  throw new Error(`dsh-memory: config.${field} ${message}`)
}

function number(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'must be a finite number')
  if (integer && !Number.isInteger(value)) fail(field, 'must be an integer')
  if (value < min || value > max) fail(field, `must be between ${min} and ${max}`)
  return value
}

function string(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(field, 'must be a string')
  if (!allowEmpty && value.trim() === '') fail(field, 'must not be empty')
  return value
}

/** @param {Record<string, unknown> | undefined} raw */
export function resolveConfig(raw) {
  const merged = merge(DEFAULTS, raw ?? {})
  const config = {
    embedding: {
      endpoint: normalizeEndpoint(string(merged.embedding.baseURL, 'embedding.baseURL', { allowEmpty: true })),
      apiKey:
        typeof merged.embedding.apiKey === 'string' && merged.embedding.apiKey.trim() !== ''
          ? merged.embedding.apiKey.trim()
          : (process.env.DSH_MEMORY_API_KEY ?? '').trim(),
      model: string(merged.embedding.model, 'embedding.model', { allowEmpty: true }),
      dimensions: number(merged.embedding.dimensions, 'embedding.dimensions', { min: 1, max: 8192, integer: true }),
      timeoutMs: number(merged.embedding.timeoutMs, 'embedding.timeoutMs', { min: 250, max: 60000, integer: true }),
      queryInstruction:
        typeof merged.embedding.queryInstruction === 'string' ? merged.embedding.queryInstruction.trim() : '',
      batchSize: number(merged.embedding.batchSize, 'embedding.batchSize', { min: 1, max: 64, integer: true }),
    },
    retrieval: {
      defaultLimit: number(merged.retrieval.defaultLimit, 'retrieval.defaultLimit', { min: 1, max: 100, integer: true }),
      maxLimit: number(merged.retrieval.maxLimit, 'retrieval.maxLimit', { min: 1, max: 100, integer: true }),
      candidates: number(merged.retrieval.candidates, 'retrieval.candidates', { min: 1, max: 500, integer: true }),
      rrfK: number(merged.retrieval.rrfK, 'retrieval.rrfK', { min: 1, max: 1000, integer: true }),
      minVectorSimilarity: number(merged.retrieval.minVectorSimilarity, 'retrieval.minVectorSimilarity', {
        min: 0,
        max: 1,
      }),
      recencyHalfLifeDays: number(merged.retrieval.recencyHalfLifeDays, 'retrieval.recencyHalfLifeDays', {
        min: 0,
        max: 3650,
      }),
      importanceBoost: number(merged.retrieval.importanceBoost, 'retrieval.importanceBoost', { min: 0, max: 1 }),
    },
    capture: {
      defaultScope: scope(merged.capture.defaultScope, 'capture.defaultScope'),
      dedupeThreshold: number(merged.capture.dedupeThreshold, 'capture.dedupeThreshold', { min: 0.5, max: 1 }),
      maxChars: number(merged.capture.maxChars, 'capture.maxChars', { min: 1, max: 20000, integer: true }),
      maxImportance: number(merged.capture.maxImportance, 'capture.maxImportance', { min: 1, max: 5, integer: true }),
      mode: captureMode(merged.capture.mode, 'capture.mode'),
      extractEveryTurns: number(merged.capture.extractEveryTurns, 'capture.extractEveryTurns', {
        min: 0,
        max: 1000,
        integer: true,
      }),
      dailyTokenBudget: number(merged.capture.dailyTokenBudget, 'capture.dailyTokenBudget', {
        min: 0,
        max: 100000000,
        integer: true,
      }),
      candidateTtlDays: number(merged.capture.candidateTtlDays, 'capture.candidateTtlDays', {
        min: 1,
        max: 3650,
        integer: true,
      }),
      minConfidence: number(merged.capture.minConfidence, 'capture.minConfidence', { min: 0, max: 1 }),
      conflictDetection: merged.capture.conflictDetection !== false,
      conflictSimilarity: number(merged.capture.conflictSimilarity, 'capture.conflictSimilarity', { min: 0.5, max: 1 }),
      conflictJudge: {
        enabled: merged.capture.conflictJudge?.enabled !== false,
        minSimilarity: number(merged.capture.conflictJudge?.minSimilarity, 'capture.conflictJudge.minSimilarity', { min: 0.3, max: 1 }),
        autoApplyConfidence: number(merged.capture.conflictJudge?.autoApplyConfidence, 'capture.conflictJudge.autoApplyConfidence', { min: 0.5, max: 1 }),
        reviewConfidence: number(merged.capture.conflictJudge?.reviewConfidence, 'capture.conflictJudge.reviewConfidence', { min: 0, max: 1 }),
        maxCandidates: number(merged.capture.conflictJudge?.maxCandidates, 'capture.conflictJudge.maxCandidates', { min: 1, max: 20, integer: true }),
        timeoutMs: number(merged.capture.conflictJudge?.timeoutMs, 'capture.conflictJudge.timeoutMs', { min: 1000, max: 120000, integer: true }),
        autoContradictNewWins: merged.capture.conflictJudge?.autoContradictNewWins === true,
      },
      llm: {
        baseURL: llmBaseURL(merged.capture.llm?.baseURL, 'capture.llm.baseURL'),
        model: typeof merged.capture.llm?.model === 'string' ? merged.capture.llm.model.trim() : '',
        contextWindow: number(merged.capture.llm?.contextWindow, 'capture.llm.contextWindow', {
          min: 1024,
          max: 2000000,
          integer: true,
        }),
        maxOutputTokens: number(merged.capture.llm?.maxOutputTokens, 'capture.llm.maxOutputTokens', {
          min: 64,
          max: 65536,
          integer: true,
        }),
        timeoutMs: number(merged.capture.llm?.timeoutMs, 'capture.llm.timeoutMs', {
          min: 1000,
          max: 600000,
          integer: true,
        }),
      },
      extractDebounceMs: number(merged.capture.extractDebounceMs, 'capture.extractDebounceMs', {
        min: 1000,
        max: 300000,
        integer: true,
      }),
      admission: {
        enabled: merged.capture.admission?.enabled !== false,
        minConfidence: number(merged.capture.admission?.minConfidence, 'capture.admission.minConfidence', { min: 0, max: 1 }),
        maxPerRun: number(merged.capture.admission?.maxPerRun, 'capture.admission.maxPerRun', {
          min: 0,
          max: 50,
          integer: true,
        }),
        includeRules: merged.capture.admission?.includeRules !== false,
      },
    },
    recall: {
      failureHints: Boolean(merged.recall.failureHints),
      failureHintMinSimilarity: number(merged.recall.failureHintMinSimilarity, 'recall.failureHintMinSimilarity', {
        min: 0,
        max: 1,
      }),
      failureHintMaxPerSession: number(merged.recall.failureHintMaxPerSession, 'recall.failureHintMaxPerSession', {
        min: 0,
        max: 100,
        integer: true,
      }),
      ratings: {
        enabled: merged.recall.ratings?.enabled !== false,
        defaultRating: merged.recall.ratings?.defaultRating === 'somewhat_relevant' ? 'somewhat_relevant' : 'unknown',
        maxGroups: number(merged.recall.ratings?.maxGroups, 'recall.ratings.maxGroups', { min: 1, max: 20, integer: true }),
        maxMemoriesPerGroup: number(merged.recall.ratings?.maxMemoriesPerGroup, 'recall.ratings.maxMemoriesPerGroup', {
          min: 1,
          max: 20,
          integer: true,
        }),
      },
    },
    periodic: {
      enabled: Boolean(merged.periodic.enabled),
      intervalMinutes: number(merged.periodic.intervalMinutes, 'periodic.intervalMinutes', {
        min: 1,
        max: 10080,
        integer: true,
      }),
      maxExtractionsPerDay: number(merged.periodic.maxExtractionsPerDay, 'periodic.maxExtractionsPerDay', {
        min: 0,
        max: 1000,
        integer: true,
      }),
      projectDigest: Boolean(merged.periodic.projectDigest),
      maxSummaryChars: number(merged.periodic.maxSummaryChars, 'periodic.maxSummaryChars', {
        min: 100,
        max: 8000,
        integer: true,
      }),
    },
    graph: {
      enabled: Boolean(merged.graph.enabled),
      maxHops: number(merged.graph.maxHops, 'graph.maxHops', { min: 1, max: 3, integer: true }),
      expansionWeight: number(merged.graph.expansionWeight, 'graph.expansionWeight', { min: 0, max: 1 }),
    },
    inject: {
      coreMemories: number(merged.inject.coreMemories, 'inject.coreMemories', { min: 0, max: 100, integer: true }),
      coreMinImportance: number(merged.inject.coreMinImportance, 'inject.coreMinImportance', {
        min: 1,
        max: 5,
        integer: true,
      }),
      coreMaxChars: number(merged.inject.coreMaxChars, 'inject.coreMaxChars', { min: 0, max: 8000, integer: true }),
      includeWorkspace: Boolean(merged.inject.includeWorkspace),
      corePitfalls: number(merged.inject.corePitfalls, 'inject.corePitfalls', { min: 0, max: 20, integer: true }),
      budgets: {
        digest: number(merged.inject.budgets?.digest, 'inject.budgets.digest', { min: 0, max: 4000, integer: true }),
        pitfall: number(merged.inject.budgets?.pitfall, 'inject.budgets.pitfall', { min: 0, max: 4000, integer: true }),
      },
      proactiveRecall: {
        enabled: merged.inject.proactiveRecall?.enabled !== false,
        maxMemories: number(merged.inject.proactiveRecall?.maxMemories, 'inject.proactiveRecall.maxMemories', {
          min: 0,
          max: 20,
          integer: true,
        }),
        minSimilarity: number(merged.inject.proactiveRecall?.minSimilarity, 'inject.proactiveRecall.minSimilarity', {
          min: 0,
          max: 1,
        }),
        maxChars: number(merged.inject.proactiveRecall?.maxChars, 'inject.proactiveRecall.maxChars', {
          min: 0,
          max: 8000,
          integer: true,
        }),
      },
    },
    storage: {
      backend: storageBackend(merged.storage.backend, 'storage.backend'),
      dataDir: dataDir(merged.storage.dataDir, 'storage.dataDir'),
    },
    retention: {
      sessionMemoryDays: number(merged.retention.sessionMemoryDays, 'retention.sessionMemoryDays', {
        min: 0,
        max: 3650,
      }),
      maxRecords: number(merged.retention.maxRecords, 'retention.maxRecords', { min: 1, max: 1000000, integer: true }),
    },
    maintenance: {
      backfillIntervalMs: number(merged.maintenance.backfillIntervalMs, 'maintenance.backfillIntervalMs', {
        min: 5000,
        max: 3600000,
        integer: true,
      }),
      backfillBatch: number(merged.maintenance.backfillBatch, 'maintenance.backfillBatch', {
        min: 1,
        max: 64,
        integer: true,
      }),
      consolidateIntervalHours: number(merged.maintenance.consolidateIntervalHours, 'maintenance.consolidateIntervalHours', {
        min: 0,
        max: 720,
        integer: true,
      }),
      nearMergeSimilarity: number(merged.maintenance.nearMergeSimilarity, 'maintenance.nearMergeSimilarity', { min: 0.5, max: 1 }),
      staleAfterDays: number(merged.maintenance.staleAfterDays, 'maintenance.staleAfterDays', { min: 1, max: 3650, integer: true }),
      staleMaxImportance: number(merged.maintenance.staleMaxImportance, 'maintenance.staleMaxImportance', {
        min: 1,
        max: 5,
        integer: true,
      }),
      maxConsolidateOps: number(merged.maintenance.maxConsolidateOps, 'maintenance.maxConsolidateOps', {
        min: 1,
        max: 500,
        integer: true,
      }),
      digestQueueMaxItems: number(merged.maintenance.digestQueueMaxItems, 'maintenance.digestQueueMaxItems', {
        min: 1,
        max: 2000,
        integer: true,
      }),
      digestQueueMaxChars: number(merged.maintenance.digestQueueMaxChars, 'maintenance.digestQueueMaxChars', {
        min: 200,
        max: 100000,
        integer: true,
      }),
      backupIntervalHours: number(merged.maintenance.backupIntervalHours, 'maintenance.backupIntervalHours', {
        min: 0,
        max: 720,
        integer: true,
      }),
      backupsKeep: number(merged.maintenance.backupsKeep, 'maintenance.backupsKeep', { min: 1, max: 100, integer: true }),
      eventKeep: number(merged.maintenance.eventKeep, 'maintenance.eventKeep', { min: 100, max: 200000, integer: true }),
      eventRetentionDays: number(merged.maintenance.eventRetentionDays, 'maintenance.eventRetentionDays', {
        min: 1,
        max: 3650,
        integer: true,
      }),
      recallKeep: number(merged.maintenance.recallKeep, 'maintenance.recallKeep', { min: 100, max: 200000, integer: true }),
      recallRetentionDays: number(merged.maintenance.recallRetentionDays, 'maintenance.recallRetentionDays', {
        min: 1,
        max: 3650,
        integer: true,
      }),
    },
  }
  if (config.retrieval.defaultLimit > config.retrieval.maxLimit) {
    fail('retrieval.defaultLimit', 'must not exceed retrieval.maxLimit')
  }
  return config
}

function llmBaseURL(value, field) {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (raw === '') return ''
  if (!/^https?:\/\//i.test(raw)) fail(field, 'must start with http:// or https:// (or be empty)')
  return raw
}

function captureMode(value, field) {
  if (value !== 'off' && value !== 'rules' && value !== 'rules+llm') fail(field, "must be 'off', 'rules' or 'rules+llm'")
  return value
}

function storageBackend(value, field) {
  if (value !== 'sqlite' && value !== 'domain') fail(field, "must be 'sqlite' or 'domain'")
  return value
}

function dataDir(value, field) {
  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
  const configured = typeof value === 'string' ? value.trim() : ''
  return configured === '' ? path.join(home, 'memory') : configured
}

function scope(value, field) {
  if (!SCOPES.includes(value)) fail(field, `must be one of ${SCOPES.join(', ')}`)
  return value
}

function normalizeEndpoint(baseURL) {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  if (!/^https?:\/\//i.test(trimmed)) fail('embedding.baseURL', 'must start with http:// or https://')
  return /\/embeddings$/i.test(trimmed) ? trimmed : `${trimmed}/embeddings`
}

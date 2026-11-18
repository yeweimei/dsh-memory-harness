/**
 * User-editable settings stored in the plugin's own storage domain.
 *
 * The Loader row config stays the bootstrap/default layer (it can ship a
 * sensible endpoint and be overridden in `cordis.patch.yml`). Anything saved
 * from the settings page is a *user layer* persisted in the domain's global
 * slot, merged over the row config and revalidated by `resolveConfig` on every
 * change — so the settings form never needs a plugin restart.
 */

export const SETTINGS_VERSION = 1

const EDITABLE = {
  embedding: ['baseURL', 'model', 'dimensions', 'timeoutMs', 'queryInstruction', 'apiKey'],
  capture: [
    'defaultScope',
    'dedupeThreshold',
    'mode',
    'extractEveryTurns',
    'dailyTokenBudget',
    'candidateTtlDays',
    'llm',
    'admission',
    'extractDebounceMs',
    'conflictDetection',
    'conflictSimilarity',
    'conflictJudge',
  ],
  recall: ['failureHints', 'failureHintMinSimilarity', 'failureHintMaxPerSession', 'ratings'],
  inject: ['coreMemories', 'coreMinImportance', 'includeWorkspace', 'corePitfalls', 'proactiveRecall'],
  retrieval: ['defaultLimit'],
  periodic: ['enabled', 'intervalMinutes', 'maxExtractionsPerDay', 'projectDigest'],
  graph: ['enabled', 'maxHops'],
}

const NESTED_KEYS = {
  recall: {
    ratings: ['enabled', 'defaultRating', 'maxGroups', 'maxMemoriesPerGroup'],
  },
  inject: {
    proactiveRecall: ['enabled', 'maxMemories', 'minSimilarity', 'maxChars'],
  },
  capture: {
    llm: ['baseURL', 'model', 'contextWindow', 'maxOutputTokens', 'timeoutMs', 'apiKey'],
    admission: ['enabled', 'minConfidence', 'maxPerRun', 'includeRules'],
    conflictJudge: ['enabled', 'minSimilarity', 'autoApplyConfidence', 'reviewConfidence', 'maxCandidates', 'timeoutMs', 'autoContradictNewWins'],
  },
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function merge(base, patch) {
  if (!isPlainObject(patch)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(base[key]) && isPlainObject(value) ? merge(base[key], value) : value
  }
  return out
}

/**
 * Deep-merge the persisted user layer over the loader row config. `undefined`
 * fields are ignored so a sparse settings patch never clears defaults.
 * @param {Record<string, any>} base
 * @param {Record<string, any>} patch
 */
export function mergeSettings(base, patch) {
  return merge(base, patch)
}

/**
 * Defensive read boundary for the domain's global slot: a corrupt global must
 * not prevent the plugin from starting, so unknown shapes degrade to `{}` and
 * only known top-level sections are kept.
 * @param {unknown} raw
 * @returns {Record<string, any>}
 */
export function sanitizeStoredSettings(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [section, keys] of Object.entries(EDITABLE)) {
    const candidate = raw[section]
    if (!isPlainObject(candidate)) continue
    const sectionOut = {}
    for (const key of keys) {
      if (candidate[key] === undefined) continue
      const nested = NESTED_KEYS[section]?.[key]
      if (nested !== undefined) {
        if (!isPlainObject(candidate[key])) continue
        const nestedOut = {}
        for (const nestedKey of nested) {
          if (nestedKey === 'apiKey') continue
          if (candidate[key][nestedKey] !== undefined) nestedOut[nestedKey] = candidate[key][nestedKey]
        }
        if (Object.keys(nestedOut).length > 0) sectionOut[key] = nestedOut
        continue
      }
      sectionOut[key] = candidate[key]
    }
    // API keys are credential records, never plugin settings.
    if (section === 'embedding') delete sectionOut.apiKey
    if (Object.keys(sectionOut).length > 0) out[section] = sectionOut
  }
  return out
}

/**
 * The model/page view of the effective configuration. The API key never leaves
 * the host; the page only learns whether one is configured.
 * @param {Record<string, any>} config resolved effective config
 */
export function settingsView(config, { extractionApiKeySet = false } = {}) {
  const baseURL = config.embedding.endpoint.replace(/\/embeddings$/i, '')
  return {
    version: SETTINGS_VERSION,
    embedding: {
      baseURL,
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
      timeoutMs: config.embedding.timeoutMs,
      queryInstruction: config.embedding.queryInstruction,
      apiKeySet: config.embedding.apiKey !== '',
    },
    capture: {
      defaultScope: config.capture.defaultScope,
      dedupeThreshold: config.capture.dedupeThreshold,
      mode: config.capture.mode,
      extractEveryTurns: config.capture.extractEveryTurns,
      dailyTokenBudget: config.capture.dailyTokenBudget,
      candidateTtlDays: config.capture.candidateTtlDays,
      conflictDetection: config.capture.conflictDetection,
      conflictSimilarity: config.capture.conflictSimilarity,
      conflictJudge: {
        enabled: config.capture.conflictJudge.enabled,
        minSimilarity: config.capture.conflictJudge.minSimilarity,
        autoApplyConfidence: config.capture.conflictJudge.autoApplyConfidence,
        reviewConfidence: config.capture.conflictJudge.reviewConfidence,
        maxCandidates: config.capture.conflictJudge.maxCandidates,
        timeoutMs: config.capture.conflictJudge.timeoutMs,
        autoContradictNewWins: config.capture.conflictJudge.autoContradictNewWins,
      },
      llm: {
        baseURL: config.capture.llm.baseURL,
        model: config.capture.llm.model,
        contextWindow: config.capture.llm.contextWindow,
        maxOutputTokens: config.capture.llm.maxOutputTokens,
        timeoutMs: config.capture.llm.timeoutMs,
        apiKeySet: extractionApiKeySet,
      },
      admission: {
        enabled: config.capture.admission.enabled,
        minConfidence: config.capture.admission.minConfidence,
        maxPerRun: config.capture.admission.maxPerRun,
        includeRules: config.capture.admission.includeRules,
      },
      extractDebounceMs: config.capture.extractDebounceMs,
    },
    recall: {
      failureHints: config.recall.failureHints,
      failureHintMinSimilarity: config.recall.failureHintMinSimilarity,
      failureHintMaxPerSession: config.recall.failureHintMaxPerSession,
      ratings: {
        enabled: config.recall.ratings.enabled,
        defaultRating: config.recall.ratings.defaultRating,
        maxGroups: config.recall.ratings.maxGroups,
        maxMemoriesPerGroup: config.recall.ratings.maxMemoriesPerGroup,
      },
    },
    inject: {
      coreMemories: config.inject.coreMemories,
      coreMinImportance: config.inject.coreMinImportance,
      includeWorkspace: config.inject.includeWorkspace,
      corePitfalls: config.inject.corePitfalls,
      proactiveRecall: {
        enabled: config.inject.proactiveRecall.enabled,
        maxMemories: config.inject.proactiveRecall.maxMemories,
        minSimilarity: config.inject.proactiveRecall.minSimilarity,
        maxChars: config.inject.proactiveRecall.maxChars,
      },
    },
    retrieval: {
      defaultLimit: config.retrieval.defaultLimit,
    },
    periodic: {
      enabled: config.periodic.enabled,
      intervalMinutes: config.periodic.intervalMinutes,
      maxExtractionsPerDay: config.periodic.maxExtractionsPerDay,
      projectDigest: config.periodic.projectDigest,
    },
    graph: {
      enabled: config.graph.enabled,
      maxHops: config.graph.maxHops,
    },
  }
}

/**
 * Validate one settings patch before it reaches the store: only known sections
 * and keys are accepted, and a value must be JSON-safe. Field-level type
 * validation is delegated to `resolveConfig`, which throws on bad values.
 * @param {unknown} patch
 * @returns {Record<string, any>}
 */
export function sanitizePatch(patch) {
  if (!isPlainObject(patch)) throw new Error('settings patch must be an object')
  const out = {}
  for (const [section, keys] of Object.entries(EDITABLE)) {
    const candidate = patch[section]
    if (candidate === undefined) continue
    if (!isPlainObject(candidate)) throw new Error(`settings.${section} must be an object`)
    const sectionOut = {}
    for (const key of Object.keys(candidate)) {
      if (!keys.includes(key)) throw new Error(`settings.${section}.${key} is not editable`)
      const value = candidate[key]
      if (value === undefined) continue
      const nested = NESTED_KEYS[section]?.[key]
      if (nested !== undefined) {
        if (!isPlainObject(value)) throw new Error(`settings.${section}.${key} must be an object`)
        const nestedOut = {}
        for (const nestedKey of Object.keys(value)) {
          if (!nested.includes(nestedKey)) throw new Error(`settings.${section}.${key}.${nestedKey} is not editable`)
          const nestedValue = value[nestedKey]
          if (nestedValue === undefined) continue
          if (nestedValue !== null && typeof nestedValue === 'object') {
            throw new Error(`settings.${section}.${key}.${nestedKey} must be a scalar`)
          }
          nestedOut[nestedKey] = nestedValue
        }
        if (Object.keys(nestedOut).length > 0) sectionOut[key] = nestedOut
        continue
      }
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value) || !isPlainObject(value)) throw new Error(`settings.${section}.${key} must be a scalar`)
      }
      sectionOut[key] = value
    }
    if (Object.keys(sectionOut).length > 0) out[section] = sectionOut
  }
  return out
}

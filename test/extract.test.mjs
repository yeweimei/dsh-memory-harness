import test from 'node:test'
import assert from 'node:assert/strict'
import { Extractor, buildTranscript, parseExtraction, transcriptLimit } from '../lib/extract.js'
import { resolveConfig } from '../lib/config.js'

function event(seq, type, data) {
  return { seq, type, time: seq, data }
}

const transcript = [
  event(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'pnpm 安装一直报 ignored build scripts，怎么办？' }] }),
  event(2, 'tool/call', { name: 'bash', arguments: '{"command":"pnpm add esbuild"}' }),
  event(3, 'tool/result', { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS: ignored build scripts' }] }, error: { name: 'bash', reason: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS' } }),
  event(4, 'assistant/message', { message: { content: [{ type: 'text', text: '先运行 pnpm approve-builds 再重装。' }] } }),
  event(5, 'tool/call', { name: 'bash', arguments: '{"command":"pnpm approve-builds && pnpm install"}' }),
  event(6, 'tool/result', { message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'Done' }] } }),
].map((entry) => entry)

test('buildTranscript renders messages, tool calls and failures, honouring the watermark', () => {
  const text = buildTranscript(transcript, 1)
  assert.ok(text.includes('tool-error'))
  assert.ok(text.includes('ERR_PNPM_IGNORED_BUILD_SCRIPTS'))
  assert.ok(text.includes('pnpm approve-builds'))
  assert.ok(text.includes('@ 1970-01-01T00:00:00.002Z'))
  assert.ok(!text.includes('怎么办')) // seq 1 is before the watermark
})

test('admitPending runs the judge and applies validated decisions only', async () => {
  const config = resolveConfig({ capture: { admission: { enabled: true, minConfidence: 0.7, maxPerRun: 5 } }, embedding: { dimensions: 3, apiKey: 'x' } })
  const meta = new Map()
  const applied = []
  const service = {
    config,
    pendingCandidates: () => [
      { id: 'm_c1', text: '部署走代理。', kind: 'knowledge', scope: 'workspace', importance: 3, details: { source: 'llm', confidence: 0.8 }, workspace: '/w', sessionId: null, signature: null, vec: null },
    ],
    similarForAdmission: async () => [],
    applyAdmission: async (decisions) => {
      applied.push(decisions)
      return {
        added: decisions.filter((decision) => decision.action === 'add').length,
        updated: decisions.filter((decision) => decision.action === 'update').length,
        skipped: decisions.filter((decision) => decision.action === 'skip').length,
        failed: 0,
        ids: [],
      }
    },
    readMeta: (key) => meta.get(key),
    writeMeta: async (key, value) => meta.set(key, value),
  }
  let round = 0
  const complete = async () => {
    round += 1
    return JSON.stringify({
      decisions: [
        { candidateId: 'm_c1', action: 'add', kind: 'knowledge', scope: 'global', importance: 4, confidence: round === 1 ? 0.9 : 0.3, reason: 'durable' },
      ],
    })
  }
  const extractor = new Extractor({ service, logger: { warn() {} }, complete })
  const accepted = await extractor.admitPending({ limit: 5 })
  assert.equal(accepted.added, 1)
  assert.equal(applied[0][0].action, 'add')
  const rejected = await extractor.admitPending({ limit: 5 })
  assert.equal(rejected.added, 0)
  assert.equal(applied[1][0].action, 'skip', 'low-confidence decisions are rejected automatically')
})

test('transcriptLimit scales with the configured context window', () => {
  assert.equal(transcriptLimit(32768), 14000)
  assert.equal(transcriptLimit(8192), 5830)
  assert.equal(transcriptLimit(4096), 2000)
  assert.equal(transcriptLimit(undefined), 14000)
})

test('parseExtraction accepts grounded items and drops ungrounded or low-confidence ones', () => {
  const raw = JSON.stringify({
    items: [
      {
        kind: 'pitfall',
        text: 'pnpm 10 拦截依赖构建脚本；用 pnpm approve-builds 后重装解决。',
        details: { symptom: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS', cause: 'pnpm 默认阻止依赖脚本', fix: 'pnpm approve-builds && pnpm install' },
        tags: ['pnpm'],
        confidence: 0.9,
        observedAt: '2026-11-19T10:00:00.000Z',
        evidenceQuote: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS: ignored build scripts',
      },
      {
        kind: 'knowledge',
        text: '这条证据不存在，应该被丢弃。',
        confidence: 0.9,
        evidenceQuote: 'this quote is not in the transcript',
      },
      {
        kind: 'decision',
        text: '低置信度条目应被丢弃。',
        confidence: 0.2,
        evidenceQuote: '先运行 pnpm approve-builds 再重装。',
      },
    ],
    projectSummary: '项目使用 pnpm，注意构建脚本审批。',
  })
  const parsed = parseExtraction(raw, { transcript: buildTranscript(transcript, -1), minConfidence: 0.6 })
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].kind, 'pitfall')
  assert.equal(parsed.items[0].details.fix, 'pnpm approve-builds && pnpm install')
  assert.equal(parsed.items[0].tags[0], 'pnpm')
  assert.equal(parsed.items[0].observedAt, Date.parse('1970-01-01T00:00:00.003Z'))
  assert.match(parsed.summary, /pnpm/)

  assert.deepEqual(parseExtraction('not json', { transcript: 'x' }), { items: [], summary: '' })
})

test('parseExtraction tolerates code fences and clamps item count', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    kind: 'knowledge',
    text: `durable fact ${index} with enough length`,
    confidence: 0.9,
    evidenceQuote: 'pnpm approve-builds',
  }))
  const raw = '```json\n' + JSON.stringify({ items }) + '\n```'
  const parsed = parseExtraction(raw, { transcript: 'pnpm approve-builds', minConfidence: 0.5 })
  assert.equal(parsed.items.length, 5)
})

test('preview() runs extraction without writing candidates', async () => {
  const config = resolveConfig({ capture: { mode: 'rules+llm', minConfidence: 0.5 }, embedding: { dimensions: 3, apiKey: 'x' } })
  const meta = new Map()
  let applied = 0
  const service = {
    config,
    readExtractState: () => undefined,
    writeExtractState: async () => {},
    readMeta: (key) => meta.get(key),
    writeMeta: async (key, value) => meta.set(key, value),
    applyExtractionItems: async () => {
      applied += 1
      return []
    },
    upsertDigestCandidate: async () => {},
    projectDigest: () => undefined,
  }
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'session-1', cwd: '/work/project' } }],
    listEvents: async () => transcript.map((entry) => ({ seq: entry.seq, type: entry.type })),
    readSession: async () => ({ session: { cwd: '/work/project' }, events: transcript }),
  }
  const complete = async () =>
    JSON.stringify({
      items: [
        {
          kind: 'pitfall',
          text: '预演条目：pnpm 构建脚本需要审批。',
          details: { symptom: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS', fix: 'pnpm approve-builds' },
          confidence: 0.9,
          evidenceQuote: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS',
        },
      ],
      projectSummary: '项目使用 pnpm。',
    })
  const extractor = new Extractor({ service, logger: { warn() {} }, sessionQuery, complete })
  const preview = await extractor.preview({})
  assert.equal(preview.items.length, 1)
  assert.equal(preview.items[0].kind, 'pitfall')
  assert.equal(preview.summary, '项目使用 pnpm。')
  assert.equal(applied, 0, 'preview must not write candidates')
})

test('the extractor turns a session window into candidates and advances the watermark', async () => {
  const config = resolveConfig({ capture: { mode: 'rules+llm', minConfidence: 0.5 }, embedding: { dimensions: 3, apiKey: 'x' } })
  const state = new Map()
  const applied = []
  const summaries = []
  const service = {
    config,
    readExtractState: (sessionId) => state.get(sessionId),
    writeExtractState: async (value) => state.set(value.sessionId, value),
    readMeta: () => undefined,
    writeMeta: async () => {},
    applyExtractionItems: async (items, context) => {
      applied.push({ items, context })
      return items.map((item) => ({ id: `m_${applied.length}_${item.kind}`, status: 'candidate' }))
    },
    upsertDigestCandidate: async (value) => summaries.push(value),
    projectDigest: () => undefined,
  }
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'session-1', cwd: '/work/project', origin: undefined } }],
    listEvents: async () => transcript.map((entry) => ({ seq: entry.seq, type: entry.type })),
    readSession: async () => ({ session: { cwd: '/work/project' }, events: transcript }),
  }
  const complete = async () =>
    JSON.stringify({
      items: [
        {
          kind: 'pitfall',
          text: 'pnpm 10 拦截依赖构建脚本；用 pnpm approve-builds 后重装解决。',
          details: { symptom: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS', fix: 'pnpm approve-builds && pnpm install' },
          confidence: 0.9,
          evidenceQuote: 'ERR_PNPM_IGNORED_BUILD_SCRIPTS: ignored build scripts',
        },
      ],
      projectSummary: '项目使用 pnpm；构建脚本需要审批。',
    })
  const extractor = new Extractor({ service, logger: { warn() {} }, sessionQuery, complete })
  const result = await extractor.runPeriodic()
  assert.equal(result.sessions, 1)
  assert.equal(result.candidates, 1)
  assert.equal(result.summaries, 1)
  assert.equal(applied.length, 1)
  assert.equal(applied[0].context.project, '/work/project')
  assert.equal(summaries.length, 1)
  assert.equal(state.get('session-1').lastSeq, 6)
})

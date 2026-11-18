import test from 'node:test'
import assert from 'node:assert/strict'
import { registerCommands } from '../lib/commands.js'
import { createMemoryTool, renderResult } from '../lib/tool.js'

const agent = { session: { id: 's1', header: { cwd: '/work/project-a' } } }
const workingDirectory = { get: () => '/work/project-a' }

function fakeCommandContext() {
  const definitions = new Map()
  return {
    definitions,
    ctx: {
      commands: {
        register(definition) {
          definitions.set(definition.name, definition)
          return () => definitions.delete(definition.name)
        },
      },
    },
  }
}

function fakeService(calls = []) {
  return {
    calls,
    async save(input, context) {
      calls.push(['save', input, context])
      return { id: 'm_test', status: 'created', scope: 'global', kind: 'other', importance: 3 }
    },
    async search(input, context) {
      calls.push(['search', input, context])
      return {
        memories: [
          { id: 'm_1', text: '用户偏好 TypeScript。', kind: 'preference', scope: 'global', ageDays: 2, match: 'both' },
        ],
        total: 1,
        degraded: false,
      }
    },
    async list(input) {
      calls.push(['list', input])
      return { memories: [{ id: 'm_1', text: '用户偏好 TypeScript。', kind: 'preference', scope: 'global', ageDays: 2 }], total: 1 }
    },
    async forget(id) {
      calls.push(['forget', id])
      return { id, deleted: true }
    },
    async update(input) {
      calls.push(['update', input])
      return { id: input.id, text: input.text }
    },
    async stats() {
      return {
        count: 1,
        byScope: { global: 1, workspace: 0, session: 0 },
        pendingEmbeddings: 0,
        embedder: { ok: true, latencyMs: 5, dimensions: 1024 },
        embedding: { model: 'fake' },
      }
    },
  }
}

test('/remember saves a global memory and rejects empty input', async () => {
  const { ctx, definitions } = fakeCommandContext()
  const calls = []
  registerCommands(ctx, fakeService(calls), { workingDirectory })
  const remember = definitions.get('remember')

  const empty = await remember.handler({ agent, rawInput: '   ' })
  assert.equal(empty.kind, 'error')
  assert.equal(calls.length, 0)

  const saved = await remember.handler({ agent, rawInput: '  以后用中文回答  ' })
  assert.equal(saved.kind, 'success')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'save')
  assert.equal(calls[0][1].text, '以后用中文回答')
  assert.equal(calls[0][1].scope, 'global')
  assert.equal(calls[0][2].sessionId, 's1')
  assert.equal(calls[0][2].workspace, '/work/project-a')
})

test('/memory dispatches search, list, stats, save, forget and help', async () => {
  const { ctx, definitions } = fakeCommandContext()
  const calls = []
  const memory = definitions.get('memory') ?? (registerCommands(ctx, fakeService(calls), { workingDirectory }), definitions.get('memory'))

  const search = await memory.handler({ agent, rawInput: 'search TypeScript' })
  assert.equal(search.kind, 'success')
  assert.match(search.text, /找到 1 条/)
  assert.equal(calls[0][0], 'search')
  assert.equal(calls[0][1].query, 'TypeScript')

  const list = await memory.handler({ agent, rawInput: 'list global' })
  assert.match(list.text, /最近 1 条/)

  const stats = await memory.handler({ agent, rawInput: 'stats' })
  assert.match(stats.text, /记忆总数：1/)
  assert.match(stats.text, /嵌入服务：正常/)

  const save = await memory.handler({ agent, rawInput: 'save 项目部署在 NAS 上' })
  assert.match(save.text, /已保存/)
  assert.equal(calls.at(-1)[1].text, '项目部署在 NAS 上')

  const forget = await memory.handler({ agent, rawInput: 'forget m_1' })
  assert.match(forget.text, /已删除/)

  const help = await memory.handler({ agent, rawInput: '' })
  assert.match(help.text, /\/remember/)

  const unknown = await memory.handler({ agent, rawInput: 'nope' })
  assert.equal(unknown.kind, 'success')
  assert.match(unknown.text, /\/memory search/)
})

test('the memory tool routes actions through the service with session context', async () => {
  const calls = []
  const tool = createMemoryTool(fakeService(calls), { workingDirectory })

  assert.equal(tool.name, 'memory')
  assert.equal(tool.parameters.required[0], 'action')

  const exec = { agent, signal: new AbortController().signal, turn: 3 }
  const saved = await tool.execute({ action: 'save', text: '用户偏好中文。', kind: 'preference' }, exec)
  assert.equal(saved.id, 'm_test')
  assert.equal(calls.at(-1)[0], 'save')
  assert.equal(calls.at(-1)[2].sessionId, 's1')
  assert.equal(calls.at(-1)[2].workspace, '/work/project-a')

  const searched = await tool.execute({ action: 'search', query: '偏好' }, exec)
  assert.equal(searched.memories.length, 1)
  assert.equal(calls.at(-1)[0], 'search')

  const listed = await tool.execute({ action: 'list', scope: 'global' }, exec)
  assert.equal(listed.total, 1)
  assert.equal(calls.at(-1)[1].full, false)

  const forgotten = await tool.execute({ action: 'forget', id: 'm_1' }, exec)
  assert.equal(forgotten.deleted, true)

  await assert.rejects(() => tool.execute({ action: 'unknown' }, exec), /unknown memory action/)
})

test('tool results render bounded, readable text', () => {
  const search = renderResult(
    { action: 'search' },
    {
      memories: [
        {
          id: 'm_1',
          text: '用户偏好 TypeScript。',
          kind: 'preference',
          scope: 'global',
          match: 'both',
          score: 0.03,
          similarity: 0.66,
          ageDays: 1,
        },
      ],
      degraded: false,
    },
  )
  assert.match(search, /1 memories/)
  assert.match(search, /id=m_1/)
  assert.match(search, /match=both/)

  assert.equal(renderResult({ action: 'save' }, { id: 'm_1', status: 'created' }), 'Saved m_1 (created).')
  assert.equal(renderResult({ action: 'forget' }, { id: 'm_1', deleted: true }), 'Forgot m_1.')
})

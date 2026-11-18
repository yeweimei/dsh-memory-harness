import test from 'node:test'
import assert from 'node:assert/strict'
import { registerProactiveRecall } from '../lib/inject.js'

test('first user step receives one context-specific recall block', async () => {
  let handler
  const ctx = {
    on(name, callback) {
      if (name === 'agent/pre-step') handler = callback
      return () => {}
    },
    logger: { warn() {} },
  }
  const calls = []
  const service = {
    config: { inject: { proactiveRecall: { enabled: true } } },
    async proactiveRecall(input) {
      calls.push(input)
      return { text: '<dsh-memory-recall>\n- [project/workspace] TypeScript memory\n</dsh-memory-recall>', ids: ['m_1'], count: 1 }
    },
  }
  registerProactiveRecall(ctx, service, { workingDirectory: { get: () => '/work/project-a' } })
  const agent = { session: { id: 's-proactive-hook', header: { cwd: '/work/project-a' } } }
  const base = { agent, signal: new AbortController().signal }
  const decision = { kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '请帮我改 TypeScript 项目' }] }] }
  const injected = await handler(base, async () => decision)
  assert.equal(injected.messages.length, 2)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 's-proactive-hook')
  assert.equal(calls[0].workspace, '/work/project-a')
  assert.ok(injected.messages[1].content[0].text.includes('<dsh-memory-recall>'))

  const again = await handler(base, async () => decision)
  assert.equal(again.messages.length, 1)
  assert.equal(calls.length, 1)
})

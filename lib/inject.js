/**
 * Session-start core-memory injection.
 *
 * A fresh session (not a resume or a compaction continuation) receives one
 * bounded user-role context message with the highest-value global memories plus
 * the current workspace's important memories. The message is durable: the
 * conversation log records it as an inbox splice, so the injected context
 * survives later resumes without being injected twice.
 */
import { randomUUID } from 'node:crypto'
import { contextOf } from './service.js'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./service.js').MemoryService} service
 * @param {{ workingDirectory?: any }} deps
 * @returns {() => void}
 */
export function registerProactiveRecall(ctx, service, deps) {
  /** @type {Set<string>} */
  const attempted = new Set()
  return ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal?.aborted === true) return decision
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '' || attempted.has(sessionId)) return decision
    if (service.config.inject.proactiveRecall?.enabled !== true) return decision
    const query = lastUserText(decision.messages)
    if (query === '') return decision
    attempted.add(sessionId)
    if (attempted.size > 1000) attempted.delete(attempted.values().next().value)
    const { workspace } = contextOf(agent, deps.workingDirectory)
    let recall
    try {
      recall = await withTimeout(
        service.proactiveRecall({ query, workspace, sessionId, signal }),
        1200,
      )
    } catch (error) {
      ctx.logger?.warn?.(`dsh-memory: proactive recall skipped: ${String(error)}`)
      return decision
    }
    if (signal?.aborted === true || recall.text === '') return decision
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: recall.text }],
      source: {
        kind: 'dsh-memory',
        form: 'snapshot',
        sections: [{ name: 'dsh-memory:recall', text: recall.text }],
      },
    }
    return { ...decision, messages: [...decision.messages, message] }
  })
}

/**
 * The last real user message in the claimed list. Core-memory snapshots are
 * also user-role messages, so they are skipped explicitly.
 * @param {any[]} messages
 */
function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || message?.source?.kind === 'dsh-memory') continue
    const text = Array.isArray(message.content)
      ? message.content
          .filter((part) => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n')
      : typeof message.content === 'string' ? message.content : ''
    const trimmed = text.trim()
    if (trimmed !== '') return trimmed.slice(0, 4000)
  }
  return ''
}

/** @param {Promise<any>} promise @param {number} ms */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function registerCoreMemoryInjection(ctx, service, deps) {
  return ctx.on('agent/created', ({ agent, source }) => {
    try {
      if (source === 'resume' || source === 'compact') return
      const { workspace } = contextOf(agent, deps.workingDirectory)
      const core = service.coreMemories({ workspace })
      if (core.text === '') return
      const sessionId = agent.session?.id ?? null
      if (sessionId !== null && Array.isArray(core.ids) && core.ids.length > 0) {
        void service.recordRecall({ sessionId, source: 'core', ids: core.ids, detail: { workspace } })
      }
      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: core.text }],
        source: {
          kind: 'dsh-memory',
          form: 'snapshot',
          sections: [{ name: 'dsh-memory:core', text: core.text }],
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-memory: core-memory injection skipped: ${String(error)}`)
    }
  })
}

/**
 * Human-facing slash commands.
 *
 * `/remember` is the explicit capture path: it bypasses model judgement and
 * writes a global memory directly. `/memory` exposes the same service methods
 * for browsing, search, stats and cleanup. Both call {@link MemoryService}, so
 * the UI, the commands and the agent tool never drift apart.
 */
import { contextOf } from './service.js'

const OUTPUT_LIMIT = 4000

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./service.js').MemoryService} service
 * @param {{ workingDirectory?: any }} deps
 */
export function registerCommands(ctx, service, deps) {
  ctx.commands.register({
    name: 'remember',
    description: '保存一条长期记忆（全局作用域，跨会话可见）',
    input: { hint: '<要记住的内容>' },
    handler: async ({ agent, rawInput }) => {
      const text = String(rawInput ?? '').trim()
      if (text === '') return { kind: 'error', text: '用法：/remember <要记住的内容>' }
      try {
        const context = contextOf(agent, deps.workingDirectory)
        const result = await service.save({ text, kind: 'other', scope: 'global' }, { ...context, turn: null })
        const status = result.status === 'merged' ? '已合并到相近记忆' : result.status === 'duplicate' ? '已存在，已更新' : '已记入全局记忆'
        return { kind: 'success', text: `${status}：${result.id}` }
      } catch (error) {
        return { kind: 'error', text: `保存失败：${messageOf(error)}` }
      }
    },
  })

  ctx.commands.register({
    name: 'memory',
    description: '记忆管理：search / list / stats / save / forget / candidates / confirm / dismiss',
    input: { hint: 'search <查询> | list [scope] | stats | save <文本> | forget <id> | candidates | confirm <id> | dismiss <id>' },
    handler: async ({ agent, rawInput }) => {
      const input = String(rawInput ?? '').trim()
      if (input === '') return { kind: 'success', text: helpText() }
      const [subcommand, ...rest] = input.split(/\s+/)
      const argument = rest.join(' ').trim()
      const context = contextOf(agent, deps.workingDirectory)
      try {
        switch (subcommand) {
          case 'search':
          case 's': {
            if (argument === '') return { kind: 'error', text: '用法：/memory search <查询>' }
            const result = await service.search({ query: argument, limit: 10 }, context)
            return { kind: 'success', text: formatSearch(result) }
          }
          case 'list':
          case 'ls': {
            const scope = ['global', 'workspace', 'session'].includes(argument) ? argument : undefined
            const result = await service.list({ scope, limit: 10, full: false }, context)
            return { kind: 'success', text: formatList(result) }
          }
          case 'stats': {
            const stats = await service.stats()
            return { kind: 'success', text: formatStats(stats) }
          }
          case 'save': {
            if (argument === '') return { kind: 'error', text: '用法：/memory save <文本>' }
            const result = await service.save({ text: argument, kind: 'other' }, { ...context, turn: null })
            return { kind: 'success', text: `已保存：${result.id}${result.status === 'merged' ? '（合并）' : ''}` }
          }
          case 'forget':
          case 'delete': {
            if (argument === '') return { kind: 'error', text: '用法：/memory forget <id>' }
            const result = await service.forget(argument)
            return { kind: 'success', text: result.deleted ? `已删除：${result.id}` : `没有找到：${result.id}` }
          }
          case 'candidates': {
            const result = await service.listCandidates({ limit: 10, status: 'candidate' })
            return { kind: 'success', text: formatCandidates(result) }
          }
          case 'confirm': {
            if (argument === '') return { kind: 'error', text: '用法：/memory confirm <id>' }
            const result = await service.confirmCandidate(argument)
            return { kind: 'success', text: `已确认并激活：${result.id}` }
          }
          case 'dismiss': {
            if (argument === '') return { kind: 'error', text: '用法：/memory dismiss <id>' }
            const result = await service.dismissCandidate(argument)
            return { kind: 'success', text: `已忽略：${result.id}` }
          }
          case 'archive': {
            if (argument === '') return { kind: 'error', text: '用法：/memory archive <id>' }
            const result = await service.archive(argument)
            return { kind: 'success', text: `已归档：${result.id}` }
          }
          case 'restore': {
            if (argument === '') return { kind: 'error', text: '用法：/memory restore <id>' }
            const result = await service.restore(argument)
            return { kind: 'success', text: `已恢复：${result.id}` }
          }
          case 'history': {
            if (argument === '') return { kind: 'error', text: '用法：/memory history <id>' }
            const result = service.revisions(argument, 10)
            if (result.revisions.length === 0) return { kind: 'success', text: `${argument} 没有修订历史。` }
            const lines = result.revisions.map(
              (revision) => `r${revision.revision} ${revision.action}/${revision.actor} ${new Date(revision.createdAt).toISOString()}`,
            )
            return { kind: 'success', text: `修订历史 ${argument}：\n${lines.join('\n')}` }
          }
          case 'diff': {
            const [id, fromText, toText] = argument.split(/\s+/)
            if (!id || !fromText) return { kind: 'error', text: '用法：/memory diff <id> <fromRevision> [toRevision]' }
            const result = service.diffRevisions(id, Number.parseInt(fromText, 10), toText === undefined ? null : Number.parseInt(toText, 10))
            const fieldLines = result.fields.map((field) => `${field.field}: ${JSON.stringify(field.before)} → ${JSON.stringify(field.after)}`)
            return {
              kind: 'success',
              text: [`diff r${result.from.revision} → r${result.to.revision}`, ...fieldLines, '', result.text].join('\n').slice(0, OUTPUT_LIMIT),
            }
          }
          case 'import': {
            if (argument === '') return { kind: 'error', text: '用法：/memory import <json 文件路径>' }
            const result = await service.importFile(argument)
            return {
              kind: 'success',
              text: `导入完成：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}`,
            }
          }
          case 'feedback': {
            const [id, action] = argument.split(/\s+/)
            if (!id || !['relevant', 'irrelevant', 'helpful', 'unhelpful'].includes(action)) {
              return { kind: 'error', text: '用法：/memory feedback <id> <relevant|irrelevant|helpful|unhelpful>' }
            }
            const result = await service.feedback(id, action, { source: 'command' })
            return { kind: 'success', text: `已记录反馈：${result.id} → ${result.action}` }
          }
          case 'quality': {
            const days = Number.parseInt(argument, 10)
            const report = service.qualityReport({ days: Number.isFinite(days) ? days : 7 })
            const totals = report.totals
            const lines = [
              `召回质量（${report.rangeDays} 天）`,
              `准确率 ${totals.accuracy === null ? '-' : `${Math.round(totals.accuracy * 100)}%`} · 有效率 ${totals.effectiveness === null ? '-' : `${Math.round(totals.effectiveness * 100)}%`} · 覆盖率 ${totals.coverage === null ? '-' : `${Math.round(totals.coverage * 100)}%`} · 过时率 ${totals.outdatedRate === null ? '-' : `${Math.round(totals.outdatedRate * 100)}%`}`,
              `样本：${totals.explicitRatings} 条评分 / ${totals.recalls} 个召回组`,
            ]
            if (report.suggestions.length > 0) lines.push('建议：', ...report.suggestions.map((suggestion) => `[${suggestion.level}] ${suggestion.message}`))
            return { kind: 'success', text: lines.join('\n').slice(0, OUTPUT_LIMIT) }
          }
          case 'doctor': {
            const report = await service.diagnostics()
            const lines = []
            lines.push(`记忆 ${report.counts.active} active / ${report.counts.candidate} 待确认 / ${report.counts.archived} 归档 / ${report.counts.superseded} 被取代`)
            lines.push(`嵌入服务 ${report.embedder?.ok === true ? `正常（${report.embedder.latencyMs}ms）` : '不可用'} · 待补向量 ${report.pendingEmbeddings ?? '?'}`)
            lines.push(`今日预算 calls ${report.budget.calls}/${report.budget.limits.maxExtractionsPerDay} · tokens ${report.budget.tokens}/${report.budget.limits.dailyTokenBudget}`)
            lines.push(`备份 ${report.backups.count} 份 · 最新 ${report.backups.newest ? new Date(report.backups.newest.createdAt).toISOString() : '无'}`)
            const runs = Object.entries(report.events.lastRuns).slice(0, 8).map(
              ([kind, run]) => `${kind}: ${run.status}${run.durationMs !== null ? ` ${run.durationMs}ms` : ''}${run.error ? ` — ${run.error}` : ''} @ ${new Date(run.at).toISOString()}`,
            )
            if (runs.length > 0) lines.push('最近运行：', ...runs)
            if (report.warnings.length > 0) lines.push('告警：', ...report.warnings.map((warning) => `[${warning.level}] ${warning.message}`))
            return { kind: 'success', text: lines.join('\n').slice(0, OUTPUT_LIMIT) }
          }
          case 'events': {
            const limit = Number.parseInt(argument, 10)
            const events = service.listEvents({ limit: Number.isFinite(limit) ? limit : 20 })
            if (events.length === 0) return { kind: 'success', text: '还没有可观测事件。' }
            const lines = events.map(
              (event) => `${new Date(event.at).toISOString()} ${event.kind}/${event.status}${event.durationMs !== null ? ` ${event.durationMs}ms` : ''}${event.count !== null ? ` ×${event.count}` : ''}${event.error ? ` — ${event.error}` : ''}`,
            )
            return { kind: 'success', text: lines.join('\n').slice(0, OUTPUT_LIMIT) }
          }
          case 'backup': {
            const result = await service.createBackup('manual')
            return { kind: 'success', text: `已备份：${result.name}（${Math.round((result.size ?? 0) / 1024)} KB）` }
          }
          case 'backups': {
            const backups = service.listBackups()
            if (backups.length === 0) return { kind: 'success', text: '还没有数据库备份。' }
            const lines = backups.map(
              (backup) => `${backup.name} · ${Math.round(backup.size / 1024)} KB · ${new Date(backup.createdAt).toISOString()}`,
            )
            return { kind: 'success', text: `备份（最新在前）：\n${lines.join('\n')}` }
          }
          case 'restore-backup': {
            if (argument === '') return { kind: 'error', text: '用法：/memory restore-backup <备份文件名>' }
            const result = await service.restoreBackup(argument)
            return {
              kind: 'success',
              text: `恢复完成：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}；安全备份 ${result.safetyBackup ?? '无'}`,
            }
          }
          case 'consolidate': {
            if (deps.consolidateNow === undefined) return { kind: 'error', text: '整理任务不可用' }
            const result = await deps.consolidateNow(false)
            return { kind: 'success', text: `整理完成：合并 ${result.merged ?? 0} 条，归档 ${result.archived ?? 0} 条。` }
          }
          case 'rollback': {
            const [id, revisionText] = argument.split(/\s+/)
            if (!id || !revisionText) return { kind: 'error', text: '用法：/memory rollback <id> <revision>' }
            const result = await service.rollback(id, Number.parseInt(revisionText, 10))
            return { kind: 'success', text: `已回滚到修订版本，当前修订 r${result.revision}。` }
          }
          case 'admit': {
            if (deps.admitNow === undefined) return { kind: 'error', text: '自动准入不可用（未注入抽取器）' }
            const result = await deps.admitNow()
            return {
              kind: 'success',
              text: `自动准入：add ${result.added ?? 0} / update ${result.updated ?? 0} / skip ${result.skipped ?? 0} / failed ${result.failed ?? 0}`,
            }
          }
          case 'export': {
            const format = argument === 'md' || argument === 'markdown' ? 'markdown' : 'json'
            const result = await service.exportBundle({ format })
            return { kind: 'success', text: `已导出 ${result.count} 条到：${result.path}` }
          }
          case 'help':
          default:
            return { kind: 'success', text: helpText() }
        }
      } catch (error) {
        return { kind: 'error', text: `记忆操作失败：${messageOf(error)}` }
      }
    },
  })
}

function helpText() {
  return [
    '/remember <内容>      直接保存一条全局记忆',
    '/memory search <查询> 混合检索记忆',
    '/memory list [scope]  最近记忆（scope: global | workspace | session）',
    '/memory save <文本>   保存一条记忆',
    '/memory forget <id>   删除一条记忆',
    '/memory stats         统计与嵌入服务健康',
    '/memory archive <id>   归档一条记忆',
    '/memory restore <id>   恢复归档/被取代的记忆',
    '/memory history <id>   查看修订历史',
    '/memory admit         立即运行 LLM 自动准入',
    '/memory consolidate   合并近重复记忆、归档过期低价值记忆',
    '/memory rollback <id> <revision> 回滚到某个修订版本',
    '/memory diff <id> <from> [to]   对比修订快照（省略 to 则对比当前）',
    '/memory import <path.json>      从 JSON 导出文件导入/恢复',
    '/memory feedback <id> <relevant|irrelevant> 记录检索相关度反馈',
    '/memory quality [days]          召回准确率/有效率/覆盖率曲线数据',
    '/memory doctor                  健康诊断（告警/预算/最近运行/备份）',
    '/memory events [n]              最近的可观测事件',
    '/memory backup                  立即备份数据库',
    '/memory backups                 列出备份文件',
    '/memory restore-backup <name>   从备份一键恢复（合并，先自动备份当前库）',
    '/memory export [json|md] 导出记忆到数据目录的 exports/',
  ].join('\n')
}

function formatSearch(result) {
  const memories = Array.isArray(result?.memories) ? result.memories : []
  if (memories.length === 0) {
    return result?.degraded === true ? `没有匹配的记忆（语义检索不可用：${result.degradedReason ?? '嵌入服务异常'}）` : '没有匹配的记忆。'
  }
  const lines = memories.map((memory, index) => {
    const meta = [`${memory.kind}/${memory.scope}`]
    if (memory.match !== undefined) meta.push(memory.match)
    if (memory.ageDays !== undefined) meta.push(`${memory.ageDays}天前`)
    return `${index + 1}. [${meta.join(' ')}] ${oneLine(memory.text)}  (${memory.id})`
  })
  const header = `找到 ${memories.length} 条${result.degraded === true ? '（语义检索降级，仅关键词）' : ''}：`
  return truncate([header, ...lines].join('\n'), OUTPUT_LIMIT)
}

function formatList(result) {
  const memories = Array.isArray(result?.memories) ? result.memories : []
  if (memories.length === 0) return '记忆库为空。'
  const lines = memories.map(
    (memory, index) => `${index + 1}. [${memory.kind}/${memory.scope}] ${oneLine(memory.text)}  (${memory.id})`,
  )
  return truncate([`最近 ${memories.length} 条（共 ${result.total} 条）：`, ...lines].join('\n'), OUTPUT_LIMIT)
}

function formatCandidates(result) {
  const memories = Array.isArray(result?.memories) ? result.memories : []
  if (memories.length === 0) return '没有待确认的候选记忆。'
  const lines = memories.map((memory, index) => {
    const meta = [memory.kind, memory.scope]
    if (typeof memory.details?.confidence === 'number') meta.push(`置信度 ${memory.details.confidence}`)
    return `${index + 1}. [${meta.join(' ')}] ${oneLine(memory.text)}  (${memory.id})`
  })
  return truncate([`待确认候选（共 ${result.total} 条）：`, ...lines].join('\n'), OUTPUT_LIMIT)
}

function formatStats(stats) {
  const embedder = stats?.embedder ?? {}
  const scopes = stats?.byScope ?? {}
  const lines = [
    `记忆总数：${stats?.count ?? 0}`,
    `按作用域：global ${scopes.global ?? 0} / workspace ${scopes.workspace ?? 0} / session ${scopes.session ?? 0}`,
    `待补向量：${stats?.pendingEmbeddings ?? 0}`,
    `嵌入服务：${embedder.ok === true ? `正常（${embedder.latencyMs}ms, ${embedder.dimensions}d）` : `不可用（${embedder.error ?? 'unknown'}）`}`,
    `模型：${stats?.embedding?.model ?? 'unknown'}`,
  ]
  return truncate(lines.join('\n'), OUTPUT_LIMIT)
}

function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

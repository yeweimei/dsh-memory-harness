/**
 * Verify the settings-page RPC path (Host side) without a browser.
 *
 * Mints the same signed browser-session cookie the Web page holds, then calls
 * the package-private Remote endpoints over the stock /api channel exactly as
 * the Client half does.
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.DSH_GUI_ORIGIN ?? 'http://127.0.0.1:3080'
if (!process.env.DSH_GUI_ORIGIN) {
  console.warn('DSH_GUI_ORIGIN is not set; defaulting to http://127.0.0.1:3080')
}
const AUTHORITY = new URL(BASE).host
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const yaml = readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8')
const lines = yaml.split('\n')
let secretText = null
for (let index = 0; index < lines.length; index += 1) {
  if (!lines[index].includes('client-connection/browser-session')) continue
  for (let probe = index + 1; probe < Math.min(index + 8, lines.length); probe += 1) {
    const match = /^\s*secret:\s*(\S+)\s*$/.exec(lines[probe])
    if (match !== null) {
      secretText = match[1]
      break
    }
  }
  break
}
if (secretText === null) throw new Error('browser-session secret not found')

const secret = Buffer.from(
  secretText.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (secretText.length % 4)) % 4),
  'base64',
)
const base64url = (buffer) => buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const issuedAt = Date.now()
const expiresAt = issuedAt + 3600_000
const body = base64url(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt, expiresAt }), 'utf8'))
const signature = base64url(createHmac('sha256', secret).update(body).digest())
const cookieName = `dsh-auth-${base64url(createHash('sha256').update(AUTHORITY).digest())}`
const cookie = `${cookieName}=v1.${body}.${signature}`

let rpcId = 0
async function call(method, args) {
  rpcId += 1
  const response = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `verify-${rpcId}`,
      method,
      payload: { args: args ?? {} },
    }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  return { status: response.status, parsed, text }
}

function report(label, result) {
  if (result.parsed === undefined) {
    console.log(`${label}: HTTP ${result.status} — ${result.text.slice(0, 160)}`)
    return undefined
  }
  const payload = result.parsed.result
  if (payload?.ok !== true) {
    console.log(`${label}: HTTP ${result.status} — RPC error ${JSON.stringify(payload?.error ?? result.parsed).slice(0, 240)}`)
    return undefined
  }
  return payload.value
}

const stats = report('stats', await call('dsh-memory/stats'))
if (stats !== undefined) {
  console.log(`  count=${stats.count} pending=${stats.pendingEmbeddings} embedder=${stats.embedder.ok} dims=${stats.embedding.dimensions}`)
}

const list = report('list', await call('dsh-memory/list', { limit: 5, offset: 0 }))
if (list !== undefined) console.log(`  total=${list.total} returned=${list.memories.length}`)

const saved = report(
  'save',
  await call('dsh-memory/save', {
    text: '设置页 RPC 自检临时记录（验证后自动删除）。',
    kind: 'other',
    scope: 'global',
    importance: 1,
  }),
)
if (saved !== undefined) console.log(`  id=${saved.id} status=${saved.status}`)

const search = report('search', await call('dsh-memory/search', { query: 'RPC 自检', limit: 3 }))
if (search !== undefined) {
  console.log(`  hits=${search.memories.length} degraded=${search.degraded} first=${search.memories[0]?.id ?? '-'}`)
}

const updated = report('update', await call('dsh-memory/update', { id: saved?.id, text: '设置页 RPC 自检临时记录（已编辑）。' }))
if (updated !== undefined) console.log(`  text=${updated.text}`)

const removed = report('delete', await call('dsh-memory/delete', { id: saved?.id }))
if (removed !== undefined) console.log(`  deleted=${removed.deleted}`)

const after = report('stats-after', await call('dsh-memory/stats'))
if (after !== undefined) console.log(`  count=${after.count}`)

const options = report('options', await call('dsh-memory/options'))
if (options !== undefined) console.log(`  scopes=${options.scopes.join('/')} kinds=${options.kinds.length}`)

const candidates = report('candidates', await call('dsh-memory/candidates', { limit: 10, offset: 0, status: 'candidate' }))
if (candidates !== undefined) console.log(`  candidates=${candidates.total}`)

const settings = report('getSettings', await call('dsh-memory/getSettings'))
if (settings !== undefined) {
  console.log(
    `  model=${settings.embedding.model} dims=${settings.embedding.dimensions} apiKeySet=${settings.embedding.apiKeySet} defaultLimit=${settings.retrieval.defaultLimit} coreMemories=${settings.inject.coreMemories} autoMode=${settings.capture.mode} failureHints=${settings.recall.failureHints} periodic=${settings.periodic.enabled} graph=${settings.graph.enabled}`,
  )
}

const patched = report('setSettings', await call('dsh-memory/setSettings', { patch: { retrieval: { defaultLimit: 6 } } }))
if (patched !== undefined) console.log(`  defaultLimit=${patched.retrieval.defaultLimit}`)

const invalid = await call('dsh-memory/setSettings', { patch: { embedding: { dimensions: 0 } } })
if (invalid.parsed !== undefined && invalid.parsed.result?.ok === false) {
  console.log(`  invalid patch refused: ${invalid.parsed.result.error.code}`)
} else {
  console.log('  invalid patch NOT refused (unexpected)')
}

const restored = report('restoreSettings', await call('dsh-memory/setSettings', { patch: { retrieval: { defaultLimit: 5 } } }))
if (restored !== undefined) console.log(`  defaultLimit=${restored.retrieval.defaultLimit}`)

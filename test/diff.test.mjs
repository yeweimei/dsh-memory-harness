import test from 'node:test'
import assert from 'node:assert/strict'
import { diffFields, diffLines, formatDiff } from '../lib/diff.js'

test('diffLines marks added, removed and context lines', () => {
  const lines = diffLines('alpha\nbeta\ngamma', 'alpha\nBETA\ngamma\ndelta')
  assert.ok(lines.some((line) => line.type === 'del' && line.text === 'beta'))
  assert.ok(lines.some((line) => line.type === 'add' && line.text === 'BETA'))
  assert.ok(lines.some((line) => line.type === 'add' && line.text === 'delta'))
  assert.ok(lines.some((line) => line.type === 'context' && line.text === 'alpha'))
  const text = formatDiff(lines)
  assert.match(text, /^-beta$/m)
  assert.match(text, /^\+BETA$/m)
})

test('diffLines handles very large inputs with the prefix/suffix fallback', () => {
  const before = Array.from({ length: 900 }, (_, index) => `line ${index}`).join('\n')
  const after = before.replace('line 450', 'line 450 changed')
  const lines = diffLines(before, after)
  assert.ok(lines.some((line) => line.type === 'del' && line.text === 'line 450'))
  assert.ok(lines.some((line) => line.type === 'add' && line.text === 'line 450 changed'))
  assert.ok(lines.length <= 400)
})

test('diffFields reports changed lifecycle fields only', () => {
  const changes = diffFields(
    { kind: 'project', scope: 'workspace', importance: 3, status: 'active', tags: ['a'], details: { fix: 'x' } },
    { kind: 'project', scope: 'global', importance: 4, status: 'archived', tags: ['a', 'b'], details: { fix: 'y' } },
  )
  const names = changes.map((change) => change.field)
  assert.deepEqual(names, ['scope', 'status', 'importance', 'tags', 'details'])
})

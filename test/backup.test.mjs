import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryService } from '../lib/service.js'
import { SqliteStore } from '../lib/sqlite-store.js'

function fakeEmbedder() {
  return {
    async documents(texts) {
      return texts.map(() => new Float32Array([0.1, 0.2, 0.3]))
    },
    async query() {
      return new Float32Array([0.1, 0.2, 0.3])
    },
    async health() {
      return { ok: true, latencyMs: 1 }
    },
  }
}

test('backup rotation and one-click restore recover records and revisions', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-backup-'))
  const service = new MemoryService({
    ctx: {},
    rawConfig: {
      embedding: { dimensions: 3, apiKey: 'test', baseURL: 'http://127.0.0.1:9999/v1' },
      storage: { backend: 'sqlite', dataDir: dir },
    },
    logger: { warn() {}, info() {} },
    store: new SqliteStore({ dataDir: dir }),
    embedder: fakeEmbedder(),
  })
  try {
    await service.load()
    const saved = await service.save({ text: '备份恢复 TypeScript 测试记录。', kind: 'knowledge', scope: 'global' }, {})
    const backup = await service.createBackup('test')
    assert.match(backup.name, /^memory-test-.*\.db$/)
    assert.equal(service.listBackups().length, 1)

    await service.forget(saved.id)
    assert.equal(service.store.get(saved.id), undefined)

    const restored = await service.restoreBackup(backup.name)
    assert.ok(restored.imported >= 1)
    assert.ok(restored.safetyBackup.startsWith('memory-pre-restore-'))
    const record = service.store.get(saved.id)
    assert.ok(record)
    assert.equal(record.text, '备份恢复 TypeScript 测试记录。')
    assert.equal(record.status, 'active')
    assert.ok(service.listBackups().length >= 2, 'pre-restore safety backup is kept')

    const exported = JSON.parse(
      await (await import('node:fs/promises')).readFile((await service.exportBundle({ format: 'json' })).path, 'utf8'),
    )
    assert.equal(exported.version, 4)
    assert.ok(Array.isArray(exported.revisions) && exported.revisions.some((revision) => revision.memory_id === saved.id))
  } finally {
    await service.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMISSION_SYSTEM, buildAdmissionUser, parseAdmission } from '../lib/admission.js'

const candidates = [
  { id: 'm_c1', text: '部署走代理 proxy.example.com:8080。', kind: 'knowledge', scope: 'workspace', importance: 3, details: { confidence: 0.8 }, workspace: '/w', sessionId: null, signature: null },
  { id: 'm_c2', text: '项目改用 NAS 部署。', kind: 'project', scope: 'workspace', importance: 3, details: null, workspace: '/w', sessionId: null, signature: null },
  { id: 'm_c3', text: '临时日志：端口 3000 被占用。', kind: 'other', scope: 'workspace', importance: 2, details: null, workspace: '/w', sessionId: null, signature: null },
]
const similarByCandidate = {
  m_c1: [],
  m_c2: [{ id: 'm_old', text: '项目使用 TypeScript 工具链。', kind: 'project', scope: 'workspace', importance: 3, signature: null, similarity: 0.81 }],
  m_c3: [],
}

test('the admission prompt is a dedicated JSON-only curator prompt', () => {
  assert.match(ADMISSION_SYSTEM, /memory admission judge/i)
  assert.match(ADMISSION_SYSTEM, /"decisions"/)
  assert.match(ADMISSION_SYSTEM, /add/)
  assert.match(ADMISSION_SYSTEM, /update/)
  assert.match(ADMISSION_SYSTEM, /skip/)
  assert.match(ADMISSION_SYSTEM, /Never invent ids/)
})

test('buildAdmissionUser includes candidates and their similar memories', () => {
  const user = buildAdmissionUser({ project: '/w', candidates, similarByCandidate })
  const parsed = JSON.parse(user)
  assert.equal(parsed.project, '/w')
  assert.equal(parsed.candidates.length, 3)
  assert.equal(parsed.existing_active_memories.length, 1)
  assert.ok(parsed.candidates[1].admission_targets.includes('m_old'))
})

test('parseAdmission validates ids, targets, confidence and degrades stale updates', () => {
  const raw = JSON.stringify({
    decisions: [
      { candidateId: 'm_c1', action: 'add', kind: 'knowledge', scope: 'global', importance: 4, confidence: 0.9, reason: 'durable' },
      { candidateId: 'm_c2', action: 'update', targetId: 'm_old', kind: 'project', scope: 'workspace', confidence: 0.85, reason: 'newer' },
      { candidateId: 'm_c3', action: 'skip', confidence: 0.9, reason: 'transient' },
      { candidateId: 'm_unknown', action: 'add', confidence: 0.9 },
      { candidateId: 'm_c3', action: 'add', confidence: 0.9 },
    ],
  })
  const { decisions, invalid } = parseAdmission(raw, { candidateIds: candidates.map((item) => item.id), similarByCandidate, minConfidence: 0.7 })
  assert.equal(decisions.length, 3)
  assert.equal(invalid, 2)
  assert.deepEqual(decisions[0], {
    candidateId: 'm_c1', action: 'add', kind: 'knowledge', scope: 'global', importance: 4, confidence: 0.9, targetId: null, reason: 'durable',
  })
  assert.equal(decisions[1].action, 'update')
  assert.equal(decisions[1].targetId, 'm_old')
  assert.equal(decisions[2].action, 'skip')

  const stale = parseAdmission(
    JSON.stringify({ decisions: [{ candidateId: 'm_c2', action: 'update', targetId: 'm_hallucinated', confidence: 0.9 }] }),
    { candidateIds: ['m_c2'], similarByCandidate, minConfidence: 0.7 },
  )
  assert.equal(stale.decisions[0].action, 'add', 'a target that was not supplied must not be overwritten')
  assert.equal(stale.decisions[0].targetId, null)

  const lowConfidence = parseAdmission(
    JSON.stringify({ decisions: [{ candidateId: 'm_c1', action: 'add', confidence: 0.4 }] }),
    { candidateIds: ['m_c1'], similarByCandidate, minConfidence: 0.7 },
  )
  assert.equal(lowConfidence.decisions.length, 1, 'low-confidence items are rejected automatically')
  assert.equal(lowConfidence.decisions[0].action, 'skip')
})

test('parseAdmission tolerates malformed or fenced output', () => {
  assert.deepEqual(parseAdmission('not json', { candidateIds: [], similarByCandidate: {} }).decisions, [])
  const fenced = parseAdmission('```json\n{"decisions":[{"candidateId":"m_c1","action":"skip","confidence":0.9}]}\n```', {
    candidateIds: ['m_c1'],
    similarByCandidate: {},
  })
  assert.equal(fenced.decisions.length, 1)
  assert.equal(fenced.decisions[0].action, 'skip')
})

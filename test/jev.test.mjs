import test from 'node:test'
import assert from 'node:assert/strict'
import { JevAssessor } from '../lib/jev.js'

test('Jev assessor sends typed noul questions and parses probabilities', async () => {
  let request
  const assessor = new JevAssessor(
    { enabled: true, baseURL: 'http://127.0.0.1:7000/v1', model: 'jev-latest', apiKey: 'secret', topK: 2, timeoutMs: 1000 },
    {
      fetchImpl: async (url, init) => {
        request = { url, init }
        return new Response(JSON.stringify({
          model: 'Kev-4B-GGUF',
          answers: {
            m0: { type: 'noul', noul: 0.91 },
            m1: { type: 'noul', noul: 0.12 },
          },
          usage: { input_tokens: 10 },
        }), { status: 200 })
      },
    },
  )
  const result = await assessor.assess({
    query: '部署走哪个代理？',
    records: [{ id: 'm1', text: '部署走 NAS 代理。' }, { id: 'm2', text: '用户喜欢 TypeScript。' }],
  })
  assert.equal(request.url, 'http://127.0.0.1:7000/v1/systemone')
  assert.equal(request.init.headers.authorization, 'Bearer secret')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'jev-latest')
  assert.equal(body.questions.m0.type, 'noul')
  assert.equal(result.model, 'Kev-4B-GGUF')
  assert.equal(result.results[0].id, 'm1')
  assert.equal(result.results[0].label, 'relevant')
  assert.equal(result.results[1].label, 'irrelevant')
})

test('Jev assessor is disabled without endpoint or enabled flag', async () => {
  const assessor = new JevAssessor({ enabled: false, baseURL: '', model: 'jev-latest' }, { fetchImpl: () => assert.fail('must not fetch') })
  const result = await assessor.assess({ query: 'x', records: [{ id: 'm1', text: 'x' }] })
  assert.deepEqual(result.results, [])
})

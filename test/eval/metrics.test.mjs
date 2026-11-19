import test from 'node:test'
import assert from 'node:assert/strict'
import { isAbstention, normalizeAnswer, parseJudge, sampleQuestions, sessionUnits, tokenF1 } from './longmemeval-common.mjs'

const questions = [
  { question_id: 'a', question_type: 'single-session-user', answer_session_ids: ['s1'], haystack_sessions: [[{ role: 'user', content: 'hello' }]], haystack_session_ids: ['s1'] },
  { question_id: 'b', question_type: 'multi-session', answer_session_ids: ['s2'], haystack_sessions: [[{ role: 'user', content: 'world' }]], haystack_session_ids: ['s2'] },
  { question_id: 'c', question_type: 'temporal-reasoning', answer_session_ids: ['s3'], haystack_sessions: [[{ role: 'user', content: 'time' }]], haystack_session_ids: ['s3'] },
  { question_id: 'd_abs', question_type: 'temporal-reasoning', answer_session_ids: ['s4'], haystack_sessions: [[{ role: 'user', content: 'unknown' }]], haystack_session_ids: ['s4'] },
]

test('sampleQuestions is deterministic and stratified', () => {
  const first = sampleQuestions(questions, { limit: 2, seed: 7 })
  const second = sampleQuestions(questions, { limit: 2, seed: 7 })
  assert.deepEqual(first.map((item) => item.question_id), second.map((item) => item.question_id))
  assert.equal(first.length, 2)
  const withAbstention = sampleQuestions(questions, { limit: 2, abstentionLimit: 1, includeAbstention: true, seed: 7 })
  assert.equal(withAbstention.length, 3)
  assert.equal(withAbstention.filter(isAbstention).length, 1)
})

test('sessionUnits supports session and turn granularity', () => {
  const question = {
    haystack_session_ids: ['s1'],
    haystack_sessions: [[{ role: 'user', content: 'hello', has_answer: true }, { role: 'assistant', content: 'hi' }]],
  }
  assert.equal(sessionUnits(question, { granularity: 'turn' }).length, 2)
  const session = sessionUnits(question, { granularity: 'session' })
  assert.equal(session.length, 1)
  assert.equal(session[0].hasAnswer, true)
})

test('answer normalization and token F1', () => {
  assert.equal(normalizeAnswer('Four weeks.'), 'four weeks')
  assert.equal(tokenF1('four weeks', 'Four weeks'), 1)
  assert.equal(tokenF1('4 weeks', '4 weeks'), 1)
  assert.equal(tokenF1('', 'four weeks'), 0)
})

test('judge parsing accepts JSON and rejects garbage', () => {
  assert.deepEqual(parseJudge('```json\n{"correct": true, "reason": "ok"}\n```'), { correct: true, reason: 'ok' })
  assert.deepEqual(parseJudge('{"correct": false}'), { correct: false, reason: '' })
  assert.equal(parseJudge('not json'), null)
  assert.equal(parseJudge('{"correct":"yes"}'), null)
})

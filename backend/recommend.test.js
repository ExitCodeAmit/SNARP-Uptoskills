import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProfile, recommendPapers, relatedTopics, similarPapers, suggestTopics, tokenize, topInterests } from './recommend.js'

const NOW = Date.parse('2026-11-04T00:00:00Z')
const paper = (id, fields) => ({
  id: String(id), user_id: 9, title: '', abstract: '', domain: 'Physics', tags: [], authors: [],
  like_count: 0, save_count: 0, published_at: '2026-10-01T00:00:00Z', ...fields,
})

const papers = [
  paper(1, { title: 'Transformer models for protein folding', domain: 'Biology', tags: ['deep learning', 'protein folding'] }),
  paper(2, { title: 'Graph neural networks in chemistry', domain: 'Chemistry', tags: ['deep learning', 'graph neural networks'] }),
  paper(3, { title: 'Medieval trade routes', domain: 'History', tags: ['trade', 'europe'] }),
  paper(4, { title: 'Reinforcement learning for robot arms', domain: 'Artificial Intelligence', tags: ['reinforcement learning', 'robotics'], user_id: 7, submitter_name: 'Asha' }),
  paper(5, { title: 'Light sensors with Arduino', domain: 'Engineering', tags: ['arduino', 'sensor'], like_count: 10, save_count: 4 }),
]

test('tokenize drops stopwords, short words and numbers', () => {
  assert.deepEqual(tokenize('A study of the 2024 Deep-Learning methods for X-ray'), ['deep', 'learning', 'ray'])
})

test('papers matching interests rank first and explain why', () => {
  const profile = buildProfile({ interests: ['Deep Learning'] })
  const items = recommendPapers(profile, papers, { limit: 3, now: NOW })
  assert.deepEqual(items.slice(0, 2).map((item) => item.id).sort(), ['1', '2'])
  assert.match(items[0].reasons[0], /Matches Deep Learning, from your research interests/)
})

test('plural interests match singular words and the reason names the interest', () => {
  assert.deepEqual(tokenize('Sensors and studies of glass'), ['sensor', 'study', 'glass'])
  const profile = buildProfile({ interests: ['Light sensors'] })
  const items = recommendPapers(profile, papers, { limit: 3, now: NOW })
  assert.equal(items[0].id, '5')
  assert.equal(items[0].reasons[0], 'Mentions Light sensors, from your research interests')
  assert.equal(items.length, 3)
  assert.match(items[1].reasons[0], /Popular|Recently/)
})

test('duplicate uploads with the same title are shown once', () => {
  const copies = [...papers, { ...papers[4], id: '6' }, { ...papers[4], id: '7', title: 'LIGHT sensors with  Arduino' }]
  const items = recommendPapers(buildProfile(), copies, { limit: 10, now: NOW })
  assert.equal(items.filter((item) => /light sensors/i.test(item.title)).length, 1)
  assert.ok(!similarPapers(papers[4], copies).some((item) => /light sensors/i.test(item.title)))
})

test('papers by followed researchers get a boost and a reason', () => {
  const profile = buildProfile({ followedIds: [7] })
  const [first] = recommendPapers(profile, papers, { limit: 1, now: NOW })
  assert.equal(first.id, '4')
  assert.ok(first.reasons.includes('By Asha you follow'))
})

test('saved and own papers shape the profile and are excluded', () => {
  const profile = buildProfile({ engaged: [{ paper: papers[0], kind: 'saved' }] })
  assert.deepEqual(topInterests(profile, 2), ['Biology', 'deep learning'])
  const items = recommendPapers(profile, papers, { exclude: ['1'], now: NOW })
  assert.ok(!items.some((item) => item.id === '1'))
  assert.equal(items[0].id, '2')
  assert.match(items[0].reasons[0], /papers you saved/)
})

test('without any signals it falls back to popular papers', () => {
  const items = recommendPapers(buildProfile(), papers, { limit: 2, now: NOW })
  assert.equal(items[0].id, '5')
  assert.equal(items[0].reasons[0], 'Popular with other researchers')
})

test('related topics are new topics that sit next to the user interests', () => {
  const topics = relatedTopics(buildProfile({ interests: ['deep learning'] }), papers)
  const names = topics.map((item) => item.topic)
  assert.ok(names.includes('protein folding') && names.includes('graph neural networks'))
  assert.ok(!names.includes('deep learning') && !names.includes('trade'))
  assert.equal(topics.find((item) => item.topic === 'protein folding').because, 'deep learning')
})

test('similar papers share tags or wording and never include the paper itself', () => {
  const related = similarPapers(papers[0], papers)
  assert.equal(related[0].id, '2')
  assert.equal(related[0].reason, 'Also about deep learning')
  assert.ok(!related.some((item) => item.id === '1' || item.id === '3'))
})

test('topic suggestions match the typed text, prefix matches first', () => {
  const found = suggestTopics('lear', papers)
  assert.deepEqual(found.map((item) => item.topic), ['deep learning', 'reinforcement learning'])
  assert.deepEqual(suggestTopics('a', papers), [])
  assert.equal(suggestTopics('engin', papers)[0].kind, 'domain')
})

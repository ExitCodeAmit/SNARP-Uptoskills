import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankRecommendations, scorePaperForInterests } from './recommendations.js'

const interests = ['Artificial Intelligence', 'Machine Learning', 'Data Science']

test('scores exact tags, domain, title, and abstract matches with the specified weights', () => {
  assert.equal(scorePaperForInterests({ tags: ['Artificial Intelligence'] }, interests), 3)
  assert.equal(scorePaperForInterests({ domain: 'Machine Learning' }, interests), 4)
  assert.equal(scorePaperForInterests({ title: 'Data Science methods' }, interests), 2)
  assert.equal(scorePaperForInterests({ abstract: 'Artificial Intelligence research' }, interests), 1)
})

test('sums matching signals and ranks by score, then publication date', () => {
  const papers = [
    { id: 1, user_id: 2, status: 'approved', title: 'Artificial Intelligence', tags: ['Artificial Intelligence'], created_at: '2025-01-01' },
    { id: 2, user_id: 2, status: 'approved', domain: 'Artificial Intelligence', created_at: '2025-01-01' },
    { id: 3, user_id: 2, status: 'approved', title: 'Artificial Intelligence', created_at: '2026-01-01' },
    { id: 4, user_id: 2, status: 'approved', title: 'No matching topic', created_at: '2027-01-01' },
  ]

  const ranked = rankRecommendations(papers, ['Artificial Intelligence'], 1)
  assert.deepEqual(ranked.map(({ id, score }) => [id, score]), [[1, 5], [2, 4], [3, 2]])

  const dateTie = rankRecommendations([
    { id: 5, user_id: 2, status: 'approved', title: 'Data Science', publication_date: '2025-01-01', created_at: '2024-01-01' },
    { id: 6, user_id: 2, status: 'approved', title: 'Data Science', publication_date: '2026-01-01', created_at: '2024-01-01' },
  ], ['Data Science'], 1)
  assert.deepEqual(dateTie.map(({ id }) => id), [6, 5])
})

test('returns each matched interest with the scoring factors that explain its score', () => {
  const [paper] = rankRecommendations([{
    id: 7,
    user_id: 2,
    status: 'approved',
    title: 'Artificial Intelligence for care',
    abstract: 'An artificial intelligence study.',
    domain: 'Artificial Intelligence',
    tags: ['Artificial Intelligence'],
    created_at: '2025-01-01',
  }], ['Artificial Intelligence'], 1)

  assert.equal(paper.score, 10)
  assert.deepEqual(paper.matched_interests, [{
    interest: 'Artificial Intelligence',
    signals: [
      { field: 'tag', points: 3 },
      { field: 'domain', points: 4 },
      { field: 'title', points: 2 },
      { field: 'abstract', points: 1 },
    ],
  }])
})

test('matches are case-insensitive, tag matches are exact, and duplicate interests count once', () => {
  const paper = { tags: ['artificial intelligence extra'], domain: 'AI Research' }
  assert.equal(scorePaperForInterests(paper, [' artificial intelligence ', 'ARTIFICIAL INTELLIGENCE']), 0)
  assert.equal(scorePaperForInterests(paper, ['ai']), 4)
})

test('empty interests and papers with no matching content produce no recommendations', () => {
  const paper = { id: 1, user_id: 2, status: 'approved', title: 'Data science' }
  assert.deepEqual(rankRecommendations([paper], [], 1), [])
  assert.deepEqual(rankRecommendations([{ ...paper, title: 'Unrelated' }], interests, 1), [])
})

test('limits recommendations to the requested count', () => {
  const papers = Array.from({ length: 12 }, (_, id) => ({ id, user_id: 2, status: 'approved', title: 'Data science' }))
  assert.equal(rankRecommendations(papers, ['Data science'], 1, 10).length, 10)
})

test('returns a paper only once even if the candidate list contains duplicate rows', () => {
  const paper = { id: 1, user_id: 2, status: 'approved', title: 'Data science' }
  assert.deepEqual(rankRecommendations([paper, { ...paper }], ['Data science'], 1).map(({ id }) => id), [1])
})

test('uses publication date before creation date and gives stable order when dates tie', () => {
  const ranked = rankRecommendations([
    { id: 12, user_id: 2, status: 'approved', title: 'Data Science', publication_date: '2024-01-01', created_at: '2026-01-01' },
    { id: 3, user_id: 2, status: 'approved', title: 'Data Science', publication_date: '2024-01-01', created_at: '2026-01-01' },
    { id: 8, user_id: 2, status: 'approved', title: 'Data Science', publication_date: '2025-01-01', created_at: '2024-01-01' },
  ], ['Data Science'], 1)

  assert.deepEqual(ranked.map(({ id }) => id), [8, 3, 12])
})

test('excludes unapproved papers and papers submitted by the logged-in user', () => {
  const papers = [
    { id: 1, user_id: 1, status: 'approved', title: 'Data science' },
    { id: 2, user_id: 2, status: 'pending', title: 'Data science' },
    { id: 3, user_id: 2, status: 'rejected', title: 'Data science' },
    { id: 4, user_id: 2, status: 'approved', title: 'Data science' },
  ]
  assert.deepEqual(rankRecommendations(papers, ['Data science'], 1).map(({ id }) => id), [4])
})

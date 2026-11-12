import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPaperDiscovery } from './paper-search.js'

test('builds approved-only paper discovery filters with bound values', () => {
  const query = buildPaperDiscovery({ q: 'AI_%', author: 'Asha', domain: 'Education', tag: 'NLP' })
  assert.match(query.searchSql, /p\.status = 'approved'/)
  assert.match(query.searchSql, /p\.authors::text ILIKE \$2/)
  assert.match(query.searchSql, /lower\(p\.domain\) = lower\(\$3\)/)
  assert.match(query.searchSql, /unnest\(p\.tags\)/)
  assert.equal(query.values[0], '%AI\\_\\%%')
  assert.deepEqual(query.values.slice(1, 4), ['%Asha%', 'Education', '%NLP%'])
  assert.equal(query.values.at(-2), 20)
  assert.equal(query.values.at(-1), 0)
  assert.deepEqual(query.countValues, query.values.slice(0, 4))
})

test('bounds pagination and ignores unrecognized sort expressions', () => {
  const query = buildPaperDiscovery({ page: '500001', limit: '1000', sort: 'newest; DROP TABLE papers' })
  assert.equal(query.page, 100000)
  assert.equal(query.limit, 50)
  assert.equal(query.values[0], 50)
  assert.equal(query.values[1], 4_999_950)
  assert.match(query.searchSql, /ORDER BY COALESCE\(p\.reviewed_at, p\.created_at\) DESC, p\.id DESC/)
  assert.doesNotMatch(query.searchSql, /DROP TABLE/)
})

test('supports oldest and title sorting without changing filter parameters', () => {
  const query = buildPaperDiscovery({ q: 'climate', sort: 'title_asc', page: 2, limit: 10 })
  assert.match(query.searchSql, /ORDER BY lower\(p\.title\) ASC, p\.id ASC/)
  assert.deepEqual(query.values, ['%climate%', 10, 10])
})

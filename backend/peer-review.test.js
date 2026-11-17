import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anonymise, average, validateResubmission, validateReview } from './peer-review.js'

const good = {
  overall_rating: 4,
  scores: { originality: 4, methodology: 3, clarity: 5, significance: 4 },
  recommendation: 'minor_revision',
  comments: 'A clear study with a sound design; the evaluation needs one more baseline.',
  suggestions: [{ section: 'Section 4', body: 'Compare against a distilled BERT baseline.' }, { section: '', body: '' }],
}

test('validateReview accepts a complete review and drops empty suggestion rows', () => {
  const review = validateReview(good)
  assert.equal(review.overallRating, 4)
  assert.equal(review.scores.clarity, 5)
  assert.equal(review.suggestions.length, 1)
  assert.equal(review.confidential, '')
})

test('validateReview rejects missing or out-of-range values', () => {
  assert.throws(() => validateReview({ ...good, overall_rating: 6 }), { field: 'overall_rating' })
  assert.throws(() => validateReview({ ...good, scores: { ...good.scores, clarity: 0 } }), { field: 'clarity' })
  assert.throws(() => validateReview({ ...good, recommendation: 'maybe' }), { field: 'recommendation' })
  assert.throws(() => validateReview({ ...good, comments: 'too short' }), { field: 'comments' })
  assert.throws(() => validateReview({ ...good, suggestions: [] }), { field: 'suggestions' })
  assert.throws(() => validateReview({ ...good, suggestions: [{ section: 'Page 2', body: '' }] }), { field: 'suggestions' })
  assert.doesNotThrow(() => validateReview({ ...good, recommendation: 'accept', suggestions: [] }))
})

test('validateResubmission requires a response to every open suggestion', () => {
  const fields = {
    response_letter: 'We added the requested baseline and rewrote section 4.',
    suggestion_responses: JSON.stringify([{ id: 7, status: 'addressed', response: 'Added in Table 3' }, { id: 99, status: 'addressed' }]),
  }
  assert.throws(() => validateResubmission(fields, ['7', '8']), /1 left/)
  const ok = validateResubmission(fields, ['7'])
  assert.deepEqual(ok.responses, [{ id: '7', status: 'addressed', response: 'Added in Table 3' }])
  assert.throws(() => validateResubmission({ ...fields, suggestion_responses: JSON.stringify([{ id: 7, status: 'declined', response: '' }]) }, ['7']), /why you declined/)
  assert.throws(() => validateResubmission({ response_letter: 'short' }, []), { field: 'response_letter' })
})

test('anonymise numbers reviewers by first review and hides identities', () => {
  const reviews = [
    { id: 3, reviewer_id: 20, reviewer_name: 'B', created_at: '2026-02-01', confidential_comments: 'x' },
    { id: 1, reviewer_id: 10, reviewer_name: 'A', created_at: '2026-01-01' },
    { id: 5, reviewer_id: 10, reviewer_name: 'A', created_at: '2026-03-01' },
  ]
  const out = anonymise(reviews)
  assert.deepEqual(out.map((r) => r.reviewer_label), ['Reviewer 2', 'Reviewer 1', 'Reviewer 1'])
  assert.ok(out.every((r) => !('reviewer_id' in r) && !('reviewer_name' in r) && !('confidential_comments' in r)))
  assert.equal(average([4, 5, 3]), 4)
  assert.equal(average([]), null)
})

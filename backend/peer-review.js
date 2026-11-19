export const CRITERIA = ['originality', 'methodology', 'clarity', 'significance']
export const RECOMMENDATIONS = ['accept', 'minor_revision', 'major_revision', 'reject']
export const MAX_SUGGESTIONS = 30

const fail = (message, field) => { throw Object.assign(new Error(message), { field }) }
const text = (value) => (typeof value === 'string' ? value.trim() : '')

function score(value, field, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 5) fail(`Give ${label} a score from 1 to 5`, field)
  return n
}

export function validateReview(body = {}) {
  const overallRating = score(body.overall_rating, 'overall_rating', 'the paper an overall rating')
  const scores = {}
  for (const criterion of CRITERIA) scores[criterion] = score(body.scores?.[criterion], criterion, criterion)

  const recommendation = text(body.recommendation)
  if (!RECOMMENDATIONS.includes(recommendation)) fail('Choose a recommendation', 'recommendation')

  const comments = text(body.comments)
  if (comments.length < 20) fail('Write at least 20 characters of comments for the author', 'comments')
  if (comments.length > 10000) fail('Comments must be 10,000 characters or fewer', 'comments')

  const confidential = text(body.confidential_comments)
  if (confidential.length > 5000) fail('Notes for moderators must be 5,000 characters or fewer', 'confidential_comments')

  if (body.suggestions !== undefined && !Array.isArray(body.suggestions)) fail('Suggestions must be a list', 'suggestions')
  const suggestions = (body.suggestions ?? [])
    .map((item) => ({ section: text(item?.section), body: text(item?.body) }))
    .filter((item) => item.body || item.section)
  if (suggestions.length > MAX_SUGGESTIONS) fail(`Add at most ${MAX_SUGGESTIONS} suggestions`, 'suggestions')
  for (const item of suggestions) {
    if (!item.body) fail('Each suggestion needs a description', 'suggestions')
    if (item.body.length > 2000) fail('Each suggestion must be 2,000 characters or fewer', 'suggestions')
    if (item.section.length > 120) fail('Section or page references must be 120 characters or fewer', 'suggestions')
  }
  if (['minor_revision', 'major_revision'].includes(recommendation) && !suggestions.length) {
    fail('Add at least one suggestion when recommending a revision', 'suggestions')
  }

  return { overallRating, scores, recommendation, comments, confidential, suggestions }
}

export function validateResubmission(fields = {}, openSuggestionIds = []) {
  const responseLetter = text(fields.response_letter)
  if (responseLetter.length < 20) fail('Explain what you changed in at least 20 characters', 'response_letter')
  if (responseLetter.length > 10000) fail('The response to reviewers must be 10,000 characters or fewer', 'response_letter')

  let answers
  try {
    answers = JSON.parse(fields.suggestion_responses ?? '[]')
    if (!Array.isArray(answers)) throw new Error()
  } catch {
    fail('Suggestion responses must be a valid list', 'suggestion_responses')
  }
  const byId = new Map()
  for (const answer of answers) {
    const id = String(answer?.id ?? '')
    const status = text(answer?.status)
    const response = text(answer?.response)
    if (!openSuggestionIds.includes(id)) continue
    if (!['addressed', 'declined'].includes(status)) fail('Mark each suggestion as addressed or declined', 'suggestion_responses')
    if (response.length > 2000) fail('Each response must be 2,000 characters or fewer', 'suggestion_responses')
    if (status === 'declined' && response.length < 5) fail('Explain briefly why you declined a suggestion', 'suggestion_responses')
    byId.set(id, { id, status, response })
  }
  const missing = openSuggestionIds.filter((id) => !byId.has(id))
  if (missing.length) fail(`Respond to every reviewer suggestion (${missing.length} left)`, 'suggestion_responses')
  return { responseLetter, responses: [...byId.values()] }
}

export const average = (values) => {
  const list = values.filter((v) => Number.isFinite(v))
  return list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null
}

export function anonymise(reviews) {
  const order = []
  for (const review of [...reviews].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)) {
    const key = review.reviewer_id ?? `deleted-${review.id}`
    if (!order.includes(key)) order.push(key)
  }
  return reviews.map(({ reviewer_id: reviewerId, reviewer_name: _name, confidential_comments: _note, ...review }) => ({
    ...review,
    reviewer_label: `Reviewer ${order.indexOf(reviewerId ?? `deleted-${review.id}`) + 1}`,
  }))
}

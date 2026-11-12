export function validateCommunity(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  if (!name || name.length > 100) throw Object.assign(new Error('Community name must be 1-100 characters'), { field: 'name' })
  if (!category || category.length > 120) throw Object.assign(new Error('Category must be 1-120 characters'), { field: 'category' })
  if (description.length > 2000) throw Object.assign(new Error('Description must be at most 2,000 characters'), { field: 'description' })
  return { name, description, category }
}

export function validateCommunityPost(input = {}) {
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body || body.length > 5000) throw Object.assign(new Error('Discussion post must be 1-5,000 characters'), { field: 'body' })
  return body
}

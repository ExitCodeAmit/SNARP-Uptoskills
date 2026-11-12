export function validateEvent(input = {}, { now = Date.now() } = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const kind = typeof input.kind === 'string' ? input.kind.trim() : ''
  const location = typeof input.location === 'string' ? input.location.trim() : ''
  const startsAt = typeof input.startsAt === 'string' ? new Date(input.startsAt) : new Date(NaN)
  const endsAt = typeof input.endsAt === 'string' ? new Date(input.endsAt) : new Date(NaN)
  const capacityInput = input.capacity
  const capacity = capacityInput === '' || capacityInput === null || capacityInput === undefined
    ? null
    : Number(capacityInput)

  if (!title || title.length > 200) throw Object.assign(new Error('Event title must be 1-200 characters'), { field: 'title' })
  if (!description || description.length > 3000) throw Object.assign(new Error('Description must be 1-3,000 characters'), { field: 'description' })
  if (!kind || kind.length > 80) throw Object.assign(new Error('Event type must be 1-80 characters'), { field: 'kind' })
  if (!location || location.length > 200) throw Object.assign(new Error('Location must be 1-200 characters'), { field: 'location' })
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= now) throw Object.assign(new Error('Event start must be a valid future date'), { field: 'startsAt' })
  if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) throw Object.assign(new Error('Event end must be after its start'), { field: 'endsAt' })
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) {
    throw Object.assign(new Error('Capacity must be between 1 and 100,000'), { field: 'capacity' })
  }
  return { title, description, kind, location, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), capacity }
}

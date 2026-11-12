import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEvent } from './event.js'

const now = Date.parse('2026-01-01T00:00:00.000Z')
const valid = {
  title: 'Research Methods Workshop', description: 'A practical workshop for early career researchers.',
  kind: 'Workshop', location: 'Online', startsAt: '2026-02-01T09:00:00Z', endsAt: '2026-02-01T10:30:00Z', capacity: '80',
}

test('normalizes event fields and optional capacity', () => {
  assert.deepEqual(validateEvent({ ...valid, title: ' Research Methods Workshop ' }, { now }), {
    title: 'Research Methods Workshop', description: valid.description, kind: 'Workshop', location: 'Online',
    startsAt: '2026-02-01T09:00:00.000Z', endsAt: '2026-02-01T10:30:00.000Z', capacity: 80,
  })
  assert.equal(validateEvent({ ...valid, capacity: '' }, { now }).capacity, null)
})

test('rejects invalid fields, dates, end times, and capacity', () => {
  assert.throws(() => validateEvent({ ...valid, title: '' }, { now }), { field: 'title' })
  assert.throws(() => validateEvent({ ...valid, startsAt: '2025-12-31T23:00:00Z' }, { now }), { field: 'startsAt' })
  assert.throws(() => validateEvent({ ...valid, endsAt: valid.startsAt }, { now }), { field: 'endsAt' })
  assert.throws(() => validateEvent({ ...valid, capacity: '2.5' }, { now }), { field: 'capacity' })
  assert.throws(() => validateEvent({ ...valid, capacity: '100001' }, { now }), { field: 'capacity' })
})

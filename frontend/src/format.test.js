import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDisplayName, formatUserName, initials, colorFor } from './format.js'

test('formatDisplayName uses full_name when provided', () => {
  assert.equal(formatDisplayName({ full_name: 'Dr. Jane Smith', email: 'jane@univ.edu' }), 'Dr. Jane Smith')
  assert.equal(formatDisplayName({ full_name: 'Rajesh Patel', username: 'raj2' }), 'Rajesh Patel')
})

test('formatDisplayName falls back to username when full_name is unavailable', () => {
  assert.equal(formatDisplayName({ username: 'raj2', email: 'raj2@gmail.com' }), 'raj2')
  assert.equal(formatDisplayName({ full_name: '', username: 'alex_dev' }), 'alex_dev')
})

test('formatDisplayName never exposes email as public display name', () => {
  assert.equal(formatDisplayName('raj2@gmail.com'), 'raj2')
  assert.equal(formatDisplayName({ name: 'raj2@gmail.com', email: 'raj2@gmail.com' }), 'raj2')
  assert.equal(formatDisplayName({ author_name: 'member@university.edu' }), 'member')
  assert.equal(formatDisplayName({ email: 'john.doe@example.com' }), 'john.doe')
  assert.equal(formatDisplayName('test.user@company.org'), 'test.user')
})

test('formatDisplayName handles regular names cleanly', () => {
  assert.equal(formatDisplayName('Alice Cooper'), 'Alice Cooper')
  assert.equal(formatDisplayName({ name: 'Bob Ross' }), 'Bob Ross')
  assert.equal(formatDisplayName({ author_name: 'Charlie Brown' }), 'Charlie Brown')
})

test('formatDisplayName handles null, undefined, or empty values safely', () => {
  assert.equal(formatDisplayName(null), 'Anonymous')
  assert.equal(formatDisplayName(undefined), 'Anonymous')
  assert.equal(formatDisplayName(''), 'Anonymous')
  assert.equal(formatDisplayName({}), 'Anonymous')
})

test('formatUserName extracts clean handle without @ domain', () => {
  assert.equal(formatUserName('raj2@gmail.com'), 'raj2')
  assert.equal(formatUserName({ email: 'raj2@gmail.com' }), 'raj2')
  assert.equal(formatUserName({ username: 'raj_2' }), 'raj_2')
  assert.equal(formatUserName({ name: 'raj2@gmail.com' }), 'raj2')
  assert.equal(formatUserName(null), 'user')
})

test('initials generates letters from clean name/username without email symbols', () => {
  assert.equal(initials('raj2@gmail.com'), 'R')
  assert.equal(initials('Alice Cooper'), 'AC')
  assert.equal(initials({ name: 'raj2@gmail.com' }), 'R')
  assert.equal(initials({ full_name: 'Dr. Jane Smith' }), 'DJ')
})

test('colorFor produces stable valid brand color', () => {
  const c1 = colorFor('raj2@gmail.com')
  const c2 = colorFor('raj2@gmail.com')
  assert.equal(c1, c2)
  assert.ok(['orange', 'teal', 'blue', 'yellow'].includes(c1))
})

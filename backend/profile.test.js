import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProfileUpdate } from './profile.js'

test('trims, deduplicates, and normalizes profile fields', () => {
  assert.deepEqual(validateProfileUpdate({
    name: '  Asha Sen ',
    institution: ' University ',
    department: ' Research ',
    bio: ' Studies learning. ',
    research_interests: [' AI ', 'AI', '', 'Education'],
    skills: [' Data analysis '],
    links: [{ label: ' Website ', url: 'https://example.org' }],
  }), {
    name: 'Asha Sen',
    institution: 'University',
    department: 'Research',
    bio: 'Studies learning.',
    research_interests: ['AI', 'Education'],
    skills: ['Data analysis'],
    links: [{ label: 'Website', url: 'https://example.org/' }],
  })
})

test('rejects invalid profile lengths, list values, and unsafe links', () => {
  assert.throws(() => validateProfileUpdate({ name: '', links: [] }), /Name is required/)
  assert.throws(() => validateProfileUpdate({ name: 'A', research_interests: 'AI' }), /must be a list/)
  assert.throws(() => validateProfileUpdate({ name: 'A', bio: 'x'.repeat(2001) }), /2,000 characters/)
  assert.throws(() => validateProfileUpdate({ name: 'A', links: [{ label: 'Site', url: 'javascript:alert(1)' }] }), /HTTPS/)
})

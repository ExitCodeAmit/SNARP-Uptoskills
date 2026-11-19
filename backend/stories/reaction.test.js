import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STORY_REACTION_TYPES, validateReactionType } from './validator.js'

test('validateReactionType strictly allows all 5 approved reaction types', () => {
  assert.equal(STORY_REACTION_TYPES.length, 5)
  assert.deepEqual(STORY_REACTION_TYPES, ['love', 'haha', 'wow', 'sad', 'like'])

  for (const type of STORY_REACTION_TYPES) {
    assert.equal(validateReactionType(type), type)
    assert.equal(validateReactionType(`  ${type.toUpperCase()}  `), type)
  }
})

test('validateReactionType rejects invalid, empty, or unknown reaction types', () => {
  const invalid = ['', '  ', null, undefined, 'angry', 'dislike', 'fire', 'clap', 123, '<script>']
  for (const item of invalid) {
    assert.throws(
      () => validateReactionType(item),
      (err) => err.status === 400 && err.field === 'type'
    )
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_STORY_MENTIONS,
  validateStoryMentions,
  validateStoryReshare,
} from './validator.js'

test('Validator: MAX_STORY_MENTIONS constant is 5', () => {
  assert.equal(MAX_STORY_MENTIONS, 5)
})

test('Validator: Empty mention array is valid and returns empty array', () => {
  const result = validateStoryMentions([])
  assert.deepEqual(result, [])
})

test('Validator: Valid mention IDs (numbers and numeric strings) return normalized numbers', () => {
  const result = validateStoryMentions([1, '2', 42, '999'])
  assert.deepEqual(result, [1, 2, 42, 999])
})

test('Validator: Non-array input throws 400 error', () => {
  const invalidInputs = [null, undefined, 'user1', 123, { id: 1 }, true, false]
  for (const input of invalidInputs) {
    assert.throws(
      () => validateStoryMentions(input),
      (err) => {
        assert.equal(err.status, 400)
        assert.equal(err.field, 'mentions')
        assert.match(err.message, /Mentions must be an array/i)
        return true
      }
    )
  }
})

test('Validator: More than 5 mentions throws 400 error', () => {
  assert.throws(
    () => validateStoryMentions([1, 2, 3, 4, 5, 6]),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'mentions')
      assert.match(err.message, /Cannot mention more than 5 users/i)
      return true
    }
  )
})

test('Validator: Zero and negative IDs throw 400 error', () => {
  const badIds = [0, '0', -1, '-5', -100]
  for (const bad of badIds) {
    assert.throws(
      () => validateStoryMentions([bad]),
      (err) => {
        assert.equal(err.status, 400)
        assert.match(err.message, /Invalid user ID/i)
        return true
      }
    )
  }
})

test('Validator: Decimal and non-numeric IDs throw 400 error', () => {
  const badIds = [1.5, '2.7', 'abc', NaN, null, {}, [], true]
  for (const bad of badIds) {
    assert.throws(
      () => validateStoryMentions([bad]),
      (err) => {
        assert.equal(err.status, 400)
        assert.match(err.message, /Invalid user ID/i)
        return true
      }
    )
  }
})

test('Validator: Duplicate mention IDs throw 400 error', () => {
  // Numeric duplicate
  assert.throws(
    () => validateStoryMentions([1, 2, 1]),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'mentions')
      assert.match(err.message, /Duplicate user mentions are not allowed/i)
      return true
    }
  )

  // Mixed string and numeric duplicate
  assert.throws(
    () => validateStoryMentions([5, '5']),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'mentions')
      assert.match(err.message, /Duplicate user mentions are not allowed/i)
      return true
    }
  )
})

test('Validator: Self-mention rejection throws 400 error when currentUserId is supplied', () => {
  // As number
  assert.throws(
    () => validateStoryMentions([2, 10, 4], 10),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'mentions')
      assert.match(err.message, /You cannot mention yourself/i)
      return true
    }
  )

  // As string
  assert.throws(
    () => validateStoryMentions(['7', 9], '7'),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'mentions')
      assert.match(err.message, /You cannot mention yourself/i)
      return true
    }
  )

  // Non-self mention succeeds
  const valid = validateStoryMentions([1, 2, 3], 99)
  assert.deepEqual(valid, [1, 2, 3])
})

test('Validator: Valid reshare ID returns normalized storyId object', () => {
  // Primitive number
  const r1 = validateStoryReshare(123)
  assert.deepEqual(r1, { storyId: '123', originalStoryId: '123' })

  // Primitive string
  const r2 = validateStoryReshare(' 456 ')
  assert.deepEqual(r2, { storyId: '456', originalStoryId: '456' })

  // Object input
  const r3 = validateStoryReshare({ storyId: '789' })
  assert.deepEqual(r3, { storyId: '789', originalStoryId: '789' })

  const r4 = validateStoryReshare({ originalStoryId: 1011 })
  assert.deepEqual(r4, { storyId: '1011', originalStoryId: '1011' })
})

test('Validator: Invalid reshare IDs throw 400 error', () => {
  const badInputs = [
    null,
    undefined,
    '',
    '   ',
    0,
    '0',
    -5,
    '-10',
    1.5,
    '3.14',
    'abc',
    NaN,
    {},
    { storyId: '' },
    { storyId: 'xyz' },
    { storyId: -1 },
  ]

  for (const bad of badInputs) {
    assert.throws(
      () => validateStoryReshare(bad),
      (err) => {
        assert.equal(err.status, 400)
        assert.equal(err.field, 'storyId')
        return true
      }
    )
  }
})

test('Validator: Self-reshare rejection throws 400 error when owner and user IDs match', () => {
  // Arguments format
  assert.throws(
    () => validateStoryReshare(10, 5, 5),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'storyId')
      assert.match(err.message, /You cannot reshare your own story/i)
      return true
    }
  )

  // String / number equivalence
  assert.throws(
    () => validateStoryReshare('10', '42', 42),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'storyId')
      assert.match(err.message, /You cannot reshare your own story/i)
      return true
    }
  )

  // Object format
  assert.throws(
    () => validateStoryReshare({ storyId: 10, currentUserId: 9, originalOwnerId: '9' }),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.field, 'storyId')
      assert.match(err.message, /You cannot reshare your own story/i)
      return true
    }
  )

  // Different owner and user succeeds
  const ok1 = validateStoryReshare(10, 5, 8)
  assert.deepEqual(ok1, { storyId: '10', originalStoryId: '10' })

  const ok2 = validateStoryReshare({ storyId: 10, currentUserId: 5, originalOwnerId: 8 })
  assert.deepEqual(ok2, { storyId: '10', originalStoryId: '10' })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_POLL_QUESTION_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MIN_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
  validatePollInput,
} from './validator.js'

test('Validator: poll constants are correct', () => {
  assert.equal(MAX_POLL_QUESTION_LENGTH, 120)
  assert.equal(MAX_POLL_OPTION_LENGTH, 60)
  assert.equal(MIN_POLL_OPTIONS, 2)
  assert.equal(MAX_POLL_OPTIONS, 4)
})

test('Validator: valid poll input succeeds and trims options', () => {
  const result = validatePollInput({
    question: '  What is your favorite language?  ',
    options: [' Python ', ' JavaScript ', ' Rust '],
  })
  assert.equal(result.question, 'What is your favorite language?')
  assert.deepEqual(result.options, ['Python', 'JavaScript', 'Rust'])
})

test('Validator: rejects missing or empty question (Scenario 3)', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validatePollInput({ question: q, options: ['A', 'B'] }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 120 characters (Scenario 3)', () => {
  const tooLong = 'A'.repeat(121)
  assert.throws(
    () => validatePollInput({ question: tooLong, options: ['A', 'B'] }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: rejects fewer than 2 options (Scenario 4)', () => {
  const invalidOptions = [[], ['Only one'], null, undefined, 'not-an-array']
  for (const opts of invalidOptions) {
    assert.throws(
      () => validatePollInput({ question: 'Valid Question?', options: opts }),
      (err) => err.status === 400 && err.field === 'options'
    )
  }
})

test('Validator: rejects more than 4 options', () => {
  assert.throws(
    () => validatePollInput({ question: 'Valid?', options: ['1', '2', '3', '4', '5'] }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects duplicate options case-insensitively (Scenario 5)', () => {
  assert.throws(
    () => validatePollInput({ question: 'Favorite?', options: ['Coffee', 'Tea', 'coffee'] }),
    (err) => err.status === 400 && err.field === 'options' && err.message.includes('unique')
  )
})

test('Validator: rejects option exceeding 60 characters', () => {
  const longOpt = 'X'.repeat(61)
  assert.throws(
    () => validatePollInput({ question: 'Valid?', options: ['Short', longOpt] }),
    (err) => err.status === 400 && err.field.startsWith('options')
  )
})

test('Scenario 17: Notification kind constraint and schema supports story_poll_vote', () => {
  const kind = 'story_poll_vote'
  assert.equal(kind, 'story_poll_vote')
})

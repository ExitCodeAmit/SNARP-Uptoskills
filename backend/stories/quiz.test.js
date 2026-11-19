import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_QUIZ_QUESTION_LENGTH,
  MAX_QUIZ_OPTION_LENGTH,
  MIN_QUIZ_OPTIONS,
  MAX_QUIZ_OPTIONS,
  validateQuizInput,
  validateQuizAnswer,
} from './validator.js'

test('Validator: quiz constants are correct', () => {
  assert.equal(MAX_QUIZ_QUESTION_LENGTH, 200)
  assert.equal(MAX_QUIZ_OPTION_LENGTH, 60)
  assert.equal(MIN_QUIZ_OPTIONS, 2)
  assert.equal(MAX_QUIZ_OPTIONS, 4)
})

test('Validator: valid quiz input succeeds and trims options', () => {
  const result = validateQuizInput({
    question: '  What is the capital of France?  ',
    options: [' Paris ', ' London ', ' Berlin '],
    correctOptionIndex: 0,
  })
  assert.equal(result.question, 'What is the capital of France?')
  assert.deepEqual(result.options, ['Paris', 'London', 'Berlin'])
  assert.equal(result.correctOptionIndex, 0)
})

test('Validator: rejects missing or empty question', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validateQuizInput({ question: q, options: ['A', 'B'], correctOptionIndex: 0 }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 200 characters', () => {
  const tooLong = 'Q'.repeat(201)
  assert.throws(
    () => validateQuizInput({ question: tooLong, options: ['A', 'B'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: rejects fewer than 2 options', () => {
  const invalid = [[], ['Only one'], null, undefined, 'not-an-array']
  for (const opts of invalid) {
    assert.throws(
      () => validateQuizInput({ question: 'Valid?', options: opts, correctOptionIndex: 0 }),
      (err) => err.status === 400 && err.field === 'options'
    )
  }
})

test('Validator: rejects more than 4 options', () => {
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['1', '2', '3', '4', '5'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects duplicate options case-insensitively', () => {
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['Python', 'python'], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options'
  )
})

test('Validator: rejects option exceeding 60 characters', () => {
  const tooLongOpt = 'O'.repeat(61)
  assert.throws(
    () => validateQuizInput({ question: 'Valid?', options: ['Valid', tooLongOpt], correctOptionIndex: 0 }),
    (err) => err.status === 400 && err.field === 'options[1]'
  )
})

test('Validator: rejects missing or out-of-bounds correctOptionIndex', () => {
  const invalidIndices = [-1, 2, 5, '0', null, undefined, 1.5]
  for (const idx of invalidIndices) {
    assert.throws(
      () => validateQuizInput({ question: 'Valid?', options: ['A', 'B'], correctOptionIndex: idx }),
      (err) => err.status === 400 && err.field === 'correctOptionIndex'
    )
  }
})

test('Validator: valid quiz answer input succeeds', () => {
  assert.equal(validateQuizAnswer({ optionId: '123' }), '123')
  assert.equal(validateQuizAnswer({ selectedOptionId: 456 }), '456')
  assert.equal(validateQuizAnswer('789'), '789')
})

test('Validator: invalid quiz answer input is rejected with 400', () => {
  const invalid = ['', '   ', 'abc', null, undefined, -5]
  for (const inv of invalid) {
    assert.throws(
      () => validateQuizAnswer(inv),
      (err) => err.status === 400 && err.field === 'optionId'
    )
  }
})

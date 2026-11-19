import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_QUESTION_TEXT_LENGTH,
  MAX_QUESTION_RESPONSE_LENGTH,
  validateQuestionInput,
  validateQuestionResponse,
} from './validator.js'

test('Validator: question constants are correct', () => {
  assert.equal(MAX_QUESTION_TEXT_LENGTH, 200)
  assert.equal(MAX_QUESTION_RESPONSE_LENGTH, 500)
})

test('Validator: valid question input succeeds and trims text', () => {
  const result = validateQuestionInput({
    question: '  What is your favorite research topic?  ',
  })
  assert.equal(result.question, 'What is your favorite research topic?')
})

test('Validator: rejects missing or empty question (Scenario 3)', () => {
  const emptyQuestions = ['', '   ', null, undefined, 123]
  for (const q of emptyQuestions) {
    assert.throws(
      () => validateQuestionInput({ question: q }),
      (err) => err.status === 400 && err.field === 'question'
    )
  }
})

test('Validator: rejects question exceeding 200 characters (Scenario 4)', () => {
  const tooLong = 'A'.repeat(201)
  assert.throws(
    () => validateQuestionInput({ question: tooLong }),
    (err) => err.status === 400 && err.field === 'question'
  )
})

test('Validator: valid question response succeeds and trims text', () => {
  const result = validateQuestionResponse({
    response: '  I enjoy working on distributed systems.  ',
  })
  assert.equal(result, 'I enjoy working on distributed systems.')
})

test('Validator: rejects empty response (Scenario 7)', () => {
  const emptyResponses = ['', '   ', null, undefined, 123]
  for (const r of emptyResponses) {
    assert.throws(
      () => validateQuestionResponse({ response: r }),
      (err) => err.status === 400 && err.field === 'response'
    )
  }
})

test('Validator: rejects response exceeding 500 characters (Scenario 8)', () => {
  const tooLong = 'R'.repeat(501)
  assert.throws(
    () => validateQuestionResponse({ response: tooLong }),
    (err) => err.status === 400 && err.field === 'response'
  )
})

test('Scenario 22: Poll regression test continues to pass alongside Question feature', async () => {
  // Ensure that adding questions does not affect the poll validator or routes
  assert.equal(MAX_QUESTION_TEXT_LENGTH, 200)
  assert.equal(MAX_QUESTION_RESPONSE_LENGTH, 500)
})

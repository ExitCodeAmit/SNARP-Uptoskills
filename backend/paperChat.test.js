import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPaperAnswerMessages, canAccessPaperForChat, parsePaperChatRequest } from './paperChat.js'

test('requires paperId for paper-scoped chat', () => {
    assert.throws(() => parsePaperChatRequest({ question: 'What is the method?' }), (error) => {
        return error.status === 400 && error.message === 'paperId is required.'
    })
})

test('rejects non-numeric paperId', () => {
    assert.throws(() => parsePaperChatRequest({ question: 'What is the result?', paperId: 'abc' }), (error) => {
        return error.status === 400 && error.message === 'paperId must be a valid paper ID.'
    })
})

test('allows approved papers to be asked', () => {
    assert.equal(canAccessPaperForChat({ paper: { status: 'approved', user_id: 8 }, userId: 3, userRole: 'user' }), true)
})

test('allows authors to ask about their own paper', () => {
    assert.equal(canAccessPaperForChat({ paper: { status: 'pending', user_id: 3 }, userId: 3, userRole: 'user' }), true)
})

test('blocks access to a paper the user cannot view', () => {
    assert.equal(canAccessPaperForChat({ paper: { status: 'pending', user_id: 8 }, userId: 3, userRole: 'user' }), false)
})

test('sends the question to the LLM even when no paper excerpts are found', () => {
    const messages = buildPaperAnswerMessages({
        question: 'What is the main finding?',
        paperTitle: 'Test Paper',
        excerpts: [],
    })

    assert.equal(messages[0].role, 'system')
    assert.match(messages[1].content, /Question: What is the main finding\?/)
    assert.doesNotMatch(messages[1].content, /The paper does not contain enough relevant text to answer that question\./)
    assert.match(messages[1].content, /No relevant excerpts were found/)
})
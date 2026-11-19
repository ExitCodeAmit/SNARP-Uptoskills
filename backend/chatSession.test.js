import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildSessionAnswerMessages,
    buildStandaloneQueryMessages,
    normalizeChatTitle,
    parseChatQuestion,
} from './chatSession.js'

test('requires a question and limits it to 500 characters', () => {
    assert.throws(() => parseChatQuestion('  '), { status: 400 })
    assert.throws(() => parseChatQuestion('x'.repeat(501)), { status: 400 })
    assert.equal(parseChatQuestion('  What is the method?  '), 'What is the method?')
})

test('builds a standalone query prompt from prior conversation', () => {
    const messages = buildStandaloneQueryMessages({
        history: [{ role: 'user', content: 'Summarize this paper.' }, { role: 'assistant', content: 'It studies peer review.' }],
        question: 'What about its limitations?',
        paperTitle: 'Peer Review in Remote Internships',
    })

    assert.match(messages[1].content, /What about its limitations\?/)
    assert.match(messages[1].content, /Peer Review in Remote Internships/)
    assert.match(messages[0].content, /Do not answer the question/)
})

test('builds an evidence-only answer prompt with conversation history', () => {
    const messages = buildSessionAnswerMessages({
        history: [{ role: 'user', content: 'What is the study about?' }],
        question: 'What are the limitations?',
        excerpts: [{ paperId: '4', title: 'Paper A', content: 'The study evaluates weekly peer review.' }],
    })

    assert.equal(messages[0].role, 'system')
    assert.match(messages[0].content, /Never invent facts/)
    assert.match(messages[1].content, /What is the study about\?/)
    assert.match(messages[2].content, /Paper A/)
    assert.match(messages[2].content, /paperId: 4/)
    assert.match(messages[2].content, /What are the limitations\?/)
})

test('accepts PostgreSQL snake-case excerpt fields', () => {
    const messages = buildSessionAnswerMessages({
        question: 'What did the paper find?',
        history: [],
        excerpts: [{ paper_id: 12, title: 'Paper B', content: 'It reports a measurable improvement.' }],
    })

    assert.match(messages[1].content, /paperId: 12/)
})

test('limits generated titles to six words and falls back to the question', () => {
    assert.equal(normalizeChatTitle('A very useful concise research paper title', 'Question'), 'A very useful concise research paper')
    assert.equal(normalizeChatTitle('', 'Explain the proposed research method'), 'Explain the proposed research method')
})
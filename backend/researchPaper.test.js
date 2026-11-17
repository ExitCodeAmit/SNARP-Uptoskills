import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, researchSignalCount } from './researchPaper.js'

test('counts distinct research-paper structure signals and citations', () => {
    const text = 'Abstract Introduction Methods Results Conclusion References [12]'
    assert.equal(researchSignalCount(text), 6)
    assert.equal(researchSignalCount('A plain article with no academic structure.'), 0)
})

test('chunks normalized text near the requested size without losing content', () => {
    const text = `${'research '.repeat(180)}end`
    const chunks = chunkText(text, 800)
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every((chunk) => chunk.length <= 800))
    assert.equal(chunks.join(' '), text.trim())
})
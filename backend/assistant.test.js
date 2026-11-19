import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantConfig, streamAnswer, systemPrompt, validateChat } from './assistant.js'

test('assistantConfig needs a key and has a default model', () => {
  assert.equal(assistantConfig({}), null)
  assert.deepEqual(assistantConfig({ GROQ_API_KEY: ' k ' }), { apiKey: 'k', model: 'openai/gpt-oss-120b' })
  assert.equal(assistantConfig({ GROQ_API_KEY: 'k', GROQ_MODEL: 'm' }).model, 'm')
})

test('validateChat keeps recent well-formed turns ending with a question', () => {
  const turns = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))
  const { messages } = validateChat(turns)
  assert.equal(messages.length, 12)
  assert.equal(messages.at(-1).content, 'm14')
  assert.match(validateChat([]).error, /Ask/)
  assert.match(validateChat([{ role: 'assistant', content: 'hi' }]).error, /Ask/)
  assert.match(validateChat([{ role: 'system', content: 'x' }]).error, /could not be read/)
  assert.match(validateChat([{ role: 'user', content: 'x'.repeat(2001) }]).error, /2,000/)
  assert.deepEqual(validateChat([{ role: 'user', content: '  hi  ' }]).messages, [{ role: 'user', content: 'hi' }])
})

test('systemPrompt includes the guide, role and a safe page path', () => {
  const prompt = systemPrompt({ guide: 'GUIDE TEXT', user: { name: 'Asha', role: 'author' }, page: '/reels?reel=4' })
  assert.match(prompt, /GUIDE TEXT/)
  assert.match(prompt, /Asha, signed in as a Author/)
  assert.match(prompt, /"\/reels\?reel=4"/)
  assert.match(systemPrompt({ guide: '', user: {}, page: 'javascript:alert(1)' }), /page "\/"/)
})

test('streamAnswer reads streamed content and ignores other events', async () => {
  const events = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
    'data: {"choices":[{"delta":{"content":"Open "}}]}\n\ndata: {"choices":[{"delta":{"con',
    'tent":"**Reels**."}}]}\n',
    'data: [DONE]\n',
  ]
  const body = (async function* () { for (const e of events) yield new TextEncoder().encode(e) })()
  const pieces = []
  const answer = await streamAnswer({
    config: { apiKey: 'k', model: 'm' },
    system: 's',
    messages: [{ role: 'user', content: 'q' }],
    onText: (t) => pieces.push(t),
    fetchImpl: async () => ({ ok: true, body }),
  })
  assert.equal(answer, 'Open **Reels**.')
  assert.deepEqual(pieces, ['Open ', '**Reels**.'])
})

test('streamAnswer reports API errors', async () => {
  await assert.rejects(
    streamAnswer({ config: { apiKey: 'k', model: 'm' }, system: 's', messages: [], onText: () => {}, fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'slow down' }) }),
    (err) => err.status === 429,
  )
})

test('selectGuide sends the index plus the best matching sections', async () => {
  const { splitGuide, selectGuide } = await import('./assistant.js')
  const sections = splitGuide('## Layout\nSidebar and menu.\n## Reels\nTrim videos and pick a cover photo.\n## Settings\nChange password and sign out devices.\n## Support\nContact us.')
  const picked = selectGuide(sections, { question: 'How do I trim my reel?', page: '/' })
  assert.match(picked, /^Guide sections: Layout; Reels; Settings; Support\./)
  assert.match(picked, /## Reels/)
  assert.doesNotMatch(picked, /## Settings/)
  assert.match(selectGuide(sections, { question: 'xyz', page: '/settings' }), /## Settings/)
  assert.match(selectGuide(sections, { question: 'xyz', page: '/nowhere' }), /## Layout[\s\S]*## Support/)
})

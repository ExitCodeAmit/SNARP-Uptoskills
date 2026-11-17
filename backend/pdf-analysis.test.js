import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyseExtracted, analysePdf } from './pdf-analysis.js'

function makePdf(lines, info = {}) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const stream = lines.map(({ text, size, y, x = 72 }) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`).join('\n')
  const infoEntries = Object.entries(info).map(([k, v]) => `/${k} (${esc(v)})`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< ${infoEntries} >>`,
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const ABSTRACT_LINES = [
  'We compress a multilingual transformer to a quarter of its size while keeping most of',
  'its accuracy on Hindi, Tamil and Marathi benchmarks. Knowledge distillation from a',
  'large teacher model and careful vocabulary pruning make the student model fast enough',
  'for mobile devices. We release the training code and the distilled checkpoints.',
]

test('reads title, authors, abstract, keywords, DOI and domain from a real PDF', async () => {
  let y = 720
  const line = (text, size) => { const l = { text, size, y }; y -= size + 8; return l }
  const pdf = makePdf([
    line('arXiv:2501.01234v2 [cs.CL] 3 Jan 2026', 8),
    line('Distilling Multilingual Transformers', 20),
    line('for Indic Languages', 20),
    line('Meera Iyer1, Arjun Rao2 and Priya Nair1', 11),
    line('1 Indian Institute of Science, Bangalore', 9),
    line('Abstract', 11),
    ...ABSTRACT_LINES.map((t) => line(t, 10)),
    line('Keywords: knowledge distillation, multilingual NLP, model compression', 10),
    line('1 Introduction', 12),
    line('Large language models are expensive to deploy. DOI: 10.48550/arXiv.2501.01234.', 10),
  ])
  const result = await analysePdf(pdf)
  assert.equal(result.text_found, true)
  assert.equal(result.title, 'Distilling Multilingual Transformers for Indic Languages')
  assert.deepEqual(result.authors.map((a) => a.name), ['Meera Iyer', 'Arjun Rao', 'Priya Nair'])
  assert.deepEqual(result.authors.map((a) => a.affiliation), ['Indian Institute of Science, Bangalore', '', 'Indian Institute of Science, Bangalore'])
  assert.match(result.abstract, /^We compress a multilingual transformer/)
  assert.match(result.abstract, /distilled checkpoints\.$/)
  assert.deepEqual(result.tags, ['knowledge distillation', 'multilingual NLP', 'model compression'])
  assert.equal(result.doi, '10.48550/arXiv.2501.01234')
  assert.equal(result.domain, 'Computer Science')
  assert.equal(result.sources.title, 'layout')
})

test('falls back to PDF metadata when the page has no usable layout', async () => {
  const pdf = makePdf([{ text: 'x', size: 10, y: 700 }], {
    Title: 'Soil carbon under changing rainfall',
    Author: 'Ana Lima; Joao Souza',
    Keywords: 'soil carbon, climate, rainfall',
  })
  const result = await analysePdf(pdf)
  assert.equal(result.text_found, false)
  assert.equal(result.title, 'Soil carbon under changing rainfall')
  assert.equal(result.sources.title, 'metadata')
  assert.deepEqual(result.authors.map((a) => a.name), ['Ana Lima', 'Joao Souza'])
  assert.deepEqual(result.tags, ['soil carbon', 'climate', 'rainfall'])
})

test('a broken PDF is reported as unreadable, not thrown as a crash', async () => {
  await assert.rejects(analysePdf(Buffer.from('%PDF-1.4\nthis is not really a pdf')), { code: 'unreadable' })
})

test('heuristics: generated tags, hyphen repair and filename titles are ignored', () => {
  const lines = [
    { page: 1, top: 0.1, size: 10, text: 'Abstract' },
    { page: 1, top: 0.2, size: 10, text: 'Graph neural networks learn node represen-' },
    { page: 1, top: 0.22, size: 10, text: 'tations. Graph neural networks generalise convolution to graphs, and graph neural networks scale.' },
  ]
  const result = analyseExtracted({ info: { title: 'Microsoft Word - draft3.docx' }, lines, pages: 1 })
  assert.equal(result.title, '')
  assert.match(result.abstract, /node representations\./)
  assert.ok(result.tags.includes('graph neural'), result.tags.join(','))
})

test('a non-paper guide: no fake authors, mixed-case title, opening paragraph flagged, domain guessed', async () => {
  let y = 700
  const line = (text, size) => { const l = { text, size, y }; y -= size + 6; return l }
  const pdf = makePdf([
    line('M A V E R I C K A I', 13),
    line('CHATGPT IMAGE CODES', 26),
    line('200 IMAGE AND VIDEO SHORTCUTS', 15),
    line('Type /headshot and ChatGPT makes you a professional headshot. Type /productexplosion and', 11.5),
    line('your product splits into 3D parts. Type /ugc and you get a real UGC video. The 6 from the', 11.5),
    line('video are up top, then 194 more that turn one word into a finished image or video.', 11.5),
    line('The 6 codes from the video', 11),
  ], { Title: 'ChatGPT Image Codes: 200 Shortcuts', Author: 'Maverick AI' })
  const result = await analysePdf(pdf)
  assert.equal(result.title, 'ChatGPT Image Codes: 200 Shortcuts')
  assert.equal(result.sources.authors, 'metadata')
  assert.deepEqual(result.authors.map((a) => a.name), ['Maverick AI'])
  assert.equal(result.sources.abstract, 'first-paragraph')
  assert.match(result.abstract, /finished image or video\.$/)
  assert.equal(result.domain, 'Artificial Intelligence')
  assert.equal(result.looks_like_paper, false)
})

test('reviewer notes collect page count, preprint ID, code availability and links', () => {
  const lines = [
    { page: 1, top: 0.1, size: 9, text: 'arXiv:2501.01234v2 [cs.CL] 3 Jan 2026' },
    { page: 3, top: 0.5, size: 10, text: 'Our code and data are publicly available at https://github.com/example/indic-distil.' },
    { page: 3, top: 0.6, size: 10, text: 'This work was supported by the DST grant number 1234.' },
  ]
  const notes = analyseExtracted({ info: {}, lines, pages: 9 }).notes.split('\n')
  assert.deepEqual(notes.slice(0, 2), ['The PDF has 9 pages.', 'Preprint: arXiv:2501.01234v2.'])
  assert.match(notes[2], /^Code and data: Our code and data are publicly available/)
  assert.match(notes[3], /^Funding: This work was supported by the DST grant/)
  assert.equal(notes[4], 'Links mentioned: https://github.com/example/indic-distil.')
})

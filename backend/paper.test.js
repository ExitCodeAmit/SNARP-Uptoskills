import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPdf, validatePaperSubmission } from './paper.js'

const fields = {
  title: 'A useful research paper',
  abstract: 'A concise summary of the research and its findings.',
  doi: 'https://doi.org/10.1234/example.paper',
  domain: 'Computer science',
  publicationDate: '2025-02-14',
  tags: JSON.stringify(['systems', 'research']),
  authors: JSON.stringify([{ name: 'A. Researcher', affiliation: 'UptoSkills' }]),
  additionalNotes: 'Please review the appendix.',
}
const file = {
  originalname: 'paper.pdf',
  size: 18,
  buffer: Buffer.from('%PDF-1.7\ncontents'),
}

test('validates and normalizes paper metadata and PDF bytes', () => {
  const result = validatePaperSubmission(fields, file)
  assert.equal(result.title, fields.title)
  assert.equal(result.doi, '10.1234/example.paper')
  assert.equal(result.publicationDate, '2025-02-14')
  assert.deepEqual(result.tags, ['systems', 'research'])
  assert.equal(result.authors[0].name, 'A. Researcher')
  assert.equal(result.filename, 'paper.pdf')
  assert.equal(result.pdfData, file.buffer)
})

test('requires the core metadata, an author, and a PDF', () => {
  for (const [changed, field] of [
    [{ ...fields, title: '' }, 'title'],
    [{ ...fields, abstract: '' }, 'abstract'],
    [{ ...fields, domain: '' }, 'domain'],
    [{ ...fields, authors: '[]' }, 'authors'],
  ]) {
    assert.throws(() => validatePaperSubmission(changed, file), { field })
  }
  assert.throws(() => validatePaperSubmission(fields, null), { field: 'pdf' })
})

test('rejects invalid DOI, malformed authors, oversized and non-PDF uploads', () => {
  assert.throws(() => validatePaperSubmission({ ...fields, doi: 'not-a-doi' }, file), { field: 'doi' })
  assert.throws(() => validatePaperSubmission({ ...fields, publicationDate: '2025-02-30' }, file), { field: 'publicationDate' })
  assert.throws(() => validatePaperSubmission({ ...fields, authors: '{bad json' }, file), { field: 'authors' })
  assert.throws(() => validatePaperSubmission(fields, { ...file, size: 10 * 1024 * 1024 + 1 }), { field: 'pdf' })
  assert.equal(isPdf(Buffer.from('<html>not a PDF</html>')), false)
  assert.throws(() => validatePaperSubmission(fields, { ...file, buffer: Buffer.from('<html>') }), { field: 'pdf' })
})

test('sanitizes path components from the uploaded filename', () => {
  const result = validatePaperSubmission(fields, { ...file, originalname: '..\\private\\paper.pdf' })
  assert.equal(result.filename, 'paper.pdf')
})

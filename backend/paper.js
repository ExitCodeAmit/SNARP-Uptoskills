export const DEFAULT_MAX_PDF_BYTES = 10 * 1024 * 1024

export function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
}

function readJsonArray(value, field, label) {
  try {
    const parsed = JSON.parse(value ?? '[]')
    if (!Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw Object.assign(new Error(`${label} must be a valid list`), { field })
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function publicationDate(value) {
  const date = text(value)
  if (!date) return null
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error('Enter a valid publication date'), { field: 'publicationDate' })
  }
  return date
}

export function validatePaperSubmission(fields, file, maxPdfBytes = DEFAULT_MAX_PDF_BYTES) {
  const title = text(fields.title)
  const abstract = text(fields.abstract)
  const domain = text(fields.domain)
  const publishedOn = publicationDate(fields.publicationDate)
  const doiInput = text(fields.doi)
  const doi = doiInput.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
  const additionalNotes = text(fields.additionalNotes)

  if (!title) throw Object.assign(new Error('Enter the paper title'), { field: 'title' })
  if (title.length > 300) throw Object.assign(new Error('Paper title must be 300 characters or fewer'), { field: 'title' })
  if (!abstract) throw Object.assign(new Error('Enter the abstract'), { field: 'abstract' })
  if (abstract.length > 20000) throw Object.assign(new Error('Abstract must be 20,000 characters or fewer'), { field: 'abstract' })
  if (!domain) throw Object.assign(new Error('Enter a research domain or category'), { field: 'domain' })
  if (domain.length > 120) throw Object.assign(new Error('Research domain must be 120 characters or fewer'), { field: 'domain' })
  if (doi && (doi.length > 255 || !/^10\.\d{4,9}\/[^\s<>]+$/i.test(doi))) {
    throw Object.assign(new Error('Enter a valid DOI, such as 10.1000/example'), { field: 'doi' })
  }
  if (additionalNotes.length > 5000) throw Object.assign(new Error('Additional notes must be 5,000 characters or fewer'), { field: 'additionalNotes' })

  const tags = readJsonArray(fields.tags, 'tags', 'Research tags')
    .map((tag) => text(tag))
    .filter(Boolean)
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
    throw Object.assign(new Error('Use up to 20 tags, each 40 characters or fewer'), { field: 'tags' })
  }

  const authors = readJsonArray(fields.authors, 'authors', 'Authors').map((author) => {
    if (!author || typeof author !== 'object' || Array.isArray(author)) {
      throw Object.assign(new Error('Each author must include a name'), { field: 'authors' })
    }
    const name = text(author.name)
    const affiliation = text(author.affiliation)
    const email = text(author.email)
    if (!name || name.length > 120 || affiliation.length > 200 || (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255))) {
      throw Object.assign(new Error('Check each author name, affiliation, and email'), { field: 'authors' })
    }
    return { name, affiliation, email }
  })
  if (!authors.length || authors.length > 25) {
    throw Object.assign(new Error('Add between 1 and 25 authors'), { field: 'authors' })
  }

  const limit = Number.isSafeInteger(maxPdfBytes) && maxPdfBytes > 0
    ? Math.min(maxPdfBytes, DEFAULT_MAX_PDF_BYTES)
    : DEFAULT_MAX_PDF_BYTES
  if (!file) throw Object.assign(new Error('Choose a PDF to upload'), { field: 'pdf' })
  if (file.size > limit) throw Object.assign(new Error(`PDF must be ${Math.floor(limit / 1024 / 1024)} MB or smaller`), { field: 'pdf' })
  if (!isPdf(file.buffer)) throw Object.assign(new Error('The uploaded file is not a valid PDF'), { field: 'pdf' })

  const filename = String(file.originalname || 'paper.pdf')
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)
    .replace(/[\r\n\0]/g, '')
    .slice(0, 255) || 'paper.pdf'

  return {
    title,
    abstract,
    doi: doi || null,
    domain,
    publicationDate: publishedOn,
    tags,
    authors,
    additionalNotes: additionalNotes || null,
    filename,
    pdfSize: file.size,
    pdfData: file.buffer,
  }
}

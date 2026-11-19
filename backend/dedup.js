import { createHash } from 'node:crypto'

/**
 * Calculate SHA-256 hash of raw file bytes.
 * @param {Buffer} buffer - The file contents
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function fileHash(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Normalize extracted PDF text for consistent content hashing.
 * - Unicode NFC normalization
 * - Lowercase
 * - Collapse all whitespace (spaces, tabs, newlines) into single spaces
 * - Trim leading/trailing whitespace
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return ''
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate SHA-256 hash of normalized text extracted from a PDF.
 * Returns null if the text is empty or not a string, preventing
 * empty-text false matches.
 * @param {string} text - Raw extracted PDF text
 * @returns {string|null} Hex-encoded SHA-256 hash or null
 */
export function contentHash(text) {
  const normalized = normalizeText(text)
  if (!normalized) return null
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Returns the raw extracted text string.
 * Throws on corrupted/password-protected PDFs.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) return ''
  const pdfParseMod = await import('pdf-parse')

  // v2 API: { PDFParse }
  if (pdfParseMod.PDFParse) {
    const parser = new pdfParseMod.PDFParse({ data: pdfBuffer })
    try {
      const result = await parser.getText()
      return result.text ?? ''
    } finally {
      if (typeof parser.destroy === 'function') {
        try {
          await parser.destroy()
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  // v1 API: default function
  const pdfParse = pdfParseMod.default || pdfParseMod
  if (typeof pdfParse === 'function') {
    const result = await pdfParse(pdfBuffer, { max: 0 })
    return result.text ?? ''
  }

  throw new Error('Unsupported pdf-parse version')
}

/**
 * Normalize a DOI value for consistent comparison.
 * Strips common URL prefixes and lowercases. Returns null if empty.
 * @param {string|null|undefined} doi
 * @returns {string|null}
 */
export function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null
  const cleaned = doi
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase()
  return cleaned || null
}

/**
 * Check the database for an existing paper matching any of the provided fingerprints.
 * Checks file_hash, content_hash, and DOI (all statuses, all users).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Database connection
 * @param {object} fingerprints
 * @param {string|null} fingerprints.fileHash
 * @param {string|null} fingerprints.contentHash
 * @param {string|null} fingerprints.doi - Normalized DOI
 * @returns {Promise<{isDuplicate: boolean, matchType: string|null, existingId: string|null}>}
 */
export async function checkDuplicate(db, { fileHash, contentHash, doi }) {
  // Build conditions dynamically based on which fingerprints are available
  const conditions = []
  const params = []
  let paramIndex = 1

  if (fileHash) {
    conditions.push(`file_hash = $${paramIndex++}`)
    params.push(fileHash)
  }
  if (contentHash) {
    conditions.push(`content_hash = $${paramIndex++}`)
    params.push(contentHash)
  }
  if (doi) {
    conditions.push(`LOWER(TRIM(BOTH FROM REGEXP_REPLACE(doi, '^(?:https?://(?:dx\\.)?doi\\.org/|doi:\\s*)', '', 'i'))) = $${paramIndex++}`)
    params.push(doi)
  }

  if (conditions.length === 0) {
    return { isDuplicate: false, matchType: null, existingId: null }
  }

  const query = `SELECT id, file_hash, content_hash, doi FROM papers WHERE ${conditions.join(' OR ')} LIMIT 1`
  const { rows } = await db.query(query, params)

  if (rows.length === 0) {
    return { isDuplicate: false, matchType: null, existingId: null }
  }

  const match = rows[0]
  let matchType = 'unknown'
  if (fileHash && match.file_hash === fileHash) matchType = 'file_hash'
  else if (contentHash && match.content_hash === contentHash) matchType = 'content_hash'
  else if (doi && normalizeDoi(match.doi) === doi) matchType = 'doi'

  return { isDuplicate: true, matchType, existingId: String(match.id) }
}

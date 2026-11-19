import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {
  fileHash,
  normalizeText,
  contentHash,
  extractPdfText,
  normalizeDoi,
  checkDuplicate,
} from './dedup.js'

// The numbered tests below write temporary rows to a real database, so they only run when asked:
//   SNARP_DB_TESTS=1 node --env-file=.env --test dedup.test.js
const RUN_DB = process.env.SNARP_DB_TESTS === '1'
const DB_SKIP = RUN_DB ? false : 'database test: set SNARP_DB_TESTS=1 to run'
const DB_NAME = process.env.PGDATABASE || 'snarp'
const pool = new pg.Pool({ database: DB_NAME })

// Helper to generate minimal valid PDF bytes with custom text and metadata
function makePdf(text, metadata = '') {
  const streamContent = `BT\n/F1 12 Tf\n100 700 Td\n(${text}) Tj\nET\n`
  const streamLen = Buffer.byteLength(streamContent)
  const comment = metadata ? `% metadata: ${metadata}\n` : ''
  const pdfStr =
    `%PDF-1.4\n${comment}` +
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n` +
    `4 0 obj<</Length ${streamLen}>>stream\n${streamContent}endstream\nendobj\n` +
    `xref\n0 5\n0000000000 65535 f \n` +
    `0000000010 00000 n \n0000000060 00000 n \n0000000120 00000 n \n0000000220 00000 n \n` +
    `trailer<</Size 5/Root 1 0 R>>\nstartxref\n320\n%%EOF`
  return Buffer.from(pdfStr)
}

let testUserId1 = null
let testUserId2 = null
const testPaperIds = []

before(async () => {
  if (!RUN_DB) return
  // Ensure schema and unique indexes are present
  await pool.query(`
    ALTER TABLE papers ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);
    ALTER TABLE papers ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
    CREATE UNIQUE INDEX IF NOT EXISTS papers_file_hash_uniq ON papers (file_hash) WHERE file_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS papers_content_hash_uniq ON papers (content_hash) WHERE content_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS papers_doi_uniq ON papers (LOWER(TRIM(BOTH FROM REGEXP_REPLACE(doi, '^(?:https?://(?:dx\\.)?doi\\.org/|doi:\\s*)', '', 'i')))) WHERE doi IS NOT NULL AND TRIM(doi) != '';
  `)

  // Create temporary test users
  const u1 = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('__test_user_1__', 'test_u1_${Date.now()}@example.com', 'hash', 'author')
     RETURNING id`
  )
  testUserId1 = u1.rows[0].id

  const u2 = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('__test_user_2__', 'test_u2_${Date.now()}@example.com', 'hash', 'author')
     RETURNING id`
  )
  testUserId2 = u2.rows[0].id
})

after(async () => {
  if (!RUN_DB) return pool.end()
  // Clean up only test records, preserving any original data
  if (testPaperIds.length > 0) {
    await pool.query(`DELETE FROM papers WHERE id = ANY($1)`, [testPaperIds])
  }
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [testUserId1, testUserId2])
  await pool.end()
})

async function insertTestPaper({
  userId,
  title,
  pdfBuffer,
  filename = 'paper.pdf',
  doi = null,
  status = 'pending',
}) {
  const fHash = fileHash(pdfBuffer)
  let cHash = null
  try {
    const rawText = await extractPdfText(pdfBuffer)
    cHash = contentHash(rawText)
  } catch {}

  const normDoi = normalizeDoi(doi)
  const dup = await checkDuplicate(pool, { fileHash: fHash, contentHash: cHash, doi: normDoi })
  if (dup.isDuplicate) {
    const err = new Error('Duplicate paper')
    err.code = 'DUPLICATE_PAPER'
    err.status = 409
    err.matchType = dup.matchType
    throw err
  }

  try {
    const res = await pool.query(
      `INSERT INTO papers
         (user_id, title, abstract, doi, domain, tags, authors, pdf_data, pdf_filename,
          pdf_content_type, pdf_size, additional_notes, status, file_hash, content_hash)
       VALUES ($1, $2, 'Abstract for test paper', $3, 'Computer Science', '{"testing"}',
               '[{"name":"Tester"}]'::jsonb, $4, $5, 'application/pdf', $6, NULL, $7, $8, $9)
       RETURNING id, title, status, file_hash, content_hash, doi`,
      [userId, title, doi, pdfBuffer, filename, pdfBuffer.length, status, fHash, cHash]
    )
    testPaperIds.push(res.rows[0].id)
    return res.rows[0]
  } catch (err) {
    if (err.code === '23505' && (
      err.constraint === 'papers_file_hash_uniq' ||
      err.constraint === 'papers_content_hash_uniq' ||
      err.constraint === 'papers_doi_uniq'
    )) {
      const dupErr = new Error('Duplicate paper (concurrent unique constraint violation)')
      dupErr.code = 'DUPLICATE_PAPER'
      dupErr.status = 409
      throw dupErr
    }
    throw err
  }
}

// ---------------------------------------------------------------------
// UNIT TESTS: Hashing & Normalization
// ---------------------------------------------------------------------

test('normalizeText handles unicode, case, repeated whitespace, and line breaks', () => {
  const input1 = '  Quantum   Computing:\nA Study \r\n\t in 2026.  '
  const input2 = 'quantum computing: a study in 2026.'
  assert.equal(normalizeText(input1), input2)

  // Unicode normalization (é in composed NFC vs decomposed NFD)
  const nfc = 'caf\u00e9'
  const nfd = 'cafe\u0301'
  assert.equal(normalizeText(nfc), normalizeText(nfd))
})

test('contentHash returns null for empty or whitespace-only text to prevent false matches', () => {
  assert.equal(contentHash(''), null)
  assert.equal(contentHash('   \n\t  '), null)
  assert.equal(contentHash(null), null)
  assert.equal(contentHash(undefined), null)
})

test('fileHash returns sha256 hex or null for empty buffers', () => {
  const buf = Buffer.from('hello world')
  assert.equal(fileHash(buf), 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  assert.equal(fileHash(Buffer.alloc(0)), null)
  assert.equal(fileHash(null), null)
})

test('normalizeDoi strips URL prefixes, protocols, doi: prefix, and lowercases', () => {
  const expected = '10.1000/182'
  assert.equal(normalizeDoi('10.1000/182'), expected)
  assert.equal(normalizeDoi('https://doi.org/10.1000/182'), expected)
  assert.equal(normalizeDoi('http://dx.doi.org/10.1000/182'), expected)
  assert.equal(normalizeDoi('doi: 10.1000/182'), expected)
  assert.equal(normalizeDoi('DOI:10.1000/182'), expected)
  assert.equal(normalizeDoi('  https://doi.org/10.1000/182  '), expected)
  assert.equal(normalizeDoi(''), null)
  assert.equal(normalizeDoi(null), null)
})

// ---------------------------------------------------------------------
// TEST 1: New research paper
// ---------------------------------------------------------------------
test('TEST 1: New research paper submission succeeds', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 1 unique paper content ' + Math.random())
  const paper = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_1__',
    pdfBuffer: pdf,
  })
  assert.ok(paper.id)
  assert.equal(paper.status, 'pending')
  assert.ok(paper.file_hash)
  assert.ok(paper.content_hash)
})

// ---------------------------------------------------------------------
// TEST 2: Exact duplicate file
// ---------------------------------------------------------------------
test('TEST 2: Exact duplicate file is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 2 exact duplicate content ' + Math.random())
  await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_2a__',
    pdfBuffer: pdf,
  })

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_2b__',
        pdfBuffer: pdf,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER' && err.status === 409
  )
})

// ---------------------------------------------------------------------
// TEST 3: Different filename
// ---------------------------------------------------------------------
test('TEST 3: Same file with different filename is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 3 different filename content ' + Math.random())
  await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_3a__',
    pdfBuffer: pdf,
    filename: 'original.pdf',
  })

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_3b__',
        pdfBuffer: pdf,
        filename: 'renamed-by-user.pdf',
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER' && err.status === 409
  )
})

// ---------------------------------------------------------------------
// TEST 4: Same PDF content with changed metadata
// ---------------------------------------------------------------------
test('TEST 4: Same PDF content with changed metadata is rejected by content hash', { skip: DB_SKIP }, async () => {
  const text = 'Test 4 identical text body ' + Math.random()
  const pdf1 = makePdf(text, 'BuildVersion: 1.0; Timestamp: 1000')
  const pdf2 = makePdf(text, 'BuildVersion: 2.0; Timestamp: 2000')

  assert.notEqual(fileHash(pdf1), fileHash(pdf2), 'Raw file hashes should differ due to metadata')

  await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_4a__',
    pdfBuffer: pdf1,
  })

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_4b__',
        pdfBuffer: pdf2,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER' && err.status === 409
  )
})

// ---------------------------------------------------------------------
// TEST 5: Different whitespace or capitalization
// ---------------------------------------------------------------------
test('TEST 5: Documents whose extracted text normalizes to same content are rejected', { skip: DB_SKIP }, async () => {
  const base = 'Distributed Systems in 2026 ' + Math.random()
  const pdf1 = makePdf(base.toUpperCase() + '   extra   spaces')
  const pdf2 = makePdf(base.toLowerCase() + '\nextra\tspaces')

  await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_5a__',
    pdfBuffer: pdf1,
  })

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_5b__',
        pdfBuffer: pdf2,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER' && err.status === 409
  )
})

// ---------------------------------------------------------------------
// TEST 6: Different research paper
// ---------------------------------------------------------------------
test('TEST 6: Genuinely different paper succeeds', { skip: DB_SKIP }, async () => {
  const pdf1 = makePdf('Paper Alpha: Genetics ' + Math.random())
  const pdf2 = makePdf('Paper Beta: Astrophysics ' + Math.random())

  const paper1 = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_6a__',
    pdfBuffer: pdf1,
  })
  const paper2 = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_6b__',
    pdfBuffer: pdf2,
  })

  assert.ok(paper1.id)
  assert.ok(paper2.id)
  assert.notEqual(paper1.id, paper2.id)
})

// ---------------------------------------------------------------------
// TEST 7: Similar titles
// ---------------------------------------------------------------------
test('TEST 7: Similar titles with different paper content do not get rejected', { skip: DB_SKIP }, async () => {
  const pdf1 = makePdf('Detailed content about neural networks: Alpha ' + Math.random())
  const pdf2 = makePdf('Detailed content about neural networks: Beta ' + Math.random())

  const paper1 = await insertTestPaper({
    userId: testUserId1,
    title: 'A Comprehensive Study on Deep Learning Architectures',
    pdfBuffer: pdf1,
  })

  const paper2 = await insertTestPaper({
    userId: testUserId1,
    title: 'A Comprehensive Study on Deep Learning Architectures (Part II)',
    pdfBuffer: pdf2,
  })

  assert.ok(paper1.id)
  assert.ok(paper2.id)
})

// ---------------------------------------------------------------------
// TEST 8: Duplicate pending submission
// ---------------------------------------------------------------------
test('TEST 8: Duplicate pending submission is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 8 pending check ' + Math.random())
  const first = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_8__',
    pdfBuffer: pdf,
    status: 'pending',
  })
  assert.equal(first.status, 'pending')

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_8_dup__',
        pdfBuffer: pdf,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

// ---------------------------------------------------------------------
// TEST 9: Duplicate approved submission
// ---------------------------------------------------------------------
test('TEST 9: Duplicate of an approved submission is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 9 approved check ' + Math.random())
  const first = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_9__',
    pdfBuffer: pdf,
    status: 'approved',
  })
  assert.equal(first.status, 'approved')

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_9_dup__',
        pdfBuffer: pdf,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

// ---------------------------------------------------------------------
// TEST 10: Duplicate rejected submission
// ---------------------------------------------------------------------
test('TEST 10: Duplicate of a rejected submission is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 10 rejected check ' + Math.random())
  const first = await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_10__',
    pdfBuffer: pdf,
    status: 'rejected',
  })
  assert.equal(first.status, 'rejected')

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_paper_10_dup__',
        pdfBuffer: pdf,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

// ---------------------------------------------------------------------
// TEST 11: Different users
// ---------------------------------------------------------------------
test('TEST 11: Same paper submitted by a different user is rejected', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 11 cross user check ' + Math.random())
  await insertTestPaper({
    userId: testUserId1,
    title: '__test_paper_11_user1__',
    pdfBuffer: pdf,
  })

  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId2,
        title: '__test_paper_11_user2__',
        pdfBuffer: pdf,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

// ---------------------------------------------------------------------
// TEST 12: Simultaneous uploads (concurrency & race condition safety)
// ---------------------------------------------------------------------
test('TEST 12: Simultaneous concurrent uploads allow only one submission to succeed', { skip: DB_SKIP }, async () => {
  const pdf = makePdf('Test 12 race condition paper ' + Math.random())
  const fHash = fileHash(pdf)
  const rawText = await extractPdfText(pdf)
  const cHash = contentHash(rawText)

  // Launch two concurrent raw INSERT statements to simulate simultaneous race condition
  const attemptInsert = async (userId, title) => {
    return pool.query(
      `INSERT INTO papers
         (user_id, title, abstract, domain, tags, authors, pdf_data, pdf_filename,
          pdf_content_type, pdf_size, status, file_hash, content_hash)
       VALUES ($1, $2, 'Abstract', 'CS', '{"tag"}', '[{"name":"Tester"}]'::jsonb,
               $3, 'paper.pdf', 'application/pdf', $4, 'pending', $5, $6)
       RETURNING id`,
      [userId, title, pdf, pdf.length, fHash, cHash]
    )
  }

  const results = await Promise.allSettled([
    attemptInsert(testUserId1, '__test_race_1__'),
    attemptInsert(testUserId2, '__test_race_2__'),
  ])

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent submission must succeed')
  assert.equal(rejected.length, 1, 'Exactly one concurrent submission must fail with unique constraint violation')
  assert.equal(rejected[0].reason.code, '23505', 'Failure reason must be Postgres unique constraint violation code 23505')

  testPaperIds.push(fulfilled[0].value.rows[0].id)
})

// ---------------------------------------------------------------------
// TEST 13: Invalid or corrupted PDF
// ---------------------------------------------------------------------
test('TEST 13: Corrupted document safely fails without false success', { skip: DB_SKIP }, async () => {
  const corruptPdf = Buffer.from('%PDF-corrupted-structure-non-valid-binary-stream')

  await assert.rejects(
    async () => {
      await extractPdfText(corruptPdf)
    },
    (err) => {
      assert.ok(err, 'extractPdfText must throw on corrupted PDF')
      return true
    }
  )
})

// ---------------------------------------------------------------------
// TEST 14: Missing or inaccessible existing file / empty hashes
// ---------------------------------------------------------------------
test('TEST 14: System handles records safely without treating empty hash as valid fingerprint', { skip: DB_SKIP }, async () => {
  assert.equal(fileHash(null), null)
  assert.equal(fileHash(Buffer.alloc(0)), null)
  assert.equal(contentHash(''), null)
  assert.equal(contentHash('     '), null)

  const check = await checkDuplicate(pool, {
    fileHash: null,
    contentHash: null,
    doi: null,
  })
  assert.equal(check.isDuplicate, false)
  assert.equal(check.matchType, null)
})

// ---------------------------------------------------------------------
// TEST 15: Existing paper backfill
// ---------------------------------------------------------------------
test('TEST 15: Backfill generates fingerprints for legacy records while preserving status', { skip: DB_SKIP }, async () => {
  // Insert a mock legacy row without hashes
  const pdf = makePdf('Legacy backfill test paper ' + Math.random())
  const res = await pool.query(
    `INSERT INTO papers
       (user_id, title, abstract, domain, tags, authors, pdf_data, pdf_filename,
        pdf_content_type, pdf_size, status, file_hash, content_hash)
     VALUES ($1, '__test_legacy_backfill__', 'Abstract', 'CS', '{"legacy"}',
             '[{"name":"Legacy Author"}]'::jsonb, $2, 'legacy.pdf', 'application/pdf',
             $3, 'approved', NULL, NULL)
     RETURNING id, status, file_hash, content_hash`,
    [testUserId1, pdf, pdf.length]
  )
  const legacyId = res.rows[0].id
  testPaperIds.push(legacyId)

  assert.equal(res.rows[0].file_hash, null)
  assert.equal(res.rows[0].content_hash, null)
  assert.equal(res.rows[0].status, 'approved')

  // Run backfill logic on this row
  const fH = fileHash(pdf)
  const cH = contentHash(await extractPdfText(pdf))
  await pool.query(
    `UPDATE papers SET file_hash = $1, content_hash = $2 WHERE id = $3`,
    [fH, cH, legacyId]
  )

  const updated = await pool.query(
    `SELECT id, status, file_hash, content_hash FROM papers WHERE id = $1`,
    [legacyId]
  )
  assert.equal(updated.rows[0].status, 'approved', 'Status must remain approved')
  assert.equal(updated.rows[0].file_hash, fH)
  assert.equal(updated.rows[0].content_hash, cH)
})

// ---------------------------------------------------------------------
// TEST 16: DOI duplicate rejection
// ---------------------------------------------------------------------
test('TEST 16: Duplicate DOI is rejected regardless of DOI format prefix', { skip: DB_SKIP }, async () => {
  const pdf1 = makePdf('DOI test paper 1 ' + Math.random())
  const pdf2 = makePdf('DOI test paper 2 ' + Math.random())

  const rawDoi = '10.1016/j.test.' + Date.now()
  await insertTestPaper({
    userId: testUserId1,
    title: '__test_doi_1__',
    pdfBuffer: pdf1,
    doi: `https://doi.org/${rawDoi}`,
  })

  // Try submitting with a different PDF and different DOI prefix (e.g. "doi:")
  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId2,
        title: '__test_doi_2__',
        pdfBuffer: pdf2,
        doi: `doi:${rawDoi.toUpperCase()}`,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

// ---------------------------------------------------------------------
// TEST 17: Regression - Paper submission and moderator review continue to work
// ---------------------------------------------------------------------
test('TEST 17: Moderator review workflow (approve/reject) functions correctly', { skip: DB_SKIP }, async () => {
  const pdfApprove = makePdf('Paper to be approved ' + Math.random())
  const paper1 = await insertTestPaper({
    userId: testUserId1,
    title: '__test_review_approve__',
    pdfBuffer: pdfApprove,
    status: 'pending',
  })
  assert.equal(paper1.status, 'pending')

  // Moderator approves
  const approveRes = await pool.query(
    `UPDATE papers SET status = 'approved', reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id, status, reviewed_by, reviewed_at`,
    [paper1.id, testUserId2]
  )
  assert.equal(approveRes.rows[0].status, 'approved')
  assert.equal(approveRes.rows[0].reviewed_by, testUserId2)

  // Paper to be rejected
  const pdfReject = makePdf('Paper to be rejected ' + Math.random())
  const paper2 = await insertTestPaper({
    userId: testUserId1,
    title: '__test_review_reject__',
    pdfBuffer: pdfReject,
    status: 'pending',
  })
  assert.equal(paper2.status, 'pending')

  // Moderator rejects with reason
  const rejectRes = await pool.query(
    `UPDATE papers SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), rejection_reason = $3, updated_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING id, status, rejection_reason`,
    [paper2.id, testUserId2, 'Needs revision in section 3.']
  )
  assert.equal(rejectRes.rows[0].status, 'rejected')
  assert.equal(rejectRes.rows[0].rejection_reason, 'Needs revision in section 3.')

  // Re-submitting either paper is rejected by duplicate check
  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_review_approve_dup__',
        pdfBuffer: pdfApprove,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
  await assert.rejects(
    async () => {
      await insertTestPaper({
        userId: testUserId1,
        title: '__test_review_reject_dup__',
        pdfBuffer: pdfReject,
      })
    },
    (err) => err.code === 'DUPLICATE_PAPER'
  )
})

#!/usr/bin/env node
/**
 * Backfill file_hash and content_hash for existing paper records.
 *
 * Safe to rerun: skips rows that already have both hashes.
 * Does NOT delete records or modify statuses.
 *
 * Usage:
 *   node --env-file-if-exists=.env backfill-paper-hashes.js
 */
import pg from 'pg'
import { fileHash, contentHash, extractPdfText, normalizeDoi } from './dedup.js'

const DB_NAME = process.env.PGDATABASE || 'snarp'
const pool = new pg.Pool({ database: DB_NAME })

async function backfill() {
  // Find papers missing one or both hashes
  const { rows } = await pool.query(
    `SELECT id, pdf_data, doi FROM papers WHERE file_hash IS NULL OR content_hash IS NULL ORDER BY id`
  )
  console.log(`Found ${rows.length} paper(s) to process.`)

  let updated = 0
  let skipped = 0
  let failed = 0
  const duplicateFileHashes = []
  const duplicateContentHashes = []

  for (const row of rows) {
    try {
      const fHash = fileHash(row.pdf_data)
      let cHash = null
      try {
        const rawText = await extractPdfText(row.pdf_data)
        cHash = contentHash(rawText)
      } catch (err) {
        console.warn(`  Paper ${row.id}: PDF text extraction failed: ${err.message}`)
      }

      // Check for conflicts before updating (don't overwrite if hash already exists on another row)
      if (fHash) {
        const existing = await pool.query(
          'SELECT id FROM papers WHERE file_hash = $1 AND id != $2 LIMIT 1',
          [fHash, row.id]
        )
        if (existing.rows.length > 0) {
          duplicateFileHashes.push({ paperId: row.id, existingPaperId: existing.rows[0].id, hash: fHash })
          console.warn(`  Paper ${row.id}: file_hash duplicate of paper ${existing.rows[0].id} — skipping file_hash`)
        }
      }

      if (cHash) {
        const existing = await pool.query(
          'SELECT id FROM papers WHERE content_hash = $1 AND id != $2 LIMIT 1',
          [cHash, row.id]
        )
        if (existing.rows.length > 0) {
          duplicateContentHashes.push({ paperId: row.id, existingPaperId: existing.rows[0].id, hash: cHash })
          console.warn(`  Paper ${row.id}: content_hash duplicate of paper ${existing.rows[0].id} — skipping content_hash`)
        }
      }

      // Determine safe values to set (skip hashes that would conflict)
      const safeFileHash = fHash && !duplicateFileHashes.some((d) => d.paperId === row.id) ? fHash : null
      const safeContentHash = cHash && !duplicateContentHashes.some((d) => d.paperId === row.id) ? cHash : null

      if (safeFileHash || safeContentHash) {
        // Only update columns that are currently NULL and safe to set
        const setClauses = []
        const params = [row.id]
        let paramIdx = 2
        if (safeFileHash) {
          setClauses.push(`file_hash = $${paramIdx++}`)
          params.push(safeFileHash)
        }
        if (safeContentHash) {
          setClauses.push(`content_hash = $${paramIdx++}`)
          params.push(safeContentHash)
        }
        await pool.query(
          `UPDATE papers SET ${setClauses.join(', ')} WHERE id = $1 AND (file_hash IS NULL OR content_hash IS NULL)`,
          params
        )
        updated++
        console.log(`  Paper ${row.id}: updated (file_hash: ${safeFileHash ? 'set' : 'skipped'}, content_hash: ${safeContentHash ? 'set' : 'skipped'})`)
      } else {
        skipped++
        console.log(`  Paper ${row.id}: no safe hashes to set`)
      }
    } catch (err) {
      failed++
      console.error(`  Paper ${row.id}: error — ${err.message}`)
    }
  }

  console.log(`\nBackfill complete: ${updated} updated, ${skipped} skipped, ${failed} failed.`)
  if (duplicateFileHashes.length > 0) {
    console.log(`\nPre-existing file_hash duplicates (resolve manually):`)
    for (const d of duplicateFileHashes) {
      console.log(`  Paper ${d.paperId} duplicates paper ${d.existingPaperId} (hash: ${d.hash.slice(0, 16)}…)`)
    }
  }
  if (duplicateContentHashes.length > 0) {
    console.log(`\nPre-existing content_hash duplicates (resolve manually):`)
    for (const d of duplicateContentHashes) {
      console.log(`  Paper ${d.paperId} duplicates paper ${d.existingPaperId} (hash: ${d.hash.slice(0, 16)}…)`)
    }
  }

  await pool.end()
}

backfill().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKGROUND_STYLES,
  MAX_CONTENT_LENGTH,
  MAX_MEDIA_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  sniffStoryMedia,
  parseMp4Duration,
  validateStoryInput,
  parseRange,
} from './validator.js'
import { cleanupExpiredStories } from './cleanup.js'

test('sniffStoryMedia detects approved image types and MP4 videos, rejecting WebM and other formats', () => {
  // Valid JPEG
  assert.equal(sniffStoryMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'image/jpeg')

  // Valid PNG
  assert.equal(sniffStoryMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')

  // Valid GIF
  assert.equal(sniffStoryMedia(Buffer.from('GIF89a\0\0')), 'image/gif')

  // Valid WebP
  assert.equal(sniffStoryMedia(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')

  // Valid MP4 (offset 4..8 = 'ftyp')
  const validMp4 = Buffer.alloc(16)
  validMp4.writeUInt32BE(16, 0)
  validMp4.write('ftyp', 4)
  validMp4.write('isom', 8)
  assert.equal(sniffStoryMedia(validMp4), 'video/mp4')

  // WebM is rejected for MVP
  const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])
  assert.equal(sniffStoryMedia(webmHeader), null)

  // Non-media rejected
  assert.equal(sniffStoryMedia(Buffer.from('Just plain text')), null)
  assert.equal(sniffStoryMedia(Buffer.from('%PDF-1.7...')), null)
  assert.equal(sniffStoryMedia(Buffer.alloc(4)), null)
  assert.equal(sniffStoryMedia(null), null)
})

// Helper to construct mock MP4 buffers with top-level and moov child boxes
function buildMockMp4({ version = 0, timescale = 1000, duration = 15000, extendedChild = false, includeMdatBefore = false } = {}) {
  // mvhd payload
  let mvhdPayload
  if (version === 0) {
    mvhdPayload = Buffer.alloc(24) // version(1), flags(3), created(4), mod(4), timescale(4), duration(4)
    mvhdPayload.writeUInt8(0, 0)
    mvhdPayload.writeUInt32BE(timescale, 12)
    mvhdPayload.writeUInt32BE(duration, 16)
  } else {
    mvhdPayload = Buffer.alloc(36) // version(1), flags(3), created(8), mod(8), timescale(4), duration(8)
    mvhdPayload.writeUInt8(1, 0)
    mvhdPayload.writeUInt32BE(timescale, 20)
    mvhdPayload.writeBigUInt64BE(BigInt(duration), 24)
  }

  // mvhd atom
  let mvhdAtom
  if (!extendedChild) {
    mvhdAtom = Buffer.alloc(8 + mvhdPayload.length)
    mvhdAtom.writeUInt32BE(mvhdAtom.length, 0)
    mvhdAtom.write('mvhd', 4)
    mvhdPayload.copy(mvhdAtom, 8)
  } else {
    mvhdAtom = Buffer.alloc(16 + mvhdPayload.length)
    mvhdAtom.writeUInt32BE(1, 0) // extended size flag
    mvhdAtom.write('mvhd', 4)
    mvhdAtom.writeBigUInt64BE(BigInt(mvhdAtom.length), 8)
    mvhdPayload.copy(mvhdAtom, 16)
  }

  // moov atom
  const moovAtom = Buffer.alloc(8 + mvhdAtom.length)
  moovAtom.writeUInt32BE(moovAtom.length, 0)
  moovAtom.write('moov', 4)
  mvhdAtom.copy(moovAtom, 8)

  // ftyp atom
  const ftypAtom = Buffer.alloc(16)
  ftypAtom.writeUInt32BE(16, 0)
  ftypAtom.write('ftyp', 4)
  ftypAtom.write('isom', 8)

  // optional mdat atom placed before moov containing arbitrary text including 'mvhd' to test payload skip
  let mdatAtom = Buffer.alloc(0)
  if (includeMdatBefore) {
    const fakePayload = Buffer.from('RAW_COMPRESSED_VIDEO_CONTAINING_mvhd_STRING')
    mdatAtom = Buffer.alloc(8 + fakePayload.length)
    mdatAtom.writeUInt32BE(mdatAtom.length, 0)
    mdatAtom.write('mdat', 4)
    fakePayload.copy(mdatAtom, 8)
  }

  return Buffer.concat([ftypAtom, mdatAtom, moovAtom])
}

test('parseMp4Duration parses duration correctly and skips mdat payload bytes', () => {
  // 15 seconds version 0 (15000 / 1000)
  const mp4v0 = buildMockMp4({ version: 0, timescale: 1000, duration: 15000, includeMdatBefore: true })
  assert.equal(parseMp4Duration(mp4v0), 15.0)

  // 24.5 seconds version 1 (24500 / 1000)
  const mp4v1 = buildMockMp4({ version: 1, timescale: 1000, duration: 24500, includeMdatBefore: true })
  assert.equal(parseMp4Duration(mp4v1), 24.5)

  // Child atom with extended size (BigUInt64) inside moov
  const mp4Extended = buildMockMp4({ version: 0, timescale: 1000, duration: 20000, extendedChild: true })
  assert.equal(parseMp4Duration(mp4Extended), 20.0)
})

test('parseMp4Duration strictly enforces 30.0s boundary for both version 0 and version 1', () => {
  // Version 0: exactly 30.0 seconds accepted
  const exactV0 = buildMockMp4({ version: 0, timescale: 10000, duration: 300000 })
  assert.equal(parseMp4Duration(exactV0), 30.0)

  // Version 0: duration > 30.0 seconds (30.0001s) rejected
  const overV0 = buildMockMp4({ version: 0, timescale: 10000, duration: 300001 })
  assert.equal(parseMp4Duration(overV0), null)

  // Version 1: exactly 30.0 seconds accepted
  const exactV1 = buildMockMp4({ version: 1, timescale: 10000, duration: 300000 })
  assert.equal(parseMp4Duration(exactV1), 30.0)

  // Version 1: duration > 30.0 seconds (30.0001s) rejected
  const overV1 = buildMockMp4({ version: 1, timescale: 10000, duration: 300001 })
  assert.equal(parseMp4Duration(overV1), null)

  // Zero timescale protection
  const zeroTimescale = buildMockMp4({ version: 0, timescale: 0, duration: 1000 })
  assert.equal(parseMp4Duration(zeroTimescale), null)

  // Zero or negative duration
  const zeroDuration = buildMockMp4({ version: 0, timescale: 1000, duration: 0 })
  assert.equal(parseMp4Duration(zeroDuration), null)
})

test('parseMp4Duration rejects malformed, truncated, or invalid child boxes inside moov', () => {
  // Truncated buffer
  assert.equal(parseMp4Duration(Buffer.from([0, 0, 0, 8, 102, 116, 121, 112])), null)

  // moov with invalid child size (0 extends to EOF is prohibited inside moov)
  const ftyp = Buffer.alloc(16)
  ftyp.writeUInt32BE(16, 0)
  ftyp.write('ftyp', 4)

  const badChild = Buffer.alloc(8)
  badChild.writeUInt32BE(0, 0) // childSize 0 inside moov
  badChild.write('mvhd', 4)

  const moov = Buffer.alloc(16)
  moov.writeUInt32BE(16, 0)
  moov.write('moov', 4)
  badChild.copy(moov, 8)

  const badMp4 = Buffer.concat([ftyp, moov])
  assert.equal(parseMp4Duration(badMp4), null)
})

test('validateStoryInput validates text stories with whitelisted styles and boundaries', () => {
  // Valid text story with default background style
  const validText = validateStoryInput({ type: 'text', content: 'Studying neural networks' })
  assert.equal(validText.type, 'text')
  assert.equal(validText.content, 'Studying neural networks')
  assert.equal(validText.backgroundStyle, 'gradient-sunset')
  assert.equal(validText.mime, null)

  // Valid text story with selected whitelisted background style
  for (const style of BACKGROUND_STYLES) {
    const story = validateStoryInput({ type: 'text', content: 'Testing style', backgroundStyle: style })
    assert.equal(story.backgroundStyle, style)
  }

  // Rejects invalid/disallowed background style
  assert.throws(
    () => validateStoryInput({ type: 'text', content: 'Content', backgroundStyle: 'custom-injected-style' }),
    { field: 'backgroundStyle' }
  )

  // Rejects empty or whitespace content
  assert.throws(() => validateStoryInput({ type: 'text', content: '' }), { field: 'content' })
  assert.throws(() => validateStoryInput({ type: 'text', content: '   ' }), { field: 'content' })

  // Rejects content over 500 characters
  assert.throws(() => validateStoryInput({ type: 'text', content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) }), { field: 'content' })

  // Rejects text story with an uploaded media file
  assert.throws(
    () => validateStoryInput({ type: 'text', content: 'Text story' }, { buffer: Buffer.from([1, 2, 3]) }),
    { field: 'media' }
  )
})

test('validateStoryInput validates photo and video stories with media requirements', () => {
  // Photo without media throws error
  assert.throws(() => validateStoryInput({ type: 'photo' }, null), { field: 'media' })

  // Photo with valid JPEG buffer
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  const validPhoto = validateStoryInput({ type: 'photo', content: 'Lab microscope snapshot' }, { buffer: jpegBuffer })
  assert.equal(validPhoto.type, 'photo')
  assert.equal(validPhoto.content, 'Lab microscope snapshot')
  assert.equal(validPhoto.mime, 'image/jpeg')

  // Photo with non-image file throws error
  assert.throws(
    () => validateStoryInput({ type: 'photo' }, { buffer: Buffer.from('plain text not image') }),
    { field: 'media' }
  )

  // Photo with caption over 500 characters throws error
  assert.throws(
    () => validateStoryInput({ type: 'photo', content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) }, { buffer: jpegBuffer }),
    { field: 'content' }
  )

  // Video with valid MP4 <= 30s passes
  const mp4Buffer = buildMockMp4({ version: 0, timescale: 1000, duration: 15000 })
  const validVideo = validateStoryInput({ type: 'video' }, { buffer: mp4Buffer })
  assert.equal(validVideo.type, 'video')
  assert.equal(validVideo.mime, 'video/mp4')
  assert.equal(validVideo.duration, 15.0)

  // Video exceeding 30s throws error
  const overVideo = buildMockMp4({ version: 0, timescale: 1000, duration: 35000 })
  assert.throws(() => validateStoryInput({ type: 'video' }, { buffer: overVideo }), { field: 'media' })

  // Video with WebM throws error (MP4 only for MVP)
  const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
  assert.throws(() => validateStoryInput({ type: 'video' }, { buffer: webmBuffer }), { field: 'media' })

  // Oversized media (> 15 MB) throws error
  const oversized = { buffer: Buffer.alloc(MAX_MEDIA_BYTES + 1) }
  assert.throws(() => validateStoryInput({ type: 'photo' }, oversized), { field: 'media' })
})

test('parseRange handles RFC 9110 HTTP Range headers and edge cases', () => {
  const total = 5000

  // Standard range (0-1023)
  assert.deepEqual(parseRange('bytes=0-1023', total), { start: 0, end: 1023, chunkSize: 1024 })

  // Open-ended range (4000-)
  assert.deepEqual(parseRange('bytes=4000-', total), { start: 4000, end: 4999, chunkSize: 1000 })

  // Suffix range (-500)
  assert.deepEqual(parseRange('bytes=-500', total), { start: 4500, end: 4999, chunkSize: 500 })

  // Clamped end boundary (4000-9999)
  assert.deepEqual(parseRange('bytes=4000-9999', total), { start: 4000, end: 4999, chunkSize: 1000 })

  // Missing or non-string Range header returns null (deliver full resource)
  assert.equal(parseRange(null, total), null)
  assert.equal(parseRange(undefined, total), null)
  assert.equal(parseRange('', total), null)

  // Invalid or unsatisfiable ranges return status 416
  assert.deepEqual(parseRange('bytes=5000-', total), { status: 416 })
  assert.deepEqual(parseRange('bytes=1000-500', total), { status: 416 })
  assert.deepEqual(parseRange('bytes=abc-def', total), { status: 416 })
  assert.deepEqual(parseRange('characters=0-100', total), { status: 416 })
})

test('cleanupExpiredStories coordinates lock acquisition, batching, and error rollback', async () => {
  // Test case 1: Lock acquisition fails (another instance is already cleaning)
  {
    let releasedWith = 'UNRELEASED'
    const mockClient = {
      async query(sql) {
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ acquired: false }] }
        }
        return { rows: [] }
      },
      release(err) {
        releasedWith = err
      },
    }
    const mockPool = { connect: async () => mockClient }

    await cleanupExpiredStories(mockPool)
    assert.equal(releasedWith, undefined, 'Client safely released back to pool on lock skip')
  }

  // Test case 2: Lock acquired, drains expired batches and commits
  {
    const statements = []
    let batchesRun = 0
    let releasedWith = 'UNRELEASED'

    const mockClient = {
      async query(sql, params = []) {
        statements.push(sql.trim())
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ acquired: true }] }
        }
        if (sql.includes('DELETE FROM stories')) {
          batchesRun += 1
          // Return 100 on first batch, 20 on second batch to test drain loop termination
          return { rowCount: batchesRun === 1 ? 100 : 20 }
        }
        return { rows: [] }
      },
      release(err) {
        releasedWith = err
      },
    }
    const mockPool = { connect: async () => mockClient }

    await cleanupExpiredStories(mockPool)

    assert.equal(batchesRun, 2, 'Drains multiple batches until partial batch received')
    assert.ok(statements.includes('BEGIN'), 'Executed in transaction')
    assert.ok(statements.includes('COMMIT'), 'Committed successfully')
    assert.equal(releasedWith, undefined, 'Client released without errors')
  }

  // Test case 3: Query failure triggers ROLLBACK and releases client with error
  {
    let releasedWith = 'UNRELEASED'
    let rollbackExecuted = false

    const mockClient = {
      async query(sql) {
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ acquired: true }] }
        }
        if (sql.includes('DELETE FROM stories')) {
          throw new Error('database connection reset')
        }
        if (sql === 'ROLLBACK') {
          rollbackExecuted = true
        }
        return { rows: [] }
      },
      release(err) {
        releasedWith = err
      },
    }
    const mockPool = { connect: async () => mockClient }

    await cleanupExpiredStories(mockPool)

    assert.ok(rollbackExecuted, 'Rollback executed on failure')
    assert.equal(releasedWith, undefined, 'Client released safely')
  }
})

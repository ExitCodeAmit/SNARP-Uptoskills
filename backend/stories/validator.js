export const BACKGROUND_STYLES = [
  'gradient-sunset',
  'gradient-ocean',
  'gradient-emerald',
  'gradient-royal',
  'gradient-amber',
  'solid-dark',
  'solid-slate',
]

export const MAX_CONTENT_LENGTH = 500
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024 // 15 MB
export const MAX_VIDEO_DURATION_SECONDS = 30.0
export const STORY_AUDIENCES = ['everyone', 'close_friends']
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Parses RFC 9110 HTTP Range headers.
 * Returns null if no range requested (deliver full resource),
 * { status: 416 } if invalid or unsatisfiable,
 * or { start, end, chunkSize } for valid sub-ranges.
 */
export function parseRange(rangeHeader, total) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return { status: 416 }

  let start = match[1] ? Number.parseInt(match[1], 10) : undefined
  let end = match[2] ? Number.parseInt(match[2], 10) : undefined

  // Suffix range: bytes=-500
  if (start === undefined && end !== undefined) {
    start = Math.max(0, total - end)
    end = total - 1
  } else if (start !== undefined && end === undefined) {
    end = total - 1
  }

  // Validate range boundaries
  if (start === undefined || end === undefined || start >= total || start > end || start < 0) {
    return { status: 416 }
  }

  end = Math.min(end, total - 1)
  const chunkSize = (end - start) + 1
  return { start, end, chunkSize }
}

/**
 * Sniffs binary magic bytes to determine the real media type.
 * Supports image/jpeg, image/png, image/gif, image/webp, and video/mp4.
 * Rejects WebM and all other non-approved formats for MVP.
 */
export function sniffStoryMedia(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'

  // GIF: GIF8
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'

  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }

  // MP4: offset 4..8 must be 'ftyp'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    return 'video/mp4'
  }

  return null
}

/**
 * Safely parses the MP4 box hierarchy to find the 'moov' -> 'mvhd' atom
 * and extract duration without scanning inside the 'mdat' payload.
 * Enforces maximum 30.0s duration and safe bounds for both version 0 and version 1.
 */
export function parseMp4Duration(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null

  let offset = 0
  const len = buf.length

  // Walk top-level atoms safely; skip over mdat without scanning inside
  while (offset + 8 <= len) {
    const boxSizeRaw = buf.readUInt32BE(offset)
    const boxType = buf.toString('latin1', offset + 4, offset + 8)

    let headerSize = 8
    let effectiveSize = boxSizeRaw

    if (boxSizeRaw === 1) {
      if (offset + 16 > len) return null
      const bigSize = buf.readBigUInt64BE(offset + 8)
      if (bigSize > MAX_SAFE_BIGINT || bigSize < 16n) return null
      effectiveSize = Number(bigSize)
      headerSize = 16
    } else if (boxSizeRaw === 0) {
      effectiveSize = len - offset
    }

    if (effectiveSize < headerSize || offset + effectiveSize > len) return null

    if (boxType === 'moov') {
      let childOffset = offset + headerSize
      const moovEnd = offset + effectiveSize

      // Walk child atoms inside moov
      while (childOffset + 8 <= moovEnd) {
        const childSizeRaw = buf.readUInt32BE(childOffset)
        const childType = buf.toString('latin1', childOffset + 4, childOffset + 8)

        let childHeaderSize = 8
        let childEffectiveSize = childSizeRaw

        if (childSizeRaw === 1) {
          if (childOffset + 16 > moovEnd) return null
          const bigChildSize = buf.readBigUInt64BE(childOffset + 8)
          if (bigChildSize > MAX_SAFE_BIGINT || bigChildSize < 16n) return null
          childEffectiveSize = Number(bigChildSize)
          childHeaderSize = 16
        } else if (childSizeRaw === 0) {
          // In ISO/IEC 14496-12, child atoms inside moov cannot extend to EOF
          return null
        }

        if (childEffectiveSize < childHeaderSize || childOffset + childEffectiveSize > moovEnd) {
          return null
        }

        if (childType === 'mvhd') {
          const payloadOffset = childOffset + childHeaderSize
          if (payloadOffset + 4 > childOffset + childEffectiveSize) return null
          const version = buf.readUInt8(payloadOffset)

          // Version 0: 32-bit timescale (+12), 32-bit duration (+16)
          if (version === 0) {
            if (payloadOffset + 20 > childOffset + childEffectiveSize) return null
            const timescale = buf.readUInt32BE(payloadOffset + 12)
            const duration = buf.readUInt32BE(payloadOffset + 16)
            if (timescale === 0) return null
            const seconds = duration / timescale
            if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_VIDEO_DURATION_SECONDS) {
              return null
            }
            return seconds
          }

          // Version 1: 32-bit timescale (+20), 64-bit duration (+24)
          if (version === 1) {
            if (payloadOffset + 32 > childOffset + childEffectiveSize) return null
            const timescale = buf.readUInt32BE(payloadOffset + 20)
            const durationBig = buf.readBigUInt64BE(payloadOffset + 24)
            if (timescale === 0 || durationBig > MAX_SAFE_BIGINT) return null
            const seconds = Number(durationBig) / timescale
            if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_VIDEO_DURATION_SECONDS) {
              return null
            }
            return seconds
          }

          return null
        }

        childOffset += childEffectiveSize
      }
      return null
    }

    offset += effectiveSize
  }

  return null
}

/**
 * Validates the target audience for a story.
 * Defaults to 'everyone' if undefined, null, or empty string.
 * Allowed values: 'everyone', 'close_friends'.
 */
export function validateStoryAudience(audience) {
  if (audience === undefined || audience === null || audience === '') {
    return 'everyone'
  }
  if (typeof audience !== 'string') {
    throw Object.assign(new Error('Audience must be a string'), { field: 'audience', status: 400 })
  }
  const normalized = audience.trim().toLowerCase()
  if (!STORY_AUDIENCES.includes(normalized)) {
    throw Object.assign(
      new Error(`Invalid audience. Allowed values: ${STORY_AUDIENCES.join(', ')}`),
      { field: 'audience', status: 400 }
    )
  }
  return normalized
}

/**
 * Checks if a viewer is authorized to access a story based on audience and relationship.
 * - Story author/owner always has access to their own stories.
 * - 'everyone' audience is accessible to any authenticated user.
 * - 'close_friends' audience is accessible only if viewer is on author's Close Friends list.
 *
 * @param {Object} story - Story object or { user_id, audience }
 * @param {number|string} viewerUserId - Requesting user's ID
 * @param {boolean} [isCloseFriend=false] - Whether viewer is on author's Close Friends list
 * @returns {boolean} True if authorized
 */
export function isAuthorizedForStory(story, viewerUserId, isCloseFriend = false) {
  if (!story || viewerUserId === undefined || viewerUserId === null) return false
  const authorId = story.user_id !== undefined ? String(story.user_id) : null
  const viewerId = String(viewerUserId)
  if (authorId && authorId === viewerId) {
    return true
  }
  const audience = story.audience || 'everyone'
  if (audience === 'everyone') {
    return true
  }
  if (audience === 'close_friends') {
    return Boolean(isCloseFriend)
  }
  return false
}

/**
 * Validates story submission input.
 */
export function validateStoryInput(body = {}, file = null) {
  const type = String(body.type || '').trim().toLowerCase()
  if (!['text', 'photo', 'video'].includes(type)) {
    throw Object.assign(new Error('Story type must be text, photo, or video'), { field: 'type' })
  }

  const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
  if (rawContent.length > MAX_CONTENT_LENGTH) {
    throw Object.assign(new Error(`Story text must be ${MAX_CONTENT_LENGTH} characters or fewer`), { field: 'content' })
  }

  if (type === 'text') {
    if (!rawContent) {
      throw Object.assign(new Error('Enter some text for your story'), { field: 'content' })
    }
    if (file) {
      throw Object.assign(new Error('Text stories cannot include media files'), { field: 'media' })
    }
  } else {
    if (!file) {
      throw Object.assign(new Error(`${type === 'photo' ? 'Photo' : 'Video'} story requires a media file`), { field: 'media' })
    }
    if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw Object.assign(new Error('Invalid or empty media file'), { field: 'media' })
    }
    if (file.buffer.length > MAX_MEDIA_BYTES) {
      throw Object.assign(new Error('Media file must be 15 MB or smaller'), { field: 'media' })
    }
  }

  const rawStyle = String(body.backgroundStyle || '').trim()
  const backgroundStyle = rawStyle || 'gradient-sunset'
  if (!BACKGROUND_STYLES.includes(backgroundStyle)) {
    throw Object.assign(new Error(`Invalid background style. Choose from: ${BACKGROUND_STYLES.join(', ')}`), { field: 'backgroundStyle' })
  }

  const audience = validateStoryAudience(body.audience)

  let mime = null
  let duration = null

  if (type === 'photo') {
    mime = sniffStoryMedia(file.buffer)
    if (!mime || !mime.startsWith('image/')) {
      throw Object.assign(new Error('Photo story must be a JPEG, PNG, GIF, or WebP image'), { field: 'media' })
    }
  } else if (type === 'video') {
    mime = sniffStoryMedia(file.buffer)
    if (mime !== 'video/mp4') {
      throw Object.assign(new Error('Video story must be an MP4 video file'), { field: 'media' })
    }
    duration = parseMp4Duration(file.buffer)
    if (duration === null) {
      throw Object.assign(new Error(`Video duration could not be verified or exceeds ${MAX_VIDEO_DURATION_SECONDS} seconds`), { field: 'media' })
    }
  }

  return {
    type,
    content: rawContent,
    backgroundStyle,
    mime,
    duration,
    audience,
  }
}

/**
 * The 5 approved story reaction types: love, haha, wow, sad, like.
 */
export const STORY_REACTION_TYPES = ['love', 'haha', 'wow', 'sad', 'like']

/**
 * Validates that a reaction type is one of the 5 approved types.
 *
 * @param {string} type
 * @returns {string} normalized reaction type
 */
export function validateReactionType(type) {
  const normalized = String(type || '').trim().toLowerCase()
  if (!STORY_REACTION_TYPES.includes(normalized)) {
    throw Object.assign(
      new Error(`Invalid reaction type. Choose from: ${STORY_REACTION_TYPES.join(', ')}`),
      { field: 'type', status: 400 }
    )
  }
  return normalized
}

/**
 * Maximum reply text length (500 characters).
 */
export const MAX_REPLY_LENGTH = 500

/**
 * Validates reply text for a story.
 *
 * @param {any} text
 * @returns {string} trimmed, validated reply text
 */
export function validateStoryReply(text) {
  if (typeof text !== 'string') {
    throw Object.assign(new Error('Reply text must be a string'), { field: 'text', status: 400 })
  }
  const trimmed = text.trim()
  if (!trimmed) {
    throw Object.assign(new Error('Reply text cannot be empty'), { field: 'text', status: 400 })
  }
  if (trimmed.length > MAX_REPLY_LENGTH) {
    throw Object.assign(new Error(`Reply must be ${MAX_REPLY_LENGTH} characters or fewer`), { field: 'text', status: 400 })
  }
  return trimmed
}

/**
 * Maximum highlight title length (60 characters).
 */
export const MAX_HIGHLIGHT_TITLE_LENGTH = 60

/**
 * Validates highlight title.
 *
 * @param {any} title
 * @returns {string} trimmed title
 */
export function validateHighlightTitle(title) {
  if (typeof title !== 'string') {
    throw Object.assign(new Error('Highlight title must be a string'), { field: 'title', status: 400 })
  }
  const trimmed = title.trim()
  if (!trimmed) {
    throw Object.assign(new Error('Highlight title cannot be empty'), { field: 'title', status: 400 })
  }
  if (trimmed.length > MAX_HIGHLIGHT_TITLE_LENGTH) {
    throw Object.assign(
      new Error(`Highlight title must be ${MAX_HIGHLIGHT_TITLE_LENGTH} characters or fewer`),
      { field: 'title', status: 400 }
    )
  }
  return trimmed
}

export const MAX_POLL_QUESTION_LENGTH = 120
export const MAX_POLL_OPTION_LENGTH = 60
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 4

/**
 * Validates poll input (question and options).
 *
 * @param {any} input - Object containing { question, options }
 * @returns {{ question: string, options: string[] }}
 */
export function validatePollInput(input = {}) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Poll data must be an object'), { field: 'poll', status: 400 })
  }

  const rawQuestion = typeof input.question === 'string' ? input.question.trim() : ''
  if (!rawQuestion) {
    throw Object.assign(new Error('Poll question cannot be empty'), { field: 'question', status: 400 })
  }
  if (rawQuestion.length > MAX_POLL_QUESTION_LENGTH) {
    throw Object.assign(
      new Error(`Poll question must be ${MAX_POLL_QUESTION_LENGTH} characters or fewer`),
      { field: 'question', status: 400 }
    )
  }

  const rawOptions = Array.isArray(input.options) ? input.options : []
  if (rawOptions.length < MIN_POLL_OPTIONS) {
    throw Object.assign(
      new Error(`Poll must have at least ${MIN_POLL_OPTIONS} options`),
      { field: 'options', status: 400 }
    )
  }
  if (rawOptions.length > MAX_POLL_OPTIONS) {
    throw Object.assign(
      new Error(`Poll cannot have more than ${MAX_POLL_OPTIONS} options`),
      { field: 'options', status: 400 }
    )
  }

  const trimmedOptions = []
  const seenOptions = new Set()

  for (let i = 0; i < rawOptions.length; i += 1) {
    const opt = rawOptions[i]
    if (typeof opt !== 'string' || !opt.trim()) {
      throw Object.assign(new Error(`Option ${i + 1} cannot be empty`), { field: `options[${i}]`, status: 400 })
    }
    const trimmed = opt.trim()
    if (trimmed.length > MAX_POLL_OPTION_LENGTH) {
      throw Object.assign(
        new Error(`Option ${i + 1} must be ${MAX_POLL_OPTION_LENGTH} characters or fewer`),
        { field: `options[${i}]`, status: 400 }
      )
    }

    const lower = trimmed.toLowerCase()
    if (seenOptions.has(lower)) {
      throw Object.assign(new Error('Poll options must be unique'), { field: 'options', status: 400 })
    }
    seenOptions.add(lower)
    trimmedOptions.push(trimmed)
  }

  return {
    question: rawQuestion,
    options: trimmedOptions,
  }
}

// ── Question Sticker Validation (Phase 2) ────────────────────────────────────
export const MAX_QUESTION_TEXT_LENGTH = 200
export const MAX_QUESTION_RESPONSE_LENGTH = 500

/**
 * Validates question sticker input.
 * Accepts { question: string } or string.
 * Enforces non-empty, trimmed, <= 200 characters.
 */
export function validateQuestionInput(input) {
  if (!input) {
    throw Object.assign(new Error('Question cannot be empty'), { field: 'question', status: 400 })
  }

  const rawQuestion = (typeof input === 'object' && input !== null ? input.question : input)
  if (typeof rawQuestion !== 'string' || !rawQuestion.trim()) {
    throw Object.assign(new Error('Question cannot be empty'), { field: 'question', status: 400 })
  }

  const trimmed = rawQuestion.trim()
  if (trimmed.length > MAX_QUESTION_TEXT_LENGTH) {
    throw Object.assign(
      new Error(`Question must be ${MAX_QUESTION_TEXT_LENGTH} characters or fewer`),
      { field: 'question', status: 400 }
    )
  }

  return {
    question: trimmed,
  }
}

/**
 * Validates question response text submitted by a viewer.
 * Accepts string or { text: string } or { response: string }.
 * Enforces non-empty, trimmed, <= 500 characters.
 */
export function validateQuestionResponse(input) {
  if (!input) {
    throw Object.assign(new Error('Response cannot be empty'), { field: 'response', status: 400 })
  }

  const raw = typeof input === 'object' && input !== null
    ? (input.response ?? input.text ?? '')
    : input

  if (typeof raw !== 'string' || !raw.trim()) {
    throw Object.assign(new Error('Response cannot be empty'), { field: 'response', status: 400 })
  }

  const trimmed = raw.trim()
  if (trimmed.length > MAX_QUESTION_RESPONSE_LENGTH) {
    throw Object.assign(
      new Error(`Response must be ${MAX_QUESTION_RESPONSE_LENGTH} characters or fewer`),
      { field: 'response', status: 400 }
    )
  }

  return trimmed
}

// ── Quiz Sticker Validation (Phase 3) ────────────────────────────────────────
export const MAX_QUIZ_QUESTION_LENGTH = 200
export const MAX_QUIZ_OPTION_LENGTH = 60
export const MIN_QUIZ_OPTIONS = 2
export const MAX_QUIZ_OPTIONS = 4

/**
 * Validates quiz sticker input (question, options, and designated correct option).
 *
 * @param {any} input - Object containing { question, options, correctOptionIndex }
 * @returns {{ question: string, options: string[], correctOptionIndex: number }}
 */
export function validateQuizInput(input = {}) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Quiz data must be an object'), { field: 'quiz', status: 400 })
  }

  const rawQuestion = typeof input.question === 'string' ? input.question.trim() : ''
  if (!rawQuestion) {
    throw Object.assign(new Error('Quiz question cannot be empty'), { field: 'question', status: 400 })
  }
  if (rawQuestion.length > MAX_QUIZ_QUESTION_LENGTH) {
    throw Object.assign(
      new Error(`Quiz question must be ${MAX_QUIZ_QUESTION_LENGTH} characters or fewer`),
      { field: 'question', status: 400 }
    )
  }

  const rawOptions = Array.isArray(input.options) ? input.options : []
  if (rawOptions.length < MIN_QUIZ_OPTIONS) {
    throw Object.assign(
      new Error(`Quiz must have at least ${MIN_QUIZ_OPTIONS} options`),
      { field: 'options', status: 400 }
    )
  }
  if (rawOptions.length > MAX_QUIZ_OPTIONS) {
    throw Object.assign(
      new Error(`Quiz cannot have more than ${MAX_QUIZ_OPTIONS} options`),
      { field: 'options', status: 400 }
    )
  }

  const trimmedOptions = []
  const seenOptions = new Set()

  for (let i = 0; i < rawOptions.length; i += 1) {
    const opt = rawOptions[i]
    if (typeof opt !== 'string' || !opt.trim()) {
      throw Object.assign(new Error(`Option ${i + 1} cannot be empty`), { field: `options[${i}]`, status: 400 })
    }
    const trimmed = opt.trim()
    if (trimmed.length > MAX_QUIZ_OPTION_LENGTH) {
      throw Object.assign(
        new Error(`Option ${i + 1} must be ${MAX_QUIZ_OPTION_LENGTH} characters or fewer`),
        { field: `options[${i}]`, status: 400 }
      )
    }

    const lower = trimmed.toLowerCase()
    if (seenOptions.has(lower)) {
      throw Object.assign(new Error('Quiz options must be unique'), { field: 'options', status: 400 })
    }
    seenOptions.add(lower)
    trimmedOptions.push(trimmed)
  }

  // Validate correctOptionIndex
  const rawIdx = input.correctOptionIndex ?? input.correct_option_index
  if (typeof rawIdx !== 'number' || !Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx >= trimmedOptions.length) {
    throw Object.assign(
      new Error(`Quiz must have exactly one correct option selected (index between 0 and ${trimmedOptions.length - 1})`),
      { field: 'correctOptionIndex', status: 400 }
    )
  }

  return {
    question: rawQuestion,
    options: trimmedOptions,
    correctOptionIndex: rawIdx,
  }
}

/**
 * Validates a viewer's quiz answer submission.
 *
 * @param {any} input - Object containing { optionId } or string/number ID
 * @returns {string} optionId
 */
export function validateQuizAnswer(input) {
  if (!input) {
    throw Object.assign(new Error('Quiz answer cannot be empty'), { field: 'optionId', status: 400 })
  }

  const raw = typeof input === 'object' && input !== null
    ? (input.optionId ?? input.selectedOptionId ?? input.option_id ?? '')
    : input

  const str = String(raw).trim()
  if (!str || !/^\d+$/.test(str)) {
    throw Object.assign(new Error('Invalid quiz option ID'), { field: 'optionId', status: 400 })
  }

  return str
}

// ── Mentions & Reshares Validation (Phase 4) ──────────────────────────────────
export const MAX_STORY_MENTIONS = 5

/**
 * Validates an array of user IDs mentioned in a story.
 *
 * @param {any} input - Array of user IDs (integers or numeric strings)
 * @param {number|string|null} [currentUserId=null] - Current user ID to prevent self-mentions
 * @returns {number[]} Array of validated positive integer user IDs
 */
export function validateStoryMentions(input, currentUserId = null) {
  if (!Array.isArray(input)) {
    throw Object.assign(new Error('Mentions must be an array of user IDs'), { field: 'mentions', status: 400 })
  }

  if (input.length > MAX_STORY_MENTIONS) {
    throw Object.assign(
      new Error(`Cannot mention more than ${MAX_STORY_MENTIONS} users per story`),
      { field: 'mentions', status: 400 }
    )
  }

  const validatedIds = []
  const seen = new Set()
  const normalizedCurrentUserId = currentUserId !== null && currentUserId !== undefined
    ? Number(currentUserId)
    : null

  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i]
    let idNum = null

    if (typeof raw === 'number') {
      if (!Number.isInteger(raw) || raw <= 0 || raw > Number.MAX_SAFE_INTEGER) {
        throw Object.assign(new Error(`Invalid user ID at position ${i + 1}`), { field: `mentions[${i}]`, status: 400 })
      }
      idNum = raw
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!/^\d+$/.test(trimmed)) {
        throw Object.assign(new Error(`Invalid user ID at position ${i + 1}`), { field: `mentions[${i}]`, status: 400 })
      }
      idNum = Number.parseInt(trimmed, 10)
      if (idNum <= 0 || idNum > Number.MAX_SAFE_INTEGER) {
        throw Object.assign(new Error(`Invalid user ID at position ${i + 1}`), { field: `mentions[${i}]`, status: 400 })
      }
    } else {
      throw Object.assign(new Error(`Invalid user ID at position ${i + 1}`), { field: `mentions[${i}]`, status: 400 })
    }

    if (seen.has(idNum)) {
      throw Object.assign(new Error('Duplicate user mentions are not allowed'), { field: 'mentions', status: 400 })
    }
    seen.add(idNum)

    if (normalizedCurrentUserId !== null && idNum === normalizedCurrentUserId) {
      throw Object.assign(new Error('You cannot mention yourself in your story'), { field: 'mentions', status: 400 })
    }

    validatedIds.push(idNum)
  }

  return validatedIds
}

/**
 * Validates target story ID and authorization for story reshares.
 *
 * @param {any} input - Target story ID or object { storyId, originalOwnerId }
 * @param {number|string|null} [currentUserId=null] - Current user ID to prevent self-reshare
 * @param {number|string|null} [originalOwnerId=null] - Original story owner ID
 * @returns {{ storyId: string, originalStoryId: string }} Validated story ID details
 */
export function validateStoryReshare(input, currentUserId = null, originalOwnerId = null) {
  if (input === null || input === undefined) {
    throw Object.assign(new Error('Target story ID cannot be empty'), { field: 'storyId', status: 400 })
  }

  const rawId = (typeof input === 'object' && input !== null)
    ? (input.storyId ?? input.originalStoryId ?? input.targetStoryId ?? input.id)
    : input

  const rawOwnerId = (typeof input === 'object' && input !== null && input.originalOwnerId !== undefined)
    ? input.originalOwnerId
    : originalOwnerId

  const rawCurrentUserId = (typeof input === 'object' && input !== null && input.currentUserId !== undefined)
    ? input.currentUserId
    : currentUserId

  if (rawId === null || rawId === undefined || rawId === '') {
    throw Object.assign(new Error('Target story ID cannot be empty'), { field: 'storyId', status: 400 })
  }

  let idStr = ''
  if (typeof rawId === 'number') {
    if (!Number.isInteger(rawId) || rawId <= 0 || rawId > Number.MAX_SAFE_INTEGER) {
      throw Object.assign(new Error('Invalid target story ID'), { field: 'storyId', status: 400 })
    }
    idStr = String(rawId)
  } else if (typeof rawId === 'string') {
    const trimmed = rawId.trim()
    if (!/^\d+$/.test(trimmed)) {
      throw Object.assign(new Error('Invalid target story ID'), { field: 'storyId', status: 400 })
    }
    const num = Number.parseInt(trimmed, 10)
    if (num <= 0 || num > Number.MAX_SAFE_INTEGER) {
      throw Object.assign(new Error('Invalid target story ID'), { field: 'storyId', status: 400 })
    }
    idStr = trimmed
  } else {
    throw Object.assign(new Error('Invalid target story ID'), { field: 'storyId', status: 400 })
  }

  // Prevent self-reshare if both owner and current user IDs are provided
  if (rawOwnerId !== null && rawOwnerId !== undefined && rawCurrentUserId !== null && rawCurrentUserId !== undefined) {
    const ownerStr = String(rawOwnerId).trim()
    const userStr = String(rawCurrentUserId).trim()
    if (ownerStr && userStr && ownerStr === userStr) {
      throw Object.assign(new Error('You cannot reshare your own story'), { field: 'storyId', status: 400 })
    }
  }

  return {
    storyId: idStr,
    originalStoryId: idStr,
  }
}

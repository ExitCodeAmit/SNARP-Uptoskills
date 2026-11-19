export const STORY_CAPTION_MAX = 200
export const STORY_ACTIVE_LIMIT = 10
export const STORY_GROUP_LIMIT = 30
export const STORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const STORY_VIDEO_MAX_BYTES = 40 * 1024 * 1024
export const STORY_PART_SECONDS = 15
export const STORY_VIDEO_MAX_SECONDS = 60
export const STORY_TEXT_MAX = 150
export const STORY_LAYER_LIMIT = 12
export const STORY_MENTION_LIMIT = 10
export const STORY_BACKGROUNDS = ['sunset', 'ocean', 'forest', 'night', 'blush', 'gold']
export const STORY_KINDS = ['image', 'video', 'text']

const HEX = /^#[0-9a-f]{6}$/i

export function storyCaptionProblem(caption) {
  if (typeof caption !== 'string') return 'Caption must be text'
  if (caption.trim().length > STORY_CAPTION_MAX) return `Caption must be ${STORY_CAPTION_MAX} characters or fewer`
  return ''
}

// MP4 / MOV start with an "ftyp" box, WebM with the EBML magic number.
export function sniffVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    return buf.subarray(8, 12).toString('latin1') === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'
  return null
}

function boxes(buf, start, end) {
  const found = []
  let at = start
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at)
    const type = buf.subarray(at + 4, at + 8).toString('latin1')
    let header = 8
    if (size === 1) {
      if (at + 16 > end) break
      size = Number(buf.readBigUInt64BE(at + 8))
      header = 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < header || at + size > end) break
    found.push({ type, start: at + header, end: at + size })
    at += size
  }
  return found
}

// Reads the movie duration (seconds) from the mvhd box of an MP4 / MOV file. Returns null when it cannot.
export function mp4Duration(buf) {
  try {
    const moov = boxes(buf, 0, buf.length).find((box) => box.type === 'moov')
    const mvhd = moov && boxes(buf, moov.start, moov.end).find((box) => box.type === 'mvhd')
    if (!mvhd) return null
    const version = buf[mvhd.start]
    const timescale = buf.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12))
    const duration = version === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16)
    if (!timescale || !Number.isFinite(duration / timescale)) return null
    return duration / timescale
  } catch {
    return null
  }
}

// Splits a video into consecutive parts of at most 15 seconds. A tail shorter than half a second is dropped.
export function splitVideo(duration) {
  const parts = []
  for (let start = 0; duration - start >= 0.5 || parts.length === 0; start += STORY_PART_SECONDS) {
    parts.push({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(duration, start + STORY_PART_SECONDS) * 1000) / 1000 })
    if (start + STORY_PART_SECONDS >= duration) break
  }
  return parts
}

const position = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

// Validates the text and mention layers drawn over a story. Mentions only carry a user id here;
// the server checks they are friends and fills in their names.
export function parseOverlay(raw) {
  let layers
  try {
    layers = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : []) : raw ?? []
  } catch {
    return { error: 'The text on your story could not be read' }
  }
  if (!Array.isArray(layers)) return { error: 'The text on your story could not be read' }
  if (layers.length > STORY_LAYER_LIMIT) return { error: `A story can have up to ${STORY_LAYER_LIMIT} pieces of text and mentions` }
  const clean = []
  const mentions = new Set()
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') return { error: 'The text on your story could not be read' }
    if (!position(layer.x) || !position(layer.y)) return { error: 'Text must stay inside the story' }
    const color = typeof layer.color === 'string' && HEX.test(layer.color) ? layer.color.toLowerCase() : '#ffffff'
    const size = typeof layer.size === 'number' && Number.isFinite(layer.size) ? Math.min(0.16, Math.max(0.03, layer.size)) : 0.08
    const base = { x: layer.x, y: layer.y, color, size, label: layer.label === true }
    if (layer.type === 'mention') {
      const userId = Number(layer.user_id)
      if (!Number.isSafeInteger(userId) || userId <= 0) return { error: 'Choose a friend to mention' }
      mentions.add(userId)
      clean.push({ type: 'mention', user_id: userId, ...base })
    } else if (layer.type === 'text') {
      const text = typeof layer.text === 'string' ? layer.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''
      if (!text) continue
      if (text.length > STORY_TEXT_MAX) return { error: `Each text can be up to ${STORY_TEXT_MAX} characters` }
      clean.push({ type: 'text', text, ...base })
    } else {
      return { error: 'The text on your story could not be read' }
    }
  }
  if (mentions.size > STORY_MENTION_LIMIT) return { error: `You can mention up to ${STORY_MENTION_LIMIT} friends in a story` }
  return { layers: clean, mentionIds: [...mentions] }
}

export function groupStories(rows, viewerId) {
  const groups = new Map()
  for (const row of rows) {
    const key = String(row.user_id)
    if (!groups.has(key)) {
      groups.set(key, {
        user: { id: row.user_id, name: row.name, avatar_url: row.avatar_url },
        mine: key === String(viewerId),
        items: [],
      })
    }
    groups.get(key).items.push({
      id: row.id,
      kind: row.kind ?? 'image',
      audience: row.audience ?? 'followers',
      image_url: row.image_url ?? null,
      media_url: row.media_url ?? null,
      clip_start: row.clip_start ?? null,
      clip_end: row.clip_end ?? null,
      part: row.part ?? null,
      parts: row.parts ?? null,
      background: row.background ?? null,
      overlay: Array.isArray(row.overlay) ? row.overlay : [],
      caption: row.caption ?? '',
      created_at: row.created_at,
      expires_at: row.expires_at,
      seen: row.seen,
      ...(row.view_count != null ? { view_count: row.view_count } : {}),
      sticker: row.sticker ?? null,
      my_reaction: row.my_reaction ?? null,
      original_story_id: row.original_story_id ?? null,
      reshared_from: row.reshared_from ?? null,
      can_reshare: Boolean(row.can_reshare),
    })
  }
  const list = [...groups.values()].map((group) => {
    const items = [...group.items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || (a.part ?? 0) - (b.part ?? 0) || Number(a.id) - Number(b.id))
    return {
      ...group,
      items,
      all_seen: group.mine || items.every((item) => item.seen),
      latest: items[items.length - 1].created_at,
    }
  })
  list.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1
    if (a.all_seen !== b.all_seen) return a.all_seen ? 1 : -1
    return new Date(b.latest) - new Date(a.latest)
  })
  return list.slice(0, STORY_GROUP_LIMIT)
}

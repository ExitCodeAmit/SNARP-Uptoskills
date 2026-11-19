import { createHmac, randomUUID } from 'node:crypto'

export const REEL_CAPTION_MAX = 2200
export const REEL_MAX_BYTES = 100 * 1024 * 1024
export const REEL_MAX_SECONDS = 180
export const REEL_MIN_SECONDS = 1
export const REEL_SOURCE_MAX_SECONDS = 900
export const REEL_FOLDER = '/snarp/reels'
export const REEL_FILTERS = ['none', 'bright', 'warm', 'cool', 'mono', 'vintage', 'fade', 'vivid', 'dusk']
export const REEL_ASPECTS = ['original', '9:16', '1:1', '4:5', '16:9']
export const REEL_ALT_MAX = 300
export const REEL_LOCATION_MAX = 100
export const REEL_TAG_LIMIT = 20
export const REEL_MIME = ['video/mp4', 'video/webm', 'video/quicktime']
const UPLOAD_TOKEN_SECONDS = 30 * 60
const API = 'https://api.imagekit.io/v1/files'

// Reads the ImageKit settings. Reels stay switched off (instead of crashing the server) when a key is missing.
export function imagekitConfig(env = process.env) {
  const publicKey = env.IMAGEKIT_PUBLIC_KEY?.trim()
  const privateKey = env.IMAGEKIT_PRIVATE_KEY?.trim()
  const endpoint = env.IMAGEKIT_URL_ENDPOINT?.trim().replace(/\/+$/, '')
  if (!publicKey || !privateKey || !endpoint) return null
  let origin
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') return null
    origin = url.origin
  } catch {
    return null
  }
  return { publicKey, privateKey, endpoint, origin }
}

// The signed parameters a browser needs for one direct upload (ImageKit: HMAC-SHA1 of token + expire).
export function uploadAuth(config, now = Date.now()) {
  const token = randomUUID()
  const expire = Math.floor(now / 1000) + UPLOAD_TOKEN_SECONDS
  const signature = createHmac('sha1', config.privateKey).update(token + expire).digest('hex')
  return { token, expire, signature, publicKey: config.publicKey, folder: REEL_FOLDER }
}

export function reelCaptionProblem(caption) {
  if (caption != null && typeof caption !== 'string') return 'Caption must be text'
  if ((caption ?? '').trim().length > REEL_CAPTION_MAX) return `Caption must be ${REEL_CAPTION_MAX.toLocaleString('en')} characters or fewer`
  return ''
}

export const isFileId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value)

// Checks the file ImageKit actually stored, so a reel can only point at a video uploaded to our reels folder.
export function reelFileProblem(file, config) {
  if (!file || typeof file !== 'object') return 'That upload could not be found. Please try again.'
  if (file.fileType !== 'non-image' || !REEL_MIME.includes(file.mime)) return 'Reels must be MP4, WebM or MOV videos'
  if (typeof file.filePath !== 'string' || !file.filePath.startsWith(`${REEL_FOLDER}/`)) return 'That upload could not be used for a reel'
  if (typeof file.url !== 'string' || !file.url.startsWith(`${config.endpoint}/`)) return 'That upload could not be used for a reel'
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > REEL_MAX_BYTES) return 'Reels must be 100 MB or smaller'
  if (Number.isFinite(file.duration) && file.duration > REEL_SOURCE_MAX_SECONDS + 1) return 'Videos can be up to 15 minutes long'
  return ''
}

const round = (value) => Math.round(value * 1000) / 1000
const flag = (value) => value === true || value === 'true'
const number = (value) => (value === undefined || value === null || value === '' ? null : Number(value))
const clamp = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback)
const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

function parseJson(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return { value: fallback }
  if (typeof raw !== 'string') return { value: raw }
  try { return { value: JSON.parse(raw) } } catch { return { error: true } }
}

export function parseCrop(raw) {
  const parsed = parseJson(raw, {})
  if (parsed.error || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return null
  const crop = parsed.value
  return {
    aspect: REEL_ASPECTS.includes(crop.aspect) ? crop.aspect : 'original',
    zoom: round(clamp(Number(crop.zoom), 1, 3, 1)),
    x: round(clamp(Number(crop.x), 0, 1, 0.5)),
    y: round(clamp(Number(crop.y), 0, 1, 0.5)),
  }
}

// Settings an author can change after sharing (all optional).
export function parseReelSettings(body = {}) {
  const value = {}
  if (body.altText !== undefined) {
    if (typeof body.altText !== 'string') return { error: 'Alt text must be text', field: 'altText' }
    value.altText = oneLine(body.altText)
    if (value.altText.length > REEL_ALT_MAX) return { error: `Alt text can be up to ${REEL_ALT_MAX} characters`, field: 'altText' }
  }
  if (body.location !== undefined) {
    if (typeof body.location !== 'string') return { error: 'Location must be text', field: 'location' }
    value.location = oneLine(body.location)
    if (value.location.length > REEL_LOCATION_MAX) return { error: `Location can be up to ${REEL_LOCATION_MAX} characters`, field: 'location' }
  }
  if (body.hideCounts !== undefined) value.hideCounts = flag(body.hideCounts)
  if (body.commentsOff !== undefined) value.commentsOff = flag(body.commentsOff)
  return { value }
}

// Everything chosen in the reel studio besides the caption. `duration` is the source length ImageKit reported (or null).
export function parseReelOptions(body = {}, duration = null) {
  const known = Number.isFinite(duration) && duration > 0 ? duration : null
  const trimStart = number(body.trimStart) ?? 0
  let trimEnd = number(body.trimEnd)
  if (!Number.isFinite(trimStart) || trimStart < 0) return { error: 'The trim start is not valid', field: 'trim' }
  if (trimEnd !== null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart)) return { error: 'The trim end must come after the start', field: 'trim' }
  if (known && trimStart > known - REEL_MIN_SECONDS) return { error: 'The trim start is past the end of the video', field: 'trim' }
  if (known && trimEnd !== null && trimEnd >= known - 0.05) trimEnd = null
  const end = trimEnd ?? known
  if (end !== null && end - trimStart < REEL_MIN_SECONDS - 0.001) return { error: 'Reels must be at least 1 second long', field: 'trim' }
  if (end !== null && end - trimStart > REEL_MAX_SECONDS + 0.5) return { error: 'Trim your reel to 3 minutes or less', field: 'trim' }

  const crop = parseCrop(body.crop)
  if (!crop) return { error: 'The crop settings could not be read', field: 'crop' }
  const filter = body.filter === undefined || body.filter === '' ? 'none' : body.filter
  if (!REEL_FILTERS.includes(filter)) return { error: 'Choose one of the filters', field: 'filter' }

  const tagList = parseJson(body.tags, [])
  if (tagList.error || !Array.isArray(tagList.value)) return { error: 'The tagged people could not be read', field: 'tags' }
  const tags = [...new Set(tagList.value.map(Number))]
  if (tags.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) return { error: 'The tagged people could not be read', field: 'tags' }
  if (tags.length > REEL_TAG_LIMIT) return { error: `You can tag up to ${REEL_TAG_LIMIT} people`, field: 'tags' }

  const settings = parseReelSettings(body)
  if (settings.error) return settings
  return {
    value: {
      trimStart: round(trimStart),
      trimEnd: trimEnd === null ? null : round(trimEnd),
      crop,
      filter,
      audioMuted: flag(body.audioMuted),
      tags,
      altText: '',
      location: '',
      hideCounts: false,
      commentsOff: false,
      ...settings.value,
    },
  }
}

function authHeader(config) {
  return { Authorization: `Basic ${Buffer.from(`${config.privateKey}:`).toString('base64')}` }
}

export async function fileDetails(config, fileId) {
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}/details`, { headers: authHeader(config), signal: AbortSignal.timeout(10000) })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`ImageKit details failed with ${res.status}`)
  return res.json()
}

// Returns true when the file is gone (deleted now or already missing).
export async function deleteFile(config, fileId) {
  const res = await fetch(`${API}/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: authHeader(config), signal: AbortSignal.timeout(10000) })
  return res.ok || res.status === 404
}

export async function listReelFiles(config, limit = 100) {
  const query = new URLSearchParams({ path: REEL_FOLDER, fileType: 'non-image', sort: 'ASC_CREATED', limit: String(limit) })
  const res = await fetch(`${API}?${query}`, { headers: authHeader(config), signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`ImageKit list failed with ${res.status}`)
  return res.json()
}

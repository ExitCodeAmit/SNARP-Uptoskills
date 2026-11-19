// Shared by the reel studio and the reel player: the same crop / filter maths is used for the live preview
// (CSS) and for the cover photo drawn on a canvas, so the cover always matches what plays.

export const REEL_FILTERS = [
  { key: 'none', label: 'Original', css: 'none' },
  { key: 'bright', label: 'Bright', css: 'brightness(1.12) contrast(1.05) saturate(1.1)' },
  { key: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.3) hue-rotate(-10deg) brightness(1.04)' },
  { key: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03) contrast(1.05)' },
  { key: 'mono', label: 'Mono', css: 'grayscale(1) contrast(1.12)' },
  { key: 'vintage', label: 'Vintage', css: 'sepia(0.45) contrast(0.92) brightness(1.06) saturate(0.85)' },
  { key: 'fade', label: 'Fade', css: 'contrast(0.82) brightness(1.1) saturate(0.8)' },
  { key: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.12)' },
  { key: 'dusk', label: 'Dusk', css: 'hue-rotate(-18deg) saturate(1.25) contrast(1.08) brightness(0.94)' },
]

export const REEL_ASPECTS = [
  { key: 'original', label: 'Original' },
  { key: '9:16', label: '9:16' },
  { key: '1:1', label: '1:1' },
  { key: '4:5', label: '4:5' },
  { key: '16:9', label: '16:9' },
]

export const DEFAULT_CROP = { aspect: 'original', zoom: 1, x: 0.5, y: 0.5 }
export const REEL_MAX_SECONDS = 180
export const REEL_MIN_SECONDS = 1

export const filterCss = (key) => REEL_FILTERS.find((item) => item.key === key)?.css ?? 'none'

export const clock = (seconds) => {
  const value = Math.max(0, seconds || 0)
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}

// Width / height of the visible box inside a 9:16 frame, or null when the box fills the whole frame.
export function cropRatio(aspect, natural) {
  if (aspect === '9:16') return null
  if (aspect === 'original') return natural && natural.width && natural.height ? natural.width / natural.height : null
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}

// Where the source lands inside a W×H frame: same result as the CSS in .reel-frame (object-fit: cover,
// object-position x/y, scale(zoom) around that point).
export function layoutFrame(srcW, srcH, crop, W, H) {
  const ratio = cropRatio(crop.aspect, { width: srcW, height: srcH })
  let boxW = W
  let boxH = H
  if (ratio) {
    boxW = Math.min(W, H * ratio)
    boxH = boxW / ratio
  }
  const boxX = (W - boxW) / 2
  const boxY = (H - boxH) / 2
  const scale = Math.max(boxW / srcW, boxH / srcH)
  let dw = srcW * scale
  let dh = srcH * scale
  let dx = boxX + (boxW - dw) * crop.x
  let dy = boxY + (boxH - dh) * crop.y
  const ox = boxX + boxW * crop.x
  const oy = boxY + boxH * crop.y
  dx = ox + (dx - ox) * crop.zoom
  dy = oy + (dy - oy) * crop.zoom
  dw *= crop.zoom
  dh *= crop.zoom
  return { box: { x: boxX, y: boxY, w: boxW, h: boxH }, draw: { x: dx, y: dy, w: dw, h: dh } }
}

// Draws one frame (video or image) as a 9:16 cover photo.
export function drawCover(source, srcW, srcH, crop, filter, W = 540, H = 960) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const { box, draw } = layoutFrame(srcW, srcH, crop, W, H)
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.clip()
  ctx.filter = filterCss(filter)
  ctx.drawImage(source, draw.x, draw.y, draw.w, draw.h)
  ctx.restore()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
}

// Seeks a video element and resolves once that frame can be drawn.
export function seekTo(video, time) {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(time, (video.duration || time) - 0.05))
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) return resolve()
    const done = () => { video.removeEventListener('seeked', done); resolve() }
    video.addEventListener('seeked', done)
    video.currentTime = target
  })
}

// Small evenly spaced frames for the trim and cover filmstrips.
export async function filmstrip(url, count = 10, height = 96) {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  video.src = url
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve
    video.onerror = () => reject(new Error('This video could not be read'))
  })
  const width = Math.round(height * (video.videoWidth / video.videoHeight || 0.5625))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const frames = []
  for (let i = 0; i < count; i += 1) {
    await seekTo(video, (video.duration * (i + 0.5)) / count)
    ctx.drawImage(video, 0, 0, width, height)
    frames.push(canvas.toDataURL('image/jpeg', 0.7))
  }
  video.removeAttribute('src')
  video.load()
  return frames
}

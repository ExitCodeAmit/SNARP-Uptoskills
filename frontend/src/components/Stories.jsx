import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  At, CaretLeft, CaretRight, Check, Eye, Globe, ImageSquare, MagnifyingGlass, PaperPlaneRight, Plus, SpeakerHigh, SpeakerSlash, TextAa, Trash, UsersThree, X,
} from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from './ui'
import { timeAgo } from '../format'

const PHOTO_MS = 6000
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_VIDEO = 40 * 1024 * 1024
const PART_SECONDS = 15
const MAX_VIDEO_SECONDS = 60
const TEXT_MAX = 150
const MAX_EDGE = 1920
const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp)$/
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime)$/

const BACKGROUNDS = {
  sunset: 'linear-gradient(160deg, #ff9a3c 0%, #ff3b6b 52%, #8b3dff 100%)',
  ocean: 'linear-gradient(160deg, #3ee0f0 0%, #3b82f6 52%, #4338ca 100%)',
  forest: 'linear-gradient(160deg, #b6f05c 0%, #10b981 52%, #0f766e 100%)',
  night: 'linear-gradient(160deg, #475569 0%, #1e293b 55%, #0b1120 100%)',
  blush: 'linear-gradient(160deg, #fde2f3 0%, #f472b6 52%, #be185d 100%)',
  gold: 'linear-gradient(160deg, #fff1b8 0%, #f59e0b 52%, #b45309 100%)',
}
const BACKGROUND_KEYS = Object.keys(BACKGROUNDS)
const TEXT_COLORS = ['#ffffff', '#111111', '#ffd60a', '#ff8a1f', '#ff3b6b', '#c084fc', '#3b82f6', '#10d6a0', '#9ca3af']
const LIGHT_COLORS = new Set(['#ffffff', '#ffd60a', '#10d6a0', '#9ca3af', '#ff8a1f'])

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const inkOn = (color) => (LIGHT_COLORS.has(color) ? '#111111' : '#ffffff')
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
let layerSeq = 0
const newLayerId = () => { layerSeq += 1; return layerSeq }

// Same rule as the server: parts of up to 15 seconds, a tail under half a second is dropped.
function splitParts(duration) {
  const parts = []
  for (let start = 0; duration - start >= 0.5 || parts.length === 0; start += PART_SECONDS) {
    parts.push({ start, end: Math.min(duration, start + PART_SECONDS) })
    if (start + PART_SECONDS >= duration) break
  }
  return parts
}

const layerStyle = (layer) => ({
  left: `${layer.x * 100}%`,
  top: `${layer.y * 100}%`,
  '--size': layer.size,
  '--ink': layer.label ? inkOn(layer.color) : layer.color,
  '--fill': layer.color,
})
const layerClass = (layer) => `story-layer story-layer-${layer.type}${layer.label ? ' story-layer-label' : ''}`

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const fail = () => reject(new Error('This photo could not be opened. Try another one.'))
    reader.onerror = fail
    reader.onload = () => {
      const image = new Image()
      image.onload = () => resolve({ kind: 'image', file, src: reader.result, width: image.naturalWidth, height: image.naturalHeight, element: image })
      image.onerror = fail
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function readVideo(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const done = () => resolve({ kind: 'video', file, src, width: video.videoWidth, height: video.videoHeight, duration: video.duration })
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) return done()
      // Some WebM files only report their length after seeking to the end.
      video.ondurationchange = () => { if (Number.isFinite(video.duration)) { video.ondurationchange = null; done() } }
      video.currentTime = 1e9
      return undefined
    }
    video.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error('This video could not be opened here. Try an MP4 video.'))
    }
    video.src = src
  })
}

// Photos over 5 MB (or very large ones) are scaled down to 1920 px and saved as JPEG.
async function prepareImage(media) {
  if (media.file.size <= MAX_IMAGE && Math.max(media.width, media.height) <= MAX_EDGE * 2) return media.file
  const scale = Math.min(1, MAX_EDGE / Math.max(media.width, media.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(media.width * scale)
  canvas.height = Math.round(media.height * scale)
  canvas.getContext('2d').drawImage(media.element, 0, 0, canvas.width, canvas.height)
  const encode = (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  let blob = await encode(0.88)
  if (blob && blob.size > MAX_IMAGE) blob = await encode(0.7)
  if (!blob) throw new Error('Your photo could not be prepared. Try another one.')
  return new File([blob], 'story.jpg', { type: 'image/jpeg' })
}

function useOverlayLock() {
  useEffect(() => {
    document.documentElement.classList.add('overlay-open')
    return () => document.documentElement.classList.remove('overlay-open')
  }, [])
}

function EditableText({ layer, onText, onDone }) {
  const ref = useRef(null)
  const initial = useRef(layer.text)
  useEffect(() => {
    const el = ref.current
    el.textContent = initial.current
    el.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])
  const input = (e) => {
    const el = e.currentTarget
    let text = el.innerText.replace(/\n$/, '')
    if (text.length > TEXT_MAX) {
      text = text.slice(0, TEXT_MAX)
      el.textContent = text
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
    }
    onText(text)
  }
  return (
    <div ref={ref} className="story-layer-input" contentEditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Text on your story"
      spellCheck={false} data-placeholder="Type something" onInput={input} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() } }} />
  )
}

function MentionPicker({ taken, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      api(`/users/friends?q=${encodeURIComponent(q.trim())}`)
        .then((friends) => { if (active) setList(friends) })
        .catch((err) => { if (active) setError(err.message) })
    }, q ? 200 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [q])
  return (
    <div className="story-mention-pick" role="dialog" aria-label="Mention a friend" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header>
        <strong>Mention a friend</strong>
        <button type="button" className="story-tool story-tool-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <label className="story-mention-search">
        <MagnifyingGlass size={16} />
        <span className="sr-only">Search friends</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" autoFocus maxLength={80} />
      </label>
      {error && <p className="story-mention-note" role="alert">{error}</p>}
      {!list && !error && <p className="story-mention-note">Loading friends…</p>}
      {list && list.length === 0 && (
        <p className="story-mention-note">{q ? 'No friend with that name.' : 'You can mention friends: people you follow who follow you back.'}</p>
      )}
      {list && list.length > 0 && (
        <ul>
          {list.map((friend) => (
            <li key={friend.id}>
              <button type="button" onClick={() => onPick(friend)} disabled={taken.has(friend.id)}>
                <Avatar name={friend.name} src={friend.avatar_url} size="sm" />
                <span><strong>{friend.name}</strong><small>{taken.has(friend.id) ? 'Already mentioned' : friend.institution || 'Friend'}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const AUDIENCES = [
  { key: 'followers', label: 'Followers', icon: Globe, help: 'Everyone who follows you' },
  { key: 'friends', label: 'Friends', icon: UsersThree, help: 'Only followers you follow back' },
]

function StoryComposer({ me, onClose, onShared }) {
  const [media, setMedia] = useState(null)
  const [background, setBackground] = useState(BACKGROUND_KEYS[0])
  const [layers, setLayers] = useState([])
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [drag, setDrag] = useState(null)
  const [state, setState] = useState({ busy: false, loading: false, error: '' })
  const frameRef = useRef(null)
  const fileRef = useRef(null)
  const dragRef = useRef(null)
  const mediaRef = useRef(null)
  useOverlayLock()

  useEffect(() => () => { if (mediaRef.current?.kind === 'video') URL.revokeObjectURL(mediaRef.current.src) }, [])

  const current = layers.find((layer) => layer.id === selected)
  const written = layers.filter((layer) => layer.type === 'mention' || layer.text.trim())
  const parts = media?.kind === 'video' ? splitParts(Math.min(media.duration, MAX_VIDEO_SECONDS)) : []

  const finish = useCallback(() => {
    setEditing(null)
    setSelected(null)
    setLayers((list) => list.filter((layer) => layer.type !== 'text' || layer.text.trim()))
  }, [])

  const close = useCallback(() => {
    if (state.busy) return
    if ((media || layers.some((layer) => layer.type === 'mention' || layer.text.trim())) && !window.confirm('Discard this story?')) return
    onClose()
  }, [state.busy, media, layers, onClose])

  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape') return
      if (mentionOpen) setMentionOpen(false)
      else if (selected) finish()
      else close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mentionOpen, selected, finish, close])

  const patch = (change) => setLayers((list) => list.map((layer) => (layer.id === selected ? { ...layer, ...change } : layer)))

  const addText = (y = 0.42) => {
    const id = newLayerId()
    setLayers((list) => [...list.filter((layer) => layer.type !== 'text' || layer.text.trim()), { id, type: 'text', text: '', x: 0.5, y, color: '#ffffff', size: 0.075, label: false }])
    setEditing(id)
    setSelected(id)
    setMentionOpen(false)
  }

  const addMention = (friend) => {
    const id = newLayerId()
    setLayers((list) => [...list.filter((layer) => layer.type !== 'text' || layer.text.trim()), { id, type: 'mention', user_id: friend.id, name: friend.name, x: 0.5, y: 0.62, color: '#ffffff', size: 0.06, label: true }])
    setEditing(null)
    setSelected(id)
    setMentionOpen(false)
  }

  const removeLayer = (id) => {
    setLayers((list) => list.filter((layer) => layer.id !== id))
    if (selected === id) setSelected(null)
    if (editing === id) setEditing(null)
  }

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const video = VIDEO_TYPES.test(file.type)
    if (!video && !IMAGE_TYPES.test(file.type)) return setState({ busy: false, loading: false, error: 'Choose a photo (JPEG, PNG, GIF, WebP) or a video (MP4, MOV, WebM)' })
    if (video && file.size > MAX_VIDEO) return setState({ busy: false, loading: false, error: 'Videos must be 40 MB or smaller' })
    if (!video && file.size > 20 * 1024 * 1024) return setState({ busy: false, loading: false, error: 'This photo is too large. Choose one under 20 MB.' })
    setState({ busy: false, loading: true, error: '' })
    try {
      const next = video ? await readVideo(file) : await readImage(file)
      if (video && next.duration > MAX_VIDEO_SECONDS + 0.5) {
        URL.revokeObjectURL(next.src)
        return setState({ busy: false, loading: false, error: `Videos can be up to ${MAX_VIDEO_SECONDS} seconds. This one is ${clock(next.duration)}.` })
      }
      if (mediaRef.current?.kind === 'video') URL.revokeObjectURL(mediaRef.current.src)
      mediaRef.current = next
      setMedia(next)
      setState({ busy: false, loading: false, error: '' })
    } catch (err) {
      setState({ busy: false, loading: false, error: err.message })
    }
    return undefined
  }

  const removeMedia = () => {
    if (mediaRef.current?.kind === 'video') URL.revokeObjectURL(mediaRef.current.src)
    mediaRef.current = null
    setMedia(null)
  }

  const stageClick = (e) => {
    if (e.target.closest('.story-layer, .story-tool, .story-colors, .story-size, .story-mention-pick, .story-gallery')) return
    if (mentionOpen) { setMentionOpen(false); return }
    if (selected) { finish(); return }
    const rect = frameRef.current.getBoundingClientRect()
    addText(clamp((e.clientY - rect.top) / rect.height, 0.12, 0.88))
  }

  const layerDown = (e, layer) => {
    if (editing === layer.id) return
    e.preventDefault()
    e.stopPropagation()
    const rect = frameRef.current.getBoundingClientRect()
    dragRef.current = {
      id: layer.id, rect, sx: e.clientX, sy: e.clientY, moved: false, overTrash: false,
      dx: layer.x - (e.clientX - rect.left) / rect.width, dy: layer.y - (e.clientY - rect.top) / rect.height,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const layerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
    if (!d.moved) {
      d.moved = true
      if (editing && editing !== d.id) { setEditing(null); setLayers((list) => list.filter((layer) => layer.type !== 'text' || layer.text.trim() || layer.id === d.id)) }
    }
    const x = clamp((e.clientX - d.rect.left) / d.rect.width + d.dx, 0.05, 0.95)
    const y = clamp((e.clientY - d.rect.top) / d.rect.height + d.dy, 0.04, 0.96)
    d.overTrash = e.clientY > d.rect.bottom - 96 && Math.abs(e.clientX - (d.rect.left + d.rect.width / 2)) < 56
    setDrag({ id: d.id, overTrash: d.overTrash })
    setLayers((list) => list.map((layer) => (layer.id === d.id ? { ...layer, x, y } : layer)))
  }

  const layerUp = (layer) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (d.moved) {
      if (d.overTrash) removeLayer(d.id)
      return
    }
    setLayers((list) => list.filter((item) => item.type !== 'text' || item.text.trim() || item.id === layer.id))
    setSelected(layer.id)
    setEditing(layer.type === 'text' ? layer.id : null)
    setMentionOpen(false)
  }

  const layerKey = (e, layer) => {
    if (editing === layer.id) return
    const step = e.shiftKey ? 0.05 : 0.01
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(layer.id); return }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelected(layer.id)
      setEditing(layer.type === 'text' ? layer.id : null)
      return
    }
    if (!moves[e.key]) return
    e.preventDefault()
    const [mx, my] = moves[e.key]
    setLayers((list) => list.map((item) => (item.id === layer.id ? { ...item, x: clamp(item.x + mx, 0.05, 0.95), y: clamp(item.y + my, 0.04, 0.96) } : item)))
  }

  const share = async (audience = 'followers') => {
    const overlay = written.map((layer) => (layer.type === 'mention'
      ? { type: 'mention', user_id: layer.user_id, x: layer.x, y: layer.y, color: layer.color, size: layer.size, label: layer.label }
      : { type: 'text', text: layer.text.trim(), x: layer.x, y: layer.y, color: layer.color, size: layer.size, label: layer.label }))
    if (!media && !overlay.length) {
      setState({ busy: false, loading: false, error: 'Type something, mention a friend or add a photo or video' })
      return
    }
    setEditing(null)
    setSelected(null)
    setState({ busy: audience, loading: false, error: '' })
    try {
      const form = new FormData()
      form.append('kind', media ? media.kind : 'text')
      form.append('audience', audience)
      form.append('overlay', JSON.stringify(overlay))
      if (!media) form.append('background', background)
      if (media?.kind === 'image') form.append('media', await prepareImage(media))
      if (media?.kind === 'video') {
        form.append('duration', String(media.duration))
        form.append('media', media.file)
      }
      const result = await api('/stories', { method: 'POST', body: form })
      onShared(result?.items?.length ?? 1)
    } catch (err) {
      setState({ busy: false, loading: false, error: err.status === 404 ? 'Stories are not switched on in the server yet. Restart the SNARP backend and try again.' : err.message })
    }
  }

  const empty = !media && !layers.length
  const taken = new Set(layers.filter((layer) => layer.type === 'mention').map((layer) => layer.user_id))

  return createPortal(
    <div className="story-overlay" role="dialog" aria-modal="true" aria-label="New story">
      <div className={`story-compose ${state.busy ? 'is-busy' : ''}`}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime" hidden onChange={pick} />
        <div className="story-frame-box">
          <div ref={frameRef} className={`story-frame ${media ? `has-${media.kind}` : 'has-text'}`} style={!media ? { background: BACKGROUNDS[background] } : undefined} onClick={stageClick}>
            {media?.kind === 'image' && <>
              <img className="story-media-blur" src={media.src} alt="" aria-hidden="true" draggable={false} />
              <img className="story-media" src={media.src} alt="Your story" draggable={false} />
            </>}
            {media?.kind === 'video' && <video className="story-media" src={media.src} autoPlay muted loop playsInline aria-label="Your story video" />}
            {empty && !state.loading && <p className="story-placeholder">Tap to type</p>}
            {state.loading && <p className="story-placeholder">Opening…</p>}

            {layers.map((layer) => (
              <div key={layer.id} className={`${layerClass(layer)} is-edit ${layer.id === selected ? 'is-selected' : ''} ${drag?.id === layer.id ? 'is-dragging' : ''}`}
                style={layerStyle(layer)} tabIndex={editing === layer.id ? -1 : 0} role={editing === layer.id ? undefined : 'button'}
                aria-label={editing === layer.id ? undefined : layer.type === 'mention' ? `Mention of ${layer.name}. Drag to move.` : `Text: ${layer.text}. Press Enter to edit, drag to move.`}
                onPointerDown={(e) => layerDown(e, layer)} onPointerMove={layerMove} onPointerUp={() => layerUp(layer)} onPointerCancel={() => layerUp(layer)}
                onKeyDown={(e) => layerKey(e, layer)}>
                {editing === layer.id
                  ? <EditableText layer={layer} onText={(text) => setLayers((list) => list.map((item) => (item.id === layer.id ? { ...item, text } : item)))} onDone={finish} />
                  : <span>{layer.type === 'mention' ? `@${layer.name}` : layer.text}</span>}
              </div>
            ))}

            <div className="story-tools-top">
              <button type="button" className="story-tool" onClick={close} aria-label="Close" title="Close"><X size={20} /></button>
              <span className="story-tools-gap" />
              {current ? <>
                <button type="button" className={`story-tool story-tool-label ${current.label ? 'active' : ''}`} onClick={() => patch({ label: !current.label })}
                  aria-pressed={current.label} aria-label="Background behind text" title="Background behind text"><span>A</span></button>
                <button type="button" className="story-tool" onClick={() => removeLayer(current.id)} aria-label="Remove" title="Remove"><Trash size={18} /></button>
                <button type="button" className="story-tool story-tool-done" onClick={finish}>Done</button>
              </> : <>
                <button type="button" className="story-tool" onClick={() => addText()} aria-label="Add text" title="Add text"><TextAa size={20} weight="bold" /></button>
                <button type="button" className="story-tool" onClick={() => setMentionOpen(true)} aria-label="Mention a friend" title="Mention a friend"><At size={20} weight="bold" /></button>
                {!media && (
                  <button type="button" className="story-tool story-tool-bg" style={{ '--bg': BACKGROUNDS[background] }} title="Change background" aria-label="Change background"
                    onClick={() => setBackground((key) => BACKGROUND_KEYS[(BACKGROUND_KEYS.indexOf(key) + 1) % BACKGROUND_KEYS.length])} />
                )}
                {media && <button type="button" className="story-tool" onClick={removeMedia} aria-label={`Remove ${media.kind === 'video' ? 'video' : 'photo'}`} title={`Remove ${media.kind === 'video' ? 'video' : 'photo'}`}><Trash size={18} /></button>}
              </>}
            </div>

            {current && (
              <>
                <label className="story-size" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <span className="sr-only">Text size</span>
                  <input type="range" min="0.04" max="0.14" step="0.005" value={current.size} onChange={(e) => patch({ size: Number(e.target.value) })} />
                </label>
                <div className="story-colors" role="radiogroup" aria-label="Colour" onPointerDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
                  {TEXT_COLORS.map((color) => (
                    <button key={color} type="button" role="radio" aria-checked={current.color === color} aria-label={`Colour ${color}`}
                      className={current.color === color ? 'active' : ''} style={{ '--swatch': color }} onClick={() => patch({ color })} />
                  ))}
                </div>
              </>
            )}

            {!current && !mentionOpen && !drag && (
              <button type="button" className="story-gallery" onClick={() => fileRef.current.click()} aria-label="Add a photo or video" title="Photo or video">
                <ImageSquare size={22} />
                <span>{media ? 'Change' : 'Photo / video'}</span>
              </button>
            )}

            {drag && <span className={`story-trash ${drag.overTrash ? 'active' : ''}`} aria-hidden="true"><Trash size={22} /></span>}
            {mentionOpen && <MentionPicker taken={taken} onPick={addMention} onClose={() => setMentionOpen(false)} />}
          </div>
        </div>

        {parts.length > 0 && (
          <div className="story-parts" aria-live="polite">
            <span>{clock(media.duration)} video{parts.length > 1 ? ` · shared as ${parts.length} stories of up to 15 s` : ''}</span>
            {parts.length > 1 && <div className="story-parts-bar" aria-hidden="true">{parts.map((part) => <i key={part.start} style={{ flex: part.end - part.start }} />)}</div>}
          </div>
        )}
        {state.error && <p className="story-error" role="alert">{state.error}</p>}
        <div className="story-compose-foot">
          <span className="story-compose-note">Shown for 24 hours. <strong>Your story</strong>: all followers. <strong>Friends</strong>: only followers you follow back.</span>
          <div className="story-share-row">
            <button type="button" className="story-share" onClick={() => share('followers')} disabled={!!state.busy || state.loading} title="Share with everyone who follows you">
              <Avatar name={me.name} src={me.avatar_url} size="sm" />
              {state.busy === 'followers' ? 'Sharing…' : 'Your story'}
            </button>
            <button type="button" className="story-share story-share-friends" onClick={() => share('friends')} disabled={!!state.busy || state.loading} title="Share only with followers you follow back">
              <span className="story-friends-dot"><UsersThree size={15} weight="fill" /></span>
              {state.busy === 'friends' ? 'Sharing…' : 'Friends'}
              <PaperPlaneRight size={16} weight="fill" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StoryLayers({ story, onOpen }) {
  if (!story.overlay?.length) return null
  return (
    <div className="story-layers">
      {story.overlay.map((layer, index) => (layer.type === 'mention' ? (
        <Link key={index} to={`/users/${layer.user_id}`} className={layerClass(layer)} style={layerStyle(layer)} onClick={onOpen}
          onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span>@{layer.name}</span>
        </Link>
      ) : (
        <div key={index} className={layerClass(layer)} style={layerStyle(layer)}><span>{layer.text}</span></div>
      )))}
    </div>
  )
}

function StoryAudience({ story, onSheet }) {
  const [viewers, setViewers] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api(`/stories/${story.id}/viewers`)
      .then((list) => { if (active) setViewers(list) })
      .catch((err) => { if (active) { setViewers([]); setError(err.message) } })
    return () => { active = false }
  }, [story.id])

  const change = async (audience) => {
    if (audience === (story.audience ?? 'followers') || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api(`/stories/${story.id}/audience`, { method: 'PUT', body: { audience } })
      onSheet.changed(result.ids, result.audience)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const current = story.audience ?? 'followers'
  return (
    <div className="story-sheet" role="dialog" aria-label="Story viewers and audience" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <span className="story-sheet-grip" aria-hidden="true" />
      <header className="story-sheet-head">
        <h2><Eye size={18} /> {viewers ? viewers.length : story.view_count ?? 0} {(viewers ? viewers.length : story.view_count) === 1 ? 'viewer' : 'viewers'}</h2>
        <button type="button" className="story-sheet-close" onClick={onSheet.close} aria-label="Close"><X size={18} /></button>
      </header>
      <section className="story-sheet-audience" aria-label="Who can see this story">
        <h3>Who can see this story</h3>
        <div className="story-audience-options" role="radiogroup" aria-label="Who can see this story">
          {AUDIENCES.map(({ key, label, icon: Icon, help }) => (
            <button key={key} type="button" role="radio" aria-checked={current === key} className={current === key ? 'active' : ''} onClick={() => change(key)} disabled={busy}>
              <Icon size={18} weight={current === key ? 'fill' : 'regular'} />
              <span><strong>{label}</strong><small>{help}</small></span>
              {current === key && <Check size={16} weight="bold" className="story-audience-check" />}
            </button>
          ))}
        </div>
        {story.parts > 1 && <p className="story-sheet-note">Applies to all {story.parts} parts of this video.</p>}
      </section>
      {error && <p className="story-sheet-error" role="alert">{error}</p>}
      <ul className="story-viewer-list">
        {viewers === null && [0, 1, 2].map((i) => <li key={i} aria-hidden="true"><span className="avatar avatar-sm skeleton" /><span className="skeleton skeleton-line" /></li>)}
        {viewers?.length === 0 && <li className="story-viewer-empty">No one has seen this story yet.</li>}
        {viewers?.map((viewer) => (
          <li key={viewer.id}>
            <Link to={`/users/${viewer.id}`} onClick={onSheet.leave}>
              <Avatar name={viewer.name} src={viewer.avatar_url} size="sm" />
              <span><strong>{viewer.name}</strong><small>{timeAgo(viewer.viewed_at)}</small></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StoryViewer({ groups, start, onClose, onSeen, onDeleted, onAudience }) {
  const [at, setAt] = useState({ group: start, item: 0 })
  const [held, setHeld] = useState(false)
  const [sheet, setSheet] = useState(false)
  const paused = held || sheet
  const [progress, setProgress] = useState(0)
  const [muted, setMuted] = useState(false)
  const group = groups[at.group]
  const story = group?.items[at.item]
  const elapsed = useRef(0)
  const videoRef = useRef(null)
  useOverlayLock()

  const go = useCallback((target) => {
    elapsed.current = 0
    setProgress(0)
    if (target) setAt(target)
    else onClose()
  }, [onClose])

  const next = useCallback(() => {
    if (at.item + 1 < groups[at.group].items.length) go({ group: at.group, item: at.item + 1 })
    else if (at.group + 1 < groups.length) go({ group: at.group + 1, item: 0 })
    else go(null)
  }, [groups, at, go])

  const prev = useCallback(() => {
    if (at.item > 0) go({ group: at.group, item: at.item - 1 })
    else if (at.group > 0) go({ group: at.group - 1, item: groups[at.group - 1].items.length - 1 })
    else go(at)
  }, [groups, at, go])

  useEffect(() => {
    if (story && !story.seen) onSeen(group.user.id, story.id)
  }, [story, group, onSeen])

  // Each part of a video plays its own 15 second window of the same file.
  useEffect(() => {
    const video = videoRef.current
    if (!video || story?.kind !== 'video') return
    const inside = video.currentTime >= story.clip_start && video.currentTime < story.clip_end - 0.1
    if (video.readyState >= 1 && !inside) video.currentTime = story.clip_start
  }, [story])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, story])

  useEffect(() => {
    if (!story || paused) return undefined
    if (story.kind === 'video') {
      const video = videoRef.current
      if (!video) return undefined
      let frame = 0
      const tick = () => {
        const length = Math.max(0.1, story.clip_end - story.clip_start)
        setProgress(clamp((video.currentTime - story.clip_start) / length, 0, 1))
        if (video.ended || video.currentTime >= story.clip_end - 0.05) { next(); return }
        frame = requestAnimationFrame(tick)
      }
      video.play().catch(() => {
        video.muted = true
        setMuted(true)
        video.play().catch(() => {})
      })
      frame = requestAnimationFrame(tick)
      return () => { cancelAnimationFrame(frame); video.pause() }
    }
    const startedAt = Date.now() - elapsed.current
    const timer = setInterval(() => {
      elapsed.current = Date.now() - startedAt
      const value = Math.min(1, elapsed.current / PHOTO_MS)
      setProgress(value)
      if (value >= 1) next()
    }, 50)
    return () => clearInterval(timer)
  }, [story, paused, next])

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { if (sheet) setSheet(false); else onClose() }
      if (sheet) return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [next, prev, onClose, sheet])

  if (!story) return null

  const remove = async () => {
    const what = story.parts > 1 ? `this part (${story.part} of ${story.parts})` : 'this story'
    if (!window.confirm(`Delete ${what}?`)) return
    try {
      await api(`/stories/${story.id}`, { method: 'DELETE' })
      onDeleted(story.id)
    } catch (err) {
      window.alert(err.message)
    }
  }

  const label = story.kind === 'text'
    ? story.overlay?.filter((layer) => layer.type === 'text').map((layer) => layer.text).join(' ') || `Story from ${group.user.name}`
    : story.caption || `Story from ${group.user.name}`

  return createPortal(
    <div className="story-overlay" role="dialog" aria-modal="true" aria-label={`${group.user.name}'s story`}>
      <div className="story-view" onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)}>
        <div className={`story-frame has-${story.kind}`} style={story.kind === 'text' ? { background: BACKGROUNDS[story.background] ?? BACKGROUNDS.night } : undefined}>
          {story.kind === 'image' && <>
            <img key={`blur-${story.id}`} className="story-media-blur" src={story.image_url} alt="" aria-hidden="true" draggable={false} />
            <img key={story.id} className="story-media" src={story.image_url} alt={label} draggable={false} />
          </>}
          {story.kind === 'video' && (
            <video key={story.media_url} ref={videoRef} className="story-media" src={story.media_url} playsInline preload="auto" aria-label={label}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = story.clip_start }} />
          )}
          {story.kind === 'text' && <span className="sr-only">{label}</span>}
          <StoryLayers story={story} onOpen={onClose} />
        </div>
        <div className="story-bars" aria-hidden="true">
          {group.items.map((item, i) => (
            <span key={item.id}><i style={{ transform: `scaleX(${i < at.item ? 1 : i === at.item ? progress : 0})` }} /></span>
          ))}
        </div>
        <header className="story-view-head">
          <Link to={`/users/${group.user.id}`} className="story-view-who" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
            <Avatar name={group.user.name} src={group.user.avatar_url} size="sm" />
            <strong>{group.mine ? 'Your story' : group.user.name}</strong>
            <time dateTime={story.created_at}>{timeAgo(story.created_at)}</time>
          </Link>
          {story.audience === 'friends' && <span className="story-friends-badge" title={group.mine ? 'Only followers you follow back can see this' : 'Shared with friends only'}><UsersThree size={13} weight="fill" /> Friends</span>}
          {story.kind === 'video' && (
            <button type="button" className="story-icon" onClick={() => setMuted((value) => !value)} onPointerDown={(e) => e.stopPropagation()} aria-label={muted ? 'Turn sound on' : 'Mute'}>
              {muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
            </button>
          )}
          {group.mine && <button type="button" className="story-icon" onClick={remove} onPointerDown={(e) => e.stopPropagation()} aria-label="Delete story"><Trash size={20} /></button>}
          <button type="button" className="story-icon" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close"><X size={22} /></button>
        </header>
        {story.caption && <p className="story-caption">{story.caption}</p>}
        {group.mine && !sheet && (
          <button type="button" className="story-views" onClick={() => setSheet(true)} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
            aria-haspopup="dialog" title="See who viewed this and who can see it">
            <Eye size={16} /> {story.view_count ?? 0} {story.view_count === 1 ? 'view' : 'views'}
            <span className="story-views-sep" aria-hidden="true">·</span>
            {(story.audience ?? 'followers') === 'friends' ? <UsersThree size={15} weight="fill" /> : <Globe size={15} />}
            {(story.audience ?? 'followers') === 'friends' ? 'Friends' : 'Followers'}
          </button>
        )}
        {group.mine && sheet && (
          <StoryAudience key={story.id} story={story} onSheet={{ close: () => setSheet(false), leave: onClose, changed: onAudience }} />
        )}
        <button type="button" className="story-tap story-tap-prev" onClick={prev} aria-label="Previous story" />
        <button type="button" className="story-tap story-tap-next" onClick={next} aria-label="Next story" />
      </div>
      <button type="button" className="story-step story-step-prev" onClick={prev} aria-label="Previous"><CaretLeft size={20} weight="bold" /></button>
      <button type="button" className="story-step story-step-next" onClick={next} aria-label="Next"><CaretRight size={20} weight="bold" /></button>
    </div>,
    document.body,
  )
}

export default function Stories({ me }) {
  const [groups, setGroups] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [composing, setComposing] = useState(false)
  const [notice, setNotice] = useState('')
  const [params, setParams] = useSearchParams()
  const storyParam = params.get('story')

  const load = useCallback(() => api('/stories').then(setGroups).catch(() => setGroups([])), [])
  useEffect(() => { load() }, [load])

  const mine = groups?.find((group) => group.mine)
  const others = groups?.filter((group) => !group.mine) ?? []
  const ordered = mine ? [mine, ...others] : others

  // Opening /?story=<user id> (from a mention notification) jumps straight to that person's story.
  useEffect(() => {
    if (!storyParam || !groups) return
    const index = [...groups.filter((group) => group.mine), ...groups.filter((group) => !group.mine)].findIndex((group) => String(group.user.id) === storyParam)
    if (index >= 0) setTimeout(() => setViewing(index), 0)
    setParams((current) => { const nextParams = new URLSearchParams(current); nextParams.delete('story'); return nextParams }, { replace: true })
  }, [storyParam, groups, setParams])

  const markSeen = useCallback((userId, storyId) => {
    api(`/stories/${storyId}/view`, { method: 'POST' }).catch(() => {})
    setGroups((current) => current.map((group) => {
      if (String(group.user.id) !== String(userId)) return group
      const items = group.items.map((item) => item.id === storyId ? { ...item, seen: true } : item)
      return { ...group, items, all_seen: group.mine || items.every((item) => item.seen) }
    }))
  }, [])

  const deleted = (storyId) => {
    setViewing(null)
    setGroups((current) => current.map((group) => ({ ...group, items: group.items.filter((item) => item.id !== storyId) })).filter((group) => group.items.length))
  }

  const audienceChanged = useCallback((ids, audience) => {
    const changed = new Set(ids.map(String))
    setGroups((current) => current.map((group) => (group.mine
      ? { ...group, items: group.items.map((item) => (changed.has(String(item.id)) ? { ...item, audience } : item)) }
      : group)))
  }, [])

  const shared = (count) => {
    setComposing(false)
    setNotice(count > 1 ? `Shared as ${count} stories` : 'Added to your story')
    setTimeout(() => setNotice(''), 3000)
    load()
  }

  const openAt = (group) => setViewing(ordered.indexOf(group))

  return (
    <section className="stories" aria-labelledby="stories-title">
      <h2 id="stories-title" className="stories-title">Stories</h2>
      <ul className="stories-row">
        <li>
          <div className="story-me">
            <button type="button" className={`story-ring ${mine ? 'story-ring-mine' : 'story-ring-none'}`} onClick={() => (mine ? openAt(mine) : setComposing(true))}
              aria-label={mine ? 'View your story' : 'Add to your story'}>
              <Avatar name={me.name} src={me.avatar_url} />
            </button>
            <button type="button" className="story-add" onClick={() => setComposing(true)} aria-label="Add a new story" title="Add story">
              <Plus size={12} weight="bold" />
            </button>
          </div>
          <span className="story-name">{mine ? 'Your story' : 'Add Story'}</span>
        </li>
        {groups === null && [0, 1, 2, 3].map((i) => (
          <li key={i} aria-hidden="true"><span className="story-ring story-ring-none"><span className="avatar skeleton" /></span><span className="story-name skeleton skeleton-line" /></li>
        ))}
        {others.map((group) => (
          <li key={group.user.id}>
            <button type="button" className={`story-ring ${group.all_seen ? 'story-ring-seen' : ''}`} onClick={() => openAt(group)}
              aria-label={`${group.user.name}'s story${group.all_seen ? '' : ', new'}`}>
              <Avatar name={group.user.name} src={group.user.avatar_url} />
            </button>
            <span className="story-name">{firstName(group.user.name)}</span>
          </li>
        ))}
      </ul>
      {groups && others.length === 0 && <p className="stories-empty">Stories from people you follow show up here for 24 hours.</p>}
      {notice && <p className="stories-notice" role="status">{notice}</p>}
      {composing && <StoryComposer me={me} onClose={() => setComposing(false)} onShared={shared} />}
      {viewing !== null && ordered[viewing] && (
        <StoryViewer groups={ordered} start={viewing} onClose={() => { setViewing(null) }} onSeen={markSeen} onDeleted={deleted} onAudience={audienceChanged} />
      )}
    </section>
  )
}

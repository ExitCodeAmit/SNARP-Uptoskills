import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, CaretDown, Check, CornersOut, FilmReel, ImageSquare, MagnifyingGlass, MagnifyingGlassPlus,
  MapPin, Smiley, SpeakerHigh, SpeakerSlash, Trash, UserPlus, X,
} from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from './ui'
import { Overlay } from './Overlay'
import {
  clock, cropRatio, DEFAULT_CROP, drawCover, filmstrip, filterCss, layoutFrame, REEL_ASPECTS, REEL_FILTERS,
  REEL_MAX_SECONDS, REEL_MIN_SECONDS, seekTo,
} from '../reel-media'

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const SOURCE_MAX_SECONDS = 900
const CAPTION_MAX = 2200
const TAG_LIMIT = 20
const EMOJI = ['😀', '😂', '😍', '🥰', '😎', '🤩', '🥳', '😮', '😢', '🙏', '👏', '🙌', '🔥', '💯', '✨', '🎉',
  '❤️', '💙', '💚', '💛', '👍', '👀', '🤯', '🤔', '📚', '🔬', '🧪', '🧬', '💡', '🧠', '🎓', '📈', '🚀', '🌍', '☕', '🎥']
const TITLES = { select: 'Create new reel', crop: 'Crop', edit: 'Edit', share: 'New reel', sharing: 'Sharing', done: 'Reel shared' }

// The visible part of a reel inside a 9:16 frame: crop box, zoom, position and filter, all done in CSS.
export function ReelFrame({ crop = DEFAULT_CROP, natural, filter = 'none', className = '', children, ...rest }) {
  const ratio = cropRatio(crop.aspect, natural)
  const style = {
    '--box-a': ratio ?? 0.5625,
    '--fx': `${crop.x * 100}%`,
    '--fy': `${crop.y * 100}%`,
    '--zoom': crop.zoom,
    '--filter': filterCss(filter),
  }
  return (
    <div className={`reel-frame ${ratio ? '' : 'full'} ${className}`} style={style} {...rest}>
      <div className="reel-frame-box">{children}</div>
    </div>
  )
}

function readVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const done = () => resolve({ url, duration: Number.isFinite(video.duration) ? video.duration : null, width: video.videoWidth, height: video.videoHeight })
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) return done()
      video.currentTime = 1e7
      video.ontimeupdate = () => { video.ontimeupdate = null; done() }
    }
    video.onerror = () => resolve({ url, duration: null, width: 0, height: 0, broken: true })
    video.src = url
  })
}

function uploadToImageKit(file, auth, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('fileName', file.name.replace(/[^\w.-]+/g, '-').slice(-80) || 'reel.mp4')
    form.append('publicKey', auth.publicKey)
    form.append('signature', auth.signature)
    form.append('expire', String(auth.expire))
    form.append('token', auth.token)
    form.append('folder', auth.folder)
    form.append('useUniqueFileName', 'true')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', 'https://upload.imagekit.io/api/v1/files/upload')
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    xhr.onload = () => {
      let data = null
      try { data = JSON.parse(xhr.responseText) } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.fileId) resolve(data)
      else reject(new Error(data?.message || 'The video could not be uploaded. Please try again.'))
    }
    xhr.onerror = () => reject(new Error('The video could not be uploaded. Check your connection and try again.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }))
    if (signal.aborted) return reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That photo could not be opened'))
    image.src = url
  })
}

function Switch({ checked, onChange, label, help }) {
  return (
    <label className="studio-switch-row">
      <span>
        <strong>{label}</strong>
        {help && <small>{help}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="studio-switch" aria-hidden="true" />
    </label>
  )
}

function Section({ title, icon: Icon, open, onToggle, children }) {
  return (
    <section className={`studio-section ${open ? 'open' : ''}`}>
      <button type="button" className="studio-section-head" onClick={onToggle} aria-expanded={open}>
        {Icon && <Icon size={20} />}
        <span>{title}</span>
        <CaretDown size={16} className="studio-caret" />
      </button>
      {open && <div className="studio-section-body">{children}</div>}
    </section>
  )
}

function TagPeople({ tags, onChange, viewerId }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  useEffect(() => {
    const q = query.trim()
    if (!q) return undefined
    let active = true
    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(q)}`)
        .then((list) => { if (active) setResults(list.filter((person) => String(person.id) !== String(viewerId))) })
        .catch(() => { if (active) setResults([]) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query, viewerId])
  const add = (person) => {
    if (!tags.some((tag) => tag.id === person.id) && tags.length < TAG_LIMIT) {
      onChange([...tags, { id: person.id, name: person.name, avatar_url: person.profile_image_id ? `/api/images/${person.profile_image_id}` : null }])
    }
    setQuery('')
    setResults([])
  }
  return (
    <div className="studio-tags">
      {tags.length > 0 && (
        <ul className="studio-tag-chips">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Avatar name={tag.name} src={tag.avatar_url} size="sm" />
              <span>{tag.name}</span>
              <button type="button" onClick={() => onChange(tags.filter((item) => item.id !== tag.id))} aria-label={`Remove ${tag.name}`}><X size={12} weight="bold" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="studio-input">
        <MagnifyingGlass size={16} />
        <span className="sr-only">Search people to tag</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tags.length >= TAG_LIMIT ? 'You can tag up to 20 people' : 'Search people'} disabled={tags.length >= TAG_LIMIT} maxLength={80} />
      </label>
      {query.trim() && results.length > 0 && (
        <ul className="studio-tag-results">
          {results.slice(0, 6).map((person) => (
            <li key={person.id}>
              <button type="button" onClick={() => add(person)} disabled={tags.some((tag) => tag.id === person.id)}>
                <Avatar name={person.name} src={person.profile_image_id ? `/api/images/${person.profile_image_id}` : null} size="sm" />
                <span><strong>{person.name}</strong><small>{person.institution || person.department || 'SNARP member'}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ReelStudio({ viewer, onClose, onPublished }) {
  const [config, setConfig] = useState(null)
  const [step, setStep] = useState('select')
  const [media, setMedia] = useState(null)
  const [crop, setCrop] = useState(DEFAULT_CROP)
  const [filter, setFilter] = useState('none')
  const [audioMuted, setAudioMuted] = useState(false)
  const [trim, setTrim] = useState({ start: 0, end: 0 })
  const [coverTime, setCoverTime] = useState(0)
  const [customCover, setCustomCover] = useState(null)
  const [hold, setHold] = useState(null)
  const [frames, setFrames] = useState(null)
  const [editTab, setEditTab] = useState('edit')
  const [popover, setPopover] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [caption, setCaption] = useState('')
  const [location, setLocation] = useState('')
  const [altText, setAltText] = useState('')
  const [tags, setTags] = useState([])
  const [hideCounts, setHideCounts] = useState(false)
  const [commentsOff, setCommentsOff] = useState(false)
  const [openSection, setOpenSection] = useState(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [upload, setUpload] = useState({ progress: 0 })
  const [shareProgress, setShareProgress] = useState(0)
  const [askDiscard, setAskDiscard] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const stageRef = useRef(null)
  const playheadRef = useRef(null)
  const uploadRef = useRef(null)
  const captionRef = useRef(null)
  const dragRef = useRef(null)
  const emojiRef = useRef(null)

  useEffect(() => {
    let active = true
    api('/reels/config').then((value) => { if (active) setConfig(value) }).catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [])
  useEffect(() => () => { if (media?.url) URL.revokeObjectURL(media.url) }, [media])
  useEffect(() => () => { if (customCover?.url) URL.revokeObjectURL(customCover.url) }, [customCover])
  useEffect(() => () => uploadRef.current?.controller.abort(), [])

  // The emoji picker closes on a click outside it or on Escape (without closing the studio).
  useEffect(() => {
    if (!emojiOpen) return undefined
    const outside = (event) => { if (!emojiRef.current?.contains(event.target)) setEmojiOpen(false) }
    const key = (event) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setEmojiOpen(false) } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true) }
  }, [emojiOpen])

  // Preview playback: loop the trimmed part, or hold one frame while the cover is being picked.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !media) return undefined
    if (hold !== null) {
      video.pause()
      video.currentTime = hold
      return undefined
    }
    if (video.currentTime < trim.start || video.currentTime > trim.end) video.currentTime = trim.start
    video.play().catch(() => {})
    let frame = 0
    const tick = () => {
      if (video.currentTime >= trim.end - 0.03 || video.currentTime < trim.start - 0.25) video.currentTime = trim.start
      if (playheadRef.current && media.duration) playheadRef.current.style.left = `${(video.currentTime / media.duration) * 100}%`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [hold, trim.start, trim.end, media, step])

  const startUpload = useCallback((file) => {
    uploadRef.current?.controller.abort()
    const controller = new AbortController()
    setUpload({ progress: 0 })
    const promise = api('/reels/upload-auth')
      .then((auth) => uploadToImageKit(file, auth, (value) => setUpload((current) => ({ ...current, progress: value })), controller.signal))
      .then((result) => { setUpload({ progress: 1, fileId: result.fileId }); return result.fileId })
    promise.catch((err) => { if (err.name !== 'AbortError') setUpload({ progress: 0, error: err.message }) })
    uploadRef.current = { controller, promise }
  }, [])

  const choose = async (file) => {
    if (!file) return
    setError('')
    if (!VIDEO_TYPES.includes(file.type)) return setError('Choose an MP4, WebM or MOV video.')
    if (config && file.size > config.max_bytes) return setError('Videos must be 100 MB or smaller.')
    const info = await readVideo(file)
    if (info.broken || !info.width) {
      URL.revokeObjectURL(info.url)
      return setError('This video could not be played in your browser. Try an MP4 file.')
    }
    if (info.duration != null && info.duration > SOURCE_MAX_SECONDS + 1) {
      URL.revokeObjectURL(info.url)
      return setError(`This video is ${clock(info.duration)} long. Choose a video of 15 minutes or less.`)
    }
    if (info.duration != null && info.duration < REEL_MIN_SECONDS) {
      URL.revokeObjectURL(info.url)
      return setError('Reels must be at least 1 second long.')
    }
    const duration = info.duration ?? REEL_MAX_SECONDS
    setMedia({ file, ...info, duration })
    setCrop({ ...DEFAULT_CROP, aspect: info.height > info.width ? '9:16' : 'original' })
    setTrim({ start: 0, end: Math.min(duration, REEL_MAX_SECONDS) })
    setCoverTime(0)
    setFrames(null)
    setStep('crop')
    startUpload(file)
    filmstrip(info.url, 10).then(setFrames).catch(() => setFrames([]))
  }

  const natural = media ? { width: media.width, height: media.height } : null
  const hasWork = !!media && step !== 'done'
  const requestClose = () => {
    if (step === 'sharing') return
    if (hasWork) setAskDiscard(true)
    else onClose()
  }
  const discard = () => {
    uploadRef.current?.controller.abort()
    onClose()
  }

  // Crop: drag the picture to reposition it inside the box.
  const overflow = () => {
    const stage = stageRef.current
    if (!stage || !media) return { x: 0, y: 0 }
    const { width, height } = stage.getBoundingClientRect()
    const { box, draw } = layoutFrame(media.width, media.height, crop, width, height)
    return { x: draw.w - box.w, y: draw.h - box.h }
  }
  const panStart = (event) => {
    if (step !== 'crop' || event.button > 0) return
    setPopover(null)
    const room = overflow()
    if (room.x < 1 && room.y < 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, crop, room }
    setDragging(true)
  }
  const panMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const clamp = (value) => Math.min(1, Math.max(0, value))
    setCrop({
      ...drag.crop,
      x: drag.room.x >= 1 ? clamp(drag.crop.x - (event.clientX - drag.x) / drag.room.x) : drag.crop.x,
      y: drag.room.y >= 1 ? clamp(drag.crop.y - (event.clientY - drag.y) / drag.room.y) : drag.crop.y,
    })
  }
  const panEnd = () => { dragRef.current = null; setDragging(false) }

  const setTrimStart = (value) => {
    const start = Math.min(value, trim.end - REEL_MIN_SECONDS)
    const end = Math.min(trim.end, start + REEL_MAX_SECONDS)
    setTrim({ start: Math.max(0, start), end })
    setCoverTime((current) => Math.min(Math.max(current, start), end))
  }
  const setTrimEnd = (value) => {
    const end = Math.max(value, trim.start + REEL_MIN_SECONDS)
    const start = Math.max(trim.start, end - REEL_MAX_SECONDS)
    setTrim({ start, end: Math.min(media.duration, end) })
    setCoverTime((current) => Math.min(Math.max(current, start), end))
  }

  const pickCoverPhoto = (file) => {
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return setError('Cover photos must be JPEG, PNG or WebP images.')
    if (file.size > 10 * 1024 * 1024) return setError('Cover photos must be 10 MB or smaller.')
    setError('')
    setCustomCover({ file, url: URL.createObjectURL(file) })
  }

  const insertEmoji = (emoji) => {
    const input = captionRef.current
    const start = input?.selectionStart ?? caption.length
    const end = input?.selectionEnd ?? caption.length
    const next = (caption.slice(0, start) + emoji + caption.slice(end)).slice(0, CAPTION_MAX)
    setCaption(next)
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length) })
  }

  const makeCover = async () => {
    if (customCover) {
      const image = await loadImage(customCover.url)
      return drawCover(image, image.naturalWidth, image.naturalHeight, { ...DEFAULT_CROP, aspect: '9:16' }, 'none')
    }
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = media.url
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject })
    await seekTo(video, coverTime)
    const blob = await drawCover(video, video.videoWidth, video.videoHeight, crop, filter)
    video.removeAttribute('src')
    video.load()
    return blob
  }

  const share = async () => {
    setError('')
    setStep('sharing')
    setShareProgress(0)
    try {
      if (upload.error) startUpload(media.file)
      const cover = await makeCover().catch(() => null)
      const fileId = await uploadRef.current.promise
      setShareProgress(1)
      const form = new FormData()
      form.append('fileId', fileId)
      form.append('caption', caption)
      form.append('trimStart', String(Math.round(trim.start * 1000) / 1000))
      if (trim.end < media.duration - 0.05) form.append('trimEnd', String(Math.round(trim.end * 1000) / 1000))
      form.append('crop', JSON.stringify(crop))
      form.append('filter', filter)
      form.append('audioMuted', String(audioMuted))
      form.append('tags', JSON.stringify(tags.map((tag) => tag.id)))
      form.append('altText', altText)
      form.append('location', location)
      form.append('hideCounts', String(hideCounts))
      form.append('commentsOff', String(commentsOff))
      if (cover) form.append('cover', cover, 'cover.jpg')
      const reel = await api('/reels', { method: 'POST', body: form })
      uploadRef.current = null
      onPublished(reel)
      setStep('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message)
      setStep('share')
    }
  }

  const back = () => {
    setError('')
    setPopover(null)
    setHold(null)
    if (step === 'crop') setAskDiscard(true)
    if (step === 'edit') setStep('crop')
    if (step === 'share') setStep('edit')
  }
  const next = () => {
    setError('')
    setPopover(null)
    setHold(null)
    if (step === 'crop') setStep('edit')
    else if (step === 'edit') setStep('share')
    else if (step === 'share') share()
  }

  const progress = step === 'sharing' ? Math.max(shareProgress, upload.progress) : upload.progress
  const length = trim.end - trim.start
  const wide = step === 'edit' || step === 'share'
  const pct = (time) => `${(time / (media?.duration || 1)) * 100}%`
  const filterFrame = frames?.[Math.min(frames.length - 1, 4)]

  const stage = media && step !== 'sharing' && step !== 'done' && (
    <div
      ref={stageRef}
      className={`studio-stage ${step === 'crop' ? 'cropping' : ''} ${dragging ? 'dragging' : ''}`}
      onPointerDown={panStart}
      onPointerMove={panMove}
      onPointerUp={panEnd}
      onPointerCancel={panEnd}
    >
      <ReelFrame crop={crop} natural={natural} filter={filter}>
        <video ref={videoRef} src={media.url} muted={audioMuted || step === 'crop'} playsInline preload="auto" />
      </ReelFrame>
      {step === 'crop' && <span className="studio-grid" aria-hidden="true" />}
      {step === 'crop' && (
        <div className="studio-crop-tools" onPointerDown={(event) => event.stopPropagation()}>
          <div className="studio-pop-anchor">
            <button type="button" className={`studio-round ${popover === 'aspect' ? 'on' : ''}`} onClick={() => setPopover(popover === 'aspect' ? null : 'aspect')} aria-label="Select crop" aria-expanded={popover === 'aspect'} title="Crop">
              <CornersOut size={18} weight="bold" />
            </button>
            {popover === 'aspect' && (
              <div className="studio-pop" role="menu">
                {REEL_ASPECTS.map((item) => (
                  <button key={item.key} type="button" role="menuitemradio" aria-checked={crop.aspect === item.key} className={crop.aspect === item.key ? 'on' : ''}
                    onClick={() => setCrop({ ...crop, aspect: item.key, x: 0.5, y: 0.5 })}>
                    <span>{item.label}</span>
                    {item.key === 'original' ? <ImageSquare size={20} /> : <span className={`studio-ratio r-${item.key.replace(':', 'x')}`} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="studio-pop-anchor">
            <button type="button" className={`studio-round ${popover === 'zoom' ? 'on' : ''}`} onClick={() => setPopover(popover === 'zoom' ? null : 'zoom')} aria-label="Zoom" aria-expanded={popover === 'zoom'} title="Zoom">
              <MagnifyingGlassPlus size={18} weight="bold" />
            </button>
            {popover === 'zoom' && (
              <div className="studio-pop studio-zoom">
                <input type="range" min="1" max="3" step="0.01" value={crop.zoom} onChange={(event) => setCrop({ ...crop, zoom: Number(event.target.value) })} aria-label="Zoom" />
              </div>
            )}
          </div>
        </div>
      )}
      {step === 'crop' && (
        <button type="button" className="studio-round studio-sound-peek" onClick={() => setAudioMuted(!audioMuted)} onPointerDown={(event) => event.stopPropagation()} aria-label={audioMuted ? 'Video sound is off' : 'Video sound is on'} title="Video sound">
          {audioMuted ? <SpeakerSlash size={18} weight="bold" /> : <SpeakerHigh size={18} weight="bold" />}
        </button>
      )}
    </div>
  )

  return (
    <Overlay className={`reel-studio ${wide ? 'wide' : ''} step-${step}`} labelledBy="reel-studio-title" onClose={requestClose}>
      <header className="studio-head">
        {['crop', 'edit', 'share'].includes(step)
          ? <button type="button" className="icon-btn" onClick={back} aria-label="Back" title="Back"><ArrowLeft size={22} /></button>
          : <span className="studio-head-spacer" />}
        <h2 id="reel-studio-title">{TITLES[step]}</h2>
        {['crop', 'edit'].includes(step) && <button type="button" className="studio-next" onClick={next}>Next</button>}
        {step === 'share' && <button type="button" className="studio-next" onClick={next}>Share</button>}
        {['select', 'done'].includes(step) && <button type="button" className="icon-btn" onClick={step === 'done' ? onClose : requestClose} aria-label="Close" title="Close"><X size={20} /></button>}
        {step === 'sharing' && <span className="studio-head-spacer" />}
      </header>

      {step === 'select' && (
        config && !config.enabled ? (
          <p className="studio-off">Reel uploads are not set up on this server yet. Ask the site owner to add the ImageKit keys.</p>
        ) : (
          <label
            className={`studio-select ${dropping ? 'dropping' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDropping(true) }}
            onDragLeave={() => setDropping(false)}
            onDrop={(event) => { event.preventDefault(); setDropping(false); choose(event.dataTransfer.files?.[0]) }}
          >
            <FilmReel size={78} weight="thin" />
            <strong>Drag videos here</strong>
            <span className="btn btn-primary">Select from computer</span>
            <small>MP4, WebM or MOV · up to 100 MB · reels play for up to 3 minutes</small>
            <input type="file" accept={VIDEO_TYPES.join(',')} className="sr-only" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = '' }} />
          </label>
        )
      )}

      {media && ['crop', 'edit', 'share'].includes(step) && (
        <div className="studio-body">
          {stage}
          {step === 'edit' && (
            <aside className="studio-side">
              <div className="studio-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={editTab === 'filters'} className={editTab === 'filters' ? 'on' : ''} onClick={() => setEditTab('filters')}>Filters</button>
                <button type="button" role="tab" aria-selected={editTab === 'edit'} className={editTab === 'edit' ? 'on' : ''} onClick={() => setEditTab('edit')}>Edit</button>
              </div>
              {editTab === 'filters' ? (
                <div className="studio-filters">
                  {REEL_FILTERS.map((item) => (
                    <button key={item.key} type="button" className={filter === item.key ? 'on' : ''} onClick={() => setFilter(item.key)} aria-pressed={filter === item.key}>
                      <span className="studio-filter-thumb" style={{ filter: item.css }}>
                        {filterFrame ? <img src={filterFrame} alt="" /> : <span className="skeleton" />}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="studio-edit">
                  <section className="studio-block">
                    <header>
                      <h3>Cover photo</h3>
                      <label className="studio-link">
                        Select from computer
                        <input type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" onChange={(event) => { pickCoverPhoto(event.target.files?.[0]); event.target.value = '' }} />
                      </label>
                    </header>
                    {customCover ? (
                      <div className="studio-custom-cover">
                        <img src={customCover.url} alt="Your cover photo" />
                        <button type="button" className="studio-link danger" onClick={() => setCustomCover(null)}><Trash size={14} /> Use a frame from the video</button>
                      </div>
                    ) : (
                      <div className="studio-strip studio-cover-strip">
                        <div className="studio-frames">{(frames ?? Array.from({ length: 10 })).map((src, i) => (src ? <img key={i} src={src} alt="" /> : <span key={i} className="skeleton" />))}</div>
                        <span className="studio-cover-dim" style={{ left: 0, width: pct(trim.start) }} />
                        <span className="studio-cover-dim" style={{ left: pct(trim.end), right: 0 }} />
                        <span className="studio-cover-pick" style={{ left: pct(coverTime) }}>{frames?.length ? <img src={frames[Math.min(frames.length - 1, Math.floor((coverTime / media.duration) * frames.length))]} alt="" /> : null}</span>
                        <input
                          type="range" min={trim.start} max={trim.end} step="0.05" value={coverTime}
                          aria-label={`Cover frame at ${clock(coverTime)}`}
                          onChange={(event) => { const value = Number(event.target.value); setCoverTime(value); setHold(value) }}
                          onPointerUp={() => setHold(null)} onKeyUp={() => setHold(null)} onBlur={() => setHold(null)}
                        />
                      </div>
                    )}
                  </section>
                  <section className="studio-block">
                    <header>
                      <h3>Trim</h3>
                      <span className="studio-trim-time">{clock(trim.start)} – {clock(trim.end)} · {length < 60 ? `${length.toFixed(1)}s` : clock(length)}</span>
                    </header>
                    <div className="studio-strip studio-trim">
                      <div className="studio-frames">{(frames ?? Array.from({ length: 10 })).map((src, i) => (src ? <img key={i} src={src} alt="" /> : <span key={i} className="skeleton" />))}</div>
                      <span className="studio-trim-dim" style={{ left: 0, width: pct(trim.start) }} />
                      <span className="studio-trim-dim" style={{ left: pct(trim.end), right: 0 }} />
                      <span className="studio-trim-window" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
                      <span className="studio-playhead" ref={playheadRef} />
                      <input type="range" className="studio-trim-start" min="0" max={media.duration} step="0.05" value={trim.start} onChange={(event) => setTrimStart(Number(event.target.value))} aria-label={`Trim start ${clock(trim.start)}`} />
                      <input type="range" className="studio-trim-end" min="0" max={media.duration} step="0.05" value={trim.end} onChange={(event) => setTrimEnd(Number(event.target.value))} aria-label={`Trim end ${clock(trim.end)}`} />
                    </div>
                    <div className="studio-trim-scale"><span>0:00</span><span>{clock(media.duration / 2)}</span><span>{clock(media.duration)}</span></div>
                    {media.duration > REEL_MAX_SECONDS && <p className="studio-note">Reels can be up to 3 minutes. Drag the handles to choose the part to share.</p>}
                  </section>
                  <section className="studio-block">
                    <Switch checked={!audioMuted} onChange={(on) => setAudioMuted(!on)} label="Video sound" help={audioMuted ? 'People will watch this reel without sound.' : 'The reel plays with its original sound.'} />
                  </section>
                </div>
              )}
            </aside>
          )}
          {step === 'share' && (
            <aside className="studio-side">
              <div className="studio-share">
                <div className="studio-me"><Avatar name={viewer.name} src={viewer.avatar_url} size="sm" /><strong>{viewer.name}</strong></div>
                <textarea ref={captionRef} className="studio-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={CAPTION_MAX} placeholder="Write a caption..." aria-label="Caption" rows={6} />
                <div className="studio-caption-bar">
                  <div className="studio-pop-anchor" ref={emojiRef}>
                    <button type="button" className="icon-btn" onClick={() => setEmojiOpen(!emojiOpen)} aria-label="Add an emoji" aria-expanded={emojiOpen} title="Emoji"><Smiley size={22} /></button>
                    {emojiOpen && (
                      <div className="studio-emoji" role="dialog" aria-label="Emoji">
                        {EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
                      </div>
                    )}
                  </div>
                  <span>{caption.length.toLocaleString('en')}/{CAPTION_MAX.toLocaleString('en')}</span>
                </div>
                <label className="studio-row-input">
                  <span className="sr-only">Add location</span>
                  <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Add location" maxLength={100} />
                  {location ? <button type="button" onClick={() => setLocation('')} aria-label="Clear location"><X size={16} /></button> : <MapPin size={20} />}
                </label>
                <Section title={tags.length ? `Tag people · ${tags.length}` : 'Tag people'} icon={UserPlus} open={openSection === 'tags'} onToggle={() => setOpenSection(openSection === 'tags' ? null : 'tags')}>
                  <TagPeople tags={tags} onChange={setTags} viewerId={viewer.id} />
                  <p className="studio-help">Tagged people get a notification and are shown on your reel.</p>
                </Section>
                <Section title="Accessibility" open={openSection === 'alt'} onToggle={() => setOpenSection(openSection === 'alt' ? null : 'alt')}>
                  <p className="studio-help">Alt text describes your reel for people with visual impairments. Screen readers read it out.</p>
                  <div className="studio-alt">
                    <img src={customCover?.url ?? filterFrame} alt="" style={customCover ? undefined : { filter: filterCss(filter) }} />
                    <input value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Write alt text..." maxLength={300} aria-label="Alt text" />
                  </div>
                </Section>
                <Section title="Advanced settings" open={openSection === 'advanced'} onToggle={() => setOpenSection(openSection === 'advanced' ? null : 'advanced')}>
                  <Switch checked={hideCounts} onChange={setHideCounts} label="Hide like and view counts on this reel" help="Only you will see the total number of likes and views. You can change this later from the ··· menu on your reel." />
                  <Switch checked={commentsOff} onChange={setCommentsOff} label="Turn off commenting" help="You can change this later from the ··· menu on your reel." />
                </Section>
              </div>
            </aside>
          )}
        </div>
      )}

      {(step === 'sharing' || step === 'done') && (
        <div className="studio-finish" aria-live="polite">
          <span className={`studio-ring ${step === 'done' ? 'done' : ''}`} style={{ '--p': step === 'done' ? 1 : progress }}>
            {step === 'done' ? <Check size={44} weight="bold" /> : <strong>{Math.round(progress * 100)}%</strong>}
          </span>
          <h3>{step === 'done' ? 'Your reel has been shared.' : 'Sharing your reel…'}</h3>
          {step === 'sharing' && <p>Keep this window open until it finishes.</p>}
          {step === 'done' && <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
      )}

      {upload.error && step !== 'sharing' && step !== 'done' && media && <p className="field-error studio-error" role="alert">Upload problem: {upload.error} It will retry when you share.</p>}
      {error && <p className="field-error studio-error" role="alert">{error}</p>}

      {askDiscard && (
        <Overlay className="studio-confirm" labelledBy="studio-discard-title" onClose={() => setAskDiscard(false)}>
          <h3 id="studio-discard-title">Discard reel?</h3>
          <p>If you leave, your edits won&apos;t be saved.</p>
          <button type="button" className="studio-confirm-danger" onClick={discard}>Discard</button>
          <button type="button" onClick={() => setAskDiscard(false)}>Cancel</button>
        </Overlay>
      )}
    </Overlay>
  )
}


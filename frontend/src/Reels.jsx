import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BookmarkSimple, CaretDown, CaretUp, ChatCircle, ChatCircleSlash, Check, DotsThree, Eye, EyeSlash, FilmReel, Heart,
  Link as LinkIcon, MagnifyingGlass, MapPin, PaperPlaneTilt, PencilSimple, Play, Plus, SpeakerHigh, SpeakerSlash,
  Trash, UserCircle, VideoCamera, X,
} from '@phosphor-icons/react'
import { api } from './api'
import { Avatar } from './components/ui'
import { Overlay } from './components/Overlay'
import { Linkify } from './components/RichText'
import ReelStudio, { ReelFrame } from './components/ReelStudio'
import { timeAgo } from './format'

const MODERATOR_ROLES = ['admin', 'moderator']
const CAPTION_MAX = 2200
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const TABS = [
  { key: 'all', label: 'For you' },
  { key: 'saved', label: 'Saved' },
  { key: 'mine', label: 'Your reels' },
]

const reelLink = (reel) => `${window.location.origin}/reels?reel=${reel.id}`

function ReelEdit({ reel, onSaved, onClose }) {
  const [caption, setCaption] = useState(reel.caption ?? '')
  const [location, setLocation] = useState(reel.location ?? '')
  const [altText, setAltText] = useState(reel.alt_text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await api(`/reels/${reel.id}`, { method: 'PATCH', body: { caption, location, altText } }))
      onClose()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Overlay className="reel-edit" labelledBy={`reel-edit-${reel.id}`} onClose={onClose}>
      <form onSubmit={save} className="reel-edit-form">
        <header className="studio-head">
          <button type="button" className="studio-cancel" onClick={onClose}>Cancel</button>
          <h2 id={`reel-edit-${reel.id}`}>Edit info</h2>
          <button className="studio-next" disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
        </header>
        <div className="reel-edit-body">
          <label className="reel-edit-field">
            <span>Caption</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={CAPTION_MAX} rows={5} />
            <small>{caption.length.toLocaleString('en')}/{CAPTION_MAX.toLocaleString('en')}</small>
          </label>
          <label className="reel-edit-field">
            <span>Location</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={100} placeholder="Add location" />
          </label>
          <label className="reel-edit-field">
            <span>Alt text</span>
            <input value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={300} placeholder="Describe this reel for people who can't see it" />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </form>
    </Overlay>
  )
}

function ReelComments({ reel, viewer, onCount, onClose }) {
  const [comments, setComments] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const canModerate = MODERATOR_ROLES.includes(viewer.role)

  useEffect(() => {
    let active = true
    api(`/reels/${reel.id}/comments`)
      .then((list) => { if (active) setComments(list) })
      .catch((err) => { if (active) { setComments([]); setError(err.message) } })
    return () => { active = false }
  }, [reel.id])

  const add = async (event) => {
    event.preventDefault()
    if (!draft.trim()) return
    setBusy(true)
    setError('')
    try {
      const comment = await api(`/reels/${reel.id}/comments`, { method: 'POST', body: { body: draft.trim() } })
      setComments((current) => [...(current ?? []), comment])
      setDraft('')
      onCount(1)
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const remove = async (comment) => {
    setError('')
    try {
      await api(`/reel-comments/${comment.id}`, { method: 'DELETE' })
      setComments((current) => current.filter((item) => item.id !== comment.id))
      onCount(-1)
    } catch (err) { setError(err.message) }
  }

  return (
    <Overlay className="comments-sheet" labelledBy={`reel-comments-${reel.id}`} onClose={onClose}>
      <span className="comments-grip" aria-hidden="true" />
      <header className="comments-sheet-head">
        <h2 id={`reel-comments-${reel.id}`}>Comments <span>{reel.comment_count}</span></h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close comments"><X size={18} /></button>
      </header>
      <div className="comments-sheet-list" ref={listRef}>
        {reel.caption && (
          <div className="comment-row comment-caption">
            <Avatar name={reel.author_name} src={reel.author_avatar_url} size="sm" />
            <div>
              <p className="comment-head">
                <Link to={`/users/${reel.user_id}`} onClick={onClose}><strong>{reel.author_name}</strong></Link>
                <time dateTime={reel.created_at}>{timeAgo(reel.created_at)}</time>
              </p>
              <p className="comment-caption-text"><Linkify text={reel.caption} /></p>
            </div>
          </div>
        )}
        {comments === null ? (
          [0, 1, 2].map((i) => <div className="comment-row" key={i} aria-hidden="true"><span className="avatar avatar-sm skeleton" /><span className="skeleton skeleton-line" /></div>)
        ) : comments.length === 0 ? (
          <p className="comments-empty"><ChatCircle size={28} /> <strong>No comments yet</strong><span>Start the conversation.</span></p>
        ) : comments.map((comment) => (
          <div className="comment-row" key={comment.id}>
            <Avatar name={comment.author_name} src={comment.author_avatar_url} size="sm" />
            <div>
              <p className="comment-head">
                <Link to={`/users/${comment.user_id}`} onClick={onClose}><strong>{comment.author_name}</strong></Link>
                <time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>
              </p>
              <p><Linkify text={comment.body} /></p>
            </div>
            {(String(comment.user_id) === String(viewer.id) || String(reel.user_id) === String(viewer.id) || canModerate) && (
              <button className="link-danger" onClick={() => remove(comment)}>{String(comment.user_id) === String(viewer.id) ? 'Delete' : 'Remove'}</button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="field-error comments-sheet-error" role="alert">{error}</p>}
      {reel.comments_off && String(reel.user_id) !== String(viewer.id) ? (
        <p className="comments-off-note"><ChatCircleSlash size={16} /> Commenting is turned off.</p>
      ) : (
      <form className="comments-sheet-form" onSubmit={add}>
        <label className="sr-only" htmlFor={`reel-comment-${reel.id}`}>Add a comment</label>
        <input id={`reel-comment-${reel.id}`} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a comment…" autoComplete="off" autoFocus />
        <button disabled={busy || !draft.trim()}>Post</button>
      </form>
      )}
    </Overlay>
  )
}

function ReelShare({ reel, viewer, onClose }) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState(null)
  const [sent, setSent] = useState(() => new Set())
  const [sending, setSending] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const q = query.trim()
    const timer = setTimeout(() => {
      const request = q
        ? api(`/users/search?q=${encodeURIComponent(q)}`).then((list) => list.map((person) => ({ ...person, avatar_url: person.profile_image_id ? `/api/images/${person.profile_image_id}` : null })))
        : api(`/users/${viewer.id}/following`)
      request
        .then((list) => { if (active) setPeople(list.filter((person) => String(person.id) !== String(viewer.id))) })
        .catch((err) => { if (active) setError(err.message) })
    }, q ? 200 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, viewer.id])

  const send = async (person) => {
    setSending(person.id)
    setError('')
    try {
      const conversation = await api('/messages/conversations', { method: 'POST', body: { userId: person.id } })
      const intro = reel.caption ? `“${reel.caption.slice(0, 80)}${reel.caption.length > 80 ? '…' : ''}”\n` : ''
      await api(`/messages/conversations/${conversation.id}/messages`, { method: 'POST', body: { body: `Shared a reel by ${reel.author_name}\n${intro}${reelLink(reel)}` } })
      setSent((current) => new Set(current).add(person.id))
    } catch (err) { setError(err.message) } finally { setSending(null) }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reelLink(reel))
      setNotice('Link copied')
    } catch { setError('Could not copy the link') }
  }

  return (
    <Overlay className="reel-share" labelledBy={`reel-share-${reel.id}`} onClose={onClose}>
      <span className="comments-grip" aria-hidden="true" />
      <header className="comments-sheet-head">
        <h2 id={`reel-share-${reel.id}`}>Share reel</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <label className="reel-share-search">
        <MagnifyingGlass size={16} />
        <span className="sr-only">Search people</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" maxLength={80} autoFocus />
      </label>
      <ul className="reel-share-list">
        {people === null && [0, 1, 2].map((i) => <li key={i} aria-hidden="true"><span className="avatar avatar-sm skeleton" /><span className="skeleton skeleton-line" /></li>)}
        {people && people.length === 0 && <li className="reel-share-empty">{query.trim() ? 'No one found with that name.' : 'Follow people to share reels with them quickly, or search above.'}</li>}
        {people && people.map((person) => (
          <li key={person.id}>
            <Avatar name={person.name} src={person.avatar_url} size="sm" />
            <span className="reel-share-who"><strong>{person.name}</strong><small>{person.institution || 'SNARP member'}</small></span>
            <button type="button" className={`reel-share-send ${sent.has(person.id) ? 'sent' : ''}`} onClick={() => send(person)} disabled={sending === person.id || sent.has(person.id)}>
              {sent.has(person.id) ? <><Check size={14} weight="bold" /> Sent</> : sending === person.id ? 'Sending…' : 'Send'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="field-error comments-sheet-error" role="alert">{error}</p>}
      <footer className="reel-share-foot">
        <button type="button" className="btn btn-secondary" onClick={copy}><LinkIcon size={16} /> {notice || 'Copy link'}</button>
      </footer>
    </Overlay>
  )
}

function Reel({ reel, index, viewer, active, near, muted, onMute, onUpdate, onRemove, onComments, onShare, onEdit, onStep, total }) {
  const videoRef = useRef(null)
  const viewedRef = useRef(false)
  const barRef = useRef(null)
  const [paused, setPaused] = useState(false)
  const [started, setStarted] = useState(false)
  const [burst, setBurst] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastTap = useRef(0)
  const mine = String(reel.user_id) === String(viewer.id)
  const canRemove = mine || MODERATOR_ROLES.includes(viewer.role)
  const start = reel.trim_start ?? 0
  const end = reel.trim_end ?? reel.duration ?? null
  const natural = reel.width && reel.height ? { width: reel.width, height: reel.height } : null
  const silent = muted || reel.audio_muted

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    if (!active) {
      video.pause()
      if (video.readyState >= 1) video.currentTime = start
      return undefined
    }
    if (video.currentTime < start - 0.1 || (end && video.currentTime >= end)) video.currentTime = start
    video.play().catch(() => { video.muted = true; onMute(true); video.play().catch(() => setPaused(true)) })
    // Loop only the trimmed part and drive the progress bar.
    let frame = 0
    const tick = () => {
      const stop = end ?? video.duration
      if ((stop && video.currentTime >= stop - 0.03) || video.currentTime < start - 0.25) video.currentTime = start
      if (barRef.current && stop) barRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, (video.currentTime - start) / (stop - start)))})`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, onMute, start, end])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = silent
  }, [silent, near])

  useEffect(() => {
    if (!active || viewedRef.current) return undefined
    const timer = setTimeout(() => {
      viewedRef.current = true
      api(`/reels/${reel.id}/view`, { method: 'POST' }).catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [active, reel.id])

  const setLike = async (liked) => {
    if (busy) return
    setBusy(true)
    const hidden = reel.like_count == null
    onUpdate({ ...reel, liked_by_me: liked, like_count: hidden ? null : Math.max(0, reel.like_count + (liked ? 1 : -1)) })
    try {
      const result = await api(`/reels/${reel.id}/like`, { method: 'PUT', body: { liked } })
      onUpdate({ ...reel, liked_by_me: result.liked_by_me, like_count: hidden ? null : result.like_count })
    } catch (err) {
      onUpdate(reel)
      setError(err.message)
    } finally { setBusy(false) }
  }

  const toggleSave = async () => {
    const saved = !reel.saved_by_me
    onUpdate({ ...reel, saved_by_me: saved })
    try { await api(`/reels/${reel.id}/save`, { method: 'PUT', body: { saved } }) } catch (err) { onUpdate(reel); setError(err.message) }
  }

  const follow = async () => {
    try {
      const result = await api(`/users/${reel.user_id}/follow`, { method: 'PUT', body: { following: true } })
      onUpdate({ ...reel, following_author: result.followed_by_me ?? true }, true)
    } catch (err) { setError(err.message) }
  }

  const setting = async (patch) => {
    setMenu(false)
    try { onUpdate(await api(`/reels/${reel.id}`, { method: 'PATCH', body: patch })) } catch (err) { setError(err.message) }
  }

  const remove = async () => {
    setMenu(false)
    if (!window.confirm(mine ? 'Delete this reel? This cannot be undone.' : 'Remove this reel for everyone?')) return
    try {
      await api(`/reels/${reel.id}`, { method: 'DELETE' })
      onRemove(reel.id)
    } catch (err) { setError(err.message) }
  }

  const copyLink = async () => {
    setMenu(false)
    try { await navigator.clipboard.writeText(reelLink(reel)) } catch { setError('Could not copy the link') }
  }

  const tap = (event) => {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      setBurst((value) => value + 1)
      if (!reel.liked_by_me) setLike(true)
      return
    }
    lastTap.current = now
    const video = videoRef.current
    const pointerType = event.nativeEvent?.pointerType
    setTimeout(() => {
      if (lastTap.current !== now || !video) return
      if (video.paused) { video.play().catch(() => {}); setPaused(false) } else { video.pause(); setPaused(true) }
    }, pointerType === 'mouse' ? 200 : 260)
  }

  const tags = Array.isArray(reel.tags) ? reel.tags : []
  return (
    <article className="reel" data-index={index} aria-label={`Reel by ${reel.author_name}`} id={`reel-${reel.id}`}>
      <div className="reel-stage">
        {reel.thumbnail_url && !(near && started) && <img className="reel-cover" src={reel.thumbnail_url} alt="" loading="lazy" />}
        {near && (
          <ReelFrame crop={reel.crop ?? undefined} natural={natural} filter={reel.filter} className={started ? '' : 'waiting'}>
            <video
              ref={videoRef}
              src={`${reel.video_url}#t=${start}`}
              muted={silent}
              loop
              playsInline
              preload={active ? 'auto' : 'metadata'}
              aria-label={reel.alt_text || `Reel by ${reel.author_name}`}
              onPlay={() => setPaused(false)}
              onPlaying={() => setStarted(true)}
            />
          </ReelFrame>
        )}
        <button type="button" className="reel-tap" onPointerUp={tap} onKeyDown={(event) => { if (event.key === 'Enter') tap(event) }} aria-label={paused ? 'Play' : 'Pause'} />
        {paused && <span className="reel-paused" aria-hidden="true"><Play size={34} weight="fill" /></span>}
        {burst > 0 && <span key={burst} className="reel-burst" aria-hidden="true"><Heart size={96} weight="fill" /></span>}
        {reel.audio_muted ? (
          <span className="reel-mute reel-no-sound" title="This reel has no sound" aria-label="This reel has no sound"><SpeakerSlash size={18} weight="fill" /></span>
        ) : (
          <button type="button" className="reel-mute" onClick={() => onMute(!muted)} aria-label={muted ? 'Turn sound on' : 'Mute'} title={muted ? 'Sound on' : 'Mute'}>
            {muted ? <SpeakerSlash size={18} weight="fill" /> : <SpeakerHigh size={18} weight="fill" />}
          </button>
        )}
        <div className="reel-info">
          <div className="reel-author">
            <Link to={`/users/${reel.user_id}`} className="reel-author-link">
              <Avatar name={reel.author_name} src={reel.author_avatar_url} size="sm" />
              <strong>{reel.author_name}</strong>
            </Link>
            {!mine && !reel.following_author && <button type="button" className="reel-follow" onClick={follow}>Follow</button>}
            <time dateTime={reel.created_at}>{timeAgo(reel.created_at)}</time>
          </div>
          {reel.location && <span className="reel-location"><MapPin size={13} weight="fill" /> {reel.location}</span>}
          {reel.caption && (
            <p className={`reel-caption ${expanded ? 'open' : ''}`} onClick={() => setExpanded(!expanded)}>
              <Linkify text={reel.caption} />
            </p>
          )}
          {tags.length > 0 && (
            <div className="reel-tags">
              <button type="button" onClick={() => setTagsOpen(!tagsOpen)} aria-expanded={tagsOpen}>
                <UserCircle size={15} weight="fill" /> {tags.length === 1 ? tags[0].name : `${tags[0].name} and ${tags.length - 1} ${tags.length === 2 ? 'other' : 'others'}`}
              </button>
              {tagsOpen && (
                <ul>
                  {tags.map((tag) => <li key={tag.id}><Link to={`/users/${tag.id}`}>{tag.name}</Link></li>)}
                </ul>
              )}
            </div>
          )}
          {mine && <span className="reel-views"><Eye size={13} /> {compact.format(reel.view_count ?? 0)} {reel.view_count === 1 ? 'view' : 'views'}{reel.hide_counts ? ' · counts hidden from others' : ''}</span>}
        </div>
        <span className="reel-progress-bar" aria-hidden="true"><span ref={barRef} /></span>
        {error && <p className="reel-error" role="alert" onClick={() => setError('')}>{error}</p>}
      </div>
      <aside className="reel-rail" aria-label="Reel actions">
        <button type="button" className={reel.liked_by_me ? 'liked' : ''} onClick={() => setLike(!reel.liked_by_me)} aria-pressed={!!reel.liked_by_me} aria-label={reel.liked_by_me ? 'Unlike' : 'Like'}>
          <Heart size={27} weight={reel.liked_by_me ? 'fill' : 'regular'} /><span>{reel.like_count == null ? 'Likes' : compact.format(reel.like_count)}</span>
        </button>
        {(!reel.comments_off || mine) && (
          <button type="button" onClick={() => onComments(reel)} aria-haspopup="dialog" aria-label="Comments">
            <ChatCircle size={27} /><span>{compact.format(reel.comment_count ?? 0)}</span>
          </button>
        )}
        <button type="button" onClick={() => onShare(reel)} aria-haspopup="dialog" aria-label="Share">
          <PaperPlaneTilt size={26} /><span>Share</span>
        </button>
        <button type="button" className={reel.saved_by_me ? 'saved' : ''} onClick={toggleSave} aria-pressed={!!reel.saved_by_me} aria-label={reel.saved_by_me ? 'Remove from saved' : 'Save'}>
          <BookmarkSimple size={26} weight={reel.saved_by_me ? 'fill' : 'regular'} /><span>{reel.saved_by_me ? 'Saved' : 'Save'}</span>
        </button>
        <div className="reel-more">
          <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="More options"><DotsThree size={26} weight="bold" /></button>
          {menu && (
            <div className="reel-menu" role="menu">
              {mine && <button type="button" role="menuitem" onClick={() => { setMenu(false); onEdit(reel) }}><PencilSimple size={16} /> Edit</button>}
              {mine && (
                <button type="button" role="menuitem" onClick={() => setting({ hideCounts: !reel.hide_counts })}>
                  {reel.hide_counts ? <Eye size={16} /> : <EyeSlash size={16} />} {reel.hide_counts ? 'Unhide like count to others' : 'Hide like count to others'}
                </button>
              )}
              {mine && (
                <button type="button" role="menuitem" onClick={() => setting({ commentsOff: !reel.comments_off })}>
                  {reel.comments_off ? <ChatCircle size={16} /> : <ChatCircleSlash size={16} />} {reel.comments_off ? 'Turn on commenting' : 'Turn off commenting'}
                </button>
              )}
              <button type="button" role="menuitem" onClick={copyLink}><LinkIcon size={16} /> Copy link</button>
              {canRemove && <button type="button" role="menuitem" className="danger" onClick={remove}><Trash size={16} /> {mine ? 'Delete' : 'Remove reel'}</button>}
              <button type="button" role="menuitem" onClick={() => setMenu(false)}>Cancel</button>
            </div>
          )}
        </div>
        <div className="reel-step">
          <button type="button" onClick={() => onStep(-1)} disabled={index === 0} aria-label="Previous reel" title="Previous (↑)"><CaretUp size={18} weight="bold" /></button>
          <button type="button" onClick={() => onStep(1)} disabled={index >= total - 1} aria-label="Next reel" title="Next (↓)"><CaretDown size={18} weight="bold" /></button>
        </div>
      </aside>
    </article>
  )
}

export default function Reels({ user }) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.key === params.get('tab')) ? params.get('tab') : 'all'
  const firstId = params.get('reel')
  const [feed, setFeed] = useState({ key: null, items: [], next: null, loading: true, error: '' })
  const [activeIndex, setActiveIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [composing, setComposing] = useState(false)
  const [comments, setComments] = useState(null)
  const [sharing, setSharing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [jumpTop, setJumpTop] = useState(0)
  const feedRef = useRef(null)
  const loadingMore = useRef(false)
  const key = `${tab}:${firstId ?? ''}`

  const query = useCallback((after) => {
    const search = new URLSearchParams()
    if (tab === 'saved') search.set('saved', '1')
    if (tab === 'mine') search.set('user', user.id)
    if (firstId && tab === 'all') search.set('first', firstId)
    if (after) search.set('after', after)
    return api(`/reels?${search}`)
  }, [tab, firstId, user.id])

  useEffect(() => {
    let active = true
    query().then((page) => {
      if (!active) return
      setFeed({ key, items: page.items, next: page.next, loading: false, error: '' })
      setActiveIndex(0)
      feedRef.current?.scrollTo({ top: 0 })
    }).catch((err) => { if (active) setFeed({ key, items: [], next: null, loading: false, error: err.message }) })
    return () => { active = false }
  }, [query, key])

  const items = useMemo(() => (feed.key === key ? feed.items : []), [feed.key, feed.items, key])
  const loading = feed.key !== key || feed.loading

  const loadMore = useCallback(async () => {
    if (!feed.next || loadingMore.current) return
    loadingMore.current = true
    try {
      const page = await query(feed.next)
      setFeed((current) => {
        const seen = new Set(current.items.map((item) => item.id))
        return { ...current, items: [...current.items, ...page.items.filter((item) => !seen.has(item.id))], next: page.next }
      })
    } catch { /* the next scroll retries */ } finally { loadingMore.current = false }
  }, [feed.next, query])

  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  useEffect(() => {
    const root = feedRef.current
    if (!root || !items.length) return undefined
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const index = Number(entry.target.dataset.index)
        setActiveIndex(index)
        if (index >= items.length - 3) loadMoreRef.current()
      }
    }, { root, threshold: 0.6 })
    root.querySelectorAll('.reel').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [items])

  const step = useCallback((direction) => {
    const root = feedRef.current
    const target = root?.querySelector(`.reel[data-index="${activeIndex + direction}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeIndex])

  useEffect(() => {
    const key = (event) => {
      if (document.documentElement.classList.contains('overlay-open') || event.target.closest?.('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); step(1) }
      if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); step(-1) }
      if (event.key === 'm') setMuted((value) => !value)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [step])

  const update = useCallback((next, authorWide) => {
    setFeed((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === next.id ? next : authorWide && String(item.user_id) === String(next.user_id) ? { ...item, following_author: next.following_author } : item)),
    }))
  }, [])
  const removeReel = useCallback((id) => setFeed((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) })), [])
  const countComments = (delta) => {
    setComments((current) => current && { ...current, comment_count: Math.max(0, (current.comment_count ?? 0) + delta) })
    setFeed((current) => ({ ...current, items: current.items.map((item) => (item.id === comments?.id ? { ...item, comment_count: Math.max(0, (item.comment_count ?? 0) + delta) } : item)) }))
  }

  const published = (reel) => {
    if (tab === 'saved' || firstId) setParams({})
    setFeed((current) => ({ ...current, items: [reel, ...current.items.filter((item) => item.id !== reel.id)] }))
    setActiveIndex(0)
    setJumpTop((value) => value + 1)
  }

  // After the new reel is rendered at the top, jump to it (scroll snapping would otherwise keep the old one).
  useEffect(() => {
    if (jumpTop) feedRef.current?.scrollTo({ top: 0 })
  }, [jumpTop])

  const setTab = (next) => setParams(next === 'all' ? {} : { tab: next })

  return (
    <div className="reels-page">
      <header className="reels-head">
        <h1><FilmReel size={24} weight="fill" /> Reels</h1>
        <nav className="reels-tabs" aria-label="Reel lists">
          {TABS.map((item) => (
            <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>
          ))}
        </nav>
        <button type="button" className="btn btn-primary reels-new" onClick={() => setComposing(true)} aria-label="New reel"><VideoCamera size={19} weight="fill" /> <span>New reel</span></button>
      </header>

      <div className="reels-feed" ref={feedRef} aria-busy={loading}>
        {loading ? (
          <div className="reel"><div className="reel-stage reel-skeleton skeleton" aria-label="Loading reels" /></div>
        ) : feed.error ? (
          <div className="reels-empty"><p role="alert">{feed.error}</p></div>
        ) : items.length === 0 ? (
          <div className="reels-empty">
            <span className="reels-empty-icon"><FilmReel size={40} weight="duotone" /></span>
            <h2>{tab === 'saved' ? 'No saved reels yet' : tab === 'mine' ? 'You have not shared a reel yet' : 'No reels yet'}</h2>
            <p>{tab === 'saved' ? 'Tap the bookmark on any reel to keep it here.' : 'Share a short video: an experiment, a lesson, a moment from your lab or campus.'}</p>
            {tab !== 'saved' && <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}><Plus size={18} weight="bold" /> New reel</button>}
          </div>
        ) : items.map((reel, index) => (
          <Reel
            key={reel.id}
            reel={reel}
            index={index}
            total={items.length}
            viewer={user}
            active={index === activeIndex && !composing}
            near={Math.abs(index - activeIndex) <= 1}
            muted={muted}
            onMute={setMuted}
            onUpdate={update}
            onRemove={removeReel}
            onComments={setComments}
            onShare={setSharing}
            onEdit={setEditing}
            onStep={step}
          />
        ))}
      </div>

      {composing && <ReelStudio viewer={user} onClose={() => setComposing(false)} onPublished={published} />}
      {editing && <ReelEdit reel={editing} onSaved={update} onClose={() => setEditing(null)} />}
      {comments && <ReelComments reel={comments} viewer={user} onCount={countComments} onClose={() => setComments(null)} />}
      {sharing && <ReelShare reel={sharing} viewer={user} onClose={() => setSharing(null)} />}
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Image as ImageIcon, X, UserPlus, Article, Star, ArrowUp, ArrowSquareOut, LinkSimple, PencilSimpleLine,
} from '@phosphor-icons/react'
import { api } from './api'
import { Avatar } from './components/ui'
import PostCard, { PostActions } from './components/PostCard'
import { ExpandableText } from './components/RichText'
import Stories from './components/Stories'
import PdfAttachment from './components/PdfAttachment'
import CardMenu from './components/CardMenu'
import { useViewTracker } from './views'
import { ROLE_LABEL, timeAgo } from './format'

const MAX = 5000
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_TAGS = 5
const NEW_ITEMS_POLL_MS = 60000
const SCOPES = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'following', label: 'Following' },
]
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'post', label: 'Posts' },
  { key: 'paper', label: 'Papers' },
]

const itemKey = (item) => `${item.type === 'paper' ? 'paper' : 'post'}-${item.id}`
const isPost = (item) => item.type !== 'paper'
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]
const DISMISSED_KEY = 'snarp-dismissed-requests'
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })
function readDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]').map(String) } catch { return [] }
}

function FeedPaper({ paper, viewer, onUpdate, onLogout }) {
  const authors = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean)
  const tags = paper.tags ?? []
  const shownTags = tags.slice(0, MAX_TAGS)
  return (
    <li className="panel post feed-paper" id={`paper-${paper.id}`}>
      <header className="feed-card-head">
        <Link to={`/users/${paper.user_id}`} tabIndex={-1} aria-hidden="true">
          <Avatar name={paper.author_name} src={paper.author_avatar_url} size="md" />
        </Link>
        <div className="feed-card-who">
          <p><Link to={`/users/${paper.user_id}`} className="feed-card-name">{paper.author_name}</Link> <span>published a research paper</span></p>
          <time dateTime={paper.created_at} title={new Date(paper.created_at).toLocaleString()}>{timeAgo(paper.created_at)}</time>
        </div>
        <span className="feed-kind"><Article size={14} weight="bold" /> Paper</span>
        <CardMenu label="Paper options" items={[
          { label: 'View details', icon: ArrowSquareOut, to: `/articles/${paper.id}` },
          { label: 'Copy link', icon: LinkSimple, onClick: () => navigator.clipboard?.writeText(`${location.origin}/articles/${paper.id}`).catch(() => {}) },
        ]} />
      </header>
      <div className="feed-paper-box">
        {paper.domain && <span className="feed-paper-domain">{paper.domain}</span>}
        <h2 className="feed-paper-title"><Link to={`/articles/${paper.id}`}>{paper.title}</Link></h2>
        {authors.length > 0 && <p className="feed-paper-authors">{authors.join(', ')}</p>}
        <ExpandableText className="feed-paper-abstract" text={paper.abstract} lines={3} />
        {tags.length > 0 && (
          <div className="tag-row">
            {shownTags.map((tag) => <Link key={tag} className="tag tag-link" to={`/articles?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>)}
            {tags.length > shownTags.length && <Link className="tag tag-link tag-more" to={`/articles/${paper.id}`}>+{tags.length - shownTags.length} more</Link>}
          </div>
        )}
        <PdfAttachment paperId={paper.id} filename={paper.pdf_filename} size={paper.pdf_size} title={paper.title} />
      </div>
      <PostActions post={paper} kind="paper" viewerId={viewer.id} canModerate={['admin', 'moderator'].includes(viewer.role)} onUpdate={onUpdate} onLogout={onLogout} />
    </li>
  )
}

// Paper of the Day (PR #23): today's featured published paper and earlier picks.
function PaperOfTheDay() {
  const [today, setToday] = useState(undefined)
  const [past, setPast] = useState([])
  useEffect(() => {
    let active = true
    api('/papers/featured').then((paper) => { if (active) setToday(paper) }).catch(() => { if (active) setToday(null) })
    api('/papers/past-picks').then((list) => { if (active) setPast(list.slice(0, 5)) }).catch(() => {})
    return () => { active = false }
  }, [])
  if (today === undefined) return null
  const authors = (today?.authors ?? []).map((author) => (typeof author === 'string' ? author : author.name)).filter(Boolean)
  return (
    <section className="rail-sec potd" aria-labelledby="rail-potd">
      <h3 id="rail-potd" className="rail-title"><Star size={16} weight="fill" className="potd-star" /> Paper of the Day</h3>
      {today ? (
        <Link to={`/articles/${today.id}`} className="potd-card">
          {today.domain && <span className="potd-domain">{today.domain}</span>}
          <strong>{today.title}</strong>
          {authors.length > 0 && <small>{authors.slice(0, 3).join(', ')}{authors.length > 3 ? ' et al.' : ''}</small>}
          <p>{today.abstract}</p>
          <span className="potd-stats">{today.like_count} likes · {today.save_count} saves</span>
        </Link>
      ) : <p className="rail-empty">No published papers to feature yet.</p>}
      {past.length > 0 && (
        <>
          <h4 className="potd-past-title">Past picks</h4>
          <ul className="potd-past">
            {past.map((paper) => (
              <li key={paper.id}>
                <Link to={`/articles/${paper.id}`}>{paper.title}</Link>
                <time dateTime={paper.featured_date}>{new Date(`${String(paper.featured_date).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function FollowRow({ person, onFollow }) {
  return (
    <div className="rail-row follow-row">
      <Link to={`/users/${person.id}`} className="follow-person">
        <Avatar name={person.name} src={person.avatar_url} size="md" />
        <span>
          <strong>{person.name}</strong>
          <small>{person.institution || (person.shared_interests > 0
            ? `${person.shared_interests} shared ${person.shared_interests === 1 ? 'interest' : 'interests'}`
            : ROLE_LABEL[person.role])}</small>
        </span>
      </Link>
      <button className="follow-add" onClick={() => onFollow(person)} aria-label={`Follow ${person.name}`} title="Follow">
        <UserPlus size={22} weight="fill" />
      </button>
    </div>
  )
}

function Composer({ me, onPosted, onError }) {
  const [body, setBody] = useState('')
  const [image, setImage] = useState(null)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)
  const textRef = useRef(null)

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [body])

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image.url)
    setImage(null)
  }

  const attachFile = (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Choose an image file (JPEG, PNG, GIF or WebP)')
    if (file.size > MAX_IMAGE) return setError('Image must be 5 MB or smaller')
    setError('')
    clearImage()
    setImage({ file, url: URL.createObjectURL(file) })
  }

  const submit = async (event) => {
    event?.preventDefault()
    if ((!body.trim() && !image) || posting) return
    setPosting(true)
    setError('')
    try {
      const form = new FormData()
      form.append('body', body)
      if (image) form.append('image', image.file)
      const post = await api('/posts', { method: 'POST', body: form })
      onPosted({ ...post, type: 'post' })
      setBody('')
      clearImage()
    } catch (err) {
      if (err.status === 401) onError(err)
      else setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  const remaining = MAX - body.length
  return (
    <form
      className={`composer panel ${dragging ? 'composer-dragging' : ''}`}
      onSubmit={submit}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); attachFile(event.dataTransfer.files[0]) }}
    >
      <Avatar name={me.name} src={me.avatar_url} />
      <div className="composer-main">
        <label htmlFor="post-body" className="sr-only">Write a post</label>
        <textarea
          id="post-body"
          ref={textRef}
          rows={2}
          maxLength={MAX}
          placeholder={`What are you working on, ${firstName(me.name)}?`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && (event.ctrlKey || event.metaKey) && submit()}
          onPaste={(event) => {
            const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'))
            if (file) { event.preventDefault(); attachFile(file) }
          }}
        />
        {image && (
          <div className="composer-preview">
            <img src={image.url} alt="Selected upload preview" />
            <button type="button" className="icon-btn preview-remove" onClick={clearImage} aria-label="Remove image">
              <X size={16} />
            </button>
          </div>
        )}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="composer-foot">
          <div className="composer-tools">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(event) => { attachFile(event.target.files[0]); event.target.value = '' }} />
            <button type="button" className="tool-btn" onClick={() => fileRef.current.click()} title="Add a photo (you can also paste or drop one)">
              <ImageIcon size={16} /> Photo
            </button>
          </div>
          {remaining <= 500 && (
            <span className={`count ${remaining <= 200 ? 'count-warn' : ''}`} aria-live="polite">{remaining} left</span>
          )}
          <span className="composer-hint">Ctrl + Enter to post</span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={posting || (!body.trim() && !image)}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
      {dragging && <div className="composer-drop" aria-hidden="true">Drop the image to attach it</div>}
    </form>
  )
}

export default function Feed({ user, onLogout }) {
  const [me, setMe] = useState(user)
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [scope, setScope] = useState('everyone')
  const [suggestions, setSuggestions] = useState([])
  const [followers, setFollowers] = useState([])
  const [dismissed, setDismissed] = useState(readDismissed)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [incoming, setIncoming] = useState([])
  const sentinelRef = useRef(null)
  const itemsRef = useRef(items)
  const logoutRef = useRef(onLogout)
  useEffect(() => {
    itemsRef.current = items
    logoutRef.current = onLogout
  })

  const handleError = useCallback((err) => (err.status === 401 ? logoutRef.current() : setLoadError(err.message)), [])

  useEffect(() => {
    const load = (path, apply) => api(path).then(apply).catch((err) => err.status === 401 && handleError(err))
    load('/auth/me', setMe)
    load('/users/suggestions', setSuggestions)
    load(`/users/${user.id}/followers`, setFollowers)
  }, [handleError, user.id])

  useEffect(() => {
    let active = true
    api(`/posts?page=1&scope=${scope}`)
      .then((feed) => {
        if (!active) return
        setItems(feed.items)
        setPage(1)
        setHasMore(feed.hasMore)
        setIncoming([])
      })
      .catch((err) => active && handleError(err))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [scope, handleError])

  useEffect(() => {
    const check = async () => {
      if (document.hidden || loading) return
      try {
        const feed = await api(`/posts?page=1&scope=${scope}`)
        const current = itemsRef.current
        const known = new Set(current.map(itemKey))
        const newest = current[0] ? new Date(current[0].created_at) : new Date(0)
        setIncoming(feed.items.filter((item) => !known.has(itemKey(item)) && new Date(item.created_at) > newest))
      } catch {}
    }
    const timer = setInterval(check, NEW_ITEMS_POLL_MS)
    return () => clearInterval(timer)
  }, [scope, loading])

  const showIncoming = () => {
    setItems((current) => [...incoming, ...current])
    setIncoming([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setLoadError('')
    try {
      const next = await api(`/posts?page=${page + 1}&scope=${scope}`)
      setItems((current) => {
        const known = new Set(current.map(itemKey))
        return [...current, ...next.items.filter((item) => !known.has(itemKey(item)))]
      })
      setPage(next.page)
      setHasMore(next.hasMore)
    } catch (err) { handleError(err) }
    finally { setLoadingMore(false) }
  }, [loadingMore, hasMore, page, scope, handleError])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return undefined
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const changeScope = (next) => {
    if (next === scope) return
    setLoading(true)
    setLoadError('')
    setScope(next)
  }

  const follow = async (person) => {
    try {
      await api(`/users/${person.id}/follow`, { method: 'PUT', body: { following: true } })
      setSuggestions((current) => current.filter((item) => item.id !== person.id))
      setFollowers((current) => current.map((item) => item.id === person.id ? { ...item, followed_by_me: true } : item))
      setMe((current) => ({ ...current, following_count: (current.following_count ?? 0) + 1 }))
      if (scope === 'following') {
        const feed = await api('/posts?page=1&scope=following')
        setItems(feed.items)
        setPage(1)
        setHasMore(feed.hasMore)
      }
    } catch (err) { handleError(err) }
  }

  const onPosted = (post) => {
    setItems((current) => [post, ...current])
    setMe((current) => ({ ...current, post_count: (current.post_count ?? 0) + 1 }))
  }
  const updatePost = (updated) => setItems((current) => current.map((item) => isPost(item) && String(item.id) === String(updated.id) ? { ...item, ...updated } : item))
  const updatePaper = (updated) => setItems((current) => current.map((item) => !isPost(item) && String(item.id) === String(updated.id) ? { ...item, ...updated } : item))
  const removePost = (id) => {
    setItems((current) => current.filter((item) => !(isPost(item) && String(item.id) === String(id))))
    setMe((current) => ({ ...current, post_count: Math.max(0, (current.post_count ?? 1) - 1) }))
  }

  const decline = (person) => {
    const next = [...new Set([...dismissed, String(person.id)])]
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-200))) } catch {}
  }

  const shown = items.filter((item) => filter === 'all' || (filter === 'paper' ? !isPost(item) : isPost(item)))
  const stackRef = useRef(null)
  useViewTracker(stackRef, shown.map(itemKey).join())
  const requests = followers.filter((person) => !person.followed_by_me && !dismissed.includes(String(person.id)))

  return (
    <div className="feed-layout">
      <main className="feed">
        <h1 className="sr-only">Feed</h1>
        <Stories me={me} />
        <Composer me={me} onPosted={onPosted} onError={handleError} />

        <div className="feed-bar">
          <h2>Feeds</h2>
          <div className="feed-kinds" role="group" aria-label="Show">
            {FILTERS.map((item) => (
              <button key={item.key} aria-pressed={filter === item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>
            ))}
          </div>
          <div className="feed-toggle" role="tablist" aria-label="Whose updates to show">
            {SCOPES.map((item) => (
              <button key={item.key} role="tab" aria-selected={scope === item.key} className={scope === item.key ? 'active' : ''} onClick={() => changeScope(item.key)}>{item.label}</button>
            ))}
          </div>
        </div>

        {incoming.length > 0 && (
          <button className="feed-incoming" onClick={showIncoming}>
            <ArrowUp size={14} /> {incoming.length} new {incoming.length === 1 ? 'update' : 'updates'}
          </button>
        )}

        {loadError && <p className="alert" role="alert">{loadError}</p>}

        {loading ? (
          <div className="post-stack" aria-busy="true" aria-label="Loading posts">
            {[0, 1, 2].map((i) => (
              <div key={i} className="post">
                <div className="avatar skeleton" />
                <div className="post-main">
                  <div className="skeleton skeleton-line" style={{ width: '30%' }} />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line" style={{ width: '70%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          !loadError && (
            <div className="panel empty feed-empty">
              <span className="feed-empty-icon" aria-hidden="true">{scope === 'following' ? <UserPlus size={22} /> : filter === 'paper' ? <Article size={22} /> : <PencilSimpleLine size={22} />}</span>
              <h3>{scope === 'following' ? 'Nothing from people you follow yet' : filter === 'paper' ? 'No approved papers yet' : 'No posts yet'}</h3>
              <p>{scope === 'following'
                ? 'Follow researchers to see their posts and papers here. Your own posts appear here too.'
                : filter === 'paper' ? 'Papers appear here once a moderator approves them.' : 'Be the first to share an update with the SNARP community.'}</p>
              {scope === 'following' && suggestions.length > 0 && (
                <div className="empty-suggestions">
                  {suggestions.map((person) => <FollowRow key={person.id} person={person} onFollow={follow} />)}
                </div>
              )}
            </div>
          )
        ) : (
          <ul className="post-stack" ref={stackRef}>
            {shown.map((item) => item.type === 'paper'
              ? <FeedPaper key={itemKey(item)} paper={item} viewer={me} onUpdate={updatePaper} onLogout={onLogout} />
              : <PostCard key={itemKey(item)} post={item} viewerId={me.id} viewerRole={me.role} onUpdate={updatePost} onRemove={removePost} onLogout={onLogout} />)}
          </ul>
        )}

        {!loading && hasMore && (
          <div ref={sentinelRef} className="feed-more">
            <button className="btn btn-ghost btn-sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
          </div>
        )}
        {!loading && !hasMore && shown.length > 0 && <p className="feed-end">You're all caught up</p>}
      </main>

      <aside className="rail">
        <PaperOfTheDay />
        <section className="rail-sec" aria-labelledby="rail-requests">
          <h3 id="rail-requests" className="rail-title">Requests {requests.length > 0 && <span className="rail-count">{requests.length}</span>}</h3>
          {requests.length === 0 && <p className="rail-empty">No new requests. When someone follows you, you can accept them as a contact here.</p>}
          {requests.slice(0, 3).map((person) => (
            <div key={person.id} className="request">
              <Link to={`/users/${person.id}`} tabIndex={-1} aria-hidden="true">
                <Avatar name={person.name} src={person.avatar_url} size="lg" />
              </Link>
              <div>
                <p><Link to={`/users/${person.id}`} className="request-name">{person.name}</Link> wants to add you as a contact</p>
                <div className="request-actions">
                  <button type="button" className="request-accept" onClick={() => follow(person)}>Accept</button>
                  <button type="button" className="request-decline" onClick={() => decline(person)}>Decline</button>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="rail-sec" aria-labelledby="rail-suggest">
          <h3 id="rail-suggest" className="rail-title">Suggestion for you</h3>
          {suggestions.map((person) => <FollowRow key={person.id} person={person} onFollow={follow} />)}
          {suggestions.length === 0 && <p className="rail-empty">No new suggestions right now.</p>}
        </section>

        <section className="rail-sec">
          <Link to={`/users/${me.id}`} className="follower-card">
            {followers.length > 0 && (
              <span className="follower-stack" aria-hidden="true">
                {followers.slice(0, 10).map((person) => <Avatar key={person.id} name={person.name} src={person.avatar_url} size="sm" />)}
              </span>
            )}
            <span className="follower-count"><strong>{compact.format(me.follower_count ?? followers.length)}</strong> Follower</span>
            <span className="follower-note">{followers.length > 0 ? 'Following your research on SNARP' : 'Share a post or paper to get your first follower'}</span>
          </Link>
        </section>
      </aside>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Trash, PencilSimple, Image as ImageIcon, X, ThumbsUp, ChatCircle, ShareFat, FilePdf } from '@phosphor-icons/react'
import { api, apiBlob } from './api'
import { Avatar } from './components/ui'
import { ROLE_LABEL, timeAgo } from './format'

const MAX = 5000
const MAX_IMAGE = 5 * 1024 * 1024

function FeedPaper({ paper }) {
  const [pdfUrl, setPdfUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  const openPdf = async () => {
    try { setPdfUrl(URL.createObjectURL(await apiBlob(`/papers/${paper.id}/pdf`))); setError('') }
    catch (err) { setError(err.message) }
  }
  const authors = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean)
  return <>
    <div className="article-meta"><span className="tag tag-blue">Research paper · {paper.domain}</span><time dateTime={paper.created_at}>{timeAgo(paper.created_at)}</time></div>
    <h2 className="paper-feed-title">{paper.title}</h2>
    <p className="article-authors">{authors.join(', ')}</p>
    <p className="article-abstract">{paper.abstract}</p>
    <div className="tag-row">{(paper.tags ?? []).map((tag) => <span key={tag} className="tag">#{tag}</span>)}</div>
    <div className="post-actions"><button onClick={openPdf}><FilePdf size={18} /> View paper</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {pdfUrl && <div className="paper-pdf-preview"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPdfUrl('')}>Close PDF</button><iframe title={`PDF: ${paper.title}`} src={pdfUrl} /></div>}
  </>
}

function PostActions({ post, viewerId, onUpdate, onLogout }) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState([])
  const [draft, setDraft] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleError = (err) => {
    if (err.status === 401) onLogout()
    else setError(err.message)
  }

  const toggleComments = async () => {
    const opening = !commentsOpen
    setCommentsOpen(opening)
    setError('')
    if (opening) {
      try { setComments(await api(`/posts/${post.id}/comments`)) }
      catch (err) { handleError(err) }
    }
  }

  const toggleLike = async () => {
    setBusy(true)
    setError('')
    try {
      onUpdate({ ...post, ...await api(`/posts/${post.id}/like`, { method: 'PUT', body: { liked: !post.liked_by_me } }) })
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  const addComment = async (event) => {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const comment = await api(`/posts/${post.id}/comments`, { method: 'POST', body: { body: draft } })
      setComments((current) => [...current, comment])
      setDraft('')
      onUpdate({ ...post, comment_count: (post.comment_count ?? 0) + 1 })
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  const deleteComment = async (comment) => {
    try {
      await api(`/comments/${comment.id}`, { method: 'DELETE' })
      setComments((current) => current.filter((item) => item.id !== comment.id))
      onUpdate({ ...post, comment_count: Math.max(0, (post.comment_count ?? 1) - 1) })
    } catch (err) { handleError(err) }
  }

  const share = async () => {
    const url = `${location.origin}/users/${post.user_id}?post=${post.id}#post-${post.id}`
    try {
      if (navigator.share) await navigator.share({ title: 'SNARP post', text: post.body, url })
      else await navigator.clipboard.writeText(url)
      setError('')
    } catch (err) {
      if (err.name !== 'AbortError') setError('Could not share this post')
    }
  }

  const report = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/posts/${post.id}/report`, { method: 'POST', body: { reason: reportReason } })
      setReportSent(true)
      setReportOpen(false)
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  return (
    <>
    <div className="post-actions">
      <button className={post.liked_by_me ? 'active' : ''} onClick={toggleLike} aria-pressed={!!post.liked_by_me} disabled={busy}>
        <ThumbsUp size={18} weight={post.liked_by_me ? 'fill' : 'regular'} /> {post.like_count ?? 0} Like
      </button>
      <button onClick={toggleComments}><ChatCircle size={18} /> {post.comment_count ?? 0} Comment</button>
      <button onClick={share}><ShareFat size={18} /> Share</button>
      {String(post.user_id) !== String(viewerId) && <button onClick={() => setReportOpen(!reportOpen)} disabled={reportSent}>{reportSent ? 'Reported' : 'Report'}</button>}
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {commentsOpen && <section className="comments-panel" aria-label="Comments">
      {comments.map((comment) => <div className="comment-row" key={comment.id}>
        <Avatar name={comment.author_name} src={comment.author_avatar_url} size="sm" />
        <div><strong>{comment.author_name}</strong><p>{comment.body}</p></div>
        {String(comment.user_id) === String(viewerId) && <button className="link-danger" onClick={() => deleteComment(comment)}>Delete</button>}
      </div>)}
      {comments.length === 0 && <p className="muted-sm">No comments yet.</p>}
      <form className="comment-form" onSubmit={addComment}>
        <label className="sr-only" htmlFor={`comment-${post.id}`}>Add a comment</label>
        <input id={`comment-${post.id}`} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a comment" />
        <button className="btn btn-secondary btn-sm" disabled={busy || !draft.trim()}>Comment</button>
      </form>
    </section>}
    {reportOpen && <form className="report-form" onSubmit={report}>
      <label htmlFor={`report-${post.id}`}>Why are you reporting this post?</label>
      <textarea id={`report-${post.id}`} minLength={5} maxLength={1000} value={reportReason} onChange={(event) => setReportReason(event.target.value)} required />
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReportOpen(false)}>Cancel</button>
      <button className="btn btn-danger btn-sm" disabled={busy || reportReason.trim().length < 5}>Submit report</button>
    </form>}
    </>
  )
}

export default function Feed({ user, onLogout }) {
  const [me, setMe] = useState(user)
  const [posts, setPosts] = useState([])
  const [upcomingEvents, setUpcomingEvents] = useState([])
  const [communities, setCommunities] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [body, setBody] = useState('')
  const [image, setImage] = useState(null) // { file, url } for the preview
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [editError, setEditError] = useState('')
  const fileRef = useRef(null)

  // Any 401 means the token expired or was revoked
  const handle = (setError) => (err) => (err.status === 401 ? onLogout() : setError(err.message))

  useEffect(() => {
    Promise.all([api('/posts?page=1'), api('/auth/me'), api('/events?limit=2'), api('/communities?limit=3')])
      .then(([feed, m, events, communityList]) => {
        setPosts(feed.items)
        setHasMore(feed.hasMore)
        setMe(m)
        setUpcomingEvents(events.items)
        setCommunities(communityList.items)
      })
      .catch(handle(setLoadError))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image.url)
    setImage(null)
  }

  const pickImage = (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setPostError('Choose an image file')
    if (file.size > MAX_IMAGE) return setPostError('Image must be 5 MB or smaller')
    setPostError('')
    clearImage()
    setImage({ file, url: URL.createObjectURL(file) })
  }

  const submit = async (e) => {
    e?.preventDefault()
    if ((!body.trim() && !image) || posting) return
    setPosting(true)
    setPostError('')
    try {
      const form = new FormData()
      form.append('body', body)
      if (image) form.append('image', image.file)
      const post = await api('/posts', { method: 'POST', body: form })
      setPosts((prev) => [post, ...prev])
      setMe((m) => ({ ...m, post_count: (m.post_count ?? 0) + 1 }))
      setBody('')
      clearImage()
    } catch (err) {
      handle(setPostError)(err)
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id) => {
    try {
      await api(`/posts/${id}`, { method: 'DELETE' })
      setPosts((prev) => prev.filter((p) => p.id !== id))
      setMe((m) => ({ ...m, post_count: Math.max(0, (m.post_count ?? 1) - 1) }))
    } catch (err) {
      handle(setLoadError)(err)
    }
    setConfirmId(null)
  }

  const updatePost = (updated) => setPosts((current) => current.map((post) => post.type !== 'paper' && String(post.id) === String(updated.id) ? { ...post, ...updated } : post))

  const saveEdit = async (id) => {
    setEditError('')
    try {
      const updated = await api(`/posts/${id}`, { method: 'PATCH', body: { body: editBody } })
      updatePost(updated)
      setEditingId(null)
    } catch (err) { handle(setEditError)(err) }
  }

  const loadMore = async () => {
    setLoadingMore(true)
    setLoadError('')
    try {
      const next = await api(`/posts?page=${page + 1}`)
      setPosts((current) => [...current, ...next.items])
      setPage(next.page)
      setHasMore(next.hasMore)
    } catch (err) { handle(setLoadError)(err) }
    finally { setLoadingMore(false) }
  }

  return (
    <div className="feed-layout">
      <main className="feed">
        <div className="welcome">
          <h1>Good to see you, {me.name.split(' ')[0]}</h1>
          <p>Share what you are working on with the community.</p>
        </div>

        <form className="composer panel" onSubmit={submit}>
          <Avatar name={me.name} src={me.avatar_url} />
          <div className="composer-main">
            <label htmlFor="post-body" className="sr-only">Write a post</label>
            <textarea
              id="post-body"
              rows={3}
              maxLength={MAX}
              placeholder="Share an update, a finding, or a photo"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
            />
            {image && (
              <div className="composer-preview">
                <img src={image.url} alt="Selected upload preview" />
                <button type="button" className="icon-btn preview-remove" onClick={clearImage} aria-label="Remove image">
                  <X size={16} />
                </button>
              </div>
            )}
            {postError && <p className="alert" role="alert">{postError}</p>}
            <div className="composer-foot">
              <div className="composer-tools">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={pickImage} />
                <button type="button" className="tool-btn" onClick={() => fileRef.current.click()}>
                  <ImageIcon size={20} /> Photo
                </button>
                <span className={`count ${body.length > MAX - 200 ? 'count-warn' : ''}`}>
                  {body.length}/{MAX}
                </span>
              </div>
              <button type="submit" className="btn btn-primary" disabled={posting || (!body.trim() && !image)}>
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </form>

        {loadError && <p className="alert" role="alert">{loadError}</p>}

        {loading ? (
          <div className="panel post-list" aria-busy="true" aria-label="Loading posts">
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
        ) : posts.length === 0 ? (
          !loadError && (
            <div className="panel empty">
              <h3>No posts yet</h3>
              <p>Write the first one above. Everyone on the platform will see it here.</p>
            </div>
          )
        ) : (
          <ul className="post-stack">
          {posts.map((p) => (
              <li key={`${p.type ?? 'post'}-${p.id}`} className={`panel post ${p.type === 'paper' ? 'paper-feed-item' : ''}`}>
                {p.type === 'paper' ? <FeedPaper paper={p} /> : <>
                <Avatar name={p.author_name} src={p.author_avatar_url} />
                <div className="post-main">
                  <div className="post-head">
                    <Link to={`/users/${p.user_id}`} className="post-author"><strong>{p.author_name}</strong></Link>
                    {p.author_role !== 'user' && <span className="tag tag-teal">{ROLE_LABEL[p.author_role]}</span>}
                    <time dateTime={p.created_at} title={new Date(p.created_at).toLocaleString()}>
                      {timeAgo(p.created_at)}
                    </time>
                    {String(p.user_id) === String(me.id) && <button className="icon-btn post-edit" onClick={() => { setEditingId(p.id); setEditBody(p.body); setEditError('') }} aria-label="Edit post"><PencilSimple size={16} /></button>}
                    {String(p.user_id) === String(me.id) &&
                      (confirmId === p.id ? (
                        <span className="confirm">
                          <button className="link-danger" onClick={() => remove(p.id)}>Delete</button>
                          <button className="link-muted" onClick={() => setConfirmId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="icon-btn post-delete" onClick={() => setConfirmId(p.id)} aria-label="Edit or delete post">
                          <Trash size={16} />
                        </button>
                      ))}
                  </div>
                  {editingId === p.id ? <div className="post-edit-form">
                    <textarea aria-label="Edit post text" maxLength={MAX} rows={3} value={editBody} onChange={(event) => setEditBody(event.target.value)} />
                    {editError && <p className="alert" role="alert">{editError}</p>}
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(p.id)}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div> : p.body && <p className="post-body">{p.body}</p>}
                  {p.image_id && (
                    <img
                      className="post-image"
                      src={`/api/images/${p.image_id}`}
                      alt={p.body ? '' : `Image posted by ${p.author_name}`}
                      loading="lazy"
                    />
                  )}
                  <PostActions post={p} viewerId={me.id} onUpdate={updatePost} onLogout={onLogout} />
                </div>
                </>}
              </li>
            ))}
          </ul>
        )}
        {!loading && hasMore && <button className="btn btn-ghost btn-block load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more posts'}</button>}
      </main>

      <aside className="rail">
        <section className="panel profile">
          <div className="profile-cover" />
          <Avatar name={me.name} size="lg" src={me.avatar_url} />
          <h2 className="profile-name">{me.name}</h2>
          <p className="profile-email">{me.email}</p>
          <dl className="profile-stats">
            <div>
              <dd>{me.post_count ?? '-'}</dd>
              <dt>Posts</dt>
            </div>
            <div>
              <dd>{ROLE_LABEL[me.role]}</dd>
              <dt>Role</dt>
            </div>
            <div>
              <dd>{new Date(me.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</dd>
              <dt>Joined</dt>
            </div>
          </dl>
        </section>

        <section className="panel rail-card">
          <div className="rail-head">
            <h3>Communities to join</h3>
            <Link to="/communities">See all</Link>
          </div>
          {communities.map((community) => (
            <Link key={community.id} to={`/communities/${community.id}`} className="rail-row">
              <span className="tile tile-blue">{community.name[0]}</span>
              <span>
                <strong>{community.name}</strong>
                <small>{community.member_count} members</small>
              </span>
            </Link>
          ))}
        </section>

        <section className="panel rail-card">
          <div className="rail-head">
            <h3>Upcoming events</h3>
            <Link to="/events">See all</Link>
          </div>
          {upcomingEvents.map((event) => (
            <Link key={event.id} to={`/events/${event.id}`} className="rail-row">
              <span className="date-chip">
                <b>{new Date(event.starts_at).toLocaleDateString(undefined, { day: '2-digit' })}</b>
                {new Date(event.starts_at).toLocaleDateString(undefined, { month: 'short' })}
              </span>
              <span>
                <strong>{event.title}</strong>
                <small>{event.kind}, {event.location}</small>
              </span>
            </Link>
          ))}
        </section>
      </aside>
    </div>
  )
}

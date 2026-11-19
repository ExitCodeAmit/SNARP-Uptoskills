import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash, PencilSimple, ThumbsUp, ChatCircle, ShareFat, Flag, BookmarkSimple, X, Eye } from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from './ui'
import { Overlay } from './Overlay'
import { ROLE_LABEL, timeAgo } from '../format'
import { ExpandableText, Linkify } from './RichText'

const MAX = 5000
const compactViews = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const MODERATOR_ROLES = ['admin', 'moderator']

const KINDS = {
  post: {
    base: (id) => `/posts/${id}`,
    comment: (id) => `/comments/${id}`,
    url: (item) => `${location.origin}/users/${item.user_id}?post=${item.id}#post-${item.id}`,
    title: 'SNARP post',
  },
  paper: {
    base: (id) => `/papers/${id}`,
    comment: (id) => `/paper-comments/${id}`,
    url: (item) => `${location.origin}/articles/${item.id}`,
    title: 'SNARP paper',
  },
}

export function PostActions({ post, kind = 'post', viewerId, canModerate, onUpdate, onLogout, children }) {
  const endpoints = KINDS[kind]
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState(null)
  const [scrollEnd, setScrollEnd] = useState(0)
  const listRef = useRef(null)
  const [draft, setDraft] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleError = (err) => {
    if (err.status === 401 && onLogout) onLogout()
    else setError(err.message)
  }

  const openComments = async () => {
    setCommentsOpen(true)
    setComments(null)
    setError('')
    try { setComments(await api(`${endpoints.base(post.id)}/comments`)) }
    catch (err) { setComments([]); handleError(err) }
  }
  const closeComments = () => { setCommentsOpen(false); setError('') }

  useEffect(() => {
    const list = listRef.current
    if (scrollEnd && list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [scrollEnd])

  const toggleLike = async () => {
    setBusy(true)
    setError('')
    try {
      onUpdate({ ...post, ...await api(`${endpoints.base(post.id)}/like`, { method: 'PUT', body: { liked: !post.liked_by_me } }) })
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  const addComment = async (event) => {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const comment = await api(`${endpoints.base(post.id)}/comments`, { method: 'POST', body: { body: draft } })
      setComments((current) => [...(current ?? []), comment])
      setDraft('')
      setScrollEnd((value) => value + 1)
      onUpdate({ ...post, comment_count: (post.comment_count ?? 0) + 1 })
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  const deleteComment = async (comment) => {
    try {
      await api(endpoints.comment(comment.id), { method: 'DELETE' })
      setComments((current) => (current ?? []).filter((item) => item.id !== comment.id))
      onUpdate({ ...post, comment_count: Math.max(0, (post.comment_count ?? 1) - 1) })
    } catch (err) { handleError(err) }
  }

  const toggleSave = async () => {
    setBusy(true)
    setError('')
    try {
      onUpdate({ ...post, ...await api(`${endpoints.base(post.id)}/save`, { method: 'PUT', body: { saved: !post.saved_by_me } }) })
    } catch (err) { handleError(err) }
    finally { setBusy(false) }
  }

  const share = async () => {
    const url = endpoints.url(post)
    try {
      if (navigator.share) await navigator.share({ title: endpoints.title, text: post.body ?? post.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied')
        setTimeout(() => setNotice(''), 2000)
      }
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

  const likes = post.like_count ?? 0
  const commentCount = post.comment_count ?? 0
  return (
    <>
      <div className="post-actions">
        <button className={post.liked_by_me ? 'active' : ''} onClick={toggleLike} aria-pressed={!!post.liked_by_me} disabled={busy} title={post.liked_by_me ? 'Unlike' : 'Like'}>
          <ThumbsUp size={16} weight={post.liked_by_me ? 'fill' : 'regular'} /> {likes} <span className="sr-only">{likes === 1 ? 'like' : 'likes'}</span>
        </button>
        <button className={commentsOpen ? 'active-soft' : ''} onClick={openComments} aria-haspopup="dialog" title="Comments">
          <ChatCircle size={16} /> {commentCount} <span className="sr-only">{commentCount === 1 ? 'comment' : 'comments'}</span>
        </button>
        <button onClick={share} title="Share"><ShareFat size={16} /> {notice || 'Share'}</button>
        {kind === 'paper' && (
          <button className={post.saved_by_me ? 'active' : ''} onClick={toggleSave} aria-pressed={!!post.saved_by_me} disabled={busy} title={post.saved_by_me ? 'Remove from saved papers' : 'Save to your reading list'}>
            <BookmarkSimple size={16} weight={post.saved_by_me ? 'fill' : 'regular'} /> {post.saved_by_me ? 'Saved' : 'Save'}
          </button>
        )}
        {children}
        {kind === 'post' && String(post.user_id) !== String(viewerId) && (
          <button className="post-report" onClick={() => setReportOpen(!reportOpen)} disabled={reportSent} title="Report">
            <Flag size={16} /> {reportSent ? 'Reported' : 'Report'}
          </button>
        )}
        {post.view_count != null && (
          <span className="post-views" title={`${post.view_count.toLocaleString('en')} ${post.view_count === 1 ? 'person has' : 'people have'} viewed this`}>
            <Eye size={16} /> {compactViews.format(post.view_count)} <span>{post.view_count === 1 ? 'view' : 'views'}</span>
          </span>
        )}
      </div>
      {error && !commentsOpen && <p className="field-error" role="alert">{error}</p>}
      {commentsOpen && (
        <Overlay className="comments-sheet" labelledBy={`comments-title-${kind}-${post.id}`} onClose={closeComments}>
          <span className="comments-grip" aria-hidden="true" />
          <header className="comments-sheet-head">
            <h2 id={`comments-title-${kind}-${post.id}`}>Comments <span>{commentCount}</span></h2>
            <button type="button" className="icon-btn" onClick={closeComments} aria-label="Close comments"><X size={18} /></button>
          </header>
          <div className="comments-sheet-list" ref={listRef}>
            {post.author_name && (post.body || post.title) && (
              <div className="comment-row comment-caption">
                <Avatar name={post.author_name} src={post.author_avatar_url} size="sm" />
                <div>
                  <p className="comment-head">
                    <Link to={`/users/${post.user_id}`} onClick={closeComments}><strong>{post.author_name}</strong></Link>
                    <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
                  </p>
                  <p className="comment-caption-text">{post.title ?? post.body}</p>
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
                    <Link to={`/users/${comment.user_id}`} onClick={closeComments}><strong>{comment.author_name}</strong></Link>
                    <time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>
                  </p>
                  <p><Linkify text={comment.body} /></p>
                </div>
                {(String(comment.user_id) === String(viewerId) || String(post.user_id) === String(viewerId) || canModerate) && (
                  <button className="link-danger" onClick={() => deleteComment(comment)}>{String(comment.user_id) === String(viewerId) ? 'Delete' : 'Remove'}</button>
                )}
              </div>
            ))}
          </div>
          {error && <p className="field-error comments-sheet-error" role="alert">{error}</p>}
          <form className="comments-sheet-form" onSubmit={addComment}>
            <label className="sr-only" htmlFor={`comment-${kind}-${post.id}`}>Add a comment</label>
            <input id={`comment-${kind}-${post.id}`} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a comment…" autoComplete="off" />
            <button disabled={busy || !draft.trim()}>Post</button>
          </form>
        </Overlay>
      )}
      {reportOpen && (
        <form className="report-form" onSubmit={report}>
          <label htmlFor={`report-${post.id}`}>Why are you reporting this post?</label>
          <textarea id={`report-${post.id}`} minLength={5} maxLength={1000} value={reportReason} onChange={(event) => setReportReason(event.target.value)} required />
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || reportReason.trim().length < 5}>Submit report</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReportOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </>
  )
}

export default function PostCard({ post, viewerId, viewerRole, onUpdate, onRemove, onLogout, as: Tag = 'li' }) {
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const mine = String(post.user_id) === String(viewerId)
  const canModerate = MODERATOR_ROLES.includes(viewerRole)

  const handleError = (err) => (err.status === 401 && onLogout ? onLogout() : setError(err.message))

  const saveEdit = async () => {
    setError('')
    try {
      onUpdate(await api(`/posts/${post.id}`, { method: 'PATCH', body: { body: editBody } }))
      setEditing(false)
    } catch (err) { handleError(err) }
  }

  const remove = async () => {
    try {
      await api(`/posts/${post.id}`, { method: 'DELETE' })
      onRemove(post.id)
    } catch (err) { handleError(err) }
    setConfirming(false)
  }

  return (
    <Tag id={`post-${post.id}`} className="panel post">
      <Link to={`/users/${post.user_id}`} tabIndex={-1} aria-hidden="true">
        <Avatar name={post.author_name} src={post.author_avatar_url} size="md" />
      </Link>
      <div className="post-main">
        <div className="post-head">
          <div className="post-who">
            <span className="post-who-line">
              <Link to={`/users/${post.user_id}`} className="post-author"><strong>{post.author_name}</strong></Link>
              {post.author_role && post.author_role !== 'user' && <span className="tag">{ROLE_LABEL[post.author_role]}</span>}
            </span>
            <time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>
              {timeAgo(post.created_at)}
            </time>
          </div>
          {(mine || canModerate) && !editing && (confirming ? (
            <span className="confirm">
              <button className="link-danger" onClick={remove}>{mine ? 'Delete' : 'Remove post'}</button>
              <button className="link-muted" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          ) : (
            <span className="post-owner-actions">
              {mine && <button className="icon-btn" onClick={() => { setEditing(true); setEditBody(post.body); setError('') }} aria-label="Edit post" title="Edit"><PencilSimple size={16} /></button>}
              <button className="icon-btn" onClick={() => setConfirming(true)} aria-label={mine ? 'Delete post' : 'Remove post as moderator'} title={mine ? 'Delete' : 'Remove as moderator'}><Trash size={16} /></button>
            </span>
          ))}
        </div>
        {editing ? (
          <div className="post-edit-form">
            <textarea aria-label="Edit post text" maxLength={MAX} rows={3} value={editBody} onChange={(event) => setEditBody(event.target.value)} />
            <div className="form-actions">
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : post.body && <ExpandableText className="post-body" text={post.body} />}
        {error && <p className="alert" role="alert">{error}</p>}
        {post.image_id && (
          <img
            className="post-image"
            src={`/api/images/${post.image_id}`}
            alt={post.body ? '' : `Image posted by ${post.author_name}`}
            loading="lazy"
          />
        )}
        <PostActions post={post} viewerId={viewerId} canModerate={canModerate} onUpdate={onUpdate} onLogout={onLogout} />
      </div>
    </Tag>
  )
}

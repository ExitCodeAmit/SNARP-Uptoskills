
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Trash,
  Image as ImageIcon,
  X,
  ThumbsUp,
  ChatCircle,
  ShareFat,
  FilePdf,
  BookmarkSimple,
  Sparkle,
} from '@phosphor-icons/react'
import { api, apiBlob } from './api'
import { Avatar } from './components/ui'
import { ROLE_LABEL, timeAgo } from './format'
import { COMMUNITIES, EVENTS } from './sample'

const MAX = 5000
const MAX_IMAGE = 5 * 1024 * 1024

// Paper of the Day hero card styles
const featuredCardStyle = {
  width: '100%',
  maxWidth: '760px',
  minHeight: '400px',
  boxSizing: 'border-box',
  margin: '0 auto 24px',
  padding: '32px',
  border: '1px solid #dbe5ef',
  borderRadius: '22px',
  background: 'linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%)',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: '20px',
}

const featuredHeadingStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '12px',
  fontSize: '21px',
  fontWeight: 800,
  color: '#1e3a5f',
  paddingBottom: '18px',
  borderBottom: '1px solid #dbe5ef',
}

const featuredEmptyTitleStyle = {
  fontSize: '23px',
  fontWeight: 700,
  color: '#1e293b',
  textAlign: 'center',
  margin: 0,
  paddingBottom: '16px',
  borderBottom: '1px solid #e2e8f0',
}

const featuredEmptyTextStyle = {
  fontSize: '15px',
  lineHeight: 1.7,
  color: '#64748b',
  textAlign: 'center',
  margin: 0,
}

// Reusable authenticated PDF viewer.
function PaperPdfViewer({ paperId, title, onClose }) {
  const [pdfUrl, setPdfUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let objectUrl

    const loadPdf = async () => {
      setLoading(true)
      setError('')

      try {
        const blob = await apiBlob(`/papers/${paperId}/pdf`)
        objectUrl = URL.createObjectURL(blob)
        setPdfUrl(objectUrl)
      } catch (err) {
        setError(err.message || 'Could not open the research paper')
      } finally {
        setLoading(false)
      }
    }

    loadPdf()

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [paperId])

  return (
    <div className="paper-pdf-preview">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onClose}
      >
        Close PDF
      </button>

      {loading && <p>Loading research paper…</p>}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {pdfUrl && (
        <iframe
          title={`PDF: ${title}`}
          src={pdfUrl}
        />
      )}
    </div>
  )
}

function FeedPaper({ paper }) {
  const [showPdf, setShowPdf] = useState(false)

  const authors = (paper.authors ?? [])
    .map((author) => typeof author === 'string' ? author : author.name)
    .filter(Boolean)

  return (
    <>
      <div className="article-meta">
        <span className="tag tag-blue">
          Research paper · {paper.domain}
        </span>

        <time dateTime={paper.created_at}>
          {paper.created_at ? timeAgo(paper.created_at) : ''}
        </time>
      </div>

      <h2 className="paper-feed-title">{paper.title}</h2>

      <p className="article-authors">{authors.join(', ')}</p>

      <p className="article-abstract">{paper.abstract}</p>

      <div className="tag-row">
        {(paper.tags ?? []).map((tag) => (
          <span key={tag} className="tag">
            #{tag}
          </span>
        ))}
      </div>

      <div className="post-actions">
        <button
          type="button"
          onClick={() => setShowPdf(true)}
        >
          <FilePdf size={18} /> View paper
        </button>
      </div>

      {showPdf && (
        <PaperPdfViewer
          paperId={paper.id}
          title={paper.title}
          onClose={() => setShowPdf(false)}
        />
      )}
    </>
  )
}

// Updated Paper of the Day hero section
function FeaturedPaper({ paper, onLike, onSave, busy }) {
  const [showPdf, setShowPdf] = useState(false)

  if (!paper) {
    return (
      <section
        className="panel featured-paper featured-paper-empty"
        style={featuredCardStyle}
      >
        <div style={featuredHeadingStyle}>
          <Sparkle size={23} weight="fill" color="#f97316" />
          <span>Paper of the Day</span>
        </div>

        <h2 style={featuredEmptyTitleStyle}>
          No featured paper yet
        </h2>

        <p style={featuredEmptyTextStyle}>
          An approved research paper will appear here when one is available.
        </p>
      </section>
    )
  }

  const authors = (paper.authors ?? [])
    .map((author) => typeof author === 'string' ? author : author.name)
    .filter(Boolean)

  return (
    <section
      className="panel featured-paper"
      style={featuredCardStyle}
    >
      {/* Hero heading */}
      <div style={featuredHeadingStyle}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <Sparkle size={23} weight="fill" color="#f97316" />
          Paper of the Day
        </span>

        <span className="tag tag-blue">
          Featured research
        </span>
      </div>

      {/* Paper title */}
      <h2
        style={{
          margin: 0,
          color: '#1e293b',
          fontSize: '26px',
          fontWeight: 800,
          lineHeight: 1.4,
          textDecoration: 'underline',
          textUnderlineOffset: '6px',
          textDecorationColor: '#3b82f6',
          textDecorationThickness: '2px',
        }}
      >
        {paper.title}
      </h2>

      {/* Authors */}
      {authors.length > 0 && (
        <p
          style={{
            margin: 0,
            color: '#475569',
            fontSize: '15px',
            fontWeight: 600,
          }}
        >
          By {authors.join(', ')}
        </p>
      )}

      {/* Research domain */}
      {paper.domain && (
        <span
          className="tag tag-teal"
          style={{
            alignSelf: 'flex-start',
          }}
        >
          {paper.domain}
        </span>
      )}

      {/* Abstract */}
      <p
        className="featured-paper-abstract"
        style={{
          margin: 0,
          color: '#475569',
          fontSize: '15px',
          lineHeight: 1.8,
        }}
      >
        {paper.abstract}
      </p>

      {/* Aligned likes, saves and actions */}
      <div
        className="featured-paper-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          paddingTop: '18px',
          borderTop: '1px solid #dbe5ef',
        }}
      >
        {/* Like and save counts */}
        <div
          className="featured-paper-stats"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '22px',
            color: '#475569',
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ThumbsUp size={17} />
            {paper.likes_count ?? 0} Likes
          </span>

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <BookmarkSimple size={17} />
            {paper.saves_count ?? 0} Saves
          </span>
        </div>

        {/* Like and save buttons */}
        <div
          className="featured-paper-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className={paper.is_liked ? 'active' : ''}
            onClick={onLike}
            disabled={busy}
            aria-pressed={Boolean(paper.is_liked)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 15px',
              borderRadius: '9px',
              fontWeight: 700,
            }}
          >
            <ThumbsUp
              size={18}
              weight={paper.is_liked ? 'fill' : 'regular'}
            />

            {paper.is_liked ? 'Liked' : 'Like'}
          </button>

          <button
            type="button"
            className={paper.is_saved ? 'active' : ''}
            onClick={onSave}
            disabled={busy}
            aria-pressed={Boolean(paper.is_saved)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 15px',
              borderRadius: '9px',
              fontWeight: 700,
            }}
          >
            <BookmarkSimple
              size={18}
              weight={paper.is_saved ? 'fill' : 'regular'}
            />

            {paper.is_saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Read paper button */}
      <div className="featured-paper-read">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowPdf(true)}
          style={{
            width: '100%',
            justifyContent: 'center',
            padding: '13px',
            borderRadius: '10px',
            fontWeight: 700,
          }}
        >
          <FilePdf size={19} />
          Read Research Paper
        </button>
      </div>

      {showPdf && (
        <PaperPdfViewer
          paperId={paper.id}
          title={paper.title}
          onClose={() => setShowPdf(false)}
        />
      )}
    </section>
  )
}

function PastPicks({ picks, loading }) {
  const [selectedPaper, setSelectedPaper] = useState(null)

  return (
    <section className="panel rail-card past-picks">
      <div className="rail-head">
        <h3>Past Picks</h3>
      </div>

      {loading ? (
        <p className="past-picks-empty">
          Loading past picks…
        </p>
      ) : picks.length === 0 ? (
        <p className="past-picks-empty">
          Previous featured papers will appear here.
        </p>
      ) : (
        <div className="past-picks-list">
          {picks.map((paper) => (
            <button
              key={`${paper.id}-${paper.featured_date ?? paper.created_at}`}
              type="button"
              className="past-pick"
              onClick={() => setSelectedPaper(paper)}
            >
              <strong>{paper.title}</strong>

              <small>
                {paper.featured_date
                  ? new Date(
                      `${paper.featured_date}T00:00:00`
                    ).toLocaleDateString()
                  : paper.created_at
                    ? new Date(paper.created_at).toLocaleDateString()
                    : 'Previously featured'}
              </small>
            </button>
          ))}
        </div>
      )}

      {selectedPaper && (
        <PaperPdfViewer
          paperId={selectedPaper.id}
          title={selectedPaper.title}
          onClose={() => setSelectedPaper(null)}
        />
      )}
    </section>
  )
}

function PostActions() {
  const [liked, setLiked] = useState(false)

  return (
    <div className="post-actions">
      <button
        className={liked ? 'active' : ''}
        onClick={() => setLiked(!liked)}
        aria-pressed={liked}
      >
        <ThumbsUp size={18} weight={liked ? 'fill' : 'regular'} />
        Like
      </button>

      <button type="button">
        <ChatCircle size={18} /> Comment
      </button>

      <button type="button">
        <ShareFat size={18} /> Share
      </button>
    </div>
  )
}

export default function Feed({ user, onLogout }) {
  const [me, setMe] = useState(user)
  const [posts, setPosts] = useState([])
  const [featured, setFeatured] = useState(null)
  const [pastPicks, setPastPicks] = useState([])
  const [pastPicksLoading, setPastPicksLoading] = useState(true)
  const [featuredBusy, setFeaturedBusy] = useState(false)
  const [featuredError, setFeaturedError] = useState('')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [body, setBody] = useState('')
  const [image, setImage] = useState(null)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  const fileRef = useRef(null)

  const handle = (setError) => (err) => {
    if (err.status === 401) {
      onLogout()
    } else {
      setError(err.message)
    }
  }

  useEffect(() => {
    Promise.all([
      api('/posts'),
      api('/auth/me'),
      api('/papers/featured'),
      api('/papers/past-picks'),
    ])
      .then(([p, m, featuredData, pastData]) => {
        setPosts(p)
        setMe(m)

        setFeatured(featuredData?.paper ?? featuredData ?? null)

        setPastPicks(
          Array.isArray(pastData)
            ? pastData
            : pastData?.picks ?? []
        )
      })
      .catch((err) => {
        handle(setLoadError)(err)
      })
      .finally(() => {
        setLoading(false)
        setPastPicksLoading(false)
      })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleFeaturedAction = async (action) => {
    if (!featured || featuredBusy) return

    setFeaturedBusy(true)
    setFeaturedError('')

    const property = action === 'like' ? 'is_liked' : 'is_saved'
    const countProperty = action === 'like' ? 'likes_count' : 'saves_count'

    const previousValue = Boolean(featured[property])
    const nextValue = !previousValue

    setFeatured((current) => ({
      ...current,
      [property]: nextValue,
      [countProperty]: Math.max(
        0,
        (current[countProperty] ?? 0) + (nextValue ? 1 : -1)
      ),
    }))

    try {
      const result = await api(`/papers/${featured.id}/${action}`, {
        method: 'POST',
      })

      const serverValue = result?.[property]
        ?? result?.[action === 'like' ? 'liked' : 'saved']

      if (typeof serverValue === 'boolean') {
        setFeatured((current) => ({
          ...current,
          [property]: serverValue,
        }))
      }
    } catch (err) {
      setFeatured((current) => ({
        ...current,
        [property]: previousValue,
        [countProperty]: Math.max(
          0,
          (current[countProperty] ?? 0) + (previousValue ? 1 : -1)
        ),
      }))

      handle(setFeaturedError)(err)
    } finally {
      setFeaturedBusy(false)
    }
  }

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image.url)
    setImage(null)
  }

  const pickImage = (e) => {
    const file = e.target.files[0]
    e.target.value = ''

    if (!file) return

    if (!file.type.startsWith('image/')) {
      return setPostError('Choose an image file')
    }

    if (file.size > MAX_IMAGE) {
      return setPostError('Image must be 5 MB or smaller')
    }

    setPostError('')
    clearImage()

    setImage({
      file,
      url: URL.createObjectURL(file),
    })
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

      const post = await api('/posts', {
        method: 'POST',
        body: form,
      })

      setPosts((prev) => [post, ...prev])

      setMe((m) => ({
        ...m,
        post_count: (m.post_count ?? 0) + 1,
      }))

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
      await api(`/posts/${id}`, {
        method: 'DELETE',
      })

      setPosts((prev) => prev.filter((p) => p.id !== id))

      setMe((m) => ({
        ...m,
        post_count: Math.max(0, (m.post_count ?? 1) - 1),
      }))
    } catch (err) {
      handle(setLoadError)(err)
    }

    setConfirmId(null)
  }

  return (
    <div className="feed-layout">
      <main className="feed">
        <div className="welcome">
          <h1>Good to see you, {me.name.split(' ')[0]}</h1>
          <p>Share what you are working on with the community.</p>
        </div>

        {featuredError && (
          <p className="alert" role="alert">
            {featuredError}
          </p>
        )}

        <FeaturedPaper
          paper={featured}
          busy={featuredBusy}
          onLike={() => toggleFeaturedAction('like')}
          onSave={() => toggleFeaturedAction('save')}
        />

        <form className="composer panel" onSubmit={submit}>
          <Avatar name={me.name} />

          <div className="composer-main">
            <label htmlFor="post-body" className="sr-only">
              Write a post
            </label>

            <textarea
              id="post-body"
              rows={3}
              maxLength={MAX}
              placeholder="Share an update, a finding, or a photo"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                (e.ctrlKey || e.metaKey) &&
                submit()
              }
            />

            {image && (
              <div className="composer-preview">
                <img
                  src={image.url}
                  alt="Selected upload preview"
                />

                <button
                  type="button"
                  className="icon-btn preview-remove"
                  onClick={clearImage}
                  aria-label="Remove image"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {postError && (
              <p className="alert" role="alert">
                {postError}
              </p>
            )}

            <div className="composer-foot">
              <div className="composer-tools">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                  onChange={pickImage}
                />

                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => fileRef.current.click()}
                >
                  <ImageIcon size={20} /> Photo
                </button>

                <span
                  className={`count ${
                    body.length > MAX - 200 ? 'count-warn' : ''
                  }`}
                >
                  {body.length}/{MAX}
                </span>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={posting || (!body.trim() && !image)}
              >
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </form>

        {loadError && (
          <p className="alert" role="alert">
            {loadError}
          </p>
        )}

        {loading ? (
          <div
            className="panel post-list"
            aria-busy="true"
            aria-label="Loading posts"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="post">
                <div className="avatar skeleton" />

                <div className="post-main">
                  <div
                    className="skeleton skeleton-line"
                    style={{ width: '30%' }}
                  />

                  <div className="skeleton skeleton-line" />

                  <div
                    className="skeleton skeleton-line"
                    style={{ width: '70%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          !loadError && (
            <div className="panel empty">
              <h3>No posts yet</h3>

              <p>
                Write the first one above. Everyone on the platform will see it here.
              </p>
            </div>
          )
        ) : (
          <ul className="post-stack">
            {posts.map((p) => (
              <li
                key={`${p.type ?? 'post'}-${p.id}`}
                className={`panel post ${
                  p.type === 'paper' ? 'paper-feed-item' : ''
                }`}
              >
                {p.type === 'paper' ? (
                  <FeedPaper paper={p} />
                ) : (
                  <>
                    <Avatar name={p.author_name} />

                    <div className="post-main">
                      <div className="post-head">
                        <strong>{p.author_name}</strong>

                        {p.author_role !== 'user' && (
                          <span className="tag tag-teal">
                            {ROLE_LABEL[p.author_role]}
                          </span>
                        )}

                        <time
                          dateTime={p.created_at}
                          title={new Date(p.created_at).toLocaleString()}
                        >
                          {timeAgo(p.created_at)}
                        </time>

                        {p.user_id === me.id &&
                          (confirmId === p.id ? (
                            <span className="confirm">
                              <button
                                className="link-danger"
                                onClick={() => remove(p.id)}
                              >
                                Delete
                              </button>

                              <button
                                className="link-muted"
                                onClick={() => setConfirmId(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="icon-btn post-delete"
                              onClick={() => setConfirmId(p.id)}
                              aria-label="Delete post"
                            >
                              <Trash size={16} />
                            </button>
                          ))}
                      </div>

                      {p.body && (
                        <p className="post-body">{p.body}</p>
                      )}

                      {p.image_id && (
                        <img
                          className="post-image"
                          src={`/api/images/${p.image_id}`}
                          alt={
                            p.body
                              ? ''
                              : `Image posted by ${p.author_name}`
                          }
                          loading="lazy"
                        />
                      )}

                      <PostActions />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <aside className="rail">
        <section className="panel profile">
          <div className="profile-cover" />

          <Avatar name={me.name} size="lg" />

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
              <dd>
                {new Date(me.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  year: 'numeric',
                })}
              </dd>
              <dt>Joined</dt>
            </div>
          </dl>
        </section>

        <PastPicks
          picks={pastPicks}
          loading={pastPicksLoading}
        />

        <section className="panel rail-card">
          <div className="rail-head">
            <h3>Communities to join</h3>
            <Link to="/communities">See all</Link>
          </div>

          {COMMUNITIES.slice(0, 3).map((c) => (
            <Link
              key={c.id}
              to="/communities"
              className="rail-row"
            >
              <span className={`tile tile-${c.color}`}>
                {c.name[0]}
              </span>

              <span>
                <strong>{c.name}</strong>
                <small>{c.members} members</small>
              </span>
            </Link>
          ))}
        </section>

        <section className="panel rail-card">
          <div className="rail-head">
            <h3>Upcoming events</h3>
            <Link to="/events">See all</Link>
          </div>

          {EVENTS.slice(0, 2).map((e) => (
            <Link
              key={e.id}
              to="/events"
              className="rail-row"
            >
              <span className="date-chip">
                <b>{e.day}</b>
                {e.month}
              </span>

              <span>
                <strong>{e.title}</strong>
                <small>{e.kind}, {e.place}</small>
              </span>
            </Link>
          ))}
        </section>
      </aside>
    </div>
  )
}

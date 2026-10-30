import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Trash, Image as ImageIcon, X, ThumbsUp, ChatCircle, ShareFat, FilePdf } from '@phosphor-icons/react'
import { api, apiBlob } from './api'
import { SaveButton } from './Saved'
import { Avatar } from './components/ui'
import { ROLE_LABEL, timeAgo } from './format'
import { COMMUNITIES, EVENTS } from './sample'

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
    <div className="post-actions"><button onClick={openPdf}><FilePdf size={18} /> View paper</button><SaveButton itemType="paper" itemId={paper.id} {...paper} /></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {pdfUrl && <div className="paper-pdf-preview"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPdfUrl('')}>Close PDF</button><iframe title={`PDF: ${paper.title}`} src={pdfUrl} /></div>}
  </>
}

// ponytail: like/comment/share are UI only; like toggles locally and is not saved
function PostActions({ post }) {
  const [liked, setLiked] = useState(false)
  return (
    <div className="post-actions">
      <button className={liked ? 'active' : ''} onClick={() => setLiked(!liked)} aria-pressed={liked}>
        <ThumbsUp size={18} weight={liked ? 'fill' : 'regular'} /> Like
      </button>
      <button><ChatCircle size={18} /> Comment</button>
      <button><ShareFat size={18} /> Share</button>
      <SaveButton itemType="post" itemId={post.id} {...post} />
    </div>
  )
}

export default function Feed({ user, onLogout }) {
  const [me, setMe] = useState(user)
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [body, setBody] = useState('')
  const [image, setImage] = useState(null) // { file, url } for the preview
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const fileRef = useRef(null)

  // Any 401 means the token expired or was revoked
  const handle = (setError) => (err) => (err.status === 401 ? onLogout() : setError(err.message))

  useEffect(() => {
    Promise.all([api('/posts'), api('/auth/me')])
      .then(([p, m]) => {
        setPosts(p)
        setMe(m)
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

  return (
    <div className="feed-layout">
      <main className="feed">
        <div className="welcome">
          <h1>Good to see you, {me.name.split(' ')[0]}</h1>
          <p>Share what you are working on with the community.</p>
        </div>

        <form className="composer panel" onSubmit={submit}>
          <Avatar name={me.name} />
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
                <Avatar name={p.author_name} />
                <div className="post-main">
                  <div className="post-head">
                    <strong>{p.author_name}</strong>
                    {p.author_role !== 'user' && <span className="tag tag-teal">{ROLE_LABEL[p.author_role]}</span>}
                    <time dateTime={p.created_at} title={new Date(p.created_at).toLocaleString()}>
                      {timeAgo(p.created_at)}
                    </time>
                    {p.user_id === me.id &&
                      (confirmId === p.id ? (
                        <span className="confirm">
                          <button className="link-danger" onClick={() => remove(p.id)}>Delete</button>
                          <button className="link-muted" onClick={() => setConfirmId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="icon-btn post-delete" onClick={() => setConfirmId(p.id)} aria-label="Delete post">
                          <Trash size={16} />
                        </button>
                      ))}
                  </div>
                  {p.body && <p className="post-body">{p.body}</p>}
                  {p.image_id && (
                    <img
                      className="post-image"
                      src={`/api/images/${p.image_id}`}
                      alt={p.body ? '' : `Image posted by ${p.author_name}`}
                      loading="lazy"
                    />
                  )}
                  <PostActions post={p} />
                </div>
                </>}
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
          {COMMUNITIES.slice(0, 3).map((c) => (
            <Link key={c.id} to="/communities" className="rail-row">
              <span className={`tile tile-${c.color}`}>{c.name[0]}</span>
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
            <Link key={e.id} to="/events" className="rail-row">
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

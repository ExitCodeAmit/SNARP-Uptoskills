// Sample-backed UI pages remain alongside the database-backed social features.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Users, MapPin, Clock, FilePdf, Copy, Check, PaperPlaneRight, UploadSimple,
  Heart, ChatCircle, SealCheck, CaretDown, Plus, X, Bell,
} from '@phosphor-icons/react'
import { Avatar, PageHeader } from '../components/ui'
import { ROLE_LABEL } from '../format'
import { apa, bibtex } from '../cite'
import { FAQ } from '../sample'
import { api, apiBlob } from '../api'

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
      {done ? <Check size={16} /> : <Copy size={16} />} {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function CommunityCard({ community, onMembership }) {
  return (
    <article className="panel community">
      <div className="community-band band-blue" />
      <span className="tile tile-lg tile-blue">{community.name[0]}</span>
      <h3><Link to={`/communities/${community.id}`}>{community.name}</Link></h3>
      <p className="muted-sm"><Users size={14} /> {community.member_count} members · {community.category}</p>
      <p className="community-tagline">{community.description || `A space for ${community.category} research and discussion.`}</p>
      <div className="community-card-actions"><button className={`btn btn-block ${community.joined ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => onMembership(community)} disabled={community.membership_role === 'owner'}>
        {community.membership_role === 'owner' ? 'Community owner' : community.joined ? 'Leave community' : 'Join community'}
      </button><Link className="btn btn-ghost btn-block" to={`/communities/${community.id}`}>Open community</Link></div>
    </article>
  )
}

export function Communities() {
  const [result, setResult] = useState({ key: '', items: [], error: '', hasMore: false })
  const [form, setForm] = useState({ name: '', category: '', description: '' })
  const [query, setQuery] = useState('')
  const [communityPage, setCommunityPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const requestKey = `${query}:${communityPage}:${refresh}`
  useEffect(() => {
    let active = true
    api(`/communities?q=${encodeURIComponent(query)}&page=${communityPage}`)
      .then((response) => { if (active) setResult({ key: requestKey, items: response.items, error: '', hasMore: response.hasMore }) })
      .catch((err) => { if (active) setResult({ key: requestKey, items: [], error: err.message, hasMore: false }) })
    return () => { active = false }
  }, [query, communityPage, requestKey])
  const communities = result.key === requestKey ? result.items : []
  const loading = result.key !== requestKey
  const error = actionError || (result.key === requestKey ? result.error : '')
  const membership = async (community) => {
    try {
      await api(`/communities/${community.id}/membership`, { method: 'PUT', body: { joined: !community.joined } })
      setActionError('')
      setRefresh((value) => value + 1)
    } catch (err) { setActionError(err.message) }
  }
  const create = async (event) => {
    event.preventDefault(); setSaving(true); setActionError('')
    try {
      await api('/communities', { method: 'POST', body: form })
      setForm({ name: '', category: '', description: '' }); setRefresh((value) => value + 1)
    } catch (err) { setActionError(err.message) }
    finally { setSaving(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Communities" sub="Find people working on the same problems as you." />
      {error && <p className="alert" role="alert">{error}</p>}
      <form className="panel form-panel community-create" onSubmit={create}><h2>Create a community</h2><div className="form-row">
        <div className="field"><label htmlFor="community-name">Name</label><input id="community-name" maxLength={100} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="community-category">Research topic</label><input id="community-category" maxLength={120} required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Computer science, education…" /></div>
      </div><div className="field"><label htmlFor="community-description">Description</label><textarea id="community-description" maxLength={2000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div><button className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create community'}</button></form>
      <div className="field community-search"><label htmlFor="community-search">Find a community</label><input id="community-search" maxLength={120} value={query} onChange={(e) => { setQuery(e.target.value); setCommunityPage(1) }} placeholder="Search by name, topic, or description" /></div>
      {loading ? <p className="muted-sm">Loading communities…</p> : communities.length ? <div className="card-grid">{communities.map((community) => <CommunityCard key={community.id} community={community} onMembership={membership} />)}</div> : <div className="panel empty"><h3>No communities found</h3><p>Create one to start a research discussion group.</p></div>}
      {!loading && <div className="paper-pagination"><button className="btn btn-ghost" onClick={() => setCommunityPage((value) => Math.max(1, value - 1))} disabled={communityPage <= 1}>Previous</button><span className="muted-sm">Page {communityPage}</span><button className="btn btn-ghost" onClick={() => setCommunityPage((value) => value + 1)} disabled={!result.hasMore}>Next</button></div>}
    </div>
  )
}

export function CommunityDetail({ user }) {
  const { id } = useParams()
  const [community, setCommunity] = useState(null)
  const [members, setMembers] = useState([])
  const [posts, setPosts] = useState([])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [edit, setEdit] = useState(false)
  const load = async () => {
    try {
      const [detail, discussion, memberList] = await Promise.all([api(`/communities/${id}`), api(`/communities/${id}/posts?page=${page}`), api(`/communities/${id}/members`)])
      setCommunity(detail); setPosts(discussion.items); setHasMore(discussion.hasMore); setMembers(memberList); setError('')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    Promise.all([api(`/communities/${id}`), api(`/communities/${id}/posts?page=${page}`), api(`/communities/${id}/members`)])
      .then(([detail, discussion, memberList]) => {
        if (active) { setCommunity(detail); setPosts(discussion.items); setHasMore(discussion.hasMore); setMembers(memberList); setError('') }
      })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, page])
  const join = async () => {
    try {
      await api(`/communities/${id}/membership`, { method: 'PUT', body: { joined: !community.membership_role } })
      await load()
    } catch (err) { setError(err.message) }
  }
  const post = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await api(`/communities/${id}/posts`, { method: 'POST', body: { body } }); setBody(''); setPage(1); await load() }
    catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const update = async (event) => {
    event.preventDefault(); setSaving(true)
    try { const updated = await api(`/communities/${id}`, { method: 'PATCH', body: { name: community.name, category: community.category, description: community.description } }); setCommunity({ ...community, ...updated }); setEdit(false) }
    catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const removePost = async (postId) => {
    try { await api(`/communities/${id}/posts/${postId}`, { method: 'DELETE' }); await load() }
    catch (err) { setError(err.message) }
  }
  const updateMemberRole = async (member, role) => {
    try { await api(`/communities/${id}/members/${member.user_id}/role`, { method: 'PATCH', body: { role } }); await load() }
    catch (err) { setError(err.message) }
  }
  if (loading && !community) return <div className="page"><div className="panel empty" aria-busy="true">Loading community…</div></div>
  if (!community) return <div className="page"><p className="alert" role="alert">{error || 'Community not found'}</p><Link to="/communities">Back to communities</Link></div>
  const canManage = ['owner', 'moderator'].includes(community.membership_role) || ['admin', 'moderator'].includes(user?.role)
  const canManageMembers = community.membership_role === 'owner' || ['admin', 'moderator'].includes(user?.role)
  const canEditCommunity = community.membership_role === 'owner' || ['admin', 'moderator'].includes(user?.role)
  return <div className="page"><PageHeader title={community.name} sub={`${community.category} · ${community.member_count} members · Started by ${community.creator_name}`} />
    {error && <p className="alert" role="alert">{error}</p>}
    <section className="panel community-about"><p>{community.description || 'A place to share work, ask questions, and find research collaborators.'}</p><div className="article-actions"><button className="btn btn-secondary" onClick={join} disabled={community.membership_role === 'owner'}>{community.membership_role === 'owner' ? 'Community owner' : community.membership_role ? 'Leave community' : 'Join community'}</button>{canEditCommunity && <button className="btn btn-ghost" onClick={() => setEdit(!edit)}>{edit ? 'Cancel edit' : 'Edit community'}</button>}</div>
      {edit && canEditCommunity && <form className="community-edit" onSubmit={update}><label>Name<input maxLength={100} required value={community.name} onChange={(e) => setCommunity({ ...community, name: e.target.value })} /></label><label>Topic<input maxLength={120} required value={community.category} onChange={(e) => setCommunity({ ...community, category: e.target.value })} /></label><label>Description<textarea maxLength={2000} value={community.description} onChange={(e) => setCommunity({ ...community, description: e.target.value })} /></label><button className="btn btn-primary" disabled={saving}>Save community</button></form>}
    </section>
    <section className="panel community-members"><h2>Members</h2><div className="community-member-list">{members.map((member) => <div className="community-member" key={member.user_id}><Avatar name={member.name} src={member.avatar_url} size="sm" /><span><strong>{member.name}</strong><small>{member.role}</small></span>{canManageMembers && member.role !== 'owner' && <button className="btn btn-ghost btn-sm" onClick={() => updateMemberRole(member, member.role === 'moderator' ? 'member' : 'moderator')}>{member.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</button>}</div>)}</div>{members.length === 100 && <p className="muted-sm">Showing the first 100 members.</p>}</section>
    {community.membership_role && <form className="panel form-panel community-post-form" onSubmit={post}><label htmlFor="community-post-body">Start a discussion</label><textarea id="community-post-body" rows={3} maxLength={5000} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share a question, update, or collaboration idea…" /><button className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post to community'}</button></form>}
    <h2 className="section-title">Discussions</h2>{posts.length ? <div className="stack">{posts.map((item) => <article className="panel researcher-post" key={item.id}><div className="search-post-author"><Avatar name={item.author_name} src={item.author_avatar_url} size="sm" /><strong>{item.author_name}</strong></div><time>{new Date(item.created_at).toLocaleString()}</time><p>{item.body}</p>{(String(item.user_id) === String(user.id) || canManage) && <button className="link-danger" onClick={() => removePost(item.id)}>Remove post</button>}</article>)}</div> : <div className="panel empty"><p>No discussions yet. Join to start the first one.</p></div>}
    <div className="paper-pagination"><button className="btn btn-ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><span className="muted-sm">Page {page}</span><button className="btn btn-ghost" onClick={() => setPage((value) => value + 1)} disabled={!hasMore}>Next</button></div>
  </div>
}

export function Articles() {
  const [categories, setCategories] = useState([])
  const [filters, setFilters] = useState({ q: '', author: '', domain: '', tag: '', sort: 'newest' })
  const [applied, setApplied] = useState(filters)
  const [page, setPage] = useState(1)
  const [categoryError, setCategoryError] = useState('')
  const [result, setResult] = useState({ url: '', data: null, error: '' })

  useEffect(() => {
    api('/papers/categories').then(setCategories).catch((err) => setCategoryError(err.message))
  }, [])

  const searchParams = new URLSearchParams({ page: String(page), limit: '12', sort: applied.sort })
  for (const field of ['q', 'author', 'domain', 'tag']) if (applied[field].trim()) searchParams.set(field, applied[field].trim())
  const requestUrl = `/papers/search?${searchParams}`

  useEffect(() => {
    let active = true
    api(requestUrl)
      .then((data) => { if (active) setResult({ url: requestUrl, data, error: '' }) })
      .catch((err) => { if (active) setResult({ url: requestUrl, data: null, error: err.message }) })
    return () => { active = false }
  }, [requestUrl])

  const loading = result.url !== requestUrl
  const data = loading ? null : result.data
  const error = loading ? '' : result.error
  const update = (field, value) => setFilters((current) => ({ ...current, [field]: value }))
  const apply = (event) => {
    event.preventDefault()
    setPage(1)
    setApplied(filters)
  }

  return (
    <div className="page">
      <PageHeader title="Research papers" sub="Discover approved research by topic, author, or category." />
      <form className="panel paper-search-form" onSubmit={apply}>
        <div className="field"><label htmlFor="paper-query">Search papers</label><input id="paper-query" maxLength={200} value={filters.q} onChange={(event) => update('q', event.target.value)} placeholder="Title, abstract, DOI, or keyword" /></div>
        <div className="form-row">
          <div className="field"><label htmlFor="paper-author">Author</label><input id="paper-author" maxLength={120} value={filters.author} onChange={(event) => update('author', event.target.value)} placeholder="Author name" /></div>
          <div className="field"><label htmlFor="paper-tag">Keyword</label><input id="paper-tag" maxLength={40} value={filters.tag} onChange={(event) => update('tag', event.target.value)} placeholder="Research tag" /></div>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="paper-domain">Category</label><select id="paper-domain" value={filters.domain} onChange={(event) => update('domain', event.target.value)}><option value="">All categories</option>{categories.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></div>
          <div className="field"><label htmlFor="paper-sort">Sort by</label><select id="paper-sort" value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title_asc">Title A–Z</option><option value="title_desc">Title Z–A</option></select></div>
        </div>
        {categoryError && <p className="field-error" role="status">Categories could not be loaded.</p>}
        <button className="btn btn-primary" type="submit">Search papers</button>
      </form>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && <p className="muted-sm" aria-live="polite">Loading approved papers…</p>}
      <div className="stack">
        {(data?.items ?? []).map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}
      </div>
      {!loading && !error && data?.total === 0 && <div className="panel empty"><h3>No matching papers</h3><p>Try another author, keyword, or category.</p></div>}
      {!loading && data?.total > 0 && <div className="paper-pagination"><span className="muted-sm">{data.total} approved paper{data.total === 1 ? '' : 's'} · Page {data.page} of {Math.ceil(data.total / data.limit)}</span><div><button className="btn btn-ghost" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button><button className="btn btn-ghost" onClick={() => setPage((current) => current + 1)} disabled={!data.hasMore}>Next</button></div></div>}
    </div>
  )
}

function PaperPdf({ paperId, label = 'View paper' }) {
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  const open = async () => {
    setLoading(true)
    setError('')
    try { setPdfUrl(URL.createObjectURL(await apiBlob(`/papers/${paperId}/pdf`))) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <>
    <button type="button" className="btn btn-secondary btn-sm" onClick={open} disabled={loading}><FilePdf size={16} /> {loading ? 'Opening…' : label}</button>
    {error && <span className="field-error" role="alert">{error}</span>}
    {pdfUrl && <div className="paper-pdf-preview"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPdfUrl('')}>Close PDF</button><iframe title="Research paper PDF" src={pdfUrl} /></div>}
  </>
}

function PublishedPaperCard({ paper }) {
  const authorNames = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean)
  return <article className="panel article">
    <div className="article-meta"><span className="tag tag-blue">{paper.domain}</span><time className="muted-sm">Approved {new Date(paper.reviewed_at ?? paper.created_at).toLocaleDateString()}</time></div>
    <h3><Link to={`/articles/${paper.id}`}>{paper.title}</Link></h3>
    <p className="article-authors">{authorNames.join(', ')}</p>
    <p className="article-abstract">{paper.abstract}</p>
    <div className="tag-row">{(paper.tags ?? []).map((tag) => <span key={tag} className="tag">#{tag}</span>)}</div>
    <div className="article-actions"><Link className="btn btn-ghost btn-sm" to={`/articles/${paper.id}`}>Details</Link><PaperPdf paperId={paper.id} />{paper.doi && <a className="btn btn-ghost btn-sm" href={`https://doi.org/${encodeURIComponent(paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}`} target="_blank" rel="noreferrer">DOI</a>}</div>
  </article>
}

export function PaperDetail() {
  const { id } = useParams()
  const [result, setResult] = useState({ id: null, paper: null, error: '' })
  useEffect(() => {
    let active = true
    api(`/papers/${encodeURIComponent(id)}`)
      .then((paper) => { if (active) setResult({ id, paper, error: '' }) })
      .catch((err) => { if (active) setResult({ id, paper: null, error: err.message }) })
    return () => { active = false }
  }, [id])

  const paper = result.id === id ? result.paper : null
  if (result.id === id && result.error) return <div className="page"><p className="alert" role="alert">{result.error}</p><Link to="/articles">Back to papers</Link></div>
  if (!paper) return <div className="page"><div className="panel empty" aria-busy="true">Loading paper…</div></div>
  const authors = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : [author.name, author.affiliation].filter(Boolean).join(' · '))
  return <div className="page">
    <PageHeader title={paper.title} sub={`${paper.domain} · Approved ${new Date(paper.reviewed_at ?? paper.created_at).toLocaleDateString()}`} />
    <article className="panel paper-detail">
      <h2>Authors</h2><p className="article-authors">{authors.join(', ')}</p>
      <p className="muted-sm">Submitted by {paper.submitter_name}</p>
      {paper.doi && <p><strong>DOI:</strong> <a href={`https://doi.org/${encodeURIComponent(paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}`} target="_blank" rel="noreferrer">{paper.doi}</a></p>}
      <h2>Abstract</h2><p className="paper-detail-abstract">{paper.abstract}</p>
      {paper.tags?.length > 0 && <><h2>Keywords</h2><div className="tag-row">{paper.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div></>}
      <div className="article-actions"><PaperPdf paperId={paper.id} label="View approved PDF" /><Link className="btn btn-ghost btn-sm" to="/articles">Back to papers</Link></div>
    </article>
  </div>
}

function EventCard({ event, onRegister }) {
  const startsAt = new Date(event.starts_at)
  const full = event.capacity !== null && event.registration_count >= event.capacity
  return (
    <article className="panel event">
      <div className="event-date">
        <b>{startsAt.toLocaleDateString(undefined, { day: '2-digit' })}</b>
        <span>{startsAt.toLocaleDateString(undefined, { month: 'short' })}</span>
      </div>
      <div className="event-body">
        <span className="tag tag-orange">{event.kind}</span>
        <h3><Link to={`/events/${event.id}`}>{event.title}</Link></h3>
        <p className="muted-sm">
          <Clock size={14} /> {startsAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} <MapPin size={14} /> {event.location} <Users size={14} /> {event.registration_count} registered{event.capacity ? ` / ${event.capacity}` : ''}
        </p>
      </div>
      <button className={`btn ${event.registered ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onRegister(event)} disabled={full && !event.registered}>
        {event.registered ? 'Cancel registration' : full ? 'Full' : 'Register'}
      </button>
    </article>
  )
}

const emptyEventForm = { title: '', description: '', kind: '', location: 'Online', startsAt: '', endsAt: '', capacity: '' }
const localDateTimeToIso = (value) => value ? new Date(value).toISOString() : ''

export function Events({ user }) {
  const [result, setResult] = useState({ key: '', items: [], total: 0, hasMore: false, error: '' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [form, setForm] = useState(emptyEventForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const key = `${query}:${page}:${refresh}`
  useEffect(() => {
    let active = true
    api(`/events?q=${encodeURIComponent(query)}&page=${page}`)
      .then((data) => { if (active) setResult({ key, ...data, error: '' }) })
      .catch((err) => { if (active) setResult({ key, items: [], total: 0, hasMore: false, error: err.message }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [key, query, page])
  const items = result.key === key ? result.items : []
  const isLoading = result.key !== key || loading
  const canCreate = ['author', 'moderator', 'admin'].includes(user?.role)
  const register = async (event) => {
    setError('')
    try { await api(`/events/${event.id}/registration`, { method: 'PUT', body: { registered: !event.registered } }); setRefresh((value) => value + 1) }
    catch (err) { setError(err.message) }
  }
  const create = async (submitEvent) => {
    submitEvent.preventDefault(); setSaving(true); setError('')
    try {
      await api('/events', { method: 'POST', body: { ...form, startsAt: localDateTimeToIso(form.startsAt), endsAt: localDateTimeToIso(form.endsAt), capacity: form.capacity || null } })
      setForm(emptyEventForm); setPage(1); setRefresh((value) => value + 1)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const data = result.key === key ? result : null
  return (
    <div className="page">
      <PageHeader title="Events" sub="Webinars, workshops and hackathons for students and researchers." />
      {error && <p className="alert" role="alert">{error}</p>}
      {canCreate && <form className="panel form-panel event-create" onSubmit={create}><h2>Create an academic event</h2><div className="form-row">
        <div className="field"><label htmlFor="event-title">Title</label><input id="event-title" maxLength={200} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="event-kind">Event type</label><input id="event-kind" maxLength={80} required value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} placeholder="Workshop, webinar…" /></div>
      </div><div className="field"><label htmlFor="event-description">Description</label><textarea id="event-description" maxLength={3000} rows={3} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="form-row form-row-3"><div className="field"><label htmlFor="event-location">Location or meeting link</label><input id="event-location" maxLength={200} required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div><div className="field"><label htmlFor="event-start">Starts</label><input id="event-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div><div className="field"><label htmlFor="event-end">Ends</label><input id="event-end" type="datetime-local" required value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="event-capacity">Capacity (optional)</label><input id="event-capacity" type="number" min="1" max="100000" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Unlimited" /></div><button className="btn btn-primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish event'}</button></form>}
      <div className="field event-search"><label htmlFor="event-search">Find an upcoming event</label><input id="event-search" maxLength={120} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="Search title, type, or location" /></div>
      {result.key === key && result.error && <p className="alert" role="alert">{result.error}</p>}
      {isLoading && <p className="muted-sm">Loading events…</p>}
      <div className="stack">
        {items.map((event) => <EventCard key={event.id} event={event} onRegister={register} />)}
      </div>
      {!isLoading && data?.total === 0 && <div className="panel empty"><p>No upcoming events match your search.</p></div>}
      {!isLoading && data?.total > 0 && <div className="paper-pagination"><span className="muted-sm">{data.total} upcoming event{data.total === 1 ? '' : 's'} · Page {page} of {Math.ceil(data.total / data.limit)}</span><div><button className="btn btn-ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><button className="btn btn-ghost" onClick={() => setPage((value) => value + 1)} disabled={!data.hasMore}>Next</button></div></div>}
    </div>
  )
}

export function EventDetail({ user }) {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const load = async () => {
    try { setEvent(await api(`/events/${id}`)); setError('') }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    api(`/events/${id}`).then((data) => { if (active) { setEvent(data); setError('') } })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])
  const update = async (submitEvent) => {
    submitEvent.preventDefault(); setSaving(true)
    try {
      const updated = await api(`/events/${id}`, { method: 'PATCH', body: { title: event.title, description: event.description, kind: event.kind, location: event.location, startsAt: localDateTimeToIso(event.starts_at), endsAt: localDateTimeToIso(event.ends_at), capacity: event.capacity } })
      setEvent({ ...event, ...updated }); setEditing(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const toggleRegistration = async () => {
    setSaving(true)
    try { await api(`/events/${id}/registration`, { method: 'PUT', body: { registered: !event.registered } }); await load() }
    catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const cancel = async () => {
    if (!window.confirm(`Cancel “${event.title}”? Registrations will remain recorded.`)) return
    try { await api(`/events/${id}/cancel`, { method: 'PATCH' }); await load() }
    catch (err) { setError(err.message) }
  }
  if (loading) return <div className="page"><div className="panel empty" aria-busy="true">Loading event…</div></div>
  if (!event) return <div className="page"><p className="alert" role="alert">{error || 'Event not found'}</p><Link to="/events">Back to events</Link></div>
  const canManage = event.can_manage && ['author', 'moderator', 'admin'].includes(user?.role)
  const full = event.capacity !== null && event.registration_count >= event.capacity
  return <div className="page"><PageHeader title={event.title} sub={`${event.kind} · ${event.status}`} />{error && <p className="alert" role="alert">{error}</p>}
    <article className="panel event-detail"><p>{event.description}</p><dl><dt>Starts</dt><dd>{new Date(event.starts_at).toLocaleString()}</dd><dt>Ends</dt><dd>{new Date(event.ends_at).toLocaleString()}</dd><dt>Location</dt><dd>{event.location}</dd><dt>Organizer</dt><dd>{event.creator_name}</dd><dt>Registrations</dt><dd>{event.registration_count}{event.capacity ? ` / ${event.capacity}` : ''}</dd></dl>
      {event.status === 'cancelled' && <p className="alert">This event has been cancelled.</p>}
      <div className="article-actions">{event.status === 'published' && new Date(event.starts_at) > new Date() && <button className={`btn ${event.registered ? 'btn-ghost' : 'btn-primary'}`} onClick={toggleRegistration} disabled={saving || (full && !event.registered)}>{event.registered ? 'Cancel registration' : full ? 'Event full' : 'Register'}</button>}{canManage && event.status === 'published' && <><button className="btn btn-ghost" onClick={() => setEditing(!editing)}>{editing ? 'Stop editing' : 'Edit event'}</button><button className="btn btn-ghost btn-danger" onClick={cancel}>Cancel event</button></>}</div>
      {editing && canManage && <form className="community-edit" onSubmit={update}><label>Title<input maxLength={200} required value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} /></label><label>Description<textarea maxLength={3000} required value={event.description} onChange={(e) => setEvent({ ...event, description: e.target.value })} /></label><label>Event type<input maxLength={80} required value={event.kind} onChange={(e) => setEvent({ ...event, kind: e.target.value })} /></label><label>Location<input maxLength={200} required value={event.location} onChange={(e) => setEvent({ ...event, location: e.target.value })} /></label><label>Starts<input type="datetime-local" required value={new Date(new Date(event.starts_at).getTime() - new Date(event.starts_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setEvent({ ...event, starts_at: localDateTimeToIso(e.target.value) })} /></label><label>Ends<input type="datetime-local" required value={new Date(new Date(event.ends_at).getTime() - new Date(event.ends_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setEvent({ ...event, ends_at: localDateTimeToIso(e.target.value) })} /></label><label>Capacity<input type="number" min="1" max="100000" value={event.capacity ?? ''} onChange={(e) => setEvent({ ...event, capacity: e.target.value || null })} /></label><button className="btn btn-primary" disabled={saving}>Save event</button></form>}
    </article><Link to="/events">Back to events</Link>
  </div>
}

export function Messages({ user }) {
  const [convos, setConvos] = useState([])
  const [searchParams] = useSearchParams()
  const [activeId, setActiveId] = useState(searchParams.get('conversation') ?? '')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [unreadRefresh, setUnreadRefresh] = useState(0)
  const active = convos.find((c) => String(c.id) === String(activeId))
  const matchingUsers = query.trim() ? users.filter((person) => String(person.id) !== String(user.id)) : []
  const refreshConversations = async () => {
    const result = await api('/messages/conversations')
    setConvos(result)
  }
  useEffect(() => {
    let mounted = true
    const loadConversations = () => api('/messages/conversations').then((result) => { if (mounted) setConvos(result) })
      .catch((err) => { if (mounted) setError(err.message) })
      .finally(() => { if (mounted) setLoading(false) })
    loadConversations()
    const interval = setInterval(loadConversations, 15000)
    return () => { mounted = false; clearInterval(interval) }
  }, [unreadRefresh])
  useEffect(() => {
    if (!query.trim()) return undefined
    let activeRequest = true
    const timer = setTimeout(() => api(`/users/search?q=${encodeURIComponent(query)}`)
      .then((result) => { if (activeRequest) setUsers(result) })
      .catch((err) => { if (activeRequest) setError(err.message) }), 250)
    return () => { activeRequest = false; clearTimeout(timer) }
  }, [query])
  useEffect(() => {
    if (!activeId) return undefined
    let activeRequest = true
    let latestMessageId = null
    const fetchMessages = () => api(`/messages/conversations/${activeId}/messages`)
      .then((result) => {
        if (!activeRequest) return
        setMessages(result.items)
        const latest = result.items.at(-1)?.id ?? null
        if (latest !== latestMessageId) {
          latestMessageId = latest
          setUnreadRefresh((value) => value + 1)
          window.dispatchEvent(new Event('snarp:unread-changed'))
        }
      })
      .catch((err) => { if (activeRequest) setError(err.message) })
    fetchMessages()
    const interval = setInterval(fetchMessages, 5000)
    return () => { activeRequest = false; clearInterval(interval) }
  }, [activeId])
  const open = (id) => { setActiveId(id); setError('') }
  const startConversation = async (person) => {
    try {
      const result = await api('/messages/conversations', { method: 'POST', body: { userId: person.id } })
      setQuery(''); setUsers([]); await refreshConversations(); open(result.id)
    } catch (err) { setError(err.message) }
  }
  const send = async (e) => {
    e.preventDefault()
    if (!draft.trim() || !activeId || sending) return
    setSending(true); setError('')
    try {
      const message = await api(`/messages/conversations/${activeId}/messages`, { method: 'POST', body: { body: draft } })
      setMessages((current) => [...current, message]); setDraft(''); await refreshConversations()
    } catch (err) { setError(err.message) }
    finally { setSending(false) }
  }

  return (
    <div className="page page-wide">
      <PageHeader title="Messages" sub="Private conversations with researchers." />
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="panel inbox">
        <aside className="inbox-sidebar"><div className="inbox-compose"><label htmlFor="message-user-search">New message</label><input id="message-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a researcher" />{matchingUsers.length > 0 && <ul className="message-user-results">{matchingUsers.map((person) => <li key={person.id}><button onClick={() => startConversation(person)}><Avatar name={person.name} src={person.avatar_url} size="sm" /><span>{person.name}<small>{person.institution || person.department || person.role}</small></span></button></li>)}</ul>}</div>
        <ul className="inbox-list">
          {convos.map((c) => (
            <li key={c.id}>
              <button className={`inbox-item ${String(c.id) === String(activeId) ? 'active' : ''}`} onClick={() => open(c.id)}>
                <Avatar name={c.name} src={c.avatar_url} />
                <span className="inbox-text">
                  <strong>{c.name}</strong>
                  <small>{c.last_message || 'Start a conversation'}</small>
                </span>
                {c.unread_count > 0 && <span className="nav-badge">{c.unread_count}</span>}
              </button>
            </li>
          ))}
        </ul>{loading && <p className="muted-sm">Loading conversations…</p>}{!loading && convos.length === 0 && <p className="muted-sm inbox-empty">No conversations yet.</p>}</aside>
        <section className="thread">
          {active ? <><header className="thread-head"><Avatar name={active.name} src={active.avatar_url} size="sm" /><strong>{active.name}</strong></header>
          <div className="thread-body">
            {messages.map((message) => (
              <div key={message.id} className={`bubble ${String(message.sender_id) === String(user.id) ? 'mine' : ''}`}>
                <p>{message.body}</p>
                <time>{new Date(message.created_at).toLocaleString()}</time>
              </div>
            ))}
          </div>
          <form className="thread-input" onSubmit={send}>
            <input maxLength={5000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${active.name}`} aria-label="Message" />
            <button className="btn btn-primary" disabled={!draft.trim() || sending} aria-label="Send"><PaperPlaneRight size={18} /></button>
          </form></> : <div className="thread-empty"><ChatCircle size={32} /><p>Choose a conversation or find a researcher to start one.</p></div>}
        </section>
      </div>
    </div>
  )
}

const NOTIF_ICON = { paper_review: SealCheck, like: Heart, message: ChatCircle, comment: ChatCircle }

export function Notifications() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    api('/notifications').then((result) => { if (active) setItems(result.items) })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const markRead = async (item) => {
    if (item.read_at) return
    try {
      const updated = await api(`/notifications/${item.id}/read`, { method: 'PUT' })
      setItems((current) => current.map((notification) => notification.id === item.id ? { ...notification, read_at: updated.read_at } : notification))
      window.dispatchEvent(new Event('snarp:unread-changed'))
    } catch (err) { setError(err.message) }
  }
  const markAllRead = async () => {
    try { await api('/notifications/read-all', { method: 'PUT' }); setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() }))); window.dispatchEvent(new Event('snarp:unread-changed')) }
    catch (err) { setError(err.message) }
  }
  const target = (item) => item.entity_type === 'conversation' ? `/messages?conversation=${item.entity_id}` : item.entity_type === 'paper' ? '/my-submissions' : '/'
  return (
    <div className="page">
      <PageHeader title="Notifications">
        <button className="btn btn-ghost btn-sm" onClick={markAllRead} disabled={!items.some((item) => !item.read_at)}>
          Mark all as read
        </button>
      </PageHeader>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && <p className="muted-sm">Loading notifications…</p>}
      {items.length === 0 && !loading ? <div className="panel empty"><p>No notifications yet.</p></div> : <ul className="panel notif-list">
        {items.map((n) => {
          const Icon = NOTIF_ICON[n.kind] ?? Bell
          return (
            <li key={n.id} className={`notif ${!n.read_at ? 'unread' : ''}`}>
              <span className={`notif-icon notif-${n.kind}`}><Icon size={18} weight="fill" /></span>
              <Link to={target(n)} onClick={() => markRead(n)}>{n.text}</Link>
              <time>{new Date(n.created_at).toLocaleString()}</time>
            </li>
          )
        })}
      </ul>}
    </div>
  )
}

const EMPTY_CITE = { authors: '', year: '', title: '', journal: '', volume: '', issue: '', pages: '', doi: '' }

export function Tools() {
  const [m, setM] = useState(EMPTY_CITE)
  const set = (e) => setM({ ...m, [e.target.name]: e.target.value })
  const filled = Object.values(m).some(Boolean)
  const field = (name, label, props = {}) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} value={m[name]} onChange={set} {...props} />
    </div>
  )
  return (
    <div className="page">
      <PageHeader title="Citation tools" sub="Build APA and BibTeX citations. Fields you leave empty are left out." />
      <div className="panel form-panel">
        {field('authors', 'Authors', { placeholder: 'Iyer, R.; Nair, S.' })}
        {field('title', 'Title')}
        <div className="form-row">
          {field('journal', 'Journal or venue')}
          {field('year', 'Year', { inputMode: 'numeric' })}
        </div>
        <div className="form-row form-row-3">
          {field('volume', 'Volume')}
          {field('issue', 'Issue')}
          {field('pages', 'Pages', { placeholder: '45-61' })}
        </div>
        {field('doi', 'DOI', { placeholder: '10.1000/xyz123' })}
      </div>
      {filled && (
        <div className="stack">
          {[['APA', apa(m)], ['BibTeX', bibtex(m)]].map(([label, text]) => (
            <div key={label} className="panel cite-out">
              <div className="rail-head">
                <h3>{label}</h3>
                <CopyButton text={text} />
              </div>
              <pre>{text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MAX_PDF_BYTES = 10 * 1024 * 1024
const makeInitialPaperForm = (user) => ({
  title: '',
  abstract: '',
  doi: '',
  domain: '',
  tags: '',
  authors: [{ name: user?.name ?? '', affiliation: '' }],
  additionalNotes: '',
})

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function Submit({ user }) {
  const [form, setForm] = useState(() => makeInitialPaperForm(user))
  const [file, setFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)
  const fileInputRef = useRef(null)
  const requestKeyRef = useRef(null)

  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
    setServerError('')
    requestKeyRef.current = null
  }

  const setAuthor = (index, name, value) => {
    setForm((current) => ({
      ...current,
      authors: current.authors.map((author, i) => i === index ? { ...author, [name]: value } : author),
    }))
    setErrors((current) => ({ ...current, authors: undefined }))
    setServerError('')
    requestKeyRef.current = null
  }

  const chooseFile = (nextFile) => {
    setFile(nextFile)
    setErrors((current) => ({ ...current, pdf: undefined }))
    setServerError('')
    requestKeyRef.current = null
    if (nextFile && nextFile.size > MAX_PDF_BYTES) {
      setErrors((current) => ({ ...current, pdf: 'PDF must be 10 MB or smaller' }))
    }
  }

  const validate = async () => {
    const next = {}
    if (!form.title.trim()) next.title = 'Enter the paper title'
    else if (form.title.trim().length > 300) next.title = 'Title must be 300 characters or fewer'
    if (!form.abstract.trim()) next.abstract = 'Enter the abstract'
    else if (form.abstract.trim().length > 20000) next.abstract = 'Abstract must be 20,000 characters or fewer'
    if (!form.domain.trim()) next.domain = 'Enter a research domain or category'
    if (form.doi.trim()) {
      const doi = form.doi.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
      if (!/^10\.\d{4,9}\/[^\s<>]+$/i.test(doi)) next.doi = 'Enter a valid DOI, such as 10.1000/example'
    }
    if (form.additionalNotes.length > 5000) next.additionalNotes = 'Notes must be 5,000 characters or fewer'
    if (form.authors.length === 0 || form.authors.some((author) => !author.name.trim())) {
      next.authors = 'Enter a name for each author'
    }
    const tags = form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
      next.tags = 'Use up to 20 tags, each 40 characters or fewer'
    }
    if (!file) next.pdf = 'Choose a PDF to upload'
    else if (file.size > MAX_PDF_BYTES) next.pdf = 'PDF must be 10 MB or smaller'
    else {
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
      if (String.fromCharCode(...signature) !== '%PDF-') next.pdf = 'The selected file is not a valid PDF'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (event) => {
    event.preventDefault()
    setServerError('')
    if (!(await validate())) return

    const tags = [...new Set(form.tags.split(',').map((tag) => tag.trim()).filter(Boolean))]
    const authors = form.authors.map(({ name, affiliation }) => ({ name: name.trim(), affiliation: affiliation.trim() }))
    const body = new FormData()
    body.append('title', form.title.trim())
    body.append('abstract', form.abstract.trim())
    body.append('doi', form.doi.trim())
    body.append('domain', form.domain.trim())
    body.append('tags', JSON.stringify(tags))
    body.append('authors', JSON.stringify(authors))
    body.append('additionalNotes', form.additionalNotes.trim())
    body.append('pdf', file)

    setSubmitting(true)
    try {
      requestKeyRef.current ??= window.crypto.randomUUID()
      const result = await api('/papers/submit', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': requestKeyRef.current },
      })
      setSubmitted(result)
      setForm(makeInitialPaperForm(user))
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      requestKeyRef.current = null
    } catch (error) {
      if (error.field) setErrors((current) => ({ ...current, [error.field]: error.message }))
      else setServerError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const startAnother = () => {
    setSubmitted(null)
    setErrors({})
    setServerError('')
  }

  return (
    <div className="page">
      <PageHeader title="Submit a paper" sub="Moderators review every submission before it is published." />
      {submitted ? (
        <section className="panel submit-success" role="status">
          <h2>Paper submitted successfully</h2>
          <p>“{submitted.title}” is awaiting moderator review.</p>
          <p className="muted-sm">Submission #{submitted.id} · {new Date(submitted.submittedAt).toLocaleString()}</p>
          <div className="submit-actions">
            <button type="button" className="btn btn-primary" onClick={startAnother}>Submit another paper</button>
            <Link to="/" className="btn btn-ghost">Back to feed</Link>
          </div>
        </section>
      ) : (
        <form className="panel form-panel paper-form" onSubmit={submit} noValidate>
          {serverError && <p className="alert" role="alert">{serverError}</p>}

          <div className="field">
            <label htmlFor="p-title">Paper title <span aria-hidden="true">*</span></label>
            <input id="p-title" value={form.title} maxLength={300} onChange={(e) => update('title', e.target.value)} aria-invalid={!!errors.title} aria-describedby="p-title-error" />
            <span className="field-error" id="p-title-error">{errors.title}</span>
          </div>

          <div className="field">
            <label htmlFor="p-abstract">Abstract <span aria-hidden="true">*</span></label>
            <textarea id="p-abstract" rows={6} maxLength={20000} value={form.abstract} onChange={(e) => update('abstract', e.target.value)} aria-invalid={!!errors.abstract} aria-describedby="p-abstract-error" />
            <span className="field-error" id="p-abstract-error">{errors.abstract}</span>
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="p-doi">DOI (optional)</label>
              <input id="p-doi" value={form.doi} onChange={(e) => update('doi', e.target.value)} placeholder="10.1000/example" aria-invalid={!!errors.doi} aria-describedby="p-doi-error" />
              <span className="field-error" id="p-doi-error">{errors.doi}</span>
            </div>
            <div className="field">
              <label htmlFor="p-domain">Research domain / category <span aria-hidden="true">*</span></label>
              <input id="p-domain" value={form.domain} maxLength={120} onChange={(e) => update('domain', e.target.value)} placeholder="AI, education, biology…" aria-invalid={!!errors.domain} aria-describedby="p-domain-error" />
              <span className="field-error" id="p-domain-error">{errors.domain}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="p-tags">Research tags</label>
            <input id="p-tags" value={form.tags} onChange={(e) => update('tags', e.target.value)} placeholder="Separate tags with commas" aria-invalid={!!errors.tags} aria-describedby="p-tags-help p-tags-error" />
            <span className="muted-sm" id="p-tags-help">Up to 20 tags, separated by commas.</span>
            <span className="field-error" id="p-tags-error">{errors.tags}</span>
          </div>

          <fieldset className="paper-authors">
            <legend>Authors and co-authors <span aria-hidden="true">*</span></legend>
            {form.authors.map((author, index) => (
              <div className="paper-author-row" key={index}>
                <div className="field">
                  <label htmlFor={`p-author-${index}`}>Author {index + 1} name</label>
                  <input id={`p-author-${index}`} value={author.name} maxLength={120} onChange={(e) => setAuthor(index, 'name', e.target.value)} aria-invalid={!!errors.authors} />
                </div>
                <div className="field">
                  <label htmlFor={`p-affiliation-${index}`}>Affiliation (optional)</label>
                  <input id={`p-affiliation-${index}`} value={author.affiliation} maxLength={200} onChange={(e) => setAuthor(index, 'affiliation', e.target.value)} />
                </div>
                {index > 0 && <button type="button" className="icon-btn paper-author-remove" onClick={() => { update('authors', form.authors.filter((_, i) => i !== index)) }} aria-label={`Remove author ${index + 1}`}><X size={18} /></button>}
              </div>
            ))}
            <span className="field-error">{errors.authors}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update('authors', [...form.authors, { name: '', affiliation: '' }])} disabled={form.authors.length >= 25}>
              <Plus size={16} /> Add author
            </button>
          </fieldset>

          <div className="field">
            <label htmlFor="p-pdf">Research paper PDF <span aria-hidden="true">*</span></label>
            <label className="dropzone paper-dropzone" htmlFor="p-pdf">
              <input ref={fileInputRef} id="p-pdf" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-invalid={!!errors.pdf} aria-describedby="p-pdf-error" />
              <UploadSimple size={28} />
              <strong>{file ? file.name : 'Choose your paper PDF'}</strong>
              <span>{file ? `${formatFileSize(file.size)} · PDF` : 'PDF only · Maximum 10 MB'}</span>
            </label>
            <span className="field-error" id="p-pdf-error">{errors.pdf}</span>
          </div>

          <div className="field">
            <label htmlFor="p-notes">Additional notes (optional)</label>
            <textarea id="p-notes" rows={3} maxLength={5000} value={form.additionalNotes} onChange={(e) => update('additionalNotes', e.target.value)} aria-invalid={!!errors.additionalNotes} aria-describedby="p-notes-error" />
            <span className="field-error" id="p-notes-error">{errors.additionalNotes}</span>
          </div>

          <div className="submit-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
            <Link to="/" className="btn btn-ghost">Cancel</Link>
          </div>
        </form>
      )}
    </div>
  )
}

export function Moderation({ user }) {
  const [section, setSection] = useState('pending')
  const [queue, setQueue] = useState('papers')
  const [papers, setPapers] = useState([])
  const [reports, setReports] = useState([])
  const [reportStatus, setReportStatus] = useState('pending')
  const [summary, setSummary] = useState(null)
  const [audit, setAudit] = useState([])
  const [auditPage, setAuditPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [pdfUrl, setPdfUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const canModerate = ['admin', 'moderator'].includes(user?.role)
  const load = async () => {
    setLoading(true); setError('')
    try {
      if (queue === 'reports') {
        const result = await api(`/moderation/reports?status=${reportStatus}&page=${page}`)
        setReports(result.reports); setTotal(result.total)
      } else {
        const result = await api(`/moderation/papers?status=${section}&page=${page}`)
        setPapers(result.papers); setTotal(result.total)
      }
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!canModerate || queue === 'audit') return
    let active = true
    const fetchQueue = async () => {
      try {
        if (queue === 'reports') {
          const result = await api(`/moderation/reports?status=${reportStatus}&page=${page}`)
          if (active) { setReports(result.reports); setTotal(result.total); setError('') }
        } else {
          const result = await api(`/moderation/papers?status=${section}&page=${page}`)
          if (active) { setPapers(result.papers); setTotal(result.total); setError('') }
        }
      } catch (err) { if (active) setError(err.message) }
      finally { if (active) setLoading(false) }
    }
    fetchQueue()
    return () => { active = false }
  }, [section, canModerate, page, queue, reportStatus])
  useEffect(() => {
    if (!canModerate) return
    api('/moderation/summary').then(setSummary).catch((err) => setError(err.message))
  }, [canModerate])
  useEffect(() => {
    if (user?.role !== 'admin') return
    api(`/admin/audit-logs?page=${auditPage}&limit=20`).then((result) => setAudit(result.items)).catch((err) => setError(err.message))
  }, [user?.role, auditPage])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  const review = async (id) => {
    setError('')
    try {
      const detail = await api(`/moderation/papers/${id}`)
      setSelected(detail)
      setPdfUrl(URL.createObjectURL(await apiBlob(`/papers/${id}/pdf`)))
    } catch (err) { setError(err.message) }
  }
  const closeReview = () => { setSelected(null); setPdfUrl('') }
  const decide = async (action) => {
    if (!selected || saving) return
    let body
    if (action === 'approve') {
      if (!window.confirm(`Approve and publish “${selected.title}”?`)) return
      body = { comment: window.prompt('Optional review comment (up to 2,000 characters):') ?? '' }
    } else {
      const reason = window.prompt('Enter the reason for rejecting this paper (5–2,000 characters):')
      if (reason === null) return
      body = { reason }
    }
    setSaving(true); setError('')
    try {
      await api(`/moderation/papers/${selected.id}/${action}`, { method: 'PATCH', body })
      closeReview()
      await load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const decideReport = async (report, decision) => {
    setSaving(true); setError('')
    try {
      await api(`/moderation/reports/${report.id}/${decision}`, { method: 'PATCH' })
      await load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  if (!canModerate) return <div className="page"><PageHeader title="Paper moderation" /><div className="panel empty"><h3>Access restricted</h3><p>This page is for Moderators and Admins.</p></div></div>
  return <div className="page">
    <PageHeader title="Moderation dashboard" sub="Review research submissions and community reports." />
    <div className="moderation-stats" aria-label="Moderation overview">
      {summary && <><div className="panel"><strong>{summary.pending_papers}</strong><span>Pending papers</span></div><div className="panel"><strong>{summary.reviewed_papers}</strong><span>Reviewed papers</span></div><div className="panel"><strong>{summary.pending_reports}</strong><span>Pending reports</span></div>{user.role === 'admin' && <div className="panel"><strong>{summary.users}</strong><span>Registered users</span></div>}</>}
    </div>
    <div className="chips">
      <button className={`chip ${queue === 'papers' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setQueue('papers') }}>Papers</button>
      <button className={`chip ${queue === 'reports' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setQueue('reports') }}>Content reports</button>
      {user.role === 'admin' && <button className={`chip ${queue === 'audit' ? 'active' : ''}`} onClick={() => { closeReview(); setPage(1); setQueue('audit') }}>Audit log</button>}
    </div>
    {queue === 'papers' && <div className="chips">
      <button className={`chip ${section === 'pending' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setSection('pending') }}>Pending</button>
      <button className={`chip ${section === 'reviewed' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setSection('reviewed') }}>Reviewed</button>
    </div>}
    {queue === 'reports' && <div className="chips">{['pending', 'reviewed', 'dismissed'].map((status) => <button key={status} className={`chip ${reportStatus === status ? 'active' : ''}`} onClick={() => { setLoading(true); setPage(1); setReportStatus(status) }}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div>}
    {error && <p className="alert" role="alert">{error}</p>}
    {queue === 'audit' && user.role === 'admin' ? <><div className="stack">{audit.map((entry) => <article className="panel audit-item" key={entry.id}><strong>{entry.action}</strong><span>{entry.actor_name ?? 'Deleted user'} · {entry.actor_role ?? 'unknown role'} · {new Date(entry.created_at).toLocaleString()}</span><small>{entry.target_type} {entry.target_id}</small></article>)}</div><div className="submit-actions"><button className="btn btn-ghost" onClick={() => setAuditPage((value) => Math.max(1, value - 1))} disabled={auditPage <= 1}>Previous</button><span className="muted-sm">Audit page {auditPage}</span><button className="btn btn-ghost" onClick={() => setAuditPage((value) => value + 1)} disabled={audit.length < 20}>Next</button></div></> : loading ? <p className="muted-sm">Loading {queue}…</p> : queue === 'reports' ? <div className="stack">
      {reports.map((report) => <article className="panel mod-item" key={report.id}><div className="mod-info"><h3>Report #{report.id}: post by {report.post_author_name}</h3><p className="muted-sm">Reported by {report.reporter_name} · {new Date(report.created_at).toLocaleString()}</p><p><strong>Reason:</strong> {report.reason}</p><p>{report.post_body || '[Image post]'}</p>{report.image_id && <img className="report-image" src={`/api/images/${report.image_id}`} alt="Reported post" loading="lazy" />}<Link to={`/users/${report.post_author_id}`}>View author profile</Link></div>{report.status === 'pending' && <div className="mod-actions"><button className="btn btn-ghost" onClick={() => decideReport(report, 'dismissed')} disabled={saving}>Dismiss</button><button className="btn btn-secondary btn-sm" onClick={() => decideReport(report, 'reviewed')} disabled={saving}>Mark reviewed</button></div>}</article>)}
      {!reports.length && <div className="panel empty"><h3>No {reportStatus} reports</h3></div>}
    </div> : <div className="stack">
      {papers.map((paper) => <article key={paper.id} className="panel mod-item">
        <div className="mod-info"><h3>{paper.title}</h3><p className="muted-sm">{paper.submitter_name} · {paper.domain} · submitted {new Date(paper.created_at).toLocaleString()}</p><p>{paper.abstract.slice(0, 220)}{paper.abstract.length > 220 ? '…' : ''}</p></div>
        <div className="mod-actions"><span className={`tag ${paper.status === 'approved' ? 'tag-teal' : paper.status === 'rejected' ? 'tag-orange' : 'tag-blue'}`}>{paper.status}</span><button className="btn btn-secondary btn-sm" onClick={() => review(paper.id)}>Review details</button></div>
      </article>)}
      {!papers.length && <div className="panel empty"><h3>{section === 'pending' ? 'Queue is clear' : 'No reviewed papers yet'}</h3></div>}
    </div>}
    {queue !== 'audit' && !loading && total > 20 && <div className="submit-actions"><button className="btn btn-ghost" onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }} disabled={page <= 1}>Previous</button><span className="muted-sm">Page {page} of {Math.ceil(total / 20)}</span><button className="btn btn-ghost" onClick={() => { setLoading(true); setPage((value) => Math.min(Math.ceil(total / 20), value + 1)) }} disabled={page >= Math.ceil(total / 20)}>Next</button></div>}
    {selected && <section className="panel form-panel paper-review">
      <div className="article-meta"><h2>{selected.title}</h2><button className="btn btn-ghost btn-sm" onClick={closeReview}>Close</button></div>
      <p className="muted-sm">Submitted by {selected.submitter_name} ({selected.submitter_email}) · {new Date(selected.created_at).toLocaleString()}</p>
      <p><strong>Domain:</strong> {selected.domain} · <strong>Authors:</strong> {(selected.authors ?? []).map((a) => a.name).join(', ')}</p>
      {selected.doi && <p><strong>DOI:</strong> {selected.doi}</p>}
      <div className="tag-row">{(selected.tags ?? []).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>
      <h3>Abstract</h3><p>{selected.abstract}</p>
      {selected.additional_notes && <><h3>Author notes</h3><p>{selected.additional_notes}</p></>}
      {selected.review_history?.length > 0 && <><h3>Review history</h3><div className="stack">{selected.review_history.map((entry) => <div className="audit-item" key={entry.id}><strong>{entry.decision} by {entry.reviewer_name ?? 'former reviewer'}</strong><span>{new Date(entry.created_at).toLocaleString()}</span>{entry.comment && <p>{entry.comment}</p>}</div>)}</div></>}
      {pdfUrl && <iframe className="review-pdf" title={`PDF preview: ${selected.title}`} src={pdfUrl} />}
      {selected.status === 'pending' ? <div className="submit-actions"><button className="btn btn-ghost btn-danger" onClick={() => decide('reject')} disabled={saving}>{saving ? 'Saving…' : 'Reject paper'}</button><button className="btn btn-primary" onClick={() => decide('approve')} disabled={saving}>{saving ? 'Saving…' : 'Approve and publish'}</button></div> : <p className="muted-sm">{selected.status} by {selected.reviewer_name ?? 'unknown reviewer'} on {new Date(selected.reviewed_at).toLocaleString()}{selected.rejection_reason ? ` · Reason: ${selected.rejection_reason}` : ''}</p>}
    </section>}
  </div>
}

export function MySubmissions() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { api('/papers/my-submissions').then(setPapers).catch((err) => setError(err.message)).finally(() => setLoading(false)) }, [])
  return <div className="page"><PageHeader title="My submissions" sub="Track the review status of your papers." />
    {error && <p className="alert" role="alert">{error}</p>}
    {loading ? <p className="muted-sm">Loading your submissions…</p> : <div className="stack">{papers.map((paper) => <article key={paper.id} className="panel article">
      <div className="article-meta"><span className={`tag ${paper.status === 'approved' ? 'tag-teal' : paper.status === 'rejected' ? 'tag-orange' : 'tag-blue'}`}>{paper.status}</span><time className="muted-sm">Submitted {new Date(paper.created_at).toLocaleString()}</time></div>
      <h3>{paper.title}</h3><p>{paper.abstract.slice(0, 250)}{paper.abstract.length > 250 ? '…' : ''}</p>
      {paper.rejection_reason && <p className="alert"><strong>Feedback:</strong> {paper.rejection_reason}</p>}
      <div className="article-actions"><PaperPdf paperId={paper.id} label="View submitted PDF" /></div>
    </article>)}{!papers.length && <div className="panel empty"><h3>No submissions yet</h3><p>Your papers will appear here after submission.</p></div>}</div>}
  </div>
}

function Toggle({ label, defaultOn }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => setOn(!on)} />
    </label>
  )
}

export function Settings({ user, onUserUpdate }) {
  const [profile, setProfile] = useState(() => ({
    name: user.name ?? '',
    institution: user.institution ?? '',
    department: user.department ?? '',
    bio: user.bio ?? '',
    research_interests: user.research_interests ?? [],
    skills: user.skills ?? [],
    links: user.links ?? [],
  }))
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoSaving, setPhotoSaving] = useState(false)
  const photoInput = useRef(null)

  const setField = (field, value) => {
    setSaved(false)
    setProfile((current) => ({ ...current, [field]: value }))
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const updated = await api('/auth/me', {
        method: 'PUT',
        body: {
          ...profile,
          research_interests: typeof profile.research_interests === 'string'
            ? profile.research_interests.split(',')
            : profile.research_interests,
          skills: typeof profile.skills === 'string' ? profile.skills.split(',') : profile.skills,
          links: profile.links.filter((link) => link.label.trim() || link.url.trim()),
        },
      })
      onUserUpdate(updated)
      setSaved(true)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Photo must be 5 MB or smaller')
      return
    }

    setPhotoError('')
    setPhotoSaving(true)
    try {
      const form = new FormData()
      form.append('photo', file)
      const result = await api('/auth/me/photo', { method: 'PUT', body: form })
      onUserUpdate({ ...user, avatar_url: result.avatar_url })
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader title="Settings" sub="Manage your profile and notification preferences." />
      {saved && <p className="notice" role="status">Profile updated.</p>}
      {saveError && <p className="alert" role="alert">{saveError}</p>}
      {profile && <form className="panel form-panel" onSubmit={saveProfile}>
        <h3 className="form-title">Profile</h3>
        <div className="settings-avatar">
          <Avatar name={user.name} size="lg" src={user.avatar_url} />
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={uploadPhoto}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => photoInput.current?.click()}
            disabled={photoSaving}
          >
            {photoSaving ? 'Uploading…' : user.avatar_url ? 'Change photo' : 'Choose photo'}
          </button>
        </div>
        {photoError && <p className="alert" role="alert">{photoError}</p>}
        <div className="form-row">
          <div className="field">
            <label htmlFor="s-name">Full name</label>
            <input id="s-name" maxLength={100} value={profile.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-email">Email</label>
            <input id="s-email" defaultValue={user.email} disabled />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-aff">Affiliation</label>
          <input id="s-aff" maxLength={200} value={profile.institution} onChange={(e) => setField('institution', e.target.value)} placeholder="University or organisation" />
        </div>
        <div className="field">
          <label htmlFor="s-department">Department</label>
          <input id="s-department" maxLength={160} value={profile.department} onChange={(e) => setField('department', e.target.value)} placeholder="Department or faculty" />
        </div>
        <div className="field">
          <label htmlFor="s-bio">Bio</label>
          <textarea id="s-bio" rows={3} maxLength={2000} value={profile.bio} onChange={(e) => setField('bio', e.target.value)} placeholder="A line about your research interests" />
        </div>
        <div className="field">
          <label htmlFor="s-interests">Research interests</label>
          <input id="s-interests" maxLength={1600} value={Array.isArray(profile.research_interests) ? profile.research_interests.join(', ') : profile.research_interests} onChange={(e) => setField('research_interests', e.target.value)} placeholder="AI, education, biology" />
        </div>
        <div className="field">
          <label htmlFor="s-skills">Skills and expertise</label>
          <input id="s-skills" maxLength={1800} value={Array.isArray(profile.skills) ? profile.skills.join(', ') : profile.skills} onChange={(e) => setField('skills', e.target.value)} placeholder="Data analysis, literature review" />
        </div>
        <div className="field">
          <label>Professional links (HTTPS)</label>
          {profile.links.map((link, index) => <div className="form-row profile-link-row" key={index}>
            <input aria-label={`Link ${index + 1} label`} maxLength={40} value={link.label} onChange={(e) => setField('links', profile.links.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} placeholder="Website, ORCID…" />
            <input aria-label={`Link ${index + 1} URL`} type="url" maxLength={500} value={link.url} onChange={(e) => setField('links', profile.links.map((item, i) => i === index ? { ...item, url: e.target.value } : item))} placeholder="https://example.edu/~you" />
            <button type="button" className="link-danger" onClick={() => setField('links', profile.links.filter((_, i) => i !== index))}>Remove</button>
          </div>)}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setField('links', [...profile.links, { label: '', url: '' }])} disabled={profile.links.length >= 5}>Add link</button>
        </div>
        <h3 className="form-title">Notifications</h3>
        <p className="muted-sm">Notification preferences are not saved yet.</p>
        <Toggle label="Email me when my paper is reviewed" defaultOn />
        <Toggle label="Comments on my posts" defaultOn />
        <Toggle label="New members in my communities" />
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
      </form>}
    </div>
  )
}

export function Help() {
  return (
    <div className="page">
      <PageHeader title="Help center" sub="Answers to common questions about SNARP." />
      <div className="panel faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}<CaretDown size={18} /></summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
      <div className="panel help-contact">
        <h3>Still need help?</h3>
        <p>Write to <a href="mailto:info@uptoskills.com">info@uptoskills.com</a> or call <a href="tel:+919319772294">+91 93197 72294</a>.</p>
      </div>
    </div>
  )
}

export function Search() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''
  const q = query.toLowerCase()
  const [papers, setPapers] = useState([])
  const [users, setUsers] = useState([])
  const [posts, setPosts] = useState([])
  const [communities, setCommunities] = useState([])
  const [events, setEvents] = useState([])
  const [paperError, setPaperError] = useState('')
  const [userError, setUserError] = useState('')
  const [postError, setPostError] = useState('')
  const [communityError, setCommunityError] = useState('')
  const [eventError, setEventError] = useState('')
  useEffect(() => {
    if (!query.trim()) return
    let active = true
    api(`/papers/search?q=${encodeURIComponent(query)}`).then((result) => { if (active) setPapers(result.items) }).catch((err) => { if (active) setPaperError(err.message) })
    api(`/users/search?q=${encodeURIComponent(query)}`).then((result) => { if (active) setUsers(result) }).catch((err) => { if (active) setUserError(err.message) })
    api(`/posts/search?q=${encodeURIComponent(query)}`).then((result) => { if (active) setPosts(result) }).catch((err) => { if (active) setPostError(err.message) })
    api(`/communities?q=${encodeURIComponent(query)}`).then((result) => { if (active) setCommunities(result.items) }).catch((err) => { if (active) setCommunityError(err.message) })
    api(`/events?q=${encodeURIComponent(query)}`).then((result) => { if (active) setEvents(result.items) }).catch((err) => { if (active) setEventError(err.message) })
    return () => { active = false }
  }, [query])
  const shownPapers = q ? papers : []
  const total = communities.length + shownPapers.length + events.length + users.length + posts.length
  const updateCommunityMembership = async (community) => {
    try {
      const result = await api(`/communities/${community.id}/membership`, { method: 'PUT', body: { joined: !community.joined } })
      setCommunities((current) => current.map((item) => item.id === community.id ? { ...item, joined: result.joined, member_count: item.member_count + (result.joined ? 1 : -1) } : item))
    } catch (err) { setCommunityError(err.message) }
  }
  const updateEventRegistration = async (event) => {
    try {
      await api(`/events/${event.id}/registration`, { method: 'PUT', body: { registered: !event.registered } })
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, registered: !event.registered, registration_count: item.registration_count + (event.registered ? -1 : 1) } : item))
    } catch (err) { setEventError(err.message) }
  }
  return (
    <div className="page">
      <PageHeader title={`Results for "${params.get('q') ?? ''}"`} sub={`${total} result${total === 1 ? '' : 's'}`} />
      {paperError && <p className="alert" role="alert">{paperError}</p>}
      {userError && <p className="alert" role="alert">{userError}</p>}
      {postError && <p className="alert" role="alert">{postError}</p>}
      {communityError && <p className="alert" role="alert">{communityError}</p>}
      {eventError && <p className="alert" role="alert">{eventError}</p>}
      {total === 0 && !paperError && <div className="panel empty"><h3>Nothing found</h3><p>Try a different word, like a topic or an author.</p></div>}
      {users.length > 0 && <><h2 className="section-title">Researchers</h2><div className="card-grid">{users.map((person) => <Link key={person.id} to={`/users/${person.id}`} className="panel researcher-card"><Avatar name={person.name} src={person.avatar_url} /><span><strong>{person.name}</strong><small>{person.institution || person.department || ROLE_LABEL[person.role]}</small></span></Link>)}</div></>}
      {posts.length > 0 && <><h2 className="section-title">Posts</h2><div className="stack">{posts.map((post) => <article className="panel researcher-post search-post" key={post.id}><Link to={`/users/${post.user_id}`} className="search-post-author"><Avatar name={post.author_name} src={post.author_avatar_url} size="sm" /><strong>{post.author_name}</strong></Link><time>{new Date(post.created_at).toLocaleDateString()}</time>{post.body && <p>{post.body}</p>}{post.image_id && <img src={`/api/images/${post.image_id}`} alt="" loading="lazy" />}<span className="muted-sm">{post.like_count} likes · {post.comment_count} comments</span></article>)}</div></>}
      {shownPapers.length > 0 && <><h2 className="section-title">Research papers</h2><div className="stack">{shownPapers.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}</div></>}
      {communities.length > 0 && <><h2 className="section-title">Communities</h2><div className="card-grid">{communities.map((community) => <CommunityCard key={community.id} community={community} onMembership={updateCommunityMembership} />)}</div></>}
      {events.length > 0 && <><h2 className="section-title">Events</h2><div className="stack">{events.map((event) => <EventCard key={event.id} event={event} onRegister={updateEventRegistration} />)}</div></>}
      <p className="muted-sm search-foot"><Link to="/">Back to feed</Link></p>
    </div>
  )
}

export function UserProfile() {
  const { id } = useParams()
  const [profileParams] = useSearchParams()
  const pinnedPost = profileParams.get('post')
  const [result, setResult] = useState({ id: null, profile: null, error: '' })
  useEffect(() => {
    let active = true
    const query = pinnedPost ? `?post=${encodeURIComponent(pinnedPost)}` : ''
    api(`/users/${encodeURIComponent(id)}${query}`)
      .then((profile) => { if (active) setResult({ id, profile, error: '' }) })
      .catch((err) => { if (active) setResult({ id, profile: null, error: err.message }) })
    return () => { active = false }
  }, [id, pinnedPost])

  const profile = result.id === id ? result.profile : null
  useEffect(() => {
    if (!profile || !location.hash) return undefined
    const timer = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 0)
    return () => clearTimeout(timer)
  }, [profile])
  if (result.id === id && result.error) return <div className="page"><p className="alert" role="alert">{result.error}</p><Link to="/">Back to feed</Link></div>
  if (!profile) return <div className="page"><div className="panel empty" aria-busy="true">Loading profile…</div></div>

  return (
    <div className="page">
      <PageHeader title={profile.name} sub={ROLE_LABEL[profile.role] ?? 'Researcher'} />
      <section className="panel researcher-profile">
        <Avatar name={profile.name} size="lg" src={profile.avatar_url} />
        <div className="researcher-details">
          {(profile.institution || profile.department) && <p>{[profile.department, profile.institution].filter(Boolean).join(' · ')}</p>}
          {profile.bio && <p>{profile.bio}</p>}
          {profile.research_interests?.length > 0 && <div className="tag-row">{profile.research_interests.map((tag) => <span className="tag tag-blue" key={tag}>{tag}</span>)}</div>}
          {profile.skills?.length > 0 && <div className="tag-row">{profile.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>}
          {profile.links?.map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.label}</a>)}
          <p className="muted-sm">{profile.post_count} post{profile.post_count === 1 ? '' : 's'} · Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p>
        </div>
      </section>
      <h2 className="section-title">Posts</h2>
      {profile.posts.length === 0 ? <div className="panel empty"><p>No posts yet.</p></div> : <div className="stack">{profile.posts.map((post) => <article id={`post-${post.id}`} className="panel researcher-post" key={post.id}><time>{new Date(post.created_at).toLocaleDateString()}</time>{post.body && <p>{post.body}</p>}{post.image_id && <img src={`/api/images/${post.image_id}`} alt="" loading="lazy" />}<span className="muted-sm">{post.like_count} likes · {post.comment_count} comments</span></article>)}</div>}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Users, MapPin, Clock, FilePdf, Copy, Check, PaperPlaneRight, UploadSimple,
  Heart, ChatCircle, SealCheck, CaretDown, Plus, X, Bell, Sun, Moon, Desktop, Trash, UserPlus, BookmarkSimple, DeviceMobile, SignOut,
  MagicWand, CheckCircle, Circle, Warning, MagnifyingGlass, ArrowRight, ArrowLeft, BookOpenText, PenNib,
  Buildings, CalendarBlank, LinkSimple, PencilSimple, UserCircle, Palette, IdentificationCard, LockKey, ShareNetwork, EyeSlash, ArrowCounterClockwise, Question,
} from '@phosphor-icons/react'
import { useTheme } from '../theme'
import { Avatar, PageHeader } from '../components/ui'
import PostCard, { PostActions } from '../components/PostCard'
import { ROLE_LABEL, timeAgo } from '../format'
import { apa, bibtex } from '../cite'
import { FAQ } from '../content'
import { api, apiBlob } from '../api'
import { recordView } from '../views'
import PasswordMeter from '../components/PasswordMeter'
import { Stars, StatusTag } from './review'
import { passwordProblem } from '../password'
import PdfAttachment from '../components/PdfAttachment'
import { PdfReader } from '../components/Overlay'
import { QueryTopics, Recommendations, RelatedPapers, SuggestBox } from '../components/Discover'

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

const HIDDEN_COMMUNITIES_KEY = 'snarp-hidden-communities'
function readHiddenCommunities() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_COMMUNITIES_KEY) || '[]').map(String) } catch { return [] }
}
function storeHiddenCommunities(ids) {
  try { localStorage.setItem(HIDDEN_COMMUNITIES_KEY, JSON.stringify(ids.slice(-500))) } catch {}
}

async function shareCommunity(community) {
  const url = `${window.location.origin}/communities/${community.id}`
  if (navigator.share) {
    try {
      await navigator.share({ title: community.name, text: `Join ${community.name} on SNARP`, url })
      return 'Shared.'
    } catch (err) {
      if (err.name === 'AbortError') return ''
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'Link copied. Paste it anywhere to invite people.'
  } catch {
    return `Copy this link to share: ${url}`
  }
}

function CommunityTabs() {
  return (
    <nav className="papers-tabs" aria-label="Communities">
      <NavLink to="/communities" end>Communities</NavLink>
      <NavLink to="/events">Events</NavLink>
      <NavLink to="/tools">Citations</NavLink>
    </nav>
  )
}

function CommunityCard({ community, hidden, onMembership, onShare, onHide, onRestore }) {
  const owner = community.membership_role === 'owner'
  return (
    <article className={`panel community-card ${hidden ? 'community-hidden' : ''}`}>
      <span className="community-mark" aria-hidden="true">{community.name.trim()[0]?.toUpperCase()}</span>
      <div className="community-card-body">
        <h3><Link to={`/communities/${community.id}`} title={community.name}>{community.name}</Link></h3>
        <p className="community-card-meta">
          <span><Users size={13} /> {community.member_count}</span>
          <span className="community-card-topic">{community.category}</span>
          {owner && <span className="community-card-owner">Owner</span>}
        </p>
        {community.description && <p className="community-card-desc" title={community.description}>{community.description}</p>}
      </div>
      <div className="community-card-side">
        {hidden
          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestore(community)}><ArrowCounterClockwise size={14} /> Show</button>
          : !owner && <button type="button" className={`btn btn-sm ${community.joined ? 'btn-ghost' : 'btn-primary'}`} onClick={() => onMembership(community)}>{community.joined ? 'Leave' : 'Join'}</button>}
        <span className="community-card-icons">
          <button type="button" className="icon-btn community-icon" onClick={() => onShare(community)} aria-label={`Share ${community.name}`} title="Share"><ShareNetwork size={16} /></button>
          {!hidden && !owner && (
            <button type="button" className="icon-btn community-icon" onClick={() => onHide(community)} aria-label={`Remove ${community.name} from this device`} title="Remove from this device"><EyeSlash size={16} /></button>
          )}
        </span>
      </div>
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
  const [creating, setCreating] = useState(false)
  const [hiddenIds, setHiddenIds] = useState(readHiddenCommunities)
  const [showHidden, setShowHidden] = useState(false)
  const [flash, setFlash] = useState('')
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
    if (community.joined && !window.confirm(`Leave ${community.name}? You can join again at any time.`)) return
    try {
      await api(`/communities/${community.id}/membership`, { method: 'PUT', body: { joined: !community.joined } })
      setActionError('')
      setFlash(community.joined ? `You left ${community.name}.` : `You joined ${community.name}.`)
      setRefresh((value) => value + 1)
    } catch (err) { setActionError(err.message) }
  }
  const share = async (community) => {
    const message = await shareCommunity(community)
    if (message) setFlash(message)
  }
  const hide = (community) => {
    const next = [...new Set([...hiddenIds, String(community.id)])]
    setHiddenIds(next)
    storeHiddenCommunities(next)
    setFlash(`${community.name} was removed from this device. Other people still see it.`)
  }
  const restore = (community) => {
    const next = hiddenIds.filter((value) => value !== String(community.id))
    setHiddenIds(next)
    storeHiddenCommunities(next)
    setFlash(`${community.name} is back in your list.`)
  }
  const isHidden = (community) => hiddenIds.includes(String(community.id))
  const visible = communities.filter((community) => showHidden ? isHidden(community) : !isHidden(community))
  const hiddenHere = communities.filter(isHidden).length
  const create = async (event) => {
    event.preventDefault(); setSaving(true); setActionError('')
    try {
      await api('/communities', { method: 'POST', body: form })
      setForm({ name: '', category: '', description: '' }); setCreating(false); setRefresh((value) => value + 1)
    } catch (err) { setActionError(err.message) }
    finally { setSaving(false) }
  }
  return (
    <div className="page">
      <PageHeader title="Communities" sub="Join research groups, share them with others and keep your list tidy.">
        {!creating && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New community</button>}
      </PageHeader>
      <CommunityTabs />
      {error && <p className="alert" role="alert">{error}</p>}
      {flash && <p className="notice" role="status">{flash}</p>}
      {creating && <form className="panel form-panel community-create" onSubmit={create}><h2>New community</h2><div className="form-row">
        <div className="field"><label htmlFor="community-name">Name</label><input id="community-name" maxLength={100} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="community-category">Research topic</label><input id="community-category" maxLength={120} required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Computer science, education…" /></div>
      </div><div className="field"><label htmlFor="community-description">Description</label><textarea id="community-description" maxLength={2000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div><div className="form-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create community'}</button><button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button></div></form>}
      <div className="field community-search"><label htmlFor="community-search" className="sr-only">Search communities</label><input id="community-search" maxLength={120} value={query} onChange={(e) => { setQuery(e.target.value); setCommunityPage(1) }} placeholder="Search communities" /></div>
      {!loading && (hiddenHere > 0 || showHidden) && (
        <p className="muted-sm community-hidden-note">
          {showHidden ? 'Communities you removed from this device.' : `${hiddenHere} removed from this device.`}
          <button type="button" className="link-btn" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Back to my list' : 'Show them'}</button>
        </p>
      )}
      {loading ? <p className="muted-sm">Loading communities…</p> : visible.length ? <div className="card-grid community-grid">{visible.map((community) => <CommunityCard key={community.id} community={community} hidden={isHidden(community)} onMembership={membership} onShare={share} onHide={hide} onRestore={restore} />)}</div> : <div className="panel empty"><h3>{showHidden ? 'Nothing removed on this device' : query ? 'No communities match your search' : 'No communities yet'}</h3></div>}
      {!loading && (communityPage > 1 || result.hasMore) && <div className="paper-pagination"><button className="btn btn-ghost" onClick={() => setCommunityPage((value) => Math.max(1, value - 1))} disabled={communityPage <= 1}>Previous</button><span className="muted-sm">Page {communityPage}</span><button className="btn btn-ghost" onClick={() => setCommunityPage((value) => value + 1)} disabled={!result.hasMore}>Next</button></div>}
    </div>
  )
}

export function CommunityDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [flash, setFlash] = useState('')
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
    if (community.membership_role && !window.confirm(`Leave ${community.name}? You can join again at any time.`)) return
    try {
      await api(`/communities/${id}/membership`, { method: 'PUT', body: { joined: !community.membership_role } })
      await load()
    } catch (err) { setError(err.message) }
  }
  const share = async () => {
    const message = await shareCommunity(community)
    if (message) setFlash(message)
  }
  const disband = async () => {
    if (!window.confirm(`Disband ${community.name}? This deletes the community, its discussions and its member list for everyone. It cannot be undone.`)) return
    try {
      await api(`/communities/${id}`, { method: 'DELETE' })
      navigate('/communities', { replace: true })
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
  return <div className="page community-layout">
    <div className="community-main">
      <PageHeader title={community.name} sub={`${community.category} · ${community.member_count} ${community.member_count === 1 ? 'member' : 'members'} · Started by ${community.creator_name}`}>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={share}><ShareNetwork size={16} /> Share</button>
          {canEditCommunity && <button className="btn btn-ghost" onClick={() => setEdit(!edit)}>{edit ? 'Cancel edit' : 'Edit'}</button>}
          {community.membership_role === 'owner'
            ? <button className="btn btn-ghost btn-danger" onClick={disband}><Trash size={16} /> Disband</button>
            : <button className={`btn ${community.membership_role ? 'btn-ghost' : 'btn-primary'}`} onClick={join}>{community.membership_role ? 'Leave community' : 'Join community'}</button>}
        </div>
      </PageHeader>
      {error && <p className="alert" role="alert">{error}</p>}
      {flash && <p className="notice" role="status">{flash}</p>}
      {edit && canEditCommunity && <form className="panel form-panel community-edit" onSubmit={update}><div className="form-row"><div className="field"><label htmlFor="ce-name">Name</label><input id="ce-name" maxLength={100} required value={community.name} onChange={(e) => setCommunity({ ...community, name: e.target.value })} /></div><div className="field"><label htmlFor="ce-topic">Topic</label><input id="ce-topic" maxLength={120} required value={community.category} onChange={(e) => setCommunity({ ...community, category: e.target.value })} /></div></div><div className="field"><label htmlFor="ce-desc">Description</label><textarea id="ce-desc" rows={3} maxLength={2000} value={community.description} onChange={(e) => setCommunity({ ...community, description: e.target.value })} /></div><div className="form-actions"><button className="btn btn-primary" disabled={saving}>Save changes</button></div></form>}
      {community.membership_role
        ? <form className="panel composer community-post-form" onSubmit={post}><Avatar name={user.name} src={user.avatar_url} /><div className="composer-main"><label htmlFor="community-post-body" className="sr-only">Start a discussion</label><textarea id="community-post-body" rows={2} maxLength={5000} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Start a discussion: a question, an update or a collaboration idea" /><div className="composer-foot"><button className="btn btn-primary btn-sm" disabled={saving || !body.trim()}>{saving ? 'Posting…' : 'Post'}</button></div></div></form>
        : <p className="notice">Join this community to start discussions.</p>}
      {posts.length ? <ul className="post-stack">{posts.map((item) => <li className="panel post" key={item.id}>
        <Link to={`/users/${item.user_id}`} tabIndex={-1} aria-hidden="true"><Avatar name={item.author_name} src={item.author_avatar_url} /></Link>
        <div className="post-main">
          <div className="post-head">
            <Link to={`/users/${item.user_id}`} className="post-author"><strong>{item.author_name}</strong></Link>
            <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{timeAgo(item.created_at)}</time>
            {(String(item.user_id) === String(user.id) || canManage) && <span className="post-owner-actions"><button className="icon-btn" onClick={() => removePost(item.id)} aria-label="Remove post" title="Remove"><Trash size={16} /></button></span>}
          </div>
          <p className="post-body">{item.body}</p>
        </div>
      </li>)}</ul> : <div className="panel empty"><h3>No discussions yet</h3><p>{community.membership_role ? 'Start the first one above.' : 'Members can start discussions here.'}</p></div>}
      {(page > 1 || hasMore) && <div className="paper-pagination"><button className="btn btn-ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><span className="muted-sm">Page {page}</span><button className="btn btn-ghost" onClick={() => setPage((value) => value + 1)} disabled={!hasMore}>Next</button></div>}
    </div>
    <aside className="community-side">
      <section className="panel rail-card">
        <div className="rail-head"><h3>About</h3></div>
        <p className="community-description">{community.description || 'No description yet.'}</p>
      </section>
      <section className="panel rail-card">
        <div className="rail-head"><h3>Members</h3><span className="muted-sm">{community.member_count}</span></div>
        <div className="community-member-list">{members.map((member) => <div className="community-member" key={member.user_id}><Avatar name={member.name} src={member.avatar_url} size="sm" /><span><Link to={`/users/${member.user_id}`}>{member.name}</Link><small>{member.role}</small></span>{canManageMembers && member.role !== 'owner' && <button className="btn btn-ghost btn-sm" onClick={() => updateMemberRole(member, member.role === 'moderator' ? 'member' : 'moderator')}>{member.role === 'moderator' ? 'Remove mod' : 'Make mod'}</button>}</div>)}</div>
        {members.length === 100 && <p className="muted-sm">Showing the first 100 members.</p>}
      </section>
    </aside>
  </div>
}

function PapersTabs() {
  return (
    <nav className="papers-tabs" aria-label="Papers">
      <NavLink to="/articles" end>All papers</NavLink>
      <NavLink to="/saved">Saved</NavLink>
      <NavLink to="/my-submissions">My papers</NavLink>
    </nav>
  )
}

export function Articles() {
  const [urlParams] = useSearchParams()
  return <ArticlesPage key={urlParams.toString()} urlParams={urlParams} />
}

function ArticlesPage({ urlParams }) {
  const [categories, setCategories] = useState([])
  const [filters, setFilters] = useState(() => ({ q: urlParams.get('q') ?? '', author: '', domain: urlParams.get('domain') ?? '', tag: urlParams.get('tag') ?? '', sort: 'newest' }))
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
  const filtered = ['q', 'author', 'domain', 'tag'].some((field) => applied[field].trim())
  const data = loading ? null : result.data
  const error = loading ? '' : result.error
  const update = (field, value) => setFilters((current) => ({ ...current, [field]: value }))
  const apply = (event) => {
    event.preventDefault()
    setPage(1)
    setApplied(filters)
  }

  return (
    <div className="page papers-page">
      <PageHeader title="Papers" sub="Browse published research, keep a reading list and follow your own submissions." />
      <PapersTabs />
      <form className="paper-search-form" onSubmit={apply}>
        <div className="paper-search-bar">
          <div className="field"><label htmlFor="paper-query" className="sr-only">Search papers</label><SuggestBox id="paper-query" showPeople={false} value={filters.q} onChange={(value) => update('q', value)} onSubmit={() => { setPage(1); setApplied(filters) }} placeholder="Search by title, abstract, DOI or keyword" inputProps={{ maxLength: 200 }} /></div>
          <button className="btn btn-primary" type="submit">Search</button>
        </div>
        <div className="paper-filters">
          <div className="field"><label htmlFor="paper-author">Author</label><input id="paper-author" maxLength={120} value={filters.author} onChange={(event) => update('author', event.target.value)} placeholder="Any" /></div>
          <div className="field"><label htmlFor="paper-tag">Tag</label><input id="paper-tag" maxLength={40} value={filters.tag} onChange={(event) => update('tag', event.target.value)} placeholder="Any" /></div>
          <div className="field"><label htmlFor="paper-domain">Category</label><select id="paper-domain" value={filters.domain} onChange={(event) => update('domain', event.target.value)}><option value="">All</option>{categories.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></div>
          <div className="field"><label htmlFor="paper-sort">Sort</label><select id="paper-sort" value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title_asc">Title A-Z</option><option value="title_desc">Title Z-A</option></select></div>
        </div>
        {categoryError && <p className="field-error" role="status">Categories could not be loaded.</p>}
      </form>
      {!filtered && page === 1 && <Recommendations />}
      {filtered && <p className="muted-sm filter-note">Showing {[applied.domain && `category "${applied.domain}"`, applied.tag && `tag "${applied.tag}"`, applied.q && `"${applied.q}"`, applied.author && `author "${applied.author}"`].filter(Boolean).join(', ')}. <Link to="/articles">Clear filters</Link></p>}
      {filtered && <QueryTopics query={applied.q || applied.tag || applied.domain} />}
      {!filtered && page === 1 && <h2 className="section-title">All papers</h2>}
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && <p className="muted-sm" aria-live="polite">Loading papers…</p>}
      {(data?.items ?? []).length > 0 && <div className="paper-grid">
        {data.items.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}
      </div>}
      {!loading && !error && data?.total === 0 && <div className="panel empty"><h3>No papers found</h3><p>Try a different search or clear the filters.</p></div>}
      {!loading && data?.total > data?.limit && <div className="paper-pagination"><span className="muted-sm">{data.total} approved paper{data.total === 1 ? '' : 's'} · Page {data.page} of {Math.ceil(data.total / data.limit)}</span><div><button className="btn btn-ghost" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button><button className="btn btn-ghost" onClick={() => setPage((current) => current + 1)} disabled={!data.hasMore}>Next</button></div></div>}
    </div>
  )
}

function PaperPdf({ paperId, label = 'View paper', title, filename }) {
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
    {pdfUrl && <PdfReader url={pdfUrl} title={title} filename={filename} onClose={() => setPdfUrl('')} />}
  </>
}

function PublishedPaperCard({ paper, onRemove }) {
  const authorNames = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean)
  const tags = paper.tags ?? []
  return <article className="panel paper-card">
    <div className="paper-card-meta">
      {paper.domain && <span className="paper-card-domain">{paper.domain}</span>}
      <time dateTime={paper.published_at ?? paper.created_at}>{new Date(paper.published_at ?? paper.reviewed_at ?? paper.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
    </div>
    <h3><Link to={`/articles/${paper.id}`}>{paper.title}</Link></h3>
    {authorNames.length > 0 && <p className="paper-card-authors">{authorNames.join(', ')}</p>}
    <p className="paper-card-abstract">{paper.abstract}</p>
    {tags.length > 0 && <div className="paper-card-tags">{tags.slice(0, 3).map((tag) => <Link key={tag} to={`/articles?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>)}{tags.length > 3 && <span>+{tags.length - 3}</span>}</div>}
    <div className="paper-card-foot">
      <Link className="btn btn-secondary btn-sm" to={`/articles/${paper.id}`}><FilePdf size={15} /> Read paper</Link>
      {paper.doi && <a className="btn btn-ghost btn-sm" href={`https://doi.org/${encodeURIComponent(paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}`} target="_blank" rel="noreferrer">DOI</a>}
      {onRemove && <button type="button" className="btn btn-ghost btn-sm paper-card-remove" onClick={() => onRemove(paper)} aria-label={`Remove ${paper.title} from saved`}><BookmarkSimple size={14} weight="fill" /> Remove</button>}
    </div>
  </article>
}

export function PaperDetail({ user, onLogout }) {
  const { id } = useParams()
  const [result, setResult] = useState({ id: null, paper: null, error: '' })
  useEffect(() => {
    let active = true
    api(`/papers/${encodeURIComponent(id)}`)
      .then((paper) => {
        if (!active) return
        setResult({ id, paper, error: '' })
        recordView('paper', paper.id)
      })
      .catch((err) => { if (active) setResult({ id, paper: null, error: err.message }) })
    return () => { active = false }
  }, [id])

  const paper = result.id === id ? result.paper : null
  if (result.id === id && result.error) return <div className="page"><p className="alert" role="alert">{result.error}</p><Link to="/articles">Back to papers</Link></div>
  if (!paper) return <div className="page"><div className="panel empty" aria-busy="true">Loading paper…</div></div>
  const authors = (paper.authors ?? []).map((author) => typeof author === 'string' ? author : [author.name, author.affiliation].filter(Boolean).join(' · '))
  return <div className="page">
    <PageHeader title={paper.title} sub={`${paper.domain} · Published ${new Date(paper.published_at ?? paper.reviewed_at ?? paper.created_at).toLocaleDateString()}`} />
    <article className="panel paper-detail">
      <h2>Authors</h2><p className="article-authors">{(paper.authors ?? []).map((author, i) => (
        <span key={i}>{i > 0 && ', '}{author.user_id ? <Link to={`/users/${author.user_id}`}>{authors[i]}</Link> : authors[i]}</span>
      ))}</p>
      <p className="muted-sm">Submitted by {paper.submitter_name}</p>
      {paper.reviewer_count > 0 && <p className="peer-reviewed"><SealCheck size={16} weight="fill" /> Peer reviewed by {paper.reviewer_count} reviewer{paper.reviewer_count === 1 ? '' : 's'}{paper.round > 1 ? ` over ${paper.round} rounds` : ''} <Stars value={paper.avg_rating} size={14} /></p>}
      {paper.doi && <p><strong>DOI:</strong> <a href={`https://doi.org/${encodeURIComponent(paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}`} target="_blank" rel="noreferrer">{paper.doi}</a></p>}
      <h2>Abstract</h2><p className="paper-detail-abstract">{paper.abstract}</p>
      {paper.tags?.length > 0 && <><h2>Keywords</h2><div className="tag-row">{paper.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div></>}
      <h2>Full paper</h2>
      <PdfAttachment paperId={paper.id} filename={paper.pdf_filename} size={paper.pdf_size} title={paper.title} />
      <div className="article-actions"><Link className="btn btn-ghost btn-sm" to="/articles">Back to papers</Link></div>
    </article>
    <section className="panel paper-discussion" aria-label="Discussion">
      <h2>Discussion</h2>
      <PostActions post={paper} kind="paper" viewerId={user.id} canModerate={['admin', 'moderator'].includes(user.role)} onLogout={onLogout}
        onUpdate={(updated) => setResult((current) => ({ ...current, paper: { ...current.paper, ...updated } }))} />
    </section>
    <RelatedPapers paperId={paper.id} />
  </div>
}

export function SavedPapers() {
  const [state, setState] = useState({ loading: true, papers: [], error: '' })
  useEffect(() => {
    let active = true
    api('/papers/saved')
      .then((papers) => { if (active) setState({ loading: false, papers, error: '' }) })
      .catch((err) => { if (active) setState({ loading: false, papers: [], error: err.message }) })
    return () => { active = false }
  }, [])
  const unsave = async (paper) => {
    try {
      await api(`/papers/${paper.id}/save`, { method: 'PUT', body: { saved: false } })
      setState((current) => ({ ...current, papers: current.papers.filter((item) => item.id !== paper.id) }))
    } catch (err) { setState((current) => ({ ...current, error: err.message })) }
  }
  return <div className="page papers-page">
    <PageHeader title="Papers" sub="Your reading list. Save papers from the feed or a paper's page." />
    <PapersTabs />
    {state.error && <p className="alert" role="alert">{state.error}</p>}
    {state.loading ? <p className="muted-sm">Loading saved papers…</p> : state.papers.length === 0
      ? <div className="panel empty"><h3>No saved papers</h3><p>Press Save on any research paper to keep it here.</p><Link className="btn btn-ghost btn-sm" to="/articles">Browse all papers</Link></div>
      : <div className="paper-grid">{state.papers.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} onRemove={unsave} />)}</div>}
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
        <span className="tag">{event.kind}</span>
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
  const [creating, setCreating] = useState(false)
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
      setForm(emptyEventForm); setCreating(false); setPage(1); setRefresh((value) => value + 1)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const data = result.key === key ? result : null
  return (
    <div className="page">
      <PageHeader title="Communities" sub="Workshops, talks and meetups from the research community.">
        {canCreate && !creating && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New event</button>}
      </PageHeader>
      <CommunityTabs />
      {error && <p className="alert" role="alert">{error}</p>}
      {canCreate && creating && <form className="panel form-panel event-create" onSubmit={create}><h2>New event</h2><div className="form-row">
        <div className="field"><label htmlFor="event-title">Title</label><input id="event-title" maxLength={200} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="event-kind">Event type</label><input id="event-kind" maxLength={80} required value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} placeholder="Workshop, webinar…" /></div>
      </div><div className="field"><label htmlFor="event-description">Description</label><textarea id="event-description" maxLength={3000} rows={3} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="form-row form-row-3"><div className="field"><label htmlFor="event-location">Location or meeting link</label><input id="event-location" maxLength={200} required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div><div className="field"><label htmlFor="event-start">Starts</label><input id="event-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div><div className="field"><label htmlFor="event-end">Ends</label><input id="event-end" type="datetime-local" required value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></div></div>
      <div className="field"><label htmlFor="event-capacity">Capacity (optional)</label><input id="event-capacity" type="number" min="1" max="100000" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Unlimited" /></div><div className="form-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish event'}</button><button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button></div></form>}
      <div className="field event-search"><label htmlFor="event-search" className="sr-only">Search events</label><input id="event-search" maxLength={120} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="Search events" /></div>
      {result.key === key && result.error && <p className="alert" role="alert">{result.error}</p>}
      {isLoading && <p className="muted-sm">Loading events…</p>}
      {items.length > 0 && <div className="stack stack-list">
        {items.map((event) => <EventCard key={event.id} event={event} onRegister={register} />)}
      </div>}
      {!isLoading && data?.total === 0 && <div className="panel empty"><h3>{query ? 'No events match your search' : 'No upcoming events'}</h3></div>}
      {!isLoading && data?.total > data?.limit && <div className="paper-pagination"><span className="muted-sm">{data.total} upcoming event{data.total === 1 ? '' : 's'} · Page {page} of {Math.ceil(data.total / data.limit)}</span><div><button className="btn btn-ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><button className="btn btn-ghost" onClick={() => setPage((value) => value + 1)} disabled={!data.hasMore}>Next</button></div></div>}
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
  const threadRef = useRef(null)
  const active = convos.find((c) => String(c.id) === String(activeId))
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages.length, activeId])
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
      <PageHeader title="Messages" />
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="panel inbox">
        <aside className="inbox-sidebar"><div className="inbox-compose"><label htmlFor="message-user-search" className="sr-only">New message</label><input id="message-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="New message: search people" />{matchingUsers.length > 0 && <ul className="message-user-results">{matchingUsers.map((person) => <li key={person.id}><button onClick={() => startConversation(person)}><Avatar name={person.name} src={person.avatar_url} size="sm" /><span>{person.name}<small>{person.institution || person.department || person.role}</small></span></button></li>)}</ul>}</div>
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
          <div className="thread-body" ref={threadRef}>
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
          </form></> : <div className="thread-empty"><ChatCircle size={24} /><p>Select a conversation</p></div>}
        </section>
      </div>
    </div>
  )
}

const NOTIF_ICON = {
  paper_review: SealCheck, like: Heart, message: ChatCircle, comment: ChatCircle,
  follow: UserPlus, paper_like: Heart, paper_comment: ChatCircle, review_request: SealCheck, coauthor: Users, story_mention: UserCircle, reel_like: Heart, reel_comment: ChatCircle, reel_tag: UserCircle, doc_invite: UserPlus, doc_joined: Users,
}

export function Notifications({ user }) {
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
  const target = (item) => {
    if (item.entity_type === 'conversation') return `/messages?conversation=${item.entity_id}`
    if (item.kind === 'paper_review') return item.entity_id ? `/my-submissions/${item.entity_id}` : '/my-submissions'
    if (item.kind === 'story_mention') return `/?story=${item.entity_id}`
    if (['reel_like', 'reel_comment', 'reel_tag'].includes(item.kind)) return `/reels?reel=${item.entity_id}`
    if (item.kind === 'doc_invite' || item.kind === 'doc_joined') return '/docs'
    if (item.kind === 'review_request') return `/reviews/${item.entity_id}`
    if (item.kind === 'coauthor' && item.entity_type === 'paper') return `/my-submissions/${item.entity_id}`
    if (item.entity_type === 'paper') return `/articles/${item.entity_id}`
    if (item.entity_type === 'user') return `/users/${item.entity_id}`
    if (item.entity_type === 'post') return `/users/${user.id}?post=${item.entity_id}#post-${item.entity_id}`
    return '/'
  }
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
      <PageHeader title="Communities" sub="Build APA and BibTeX citations to share in discussions. Fields you leave empty are left out." />
      <CommunityTabs />
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
  authors: [{ user_id: user?.id, name: user?.name ?? '', affiliation: user?.institution ?? '', avatar_url: user?.avatar_url ?? null }],
  additionalNotes: '',
})
const COMMON_DOMAINS = ['Artificial Intelligence', 'Computer Science', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Medicine & Health', 'Engineering', 'Environmental Science', 'Economics & Business', 'Education', 'Psychology', 'Social Sciences']
const splitTags = (value) => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()
const SUBMIT_STEPS = [
  { title: 'Upload paper', hint: 'PDF and smart fill', fields: ['pdf'] },
  { title: 'Paper details', hint: 'Title, abstract, domain', fields: ['title', 'abstract', 'domain', 'doi', 'tags'] },
  { title: 'Authors & submit', hint: 'Co-authors, notes, review', fields: ['authors', 'additionalNotes'] },
]
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s<>]+$/i
const cleanDoi = (value) => value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function PdfSuggestion({ value, onUse, label = value }) {
  if (!value) return null
  return (
    <p className="pdf-suggestion">
      <MagicWand size={14} />
      <span>From PDF: <q>{label.length > 160 ? `${label.slice(0, 160)}…` : label}</q></span>
      <button type="button" className="link-btn" onClick={onUse}>Use this</button>
    </p>
  )
}

const FromPdf = () => <span className="from-pdf"><MagicWand size={12} /> From PDF</span>
const nameKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ')

function FriendPicker({ friends, excluded, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const available = friends.filter((f) => !excluded.has(String(f.id)))
  const shown = available.filter((f) => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="friend-picker" role="dialog" aria-label="Add a co-author">
      <div className="friend-picker-head">
        <MagnifyingGlass size={16} />
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your friends"
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) onPick(shown[0]) } }} />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {shown.length > 0 ? (
        <ul className="friend-list">
          {shown.map((friend) => (
            <li key={friend.id}>
              <button type="button" onClick={() => onPick(friend)}>
                <Avatar name={friend.name} src={friend.avatar_url} size="sm" />
                <span><strong>{friend.name}</strong>{friend.institution && <small>{friend.institution}</small>}</span>
                <Plus size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="friend-empty">
          {friends.length === 0
            ? <><strong>No friends yet</strong><p>Co-authors must be your friends on SNARP: people you follow who follow you back. Follow your collaborators and ask them to follow you.</p><Link to="/search" className="btn btn-secondary btn-sm">Find researchers</Link></>
            : available.length === 0 ? <p>All your friends are already authors.</p> : <p>No friend matches &ldquo;{query}&rdquo;.</p>}
        </div>
      )}
    </div>
  )
}

function AuthorGate({ user, onUserUpdate }) {
  const [state, setState] = useState({ saving: false, error: '' })
  const become = async () => {
    setState({ saving: true, error: '' })
    try {
      const { role } = await api('/auth/me/role', { method: 'PUT', body: { role: 'author' } })
      onUserUpdate?.({ ...user, role })
    } catch (err) {
      setState({ saving: false, error: err.message })
    }
  }
  const member = user.role === 'user'
  return (
    <div className="page">
      <PageHeader title="Submit paper" />
      <section className="panel author-gate">
        <span className="author-gate-icon"><PenNib size={28} weight="duotone" /></span>
        <h2>{member ? 'Become an Author to submit papers' : 'Paper submission is for Author accounts'}</h2>
        <p>{member
          ? 'Your account is a Member account. Authors can submit research papers for peer review and review other researchers\' papers. You can switch back to Member any time in Settings.'
          : 'Your account is a Moderator account, which verifies papers submitted by others. Use an Author account to submit your own.'}</p>
        {state.error && <p className="alert" role="alert">{state.error}</p>}
        <div className="submit-actions">
          {member && <button type="button" className="btn btn-primary" onClick={become} disabled={state.saving}>{state.saving ? 'Switching…' : 'Switch to Author'}</button>}
          <Link to="/settings" className="btn btn-ghost">Account settings</Link>
        </div>
      </section>
    </div>
  )
}

export function Submit({ user, onUserUpdate }) {
  if (!['author', 'admin'].includes(user.role)) return <AuthorGate user={user} onUserUpdate={onUserUpdate} />
  return <SubmitWizard user={user} />
}

function SubmitWizard({ user }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(() => makeInitialPaperForm(user))
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [analysis, setAnalysis] = useState({ status: 'idle', error: '', result: null, filled: [], snapshot: null, missing: [] })
  const [fromPdf, setFromPdf] = useState({})
  const [categories, setCategories] = useState([])
  const [friends, setFriends] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInputRef = useRef(null)
  const requestKeyRef = useRef(null)
  const topRef = useRef(null)
  const cardRef = useRef(null)

  useEffect(() => { api('/papers/categories').then(setCategories).catch(() => {}) }, [])
  useEffect(() => { api('/users/friends').then(setFriends).catch(() => setFriends([])) }, [])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const touch = (name) => {
    setErrors((current) => ({ ...current, [name]: undefined }))
    setFromPdf((current) => ({ ...current, [name]: false }))
    setServerError('')
    requestKeyRef.current = null
  }
  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    touch(name)
  }
  const addCoauthor = (friend) => {
    setForm((current) => ({
      ...current,
      authors: [...current.authors, { user_id: friend.id, name: friend.name, affiliation: friend.institution ?? '', avatar_url: friend.avatar_url }],
    }))
    touch('authors')
    setPickerOpen(false)
  }
  const setAuthor = (index, name, value) => {
    setForm((current) => ({
      ...current,
      authors: current.authors.map((author, i) => i === index ? { ...author, [name]: value } : author),
    }))
    touch('authors')
  }

  const chooseFile = (nextFile) => {
    if (!nextFile) return
    setFile(nextFile)
    setPreviewUrl('')
    setAnalysis({ status: 'idle', error: '', result: null, filled: [], snapshot: null, missing: [] })
    setErrors((current) => ({ ...current, pdf: undefined }))
    setServerError('')
    requestKeyRef.current = null
    if (nextFile.size > MAX_PDF_BYTES) {
      setErrors((current) => ({ ...current, pdf: 'PDF must be 10 MB or smaller' }))
    } else if (!/\.pdf$/i.test(nextFile.name) && nextFile.type !== 'application/pdf') {
      setErrors((current) => ({ ...current, pdf: 'Choose a PDF file' }))
    }
  }

  const removeFile = () => {
    setFile(null)
    setPreviewUrl('')
    setAnalysis({ status: 'idle', error: '', result: null, filled: [], snapshot: null, missing: [] })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files?.[0] ?? null)
  }

  const togglePreview = () => setPreviewUrl((current) => (current ? '' : URL.createObjectURL(file)))

  const suggest = async () => {
    if (!file || errors.pdf) return false
    setAnalysis((current) => ({ ...current, status: 'loading', error: '' }))
    const body = new FormData()
    body.append('pdf', file)
    try {
      const result = await api('/papers/analyze', { method: 'POST', body })
      const snapshot = form
      const next = { ...form }
      const filled = []
      const marks = {}
      const fill = (name, value) => { next[name] = value; filled.push(name); marks[name] = true }
      for (const name of ['title', 'abstract', 'doi', 'domain']) {
        if (result[name] && !form[name].trim()) fill(name, result[name])
      }
      if (result.notes && !form.additionalNotes.trim()) fill('additionalNotes', result.notes)
      if (result.tags.length && !form.tags.trim()) fill('tags', result.tags.slice(0, 8).join(', '))
      if (result.sources?.authors === 'text') {
        const byName = new Map((friends ?? []).map((f) => [nameKey(f.name), f]))
        const present = new Set(form.authors.map((a) => String(a.user_id)))
        const added = []
        let authors = [...form.authors]
        for (const pdfAuthor of result.authors) {
          if (sameText(pdfAuthor.name, user?.name ?? '') && !authors[0].affiliation.trim() && pdfAuthor.affiliation) {
            authors = [{ ...authors[0], affiliation: pdfAuthor.affiliation }, ...authors.slice(1)]
          }
          const friend = byName.get(nameKey(pdfAuthor.name))
          if (friend && !present.has(String(friend.id))) {
            present.add(String(friend.id))
            added.push({ user_id: friend.id, name: friend.name, affiliation: pdfAuthor.affiliation || friend.institution || '', avatar_url: friend.avatar_url })
          }
        }
        if (added.length || authors[0] !== form.authors[0]) fill('authors', [...authors, ...added])
      }
      const missing = [['title', 'title'], ['abstract', 'abstract'], ['domain', 'research domain']]
        .filter(([key]) => !next[key].trim()).map(([, label]) => label)
      setForm(next)
      setFromPdf(marks)
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !filled.includes(key))))
      setAnalysis({ status: 'done', error: '', result, filled, snapshot, missing })
      return true
    } catch (err) {
      const message = err.status === 404 ? 'PDF suggestions are not available on this server yet. Restart the backend and try again, or fill in the details by hand.' : err.message
      setAnalysis({ status: 'error', error: message, result: null, filled: [], snapshot: null, missing: [] })
      return false
    }
  }

  const undoSuggestions = () => {
    if (analysis.snapshot) setForm(analysis.snapshot)
    setFromPdf({})
    setAnalysis((current) => ({ ...current, filled: [], snapshot: null, missing: [] }))
  }

  const applySuggestion = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
    setFromPdf((current) => ({ ...current, [name]: true }))
  }

  const addTag = (tag) => {
    const tags = splitTags(form.tags)
    if (tags.some((t) => sameText(t, tag)) || tags.length >= 20) return
    update('tags', [...tags, tag].join(', '))
  }
  const removeTag = (tag) => update('tags', splitTags(form.tags).filter((t) => t !== tag).join(', '))

  const fieldProblems = (fields) => {
    const found = {}
    const want = (name) => fields.includes(name)
    if (want('pdf')) {
      if (!file) found.pdf = 'Choose your paper PDF to continue'
      else if (file.size > MAX_PDF_BYTES) found.pdf = 'PDF must be 10 MB or smaller'
      else if (errors.pdf) found.pdf = errors.pdf
    }
    if (want('title')) {
      if (!form.title.trim()) found.title = 'Enter the paper title'
      else if (form.title.trim().length > 300) found.title = 'Title must be 300 characters or fewer'
    }
    if (want('abstract')) {
      if (!form.abstract.trim()) found.abstract = 'Enter the abstract'
      else if (form.abstract.trim().length > 20000) found.abstract = 'Abstract must be 20,000 characters or fewer'
    }
    if (want('domain') && !form.domain.trim()) found.domain = 'Enter a research domain or category'
    if (want('doi') && form.doi.trim() && !DOI_PATTERN.test(cleanDoi(form.doi))) found.doi = 'Enter a valid DOI, such as 10.1000/example'
    if (want('tags')) {
      const tags = splitTags(form.tags)
      if (tags.length > 20 || tags.some((tag) => tag.length > 40)) found.tags = 'Use up to 20 keywords, each 40 characters or fewer'
    }
    if (want('authors') && String(form.authors[0]?.user_id) !== String(user?.id)) found.authors = 'You must be the first author'
    if (want('additionalNotes') && form.additionalNotes.length > 5000) found.additionalNotes = 'Notes must be 5,000 characters or fewer'
    return found
  }
  const stepProblems = SUBMIT_STEPS.map((s) => fieldProblems(s.fields))
  const stepComplete = stepProblems.map((p) => Object.keys(p).length === 0)

  const showStep = (index, focusField) => {
    setStep(index)
    setPickerOpen(false)
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const target = focusField ? cardRef.current?.querySelector(`[data-field="${focusField}"]`) : null
      target?.querySelector('input:not([type=file]), textarea, label.dropzone')?.focus({ preventScroll: true })
    })
  }

  const goTo = (index) => {
    if (index <= step) return showStep(index)
    for (let i = step; i < index; i++) {
      const problems = stepProblems[i]
      const first = SUBMIT_STEPS[i].fields.find((f) => problems[f])
      if (first) {
        setErrors((current) => ({ ...current, ...problems }))
        return showStep(i, first)
      }
    }
    showStep(index)
  }

  const continueFromUpload = async () => {
    if (!file) return goTo(1)
    if (analysis.status === 'idle' && !errors.pdf) {
      const ok = await suggest()
      if (!ok) return
    }
    goTo(1)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (step < SUBMIT_STEPS.length - 1) return step === 0 ? continueFromUpload() : goTo(step + 1)
    setServerError('')
    const firstBad = stepComplete.findIndex((ok) => !ok)
    if (firstBad >= 0) {
      const problems = stepProblems[firstBad]
      setErrors((current) => ({ ...current, ...problems }))
      return showStep(firstBad, SUBMIT_STEPS[firstBad].fields.find((f) => problems[f]))
    }
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    if (String.fromCharCode(...signature) !== '%PDF-') {
      setErrors((current) => ({ ...current, pdf: 'The selected file is not a valid PDF' }))
      return showStep(0, 'pdf')
    }

    const authors = form.authors.map(({ user_id: userId, name, affiliation }) => ({ user_id: userId, name: name.trim(), affiliation: affiliation.trim() }))
    const body = new FormData()
    body.append('title', form.title.trim())
    body.append('abstract', form.abstract.trim())
    body.append('doi', form.doi.trim())
    body.append('domain', form.domain.trim())
    body.append('tags', JSON.stringify(splitTags(form.tags)))
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
      setPreviewUrl('')
      setFromPdf({})
      setStep(0)
      setAnalysis({ status: 'idle', error: '', result: null, filled: [], snapshot: null, missing: [] })
      requestKeyRef.current = null
      window.scrollTo({ top: 0 })
    } catch (error) {
      if (error.field) {
        setErrors((current) => ({ ...current, [error.field]: error.message }))
        const owner = SUBMIT_STEPS.findIndex((s) => s.fields.includes(error.field))
        if (owner >= 0) showStep(owner, error.field)
      } else {
        setServerError(error.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const startAnother = () => {
    setSubmitted(null)
    setErrors({})
    setServerError('')
  }

  const suggestion = analysis.result
  const currentTags = splitTags(form.tags)
  const extraTags = (suggestion?.tags ?? []).filter((tag) => !currentTags.some((t) => sameText(t, tag)))
  const domainOptions = [...new Set([...categories, ...COMMON_DOMAINS])]
  const abstractWords = form.abstract.trim() ? form.abstract.trim().split(/\s+/).length : 0
  const authorIds = new Set(form.authors.map((a) => String(a.user_id)))
  const availableFriends = (friends ?? []).filter((f) => !authorIds.has(String(f.id))).length
  const friendNames = new Set((friends ?? []).map((f) => nameKey(f.name)))
  const pdfOthers = (suggestion?.sources?.authors === 'text' ? suggestion.authors : [])
    .filter((a) => !sameText(a.name, user?.name ?? '') && !form.authors.some((x) => sameText(x.name, a.name)))
  const FOUND = [['title', 'Title'], ['abstract', 'Abstract'], ['domain', 'Research domain'], ['doi', 'DOI'], ['tags', 'Keywords'], ['authors', 'Co-authors'], ['notes', 'Notes for reviewers']]
  const foundValue = (key) => (key === 'tags' ? suggestion?.tags?.length : key === 'authors' ? suggestion?.authors?.length && suggestion.sources?.authors === 'text' : suggestion?.[key])

  if (submitted) {
    return (
      <div className="page">
        <PageHeader title="Submit paper" />
        <section className="panel submit-success" role="status">
          <CheckCircle size={40} weight="duotone" className="submit-success-icon" />
          <h2>Paper submitted</h2>
          <p>{submitted.status === 'coauthor_check'
            ? <>&ldquo;{submitted.title}&rdquo; is waiting for your co-authors to check and approve the PDF. It goes to peer review automatically once they all approve.</>
            : <>&ldquo;{submitted.title}&rdquo; is now waiting for peer review. Reviewers&apos; feedback will appear under My papers.</>}</p>
          <p className="muted-sm">Submission #{submitted.id} · {new Date(submitted.submittedAt).toLocaleString()}</p>
          <div className="submit-actions">
            <Link to={`/my-submissions/${submitted.id}`} className="btn btn-primary">Track this submission</Link>
            <button type="button" className="btn btn-ghost" onClick={startAnother}>Submit another paper</button>
          </div>
        </section>
      </div>
    )
  }

  const pdfPreview = previewUrl && (
    <section className="panel wizard-preview">
      <div className="wizard-preview-head"><span><FilePdf size={16} /> {file?.name}</span><button type="button" className="btn btn-ghost btn-sm" onClick={togglePreview}>Hide</button></div>
      <iframe title="Preview of the selected PDF" src={previewUrl} />
    </section>
  )

  return (
    <div className="page page-wide" ref={topRef}>
      <PageHeader title="Submit paper" sub="Three quick steps: upload your PDF, check the details, add your co-authors." />

      <ol className="wizard-steps" aria-label="Submission steps">
        {SUBMIT_STEPS.map((s, index) => {
          const state = index === step ? 'current' : stepComplete[index] && index < step ? 'done' : SUBMIT_STEPS[index].fields.some((f) => errors[f]) ? 'error' : 'todo'
          return (
            <li key={s.title} className={`wizard-step ${state}`}>
              <button type="button" onClick={() => goTo(index)} aria-current={index === step ? 'step' : undefined}>
                <span className="wizard-dot">{state === 'done' ? <Check size={14} weight="bold" /> : state === 'error' ? <Warning size={14} weight="bold" /> : index + 1}</span>
                <span className="wizard-label"><strong>{s.title}</strong><small>{s.hint}</small></span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="wizard-progress" aria-hidden="true"><i style={{ width: `${((step + (stepComplete[step] ? 1 : 0.5)) / SUBMIT_STEPS.length) * 100}%` }} /></div>

      {serverError && <p className="alert" role="alert">{serverError}</p>}

      <form className="wizard" onSubmit={submit} noValidate>
        {step === 0 && (
          <section ref={cardRef} className="panel wizard-card" aria-labelledby="step-1-title">
            <header className="wizard-head">
              <span className="step-num">1</span>
              <div><h2 id="step-1-title">Upload your paper</h2><p>SNARP reads your PDF and fills in as much of the form as it can.</p></div>
            </header>
            <div className="upload-grid">
              <div className="upload-left" data-field="pdf">
                <label
                  className={`dropzone paper-dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''} ${errors.pdf ? 'invalid' : ''}`}
                  htmlFor="p-pdf"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  <input ref={fileInputRef} id="p-pdf" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-invalid={!!errors.pdf} aria-describedby="p-pdf-error" />
                  {file ? <FilePdf size={40} weight="duotone" /> : <UploadSimple size={36} />}
                  <strong>{file ? file.name : 'Drop your PDF here or click to choose'}</strong>
                  <span>{file ? `${formatFileSize(file.size)}${suggestion?.pages ? ` · ${suggestion.pages} page${suggestion.pages === 1 ? '' : 's'}` : ''} · click to change` : 'PDF only · Maximum 10 MB'}</span>
                </label>
                <span className="field-error" id="p-pdf-error">{errors.pdf}</span>
                {file && (
                  <div className="upload-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={suggest} disabled={!!errors.pdf || analysis.status === 'loading'}>
                      <MagicWand size={15} /> {analysis.status === 'loading' ? 'Reading your PDF…' : analysis.status === 'done' ? 'Suggest again' : 'Suggest details'}
                    </button>
                    {!errors.pdf && <button type="button" className="btn btn-ghost btn-sm" onClick={togglePreview} aria-pressed={!!previewUrl}><FilePdf size={15} /> {previewUrl ? 'Hide preview' : 'Preview'}</button>}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={removeFile}><Trash size={15} /> Remove</button>
                  </div>
                )}
              </div>

              <div className="upload-right">
                {analysis.status === 'done' ? (
                  <div className={`scan-report ${suggestion.text_found && suggestion.looks_like_paper ? '' : 'warn'}`} role="status">
                    <h3><MagicWand size={16} /> {analysis.filled.length ? `Filled ${analysis.filled.length} field${analysis.filled.length === 1 ? '' : 's'} from your PDF` : 'Nothing new to fill in'}</h3>
                    <ul className="scan-list">
                      {FOUND.map(([key, label]) => {
                        const ok = !!foundValue(key)
                        return <li key={key} className={ok ? 'ok' : ''}>{ok ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}<span>{label}</span><small>{ok ? (analysis.filled.includes(key === 'notes' ? 'additionalNotes' : key) ? 'filled' : 'suggested') : 'not found'}</small></li>
                      })}
                    </ul>
                    {!suggestion.text_found
                      ? <p>This PDF has little or no selectable text (it may be a scan), so most details must be typed in.</p>
                      : !suggestion.looks_like_paper && <p>It doesn&apos;t look like a research paper (no abstract heading, author list or keywords), so check every suggestion.</p>}
                    {analysis.missing?.length > 0 && <p>You will add: <strong>{analysis.missing.join(', ')}</strong>.</p>}
                    {analysis.snapshot && analysis.filled.length > 0 && <button type="button" className="link-btn" onClick={undoSuggestions}>Undo all suggestions</button>}
                  </div>
                ) : analysis.status === 'error' ? (
                  <div className="scan-report warn" role="alert"><h3><Warning size={16} /> Couldn&apos;t read this PDF</h3><p>{analysis.error}</p><p>You can still continue and fill in the details yourself.</p></div>
                ) : (
                  <div className="scan-report idle">
                    <h3><MagicWand size={16} /> Smart fill</h3>
                    <p>{file ? 'Press Continue and SNARP will read your paper and fill in:' : 'After you choose your PDF, SNARP reads it and fills in:'}</p>
                    <ul className="scan-list">{FOUND.map(([key, label]) => <li key={key}><Circle size={16} /><span>{label}</span></li>)}</ul>
                    <p className="muted-sm">Everything stays editable, and filled fields are marked &ldquo;From PDF&rdquo;.</p>
                  </div>
                )}
              </div>
            </div>
            {pdfPreview}
            <footer className="wizard-foot">
              <Link to="/" className="btn btn-ghost">Cancel</Link>
              <span className="wizard-spacer" />
              {file && analysis.status === 'idle' && !errors.pdf && <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}>Skip smart fill</button>}
              <button type="submit" className="btn btn-primary" disabled={analysis.status === 'loading'}>
                {analysis.status === 'loading' ? 'Reading your PDF…' : file && analysis.status === 'idle' && !errors.pdf ? <><MagicWand size={16} /> Fill in and continue</> : <>Continue <ArrowRight size={16} /></>}
              </button>
            </footer>
          </section>
        )}

        {step === 1 && (
          <div className={`details-layout ${previewUrl ? 'with-preview' : ''}`}>
            <section ref={cardRef} className="panel wizard-card" aria-labelledby="step-2-title">
              <header className="wizard-head">
                <span className="step-num">2</span>
                <div><h2 id="step-2-title">Paper details</h2><p>Check what was filled in and complete the rest.</p></div>
                {file && !previewUrl && <button type="button" className="btn btn-ghost btn-sm wizard-head-action" onClick={togglePreview}><FilePdf size={15} /> Show PDF alongside</button>}
              </header>

              <div className={`field ${fromPdf.title ? 'suggested' : ''}`} data-field="title">
                <label htmlFor="p-title">Paper title <span className="req" aria-hidden="true">*</span>{fromPdf.title && <FromPdf />}<span className="field-count">{form.title.length}/300</span></label>
                <input id="p-title" className="title-input" value={form.title} maxLength={300} onChange={(e) => update('title', e.target.value)} aria-invalid={!!errors.title} aria-describedby="p-title-error" aria-required="true" placeholder="The full title of your paper" />
                <span className="field-error" id="p-title-error">{errors.title}</span>
                {suggestion?.title && !sameText(suggestion.title, form.title) && <PdfSuggestion value={suggestion.title} onUse={() => applySuggestion('title', suggestion.title)} />}
              </div>

              <div className={`field ${fromPdf.abstract ? 'suggested' : ''}`} data-field="abstract">
                <label htmlFor="p-abstract">Abstract <span className="req" aria-hidden="true">*</span>{fromPdf.abstract && <FromPdf />}<span className="field-count">{abstractWords} words</span></label>
                <textarea id="p-abstract" rows={9} maxLength={20000} value={form.abstract} onChange={(e) => update('abstract', e.target.value)} aria-invalid={!!errors.abstract} aria-describedby="p-abstract-error" aria-required="true" placeholder="Summarise the question, method, main result and why it matters (usually 150 to 300 words)." />
                {fromPdf.abstract && suggestion?.sources?.abstract === 'first-paragraph' && (
                  <p className="pdf-suggestion warn"><Warning size={14} /> <span>This PDF has no &ldquo;Abstract&rdquo; heading, so this is its opening paragraph. Rewrite it as a short summary of your paper.</span></p>
                )}
                <span className="field-error" id="p-abstract-error">{errors.abstract}</span>
                {suggestion?.abstract && !sameText(suggestion.abstract, form.abstract) && <PdfSuggestion value={suggestion.abstract} onUse={() => applySuggestion('abstract', suggestion.abstract)} />}
              </div>

              <div className="details-grid">
                <div className={`field ${fromPdf.domain ? 'suggested' : ''}`} data-field="domain">
                  <label htmlFor="p-domain">Research domain <span className="req" aria-hidden="true">*</span>{fromPdf.domain && <FromPdf />}</label>
                  <input id="p-domain" list="p-domain-options" value={form.domain} maxLength={120} onChange={(e) => update('domain', e.target.value)} placeholder="Start typing or pick one" aria-invalid={!!errors.domain} aria-describedby="p-domain-error" aria-required="true" />
                  <datalist id="p-domain-options">{domainOptions.map((d) => <option key={d} value={d} />)}</datalist>
                  <span className="field-error" id="p-domain-error">{errors.domain}</span>
                  {suggestion?.domain && !sameText(suggestion.domain, form.domain) && <PdfSuggestion value={suggestion.domain} onUse={() => applySuggestion('domain', suggestion.domain)} />}
                  {!form.domain && <div className="domain-chips">{COMMON_DOMAINS.slice(0, 6).map((d) => <button type="button" key={d} className="tag tag-add" onClick={() => update('domain', d)}>{d}</button>)}</div>}
                </div>
                <div className={`field ${fromPdf.doi ? 'suggested' : ''}`} data-field="doi">
                  <label htmlFor="p-doi">DOI <span className="muted-sm">(optional)</span>{fromPdf.doi && <FromPdf />}</label>
                  <input id="p-doi" value={form.doi} onChange={(e) => update('doi', e.target.value)} placeholder="10.1000/example" aria-invalid={!!errors.doi} aria-describedby="p-doi-error p-doi-help" />
                  <span className="field-hint" id="p-doi-help">{analysis.status === 'done' && !suggestion.doi ? 'No DOI was found in this PDF. Leave it empty if the paper is not published yet.' : 'The Digital Object Identifier, if the paper already has one.'}</span>
                  <span className="field-error" id="p-doi-error">{errors.doi}</span>
                  {suggestion?.doi && !sameText(suggestion.doi, form.doi) && <PdfSuggestion value={suggestion.doi} onUse={() => applySuggestion('doi', suggestion.doi)} />}
                </div>
              </div>

              <div className={`field ${fromPdf.tags ? 'suggested' : ''}`} data-field="tags">
                <label htmlFor="p-tags">Keywords <span className="muted-sm">(optional)</span>{fromPdf.tags && <FromPdf />}<span className="field-count">{currentTags.length}/20</span></label>
                <input id="p-tags" value={form.tags} onChange={(e) => update('tags', e.target.value)} placeholder="Separate keywords with commas" aria-invalid={!!errors.tags} aria-describedby="p-tags-help p-tags-error" />
                {currentTags.length > 0 && (
                  <div className="tag-chips" aria-label="Current keywords">
                    {currentTags.map((tag) => <span key={tag} className="tag tag-current">{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => removeTag(tag)}><X size={11} /></button></span>)}
                  </div>
                )}
                <span className="field-hint" id="p-tags-help">Keywords help readers and reviewers find your paper.</span>
                <span className="field-error" id="p-tags-error">{errors.tags}</span>
                {extraTags.length > 0 && (
                  <div className="tag-suggestions">
                    <span className="muted-sm"><MagicWand size={13} /> {suggestion.sources?.tags === 'generated' ? 'Suggested from the text' : 'Keywords in your PDF'}:</span>
                    {extraTags.map((tag) => <button type="button" key={tag} className="tag tag-add" onClick={() => addTag(tag)}><Plus size={12} /> {tag}</button>)}
                  </div>
                )}
              </div>

              <footer className="wizard-foot">
                <button type="button" className="btn btn-ghost" onClick={() => goTo(0)}><ArrowLeft size={16} /> Back</button>
                <span className="wizard-spacer" />
                <button type="submit" className="btn btn-primary">Continue to authors <ArrowRight size={16} /></button>
              </footer>
            </section>
            {pdfPreview}
          </div>
        )}

        {step === 2 && (
          <section ref={cardRef} className="panel wizard-card" aria-labelledby="step-3-title">
            <header className="wizard-head">
              <span className="step-num">3</span>
              <div><h2 id="step-3-title">Authors and final check</h2><p>Add co-authors from your friends, leave a note for reviewers, then submit.</p></div>
            </header>

            <div className="final-grid">
              <div className="final-main">
                <div data-field="authors">
                  <h3 className="wizard-sub">Authors {fromPdf.authors && <FromPdf />}</h3>
                  <p className="muted-sm">You are the first author. Co-authors are your friends on SNARP (people you follow who follow you back). Each co-author checks and approves the PDF before it goes to peer review, and the paper appears on their profiles once published.</p>
                  <fieldset className={`paper-authors ${fromPdf.authors ? 'suggested' : ''}`}>
                    <legend className="sr-only">Authors and co-authors</legend>
                    <div className="author-grid">
                      {form.authors.map((author, index) => (
                        <div className="author-card" key={author.user_id ?? index}>
                          <div className="author-who">
                            <Avatar name={author.name} src={author.avatar_url} />
                            <div>
                              <strong>{author.name}</strong>
                              <span className="muted-sm">{index === 0 ? 'You · first author' : `Co-author ${index}`}</span>
                            </div>
                            {index > 0 && <button type="button" className="icon-btn author-remove" onClick={() => update('authors', form.authors.filter((_, i) => i !== index))} aria-label={`Remove ${author.name}`}><X size={16} /></button>}
                          </div>
                          <div className="field">
                            <label htmlFor={`p-affiliation-${index}`}>Affiliation <span className="muted-sm">(optional)</span></label>
                            <input id={`p-affiliation-${index}`} value={author.affiliation} maxLength={200} onChange={(e) => setAuthor(index, 'affiliation', e.target.value)} placeholder="University or organisation" />
                          </div>
                        </div>
                      ))}
                      {form.authors.length < 25 && (
                        pickerOpen
                          ? <FriendPicker friends={friends ?? []} excluded={authorIds} onPick={addCoauthor} onClose={() => setPickerOpen(false)} />
                          : (
                            <button type="button" className="author-add" onClick={() => setPickerOpen(true)} disabled={friends === null}>
                              <UserPlus size={20} />
                              <span><strong>Add a co-author</strong><small>{friends === null ? 'Loading your friends…' : `${availableFriends} friend${availableFriends === 1 ? '' : 's'} available`}</small></span>
                            </button>
                          )
                      )}
                    </div>
                    <span className="field-error">{errors.authors}</span>
                    {pdfOthers.length > 0 && (
                      <div className="pdf-suggestion pdf-authors">
                        <MagicWand size={14} />
                        <span>Also named in the PDF: {pdfOthers.map((a, i) => (
                          <span key={a.name}>{i > 0 && ', '}<strong>{a.name}</strong>{friendNames.has(nameKey(a.name)) ? '' : ' (not your friend yet)'}</span>
                        ))}. Only friends can be added as co-authors.</span>
                      </div>
                    )}
                  </fieldset>
                </div>

                <div className={`field ${fromPdf.additionalNotes ? 'suggested' : ''}`} data-field="additionalNotes">
                  <label htmlFor="p-notes"><span className="wizard-sub-inline">Notes for reviewers</span> <span className="muted-sm">(optional)</span>{fromPdf.additionalNotes && <FromPdf />}</label>
                  <textarea id="p-notes" rows={4} maxLength={5000} value={form.additionalNotes} onChange={(e) => update('additionalNotes', e.target.value)} placeholder="Anything reviewers should know: where the code and data are, funding, a preprint or earlier version." aria-invalid={!!errors.additionalNotes} aria-describedby="p-notes-error" />
                  <span className="field-error" id="p-notes-error">{errors.additionalNotes}</span>
                  {suggestion?.notes && !sameText(suggestion.notes, form.additionalNotes) && <PdfSuggestion value={suggestion.notes} onUse={() => applySuggestion('additionalNotes', suggestion.notes)} />}
                </div>
              </div>

              <aside className="review-summary-card" aria-label="Submission summary">
                <h3>Your submission</h3>
                <dl>
                  <div><dt>PDF</dt><dd>{file ? <>{file.name} <small>{formatFileSize(file.size)}</small></> : <span className="missing">Missing</span>}</dd><button type="button" className="link-btn" onClick={() => goTo(0)}>Edit</button></div>
                  <div><dt>Title</dt><dd>{form.title.trim() || <span className="missing">Missing</span>}</dd><button type="button" className="link-btn" onClick={() => showStep(1, 'title')}>Edit</button></div>
                  <div><dt>Abstract</dt><dd>{abstractWords ? `${abstractWords} words` : <span className="missing">Missing</span>}</dd><button type="button" className="link-btn" onClick={() => showStep(1, 'abstract')}>Edit</button></div>
                  <div><dt>Domain</dt><dd>{form.domain.trim() || <span className="missing">Missing</span>}</dd><button type="button" className="link-btn" onClick={() => showStep(1, 'domain')}>Edit</button></div>
                  <div><dt>DOI</dt><dd>{form.doi.trim() || <span className="muted-sm">None</span>}</dd><button type="button" className="link-btn" onClick={() => showStep(1, 'doi')}>Edit</button></div>
                  <div><dt>Keywords</dt><dd>{currentTags.length ? currentTags.slice(0, 5).join(', ') + (currentTags.length > 5 ? ` +${currentTags.length - 5}` : '') : <span className="muted-sm">None</span>}</dd><button type="button" className="link-btn" onClick={() => showStep(1, 'tags')}>Edit</button></div>
                  <div><dt>Authors</dt><dd>{form.authors.map((a) => a.name).join(', ')}</dd></div>
                </dl>
                <p className={`summary-status ${stepComplete.every(Boolean) ? 'ok' : ''}`}>
                  {stepComplete.every(Boolean) ? <><CheckCircle size={16} weight="fill" /> Ready for peer review</> : <><Warning size={16} /> Complete the missing items first</>}
                </p>
              </aside>
            </div>

            <footer className="wizard-foot">
              <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}><ArrowLeft size={16} /> Back</button>
              <span className="wizard-spacer" />
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting…' : <><PaperPlaneRight size={16} /> Submit for review</>}
              </button>
            </footer>
          </section>
        )}
      </form>
    </div>
  )
}

export function MySubmissions() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const withdraw = async (paper) => {
    if (!window.confirm(`Withdraw "${paper.title}"? It is removed from peer review together with its reviews and earlier versions. This cannot be undone.`)) return
    setError(''); setNotice('')
    try {
      await api(`/papers/${paper.id}`, { method: 'DELETE' })
      setPapers((list) => list.filter((p) => p.id !== paper.id))
      setNotice(`"${paper.title}" was withdrawn.`)
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { api('/papers/my-submissions').then(setPapers).catch((err) => setError(err.message)).finally(() => setLoading(false)) }, [])
  return <div className="page papers-page"><PageHeader title="Papers" sub="Papers you submitted or co-authored: follow peer review, read feedback and resubmit revisions." />
    <PapersTabs />
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted-sm">Loading your submissions…</p> : <div className="paper-grid paper-grid-wide">{papers.map((paper) => <article key={paper.id} className="panel article my-paper-card">
      <div className="article-meta"><StatusTag status={paper.status} round={paper.round} />{paper.coauthored && <span className="tag coauthor-tag">Co-author · submitted by {paper.submitter_name}</span>}<time className="muted-sm">{paper.resubmitted_at ? `Round ${paper.round} sent ${new Date(paper.resubmitted_at).toLocaleDateString()}` : `Submitted ${new Date(paper.created_at).toLocaleDateString()}`}</time></div>
      <h3>{paper.title}</h3><p>{paper.abstract.slice(0, 250)}{paper.abstract.length > 250 ? '…' : ''}</p>
      {!paper.coauthored && paper.status === 'approved' && <p className="notice publish-notice"><strong>Ready to publish.</strong> A moderator approved this paper. Open it and press Publish for everyone.</p>}
      {['pending', 'under_review'].includes(paper.status) && <p className="notice"><strong>{paper.status === 'pending' ? 'Waiting for a moderator.' : 'A moderator is verifying it.'}</strong> It stays private until it is approved and published.</p>}
      {paper.status === 'coauthor_check' && <p className="notice"><strong>Waiting for co-authors.</strong> {paper.coauthored ? 'Open it to check the PDF and approve it or request changes.' : 'It goes to peer review and moderator verification when all co-authors approve the PDF.'}</p>}
      {paper.status === 'revision_requested' && <p className="notice"><strong>Changes requested.</strong> {paper.revision_note}{paper.coauthored && ` ${paper.submitter_name} will revise and resubmit.`}</p>}
      {paper.status === 'rejected' && paper.rejection_reason && <p className="alert"><strong>Feedback:</strong> {paper.rejection_reason}</p>}
      <div className="article-actions"><Link className={`btn btn-sm ${(paper.status === 'revision_requested' && !paper.coauthored) || (paper.status === 'coauthor_check' && paper.coauthored) || (paper.status === 'approved' && !paper.coauthored) ? 'btn-primary' : 'btn-secondary'}`} to={`/my-submissions/${paper.id}`}>{paper.status === 'revision_requested' && !paper.coauthored ? 'Read feedback and revise' : paper.status === 'coauthor_check' && paper.coauthored ? 'Check the PDF' : !paper.coauthored && paper.status === 'approved' ? 'Open to publish' : 'Reviews and history'}</Link><PaperPdf paperId={paper.id} label="View submitted PDF" title={paper.title} filename={paper.pdf_filename ?? undefined} />{!paper.coauthored && paper.status !== 'published' && <button type="button" className="btn btn-ghost btn-danger btn-sm withdraw-btn" onClick={() => withdraw(paper)}><Trash size={15} /> Withdraw</button>}</div>
    </article>)}{!papers.length && <div className="panel empty"><h3>No submissions yet</h3><p>Your papers will appear here after submission.</p></div>}</div>}
  </div>
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Desktop },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const SETTINGS_TABS = [
  { key: 'profile', label: 'Profile', hint: 'Photo, name and research details', icon: UserCircle },
  { key: 'appearance', label: 'Appearance', hint: 'Theme and dark mode', icon: Palette },
  { key: 'account', label: 'Account', hint: 'Account type and deletion', icon: IdentificationCard },
  { key: 'security', label: 'Security', hint: 'Password and devices', icon: LockKey },
  { key: 'help', label: 'Help', hint: 'Questions and contact', icon: Question, mobileOnly: true },
]

const ACCOUNT_TYPES = [
  { role: 'user', title: 'Member', icon: BookOpenText, text: 'Read and discuss research: post, comment, follow researchers, join communities and events.' },
  { role: 'author', title: 'Author', icon: PenNib, text: 'Everything a member can do, plus submit papers for publication and peer-review other researchers\' papers.' },
]

function AccountTypeSection({ user, onUserUpdate }) {
  const [choice, setChoice] = useState(user.role)
  const [state, setState] = useState({ saving: false, error: '', done: '' })
  const switchable = ['user', 'author'].includes(user.role)

  const save = async (event) => {
    event.preventDefault()
    if (choice === user.role) return
    if (choice === 'user' && !window.confirm('Switch to a Member account? You will no longer be able to submit new papers or review other papers. Your papers stay published or under review, and you can still revise them.')) return
    setState({ saving: true, error: '', done: '' })
    try {
      const { role } = await api('/auth/me/role', { method: 'PUT', body: { role: choice } })
      onUserUpdate({ ...user, role })
      setState({ saving: false, error: '', done: role === 'author' ? 'You are now an Author. Use Submit paper at the top of the page. Peer review is in the sidebar.' : 'You are now a Member.' })
    } catch (err) {
      setState({ saving: false, error: err.message, done: '' })
    }
  }

  return (
    <form className="panel settings-section" onSubmit={save}>
      <div className="settings-section-head">
        <h2>Account type</h2>
        <p>{switchable ? 'Switch between Member and Author at any time.' : 'Your role is assigned by an administrator.'}</p>
      </div>
      <div className="settings-fields">
        {state.done && <p className="notice" role="status">{state.done}</p>}
        {state.error && <p className="alert" role="alert">{state.error}</p>}
        {switchable ? (
          <>
            <fieldset className="account-types">
              <legend className="sr-only">Account type</legend>
              {ACCOUNT_TYPES.map(({ role, title, icon: Icon, text }) => (
                <label key={role} className={choice === role ? 'active' : ''}>
                  <input type="radio" name="account-type" value={role} checked={choice === role} onChange={() => { setChoice(role); setState({ saving: false, error: '', done: '' }) }} />
                  <span className="account-type-icon"><Icon size={20} /></span>
                  <span className="account-type-text">
                    <strong>{title}{user.role === role && <span className="tag">Current</span>}</strong>
                    <span>{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={state.saving || choice === user.role}>
                {state.saving ? 'Switching…' : choice === user.role ? `You are ${choice === 'author' ? 'an Author' : 'a Member'}` : `Switch to ${choice === 'author' ? 'Author' : 'Member'}`}
              </button>
            </div>
          </>
        ) : (
          <p className="account-type-fixed"><SealCheck size={18} weight="fill" /> <span>You are {user.role === 'admin' ? 'an' : 'a'} <strong>{ROLE_LABEL[user.role]}</strong>.{user.role === 'admin' ? '' : ' Ask an administrator if your role should change.'}</span></p>
        )}
      </div>
    </form>
  )
}

function SessionsSection() {
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => api('/auth/sessions').then(setSessions).catch((err) => setError(err.message))
  useEffect(() => { load() }, [])

  const revoke = async (id) => {
    setBusy(id ?? 'others')
    setError('')
    try {
      await api(id ? `/auth/sessions/${id}` : '/auth/sessions', { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const others = sessions?.filter((session) => !session.current).length ?? 0
  return (
    <section className="panel settings-section">
      <div className="settings-section-head">
        <h2>Where you're logged in</h2>
        <p>Sign out of any device you don't recognise. Sessions end on their own after 7 days, or 1 day without "Keep me logged in".</p>
      </div>
      <div className="settings-fields">
        {error && <p className="alert" role="alert">{error}</p>}
        {!sessions ? <p className="muted">Loading…</p> : (
          <ul className="session-list">
            {sessions.map((session) => {
              const mobile = /Android|iOS/.test(session.device)
              return (
                <li key={session.id}>
                  <span className="session-icon">{mobile ? <DeviceMobile size={18} /> : <Desktop size={18} />}</span>
                  <div className="session-info">
                    <strong>{session.device}{session.current && <span className="session-current">This device</span>}</strong>
                    <span>
                      Signed in {timeAgo(session.created_at)}
                      {!session.current && <> · active {timeAgo(session.last_seen_at)}</>}
                      {!session.remember && <> · ends when the browser closes</>}
                    </span>
                  </div>
                  {!session.current && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => revoke(session.id)}>
                      {busy === session.id ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {others > 0 && (
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => revoke(null)}>
              <SignOut size={16} /> {busy === 'others' ? 'Signing out…' : `Sign out of ${others} other device${others === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export function Settings({ user, onUserUpdate, onAccountDeleted }) {
  const theme = useTheme()
  const [params, setParams] = useSearchParams()
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
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [passwordState, setPasswordState] = useState({ saving: false, error: '', done: false })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteState, setDeleteState] = useState({ saving: false, error: '' })

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

  const changePassword = async (event) => {
    event.preventDefault()
    if (passwords.next !== passwords.confirm) {
      setPasswordState({ saving: false, error: 'New passwords do not match', done: false })
      return
    }
    const weakness = passwordProblem(passwords.next, { email: user.email, name: user.name })
    if (weakness) {
      setPasswordState({ saving: false, error: weakness, done: false })
      return
    }
    setPasswordState({ saving: true, error: '', done: false })
    try {
      await api('/auth/me/password', { method: 'PUT', body: { currentPassword: passwords.current, newPassword: passwords.next } })
      setPasswords({ current: '', next: '', confirm: '' })
      setPasswordState({ saving: false, error: '', done: true })
    } catch (err) {
      setPasswordState({ saving: false, error: err.message, done: false })
    }
  }

  const deleteAccount = async (event) => {
    event.preventDefault()
    setDeleteState({ saving: true, error: '' })
    try {
      await api('/auth/me', { method: 'DELETE', body: { password: deletePassword } })
      onAccountDeleted()
    } catch (err) {
      setDeleteState({ saving: false, error: err.message })
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

  const tab = SETTINGS_TABS.some((item) => item.key === params.get('tab')) ? params.get('tab') : 'profile'
  const current = SETTINGS_TABS.find((item) => item.key === tab)
  const openTab = (key) => setParams(key === 'profile' ? {} : { tab: key }, { replace: true })

  return (
    <div className="page page-wide settings-layout">
      <PageHeader title="Settings" sub="Manage your profile, how SNARP looks, your account and sign-in security." />
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map(({ key, label, hint, icon: Icon, mobileOnly }) => (
            <button key={key} type="button" className={`${tab === key ? 'active' : ''} ${mobileOnly ? 'settings-tab-mobile' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => openTab(key)}>
              <Icon size={18} />
              <span><strong>{label}</strong><small>{hint}</small></span>
            </button>
          ))}
        </nav>
        <div className="settings-panes" aria-label={current.label}>
          <h2 className="settings-pane-title">{current.label}</h2>
          {tab === 'profile' && <>
          {saved && <p className="notice" role="status">Profile updated.</p>}
          {saveError && <p className="alert" role="alert">{saveError}</p>}
          {profile && <form className="panel settings-section" onSubmit={saveProfile}>
            <div className="settings-section-head">
              <h2>Profile</h2>
              <p>Shown on your public profile and next to your posts.</p>
            </div>
            <div className="settings-fields">
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
            <div className="form-row">
              <div className="field">
                <label htmlFor="s-aff">Affiliation</label>
                <input id="s-aff" maxLength={200} value={profile.institution} onChange={(e) => setField('institution', e.target.value)} placeholder="University or organisation" />
              </div>
              <div className="field">
                <label htmlFor="s-department">Department</label>
                <input id="s-department" maxLength={160} value={profile.department} onChange={(e) => setField('department', e.target.value)} placeholder="Department or faculty" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="s-bio">Bio</label>
              <textarea id="s-bio" rows={3} maxLength={2000} value={profile.bio} onChange={(e) => setField('bio', e.target.value)} placeholder="A line about your research interests" />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="s-interests">Research interests</label>
                <input id="s-interests" maxLength={1600} value={Array.isArray(profile.research_interests) ? profile.research_interests.join(', ') : profile.research_interests} onChange={(e) => setField('research_interests', e.target.value)} placeholder="AI, education, biology" />
                <small className="field-hint">Separate with commas</small>
              </div>
              <div className="field">
                <label htmlFor="s-skills">Skills and expertise</label>
                <input id="s-skills" maxLength={1800} value={Array.isArray(profile.skills) ? profile.skills.join(', ') : profile.skills} onChange={(e) => setField('skills', e.target.value)} placeholder="Data analysis, literature review" />
                <small className="field-hint">Separate with commas</small>
              </div>
            </div>
            <div className="field">
              <label>Professional links (HTTPS)</label>
              {profile.links.map((link, index) => <div className="form-row profile-link-row" key={index}>
                <input aria-label={`Link ${index + 1} label`} maxLength={40} value={link.label} onChange={(e) => setField('links', profile.links.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} placeholder="Website, ORCID…" />
                <input aria-label={`Link ${index + 1} URL`} type="url" maxLength={500} value={link.url} onChange={(e) => setField('links', profile.links.map((item, i) => i === index ? { ...item, url: e.target.value } : item))} placeholder="https://example.edu/~you" />
                <button type="button" className="link-danger" onClick={() => setField('links', profile.links.filter((_, i) => i !== index))}>Remove</button>
              </div>)}
              <button type="button" className="btn btn-ghost btn-sm add-link" onClick={() => setField('links', [...profile.links, { label: '', url: '' }])} disabled={profile.links.length >= 5}><Plus size={14} /> Add link</button>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
              <Link className="btn btn-ghost" to={`/users/${user.id}`}>View profile</Link>
            </div>
            </div>
          </form>}
          </>}
          {tab === 'appearance' && <>
          <section className="panel settings-section">
            <div className="settings-section-head">
              <h2>Theme</h2>
              <p>Choose how SNARP looks on this device. System follows your computer's setting.</p>
            </div>
            <div className="settings-fields">
              <div className="theme-options" role="radiogroup" aria-label="Theme">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" role="radio" aria-checked={theme.preference === value}
                    className={`theme-option ${theme.preference === value ? 'active' : ''}`} onClick={() => theme.setPreference(value)}>
                    <span className={`theme-swatch theme-swatch-${value}`} aria-hidden="true"><i /><i /><i /></span>
                    <span><Icon size={16} /> {label}</span>
                  </button>
                ))}
              </div>
              <p className="settings-hint">Showing the {theme.resolved} theme now.</p>
            </div>
          </section>
          <section className="panel settings-section">
            <div className="settings-section-head">
              <h2>Quick switch</h2>
              <p>Flip between light and dark without leaving this page.</p>
            </div>
            <div className="settings-fields">
              <label className="switch-row">
                <span><strong>Dark mode</strong><small>{theme.preference === 'system' ? 'Following your system right now' : 'Set on this device'}</small></span>
                <input type="checkbox" role="switch" className="switch" checked={theme.resolved === 'dark'}
                  onChange={(e) => theme.setPreference(e.target.checked ? 'dark' : 'light')} />
              </label>
            </div>
          </section>

          </>}
          {tab === 'account' && <>
            <AccountTypeSection user={user} onUserUpdate={onUserUpdate} />
          <form className="panel settings-section" onSubmit={deleteAccount}>
            <div className="settings-section-head">
              <h2>Delete account</h2>
              <p>Permanently removes your profile, posts, comments, messages, papers, and the communities and events you organise.</p>
            </div>
            <div className="settings-fields">
              {deleteState.error && <p className="alert" role="alert">{deleteState.error}</p>}
              {deleteOpen ? <>
                <div className="field">
                  <label htmlFor="s-delete-password">Enter your password to confirm</label>
                  <input id="s-delete-password" type="password" autoComplete="current-password" required value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)} />
                </div>
                <div className="form-actions">
                  <button className="btn btn-danger" disabled={deleteState.saving || !deletePassword}>{deleteState.saving ? 'Deleting…' : 'Delete my account'}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setDeleteOpen(false); setDeletePassword(''); setDeleteState({ saving: false, error: '' }) }}>Cancel</button>
                </div>
              </> : (
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(true)}>Delete account…</button>
                </div>
              )}
            </div>
          </form>
          </>}
          {tab === 'help' && <HelpContent />}
          {tab === 'security' && <>
          <form className="panel settings-section" onSubmit={changePassword}>
            <div className="settings-section-head">
              <h2>Password</h2>
              <p>Changing your password signs you out on every other device.</p>
            </div>
            <div className="settings-fields">
              {passwordState.done && <p className="notice" role="status">Password changed.</p>}
              {passwordState.error && <p className="alert" role="alert">{passwordState.error}</p>}
              <div className="field">
                <label htmlFor="s-current-password">Current password</label>
                <input id="s-current-password" type="password" autoComplete="current-password" required value={passwords.current}
                  onChange={(e) => setPasswords((current) => ({ ...current, current: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="s-new-password">New password</label>
                  <input id="s-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={passwords.next}
                    onChange={(e) => setPasswords((current) => ({ ...current, next: e.target.value }))} />
                  <PasswordMeter password={passwords.next} context={{ email: user.email, name: user.name }} />
                </div>
                <div className="field">
                  <label htmlFor="s-confirm-password">Confirm new password</label>
                  <input id="s-confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={passwords.confirm}
                    onChange={(e) => setPasswords((current) => ({ ...current, confirm: e.target.value }))} />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={passwordState.saving}>{passwordState.saving ? 'Changing…' : 'Change password'}</button>
              </div>
            </div>
          </form>
            <SessionsSection />
          </>}
        </div>
      </div>
    </div>
  )
}

function HelpContent() {
  return (
    <>
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
    </>
  )
}

export function Help() {
  return (
    <div className="page">
      <PageHeader title="Help" sub="Answers to common questions about SNARP." />
      <HelpContent />
    </div>
  )
}

export function Search({ user, onLogout }) {
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
      {posts.length > 0 && <><h2 className="section-title">Posts</h2><ul className="post-stack">{posts.map((post) => <PostCard key={post.id} post={post} viewerId={user.id} viewerRole={user.role} onLogout={onLogout}
        onUpdate={(updated) => setPosts((current) => current.map((item) => String(item.id) === String(updated.id) ? { ...item, ...updated } : item))}
        onRemove={(postId) => setPosts((current) => current.filter((item) => String(item.id) !== String(postId)))} />)}</ul></>}
      <QueryTopics query={query} />
      {shownPapers.length > 0 && <><h2 className="section-title">Research papers</h2><div className="stack">{shownPapers.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}</div></>}
      {communities.length > 0 && <><h2 className="section-title">Communities</h2><div className="card-grid">{communities.map((community) => <CommunityCard key={community.id} community={community} onMembership={updateCommunityMembership} />)}</div></>}
      {events.length > 0 && <><h2 className="section-title">Events</h2><div className="stack">{events.map((event) => <EventCard key={event.id} event={event} onRegister={updateEventRegistration} />)}</div></>}
      <p className="muted-sm search-foot"><Link to="/">Back to feed</Link></p>
    </div>
  )
}

export function UserProfile({ user, onLogout }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profileParams] = useSearchParams()
  const pinnedPost = profileParams.get('post')
  const [result, setResult] = useState({ id: null, profile: null, error: '' })
  const [actionError, setActionError] = useState('')
  const [following, setFollowing] = useState({ busy: false })
  const [peopleState, setPeople] = useState({ profileId: null, tab: null, list: [] })
  const [tabState, setTabState] = useState({ profileId: null, tab: null })
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

  const isMe = String(profile.id) === String(user.id)
  const posts = profile.posts.map((post) => ({
    ...post, user_id: profile.id, author_name: profile.name, author_role: profile.role, author_avatar_url: profile.avatar_url,
  }))
  const setPosts = (update) => setResult((current) => ({ ...current, profile: { ...current.profile, posts: update(current.profile.posts) } }))
  const updatePost = (updated) => setPosts((list) => list.map((post) => String(post.id) === String(updated.id) ? { ...post, ...updated } : post))
  const removePost = (postId) => setResult((current) => ({
    ...current,
    profile: { ...current.profile, post_count: current.profile.post_count - 1, posts: current.profile.posts.filter((post) => String(post.id) !== String(postId)) },
  }))
  const toggleFollow = async () => {
    setFollowing({ busy: true })
    setActionError('')
    try {
      const state = await api(`/users/${profile.id}/follow`, { method: 'PUT', body: { following: !profile.followed_by_me } })
      setResult((current) => ({ ...current, profile: { ...current.profile, ...state } }))
    } catch (err) {
      if (err.status === 401) onLogout()
      else setActionError(err.message)
    } finally { setFollowing({ busy: false }) }
  }
  const people = String(peopleState.profileId) === String(profile.id) ? peopleState : { tab: null, list: [] }
  const activeTab = String(tabState.profileId) === String(profile.id) ? tabState.tab : null
  const setActiveTab = (next) => { setTabState({ profileId: profile.id, tab: next }); setPeople({ profileId: null, tab: null, list: [] }) }
  const showPeople = async (tab) => {
    if (people.tab === tab) return setPeople({ profileId: null, tab: null, list: [] })
    try { setPeople({ profileId: profile.id, tab, list: await api(`/users/${profile.id}/${tab}`) }) }
    catch (err) { setActionError(err.message) }
  }
  const message = async () => {
    try {
      const conversation = await api('/messages/conversations', { method: 'POST', body: { userId: profile.id } })
      navigate(`/messages?conversation=${conversation.id}`)
    } catch (err) { setActionError(err.message) }
  }

  const tab = activeTab ?? (profile.papers?.length && !profile.posts.length && !pinnedPost ? 'papers' : 'posts')
  const missing = isMe ? [
    !profile.avatar_url && 'a photo',
    !profile.institution && 'your institution',
    !profile.bio && 'a short bio',
    !profile.research_interests?.length && 'research interests',
  ].filter(Boolean) : []
  const place = [profile.department, profile.institution].filter(Boolean).join(' · ')
  const joined = new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const stat = (label, value, onClick, pressed) => (
    <button type="button" className={`profile-stat ${pressed ? 'active' : ''}`} onClick={onClick} aria-pressed={pressed}>
      <strong>{value ?? 0}</strong><span>{label}</span>
    </button>
  )

  return (
    <div className="page profile-page">
      <section className="panel profile-hero">
        <div className="profile-cover" aria-hidden="true" />
        <div className="profile-hero-body">
          <div className="profile-avatar"><Avatar name={profile.name} size="xl" src={profile.avatar_url} /></div>
          <h1 className="profile-title">{profile.name}</h1>
          <p className="profile-role"><span className={`role-badge role-${profile.role === 'admin' ? 'author' : profile.role}`}>{ROLE_LABEL[profile.role] ?? 'Researcher'}</span></p>
          {place && <p className="profile-place"><Buildings size={16} /> {place}</p>}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          <div className="profile-actions">
            {isMe
              ? <Link className="btn btn-secondary" to="/settings"><PencilSimple size={16} /> Edit profile</Link>
              : <>
                <button className={`btn ${profile.followed_by_me ? 'btn-secondary' : 'btn-primary'}`} onClick={toggleFollow} disabled={following.busy} aria-pressed={profile.followed_by_me}>
                  {profile.followed_by_me ? <><Check size={16} /> Following</> : <><UserPlus size={16} /> Follow</>}
                </button>
                <button className="btn btn-secondary" onClick={message}><ChatCircle size={16} /> Message</button>
              </>}
          </div>
          {actionError && <p className="field-error" role="alert">{actionError}</p>}

          <div className="profile-stats" role="group" aria-label="Profile statistics">
            {stat('Posts', profile.post_count, () => setActiveTab('posts'), tab === 'posts' && !people.tab)}
            {stat('Papers', profile.paper_count, () => setActiveTab('papers'), tab === 'papers' && !people.tab)}
            {stat('Followers', profile.follower_count, () => showPeople('followers'), people.tab === 'followers')}
            {stat('Following', profile.following_count, () => showPeople('following'), people.tab === 'following')}
          </div>

          {(profile.research_interests?.length > 0 || profile.skills?.length > 0 || profile.links?.length > 0) && (
            <div className="profile-about">
              {profile.research_interests?.length > 0 && <div><h2>Research interests</h2><div className="profile-chips">{profile.research_interests.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div>}
              {profile.skills?.length > 0 && <div><h2>Skills</h2><div className="profile-chips">{profile.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div></div>}
              {profile.links?.length > 0 && <div><h2>Links</h2><div className="profile-chips">{profile.links.map((item) => <a key={item.url} className="profile-link" href={item.url} target="_blank" rel="noreferrer"><LinkSimple size={14} /> {item.label}</a>)}</div></div>}
            </div>
          )}
          <p className="profile-joined"><CalendarBlank size={15} /> Joined {joined}</p>
        </div>
      </section>

      {missing.length > 0 && (
        <Link to="/settings" className="panel profile-nudge">
          <PencilSimple size={18} />
          <span><strong>Complete your profile</strong> Add {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]} so other researchers can find and follow you.</span>
          <ArrowRight size={16} />
        </Link>
      )}

      {people.tab && (
        <section className="panel profile-people">
          <header>
            <h2>{people.tab === 'followers' ? `Followers of ${isMe ? 'you' : profile.name.split(' ')[0]}` : `${isMe ? 'You follow' : `${profile.name.split(' ')[0]} follows`}`}</h2>
            <button type="button" className="icon-btn" onClick={() => showPeople(people.tab)} aria-label="Close list"><X size={16} /></button>
          </header>
          {people.list.length === 0
            ? <p className="muted-sm">{people.tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>
            : <div className="people-grid">{people.list.map((person) => (
              <Link key={person.id} to={`/users/${person.id}`} className="person-card">
                <Avatar name={person.name} src={person.avatar_url} />
                <strong>{person.name}</strong>
                <small>{person.institution || ROLE_LABEL[person.role]}</small>
              </Link>
            ))}</div>}
        </section>
      )}

      <div className="profile-tabs" role="tablist" aria-label="Profile content">
        <button role="tab" aria-selected={tab === 'posts'} className={tab === 'posts' ? 'active' : ''} onClick={() => setActiveTab('posts')}>Posts <span>{profile.post_count ?? 0}</span></button>
        <button role="tab" aria-selected={tab === 'papers'} className={tab === 'papers' ? 'active' : ''} onClick={() => setActiveTab('papers')}>Papers <span>{profile.paper_count ?? 0}</span></button>
      </div>

      {tab === 'posts' ? (
        posts.length === 0
          ? <div className="panel profile-empty">
            <span className="profile-empty-icon"><ChatCircle size={24} /></span>
            <h3>{isMe ? 'You have not posted yet' : 'No posts yet'}</h3>
            <p>{isMe ? 'Share an update, a question or something you are reading.' : `${profile.name.split(' ')[0]} has not shared anything yet.`}</p>
            {isMe && <Link to="/" className="btn btn-primary btn-sm">Write your first post</Link>}
          </div>
          : <ul className="post-stack">{posts.map((post) => <PostCard key={post.id} post={post} viewerId={user.id} viewerRole={user.role} onUpdate={updatePost} onRemove={removePost} onLogout={onLogout} />)}</ul>
      ) : (
        profile.papers?.length
          ? <ul className="panel profile-paper-list">
            {profile.papers.map((paper) => <li key={paper.id}>
              <Link to={`/articles/${paper.id}`}>
                <span className="profile-paper-icon"><BookOpenText size={18} /></span>
                <span>
                  <strong>{paper.title}{paper.coauthored && <span className="tag coauthor-tag">Co-author</span>}</strong>
                  <small>{paper.domain} · {new Date(paper.published_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} · {paper.like_count} {paper.like_count === 1 ? 'like' : 'likes'} · {paper.comment_count} {paper.comment_count === 1 ? 'comment' : 'comments'}</small>
                </span>
              </Link>
            </li>)}
          </ul>
          : <div className="panel profile-empty">
            <span className="profile-empty-icon"><BookOpenText size={24} /></span>
            <h3>No published papers yet</h3>
            <p>{isMe ? (user.role === 'author' ? 'Use Submit paper at the top of the page. Papers you publish or co-author appear here after peer review.' : 'Switch to an Author account in Settings to submit papers.') : 'Published and co-authored papers will appear here.'}</p>
          </div>
      )}
    </div>
  )
}

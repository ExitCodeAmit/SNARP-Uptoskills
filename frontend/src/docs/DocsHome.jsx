import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowSquareOut, Check, Eye, FileText, MagnifyingGlass, NotePencil, PencilSimple, Plus, SignOut, Trash, UsersThree, X,
} from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from '../components/ui'
import { Overlay } from '../components/Overlay'
import CardMenu from '../components/CardMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import { timeAgo } from '../format'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'Owned by me' },
  { key: 'shared', label: 'Shared with me' },
]
const ACCESS = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' }

export function DocDetailsDialog({ doc, onClose, onSaved }) {
  const [title, setTitle] = useState(doc?.title ?? '')
  const [description, setDescription] = useState(doc?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const creating = !doc
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = { title: title.trim(), description: description.trim() }
      onSaved(await api(creating ? '/docs' : `/docs/${doc.id}`, { method: creating ? 'POST' : 'PATCH', body }))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Overlay className="docs-dialog" labelledBy="docs-details-title" onClose={() => { if (!busy) onClose() }}>
      <form onSubmit={submit}>
        <header className="docs-dialog-head">
          <h2 id="docs-details-title">{creating ? 'New document' : 'Document details'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="docs-dialog-body">
          <label className="docs-field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder="e.g. Literature review on low-resource NLP" required autoFocus />
          </label>
          <label className="docs-field">
            <span>Description <small>(optional)</small></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={3} placeholder="What is this document for? Collaborators see this." />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <footer className="docs-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : creating ? 'Create document' : 'Save'}</button>
        </footer>
      </form>
    </Overlay>
  )
}

function Invitations({ invitations, onAnswered }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const answer = async (invitation, action) => {
    setBusy(invitation.id + action)
    setError('')
    try {
      await api(`/docs/invitations/${invitation.id}/respond`, { method: 'POST', body: { action } })
      onAnswered(invitation, action)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  return (
    <section className="docs-invites" aria-labelledby="docs-invites-title">
      <h2 id="docs-invites-title">Invitations <span>{invitations.length}</span></h2>
      {error && <p className="field-error" role="alert">{error}</p>}
      <ul>
        {invitations.map((invitation) => (
          <li key={invitation.id}>
            <Avatar name={invitation.inviter_name} src={invitation.inviter_avatar_url} size="sm" />
            <span className="docs-invite-copy">
              <strong>{invitation.document_title}</strong>
              <small>{invitation.inviter_name} invited you to {invitation.permission === 'editor' ? 'edit' : 'view'} · {timeAgo(invitation.created_at)}</small>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => answer(invitation, 'reject')} disabled={!!busy}>{busy === `${invitation.id}reject` ? 'Declining…' : 'Decline'}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => answer(invitation, 'accept')} disabled={!!busy}><Check size={15} weight="bold" /> {busy === `${invitation.id}accept` ? 'Joining…' : 'Accept'}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function DocsHome({ user }) {
  const navigate = useNavigate()
  const [docs, setDocs] = useState(null)
  const [invitations, setInvitations] = useState([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      api(`/docs${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
        .then((list) => { if (active) { setDocs(list); setError('') } })
        .catch((err) => { if (active) { setDocs([]); setError(err.message) } })
    }, query ? 250 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, reload])

  useEffect(() => {
    let active = true
    const load = () => api('/docs/invitations').then((list) => { if (active) setInvitations(list) }).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const answered = (invitation, action) => {
    setInvitations((list) => list.filter((item) => item.id !== invitation.id))
    if (action === 'accept') navigate(`/docs/${invitation.document_id}`)
  }

  const remove = async () => {
    const doc = removing
    if (doc.permission === 'owner') await api(`/docs/${doc.id}`, { method: 'DELETE' })
    else await api(`/docs/${doc.id}/members/${user.id}`, { method: 'DELETE' })
    setDocs((list) => list.filter((item) => item.id !== doc.id))
    setRemoving(null)
  }

  const shown = (docs ?? []).filter((doc) => filter === 'all' || (filter === 'owned' ? doc.permission === 'owner' : doc.permission !== 'owner'))
  return (
    <div className="page docs-home">
      <header className="docs-home-head">
        <div>
          <h1>Docs</h1>
          <p>Write research documents together, in real time. Everyone sees each other's cursors and changes save automatically.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} weight="bold" /> New document</button>
      </header>

      {invitations.length > 0 && <Invitations invitations={invitations} onAnswered={answered} />}

      <div className="docs-toolbar-line">
        <div className="docs-filter" role="tablist" aria-label="Show documents">
          {FILTERS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>
          ))}
        </div>
        <label className="docs-search">
          <MagnifyingGlass size={17} />
          <span className="sr-only">Search documents</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and descriptions" maxLength={120} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
        </label>
      </div>

      {error && <p className="alert" role="alert">{error}</p>}

      {docs === null ? (
        <div className="docs-grid" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="docs-card skeleton" style={{ height: 168 }} />)}</div>
      ) : shown.length === 0 ? (
        <div className="panel empty docs-empty">
          <span className="docs-empty-icon"><FileText size={30} weight="duotone" /></span>
          <h3>{query ? 'No documents match your search' : filter === 'shared' ? 'Nothing shared with you yet' : 'Start your first research document'}</h3>
          <p>{query ? 'Try other words or clear the search.' : filter === 'shared' ? 'When someone invites you and you accept, the document appears here.' : 'Draft a paper, a literature review or lab notes, then invite collaborators to write with you.'}</p>
          {!query && filter !== 'shared' && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} weight="bold" /> New document</button>}
        </div>
      ) : (
        <div className="docs-grid">
          {shown.map((doc) => (
            <article key={doc.id} className="docs-card">
              <div className="docs-card-top">
                <span className="docs-card-icon" aria-hidden="true"><FileText size={22} weight="duotone" /></span>
                <span className={`docs-badge docs-badge-${doc.permission}`}>
                  {doc.permission === 'editor' ? <PencilSimple size={12} weight="bold" /> : doc.permission === 'viewer' ? <Eye size={12} weight="bold" /> : null}
                  {ACCESS[doc.permission]}
                </span>
                <CardMenu label={`Options for ${doc.title}`} items={[
                  { label: 'Open', icon: ArrowSquareOut, to: `/docs/${doc.id}` },
                  ...(doc.permission === 'owner' ? [
                    { label: 'Rename / describe', icon: NotePencil, onClick: () => setEditing(doc) },
                    { label: 'Delete', icon: Trash, danger: true, onClick: () => setRemoving(doc) },
                  ] : [{ label: 'Leave document', icon: SignOut, danger: true, onClick: () => setRemoving(doc) }]),
                ]} />
              </div>
              <h2><Link to={`/docs/${doc.id}`} className="docs-card-link">{doc.title}</Link></h2>
              <p className="docs-card-desc">{doc.description || 'No description'}</p>
              <p className="docs-card-meta">
                <span>{doc.permission === 'owner'
                  ? <><UsersThree size={14} /> {doc.member_count ? `${doc.member_count} collaborator${doc.member_count === 1 ? '' : 's'}` : 'Only you'}</>
                  : <>Shared by {doc.owner_name}</>}</span>
                <time dateTime={doc.updated_at}>Edited {timeAgo(doc.updated_at)}</time>
              </p>
            </article>
          ))}
        </div>
      )}

      {creating && <DocDetailsDialog onClose={() => setCreating(false)} onSaved={(doc) => navigate(`/docs/${doc.id}`)} />}
      {editing && <DocDetailsDialog doc={editing} onClose={() => setEditing(null)} onSaved={(doc) => { setEditing(null); setDocs((list) => list.map((item) => (item.id === doc.id ? { ...item, ...doc } : item))); setReload((n) => n + 1) }} />}
      {removing && (
        <ConfirmDialog
          title={removing.permission === 'owner' ? 'Delete this document?' : 'Leave this document?'}
          message={removing.permission === 'owner'
            ? `"${removing.title}" and everything written in it will be permanently deleted for everyone.`
            : `You will lose access to "${removing.title}". The owner can invite you again.`}
          confirmText={removing.permission === 'owner' ? 'Delete document' : 'Leave'}
          onCancel={() => setRemoving(null)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowUUpLeft, ArrowsClockwise, Article, CheckCircle, ClipboardText, ClockCounterClockwise, Flag, Lock, LockOpen,
  MagnifyingGlass, NotePencil, Play, ShieldCheck, SquaresFour, UserMinus, UserPlus, Users, XCircle,
} from '@phosphor-icons/react'
import { api, isAdminArea } from '../api'
import { Avatar, PageHeader } from '../components/ui'
import PdfAttachment from '../components/PdfAttachment'
import { ExpandableText } from '../components/RichText'
import { ROLE_LABEL as SITE_ROLE_LABEL, timeAgo } from '../format'
import { StatusTag } from './review'

const PAGE_SIZE = 20
const ROLE_LABEL = { ...SITE_ROLE_LABEL, admin: isAdminArea() ? 'Super Admin' : SITE_ROLE_LABEL.admin, system: 'System' }

function SiteLink({ to, children, ...props }) {
  if (isAdminArea()) return <a href={to} target="_blank" rel="noreferrer" {...props}>{children}</a>
  return <Link to={to} {...props}>{children}</Link>
}
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')
const query = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null))
  return search.toString() ? `?${search}` : ''
}
const STATUS_FILTERS = [
  ['all', 'All'], ['pending', 'Pending'], ['under_review', 'Under review'], ['approved', 'Approved'],
  ['published', 'Published'], ['rejected', 'Rejected'], ['revision_requested', 'Changes requested'], ['coauthor_check', 'Co-author check'],
]
const DECISION_LABEL = {
  approved: 'Approved', rejected: 'Rejected', revision_requested: 'Changes requested', resubmitted: 'Revised and resubmitted',
  coauthor_update: 'Corrected PDF sent to co-authors', coauthors_approved: 'All co-authors approved', under_review: 'Verification started',
  released: 'Returned to the queue', published: 'Published', status_changed: 'Status changed by an administrator',
}
const ACTION_LABEL = {
  'paper.approved': 'Approved paper', 'paper.rejected': 'Rejected paper', 'paper.published': 'Published paper',
  'paper.published_by_author': 'Published paper', 'paper.revision_requested': 'Requested changes', 'paper.review_started': 'Started paper review',
  'paper.review_released': 'Returned paper to queue', 'paper.status_changed': 'Changed paper status', 'paper.note_added': 'Added review note',
  'paper.withdrawn': 'Withdrew paper', 'paper.resubmitted': 'Resubmitted paper', 'user.blocked': 'Blocked user', 'user.unblocked': 'Unblocked user',
  'user.role_changed': 'Changed role', 'moderator.added': 'Added moderator', 'moderator.removed': 'Removed moderator',
  'moderator.suspended': 'Suspended moderator', 'moderator.reactivated': 'Reactivated moderator', 'account.role_change': 'Switched account type',
  'account.delete': 'Deleted account', 'account.password_reset': 'Reset password', 'report.reviewed': 'Resolved report', 'report.dismissed': 'Dismissed report',
  'post.remove': 'Removed post', 'comment.remove': 'Removed comment',
}
const AUDIT_FILTERS = [['', 'All actions'], ['paper.', 'Papers'], ['user.', 'Users'], ['moderator.', 'Moderators'], ['account.', 'Accounts'], ['report.', 'Reports'], ['post.', 'Posts']]

function useApi(path) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState({ path: null, nonce: -1, data: null, error: '' })
  useEffect(() => {
    if (!path) return undefined
    let active = true
    api(path)
      .then((data) => { if (active) setState({ path, nonce, data, error: '' }) })
      .catch((err) => { if (active) setState({ path, nonce, data: null, error: err.message }) })
    return () => { active = false }
  }, [path, nonce])
  const same = state.path === path
  return {
    data: same ? state.data : null,
    error: same ? state.error : '',
    loading: !same || state.nonce !== nonce,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  }
}

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function useToasts() {
  const [toasts, setToasts] = useState([])
  const push = useCallback((text, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500)
  }, [])
  const view = (
    <div className="console-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className={`console-toast ${t.tone}`}>
          {t.tone === 'success' ? <CheckCircle size={16} weight="fill" /> : <XCircle size={16} weight="fill" />} {t.text}
        </p>
      ))}
    </div>
  )
  return [push, view]
}

function ConfirmDialog({ title, body, confirmLabel, tone = 'primary', reason, run, onClose }) {
  const ref = useRef(null)
  const fieldId = useId()
  const [text, setText] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    const value = text.trim()
    if (reason && value.length < (reason.min ?? 0)) {
      setState({ busy: false, error: `${reason.label} must be at least ${reason.min} characters.` })
      return
    }
    setState({ busy: true, error: '' })
    try {
      await run(value)
      onClose()
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }
  return (
    <dialog ref={ref} className="console-dialog" aria-labelledby={`${fieldId}-title`} onCancel={(e) => { e.preventDefault(); if (!state.busy) onClose() }}>
      <form onSubmit={submit}>
        <h2 id={`${fieldId}-title`}>{title}</h2>
        {body && <p className="muted-sm">{body}</p>}
        {reason && (
          <div className="field">
            <label htmlFor={fieldId}>{reason.label}{reason.min ? '' : ' (optional)'}</label>
            <textarea id={fieldId} rows={4} value={text} maxLength={reason.max ?? 2000} onChange={(e) => setText(e.target.value)}
              placeholder={reason.placeholder} aria-invalid={!!state.error} autoFocus />
          </div>
        )}
        {state.error && <p className="alert" role="alert">{state.error}</p>}
        <div className="console-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={state.busy}>Cancel</button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={state.busy}>{state.busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  )
}

function useConfirm() {
  const [dialog, setDialog] = useState(null)
  const ask = useCallback((options) => setDialog({ ...options, key: Date.now() }), [])
  const view = dialog && <ConfirmDialog key={dialog.key} {...dialog} onClose={() => setDialog(null)} />
  return [ask, view]
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

function ConsoleNav({ label, items, active, onSelect }) {
  return (
    <nav className="console-nav" aria-label={label}>
      {items.map(({ id, label: text, icon: Icon, badge }, index) => (
        <button key={id} type="button" className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>
          <span className="desk-num" aria-hidden="true">{NUMERALS[index]}</span>
          <Icon size={17} aria-hidden="true" />
          <span className="desk-label">{text}</span>
          {badge > 0 && <span className="desk-count" aria-label={`${badge} waiting`}>{badge}</span>}
        </button>
      ))}
    </nav>
  )
}

function StatCard({ label, value, tone = '', hint }) {
  return (
    <div className={`panel console-stat ${Number(value) > 0 ? tone : ""}`}>
      <span>{label}</span>
      <strong>{value ?? '-'}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

function Pager({ page, total, limit = PAGE_SIZE, onPage }) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / limit))
  if (pages <= 1) return null
  return (
    <div className="console-pager">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</button>
      <span className="muted-sm">Page {page} of {pages} · {total} total</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next</button>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder, label }) {
  return (
    <label className="console-search">
      <MagnifyingGlass size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function Loading({ text = 'Loading…' }) {
  return <div className="panel console-empty" aria-busy="true"><p className="muted-sm">{text}</p></div>
}

function Empty({ title, text }) {
  return <div className="panel console-empty"><h3>{title}</h3>{text && <p>{text}</p>}</div>
}

function AccountStatus({ user }) {
  if (user.blocked_at) return <span className="tag tag-danger">{user.role === 'moderator' ? 'Suspended' : 'Blocked'}</span>
  if (user.email_verified === false || user.email_verified_at === null) return <span className="tag tag-pending">Unverified</span>
  return <span className="tag tag-success">Active</span>
}

function RoleTag({ role }) {
  return <span className={`tag console-role ${role}`}>{ROLE_LABEL[role] ?? role}</span>
}

function PaperList({ admin, view, onView, filters, onOpen }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const search = useDebounced(q.trim())
  const path = `${admin ? '/admin/papers' : '/moderation/papers'}${query({ status: view, q: search, page, limit: PAGE_SIZE })}`
  const { data, error, loading } = useApi(path)
  const select = (next) => { setPage(1); onView(next) }
  return (
    <section aria-label="Papers">
      <div className="console-toolbar">
        {filters && (
          <div className="console-chips" role="group" aria-label="Filter by status">
            {filters.map(([id, label]) => (
              <button key={id} type="button" className={`chip ${view === id ? 'active' : ''}`} aria-pressed={view === id} onClick={() => select(id)}>{label}</button>
            ))}
          </div>
        )}
        <SearchBox value={q} onChange={(value) => { setQ(value); setPage(1) }} placeholder="Search title, author, domain or tag" label="Search papers" />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && !data ? <Loading text="Loading papers…" /> : data?.papers.length ? (
        <>
          <div className="console-table-wrap">
            <table className="console-table">
              <thead>
                <tr><th scope="col">Paper</th><th scope="col">Status</th><th scope="col">Submitted by</th><th scope="col">Moderator</th><th scope="col">Submitted</th><th scope="col"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody>
                {data.papers.map((paper) => (
                  <tr key={paper.id}>
                    <td data-label="Paper">
                      <button type="button" className="console-link" onClick={() => onOpen(paper.id)}>{paper.title}</button>
                      <small>{paper.domain}{paper.round > 1 ? ` · round ${paper.round}` : ''}{paper.review_count ? ` · ${paper.review_count} peer review${paper.review_count === 1 ? '' : 's'}` : ''}</small>
                    </td>
                    <td data-label="Status"><StatusTag status={paper.status} round={paper.round} /></td>
                    <td data-label="Submitted by">{paper.submitter_name}</td>
                    <td data-label="Moderator">{paper.reviewer_name ?? paper.assignee_name ?? <span className="muted-sm">-</span>}</td>
                    <td data-label="Submitted">{formatDate(paper.resubmitted_at ?? paper.created_at)}</td>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(paper.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      ) : <Empty title="No papers here" text={search ? 'Try a different search.' : 'Papers that match this view will appear here.'} />}
    </section>
  )
}

function PaperReview({ id, admin, onBack, notify }) {
  const { data: paper, error, loading, reload } = useApi(`/moderation/papers/${id}`)
  const [ask, dialog] = useConfirm()
  const [note, setNote] = useState('')
  const [noteState, setNoteState] = useState({ saving: false, error: '' })
  const [override, setOverride] = useState('')

  if (error) return <div><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back to papers</button><p className="alert" role="alert">{error}</p></div>
  if (loading && !paper) return <Loading text="Loading paper…" />

  const act = (path, body, message) => async () => {
    await api(`/moderation/papers/${paper.id}/${path}`, { method: 'PATCH', body })
    notify(message)
    reload()
  }
  const decide = (action) => {
    if (action === 'start-review') return act('start-review', {}, 'You are now reviewing this paper.')().catch((err) => notify(err.message, 'error'))
    if (action === 'release') {
      return ask({ title: 'Return to queue?', body: 'Another moderator will be able to pick this paper up.', confirmLabel: 'Return to queue', run: act('release', {}, 'Paper returned to the queue.') })
    }
    if (action === 'approve') {
      return ask({
        title: 'Approve this paper?', body: 'The main author is notified and can publish it. It stays private until it is published.',
        confirmLabel: 'Approve', reason: { label: 'Message to the author', min: 0, max: 2000, placeholder: 'What did you verify?' },
        run: (text) => act('approve', { comment: text }, 'Paper approved. The author has been notified.')(),
      })
    }
    if (action === 'request-revision') {
      return ask({
        title: 'Request changes', body: 'The author can revise and resubmit the paper.', confirmLabel: 'Send request',
        reason: { label: 'Requested changes', min: 10, max: 5000, placeholder: 'List what must change before it can be approved.' },
        run: (text) => act('request-revision', { note: text }, 'Changes requested. The author has been notified.')(),
      })
    }
    return ask({
      title: 'Reject this paper?', body: 'Rejected papers cannot be resubmitted or published. The author sees your reason.', confirmLabel: 'Reject paper', tone: 'danger',
      reason: { label: 'Rejection reason', min: 5, max: 2000, placeholder: 'Explain why the paper is rejected.' },
      run: (text) => act('reject', { reason: text }, 'Paper rejected. The author has been notified.')(),
    })
  }
  const changeStatus = () => ask({
    title: `Change status to ${STATUS_FILTERS.find(([value]) => value === override)?.[1].toLowerCase()}?`,
    body: 'This overrides the normal workflow. The authors are notified and the change is written to the audit log.', confirmLabel: 'Change status', tone: 'danger',
    reason: { label: 'Reason', min: 5, max: 2000, placeholder: 'Why is this change needed?' },
    run: async (text) => {
      await api(`/admin/papers/${paper.id}/status`, { method: 'PATCH', body: { status: override, reason: text } })
      notify('Paper status changed.')
      setOverride('')
      reload()
    },
  })
  const addNote = async (e) => {
    e.preventDefault()
    if (!note.trim()) return
    setNoteState({ saving: true, error: '' })
    try {
      await api(`/moderation/papers/${paper.id}/notes`, { method: 'POST', body: { body: note } })
      setNote('')
      setNoteState({ saving: false, error: '' })
      reload()
    } catch (err) {
      setNoteState({ saving: false, error: err.message })
    }
  }
  const { actions } = paper
  const summary = paper.peer_summary
  return (
    <div className="console-paper">
      <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back to papers</button>
      <div className="console-paper-head">
        <div>
          <div className="console-paper-meta"><StatusTag status={paper.status} round={paper.round} /><span className="muted-sm">{paper.domain} · submitted {formatDate(paper.created_at)}{paper.resubmitted_at ? ` · revised ${formatDate(paper.resubmitted_at)}` : ''}</span></div>
          <h2>{paper.title}</h2>
          <p className="muted-sm">By {paper.authors.map((a) => a.name).join(', ')}{admin && paper.submitter_email ? ` · ${paper.submitter_email}` : ''}</p>
        </div>
        {paper.status === 'published' && <SiteLink className="btn btn-ghost btn-sm" to={`/articles/${paper.id}`}>View public page</SiteLink>}
      </div>
      {paper.is_own && <p className="notice">You wrote or co-authored this paper, so you cannot moderate it.</p>}
      <div className="console-paper-grid">
        <div className="console-paper-main">
          <section className="panel review-section">
            <h3>Abstract</h3>
            <ExpandableText text={paper.abstract} lines={8} className="review-abstract" />
            {paper.tags?.length > 0 && <div className="tag-row">{paper.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
            {paper.doi && <p className="muted-sm">DOI: {paper.doi}</p>}
            {paper.additional_notes && <><h3>Notes from the author</h3><p className="pre">{paper.additional_notes}</p></>}
            <h3>Document</h3>
            <PdfAttachment paperId={paper.id} filename={paper.pdf_filename} size={paper.pdf_size} title={paper.title} />
          </section>
          <section className="panel review-section">
            <h3>Peer reviews (round {paper.round})</h3>
            {summary.count ? (
              <>
                <p className="muted-sm">{summary.count} review{summary.count === 1 ? '' : 's'} · average {summary.overall ?? '-'} / 5 · {summary.recommendations.accept} accept, {summary.recommendations.minor_revision + summary.recommendations.major_revision} revision, {summary.recommendations.reject} reject</p>
                <ul className="console-reviews">
                  {paper.peer_reviews.map((review) => (
                    <li key={review.id}>
                      <strong>{review.reviewer_name ?? 'Reviewer'} · {review.overall_rating}/5 · {review.recommendation.replace('_', ' ')}</strong>
                      <ExpandableText text={review.comments} lines={4} />
                      {review.confidential_comments && <p className="muted-sm"><Lock size={12} /> Confidential: {review.confidential_comments}</p>}
                    </li>
                  ))}
                </ul>
                <SiteLink className="muted-sm" to={`/reviews/${paper.id}`}>Open the full peer review workspace</SiteLink>
              </>
            ) : <p className="muted-sm">No peer reviews for this round yet.</p>}
          </section>
          <section className="panel review-section">
            <h3>Review history</h3>
            {paper.history.length ? (
              <ol className="console-timeline">
                {paper.history.map((entry) => (
                  <li key={entry.id} className={entry.decision}>
                    <strong>{DECISION_LABEL[entry.decision] ?? entry.decision}</strong>
                    <span className="muted-sm">{entry.actor_name ? `${entry.actor_name}${entry.actor_role ? ` (${ROLE_LABEL[entry.actor_role] ?? entry.actor_role})` : ''} · ` : ''}{formatDateTime(entry.created_at)} · round {entry.round}</span>
                    {entry.comment && <p>{entry.comment}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="muted-sm">No decisions yet.</p>}
          </section>
        </div>
        <aside className="console-paper-side">
          <section className="panel review-section">
            <h3>Verification</h3>
            <dl className="console-facts">
              <div><dt>Status</dt><dd><StatusTag status={paper.status} round={paper.round} /></dd></div>
              <div><dt>Assigned to</dt><dd>{paper.assignee_name ?? '-'}</dd></div>
              <div><dt>Review started</dt><dd>{formatDateTime(paper.review_started_at)}</dd></div>
              <div><dt>Decided by</dt><dd>{paper.reviewer_name ?? '-'}</dd></div>
              <div><dt>Decided</dt><dd>{formatDateTime(paper.reviewed_at)}</dd></div>
              {paper.published_at && <div><dt>Published</dt><dd>{formatDateTime(paper.published_at)}{paper.publisher_name ? ` by ${paper.publisher_name}` : ''}</dd></div>}
            </dl>
            {paper.rejection_reason && paper.status === 'rejected' && <blockquote>{paper.rejection_reason}</blockquote>}
            {paper.revision_note && paper.status === 'revision_requested' && <blockquote>{paper.revision_note}</blockquote>}
            <div className="console-actions">
              {actions.start_review && <button type="button" className="btn btn-primary" onClick={() => decide('start-review')}><Play size={16} /> Start review</button>}
              {actions.approve && <button type="button" className={`btn ${actions.start_review ? 'btn-secondary' : 'btn-primary'}`} onClick={() => decide('approve')}><CheckCircle size={16} /> Approve</button>}
              {actions.request_revision && <button type="button" className="btn btn-secondary" onClick={() => decide('request-revision')}><ArrowsClockwise size={16} /> Request changes</button>}
              {actions.reject && <button type="button" className="btn btn-ghost btn-danger" onClick={() => decide('reject')}><XCircle size={16} /> Reject</button>}
              {actions.release && <button type="button" className="btn btn-ghost" onClick={() => decide('release')}><ArrowUUpLeft size={16} /> Return to queue</button>}
              {!actions.approve && !actions.start_review && !actions.reject && <p className="muted-sm">No moderator action is open for this status.</p>}
            </div>
          </section>
          {admin && (
            <section className="panel review-section">
              <h3>Change status</h3>
              <p className="muted-sm">Super Admin only. Use when the normal workflow cannot be followed.</p>
              <div className="field">
                <label htmlFor="override-status">New status</label>
                <select id="override-status" value={override} onChange={(e) => setOverride(e.target.value)}>
                  <option value="">Choose a status</option>
                  {STATUS_FILTERS.filter(([value]) => !['all', 'coauthor_check', paper.status].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!override} onClick={changeStatus}>Change status</button>
            </section>
          )}
          <section className="panel review-section">
            <h3><NotePencil size={16} /> Internal notes</h3>
            <p className="muted-sm">Visible to moderators and the Super Admin only. Authors never see these.</p>
            {paper.notes.length ? (
              <ul className="console-notes">
                {paper.notes.map((n) => <li key={n.id}><p>{n.body}</p><small>{n.author_name ?? 'Former user'} · {timeAgo(n.created_at)}</small></li>)}
              </ul>
            ) : <p className="muted-sm">No notes yet.</p>}
            {actions.note && (
              <form onSubmit={addNote} className="console-note-form">
                <div className="field">
                  <label htmlFor="new-note">Add a note</label>
                  <textarea id="new-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check?" />
                </div>
                {noteState.error && <p className="field-error" role="alert">{noteState.error}</p>}
                <button type="submit" className="btn btn-secondary btn-sm" disabled={noteState.saving || !note.trim()}>{noteState.saving ? 'Saving…' : 'Save note'}</button>
              </form>
            )}
          </section>
        </aside>
      </div>
      {dialog}
    </div>
  )
}

function ActivityList({ items }) {
  if (!items?.length) return <p className="muted-sm">No review activity yet.</p>
  return (
    <ul className="console-activity">
      {items.map((item) => (
        <li key={item.id}>
          <span className={`console-dot ${item.decision}`} aria-hidden="true" />
          <div>
            <strong>{DECISION_LABEL[item.decision] ?? item.decision}</strong> <span className="muted-sm">· {formatDateTime(item.created_at)}</span>
            <p>{item.title} <StatusTag status={item.status} /></p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function ModeratorStats({ stats }) {
  return (
    <div className="console-stats">
      <StatCard label="Approved" value={stats.approved} tone="ok" />
      <StatCard label="Rejected" value={stats.rejected} tone="bad" />
      <StatCard label="Changes requested" value={stats.revision_requested} tone="warn" />
      <StatCard label="In progress" value={stats.in_progress} />
      <StatCard label="Decisions, last 30 days" value={stats.decisions_30d} />
    </div>
  )
}

function Shell({ title, kicker, sub, nav, children, toasts }) {
  const [today] = useState(() => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  return (
    <div className="page page-wide console">
      <header className="desk-head">
        <p className="desk-kicker">{!isAdminArea() && <span>SNARP</span>}<span>{kicker}</span><span>{today}</span></p>
        <h1>{title}</h1>
        <p className="desk-sub">{sub}</p>
      </header>
      <div className="console-layout">
        {nav}
        <div className="console-main">{children}</div>
      </div>
      {toasts}
    </div>
  )
}

export function AccessDenied({ title, text }) {
  return (
    <div className="page">
      <PageHeader title={title} />
      <div className="panel empty"><Lock size={28} weight="duotone" /><h3>Access restricted</h3><p>{text}</p><Link to="/" className="btn btn-secondary btn-sm">Back to the feed</Link></div>
    </div>
  )
}

export function ModeratorDashboard() {
  const [params, setParams] = useSearchParams()
  const tab = ['queue', 'mine', 'reviewed', 'activity'].includes(params.get('tab')) ? params.get('tab') : 'queue'
  const paperId = /^\d+$/.test(params.get('paper') ?? '') ? params.get('paper') : null
  const [notify, toasts] = useToasts()
  const summary = useApi(`/moderation/summary${query({ v: paperId ? 'detail' : tab })}`)
  const activity = useApi(tab === 'activity' ? '/moderation/activity' : null)
  const go = (next) => setParams(query({ tab: next }).slice(1))
  const open = (id) => setParams(query({ tab, paper: id }).slice(1))
  const s = summary.data
  const views = { queue: 'queue', mine: 'mine', reviewed: 'reviewed_by_me' }
  return (
    <Shell
      title="Moderator dashboard" kicker="Reading room" sub="Read each submission, check its claims, and decide whether it is ready for the public shelf." toasts={toasts}
      nav={<ConsoleNav label="Moderator sections" active={paperId ? 'queue' : tab} onSelect={go} items={[
        { id: 'queue', label: 'Review queue', icon: ClipboardText, badge: s?.pending },
        { id: 'mine', label: 'My reviews', icon: Play, badge: s?.mine },
        { id: 'reviewed', label: 'Reviewed by me', icon: CheckCircle },
        { id: 'activity', label: 'My activity', icon: ClockCounterClockwise },
      ]} />}
    >
      {paperId ? <PaperReview id={paperId} admin={false} onBack={() => go(tab)} notify={notify} /> : (
        <>
          <div className="console-stats">
            <StatCard label="Waiting for a moderator" value={s?.pending} tone="warn" />
            <StatCard label="Under review" value={s?.under_review} />
            <StatCard label="Assigned to you" value={s?.mine} />
            <StatCard label="Approved, not yet published" value={s?.approved} tone="ok" />
            <StatCard label="Your decisions" value={s?.my_decisions} />
          </div>
          {tab === 'activity' ? (
            activity.loading && !activity.data ? <Loading /> : activity.error ? <p className="alert" role="alert">{activity.error}</p> : (
              <>
                <ModeratorStats stats={activity.data} />
                <section className="panel review-section"><h3>Recent decisions</h3><ActivityList items={activity.data.recent} /></section>
              </>
            )
          ) : <PaperList key={tab} admin={false} view={views[tab]} onView={() => {}} onOpen={open} />}
        </>
      )}
    </Shell>
  )
}

function Bars({ data, field, label }) {
  const max = Math.max(1, ...data.map((d) => d[field]))
  return (
    <figure className="console-bars">
      <figcaption>{label}</figcaption>
      <div className="console-bars-plot">
        {data.map((d) => (
          <div key={d.day} className="console-bar" title={`${formatDate(d.day)}: ${d[field]}`}>
            <i style={{ height: `${(d[field] / max) * 100}%` }} />
            <span>{new Date(d.day).getDate()}</span>
          </div>
        ))}
      </div>
      <p className="sr-only">{data.map((d) => `${formatDate(d.day)}: ${d[field]}`).join(', ')}</p>
    </figure>
  )
}

function Overview({ onOpen }) {
  const { data, error, loading } = useApi('/admin/overview')
  if (error) return <p className="alert" role="alert">{error}</p>
  if (loading && !data) return <Loading text="Loading statistics…" />
  const statuses = [
    ['pending', 'Pending', data.papers_pending], ['under_review', 'Under review', data.papers_under_review],
    ['approved', 'Approved', data.papers_approved], ['published', 'Published', data.papers_published],
    ['rejected', 'Rejected', data.papers_rejected], ['revision_requested', 'Changes requested', data.papers_revision_requested],
    ['coauthor_check', 'Co-author check', data.papers_coauthor_check],
  ]
  return (
    <>
      <h2 className="console-h2"><span>01</span> People</h2>
      <div className="console-stats">
        <StatCard label="Registered users" value={data.users_total} />
        <StatCard label="Active users" value={data.users_active} tone="ok" hint="Signed in within 30 days" />
        <StatCard label="Blocked users" value={data.users_blocked} tone="bad" />
        <StatCard label="Moderators" value={data.moderators_total} hint={data.moderators_suspended ? `${data.moderators_suspended} suspended` : undefined} />
        <StatCard label="Unverified" value={data.users_unverified} tone="warn" />
      </div>
      <h2 className="console-h2"><span>02</span> Research papers</h2>
      <div className="console-stats">
        <StatCard label="Total papers" value={data.papers_total} />
        <StatCard label="Pending" value={data.papers_pending} tone="warn" />
        <StatCard label="Under review" value={data.papers_under_review} />
        <StatCard label="Approved" value={data.papers_approved} />
        <StatCard label="Rejected" value={data.papers_rejected} tone="bad" />
        <StatCard label="Published" value={data.papers_published} tone="ok" />
      </div>
      <div className="console-split">
        <section className="panel review-section">
          <h3><span className="desk-mark">03</span> Papers by status</h3>
          <div className="console-stack-bar" role="img" aria-label={statuses.map(([, l, n]) => `${l} ${n}`).join(', ')}>
            {statuses.filter(([, , n]) => n > 0).map(([key, l, n]) => <i key={key} className={key} style={{ flexGrow: n }} title={`${l}: ${n}`} />)}
          </div>
          <ul className="console-legend">
            {statuses.map(([key, l, n]) => <li key={key}><i className={key} aria-hidden="true" />{l} <strong>{n}</strong></li>)}
          </ul>
        </section>
        <section className="panel review-section">
          <h3><span className="desk-mark">04</span> Last 14 days</h3>
          <div className="console-bar-pair">
            <Bars data={data.daily} field="submitted" label="Papers submitted" />
            <Bars data={data.daily} field="signups" label="New accounts" />
          </div>
        </section>
      </div>
      <section className="panel review-section">
        <div className="console-section-head"><h3><span className="desk-mark">05</span> Recent activity</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen('audit')}>Full audit log</button></div>
        <AuditRows items={data.recent} compact />
      </section>
      {data.reports_pending > 0 && <p className="notice"><Flag size={15} /> {data.reports_pending} reported post{data.reports_pending === 1 ? '' : 's'} waiting. <button type="button" className="console-link inline" onClick={() => onOpen('reports')}>Review reports</button></p>}
    </>
  )
}

function AuditRows({ items, compact = false }) {
  if (!items?.length) return <p className="muted-sm">Nothing recorded yet.</p>
  return (
    <div className="console-table-wrap">
      <table className="console-table">
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th>{!compact && <th scope="col">Details</th>}</tr></thead>
        <tbody>
          {items.map((entry) => (
            <tr key={entry.id}>
              <td data-label="When">{formatDateTime(entry.created_at)}</td>
              <td data-label="Who">{entry.actor_name ?? (entry.actor_id ? 'Deleted user' : 'System')}{entry.actor_name && entry.actor_role && <small>{ROLE_LABEL[entry.actor_role] ?? entry.actor_role}</small>}</td>
              <td data-label="Action">{ACTION_LABEL[entry.action] ?? entry.action}</td>
              <td data-label="Target">{entry.target_type} #{entry.target_id}</td>
              {!compact && <td data-label="Details" className="console-details">{Object.entries(entry.details ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ') || '-'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuditLog() {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const search = useDebounced(q.trim())
  const { data, error, loading } = useApi(`/admin/audit-logs${query({ action, q: search, page, limit: 30 })}`)
  return (
    <section aria-label="Audit log">
      <div className="console-toolbar">
        <div className="field console-select">
          <label htmlFor="audit-action">Action</label>
          <select id="audit-action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }}>
            {AUDIT_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <SearchBox value={q} onChange={(value) => { setQ(value); setPage(1) }} placeholder="Search by person, action or target ID" label="Search audit log" />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && !data ? <Loading /> : (
        <>
          <AuditRows items={data?.items} />
          {data && <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
        </>
      )}
    </section>
  )
}

function UserDetail({ id, onBack, notify, ask, onOpenPaper }) {
  const { data: user, error, loading, reload } = useApi(`/admin/users/${id}`)
  if (error) return <div><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back to users</button><p className="alert" role="alert">{error}</p></div>
  if (loading && !user) return <Loading text="Loading account…" />
  const moderator = user.role === 'moderator'
  const block = () => ask({
    title: `${moderator ? 'Suspend' : 'Block'} ${user.name}?`,
    body: `They are signed out everywhere and cannot use SNARP until unblocked. Their data and papers are kept.${moderator ? ' Papers they were reviewing go back to the queue.' : ''}`,
    confirmLabel: moderator ? 'Suspend moderator' : 'Block account', tone: 'danger',
    reason: { label: 'Reason', min: 5, max: 500, placeholder: 'Recorded in the audit log.' },
    run: async (reason) => { await api(`/admin/users/${user.id}/block`, { method: 'PATCH', body: { reason } }); notify(`${user.name} was ${moderator ? 'suspended' : 'blocked'}.`); reload() },
  })
  const unblock = () => ask({
    title: `${moderator ? 'Reactivate' : 'Unblock'} ${user.name}?`, body: 'They can sign in again straight away.', confirmLabel: moderator ? 'Reactivate' : 'Unblock',
    run: async () => { await api(`/admin/users/${user.id}/unblock`, { method: 'PATCH' }); notify(`${user.name} can sign in again.`); reload() },
  })
  const setRole = (role) => ask({
    title: role === 'moderator' ? `Make ${user.name} a moderator?` : `Remove moderator access from ${user.name}?`,
    body: role === 'moderator' ? 'Moderators can verify, approve and reject papers. They cannot manage users or settings.' : 'They become an Author again. Papers they were reviewing go back to the queue.',
    confirmLabel: role === 'moderator' ? 'Make moderator' : 'Remove moderator', tone: role === 'moderator' ? 'primary' : 'danger',
    run: async () => { await api(`/admin/users/${user.id}/role`, { method: 'PUT', body: { role } }); notify(role === 'moderator' ? `${user.name} is now a moderator.` : `${user.name} is no longer a moderator.`); reload() },
  })
  const admin = user.role === 'admin'
  return (
    <div className="console-user">
      <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back to users</button>
      <section className="panel console-user-head">
        <Avatar name={user.name} src={user.avatar_url} size="lg" />
        <div>
          <h2>{user.name}</h2>
          <p className="muted-sm">{user.email}</p>
          <div className="tag-row"><RoleTag role={user.role} /><AccountStatus user={user} /></div>
        </div>
        <div className="console-actions">
          <SiteLink className="btn btn-ghost btn-sm" to={`/users/${user.id}`}>Public profile</SiteLink>
          {!admin && (user.blocked_at
            ? <button type="button" className="btn btn-secondary btn-sm" onClick={unblock}><LockOpen size={15} /> {moderator ? 'Reactivate' : 'Unblock'}</button>
            : <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={block}><Lock size={15} /> {moderator ? 'Suspend' : 'Block'}</button>)}
          {!admin && !moderator && !user.blocked_at && user.email_verified_at && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRole('moderator')}><UserPlus size={15} /> Make moderator</button>}
          {moderator && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRole('author')}><UserMinus size={15} /> Remove moderator</button>}
        </div>
      </section>
      {user.blocked_at && <p className="alert">{moderator ? 'Suspended' : 'Blocked'} {formatDateTime(user.blocked_at)}{user.blocked_by_name ? ` by ${user.blocked_by_name}` : ''}{user.blocked_reason ? `: ${user.blocked_reason}` : ''}</p>}
      <div className="console-split">
        <section className="panel review-section">
          <h3>Account</h3>
          <dl className="console-facts">
            <div><dt>Joined</dt><dd>{formatDate(user.created_at)}</dd></div>
            <div><dt>Email confirmed</dt><dd>{user.email_verified_at ? formatDate(user.email_verified_at) : 'Not yet'}</dd></div>
            <div><dt>Last sign-in</dt><dd>{formatDateTime(user.last_login_at)}</dd></div>
            <div><dt>Last seen</dt><dd>{formatDateTime(user.last_seen_at)}</dd></div>
            <div><dt>Active sessions</dt><dd>{user.active_sessions}</dd></div>
            <div><dt>Posts · followers</dt><dd>{user.post_count} · {user.follower_count}</dd></div>
            {user.institution && <div><dt>Institution</dt><dd>{[user.department, user.institution].filter(Boolean).join(', ')}</dd></div>}
          </dl>
        </section>
        <section className="panel review-section">
          <h3>Papers ({user.papers.length})</h3>
          {user.papers.length ? (
            <ul className="console-mini-list">
              {user.papers.map((p) => (
                <li key={p.id}>
                  <button type="button" className="console-link" onClick={() => onOpenPaper(p.id)}>{p.title}</button>
                  <span><StatusTag status={p.status} round={p.round} /> <small className="muted-sm">{p.coauthored ? 'Co-author · ' : ''}{formatDate(p.created_at)}{p.reviewer_name ? ` · ${p.reviewer_name}` : ''}</small></span>
                </li>
              ))}
            </ul>
          ) : <p className="muted-sm">No papers submitted.</p>}
        </section>
      </div>
      {user.moderation && <section className="panel review-section"><h3>Moderator activity</h3><ModeratorStats stats={user.moderation} /><ActivityList items={user.moderation.recent} /></section>}
      <section className="panel review-section"><h3>Recent account activity</h3><AuditRows items={user.activity} compact /></section>
    </div>
  )
}

function UsersSection({ userId, onOpenUser, onBack, notify, ask, onOpenPaper }) {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const search = useDebounced(q.trim())
  const { data, error, loading } = useApi(userId ? null : `/admin/users${query({ q: search, role, status, page, limit: PAGE_SIZE })}`)
  if (userId) return <UserDetail id={userId} onBack={onBack} notify={notify} ask={ask} onOpenPaper={onOpenPaper} />
  return (
    <section aria-label="Users">
      <div className="console-toolbar">
        <SearchBox value={q} onChange={(value) => { setQ(value); setPage(1) }} placeholder="Search by name or email" label="Search users" />
        <div className="field console-select">
          <label htmlFor="user-role">Role</label>
          <select id="user-role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}>
            <option value="">All roles</option>
            {['admin', 'moderator', 'author', 'user'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="field console-select">
          <label htmlFor="user-status">Status</label>
          <select id="user-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && !data ? <Loading text="Loading users…" /> : data?.users.length ? (
        <>
          <div className="console-table-wrap">
            <table className="console-table">
              <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Papers</th><th scope="col">Joined</th><th scope="col">Last sign-in</th></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="User">
                      <span className="console-person">
                        <Avatar name={u.name} src={u.avatar_url} size="sm" />
                        <span><button type="button" className="console-link" onClick={() => onOpenUser(u.id)}>{u.name}</button><small>{u.email}</small></span>
                      </span>
                    </td>
                    <td data-label="Role"><RoleTag role={u.role} /></td>
                    <td data-label="Status"><AccountStatus user={u} /></td>
                    <td data-label="Papers">{u.paper_count}</td>
                    <td data-label="Joined">{formatDate(u.created_at)}</td>
                    <td data-label="Last sign-in">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      ) : <Empty title="No users found" text="Try another search or filter." />}
    </section>
  )
}

function ModeratorsSection({ notify, ask, onOpenUser }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState({ saving: false, error: '' })
  const [expanded, setExpanded] = useState(null)
  const search = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi(`/admin/moderators${query({ q: search, status })}`)
  const activity = useApi(expanded ? `/admin/moderators/${expanded}/activity` : null)
  const add = async (e) => {
    e.preventDefault()
    setAdding({ saving: true, error: '' })
    try {
      const user = await api('/admin/moderators', { method: 'POST', body: { email } })
      setEmail('')
      setAdding({ saving: false, error: '' })
      notify(`${user.name} is now a moderator.`)
      reload()
    } catch (err) {
      setAdding({ saving: false, error: err.status === 404 ? 'No account uses that email. Ask them to sign up and confirm their email first.' : err.message })
    }
  }
  const suspend = (m) => ask({
    title: m.blocked_at ? `Reactivate ${m.name}?` : `Suspend ${m.name}?`,
    body: m.blocked_at ? 'They can sign in and review papers again.' : 'They are signed out and cannot use SNARP until reactivated. Papers they were reviewing go back to the queue.',
    confirmLabel: m.blocked_at ? 'Reactivate' : 'Suspend', tone: m.blocked_at ? 'primary' : 'danger',
    reason: m.blocked_at ? undefined : { label: 'Reason', min: 5, max: 500, placeholder: 'Recorded in the audit log.' },
    run: async (reason) => {
      await api(`/admin/users/${m.id}/${m.blocked_at ? 'unblock' : 'block'}`, { method: 'PATCH', body: m.blocked_at ? {} : { reason } })
      notify(m.blocked_at ? `${m.name} was reactivated.` : `${m.name} was suspended.`)
      reload()
    },
  })
  const remove = (m) => ask({
    title: `Remove ${m.name} as moderator?`, body: 'They become an Author again and keep their account. Papers they were reviewing go back to the queue.',
    confirmLabel: 'Remove moderator', tone: 'danger',
    run: async () => { await api(`/admin/users/${m.id}/role`, { method: 'PUT', body: { role: 'author' } }); notify(`${m.name} is no longer a moderator.`); reload() },
  })
  return (
    <section aria-label="Moderators">
      <form className="panel console-add" onSubmit={add}>
        <div className="field">
          <label htmlFor="mod-email">Add a moderator</label>
          <input id="mod-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email of a registered, confirmed account" aria-invalid={!!adding.error} aria-describedby="mod-email-help" />
          <small id="mod-email-help" className="muted-sm">The person must already have a SNARP account. No new account or password is created.</small>
        </div>
        <button type="submit" className="btn btn-primary" disabled={adding.saving}><UserPlus size={16} /> {adding.saving ? 'Adding…' : 'Add moderator'}</button>
        {adding.error && <p className="field-error" role="alert">{adding.error}</p>}
      </form>
      <div className="console-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search moderators" label="Search moderators" />
        <div className="field console-select">
          <label htmlFor="mod-status">Status</label>
          <select id="mod-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option>
          </select>
        </div>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && !data ? <Loading text="Loading moderators…" /> : data?.length ? (
        <ul className="console-cards">
          {data.map((m) => (
            <li key={m.id} className="panel console-mod">
              <div className="console-mod-head">
                <Avatar name={m.name} src={m.avatar_url} />
                <div>
                  <button type="button" className="console-link" onClick={() => onOpenUser(m.id)}>{m.name}</button>
                  <small className="muted-sm">{m.email}</small>
                </div>
                <AccountStatus user={{ ...m, role: 'moderator' }} />
              </div>
              <dl className="console-mod-stats">
                <div><dt>Approved</dt><dd>{m.approved}</dd></div>
                <div><dt>Rejected</dt><dd>{m.rejected}</dd></div>
                <div><dt>Changes</dt><dd>{m.revision_requested}</dd></div>
                <div><dt>In progress</dt><dd>{m.in_progress}</dd></div>
              </dl>
              <p className="muted-sm">Last action {m.last_action_at ? timeAgo(m.last_action_at) : 'never'}{m.moderator_since ? ` · moderator since ${formatDate(m.moderator_since)}` : ''}</p>
              <div className="console-actions">
                <button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded === m.id} onClick={() => setExpanded(expanded === m.id ? null : m.id)}><ClockCounterClockwise size={15} /> Activity</button>
                <button type="button" className={`btn btn-sm ${m.blocked_at ? 'btn-secondary' : 'btn-ghost btn-danger'}`} onClick={() => suspend(m)}>{m.blocked_at ? <><LockOpen size={15} /> Reactivate</> : <><Lock size={15} /> Suspend</>}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(m)}><UserMinus size={15} /> Remove</button>
              </div>
              {expanded === m.id && (activity.loading && !activity.data ? <p className="muted-sm">Loading activity…</p> : <ActivityList items={activity.data?.recent} />)}
            </li>
          ))}
        </ul>
      ) : <Empty title="No moderators yet" text="Add a moderator by email above." />}
    </section>
  )
}

function ReportsSection({ notify }) {
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useApi(`/moderation/reports${query({ status, page })}`)
  const decide = async (report, decision) => {
    try {
      await api(`/moderation/reports/${report.id}/${decision}`, { method: 'PATCH' })
      notify(decision === 'reviewed' ? 'Report marked as resolved.' : 'Report dismissed.')
      reload()
    } catch (err) {
      notify(err.message, 'error')
    }
  }
  return (
    <section aria-label="Reported posts">
      <div className="console-chips" role="group" aria-label="Filter reports">
        {[['pending', 'Pending'], ['reviewed', 'Resolved'], ['dismissed', 'Dismissed']].map(([id, label]) => (
          <button key={id} type="button" className={`chip ${status === id ? 'active' : ''}`} aria-pressed={status === id} onClick={() => { setStatus(id); setPage(1) }}>{label}</button>
        ))}
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {loading && !data ? <Loading /> : data?.reports.length ? (
        <>
          <ul className="console-cards">
            {data.reports.map((r) => (
              <li key={r.id} className="panel console-report">
                <p><strong>{r.reporter_name}</strong> reported a post by <SiteLink to={`/users/${r.post_author_id}?post=${r.post_id}`}>{r.post_author_name}</SiteLink> <span className="muted-sm">· {timeAgo(r.created_at)}</span></p>
                <blockquote>{r.reason}</blockquote>
                {r.post_body && <ExpandableText text={r.post_body} lines={4} />}
                {status === 'pending' && (
                  <div className="console-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(r, 'reviewed')}><CheckCircle size={15} /> Resolve</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide(r, 'dismissed')}><XCircle size={15} /> Dismiss</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      ) : <Empty title="No reports" text="Reported posts will appear here." />}
    </section>
  )
}

const ADMIN_TABS = ['overview', 'users', 'moderators', 'papers', 'audit', 'reports']

export function AdminDashboard() {
  const [params, setParams] = useSearchParams()
  const tab = ADMIN_TABS.includes(params.get('tab')) ? params.get('tab') : 'overview'
  const paperId = /^\d+$/.test(params.get('paper') ?? '') ? params.get('paper') : null
  const userId = /^\d+$/.test(params.get('user') ?? '') ? params.get('user') : null
  const view = STATUS_FILTERS.some(([id]) => id === params.get('status')) ? params.get('status') : 'all'
  const [notify, toasts] = useToasts()
  const [ask, dialog] = useConfirm()
  const go = (next, extra = {}) => setParams(query({ tab: next, ...extra }).slice(1))
  return (
    <Shell
      title="Super Admin" kicker="Daily report" sub="Everything that happens on SNARP passes across this desk: people, moderators, papers and the record of who did what." toasts={<>{toasts}{dialog}</>}
      nav={<ConsoleNav label="Admin sections" active={tab} onSelect={(next) => go(next)} items={[
        { id: 'overview', label: 'Overview', icon: SquaresFour },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'moderators', label: 'Moderators', icon: ShieldCheck },
        { id: 'papers', label: 'Research papers', icon: Article },
        { id: 'audit', label: 'Audit log', icon: ClockCounterClockwise },
        { id: 'reports', label: 'Reported posts', icon: Flag },
      ]} />}
    >
      {tab === 'overview' && <Overview onOpen={go} />}
      {tab === 'users' && <UsersSection key={userId ?? 'list'} userId={userId} onOpenUser={(id) => go('users', { user: id })} onBack={() => go('users')} notify={notify} ask={ask} onOpenPaper={(id) => go('papers', { paper: id })} />}
      {tab === 'moderators' && <ModeratorsSection notify={notify} ask={ask} onOpenUser={(id) => go('users', { user: id })} />}
      {tab === 'papers' && (paperId
        ? <PaperReview id={paperId} admin onBack={() => go('papers', { status: view === 'all' ? '' : view })} notify={notify} />
        : <PaperList key={view} admin view={view} filters={STATUS_FILTERS} onView={(next) => go('papers', { status: next === 'all' ? '' : next })} onOpen={(id) => go('papers', { status: view === 'all' ? '' : view, paper: id })} />)}
      {tab === 'audit' && <AuditLog />}
      {tab === 'reports' && <ReportsSection notify={notify} />}
    </Shell>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowsClockwise, CheckCircle, Circle, ClipboardText, FilePdf, Lock, PaperPlaneTilt, Plus, Star, Trash, UploadSimple, UsersThree, Warning, XCircle,
} from '@phosphor-icons/react'
import { api, apiBlob } from '../api'
import { PageHeader } from '../components/ui'
import { PdfReader } from '../components/Overlay'
import { ExpandableText } from '../components/RichText'
import { timeAgo } from '../format'

const STATUS = {
  coauthor_check: { label: 'Co-author check', className: 'tag-blue' },
  pending: { label: 'Waiting for moderator', className: 'tag-pending' },
  under_review: { label: 'Under review', className: 'tag-pending' },
  revision_requested: { label: 'Changes requested', className: 'tag-warn' },
  approved: { label: 'Approved', className: 'tag-blue' },
  published: { label: 'Published', className: 'tag-success' },
  rejected: { label: 'Rejected', className: 'tag-danger' },
}
const RECOMMENDATION = {
  accept: { label: 'Accept', className: 'tag-success', hint: 'Ready to publish as it is' },
  minor_revision: { label: 'Minor revision', className: 'tag-pending', hint: 'Small fixes, no new work' },
  major_revision: { label: 'Major revision', className: 'tag-warn', hint: 'Substantial changes needed' },
  reject: { label: 'Reject', className: 'tag-danger', hint: 'Not suitable for publication' },
}
const CRITERIA = [
  ['originality', 'Originality', 'Is the contribution new?'],
  ['methodology', 'Methodology', 'Are the methods and analysis sound?'],
  ['clarity', 'Clarity', 'Is it well structured and clearly written?'],
  ['significance', 'Significance', 'Does it matter to the field?'],
]
const DECISION = {
  approved: 'Approved by a moderator',
  rejected: 'Rejected',
  under_review: 'A moderator started verification',
  released: 'Returned to the moderation queue',
  published: 'Published',
  status_changed: 'Status changed by an administrator',
  revision_requested: 'Changes requested',
  resubmitted: 'Revised and resubmitted',
  coauthor_update: 'Corrected PDF sent to co-authors',
  coauthors_approved: 'All co-authors approved · sent to peer review',
}
const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const versionLabel = (round, draft = 1) => `Round ${round}${draft > 1 ? ` · draft ${draft}` : ''}`
const formatSize = (bytes) => (!bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export function StatusTag({ status, round }) {
  const meta = STATUS[status] ?? { label: status, className: '' }
  return <span className={`tag ${meta.className}`}>{meta.label}{['pending', 'under_review'].includes(status) && round > 1 ? ` · round ${round}` : ''}</span>
}

export function Stars({ value, size = 16 }) {
  if (value == null) return <span className="muted-sm">No ratings yet</span>
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} weight={value >= n - 0.25 ? 'fill' : 'regular'} />)}
      <span className="stars-value">{Number(value).toFixed(1)}</span>
    </span>
  )
}

function StarInput({ value, onChange, invalid }) {
  return (
    <div className={`star-input ${invalid ? 'invalid' : ''}`} role="radiogroup" aria-label="Overall rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={value >= n ? 'on' : ''} onClick={() => onChange(n)}>
          <Star size={26} weight={value >= n ? 'fill' : 'regular'} />
        </button>
      ))}
      <span className="muted-sm">{value ? ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][value] : 'Choose 1 to 5'}</span>
    </div>
  )
}

function ScoreInput({ name, label, hint, value, onChange, invalid }) {
  return (
    <div className={`score-row ${invalid ? 'invalid' : ''}`}>
      <div><strong>{label}</strong><span>{hint}</span></div>
      <div className="score-buttons" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? 'on' : ''}
            onClick={() => onChange(name, n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}

function ScoreBars({ values }) {
  return (
    <dl className="score-bars">
      {CRITERIA.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd><span className="bar"><i style={{ width: `${((values[key] ?? 0) / 5) * 100}%` }} /></span><span>{values[key] != null ? Number(values[key]).toFixed(1) : '-'}</span></dd>
        </div>
      ))}
    </dl>
  )
}

function PdfViewer({ path, label, title, filename }) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState({ loading: false, error: '' })
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const open = async () => {
    setState({ loading: true, error: '' })
    try {
      setUrl(URL.createObjectURL(await apiBlob(path)))
      setState({ loading: false, error: '' })
    } catch (err) {
      setState({ loading: false, error: err.message })
    }
  }
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={open} disabled={state.loading} aria-haspopup="dialog"><FilePdf size={16} /> {state.loading ? 'Opening…' : label}</button>
      {state.error && <span className="field-error" role="alert">{state.error}</span>}
      {url && <PdfReader url={url} title={title ?? label} filename={filename || 'paper.pdf'} onClose={() => setUrl('')} />}
    </>
  )
}

function Versions({ paperId, versions }) {
  if (!versions?.length) return null
  return (
    <section className="panel review-section">
      <h2>Versions</h2>
      <ol className="version-list">
        {[...versions].reverse().map((version) => (
          <li key={`${version.round}-${version.draft ?? 1}`}>
            <div>
              <strong>{versionLabel(version.round, version.draft)}{version.current ? ' · current' : ''}</strong>
              <span className="muted-sm">{formatDate(version.submitted_at)} · {version.pdf_filename} {formatSize(version.pdf_size) && `· ${formatSize(version.pdf_size)}`}</span>
            </div>
            <PdfViewer path={version.current ? `/papers/${paperId}/pdf` : `/papers/${paperId}/versions/${version.round}/pdf?draft=${version.draft ?? 1}`} label="View PDF" title={versionLabel(version.round, version.draft)} filename={version.pdf_filename} />
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ReviewCard({ review, showName = false, showConfidential = false }) {
  const rec = RECOMMENDATION[review.recommendation]
  return (
    <article className="review-card">
      <header>
        <strong>{showName ? (review.reviewer_name ?? 'Former reviewer') : review.reviewer_label}</strong>
        <span className="muted-sm">Round {review.round} · {timeAgo(review.updated_at ?? review.created_at)}</span>
        <span className={`tag ${rec?.className ?? ''}`}>{rec?.label ?? review.recommendation}</span>
      </header>
      <div className="review-card-scores">
        <Stars value={review.overall_rating} />
        <ScoreBars values={review} />
      </div>
      <p className="review-comments">{review.comments}</p>
      {review.suggestions?.length > 0 && (
        <>
          <h4>Suggestions for improvement</h4>
          <ol className="suggestion-list">
            {review.suggestions.map((s) => (
              <li key={s.id}>
                {s.section && <span className="suggestion-section">{s.section}</span>}
                <p>{s.body}</p>
                {s.status !== 'open' && (
                  <p className={`suggestion-answer ${s.status}`}>
                    {s.status === 'addressed' ? <CheckCircle size={15} weight="fill" /> : <XCircle size={15} weight="fill" />}
                    <span><strong>Author {s.status === 'addressed' ? 'addressed this' : 'declined'}</strong>{s.author_response && `: ${s.author_response}`}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {showConfidential && review.confidential_comments && (
        <p className="review-confidential"><Lock size={14} /> <span><strong>Note for moderators:</strong> {review.confidential_comments}</span></p>
      )}
    </article>
  )
}

function History({ history }) {
  if (!history?.length) return null
  return (
    <section className="panel review-section">
      <h2>Timeline</h2>
      <ol className="timeline">
        {history.map((entry) => (
          <li key={entry.id} className={entry.decision}>
            <strong>{DECISION[entry.decision] ?? entry.decision}</strong>
            <span className="muted-sm">Round {entry.round} · {formatDate(entry.created_at)}{entry.actor_name ? ` · ${entry.actor_name}` : ''}</span>
            {entry.comment && <p>{entry.comment}</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}

function RoundSummary({ summary, title = 'Current round' }) {
  if (!summary?.count) return null
  return (
    <section className="panel review-section review-summary">
      <h2>{title}</h2>
      <div className="summary-top">
        <div><Stars value={summary.overall} size={20} /><span className="muted-sm">{summary.count} review{summary.count === 1 ? '' : 's'}</span></div>
        <div className="rec-tally">
          {Object.entries(summary.recommendations).filter(([, n]) => n).map(([key, n]) => (
            <span key={key} className={`tag ${RECOMMENDATION[key].className}`}>{RECOMMENDATION[key].label} × {n}</span>
          ))}
        </div>
      </div>
      <ScoreBars values={summary} />
    </section>
  )
}

function PaperInfo({ paper, showEmail }) {
  const authors = (paper.authors ?? []).map((a) => [a.name, a.affiliation].filter(Boolean).join(', ')).join('; ')
  return (
    <section className="panel review-section">
      <div className="review-meta"><StatusTag status={paper.status} round={paper.round} /><span className="muted-sm">{paper.domain} · submitted {formatDate(paper.created_at)}{paper.resubmitted_at ? ` · revised ${formatDate(paper.resubmitted_at)}` : ''}</span></div>
      <p className="review-authors">{authors}</p>
      {showEmail && <p className="muted-sm">Submitted by {paper.submitter_name} ({paper.submitter_email})</p>}
      {paper.doi && <p className="muted-sm">DOI: {paper.doi}</p>}
      <h3>Abstract</h3>
      <ExpandableText text={paper.abstract} lines={8} className="review-abstract" />
      {paper.tags?.length > 0 && <div className="tag-row">{paper.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
      {paper.additional_notes && <><h3>Notes from the author</h3><p className="pre">{paper.additional_notes}</p></>}
      <div className="article-actions"><PdfViewer path={`/papers/${paper.id}/pdf`} label={`View PDF (round ${paper.round})`} title={paper.title} filename={paper.pdf_filename} /></div>
    </section>
  )
}

function QuickPublish({ paper, onDone }) {
  const [state, setState] = useState({ saving: false, error: '' })
  const publish = async () => {
    if (!window.confirm(`Publish "${paper.title}" for everyone? It will appear under Papers and in the feed, and can no longer be withdrawn.`)) return
    setState({ saving: true, error: '' })
    try {
      await api(`/papers/${paper.id}/publish`, { method: 'POST' })
      onDone(paper)
    } catch (err) {
      setState({ saving: false, error: err.message })
    }
  }
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={publish} disabled={state.saving}><PaperPlaneTilt size={15} /> {state.saving ? 'Publishing…' : 'Publish'}</button>
      {state.error && <span className="field-error" role="alert">{state.error}</span>}
    </>
  )
}

function OwnPaperCard({ paper, onPublished }) {
  const total = paper.coauthor_count ?? 0
  const approved = Math.min(paper.coauthor_approvals ?? 0, total)
  const mine = !paper.coauthored
  const needsMyCheck = paper.coauthored && paper.status === 'coauthor_check' && paper.my_check !== 'approve'
  return (
    <article className="own-card">
      <div className="own-card-top">
        <StatusTag status={paper.status} round={paper.round} />
        <span className={`tag ${mine ? 'tag-role-author' : ''}`}>{mine ? 'Your paper' : `Co-author · ${paper.submitter_name}`}</span>
      </div>
      <h3><Link to={`/my-submissions/${paper.id}`}>{paper.title}</Link></h3>
      <p className="muted-sm">{paper.domain} · submitted {timeAgo(paper.created_at)}</p>
      <dl className="own-card-stats">
        <div>
          <dt><UsersThree size={14} /> Co-authors</dt>
          <dd>{total ? <><span className="mini-bar"><i style={{ width: `${(approved / total) * 100}%` }} /></span> {approved}/{total} approved</> : 'None'}</dd>
        </div>
        <div>
          <dt><ClipboardText size={14} /> Peer reviews</dt>
          <dd>{paper.review_count} so far</dd>
        </div>
      </dl>
      <div className="own-card-actions">
        {mine && paper.status === 'approved' && <QuickPublish paper={paper} onDone={onPublished} />}
        {needsMyCheck && <Link className="btn btn-primary btn-sm" to={`/my-submissions/${paper.id}`}><CheckCircle size={15} /> Check the PDF</Link>}
        {paper.coauthored && paper.my_check === 'approve' && paper.status === 'coauthor_check' && <span className="tag tag-success"><CheckCircle size={13} weight="fill" /> You approved</span>}
        <Link className="btn btn-ghost btn-sm" to={`/my-submissions/${paper.id}`}>Open</Link>
      </div>
    </article>
  )
}

export function ReviewQueue() {
  const [tab, setTab] = useState('open')
  const [data, setData] = useState({ tab: null, items: [], error: '' })
  const [own, setOwn] = useState([])
  const [notice, setNotice] = useState('')
  useEffect(() => {
    api('/papers/my-submissions').then((papers) => setOwn(papers.filter((p) => ['coauthor_check', 'pending', 'under_review', 'approved'].includes(p.status)))).catch(() => {})
  }, [])
  useEffect(() => {
    let active = true
    api(`/reviews/queue${tab === 'mine' ? '?scope=mine' : ''}`)
      .then((items) => { if (active) setData({ tab, items, error: '' }) })
      .catch((err) => { if (active) setData({ tab, items: [], error: err.message }) })
    return () => { active = false }
  }, [tab])
  const loading = data.tab !== tab
  const published = (paper) => {
    setOwn((list) => list.filter((p) => p.id !== paper.id))
    setNotice(`"${paper.title}" is now published.`)
  }
  const waiting = data.tab === 'open' ? data.items.filter((p) => !p.reviewed_by_me).length : null

  return (
    <div className="page">
      <PageHeader title="Peer review" sub="Review other researchers' work before it is published. Authors see your feedback without your name." />
      {notice && <p className="notice" role="status"><CheckCircle size={16} weight="fill" /> {notice} <Link to="/articles">Open Papers</Link></p>}

      {own.length > 0 && (
        <section className="own-papers" aria-labelledby="own-papers-title">
          <div className="own-papers-head">
            <h2 id="own-papers-title">Your papers in progress</h2>
            <p className="muted-sm"><Lock size={13} /> You can&apos;t review your own or co-authored papers; other researchers will, and a moderator verifies every paper. Once a moderator approves your paper, you can publish it here.</p>
          </div>
          <div className="own-grid">
            {own.map((paper) => <OwnPaperCard key={paper.id} paper={paper} onPublished={published} />)}
          </div>
        </section>
      )}

      <div className="feed-tabs review-tabs">
        <div className="feed-scope" role="tablist">
          <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>Needs review{waiting ? <span className="tab-count">{waiting}</span> : null}</button>
          <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My reviews</button>
        </div>
      </div>
      {data.error && <p className="alert" role="alert">{data.error}</p>}
      {loading ? <p className="muted-sm">Loading…</p> : tab === 'open' ? (
        <div className="queue-grid">
          {data.items.map((paper) => (
            <article key={paper.id} className={`panel queue-card ${paper.reviewed_by_me ? 'done' : ''}`}>
              <div className="queue-card-top">
                <span className="queue-domain">{paper.domain}</span>
                {paper.reviewed_by_me
                  ? <span className="tag tag-success"><CheckCircle size={13} weight="fill" /> Reviewed</span>
                  : paper.reviewed_earlier ? <span className="tag tag-warn"><ArrowsClockwise size={13} /> Revised, review again</span>
                    : <span className="tag tag-pending">Needs review</span>}
              </div>
              <h3><Link to={`/reviews/${paper.id}`}>{paper.title}</Link></h3>
              <p className="queue-abstract">{paper.abstract}</p>
              <div className="queue-card-foot">
                <span className="muted-sm">{paper.round > 1 ? `Round ${paper.round} · revised ${timeAgo(paper.resubmitted_at)}` : `Submitted ${timeAgo(paper.created_at)}`} · {paper.review_count} review{paper.review_count === 1 ? '' : 's'}</span>
                <Link className={`btn btn-sm ${paper.reviewed_by_me ? 'btn-ghost' : 'btn-primary'}`} to={`/reviews/${paper.id}`}>{paper.reviewed_by_me ? 'Edit review' : 'Review'}</Link>
              </div>
            </article>
          ))}
          {!data.items.length && <div className="panel empty queue-empty"><ClipboardText size={28} /><h3>Nothing to review</h3><p>Papers by other researchers that are waiting for peer review appear here.</p></div>}
        </div>
      ) : (
        <div className="queue-grid">
          {data.items.map((item) => (
            <article key={item.review_id} className="panel queue-card">
              <div className="queue-card-top">
                <span className="queue-domain">{item.domain}</span>
                <StatusTag status={item.status} round={item.current_round} />
              </div>
              <h3><Link to={`/reviews/${item.id}`}>{item.title}</Link></h3>
              <div className="queue-card-rating"><Stars value={item.overall_rating} /><span className={`tag ${RECOMMENDATION[item.recommendation]?.className ?? ''}`}>{RECOMMENDATION[item.recommendation]?.label}</span></div>
              <div className="queue-card-foot">
                <span className="muted-sm">Your round {item.round} review · updated {timeAgo(item.updated_at)}</span>
                <Link className="btn btn-ghost btn-sm" to={`/reviews/${item.id}`}>Open</Link>
              </div>
            </article>
          ))}
          {!data.items.length && <div className="panel empty queue-empty"><h3>No reviews yet</h3><p>Reviews you write will be listed here.</p></div>}
        </div>
      )}
    </div>
  )
}

const emptyReview = () => ({
  overall_rating: 0,
  scores: { originality: 0, methodology: 0, clarity: 0, significance: 0 },
  recommendation: '',
  comments: '',
  confidential_comments: '',
  suggestions: [{ section: '', body: '' }],
})

const reviewToForm = (review) => review ? ({
  overall_rating: review.overall_rating,
  scores: Object.fromEntries(CRITERIA.map(([key]) => [key, review[key]])),
  recommendation: review.recommendation,
  comments: review.comments,
  confidential_comments: review.confidential_comments ?? '',
  suggestions: review.suggestions.length ? review.suggestions.map(({ section, body }) => ({ section, body })) : [{ section: '', body: '' }],
}) : emptyReview()

function ReviewForm({ paper, existing, onSaved }) {
  const [form, setForm] = useState(() => reviewToForm(existing))
  const [state, setState] = useState({ saving: false, error: '', field: '', saved: false })
  const set = (patch) => { setForm((current) => ({ ...current, ...patch })); setState((s) => ({ ...s, saved: false, field: '' })) }
  const setSuggestion = (index, key, value) => set({ suggestions: form.suggestions.map((s, i) => (i === index ? { ...s, [key]: value } : s)) })

  const submit = async (event) => {
    event.preventDefault()
    setState({ saving: true, error: '', field: '', saved: false })
    try {
      const saved = await api(`/reviews/papers/${paper.id}`, { method: 'PUT', body: form })
      setState({ saving: false, error: '', field: '', saved: true })
      onSaved(saved)
    } catch (err) {
      setState({ saving: false, error: err.message, field: err.field ?? '', saved: false })
    }
  }

  const invalid = (name) => state.field === name
  return (
    <form className="panel review-section review-form" onSubmit={submit} noValidate>
      <h2>{existing ? 'Your review' : 'Write your review'}</h2>
      <p className="muted-sm">The author sees your ratings, comments and suggestions without your name once a moderator decides. You can edit your review until then.</p>
      {state.error && <p className="alert" role="alert">{state.error}</p>}
      {state.saved && <p className="notice" role="status"><CheckCircle size={16} weight="fill" /> Review saved. Thank you!</p>}

      <fieldset>
        <legend>Overall rating</legend>
        <StarInput value={form.overall_rating} onChange={(n) => set({ overall_rating: n })} invalid={invalid('overall_rating')} />
      </fieldset>

      <fieldset>
        <legend>Scores <span className="muted-sm">(1 = poor, 5 = excellent)</span></legend>
        {CRITERIA.map(([key, label, hint]) => (
          <ScoreInput key={key} name={key} label={label} hint={hint} value={form.scores[key]} invalid={invalid(key)}
            onChange={(name, n) => set({ scores: { ...form.scores, [name]: n } })} />
        ))}
      </fieldset>

      <fieldset>
        <legend>Recommendation</legend>
        <div className={`rec-options ${invalid('recommendation') ? 'invalid' : ''}`}>
          {Object.entries(RECOMMENDATION).map(([key, meta]) => (
            <label key={key} className={form.recommendation === key ? 'active' : ''}>
              <input type="radio" name="recommendation" value={key} checked={form.recommendation === key} onChange={() => set({ recommendation: key })} />
              <strong>{meta.label}</strong><span>{meta.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="review-comments">Comments for the author</label>
        <textarea id="review-comments" rows={7} value={form.comments} aria-invalid={invalid('comments')} maxLength={10000}
          placeholder="Summarise the paper's contribution, its strengths and its main weaknesses."
          onChange={(e) => set({ comments: e.target.value })} />
        <small className="field-hint">{form.comments.trim().length < 20 ? `At least 20 characters (${form.comments.trim().length} so far)` : `${form.comments.length.toLocaleString()} / 10,000`}</small>
      </div>

      <fieldset className={invalid('suggestions') ? 'invalid' : ''}>
        <legend>Suggestions for improvement</legend>
        <p className="muted-sm">One change per item. The author answers each one when resubmitting.</p>
        <ol className="suggestion-inputs">
          {form.suggestions.map((s, index) => (
            <li key={index}>
              <input aria-label={`Suggestion ${index + 1} section or page`} placeholder="Section or page (optional)" value={s.section} maxLength={120}
                onChange={(e) => setSuggestion(index, 'section', e.target.value)} />
              <textarea aria-label={`Suggestion ${index + 1}`} rows={2} placeholder="What should change, and why?" value={s.body} maxLength={2000}
                onChange={(e) => setSuggestion(index, 'body', e.target.value)} />
              {form.suggestions.length > 1 && (
                <button type="button" className="icon-btn" aria-label={`Remove suggestion ${index + 1}`}
                  onClick={() => set({ suggestions: form.suggestions.filter((_, i) => i !== index) })}><Trash size={16} /></button>
              )}
            </li>
          ))}
        </ol>
        {form.suggestions.length < 30 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ suggestions: [...form.suggestions, { section: '', body: '' }] })}>
            <Plus size={14} /> Add suggestion
          </button>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor="review-confidential"><Lock size={13} /> Note for moderators <span className="muted-sm">(optional, never shown to the author)</span></label>
        <textarea id="review-confidential" rows={3} value={form.confidential_comments} maxLength={5000}
          onChange={(e) => set({ confidential_comments: e.target.value })} />
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={state.saving}>{state.saving ? 'Saving…' : existing ? 'Update review' : 'Submit review'}</button>
      </div>
    </form>
  )
}

function PreviousRound({ paper }) {
  if (paper.round < 2) return null
  return (
    <section className="panel review-section changes-panel">
      <h2>What changed in round {paper.round}</h2>
      {paper.revision_note && <><h3>Changes the moderator asked for</h3><p className="pre">{paper.revision_note}</p></>}
      {paper.response_letter && <><h3>Author&apos;s response to reviewers</h3><p className="pre">{paper.response_letter}</p></>}
      {paper.previous_round?.some((r) => r.suggestions.length) && (
        <>
          <h3>Round {paper.round - 1} suggestions and answers</h3>
          {paper.previous_round.filter((r) => r.suggestions.length).map((review) => (
            <div key={review.id} className="previous-suggestions">
              <strong className="muted-sm">{review.reviewer_label}</strong>
              <ol className="suggestion-list">
                {review.suggestions.map((s) => (
                  <li key={s.id}>
                    {s.section && <span className="suggestion-section">{s.section}</span>}
                    <p>{s.body}</p>
                    <p className={`suggestion-answer ${s.status}`}>
                      {s.status === 'addressed' ? <CheckCircle size={15} weight="fill" /> : s.status === 'declined' ? <XCircle size={15} weight="fill" /> : <Warning size={15} />}
                      <span><strong>{s.status === 'addressed' ? 'Addressed' : s.status === 'declined' ? 'Declined' : 'No answer'}</strong>{s.author_response && `: ${s.author_response}`}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

export function ReviewWorkspace({ user }) {
  const { id } = useParams()
  const [data, setData] = useState({ id: null, paper: null, error: '' })
  const moderator = ['admin', 'moderator'].includes(user.role)

  const load = useCallback(() => api(`/reviews/papers/${encodeURIComponent(id)}`)
    .then((paper) => setData({ id, paper, error: '' }))
    .catch((err) => setData({ id, paper: null, error: err.message })), [id])
  useEffect(() => { load() }, [load])

  const paper = data.id === id ? data.paper : null
  if (data.id === id && data.error) return <div className="page"><p className="alert" role="alert">{data.error}</p><Link to="/reviews">Back to peer review</Link></div>
  if (!paper) return <div className="page"><div className="panel empty" aria-busy="true">Loading paper…</div></div>

  const currentReviews = (paper.reviews ?? []).filter((r) => r.round === paper.round)
  const earlierReviews = (paper.reviews ?? []).filter((r) => r.round < paper.round)
  return (
    <div className="page page-wide">
      <Link to={moderator ? '/moderator' : '/reviews'} className="back-link"><ArrowLeft size={14} /> {moderator ? 'Moderator dashboard' : 'Peer review'}</Link>
      <PageHeader title={paper.title} />
      <div className="review-layout">
        <div className="review-main">
          <PaperInfo paper={paper} showEmail={moderator} />
          <PreviousRound paper={paper} />
          {moderator && <CoauthorChecks paper={paper} viewerId={user.id} editable={false} />}
          {paper.versions?.length > 1 && <Versions paperId={paper.id} versions={paper.versions} />}
          {moderator && (
            <>
              <RoundSummary summary={paper.summary} title={`Round ${paper.round} reviews`} />
              {currentReviews.map((review) => <ReviewCard key={review.id} review={review} showName showConfidential />)}
              {['pending', 'under_review'].includes(paper.status) && !currentReviews.length && <div className="panel empty"><h3>No reviews for this round yet</h3><p>Reviewers find this paper under Peer review.</p></div>}
              {earlierReviews.length > 0 && (
                <details className="panel review-section">
                  <summary>Earlier rounds ({earlierReviews.length} review{earlierReviews.length === 1 ? '' : 's'})</summary>
                  {earlierReviews.map((review) => <ReviewCard key={review.id} review={review} showName showConfidential />)}
                </details>
              )}
              <History history={paper.history} />
            </>
          )}
        </div>
        <aside className="review-side">
          {moderator && ['pending', 'under_review'].includes(paper.status) && <section className="panel review-section"><h2>Moderator decision</h2><p className="muted-sm">Approve, reject or request changes from the moderator dashboard.</p><Link className="btn btn-primary btn-sm" to={`/moderator?paper=${paper.id}`}><CheckCircle size={15} /> Open in dashboard</Link></section>}
          {paper.can_review
            ? <ReviewForm key={`${paper.id}-${paper.round}`} paper={paper} existing={paper.my_review} onSaved={load} />
            : paper.my_review
              ? <section className="panel review-section"><h2>Your review</h2><ReviewCard review={{ ...paper.my_review, reviewer_label: 'You' }} showConfidential /></section>
              : !['pending', 'under_review'].includes(paper.status) && <section className="panel review-section"><h2>Review closed</h2><p className="muted-sm">This paper is no longer under review ({STATUS[paper.status]?.label.toLowerCase()}).</p></section>}
          {!paper.can_review && String(paper.user_id) === String(user.id) && <p className="notice">You submitted this paper, so you can&apos;t review it.</p>}
        </aside>
      </div>
    </div>
  )
}

function CoauthorChecks({ paper, viewerId, editable, onSaved }) {
  const rounds = paper.coauthor_checks ?? []
  const current = rounds.find((r) => r.current)
  const mine = current?.checks.find((c) => String(c.user_id) === String(viewerId))
  const [form, setForm] = useState({ decision: mine?.decision ?? '', comment: mine?.comment ?? '' })
  const [state, setState] = useState({ saving: false, error: '', done: false })
  if (!current?.checks.length) return null
  const approved = current.checks.filter((c) => c.decision === 'approve').length

  const save = async (event) => {
    event.preventDefault()
    if (!form.decision) return setState({ saving: false, error: 'Choose Approve or Request changes', done: false })
    setState({ saving: true, error: '', done: false })
    try {
      await api(`/papers/${paper.id}/coauthor-check`, { method: 'PUT', body: form })
      setState({ saving: false, error: '', done: true })
      onSaved?.()
    } catch (err) {
      setState({ saving: false, error: err.message, done: false })
    }
  }

  return (
    <section className="panel review-section coauthor-checks">
      <h2><UsersThree size={18} /> Co-author check</h2>
      <p className="muted-sm">Before a version goes to peer review, every co-author checks its PDF. {approved} of {current.checks.length} co-author{current.checks.length === 1 ? '' : 's'} approved {versionLabel(current.round, current.draft).toLowerCase()}.</p>

      {editable && mine && (
        <form className="coauthor-form" onSubmit={save}>
          <div className="coauthor-form-head">
            <strong>Your check of {versionLabel(current.round, current.draft).toLowerCase()}</strong>
            <PdfViewer path={`/papers/${paper.id}/pdf`} label="Open this PDF" title={paper.title} filename={paper.pdf_filename} />
          </div>
          {state.error && <p className="alert" role="alert">{state.error}</p>}
          {state.done && <p className="notice" role="status"><CheckCircle size={16} weight="fill" /> Saved. {paper.submitter_name} has been notified.</p>}
          <p className="muted-sm">Approve if this PDF is ready for peer review. Request changes to send it back to {paper.submitter_name}, who uploads a corrected PDF for you to check again.</p>
          <div className="check-options" role="radiogroup" aria-label="Your decision">
            <button type="button" role="radio" aria-checked={form.decision === 'approve'} className={form.decision === 'approve' ? 'on ok' : ''} onClick={() => setForm({ ...form, decision: 'approve' })}><CheckCircle size={16} /> Approve this version</button>
            <button type="button" role="radio" aria-checked={form.decision === 'changes'} className={form.decision === 'changes' ? 'on no' : ''} onClick={() => setForm({ ...form, decision: 'changes' })}><Warning size={16} /> Request changes</button>
          </div>
          <textarea rows={3} maxLength={3000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} aria-label="Comment for the submitter"
            placeholder={form.decision === 'changes' ? 'What should the submitter change? (required)' : 'Optional comment for the submitter'} />
          <div className="form-actions"><button className="btn btn-primary" disabled={state.saving}>{state.saving ? 'Saving…' : mine.decision ? 'Update my check' : 'Save my check'}</button></div>
        </form>
      )}

      {[...rounds].reverse().map((round) => (
        <div key={`${round.round}-${round.draft}`} className="check-round">
          <h3>{versionLabel(round.round, round.draft)}{round.current ? ' · current PDF' : ''}</h3>
          <ul>
            {round.checks.map((c) => {
              const meta = c.decision === 'approve' ? { cls: 'ok', icon: <CheckCircle size={16} weight="fill" />, label: 'Approved' }
                : c.decision === 'changes' ? { cls: 'no', icon: <Warning size={16} weight="fill" />, label: 'Changes requested' }
                  : { cls: '', icon: <Circle size={16} />, label: 'Not checked yet' }
              return (
                <li key={c.user_id} className={meta.cls}>
                  {meta.icon}
                  <div>
                    <span><strong>{c.name}{String(c.user_id) === String(viewerId) ? ' (you)' : ''}</strong> · {meta.label}{c.updated_at ? ` · ${timeAgo(c.updated_at)}` : ''}</span>
                    {c.comment && <p>{c.comment}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}

function PublishPanel({ paper, onDone }) {
  const [state, setState] = useState({ saving: false, error: '' })
  const publish = async () => {
    if (!window.confirm(`Publish "${paper.title}" for everyone? It will appear under Papers and in the feed, and can no longer be withdrawn.`)) return
    setState({ saving: true, error: '' })
    try {
      await api(`/papers/${paper.id}/publish`, { method: 'POST' })
      onDone()
    } catch (err) {
      setState({ saving: false, error: err.message })
    }
  }
  return (
    <div className="publish-panel ok">
      <div className="publish-panel-text">
        <strong>Ready to publish</strong>
        <p>A moderator verified and approved this paper. Publish it so everyone can read it.</p>
      </div>
      <button type="button" className="btn btn-primary publish-btn" onClick={publish} disabled={state.saving}><PaperPlaneTilt size={16} /> {state.saving ? 'Publishing…' : 'Publish for everyone'}</button>
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
    </div>
  )
}

function CoauthorUpdateForm({ paper, onDone }) {
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState({ saving: false, error: '' })
  const current = (paper.coauthor_checks ?? []).find((r) => r.current)
  const requests = current?.checks.filter((c) => c.decision === 'changes') ?? []
  const submit = async (event) => {
    event.preventDefault()
    if (!file) return setState({ saving: false, error: 'Choose the corrected PDF' })
    const body = new FormData()
    body.append('pdf', file)
    body.append('note', note)
    setState({ saving: true, error: '' })
    try {
      await api(`/papers/${paper.id}/coauthor-update`, { method: 'POST', body })
      onDone()
    } catch (err) {
      setState({ saving: false, error: err.message })
    }
  }
  return (
    <form id="corrected-pdf" className="panel review-section coauthor-update" onSubmit={submit}>
      <h2><UploadSimple size={18} /> Upload a corrected PDF</h2>
      {requests.length > 0
        ? <div className="change-requests">{requests.map((r) => <p key={r.user_id}><strong>{r.name}:</strong> {r.comment}</p>)}</div>
        : <p className="muted-sm">You can replace the PDF while your co-authors are checking it.</p>}
      <p className="muted-sm">Your co-authors are asked to check the new draft. Earlier drafts stay under Versions.</p>
      {state.error && <p className="alert" role="alert">{state.error}</p>}
      <div className="field">
        <label htmlFor="cu-pdf">Corrected PDF</label>
        <input id="cu-pdf" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <small className="field-hint">{file.name} · {formatSize(file.size)}</small>}
      </div>
      <div className="field">
        <label htmlFor="cu-note">What did you change?</label>
        <textarea id="cu-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: shortened Figure 2 caption and rewrote the limitations section." />
      </div>
      <div className="form-actions"><button className="btn btn-primary" disabled={state.saving}><UploadSimple size={16} /> {state.saving ? 'Uploading…' : 'Send to co-authors'}</button></div>
    </form>
  )
}

function ResubmitForm({ paper, onDone }) {
  const openSuggestions = paper.reviews
    .filter((r) => r.round === paper.round)
    .flatMap((r) => r.suggestions.filter((s) => s.status === 'open').map((s) => ({ ...s, reviewer_label: r.reviewer_label })))
  const [form, setForm] = useState({
    title: paper.title,
    abstract: paper.abstract,
    domain: paper.domain,
    doi: paper.doi ?? '',
    tags: (paper.tags ?? []).join(', '),
    additionalNotes: paper.additional_notes ?? '',
    authors: (paper.authors ?? []).map((a) => ({ ...(a.user_id && { user_id: a.user_id }), name: a.name ?? '', affiliation: a.affiliation ?? '' })),
    response_letter: '',
  })
  const [answers, setAnswers] = useState(() => Object.fromEntries(openSuggestions.map((s) => [s.id, { status: '', response: '' }])))
  const [file, setFile] = useState(null)
  const [state, setState] = useState({ saving: false, error: '', field: '' })
  const fileRef = useRef(null)
  const set = (name, value) => setForm((current) => ({ ...current, [name]: value }))
  const answered = Object.values(answers).filter((a) => a.status).length

  const submit = async (event) => {
    event.preventDefault()
    const body = new FormData()
    for (const key of ['title', 'abstract', 'domain', 'doi', 'additionalNotes', 'response_letter']) body.append(key, form[key])
    body.append('tags', JSON.stringify(form.tags.split(',').map((t) => t.trim()).filter(Boolean)))
    body.append('authors', JSON.stringify(form.authors.filter((a) => a.name.trim())))
    body.append('suggestion_responses', JSON.stringify(Object.entries(answers).map(([id, a]) => ({ id, ...a }))))
    if (file) body.append('pdf', file)
    setState({ saving: true, error: '', field: '' })
    try {
      await api(`/papers/${paper.id}/resubmit`, { method: 'POST', body })
      onDone()
    } catch (err) {
      setState({ saving: false, error: err.message, field: err.field ?? '' })
    }
  }

  return (
    <form id="resubmit" className="panel review-section resubmit-form" onSubmit={submit} noValidate>
      <h2>Revise and resubmit</h2>
      <p className="muted-sm">Update your paper, answer each reviewer suggestion and explain your changes. It then goes back to the reviewers as round {paper.round + 1}.</p>
      {state.error && <p className="alert" role="alert">{state.error}</p>}

      {openSuggestions.length > 0 && (
        <fieldset className={state.field === 'suggestion_responses' ? 'invalid' : ''}>
          <legend>Reviewer suggestions <span className="muted-sm">({answered} of {openSuggestions.length} answered)</span></legend>
          <ol className="answer-list">
            {openSuggestions.map((s) => {
              const answer = answers[s.id]
              const setAnswer = (patch) => setAnswers((current) => ({ ...current, [s.id]: { ...current[s.id], ...patch } }))
              return (
                <li key={s.id}>
                  <div className="answer-suggestion">
                    <span className="muted-sm">{s.reviewer_label}{s.section ? ` · ${s.section}` : ''}</span>
                    <p>{s.body}</p>
                  </div>
                  <div className="answer-choice" role="radiogroup" aria-label="Your answer">
                    <button type="button" role="radio" aria-checked={answer.status === 'addressed'} className={answer.status === 'addressed' ? 'on ok' : ''} onClick={() => setAnswer({ status: 'addressed' })}><CheckCircle size={15} /> Addressed</button>
                    <button type="button" role="radio" aria-checked={answer.status === 'declined'} className={answer.status === 'declined' ? 'on no' : ''} onClick={() => setAnswer({ status: 'declined' })}><XCircle size={15} /> Declined</button>
                  </div>
                  <textarea rows={2} maxLength={2000} value={answer.response} aria-label="Your response"
                    placeholder={answer.status === 'declined' ? 'Explain why you did not make this change (required)' : 'What did you change? (optional)'}
                    onChange={(e) => setAnswer({ response: e.target.value })} />
                </li>
              )
            })}
          </ol>
        </fieldset>
      )}

      <div className="field">
        <label htmlFor="r-letter">Response to reviewers</label>
        <textarea id="r-letter" rows={5} maxLength={10000} value={form.response_letter} aria-invalid={state.field === 'response_letter'}
          placeholder="Summarise the main changes in this version." onChange={(e) => set('response_letter', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="r-pdf">Revised PDF</label>
        <input id="r-pdf" ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-invalid={state.field === 'pdf'} />
        <small className="field-hint">{file ? `${file.name} · ${formatSize(file.size)}` : `Leave empty to keep ${paper.pdf_filename}. Max 10 MB.`}</small>
      </div>

      <details className="resubmit-details" open={['title', 'abstract', 'domain', 'doi', 'tags', 'authors', 'additionalNotes'].includes(state.field)}>
        <summary>Edit title, abstract and other details</summary>
        <div className="field"><label htmlFor="r-title">Title</label><input id="r-title" maxLength={300} value={form.title} onChange={(e) => set('title', e.target.value)} aria-invalid={state.field === 'title'} /></div>
        <div className="field"><label htmlFor="r-abstract">Abstract</label><textarea id="r-abstract" rows={8} value={form.abstract} onChange={(e) => set('abstract', e.target.value)} aria-invalid={state.field === 'abstract'} /></div>
        <div className="form-row">
          <div className="field"><label htmlFor="r-domain">Research domain</label><input id="r-domain" maxLength={120} value={form.domain} onChange={(e) => set('domain', e.target.value)} aria-invalid={state.field === 'domain'} /></div>
          <div className="field"><label htmlFor="r-doi">DOI (optional)</label><input id="r-doi" value={form.doi} onChange={(e) => set('doi', e.target.value)} aria-invalid={state.field === 'doi'} /></div>
        </div>
        <div className="field"><label htmlFor="r-tags">Keywords <span className="muted-sm">(comma separated)</span></label><input id="r-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} aria-invalid={state.field === 'tags'} /></div>
        <fieldset className={state.field === 'authors' ? 'invalid' : ''}>
          <legend>Authors <span className="muted-sm">(the same people review after review; you can update affiliations)</span></legend>
          {form.authors.map((author, index) => (
            <div className="form-row author-row fixed" key={index}>
              <strong>{author.name}</strong>
              <input aria-label={`${author.name} affiliation`} placeholder="Affiliation" value={author.affiliation} onChange={(e) => set('authors', form.authors.map((a, i) => (i === index ? { ...a, affiliation: e.target.value } : a)))} />
            </div>
          ))}
        </fieldset>
        <div className="field"><label htmlFor="r-notes">Notes for reviewers (optional)</label><textarea id="r-notes" rows={3} value={form.additionalNotes} onChange={(e) => set('additionalNotes', e.target.value)} /></div>
      </details>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={state.saving}><ArrowsClockwise size={16} /> {state.saving ? 'Resubmitting…' : `Resubmit for round ${paper.round + 1}`}</button>
      </div>
    </form>
  )
}

export function SubmissionFeedback({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [withdrawing, setWithdrawing] = useState('')
  const [data, setData] = useState({ id: null, paper: null, error: '', notice: '' })
  const load = useCallback((notice = '') => api(`/papers/${encodeURIComponent(id)}/feedback`)
    .then((paper) => setData({ id, paper, error: '', notice }))
    .catch((err) => setData({ id, paper: null, error: err.message, notice: '' })), [id])
  useEffect(() => { load() }, [load])

  const paper = data.id === id ? data.paper : null
  if (data.id === id && data.error) return <div className="page"><p className="alert" role="alert">{data.error}</p><Link to="/my-submissions">Back to My papers</Link></div>
  if (!paper) return <div className="page"><div className="panel empty" aria-busy="true">Loading feedback…</div></div>

  const rounds = [...new Set(paper.reviews.map((r) => r.round))].sort((a, b) => b - a)
  const withdraw = async () => {
    if (!window.confirm(`Withdraw "${paper.title}"? It is removed from peer review together with its reviews and earlier versions. This cannot be undone.`)) return
    setWithdrawing('busy')
    try {
      await api(`/papers/${paper.id}`, { method: 'DELETE' })
      navigate('/my-submissions', { replace: true })
    } catch (err) {
      setWithdrawing(err.message)
    }
  }
  const lastDecision = [...paper.history].reverse().find((h) => h.decision !== 'resubmitted')
  return (
    <div className="page">
      <Link to="/my-submissions" className="back-link"><ArrowLeft size={14} /> My papers</Link>
      <PageHeader title={paper.title} sub={`${paper.domain} · submitted ${formatDate(paper.created_at)}${paper.is_owner ? '' : ` by ${paper.submitter_name} · you are a co-author`}`} />
      {data.notice && <p className="notice" role="status"><CheckCircle size={16} weight="fill" /> {data.notice}</p>}

      <section className={`panel review-section status-banner ${paper.status}`}>
        <StatusTag status={paper.status} round={paper.round} />
        {paper.status === 'coauthor_check' && (() => {
          const current = (paper.coauthor_checks ?? []).find((r) => r.current)
          const approved = current?.checks.filter((c) => c.decision === 'approve').length ?? 0
          const total = current?.checks.length ?? 0
          const changes = current?.checks.some((c) => c.decision === 'changes')
          return paper.is_owner
            ? <><p>Waiting for your co-authors: <strong>{approved} of {total}</strong> approved this PDF. When all of them approve, it goes to peer review and moderator verification.{changes ? ' A co-author asked for changes, so upload a corrected PDF below.' : ''}</p>{changes && <a href="#corrected-pdf" className="btn btn-primary btn-sm">Upload corrected PDF</a>}</>
            : <p>{paper.submitter_name} is waiting for the co-authors to check this PDF ({approved} of {total} approved). Open it below, then approve it or request changes. When everyone approves, it goes to peer review and moderator verification.</p>
        })()}
        {['pending', 'under_review'].includes(paper.status) && <p>{paper.status === 'pending' ? 'Your paper is waiting for a moderator to verify it.' : 'A moderator is verifying your paper now.'} It is open for peer review (round {paper.round}). {paper.pending_review_count ? `${paper.pending_review_count} review${paper.pending_review_count === 1 ? '' : 's'} so far, ${paper.accept_count} recommending Accept.` : 'No peer reviews yet.'} It stays private until it is approved and published.</p>}
        {paper.can_publish && <PublishPanel key={`p-${paper.round}-${paper.draft}`} paper={paper} onDone={() => { window.scrollTo({ top: 0 }); load('Published. Your paper is now public and listed under Research papers.') }} />}
        {paper.status === 'revision_requested' && <><p>{paper.is_owner ? 'The reviewers asked for changes. Read their feedback below, then revise and resubmit.' : `The reviewers asked for changes. ${paper.submitter_name} will revise and resubmit the paper.`}</p>{paper.revision_note && <blockquote>{paper.revision_note}</blockquote>}{paper.is_owner && <a href="#resubmit" className="btn btn-primary btn-sm">Revise and resubmit</a>}</>}
        {paper.status === 'approved' && !paper.can_publish && <p>A moderator approved this paper. {paper.submitter_name} can now publish it for everyone.</p>}
        {paper.status === 'published' && <><p>Your paper passed review and is published.</p>{lastDecision?.comment && <blockquote>{lastDecision.comment}</blockquote>}<Link to={`/articles/${paper.id}`} className="btn btn-primary btn-sm">View published paper</Link></>}
        {paper.status === 'rejected' && <><p>Your paper was not accepted for publication.</p>{paper.rejection_reason && <blockquote>{paper.rejection_reason}</blockquote>}</>}
        {paper.is_owner && paper.status !== 'published' && (
          <div className="withdraw-row">
            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={withdraw} disabled={withdrawing === 'busy'}><Trash size={15} /> {withdrawing === 'busy' ? 'Withdrawing…' : 'Withdraw submission'}</button>
            {withdrawing && withdrawing !== 'busy' && <span className="field-error" role="alert">{withdrawing}</span>}
          </div>
        )}
      </section>

      <CoauthorChecks key={`${paper.id}-${paper.round}-${paper.draft}`} paper={paper} viewerId={user?.id} editable={paper.my_check_allowed} onSaved={() => load()} />
      {paper.is_owner && paper.status === 'coauthor_check' && <CoauthorUpdateForm key={`u-${paper.draft}`} paper={paper} onDone={() => { window.scrollTo({ top: 0 }); load('Corrected PDF sent. Your co-authors have been asked to check it again.') }} />}

      <RoundSummary summary={paper.summary} title={`Round ${paper.round} at a glance`} />

      {rounds.map((round) => (
        <section key={round} className="review-round">
          <h2>Round {round} reviews</h2>
          {paper.reviews.filter((r) => r.round === round).map((review) => <ReviewCard key={review.id} review={review} />)}
        </section>
      ))}

      {paper.status === 'revision_requested' && paper.is_owner && <ResubmitForm key={paper.round} paper={paper} onDone={() => { window.scrollTo({ top: 0 }); load((paper.coauthor_checks ?? []).length ? `Round ${paper.round + 1} sent to your co-authors. It goes back to peer review once they approve it.` : `Round ${paper.round + 1} submitted. Reviewers have been notified.`) }} />}

      <Versions paperId={paper.id} versions={paper.versions} />
      <History history={paper.history} />
    </div>
  )
}

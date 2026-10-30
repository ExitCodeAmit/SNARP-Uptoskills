// UI-only pages: they run on sample data from sample.js and save nothing yet
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Users, MapPin, Clock, FilePdf, Copy, Check, PaperPlaneRight, UploadSimple,
  Heart, ChatCircle, UsersThree, CalendarBlank, SealCheck, CaretDown, Plus, X,
} from '@phosphor-icons/react'
import { Avatar, PageHeader } from '../components/ui'
import { apa, bibtex } from '../cite'
import { COMMUNITIES, EVENTS, CONVERSATIONS, NOTIFICATIONS, FAQ } from '../sample'
import { api, apiBlob } from '../api'
import { SaveButton } from '../Saved'

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

function CommunityCard({ c }) {
  const [joined, setJoined] = useState(false)
  return (
    <article className="panel community">
      <div className={`community-band band-${c.color}`} />
      <span className={`tile tile-lg tile-${c.color}`}>{c.name[0]}</span>
      <h3>{c.name}</h3>
      <p className="muted-sm"><Users size={14} /> {c.members + (joined ? 1 : 0)} members</p>
      <p className="community-tagline">{c.tagline}</p>
      <button className={`btn btn-block ${joined ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => setJoined(!joined)}>
        {joined ? 'Joined' : 'Join community'}
      </button>
    </article>
  )
}

export function Communities() {
  return (
    <div className="page">
      <PageHeader title="Communities" sub="Find people working on the same problems as you." />
      <div className="card-grid">
        {COMMUNITIES.map((c) => <CommunityCard key={c.id} c={c} />)}
      </div>
    </div>
  )
}

export function Articles() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/papers/search?q=')
      .then(setPapers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])
  return (
    <div className="page">
      <PageHeader title="Research papers" sub="Papers approved by our moderators." />
      {error && <p className="alert" role="alert">{error}</p>}
      {loading ? <p className="muted-sm">Loading approved papers…</p> : null}
      <div className="stack">
        {papers.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}
      </div>
      {!loading && !error && papers.length === 0 && <div className="panel empty"><h3>No approved papers yet</h3><p>Approved submissions will appear here.</p></div>}
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
    <h3>{paper.title}</h3>
    <p className="article-authors">{authorNames.join(', ')}</p>
    <p className="article-abstract">{paper.abstract}</p>
    <div className="tag-row">{(paper.tags ?? []).map((tag) => <span key={tag} className="tag">#{tag}</span>)}</div>
    <div className="article-actions"><PaperPdf paperId={paper.id} /><SaveButton itemType="paper" itemId={paper.id} {...paper} />{paper.doi && <a className="btn btn-ghost btn-sm" href={`https://doi.org/${encodeURIComponent(paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}`} target="_blank" rel="noreferrer">DOI</a>}</div>
  </article>
}

function EventCard({ e }) {
  const [going, setGoing] = useState(false)
  return (
    <article className="panel event">
      <div className="event-date">
        <b>{e.day}</b>
        <span>{e.month}</span>
      </div>
      <div className="event-body">
        <span className="tag tag-orange">{e.kind}</span>
        <h3>{e.title}</h3>
        <p className="muted-sm">
          <Clock size={14} /> {e.time} <MapPin size={14} /> {e.place} <Users size={14} /> {e.going + (going ? 1 : 0)} going
        </p>
      </div>
      <button className={`btn ${going ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setGoing(!going)}>
        {going ? 'Registered' : 'Register'}
      </button>
    </article>
  )
}

export function Events() {
  return (
    <div className="page">
      <PageHeader title="Events" sub="Webinars, workshops and hackathons for students and researchers." />
      <div className="stack">
        {EVENTS.map((e) => <EventCard key={e.id} e={e} />)}
      </div>
    </div>
  )
}

export function Messages() {
  const [convos, setConvos] = useState(CONVERSATIONS)
  const [activeId, setActiveId] = useState(CONVERSATIONS[0].id)
  const [draft, setDraft] = useState('')
  const active = convos.find((c) => c.id === activeId)

  const open = (id) => {
    setActiveId(id)
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)))
  }

  const send = (e) => {
    e.preventDefault()
    if (!draft.trim()) return
    const msg = { mine: true, text: draft.trim(), time: 'Now' }
    setConvos((cs) => cs.map((c) => (c.id === activeId ? { ...c, messages: [...c.messages, msg] } : c)))
    setDraft('')
  }

  return (
    <div className="page page-wide">
      <PageHeader title="Messages" />
      <div className="panel inbox">
        <ul className="inbox-list">
          {convos.map((c) => (
            <li key={c.id}>
              <button className={`inbox-item ${c.id === activeId ? 'active' : ''}`} onClick={() => open(c.id)}>
                <Avatar name={c.name} />
                <span className="inbox-text">
                  <strong>{c.name}</strong>
                  <small>{c.messages.at(-1).text}</small>
                </span>
                {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
              </button>
            </li>
          ))}
        </ul>
        <section className="thread">
          <header className="thread-head">
            <Avatar name={active.name} size="sm" />
            <strong>{active.name}</strong>
          </header>
          <div className="thread-body">
            {active.messages.map((m, i) => (
              <div key={i} className={`bubble ${m.mine ? 'mine' : ''}`}>
                <p>{m.text}</p>
                <time>{m.time}</time>
              </div>
            ))}
          </div>
          <form className="thread-input" onSubmit={send}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${active.name}`} aria-label="Message" />
            <button className="btn btn-primary" disabled={!draft.trim()} aria-label="Send"><PaperPlaneRight size={18} /></button>
          </form>
        </section>
      </div>
    </div>
  )
}

const NOTIF_ICON = { review: SealCheck, like: Heart, community: UsersThree, event: CalendarBlank, comment: ChatCircle }

export function Notifications() {
  const [items, setItems] = useState(NOTIFICATIONS)
  return (
    <div className="page">
      <PageHeader title="Notifications">
        <button className="btn btn-ghost btn-sm" onClick={() => setItems(items.map((n) => ({ ...n, unread: false })))}>
          Mark all as read
        </button>
      </PageHeader>
      <ul className="panel notif-list">
        {items.map((n) => {
          const Icon = NOTIF_ICON[n.kind]
          return (
            <li key={n.id} className={`notif ${n.unread ? 'unread' : ''}`}>
              <span className={`notif-icon notif-${n.kind}`}><Icon size={18} weight="fill" /></span>
              <p>{n.text}</p>
              <time>{n.time}</time>
            </li>
          )
        })}
      </ul>
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
  const [papers, setPapers] = useState([])
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
      const result = await api(`/moderation/papers?status=${section}&page=${page}`)
      setPapers(result.papers); setTotal(result.total)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!canModerate) return
    let active = true
    const fetchPapers = async () => {
      try {
        const result = await api(`/moderation/papers?status=${section}&page=${page}`)
        if (active) { setPapers(result.papers); setTotal(result.total); setError('') }
      } catch (err) { if (active) setError(err.message) }
      finally { if (active) setLoading(false) }
    }
    fetchPapers()
    return () => { active = false }
  }, [section, canModerate, page])
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

  if (!canModerate) return <div className="page"><PageHeader title="Paper moderation" /><div className="panel empty"><h3>Access restricted</h3><p>This page is for Moderators and Admins.</p></div></div>
  return <div className="page">
    <PageHeader title="Paper moderation" sub={`${total} ${section === 'pending' ? 'awaiting review' : 'reviewed paper'}${total === 1 ? '' : 's'}.`} />
    <div className="chips">
      <button className={`chip ${section === 'pending' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setSection('pending') }}>Pending</button>
      <button className={`chip ${section === 'reviewed' ? 'active' : ''}`} onClick={() => { closeReview(); setLoading(true); setPage(1); setSection('reviewed') }}>Reviewed</button>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {loading ? <p className="muted-sm">Loading papers…</p> : <div className="stack">
      {papers.map((paper) => <article key={paper.id} className="panel mod-item">
        <div className="mod-info"><h3>{paper.title}</h3><p className="muted-sm">{paper.submitter_name} · {paper.domain} · submitted {new Date(paper.created_at).toLocaleString()}</p><p>{paper.abstract.slice(0, 220)}{paper.abstract.length > 220 ? '…' : ''}</p></div>
        <div className="mod-actions"><span className={`tag ${paper.status === 'approved' ? 'tag-teal' : paper.status === 'rejected' ? 'tag-orange' : 'tag-blue'}`}>{paper.status}</span><button className="btn btn-secondary btn-sm" onClick={() => review(paper.id)}>Review details</button></div>
      </article>)}
      {!papers.length && <div className="panel empty"><h3>{section === 'pending' ? 'Queue is clear' : 'No reviewed papers yet'}</h3></div>}
    </div>}
    {!loading && total > 20 && <div className="submit-actions"><button className="btn btn-ghost" onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }} disabled={page <= 1}>Previous</button><span className="muted-sm">Page {page} of {Math.ceil(total / 20)}</span><button className="btn btn-ghost" onClick={() => { setLoading(true); setPage((value) => Math.min(Math.ceil(total / 20), value + 1)) }} disabled={page >= Math.ceil(total / 20)}>Next</button></div>}
    {selected && <section className="panel form-panel paper-review">
      <div className="article-meta"><h2>{selected.title}</h2><button className="btn btn-ghost btn-sm" onClick={closeReview}>Close</button></div>
      <p className="muted-sm">Submitted by {selected.submitter_name} ({selected.submitter_email}) · {new Date(selected.created_at).toLocaleString()}</p>
      <p><strong>Domain:</strong> {selected.domain} · <strong>Authors:</strong> {(selected.authors ?? []).map((a) => a.name).join(', ')}</p>
      {selected.doi && <p><strong>DOI:</strong> {selected.doi}</p>}
      <div className="tag-row">{(selected.tags ?? []).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>
      <h3>Abstract</h3><p>{selected.abstract}</p>
      {selected.additional_notes && <><h3>Author notes</h3><p>{selected.additional_notes}</p></>}
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

export function Settings({ user }) {
  const [saved, setSaved] = useState(false)
  return (
    <div className="page">
      <PageHeader title="Settings" sub="Manage your profile and notification preferences." />
      {saved && <p className="notice">Saving settings is coming soon. Nothing was changed.</p>}
      <form className="panel form-panel" onSubmit={(e) => { e.preventDefault(); setSaved(true) }}>
        <h3 className="form-title">Profile</h3>
        <div className="settings-avatar">
          <Avatar name={user.name} size="lg" />
          <button type="button" className="btn btn-ghost btn-sm">Change photo</button>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="s-name">Full name</label>
            <input id="s-name" defaultValue={user.name} />
          </div>
          <div className="field">
            <label htmlFor="s-email">Email</label>
            <input id="s-email" defaultValue={user.email} disabled />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-aff">Affiliation</label>
          <input id="s-aff" placeholder="University or organisation" />
        </div>
        <div className="field">
          <label htmlFor="s-bio">Bio</label>
          <textarea id="s-bio" rows={3} placeholder="A line about your research interests" />
        </div>
        <h3 className="form-title">Notifications</h3>
        <Toggle label="Email me when my paper is reviewed" defaultOn />
        <Toggle label="Comments on my posts" defaultOn />
        <Toggle label="New members in my communities" />
        <button className="btn btn-primary">Save changes</button>
      </form>
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
  const [paperError, setPaperError] = useState('')
  useEffect(() => {
    if (!query.trim()) return
    let active = true
    api(`/papers/search?q=${encodeURIComponent(query)}`).then((result) => { if (active) setPapers(result) }).catch((err) => { if (active) setPaperError(err.message) })
    return () => { active = false }
  }, [query])
  const has = (...fields) => fields.join(' ').toLowerCase().includes(q)
  const communities = COMMUNITIES.filter((c) => has(c.name, c.tagline))
  const events = EVENTS.filter((e) => has(e.title, e.kind, e.place))
  const shownPapers = q ? papers : []
  const total = communities.length + shownPapers.length + events.length
  return (
    <div className="page">
      <PageHeader title={`Results for "${params.get('q') ?? ''}"`} sub={`${total} result${total === 1 ? '' : 's'}`} />
      {paperError && <p className="alert" role="alert">{paperError}</p>}
      {total === 0 && !paperError && <div className="panel empty"><h3>Nothing found</h3><p>Try a different word, like a topic or an author.</p></div>}
      {shownPapers.length > 0 && <><h2 className="section-title">Research papers</h2><div className="stack">{shownPapers.map((paper) => <PublishedPaperCard key={paper.id} paper={paper} />)}</div></>}
      {communities.length > 0 && <><h2 className="section-title">Communities</h2><div className="card-grid">{communities.map((c) => <CommunityCard key={c.id} c={c} />)}</div></>}
      {events.length > 0 && <><h2 className="section-title">Events</h2><div className="stack">{events.map((e) => <EventCard key={e.id} e={e} />)}</div></>}
      <p className="muted-sm search-foot"><Link to="/">Back to feed</Link></p>
    </div>
  )
}

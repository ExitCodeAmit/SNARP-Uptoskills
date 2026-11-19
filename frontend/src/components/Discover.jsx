import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Article, CaretDown, Compass, Hash, MagnifyingGlass, Sparkle, Tag } from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from './ui'

const topicLink = (item) => `/articles?${item.kind === 'domain' ? 'domain' : 'tag'}=${encodeURIComponent(item.topic)}`

const authorLine = (paper) => (paper.authors ?? [])
  .map((author) => typeof author === 'string' ? author : author?.name)
  .filter(Boolean)
  .slice(0, 3)
  .join(', ')

function useSuggestions(query) {
  const [state, setState] = useState({ q: '', data: null })
  const q = query.trim()
  useEffect(() => {
    if (q.length < 2) return
    let active = true
    const timer = setTimeout(() => {
      api(`/search/suggest?q=${encodeURIComponent(q)}`)
        .then((data) => { if (active) setState({ q, data }) })
        .catch(() => { if (active) setState({ q, data: { topics: [], papers: [], people: [] } }) })
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [q])
  return q.length >= 2 && state.q === q ? state.data : null
}

export function SuggestBox({ value, onChange, onSubmit, placeholder, id, className = '', showPeople = true, inputProps = {} }) {
  const navigate = useNavigate()
  const listId = useId()
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const data = useSuggestions(value)

  const options = data ? [
    ...data.topics.map((item) => ({ key: `t-${item.topic}`, group: 'Topics', icon: item.kind === 'domain' ? Compass : Hash, label: item.topic, hint: `${item.count} paper${item.count === 1 ? '' : 's'}`, to: topicLink(item) })),
    ...data.papers.map((paper) => ({ key: `p-${paper.id}`, group: 'Papers', icon: Article, label: paper.title, hint: paper.domain, to: `/articles/${paper.id}` })),
    ...(showPeople ? data.people.map((person) => ({ key: `u-${person.id}`, group: 'Researchers', person, label: person.name, hint: person.institution, to: `/users/${person.id}` })) : []),
  ] : []

  useEffect(() => {
    if (!open) return
    const close = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const go = (option) => {
    setOpen(false)
    setActive(-1)
    navigate(option.to)
  }
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); return }
    if (!options.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((i) => (i + 1) % options.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)) }
    else if (event.key === 'Enter' && open && active >= 0) { event.preventDefault(); go(options[active]) }
  }

  const showList = open && value.trim().length >= 2 && data
  let lastGroup = ''
  return (
    <div className={`suggest ${className}`} ref={wrapRef}>
      <input
        {...inputProps}
        id={id}
        type="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={Boolean(showList)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="suggest-list" id={listId} role="listbox">
          {options.length === 0 && <p className="suggest-empty">No quick matches. Press Enter to search everything.</p>}
          {options.map((option, index) => {
            const heading = option.group !== lastGroup ? option.group : ''
            lastGroup = option.group
            const Icon = option.icon
            return (
              <div key={option.key}>
                {heading && <p className="suggest-group">{heading}</p>}
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`suggest-item ${index === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(option)}
                >
                  {option.person ? <Avatar name={option.person.name} src={option.person.avatar_url} size="sm" /> : <Icon size={16} />}
                  <span className="suggest-label">{option.label}</span>
                  {option.hint && <span className="suggest-hint">{option.hint}</span>}
                </button>
              </div>
            )
          })}
          {onSubmit && (
            <button type="button" className="suggest-item suggest-all" onClick={() => { setOpen(false); onSubmit() }}>
              <MagnifyingGlass size={16} /><span className="suggest-label">Search for "{value.trim()}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RecommendedCard({ paper }) {
  return (
    <article className="rec-card">
      <div className="rec-card-top"><span className="tag">{paper.domain}</span></div>
      <h3><Link to={`/articles/${paper.id}`}>{paper.title}</Link></h3>
      {authorLine(paper) && <p className="rec-authors">{authorLine(paper)}</p>}
      <p className="rec-abstract">{paper.abstract}</p>
      <p className="rec-reason"><Sparkle size={13} weight="fill" /> {paper.reasons?.[0] ?? paper.reason}</p>
    </article>
  )
}

export function TopicChips({ topics, title = 'Topics to explore', note }) {
  if (!topics?.length) return null
  return (
    <div className="topic-explore">
      <p className="topic-explore-title"><Compass size={15} /> {title}</p>
      {note && <p className="muted-sm">{note}</p>}
      <div className="topic-chips">
        {topics.map((item) => (
          <Link key={`${item.kind}-${item.topic}`} to={topicLink(item)} className="topic-chip" title={item.because ? `Often found with ${item.because}` : undefined}>
            {item.kind === 'domain' ? <Compass size={13} /> : <Tag size={13} />}{item.topic}
          </Link>
        ))}
      </div>
    </div>
  )
}

const RECS_KEY = 'snarp-recs-open'
function readRecsOpen() {
  try { return localStorage.getItem(RECS_KEY) !== 'closed' } catch { return true }
}

export function Recommendations() {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [open, setOpen] = useState(readRecsOpen)
  const toggle = () => {
    setOpen((current) => {
      try { localStorage.setItem(RECS_KEY, current ? 'closed' : 'open') } catch {}
      return !current
    })
  }
  useEffect(() => {
    let active = true
    api('/papers/recommendations?limit=6')
      .then((data) => { if (active) setState({ loading: false, data, error: '' }) })
      .catch((err) => { if (active) setState({ loading: false, data: null, error: err.message }) })
    return () => { active = false }
  }, [])

  if (state.loading) return <section className="panel recs" aria-busy="true"><p className="muted-sm">Finding papers for you…</p></section>
  if (state.error || !state.data) return null
  const { items, topics, basedOn, personalised, hasInterests } = state.data
  if (!items.length && !topics.length) return null

  return (
    <section className={`panel recs recs-fold ${open ? 'open' : ''}`} aria-labelledby="recs-title">
      <header className="recs-head">
        <button type="button" className="recs-toggle" onClick={toggle} aria-expanded={open} aria-controls="recs-body">
          <span>
            <h2 id="recs-title"><Sparkle size={18} weight="fill" /> {personalised ? 'Recommended for you' : 'Popular papers to start with'}<span className="recs-count">{items.length}</span></h2>
            {personalised && basedOn.length > 0
              ? <span className="muted-sm">Based on {basedOn.slice(0, 4).join(', ')}</span>
              : <span className="muted-sm">Like or save papers and follow researchers to get picks for you.</span>}
          </span>
          <span className="recs-caret"><CaretDown size={16} weight="bold" /></span>
        </button>
        {!hasInterests && open && <Link to="/settings" className="btn btn-ghost btn-sm">Add research interests</Link>}
      </header>
      {open && <div id="recs-body" className="recs-body">
        {items.length > 0 && <div className="rec-grid">{items.map((paper) => <RecommendedCard key={paper.id} paper={paper} />)}</div>}
        <TopicChips topics={topics} title={personalised ? 'Related topics you have not explored yet' : 'Topics on SNARP'} />
      </div>}
    </section>
  )
}

export function RelatedPapers({ paperId }) {
  const [result, setResult] = useState({ id: null, items: [] })
  useEffect(() => {
    let active = true
    api(`/papers/${encodeURIComponent(paperId)}/related`)
      .then((items) => { if (active) setResult({ id: paperId, items }) })
      .catch(() => { if (active) setResult({ id: paperId, items: [] }) })
    return () => { active = false }
  }, [paperId])
  const items = result.id === paperId ? result.items : []
  if (!items.length) return null
  return (
    <section className="panel recs" aria-labelledby="related-title">
      <header className="recs-head"><h2 id="related-title"><Article size={18} /> Related papers</h2></header>
      <div className="rec-grid">{items.map((paper) => <RecommendedCard key={paper.id} paper={paper} />)}</div>
    </section>
  )
}

export function QueryTopics({ query }) {
  const data = useSuggestions(query)
  const current = query.trim().toLowerCase()
  const topics = (data?.topics ?? []).filter((item) => item.topic.toLowerCase() !== current)
  if (!topics.length) return null
  return <TopicChips topics={topics} title="Related topics" />
}


import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowClockwise, ArrowUp, Question, Sparkle, Stop, X } from '@phosphor-icons/react'
import { api, getToken } from '../api'

const STORE = 'snarp-guide-chat'
const MAX_INPUT = 2000

const SUGGESTIONS = [
  { match: (p) => p.startsWith('/reels'), items: ['How do I make a reel?', 'How do I trim my video and pick a cover?', 'How can I hide likes on my reel?'] },
  { match: (p) => p.startsWith('/submit') || p.startsWith('/my-submissions'), items: ['What happens after I submit a paper?', 'How do I add co-authors?', 'What do the submission statuses mean?'] },
  { match: (p) => p.startsWith('/reviews') || p.startsWith('/moderator'), items: ['How does peer review work?', 'How do I request a revision?', 'Who can publish a paper?'] },
  { match: (p) => p.startsWith('/articles') || p.startsWith('/saved'), items: ['How do I find papers on a topic?', 'How do I save a paper?', 'How do I cite a paper?'] },
  { match: (p) => p.startsWith('/docs'), items: ['How do I invite someone to my document?', 'Can two people edit at the same time?', 'How do I save a document as PDF?'] },
  { match: (p) => p.startsWith('/messages'), items: ['How do I start a conversation?', 'Can I share a reel in a message?', 'Where do I see unread messages?'] },
  { match: (p) => p.startsWith('/communities') || p.startsWith('/events') || p.startsWith('/tools'), items: ['How do I create a community?', 'How do I register for an event?', 'What tools are available?'] },
  { match: (p) => p.startsWith('/settings'), items: ['How do I change my password?', 'How do I switch to dark mode?', 'How do I sign out of other devices?'] },
  { match: (p) => p.startsWith('/users'), items: ['How do I follow someone?', 'Who counts as a friend?', 'How do I message this person?'] },
  { match: () => true, items: ['What can I do on SNARP?', 'How do I share a story only with friends?', 'How do I submit a research paper?'] },
]

function readStore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || '[]')
    return Array.isArray(saved) ? saved.filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role)).slice(-30) : []
  } catch { return [] }
}

// Small, safe markdown: **bold**, _italic_, `code`, [label](link), numbered and bulleted lists.
function Inline({ text, onNavigate }) {
  const parts = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])_[^_]+_(?!\w))/g
  let last = 0
  let match
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) parts.push(<code key={match.index}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('_')) parts.push(<em key={match.index}>{token.slice(1, -1)}</em>)
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      if (/^\/(?!\/)/.test(href)) parts.push(<Link key={match.index} to={href} onClick={onNavigate}>{label}</Link>)
      else if (/^(https:\/\/|mailto:|tel:)/i.test(href)) parts.push(<a key={match.index} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)
      else parts.push(label)
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)
}

function Markdown({ text, onNavigate }) {
  const blocks = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (numbered) {
      if (last?.type === 'ol') last.items.push(numbered[2])
      else blocks.push({ type: 'ol', start: Number(numbered[1]), items: [numbered[2]] })
    } else if (bullet) {
      if (last?.type === 'ul') last.items.push(bullet[1])
      else blocks.push({ type: 'ul', items: [bullet[1]] })
    } else if (!line.trim()) {
      blocks.push({ type: 'gap' })
    } else {
      const clean = line.replace(/^#{1,6}\s+/, '')
      if (last?.type === 'p') last.lines.push(clean)
      else blocks.push({ type: 'p', lines: [clean] })
    }
  }
  return blocks.map((block, i) => {
    if (block.type === 'ol') return <ol key={i} start={block.start}>{block.items.map((item, j) => <li key={j}><Inline text={item} onNavigate={onNavigate} /></li>)}</ol>
    if (block.type === 'ul') return <ul key={i}>{block.items.map((item, j) => <li key={j}><Inline text={item} onNavigate={onNavigate} /></li>)}</ul>
    if (block.type === 'p') return <p key={i}>{block.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} onNavigate={onNavigate} /></Fragment>)}</p>
    return null
  })
}

export default function Assistant({ user }) {
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(readStore)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const firstName = String(user?.name ?? '').trim().split(/\s+/)[0]
  const suggestions = SUGGESTIONS.find((group) => group.match(pathname)).items

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))) } catch { /* private mode */ }
  }, [messages])

  useEffect(() => {
    if (!open || enabled !== null) return undefined
    let active = true
    api('/assistant/status').then((s) => { if (active) setEnabled(s.enabled) }).catch(() => { if (active) setEnabled(true) })
    return () => { active = false }
  }, [open, enabled])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (!open) return undefined
    const key = (event) => {
      if (event.key === 'Escape' && !document.documentElement.classList.contains('overlay-open')) setOpen(false)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  const ask = async (question) => {
    const text = question.trim()
    if (!text || busy) return
    setError('')
    setDraft('')
    const history = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '', pending: true }])
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const token = getToken()
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), page: pathname + search }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'The guide could not answer right now. Please try again.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let answer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        answer += decoder.decode(value, { stream: true })
        const current = answer
        setMessages((list) => [...list.slice(0, -1), { role: 'assistant', content: current, pending: true }])
      }
      setMessages((list) => [...list.slice(0, -1), { role: 'assistant', content: answer.trim() || 'Sorry, I could not answer that. Please try asking another way.' }])
    } catch (err) {
      setMessages((list) => {
        const last = list[list.length - 1]
        if (last?.pending && last.content) return [...list.slice(0, -1), { role: 'assistant', content: last.content }]
        return list.slice(0, -1)
      })
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      abortRef.current = null
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setMessages([])
    setError('')
    inputRef.current?.focus()
  }

  const closeOnSmall = () => { if (window.matchMedia('(max-width: 680px)').matches) setOpen(false) }

  return (
    <>
      {!open && (
        <button type="button" className="guide-fab" onClick={() => setOpen(true)} aria-label="Open SNARP Guide, the help assistant" title="Ask SNARP Guide">
          <Sparkle size={24} weight="fill" />
        </button>
      )}
      {open && (
        <section className="guide-panel" role="dialog" aria-label="SNARP Guide" aria-modal="false">
          <header className="guide-head">
            <span className="guide-mark" aria-hidden="true"><Sparkle size={18} weight="fill" /></span>
            <span className="guide-title">
              <strong>SNARP Guide</strong>
              <small>Ask how anything on SNARP works</small>
            </span>
            {messages.length > 0 && (
              <button type="button" className="icon-btn" onClick={reset} aria-label="Start a new chat" title="New chat"><ArrowClockwise size={18} /></button>
            )}
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close SNARP Guide" title="Close"><X size={18} /></button>
          </header>

          <div className="guide-body" ref={listRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="guide-welcome">
                <p className="guide-hello">Hi{firstName ? ` ${firstName}` : ''}! I can walk you through any part of SNARP: posts, stories, reels, papers, peer review, messages, communities and settings.</p>
                <p className="guide-try">Try asking</p>
                <ul className="guide-suggestions">
                  {suggestions.map((item) => (
                    <li key={item}><button type="button" onClick={() => ask(item)} disabled={busy || enabled === false}>{item}</button></li>
                  ))}
                </ul>
              </div>
            ) : messages.map((message, i) => (
              <div key={i} className={`guide-msg guide-${message.role}`}>
                {message.role === 'assistant' ? (
                  message.content
                    ? <div className="guide-md"><Markdown text={message.content} onNavigate={closeOnSmall} /></div>
                    : <span className="guide-typing" aria-label="SNARP Guide is typing"><i /><i /><i /></span>
                ) : <p>{message.content}</p>}
              </div>
            ))}
            {enabled === false && <p className="guide-note">The guide is not switched on for this server yet. You can still read the <Link to="/help" onClick={closeOnSmall}>Help page</Link>.</p>}
            {error && <p className="guide-error" role="alert">{error}</p>}
          </div>

          <form className="guide-form" onSubmit={(event) => { event.preventDefault(); ask(draft) }}>
            <label className="sr-only" htmlFor="guide-input">Ask SNARP Guide</label>
            <textarea
              id="guide-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_INPUT}
              placeholder="Ask about any feature…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(draft) }
              }}
              disabled={enabled === false}
            />
            {busy ? (
              <button type="button" className="guide-send" onClick={() => abortRef.current?.abort()} aria-label="Stop answering" title="Stop"><Stop size={16} weight="fill" /></button>
            ) : (
              <button type="submit" className="guide-send" disabled={!draft.trim() || enabled === false} aria-label="Send" title="Send"><ArrowUp size={18} weight="bold" /></button>
            )}
          </form>
          <footer className="guide-foot">
            <Link to="/help" onClick={closeOnSmall}><Question size={14} /> Help &amp; FAQ</Link>
            <span>Answers are AI-generated and can be wrong.</span>
          </footer>
        </section>
      )}
    </>
  )
}

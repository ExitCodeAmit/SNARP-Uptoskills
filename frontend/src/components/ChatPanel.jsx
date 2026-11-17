import { useEffect, useRef, useState } from 'react'
import { Avatar, PageHeader } from '../components/ui'
import { api } from '../api'
import { ChatCircle, Image, Paperclip, X } from '@phosphor-icons/react'

const PREVIEW_STORAGE_KEY = 'snarp-chat-preview'

function previewReply(message) {
  const text = message.toLowerCase()
  if (/\b(hello|hi|hey)\b/.test(text)) {
    return 'Hi! I’m Helix, your UptoSkills AI assistant. Ask me about research, papers, or student life.'
  }
  if (/research|paper|academic|study|citation|doi/.test(text)) {
    return 'A good place to start is by narrowing your topic into one focused question. Then search recent papers using a few specific keywords, compare their methods and findings, and keep track of each source as you read. If you share your topic, I can help you make the question more specific.'
  }
  if (/career|internship|resume|cv|job/.test(text)) {
    return 'For a strong next step, describe the role you want and the experience you already have. I can help you identify relevant skills, improve a resume bullet, or plan an internship search.'
  }
  return `Thanks for your question. I’m running in local preview mode, so this demo reply is generated in your browser and doesn’t contact an AI service. Your message was: “${message}”`
}

function readPreviewMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function SourcePicker({ sources, setSources }) {
  const imageInput = useRef(null)
  const fileInput = useRef(null)

  const addSources = (event) => {
    const files = Array.from(event.currentTarget.files || [])
    setSources((current) => [
      ...current,
      ...files.map((file) => ({ id: crypto.randomUUID(), file })),
    ])
    event.currentTarget.value = ''
  }

  return (
    <div className="source-picker">
      <input ref={imageInput} className="sr-only" type="file" accept="image/*" multiple onChange={addSources} aria-label="Choose images" />
      <input ref={fileInput} className="sr-only" type="file" multiple onChange={addSources} aria-label="Choose files" />
      <div className="source-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => imageInput.current?.click()}>
          <Image size={16} /> Add images
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
          <Paperclip size={16} /> Add files
        </button>
      </div>
      {sources.length > 0 && (
        <ul className="source-list" aria-label="Selected sources">
          {sources.map(({ id, file }) => (
            <li className="source-chip" key={id}>
              {file.type.startsWith('image/') ? <Image size={15} /> : <Paperclip size={15} />}
              <span title={file.name}>{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSources((current) => current.filter((source) => source.id !== id))}>
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="source-note">Source selection is frontend-only; file contents are not uploaded to Helix yet.</p>
    </div>
  )
}

function ChatPanel({ initialSession, preview = false }) {
  const [messages, setMessages] = useState(() => preview ? readPreviewMessages() : [])
  const [draft, setDraft] = useState('')
  const [sources, setSources] = useState([])
  const [sessionId, setSessionId] = useState(preview ? 'local-preview' : (initialSession || null))
  const [loading, setLoading] = useState(!preview)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (preview) {
      setLoading(false)
    } else if (sessionId) {
      api(`/chat/${sessionId}`).then((msgs) => {
        setMessages(msgs)
        setLoading(false)
      })
    } else {
      setLoading(false)
    }
  }, [sessionId, preview])

  useEffect(() => {
    if (preview) localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(messages))
  }, [messages, preview])

  const send = async (e) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setDraft('')
    setSending(true)
    if (preview) {
      const now = new Date().toISOString()
      setMessages((current) => [
        ...current,
        { role: 'user', content, created_at: now },
        { role: 'assistant', content: previewReply(content), created_at: new Date().toISOString() },
      ])
    } else {
      try {
        await api('/chat', { method: 'POST', body: { sessionId, role: 'user', content } })
        const result = await api('/chat/ai', { method: 'POST', body: { message: content } })
        if (result.response) {
          const msgs = await api(`/chat/${sessionId}`)
          setMessages(msgs)
        }
      } catch (err) {
        setMessages((current) => [...current, {
          role: 'assistant', content: `I couldn’t reach the assistant: ${err.message}`, created_at: new Date().toISOString(),
        }])
      }
    }
    setSending(false)
  }

  const createNew = async (content) => {
    if (preview) {
      const now = new Date().toISOString()
      setSessionId('local-preview')
      setMessages([
        { role: 'user', content, created_at: now },
        { role: 'assistant', content: previewReply(content), created_at: new Date().toISOString() },
      ])
      return
    }
    const result = await api('/chat', { method: 'POST', body: { sessionId: null, role: 'user', content } })
    setSessionId(result.session_id)
    setMessages([{ role: 'user', content, created_at: result.created_at }])
    setDraft('')
  }

  return (
    <div className="page page-wide">
      <PageHeader title="Helix AI Assistant" />
      <div className="panel">
        {preview && <p className="muted-sm" role="status">Local preview mode · messages stay in this browser; responses are demo replies.</p>}
        {loading ? (
          <p className="muted-sm">Loading messages…</p>
        ) : sessionId ? (
          <div className="thread">
            <header className="thread-head">
              <Avatar name="Helix AI Assistant" size="sm" />
              <strong>Helix AI Assistant</strong>
            </header>
            <div className="thread-body">
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role === 'user' || m.role === 'mine' ? 'mine' : ''}`}>
                  <p>{m.content}</p>
                  <time>{m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</time>
                </div>
              ))}
            </div>
            <div className="thread-composer">
              <SourcePicker sources={sources} setSources={setSources} />
              <form className="thread-input" onSubmit={send}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message Helix…"
                  aria-label="Message"
                  disabled={sending}
                />
                <button className="btn btn-primary" disabled={!draft.trim() || sending} aria-label="Send">
                  <ChatCircle size={18} /> Send
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <X size={48} className="muted-sm" />
            <h3>Start a new conversation</h3>
            <p>Enter a message below to begin chatting with Helix.</p>
            <SourcePicker sources={sources} setSources={setSources} />
            <form className="start-chat" onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.querySelector('input')
              const content = input?.value.trim()
              if (content) {
                createNew(content)
                input.value = ''
              }
            }}>
              <input type="text" placeholder="Say hello…" aria-label="Start chat" />
              <button type="submit" className="btn btn-primary">Start Chat</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatPanel

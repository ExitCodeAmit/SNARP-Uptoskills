import { useEffect, useState } from 'react'
import { Avatar, PageHeader } from '../components/ui'
import { api } from '../api'
import { ChatCircle, X } from '@phosphor-icons/react'

function ChatPanel({ initialSession }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sessionId, setSessionId] = useState(initialSession || null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (sessionId) {
      api(`/chat/${sessionId}`).then((msgs) => {
        setMessages(msgs)
        setLoading(false)
      })
    } else {
      setMessages([])
      setLoading(false)
    }
  }, [sessionId])

  const send = async (e) => {
    e.preventDefault()
    if (!draft.trim()) return
    await api('/chat', {
      method: 'POST',
      body: { sessionId, role: 'user', content: draft.trim() },
    })
    setDraft('')
    if (sessionId) {
      api(`/chat/${sessionId}`).then((msgs) => setMessages(msgs))
    }
  }

  const createNew = async () => {
    const result = await api('/chat', {
      method: 'POST',
      body: { sessionId: null, role: 'user', content: draft.trim() },
    })
    setSessionId(result.session_id)
    setMessages([{ role: 'user', content: draft.trim(), created_at: result.created_at }])
    setDraft('')
  }

  return (
    <div className="page page-wide">
      <PageHeader title="AI Chat" />
      <div className="panel">
        {loading ? (
          <p className="muted-sm">Loading messages…</p>
        ) : sessionId ? (
          <div className="thread">
            <header className="thread-head">
              <Avatar name={null} size="sm" />
              <strong>AI Assistant</strong>
            </header>
            <div className="thread-body">
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role === 'mine' ? 'mine' : ''}`}>
                  <p>{m.content}</p>
                  <time>{m.created_at}</time>
                </div>
              ))}
            </div>
            <form className="thread-input" onSubmit={send}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message…"
                aria-label="Message"
              />
              <button className="btn btn-primary" disabled={!draft.trim()} aria-label="Send">
                <ChatCircle size={18} /> Send
              </button>
            </form>
          </div>
        ) : (
          <div className="empty-state">
            <X size={48} className="muted-sm" />
            <h3>Start a new conversation</h3>
            <p>Enter a message below to begin chatting with the AI assistant.</p>
            <form className="start-chat" onSubmit={(e) => {
              e.preventDefault()
              const input = e.target.querySelector('input')
              if (input && input.value.trim()) {
                createNew()
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
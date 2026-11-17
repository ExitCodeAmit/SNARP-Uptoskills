import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowClockwise, Copy, PencilSimple, PaperPlaneRight, Plus, Trash } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { Avatar, PageHeader } from '../components/ui'
import useChat from '../useChat'

function ChatMessage({ message, onRetry }) {
  const [copied, setCopied] = useState(false)
  const isAssistant = message.role === 'assistant'
  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <article className={`chat-message ${isAssistant ? 'assistant' : 'user'}`}>
      <div className="chat-message-content">
        {isAssistant ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p>{message.content}</p>}
        {isAssistant && message.sources?.length > 0 && (
          <div className="chat-message-sources">
            <strong>Sources</strong>
            {message.sources.map((source) => (
              <Link key={source.paperId} to={`/articles#paper-${encodeURIComponent(source.paperId)}`}>
                {source.title}
              </Link>
            ))}
          </div>
        )}
        {isAssistant && (
          <button type="button" className="chat-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy response'} title={copied ? 'Copied' : 'Copy response'}>
            {copied ? 'Copied' : <Copy size={16} />}
          </button>
        )}
        {message.status === 'failed' && (
          <button type="button" className="chat-retry" onClick={() => onRetry(message)}>
            <ArrowClockwise size={15} /> Retry
          </button>
        )}
        {message.status === 'error' && <p className="chat-inline-error">Not saved. Send again to retry.</p>}
      </div>
    </article>
  )
}

export default function ChatPage() {
  const {
    sessions,
    activeSession,
    activeSessionId,
    messages,
    loadingSessions,
    loadingMessages,
    sending,
    sendError,
    loadError,
    setSendError,
    openSession,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    retryMessage,
  } = useChat()
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  const send = async (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setSendError('')
    await sendMessage(text)
  }

  const rename = async (session) => {
    const title = window.prompt('Rename chat', session.title)
    if (title === null || !title.trim()) return
    try {
      await renameSession(session.id, title.trim())
    } catch (error) {
      setSendError(error.message)
    }
  }

  const remove = async (session) => {
    if (!window.confirm(`Delete “${session.title}” and its messages?`)) return
    try {
      await deleteSession(session.id)
    } catch (error) {
      setSendError(error.message)
    }
  }

  return (
    <div className="page page-wide chat-page">
      <PageHeader title="Chat" sub="Your conversations are saved to your account." />
      <div className="chat-layout">
        <aside className="panel chat-sidebar" aria-label="Chat history">
          <button type="button" className="btn btn-primary chat-new" onClick={() => createSession().catch((error) => setSendError(error.message))}>
            <Plus size={18} weight="bold" /> New chat
          </button>
          <div className="chat-session-list">
            {loadingSessions && <p className="muted-sm chat-session-state">Loading chats…</p>}
            {!loadingSessions && sessions.length === 0 && <p className="muted-sm chat-session-state">No conversations yet.</p>}
            {sessions.map((session) => (
              <div key={session.id} className={`chat-session ${session.id === activeSessionId ? 'active' : ''}`}>
                <button type="button" className="chat-session-open" onClick={() => openSession(session.id).catch((error) => setSendError(error.message))}>
                  <span>{session.title || 'New chat'}</span>
                  {session.paper_title && <small>{session.paper_title}</small>}
                  <time>{new Date(session.updated_at).toLocaleDateString()}</time>
                </button>
                <div className="chat-session-actions">
                  <button type="button" className="icon-btn" aria-label={`Rename ${session.title}`} title="Rename chat" onClick={() => rename(session)}>
                    <PencilSimple size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${session.title}`} title="Delete chat" onClick={() => remove(session)}>
                    <Trash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="panel chat-workspace" aria-label="Conversation">
          <header className="thread-head chat-current-head">
            <Avatar name="Helix AI Assistant" size="sm" />
            <div>
              <strong>{activeSession?.title || 'New chat'}</strong>
              <p className="muted-sm">{activeSession?.paper_title || 'Research assistant'}</p>
            </div>
          </header>
          <div className="thread-body chat-transcript" aria-live="polite" aria-busy={loadingMessages || sending}>
            {loadingMessages && <p className="muted-sm chat-session-state">Loading conversation…</p>}
            {!loadingMessages && messages.length === 0 && (
              <p className="paper-chat-empty">Ask a question to start this conversation.</p>
            )}
            {messages.map((message) => <ChatMessage key={message.id} message={message} onRetry={retryMessage} />)}
            {sending && <p className="muted-sm chat-loading" role="status">Thinking…</p>}
            <div ref={endRef} />
          </div>
          {(loadError || sendError) && <p className="alert paper-chat-error" role="alert">{sendError || loadError}</p>}
          <form className="thread-input paper-chat-input chat-composer" onSubmit={send}>
            <label htmlFor="chat-question" className="sr-only">Message</label>
            <textarea
              id="chat-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a message…"
              maxLength={500}
              rows={2}
              disabled={sending}
            />
            <span className="muted-sm question-count">{draft.length}/500</span>
            <button type="submit" className="btn btn-primary" disabled={!draft.trim() || sending} aria-label="Send message">
              <PaperPlaneRight size={18} />
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
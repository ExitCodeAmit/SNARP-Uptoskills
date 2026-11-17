import { useEffect, useState } from 'react'
import { api } from './api'
import ChatContext from './chatContext'

const lastSessionKey = (userId) => `snarp:lastChatSession:${userId}`

export function ChatProvider({ user, children }) {
  const userId = user?.id ? String(user.id) : null
  const [sessionData, setSessionData] = useState({ ownerId: null, sessions: [] })
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messageData, setMessageData] = useState({ ownerId: null, sessionId: null, messages: [] })
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!userId) return undefined

    let active = true
    async function loadSessions() {
      try {
        const sessions = await api('/chat/sessions')
        if (!active) return

        setLoadError('')
        setSessionData({ ownerId: userId, sessions })
        setLoadedUserId(userId)

        const savedId = localStorage.getItem(lastSessionKey(userId))
        const initial = sessions.find((session) => session.id === savedId) || sessions[0]
        if (!initial) {
          setActiveSessionId(null)
          setMessageData({ ownerId: userId, sessionId: null, messages: [] })
          return
        }

        const detail = await api(`/chat/sessions/${encodeURIComponent(initial.id)}`)
        if (!active) return
        setActiveSessionId(detail.id)
        setMessageData({ ownerId: userId, sessionId: detail.id, messages: detail.messages || [] })
        localStorage.setItem(lastSessionKey(userId), detail.id)
      } catch {
        if (active) {
          setLoadedUserId(userId)
          setLoadError('Could not load your saved chats. Please try again.')
        }
      }
    }

    loadSessions()
    return () => { active = false }
  }, [userId])

  const sessions = sessionData.ownerId === userId ? sessionData.sessions : []
  const activeSession = sessions.find((session) => session.id === activeSessionId) || null
  const messages = messageData.ownerId === userId && messageData.sessionId === activeSessionId
    ? messageData.messages
    : []
  const loadingSessions = Boolean(userId && loadedUserId !== userId)

  const saveActiveSession = (sessionId) => {
    setActiveSessionId(sessionId)
    if (userId && sessionId) localStorage.setItem(lastSessionKey(userId), sessionId)
    else if (userId) localStorage.removeItem(lastSessionKey(userId))
  }

  const openSession = async (sessionId) => {
    if (!userId) throw new Error('Please sign in to use chat.')
    setLoadingMessages(true)
    setSendError('')
    saveActiveSession(sessionId)
    try {
      const detail = await api(`/chat/sessions/${encodeURIComponent(sessionId)}`)
      setMessageData({ ownerId: userId, sessionId: detail.id, messages: detail.messages || [] })
      setSessionData((current) => ({
        ownerId: userId,
        sessions: current.ownerId === userId
          ? current.sessions.map((session) => session.id === detail.id ? { ...session, ...detail } : session)
          : [detail],
      }))
      return detail
    } finally {
      setLoadingMessages(false)
    }
  }

  const createSession = async ({ paperId = null } = {}) => {
    if (!userId) throw new Error('Please sign in to use chat.')
    const session = await api('/chat/sessions', {
      method: 'POST',
      body: paperId ? { paperId: Number(paperId) } : {},
    })
    setSessionData((current) => ({
      ownerId: userId,
      sessions: [session, ...(current.ownerId === userId ? current.sessions.filter((item) => item.id !== session.id) : [])],
    }))
    setMessageData({ ownerId: userId, sessionId: session.id, messages: [] })
    saveActiveSession(session.id)
    setSendError('')
    setLoadError('')
    return session
  }

  const openPaperChat = async (paperId) => {
    if (!userId) throw new Error('Please sign in to use chat.')
    let availableSessions = sessions
    if (sessionData.ownerId !== userId) {
      availableSessions = await api('/chat/sessions')
      setSessionData({ ownerId: userId, sessions: availableSessions })
      setLoadedUserId(userId)
    }
    const existing = availableSessions.find((session) => String(session.paper_id) === String(paperId))
    if (existing) return openSession(existing.id)
    const created = await createSession({ paperId })
    return openSession(created.id)
  }

  const renameSession = async (sessionId, title) => {
    const updated = await api(`/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: { title },
    })
    setSessionData((current) => ({
      ownerId: userId,
      sessions: current.sessions.map((session) => session.id === updated.id ? { ...session, ...updated } : session),
    }))
    return updated
  }

  const deleteSession = async (sessionId) => {
    await api(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
    const remaining = sessions.filter((session) => session.id !== sessionId)
    setSessionData({ ownerId: userId, sessions: remaining })
    if (sessionId === activeSessionId) {
      setMessageData({ ownerId: userId, sessionId: null, messages: [] })
      saveActiveSession(null)
      if (remaining[0]) await openSession(remaining[0].id)
    }
  }

  const sendMessage = async (question, { retryMessageId = null, localMessageId = null } = {}) => {
    if (!userId) throw new Error('Please sign in to use chat.')
    const content = String(question || '').trim()
    if (!content || content.length > 500) throw new Error('Message must be 1 to 500 characters.')

    let session = activeSession
    if (!session) {
      try {
        session = await createSession()
      } catch (error) {
        setSendError(error.message)
        return null
      }
    }

    const optimisticId = localMessageId || globalThis.crypto.randomUUID()
    if (!retryMessageId) {
      setMessageData((current) => ({
        ownerId: userId,
        sessionId: session.id,
        messages: [...(current.ownerId === userId && current.sessionId === session.id ? current.messages : []), {
          id: optimisticId,
          role: 'user',
          content,
          sources: [],
          status: 'sending',
        }],
      }))
    } else {
      setMessageData((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === optimisticId ? { ...message, status: 'sending' } : message),
      }))
    }

    setSending(true)
    setSendError('')
    try {
      const result = await api(`/chat/sessions/${encodeURIComponent(session.id)}/messages`, {
        method: 'POST',
        body: { question: content, ...(retryMessageId ? { retryMessageId } : {}) },
      })
      setMessageData((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === optimisticId
          ? { ...message, id: result.userMessageId, status: 'sent' }
          : message).concat(result),
      }))
      if (result.session) {
        setSessionData((current) => ({
          ownerId: userId,
          sessions: [
            { ...current.sessions.find((item) => item.id === result.session.id), ...result.session },
            ...current.sessions.filter((item) => item.id !== result.session.id),
          ],
        }))
      }
      return result
    } catch (error) {
      const canRetry = Boolean(error.userMessageId || retryMessageId)
      setSendError(error.message)
      setMessageData((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === optimisticId
          ? { ...message, status: canRetry ? 'failed' : 'error', retryMessageId: error.userMessageId || retryMessageId }
          : message),
      }))
      return null
    } finally {
      setSending(false)
    }
  }

  const retryMessage = (message) => sendMessage(message.content, {
    localMessageId: message.id,
    retryMessageId: message.retryMessageId,
  })

  const value = {
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
    openPaperChat,
    renameSession,
    deleteSession,
    sendMessage,
    retryMessage,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, TextT, Image, VideoCamera, CheckCircle, ChartBar, Plus, Trash, ChatCenteredDots, Question, At, Users, Star } from '@phosphor-icons/react'
import { api } from '../../api'
import { Avatar } from '../ui'
import { STORY_BACKGROUND_PRESETS, MAX_MEDIA_BYTES, MAX_VIDEO_DURATION_SECONDS } from './storyHelpers'
import StoryPollCard from './StoryPollCard'
import StoryQuestionCard from './StoryQuestionCard'
import StoryQuizCard from './StoryQuizCard'
import CloseFriendsModal from './CloseFriendsModal'
import './stories.css'

/**
 * StoryComposer
 *
 * Modal dialog for creating a new story (text, photo, or video).
 *
 * Props:
 *   currentUser  – the logged-in user object (used for display only)
 *   onClose()    – called when the modal should close without creating
 *   onCreated(story) – called after successful creation; receives the new story object
 */
/** Maximum number of mentioned users allowed per story (aligned with backend MAX_STORY_MENTIONS) */
export const MAX_STORY_MENTIONS = 5

export default function StoryComposer({ currentUser, onClose, onCreated }) {
  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('text') // 'text' | 'photo' | 'video'

  // ── Text story state ───────────────────────────────────────────────────────
  const [textContent, setTextContent] = useState('')
  const [bgStyle, setBgStyle] = useState(STORY_BACKGROUND_PRESETS[0].id)

  // ── Media story state ──────────────────────────────────────────────────────
  const [mediaFile, setMediaFile] = useState(null)   // { file, previewUrl, name }
  const [mediaCaption, setMediaCaption] = useState('')

  // ── Poll state ─────────────────────────────────────────────────────────────
  const [hasPoll, setHasPoll] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])

  // ── Question sticker state (Phase 2) ───────────────────────────────────────
  const [hasQuestion, setHasQuestion] = useState(false)
  const [questionText, setQuestionText] = useState('')

  // ── Quiz sticker state (Phase 3) ───────────────────────────────────────────
  const [hasQuiz, setHasQuiz] = useState(false)
  const [quizQuestion, setQuizQuestion] = useState('')
  const [quizOptions, setQuizOptions] = useState(['', ''])
  const [quizCorrectIndex, setQuizCorrectIndex] = useState(0)

  // ── Mentions state (Phase 4) ───────────────────────────────────────────────
  const [mentions, setMentions] = useState([]) // [{ id, name, username, avatar_url }]
  const [showMentionSearch, setShowMentionSearch] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionError, setMentionError] = useState('')

  // ── Audience state (Task 5) ────────────────────────────────────────────────
  const [audience, setAudience] = useState('everyone') // 'everyone' | 'close_friends'
  const [closeFriendsCount, setCloseFriendsCount] = useState(null)
  const [showCloseFriendsModal, setShowCloseFriendsModal] = useState(false)

  // ── Shared state ───────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // ── Fetch close friends count ──────────────────────────────────────────────
  const fetchCloseFriendsCount = useCallback(() => {
    let active = true
    api('/stories/close-friends')
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.closeFriends) ? data.closeFriends : []
        setCloseFriendsCount(list.length)
      })
      .catch(() => {
        if (!active) return
        setCloseFriendsCount(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const cancel = fetchCloseFriendsCount()
    return () => {
      cancel?.()
    }
  }, [fetchCloseFriendsCount])

  // ── Refs ───────────────────────────────────────────────────────────────────
  const photoInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const dialogRef = useRef(null)
  const mentionInputRef = useRef(null)

  // ── Derived ────────────────────────────────────────────────────────────────
  const activePreset = STORY_BACKGROUND_PRESETS.find((p) => p.id === bgStyle) ?? STORY_BACKGROUND_PRESETS[0]

  // ── Cleanup preview object URLs on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (mediaFile?.previewUrl) URL.revokeObjectURL(mediaFile.previewUrl)
    }
  }, [mediaFile])

  // ── Keyboard: Escape closes ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onClose])

  // ── Debounced user mention search (Phase 4) ────────────────────────────────
  useEffect(() => {
    if (!showMentionSearch || !mentionQuery.trim()) {
      setMentionSuggestions([])
      setMentionLoading(false)
      return undefined
    }

    let activeRequest = true
    setMentionLoading(true)
    setMentionError('')

    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(mentionQuery.trim())}`)
        .then((results) => {
          if (!activeRequest) return
          const myId = currentUser?.id ?? currentUser?.user_id
          const filtered = (Array.isArray(results) ? results : []).filter((u) => {
            const isMe = myId !== undefined && myId !== null && String(u.id) === String(myId)
            const alreadySelected = mentions.some((m) => String(m.id) === String(u.id))
            return !isMe && !alreadySelected
          })
          setMentionSuggestions(filtered)
        })
        .catch((err) => {
          if (!activeRequest) return
          setMentionError(err?.message || 'Failed to search users')
        })
        .finally(() => {
          if (activeRequest) setMentionLoading(false)
        })
    }, 250)

    return () => {
      activeRequest = false
      clearTimeout(timer)
    }
  }, [mentionQuery, showMentionSearch, currentUser, mentions])

  // ── Tab switch: clear error and media ─────────────────────────────────────
  const switchTab = (next) => {
    if (submitting) return
    setTab(next)
    setError('')
  }

  // ── Clear media file (revoke object URL) ─────────────────────────────────
  const clearMedia = useCallback(() => {
    if (mediaFile?.previewUrl) URL.revokeObjectURL(mediaFile.previewUrl)
    setMediaFile(null)
    setError('')
  }, [mediaFile])

  // ── Photo file selection ──────────────────────────────────────────────────
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Photo must be a JPEG, PNG, GIF, or WebP image.')
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setError('Photo must be 15 MB or smaller.')
      return
    }
    clearMedia()
    setError('')
    setMediaFile({ file, previewUrl: URL.createObjectURL(file), name: file.name })
  }

  // ── Video file selection ──────────────────────────────────────────────────
  const handleVideoChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'video/mp4' && !file.name.toLowerCase().endsWith('.mp4')) {
      setError('Video must be an MP4 file.')
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setError('Video must be 15 MB or smaller.')
      return
    }

    // Client-side duration check using HTMLVideoElement
    const url = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      if (vid.duration > MAX_VIDEO_DURATION_SECONDS) {
        setError(`Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter.`)
        return
      }
      clearMedia()
      setError('')
      setMediaFile({ file, previewUrl: URL.createObjectURL(file), name: file.name })
    }
    vid.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Could not read video file. Make sure it is a valid MP4.')
    }
    vid.src = url
  }

  // ── Poll management ───────────────────────────────────────────────────────
  const handleOptionChange = (idx, value) => {
    setPollOptions((prev) => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }

  const handleAddOption = () => {
    if (pollOptions.length < 4) {
      setPollOptions((prev) => [...prev, ''])
    }
  }

  const handleRemoveOption = (idx) => {
    if (pollOptions.length > 2) {
      setPollOptions((prev) => prev.filter((_, i) => i !== idx))
    }
  }

  // ── Quiz management (Phase 3) ──────────────────────────────────────────────
  const handleQuizOptionChange = (idx, value) => {
    setQuizOptions((prev) => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }

  const handleAddQuizOption = () => {
    if (quizOptions.length < 4) {
      setQuizOptions((prev) => [...prev, ''])
    }
  }

  const handleRemoveQuizOption = (idx) => {
    if (quizOptions.length > 2) {
      setQuizOptions((prev) => prev.filter((_, i) => i !== idx))
      setQuizCorrectIndex((prev) => {
        if (prev === idx) return 0
        if (prev > idx) return prev - 1
        return prev
      })
    }
  }

  const handleSetCorrectOption = (idx) => {
    setQuizCorrectIndex(idx)
  }

  // ── Mentions management (Phase 4) ──────────────────────────────────────────
  const handleSelectMention = (user) => {
    if (mentions.length >= MAX_STORY_MENTIONS) {
      setMentionError(`You can mention up to ${MAX_STORY_MENTIONS} users.`)
      return
    }
    const myId = currentUser?.id ?? currentUser?.user_id
    if (myId !== undefined && myId !== null && String(user.id) === String(myId)) {
      setMentionError('You cannot mention yourself.')
      return
    }
    if (mentions.some((m) => String(m.id) === String(user.id))) {
      setMentionError('User is already mentioned.')
      return
    }

    const newMention = {
      id: user.id,
      name: user.name || user.username || `User ${user.id}`,
      username: user.username || user.name || `user${user.id}`,
      avatar_url: user.avatar_url || null,
    }

    setMentions((prev) => [...prev, newMention])
    setMentionQuery('')
    setMentionSuggestions([])
    setMentionError('')
    if (mentions.length + 1 >= MAX_STORY_MENTIONS) {
      setShowMentionSearch(false)
    }
  }

  const handleRemoveMention = (userId) => {
    setMentions((prev) => prev.filter((m) => String(m.id) !== String(userId)))
    setMentionError('')
  }

  // ── Backdrop click ────────────────────────────────────────────────────────
  const handleBackdropClick = (e) => {
    if (e.target === dialogRef.current && !submitting) onClose()
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Client-side validation
    if (tab === 'text') {
      if (!textContent.trim()) {
        setError('Enter some text for your story.')
        return
      }
    } else {
      if (!mediaFile) {
        setError(`Select a ${tab} file to continue.`)
        return
      }
    }

    // Poll validation
    if (hasPoll) {
      const trimmedQ = pollQuestion.trim()
      if (!trimmedQ) {
        setError('Poll question cannot be empty.')
        return
      }
      if (trimmedQ.length > 120) {
        setError('Poll question must be 120 characters or fewer.')
        return
      }
      const validOptions = pollOptions.map((o) => o.trim()).filter(Boolean)
      if (validOptions.length < 2) {
        setError('Poll must have at least 2 non-empty options.')
        return
      }
      for (const opt of validOptions) {
        if (opt.length > 60) {
          setError('Poll options must be 60 characters or fewer.')
          return
        }
      }
      const lower = validOptions.map((o) => o.toLowerCase())
      if (new Set(lower).size !== validOptions.length) {
        setError('Poll options must be unique.')
        return
      }
    }

    // Question validation (Phase 2)
    if (hasQuestion) {
      const trimmedQ = questionText.trim()
      if (!trimmedQ) {
        setError('Question cannot be empty.')
        return
      }
      if (trimmedQ.length > 200) {
        setError('Question must be 200 characters or fewer.')
        return
      }
    }

    // Quiz validation (Phase 3)
    if (hasQuiz) {
      const trimmedQ = quizQuestion.trim()
      if (!trimmedQ) {
        setError('Quiz question cannot be empty.')
        return
      }
      if (trimmedQ.length > 200) {
        setError('Quiz question must be 200 characters or fewer.')
        return
      }
      const validOptions = quizOptions.map((o) => o.trim()).filter(Boolean)
      if (validOptions.length < 2) {
        setError('Quiz must have at least 2 non-empty options.')
        return
      }
      for (const opt of validOptions) {
        if (opt.length > 60) {
          setError('Quiz options must be 60 characters or fewer.')
          return
        }
      }
      const lower = validOptions.map((o) => o.toLowerCase())
      if (new Set(lower).size !== validOptions.length) {
        setError('Quiz options must be unique.')
        return
      }
      if (quizCorrectIndex < 0 || quizCorrectIndex >= validOptions.length) {
        setError('Please select a valid correct answer.')
        return
      }
    }

    // Close Friends empty list validation
    if (audience === 'close_friends' && closeFriendsCount === 0) {
      setError('Your Close Friends list is empty. Add friends to your Close Friends list before sharing a story with them.')
      return
    }

    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('type', tab)
      form.append('backgroundStyle', bgStyle)
      form.append('audience', audience)

      if (tab === 'text') {
        form.append('content', textContent.trim())
      } else {
        // For photo and video, caption goes as 'content' (optional, may be empty)
        form.append('content', mediaCaption.trim())
        form.append('media', mediaFile.file)
      }

      if (hasPoll) {
        const validOptions = pollOptions.map((o) => o.trim()).filter(Boolean)
        form.append(
          'poll',
          JSON.stringify({
            question: pollQuestion.trim(),
            options: validOptions,
          })
        )
      }

      if (hasQuestion) {
        form.append(
          'question',
          JSON.stringify({
            question: questionText.trim(),
          })
        )
      }

      if (hasQuiz) {
        const validOptions = quizOptions.map((o) => o.trim()).filter(Boolean)
        form.append(
          'quiz',
          JSON.stringify({
            question: quizQuestion.trim(),
            options: validOptions,
            correctOptionIndex: quizCorrectIndex,
          })
        )
      }

      if (mentions.length > 0) {
        const mentionIds = mentions.map((m) => Number(m.id)).filter((id) => Number.isInteger(id) && id > 0)
        form.append('mentions', JSON.stringify(mentionIds))
      }

      const story = await api('/stories', { method: 'POST', body: form })
      onCreated(story)
    } catch (err) {
      setError(err.message || 'Failed to create story. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="sc-backdrop"
      ref={dialogRef}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label="Create a story"
    >
      <div className="sc-panel">
        {/* ── Header ── */}
        <header className="sc-header">
          <h2 className="sc-title">Create story</h2>
          <button
            type="button"
            className="sc-close-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close composer"
          >
            <X size={20} />
          </button>
        </header>

        {/* ── Tabs ── */}
        <div className="sc-tabs" role="tablist" aria-label="Story type">
          {[
            { id: 'text', label: 'Text', Icon: TextT },
            { id: 'photo', label: 'Photo', Icon: Image },
            { id: 'video', label: 'Video', Icon: VideoCamera },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              type="button"
              className={`sc-tab${tab === id ? ' sc-tab-active' : ''}`}
              onClick={() => switchTab(id)}
              aria-selected={tab === id}
              disabled={submitting}
            >
              <Icon size={16} weight={tab === id ? 'fill' : 'regular'} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <form className="sc-body" onSubmit={handleSubmit} noValidate>

          {/* ── TEXT TAB ── */}
          {tab === 'text' && (
            <div className="sc-text-pane">
              {/* Live preview */}
              <div className={`sc-text-preview story-bg ${activePreset.className}`} aria-hidden="true">
                <span className="sc-text-preview-text">
                  {textContent || 'Your text will appear here'}
                </span>
                {hasPoll && (
                  <div className="sc-poll-preview-overlay">
                    <StoryPollCard
                      poll={{
                        id: 'preview',
                        question: pollQuestion || 'Ask a question…',
                        options: pollOptions.map((opt, i) => ({
                          id: String(i),
                          option_text: opt || `Option ${i + 1}`,
                          vote_count: 0,
                          percentage: 0,
                        })),
                        total_votes: 0,
                        my_vote: null,
                      }}
                      previewOnly
                    />
                  </div>
                )}
                {hasQuestion && (
                  <div className="sc-poll-preview-overlay">
                    <StoryQuestionCard
                      question={{
                        id: 'preview',
                        question_text: questionText || 'Ask me a question',
                        response_count: 0,
                        my_response: null,
                      }}
                      previewOnly
                    />
                  </div>
                )}
                {hasQuiz && (
                  <div className="sc-poll-preview-overlay">
                    <StoryQuizCard
                      quiz={{
                        id: 'preview',
                        question_text: quizQuestion || 'Ask a quiz question…',
                        options: quizOptions.map((opt, i) => ({
                          id: String(i),
                          option_text: opt || `Option ${i + 1}`,
                          display_order: i,
                          is_correct: i === quizCorrectIndex,
                        })),
                        correct_option_id: String(quizCorrectIndex),
                        response_count: 0,
                        my_answer: null,
                      }}
                      previewOnly
                    />
                  </div>
                )}
                {mentions.length > 0 && (
                  <div className="sc-preview-mentions-overlay" aria-hidden="true">
                    {mentions.map((m) => (
                      <span key={m.id} className="story-mention-badge sc-preview-mention-badge">
                        <span className="story-mention-badge-at">@</span>
                        <span className="story-mention-badge-name">{m.username || m.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Text input */}
              <div className="sc-field">
                <label htmlFor="sc-content" className="sc-label">
                  Story text <span className="sc-char-count">{textContent.length} / 500</span>
                </label>
                <textarea
                  id="sc-content"
                  className="sc-textarea"
                  rows={4}
                  maxLength={500}
                  placeholder="What's on your mind?"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              {/* Background picker */}
              <div className="sc-field">
                <span className="sc-label">Background</span>
                <div className="sc-bg-swatches" role="group" aria-label="Background style">
                  {STORY_BACKGROUND_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`sc-bg-swatch story-bg ${preset.className}${bgStyle === preset.id ? ' sc-bg-swatch-active' : ''}`}
                      onClick={() => setBgStyle(preset.id)}
                      aria-label={preset.label}
                      aria-pressed={bgStyle === preset.id}
                      disabled={submitting}
                      title={preset.label}
                    >
                      {bgStyle === preset.id && <CheckCircle size={18} weight="fill" className="sc-swatch-check" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PHOTO TAB ── */}
          {tab === 'photo' && (
            <div className="sc-media-pane">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={handlePhotoChange}
                aria-label="Select photo"
              />

              {mediaFile ? (
                <div className="sc-media-preview-wrap">
                  <img
                    src={mediaFile.previewUrl}
                    alt="Story photo preview"
                    className="sc-media-preview sc-img-preview"
                  />
                  {hasPoll && (
                    <div className="sc-poll-preview-overlay">
                      <StoryPollCard
                        poll={{
                          id: 'preview',
                          question: pollQuestion || 'Ask a question…',
                          options: pollOptions.map((opt, i) => ({
                            id: String(i),
                            option_text: opt || `Option ${i + 1}`,
                            vote_count: 0,
                            percentage: 0,
                          })),
                          total_votes: 0,
                          my_vote: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {hasQuestion && (
                    <div className="sc-poll-preview-overlay">
                      <StoryQuestionCard
                        question={{
                          id: 'preview',
                          question_text: questionText || 'Ask me a question',
                          response_count: 0,
                          my_response: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {hasQuiz && (
                    <div className="sc-poll-preview-overlay">
                      <StoryQuizCard
                        quiz={{
                          id: 'preview',
                          question_text: quizQuestion || 'Ask a quiz question…',
                          options: quizOptions.map((opt, i) => ({
                            id: String(i),
                            option_text: opt || `Option ${i + 1}`,
                            display_order: i,
                            is_correct: i === quizCorrectIndex,
                          })),
                          correct_option_id: String(quizCorrectIndex),
                          response_count: 0,
                          my_answer: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {mentions.length > 0 && (
                    <div className="sc-preview-mentions-overlay" aria-hidden="true">
                      {mentions.map((m) => (
                        <span key={m.id} className="story-mention-badge sc-preview-mention-badge">
                          <span className="story-mention-badge-at">@</span>
                          <span className="story-mention-badge-name">{m.username || m.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="sc-media-remove"
                    onClick={clearMedia}
                    disabled={submitting}
                    aria-label="Remove selected photo"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="sc-drop-zone"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={submitting}
                  aria-label="Select a photo to upload"
                >
                  <Image size={40} className="sc-drop-icon" />
                  <span className="sc-drop-label">Click to select a photo</span>
                  <span className="sc-drop-hint">JPEG, PNG, GIF, WebP · max 15 MB</span>
                </button>
              )}

              {/* Optional caption */}
              <div className="sc-field sc-caption-field">
                <label htmlFor="sc-caption" className="sc-label">
                  Caption <span className="sc-optional">(optional)</span>
                  <span className="sc-char-count">{mediaCaption.length} / 500</span>
                </label>
                <textarea
                  id="sc-caption"
                  className="sc-textarea sc-textarea-sm"
                  rows={2}
                  maxLength={500}
                  placeholder="Add a caption…"
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {/* ── VIDEO TAB ── */}
          {tab === 'video' && (
            <div className="sc-media-pane">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4"
                hidden
                onChange={handleVideoChange}
                aria-label="Select video"
              />

              {mediaFile ? (
                <div className="sc-media-preview-wrap">

                  <video
                    src={mediaFile.previewUrl}
                    className="sc-media-preview sc-vid-preview"
                    controls
                    playsInline
                    aria-label="Story video preview"
                  />
                  {hasPoll && (
                    <div className="sc-poll-preview-overlay">
                      <StoryPollCard
                        poll={{
                          id: 'preview',
                          question: pollQuestion || 'Ask a question…',
                          options: pollOptions.map((opt, i) => ({
                            id: String(i),
                            option_text: opt || `Option ${i + 1}`,
                            vote_count: 0,
                            percentage: 0,
                          })),
                          total_votes: 0,
                          my_vote: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {hasQuestion && (
                    <div className="sc-poll-preview-overlay">
                      <StoryQuestionCard
                        question={{
                          id: 'preview',
                          question_text: questionText || 'Ask me a question',
                          response_count: 0,
                          my_response: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {hasQuiz && (
                    <div className="sc-poll-preview-overlay">
                      <StoryQuizCard
                        quiz={{
                          id: 'preview',
                          question_text: quizQuestion || 'Ask a quiz question…',
                          options: quizOptions.map((opt, i) => ({
                            id: String(i),
                            option_text: opt || `Option ${i + 1}`,
                            display_order: i,
                            is_correct: i === quizCorrectIndex,
                          })),
                          correct_option_id: String(quizCorrectIndex),
                          response_count: 0,
                          my_answer: null,
                        }}
                        previewOnly
                      />
                    </div>
                  )}
                  {mentions.length > 0 && (
                    <div className="sc-preview-mentions-overlay" aria-hidden="true">
                      {mentions.map((m) => (
                        <span key={m.id} className="story-mention-badge sc-preview-mention-badge">
                          <span className="story-mention-badge-at">@</span>
                          <span className="story-mention-badge-name">{m.username || m.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="sc-media-remove"
                    onClick={clearMedia}
                    disabled={submitting}
                    aria-label="Remove selected video"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="sc-drop-zone"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={submitting}
                  aria-label="Select a video to upload"
                >
                  <VideoCamera size={40} className="sc-drop-icon" />
                  <span className="sc-drop-label">Click to select a video</span>
                  <span className="sc-drop-hint">MP4 only · max 15 MB · max 30 seconds</span>
                </button>
              )}

              {/* Optional caption */}
              <div className="sc-field sc-caption-field">
                <label htmlFor="sc-vid-caption" className="sc-label">
                  Caption <span className="sc-optional">(optional)</span>
                  <span className="sc-char-count">{mediaCaption.length} / 500</span>
                </label>
                <textarea
                  id="sc-vid-caption"
                  className="sc-textarea sc-textarea-sm"
                  rows={2}
                  maxLength={500}
                  placeholder="Add a caption…"
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {/* ── STICKER BUILDER SECTION (Phase 1 Polls, Phase 2 Questions, Phase 3 Quizzes) ── */}
          <div className="sc-poll-section">
            {!hasPoll && !hasQuestion && !hasQuiz ? (
              <div className="sc-sticker-toggle-group">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm sc-poll-toggle-btn"
                  onClick={() => {
                    setHasPoll(true)
                    setHasQuestion(false)
                    setHasQuiz(false)
                    setQuestionText('')
                    setQuizQuestion('')
                    setQuizOptions(['', ''])
                    setQuizCorrectIndex(0)
                    setError('')
                  }}
                  disabled={submitting}
                >
                  <ChartBar size={16} weight="bold" />
                  <span>Add a Poll</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm sc-poll-toggle-btn"
                  onClick={() => {
                    setHasQuestion(true)
                    setHasPoll(false)
                    setHasQuiz(false)
                    setPollQuestion('')
                    setPollOptions(['', ''])
                    setQuizQuestion('')
                    setQuizOptions(['', ''])
                    setQuizCorrectIndex(0)
                    setError('')
                  }}
                  disabled={submitting}
                >
                  <ChatCenteredDots size={16} weight="bold" />
                  <span>Ask a Question</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm sc-poll-toggle-btn"
                  onClick={() => {
                    setHasQuiz(true)
                    setHasPoll(false)
                    setHasQuestion(false)
                    setPollQuestion('')
                    setPollOptions(['', ''])
                    setQuestionText('')
                    setQuizQuestion('')
                    setQuizOptions(['', ''])
                    setQuizCorrectIndex(0)
                    setError('')
                  }}
                  disabled={submitting}
                >
                  <Question size={16} weight="bold" />
                  <span>Add a Quiz</span>
                </button>
              </div>
            ) : null}

            {hasPoll && (
              <div className="sc-poll-card-builder">
                <div className="sc-poll-builder-header">
                  <span className="sc-poll-builder-title">
                    <ChartBar size={18} weight="fill" className="sc-poll-icon" />
                    Story Poll
                  </span>
                  <button
                    type="button"
                    className="sc-poll-remove-btn"
                    onClick={() => {
                      setHasPoll(false)
                      setPollQuestion('')
                      setPollOptions(['', ''])
                    }}
                    disabled={submitting}
                    aria-label="Remove poll"
                  >
                    <Trash size={16} />
                    <span>Remove Poll</span>
                  </button>
                </div>

                <div className="sc-field">
                  <label htmlFor="sc-poll-question" className="sc-label">
                    Question <span className="sc-char-count">{pollQuestion.length} / 120</span>
                  </label>
                  <input
                    id="sc-poll-question"
                    type="text"
                    className="sc-input"
                    maxLength={120}
                    placeholder="Ask a question…"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    disabled={submitting}
                    required={hasPoll}
                  />
                </div>

                <div className="sc-field">
                  <span className="sc-label">Options (2 to 4)</span>
                  <div className="sc-poll-options-list">
                    {pollOptions.map((option, idx) => (
                      <div key={idx} className="sc-poll-option-input-row">
                        <input
                          type="text"
                          className="sc-input sc-poll-option-input"
                          maxLength={60}
                          placeholder={`Option ${idx + 1}`}
                          value={option}
                          onChange={(e) => handleOptionChange(idx, e.target.value)}
                          disabled={submitting}
                          aria-label={`Poll Option ${idx + 1}`}
                        />
                        {pollOptions.length > 2 && (
                          <button
                            type="button"
                            className="sc-poll-option-remove-btn"
                            onClick={() => handleRemoveOption(idx)}
                            disabled={submitting}
                            aria-label={`Remove option ${idx + 1}`}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {pollOptions.length < 4 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm sc-poll-add-option-btn"
                      onClick={handleAddOption}
                      disabled={submitting}
                    >
                      <Plus size={14} weight="bold" />
                      <span>Add option</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {hasQuestion && (
              <div className="sc-poll-card-builder sc-question-card-builder">
                <div className="sc-poll-builder-header">
                  <span className="sc-poll-builder-title">
                    <ChatCenteredDots size={18} weight="fill" className="sc-question-icon" aria-hidden="true" />
                    Question Sticker
                  </span>
                  <button
                    type="button"
                    className="sc-poll-remove-btn"
                    onClick={() => {
                      setHasQuestion(false)
                      setQuestionText('')
                    }}
                    disabled={submitting}
                    aria-label="Remove question sticker"
                  >
                    <Trash size={16} aria-hidden="true" />
                    <span>Remove Question</span>
                  </button>
                </div>

                <div className="sc-field">
                  <label htmlFor="sc-question-text" className="sc-label">
                    Question prompt <span className="sc-char-count" aria-live="polite">{questionText.length} / 200</span>
                  </label>
                  <textarea
                    id="sc-question-text"
                    className="sc-textarea sc-textarea-sm"
                    rows={2}
                    maxLength={200}
                    placeholder="Ask me a question…"
                    value={questionText}
                    onChange={(e) => {
                      setQuestionText(e.target.value)
                      if (error) setError('')
                    }}
                    disabled={submitting}
                    required={hasQuestion}
                    aria-label="Question prompt (maximum 200 characters)"
                    aria-invalid={hasQuestion && (!questionText.trim() || questionText.length > 200)}
                  />
                  <span className="sc-sticker-exclusivity-note">
                    Only one sticker (Poll, Question, or Quiz) can be added per Story.
                  </span>
                </div>
              </div>
            )}

            {hasQuiz && (
              <div className="sc-poll-card-builder sc-quiz-card-builder">
                <div className="sc-poll-builder-header">
                  <span className="sc-poll-builder-title">
                    <Question size={18} weight="fill" className="sc-quiz-icon" aria-hidden="true" />
                    Story Quiz
                  </span>
                  <button
                    type="button"
                    className="sc-poll-remove-btn"
                    onClick={() => {
                      setHasQuiz(false)
                      setQuizQuestion('')
                      setQuizOptions(['', ''])
                      setQuizCorrectIndex(0)
                    }}
                    disabled={submitting}
                    aria-label="Remove quiz sticker"
                  >
                    <Trash size={16} aria-hidden="true" />
                    <span>Remove Quiz</span>
                  </button>
                </div>

                <div className="sc-field">
                  <label htmlFor="sc-quiz-question" className="sc-label">
                    Quiz question <span className="sc-char-count" aria-live="polite">{quizQuestion.length} / 200</span>
                  </label>
                  <input
                    id="sc-quiz-question"
                    type="text"
                    className="sc-input"
                    maxLength={200}
                    placeholder="Ask a question with one correct answer…"
                    value={quizQuestion}
                    onChange={(e) => {
                      setQuizQuestion(e.target.value)
                      if (error) setError('')
                    }}
                    disabled={submitting}
                    required={hasQuiz}
                    aria-label="Quiz question (maximum 200 characters)"
                  />
                </div>

                <div className="sc-field">
                  <div className="sc-quiz-options-header">
                    <span className="sc-label">Options (2 to 4)</span>
                    <span className="sc-quiz-correct-hint">Tap green check to set correct answer</span>
                  </div>
                  <div className="sc-poll-options-list sc-quiz-options-list">
                    {quizOptions.map((option, idx) => {
                      const isCorrect = quizCorrectIndex === idx
                      return (
                        <div key={idx} className={`sc-poll-option-input-row sc-quiz-option-row ${isCorrect ? 'sc-quiz-option-is-correct' : ''}`}>
                          <button
                            type="button"
                            className={`sc-quiz-correct-toggle ${isCorrect ? 'sc-quiz-correct-active' : ''}`}
                            onClick={() => handleSetCorrectOption(idx)}
                            disabled={submitting}
                            title={isCorrect ? 'Correct answer' : 'Mark as correct answer'}
                            aria-label={`Mark option ${idx + 1} as correct answer`}
                            aria-pressed={isCorrect}
                          >
                            <CheckCircle size={20} weight={isCorrect ? 'fill' : 'regular'} />
                          </button>
                          <input
                            type="text"
                            className="sc-input sc-poll-option-input sc-quiz-option-input"
                            maxLength={60}
                            placeholder={`Option ${idx + 1}${isCorrect ? ' (Correct Answer)' : ''}`}
                            value={option}
                            onChange={(e) => handleQuizOptionChange(idx, e.target.value)}
                            disabled={submitting}
                            aria-label={`Quiz Option ${idx + 1}`}
                          />
                          {quizOptions.length > 2 && (
                            <button
                              type="button"
                              className="sc-poll-option-remove-btn"
                              onClick={() => handleRemoveQuizOption(idx)}
                              disabled={submitting}
                              aria-label={`Remove option ${idx + 1}`}
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {quizOptions.length < 4 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm sc-poll-add-option-btn"
                      onClick={handleAddQuizOption}
                      disabled={submitting}
                    >
                      <Plus size={14} weight="bold" />
                      <span>Add option</span>
                    </button>
                  )}
                  <span className="sc-sticker-exclusivity-note">
                    Only one sticker (Poll, Question, or Quiz) can be added per Story.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── STORY MENTIONS SECTION (Phase 4) ── */}
          <div className="sc-mention-section">
            <div className="sc-mention-header">
              <span className="sc-label sc-mention-section-label">
                <At size={16} weight="bold" className="sc-mention-header-icon" />
                Mentions
                <span className="sc-char-count">{mentions.length} / {MAX_STORY_MENTIONS}</span>
              </span>
              {!showMentionSearch && mentions.length < MAX_STORY_MENTIONS && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm sc-mention-toggle-btn"
                  onClick={() => {
                    setShowMentionSearch(true)
                    setTimeout(() => mentionInputRef.current?.focus(), 50)
                  }}
                  disabled={submitting}
                  aria-label="Mention a user"
                >
                  <At size={14} weight="bold" />
                  <span>Mention user</span>
                </button>
              )}
            </div>

            {/* Selected Mentions Chips */}
            {mentions.length > 0 && (
              <div className="sc-mention-chips" role="list" aria-label="Selected mentions">
                {mentions.map((m) => (
                  <div key={m.id} className="sc-mention-chip" role="listitem">
                    <Avatar name={m.name || m.username} src={m.avatar_url} size="xs" />
                    <span className="sc-mention-chip-name">@{m.username || m.name}</span>
                    <button
                      type="button"
                      className="sc-mention-chip-remove"
                      onClick={() => handleRemoveMention(m.id)}
                      disabled={submitting}
                      aria-label={`Remove mention @${m.username || m.name}`}
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Mention Search Box and Dropdown */}
            {showMentionSearch && mentions.length < MAX_STORY_MENTIONS && (
              <div className="sc-mention-search-box">
                <div className="sc-mention-input-row">
                  <span className="sc-mention-at-prefix">@</span>
                  <input
                    ref={mentionInputRef}
                    type="text"
                    className="sc-input sc-mention-input"
                    placeholder="Search users to mention…"
                    value={mentionQuery}
                    onChange={(e) => {
                      setMentionQuery(e.target.value)
                      if (mentionError) setMentionError('')
                    }}
                    disabled={submitting}
                    aria-label="Search users to mention"
                  />
                  <button
                    type="button"
                    className="sc-mention-cancel-btn"
                    onClick={() => {
                      setShowMentionSearch(false)
                      setMentionQuery('')
                      setMentionSuggestions([])
                      setMentionError('')
                    }}
                    disabled={submitting}
                    aria-label="Close mention search"
                  >
                    <X size={16} />
                  </button>
                </div>

                {mentionLoading && (
                  <div className="sc-mention-status-hint">Searching users…</div>
                )}

                {mentionError && (
                  <div className="sc-mention-error-hint" role="alert">{mentionError}</div>
                )}

                {!mentionLoading && mentionQuery.trim().length > 0 && mentionSuggestions.length === 0 && !mentionError && (
                  <div className="sc-mention-status-hint">No users found</div>
                )}

                {mentionSuggestions.length > 0 && (
                  <ul className="sc-mention-dropdown" role="listbox" aria-label="User search results">
                    {mentionSuggestions.map((user) => (
                      <li key={user.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          className="sc-mention-item"
                          onClick={() => handleSelectMention(user)}
                          disabled={submitting}
                        >
                          <Avatar name={user.name || user.username} src={user.avatar_url} size="sm" />
                          <div className="sc-mention-item-info">
                            <span className="sc-mention-item-name">{user.name || user.username}</span>
                            <span className="sc-mention-item-username">@{user.username || user.name}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {mentions.length >= MAX_STORY_MENTIONS && (
              <span className="sc-mention-max-note">
                Maximum {MAX_STORY_MENTIONS} mentions reached.
              </span>
            )}
          </div>

          {/* ── Audience Selector (Task 5) ── */}
          <div className="sc-audience-container">
            <div className="sc-audience-header">
              <span className="sc-audience-label">Audience</span>
            </div>
            <div className="sc-audience-options" role="radiogroup" aria-label="Story audience">
              <button
                type="button"
                role="radio"
                aria-checked={audience === 'everyone'}
                className={`sc-audience-pill ${audience === 'everyone' ? 'sc-audience-pill-active' : ''}`}
                onClick={() => {
                  setAudience('everyone')
                  setError('')
                }}
                disabled={submitting}
              >
                <Users size={15} weight={audience === 'everyone' ? 'bold' : 'regular'} />
                <span>Everyone</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={audience === 'close_friends'}
                className={`sc-audience-pill sc-audience-pill-cf ${audience === 'close_friends' ? 'sc-audience-pill-active' : ''}`}
                onClick={() => {
                  setAudience('close_friends')
                  setError('')
                }}
                disabled={submitting}
              >
                <span className="sc-audience-star-icon" aria-hidden="true">
                  <Star size={13} weight="fill" />
                </span>
                <span>Close Friends</span>
                {closeFriendsCount !== null && closeFriendsCount > 0 && (
                  <span className="sc-audience-cf-count">({closeFriendsCount})</span>
                )}
              </button>
            </div>

            {/* Empty Close Friends Warning */}
            {audience === 'close_friends' && closeFriendsCount === 0 && (
              <div className="sc-audience-empty-warning" role="alert">
                <span>Your Close Friends list is empty. Only people on your list can view this story.</span>
                <button
                  type="button"
                  className="sc-audience-manage-btn"
                  onClick={() => setShowCloseFriendsModal(true)}
                  disabled={submitting}
                >
                  Add friends
                </button>
              </div>
            )}
          </div>

          {/* ── Error ── */}
          {error && (
            <p className="sc-error" role="alert">
              {error}
            </p>
          )}

          {/* ── Footer ── */}
          <div className="sc-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                submitting ||
                (tab === 'text' && !textContent.trim()) ||
                (tab !== 'text' && !mediaFile) ||
                (hasPoll && (!pollQuestion.trim() || pollOptions.map((o) => o.trim()).filter(Boolean).length < 2)) ||
                (hasQuestion && (!questionText.trim() || questionText.trim().length > 200)) ||
                (hasQuiz && (!quizQuestion.trim() || quizOptions.map((o) => o.trim()).filter(Boolean).length < 2))
              }
            >
              {submitting ? 'Sharing…' : 'Share story'}
            </button>
          </div>
        </form>
      </div>

      {showCloseFriendsModal && (
        <CloseFriendsModal
          isOpen={showCloseFriendsModal}
          onClose={() => setShowCloseFriendsModal(false)}
          currentUser={currentUser}
          onUpdated={fetchCloseFriendsCount}
        />
      )}
    </div>
  )
}

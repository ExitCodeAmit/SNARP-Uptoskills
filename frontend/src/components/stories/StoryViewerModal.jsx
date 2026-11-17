import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  X,
  Trash,
  Play,
  Pause,
  CaretLeft,
  CaretRight,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  Eye,
  PaperPlaneRight,
  Check,
  Heart,
  ShareFat,
  Star,
} from '@phosphor-icons/react'
import { Avatar } from '../ui'
import { api } from '../../api'
import { timeAgo, formatDisplayName } from '../../format'
import { useStoryMedia, STORY_REACTIONS } from './storyHelpers.js'
import StoryViewersDrawer from './StoryViewersDrawer'
import StoryPollCard from './StoryPollCard'
import StoryQuestionCard from './StoryQuestionCard'
import StoryQuizCard from './StoryQuizCard'
import './stories.css'

/** Duration for photo and text stories (5.0 seconds) */
const STORY_DURATION_MS = 5000

/**
 * StoryViewerModal Component
 *
 * Full-screen modal for viewing stories with:
 * - Segmented progress bars
 * - Photo, video, and text story rendering
 * - Automatic progression and video playback synchronization
 * - Hold-to-pause and spacebar toggle
 * - Prev/next tap zones and keyboard controls (ArrowLeft, ArrowRight, Escape, Space)
 * - Visibility change pause handling
 * - View tracking with duplicate prevention
 * - Owner-only delete with confirmation
 */
export default function StoryViewerModal({
  currentUser,
  user,
  stories: initialStories = [],
  initialIndex = 0,
  onClose,
  onStoryDeleted,
  onStoryReshared,
  highlightTitle,
}) {
  const [stories, setStories] = useState(() => (Array.isArray(initialStories) ? initialStories : []))
  const [currentIndex, setCurrentIndex] = useState(() => {
    const maxIdx = Math.max(0, (initialStories?.length || 1) - 1)
    return Math.max(0, Math.min(initialIndex, maxIdx))
  })
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [isHolding, setIsHolding] = useState(false)
  const [isDocumentHidden, setIsDocumentHidden] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showViewersDrawer, setShowViewersDrawer] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  // Story reply state (Phase 3 - Task 3)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [replySuccess, setReplySuccess] = useState(false)
  const [replyError, setReplyError] = useState(null)
  const [isReplying, setIsReplying] = useState(false)
  const [isAnsweringQuestion, setIsAnsweringQuestion] = useState(false)
  const [isAnsweringQuiz, setIsAnsweringQuiz] = useState(false)
  // Reshare state (Phase 4 - Task 4.5)
  const [showReshareConfirm, setShowReshareConfirm] = useState(false)
  const [isResharing, setIsResharing] = useState(false)
  const [reshareSuccess, setReshareSuccess] = useState(false)
  const [reshareError, setReshareError] = useState(null)
  const [reshareCaption, setReshareCaption] = useState('')

  // Instagram-style reaction picker popup state
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [tapGlow, setTapGlow] = useState(null)
  const [floatingReaction, setFloatingReaction] = useState(null)
  const reactionsWrapRef = useRef(null)

  const pressTimerRef = useRef(null)
  const videoRef = useRef(null)
  const viewedIdsRef = useRef(new Set())

  // Keep stories in sync if initialStories changes
  useEffect(() => {
    if (Array.isArray(initialStories)) {
      setStories(initialStories)
    }
  }, [initialStories])

  // Current story item
  const currentStory = stories[currentIndex] || null

  // Authenticated media loader
  const { objectUrl, loading: mediaLoading, error: mediaError } = useStoryMedia(currentStory?.media_url)

  // Ownership check
  const isOwner = Boolean(
    currentUser &&
    (String(currentUser.id) === String(user?.id || user?.user_id) ||
      (currentStory?.user_id && String(currentUser.id) === String(currentStory.user_id)))
  )
  const displayName = formatDisplayName(user?.name || user?.full_name || user?.username || user)

  // Effective pause condition for progress timer
  const effectivePaused = Boolean(
    isPaused ||
    isHolding ||
    isDocumentHidden ||
    isBuffering ||
    showDeleteConfirm ||
    isDeleting ||
    showReshareConfirm ||
    isResharing ||
    mediaLoading ||
    mediaError ||
    showViewersDrawer ||
    isReplying ||
    isAnsweringQuestion ||
    isAnsweringQuiz ||
    showReactionPicker
  )

  // User/system pause condition for video playback (excluding buffering so the browser can buffer)
  const isVideoPaused = Boolean(
    isPaused ||
    isHolding ||
    isDocumentHidden ||
    showDeleteConfirm ||
    isDeleting ||
    showReshareConfirm ||
    isResharing ||
    showViewersDrawer ||
    isReplying ||
    isAnsweringQuestion ||
    isAnsweringQuiz ||
    showReactionPicker
  )

  // Handle close
  const handleClose = useCallback(() => {
    onClose?.()
  }, [onClose])

  // Navigate to previous story
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
      setProgress(0)
    } else {
      // Restart current story if at the first story
      setProgress(0)
      if (videoRef.current) {
        videoRef.current.currentTime = 0
      }
    }
  }, [currentIndex])

  // Navigate to next story
  const handleNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      setProgress(0)
    } else {
      handleClose()
    }
  }, [currentIndex, stories.length, handleClose])

  // Reset progress and video playback on story change
  useEffect(() => {
    setProgress(0)
    setIsBuffering(false)
    setShowViewersDrawer(false)
    setShowReactionPicker(false)
    setReplyText('')
    setSendingReply(false)
    setReplySuccess(false)
    setReplyError(null)
    setIsReplying(false)
    setIsAnsweringQuestion(false)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
    }
  }, [currentIndex])

  // Authenticated view tracking (idempotent, single request per story ID per session)
  useEffect(() => {
    if (!currentStory?.id) return
    if (viewedIdsRef.current.has(currentStory.id)) return
    viewedIdsRef.current.add(currentStory.id)

    api(`/stories/${currentStory.id}/view`, { method: 'POST' })
      .then((res) => {
        if (typeof res?.viewCount === 'number') {
          setStories((prev) =>
            prev.map((s) => (s.id === currentStory.id ? { ...s, view_count: res.viewCount } : s))
          )
        }
      })
      .catch(() => {})
  }, [currentStory?.id])

  // 5.0s progression timer for text & photo stories
  useEffect(() => {
    if (!currentStory) return
    if (currentStory.type === 'video') return
    if (effectivePaused) return

    const tickMs = 50
    const stepPct = (tickMs / STORY_DURATION_MS) * 100

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + stepPct
        if (next >= 100) {
          clearInterval(interval)
          return 100
        }
        return next
      })
    }, tickMs)

    return () => clearInterval(interval)
  }, [currentStory, effectivePaused])

  // Automatically advance when non-video story progress completes
  useEffect(() => {
    if (!currentStory || currentStory.type === 'video') return
    if (progress >= 100 && !effectivePaused) {
      handleNext()
    }
  }, [progress, currentStory, effectivePaused, handleNext])

  // Video playback progress synchronization
  const handleVideoTimeUpdate = () => {
    if (videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
      const pct = (videoRef.current.currentTime / videoRef.current.duration) * 100
      setProgress(Math.min(100, Math.max(0, pct)))
    }
  }

  // Synchronize pause state with video element
  useEffect(() => {
    if (currentStory?.type !== 'video' || !videoRef.current) return
    if (isVideoPaused) {
      videoRef.current.pause()
    } else {
      videoRef.current.play().catch(() => {})
    }
  }, [isVideoPaused, currentStory, objectUrl])

  // Keyboard navigation & controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isReplying) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setIsReplying(false)
          e.target.blur?.()
        }
        return
      }

      if (isAnsweringQuestion) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setIsAnsweringQuestion(false)
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur()
          }
        }
        return
      }

      if (showDeleteConfirm) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowDeleteConfirm(false)
        }
        return
      }

      if (showViewersDrawer) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowViewersDrawer(false)
        }
        return
      }

      if (showReactionPicker) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowReactionPicker(false)
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === ' ') {
        e.preventDefault()
        setIsPaused((p) => !p)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, handlePrev, handleNext, showDeleteConfirm, showViewersDrawer, showReshareConfirm, isReplying, isAnsweringQuestion, showReactionPicker])

  // Click outside to close reaction picker popup
  useEffect(() => {
    if (!showReactionPicker) return
    const handleClickOutside = (e) => {
      if (reactionsWrapRef.current && !reactionsWrapRef.current.contains(e.target)) {
        setShowReactionPicker(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [showReactionPicker])

  // Visibility change pause handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentHidden(document.hidden)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Touch and pointer hold-to-pause with tap differentiation
  const handlePointerDown = () => {
    pressTimerRef.current = Date.now()
    setIsHolding(true)
  }

  const handlePointerUp = (e) => {
    const pressDuration = Date.now() - (pressTimerRef.current || 0)
    setIsHolding(false)
    pressTimerRef.current = null

    if (showDeleteConfirm || showViewersDrawer || showReshareConfirm) return

    // Brief tap (< 250ms) triggers tap navigation
    if (pressDuration < 250) {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const width = rect.width
      if (clickX < width * 0.35) {
        setTapGlow('left')
        setTimeout(() => setTapGlow(null), 300)
        handlePrev()
      } else {
        setTapGlow('right')
        setTimeout(() => setTapGlow(null), 300)
        handleNext()
      }
    }
  }

  const handlePointerCancel = () => {
    setIsHolding(false)
    pressTimerRef.current = null
  }

  // Delete current story
  const handleDelete = async () => {
    if (!currentStory?.id || isDeleting) return
    setIsDeleting(true)
    setDeleteError(null)

    try {
      await api(`/stories/${currentStory.id}`, { method: 'DELETE' })
      onStoryDeleted?.(currentStory.id)

      const remaining = stories.filter((s) => s.id !== currentStory.id)
      if (remaining.length === 0) {
        handleClose()
      } else {
        setStories(remaining)
        setShowDeleteConfirm(false)
        setIsDeleting(false)
        setCurrentIndex((prev) => Math.min(prev, remaining.length - 1))
        setProgress(0)
      }
    } catch (err) {
      setDeleteError(err?.message || 'Could not delete story')
      setIsDeleting(false)
    }
  }

  // Reshare eligibility: non-owner, mentioned user only, non-nested, active (non-expired)
  const currentUserId = currentUser?.id || currentUser?.user_id
  const isMentionedInStory = Boolean(
    currentUserId &&
    Array.isArray(currentStory?.mentions) &&
    currentStory.mentions.some((m) => String(m.id) === String(currentUserId))
  )

  const isEligibleForReshare = Boolean(
    !isOwner &&
    isMentionedInStory &&
    !currentStory?.original_story_id &&
    currentStory?.expires_at &&
    new Date(currentStory.expires_at) > new Date()
  )

  const handleOpenReshareConfirm = () => {
    setReshareError(null)
    setReshareSuccess(false)
    setReshareCaption('')
    setShowReshareConfirm(true)
  }

  const handleCloseReshareConfirm = () => {
    if (isResharing) return
    setShowReshareConfirm(false)
    setReshareError(null)
    setReshareSuccess(false)
  }

  const handleConfirmReshare = async () => {
    if (!currentStory?.id || isResharing) return
    setIsResharing(true)
    setReshareError(null)

    try {
      const payload = {}
      if (reshareCaption.trim()) {
        payload.content = reshareCaption.trim().slice(0, 500)
      }

      const result = await api(`/stories/${currentStory.id}/reshare`, {
        method: 'POST',
        body: payload,
      })

      setReshareSuccess(true)
      setIsResharing(false)

      setTimeout(() => {
        setShowReshareConfirm(false)
        setReshareSuccess(false)
        onStoryReshared?.(result)
      }, 700)
    } catch (err) {
      setReshareError(err?.message || 'Failed to reshare story')
      setIsResharing(false)
    }
  }

  // Handle reaction click (add, change, or remove reaction)
  const handleReactionClick = async (reactionType) => {
    if (!currentStory?.id) return

    const storyId = currentStory.id
    const prevReaction = currentStory.my_reaction || null
    const prevCount = currentStory.reaction_count || 0

    // Clicking active reaction toggles it off
    const isRemoving = prevReaction === reactionType
    const nextReaction = isRemoving ? null : reactionType
    const nextCount = isRemoving
      ? Math.max(0, prevCount - 1)
      : (prevReaction ? prevCount : prevCount + 1)

    // Optimistic UI update
    setStories((prev) =>
      prev.map((s) =>
        s.id === storyId
          ? { ...s, my_reaction: nextReaction, reaction_count: nextCount }
          : s
      )
    )

    // Close reaction picker popup after selection
    setShowReactionPicker(false)

    try {
      if (isRemoving) {
        const res = await api(`/stories/${storyId}/reactions`, { method: 'DELETE' })
        if (res?.reactionCount !== undefined) {
          setStories((prev) =>
            prev.map((s) =>
              s.id === storyId
                ? { ...s, my_reaction: null, reaction_count: res.reactionCount }
                : s
            )
          )
        }
      } else {
        const res = await api(`/stories/${storyId}/reactions`, {
          method: 'POST',
          body: { type: reactionType },
        })
        if (res?.reactionCount !== undefined) {
          setStories((prev) =>
            prev.map((s) =>
              s.id === storyId
                ? { ...s, my_reaction: res.myReaction || reactionType, reaction_count: res.reactionCount }
                : s
            )
          )
          const matched = STORY_REACTIONS.find((r) => r.type === reactionType)
          if (matched) {
            setFloatingReaction({ emoji: matched.emoji, id: Date.now() })
            setTimeout(() => setFloatingReaction(null), 1200)
          }
        }
      }
    } catch (err) {
      console.error('Failed to update story reaction:', err)
      // Revert optimistic state
      setStories((prev) =>
        prev.map((s) =>
          s.id === storyId
            ? { ...s, my_reaction: prevReaction, reaction_count: prevCount }
            : s
        )
      )
    }
  }

  // Handle story reply submission
  const handleSendReply = async (e) => {
    e?.preventDefault()
    const trimmed = replyText.trim()
    if (!trimmed || !currentStory?.id || sendingReply || isOwner) return

    setSendingReply(true)
    setReplyError(null)

    try {
      await api(`/stories/${currentStory.id}/replies`, {
        method: 'POST',
        body: { text: trimmed },
      })
      setReplyText('')
      setReplySuccess(true)
      setIsReplying(false)
      setTimeout(() => setReplySuccess(false), 3000)
    } catch (err) {
      setReplyError(err?.message || 'Could not send reply')
    } finally {
      setSendingReply(false)
    }
  }

  // Handle Poll Vote
  const handlePollVote = async (optionId) => {
    if (!currentStory?.id) return
    const res = await api(`/stories/${currentStory.id}/polls/vote`, {
      method: 'POST',
      body: { optionId },
    })
    if (res?.poll) {
      setStories((prev) =>
        prev.map((s) => (s.id === currentStory.id ? { ...s, poll: res.poll } : s))
      )
    }
  }

  // Handle Question Response submission
  const handleQuestionRespond = async (responseText) => {
    if (!currentStory?.id) return
    const res = await api(`/stories/${currentStory.id}/questions/respond`, {
      method: 'POST',
      body: { response: responseText },
    })
    if (res?.question) {
      setStories((prev) =>
        prev.map((s) => (s.id === currentStory.id ? { ...s, question: res.question } : s))
      )
    }
    return res
  }

  // Handle Quiz Answer submission (Phase 3)
  const handleQuizAnswer = async (optionId) => {
    if (!currentStory?.id) return
    const res = await api(`/stories/${currentStory.id}/quizzes/answer`, {
      method: 'POST',
      body: { optionId },
    })
    if (res?.quiz) {
      setStories((prev) =>
        prev.map((s) => (s.id === currentStory.id ? { ...s, quiz: res.quiz } : s))
      )
    }
    return res
  }

  if (!stories.length || !currentStory) {
    return null
  }

  const rawStyle = currentStory.background_style || 'gradient-sunset'
  const backgroundClass = currentStory.type === 'text'
    ? (rawStyle.startsWith('story-bg-') ? rawStyle : `story-bg-${rawStyle}`)
    : ''

  return (
    <div
      className="story-viewer-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Story by ${displayName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !showDeleteConfirm) handleClose()
      }}
    >
      {/* Desktop Previous Button */}
      <button
        type="button"
        className="story-nav-btn story-nav-prev"
        onClick={handlePrev}
        aria-label="Previous story"
      >
        <CaretLeft size={28} weight="bold" />
      </button>

      {/* Main Story Card Frame */}
      <div className={`story-viewer-frame ${backgroundClass}`}>
        {/* Progress Bar Segments */}
        <div
          className="story-progress-bar"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {stories.map((storyItem, idx) => {
            let fill = 0
            if (idx < currentIndex) fill = 100
            else if (idx === currentIndex) fill = progress
            return (
              <div key={storyItem.id || idx} className="story-progress-track">
                <div
                  className="story-progress-fill"
                  style={{ width: `${fill}%` }}
                />
              </div>
            )
          })}
        </div>

        {/* Story Header */}
        <div className="story-viewer-header">
          <div className="story-viewer-user-info">
            <Avatar name={displayName} src={user?.avatar_url} size="sm" />
            <div className="story-viewer-meta">
              <div className="story-viewer-name-row">
                <span className="story-viewer-name">
                  {displayName}
                  {highlightTitle && <span className="story-viewer-highlight-badge"> • {highlightTitle}</span>}
                </span>
                {currentStory?.audience === 'close_friends' && (
                  <span
                    className="story-viewer-cf-badge"
                    aria-label="Close Friends story"
                    title="Close Friends story"
                  >
                    <Star size={11} weight="fill" className="story-viewer-cf-star" />
                    <span>Close Friends</span>
                  </span>
                )}
              </div>
              <time className="story-viewer-time" dateTime={currentStory.created_at || undefined}>
                {currentStory.created_at ? timeAgo(currentStory.created_at) : ''}
              </time>
              {currentStory.original_story_id && (
                <div className="story-viewer-reshare-badge">
                  <ShareFat size={11} weight="fill" className="story-viewer-reshare-icon" />
                  {currentStory.reshare && !currentStory.reshare.unavailable ? (
                    <Link
                      to={`/users/${currentStory.reshare.user_id}`}
                      className="story-reshare-attribution-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose?.()
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      title={`View @${currentStory.reshare.author_username || currentStory.reshare.author_name}'s profile`}
                    >
                      Reshared from @{currentStory.reshare.author_username || currentStory.reshare.author_name}
                    </Link>
                  ) : (
                    <span className="story-reshare-attribution-fallback">Reshared story</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="story-viewer-actions">
            {/* Play / Pause Toggle */}
            <button
              type="button"
              className="story-action-btn"
              onClick={() => setIsPaused((p) => !p)}
              aria-label={isPaused ? 'Resume story' : 'Pause story'}
              title={isPaused ? 'Play' : 'Pause'}
            >
              {isPaused ? <Play size={20} weight="fill" /> : <Pause size={20} weight="fill" />}
            </button>

            {/* Mute / Unmute Toggle for Videos */}
            {currentStory.type === 'video' && (
              <button
                type="button"
                className="story-action-btn"
                onClick={() => setIsMuted((m) => !m)}
                aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <SpeakerSimpleSlash size={20} weight="fill" /> : <SpeakerSimpleHigh size={20} weight="fill" />}
              </button>
            )
}

            {/* Owner Delete Button */}
            {isOwner && (
              <button
                type="button"
                className="story-action-btn story-delete-btn"
                onClick={() => setShowDeleteConfirm(true)}
                aria-label="Delete story"
                title="Delete story"
              >
                <Trash size={20} />
              </button>
            )
}

            {/* Close Button */}
            <button
              type="button"
              className="story-action-btn story-close-btn"
              onClick={handleClose}
              aria-label="Close story viewer"
              title="Close"
            >
              <X size={22} weight="bold" />
            </button>
          </div>
        </div>

        {/* Story Media / Content Stage with Tap Zones */}
        <div
          className="story-viewer-stage"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
        >
          {/* Direction-Aware Tap-Zone Feedback Glow */}
          {tapGlow && (
            <div
              className={`story-tap-cue story-tap-cue-${tapGlow}`}
              aria-hidden="true"
            />
          )}

          {/* Frosted Glass Pause Indicator Badge */}
          {(isPaused || isHolding) && !mediaLoading && !mediaError && (
            <div className="story-viewer-pause-badge" aria-hidden="true">
              <Pause size={18} weight="fill" />
              <span>Paused</span>
            </div>
          )}

          {/* Floating Reaction Emoji Burst */}
          {floatingReaction && (
            <div className="story-floating-burst" key={floatingReaction.id} aria-hidden="true">
              <span>{floatingReaction.emoji}</span>
            </div>
          )}

          {/* Media Loading Spinner */}
          {mediaLoading && currentStory.type !== 'text' && (
            <div className="story-media-loading" aria-label="Loading media...">
              <div className="story-spinner" />
            </div>
          )
}

          {/* Buffering Indicator for Video */}
          {isBuffering && currentStory.type === 'video' && !mediaLoading && (
            <div className="story-media-loading" aria-label="Buffering video...">
              <div className="story-spinner" />
            </div>
          )
}

          {/* Media Error State */}
          {mediaError && (
            <div className="story-media-error" role="alert">
              <p>Could not load media</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleNext}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                Skip
              </button>
            </div>
          )
}

          {/* 1. Text Story */}
          {currentStory.type === 'text' && (
            <div className={`story-text-container ${backgroundClass}`}>
              <p className="story-text-content">{currentStory.content}</p>
            </div>
          )
}

          {/* 2. Photo Story */}
          {currentStory.type === 'photo' && objectUrl && (
            <div className="story-photo-container">
              <img
                src={objectUrl}
                alt={currentStory.content || 'Story photo'}
                className="story-media-image"
              />
              {currentStory.content && (
                <div className="story-caption-overlay">
                  <p>{currentStory.content}</p>
                </div>
              )
}
            </div>
          )
}

          {/* 3. Video Story */}
          {currentStory.type === 'video' && objectUrl && (
            <div className="story-video-container">
              <video
                ref={videoRef}
                src={objectUrl}
                className="story-media-video"
                playsInline
                autoPlay
                muted={isMuted}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleNext}
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => setIsBuffering(false)}
              />
              {currentStory.content && (
                <div className="story-caption-overlay">
                  <p>{currentStory.content}</p>
                </div>
              )
}
            </div>
          )
}

          {/* Story Poll Overlay */}
          {currentStory.poll && (
            <div className="story-viewer-poll-wrap">
              <StoryPollCard
                poll={currentStory.poll}
                isOwner={isOwner}
                onVote={handlePollVote}
              />
            </div>
          )}

          {/* Story Question Overlay */}
          {currentStory.question && (
            <div className="story-viewer-question-wrap">
              <StoryQuestionCard
                key={currentStory.question.id || currentStory.id}
                question={currentStory.question}
                isOwner={isOwner}
                onRespond={handleQuestionRespond}
                onOpenDrawer={() => setShowViewersDrawer(true)}
                onAnswerFocus={() => setIsAnsweringQuestion(true)}
                onAnswerBlur={() => setIsAnsweringQuestion(false)}
              />
            </div>
          )}

          {/* Story Quiz Overlay (Phase 3) */}
          {currentStory.quiz && (
            <div className="story-viewer-poll-wrap story-viewer-quiz-wrap">
              <StoryQuizCard
                key={currentStory.quiz.id || currentStory.id}
                quiz={currentStory.quiz}
                isOwner={isOwner}
                onAnswer={handleQuizAnswer}
                onOpenDrawer={() => setShowViewersDrawer(true)}
                onQuizFocus={() => setIsAnsweringQuiz(true)}
                onQuizBlur={() => setIsAnsweringQuiz(false)}
              />
            </div>
          )}

          {/* Story Mentions Overlay (Phase 4) */}
          {currentStory.mentions && currentStory.mentions.length > 0 && (
            <div
              className="story-viewer-mentions-wrap"
              aria-label="Mentioned users"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <div className="story-viewer-mentions-list">
                {currentStory.mentions.map((m) => {
                  const uName = m.username || m.name || `User ${m.id}`
                  return (
                    <Link
                      key={m.id}
                      to={`/users/${m.id}`}
                      className="story-mention-badge"
                      aria-label={`Mentioned user @${uName}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose?.()
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                    >
                      <span className="story-mention-badge-at">@</span>
                      <span className="story-mention-badge-name">{uName}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="story-delete-confirm-overlay" role="dialog" aria-label="Confirm deletion">
            <div className="story-delete-confirm-card">
              <h3>Delete Story?</h3>
              <p>This story will be permanently removed.</p>
              {deleteError && <p className="alert alert-danger">{deleteError}</p>}
              <div className="story-delete-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
}

        {/* Reshare Confirmation Dialog */}
        {showReshareConfirm && (
          <div
            className="story-reshare-confirm-overlay"
            role="dialog"
            aria-label="Confirm story reshare"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="story-reshare-confirm-card">
              <div className="story-reshare-header">
                <ShareFat size={22} weight="fill" className="story-reshare-icon" />
                <h3>Reshare Story</h3>
              </div>
              <p className="story-reshare-desc">
                Reshare this story by <strong>{displayName}</strong> to your own story with creator attribution.
              </p>

              <div className="story-reshare-preview-box">
                <span className="story-reshare-preview-attribution">
                  Reshared from @{user?.username || displayName}
                </span>
                {currentStory.content && (
                  <p className="story-reshare-preview-quote">
                    &ldquo;{currentStory.content.length > 80 ? currentStory.content.slice(0, 80) + '…' : currentStory.content}&rdquo;
                  </p>
                )}
              </div>

              <div className="story-field">
                <label htmlFor="reshare-caption" className="story-field-label">
                  Add a caption <span className="story-optional">(optional)</span>
                </label>
                <input
                  id="reshare-caption"
                  type="text"
                  className="sc-input story-reshare-input"
                  placeholder="Say something about this story…"
                  maxLength={500}
                  value={reshareCaption}
                  onChange={(e) => setReshareCaption(e.target.value)}
                  disabled={isResharing || reshareSuccess}
                />
              </div>

              {reshareError && (
                <div className="alert alert-danger story-reshare-alert" role="alert">
                  {reshareError}
                </div>
              )}

              {reshareSuccess && (
                <div className="alert alert-success story-reshare-alert" role="status">
                  Story reshared successfully!
                </div>
              )}

              <div className="story-reshare-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleCloseReshareConfirm}
                  disabled={isResharing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleConfirmReshare}
                  disabled={isResharing || reshareSuccess}
                >
                  {isResharing ? 'Resharing…' : 'Reshare Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer: Owner Viewers Pill OR Viewer Reaction Picker + Reply Input */}
        {!showViewersDrawer && !showDeleteConfirm && (
          <div className="story-viewer-footer">
            {isOwner ? (
              <button
                type="button"
                className="story-viewers-pill-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowViewersDrawer(true)
                }}
                aria-label={`View story viewers, ${currentStory.view_count || 0} views`}
              >
                <Eye size={16} weight="bold" />
                <span>{currentStory.view_count || 0}</span>
                {(currentStory.reaction_count || 0) > 0 && (
                  <span
                    className="story-owner-reaction-pill"
                    title={`${currentStory.reaction_count} reaction${currentStory.reaction_count === 1 ? '' : 's'}`}
                  >
                    ❤️ {currentStory.reaction_count}
                  </span>
                )
}
                {(currentStory.reply_count || 0) > 0 && (
                  <span
                    className="story-owner-reply-pill"
                    title={`${currentStory.reply_count} repl${currentStory.reply_count === 1 ? 'y' : 'ies'}`}
                  >
                    💬 {currentStory.reply_count}
                  </span>
                )}
                {currentStory.poll && (
                  <span
                    className="story-owner-poll-pill"
                    title={`${currentStory.poll.total_votes || 0} vote${currentStory.poll.total_votes === 1 ? '' : 's'}`}
                  >
                    📊 {currentStory.poll.total_votes || 0}
                  </span>
                )}
                {currentStory.question && (
                  <span
                    className="story-owner-question-pill"
                    title={`${currentStory.question.response_count || 0} response${currentStory.question.response_count === 1 ? '' : 's'}`}
                  >
                    💬 {currentStory.question.response_count || 0}
                  </span>
                )}
                {currentStory.quiz && (
                  <span
                    className="story-owner-quiz-pill"
                    title={`${currentStory.quiz.response_count || 0} response${currentStory.quiz.response_count === 1 ? '' : 's'}`}
                  >
                    ❓ {currentStory.quiz.response_count || 0}
                  </span>
                )}
              </button>
            )
 : (
              /* Viewer (Account B): Instagram-Style Bottom Bar & Reaction Picker Popup */
              <div
                ref={reactionsWrapRef}
                className="story-viewer-actions-wrap"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Reaction Picker Popup */}
                {showReactionPicker && (
                  <div
                    className="story-reactions-popup"
                    role="dialog"
                    aria-label="Story reaction options"
                  >
                    <div
                      className="story-reactions-bar"
                      role="toolbar"
                      aria-label="Story reactions"
                    >
                      {STORY_REACTIONS.map(({ type, emoji, label }) => {
                        const isSelected = currentStory.my_reaction === type
                        return (
                          <button
                            key={type}
                            type="button"
                            className={`story-reaction-btn ${isSelected ? 'story-reaction-active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReactionClick(type)
                            }}
                            aria-label={`${label} reaction`}
                            aria-pressed={isSelected}
                            title={isSelected ? `Remove ${label}` : label}
                          >
                            <span className="story-reaction-emoji" aria-hidden="true">
                              {emoji}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
}

                {/* Single Horizontal Bottom Bar: Reply Input + Reaction Button */}
                <div className="story-bottom-bar-row">
                  <form
                    className="story-reply-form"
                    onSubmit={handleSendReply}
                    aria-label="Reply to story"
                  >
                    <div className="story-reply-input-wrap">
                      <input
                        type="text"
                        className="story-reply-input"
                        placeholder={`Reply to ${displayName}...`}
                        value={replyText}
                        maxLength={500}
                        onChange={(e) => {
                          setReplyText(e.target.value)
                          if (replyError) setReplyError(null)
                        }}
                        onFocus={() => {
                          setIsReplying(true)
                          setShowReactionPicker(false)
                        }}
                        onBlur={() => {
                          if (!replyText.trim()) {
                            setIsReplying(false)
                          }
                        }}
                        onKeyDown={(e) => {
                          // Prevent story navigation keys when typing in input
                          e.stopPropagation()
                        }}
                        aria-label="Reply message"
                      />
                      <button
                        type="submit"
                        className="story-reply-send-btn"
                        disabled={!replyText.trim() || sendingReply}
                        aria-label="Send reply"
                        title="Send reply"
                      >
                        {replySuccess ? (
                          <Check size={16} weight="bold" className="story-reply-check-icon" />
                        )
 : (
                          <PaperPlaneRight size={16} weight="fill" />
                        )
}
                      </button>
                    </div>
                    {replyError && (
                      <div className="story-reply-error" role="alert">
                        {replyError}
                      </div>
                    )
}
                    {replySuccess && (
                      <div className="story-reply-success" role="status">
                        Reply sent!
                      </div>
                    )
}
                  </form>

                  {isEligibleForReshare && (
                    <button
                      type="button"
                      className="story-action-btn story-reshare-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenReshareConfirm()
                      }}
                      aria-label="Reshare this story"
                      title="Reshare story"
                    >
                      <ShareFat size={20} weight="bold" />
                    </button>
                  )}

                  <button
                    type="button"
                    className={`story-reaction-trigger-btn ${showReactionPicker ? 'story-reaction-trigger-active' : ''} ${currentStory.my_reaction ? 'has-reaction' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowReactionPicker((prev) => !prev)
                    }}
                    aria-label={
                      currentStory.my_reaction
                        ? `Reaction: ${currentStory.my_reaction}. Tap to change or remove`
                        : 'Add reaction'
                    }
                    aria-expanded={showReactionPicker}
                    aria-haspopup="true"
                    title={currentStory.my_reaction ? `Reaction: ${currentStory.my_reaction}` : 'React to story'}
                  >
                    {STORY_REACTIONS.find((r) => r.type === currentStory.my_reaction) ? (
                      <span className="story-reaction-trigger-emoji" aria-hidden="true">
                        {STORY_REACTIONS.find((r) => r.type === currentStory.my_reaction).emoji}
                      </span>
                    )
 : (
                      <Heart
                        size={22}
                        weight={showReactionPicker ? 'fill' : 'regular'}
                        className="story-reaction-trigger-heart"
                      />
                    )
}
                  </button>
                </div>
              </div>
            )
}
          </div>
        )
}

        {/* Owner-Only Viewers Drawer */}
        {showViewersDrawer && (
          <StoryViewersDrawer
            storyId={currentStory.id}
            isOwner={isOwner}
            poll={currentStory.poll}
            question={currentStory.question}
            quiz={currentStory.quiz}
            onStoryCreated={(newStory) => {
              if (newStory) {
                setStories((prev) => [...prev, newStory])
              }
            }}
            onClose={() => setShowViewersDrawer(false)}
          />
        )}
      </div>

      {/* Desktop Next Button */}
      <button
        type="button"
        className="story-nav-btn story-nav-next"
        onClick={handleNext}
        aria-label="Next story"
      >
        <CaretRight size={28} weight="bold" />
      </button>
    </div>
  )
}

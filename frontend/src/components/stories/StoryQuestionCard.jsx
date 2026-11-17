import { useState, useEffect } from 'react'
import { PaperPlaneRight, Check, ChatCenteredDots, Eye } from '@phosphor-icons/react'

/**
 * StoryQuestionCard
 *
 * Interactive Instagram-style Question & Answer sticker rendered inside
 * the Story Viewer and in the Story Composer preview.
 *
 * Tap-Zone Isolation:
 * All pointer and click events are stopped from propagating so interacting with
 * the question card, typing responses, or clicking submit NEVER triggers
 * story progression or navigation.
 */
export default function StoryQuestionCard({
  question,
  isOwner = false,
  onRespond,
  onOpenDrawer,
  onAnswerFocus,
  onAnswerBlur,
  previewOnly = false,
}) {
  const [responseText, setResponseText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Reset temporary input and submission state when question changes or remounts
  useEffect(() => {
    setResponseText('')
    setSubmitError(null)
    setSubmitSuccess(false)
    setSubmitting(false)
  }, [question?.id])

  if (!question) return null

  const { question_text, response_count = 0, my_response = null } = question
  const hasResponded = my_response !== null || submitSuccess
  const displayResponse = my_response || responseText

  const handleSubmit = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (previewOnly || isOwner || hasResponded || submitting) return

    const trimmed = responseText.trim()
    if (!trimmed) {
      setSubmitError('Please enter a response.')
      return
    }

    if (trimmed.length > 500) {
      setSubmitError('Response must be 500 characters or fewer.')
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      if (onRespond) {
        await onRespond(trimmed)
      }
      setSubmitSuccess(true)
      onAnswerBlur?.()
    } catch (err) {
      const msg = err?.message || 'Failed to submit response'
      if (err?.status === 409 || msg.toLowerCase().includes('already submitted') || msg.toLowerCase().includes('already answered')) {
        setSubmitError('You have already answered this question.')
      } else if (err?.status === 401 || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('log in')) {
        setSubmitError('Please log in to submit a response.')
      } else if (err?.status === 404 || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('expired')) {
        setSubmitError('This story or question is no longer available.')
      } else {
        setSubmitError(msg)
      }
      // Ensure failed request does not leave playback permanently paused
      onAnswerBlur?.()
    } finally {
      setSubmitting(false)
    }
  }

  // Prevent event bubbling on all interaction events
  const stopPropagation = (e) => {
    e.stopPropagation()
  }

  return (
    <div
      className="story-question-card"
      role="region"
      aria-label={`Story Question: ${question_text}`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {/* Question Header Sticker */}
      <div className="story-question-header">
        <div className="story-question-badge">
          <ChatCenteredDots size={16} weight="fill" className="story-question-icon" aria-hidden="true" />
          <span>Ask me a question</span>
        </div>
        <h3 className="story-question-title">{question_text}</h3>
      </div>

      {/* Owner Mode */}
      {isOwner && !previewOnly && (
        <div className="story-question-owner-footer">
          <div className="story-question-count-badge">
            <span>{response_count} {response_count === 1 ? 'response' : 'responses'}</span>
          </div>
          {onOpenDrawer && (
            <button
              type="button"
              className="btn btn-secondary btn-sm story-question-view-btn"
              onClick={(e) => {
                e.stopPropagation()
                onOpenDrawer()
              }}
              aria-label={`View ${response_count} responses`}
            >
              <Eye size={16} weight="bold" aria-hidden="true" />
              <span>See responses</span>
            </button>
          )}
        </div>
      )}

      {/* Viewer Mode: Has Responded or Success View */}
      {!isOwner && hasResponded && (
        <div className="story-question-responded-box" role="status" aria-live="polite">
          <div className="story-question-responded-tag">
            <Check size={14} weight="bold" className="story-question-check" aria-hidden="true" />
            <span>{submitSuccess ? 'Response sent!' : 'You answered:'}</span>
          </div>
          <p className="story-question-my-answer">{displayResponse}</p>
        </div>
      )}

      {/* Viewer Mode: Form to Respond */}
      {!isOwner && !hasResponded && !previewOnly && (
        <form className="story-question-form" onSubmit={handleSubmit} noValidate>
          <div className="story-question-input-wrap">
            <textarea
              className="story-question-textarea"
              rows={2}
              maxLength={500}
              placeholder="Type your response…"
              value={responseText}
              onChange={(e) => {
                setResponseText(e.target.value)
                if (submitError) setSubmitError(null)
              }}
              onFocus={() => onAnswerFocus?.()}
              onBlur={() => onAnswerBlur?.()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  e.currentTarget.blur()
                  onAnswerBlur?.()
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
              disabled={submitting}
              aria-label="Type your response"
              aria-invalid={Boolean(submitError)}
              aria-describedby={submitError ? 'story-question-err' : undefined}
            />
            <div className="story-question-input-footer">
              <span className="story-question-char-count" aria-live="polite">
                {responseText.length} / 500
              </span>
              <button
                type="submit"
                className="btn btn-primary btn-sm story-question-send-btn"
                disabled={!responseText.trim() || submitting}
                aria-label={submitting ? 'Sending response…' : 'Send response'}
                aria-busy={submitting}
              >
                <PaperPlaneRight size={14} weight="fill" aria-hidden="true" />
                <span>{submitting ? 'Sending…' : 'Send'}</span>
              </button>
            </div>
          </div>

          {submitError && (
            <p id="story-question-err" className="story-question-error" role="alert">
              {submitError}
            </p>
          )}
        </form>
      )}

      {/* Preview Mode inside Story Composer */}
      {previewOnly && (
        <div className="story-question-preview-hint">
          <span>Viewers can type a response here</span>
        </div>
      )}
    </div>
  )
}

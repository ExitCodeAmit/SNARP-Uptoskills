import { useState, useEffect } from 'react'
import { Question, Check, X, Eye } from '@phosphor-icons/react'

/**
 * StoryQuizCard
 *
 * Interactive Instagram-style Quiz Sticker rendered inside the Story Viewer
 * and in the Story Composer preview.
 *
 * Tap-Zone Isolation:
 * All pointer and click events are stopped from propagating so interacting with
 * the quiz card or selecting options NEVER triggers story progression or navigation.
 */
export default function StoryQuizCard({
  quiz,
  isOwner = false,
  onAnswer,
  onOpenDrawer,
  onAnswerFocus,
  onAnswerBlur,
  previewOnly = false,
}) {
  const [submittingOptionId, setSubmittingOptionId] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [localAnswer, setLocalAnswer] = useState(null)

  // Reset temporary interaction state when quiz changes or remounts
  useEffect(() => {
    setSubmittingOptionId(null)
    setSubmitError(null)
    setLocalAnswer(null)
  }, [quiz?.id])

  if (!quiz) return null

  const {
    question_text,
    options = [],
    correct_option_id = null,
    total_responses = 0,
    my_answer = null,
  } = quiz

  const selectedAnswerId = my_answer || localAnswer
  const hasAnswered = Boolean(selectedAnswerId)
  const showResults = Boolean(hasAnswered || isOwner || previewOnly)

  const handleSelectOption = async (optionId) => {
    if (previewOnly || isOwner || hasAnswered || submittingOptionId) return

    setSubmittingOptionId(optionId)
    setSubmitError(null)
    onAnswerFocus?.()

    try {
      if (onAnswer) {
        await onAnswer(optionId)
      }
      setLocalAnswer(optionId)
    } catch (err) {
      setSubmitError(err?.message || 'Failed to submit quiz answer')
    } finally {
      setSubmittingOptionId(null)
      onAnswerBlur?.()
    }
  }

  const stopPropagation = (e) => {
    e.stopPropagation()
  }

  return (
    <div
      className="story-quiz-card"
      role="region"
      aria-label={`Story Quiz: ${question_text}`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {/* Quiz Header Sticker */}
      <div className="story-quiz-header">
        <div className="story-quiz-badge">
          <Question size={16} weight="fill" className="story-quiz-icon" aria-hidden="true" />
          <span>Story Quiz</span>
        </div>
        <h3 className="story-quiz-title">{question_text}</h3>
      </div>

      {/* Options List */}
      <div
        className="story-quiz-options-list"
        role="group"
        aria-label="Quiz options"
      >
        {options.map((opt, idx) => {
          const optId = String(opt.id)
          const isSelected = String(selectedAnswerId) === optId
          const isCorrect = String(correct_option_id) === optId || Boolean(opt.is_correct)
          const isSubmittingThis = String(submittingOptionId) === optId

          let statusClass = ''
          if (showResults) {
            if (isCorrect) {
              statusClass = 'quiz-opt-correct'
            } else if (isSelected && !isCorrect) {
              statusClass = 'quiz-opt-incorrect'
            } else {
              statusClass = 'quiz-opt-unselected'
            }
          }

          const percentage = typeof opt.percentage === 'number' ? opt.percentage : 0

          return (
            <button
              key={opt.id || idx}
              type="button"
              className={`story-quiz-option-btn ${statusClass} ${isSelected ? 'is-selected' : ''}`}
              onClick={() => handleSelectOption(opt.id)}
              disabled={showResults || Boolean(submittingOptionId)}
              aria-label={`${opt.option_text}${showResults && isCorrect ? ', Correct answer' : ''}${showResults && isSelected ? ', Your answer' : ''}`}
              aria-pressed={isSelected}
              aria-busy={isSubmittingThis}
            >
              {/* Result background percentage fill bar */}
              {showResults && !previewOnly && (
                <div
                  className="story-quiz-bar-fill"
                  style={{ width: `${percentage}%` }}
                  aria-hidden="true"
                />
              )}

              <div className="story-quiz-opt-inner">
                <span className="story-quiz-letter-badge" aria-hidden="true">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="story-quiz-opt-text">{opt.option_text}</span>

                {/* Status icon or percentage */}
                <div className="story-quiz-opt-status">
                  {isSubmittingThis && (
                    <span className="story-spinner-sm" aria-hidden="true" />
                  )}

                  {showResults && isCorrect && (
                    <Check size={18} weight="bold" className="quiz-icon-check" aria-hidden="true" />
                  )}

                  {showResults && isSelected && !isCorrect && (
                    <X size={18} weight="bold" className="quiz-icon-cross" aria-hidden="true" />
                  )}

                  {showResults && !previewOnly && (
                    <span className="story-quiz-percentage">{percentage}%</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Error state */}
      {submitError && (
        <p className="story-quiz-error" role="alert">
          {submitError}
        </p>
      )}

      {/* Owner Mode Footer */}
      {isOwner && !previewOnly && (
        <div className="story-quiz-owner-footer">
          <div className="story-quiz-count-badge">
            <span>{total_responses} {total_responses === 1 ? 'response' : 'responses'}</span>
          </div>
          {onOpenDrawer && (
            <button
              type="button"
              className="btn btn-secondary btn-sm story-quiz-view-btn"
              onClick={(e) => {
                e.stopPropagation()
                onOpenDrawer()
              }}
              aria-label={`View ${total_responses} responses`}
            >
              <Eye size={16} weight="bold" aria-hidden="true" />
              <span>See responses</span>
            </button>
          )}
        </div>
      )}

      {/* Preview Mode Hint */}
      {previewOnly && (
        <div className="story-quiz-preview-hint">
          <span>Correct answer marked above (revealed to viewers after answering)</span>
        </div>
      )}
    </div>
  )
}

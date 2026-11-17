import { useState } from 'react'
import { Check } from '@phosphor-icons/react'

/**
 * StoryPollCard
 *
 * Interactive Instagram-style poll card rendered inside the Story Viewer
 * and in the Story Composer preview.
 *
 * Tap-Zone Isolation:
 * All pointer and click events are stopped from propagating so clicking or
 * tapping poll options NEVER triggers story progression or navigation.
 */
export default function StoryPollCard({
  poll,
  isOwner = false,
  onVote,
  previewOnly = false,
}) {
  const [voting, setVoting] = useState(false)
  const [voteError, setVoteError] = useState(null)

  if (!poll) return null

  const { question, options = [], total_votes = 0, my_vote = null } = poll
  const hasVoted = my_vote !== null || isOwner

  // Calculate total votes if not directly provided
  const effectiveTotalVotes = typeof total_votes === 'number'
    ? total_votes
    : options.reduce((sum, o) => sum + (Number(o.vote_count) || 0), 0)

  const handleOptionClick = async (e, optionId) => {
    e.stopPropagation()
    if (previewOnly || hasVoted || voting || !onVote) return

    setVoting(true)
    setVoteError(null)
    try {
      await onVote(optionId)
    } catch (err) {
      setVoteError(err?.message || 'Failed to submit vote')
    } finally {
      setVoting(false)
    }
  }

  // Prevent event bubbling on all interaction events
  const stopPropagation = (e) => {
    e.stopPropagation()
  }

  return (
    <div
      className="story-poll-card"
      role="region"
      aria-label={`Story Poll: ${question}`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onTouchStart={stopPropagation}
    >
      <div className="story-poll-question">
        <span>{question}</span>
      </div>

      <div className="story-poll-options" role="group" aria-label="Poll options">
        {options.map((option) => {
          const isSelected = my_vote === option.id
          const voteCount = Number(option.vote_count) || 0
          const pct = typeof option.percentage === 'number'
            ? option.percentage
            : (effectiveTotalVotes > 0 ? Math.round((voteCount / effectiveTotalVotes) * 100) : 0)

          if (hasVoted || previewOnly) {
            // Results Mode (voted, owner, or preview)
            return (
              <div
                key={option.id || option.option_text}
                className={`story-poll-result-bar ${isSelected ? 'story-poll-selected' : ''}`}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${option.option_text}: ${pct}%, ${voteCount} votes`}
              >
                <div
                  className={`story-poll-result-fill ${isSelected ? 'story-poll-selected-fill' : ''}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="story-poll-result-content">
                  <span className="story-poll-result-text">
                    {isSelected && <Check size={14} weight="bold" className="story-poll-check" />}
                    {option.option_text}
                  </span>
                  <span className="story-poll-result-pct">{pct}%</span>
                </div>
              </div>
            )
          }

          // Voting Mode (active viewer who has not yet voted)
          return (
            <button
              key={option.id}
              type="button"
              className="story-poll-option-btn"
              onClick={(e) => handleOptionClick(e, option.id)}
              disabled={voting}
              aria-label={`Vote for ${option.option_text}`}
            >
              <span>{option.option_text}</span>
            </button>
          )
        })}
      </div>

      <div className="story-poll-footer">
        {hasVoted && !previewOnly && (
          <span className="story-poll-votes-count">
            {effectiveTotalVotes} {effectiveTotalVotes === 1 ? 'vote' : 'votes'}
          </span>
        )}
        {voteError && (
          <span className="story-poll-error" role="alert">
            {voteError}
          </span>
        )}
      </div>
    </div>
  )
}

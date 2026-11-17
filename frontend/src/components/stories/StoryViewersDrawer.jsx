import { useState, useEffect, useCallback } from 'react'
import { X, Eye, ChatCircle, ChartBar, ChatCenteredDots, ShareFat, Question, CheckCircle } from '@phosphor-icons/react'
import { api } from '../../api'
import { Avatar } from '../ui'
import { timeAgo, formatDisplayName } from '../../format'
import { STORY_REACTIONS } from './storyHelpers.js'
import './stories.css'

/**
 * StoryViewersDrawer Component
 *
 * Owner-only slide-up drawer / bottom sheet showing:
 * - Viewers tab: list of viewers with viewed timestamps and reaction emojis.
 * - Replies tab: list of replies received with sender details, timestamps, and message bubbles.
 * - Poll tab: question breakdown, option percentages, and voter identities.
 * - Questions tab: submitted responses to Story question sticker and "Share as Story" action.
 * - Quiz tab: question breakdown, correctness stats, option percentages, and responder identities.
 */
export default function StoryViewersDrawer({
  storyId,
  isOwner = false,
  poll = null,
  question = null,
  quiz = null,
  onStoryCreated = null,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('viewers') // 'viewers' | 'replies' | 'poll' | 'questions' | 'quiz'

  // Viewers state
  const [viewers, setViewers] = useState([])
  const [viewCount, setViewCount] = useState(0)
  const [loadingViewers, setLoadingViewers] = useState(true)
  const [viewersError, setViewersError] = useState(null)

  // Replies state
  const [replies, setReplies] = useState([])
  const [replyCount, setReplyCount] = useState(0)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [repliesError, setRepliesError] = useState(null)

  // Poll state
  const [pollData, setPollData] = useState(null)
  const [loadingPoll, setLoadingPoll] = useState(false)
  const [pollError, setPollError] = useState(null)

  // Questions state
  const [questionData, setQuestionData] = useState(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [questionsError, setQuestionsError] = useState(null)
  const [sharingResponseId, setSharingResponseId] = useState(null)
  const [shareSuccessId, setShareSuccessId] = useState(null)
  const [shareErrors, setShareErrors] = useState({})

  // Quiz state (Phase 3)
  const [quizData, setQuizData] = useState(null)
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [quizError, setQuizError] = useState(null)

  const fetchViewers = useCallback(() => {
    if (!storyId || !isOwner) {
      setLoadingViewers(false)
      return () => {}
    }

    let active = true
    setLoadingViewers(true)
    setViewersError(null)

    api(`/stories/${storyId}/viewers`)
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.viewers) ? data.viewers : []
        setViewers(list)
        setViewCount(typeof data?.viewCount === 'number' ? data.viewCount : list.length)
        setLoadingViewers(false)
      })
      .catch((err) => {
        if (!active) return
        setViewersError(err?.message || 'Could not load viewers')
        setLoadingViewers(false)
      })

    return () => {
      active = false
    }
  }, [storyId, isOwner])

  const fetchReplies = useCallback(() => {
    if (!storyId || !isOwner) {
      setLoadingReplies(false)
      return () => {}
    }

    let active = true
    setLoadingReplies(true)
    setRepliesError(null)

    api(`/stories/${storyId}/replies`)
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.replies) ? data.replies : []
        setReplies(list)
        setReplyCount(typeof data?.count === 'number' ? data.count : list.length)
        setLoadingReplies(false)
      })
      .catch((err) => {
        if (!active) return
        setRepliesError(err?.message || 'Could not load replies')
        setLoadingReplies(false)
      })

    return () => {
      active = false
    }
  }, [storyId, isOwner])

  const fetchPollData = useCallback(() => {
    if (!storyId || !isOwner || !poll) {
      setLoadingPoll(false)
      return () => {}
    }

    let active = true
    setLoadingPoll(true)
    setPollError(null)

    api(`/stories/${storyId}/polls/voters`)
      .then((data) => {
        if (!active) return
        setPollData(data)
        setLoadingPoll(false)
      })
      .catch((err) => {
        if (!active) return
        setPollError(err?.message || 'Could not load poll results')
        setLoadingPoll(false)
      })

    return () => {
      active = false
    }
  }, [storyId, isOwner, poll])

  const fetchQuestionResponses = useCallback(() => {
    if (!storyId || !isOwner || !question) {
      setLoadingQuestions(false)
      return () => {}
    }

    let active = true
    setLoadingQuestions(true)
    setQuestionsError(null)

    api(`/stories/${storyId}/questions/responses`)
      .then((data) => {
        if (!active) return
        setQuestionData(data)
        setLoadingQuestions(false)
      })
      .catch((err) => {
        if (!active) return
        setQuestionsError(err?.message || 'Could not load question responses')
        setLoadingQuestions(false)
      })

    return () => {
      active = false
    }
  }, [storyId, isOwner, question])

  const fetchQuizData = useCallback(() => {
    if (!storyId || !isOwner || !quiz) {
      setLoadingQuiz(false)
      return () => {}
    }

    let active = true
    setLoadingQuiz(true)
    setQuizError(null)

    api(`/stories/${storyId}/quizzes/responses`)
      .then((data) => {
        if (!active) return
        setQuizData(data)
        setLoadingQuiz(false)
      })
      .catch((err) => {
        if (!active) return
        setQuizError(err?.message || 'Could not load quiz responses')
        setLoadingQuiz(false)
      })

    return () => {
      active = false
    }
  }, [storyId, isOwner, quiz])

  const handleShareResponse = async (responseId) => {
    if (!storyId || !responseId || sharingResponseId) return
    setSharingResponseId(responseId)
    setShareErrors((prev) => ({ ...prev, [responseId]: null }))
    try {
      const res = await api(`/stories/${storyId}/questions/share`, {
        method: 'POST',
        body: { responseId },
      })
      if (res?.story) {
        onStoryCreated?.(res.story)
        setShareSuccessId(responseId)
        // Update local response list so shared_story_id is marked
        setQuestionData((prev) => {
          if (!prev?.responses) return prev
          return {
            ...prev,
            responses: prev.responses.map((r) =>
              r.id === responseId ? { ...r, shared_story_id: res.story.id } : r
            ),
          }
        })
        setTimeout(() => setShareSuccessId(null), 3000)
      }
    } catch (err) {
      const msg = err?.message || 'Failed to share answer as story'
      if (err?.status === 409 || msg.toLowerCase().includes('already') || msg.toLowerCase().includes('conflict')) {
        // Mark locally as shared and notify owner
        setQuestionData((prev) => {
          if (!prev?.responses) return prev
          return {
            ...prev,
            responses: prev.responses.map((r) =>
              r.id === responseId ? { ...r, shared_story_id: 'already-shared' } : r
            ),
          }
        })
        setShareErrors((prev) => ({ ...prev, [responseId]: 'This response has already been shared.' }))
      } else {
        setShareErrors((prev) => ({ ...prev, [responseId]: msg }))
      }
    } finally {
      setSharingResponseId(null)
    }
  }

  useEffect(() => {
    const cancelViewers = fetchViewers()
    const cancelReplies = fetchReplies()
    const cancelPoll = fetchPollData()
    const cancelQuestions = fetchQuestionResponses()
    const cancelQuiz = fetchQuizData()
    return () => {
      if (typeof cancelViewers === 'function') cancelViewers()
      if (typeof cancelReplies === 'function') cancelReplies()
      if (typeof cancelPoll === 'function') cancelPoll()
      if (typeof cancelQuestions === 'function') cancelQuestions()
      if (typeof cancelQuiz === 'function') cancelQuiz()
    }
  }, [fetchViewers, fetchReplies, fetchPollData, fetchQuestionResponses, fetchQuizData])

  if (!isOwner) {
    return (
      <div
        className="story-viewers-drawer-overlay"
        onClick={onClose}
        role="dialog"
        aria-label="Viewer analytics"
      >
        <div className="story-viewers-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="story-drawer-handle" aria-hidden="true" />
          <div className="story-viewers-header">
            <h3>Viewer analytics</h3>
            <button
              type="button"
              className="icon-btn story-viewers-close"
              onClick={onClose}
              aria-label="Close viewers drawer"
            >
              <X size={20} />
            </button>
          </div>
          <div className="story-viewers-error">
            <p>Only the story owner can view viewer analytics.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="story-viewers-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Story analytics and replies"
    >
      <div className="story-viewers-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Mobile drag handle visual affordance */}
        <div className="story-drawer-handle" aria-hidden="true" />

        {/* Drawer Header with Tabs */}
        <div className="story-viewers-header">
          <div className="story-drawer-tabs" role="tablist" aria-label="Story analytics">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'viewers'}
              className={`story-drawer-tab ${activeTab === 'viewers' ? 'story-drawer-tab-active' : ''}`}
              onClick={() => setActiveTab('viewers')}
            >
              <Eye size={18} weight={activeTab === 'viewers' ? 'bold' : 'regular'} />
              <span>Viewers</span>
              <span className="story-viewers-badge">{viewCount}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'replies'}
              className={`story-drawer-tab ${activeTab === 'replies' ? 'story-drawer-tab-active' : ''}`}
              onClick={() => setActiveTab('replies')}
            >
              <ChatCircle size={18} weight={activeTab === 'replies' ? 'bold' : 'regular'} />
              <span>Replies</span>
              <span className="story-viewers-badge">{replyCount}</span>
            </button>

            {poll && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'poll'}
                className={`story-drawer-tab ${activeTab === 'poll' ? 'story-drawer-tab-active' : ''}`}
                onClick={() => setActiveTab('poll')}
              >
                <ChartBar size={18} weight={activeTab === 'poll' ? 'bold' : 'regular'} />
                <span>Poll</span>
                <span className="story-viewers-badge">
                  {pollData?.totalVotes ?? poll.total_votes ?? 0}
                </span>
              </button>
            )}

            {question && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'questions'}
                className={`story-drawer-tab ${activeTab === 'questions' ? 'story-drawer-tab-active' : ''}`}
                onClick={() => setActiveTab('questions')}
              >
                <ChatCenteredDots size={18} weight={activeTab === 'questions' ? 'bold' : 'regular'} />
                <span>Questions</span>
                <span className="story-viewers-badge">
                  {questionData?.totalResponses ?? question.response_count ?? 0}
                </span>
              </button>
            )}

            {quiz && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'quiz'}
                className={`story-drawer-tab ${activeTab === 'quiz' ? 'story-drawer-tab-active' : ''}`}
                onClick={() => setActiveTab('quiz')}
              >
                <Question size={18} weight={activeTab === 'quiz' ? 'bold' : 'regular'} />
                <span>Quiz</span>
                <span className="story-viewers-badge">
                  {quizData?.totalResponses ?? quiz.response_count ?? 0}
                </span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="icon-btn story-viewers-close"
            onClick={onClose}
            aria-label="Close analytics drawer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="story-viewers-content">
          {/* 1. Viewers Tab */}
          {activeTab === 'viewers' && (
            <>
              {loadingViewers && (
                <div className="story-viewers-loading" aria-live="polite">
                  <div className="story-spinner" />
                  <span>Loading viewers…</span>
                </div>
              )}

              {!loadingViewers && viewersError && (
                <div className="story-viewers-error" role="alert">
                  <p>{viewersError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={fetchViewers}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loadingViewers && !viewersError && viewers.length === 0 && (
                <div className="story-viewers-empty">
                  <Eye size={36} className="muted-icon" />
                  <p>No views yet</p>
                  <span>When other users view your story, they will appear here.</span>
                </div>
              )}

              {!loadingViewers && !viewersError && viewers.length > 0 && (
                <ul className="story-viewers-list" role="list">
                  {viewers.map((viewer) => {
                    const reactionItem = STORY_REACTIONS.find((r) => r.type === viewer.reaction_type)
                    return (
                      <li key={viewer.id} className="story-viewer-row" role="listitem">
                        <Avatar name={formatDisplayName(viewer.name)} src={viewer.avatar_url} size="sm" />
                        <div className="story-viewer-row-info">
                          <span className="story-viewer-row-name">{formatDisplayName(viewer.name)}</span>
                          <time className="story-viewer-row-time" dateTime={viewer.viewed_at}>
                            {timeAgo(viewer.viewed_at)}
                          </time>
                        </div>
                        {reactionItem && (
                          <span
                            className="story-viewer-row-reaction"
                            title={`Reacted ${reactionItem.label}`}
                            aria-label={`Reacted ${reactionItem.label}`}
                          >
                            {reactionItem.emoji}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {/* 2. Replies Tab */}
          {activeTab === 'replies' && (
            <>
              {loadingReplies && (
                <div className="story-viewers-loading" aria-live="polite">
                  <div className="story-spinner" />
                  <span>Loading replies…</span>
                </div>
              )}

              {!loadingReplies && repliesError && (
                <div className="story-viewers-error" role="alert">
                  <p>{repliesError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={fetchReplies}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loadingReplies && !repliesError && replies.length === 0 && (
                <div className="story-viewers-empty">
                  <ChatCircle size={36} className="muted-icon" />
                  <p>No replies yet</p>
                  <span>When viewers reply to your story, their messages will appear here.</span>
                </div>
              )}

              {!loadingReplies && !repliesError && replies.length > 0 && (
                <ul className="story-replies-list" role="list">
                  {replies.map((reply) => (
                    <li key={reply.id} className="story-reply-row" role="listitem">
                      <Avatar name={formatDisplayName(reply.sender_name)} src={reply.sender_avatar_url} size="sm" />
                      <div className="story-reply-content">
                        <div className="story-reply-meta">
                          <span className="story-reply-sender">{formatDisplayName(reply.sender_name)}</span>
                          <time className="story-reply-time" dateTime={reply.created_at}>
                            {timeAgo(reply.created_at)}
                          </time>
                        </div>
                        <p className="story-reply-bubble">{reply.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* 3. Poll Tab */}
          {activeTab === 'poll' && (
            <>
              {loadingPoll && (
                <div className="story-viewers-loading" aria-live="polite">
                  <div className="story-spinner" />
                  <span>Loading poll results…</span>
                </div>
              )}

              {!loadingPoll && pollError && (
                <div className="story-viewers-error" role="alert">
                  <p>{pollError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={fetchPollData}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loadingPoll && !pollError && pollData && (
                <div className="story-drawer-poll-view">
                  <div className="story-drawer-poll-header">
                    <h4 className="story-drawer-poll-q">{pollData.question}</h4>
                    <span className="story-drawer-poll-summary">
                      {pollData.totalVotes} {pollData.totalVotes === 1 ? 'vote' : 'votes'} total
                    </span>
                  </div>

                  {pollData.totalVotes === 0 ? (
                    <div className="story-viewers-empty">
                      <ChartBar size={36} className="muted-icon" />
                      <p>No votes yet</p>
                      <span>When viewers vote on your poll, their answers will appear here.</span>
                    </div>
                  ) : (
                    <div className="story-drawer-poll-breakdown">
                      {pollData.options?.map((opt) => (
                        <div key={opt.id} className="story-drawer-poll-option-card">
                          <div className="story-drawer-poll-option-top">
                            <span className="story-drawer-poll-option-title">{opt.option_text}</span>
                            <span className="story-drawer-poll-option-meta">
                              <strong>{opt.percentage}%</strong> ({opt.vote_count} {opt.vote_count === 1 ? 'vote' : 'votes'})
                            </span>
                          </div>
                          <div className="story-drawer-poll-bar-track">
                            <div
                              className="story-drawer-poll-bar-fill"
                              style={{ width: `${opt.percentage}%` }}
                            />
                          </div>

                          {/* Voters list for this option */}
                          {opt.voters && opt.voters.length > 0 ? (
                            <ul className="story-drawer-poll-voters-list" role="list">
                              {opt.voters.map((voter) => (
                                <li key={voter.user_id} className="story-viewer-row" role="listitem">
                                  <Avatar
                                    name={formatDisplayName(voter.voter_name || voter.voter_full_name || voter.voter_username)}
                                    src={voter.voter_avatar_url}
                                    size="sm"
                                  />
                                  <div className="story-viewer-row-info">
                                    <span className="story-viewer-row-name">
                                      {formatDisplayName(voter.voter_name || voter.voter_full_name || voter.voter_username)}
                                    </span>
                                    <time className="story-viewer-row-time" dateTime={voter.created_at}>
                                      {timeAgo(voter.created_at)}
                                    </time>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="story-drawer-poll-no-voters">No votes for this option</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 4. Questions Tab */}
          {activeTab === 'questions' && (
            <>
              {loadingQuestions && (
                <div className="story-viewers-loading" aria-live="polite">
                  <div className="story-spinner" />
                  <span>Loading question responses…</span>
                </div>
              )}

              {!loadingQuestions && questionsError && (
                <div className="story-viewers-error" role="alert">
                  <p>{questionsError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => fetchQuestionResponses()}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loadingQuestions && !questionsError && (
                <div className="story-drawer-questions-view">
                  <div className="story-drawer-question-header">
                    <span className="story-drawer-question-badge">Question Sticker</span>
                    <h4 className="story-drawer-question-prompt">
                      {questionData?.question || question?.question_text}
                    </h4>
                    <span className="story-drawer-question-summary">
                      {questionData?.totalResponses ?? question?.response_count ?? 0}{' '}
                      {(questionData?.totalResponses ?? question?.response_count ?? 0) === 1
                        ? 'response'
                        : 'responses'}
                    </span>
                  </div>

                  {(questionData?.responses?.length || 0) === 0 ? (
                    <div className="story-viewers-empty">
                      <ChatCenteredDots size={36} className="muted-icon" />
                      <p>No responses yet</p>
                      <span>When viewers answer your question sticker, their responses will appear here.</span>
                    </div>
                  ) : (
                    <ul className="story-drawer-question-responses-list" role="list">
                      {questionData.responses.map((resp) => {
                        const isSharing = sharingResponseId === resp.id
                        const isShared = Boolean(resp.shared_story_id)
                        const responderName = formatDisplayName(
                          resp.responder_name || resp.responder_full_name || resp.responder_username
                        )
                        return (
                          <li key={resp.id} className="story-drawer-question-response-card" role="listitem">
                            <div className="story-drawer-response-top">
                              <Avatar
                                name={responderName}
                                src={resp.responder_avatar_url}
                                size="sm"
                              />
                              <div className="story-drawer-response-meta">
                                <span className="story-drawer-response-name">{responderName}</span>
                                <time className="story-drawer-response-time" dateTime={resp.created_at}>
                                  {timeAgo(resp.created_at)}
                                </time>
                              </div>
                            </div>

                            <div className="story-drawer-response-bubble">
                              <p>{resp.response_text}</p>
                            </div>

                            <div className="story-drawer-response-actions">
                              {isShared ? (
                                <span className="story-drawer-shared-badge">
                                  ✓ Shared to Story
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm story-drawer-share-btn"
                                  onClick={() => handleShareResponse(resp.id)}
                                  disabled={Boolean(sharingResponseId) || isShared}
                                  aria-label={isSharing ? 'Sharing answer…' : 'Share answer as new story'}
                                  aria-busy={isSharing}
                                >
                                  <ShareFat size={14} weight="bold" aria-hidden="true" />
                                  <span>{isSharing ? 'Sharing…' : 'Share as Story'}</span>
                                </button>
                              )}
                              {shareSuccessId === resp.id && (
                                <span className="story-drawer-share-toast" role="status">
                                  Shared to your Story!
                                </span>
                              )}
                              {shareErrors[resp.id] && (
                                <span className="story-drawer-share-error" role="alert">
                                  {shareErrors[resp.id]}
                                </span>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {/* 5. Quiz Tab (Phase 3) */}
          {activeTab === 'quiz' && (
            <>
              {loadingQuiz && (
                <div className="story-viewers-loading" aria-live="polite">
                  <div className="story-spinner" />
                  <span>Loading quiz results…</span>
                </div>
              )}

              {!loadingQuiz && quizError && (
                <div className="story-viewers-error" role="alert">
                  <p>{quizError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={fetchQuizData}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loadingQuiz && !quizError && quizData && (
                <div className="story-drawer-poll-view story-drawer-quiz-view">
                  <div className="story-drawer-poll-header story-drawer-quiz-header">
                    <span className="story-drawer-quiz-badge">Story Quiz</span>
                    <h4 className="story-drawer-poll-q">{quizData.question}</h4>
                    <span className="story-drawer-poll-summary">
                      {quizData.totalResponses} {quizData.totalResponses === 1 ? 'response' : 'responses'} total
                      {quizData.totalResponses > 0 && typeof quizData.correctCount === 'number' && (
                        <> · {quizData.correctCount} correct ({Math.round((quizData.correctCount / quizData.totalResponses) * 100)}%)</>
                      )}
                    </span>
                  </div>

                  {quizData.totalResponses === 0 ? (
                    <div className="story-viewers-empty">
                      <Question size={36} className="muted-icon" />
                      <p>No answers yet</p>
                      <span>When viewers answer your quiz, their responses and accuracy will appear here.</span>
                    </div>
                  ) : (
                    <div className="story-drawer-poll-breakdown story-drawer-quiz-breakdown">
                      {quizData.options?.map((opt, optIdx) => {
                        const letter = String.fromCharCode(65 + optIdx)
                        const isCorrect = Boolean(opt.is_correct || opt.id === quizData.correct_option_id)
                        const respCount = opt.response_count ?? opt.vote_count ?? 0
                        return (
                          <div
                            key={opt.id}
                            className={`story-drawer-poll-option-card story-drawer-quiz-option-card ${isCorrect ? 'story-drawer-quiz-correct-card' : ''}`}
                          >
                            <div className="story-drawer-poll-option-top">
                              <div className="story-drawer-quiz-opt-heading">
                                <span className={`story-quiz-letter ${isCorrect ? 'story-quiz-letter-correct' : ''}`}>{letter}</span>
                                <span className="story-drawer-poll-option-title">{opt.option_text}</span>
                                {isCorrect && (
                                  <span className="story-drawer-quiz-correct-pill">
                                    <CheckCircle size={14} weight="fill" /> Correct Answer
                                  </span>
                                )}
                              </div>
                              <span className="story-drawer-poll-option-meta">
                                <strong>{opt.percentage ?? 0}%</strong> ({respCount} {respCount === 1 ? 'response' : 'responses'})
                              </span>
                            </div>
                            <div className="story-drawer-poll-bar-track">
                              <div
                                className={`story-drawer-poll-bar-fill ${isCorrect ? 'story-drawer-quiz-bar-correct' : ''}`}
                                style={{ width: `${opt.percentage ?? 0}%` }}
                              />
                            </div>

                            {/* Responders list for this option */}
                            {opt.responders && opt.responders.length > 0 ? (
                              <ul className="story-drawer-poll-voters-list story-drawer-quiz-responders-list" role="list">
                                {opt.responders.map((resp) => {
                                  const name = formatDisplayName(resp.responder_name || resp.responder_full_name || resp.responder_username)
                                  return (
                                    <li key={resp.user_id} className="story-viewer-row" role="listitem">
                                      <Avatar
                                        name={name}
                                        src={resp.responder_avatar_url}
                                        size="sm"
                                      />
                                      <div className="story-viewer-row-info">
                                        <span className="story-viewer-row-name">{name}</span>
                                        <time className="story-viewer-row-time" dateTime={resp.created_at}>
                                          {timeAgo(resp.created_at)}
                                        </time>
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : (
                              <span className="story-drawer-poll-no-voters">No responses for this option</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

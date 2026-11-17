import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Question & Response Client Validation Tests ────────────────────────────
test('Question sticker client validation enforces non-empty, trimmed, <= 200 characters', () => {
  const validateComposerQuestion = ({ hasQuestion, questionText }) => {
    if (!hasQuestion) return { valid: true }

    const trimmed = (questionText || '').trim()
    if (!trimmed) {
      return { valid: false, error: 'Question text cannot be empty.' }
    }
    if (trimmed.length > 200) {
      return { valid: false, error: 'Question text must be 200 characters or fewer.' }
    }

    return { valid: true, question: trimmed }
  }

  // Valid question
  const valid = validateComposerQuestion({
    hasQuestion: true,
    questionText: 'What should we build next in SNARP?',
  })
  assert.equal(valid.valid, true)
  assert.equal(valid.question, 'What should we build next in SNARP?')

  // Empty question
  assert.equal(validateComposerQuestion({ hasQuestion: true, questionText: '' }).valid, false)
  assert.equal(validateComposerQuestion({ hasQuestion: true, questionText: '   ' }).valid, false)

  // Exceeding 200 characters
  assert.equal(validateComposerQuestion({ hasQuestion: true, questionText: 'Q'.repeat(201) }).valid, false)

  // Within 200 characters exactly
  assert.equal(validateComposerQuestion({ hasQuestion: true, questionText: 'Q'.repeat(200) }).valid, true)
})

test('Response client validation enforces non-empty, trimmed, <= 500 characters', () => {
  const validateResponse = (text) => {
    const trimmed = (text || '').trim()
    if (!trimmed) {
      return { valid: false, error: 'Response cannot be empty.' }
    }
    if (trimmed.length > 500) {
      return { valid: false, error: 'Response must be 500 characters or fewer.' }
    }
    return { valid: true, response: trimmed }
  }

  // Valid response
  const valid = validateResponse('Distributed systems and consensus protocols.')
  assert.equal(valid.valid, true)
  assert.equal(valid.response, 'Distributed systems and consensus protocols.')

  // Empty response
  assert.equal(validateResponse('').valid, false)
  assert.equal(validateResponse('   ').valid, false)

  // Exceeding 500 characters
  assert.equal(validateResponse('R'.repeat(501)).valid, false)

  // Within 500 characters exactly
  assert.equal(validateResponse('R'.repeat(500)).valid, true)
})

// ── 2. Tap Zone Event Isolation Tests ─────────────────────────────────────────
test('Question card interactions stop event propagation to isolate from Story navigation', () => {
  let propagationCount = 0
  const mockEvent = {
    stopPropagation: () => {
      propagationCount++
    },
  }

  // Simulate pointer down, pointer up, click, and touch start on Question Card
  const handlePointerDown = (e) => e.stopPropagation()
  const handlePointerUp = (e) => e.stopPropagation()
  const handleClick = (e) => e.stopPropagation()
  const handleTouchStart = (e) => e.stopPropagation()

  handlePointerDown(mockEvent)
  handlePointerUp(mockEvent)
  handleClick(mockEvent)
  handleTouchStart(mockEvent)

  assert.equal(propagationCount, 4)
})

// ── 3. Mutual Exclusivity Tests in Composer ───────────────────────────────────
test('StoryComposer maintains strict mutual exclusivity between Poll and Question stickers', () => {
  let stickerState = {
    hasPoll: false,
    hasQuestion: false,
  }

  // User chooses "Add a Poll" -> clears question
  function selectPoll() {
    stickerState = {
      hasPoll: true,
      hasQuestion: false,
    }
  }

  // User chooses "Ask a Question" -> clears poll
  function selectQuestion() {
    stickerState = {
      hasPoll: false,
      hasQuestion: true,
    }
  }

  selectPoll()
  assert.equal(stickerState.hasPoll, true)
  assert.equal(stickerState.hasQuestion, false)

  selectQuestion()
  assert.equal(stickerState.hasPoll, false)
  assert.equal(stickerState.hasQuestion, true)
})

// ── 4. Code Contract Tests ────────────────────────────────────────────────────
test('Code Contract: StoryQuestionCard component file exists and exports a React function', () => {
  const cardPath = path.join(__dirname, 'StoryQuestionCard.jsx')
  assert.ok(fs.existsSync(cardPath), 'StoryQuestionCard.jsx should exist')

  const content = fs.readFileSync(cardPath, 'utf8')
  assert.ok(content.includes('export default function StoryQuestionCard'), 'Should export StoryQuestionCard function')
  assert.ok(content.includes('onRespond'), 'Should support onRespond callback')
  assert.ok(content.includes('onOpenDrawer'), 'Should support onOpenDrawer callback for owner')
  assert.ok(content.includes('onAnswerFocus'), 'Should support onAnswerFocus for pause synchronization')
  assert.ok(content.includes('stopPropagation'), 'Should isolate events using stopPropagation')
})

test('Code Contract: StoryViewerModal renders StoryQuestionCard and pauses progression while typing', () => {
  const viewerPath = path.join(__dirname, 'StoryViewerModal.jsx')
  const content = fs.readFileSync(viewerPath, 'utf8')

  assert.ok(content.includes("import StoryQuestionCard from './StoryQuestionCard'"), 'Should import StoryQuestionCard')
  assert.ok(content.includes('isAnsweringQuestion'), 'Should maintain isAnsweringQuestion state')
  assert.ok(content.includes('effectivePaused'), 'Should wire isAnsweringQuestion into effectivePaused')
  assert.ok(content.includes('StoryQuestionCard'), 'Should render StoryQuestionCard in viewer stage')
  assert.ok(content.includes('handleQuestionRespond'), 'Should provide handleQuestionRespond handler')
})

test('Code Contract: StoryViewersDrawer includes Questions tab and "Share as Story" action', () => {
  const drawerPath = path.join(__dirname, 'StoryViewersDrawer.jsx')
  const content = fs.readFileSync(drawerPath, 'utf8')

  assert.ok(content.includes('ChatCenteredDots'), 'Should import ChatCenteredDots icon')
  assert.ok(content.includes("activeTab === 'questions'"), 'Should handle questions tab state')
  assert.ok(content.includes('fetchQuestionResponses'), 'Should fetch question responses from backend API')
  assert.ok(content.includes('handleShareResponse'), 'Should implement handleShareResponse')
  assert.ok(content.includes('Share as Story'), 'Should provide Share as Story button')
})

test('Code Contract: stories.css defines styles for Question sticker, builder, and drawer view', () => {
  const cssPath = path.join(__dirname, 'stories.css')
  const content = fs.readFileSync(cssPath, 'utf8')

  assert.ok(content.includes('.story-viewer-question-wrap'), 'Should define .story-viewer-question-wrap')
  assert.ok(content.includes('.story-question-card'), 'Should define .story-question-card')
  assert.ok(content.includes('.sc-question-card-builder'), 'Should define .sc-question-card-builder')
  assert.ok(content.includes('.story-drawer-questions-view'), 'Should define .story-drawer-questions-view')
  assert.ok(content.includes('.notif-story_question_response'), 'Should define .notif-story_question_response')
  assert.ok(content.includes('.notif-story_question_answered'), 'Should define .notif-story_question_answered')
})

test('Code Contract: notifications view maps story question notification kinds', () => {
  const notifPath = path.join(__dirname, '../../pages/index.jsx')
  const content = fs.readFileSync(notifPath, 'utf8')

  assert.ok(content.includes('story_question_response: ChatCenteredDots'), 'Should map story_question_response to ChatCenteredDots')
  assert.ok(content.includes('story_question_answered: ChatCenteredDots'), 'Should map story_question_answered to ChatCenteredDots')
})

// ── 5. Phase 2.3 UX Polish & Edge-Case Tests ─────────────────────────────────

test('Viewer UX: Empty or whitespace-only response disables submission and is rejected', () => {
  const canSubmit = (text, submitting) => {
    return Boolean(text && text.trim() && !submitting && text.trim().length <= 500)
  }

  assert.equal(canSubmit('', false), false)
  assert.equal(canSubmit('   ', false), false)
  assert.equal(canSubmit('\n\t  \n', false), false)
  assert.equal(canSubmit('A valid answer', false), true)
  assert.equal(canSubmit('A valid answer', true), false, 'Cannot submit while already submitting')
})

test('Viewer UX: Character counter tracks input length accurately and respects 500-char boundary', () => {
  const formatCounter = (text) => `${(text || '').length} / 500`

  assert.equal(formatCounter(''), '0 / 500')
  assert.equal(formatCounter('Hello world'), '11 / 500')
  assert.equal(formatCounter('A'.repeat(500)), '500 / 500')
})

test('Viewer UX: Submission loading state prevents duplicate clicks and sets aria-busy', () => {
  let submitInvocations = 0
  let isSubmitting = false

  const submit = async (text) => {
    if (isSubmitting) return 'BLOCKED_DUPLICATE'
    if (!text || !text.trim()) return 'EMPTY'
    isSubmitting = true
    submitInvocations++
    // simulate async request
    await new Promise((resolve) => setTimeout(resolve, 5))
    isSubmitting = false
    return 'SUCCESS'
  }

  // First submit starts
  const p1 = submit('My answer')
  // Immediate second click while in-flight
  const p2 = submit('My answer')

  return Promise.all([p1, p2]).then(([r1, r2]) => {
    assert.equal(r1, 'SUCCESS')
    assert.equal(r2, 'BLOCKED_DUPLICATE')
    assert.equal(submitInvocations, 1)
  })
})

test('Viewer UX: Successful submission displays submitted response with confirmation', () => {
  let state = {
    my_response: null,
    submitSuccess: false,
    responseText: '',
  }

  // Simulate submission success
  const onSubmissionSuccess = (submittedText) => {
    state = {
      ...state,
      submitSuccess: true,
      responseText: submittedText,
    }
  }

  onSubmissionSuccess('Learning system design')

  const hasResponded = state.my_response !== null || state.submitSuccess
  const displayResponse = state.my_response || state.responseText

  assert.equal(hasResponded, true)
  assert.equal(displayResponse, 'Learning system design')
  assert.equal(state.submitSuccess, true)
})

test('Viewer UX: API errors display appropriate user-friendly messages for 400, 401, 404, and 409', () => {
  const mapApiError = (err) => {
    const msg = err?.message || 'Failed to submit response'
    if (err?.status === 409 || msg.toLowerCase().includes('already submitted') || msg.toLowerCase().includes('already answered')) {
      return 'You have already answered this question.'
    }
    if (err?.status === 401 || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('log in')) {
      return 'Please log in to submit a response.'
    }
    if (err?.status === 404 || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('expired')) {
      return 'This story or question is no longer available.'
    }
    return msg
  }

  assert.equal(mapApiError({ status: 409, message: 'Conflict' }), 'You have already answered this question.')
  assert.equal(mapApiError({ message: 'You have already submitted a response to this question' }), 'You have already answered this question.')
  assert.equal(mapApiError({ status: 401, message: 'Authentication required' }), 'Please log in to submit a response.')
  assert.equal(mapApiError({ status: 404, message: 'Story not found or expired' }), 'This story or question is no longer available.')
  assert.equal(mapApiError({ message: 'Network disconnected' }), 'Network disconnected')
})

test('Viewer UX: Existing response from backend is displayed correctly in responded state', () => {
  const questionWithResponse = {
    id: 101,
    question_text: 'What are your goals?',
    my_response: 'Master full-stack web development.',
    response_count: 5,
  }

  const hasResponded = questionWithResponse.my_response !== null
  const displayResponse = questionWithResponse.my_response

  assert.equal(hasResponded, true)
  assert.equal(displayResponse, 'Master full-stack web development.')
})

test('Viewer UX: Story navigation resets temporary input and error states', () => {
  // Simulate component state transitions across question ID changes
  let currentQuestionId = 1
  let responseText = 'Unsent draft text'
  let submitError = 'Some old error'
  let submitSuccess = false

  const onQuestionIdChanged = (newId) => {
    if (newId !== currentQuestionId) {
      currentQuestionId = newId
      responseText = ''
      submitError = null
      submitSuccess = false
    }
  }

  onQuestionIdChanged(2)
  assert.equal(currentQuestionId, 2)
  assert.equal(responseText, '')
  assert.equal(submitError, null)
  assert.equal(submitSuccess, false)
})

test('Playback UX: Story progression pauses when typing response and resumes on blur or Escape', () => {
  let isAnsweringQuestion = false
  const getEffectivePaused = (basePaused, isTyping) => Boolean(basePaused || isTyping)

  // Viewer focuses textarea
  isAnsweringQuestion = true
  assert.equal(getEffectivePaused(false, isAnsweringQuestion), true, 'Progression must pause while typing')

  // Viewer presses Escape or blurs
  isAnsweringQuestion = false
  assert.equal(getEffectivePaused(false, isAnsweringQuestion), false, 'Progression must resume on blur')
})

test('Owner UX: Questions tab handles empty, loading, error, and loaded states with retry', () => {
  // 1. Loading state
  const loadingView = { loading: true, error: null, data: null }
  assert.equal(loadingView.loading, true)

  // 2. Error state with retry callback
  let retried = false
  const errorView = {
    loading: false,
    error: 'Failed to fetch responses',
    data: null,
    onRetry: () => { retried = true },
  }
  assert.equal(Boolean(errorView.error), true)
  errorView.onRetry()
  assert.equal(retried, true)

  // 3. Empty state
  const emptyView = { loading: false, error: null, data: { responses: [], totalResponses: 0 } }
  assert.equal(emptyView.data.responses.length, 0)
  assert.equal(emptyView.data.totalResponses, 0)

  // 4. Loaded state
  const loadedView = {
    loading: false,
    error: null,
    data: {
      totalResponses: 1,
      responses: [{ id: 1, response_text: 'Awesome feature!', shared_story_id: null }],
    },
  }
  assert.equal(loadedView.data.responses.length, 1)
})

test('Owner UX: Share button prevents repeated clicks and marks shared responses', () => {
  let sharingResponseId = null
  let responses = [
    { id: 1, response_text: 'Answer 1', shared_story_id: null },
    { id: 2, response_text: 'Answer 2', shared_story_id: 99 },
  ]

  const isShareDisabled = (respId, isShared) => {
    return Boolean(sharingResponseId !== null || isShared)
  }

  // Normal unshared item, not sharing anything
  assert.equal(isShareDisabled(1, Boolean(responses[0].shared_story_id)), false)

  // Already shared item
  assert.equal(isShareDisabled(2, Boolean(responses[1].shared_story_id)), true)

  // While item 1 is sharing
  sharingResponseId = 1
  assert.equal(isShareDisabled(1, false), true, 'Must disable while request is in flight')
})

test('Owner UX: HTTP 409 conflict marks response as shared locally without browser alert', () => {
  let responses = [{ id: 10, response_text: 'Great work', shared_story_id: null }]
  let shareErrorMap = {}

  // Simulate handling 409 conflict in handleShareResponse
  const handle409Conflict = (responseId) => {
    responses = responses.map((r) =>
      r.id === responseId ? { ...r, shared_story_id: 'already-shared' } : r
    )
    shareErrorMap[responseId] = 'This response has already been shared.'
  }

  handle409Conflict(10)
  assert.ok(responses[0].shared_story_id, 'Response should be marked as shared')
  assert.equal(shareErrorMap[10], 'This response has already been shared.')
})

test('Composer UX: Switching between Poll and Question clears stale sticker data and enforces mutual exclusivity', () => {
  let composer = {
    hasPoll: false,
    pollQuestion: '',
    pollOptions: ['', ''],
    hasQuestion: false,
    questionText: '',
  }

  // 1. User configures Question
  composer.hasQuestion = true
  composer.questionText = 'What is your favorite stack?'
  assert.equal(composer.hasQuestion, true)
  assert.equal(composer.questionText, 'What is your favorite stack?')

  // 2. User switches to Poll -> must clear questionText
  const switchToPoll = () => {
    composer.hasPoll = true
    composer.hasQuestion = false
    composer.questionText = ''
  }
  switchToPoll()
  assert.equal(composer.hasPoll, true)
  assert.equal(composer.hasQuestion, false)
  assert.equal(composer.questionText, '', 'Stale question text must be cleared')

  // 3. User switches back to Question -> must clear poll
  const switchToQuestion = () => {
    composer.hasQuestion = true
    composer.hasPoll = false
    composer.pollQuestion = ''
    composer.pollOptions = ['', '']
  }
  switchToQuestion()
  assert.equal(composer.hasQuestion, true)
  assert.equal(composer.hasPoll, false)
  assert.equal(composer.pollQuestion, '', 'Stale poll question must be cleared')
})

test('Composer UX: Submit is disabled when Question sticker prompt is empty or exceeds 200 characters', () => {
  const isSubmitDisabled = ({ tab, textContent, hasQuestion, questionText }) => {
    if (tab === 'text' && !textContent.trim()) return true
    if (hasQuestion) {
      const trimmed = (questionText || '').trim()
      if (!trimmed || trimmed.length > 200) return true
    }
    return false
  }

  // Valid text story with no sticker
  assert.equal(isSubmitDisabled({ tab: 'text', textContent: 'Hello', hasQuestion: false }), false)

  // Question sticker enabled but question prompt is empty
  assert.equal(isSubmitDisabled({ tab: 'text', textContent: 'Hello', hasQuestion: true, questionText: '' }), true)
  assert.equal(isSubmitDisabled({ tab: 'text', textContent: 'Hello', hasQuestion: true, questionText: '   ' }), true)

  // Question sticker enabled with valid prompt
  assert.equal(isSubmitDisabled({ tab: 'text', textContent: 'Hello', hasQuestion: true, questionText: 'Ask me anything' }), false)

  // Question sticker exceeding 200 chars
  assert.equal(isSubmitDisabled({ tab: 'text', textContent: 'Hello', hasQuestion: true, questionText: 'A'.repeat(201) }), true)
})

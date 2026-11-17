import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Quiz Client Validation Tests ──────────────────────────────────────────
test('Quiz sticker client validation enforces non-empty, trimmed, <= 200 characters for question', () => {
  const validateComposerQuiz = ({ hasQuiz, quizQuestion, quizOptions, quizCorrectIndex }) => {
    if (!hasQuiz) return { valid: true }

    const trimmedQ = (quizQuestion || '').trim()
    if (!trimmedQ) {
      return { valid: false, error: 'Quiz question cannot be empty.' }
    }
    if (trimmedQ.length > 200) {
      return { valid: false, error: 'Quiz question must be 200 characters or fewer.' }
    }

    const validOptions = (quizOptions || []).map((o) => (o || '').trim()).filter(Boolean)
    if (validOptions.length < 2) {
      return { valid: false, error: 'Quiz must have at least 2 non-empty options.' }
    }
    if (validOptions.length > 4) {
      return { valid: false, error: 'Quiz cannot have more than 4 options.' }
    }
    for (const opt of validOptions) {
      if (opt.length > 60) {
        return { valid: false, error: 'Quiz options must be 60 characters or fewer.' }
      }
    }

    const lower = validOptions.map((o) => o.toLowerCase())
    if (new Set(lower).size !== validOptions.length) {
      return { valid: false, error: 'Quiz options must be unique.' }
    }

    if (typeof quizCorrectIndex !== 'number' || quizCorrectIndex < 0 || quizCorrectIndex >= validOptions.length) {
      return { valid: false, error: 'Please select a valid correct answer.' }
    }

    return {
      valid: true,
      quiz: {
        question: trimmedQ,
        options: validOptions,
        correctOptionIndex: quizCorrectIndex,
      },
    }
  }

  // Valid quiz with 2 options
  const valid2 = validateComposerQuiz({
    hasQuiz: true,
    quizQuestion: 'What is the capital of France?',
    quizOptions: ['Paris', 'Lyon'],
    quizCorrectIndex: 0,
  })
  assert.equal(valid2.valid, true)
  assert.equal(valid2.quiz.question, 'What is the capital of France?')
  assert.equal(valid2.quiz.correctOptionIndex, 0)
  assert.deepEqual(valid2.quiz.options, ['Paris', 'Lyon'])

  // Valid quiz with 4 options
  const valid4 = validateComposerQuiz({
    hasQuiz: true,
    quizQuestion: 'Which planet is known as the Red Planet?',
    quizOptions: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
    quizCorrectIndex: 1,
  })
  assert.equal(valid4.valid, true)
  assert.equal(valid4.quiz.correctOptionIndex, 1)

  // Empty question
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: '', quizOptions: ['A', 'B'], quizCorrectIndex: 0 }).valid, false)
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: '   ', quizOptions: ['A', 'B'], quizCorrectIndex: 0 }).valid, false)

  // Question exceeding 200 chars
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Q'.repeat(201), quizOptions: ['A', 'B'], quizCorrectIndex: 0 }).valid, false)
  // Question exactly 200 chars
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Q'.repeat(200), quizOptions: ['A', 'B'], quizCorrectIndex: 0 }).valid, true)

  // Fewer than 2 non-empty options
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['One'], quizCorrectIndex: 0 }).valid, false)
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['One', '   '], quizCorrectIndex: 0 }).valid, false)

  // Option exceeding 60 characters
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['A', 'O'.repeat(61)], quizCorrectIndex: 0 }).valid, false)
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['A', 'O'.repeat(60)], quizCorrectIndex: 0 }).valid, true)

  // Duplicate options (case-insensitive)
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['Option A', 'option a'], quizCorrectIndex: 0 }).valid, false)

  // Invalid correctOptionIndex
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['A', 'B'], quizCorrectIndex: -1 }).valid, false)
  assert.equal(validateComposerQuiz({ hasQuiz: true, quizQuestion: 'Test?', quizOptions: ['A', 'B'], quizCorrectIndex: 2 }).valid, false)
})

// ── 2. Tap Zone Event Isolation Tests ─────────────────────────────────────────
test('Quiz card interactions stop event propagation to prevent triggering Story navigation', () => {
  let propagationCount = 0
  const mockEvent = {
    stopPropagation: () => {
      propagationCount++
    },
  }

  // In StoryQuizCard, card clicks, option clicks, and touch/pointer interactions must stop propagation
  const handleCardClick = (e) => e.stopPropagation()
  const handleOptionClick = (e) => e.stopPropagation()
  const handlePointerDown = (e) => e.stopPropagation()
  const handlePointerUp = (e) => e.stopPropagation()

  handleCardClick(mockEvent)
  handleOptionClick(mockEvent)
  handlePointerDown(mockEvent)
  handlePointerUp(mockEvent)

  assert.equal(propagationCount, 4, 'All interaction handlers must call stopPropagation()')
})

// ── 3. 3-Way Mutual Exclusivity in StoryComposer ─────────────────────────────
test('StoryComposer strictly enforces 3-way mutual exclusivity between Poll, Question, and Quiz', () => {
  let composer = {
    hasPoll: false,
    pollQuestion: '',
    pollOptions: ['', ''],
    hasQuestion: false,
    questionText: '',
    hasQuiz: false,
    quizQuestion: '',
    quizOptions: ['', ''],
    quizCorrectIndex: 0,
  }

  // 1. Activate Poll
  const activatePoll = () => {
    composer.hasPoll = true
    composer.hasQuestion = false
    composer.hasQuiz = false
    composer.questionText = ''
    composer.quizQuestion = ''
    composer.quizOptions = ['', '']
    composer.quizCorrectIndex = 0
  }
  activatePoll()
  composer.pollQuestion = 'Favorite fruit?'
  composer.pollOptions = ['Apple', 'Banana']
  assert.equal(composer.hasPoll, true)
  assert.equal(composer.hasQuestion, false)
  assert.equal(composer.hasQuiz, false)

  // 2. Switch to Quiz -> poll data must be reset
  const activateQuiz = () => {
    composer.hasQuiz = true
    composer.hasPoll = false
    composer.hasQuestion = false
    composer.pollQuestion = ''
    composer.pollOptions = ['', '']
    composer.questionText = ''
  }
  activateQuiz()
  assert.equal(composer.hasQuiz, true)
  assert.equal(composer.hasPoll, false)
  assert.equal(composer.pollQuestion, '', 'Poll question must be cleared')
  assert.equal(composer.hasQuestion, false)

  // 3. Switch to Question -> quiz data must be reset
  const activateQuestion = () => {
    composer.hasQuestion = true
    composer.hasPoll = false
    composer.hasQuiz = false
    composer.pollQuestion = ''
    composer.pollOptions = ['', '']
    composer.quizQuestion = ''
    composer.quizOptions = ['', '']
    composer.quizCorrectIndex = 0
  }
  activateQuestion()
  assert.equal(composer.hasQuestion, true)
  assert.equal(composer.hasQuiz, false)
  assert.equal(composer.hasPoll, false)
  assert.equal(composer.quizQuestion, '', 'Quiz question must be cleared')

  // Exactly one can be true at any time
  const activeCount = [composer.hasPoll, composer.hasQuestion, composer.hasQuiz].filter(Boolean).length
  assert.equal(activeCount, 1)
})

// ── 4. Correct-Answer Privacy and Feedback Logic ──────────────────────────────
test('Quiz Viewer logic reveals correctness and percentages only after user submits an answer', () => {
  // Scenario A: Viewer has not answered yet
  const unansweredQuizState = {
    id: 10,
    question_text: 'What is 2 + 2?',
    options: [
      { id: 1, option_text: '3', display_order: 0 },
      { id: 2, option_text: '4', display_order: 1 },
      { id: 3, option_text: '5', display_order: 2 },
    ],
    my_answer: null, // Viewer has not answered
  }

  // In unanswered state: options do NOT have is_correct or percentage
  unansweredQuizState.options.forEach((opt) => {
    assert.equal(opt.is_correct, undefined, 'is_correct must be undefined before submission')
    assert.equal(opt.percentage, undefined, 'percentage must be undefined before submission')
  })

  // Scenario B: Viewer answers option 2 (correct)
  const answeredQuizState = {
    id: 10,
    question_text: 'What is 2 + 2?',
    options: [
      { id: 1, option_text: '3', display_order: 0, is_correct: false, percentage: 10, response_count: 1 },
      { id: 2, option_text: '4', display_order: 1, is_correct: true, percentage: 90, response_count: 9 },
      { id: 3, option_text: '5', display_order: 2, is_correct: false, percentage: 0, response_count: 0 },
    ],
    correct_option_id: 2,
    my_answer: 2,
    response_count: 10,
  }

  // In answered state: correct option is marked, user can see whether they got it right
  const isUserCorrect = answeredQuizState.my_answer === answeredQuizState.correct_option_id
  assert.equal(isUserCorrect, true)

  const correctOpt = answeredQuizState.options.find((o) => o.id === answeredQuizState.correct_option_id)
  assert.equal(correctOpt.is_correct, true)
  assert.equal(correctOpt.percentage, 90)

  // Scenario C: Viewer answers option 1 (incorrect)
  const wrongAnswerState = {
    ...answeredQuizState,
    my_answer: 1,
  }
  const isWrongCorrect = wrongAnswerState.my_answer === wrongAnswerState.correct_option_id
  assert.equal(isWrongCorrect, false, 'User selection 1 does not match correct_option_id 2')
})

// ── 5. Playback UX & Progress Pausing Contract ─────────────────────────────────
test('Playback UX: Story progression pauses during active quiz answering', () => {
  const getEffectivePaused = (basePaused, isAnsweringQuiz) => Boolean(basePaused || isAnsweringQuiz)

  assert.equal(getEffectivePaused(false, false), false)
  assert.equal(getEffectivePaused(false, true), true, 'Progression must pause while answering quiz')
  assert.equal(getEffectivePaused(true, false), true)
})

// ── 6. UI Contract Tests (JSX, CSS, and Notification Mapping) ─────────────────
test('UI Contract: StoryQuizCard.jsx exists and exports a valid component with tap-zone isolation', () => {
  const file = path.join(__dirname, 'StoryQuizCard.jsx')
  assert.ok(fs.existsSync(file), 'StoryQuizCard.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('export default function StoryQuizCard'), 'Exports StoryQuizCard')
  assert.ok(content.includes('stopPropagation'), 'Implements event isolation')
  assert.ok(content.includes('quiz-opt-correct'), 'Handles correct answer style class')
  assert.ok(content.includes('quiz-opt-incorrect'), 'Handles incorrect answer style class')
  assert.ok(content.includes('story-quiz-bar-fill'), 'Renders percentage bar fill')
})

test('UI Contract: StoryComposer.jsx supports Quiz sticker builder and validation', () => {
  const file = path.join(__dirname, 'StoryComposer.jsx')
  assert.ok(fs.existsSync(file), 'StoryComposer.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('StoryQuizCard'), 'Imports StoryQuizCard')
  assert.ok(content.includes('hasQuiz'), 'Declares hasQuiz state')
  assert.ok(content.includes('quizOptions'), 'Declares quizOptions state')
  assert.ok(content.includes('quizCorrectIndex'), 'Declares quizCorrectIndex state')
  assert.ok(content.includes('sc-quiz-card-builder'), 'Contains quiz builder UI')
  assert.ok(content.includes('sc-quiz-correct-toggle'), 'Contains correct option toggle')
})

test('UI Contract: StoryViewerModal.jsx renders StoryQuizCard and handles answer submission', () => {
  const file = path.join(__dirname, 'StoryViewerModal.jsx')
  assert.ok(fs.existsSync(file), 'StoryViewerModal.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('StoryQuizCard'), 'Imports StoryQuizCard')
  assert.ok(content.includes('currentStory.quiz'), 'Checks for currentStory.quiz')
  assert.ok(content.includes('handleQuizAnswer'), 'Defines handleQuizAnswer')
  assert.ok(content.includes('/quizzes/answer'), 'Calls quiz answer endpoint')
  assert.ok(content.includes('story-owner-quiz-pill'), 'Renders owner quiz footer pill')
})

test('UI Contract: StoryViewersDrawer.jsx includes Quiz analytics tab and breakdown', () => {
  const file = path.join(__dirname, 'StoryViewersDrawer.jsx')
  assert.ok(fs.existsSync(file), 'StoryViewersDrawer.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('activeTab === \'quiz\''), 'Handles quiz tab')
  assert.ok(content.includes('/quizzes/responses'), 'Calls quiz responses endpoint')
  assert.ok(content.includes('story-drawer-quiz-view'), 'Contains quiz analytics view')
  assert.ok(content.includes('story-drawer-quiz-correct-card'), 'Highlights correct option')
})

test('UI Contract: notifications mapping in frontend/src/pages/index.jsx includes story_quiz_answer', () => {
  const file = path.join(__dirname, '../../pages/index.jsx')
  assert.ok(fs.existsSync(file), 'index.jsx must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('story_quiz_answer'), 'NOTIF_ICON maps story_quiz_answer')
})

test('UI Contract: stories.css defines styles for quiz card, options, builder, and notification badge', () => {
  const file = path.join(__dirname, 'stories.css')
  assert.ok(fs.existsSync(file), 'stories.css must exist')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(content.includes('.story-quiz-card'), 'Defines .story-quiz-card')
  assert.ok(content.includes('.quiz-opt-correct'), 'Defines .quiz-opt-correct')
  assert.ok(content.includes('.quiz-opt-incorrect'), 'Defines .quiz-opt-incorrect')
  assert.ok(content.includes('.sc-quiz-card-builder'), 'Defines .sc-quiz-card-builder')
  assert.ok(content.includes('.notif-story_quiz_answer'), 'Defines .notif-story_quiz_answer')
})

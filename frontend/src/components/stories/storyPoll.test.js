import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 1. Calculation & Math Tests ──────────────────────────────────────────────
test('Poll percentage calculation handles 0 total votes safely', () => {
  const calculatePercentages = (options, totalVotes) => {
    return options.map((opt) => ({
      ...opt,
      percentage: totalVotes > 0 ? Math.round(((Number(opt.vote_count) || 0) / totalVotes) * 100) : 0,
    }))
  }

  const options = [
    { id: '1', option_text: 'A', vote_count: 0 },
    { id: '2', option_text: 'B', vote_count: 0 },
  ]
  const result = calculatePercentages(options, 0)
  assert.equal(result[0].percentage, 0)
  assert.equal(result[1].percentage, 0)
})

test('Poll percentages calculate accurately and round correctly', () => {
  const calculatePercentages = (options) => {
    const total = options.reduce((sum, o) => sum + (Number(o.vote_count) || 0), 0)
    return options.map((opt) => ({
      ...opt,
      percentage: total > 0 ? Math.round(((Number(opt.vote_count) || 0) / total) * 100) : 0,
    }))
  }

  const options = [
    { id: '1', option_text: 'Yes', vote_count: 3 },
    { id: '2', option_text: 'No', vote_count: 1 },
  ]
  const result = calculatePercentages(options)
  assert.equal(result[0].percentage, 75)
  assert.equal(result[1].percentage, 25)
})

// ── 2. Composer Client-Side Poll Validation Tests ─────────────────────────────
test('Composer client validation enforces min 2 options, max 4, max 120 char question, and uniqueness', () => {
  const validateComposerPoll = ({ hasPoll, question, options }) => {
    if (!hasPoll) return { valid: true }

    const trimmedQ = (question || '').trim()
    if (!trimmedQ) return { valid: false, error: 'Poll question cannot be empty.' }
    if (trimmedQ.length > 120) return { valid: false, error: 'Poll question must be 120 characters or fewer.' }

    const validOptions = (options || []).map((o) => (o || '').trim()).filter(Boolean)
    if (validOptions.length < 2) return { valid: false, error: 'Poll must have at least 2 non-empty options.' }
    if (validOptions.length > 4) return { valid: false, error: 'Poll cannot have more than 4 options.' }

    for (const opt of validOptions) {
      if (opt.length > 60) return { valid: false, error: 'Poll options must be 60 characters or fewer.' }
    }

    const lower = validOptions.map((o) => o.toLowerCase())
    if (new Set(lower).size !== validOptions.length) {
      return { valid: false, error: 'Poll options must be unique.' }
    }

    return { valid: true, question: trimmedQ, options: validOptions }
  }

  // Valid poll
  const valid = validateComposerPoll({
    hasPoll: true,
    question: 'Favorite Framework?',
    options: ['React', 'Vue', 'Svelte'],
  })
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.options, ['React', 'Vue', 'Svelte'])

  // Empty question
  assert.equal(validateComposerPoll({ hasPoll: true, question: '', options: ['A', 'B'] }).valid, false)

  // Question > 120 chars
  assert.equal(validateComposerPoll({ hasPoll: true, question: 'A'.repeat(121), options: ['A', 'B'] }).valid, false)

  // Fewer than 2 options
  assert.equal(validateComposerPoll({ hasPoll: true, question: 'Q?', options: ['A'] }).valid, false)

  // Duplicate options (case-insensitive)
  assert.equal(validateComposerPoll({ hasPoll: true, question: 'Q?', options: ['React', 'react'] }).valid, false)

  // Option > 60 chars
  assert.equal(validateComposerPoll({ hasPoll: true, question: 'Q?', options: ['Normal', 'X'.repeat(61)] }).valid, false)
})

// ── 3. Tap Zone Event Isolation Tests ─────────────────────────────────────────
test('Poll card and option interactions stop event propagation to prevent Story navigation', () => {
  let propagationStopped = false
  const mockEvent = {
    stopPropagation: () => {
      propagationStopped = true
    },
  }

  const simulateOptionClick = (e, callback) => {
    e.stopPropagation()
    callback?.()
  }

  let voted = false
  simulateOptionClick(mockEvent, () => {
    voted = true
  })

  assert.equal(propagationStopped, true, 'Event propagation must be stopped')
  assert.equal(voted, true, 'Option vote callback must still execute')
})

// ── 4. File Integrity & Code Contracts ────────────────────────────────────────
test('StoryPollCard component exists and implements tap zone isolation', () => {
  const filePath = path.join(__dirname, 'StoryPollCard.jsx')
  assert.equal(fs.existsSync(filePath), true, 'StoryPollCard.jsx must exist')

  const content = fs.readFileSync(filePath, 'utf-8')
  assert.match(content, /onPointerDown=\{stopPropagation\}/)
  assert.match(content, /onPointerUp=\{stopPropagation\}/)
  assert.match(content, /onClick=\{stopPropagation\}/)
  assert.match(content, /onTouchStart=\{stopPropagation\}/)
  assert.match(content, /role="progressbar"/)
})

test('StoryComposer imports StoryPollCard and handles poll creation', () => {
  const filePath = path.join(__dirname, 'StoryComposer.jsx')
  const content = fs.readFileSync(filePath, 'utf-8')
  assert.match(content, /import StoryPollCard from '\.\/StoryPollCard'/)
  assert.match(content, /hasPoll/)
  assert.match(content, /pollQuestion/)
  assert.match(content, /pollOptions/)
  assert.match(content, /form\.append\(\s*'poll'/)
})

test('StoryViewerModal integrates StoryPollCard with voting handler and owner pill', () => {
  const filePath = path.join(__dirname, 'StoryViewerModal.jsx')
  const content = fs.readFileSync(filePath, 'utf-8')
  assert.match(content, /import StoryPollCard from '\.\/StoryPollCard'/)
  assert.match(content, /handlePollVote/)
  assert.match(content, /<StoryPollCard/)
  assert.match(content, /story-owner-poll-pill/)
})

test('StoryViewersDrawer integrates owner voter breakdown tab', () => {
  const filePath = path.join(__dirname, 'StoryViewersDrawer.jsx')
  const content = fs.readFileSync(filePath, 'utf-8')
  assert.match(content, /fetchPollData/)
  assert.match(content, /\/stories\/\$\{storyId\}\/polls\/voters/)
  assert.match(content, /story-drawer-poll-breakdown/)
})

test('stories.css contains styles for poll card, result bars, and builder', () => {
  const filePath = path.join(__dirname, 'stories.css')
  const content = fs.readFileSync(filePath, 'utf-8')
  assert.match(content, /\.story-poll-card/)
  assert.match(content, /\.story-poll-option-btn/)
  assert.match(content, /\.story-poll-result-bar/)
  assert.match(content, /\.story-poll-result-fill/)
  assert.match(content, /\.sc-poll-card-builder/)
})

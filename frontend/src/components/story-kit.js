// Shared story helpers: text story backgrounds and the poll / question / quiz sticker (PR #21).
import { api } from '../api'

export const BACKGROUNDS = {
  sunset: 'linear-gradient(160deg, #ff9a3c 0%, #ff3b6b 52%, #8b3dff 100%)',
  ocean: 'linear-gradient(160deg, #3ee0f0 0%, #3b82f6 52%, #4338ca 100%)',
  forest: 'linear-gradient(160deg, #b6f05c 0%, #10b981 52%, #0f766e 100%)',
  night: 'linear-gradient(160deg, #475569 0%, #1e293b 55%, #0b1120 100%)',
  blush: 'linear-gradient(160deg, #fde2f3 0%, #f472b6 52%, #be185d 100%)',
  gold: 'linear-gradient(160deg, #fff1b8 0%, #f59e0b 52%, #b45309 100%)',
}

export const STICKER_PATH = { poll: 'polls', question: 'questions', quiz: 'quizzes' }

export const emptySticker = (type) => ({ type, question: '', options: ['', ''], correct: 0 })

// Returns an error message, or '' when the sticker can be shared.
export function stickerProblem(sticker) {
  if (!sticker) return ''
  const question = sticker.question.trim()
  if (!question) return `Write the ${sticker.type === 'question' ? 'question' : `${sticker.type} question`}`
  if (sticker.type === 'question') return question.length > 200 ? 'Questions can be up to 200 characters' : ''
  if (question.length > (sticker.type === 'poll' ? 120 : 200)) return `The question can be up to ${sticker.type === 'poll' ? 120 : 200} characters`
  const options = sticker.options.map((option) => option.trim())
  if (options.some((option) => !option)) return 'Fill in every option or remove the empty ones'
  if (options.some((option) => option.length > 60)) return 'Options can be up to 60 characters'
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return 'Each option must be different'
  return ''
}

// Adds the sticker to a story that was just shared.
export function attachSticker(storyId, sticker) {
  const question = sticker.question.trim()
  const options = sticker.options.map((option) => option.trim())
  const body = sticker.type === 'question' ? { question }
    : sticker.type === 'poll' ? { question, options }
      : { question, options, correctOptionIndex: sticker.correct }
  return api(`/stories/${storyId}/${STICKER_PATH[sticker.type]}`, { method: 'POST', body })
}


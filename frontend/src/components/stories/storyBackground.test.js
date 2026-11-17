import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORY_BACKGROUND_PRESETS, BACKGROUND_STYLES } from './storyHelpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('STORY_BACKGROUND_PRESETS strictly align with BACKGROUND_STYLES whitelist', () => {
  assert.equal(STORY_BACKGROUND_PRESETS.length, 7)
  assert.equal(BACKGROUND_STYLES.length, 7)

  for (const preset of STORY_BACKGROUND_PRESETS) {
    assert.ok(BACKGROUND_STYLES.includes(preset.id), `Preset id ${preset.id} must be in BACKGROUND_STYLES`)
    assert.equal(preset.className, `story-bg-${preset.id}`)
  }
})

test('StoryViewerModal backgroundClass resolver correctly resolves background styles for text and media stories', () => {
  const resolveBackgroundClass = (story) => {
    if (!story || story.type !== 'text') return ''
    const rawStyle = story.background_style || 'gradient-sunset'
    return rawStyle.startsWith('story-bg-') ? rawStyle : `story-bg-${rawStyle}`
  }

  // Text story with standard backend background_style
  for (const preset of STORY_BACKGROUND_PRESETS) {
    const textStory = { type: 'text', content: 'Test', background_style: preset.id }
    assert.equal(resolveBackgroundClass(textStory), `story-bg-${preset.id}`)
  }

  // Text story with already prefixed background_style
  assert.equal(
    resolveBackgroundClass({ type: 'text', content: 'Test', background_style: 'story-bg-gradient-ocean' }),
    'story-bg-gradient-ocean'
  )

  // Text story with missing/undefined background_style defaults to gradient-sunset
  assert.equal(
    resolveBackgroundClass({ type: 'text', content: 'Test' }),
    'story-bg-gradient-sunset'
  )
  assert.equal(
    resolveBackgroundClass({ type: 'text', content: 'Test', background_style: '' }),
    'story-bg-gradient-sunset'
  )
  assert.equal(
    resolveBackgroundClass({ type: 'text', content: 'Test', background_style: null }),
    'story-bg-gradient-sunset'
  )

  // Photo story should never have backgroundClass (keeps pure black letterbox)
  assert.equal(
    resolveBackgroundClass({ type: 'photo', content: 'Photo caption', background_style: 'gradient-ocean' }),
    ''
  )

  // Video story should never have backgroundClass (keeps pure black letterbox)
  assert.equal(
    resolveBackgroundClass({ type: 'video', content: 'Video caption', background_style: 'gradient-royal' }),
    ''
  )
})

test('stories.css defines compound selectors for frame and text container for all 7 presets', () => {
  const cssContent = fs.readFileSync(path.join(__dirname, 'stories.css'), 'utf-8')

  for (const style of BACKGROUND_STYLES) {
    const frameSelector = `.story-viewer-frame.story-bg-${style}`
    const containerSelector = `.story-text-container.story-bg-${style}`
    assert.ok(cssContent.includes(frameSelector), `stories.css must include ${frameSelector}`)
    assert.ok(cssContent.includes(containerSelector), `stories.css must include ${containerSelector}`)
  }
})

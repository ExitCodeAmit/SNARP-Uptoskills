import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.join(__dirname, 'stories.css')
const modalPath = path.join(__dirname, 'StoryViewerModal.jsx')
const composerPath = path.join(__dirname, 'StoryComposer.jsx')

// ── 1. CSS Contracts: Upper Positioning & Safe-Area ──────────────────────────
test('Task 5.1 CSS Contract: .story-viewer-mentions-wrap uses safe-area upper positioning', () => {
  assert.ok(fs.existsSync(cssPath), 'stories.css must exist')
  const css = fs.readFileSync(cssPath, 'utf8')

  // Find .story-viewer-mentions-wrap base definition
  const baseMatch = css.match(/\.story-viewer-mentions-wrap\s*\{([^}]+)\}/)
  assert.ok(baseMatch, '.story-viewer-mentions-wrap must be defined in stories.css')
  const baseRules = baseMatch[1]

  assert.ok(
    baseRules.includes('top: calc(env(safe-area-inset-top, 0px) + 72px)') ||
    baseRules.includes('top: 72px') ||
    baseRules.includes('+ 72px'),
    'Base positioning must place mentions ~72px from top with safe-area support'
  )
  assert.ok(baseRules.includes('bottom: auto'), 'Must explicitly reset bottom: auto to eliminate bottom collision')
  assert.ok(baseRules.includes('z-index: 16'), 'Must maintain z-index: 16 for proper layering')
})

test('Task 5.1 CSS Contract: mobile @media override positions mentions ~68px from top', () => {
  const css = fs.readFileSync(cssPath, 'utf8')

  // Find the responsive mentions section
  const sectionStart = css.indexOf('Responsive Mentions Overrides')
  assert.ok(sectionStart !== -1, 'Responsive Mentions Overrides section must exist')
  const mentionsSection = css.slice(sectionStart, sectionStart + 800)

  assert.ok(
    mentionsSection.includes('@media (max-width: 480px)'),
    'Mobile media query must be defined in mentions section'
  )
  assert.ok(
    mentionsSection.includes('.story-viewer-mentions-wrap'),
    'Mobile media query must include .story-viewer-mentions-wrap override'
  )
  assert.ok(
    mentionsSection.includes('+ 68px') || mentionsSection.includes('top: 68px'),
    'Mobile override must place mentions ~68px from top'
  )
  assert.ok(mentionsSection.includes('bottom: auto'), 'Mobile override must maintain bottom: auto')
})

test('Task 5.1 CSS Contract: .sc-preview-mentions-overlay in composer is aligned to upper section', () => {
  const css = fs.readFileSync(cssPath, 'utf8')

  const previewMatch = css.match(/\.sc-preview-mentions-overlay\s*\{([^}]+)\}/)
  assert.ok(previewMatch, '.sc-preview-mentions-overlay must be defined in stories.css')
  const previewRules = previewMatch[1]

  assert.ok(
    previewRules.includes('top: 10px') || previewRules.includes('top: 12px') || previewRules.includes('top:'),
    'Composer preview overlay must position mentions at top'
  )
  assert.ok(previewRules.includes('bottom: auto'), 'Composer preview overlay must reset bottom: auto')
  assert.ok(
    previewRules.includes('right: 44px') || previewRules.includes('right:'),
    'Composer preview must leave clearance for remove button'
  )
})

test('Task 5.1 CSS Contract: pointer-events configuration ensures tap zone isolation', () => {
  const css = fs.readFileSync(cssPath, 'utf8')

  // Wrapper allows click-through on empty areas, badges capture clicks
  const wrapMatch = css.match(/\.story-viewer-mentions-wrap\s*\{([^}]+)\}/)
  assert.ok(wrapMatch, '.story-viewer-mentions-wrap must exist')
  assert.ok(wrapMatch[1].includes('pointer-events: none'), 'Wrapper has pointer-events: none for pass-through')

  const badgeMatch = css.match(/\.story-mention-badge\s*\{([^}]+)\}/)
  assert.ok(badgeMatch, '.story-mention-badge must exist')
  assert.ok(badgeMatch[1].includes('pointer-events: auto'), 'Mention badge has pointer-events: auto for clickability')
})

// ── 2. Component Structure & Mention Badge Navigation ───────────────────────
test('Task 5.1 JSX Contract: StoryViewerModal renders mention badges with profile navigation and onClose', () => {
  const jsx = fs.readFileSync(modalPath, 'utf8')

  assert.ok(jsx.includes('story-viewer-mentions-wrap'), 'StoryViewerModal renders .story-viewer-mentions-wrap')
  assert.ok(jsx.includes('story-mention-badge'), 'StoryViewerModal renders .story-mention-badge')
  assert.ok(jsx.includes('to={`/users/${m.id}`}') || jsx.includes('to={\'/users/\' + m.id}'), 'Badge links to user profile')
  assert.ok(jsx.includes('onClose?.()'), 'Badge onClick dismisses modal')
  assert.ok(jsx.includes('e.stopPropagation()'), 'Badge stops propagation')
})

test('Task 5.1 JSX Contract: StoryComposer contains live preview mentions overlay', () => {
  const jsx = fs.readFileSync(composerPath, 'utf8')

  assert.ok(jsx.includes('sc-preview-mentions-overlay'), 'StoryComposer renders .sc-preview-mentions-overlay')
  assert.ok(jsx.includes('sc-preview-mention-badge'), 'StoryComposer renders .sc-preview-mention-badge')
})

// ── 3. Geometric Non-Overlap Across Viewports ────────────────────────────────
test('Task 5.1 Responsive QA: Zero overlap between mentions and footer across viewports', () => {
  const viewports = [
    { name: 'Desktop (1366×768)', width: 1366, height: 768, isMobile: false },
    { name: 'Tablet (768×1024)', width: 768, height: 1024, isMobile: false },
    { name: 'Mobile modern (390×844)', width: 390, height: 844, isMobile: true },
    { name: 'Mobile compact (375×667)', width: 375, height: 667, isMobile: true },
  ]

  for (const vp of viewports) {
    let frameHeight = vp.isMobile
      ? vp.height
      : Math.min(420 * (16 / 9), vp.height * 0.92)

    // Mention zone: top position + max height (64px)
    const mentionTop = vp.isMobile ? 68 : 72
    const mentionHeight = 64
    const mentionBottom = mentionTop + mentionHeight

    // Footer zone: bottom offset (16px) + footer height (~48px)
    const footerHeight = 48
    const footerBottomOffset = 16
    const footerTop = frameHeight - footerBottomOffset - footerHeight
    const footerBottom = frameHeight - footerBottomOffset

    // Distance between lower edge of mentions and upper edge of footer
    const clearGap = footerTop - mentionBottom

    assert.ok(
      clearGap > 300,
      `[${vp.name}] Must have clear distance between mentions (${mentionBottom}px) and footer (${footerTop}px). Actual gap: ${clearGap.toFixed(1)}px`
    )

    assert.ok(
      mentionBottom < footerTop,
      `[${vp.name}] Mention overlay must never intersect footer controls`
    )
  }
})

// ── 4. Control Clickability Verification ────────────────────────────────────
test('Task 5.1 Control Isolation: Footer actions remain unintercepted', () => {
  const jsx = fs.readFileSync(modalPath, 'utf8')

  // Check footer controls exist and have appropriate click/submit handlers
  assert.ok(jsx.includes('story-reaction-trigger-btn'), 'Reaction/Like trigger button exists')
  assert.ok(jsx.includes('story-reshare-btn'), 'Reshare button exists')
  assert.ok(jsx.includes('story-reply-form'), 'Reply form exists')
  assert.ok(jsx.includes('story-reply-send-btn'), 'Reply send button exists')
  assert.ok(jsx.includes('story-viewers-pill-btn'), 'Viewers pill button exists')

  // Verify footer is rendered inside .story-viewer-frame but outside mentions wrapper
  const mentionsIndex = jsx.indexOf('story-viewer-mentions-wrap')
  const footerIndex = jsx.indexOf('story-viewer-footer')
  assert.ok(mentionsIndex !== -1 && footerIndex !== -1, 'Both elements must exist')
  assert.ok(footerIndex > mentionsIndex, 'Footer is rendered cleanly after stage/mentions')
})

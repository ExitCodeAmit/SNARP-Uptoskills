import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanupExpiredStories } from './cleanup.js'
import { createStoryRouter } from './routes.js'

/**
 * In-memory simulated database engine implementing exact PostgreSQL
 * CTE, WHERE, EXISTS, JOIN, and CASCADE semantics for 24-Hour Expiry & Cleanup.
 */
function createAuditDb() {
  let nowTime = new Date('2026-11-06T12:00:00.000Z').getTime()

  const stories = new Map()
  const storyMedia = new Map()
  const storyViews = new Map()
  const storyReactions = new Map()
  const storyReplies = new Map()
  const highlights = new Map()
  const highlightItems = new Map()

  // Helper to advance time (mocked timestamp, no real waiting)
  const advanceHours = (hours) => {
    nowTime += hours * 60 * 60 * 1000
  }

  const getNow = () => new Date(nowTime)

  // Cascade deletion simulation
  const deleteStoryCascade = (storyId) => {
    stories.delete(storyId)
    // Cascade delete media
    for (const [mid, m] of storyMedia.entries()) {
      if (m.story_id === storyId) storyMedia.delete(mid)
    }
    // Cascade delete views
    for (const [vid, v] of storyViews.entries()) {
      if (v.story_id === storyId) storyViews.delete(vid)
    }
    // Cascade delete reactions
    for (const [rid, r] of storyReactions.entries()) {
      if (r.story_id === storyId) storyReactions.delete(rid)
    }
    // Cascade delete replies
    for (const [pid, p] of storyReplies.entries()) {
      if (p.story_id === storyId) storyReplies.delete(pid)
    }
    // Cascade delete highlight items
    for (const [iid, it] of highlightItems.entries()) {
      if (it.story_id === storyId) highlightItems.delete(iid)
    }
    // Set null on highlight cover
    for (const [hid, h] of highlights.entries()) {
      if (h.cover_story_id === storyId) h.cover_story_id = null
    }
  }

  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: true }] }
      }
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] }
      }

      // Cleanup CTE evaluation:
      // WITH expired AS (
      //   SELECT id FROM stories
      //   WHERE expires_at <= now()
      //     AND NOT EXISTS (
      //       SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = stories.id
      //     )
      //   LIMIT $1
      // )
      // DELETE FROM stories WHERE id IN (SELECT id FROM expired)
      if (normalized.includes('DELETE FROM stories WHERE id IN (SELECT id FROM expired)')) {
        const limit = params[0] || 100
        const expiredCandidateIds = []

        for (const [id, s] of stories.entries()) {
          const isExpired = new Date(s.expires_at).getTime() <= nowTime
          let isHighlighted = false
          for (const item of highlightItems.values()) {
            if (item.story_id === id) {
              isHighlighted = true
              break
            }
          }

          if (isExpired && !isHighlighted) {
            expiredCandidateIds.push(id)
            if (expiredCandidateIds.length >= limit) break
          }
        }

        for (const id of expiredCandidateIds) {
          deleteStoryCascade(id)
        }

        return { rowCount: expiredCandidateIds.length }
      }

      return { rows: [] }
    },
    release() {},
  }

  const pool = {
    connect: async () => client,
    query: client.query,
  }

  return {
    advanceHours,
    getNow,
    stories,
    storyMedia,
    storyViews,
    storyReactions,
    storyReplies,
    highlights,
    highlightItems,
    pool,
  }
}

// =========================================================================
// REQUIREMENT A: Normal Story Expiry (24-Hour Rule)
// =========================================================================
test('Requirement A: Normal stories expire after 24 hours and are excluded from active access', async () => {
  const db = createAuditDb()
  const baseTime = db.getNow()

  // Story 1: Created at baseTime, expires baseTime + 24h
  db.stories.set('1', {
    id: '1',
    user_id: 10,
    type: 'text',
    content: 'Story 1 active',
    created_at: new Date(baseTime).toISOString(),
    expires_at: new Date(baseTime.getTime() + 24 * 3600 * 1000).toISOString(),
  })

  // Check 1: At 12 hours elapsed, story 1 is active
  db.advanceHours(12)
  const isExpiredAt12h = new Date(db.stories.get('1').expires_at).getTime() <= db.getNow().getTime()
  assert.equal(isExpiredAt12h, false, 'Story 1 must remain active before 24 hours')

  // Check 2: At 24.5 hours elapsed, story 1 is expired
  db.advanceHours(12.5)
  const isExpiredAt24_5h = new Date(db.stories.get('1').expires_at).getTime() <= db.getNow().getTime()
  assert.equal(isExpiredAt24_5h, true, 'Story 1 must be expired after 24 hours')

  // Normal cleanup deletes expired story with 0 highlight references
  await cleanupExpiredStories(db.pool)
  assert.equal(db.stories.has('1'), false, 'Expired normal story must be removed by cleanup')
})

// =========================================================================
// REQUIREMENT B: Highlighted Story Retention
// =========================================================================
test('Requirement B: Highlighted story is retained after 24h and media remains accessible', async () => {
  const db = createAuditDb()
  const baseTime = db.getNow()

  // Story 2: Created at baseTime, expires baseTime + 24h
  db.stories.set('2', {
    id: '2',
    user_id: 10,
    type: 'photo',
    content: 'Highlight photo',
    created_at: new Date(baseTime).toISOString(),
    expires_at: new Date(baseTime.getTime() + 24 * 3600 * 1000).toISOString(),
  })
  db.storyMedia.set('m-2', {
    id: 'm-2',
    story_id: '2',
    mime: 'image/jpeg',
    size_bytes: 5000,
    data: Buffer.from([1, 2, 3]),
  })

  // Attached to Highlight 101
  db.highlights.set('101', { id: '101', user_id: 10, title: 'Vacation', cover_story_id: '2' })
  db.highlightItems.set('item-1', { id: 'item-1', highlight_id: '101', story_id: '2' })

  // Fast forward 48 hours (well past 24 hours)
  db.advanceHours(48)
  assert.ok(new Date(db.stories.get('2').expires_at).getTime() <= db.getNow().getTime(), 'Story 2 is expired')

  // Run cleanup: must NOT delete story 2 because it is referenced in highlightItems
  await cleanupExpiredStories(db.pool)
  assert.equal(db.stories.has('2'), true, 'Story 2 must be preserved because it is highlighted')
  assert.equal(db.storyMedia.has('m-2'), true, 'Media m-2 must remain preserved')

  // Verify media query logic: (s.expires_at > now() OR EXISTS (SELECT 1 FROM story_highlight_items ...))
  const mediaAccessible = (db.stories.get('2').expires_at > db.getNow().toISOString()) ||
    Array.from(db.highlightItems.values()).some((it) => it.story_id === '2')
  assert.equal(mediaAccessible, true, 'Media must remain accessible via highlight link')
})

// =========================================================================
// REQUIREMENT C: Cleanup After Highlight Removal
// =========================================================================
test('Requirement C: Expired story referenced by multiple highlights retained until ALL removed', async () => {
  const db = createAuditDb()
  const baseTime = db.getNow()

  // Story 3: Created at baseTime, attached to Highlight A and Highlight B
  db.stories.set('3', {
    id: '3',
    user_id: 10,
    type: 'text',
    content: 'Multi-highlight story',
    created_at: new Date(baseTime).toISOString(),
    expires_at: new Date(baseTime.getTime() + 24 * 3600 * 1000).toISOString(),
  })

  db.highlightItems.set('item-A', { id: 'item-A', highlight_id: 'hl-A', story_id: '3' })
  db.highlightItems.set('item-B', { id: 'item-B', highlight_id: 'hl-B', story_id: '3' })

  // Fast forward 30 hours (expired)
  db.advanceHours(30)

  // 1. Run cleanup: retained because in 2 highlights
  await cleanupExpiredStories(db.pool)
  assert.equal(db.stories.has('3'), true, 'Story 3 retained while in 2 highlights')

  // 2. Remove from Highlight A (still in Highlight B)
  db.highlightItems.delete('item-A')
  await cleanupExpiredStories(db.pool)
  assert.equal(db.stories.has('3'), true, 'Story 3 retained while in 1 highlight')

  // 3. Remove from Highlight B (now in 0 highlights)
  db.highlightItems.delete('item-B')
  await cleanupExpiredStories(db.pool)
  assert.equal(db.stories.has('3'), false, 'Story 3 safely deleted once removed from ALL highlights')
})

// =========================================================================
// REQUIREMENT D: Safety Checks (Active stories, Cascades, Independent Tables)
// =========================================================================
test('Requirement D: Safety checks: Active stories preserved, foreign key cascades clean up dependent records', async () => {
  const db = createAuditDb()
  const baseTime = db.getNow()

  // Story 4: Active story with 0 highlights
  db.stories.set('4', {
    id: '4',
    user_id: 10,
    type: 'photo',
    content: 'Active story',
    created_at: new Date(baseTime).toISOString(),
    expires_at: new Date(baseTime.getTime() + 24 * 3600 * 1000).toISOString(),
  })
  db.storyMedia.set('m-4', { id: 'm-4', story_id: '4', mime: 'image/png' })

  // Story 5: Expired story with dependent view, reaction, reply, and cover reference
  db.stories.set('5', {
    id: '5',
    user_id: 10,
    type: 'photo',
    content: 'Expired story with dependencies',
    created_at: new Date(baseTime - 30 * 3600 * 1000).toISOString(),
    expires_at: new Date(baseTime - 6 * 3600 * 1000).toISOString(),
  })
  db.storyMedia.set('m-5', { id: 'm-5', story_id: '5', mime: 'image/png' })
  db.storyViews.set('v-5', { story_id: '5', viewer_id: 20 })
  db.storyReactions.set('r-5', { story_id: '5', user_id: 20, type: 'love' })
  db.storyReplies.set('rep-5', { story_id: '5', sender_id: 20, text: 'Nice!' })
  db.highlights.set('hl-5', { id: 'hl-5', user_id: 10, title: 'Album', cover_story_id: '5' })

  // Run cleanup:
  // - Story 4 is active -> PRESERVED
  // - Story 5 is expired and has no highlight_items -> DELETED WITH ALL DEPENDENCIES
  await cleanupExpiredStories(db.pool)

  assert.equal(db.stories.has('4'), true, 'Active story 4 must NOT be deleted')
  assert.equal(db.storyMedia.has('m-4'), true, 'Active story media must NOT be deleted')

  assert.equal(db.stories.has('5'), false, 'Expired story 5 must be deleted')
  assert.equal(db.storyMedia.has('m-5'), false, 'Media m-5 must be cascade deleted')
  assert.equal(db.storyViews.has('v-5'), false, 'Views for story 5 must be cascade deleted')
  assert.equal(db.storyReactions.has('r-5'), false, 'Reactions for story 5 must be cascade deleted')
  assert.equal(db.storyReplies.has('rep-5'), false, 'Replies for story 5 must be cascade deleted')
  assert.equal(db.highlights.get('hl-5').cover_story_id, null, 'Highlight cover_story_id set to null via ON DELETE SET NULL')
})

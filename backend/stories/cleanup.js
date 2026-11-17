const log = (level, event, fields = {}) => console.log(JSON.stringify({
  timestamp: new Date().toISOString(), level, event, ...fields,
}))

let isCleaning = false

/**
 * Sweeps expired stories using a non-blocking transaction-level advisory lock.
 * Deletes in batches of 100 up to a 5,000 ceiling.
 * If the ceiling is reached, schedules an early follow-up in 2 minutes.
 */
export async function cleanupExpiredStories(pool) {
  if (isCleaning) return
  isCleaning = true

  let client
  let txStarted = false
  let rollbackErr = null

  try {
    client = await pool.connect()
    await client.query('BEGIN')
    txStarted = true

    // 1. Transaction-level advisory lock (auto-releases on COMMIT or ROLLBACK)
    const { rows: [lock] } = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('snarp:story-cleanup', 0)) AS acquired"
    )

    if (!lock?.acquired) {
      await client.query('ROLLBACK')
      txStarted = false
      log('info', 'story_cleanup_skipped_already_running')
      return
    }

    // 2. Batched draining loop: max 50 batches of 100 rows
    const BATCH_SIZE = 100
    const MAX_BATCHES = 50
    let totalDeleted = 0
    let reachedCeiling = false

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const { rowCount } = await client.query(`
        WITH expired AS (
          SELECT id FROM stories
          WHERE expires_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM story_highlight_items shi WHERE shi.story_id = stories.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM stories rs WHERE rs.original_story_id = stories.id AND rs.expires_at > now()
            )
          LIMIT $1
        )
        DELETE FROM stories WHERE id IN (SELECT id FROM expired)
      `, [BATCH_SIZE])

      totalDeleted += rowCount

      if (rowCount < BATCH_SIZE) {
        break // Fully drained
      }

      if (batch === MAX_BATCHES - 1) {
        reachedCeiling = true
      }
    }

    await client.query('COMMIT')
    txStarted = false

    if (totalDeleted > 0) {
      log('info', 'story_cleanup_completed', { totalDeleted })
    }

    // 3. If ceiling reached, schedule early follow-up in 2 minutes
    if (reachedCeiling) {
      log('warn', 'story_cleanup_ceiling_reached', {
        totalDeleted,
        message: 'Ceiling of 5,000 reached; scheduling follow-up in 2 minutes',
      })
      setTimeout(() => cleanupExpiredStories(pool), 2 * 60 * 1000)
    }
  } catch (err) {
    if (txStarted) {
      try {
        await client.query('ROLLBACK')
        txStarted = false
      } catch (rbErr) {
        rollbackErr = rbErr
      }
    }
    log('error', 'story_cleanup_failed', { message: err.message })
  } finally {
    if (client) {
      if (rollbackErr) {
        client.release(rollbackErr)
      } else {
        client.release()
      }
    }
    isCleaning = false
  }
}

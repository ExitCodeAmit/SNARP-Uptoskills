import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const MIGRATION_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('snarp:schema-migrations', 0))"
const MIGRATION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended('snarp:schema-migrations', 0))"
const MIGRATION_FILE = /^\d{3,}_[a-z0-9][a-z0-9_-]*\.sql$/

export async function loadMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]) || a.localeCompare(b))
  for (let i = 1; i < names.length; i += 1) {
    if (Number(names[i - 1].match(/^\d+/)[0]) === Number(names[i].match(/^\d+/)[0])) {
      throw new Error(`Duplicate migration version: ${names[i - 1]} and ${names[i]}`)
    }
  }
  return Promise.all(names.map(async (version) => ({
    version,
    sql: await readFile(directory instanceof URL ? new URL(version, directory) : path.join(directory, version), 'utf8'),
  })))
}

export async function runMigrations(pool, directory) {
  const migrations = await loadMigrations(directory)
  const client = await pool.connect()
  let locked = false
  try {
    await client.query(MIGRATION_LOCK_SQL)
    locked = true
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)

    const { rows } = await client.query('SELECT version FROM schema_migrations')
    const applied = new Set(rows.map(({ version }) => version))
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${migration.version} failed: ${err.message}`, { cause: err })
      }
    }
  } finally {
    let unlockError
    try {
      if (locked) await client.query(MIGRATION_UNLOCK_SQL)
    } catch (err) {
      unlockError = err
    }
    client.release(unlockError)
    if (unlockError) throw unlockError
  }
}

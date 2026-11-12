import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runMigrations } from './migrate.js'

function mockPool({ failOnSql } = {}) {
  const applied = new Set()
  const statements = []
  let released = false
  const client = {
    async query(sql, params = []) {
      const statement = String(sql).trim()
      statements.push(statement)
      if (failOnSql && statement.includes(failOnSql)) throw new Error('mock migration failure')
      if (statement.startsWith('SELECT version FROM schema_migrations')) {
        return { rows: [...applied].map((version) => ({ version })) }
      }
      if (statement.startsWith('INSERT INTO schema_migrations')) {
        applied.add(params[0])
      }
      return { rows: [] }
    },
    release() {
      released = true
    },
  }
  return {
    pool: { connect: async () => client },
    applied,
    statements,
    wasReleased: () => released,
  }
}

async function withMigrations(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'snarp-migrations-'))
  try {
    await mkdir(directory, { recursive: true })
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('applies migrations in numeric order once and releases the lock', async () => {
  await withMigrations(async (directory) => {
    await writeFile(path.join(directory, '010_later.sql'), 'SELECT 10;')
    await writeFile(path.join(directory, '002_earlier.sql'), 'SELECT 2;')
    await writeFile(path.join(directory, 'notes.txt'), 'ignored')
    const mock = mockPool()

    await runMigrations(mock.pool, directory)
    await runMigrations(mock.pool, directory)

    assert.deepEqual([...mock.applied], ['002_earlier.sql', '010_later.sql'])
    assert.equal(mock.statements.filter((statement) => statement === 'SELECT 2;').length, 1)
    assert.equal(mock.statements.filter((statement) => statement === 'SELECT 10;').length, 1)
    assert.equal(mock.statements.filter((statement) => statement === 'COMMIT').length, 2)
    assert.equal(mock.statements.filter((statement) => statement.includes('pg_advisory_unlock')).length, 2)
    assert.equal(mock.wasReleased(), true)
  })
})

test('rolls back a failed migration and releases the lock', async () => {
  await withMigrations(async (directory) => {
    await writeFile(path.join(directory, '001_failure.sql'), 'SELECT fail_migration;')
    const mock = mockPool({ failOnSql: 'fail_migration' })

    await assert.rejects(runMigrations(mock.pool, directory), /Migration 001_failure\.sql failed/)
    assert.ok(mock.statements.includes('ROLLBACK'))
    assert.ok(mock.statements.some((statement) => statement.includes('pg_advisory_unlock')))
    assert.equal(mock.wasReleased(), true)
    assert.equal(mock.applied.size, 0)
  })
})

test('rejects migration files with duplicate numeric versions', async () => {
  await withMigrations(async (directory) => {
    await writeFile(path.join(directory, '001_initial.sql'), 'SELECT 1;')
    await writeFile(path.join(directory, '001_other.sql'), 'SELECT 2;')
    const mock = mockPool()

    await assert.rejects(runMigrations(mock.pool, directory), /Duplicate migration version/)
    assert.equal(mock.statements.length, 0)
  })
})

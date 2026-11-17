import { createInterface } from 'node:readline'
import bcrypt from 'bcryptjs'
import { passwordProblem } from '../credentials.js'
import pg from 'pg'

const email = String(process.argv[2] ?? '').trim().toLowerCase()
if (!email) {
  console.error('Usage: npm run reset-password -- <email>')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
let prompt = ''
rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(text) }
const lines = rl[Symbol.asyncIterator]()
async function askHidden(question) {
  prompt = question
  process.stdout.write(question)
  const { value = '' } = await lines.next()
  process.stdout.write('\n')
  return value
}

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : { database: process.env.PGDATABASE || 'snarp' })
await client.connect()
try {
  const { rows } = await client.query('SELECT id, name, email FROM users WHERE email = $1', [email])
  if (!rows[0]) {
    console.error(`No account found for ${email}`)
    process.exitCode = 1
  } else {
    const password = await askHidden(`New password for ${rows[0].name} (at least 8 characters, letters plus numbers or symbols): `)
    const confirm = await askHidden('Type it again: ')
    if (password !== confirm) {
      console.error('Passwords do not match. Nothing changed.')
      process.exitCode = 1
    } else if (passwordProblem(password, rows[0])) {
      console.error(`${passwordProblem(password, rows[0])}. Nothing changed.`)
      process.exitCode = 1
    } else {
      const hash = await bcrypt.hash(password, 10)
      await client.query('BEGIN')
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].id, hash])
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].id])
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
         VALUES (NULL, 'account.password_reset', 'user', $1::text, '{"source": "cli"}'::jsonb)`,
        [rows[0].id]
      )
      await client.query('COMMIT')
      console.log(`Password updated for ${email}. All existing sessions were signed out.`)
    }
  }
} finally {
  rl.close()
  await client.end()
}

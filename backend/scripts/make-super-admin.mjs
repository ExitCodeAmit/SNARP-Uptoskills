import pg from 'pg'

const email = String(process.argv[2] ?? '').trim().toLowerCase()
if (!email) {
  console.error('Usage: npm run make-super-admin -- <email>')
  process.exit(1)
}

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : { database: process.env.PGDATABASE || 'snarp' })
await client.connect()
try {
  await client.query('BEGIN')
  const { rows } = await client.query(
    'SELECT id, name, role, email_verified_at, blocked_at FROM users WHERE email = $1 FOR UPDATE',
    [email]
  )
  const user = rows[0]
  let problem = null
  if (!user) problem = `No account uses ${email}. Sign up with that address and confirm it first; no account is created by this script.`
  else if (!user.email_verified_at) problem = `${email} has not confirmed its email address yet. Confirm it, then run this again.`
  else if (user.blocked_at) problem = `${email} is blocked. Unblock it before granting Super Admin.`
  else if (user.role === 'admin') problem = `${user.name} is already the Super Admin. Nothing changed.`
  if (problem) {
    await client.query('ROLLBACK')
    console.error(problem)
    process.exitCode = user?.role === 'admin' ? 0 : 1
  } else {
    await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id])
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details, actor_role)
       VALUES (NULL, 'user.role_changed', 'user', $1::text, jsonb_build_object('from', $2::text, 'to', 'admin', 'source', 'cli'), 'system')`,
      [user.id, user.role]
    )
    await client.query('COMMIT')
    console.log(`${user.name} (${email}) is now the Super Admin. Sign out and back in, then open /admin.`)
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  throw err
} finally {
  await client.end()
}

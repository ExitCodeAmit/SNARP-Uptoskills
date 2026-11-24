import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BREVO_SEND_URL, createMailer, createVerificationToken, hashToken, isTokenShape, isTransientMailError, mailProvider, parseAddress, passwordResetEmail, settleWithin, verificationEmail } from './mailer.js'

test('verification tokens are random, url-safe and stored only as a hash', () => {
  const a = createVerificationToken()
  const b = createVerificationToken()
  assert.notEqual(a.token, b.token)
  assert.ok(isTokenShape(a.token))
  assert.equal(a.hash, hashToken(a.token))
  assert.match(a.hash, /^[0-9a-f]{64}$/)
  assert.ok(!isTokenShape('short'))
  assert.ok(!isTokenShape(`${a.token}/`))
})

test('verification email includes the link and escapes the name', () => {
  const link = 'https://snarp.example/verify-email?token=abc'
  const mail = verificationEmail({ name: '<b>Meera</b> Iyer', link })
  assert.ok(mail.text.includes(link))
  assert.ok(mail.html.includes('&lt;b&gt;Meera&lt;/b&gt;'))
  assert.ok(!mail.html.includes('<b>Meera'))
})

test('without SMTP the mailer logs the message instead of sending', async () => {
  const logged = []
  const mailer = createMailer({ env: {}, log: (...args) => logged.push(args) })
  assert.equal(mailer.configured, false)
  const result = await mailer.send({ to: 'a@b.org', subject: 'Hi', text: 'link', html: '' })
  assert.equal(result.delivered, false)
  assert.equal(logged[0][1], 'mail_not_sent_smtp_unconfigured')
})

test('password reset email includes the link, the expiry and escapes the name', () => {
  const link = 'https://snarp.example/reset-password?token=abc'
  const mail = passwordResetEmail({ name: '<i>Ana</i> Lima', link })
  assert.equal(mail.subject, 'Reset your SNARP password')
  assert.ok(mail.text.includes(link) && mail.text.includes('60 minutes'))
  assert.ok(mail.html.includes('&lt;i&gt;Ana&lt;/i&gt;') && !mail.html.includes('<i>Ana'))
})

// Brevo / provider selection (Render's free plan blocks SMTP ports, so production uses Brevo's HTTPS API).
const brevoEnv = { BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'no-reply@snarp.example', BREVO_SENDER_NAME: 'SNARP' }
const mail = { to: 'reader@example.org', subject: 'Confirm', text: 'link', html: '<p>link</p>' }
const fakeFetch = (responses, calls = []) => async (url, init) => {
  calls.push({ url, init })
  const next = responses.shift()
  if (next instanceof Error) throw next
  return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} }
}
const noSleep = async () => {}

test('provider: MAIL_PROVIDER wins, then Brevo key, then SMTP, then log', () => {
  assert.equal(mailProvider({ MAIL_PROVIDER: 'smtp', BREVO_API_KEY: 'k' }), 'smtp')
  assert.equal(mailProvider({ BREVO_API_KEY: 'k', SMTP_URL: 'smtps://x' }), 'brevo')
  assert.equal(mailProvider({ SMTP_URL: 'smtps://x' }), 'smtp')
  assert.equal(mailProvider({}), 'log')
  assert.throws(() => mailProvider({ MAIL_PROVIDER: 'sendgrid' }), /MAIL_PROVIDER/)
})

test('Brevo sends one HTTPS request with the sender, recipient and both bodies', async () => {
  const calls = []
  const mailer = createMailer({ env: brevoEnv, log: () => {}, fetchImpl: fakeFetch([{ status: 201, body: { messageId: '<m1>' } }], calls), sleep: noSleep })
  assert.equal(mailer.provider, 'brevo')
  assert.equal(mailer.configured, true)
  assert.deepEqual(await mailer.send(mail), { delivered: true, id: '<m1>' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, BREVO_SEND_URL)
  assert.equal(calls[0].init.headers['api-key'], 'test-key')
  assert.ok(calls[0].init.signal, 'each request has a timeout')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sender: { email: 'no-reply@snarp.example', name: 'SNARP' },
    to: [{ email: 'reader@example.org' }],
    subject: 'Confirm', textContent: 'link', htmlContent: '<p>link</p>',
  })
})

test('Brevo falls back to MAIL_FROM for the sender and needs a key and a sender', () => {
  const fromMailFrom = createMailer({ env: { BREVO_API_KEY: 'k', MAIL_FROM: 'SNARP Team <team@snarp.example>' }, log: () => {} })
  assert.equal(fromMailFrom.configured, true)
  const missing = createMailer({ env: { MAIL_PROVIDER: 'brevo' }, log: () => {} })
  assert.equal(missing.configured, false)
  assert.match(missing.problem, /BREVO_API_KEY/)
})

test('temporary failures are retried twice, then the send succeeds', async () => {
  const logged = []
  const calls = []
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  const mailer = createMailer({ env: brevoEnv, log: (...args) => logged.push(args), fetchImpl: fakeFetch([{ status: 503 }, timeout, { status: 201 }], calls), sleep: noSleep })
  assert.equal((await mailer.send(mail)).delivered, true)
  assert.equal(calls.length, 3)
  assert.equal(logged.filter(([, event]) => event === 'mail_send_retry').length, 2)
})

test('permanent errors are not retried, and retries stop after three attempts', async () => {
  const rejected = createMailer({ env: brevoEnv, log: () => {}, fetchImpl: fakeFetch([{ status: 401, body: { code: 'unauthorized', message: 'Key not found' } }]), sleep: noSleep })
  await assert.rejects(rejected.send(mail), (err) => err.status === 401 && /Key not found/.test(err.message) && !/test-key/.test(err.message))
  const calls = []
  const down = createMailer({ env: brevoEnv, log: () => {}, fetchImpl: fakeFetch([{ status: 500 }, { status: 502 }, { status: 503 }, { status: 201 }], calls), sleep: noSleep })
  await assert.rejects(down.send(mail), (err) => err.status === 503)
  assert.equal(calls.length, 3)
})

test('transient errors include SMTP timeouts (blocked ports) and rate limits', () => {
  assert.equal(isTransientMailError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), true)
  assert.equal(isTransientMailError({ status: 429 }), true)
  assert.equal(isTransientMailError({ responseCode: 535 }), false)
  assert.equal(isTransientMailError({ status: 400 }), false)
})

test('SMTP is still used locally when only SMTP_URL is set', () => {
  const mailer = createMailer({ env: { SMTP_URL: 'smtps://user%40gmail.com:pass@smtp.gmail.com:465' }, log: () => {} })
  assert.equal(mailer.provider, 'smtp')
  assert.equal(mailer.configured, true)
})

test('settleWithin gives the result in time, or null while still sending', async () => {
  assert.equal(await settleWithin(Promise.resolve(true), 50), true)
  assert.equal(await settleWithin(Promise.resolve(false), 50), false)
  assert.equal(await settleWithin(new Promise((resolve) => setTimeout(() => resolve(true), 200)), 20), null)
})

test('parseAddress reads "Name <email>" and bare addresses', () => {
  assert.deepEqual(parseAddress('SNARP <no-reply@snarp.example>'), { name: 'SNARP', email: 'no-reply@snarp.example' })
  assert.deepEqual(parseAddress('no-reply@snarp.example'), { email: 'no-reply@snarp.example' })
  assert.equal(parseAddress(''), null)
})

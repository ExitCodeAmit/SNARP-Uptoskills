import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMailer, createVerificationToken, hashToken, isTokenShape, passwordResetEmail, verificationEmail } from './mailer.js'

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

import { createHash, randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'

export const VERIFICATION_TTL_HOURS = 24
export const RESET_TTL_MINUTES = 60

export function createVerificationToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

export const isTokenShape = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function verificationEmail({ name, link }) {
  const first = String(name).trim().split(/\s+/)[0] || 'there'
  const text = [
    `Hi ${first},`,
    '',
    'Confirm your email address to finish creating your SNARP account:',
    link,
    '',
    `This link expires in ${VERIFICATION_TTL_HOURS} hours and can be used once.`,
    "If you didn't sign up for SNARP, ignore this email and no account will be activated.",
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fafafa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border:1px solid #e4e4e7;border-radius:8px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#c2481a">SNARP</p>
<h1 style="margin:0 0 16px;font-size:20px">Confirm your email</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Hi ${escapeHtml(first)}, click the button to finish creating your SNARP account.</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Verify email</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#52525b">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#71717a">The link expires in ${VERIFICATION_TTL_HOURS} hours and works once. If you didn't sign up, ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`
  return { subject: 'Confirm your SNARP email address', text, html }
}

export function passwordResetEmail({ name, link }) {
  const first = String(name).trim().split(/\s+/)[0] || 'there'
  const text = [
    `Hi ${first},`,
    '',
    'Someone asked to reset the password of your SNARP account. Choose a new password here:',
    link,
    '',
    `This link expires in ${RESET_TTL_MINUTES} minutes and can be used once. Resetting signs you out on every device.`,
    "If you didn't ask for this, ignore this email; your password stays the same.",
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fafafa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border:1px solid #e4e4e7;border-radius:8px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#c2481a">SNARP</p>
<h1 style="margin:0 0 16px;font-size:20px">Reset your password</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Hi ${escapeHtml(first)}, click the button to choose a new password for your SNARP account.</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Choose a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#52525b">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#71717a">The link expires in ${RESET_TTL_MINUTES} minutes and works once. If you didn't ask for this, ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`
  return { subject: 'Reset your SNARP password', text, html }
}

export const MAIL_PROVIDERS = ['brevo', 'smtp', 'log']
export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'
const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account'
const ATTEMPT_TIMEOUT_MS = 10_000
const RETRY_DELAYS_MS = [1_000, 3_000]
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'])

// "SNARP <no-reply@example.org>" -> { name: 'SNARP', email: 'no-reply@example.org' }
export function parseAddress(value) {
  const text = String(value ?? '').trim()
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(text)
  if (match) return { name: match[1].trim() || undefined, email: match[2].trim() }
  return text ? { email: text } : null
}

// Which provider sends mail: MAIL_PROVIDER when set, otherwise Brevo when its key is set,
// SMTP when an SMTP server is set, and otherwise none (messages are written to the log).
export function mailProvider(env = process.env) {
  const chosen = String(env.MAIL_PROVIDER ?? '').trim().toLowerCase()
  if (chosen) {
    if (!MAIL_PROVIDERS.includes(chosen)) throw new Error(`MAIL_PROVIDER must be one of ${MAIL_PROVIDERS.join(', ')}`)
    return chosen
  }
  if (env.BREVO_API_KEY?.trim()) return 'brevo'
  if (env.SMTP_URL?.trim() || env.SMTP_HOST?.trim()) return 'smtp'
  return 'log'
}

// Errors worth another try: timeouts, network failures, rate limits and server errors.
export function isTransientMailError(err) {
  if (!err) return false
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  if (TRANSIENT_CODES.has(err.code)) return true
  // HTTP (Brevo): 429 and 5xx are temporary.
  const status = Number(err.status)
  if (status === 429 || (status >= 500 && status < 600)) return true
  // SMTP: 4xx replies mean "try again later"; 5xx (for example 535, wrong password) are permanent.
  const reply = Number(err.responseCode)
  return reply >= 400 && reply < 500
}

function brevoError(status, body) {
  const detail = body?.message ? `: ${String(body.message).slice(0, 200)}` : ''
  return Object.assign(new Error(`Brevo returned ${status}${detail}`), { status, code: body?.code ?? null })
}

function createBrevoTransport({ env, fetchImpl }) {
  const apiKey = env.BREVO_API_KEY?.trim()
  const fallback = parseAddress(env.MAIL_FROM)
  const sender = {
    email: env.BREVO_SENDER_EMAIL?.trim() || fallback?.email,
    name: env.BREVO_SENDER_NAME?.trim() || fallback?.name || 'SNARP',
  }
  if (!apiKey || !sender.email) return { ready: false, problem: 'Set BREVO_API_KEY and BREVO_SENDER_EMAIL to send email with Brevo.' }
  const headers = { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' }
  return {
    ready: true,
    async send({ to, subject, text, html }) {
      const res = await fetchImpl(BREVO_SEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
      if (!res.ok) throw brevoError(res.status, await res.json().catch(() => null))
      const body = await res.json().catch(() => null)
      return { id: body?.messageId ?? null }
    },
    async verify() {
      const res = await fetchImpl(BREVO_ACCOUNT_URL, { headers, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) })
      if (!res.ok) throw brevoError(res.status, await res.json().catch(() => null))
    },
  }
}

function createSmtpTransport({ env }) {
  const from = env.MAIL_FROM || env.SMTP_USER || 'SNARP <no-reply@localhost>'
  // Give up on an unreachable server instead of waiting minutes (some hosts block SMTP ports).
  const timeouts = { connectionTimeout: ATTEMPT_TIMEOUT_MS, greetingTimeout: ATTEMPT_TIMEOUT_MS, socketTimeout: 15_000 }
  let transport = null
  if (env.SMTP_URL?.trim()) {
    transport = nodemailer.createTransport({ url: env.SMTP_URL.trim(), ...timeouts })
  } else if (env.SMTP_HOST?.trim()) {
    const port = Number.parseInt(env.SMTP_PORT, 10) || 587
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST.trim(),
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      ...timeouts,
    })
  }
  if (!transport) return { ready: false, problem: 'Set SMTP_URL or SMTP_HOST to send email over SMTP.' }
  return {
    ready: true,
    async send({ to, subject, text, html }) {
      const info = await transport.sendMail({ from, to, subject, text, html })
      return { id: info?.messageId ?? null }
    },
    verify: () => transport.verify(),
  }
}

// Sends email through Brevo's HTTPS API (works where SMTP ports are blocked) or SMTP (local
// development with Gmail). Each attempt times out after 10 seconds; temporary failures are
// retried twice. Without a provider the message is written to the log instead.
export function createMailer({ env = process.env, log, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const provider = mailProvider(env)
  const transport = provider === 'brevo' ? createBrevoTransport({ env, fetchImpl })
    : provider === 'smtp' ? createSmtpTransport({ env })
      : { ready: false, problem: 'No email provider is set.' }

  return {
    provider,
    configured: transport.ready,
    problem: transport.ready ? null : transport.problem,
    async send({ to, subject, text, html }) {
      if (!transport.ready) {
        log('warn', 'mail_not_sent_smtp_unconfigured', { provider, to, subject, text })
        return { delivered: false }
      }
      for (let attempt = 1; ; attempt += 1) {
        try {
          const { id } = await transport.send({ to, subject, text, html })
          if (attempt > 1) log('info', 'mail_sent_after_retry', { provider, attempt, subject })
          return { delivered: true, id }
        } catch (err) {
          if (attempt > RETRY_DELAYS_MS.length || !isTransientMailError(err)) throw err
          log('warn', 'mail_send_retry', { provider, attempt, code: err.code ?? null, status: err.status ?? null, message: err.message })
          await sleep(RETRY_DELAYS_MS[attempt - 1])
        }
      }
    },
    verify: () => (transport.ready ? transport.verify() : Promise.resolve()),
  }
}

// Waits for a delivery up to `ms`. Resolves to true or false when it finishes in time, or to null
// while it is still going (it keeps running in the background; its outcome is logged).
export function settleWithin(promise, ms) {
  let timer
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

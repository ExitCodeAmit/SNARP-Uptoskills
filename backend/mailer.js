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

export function createMailer({ env = process.env, log }) {
  const url = env.SMTP_URL
  const host = env.SMTP_HOST
  const from = env.MAIL_FROM || env.SMTP_USER || 'SNARP <no-reply@localhost>'
  let transport = null
  if (url) {
    transport = nodemailer.createTransport(url)
  } else if (host) {
    const port = Number.parseInt(env.SMTP_PORT, 10) || 587
    transport = nodemailer.createTransport({
      host,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  }

  return {
    configured: !!transport,
    async send({ to, subject, text, html }) {
      if (!transport) {
        log('warn', 'mail_not_sent_smtp_unconfigured', { to, subject, text })
        return { delivered: false }
      }
      await transport.sendMail({ from, to, subject, text, html })
      return { delivered: true }
    },
    verify: () => transport?.verify(),
  }
}

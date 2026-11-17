import { createMailer } from '../mailer.js'

const to = String(process.argv[2] ?? '').trim()
const log = () => {}
const mailer = createMailer({ log })

function hint(err) {
  const text = `${err.code ?? ''} ${err.responseCode ?? ''} ${err.message ?? ''}`
  if (/EAUTH|535|534|Application-specific password|Username and Password not accepted/i.test(text)) {
    return 'The server rejected the user name or password. For Gmail, turn on 2-Step Verification and use a 16-character App Password (https://myaccount.google.com/apppasswords), not your normal password. In SMTP_URL, write the @ of your email as %40.'
  }
  if (/ENOTFOUND|EDNS|getaddrinfo/i.test(text)) return 'The SMTP host name could not be found. Check SMTP_HOST or the host part of SMTP_URL.'
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|ECONNECTION/i.test(text)) return 'Could not connect. Check the port (465 with smtps://, or 587 with smtp://) and that your network or antivirus allows outgoing mail.'
  if (/self[- ]signed|certificate|wrong version number|SSL/i.test(text)) return 'TLS failed. Use port 465 with smtps:// (or SMTP_SECURE=true), or port 587 with smtp:// (SMTP_SECURE=false).'
  if (/550|553|sender|from/i.test(text)) return 'The server refused the sender. Set MAIL_FROM to an address your SMTP account is allowed to send from.'
  return 'See the message above for details.'
}

if (!mailer.configured) {
  console.log(`SMTP is not configured, so emails are only written to the server log.

Add these lines to backend/.env (Gmail example), then run this again:

  SMTP_URL=smtps://yourname%40gmail.com:your-16-char-app-password@smtp.gmail.com:465
  MAIL_FROM=SNARP <yourname@gmail.com>
  APP_URL=http://localhost:5000

Create the app password at https://myaccount.google.com/apppasswords (needs 2-Step Verification).`)
  process.exit(1)
}

try {
  process.stdout.write('Checking the SMTP login... ')
  await mailer.verify()
  console.log('OK')
} catch (err) {
  console.log('FAILED')
  console.error(`  ${err.message}\n  ${hint(err)}`)
  process.exit(1)
}

if (!to) {
  console.log('Login works. To send a test email: npm run mail:test -- you@example.com')
  process.exit(0)
}

try {
  process.stdout.write(`Sending a test email to ${to}... `)
  await mailer.send({
    to,
    subject: 'SNARP test email',
    text: `Email from SNARP works. Verification and password reset emails will now be delivered.\n\nSent ${new Date().toLocaleString()}.`,
    html: `<p>Email from <strong>SNARP</strong> works. Verification and password reset emails will now be delivered.</p><p style="color:#71717a">Sent ${new Date().toLocaleString()}.</p>`,
  })
  console.log('sent. Check the inbox (and the spam folder).')
} catch (err) {
  console.log('FAILED')
  console.error(`  ${err.message}\n  ${hint(err)}`)
  process.exit(1)
}

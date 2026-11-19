import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, BookOpenText, ChatsCircle, Check, EnvelopeOpen, EnvelopeSimple, Eye, EyeSlash, Info,
  PenNib, UsersThree, Warning,
} from '@phosphor-icons/react'
import { api } from './api'
import { passwordProblem, safeNext } from './password'
import PasswordMeter from './components/PasswordMeter'
import logo from './assets/logo.png'

const LAST_EMAIL_KEY = 'snarp-last-email'
const FIELD_ORDER = ['name', 'email', 'password', 'confirm']

const readLastEmail = () => {
  try { return localStorage.getItem(LAST_EMAIL_KEY) ?? '' } catch { return '' }
}

function validate(form, isSignup) {
  const errors = {}
  const name = form.name.trim()
  if (isSignup && name.length < 2) errors.name = 'Enter your full name'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errors.email = 'Enter a valid email address'
  if (isSignup) {
    const problem = passwordProblem(form.password, { email: form.email, name })
    if (problem) errors.password = problem
    if (!form.confirm) errors.confirm = 'Type your password again'
    else if (form.confirm !== form.password) errors.confirm = 'Passwords do not match'
  } else if (!form.password) {
    errors.password = 'Enter your password'
  }
  return errors
}

const FEATURES = [
  { icon: BookOpenText, title: 'Publish and discover research', text: 'Share papers, read PDFs in the browser and cite in one click.' },
  { icon: UsersThree, title: 'Follow researchers and communities', text: 'A feed built around the people and topics you care about.' },
  { icon: ChatsCircle, title: 'Discuss and collaborate', text: 'Comment on papers, message peers and join academic events.' },
]

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, visible, onToggle, onCapsLock }) {
  const capsCheck = (event) => onCapsLock?.(event.getModifierState?.('CapsLock') ?? false)
  return (
    <div className="password">
      <input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        onKeyUp={capsCheck}
        onKeyDown={capsCheck}
        onBlur={() => onCapsLock?.(false)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        spellCheck={false}
      />
      {onToggle && (
        <button type="button" className="icon-btn" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
          {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  )
}

export function AuthShell({ children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Link to="/" className="auth-aside-logo"><img src={logo} alt="UptoSkills" /></Link>
        <div className="auth-aside-body">
          <p className="auth-kicker">SNARP · Social Networking &amp; Academic Research Platform</p>
          <h2>Where students and researchers share work that matters.</h2>
          <ul className="auth-features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="auth-feature-icon"><Icon size={20} weight="duotone" /></span>
                <div><strong>{title}</strong><span>{text}</span></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-aside-foot">Built during the UptoSkills internship programme.</p>
      </aside>

      <main className="auth-main">
        <Link to="/" className="auth-logo-link"><img src={logo} alt="UptoSkills" className="auth-logo" /></Link>
        {children}
      </main>
    </div>
  )
}

export function ResendButton({ email }) {
  const [state, setState] = useState({ sending: false, message: '', error: '' })
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (!wait) return undefined
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const resend = async () => {
    setState({ sending: true, message: '', error: '' })
    try {
      const { message } = await api('/auth/resend-verification', { method: 'POST', body: { email } })
      setState({ sending: false, message, error: '' })
      setWait(60)
    } catch (err) {
      setState({ sending: false, message: '', error: err.message })
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-block auth-resend" onClick={resend} disabled={state.sending || wait > 0 || !email}>
        <EnvelopeSimple size={16} />
        {state.sending ? 'Sending…' : wait ? `Resend available in ${wait}s` : 'Resend verification email'}
      </button>
      {state.message && <p className="auth-status" role="status">{state.message}</p>}
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
    </>
  )
}

function ForgotPassword({ initialEmail }) {
  const [email, setEmail] = useState(initialEmail)
  const [state, setState] = useState({ sending: false, message: '', error: '' })
  const send = async () => {
    setState({ sending: true, message: '', error: '' })
    try {
      const { message } = await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } })
      setState({ sending: false, message, error: '' })
    } catch (err) {
      setState({ sending: false, message: '', error: err.message })
    }
  }
  return (
    <div id="forgot-help" className="forgot-box">
      <p><strong>Reset your password</strong> Enter your account email and we will send you a link to choose a new password.</p>
      {state.message
        ? <p className="auth-status" role="status"><EnvelopeSimple size={15} /> {state.message}</p>
        : (
          <div className="forgot-row">
            <input type="email" aria-label="Account email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />
            <button type="button" className="btn btn-secondary" onClick={send} disabled={state.sending || !email.trim()}>{state.sending ? 'Sending…' : 'Send link'}</button>
          </div>
        )}
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
    </div>
  )
}

function CheckEmail({ email, emailSent, onBack, nextQuery }) {
  return (
    <section className="auth-form auth-card-center" aria-live="polite">
      <span className="auth-big-icon"><EnvelopeOpen size={30} weight="duotone" /></span>
      <header className="auth-head">
        <h1>Check your email</h1>
        <p>We sent a confirmation link to <strong>{email}</strong>. Open it to activate your account. The link works for 24 hours.</p>
      </header>
      {!emailSent && (
        <p className="auth-help">
          <Info size={16} />
          <span>The email could not be delivered right now. Try resending in a minute. If it still doesn&apos;t arrive, contact the SNARP administrator.</span>
        </p>
      )}
      <ul className="auth-tips">
        <li>Can&apos;t find it? Check your spam or promotions folder.</li>
        <li>It comes from SNARP with the subject &quot;Confirm your SNARP email address&quot;.</li>
      </ul>
      <ResendButton email={email} />
      <p className="auth-fineprint">
        Wrong address? <button type="button" className="link-btn" onClick={onBack}>Sign up again</button>
        {' · '}Already confirmed? <Link to={`/login${nextQuery}`}>Log in</Link>
      </p>
    </section>
  )
}

export default function Auth({ mode, onAuth }) {
  const isSignup = mode === 'signup'
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const nextQuery = next !== '/' ? `?next=${encodeURIComponent(next)}` : ''
  const [form, setForm] = useState(() => ({
    name: '', email: isSignup ? '' : readLastEmail(), password: '', confirm: '', role: 'user', remember: true,
  }))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(() => params.get('forgot') === '1')
  const justReset = !isSignup && params.get('reset') === '1'
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState(null)
  const [unverified, setUnverified] = useState('')
  const formRef = useRef(null)

  const [firstField] = useState(() => (!isSignup && form.email ? 'password' : isSignup ? 'name' : 'email'))

  useEffect(() => {
    formRef.current?.querySelector(`#${firstField}`)?.focus()
  }, [firstField])

  const update = (e) => {
    const { name, value, type, checked } = e.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  const focusField = (name) => formRef.current?.querySelector(`#${name}`)?.focus()

  const submit = async (e) => {
    e.preventDefault()
    const found = validate(form, isSignup)
    setErrors(found)
    setServerError('')
    setUnverified('')
    const firstInvalid = FIELD_ORDER.find((name) => found[name])
    if (firstInvalid) return focusField(firstInvalid)

    setSubmitting(true)
    try {
      const body = isSignup
        ? { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }
        : { email: form.email.trim(), password: form.password, remember: form.remember }
      const result = await api(`/auth/${mode}`, { method: 'POST', body })
      try {
        if (isSignup || form.remember) localStorage.setItem(LAST_EMAIL_KEY, form.email.trim().toLowerCase())
        else localStorage.removeItem(LAST_EMAIL_KEY)
      } catch {}
      if (result.verification_required) {
        setSubmitting(false)
        setPending({ email: result.email, emailSent: result.email_sent })
        return
      }
      onAuth(result, isSignup || form.remember)
    } catch (err) {
      setSubmitting(false)
      if (err.code === 'email_unverified') {
        setUnverified(form.email.trim())
        setServerError(err.message)
      } else if (err.field && FIELD_ORDER.includes(err.field)) {
        setErrors({ [err.field]: err.message })
        focusField(err.field)
      } else {
        setServerError(err.message)
        if (err.status === 401) {
          setForm((current) => ({ ...current, password: '' }))
          focusField('password')
        }
      }
    }
  }

  const field = (name, label, props) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        value={form[name]}
        onChange={update}
        aria-invalid={!!errors[name]}
        aria-describedby={`${name}-error`}
        {...props}
      />
      <span id={`${name}-error`} className="field-error">{errors[name]}</span>
    </div>
  )

  if (pending) {
    return (
      <AuthShell>
        <CheckEmail
          email={pending.email}
          emailSent={pending.emailSent}
          nextQuery={nextQuery}
          onBack={() => { setPending(null); setForm((current) => ({ ...current, password: '', confirm: '' })) }}
        />
      </AuthShell>
    )
  }

  const confirmMatches = isSignup && form.confirm && form.confirm === form.password
  const context = { email: form.email, name: form.name }

  return (
    <AuthShell>
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
        <header className="auth-head">
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p>{isSignup ? 'Join SNARP to follow research, share posts and publish papers.' : 'Log in to continue to your SNARP feed.'}</p>
        </header>

        {justReset && !serverError && <p className="notice" role="status">Password changed. Log in with your new password.</p>}
        {serverError && (
          <p className="alert" role="alert">
            {serverError}
            {serverError.includes('already exists') && <> <Link to={`/login${nextQuery}`}>Log in</Link></>}
          </p>
        )}
        {unverified && <ResendButton email={unverified} />}

        {isSignup && field('name', 'Full name', { autoComplete: 'name', placeholder: 'e.g. Priya Sharma', maxLength: 100 })}
        {field('email', 'Email', { type: 'email', autoComplete: isSignup ? 'email' : 'username', placeholder: 'you@university.edu', maxLength: 255, inputMode: 'email' })}

        <div className="field">
          <div className="field-row">
            <label htmlFor="password">Password</label>
            {!isSignup && (
              <button type="button" className="link-btn" onClick={() => setForgotOpen(!forgotOpen)} aria-expanded={forgotOpen} aria-controls="forgot-help">
                Forgot password?
              </button>
            )}
          </div>
          <PasswordInput
            id="password"
            value={form.password}
            onChange={update}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            invalid={!!errors.password}
            describedBy="password-error"
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
            onCapsLock={setCapsLock}
          />
          {capsLock && <span className="caps-warning" role="status"><Warning size={14} weight="fill" /> Caps Lock is on</span>}
          <span id="password-error" className="field-error">{errors.password}</span>
          {isSignup && <PasswordMeter password={form.password} context={context} />}
          {!isSignup && forgotOpen && (
            <ForgotPassword initialEmail={form.email} />
          )}
        </div>

        {isSignup && (
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <PasswordInput
              id="confirm"
              value={form.confirm}
              onChange={update}
              autoComplete="new-password"
              invalid={!!errors.confirm}
              describedBy="confirm-error"
              visible={showPassword}
              onCapsLock={setCapsLock}
            />
            {confirmMatches && !errors.confirm
              ? <span className="field-ok"><Check size={14} weight="bold" /> Passwords match</span>
              : <span id="confirm-error" className="field-error">{errors.confirm}</span>}
          </div>
        )}

        {isSignup ? (
          <fieldset className="roles">
            <legend>I want to</legend>
            <label className={form.role === 'user' ? 'active' : ''}>
              <input type="radio" name="role" value="user" checked={form.role === 'user'} onChange={update} />
              <span className="role-icon"><BookOpenText size={20} /></span>
              <strong>Read &amp; discuss</strong>
              <span>Follow research, post and comment</span>
            </label>
            <label className={form.role === 'author' ? 'active' : ''}>
              <input type="radio" name="role" value="author" checked={form.role === 'author'} onChange={update} />
              <span className="role-icon"><PenNib size={20} /></span>
              <strong>Publish papers</strong>
              <span>Everything above, plus submit papers</span>
            </label>
          </fieldset>
        ) : (
          <label className="check">
            <input type="checkbox" name="remember" checked={form.remember} onChange={update} />
            Keep me logged in for 7 days
          </label>
        )}

        <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={submitting}>
          {submitting
            ? (isSignup ? 'Creating account…' : 'Logging in…')
            : <>{isSignup ? 'Create account' : 'Log in'} <ArrowRight size={16} weight="bold" /></>}
        </button>

        {isSignup && (
          <p className="auth-fineprint">We&apos;ll email you a link to confirm your address. You can fill in your institution, research interests and photo after signing up. Moderator and admin roles are assigned by an administrator.</p>
        )}
      </form>

      <p className="auth-switch">
        {isSignup ? 'Already have an account? ' : 'New to SNARP? '}
        <Link to={`${isSignup ? '/login' : '/signup'}${nextQuery}`}>{isSignup ? 'Log in' : 'Create an account'}</Link>
      </p>
    </AuthShell>
  )
}

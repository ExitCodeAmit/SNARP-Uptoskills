import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { api } from './api'
import logo from './assets/logo.png'

const EMPTY = { name: '', email: '', password: '', confirm: '', role: 'user', remember: true }

function validate(form, isSignup) {
  const errors = {}
  if (isSignup && !form.name.trim()) errors.name = 'Enter your full name'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address'
  if (form.password.length < 8) errors.password = 'Password must be at least 8 characters'
  if (isSignup && form.confirm !== form.password) errors.confirm = 'Passwords do not match'
  return errors
}

export default function Auth({ mode, onAuth }) {
  const isSignup = mode === 'signup'
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const update = (e) => {
    const { name, value, type, checked } = e.target
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value })
    setErrors({ ...errors, [name]: undefined })
  }

  const submit = async (e) => {
    e.preventDefault()
    const next = validate(form, isSignup)
    setErrors(next)
    setServerError('')
    if (Object.keys(next).length) return

    setSubmitting(true)
    try {
      const body = isSignup
        ? { name: form.name, email: form.email, password: form.password, role: form.role }
        : { email: form.email, password: form.password, remember: form.remember }
      onAuth(await api(`/auth/${mode}`, { method: 'POST', body }), isSignup || form.remember)
    } catch (err) {
      setServerError(err.message)
      setSubmitting(false)
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

  return (
    <div className="auth">
      <aside className="auth-brand">
        <Link to="/"><img src={logo} alt="UptoSkills" className="auth-logo" /></Link>
        <div>
          <h2>A shared space for students and researchers.</h2>
          <p>Post updates, share what you are working on, and follow your peers.</p>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={submit} noValidate>
          <Link to="/" className="auth-logo-mobile"><img src={logo} alt="UptoSkills" className="auth-logo" /></Link>
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-sub">
            {isSignup ? 'It takes less than a minute.' : 'Log in to continue to your dashboard.'}
          </p>

          {serverError && <p className="alert" role="alert">{serverError}</p>}

          {isSignup && field('name', 'Full name', { autoComplete: 'name' })}
          {field('email', 'Email', { type: 'email', autoComplete: 'email', placeholder: 'you@university.edu' })}

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={update}
                aria-invalid={!!errors.password}
                aria-describedby="password-error"
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <span id="password-error" className="field-error">{errors.password}</span>
          </div>

          {isSignup && field('confirm', 'Confirm password', {
            type: showPassword ? 'text' : 'password',
            autoComplete: 'new-password',
          })}

          {isSignup ? (
            <fieldset className="roles">
              <legend>I want to</legend>
              <label className={form.role === 'user' ? 'active' : ''}>
                <input type="radio" name="role" value="user" checked={form.role === 'user'} onChange={update} />
                <strong>Read and discuss</strong>
                <span>Follow posts from peers</span>
              </label>
              <label className={form.role === 'author' ? 'active' : ''}>
                <input type="radio" name="role" value="author" checked={form.role === 'author'} onChange={update} />
                <strong>Publish research</strong>
                <span>Share your own work</span>
              </label>
            </fieldset>
          ) : (
            <label className="check">
              <input type="checkbox" name="remember" checked={form.remember} onChange={update} />
              Keep me logged in
            </label>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>

          <p className="auth-switch">
            {isSignup ? 'Already have an account? ' : 'New here? '}
            <Link to={isSignup ? '/login' : '/signup'}>{isSignup ? 'Log in' : 'Create an account'}</Link>
          </p>
        </form>
      </main>
    </div>
  )
}

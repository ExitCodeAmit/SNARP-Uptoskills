import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeSlash, Key, WarningCircle } from '@phosphor-icons/react'
import { api } from './api'
import { AuthShell } from './Auth'
import PasswordMeter from './components/PasswordMeter'
import { passwordProblem } from './password'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [state, setState] = useState({ saving: false, error: '', code: '' })

  const submit = async (event) => {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) return setState({ saving: false, error: problem, code: '' })
    if (password !== confirm) return setState({ saving: false, error: 'Passwords do not match', code: '' })
    setState({ saving: true, error: '', code: '' })
    try {
      const { email } = await api('/auth/reset-password', { method: 'POST', body: { token, password } })
      try { localStorage.setItem('snarp-last-email', email) } catch {}
      navigate('/login?reset=1', { replace: true })
    } catch (err) {
      setState({ saving: false, error: err.message, code: err.code ?? '' })
    }
  }

  const linkBroken = !token || ['invalid', 'used', 'expired'].includes(state.code)
  return (
    <AuthShell>
      {linkBroken ? (
        <section className="auth-form auth-card-center">
          <span className="auth-big-icon warn"><WarningCircle size={30} weight="duotone" /></span>
          <header className="auth-head">
            <h1>{state.code === 'expired' ? 'Link expired' : state.code === 'used' ? 'Link already used' : 'Link not valid'}</h1>
            <p>{state.error || 'This reset link is incomplete.'} Ask for a new link from the login page.</p>
          </header>
          <Link to="/login?forgot=1" className="btn btn-primary btn-block auth-submit">Send a new link</Link>
        </section>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <span className="auth-big-icon"><Key size={28} weight="duotone" /></span>
          <header className="auth-head auth-card-center">
            <h1>Choose a new password</h1>
            <p>You will be signed out on every device, then you can log in with the new password.</p>
          </header>
          {state.error && <p className="alert" role="alert">{state.error}</p>}
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <div className="password">
              <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setState((c) => ({ ...c, error: '' })) }} autoFocus />
              <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeSlash size={18} /> : <Eye size={18} />}</button>
            </div>
            <PasswordMeter password={password} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setState((c) => ({ ...c, error: '' })) }} />
          </div>
          <button className="btn btn-primary btn-block auth-submit" disabled={state.saving}>{state.saving ? 'Saving…' : 'Set new password'}</button>
          <p className="auth-fineprint">Remembered it? <Link to="/login">Log in</Link></p>
        </form>
      )}
    </AuthShell>
  )
}

import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ArrowSquareOut, Eye, EyeSlash, Moon, SignOut, Sun } from '@phosphor-icons/react'
import { api, clearAdminToken, getAdminToken, saveAdminToken } from '../api'
import { AdminDashboard } from '../pages/admin'
import { setThemePreference, useApplyTheme } from '../theme'

function DeskLogin({ onSignedIn }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [show, setShow] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })
  const submit = async (e) => {
    e.preventDefault()
    setState({ busy: true, error: '' })
    try {
      const session = await api('/admin/login', { method: 'POST', body: form })
      saveAdminToken(session.token)
      onSignedIn(session.user)
      navigate('/admin', { replace: true })
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }
  return (
    <main className="desk-login">
      <section className="desk-login-copy" aria-hidden="true">
        <p className="desk-login-mark">SNARP <span>Editor&apos;s desk</span></p>
        <p className="desk-login-line">Every paper that reaches the public shelf crosses this desk first.</p>
        <ol className="desk-login-steps">
          <li><span>i</span> Submitted</li>
          <li><span>ii</span> Read by a moderator</li>
          <li><span>iii</span> Approved or returned</li>
          <li><span>iv</span> Published</li>
        </ol>
      </section>
      <form className="desk-login-form" onSubmit={submit} noValidate>
        <h1>Sign in to the desk</h1>
        <p className="desk-login-note">Restricted to the Super Admin. Sign-ins are recorded in the audit log.</p>
        <div className="field">
          <label htmlFor="desk-email">Email</label>
          <input id="desk-email" type="email" autoComplete="username" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={!!state.error} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="desk-password">Password</label>
          <div className="desk-password">
            <input id="desk-password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} aria-invalid={!!state.error} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {state.error && <p className="alert" role="alert">{state.error}</p>}
        <button type="submit" className="btn btn-primary desk-login-submit" disabled={state.busy || !form.email || !form.password}>
          {state.busy ? 'Checking…' : 'Open the desk'}
        </button>
        <a className="desk-login-back" href="/">Back to SNARP</a>
      </form>
    </main>
  )
}

function DeskBar({ user, onSignOut, theme }) {
  return (
    <header className="desk-bar">
      <a className="desk-bar-mark" href="/admin">SNARP <span>Editor&apos;s desk</span></a>
      <div className="desk-bar-right">
        <button type="button" className="icon-btn" onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
        <span className="desk-bar-user"><strong>{user.name}</strong><small>Super Admin</small></span>
        <a className="btn btn-ghost btn-sm" href="/" target="_blank" rel="noreferrer"><ArrowSquareOut size={15} /> <span>Open site</span></a>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSignOut}><SignOut size={15} /> <span>Sign out</span></button>
      </div>
    </header>
  )
}

function Desk() {
  const theme = useApplyTheme()
  const [session, setSession] = useState(() => ({ status: getAdminToken() ? 'checking' : 'out', user: null }))

  useEffect(() => {
    const signedOut = () => { clearAdminToken(); setSession({ status: 'out', user: null }) }
    window.addEventListener('snarp:desk-signed-out', signedOut)
    return () => window.removeEventListener('snarp:desk-signed-out', signedOut)
  }, [])

  useEffect(() => {
    if (session.status !== 'checking') return
    api('/auth/me')
      .then((user) => {
        if (user.role === 'admin') setSession({ status: 'in', user })
        else { clearAdminToken(); setSession({ status: 'out', user: null }) }
      })
      .catch(() => { clearAdminToken(); setSession({ status: 'out', user: null }) })
  }, [session.status])

  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    clearAdminToken()
    setSession({ status: 'out', user: null })
  }

  if (session.status === 'checking') return <div className="desk-app console desk-wait" aria-busy="true" />
  return (
    <div className="desk-app console">
      <Routes>
        <Route path="/admin/login" element={session.status === 'in' ? <Navigate to="/admin" replace /> : <DeskLogin onSignedIn={(user) => setSession({ status: 'in', user })} />} />
        <Route path="/admin/*" element={session.status === 'in'
          ? <><DeskBar user={session.user} onSignOut={signOut} theme={theme} /><div className="desk-body"><AdminDashboard /></div></>
          : <Navigate to="/admin/login" replace />} />
      </Routes>
    </div>
  )
}

export default function AdminApp() {
  return (
    <BrowserRouter>
      <Desk />
    </BrowserRouter>
  )
}

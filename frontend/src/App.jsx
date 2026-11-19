import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useSearchParams,
} from 'react-router-dom'

import { api, getToken, saveToken, clearToken, isAdminArea } from './api'
import { clearTheme } from './theme'
import Auth from './Auth'
import VerifyEmail from './VerifyEmail'
import ResetPassword from './ResetPassword'
import { safeNext } from './password'
import Layout from './Layout'
import Feed from './Feed'
import Reels from './Reels'
import CitationNetwork from './CitationNetwork'
import Leaderboard from './Leaderboard'

import {
  Communities,
  CommunityDetail,
  Articles,
  Events,
  EventDetail,
  Messages,
  Notifications,
  Tools,
  Submit,
  MySubmissions,
  Settings,
  Help,
  Search,
  UserProfile,
  PaperDetail,
  SavedPapers,
} from './pages'
import { ReviewQueue, ReviewWorkspace, SubmissionFeedback } from './pages/review'
import { AccessDenied, ModeratorDashboard } from './pages/admin'

const DocsHome = lazy(() => import('./docs/DocsHome'))
const DocsEditor = lazy(() => import('./docs/DocsEditor'))
const docsFallback = <div className="page"><div className="panel empty" aria-busy="true">Loading Docs…</div></div>

function GuestOnly({ user, children }) {
  const [params] = useSearchParams()
  return user ? <Navigate to={safeNext(params.get('next'))} replace /> : children
}

function RedirectToLogin() {
  const { pathname, search } = useLocation()
  const target = `${pathname}${search}`
  return <Navigate to={target === '/' ? '/login' : `/login?next=${encodeURIComponent(target)}`} replace />
}

const Landing = lazy(() => import('./Landing'))
const AdminApp = lazy(() => import('./admin/AdminApp'))

export default function App() {
  if (isAdminArea()) return <Suspense fallback={null}><AdminApp /></Suspense>
  return <SiteApp />
}

function SiteApp() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(() => !!getToken())

  useEffect(() => {
    const blocked = () => { clearToken(); setUser(null) }
    window.addEventListener('snarp:account-blocked', blocked)
    return () => window.removeEventListener('snarp:account-blocked', blocked)
  }, [])

  useEffect(() => {
    if (!getToken()) return

    api('/auth/me')
      .then(setUser)
      .catch((err) => {
        clearTheme()
        if (err.status === 401 || err.code === 'account_blocked') {
          clearToken()
        }
      })
      .finally(() => {
        setChecking(false)
      })
  }, [])

  const onAuth = useCallback(({ token, user }, remember = true) => {
    saveToken(token, remember)
    setUser(user)
  }, [])

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
    }

    clearToken()
    setUser(null)
  }

  const accountDeleted = () => {
    clearToken()
    setUser(null)
  }

  if (checking) {
    return null
  }

  const guest = (mode) => (
    <GuestOnly user={user}>
      <Auth key={mode} mode={mode} onAuth={onAuth} />
    </GuestOnly>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={guest('login')} />
        <Route path="/signup" element={guest('signup')} />
        <Route path="/verify-email" element={<VerifyEmail onAuth={onAuth} />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {user ? (
          <Route element={<Layout user={user} onLogout={logout} />}>
            <Route
              path="/"
              element={<Feed user={user} onLogout={logout} />}
            />

            <Route path="/reels" element={<Reels user={user} />} />
            <Route path="/docs" element={<Suspense fallback={docsFallback}><DocsHome user={user} /></Suspense>} />
            <Route path="/docs/:documentId" element={<Suspense fallback={docsFallback}><DocsEditor user={user} /></Suspense>} />
            <Route path="/communities" element={<Communities />} />
            <Route
              path="/communities/:id"
              element={<CommunityDetail user={user} />}
            />

            <Route path="/articles" element={<Articles />} />
            <Route path="/articles/:id" element={<PaperDetail user={user} onLogout={logout} />} />
            <Route path="/saved" element={<SavedPapers />} />
            <Route path="/events" element={<Events user={user} />} />
            <Route
              path="/events/:id"
              element={<EventDetail user={user} />}
            />

            <Route path="/messages" element={<Messages user={user} />} />
            <Route path="/notifications" element={<Notifications user={user} />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/submit" element={<Submit user={user} onUserUpdate={setUser} />} />
            <Route path="/moderation" element={<Navigate to="/moderator" replace />} />
            <Route path="/moderator" element={['admin', 'moderator'].includes(user.role) ? <ModeratorDashboard /> : <AccessDenied title="Moderator dashboard" text="This area is only for moderators and the Super Admin." />} />
            <Route path="/citation-network" element={<CitationNetwork />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/my-submissions" element={<MySubmissions />} />
            <Route path="/my-submissions/:id" element={<SubmissionFeedback user={user} />} />
            <Route path="/reviews" element={<ReviewQueue />} />
            <Route path="/reviews/:id" element={<ReviewWorkspace user={user} />} />

            {/* Citation Network */}
            <Route
              path="/citation-network"
              element={<CitationNetwork />}
            />

            <Route
              path="/settings"
              element={<Settings user={user} onUserUpdate={setUser} onAccountDeleted={accountDeleted} />}
            />

            <Route path="/help" element={<Help />} />
            <Route path="/search" element={<Search user={user} onLogout={logout} />} />
            <Route path="/users/:id" element={<UserProfile user={user} onLogout={logout} />} />
          </Route>
        ) : (
          <Route
            path="/"
            element={
              <Suspense fallback={null}>
                <Landing />
              </Suspense>
            }
          />
        )}

        <Route
          path="*"
          element={user ? <Navigate to="/" replace /> : <RedirectToLogin />}
        />
      </Routes>
    </BrowserRouter>
  )
}
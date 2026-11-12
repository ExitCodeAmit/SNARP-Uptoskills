import { useState, useEffect, lazy, Suspense } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom'

import { api, getToken, saveToken, clearToken } from './api'
import Auth from './Auth'
import Layout from './Layout'
import Feed from './Feed'

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
  Moderation,
  MySubmissions,
  Settings,
  Help,
  Search,
  UserProfile,
  PaperDetail,
} from './pages'

// Load the landing page only when required
const Landing = lazy(() => import('./Landing'))

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(() => !!getToken())

  // Restore the user session from the saved token
  useEffect(() => {
    if (!getToken()) return

    api('/auth/me')
      .then(setUser)
      .catch((err) => {
        if (err.status === 401) {
          clearToken()
        }
      })
      .finally(() => {
        setChecking(false)
      })
  }, [])

  // Handle successful authentication
  const onAuth = ({ token, user }, remember = true) => {
    saveToken(token, remember)
    setUser(user)
  }

  // Log out the current user
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // Clear the browser session even if the API cannot be reached.
    }
    clearToken()
    setUser(null)
  }

  // Wait until session restoration is complete
  if (checking) {
    return null
  }

  // Redirect authenticated users away from login/signup
  const guest = (mode) =>
    user ? (
      <Navigate to="/" replace />
    ) : (
      <Auth key={mode} mode={mode} onAuth={onAuth} />
    )

  return (
    <BrowserRouter>
      <Routes>
        {/* Authentication routes */}
        <Route path="/login" element={guest('login')} />
        <Route path="/signup" element={guest('signup')} />

        {/* Authenticated application routes */}
        {user ? (
          <Route element={<Layout user={user} onLogout={logout} />}>
            <Route
              path="/"
              element={<Feed user={user} onLogout={logout} />}
            />

            <Route path="/communities" element={<Communities />} />
            <Route path="/communities/:id" element={<CommunityDetail user={user} />} />
            <Route path="/articles" element={<Articles />} />
            <Route path="/articles/:id" element={<PaperDetail />} />
            <Route path="/events" element={<Events user={user} />} />
            <Route path="/events/:id" element={<EventDetail user={user} />} />
            <Route path="/messages" element={<Messages user={user} />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/submit" element={<Submit user={user} />} />
            <Route path="/moderation" element={<Moderation user={user} />} />
            <Route path="/my-submissions" element={<MySubmissions />} />

            <Route
              path="/settings"
              element={<Settings user={user} onUserUpdate={setUser} />}
            />

            <Route path="/help" element={<Help />} />
            <Route path="/search" element={<Search />} />
            <Route path="/users/:id" element={<UserProfile />} />
          </Route>
        ) : (
          // Landing page for logged-out visitors
          <Route
            path="/"
            element={
              <Suspense fallback={null}>
                <Landing />
              </Suspense>
            }
          />
        )}

        {/* Handle unknown routes */}
        <Route
          path="*"
          element={
            <Navigate
              to={user ? '/' : '/login'}
              replace
            />
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

const ADMIN_KEY = 'snarp-desk-token'

export const isAdminArea = () => window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')

export const getAdminToken = () => sessionStorage.getItem(ADMIN_KEY)
export const saveAdminToken = (token) => sessionStorage.setItem(ADMIN_KEY, token)
export const clearAdminToken = () => sessionStorage.removeItem(ADMIN_KEY)

export const getToken = () => (isAdminArea()
  ? getAdminToken()
  : localStorage.getItem('token') || sessionStorage.getItem('token'))

export function saveToken(token, remember) {
  ;(remember ? localStorage : sessionStorage).setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
  sessionStorage.removeItem('token')
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken()
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...headers,
      ...(!isForm && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: isForm ? body : body && JSON.stringify(body),
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || 'Could not reach the server. Is the backend running?')
    err.status = res.status
    err.field = data?.field
    err.code = data?.code
    err.data = data
    err.userMessageId = data?.userMessageId
    if (isAdminArea() && (res.status === 401 || data?.code === 'account_blocked') && token) {
      window.dispatchEvent(new Event('snarp:desk-signed-out'))
    } else if (data?.code === 'account_blocked') {
      window.dispatchEvent(new Event('snarp:account-blocked'))
    }
    throw err
  }
  return data
}

export async function apiBlob(path) {
  const token = getToken()
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const err = new Error(data?.error || 'Could not open this PDF')
    err.status = res.status
    throw err
  }
  return res.blob()
}

// Each browser tab keeps its own login token
export const getToken = () => sessionStorage.getItem('token')

export function saveToken(token, remember) {
  // Store the token in this tab only
  sessionStorage.setItem('token', token)

  // Remove any old shared token from localStorage
  localStorage.removeItem('token')
}

export function clearToken() {
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
    const err = new Error(
      data?.error || 'Could not reach the server. Is the backend running?'
    )
    err.status = res.status
    err.field = data?.field
    throw err
  }

  return data
}

export async function apiBlob(path) {
  const token = getToken()

  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const err = new Error(data?.error || 'Could not open this PDF')
    err.status = res.status
    throw err
  }

  return res.blob()
}
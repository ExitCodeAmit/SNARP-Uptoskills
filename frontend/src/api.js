// "Remember me" keeps the token in localStorage; otherwise it lives for the browser session only
export const getToken = () => localStorage.getItem('token') || sessionStorage.getItem('token')

export function saveToken(token, remember) {;
    (remember ? localStorage : sessionStorage).setItem('token', token)
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
        const err = new Error((data && data.error) || 'Could not reach the server. Is the backend running?')
        err.status = res.status
        err.field = data && data.field
        err.userMessageId = data && data.userMessageId
        throw err
    }
    return data
}

export async function apiBlob(path) {
    const token = getToken()
    const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) {
        const data = await res.json().catch(() => null)
        const err = new Error((data && data.error) || 'Could not open this PDF')
        err.status = res.status
        throw err
    }
    return res.blob()
}
import { useEffect, useSyncExternalStore } from 'react'

const KEY = 'snarp-theme'
const EVENT = 'snarp:theme-changed'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readPreference() {
  try {
    const value = localStorage.getItem(KEY)
    return ['light', 'dark'].includes(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

export function setThemePreference(preference) {
  try { localStorage.setItem(KEY, preference) } catch {}
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange) {
  const query = media()
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  query.addEventListener('change', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
    query.removeEventListener('change', onChange)
  }
}

const snapshot = () => {
  const preference = readPreference()
  const resolved = preference === 'system' ? (media().matches ? 'dark' : 'light') : preference
  return `${preference}:${resolved}`
}

export function useTheme() {
  const [preference, resolved] = useSyncExternalStore(subscribe, snapshot).split(':')
  return { preference, resolved, setPreference: setThemePreference }
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = snapshot().split(':')[1]
}

export function clearTheme() {
  delete document.documentElement.dataset.theme
}

export function useApplyTheme() {
  const { resolved } = useTheme()
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])
  useEffect(() => clearTheme, [])
  return resolved
}

export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator', author: 'Author', user: 'Member' }

/**
 * Derives a clean, public display name.
 * Priority:
 * 1. full_name (if provided and not an email)
 * 2. username (if provided and not an email)
 * 3. name / author_name (if not an email)
 * 4. username portion before '@' if name/email contains '@'
 * Never returns an email address or email domain.
 */
export function formatDisplayName(userOrName) {
  if (!userOrName) return 'Anonymous'
  let name = ''
  let username = ''

  if (typeof userOrName === 'string') {
    name = userOrName.trim()
  } else if (typeof userOrName === 'object') {
    name = (userOrName.full_name || userOrName.name || userOrName.author_name || '').trim()
    username = (userOrName.username || '').trim()
  }

  // If name contains '@', it is an email address: never use as display name!
  if (name.includes('@')) {
    username = username || name.split('@')[0].trim()
    name = ''
  }

  if (name) return name
  if (username) return username

  // Fallback if object has email property
  if (typeof userOrName === 'object' && userOrName.email) {
    const fromEmail = String(userOrName.email).split('@')[0].trim()
    if (fromEmail) return fromEmail
  }

  return 'Anonymous'
}

/**
 * Derives a clean username handle without '@' domain.
 */
export function formatUserName(userOrName) {
  if (!userOrName) return 'user'
  if (typeof userOrName === 'object') {
    if (userOrName.username && !userOrName.username.includes('@')) return userOrName.username.trim()
    if (userOrName.email) return String(userOrName.email).split('@')[0].trim()
    if (userOrName.name) return String(userOrName.name).split('@')[0].trim()
  }
  if (typeof userOrName === 'string') {
    return userOrName.split('@')[0].trim()
  }
  return 'user'
}

export const initials = (name) => {
  const clean = formatDisplayName(name)
  return clean.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'U'
}

// Stable brand colour per name, so each person keeps the same avatar colour
const COLORS = ['orange', 'teal', 'blue', 'yellow']
export const colorFor = (name) => {
  const clean = formatDisplayName(name)
  return COLORS[[...clean].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length]
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function timeAgo(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return 'just now'
}

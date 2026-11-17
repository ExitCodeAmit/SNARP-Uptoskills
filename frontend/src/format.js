export const ROLE_LABEL = { admin: 'Author', moderator: 'Moderator', author: 'Author', user: 'Member' }

export const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

const COLORS = ['orange', 'teal', 'blue', 'yellow']
export const colorFor = (name) => COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length]

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function timeAgo(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return 'just now'
}

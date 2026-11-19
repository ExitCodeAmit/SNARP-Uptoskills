const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1',
  'password123', 'passw0rd', 'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345', 'abcd1234',
  'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator', 'sunshine1', 'football1', 'baseball1',
  'princess1', 'monkey123', 'dragon123', 'trustno1', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'changeme',
  'snarp123', 'uptoskills', 'research1', 'student1', 'student123', 'india123',
])

const byteLength = (value) => new TextEncoder().encode(value).length

function isPersonal(value, { email = '', name = '' }) {
  const lower = value.toLowerCase()
  const local = email.trim().toLowerCase().split('@')[0]
  const compactName = name.toLowerCase().replace(/\s+/g, '')
  return (local.length >= 4 && lower.includes(local)) ||
    (compactName.length >= 4 && lower.replace(/\s+/g, '').includes(compactName))
}

export function passwordChecks(value, context = {}) {
  return [
    { label: 'At least 8 characters', ok: value.length >= 8 && byteLength(value) <= 72 },
    { label: 'Letters plus a number or symbol', ok: /\p{L}/u.test(value) && /[^\p{L}]/u.test(value) },
    { label: 'Not a common password or your name or email', ok: value.length > 0 && !COMMON.has(value.toLowerCase()) && !isPersonal(value, context) },
  ]
}

export function passwordProblem(value, context = {}) {
  if (value.length < 8) return 'Password must be at least 8 characters'
  if (byteLength(value) > 72) return 'Password must be 72 bytes or fewer'
  if (!/\p{L}/u.test(value) || !/[^\p{L}]/u.test(value)) return 'Use a mix of letters and numbers or symbols'
  if (COMMON.has(value.toLowerCase())) return 'This password is too common. Choose something harder to guess'
  if (isPersonal(value, context)) return 'Password cannot contain your name or email'
  return null
}

export function passwordStrength(value, context = {}) {
  if (!value) return { score: 0, label: '' }
  if (passwordProblem(value, context)) return { score: 1, label: 'Too weak' }
  let points = 0
  if (value.length >= 12) points += 1
  if (value.length >= 16) points += 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1
  if (/\d/.test(value)) points += 1
  if (/[^\p{L}\d]/u.test(value)) points += 1
  if (new Set(value).size >= 8) points += 1
  if (points >= 4) return { score: 4, label: 'Strong' }
  if (points >= 2) return { score: 3, label: 'Good' }
  return { score: 2, label: 'Fair' }
}

export function safeNext(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/^\/(login|signup)\b/.test(value) ? value : '/'
}

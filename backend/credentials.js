const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1',
  'password123', 'passw0rd', 'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345', 'abcd1234',
  'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator', 'sunshine1', 'football1', 'baseball1',
  'princess1', 'monkey123', 'dragon123', 'trustno1', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'changeme',
  'snarp123', 'uptoskills', 'research1', 'student1', 'student123', 'india123',
])

const encoder = new TextEncoder()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CONTROL_CHARS = /\p{Cc}/u

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

export function nameProblem(value) {
  const name = String(value ?? '').trim()
  if (name.length < 2) return 'Enter your full name'
  if (name.length > 100) return 'Name must be 100 characters or fewer'
  if (CONTROL_CHARS.test(name)) return 'Name contains characters that are not allowed'
  if (!/\p{L}/u.test(name)) return 'Name must contain letters'
  return null
}

export function emailProblem(value) {
  const email = normalizeEmail(value)
  if (!EMAIL_PATTERN.test(email) || email.length > 255) return 'Enter a valid email address'
  return null
}

export function passwordProblem(password, { email = '', name = '' } = {}) {
  const value = String(password ?? '')
  if (value.length < 8) return 'Password must be at least 8 characters'
  if (encoder.encode(value).length > 72) return 'Password must be 72 bytes or fewer'
  if (!/\p{L}/u.test(value) || !/[^\p{L}]/u.test(value)) return 'Use a mix of letters and numbers or symbols'
  if (/^(.)\1+$/u.test(value)) return 'Password cannot be one repeated character'
  const lower = value.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'This password is too common. Choose something harder to guess'
  const localPart = normalizeEmail(email).split('@')[0]
  if (localPart.length >= 4 && lower.includes(localPart)) return 'Password cannot contain your email address'
  const compactName = String(name).toLowerCase().replace(/\s+/g, '')
  if (compactName.length >= 4 && lower.replace(/\s+/g, '').includes(compactName)) return 'Password cannot contain your name'
  return null
}

export function describeDevice(userAgent) {
  const ua = String(userAgent ?? '')
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : /node|curl|undici/i.test(ua) ? 'Script'
              : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

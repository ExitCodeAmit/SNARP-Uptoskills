import { CheckCircle, Circle } from '@phosphor-icons/react'
import { passwordChecks, passwordStrength } from '../password'

export default function PasswordMeter({ password, context }) {
  if (!password) return null
  const { score, label } = passwordStrength(password, context)
  return (
    <div className="pw-meter" aria-live="polite">
      <div className={`pw-bars s${score}`} aria-hidden="true"><i /><i /><i /><i /></div>
      <span className={`pw-label s${score}`}>{label}</span>
      <ul className="pw-checks">
        {passwordChecks(password, context).map((check) => (
          <li key={check.label} className={check.ok ? 'ok' : ''}>
            {check.ok ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

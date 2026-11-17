import { useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { Overlay } from './Overlay'

// "Are you sure?" dialog for destructive actions. onConfirm may be async; errors are shown inline.
export default function ConfirmDialog({ title, message, confirmText = 'Delete', onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message || 'That did not work. Please try again.')
      setBusy(false)
    }
  }
  return (
    <Overlay className="confirm-dialog" labelledBy="confirm-dialog-title" onClose={() => { if (!busy) onCancel() }}>
      <span className="confirm-dialog-icon" aria-hidden="true"><WarningCircle size={26} weight="fill" /></span>
      <h2 id="confirm-dialog-title">{title}</h2>
      <p>{message}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>{busy ? 'Working…' : confirmText}</button>
      </div>
    </Overlay>
  )
}

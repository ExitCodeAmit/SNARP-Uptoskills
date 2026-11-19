import { useEffect, useState } from 'react'
import { DownloadSimple, Eye, FilePdf } from '@phosphor-icons/react'
import { apiBlob } from '../api'
import { PdfReader } from './Overlay'

const fileSize = (bytes) => {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
}

export default function PdfAttachment({ paperId, filename, size, title }) {
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const name = filename || 'paper.pdf'
  const load = async () => {
    if (url) return url
    const next = URL.createObjectURL(await apiBlob(`/papers/${paperId}/pdf`))
    setUrl(next)
    return next
  }
  const run = async (kind, action) => {
    setBusy(kind)
    setError('')
    try { await action(await load()) }
    catch (err) { setError(err.message) }
    finally { setBusy('') }
  }
  const view = () => run('view', () => setOpen(true))
  const download = () => run('download', (href) => {
    const link = document.createElement('a')
    link.href = href
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
  })

  return (
    <div className="pdf-attach">
      <div className="pdf-attach-row">
        <span className="pdf-attach-icon" aria-hidden="true"><FilePdf size={22} weight="duotone" /></span>
        <span className="pdf-attach-info">
          <strong title={name}>{name}</strong>
          <small>PDF{fileSize(size) && ` · ${fileSize(size)}`} · Full paper</small>
        </span>
        <span className="pdf-attach-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={view} disabled={busy === 'view'} aria-haspopup="dialog">
            <Eye size={15} /> {busy === 'view' ? 'Opening…' : 'Read PDF'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={busy === 'download'} aria-label={`Download ${name}`} title="Download">
            <DownloadSimple size={15} /> <span className="pdf-attach-label">Download</span>
          </button>
        </span>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {open && url && <PdfReader url={url} title={title} filename={name} onClose={() => setOpen(false)} />}
    </div>
  )
}

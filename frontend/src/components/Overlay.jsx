import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowSquareOut, DownloadSimple, FilePdf, X } from '@phosphor-icons/react'

let openCount = 0

// A modal layer rendered inside the app shell so it keeps the theme. Closes on Escape or a click on the backdrop,
// locks page scrolling while open and gives focus back to whatever opened it.
export function Overlay({ className = '', label, labelledBy, onClose, children }) {
  const panelRef = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    openCount += 1
    document.documentElement.classList.add('overlay-open')
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current() } }
    document.addEventListener('keydown', key)
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', key)
      openCount -= 1
      if (openCount === 0) document.documentElement.classList.remove('overlay-open')
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className={`overlay ${className}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panelRef} className="overlay-panel" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.querySelector('.shell') ?? document.body,
  )
}

export function PdfReader({ url, title, filename = 'paper.pdf', onClose }) {
  return (
    <Overlay className="pdf-reader" label={`PDF: ${title ?? filename}`} onClose={onClose}>
      <header className="pdf-reader-head">
        <span className="pdf-reader-icon" aria-hidden="true"><FilePdf size={20} weight="duotone" /></span>
        <span className="pdf-reader-title">
          <strong title={title ?? filename}>{title ?? filename}</strong>
          {title && <small>{filename}</small>}
        </span>
        <a className="icon-btn" href={url} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab"><ArrowSquareOut size={18} /></a>
        <a className="icon-btn" href={url} download={filename} title="Download" aria-label={`Download ${filename}`}><DownloadSimple size={18} /></a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close PDF" title="Close"><X size={18} /></button>
      </header>
      <iframe className="pdf-reader-frame" title={`PDF: ${title ?? filename}`} src={url} />
    </Overlay>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DotsThree } from '@phosphor-icons/react'

// The ··· menu at the top right of a feed card. Items: { label, icon, to } for links or { label, icon, onClick }.
export default function CardMenu({ items, label = 'More options' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
    const key = (event) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      ref.current?.querySelector('.card-menu-btn')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])

  return (
    <div className="card-menu" ref={ref}>
      <button type="button" className="icon-btn card-menu-btn" onClick={() => setOpen(!open)} aria-label={label} aria-haspopup="menu" aria-expanded={open} title={label}>
        <DotsThree size={22} weight="bold" />
      </button>
      {open && (
        <div className="card-menu-list" role="menu">
          {items.map(({ label: text, icon: Icon, to, onClick, danger }) => (to ? (
            <Link key={text} to={to} role="menuitem" className={danger ? 'danger' : ''} onClick={() => setOpen(false)}>
              {Icon && <Icon size={17} />} {text}
            </Link>
          ) : (
            <button key={text} type="button" role="menuitem" className={danger ? 'danger' : ''} onClick={() => { setOpen(false); onClick() }}>
              {Icon && <Icon size={17} />} {text}
            </button>
          )))}
        </div>
      )}
    </div>
  )
}

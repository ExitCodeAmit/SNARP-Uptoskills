import { initials, colorFor } from '../format'

export function Avatar({ name, size = '', src }) {
  const className = `avatar avatar-${colorFor(name)} ${size && `avatar-${size}`}`
  return src
    ? <img className={`${className} avatar-photo`} src={src} alt={`${name}'s profile photo`} />
    : <div className={className}>{initials(name)}</div>
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

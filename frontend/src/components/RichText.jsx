import { useState } from 'react'

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g
const TRAILING_PUNCTUATION = /[.,!?;:)\]'"]+$/

export function Linkify({ text }) {
  return String(text ?? '').split(URL_PATTERN).map((part, index) => {
    if (index % 2 === 0) return part
    const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const url = trailing ? part.slice(0, -trailing.length) : part
    return <span key={index}><a href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>{trailing}</span>
  })
}

export function ExpandableText({ text, className = '', lines = 6, as: Tag = 'p' }) {
  const [expanded, setExpanded] = useState(false)
  const value = String(text ?? '')
  const long = value.length > lines * 90 || value.split('\n').length > lines
  return (
    <>
      <Tag className={`${className} ${long && !expanded ? 'clamped' : ''}`} style={long && !expanded ? { WebkitLineClamp: lines } : undefined}>
        <Linkify text={value} />
      </Tag>
      {long && (
        <button type="button" className="show-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

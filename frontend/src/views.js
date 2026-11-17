import { useEffect } from 'react'
import { api } from './api'

// Counts a view when a post or paper card has been at least half on screen for one second.
// Each item is sent once per page load; the server counts each person once and never the author.
const sent = new Set()
let queue = []
let timer = 0

function flush() {
  timer = 0
  if (!queue.length) return
  const items = queue.splice(0, 50)
  api('/views', { method: 'POST', body: { items } }).catch(() => items.forEach((item) => sent.delete(`${item.type}-${item.id}`)))
  if (queue.length) timer = setTimeout(flush, 500)
}

export function recordView(type, id) {
  const key = `${type}-${id}`
  if (sent.has(key)) return
  sent.add(key)
  queue.push({ type, id: String(id) })
  if (!timer) timer = setTimeout(flush, 1500)
}

// Watches the cards inside `listRef` (elements with id "post-<id>" or "paper-<id>").
export function useViewTracker(listRef, items) {
  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const pending = new Map()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const match = /^(post|paper)-(\d+)$/.exec(entry.target.id)
        if (!match) continue
        if (entry.isIntersecting) {
          if (!pending.has(entry.target)) pending.set(entry.target, setTimeout(() => recordView(match[1], match[2]), 1000))
        } else {
          clearTimeout(pending.get(entry.target))
          pending.delete(entry.target)
        }
      }
    }, { threshold: 0.5 })
    list.querySelectorAll(':scope > li[id]').forEach((card) => observer.observe(card))
    return () => {
      observer.disconnect()
      pending.forEach((id) => clearTimeout(id))
    }
  }, [listRef, items])
}

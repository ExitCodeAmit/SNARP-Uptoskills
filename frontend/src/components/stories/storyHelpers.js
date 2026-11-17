import { useState, useEffect } from 'react'
import { apiBlob } from '../../api.js'

/**
 * Seven approved background styles matching backend validation and database constraints.
 */
export const BACKGROUND_STYLES = [
  'gradient-sunset',
  'gradient-ocean',
  'gradient-emerald',
  'gradient-royal',
  'gradient-amber',
  'solid-dark',
  'solid-slate',
]

/**
 * Preset metadata for background styles with human-readable labels and CSS classes.
 */
export const STORY_BACKGROUND_PRESETS = [
  { id: 'gradient-sunset', label: 'Sunset', className: 'story-bg-gradient-sunset' },
  { id: 'gradient-ocean', label: 'Ocean', className: 'story-bg-gradient-ocean' },
  { id: 'gradient-emerald', label: 'Emerald', className: 'story-bg-gradient-emerald' },
  { id: 'gradient-royal', label: 'Royal', className: 'story-bg-gradient-royal' },
  { id: 'gradient-amber', label: 'Amber', className: 'story-bg-gradient-amber' },
  { id: 'solid-dark', label: 'Dark', className: 'story-bg-solid-dark' },
  { id: 'solid-slate', label: 'Slate', className: 'story-bg-solid-slate' },
]

/** Maximum media file size allowed by the backend (15 MB) */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024

/** Maximum video duration allowed by the backend (30.0 seconds) */
export const MAX_VIDEO_DURATION_SECONDS = 30.0

/**
 * The 5 approved story reaction types with their emoji and label.
 */
export const STORY_REACTIONS = [
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'haha', emoji: '😂', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'like', emoji: '👍', label: 'Like' },
]

/**
 * Reusable React hook to fetch authenticated story media using apiBlob()
 * and manage temporary Blob URLs with safe lifecycle cleanup.
 *
 * Requirements satisfied:
 * - Strips leading '/api' before passing path to apiBlob().
 * - Only creates a Blob URL upon successful fetch.
 * - Safely revokes created Blob URLs during effect cleanup.
 * - Does not call state setters during unmount cleanup.
 * - Handles loading and error states.
 * - Guards against stale asynchronous requests using an active cancellation flag.
 *
 * @param {string|null} mediaUrl - The relative media URL (e.g. '/api/stories/media/<uuid>')
 * @returns {{ objectUrl: string|null, url: string|null, loading: boolean, error: Error|null }}
 */
export function useStoryMedia(mediaUrl) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!mediaUrl) {
      setObjectUrl(null)
      setLoading(false)
      setError(null)
      return
    }

    let active = true
    let createdUrl = null

    // Immediately clear previous objectUrl so the previously displayed Blob URL is not retained
    setObjectUrl(null)
    setLoading(true)
    setError(null)

    // Strip leading '/api' because apiBlob() automatically prepends '/api'
    const path = mediaUrl.replace(/^\/api/, '')

    apiBlob(path)
      .then((blob) => {
        if (!active) return
        createdUrl = URL.createObjectURL(blob)
        setObjectUrl(createdUrl)
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setError(err)
        setLoading(false)
      })

    return () => {
      active = false
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
        createdUrl = null
      }
      // Note: State setters are intentionally omitted here to prevent unmount updates
    }
  }, [mediaUrl])

  return { objectUrl, url: objectUrl, loading, error }
}

/**
 * Safely determines if an entity (story, peer user, or tray payload) represents Close Friends audience.
 * Defaults missing, null, or legacy values to 'everyone' (false).
 */
export function isCloseFriendsAudience(item) {
  if (!item) return false
  if (typeof item === 'string') return item.trim().toLowerCase() === 'close_friends'
  if (item.audience) return String(item.audience).trim().toLowerCase() === 'close_friends'
  if (item.has_close_friends || item.has_cf) return true
  if (Array.isArray(item.stories)) return item.stories.some((s) => isCloseFriendsAudience(s))
  return false
}

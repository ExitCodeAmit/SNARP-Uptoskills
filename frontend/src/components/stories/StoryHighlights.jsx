import { useState, useEffect, useCallback } from 'react'
import { Plus, Sparkle, X, Trash, Check, GearSix, Image as ImageIcon, TextAa } from '@phosphor-icons/react'
import { api } from '../../api'
import StoryViewerModal from './StoryViewerModal'
import './stories.css'

/**
 * StoryHighlights Component
 *
 * Displays Instagram-style story highlight circles on user profiles.
 * Supports:
 * - Public viewing of highlights and their stories via StoryViewerModal
 * - Owner-only highlight creation with title validation, candidate story picker, and cover selection
 * - Owner-only highlight management: rename, reorder, add/remove stories, change cover, delete
 * - Responsive layout, accessibility labels, and loading/error states
 */
export default function StoryHighlights({
  profileUserId: propProfileUserId,
  isOwner: propIsOwner,
  currentUser: propCurrentUser,
  user,
}) {
  const [currentUser, setCurrentUser] = useState(propCurrentUser || null)

  useEffect(() => {
    if (propCurrentUser) {
      setCurrentUser(propCurrentUser)
    } else {
      api('/auth/me').then(setCurrentUser).catch(() => {})
    }
  }, [propCurrentUser])

  const effectiveProfileUserId = propProfileUserId || user?.id || user?.user_id
  const currentUserId = currentUser?.id ?? currentUser?.user_id
  const isOwner = Boolean(
    propIsOwner ||
    (currentUserId && effectiveProfileUserId && String(currentUserId) === String(effectiveProfileUserId))
  )

  const [highlights, setHighlights] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Viewer state
  const [activeHighlight, setActiveHighlight] = useState(null)
  const [highlightStories, setHighlightStories] = useState([])
  const [loadingStories, setLoadingStories] = useState(false)
  const [storiesError, setStoriesError] = useState(null)

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingHighlight, setEditingHighlight] = useState(null)

  // Fetch highlights for profile user
  const fetchHighlights = useCallback(async () => {
    if (!effectiveProfileUserId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api(`/stories/highlights/user/${effectiveProfileUserId}`).catch(() =>
        api(`/stories/highlights/${effectiveProfileUserId}`)
      )
      setHighlights(Array.isArray(res?.highlights) ? res.highlights : [])
    } catch (err) {
      console.warn('Could not load highlights:', err?.message)
      setHighlights([])
    } finally {
      setLoading(false)
    }
  }, [effectiveProfileUserId])

  useEffect(() => {
    setActiveHighlight(null)
    setHighlightStories([])
    setStoriesError(null)
    fetchHighlights()
  }, [fetchHighlights])

  // Open a highlight in the viewer
  const handleOpenHighlight = async (highlight) => {
    setActiveHighlight(highlight)
    setLoadingStories(true)
    setStoriesError(null)

    try {
      const res = await api(`/stories/highlights/${highlight.id}`)
      if (res?.stories && res.stories.length > 0) {
        setHighlightStories(res.stories)
      } else {
        setStoriesError('This highlight has no stories.')
      }
    } catch (err) {
      setStoriesError(err?.message || 'Could not load highlight stories')
    } finally {
      setLoadingStories(false)
    }
  }

  const handleCloseViewer = () => {
    setActiveHighlight(null)
    setHighlightStories([])
    setStoriesError(null)
  }

  // If viewing someone else's profile and there are no highlights, don't show an empty bar
  if (!isOwner && highlights.length === 0) {
    return null
  }

  return (
    <section className="story-highlights-section" aria-label="Story Highlights">
      <div className="story-highlights-tray" role="list">
        {/* Owner: Add New Highlight button */}
        {isOwner && (
          <div className="story-highlight-item" role="listitem">
            <button
              type="button"
              className="story-highlight-circle story-highlight-new-circle"
              onClick={() => setShowCreateModal(true)}
              aria-label="Create new highlight"
              title="Create new highlight"
            >
              <div className="story-highlight-inner">
                <Plus size={24} weight="bold" />
              </div>
            </button>
            <span className="story-highlight-title">New</span>
          </div>
        )}

        {/* Existing Highlight Circles */}
        {highlights.map((h, idx) => {
          const hasMediaCover = Boolean(h.cover_media_url)
          const textBgStyle = h.cover_background_style || 'gradient-sunset'

          return (
            <div
              key={h.id}
              className="story-highlight-item"
              role="listitem"
              style={{ animationDelay: `${(idx + (isOwner ? 1 : 0)) * 45}ms` }}
            >
              <button
                type="button"
                className="story-highlight-circle"
                onClick={() => handleOpenHighlight(h)}
                aria-label={`View highlight: ${h.title}`}
                title={h.title}
              >
                <div className="story-highlight-inner">
                  {hasMediaCover ? (
                    <img
                      src={h.cover_media_url}
                      alt=""
                      className="story-highlight-cover-img"
                      loading="lazy"
                    />
                  ) : h.cover_type === 'text' ? (
                    <div className={`story-highlight-text-cover story-bg-${textBgStyle}`}>
                      <TextAa size={20} weight="bold" />
                    </div>
                  ) : (
                    <div className="story-highlight-fallback-cover">
                      <Sparkle size={24} weight="fill" />
                    </div>
                  )}
                </div>
              </button>

              <div className="story-highlight-label-wrap">
                <span className="story-highlight-title" title={h.title}>
                  {h.title}
                </span>
                {isOwner && (
                  <button
                    type="button"
                    className="story-highlight-gear-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingHighlight(h)
                    }}
                    aria-label={`Manage ${h.title}`}
                    title="Manage highlight"
                  >
                    <GearSix size={14} weight="fill" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Highlight Stories Viewer */}
      {activeHighlight && (
        <>
          {loadingStories ? (
            <div className="story-highlight-loading-overlay" aria-live="polite">
              <div className="story-spinner" />
              <span>Loading highlight…</span>
            </div>
          ) : storiesError ? (
            <div className="story-highlight-error-dialog" role="alert">
              <p>{storiesError}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCloseViewer}>
                Close
              </button>
            </div>
          ) : highlightStories.length > 0 ? (
            <StoryViewerModal
              currentUser={currentUser}
              user={user}
              stories={highlightStories}
              highlightTitle={activeHighlight.title}
              onClose={handleCloseViewer}
            />
          ) : null}
        </>
      )}

      {/* Create Highlight Modal */}
      {showCreateModal && (
        <CreateHighlightModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newHl) => {
            setShowCreateModal(false)
            fetchHighlights()
          }}
        />
      )}

      {/* Manage Highlight Modal */}
      {editingHighlight && (
        <ManageHighlightModal
          highlight={editingHighlight}
          onClose={() => setEditingHighlight(null)}
          onUpdated={() => {
            setEditingHighlight(null)
            fetchHighlights()
          }}
          onDeleted={() => {
            setEditingHighlight(null)
            fetchHighlights()
          }}
        />
      )}
    </section>
  )
}

/**
 * CreateHighlightModal
 * Modal to title a new highlight, pick stories from eligible candidate pool, and set cover.
 */
function CreateHighlightModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [candidateStories, setCandidateStories] = useState([])
  const [selectedStoryIds, setSelectedStoryIds] = useState(new Set())
  const [coverStoryId, setCoverStoryId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    api('/stories/highlights/my-stories')
      .then((res) => {
        if (active) {
          const list = Array.isArray(res?.stories) ? res.stories : []
          setCandidateStories(list)
          if (list.length > 0) {
            // Auto-select first story by default
            setSelectedStoryIds(new Set([list[0].id]))
            setCoverStoryId(list[0].id)
          }
        }
      })
      .catch((err) => {
        if (active) setError(err?.message || 'Could not load your stories')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [])

  const toggleStorySelection = (storyId) => {
    setSelectedStoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(storyId)) {
        next.delete(storyId)
        if (coverStoryId === storyId) {
          // Fall back to next available or null
          const nextFirst = Array.from(next)[0] || null
          setCoverStoryId(nextFirst)
        }
      } else {
        next.add(storyId)
        if (!coverStoryId) setCoverStoryId(storyId)
      }
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Please enter a highlight title')
      return
    }
    if (trimmed.length > 60) {
      setError('Highlight title cannot exceed 60 characters')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await api('/stories/highlights', {
        method: 'POST',
        body: {
          title: trimmed,
          storyIds: Array.from(selectedStoryIds),
          coverStoryId,
        },
      })
      onCreated?.(res?.highlight)
    } catch (err) {
      setError(err?.message || 'Failed to create highlight')
      setSubmitting(false)
    }
  }

  return (
    <div className="story-hl-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Create Highlight">
      <div className="story-hl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="story-hl-modal-header">
          <h3>Create Highlight</h3>
          <button type="button" className="story-hl-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="story-hl-form">
          {error && <div className="story-hl-error" role="alert">{error}</div>}

          <div className="story-hl-field">
            <label htmlFor="hl-title-input">Highlight Title</label>
            <input
              id="hl-title-input"
              type="text"
              className="story-hl-input"
              placeholder="e.g. Vacation, Coding, Art"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
            <span className="story-hl-counter">{title.length}/60</span>
          </div>

          <div className="story-hl-stories-picker">
            <label>Select Stories</label>
            {loading ? (
              <div className="story-hl-loading-state">
                <div className="story-spinner" />
                <span>Loading your stories…</span>
              </div>
            ) : candidateStories.length === 0 ? (
              <div className="story-hl-empty-state">
                <p>No stories available to add.</p>
                <span>Upload a story first to add it to a highlight.</span>
              </div>
            ) : (
              <div className="story-hl-stories-grid" role="group" aria-label="Select stories">
                {candidateStories.map((story) => {
                  const isSelected = selectedStoryIds.has(story.id)
                  const isCover = coverStoryId === story.id

                  return (
                    <div
                      key={story.id}
                      className={`story-hl-card ${isSelected ? 'story-hl-card-selected' : ''}`}
                      onClick={() => toggleStorySelection(story.id)}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                    >
                      {story.media_url ? (
                        <img src={story.media_url} alt="" className="story-hl-card-img" />
                      ) : (
                        <div className={`story-hl-card-text story-bg-${story.background_style || 'gradient-sunset'}`}>
                          <span>{story.content ? (story.content.slice(0, 40) + '…') : 'Text Story'}</span>
                        </div>
                      )}

                      <div className="story-hl-card-badge">
                        {isSelected && <Check size={14} weight="bold" />}
                      </div>

                      {isSelected && (
                        <button
                          type="button"
                          className={`story-hl-cover-pill ${isCover ? 'story-hl-cover-pill-active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCoverStoryId(story.id)
                          }}
                          title="Set as highlight cover"
                        >
                          {isCover ? 'Cover' : 'Make Cover'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="story-hl-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !title.trim()}
            >
              {submitting ? 'Creating…' : 'Create Highlight'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * ManageHighlightModal
 * Allows owner to rename, add/remove stories, change cover, or delete highlight.
 */
function ManageHighlightModal({ highlight, onClose, onUpdated, onDeleted }) {
  const [title, setTitle] = useState(highlight?.title || '')
  const [highlightStories, setHighlightStories] = useState([])
  const [candidateStories, setCandidateStories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState(null)
  const [coverStoryId, setCoverStoryId] = useState(highlight?.cover_story_id || null)

  // Load current highlight stories and candidate stories
  useEffect(() => {
    let active = true
    Promise.all([
      api(`/stories/highlights/${highlight.id}`),
      api('/stories/highlights/my-stories'),
    ])
      .then(([hlRes, myStoriesRes]) => {
        if (active) {
          const currentStories = Array.isArray(hlRes?.stories) ? hlRes.stories : []
          const myPool = Array.isArray(myStoriesRes?.stories) ? myStoriesRes.stories : []
          setHighlightStories(currentStories)
          setCandidateStories(myPool)
          setCoverStoryId(hlRes?.highlight?.cover_story_id || currentStories[0]?.id || null)
        }
      })
      .catch((err) => {
        if (active) setError(err?.message || 'Could not load highlight details')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [highlight.id])

  // Save title and cover
  const handleSave = async (e) => {
    e?.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Title cannot be empty')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api(`/stories/highlights/${highlight.id}`, {
        method: 'PUT',
        body: { title: trimmed, coverStoryId },
      })
      onUpdated?.()
    } catch (err) {
      setError(err?.message || 'Could not update highlight')
      setSaving(false)
    }
  }

  // Add story to highlight
  const handleAddStory = async (storyId) => {
    setError(null)
    try {
      await api(`/stories/highlights/${highlight.id}/items`, {
        method: 'POST',
        body: { storyId },
      })
      const hlRes = await api(`/stories/highlights/${highlight.id}`)
      setHighlightStories(hlRes?.stories || [])
    } catch (err) {
      setError(err?.message || 'Could not add story')
    }
  }

  // Remove story from highlight
  const handleRemoveStory = async (storyId) => {
    setError(null)
    try {
      await api(`/stories/highlights/${highlight.id}/items/${storyId}`, {
        method: 'DELETE',
      })
      setHighlightStories((prev) => prev.filter((s) => s.id !== storyId))
      if (coverStoryId === storyId) {
        setCoverStoryId(null)
      }
    } catch (err) {
      setError(err?.message || 'Could not remove story')
    }
  }

  // Delete entire highlight
  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api(`/stories/highlights/${highlight.id}`, { method: 'DELETE' })
      onDeleted?.()
    } catch (err) {
      setError(err?.message || 'Could not delete highlight')
      setDeleting(false)
    }
  }

  const currentItemIds = new Set(highlightStories.map((s) => s.id))
  const availableToAdd = candidateStories.filter((s) => !currentItemIds.has(s.id))

  return (
    <div className="story-hl-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Manage Highlight">
      <div className="story-hl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="story-hl-modal-header">
          <h3>Manage Highlight</h3>
          <button type="button" className="story-hl-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && <div className="story-hl-error" role="alert">{error}</div>}

        {loading ? (
          <div className="story-hl-loading-state">
            <div className="story-spinner" />
            <span>Loading highlight…</span>
          </div>
        ) : (
          <div className="story-hl-manage-body">
            {/* Title field */}
            <div className="story-hl-field">
              <label htmlFor="hl-edit-title">Title</label>
              <input
                id="hl-edit-title"
                type="text"
                className="story-hl-input"
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Current stories in highlight */}
            <div className="story-hl-manage-section">
              <h4>Stories in this Highlight ({highlightStories.length})</h4>
              {highlightStories.length === 0 ? (
                <p className="muted-sm">No stories in this highlight.</p>
              ) : (
                <div className="story-hl-manage-list">
                  {highlightStories.map((s) => {
                    const isCover = coverStoryId === s.id
                    return (
                      <div key={s.id} className="story-hl-manage-item">
                        <div className="story-hl-manage-thumb">
                          {s.media_url ? (
                            <img src={s.media_url} alt="" />
                          ) : (
                            <div className={`story-hl-thumb-text story-bg-${s.background_style || 'gradient-sunset'}`}>
                              <TextAa size={16} />
                            </div>
                          )}
                        </div>

                        <div className="story-hl-manage-info">
                          <span className="story-hl-manage-text">
                            {s.type.toUpperCase()} Story
                          </span>
                          {isCover && <span className="story-hl-cover-tag">Cover</span>}
                        </div>

                        <div className="story-hl-manage-actions">
                          {!isCover && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setCoverStoryId(s.id)}
                            >
                              Make Cover
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleRemoveStory(s.id)}
                            title="Remove from highlight"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Add more stories section */}
            {availableToAdd.length > 0 && (
              <div className="story-hl-manage-section">
                <h4>Add More Stories</h4>
                <div className="story-hl-add-grid">
                  {availableToAdd.map((s) => (
                    <div key={s.id} className="story-hl-add-card" onClick={() => handleAddStory(s.id)}>
                      {s.media_url ? (
                        <img src={s.media_url} alt="" />
                      ) : (
                        <div className={`story-hl-add-text story-bg-${s.background_style || 'gradient-sunset'}`}>
                          <span>{s.content ? s.content.slice(0, 30) : 'Text'}</span>
                        </div>
                      )}
                      <div className="story-hl-add-btn" title="Add to highlight">
                        <Plus size={16} weight="bold" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete section */}
            <div className="story-hl-delete-section">
              {showDeleteConfirm ? (
                <div className="story-hl-confirm-box">
                  <p>Delete this highlight? (Stories will remain intact)</p>
                  <div className="story-hl-confirm-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash size={16} /> Delete Highlight
                </button>
              )}
            </div>
          </div>
        )}

        <div className="story-hl-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

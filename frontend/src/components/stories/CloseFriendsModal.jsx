import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Star, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { api } from '../../api'
import { Avatar } from '../ui'
import { formatDisplayName, formatUserName } from '../../format'
import './stories.css'

/**
 * CloseFriendsModal
 *
 * Professional modal interface for managing the authenticated user's Close Friends list.
 * Supports:
 * - Viewing member count and existing Close Friends
 * - Debounced user search by name or username
 * - Adding users to Close Friends with loading states
 * - Removing users from Close Friends with optimistic retention on failure
 * - Preventing adding self or duplicate requests
 * - Accessible keyboard navigation (Escape to close, focus management)
 * - Mobile and desktop responsive layouts
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   currentUser: { id, name, username, ... }
 *   onUpdated: () => void (optional)
 */
export default function CloseFriendsModal({
  isOpen,
  onClose,
  currentUser,
  onUpdated,
}) {
  const [closeFriends, setCloseFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  // Map of userId -> 'adding' | 'removing'
  const [actionInProgress, setActionInProgress] = useState({})
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const searchInputRef = useRef(null)
  const panelRef = useRef(null)

  const myId = currentUser?.id ?? currentUser?.user_id

  // ── 1. Fetch Close Friends List ───────────────────────────────────────────
  const fetchCloseFriends = useCallback(() => {
    let active = true
    setLoading(true)
    setLoadError('')

    api('/stories/close-friends')
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.closeFriends) ? data.closeFriends : []
        setCloseFriends(list)
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setLoadError(err?.message || 'Could not load Close Friends list')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // ── 2. Modal open/close lifecycle & Escape key ─────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    // The modal mounts fresh each time it opens, so its state starts empty; load the list after the first paint.
    let cancel
    const load = setTimeout(() => { cancel = fetchCloseFriends() }, 0)

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    // Autofocus search input after opening
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)

    return () => {
      clearTimeout(load)
      cancel?.()
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(timer)
    }
  }, [isOpen, fetchCloseFriends, onClose])

  // ── 3. Debounced User Search ──────────────────────────────────────────────
  useEffect(() => {
    const trimmed = searchQuery.trim()
    let active = true
    const timer = setTimeout(() => {
      setSearchError('')
      if (!trimmed) {
        setSearchResults([])
        setSearchLoading(false)
        return
      }
      setSearchLoading(true)
      api(`/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((results) => {
          if (!active) return
          const rawList = Array.isArray(results) ? results : []
          // Prevent showing current user in search results
          const filtered = rawList.filter((u) => {
            const uid = u.id ?? u.user_id
            return myId === undefined || myId === null || String(uid) !== String(myId)
          })
          setSearchResults(filtered)
          setSearchLoading(false)
        })
        .catch((err) => {
          if (!active) return
          setSearchError(err?.message || 'Failed to search users')
          setSearchLoading(false)
        })
    }, trimmed ? 250 : 0)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [searchQuery, myId])

  // ── 4. Add User to Close Friends ──────────────────────────────────────────
  const handleAddUser = async (user) => {
    const targetId = user.id ?? user.user_id
    if (!targetId) return

    // Prevent adding self
    if (myId !== undefined && myId !== null && String(targetId) === String(myId)) {
      setActionError('You cannot add yourself to your Close Friends list')
      return
    }

    // Prevent duplicate submission if already in progress or already added
    if (actionInProgress[targetId]) return
    if (closeFriends.some((cf) => String(cf.id) === String(targetId))) {
      return
    }

    setActionInProgress((prev) => ({ ...prev, [targetId]: 'adding' }))
    setActionError('')
    setActionSuccess('')

    try {
      const res = await api('/stories/close-friends', {
        method: 'POST',
        body: { friendUserId: targetId },
      })

      const newFriend = res?.friend || {
        id: targetId,
        name: user.name || user.username,
        username: user.username || user.name,
        avatar_url: user.avatar_url || null,
        created_at: new Date().toISOString(),
      }

      setCloseFriends((prev) => {
        if (prev.some((cf) => String(cf.id) === String(targetId))) return prev
        return [newFriend, ...prev]
      })

      setActionSuccess(`Added ${formatDisplayName(user)} to Close Friends`)
      onUpdated?.()
    } catch (err) {
      setActionError(err?.message || 'Could not add user to Close Friends')
    } finally {
      setActionInProgress((prev) => {
        const next = { ...prev }
        delete next[targetId]
        return next
      })
    }
  }

  // ── 5. Remove User from Close Friends ─────────────────────────────────────
  const handleRemoveUser = async (user) => {
    const targetId = user.id ?? user.user_id
    if (!targetId) return

    if (actionInProgress[targetId]) return

    setActionInProgress((prev) => ({ ...prev, [targetId]: 'removing' }))
    setActionError('')
    setActionSuccess('')

    try {
      await api(`/stories/close-friends/${targetId}`, {
        method: 'DELETE',
      })

      setCloseFriends((prev) => prev.filter((cf) => String(cf.id) !== String(targetId)))
      setActionSuccess(`Removed ${formatDisplayName(user)} from Close Friends`)
      onUpdated?.()
    } catch (err) {
      setActionError(err?.message || 'Could not remove user from Close Friends')
    } finally {
      setActionInProgress((prev) => {
        const next = { ...prev }
        delete next[targetId]
        return next
      })
    }
  }

  if (!isOpen) return null

  const isSearching = searchQuery.trim().length > 0
  const isFriend = (uid) => closeFriends.some((cf) => String(cf.id) === String(uid))

  return (
    <div
      className="close-friends-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-friends-title"
    >
      <div className="close-friends-panel" ref={panelRef}>
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="close-friends-header">
          <div className="close-friends-header-left">
            <span className="close-friends-star-badge" aria-hidden="true">
              <Star size={16} weight="fill" />
            </span>
            <h2 id="close-friends-title" className="close-friends-title">
              Close Friends
            </h2>
            <span
              className="close-friends-count-pill"
              aria-label={`${closeFriends.length} close friends`}
            >
              {closeFriends.length}
            </span>
          </div>

          <button
            type="button"
            className="close-friends-close-btn"
            onClick={onClose}
            aria-label="Close Close Friends modal"
          >
            <X size={20} />
          </button>
        </header>

        <p className="close-friends-desc">
          Only people on this list can view your Close Friends stories. We don&apos;t notify people when they are added or removed.
        </p>

        {/* ── Search Bar ─────────────────────────────────────────────────── */}
        <div className="close-friends-search-wrap">
          <MagnifyingGlass size={16} className="close-friends-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            className="close-friends-search-input"
            placeholder="Search by name or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search users to add to close friends"
          />
          {searchQuery && (
            <button
              type="button"
              className="close-friends-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Alert Banners ───────────────────────────────────────────────── */}
        {actionError && (
          <div className="close-friends-alert error" role="alert">
            <span>{actionError}</span>
            <button
              type="button"
              className="close-friends-alert-dismiss"
              onClick={() => setActionError('')}
              aria-label="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="close-friends-alert success" role="status">
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* ── Content / User List Area ────────────────────────────────────── */}
        <div className="close-friends-content">
          {/* A. Search Mode */}
          {isSearching ? (
            <div className="close-friends-search-section">
              <div className="close-friends-section-title">Search Results</div>

              {searchLoading && (
                <div className="close-friends-status-msg" aria-busy="true">
                  Searching users...
                </div>
              )}

              {searchError && (
                <div className="close-friends-status-msg error" role="alert">
                  {searchError}
                </div>
              )}

              {!searchLoading && searchResults.length === 0 && !searchError && (
                <div className="close-friends-empty-msg">
                  No users found matching &ldquo;{searchQuery}&rdquo;
                </div>
              )}

              {searchResults.length > 0 && (
                <ul className="close-friends-list" role="list">
                  {searchResults.map((user) => {
                    const uid = user.id ?? user.user_id
                    const alreadyFriend = isFriend(uid)
                    const pending = actionInProgress[uid]

                    return (
                      <li key={uid} className="close-friends-user-row">
                        <div className="close-friends-user-meta">
                          <Avatar
                            name={formatDisplayName(user)}
                            src={user.avatar_url}
                            size="sm"
                          />
                          <div className="close-friends-user-text">
                            <span className="close-friends-name">
                              {formatDisplayName(user)}
                            </span>
                            <span className="close-friends-handle">
                              @{formatUserName(user)}
                            </span>
                          </div>
                        </div>

                        {alreadyFriend ? (
                          <button
                            type="button"
                            className="close-friends-btn remove"
                            onClick={() => handleRemoveUser(user)}
                            disabled={Boolean(pending)}
                            aria-label={`Remove ${formatDisplayName(user)} from close friends`}
                          >
                            {pending === 'removing' ? 'Removing...' : 'Remove'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="close-friends-btn add"
                            onClick={() => handleAddUser(user)}
                            disabled={Boolean(pending)}
                            aria-label={`Add ${formatDisplayName(user)} to close friends`}
                          >
                            {pending === 'adding' ? (
                              'Adding...'
                            ) : (
                              <>
                                <Plus size={14} weight="bold" />
                                <span>Add</span>
                              </>
                            )}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            /* B. Close Friends List Mode */
            <div className="close-friends-list-section">
              <div className="close-friends-section-title">
                Your Close Friends ({closeFriends.length})
              </div>

              {loading && (
                <div className="close-friends-status-msg" aria-busy="true">
                  Loading Close Friends...
                </div>
              )}

              {loadError && (
                <div className="close-friends-load-error" role="alert">
                  <p>{loadError}</p>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={fetchCloseFriends}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loading && !loadError && closeFriends.length === 0 && (
                <div className="close-friends-empty-state">
                  <div className="close-friends-empty-star" aria-hidden="true">
                    <Star size={36} weight="fill" />
                  </div>
                  <h3>No Close Friends Yet</h3>
                  <p>
                    Use the search bar above to add friends. Only they will be able to see stories shared with Close Friends.
                  </p>
                </div>
              )}

              {!loading && closeFriends.length > 0 && (
                <ul className="close-friends-list" role="list">
                  {closeFriends.map((friend) => {
                    const fid = friend.id ?? friend.user_id
                    const pending = actionInProgress[fid]

                    return (
                      <li key={fid} className="close-friends-user-row">
                        <div className="close-friends-user-meta">
                          <Avatar
                            name={formatDisplayName(friend)}
                            src={friend.avatar_url}
                            size="sm"
                          />
                          <div className="close-friends-user-text">
                            <span className="close-friends-name">
                              {formatDisplayName(friend)}
                            </span>
                            <span className="close-friends-handle">
                              @{formatUserName(friend)}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="close-friends-btn remove"
                          onClick={() => handleRemoveUser(friend)}
                          disabled={Boolean(pending)}
                          aria-label={`Remove ${formatDisplayName(friend)} from close friends`}
                        >
                          {pending === 'removing' ? 'Removing...' : 'Remove'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="close-friends-footer">
          <button
            type="button"
            className="btn btn-primary close-friends-done-btn"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Plus, ShareFat, Star } from '@phosphor-icons/react'
import { api } from '../../api'
import { Avatar } from '../ui'
import { formatDisplayName } from '../../format'
import CloseFriendsModal from './CloseFriendsModal'
import { isCloseFriendsAudience } from './storyHelpers'
import './stories.css'

export { isCloseFriendsAudience }

export default function StoriesTray({
  currentUser,
  user,
  onOpenView,
  onOpenCreate,
  refreshKey = 0,
}) {
  const me = currentUser || user
  const [tray, setTray] = useState({ myStories: [], users: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeFetchUserId, setActiveFetchUserId] = useState(null)
  const [showCloseFriendsModal, setShowCloseFriendsModal] = useState(false)

  const fetchTray = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)

    api('/stories/tray')
      .then((res) => {
        if (!active) return
        setTray({
          myStories: Array.isArray(res?.myStories) ? res.myStories : [],
          users: Array.isArray(res?.users) ? res.users : [],
        })
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setError(err?.message || 'Could not load stories')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const cancel = fetchTray()
    return () => {
      if (typeof cancel === 'function') cancel()
    }
  }, [fetchTray, refreshKey])

  const myStories = tray.myStories
  const hasMyStories = myStories.length > 0
  const isMyCloseFriends = Boolean(
    hasMyStories && (
      myStories.some((s) => isCloseFriendsAudience(s)) ||
      isCloseFriendsAudience(tray)
    )
  )

  const handleOwnClick = () => {
    if (hasMyStories) {
      onOpenView?.({ user: me, stories: myStories })
    } else {
      onOpenCreate?.()
    }
  }

  const handleAddClick = (e) => {
    e.stopPropagation()
    onOpenCreate?.()
  }

  const handlePeerClick = async (peerUser) => {
    if (activeFetchUserId) return
    setActiveFetchUserId(peerUser.user_id)
    try {
      const res = await api(`/stories/users/${peerUser.user_id}`)
      onOpenView?.(res)
    } catch (err) {
      console.error('Failed to load user stories', err)
    } finally {
      setActiveFetchUserId(null)
    }
  }

  if (loading) {
    return (
      <aside className="stories-tray-container" aria-label="Stories">
        <div className="stories-tray stories-tray-loading" aria-busy="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="stories-item stories-skeleton-item" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="stories-skeleton-circle" />
              <div className="stories-skeleton-bar" />
            </div>
          ))}
        </div>
      </aside>
    )
  }

  if (error) {
    return (
      <aside className="stories-tray-container" aria-label="Stories">
        <div className="stories-tray-error" role="alert">
          <p className="stories-error-text">{error}</p>
          <button type="button" className="btn btn-secondary btn-sm stories-retry-btn" onClick={fetchTray}>
            Retry
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="stories-tray-container" aria-label="Stories">
      <div className="stories-tray-header">
        <span className="stories-tray-title">Stories</span>
        <button
          type="button"
          className="stories-tray-cf-btn"
          onClick={() => setShowCloseFriendsModal(true)}
          aria-label="Manage Close Friends list"
          title="Manage Close Friends"
        >
          <span className="stories-tray-cf-icon-wrap" aria-hidden="true">
            <Star size={13} weight="fill" />
          </span>
          <span>Close Friends</span>
        </button>
      </div>

      <div className="stories-tray" role="list">
        {/* 1. "Your Story" first */}
        <div role="listitem">
          <div className="stories-item stories-own-item">
            <div className="stories-avatar-pos">
              <button
                type="button"
                className={`stories-ring-btn stories-ring ${
                  hasMyStories
                    ? isMyCloseFriends
                      ? 'my-active close-friends'
                      : 'my-active'
                    : 'empty'
                }`}
                onClick={handleOwnClick}
                aria-label={
                  hasMyStories
                    ? isMyCloseFriends
                      ? 'View your Close Friends story'
                      : 'View your story'
                    : 'Add to your story'
                }
              >
                <div className="stories-avatar-wrapper">
                  <Avatar name={formatDisplayName(me?.name || 'You')} src={me?.avatar_url} />
                  {hasMyStories && myStories.some((s) => Boolean(s.original_story_id)) && (
                    <span className="stories-tray-reshare-badge" title="Includes reshared story" aria-label="Includes reshared story">
                      <ShareFat size={9} weight="fill" />
                    </span>
                  )}
                  {hasMyStories && isMyCloseFriends && (
                    <span
                      className="stories-tray-cf-badge"
                      title="Close Friends story"
                      aria-label="Close Friends story"
                    >
                      <Star size={10} weight="fill" />
                    </span>
                  )}
                </div>
              </button>

              {!hasMyStories ? (
                <span className="stories-add-badge" aria-hidden="true" onClick={handleOwnClick}>
                  <Plus size={14} weight="bold" />
                </span>
              ) : onOpenCreate ? (
                <button
                  type="button"
                  className="stories-add-badge-btn"
                  onClick={handleAddClick}
                  aria-label="Add new story"
                  title="Add story"
                >
                  <Plus size={12} weight="bold" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className="stories-name-btn"
              onClick={handleOwnClick}
              aria-label={
                hasMyStories
                  ? isMyCloseFriends
                    ? 'View your Close Friends story'
                    : 'View your story'
                  : 'Add to your story'
              }
            >
              <span className="stories-item-name">Your story</span>
            </button>
          </div>
        </div>

        {/* 2. Peer users */}
        {tray.users.map((peerUser, index) => {
          const isPeerCF = isCloseFriendsAudience(peerUser)
          return (
            <div role="listitem" key={peerUser.user_id}>
              <button
                type="button"
                className={`stories-item ${activeFetchUserId === peerUser.user_id ? 'is-fetching' : ''}`}
                style={{ animationDelay: `${(index + 1) * 45}ms` }}
                onClick={() => handlePeerClick(peerUser)}
                aria-label={`View ${isPeerCF ? 'Close Friends story' : 'story'} by ${formatDisplayName(peerUser.name)}`}
                disabled={activeFetchUserId === peerUser.user_id}
              >
                <div className="stories-avatar-pos">
                  <div
                    className={`stories-ring ${peerUser.has_unviewed ? 'unviewed' : 'viewed'} ${
                      isPeerCF ? 'close-friends' : ''
                    }`}
                  >
                    <div className="stories-avatar-wrapper">
                      <Avatar name={formatDisplayName(peerUser.name)} src={peerUser.avatar_url} />
                      {peerUser.has_reshare && (
                        <span className="stories-tray-reshare-badge" title="Includes reshared story" aria-label="Includes reshared story">
                          <ShareFat size={9} weight="fill" />
                        </span>
                      )}
                      {isPeerCF && (
                        <span
                          className="stories-tray-cf-badge"
                          title="Close Friends story"
                          aria-label="Close Friends story"
                        >
                          <Star size={10} weight="fill" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="stories-item-name" title={formatDisplayName(peerUser.name)}>
                  {formatDisplayName(peerUser.name)}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      <CloseFriendsModal
        isOpen={showCloseFriendsModal}
        onClose={() => setShowCloseFriendsModal(false)}
        currentUser={me}
        onUpdated={fetchTray}
      />
    </aside>
  )
}

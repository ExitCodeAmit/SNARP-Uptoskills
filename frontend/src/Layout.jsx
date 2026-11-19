import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Rss, FilmReel, Books, FileText, Graph, ChatsCircle, Bell, GearSix, UsersThree,
  SealCheck, ShieldCheck, SignOut, List, X, MagnifyingGlass, Plus,
} from '@phosphor-icons/react'

import { Avatar } from './components/ui'
import { ROLE_LABEL } from './format'
import { api } from './api'
import { SuggestBox } from './components/Discover'
import Assistant from './components/Assistant'
import { useApplyTheme } from './theme'
import logo from './assets/logo.png'

// Main navigation
const MAIN_NAV = [
  { to: '/', label: 'Feed', icon: Rss, end: true },
  { to: '/reels', label: 'Reels', icon: FilmReel },
  { to: '/articles', label: 'Papers', icon: Books, also: ['/saved', '/my-submissions'] },
  { to: '/docs', label: 'Docs', icon: FileText },
  { to: '/citation-network', label: 'Citation network', icon: Graph },
  { to: '/messages', label: 'Messages', icon: ChatsCircle },
  { to: '/communities', label: 'Communities', icon: UsersThree, also: ['/events', '/tools'] },
]

const SETTINGS_NAV = { to: '/settings', label: 'Settings', icon: GearSix }

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })

const PEOPLE_TABS = [
  { key: 'followers', label: 'Followers', empty: 'No followers yet. Share a post or a paper to get noticed.' },
  { key: 'following', label: 'Following', empty: 'You are not following anyone yet.' },
]

function PeoplePopover({ user, tab, onTab, onClose, onNavigate, onChanged }) {
  const [lists, setLists] = useState({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    let active = true
    api(`/users/${user.id}/${tab}`)
      .then((people) => { if (active) setLists((current) => ({ ...current, [tab]: people })) })
      .catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [user.id, tab])

  useEffect(() => {
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.side-stat-btn')) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [onClose])

  const toggleFollow = async (person) => {
    setBusy(person.id)
    setError('')
    try {
      const result = await api(`/users/${person.id}/follow`, { method: 'PUT', body: { following: !person.followed_by_me } })
      setLists((current) => Object.fromEntries(Object.entries(current).map(([key, people]) => [key, people.map((item) => (item.id === person.id ? { ...item, followed_by_me: result.followed_by_me } : item))])))
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const people = lists[tab]
  const current = PEOPLE_TABS.find((item) => item.key === tab)
  return (
    <div ref={ref} className="people-pop" role="dialog" aria-label={current.label}>
      <div className="people-pop-head">
        <div className="people-pop-tabs" role="tablist">
          {PEOPLE_TABS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => onTab(item.key)}>
              {item.label} <span>{compact.format(item.key === 'followers' ? user.follower_count ?? 0 : user.following_count ?? 0)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn people-pop-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {error && <p className="people-pop-error" role="alert">{error}</p>}
      {!people ? (
        <ul className="people-pop-list" aria-busy="true">
          {[0, 1, 2].map((i) => <li key={i}><span className="avatar skeleton" /><span className="skeleton skeleton-line" /></li>)}
        </ul>
      ) : people.length === 0 ? (
        <p className="people-pop-empty">{current.empty}</p>
      ) : (
        <ul className="people-pop-list">
          {people.map((person) => (
            <li key={person.id}>
              <Link to={`/users/${person.id}`} className="people-pop-person" onClick={() => { onClose(); onNavigate() }}>
                <Avatar name={person.name} src={person.avatar_url} size="sm" />
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.institution || ROLE_LABEL[person.role]}</small>
                </span>
              </Link>
              {String(person.id) !== String(user.id) && (
                <button type="button" className={`people-pop-follow ${person.followed_by_me ? 'following' : ''}`} disabled={busy === person.id}
                  onClick={() => toggleFollow(person)} aria-label={`${person.followed_by_me ? 'Unfollow' : tab === 'followers' ? 'Follow back' : 'Follow'} ${person.name}`}>
                  {person.followed_by_me ? 'Following' : tab === 'followers' ? 'Follow back' : 'Follow'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link to={`/users/${user.id}`} className="people-pop-all" onClick={() => { onClose(); onNavigate() }}>Open my profile</Link>
    </div>
  )
}

function SideProfile({ user, onNavigate, onChanged }) {
  const [panel, setPanel] = useState(null)
  const closePanel = useCallback(() => setPanel(null), [])
  const place = user.institution || user.department || ROLE_LABEL[user.role]
  const toggle = (key) => setPanel((current) => (current === key ? null : key))
  return (
    <section className="side-profile">
      <Link to={`/users/${user.id}`} className="side-avatar" onClick={onNavigate} aria-label={`${user.name}, view profile`}>
        <Avatar name={user.name} src={user.avatar_url} size="lg" />
        <span className="side-verified" title="Verified email"><SealCheck size={14} weight="fill" /></span>
      </Link>
      <span className="side-who">
        <Link to={`/users/${user.id}`} className="side-name" onClick={onNavigate}>{user.name}</Link>
        <span className="side-place">{place}</span>
      </span>
      <div className="side-stats">
        <Link to={`/users/${user.id}`} className="side-stat-btn" onClick={onNavigate}>
          <strong>{compact.format(user.post_count ?? 0)}</strong><span>Posts</span>
        </Link>
        <button type="button" className={`side-stat-btn ${panel === 'followers' ? 'active' : ''}`} onClick={() => toggle('followers')} aria-expanded={panel === 'followers'} aria-haspopup="dialog">
          <strong>{compact.format(user.follower_count ?? 0)}</strong><span>Followers</span>
        </button>
        <button type="button" className={`side-stat-btn ${panel === 'following' ? 'active' : ''}`} onClick={() => toggle('following')} aria-expanded={panel === 'following'} aria-haspopup="dialog">
          <strong>{compact.format(user.following_count ?? 0)}</strong><span>Following</span>
        </button>
      </div>
      {panel && <PeoplePopover user={user} tab={panel} onTab={setPanel} onClose={closePanel} onNavigate={onNavigate} onChanged={onChanged} />}
    </section>
  )
}

export default function Layout({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [unread, setUnread] = useState({ notifications: 0, messages: 0 })
  const [me, setMe] = useState(user)
  const [meTick, setMeTick] = useState(0)
  const refreshMe = useCallback(() => setMeTick((value) => value + 1), [])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useApplyTheme()
  const close = () => setOpen(false)

  const reviewNav = ['author', 'admin', 'moderator'].includes(user.role)
    ? [
        { to: '/reviews', label: 'Peer review', icon: SealCheck },
        ...(user.role === 'moderator' ? [{ to: '/moderator', label: 'Review queue', icon: ShieldCheck }] : []),
      ]
    : []
  const navItems = [...MAIN_NAV, ...reviewNav, SETTINGS_NAV]

  useEffect(() => {
    let active = true

    const refresh = () => {
      api('/notifications/unread-count')
        .then((counts) => {
          if (active) setUnread(counts)
        })
        .catch(() => {})
    }

    refresh()

    const interval = setInterval(refresh, 30000)

    window.addEventListener('snarp:unread-changed', refresh)

    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('snarp:unread-changed', refresh)
    }
  }, [pathname])

  useEffect(() => {
    let active = true
    api('/auth/me').then((fresh) => { if (active) setMe(fresh) }).catch(() => {})
    return () => { active = false }
  }, [pathname, user, meTick])

  const badgeFor = (to) => (to === '/messages' ? unread.messages : 0)
  const itemClass = (also) => ({ isActive }) => `nav-item ${isActive || also?.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ? 'active' : ''}`

  const runSearch = () => {
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }
  const search = (e) => {
    e.preventDefault()
    runSearch()
  }

  return (
    <div className="shell">
      {/* Sidebar */}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Link to="/" onClick={close}>
            <img
              src={logo}
              alt="UptoSkills"
              className="sidebar-logo"
            />
          </Link>

          <button
            className="icon-btn sidebar-close"
            onClick={close}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-scroll">
          <SideProfile user={{ ...user, ...me }} onNavigate={close} onChanged={refreshMe} />

          <nav className="side-nav" aria-label="Main">
            {navItems.map(({ to, label, icon: Icon, end, also }) => {
              const badge = badgeFor(to)
              return (
                <NavLink key={to} to={to} end={end} className={itemClass(also)} onClick={close}>
                  <Icon size={20} weight="fill" />
                  <span>{label}</span>
                  {badge > 0 && <span className="nav-badge">{badge}</span>}
                </NavLink>
              )
            })}
          </nav>

        </div>

        {/* Logged-in user section */}
        <div className="sidebar-user">
          <button type="button" className="side-signout" onClick={onLogout}>
            <SignOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {open && (
        <div className="scrim" onClick={close} />
      )}

      {/* Main content */}
      <div className="main">
        <header className="topbar">
          <button className={`icon-btn menu-btn ${unread.messages ? 'has-dot' : ''}`} onClick={() => setOpen(true)} aria-label={unread.messages ? 'Open menu, you have unread messages' : 'Open menu'}>
            <List size={22} />
          </button>

          {/* Search bar */}
          <form
            className="search"
            role="search"
            onSubmit={search}
          >
            <MagnifyingGlass size={18} />
            <SuggestBox
              value={query}
              onChange={setQuery}
              onSubmit={runSearch}
              placeholder="Search"
              inputProps={{ 'aria-label': 'Search papers, topics and people' }}
            />
          </form>

          <div className="topbar-actions">
            <NavLink to="/notifications" className="icon-btn icon-btn-lg topbar-bell" aria-label={unread.notifications ? `Notifications, ${unread.notifications} unread` : 'Notifications'} title="Notifications">
              <Bell size={21} weight={pathname === '/notifications' ? 'fill' : 'regular'} />
              {unread.notifications > 0 && <span className="nav-badge topbar-badge">{unread.notifications > 99 ? '99+' : unread.notifications}</span>}
            </NavLink>

            {pathname !== '/submit' && (
              <Link to="/submit" className="btn btn-primary" aria-label="Submit paper">
                <Plus size={18} weight="bold" />
                <span>Submit paper</span>
              </Link>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="content">
          <Outlet />
        </div>
      </div>

      <Assistant user={{ ...user, ...me }} />
    </div>
  )
}

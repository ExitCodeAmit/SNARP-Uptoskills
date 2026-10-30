import { useState } from 'react'
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  House, UsersThree, Article, CalendarBlank, ChatCircleDots, Bell, Quotes,
  UploadSimple, ShieldCheck, GearSix, Question, SignOut, List, X, MagnifyingGlass, Plus,
} from '@phosphor-icons/react'
import { Avatar } from './components/ui'
import { ROLE_LABEL } from './format'
import { CONVERSATIONS, NOTIFICATIONS } from './sample'
import logo from './assets/logo.png'

const MAIN_NAV = [
  { to: '/', label: 'Feed', icon: House, end: true },
  { to: '/communities', label: 'Communities', icon: UsersThree },
  { to: '/articles', label: 'Research papers', icon: Article },
  { to: '/events', label: 'Events', icon: CalendarBlank },
  { to: '/messages', label: 'Messages', icon: ChatCircleDots, badge: CONVERSATIONS.filter((c) => c.unread).length },
  { to: '/chat', label: 'Chat', icon: ChatCircle, badge: 0 },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: NOTIFICATIONS.filter((n) => n.unread).length },
]

const WORK_NAV = [
  { to: '/submit', label: 'Submit a paper', icon: UploadSimple },
  { to: '/my-submissions', label: 'My submissions', icon: Article },
  { to: '/settings', label: 'Settings', icon: GearSix },
  { to: '/help', label: 'Help center', icon: Question },
]

function NavGroup({ title, items, onNavigate }) {
  return (
    <nav className="nav-group" aria-label={title}>
      <p className="nav-title">{title}</p>
      {items.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink key={to} to={to} end={end} className="nav-item" onClick={onNavigate}>
          <Icon size={20} />
          <span>{label}</span>
          {badge > 0 && <span className="nav-badge">{badge}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const close = () => setOpen(false)

  const search = (e) => {
    e.preventDefault()
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Link to="/" onClick={close}>
            <img src={logo} alt="UptoSkills" className="sidebar-logo" />
          </Link>
          <button className="icon-btn sidebar-close" onClick={close} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-scroll">
          <NavGroup title="Discover" items={MAIN_NAV} onNavigate={close} />
          <NavGroup title="Workspace" items={WORK_NAV} onNavigate={close} />
          {['admin', 'moderator'].includes(user.role) && <NavGroup title="Review" items={[{ to: '/moderation', label: 'Paper moderation', icon: ShieldCheck }]} onNavigate={close} />}
        </div>

        <div className="sidebar-user">
          <Avatar name={user.name} />
          <div className="sidebar-user-info">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
          <button className="icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <SignOut size={20} />
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={close} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <List size={22} />
          </button>
          <form className="search" role="search" onSubmit={search}>
            <MagnifyingGlass size={18} />
            <input
              type="search"
              placeholder="Search papers, communities, events"
              aria-label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <div className="topbar-actions">
            <NavLink to="/notifications" className="icon-btn icon-btn-lg has-dot" aria-label="Notifications">
              <Bell size={22} />
            </NavLink>
            {pathname !== '/submit' && (
              <Link to="/submit" className="btn btn-primary">
                <Plus size={18} weight="bold" />
                <span>Submit paper</span>
              </Link>
            )}
          </div>
        </header>

        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

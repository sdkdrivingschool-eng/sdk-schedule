import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchUnassignedCount } from '../lib/api'
import {
  Badge,
  CalendarIcon,
  InboxIcon,
  PhoneIcon,
  Sidebar,
  SignOutIcon,
  TagIcon,
} from './Sidebar'
import { Button } from './ui'

const UnassignedContext = createContext({ count: 0, refresh: () => {} })

/** Lets a page tell the nav badge to re-count after it assigns something. */
export const useUnassignedCount = () => useContext(UnassignedContext)

/**
 * Layout for every signed-in staff screen: sidebar on desktop, compact top bar
 * plus a scrolling tab row on phones. Admin-only screens only appear for
 * admins (the routes and the database enforce it too).
 */
export function StaffShell({ children }) {
  const { profile, isAdmin, signOut } = useAuth()
  const [count, setCount] = useState(0)
  const location = useLocation()

  const refresh = useCallback(() => {
    if (!isAdmin) return
    fetchUnassignedCount()
      .then(setCount)
      .catch((err) => console.error('unassigned count failed', err))
  }, [isAdmin])

  // Re-count on navigation, on focus and once a minute — new online bookings
  // arrive without anyone in the office doing anything.
  useEffect(() => {
    refresh()
  }, [refresh, location.pathname])

  useEffect(() => {
    if (!isAdmin) return
    const id = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [isAdmin, refresh])

  const items = useMemo(() => {
    const list = [
      { to: '/schedule', label: 'Schedule', icon: <CalendarIcon /> },
    ]
    if (isAdmin) {
      list.push(
        { to: '/unassigned', label: 'Unassigned', icon: <InboxIcon />, badge: count, urgent: count > 0 },
        { to: '/requests', label: 'Intensive requests', icon: <PhoneIcon /> },
        { to: '/packages', label: 'Prices & settings', icon: <TagIcon /> },
      )
    }
    return list
  }, [isAdmin, count])

  const ctx = useMemo(() => ({ count, refresh }), [count, refresh])

  return (
    <UnassignedContext.Provider value={ctx}>
      <div className="flex min-h-dvh bg-black">
        <Sidebar profile={profile} onSignOut={signOut} items={items} />

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-line bg-black/90 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-black">
                  SDK
                </div>
                <span className="text-sm font-semibold text-fg">Scheduler</span>
              </div>
              <Button variant="ghost" onClick={signOut} className="px-2">
                <span className="sr-only">Sign out</span>
                <SignOutIcon className="h-5 w-5" />
              </Button>
            </div>
            {items.length > 1 && (
              <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Sections">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-surface-3 text-fg ring-1 ring-line-strong'
                          : 'text-fg-muted'
                      }`
                    }
                  >
                    {item.label}
                    {item.badge > 0 && <Badge urgent={item.urgent}>{item.badge}</Badge>}
                  </NavLink>
                ))}
              </nav>
            )}
          </header>

          {children}
        </div>
      </div>
    </UnassignedContext.Provider>
  )
}

/** Standard page wrapper + heading used by the admin screens. */
export function StaffPage({ title, subtitle, actions, children }) {
  return (
    <main className="animate-fade-in-up mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </main>
  )
}

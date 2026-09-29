import { NavLink } from 'react-router-dom'
import { roleLabel } from '../lib/schedule'

/**
 * Persistent left nav, styled after a typical SaaS dashboard shell — logo,
 * signed-in user card, nav list, sign out pinned to the bottom.
 *
 * Hidden below `lg` — on a phone StaffShell shows a compact top bar and a
 * scrolling tab row with the same items instead.
 */
export function Sidebar({ profile, onSignOut, items }) {
  const initial = profile?.name?.trim()?.[0]?.toUpperCase() ?? '?'

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
      <div className="flex items-center gap-2.5 px-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-black">
          SDK
        </div>
        <span className="text-[15px] font-bold tracking-tight text-fg">
          Scheduler
        </span>
      </div>

      <div className="mt-6 flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-black">
          {initial}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-fg">
            {profile?.name}
          </div>
          <div className="text-[11px] tracking-wide text-fg-muted uppercase">
            {roleLabel(profile)}
          </div>
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-surface-3 text-fg ring-1 ring-line-strong'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`
            }
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.badge > 0 && <Badge urgent={item.urgent}>{item.badge}</Badge>}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg"
        >
          <SignOutIcon />
          Sign out
        </button>
      </div>
    </aside>
  )
}

export function Badge({ urgent, children }) {
  return (
    <span
      className={`tabular min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-bold ${
        urgent ? 'bg-red-500 text-white' : 'bg-accent text-black'
      }`}
    >
      {children}
    </span>
  )
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2v3M13 2v3" strokeLinecap="round" />
    </svg>
  )
}

export function InboxIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
      <path d="M3 11l2-7h10l2 7v5H3v-5z" strokeLinejoin="round" />
      <path d="M3 11h4l1 2h4l1-2h4" strokeLinejoin="round" />
    </svg>
  )
}

export function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
      <path
        d="M5 3h3l1.5 4-2 1.2a9 9 0 004.3 4.3l1.2-2 4 1.5v3a2 2 0 01-2 2A14 14 0 013 5a2 2 0 012-2z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
      <path d="M3 3h7l7 7-7 7-7-7V3z" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.3" />
    </svg>
  )
}

export function SignOutIcon({ className = 'h-4 w-4 shrink-0' }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path
        d="M12 7V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1v-2M9 10h8m0 0l-2.5-2.5M17 10l-2.5 2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

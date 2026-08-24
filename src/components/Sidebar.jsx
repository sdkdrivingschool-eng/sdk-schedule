/**
 * Persistent left nav, styled after a typical SaaS dashboard shell — logo,
 * signed-in user card, nav list, sign out pinned to the bottom.
 *
 * The app only has one real screen today (Schedule), so there is exactly one
 * nav item. It's still worth the shell: it's where the next screen (Students,
 * say) would slot in without restructuring the page.
 *
 * Hidden below `lg` — on a phone this collapses to nothing and Schedule falls
 * back to its own compact top bar instead.
 */
export function Sidebar({ profile, onSignOut }) {
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
            {profile?.role}
          </div>
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
        <NavItem active icon={<CalendarIcon />}>
          Schedule
        </NavItem>
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

function NavItem({ active, icon, children }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
        active
          ? 'bg-surface-3 text-fg ring-1 ring-line-strong'
          : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {icon}
      {children}
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2v3M13 2v3" strokeLinecap="round" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="h-4 w-4 shrink-0"
    >
      <path
        d="M12 7V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1v-2M9 10h8m0 0l-2.5-2.5M17 10l-2.5 2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

import { Link, NavLink } from 'react-router-dom'

/**
 * Shell for the customer-facing pages. Deliberately separate from the staff
 * app: no sidebar, no sign-in, nothing that hints at the instructor screens.
 */
export function PublicLayout({ children }) {
  return (
    <div className="flex min-h-dvh flex-col bg-black text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-black/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/book" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-black">
              SDK
            </div>
            <span className="text-sm font-semibold sm:text-base">
              SDK Driving School
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <HeaderLink to="/book" end>
              Book
            </HeaderLink>
            <HeaderLink to="/my-lessons">My lessons</HeaderLink>
          </nav>
        </div>
      </header>

      <main className="animate-fade-in-up mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-5 text-xs text-fg-muted sm:px-6">
          Questions? Email{' '}
          <a
            href="mailto:info@sdkdrivingschool.com"
            className="text-fg underline-offset-2 hover:underline"
          >
            info@sdkdrivingschool.com
          </a>
          . Payments are processed securely by Stripe.
        </div>
      </footer>
    </div>
  )
}

function HeaderLink({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 font-medium transition-colors duration-150 ${
          isActive
            ? 'bg-surface-3 text-fg ring-1 ring-line-strong'
            : 'text-fg-muted hover:text-fg'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

/** Card used across the public pages. */
export function Panel({ className = '', children }) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  )
}

/**
 * Shown wherever we promise an email. New senders sometimes land in spam, and
 * a customer who never sees their confirmation assumes the booking failed.
 */
export function CheckSpamNote({ className = '' }) {
  return (
    <p className={`flex items-start gap-2 text-xs text-fg-muted ${className}`}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-px h-4 w-4 shrink-0">
        <rect x="3" y="5" width="14" height="10" rx="1.5" />
        <path d="M3.5 6l6.5 5 6.5-5" strokeLinejoin="round" />
      </svg>
      <span>
        Can't see our email? Please <strong className="text-fg">check your spam or junk folder</strong>{' '}
        and mark it “Not spam” so you don't miss future updates. Emails come from
        info@sdkdrivingschool.com.
      </span>
    </p>
  )
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'bg-white/5 text-fg-muted ring-line',
    success: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
    warning: 'bg-amber-500/10 text-amber-200 ring-amber-500/25',
  }
  return (
    <div className={`rounded-lg px-3 py-2.5 text-sm ring-1 ${tones[tone]}`}>
      {children}
    </div>
  )
}

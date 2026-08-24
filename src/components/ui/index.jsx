import { useEffect, useRef } from 'react'

/**
 * Modal shell: focus trap on open, Escape to close, click-outside to dismiss.
 * Kept deliberately small — every create/edit flow in the app is a modal, so
 * the behaviour needs to be identical everywhere.
 */
export function Modal({ open, onClose, title, subtitle, children, footer }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the first field so keyboard users land inside the dialog.
    const first = panelRef.current?.querySelector(
      'input, select, textarea, button',
    )
    first?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex touch-pan-y items-end justify-center overflow-x-hidden bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-scale-in max-h-[92vh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-t-2xl bg-surface shadow-2xl shadow-black/60 ring-1 ring-line sm:max-w-lg sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1.5 rounded-lg p-1.5 text-fg-subtle transition-all duration-150 hover:bg-surface-2 hover:text-fg active:scale-90"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-5 w-5"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 active:scale-[0.97]'

  const variants = {
    primary:
      'bg-accent text-black shadow-sm hover:bg-accent-hover focus-visible:ring-fg/40',
    secondary:
      'bg-surface text-fg ring-1 ring-line hover:bg-surface-2 hover:ring-line-strong focus-visible:ring-fg/25',
    danger:
      'bg-surface text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-red-500/40',
    ghost:
      'text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-fg/20',
  }

  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-medium text-fg-muted">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  )
}

export const inputClass =
  'block w-full rounded-lg border border-line bg-black px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors duration-150 outline-none focus:border-line-strong focus:ring-2 focus:ring-white/10'

/** Inline error banner — used for conflicts, which are expected, not crashes. */
export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300 ring-1 ring-red-500/20">
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 h-4 w-4 shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 5a1 1 0 012 0v5a1 1 0 11-2 0V5zm1 9.5a1.1 1.1 0 110-2.2 1.1 1.1 0 010 2.2z"
          clipRule="evenodd"
        />
      </svg>
      <span>{children}</span>
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

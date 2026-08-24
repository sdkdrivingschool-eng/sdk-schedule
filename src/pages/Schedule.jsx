import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, addWeeks, format, isSameDay } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchSchedule, fetchUsers } from '../lib/api'
import { weekDays, weekStart } from '../lib/schedule'
import { DayGrid, WeekGrid } from '../components/ScheduleGrid'
import { Legend } from '../components/ScheduleSegment'
import { BookingModal } from '../components/BookingModal'
import { UnavailableModal } from '../components/UnavailableModal'
import { DetailPanel } from '../components/DetailPanel'
import { Sidebar } from '../components/Sidebar'
import { Button, ErrorNote, Spinner } from '../components/ui'

const ALL = 'all'

export default function Schedule() {
  const { profile, isAdmin, signOut } = useAuth()

  const [users, setUsers] = useState([])
  const [bookings, setBookings] = useState([])
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [view, setView] = useState('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [dialog, setDialog] = useState({ type: null })

  // The active tab lives in the URL so it survives a reload and can be linked.
  // ?instructor=<id> selects one column, ?view=all selects the grid.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('instructor') ?? ALL

  const setTab = useCallback(
    (next) => {
      const params = new URLSearchParams()
      if (next === ALL) params.set('view', 'all')
      else params.set('instructor', next)
      setSearchParams(params, { replace: true })
    },
    [setSearchParams],
  )

  const instructors = useMemo(
    () => users.filter((u) => u.role === 'instructor'),
    [users],
  )

  // A tab pointing at an instructor who no longer exists would render an empty
  // grid with no way back, so fall back to the full view.
  useEffect(() => {
    if (tab === ALL || instructors.length === 0) return
    if (!instructors.some((i) => i.id === tab)) setTab(ALL)
  }, [tab, instructors, setTab])

  const visibleInstructors = useMemo(() => {
    if (tab === ALL) return instructors
    return instructors.filter((i) => i.id === tab)
  }, [tab, instructors])

  const days = useMemo(() => weekDays(anchor), [anchor])

  // Always load the whole surrounding week, so toggling week/day and stepping
  // between days inside a week needs no extra round trips.
  const range = useMemo(() => {
    const from = weekStart(anchor)
    return { from, to: addDays(from, 7) }
  }, [anchor])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [userRows, schedule] = await Promise.all([
        fetchUsers(),
        fetchSchedule(range),
      ])
      setUsers(userRows)
      setBookings(schedule.bookings)
      setBlocks(schedule.blocks)
    } catch (err) {
      console.error(err)
      setError(err.message ?? 'Could not load the schedule.')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  function step(direction) {
    setAnchor((current) =>
      view === 'week'
        ? addWeeks(current, direction)
        : addDays(current, direction),
    )
  }

  /**
   * A grid block was clicked. Free -> create, occupied -> detail.
   *
   * Instructors can only create against their own column, matching RLS; the
   * segment renderer already disables those slots, this is the guard behind it.
   */
  function onSelectSegment(segment, instructor) {
    if (segment.kind === 'free') {
      if (!isAdmin && instructor.id !== profile?.id) return
      setDialog({
        type: 'booking',
        initial: { start: segment.start, instructorId: instructor.id },
      })
      return
    }
    setDialog({ type: 'detail', segment, instructor })
  }

  const periodLabel = useMemo(() => {
    if (view === 'day') return format(anchor, 'EEEE d MMMM yyyy')
    const start = days[0]
    const end = days[6]
    const sameMonth = start.getMonth() === end.getMonth()
    return sameMonth
      ? `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`
      : `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`
  }, [view, anchor, days])

  const closeDialog = () => setDialog({ type: null })

  return (
    <div className="flex min-h-dvh bg-black">
      <Sidebar profile={profile} onSignOut={signOut} />

      <div className="min-w-0 flex-1">
        {/* Compact top bar — the sidebar is hidden below `lg`, this replaces it. */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-black/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-black">
              SDK
            </div>
            <span className="text-sm font-semibold text-fg">Scheduler</span>
          </div>
          <Button variant="ghost" onClick={signOut} className="px-2">
            <span className="sr-only">Sign out</span>
            <SignOutIcon />
          </Button>
        </header>

        {loading ? (
          <div className="flex h-[70dvh] items-center justify-center text-fg-subtle">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <main className="animate-fade-in-up mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            {/* Page header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
                  Schedule
                </h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                  {profile?.name}
                  <span className="rounded-full bg-surface-2 px-2 py-px text-[10px] font-medium tracking-wide text-fg-muted uppercase ring-1 ring-line">
                    {profile?.role}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={() => setDialog({ type: 'unavailable' })}>
                  <span className="hidden sm:inline">Mark unavailable</span>
                  <span className="sm:hidden">Unavailable</span>
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setDialog({ type: 'booking' })}
                >
                  <PlusIcon />
                  <span className="hidden sm:inline">New booking</span>
                  <span className="sm:hidden">Book</span>
                </Button>
              </div>
            </div>

            {/* View toggle — separate pills, not a shared segmented track */}
            <div className="mt-6 flex gap-2">
              {['week', 'day'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold tracking-wide uppercase transition-all duration-150 active:scale-95 ${
                    view === v
                      ? 'bg-accent text-black'
                      : 'border border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Instructor filter — bordered toolbar, active tab reads as a pressed pill */}
            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface p-1.5">
              <nav className="flex gap-1" aria-label="Instructor">
                <FilterTab
                  active={tab === ALL}
                  onClick={() => setTab(ALL)}
                  icon={<GridIcon />}
                >
                  All instructors
                </FilterTab>
                {instructors.map((i) => (
                  <FilterTab
                    key={i.id}
                    active={tab === i.id}
                    onClick={() => setTab(i.id)}
                    icon={<PersonIcon />}
                  >
                    {i.name}
                    {i.id === profile?.id && (
                      <span className="ml-1 normal-case opacity-60">
                        (you)
                      </span>
                    )}
                  </FilterTab>
                ))}
              </nav>
            </div>

            {error && (
              <div className="mt-3">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}

            {/* Period nav + legend — its own bordered card, sits directly above the grid */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Button onClick={() => step(-1)} className="px-2">
                  <span className="sr-only">Previous</span>
                  <Chevron dir="left" />
                </Button>
                <span className="tabular px-1 text-sm font-semibold text-fg">
                  {periodLabel}
                </span>
                <Button onClick={() => step(1)} className="px-2">
                  <span className="sr-only">Next</span>
                  <Chevron dir="right" />
                </Button>
                <Button onClick={() => setAnchor(new Date())} className="ml-1">
                  Today
                </Button>
              </div>

              <Legend />
            </div>

            {/* Day view needs a day picker within the week */}
            {view === 'day' && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                {days.map((d) => {
                  const active = isSameDay(d, anchor)
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => setAnchor(d)}
                      className={`flex min-w-14 flex-col items-center rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150 active:scale-95 ${
                        active
                          ? 'bg-accent text-black'
                          : 'bg-surface text-fg-muted ring-1 ring-line hover:bg-surface-2 hover:text-fg'
                      }`}
                    >
                      <span className="uppercase opacity-70">
                        {format(d, 'EEE')}
                      </span>
                      <span className="tabular text-base leading-tight font-semibold">
                        {format(d, 'd')}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="mt-4">
              {visibleInstructors.length === 0 ? (
                <p className="rounded-xl bg-surface p-8 text-center text-sm text-fg-subtle ring-1 ring-line">
                  No instructors found. Add users with role “instructor”.
                </p>
              ) : view === 'week' ? (
                <WeekGrid
                  days={days}
                  instructors={visibleInstructors}
                  bookings={bookings}
                  blocks={blocks}
                  profile={profile}
                  onSelect={onSelectSegment}
                />
              ) : (
                <DayGrid
                  day={anchor}
                  instructors={visibleInstructors}
                  bookings={bookings}
                  blocks={blocks}
                  profile={profile}
                  onSelect={onSelectSegment}
                />
              )}
            </div>
          </main>
        )}
      </div>

      <BookingModal
        open={dialog.type === 'booking'}
        onClose={closeDialog}
        onSaved={load}
        instructors={instructors}
        profile={profile}
        isAdmin={isAdmin}
        initial={dialog.initial ?? {}}
        editing={dialog.editing ?? null}
      />

      <UnavailableModal
        open={dialog.type === 'unavailable'}
        onClose={closeDialog}
        onSaved={load}
        instructors={instructors}
        profile={profile}
        isAdmin={isAdmin}
        initial={dialog.initial ?? {}}
        editing={dialog.editing ?? null}
      />

      <DetailPanel
        open={dialog.type === 'detail'}
        onClose={closeDialog}
        segment={dialog.segment}
        instructor={dialog.instructor}
        profile={profile}
        onChanged={load}
        onEdit={(segment) =>
          setDialog({
            type: segment.kind === 'booking' ? 'booking' : 'unavailable',
            editing: segment.row,
          })
        }
      />
    </div>
  )
}

function FilterTab({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition-all duration-150 active:scale-95 ${
        active
          ? 'bg-surface-3 text-fg ring-1 ring-line-strong'
          : 'text-fg-subtle hover:text-fg-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function Chevron({ dir }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
    >
      <path
        d={dir === 'left' ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-3.5 w-3.5"
    >
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
      <circle cx="10" cy="6.5" r="3" />
      <path d="M3.5 17c1-3.5 4-5 6.5-5s5.5 1.5 6.5 5" strokeLinecap="round" />
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
      className="h-5 w-5"
    >
      <path
        d="M12 7V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1v-2M9 10h8m0 0l-2.5-2.5M17 10l-2.5 2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

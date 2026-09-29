import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { Spinner } from '../../components/ui'
import {
  fmtTime,
  nowZoned,
  toDateInput,
  weekStart,
  zoned,
} from '../../lib/schedule'
import { fetchAvailableDays, fetchAvailableSlots } from '../../lib/publicApi'

/**
 * Week-at-a-time date picker plus the free start times for the chosen day.
 *
 * Availability comes straight from the database (get_available_days /
 * get_available_slots), so it always reflects the instructors' real
 * schedules. It is re-read when the tab regains focus and whenever
 * `refreshKey` changes — e.g. after a "that time was just taken" error.
 */
export function SlotPicker({ minutes, value, onChange, horizonDays = 56, refreshKey = 0 }) {
  const today = useMemo(() => startOfDay(nowZoned()), [])
  const maxOffset = Math.ceil(horizonDays / 7)

  const [offset, setOffset] = useState(0)
  const [available, setAvailable] = useState([])
  const [loadingDays, setLoadingDays] = useState(true)
  const [day, setDay] = useState(null)
  const [slots, setSlots] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState(null)
  const [focusTick, setFocusTick] = useState(0)

  // Jump forward automatically until a week with free times shows up, but
  // only on first load — after that the customer drives the navigation.
  const autoAdvance = useRef(true)

  const days = useMemo(() => {
    const start = addDays(weekStart(today), offset * 7)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [today, offset])

  useEffect(() => {
    const onFocus = () => setFocusTick((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    let active = true
    setLoadingDays(true)
    setError(null)
    fetchAvailableDays(toDateInput(days[0]), toDateInput(days[6]), minutes)
      .then((rows) => {
        if (!active) return
        setAvailable(rows)
        if (rows.length === 0 && autoAdvance.current && offset < maxOffset) {
          setOffset((o) => o + 1)
          return
        }
        autoAdvance.current = false
        setDay((current) =>
          current && rows.includes(toDateInput(current))
            ? current
            : rows[0]
              ? days.find((d) => toDateInput(d) === rows[0])
              : null,
        )
      })
      .catch((err) => {
        console.error(err)
        if (active) setError("We couldn't load available times. Please refresh the page.")
      })
      .finally(() => active && setLoadingDays(false))
    return () => {
      active = false
    }
  }, [days, minutes, offset, maxOffset, refreshKey, focusTick])

  useEffect(() => {
    if (!day) {
      setSlots([])
      return
    }
    let active = true
    setLoadingSlots(true)
    fetchAvailableSlots(toDateInput(day), minutes)
      .then((rows) => {
        if (!active) return
        setSlots(rows)
        // A previously chosen time that is no longer free must not linger.
        if (value && !rows.includes(value) && isSameDay(zoned(value), day)) {
          onChange(null)
        }
      })
      .catch((err) => {
        console.error(err)
        if (active) setError("We couldn't load available times. Please refresh the page.")
      })
      .finally(() => active && setLoadingSlots(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, minutes, refreshKey, focusTick])

  const weekLabel = `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM')}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <NavButton
          dir="left"
          disabled={offset === 0 || loadingDays}
          onClick={() => {
            autoAdvance.current = false
            setOffset((o) => o - 1)
          }}
        />
        <span className="tabular text-sm font-semibold">{weekLabel}</span>
        <NavButton
          dir="right"
          disabled={offset >= maxOffset || loadingDays}
          onClick={() => {
            autoAdvance.current = false
            setOffset((o) => o + 1)
          }}
        />
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const key = toDateInput(d)
          const open = available.includes(key)
          const active = day && isSameDay(d, day)
          return (
            <button
              key={key}
              type="button"
              disabled={!open || loadingDays}
              onClick={() => setDay(d)}
              className={`flex flex-col items-center rounded-lg py-2 text-xs transition-all duration-150 ${
                active
                  ? 'bg-accent text-black'
                  : open
                    ? 'bg-surface-2 text-fg ring-1 ring-line hover:ring-line-strong active:scale-95'
                    : 'text-fg-subtle opacity-50'
              }`}
            >
              <span className="uppercase opacity-70">{format(d, 'EEE')}</span>
              <span className="tabular text-base leading-tight font-semibold">
                {format(d, 'd')}
              </span>
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="min-h-24">
        {loadingDays || loadingSlots ? (
          <div className="flex h-24 items-center justify-center text-fg-subtle">
            <Spinner className="h-5 w-5" />
          </div>
        ) : !day ? (
          <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-fg-muted ring-1 ring-line">
            No free times this week. Try the next week.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-fg-muted">
              Free start times on {format(day, 'EEEE d MMMM')}
            </p>
            {slots.length === 0 ? (
              <p className="text-sm text-fg-muted">
                That day has just filled up. Please pick another day.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.map((iso) => {
                  const chosen = iso === value
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => onChange(iso)}
                      className={`tabular rounded-lg py-2 text-sm font-semibold transition-all duration-150 active:scale-95 ${
                        chosen
                          ? 'bg-accent text-black'
                          : 'bg-surface-2 text-fg ring-1 ring-line hover:ring-line-strong'
                      }`}
                    >
                      {fmtTime(zoned(iso))}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NavButton({ dir, ...props }) {
  return (
    <button
      type="button"
      aria-label={dir === 'left' ? 'Previous week' : 'Next week'}
      className="rounded-lg p-2 text-fg-muted ring-1 ring-line transition-all duration-150 hover:text-fg hover:ring-line-strong active:scale-95 disabled:opacity-30"
      {...props}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path
          d={dir === 'left' ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

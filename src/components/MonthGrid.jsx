import { useMemo } from 'react'
import { addDays, format, isSameDay, isSameMonth } from 'date-fns'
import { fmtTime, monthGridRange, nowZoned, toDateInput, zoned } from '../lib/schedule'

/** One colour per instructor, so a busy day still reads at a glance. */
// Amber is kept for "unassigned", grey for time off.
const INSTRUCTOR_COLOURS = [
  'bg-sky-400',
  'bg-violet-400',
  'bg-pink-400',
  'bg-teal-400',
  'bg-lime-400',
  'bg-rose-400',
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS = 3

/**
 * Month overview: who is teaching on which day. Lessons are listed per day
 * (time, student, instructor colour); time off shows as a grey chip. The
 * daily prayer break is left out — it is on every day and would only add
 * noise. Clicking a day opens it in the day view, where lessons can be edited.
 */
export function MonthGrid({
  month,
  instructors,
  allInstructors,
  bookings,
  blocks,
  showUnassigned,
  onPickDay,
}) {
  const today = nowZoned()

  const days = useMemo(() => {
    const { from, to } = monthGridRange(month)
    const out = []
    for (let d = from; d < to; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const colourOf = useMemo(() => {
    const map = new Map(allInstructors.map((i, idx) => [i.id, INSTRUCTOR_COLOURS[idx % INSTRUCTOR_COLOURS.length]]))
    return (id) => map.get(id) ?? 'bg-fg-subtle'
  }, [allInstructors])

  const nameOf = useMemo(() => {
    const map = new Map(allInstructors.map((i) => [i.id, i.name]))
    return (id) => map.get(id) ?? ''
  }, [allInstructors])

  // Group once by London date rather than filtering per cell.
  const byDay = useMemo(() => {
    const visible = new Set(instructors.map((i) => i.id))
    const groups = new Map()
    const add = (key, item) => {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }

    for (const b of bookings) {
      if (b.status !== 'confirmed') continue
      const assignedHere = b.instructor_id && visible.has(b.instructor_id)
      if (!assignedHere && !(showUnassigned && !b.instructor_id)) continue
      const start = zoned(b.start_time)
      add(toDateInput(start), {
        kind: b.instructor_id ? 'lesson' : 'unassigned',
        id: b.id,
        start,
        label: b.student_name,
        instructorId: b.instructor_id,
      })
    }

    for (const bl of blocks) {
      if (bl.reason === 'Prayer' || !visible.has(bl.instructor_id)) continue
      const start = zoned(bl.start_time)
      add(toDateInput(start), {
        kind: 'off',
        id: bl.id,
        start,
        label: bl.reason,
        instructorId: bl.instructor_id,
      })
    }

    for (const list of groups.values()) list.sort((a, b) => a.start - b.start)
    return groups
  }, [bookings, blocks, instructors, showUnassigned])

  const multi = instructors.length > 1

  return (
    <div className="space-y-3">
      {multi && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
          {instructors.map((i) => (
            <span key={i.id} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${colourOf(i.id)}`} />
              {i.name}
            </span>
          ))}
          {showUnassigned && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-500/30" />
              Unassigned
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-fg-subtle uppercase sm:text-left"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const items = byDay.get(toDateInput(d)) ?? []
            const lessons = items.filter((x) => x.kind !== 'off').length
            const inMonth = isSameMonth(d, month)
            const isToday = isSameDay(d, today)
            const shown = items.slice(0, MAX_CHIPS)
            const hidden = items.length - shown.length

            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onPickDay(d)}
                aria-label={`${format(d, 'EEEE d MMMM')}: ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}`}
                className={`group flex min-h-16 flex-col gap-1 border-line p-1.5 text-left transition-colors duration-150 hover:bg-surface-2 sm:min-h-28 sm:p-2 ${
                  i % 7 !== 6 ? 'border-r' : ''
                } ${i < days.length - 7 ? 'border-b' : ''} ${inMonth ? '' : 'bg-black/30'}`}
              >
                <div className="flex items-center">
                  <span
                    className={`tabular flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                      isToday
                        ? 'bg-accent text-black'
                        : inMonth
                          ? 'text-fg'
                          : 'text-fg-subtle'
                    }`}
                  >
                    {format(d, 'd')}
                  </span>
                </div>

                {/* Phones: just dots. Wider screens: one line per lesson. */}
                {items.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {items.slice(0, 6).map((x) => (
                      <span key={x.id} className={`h-1.5 w-1.5 rounded-full ${dotClass(x, colourOf)}`} />
                    ))}
                  </div>
                )}

                <ul className={`hidden min-w-0 space-y-0.5 sm:block ${inMonth ? '' : 'opacity-60'}`}>
                  {shown.map((x) => (
                    <li
                      key={x.id}
                      title={chipTitle(x, nameOf)}
                      className={`flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-tight ${
                        x.kind === 'off'
                          ? 'bg-white/5 text-fg-muted'
                          : x.kind === 'unassigned'
                            ? 'bg-amber-500/10 text-amber-200'
                            : 'bg-blue-500/10 text-blue-200'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(x, colourOf)}`} />
                      <span className="tabular shrink-0 opacity-80">{fmtTime(x.start)}</span>
                      <span className="truncate">
                        {x.kind === 'off' ? `${nameOf(x.instructorId).split(' ')[0]} · ${x.label}` : x.label}
                      </span>
                    </li>
                  ))}
                  {hidden > 0 && (
                    <li className="px-1 text-[11px] font-medium text-fg-subtle group-hover:text-fg-muted">
                      +{hidden} more
                    </li>
                  )}
                </ul>
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-fg-subtle">
        Click a day to open it in the day view. The daily prayer break isn't shown here.
      </p>
    </div>
  )
}

function dotClass(item, colourOf) {
  if (item.kind === 'unassigned') return 'bg-amber-500'
  if (item.kind === 'off') return 'bg-fg-subtle'
  return colourOf(item.instructorId)
}

function chipTitle(item, nameOf) {
  const who = item.instructorId ? nameOf(item.instructorId) : 'Unassigned'
  if (item.kind === 'off') return `${who}: unavailable from ${fmtTime(item.start)} (${item.label})`
  return `${fmtTime(item.start)} ${item.label} — ${who}`
}

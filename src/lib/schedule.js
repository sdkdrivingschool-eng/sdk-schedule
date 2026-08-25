import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns'

/** Working window rendered in the grid. Outside these hours nothing is shown. */
export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 20

/** Lesson lengths offered in the booking modal. Lessons are a 2-hour slot. */
export const DURATIONS = [120]

/** Reasons allowed by the availability_blocks check constraint. */
export const REASONS = ['Personal', 'Sick', 'Training', 'Other']

/** Shortest bookable gap — a lesson is a full 2-hour slot. */
export const MIN_LESSON_MINUTES = 120

/**
 * One colour per state, defined once so the legend and the grid can never
 * drift apart.
 */
export const SEGMENT_STYLES = {
  free: {
    label: 'Free',
    swatch: 'bg-emerald-500',
    block:
      'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/40',
  },
  booking: {
    label: 'Booked lesson',
    swatch: 'bg-blue-500',
    block:
      'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20 hover:border-blue-500/45',
  },
  unavailable: {
    label: 'Unavailable',
    swatch: 'bg-fg-subtle',
    block:
      'bg-white/5 border-white/10 text-fg-muted hover:bg-white/10 hover:border-white/20',
  },
}

/** Monday-based week start for the given date. */
export function weekStart(date) {
  return startOfWeek(date, { weekStartsOn: 1 })
}

/** The seven dates of the week containing `date`. */
export function weekDays(date) {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Start/end Date pair bounding the working window on `day`. */
export function workingWindow(day) {
  const base = startOfDay(day)
  return {
    start: addMinutes(base, DAY_START_HOUR * 60),
    end: addMinutes(base, DAY_END_HOUR * 60),
  }
}

/**
 * Half-open overlap test: touching ranges do not overlap, so a lesson ending
 * at 10:00 and one starting at 10:00 are both fine. Matches the '[)' ranges
 * used by the database constraints.
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

export function minutesOf(start, end) {
  return differenceInMinutes(end, start)
}

export const fmtTime = (d) => format(d, 'HH:mm')
export const fmtRange = (start, end) => `${fmtTime(start)}–${fmtTime(end)}`
export const fmtDayLabel = (d) => format(d, 'EEE d MMM')
export const fmtDayShort = (d) => format(d, 'EEE')
export const fmtDayNum = (d) => format(d, 'd')

/** `<input type="datetime-local">` wants this exact shape, no timezone. */
export const toLocalInput = (d) => format(d, "yyyy-MM-dd'T'HH:mm")
export const toDateInput = (d) => format(d, 'yyyy-MM-dd')

export function durationLabel(minutes) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/**
 * Turn one instructor's rows into an ordered, gap-filled timeline for `day`.
 *
 * Anything occupied (a confirmed booking or an unavailable block) is emitted
 * as-is; the gaps between them become explicit `free` segments so "who is
 * available on Thursday" is answerable at a glance. Cancelled bookings hold
 * no time and are dropped.
 *
 * Occupied ranges cannot overlap — the database enforces that — but the
 * cursor walk below tolerates it rather than emitting negative-width gaps.
 */
export function buildDaySegments({ day, bookings = [], blocks = [] }) {
  const { start: winStart, end: winEnd } = workingWindow(day)

  const occupied = []

  for (const b of bookings) {
    if (b.status !== 'confirmed') continue
    const start = parseISO(b.start_time)
    const end = parseISO(b.end_time)
    if (!rangesOverlap(start, end, winStart, winEnd)) continue
    occupied.push({ kind: 'booking', start, end, row: b })
  }

  for (const bl of blocks) {
    const start = parseISO(bl.start_time)
    const end = parseISO(bl.end_time)
    if (!rangesOverlap(start, end, winStart, winEnd)) continue
    occupied.push({ kind: 'unavailable', start, end, row: bl })
  }

  occupied.sort((a, b) => a.start - b.start)

  const segments = []
  let cursor = winStart

  for (const item of occupied) {
    // Clip to the working window so a multi-day block renders sensibly.
    const start = item.start < winStart ? winStart : item.start
    const end = item.end > winEnd ? winEnd : item.end

    if (start > cursor) {
      segments.push(makeFree(cursor, start))
    }

    segments.push({
      kind: item.kind,
      start,
      end,
      row: item.row,
      minutes: minutesOf(start, end),
      continuesBefore: item.start < winStart,
      continuesAfter: item.end > winEnd,
    })

    if (end > cursor) cursor = end
  }

  if (cursor < winEnd) segments.push(makeFree(cursor, winEnd))

  return segments
}

function makeFree(start, end) {
  const minutes = minutesOf(start, end)
  return {
    kind: 'free',
    start,
    end,
    row: null,
    minutes,
    // A 30-minute gap cannot hold the shortest lesson, so don't invite a click.
    bookable: minutes >= MIN_LESSON_MINUTES,
  }
}

/** Filter helpers used when slicing a week's rows down to one day. */
export const onDay = (day) => (row) =>
  isSameDay(parseISO(row.start_time), day) ||
  isSameDay(parseISO(row.end_time), day) ||
  (parseISO(row.start_time) < startOfDay(day) &&
    parseISO(row.end_time) > startOfDay(day))

/**
 * Can this profile write this row?
 * Mirrors the RLS predicate exactly — the UI hides what the database would
 * reject anyway, so users never see a permission error they could have
 * been spared.
 */
export function canWrite(profile, row) {
  if (!profile) return false
  if (profile.admin_access) return true
  return row.instructor_id === profile.id || row.created_by === profile.id
}

/** Combine a date input (yyyy-MM-dd) and time input (HH:mm) into a Date. */
export function combineDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`)
}

/** Half-hour options across the working window, for the start-time select. */
export function timeOptions() {
  const out = []
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h += 1) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
}

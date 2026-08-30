import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { TZDate } from '@date-fns/tz'

/**
 * The school operates in London, so the schedule is pinned to London time
 * rather than the viewer's device.
 *
 * Times are stored as UTC timestamptz and were previously rendered in
 * whatever zone the browser happened to be in. That is correct for staff
 * sitting in London but silently wrong anywhere else — the same lesson reads
 * at a different hour, and a time typed on a device abroad is saved as that
 * device's wall-clock. Pinning the zone makes a booking mean one thing no
 * matter where it is opened, and keeps GMT/BST handling out of the callers.
 */
export const TIME_ZONE = 'Europe/London'

/** An absolute instant (ISO string or Date) as London wall-clock. */
export const zoned = (value) => new TZDate(value, TIME_ZONE)

/** Now, in London. */
export const nowZoned = () => new TZDate(Date.now(), TIME_ZONE)

/**
 * A wall-clock time the user typed, read as London.
 *
 * Built from parts on purpose: `new TZDate('2026-08-25T09:00', tz)` parses a
 * string with no offset against the *device's* zone and then converts, so
 * "09:00" entered abroad would not be 09:00 in London.
 */
function zonedFromParts(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const [hh, mm] = String(timeStr).split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return new Date(NaN)
  return new TZDate(y, m - 1, d, hh, mm, 0, TIME_ZONE)
}

/**
 * Working window rendered in the grid.
 *
 * Anything wholly outside it is not drawn at all — buildDaySegments discards
 * rows that do not overlap — so the window has to cover every lesson that
 * actually gets booked, not just typical hours. In London time the earliest
 * booking on record starts 05:00 and the latest ends 18:30; an 08:00 start
 * was hiding the early ones outright.
 */
export const DAY_START_HOUR = 5
export const DAY_END_HOUR = 20

/** Lesson lengths offered in the booking modal. */
export const DURATIONS = [90, 120, 150]

/** The standard slot — what a new booking starts on. */
export const DEFAULT_DURATION = 120

/** Reasons allowed by the availability_blocks check constraint. */
export const REASONS = ['Personal', 'Sick', 'Training', 'Other']

/** Shortest bookable gap — no point offering a slot no lesson would fit. */
export const MIN_LESSON_MINUTES = Math.min(...DURATIONS)

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
  return startOfWeek(zoned(date), { weekStartsOn: 1 })
}

/** The seven dates of the week containing `date`. */
export function weekDays(date) {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Start/end Date pair bounding the working window on `day`. */
export function workingWindow(day) {
  const base = startOfDay(zoned(day))
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
export const toLocalInput = (d) => format(zoned(d), "yyyy-MM-dd'T'HH:mm")
export const toDateInput = (d) => format(zoned(d), 'yyyy-MM-dd')

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
    const start = zoned(b.start_time)
    const end = zoned(b.end_time)
    if (!rangesOverlap(start, end, winStart, winEnd)) continue
    occupied.push({ kind: 'booking', start, end, row: b })
  }

  for (const bl of blocks) {
    const start = zoned(bl.start_time)
    const end = zoned(bl.end_time)
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
  isSameDay(zoned(row.start_time), day) ||
  isSameDay(zoned(row.end_time), day) ||
  (zoned(row.start_time) < startOfDay(zoned(day)) &&
    zoned(row.end_time) > startOfDay(zoned(day)))

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

/**
 * How a profile's role reads in the UI.
 *
 * Role and admin rights are separate columns, so an instructor can hold admin
 * access — show both rather than picking one and hiding the other.
 */
export function roleLabel(profile) {
  if (!profile) return ''
  if (profile.role !== 'admin' && profile.admin_access) {
    return `${profile.role}/admin`
  }
  return profile.role
}

/** Combine a date input (yyyy-MM-dd) and time input (HH:mm) into a Date. */
export function combineDateTime(dateStr, timeStr) {
  return zonedFromParts(dateStr, timeStr)
}

/** Parse a `datetime-local` value (`yyyy-MM-ddTHH:mm`) as London wall-clock. */
export function fromLocalInput(value) {
  const [datePart, timePart = '00:00'] = String(value).split('T')
  return zonedFromParts(datePart, timePart)
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

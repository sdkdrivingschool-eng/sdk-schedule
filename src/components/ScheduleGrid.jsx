import { isSameDay, isWeekend } from 'date-fns'
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  buildDaySegments,
  canWrite as canWriteRow,
  fmtDayNum,
  fmtDayShort,
  fmtDayLabel,
  onDay,
} from '../lib/schedule'
import { ScheduleSegment } from './ScheduleSegment'

/**
 * A single instructor's segments for a single day.
 *
 * Free gaps are rendered as real blocks rather than empty space, so the
 * question the whole app exists to answer — who is free on Thursday — is
 * answerable without clicking anything.
 */
function DayColumn({ instructor, day, bookings, blocks, profile, onSelect }) {
  const segments = buildDaySegments({
    day,
    bookings: bookings.filter((b) => b.instructor_id === instructor.id).filter(onDay(day)),
    blocks: blocks.filter((b) => b.instructor_id === instructor.id).filter(onDay(day)),
  })

  // Instructors may only create against their own column — don't offer a
  // "+ Book" affordance that RLS would reject.
  const canCreate =
    profile?.admin_access === true || instructor.id === profile?.id

  return (
    <div className="flex flex-col gap-1 p-1.5">
      {segments.map((segment) => (
        <ScheduleSegment
          key={`${segment.kind}-${segment.start.toISOString()}`}
          segment={segment}
          canEdit={segment.row ? canWriteRow(profile, segment.row) : canCreate}
          onSelect={
            segment.kind === 'free' && !canCreate
              ? undefined
              : () => onSelect(segment, instructor, day)
          }
        />
      ))}
    </div>
  )
}

/** Rows are days, columns are instructors. */
export function WeekGrid({
  days,
  instructors,
  bookings,
  blocks,
  profile,
  onSelect,
}) {
  const today = new Date()
  const template = `4.5rem repeat(${instructors.length}, minmax(0, 1fr))`

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[36rem] rounded-xl bg-surface ring-1 ring-line"
        style={{ minWidth: instructors.length > 1 ? '44rem' : '20rem' }}
      >
        {/* Instructor header */}
        <div
          className="sticky top-0 z-10 grid border-b border-line bg-surface/95 backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          <div className="px-2 py-2.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
            {DAY_START_HOUR}:00–{DAY_END_HOUR}:00
          </div>
          {instructors.map((instructor) => (
            <div
              key={instructor.id}
              className="border-l border-line px-2.5 py-2.5"
            >
              <div className="truncate text-sm font-semibold text-fg">
                {instructor.name}
              </div>
              <div className="truncate text-[11px] text-fg-subtle">
                {instructor.email}
              </div>
            </div>
          ))}
        </div>

        {days.map((day) => {
          const isToday = isSameDay(day, today)
          return (
            <div
              key={day.toISOString()}
              className={`grid border-b border-line last:border-b-0 ${
                isWeekend(day) ? 'bg-white/[0.02]' : ''
              }`}
              style={{ gridTemplateColumns: template }}
            >
              <div
                className={`flex flex-col items-center justify-start gap-0.5 px-1 py-2 transition-colors duration-150 ${
                  isToday ? 'bg-white/5' : ''
                }`}
              >
                <span
                  className={`text-[11px] font-medium uppercase ${
                    isToday ? 'text-fg' : 'text-fg-subtle'
                  }`}
                >
                  {fmtDayShort(day)}
                </span>
                <span
                  className={`tabular text-lg leading-none font-semibold ${
                    isToday
                      ? 'flex h-7 w-7 items-center justify-center rounded-full bg-accent text-black'
                      : 'text-fg-muted'
                  }`}
                >
                  {fmtDayNum(day)}
                </span>
              </div>

              {instructors.map((instructor) => (
                <div
                  key={instructor.id}
                  className="border-l border-line"
                >
                  <DayColumn
                    instructor={instructor}
                    day={day}
                    bookings={bookings}
                    blocks={blocks}
                    profile={profile}
                    onSelect={onSelect}
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One day, one section per instructor. Stacks on narrow screens — this is the
 * view an instructor uses on a phone between lessons.
 */
export function DayGrid({
  day,
  instructors,
  bookings,
  blocks,
  profile,
  onSelect,
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-fg-muted">
        {fmtDayLabel(day)}
      </h2>

      <div
        className={`grid gap-3 ${
          instructors.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''
        }`}
      >
        {instructors.map((instructor) => (
          <section
            key={instructor.id}
            className="rounded-xl bg-surface ring-1 ring-line transition-colors duration-150 hover:ring-line-strong"
          >
            <header className="border-b border-line px-3 py-2.5">
              <div className="truncate text-sm font-semibold text-fg">
                {instructor.name}
              </div>
              <div className="truncate text-[11px] text-fg-subtle">
                {instructor.email}
              </div>
            </header>
            <DayColumn
              instructor={instructor}
              day={day}
              bookings={bookings}
              blocks={blocks}
              profile={profile}
              onSelect={onSelect}
            />
          </section>
        ))}
      </div>
    </div>
  )
}

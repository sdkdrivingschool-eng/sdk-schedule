import { SEGMENT_STYLES, durationLabel, fmtRange } from '../lib/schedule'

/**
 * One block in a day column.
 *
 * Height tracks duration so the eye can compare a 60-minute lesson against a
 * 90-minute one without reading times. Below ~44px there is no room for two
 * lines, so short blocks collapse to a single line.
 */
export function ScheduleSegment({ segment, onSelect, canEdit }) {
  const style = SEGMENT_STYLES[segment.kind]

  // 0.72px per minute: a 60-minute lesson is ~43px, a full free morning is tall
  // enough to read but never dominates the column.
  const height = Math.max(segment.minutes * 0.72, 26)
  const compact = height < 44

  if (segment.kind === 'free') {
    return (
      <button
        type="button"
        disabled={!segment.bookable || !onSelect}
        onClick={() => onSelect?.(segment)}
        style={{ height }}
        className={`group w-full rounded-md border border-dashed px-2 text-left transition-all duration-150 ${style.block} ${
          segment.bookable && onSelect
            ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
            : 'cursor-default opacity-60'
        }`}
      >
        <span className="flex h-full items-center justify-between gap-1">
          <span className="tabular text-[11px] font-medium opacity-70">
            {fmtRange(segment.start, segment.end)}
          </span>
          {segment.bookable && onSelect && (
            <span className="hidden text-[11px] font-semibold opacity-0 transition group-hover:opacity-100 sm:inline">
              + Book
            </span>
          )}
        </span>
      </button>
    )
  }

  const isBooking = segment.kind === 'booking'
  const title = isBooking ? segment.row.student_name : segment.row.reason

  return (
    <button
      type="button"
      onClick={() => onSelect?.(segment)}
      style={{ height }}
      className={`w-full overflow-hidden rounded-md border px-2 py-1 text-left transition-all duration-150 ${style.block} ${
        onSelect ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : 'cursor-default'
      }`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-xs font-semibold">{title}</span>
        {!compact && canEdit && (
          <span className="shrink-0 text-[10px] font-medium opacity-50">
            edit
          </span>
        )}
      </div>

      {!compact && (
        <div className="tabular mt-0.5 truncate text-[11px] opacity-75">
          {segment.continuesBefore && '← '}
          {fmtRange(segment.start, segment.end)}
          {segment.continuesAfter && ' →'}
          <span className="ml-1 opacity-60">
            · {durationLabel(segment.minutes)}
          </span>
        </div>
      )}

      {!compact && isBooking && segment.row.student_phone && (
        <div className="tabular truncate text-[11px] opacity-60">
          {segment.row.student_phone}
        </div>
      )}
    </button>
  )
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {Object.entries(SEGMENT_STYLES).map(([key, style]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${style.swatch}`} />
          <span className="text-xs text-fg-muted">{style.label}</span>
        </span>
      ))}
    </div>
  )
}

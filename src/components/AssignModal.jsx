import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button, ErrorNote, Modal, Spinner } from './ui'
import { durationLabel, fmtRange, minutesOf, zoned } from '../lib/schedule'
import { assignBooking, describeWriteError, fetchFreeInstructors } from '../lib/api'

/**
 * Assign (or reassign) an online lesson to an instructor.
 *
 * Lists ONLY instructors free for this exact time and length — one free means
 * one choice, none free means a warning to call the customer. The database
 * re-checks at the moment of assigning, because this list can go stale while
 * the dialog is open (an instructor blocks time, another admin assigns).
 */
export function AssignModal({ open, booking, onClose, onAssigned }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const bookingId = booking?.id

  useEffect(() => {
    if (!open || !bookingId) return
    let active = true
    setLoading(true)
    setError(null)
    setBusy(false)
    setChoice(null)
    fetchFreeInstructors(bookingId)
      .then((rows) => {
        if (!active) return
        setOptions(rows)
        // Pre-select when there is no real decision to make, or when the
        // customer's previous instructor is free.
        const preferred = rows.find((r) => r.previous) ?? (rows.length === 1 ? rows[0] : null)
        setChoice(preferred?.id ?? null)
      })
      .catch((err) => active && setError(describeWriteError(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [open, bookingId])

  if (!booking) return null

  const start = zoned(booking.start_time)
  const end = zoned(booking.end_time)
  const reassigning = Boolean(booking.instructor_id)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await assignBooking(booking.id, choice)
      onAssigned?.()
      onClose()
    } catch (err) {
      setError(describeWriteError(err))
      setBusy(false)
      // Refresh the list — the most likely failure is that it went stale.
      fetchFreeInstructors(booking.id).then(setOptions).catch(() => {})
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reassigning ? 'Reassign lesson' : 'Assign an instructor'}
      subtitle={booking.student_name}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!choice || busy || loading}>
            {busy && <Spinner />}
            {reassigning ? 'Reassign & email customer' : 'Assign & email customer'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-blue-200">
          <div className="tabular text-sm font-semibold">
            {fmtRange(start, end)}
            <span className="ml-2 font-normal opacity-70">
              {durationLabel(minutesOf(start, end))}
            </span>
          </div>
          <div className="mt-0.5 text-xs opacity-75">{format(start, 'EEEE d MMMM yyyy')}</div>
        </div>

        {loading ? (
          <div className="flex h-20 items-center justify-center text-fg-subtle">
            <Spinner className="h-5 w-5" />
          </div>
        ) : options.length === 0 ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-3 text-sm text-amber-200 ring-1 ring-amber-500/25">
            <strong className="font-semibold">No instructor is free at this time.</strong>{' '}
            Someone may have blocked the time since the customer booked. Contact
            the customer to agree a new time. Cancelling the lesson puts their
            hours back on their balance.
          </div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm text-fg-muted">
              {options.length === 1
                ? 'Only one instructor is free for this lesson:'
                : `${options.length} instructors are free — choose one:`}
            </legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 ring-1 transition-colors ${
                  choice === o.id
                    ? 'bg-surface-3 ring-line-strong'
                    : 'bg-surface-2 ring-line hover:ring-line-strong'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="instructor"
                    checked={choice === o.id}
                    onChange={() => setChoice(o.id)}
                    className="accent-white"
                  />
                  <span className="text-sm font-medium text-fg">{o.name}</span>
                </span>
                {o.previous && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/25">
                    Taught this customer before
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        )}

        <p className="text-xs text-fg-subtle">
          The customer is emailed automatically with the instructor's name and
          lesson details.
        </p>

        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { addMinutes } from 'date-fns'
import {
  Button,
  ErrorNote,
  Field,
  Modal,
  Spinner,
  inputClass,
} from './ui'
import {
  DEFAULT_DURATION,
  DURATIONS,
  combineDateTime,
  durationLabel,
  fmtRange,
  nowZoned,
  timeOptions,
  toDateInput,
  zoned,
} from '../lib/schedule'
import {
  createBooking,
  describeWriteError,
  findConflict,
  updateBooking,
} from '../lib/api'

/**
 * Create or edit a lesson.
 *
 * Conflicts are checked against the database on submit rather than only
 * against loaded state — the grid may be seconds stale, and the check has to
 * cover the instructor being edited, who may not even be on screen.
 */
export function BookingModal({
  open,
  onClose,
  onSaved,
  instructors,
  profile,
  isAdmin,
  initial = {},
  editing = null,
}) {
  const [studentName, setStudentName] = useState('')
  const [studentPhone, setStudentPhone] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // An instructor can only ever book themselves, so lock the dropdown.
  const lockedInstructor = !isAdmin ? profile?.id : null

  useEffect(() => {
    if (!open) return

    if (editing) {
      const start = zoned(editing.start_time)
      const end = zoned(editing.end_time)
      setStudentName(editing.student_name ?? '')
      setStudentPhone(editing.student_phone ?? '')
      setInstructorId(editing.instructor_id)
      setDate(toDateInput(start))
      setTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`)
      setDuration(Math.round((end - start) / 60000))
      setNotes(editing.notes ?? '')
    } else {
      const start = initial.start ? zoned(initial.start) : nowZoned()
      setStudentName('')
      setStudentPhone('')
      setInstructorId(
        lockedInstructor ?? initial.instructorId ?? instructors[0]?.id ?? '',
      )
      setDate(toDateInput(start))
      setTime(
        initial.start
          ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
          : '09:00',
      )
      setDuration(DEFAULT_DURATION)
      setNotes('')
    }

    setError(null)
    setBusy(false)
    // Re-seeding only makes sense when the dialog opens or the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, initial.start, initial.instructorId])

  const preview = useMemo(() => {
    if (!date || !time) return null
    const start = combineDateTime(date, time)
    if (Number.isNaN(start.getTime())) return null
    return { start, end: addMinutes(start, duration) }
  }, [date, time, duration])

  /*
   * Lessons booked under an earlier slot length still have to be editable.
   * Without their own length in the list the select would fall back to
   * displaying the first option while state held the real value — the form
   * would claim a duration the booking does not have.
   */
  const durationOptions = useMemo(
    () =>
      DURATIONS.includes(duration)
        ? DURATIONS
        : [...DURATIONS, duration].sort((a, b) => a - b),
    [duration],
  )

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!preview) {
      setError('Pick a valid date and time.')
      return
    }
    if (!instructorId) {
      setError('Pick an instructor.')
      return
    }
    if (!studentName.trim()) {
      setError("Enter the student's name.")
      return
    }

    setBusy(true)

    try {
      const clash = await findConflict({
        instructorId,
        start: preview.start,
        end: preview.end,
        ignoreBookingId: editing?.id ?? null,
      })

      if (clash) {
        setError(clash.message)
        setBusy(false)
        return
      }

      const payload = {
        instructor_id: instructorId,
        student_name: studentName.trim(),
        student_phone: studentPhone.trim() || null,
        start_time: preview.start.toISOString(),
        end_time: preview.end.toISOString(),
        notes: notes.trim() || null,
      }

      if (editing) {
        await updateBooking(editing.id, payload)
      } else {
        await createBooking({ ...payload, created_by: profile.id })
      }

      onSaved()
      onClose()
    } catch (err) {
      // A constraint violation here means someone else booked the slot between
      // our check and our insert.
      setError(describeWriteError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit lesson' : 'New booking'}
      subtitle={
        preview
          ? `${fmtRange(preview.start, preview.end)} · ${durationLabel(duration)}`
          : 'Pick a slot to see the time range.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={busy}
            type="submit"
          >
            {busy && <Spinner />}
            {editing ? 'Save changes' : 'Create booking'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student name">
            <input
              required
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              className={inputClass}
              placeholder="Jane Doe"
            />
          </Field>

          <Field label="Student phone" hint="Optional">
            <input
              type="tel"
              value={studentPhone}
              onChange={(e) => setStudentPhone(e.target.value)}
              className={inputClass}
              placeholder="07700 900000"
            />
          </Field>
        </div>

        <Field
          label="Instructor"
          hint={lockedInstructor ? 'You can only book your own lessons.' : undefined}
        >
          <select
            value={instructorId}
            onChange={(e) => setInstructorId(e.target.value)}
            disabled={Boolean(lockedInstructor)}
            className={`${inputClass} disabled:bg-surface-2 disabled:text-fg-subtle`}
          >
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Start time">
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputClass}
            >
              {timeOptions().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Duration">
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={inputClass}
            >
              {durationOptions.map((d) => (
                <option key={d} value={d}>
                  {durationLabel(d)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Notes" hint="Optional — pickup point, lesson focus, etc.">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}

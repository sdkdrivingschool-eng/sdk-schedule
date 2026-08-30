import { useEffect, useMemo, useState } from 'react'
import { addHours } from 'date-fns'
import {
  Button,
  ErrorNote,
  Field,
  Modal,
  Spinner,
  inputClass,
} from './ui'
import {
  REASONS,
  durationLabel,
  fromLocalInput,
  minutesOf,
  nowZoned,
  toLocalInput,
  zoned,
} from '../lib/schedule'
import {
  createBlock,
  describeWriteError,
  findConflict,
  updateBlock,
} from '../lib/api'

/**
 * Mark an instructor unavailable.
 *
 * Uses datetime-local rather than the date + time + duration split of the
 * booking form: unavailability is often multi-hour or multi-day (a training
 * course, a week off sick), so a fixed duration list would fight the use case.
 */
export function UnavailableModal({
  open,
  onClose,
  onSaved,
  instructors,
  profile,
  isAdmin,
  initial = {},
  editing = null,
}) {
  const [instructorId, setInstructorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('Personal')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const lockedInstructor = !isAdmin ? profile?.id : null

  useEffect(() => {
    if (!open) return

    if (editing) {
      setInstructorId(editing.instructor_id)
      setFrom(toLocalInput(zoned(editing.start_time)))
      setTo(toLocalInput(zoned(editing.end_time)))
      setReason(editing.reason ?? 'Personal')
    } else {
      const start = initial.start ? zoned(initial.start) : nowZoned()
      const end = initial.end ? zoned(initial.end) : addHours(start, 2)
      setInstructorId(
        lockedInstructor ?? initial.instructorId ?? instructors[0]?.id ?? '',
      )
      setFrom(toLocalInput(start))
      setTo(toLocalInput(end))
      setReason('Personal')
    }

    setError(null)
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, initial.start, initial.end, initial.instructorId])

  const span = useMemo(() => {
    if (!from || !to) return null
    const start = fromLocalInput(from)
    const end = fromLocalInput(to)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (end <= start) return null
    return { start, end, minutes: minutesOf(start, end) }
  }, [from, to])

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!span) {
      setError('The end time must be after the start time.')
      return
    }
    if (!instructorId) {
      setError('Pick an instructor.')
      return
    }

    setBusy(true)

    try {
      const clash = await findConflict({
        instructorId,
        start: span.start,
        end: span.end,
        ignoreBlockId: editing?.id ?? null,
      })

      if (clash) {
        setError(
          clash.kind === 'booking'
            ? `${clash.message} Cancel or move that lesson first.`
            : clash.message,
        )
        setBusy(false)
        return
      }

      const payload = {
        instructor_id: instructorId,
        start_time: span.start.toISOString(),
        end_time: span.end.toISOString(),
        reason,
      }

      if (editing) {
        await updateBlock(editing.id, payload)
      } else {
        await createBlock({ ...payload, created_by: profile.id })
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(describeWriteError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit unavailable block' : 'Mark unavailable'}
      subtitle={
        span
          ? `${durationLabel(span.minutes)} blocked out`
          : 'Choose a start and end.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={busy}>
            {busy && <Spinner />}
            {editing ? 'Save changes' : 'Mark unavailable'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Instructor"
          hint={
            lockedInstructor
              ? 'You can only change your own availability.'
              : undefined
          }
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            <input
              type="datetime-local"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="To">
            <input
              type="datetime-local"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Reason">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  )
}

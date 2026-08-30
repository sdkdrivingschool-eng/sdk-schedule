import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button, ErrorNote, Modal, Spinner } from './ui'
import {
  SEGMENT_STYLES,
  canWrite,
  durationLabel,
  fmtRange,
  minutesOf,
  zoned,
} from '../lib/schedule'
import {
  cancelBooking,
  deleteBlock,
  deleteBooking,
  describeWriteError,
} from '../lib/api'

/**
 * Detail panel for an existing booking or unavailable block.
 *
 * Cancelling a lesson sets status='cancelled' rather than deleting it — the
 * school wants the record. An unavailable block has nothing to preserve, so
 * removing it is a real delete.
 *
 * Write controls are hidden when RLS would reject the change anyway, so an
 * instructor never gets a permission error for someone else's row.
 */
export function DetailPanel({
  open,
  onClose,
  segment,
  instructor,
  profile,
  onEdit,
  onChanged,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  /*
   * The panel is always mounted — closing only makes the modal render null —
   * so state survives from one opening to the next. Left alone that means a
   * finished action keeps `busy` true and disables every control the next
   * time the panel opens, and an armed delete confirmation carries over onto
   * a different row, where the next single click would delete without ever
   * asking. Reset whenever the panel opens or changes target.
   */
  useEffect(() => {
    setBusy(false)
    setError(null)
    setConfirmingDelete(false)
  }, [open, segment?.row?.id])

  if (!segment?.row) return null

  const isBooking = segment.kind === 'booking'
  const row = segment.row
  const editable = canWrite(profile, row)
  const start = zoned(row.start_time)
  const end = zoned(row.end_time)
  const cancelled = isBooking && row.status === 'cancelled'

  async function runAction(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      onClose()
    } catch (err) {
      setError(describeWriteError(err))
      setBusy(false)
    }
  }

  const style = SEGMENT_STYLES[segment.kind]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isBooking ? row.student_name : `Unavailable — ${row.reason}`}
      subtitle={instructor?.name}
      footer={
        editable ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={() => onEdit(segment)} disabled={busy}>
              Edit
            </Button>
            {isBooking && !cancelled ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => runAction(() => cancelBooking(row.id))}
              >
                {busy && <Spinner />}
                Cancel lesson
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true)
                    return
                  }
                  runAction(() =>
                    isBooking ? deleteBooking(row.id) : deleteBlock(row.id),
                  )
                }}
              >
                {busy && <Spinner />}
                {confirmingDelete ? 'Confirm delete' : 'Delete'}
              </Button>
            )}
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="space-y-4">
        <div className={`rounded-lg border px-3 py-2.5 ${style.block}`}>
          <div className="tabular text-sm font-semibold">
            {fmtRange(start, end)}
            <span className="ml-2 font-normal opacity-70">
              {durationLabel(minutesOf(start, end))}
            </span>
          </div>
          <div className="mt-0.5 text-xs opacity-75">
            {format(start, 'EEEE d MMMM yyyy')}
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          {isBooking && row.student_phone && (
            <Row label="Phone">
              <a
                href={`tel:${row.student_phone}`}
                className="tabular text-fg transition-colors duration-150 hover:text-white hover:underline"
              >
                {row.student_phone}
              </a>
            </Row>
          )}

          {isBooking && (
            <Row label="Status">
              <span
                className={
                  cancelled
                    ? 'rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-line'
                    : 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/25'
                }
              >
                {cancelled ? 'Cancelled' : 'Confirmed'}
              </span>
            </Row>
          )}

          {!isBooking && <Row label="Reason">{row.reason}</Row>}

          {isBooking && row.notes && <Row label="Notes">{row.notes}</Row>}
        </dl>

        {!editable && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-subtle ring-1 ring-line">
            This belongs to another instructor. Only they or an admin can
            change it.
          </p>
        )}

        {confirmingDelete && editable && (
          <p className="text-xs text-red-400">
            This permanently removes the record. Click again to confirm.
          </p>
        )}

        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-fg">{children}</dd>
    </div>
  )
}

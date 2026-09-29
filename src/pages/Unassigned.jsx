import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { StaffPage, StaffShell, useUnassignedCount } from '../components/StaffShell'
import { AssignModal } from '../components/AssignModal'
import { Button, ErrorNote, Spinner } from '../components/ui'
import { durationLabel, fmtRange, minutesOf, zoned } from '../lib/schedule'
import {
  clearAttention,
  fetchAttentionOrders,
  fetchUnassigned,
  describeWriteError,
} from '../lib/api'

const SOON_MS = 48 * 60 * 60 * 1000

const money = (pence) => `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`

/**
 * Admin inbox for online bookings: paid lessons waiting for an instructor,
 * soonest first, plus anything flagged for a human (a payment that landed
 * after its time was taken).
 */
export default function Unassigned() {
  return (
    <StaffShell>
      <UnassignedScreen />
    </StaffShell>
  )
}

function UnassignedScreen() {
  const { refresh: refreshBadge } = useUnassignedCount()
  const [rows, setRows] = useState([])
  const [attention, setAttention] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [assigning, setAssigning] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [list, flagged] = await Promise.all([fetchUnassigned(), fetchAttentionOrders()])
      setRows(list)
      setAttention(flagged)
    } catch (err) {
      console.error(err)
      setError(describeWriteError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', load)
    }
  }, [load])

  const paid = rows.filter((r) => r.status === 'confirmed')
  const holds = rows.filter((r) => r.status === 'held')

  return (
    <StaffPage
      title="Unassigned lessons"
      subtitle="Paid online bookings waiting for an instructor. Soonest first."
      actions={<Button onClick={load}>Refresh</Button>}
    >
      <ErrorNote>{error}</ErrorNote>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-fg-subtle">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-6">
          {attention.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold tracking-wide text-red-300 uppercase">
                Needs attention
              </h2>
              {attention.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 ring-1 ring-red-500/25"
                >
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold text-fg">
                      {o.customers?.name} · {o.package_name} · {money(o.amount_pence)}
                    </div>
                    <div className="text-red-200">{o.attention_reason}</div>
                    <div className="mt-1 text-fg-muted">
                      <a href={`tel:${o.customers?.phone}`} className="hover:underline">
                        {o.customers?.phone}
                      </a>{' '}
                      · {o.customers?.email} · {o.customers?.reg_number}
                    </div>
                  </div>
                  <Button
                    onClick={async () => {
                      await clearAttention(o.id).catch((err) => setError(describeWriteError(err)))
                      load()
                    }}
                  >
                    Mark handled
                  </Button>
                </div>
              ))}
            </section>
          )}

          {paid.length === 0 ? (
            <div className="rounded-xl bg-surface p-10 text-center ring-1 ring-line">
              <p className="text-sm font-medium text-fg">All caught up</p>
              <p className="mt-1 text-sm text-fg-muted">
                Every paid online lesson has an instructor.
              </p>
            </div>
          ) : (
            <section className="space-y-2">
              {paid.map((r) => (
                <LessonCard key={r.id} row={r} onAssign={() => setAssigning(r)} />
              ))}
            </section>
          )}

          {holds.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-fg-muted uppercase">
                Awaiting payment ({holds.length})
              </h2>
              <p className="mb-2 text-xs text-fg-subtle">
                These customers are on the payment page. The time is held for
                them until {holds.length === 1 ? 'the hold expires' : 'their holds expire'}.
              </p>
              <ul className="space-y-1">
                {holds.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-fg-muted ring-1 ring-line"
                  >
                    <span>
                      {h.student_name} · {h.package_name}
                    </span>
                    <span className="tabular">
                      {format(zoned(h.start_time), 'EEE d MMM')},{' '}
                      {fmtRange(zoned(h.start_time), zoned(h.end_time))} · held until{' '}
                      {format(zoned(h.hold_expires_at), 'HH:mm')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <AssignModal
        open={Boolean(assigning)}
        booking={assigning}
        onClose={() => setAssigning(null)}
        onAssigned={() => {
          load()
          refreshBadge()
        }}
      />
    </StaffPage>
  )
}

function LessonCard({ row, onAssign }) {
  const start = zoned(row.start_time)
  const end = zoned(row.end_time)
  const soon = new Date(row.start_time).getTime() - Date.now() < SOON_MS
  const noneFree = row.free_instructors === 0

  return (
    <article
      className={`rounded-xl bg-surface px-4 py-4 ring-1 ${
        soon ? 'ring-red-500/40' : 'ring-line'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-fg">{row.student_name}</span>
            {soon && <Pill tone="red">Within 48h</Pill>}
            {noneFree ? (
              <Pill tone="amber">No instructor free</Pill>
            ) : (
              <Pill tone="green">
                {row.free_instructors} free
              </Pill>
            )}
          </div>
          <div className="tabular text-sm text-fg">
            {format(start, 'EEEE d MMMM')}, {fmtRange(start, end)}{' '}
            <span className="text-fg-muted">({durationLabel(minutesOf(start, end))})</span>
          </div>
          <div className="text-sm text-fg-muted">
            <a href={`tel:${row.student_phone}`} className="text-fg hover:underline">
              {row.student_phone}
            </a>{' '}
            · {row.email}
          </div>
          <div className="text-sm text-fg-muted">
            {[row.pickup_address, row.postcode].filter(Boolean).join(', ')}
            {row.area === 'surrey' && ' · Surrey'}
          </div>
          <div className="text-xs text-fg-subtle">
            {row.package_name}
            {row.amount_pence ? ` · paid ${money(row.amount_pence)}` : ''}
            {row.minutes_remaining != null && row.minutes_remaining > 0
              ? ` · ${durationLabel(row.minutes_remaining)} left on package`
              : ''}
            {' · '}
            <span className="tabular">{row.reg_number}</span>
          </div>
          {row.notes?.includes('Customer note:') && (
            <div className="text-xs text-fg-muted italic">
              “{row.notes.split('Customer note: ')[1]}”
            </div>
          )}
        </div>
        <Button variant="primary" onClick={onAssign}>
          Assign
        </Button>
      </div>
    </article>
  )
}

function Pill({ tone, children }) {
  const tones = {
    red: 'bg-red-500/10 text-red-300 ring-red-500/25',
    amber: 'bg-amber-500/10 text-amber-200 ring-amber-500/25',
    green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  )
}

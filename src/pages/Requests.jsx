import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { StaffPage, StaffShell } from '../components/StaffShell'
import { Button, ErrorNote, Spinner, inputClass } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { describeWriteError, fetchIntensiveRequests, updateIntensiveRequest } from '../lib/api'

const money = (pence) => `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`

/**
 * Intensive course requests. These are not auto-scheduled: an admin calls
 * the customer, agrees dates (and payment) and books the lessons on the
 * schedule, then marks the request confirmed or declined here.
 */
export default function Requests() {
  return (
    <StaffShell>
      <RequestsScreen />
    </StaffShell>
  )
}

function RequestsScreen() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showHandled, setShowHandled] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await fetchIntensiveRequests())
    } catch (err) {
      setError(describeWriteError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const open = rows.filter((r) => r.status === 'requested')
  const handled = rows.filter((r) => r.status !== 'requested')

  return (
    <StaffPage
      title="Intensive course requests"
      subtitle="Call the customer to arrange dates, then book the lessons on the schedule."
    >
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-fg-subtle">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-6">
          {open.length === 0 ? (
            <div className="rounded-xl bg-surface p-10 text-center text-sm text-fg-muted ring-1 ring-line">
              No open requests.
            </div>
          ) : (
            open.map((r) => <RequestCard key={r.id} row={r} onChanged={load} />)
          )}

          {handled.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHandled((v) => !v)}
                className="text-sm text-fg-muted hover:text-fg"
              >
                {showHandled ? 'Hide' : 'Show'} handled requests ({handled.length})
              </button>
              {showHandled && (
                <div className="mt-3 space-y-2">
                  {handled.map((r) => (
                    <RequestCard key={r.id} row={r} onChanged={load} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </StaffPage>
  )
}

function RequestCard({ row, onChanged }) {
  const { profile } = useAuth()
  const [notes, setNotes] = useState(row.admin_notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const c = row.contact ?? {}

  async function save(status) {
    setBusy(true)
    setError(null)
    try {
      await updateIntensiveRequest(row.id, {
        status,
        admin_notes: notes || null,
        handled_by: status === 'requested' ? null : profile.id,
        handled_at: status === 'requested' ? null : new Date().toISOString(),
      })
      onChanged()
    } catch (err) {
      setError(describeWriteError(err))
      setBusy(false)
    }
  }

  const statusTone = {
    requested: 'bg-amber-500/10 text-amber-200 ring-amber-500/25',
    confirmed: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
    declined: 'bg-surface-2 text-fg-muted ring-line',
  }[row.status]

  return (
    <article className="rounded-xl bg-surface px-4 py-4 ring-1 ring-line">
      <div className="min-w-0 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-fg">{c.name ?? row.customers?.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${statusTone}`}>
            {row.status}
          </span>
        </div>
        <div className="text-fg">
          {row.package_name} · {money(row.price_pence)} · preferred start{' '}
          <strong>{format(new Date(`${row.preferred_start_date}T12:00:00`), 'EEE d MMM yyyy')}</strong>
        </div>
        <div className="text-fg-muted">
          <a href={`tel:${c.phone}`} className="text-fg hover:underline">
            {c.phone}
          </a>{' '}
          · {c.email}
        </div>
        <div className="text-fg-muted">
          {[c.pickup_address, c.postcode].filter(Boolean).join(', ')}
          {c.area === 'surrey' && ' · Surrey'}
        </div>
        {c.message && <div className="text-fg-muted italic">“{c.message}”</div>}
        <div className="text-xs text-fg-subtle">
          Requested {format(new Date(row.created_at), 'd MMM yyyy, HH:mm')} ·{' '}
          {row.customers?.reg_number}
        </div>
      </div>

      <textarea
        className={`${inputClass} mt-3 min-h-16`}
        placeholder="Notes (dates agreed, payment taken, called back…)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="mt-2">
        <ErrorNote>{error}</ErrorNote>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {row.status !== 'requested' && (
          <Button onClick={() => save('requested')} disabled={busy}>
            Reopen
          </Button>
        )}
        <Button onClick={() => save(row.status)} disabled={busy}>
          Save notes
        </Button>
        {row.status !== 'declined' && (
          <Button variant="danger" onClick={() => save('declined')} disabled={busy}>
            Decline
          </Button>
        )}
        {row.status !== 'confirmed' && (
          <Button variant="primary" onClick={() => save('confirmed')} disabled={busy}>
            {busy && <Spinner />}
            Mark confirmed
          </Button>
        )}
      </div>
    </article>
  )
}

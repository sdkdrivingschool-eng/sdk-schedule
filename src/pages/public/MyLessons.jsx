import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Button, ErrorNote, Field, Spinner, inputClass } from '../../components/ui'
import { durationLabel, fmtRange, zoned } from '../../lib/schedule'
import { callBooking, fetchBookingSettings, remember } from '../../lib/publicApi'
import { CheckSpamNote, Notice, Panel, PublicLayout } from './PublicLayout'
import { SlotPicker } from './SlotPicker'

// Online bookings are 2-hour lessons; other lengths are arranged by request.
const LESSON_MINUTES = 120
const LOGIN_KEY = 'sdk-my-lessons'

/**
 * Customer self-service: reference number + email shows the hours balance
 * and upcoming lessons, and books the next lesson from the balance.
 *
 * No online cancelling or moving in v1 — customers contact SDK for that.
 */
export default function MyLessons() {
  const saved = remember.get(LOGIN_KEY) ?? {}
  const [regNumber, setRegNumber] = useState(saved.reg_number ?? '')
  const [email, setEmail] = useState(saved.email ?? '')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function load(e) {
    e?.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = await callBooking('lookup', { reg_number: regNumber, email })
      setSummary(data)
      remember.set(LOGIN_KEY, { reg_number: regNumber, email })
    } catch (err) {
      setSummary(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">My lessons</h1>

        {!summary ? (
          <Panel>
            <form onSubmit={load} className="space-y-4">
              <p className="text-sm text-fg-muted">
                Enter the booking reference from your confirmation email and
                the email address you booked with.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Booking reference">
                  <input
                    className={`${inputClass} uppercase`}
                    placeholder="SDK-XXXXXXXX"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Email">
                  <input
                    className={inputClass}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </Field>
              </div>
              <ErrorNote>{error}</ErrorNote>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading && <Spinner />}
                  Show my lessons
                </Button>
              </div>
            </form>
          </Panel>
        ) : (
          <Summary
            summary={summary}
            credentials={{ reg_number: regNumber, email }}
            onRefresh={load}
            onSignOut={() => {
              setSummary(null)
              remember.set(LOGIN_KEY, null)
            }}
          />
        )}
      </div>
    </PublicLayout>
  )
}

function Summary({ summary, credentials, onRefresh, onSignOut }) {
  const [booking, setBooking] = useState(false)
  const now = new Date()
  const upcoming = summary.lessons.filter((l) => new Date(l.end_time) > now)
  // A lesson must fit within a single package's remaining hours.
  const bestBalance = Math.max(0, ...summary.orders.map((o) => o.minutes_remaining))
  const totalBalance = summary.orders.reduce((sum, o) => sum + o.minutes_remaining, 0)

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{summary.name}</div>
            <div className="tabular text-sm text-fg-muted">{summary.reg_number}</div>
          </div>
          <Button variant="ghost" onClick={onSignOut}>
            Not you?
          </Button>
        </div>

        <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3 ring-1 ring-line">
          <div className="text-xs text-fg-muted">Hours left to book</div>
          <div className="text-2xl font-bold">{durationLabel(totalBalance)}</div>
          {summary.orders.length > 1 && (
            <ul className="mt-2 space-y-0.5 text-xs text-fg-muted">
              {summary.orders.map((o, i) => (
                <li key={i}>
                  {o.package_name}: {durationLabel(o.minutes_remaining)} of{' '}
                  {durationLabel(o.minutes_total)} left
                </li>
              ))}
            </ul>
          )}
        </div>

        {bestBalance >= LESSON_MINUTES && !booking && (
          <Button variant="primary" className="mt-4" onClick={() => setBooking(true)}>
            Book my next lesson
          </Button>
        )}
        {bestBalance > 0 && bestBalance < LESSON_MINUTES && (
          <p className="mt-4 text-sm text-fg-muted">
            Online bookings are {durationLabel(LESSON_MINUTES)} lessons. To use your
            remaining {durationLabel(bestBalance)}, email info@sdkdrivingschool.com.
          </p>
        )}
        {bestBalance < LESSON_MINUTES && (
          <p className="mt-4 text-sm text-fg-muted">
            Need more lessons?{' '}
            <Link to="/book" className="text-fg underline-offset-2 hover:underline">
              Buy a lesson or package
            </Link>
            .
          </p>
        )}
      </Panel>

      {booking && (
        <BookFromBalance
          credentials={credentials}
          onDone={() => {
            setBooking(false)
            onRefresh()
          }}
          onCancel={() => setBooking(false)}
        />
      )}

      <Panel>
        <h2 className="mb-3 text-base font-semibold">Upcoming lessons</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-fg-muted">No upcoming lessons.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((l) => (
              <li key={l.start_time} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-semibold">
                    {format(zoned(l.start_time), 'EEEE d MMMM')}
                  </div>
                  <div className="tabular text-sm text-fg-muted">
                    {fmtRange(zoned(l.start_time), zoned(l.end_time))}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                    l.instructor
                      ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
                      : 'bg-amber-500/10 text-amber-200 ring-amber-500/25'
                  }`}
                >
                  {l.instructor ? `with ${l.instructor}` : 'Instructor to be confirmed'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-fg-subtle">
          Need to cancel or move a lesson? Email info@sdkdrivingschool.com and
          we'll sort it out — your hours are never lost.
        </p>
      </Panel>
    </>
  )
}

function BookFromBalance({ credentials, onDone, onCancel }) {
  const minutes = LESSON_MINUTES
  const [start, setStart] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [horizon, setHorizon] = useState(56)
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetchBookingSettings().then((s) => setHorizon(s.horizon_days)).catch(() => {})
  }, [])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await callBooking('book', { ...credentials, start, minutes, notes })
      setDone(res)
    } catch (err) {
      setError(err.message)
      if (err.code === 'SLOT_FULL' || err.code === 'INVALID_TIME') {
        setStart(null)
        setRefreshKey((k) => k + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Panel>
        <Notice tone="success">
          Booked for {format(zoned(done.start_time), 'EEEE d MMMM')},{' '}
          {fmtRange(zoned(done.start_time), zoned(done.end_time))}. We'll email
          you as soon as your instructor is confirmed.
        </Notice>
        <CheckSpamNote className="mt-3" />
        <Button className="mt-4" onClick={onDone}>
          Done
        </Button>
      </Panel>
    )
  }

  return (
    <Panel>
      <h2 className="mb-3 text-base font-semibold">Book your next lesson</h2>
      <p className="mb-5 text-sm text-fg-muted">
        Lessons are {durationLabel(minutes)} long.
      </p>

      <SlotPicker
        minutes={minutes}
        value={start}
        onChange={setStart}
        horizonDays={horizon}
        refreshKey={refreshKey}
      />

      <div className="mt-4">
        <Field label="Anything we should know? (optional)">
          <textarea
            className={`${inputClass} min-h-16`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </Field>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-5 flex justify-between gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!start || busy}>
          {busy && <Spinner />}
          Book {durationLabel(minutes)} lesson
        </Button>
      </div>
    </Panel>
  )
}

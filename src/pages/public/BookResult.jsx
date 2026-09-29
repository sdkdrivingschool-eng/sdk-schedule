import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Button, Spinner } from '../../components/ui'
import { durationLabel, fmtRange, zoned } from '../../lib/schedule'
import { callBooking } from '../../lib/publicApi'
import { CheckSpamNote, Notice, Panel, PublicLayout } from './PublicLayout'

const POLL_MS = 2000
const POLL_LIMIT = 20

/**
 * Where Stripe sends the customer after paying.
 *
 * This page never confirms anything itself: it asks the server for the
 * order's status. The server trusts only the Stripe webhook, or Stripe's own
 * API queried with the secret key.
 */
export function BookSuccess() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const polls = useRef(0)

  useEffect(() => {
    if (!sessionId) {
      setState({ loading: false, data: null, error: 'Missing booking details.' })
      return
    }
    let timer
    let active = true

    const check = async () => {
      try {
        const data = await callBooking('status', { session_id: sessionId })
        if (!active) return
        setState({ loading: false, data, error: null })
        if (data.status === 'pending' && polls.current++ < POLL_LIMIT) {
          timer = setTimeout(check, POLL_MS)
        }
      } catch (err) {
        if (active) setState({ loading: false, data: null, error: err.message })
      }
    }
    check()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [sessionId])

  const { loading, data, error } = state

  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl">
        {loading ? (
          <Centered>
            <Spinner className="h-6 w-6" />
            <p className="mt-3 text-sm text-fg-muted">Checking your payment…</p>
          </Centered>
        ) : error ? (
          <Panel>
            <h1 className="text-lg font-semibold">We couldn't find that booking</h1>
            <p className="mt-2 text-sm text-fg-muted">{error}</p>
            <p className="mt-2 text-sm text-fg-muted">
              If you've paid, don't worry — check your email (including your
              spam or junk folder) for a confirmation, or contact us at
              info@sdkdrivingschool.com.
            </p>
          </Panel>
        ) : data.status === 'pending' ? (
          <Panel>
            <h1 className="text-lg font-semibold">Payment processing</h1>
            <p className="mt-2 text-sm text-fg-muted">
              We're still waiting for confirmation from the payment provider.
              You'll receive an email as soon as it clears — you can close this
              page.
            </p>
            <CheckSpamNote className="mt-3" />
          </Panel>
        ) : data.status !== 'paid' ? (
          <Panel>
            <h1 className="text-lg font-semibold">This booking wasn't completed</h1>
            <p className="mt-2 text-sm text-fg-muted">
              The payment didn't go through, so no time was reserved.
            </p>
            <Link to="/book">
              <Button variant="primary" className="mt-4">
                Start again
              </Button>
            </Link>
          </Panel>
        ) : (
          <Confirmed data={data} />
        )}
      </div>
    </PublicLayout>
  )
}

function Confirmed({ data }) {
  const b = data.booking
  const lessonOk = b && b.status === 'confirmed'
  return (
    <Panel>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
        ✓
      </div>
      <h1 className="text-xl font-semibold">Thank you — payment received</h1>

      {data.needs_attention || !lessonOk ? (
        <div className="mt-3">
          <Notice tone="warning">
            Your payment went through, but the time you picked was taken just
            before it cleared. Your hours are safe on your account — we'll
            contact you to arrange a new time, or you can choose one yourself
            on <Link to="/my-lessons" className="underline">My lessons</Link>.
          </Notice>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-muted">Your lesson time is reserved:</p>
          <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3 ring-1 ring-line">
            <div className="text-sm font-semibold">
              {format(zoned(b.start_time), 'EEEE d MMMM')}
            </div>
            <div className="tabular text-sm text-fg-muted">
              {fmtRange(zoned(b.start_time), zoned(b.end_time))} ·{' '}
              {durationLabel((new Date(b.end_time) - new Date(b.start_time)) / 60000)}
            </div>
          </div>
          <p className="mt-4 text-sm">
            <strong>Your instructor will be confirmed shortly.</strong>{' '}
            <span className="text-fg-muted">
              We'll email you at {data.email} as soon as they are.
            </span>
          </p>
        </>
      )}

      <div className="mt-5 rounded-lg border border-dashed border-line-strong px-4 py-3">
        <div className="text-xs text-fg-muted">Your booking reference</div>
        <div className="tabular text-lg font-bold tracking-wide">{data.reg_number}</div>
        <div className="mt-1 text-xs text-fg-subtle">
          Keep this — with your email it lets you see your lessons
          {data.category === 'block' ? ' and book the rest of your package' : ''}.
        </div>
      </div>

      <CheckSpamNote className="mt-4" />

      {data.category === 'block' && (
        <Link to="/my-lessons">
          <Button variant="primary" className="mt-5">
            Book my next lesson
          </Button>
        </Link>
      )}
    </Panel>
  )
}

/**
 * Stripe's "back" link. Frees the held time straight away rather than making
 * everyone else wait for the hold to lapse.
 */
export function BookCancelled() {
  const [params] = useSearchParams()
  const orderId = params.get('order')
  const [done, setDone] = useState(false)
  const sent = useRef(false)

  useEffect(() => {
    if (!orderId || sent.current) {
      setDone(true)
      return
    }
    sent.current = true
    callBooking('release', { order_id: orderId })
      .catch(() => {})
      .finally(() => setDone(true))
  }, [orderId])

  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl">
        <Panel>
          <h1 className="text-lg font-semibold">Payment cancelled</h1>
          <p className="mt-2 text-sm text-fg-muted">
            No money has been taken and the time you picked has been released.
            You can start again whenever you're ready.
          </p>
          <Link to="/book">
            <Button variant="primary" className="mt-4" disabled={!done}>
              {!done && <Spinner />}
              Back to booking
            </Button>
          </Link>
        </Panel>
      </div>
    </PublicLayout>
  )
}

function Centered({ children }) {
  return (
    <div className="flex h-[40dvh] flex-col items-center justify-center text-fg-subtle">
      {children}
    </div>
  )
}

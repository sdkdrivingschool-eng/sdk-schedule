import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import { Button, ErrorNote, Field, Spinner, inputClass } from '../../components/ui'
import { durationLabel, fmtRange, nowZoned, toDateInput, zoned } from '../../lib/schedule'
import {
  callBooking,
  fetchBookingSettings,
  fetchPackages,
  formatPrice,
  remember,
} from '../../lib/publicApi'
import { CheckSpamNote, Notice, Panel, PublicLayout } from './PublicLayout'
import { SlotPicker } from './SlotPicker'
import { ContactFields, EMPTY_CONTACT, validateContact } from './ContactFields'

const LENGTHS = [60, 90, 120, 150]
const CONTACT_KEY = 'sdk-book-contact'

const CATEGORY_TITLES = {
  single: 'Single lessons',
  block: 'Packages',
  intensive: 'Intensive courses',
}

/**
 * Public booking page.
 *
 *   plans -> time -> details -> review -> Stripe        (lessons, packages)
 *   plans -> intensive request                           (intensive courses)
 *
 * `?plan=<slug>` deep-links straight to a plan, so each "Book" button on the
 * WordPress site can point at its own plan.
 */
export default function Book() {
  const [params, setParams] = useSearchParams()
  const planSlug = params.get('plan')

  const [packages, setPackages] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [area, setArea] = useState('standard')
  const [step, setStep] = useState('plans')
  const [minutes, setMinutes] = useState(120)
  const [start, setStart] = useState(null)
  const [contact, setContact] = useState(() => ({
    ...EMPTY_CONTACT,
    ...(remember.get(CONTACT_KEY) ?? {}),
    consent: false,
    company: '',
  }))
  const [contactErrors, setContactErrors] = useState({})
  const [startDate, setStartDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [timeError, setTimeError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [requestDone, setRequestDone] = useState(null)

  useEffect(() => {
    Promise.all([fetchPackages(), fetchBookingSettings()])
      .then(([pkgs, s]) => {
        setPackages(pkgs)
        setSettings(s)
      })
      .catch((err) => {
        console.error(err)
        setLoadError("We couldn't load our prices. Please refresh the page.")
      })
      .finally(() => setLoading(false))
  }, [])

  const plan = useMemo(
    () => packages.find((p) => p.slug === planSlug) ?? null,
    [packages, planSlug],
  )

  // Arriving with ?plan=… (or picking a card) jumps into that plan's flow.
  useEffect(() => {
    if (!plan) {
      setStep('plans')
      return
    }
    if (plan.area !== 'any') setArea(plan.area)
    setStart(null)
    setSubmitError(null)
    setTimeError(null)
    setRequestDone(null)
    if (plan.category === 'single') setMinutes(plan.lesson_minutes)
    if (plan.category === 'block') setMinutes((m) => Math.min(m || 120, plan.total_minutes))
    setStep(plan.category === 'intensive' ? 'intensive' : 'time')
  }, [plan])

  const choosePlan = useCallback(
    (slug) => {
      const next = new URLSearchParams(params)
      if (slug) next.set('plan', slug)
      else next.delete('plan')
      setParams(next)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [params, setParams],
  )

  const saveContact = (next) => {
    setContact(next)
    const { consent: _c, company: _h, ...keep } = next
    remember.set(CONTACT_KEY, keep)
  }

  function goToReview() {
    const errors = validateContact(contact)
    setContactErrors(errors)
    if (Object.keys(errors).length === 0) setStep('review')
  }

  async function pay() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { url } = await callBooking('checkout', {
        plan: plan.slug,
        start,
        minutes: plan.category === 'block' ? minutes : null,
        area,
        ...contact,
      })
      window.location.assign(url)
    } catch (err) {
      setSubmitting(false)
      if (err.code === 'SLOT_FULL' || err.code === 'INVALID_TIME') {
        setStart(null)
        setRefreshKey((k) => k + 1)
        setTimeError(err.message)
        setStep('time')
        return
      }
      setSubmitError(err.message)
    }
  }

  async function requestIntensive() {
    const errors = validateContact(contact)
    if (!startDate) errors.startDate = 'Please choose a preferred start date.'
    setContactErrors(errors)
    if (Object.keys(errors).length) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await callBooking('intensive', {
        plan: plan.slug,
        start_date: startDate,
        area,
        ...contact,
      })
      setRequestDone(res)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <PublicLayout>
        <div className="flex h-[50dvh] items-center justify-center text-fg-subtle">
          <Spinner className="h-6 w-6" />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      {loadError && <ErrorNote>{loadError}</ErrorNote>}

      {planSlug && !plan && !loadError && (
        <div className="mb-4">
          <Notice tone="warning">
            That plan isn't available any more — please choose one below.
          </Notice>
        </div>
      )}

      {step === 'plans' || !plan ? (
        <Plans packages={packages} area={area} onArea={setArea} onChoose={choosePlan} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          <button
            type="button"
            onClick={() => choosePlan(null)}
            className="text-sm text-fg-muted transition-colors hover:text-fg"
          >
            ← All plans
          </button>

          <PlanSummary plan={plan} />

          {step === 'time' && (
            <Panel>
              <StepTitle n={1} of={3}>Choose a time</StepTitle>
              {plan.category === 'block' && (
                <div className="mb-5">
                  <p className="mb-2 text-sm text-fg-muted">
                    How long should your first lesson be? It comes off your{' '}
                    {durationLabel(plan.total_minutes)}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {LENGTHS.filter((m) => m <= plan.total_minutes).map((m) => (
                      <Chip
                        key={m}
                        active={minutes === m}
                        onClick={() => {
                          setMinutes(m)
                          setStart(null)
                        }}
                      >
                        {durationLabel(m)}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {timeError && (
                <div className="mb-4">
                  <ErrorNote>{timeError}</ErrorNote>
                </div>
              )}
              <SlotPicker
                minutes={minutes}
                value={start}
                onChange={(iso) => {
                  setStart(iso)
                  setTimeError(null)
                }}
                horizonDays={settings?.horizon_days ?? 56}
                refreshKey={refreshKey}
              />
              <div className="mt-5 flex justify-end">
                <Button variant="primary" disabled={!start} onClick={() => setStep('details')}>
                  Continue
                </Button>
              </div>
            </Panel>
          )}

          {step === 'details' && (
            <Panel>
              <StepTitle n={2} of={3}>Your details</StepTitle>
              <AreaNote area={area} />
              <ContactFields value={contact} onChange={saveContact} errors={contactErrors} />
              <div className="mt-5 flex justify-between gap-2">
                <Button onClick={() => setStep('time')}>Back</Button>
                <Button variant="primary" onClick={goToReview}>
                  Continue
                </Button>
              </div>
            </Panel>
          )}

          {step === 'review' && (
            <Panel>
              <StepTitle n={3} of={3}>Check and pay</StepTitle>
              <dl className="space-y-2 text-sm">
                <Row label="Plan">{plan.name}</Row>
                <Row label="Lesson">
                  {format(zoned(start), 'EEEE d MMMM')},{' '}
                  {fmtRange(zoned(start), zoned(new Date(new Date(start).getTime() + minutes * 60000)))}{' '}
                  <span className="text-fg-muted">({durationLabel(minutes)})</span>
                </Row>
                {plan.category === 'block' && (
                  <Row label="Hours left after">
                    {durationLabel(plan.total_minutes - minutes)} to book whenever suits you
                  </Row>
                )}
                <Row label="Name">{contact.name}</Row>
                <Row label="Phone">{contact.phone}</Row>
                <Row label="Email">{contact.email}</Row>
                <Row label="Pickup">
                  {contact.pickup_address}, {contact.postcode.toUpperCase()}
                </Row>
                <Row label="Total">
                  <span className="text-base font-semibold">{formatPrice(plan.price_pence)}</span>
                </Row>
              </dl>

              {settings?.test_payments && (
                <div className="mt-4">
                  <Notice tone="warning">
                    <strong>Test mode:</strong> no card is needed. Pressing Pay
                    books the lesson as if it had been paid, unless a Stripe
                    key has been set up, in which case real Stripe is used.
                  </Notice>
                </div>
              )}

              <div className="mt-4">
                <Notice>
                  Your time is held while you pay. Once payment clears you'll get
                  an email with your booking reference, and another as soon as
                  your instructor is confirmed.
                </Notice>
                <CheckSpamNote className="mt-2" />
              </div>

              {submitError && (
                <div className="mt-4">
                  <ErrorNote>{submitError}</ErrorNote>
                </div>
              )}

              <div className="mt-5 flex justify-between gap-2">
                <Button onClick={() => setStep('details')} disabled={submitting}>
                  Back
                </Button>
                <Button variant="primary" onClick={pay} disabled={submitting}>
                  {submitting && <Spinner />}
                  Pay {formatPrice(plan.price_pence)} securely
                </Button>
              </div>
            </Panel>
          )}

          {step === 'intensive' &&
            (requestDone ? (
              <Panel>
                <h2 className="text-lg font-semibold">Request sent — thank you!</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  We'll call you shortly to arrange your course dates. We've
                  emailed you a copy. No payment has been taken.
                </p>
                <p className="mt-4 text-sm">
                  Your reference:{' '}
                  <span className="tabular font-semibold">{requestDone.reg_number}</span>
                </p>
                <CheckSpamNote className="mt-4" />
              </Panel>
            ) : (
              <Panel>
                <StepTitle>Request this course</StepTitle>
                <p className="mb-4 text-sm text-fg-muted">
                  Intensive courses run on consecutive days, so we arrange the
                  dates with you by phone. Tell us when you'd like to start.
                </p>
                <AreaPicker area={area} onArea={setArea} />
                <div className="mb-4">
                  <Field label="Preferred start date" error={contactErrors.startDate}>
                    <input
                      type="date"
                      className={inputClass}
                      value={startDate}
                      min={toDateInput(addDays(nowZoned(), 2))}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </Field>
                </div>
                <ContactFields value={contact} onChange={saveContact} errors={contactErrors} />
                {submitError && (
                  <div className="mt-4">
                    <ErrorNote>{submitError}</ErrorNote>
                  </div>
                )}
                <div className="mt-5 flex justify-end">
                  <Button variant="primary" onClick={requestIntensive} disabled={submitting}>
                    {submitting && <Spinner />}
                    Send request
                  </Button>
                </div>
              </Panel>
            ))}
        </div>
      )}
    </PublicLayout>
  )
}

// ---------------------------------------------------------------------------

function Plans({ packages, area, onArea, onChoose }) {
  const visible = packages.filter((p) => p.area === 'any' || p.area === area)
  const groups = ['single', 'block', 'intensive']
    .map((category) => ({
      category,
      items: visible.filter((p) => p.category === category),
    }))
    .filter((g) => g.items.length)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Book a driving lesson</h1>
        <p className="mt-2 max-w-xl text-sm text-fg-muted">
          Choose a plan, pick a time that suits you and pay securely online.
          We'll confirm your instructor by email.
        </p>
      </div>

      <AreaPicker area={area} onArea={onArea} />

      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase">
            {CATEGORY_TITLES[g.category]}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((p) => (
              <PlanCard key={p.slug} plan={p} onChoose={() => onChoose(p.slug)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function AreaPicker({ area, onArea }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium text-fg-muted">Where are you based?</p>
      <div className="flex gap-2">
        <Chip active={area === 'standard'} onClick={() => onArea('standard')}>
          Outside Surrey
        </Chip>
        <Chip active={area === 'surrey'} onClick={() => onArea('surrey')}>
          Surrey
        </Chip>
      </div>
    </div>
  )
}

function AreaNote({ area }) {
  return (
    <p className="mb-4 text-xs text-fg-subtle">
      Area: {area === 'surrey' ? 'Surrey' : 'Outside Surrey'} (from the plan you chose).
    </p>
  )
}

function PlanCard({ plan, onChoose }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 transition-colors duration-150 hover:border-line-strong">
      <h3 className="text-base font-semibold">{plan.name}</h3>
      <div className="mt-2 flex items-baseline gap-2">
        {plan.was_price_pence && (
          <span className="text-sm text-fg-subtle line-through">
            {formatPrice(plan.was_price_pence)}
          </span>
        )}
        <span className="text-2xl font-bold">{formatPrice(plan.price_pence)}</span>
      </div>
      {plan.was_price_pence && (
        <span className="mt-1 w-fit rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
          Save {formatPrice(plan.was_price_pence - plan.price_pence)}
        </span>
      )}
      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-fg-muted">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-emerald-400">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <Button variant="primary" className="mt-5 w-full" onClick={onChoose}>
        {plan.category === 'intensive' ? 'Request course' : 'Book lesson'}
      </Button>
    </div>
  )
}

function PlanSummary({ plan }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
      <div>
        <div className="text-sm font-semibold">{plan.name}</div>
        <div className="text-xs text-fg-muted">
          {plan.category === 'single' && `${durationLabel(plan.lesson_minutes)} lesson`}
          {plan.category === 'block' && `${durationLabel(plan.total_minutes)} of lessons`}
          {plan.category === 'intensive' &&
            `${plan.course_lessons} lessons · ${durationLabel(plan.total_minutes)}`}
        </div>
      </div>
      <div className="text-right">
        {plan.was_price_pence && (
          <div className="text-xs text-fg-subtle line-through">
            {formatPrice(plan.was_price_pence)}
          </div>
        )}
        <div className="text-lg font-bold">{formatPrice(plan.price_pence)}</div>
      </div>
    </div>
  )
}

function StepTitle({ n, of, children }) {
  return (
    <h2 className="mb-4 flex items-baseline gap-2 text-lg font-semibold">
      {n && (
        <span className="text-xs font-medium text-fg-subtle">
          Step {n} of {of}
        </span>
      )}
      {children}
    </h2>
  )
}

function Chip({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-150 active:scale-95 ${
        active
          ? 'bg-accent text-black'
          : 'bg-surface-2 text-fg-muted ring-1 ring-line hover:text-fg hover:ring-line-strong'
      }`}
      {...props}
    >
      {children}
    </button>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

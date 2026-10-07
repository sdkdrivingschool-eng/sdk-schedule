import { useCallback, useEffect, useState } from 'react'
import { StaffPage, StaffShell } from '../components/StaffShell'
import { Button, ErrorNote, Field, Spinner, inputClass } from '../components/ui'
import { durationLabel } from '../lib/schedule'
import {
  describeWriteError,
  fetchAllPackages,
  fetchSettings,
  updatePackage,
  updateSettings,
} from '../lib/api'

const CATEGORY = { single: 'Single lesson', block: 'Package', intensive: 'Intensive' }
const AREA = { standard: 'London', surrey: 'Surrey', any: 'Any area' }

const toPounds = (pence) => (pence == null ? '' : (pence / 100).toFixed(2).replace(/\.00$/, ''))
const toPence = (pounds) => {
  const n = Math.round(Number(String(pounds).replace(/[£,\s]/g, '')) * 100)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Prices and booking rules. Price changes apply to new bookings only —
 * existing orders keep the price they were paid at.
 */
export default function Packages() {
  return (
    <StaffShell>
      <PackagesScreen />
    </StaffShell>
  )
}

function PackagesScreen() {
  const [packages, setPackages] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [pkgs, s] = await Promise.all([fetchAllPackages(), fetchSettings()])
      setPackages(pkgs)
      setSettings(s)
    } catch (err) {
      setError(describeWriteError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <StaffPage
      title="Prices & settings"
      subtitle="Changes apply to new online bookings straight away. Existing bookings keep the price they paid."
    >
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-fg-subtle">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-8">
          {settings && <SettingsForm settings={settings} onSaved={load} />}

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase">
              Plans
            </h2>
            <div className="space-y-2">
              {packages.map((p) => (
                <PackageRow key={p.id} pkg={p} onSaved={load} />
              ))}
            </div>
          </section>
        </div>
      )}
    </StaffPage>
  )
}

function SettingsForm({ settings, onSaved }) {
  const [form, setForm] = useState({
    min_notice_hours: settings.min_notice_hours,
    horizon_days: settings.horizon_days,
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  async function save() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await updateSettings({
        min_notice_hours: Number(form.min_notice_hours),
        horizon_days: Number(form.horizon_days),
      })
      setMessage('Saved.')
      onSaved()
    } catch (err) {
      setError(describeWriteError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl bg-surface p-4 ring-1 ring-line">
      <h2 className="mb-3 text-sm font-semibold text-fg">Online booking rules</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum notice (hours)" hint="How soon a customer can book, e.g. 24 = not before this time tomorrow.">
          <input
            type="number"
            min="0"
            max="336"
            className={inputClass}
            value={form.min_notice_hours}
            onChange={(e) => setForm({ ...form, min_notice_hours: e.target.value })}
          />
        </Field>
        <Field label="Book up to (days ahead)" hint="How far into the future customers can book.">
          <input
            type="number"
            min="1"
            max="365"
            className={inputClass}
            value={form.horizon_days}
            onChange={(e) => setForm({ ...form, horizon_days: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {message && <span className="text-xs text-emerald-300">{message}</span>}
        <ErrorNote>{error}</ErrorNote>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy && <Spinner />}
          Save rules
        </Button>
      </div>
    </section>
  )
}

function PackageRow({ pkg, onSaved }) {
  const [price, setPrice] = useState(toPounds(pkg.price_pence))
  const [was, setWas] = useState(toPounds(pkg.was_price_pence))
  const [features, setFeatures] = useState(pkg.features.join('\n'))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const size =
    pkg.category === 'single'
      ? durationLabel(pkg.lesson_minutes)
      : `${durationLabel(pkg.total_minutes)}${pkg.course_lessons ? ` · ${pkg.course_lessons} lessons` : ''}`

  async function run(patch) {
    setBusy(true)
    setError(null)
    try {
      await updatePackage(pkg.id, patch)
      onSaved()
      setOpen(false)
    } catch (err) {
      setError(describeWriteError(err))
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const pricePence = toPence(price)
    if (!pricePence) {
      setError('Enter a price in pounds, e.g. 80')
      return
    }
    const wasPence = was.trim() ? toPence(was) : null
    if (was.trim() && (!wasPence || wasPence <= pricePence)) {
      setError('The "was" price must be higher than the price, or left empty.')
      return
    }
    run({
      price_pence: pricePence,
      was_price_pence: wasPence,
      features: features.split('\n').map((f) => f.trim()).filter(Boolean),
    })
  }

  return (
    <div className={`rounded-xl bg-surface ring-1 ring-line ${pkg.is_active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{pkg.name}</span>
            {!pkg.is_active && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted ring-1 ring-line">
                Hidden
              </span>
            )}
          </div>
          <div className="text-xs text-fg-muted">
            {CATEGORY[pkg.category]} · {size} · {AREA[pkg.area]} ·{' '}
            <span className="tabular">/book?plan={pkg.slug}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right">
            {pkg.was_price_pence && (
              <span className="mr-1.5 text-xs text-fg-subtle line-through">
                £{toPounds(pkg.was_price_pence)}
              </span>
            )}
            <span className="text-base font-bold text-fg">£{toPounds(pkg.price_pence)}</span>
          </span>
          <Button onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit'}</Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Price (£)">
              <input className={inputClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Was price (£, optional)" hint="Shown struck through with a 'Save £…' badge.">
              <input className={inputClass} inputMode="decimal" value={was} onChange={(e) => setWas(e.target.value)} />
            </Field>
          </div>
          <Field label="Bullet points (one per line)">
            <textarea
              className={`${inputClass} min-h-20`}
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex flex-wrap justify-between gap-2">
            <Button onClick={() => run({ is_active: !pkg.is_active })} disabled={busy}>
              {pkg.is_active ? 'Hide from booking page' : 'Show on booking page'}
            </Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy && <Spinner />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

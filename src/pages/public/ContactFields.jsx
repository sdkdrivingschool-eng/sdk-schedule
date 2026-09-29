import { Field, inputClass } from '../../components/ui'

export const EMPTY_CONTACT = {
  name: '',
  email: '',
  phone: '',
  pickup_address: '',
  postcode: '',
  notes: '',
  consent: false,
  company: '', // honeypot — hidden from people, bots fill it in
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[+()\d\s-]{7,20}$/
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i

/** Same rules the booking function enforces, checked early for quick feedback. */
export function validateContact(c) {
  const errors = {}
  if (!c.name.trim()) errors.name = 'Please enter your name.'
  if (!EMAIL_RE.test(c.email.trim())) errors.email = 'Please enter a valid email address.'
  if (!PHONE_RE.test(c.phone.trim())) errors.phone = 'Please enter a valid phone number.'
  if (!c.pickup_address.trim()) errors.pickup_address = 'Where should the instructor pick you up?'
  if (!POSTCODE_RE.test(c.postcode.trim())) errors.postcode = 'Please enter a valid UK postcode.'
  if (!c.consent) errors.consent = 'Please tick this so we can arrange your lessons.'
  return errors
}

export function ContactFields({ value, onChange, errors = {} }) {
  const set = (key) => (e) =>
    onChange({
      ...value,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name}>
          <input className={inputClass} value={value.name} onChange={set('name')} autoComplete="name" />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <input
            className={inputClass}
            value={value.phone}
            onChange={set('phone')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
          />
        </Field>
      </div>

      <Field
        label="Email"
        hint="We'll send your confirmation and booking reference here. If it doesn't arrive, check your spam folder."
        error={errors.email}
      >
        <input
          className={inputClass}
          value={value.email}
          onChange={set('email')}
          type="email"
          autoComplete="email"
          inputMode="email"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Pickup address" error={errors.pickup_address}>
          <input
            className={inputClass}
            value={value.pickup_address}
            onChange={set('pickup_address')}
            autoComplete="street-address"
          />
        </Field>
        <Field label="Postcode" error={errors.postcode}>
          <input
            className={`${inputClass} uppercase`}
            value={value.postcode}
            onChange={set('postcode')}
            autoComplete="postal-code"
          />
        </Field>
      </div>

      <Field label="Anything we should know? (optional)" hint="e.g. test date, experience so far, best time to call.">
        <textarea
          className={`${inputClass} min-h-20`}
          value={value.notes}
          onChange={set('notes')}
          maxLength={1000}
        />
      </Field>

      {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input tabIndex={-1} autoComplete="off" value={value.company} onChange={set('company')} />
        </label>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={value.consent}
          onChange={set('consent')}
          className="mt-0.5 h-4 w-4 shrink-0 accent-white"
        />
        <span>
          I agree to SDK Driving School storing these details to arrange my
          lessons and contact me about them.
          {errors.consent && <span className="mt-1 block text-xs text-red-400">{errors.consent}</span>}
        </span>
      </label>
    </div>
  )
}

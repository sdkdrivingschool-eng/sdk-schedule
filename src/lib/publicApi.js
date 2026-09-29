import { supabase } from './supabase'

/**
 * Data access for the public, no-login customer pages.
 *
 * The anon key can only read active packages and booking settings and ask for
 * free start times. Everything that writes (holding a time, paying, booking
 * from a balance) goes through the `booking` Edge Function, which re-checks it
 * all server-side — nothing sent from here is trusted.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export async function fetchPackages() {
  const { data, error } = await supabase
    .from('packages')
    .select(
      'id, slug, name, category, area, lesson_minutes, total_minutes, course_lessons, price_pence, was_price_pence, features, sort_order',
    )
    .eq('is_active', true)
    .order('sort_order')

  if (error) throw error
  return data ?? []
}

export async function fetchBookingSettings() {
  const { data, error } = await supabase
    .from('booking_settings')
    .select('min_notice_hours, horizon_days, slot_step_minutes, test_payments')
    .maybeSingle()

  if (error) throw error
  return data ?? { min_notice_hours: 24, horizon_days: 56, slot_step_minutes: 30 }
}

/** Dates (yyyy-MM-dd) in [from, to] with at least one free start time. */
export async function fetchAvailableDays(from, to, minutes) {
  const { data, error } = await supabase.rpc('get_available_days', {
    p_from: from,
    p_to: to,
    p_minutes: minutes,
  })
  if (error) throw error
  return (data ?? []).map((r) => r.day)
}

/** Free start times (ISO strings) on one London date. */
export async function fetchAvailableSlots(date, minutes) {
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_date: date,
    p_minutes: minutes,
  })
  if (error) throw error
  return (data ?? []).map((r) => r.slot_start)
}

export class BookingError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** POST to the booking Edge Function. Throws BookingError with friendly text. */
export async function callBooking(action, payload = {}) {
  let res
  try {
    res = await fetch(`${FUNCTIONS_URL}/booking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, ...payload }),
    })
  } catch {
    throw new BookingError(
      "We couldn't reach the booking system. Check your connection and try again.",
    )
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new BookingError(
      data.error ?? 'Something went wrong. Please try again or call us.',
      { status: res.status, code: data.code },
    )
  }
  return data
}

export const formatPrice = (pence) =>
  `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: pence % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`

/** sessionStorage wrapper — never throws (private mode, blocked storage). */
export const remember = {
  get(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? 'null')
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable — the form still works, it just won't prefill */
    }
  },
}

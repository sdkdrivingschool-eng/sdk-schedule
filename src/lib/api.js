import { supabase } from './supabase'
import { rangesOverlap } from './schedule'

/**
 * Data access for the schedule.
 *
 * Conflict handling is deliberately two-layered:
 *
 *  1. `findConflict` runs before an insert so the user gets a specific,
 *     readable message naming what clashes.
 *  2. The database enforces the same rule via exclusion constraints and a
 *     trigger. Two people submitting at the same instant both pass step 1,
 *     and only one survives step 2 — `describeWriteError` turns that raw
 *     Postgres error back into the same readable message.
 *
 * Dropping either layer gives you silent double-bookings or ugly errors.
 */

const CONFLICT_CODES = new Set([
  '23P01', // exclusion_violation — same-table overlap, or our trigger
  'P0001', // raise_exception fallback
])

export function describeWriteError(error) {
  if (!error) return null

  const text = `${error.message ?? ''} ${error.details ?? ''}`

  if (CONFLICT_CODES.has(error.code) || text.includes('SCHEDULE_CONFLICT')) {
    if (text.includes('marked unavailable')) {
      return 'That instructor is marked unavailable during this time.'
    }
    if (text.includes('confirmed lesson')) {
      return 'That instructor already has a lesson during this time.'
    }
    if (text.includes('availability_no_overlap')) {
      return 'That overlaps an existing unavailable block for this instructor.'
    }
    if (text.includes('bookings_no_overlap')) {
      return 'That overlaps an existing lesson for this instructor.'
    }
    return 'That time conflicts with something already in the schedule.'
  }

  // Codes raised by the online-booking database functions.
  if (text.includes('INSTRUCTOR_BUSY')) {
    return 'That instructor is no longer free at this time. Pick another.'
  }
  if (text.includes('NOT_CONFIRMED')) {
    return 'Only paid, confirmed lessons can be assigned.'
  }
  if (text.includes('NOT_AN_INSTRUCTOR')) {
    return 'Lessons can only be assigned to instructors.'
  }

  // RLS rejection surfaces as an empty result or a 42501.
  if (error.code === '42501' || text.includes('row-level security')) {
    return "You don't have permission to change this."
  }

  if (error.code === '23514') {
    return 'Those values are not valid — check the times and try again.'
  }

  return error.message ?? 'Something went wrong. Please try again.'
}

export async function fetchUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role')
    .order('role')
    .order('name')

  if (error) throw error
  return data ?? []
}

/**
 * Everything overlapping [from, to) — all instructors, since every user can
 * see every schedule.
 *
 * The range test is `start < to AND end > from` rather than a simple BETWEEN,
 * so a block that begins before the window and runs into it is still returned.
 */
export async function fetchSchedule({ from, to }) {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  const [bookingsRes, blocksRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('*')
      .lt('start_time', toIso)
      .gt('end_time', fromIso)
      .order('start_time'),
    supabase
      .from('availability_blocks')
      .select('*')
      .lt('start_time', toIso)
      .gt('end_time', fromIso)
      .order('start_time'),
  ])

  if (bookingsRes.error) throw bookingsRes.error
  if (blocksRes.error) throw blocksRes.error

  return {
    bookings: bookingsRes.data ?? [],
    blocks: blocksRes.data ?? [],
  }
}

/**
 * Look for anything already occupying this instructor's time.
 *
 * `ignoreId` lets an edit skip its own row — otherwise every edit would
 * report a conflict with itself.
 */
export async function findConflict({
  instructorId,
  start,
  end,
  ignoreBookingId = null,
  ignoreBlockId = null,
}) {
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  let bookingQuery = supabase
    .from('bookings')
    .select('id, student_name, start_time, end_time')
    .eq('instructor_id', instructorId)
    .eq('status', 'confirmed')
    .lt('start_time', endIso)
    .gt('end_time', startIso)

  if (ignoreBookingId) bookingQuery = bookingQuery.neq('id', ignoreBookingId)

  let blockQuery = supabase
    .from('availability_blocks')
    .select('id, reason, start_time, end_time')
    .eq('instructor_id', instructorId)
    .lt('start_time', endIso)
    .gt('end_time', startIso)

  if (ignoreBlockId) blockQuery = blockQuery.neq('id', ignoreBlockId)

  const [bookingRes, blockRes] = await Promise.all([bookingQuery, blockQuery])

  if (bookingRes.error) throw bookingRes.error
  if (blockRes.error) throw blockRes.error

  const clashingBooking = bookingRes.data?.[0]
  if (clashingBooking) {
    return {
      kind: 'booking',
      row: clashingBooking,
      message: `Conflicts with a lesson for ${clashingBooking.student_name}.`,
    }
  }

  const clashingBlock = blockRes.data?.[0]
  if (clashingBlock) {
    return {
      kind: 'unavailable',
      row: clashingBlock,
      message: `Instructor is marked unavailable (${clashingBlock.reason}).`,
    }
  }

  return null
}

export async function createBooking(payload) {
  const { data, error } = await supabase
    .from('bookings')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBooking(id, patch) {
  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  // Moving or cancelling an online lesson queues a customer email.
  if (data?.source === 'online') kickEmails()
  return data
}

export async function cancelBooking(id) {
  return updateBooking(id, { status: 'cancelled' })
}

// ---------------------------------------------------------------------------
// Online bookings: assignment, customers, packages, intensive requests.
// ---------------------------------------------------------------------------

/**
 * Nudge the process-emails function so an email queued by the change we just
 * made (lesson confirmed, instructor changed, lesson cancelled...) goes out
 * now rather than on the next two-minute cron sweep. Fire and forget.
 */
export function kickEmails() {
  fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-emails`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: '{}',
  }).catch(() => {})
}

/** Paid lessons (and payment holds) with no instructor yet. Admin only. */
export async function fetchUnassigned() {
  const { data, error } = await supabase.rpc('admin_unassigned_bookings')
  if (error) throw error
  return data ?? []
}

export async function fetchUnassignedCount() {
  const { count, error } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .is('instructor_id', null)
    .eq('status', 'confirmed')
    .gt('end_time', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/** Instructors free for exactly this lesson's time. */
export async function fetchFreeInstructors(bookingId) {
  const { data, error } = await supabase.rpc('free_instructors_for_booking', {
    p_booking_id: bookingId,
  })
  if (error) throw error
  return data ?? []
}

/**
 * Assign or reassign. The database re-checks the instructor is free under
 * the schedule lock and queues the customer's email in the same transaction.
 */
export async function assignBooking(bookingId, instructorId) {
  const { error } = await supabase.rpc('assign_booking', {
    p_booking_id: bookingId,
    p_instructor_id: instructorId,
  })
  if (error) throw error
  kickEmails()
}

/** Customer, order and remaining hours behind an online booking. */
export async function fetchOnlineDetails(booking) {
  const [customerRes, orderRes, leftRes] = await Promise.all([
    booking.customer_id
      ? supabase
          .from('customers')
          .select('reg_number, name, email, phone, pickup_address, postcode, area')
          .eq('id', booking.customer_id)
          .maybeSingle()
      : { data: null },
    booking.order_id
      ? supabase
          .from('orders')
          .select('package_name, category, minutes_total, amount_pence, status, paid_at, attention_reason')
          .eq('id', booking.order_id)
          .maybeSingle()
      : { data: null },
    booking.order_id
      ? supabase.rpc('order_minutes_remaining', { p_order_id: booking.order_id })
      : { data: null },
  ])
  return {
    customer: customerRes.data ?? null,
    order: orderRes.data ?? null,
    remaining: typeof leftRes.data === 'number' ? leftRes.data : null,
  }
}

/** Latest customer email per booking, for the "was it sent?" indicator. */
export async function fetchEmailStatus(bookingIds) {
  if (!bookingIds.length) return {}
  const { data, error } = await supabase
    .from('email_outbox')
    .select('id, booking_id, kind, status, last_error, created_at')
    .in('booking_id', bookingIds)
    .not('kind', 'like', 'admin_%')
    .order('created_at', { ascending: false })
  if (error) throw error
  const latest = {}
  for (const row of data ?? []) latest[row.booking_id] ??= row
  return latest
}

export async function resendEmail(id) {
  const { error } = await supabase
    .from('email_outbox')
    .update({ status: 'pending', attempts: 0, last_error: null })
    .eq('id', id)
  if (error) throw error
  kickEmails()
}

/** Paid orders an admin needs to look at (e.g. payment landed after the slot went). */
export async function fetchAttentionOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, package_name, amount_pence, paid_at, attention_reason, customers(name, phone, email, reg_number)')
    .not('attention_reason', 'is', null)
    .order('paid_at')
  if (error) throw error
  return data ?? []
}

export async function clearAttention(orderId) {
  const { error } = await supabase
    .from('orders')
    .update({ attention_reason: null })
    .eq('id', orderId)
  if (error) throw error
}

export async function fetchIntensiveRequests() {
  const { data, error } = await supabase
    .from('intensive_requests')
    .select('*, customers(name, email, phone, reg_number)')
    .order('status')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateIntensiveRequest(id, patch) {
  const { error } = await supabase.from('intensive_requests').update(patch).eq('id', id)
  if (error) throw error
}

export async function fetchAllPackages() {
  const { data, error } = await supabase.from('packages').select('*').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function updatePackage(id, patch) {
  const { error } = await supabase
    .from('packages')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function fetchSettings() {
  const { data, error } = await supabase.from('booking_settings').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function updateSettings(patch) {
  const { error } = await supabase
    .from('booking_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) throw error
}


export async function deleteBooking(id) {
  const { error } = await supabase.from('bookings').delete().eq('id', id)
  if (error) throw error
}

export async function createBlock(payload) {
  const { data, error } = await supabase
    .from('availability_blocks')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBlock(id, patch) {
  const { data, error } = await supabase
    .from('availability_blocks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBlock(id) {
  const { error } = await supabase
    .from('availability_blocks')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/** Client-side mirror of findConflict, for already-loaded rows. */
export function localConflict({ start, end, bookings, blocks, ignoreId }) {
  const hitBooking = bookings.find(
    (b) =>
      b.id !== ignoreId &&
      b.status === 'confirmed' &&
      rangesOverlap(start, end, new Date(b.start_time), new Date(b.end_time)),
  )
  if (hitBooking) return { kind: 'booking', row: hitBooking }

  const hitBlock = blocks.find(
    (b) =>
      b.id !== ignoreId &&
      rangesOverlap(start, end, new Date(b.start_time), new Date(b.end_time)),
  )
  if (hitBlock) return { kind: 'unavailable', row: hitBlock }

  return null
}

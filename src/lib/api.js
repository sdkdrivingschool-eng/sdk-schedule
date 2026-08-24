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
  return data
}

export async function cancelBooking(id) {
  return updateBooking(id, { status: 'cancelled' })
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

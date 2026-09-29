// Shared HTTP helpers for the booking Edge Functions.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Service-role client. Bypasses RLS — only ever used server-side. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback
}

/** Where customer-facing links point (the scheduler app's public origin). */
export function siteUrl(): string {
  return env('PUBLIC_SITE_URL', 'http://localhost:5173').replace(/\/+$/, '')
}

/**
 * Database functions raise stable upper-case codes as their message
 * (SLOT_FULL, INVALID_TIME, ...). Map them to text a customer can act on.
 */
const FRIENDLY: Record<string, string> = {
  SLOT_FULL: 'Sorry, that time has just been taken. Please pick another time.',
  INVALID_TIME: 'That time can no longer be booked. Please pick another time.',
  INVALID_DURATION: 'That lesson length is not available for this plan.',
  INVALID_DATE: 'Please choose a start date at least 2 days from today.',
  PACKAGE_UNAVAILABLE: 'That plan is no longer available. Please choose another.',
  PACKAGE_AREA_MISMATCH: 'That plan is not offered in your area. Please choose another.',
  NOT_FOUND: "We couldn't find a booking with that reference number and email.",
  NO_CREDIT: "You don't have enough hours left for a lesson that long.",
}

export function dbErrorCode(error: { message?: string } | null): string | null {
  const msg = error?.message ?? ''
  const code = Object.keys(FRIENDLY).find((c) => msg.includes(c))
  return code ?? null
}

export function friendly(code: string | null): string {
  return (code && FRIENDLY[code]) || 'Something went wrong. Please try again or call us.'
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

/** Run work after the response is sent when the runtime supports it. */
export function background(promise: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  const guarded = promise.catch((err) => console.error('background task failed', err))
  if (rt?.waitUntil) rt.waitUntil(guarded)
  return guarded
}

/**
 * Ask the process-emails function to send whatever was just queued. Fire and
 * forget: if it fails, pg_cron picks the emails up within two minutes.
 */
export function kickEmails() {
  return background(
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  )
}

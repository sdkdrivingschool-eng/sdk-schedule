// Minimal Stripe REST client — plain fetch, no SDK, so nothing to bundle.

import { env } from './http.ts'

const API = 'https://api.stripe.com/v1'

/** Stripe wants application/x-www-form-urlencoded with bracketed nesting. */
function encode(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') encode(item as Record<string, unknown>, `${name}[${i}]`, out)
        else out.append(`${name}[${i}]`, String(item))
      })
    } else if (typeof value === 'object') {
      encode(value as Record<string, unknown>, name, out)
    } else {
      out.append(name, String(value))
    }
  }
  return out
}

export async function stripe<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const key = env('STRIPE_SECRET_KEY')
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let url = `${API}${path}`
  let body: string | undefined
  if (params && method === 'GET') url += `?${encode(params)}`
  if (params && method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = encode(params).toString()
  }

  const res = await fetch(url, { method, headers, body })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? 'request failed'}`)
  }
  return data as T
}

/**
 * Verify a Stripe-Signature header (v1 scheme): HMAC-SHA256 of
 * `${timestamp}.${rawBody}` with the endpoint secret, within 5 minutes.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secret) return false

  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2)
    if (k === 't') timestamp = v
    if (k === 'v1' && v) signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')

  return signatures.some((sig) => timingSafeEqual(sig, expected))
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

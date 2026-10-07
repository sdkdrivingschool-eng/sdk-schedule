// Public booking API for the no-login customer pages (/book, /my-lessons).
//
// Deployed with verify_jwt = false: customers have no account. Every action
// validates its input, is rate limited, and goes through a database function
// that re-checks everything under the schedule lock — nothing here trusts the
// browser about prices, capacity or payment.
//
// POST { action, ... }
//   checkout   hold a time + create a Stripe Checkout session -> { url }
//   status     what /book/success shows, by Stripe session id
//   release    customer backed out of Stripe: free the held time
//   lookup     reg number + email -> balance and lessons
//   book       book the next lesson from an hours balance
//   intensive  request an intensive course (no payment)

import {
  adminClient, clientIp, corsHeaders, dbErrorCode, env, friendly, json, kickEmails, siteUrl,
} from '../_shared/http.ts'
import { stripe } from '../_shared/stripe.ts'

const db = adminClient()

type Body = Record<string, unknown>

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
class BadRequest extends Error {}

const str = (v: unknown, max: number, field: string, required = true) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (required && !s) throw new BadRequest(`Please fill in ${field}.`)
  if (s.length > max) throw new BadRequest(`${field} is too long.`)
  return s
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[+()\d\s-]{7,20}$/
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i
const REG_RE = /^SDK-[A-Z0-9]{8}$/i
const UUID_RE = /^[0-9a-f-]{36}$/i

function contactFrom(body: Body) {
  if (typeof body.company === 'string' && body.company.trim()) {
    // Honeypot field, invisible to people. Only bots fill it in.
    throw new BadRequest('Something went wrong. Please try again.')
  }
  if (body.consent !== true) {
    throw new BadRequest('Please agree to us storing your details so we can arrange your lessons.')
  }
  const email = str(body.email, 200, 'your email').toLowerCase()
  if (!EMAIL_RE.test(email)) throw new BadRequest('Please enter a valid email address.')
  const phone = str(body.phone, 30, 'your phone number')
  if (!PHONE_RE.test(phone)) throw new BadRequest('Please enter a valid phone number.')
  const postcode = str(body.postcode, 10, 'your postcode').toUpperCase()
  if (!POSTCODE_RE.test(postcode)) throw new BadRequest('Please enter a valid UK postcode.')
  const area = body.area === 'surrey' ? 'surrey' : 'standard'

  return {
    name: str(body.name, 120, 'your name'),
    email,
    phone,
    pickup_address: str(body.pickup_address, 300, 'your pickup address'),
    postcode,
    area,
  }
}

function isoFrom(v: unknown, field: string) {
  const d = new Date(String(v ?? ''))
  if (Number.isNaN(d.getTime())) throw new BadRequest(`Please choose ${field}.`)
  return d.toISOString()
}

function minutesFrom(v: unknown) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (![60, 90, 120, 150].includes(n)) throw new BadRequest('Please choose a lesson length.')
  return n
}

async function limited(key: string, max: number, windowSeconds: number) {
  const { data } = await db.rpc('hit_rate_limit', {
    p_key: key, p_max: max, p_window_seconds: windowSeconds,
  })
  return data === true
}

const TOO_MANY = () =>
  json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429)

const lessonLabel = (startIso: string, endIso: string) => {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(startIso))
  const t = (iso: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
  return `${date}, ${t(startIso)}–${t(endIso)}`
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function checkout(req: Request, body: Body) {
  const contact = contactFrom(body)
  const plan = str(body.plan, 40, 'a plan')
  const start = isoFrom(body.start, 'a lesson time')
  const minutes = minutesFrom(body.minutes)
  const message = str(body.notes, 1000, 'Notes', false)

  if (await limited(`checkout:ip:${clientIp(req)}`, 10, 600)) return TOO_MANY()
  if (await limited(`checkout:email:${contact.email}`, 5, 600)) return TOO_MANY()

  const { data: hold, error } = await db.rpc('create_online_hold', {
    p_package_slug: plan,
    p_start: start,
    p_minutes: minutes,
    p_contact: contact,
    p_message: message || null,
  })
  if (error) {
    const code = dbErrorCode(error)
    if (!code) console.error('create_online_hold failed', error)
    return json({ error: friendly(code), code }, code ? 409 : 500)
  }

  const site = siteUrl()

  try {
    const session = await stripe<{ id: string; url: string }>('POST', '/checkout/sessions', {
      mode: 'payment',
      customer_email: hold.email,
      client_reference_id: hold.order_id,
      metadata: { order_id: hold.order_id },
      payment_intent_data: {
        metadata: { order_id: hold.order_id },
        description: `SDK Driving School — ${hold.package_name}`,
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: hold.amount_pence,
          product_data: {
            name: `SDK Driving School — ${hold.package_name}`,
            description: `Lesson: ${lessonLabel(hold.start_time, hold.end_time)}`,
          },
        },
      }],
      // Stripe's minimum is 30 minutes; the database hold lasts a little longer.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${site}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/book/cancelled?order=${hold.order_id}`,
    }, `checkout-${hold.order_id}`)

    await db.from('orders').update({ stripe_session_id: session.id }).eq('id', hold.order_id)
    return json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout failed', err)
    await db.rpc('expire_order', { p_order_id: hold.order_id })
    return json({ error: 'We could not start the payment. Please try again in a moment.' }, 502)
  }
}

async function status(body: Body) {
  const sessionId = str(body.session_id, 200, 'session')
  if (!sessionId.startsWith('cs_')) throw new BadRequest('Unknown booking.')

  let { data } = await db.rpc('order_status_by_session', { p_session_id: sessionId })
  if (!data) return json({ error: 'Unknown booking.' }, 404)

  // Normally the webhook confirms the order within seconds. If it hasn't yet,
  // ask Stripe directly (server-side, with the secret key — never trust the
  // redirect itself) so a slow or misconfigured webhook doesn't strand anyone.
  if (data.status === 'pending' && env('STRIPE_SECRET_KEY')) {
    try {
      const session = await stripe<Record<string, any>>('GET', `/checkout/sessions/${sessionId}`)
      const orderId = session?.metadata?.order_id
      if (session.payment_status === 'paid' && orderId) {
        await db.rpc('confirm_order', {
          p_order_id: orderId,
          p_session_id: session.id,
          p_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        })
        kickEmails()
        ;({ data } = await db.rpc('order_status_by_session', { p_session_id: sessionId }))
      }
    } catch (err) {
      console.error('status check against Stripe failed', err)
    }
  }
  return json(data)
}

async function release(body: Body) {
  const orderId = str(body.order_id, 40, 'order')
  if (!UUID_RE.test(orderId)) throw new BadRequest('Unknown booking.')

  const { data: order } = await db.from('orders')
    .select('id, status, stripe_session_id').eq('id', orderId).maybeSingle()
  if (!order || order.status !== 'pending') return json({ released: false })

  // Close the Stripe session first so the customer can't pay for a time we
  // are about to give away.
  if (order.stripe_session_id && env('STRIPE_SECRET_KEY')) {
    try {
      await stripe('POST', `/checkout/sessions/${order.stripe_session_id}/expire`)
    } catch (err) {
      // Already completed or expired — let the webhook decide.
      console.warn('could not expire session', err)
      return json({ released: false })
    }
  }
  await db.rpc('expire_order', { p_order_id: orderId })
  return json({ released: true })
}

function credentials(body: Body) {
  const reg = str(body.reg_number, 20, 'your reference number').toUpperCase()
  const email = str(body.email, 200, 'your email').toLowerCase()
  if (!REG_RE.test(reg) || !EMAIL_RE.test(email)) {
    throw new BadRequest(friendly('NOT_FOUND'))
  }
  return { reg, email }
}

async function lookup(req: Request, body: Body) {
  if (await limited(`lookup:ip:${clientIp(req)}`, 20, 600)) return TOO_MANY()
  const { reg, email } = credentials(body)
  const { data, error } = await db.rpc('customer_summary', { p_reg: reg, p_email: email })
  if (error) return json({ error: friendly(dbErrorCode(error)) }, 404)
  return json(data)
}

async function bookWithCredit(req: Request, body: Body) {
  if (await limited(`book:ip:${clientIp(req)}`, 10, 600)) return TOO_MANY()
  const { reg, email } = credentials(body)
  const start = isoFrom(body.start, 'a lesson time')
  const minutes = minutesFrom(body.minutes)
  if (!minutes) throw new BadRequest('Please choose a lesson length.')
  const message = str(body.notes, 1000, 'Notes', false)

  const { data, error } = await db.rpc('book_with_credit', {
    p_reg: reg, p_email: email, p_start: start, p_minutes: minutes, p_message: message || null,
  })
  if (error) {
    const code = dbErrorCode(error)
    if (!code) console.error('book_with_credit failed', error)
    return json({ error: friendly(code), code }, code ? 409 : 500)
  }
  kickEmails()
  return json(data)
}

async function intensive(req: Request, body: Body) {
  const contact = contactFrom(body)
  const plan = str(body.plan, 40, 'a course')
  const startDate = str(body.start_date, 10, 'a preferred start date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequest('Please choose a preferred start date.')
  const message = str(body.notes, 1000, 'Notes', false)

  if (await limited(`intensive:ip:${clientIp(req)}`, 5, 3600)) return TOO_MANY()
  if (await limited(`intensive:email:${contact.email}`, 3, 3600)) return TOO_MANY()

  const { data, error } = await db.rpc('create_intensive_request', {
    p_package_slug: plan, p_start_date: startDate, p_contact: contact, p_message: message || null,
  })
  if (error) {
    const code = dbErrorCode(error)
    if (!code) console.error('create_intensive_request failed', error)
    return json({ error: friendly(code), code }, code ? 409 : 500)
  }
  kickEmails()
  return json(data)
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400)

  try {
    switch (body.action) {
      case 'checkout': return await checkout(req, body)
      case 'status': return await status(body)
      case 'release': return await release(body)
      case 'lookup': return await lookup(req, body)
      case 'book': return await bookWithCredit(req, body)
      case 'intensive': return await intensive(req, body)
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (err) {
    if (err instanceof BadRequest) return json({ error: err.message }, 400)
    console.error('booking function error', err)
    return json({ error: friendly(null) }, 500)
  }
})

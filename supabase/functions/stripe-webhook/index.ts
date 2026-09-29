// Stripe webhook — the ONLY thing that turns a held booking into a paid one
// (besides /book/success asking Stripe directly with the secret key).
//
// Deployed with verify_jwt = false: Stripe cannot send a Supabase JWT.
// Authenticity comes from the Stripe-Signature header instead.
//
// Every handler is idempotent (confirm_order/expire_order check status under
// a row lock), so Stripe's retries and duplicate deliveries are harmless.
// stripe_events is a log of what was processed, written after success.

import { adminClient, env, json, kickEmails } from '../_shared/http.ts'
import { verifyStripeSignature } from '../_shared/stripe.ts'

const db = adminClient()

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const raw = await req.text()
  const ok = await verifyStripeSignature(
    raw, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'),
  )
  if (!ok) return json({ error: 'Invalid signature' }, 400)

  const event = JSON.parse(raw)
  const session = event?.data?.object ?? {}
  const orderId: string | undefined = session?.metadata?.order_id

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (!orderId) break
        // Card payments are 'paid' on completion; delayed methods arrive
        // later as async_payment_succeeded.
        if (session.payment_status !== 'paid') break
        const { data, error } = await db.rpc('confirm_order', {
          p_order_id: orderId,
          p_session_id: session.id,
          p_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        })
        if (error) throw error
        console.log('confirm_order', orderId, data)
        break
      }

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        if (!orderId) break
        const { error } = await db.rpc('expire_order', { p_order_id: orderId })
        if (error) throw error
        break
      }

      default:
        // Not something we act on; acknowledge so Stripe stops retrying.
        break
    }
  } catch (err) {
    console.error('webhook handling failed', event?.type, err)
    // 500 makes Stripe retry later — safe because every handler is idempotent.
    return json({ error: 'Processing failed' }, 500)
  }

  await db.from('stripe_events').upsert(
    { event_id: event.id, type: event.type },
    { onConflict: 'event_id', ignoreDuplicates: true },
  )
  kickEmails()
  return json({ received: true })
})

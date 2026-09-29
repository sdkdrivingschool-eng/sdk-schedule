// Drains public.email_outbox.
//
// Called after anything that queues email (the booking function, the Stripe
// webhook, the admin Assign button) and every two minutes by pg_cron as a
// safety net. It can only send what the database has already queued, so it
// needs no authentication and deploys with verify_jwt = false.

import { adminClient, corsHeaders, json } from '../_shared/http.ts'
import { processEmailQueue } from '../_shared/emails.ts'

const db = adminClient()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    return json(await processEmailQueue(db))
  } catch (err) {
    console.error('process-emails failed', err)
    return json({ error: 'failed' }, 500)
  }
})

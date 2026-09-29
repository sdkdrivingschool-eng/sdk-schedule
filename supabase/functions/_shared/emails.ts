// Sends queued emails from public.email_outbox — through SDK's own mailbox
// over SMTP, or via Resend as a fallback.
//
// Rows are queued by the database in the same transaction as the change that
// causes them (payment confirmed, lesson assigned, ...). This module only
// drains the queue, so it is safe to call from anywhere, any number of times:
// claim_email_jobs() hands each row to exactly one caller.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import { env, siteUrl } from './http.ts'

const TZ = 'Europe/London'
const MAX_ATTEMPTS = 5

type Job = {
  id: string
  kind: string
  booking_id: string | null
  order_id: string | null
  request_id: string | null
  attempts: number
}

type Message = { to: string; subject: string; html: string; text: string }

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(iso))

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso))

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

const money = (pence: number) => `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`

// ---------------------------------------------------------------------------
// Loading what each email needs
// ---------------------------------------------------------------------------
type Context = {
  booking: Record<string, any> | null
  order: Record<string, any> | null
  customer: Record<string, any> | null
  request: Record<string, any> | null
  instructorName: string | null
  remaining: number | null
}

async function loadContext(db: SupabaseClient, job: Job): Promise<Context> {
  const ctx: Context = {
    booking: null, order: null, customer: null, request: null, instructorName: null, remaining: null,
  }

  if (job.booking_id) {
    const { data } = await db.from('bookings').select('*').eq('id', job.booking_id).maybeSingle()
    ctx.booking = data
    if (data?.instructor_id) {
      const { data: u } = await db.from('users').select('name').eq('id', data.instructor_id).maybeSingle()
      ctx.instructorName = u?.name ?? null
    }
  }

  const orderId = job.order_id ?? ctx.booking?.order_id
  if (orderId) {
    const { data } = await db.from('orders').select('*').eq('id', orderId).maybeSingle()
    ctx.order = data
    const { data: left } = await db.rpc('order_minutes_remaining', { p_order_id: orderId })
    ctx.remaining = typeof left === 'number' ? left : null
  }

  if (job.request_id) {
    const { data } = await db.from('intensive_requests').select('*').eq('id', job.request_id).maybeSingle()
    ctx.request = data
  }

  const customerId = ctx.booking?.customer_id ?? ctx.order?.customer_id ?? ctx.request?.customer_id
  if (customerId) {
    const { data } = await db.from('customers').select('*').eq('id', customerId).maybeSingle()
    ctx.customer = data
  }

  return ctx
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
<tr><td style="background:#0a0a0a;color:#fff;padding:18px 24px;font-weight:700;font-size:16px">SDK Driving School</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(title)}</h1>
${bodyHtml}
<p style="margin:24px 0 0;font-size:13px;color:#71717a">Questions or need to change something? Just reply to this email or contact us at ${esc(env('SDK_NOTIFY_EMAIL', 'info@sdkdrivingschool.com'))}.</p>
</td></tr></table></td></tr></table></body></html>`
}

function rows(pairs: Array<[string, string | null | undefined]>) {
  const r = pairs
    .filter(([, v]) => v)
    .map(([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#71717a;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600">${esc(v)}</td></tr>`)
    .join('')
  return `<table cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;width:100%">${r}</table>`
}

const p = (text: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${text}</p>`

const button = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${esc(href)}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;font-size:14px">${esc(label)}</a></p>`

function lessonRows(ctx: Context, withInstructor: boolean) {
  const b = ctx.booking
  const c = ctx.customer
  if (!b) return ''
  const minutes = Math.round((new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60000)
  return rows([
    ['Date', fmtDate(b.start_time)],
    ['Time', `${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}`],
    ['Length', hours(minutes)],
    ['Instructor', withInstructor ? ctx.instructorName : null],
    ['Pickup', [c?.pickup_address, c?.postcode].filter(Boolean).join(', ') || null],
    ['Reference', c?.reg_number],
  ])
}

function balanceLine(ctx: Context) {
  if (ctx.order?.category !== 'block' || ctx.remaining == null) return ''
  return p(`You have <strong>${esc(hours(ctx.remaining))}</strong> of lessons left on your ${esc(ctx.order.package_name)} package. Book your next lesson any time with your reference number and email:`) +
    button(`${siteUrl()}/my-lessons`, 'Book my next lesson')
}

function toText(html: string) {
  return html
    .replace(/<tr>/g, '\n')
    .replace(/<\/td><td[^>]*>/g, ': ')
    .replace(/<(br|\/p|\/h1)>/g, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2: $1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function build(kind: string, ctx: Context): Message | null {
  const admin = env('SDK_NOTIFY_EMAIL', 'info@sdkdrivingschool.com')
  const c = ctx.customer
  const first = esc((c?.name ?? '').split(' ')[0] || 'there')
  const staffLink = `${siteUrl()}/unassigned`

  let to = c?.email as string | undefined
  let subject = ''
  let body = ''

  switch (kind) {
    case 'payment_received':
      subject = `Payment received — ${ctx.order?.package_name ?? 'your booking'}`
      body = p(`Hi ${first}, thanks for booking with SDK Driving School. We've received your payment of <strong>${esc(money(ctx.order?.amount_pence ?? 0))}</strong> for <strong>${esc(ctx.order?.package_name)}</strong>.`) +
        (ctx.booking ? p('Your lesson time is reserved:') + lessonRows(ctx, false) +
          p("<strong>Your instructor will be confirmed shortly.</strong> We'll email you again as soon as they are.")
          : rows([['Reference', c?.reg_number]])) +
        balanceLine(ctx) +
        p('Keep your reference number — you\'ll need it with your email to see or book lessons.')
      break

    case 'booking_received':
      subject = 'Lesson booked — instructor to be confirmed'
      body = p(`Hi ${first}, your next lesson is booked:`) + lessonRows(ctx, false) +
        p("<strong>Your instructor will be confirmed shortly.</strong> We'll email you again as soon as they are.") +
        balanceLine(ctx)
      break

    case 'lesson_confirmed':
      subject = `Your lesson is confirmed — ${ctx.booking ? fmtDate(ctx.booking.start_time) : ''}`
      body = p(`Hi ${first}, good news — your lesson is confirmed.`) + lessonRows(ctx, true) +
        p(`${esc(ctx.instructorName ?? 'Your instructor')} will pick you up from the address above. If anything needs to change, reply to this email or call us as early as possible.`)
      break

    case 'instructor_changed':
      subject = 'Your lesson has a new instructor'
      body = p(`Hi ${first}, your lesson is still on, but with a different instructor:`) + lessonRows(ctx, true)
      break

    case 'lesson_rescheduled':
      subject = 'Your lesson time has changed'
      body = p(`Hi ${first}, your lesson has been moved. Here are the new details:`) + lessonRows(ctx, true) +
        p("If this time doesn't work for you, just reply to this email.")
      break

    case 'lesson_cancelled':
      subject = 'Your lesson has been cancelled'
      body = p(`Hi ${first}, the lesson below has been cancelled.`) + lessonRows(ctx, false) +
        p("You haven't lost anything — the time has gone back onto your account. Reply to this email or call us to rebook or to arrange a refund.") +
        balanceLine(ctx)
      break

    case 'slot_taken':
      subject = 'Your payment is safe — please choose a new time'
      body = p(`Hi ${first}, your payment for <strong>${esc(ctx.order?.package_name)}</strong> went through, but it arrived after the time you picked had been taken by someone else.`) +
        p("Your hours are safe on your account. We'll be in touch to find a new time, or you can pick one yourself:") +
        rows([['Reference', c?.reg_number]]) +
        button(`${siteUrl()}/my-lessons`, 'Choose a new time')
      break

    case 'intensive_received': {
      const r = ctx.request
      subject = `We've received your ${r?.package_name ?? 'intensive course'} request`
      body = p(`Hi ${first}, thanks for your interest in an intensive course. We'll call you shortly to arrange your dates.`) +
        rows([
          ['Course', r?.package_name],
          ['Price', r ? money(r.price_pence) : null],
          ['Preferred start', r ? fmtDate(r.preferred_start_date) : null],
          ['Reference', c?.reg_number],
        ]) +
        p('No payment has been taken yet.')
      break
    }

    case 'admin_new_booking':
      to = admin
      subject = `New online booking — ${c?.name ?? ''}${ctx.booking ? `, ${fmtDate(ctx.booking.start_time)} ${fmtTime(ctx.booking.start_time)}` : ''}`
      body = p('A new lesson has been booked online and is waiting to be assigned to an instructor.') +
        rows([
          ['Customer', c?.name], ['Phone', c?.phone], ['Email', c?.email],
          ['Pickup', [c?.pickup_address, c?.postcode].filter(Boolean).join(', ')],
          ['Package', ctx.order?.package_name],
          ['Paid', ctx.order ? money(ctx.order.amount_pence) : null],
          ['Lesson', ctx.booking ? `${fmtDate(ctx.booking.start_time)}, ${fmtTime(ctx.booking.start_time)}–${fmtTime(ctx.booking.end_time)}` : 'none booked yet'],
          ['Reference', c?.reg_number],
        ]) + button(staffLink, 'Assign an instructor')
      break

    case 'admin_slot_taken':
      to = admin
      subject = `Action needed — paid booking lost its time (${c?.name ?? ''})`
      body = p('A payment arrived after the held time had been taken. The customer has been told their hours are safe. Please contact them to arrange a new time.') +
        rows([['Customer', c?.name], ['Phone', c?.phone], ['Email', c?.email], ['Package', ctx.order?.package_name], ['Reference', c?.reg_number]]) +
        button(staffLink, 'Open the scheduler')
      break

    case 'admin_intensive': {
      const r = ctx.request
      to = admin
      subject = `Intensive course request — ${c?.name ?? ''}`
      body = p('A customer has asked for an intensive course. Call them to arrange dates.') +
        rows([
          ['Customer', r?.contact?.name ?? c?.name], ['Phone', r?.contact?.phone ?? c?.phone], ['Email', c?.email],
          ['Pickup', [r?.contact?.pickup_address, r?.contact?.postcode].filter(Boolean).join(', ')],
          ['Course', r?.package_name], ['Preferred start', r ? fmtDate(r.preferred_start_date) : null],
          ['Message', r?.contact?.message],
        ]) + button(`${siteUrl()}/requests`, 'Open requests')
      break
    }

    default:
      return null
  }

  if (!to) return null
  const html = layout(subject, body)
  return { to, subject, html, text: toText(html) }
}

// ---------------------------------------------------------------------------
// Sending
//
// Preferred: SMTP through SDK's own mailbox (info@sdkdrivingschool.com on the
// cPanel host), configured with SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
// Supabase blocks outbound ports 25 and 587, so use 465 (SSL).
// Fallback: Resend, if RESEND_API_KEY is set instead.
// ---------------------------------------------------------------------------
const useSmtp = () => Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'))

let transporter: nodemailer.Transporter | null = null

function smtpTransport() {
  if (!transporter) {
    const port = Number(env('SMTP_PORT', '465'))
    transporter = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    })
  }
  return transporter
}

async function sendViaSmtp(msg: Message) {
  const mailbox = env('SMTP_USER')
  // Sending over SMTP does not file a copy in the mailbox's Sent folder, so
  // BCC customer emails to the mailbox (EMAIL_COPY_TO=off disables it).
  const copyTo = env('EMAIL_COPY_TO', mailbox)
  const bcc = copyTo && copyTo !== 'off' && copyTo.toLowerCase() !== msg.to.toLowerCase()
    ? copyTo
    : undefined

  await smtpTransport().sendMail({
    from: env('EMAIL_FROM', `SDK Driving School <${mailbox}>`),
    to: msg.to,
    bcc,
    replyTo: env('SDK_NOTIFY_EMAIL', mailbox),
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  })
}

async function sendViaResend(msg: Message) {
  const from = env('EMAIL_FROM', 'SDK Driving School <info@sdkdrivingschool.com>')
  const replyTo = env('SDK_NOTIFY_EMAIL', 'info@sdkdrivingschool.com')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from, to: [msg.to], reply_to: replyTo, subject: msg.subject, html: msg.html, text: msg.text,
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`)
  }
}

export async function processEmailQueue(db: SupabaseClient) {
  if (!useSmtp() && !env('RESEND_API_KEY')) {
    return { sent: 0, failed: 0, note: 'Email not configured (SMTP_* or RESEND_API_KEY) — emails stay queued' }
  }

  // Give up on anything stuck mid-send after the last attempt, and don't send
  // days-old notifications (e.g. queued before email was configured).
  await db.from('email_outbox')
    .update({ status: 'failed', last_error: 'gave up after repeated attempts' })
    .eq('status', 'sending').gte('attempts', MAX_ATTEMPTS)
    .lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
  await db.from('email_outbox')
    .update({ status: 'skipped', last_error: 'too old to send' })
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString())

  const { data: jobs, error } = await db.rpc('claim_email_jobs', { p_limit: 20 })
  if (error) throw error

  let sent = 0
  let failed = 0
  for (const job of (jobs ?? []) as Job[]) {
    try {
      const ctx = await loadContext(db, job)
      const msg = build(job.kind, ctx)
      if (!msg) {
        await db.from('email_outbox')
          .update({ status: 'skipped', last_error: 'nothing to send (missing recipient or data)' })
          .eq('id', job.id)
        continue
      }
      await (useSmtp() ? sendViaSmtp(msg) : sendViaResend(msg))
      await db.from('email_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), to_email: msg.to, last_error: null })
        .eq('id', job.id)
      sent++
    } catch (err) {
      failed++
      await db.from('email_outbox')
        .update({
          status: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          last_error: String((err as Error)?.message ?? err).slice(0, 500),
        })
        .eq('id', job.id)
    }
  }
  return { sent, failed }
}

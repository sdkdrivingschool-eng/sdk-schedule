# SDK Driving School — Scheduling

Scheduling app for a small driving school: two admins and three instructors
share one week-view calendar, book lessons, and mark themselves unavailable.
Customers book and pay online on the public `/book` page (no login); paid
lessons land unassigned and an admin assigns an instructor. See
[Online booking](#online-booking).

React (Vite) · Supabase (Auth + Postgres + RLS) · Tailwind CSS v4

---

## Quick start

```bash
npm install
cp .env.example .env   # fill in your project URL + publishable key
npm run dev
```

Then sign in at http://localhost:5173 with one of the seeded accounts below.

## Environment

`.env` (git-ignored — `.env.example` is the template):

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Safe in the browser. It only grants what RLS allows. |

The **secret** key is never referenced by the app — it is used once, from your
shell, to seed users (below).

## Database

Migrations live in `supabase/migrations/` and are applied in filename order:

| Migration | What it does |
| --- | --- |
| `…0001_init_schema.sql` | `users`, `availability_blocks`, `bookings` + indexes |
| `…0002_rls.sql` | RLS enabled, `is_admin()` / `can_write()` helpers, 12 policies |
| `…0003_conflicts.sql` | Exclusion constraints + cross-table conflict triggers |
| `…0004_user_sync.sql` | `auth.users` → `public.users` sync trigger |
| `…0005_rls_tighten_insert.sql` | Closes a write hole in 0002 (see *Security notes*) |

Apply them with the Supabase CLI:

```bash
supabase db push
```

### Schema

- **`users`** — `id` (FK to `auth.users`, cascade), `email`, `name`,
  `role` (`admin` | `instructor`), `created_at`.
- **`availability_blocks`** — `instructor_id`, `start_time`, `end_time`,
  `reason` (`Personal` | `Sick` | `Training` | `Other`), `created_by`, `created_at`.
- **`bookings`** — `instructor_id`, `student_name`, `student_phone`,
  `start_time`, `end_time`, `status` (`confirmed` | `cancelled`), `notes`,
  `created_by`, `created_at`.

`created_by` on `availability_blocks` is not in the original spec's column list;
it was added because the spec's RLS rule references `created_by` for **both**
schedule tables.

Students are free text on each booking — there is deliberately no `students`
table in v1.

### Seeding users

There is no signup screen. Accounts are created by an admin, or in bulk:

```bash
SUPABASE_SECRET_KEY=sb_secret_xxx node scripts/seed-users.mjs
```

The script is idempotent — existing accounts are skipped, not overwritten. It
writes `user_metadata { name, role }`, and the `on_auth_user_created` trigger
creates the matching `public.users` row.

**Currently seeded (placeholder identities — replace before going live):**

| Email | Name | Role |
| --- | --- | --- |
| `admin.alex@example.com` | Alex Morgan | admin |
| `admin.sam@example.com` | Sam Patel | admin |
| `jordan@example.com` | Jordan Lee | instructor |
| `riley@example.com` | Riley Chen | instructor |
| `casey@example.com` | Casey Novak | instructor |

Shared temporary password: **`SdkTemp2026!`** (override with `SEED_PASSWORD`).
Change these before the app is used for real.

---

## How it works

### Roles and redirect

Role is read from the `users` table, never from auth metadata — metadata is
self-declared at signup and RLS never reads it. On login:

- **admin** → `/schedule?view=all` (three-column grid)
- **instructor** → `/schedule?instructor=<their id>` (their own column)

The active tab lives in the URL, so a view is linkable and survives a reload.

### Sign-in screen

`/login` is deliberately the only dark surface in the app — everything past
sign-in is the light scheduling UI. The backdrop is a WebGL dot matrix
(`src/components/ui/dot-matrix-background.jsx`) that fades in from the centre.

- `three` is loaded with a **dynamic import**, so it builds into its own chunk
  (~128 kB gzip) that only downloads on this screen. The original reference
  component injected a `cdnjs` `<script>` tag at runtime; that is a third-party
  request on the auth screen, breaks under a strict CSP or offline, and pins
  r128 forever.
- The canvas sizes itself from its **parent's box** via `ResizeObserver`, not
  `window.innerWidth`. Window-based sizing collapses to 0×0 in embedded or
  headless viewports and is wrong the moment the backdrop is not fullscreen.
- Failure is non-fatal: no WebGL, or a chunk that will not load, leaves the flat
  black background. The sign-in form never depends on the backdrop. The error is
  logged in dev and silent in production.

There is no signup panel and no social buttons — accounts are admin-created and
no OAuth provider is configured, so those controls would be decoration.

### Components

`src/components/ui/` holds the presentation primitives (`index.jsx`: `Modal`,
`Button`, `Field`, `ErrorNote`, `Spinner`, `inputClass`). This is the
shadcn/ui convention, and it is where pasted third-party components land, so
vendor UI stays separate from the app's own feature components one level up
(`BookingModal`, `ScheduleGrid`, …).

`@` is aliased to `src/` in both `vite.config.js` and `jsconfig.json`, so
shadcn-style `@/components/ui/...` imports resolve without editing. Existing
relative imports still work — the alias is additive.

### Double-booking prevention — two layers

Both layers are deliberate, and they are not redundant:

1. **Client pre-check** (`findConflict` in `src/lib/api.js`) runs before every
   insert/update so the user gets a specific, readable sentence:
   *"Conflicts with a lesson for Priya Shah."*
2. **Database constraints** catch the race the pre-check cannot — two people
   submitting the same slot at the same instant:
   - `EXCLUDE USING gist` over `tstzrange(start_time, end_time, '[)')` per
     instructor, on each table. The bookings one is partial
     (`WHERE status = 'confirmed'`) so cancelling frees the slot.
   - A `BEFORE INSERT OR UPDATE` trigger for the cross-table case, since an
     exclusion constraint cannot span two tables. A lesson cannot land inside an
     unavailability block, and a block cannot swallow a confirmed lesson.

`describeWriteError` maps the raw Postgres codes (`23P01`, `P0001`, `42501`,
`23514`) back to the same readable sentences, so a lost race reads like a
conflict, not a stack trace.

Ranges are half-open (`[)`) everywhere — client and database — so a lesson
ending at 10:00 and one starting at 10:00 do not conflict.

### Row Level Security

- **Read** — every signed-in user can select all rows in `availability_blocks`
  and `bookings`. Everyone needs to see who is free.
- **Write** — admins: anything. Instructors: rows they own or created, and the
  row must end up in their own column.
- `is_admin()` is `SECURITY DEFINER` so its `users` lookup does not re-enter RLS
  on `public.users` and recurse inside its own policy.
- Nothing is granted to `anon`.

---

## Security notes

**A hole in the original policies was found and fixed** in
`…0005_rls_tighten_insert.sql`, and is worth understanding before you edit them.

The spec's write rule was *"instructor_id = auth.uid() OR created_by =
auth.uid()"*. Implemented literally, that is too loose on writes that create or
reshape a row, because `created_by` **defaults to `auth.uid()`** — so the
`created_by` branch is always true for whoever performs the write, whatever
`instructor_id` they set. Verified against the live API with an instructor JWT:
an instructor could `POST` a booking into a colleague's diary, and `PATCH` their
own booking to move it into a colleague's column. The UI blocked both, but RLS
has to stand on its own.

The fix splits the two concerns:

- `USING` (which existing rows I may act on) — unchanged, faithful to the spec:
  admin, rows in my column, or rows I created.
- `WITH CHECK` (what a row may look like after my write) — the row must live in
  **my** column, unless I am an admin.

Re-verified after the fix: cross-column insert → `42501`; cross-column reassign
→ `42501`; own-column insert and own-row edit → still succeed; admin unaffected.

---

## Online booking

Customers never log in. The WordPress site only links to this app; everything
else happens here.

```
WordPress "Book" button ──► /book?plan=basic  (public, this app)
  pick plan → pick time (live availability) → details → pay (Stripe Checkout)
      │  booking Edge Function: holds the time ("held") for 35 min
      ▼
  Stripe ──webhook──► stripe-webhook Edge Function → lesson "confirmed",
                                                      instructor_id = null
      ▼
  Staff app: Unassigned (admins) → Assign → instructor chosen from those free
      ▼
  Customer emailed "Your lesson is confirmed" (from info@sdkdrivingschool.com)
```

### Rules the database enforces

- **Capacity.** Customers book a time, not an instructor. A time is offered
  only while *(instructors free for the whole lesson) − (unassigned lessons
  overlapping it) > 0*. Every write that affects capacity takes one advisory
  lock and re-checks, so simultaneous checkouts cannot overbook.
- **Holds.** Checkout reserves the time as `held` until the hold expires
  (35 min, just over Stripe's 30-minute minimum). Abandoned or cancelled
  checkouts free it; a cron job tidies anything left.
- **Payment.** Only the Stripe webhook (or `/book/success` asking Stripe
  directly with the secret key) marks an order paid — never the redirect.
  Handlers are idempotent, so Stripe retries are harmless.
- **Late payment into a taken time.** The customer keeps the hours as credit,
  the order is flagged under *Needs attention*, and both sides are emailed.
- **Hours balance.** Every paid order is a credit in minutes. A booking
  spends its length; cancelling it gives the time back. Customers book the
  rest of a package at `/my-lessons` with their reference (`SDK-XXXXXXXX`)
  and email.
- **Contact details for instructors.** Each online lesson's `notes` holds the
  customer's email, phone, pickup address, reference, package and hours
  left, so whoever is assigned can call them.
- **Intensive courses** are requests only (no payment); admins arrange them
  from *Intensive requests*.
- Customers can't cancel or move lessons online in v1 — they contact SDK.

### Screens

| Route | Who | What |
| --- | --- | --- |
| `/book`, `/book/success`, `/book/cancelled` | public | Plans, booking flow, payment result |
| `/my-lessons` | public | Balance, upcoming lessons, book from balance |
| `/unassigned` | admins | Paid lessons waiting for an instructor; Assign |
| `/requests` | admins | Intensive course requests |
| `/packages` | admins | Prices, bullet points, show/hide, notice and horizon |

Unassigned lessons (and payment holds) are visible to admins only (RLS).
Instructors see a lesson's customer details once it is in their column.

### Database objects

Migrations `…0008`–`…0014` add `packages`, `customers`, `orders`,
`intensive_requests`, `booking_settings`, `booking_assignments` (history),
`email_outbox`, `stripe_events`, `rate_limits`, and extend `bookings` with
`customer_id`, `order_id`, `source`, `hold_expires_at`, `assigned_by/at`
(`instructor_id` is now nullable; status adds `held` and `expired`).
The anon key can only read active packages and settings and call
`get_available_slots` / `get_available_days`. Everything else goes through the
Edge Functions with the service role.

### Edge Functions (`supabase/functions/`)

| Function | Purpose | JWT |
| --- | --- | --- |
| `booking` | Public API: checkout, status, release, lookup, book from balance, intensive request | off (validated + rate limited) |
| `stripe-webhook` | Confirms/expires orders | off (Stripe signature) |
| `process-emails` | Sends queued emails via Resend; also run by pg_cron every 2 min | off (only sends what is queued) |

Secrets (Supabase dashboard → Edge Functions → Secrets):

| Secret | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` while testing, `sk_live_…` when live |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe webhook endpoint |
| `SMTP_HOST` | SDK's mail server, e.g. `mail.sdkdrivingschool.com` (cPanel → Connect Devices) |
| `SMTP_PORT` | `465` (SSL). Supabase blocks ports 25 and 587 |
| `SMTP_USER` | `info@sdkdrivingschool.com` |
| `SMTP_PASS` | that mailbox's password |
| `SAVE_TO_SENT` | optional: sent emails are filed in the mailbox's Sent folder over IMAP (port 993, same login); `off` disables |
| `IMAP_HOST` / `IMAP_PORT` | optional: default to `SMTP_HOST` / `993` |
| `RESEND_API_KEY` | only if using Resend instead of SMTP |
| `EMAIL_FROM` | `SDK Driving School <info@sdkdrivingschool.com>` |
| `SDK_NOTIFY_EMAIL` | `info@sdkdrivingschool.com` (new-booking alerts, reply-to) |
| `PUBLIC_SITE_URL` | this app's public URL, e.g. `https://book.sdkdrivingschool.com` |

Emails are sent through SDK's own mailbox over SMTP when the `SMTP_*` secrets
are set, otherwise through Resend. Until one is configured, emails wait in
`email_outbox`. Anything older
than two days is skipped rather than sent late.

Deploy with the Supabase CLI (`supabase/config.toml` turns JWT checks off for
these three):

```bash
supabase functions deploy booking stripe-webhook process-emails
```

### Stripe setup

1. In Stripe (test mode first) → Developers → Webhooks → add endpoint
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` with events
   `checkout.session.completed`, `checkout.session.expired`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`.
2. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` and the API secret key
   into `STRIPE_SECRET_KEY`.
3. Test with card `4242 4242 4242 4242`, any future expiry, any CVC.

**Going live:** the owner creates the Stripe account in SDK's name, with SDK's
UK bank account, and invites the developer. Repeat steps 1–2 in live mode with
live keys. Verify `sdkdrivingschool.com` in Resend (DNS records) so emails
come from `info@sdkdrivingschool.com`.

### WordPress button links

Point each button at `PUBLIC_SITE_URL` plus one of these:

| Plan | Link |
| --- | --- |
| All plans | `/book` |
| 1 hour lesson (£50) | `/book?plan=payg-1h` |
| 1.5 hour lesson (£65) | `/book?plan=payg-1-5h` |
| 2 hour lesson (£80) | `/book?plan=payg-2h` |
| 2.5 hour lesson (£100) | `/book?plan=payg-2-5h` |
| Basic, 10 hrs (£380) | `/book?plan=basic` |
| Standard, 20 hrs (£750) | `/book?plan=standard` |
| Premium, 30 hrs (£1120) | `/book?plan=premium` |
| Surrey 1 hour (£55) | `/book?plan=surrey-1h` |
| Surrey 1.5 hour (£70) | `/book?plan=surrey-1-5h` |
| Surrey 2 hour (£85) | `/book?plan=surrey-2h` |
| Surrey 2.5 hour (£105) | `/book?plan=surrey-2-5h` |
| Surrey 10 hrs (£400) | `/book?plan=surrey-10h` |
| Surrey 20 hrs (£790) | `/book?plan=surrey-20h` |
| Intensive 10 hrs (£750) | `/book?plan=intensive-10` |
| Intensive 20 hrs (£1250) | `/book?plan=intensive-20` |
| Intensive 30 hrs (£1600) | `/book?plan=intensive-30` |
| Customer's lessons | `/my-lessons` |

The pay-as-you-go 10/20/30 hr blocks cost the same as Basic/Standard/Premium,
so link those buttons to `basic`, `standard` and `premium`.

## Not in v1

Deliberately out of scope: SMS reminders, customers cancelling or moving
lessons online, automatic scheduling of intensive courses, recurring lesson
templates, and reporting/analytics.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built output |
| `npm run lint` | oxlint |

`npm run lint` reports three advisory warnings (two `set-state-in-effect`, one
`only-export-components`). Both patterns are intentional: the effects
synchronise with external systems (Supabase auth, the database), and
`AuthContext` exports its `useAuth` hook alongside the provider.

## Deploying to Vercel

Framework preset **Vite**, build `npm run build`, output `dist`. Add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as environment
variables. Because routing is client-side, add a rewrite so deep links resolve:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

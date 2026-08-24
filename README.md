# SDK Driving School — Scheduling

Internal scheduling app for a small driving school: two admins and three
instructors share one week-view calendar, book lessons, and mark themselves
unavailable. No public signup, no student-facing portal.

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

## Not in v1

Deliberately out of scope: payments, SMS/email reminders, a student
self-booking portal, recurring lesson templates, reporting/analytics, and a
proper `students` table.

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

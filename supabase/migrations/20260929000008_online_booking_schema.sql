-- 20260929000008_online_booking_schema.sql
-- Online booking + payment: new tables and the changes to bookings.
--
-- Customers book on the public /book page without logging in and pay via
-- Stripe. The paid lesson lands UNASSIGNED (instructor_id is null) and an
-- admin assigns it to a free instructor.
--
-- Every paid order is a credit measured in minutes. A single lesson is a
-- credit equal to its length; a block package (e.g. Basic = 10 hrs) is a
-- larger credit spent across several bookings. The balance is always derived
-- (minutes_total minus the minutes of non-cancelled bookings on the order),
-- so cancelling a lesson automatically gives the hours back.

-- ---------------------------------------------------------------------------
-- packages: every plan shown on /book. Prices in pence.
-- ---------------------------------------------------------------------------
create table if not exists public.packages (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name            text not null,
  category        text not null check (category in ('single', 'block', 'intensive')),
  -- 'any' = offered whichever area the customer picks (intensive courses).
  area            text not null default 'standard'
                    check (area in ('standard', 'surrey', 'any')),
  lesson_minutes  integer check (lesson_minutes in (60, 90, 120, 150)),
  total_minutes   integer check (total_minutes > 0),
  course_lessons  integer check (course_lessons > 0),
  price_pence     integer not null check (price_pence > 0),
  was_price_pence integer check (was_price_pence > 0),
  features        text[] not null default '{}',
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint packages_shape check (
    (category = 'single'    and lesson_minutes is not null) or
    (category = 'block'     and total_minutes  is not null) or
    (category = 'intensive' and total_minutes  is not null and course_lessons is not null)
  )
);

-- ---------------------------------------------------------------------------
-- customers. reg_number + email is what a customer types on /my-lessons, so
-- the number is random rather than sequential (guessing one is useless
-- without the matching email, and enumerating them is impractical).
-- ---------------------------------------------------------------------------
create or replace function public.generate_reg_number()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I/L
  bytes  bytea := uuid_send(gen_random_uuid());
  result text  := 'SDK-';
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  reg_number     text not null unique default public.generate_reg_number(),
  name           text not null check (length(name) between 1 and 120),
  email          text not null unique check (email = lower(email) and email like '%_@_%'),
  phone          text not null check (length(phone) between 5 and 30),
  pickup_address text check (length(pickup_address) <= 300),
  postcode       text check (length(postcode) <= 12),
  area           text not null default 'standard' check (area in ('standard', 'surrey')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- orders: one purchase. Package details are snapshotted so a later price
-- edit never changes what a customer already paid for.
--
-- `contact` holds the details typed at checkout. They are copied onto the
-- customer record only once payment clears — otherwise anyone could start a
-- checkout with someone else's email and overwrite their phone number.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.customers (id) on delete cascade,
  package_id            uuid references public.packages (id) on delete set null,
  package_slug          text not null,
  package_name          text not null,
  category              text not null check (category in ('single', 'block')),
  amount_pence          integer not null check (amount_pence > 0),
  minutes_total         integer not null check (minutes_total > 0),
  contact               jsonb not null default '{}',
  status                text not null default 'pending'
                          check (status in ('pending', 'paid', 'expired', 'refunded', 'cancelled')),
  -- Set when something needs a human (e.g. the payment landed after the held
  -- slot had been taken). An admin clears it once handled.
  attention_reason      text,
  stripe_session_id     text unique,
  stripe_payment_intent text,
  checkout_expires_at   timestamptz,
  paid_at               timestamptz,
  credit_expires_at     timestamptz,  -- null = the hours never expire
  created_at            timestamptz not null default now()
);

create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_status_idx   on public.orders (status);

-- ---------------------------------------------------------------------------
-- intensive_requests: intensive courses are not auto-scheduled. The customer
-- asks for a start date and an admin arranges it by phone.
-- ---------------------------------------------------------------------------
create table if not exists public.intensive_requests (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers (id) on delete cascade,
  package_id           uuid references public.packages (id) on delete set null,
  package_name         text not null,
  price_pence          integer not null,
  preferred_start_date date not null,
  contact              jsonb not null default '{}',
  status               text not null default 'requested'
                         check (status in ('requested', 'confirmed', 'declined')),
  admin_notes          text,
  handled_by           uuid references public.users (id) on delete set null,
  handled_at           timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists intensive_requests_status_idx
  on public.intensive_requests (status, created_at);

-- ---------------------------------------------------------------------------
-- booking_settings: one row of tunables the admin can edit.
-- hold_minutes must outlast Stripe's minimum 30-minute checkout window.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_settings (
  id                boolean primary key default true check (id),
  min_notice_hours  integer not null default 24 check (min_notice_hours between 0 and 336),
  horizon_days      integer not null default 56 check (horizon_days between 1 and 365),
  hold_minutes      integer not null default 35 check (hold_minutes between 32 and 120),
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (15, 30, 60)),
  updated_at        timestamptz not null default now()
);

insert into public.booking_settings (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Service-role-only bookkeeping: webhook log and rate limiting.
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id    text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- bookings: allow unassigned online lessons and payment holds.
-- ---------------------------------------------------------------------------
alter table public.bookings alter column instructor_id drop not null;

alter table public.bookings
  add column if not exists customer_id     uuid references public.customers (id) on delete set null,
  add column if not exists order_id        uuid references public.orders (id) on delete set null,
  add column if not exists source          text not null default 'staff',
  add column if not exists hold_expires_at timestamptz,
  add column if not exists assigned_by     uuid references public.users (id) on delete set null,
  add column if not exists assigned_at     timestamptz;

alter table public.bookings drop constraint if exists bookings_source_check;
alter table public.bookings
  add constraint bookings_source_check check (source in ('staff', 'online'));

-- held    = awaiting payment; occupies capacity until hold_expires_at
-- expired = the payment never arrived
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('held', 'confirmed', 'cancelled', 'expired'));

-- Only online bookings may sit unassigned; staff always put a lesson in a column.
alter table public.bookings drop constraint if exists bookings_unassigned_online_only;
alter table public.bookings
  add constraint bookings_unassigned_online_only
  check (instructor_id is not null or source = 'online');

alter table public.bookings drop constraint if exists bookings_hold_has_expiry;
alter table public.bookings
  add constraint bookings_hold_has_expiry
  check (status <> 'held' or hold_expires_at is not null);

create index if not exists bookings_unassigned_time_idx
  on public.bookings (start_time) where instructor_id is null;
create index if not exists bookings_order_idx    on public.bookings (order_id);
create index if not exists bookings_customer_idx on public.bookings (customer_id);

-- ---------------------------------------------------------------------------
-- booking_assignments: history of every assignment / reassignment.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_assignments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings (id) on delete cascade,
  from_instructor_id uuid references public.users (id) on delete set null,
  to_instructor_id   uuid references public.users (id) on delete set null,
  assigned_by        uuid references public.users (id) on delete set null,
  assigned_at        timestamptz not null default now()
);

create index if not exists booking_assignments_booking_idx
  on public.booking_assignments (booking_id);

-- ---------------------------------------------------------------------------
-- email_outbox: every customer/admin email is queued here in the same
-- transaction as the change that causes it, then sent by the process-emails
-- Edge Function. A failed send never rolls back an assignment or a payment,
-- and nothing is lost if Resend is briefly down.
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in (
                'payment_received', 'booking_received', 'lesson_confirmed',
                'instructor_changed', 'lesson_rescheduled', 'lesson_cancelled',
                'slot_taken', 'intensive_received',
                'admin_new_booking', 'admin_intensive', 'admin_slot_taken')),
  booking_id  uuid references public.bookings (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete cascade,
  request_id  uuid references public.intensive_requests (id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  to_email    text,
  last_error  text,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists email_outbox_pending_idx
  on public.email_outbox (created_at) where status in ('pending', 'sending');
create index if not exists email_outbox_booking_idx on public.email_outbox (booking_id);

-- Lock the new tables down immediately; policies arrive in the security migration.
alter table public.packages            enable row level security;
alter table public.customers           enable row level security;
alter table public.orders              enable row level security;
alter table public.intensive_requests  enable row level security;
alter table public.booking_settings    enable row level security;
alter table public.stripe_events       enable row level security;
alter table public.rate_limits         enable row level security;
alter table public.booking_assignments enable row level security;
alter table public.email_outbox        enable row level security;

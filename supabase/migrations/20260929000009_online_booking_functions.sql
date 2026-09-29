-- 20260929000009_online_booking_functions.sql
-- Capacity, holds, payment confirmation, credit bookings and assignment.
--
-- THE CAPACITY RULE
-- Customers book a time, not an instructor. A time is offered only while
--
--     instructors free for the whole range
--   - active unassigned bookings overlapping the range   > 0
--
-- "Active" = confirmed, or held with an unexpired hold. Counting every
-- overlapping unassigned booking is deliberately conservative with mixed
-- lesson lengths: it can hide a slot that would technically fit, but it
-- never offers more lessons than there are instructors.
--
-- THE LOCK
-- Every write that consumes or changes capacity takes the same transaction
-- advisory lock first, then re-checks. Two customers paying for the last
-- place at the same instant are serialised: the second one re-reads capacity
-- after the first has committed and gets SLOT_FULL. Volume is a handful of
-- writes a minute, so one global lock costs nothing.
--
-- Errors raised to callers use SQLSTATE P0001 and a stable upper-case code
-- as the message (SLOT_FULL, INVALID_TIME, ...), which the Edge Functions
-- and the UI map to friendly text.

-- ---------------------------------------------------------------------------
-- Building blocks
-- ---------------------------------------------------------------------------
create or replace function public.take_schedule_lock()
returns void
language sql
as $$
  select pg_advisory_xact_lock(724101);
$$;

create or replace function public.booking_is_active(p_status text, p_hold_expires_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_status = 'confirmed'
      or (p_status = 'held' and p_hold_expires_at > now());
$$;

/** Inside the 05:00-20:00 London day (same window the staff grid draws). */
create or replace function public.within_working_hours(p_start timestamptz, p_end timestamptz)
returns boolean
language sql
stable
as $$
  select p_end > p_start
     and (p_start at time zone 'Europe/London')::time >= time '05:00'
     and (p_end at time zone 'Europe/London')
           <= (p_start at time zone 'Europe/London')::date + time '20:00';
$$;

/** No active lesson and no unavailable block for this instructor in [start, end). */
create or replace function public.instructor_is_free(
  p_instructor     uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_ignore_booking uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select within_working_hours(p_start, p_end)
     and not exists (
       select 1 from bookings b
       where b.instructor_id = p_instructor
         and b.id is distinct from p_ignore_booking
         and booking_is_active(b.status, b.hold_expires_at)
         and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)'))
     and not exists (
       select 1 from availability_blocks a
       where a.instructor_id = p_instructor
         and tstzrange(a.start_time, a.end_time, '[)') && tstzrange(p_start, p_end, '[)'));
$$;

create or replace function public.free_instructor_count(
  p_start          timestamptz,
  p_end            timestamptz,
  p_ignore_booking uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from users u
  where u.role = 'instructor'
    and instructor_is_free(u.id, p_start, p_end, p_ignore_booking);
$$;

/** Places left at [start, end). <= 0 means full. */
create or replace function public.slot_capacity(
  p_start          timestamptz,
  p_end            timestamptz,
  p_ignore_booking uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select free_instructor_count(p_start, p_end, p_ignore_booking)
       - (select count(*)::int
          from bookings b
          where b.instructor_id is null
            and b.id is distinct from p_ignore_booking
            and booking_is_active(b.status, b.hold_expires_at)
            and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)'));
$$;

/** Rejects a start the public calendar would never have offered. */
create or replace function public.assert_bookable_time(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s booking_settings;
  local_minute integer;
begin
  select * into s from booking_settings where id;
  local_minute := extract(hour from p_start at time zone 'Europe/London')::int * 60
                + extract(minute from p_start at time zone 'Europe/London')::int;

  if extract(second from p_start) <> 0
     or local_minute % s.slot_step_minutes <> 0
     or not within_working_hours(p_start, p_end)
     or p_start < now() + make_interval(hours => s.min_notice_hours)
     or p_start > now() + make_interval(days => s.horizon_days) then
    raise exception 'INVALID_TIME' using errcode = 'P0001';
  end if;
end;
$$;

/** Minutes of credit still unspent on an order. */
create or replace function public.order_minutes_remaining(p_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.minutes_total - coalesce((
           select sum(extract(epoch from (b.end_time - b.start_time)) / 60)::int
           from bookings b
           where b.order_id = o.id
             and booking_is_active(b.status, b.hold_expires_at)), 0)
  from orders o
  where o.id = p_order_id;
$$;

create or replace function public.minutes_label(p_minutes integer)
returns text
language sql
immutable
as $$
  select case
           when p_minutes % 60 = 0 then (p_minutes / 60)::text || 'h'
           else (p_minutes / 60)::text || 'h ' || (p_minutes % 60)::text || 'm'
         end;
$$;

/**
 * The text that goes in bookings.notes for an online lesson, so whichever
 * instructor gets the lesson has everything needed to contact the customer
 * without opening another screen.
 */
create or replace function public.online_booking_notes(
  p_contact           jsonb,
  p_reg_number        text,
  p_package_name      text,
  p_remaining_minutes integer,
  p_message           text
)
returns text
language sql
immutable
as $$
  select concat_ws(E'\n',
    'Online booking · Ref ' || p_reg_number,
    'Email: '   || nullif(p_contact ->> 'email', ''),
    'Phone: '   || nullif(p_contact ->> 'phone', ''),
    'Pickup: '  || nullif(concat_ws(', ',
                     nullif(p_contact ->> 'pickup_address', ''),
                     nullif(p_contact ->> 'postcode', '')), ''),
    'Area: '    || case p_contact ->> 'area' when 'surrey' then 'Surrey' else 'Standard' end,
    'Package: ' || p_package_name
                || case when p_remaining_minutes is not null
                        then ' — ' || minutes_label(p_remaining_minutes) || ' left after this lesson'
                        end,
    'Customer note: ' || nullif(btrim(p_message), ''));
$$;

create or replace function public.enqueue_email(
  p_kind       text,
  p_booking_id uuid default null,
  p_order_id   uuid default null,
  p_request_id uuid default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into email_outbox (kind, booking_id, order_id, request_id)
  values (p_kind, p_booking_id, p_order_id, p_request_id);
$$;

-- ---------------------------------------------------------------------------
-- Public availability (anon-callable — returns start times only, never data
-- about who is booked).
-- ---------------------------------------------------------------------------
create or replace function public.get_available_slots(p_date date, p_minutes integer)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s        booking_settings;
  dur      interval := make_interval(mins => p_minutes);
  t        timestamptz;
  day_end  timestamptz;
begin
  if p_minutes is null or p_minutes not in (60, 90, 120, 150) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;

  select * into s from booking_settings where id;
  t       := (p_date + time '05:00') at time zone 'Europe/London';
  day_end := (p_date + time '20:00') at time zone 'Europe/London';

  while t + dur <= day_end loop
    if t >= now() + make_interval(hours => s.min_notice_hours)
       and t <= now() + make_interval(days => s.horizon_days)
       and slot_capacity(t, t + dur) > 0 then
      slot_start := t;
      return next;
    end if;
    t := t + make_interval(mins => s.slot_step_minutes);
  end loop;
end;
$$;

/** Which dates in [from, to] have at least one slot — drives the calendar. */
create or replace function public.get_available_days(p_from date, p_to date, p_minutes integer)
returns table (day date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d date := p_from;
begin
  if p_to - p_from > 62 then
    raise exception 'RANGE_TOO_LONG' using errcode = 'P0001';
  end if;
  while d <= p_to loop
    if exists (select 1 from get_available_slots(d, p_minutes)) then
      day := d;
      return next;
    end if;
    d := d + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout: hold a slot while the customer pays. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.create_online_hold(
  p_package_slug text,
  p_start        timestamptz,
  p_minutes      integer,
  p_contact      jsonb,
  p_message      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s          booking_settings;
  pkg        packages;
  cust       customers;
  ord        orders;
  bk         bookings;
  v_minutes  integer;
  v_end      timestamptz;
  v_email    text := lower(btrim(p_contact ->> 'email'));
  v_area     text := coalesce(p_contact ->> 'area', 'standard');
begin
  perform take_schedule_lock();
  select * into s from booking_settings where id;

  select * into pkg from packages where slug = p_package_slug and is_active;
  if not found or pkg.category not in ('single', 'block') then
    raise exception 'PACKAGE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if pkg.area not in ('any', v_area) then
    raise exception 'PACKAGE_AREA_MISMATCH' using errcode = 'P0001';
  end if;

  v_minutes := case when pkg.category = 'single' then pkg.lesson_minutes else p_minutes end;
  if v_minutes is null or v_minutes not in (60, 90, 120, 150)
     or v_minutes > coalesce(pkg.total_minutes, pkg.lesson_minutes) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;

  v_end := p_start + make_interval(mins => v_minutes);
  perform assert_bookable_time(p_start, v_end);

  if slot_capacity(p_start, v_end) <= 0 then
    raise exception 'SLOT_FULL' using errcode = 'P0001';
  end if;

  -- New customers are created now (the order needs the FK). An existing
  -- customer's details are left alone until payment clears.
  insert into customers (name, email, phone, pickup_address, postcode, area)
  values (p_contact ->> 'name', v_email, p_contact ->> 'phone',
          nullif(p_contact ->> 'pickup_address', ''), nullif(p_contact ->> 'postcode', ''), v_area)
  on conflict (email) do nothing;
  select * into cust from customers where email = v_email;

  insert into orders (customer_id, package_id, package_slug, package_name, category,
                      amount_pence, minutes_total, contact, checkout_expires_at)
  values (cust.id, pkg.id, pkg.slug, pkg.name, pkg.category,
          pkg.price_pence, coalesce(pkg.total_minutes, pkg.lesson_minutes),
          p_contact || jsonb_build_object('email', v_email, 'area', v_area),
          now() + make_interval(mins => s.hold_minutes))
  returning * into ord;

  insert into bookings (instructor_id, student_name, student_phone, start_time, end_time,
                        status, source, customer_id, order_id, hold_expires_at, notes, created_by)
  values (null, ord.contact ->> 'name', ord.contact ->> 'phone', p_start, v_end,
          'held', 'online', cust.id, ord.id, ord.checkout_expires_at,
          online_booking_notes(ord.contact, cust.reg_number, ord.package_name,
                               case when ord.category = 'block'
                                    then ord.minutes_total - v_minutes end,
                               p_message),
          null)
  returning * into bk;

  return jsonb_build_object(
    'order_id',        ord.id,
    'booking_id',      bk.id,
    'amount_pence',    ord.amount_pence,
    'package_name',    ord.package_name,
    'email',           v_email,
    'minutes',         v_minutes,
    'start_time',      bk.start_time,
    'end_time',        bk.end_time,
    'hold_expires_at', ord.checkout_expires_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment cleared (called from the Stripe webhook only). Idempotent.
--
-- Returns: confirmed | already_paid | slot_taken | not_found
--
-- If the hold lapsed and the time has since filled, the customer still keeps
-- the paid hours as credit; the lesson is cancelled, the order is flagged for
-- an admin and both sides are emailed. Nobody loses money and nothing is
-- double-booked.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order(
  p_order_id       uuid,
  p_session_id     text,
  p_payment_intent text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ord  orders;
  bk   bookings;
begin
  perform take_schedule_lock();

  select * into ord from orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if ord.status = 'paid' then
    return 'already_paid';
  end if;

  update customers c
     set name           = coalesce(nullif(ord.contact ->> 'name', ''), c.name),
         phone          = coalesce(nullif(ord.contact ->> 'phone', ''), c.phone),
         pickup_address = coalesce(nullif(ord.contact ->> 'pickup_address', ''), c.pickup_address),
         postcode       = coalesce(nullif(ord.contact ->> 'postcode', ''), c.postcode),
         area           = coalesce(nullif(ord.contact ->> 'area', ''), c.area),
         updated_at     = now()
   where c.id = ord.customer_id;

  update orders
     set status                = 'paid',
         paid_at               = now(),
         stripe_session_id     = coalesce(stripe_session_id, p_session_id),
         stripe_payment_intent = p_payment_intent
   where id = ord.id;

  select * into bk
  from bookings
  where order_id = ord.id and status in ('held', 'expired')
  order by created_at
  limit 1
  for update;

  if not found then
    perform enqueue_email('payment_received', null, ord.id);
    perform enqueue_email('admin_new_booking', null, ord.id);
    return 'confirmed';
  end if;

  if (bk.status = 'held' and bk.hold_expires_at > now())
     or slot_capacity(bk.start_time, bk.end_time, bk.id) > 0 then
    update bookings
       set status = 'confirmed', hold_expires_at = null
     where id = bk.id;
    perform enqueue_email('payment_received', bk.id, ord.id);
    perform enqueue_email('admin_new_booking', bk.id, ord.id);
    return 'confirmed';
  end if;

  update bookings
     set status = 'cancelled', hold_expires_at = null
   where id = bk.id;
  update orders
     set attention_reason = 'Payment arrived after the held time was taken. '
                         || 'The hours are on the customer''s balance — contact them to pick a new time.'
   where id = ord.id;
  perform enqueue_email('slot_taken', bk.id, ord.id);
  perform enqueue_email('admin_slot_taken', bk.id, ord.id);
  return 'slot_taken';
end;
$$;

/** Checkout abandoned or expired: free the held time. Idempotent. */
create or replace function public.expire_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  perform take_schedule_lock();

  update orders set status = 'expired'
   where id = p_order_id and status = 'pending'
  returning status into v_status;

  if v_status is null then
    return 'unchanged';
  end if;

  update bookings set status = 'expired'
   where order_id = p_order_id and status = 'held';
  return 'expired';
end;
$$;

/**
 * Housekeeping for pg_cron. Availability already ignores lapsed holds, so
 * this only tidies statuses. The grace period leaves room for a webhook that
 * arrives a little after the Stripe session closes.
 */
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from orders
    where status = 'pending' and checkout_expires_at < now() - interval '30 minutes'
  loop
    perform expire_order(r.id);
    n := n + 1;
  end loop;

  delete from rate_limits where window_start < now() - interval '1 day';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer self-service (via the booking Edge Function, service role only).
-- reg_number + email together identify a customer.
-- ---------------------------------------------------------------------------
create or replace function public.find_customer(p_reg text, p_email text)
returns customers
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from customers
  where reg_number = upper(btrim(p_reg))
    and email = lower(btrim(p_email));
$$;

create or replace function public.customer_summary(p_reg text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cust customers;
begin
  cust := find_customer(p_reg, p_email);
  if cust.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'name',       cust.name,
    'reg_number', cust.reg_number,
    'area',       cust.area,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'package_name',      o.package_name,
               'category',          o.category,
               'minutes_total',     o.minutes_total,
               'minutes_remaining', order_minutes_remaining(o.id),
               'paid_at',           o.paid_at,
               'credit_expires_at', o.credit_expires_at)
             order by o.paid_at)
      from orders o
      where o.customer_id = cust.id and o.status = 'paid'), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'start_time',  b.start_time,
               'end_time',    b.end_time,
               'status',      b.status,
               'instructor',  u.name)
             order by b.start_time)
      from bookings b
      left join users u on u.id = b.instructor_id
      where b.customer_id = cust.id
        and b.status = 'confirmed'
        and b.end_time > now() - interval '30 days'), '[]'::jsonb));
end;
$$;

/** Book the next lesson from an hours balance. No payment involved. */
create or replace function public.book_with_credit(
  p_reg     text,
  p_email   text,
  p_start   timestamptz,
  p_minutes integer,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cust     customers;
  ord      orders;
  bk       bookings;
  v_end    timestamptz;
  v_left   integer;
begin
  perform take_schedule_lock();

  cust := find_customer(p_reg, p_email);
  if cust.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_minutes is null or p_minutes not in (60, 90, 120, 150) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;
  v_end := p_start + make_interval(mins => p_minutes);
  perform assert_bookable_time(p_start, v_end);

  -- Spend the oldest credit first.
  select * into ord
  from orders o
  where o.customer_id = cust.id
    and o.status = 'paid'
    and (o.credit_expires_at is null or o.credit_expires_at > p_start)
    and order_minutes_remaining(o.id) >= p_minutes
  order by o.paid_at
  limit 1
  for update;

  if not found then
    raise exception 'NO_CREDIT' using errcode = 'P0001';
  end if;

  if slot_capacity(p_start, v_end) <= 0 then
    raise exception 'SLOT_FULL' using errcode = 'P0001';
  end if;

  v_left := order_minutes_remaining(ord.id) - p_minutes;

  insert into bookings (instructor_id, student_name, student_phone, start_time, end_time,
                        status, source, customer_id, order_id, notes, created_by)
  values (null, cust.name, cust.phone, p_start, v_end,
          'confirmed', 'online', cust.id, ord.id,
          online_booking_notes(
            jsonb_build_object('email', cust.email, 'phone', cust.phone,
                               'pickup_address', cust.pickup_address,
                               'postcode', cust.postcode, 'area', cust.area),
            cust.reg_number, ord.package_name,
            case when ord.category = 'block' then v_left end, p_message),
          null)
  returning * into bk;

  perform enqueue_email('booking_received', bk.id, ord.id);
  perform enqueue_email('admin_new_booking', bk.id, ord.id);

  return jsonb_build_object(
    'booking_id',        bk.id,
    'start_time',        bk.start_time,
    'end_time',          bk.end_time,
    'minutes_remaining', v_left);
end;
$$;

/** What the /book/success page shows. Keyed by the unguessable Stripe session id. */
create or replace function public.order_status_by_session(p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'status',          o.status,
           'needs_attention', o.attention_reason is not null,
           'package_name',    o.package_name,
           'category',        o.category,
           'minutes_total',   o.minutes_total,
           'reg_number',      c.reg_number,
           'email',           c.email,
           'booking', (
             select jsonb_build_object('start_time', b.start_time,
                                       'end_time',   b.end_time,
                                       'status',     b.status)
             from bookings b
             where b.order_id = o.id
             order by b.created_at
             limit 1))
  from orders o
  join customers c on c.id = o.customer_id
  where o.stripe_session_id = p_session_id;
$$;

create or replace function public.create_intensive_request(
  p_package_slug text,
  p_start_date   date,
  p_contact      jsonb,
  p_message      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pkg     packages;
  cust    customers;
  req     intensive_requests;
  v_email text := lower(btrim(p_contact ->> 'email'));
  v_area  text := coalesce(p_contact ->> 'area', 'standard');
begin
  select * into pkg from packages
  where slug = p_package_slug and is_active and category = 'intensive';
  if not found then
    raise exception 'PACKAGE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_start_date is null or p_start_date < (now() at time zone 'Europe/London')::date + 2
     or p_start_date > (now() at time zone 'Europe/London')::date + 365 then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;

  insert into customers (name, email, phone, pickup_address, postcode, area)
  values (p_contact ->> 'name', v_email, p_contact ->> 'phone',
          nullif(p_contact ->> 'pickup_address', ''), nullif(p_contact ->> 'postcode', ''), v_area)
  on conflict (email) do nothing;
  select * into cust from customers where email = v_email;

  insert into intensive_requests (customer_id, package_id, package_name, price_pence,
                                  preferred_start_date, contact, admin_notes)
  values (cust.id, pkg.id, pkg.name, pkg.price_pence, p_start_date,
          p_contact || jsonb_build_object('email', v_email, 'area', v_area,
                                          'message', nullif(btrim(p_message), '')),
          null)
  returning * into req;

  perform enqueue_email('intensive_received', null, null, req.id);
  perform enqueue_email('admin_intensive', null, null, req.id);

  return jsonb_build_object('request_id', req.id, 'reg_number', cust.reg_number);
end;
$$;

/** Fixed-window counter. Returns true when the caller is over the limit. */
create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits   integer;
begin
  insert into rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits > p_max;
end;
$$;

/** Claim a batch of queued emails for sending (skips rows another run holds). */
create or replace function public.claim_email_jobs(p_limit integer default 20)
returns setof email_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update email_outbox e
     set status = 'sending', locked_at = now(), attempts = e.attempts + 1
   where e.id in (
     select id from email_outbox
     where (status = 'pending'
            or (status = 'sending' and locked_at < now() - interval '10 minutes'))
       and attempts < 5
     order by created_at
     limit p_limit
     for update skip locked)
  returning e.*;
$$;

-- ---------------------------------------------------------------------------
-- Admin: unassigned list and assignment.
-- ---------------------------------------------------------------------------
create or replace function public.admin_unassigned_bookings()
returns table (
  id                     uuid,
  start_time             timestamptz,
  end_time               timestamptz,
  status                 text,
  hold_expires_at        timestamptz,
  student_name           text,
  student_phone          text,
  notes                  text,
  customer_id            uuid,
  reg_number             text,
  email                  text,
  pickup_address         text,
  postcode               text,
  area                   text,
  order_id               uuid,
  package_name           text,
  order_status           text,
  amount_pence           integer,
  minutes_remaining      integer,
  free_instructors       integer,
  previous_instructor_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select b.id, b.start_time, b.end_time, b.status, b.hold_expires_at,
         b.student_name, b.student_phone, b.notes,
         c.id, c.reg_number, c.email, c.pickup_address, c.postcode, c.area,
         o.id, o.package_name, o.status, o.amount_pence,
         case when o.id is null then null else order_minutes_remaining(o.id) end,
         free_instructor_count(b.start_time, b.end_time, b.id),
         (select p.instructor_id from bookings p
           where p.customer_id = b.customer_id
             and p.instructor_id is not null
             and p.status = 'confirmed'
           order by p.start_time desc
           limit 1)
  from bookings b
  left join customers c on c.id = b.customer_id
  left join orders o    on o.id = b.order_id
  where b.instructor_id is null
    and booking_is_active(b.status, b.hold_expires_at)
    and b.end_time > now() - interval '1 day'
  order by b.start_time;
end;
$$;

/** Instructors free for exactly this booking's time; flags the customer's previous one. */
create or replace function public.free_instructors_for_booking(p_booking_id uuid)
returns table (id uuid, name text, previous boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  bk bookings;
  v_prev uuid;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into bk from bookings where bookings.id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select p.instructor_id into v_prev
  from bookings p
  where p.customer_id = bk.customer_id
    and bk.customer_id is not null
    and p.id <> bk.id
    and p.instructor_id is not null
    and p.status = 'confirmed'
  order by p.start_time desc
  limit 1;

  return query
  select u.id, u.name, u.id = v_prev
  from users u
  where u.role = 'instructor'
    and u.id is distinct from bk.instructor_id
    and instructor_is_free(u.id, bk.start_time, bk.end_time, bk.id)
  order by (u.id = v_prev) desc nulls last, u.name;
end;
$$;

/**
 * Assign (or reassign) a lesson. Re-checks availability under the lock at the
 * moment of assigning — the list the admin was looking at may be stale. The
 * bookings triggers log the change and queue the customer email.
 */
create or replace function public.assign_booking(p_booking_id uuid, p_instructor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bk bookings;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform take_schedule_lock();

  select * into bk from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if bk.status <> 'confirmed' then
    raise exception 'NOT_CONFIRMED' using errcode = 'P0001';
  end if;
  if bk.instructor_id is not distinct from p_instructor_id then
    return;
  end if;

  if p_instructor_id is null then
    if bk.source <> 'online' then
      raise exception 'CANNOT_UNASSIGN' using errcode = 'P0001';
    end if;
  else
    if not exists (select 1 from users where id = p_instructor_id and role = 'instructor') then
      raise exception 'NOT_AN_INSTRUCTOR' using errcode = 'P0001';
    end if;
    if not instructor_is_free(p_instructor_id, bk.start_time, bk.end_time, bk.id) then
      raise exception 'INSTRUCTOR_BUSY' using errcode = 'P0001';
    end if;
  end if;

  update bookings set instructor_id = p_instructor_id where id = bk.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Cross-table overlap check (from 20260824000003), updated:
--  * takes the schedule lock, so staff edits and blocks serialise with
--    online bookings and capacity checks never read a half-written state;
--  * unassigned lessons have no column to clash in (capacity covers them);
--  * SECURITY DEFINER so the lock helper needs no grant to `authenticated`.
create or replace function public.check_cross_schedule_conflict()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clash_count integer;
begin
  perform take_schedule_lock();

  if tg_table_name = 'bookings' then
    if new.status <> 'confirmed' or new.instructor_id is null then
      return new;
    end if;

    select count(*) into clash_count
    from availability_blocks ab
    where ab.instructor_id = new.instructor_id
      and tstzrange(ab.start_time, ab.end_time, '[)')
       && tstzrange(new.start_time, new.end_time, '[)');

    if clash_count > 0 then
      raise exception
        'SCHEDULE_CONFLICT: instructor is marked unavailable during this time'
        using errcode = 'exclusion_violation';
    end if;

  else
    select count(*) into clash_count
    from bookings b
    where b.instructor_id = new.instructor_id
      and b.status = 'confirmed'
      and tstzrange(b.start_time, b.end_time, '[)')
       && tstzrange(new.start_time, new.end_time, '[)');

    if clash_count > 0 then
      raise exception
        'SCHEDULE_CONFLICT: instructor has a confirmed lesson during this time'
        using errcode = 'exclusion_violation';
    end if;
  end if;

  return new;
end;
$$;

/** Stamp who assigned a lesson whenever its instructor changes. */
create or replace function public.stamp_booking_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.instructor_id is distinct from old.instructor_id then
    new.assigned_by := auth.uid();
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_stamp_assignment on public.bookings;
create trigger bookings_stamp_assignment
  before update of instructor_id on public.bookings
  for each row execute function public.stamp_booking_assignment();

/**
 * After a lesson changes: log (re)assignments and queue customer emails for
 * online bookings. Lives in a trigger so it also fires when an admin moves or
 * cancels an online lesson from the normal schedule screens.
 */
create or replace function public.after_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.instructor_id is distinct from old.instructor_id then
    insert into booking_assignments (booking_id, from_instructor_id, to_instructor_id, assigned_by)
    values (new.id, old.instructor_id, new.instructor_id, auth.uid());
  end if;

  if new.source <> 'online' then
    return new;
  end if;

  if new.status = 'cancelled' and old.status = 'confirmed' then
    perform enqueue_email('lesson_cancelled', new.id, new.order_id);
  elsif new.status = 'confirmed' and old.status = 'confirmed' then
    if new.instructor_id is not null and new.instructor_id is distinct from old.instructor_id then
      perform enqueue_email(
        case when old.instructor_id is null then 'lesson_confirmed' else 'instructor_changed' end,
        new.id, new.order_id);
    elsif new.instructor_id is not null
          and (new.start_time <> old.start_time or new.end_time <> old.end_time) then
      perform enqueue_email('lesson_rescheduled', new.id, new.order_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_after_change on public.bookings;
create trigger bookings_after_change
  after update on public.bookings
  for each row execute function public.after_booking_change();

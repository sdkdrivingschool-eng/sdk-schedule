-- 20260930000020_transmission.sql
--
-- MANUAL / AUTOMATIC
-- Customers choose manual or automatic before they see any times, and only
-- instructors who teach that gearbox are counted:
--
--   * automatic -> the shared pool (Shamim, Taha). The lesson is booked
--     unassigned and staff assign one of the free automatic instructors, as
--     before.
--   * manual    -> Talha only. There is nothing to choose, so the lesson is
--     put straight on his schedule when the time is held, and the customer
--     is told who their instructor is straight away.
--
-- The choice rides inside the order's contact JSON (and orders.transmission),
-- so a package customer's later bookings from "My lessons" use the same
-- gearbox without asking again.

-- ---------------------------------------------------------------------------
-- Who teaches what
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists transmission text
    check (transmission in ('manual', 'automatic'));

update public.users set transmission = 'manual'    where username = 'talha';
update public.users set transmission = 'automatic' where username in ('shamim', 'taha');

-- Customer start times per gearbox. Talha's day has a one-hour prayer break
-- (13:30-14:30), so his lessons start 09:00 / 11:30 / 14:30 / 17:00; the
-- automatic instructors keep 09:00 / 11:30 / 14:00 / 16:30 (slot_starts).
alter table public.booking_settings
  add column if not exists manual_slot_starts time[] not null
    default array['09:00', '11:30', '14:30', '17:00']::time[];

alter table public.orders
  add column if not exists transmission text not null default 'automatic'
    check (transmission in ('manual', 'automatic'));

-- ---------------------------------------------------------------------------
-- Capacity, per transmission
--
-- New overloads with an extra transmission argument and NO default, added
-- next to the old ones rather than replacing them (a DROP is blocked by the
-- tooling, and no default keeps calls unambiguous). The old signatures stay
-- for any stale client and count every instructor, as before.
-- ---------------------------------------------------------------------------

/** Instructors free for the whole range; p_transmission null = any gearbox. */
create or replace function public.free_instructor_count(
  p_start          timestamptz,
  p_end            timestamptz,
  p_ignore_booking uuid,
  p_transmission   text
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
    and (p_transmission is null or u.transmission = p_transmission)
    and instructor_is_free(u.id, p_start, p_end, p_ignore_booking);
$$;

/**
 * Places left at [start, end) for one gearbox. <= 0 means full.
 * Manual lessons are assigned the moment they are held, so only automatic
 * lessons can be sitting unassigned and eating into the pool.
 */
create or replace function public.slot_capacity(
  p_start          timestamptz,
  p_end            timestamptz,
  p_ignore_booking uuid,
  p_transmission   text
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select free_instructor_count(p_start, p_end, p_ignore_booking, p_transmission)
       - case when p_transmission = 'manual' then 0
         else (select count(*)::int
               from bookings b
               where b.instructor_id is null
                 and b.id is distinct from p_ignore_booking
                 and booking_is_active(b.status, b.hold_expires_at)
                 and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)'))
         end;
$$;

/** Picks the free instructor for a manual lesson (null if none). */
create or replace function public.pick_manual_instructor(
  p_start timestamptz,
  p_end   timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from users u
  where u.role = 'instructor'
    and u.transmission = 'manual'
    and instructor_is_free(u.id, p_start, p_end)
  order by u.name
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Public availability
-- ---------------------------------------------------------------------------

create or replace function public.get_available_slots(
  p_date         date,
  p_minutes      integer,
  p_transmission text
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s     booking_settings;
  dur   interval := make_interval(mins => p_minutes);
  local time;
  t     timestamptz;
begin
  if p_minutes is null or p_minutes not in (60, 90, 120, 150) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;
  if p_transmission is null or p_transmission not in ('manual', 'automatic') then
    raise exception 'INVALID_TRANSMISSION' using errcode = 'P0001';
  end if;

  select * into s from booking_settings where id;

  foreach local in array (
    select array_agg(x order by x)
    from unnest(case when p_transmission = 'manual' then s.manual_slot_starts else s.slot_starts end) x
  ) loop
    t := (p_date + local) at time zone 'Europe/London';
    if within_working_hours(t, t + dur)
       and t >= now() + make_interval(hours => s.min_notice_hours)
       and t <= now() + make_interval(days => s.horizon_days)
       and slot_capacity(t, t + dur, null, p_transmission) > 0 then
      slot_start := t;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.get_available_days(
  p_from         date,
  p_to           date,
  p_minutes      integer,
  p_transmission text
)
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
    if exists (select 1 from get_available_slots(d, p_minutes, p_transmission)) then
      day := d;
      return next;
    end if;
    d := d + 1;
  end loop;
end;
$$;

-- Rejects a start the public calendar would never have offered.

create or replace function public.assert_bookable_time(
  p_start        timestamptz,
  p_end          timestamptz,
  p_transmission text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s booking_settings;
begin
  select * into s from booking_settings where id;

  if extract(second from p_start) <> 0
     or not ((p_start at time zone 'Europe/London')::time = any (
              case when p_transmission = 'manual' then s.manual_slot_starts else s.slot_starts end))
     or not within_working_hours(p_start, p_end)
     or p_start < now() + make_interval(hours => s.min_notice_hours)
     or p_start > now() + make_interval(days => s.horizon_days) then
    raise exception 'INVALID_TIME' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the instructor sees in the lesson notes
-- ---------------------------------------------------------------------------
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
    'Area: '    || case p_contact ->> 'area' when 'surrey' then 'Surrey' else 'London' end,
    'Gearbox: ' || case p_contact ->> 'transmission'
                     when 'manual' then 'Manual'
                     when 'automatic' then 'Automatic'
                   end,
    'Package: ' || p_package_name
                || coalesce(' — ' || minutes_label(p_remaining_minutes) || ' left after this lesson', ''),
    'Customer note: ' || nullif(btrim(p_message), ''));
$$;

-- ---------------------------------------------------------------------------
-- Checkout hold
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
  -- Older clients do not send a gearbox; they get the automatic pool.
  v_trans    text := coalesce(p_contact ->> 'transmission', 'automatic');
  v_instr    uuid;
begin
  perform take_schedule_lock();
  select * into s from booking_settings where id;

  if v_trans not in ('manual', 'automatic') then
    raise exception 'INVALID_TRANSMISSION' using errcode = 'P0001';
  end if;

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
  perform assert_bookable_time(p_start, v_end, v_trans);

  if slot_capacity(p_start, v_end, null, v_trans) <= 0 then
    raise exception 'SLOT_FULL' using errcode = 'P0001';
  end if;

  -- Manual lessons go straight onto the manual instructor's schedule.
  if v_trans = 'manual' then
    v_instr := pick_manual_instructor(p_start, v_end);
    if v_instr is null then
      raise exception 'SLOT_FULL' using errcode = 'P0001';
    end if;
  end if;

  insert into customers (name, email, phone, pickup_address, postcode, area)
  values (p_contact ->> 'name', v_email, p_contact ->> 'phone',
          nullif(p_contact ->> 'pickup_address', ''), nullif(p_contact ->> 'postcode', ''), v_area)
  on conflict (email) do nothing;
  select * into cust from customers where email = v_email;

  insert into orders (customer_id, package_id, package_slug, package_name, category,
                      amount_pence, minutes_total, contact, transmission, checkout_expires_at)
  values (cust.id, pkg.id, pkg.slug, pkg.name, pkg.category,
          pkg.price_pence, coalesce(pkg.total_minutes, pkg.lesson_minutes),
          p_contact || jsonb_build_object('email', v_email, 'area', v_area, 'transmission', v_trans),
          v_trans, now() + make_interval(mins => s.hold_minutes))
  returning * into ord;

  insert into bookings (instructor_id, student_name, student_phone, start_time, end_time,
                        status, source, customer_id, order_id, hold_expires_at, notes, created_by)
  values (v_instr, ord.contact ->> 'name', ord.contact ->> 'phone', p_start, v_end,
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
-- Payment cleared
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
     or slot_capacity(bk.start_time, bk.end_time, bk.id, ord.transmission) > 0 then
    -- A lapsed manual hold may have lost its instructor to someone else in
    -- the meantime; capacity above says one is free, so re-pick.
    if ord.transmission = 'manual' and bk.status = 'expired' then
      update bookings
         set instructor_id = pick_manual_instructor(bk.start_time, bk.end_time)
       where id = bk.id;
    end if;
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

-- ---------------------------------------------------------------------------
-- Customer self-service
-- ---------------------------------------------------------------------------
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
               'transmission',      o.transmission,
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

/** Book the next lesson from an hours balance, on the gearbox that was paid for. */
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
  v_instr  uuid;
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

  perform assert_bookable_time(p_start, v_end, ord.transmission);

  if slot_capacity(p_start, v_end, null, ord.transmission) <= 0 then
    raise exception 'SLOT_FULL' using errcode = 'P0001';
  end if;

  if ord.transmission = 'manual' then
    v_instr := pick_manual_instructor(p_start, v_end);
    if v_instr is null then
      raise exception 'SLOT_FULL' using errcode = 'P0001';
    end if;
  end if;

  v_left := order_minutes_remaining(ord.id) - p_minutes;

  insert into bookings (instructor_id, student_name, student_phone, start_time, end_time,
                        status, source, customer_id, order_id, notes, created_by)
  values (v_instr, cust.name, cust.phone, p_start, v_end,
          'confirmed', 'online', cust.id, ord.id,
          online_booking_notes(
            jsonb_build_object('email', cust.email, 'phone', cust.phone,
                               'pickup_address', cust.pickup_address,
                               'postcode', cust.postcode, 'area', cust.area,
                               'transmission', ord.transmission),
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
                                       'status',     b.status,
                                       'instructor', (select u.name from users u
                                                      where u.id = b.instructor_id))
             from bookings b
             where b.order_id = o.id
             order by b.created_at
             limit 1))
  from orders o
  join customers c on c.id = o.customer_id
  where o.stripe_session_id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- Admin: only offer instructors who teach the customer's gearbox
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
         free_instructor_count(b.start_time, b.end_time, b.id, o.transmission),
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

create or replace function public.free_instructors_for_booking(p_booking_id uuid)
returns table (id uuid, name text, previous boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  bk      bookings;
  v_prev  uuid;
  v_trans text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into bk from bookings where bookings.id = p_booking_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select o.transmission into v_trans from orders o where o.id = bk.order_id;

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
    and (v_trans is null or u.transmission = v_trans)
    and u.id is distinct from bk.instructor_id
    and instructor_is_free(u.id, bk.start_time, bk.end_time, bk.id)
  order by (u.id = v_prev) desc nulls last, u.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the new signatures (same lock-down as migration …0010)
-- ---------------------------------------------------------------------------
revoke execute on function
  public.free_instructor_count(timestamptz, timestamptz, uuid, text),
  public.slot_capacity(timestamptz, timestamptz, uuid, text),
  public.pick_manual_instructor(timestamptz, timestamptz),
  public.assert_bookable_time(timestamptz, timestamptz, text),
  public.get_available_slots(date, integer, text),
  public.get_available_days(date, date, integer, text)
from public, anon, authenticated;

grant execute on function
  public.get_available_slots(date, integer, text),
  public.get_available_days(date, date, integer, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Talha's prayer break becomes 13:30-14:30 (was 14:00-14:30), so his day is
-- 09:00-11:00, 11:30-13:30, [prayer], 14:30-16:30, 17:00-19:00. The already
-- generated future blocks move back 30 minutes, except on days where he has
-- a lesson in 13:30-14:00 (those keep 14:00-14:30).
-- ---------------------------------------------------------------------------
update public.availability_blocks a
   set start_time = a.start_time - interval '30 minutes'
  from public.users u
 where u.id = a.instructor_id and u.username = 'talha'
   and a.reason = 'Prayer' and a.created_by is null
   and a.start_time > now()
   and not exists (
     select 1 from public.bookings b
     where b.instructor_id = a.instructor_id
       and b.status in ('confirmed', 'held')
       and tstzrange(b.start_time, b.end_time, '[)')
        && tstzrange(a.start_time - interval '30 minutes', a.start_time, '[)'));

update public.recurring_breaks rb
   set start_local = time '13:30', end_local = time '14:30'
  from public.users u
 where u.id = rb.instructor_id and u.username = 'talha';

-- 20260930000017_fixed_slots_and_recurring_breaks.sql
--
-- 1. FIXED START TIMES
--    Customers no longer pick from a rolling 30-minute grid. They choose one
--    of the day's fixed lesson starts (09:00, 11:30, 14:00, 16:30 London
--    time by default), stored on booking_settings so they can be changed
--    without a migration. Staff booking is unaffected.
--
-- 2. RECURRING BREAKS
--    A daily break for an instructor (e.g. prayer 14:00-14:30). Rather than
--    teaching every availability check about recurrence, the break is
--    materialised as ordinary availability_blocks rows a few months ahead,
--    so the staff grid, the conflict trigger and the public capacity rule
--    all see it with no further changes. Each date is generated once
--    (generated_through), so deleting one day's block on the grid sticks.

-- ---------------------------------------------------------------------------
-- 1. Fixed start times
-- ---------------------------------------------------------------------------
alter table public.booking_settings
  add column if not exists slot_starts time[] not null
    default array['09:00', '11:30', '14:00', '16:30']::time[];

create or replace function public.get_available_slots(p_date date, p_minutes integer)
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

  select * into s from booking_settings where id;

  foreach local in array (select array_agg(x order by x) from unnest(s.slot_starts) x) loop
    t := (p_date + local) at time zone 'Europe/London';
    if within_working_hours(t, t + dur)
       and t >= now() + make_interval(hours => s.min_notice_hours)
       and t <= now() + make_interval(days => s.horizon_days)
       and slot_capacity(t, t + dur) > 0 then
      slot_start := t;
      return next;
    end if;
  end loop;
end;
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
begin
  select * into s from booking_settings where id;

  if extract(second from p_start) <> 0
     or not ((p_start at time zone 'Europe/London')::time = any (s.slot_starts))
     or not within_working_hours(p_start, p_end)
     or p_start < now() + make_interval(hours => s.min_notice_hours)
     or p_start > now() + make_interval(days => s.horizon_days) then
    raise exception 'INVALID_TIME' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Recurring breaks
-- ---------------------------------------------------------------------------
alter table public.availability_blocks
  drop constraint if exists availability_blocks_reason_check;
alter table public.availability_blocks
  add constraint availability_blocks_reason_check
  check (reason in ('Personal', 'Sick', 'Training', 'Prayer', 'Other'));

create table if not exists public.recurring_breaks (
  id                uuid primary key default gen_random_uuid(),
  instructor_id     uuid not null references public.users (id) on delete cascade,
  start_local       time not null,
  end_local         time not null,
  reason            text not null default 'Other'
                      check (reason in ('Personal', 'Sick', 'Training', 'Prayer', 'Other')),
  generated_through date,
  created_at        timestamptz not null default now(),
  constraint recurring_breaks_time_order check (end_local > start_local)
);

-- Only the generator touches this table; no client access.
alter table public.recurring_breaks enable row level security;
revoke all on public.recurring_breaks from anon, authenticated;

/**
 * Writes each recurring break as an availability block for every London date
 * not yet generated, up to p_days ahead. A day where the instructor already
 * has a lesson or another block in that window is skipped, not forced.
 */
create or replace function public.generate_recurring_breaks(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today    date := (now() at time zone 'Europe/London')::date;
  r        recurring_breaks;
  d        date;
  b_start  timestamptz;
  b_end    timestamptz;
  inserted integer := 0;
begin
  perform take_schedule_lock();

  for r in select * from recurring_breaks for update loop
    d := greatest(today, coalesce(r.generated_through + 1, today));
    while d <= today + p_days loop
      b_start := (d + r.start_local) at time zone 'Europe/London';
      b_end   := (d + r.end_local)   at time zone 'Europe/London';

      if not exists (
           select 1 from availability_blocks a
           where a.instructor_id = r.instructor_id
             and tstzrange(a.start_time, a.end_time, '[)') && tstzrange(b_start, b_end, '[)'))
         and not exists (
           select 1 from bookings b
           where b.instructor_id = r.instructor_id
             and b.status = 'confirmed'
             and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(b_start, b_end, '[)')) then
        insert into availability_blocks (instructor_id, start_time, end_time, reason, created_by)
        values (r.instructor_id, b_start, b_end, r.reason, null);
        inserted := inserted + 1;
      end if;
      d := d + 1;
    end loop;

    update recurring_breaks set generated_through = today + p_days where id = r.id;
  end loop;

  return inserted;
end;
$$;

revoke execute on function public.generate_recurring_breaks(integer) from public, anon, authenticated;

-- Talha Khan: prayer, 14:00-14:30 every day.
insert into public.recurring_breaks (instructor_id, start_local, end_local, reason)
select u.id, time '14:00', time '14:30', 'Prayer'
from public.users u
where u.username = 'talha'
  and not exists (select 1 from public.recurring_breaks rb where rb.instructor_id = u.id);

select public.generate_recurring_breaks();

-- Keep the next 90 days filled.
select cron.unschedule(jobname) from cron.job where jobname = 'sdk-recurring-breaks';
select cron.schedule(
  'sdk-recurring-breaks',
  '15 2 * * *',
  $$ select public.generate_recurring_breaks(); $$
);

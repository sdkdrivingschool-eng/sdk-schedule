-- 20260930000022_inactive_instructors.sql
--
-- An instructor can be switched off for a while (e.g. no car) without
-- deleting anything. An inactive instructor is never "free", so:
--   * the public booking page offers none of their times,
--   * staff cannot assign online lessons to them,
--   * manual lessons are not routed to them.
-- The staff Schedule page hides them too (src/pages/Schedule.jsx). Their
-- account, sign-in and history are untouched. Reactivate with:
--   update public.users set active = true where username = '<name>';

alter table public.users
  add column if not exists active boolean not null default true;

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
     and exists (select 1 from users u where u.id = p_instructor and u.active)
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

-- Taha Khan: car written off, out for some months (November 2026).
update public.users set active = false where username = 'taha';

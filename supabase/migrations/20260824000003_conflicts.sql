-- 20260824000003_conflicts.sql
-- Double-booking prevention, enforced in the database.
--
-- The UI also pre-checks for conflicts so it can show a friendly message, but
-- a client-side check alone is racy: two admins submitting at the same moment
-- would both pass. These constraints make an overlap impossible to persist.
--
-- Half-open ranges '[)' throughout, so a lesson ending at 10:00 and one
-- starting at 10:00 are NOT considered overlapping.

-- Same-table overlaps: handled by exclusion constraints (cheap, index-backed).
-- Cancelled bookings are excluded so a slot frees up when a lesson is cancelled.
alter table public.bookings
  drop constraint if exists bookings_no_overlap;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    instructor_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status = 'confirmed');

alter table public.availability_blocks
  drop constraint if exists availability_no_overlap;

alter table public.availability_blocks
  add constraint availability_no_overlap
  exclude using gist (
    instructor_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  );

-- ---------------------------------------------------------------------------
-- Cross-table overlaps: an exclusion constraint cannot span two tables, so a
-- trigger covers booking-vs-unavailable in both directions.
--
-- Raises SQLSTATE 23P01 (exclusion_violation) with a SCHEDULE_CONFLICT prefix
-- so the client can distinguish it from any other write failure.
-- ---------------------------------------------------------------------------
create or replace function public.check_cross_schedule_conflict()
returns trigger
language plpgsql
as $$
declare
  clash_count integer;
begin
  if tg_table_name = 'bookings' then
    -- A cancelled booking can sit anywhere; it occupies no time.
    if new.status <> 'confirmed' then
      return new;
    end if;

    select count(*) into clash_count
    from public.availability_blocks ab
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
    from public.bookings b
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

drop trigger if exists bookings_conflict_check on public.bookings;
create trigger bookings_conflict_check
  before insert or update of instructor_id, start_time, end_time, status
  on public.bookings
  for each row execute function public.check_cross_schedule_conflict();

drop trigger if exists availability_conflict_check on public.availability_blocks;
create trigger availability_conflict_check
  before insert or update of instructor_id, start_time, end_time
  on public.availability_blocks
  for each row execute function public.check_cross_schedule_conflict();

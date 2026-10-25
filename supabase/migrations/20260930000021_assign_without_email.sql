-- 20260930000021_assign_without_email.sql
--
-- Staff can assign (or reassign) an online lesson with or without emailing
-- the customer. Two buttons in the Assign dialog: "Assign" and
-- "Assign & email customer".
--
-- The customer email is queued by the bookings trigger, not by
-- assign_booking itself, so the choice is passed to the trigger through a
-- transaction-local setting (sdk.skip_customer_email). It lasts only for the
-- assignment's own transaction, so every other change (moving, cancelling,
-- staff edits) emails exactly as before.
--
-- A new 3-argument assign_booking sits beside the old 2-argument one (which
-- still always emails), so nothing is dropped.

create or replace function public.assign_booking(
  p_booking_id     uuid,
  p_instructor_id  uuid,
  p_email_customer boolean
)
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

  perform set_config('sdk.skip_customer_email',
                     case when coalesce(p_email_customer, true) then 'off' else 'on' end,
                     true);
  update bookings set instructor_id = p_instructor_id where id = bk.id;
end;
$$;

revoke execute on function public.assign_booking(uuid, uuid, boolean) from public, anon;
grant execute on function public.assign_booking(uuid, uuid, boolean) to authenticated;

/**
 * After a lesson changes: log (re)assignments and queue customer emails for
 * online bookings. The "instructor confirmed / changed" email is skipped when
 * the assignment asked for no email (see assign_booking above).
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
      if coalesce(current_setting('sdk.skip_customer_email', true), 'off') <> 'on' then
        perform enqueue_email(
          case when old.instructor_id is null then 'lesson_confirmed' else 'instructor_changed' end,
          new.id, new.order_id);
      end if;
    elsif new.instructor_id is not null
          and (new.start_time <> old.start_time or new.end_time <> old.end_time) then
      perform enqueue_email('lesson_rescheduled', new.id, new.order_id);
    end if;
  end if;

  return new;
end;
$$;

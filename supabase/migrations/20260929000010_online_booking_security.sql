-- 20260929000010_online_booking_security.sql
-- RLS and grants for the online-booking tables and functions.
--
-- The public /book page uses the anon key and can do exactly three things:
--   * read active packages and the booking settings,
--   * call get_available_slots / get_available_days (start times only).
-- Everything else a customer does goes through the `booking` Edge Function,
-- which uses the service role and calls the service-only functions below.
--
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default, so every function here is revoked first and granted back only
-- where intended.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.packages            enable row level security;
alter table public.customers           enable row level security;
alter table public.orders              enable row level security;
alter table public.intensive_requests  enable row level security;
alter table public.booking_settings    enable row level security;
alter table public.stripe_events       enable row level security;
alter table public.rate_limits         enable row level security;
alter table public.booking_assignments enable row level security;
alter table public.email_outbox        enable row level security;

revoke all on public.customers, public.orders, public.intensive_requests,
              public.stripe_events, public.rate_limits,
              public.booking_assignments, public.email_outbox
  from anon;
revoke insert, update, delete on public.packages, public.booking_settings from anon;

-- packages: anyone sees active plans; admins see and edit all.
drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages
  for select to anon, authenticated
  using (is_active or public.is_admin());

drop policy if exists packages_admin_write on public.packages;
create policy packages_admin_write on public.packages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.packages to anon;
grant select, insert, update on public.packages to authenticated;

-- booking_settings: readable by all (the page shows notice/horizon), admin edits.
drop policy if exists booking_settings_select on public.booking_settings;
create policy booking_settings_select on public.booking_settings
  for select to anon, authenticated
  using (true);

drop policy if exists booking_settings_admin_update on public.booking_settings;
create policy booking_settings_admin_update on public.booking_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.booking_settings to anon;
grant select, update on public.booking_settings to authenticated;

-- customers / orders: admins, plus the instructor a customer's lesson is
-- assigned to (so they can see who they are teaching and how many hours are
-- left).
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.bookings b
               where b.customer_id = customers.id
                 and b.instructor_id = auth.uid())
  );

drop policy if exists customers_admin_update on public.customers;
create policy customers_admin_update on public.customers
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.bookings b
               where b.order_id = orders.id
                 and b.instructor_id = auth.uid())
  );

-- Admins clear attention flags; payment fields are only ever written by the
-- service role, so the update is limited to that one column.
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.customers, public.orders from authenticated;
grant select on public.customers, public.orders to authenticated;
grant update (name, phone, pickup_address, postcode, area) on public.customers to authenticated;
grant update (attention_reason) on public.orders to authenticated;

-- intensive requests: admin only.
drop policy if exists intensive_admin_select on public.intensive_requests;
create policy intensive_admin_select on public.intensive_requests
  for select to authenticated
  using (public.is_admin());

drop policy if exists intensive_admin_update on public.intensive_requests;
create policy intensive_admin_update on public.intensive_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.intensive_requests from authenticated;
grant select on public.intensive_requests to authenticated;
grant update (status, admin_notes, handled_by, handled_at) on public.intensive_requests to authenticated;

-- assignment history and email log: admins read; admins may re-queue an email.
drop policy if exists assignments_admin_select on public.booking_assignments;
create policy assignments_admin_select on public.booking_assignments
  for select to authenticated
  using (public.is_admin());

drop policy if exists email_outbox_admin_select on public.email_outbox;
create policy email_outbox_admin_select on public.email_outbox
  for select to authenticated
  using (public.is_admin());

drop policy if exists email_outbox_admin_update on public.email_outbox;
create policy email_outbox_admin_update on public.email_outbox
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.booking_assignments, public.email_outbox,
              public.stripe_events, public.rate_limits
  from authenticated;
grant select on public.booking_assignments, public.email_outbox to authenticated;
grant update (status, attempts, last_error) on public.email_outbox to authenticated;

-- stripe_events, rate_limits: RLS on, no policies -> service role only.

-- ---------------------------------------------------------------------------
-- bookings: unassigned lessons (and payment holds) are admin-only.
-- Assigned lessons keep the existing "every signed-in user can see the
-- schedule" rule so the all-instructors view still works.
-- ---------------------------------------------------------------------------
drop policy if exists bookings_select_all on public.bookings;
create policy bookings_select_all on public.bookings
  for select to authenticated
  using (instructor_id is not null or public.is_admin());

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
revoke execute on function
  public.generate_reg_number(),
  public.take_schedule_lock(),
  public.booking_is_active(text, timestamptz),
  public.within_working_hours(timestamptz, timestamptz),
  public.instructor_is_free(uuid, timestamptz, timestamptz, uuid),
  public.free_instructor_count(timestamptz, timestamptz, uuid),
  public.slot_capacity(timestamptz, timestamptz, uuid),
  public.assert_bookable_time(timestamptz, timestamptz),
  public.order_minutes_remaining(uuid),
  public.minutes_label(integer),
  public.online_booking_notes(jsonb, text, text, integer, text),
  public.enqueue_email(text, uuid, uuid, uuid),
  public.get_available_slots(date, integer),
  public.get_available_days(date, date, integer),
  public.create_online_hold(text, timestamptz, integer, jsonb, text),
  public.confirm_order(uuid, text, text),
  public.expire_order(uuid),
  public.expire_stale_holds(),
  public.find_customer(text, text),
  public.customer_summary(text, text),
  public.book_with_credit(text, text, timestamptz, integer, text),
  public.order_status_by_session(text),
  public.create_intensive_request(text, date, jsonb, text),
  public.hit_rate_limit(text, integer, integer),
  public.claim_email_jobs(integer),
  public.admin_unassigned_bookings(),
  public.free_instructors_for_booking(uuid),
  public.assign_booking(uuid, uuid),
  public.check_cross_schedule_conflict(),
  public.stamp_booking_assignment(),
  public.after_booking_change()
from public, anon, authenticated;

-- Public calendar.
grant execute on function
  public.get_available_slots(date, integer),
  public.get_available_days(date, date, integer)
to anon, authenticated;

-- Staff screens (each checks is_admin() itself where it matters).
grant execute on function
  public.admin_unassigned_bookings(),
  public.free_instructors_for_booking(uuid),
  public.assign_booking(uuid, uuid),
  public.order_minutes_remaining(uuid)
to authenticated;

-- Edge Functions.
grant execute on function
  public.get_available_slots(date, integer),
  public.get_available_days(date, date, integer),
  public.create_online_hold(text, timestamptz, integer, jsonb, text),
  public.confirm_order(uuid, text, text),
  public.expire_order(uuid),
  public.expire_stale_holds(),
  public.customer_summary(text, text),
  public.book_with_credit(text, text, timestamptz, integer, text),
  public.order_status_by_session(text),
  public.create_intensive_request(text, date, jsonb, text),
  public.hit_rate_limit(text, integer, integer),
  public.claim_email_jobs(integer),
  public.order_minutes_remaining(uuid)
to service_role;

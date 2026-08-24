-- 20260824000005_rls_tighten_insert.sql
-- Close a privilege hole in the original write policies.
--
-- The spec's write rule was: instructor_id = auth.uid() OR created_by = auth.uid().
-- Implemented literally (see 20260824000002_rls.sql) that rule is too loose on
-- writes that CREATE or RESHAPE a row, because `created_by` DEFAULTS to
-- auth.uid(): the "created_by = auth.uid()" branch is therefore always true for
-- whoever performs the write, regardless of which instructor_id they set. An
-- instructor could POST a booking with someone else's instructor_id, or PATCH
-- their own booking to move it into a colleague's column, straight through the
-- REST API (the UI blocks it, but RLS must stand on its own).
--
-- Fix: split the two concerns.
--   USING      (which existing rows I may act on): unchanged — can_write(), i.e.
--              admin, rows in my column, or rows I created. Faithful to spec.
--   WITH CHECK (what a row may look like AFTER my insert/update): the row must
--              live in MY column, unless I'm an admin. This is the invariant
--              that actually enforces "instructors manage only their own diary".
--
-- SELECT and DELETE policies are unchanged.

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (public.is_admin() or instructor_id = auth.uid());

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using (public.can_write(instructor_id, created_by))
  with check (public.is_admin() or instructor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- availability_blocks
-- ---------------------------------------------------------------------------
drop policy if exists availability_insert on public.availability_blocks;
create policy availability_insert on public.availability_blocks
  for insert to authenticated
  with check (public.is_admin() or instructor_id = auth.uid());

drop policy if exists availability_update on public.availability_blocks;
create policy availability_update on public.availability_blocks
  for update to authenticated
  using (public.can_write(instructor_id, created_by))
  with check (public.is_admin() or instructor_id = auth.uid());

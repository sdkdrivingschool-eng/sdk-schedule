-- 20260824000002_rls.sql
-- Row Level Security for SDK Driving School
--
-- Read model:  all 5 users can select every row in availability_blocks and
--              bookings — everyone needs visibility into who is free.
-- Write model: admins  -> all rows
--              instructors -> rows where instructor_id = auth.uid()
--                             OR created_by = auth.uid()

-- ---------------------------------------------------------------------------
-- is_admin(): SECURITY DEFINER so the users-table lookup does not re-enter
-- RLS on public.users (which would recurse infinitely inside its own policy).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- can_write(): shared predicate for both schedule tables.
create or replace function public.can_write(
  row_instructor_id uuid,
  row_created_by    uuid
)
returns boolean
language sql
stable
as $$
  select public.is_admin()
      or row_instructor_id = auth.uid()
      or row_created_by    = auth.uid();
$$;

revoke all on function public.can_write(uuid, uuid) from public;
grant execute on function public.can_write(uuid, uuid) to authenticated;

alter table public.users              enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.bookings            enable row level security;

-- ---------------------------------------------------------------------------
-- users — readable by all authenticated users (needed for instructor tabs
-- and the instructor dropdowns). Only admins may modify.
-- ---------------------------------------------------------------------------
drop policy if exists users_select_all       on public.users;
drop policy if exists users_admin_insert     on public.users;
drop policy if exists users_admin_update     on public.users;
drop policy if exists users_admin_delete     on public.users;

create policy users_select_all on public.users
  for select to authenticated
  using (true);

create policy users_admin_insert on public.users
  for insert to authenticated
  with check (public.is_admin());

create policy users_admin_update on public.users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy users_admin_delete on public.users
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- availability_blocks
-- ---------------------------------------------------------------------------
drop policy if exists availability_select_all on public.availability_blocks;
drop policy if exists availability_insert     on public.availability_blocks;
drop policy if exists availability_update     on public.availability_blocks;
drop policy if exists availability_delete     on public.availability_blocks;

create policy availability_select_all on public.availability_blocks
  for select to authenticated
  using (true);

create policy availability_insert on public.availability_blocks
  for insert to authenticated
  with check (public.can_write(instructor_id, created_by));

create policy availability_update on public.availability_blocks
  for update to authenticated
  using (public.can_write(instructor_id, created_by))
  with check (public.can_write(instructor_id, created_by));

create policy availability_delete on public.availability_blocks
  for delete to authenticated
  using (public.can_write(instructor_id, created_by));

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
drop policy if exists bookings_select_all on public.bookings;
drop policy if exists bookings_insert     on public.bookings;
drop policy if exists bookings_update     on public.bookings;
drop policy if exists bookings_delete     on public.bookings;

create policy bookings_select_all on public.bookings
  for select to authenticated
  using (true);

create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (public.can_write(instructor_id, created_by));

create policy bookings_update on public.bookings
  for update to authenticated
  using (public.can_write(instructor_id, created_by))
  with check (public.can_write(instructor_id, created_by));

create policy bookings_delete on public.bookings
  for delete to authenticated
  using (public.can_write(instructor_id, created_by));

-- No grants to anon: the app is internal, every screen requires a session.
grant select                         on public.users               to authenticated;
grant select, insert, update, delete on public.availability_blocks to authenticated;
grant select, insert, update, delete on public.bookings            to authenticated;

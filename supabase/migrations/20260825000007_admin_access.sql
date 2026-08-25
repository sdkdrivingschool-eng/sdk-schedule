-- Separate the admin permission from the job title.
--
-- Admin rights were derived from role = 'admin', which forced a choice:
-- someone was either an admin or an instructor, never both. Granting an
-- instructor admin rights that way would drop them out of the instructor
-- list (the UI builds it from role = 'instructor') and hide their existing
-- lessons.
--
-- `role` now describes the job — who appears as a bookable instructor —
-- while `admin_access` is the permission RLS reads.

alter table public.users
  add column admin_access boolean not null default false;

-- Everyone who was an admin by role keeps their rights.
update public.users set admin_access = true where role = 'admin';

-- Shamim Khan holds admin rights while remaining a bookable instructor.
update public.users set admin_access = true where username = 'shamim';

-- Single source of truth for the permission. Still SECURITY DEFINER with a
-- pinned search_path so RLS policies can call it without recursing through
-- the users table's own policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and admin_access
  );
$$;

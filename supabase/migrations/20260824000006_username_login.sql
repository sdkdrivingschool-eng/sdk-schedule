-- Username-based sign-in.
--
-- Supabase Auth is keyed on email, so the login form collects a username and
-- resolves it to the account's email before calling signInWithPassword.

alter table public.users add column username text unique;

-- Seed usernames for the accounts that existed at the time of this migration.
update public.users set username = 'taha'    where email = 'casey@example.com';
update public.users set username = 'talha'   where email = 'jordan@example.com';
update public.users set username = 'shamim'  where email = 'riley@example.com';
update public.users set username = 't-admin' where email = 'admin.alex@example.com';
update public.users set username = 'h-admin' where email = 'admin.sam@example.com';

alter table public.users alter column username set not null;

-- Lookups lowercase their input, so storing anything else would be unreachable.
alter table public.users
  add constraint users_username_lowercase check (username = lower(username));

-- SECURITY DEFINER so the sign-in form can resolve a username before the
-- visitor is authenticated — the users table's SELECT policy is
-- authenticated-only. Returns just the one email, never a row, so no other
-- column is reachable pre-auth.
create or replace function public.email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from public.users where username = lower(p_username) limit 1;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;

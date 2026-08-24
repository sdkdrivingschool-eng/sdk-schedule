-- 20260824000004_user_sync.sql
-- Keep public.users in sync with auth.users.
--
-- Users are created manually (dashboard or Admin API) — there is no public
-- signup. This trigger means whoever creates them only has to set
-- user_metadata { name, role } and the public.users row appears automatically,
-- so the role that drives redirects and RLS can never be silently missing.
--
-- role defaults to 'instructor': if metadata is forgotten, the new account
-- gets the *least* privileged role rather than accidental admin.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
             split_part(new.email, '@', 1)),
    case
      when new.raw_user_meta_data ->> 'role' in ('admin', 'instructor')
        then new.raw_user_meta_data ->> 'role'
      else 'instructor'
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        name  = excluded.name,
        role  = excluded.role;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Mirror email changes made in the dashboard.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

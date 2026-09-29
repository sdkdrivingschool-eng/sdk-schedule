-- 20260929000012_fix_new_user_username.sql
-- users.username became NOT NULL in 20260824000006, but the auth sync trigger
-- never set it, so creating any new staff account would fail. Take it from
-- user_metadata.username, falling back to the email's local part.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, name, role, username)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
             split_part(new.email, '@', 1)),
    case
      when new.raw_user_meta_data ->> 'role' in ('admin', 'instructor')
        then new.raw_user_meta_data ->> 'role'
      else 'instructor'
    end,
    lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''),
                   split_part(new.email, '@', 1)))
  )
  on conflict (id) do update
    set email = excluded.email,
        name  = excluded.name,
        role  = excluded.role;

  return new;
end;
$$;

-- 20260929000013_fix_booking_notes.sql
-- Concatenating text with a NULL "hours left" suffix blanked the whole
-- "Package:" line for single lessons. Default the suffix to ''.

create or replace function public.online_booking_notes(
  p_contact           jsonb,
  p_reg_number        text,
  p_package_name      text,
  p_remaining_minutes integer,
  p_message           text
)
returns text
language sql
immutable
as $$
  select concat_ws(E'\n',
    'Online booking · Ref ' || p_reg_number,
    'Email: '   || nullif(p_contact ->> 'email', ''),
    'Phone: '   || nullif(p_contact ->> 'phone', ''),
    'Pickup: '  || nullif(concat_ws(', ',
                     nullif(p_contact ->> 'pickup_address', ''),
                     nullif(p_contact ->> 'postcode', '')), ''),
    'Area: '    || case p_contact ->> 'area' when 'surrey' then 'Surrey' else 'Standard' end,
    'Package: ' || p_package_name
                || coalesce(' — ' || minutes_label(p_remaining_minutes) || ' left after this lesson', ''),
    'Customer note: ' || nullif(btrim(p_message), ''));
$$;

revoke execute on function public.online_booking_notes(jsonb, text, text, integer, text)
  from public, anon, authenticated;

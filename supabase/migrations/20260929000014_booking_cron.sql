-- 20260929000013_booking_cron.sql
-- Background jobs.
--
--  * every 5 min: tidy lapsed payment holds (availability already ignores
--    them; this just keeps statuses honest).
--  * every 2 min: nudge the process-emails Edge Function. Emails are normally
--    sent straight away by whatever queued them; this is the safety net for
--    a send that failed or a function that was cold. The endpoint only sends
--    what is already queued, so it needs no secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname)
from cron.job
where jobname in ('sdk-expire-holds', 'sdk-process-emails');

select cron.schedule(
  'sdk-expire-holds',
  '*/5 * * * *',
  $$ select public.expire_stale_holds(); $$
);

select cron.schedule(
  'sdk-process-emails',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://wdbdmosddtktumfnioqi.supabase.co/functions/v1/process-emails',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.email_outbox where status in ('pending', 'sending'));
  $$
);

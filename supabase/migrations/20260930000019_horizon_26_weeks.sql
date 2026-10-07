-- 20260930000019_horizon_26_weeks.sql
-- Customers can book 26 weeks (182 days) ahead, and recurring breaks
-- (Talha's prayer time) are generated 200 days ahead so they always cover it.
update public.booking_settings set horizon_days = 182 where id;

select public.generate_recurring_breaks(200);

select cron.unschedule(jobname) from cron.job where jobname = 'sdk-recurring-breaks';
select cron.schedule(
  'sdk-recurring-breaks',
  '15 2 * * *',
  $$ select public.generate_recurring_breaks(200); $$
);

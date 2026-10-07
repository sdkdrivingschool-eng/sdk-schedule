-- 20260930000018_test_payments_off.sql
-- Live Stripe is connected; make sure the test-payment bypass is off.
-- (The UI toggle and the Edge Function bypass have been removed.)
update public.booking_settings set test_payments = false where id;

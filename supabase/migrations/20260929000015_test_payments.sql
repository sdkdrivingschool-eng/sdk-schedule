-- 20260929000015_test_payments.sql
-- Test payment mode, for trying the whole booking flow before Stripe is set up.
--
-- When this is on AND the booking Edge Function has no STRIPE_SECRET_KEY,
-- pressing "Pay" marks the order paid immediately (payment intent
-- 'test_payment') instead of going to Stripe. As soon as a Stripe key is
-- configured the flag is ignored and real Stripe Checkout is used, so a
-- forgotten flag can never give away free lessons once payments are live.
--
-- Switch it off from Prices & settings before the booking page goes public.

alter table public.booking_settings
  add column if not exists test_payments boolean not null default false;

update public.booking_settings set test_payments = true where id;

-- 20260929000011_seed_packages.sql
-- SDK's price list (GBP, stored in pence). Edit prices later from the
-- Packages screen — this only seeds the starting values and never overwrites
-- a package that already exists.
--
-- The pay-as-you-go 10/20/30 hr blocks cost the same as Basic/Standard/
-- Premium, so they are the same packages rather than duplicates.

insert into public.packages
  (slug, name, category, area, lesson_minutes, total_minutes, course_lessons,
   price_pence, was_price_pence, features, sort_order)
values
  -- Pay as you go (standard area)
  ('payg-1h',     '1 hour lesson',     'single', 'standard', 60,  null, null,  5000, null,
   array['One 1-hour lesson', 'Pick your own time', 'Pay online to secure it'], 10),
  ('payg-1-5h',   '1.5 hour lesson',   'single', 'standard', 90,  null, null,  6500, null,
   array['One 1.5-hour lesson', 'Pick your own time', 'Pay online to secure it'], 11),
  ('payg-2h',     '2 hour lesson',     'single', 'standard', 120, null, null,  8000, null,
   array['One 2-hour lesson', 'Pick your own time', 'Pay online to secure it'], 12),
  ('payg-2-5h',   '2.5 hour lesson',   'single', 'standard', 150, null, null, 10000, null,
   array['One 2.5-hour lesson', 'Pick your own time', 'Pay online to secure it'], 13),

  -- Packages (standard area)
  ('basic',       'Basic',             'block',  'standard', null, 600,  null,  38000, 40000,
   array['10 hours of lessons', 'e.g. 5 × 2-hour lessons', 'Book the rest whenever suits you'], 20),
  ('standard',    'Standard',          'block',  'standard', null, 1200, null,  75000, 80000,
   array['20 hours of lessons', 'e.g. 10 × 2-hour lessons', 'Book the rest whenever suits you'], 21),
  ('premium',     'Premium',           'block',  'standard', null, 1800, null, 112000, 120000,
   array['30 hours of lessons', 'e.g. 15 × 2-hour lessons', 'Book the rest whenever suits you'], 22),

  -- Surrey
  ('surrey-1h',   'Surrey 1 hour lesson',   'single', 'surrey', 60,  null, null,  5500, null,
   array['One 1-hour lesson in Surrey', 'Pick your own time'], 30),
  ('surrey-1-5h', 'Surrey 1.5 hour lesson', 'single', 'surrey', 90,  null, null,  7000, null,
   array['One 1.5-hour lesson in Surrey', 'Pick your own time'], 31),
  ('surrey-2h',   'Surrey 2 hour lesson',   'single', 'surrey', 120, null, null,  8500, null,
   array['One 2-hour lesson in Surrey', 'Pick your own time'], 32),
  ('surrey-2-5h', 'Surrey 2.5 hour lesson', 'single', 'surrey', 150, null, null, 10500, null,
   array['One 2.5-hour lesson in Surrey', 'Pick your own time'], 33),
  ('surrey-10h',  'Surrey 10 hours',        'block',  'surrey', null, 600,  null, 40000, null,
   array['10 hours of lessons in Surrey', 'Book the rest whenever suits you'], 34),
  ('surrey-20h',  'Surrey 20 hours',        'block',  'surrey', null, 1200, null, 79000, null,
   array['20 hours of lessons in Surrey', 'Book the rest whenever suits you'], 35),

  -- Intensive courses (request only; car hire included)
  ('intensive-10', 'Intensive 10 hours', 'intensive', 'any', null, 600,  5,  75000, null,
   array['5 lessons over 5 days', 'Car hire for the test included', 'We call you to arrange dates'], 40),
  ('intensive-20', 'Intensive 20 hours', 'intensive', 'any', null, 1200, 10, 125000, null,
   array['10 lessons over 10 days', 'Car hire for the test included', 'We call you to arrange dates'], 41),
  ('intensive-30', 'Intensive 30 hours', 'intensive', 'any', null, 1800, 15, 160000, null,
   array['15 lessons over 15 days', 'Car hire for the test included', 'We call you to arrange dates'], 42)
on conflict (slug) do nothing;

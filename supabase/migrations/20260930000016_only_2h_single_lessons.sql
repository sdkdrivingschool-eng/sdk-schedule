-- 20260930000016_only_2h_single_lessons.sql
-- Single lessons are now 2 hours only. Hide the 1, 1.5 and 2.5 hour lessons
-- from /book (both areas); they can be shown again from the Packages screen.

update public.packages
set is_active = false
where slug in ('payg-1h', 'payg-1-5h', 'payg-2-5h',
               'surrey-1h', 'surrey-1-5h', 'surrey-2-5h');

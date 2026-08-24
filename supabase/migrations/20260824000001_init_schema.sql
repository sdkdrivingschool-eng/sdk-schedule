-- 20260824000001_init_schema.sql
-- SDK Driving School — core schema
-- Tables: users, availability_blocks, bookings

create extension if not exists "btree_gist";

-- ---------------------------------------------------------------------------
-- users: mirrors auth.users, holds the role that drives redirects + RLS.
-- Rows are created manually (no public signup).
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text not null,
  role       text not null check (role in ('admin', 'instructor')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- availability_blocks: instructor marked unavailable for a time range.
-- created_by is not in the original spec's column list, but the RLS rules
-- reference it for both tables, so it is added here for consistency.
-- ---------------------------------------------------------------------------
create table if not exists public.availability_blocks (
  id            uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.users (id) on delete cascade,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  reason        text not null default 'Other'
                  check (reason in ('Personal', 'Sick', 'Training', 'Other')),
  created_by    uuid references public.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint availability_time_order check (end_time > start_time)
);

-- ---------------------------------------------------------------------------
-- bookings: a lesson. Student is free text — no students table in v1.
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.users (id) on delete cascade,
  student_name  text not null,
  student_phone text,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  status        text not null default 'confirmed'
                  check (status in ('confirmed', 'cancelled')),
  notes         text,
  created_by    uuid references public.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint booking_time_order check (end_time > start_time)
);

-- Week-range queries filter on instructor + time, so index both.
create index if not exists availability_blocks_instructor_time_idx
  on public.availability_blocks (instructor_id, start_time);

create index if not exists bookings_instructor_time_idx
  on public.bookings (instructor_id, start_time);

create index if not exists bookings_status_idx
  on public.bookings (status);

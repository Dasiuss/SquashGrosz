-- SquashGrosz: jedna tabela + RLS (read dla wszystkich, write tylko dla zalogowanych)
-- Wklej do Supabase Dashboard -> SQL Editor -> Run.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  game_date date not null,
  is_weekend boolean not null,
  rate numeric not null check (rate > 0),
  courts numeric not null check (courts in (1, 2, 3)),
  hours numeric not null check (hours > 0 and hours <= 5),
  total numeric not null check (total >= 0),
  created_at timestamptz not null default now(),

  dom_present boolean not null default false,
  dom_ms integer not null default 0 check (dom_ms >= 0 and dom_ms <= 10),
  dom_paid boolean not null default false,

  hy_present boolean not null default false,
  hy_ms integer not null default 0 check (hy_ms >= 0 and hy_ms <= 10),
  hy_paid boolean not null default false,

  ber_present boolean not null default false,
  ber_ms integer not null default 0 check (ber_ms >= 0 and ber_ms <= 10),
  ber_paid boolean not null default false,

  pa_present boolean not null default false,
  pa_ms integer not null default 0 check (pa_ms >= 0 and pa_ms <= 10),
  pa_paid boolean not null default false
);

alter table public.meetings enable row level security;

drop policy if exists "public read" on public.meetings;
create policy "public read"
  on public.meetings for select
  to anon, authenticated
  using (true);

drop policy if exists "admin insert" on public.meetings;
create policy "admin insert"
  on public.meetings for insert
  to authenticated
  with check (true);

drop policy if exists "admin update" on public.meetings;
create policy "admin update"
  on public.meetings for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "admin delete" on public.meetings;
create policy "admin delete"
  on public.meetings for delete
  to authenticated
  using (true);

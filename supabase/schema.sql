-- =============================================================================
-- Navimoto – Supabase-schema (optioneel)
--
-- Dit schema is voorbereid voor toekomstige cloud-synchronisatie van profielen, routes en
-- gereden ritten. De app slaat op dit moment alle data lokaal op (IndexedDB via Dexie);
-- alleen de accounts (inloggen/registreren) lopen via Supabase Auth als VITE_SUPABASE_URL en
-- VITE_SUPABASE_ANON_KEY gezet zijn. Zonder deze tabellen werkt de app dus gewoon.
--
-- Uitvoeren in de SQL-editor van je Supabase-project (of via `supabase db push`).
-- Alle tabellen hebben Row Level Security: een gebruiker ziet en bewerkt alleen eigen rijen.
-- Tijden: created_at/updated_at als timestamptz; de app rekent in epoch-ms en converteert zelf.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- profiles: 1 rij per gebruiker (id = auth.users.id)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null default '',
  display_name   text not null default '',
  rider_type     text not null default 'street'  check (rider_type in ('street', 'offroad', 'allroad')),
  default_style  text not null default 'bochtig' check (default_style in ('avontuurlijk', 'bochtig', 'snel')),
  default_avoid  jsonb not null default '{"ferries": false, "highways": false, "tolls": false, "unpaved": false}'::jsonb,
  voice_enabled  boolean not null default true,
  map_style      text not null default 'osm' check (map_style in ('osm', 'topo', 'cyclosm')),
  simulate_rides boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- routes: geplande routes, rondritten en GPX-imports
-- ----------------------------------------------------------------------------
create table if not exists public.routes (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('planned', 'roundtrip', 'gpx')),
  waypoints   jsonb not null default '[]'::jsonb,   -- [{ lat, lon, name? }]
  style       text check (style in ('avontuurlijk', 'bochtig', 'snel')),
  avoid       jsonb,                                 -- { ferries, highways, tolls, unpaved } of null
  geometry    jsonb not null default '[]'::jsonb,   -- [{ lat, lon }]
  distance_km double precision not null default 0,
  duration_s  double precision,
  maneuvers   jsonb,                                 -- Maneuver[] of null (gpx zonder map-matching)
  gpx         text,                                  -- oorspronkelijke GPX-tekst bij import
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists routes_user_updated_idx on public.routes (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- tracks: gereden ritten (opnames)
-- ----------------------------------------------------------------------------
create table if not exists public.tracks (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  points        jsonb not null default '[]'::jsonb,  -- [{ lat, lon, t, ele?, speedKmh?, headingDeg? }]
  distance_km   double precision not null default 0,
  duration_s    double precision not null default 0,
  moving_s      double precision not null default 0,
  avg_speed_kmh double precision not null default 0,
  max_speed_kmh double precision not null default 0,
  route_id      uuid references public.routes (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists tracks_user_started_idx on public.tracks (user_id, started_at desc);

-- ----------------------------------------------------------------------------
-- updated_at automatisch bijwerken
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists routes_set_updated_at on public.routes;
create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Profiel automatisch aanmaken bij registratie (display_name uit de sign-up metadata)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security: iedereen ziet en bewerkt alleen eigen rijen
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.routes   enable row level security;
alter table public.tracks   enable row level security;

-- profiles (eigenaar = id)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

-- routes (eigenaar = user_id)
drop policy if exists "routes_select_own" on public.routes;
create policy "routes_select_own" on public.routes
  for select using (auth.uid() = user_id);

drop policy if exists "routes_insert_own" on public.routes;
create policy "routes_insert_own" on public.routes
  for insert with check (auth.uid() = user_id);

drop policy if exists "routes_update_own" on public.routes;
create policy "routes_update_own" on public.routes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "routes_delete_own" on public.routes;
create policy "routes_delete_own" on public.routes
  for delete using (auth.uid() = user_id);

-- tracks (eigenaar = user_id)
drop policy if exists "tracks_select_own" on public.tracks;
create policy "tracks_select_own" on public.tracks
  for select using (auth.uid() = user_id);

drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own" on public.tracks
  for insert with check (auth.uid() = user_id);

drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own" on public.tracks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tracks_delete_own" on public.tracks;
create policy "tracks_delete_own" on public.tracks
  for delete using (auth.uid() = user_id);

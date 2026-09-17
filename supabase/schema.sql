-- =============================================================================
-- Navimoto – Supabase-schema
--
-- Draait in het gedeelde Supabase-project van Vos Oss Motoren; daarom hebben alle tabellen en
-- functies het voorvoegsel `navimoto_` zodat ze niet botsen met de website-tabellen.
-- Accounts lopen via Supabase Auth (gedeeld met de website). De app werkt local-first:
-- alles staat in IndexedDB en wordt daarnaast naar deze tabellen gesynchroniseerd.
--
-- Toegepast als migratie `navimoto_schema` (17-09-2026). Handmatig uitvoeren kan via de SQL-editor.
-- Alle tabellen hebben Row Level Security: een gebruiker ziet en bewerkt alleen eigen rijen.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- navimoto_profiles: 1 rij per gebruiker (id = auth.users.id)
-- ----------------------------------------------------------------------------
create table if not exists public.navimoto_profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null default '',
  display_name   text not null default '',
  rider_type     text not null default 'street'  check (rider_type in ('street', 'offroad', 'allroad')),
  default_style  text not null default 'bochtig' check (default_style in ('avontuurlijk', 'bochtig', 'snel')),
  default_avoid  jsonb not null default '{"ferries": false, "highways": false, "tolls": false, "unpaved": false}'::jsonb,
  voice_enabled  boolean not null default true,
  map_style      text not null default 'light' check (map_style in ('light', 'osm', 'topo', 'cyclosm')),
  simulate_rides boolean not null default false,
  home           jsonb,                              -- thuislocatie { lat, lon, name? } of null (niet ingesteld)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Toegevoegd na de eerste migratie (kolom bestaat al in het Supabase-project):
alter table public.navimoto_profiles add column if not exists home jsonb;

-- ----------------------------------------------------------------------------
-- navimoto_routes: geplande routes, rondritten en GPX-imports
-- ----------------------------------------------------------------------------
create table if not exists public.navimoto_routes (
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

create index if not exists navimoto_routes_user_updated_idx on public.navimoto_routes (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- navimoto_tracks: gereden ritten (opnames)
-- ----------------------------------------------------------------------------
create table if not exists public.navimoto_tracks (
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
  route_id      uuid,                                -- verwijst naar navimoto_routes.id (geen FK: route mag verwijderd zijn)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists navimoto_tracks_user_started_idx on public.navimoto_tracks (user_id, started_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security: iedereen ziet en bewerkt alleen eigen rijen
-- ----------------------------------------------------------------------------
alter table public.navimoto_profiles enable row level security;
alter table public.navimoto_routes   enable row level security;
alter table public.navimoto_tracks   enable row level security;

drop policy if exists "navimoto_profiles_own" on public.navimoto_profiles;
create policy "navimoto_profiles_own" on public.navimoto_profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "navimoto_routes_own" on public.navimoto_routes;
create policy "navimoto_routes_own" on public.navimoto_routes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "navimoto_tracks_own" on public.navimoto_tracks;
create policy "navimoto_tracks_own" on public.navimoto_tracks
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

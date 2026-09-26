-- Killer — database schema (Supabase / Postgres)
-- Paste into Supabase > SQL Editor and run. Safe to run again after an update: it migrates in place.
--
-- >>> BEFORE RUNNING: put your own email below. That account becomes the administrator. <<<

create table if not exists public.accounts (
  email       text primary key,
  name        text not null default '',
  role        text not null default 'member' check (role in ('admin', 'member', 'observer')),
  tabs        jsonb,                        -- observers only: list of tab ids they may open (null = all)
  avatar_path text,
  created_at  timestamptz not null default now()
);

insert into public.accounts (email, role)
values ('victor.lemanceau02@gmail.com', 'admin')          -- <<< CHANGE THIS
on conflict (email) do update set role = 'admin';

-- Migration from the earlier "allowed_emails" table, if present.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'allowed_emails') then
    insert into public.accounts (email, name, role)
      select email, coalesce(name, ''), case when role = 'admin' then 'admin' else 'member' end from public.allowed_emails
      on conflict (email) do nothing;
    drop table public.allowed_emails cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who is who. A confirmed sign-in whose email is in accounts gets that row's role.
-- (Email confirmation is what stops someone from registering with a teammate's address.)
-- ---------------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public, auth as $$
  select a.role from auth.users u
  join public.accounts a on lower(a.email) = lower(u.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;
create or replace function public.is_member() returns boolean language sql stable as $$ select public.my_role() is not null; $$;
create or replace function public.can_edit() returns boolean language sql stable as $$ select public.my_role() in ('admin', 'member'); $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select public.my_role() = 'admin'; $$;

revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Game tables
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  year         text default '',
  dept         text default '',
  td           text default '',
  tp           text default '',
  option       text default '',
  lang_group   text default '',
  address      text default '',
  address_type text not null default 'normale' check (address_type in ('normale', 'residence', 'coloc', 'immeuble')),
  lat          double precision,
  lng          double precision,
  notes        text default '',
  weapons      text default '',
  points       integer not null default 0,
  is_ally      boolean not null default false,
  photo_path   text,
  created_at   timestamptz not null default now()
);
-- earlier versions
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'sector') then
    alter table public.players rename column sector to address;
  end if;
end $$;
alter table public.players add column if not exists lat double precision;
alter table public.players add column if not exists lng double precision;
alter table public.players add column if not exists address_type text not null default 'normale';

create table if not exists public.rounds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   integer not null,
  created_at timestamptz not null default now()
);

-- One link = "hunter targets target" within a round. Each player has at most one target and one hunter per round.
create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds(id) on delete cascade,
  hunter_id  uuid not null references public.players(id) on delete cascade,
  target_id  uuid not null references public.players(id) on delete cascade,
  confidence text not null default 'sur' check (confidence in ('sur', 'probable', 'rumeur')),
  source     text default '',
  created_at timestamptz not null default now(),
  check (hunter_id <> target_id),
  unique (round_id, hunter_id),
  unique (round_id, target_id)
);

-- A player is dead when a kill names them as victim; nothing else tracks it.
create table if not exists public.kills (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid references public.rounds(id) on delete set null,
  killer_id   uuid references public.players(id) on delete set null,
  victim_id   uuid not null unique references public.players(id) on delete cascade,
  weapon      text default '',
  points      integer not null default 0,
  admin_reason text check (admin_reason is null or admin_reason in ('cheating', 'other')),
  note        text default '',
  happened_at timestamptz not null default now()
);
alter table public.kills add column if not exists admin_reason text check (admin_reason is null or admin_reason in ('cheating', 'other'));

create table if not exists public.weapons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  difficulty text not null default 'facile' check (difficulty in ('facile', 'difficile'))
);

-- Places rather than people (canteen, gym, bus stop). Kept from one year to the next.
create table if not exists public.spots (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  note       text default '',
  address    text default '',
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb
);

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  actor      text default '',
  details    jsonb,
  created_at timestamptz not null default now()
);
alter table public.events add column if not exists details jsonb;

-- ---------------------------------------------------------------------------
-- Row-level security. Nobody outside the accounts table reads anything, even with the anon key.
-- members and admins write game data; only admins write settings and accounts.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'events', 'spots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "membres" on public.%I', t);
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "write" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "write" on public.%I for all to authenticated using (public.can_edit()) with check (public.can_edit())', t);
  end loop;
end $$;

alter table public.settings enable row level security;
drop policy if exists "membres" on public.settings;
drop policy if exists "read" on public.settings;
drop policy if exists "write" on public.settings;
create policy "read"  on public.settings for select to authenticated using (public.is_member());
create policy "write" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.accounts enable row level security;
drop policy if exists "read" on public.accounts;
drop policy if exists "admin" on public.accounts;
drop policy if exists "own row" on public.accounts;
create policy "read"    on public.accounts for select to authenticated using (public.is_member());
create policy "admin"   on public.accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "own row" on public.accounts for update to authenticated using (lower(email) = lower(auth.email())) with check (lower(email) = lower(auth.email()));

-- A non-admin may only change their own name and avatar.
create or replace function public.protect_account() returns trigger language plpgsql as $$
begin
  if not public.is_admin() then
    if new.email <> old.email or new.role <> old.role or new.tabs is distinct from old.tabs then
      raise exception 'only the administrator can change roles';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_account on public.accounts;
create trigger protect_account before update on public.accounts for each row execute function public.protect_account();

-- ---------------------------------------------------------------------------
-- Photos: private bucket, served through short-lived signed URLs.
-- Editors manage player photos; everyone manages their own avatar (avatars/<uid>.jpg or .gif).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1048576, array['image/jpeg', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/gif'];

drop policy if exists "photos lecture"     on storage.objects;
drop policy if exists "photos ajout"       on storage.objects;
drop policy if exists "photos mise à jour" on storage.objects;
drop policy if exists "photos suppression" on storage.objects;
drop policy if exists "photos read"   on storage.objects;
drop policy if exists "photos write"  on storage.objects;
drop policy if exists "photos update" on storage.objects;
drop policy if exists "photos delete" on storage.objects;
create policy "photos read"   on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "photos write"  on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (public.can_edit() or name like 'avatars/' || auth.uid()::text || '.%'));
create policy "photos update" on storage.objects for update to authenticated using (bucket_id = 'photos' and (public.can_edit() or name like 'avatars/' || auth.uid()::text || '.%'));
create policy "photos delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (public.can_edit() or name like 'avatars/' || auth.uid()::text || '.%'));

-- ---------------------------------------------------------------------------
-- Realtime: everyone sees teammates' changes without reloading.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'settings', 'events', 'spots', 'accounts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

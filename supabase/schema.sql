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

-- Put the administrator's email in place of the placeholder before running (do not commit it).
-- Left as is, nothing is inserted: an existing database keeps its accounts.
do $$
declare admin_email text := 'admin@example.com';          -- <<< CHANGE THIS
begin
  if admin_email <> 'admin@example.com' then
    insert into public.accounts (email, role) values (lower(admin_email), 'admin')
    on conflict (email) do update set role = 'admin';
  end if;
end $$;

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
create or replace function public.is_member() returns boolean language sql stable set search_path = public as $$ select public.my_role() is not null; $$;
create or replace function public.can_edit() returns boolean language sql stable set search_path = public as $$ select public.my_role() in ('admin', 'member'); $$;
create or replace function public.is_admin() returns boolean language sql stable set search_path = public as $$ select public.my_role() = 'admin'; $$;
-- The display name of the signed-in account (its name, or the start of its email): written by the server on the log
-- and the intel, so nobody can sign as someone else.
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(a.name, ''), split_part(u.email, '@', 1)) from auth.users u
  join public.accounts a on lower(a.email) = lower(u.email)
  where u.id = auth.uid();
$$;

revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
revoke all on function public.my_name() from public, anon;
grant execute on function public.my_name() to authenticated;

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
  status       text not null default '' check (status in ('', 'dangerous', 'priority')),   -- special status shown in colour
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
alter table public.players add column if not exists status text not null default '' check (status in ('', 'dangerous', 'priority'));

create table if not exists public.rounds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   integer not null,
  created_at timestamptz not null default now()
);
-- the weapons each player held when the round ended with a reroll ({ player id: "Banane, Lacet" }); a reroll empties the sheets
alter table public.rounds add column if not exists held_weapons jsonb;

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
  killer_weapons text,                      -- the killer's weapons before the victim's passed to them (restored on undo); null = unchanged
  happened_at timestamptz not null default now()
);
alter table public.kills add column if not exists killer_weapons text;
alter table public.kills add column if not exists admin_reason text check (admin_reason is null or admin_reason in ('cheating', 'other'));

-- Intel feed: dated, signed pieces of information on a player ("seen at the library with a cushion"), maybe a place.
create table if not exists public.intel (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players(id) on delete cascade,
  text       text not null default '',
  place      text default '',
  lat        double precision,
  lng        double precision,
  seen_at    timestamptz not null default now(),
  author     text default '',
  created_at timestamptz not null default now()
);

-- Shared flats: a name, an address (and the apartment building it is in, if any); its members' sheets follow it.
create table if not exists public.homes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text default '',
  lat        double precision,
  lng        double precision,
  building   text default '',
  note       text default '',
  created_at timestamptz not null default now()
);
alter table public.players add column if not exists home_id uuid references public.homes(id) on delete set null;
-- the same for student residences (kind 'residence'); a player may note their apartment number
alter table public.homes add column if not exists kind text not null default 'coloc' check (kind in ('coloc', 'residence'));
alter table public.players add column if not exists apartment text default '';
-- a "mystery" sheet: someone we only know a few things about (year, department, groups), merged into the real sheet once known
alter table public.players add column if not exists is_mystery boolean not null default false;

-- Each account can be linked to its own player sheet (quick actions: my target, my hunter, I am dead).
alter table public.accounts add column if not exists player_id uuid references public.players(id) on delete set null;

create table if not exists public.weapons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  difficulty text not null default 'facile' check (difficulty in ('facile', 'difficile')),
  owned      boolean not null default false,   -- the alliance already has this object (gathered before the game)
  note       text default ''                   -- where to find it, who keeps it
);
alter table public.weapons add column if not exists owned boolean not null default false;
alter table public.weapons add column if not exists note text default '';
-- a weapon whose difficulty nobody knows yet ('inconnue'); a kill made with one counts the easy points until it is known
alter table public.weapons drop constraint if exists weapons_difficulty_check;
alter table public.weapons add constraint weapons_difficulty_check check (difficulty in ('facile', 'difficile', 'inconnue'));
alter table public.kills add column if not exists weapon_level text check (weapon_level is null or weapon_level in ('facile', 'difficile', 'inconnue'));
-- what the points of a kill are made of, so they follow a change of the scoring (null: recorded before, kept as is)
alter table public.kills add column if not exists bonus integer;
alter table public.kills add column if not exists first_blood boolean;
alter table public.kills add column if not exists mates integer;

-- Shop bonuses bought by players: what, when it takes effect and until when (ends_at null = one-off, e.g. a reveal).
create table if not exists public.bonuses (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players(id) on delete cascade,
  name       text not null,
  price      integer not null default 0,
  bought_at  timestamptz not null default now(),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  note       text default '',
  created_at timestamptz not null default now()
);
-- the buyer may be unknown ("someone bought a Coupe-Gorge"): said later, when we learn who it was
alter table public.bonuses alter column player_id drop not null;

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
-- Members and admins add and change game data. What would wipe the game is kept for administrators, on the
-- server and not only in the app: the log is append-only for members (only an admin clears it), and only an admin
-- deletes rounds and player sheets (a member may delete a "mystery" sheet, merged once identified).
-- Only admins write settings and accounts.
-- ---------------------------------------------------------------------------
do $$
declare t text; upd text; del text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'events', 'spots', 'bonuses', 'homes', 'intel'] loop
    upd := case when t = 'events' then 'public.is_admin()' else 'public.can_edit()' end;
    del := case when t in ('events', 'rounds') then 'public.is_admin()'
                when t = 'players' then 'public.is_admin() or (public.can_edit() and is_mystery)'
                else 'public.can_edit()' end;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "membres" on public.%I', t);
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "write" on public.%I', t);
    execute format('drop policy if exists "insert" on public.%I', t);
    execute format('drop policy if exists "update" on public.%I', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "insert" on public.%I for insert to authenticated with check (public.can_edit())', t);
    execute format('create policy "update" on public.%I for update to authenticated using (%s) with check (%s)', t, upd, upd);
    execute format('create policy "delete" on public.%I for delete to authenticated using (%s)', t, del);
  end loop;
end $$;

-- SEC: the author of a log entry or of a piece of intel is the signed-in account, set by the server. An administrator
-- restoring a backup keeps the original authors.
create or replace function public.stamp_author() returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'events' then new.actor := public.my_name();
  elsif tg_op = 'UPDATE' then new.author := old.author;
  else new.author := public.my_name();
  end if;
  return new;
end $$;
drop trigger if exists stamp_author on public.events;
create trigger stamp_author before insert on public.events for each row execute function public.stamp_author();
drop trigger if exists stamp_author on public.intel;
create trigger stamp_author before insert or update on public.intel for each row execute function public.stamp_author();

-- Deletion journal: every deleted row of the game, who deleted it and when. Nobody can change or erase it through the
-- API (no write policy); administrators read it in Settings. Kept 14 days, like the backups.
create table if not exists public.audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text,
  table_name text not null,
  row_data   jsonb
);
alter table public.audit enable row level security;
drop policy if exists "admin" on public.audit;
create policy "admin" on public.audit for select to authenticated using (public.is_admin());
create or replace function public.audit_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit (actor, table_name, row_data) values (auth.email(), tg_table_name, to_jsonb(old));
  return old;
end $$;
revoke all on function public.audit_delete() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'events', 'spots', 'bonuses', 'homes', 'intel'] loop
    execute format('drop trigger if exists audit_delete on public.%I', t);
    execute format('create trigger audit_delete after delete on public.%I for each row execute function public.audit_delete()', t);
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
create or replace function public.protect_account() returns trigger language plpgsql set search_path = public as $$
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
-- Nightly backups: a copy of the whole game every night (pg_cron), kept 14 days, in the same format as
-- "Save the game"; the administrator downloads or restores them from Settings. Photos stay in storage (paths kept).
-- ---------------------------------------------------------------------------
create table if not exists public.game_backups (
  id       bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  data     jsonb not null
);
alter table public.game_backups enable row level security;
drop policy if exists "admin" on public.game_backups;
create policy "admin" on public.game_backups for select to authenticated using (public.is_admin());

create or replace function public.take_backup() returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'administrators only'; end if;   -- the nightly job has no user
  insert into public.game_backups (data) select jsonb_build_object(
    'format', 'killer-backup', 'version', 1, 'exported_at', now(), 'source', 'nightly',
    'game_name', coalesce((select value #>> '{}' from public.settings where key = 'game_name'), ''),
    'players', coalesce((select jsonb_agg(to_jsonb(x)) from public.players x), '[]'::jsonb),
    'rounds',  coalesce((select jsonb_agg(to_jsonb(x)) from public.rounds x), '[]'::jsonb),
    'links',   coalesce((select jsonb_agg(to_jsonb(x)) from public.links x), '[]'::jsonb),
    'kills',   coalesce((select jsonb_agg(to_jsonb(x)) from public.kills x), '[]'::jsonb),
    'weapons', coalesce((select jsonb_agg(to_jsonb(x)) from public.weapons x), '[]'::jsonb),
    'events',  coalesce((select jsonb_agg(to_jsonb(x)) from public.events x), '[]'::jsonb),
    'spots',   coalesce((select jsonb_agg(to_jsonb(x)) from public.spots x), '[]'::jsonb),
    'bonuses', coalesce((select jsonb_agg(to_jsonb(x)) from public.bonuses x), '[]'::jsonb),
    'homes',   coalesce((select jsonb_agg(to_jsonb(x)) from public.homes x), '[]'::jsonb),
    'intel',   coalesce((select jsonb_agg(to_jsonb(x)) from public.intel x), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from public.settings), '{}'::jsonb))
  returning id into new_id;
  delete from public.game_backups where taken_at < now() - interval '14 days';
  delete from public.audit where at < now() - interval '14 days';
  return new_id;
end $$;
revoke all on function public.take_backup() from public, anon;
grant execute on function public.take_backup() to authenticated;

-- Points change on the server itself (points = points + delta): two teammates scoring the same player at once both
-- count. Runs with the caller's rights, so the row-level rules apply.
create or replace function public.add_points(p_player uuid, p_delta integer) returns integer
language sql security invoker set search_path = public as $$
  update public.players set points = greatest(0, points + p_delta) where id = p_player returning points;
$$;
revoke all on function public.add_points(uuid, integer) from public, anon;
grant execute on function public.add_points(uuid, integer) to authenticated;

-- Links replaced in one transaction: the old ones go and the new ones come together, or nothing changes (a conflict
-- with a teammate's change no longer loses the old link).
create or replace function public.set_links(p_remove uuid[], p_add jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.links where id = any(coalesce(p_remove, '{}'));
  insert into public.links (id, round_id, hunter_id, target_id, confidence, source)
    select (x->>'id')::uuid, (x->>'round_id')::uuid, (x->>'hunter_id')::uuid, (x->>'target_id')::uuid, coalesce(x->>'confidence', 'sur'), coalesce(x->>'source', '')
    from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) x;
end $$;
revoke all on function public.set_links(uuid[], jsonb) from public, anon;
grant execute on function public.set_links(uuid[], jsonb) to authenticated;

-- SEC: end of game. The automatic backups and the deletion journal hold the whole game (names, addresses, notes):
-- "End of game" erases them too, administrators only.
create or replace function public.purge_history() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'administrators only'; end if;
  delete from public.game_backups;
  delete from public.audit;
end $$;
revoke all on function public.purge_history() from public, anon;
grant execute on function public.purge_history() to authenticated;

do $$ begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: enable it under Database > Extensions, then run this script again';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'killer-nightly-backup';
    perform cron.schedule('killer-nightly-backup', '0 3 * * *', 'select public.take_backup()');   -- 03:00 UTC, 04:00/05:00 in Paris
  end if;
end $$;

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
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'settings', 'events', 'spots', 'accounts', 'bonuses', 'homes', 'intel'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

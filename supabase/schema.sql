-- QG Killer : schéma Supabase
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Le script peut être relancé sans danger.
--
-- >>> AVANT DE LANCER : remplace l'adresse ci-dessous par la tienne (premier admin). <<<

create table if not exists public.allowed_emails (
  email      text primary key,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

insert into public.allowed_emails (email, role)
values ('victor.lemanceau02@gmail.com', 'admin')          -- <<< À MODIFIER
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Qui a le droit d'entrer ?
-- Un compte n'est membre que si son e-mail est dans allowed_emails ET qu'il a été confirmé.
-- (Sans la confirmation, n'importe qui pourrait créer un compte avec l'adresse d'un membre.)
-- ---------------------------------------------------------------------------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    join public.allowed_emails a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    join public.allowed_emails a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null and a.role = 'admin'
  );
$$;

revoke all on function public.is_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  year        text default '',
  dept        text default '',
  td          text default '',
  tp          text default '',
  option      text default '',
  lang_group  text default '',
  sector      text default '',
  notes       text default '',
  weapons     text default '',
  points      integer not null default 0,
  is_ally     boolean not null default false,
  photo_path  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.rounds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   integer not null,
  created_at timestamptz not null default now()
);

-- Un lien = « hunter a pour cible target » dans une boucle donnée.
-- Dans une boucle, chacun a au plus une cible et au plus un killer.
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

-- Un joueur est mort s'il existe un kill dont il est la victime : c'est la seule source de vérité.
create table if not exists public.kills (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid references public.rounds(id) on delete set null,
  killer_id   uuid references public.players(id) on delete set null,
  victim_id   uuid not null unique references public.players(id) on delete cascade,
  weapon      text default '',
  points      integer not null default 0,
  note        text default '',
  happened_at timestamptz not null default now()
);

create table if not exists public.weapons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  difficulty text not null default 'facile' check (difficulty in ('facile', 'difficile'))
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb
);

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  actor      text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security : sans être membre, on ne lit RIEN, même avec la clé anon.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'settings', 'events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "membres" on public.%I', t);
    execute format('create policy "membres" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

alter table public.allowed_emails enable row level security;
drop policy if exists "membres lisent" on public.allowed_emails;
drop policy if exists "admins gèrent"  on public.allowed_emails;
create policy "membres lisent" on public.allowed_emails for select to authenticated using (public.is_member());
create policy "admins gèrent"  on public.allowed_emails for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Photos : bucket PRIVÉ. L'app n'affiche les images que via des URL signées d'une heure.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists "photos lecture"     on storage.objects;
drop policy if exists "photos ajout"       on storage.objects;
drop policy if exists "photos mise à jour" on storage.objects;
drop policy if exists "photos suppression" on storage.objects;
create policy "photos lecture"     on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "photos ajout"       on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "photos mise à jour" on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "photos suppression" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_member());

-- ---------------------------------------------------------------------------
-- Temps réel : chacun voit les modifications des autres sans recharger.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['players', 'rounds', 'links', 'kills', 'weapons', 'settings', 'events', 'allowed_emails'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

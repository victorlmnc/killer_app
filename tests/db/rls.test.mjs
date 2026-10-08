// Row-level security of supabase/schema.sql, on PGlite (a real Postgres compiled to WebAssembly) with stand-ins for
// what Supabase provides (auth schema, storage schema, roles, realtime publication). Never touches the real database.
// Run: npm install, then npm run test:db (or node tests/db/rls.test.mjs).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const ex = (sql) => db.exec(sql);

await ex(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated;
  create publication supabase_realtime;
`);
const schema = fs.readFileSync(repo + '/supabase/schema.sql', 'utf8');
await ex(schema);
await ex(`grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;`);

// accounts and users
const U = { admin: '11111111-1111-4111-8111-111111111111', member: '22222222-2222-4222-8222-222222222222', observer: '33333333-3333-4333-8333-333333333333', outsider: '44444444-4444-4444-8444-444444444444', unconfirmed: '55555555-5555-4555-8555-555555555555' };
await ex(`
  insert into auth.users values ('${U.admin}', 'admin@test.fr', now()), ('${U.member}', 'member@test.fr', now()), ('${U.observer}', 'obs@test.fr', now()),
    ('${U.outsider}', 'outsider@test.fr', now()), ('${U.unconfirmed}', 'late@test.fr', null);
  insert into public.accounts (email, name, role) values ('admin@test.fr', 'Ada', 'admin'), ('member@test.fr', 'Max', 'member'), ('obs@test.fr', '', 'observer'), ('late@test.fr', '', 'member');
  insert into public.rounds (id, name, position) values ('aaaaaaaa-0000-4000-8000-000000000001', 'R0', 0);
  insert into public.players (id, name) values ('bbbbbbbb-0000-4000-8000-000000000001', 'A'), ('bbbbbbbb-0000-4000-8000-000000000002', 'B'), ('bbbbbbbb-0000-4000-8000-000000000003', 'C');
  insert into public.players (id, name, is_mystery) values ('bbbbbbbb-0000-4000-8000-000000000009', 'M', true);
  insert into public.links (round_id, hunter_id, target_id) values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');
  insert into public.events (text, actor) values ('first entry', 'Ada');
`);

async function as(who, fn) {
  await ex(`reset role; select set_config('request.jwt.claim.sub', '${who ? U[who] : ''}', false), set_config('request.jwt.claim.email', '${who ? { admin: 'admin@test.fr', member: 'member@test.fr', observer: 'obs@test.fr', outsider: 'outsider@test.fr', unconfirmed: 'late@test.fr' }[who] : ''}', false);`);
  await ex(who ? 'set role authenticated' : 'set role anon');
  try { return await fn(); } finally { await ex('reset role'); }
}
const count = async (sql) => +(await q(sql)).rows[0].n;
const fails = async (sql) => { try { await q(sql); return false; } catch (e) { return true; } };
let n = 0; const ok = (name) => console.log('ok -', name, ++n);

// who reads what
await as(null, async () => { assert.equal(await count('select count(*) n from public.players'), 0); ok('anon reads nothing'); });
await as('outsider', async () => { assert.equal(await count('select count(*) n from public.players'), 0); assert.equal(await count('select count(*) n from public.accounts'), 0); ok('signed in, not on the list: reads nothing'); });
await as('unconfirmed', async () => { assert.equal(await count('select count(*) n from public.players'), 0); ok('email not confirmed: reads nothing'); });
await as('observer', async () => {
  assert.equal(await count('select count(*) n from public.players'), 4);
  assert.ok(await fails(`insert into public.players (name) values ('X')`), 'observer insert refused');
  assert.equal(await count(`with d as (delete from public.links returning 1) select count(*) n from d`), 0);
  assert.equal(await count(`with u as (update public.players set points = 99 returning 1) select count(*) n from u`), 0);
  ok('observer reads, writes nothing');
});

// SEC-02: what a member cannot do any more
await as('member', async () => {
  assert.equal(await count(`with d as (delete from public.events returning 1) select count(*) n from d`), 0); ok('member cannot clear the log');
  assert.equal(await count(`with u as (update public.events set text = 'forged' returning 1) select count(*) n from u`), 0); ok('member cannot rewrite the log');
  assert.equal(await count(`with d as (delete from public.rounds returning 1) select count(*) n from d`), 0); ok('member cannot delete rounds');
  assert.equal(await count(`with d as (delete from public.players where not is_mystery returning 1) select count(*) n from d`), 0); ok('member cannot delete player sheets');
  assert.equal(await count(`with d as (delete from public.players where is_mystery returning 1) select count(*) n from d`), 1); ok('member deletes a mystery sheet');
  assert.equal(await count(`with d as (delete from public.links returning 1) select count(*) n from d`), 1); ok('member still deletes a link');
  assert.equal(await count(`with u as (update public.players set points = 5 where name = 'A' returning 1) select count(*) n from u`), 1); ok('member still edits sheets');
  // SEC-07: authors set by the server
  const e = (await q(`insert into public.events (text, actor) values ('kill', 'Someone else') returning actor`)).rows[0];
  assert.equal(e.actor, 'Max'); ok('log author = the signed-in account');
  const i = (await q(`insert into public.intel (player_id, text, author) values ('bbbbbbbb-0000-4000-8000-000000000001', 'seen', 'Fake') returning id, author`)).rows[0];
  assert.equal(i.author, 'Max');
  const i2 = (await q(`update public.intel set author = 'Fake', text = 'seen at the library' where id = $1 returning author, text`, [i.id])).rows[0];
  assert.deepEqual([i2.author, i2.text], ['Max', 'seen at the library']); ok('intel author set by the server, kept on edits');
  // the deletion journal is out of reach
  assert.equal(await count('select count(*) n from public.audit'), 0); ok('member cannot read the deletion journal');
  assert.ok(await fails(`insert into public.audit (table_name) values ('x')`) || await count(`select count(*) n from public.audit`) === 0); ok('member cannot write the deletion journal');
  // accounts
  assert.ok(await fails(`update public.accounts set role = 'admin' where email = 'member@test.fr'`)); ok('member cannot raise their role');
  assert.equal(await count(`with u as (update public.accounts set role = 'member' where email = 'obs@test.fr' returning 1) select count(*) n from u`), 0); ok('member cannot change another account');
  assert.equal(await count(`with u as (update public.accounts set name = 'Maxime' where email = 'member@test.fr' returning 1) select count(*) n from u`), 1); ok('member renames themselves');
  // admin-only functions
  assert.ok(await fails('select public.purge_history()')); ok('member cannot erase backups');
  assert.ok(await fails('select public.take_backup()')); ok('member cannot take a backup');
  assert.equal(await count('select count(*) n from public.game_backups'), 0); ok('member cannot read backups');
});

// lot 3: points on the server, links in one transaction
await as('member', async () => {
  await q(`update public.players set points = 4 where name = 'A'`);
  const a = (await q(`select public.add_points('bbbbbbbb-0000-4000-8000-000000000001', 3) as v`)).rows[0].v;
  const b = (await q(`select public.add_points('bbbbbbbb-0000-4000-8000-000000000001', -10) as v`)).rows[0].v;
  assert.deepEqual([a, b], [7, 0]); ok('add_points adds on the server, never below 0');
  await q(`insert into public.links (id, round_id, hunter_id, target_id) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'),
    ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003')`);
  // replace A->B by A->C while B->C still exists: the insert breaks unique (round, target) -> nothing changes
  const bad = await fails(`select public.set_links(array['cccccccc-0000-4000-8000-000000000001']::uuid[], '[{"id":"cccccccc-0000-4000-8000-000000000003","round_id":"aaaaaaaa-0000-4000-8000-000000000001","hunter_id":"bbbbbbbb-0000-4000-8000-000000000001","target_id":"bbbbbbbb-0000-4000-8000-000000000003"}]'::jsonb)`);
  assert.ok(bad); assert.equal(await count(`select count(*) n from public.links where id = 'cccccccc-0000-4000-8000-000000000001'`), 1); ok('set_links: a conflict keeps the old link (one transaction)');
  await q(`select public.set_links(array['cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002']::uuid[], '[{"id":"cccccccc-0000-4000-8000-000000000003","round_id":"aaaaaaaa-0000-4000-8000-000000000001","hunter_id":"bbbbbbbb-0000-4000-8000-000000000001","target_id":"bbbbbbbb-0000-4000-8000-000000000003"}]'::jsonb)`);
  assert.equal(await count(`select count(*) n from public.links`), 1); ok('set_links: removed and added together');
});
await as('observer', async () => {
  assert.equal((await q(`select public.add_points('bbbbbbbb-0000-4000-8000-000000000001', 50) as v`)).rows[0].v, null); ok('observer: add_points changes nothing');
  assert.ok(await fails(`select public.set_links('{}'::uuid[], '[{"id":"cccccccc-0000-4000-8000-000000000009","round_id":"aaaaaaaa-0000-4000-8000-000000000001","hunter_id":"bbbbbbbb-0000-4000-8000-000000000003","target_id":"bbbbbbbb-0000-4000-8000-000000000001"}]'::jsonb)`)); ok('observer: set_links refused');
});
await as(null, async () => { assert.ok(await fails(`select public.add_points('bbbbbbbb-0000-4000-8000-000000000001', 1)`)); ok('anon cannot call add_points'); });

// the deletion journal recorded the member's deletions, with their email
await as('admin', async () => {
  const rows = (await q(`select actor, table_name, row_data->>'name' as name from public.audit order by id`)).rows;
  assert.deepEqual(rows.map(r => r.actor + ' ' + r.table_name).slice(0, 2), ['member@test.fr players', 'member@test.fr links']);
  assert.equal(rows[0].name, 'M'); ok('deletion journal: who, what, the deleted row');
  // admin restoring a backup keeps the original author
  const e = (await q(`insert into public.events (text, actor) values ('restored', 'Old author') returning actor`)).rows[0];
  assert.equal(e.actor, 'Old author'); ok('admin restore keeps the authors');
  assert.ok(await count(`with d as (delete from public.events returning 1) select count(*) n from d`) >= 3); ok('admin clears the log');
  assert.equal(await count(`with d as (delete from public.players where name = 'C' returning 1) select count(*) n from d`), 1); ok('admin deletes a sheet');
  await q('select public.take_backup()');
  assert.equal(await count('select count(*) n from public.game_backups'), 1); ok('admin takes a backup');
  await q('select public.purge_history()');
  assert.equal(await count('select count(*) n from public.game_backups') + await count('select count(*) n from public.audit'), 0); ok('end of game erases backups and journal');
});

// running the schema twice (migration in place) still works
await ex(schema);
ok('schema.sql runs again');
console.log(`\n${n} RLS checks OK`);

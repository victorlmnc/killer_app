# QG Killer

QG Killer is a private web app for a team playing *Killer*, the campus assassination game: everyone gets a target and a
couple of "weapons", kills pass contracts along a hidden loop, and the last players standing win.

Winning depends on rebuilding that loop from partial information. This app is the team's shared notebook for
it: a chain you rearrange by drag and drop, player sheets with photos, a map of addresses, the weapon
catalogue, the bonus shop, and a log of who found out what.

It is a static site (plain HTML, CSS and JavaScript, no build step) backed by [Supabase](https://supabase.com)
for the database, sign-in and photo storage. The interface is in French, with an English switch on the sign-in
screen and in the profile dialog.

## Features

- **Chain** – the loop as fragments of bubbles. Drop a bubble to the right of a player to make them the target,
  to the left to make them the hunter; move a whole tail or fragment at once. Every link carries a reliability
  (confirmed / likely / rumour) and a source. Rerolls archive the previous loop.
- **Kills** – recording a kill credits the points, passes the victim's weapons to the killer, shows the killer's
  new target and completes the chain if the link was unknown.
- **Players** – sheets with class, weapons, address, notes and photo; a special status (dangerous, priority
  target) shown in colour on the chain and the lists; filters; import from a spreadsheet or CSV with column
  mapping; export as CSV or printable report (PDF).
- **Timetables** – the class each player is in right now and the next one, and their week. A student's timetable
  is several HyperPlanning layers stacked (whole year, department, TD, TP, language group, options); each layer
  is one iCal link, and each player gets every layer that matches their sheet. The dashboard shows where the
  alliance's targets are.
- **When to catch them** – from a target's timetable (and yours, once your account is linked to your sheet): the
  coming week's moments when they come out of a class or go into one while you are not in the middle of one, same
  building and floor as you first.
- **Alerts** – on the dashboard: an ally's hunter holding a Coupe-Gorge, marked dangerous or rich enough to buy one;
  an ally's target that is immune.
- **Shop bonuses** – record who bought what; the app works out when it takes effect and until when (e.g. immunity
  from 00:10 the next day for 24 h) and shows it in the shop, on the sheets and on the dashboard.
- **Pre-shot** – on the Weapons tab: the weapons of our targets, and whether we already have them.
- **My sheet** – each account can be linked to its own player sheet: the dashboard then shows your target,
  your hunter, where your target is, and an "I am dead" button.
- **Saved games** – the whole game in one JSON file (sheets, photos, rounds, links, kills, full log, catalogue,
  spots, settings). *Settings → Import a saved game* replaces the current game with it, in the shared database
  or in the demo.
- **Map** – one marker per located address, grouped by residence, with housing-type layers, strategic spots and
  optional bus lines built from a GTFS feed.
- **Shared flats** – a name, an address, the apartment building it is in, and who lives there; the sheets of its
  flatmates follow its address. Its marker stays lit while one of them is alive; flats are also detected from
  sheets marked "shared flat" at the same address.
- **Dashboard** – how much of the loop is known, who hunts each member of the team, leaderboard, incomplete
  sheets, and the activity log with the details behind each entry.
- **Roles** – *administrator* (everything, including settings and accounts), *member* (edits the game) and
  *observer* (read-only, on the tabs the administrator picks). Everyone manages their own name, photo and
  password from the profile button.
- Realtime sync between teammates, phone-first layout, installable on the home screen (PWA). Without a
  connection the app opens the last copy of the data (and of the timetables) read-only.
- Nightly backups kept 14 days by the database, downloadable and restorable from *Settings → Data*.

## Try it

Open `index.html` in a browser. While `js/config.js` is empty the app runs in demo mode with a fictional game
stored in the browser only.

## Deploy

1. **Supabase** – create a project. In *SQL Editor*, paste `supabase/schema.sql`, replace the administrator
   email at the top, and run it. Keep *Confirm email* enabled under *Authentication → Providers → Email*:
   it is what prevents someone from registering with a teammate's address. Add the site URL under
   *Authentication → URL Configuration*.
2. **Config** – copy the project URL and the `anon` key from *Project Settings → API* into `js/config.js`.
   The `anon` key is public by design; row-level security in the schema is what protects the data.
3. **Host** – push the repository and enable GitHub Pages (or Netlify, Vercel, Cloudflare Pages). Nothing to
   build.
4. **First run** – create your account with the administrator email, confirm it, sign in, then add teammates
   under *Settings → Accounts*. Load the weapon catalogue from the Weapons tab and import the player list.

After updating the app, run `supabase/schema.sql` again: it migrates an existing database in place.

### Timetables

The school's HyperPlanning serves iCal files without CORS headers, so they go through a small edge function,
`supabase/functions/edt`, which only answers members of the team and only fetches links from `edt.insa-cvl.fr`.

1. Deploy it: *Edge Functions → Deploy a new function → Via editor*, name it `edt`, paste
   `supabase/functions/edt/index.ts`, deploy. (Or with the CLI: `supabase functions deploy edt`.)
2. On HyperPlanning, open *Promotions*, choose a promotion (e.g. STI 3A) and a group (TD1, TP2, G1… or none
   for the whole promotion), click the iCal icon and copy the address under *Synchronise*. Paste it under
   *Settings → Timetables*: who the layer applies to (year, department, TD / TP / language group / option) is
   read from the timetable name and can be corrected. The panel lists the classes still without a timetable.
   The links contain a private key: they stay in the database settings, never in the repository.

To accept another host, set the `EDT_HOSTS` secret of the function (comma-separated).

### Nightly backups

`supabase/schema.sql` schedules a copy of the whole game every night with the `pg_cron` extension. If the script
reports that `pg_cron` is not available, enable it under *Database → Extensions* and run the script again.
*Settings → Data → Automatic backups* lists the copies (14 days), downloads or restores one, or takes one now.

### Install on a phone

Open the site, then *Share → Add to Home Screen* (iPhone, Safari) or *⋮ → Install app* (Android, Chrome).

## Bus lines

```
python3 tools/build_bus.py <gtfs url or zip>
```

writes `data/bus.js` from the operator's GTFS feed (routes, official colours, shapes, stops). Commit the file;
each line can then be toggled on the map.

## Data handling

Only registered players belong in the database. Photos are cropped and re-encoded in the browser before
upload (EXIF metadata, including GPS, is dropped), stored in a private bucket and served through one-hour
signed URLs. Addresses are geocoded through a public geocoder that receives the address text only.
*Settings → End of game* erases everything personal while keeping the catalogue, spots and settings.

## Development

```
npm install                       # once: PGlite, a real Postgres in WebAssembly, for the database tests
npm test                          # chain logic, import/export + row-level security of supabase/schema.sql
npm run test:edge                 # the timetable relay (needs Deno), against a fake network
python3 tests/e2e/demo_flow.py    # browser flows (see tests/e2e/README.md)
python3 tests/e2e/features.py     # timetables, bonuses, alerts, pre-shot, offline copy
```

None of them touches the real database: `tests/db/rls.test.mjs` runs `supabase/schema.sql` on PGlite with stand-ins for
Supabase's `auth` and `storage`, then plays each role (anonymous, outsider, observer, member, admin).

```
index.html
css/app.css             single dark theme
js/i18n.js, js/lang/    translations (English source strings, French table)
js/logic.js             pure logic: derived chain, fragments, drag planning, import/export
js/store.js             data layer: Supabase adapter, local demo adapter, roles, photos
js/actions/             what the buttons do, one file per domain (helpers they share: core.js, as K.actions._):
  chain.js              links, reliability, drag and drop, rounds and rerolls
  kills.js              kill form, recording and undoing, weapons of unknown difficulty, scoring
  homes.js, shop.js     shared flats and residences; shop purchases
  sheet.js              player sheet, its weapons and edit form, intel, mystery players, sharing
  data.js               log entries, import, export, backups, deletion journal, report, profile
js/views/               one file per tab
supabase/schema.sql     tables, roles, row-level security, storage, realtime
supabase/functions/edt  timetable relay (iCal links of the school's HyperPlanning)
manifest.webmanifest, sw.js, icons/   installable app
tools/                  GTFS converter, single-file demo bundler
```

## License

MIT.

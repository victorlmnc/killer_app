# Killer

A private web app for a team playing *Killer*, the campus assassination game: everyone gets a target and a
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
- **Players** – sheets with class, weapons, address, notes and photo; filters; import from a spreadsheet or CSV
  with column mapping; export as CSV, printable report (PDF) or JSON backup.
- **Map** – one marker per located address, grouped by residence, with housing-type layers, strategic spots and
  optional bus lines built from a GTFS feed.
- **Dashboard** – how much of the loop is known, who hunts each member of the team, leaderboard, incomplete
  sheets, and the activity log with the details behind each entry.
- **Roles** – *administrator* (everything, including settings and accounts), *member* (edits the game) and
  *observer* (read-only, on the tabs the administrator picks). Everyone manages their own name, photo and
  password from the profile button.
- Realtime sync between teammates, phone-first layout.

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
node tests/logic.test.js          # chain logic, import/export
python3 tests/e2e/demo_flow.py    # browser flows (see tests/e2e/README.md)
```

```
index.html
css/app.css             single dark theme
js/i18n.js, js/lang/    translations (English source strings, French table)
js/logic.js             pure logic: derived chain, fragments, drag planning, import/export
js/store.js             data layer: Supabase adapter, local demo adapter, roles, photos
js/actions.js           links, kills, rounds, player sheet, import/export, profile
js/views/               one file per tab
supabase/schema.sql     tables, roles, row-level security, storage, realtime
tools/                  GTFS converter, single-file demo bundler
```

## License

MIT.

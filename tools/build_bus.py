#!/usr/bin/env python3
"""Build the bus layer of the Map tab (data/bus.js) from a GTFS feed.

    python3 tools/build_bus.py https://example.org/gtfs.zip   download the feed and write data/bus.js
    python3 tools/build_bus.py gtfs.zip                       same from a local file

Most transit networks publish a GTFS feed; in France they are listed on transport.data.gouv.fr.
Re-run when the network changes. Python 3.8+, no dependencies.
"""
import csv, io, json, math, re, sys, urllib.request, zipfile
from datetime import date
from pathlib import Path

ATTRIBUTION = 'Lines and stops from the operator\'s GTFS feed'
OUT = Path(__file__).resolve().parent.parent / 'data' / 'bus.js'
FALLBACK = ['#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4', '#008080', '#9A6324', '#800000', '#808000', '#000075', '#F032E6', '#469990']
TOLERANCE = 0.00004   # path simplification, about 4 m


def table(zf, name):
    """Rows of one GTFS file as dicts; nothing when the file is absent (shapes.txt is optional)."""
    match = [n for n in zf.namelist() if n.lower().split('/')[-1] == name]
    if not match:
        return
    with zf.open(match[0]) as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline='')):
            yield {(k or '').strip(): (v or '').strip() for k, v in row.items()}


def simplify(points, tol):
    """Iterative Douglas-Peucker."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ay, ax), (by, bx) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        worst, index = 0.0, None
        for i in range(a + 1, b):
            py, px = points[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if (dx or dy) else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, index = d, i
        if index is not None and worst > tol:
            keep[index] = True
            stack += [(a, index), (index, b)]
    return [p for p, k in zip(points, keep) if k]


def natural(text):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', text or '')]


def colour(value, fallback):
    v = (value or '').lstrip('#').upper()
    return '#' + v if re.fullmatch(r'[0-9A-F]{6}', v) and v not in ('FFFFFF', '000000') else fallback


def build(zf):
    routes = {r['route_id']: r for r in table(zf, 'routes.txt')}
    trips = {t['trip_id']: t for t in table(zf, 'trips.txt')}
    stops = {s['stop_id']: s for s in table(zf, 'stops.txt')}
    if not routes or not trips or not stops:
        raise SystemExit('Incomplete GTFS: routes.txt, trips.txt and stops.txt are required.')

    # pass 1: stops per trip, to keep the most complete trip of each route and direction
    count = {}
    for st in table(zf, 'stop_times.txt'):
        count[st['trip_id']] = count.get(st['trip_id'], 0) + 1
    best = {}
    for trip_id, n in count.items():
        t = trips.get(trip_id)
        if not t:
            continue
        key = (t['route_id'], t.get('direction_id', ''))
        if key not in best or n > best[key][1]:
            best[key] = (trip_id, n)
    chosen = {trip_id: key for key, (trip_id, _) in best.items()}

    # pass 2: stop sequence of the selected trips
    sequence = {trip_id: [] for trip_id in chosen}
    for st in table(zf, 'stop_times.txt'):
        if st['trip_id'] in sequence:
            sequence[st['trip_id']].append((int(st.get('stop_sequence') or 0), st['stop_id']))

    wanted = {trips[t].get('shape_id') for t in chosen if trips[t].get('shape_id')}
    shapes = {}
    for pt in table(zf, 'shapes.txt') or []:
        if pt['shape_id'] in wanted:
            shapes.setdefault(pt['shape_id'], []).append((int(pt.get('shape_pt_sequence') or 0), float(pt['shape_pt_lat']), float(pt['shape_pt_lon'])))

    lines = {}
    for trip_id, (route_id, _direction) in chosen.items():
        route = routes.get(route_id)
        if not route or route.get('route_type', '3') not in ('3', '700', '11', '0', ''):   # bus, trolleybus, tram
            continue
        line = lines.setdefault(route_id, {'id': route_id, 'name': route.get('route_short_name') or route.get('route_long_name') or route_id,
                                           'long': route.get('route_long_name', ''), 'paths': [], 'stops': {}})
        ordered = [stops[s] for _, s in sorted(sequence[trip_id]) if s in stops and stops[s].get('stop_lat')]
        shape = shapes.get(trips[trip_id].get('shape_id'))
        path = [(la, lo) for _, la, lo in sorted(shape)] if shape else [(float(s['stop_lat']), float(s['stop_lon'])) for s in ordered]
        path = simplify(path, TOLERANCE if shape else 0)
        if len(path) > 1:
            line['paths'].append([[round(la, 5), round(lo, 5)] for la, lo in path])
        for s in ordered:   # both directions of a stop share a name: one marker, in the middle
            line['stops'].setdefault(s['stop_name'], []).append((float(s['stop_lat']), float(s['stop_lon'])))

    out = []
    for i, line in enumerate(sorted(lines.values(), key=lambda l: natural(l['name']))):
        route = routes[line['id']]
        line['color'] = colour(route.get('route_color'), FALLBACK[i % len(FALLBACK)])
        line['stops'] = [{'n': name, 'lat': round(sum(p[0] for p in pts) / len(pts), 5), 'lng': round(sum(p[1] for p in pts) / len(pts), 5)}
                         for name, pts in sorted(line['stops'].items())]
        if line['paths']:
            out.append(line)
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    source = sys.argv[1]
    if re.match(r'https?://', source):
        print('Downloading', source)
        request = urllib.request.Request(source, headers={'User-Agent': 'killer-qg/1.0'})
        data = urllib.request.urlopen(request, timeout=60).read()
    else:
        data = Path(source).read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        lines = build(zf)
    payload = {'source': ATTRIBUTION, 'generated': date.today().isoformat(), 'lines': lines}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text('/* Generated by tools/build_bus.py, do not edit. */\nwindow.KILLER_BUS = '
                   + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    points = sum(len(p) for l in lines for p in l['paths'])
    print(f"{len(lines)} lines, {sum(len(l['stops']) for l in lines)} stops, {points} path points -> {OUT} ({OUT.stat().st_size // 1024} kB)")
    for l in lines:
        print(f"  {l['name']:>6}  {l['color']}  {len(l['stops']):>3} stops  {l['long']}")


if __name__ == '__main__':
    main()

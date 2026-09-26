/* Pure game logic: no DOM, no Supabase. Loaded as a plain script in the browser (K.logic) and as a module in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.K = root.K || {}).logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONF_ORDER = { sur: 3, probable: 2, rumeur: 1 };
  function weakest(a, b) { return (CONF_ORDER[a] || 3) <= (CONF_ORDER[b] || 3) ? a : b; }

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function sortedRounds(state) {
    return state.rounds.slice().sort(function (a, b) { return a.position - b.position; });
  }
  function currentRound(state) {
    var r = sortedRounds(state);
    return r.length ? r[r.length - 1] : null;
  }

  /* Players dead by the end of round roundId (all rounds when omitted).
     strict = true: dead BEFORE the round started, i.e. not part of it. */
  function deadSet(state, roundId, strict) {
    var pos = new Map(state.rounds.map(function (r) { return [r.id, r.position]; }));
    var limit = roundId != null && pos.has(roundId) ? pos.get(roundId) : Infinity;
    var s = new Set();
    state.kills.forEach(function (k) {
      var p = pos.has(k.round_id) ? pos.get(k.round_id) : -Infinity;
      if (strict ? p < limit : p <= limit) s.add(k.victim_id);
    });
    return s;
  }

  function linkMaps(state, roundId) {
    var targetOf = new Map(), hunterOf = new Map();
    state.links.forEach(function (l) {
      if (l.round_id !== roundId) return;
      targetOf.set(l.hunter_id, l);
      hunterOf.set(l.target_id, l);
    });
    return { targetOf: targetOf, hunterOf: hunterOf };
  }

  /* Current target (dir='target') or hunter (dir='hunter') of a player: follow links and skip the dead,
     since a dead player's contract goes to whoever was hunting them. */
  function resolve(state, roundId, playerId, dir, maps, dead) {
    maps = maps || linkMaps(state, roundId);
    dead = dead || deadSet(state, roundId);
    var map = dir === 'hunter' ? maps.hunterOf : maps.targetOf;
    var key = dir === 'hunter' ? 'hunter_id' : 'target_id';
    var cur = playerId, via = [], links = [], conf = 'sur', guard = 0;
    while (guard++ < 10000) {
      var link = map.get(cur);
      if (!link) return { id: null, via: via, links: links, lastId: cur, confidence: conf, closed: false };
      conf = weakest(conf, link.confidence); links.push(link);
      var nxt = link[key];
      if (nxt === playerId) return { id: null, via: via, links: links, lastId: cur, confidence: conf, closed: true };
      if (!dead.has(nxt)) return { id: nxt, via: via, links: links, lastId: cur, confidence: conf, closed: false };
      via.push(nxt);
      cur = nxt;
    }
    return { id: null, via: via, links: links, lastId: cur, confidence: conf, closed: false };
  }
  function resolveTarget(state, roundId, id, maps, dead) { return resolve(state, roundId, id, 'target', maps, dead); }
  function resolveHunter(state, roundId, id, maps, dead) { return resolve(state, roundId, id, 'hunter', maps, dead); }

  /* Splits the loop into known fragments.
     mode 'current':  living players only, derived links (the dead are skipped)
     mode 'complete': every participant of the round, raw links */
  function fragments(state, roundId, mode) {
    var maps = linkMaps(state, roundId);
    var dead = deadSet(state, roundId);
    var goneBefore = deadSet(state, roundId, true);
    var nodes = state.players.filter(function (p) {
      if (goneBefore.has(p.id)) return false;
      return mode === 'complete' ? true : !dead.has(p.id);
    }).map(function (p) { return p.id; });
    var nodeSet = new Set(nodes);

    var next = new Map(), edge = new Map(), tail = new Map();
    nodes.forEach(function (id) {
      if (mode === 'complete') {
        var l = maps.targetOf.get(id);
        if (l && nodeSet.has(l.target_id)) {
          next.set(id, l.target_id);
          edge.set(id, { from: id, to: l.target_id, confidence: l.confidence, via: [], links: [l] });
        }
      } else {
        var r = resolveTarget(state, roundId, id, maps, dead);
        if (r.id && nodeSet.has(r.id)) {
          next.set(id, r.id);
          edge.set(id, { from: id, to: r.id, confidence: r.confidence, via: r.via, links: r.links });
        } else if (r.via.length) {
          tail.set(id, { via: r.via, closed: r.closed });
        }
      }
    });
    var prev = new Map();
    next.forEach(function (to, from) { prev.set(to, from); });

    var seen = new Set(), out = [], unplaced = [];
    function walk(start, closed) {
      var ids = [], edges = [], cur = start;
      while (cur != null && !seen.has(cur)) {
        seen.add(cur); ids.push(cur);
        if (edge.has(cur)) edges.push(edge.get(cur));
        cur = next.get(cur);
      }
      var last = ids[ids.length - 1];
      out.push({ ids: ids, edges: edges, closed: closed, tail: closed ? null : (tail.get(last) || null) });
    }
    nodes.forEach(function (id) { if (!prev.has(id) && (next.has(id) || tail.has(id))) walk(id, false); });
    nodes.forEach(function (id) { if (!seen.has(id) && next.has(id)) walk(id, true); });
    nodes.forEach(function (id) { if (!seen.has(id)) unplaced.push(id); });

    return { fragments: out, unplaced: unplaced, nodeCount: nodes.length };
  }

  /* Plans "hunter targets target" without writing anything.
     Smart mode (two living players): the link is attached behind the last known dead player after hunter,
     which preserves the complete chain. Raw mode otherwise (rebuilding with dead players). */
  function planSetTarget(state, roundId, hunterId, targetId, confidence, source, opts) {
    if (!hunterId || !targetId || hunterId === targetId) return { error: 'Un joueur ne peut pas être sa propre cible.' };
    var maps = linkMaps(state, roundId), dead = deadSet(state, roundId);
    var raw = (opts && opts.raw) || dead.has(hunterId) || dead.has(targetId);
    var remove = [], add = [], anchor = hunterId;

    if (!raw) {
      var r = resolveTarget(state, roundId, hunterId, maps, dead);
      if (r.id === targetId) return { noop: true, remove: [], add: [], anchorId: r.lastId };
      anchor = r.lastId;
    } else {
      var same = maps.targetOf.get(hunterId);
      if (same && same.target_id === targetId) return { noop: true, remove: [], add: [], anchorId: hunterId };
    }

    var old = maps.targetOf.get(anchor);
    if (old) remove.push(old);
    var oldHunter = maps.hunterOf.get(targetId);
    if (oldHunter && oldHunter !== old) remove.push(oldHunter);

    add.push({ round_id: roundId, hunter_id: anchor, target_id: targetId, confidence: confidence || 'sur', source: source || '' });

    // Inserting a dead player between hunter and their old target: chain the dead player to that target.
    if (raw && old && dead.has(targetId) && !maps.targetOf.has(targetId) && old.target_id !== targetId) {
      var stillHunted = maps.hunterOf.get(old.target_id);
      if (stillHunted === old) {
        add.push({ round_id: roundId, hunter_id: targetId, target_id: old.target_id, confidence: old.confidence, source: old.source || '' });
      }
    }
    return { remove: remove, add: add, anchorId: anchor, viaDead: anchor !== hunterId };
  }

  /* Drag and drop inside the chain, list-style:
     - removing the segment closes the gap (its hunter inherits its target);
     - dropping it between A and B gives A -> segment -> B; at the end of a fragment it attaches there; in the tray it stands alone.
     seg: consecutive ids of one fragment. dest: { after, before } (either may be missing) or { tray: true }.
     Pure: returns { remove: [existing links], add: [new links] }. */
  function planMove(state, roundId, mode, seg, dest) {
    var raw = mode === 'complete';
    var work = { players: state.players, rounds: state.rounds, kills: state.kills, links: state.links.filter(function (l) { return l.round_id === roundId; }) };
    var original = new Set(work.links), removed = [], inSeg = new Set(seg);
    var first = seg[0], last = seg[seg.length - 1];
    if (!seg.length) return { error: 'Rien à déplacer.' };
    if ((dest.after && inSeg.has(dest.after)) || (dest.before && inSeg.has(dest.before))) return { noop: true, remove: [], add: [] };

    function maps() { return linkMaps(work, roundId); }
    function drop(link) { if (!link) return; work.links = work.links.filter(function (l) { return l !== link; }); if (original.has(link)) removed.push(link); }
    function hunterOfId(id) { if (raw) { var l = maps().hunterOf.get(id); return l ? l.hunter_id : null; } return resolveHunter(work, roundId, id).id; }
    function targetOfId(id) { if (raw) { var l = maps().targetOf.get(id); return l ? l.target_id : null; } return resolveTarget(work, roundId, id).id; }
    function link(a, b, conf) {
      var plan = planSetTarget(work, roundId, a, b, conf || 'sur', '', { raw: raw });
      if (plan.error || plan.noop) return;
      plan.remove.forEach(drop);
      plan.add.forEach(function (l) { work.links.push(l); });
    }

    var H = hunterOfId(first), N0 = targetOfId(last);
    var closing = !!(N0 && inSeg.has(N0));          // a closed loop moved as a whole gets opened
    var N = closing ? null : N0;
    if (H && inSeg.has(H)) H = null;
    var A = dest.tray ? null : (dest.after || null), B = dest.tray ? null : (dest.before || null);
    if (!dest.tray && !closing && A === H && B === N) return { noop: true, remove: [], add: [] };
    if (dest.tray && !H && !N && !closing) return { noop: true, remove: [], add: [] };

    // 1. detach the segment: cut the incoming and outgoing links, then close the gap
    var inLink = maps().hunterOf.get(first), inConf = inLink ? inLink.confidence : 'sur', outConf = 'sur';
    if (N0) { var outLink = maps().hunterOf.get(N0); if (outLink) outConf = outLink.confidence; drop(outLink); }
    drop(maps().hunterOf.get(first));
    if (H && N) link(H, N, weakest(inConf, outConf));

    // 2. put it down at its new place
    if (A && B) { drop(maps().hunterOf.get(B)); link(A, first); link(last, B); }
    else if (A) link(A, first);
    else if (B) link(last, B);

    var add = work.links.filter(function (l) { return !original.has(l); });
    return { remove: removed, add: add };
  }

  function killPoints(o) {
    var base = o.difficulty === 'difficile' ? 3 : 1;
    return base + (Number(o.bonus) || 0) + (o.firstBlood ? 5 : 0) + (Number(o.mates) || 0);
  }

  function weaponList(text) {
    return String(text || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function rankLabel(n) { return String(n); }

  function leaderboard(state) {
    var count = new Map();
    state.kills.forEach(function (k) { if (k.killer_id) count.set(k.killer_id, (count.get(k.killer_id) || 0) + 1); });
    var rows = [];
    count.forEach(function (n, id) { rows.push({ id: id, kills: n }); });
    var names = new Map(state.players.map(function (p) { return [p.id, p.name || '']; }));
    rows.sort(function (a, b) { return b.kills - a.kills || (names.get(a.id) || '').localeCompare(names.get(b.id) || '', 'fr'); });
    var rank = 0, lastKills = null;
    rows.forEach(function (r, i) { if (r.kills !== lastKills) { rank = i + 1; lastKills = r.kills; } r.rank = rank; r.label = rankLabel(rank); });
    return rows;
  }

  function stats(state) {
    var round = currentRound(state);
    var dead = deadSet(state);
    var players = state.players;
    var alive = players.filter(function (p) { return !dead.has(p.id); });
    var byYear = {};
    players.forEach(function (p) {
      var y = p.year || '?';
      byYear[y] = byYear[y] || { total: 0, alive: 0 };
      byYear[y].total++;
      if (!dead.has(p.id)) byYear[y].alive++;
    });
    var known = 0;
    if (round) {
      var maps = linkMaps(state, round.id);
      alive.forEach(function (p) { if (resolveTarget(state, round.id, p.id, maps, dead).id) known++; });
    }
    var attributed = state.kills.filter(function (k) { return !!k.killer_id; }).length;
    return {
      total: players.length, alive: alive.length, dead: players.length - alive.length,
      byYear: byYear, knownTargets: known,
      coverage: alive.length ? known / alive.length : 0,
      kills: state.kills.length, attributed: attributed, unattributed: state.kills.length - attributed,
      incomplete: players.filter(function (p) { return !dead.has(p.id) && (!p.year || !p.td || !p.photo_path); })
    };
  }

  function classesTree(state) {
    var tree = {};
    state.players.forEach(function (p) {
      var y = p.year || '?', d = p.dept || '—', t = p.td || '?';
      tree[y] = tree[y] || {}; tree[y][d] = tree[y][d] || {}; (tree[y][d][t] = tree[y][d][t] || []).push(p);
    });
    Object.keys(tree).forEach(function (y) { Object.keys(tree[y]).forEach(function (d) { Object.keys(tree[y][d]).forEach(function (t) {
      tree[y][d][t].sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
    }); }); });
    return tree;
  }

  function languageGroups(value) {
    return Array.from(new Set(String(value || '').split(',').map(function (group) { return group.trim(); }).filter(Boolean)));
  }

  function languageGroupBuckets(value) {
    var buckets = { english: [], other: [] };
    languageGroups(value).forEach(function (group) {
      buckets[/^G\d+$/i.test(group) ? 'english' : 'other'].push(group);
    });
    return buckets;
  }

  /* ---------- Import (pasted text or CSV/TSV) ----------
     parseTable() turns raw text into { header, rows, delimiter }.
     guessMapping() proposes a field for each column; mapRows() applies a mapping and an optional row filter. */
  var FIELDS = ['name', 'year', 'dept', 'td', 'tp', 'option', 'lang_group', 'address', 'address_type', 'notes', 'weapons', 'points'];
  var HEADER_MAP = [
    [/^(name|nom|joueur|player|fullname|nomprenom|nometprenom)$/, 'name'], [/^(year|annee|promo|grade|level)$/, 'year'],
    [/^(department|departement|dept|dep|filiere|major)$/, 'dept'], [/^td$/, 'td'], [/^tp$/, 'tp'], [/^(option|track)$/, 'option'],
    [/^(languagegroup|groupelangue|langue|groupedelangue|lang)$/, 'lang_group'], [/^(address|adresse|adressepostale|secteur|lieu|residence)$/, 'address'],
    [/^(type|housing|typedelogement|typedadresse|typeadresse|logement|categorie|category)$/, 'address_type'],
    [/^(notes?|infos?|informations?|informationscomplementaires|comments?|remarques?)$/, 'notes'], [/^(weapons?|armes?)$/, 'weapons'], [/^points?$/, 'points']
  ];
  function splitLine(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  function parseTable(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { header: [], rows: [], delimiter: '\t', hasHeader: false };
    var first = lines[0];
    var delim = first.indexOf('\t') >= 0 ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    var head = splitLine(first, delim);
    var hasHeader = head.some(function (hd) { var n = norm(hd); return HEADER_MAP.some(function (m) { return m[0].test(n); }); });
    var rows = lines.slice(hasHeader ? 1 : 0).map(function (l) { return splitLine(l, delim); });
    var width = Math.max.apply(null, [head.length].concat(rows.map(function (r) { return r.length; })));
    if (!hasHeader) head = [];
    for (var i = head.length; i < width; i++) head.push('');
    return { header: head, rows: rows, delimiter: delim, hasHeader: hasHeader };
  }
  function guessMapping(table) {
    var used = {}, map = table.header.map(function (hd) {
      var n = norm(hd);
      for (var i = 0; i < HEADER_MAP.length; i++) if (HEADER_MAP[i][0].test(n) && !used[HEADER_MAP[i][1]]) { used[HEADER_MAP[i][1]] = true; return HEADER_MAP[i][1]; }
      return '';
    });
    if (!table.hasHeader && map.length) map[0] = 'name';
    return map;
  }
  /* mapping: field name per column ('' = ignore). filter: { column, value } keeps rows whose column matches value (case/accents ignored). */
  function mapRows(table, mapping, filter) {
    var rows = [], skipped = 0;
    table.rows.forEach(function (cells) {
      if (filter && filter.column >= 0 && filter.value !== '' && norm(cells[filter.column]) !== norm(filter.value)) { skipped++; return; }
      var row = {};
      mapping.forEach(function (field, i) { if (field && cells[i]) row[field] = cells[i]; });
      if (!row.name) { skipped++; return; }
      if (row.points != null) { var n = parseInt(row.points, 10); row.points = isFinite(n) && n >= 0 && n < 1000 ? n : 0; }
      if (row.address) row.address_type = row.address_type ? addressType(row.address_type) : guessAddressType(row.address); else delete row.address_type;
      rows.push(row);
    });
    return { rows: rows, skipped: skipped };
  }
  /* Auto-mapping, no filter. */
  function parseImport(text) { var t = parseTable(text), m = guessMapping(t), r = mapRows(t, m); return { rows: r.rows, skipped: r.skipped, columns: m.filter(Boolean) }; }

  /* ---------- Export ---------- */
  function csvCell(v) { v = v == null ? '' : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(header, rows) { return [header].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'); }

  /* ---------- Map ---------- */
  // Housing types, most collective first: a shared marker takes the most collective type.
  var ADDRESS_TYPES = [
    { id: 'residence', label: 'Student residence', plural: 'Student residences' },
    { id: 'immeuble', label: 'Apartment building', plural: 'Apartment buildings' },
    { id: 'coloc', label: 'Shared flat', plural: 'Shared flats' },
    { id: 'normale', label: 'Regular address', plural: 'Regular addresses' }
  ];
  function addressType(v) {
    var n = norm(v);
    if (/^(residence|res|crous|dorm|hall|studentresidence)/.test(n)) return 'residence';
    if (/^(immeuble|building|apartment|appartement|appart|flat)/.test(n)) return 'immeuble';
    if (/^(coloc|colocation|shared|sharedflat|roommates)/.test(n)) return 'coloc';
    return 'normale';
  }
  function guessAddressType(address) { return /r[ée]sidence|crous/i.test(String(address || '')) ? 'residence' : 'normale'; }
  function hasCoords(p) { return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng); }
  function hasAddress(p) { return !!p && String(p.address || '').trim() !== ''; }
  /* Players shown on the map need an address AND coordinates. Flatmates and residence neighbours share one marker. */
  function typeRank(id) { for (var i = 0; i < ADDRESS_TYPES.length; i++) if (ADDRESS_TYPES[i].id === id) return i; return ADDRESS_TYPES.length; }
  function places(players) {
    var byKey = new Map();
    players.forEach(function (p) {
      if (!hasAddress(p) || !hasCoords(p)) return;
      var key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      if (!byKey.has(key)) byKey.set(key, { key: key, lat: p.lat, lng: p.lng, players: [], type: 'normale' });
      var pl = byKey.get(key), t = addressType(p.address_type);
      pl.players.push(p);
      if (typeRank(t) < typeRank(pl.type)) pl.type = t;
    });
    var out = []; byKey.forEach(function (v) { v.players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); }); out.push(v); });
    return out;
  }

  return {
    hasCoords: hasCoords, hasAddress: hasAddress, places: places, ADDRESS_TYPES: ADDRESS_TYPES, addressType: addressType, guessAddressType: guessAddressType,
    norm: norm, weakest: weakest, sortedRounds: sortedRounds, currentRound: currentRound, deadSet: deadSet,
    linkMaps: linkMaps, resolveTarget: resolveTarget, resolveHunter: resolveHunter, fragments: fragments,
    planSetTarget: planSetTarget, planMove: planMove, FIELDS: FIELDS, parseTable: parseTable, guessMapping: guessMapping, mapRows: mapRows, toCsv: toCsv, killPoints: killPoints, weaponList: weaponList, rankLabel: rankLabel,
    leaderboard: leaderboard, stats: stats, classesTree: classesTree, languageGroups: languageGroups, languageGroupBuckets: languageGroupBuckets, parseImport: parseImport
  };
});

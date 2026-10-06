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
     seg: consecutive ids of one fragment. dest: { after, before } (either may be missing) or { tray: true, disband?: true }.
     In the tray a multi-player segment keeps its own links (a new fragment) unless disband is set.
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
    if (dest.tray && !H && !N && !closing && !(dest.disband && seg.length > 1)) return { noop: true, remove: [], add: [] };

    // 1. detach the segment: cut the incoming and outgoing links, then close the gap
    var inLink = maps().hunterOf.get(first), inConf = inLink ? inLink.confidence : 'sur', outConf = 'sur';
    if (N0) { var outLink = maps().hunterOf.get(N0); if (outLink) outConf = outLink.confidence; drop(outLink); }
    drop(maps().hunterOf.get(first));
    if (H && N) link(H, N, weakest(inConf, outConf));

    if (dest.tray && dest.disband) work.links.filter(function (l) { return inSeg.has(l.hunter_id) || inSeg.has(l.target_id); }).forEach(drop);

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
  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /* Catalogue weapons for what is being typed, best first: same name (accents, case, spaces and dashes ignored),
     then names starting with it, containing it, and close spellings (typo, plural). exclude: names already picked. */
  function matchWeapons(query, weapons, exclude) {
    var q = norm(query), skip = new Set((exclude || []).map(norm));
    if (!q) return [];
    var single = function (s) { return s.replace(/[sx]$/, ''); }, out = [];
    weapons.forEach(function (w) {
      var n = norm(w.name), how = null;
      if (!n || skip.has(n)) return;
      if (n === q || single(n) === single(q)) how = 'exact';
      else if (n.indexOf(q) === 0) how = 'prefix';
      else if (n.indexOf(q) > 0) how = 'contains';
      else if (q.length >= 4 && editDistance(single(n), single(q)) <= (q.length <= 6 ? 1 : 2)) how = 'close';
      if (how) out.push({ weapon: w, how: how });
    });
    var rank = { exact: 0, prefix: 1, contains: 2, close: 3 };
    return out.sort(function (a, b) { return rank[a.how] - rank[b.how] || a.weapon.name.localeCompare(b.weapon.name, 'fr'); });
  }
  /* A weapons text with one weapon renamed (merge): null when that weapon is not in it. Duplicates collapse. */
  function renameWeapon(text, from, to) {
    var list = weaponList(text), f = norm(from), seen = new Set(), hit = false;
    var out = list.map(function (w) { if (norm(w) === f) { hit = true; return to; } return w; })
      .filter(function (w) { var n = norm(w); if (seen.has(n)) return false; seen.add(n); return true; });
    return hit ? out.join(', ') : null;
  }

  function rankLabel(n) { return String(n); }

  function leaderboard(state) {
    var count = new Map(), adminKills = 0;
    state.kills.forEach(function (k) {
      if (k.killer_id) count.set(k.killer_id, (count.get(k.killer_id) || 0) + 1);
      else if (k.admin_reason) adminKills++;
    });
    var rows = [];
    count.forEach(function (n, id) { rows.push({ id: id, kills: n }); });
    if (adminKills) rows.push({ id: 'admin', kills: adminKills, admin: true });
    var names = new Map(state.players.map(function (p) { return [p.id, p.name || '']; }));
    rows.sort(function (a, b) { return b.kills - a.kills || (a.admin ? 'Admin' : names.get(a.id) || '').localeCompare(b.admin ? 'Admin' : names.get(b.id) || '', 'fr'); });
    var rank = 0, lastKills = null;
    rows.forEach(function (r, i) { if (r.kills !== lastKills) { rank = i + 1; lastKills = r.kills; } r.rank = rank; r.label = rankLabel(rank); });
    return rows;
  }

  function generalRanking(state) {
    var players = state.players, deathByPlayer = new Map();
    state.kills.forEach(function (kill) {
      if (!players.some(function (p) { return p.id === kill.victim_id; })) return;
      var previous = deathByPlayer.get(kill.victim_id);
      if (!previous || Date.parse(kill.happened_at) < Date.parse(previous.happened_at)) deathByPlayer.set(kill.victim_id, kill);
    });
    function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); }
    var alive = players.filter(function (p) { return !deathByPlayer.has(p.id); }).sort(byName).map(function (p) {
      return { id: p.id, alive: true, rank: null };
    });
    var dead = players.filter(function (p) { return deathByPlayer.has(p.id); }).sort(function (a, b) {
      var timeA = Date.parse(deathByPlayer.get(a.id).happened_at) || 0;
      var timeB = Date.parse(deathByPlayer.get(b.id).happened_at) || 0;
      return timeB - timeA || byName(a, b);
    }).map(function (p, i, list) {
      return { id: p.id, alive: false, rank: players.length - list.length + i + 1 };
    });
    return alive.concat(dead);
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
    var killsByYear = {};
    Object.keys(byYear).forEach(function (y) { killsByYear[y] = 0; });
    state.kills.forEach(function (kill) {
      if (!kill.killer_id) return;
      var killer = players.find(function (p) { return p.id === kill.killer_id; });
      if (!killer) return;
      var y = killer.year || '?';
      killsByYear[y] = (killsByYear[y] || 0) + 1;
    });
    var known = 0;
    if (round) {
      var maps = linkMaps(state, round.id);
      alive.forEach(function (p) { if (resolveTarget(state, round.id, p.id, maps, dead).id) known++; });
    }
    var attributed = state.kills.filter(function (k) { return !!k.killer_id || !!k.admin_reason; }).length;
    // Information gathered on every player outside the alliance, dead or alive.
    var targets = players.filter(function (p) { return !p.is_ally; });
    function count(test) { return targets.filter(test).length; }
    var collected = {
      total: targets.length,
      address: count(hasAddress), located: count(function (p) { return hasAddress(p) && hasCoords(p); }),
      photo: count(function (p) { return !!p.photo_path; }), cls: count(function (p) { return !!p.year && !!p.td; }),
      weapons: count(function (p) { return String(p.weapons || '').trim() !== ''; }),
      byYear: {}, housing: {}
    };
    targets.forEach(function (p) {
      var y = p.year || '?', b = collected.byYear[y] = collected.byYear[y] || { total: 0, address: 0 };
      b.total++;
      if (!hasAddress(p)) return;
      b.address++;
      var type = addressType(p.address_type); collected.housing[type] = (collected.housing[type] || 0) + 1;
    });
    return {
      total: players.length, alive: alive.length, dead: players.length - alive.length,
      byYear: byYear, killsByYear: killsByYear, knownTargets: known,
      coverage: alive.length ? known / alive.length : 0,
      kills: state.kills.length, attributed: attributed, unattributed: state.kills.length - attributed, collected: collected,
      incomplete: players.filter(function (p) { return !dead.has(p.id) && !p.is_ally && (!p.year || !p.td || !p.photo_path || !p.address); })
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

  /* ---------- Full-game backup ----------
     Every table with every column, so a backup restores into an empty database (or the demo) as is.
     Defaults give the type; null = required reference; NOW = the import time when the backup has no date. */
  var BACKUP_FORMAT = 'killer-backup', NOW = {};
  var BACKUP_TABLES = {
    players: { name: '', year: '', dept: '', td: '', tp: '', option: '', lang_group: '', address: '', address_type: 'normale', lat: 0, lng: 0, notes: '', weapons: '', points: 0, is_ally: false, status: '', home_id: '', apartment: '', photo_path: '', created_at: NOW },
    rounds: { name: '', position: 0, created_at: NOW },
    links: { round_id: null, hunter_id: null, target_id: null, confidence: 'sur', source: '', created_at: NOW },
    kills: { round_id: '', killer_id: '', victim_id: null, weapon: '', points: 0, admin_reason: '', note: '', killer_weapons: null, happened_at: NOW },
    weapons: { name: '', difficulty: 'facile', owned: false, note: '' },
    events: { text: '', actor: '', details: {}, created_at: NOW },
    spots: { name: '', note: '', address: '', lat: 0, lng: 0, created_at: NOW },
    homes: { kind: 'coloc', name: '', address: '', lat: 0, lng: 0, building: '', note: '', created_at: NOW },
    bonuses: { player_id: null, name: '', price: 0, bought_at: NOW, starts_at: NOW, ends_at: NOW, note: '', created_at: NOW }
  };
  var NULLABLE = { lat: 1, lng: 1, photo_path: 1, round_id: 1, killer_id: 1, admin_reason: 1, details: 1, ends_at: 1, home_id: 1 };   // empty -> null rather than the default
  var ENUMS = { address_type: ['normale', 'residence', 'coloc', 'immeuble'], confidence: ['sur', 'probable', 'rumeur'], difficulty: ['facile', 'difficile'], admin_reason: ['cheating', 'other'], status: ['', 'dangerous', 'priority'], kind: ['coloc', 'residence'] };
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function cleanValue(key, v, def, now) {
    if (key === 'killer_weapons') return v == null ? null : String(v);   // '' is meaningful: the killer had no weapon
    if (v == null || v === '') return NULLABLE[key] || def === null ? null : def === NOW ? now : def;
    if (ENUMS[key]) return ENUMS[key].indexOf(v) >= 0 ? v : (NULLABLE[key] ? null : def);
    if (def === NOW) { var d = new Date(v); return isNaN(d) ? now : d.toISOString(); }
    if (typeof def === 'number') { var n = Number(v); return isFinite(n) ? (key === 'lat' || key === 'lng' ? n : Math.round(n)) : (NULLABLE[key] ? null : def); }
    if (typeof def === 'boolean') return v === true || v === 'true';
    if (key === 'details') return typeof v === 'object' ? v : null;
    return String(v);
  }
  /* Parses and checks a backup file. Ids that are not UUIDs (demo game) get new ones so the backup also fits the
     database; references follow, dangling ones are dropped. -> { data, meta } or { error: message key } */
  function readBackup(text, opts) {
    opts = opts || {};
    var raw, now = opts.now || new Date().toISOString(), newId = opts.uuid;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { error: 'This file is not valid JSON.' }; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players) || (raw.format && raw.format !== BACKUP_FORMAT)) return { error: 'This file is not a Killer backup.' };
    var ids = new Map(), data = {};
    function mapId(id) {
      id = String(id);
      if (!ids.has(id)) ids.set(id, UUID_RE.test(id) || !newId ? id : newId());
      return ids.get(id);
    }
    Object.keys(BACKUP_TABLES).forEach(function (table) {
      var cols = BACKUP_TABLES[table], seen = new Set();
      data[table] = (Array.isArray(raw[table]) ? raw[table] : []).filter(function (r) { return r && typeof r === 'object' && r.id != null && !seen.has(String(r.id)) && seen.add(String(r.id)); })
        .map(function (r) {
          var row = { id: mapId(r.id) };
          Object.keys(cols).forEach(function (k) { row[k] = cleanValue(k, r[k], cols[k], now); });
          return row;
        });
    });
    // References: ids are remapped, then anything pointing nowhere is dropped (required) or cleared (optional).
    var has = {}; ['players', 'rounds', 'kills', 'homes'].forEach(function (tb) { has[tb] = new Set(data[tb].map(function (r) { return r.id; })); });
    function ref(v, table) { if (v == null) return null; v = ids.get(String(v)) || String(v); return has[table].has(v) ? v : null; }
    data.players = data.players.filter(function (p) { return p.name.trim(); }); has.players = new Set(data.players.map(function (p) { return p.id; }));
    data.links = data.links.map(function (l) { l.round_id = ref(l.round_id, 'rounds'); l.hunter_id = ref(l.hunter_id, 'players'); l.target_id = ref(l.target_id, 'players'); return l; })
      .filter(function (l) { return l.round_id && l.hunter_id && l.target_id && l.hunter_id !== l.target_id; });
    var victims = new Set();
    data.players.forEach(function (p) { p.home_id = ref(p.home_id, 'homes'); });
    data.bonuses = data.bonuses.map(function (b) { b.player_id = ref(b.player_id, 'players'); return b; }).filter(function (b) { return b.player_id; });
    data.kills = data.kills.map(function (k) { k.round_id = ref(k.round_id, 'rounds'); k.killer_id = ref(k.killer_id, 'players'); k.victim_id = ref(k.victim_id, 'players'); return k; })
      .filter(function (k) { return k.victim_id && !victims.has(k.victim_id) && victims.add(k.victim_id); });
    data.events.forEach(function (e) {
      if (!e.details) return;
      Object.keys(e.details).forEach(function (k) { if (/_id$/.test(k) && e.details[k] != null && ids.has(String(e.details[k]))) e.details[k] = ids.get(String(e.details[k])); });
    });
    data.settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {};
    return { data: data, meta: { name: raw.game_name || data.settings.game_name || '', exported_at: raw.exported_at || null, photos: data.players.filter(function (p) { return p.photo_path && p.photo_path.indexOf('data:') === 0; }).length } };
  }
  function makeBackup(state, exportedAt) {
    var out = { format: BACKUP_FORMAT, version: 1, exported_at: exportedAt || new Date().toISOString(), game_name: (state.settings && state.settings.game_name) || '' };
    Object.keys(BACKUP_TABLES).forEach(function (t) { out[t] = state[t] || []; });
    out.settings = state.settings || {};
    return out;
  }

  /* ---------- Timetables (iCal) ----------
     A student's timetable is several layers on top of each other, each with its own iCal link on HyperPlanning:
     the whole year, the department, the TD, the TP, the language group, options. A layer is
     { url, name, year, dept, field, value }: it applies to the players of that year (and department, when set)
     whose field ('td', 'tp', 'lang_group', 'option', or '' for everyone) contains that value. */
  var CAL_FIELDS = ['td', 'tp', 'lang_group', 'option'];
  /* Group names are compared word by word, in any order: "TD 1 MRI", "TD1 MRI" and "MRI TD1" are the same group. */
  function groupKey(v) {
    return (String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]+|\d+/g) || [])
      .map(function (w) { return /^\d+$/.test(w) ? String(+w) : w; }).sort().join(' ');
  }
  function splitValues(v) { return String(v || '').split(/[,;/]+/).map(groupKey).filter(Boolean); }
  // field 'any': a sub-group written in any group field ("MRI 4A - GP": "GP", "TD GP" or an option "GP")
  function looseKey(k) { return k.split(' ').filter(function (w) { return ['td', 'tp', 'groupe', 'group', 'gr', 'option'].indexOf(w) < 0; }).join(' '); }
  function calendarMatches(c, p) {
    if (!c || !c.url || !p || !norm(c.year) || norm(c.year) !== norm(p.year)) return false;
    if (norm(c.dept) && norm(c.dept) !== norm(p.dept)) return false;
    if (!c.field) return true;
    if (c.field === 'any') {
      var want = looseKey(groupKey(c.value));
      return !!want && CAL_FIELDS.some(function (f) { return splitValues(p[f]).map(looseKey).indexOf(want) >= 0; });
    }
    return splitValues(p[c.field]).indexOf(groupKey(c.value)) >= 0;
  }
  function calendarsFor(p, calendars) { return (calendars || []).filter(function (c) { return calendarMatches(c, p); }); }
  /* HyperPlanning names its exports "<promotion><category>group", e.g. "<STI 3A><TD>TD1" or, in 2nd year,
     "<STPI 2A><BOURGES - P.O TD>TD 1 MRI". knownDepts (the departments of the game) tells a department apart from
     the other words of a promotion name (STPI, BOURGES...). Categories: TD, TP, LV (language groups), P.O
     (the department itself), P.O TD / P.O TP (a TD or TP inside a department), COURS (the whole year). */
  var NOT_DEPT = ['stpi', 'bourges', 'blois', 'cours', 'insa', 'cvl', 'promo', 'promotion'];
  function calendarScope(name, knownDepts) {
    var parts = [], re = /<([^>]*)>([^<]*)/g, m;
    while ((m = re.exec(String(name || '')))) parts.push({ tag: m[1].trim(), text: m[2].trim() });
    var sub = null;
    if (!parts.length && /\b\d+\s*A\b/i.test(String(name || ''))) {   // "STI 3A": a whole promotion; "MRI 4A - GP": a sub-group of it
      var bits = String(name).split(/\s+-\s+/);
      parts.push({ tag: bits[0].trim(), text: '' });
      if (bits.length > 1) sub = bits.slice(1).join(' - ').trim();
    }
    if (!parts.length) return null;
    var known = (knownDepts || []).filter(function (d) { return norm(d); });
    function deptOf(word) {   // the department a word names, written as in the game; null if it is not one
      var n = norm(word);
      if (!n || /^\d/.test(n) || /^(td|tp|g)\d*$/.test(n)) return null;
      if (known.length) return known.find(function (d) { return norm(d) === n; }) || null;
      return NOT_DEPT.indexOf(n) < 0 ? word : null;
    }
    var out = { year: '', dept: '', field: '', value: '' };
    parts[0].tag.split(/\s+/).filter(Boolean).forEach(function (w) {
      if (/^\d+\s*A$/i.test(w) || /^\d$/.test(w)) out.year = w.toUpperCase();
      else if (!out.dept && deptOf(w)) out.dept = deptOf(w);
    });
    if (sub) { out.field = 'any'; out.value = sub; return out; }
    var group = parts[1];
    if (!group) return out;
    var type = norm(group.tag.replace(/^.*\s-\s*/, '')), value = group.text || group.tag, words = value.split(/\s+/);   // "BOURGES - P.O TD": drop the campus
    if (/^(cours|promo|promotion)$/.test(type)) return out;   // the whole year
    if (type === 'po') { out.dept = deptOf(value) || value; return out; }   // a department of the year
    if (/^po/.test(type) || known.length) words.forEach(function (w) { if (!out.dept) out.dept = deptOf(w) || ''; });   // "TD 1 MRI": a TD of MRI
    out.value = value;
    out.field = /td$/.test(type) ? 'td' : /tp$/.test(type) ? 'tp' : /^(lv|langue|langues|anglais|groupe)/.test(type) || /^g\d/.test(norm(value)) ? 'lang_group' : 'option';
    return out;
  }
  /* "<STI 3A><TD>TD1" -> "STI 3A · TD1", for display. */
  function calendarLabel(name) {
    var parts = [], re = /<([^>]*)>([^<]*)/g, m;
    while ((m = re.exec(String(name || '')))) parts.push((m[2].trim() || m[1].trim()));
    return parts.length ? parts.join(' · ') : String(name || '');
  }
  function icsCalendarName(text) {
    var m = /(?:^|\n)X-WR-CALNAME[^:]*:([^\n]*(?:\n[ \t][^\n]*)*)/.exec(String(text || '').replace(/\r\n|\r/g, '\n'));
    return m ? m[1].replace(/\n[ \t]/g, '').replace(/^HYP\s*-\s*/, '').replace(/\s+-\s+du\s.*$/, '').trim() : '';
  }
  /* Several layers merged: a class present in two of them (same start and title) is kept once. */
  /* Some exports hold the whole promotion seen from one group: every class names the groups it is for
     ("TD : TD 2", "TD : G1", "TD : TP 1"). A player keeps the classes with no group (lectures, sport, meetings),
     those for the whole promotion ("COURS..."), and those of a group written on their sheet (TD, TP, language
     group or option, in any of these fields). Cancelled classes are dropped. */
  function eventForPlayer(e, p) {
    if (e.cancelled) return false;
    if (!e.groups || !e.groups.length) return true;
    var keys = e.groups.map(groupKey);
    if (keys.some(function (k) { return /(^| )cours( |$)/.test(k); })) return true;
    var mine = splitValues(p && p.dept);   // "MRI", "STI": classes of a department (2nd-year orientation)
    CAL_FIELDS.forEach(function (f) { mine = mine.concat(splitValues(p && p[f])); });
    return keys.some(function (k) { return mine.indexOf(k) >= 0; });
  }
  /* Kind of class, for the HyperPlanning colours. The export carries no type, so it is read from the audience:
     a TP group -> 'tp'; another group (TD, language group, project) -> 'td'; no group but a teacher -> 'cm'
     (lecture); no teacher, the whole promotion ("COURS...") or a whole day -> 'event'. */
  function classKind(e) {
    if (!e || e.allDay) return 'event';
    var keys = (e.groups || []).map(groupKey);
    // for a whole promotion ("COURS 2A STPI BOURGES") or a whole department ("MRI"): like no group at all
    var wide = keys.length && keys.every(function (k) { return /(^| )cours( |$)/.test(k) || /^[a-z]+$/.test(k); });
    if (keys.length && !wide) return keys.some(function (k) { return k.split(' ').indexOf('tp') >= 0; }) ? 'tp' : 'td';
    return e.teacher ? 'cm' : 'event';
  }
  /* An export that names many different groups is the whole promotion seen from one of them: it should apply to
     the whole promotion (each player then keeps their own groups' classes). */
  function isPromotionView(events) {
    var seen = new Set();
    (events || []).forEach(function (e) { (e.groups || []).forEach(function (g) { var k = groupKey(g); if (!/(^| )cours( |$)/.test(k)) seen.add(k); }); });
    return seen.size >= 5;
  }
  function mergeEvents(lists) {
    var seen = new Set(), out = [];
    lists.forEach(function (list) { (list || []).forEach(function (e) { var k = +e.start + '|' + norm(e.summary); if (!seen.has(k)) { seen.add(k); out.push(e); } }); });
    return out.sort(function (a, b) { return a.start - b.start; });
  }
  /* "Matière : X" and "Enseignant : Y" from HyperPlanning descriptions, for a shorter title than the summary. */
  function descField(desc, label) { var m = new RegExp('(?:^|\\n)' + label + '\\s*:\\s*([^\\n]*)', 'i').exec(desc || ''); return m ? m[1].trim() : ''; }
  /* The game happens in France: times are always read and shown in Paris time, wherever the phone is. */
  var TIME_ZONE = 'Europe/Paris', parisFormat = null;
  function parisParts(date) {   // -> { y, m (0-11), d, hh, mi, wd (0 = Monday) } in Paris
    parisFormat = parisFormat || new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
    var o = {};
    parisFormat.formatToParts(date).forEach(function (x) { o[x.type] = x.value; });
    return { y: +o.year, m: +o.month - 1, d: +o.day, hh: +o.hour % 24, mi: +o.minute, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday) };
  }
  function parisDate(y, mo, d, hh, mi, ss) {   // the moment when Paris clocks show that date and time (day overflow allowed)
    var wall = Date.UTC(y, mo, d, hh || 0, mi || 0, ss || 0), t = wall;
    for (var i = 0; i < 2; i++) { var p = parisParts(new Date(t)); t = t - (Date.UTC(p.y, p.m, p.d, p.hh, p.mi, (ss || 0)) - wall); }
    return new Date(t);
  }
  function parisDay(date) { var p = parisParts(date); return p.y + '-' + (p.m + 1) + '-' + p.d; }
  function icsDate(value) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3], hh = +(m[4] || 0), mi = +(m[5] || 0), ss = +(m[6] || 0);
    // UTC when marked Z; otherwise the school's local time (Europe/Paris), whatever the phone's time zone.
    return m[7] ? new Date(Date.UTC(y, mo, d, hh, mi, ss)) : parisDate(y, mo, d, hh, mi, ss);
  }
  function icsText(v) { return String(v || '').replace(/\\([nN,;\\])/g, function (x, c) { return c === 'n' || c === 'N' ? '\n' : c; }).trim(); }
  /* VEVENTs of an iCal file, sorted by start: { uid, start, end, summary, location, description }. */
  function parseIcs(text) {
    var lines = String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');   // unfold continuation lines
    var events = [], cur = null;
    lines.forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { cur = {}; return; }
      if (line === 'END:VEVENT') {
        if (cur && cur.start) events.push({ uid: cur.uid || '', start: cur.start, end: cur.end || cur.start, allDay: !!cur.allDay, summary: cur.summary || '', location: cur.location || '', description: cur.description || '',
          subject: descField(cur.description, 'Matière'), teacher: descField(cur.description, 'Enseignants?'),
          groups: descField(cur.description, 'TD').split(',').map(function (g) { return g.trim(); }).filter(Boolean),   // who the class is for ("TD : TD 1, TD 2", "TD : G1")
          cancelled: /^COURSANNULE/i.test(cur.uid || '') || /^Annulation\b/i.test(cur.summary || '') });
        cur = null; return;
      }
      if (!cur) return;
      var colon = -1, quoted = false;
      for (var i = 0; i < line.length; i++) { if (line[i] === '"') quoted = !quoted; else if (line[i] === ':' && !quoted) { colon = i; break; } }
      if (colon < 0) return;
      var name = line.slice(0, colon).split(';')[0].toUpperCase(), value = line.slice(colon + 1);
      if (name === 'DTSTART') { cur.start = icsDate(value); cur.allDay = /^\d{8}$/.test(value.trim()); }   // a date alone: holidays, bank holidays
      else if (name === 'DTEND') cur.end = icsDate(value);
      else if (name === 'SUMMARY') cur.summary = icsText(value);
      else if (name === 'LOCATION') cur.location = icsText(value);
      else if (name === 'DESCRIPTION') cur.description = icsText(value);
      else if (name === 'UID') cur.uid = value.trim();
    });
    return events.filter(function (e) { return e.start && !isNaN(e.start); }).sort(function (a, b) { return a.start - b.start; });
  }
  /* What a player is doing at a given moment: the class in progress and the next one. */
  function scheduleAt(events, now) {
    now = now || new Date();
    var current = null, next = null;
    (events || []).forEach(function (e) {
      if (e.start <= now && now < e.end) { if (!current || (current.allDay && !e.allDay)) current = e; }   // a class beats a holiday
      else if (e.start > now && (!next || e.start < next.start)) next = e;
    });
    return { current: current, next: next };
  }

  /* ---------- Shop bonuses ----------
     Timing of a shop item: start 'now' or 'next_day' (00:10 the day after purchase, Paris time) and a duration in
     hours (0 = one-off, like a reveal). Items saved before these fields existed get them from their description. */
  function bonusTiming(item) {
    item = item || {};
    var d = String(item.description || '');
    var start = item.start || (/00[:h]10|day after|lendemain/i.test(d) ? 'next_day' : 'now');
    var hours = item.hours != null && item.hours !== '' ? +item.hours : null;
    if (hours == null || isNaN(hours)) { var m = /(\d+)\s*(?:hours?|heures?|h\b)/i.exec(d); hours = m ? +m[1] : 0; }
    return { start: start === 'next_day' ? 'next_day' : 'now', hours: Math.max(0, hours) };
  }
  /* -> { starts, ends } (ends null for a one-off) for an item bought at boughtAt. */
  function bonusWindow(item, boughtAt) {
    var tm = bonusTiming(item), bought = new Date(boughtAt || Date.now()), starts = bought;
    if (tm.start === 'next_day') { var p = parisParts(bought); starts = parisDate(p.y, p.m, p.d + 1, 0, 10); }
    return { starts: starts, ends: tm.hours ? new Date(+starts + tm.hours * 3600e3) : null };
  }
  /* 'upcoming', 'active', 'over' (a one-off is over as soon as it is used) */
  function bonusStatus(b, now) {
    now = +(now || new Date());
    var s = +new Date(b.starts_at), e = b.ends_at ? +new Date(b.ends_at) : null;
    if (now < s) return 'upcoming';
    return e && now < e ? 'active' : 'over';
  }
  /* Bonuses of a player (or of everyone) still to come or in effect, soonest first. */
  function currentBonuses(state, playerId, now) {
    return (state.bonuses || []).filter(function (b) { return (!playerId || b.player_id === playerId) && bonusStatus(b, now) !== 'over'; })
      .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
  }

  /* ---------- Danger alerts ----------
     What threatens the alliance right now, from what the app already knows: an ally's known hunter holding a
     Coupe-Gorge, marked dangerous, or with enough points to buy one; an ally's target that is immune.
     -> [{ level: 'high'|'warn'|'info', kind, allyId, otherId, bonus }] most serious first. */
  function dangerAlerts(state, now) {
    now = now || new Date();
    var round = currentRound(state), out = [];
    if (!round) return out;
    var dead = deadSet(state), maps = linkMaps(state, round.id);
    var shop = (state.settings && state.settings.shop) || [];
    var cutthroats = shop.filter(function (i) { return /coupe/i.test(i.name); }).sort(function (a, b) { return (b.price || 0) - (a.price || 0); });   // most expensive first
    function bonusesOf(id, re) { return currentBonuses(state, id, now).filter(function (b) { return re.test(b.name); }); }
    state.players.forEach(function (ally) {
      if (!ally.is_ally || dead.has(ally.id)) return;
      var hunter = resolveHunter(state, round.id, ally.id, maps, dead).id, h = hunter && state.players.find(function (p) { return p.id === hunter; });
      if (h && !h.is_ally) {
        bonusesOf(h.id, /coupe/i).forEach(function (b) { out.push({ level: bonusStatus(b, now) === 'active' ? 'high' : 'warn', kind: 'cutthroat', allyId: ally.id, otherId: h.id, bonus: b }); });
        if (h.status === 'dangerous') out.push({ level: 'warn', kind: 'dangerous', allyId: ally.id, otherId: h.id });
        var afford = cutthroats.filter(function (i) { return (h.points || 0) >= (i.price || 0); });   // any Coupe-Gorge they can pay for
        if (afford.length && !bonusesOf(h.id, /coupe/i).length) out.push({ level: 'warn', kind: 'rich', allyId: ally.id, otherId: h.id, points: h.points || 0, items: afford, item: afford[0].name, price: afford[0].price });
      }
      var target = resolveTarget(state, round.id, ally.id, maps, dead).id;
      var tp = target && state.players.find(function (p) { return p.id === target; });
      if (tp && !tp.is_ally) bonusesOf(target, /immun/i).forEach(function (b) { out.push({ level: 'info', kind: 'immune', allyId: ally.id, otherId: target, bonus: b }); });
    });
    var rank = { high: 0, warn: 1, info: 2 };
    return out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
  }

  /* ---------- Moments to catch a target ----------
     From the target's timetable (and mine, when my account is linked to my sheet): when they come out of a
     class or go into one, while I am not in the middle of a class myself (between classes counts: corridors). Same building as my previous or next class ranks first.
     -> [{ at, kind: 'leaves'|'arrives', where, event, near }] soonest first, weekdays 7:00-20:00 Paris time. */
  function building(location) { var m = /^[A-Za-zÀ-ÿ]+\d?/.exec(String(location || '').trim()); return m ? m[0].toUpperCase() : ''; }   // building and floor: "SA2.04" -> "SA2"
  function killWindows(targetEvents, myEvents, from, days) {
    from = from || new Date(); days = days || 7;
    var until = +from + days * 864e5, mine = (myEvents || []).filter(function (e) { return !e.allDay && !e.cancelled; });
    function busy(t) { return mine.some(function (e) { return +e.start + 5 * 6e4 < t && t < +e.end - 5 * 6e4; }); }   // in the middle of one of my classes; between two, I am in the corridors too
    function nearby(t) {   // the building of my class just before or just after
      var before = mine.filter(function (e) { return +e.end <= t && t - e.end <= 90 * 6e4; }).pop(), after = mine.filter(function (e) { return +e.start >= t && e.start - t <= 90 * 6e4; })[0];
      return [before, after].filter(Boolean).map(function (e) { return building(e.location); });
    }
    var out = [];
    (targetEvents || []).forEach(function (e) {
      if (e.allDay || e.cancelled) return;
      [['arrives', +e.start], ['leaves', +e.end]].forEach(function (x) {
        var t = x[1], p = parisParts(new Date(t));
        if (t < +from || t > until || p.wd > 4 || p.hh < 7 || p.hh >= 20 || busy(t)) return;
        var b = building(e.location);
        out.push({ at: new Date(t), kind: x[0], where: e.location || '', event: e, near: !!b && nearby(t).indexOf(b) >= 0 });
      });
    });
    // a class followed by another in the same room is one stay, not two chances
    out = out.filter(function (w) {
      return !(targetEvents || []).some(function (e) { return e !== w.event && !e.allDay && e.location === w.where && (w.kind === 'leaves' ? Math.abs(e.start - w.at) < 20 * 6e4 : Math.abs(e.end - w.at) < 20 * 6e4); });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }

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
    var out = []; byKey.forEach(function (v) {
      v.players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
      v.homeIds = v.players.map(function (p) { return p.home_id; }).filter(function (id, i, all) { return id && all.indexOf(id) === i; });   // shared flats at that address
      out.push(v);
    });
    return out;
  }
  /* ---------- Shared flats ---------- */
  function homeMembers(state, homeId) {
    var dead = deadSet(state), members = state.players.filter(function (p) { return p.home_id === homeId; });
    return { members: members, alive: members.filter(function (p) { return !dead.has(p.id); }) };
  }
  /* A home is a shared flat ('coloc') or a student residence ('residence'). */
  function homeKind(home) { return home && home.kind === 'residence' ? 'residence' : 'coloc'; }
  /* Players marked "shared flat" (or "student residence") at the same place and not in a named one yet: to name (2 or more). */
  function suggestedHomes(state, kind) {
    var byKey = new Map(); kind = kind || 'coloc';
    state.players.forEach(function (p) {
      if (p.home_id || addressType(p.address_type) !== kind || !hasCoords(p)) return;
      var key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      if (!byKey.has(key)) byKey.set(key, { address: p.address, lat: p.lat, lng: p.lng, players: [] });
      byKey.get(key).players.push(p);
    });
    var out = []; byKey.forEach(function (v) { if (v.players.length > 1) out.push(v); });
    return out;
  }

  return {
    hasCoords: hasCoords, hasAddress: hasAddress, places: places, homeMembers: homeMembers, suggestedHomes: suggestedHomes, homeKind: homeKind, ADDRESS_TYPES: ADDRESS_TYPES, addressType: addressType, guessAddressType: guessAddressType,
    norm: norm, weakest: weakest, sortedRounds: sortedRounds, currentRound: currentRound, deadSet: deadSet,
    linkMaps: linkMaps, resolveTarget: resolveTarget, resolveHunter: resolveHunter, fragments: fragments,
    planSetTarget: planSetTarget, planMove: planMove, FIELDS: FIELDS, parseTable: parseTable, guessMapping: guessMapping, mapRows: mapRows, toCsv: toCsv, readBackup: readBackup, makeBackup: makeBackup, bonusTiming: bonusTiming, bonusWindow: bonusWindow, bonusStatus: bonusStatus, currentBonuses: currentBonuses, dangerAlerts: dangerAlerts, killWindows: killWindows, building: building, TIME_ZONE: TIME_ZONE, parisParts: parisParts, parisDate: parisDate, parisDay: parisDay, calendarMatches: calendarMatches, calendarsFor: calendarsFor, calendarScope: calendarScope, groupKey: groupKey, calendarLabel: calendarLabel, icsCalendarName: icsCalendarName, mergeEvents: mergeEvents, eventForPlayer: eventForPlayer, classKind: classKind, isPromotionView: isPromotionView, CAL_FIELDS: CAL_FIELDS, parseIcs: parseIcs, scheduleAt: scheduleAt, killPoints: killPoints, weaponList: weaponList, matchWeapons: matchWeapons, renameWeapon: renameWeapon, rankLabel: rankLabel,
    leaderboard: leaderboard, generalRanking: generalRanking, stats: stats, classesTree: classesTree, languageGroups: languageGroups, languageGroupBuckets: languageGroupBuckets, parseImport: parseImport
  };
});

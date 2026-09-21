/* Logique pure du QG : aucune dépendance au DOM ni à Supabase.
   Chargée comme script classique dans le navigateur (K.logic) et comme module dans Node (tests). */
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

  /* Morts à la fin de la boucle roundId (toutes boucles si roundId absent).
     strict = true : morts AVANT le début de cette boucle (ils n'en font pas partie). */
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

  /* Cible (dir='target') ou killer (dir='hunter') ACTUEL d'un joueur : on suit les liens
     en sautant les morts, puisque le contrat d'un mort revient à celui qui le chassait. */
  function resolve(state, roundId, playerId, dir, maps, dead) {
    maps = maps || linkMaps(state, roundId);
    dead = dead || deadSet(state, roundId);
    var map = dir === 'hunter' ? maps.hunterOf : maps.targetOf;
    var key = dir === 'hunter' ? 'hunter_id' : 'target_id';
    var cur = playerId, via = [], conf = 'sur', guard = 0;
    while (guard++ < 10000) {
      var link = map.get(cur);
      if (!link) return { id: null, via: via, lastId: cur, confidence: conf, closed: false };
      conf = weakest(conf, link.confidence);
      var nxt = link[key];
      if (nxt === playerId) return { id: null, via: via, lastId: cur, confidence: conf, closed: true };
      if (!dead.has(nxt)) return { id: nxt, via: via, lastId: cur, confidence: conf, closed: false };
      via.push(nxt);
      cur = nxt;
    }
    return { id: null, via: via, lastId: cur, confidence: conf, closed: false };
  }
  function resolveTarget(state, roundId, id, maps, dead) { return resolve(state, roundId, id, 'target', maps, dead); }
  function resolveHunter(state, roundId, id, maps, dead) { return resolve(state, roundId, id, 'hunter', maps, dead); }

  /* Découpe la boucle en fragments connus.
     mode 'current'  : vivants seulement, liens dérivés (les morts sont sautés)
     mode 'complete' : tous les participants de la boucle, liens bruts */
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
          edge.set(id, { from: id, to: l.target_id, confidence: l.confidence, via: [], linkId: l.id, source: l.source });
        }
      } else {
        var r = resolveTarget(state, roundId, id, maps, dead);
        if (r.id && nodeSet.has(r.id)) {
          next.set(id, r.id);
          edge.set(id, { from: id, to: r.id, confidence: r.confidence, via: r.via });
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

  /* Prépare « hunter a pour cible target » sans rien écrire.
     Mode intelligent (deux vivants) : on accroche le lien au dernier mort connu derrière hunter,
     ce qui conserve la chaîne complète. Mode brut sinon (reconstitution avec des morts). */
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

    // Insertion d'un mort entre hunter et son ancienne cible : on rattache le mort à cette cible.
    if (raw && old && dead.has(targetId) && !maps.targetOf.has(targetId) && old.target_id !== targetId) {
      var stillHunted = maps.hunterOf.get(old.target_id);
      if (stillHunted === old) {
        add.push({ round_id: roundId, hunter_id: targetId, target_id: old.target_id, confidence: old.confidence, source: old.source || '' });
      }
    }
    return { remove: remove, add: add, anchorId: anchor, viaDead: anchor !== hunterId };
  }

  function killPoints(o) {
    var base = o.difficulty === 'difficile' ? 3 : 1;
    return base + (Number(o.bonus) || 0) + (o.firstBlood ? 5 : 0) + (Number(o.mates) || 0);
  }

  function weaponList(text) {
    return String(text || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function rankLabel(n) { return n === 1 ? '1er' : n + 'ème'; }

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
      var y = p.year || 'Année inconnue', d = p.dept || '—', t = p.td || 'TD inconnu';
      tree[y] = tree[y] || {}; tree[y][d] = tree[y][d] || {}; (tree[y][d][t] = tree[y][d][t] || []).push(p);
    });
    Object.keys(tree).forEach(function (y) { Object.keys(tree[y]).forEach(function (d) { Object.keys(tree[y][d]).forEach(function (t) {
      tree[y][d][t].sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
    }); }); });
    return tree;
  }

  /* ---------- Import (copier-coller depuis Excel, ou CSV) ---------- */
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
  var HEADER_MAP = [
    [/^(nom|joueur|nomprenom|nometprenom)$/, 'name'], [/^(annee|promo)$/, 'year'],
    [/^(departement|dept|dep|filiere)$/, 'dept'], [/^td$/, 'td'], [/^tp$/, 'tp'], [/^option$/, 'option'],
    [/^(groupelangue|langue|groupedelangue)$/, 'lang_group'], [/^(adresse|adressepostale|secteur|lieu|residence)$/, 'address'],
    [/^(informationscomplementaires|infos|notes|informations)$/, 'notes'], [/^armes?$/, 'weapons'],
    [/^points?$/, 'points'], [/^(joueaukiller|joue|inscrit)$/, 'plays']
  ];
  function parseImport(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { rows: [], skipped: 0, columns: [] };
    var first = lines[0];
    var delim = first.indexOf('\t') >= 0 ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    var head = splitLine(first, delim).map(function (hd) {
      var n = norm(hd);
      for (var i = 0; i < HEADER_MAP.length; i++) if (HEADER_MAP[i][0].test(n)) return HEADER_MAP[i][1];
      return null;
    });
    var hasHeader = head.indexOf('name') >= 0;
    if (!hasHeader) head = ['name'];
    var rows = [], skipped = 0;
    lines.slice(hasHeader ? 1 : 0).forEach(function (line) {
      var cells = splitLine(line, delim), row = {};
      head.forEach(function (key, i) { if (key && cells[i] != null && cells[i] !== '') row[key] = cells[i]; });
      if (!row.name) { skipped++; return; }
      // Seules les personnes inscrites au jeu entrent dans la base.
      if (head.indexOf('plays') >= 0 && norm(row.plays) !== 'oui') { skipped++; return; }
      delete row.plays;
      if (row.points != null) { var n = parseInt(row.points, 10); row.points = isFinite(n) && n >= 0 && n < 1000 ? n : 0; }
      rows.push(row);
    });
    return { rows: rows, skipped: skipped, columns: head.filter(Boolean) };
  }

  /* ---------- Carte ---------- */
  function hasCoords(p) { return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng); }
  function hasAddress(p) { return !!p && String(p.address || '').trim() !== ''; }
  /* Joueurs à afficher : une adresse ET des coordonnées. Les colocataires et voisins de résidence partagent un même point. */
  function places(players) {
    var byKey = new Map();
    players.forEach(function (p) {
      if (!hasAddress(p) || !hasCoords(p)) return;
      var key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
      if (!byKey.has(key)) byKey.set(key, { key: key, lat: p.lat, lng: p.lng, players: [] });
      byKey.get(key).players.push(p);
    });
    var out = []; byKey.forEach(function (v) { v.players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); }); out.push(v); });
    return out;
  }

  return {
    hasCoords: hasCoords, hasAddress: hasAddress, places: places,
    norm: norm, weakest: weakest, sortedRounds: sortedRounds, currentRound: currentRound, deadSet: deadSet,
    linkMaps: linkMaps, resolveTarget: resolveTarget, resolveHunter: resolveHunter, fragments: fragments,
    planSetTarget: planSetTarget, killPoints: killPoints, weaponList: weaponList, rankLabel: rankLabel,
    leaderboard: leaderboard, stats: stats, classesTree: classesTree, parseImport: parseImport
  };
});

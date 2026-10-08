/* Shared by the action files: player names, the current round, writing links, Paris-time form fields. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions = {}, _ = act._ = {};   // _: helpers shared by the action files

  function name(id) { var p = store.player(id); return p ? p.name : t('unknown player'); }
  act.currentRoundId = function () { var r = L.currentRound(store.state); return r ? r.id : null; };
  /* The dead, computed once per change of the data rather than once per player in every list */
  var dead = { version: -1, kills: null, set: null };
  act.isDead = function (id) {
    if (dead.version !== store.version || dead.kills !== store.state.kills) dead = { version: store.version, kills: store.state.kills, set: L.deadSet(store.state) };
    return dead.set.has(id);
  };

  function ensureRound() {
    var r = L.currentRound(store.state);
    if (r) return Promise.resolve(r.id);
    return store.insert('rounds', { name: t('Initial loop'), position: 0 }).then(function (row) { return row.id; });
  }
  function applyPlan(plan) {   // the links removed and added together (one transaction on the server)
    return store.replaceLinks(plan.remove.map(function (l) { return l.id; }), plan.add);
  }
  function linkDetails(hunterId, targetId, confidence, source) {
    return { type: 'link', hunter_id: hunterId, target_id: targetId, hunter: name(hunterId), target: name(targetId), confidence: confidence || 'sur', source: source || '' };
  }

  // The time of a kill is typed and shown in Paris time, wherever the phone is.
  function localIso(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }, x = L.parisParts(d); return x.y + '-' + p(x.m + 1) + '-' + p(x.d) + 'T' + p(x.hh) + ':' + p(x.mi); }
  function parisInput(v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v); return m ? L.parisDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(v); }

  Object.assign(_, { applyPlan: applyPlan, ensureRound: ensureRound, linkDetails: linkDetails, localIso: localIso, name: name, parisInput: parisInput });
})();

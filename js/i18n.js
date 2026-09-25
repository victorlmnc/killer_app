/* Tiny gettext-style i18n. Source strings are English; the French table maps them.
   A missing translation falls back to the English string, which keeps tests loud. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var LANG_KEY = 'killer.lang';

  var fr = {};
  K.i18n = { tables: { fr: fr }, lang: 'fr' };

  function detect() {
    try { var saved = localStorage.getItem(LANG_KEY); if (saved) return saved; } catch (e) { /* storage unavailable */ }
    return 'fr';
  }
  K.i18n.lang = detect();
  document.documentElement.lang = K.i18n.lang;

  K.setLang = function (lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    location.reload();
  };

  /* t('Hello {name}', {name: 'X'}) */
  K.t = function (key, params) {
    var table = K.i18n.tables[K.i18n.lang], s = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] == null ? m : String(params[k]); });
    return s;
  };
  /* Plural helper: n(count, 'player', 'players') */
  K.n = function (count, one, many) { return K.t(count === 1 ? one : many, { n: count }); };
  K.i18n.register = function (lang, entries) { var t = K.i18n.tables[lang] = K.i18n.tables[lang] || {}; Object.keys(entries).forEach(function (k) { t[k] = entries[k]; }); };
})();

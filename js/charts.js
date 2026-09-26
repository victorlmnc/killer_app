/* Small SVG charts. pie3d() draws an extruded pie with hover and legend toggles; no dependency. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var SVG = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) { var e = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function hex(c, fallback) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback; }
  function shade(color, f) {   // darker copy of a hex colour for the side walls
    var m = /^#([0-9a-f]{6})$/i.exec(color); if (!m) return color;
    var n = parseInt(m[1], 16), r = (n >> 16) * f | 0, g = ((n >> 8) & 255) * f | 0, b = (n & 255) * f | 0;
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* items: [{ label, value, color }]. Returns a .pie element (chart + legend). */
  K.charts = { pie3d: function (items, opts) {
    opts = opts || {};
    var h = K.ui.h, t = K.t, W = 260, CX = 130, CY = 92, RX = 105, RY = 58, D = 22, hidden = {}, active = null;
    var root = h('div', { class: 'pie' });
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + (CY + RY + D + 12), class: 'pie-svg', role: 'img', 'aria-label': opts.label || '' });
    var caption = h('div', { class: 'pie-caption' });
    var legend = h('ul', { class: 'pie-legend' });
    root.appendChild(h('div', { class: 'pie-chart' }, svg, caption)); root.appendChild(legend);

    function pt(a, dy) { return [CX + RX * Math.cos(a), CY + RY * Math.sin(a) + (dy || 0)]; }
    function arc(a0, a1, dy, back) { var p1 = pt(back ? a0 : a1, dy), big = Math.abs(a1 - a0) > Math.PI ? 1 : 0; return 'A' + RX + ' ' + RY + ' 0 ' + big + ' ' + (back ? 0 : 1) + ' ' + p1[0] + ' ' + p1[1]; }
    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var shown = items.filter(function (it) { return !hidden[it.label] && it.value > 0; });
      var total = shown.reduce(function (s, it) { return s + it.value; }, 0);
      caption.textContent = active && !hidden[active.label] ? active.label + ' · ' + active.value + (total ? ' (' + Math.round(active.value / total * 100) + ' %)' : '') : (opts.caption || t('Total: {n}', { n: total }));
      if (!total) { svg.appendChild(el('ellipse', { cx: CX, cy: CY, rx: RX, ry: RY, class: 'pie-empty' })); return; }
      var a = -Math.PI / 2, slices = [];
      shown.forEach(function (it) {
        var a1 = a + it.value / total * 2 * Math.PI;
        slices.push({ it: it, a0: a, a1: shown.length === 1 ? a + 2 * Math.PI - 1e-4 : a1 }); a = a1;
      });
      // walls of the front half first (back to front), then the tops
      slices.forEach(function (s) {
        var lo = Math.max(s.a0, 0), hi = Math.min(s.a1, Math.PI);
        if (s.a0 < 0 && s.a1 > 0) lo = 0;
        var segs = [];
        if (hi > lo) segs.push([lo, hi]);
        if (s.a1 > 2 * Math.PI) segs.push([0, Math.min(s.a1 - 2 * Math.PI, Math.PI)]);
        segs.forEach(function (sg) {
          var p0 = pt(sg[0]), q1 = pt(sg[1], D);
          svg.appendChild(el('path', { d: 'M' + p0[0] + ' ' + p0[1] + arc(sg[0], sg[1]) + 'L' + q1[0] + ' ' + q1[1] + arc(sg[0], sg[1], D, true) + 'L' + p0[0] + ' ' + p0[1] + 'Z', fill: shade(hex(s.it.color, '#8A93A0'), 0.55), class: 'pie-wall' + (active === s.it ? ' is-active' : '') }));
        });
      });
      slices.forEach(function (s) {
        var mid = (s.a0 + s.a1) / 2, off = active === s.it ? 6 : 0, dx = Math.cos(mid) * off, dy = Math.sin(mid) * off * RY / RX;
        var p0 = pt(s.a0), p1 = pt(s.a1);
        var top = el('path', { d: 'M' + CX + ' ' + CY + 'L' + p0[0] + ' ' + p0[1] + arc(s.a0, s.a1) + 'Z', fill: hex(s.it.color, '#8A93A0'), transform: 'translate(' + dx + ' ' + dy + ')', class: 'pie-top' + (active === s.it ? ' is-active' : ''), tabindex: '0' });
        top.appendChild(el('title')).textContent = s.it.label + ': ' + s.it.value;
        top.addEventListener('mouseenter', function () { active = s.it; draw(); });
        top.addEventListener('focus', function () { active = s.it; draw(); });
        top.addEventListener('mouseleave', function () { active = null; draw(); });
        top.addEventListener('blur', function () { active = null; draw(); });
        svg.appendChild(top);
        if (s.a1 - s.a0 > 0.35) {
          var lp = [CX + RX * 0.6 * Math.cos(mid) + dx, CY + RY * 0.6 * Math.sin(mid) + dy + 4];
          var label = el('text', { x: lp[0], y: lp[1], class: 'pie-label', 'text-anchor': 'middle' }); label.textContent = Math.round(s.it.value / total * 100) + ' %'; svg.appendChild(label);
        }
      });
    }
    function drawLegend() {
      while (legend.firstChild) legend.removeChild(legend.firstChild);
      items.forEach(function (it) {
        legend.appendChild(h('li', {}, h('button', { type: 'button', class: 'pie-key' + (hidden[it.label] ? ' is-off' : ''), 'aria-pressed': String(!hidden[it.label]),
          onclick: function () { hidden[it.label] = !hidden[it.label]; drawLegend(); draw(); },
          onmouseenter: function () { active = it; draw(); }, onmouseleave: function () { active = null; draw(); } },
          h('span', { class: 'pie-swatch', style: { background: hex(it.color, '#8A93A0') } }), h('span', { class: 'pie-key-label' }, it.label), h('span', { class: 'muted' }, String(it.value)))));
      });
    }
    drawLegend(); draw();
    return root;
  } };
})();

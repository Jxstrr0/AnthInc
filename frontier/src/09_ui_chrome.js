// FR.ui base (ported from Mogul ui/chrome.js + ui/icons.js + the sheet/toast/LED parts of ui/hud.js). Reader: reads
// FR.state, listens on the bus, changes the game only through FR.cmd.*.
//   FR.icons            one 24x24 grid, 2px round strokes, no fills, drawn in currentColor.
//                       JS: FR.icons.close() or FR.icons.svg('close', { size: 20, cls: 'x', label: 'Close' }) -> '<svg ...>'
//                       static HTML: <i data-icon="close"></i> (swapped for the svg once at load)
//                       CSS: mask-image: var(--icon-close) (for elements whose text JS overwrites)
//   FR.ui.icon(name[, opts])  the same svg string (the contract name)
//   FR.ui.sheet(html|null, id)  the bottom sheet; same id again keeps the scroll position (panels re-render in place)
//   FR.ui.toast(text[, ms[, tone]])  FR.ui.led(text[, arrive])  FR.ui.show(screenId|null)  FR.ui.hud(on)
//   FR.ui.kmoney(n)  FR.ui.esc(s)  FR.ui.tip(text, what)  FR.ui.hint(key, text)  FR.ui.hideHint()  FR.ui.debug()
// Also the sheet's grab handle (drag it down to close), the sheet's header band (shown once #sheetBody scrolls, so the
// grab and close stay readable) and tap-tips (<details class="tip">: one open at a time, a tap anywhere else closes it).
(function (FR) {
  if (typeof document === 'undefined') return;
  // ---------- icons ----------
  const P = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    play: '<path d="M8 5.5v13L18.5 12z"/>',
    elevator: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9 9.5l3-3 3 3M9 14.5l3 3 3-3"/>',
    settings: '<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="8.5" cy="17" r="2.3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2.9-1.2 1.6v.4M12 16.9v.1"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.7 5.3 1.4 5.3 4.2 0 1.2-1.1 2-2.7 2-1.2 0-2.2-.5-2.8-1.4M12 6.3V8M12 16.1v1.6"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M15.5 5.1a3 3 0 0 1 0 5.8M17.2 14.6c1.8.6 2.9 2.2 3.3 4.9"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    chart: '<path d="M4 20.5h16M6.5 17v-6M12 17V5.5M17.5 17v-8.5"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    trend: '<path d="M3.5 16.5l5.5-5.5 4 4 7.5-7.5M15 7.5h5.5V13"/>',
    alert: '<path d="M10.3 4.6L2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13.5h9l1-13.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    spark: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2L18 18M6 18l2.8-2.8M15.2 8.8L18 6"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11.5h1.5M13.5 11.5H15M10.5 21v-4h3v4"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.5 4.5 0 0 1 0 6M18.2 6.3a8.2 8.2 0 0 1 0 11.4"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/>',
    heart: '<path d="M12 20s-7.5-4.4-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z"/>',
    menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
    // ---- Frontier: the three skills ----
    coding: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
    reasoning: '<circle cx="6" cy="6.5" r="2.3"/><circle cx="18" cy="6.5" r="2.3"/><circle cx="12" cy="18" r="2.3"/><path d="M8.3 6.5h7.4M7.1 8.6l3.8 7.3M16.9 8.6l-3.8 7.3"/>',
    agents: '<rect x="4.5" y="8" width="15" height="11.5" rx="3"/><path d="M12 4.5V8M9.5 13v.1M14.5 13v.1M9.5 16.3h5M2.5 12.5v2.5M21.5 12.5v2.5"/><circle cx="12" cy="3.8" r=".9"/>',
    // ---- the departments and their floors ----
    compute: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".6"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
    safety: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.6"/>',
    research: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.2 18a1.8 1.8 0 0 0 1.6 2.6h10.4a1.8 1.8 0 0 0 1.6-2.6l-5.3-9.3V3.5M7.4 14.5h9.2"/>',
    training: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
    serving: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M7.5 7.5h.1M7.5 16.5h.1M11 7.5h5.5M11 16.5h5.5"/>',
    boardroom: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17M10.5 12.5V14h3v-1.5"/>',
    lobby: '<path d="M3.5 20.5h17M5.5 20.5V9l6.5-5 6.5 5v11.5M10 20.5v-6h4v6"/>',
    project: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12v.1"/>',
    // ---- the market, money and the record ----
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    rival: '<path d="M5.5 21V4M5.5 4.5h11l-2 3.8 2 3.7h-11"/>',
    record: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4.5M16 6h3a3 3 0 0 1-3 4.5M12 13v4M8.5 20.5h7M10 17h4"/>',
    news: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 9h5v4H7zM15 9h2.5M15 12.5h2.5M7 16h10.5"/>',
    memo: '<path d="M6.5 3.5h8l3.5 3.5v13.5h-11.5z"/><path d="M14.5 3.5V7H18M9.5 11.5h5M9.5 15h5M9.5 18h3"/>',
    endturn: '<path d="M4.5 12h12M11.5 6.5L17 12l-5.5 5.5M20 5v14"/>',
    incident: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.9 3.3-5.7 3.8-9.9 2.6 1.6 4 3.9 4.2 6.1 1-.7 1.7-1.9 1.9-3.3 1.9 1.9 3.1 4.3 3.1 7.1 0 3.5-2.6 6.1-6.5 6.1z"/>',
    bolt: '<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>',
    hire: '<circle cx="10" cy="8" r="3.3"/><path d="M4 19.5c.7-3.3 3-5.1 6-5.1s5.3 1.8 6 5.1M18.5 8v6M15.5 11h6"/>',
    // ---- save codes ----
    copy: '<rect x="8.5" y="8.5" width="11" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
    import: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
    export: '<path d="M12 15.5V4.5M7 9l5-5 5 5M4.5 19.5h15"/>',
    exit: '<path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9"/>'
  };
  const ALIAS = { trust: 'globe', money: 'coin', cash: 'coin', staff: 'users', headcount: 'users', cluster: 'compute', gpu: 'compute',
    capability: 'trend', warning: 'alert', frontier: 'record', offer: 'coin', deal: 'rival', turn: 'endturn' };
  const HEAD = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  function svg(name, o) {
    o = o || {}; const body = P[name] || P[ALIAS[name]]; if (!body) return '';
    const size = o.size ? ` width="${o.size}" height="${o.size}"` : '';
    const a11y = o.label ? ` role="img" aria-label="${String(o.label).replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
    return `<svg class="ico${o.cls ? ' ' + o.cls : ''}" ${HEAD}${size}${a11y} focusable="false">${body}</svg>`;
  }
  const I = FR.icons = { svg, names: Object.keys(P), alias: ALIAS };
  I.names.forEach(n => { I[n] = (o) => svg(n, o); });
  Object.keys(ALIAS).forEach(n => { if (!I[n]) I[n] = (o) => svg(n, o); });
  // CSS custom properties --icon-<name>: mask images for pseudo-elements (HUD buttons, list chevrons, tap-tips).
  const url = (n) => 'url("data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${HEAD.replace('currentColor', '#000')}>${P[n]}</svg>`) + '")';
  const st = document.createElement('style'); st.id = 'frIcons';
  st.textContent = ':root{' + I.names.map(n => `--icon-${n}:${url(n)}`).join(';') + '}';
  document.head.appendChild(st);
  // Static markup: <i data-icon="name"></i> is replaced by the inline svg (its classes are kept).
  I.hydrate = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => { const html = svg(el.dataset.icon, { cls: el.className }); if (html) el.outerHTML = html; });
  };
  I.hydrate();

  // ---------- FR.ui base ----------
  const U = FR.ui = FR.ui || {};
  U.sheetId = null;
  const $ = (id) => document.getElementById(id);
  U.icon = (name, o) => svg(name, o);
  U.esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sfx = U.sfx = (n) => { try { if (FR.audio && FR.audio.play) FR.audio.play(n); } catch (e) { /* sound never blocks the UI */ } };
  // compact money for chips and tight rows: $950 · $4.2k · $38k, then three significant figures from $1M up so a chip
  // moves visibly week to week: $3.97M · $39.7M · $397M · $1.25B (minus is a real minus sign)
  U.kmoney = (n) => {
    n = Math.round(n || 0); const a = Math.abs(n), t = (x, d) => x.toFixed(d).replace(/\.0+$/, '');
    const sig = (x) => x.toFixed(x >= 99.95 ? 0 : x >= 9.995 ? 1 : 2);
    return (n < 0 ? '−$' : '$') + (a >= 999.5e6 ? sig(a / 1e9) + 'B' : a >= 999.5e3 ? sig(a / 1e6) + 'M'
      : a >= 1e4 ? Math.round(a / 1000) + 'k' : a >= 1000 ? t(a / 1000, 1) + 'k' : a);
  };
  // tap-tip markup: <details class="tip"> (chrome keeps one open at a time)
  U.tip = (text, what) => `<details class="tip"><summary aria-label="What is ${U.esc(what || 'this')}?"></summary><p>${text}</p></details>`;
  U.show = function (screenId) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === screenId)); };
  U.hud = function (on) { const h = $('hud'); if (h) h.classList.toggle('on', !!on); document.body.classList.toggle('in-world', !!on); };
  const inWorld = () => { const h = $('hud'); return !!(FR.state && h && h.classList.contains('on')); };

  let dimDown = false; // a press began on #dim (see bindSheet)
  U.sheet = function (html, id) {
    const sh = $('sheet'), dim = $('dim'); if (!sh || !dim) return;
    if (!dim.classList.contains('on')) dimDown = false;
    const was = sh.classList.contains('on');
    if (!html) {
      sh.classList.remove('on', 'scrolled'); dim.classList.remove('on'); U.sheetId = null;
      if (FR.r) FR.r.paused = !inWorld(); if (was) sfx('close'); FR.emit('ui:sheet', { id: null }); return;
    }
    if (!was) sfx('open');
    $('sheetBody').innerHTML = html; sh.classList.add('on'); dim.classList.add('on'); U.sheetId = id || 'sheet';
    if (FR.r) FR.r.paused = true; FR.emit('ui:sheet', { id: U.sheetId });
  };
  // toast(text, ms, tone): tone 'bad' | 'good' tints the edge. Long lines stay up longer unless ms is given.
  U.toast = function (text, ms, tone) {
    const t = $('toast'); if (!t) return; text = String(text == null ? '' : text);
    t.textContent = text; t.classList.remove('bad', 'good'); if (tone) t.classList.add(tone);
    t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(U._tt); U._tt = setTimeout(() => t.classList.remove('on'), ms || Math.min(6000, Math.max(2200, 1400 + text.length * 40)));
    FR.emit('ui:toast', { text });
  };
  // the ride LED over the elevator fade: led('3') while counting, led('3', true) on arrival (hides after 700 ms)
  U.led = function (txt, arrive) {
    let l = $('ledOverlay');
    if (!l) { l = document.createElement('div'); l.id = 'ledOverlay'; l.className = 'led'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
    l.textContent = txt; l.style.display = 'block'; clearTimeout(U._lt);
    if (arrive) U._lt = setTimeout(() => { l.style.display = 'none'; }, 700);
  };
  // one-line hint shown once per device and key (FR.settings.hints[key]): each floor's first room view (key = floor id)
  // and the first rest on a focus that has a hint (key = 'floor.target', see 08_hq_world.js syncUi)
  U.hint = function (key, text) {
    const cur = FR.r && FR.r.current; if (cur && cur.id === key && cur.hintKey) key = cur.hintKey;
    const st = FR.settings || (FR.settings = {}); const seen = st.hints && typeof st.hints === 'object' ? st.hints : (st.hints = {});
    if (!text || seen[key]) return false;
    seen[key] = 1; if (FR.saveSettings) FR.saveSettings();
    const h = $('hint'); if (!h) return false; h.textContent = text; h.classList.add('on');
    clearTimeout(U._ht); U._ht = setTimeout(() => h.classList.remove('on'), 5000); return true;
  };
  U.hideHint = function () { const h = $('hint'); if (h) h.classList.remove('on'); clearTimeout(U._ht); };

  // ---------- sheet chrome: close, dim, grab-to-close, scrolled header band ----------
  function bindSheet() {
    const close = $('sheetClose'), dim = $('dim'); if (!close || !dim) return;
    close.addEventListener('click', () => U.sheet(null));
    // the dim closes the sheet only for a press that began on it, never for a click left over from the tap that
    // opened the sheet (that tap's pointerdown landed on the canvas, before the dim was shown)
    dim.addEventListener('pointerdown', () => { dimDown = true; });
    dim.addEventListener('click', () => { if (dimDown) U.sheet(null); dimDown = false; });
  }
  function bindGrab() {
    const sh = $('sheet'), grab = $('sheetGrab'); if (!sh || !grab) return;
    let id = null, y0 = 0, t0 = 0, dy = 0;
    grab.addEventListener('pointerdown', e => { id = e.pointerId; y0 = e.clientY; t0 = performance.now(); dy = 0; try { grab.setPointerCapture(id); } catch (err) { /* old engines */ } sh.style.transition = 'none'; });
    grab.addEventListener('pointermove', e => { if (e.pointerId !== id) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = dy ? `translateY(${dy}px)` : ''; });
    const end = e => {
      if (e.pointerId !== id) return; id = null; sh.style.transition = ''; sh.style.transform = '';
      const flick = dy > 24 && dy / Math.max(1, performance.now() - t0) > 0.6;
      if (dy > 90 || flick) U.sheet(null);
    };
    grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  }
  function bindTips() {
    const closeAll = (keep) => document.querySelectorAll('details.tip[open]').forEach(d => { if (d !== keep) d.open = false; });
    document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details.tip') && d.open) closeAll(d); }, true);
    document.addEventListener('pointerdown', e => { if (!(e.target.closest && e.target.closest('details.tip'))) closeAll(null); }, true);
    FR.on('ui:sheet', () => closeAll(null));
  }
  function bindScroll() {
    const sh = $('sheet'), body = $('sheetBody'); if (!sh || !body) return;
    const check = () => sh.classList.toggle('scrolled', body.scrollTop > 24);
    body.addEventListener('scroll', check, { passive: true });
    // a different sheet starts at the top; the same id re-rendered in place keeps its scroll (panels refresh after
    // state:changed). New content can arrive at the same scrollTop (no scroll event), so re-check after every change.
    let last = null;
    FR.on('ui:sheet', d => { const id = d && d.id; if (id !== last) { body.scrollTop = 0; last = id; } requestAnimationFrame(check); });
  }
  function bind() { bindSheet(); bindGrab(); bindScroll(); bindTips(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  U.debug = () => ({ sheet: U.sheetId, hud: !!($('hud') && $('hud').classList.contains('on')), screen: (document.querySelector('.screen.on') || {}).id || null,
    toast: !!($('toast') && $('toast').classList.contains('on')) ? $('toast').textContent : null, icons: I.names.length });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

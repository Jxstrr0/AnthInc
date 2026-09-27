// FR namespace, event bus, seeded RNG, formatting, save slots and save codes. Works in node (no window) and browser.
(function (root) {
  const FR = root.FR || (root.FR = {});
  FR.VERSION = (typeof window !== 'undefined' && window.FR_VERSION) || FR.VERSION || '0.0.0.0';

  // ---- bus ----
  const listeners = {};
  FR.on = function (ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); return () => FR.off(ev, fn); };
  FR.off = function (ev, fn) { const l = listeners[ev]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  FR.emit = function (ev, data) { const l = listeners[ev]; if (l) for (let i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.error('bus handler error', ev, e); } } };
  FR.busDebug = () => Object.fromEntries(Object.entries(listeners).map(([k, v]) => [k, v.length]));

  // ---- seeded RNG (mulberry32). The sim keeps its position in state.rngState so a turn is reproducible from a save. ----
  FR.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const r = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    r.range = (lo, hi) => lo + r() * (hi - lo);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.normal = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    r.state = () => a >>> 0;
    return r;
  };
  FR.hash = function (str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---- helpers ----
  FR.clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  FR.round = (v, d) => { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; };
  FR.clone = (o) => JSON.parse(JSON.stringify(o));
  // $1,234 / $12.3k / $4.5M / $1.20B. Board-memo money: never more than 3 significant figures past the unit.
  FR.fmtMoney = function (n) {
    const s = n < 0 ? '-$' : '$', a = Math.abs(n);
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + 'k';
    return s + Math.round(a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  FR.fmtPct = (f, d) => (f * 100).toFixed(d || 0) + '%';
  FR.SKILLS = ['coding', 'reasoning', 'agents'];
  FR.SKILL_NAME = { coding: 'Coding', reasoning: 'Reasoning', agents: 'Agents' };
  FR.ALLOCS = ['training', 'serving', 'safety', 'research'];
  FR.ALLOC_NAME = { training: 'Training', serving: 'Serving', safety: 'Safety', research: 'Research' };
  FR.year = (turn) => Math.floor((turn - 1) / 52) + 1;
  FR.weekOfYear = (turn) => ((turn - 1) % 52) + 1;
  FR.dateLabel = (turn) => 'Year ' + FR.year(turn) + ', Week ' + FR.weekOfYear(turn);

  // ---- save slots (3 careers) and save codes. Storage is injectable for node tests. ----
  const SLOTS = 3, KEY = (slot) => 'frontier.slot.' + slot;
  let store = null;
  const save = FR.save = { SLOTS };
  save.useStore = function (s) { store = s; };
  function st() { if (store) return store; try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; } }
  save.migrate = function (d) {
    // future migrations keyed on d.version; the V0.1 shape is the baseline
    if (FR.sim && FR.sim.migrate) FR.sim.migrate(d);
    d.version = FR.VERSION;
    return d;
  };
  save.write = function (slot, state) {
    const fail = (reason) => { FR.emit('game:save:failed', { slot, reason }); return false; };
    const s = st(); if (!s) return fail('No storage available');
    const data = Object.assign({}, state, { slot, savedAt: Date.now(), version: FR.VERSION });
    try { s.setItem(KEY(slot), JSON.stringify(data)); FR.emit('game:saved', { slot }); return true; }
    catch (e) {
      try { s.setItem(KEY(slot), JSON.stringify(Object.assign(data, { history: [], news: [] }))); FR.emit('game:saved', { slot, slim: true }); return true; }
      catch (e2) { return fail((e2 && e2.name) || 'Storage refused the save'); }
    }
  };
  save.read = function (slot) {
    const s = st(); if (!s) return null;
    try { const raw = s.getItem(KEY(slot)); if (!raw) return null; return save.migrate(JSON.parse(raw)); } catch (e) { return null; }
  };
  save.clear = function (slot) { const s = st(); if (s) try { s.removeItem(KEY(slot)); } catch (e) { /* ignore */ } };
  // what the slot picker shows, without loading the career
  save.info = function (slot) {
    const d = save.read(slot); if (!d) return null;
    return { lab: d.lab && d.lab.name, turn: d.turn, cash: d.money && d.money.cash, status: d.status, savedAt: d.savedAt };
  };
  function checksum(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h.toString(36); }
  function b64(s) { return typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); }
  function unb64(s) { return typeof atob !== 'undefined' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'); }
  // FR1.<checksum>.<base64 json>. History and news are dropped to keep codes short; the sim rebuilds nothing from them.
  save.exportCode = function (state) {
    const j = JSON.stringify(Object.assign({}, state, { version: FR.VERSION, history: [], news: (state.news || []).slice(-6) }));
    return 'FR1.' + checksum(j) + '.' + b64(j);
  };
  save.importCode = function (code) {
    try {
      const parts = String(code).trim().split('.');
      if (parts.length !== 3 || parts[0] !== 'FR1') return null;
      const j = unb64(parts[2]); if (checksum(j) !== parts[1]) return null;
      return save.migrate(JSON.parse(j));
    } catch (e) { return null; }
  };

  if (typeof module !== 'undefined') module.exports = FR;
})(typeof window !== 'undefined' ? window : globalThis);

// Floor panels (bottom sheet) and the weekly memo sheet (UI-B; ported from Mogul ui/panel_label.js + ui/panel_reality.js,
// the memo from the recap in ui/week.js). A floor's tap targets open its panel; every control changes the game only
// through FR.cmd.do({type, ...}) (plan/contracts.md §4) and the panel re-renders in place, keeping its scroll.
// Look: 00_shell.html (.pl- panel parts, .wk- memo lines, shared components) plus the few .fp- rules injected below
// (linked sliders, skill rows, the memo's delta tables). Straight board-memo copy: numbers first, no exclamation marks.
//   FR.ui.panel(hotspotId)   'lobby.news' 'serving.wall' 'training.board' 'safety.log' 'research.offers' 'proj2.board'
//                            'boardroom.team' ...; a floor id alone opens its first tab; 'elevator' opens the floor list
//   FR.ui.memo()             the weekly memo (sheet id 'memo'): What changed, Flagged, Due, the wire, one next step
//   FR.ui.panels.refresh()   re-render the open panel or memo in place (runs on 'state:changed' and 'turn:ended')
//   FR.ui.panels.open(floorId, tab, focus)   FR.ui.panels.link(base, key, v)   FR.ui.panels.debug()
//   FR.ui.pressure(state)    the warning-pressure reading {value, level, label, hue, text, pct} (FR.model.pressureLevel when
//                            present); the Safety panel's gauge and the safety floor's incident-log screen both draw it
// Emits 'ui:panel' {floorId, tab, hotspotId} when a panel opens (not on in-place refreshes).
// Listens: 'state:changed', 'turn:ended', 'game:new', 'game:loaded', 'ui:sheet'.
(function (FR) {
  const U = FR.ui; if (!U || typeof document === 'undefined') return;
  const P = U.panels = { floor: null, tab: null, focus: null, confirm: null, hotspot: null };
  const $ = (id) => document.getElementById(id);
  const S = () => FR.state;
  const esc = (v) => U.esc(v);
  const ico = (n, o) => (U.icon ? U.icon(n, o) : '') || '';
  const sfx = (n) => { if (U.sfx) U.sfx(n); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tryr = (fn, fb) => { try { const v = fn(); return v === undefined || v === null ? fb : v; } catch (e) { return fb; } };
  const SK = () => FR.SKILLS, AL = () => FR.ALLOCS;
  const SN = (k) => (FR.SKILL_NAME && FR.SKILL_NAME[k]) || k;
  const AN = (k) => (FR.ALLOC_NAME && FR.ALLOC_NAME[k]) || k;
  // ---------- numbers: money through FR.ui.kmoney (three significant figures), everything in .num (mono, tabular) ----------
  const kmoney = (n) => U.kmoney(n);
  const smoney = (n) => (n < 0 ? '−' : '+') + U.kmoney(Math.abs(n || 0));      // +$12k / −$4.2M
  const n1 = (v) => (Math.round((+v || 0) * 10) / 10).toFixed(1);
  const trim1 = (v) => { const r = Math.round((+v || 0) * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); };
  const sg1 = (v) => (v < 0 ? '−' : '+') + n1(Math.abs(v));
  const pct = (f) => trim1((+f || 0) * 100) + '%';                                // a fraction: 0.225 → 22.5%
  const pctS = (v) => trim1(v) + '%';                                            // already 0..100 (founder stake)
  const pct0 = (f) => Math.round((+f || 0) * 100) + '%';
  const wks = (n) => n + (n === 1 ? ' week' : ' weeks');
  const wkS = (n) => n <= 0 ? 'now' : n + (n === 1 ? ' wk' : ' wks');
  // 'Week 7' this year, 'Year 2, Week 3' otherwise
  // (relative to the memo's own week while the memo renders, so a Week 52 memo never dates next week as "Week 1");
  // non-breaking spaces keep a date on one line
  let refTurn = null;
  const when = (t) => { const s = S(), ref = refTurn != null ? refTurn : s && s.turn;
    return (s && FR.year(t) === FR.year(ref) ? 'Week ' + FR.weekOfYear(t) : FR.dateLabel(t)).replace(/ /g, '\u00a0'); };
  const runwayText = (w) => (w == null || w === Infinity) ? 'cash-positive' : wks(Math.max(0, w));
  const META = (id) => (FR.HQ_FLOOR_META || {})[id] || { n: '?', name: String(id) };
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];

  // ---------- sim reads with fallbacks (code against the contract; a module still being finished must not break a panel) ----------
  const MK = () => Object.assign({ warnGap: 10, warnTurns: 2, incidentGap: 20, incidentBase: 0.08, incidentSlope: 0.02, incidentTrust: 6, critGap: 30,
    critTurns: 4, finalIncidents: 3, incidentWindow: 52, spill: 0.25, drift: 0.2, safeLead: 3 }, (FR.model && FR.model.K) || {});
  const PK = () => Object.assign({ tiers: [0, 100, 500], speedMax: 0.4, failShare: 0.35, overrunFrac: 0.5 }, (FR.projects && FR.projects.K) || {});
  const MoK = () => Object.assign({ hireFee: 20000, wage: 5000, hireTurns: 4, severanceWeeks: 4, minHead: 2, maxHead: 1000, maxHire: 20, layoffTrustPer: 0.1,
    layoffTrust: [0.5, 3], reofferTurns: 13, lockTurns: 52, demandTrustExp: 0.5 }, (FR.money && FR.money.K) || {});
  const CK = () => Object.assign({ maxRent: 500, basePrice: 2000, power: 400, retireTurns: 208, decayPerYear: 0.08, quarter: 13 }, (FR.compute && FR.compute.K) || {});
  const MaK = () => Object.assign({ trustMid: 50, trustRevert: 0.05, incTrust: [2, 4], marks: [30, 45, 60, 75, 90], RIVALS: {} }, (FR.market && FR.market.K) || {});
  const avgCap = (s) => tryr(() => FR.sim.avgCap(s), 0), avgSafe = (s) => tryr(() => FR.sim.avgSafe(s), 0);
  const gapOf = (s, k) => Math.max(0, s.model.skills[k].cap - s.model.skills[k].safe);
  const fc = (s) => tryr(() => FR.sim.forecast(s), null);
  // a copy without the long tails: previews clone it, and nothing they compute reads history, news or the last report
  const lite = (s) => Object.assign({}, s, { history: [], news: [], lastReport: null, pendingMemo: [] });
  // one command on a copy of FR.state: {ok, why, state, f (its forecast)}. Never touches FR.state.
  function preview(cmd, s) {
    s = s || S();
    try {
      const r = FR.sim.applyCommands(lite(s), [cmd]), res = (r.results && r.results[0]) || { ok: false, why: '' };
      return { ok: !!res.ok, why: res.why || '', state: r.state, f: res.ok ? fc(r.state) : null };
    } catch (e) { return { ok: false, why: 'The forecast could not be computed', state: null, f: null }; }
  }
  function outlook(s, k) {
    const o = tryr(() => FR.model.outlook(s, k), null); if (o) return o;
    const K = MK(), g = gapOf(s, k);
    return { level: g > K.critGap ? 'critical' : g > K.incidentGap ? 'warning' : g > (K.watchGap || 5) ? 'watch' : 'ok', gap: g, text: '', turnsToFinal: null };
  }
  const LEVEL = { ok: 'OK', watch: 'Watch', warning: 'Warning', critical: 'Critical' };
  // the gap badge's colour by outlook level; the look: warn above 10, bad above 20
  function gapHue(o) { const K = MK(); return o.level === 'critical' ? 'bad' : o.level === 'warning' ? (o.gap > K.incidentGap ? 'bad' : 'warn') : o.level === 'watch' ? 'warn' : 'good'; }
  // whole numbers unless rounding would put the gap on the wrong side of a ladder threshold (same rule as 03_model)
  function gapTxt(g) { const K = MK(); return [K.warnGap, K.incidentGap, K.critGap].some(t => (g > t) !== (Math.round(g) > t)) ? g.toFixed(1) : String(Math.round(g)); }
  const rival = (s, id) => ((s.market && s.market.rivals) || []).find(r => r.id === id) || { id, name: String(id), cap: {}, safe: {}, incidents: 0 };
  const ravg = (r, key) => SK().reduce((t, k) => t + ((r[key] || {})[k] || 0), 0) / SK().length;
  const roundName = (r) => tryr(() => FR.money.K.rounds[r].name, r === 'a' ? 'Series A' : r === 'b' ? 'Series B' : r === 'seed' ? 'Seed round' : String(r));
  const fxOf = (s) => tryr(() => FR.projects.fx(s), { demandMult: 1, priceMult: 1, rentDiscount: 0 });
  const bestSkill = (s) => SK().reduce((b, k) => s.model.skills[k].cap > s.model.skills[b].cap ? k : b, SK()[0]);
  const has = (mod, fn) => !!(FR[mod] && typeof FR[mod][fn] === 'function');
  // the spot market's rent ceiling for the state's year (grows each year); the flat K.maxRent before 04_compute has it
  function maxRent(s) {
    const v = has('compute', 'maxRent') ? tryr(() => +FR.compute.maxRent(s), NaN) : NaN;
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : CK().maxRent;
  }
  // ---------- enterprise accounts (V0.3, 05b_accounts.js). Every read is guarded: before the module lands the Serving
  // panel shows the locked state and revenue stays one number. ----------
  const AK = () => {
    const K = (FR.accounts && FR.accounts.K) || {}, M = Object.assign({ start: 70, top: 80, up: 1, unserved: 3, incident: 25, rival: 10, churn: 30, renew: 60, watch: 45 }, K.mood || {});
    return { unlockCap: K.unlockCap || 20, unlockTrust: K.unlockTrust || 45, maxActive: K.maxActive || 4, maxActiveB: K.maxActiveB || 6, signCost: K.signCost || 150000,
      startDelay: K.signWeeks || 2, renewMood: M.renew, churnMood: M.churn, watchMood: M.watch, mood: M, churnTrust: K.churnTrust || 2 };
  };
  const accOn = () => has('accounts', 'sign');
  const accOf = (s) => (s && s.accounts) || { active: [], offers: [], lost: [], refreshAt: 0, unlocked: false };
  const reservedPF = (s) => has('accounts', 'reservedPF') ? Math.max(0, +tryr(() => FR.accounts.reservedPF(s), 0) || 0) : 0;
  const maxActive = (s) => has('accounts', 'maxActive') ? tryr(() => FR.accounts.maxActive(s), AK().maxActive) : AK().maxActive;
  const backlog = (s) => has('accounts', 'backlog') ? Math.max(0, +tryr(() => FR.accounts.backlog(s), 0) || 0) : 0;
  const unlocked = (s) => { const a = accOf(s); return !!(a.unlocked || (a.active || []).length || (a.offers || []).length); };
  const signCost = (o) => o.signCost != null ? o.signCost : AK().signCost * (o.tier || 1);
  // mood colour: board blue at the renewal mark and above, amber below it, red under the watch line (the sim's memo flag)
  const moodHue = (m) => { const K = AK(); return m >= K.renewMood ? 'cap' : m >= K.watchMood ? 'warn' : 'bad'; };
  // revenue split at `pf` served (default: next week's forecast serving PF): { market, contracts, total, reserved, open, pf }
  function revSplit(s, pf) {
    if (pf == null) { const f = fc(s); pf = f && f.alloc && f.alloc.serving ? f.alloc.serving.pf : 0; }
    const r = has('money', 'revenueSplit') ? tryr(() => FR.money.revenueSplit(s, pf), null) : null;
    if (r && Number.isFinite(+r.total)) return Object.assign({ market: 0, contracts: 0, reserved: 0, open: pf }, r, { pf });
    const tot = tryr(() => FR.money.revenue(s, pf), 0);
    return { market: tot, contracts: 0, total: tot, reserved: 0, open: pf, pf };
  }
  // last week's split: the report's money flow when the sim wrote one, else the fees the book pays now against last week's total
  function revSplitLast(s) {
    const fm = (s.lastReport && s.lastReport.flows && s.lastReport.flows.money) || {}, tot = s.money.revenue || 0;
    let c = s.money.revContracts != null && Number.isFinite(+s.money.revContracts) ? +s.money.revContracts : Number.isFinite(+fm.contracts) ? +fm.contracts : NaN;
    if (!Number.isFinite(c)) c = has('accounts', 'feeRevenue') && s.turn > 1 ? +tryr(() => FR.accounts.feeRevenue(s), 0) || 0 : 0;
    c = clamp(c, 0, tot);
    return { market: tot - c, contracts: c, total: tot };
  }
  U.revSplit = (s, pf) => { s = s || S(); return s && s.money ? revSplit(s, pf) : null; };
  U.revSplitLast = (s) => { s = s || S(); return s && s.money ? revSplitLast(s) : null; };
  U.accounts = { reservedPF: (s) => reservedPF(s || S()), maxActive: (s) => maxActive(s || S()), backlog: (s) => backlog(s || S()), moodHue, unlocked: (s) => unlocked(s || S()) };
  // hires still allowed this week (FR.money.hireRoom; else K.maxHire less the hires already joining in hireTurns weeks)
  function hireRoom(s) {
    const K = MoK(), v = has('money', 'hireRoom') ? tryr(() => +FR.money.hireRoom(s), NaN) : NaN; if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
    return Math.max(0, K.maxHire - (s.staff.hiring || []).reduce((t, h) => t + (h.arrives === s.turn + K.hireTurns ? h.n : 0), 0));
  }
  // the payoff line; with the state, a safety payoff shows what it would add at today's levels
  const describe = (x) => has('projects', 'describe') ? tryr(() => FR.projects.describe(x, S()), '') : '';
  // warning pressure: FR.model.pressureLevel(s) → {value, level, text}; before it lands, the weighted gap sum from
  // FR.model.pressure (or computed here) banded by K.pressureBands (fallback: every gap at 5 / 10 / 20).
  // Returns {value, level, label, hue, text, pct, bands (meter %)} for the gauge. The meter runs to the top band × 4/3,
  // so the bands sit at 25 / 50 / 75%.
  const PHUE = { ok: 'good', watch: 'warn', warning: 'bad', critical: 'bad' };
  const pressW = () => Object.assign({ coding: 1, reasoning: 1, agents: 1.5 }, MK().weights || MK().pressureW || {});
  function pressBands() {
    const b = MK().pressureBands; if (Array.isArray(b) && b.length && b.every(Number.isFinite)) return b.slice();
    const W = pressW(), wsum = SK().reduce((t, k) => t + (+W[k] || 1), 0), K = MK();
    return [wsum * 5, wsum * K.warnGap, wsum * K.incidentGap];
  }
  function pressure(s) {
    const W = pressW(), bands = pressBands(), LV = ['ok', 'watch', 'warning', 'critical'];
    let p = has('model', 'pressureLevel') ? tryr(() => FR.model.pressureLevel(s), null) : null;
    if (!p || !Number.isFinite(+p.value)) {
      const v = has('model', 'pressure') ? tryr(() => +FR.model.pressure(s), NaN) : NaN;
      const value = Number.isFinite(v) ? v : SK().reduce((t, k) => t + (+W[k] || 1) * gapOf(s, k), 0);
      p = { value, level: LV[Math.min(3, bands.filter(b => value > b).length)], text: '' };
    }
    const level = String(p.level || 'ok'), hue = PHUE[level] || 'warn', max = bands[bands.length - 1] * (bands.length + 1) / bands.length;
    // the header already shows the value and the level: drop the text's leading "Pressure 12, watch." when it has one
    const text = String(p.text || '').replace(/^Pressure [\d.,]+, [^.]*\.\s*/, '');
    return { value: +p.value, level, label: LEVEL[level] || level.charAt(0).toUpperCase() + level.slice(1), hue, text,
      pct: clamp(+p.value / max * 100, 0, 100), bands: bands.map(b => Math.round(b / max * 100)) };
  }
  U.pressure = (s) => { s = s || S(); return s && s.model ? pressure(s) : null; };   // the safety floor's log screen reads it too

  // ---------- markup helpers (Mogul's, on data-fp) ----------
  const tip = (text, what) => U.tip ? U.tip(text, what) : '';
  const badge = (txt, hue, icon) => `<span class="badge ${hue || ''}">${icon ? ico(icon) : ''}${txt}</span>`;
  function btn(act, v, label, cls, dis, icon) { return `<button class="btn small ${cls || ''}" data-fp="${act}" data-v="${esc(v == null ? '' : v)}"${dis ? ' disabled' : ''}>${icon ? ico(icon) : ''}<span>${label}</span></button>`; }
  function btn2(act, v, label, sub, cls, dis, icon) { return `<button class="btn two-line ${cls || ''}" data-fp="${act}" data-v="${esc(v == null ? '' : v)}"${dis ? ' disabled' : ''}><span class="btn-t">${icon ? ico(icon) : ''}${label}</span>${sub ? `<span class="btn-sub">${sub}</span>` : ''}</button>`; }
  function empty(icon, title, text, action) { return `<div class="empty pl-empty"><div class="empty-ico">${ico(icon)}</div><h4>${title}</h4><p>${text}</p>${action || ''}</div>`; }
  const intro = (text) => `<p class="pl-intro">${text}</p>`;
  const why = (text, hue) => `<p class="hint ${hue || 'warn'} pl-why">${ico(hue === 'info' ? 'help' : 'alert')}<span>${text}</span></p>`;
  const meter = (v, hue) => `<div class="meter ${hue || ''}" style="--v:${Math.round(clamp(+v || 0, 0, 100))}"><i></i></div>`;
  // divs, not p: a tap-tip (<details>) inside a <p> would close the paragraph early
  const kv = (icon, html) => `<div class="pl-kv">${ico(icon)}<span>${html}</span></div>`;
  const note = (icon, html) => `<div class="pl-note">${ico(icon)}<span>${html}</span></div>`;
  // section heading: icon, label, optional right-hand text, optional focus key (the hotspot scrolls here) and tap-tip
  const sec = (icon, text, right, focus, tp) => `<div class="fp-h"${focus ? ` data-focus="${focus}"` : ''}>${ico(icon)}<span>${text}</span>${tp || ''}${right ? `<em>${right}</em>` : ''}</div>`;
  function stat(label, val, sub, o) {
    o = o || {};
    return `<div class="stat"><small>${o.key ? `<i class="fp-key ${o.key}"></i>` : ''}${label}${o.tip || ''}</small><b class="num${o.cls ? ' ' + o.cls : ''}">${val}</b>${sub ? `<small>${sub}</small>` : ''}${o.meter || ''}</div>`;
  }
  const row = (icon, title, sub, right) => `<div class="pl-row"><span class="pl-row-ico">${ico(icon)}</span><div class="pl-row-t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${right ? `<span class="pl-row-c">${right}</span>` : ''}</div>`;
  const confirmBox = (danger, title, text, noLabel, okAct, okV, okLabel) =>
    `<div class="confirm${danger ? ' danger' : ''} pl-confirm"><h4>${title}</h4><p>${text}</p><div class="actions">${btn('nocf', '', noLabel, 'quiet')}${btn(okAct, okV, okLabel, danger ? 'danger solid' : 'primary')}</div></div>`;
  const banner = (hue, icon, title, text) => `<div class="pl-banner ${hue || ''}">${ico(icon)}<div><b>${title}</b><span>${text}</span></div></div>`;
  function tabBar(tabs, dots) {
    return `<div class="tabs sticky pl-tabs" role="tablist">${tabs.map(([id, n, ic]) => `<button class="tab${P.tab === id ? ' on' : ''}" role="tab" aria-selected="${P.tab === id}" data-fp="tab" data-v="${id}">${ico(ic)}<span>${n}</span>${dots && dots[id] ? '<i class="pl-dot" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>`;
  }
  const head = (floor, lede) => `<h3>${esc(META(floor).name)}</h3><div class="pl-lede">${lede}</div>`;
  const live = (s) => s.status === 'playing';

  const TIPS = {
    sliders: 'The four shares always total 100%. Moving one rescales the other three in proportion. They split the compute left after projects, and the staff.',
    runway: 'Weeks until cash reaches zero at next week’s forecast: revenue in; payroll, operations, compute and project costs out.',
    demand: 'Customer demand in PF a week. It grows with average capability and public trust. Serving more than demand earns nothing.',
    // FR.sim.score: min(stakeMax, round(stakePer × log10(1 + valuation × founderPct / 100 / stakeUnit))), read once at the end
    get stake() {
      const Q = Object.assign({ stakePer: 100, stakeUnit: 1e6, stakeMax: 500 }, tryr(() => FR.sim.K.score, {}));
      const at = (pts) => { const v = Q.stakeUnit * (Math.pow(10, pts / Q.stakePer) - 1), [d, u] = v >= 999.5e6 ? [1e9, 'B'] : [1e6, 'M'], x = v / d;
        return '$' + x.toFixed(x >= 10 ? 0 : 1).replace(/\.0$/, '') + u; };
      return `Your ownership of the lab. Each round sells part of it. The score counts the stake once, at the end of the run: its value then (valuation × your share), compressed so each tenfold rise adds ${Q.stakePer} points (${at(Q.stakePer)} scores ${Q.stakePer}, ${at(2 * Q.stakePer)} scores ${2 * Q.stakePer}), capped at ${Q.stakeMax} points (${at(Q.stakeMax)}). A lab wound up for want of cash scores 0 for the stake.`;
    },
    get pressure() {
      const W = pressW(), b = pressBands(), nm = SK().map(k => `${SN(k)} ×${trim1(+W[k] || 1)}`).join(', ');
      return `The weighted sum of the three gaps (capability minus safety): ${nm}.${MK().weights ? ' The same weights scale each skill’s incident odds and the trust an incident costs.' : ''}`
        + ` Watch above ${trim1(b[0])}, warning above ${trim1(b[1])}, critical above ${trim1(b[2])}${has('model', 'pressureLevel') ? '; one skill’s own outlook can set a higher level' : ''}.`;
    },
    revshare: 'A compute share takes this fraction of all revenue for as long as the deal runs.',
    get gap() {
      const K = MK();
      const heavy = K.weights ? SK().filter(k => (+K.weights[k] || 1) !== 1).map(k => `${SN(k)} ×${trim1(+K.weights[k])}`) : [];
      return `Gap is capability minus safety. Above ${K.warnGap} for ${K.warnTurns} weeks: a warning, no cost. Above ${K.incidentGap}: each week a chance of an incident (${pct0(K.incidentBase)} plus ${pct0(K.incidentSlope)} per point above ${K.incidentGap}) that costs cash and ${K.incidentTrust} points of trust${heavy.length ? `; ${heavy.join(', ')} on both the chance and the trust` : ''}. Above ${K.critGap} for ${K.critTurns} weeks, or a ${ORD[K.finalIncidents - 1] || K.finalIncidents + 'th'} incident on one skill within ${K.incidentWindow} weeks: the final incident, and the lab closes.`;
    },
    get risk() { const K = PK(); return `The chance of trouble at the halfway review. ${pct0(K.failShare)} of trouble is failure: the money spent is gone and there is no payoff. The rest is an overrun: ${pct0(K.overrunFrac)} more weeks and budget.`; },
    get tier() { return `Research points add up. Tier 2 opens at ${PK().tiers[1]} points, tier 3 at ${PK().tiers[2]}. Each tier adds larger projects to the board.`; }
  };

  // ---------- linked sliders: four shares that always total 100 ----------
  // Moving `key` to v rescales the other three in proportion to their shares at drag start (all zero: an even split);
  // the largest remainders take the rounding, so the four integers sum to exactly 100.
  function link(base, key, v) {
    const keys = AL(), others = keys.filter(k => k !== key), out = {};
    v = clamp(Math.round(+v || 0), 0, 100); out[key] = v;
    const rest = 100 - v, tot = others.reduce((t, k) => t + Math.max(0, +base[k] || 0), 0);
    const raw = others.map(k => tot > 0 ? Math.max(0, +base[k] || 0) * rest / tot : rest / others.length);
    let sum = v;
    others.forEach((k, i) => { out[k] = Math.floor(raw[i]); sum += out[k]; });
    const order = others.map((k, i) => [k, raw[i] - Math.floor(raw[i])]).sort((a, b) => b[1] - a[1]);
    for (let i = 0; sum < 100; i++, sum++) out[order[i % order.length][0]]++;
    return out;
  }
  P.link = link;
  const ACOL = { training: 'var(--cap)', serving: 'var(--gold)', safety: 'var(--safe)', research: 'var(--info)' };
  // the one number each slider moves: cap gain on the target, revenue, total safety gain, research points
  function fcNums(s, f) {
    return {
      training: f ? ((f.capGain || {})[s.target] || 0) : 0,
      serving: f ? f.revenue || 0 : 0,
      safety: f ? SK().reduce((t, k) => t + ((f.safeGain || {})[k] || 0), 0) : 0,
      research: tryr(() => FR.projects.researchRate(s), 0)
    };
  }
  function fcText(k, s, v) {
    if (k === 'training') return `${esc(SN(s.target))} capability <b class="num">${sg1(v)}</b> a week`;
    if (k === 'serving') return `Revenue <b class="num">${kmoney(v)}</b> a week`;
    if (k === 'safety') return `Safety <b class="num">${sg1(v)}</b> a week across skills`;
    return `<b class="num">${n1(v)}</b> research points a week`;
  }
  function fcDelta(k, d) {
    if (k === 'serving' ? Math.abs(d) < 500 : Math.abs(d) < 0.05) return '';
    return `<span class="fp-d ${d > 0 ? 'pos' : 'neg'}">${k === 'serving' ? smoney(d) : sg1(d)}</span>`;
  }
  const big = (v) => v >= 100 ? String(Math.round(v)) : trim1(v);
  const unitText = (a) => `${(a && a.pf) >= 100 ? big(a.pf) : n1((a && a.pf) || 0)} PF · ${big((a && a.staff) || 0)} staff`;
  function footText(f, f0) {
    if (!f) return '';
    const pr = (f.alloc && f.alloc.projects) || { pf: 0, need: 0 }, dn = f0 && f !== f0 ? f.net - f0.net : 0;
    return `Capacity <b class="num">${n1(f.capacity)} PF</b>${pr.need > 0 ? `, projects hold <b class="num">${n1(pr.pf)}</b>` : ''} · net <b class="num ${f.net < 0 ? 'neg' : 'pos'}">${smoney(f.net)}</b> a week`
      + (Math.abs(dn) >= 500 ? `<span class="fp-d ${dn > 0 ? 'pos' : 'neg'}">${smoney(dn)}</span>` : '') + ` · runway <b class="num">${runwayText(f.runway)}</b>`;
  }
  function sliders(own, s, f) {
    const nums = fcNums(s, f), al = (f && f.alloc) || {};
    P.base = { nums, f };
    const order = [own].concat(AL().filter(k => k !== own));
    const rows = order.map(k => {
      const v = s.sliders[k];
      return `<div class="fp-sl${k === own ? ' own' : ''}"><div class="fp-sl-h"><span class="fp-sl-n">${ico(k)}<b>${esc(AN(k))}</b></span><span class="fp-sl-u num">${unitText(al[k])}</span><b class="fp-sl-v num">${v}%</b></div>
        <input class="pl-range" type="range" min="0" max="100" step="1" value="${v}" data-fps="${k}" aria-label="${esc(AN(k))} share of compute and staff, percent" style="--p:${v / 100};--rc:${ACOL[k]}">
        <p class="fp-sl-f">${fcText(k, s, nums[k])}</p>${k === 'serving' ? resLine(s, (al.serving || {}).pf) : ''}
        <div class="fp-nudge" role="group" aria-label="Adjust ${esc(AN(k))}">${[-5, -1, 1, 5].map(d => btn('nudge', k + ':' + d, (d > 0 ? '+' : '−') + Math.abs(d), 'quiet', !live(s) || (d < 0 ? v <= 0 : v >= 100))).join('')}</div></div>`;
    }).join('');
    return `<div class="card fp-sliders" id="fpSliders"><div class="fp-cardh"><span class="kicker">Allocation</span>${tip(TIPS.sliders, 'the allocation')}<span class="fp-sum num">Total 100%</span></div>${rows}<p class="fp-sl-foot" data-fpfoot>${footText(f, f)}</p></div>`;
  }
  // the serving readout once accounts reserve PF: "Serving 38 PF · 14 reserved for accounts · 24 open market"
  function resText(s, pf) {
    const need = reservedPF(s); pf = Math.max(0, +pf || 0); if (!(need > 0)) return '';
    const res = Math.min(pf, need), f = (v) => v >= 100 ? String(Math.round(v)) : trim1(v);
    return `Serving <b class="num">${f(pf)} PF</b> · <b class="num">${f(res)}</b> reserved for accounts · <b class="num">${f(Math.max(0, pf - need))}</b> open market`
      + (need > pf + 0.05 ? ` · <span class="neg">${f(need - pf)} PF short of the contracts</span>` : '');
  }
  const resLine = (s, pf) => { const t = resText(s, pf); return t ? `<p class="fp-sl-r" data-fpres>${t}</p>` : ''; };
  let drag = null, raf = 0, SL = null;
  function bindSliders() {
    SL = null; const box = $('fpSliders'); if (!box) return;
    SL = { foot: box.querySelector('[data-fpfoot]'), res: box.querySelector('[data-fpres]') };
    AL().forEach(k => {
      const inp = box.querySelector(`[data-fps="${k}"]`); if (!inp) return; const r = inp.closest('.fp-sl');
      SL[k] = { inp, v: r.querySelector('.fp-sl-v'), u: r.querySelector('.fp-sl-u'), f: r.querySelector('.fp-sl-f') };
    });
  }
  // while dragging: move the other three at once, then one preview forecast per frame (not per input event)
  function dragTo(key, v) {
    const s = S(); if (!s) return;
    if (!drag || drag.key !== key) drag = { key, base: Object.assign({}, s.sliders), vals: null };
    const vals = drag.vals = link(drag.base, key, v);
    if (!SL) return;
    AL().forEach(k => {
      const r = SL[k]; if (!r) return;
      if (k !== key && +r.inp.value !== vals[k]) r.inp.value = vals[k];
      r.inp.style.setProperty('--p', vals[k] / 100); r.v.textContent = vals[k] + '%';
    });
    if (!raf) raf = requestAnimationFrame(livePreview);
  }
  function livePreview() {
    raf = 0; if (!drag || !drag.vals || !SL) return;
    const s = S(), pv = preview(Object.assign({ type: 'sliders' }, drag.vals), s); if (!pv.ok || !pv.f) return;
    const nums = fcNums(pv.state, pv.f), base = P.base || { nums, f: pv.f };
    AL().forEach(k => {
      const r = SL[k]; if (!r) return;
      r.u.textContent = unitText(pv.f.alloc[k]);
      r.f.innerHTML = fcText(k, pv.state, nums[k]) + fcDelta(k, nums[k] - base.nums[k]);
    });
    if (SL.foot) SL.foot.innerHTML = footText(pv.f, base.f);
    if (SL.res) SL.res.innerHTML = resText(pv.state, (pv.f.alloc.serving || {}).pf);
  }
  // on release: one 'sliders' command, then the panel re-renders from the new state
  function commitSliders() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const d = drag, s = S(); drag = null;
    if (!d || !d.vals || !s) return;
    if (AL().every(k => d.vals[k] === s.sliders[k])) { render(true); return; }
    run(Object.assign({ type: 'sliders' }, d.vals), true);
  }

  // ---------- shared pieces ----------
  function skillRow(s, k, f, mode) {
    const sk = s.model.skills[k], o = outlook(s, k), hue = gapHue(o), tgt = mode === 'train' && s.target === k;
    const cg = f ? (f.capGain || {})[k] || 0 : 0, sgn = f ? (f.safeGain || {})[k] || 0 : 0;
    const d = (v) => Math.abs(v) < 0.05 ? '' : sg1(v);
    return `<div class="fp-skill${tgt ? ' on' : ''}">
      <div class="fp-skill-h">${ico(k)}<b>${esc(SN(k))}</b>${tgt ? badge('Target', 'brand') : ''}${badge('Gap ' + gapTxt(o.gap) + (o.level !== 'ok' ? ' · ' + LEVEL[o.level] : ''), hue, hue === 'good' ? '' : 'alert')}</div>
      <div class="fp-bar"><span>Capability</span>${meter(sk.cap, 'cap')}<b>${n1(sk.cap)}</b><em class="tone-cap">${d(cg)}</em></div>
      <div class="fp-bar"><span>Safety</span>${meter(sk.safe, 'safe')}<b>${n1(sk.safe)}</b><em class="${sgn < 0 ? 'tone-warn' : 'tone-safe'}">${d(sgn)}</em></div>
      ${mode === 'safety' && o.text ? `<p class="fp-out ${hue === 'good' ? '' : hue}">${esc(o.text)}</p>` : ''}</div>`;
  }
  function rentBox(s) {
    const c = s.compute, K = CK(), step = 5, disc = fxOf(s).rentDiscount || 0, per = c.rentPrice * (1 - disc);
    const top = maxRent(s), cost = tryr(() => FR.compute.rentCost(s), c.rentPF * per), dead = !live(s);
    const lo = Math.max(0, Math.min(top, c.rentPF - step)), hi = Math.min(top, c.rentPF + step);
    // next year's ceiling (FR.compute.maxRent reads the turn): said only when it rises
    const ny = FR.year(s.turn) + 1, nextTop = has('compute', 'maxRent') ? maxRent(Object.assign({}, s, { turn: (ny - 1) * 52 + 1 })) : top;
    const mkt = c.scarcity > 0 ? ` Chip shortage: the spot price stays high for about ${wks(c.scarcity)}.`
      : ` Spot price ${c.rentPrice > K.basePrice * 1.05 ? 'above' : c.rentPrice < K.basePrice * 0.95 ? 'below' : 'near'} its usual ${kmoney(K.basePrice)}.`;
    const ceil = `The spot market rents at most <b class="num">${top} PF</b> in Year ${FR.year(s.turn)}${nextTop > top ? `, <b class="num">${nextTop} PF</b> from Year ${ny}` : ''}.`;
    // bigger jumps beside the ±5 stepper: ±50 and ±250, each clamped to 0..the ceiling (hidden when they would not move)
    const jumps = [-250, -50, 50, 250].map(d => ({ d, v: clamp(c.rentPF + d, 0, top) })).filter(j => j.v !== c.rentPF);
    const jumpRow = jumps.length && !dead ? `<div class="fp-hire fp-jump">${jumps.map(j => btn('rent', j.v, (j.d < 0 ? '−' : '+') + Math.abs(j.d) + ' PF', 'quiet')).join('')}</div>` : '';
    return `<div class="pl-steps fp-rent"><div class="pl-step"><span><b>Rented</b><small><span class="num">${kmoney(per)}</span> per PF-week${disc ? ` · ${pct0(disc)} off` : ''}</small></span>
      <button class="pl-sb" data-fp="rent" data-v="${lo}"${c.rentPF <= 0 || dead ? ' disabled' : ''} aria-label="Rent ${step} PF less">${ico('minus')}</button>
      <b class="num">${c.rentPF} PF</b>
      <button class="pl-sb" data-fp="rent" data-v="${hi}"${c.rentPF >= top || dead ? ' disabled' : ''} aria-label="Rent ${step} PF more, up to ${top} PF">${ico('plus')}</button></div></div>
      ${jumpRow}<div class="pl-tot"><span>Rent a week</span><b class="num">${kmoney(cost)}</b></div>
      ${c.rentPF >= top && !dead ? why(`Rent is at the ceiling of ${top} PF. Clusters add capacity beyond it.`, 'info') : ''}
      <p class="hint">Steps of ${step} PF, <span class="num">${kmoney(step * per)}</span> a week each; the buttons below move 50 or 250. Changes apply at once and bill at End Turn. ${ceil}${mkt}</p>`;
  }
  // ---------- enterprise accounts: the book (active rows), the offer board (Sign / Decline), the locked state ----------
  // one requirement on an offer: met / unmet against the lab now
  function reqList(s, o) {
    const q = has('accounts', 'qualifies') ? tryr(() => FR.accounts.qualifies(s, o), null) : null, cap = avgCap(s), tr = s.market.trust;
    const worst = SK().reduce((b, k) => gapOf(s, k) > gapOf(s, b) ? k : b, SK()[0]), wg = gapOf(s, worst);
    const out = [];
    if (o.minCap) out.push([cap >= o.minCap, `Average capability ${o.minCap}`, `now ${n1(cap)}`]);
    if (o.minSafe != null) out.push([wg <= o.minSafe + 1e-9, `Every skill’s safety within ${o.minSafe} of capability`, `widest gap ${esc(SN(worst))} ${gapTxt(wg)}`]);
    if (o.minTrust) out.push([tr >= o.minTrust, `Public trust ${o.minTrust}`, `now ${n1(tr)}`]);
    return { ok: q ? !!q.ok : out.every(r => r[0]), why: q && q.why ? String(q.why) : '', rows: out };
  }
  function accRow(s, a) {
    const left = Math.max(0, a.ends - s.turn + 1), pending = a.starts != null && a.starts > s.turn, mood = Math.round(+a.mood || 0), hue = moodHue(mood);
    const short = a.starts != null && a.starts < s.turn && a.served != null && a.served < a.pfPerWeek - 0.05;
    const tag = mood < AK().watchMood ? badge('At risk', 'bad', 'alert') : left <= 8 ? badge(mood >= AK().renewMood ? 'Renews' : 'Ends', mood >= AK().renewMood ? 'good' : 'warn', 'clock') : pending ? badge('Onboarding', 'info', 'clock') : '';
    // name and fee on the first line (the name gets the width), tier and status badges lead the second
    return `<div class="fp-acc"><div class="fp-acc-h"><b>${esc(a.name)}</b><span class="num fp-acc-fee">${kmoney(a.feePerWeek)}<small>/wk</small></span></div>
      <p class="fp-acc-s">${badge('Tier ' + a.tier, 'brand')}${tag}<span>${esc(a.sector || '')} · <span class="num">${trim1(a.pfPerWeek)} PF</span> · <span class="num">${wks(left)}</span> left${pending ? ` · fee from ${esc(when(a.starts))}` : ''}</span></p>
      <div class="fp-acc-m"><span>Mood</span><div class="meter ${hue}" style="--v:${clamp(mood, 0, 100)}" role="img" aria-label="Mood ${mood} of 100"><i></i></div><b class="num tone-${hue === 'cap' ? 'cap' : hue}">${mood}</b></div>
      ${short ? `<p class="fp-acc-w">${ico('alert')}<span>Served ${n1(a.served)} of ${trim1(a.pfPerWeek)} PF last week. Each short week costs ${AK().mood.unserved} mood.</span></p>` : ''}</div>`;
  }
  function accOffer(s, o, room) {
    const rq = reqList(s, o), cost = signCost(o), dead = !live(s), start = s.turn + AK().startDelay;
    const dis = dead ? 'The run is over.' : room <= 0 ? `The book is full: ${maxActive(s)} accounts at most${(s.money.roundsDone || []).indexOf('b') < 0 ? `, ${AK().maxActiveB} once the Series B closes` : ''}.`
      : !rq.ok ? (rq.why ? esc(rq.why.replace(/\.$/, '')) + '.' : 'The lab does not meet every requirement yet.')
        : s.money.cash < cost ? `Signing costs ${kmoney(cost)}; cash is ${kmoney(s.money.cash)}.` : '';
    const need = reservedPF(s) + o.pfPerWeek, sv = revSplit(s).pf;
    const left = o.expires != null ? o.expires - s.turn + 1 : null;
    const actions = P.confirm === 'accNo:' + o.id
      ? confirmBox(false, `Decline ${esc(o.name)}?`, 'Declining costs nothing. The offer leaves the board and this buyer does not return this run.', 'Keep the offer', 'accNoOk', o.id, 'Decline')
      : `<div class="card-actions">${btn('accNo', o.id, 'Decline', 'quiet', dead)}${btn2('sign', o.id, 'Sign', `${kmoney(cost)} now`, 'primary', !!dis, 'check')}</div>`;
    return `<div class="card fp-aoff${rq.ok ? '' : ' ghost'}" data-acc="${esc(o.id)}">
      <div class="fp-cardk"><span class="pl-kind">${esc(o.sector || 'Enterprise')}</span>${badge('Tier ' + o.tier, 'brand')}${left != null ? badge(left <= 1 ? 'Last week' : wks(left) + ' left', left <= 2 ? 'warn' : '', 'clock') : ''}</div>
      <div class="card-head"><b class="card-title">${esc(o.name)}</b></div>
      <div class="stats fp-st4">${stat('Fee', kmoney(o.feePerWeek), 'a week')}${stat('Reserved', trim1(o.pfPerWeek) + ' PF', 'a week')}${stat('Term', trim1(o.turns / 52) + ' yr', o.turns + ' wks')}${stat('Signing', kmoney(cost), 'once')}</div>
      <ul class="fp-req">${rq.rows.map(r => `<li class="${r[0] ? 'ok' : 'no'}">${ico(r[0] ? 'check' : 'close')}<span>${r[1]}</span><em class="num">${r[2]}</em></li>`).join('')}</ul>
      ${kv('clock', `Fee from <b>${esc(when(start))}</b>, ${wks(AK().startDelay)} after signing. <b class="num">${kmoney(o.feePerWeek * o.turns)}</b> over the term.`)}
      ${!dis && need > sv + 0.05 ? why(`Serving is ${n1(sv)} PF; the contracts would reserve ${n1(need)} PF. Raise the serving share or rent more, or each account left short loses ${AK().mood.unserved} mood a week.`) : ''}
      ${actions}${dis && P.confirm !== 'accNo:' + o.id ? why(dis, rq.ok && room > 0 ? 'warn' : 'info') : ''}</div>`;
  }
  function accountsBlock(s) {
    const a = accOf(s), K = AK(), act = a.active || [], offers = a.offers || [], mx = maxActive(s), room = mx - act.length;
    let out = sec('building', 'Accounts', unlocked(s) ? `${act.length} of ${mx} · new board ${esc(when(a.refreshAt || s.turn))}` : 'locked', 'accounts');
    if (!unlocked(s)) {
      const cap = avgCap(s), tr = s.market.trust;
      return out + `<div class="card fp-alock"><div class="card-head">${ico('lock')}<b class="card-title">Enterprise accounts</b>${badge('Locked', '', 'lock')}</div>
        <p class="card-meta">Buyers sign multi-year contracts once the lab averages capability ${K.unlockCap} and public trust is ${K.unlockTrust} or more. Each account reserves serving PF and pays a fixed weekly fee on top of open-market revenue.</p>
        <div class="pl-mrow-l"><span>Average capability</span><span class="num"><b>${n1(cap)}</b> of ${K.unlockCap}</span></div>${meter(cap / K.unlockCap * 100, cap >= K.unlockCap ? 'good' : 'cap')}
        <div class="pl-mrow-l"><span>Public trust</span><span class="num"><b>${n1(tr)}</b> of ${K.unlockTrust}</span></div>${meter(tr / K.unlockTrust * 100, tr >= K.unlockTrust ? 'good' : 'gold')}
        ${!accOn() ? note('info', 'Accounts are not in this build.') : ''}</div>`;
    }
    if (act.length) {
      const fees = act.reduce((t, x) => t + (x.starts != null && x.starts > s.turn ? 0 : +x.feePerWeek || 0), 0);
      out += `<div class="stats">${stat('Contracted', kmoney(fees), 'a week')}${stat('Reserved', trim1(reservedPF(s)) + ' PF', 'from serving')}${stat('Backlog', kmoney(backlog(s)), 'fees to come')}</div>`;
      out += `<div class="card fp-accs">${act.map(x => accRow(s, x)).join('')}</div>`;
    } else out += `<p class="hint">No accounts signed. Signing reserves serving PF for the contract and pays its fee each week from the third week.</p>`;
    const M = K.mood;
    out += `<p class="hint">Mood falls ${M.incident} on an incident at the lab, ${M.rival} on a rival’s and ${M.unserved} for each week its PF goes unserved; it rises ${M.up} a week toward ${M.top} while every gap stays within ${tryr(() => FR.sim.K.safeMargin, 5)} and the PF is served. Below ${M.churn} the account leaves the next week, for good, and public trust falls ${K.churnTrust}. At term end an account at ${M.renew} or more renews one tier up.</p>`;
    const lost = (a.lost || []).filter(l => l && l.turn >= s.turn - 26).slice(-3).reverse();
    if (lost.length) out += lost.map(l => row(l.why === 'churn' ? 'alert' : 'clock', esc(l.name), `${l.why === 'churn' ? 'Ended the contract' : l.why === 'expired' ? 'Contract ran out' : 'Dropped'} · ${esc(when(l.turn))}`, l.why === 'churn' ? badge('Churned', 'bad') : '')).join('');
    out += sec('tag', 'Offer board', offers.length ? `${offers.length} open` : '', 'accoffers');
    if (!offers.length) return out + empty('clock', 'No offers on the board', `New buyers arrive ${esc(when(a.refreshAt || s.turn + 1))}.`, '');
    if (room <= 0) out += why(`The book is full: ${mx} accounts at most${(s.money.roundsDone || []).indexOf('b') < 0 ? `. The Series B raises it to ${AK().maxActiveB}` : ''}. An account frees its place when its term ends.`, 'info');
    return out + offers.map(o => accOffer(s, o, room)).join('');
  }
  const KIND = { training: ['Training', 'training'], safety: ['Safety', 'safety'], research: ['Research', 'research'], product: ['Product', 'serving'], business: ['Business', 'coin'], compute: ['Compute', 'compute'] };
  const kindOf = (k) => KIND[k] || [String(k || 'Project').charAt(0).toUpperCase() + String(k || 'project').slice(1), 'project'];
  const skillOf = (x) => x.skill === 'all' ? 'All skills' : x.skill ? SN(x.skill) : '';
  // weeks of cash when a project spends `per` a week for `turns` weeks on top of a weekly net `net` (Infinity: never out)
  function runwayWith(cash, net, per, turns) {
    const during = net - per;
    if (during < 0 && cash + turns * during < 0) return Math.max(0, Math.floor(cash / -during));
    if (net >= 0) return Infinity;
    return turns + Math.floor((cash + turns * during) / -net);
  }
  function offerCard(s, o, f0, free) {
    const k = kindOf(o.kind), locked = o.tier > s.research.tier, risk = Math.round((o.risk || 0) * 100);
    let dis = '', pv = null;
    if (!live(s)) dis = 'The run is over.';
    else if (locked) { const nt = tryr(() => FR.projects.nextTier(s), null); dis = `Needs research tier ${o.tier}. The lab is at tier ${s.research.tier}${nt && nt.tier === o.tier ? `, ${Math.ceil(nt.left)} points to go` : ''}.`; }
    else if (free <= 0) dis = `All ${s.projects.slots} project slots are in use. One frees when a project finishes or is cancelled.`;
    else { pv = preview({ type: 'greenlight', offerId: o.id }, s); if (!pv.ok) dis = esc(String(pv.why || 'Not available').replace(/\.$/, '')) + '.'; }
    let effect = '';
    if (pv && pv.ok && pv.f && f0) {
      const pr = pv.f.alloc.projects || { need: 0, pf: 0 }, cap = pv.f.capacity;
      // the project costs its budget once, spread over its weeks: runway after = (cash − cost) over next week's net without it
      const without = pv.f.net + tryr(() => FR.money.burnParts(pv.state).projects - FR.money.burnParts(s).projects, 0);
      const after = runwayWith(s.money.cash, without, o.cost / Math.max(1, o.turns), Math.max(1, o.turns));
      effect = kv('coin', `Adds <b class="num">${kmoney(o.cost / Math.max(1, o.turns))}</b> a week to burn for ${wks(o.turns)}, <b class="num">${kmoney(o.cost)}</b> in all. Runway ${runwayText(f0.runway)} → <b class="num">${runwayText(after)}</b>.`)
        + (pr.need > cap + 0.01 ? why(`Projects would need ${n1(pr.need)} PF of ${n1(cap)} PF capacity. Project work slows to ${pct0(cap / pr.need)}.`)
          : o.pfPerTurn > 0 ? kv('compute', `Holds <b class="num">${o.pfPerTurn} PF</b> a week. The sliders share <b class="num">${n1(Math.max(0, cap - pr.need))} PF</b>.`) : '');
    }
    return `<div class="card fp-offer${locked ? ' ghost' : ''}">
      <div class="fp-cardk"><span class="pl-kind">${esc(k[0])}</span>${badge('Tier ' + o.tier, locked ? '' : 'info', locked ? 'lock' : '')}</div>
      <div class="card-head"><b class="card-title">${esc(o.name)}</b></div>
      <p class="card-meta">${skillOf(o) ? esc(skillOf(o)) + ' · ' : ''}${esc(o.blurb || '')}</p>
      <div class="stats fp-st4">${stat('Weeks', o.turns)}${stat('Cost', kmoney(o.cost))}${stat('Compute', o.pfPerTurn + ' PF')}${stat('Risk', risk + '%', '', { tip: tip(TIPS.risk, 'risk') })}</div>
      ${kv('trend', esc(describe(o)))}${effect}
      ${btn2('gl', o.id, 'Greenlight', `about ${kmoney(o.cost / Math.max(1, o.turns))} a week for ${wks(o.turns)}`, '', !!dis, 'check')}${dis ? why(dis, locked ? 'info' : 'warn') : ''}</div>`;
  }
  function offerBoard(s) {
    const pj = s.projects, used = pj.active.length, free = pj.slots - used, nextF = 'proj' + (used + 1);
    let out = sec('research', 'Offer board', `${used} of ${pj.slots} slots · new board ${when(pj.refreshAt)}`, 'offers');
    if (!pj.offers.length) return out + empty('clock', 'No offers on the board', `The board is empty until ${when(pj.refreshAt)}, when a fresh set arrives.`, '');
    out += free <= 0 ? why(`All ${pj.slots} project slots are in use. A slot frees when a project finishes or is cancelled.`, 'info')
      : note('building', `A greenlit project takes the next free project floor: <b>${esc(META(nextF).name)}</b> (floor ${esc(META(nextF).n)}).`);
    const f0 = fc(s);
    return out + pj.offers.slice().sort((a, b) => (a.tier > s.research.tier) - (b.tier > s.research.tier)).map(o => offerCard(s, o, f0, free)).join('');
  }
  function newsItem(n) {
    const k = { rival: ['Rival', 'info'], you: ['Your lab', 'brand'], market: ['Market', ''], incident: ['Incident', 'bad'], record: ['Record', 'gold'] }[n.kind] || ['Market', ''];
    return `<li class="${esc(n.kind || 'market')}"><div class="fp-news-h">${badge(k[0], k[1])}<span class="num">${n.turn ? esc(when(n.turn)) : ''}</span></div><p>${esc(n.text)}</p></li>`;
  }
  function recordList(s) {
    const marks = MaK().marks, firsts = (s.market && s.market.firsts) || [], you = avgCap(s);
    const b = tryr(() => FR.market.best(s), { rivalId: null, avgCap: 0 }), bn = b.rivalId ? rival(s, b.rivalId).name : 'Best rival';
    return `<div class="pl-chart fp-record">${marks.map(mk => {
      const f = firsts.find(x => x.mark === mk);
      if (f) {
        const mine = f.by === 'player';
        return `<div class="pl-cr${mine ? ' you' : ''}"><span class="pl-rk num">${mk}</span><span class="pl-ct"><b>${esc(mine ? s.lab.name : rival(s, f.by).name)}</b><small>First to average ${mk} · ${esc(FR.dateLabel(f.turn))}</small></span><span class="pl-cs">${badge(mine ? 'Set' : 'Lost', mine ? 'good' : 'bad', mine ? 'check' : 'rival')}</span></div>`;
      }
      return `<div class="pl-cr fp-open"><span class="pl-rk num">${mk}</span><span class="pl-ct"><b>Open</b><small>You ${n1(you)} · ${esc(bn)} ${n1(b.avgCap)}</small></span><span class="pl-cs"><b class="num">${n1(Math.max(0, mk - you))}</b><small>you need</small></span></div>`;
    }).join('')}</div>`;
  }
  // a range-scaled bar strip (trust over the last weeks)
  function spark(vals, label) {
    const lo = Math.min.apply(null, vals) - 1, hi = Math.max.apply(null, vals) + 1;
    return `<div class="fp-spark" role="img" aria-label="${esc(label)}">${vals.map(v => `<i style="--h:${Math.round(12 + 88 * (v - lo) / Math.max(0.01, hi - lo))}"${v < 35 ? ' class="lo"' : ''}></i>`).join('')}</div>
      <div class="fp-spark-l num"><span>low ${n1(lo + 1)}</span><span>high ${n1(hi - 1)}</span></div>`;
  }

  // ---------- views ----------
  const VIEWS = {};

  // Lobby / Press: the wire, public trust, the frontier record
  const LTABS = [['news', 'News', 'news'], ['trust', 'Trust', 'globe'], ['record', 'Record', 'record']];
  const LV = {};
  VIEWS.lobby = function (s) {
    const mult = tryr(() => FR.market.trustMult(s), 1), st = s.stats || {};
    return head('lobby', `Public trust <b class="num">${Math.round(s.market.trust)}</b> of 100 · revenue ×<b class="num">${mult.toFixed(2)}</b> · records <b class="num">${st.firstsWon || 0}</b> set, <b class="num">${st.firstsLost || 0}</b> lost`)
      + tabBar(LTABS) + (LV[P.tab] || LV.news)(s);
  };
  LV.news = function (s) {
    const n = (s.news || []).slice(-20).reverse();
    return intro('The wire, newest first. One to three lines a week.')
      + (n.length ? `<ul class="fp-news">${n.map(newsItem).join('')}</ul>` : empty('news', 'No wire lines yet', 'The first lines arrive when the week resolves. Set the sliders, then End Turn.', ''));
  };
  // " (9 on Agents)": an incident's trust cost scales with the skill's weight (03_model K.weights)
  const ownIncTrust = () => { const K = MK(); if (!K.weights) return ''; const h = SK().filter(k => (+K.weights[k] || 1) !== 1); return h.length ? ` (${h.map(k => `${trim1(K.incidentTrust * K.weights[k])} on ${SN(k)}`).join(', ')})` : ''; };
  LV.trust = function (s) {
    const t = s.market.trust, K = MaK(), mult = tryr(() => FR.market.trustMult(s), 1), dem = Math.pow(mult, MoK().demandTrustExp), hue = t < 20 ? 'bad' : t < 35 ? 'warn' : 'good';
    let out = `<div class="card fp-trust"><div class="pl-mrow-l"><span>Public trust</span><span class="num"><b class="fp-big tone-${hue}">${n1(t)}</b> of 100</span></div>${meter(t, hue)}
      <div class="stats">${stat('Revenue', '×' + mult.toFixed(2))}${stat('Demand', '×' + dem.toFixed(2))}${stat('Valuation', '×' + mult.toFixed(2))}</div></div>`;
    const hist = (s.history || []).slice(-26).map(x => +x.trust || 0);
    if (hist.length > 1) out += sec('chart', 'Trust, last ' + wks(hist.length)) + spark(hist, 'Public trust over the last ' + wks(hist.length));
    const mv = ((s.lastReport && s.lastReport.flows && s.lastReport.flows.trust) || []).filter(x => Math.abs(x.delta) >= 0.05);
    out += sec('trend', 'Last week');
    out += mv.length ? mv.map(x => row(x.why === 'drift' ? 'globe' : x.delta < 0 ? 'alert' : 'trend', esc(x.why === 'drift' ? `Drift toward ${K.trustMid}` : x.why), '', `<span class="${x.delta < 0 ? 'neg' : 'pos'}">${sg1(x.delta)}</span>`)).join('')
      : '<p class="hint">No change last week.</p>';
    out += `<p class="hint">Trust closes ${pct0(K.trustRevert)} of its distance to ${K.trustMid} each week. An incident at your lab costs ${MK().incidentTrust} points${ownIncTrust()}; a rival’s incident costs every lab ${K.incTrust[0]} to ${K.incTrust[1]}${K.incShield != null && K.incShield < 1 ? `, and ${K.incShield === 0.5 ? 'half' : pct0(K.incShield) + ' of'} that when every skill’s safety is within ${tryr(() => FR.sim.K.safeMargin, 5)} of its capability` : ''}. Model cards, safety papers, bug bounties and eval partnerships add points.</p>`;
    return out;
  };
  LV.record = function (s) {
    const st = s.stats || {}, open = MaK().marks.length - ((s.market.firsts || []).length);
    return intro('The first lab to average each capability mark on public evals. A record lost costs score; the run continues.')
      + `<div class="stats">${stat('Set by you', st.firstsWon || 0)}${stat('Lost', st.firstsLost || 0)}${stat('Open', open)}</div>` + sec('record', 'Marks') + recordList(s);
  };

  // Serving: the slider, revenue, demand vs serving PF, the rent stepper
  VIEWS.serving = function (s) {
    const f = fc(s), al = (f && f.alloc) || {}, sv = al.serving || { pf: 0 }, dem = tryr(() => FR.money.demandPF(s), 0), fx = fxOf(s);
    const tm = tryr(() => FR.money.trustMult(s), 1), share = tryr(() => FR.compute.revShare(s), 0), zeta = tryr(() => FR.money.zetaFactor(s), 1);
    const inc = tryr(() => FR.money.incidentFactor(s), 1), base = tryr(() => FR.money.pricePerPF(avgCap(s)), 0), eff = base * (fx.priceMult || 1) * tm * Math.max(0, 1 - share) * zeta * inc;
    let out = head('serving', `Floor ${esc(META('serving').n)} · serving <b class="num">${s.sliders.serving}%</b> · revenue next week <b class="num">${kmoney(f ? f.revenue : s.money.revenue)}</b>`);
    out += intro('Serving sells access to the model. Revenue is the PF served, up to customer demand, times the price per PF-week.');
    if (inc < 1) out += banner('warn', 'incident', 'Serving under incident review', `Revenue earns ${Math.round(inc * 100)}% of normal for 3 weeks after any incident.`);
    out += sliders('serving', s, f);
    out += sec('coin', 'Revenue');
    out += `<div class="stats">${stat('Last week', kmoney(s.money.revenue))}${stat('Next week', kmoney(f ? f.revenue : 0), 'forecast')}${stat('Per PF-week', kmoney(eff), 'served')}</div>`;
    const sp = revSplit(s, sv.pf), nAct = (accOf(s).active || []).length;
    if (sp.contracts > 0 || nAct) out += `<div class="pl-money fp-split">
      <div><span>Open market · <span class="num">${n1(sp.open != null ? sp.open : sv.pf)} PF</span></span><b class="num">${kmoney(sp.market)}</b></div>
      <div><span>Contracts · ${nAct} ${nAct === 1 ? 'account' : 'accounts'}</span><b class="num">${kmoney(sp.contracts)}</b></div>
      <div class="pl-money-t"><span>Next week</span><b class="num">${kmoney(sp.total)}</b></div></div>`;
    // open-market demand is met from what the contracts leave (their PF comes first)
    const rsv = reservedPF(s), opf = Math.max(0, sv.pf - rsv);
    out += `<div class="pl-mrow-l"><span>Demand${tip(TIPS.demand, 'demand')}</span><span class="num">${rsv > 0 ? 'open market' : 'serving'} <b>${n1(opf)}</b> of <b>${n1(dem)}</b> PF</span></div>${meter(dem > 0 ? opf / dem * 100 : 0, opf > dem + 0.05 ? 'warn' : 'gold')}`;
    if (sv.pf <= 0) out += why('Nothing is served at a 0% share. Revenue is zero until Serving has compute.');
    else if (rsv > sv.pf + 0.05) out += why(`The contracts reserve ${n1(rsv)} PF and serving has ${n1(sv.pf)}. Each account left short loses ${AK().mood.unserved} mood a week, and the open market gets nothing.`);
    else if (opf > dem + 0.05) out += why(`Serving ${n1(opf - dem)} PF above demand. That capacity earns nothing; move share to Training, Safety or Research.`);
    else if (dem - opf > 0.05) out += note('trend', `Unmet demand <b class="num">${n1(dem - opf)} PF</b>: about <b class="num">${kmoney(eff * (dem - opf))}</b> a week more at full service.`);
    out += `<div class="pl-money">
      <div><span>Price at average capability ${n1(avgCap(s))}</span><b class="num">${kmoney(base)}</b></div>
      <div><span>Public trust ${Math.round(s.market.trust)}</span><b class="num">×${tm.toFixed(2)}</b></div>
      ${(fx.priceMult || 1) !== 1 ? `<div><span>Project effects on price</span><b class="num pos">×${(+fx.priceMult).toFixed(2)}</b></div>` : ''}
      ${(fx.demandMult || 1) !== 1 ? `<div><span>Project effects on demand</span><b class="num pos">×${(+fx.demandMult).toFixed(2)}</b></div>` : ''}
      ${share > 0 ? `<div><span>Revenue share to deals${tip(TIPS.revshare, 'the revenue share')}</span><b class="num neg">−${pct(share)}</b></div>` : ''}
      ${zeta < 0.999 ? `<div><span>Zeta open weights ahead of you</span><b class="num neg">×${zeta.toFixed(2)}</b></div>` : ''}
      <div class="pl-money-t"><span>Per PF-week served</span><b class="num">${kmoney(eff)}</b></div></div>`;
    out += accountsBlock(s);
    out += sec('compute', 'Rented compute', s.compute.scarcity > 0 ? 'shortage' : '');
    out += rentBox(s);
    return out;
  };

  // Training: the slider, the run target, capability by skill with the forecast gain
  VIEWS.training = function (s) {
    const f = fc(s), K = MK();
    let out = head('training', `Floor ${esc(META('training').n)} · training <b class="num">${s.sliders.training}%</b> · run target <b>${esc(SN(s.target))}</b>`);
    out += intro('Training raises capability. Each point of capability pulls safety down a little, so the gap widens unless Safety keeps pace.');
    out += sliders('training', s, f);
    out += sec('training', 'Run target', '', 'target');
    out += `<div class="seg fp-target" role="group" aria-label="Training run target">${SK().map(k => `<button class="btn${s.target === k ? ' sel' : ''}" data-fp="target" data-v="${k}" aria-pressed="${s.target === k}"${live(s) ? '' : ' disabled'}>${ico(k)}<span>${esc(SN(k))}</span></button>`).join('')}</div>`;
    out += `<p class="hint">The target gains the most. The other two gain ${pct0(K.spill)} as much, and safety on each skill drifts down by ${pct0(K.drift)} of its capability gain.</p>`;
    out += sec('chart', 'Capability by skill', 'change next week', 'skills', tip(TIPS.gap, 'the gap'));
    out += `<div class="card fp-skills">${SK().map(k => skillRow(s, k, f, 'train')).join('')}</div>`;
    return out;
  };

  // the pressure gauge: value, level badge, meter, the sim's one-line reading
  function pressureCard(s) {
    const p = tryr(() => pressure(s), null); if (!p) return '';
    return `<div class="card fp-press" data-focus="pressure"><div class="fp-press-h"><span class="kicker">Pressure</span>${tip(TIPS.pressure, 'pressure')}
      <b class="num tone-${p.hue}">${n1(p.value)}</b>${badge(p.label, p.hue, p.hue === 'good' ? 'check' : 'alert')}</div>
      <div class="fp-pm" role="img" aria-label="Pressure ${n1(p.value)}, ${esc(p.label)}"><div class="meter ${p.hue}" style="--v:${Math.round(p.pct)}"><i></i></div>${p.bands.map(b => `<span style="left:${b}%"></span>`).join('')}</div>
      ${p.text ? `<p class="fp-out${p.hue === 'good' ? '' : ' ' + p.hue}">${esc(p.text)}</p>` : ''}</div>`;
  }
  // Safety: pressure, the slider, per-skill cap / safe / gap with the outlook, the incident history
  VIEWS.safety = function (s) {
    const f = fc(s), K = MK(), worst = SK().reduce((b, k) => gapOf(s, k) > gapOf(s, b) ? k : b, SK()[0]);
    let out = head('safety', `Floor ${esc(META('safety').n)} · safety <b class="num">${s.sliders.safety}%</b> · widest gap <b>${esc(SN(worst))}&nbsp;<span class="num">${gapTxt(gapOf(s, worst))}</span></b>`);
    out += intro(`Safety work lands where the gap is widest. Safety can run at most ${K.safeLead} above capability.`);
    out += pressureCard(s);
    out += sliders('safety', s, f);
    out += sec('safety', 'Skills', 'change next week', 'skills', tip(TIPS.gap, 'the gap'));
    out += `<div class="card fp-skills">${SK().map(k => skillRow(s, k, f, 'safety')).join('')}</div>`;
    const st = s.stats || {}, rivInc = (s.market.rivals || []).reduce((t, r) => t + (r.incidents || 0), 0);
    out += sec('incident', 'Incident history', '', 'log');
    out += `<div class="stats">${stat('Incidents', st.incidents || 0)}${stat('Warnings', st.warnings || 0)}${stat('Rival incidents', rivInc)}</div>`;
    const rows = SK().map(k => {
      const l = s.model.skills[k].incidents || []; if (!l.length) return '';
      const rec = l.filter(t => t > s.turn - K.incidentWindow).length, last = rec >= K.finalIncidents - 1;
      return row('incident', `${esc(SN(k))} · ${l.length} incident${l.length === 1 ? '' : 's'}`, `${l.map(t => esc(when(t))).join(', ')} · ${rec} in the past ${K.incidentWindow} weeks${last ? '. One more ends the lab' : ''}`, last ? badge('Last warning', 'bad') : '');
    }).join('');
    out += rows || empty('safety', 'No incidents on record', `Warnings start when a gap stays above ${K.warnGap} for ${K.warnTurns} weeks. Safety share and safety projects keep every gap at ${K.warnGap} or below; the ${tryr(() => FR.sim.K.winTurns, 52)}-week frontier hold needs every gap at ${tryr(() => FR.sim.K.safeMargin, 5)} or below.`, btn('go', 'research.offers', 'Safety projects on the board', '', false, 'research'));
    const inc = (s.news || []).filter(n => n.kind === 'incident').slice(-5).reverse();
    if (inc.length) out += sec('news', 'On the wire') + `<ul class="fp-news">${inc.map(newsItem).join('')}</ul>`;
    return out;
  };

  // Research: the slider, points to the next tier, the offer board (greenlight here)
  VIEWS.research = function (s) {
    const f = fc(s), r = s.research, K = PK(), nt = tryr(() => FR.projects.nextTier(s), null), rate = tryr(() => FR.projects.researchRate(s), 0), sp = tryr(() => FR.projects.speed(s), 1);
    let out = head('research', `Floor ${esc(META('research').n)} · research <b class="num">${s.sliders.research}%</b> · tier <b class="num">${r.tier}</b> · <b class="num">${Math.floor(r.points)}</b> points`);
    out += intro('Research points open project tiers and speed up every active project.');
    out += sliders('research', s, f);
    out += `<div class="card" data-focus="tier"><div class="card-head">${ico('research')}<b class="card-title">Tier ${r.tier} of ${K.tiers.length}</b>${tip(TIPS.tier, 'research tiers')}${badge(Math.floor(r.points) + ' points', 'info')}</div>`
      + (nt ? `<div class="pl-mrow-l"><span>Tier ${nt.tier} at ${nt.at} points</span><span class="num"><b>${Math.floor(nt.points)}</b> of ${nt.at}</span></div>${meter(nt.points / nt.at * 100, 'info')}`
        + (rate > 0.01 ? note('clock', `<b class="num">${n1(rate)}</b> points a week: tier ${nt.tier} in about <b class="num">${wks(Math.max(1, Math.ceil(nt.left / rate)))}</b> at this share.`)
          : why(`No research points at a ${s.sliders.research}% share. Raise the research share to reach tier ${nt.tier}.`))
        : note('check', 'Top tier reached. Research points now only speed project work.'))
      + kv('trend', `Projects work at <b class="num">×${(+sp).toFixed(2)}</b> speed. Research can add at most ×${(1 + K.speedMax).toFixed(2)}.`) + '</div>';
    out += offerBoard(s);
    return out;
  };

  // Project floors 1..3: the slot's project, or the offers to greenlight into the next free floor
  function projectCard(s, p, slot, f) {
    const K = PK(), turns = Math.max(1, p.turns || 1), done = p.progress || 0, spent = p.cost / turns * done, wk = Math.min(turns, Math.floor(done + 1e-6) + 1);
    const k = kindOf(p.kind), above = s.projects.active.length - 1 - slot, pr = f && f.alloc && f.alloc.projects;
    let risk;
    if (p.overrun) risk = note('alert', `Overran at the halfway review: ${wks(turns)} and ${kmoney(p.cost)} in total now. No further review.`);
    else if (done >= turns / 2 - 1e-9) risk = note('check', 'Past the halfway review. No further risk.');
    else risk = kv('alert', `Halfway review at week ${Math.ceil(turns / 2)}: <b class="num">${pct0(p.risk)}</b> chance of trouble.${tip(TIPS.risk, 'risk')}`);
    const actions = P.confirm === 'cancel:' + p.uid
      ? confirmBox(true, `Cancel ${esc(p.name)}?`, `<b class="num">${kmoney(spent)}</b> already spent is not refunded. The remaining ${kmoney(Math.max(0, p.cost - spent))} is not spent, and ${p.pfPerTurn} PF a week returns to the sliders.${above > 0 ? ' Projects on the floors above move down one floor.' : ''}`, 'Keep it', 'cancelOk', p.uid, 'Cancel project')
      : `<div class="card-actions">${btn('cancel', p.uid, 'Cancel project', 'quiet pl-danger-q', !live(s), 'trash')}</div>`;
    return `<div class="card fp-proj">
      <div class="fp-cardk"><span class="pl-kind">${esc(k[0])}</span>${p.overrun ? badge('Overrun', 'warn', 'alert') : badge('In progress', 'info', 'clock')}</div>
      <div class="card-head"><b class="card-title">${esc(p.name)}</b></div>
      <p class="card-meta">${skillOf(p) ? esc(skillOf(p)) + ' · ' : ''}started ${esc(when(p.started))}</p>
      <div class="pl-mrow-l"><span>Week ${wk} of ${turns}</span><span class="num"><b>${wks(p.turnsLeft)}</b> left</span></div>${meter(done / turns * 100, 'good')}
      <div class="stats">${stat('Spent', kmoney(spent))}${stat('Budget', kmoney(p.cost))}${stat('PF a week', p.pfPerTurn)}</div>
      ${kv('trend', esc(describe(p)))}${risk}
      ${pr && pr.need > pr.pf + 0.01 ? why(`Projects need ${n1(pr.need)} PF, ${n1(pr.pf)} PF available. Work runs at ${pct0(pr.pf / pr.need)} pace until capacity grows.`) : ''}
      ${actions}</div>`;
  }
  VIEWS.proj = function (s) {
    const id = P.floor, m = META(id), slot = m.slot != null ? m.slot : Math.max(0, (+String(id).slice(-1) || 1) - 1);
    const p = (s.projects.active || [])[slot] || null, used = s.projects.active.length;
    let out = head(id, `Floor ${esc(m.n)} · project slot ${slot + 1} of ${s.projects.slots} · ${p ? `<b>${esc(p.name)}</b>` : 'free'}`);
    if (p) return out + projectCard(s, p, slot, fc(s));
    const nextF = 'proj' + (used + 1);
    out += empty('project', `No project on ${esc(m.name)}`, used < slot
      ? `Projects fill the floors in order. The next greenlit project runs on ${esc(META(nextF).name)}. Greenlight one below.`
      : 'Greenlight one of the offers below. It runs on this floor until it finishes.', '');
    return out + offerBoard(s);
  };

  // Boardroom: Money, Team, Compute, Rivals
  const BTABS = [['money', 'Money', 'coin'], ['team', 'Team', 'users'], ['compute', 'Compute', 'compute'], ['rivals', 'Rivals', 'rival']];
  const BV = {};
  VIEWS.boardroom = function (s) {
    const f = fc(s), m = s.money;
    return head('boardroom', `Floor ${esc(META('boardroom').n)} · cash <b class="num">${kmoney(m.cash)}</b> · runway <b class="num">${runwayText(f ? f.runway : null)}</b> · your stake <b class="num">${pctS(m.founderPct)}</b>`)
      + tabBar(BTABS, { money: !!m.offer, compute: !!s.market.dealOffer }) + (BV[P.tab] || BV.money)(s, f);
  };
  function roundCard(s, f) {
    const m = s.money, o = m.offer, name = roundName(o.round), left = o.expires - s.turn + 1, pv = preview({ type: 'acceptRound' }, s), after = pv.ok ? pv.state : null;
    const ms = after && after.money.milestone;
    const actions = P.confirm === 'decline'
      ? (() => { const back = s.turn + MoK().reofferTurns; return confirmBox(true, `Decline the ${esc(name)} offer?`, `Investors return ${esc(when(back))}, in ${wks(back - s.turn)}, with an offer at the valuation then. Runway now: <b class="num">${runwayText(f && f.runway)}</b>.`, 'Keep the offer', 'declineOk', '', 'Decline'); })()
      : `<div class="card-actions">${btn('decline', '', 'Decline', 'quiet', !live(s))}${btn('accept', '', `Accept ${kmoney(o.amount)}`, 'primary', !live(s), 'check')}</div>`;
    return `<div class="card fp-round selected" data-focus="round">
      <div class="card-head">${ico('coin')}<b class="card-title">${esc(name)} offer</b>${badge(left <= 1 ? 'Last week' : wks(left) + ' left', left <= 2 ? 'warn' : 'gold', 'clock')}</div>
      <p class="card-meta">Open until ${esc(when(o.expires))}. Ending that week without an answer lets it lapse.</p>
      <div class="stats">${stat('Amount', kmoney(o.amount))}${stat('Stake sold', pct(o.pct))}${stat('Valuation', kmoney(o.valuation), 'post-money')}</div>
      ${kv('coin', `Cash after closing <b class="num">${kmoney(m.cash + o.amount)}</b>${pv.f ? `; runway <b class="num">${runwayText(pv.f.runway)}</b>` : ''}.`)}
      ${after ? kv('users', `Your stake falls from <b class="num">${pctS(m.founderPct)}</b> to <b class="num">${pctS(after.money.founderPct)}</b>.${tip(TIPS.stake, 'your stake')}`) : ''}
      ${kv('record', ms ? esc(ms.text) : 'No further rounds are scheduled after this one.')}
      ${actions}</div>`;
  }
  function milestoneCard(s) {
    const ms = s.money.milestone, pr = tryr(() => FR.money.progress(s), null); if (!pr) return '';
    const fmt = (v) => ms.kind === 'revenue' ? kmoney(v) : n1(v), sk = ms.kind === 'cap' ? (ms.skill || bestSkill(s)) : null;
    const label = { cap: `${sk ? SN(sk) : 'Best skill'} capability`, avgCap: 'Average capability', revenue: 'Weekly revenue', trust: 'Public trust' }[ms.kind] || 'Progress';
    const m = s.money, lock = !m.offer && m.lockedUntil > s.turn;
    const said = pr.met ? (lock ? `Met. Investors return ${esc(when(m.lockedUntil))} with the ${esc(roundName(ms.round))} offer.` : `Met. The ${esc(roundName(ms.round))} offer arrives at the next End Turn.`)
      : `Missing it closes rounds for ${wks(MoK().lockTurns)}.`;
    return `<div class="card" data-focus="milestone"><div class="card-head">${ico('record')}<b class="card-title">${esc(roundName(ms.round))} milestone</b>${pr.met ? badge('Met', 'good', 'check') : badge(pr.weeksLeft <= 0 ? 'Due now' : wks(pr.weeksLeft) + ' left', pr.weeksLeft <= 4 ? 'warn' : '', 'clock')}</div>
      <p class="card-meta">${esc(ms.text)}</p>
      <div class="pl-mrow-l"><span>${esc(label)}</span><span class="num"><b>${fmt(pr.current)}</b> of ${fmt(pr.value)}</span></div>${meter(pr.value > 0 ? pr.current / pr.value * 100 : 0, pr.met ? 'good' : 'gold')}
      ${pr.met ? '' : paceNote(s, ms)}${ms.kind === 'revenue' && !pr.met && accOn() ? kv('building', `Weekly revenue counts open-market serving and account fees. ${unlocked(s) ? `The book holds ${(accOf(s).active || []).length} of ${maxActive(s)} accounts.` : 'Account offers open on the Serving floor at average capability ' + AK().unlockCap + ' and public trust ' + AK().unlockTrust + '.'}`) : ''}${note(pr.met ? 'check' : 'alert', said)}</div>`;
  }
  // FR.money.pace: where today's settings leave a capability milestone by its due week
  const paceOf = (s, ms) => has('money', 'pace') ? tryr(() => FR.money.pace(s, ms), null) : null;
  function paceNote(s, ms) {
    const p = paceOf(s, ms); if (!p) return '';
    const t = `At this pace: ${p.skill ? esc(SN(p.skill)) + ' ' : 'average '}<b class="num">${n1(p.projected)}</b> by ${esc(when(ms.due))}`;
    return p.short > 0 ? why(`${t}, short by <span class="num">${n1(p.short)}</span>. Training output grows with compute and staff: rent PF on Serving or the Compute tab, hire on the Team tab.`)
      : note('trend', t + '.');
  }
  BV.money = function (s, f) {
    const m = s.money, bp = tryr(() => FR.money.burnParts(s), { payroll: 0, ops: 0, compute: 0, projects: 0 }), rw = f ? f.runway : Infinity;
    const rcls = rw === Infinity ? 'pos' : rw < 6 ? 'neg' : rw < 13 ? 'tone-warn' : '';
    let out = `<div class="stats">${stat('Cash', kmoney(m.cash))}${stat('Runway', rw === Infinity ? 'Positive' : Math.max(0, rw) + ' wks', rw === Infinity ? 'revenue covers burn' : 'forecast', { tip: tip(TIPS.runway, 'runway'), cls: rcls })}${stat('Valuation', kmoney(m.valuation), 'stake ' + pctS(m.founderPct), { tip: tip(TIPS.stake, 'your stake') })}</div>`;
    // contracted revenue and the backlog (V0.3): the cap table view carries the customer book beside the investors
    const act = accOf(s).active || [];
    if (act.length) {
      const fees = act.reduce((t, x) => t + (x.starts != null && x.starts > s.turn ? 0 : +x.feePerWeek || 0), 0), yr = fees * 52;
      out += `<div class="pl-money fp-contract" data-focus="contracts">
        <div><span>Contracted revenue · ${act.length} ${act.length === 1 ? 'account' : 'accounts'}</span><b class="num">${kmoney(fees)}<small> a week</small></b></div>
        <div><span>Backlog · fees still to be paid</span><b class="num">${kmoney(backlog(s))}</b></div>
        <div><span>Contracted a year at today’s book</span><b class="num">${kmoney(yr)}</b></div></div>`;
    }
    const sp = f ? revSplit(s, (f.alloc && f.alloc.serving || {}).pf) : { contracts: 0 };
    if (f) {
      out += sec('coin', 'Next week', 'forecast');
      out += `<div class="pl-money">
        ${sp.contracts > 0 ? `<div><span>Revenue · open market</span><b class="num pos">+${kmoney(sp.market)}</b></div><div><span>Revenue · contracts</span><b class="num pos">+${kmoney(sp.contracts)}</b></div>`
          : `<div><span>Revenue</span><b class="num pos">+${kmoney(f.revenue)}</b></div>`}
        <div><span>Payroll · ${s.staff.headcount} staff</span><b class="num">−${kmoney(bp.payroll)}</b></div>
        <div><span>Operations</span><b class="num">−${kmoney(bp.ops)}</b></div>
        <div><span>Compute</span><b class="num">−${kmoney(bp.compute)}</b></div>
        ${bp.projects ? `<div><span>Projects</span><b class="num">−${kmoney(bp.projects)}</b></div>` : ''}
        <div class="pl-money-t"><span>Net a week</span><b class="num ${f.net < 0 ? 'neg' : 'pos'}">${smoney(f.net)}</b></div></div>`;
      out += note('clock', s.turn > 1 ? `Last week: revenue <b class="num">${kmoney(m.revenue)}</b>, burn <b class="num">${kmoney(m.burn)}</b>, net <b class="num">${smoney(m.net)}</b>.` : 'The first week resolves at End Turn.');
    }
    out += sec('record', 'Funding', `closed: ${m.roundsDone.length ? m.roundsDone.map(roundName).join(', ') : 'none yet'}`, 'funding');
    const next = tryr(() => FR.money.nextRound(s), null), locked = !m.offer && m.lockedUntil && m.lockedUntil > s.turn;
    if (m.offer) out += roundCard(s, f);
    if (locked) out += banner('warn', 'clock', `No round until ${esc(when(m.lockedUntil))}`, `Investors return in ${wks(m.lockedUntil - s.turn)}.${m.milestone ? '' : ' A new milestone follows.'}`);
    if (m.milestone && !(m.offer && m.offer.round === m.milestone.round)) out += milestoneCard(s);
    if (!m.offer && !m.milestone && !next) out += `<div class="pl-verdict good">${ico('check')}<div><b>${esc(roundName(m.roundsDone[m.roundsDone.length - 1] || 'a'))} closed</b><span>No further rounds are scheduled. Revenue funds the lab from here.</span></div></div>`;
    else if (!m.offer && !m.milestone && !locked) out += note('clock', 'Investors set the next milestone at End Turn.');
    // close the lab: end the run now and take the score (owner call, V0.2)
    if (live(s)) {
      out += sec('boardroom', 'Close the lab', 'ends the run');
      out += P.confirm === 'retire'
        ? confirmBox(true, `Close ${esc(s.lab.name)}?`, `The run ends now, in ${esc(when(s.turn))}, and is scored as it stands: founder stake ${pctS(m.founderPct)} of ${kmoney(m.valuation)}. This cannot be undone.`, 'Keep operating', 'retireOk', '', 'Close the lab')
        : `<p class="hint">The founders can close the lab at any time and take the score as it stands.</p>${btn('retire', '', 'Close the lab', 'danger')}`;
    }
    return out;
  };
  // Hire 1 / 5 / all the room left this week, each clamped to FR.money.hireRoom; with no room the buttons stay, disabled,
  // with the reason. A button the cash or the headcount cap cannot cover is disabled and the note says how many can join.
  function hireBlock(s) {
    const K = MoK(), room = hireRoom(s), pend = s.staff.hiring.reduce((t, x) => t + x.n, 0);
    const headRoom = Math.max(0, K.maxHead - s.staff.headcount - pend), cashRoom = Math.floor(Math.max(0, s.money.cash) / K.hireFee);
    const can = Math.min(room, headRoom, cashRoom);
    const amounts = room > 0 ? [1, 5, K.maxHire].map(n => Math.min(n, room)).filter((n, i, a) => a.indexOf(n) === i) : [1, 5, K.maxHire].filter((n, i, a) => a.indexOf(n) === i);
    const dis = !live(s) ? 'The run is over.'
      : room <= 0 ? `At most ${K.maxHire} hires a week; all ${K.maxHire} are already recruiting. Hiring reopens after End Turn.`
        : headRoom <= 0 ? `Headcount is capped at ${K.maxHead}, hires joining included.`
          : cashRoom <= 0 ? `Recruiting one costs ${kmoney(K.hireFee)}; cash is ${kmoney(s.money.cash)}.` : '';
    const part = !dis && amounts.some(n => n > can) ? (can < room ? (cashRoom < headRoom ? `Cash covers ${can} ${can === 1 ? 'hire' : 'hires'} at ${kmoney(K.hireFee)} each.` : `Headcount is capped at ${K.maxHead}: room for ${can} more.`) : '') : '';
    return `<div class="fp-hire">${amounts.map(n => btn('hire', n, `Hire ${n}`, '', !!dis || n > can)).join('')}</div>`
      + `<p class="hint">${kmoney(K.hireFee)} recruiting fee a head now. Each costs ${kmoney(K.wage + (K.opsPerHead || 0))} a week (pay ${kmoney(K.wage)}, operations ${kmoney(K.opsPerHead || 0)}) from ${esc(when(s.turn + K.hireTurns))}, when they join.</p>`
      + (dis ? why(dis, room <= 0 && live(s) ? 'info' : 'warn') : part ? why(part, 'info') : '');
  }
  function layoffBlock(s) {
    const K = MoK(), room = s.staff.headcount - K.minHead, cf = /^layoff:(\d+)$/.exec(P.confirm || '');
    if (cf) return layoffOne(s, +cf[1]);
    const dis = !live(s) ? 'The run is over.' : room < 1 ? `Headcount cannot fall below ${K.minHead}.` : '';
    const amounts = [1, 5, 20].map(n => Math.min(n, Math.max(1, room))).filter((n, i, a) => a.indexOf(n) === i);
    const sevOf = (n) => n * K.wage * K.severanceWeeks;
    return `<div class="fp-hire">${amounts.map(n => btn('layoff', n, `Lay off ${n}`, 'danger', !!dis || n > room || s.money.cash < sevOf(n))).join('')}</div>`
      + `<p class="hint">Severance is ${wks(K.severanceWeeks)} of pay: ${kmoney(sevOf(1))} a head. Each head laid off saves ${kmoney(K.wage + (K.opsPerHead || 0))} a week and costs public trust.</p>`
      + (dis ? why(dis) : '');
  }
  function layoffOne(s, n) {
    const K = MoK(), sev = n * K.wage * K.severanceWeeks, tr = clamp(n * K.layoffTrustPer, K.layoffTrust[0], K.layoffTrust[1]);
    const pv = preview({ type: 'layoff', n }, s), f0 = fc(s);
    return confirmBox(true, `Lay off ${n}?`, `Severance <b class="num">${kmoney(sev)}</b> now. Payroll falls ${kmoney(n * K.wage)} a week to ${kmoney((s.staff.headcount - n) * K.wage)}. Public trust −${n1(tr)}.${pv.ok && pv.f && f0 ? ` Runway ${runwayText(f0.runway)} → ${runwayText(pv.f.runway)}.` : ''}`, 'Keep them', 'layoffOk', n, `Lay off ${n}`);
  }
  BV.team = function (s) {
    const K = MoK(), st = s.staff, pend = st.hiring.reduce((t, x) => t + x.n, 0), pay = tryr(() => FR.money.payroll(s), st.headcount * K.wage);
    let out = `<div class="stats">${stat('Headcount', st.headcount)}${stat('Payroll', kmoney(pay), 'a week')}${stat('Joining', pend, pend ? 'hired' : 'none hired')}</div>`;
    out += sec('users', 'Staff by department', 'follows the sliders');
    out += `<div class="stats fp-st4">${AL().map(k => stat(esc(AN(k)), trim1(st.headcount * s.sliders[k] / 100))).join('')}</div>`;
    out += `<p class="hint">Each department’s output grows with its compute and its staff. Payroll is ${kmoney(K.wage)} a head a week, the largest fixed cost.</p>`;
    out += sec('clock', 'Hiring pipeline');
    out += st.hiring.length ? st.hiring.slice().sort((a, b) => a.arrives - b.arrives).map(x => row('hire', `${x.n} ${x.n === 1 ? 'hire' : 'hires'}`, `join ${esc(when(x.arrives))}`, wkS(x.arrives - s.turn))).join('')
      : `<p class="hint">Nobody in the pipeline. Hires join ${wks(K.hireTurns)} after the offer.</p>`;
    const room = hireRoom(s);
    out += sec('hire', 'Hire', `${room} of ${K.maxHire} left this week`, 'hire');
    out += hireBlock(s);
    out += sec('trash', 'Lay off');
    return out + layoffBlock(s);
  };
  function dealCard(s) {
    const o = s.market.dealOffer, r = rival(s, o.rivalId), cut = (s.money.revenue || 0) * o.revShare, rentEq = o.pf * s.compute.rentPrice, open = o.kind === 'compute';
    const actions = P.confirm === 'dealNo'
      ? confirmBox(false, `Decline the ${esc(r.name)} offer?`, 'The offer closes. Rival offers return only by chance.', 'Keep the offer', 'dealNoOk', '', 'Decline')
      : `<div class="card-actions">${btn('dealNo', '', 'Decline', 'quiet', !live(s))}${btn('dealOk', '', 'Accept', 'primary', !open || !live(s), 'check')}</div>`;
    return `<div class="card fp-deal selected" data-focus="deal">
      <div class="card-head">${ico('rival')}<b class="card-title">${esc(r.name)} compute share</b>${badge('Until ' + esc(when(o.expires)), o.expires - s.turn <= 1 ? 'warn' : 'gold', 'clock')}</div>
      <p class="card-meta">${esc(r.name)} lends capacity from its own fleet for a cut of all revenue while the deal runs.</p>
      <div class="stats">${stat('Compute', o.pf + ' PF')}${stat('Term', o.turns + ' wks')}${stat('Revenue share', pct(o.revShare), '', { tip: tip(TIPS.revshare, 'the revenue share') })}</div>
      ${kv('coin', `At last week’s revenue the share is <b class="num">${kmoney(cut)}</b> a week. Renting ${o.pf} PF at today’s price costs <b class="num">${kmoney(rentEq)}</b> a week.`)}
      ${open ? '' : why('Only compute-share deals are open.', 'info')}${actions}</div>`;
  }
  function dealRow(s, d) {
    const r = rival(s, d.rivalId);
    if (P.confirm === 'end:' + d.rivalId) return confirmBox(true, `End the ${esc(r.name)} share now?`, `${d.pf} PF is withdrawn at once and the ${pct(d.revShare)} revenue share stops. It was due to end ${esc(when(d.ends))}.`, 'Keep it', 'endDealOk', d.rivalId, 'End the deal');
    return `<div class="pl-row"><span class="pl-row-ico">${ico('rival')}</span><div class="pl-row-t"><b>${esc(r.name)} · ${d.pf} PF</b><small>${pct(d.revShare)} of revenue · ends ${esc(when(d.ends))}</small></div>${btn('endDeal', d.rivalId, 'End', 'quiet pl-danger-q', !live(s))}</div>`;
  }
  function clusterOffer(s, o) {
    const K = CK(), pb = tryr(() => FR.compute.payback(s, o), null), after = s.money.cash - o.cost, power = o.pf * K.power;
    let actions;
    if (P.confirm === 'buy:' + o.id) actions = confirmBox(false, `Buy ${esc(o.name)} for ${kmoney(o.cost)}?`, `Cash after: <b class="num">${kmoney(after)}</b>. ${o.pf} PF online ${esc(when(s.turn + o.installTurns))}; power about ${kmoney(power)} a week from then. Retires after ${trim1(K.retireTurns / 52)} years.`, 'Not now', 'buyOk', o.id, 'Buy');
    else {
      const dis = !live(s) ? 'The run is over.' : s.money.cash < o.cost ? `Costs ${kmoney(o.cost)}; cash is ${kmoney(s.money.cash)}.` : '';
      actions = btn2('buy', o.id, `Buy for ${kmoney(o.cost)}`, `cash after ${kmoney(after)}`, '', !!dis, 'building') + (dis ? why(dis) : '');
    }
    return `<div class="card fp-cluster"><div class="card-head">${ico('compute')}<b class="card-title">${esc(o.name)}</b>${badge(o.pf + ' PF', 'info')}</div>
      <div class="stats">${stat('Price', kmoney(o.cost))}${stat('Install', o.installTurns + ' wks')}${stat('Power', kmoney(power), 'a week')}</div>
      ${pb ? kv('trend', `Pays back against renting at today’s price in about <b class="num">${wks(pb)}</b>.`) : kv('alert', 'Does not pay back against renting at today’s price within its life.')}
      ${actions}</div>`;
  }
  BV.compute = function (s, f) {
    const c = s.compute, K = CK(), cap = tryr(() => FR.compute.capacity(s), { total: 0, owned: 0, rented: c.rentPF, deals: 0 }), pr = (f && f.alloc && f.alloc.projects) || { pf: 0, need: 0 };
    const t = Math.max(0.001, cap.total), nq = Math.ceil(s.turn / K.quarter) * K.quarter + 1;
    let out = `<div class="stats">${stat('Owned', n1(cap.owned) + ' PF', '', { key: 'o' })}${stat('Rented', n1(cap.rented) + ' PF', '', { key: 'r' })}${stat('Deals', n1(cap.deals) + ' PF', '', { key: 'd' })}</div>`;
    out += `<div class="fp-stack" role="img" aria-label="Capacity ${n1(cap.total)} PF: owned ${n1(cap.owned)}, rented ${n1(cap.rented)}, deals ${n1(cap.deals)}"><i class="o" style="width:${cap.owned / t * 100}%"></i><i class="r" style="width:${cap.rented / t * 100}%"></i><i class="d" style="width:${cap.deals / t * 100}%"></i></div>`;
    out += note('compute', `Total <b class="num">${n1(cap.total)} PF</b>${pr.need > 0 ? `; projects hold <b class="num">${n1(pr.pf)}</b>, the sliders share <b class="num">${n1(Math.max(0, cap.total - pr.pf))}</b>` : ', all of it shared by the sliders'}. Compute bill <b class="num">${kmoney(tryr(() => FR.compute.cost(s), 0))}</b> a week.`);
    if (pr.need > cap.total + 0.01) out += why(`Projects need ${n1(pr.need)} PF of ${n1(cap.total)} PF. Project work slows and the sliders get nothing until capacity grows.`, 'bad');
    if (s.market.dealOffer) out += sec('rival', 'Deal on the table') + dealCard(s);
    if (c.deals.length) out += sec('rival', 'Compute shares running') + c.deals.map(d => dealRow(s, d)).join('');
    out += sec('coin', 'Rent', c.scarcity > 0 ? `shortage, ${wks(c.scarcity)}` : `spot ${kmoney(c.rentPrice)}`, 'rent');
    out += rentBox(s);
    out += sec('building', 'Clusters for sale', `new offers ${esc(when(nq))}`, 'clusters');
    out += c.offers.length ? c.offers.map(o => clusterOffer(s, o)).join('')
      : empty('building', 'No clusters for sale', `This quarter’s offers are taken. New offers arrive ${esc(when(nq))}. Rent covers the gap until then.`, '');
    if (c.installing.length) out += sec('clock', 'Installing') + c.installing.map(x => row('compute', `${esc(x.name)} · ${x.pf} PF`, `online ${esc(when(x.ready))}`, wkS(x.ready - s.turn))).join('');
    out += sec('compute', 'Owned clusters');
    out += c.clusters.length ? c.clusters.map(x => {
      const i = tryr(() => FR.compute.clusterInfo(s, x), null); if (!i) return '';
      return row('compute', `${esc(x.name)} · ${n1(i.pf)} PF`, `${pct0(i.factor)} of ${x.pf} PF · power ${kmoney(i.power)} a week · retires ${esc(when(s.turn + i.retiresIn))}`, i.retiresIn <= 8 ? badge(wkS(i.retiresIn), 'warn') : '');
    }).join('') : `<p class="hint">No owned clusters. A cluster costs cash up front, then power each week. Its capacity falls ${pct0(K.decayPerYear)} a year and it retires after ${trim1(K.retireTurns / 52)} years.</p>`;
    return out;
  };
  BV.rivals = function (s) {
    const RV = MaK().RIVALS, first = (t) => String(t || '').split('. ')[0].replace(/\.$/, '');
    const you = { name: s.lab.name, cap: avgCap(s), safe: avgSafe(s), inc: (s.stats && s.stats.incidents) || 0, you: true, line: 'Your lab' };
    const rows = (s.market.rivals || []).map(r => ({ name: r.name, cap: ravg(r, 'cap'), safe: ravg(r, 'safe'), inc: r.incidents || 0, line: first((RV[r.id] || {}).blurb) || r.style }))
      .concat([you]).sort((a, b) => b.cap - a.cap);
    const margin = tryr(() => FR.sim.K.safeMargin, 5), win = tryr(() => FR.sim.K.winTurns, 52);
    let out = intro(`Average capability and safety over the three skills. The frontier is the best rival’s average capability. Hold it with every gap at ${margin} or below for ${win} weeks to win.`);
    out += `<div class="fp-chh"><span>#</span><span>Lab</span><span>Cap · safe</span></div><div class="pl-chart fp-rivals">${rows.map((r, i) => `<div class="pl-cr${r.you ? ' you' : ''}"><span class="pl-rk num">${i + 1}</span><span class="pl-ct"><b>${esc(r.name)}</b><small>${esc(r.line)}</small></span><span class="pl-cs"><b><span class="tone-cap">${n1(r.cap)}</span> · <span class="tone-safe">${n1(r.safe)}</span></b><small>${r.inc} incident${r.inc === 1 ? '' : 's'}</small></span></div>`).join('')}</div>`;
    out += sec('record', 'The frontier record', 'first to each mark') + recordList(s);
    return out;
  };

  // ---------- routing ----------
  const DEFAULT_TAB = { lobby: 'news', boardroom: 'money' };
  function parse(id) {
    const [fid, thing] = String(id || '').split('.');
    switch (fid) {
      case 'lobby': return { floor: fid, tab: { news: 'news', trust: 'trust', record: 'record' }[thing] || 'news' };
      case 'serving': return { floor: fid, focus: thing === 'accounts' ? 'accounts' : null };
      case 'training': return { floor: fid, focus: thing === 'board' ? 'target' : null };
      case 'safety': return { floor: fid, focus: thing === 'log' ? 'log' : thing === 'evals' || thing === 'redteam' ? 'skills' : null };
      case 'research': return { floor: fid, focus: thing === 'offers' ? 'offers' : null };
      case 'proj1': case 'proj2': case 'proj3': return { floor: fid };
      case 'boardroom': return { floor: fid, tab: { table: 'money', money: 'money', rivals: 'rivals', compute: 'compute', team: 'team' }[thing] || 'money' };
    }
    return null;
  }
  P.parse = parse;
  const mine = () => !!(U.sheetId && (U.sheetId.indexOf('fp:') === 0 || U.sheetId === 'memo'));
  function focusTo(key) {
    const body = $('sheetBody'), el = body && body.querySelector(`[data-focus="${key}"]`); if (!el) return;
    const tabs = body.querySelector('.tabs.sticky'), off = 60 + (tabs ? tabs.offsetHeight : 0);
    body.scrollTop = Math.max(0, body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - off);
  }
  function render(keep) {
    const s = S(); if (!s || !P.floor) return;
    const body = $('sheetBody'), sc = body ? body.scrollTop : 0, id = 'fp:' + P.floor, same = U.sheetId === id;
    const view = VIEWS[P.floor] || (/^proj\d$/.test(P.floor) ? VIEWS.proj : null);
    let html;
    try { html = view(s); } catch (e) {
      console.error('panel failed', P.floor, e);
      html = `<h3>${esc(META(P.floor).name)}</h3>` + empty('alert', 'This panel could not be read', 'The lab is unchanged. Close the panel and open it again.', '');
    }
    U.sheet(`<div class="pl fp fp-${esc(P.floor)}">${html}</div>`, id);
    bindSliders();
    if (!body) return;
    if (keep && same) body.scrollTop = sc; else if (P.focus) focusTo(P.focus); else body.scrollTop = 0;
  }
  P.render = render;
  P.open = function (floor, tab, focus, hotspot) {
    if (!S() || !floor) return;
    P.floor = floor; P.tab = tab || DEFAULT_TAB[floor] || null; P.focus = focus || null; P.confirm = null; P.hotspot = hotspot || floor; drag = null;
    render(false);
    FR.emit('ui:panel', { floorId: floor, tab: P.tab, hotspotId: P.hotspot });
  };
  U.panel = function (hotspotId) {
    const id = String(hotspotId || '');
    if (id === 'elevator') { if (FR.elevator && FR.elevator.openPanel) FR.elevator.openPanel(); return; }
    const r = parse(id);
    if (!r) { if (U.noPanel) U.noPanel(id); return; }
    P.open(r.floor, r.tab, r.focus, id);
  };
  // ride to the hotspot's floor if needed, glide to it (the world then emits hq:hotspot and the HUD opens the panel),
  // or open the panel at once when the target is not in the room
  function goTo(hot) {
    const fid = String(hot).split('.')[0];
    const open = () => { const R = FR.r; if (R && !R.stub && R.target && R.target(hot) && (!R.live || R.live(hot)) && R.focus && R.focus(hot) !== false) return; U.panel(hot); };
    if (U.goFloor && FR.r && FR.r.current && FR.r.current.id !== fid && !FR.r.stub) U.goFloor(fid, open); else open();
  }

  // ---------- the weekly memo ----------
  const FLAGGY = /incident|warning|\brecord\b|round|series [ab]|milestone|final|churn|ends its contract|leaves the book/i;
  function lineIcon(l) {
    const t = l.text;
    if (/\bgap \d/i.test(t) && !/incident at gap/i.test(t)) return 'alert';
    if (/incident/i.test(t)) return 'incident';
    if (/\brecord\b/i.test(t)) return 'record';
    if (/round|series [ab]|milestone|investor/i.test(t)) return 'coin';
    if (/\baccounts?\b|contract|signed|churn|renew|buyers?\b/i.test(t)) return 'building';
    if (/cluster|compute|PF/.test(t)) return 'compute';
    if (/\bhir(e|es|ing)\b|headcount|laid off/i.test(t)) return 'hire';
    if (/project|complete|greenlit|started|cancelled|overran|failed/i.test(t)) return 'project';
    if (/trust/i.test(t)) return 'globe';
    return { flag: 'alert', due: 'clock', good: 'check', change: 'info' }[l.kind] || 'info';
  }
  const li = (cls, icon, html, right) => `<li class="${cls}">${ico(icon)}<span>${html}</span>${right ? `<b class="fp-w">${right}</b>` : ''}</li>`;
  // one delta: an arrow, the size, and a tone (goodUp true: up is good; false: up is bad; 'cap': capability blue)
  function dv(d, fmt, goodUp, eps) {
    if (d == null || !isFinite(d)) return '';
    if (Math.abs(d) < (eps || 0.05)) return '<span class="fp-dv">no change</span>';
    const up = d > 0, tone = goodUp === 'cap' ? 'cap' : goodUp == null ? '' : (up === goodUp ? 'good' : 'bad');
    return `<span class="fp-dv ${up ? 'up' : 'dn'} ${tone}">${ico('up')}${fmt(Math.abs(d))}</span>`;
  }
  // standing items with a date: the round offer, the milestone, projects, deals, the deal offer, installs, hires. `re` hides
  // the memo's own 'due' line on the same subject so nothing is said twice.
  function dueItems(s) {
    const out = [], T = s.turn, m = s.money;
    if (m.offer) out.push({ w: m.offer.expires - T + 1, icon: 'coin', re: /offer \(|lapses/i, text: `${esc(roundName(m.offer.round))} offer: ${kmoney(m.offer.amount)} for ${pct(m.offer.pct)}. Open until ${esc(when(m.offer.expires))}.` });
    if (m.milestone && !(m.offer && m.offer.round === m.milestone.round)) {
      const pr = tryr(() => FR.money.progress(s), null), cur = pr ? (m.milestone.kind === 'revenue' ? kmoney(pr.current) : n1(pr.current)) : '';
      const pc = pr && !pr.met ? paceOf(s, m.milestone) : null;
      out.push({ w: m.milestone.due - T, icon: 'record', re: /milestone due/i, text: `${esc(m.milestone.text)}${pr ? ` Now ${cur}${pr.met ? ', met' : ''}.` : ''}`
        + (pc ? ` At this pace ${n1(pc.projected)}${pc.short > 0 ? `, short by ${n1(pc.short)}` : ''}.` : '') });
    }
    // accounts: a fee that starts soon, a term that ends within 8 weeks (renews at mood 60 or more, else leaves)
    (accOf(s).active || []).forEach(a => {
      if (a.starts != null && a.starts > T) out.push({ w: a.starts - T, icon: 'building', re: /fee starts/i, text: `${esc(a.name)}: fee of ${kmoney(a.feePerWeek)} a week and ${trim1(a.pfPerWeek)} PF reserved from ${esc(when(a.starts))}.` });
      const left = a.ends - T + 1, K = AK();
      if (left <= 8) out.push({ w: left, icon: 'building', re: /renewal due|contract ends/i, text: `${esc(a.name)} contract ends ${esc(when(a.ends))}. Mood ${Math.round(a.mood)}: ${a.mood >= K.renewMood ? `renews at tier ${Math.min(3, a.tier + 1)} fees` : `leaves unless mood reaches ${K.renewMood}`}.` });
    });
    (s.projects.active || []).forEach((p, i) => out.push({ w: p.turnsLeft, icon: 'project', text: `${esc(p.name)} finishes in ${wks(p.turnsLeft)} (${esc(META('proj' + (i + 1)).name)}).` }));
    (s.compute.deals || []).forEach(d => out.push({ w: d.ends - T, icon: 'rival', re: /compute share ends/i, text: `${esc(rival(s, d.rivalId).name)} compute share ends ${esc(when(d.ends))}: ${d.pf} PF withdrawn.` }));
    const o = s.market.dealOffer;
    if (o) out.push({ w: o.expires - T + 1, icon: 'rival', re: /offers \d+ PF/i, text: `${esc(rival(s, o.rivalId).name)} offers ${o.pf} PF for ${o.turns} weeks at ${pct(o.revShare)} of revenue. Open until ${esc(when(o.expires))}.` });
    (s.compute.installing || []).forEach(x => out.push({ w: x.ready - T, icon: 'compute', text: `${esc(x.name)} cluster online ${esc(when(x.ready))}: ${x.pf} PF.` }));
    // hires: one row for the whole pipeline
    const hs = (s.staff.hiring || []).slice().sort((a, b) => a.arrives - b.arrives), hn = hs.reduce((t, x) => t + x.n, 0);
    if (hs.length === 1) out.push({ w: hs[0].arrives - T, icon: 'hire', text: `${hn} ${hn === 1 ? 'hire joins' : 'hires join'} ${esc(when(hs[0].arrives))}.` });
    else if (hs.length > 1) out.push({ w: hs[0].arrives - T, icon: 'hire', text: `${hn} hires join: ${hs.map(x => `${x.n} ${esc(when(x.arrives))}`).join(', ')}.` });
    return out.sort((a, b) => a.w - b.w);
  }
  // the one thing the memo points at next (a button that rides there), or null
  function nextStep(s) {
    if (!live(s)) return null;
    const hot = SK().map(k => [k, outlook(s, k)]).filter(x => x[1].level === 'critical' || x[1].level === 'warning').sort((a, b) => b[1].gap - a[1].gap)[0];
    if (hot) return { label: `Safety floor: ${SN(hot[0])} gap ${gapTxt(hot[1].gap)}`, icon: 'safety', go: 'safety.evals' };
    if (s.money.offer) return { label: `Boardroom: the ${roundName(s.money.offer.round)} offer`, icon: 'coin', go: 'boardroom.table' };
    if (s.market.dealOffer) return { label: `Boardroom: the ${rival(s, s.market.dealOffer.rivalId).name} offer`, icon: 'rival', go: 'boardroom.compute' };
    const f = fc(s); if (f && f.runway !== Infinity && f.runway < 13) return { label: `Boardroom: runway ${wks(Math.max(0, f.runway))}`, icon: 'coin', go: 'boardroom.table' };
    const ac = accOf(s), room = maxActive(s) - (ac.active || []).length;
    const can = room > 0 ? (ac.offers || []).filter(o => reqList(s, o).ok && s.money.cash >= signCost(o)).length : 0;
    if (can) return { label: `Serving: ${can} account ${can === 1 ? 'offer' : 'offers'} the lab qualifies for`, icon: 'building', go: 'serving.accounts' };
    const pj = s.projects; if (pj.active.length < pj.slots && pj.offers.some(o => o.tier <= s.research.tier)) return { label: 'Research: greenlight a project', icon: 'research', go: 'research.offers' };
    return null;
  }
  // the memo's account rows: contract fees within the week's revenue, and the book (count, average mood)
  function accRows(s) {
    const act = accOf(s).active || []; if (!act.length) return '';
    const sp = revSplitLast(s), mood = act.reduce((t, a) => t + (+a.mood || 0), 0) / act.length, hue = moodHue(mood);
    return `<tr><td>Of which contracts</td><td><b>${kmoney(sp.contracts)}</b></td><td></td></tr>
      <tr><td>Accounts · mood</td><td><b>${act.length} · <span class="tone-${hue === 'cap' ? 'cap' : hue}">${Math.round(mood)}</span></b></td><td></td></tr>`;
  }
  function memoHtml(s) {
    const m = s.memo || { turn: 0, lines: [] }; refTurn = m.turn || null;
    try { return memoBody(s, m); } finally { refTurn = null; }
  }
  function memoBody(s, m) {
    const T = m.turn || 0, rep = s.lastReport && s.lastReport.turn === T ? s.lastReport : null, d = rep && rep.deltas;
    const hist = s.history || [], cur = hist.length && hist[hist.length - 1].turn === T ? hist[hist.length - 1] : null;
    const prev = cur && hist.length > 1 && hist[hist.length - 2].turn === T - 1 ? hist[hist.length - 2] : null;
    const title = T > 0 ? `Year ${FR.year(T)} · Week ${FR.weekOfYear(T)} memo` : 'Year 1 · Founding memo';
    const lines = (m.lines || []).map(l => ({ kind: l.kind || 'change', text: String(l.text || '') }));
    const flagged = lines.filter(l => l.kind === 'flag' || ((l.kind === 'good' || l.kind === 'change') && FLAGGY.test(l.text)));
    const dueL = lines.filter(l => l.kind === 'due'), changed = lines.filter(l => l.kind !== 'due' && flagged.indexOf(l) < 0);
    let out = `<div class="wk fp fp-memo"><span class="kicker">${esc(s.lab.name)} · to the board</span><h3>${esc(title)}</h3>`;
    // decisions taken since this memo (the sim holds their lines in state.pendingMemo until End Turn); read-only
    const pend = (s.pendingMemo || []).filter(l => l && l.text);
    if (pend.length) out += sec('check', 'Decided this week', 'in the next memo') + `<ul class="wk-lines">${pend.map(l => li(l.kind === 'flag' ? 'flag' : l.kind === 'good' ? 'good' : 'change', lineIcon(l), esc(l.text))).join('')}</ul>`;
    // What changed: money, trust, then capability / safety / gap per skill
    const cash = cur ? cur.cash : s.money.cash, rev = cur ? cur.revenue : s.money.revenue, trust = cur ? cur.trust : s.market.trust;
    const burn = T > 0 ? (cur ? cur.burn : s.money.burn) : tryr(() => FR.money.burnEstimate(s), 0);
    const kf = (v) => kmoney(v), pf = (v) => n1(v);
    // cash against last week's close (or the founding cash), so rounds, clusters, fees and severance decided mid-week count
    const prevCash = prev ? prev.cash : T === 1 ? tryr(() => FR.money.K.startCash, null) : null;
    out += sec('trend', 'What changed', T > 0 ? 'since last week' : 'at founding');
    out += `<div class="fp-box"><table class="fp-dt"><tbody>
      <tr><td>Cash</td><td><b>${kmoney(cash)}</b></td><td>${dv(prevCash != null ? cash - prevCash : d ? d.cash : null, kf, true, 1)}</td></tr>
      <tr><td>Revenue a week</td><td><b>${kmoney(rev)}</b></td><td>${dv(prev ? rev - prev.revenue : null, kf, true, 1)}</td></tr>
      ${accRows(s)}
      <tr><td>Burn a week${T > 0 ? '' : ' (forecast)'}</td><td><b>${kmoney(burn)}</b></td><td>${dv(prev ? burn - prev.burn : null, kf, false, 1)}</td></tr>
      <tr><td>Public trust</td><td><b>${n1(trust)}</b></td><td>${dv(d ? d.trust : prev ? trust - prev.trust : null, pf, true)}</td></tr>
      </tbody></table></div>`;
    out += `<div class="fp-box"><table class="fp-dt"><thead><tr><th>Skill</th><th>Capability</th><th>Safety</th><th>Gap</th></tr></thead><tbody>${SK().map(k => {
      const sk = s.model.skills[k], dc = d && d.cap ? d.cap[k] : null, ds = d && d.safe ? d.safe[k] : null, g = Math.max(0, sk.cap - sk.safe);
      const g0 = dc != null && ds != null ? Math.max(0, (sk.cap - dc) - (sk.safe - ds)) : null, hue = gapHue(outlook(s, k));
      return `<tr><td>${ico(k)}${esc(SN(k))}</td><td><b class="tone-cap">${n1(sk.cap)}</b>${dv(dc, pf, 'cap')}</td><td><b class="tone-safe">${n1(sk.safe)}</b>${dv(ds, pf, true)}</td><td><b class="tone-${hue}">${gapTxt(g)}</b>${dv(g0 == null ? null : g - g0, pf, false)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    if (changed.length) out += `<ul class="wk-lines">${changed.map(l => li(l.kind === 'good' ? 'good' : 'change', lineIcon(l), esc(l.text))).join('')}</ul>`;
    // Flagged: warnings, incidents, rounds, records
    out += sec('alert', 'Flagged', flagged.length ? String(flagged.length) : '');
    out += flagged.length ? `<ul class="wk-lines">${flagged.map(l => li(l.kind === 'flag' ? 'flag' : 'good', lineIcon(l), esc(l.text))).join('')}</ul>` : '<p class="fp-none">Nothing flagged this week.</p>';
    // Due: dated items, then the memo's own due lines that no item already covers
    const items = dueItems(s), extra = dueL.filter(l => !items.some(it => it.re && it.re.test(l.text)));
    out += sec('clock', 'Due');
    out += items.length || extra.length ? `<ul class="wk-lines">${items.slice(0, 7).map(it => li('due', it.icon, it.text, wkS(it.w))).join('')}${extra.map(l => li('due', lineIcon(l), esc(l.text))).join('')}</ul>` : '<p class="fp-none">Nothing falls due.</p>';
    // the wire: this week's lines, newest first
    const wk = (s.news || []).filter(n => n.turn === T), wire = (wk.length ? wk : (s.news || [])).slice(-3).reverse();
    if (wire.length) out += sec('news', 'On the wire') + `<ul class="fp-news">${wire.map(newsItem).join('')}</ul>`;
    const nx = nextStep(s);
    out += `<div class="wk-stack">${nx ? `<button class="btn primary" data-fp="go" data-v="${esc(nx.go)}">${ico(nx.icon)}${esc(nx.label)}</button>` : ''}<button class="btn ${nx ? 'quiet' : 'primary'}" data-fp="noted" data-v="">${ico('check')}Noted</button></div></div>`;
    return out;
  }
  function memoRender(keep) {
    const s = S(); if (!s) return;
    const body = $('sheetBody'), sc = body ? body.scrollTop : 0, same = U.sheetId === 'memo';
    U.sheet(memoHtml(s), 'memo');   // throws on a bad state: FR.ui.openMemo (09_ui_hud.js) falls back to a plain list
    if (body) body.scrollTop = keep && same ? sc : 0;
  }
  U.memo = function () { memoRender(false); };

  // ---------- events ----------
  let busy = false;   // a handler is applying a command: its own render follows, so 'state:changed' does not render too
  function run(c, quiet) {
    busy = true; let r;
    try { r = (FR.cmd && FR.cmd.do) ? FR.cmd.do(c) : { ok: false, why: 'Commands are not wired' }; } finally { busy = false; }
    r = r || { ok: false };
    if (r.ok) { P.confirm = null; if (!quiet) sfx('confirm'); }
    render(true);
    return r;
  }
  const said = (r) => { if (r.ok && r.memo && r.memo.text) U.toast(r.memo.text, 3200, 'good'); };
  function handle(act, v) {
    const s = S(); if (!s) return;
    switch (act) {
      case 'tab': sfx('tap'); P.tab = v; P.confirm = null; P.focus = null; render(false); return;
      case 'nocf': sfx('tap'); P.confirm = null; render(true); return;
      case 'noted': sfx('tap'); U.sheet(null); return;
      case 'go': sfx('tap'); U.sheet(null); goTo(v); return;
      case 'target': if (s.target !== v) run({ type: 'target', skill: v }); return;
      case 'rent': run({ type: 'rent', pf: Math.round(+v) }); return;
      case 'hire': said(run({ type: 'hire', n: Math.max(1, Math.min(Math.round(+v) || 1, hireRoom(s))) })); return;
      case 'layoff': sfx('tap'); P.confirm = 'layoff:' + Math.max(1, Math.round(+v) || 1); render(true); return;
      case 'layoffOk': said(run({ type: 'layoff', n: Math.round(+v) })); return;
      case 'nudge': { const [k, d] = String(v).split(':'); if (s.sliders[k] == null) return; sfx('tap'); run(Object.assign({ type: 'sliders' }, link(s.sliders, k, s.sliders[k] + (+d || 0)))); return; }
      case 'retire': sfx('tap'); P.confirm = 'retire'; render(true); return;
      case 'retireOk': run({ type: 'retire' }); return;
      case 'accept': { const r = run({ type: 'acceptRound' }, true); if (r.ok) sfx('good'); said(r); return; }
      case 'decline': sfx('tap'); P.confirm = 'decline'; render(true); return;
      case 'declineOk': said(run({ type: 'declineRound' })); return;
      case 'dealOk': said(run({ type: 'acceptDeal' })); return;
      case 'dealNo': sfx('tap'); P.confirm = 'dealNo'; render(true); return;
      case 'dealNoOk': { const r = run({ type: 'declineDeal' }); if (r.ok) U.toast('Offer declined.', 2200); return; }
      case 'endDeal': sfx('tap'); P.confirm = 'end:' + v; render(true); return;
      case 'endDealOk': said(run({ type: 'endDeal', rivalId: v })); return;
      case 'buy': sfx('tap'); P.confirm = 'buy:' + v; render(true); return;
      case 'sign': {
        const o = (accOf(s).offers || []).find(x => x.id === v);
        busy = true; let r; try { r = FR.cmd && FR.cmd.signAccount ? FR.cmd.signAccount(v) : { ok: false }; } finally { busy = false; }
        r = r || { ok: false }; if (r.ok) { P.confirm = null; sfx('good'); } render(true);
        if (r.ok && o) U.toast(`Signed: ${o.name}, tier ${o.tier}. ${kmoney(o.feePerWeek)} a week from ${FR.dateLabel(s.turn + AK().startDelay)}; ${trim1(o.pfPerWeek)} PF reserved from then.`, 3800, 'good');
        return;
      }
      case 'accNo': sfx('tap'); P.confirm = 'accNo:' + v; render(true); return;
      case 'accNoOk': {
        const o = (accOf(s).offers || []).find(x => x.id === v);
        busy = true; let r; try { r = FR.cmd && FR.cmd.declineAccount ? FR.cmd.declineAccount(v) : { ok: false }; } finally { busy = false; }
        r = r || { ok: false }; if (r.ok) P.confirm = null; render(true);
        if (r.ok && o) U.toast(`Declined: ${o.name}.`, 2200);
        return;
      }
      case 'buyOk': said(run({ type: 'buy', offerId: v })); return;
      case 'gl': {
        const o = s.projects.offers.find(x => x.id === v), floor = 'proj' + (s.projects.active.length + 1);
        const r = run({ type: 'greenlight', offerId: v });
        if (r.ok && o) U.toast(`Greenlit: ${o.name}. ${o.turns} weeks, ${kmoney(o.cost)} in total. It runs on ${META(floor).name}.`, 3600, 'good');
        return;
      }
      case 'cancel': sfx('tap'); P.confirm = 'cancel:' + v; render(true); return;
      case 'cancelOk': { const p = s.projects.active.find(x => x.uid === v), r = run({ type: 'cancel', uid: v }); if (r.ok && p) U.toast(`Cancelled: ${p.name}. No refund.`, 3000); return; }
    }
  }
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-fp]'); if (!el || el.disabled || !mine()) return;
    e.stopPropagation(); handle(el.dataset.fp, el.dataset.v);
  });
  document.addEventListener('input', e => { const el = e.target; if (el && el.dataset && el.dataset.fps && mine()) dragTo(el.dataset.fps, +el.value); });
  document.addEventListener('change', e => { const el = e.target; if (el && el.dataset && el.dataset.fps && mine()) commitSliders(); });

  // re-render the open panel or memo in place, keeping the scroll (never mid-drag: it would drop the thumb)
  P.refresh = function () {
    if (!S() || drag) return;
    if (U.sheetId === 'memo') { try { memoRender(true); } catch (e) { console.error('memo refresh failed', e); } return; }
    if (U.sheetId && U.sheetId.indexOf('fp:') === 0 && P.floor) render(true);
  };
  FR.on('state:changed', () => { if (!busy) P.refresh(); });
  FR.on('turn:ended', () => { P.confirm = null; if (!busy) P.refresh(); });
  ['game:new', 'game:loaded'].forEach(ev => FR.on(ev, () => { P.floor = P.tab = P.focus = P.confirm = P.hotspot = null; drag = null; SL = null; }));
  FR.on('ui:sheet', d => { const id = d && d.id; if (!id || id.indexOf('fp:') !== 0) { drag = null; SL = null; P.confirm = null; } });
  P.debug = () => ({ floor: P.floor, tab: P.tab, focus: P.focus, confirm: P.confirm, hotspot: P.hotspot, sheet: U.sheetId, dragging: !!drag, sliders: !!SL });

  // ---------- the few panel rules the shell does not carry (tokens only) ----------
  (function css() {
    if ($('frPanelsCss')) return;
    const st = document.createElement('style'); st.id = 'frPanelsCss';
    st.textContent = [
      '.fp .fp-h{display:flex;align-items:center;gap:8px;margin:var(--sp-5) 0 var(--sp-2);font-size:var(--text-xs);font-weight:var(--w-bold);letter-spacing:var(--track-caps);text-transform:uppercase;color:var(--ink-3)}',
      '.fp .fp-h>.ico{width:16px;height:16px;color:var(--brand-text)}',
      '.fp .fp-h>span{flex:none}',
      '.fp .fp-h>em{flex:1;min-width:0;font-style:normal;font-weight:var(--w-medium);letter-spacing:0;text-transform:none;text-align:right;color:var(--ink-3)}',
      '.fp .card-head>.ico{flex:none;color:var(--brand-text)}',
      '.fp .card-head>.tip{flex:none}',
      '.fp .pl-kv,.fp .pl-note{align-items:flex-start}',
      '.fp .pl-kv>.ico,.fp .pl-note>.ico{margin-top:1px}',
      '.fp .pl-row .btn{flex:none;width:auto;margin:0}',
      '.fp .pl-money b.neg,.fp .pl-money-t b.neg{color:var(--bad)}.fp .pl-money b.pos,.fp .pl-money-t b.pos{color:var(--good)}',
      '.fp .pl-money>div>span{min-width:0}',
      '.fp .fp-big{font-size:var(--text-xl)}',
      '.fp .num,.fp-memo .num{white-space:nowrap}',
      '.fp .stat b.tone-warn{color:var(--warn)}',
      /* card kind and tier/status on a line above the title, so the title gets the full card width */
      '.fp .fp-cardk{display:flex;align-items:center;gap:8px;margin:0 0 4px}.fp .fp-cardk .badge{flex:none}',
      '.fp .fp-cardk+.card-head .card-title{overflow-wrap:break-word;hyphens:auto}',
      '.fp-jump{margin-top:0}.fp-jump .btn{font-family:var(--font-num)}',
      '.fp-rent .pl-step>span small{white-space:normal}',
      /* hire amounts in one row */
      '.fp-hire{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin:var(--sp-2) 0}',
      '.fp-hire .btn{margin:0;min-height:48px;padding:8px 6px;white-space:nowrap}',
      /* the pressure gauge (safety panel) */
      '.fp-press{padding-top:10px;padding-bottom:12px}',
      '.fp-press-h{display:flex;align-items:center;gap:8px;min-width:0}',
      '.fp-press-h>b{margin-left:auto;font-size:var(--text-xl);font-weight:var(--w-medium)}',
      '.fp-press-h>.badge{flex:none}',
      '.fp-pm{position:relative;margin:10px 0 2px}.fp-pm .meter{margin:0}',
      '.fp-pm>span{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--line-strong)}',
      /* linked sliders */
      '.fp-sliders{padding-top:10px;padding-bottom:10px}',
      '.fp-cardh{display:flex;align-items:center;gap:8px}',
      '.fp-cardh .fp-sum{margin-left:auto;font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-sl{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}',
      '.fp-cardh+.fp-sl{margin-top:2px;border-top:0}',
      '.fp-sl-h{display:flex;align-items:center;gap:8px;min-width:0}',
      '.fp-sl-n{display:flex;align-items:center;gap:6px;flex:none;font-size:var(--text-md);color:var(--ink-2)}',
      '.fp-sl-n .ico{width:18px;height:18px;color:var(--ink-3)}',
      '.fp-sl.own .fp-sl-n{color:var(--ink)}.fp-sl.own .fp-sl-n .ico{color:var(--brand-text)}',
      /* the PF · staff figures give way (ellipsis) before they ever run under the skill name */
      '.fp-sl-u{flex:0 1 auto;min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;font-size:var(--text-xs);color:var(--ink-3);text-align:right}',
      '.fp-sl-v{flex:none;min-width:46px;font-size:var(--text-lg);text-align:right}',
      '.fp-sl .pl-range{margin:0}',
      /* four sliders fill half the sheet: only the thumb takes a touch (a 44px disc around the 28px dot), so a vertical swipe
         across the track scrolls the sheet instead of jumping a share to wherever the finger landed */
      '.fp-sl .pl-range{--thumb:44px;pointer-events:none;touch-action:pan-y}',
      '.fp-sl .pl-range::-webkit-slider-thumb{pointer-events:auto;width:44px;height:44px;margin-top:-18px;border:8px solid transparent;background-clip:padding-box;box-shadow:inset 0 0 0 3px var(--rc),0 2px 8px rgba(0,0,0,.45)}',
      '.fp-sl .pl-range::-moz-range-thumb{pointer-events:auto;width:28px;height:28px;border:8px solid transparent;background-clip:padding-box;box-shadow:inset 0 0 0 3px var(--rc)}',
      '.fp-sl .pl-range:focus-visible::-webkit-slider-thumb{box-shadow:inset 0 0 0 3px var(--rc),0 0 0 3px var(--focus)}',
      '.fp-sl-f{margin:-8px 0 0;font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-3)}',
      '.fp-nudge{display:flex;gap:6px;margin:6px 0 0}.fp-nudge .btn{flex:1;width:auto;min-width:0;min-height:var(--tap);margin:0;padding:4px 6px;border-color:var(--line);font-variant-numeric:tabular-nums}',
      '.fp-sl-f b,.fp-sl-foot b{color:var(--ink)}',
      '.fp-sl-foot b.neg{color:var(--bad)}.fp-sl-foot b.pos{color:var(--good)}',
      '.fp-d{margin-left:6px;font-family:var(--font-num);font-size:var(--text-xs);font-weight:var(--w-medium)}',
      '.fp-sl-foot{margin:10px 0 0;padding-top:8px;border-top:1px solid var(--line);font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-3)}',
      '.fp-target .btn{flex-direction:column;gap:2px;min-height:56px;font-size:var(--text-sm)}',
      '.fp-target .btn .ico{width:20px;height:20px}',
      /* skill rows: two thin meters and the gap badge */
      '.fp-skills{padding-top:2px;padding-bottom:2px}',
      '.fp-skill{padding:10px 0}',
      '.fp-skill+.fp-skill{border-top:1px solid var(--line)}',
      '.fp-skill-h{display:flex;align-items:center;gap:8px;margin:0 0 6px}',
      '.fp-skill-h>.ico{flex:none;width:20px;height:20px;color:var(--ink-2)}',
      '.fp-skill.on .fp-skill-h>.ico{color:var(--brand-text)}',
      '.fp-skill-h>b{flex:1;min-width:0;font-size:var(--text-md)}',
      '.fp-skill-h .badge{flex:none}',
      '.fp-bar{display:grid;grid-template-columns:70px minmax(0,1fr) 38px 40px;align-items:center;gap:8px;min-height:22px;font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-bar .meter{height:6px;margin:0}',
      '.fp-bar>b{font-family:var(--font-num);font-size:var(--text-sm);font-weight:var(--w-medium);color:var(--ink);text-align:right}',
      '.fp-bar>em{font-family:var(--font-num);font-style:normal;text-align:right}',
      '.fp-out{margin:6px 0 0;font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-2)}',
      '.fp-out.warn{color:var(--warn)}.fp-out.bad{color:var(--bad)}',
      /* four small stats in a row */
      '.pl .stats.fp-st4{grid-template-columns:repeat(4,minmax(0,1fr))}',
      '.fp-st4 .stat{padding:6px 8px}.fp-st4 .stat b{font-size:var(--text-md)}',
      /* capacity split */
      '.fp-stack{display:flex;height:10px;margin:10px 0 0;border-radius:var(--r-pill);background:var(--sunken);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}',
      '.fp-stack>i{display:block;height:100%}',
      '.fp-stack>i.o,.fp-key.o{background:var(--cap)}.fp-stack>i.r,.fp-key.r{background:var(--gold)}.fp-stack>i.d,.fp-key.d{background:var(--info)}',
      '.fp-key{display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:2px;vertical-align:0}',
      /* the wire */
      '.fp-news{display:flex;flex-direction:column;gap:6px;margin:0 0 var(--sp-3);padding:0;list-style:none}',
      '.fp-news li{padding:10px 12px;border-radius:var(--r-md);background:var(--raised)}',
      '.fp-news li.incident{box-shadow:inset 3px 0 0 var(--bad)}',
      '.fp-news-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-news p{margin:4px 0 0;font-size:var(--text-md);line-height:var(--lh-snug);color:var(--ink)}',
      /* trust strip */
      '.fp-spark{display:flex;align-items:flex-end;gap:2px;height:52px;padding:4px;border-radius:var(--r-sm);background:var(--sunken)}',
      '.fp-spark>i{flex:1;min-width:0;height:calc(var(--h) * 1%);border-radius:2px 2px 0 0;background:var(--good)}',
      '.fp-spark>i.lo{background:var(--warn)}',
      '.fp-spark-l{display:flex;justify-content:space-between;margin:4px 0 0;font-size:var(--text-xs);color:var(--ink-3)}',
      /* rivals table header and the open record marks */
      '.fp-chh{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;padding:0 14px 4px 10px;font-size:var(--text-xs);font-weight:var(--w-bold);color:var(--ink-3)}',
      '.fp-chh>span:first-child{text-align:center}',
      '.fp .pl-cr.fp-open .pl-ct b{color:var(--ink-2)}',
      /* the memo */
      '.fp-memo .fp-box{margin:0 0 var(--sp-2);padding:2px 12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--raised)}',
      '.fp-dt{width:100%;border-collapse:collapse;font-size:var(--text-sm);color:var(--ink-2)}',
      '.fp-dt th{padding:8px 4px 6px;font-size:var(--text-xs);font-weight:var(--w-bold);color:var(--ink-3);text-align:right;white-space:nowrap}',
      '.fp-dt td{padding:7px 4px;border-top:1px solid var(--line);text-align:right;vertical-align:top;white-space:nowrap}',
      '.fp-dt tbody tr:first-child td{border-top:0}.fp-dt thead+tbody tr:first-child td{border-top:1px solid var(--line)}',
      '.fp-dt th:first-child,.fp-dt td:first-child{padding-left:0;text-align:left}',
      '.fp-dt th:last-child,.fp-dt td:last-child{padding-right:0}',
      '.fp-dt td:first-child{color:var(--ink);font-weight:var(--w-medium);vertical-align:middle}',
      '.fp-dt td:first-child .ico{width:16px;height:16px;margin-right:5px;color:var(--ink-3)}',
      '.fp-dt td b{display:block;font-family:var(--font-num);font-size:var(--text-md);font-weight:var(--w-medium);color:var(--ink)}',
      '.fp-dt td b.tone-cap{color:var(--cap)}.fp-dt td b.tone-safe{color:var(--safe)}.fp-dt td b.tone-warn{color:var(--warn)}.fp-dt td b.tone-bad{color:var(--bad)}.fp-dt td b.tone-good{color:var(--good)}',
      '.fp-dv{display:inline-flex;align-items:center;gap:2px;font-family:var(--font-num);font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-dv .ico{width:12px;height:12px}.fp-dv.dn .ico{transform:rotate(180deg)}',
      '.fp-dv.good{color:var(--good)}.fp-dv.bad{color:var(--bad)}.fp-dv.cap{color:var(--cap)}',
      '.fp-memo .wk-lines{margin:0 0 var(--sp-2)}',
      '.fp-memo .wk-lines li .fp-w{flex:none;margin-left:auto;padding-top:5px;font-family:var(--font-num);font-size:var(--text-sm);font-weight:var(--w-medium);color:var(--ink-2);white-space:nowrap}',
      '.fp-memo .wk-lines li.due>.ico{background:var(--warn-tint);color:var(--warn)}',
      '.fp-memo .fp-none{margin:0 0 var(--sp-2);font-size:var(--text-sm);color:var(--ink-3)}',
      '.fp-memo .fp-news li{background:transparent;border:1px solid var(--line)}',
      /* enterprise accounts (V0.3): the serving readout, the book, requirement lists on offer cards */
      '.fp-sl-r{margin:4px 0 0;font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-3)}.fp-sl-r b{color:var(--ink)}.fp-sl-r .neg{color:var(--bad)}',
      '.fp-split,.fp-contract{margin-top:var(--sp-2)}.fp-contract small{font-family:var(--font-ui);font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-accs{padding-top:2px;padding-bottom:2px}',
      '.fp-acc{padding:10px 0}.fp-acc+.fp-acc{border-top:1px solid var(--line)}',
      '.fp-acc-h{display:flex;align-items:center;gap:6px;min-width:0}',
      '.fp-acc-h>b{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md)}',
      '.fp-acc-h .badge{flex:none}',
      '.fp-acc-fee{flex:none;margin-left:auto;font-size:var(--text-md);font-weight:var(--w-medium);color:var(--gold)}.fp-acc-fee small{font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-acc-s{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:4px 0 6px;font-size:var(--text-sm);color:var(--ink-3)}.fp-acc-s .badge{flex:none}',
      '.fp-acc-m{display:grid;grid-template-columns:44px minmax(0,1fr) 30px;align-items:center;gap:8px;font-size:var(--text-xs);color:var(--ink-3)}',
      '.fp-acc-m .meter{height:6px;margin:0}.fp-acc-m>b{font-family:var(--font-num);font-size:var(--text-sm);font-weight:var(--w-medium);text-align:right}',
      '.fp-acc-w{display:flex;align-items:flex-start;gap:6px;margin:6px 0 0;font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--warn)}.fp-acc-w .ico{flex:none;width:16px;height:16px;margin-top:1px}',
      '.fp-req{display:flex;flex-direction:column;gap:4px;margin:10px 0 6px;padding:0;list-style:none}',
      '.fp-req li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:start;gap:8px;font-size:var(--text-sm);line-height:var(--lh-snug);color:var(--ink-2)}',
      '.fp-req li .ico{width:16px;height:16px;margin-top:2px}.fp-req li.ok .ico{color:var(--good)}.fp-req li.no .ico{color:var(--bad)}.fp-req li.no>span{color:var(--ink)}',
      '.fp-req li em{font-style:normal;font-size:var(--text-xs);color:var(--ink-3);text-align:right;padding-top:2px}.fp-req li.no em{color:var(--warn)}',
      '.fp-aoff .card-actions .btn{min-height:48px}',
      '.fp-aoff .fp-cardk .pl-kind{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.fp-alock .meter{margin-bottom:6px}'
    ].join('\n');
    document.head.appendChild(st);
  })();
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

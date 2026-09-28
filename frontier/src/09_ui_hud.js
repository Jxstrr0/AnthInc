// HUD (ported from Mogul ui/hud.js + the game menu of ui/week.js): top chips (Week, Cash + runway, Trust), the frontier
// strip, the bottom dock (Elevator, Memo, End Turn), the game menu, the Back chip and the tap-target router.
// Reader: reads FR.state, listens on the bus, changes the game only through FR.cmd.*.
//   FR.ui.refresh()        chips + strip from FR.state (after every command, End Turn, load)
//   FR.ui.updateEnd()      End Turn: disabled while the elevator rides (and with no run in play)
//   FR.ui.memoDot()        the dot on Memo while this week's memo is unread
//   FR.ui.meetDot()        the count on Company while a renewal meeting has no answer (V0.4)
//   FR.ui.openMemo()       FR.ui.memo() (09_ui_panels.js) or, without it, a plain memo sheet
//   FR.ui.gameMenu()       behind the top-right button: how to play, sound, reduce motion, save and quit
//   FR.ui.goFloor(id, fn)  ride there, then run fn once the doors open (at once when already there)
//   FR.ui.split(on?)       the revenue split card under the Cash chip (open market / contracts), once the lab has accounts
//   FR.ui.bind()           called once by 99_main.js at boot
// Router: 'hq:hotspot' {hotspotId} → 'elevator' opens FR.elevator.openPanel(), anything else FR.ui.panel(hotspotId).
(function (FR) {
  const U = FR.ui; if (!U || typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  const esc = U.esc, ico = (n) => U.icon(n), sfx = U.sfx;
  const RUNWAY_WARN = 13; // weeks: the cash chip's runway line turns warn below this (contracts_ui.md)
  const WIN = (FR.sim && FR.sim.K && FR.sim.K.winTurns) || 52;

  // ---------- chips ----------
  // weeks of cash at the forecast net burn, or Infinity when the lab is cash-positive
  U.runway = function (s) {
    s = s || FR.state; if (!s) return Infinity;
    try { return FR.sim.forecast(s).runway; } catch (e) { const net = (s.money && s.money.net) || 0; return net >= 0 ? Infinity : Math.floor(s.money.cash / -net); }
  };
  const last = { strip: null };
  U.refresh = function () {
    const s = FR.state; if (!s || !s.money) return;
    const wk = FR.weekOfYear(s.turn), yr = FR.year(s.turn);
    $('hudWeek').textContent = 'Week ' + wk; $('hudYear').textContent = 'Year ' + yr;
    $('hudWeekChip').setAttribute('aria-label', `Year ${yr}, Week ${wk}, ${s.lab ? s.lab.name : ''}`);
    const rw = U.runway(s), cash = $('hudCashChip');
    $('hudCash').textContent = U.kmoney(s.money.cash);
    $('hudRunway').textContent = rw === Infinity ? 'Cash-positive' : rw >= 104 ? '2+ yr runway' : Math.max(0, rw) + ' wk runway';
    cash.classList.toggle('warn', rw !== Infinity && rw < RUNWAY_WARN && rw >= 4);
    cash.classList.toggle('bad', rw !== Infinity && rw < 4);
    cash.setAttribute('aria-label', `Cash ${FR.fmtMoney(s.money.cash)}, ${rw === Infinity ? 'cash-positive' : Math.max(0, rw) + ' weeks of runway'}`);
    const tr = Math.round((s.market && s.market.trust) || 0), tc = $('hudTrustChip');
    $('hudTrust').textContent = String(tr); tc.classList.toggle('warn', tr < 35 && tr >= 20); tc.classList.toggle('bad', tr < 20);
    tc.setAttribute('aria-label', `Public trust ${tr} of 100`);
    U.strip(s); U.memoDot(); U.meetDot(); U.updateEnd();
    if (U.splitOpen()) { if (hasBook(s)) $('hudSplit').innerHTML = splitHtml(s); else U.split(false); }
  };
  // the frontier strip: your average capability vs the best rival's, and the safe-hold count n / 52 once it runs
  U.strip = function (s) {
    s = s || FR.state; const el = $('hudStrip'); if (!el || !s || !s.model) return;
    let html = '', label = '';
    try {
      const you = FR.sim.avgCap(s), b = FR.market.best(s), rv = (s.market.rivals || []).find(r => r.id === b.rivalId), d = you - b.avgCap;
      const hold = (s.win && s.win.streak) || 0, rname = rv ? rv.name : 'Best rival';
      // ahead but not holding: the widest gap past the safe margin is what blocks the 52-week hold
      const M = (FR.sim.K && FR.sim.K.safeMargin) || 5, worst = FR.SKILLS.reduce((b, k) => gapOf(s, k) > gapOf(s, b) ? k : b, FR.SKILLS[0]);
      const blocked = hold === 0 && d >= 0 && s.status === 'playing' && gapOf(s, worst) > M ? worst : null;
      html = `<span class="st-k">Frontier</span><span class="st-v st-you">You <b>${you.toFixed(1)}</b></span>`
        + `<span class="st-v st-riv"><span class="nm">${esc(rname)}</span> <b>${(+b.avgCap).toFixed(1)}</b></span>`
        + `<span class="st-gap ${d >= 0 ? 'good' : 'warn'}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}</span>`
        + (hold > 0 ? `<span class="st-hold">Hold <b>${hold}/${WIN}</b><i style="--v:${Math.min(100, Math.round(hold / WIN * 100))}"></i></span>`
          : blocked ? `<span class="st-hold st-block">Blocked <b>${esc(FR.SKILL_NAME[blocked])} ${Math.round(gapOf(s, blocked) * 10) / 10}</b></span>` : '');
      label = `Average capability: yours ${you.toFixed(1)}, ${rname} ${(+b.avgCap).toFixed(1)}.` + (hold > 0 ? ` Safe frontier hold ${hold} of ${WIN} weeks.`
        : blocked ? ` The safe hold has not started: ${FR.SKILL_NAME[blocked]} safety is more than ${M} below capability.` : '') + ' Opens the Rivals tab.';
    } catch (e) { html = ''; }
    if (html !== last.strip) { last.strip = html; el.innerHTML = html; el.classList.toggle('holding', /st-hold/.test(html)); el.classList.toggle('blocked', /st-block/.test(html)); if (label) el.setAttribute('aria-label', label); }
  };

  const gapOf = (s, k) => Math.max(0, s.model.skills[k].cap - s.model.skills[k].safe);

  // ---------- revenue split (V0.3): once the lab has contract revenue, a tap on the Cash chip drops a small card under the
  // chips with last week's revenue split into open market and contracts, next week's forecast split, and a button on to
  // the Boardroom Money tab. Before any account is signed the chip goes straight to the Money tab as before. ----------
  const hasBook = (s) => !!(s && s.accounts && (s.accounts.active || []).length);
  function splitHtml(s) {
    const L = U.revSplitLast ? U.revSplitLast(s) : { market: s.money.revenue, contracts: 0, total: s.money.revenue };
    const N = U.revSplit ? U.revSplit(s) : null, n = (s.accounts.active || []).length, km = U.kmoney;
    return `<div class="hs-h"><span>Revenue last week</span><b>${km(L.total)}</b></div>
      <div class="hs-r"><i class="k m"></i><span>Open market</span><b>${km(L.market)}</b></div>
      <div class="hs-r"><i class="k c"></i><span>Contracts · ${n} ${n === 1 ? 'account' : 'accounts'}</span><b>${km(L.contracts)}</b></div>
      <div class="hs-bar" role="img" aria-label="Open market ${km(L.market)}, contracts ${km(L.contracts)}"><i class="m" style="width:${L.total > 0 ? L.market / L.total * 100 : 0}%"></i><i class="c" style="width:${L.total > 0 ? L.contracts / L.total * 100 : 0}%"></i></div>
      ${N ? `<p class="hs-n">Next week <b>${km(N.total)}</b>: open market ${km(N.market)}, contracts ${km(N.contracts)}.</p>` : ''}
      <button class="btn small" id="hsMoney">${ico('boardroom')}<span>Boardroom money</span></button>`;
  }
  U.splitOpen = () => !!($('hudSplit') && $('hudSplit').classList.contains('on'));
  U.split = function (on) {
    let el = $('hudSplit'); const s = FR.state;
    if (on === undefined) on = !U.splitOpen();
    if (!on || !s || !hasBook(s)) { if (el) el.classList.remove('on'); document.body.classList.remove('hud-split-on'); const c = $('hudCashChip'); if (c) c.setAttribute('aria-expanded', 'false'); return false; }
    if (!el) {
      el = document.createElement('div'); el.id = 'hudSplit'; el.className = 'hud-split'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Revenue split');
      $('hud').appendChild(el);
      el.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('#hsMoney')) { sfx('tap'); U.split(false); route('boardroom.money'); } });
    }
    el.innerHTML = splitHtml(s); el.classList.add('on'); $('hudCashChip').setAttribute('aria-expanded', 'true');
    // under the Cash chip (landscape centres the chip row), kept on screen; the room's tags hide while the card is up
    const c = $('hudCashChip').getBoundingClientRect(), W = window.innerWidth, w = Math.min(360, W - 24);
    el.style.left = Math.round(Math.max(12, Math.min(c.left, W - w - 12))) + 'px'; el.style.right = 'auto'; el.style.width = w + 'px';
    document.body.classList.add('hud-split-on');
    return true;
  };

  // ---------- memo dot ----------
  let memoSeen = -1; // the memo.turn last opened this session (a new or loaded career starts unread)
  U.memoUnread = function () { const s = FR.state, m = s && s.memo; return !!(m && (m.lines || []).length && m.turn > memoSeen); };
  U.memoDot = function () {
    const b = $('hMemo'); if (!b) return; const on = U.memoUnread(), m = FR.state && FR.state.memo;
    const flag = on && (m.lines || []).some(l => l && l.kind === 'flag');
    b.classList.toggle('dot', on); b.classList.toggle('bad', flag);
    b.setAttribute('aria-label', on ? `Memo: ${flag ? 'unread, with flags' : 'unread'}` : 'Memo');
  };
  // V0.4: renewal meetings with no answer: a count badge on the Company dock button
  U.meetsUnanswered = function (s) {
    s = s || FR.state; if (!s || !s.accounts || !FR.accounts || typeof FR.accounts.meetings !== 'function') return 0;
    try { return FR.accounts.meetings(s).filter(a => a.meeting && a.meeting.answer == null).length; } catch (e) { return 0; }
  };
  U.meetDot = function () {
    const b = $('hOver'); if (!b) return; const n = U.meetsUnanswered();
    b.classList.toggle('meet', n > 0); if (n > 0) b.dataset.n = String(n); else delete b.dataset.n;
    b.setAttribute('aria-label', n > 0 ? `Company overview: ${n} renewal ${n === 1 ? 'meeting' : 'meetings'} unanswered` : 'Company overview');
  };
  U.markMemoRead = function () { const s = FR.state; if (s && s.memo) memoSeen = s.memo.turn; U.memoDot(); };
  // a plain memo sheet for builds without 09_ui_panels.js (the panels' FR.ui.memo replaces it)
  const MEMO_ICON = { change: 'info', flag: 'alert', due: 'clock', good: 'check' };
  function memoFallback() {
    const s = FR.state; if (!s) return; const m = s.memo || { turn: 0, lines: [] }, lines = m.lines || [], pend = (s.pendingMemo || []).filter(l => l && l.text);
    const when = m.turn > 0 ? FR.dateLabel(m.turn) : 'Founding';
    U.sheet(`<div class="wk wk-memo"><span class="kicker">${esc(when)}</span><h3>Weekly memo</h3>`
      + (lines.length ? `<ul class="wk-lines">${lines.map(l => `<li class="${esc(l.kind || 'change')}">${ico(MEMO_ICON[l.kind] || 'info')}<span>${esc(l.text)}</span></li>`).join('')}</ul>` : '<p class="wk-lead">No changes to report.</p>')
      + (pend.length ? `<p class="wk-lead">Decided this week, in the next memo:</p><ul class="wk-lines">${pend.map(l => `<li class="${esc(l.kind || 'change')}">${ico(MEMO_ICON[l.kind] || 'info')}<span>${esc(l.text)}</span></li>`).join('')}</ul>` : '')
      + `<div class="wk-stack"><button class="btn primary" id="memoOk">${ico('check')}Noted</button></div></div>`, 'memo');
    const b = $('memoOk'); if (b) b.addEventListener('click', () => { sfx('tap'); U.sheet(null); });
  }
  U.openMemo = function () {
    if (!FR.state || (FR.elevator && FR.elevator.riding)) return;
    if (typeof U.memo === 'function') { try { U.memo(); } catch (e) { console.error('memo sheet failed', e); memoFallback(); } } else memoFallback();
    U.markMemoRead();
  };

  // ---------- End Turn ----------
  U.endWhy = function () {
    const s = FR.state; if (!s) return 'no game';
    if (s.status !== 'playing') return 'over';
    if (FR.elevator && FR.elevator.riding) return 'riding';
    return null;
  };
  U.updateEnd = function () {
    const b = $('hEnd'); if (!b) return; const why = U.endWhy();
    b.disabled = !!why;
    const note = why === 'riding' ? 'Riding' : why === 'over' ? 'Run over' : '';
    const html = `<span class="l">End Turn</span>${note ? `<small class="why">${note}</small>` : ''}`;
    if (b._h !== html) { b._h = html; b.innerHTML = html; }
    b.setAttribute('aria-label', why === 'riding' ? 'End Turn (waiting for the elevator)' : why === 'over' ? 'End Turn (the run is over)' : `End Turn: resolve ${FR.state ? FR.dateLabel(FR.state.turn) : 'the week'}`);
  };

  // ---------- routing ----------
  // ride to a floor, then run fn once the doors open (at once when already there)
  U.goFloor = function (id, fn) {
    const cur = FR.r && FR.r.current; if (!cur || !FR.elevator) return;
    if (cur.id === id) { if (fn) fn(); return; }
    if (FR.elevator.riding) return;
    if (!FR.cmd.goFloor(id)) return;
    // the callback belongs to this ride only: a ride cancelled by quitting (FR.elevator.cancel bumps gen) drops it
    const gen = FR.elevator.gen;
    if (fn) { const h = (d) => { if (FR.elevator.gen !== gen) { FR.off('elevator:arrived', h); return; } if (!d || d.floorId !== id) return; FR.off('elevator:arrived', h); if (FR.inWorld && !FR.inWorld()) return; setTimeout(fn, 0); }; FR.on('elevator:arrived', h); }
  };
  // a hotspot with no panel (a build without 09_ui_panels.js, or an id it does not know): the floor's name and status line
  U.noPanel = function (id) {
    const fid = String(id || '').split('.')[0], m = (FR.HQ_FLOOR_META || {})[fid] || { name: fid || 'Panel' };
    const l = FR.elevator && FR.elevator.line ? FR.elevator.line(fid) : null;
    U.sheet(`<h3>${esc(m.name)}</h3>${l && l.text ? `<p class="hint">${esc(l.text)}</p>` : ''}<p>This panel is not in this build.</p>`, 'nopanel');
  };
  function route(id) {
    if (!id) return;
    if (id === 'elevator') { if (FR.elevator && FR.elevator.openPanel) FR.elevator.openPanel(); return; }
    if (typeof U.panel === 'function') { try { U.panel(id); } catch (e) { console.error('panel failed', id, e); U.noPanel(id); } }
    else U.noPanel(id);
  }
  U.route = route;

  // ---------- the in-game menu (#hMenu) ----------
  U.gameMenu = function () {
    // not mid-ride: quitting would strand the ride
    const s = FR.state; if (!s || (FR.elevator && FR.elevator.riding)) return; const st = FR.settings || {};
    const seg = (id, key, opts) => `<div class="seg" id="${id}" role="group">${opts.map(([v, n]) => `<button class="btn small${!!st[key] === v ? ' sel' : ''}" data-k="${key}" data-v="${v ? 1 : 0}" aria-pressed="${!!st[key] === v}">${n}</button>`).join('')}</div>`;
    const failed = !!U._saveFailed;
    U.sheet(`<div class="wk wk-menu"><span class="kicker">${esc(s.lab.name)} · ${esc(FR.dateLabel(s.turn))}</span><h3>Game menu</h3>
      <button class="row go wk-help" id="gmHelp">${ico('help')}<span class="row-t"><b>How to play</b><small>Sliders, projects, the warning ladder, winning and losing</small></span></button>
      <div class="wk-set"><div><b>Sound</b><small>Effects and ambience</small></div>${seg('gmSound', 'sound', [[true, 'On'], [false, 'Off']])}</div>
      <div class="wk-set"><div><b>Reduce motion</b><small>Fewer animations</small></div>${seg('gmMotion', 'reduceMotion', [[true, 'On'], [false, 'Off']])}</div>
      <p class="hint wk-saved${failed ? ' bad' : ''}">${ico(failed ? 'alert' : 'check')}${failed ? 'The last save failed. Free some browser storage, or copy a save code from Careers.' : 'The lab saves after every End Turn.'}</p>
      <div class="wk-stack"><button class="btn" id="gmQuit">${ico('exit')}Save and quit to the main menu</button><button class="btn primary" id="gmResume">${ico('play')}Keep playing</button></div></div>`, 'menu');
    document.querySelectorAll('#sheet .wk-set .seg .btn').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.k, v = el.dataset.v === '1';
      if (FR.menu && FR.menu.setSetting) FR.menu.setSetting(k, v); else if (FR.settings) FR.settings[k] = v;
      sfx('tap');
      el.parentNode.querySelectorAll('.btn').forEach(x => { const sel = x === el; x.classList.toggle('sel', sel); x.setAttribute('aria-pressed', sel); });
    }));
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', e => { e.stopPropagation(); sfx('tap'); fn(e); }); };
    on('gmHelp', () => { U.sheet(null); if (FR.menu && FR.menu.help) FR.menu.help('game'); });
    on('gmQuit', () => { U.sheet(null); FR.cmd.quit(); });
    on('gmResume', () => U.sheet(null));
  };
  // saves can fail (storage full or blocked): say so instead of staying silent
  U.saveWhy = (r) => /quota/i.test(String(r || '')) ? 'this browser’s storage is full' : /no storage/i.test(String(r || '')) ? 'this browser does not let the game store data' : 'the browser refused it';

  U.bind = function () {
    if (U._bound) return; U._bound = true;
    // Elevator glides to the doors, then the 'elevator' target opens the floor list (R.focus plays the tap)
    $('hElev').addEventListener('click', () => {
      if (!FR.elevator || FR.elevator.riding) return; const R = FR.r;
      if (R && R.target && R.target('elevator') && (!R.live || R.live('elevator')) && R.focus('elevator') !== false) return;
      sfx('tap'); FR.elevator.openPanel();
    });
    $('hBack').addEventListener('click', () => { sfx('tap'); if (FR.r && FR.r.back) FR.r.back(); });
    $('hMemo').addEventListener('click', () => { sfx('tap'); U.openMemo(); });
    // the company overview sheet (owner call, V0.3): every section, each with an Open that rides to its floor
    const ov = $('hOver'); if (ov) ov.addEventListener('click', () => { if (!FR.state || (FR.elevator && FR.elevator.riding) || typeof U.overview !== 'function') return; sfx('tap'); U.overview(); });
    // never behind a sheet: a key press on the focused End Turn under the memo must not resolve another week
    $('hEnd').addEventListener('click', () => { if (U.endWhy() || U.sheetId) return; FR.cmd.endTurn(); });
    // the chips and the strip open what they summarise: Cash the Money tab, Trust the lobby trust board, Week the memo,
    // the frontier strip the Rivals tab
    const chip = (id, label, fn) => { const el = $(id); if (!el) return; el.setAttribute('role', 'button'); el.tabIndex = 0; el.dataset.opens = label;
      const go = (e) => { if (!FR.state || U.sheetId || (FR.elevator && FR.elevator.riding)) return; e.stopPropagation(); sfx('tap'); fn(); };
      el.addEventListener('click', go); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } }); };
    chip('hudCashChip', 'money', () => { if (hasBook(FR.state)) U.split(); else route('boardroom.money'); });
    // the split card closes on any tap elsewhere, a sheet, a ride, End Turn or Escape
    // (a tap on the 3D view or a tag that closes the card is spent on closing it: it does not also glide to an object)
    document.addEventListener('pointerdown', e => {
      if (!U.splitOpen() || e.target.closest('#hudSplit,#hudCashChip')) return;
      U.split(false);
      if (e.target.closest('canvas,#tags')) e.stopPropagation();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && U.splitOpen()) U.split(false); });
    ['ui:sheet', 'elevator:ride', 'turn:ended', 'game:new', 'game:loaded'].forEach(ev => FR.on(ev, () => { if (U.splitOpen()) U.split(false); }));
    chip('hudTrustChip', 'trust', () => route('lobby.trust'));
    chip('hudWeekChip', 'memo', () => U.openMemo());
    chip('hudStrip', 'rivals', () => route('boardroom.rivals'));
    $('hMenu').addEventListener('click', () => { sfx('tap'); U.gameMenu(); });
    FR.on('hq:view', d => { if (d && d.mode !== 'room') U.hideHint(); });
    // tap-target router: R.focus plays the tap and glides first, so this only opens the matching panel
    FR.on('hq:hotspot', d => route(d && d.hotspotId));
    FR.on('game:save:failed', d => { U._saveFailed = true; sfx('error'); U.toast(`The lab was not saved: ${U.saveWhy(d && d.reason)}. Free some space, or copy a save code from Careers.`, 5000, 'bad'); });
    FR.on('game:saved', () => { U._saveFailed = false; });
    // a slider drag fires state:changed per input event: the chips redraw once per frame at most
    let rq = 0; const refreshSoon = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; U.refresh(); }); };
    FR.on('state:changed', refreshSoon);
    ['turn:ended', 'game:new', 'game:loaded'].forEach(e => FR.on(e, U.refresh));
    // a ride disables End Turn; re-enable it on arrival
    ['elevator:ride', 'elevator:arrived', 'ui:sheet'].forEach(e => FR.on(e, U.updateEnd));
    ['game:new', 'game:loaded'].forEach(e => FR.on(e, () => { memoSeen = -1; last.strip = null; U.memoDot(); U.meetDot(); }));
    // any sheet whose id names the memo marks this week's memo read (FR.ui.memo's own sheet included)
    FR.on('ui:sheet', d => { if (d && d.id && /memo/i.test(d.id)) U.markMemoRead(); });
    U.updateEnd();
  };
  const baseDebug = U.debug;
  U.debug = () => Object.assign(baseDebug ? baseDebug() : {}, { endTurn: U.endWhy() || 'ready', memoUnread: U.memoUnread(), meetBadge: U.meetsUnanswered(),
    chips: { week: ($('hudWeek') || {}).textContent, cash: ($('hudCash') || {}).textContent, runway: ($('hudRunway') || {}).textContent, trust: ($('hudTrust') || {}).textContent },
    strip: ($('hudStrip') || {}).textContent || '', panels: typeof U.panel === 'function', split: U.splitOpen() ? ($('hudSplit').innerText || '').replace(/\s+/g, ' ').trim() : null });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// Elevator (ported from Mogul render/elevator.js): the floor list sheet (nine floors top to bottom, one live status line
// each) and the ride sequence (doors close → fade → LED counts floors → next floor built behind the fade → chime → doors
// open → camera pulls back to the room view). Reader: reads FR.state only. Emits 'elevator:ride' {from, to} and
// 'elevator:arrived' {floorId}; FR.cmd.goFloor(id) calls FR.elevator.ride(id).
(function (FR) {
  const R = FR.r; const E = FR.elevator = { riding: false, rides: 0, floor: null, gen: 0 };   // gen: bumped by cancel()
  const order = FR.HQ_FLOORS, META = FR.HQ_FLOOR_META;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sfx = (n) => { try { if (FR.audio && FR.audio.play) FR.audio.play(n); } catch (e) { /* never blocks a ride */ } };
  const money = (n) => (FR.fmtMoney ? FR.fmtMoney(n || 0) : '$' + Math.round(n || 0));
  const wks = (n) => n + (n === 1 ? ' wk' : ' wks');
  const INCIDENT_TURNS = 3; // the serving floor stays dark this many turns after an incident (contracts_ui.md)

  // turn of the latest incident on any skill, or 0
  function lastIncident(s) {
    let t = 0; const sk = s.model && s.model.skills; if (!sk) return 0;
    for (let i = 0; i < FR.SKILLS.length; i++) { const l = (sk[FR.SKILLS[i]] && sk[FR.SKILLS[i]].incidents) || []; for (let j = 0; j < l.length; j++) if (l[j] > t) t = l[j]; }
    return t;
  }
  // weeks the serving floor stays dark after the latest incident (0 = lit). An incident on turn T darkens turns T+1..T+3.
  E.darkWeeks = function (s) { s = s || FR.state; if (!s) return 0; const t = lastIncident(s); return t ? Math.max(0, t + INCIDENT_TURNS + 1 - s.turn) : 0; };
  // the project in a project floor's slot (active projects fill the floors in order), or null
  E.projectOn = function (id, s) { s = s || FR.state; const m = META[id]; if (!s || !m || m.slot == null || !s.projects) return null; return (s.projects.active || [])[m.slot] || null; };
  function runway(s) {
    try { if (FR.sim && FR.sim.forecast) { const f = FR.sim.forecast(s); return f.runway; } } catch (e) { /* sim modules still loading: fall back */ }
    const net = s.money.net || 0; return net >= 0 ? Infinity : Math.floor(s.money.cash / -net);
  }

  // One line of live status for a floor: { text, tone: ''|'good'|'warn'|'bad', idle }. Numbers first, board-memo voice.
  E.line = function (id, s) {
    s = s || FR.state; const m = META[id]; if (!s || !m) return { text: '', tone: '', idle: false };
    try {
      const pct = m.alloc ? s.sliders[m.alloc] + '%' : '';
      switch (id) {
        case 'lobby': {
          const trust = 'Trust ' + Math.round(s.market.trust);
          if (E.darkWeeks(s) > 0) return { text: trust + ' · Press outside after the incident', tone: 'bad' };
          const wire = (s.news || []).filter(n => n.turn === s.turn - 1).length;
          return { text: trust + ' · ' + (wire ? wire + ' wire ' + (wire === 1 ? 'line' : 'lines') + ' this week' : 'Newswire, frontier record'), tone: '' };
        }
        case 'serving': {
          const rev = s.money.revenue > 0 ? money(s.money.revenue) + ' a week' : 'No revenue yet', dark = E.darkWeeks(s);
          if (dark > 0) return { text: pct + ' · ' + rev + ' · Incident review, ' + wks(dark) + ' left', tone: 'bad' };
          return { text: pct + ' · ' + rev, tone: '' };
        }
        case 'training': {
          const sk = s.target, cap = s.model.skills[sk] ? Math.round(s.model.skills[sk].cap) : 0;
          return { text: pct + ' · ' + FR.SKILL_NAME[sk] + ' run · capability ' + cap, tone: '' };
        }
        case 'safety': {
          let worst = null, gap = 0;
          FR.SKILLS.forEach(k => { const g = s.model.skills[k].cap - s.model.skills[k].safe; if (g > gap) { gap = g; worst = k; } });
          if (!worst || gap < 0.5) return { text: pct + ' · No open gaps', tone: 'good' };
          const ol = FR.model && FR.model.outlook ? FR.model.outlook(s, worst) : null, lv = ol && ol.level;
          const tag = lv === 'critical' ? ' · Critical' : lv === 'warning' ? ' · Warning' : lv === 'watch' ? ' · Watch' : '';
          return { text: pct + ' · ' + FR.SKILL_NAME[worst] + ' gap ' + Math.round(gap) + tag, tone: lv === 'critical' || gap > 20 ? 'bad' : lv === 'warning' || gap > 10 ? 'warn' : '' };
        }
        case 'research': {
          const r = s.research || { tier: 1, points: 0 }, offers = (s.projects && s.projects.offers || []).length;
          return { text: pct + ' · Tier ' + r.tier + ' · ' + offers + (offers === 1 ? ' offer' : ' offers') + ' on the board', tone: '' };
        }
        case 'boardroom': {
          const rw = runway(s), cash = 'Cash ' + money(s.money.cash);
          const rwt = rw === Infinity ? 'cash-positive' : wks(Math.max(0, rw)) + ' runway';
          const offer = s.money.offer ? ' · ' + (s.money.offer.round === 'seed' ? 'Seed' : 'Series ' + String(s.money.offer.round).toUpperCase()) + ' offer open' : '';
          return { text: cash + ' · ' + rwt + offer, tone: rw !== Infinity && rw < 13 ? 'warn' : '' };
        }
      }
      if (m.slot != null) {
        const slots = s.projects ? s.projects.slots : 3;
        if (m.slot >= slots) return { text: 'Closed', tone: '', idle: true };
        const p = E.projectOn(id, s);
        if (!p) return { text: 'Available', tone: '', idle: true };
        return { text: p.name + ' · ' + wks(p.turnsLeft) + ' left' + (p.overrun ? ' · Overrun' : ''), tone: p.overrun ? 'warn' : '' };
      }
    } catch (e) { /* a sim module not ready: the row shows no status rather than breaking the sheet */ }
    return { text: '', tone: '', idle: false };
  };

  // status accents for the rows (the ported .floor row CSS lives in the shell; these classes are this module's own)
  function style() {
    if (document.getElementById('fr-elevator-style')) return;
    const st = document.createElement('style'); st.id = 'fr-elevator-style';
    st.textContent = '.floors .floor .s{font-variant-numeric:tabular-nums}.floors .floor .s .tn-good{color:var(--good,#5fcf9a)}' +
      '.floors .floor .s .tn-warn{color:var(--warn,#f0a24a)}.floors .floor .s .tn-bad{color:var(--bad,#ef6b5b)}' +
      '#sheet .elev-h{position:sticky;top:calc(var(--sheet-head) - var(--sheet-pad-top));z-index:3;margin:0 calc(-1 * var(--sheet-pad-x)) 8px;padding:4px 52px 8px var(--sheet-pad-x);background:var(--surface)}' +
      '#sheet.scrolled .elev-h{border-bottom:1px solid var(--line)}' +
      '.floors .floor.idle{background:transparent;border-style:dashed;box-shadow:none}.floors .floor.idle .n{background:transparent;color:var(--ink-3,#97a5b4)}';
    document.head.appendChild(st);
  }
  const noView = () => R.stub || !R.renderer;   // no 3D view: a tap on a row opens that floor's panel at once
  function rowsHtml() {
    const here = (R.current && R.current.id) || E.floor;
    return order.slice().reverse().map(id => {
      const m = META[id], l = E.line(id), cls = 'floor' + (id === here ? ' here' : '') + (l.idle ? ' idle' : '') + (l.tone ? ' tone-' + l.tone : '');
      const sub = (id === here ? 'You are here · ' : '') + (l.tone ? `<span class="tn-${l.tone}">${esc(l.text)}</span>` : esc(l.text));
      return `<div class="${cls}" data-f="${id}" role="button" tabindex="0" aria-label="${esc('Floor ' + m.n + ', ' + m.name + '. ' + l.text)}"><div class="n">${m.n}</div><div class="t">${esc(m.name)}<div class="s">${sub}</div></div></div>`;
    }).join('');
  }
  function bindRows(root) {
    const here = (R.current && R.current.id) || E.floor;
    root.querySelectorAll('[data-f]').forEach(el => {
      const go = () => { const f = el.dataset.f; if (f !== here || noView()) E.ride(f); else FR.ui.sheet(null); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  E.openPanel = function () {
    if (!FR.ui || !FR.ui.sheet || E.riding) return;
    style();
    FR.ui.sheet(`<h3 class="elev-h">Elevator</h3><div class="floors" id="elevFloors">${rowsHtml()}</div>`, 'elevator');
    const box = document.getElementById('elevFloors'); if (!box) return; bindRows(box);
    // nine rows outgrow a phone sheet: bring the current floor into view (the sheet body scrolls)
    // (set scrollTop on the body itself: scrollIntoView would also scroll the overflow:hidden sheet frame)
    const h = box.querySelector('.here'), sc = document.getElementById('sheetBody') || box.parentElement;
    // (only when more of the row is hidden than the heading is tall: a lobby row cut by a few px stays put, and the
    // "Elevator" heading stays clear of the grab handle)
    if (h && sc) { const r = h.getBoundingClientRect(), cr = sc.getBoundingClientRect(), hd = box.previousElementSibling, hh = hd ? hd.getBoundingClientRect().height + 12 : 40;
      if (r.bottom - cr.bottom > hh) sc.scrollTop += r.bottom - cr.bottom + 12; }
  };
  // the open elevator sheet re-renders its rows in place after a command or End Turn (no reopen, no sound)
  function refreshOpen() {
    if (!FR.ui || FR.ui.sheetId !== 'elevator') return; const box = document.getElementById('elevFloors'); if (!box) return;
    box.innerHTML = rowsHtml(); bindRows(box);
  }
  FR.on('state:changed', refreshOpen); FR.on('turn:ended', refreshOpen);

  function led(txt, arrive) { if (FR.ui && FR.ui.led) FR.ui.led(txt, arrive); }
  function fadeEl() { return document.getElementById('fade'); }
  function setDoors(ev, open) { if (!ev || !ev.doors) return; ev.doors[0].position.x = ev.x - 0.5 - open * 0.9; ev.doors[1].position.x = ev.x + 0.5 + open * 0.9; }

  // stop a ride under way (quit to the menu, the end screen, a new lab): it never loads, unpauses or emits
  E.cancel = function () {
    E.gen++; if (!E.riding) return;
    E.riding = false; const f = fadeEl(); if (f) f.style.opacity = '0';
    const l = document.getElementById('ledOverlay'); if (l) l.style.display = 'none';
    if (FR.ui && FR.ui.updateEnd) FR.ui.updateEnd();
  };
  E.ride = function (to) {
    if (E.riding || !META[to]) return false;
    if (noView()) {   // no renderer: arrive at once and open the floor's panel (the elevator sheet becomes the floor menu)
      const from = E.floor; try { R.loadFloor(to); } catch (e) { /* stub */ } E.floor = to;
      FR.emit('elevator:ride', { from, to }); FR.emit('elevator:arrived', { floorId: to });
      if (FR.ui && FR.ui.panel) FR.ui.panel(to);
      return true;
    }
    if (!R.current) { R.loadFloor(to); E.floor = to; R.paused = false; FR.emit('elevator:arrived', { floorId: to }); return true; }
    const from = R.current.id; if (from === to) { if (FR.ui && FR.ui.sheetId) FR.ui.sheet(null); return false; }
    E.riding = true; E.rides++; const gen = ++E.gen, gone = () => gen !== E.gen;
    if (FR.ui && FR.ui.sheet) FR.ui.sheet(null);
    R.paused = true; FR.emit('elevator:ride', { from, to });
    const ev = R.current.elevator, fade = fadeEl();
    // step 1: glide to the doors (already there when the ride starts from the elevator focus) while they close (0.5s)
    R.setMode('ride'); R.glideTo(R.poseOf('elevator') || R.view, 450);
    const t0 = performance.now(); sfx('doors');
    const fi = order.indexOf(from), ti = order.indexOf(to); const steps = Math.abs(ti - fi); const dir = ti > fi ? 1 : -1;
    let stepI = 0, lit = false; const rideMs = Math.max(700, Math.min(1600, 300 + steps * 250));
    function anim() {
      if (gone()) return;
      const t = performance.now() - t0;
      if (t < 500) { requestAnimationFrame(anim); return; }
      if (t < 600) { if (fade) fade.style.opacity = '1'; if (!lit) { lit = true; led(META[from].n); } requestAnimationFrame(anim); return; }
      if (t < 600 + rideMs) {
        const k = (t - 600) / rideMs; const want = Math.floor(k * steps);
        if (want > stepI) { stepI = want; sfx('tick'); led(META[order[fi + dir * stepI]].n); }
        requestAnimationFrame(anim); return;
      }
      // arrive: build the new floor behind the fade, chime, open doors
      try { R.loadFloor(to); } catch (e) { console.error('elevator arrive', to, e); }
      const ev2 = R.current && R.current.elevator;
      R.snap(R.poseOf('elevator') || R.view); setDoors(ev2, 0);
      led(META[to].n, true); sfx('chime'); if (fade) fade.style.opacity = '0';
      const t1 = performance.now();
      (function open() { if (gone()) return; const k = Math.min(1, (performance.now() - t1) / 500); setDoors(ev2, k);
        // doors open: pull back from the doors to the floor's room view, then hand control back (paused while a sheet is up
        // or the world is not on screen)
        if (k < 1) requestAnimationFrame(open); else { R.home(700); E.riding = false; R.paused = !!(FR.ui && FR.ui.sheetId) || !(FR.inWorld ? FR.inWorld() : true); E.floor = to; FR.emit('elevator:arrived', { floorId: to }); } })();
    }
    // the from-floor doors were open; animate them closing to the centre
    (function close() { const k = Math.min(1, (performance.now() - t0) / 450); setDoors(ev, 1 - k); if (k < 1) requestAnimationFrame(close); })();
    requestAnimationFrame(anim);
    return true;
  };
  // doors start open on every floor; the LED over the doors shows this floor
  FR.on('hq:floor', ({ floorId }) => {
    const ev = R.current && R.current.elevator; E.floor = floorId; if (!ev) return;
    if (!E.riding) setDoors(ev, 1);
    if (ev.led && META[floorId]) R.setText(ev.led, [META[floorId].n], R.LED);
  });
  E.debug = () => ({ riding: E.riding, rides: E.rides, floor: E.floor, lines: FR.state ? order.map(id => id + ': ' + E.line(id).text) : [] });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// Boot, commands, wiring (ported from Mogul 99_main.js). The only writer of FR.state outside the sim: every change goes
// through FR.cmd.*, which runs the pure sim (FR.sim.applyCommands / FR.sim.endTurn), swaps FR.state and tells the bus.
//   FR.cmd.newCareer({ labName, slot })  load(slot)  save()  quit()  exportCode()  importCode(code, slot)
//   FR.cmd.do(command) → {ok, why}      apply one command now (sliders, rent, greenlight...): 'state:changed', toast on failure
//   FR.cmd.endTurn()                     resolve the week: emit report.events, 'turn:ended'; autosave; open the memo;
//                                        on won/dead/exited → the end-of-run screen
//   FR.cmd.goFloor(floorId)              elevator ride
//   FR.cmd.signAccount(id)  FR.cmd.declineAccount(id)   an enterprise account offer (V0.3), through FR.cmd.do
//   FR.enterWorld(floorId)  FR.inWorld()  FR.debug()
// The HQ floor the player last rode to is kept in the save as state.hq = { floor } (written on 'elevator:arrived', read on
// load; an older save without it opens in the lobby). The sim carries the field through clone untouched.
// Events emitted here: 'game:new' {state}, 'game:loaded' {state}, 'state:changed' {command}, 'turn:ended' {turn, report},
// and every report.events item as its own type (model:*, money:*, compute:*, project:*, research:*, market:*, run:*).
(function (FR) {
  const U = FR.ui;
  const DEFAULT_LAB = 'Prairie Blue Labs';
  const clampSlot = (n) => Math.max(0, Math.min(((FR.save && FR.save.SLOTS) || 3) - 1, Math.round(+n) || 0));
  // the saved HQ floor if it is a floor this build knows, else the lobby
  const savedFloor = (s) => { const f = s && s.hq && s.hq.floor; return f && FR.HQ_FLOOR_META && FR.HQ_FLOOR_META[f] ? f : 'lobby'; };
  let busy = false, saveTimer = 0;
  // a slider drag or a run of taps writes once, 1.5 s after the last change (End Turn and page hide save at once)
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (FR.inWorld()) FR.cmd.save(); }, 1500); }

  FR.cmd = {
    newCareer(opts) {
      opts = opts || {};
      const labName = String(opts.labName || '').replace(/\s+/g, ' ').trim().slice(0, 28) || DEFAULT_LAB, slot = clampSlot(opts.slot);
      // the seed is the one place the UI picks randomness; the sim itself stays pure and replays from state.rngState
      const seed = ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) || 1;
      FR.state = FR.sim.newGame({ seed, labName, slot });
      if (!FR.state.hq) FR.state.hq = { floor: 'lobby' };
      FR.cmd.save();
      FR.emit('game:new', { state: FR.state });
      FR.enterWorld('lobby');
      U.toast(`Welcome to ${FR.state.lab.name}. The boardroom has a seed offer. Set your sliders, then End Turn.`, 5000);
      return FR.state;
    },
    load(slot) {
      const n = clampSlot(slot), s = FR.save.read(n); if (!s) { U.toast(`Slot ${n + 1} could not be read.`, 3000, 'bad'); return false; }
      s.slot = n; FR.state = s;
      FR.emit('game:loaded', { state: s });
      if (s.status !== 'playing') { FR.menu.end(); return true; } // an ended run is a record: its result, then a new lab
      FR.enterWorld(savedFloor(s));
      U.toast(`${s.lab.name}. ${FR.dateLabel(s.turn)}.`, 2400);
      return true;
    },
    save() { if (!FR.state) return false; clearTimeout(saveTimer); return FR.save.write(FR.state.slot, FR.state); },
    // save, then back to the main menu (the menu restarts the title tower)
    quit() {
      const ok = FR.state ? FR.cmd.save() !== false : true;
      if (U.sheetId) U.sheet(null);
      FR.menu.open();
      U.toast(ok ? 'Lab saved. Tap Continue to pick it up again.' : `The lab was not saved: ${U.saveWhy ? U.saveWhy(null) : 'the browser refused it'}. The last saved week is still there.`, ok ? 2600 : 5000, ok ? '' : 'bad');
      return ok;
    },
    exportCode() { return FR.state ? FR.save.exportCode(FR.state) : ''; },
    // writes an imported lab into `slot` (never the slot inside the code) and returns {ok, why, slot, lab}. It does not
    // load it: the careers screen shows it with Continue.
    importCode(code, slot) {
      const s = FR.save.importCode(String(code == null ? '' : code).replace(/\s+/g, ''));
      if (!s || !s.lab || s.turn == null || !s.money) return { ok: false, why: 'This code is damaged or cut short. Copy the whole code and try again.' };
      const n = clampSlot(slot == null ? (FR.state ? FR.state.slot : 0) : slot); s.slot = n;
      if (!FR.save.write(n, s)) return { ok: false, why: 'This device would not store the save. Free some space and try again.' };
      if (FR.state && FR.state.slot === n && !FR.inWorld()) FR.state = null; // the menu's stale copy of that slot
      return { ok: true, slot: n, lab: s.lab.name };
    },
    // apply one command at once (no time passes). Failure: a toast with the sim's reason, state unchanged.
    // The result's `event` is not emitted here: the sim queues it in state.pendingEvents and End Turn emits it with the
    // week's report.events (its `memo` line likewise waits in state.pendingMemo for the next memo).
    do(command) {
      const s = FR.state; if (!s) return { ok: false, why: 'No lab is loaded' };
      let r;
      try { r = FR.sim.applyCommands(s, [command]); } catch (e) { console.error('command failed', command, e); r = null; }
      const res = (r && r.results && r.results[0]) || { ok: false, why: 'The command could not be applied' };
      if (res.ok) { FR.state = r.state; FR.emit('state:changed', { command }); saveSoon();
        if (FR.state.status !== 'playing') { FR.cmd.save(); if (U.sheetId) U.sheet(null); setTimeout(() => { if (FR.state && FR.state.status !== 'playing') FR.menu.end(); }, 300); } }
      else { U.sfx('error'); U.toast('Not done: ' + String(res.why || 'unknown reason').replace(/\.$/, '') + '.', 3200, 'bad'); }
      return res;
    },
    // enterprise accounts (V0.3): sign or decline an offer on the Serving floor's board; both wrap FR.cmd.do
    signAccount(id) { return FR.cmd.do({ type: 'signAccount', id }); },
    declineAccount(id) { return FR.cmd.do({ type: 'declineAccount', id }); },
    // why End Turn cannot run now, or null
    blocked() { return U.endWhy ? U.endWhy() : (!FR.state ? 'no game' : null); },
    endTurn() {
      const s = FR.state; if (!s || busy) return false;
      if (FR.elevator && FR.elevator.riding) return false;
      if (s.status !== 'playing') { FR.menu.end(); return false; }
      busy = true;
      try {
        if (U.sheetId) U.sheet(null);
        const next = FR.sim.endTurn(s, []);
        FR.state = next;
        const report = next.lastReport || { turn: s.turn, events: [], memo: [], news: [] };
        (report.events || []).forEach(e => { if (e && e.type) FR.emit(e.type, e); });
        FR.emit('turn:ended', { turn: report.turn, report });
        FR.cmd.save();
        if (next.status !== 'playing') setTimeout(() => { if (FR.state === next) FR.menu.end(); }, 1200); // let the week's cue land first
        else if (U.openMemo) U.openMemo();
      } catch (e) {
        console.error('End Turn failed', e); U.sfx('error');
        U.toast('The week could not be resolved. The lab is unchanged.', 4000, 'bad');
      } finally { setTimeout(() => { busy = false; if (U.updateEnd) U.updateEnd(); }, 350); }
      return true;
    },
    goFloor(id) { return FR.elevator ? FR.elevator.ride(id) : false; }
  };

  FR.enterWorld = function (floor) {
    if (FR.elevator && FR.elevator.cancel) FR.elevator.cancel();   // a ride from the last lab never lands in this one
    if (U.sheetId) U.sheet(null);                                   // nor does a sheet it left open
    if (FR.title) FR.title.stop(); // frees the title scene before the floor builds
    U.show(null); U.hud(true); U.refresh(); if (U.updateEnd) U.updateEnd();
    try { FR.r.loadFloor(floor || 'lobby'); } catch (e) { console.error('floor load failed', floor, e); }
    FR.r.paused = !!U.sheetId;
    if (FR.audio) { if (FR.audio.bedStart) FR.audio.bedStart(); if (FR.audio.bedTint) FR.audio.bedTint(floor || 'lobby'); }
  };
  // autosave only while playing: after Save and quit the menu may import into or delete the slot FR.state came from
  FR.inWorld = () => !!(FR.state && FR.state.status === 'playing' && document.getElementById('hud') && document.getElementById('hud').classList.contains('on'));
  // remember the floor in the save (the next load opens there); the ride's own save waits for the usual debounce
  FR.on('elevator:arrived', (d) => {
    const f = d && d.floorId, s = FR.state; if (!f || !s || !FR.inWorld() || (s.hq && s.hq.floor === f)) return;
    s.hq = { floor: f }; saveSoon();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && FR.inWorld()) FR.cmd.save(); });
  window.addEventListener('pagehide', () => { if (FR.inWorld()) FR.cmd.save(); });

  const safe = (fn) => { try { return fn(); } catch (e) { return { error: String(e && e.message || e) }; } };
  FR.debug = () => ({
    version: FR.VERSION,
    sim: FR.state ? safe(() => FR.sim.debug(FR.state)) : null,
    world: FR.r && FR.r.debug ? safe(() => FR.r.debug()) : null,
    title: FR.title && FR.title.debug ? safe(() => FR.title.debug()) : null,
    elevator: FR.elevator && FR.elevator.debug ? safe(() => FR.elevator.debug()) : null,
    ui: U.debug ? safe(() => U.debug()) : null,
    audio: FR.audio && FR.audio.debug ? safe(() => FR.audio.debug()) : null,
    bus: FR.busDebug ? FR.busDebug() : null
  });

  function boot() {
    document.querySelectorAll('.ver').forEach(v => { v.textContent = 'V' + FR.VERSION; });
    try { FR.r.init(document.getElementById('game')); } catch (e) {
      // no WebGL: the same stub as a build without three.js (the elevator arrives at once and opens the floor's panel)
      console.error('HQ view failed to start (WebGL?)', e);
      if (FR.rStub) FR.rStub(FR.r);
      if (FR.title) FR.title.start = FR.title.stop = FR.title.restart = function () {};
    }
    U.bind(); FR.menu.bind();
    // the title tower plays behind the boot and menu screens (FR.menu.open restarts it after Save and quit)
    FR.r.paused = true; if (FR.title) FR.title.start();
    FR.menu.ticker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.FR);

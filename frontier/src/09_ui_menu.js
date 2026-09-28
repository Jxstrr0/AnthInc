// Boot and menu screens (ported from Mogul ui/menu.js): boot, main menu (Continue, New career, Careers, How to play,
// Settings, Credits), new career (lab name + slot), careers (3 slots: continue / copy a save code / delete with an inline
// confirm; import a code into a chosen slot), settings (sound, reduce motion), how to play, credits, and the end-of-run
// screen (FR.sim.score, the cause, the frontier record, "Found a new lab"). Reader: reads FR.state and the save slots,
// changes the game only through FR.cmd.*.
//   FR.settings { sound, reduceMotion, hints }  persisted in localStorage 'frontier.settings' (shared with 10_audio.js)
//   FR.saveSettings()   FR.menu.{ open, bind, ticker, help(from), careers(), settings(), newCareer(slot?), end(), setSetting(k, v) }
(function (FR) {
  const U = FR.ui; if (!U || typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  const esc = U.esc, ico = (n) => U.icon(n), sfx = U.sfx;

  // ---------- settings (sound is off by default; the choice persists) ----------
  const KEY = 'frontier.settings';
  FR.settings = { sound: false, reduceMotion: false, hints: {} };
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) Object.assign(FR.settings, o); } catch (e) { /* private mode: defaults */ }
  if (!FR.settings.hints || typeof FR.settings.hints !== 'object' || Array.isArray(FR.settings.hints)) FR.settings.hints = {};
  FR.settings.sound = !!FR.settings.sound; FR.settings.reduceMotion = !!FR.settings.reduceMotion;
  function applyMotion() { document.body.classList.toggle('reduce-motion', !!FR.settings.reduceMotion); }
  applyMotion();
  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(FR.settings)); } catch (e) { /* full or blocked: the setting still holds this session */ }
    if (FR.audio && FR.audio.setEnabled) FR.audio.setEnabled(!!FR.settings.sound, false);
    applyMotion();
  }
  FR.saveSettings = saveSettings;

  // ---------- save slots ----------
  const N = (FR.save && FR.save.SLOTS) || 3, ALL = Array.from({ length: N }, (_, i) => i);
  const info = (i) => { try { return FR.save.info(i); } catch (e) { return null; } };
  const playing = (inf) => !!inf && (!inf.status || inf.status === 'playing');
  function status(inf) {
    if (!inf) return 'Empty';
    const when = FR.dateLabel(inf.turn || 1);
    if (inf.status === 'won') return 'Held the frontier · ' + when;
    if (inf.status === 'dead') return 'Closed · ' + when;
    if (inf.status === 'exited') return (inf.cause === 'retired' ? 'Closed · ' : 'Acquired · ') + when;
    return when + (inf.cash != null ? ' · ' + U.kmoney(inf.cash) : '');
  }
  const where = (inf) => `${inf.lab || 'Unnamed lab'} · ${status(inf)}`;
  // the newest save of a lab still running (Continue); an ended run is a record, reached through Careers
  function latestSlot() { let best = -1, bt = -1; ALL.forEach(i => { const inf = info(i); if (playing(inf) && (inf.savedAt || 0) > bt) { bt = inf.savedAt || 0; best = i; } }); return best; }
  // where a new career goes by default: the first empty slot, else the oldest ended run, else the oldest save
  function oldestSlot() {
    const e = ALL.find(i => !info(i)); if (e != null) return e;
    const pick = (ok) => { let best = -1, bt = Infinity; ALL.forEach(i => { const inf = info(i); if (inf && ok(inf) && (inf.savedAt || 0) < bt) { bt = inf.savedAt || 0; best = i; } }); return best; };
    const ended = pick(inf => !playing(inf)); return ended >= 0 ? ended : Math.max(0, pick(() => true));
  }
  // after Save and quit FR.state still holds the lab just left; if its slot is overwritten or deleted from the menu,
  // forget it so a later pagehide/visibilitychange autosave cannot write the old lab back
  function dropStale(n) { if (FR.state && FR.state.slot === n && !(FR.inWorld && FR.inWorld())) FR.state = null; }
  let titleStale = false; // a career changed while the menu was away: the title tower re-lights from the latest save
  const slotBtn = (i, sel) => { const inf = info(i);
    return `<button class="btn slot ${sel ? 'sel' : ''}" data-s="${i}" aria-pressed="${sel}"><span class="tick">${ico('check')}</span><span class="slot-t"><b>Slot ${i + 1}</b><span class="meta">${inf ? esc(where(inf)) : 'Empty'}</span></span></button>`; };
  // one selected button per segmented control, mirrored to aria-pressed
  function select(seg, btn) { seg.querySelectorAll('.btn').forEach(x => { const on = x === btn; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
  function ensureTitle() { if (FR.title && !FR.title.active) FR.title.start(); }

  // ---------- new career: lab name, slot, and a confirm before a running lab is replaced ----------
  let newSlot = 0;
  function actions() { return $('newCareer').querySelector('.screen-actions'); }
  function hideReplace() { const c = $('ncConfirm'); if (c) c.hidden = true; const a = actions(); if (a) a.hidden = false; }
  function renderSlots() {
    $('slots').innerHTML = ALL.map(i => slotBtn(i, i === newSlot)).join('');
    $('slots').querySelectorAll('.slot').forEach(b => b.addEventListener('click', () => { sfx('tap'); newSlot = +b.dataset.s; renderSlots(); }));
    const taken = info(newSlot), warn = $('slotWarn');
    warn.hidden = !taken;
    warn.innerHTML = !taken ? '' : playing(taken) ? `${ico('alert')}<span>Slot ${newSlot + 1} holds ${esc(where(taken))}. Founding here replaces that save.</span>`
      : `${ico('info')}<span>Slot ${newSlot + 1} holds the record of ${esc(taken.lab || 'an ended lab')}. Founding here replaces it.</span>`;
    $('ncStart').textContent = taken && playing(taken) ? 'Replace save and found the lab' : 'Found the lab';
    hideReplace();
  }
  function askReplace(inf) {
    let c = $('ncConfirm');
    if (!c) { c = document.createElement('div'); c.id = 'ncConfirm'; c.className = 'confirm danger nc-confirm'; c.setAttribute('role', 'alertdialog'); c.setAttribute('aria-labelledby', 'ncConfirmT'); actions().before(c); }
    c.innerHTML = `<h4 id="ncConfirmT">Replace Slot ${newSlot + 1}?</h4><p>${esc(where(inf))} will be deleted to make room. This cannot be undone.</p>`
      + '<div class="actions"><button class="btn quiet" id="ncKeep">Keep it</button><button class="btn danger solid" id="ncReplace">Replace</button></div>';
    c.hidden = false; actions().hidden = true;
    $('ncKeep').addEventListener('click', () => { sfx('tap'); hideReplace(); $('ncStart').focus({ preventScroll: true }); });
    $('ncReplace').addEventListener('click', start);
    try { c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old engines */ }
    $('ncKeep').focus({ preventScroll: true });
  }
  function start() {
    sfx('confirm'); hideReplace();
    const name = String($('labName').value || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Prairie Blue Labs';
    titleStale = true; dropStale(newSlot);
    FR.cmd.newCareer({ labName: name, slot: newSlot });
  }
  function openNew(slot) {
    if (U.sheetId) U.sheet(null); U.hud(false); if (FR.r) FR.r.paused = true; ensureTitle();
    newSlot = slot != null && slot >= 0 ? slot : oldestSlot(); renderSlots(); U.show('newCareer'); $('newCareer').scrollTop = 0;
  }

  // ---------- how to play (static markup in the shell) ----------
  let helpFrom = 'menu';
  function openHelp(from) { helpFrom = from || 'menu'; if (from === 'game' && FR.r) FR.r.paused = true; U.show('help'); $('help').scrollTop = 0; }
  function closeHelp() {
    sfx('tap');
    if (helpFrom === 'settings') openSettings();
    else if (helpFrom === 'game' && FR.state && FR.state.status === 'playing') { U.show(null); U.hud(true); if (FR.r) FR.r.paused = !!U.sheetId; } // back to the tower
    else FR.menu.open();
  }

  // ---------- settings: the controls re-read FR.settings on every visit (the game menu changes them too) ----------
  const SEGS = [['sndSeg', 'sound'], ['motionSeg', 'reduceMotion']];
  function syncSegs() { SEGS.forEach(([id, key]) => { const el = $(id); if (!el) return; const b = Array.from(el.querySelectorAll('.btn')).find(x => (x.dataset.v === '1') === !!FR.settings[key]); if (b) select(el, b); }); }
  function openSettings() { syncSegs(); U.show('settings'); $('settings').scrollTop = 0; }

  // ---------- careers: continue any slot, copy a slot's save code, import a code into a chosen slot, delete ----------
  let impSlot = 0, expSlot = -1, askImport = false, askDelete = -1;
  function exportSlot(i) { const s = FR.save.read(i); return s ? FR.save.exportCode(s) : ''; }
  // validates a pasted code before anything is written
  function readCode(code) {
    const c = String(code == null ? '' : code).replace(/\s+/g, '');
    if (!c) return { why: 'Paste a save code first.' };
    if (!/^FR1\./.test(c)) return { why: 'That is not a Frontier save code. Codes start with FR1.' };
    const s = FR.save.importCode(c);
    if (!s || typeof s !== 'object' || !s.lab || s.turn == null || !s.money) return { why: 'This code is damaged or cut short. Copy the whole code and try again.' };
    return { code: c, state: s };
  }
  function renderCareers() {
    const box = $('carList'); if (!box) return;
    box.innerHTML = ALL.map(i => {
      const inf = info(i);
      if (!inf) return `<div class="set-save car-slot empty"><span class="set-save-t"><b>Slot ${i + 1}</b><small>Empty</small></span></div>`;
      if (askDelete === i) return `<div class="confirm danger" role="alertdialog" aria-labelledby="delT${i}"><h4 id="delT${i}">Delete Slot ${i + 1}?</h4><p>${esc(where(inf))} will be gone for good.</p><div class="actions"><button class="btn quiet small" data-keep="${i}">Keep it</button><button class="btn danger solid small" data-del="${i}">Delete</button></div></div>`;
      const run = playing(inf), tone = inf.status === 'dead' ? 'bad' : inf.status === 'won' ? 'good' : '';
      return `<div class="set-save car-slot"><span class="set-save-t"><b>${esc(inf.lab || 'Unnamed lab')}</b><small class="${tone}">Slot ${i + 1} · ${esc(status(inf))}</small></span>`
        + `<button class="btn danger small" data-ask="${i}" aria-label="Delete Slot ${i + 1}">${ico('trash')}Delete</button>`
        + `<button class="btn small" data-exp="${i}" aria-label="Save code for Slot ${i + 1}">${ico('copy')}Code</button>`
        + `<button class="btn primary small" data-load="${i}" aria-label="${run ? 'Continue' : 'Result for'} Slot ${i + 1}">${ico(run ? 'play' : 'record')}${run ? 'Continue' : 'Result'}</button></div>`;
    }).join('');
    box.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { sfx('tap'); FR.cmd.load(+b.dataset.load); }));
    box.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { sfx('tap'); expSlot = +b.dataset.exp; askDelete = -1; renderExport(); try { $('carExport').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old engines */ } }));
    box.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => { sfx('tap'); askDelete = +b.dataset.ask; renderCareers(); const k = box.querySelector('[data-keep]'); if (k) k.focus({ preventScroll: true }); }));
    box.querySelectorAll('[data-keep]').forEach(b => b.addEventListener('click', () => { sfx('tap'); askDelete = -1; renderCareers(); }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.del, inf = info(i); FR.save.clear(i); dropStale(i); titleStale = true;
      askDelete = -1; if (expSlot === i) expSlot = -1; sfx('confirm'); renderCareers();
      U.toast(`Slot ${i + 1} deleted${inf && inf.lab ? ': ' + inf.lab : ''}.`, 2200);
    }));
    renderExport(); renderImport();
  }
  function renderExport() {
    const box = $('carExport'); if (!box) return;
    const inf = expSlot >= 0 && info(expSlot); box.hidden = !inf; if (!inf) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="set-group"><h3 class="set-h">${ico('export')}Save code for Slot ${expSlot + 1}</h3>
      <p class="hint">${esc(where(inf))}. Paste this code into Frontier on another device to carry the lab over.</p>
      <div class="field"><label for="expCode">Code</label><textarea id="expCode" rows="3" readonly spellcheck="false"></textarea></div>
      <p class="hint car-copy" id="expHint" hidden></p>
      <div class="car-code-acts"><button class="btn primary small" id="expCopy">${ico('copy')}Copy code</button><button class="btn quiet small" id="expDone">Done</button></div></div>`;
    $('expCode').value = exportSlot(expSlot);
    $('expCopy').addEventListener('click', copyCode);
    $('expDone').addEventListener('click', () => { sfx('tap'); expSlot = -1; renderExport(); });
  }
  // navigator.clipboard runs inside the click handler (a user gesture); when the host blocks it, the code is selected
  // for the device's own Copy
  function copyCode() {
    const ta = $('expCode'), hint = $('expHint'), code = ta.value;
    const selectAll = () => { try { ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, code.length); } catch (e) { /* old engines */ } };
    const fallback = () => { selectAll(); hint.hidden = false; hint.textContent = 'Copying is blocked here. The code is selected: copy it with your device’s Copy.'; };
    const ok = () => { sfx('confirm'); hint.hidden = false; hint.textContent = 'Copied. Paste it wherever you keep it.'; U.toast('Save code copied.', 2000, 'good'); };
    const legacy = () => { let done = false; try { selectAll(); done = document.execCommand('copy'); } catch (e) { done = false; } if (done) ok(); else fallback(); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(ok, legacy); return; }
    } catch (e) { /* fall through */ }
    legacy();
  }
  function impError(msg) { const e = $('impErr'); if (!e) return; e.hidden = !msg; e.innerHTML = msg ? `${ico('alert')}<span>${esc(msg)}</span>` : ''; if (msg) sfx('error'); }
  function doImport() {
    const pre = readCode($('impCode').value); askImport = false;
    if (!pre.state) { impError(pre.why); renderImport(); return; }
    const r = FR.cmd.importCode(pre.code, impSlot);
    if (!r || !r.ok) { impError((r && r.why) || 'The code could not be imported.'); renderImport(); return; }
    titleStale = true; sfx('confirm'); $('impCode').value = ''; impError(''); expSlot = -1; askDelete = -1; renderCareers();
    U.toast(`${r.lab} imported into Slot ${r.slot + 1}.`, 3000, 'good');
  }
  function renderImport() {
    const box = $('impSlots'); if (!box) return;
    box.innerHTML = ALL.map(i => slotBtn(i, i === impSlot)).join('');
    box.querySelectorAll('.slot').forEach(b => b.addEventListener('click', () => { sfx('tap'); impSlot = +b.dataset.s; askImport = false; renderImport(); }));
    const c = $('impConfirm'), inf = info(impSlot), show = askImport && !!inf;
    c.hidden = !show; $('impGo').hidden = show;
    c.className = show ? 'confirm danger nc-confirm' : ''; if (show) c.setAttribute('role', 'alertdialog'); else c.removeAttribute('role');
    c.innerHTML = show ? `<h4>Replace Slot ${impSlot + 1}?</h4><p>${esc(where(inf))} will be deleted to make room for the imported lab. This cannot be undone.</p><div class="actions"><button class="btn quiet" id="impKeep">Keep it</button><button class="btn danger solid" id="impReplace">Replace</button></div>` : '';
    if (show) {
      $('impKeep').addEventListener('click', () => { sfx('tap'); askImport = false; renderImport(); });
      $('impReplace').addEventListener('click', doImport);
      $('impKeep').focus({ preventScroll: true });
    }
  }
  let carFrom = 'menu';
  function openCareers(from) {
    carFrom = from || 'menu'; expSlot = -1; askImport = false; askDelete = -1;
    const fe = ALL.find(i => !info(i)); impSlot = fe == null ? oldestSlot() : fe; impError('');
    renderCareers(); U.show('careers'); $('careers').scrollTop = 0;
  }

  // ---------- the end of a run ----------
  const MARKS = () => (FR.market && FR.market.K && FR.market.K.marks) || [30, 45, 60, 75, 90];
  const signed = (v) => (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-US');
  function outcome(s) {
    const e = s.end || {}, sk = e.skill && FR.SKILL_NAME[e.skill];
    if (s.status === 'won') return { k: 'Run complete · Frontier held', tone: 'good', text: e.text || `${s.lab.name} held the frontier safely for 52 weeks.` };
    if (s.status === 'exited' && e.cause === 'retired') return { k: 'Run complete · Lab closed', tone: 'gold', text: e.text || `${s.lab.name} was closed by its founders.` };
    if (s.status === 'exited') return { k: 'Run complete · Acquired', tone: 'gold', text: e.text || `${s.lab.name} was acquired.` };
    if (e.cause === 'cash') return { k: 'Lab closed · Out of cash', tone: 'bad', text: e.text || `${s.lab.name} ran out of cash.` };
    if (e.cause === 'final') return { k: 'Lab closed · Final incident' + (sk ? ' (' + sk + ')' : ''), tone: 'bad', text: e.text || `${s.lab.name} closed after a final incident${sk ? ' on ' + sk : ''}.` };
    return { k: 'Run over', tone: '', text: e.text || '' };
  }
  function renderEnd(s) {
    const o = outcome(s), sc = FR.sim.score(s), last = (s.end && s.end.turn) || s.turn;
    const k = $('endKicker'); k.textContent = o.k; k.className = 'kicker' + (o.tone ? ' ' + o.tone : '');
    $('endTitle').textContent = s.lab.name;
    $('endCause').textContent = [o.text, `Operated ${last} week${last === 1 ? '' : 's'}, to ${FR.dateLabel(last)}.`].filter(Boolean).join(' ');
    $('endTotal').textContent = signed(sc.total);
    const st = s.stats || {}, peakVal = st.peakValuation || 0;
    const tile = (label, v) => `<div class="stat"><small>${label}</small><b>${v}</b></div>`;
    $('endFacts').innerHTML = tile('Weeks', last) + tile('Peak avg capability', (s.model.peakCap || 0).toFixed(1)) + tile('Incidents', st.incidents || 0)
      + tile('Records set', st.firstsWon || 0) + tile('Peak valuation', U.kmoney(peakVal)) + tile('Your stake', Math.round(s.money.founderPct || 0) + '%');
    $('endParts').innerHTML = sc.parts.map(p => `<tr><td>${esc(p.label)}</td><td class="${p.value < 0 ? 'neg' : ''}">${p.value > 0 ? '+' : ''}${signed(p.value)}</td></tr>`).join('')
      + `<tr class="total"><td>Total</td><td>${signed(sc.total)}</td></tr>`;
    const ml = (s.memo && s.memo.lines) || [], MI = { change: 'info', flag: 'alert', due: 'clock', good: 'check' };
    $('endMemoSec').hidden = !ml.length;
    $('endMemo').innerHTML = ml.map(l => `<li class="${esc(l.kind || 'change')}">${ico(MI[l.kind] || 'info')}<span>${esc(l.text)}</span></li>`).join('');
    const firsts = (s.market && s.market.firsts) || [], rivals = (s.market && s.market.rivals) || [];
    const byName = (by) => by === 'player' ? s.lab.name : ((rivals.find(r => r.id === by) || {}).name || by);
    $('endRecord').innerHTML = MARKS().map(mark => {
      const f = firsts.find(x => x.mark === mark);
      if (!f) return `<li class="open"><span class="mk">${mark}</span><span class="by">Not reached</span><span class="wk"></span></li>`;
      const you = f.by === 'player';
      return `<li class="${you ? 'you' : 'rival'}"><span class="mk">${mark}</span><span class="by">${esc(byName(f.by))}</span><span class="wk">${esc(FR.dateLabel(f.turn).replace('Year ', 'Y').replace(', Week ', ' W'))}</span></li>`;
    }).join('');
  }

  // ---------- the menu newswire (fictional; straight wire voice) ----------
  const WIRE = [
    'Opal AI closes $6.0B round at a $90B valuation.',
    'Entropic publishes third-party audit of its agent evaluations.',
    'DeepField brings two data centres online ahead of schedule.',
    'Zeta releases open weights for its largest model to date.',
    'GPU rental prices up 14% on the quarter as supply tightens.',
    'Chip lead times stretch to 38 weeks, suppliers say.',
    'Enterprise AI spending up 31% year on year, survey finds.',
    'Opal AI pulls agent feature after customer data exposure.',
    'Public trust in AI labs falls four points in monthly poll.',
    'DeepField offers compute-for-revenue deals to smaller labs.',
    'Zeta price cut pushes API rates down across the market.',
    'Senior research pay up 22% as labs compete for staff.'
  ];

  FR.menu = {
    help: openHelp, careers: openCareers, settings: openSettings, newCareer: openNew, exportSlot, readCode, oldestSlot, latestSlot,
    setSetting(key, value) { FR.settings[key] = value; saveSettings(); },
    // bottom newswire on the menu: seven lines, reshuffled each boot, written twice for a seamless loop
    ticker() {
      const el = $('tickerText'); if (!el) return;
      const pool = WIRE.slice(), pick = [];
      while (pick.length < 7 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      el.textContent = ''; el.style.animationDuration = '';
      for (let k = 0; k < 2; k++) pick.forEach(h => { const i = document.createElement('span'); i.className = 'tk-item'; i.textContent = h; el.appendChild(i); });
    },
    open() {
      if (FR.elevator && FR.elevator.cancel) FR.elevator.cancel();   // a ride under way never lands behind the menu
      if (U.sheetId) U.sheet(null); U.hud(false); U.hideHint(); if (FR.r) FR.r.paused = true;
      if (FR.title) { if (FR.title.active && titleStale && FR.title.restart) FR.title.restart(); else ensureTitle(); } titleStale = false;
      // back at the menu the floor bed ends and the menu theme returns (both only when sound is on)
      if (FR.audio) { if (FR.audio.bedStop) FR.audio.bedStop(); if (FR.audio.music) FR.audio.music('menu'); }
      const last = latestSlot(), has = last >= 0, any = ALL.some(i => info(i));
      $('mContinue').hidden = !has; $('mNew').classList.toggle('primary', !has);
      $('mContinueSub').textContent = has ? where(info(last)) : '';
      $('mCareers').innerHTML = any ? `${ico('disc')}Careers and save codes` : `${ico('import')}Import a save code`;
      $('mHelp').classList.toggle('nudge', !any);
      const tag = document.querySelector('#menu .tagline'); if (tag) tag.textContent = has ? 'Your lab is where you left it.' : 'Run a frontier AI lab. Keep capability and safety in step.';
      U.show('menu');
      // constant reading speed (~40 px/s) whatever the headlines' length; measured once the menu lays out
      const tk = $('tickerText'); if (tk && !tk.style.animationDuration && tk.scrollWidth) tk.style.animationDuration = Math.max(20, tk.scrollWidth / 2 / 40).toFixed(1) + 's';
    },
    // the end-of-run screen for FR.state (won, dead or exited): outcome, cause, score parts, the frontier record
    end() {
      const s = FR.state; if (!s || s.status === 'playing') { FR.menu.open(); return; }
      if (FR.elevator && FR.elevator.cancel) FR.elevator.cancel();
      if (U.sheetId) U.sheet(null); U.hud(false); U.hideHint(); if (FR.r) FR.r.paused = true;
      { const t = $('toast'); if (t) { clearTimeout(U._tt); t.classList.remove('on'); } }   // e.g. the founding "Welcome" toast
      if (FR.audio && FR.audio.bedStop) FR.audio.bedStop();
      try { renderEnd(s); } catch (e) { console.error('end screen failed', e); $('endKicker').textContent = 'Run over'; $('endTitle').textContent = (s.lab && s.lab.name) || 'Lab'; }
      titleStale = true; U.show('end'); $('end').scrollTop = 0;
    },
    bind() {
      if (FR.menu._bound) return; FR.menu._bound = true;
      menuArt();
      $('bootTap').addEventListener('click', () => { if (FR.audio) { FR.audio.init(); FR.audio.resume(); FR.audio.play('title'); } FR.menu.open(); });
      $('mContinue').addEventListener('click', () => { sfx('tap'); const s = latestSlot(); if (s >= 0) FR.cmd.load(s); });
      $('mNew').addEventListener('click', () => { sfx('tap'); openNew(); });
      $('mCareers').addEventListener('click', () => { sfx('tap'); openCareers('menu'); });
      $('mHelp').addEventListener('click', () => { sfx('tap'); openHelp('menu'); });
      $('mSettings').addEventListener('click', () => { sfx('tap'); openSettings(); });
      $('mCredits').addEventListener('click', () => { sfx('tap'); U.show('credits'); });
      $('crBack').addEventListener('click', () => { sfx('tap'); FR.menu.open(); });
      $('ncBack').addEventListener('click', () => { sfx('tap'); hideReplace(); FR.menu.open(); });
      $('ncStart').addEventListener('click', () => { const taken = info(newSlot); if (taken && playing(taken)) { sfx('tap'); askReplace(taken); } else start(); });
      $('labName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('ncStart').click(); } });
      $('helpBack').addEventListener('click', closeHelp);
      $('setBack').addEventListener('click', () => { sfx('tap'); FR.menu.open(); });
      $('setHelp').addEventListener('click', () => { sfx('tap'); openHelp('settings'); });
      $('setCareers').addEventListener('click', () => { sfx('tap'); openCareers('settings'); });
      $('carBack').addEventListener('click', () => { sfx('tap'); if (carFrom === 'settings') openSettings(); else FR.menu.open(); });
      $('impGo').addEventListener('click', () => {
        const pre = readCode($('impCode').value); if (!pre.state) { impError(pre.why); return; }
        if (info(impSlot)) { sfx('tap'); askImport = true; renderImport(); return; }
        doImport();
      });
      $('impCode').addEventListener('input', () => impError(''));
      SEGS.forEach(([id, key]) => { const el = $(id); if (!el) return; el.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
        FR.settings[key] = b.dataset.v === '1'; select(el, b); saveSettings(); sfx('tap');
      })); });
      syncSegs();
      $('endNew').addEventListener('click', () => { sfx('tap'); const slot = FR.state ? FR.state.slot : null; $('labName').value = ''; openNew(slot); });
      $('endMenu').addEventListener('click', () => { sfx('tap'); FR.menu.open(); });
    }
  };
  // the boot tower, smaller, above the menu logo (the WebGL-less fallback; the title scene hides it)
  function menuArt() {
    const box = $('menuArt'), src = document.querySelector('#boot .hero-art'); if (!box || !src || box.firstChild) return;
    const art = src.cloneNode(true); art.classList.add('sm');
    const g = art.querySelector('radialGradient'); if (g) g.id = 'heroGlowMenu';
    const glow = art.querySelector('.glow'); if (glow) glow.style.fill = 'url(#heroGlowMenu)';
    box.appendChild(art);
  }
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

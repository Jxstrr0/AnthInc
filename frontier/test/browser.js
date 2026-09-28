#!/usr/bin/env node
// Frontier browser flow check (Playwright + headless Chromium, never `playwright install`).
//   node test/browser.js                      every section: boot, flow, floors, save, end
//   SECTION=flow node test/browser.js         one section (or a list: SECTION=boot,save); each fits in `timeout 500`
//   SKIP_SHOTS=1                              no screenshots and no contact sheet
//   VERBOSE=1                                 print steps, timings, notes (how panels opened, targets under 44px), warnings
//   FILE=path/to/game.html                    page under test (default dist/game.html; run `node build.js` first)
//   BUILD=1                                   run build.js before the check
// The page is served from a fake origin (http://frontier.test/) so localStorage behaves as on the web; the three.js CDN
// script is routed to tools/vendor/three.r128.min.js and the Google Fonts requests are aborted (their console noise is
// ignored). Every section starts from fresh storage at 390x844 and asserts no console errors or page errors.
// Sections:
//   boot    title screen (three.js + WebGL up), menu, How to play / Settings / Credits / Careers / New career, 360x740 fit
//   flow    New career form → Research by elevator → drag two slider thumbs → Greenlight → Boardroom → accept the seed
//           → 10 End Turns on #hEnd (the first memo's next-step button, then Noted) → turn +10, cash moved; 360x740 HUD
//   floors  elevator sheet to all nine floors, each floor's panel by a tap on its tag (else the 3D target, else
//           FR.ui.panel), title and content checked; dense panels and the boardroom tabs at 360x740
//   save    save → reload → Continue (same turn, cash, floor); Careers code → import into slot 2 → Continue slot 2
//   end     out of cash and a final incident (crafted state, resolved by End Turn), a crafted win; end screen, score
//           parts, the record; Careers shows the closed lab and its Result
//   review  regressions from the 2026-09-28 review: no three.js / no WebGL still plays (elevator opens panels), a ride
//           never lands after quitting, keys under the memo never end a week, chips route, typed lab name, careers at
//           412 wide, portrait tags on screen, focus clears the HUD, rent jumps, GPU buffers freed on floor changes
// Output: one line per section, 'ok <section>' or 'FAIL <section>: <reason>', then 'ALL PASS' or the failure count.
// Screenshots: test/shots/<n>-<section>-<nn>-<name>.png, combined into test/shots/contact.png (python3 + PIL).
'use strict';
const fs = require('fs'), path = require('path'), { execSync, spawnSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not on NODE_PATH: use the global install */ }
  const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  return require(path.join(root, 'playwright'));
}

const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.FILE ? path.resolve(process.env.FILE) : path.join(ROOT, 'dist', 'game.html');
const THREE_FILE = path.join(ROOT, 'tools', 'vendor', 'three.r128.min.js');
const SHOTS = path.join(__dirname, 'shots');
const SKIP_SHOTS = process.env.SKIP_SHOTS === '1';
const VERBOSE = process.env.VERBOSE === '1';
const ORIGIN = 'http://frontier.test';
const URL = ORIGIN + '/game.html';
const ALL = ['boot', 'flow', 'floors', 'save', 'end', 'review'];
const SECTION_MS = 420000; // a section fails rather than hang; the whole section stays inside `timeout 500`
const PHONE = { width: 390, height: 844 }, SMALL = { width: 360, height: 740 };
const FLOORS = ['lobby', 'serving', 'training', 'safety', 'research', 'proj1', 'proj2', 'proj3', 'boardroom'];
const NOISE = /fonts\.(googleapis|gstatic)\.com/;

const log = (...a) => { if (VERBOSE) console.log('   ', ...a); };
class Fail extends Error {}
const assert = (cond, msg) => { if (!cond) throw new Fail(msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// a Playwright error in one line: the message, the selector it waited for, and what blocked it
function pwWhy(e) {
  const lines = String((e && e.message) || e).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const pick = (re) => { const l = lines.slice(1).reverse().find(x => re.test(x)); return l ? l.replace(/^-\s*/, '') : ''; };
  return [lines[0], pick(/waiting for (locator|selector)/), pick(/intercepts pointer|not visible|not stable|outside of the viewport|not enabled|detached/)].filter(Boolean).join(' · ').slice(0, 400);
}

// ---------- one section: a fresh context, the routes, the error watch, the helpers ----------
class Run {
  constructor(name, idx, ctx, page, src) {
    Object.assign(this, { name, idx, ctx, page, src, errors: [], notes: [], warnings: {}, shotN: 0, fontFails: 0 });
  }
  static async open(browser, name, idx, src, opt) {
    opt = opt || {};
    const ctx = await browser.newContext({ viewport: opt.viewport || PHONE, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    const T = new Run(name, idx, ctx, page, src);
    await ctx.route('**/three.min.js', r => opt.noThree ? r.abort() : r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: src.three }));
    await ctx.route(NOISE, r => { T.fontFails++; return r.abort(); });
    await ctx.route(ORIGIN + '/**', r => {
      const u = r.request().url();
      if (/\/game\.html(\?|#|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: src.html });
      return r.fulfill({ status: 204, body: '' });
    });
    page.on('console', m => {
      if (m.type() === 'warning') { const k = m.text().slice(0, 140); T.warnings[k] = (T.warnings[k] || 0) + 1; }
      if (m.type() !== 'error') return;
      const url = (m.location() && m.location().url) || '', text = m.text();
      if (NOISE.test(url) || NOISE.test(text)) return;
      if (opt.noThree && (/three\.js did not load/.test(text) || /three\.min\.js/.test(url) || /^Failed to load resource/.test(text))) return;   // expected there
      if (/^Failed to load resource/.test(text) && T.fontFails > 0 && !url) return; // the aborted font request, unattributed
      T.errors.push('console.error: ' + text.slice(0, 300) + (url && !/frontier\.test/.test(url) ? ' @ ' + url : ''));
    });
    page.on('pageerror', e => T.errors.push('pageerror: ' + String((e && (e.stack || e.message)) || e).split('\n').slice(0, 3).join(' | ')));
    page.on('requestfailed', r => { if (!NOISE.test(r.url()) && !(opt.noThree && /three\.min\.js/.test(r.url()))) T.errors.push('request failed: ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')); });
    return T;
  }
  note(s) { this.notes.push(s); log('note: ' + s); }
  step(s) { log(this.name + ': ' + s); }
  async shot(label) {
    if (SKIP_SHOTS) return;
    const n = String(++this.shotN).padStart(2, '0');
    await sleep(400); // let the last frame and the 320 ms screen / sheet animations land
    await this.page.screenshot({ path: path.join(SHOTS, `${this.idx}-${this.name}-${n}-${label}.png`) });
  }
  ev(fn, arg) { return this.page.evaluate(fn, arg); }
  async until(fn, arg, ms, what) {
    try { await this.page.waitForFunction(fn, arg, { timeout: ms || 8000, polling: 50 }); }
    catch (e) {
      let dbg = ''; try { dbg = JSON.stringify(await this.ev(() => ({ screen: (document.querySelector('.screen.on') || {}).id || null, sheet: FR.ui && FR.ui.sheetId, floor: FR.r && FR.r.current && FR.r.current.id, mode: FR.r && FR.r.mode, riding: FR.elevator && FR.elevator.riding, turn: FR.state && FR.state.turn, status: FR.state && FR.state.status }))); } catch (e2) { /* page gone */ }
      throw new Fail(`timed out waiting for ${what || 'condition'} ${dbg}`);
    }
  }
  noErrors(where) { assert(!this.errors.length, `${this.errors.length} console error(s)${where ? ' (' + where + ')' : ''}: ${this.errors.slice(0, 3).join(' || ')}`); }

  // ---------- boot and menu ----------
  async load() {
    await this.page.goto(URL, { waitUntil: 'load' });
    await this.until(() => !!(window.FR && FR.cmd && FR.menu && FR.ui && document.getElementById('boot').classList.contains('on')), null, 15000, 'the boot screen');
  }
  async toMenu() {
    await this.page.click('#bootTap');
    await this.until(() => document.getElementById('menu').classList.contains('on'), null, 8000, 'the main menu');
  }
  // New career through the menu form; lands in the lobby with the camera at rest
  async newCareer(labName) {
    const onMenu = await this.ev(() => document.getElementById('menu').classList.contains('on'));
    if (onMenu) await this.page.click('#mNew');
    await this.until(() => document.getElementById('newCareer').classList.contains('on'), null, 8000, 'the new career screen');
    await this.page.fill('#labName', labName);
    await this.page.click('#ncStart');
    if (await this.page.locator('#ncConfirm:not([hidden]) #ncReplace').count()) await this.page.click('#ncReplace');
    await this.until((n) => !!(FR.state && FR.state.lab.name === n && FR.inWorld() && FR.r.current && FR.r.current.id === 'lobby'), labName, 12000, 'the new career in the lobby');
    await this.settle();
    const s = await this.ev(() => ({ turn: FR.state.turn, status: FR.state.status, cash: FR.state.money.cash, sum: FR.ALLOCS.reduce((t, k) => t + FR.state.sliders[k], 0) }));
    assert(s.turn === 1 && s.status === 'playing' && s.cash > 0 && s.sum === 100, 'new career state is off: ' + JSON.stringify(s));
  }
  // the camera is at rest and no ride or glide is running
  async settle() {
    await this.until(() => !!(FR.r && FR.r.current && !(FR.elevator && FR.elevator.riding) && !FR.r.debug().gliding && FR.r.mode !== 'ride'), null, 10000, 'the camera to settle');
    await sleep(150);
  }

  // ---------- sheets, elevator, panels ----------
  async closeSheet() {
    if (!(await this.ev(() => FR.ui.sheetId))) return;
    await this.page.click('#sheetClose');
    await this.until(() => !FR.ui.sheetId, null, 4000, 'the sheet to close');
    await sleep(80);
  }
  // Elevator button in the dock → the elevator sheet → the floor's row → the ride → doors open, camera home
  async ride(floor, opts) {
    opts = opts || {};
    if ((await this.ev(() => FR.r.current && FR.r.current.id)) === floor) return;
    await this.closeSheet();
    await this.settle();
    await this.page.click('#hElev');
    await this.until(() => FR.ui.sheetId === 'elevator' && !!document.getElementById('elevFloors'), null, 8000, 'the elevator sheet');
    const rows = await this.ev(() => Array.from(document.querySelectorAll('#elevFloors [data-f]')).map(el => ({ f: el.dataset.f, h: el.getBoundingClientRect().height })));
    assert(rows.length === 9, `elevator sheet lists ${rows.length} floors, expected 9`);
    const small = rows.filter(r => r.h < 44); if (small.length) this.note(`elevator rows under 44px: ${small.map(r => r.f + ' ' + r.h.toFixed(0)).join(', ')}`);
    if (opts.shot) await this.shot('elevator-sheet');
    await this.page.click(`#elevFloors [data-f="${floor}"]`);
    if (opts.checkEnd) {
      const st = await this.ev(() => ({ riding: FR.elevator.riding, disabled: document.getElementById('hEnd').disabled }));
      assert(st.riding && st.disabled, 'End Turn stays enabled during an elevator ride: ' + JSON.stringify(st));
    }
    await this.until((f) => !FR.elevator.riding && FR.r.current && FR.r.current.id === f && FR.elevator.floor === f, floor, 15000, 'the ride to ' + floor);
    await this.settle();
  }
  // Opens the floor's panel: a tap on a target's tag, else a tap on the target in the 3D view, else FR.ui.panel(first
  // hotspot). Returns how it opened. Asserts the sheet opened on that floor with content.
  async openPanel(floor, prefer) {
    const want = 'fp:' + floor;
    const info = await this.ev(([f, p]) => {
      const ids = FR.r.targets().map(t => t.id).filter(id => id.indexOf(f + '.') === 0);
      if (p && ids.indexOf(p) > 0) { ids.splice(ids.indexOf(p), 1); ids.unshift(p); }
      return { ids, tagsOn: document.getElementById('tags').classList.contains('on') };
    }, [floor, prefer || null]);
    assert(info.ids.length, `no tap targets on ${floor}`);
    const first = info.ids[0];
    let how = null;
    // 1. a tag (the labelled pill over the object)
    for (const id of info.ids) {
      const tag = this.page.locator(`#tags.on .tag[data-t="${id}"]:not(.off)`);
      if (!(await tag.count()) || !(await tag.isVisible())) continue;
      try {
        await tag.click({ timeout: 3000 });
        await this.until((w) => FR.ui.sheetId === w, want, 5000, 'the panel after a tag tap');
        how = 'tag ' + id; break;
      } catch (e) { await this.closeSheet(); await this.settle(); }
    }
    // 2. a tap on the target itself in the 3D view
    if (!how) {
      const pt = await this.ev((id) => { const s = FR.r.screenOf(id); if (!s) return null; const x = s.cx, y = s.cy; const el = document.elementFromPoint(x, y); return { x, y, canvas: !!(el && el.tagName === 'CANVAS') }; }, first);
      if (pt && pt.canvas && pt.x > 0 && pt.y > 0 && pt.x < PHONE.width && pt.y < PHONE.height) {
        await this.page.mouse.click(pt.x, pt.y);
        try { await this.until((w) => FR.ui.sheetId === w, want, 5000, 'the panel after a canvas tap'); how = 'canvas ' + first; }
        catch (e) { await this.closeSheet(); await this.settle(); }
      }
    }
    // 3. the panel API with the floor's first hotspot
    if (!how) {
      await this.ev((id) => FR.ui.panel(id), first);
      await this.until((w) => FR.ui.sheetId === w, want, 5000, 'the panel from FR.ui.panel(' + first + ')');
      how = 'FR.ui.panel ' + first;
      this.note(`${floor}: no tappable tag or target, opened with FR.ui.panel('${first}')`);
    }
    await sleep(350); // sheet-in animation
    const c = await this.ev(() => {
      const b = document.getElementById('sheetBody'), h = b.querySelector('h3');
      return { on: document.getElementById('sheet').classList.contains('on'), h3: h ? h.textContent.trim() : '', len: b.innerText.trim().length, failed: /could not be read|not in this build/.test(b.innerText) };
    });
    const name = await this.ev((f) => FR.HQ_FLOOR_META[f].name, floor);
    assert(c.on && c.len > 60, `${floor} panel is empty (${c.len} chars)`);
    assert(c.h3 === name, `${floor} panel title is "${c.h3}", expected "${name}"`);
    assert(!c.failed, `${floor} panel shows its error state`);
    log(`${floor}: panel via ${how}, ${c.len} chars`);
    return how;
  }
  // visible buttons under `sel` smaller than 44px on either side (a note, not a failure)
  // (an absolutely placed ::before / ::after with negative insets widens the hit area, as the tap-tips' 18px dot does)
  async smallTargets(sel, where) {
    const s = await this.ev((q) => Array.from(document.querySelectorAll(q)).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
      .map(el => {
        const r = el.getBoundingClientRect(); let w = r.width, h = r.height;
        ['::before', '::after'].forEach(p => { const c = getComputedStyle(el, p); if (c.content === 'none' || c.position !== 'absolute' || c.pointerEvents === 'none') return; const n = (v) => (/px$/.test(v) ? -parseFloat(v) : 0);
          w = Math.max(w, r.width + n(c.left) + n(c.right)); h = Math.max(h, r.height + n(c.top) + n(c.bottom)); });
        return { t: (el.id ? '#' + el.id + ' ' : '') + ((el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)), w: Math.round(w), h: Math.round(h) };
      })
      .filter(o => o.w < 44 || o.h < 44), sel);
    if (s.length) this.note(`${where}: ${s.length} target(s) under 44px: ${s.slice(0, 6).map(o => `"${o.t}" ${o.w}x${o.h}`).join(', ')}`);
    return s;
  }
  async fitsWidth(where) {
    const r = await this.ev(() => {
      const W = window.innerWidth, out = [];
      document.querySelectorAll('.screen.on button, .screen.on input, #hud.on button, #sheet.on button').forEach(el => {
        const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
        if (b.left < -1 || b.right > W + 1) out.push(((el.id && '#' + el.id) || el.textContent.trim().slice(0, 20)) + ` [${Math.round(b.left)}..${Math.round(b.right)}]`);
      });
      const sb = document.querySelector('#sheet.on #sheetBody');
      return { W, sw: document.documentElement.scrollWidth, out, sheet: sb ? [sb.scrollWidth, sb.clientWidth] : null };
    });
    assert(r.sw <= r.W, `${where}: page scrolls sideways (${r.sw}px wide at ${r.W}px)`);
    assert(!r.sheet || r.sheet[0] <= r.sheet[1] + 1, `${where}: the sheet content is ${r.sheet && r.sheet[0]}px wide in a ${r.sheet && r.sheet[1]}px sheet`);
    assert(!r.out.length, `${where}: controls cross the screen edge: ${r.out.slice(0, 4).join(', ')}`);
  }

  // Drags one allocation slider by its thumb with the mouse (the track itself takes no pointer). Returns the new sliders.
  async dragSlider(key, target) {
    const inp = this.page.locator(`#sheetBody input[data-fps="${key}"]`);
    assert(await inp.count(), `no ${key} slider in the open panel`);
    await inp.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await sleep(200);
    const g = await inp.evaluate((el, t) => {
      const r = el.getBoundingClientRect(), T = parseFloat(getComputedStyle(el).getPropertyValue('--thumb')) || 28, span = r.width - T, v = +el.value;
      const at = (p) => r.left + T / 2 + span * p / 100, y = r.top + r.height / 2;
      const far = at(v > 50 ? 5 : 95);
      return { x: at(v), y, tx: at(t), v, onThumb: document.elementFromPoint(at(v), y) === el, trackTakes: document.elementFromPoint(far, y) === el };
    }, target);
    assert(g.onThumb, `${key} slider: the thumb at ${g.x.toFixed(0)},${g.y.toFixed(0)} does not take the pointer`);
    assert(!g.trackTakes, `${key} slider: the track takes the pointer (only the thumb should)`);
    await this.page.mouse.move(g.x, g.y);
    await this.page.mouse.down();
    await this.page.mouse.move(g.tx, g.y, { steps: 14 });
    await this.page.mouse.up();
    await this.until(([k, t]) => Math.abs(FR.state.sliders[k] - t) <= 2 && !FR.ui.panels.debug().dragging, [key, target], 5000, `${key} slider at ${target}`);
    const s = await this.ev(() => Object.assign({}, FR.state.sliders));
    const sum = Object.values(s).reduce((a, b) => a + b, 0);
    assert(sum === 100, `sliders sum to ${sum} after dragging ${key}: ${JSON.stringify(s)}`);
    const shown = await this.ev((k) => { const el = document.querySelector(`#sheetBody input[data-fps="${k}"]`); return el ? +el.value : null; }, key);
    assert(shown === s[key], `${key} slider shows ${shown} but the state holds ${s[key]}`);
    log(`dragged ${key} ${g.v} → ${s[key]} (${JSON.stringify(s)})`);
    return s;
  }
  // End Turn through the dock button, then the memo sheet's Noted
  async endTurn(opts) {
    opts = opts || {};
    const t0 = await this.ev(() => FR.state.turn);
    await this.until(() => !FR.ui.sheetId && !document.getElementById('hEnd').disabled, null, 5000, 'End Turn to be ready');
    for (let tries = 0; ; tries++) {
      await this.page.click('#hEnd');
      try { await this.until((t) => FR.state.turn === t + 1 || FR.state.status !== 'playing', t0, tries < 2 ? 2500 : 6000, 'the week to resolve'); break; }
      catch (e) { if (tries >= 2) throw e; await sleep(300); } // the dock's 350 ms re-arm after the previous week
    }
    if (opts.expectEnd) return;
    const st = await this.ev(() => ({ status: FR.state.status, end: FR.state.end }));
    assert(st.status === 'playing', `the run ended at End Turn ${t0} (${st.status}: ${JSON.stringify(st.end)})`);
    await this.until(() => FR.ui.sheetId === 'memo' && document.getElementById('sheet').classList.contains('on'), null, 5000, 'the memo sheet after End Turn');
    await sleep(350);
    if (opts.shot) await this.shot(opts.shot);
    const go = opts.go ? await this.page.locator('#sheet [data-fp="go"]').first().getAttribute('data-v').catch(() => null) : null;
    if (go) {
      // the memo's next step: rides to the floor if needed, glides to the object and opens its panel
      await this.page.click('#sheet [data-fp="go"]');
      const fid = go.split('.')[0];
      await this.until((f) => FR.ui.sheetId === 'fp:' + f && !FR.elevator.riding && FR.r.current.id === f, fid, 15000, `the memo's next step (${go})`);
      await sleep(350);
      if (opts.goShot) await this.shot(opts.goShot);
      this.stepGo = go;
      await this.closeSheet();
      await this.settle();
    } else {
      await this.page.click('#sheet [data-fp="noted"]');
      await this.until(() => !FR.ui.sheetId, null, 4000, 'the memo to close');
    }
    await sleep(380);
  }
}

// ---------- sections ----------
const SECTIONS = {
  // page loads, title screen, menu and its screens, no console errors; menu at 360x740 fits
  async boot(T) {
    await T.load();
    const b = await T.ev(() => ({ three: typeof THREE, stub: !!(FR.r && FR.r.stub), gl: !!(FR.r && FR.r.renderer), title: !!(FR.title && FR.title.active), ver: FR.VERSION, logo: getComputedStyle(document.querySelector('#boot .logo')).display !== 'none', tap: !!document.getElementById('bootTap').offsetParent, pageTitle: document.title }));
    assert(b.three === 'object' && !b.stub, 'three.js did not load (HQ view is the stub)');
    assert(b.gl, 'the WebGL renderer did not start');
    assert(b.title, 'the title tower is not running behind the boot screen');
    assert(b.logo && b.tap, 'the boot screen has no logo or no Tap to start');
    assert(b.pageTitle === 'Frontier', `page title is "${b.pageTitle}"`);
    await sleep(600);
    await T.shot('title');
    await T.toMenu();
    const m = await T.ev(() => { const vis = (id) => { const el = document.getElementById(id); return !!(el && !el.hidden && el.offsetParent); }; return { cont: vis('mContinue'), nw: vis('mNew'), car: vis('mCareers'), help: vis('mHelp'), set: vis('mSettings'), cred: vis('mCredits'), ticker: document.querySelectorAll('#tickerText .tk-item').length }; });
    assert(!m.cont, 'Continue shows with no saved lab');
    assert(m.nw && m.car && m.help && m.set && m.cred, 'main menu buttons missing: ' + JSON.stringify(m));
    assert(m.ticker > 0, 'the menu newswire is empty');
    await T.smallTargets('#menu .btn', 'menu');
    await sleep(400);
    await T.shot('menu');
    const screens = [['mHelp', 'help', 'helpBack'], ['mSettings', 'settings', 'setBack'], ['mCredits', 'credits', 'crBack'], ['mCareers', 'careers', 'carBack'], ['mNew', 'newCareer', 'ncBack']];
    for (const [btn, id, back] of screens) {
      await T.page.click('#' + btn);
      await T.until((s) => document.getElementById(s).classList.contains('on'), id, 5000, 'the ' + id + ' screen');
      const len = await T.ev((s) => document.getElementById(s).innerText.trim().length, id);
      assert(len > 40, `${id} screen is empty`);
      if (id === 'careers') { const n = await T.ev(() => document.querySelectorAll('#carList .car-slot').length); assert(n === 3, `careers lists ${n} slots, expected 3`); }
      if (id === 'help' || id === 'newCareer') await T.shot(id);
      await T.page.locator('#' + back).scrollIntoViewIfNeeded();
      await T.page.click('#' + back);
      await T.until(() => document.getElementById('menu').classList.contains('on'), null, 5000, 'the menu after ' + id);
    }
    // the small phone
    await T.page.setViewportSize(SMALL);
    await sleep(500);
    await T.fitsWidth('menu at 360x740');
    await T.shot('menu-360');
    await T.page.click('#mNew');
    await T.until(() => document.getElementById('newCareer').classList.contains('on'), null, 5000, 'the new career screen at 360');
    await T.fitsWidth('new career at 360x740');
    await T.page.click('#ncBack');
    T.noErrors();
  },

  // new career → sliders by thumb drag → greenlight on Research → seed round in the Boardroom → 10 End Turns
  async flow(T) {
    await T.load(); await T.toMenu();
    await T.newCareer('Flow Check Labs');
    await T.shot('lobby');
    const hud = await T.ev(() => ['hElev', 'hMemo', 'hEnd', 'hMenu'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, w: r.width, h: r.height }; }));
    hud.forEach(h => assert(h.w >= 44 && h.h >= 44, `HUD button #${h.id} is ${h.w.toFixed(0)}x${h.h.toFixed(0)}, under 44px`));
    await T.smallTargets('#hud.on button', 'HUD');
    // Research: ride there, open the offer board, drag two sliders, greenlight
    await T.ride('research', { shot: true, checkEnd: true });
    await T.shot('research-room');
    const how1 = await T.openPanel('research', 'research.offers');
    if (!/^tag/.test(how1)) T.note('research panel opened by ' + how1);
    const s0 = await T.ev(() => Object.assign({}, FR.state.sliders));
    await T.shot('research-panel');
    const sA = await T.dragSlider('research', s0.research >= 30 ? 20 : 35);
    const sB = await T.dragSlider('safety', sA.safety >= 30 ? 22 : 34);
    assert(JSON.stringify(sB) !== JSON.stringify(s0), 'the sliders did not change');
    const fcOk = await T.ev(() => /research points a week/.test(document.getElementById('sheetBody').innerText)); assert(fcOk, 'the research slider shows no forecast');
    await T.shot('sliders-set');
    await T.smallTargets('#sheet.on button:not(.tag)', 'research panel');
    const p0 = await T.ev(() => ({ n: FR.state.projects.active.length, offers: FR.state.projects.offers.length }));
    const gl = T.page.locator('#sheetBody [data-fp="gl"]:not([disabled])').first();
    assert(await gl.count(), `no offer can be greenlit (${p0.offers} on the board)`);
    const offerId = await gl.getAttribute('data-v');
    await gl.scrollIntoViewIfNeeded();
    await gl.click();
    await T.until((n) => FR.state.projects.active.length === n + 1, p0.n, 5000, 'the greenlit project');
    const pj = await T.ev((id) => { const p = FR.state.projects.active[FR.state.projects.active.length - 1]; return { name: p.name, gone: !FR.state.projects.offers.some(o => o.id === id), toast: document.getElementById('toast').textContent }; }, offerId);
    assert(pj.gone, 'the greenlit offer is still on the board');
    assert(/Greenlit/.test(pj.toast), 'no greenlight toast: ' + pj.toast);
    await T.shot('greenlit');
    // Boardroom: the seed round
    await T.ride('boardroom');
    const how2 = await T.openPanel('boardroom', 'boardroom.table');
    if (!/^tag/.test(how2)) T.note('boardroom panel opened by ' + how2);
    const m0 = await T.ev(() => ({ cash: FR.state.money.cash, offer: FR.state.money.offer, pct: FR.state.money.founderPct, tab: FR.ui.panels.debug().tab }));
    assert(m0.offer && m0.offer.round === 'seed', 'no seed offer on the table: ' + JSON.stringify(m0.offer));
    if (m0.tab !== 'money') { await T.page.click('#sheetBody .tab[data-v="money"]'); await sleep(200); }
    const acc = T.page.locator('#sheetBody [data-fp="accept"]:not([disabled])');
    assert(await acc.count(), 'no Accept button on the seed offer');
    await T.shot('seed-offer');
    await acc.scrollIntoViewIfNeeded(); await acc.click();
    await T.until(() => FR.state.money.roundsDone.indexOf('seed') >= 0 && !FR.state.money.offer, null, 5000, 'the seed round to close');
    const m1 = await T.ev(() => ({ cash: FR.state.money.cash, pct: FR.state.money.founderPct, hud: document.getElementById('hudCash').textContent, ms: FR.state.money.milestone }));
    assert(Math.abs(m1.cash - (m0.cash + m0.offer.amount)) < 1, `cash after the seed is ${m1.cash}, expected ${m0.cash + m0.offer.amount}`);
    assert(m1.pct < m0.pct, 'the founder stake did not dilute');
    await T.shot('seed-accepted');
    await T.closeSheet();
    // ten weeks through the dock
    const w0 = await T.ev(() => ({ turn: FR.state.turn, cash: FR.state.money.cash }));
    for (let i = 0; i < 10; i++) await T.endTurn({ shot: i === 0 ? 'memo-week1' : i === 9 ? 'memo-week10' : null, go: i === 0, goShot: 'memo-next-step' });
    if (!T.stepGo) T.note('the first memo offered no next step');
    const w1 = await T.ev(() => ({ turn: FR.state.turn, cash: FR.state.money.cash, status: FR.state.status, week: document.getElementById('hudWeek').textContent, hist: FR.state.history.length, proj: FR.state.projects.active.length + FR.state.projects.done.length }));
    assert(w1.turn === w0.turn + 10, `turn went ${w0.turn} → ${w1.turn}, expected +10`);
    assert(w1.cash !== w0.cash, 'cash did not change over 10 weeks');
    assert(w1.week === 'Week ' + w1.turn, `the week chip shows "${w1.week}" at turn ${w1.turn}`);
    assert(w1.status === 'playing', 'the run ended: ' + w1.status);
    assert(w1.proj >= 1, 'the greenlit project vanished');
    await T.shot('after-10-weeks');
    // the small phone: HUD and the memo
    await T.page.setViewportSize(SMALL);
    await sleep(500);
    await T.fitsWidth('HUD at 360x740');
    await T.page.click('#hMemo');
    await T.until(() => FR.ui.sheetId === 'memo', null, 4000, 'the memo from the dock');
    await sleep(350);
    await T.fitsWidth('memo at 360x740');
    await T.shot('memo-360');
    await T.page.click('#sheet [data-fp="noted"]');
    T.noErrors();
  },

  // every floor through the elevator sheet, each floor's panel opened and read
  async floors(T) {
    await T.load(); await T.toMenu();
    await T.newCareer('Floor Check Labs');
    const order = FLOORS.slice(1).concat(['lobby']); // ride up from the lobby, end with the ride back down
    const seen = [];
    for (const f of order) {
      await T.ride(f, { shot: f === 'serving' });
      const d = await T.ev(() => { const w = FR.r.debug(); return { floor: w.floor, targets: w.targets, fd: !!w.floorDebug, objects: w.objects, fps: w.fps }; });
      assert(d.floor === f, `after the ride the world shows ${d.floor}, expected ${f}`);
      assert(d.targets.indexOf('elevator') >= 0, `${f} has no elevator target`);
      assert(d.objects > 0, `${f} built an empty scene`);
      await T.shot(f + '-room');
      await T.smallTargets('#tags.on .tag:not(.off)', f + ' tags');
      const how = await T.openPanel(f);
      seen.push(f + ':' + how.split(' ')[0]);
      await T.shot(f + '-panel');
      await T.smallTargets('#sheet.on button, #sheet.on summary', f + ' panel');
      await T.fitsWidth(f + ' panel');
      await T.closeSheet();
    }
    log('panels: ' + seen.join(' '));
    // the small phone: the densest panels and every boardroom tab
    await T.page.setViewportSize(SMALL);
    await sleep(400);
    for (const [hot, tab] of [['research.offers'], ['safety.evals'], ['boardroom.table', 'money'], ['boardroom.team', 'team'], ['boardroom.compute', 'compute'], ['boardroom.rivals', 'rivals']]) {
      await T.ev((h) => FR.ui.panel(h), hot);
      await T.until(([h, t]) => FR.ui.sheetId === 'fp:' + h.split('.')[0] && (!t || FR.ui.panels.debug().tab === t), [hot, tab || null], 4000, 'the ' + hot + ' panel at 360');
      await sleep(350);
      await T.fitsWidth(hot + ' panel at 360x740');
      if (hot === 'boardroom.compute') await T.shot('compute-360');
    }
    await T.closeSheet();
    const rides = await T.ev(() => FR.elevator.rides);
    assert(rides >= 9, `only ${rides} elevator rides for nine floors`);
    T.noErrors();
  },

  // save → reload → Continue; export a code → import into slot 2 → load it
  async save(T) {
    await T.load(); await T.toMenu();
    await T.newCareer('Save Check Labs');
    await T.ride('training'); // the save keeps the floor the player last rode to
    await T.endTurn(); await T.endTurn();
    const ok = await T.ev(() => FR.cmd.save());
    assert(ok !== false, 'FR.cmd.save() failed');
    const a = await T.ev(() => ({ turn: FR.state.turn, cash: FR.state.money.cash, lab: FR.state.lab.name, slot: FR.state.slot, sliders: FR.state.sliders, seed: FR.state.seed }));
    assert(a.turn === 3, `turn ${a.turn} after two End Turns`);
    await T.page.reload({ waitUntil: 'load' });
    await T.until(() => !!(window.FR && FR.menu && document.getElementById('boot').classList.contains('on')), null, 15000, 'the boot screen after reload');
    await T.toMenu();
    const cont = await T.ev(() => ({ vis: !document.getElementById('mContinue').hidden, sub: document.getElementById('mContinueSub').textContent }));
    assert(cont.vis, 'no Continue on the menu after reload');
    assert(cont.sub.indexOf(a.lab) >= 0, `Continue names "${cont.sub}", expected ${a.lab}`);
    await T.shot('menu-continue');
    await T.page.click('#mContinue');
    await T.until(() => !!(FR.state && FR.inWorld()), null, 10000, 'the lab after Continue');
    await T.settle();
    const b = await T.ev(() => ({ turn: FR.state.turn, cash: FR.state.money.cash, lab: FR.state.lab.name, slot: FR.state.slot, sliders: FR.state.sliders, seed: FR.state.seed }));
    assert(b.turn === a.turn && b.cash === a.cash, `after reload: turn ${b.turn} cash ${b.cash}, saved turn ${a.turn} cash ${a.cash}`);
    assert(b.lab === a.lab && b.slot === a.slot && b.seed === a.seed && JSON.stringify(b.sliders) === JSON.stringify(a.sliders), 'the loaded lab differs from the saved one');
    const fl = await T.ev(() => FR.r.current && FR.r.current.id);
    assert(fl === 'training', `Continue opened on ${fl}, the lab was saved on training`);
    await T.shot('continued');
    // Save and quit, then Careers: copy slot 1's code, import it into slot 2, continue slot 2
    await T.page.click('#hMenu');
    await T.until(() => FR.ui.sheetId === 'menu', null, 4000, 'the game menu');
    await T.smallTargets('#sheet.on button', 'game menu');
    await T.page.click('#gmQuit');
    await T.until(() => document.getElementById('menu').classList.contains('on'), null, 5000, 'the main menu after Save and quit');
    await T.page.click('#mCareers');
    await T.until(() => document.getElementById('careers').classList.contains('on'), null, 5000, 'the careers screen');
    await T.page.click('#carList [data-exp="0"]');
    await T.until(() => !!(document.getElementById('expCode') && document.getElementById('expCode').value), null, 4000, 'the save code');
    const code = await T.page.inputValue('#expCode');
    assert(/^FR1\./.test(code), 'the save code does not start with FR1.: ' + code.slice(0, 12));
    const direct = await T.ev(() => { const s = FR.save.read(0); return FR.save.importCode(FR.save.exportCode(s)).turn; });
    assert(direct === a.turn, `export/import round trip gives turn ${direct}`);
    await T.shot('careers-code');
    await T.page.fill('#impCode', code);
    await T.page.click('#impSlots [data-s="1"]');
    await T.page.click('#impGo');
    if (await T.page.locator('#impConfirm:not([hidden]) #impReplace').count()) await T.page.click('#impReplace');
    await T.until(() => !!FR.save.info(1), null, 5000, 'slot 2 to hold the import');
    const inf = await T.ev(() => ({ one: FR.save.info(0), two: FR.save.info(1), err: document.getElementById('impErr').hidden ? '' : document.getElementById('impErr').textContent }));
    assert(!inf.err, 'import error: ' + inf.err);
    assert(inf.two.turn === a.turn && inf.two.lab === a.lab, 'slot 2 holds ' + JSON.stringify(inf.two));
    assert(inf.one && inf.one.turn === a.turn, 'slot 1 changed after the import');
    await T.shot('imported');
    await T.page.click('#carList [data-load="1"]');
    await T.until(() => !!(FR.state && FR.inWorld() && FR.state.slot === 1), null, 10000, 'slot 2 to load');
    await T.settle();
    const c = await T.ev(() => ({ turn: FR.state.turn, cash: FR.state.money.cash, lab: FR.state.lab.name }));
    assert(c.turn === a.turn && c.cash === a.cash && c.lab === a.lab, `slot 2 loaded turn ${c.turn} cash ${c.cash}, expected turn ${a.turn} cash ${a.cash}`);
    // a week on slot 2 saves to slot 2 only
    await T.endTurn();
    const d = await T.ev(() => ({ one: FR.save.info(0).turn, two: FR.save.info(1).turn }));
    assert(d.two === a.turn + 1 && d.one === a.turn, `after a week on slot 2 the saves hold turns ${d.one} / ${d.two}`);
    T.noErrors();
  },

  // a finished run: out of cash, a final incident (both resolved by the sim through End Turn), and a held frontier
  async end(T) {
    await T.load(); await T.toMenu();
    await T.newCareer('End Check Labs');
    const checkEnd = async (kicker, cause) => {
      await T.until(() => document.getElementById('end').classList.contains('on'), null, 6000, 'the end-of-run screen');
      await sleep(400);
      const e = await T.ev(() => {
        const s = FR.state, sc = FR.sim.score(s), txt = (id) => document.getElementById(id).textContent.trim();
        return { status: s.status, cause: s.end && s.end.cause, kicker: txt('endKicker'), title: txt('endTitle'), lead: txt('endCause'), total: txt('endTotal'),
          rows: document.querySelectorAll('#endParts tr').length, parts: sc.parts.length, scTotal: sc.total, facts: document.querySelectorAll('#endFacts .stat').length,
          record: document.querySelectorAll('#endRecord li').length, lab: s.lab.name, hud: document.getElementById('hud').classList.contains('on'),
          newBtn: !!document.getElementById('endNew').offsetParent, partText: document.getElementById('endParts').innerText };
      });
      assert(e.cause === cause, `end cause is ${e.cause}, expected ${cause}`);
      assert(kicker.test(e.kicker), `end kicker reads "${e.kicker}"`);
      assert(e.title === e.lab, `end title "${e.title}" is not the lab name`);
      assert(e.lead.length > 10, 'the end screen gives no cause');
      assert(e.parts > 0 && e.rows === e.parts + 1, `score table has ${e.rows} rows for ${e.parts} parts`);
      assert(!/NaN|undefined/.test(e.partText + e.total), 'the score table shows NaN or undefined');
      const shown = Number(e.total.replace(/[−-]/, '-').replace(/,/g, ''));
      assert(shown === Math.round(e.scTotal), `end total shows ${e.total}, the score is ${e.scTotal}`);
      assert(e.facts >= 4 && e.record >= 1, 'the end facts or the frontier record are missing');
      assert(!e.hud && e.newBtn, 'the HUD is still up or Found a new lab is missing');
      await T.fitsWidth('end screen');
      return e;
    };
    // 1. out of cash: a crafted balance of $1,000, then End Turn
    await T.ev(() => { FR.state.money.cash = 1000; });
    await T.endTurn({ expectEnd: true });
    await checkEnd(/Out of cash/, 'cash');
    await T.shot('end-cash');
    const info = await T.ev(() => FR.save.info(FR.state.slot));
    assert(info && info.status === 'dead', 'the closed lab was not saved as dead: ' + JSON.stringify(info));
    // 2. Found a new lab → a crafted Agents gap of 50 in its fourth week above 30 → the final incident
    await T.page.click('#endNew');
    await T.newCareer('Final Check Labs');
    await T.ev(() => { const a = FR.state.model.skills.agents; a.cap = 70; a.safe = 20; a.critStreak = 3; });
    await T.endTurn({ expectEnd: true });
    const e2 = await checkEnd(/Final incident/, 'final');
    assert(/Agents/.test(e2.kicker), 'the final incident kicker does not name Agents: ' + e2.kicker);
    await T.shot('end-final');
    // End Turn is refused once the run is over
    const refused = await T.ev(() => FR.cmd.endTurn() === false && FR.state.status === 'dead');
    assert(refused, 'End Turn ran on a closed lab');
    // 3. a held frontier (crafted status), rendered by FR.menu.end
    await T.ev(() => { FR.state.status = 'won'; FR.state.end = { turn: FR.state.turn, cause: 'win', text: '' }; FR.menu.end(); });
    await checkEnd(/Frontier held/, 'win');
    await T.shot('end-won');
    await T.page.click('#endMenu');
    await T.until(() => document.getElementById('menu').classList.contains('on'), null, 5000, 'the menu from the end screen');
    // a closed lab is a record: no Continue; Careers shows it as Closed with a Result button that reopens the end screen
    const menu = await T.ev(() => !document.getElementById('mContinue').hidden);
    assert(!menu, 'Continue offers a closed lab');
    await T.page.click('#mCareers');
    await T.until(() => document.getElementById('careers').classList.contains('on'), null, 5000, 'the careers screen');
    const slot = await T.ev(() => FR.state.slot);
    const row = await T.ev((i) => { const b = document.querySelector(`#carList [data-load="${i}"]`); return b ? { label: b.textContent.trim(), meta: b.closest('.car-slot').textContent } : null; }, slot);
    assert(row && /Result/.test(row.label) && /Closed/.test(row.meta), 'careers row for the closed lab: ' + JSON.stringify(row));
    await T.page.click(`#carList [data-load="${slot}"]`);
    await T.until(() => document.getElementById('end').classList.contains('on'), null, 5000, 'the end screen from Careers');
    const again = await T.ev(() => ({ kicker: document.getElementById('endKicker').textContent, rows: document.querySelectorAll('#endParts tr').length }));
    assert(/Final incident/.test(again.kicker) && again.rows > 1, 'the result from Careers reads ' + JSON.stringify(again));
    T.noErrors();
  },

  async review(T) {
    const browser = T.ctx.browser();
    // 1. three.js blocked: the one-script build still boots, a lab starts, the elevator sheet opens floor panels
    {
      const X = await Run.open(browser, 'review-nothree', 6, T.src, { noThree: true });
      try {
        await X.load(); await X.toMenu();
        const st = await X.ev(() => ({ stub: !!FR.r.stub, cmd: !!FR.cmd, ui: typeof FR.ui.panel }));
        assert(st.stub && st.cmd && st.ui === 'function', 'no three.js: the build did not come up: ' + JSON.stringify(st));
        await X.ev(() => FR.cmd.newCareer({ labName: 'Stub Labs', slot: 0 }));
        await X.until(() => FR.inWorld(), null, 5000, 'the world without three.js');
        await X.page.click('#hElev');
        await X.until(() => FR.ui.sheetId === 'elevator', null, 5000, 'the elevator sheet without three.js');
        await X.page.click('#elevFloors [data-f="boardroom"]');
        await X.until(() => FR.ui.sheetId === 'fp:boardroom' && FR.elevator.floor === 'boardroom', null, 5000, 'the boardroom panel from the elevator sheet (no three.js)');
        await X.ev(() => FR.ui.sheet(null)); await X.endTurn();
        X.noErrors('no three.js');
      } finally { await X.ctx.close(); }
    }
    // 2. the rest at 390x844 with WebGL
    await T.load(); await T.toMenu();
    // the lab name field starts empty: a tap and typing gives exactly the typed name
    await T.page.click('#mNew');
    await T.until(() => document.getElementById('newCareer').classList.contains('on'), null, 5000, 'the new career screen');
    await T.page.click('#labName'); await T.page.keyboard.type('Northwind Labs'); await T.page.click('#ncStart');
    await T.until(() => !!(FR.state && FR.inWorld() && FR.r.current && FR.r.current.id === 'lobby'), null, 12000, 'the typed-name career');
    const nm = await T.ev(() => FR.state.lab.name);
    assert(nm === 'Northwind Labs', 'typed lab name came out as "' + nm + '"');
    await T.settle();
    // chips route: Cash to the Money tab, the frontier strip to Rivals, Trust to the lobby trust board
    for (const [sel, want] of [['#hudCashChip', 'fp:boardroom money'], ['#hudStrip', 'fp:boardroom rivals'], ['#hudTrustChip', 'fp:lobby trust']]) {
      await T.page.click(sel);
      await T.until((w) => FR.ui.sheetId + ' ' + FR.ui.panels.debug().tab === w, want, 4000, sel + ' → ' + want);
      await T.closeSheet(); await T.settle();
    }
    // keys under the memo: End Turn by mouse, then Space and Enter with the memo up never resolve another week
    const t0 = await T.ev(() => FR.state.turn);
    await T.page.click('#hEnd');
    await T.until((t) => FR.state.turn === t + 1 && FR.ui.sheetId === 'memo', t0, 5000, 'the memo after End Turn');
    await sleep(400);
    await T.page.keyboard.press('Space'); await sleep(250); await T.page.keyboard.press('Enter'); await sleep(600);
    const t2 = await T.ev(() => ({ turn: FR.state.turn, sheet: FR.ui.sheetId }));
    assert(t2.turn === t0 + 1 && t2.sheet === 'memo', 'a key press under the memo resolved a week: ' + JSON.stringify(t2));
    await T.closeSheet(); await T.settle();
    // rent jumps: +250 PF from the Serving panel
    await T.ev(() => FR.ui.panel('serving.wall')); await sleep(300);
    const r0 = await T.ev(() => FR.state.compute.rentPF);
    const jump = T.page.locator('#sheetBody .fp-jump [data-fp="rent"]', { hasText: '+250 PF' });
    assert(await jump.count(), 'no +250 PF rent button');
    await jump.scrollIntoViewIfNeeded(); await jump.click();
    await T.until((r) => FR.state.compute.rentPF === r + 250, r0, 3000, 'rent +250 PF');
    await T.closeSheet(); await T.settle();
    // portrait framing: every boardroom target (compute and team on the side walls included) has its tag on screen
    await T.ride('boardroom');
    const off = await T.ev(() => FR.r.targets().filter(t => FR.r.live(t.id)).map(t => { const g = document.querySelector(`#tags .tag[data-t="${t.id}"]`); const s = FR.r.screenOf(t.id); return { id: t.id, off: !g || g.classList.contains('off'), x0: s.x0, x1: s.x1 }; })
      .filter(o => o.off || o.x0 < 0 || o.x1 > innerWidth));
    assert(!off.length, 'boardroom targets off screen at 390x844: ' + JSON.stringify(off));
    // a focused screen's heading clears the chips and the frontier strip with its panel open
    await T.ev(() => FR.r.focus('boardroom.rivals'));
    await T.until(() => FR.ui.sheetId === 'fp:boardroom' && !FR.r.debug().gliding, null, 6000, 'the rival wall focus');
    await sleep(300);
    const clr = await T.ev(() => ({ top: FR.r.screenOf('boardroom.rivals').y0, strip: document.getElementById('hudStrip').getBoundingClientRect().bottom }));
    assert(clr.top >= clr.strip - 1, 'the rival wall sits under the frontier strip: ' + JSON.stringify(clr));
    await T.shot('rivals-focus');
    await T.closeSheet(); await T.settle();
    // GPU buffers: two tours of the nine floors free what they build (InstancedMesh buffers included)
    const bufs = await T.ev(async () => {
      const gl = FR.r.renderer.getContext(); let n = 0; const c = gl.createBuffer.bind(gl), d = gl.deleteBuffer.bind(gl);
      gl.createBuffer = () => { n++; return c(); }; gl.deleteBuffer = (b) => { if (b) n--; return d(b); };
      const out = [];
      for (let k = 0; k < 2; k++) { for (const f of FR.HQ_FLOORS) { FR.r.loadFloor(f); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); } out.push(n); }
      gl.createBuffer = c; gl.deleteBuffer = d; FR.r.loadFloor('boardroom');
      return out;
    });
    assert(bufs[1] - bufs[0] <= 4, 'GPU buffers grow on floor changes: ' + JSON.stringify(bufs));
    // a ride under way never lands after Save and quit; the next lab starts clean in its lobby
    await T.ev(() => FR.ui.goFloor('lobby', () => FR.ui.panel('lobby.news')));
    await sleep(150);
    await T.ev(() => FR.cmd.quit());
    await sleep(3000);
    const q = await T.ev(() => ({ sheet: FR.ui.sheetId, riding: FR.elevator.riding, paused: FR.r.paused, menu: document.getElementById('menu').classList.contains('on') }));
    assert(!q.sheet && !q.riding && q.paused && q.menu, 'the ride landed behind the menu: ' + JSON.stringify(q));
    await T.ev(() => FR.cmd.newCareer({ labName: 'Clean Labs', slot: 1 }));
    await sleep(2500);
    const c = await T.ev(() => ({ sheet: FR.ui.sheetId, floor: FR.r.current.id, end: FR.ui.endWhy(), hq: FR.state.hq.floor }));
    assert(!c.sheet && c.floor === 'lobby' && !c.end && c.hq === 'lobby', 'the new lab inherited the old ride: ' + JSON.stringify(c));
    // careers at 412 wide: each row shows its lab name
    await T.ev(() => FR.cmd.quit());
    await T.page.setViewportSize({ width: 412, height: 915 });
    await T.page.click('#mCareers');
    await T.until(() => document.getElementById('careers').classList.contains('on'), null, 5000, 'the careers screen');
    const widths = await T.ev(() => Array.from(document.querySelectorAll('.car-slot:not(.empty) .set-save-t')).map(e => Math.round(e.getBoundingClientRect().width)));
    assert(widths.length && widths.every(w => w > 200), 'careers rows hide the lab name at 412 wide: ' + JSON.stringify(widths));
    await T.shot('careers-412');
    T.noErrors();
  }
};

// ---------- contact sheet (python3 + PIL) ----------
const CONTACT_PY = `
import os, sys
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
files = sorted(f for f in os.listdir(d) if f.endswith('.png') and f != 'contact.png')
if not files: sys.exit(0)
S, CW, CH, LH, COLS, PAD = 0.4, 156, 338, 26, 8, 6
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * (CW + PAD) + PAD, rows * (CH + LH + PAD) + PAD), (24, 28, 34))
dr = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('DejaVuSans.ttf', 10)
except Exception: font = ImageFont.load_default()
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).convert('RGB')
    im = im.resize((max(1, int(im.width * S)), max(1, int(im.height * S))), Image.LANCZOS)
    x, y = PAD + (i % COLS) * (CW + PAD), PAD + (i // COLS) * (CH + LH + PAD)
    name = f[:-4]
    dr.text((x, y), name[:30], fill=(220, 226, 232), font=font)
    if len(name) > 30: dr.text((x, y + 12), name[30:60], fill=(220, 226, 232), font=font)
    sheet.paste(im, (x, y + LH))
sheet.save(out)
print(len(files))
`;
function contactSheet() {
  const r = spawnSync('python3', ['-c', CONTACT_PY, SHOTS, path.join(SHOTS, 'contact.png')], { encoding: 'utf8' });
  if (r.status !== 0) console.log('note: contact sheet not made: ' + String(r.stderr || r.error || '').trim().split('\n').pop());
  else log(`contact sheet: ${String(r.stdout).trim()} shots → test/shots/contact.png`);
}

// ---------- main ----------
async function main() {
  const want = String(process.env.SECTION || 'all').split(',').map(s => s.trim()).filter(Boolean);
  const list = want.indexOf('all') >= 0 ? ALL.slice() : want;
  const bad = list.filter(s => !SECTIONS[s]);
  if (bad.length) { console.log(`FAIL setup: unknown section ${bad.join(', ')} (use ${ALL.join('|')})`); process.exit(2); }
  if (process.env.BUILD === '1') execSync(`node "${path.join(ROOT, 'build.js')}"`, { stdio: VERBOSE ? 'inherit' : 'ignore' });
  if (!fs.existsSync(FILE)) { console.log(`FAIL setup: ${path.relative(process.cwd(), FILE)} is missing (run node build.js)`); process.exit(2); }
  const src = { html: fs.readFileSync(FILE, 'utf8'), three: fs.readFileSync(THREE_FILE, 'utf8') };
  if (!SKIP_SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  let fails = 0;
  for (const name of list) {
    const idx = ALL.indexOf(name) + 1;
    if (!SKIP_SHOTS) fs.readdirSync(SHOTS).filter(f => f.indexOf(`${idx}-${name}-`) === 0).forEach(f => fs.unlinkSync(path.join(SHOTS, f)));
    const t0 = Date.now();
    let T = null, why = null, timer = null;
    try {
      T = await Run.open(browser, name, idx, src);
      await Promise.race([SECTIONS[name](T), new Promise((_, rej) => { timer = setTimeout(() => rej(new Fail(`section took over ${SECTION_MS / 1000}s`)), SECTION_MS); })]);
    } catch (e) {
      why = e instanceof Fail ? e.message : pwWhy(e);
      if (T && T.errors.length && !/console error/.test(why)) why += ` [also ${T.errors.length} console error(s): ${T.errors[0]}]`;
      if (T && !SKIP_SHOTS) { try { await T.shot('FAILED'); } catch (e2) { /* page gone */ } }
    } finally {
      clearTimeout(timer);
      if (T) { try { await T.ctx.close(); } catch (e) { /* already closed */ } }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (why) { fails++; console.log(`FAIL ${name}: ${why}`); } else console.log(`ok ${name}` + (VERBOSE ? ` (${secs}s)` : ''));
    if (VERBOSE && T && T.notes.length) T.notes.forEach(n => console.log(`    note ${name}: ${n}`));
    if (VERBOSE && T) Object.keys(T.warnings).forEach(k => console.log(`    console.warn ×${T.warnings[k]} ${name}: ${k}`));
  }
  await browser.close();
  if (!SKIP_SHOTS) contactSheet();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.log('FAIL setup: ' + String((e && e.message) || e).split('\n')[0]); process.exit(2); });

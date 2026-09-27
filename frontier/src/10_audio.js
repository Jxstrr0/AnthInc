// Audio (ported from Mogul audio/synth.js): WebAudio synth, "cool night office". Everything synthesized, no assets.
// OFF by default: FR.audio.enabled is false until the settings toggle turns it on; the choice persists in localStorage
// 'frontier.settings' as { sound: true|false } (merged with whatever else the menu keeps there). No AudioContext exists
// while sound is off. Reader: plays on the bus, never changes the game.
// play(name[, delay]): one-shots — UI: tap glide open close confirm error good alert · elevator: tick chime doors ·
//   turn: endturn · title (boot sting). Unknown names are a silent no-op. Cap 8 voices; the same name within 40 ms plays once.
// Beds (optional): bedStart() then the loaded floor picks a bed (street / hall / office); bedStop(). Music: music('menu') /
//   music(null). Suspends on page hide. Auto cues (A.auto): End Turn plays 'endturn', then 'alert' or 'good' by what happened.
// CPU: all sound runs in the audio graph; JS only runs a 200 ms scheduler for beds and the theme.
(function (FR) {
  const A = FR.audio = { ctx: null, bed: null, auto: true };
  const MAXV = 8, LEVEL = 1.2, AMB = 1.3, XF = 1.5, KEY = 'frontier.settings';
  let G = null, enabled = false, bedsOn = false, beds = [], theme = null, timer = 0, hold = 0;
  const last = {};
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- settings ----
  function stored() { try { const r = localStorage.getItem(KEY); const o = r ? JSON.parse(r) : null; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function persist(on) {
    const mem = FR.settings && typeof FR.settings === 'object' ? FR.settings : null; if (mem) mem.sound = on;
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, stored(), mem || {}, { sound: on }))); } catch (e) { /* private mode / full: the toggle still works this session */ }
  }

  // ---- graph: master -> limiter -> out; buses sfx / amb / mus; one shared noise buffer ----
  function graph(ctx) {
    const g = { ctx, voices: 0 };
    g.master = gain(ctx, LEVEL);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
    // post gain cancels Chromium's automatic makeup gain: unity below -6 dBFS, ceiling ~ -5 dBFS
    g.master.connect(lim); lim.connect(gain(ctx, 0.68, ctx.destination));
    g.sfx = gain(ctx, 1, g.master); g.amb = gain(ctx, AMB, g.master); g.mus = gain(ctx, 0.5, g.master);
    const n = Math.round(ctx.sampleRate * 7.3), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let s = 22222; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; d[i] = s / 2147483648 - 1; }
    g.noise = b; return g;
  }
  function gain(ctx, v, to) { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  function filt(ctx, type, f, q, to) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (to) b.connect(to); return b; }
  // click-free envelope: 0 -> pk (linear), exponential decay, linear to 0; returns stop time
  function env(p, t, a, dur, pk) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk, t + a);
    p.exponentialRampToValueAtTime(pk * 0.002 + 1e-5, t + Math.max(dur, a + 0.01)); p.linearRampToValueAtTime(0, t + dur + 0.012);
    return t + dur + 0.02;
  }
  // v = voice {ctx, g, out, end, last}: tracks the source that ends last
  function src(v, s, t, end, off) { s.start(t, off || 0); s.stop(end); if (end >= v.end) { v.end = end; v.last = s; } return s; }
  function tone(v, t, f, dur, pk, o) {
    o = o || {}; const ctx = v.ctx, os = ctx.createOscillator(), g = gain(ctx, 0, o.out || v.out);
    os.type = o.type || 'sine'; os.frequency.setValueAtTime(f, t); if (o.det) os.detune.value = o.det;
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.slide || dur));
    let head = g; if (o.lp) { head = filt(ctx, 'lowpass', o.lp, o.q || 0.7, g); if (o.lpTo) head.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur * 0.6); }
    os.connect(head); const end = env(g.gain, t, o.a || 0.005, dur, pk); src(v, os, t, end);
    if (o.vib) { const l = ctx.createOscillator(), lg = gain(ctx, o.vib[1], os.frequency); l.frequency.value = o.vib[0]; l.connect(lg); src(v, l, t, end); }
    return os;
  }
  // 1:1 FM electric piano: warm tine, brightness decays
  function ep(v, t, m, dur, pk, bright, out) {
    const ctx = v.ctx, f = hz(m), c = ctx.createOscillator(), mo = ctx.createOscillator(), mg = ctx.createGain(), g = gain(ctx, 0, out || v.out);
    c.frequency.value = f; mo.frequency.value = f; const i0 = f * (bright || 1);
    mg.gain.setValueAtTime(i0, t); mg.gain.exponentialRampToValueAtTime(i0 * 0.1 + 1, t + 0.5);
    mo.connect(mg); mg.connect(c.frequency); c.connect(g); const end = env(g.gain, t, 0.004, dur, pk); src(v, mo, t, end); src(v, c, t, end);
  }
  function noise(v, t, dur, pk, type, f, q, o) {
    o = o || {}; const ctx = v.ctx, s = ctx.createBufferSource(), g = gain(ctx, 0, o.out || v.out);
    s.buffer = v.g.noise; s.loop = true; const fl = filt(ctx, type, f, q, g);
    if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + (o.slide || dur));
    if (o.back) fl.frequency.exponentialRampToValueAtTime(o.back, t + dur);
    if (o.pan != null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(o.pan, t); p.pan.linearRampToValueAtTime(-o.pan, t + dur); g.disconnect(); g.connect(p); p.connect(o.out || v.out); }
    s.connect(fl); src(v, s, t, env(g.gain, t, o.a || 0.003, dur, pk), (t * 0.37) % 2.5);
  }
  const kick = (v, t, pk, out) => tone(v, t, 140, 0.32, pk, { to: 44, slide: 0.09, a: 0.004, out });
  const chord = (v, t, ms, dur, pk, br, gap) => ms.forEach((m, i) => ep(v, t + i * (gap || 0), m, dur, pk, br));

  // ---- one-shots ----
  const S = {
    tap: (v, t) => { tone(v, t, 1500, 0.04, 0.14, { to: 650, slide: 0.03, a: 0.002 }); tone(v, t, 230, 0.06, 0.1, { a: 0.002 }); },
    glide: (v, t) => noise(v, t, 0.55, 0.22, 'bandpass', 320, 1.4, { to: 1500, slide: 0.28, back: 420, a: 0.22, pan: -0.3 }),
    open: (v, t) => { ep(v, t, 67, 0.35, 0.12, 0.9); ep(v, t + 0.07, 74, 0.5, 0.12, 0.9); noise(v, t, 0.2, 0.04, 'bandpass', 600, 1, { to: 1400, a: 0.08 }); },
    close: (v, t) => { ep(v, t, 74, 0.3, 0.1, 0.6); ep(v, t + 0.07, 67, 0.45, 0.1, 0.5); noise(v, t, 0.18, 0.035, 'bandpass', 1200, 1, { to: 500, a: 0.05 }); },
    confirm: (v, t) => { chord(v, t, [72, 76, 79], 0.7, 0.1, 1.1, 0.06); tone(v, t, hz(48), 0.4, 0.12, { type: 'triangle', lp: 500 }); },
    error: (v, t) => { tone(v, t, 196, 0.16, 0.2, { type: 'triangle', lp: 900 }); tone(v, t + 0.15, 185, 0.3, 0.2, { type: 'triangle', lp: 700 }); },
    // a gain: a rising major arpeggio on the tine, a faint bell on top
    good: (v, t) => { ep(v, t, 76, 0.3, 0.09, 1.4); ep(v, t + 0.08, 79, 0.35, 0.09, 1.4); ep(v, t + 0.16, 84, 0.9, 0.1, 1.6); tone(v, t + 0.16, 2637, 0.5, 0.012); tone(v, t, hz(52), 0.5, 0.08, { type: 'triangle', lp: 600 }); },
    // an incident: a restrained two-tone, twice, lowpassed, over a low swell (never a siren)
    alert: (v, t) => {
      [0, 0.42].forEach(d => { tone(v, t + d, 880, 0.17, 0.11, { type: 'triangle', lp: 2200, a: 0.01 }); tone(v, t + d + 0.19, 698.5, 0.2, 0.11, { type: 'triangle', lp: 2000, a: 0.01 }); });
      tone(v, t, hz(38), 1.0, 0.14, { type: 'triangle', lp: 300, a: 0.15 });
    },
    // End Turn: the week closes. A soft low thud, a brush, a settled open fifth
    endturn: (v, t) => { kick(v, t, 0.2); noise(v, t, 0.3, 0.05, 'bandpass', 2200, 0.8, { to: 700, a: 0.01 }); chord(v, t + 0.05, [55, 62, 67], 0.9, 0.06, 0.7, 0.04); tone(v, t + 0.05, hz(43), 0.8, 0.1, { type: 'triangle', lp: 400 }); },
    tick: (v, t) => { tone(v, t, 1800, 0.03, 0.1, { a: 0.001 }); noise(v, t, 0.025, 0.12, 'bandpass', 3000, 3); },
    chime: (v, t) => { ep(v, t, 76, 1.4, 0.13, 1.4); ep(v, t + 0.3, 72, 1.8, 0.13, 1.4); },
    doors: (v, t) => { noise(v, t, 0.65, 0.28, 'lowpass', 300, 0.8, { to: 800, a: 0.12 }); tone(v, t, 62, 0.6, 0.08, { a: 0.08 }); tone(v, t + 0.6, 95, 0.1, 0.18, { a: 0.002, lp: 400 }); },
    // title sting: a low detuned saw/triangle swell through a lowpass that opens and closes, a bright bell hit on top
    title: (v, t) => {
      const ctx = v.ctx, lp = filt(ctx, 'lowpass', 160, 0.9), g = gain(ctx, 0, v.out); lp.connect(g);
      lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 1.1); lp.frequency.exponentialRampToValueAtTime(300, t + 3.2);
      const end = env(g.gain, t, 1.1, 3.2, 0.2);
      [[55, 'sawtooth'], [55.6, 'sawtooth'], [82.4, 'triangle'], [110.3, 'triangle']].forEach(([f, type]) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(lp); src(v, o, t, end); });
      noise(v, t, 1.3, 0.05, 'bandpass', 400, 0.9, { to: 3000, slide: 1.1, a: 1 });
      kick(v, t + 0.55, 0.2); tone(v, t + 0.55, 880, 1.85, 0.06, { a: 0.02 }); tone(v, t + 0.55, 1318.5, 1.9, 0.05, { a: 0.02 });
      ep(v, t + 0.55, 81, 1.6, 0.04, 1.6);
    }
  };

  function voice(g, fn, delay) {
    if (g.voices >= MAXV) return;
    const v = { ctx: g.ctx, g, out: gain(g.ctx, 1, g.sfx), end: 0, last: null };
    fn(v, g.ctx.currentTime + 0.01 + (delay || 0));
    if (!v.last) { v.out.disconnect(); return; }
    g.voices++; v.last.onended = () => { g.voices--; try { v.out.disconnect(); } catch (e) { /* already gone */ } };
  }

  // ---- beds: continuous layers + events scheduled ahead by pump() ----
  // street: lobby (traffic swells through the glass) · hall: the compute floors (fan wash, mains hum) · office: HVAC,
  // a keyboard now and then · quiet: anything else
  function makeBed(g, kind) {
    const ctx = g.ctx, t0 = ctx.currentTime, out = gain(ctx, 0, g.amb), loops = [];
    const v = { ctx, g, out, end: 0, last: null };
    const loopNoise = (type, f, q, lvl) => { const s = ctx.createBufferSource(), gg = gain(ctx, lvl, out); s.buffer = g.noise; s.loop = true; loops.length && (s.loopEnd = 7.3 - (loops.length * 1.37) % 2.9); s.connect(filt(ctx, type, f, q, gg)); s.start(t0, Math.random() * 2); loops.push(s); return gg; };
    const lfo = (param, rate, depth) => { const o = ctx.createOscillator(); o.frequency.value = rate; o.connect(gain(ctx, depth, param)); o.start(t0); loops.push(o); };
    const hum = (f, lvl) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain(ctx, lvl, out)); o.start(t0); loops.push(o); };
    let step = 0, fn = null, next = t0 + 0.05, i = 0;
    if (kind === 'street') {
      loopNoise('lowpass', 380, 0.5, 0.06);
      lfo(loopNoise('bandpass', 450, 0.7, 0.018).gain, 0.06, 0.012);
      let car = t0 + 0.8; step = 0.5;
      fn = (k, t) => { if (t >= car) { noise(v, t, 3.2, 0.07, 'bandpass', 220, 1.1, { to: 650, slide: 1.6, back: 240, a: 1.5, pan: Math.random() < 0.5 ? -0.7 : 0.7 }); car = t + 4 + Math.random() * 5; } };
    } else if (kind === 'hall') {
      loopNoise('bandpass', 900, 0.4, 0.05); loopNoise('lowpass', 220, 0.6, 0.06);
      lfo(loopNoise('highpass', 4000, 0.5, 0.008).gain, 0.11, 0.004);
      hum(50, 0.012); hum(100, 0.006); hum(150, 0.003);
    } else if (kind === 'office') {
      loopNoise('lowpass', 260, 0.5, 0.035); hum(60, 0.006); hum(120, 0.003);
      step = 0.25;
      fn = (k, t) => { if (Math.random() < 0.06) { const n = 2 + Math.floor(Math.random() * 5); for (let j = 0; j < n; j++) noise(v, t + j * (0.08 + Math.random() * 0.06), 0.02, 0.05, 'bandpass', 2600 + Math.random() * 900, 4); } };
    } else {
      loopNoise('lowpass', 120, 0.5, 0.07);
      lfo(loopNoise('bandpass', 700, 0.5, 0.016).gain, 0.07, 0.01);
    }
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(1, t0 + XF);
    return {
      kind, out,
      sched(until) { if (!fn) return; while (next < until) { fn(i++, next); next += step; } },
      stop(fade) {
        const t = ctx.currentTime; fn = null; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + fade);
        loops.forEach((s) => { try { s.stop(t + fade + 0.05); } catch (e) { /* stopped */ } });
        setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } }, (fade + 0.3) * 1000);
      }
    };
  }

  // ---- menu theme: sparse 4-bar EP loop, 72 bpm, Am9 Fmaj7 Cmaj7 G6 ----
  function makeTheme(g) {
    const ctx = g.ctx, t0 = Math.max(ctx.currentTime + 0.05, hold), out = gain(ctx, 0, g.mus), v = { ctx, g, out, end: 0, last: null };
    const E = 60 / 72 / 2, CH = [[57, 60, 64, 67, 71], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 64]], ROOT = [45, 41, 36, 43];
    const MEL = { 3: 76, 4: 74, 12: 72, 19: 71, 20: 67, 28: 69 };
    let next = t0, i = 0, alive = true;
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(1, t0 + 1.5);
    return {
      sched(until) {
        while (alive && next < until) {
          const s = i % 32, bar = s >> 3, e = s % 8, t = next;
          if (e === 0) { chord(v, t, CH[bar], 3.2, 0.04, 0.5, 0.02); tone(v, t, hz(ROOT[bar]), 2.2, 0.12, { a: 0.02 }); }
          if (e === 4) tone(v, t, hz(ROOT[bar] + 7), 1.2, 0.06, { a: 0.02 });
          if (MEL[s]) ep(v, t, MEL[s], 1.4, 0.05, 1.0);
          next += E; i++;
        }
      },
      stop(fade) {
        alive = false; const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } }, (fade + 3) * 1000);
      }
    };
  }

  function pump() {
    if (!G || G.ctx.state !== 'running') return;
    const until = G.ctx.currentTime + 0.45;
    beds.forEach((b) => b.sched(until)); if (theme) theme.sched(until);
  }
  const KIND = { lobby: 'street', serving: 'hall', training: 'hall', safety: 'office', research: 'office', proj1: 'office', proj2: 'office', proj3: 'office', boardroom: 'office' };
  const kindOf = (floor) => KIND[floor] || 'quiet';

  // ---- public API ----
  // init(): builds the graph. Only while enabled (no AudioContext exists with sound off); call it from a user gesture.
  A.init = function () {
    if (G || !enabled) return;
    try { G = graph(new (window.AudioContext || window.webkitAudioContext)()); } catch (e) { G = null; return; }
    A.ctx = G.ctx; A.master = G.master; G.master.gain.value = LEVEL;
    timer = setInterval(pump, 200);
  };
  A.resume = function () { if (G && enabled && G.ctx.state === 'suspended' && !document.hidden) G.ctx.resume().catch(() => {}); };
  A.suspend = function () { if (G && G.ctx.state === 'running') G.ctx.suspend().catch(() => {}); };
  // enabled: the sound setting. Setting it persists the choice ('frontier.settings'.sound) and fades the master.
  function setEnabled(x, save) {
    x = !!x; if (save !== false) persist(x); if (x === enabled) return; enabled = x;
    if (enabled) { A.init(); A.resume(); }
    if (!G) return;
    const t = G.ctx.currentTime, p = G.master.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(enabled ? LEVEL : 0, t + 0.08);
    if (!enabled) setTimeout(() => { if (!enabled) A.suspend(); }, 150);
  }
  Object.defineProperty(A, 'enabled', { enumerable: true, get: () => enabled, set: (x) => setEnabled(x, true) });
  Object.defineProperty(A, 'on', { enumerable: false, get: () => enabled, set: (x) => setEnabled(x, true) }); // Mogul's name, for ported menu code
  A.setEnabled = setEnabled;
  A.toggle = function () { setEnabled(!enabled, true); return enabled; };
  Object.defineProperty(A, 'voices', { enumerable: true, get: () => (G ? G.voices : 0) });
  A.play = function (name, delay) {
    const fn = S[name]; if (!fn || !enabled) return;
    if (!G) A.init(); if (!G) return;
    if (G.ctx.state !== 'running') { A.resume(); return; } // the first sound after a wake is dropped rather than queued
    const t = G.ctx.currentTime; if (!delay && last[name] && t - last[name] < 0.04) return; last[name] = t;
    if (name === 'title') hold = t + 2.2; // the theme fades in under the bell's tail
    if ((name === 'alert' || name === 'endturn') && navigator.vibrate) try { navigator.vibrate(name === 'alert' ? [30, 60, 30] : 25); } catch (e) { /* no vibration */ }
    voice(G, fn, delay);
  };
  A.music = function (name) {
    if (!G) return;
    if (name === 'menu') { if (!theme) { theme = makeTheme(G); pump(); } return; }
    if (theme) { theme.stop(1.2); theme = null; }
  };
  A.bedStart = function () { A.music(null); bedsOn = true; if (FR.r && FR.r.current) A.bedTint(FR.r.current.id); };
  A.bedStop = function () { bedsOn = false; beds.forEach((b) => b.stop(XF)); beds = []; A.bed = null; };
  A.bedTint = function (floor) {
    if (!G || !bedsOn) return; const k = kindOf(floor); if (A.bed === k) return;
    beds.forEach((b) => b.stop(XF)); beds = [makeBed(G, k)]; A.bed = k; pump();
  };

  // ---- bus ----
  FR.on('hq:floor', (d) => { if (bedsOn && d) A.bedTint(d.floorId); });
  // End Turn: the week closes, then one cue for the most serious thing that happened
  const BAD = { 'model:incident': 1, 'model:final': 1, 'money:bankrupt': 1, 'run:dead': 1 };
  FR.on('turn:ended', (d) => {
    if (!A.auto || !enabled) return; A.play('endturn');
    const ev = (d && d.report && d.report.events) || [];
    let bad = false, good = false;
    for (let i = 0; i < ev.length; i++) { const e = ev[i], ty = e && e.type; if (BAD[ty]) bad = true;
      else if (ty === 'money:round' || ty === 'research:tier' || ty === 'run:won' || (ty === 'project:done' && e.ok) || (ty === 'market:first' && e.by === 'player')) good = true; }
    if (bad) A.play('alert', 0.45); else if (good) A.play('good', 0.45);
  });
  // pause: a hidden page suspends the context; it resumes on return when sound is on
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) A.suspend(); else A.resume(); });
    window.addEventListener('pagehide', () => A.suspend());
    // browsers start a context suspended until a gesture: the first touch after load (sound on) wakes it before the tap's sound
    const wake = () => { if (enabled) { A.init(); A.resume(); } };
    window.addEventListener('pointerdown', wake, { capture: true, passive: true });
    window.addEventListener('keydown', wake, { capture: true, passive: true });
  }
  // the saved setting (off unless the player turned it on)
  enabled = !!((FR.settings && typeof FR.settings === 'object' && 'sound' in FR.settings) ? FR.settings.sound : stored().sound);

  A.names = () => Object.keys(S).concat(['bed:street', 'bed:hall', 'bed:office', 'bed:quiet', 'theme:menu']);
  // probe hook: render one sound/bed/theme into an OfflineAudioContext, resolves an AudioBuffer (works with sound off)
  A._renderOffline = function (name, seconds, sr) {
    sr = sr || 48000; const off = new OfflineAudioContext(2, Math.round(sr * seconds), sr), g = graph(off);
    g.master.gain.value = LEVEL; g.amb.gain.value = AMB;
    if (name.startsWith('bed:')) makeBed(g, name.slice(4)).sched(seconds);
    else if (name === 'theme:menu') makeTheme(g).sched(seconds);
    else if (S[name]) voice(g, S[name]);
    return off.startRendering();
  };
  A.debug = () => ({ ctx: !!G, state: G && G.ctx.state, voices: A.voices, enabled, bed: A.bed, music: !!theme, auto: A.auto, timer: !!timer });
})(window.FR);

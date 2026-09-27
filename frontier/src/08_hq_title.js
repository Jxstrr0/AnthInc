// Title scene (ported from Mogul render/title.js): the lab tower at night behind the boot and menu screens. A glass tower,
// nine floors (two window rows each), a rooftop sign plate reading FRONTIER, a red aircraft beacon, a wet street, the city.
// Own scene + camera, rendered through the FR.r.cinematic hook instead of the floor (no tags, picking or hints while it
// runs). Camera cranes up the tower over ~14 s then idles (reduced motion: starts at the top). Lit floors mirror the
// latest save: the departments are lit, a project floor only while a project runs in its slot, the serving floor dark
// after an incident. No save: a new building, most floors dark.
// start() on boot and whenever the menu opens; stop() (entering the world) disposes the whole scene. body.title-on while active.
(function (FR) {
  const R = FR.r;
  const T = FR.title = { active: false, t: 0, scene: null, cam: null };
  if (!R || R.stub) { T.start = T.stop = T.restart = function () {}; T.debug = () => ({ active: false, stub: true }); return; }
  const FLOORS = FR.HQ_FLOORS, ROWS = FLOORS.length * 2, FH = 3.4, TW = 14, TD = 14, TH = ROWS * FH + 2.4, COLS = 6;
  const CRANE = 14; // seconds of crane-up before idle
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
  const A = { eye: new THREE.Vector3(19, 2.4, 37), look: new THREE.Vector3(0, 16, 0) }, B = { eye: new THREE.Vector3(20, 50, 34), look: new THREE.Vector3(0, TH - 6, 0) };
  const eye = new THREE.Vector3(), look = new THREE.Vector3();
  const smooth = (x) => { x = FR.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const DARK = 0x0b0f14, DIM = 0x141b24; // unlit glass, a screen left on
  const GLASS = [0x0b0f14, 0x0d131a, 0x10171f]; // unlit panes: the dark glass catches a little sky, unevenly

  function latestSave() {
    let best = -1, bt = -1; const n = (FR.save && FR.save.SLOTS) || 3;
    for (let i = 0; i < n; i++) { let d = null; try { d = FR.save.info(i); } catch (e) { d = null; } if (d && (d.savedAt || 0) >= bt) { bt = d.savedAt || 0; best = i; } }
    if (best < 0) return null; try { return FR.save.read(best); } catch (e) { return null; }
  }
  // floor id → light level 0..1 (share of lit windows)
  function litSet(save) {
    const lit = { lobby: 1, training: 0.35, boardroom: 0.5 };
    if (!save || !save.sliders) return lit;
    lit.lobby = 1; lit.boardroom = 0.9;
    FR.ALLOCS.forEach(a => { lit[a] = 0.35 + 0.6 * Math.min(1, (save.sliders[a] || 0) / 40); });
    const act = (save.projects && save.projects.active) || [];
    ['proj1', 'proj2', 'proj3'].forEach((id, i) => { lit[id] = act[i] ? 0.85 : 0; });
    // an incident in the last three turns: the serving floor goes dark (the HQ shows the same)
    let last = 0; const sk = save.model && save.model.skills;
    if (sk) FR.SKILLS.forEach(k => ((sk[k] && sk[k].incidents) || []).forEach(t => { if (t > last) last = t; }));
    if (last && save.turn <= last + 3) lit.serving = 0;
    return lit;
  }
  function gradTex(stops, w, h) { const c = document.createElement('canvas'); c.width = w || 4; c.height = h || 256; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, c.height); stops.forEach(s => g.addColorStop(s[0], s[1])); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; }
  function radialTex(rgb) { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.35, `rgba(${rgb},.35)`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); }
  // the rooftop plate: board blue-white letters, Archivo 800 condensed (the display face), system fallback until it loads
  function drawSign(c, text) {
    const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
    const face = (n) => `800 ${n}px Archivo,"IBM Plex Sans",system-ui,sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; let fs = 150; x.font = face(fs);
    try { x.letterSpacing = '18px'; } catch (e) { /* older canvas: no tracking */ }
    while (x.measureText(text).width > 940 && fs > 40) { fs -= 6; x.font = face(fs); }
    x.shadowColor = '#4f93d9'; x.shadowBlur = 36; x.fillStyle = '#8ec0f2'; x.fillText(text, 512, 100); x.shadowBlur = 0; x.fillStyle = '#eef6ff'; x.fillText(text, 512, 100);
  }
  function signTex(text) { const c = document.createElement('canvas'); c.width = 1024; c.height = 192; drawSign(c, text); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; }
  function streakTex() { const c = document.createElement('canvas'); c.width = 8; c.height = 32; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 32); g.addColorStop(0, 'rgba(200,215,240,0)'); g.addColorStop(0.5, 'rgba(200,215,240,.9)'); g.addColorStop(1, 'rgba(200,215,240,0)'); x.fillStyle = g; x.fillRect(2, 0, 4, 32); return new THREE.CanvasTexture(c); }

  T.build = function () {
    const save = latestSave(), lit = litSet(save), rng = FR.rng(2026);
    const S = T.scene = new THREE.Scene(); S.fog = new THREE.FogExp2(0x070a10, 0.011);
    T.cam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    // sky dome + ground: deep blue night, a cold city haze at the horizon
    const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 16, 10), new THREE.MeshBasicMaterial({ map: gradTex([[0, '#02040a'], [0.42, '#08101e'], [0.5, '#16243a'], [0.53, '#080b10'], [1, '#040507']]), side: THREE.BackSide, fog: false })); S.add(sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshPhongMaterial({ color: 0x0a0c10, shininess: 60, specular: 0x2c3440 })); ground.rotation.x = -Math.PI / 2; S.add(ground);
    // wet-street glow strips (fake reflections of the sign + the lobby)
    const glow = new THREE.MeshBasicMaterial({ color: 0x4f93d9, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(6, 26), glow); strip.rotation.x = -Math.PI / 2; strip.position.set(3, 0.02, 20); S.add(strip);
    const strip2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 12), new THREE.MeshBasicMaterial({ color: 0xdde8ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false })); strip2.rotation.x = -Math.PI / 2; strip2.position.set(0, 0.02, TD / 2 + 7); S.add(strip2);
    // lights
    S.add(new THREE.HemisphereLight(0x22324e, 0x06070a, 0.55));
    const moon = new THREE.DirectionalLight(0x6f86c8, 0.3); moon.position.set(-40, 60, -30); S.add(moon);
    const signLight = new THREE.PointLight(0x4f93d9, 1.6, 40, 1.6); signLight.position.set(0, TH + 2.4, TD / 2 + 2); S.add(signLight);
    [[-9, 14], [11, 20]].forEach(([x, z]) => { const l = new THREE.PointLight(0xffc98a, 0.8, 20, 1.8); l.position.set(x, 5.2, z); S.add(l); R.cyl(S, 0.08, 0.1, 5.4, 0x1a1e24, x, 2.7, z, 6); const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('255,201,138'), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); h.scale.set(3, 3, 1); h.position.set(x, 5.3, z); S.add(h); });
    // the tower: a dark glass core, graphite corner columns, slab edges between floors, a parapet and a glass lobby
    const tw = new THREE.Group(); S.add(tw);
    R.box(tw, TW, TH, TD, 0x0d131b, 0, TH / 2, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => R.box(tw, 0.7, TH + 0.4, 0.7, 0x2a323c, sx * TW / 2, TH / 2 + 0.2, sz * TD / 2));
    const slab = R.mat(0x232a33); // slab edges: one geometry, instanced below with the mullions
    R.box(tw, TW + 1.0, 0.9, TD + 1.0, 0x252c35, 0, TH + 0.45, 0); // parapet
    R.box(tw, TW + 1.2, 0.4, 4, 0x1c222a, 0, 3.6, TD / 2 + 2); // entrance canopy
    R.plane(tw, 8, 3.0, 0x8fa4c2, 0, 1.5, TD / 2 + 0.06, null, { emissive: 0x6f88b0, emissiveIntensity: 0.55 }); // the lit glass lobby
    [-4, -1.35, 1.35, 4].forEach(x => R.box(tw, 0.16, 3.0, 0.12, 0x2a323c, x, 1.5, TD / 2 + 0.1)); // lobby mullions
    R.box(tw, 2.4, 2.4, 0.04, 0xcfdcf0, 0, 1.2, TD / 2 + 0.09, { emissive: 0xa9bde0, emissiveIntensity: 0.7 }); // the doors, brighter
    // rooftop: plant room box, antenna mast, the red aircraft beacon
    R.box(tw, 6, 2.4, 5, 0x1d242d, -2.5, TH + 2.1, -2.5);
    R.cyl(tw, 0.1, 0.22, 9, 0x2a323c, 3.5, TH + 4.5, -3.5, 6);
    T.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a30 })); T.beacon.position.set(3.5, TH + 9.2, -3.5); tw.add(T.beacon);
    T.beaconHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('255,60,66'), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); T.beaconHalo.scale.set(4.5, 4.5, 1); T.beaconHalo.position.copy(T.beacon.position); tw.add(T.beaconHalo);
    // the sign plate on the roof edge, facing the street, and its twin on the side the camera cranes past
    const st = signTex('FRONTIER'); T.signTex = st;
    const plateW = TW - 1.5, plateH = plateW * 192 / 1024;
    R.box(tw, plateW + 0.4, plateH + 0.3, 0.25, 0x10161e, 0, TH + 1.3 + plateH / 2, TD / 2 + 0.2); // plate backing
    const sm = new THREE.MeshBasicMaterial({ map: st, transparent: true, fog: false });
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), sm); sgn.position.set(0, TH + 1.3 + plateH / 2, TD / 2 + 0.34); tw.add(sgn);
    R.box(tw, 0.25, plateH + 0.3, plateW + 0.4, 0x10161e, TW / 2 + 0.2, TH + 1.3 + plateH / 2, 0);
    const sgn2 = sgn.clone(); sgn2.rotation.y = Math.PI / 2; sgn2.position.set(TW / 2 + 0.34, TH + 1.3 + plateH / 2, 0); tw.add(sgn2);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('79,147,217'), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(24, 9, 1); halo.position.set(1.5, TH + 2.2, TD / 2 + 1.5); tw.add(halo); T.halo = halo;
    // the lab's name on the canopy fascia when a career exists (plain, small)
    const lab = save && save.lab && save.lab.name ? String(save.lab.name) : '';
    if (lab) R.sign(tw, [lab.toUpperCase()], 7, 0.36, 0, 3.6, TD / 2 + 4.02, 0, { bg: '#1c222a', fg: '#c5cfd9', w: 1024, h: 52, size: 36, glow: false });
    // windows: one InstancedMesh for tower + city. Tower glass: four panes per floor row per face, cool screen light or
    // warm task light where lit; mullions and slab edges are a second, dark instanced mesh.
    const W = []; // { m: Matrix4, col, base }
    const warm = [0xffe2b8, 0xf6d6a8, 0xe8dcc8], cool = [0xcfe0ff, 0xb8ccf0, 0x9cc0ff, 0xe6eeff];
    function win(x, y, z, ry, col, sx, sy) { _p.set(x, y, z); _q.setFromAxisAngle(_up, ry); _s.set(sx || 1, sy || 1, 1); W.push({ m: new THREE.Matrix4().compose(_p, _q, _s), col, base: col }); }
    const PW = TW / COLS;
    for (let r = 0; r < ROWS; r++) {
      const lv = lit[FLOORS[Math.floor(r / 2)]] || 0, y = 2.0 + r * FH; // two rows per floor, pane centres
      for (let c = 0; c < COLS; c++) {
        const off = (c - (COLS - 1) / 2) * PW;
        const on = rng() < lv, col = on ? _c.setHex(rng.chance(0.62) ? rng.pick(cool) : rng.pick(warm)).multiplyScalar(0.55 + rng() * 0.4).getHex() : (rng.chance(0.06) ? DIM : rng.pick(GLASS));
        win(off, y, TD / 2 + 0.03, 0, col, PW - 0.3, FH - 0.5); win(TW / 2 + 0.03, y, -off, Math.PI / 2, col, PW - 0.3, FH - 0.5);
        win(-off, y, -TD / 2 - 0.03, Math.PI, col, PW - 0.3, FH - 0.5); win(-TW / 2 - 0.03, y, off, -Math.PI / 2, col, PW - 0.3, FH - 0.5);
      }
    }
    T.towerWins = W.length;
    // city blocks
    const bm = R.mat(0x0b0e13); let blocks = 0;
    for (let i = 0; i < 34 && blocks < 30; i++) {
      const ang = rng() * Math.PI * 2, rad = 26 + rng() * 70, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (x > 6 && z > 6 && rad < 60) continue; // keep the camera corridor clear
      const w = 8 + rng() * 10, d = 8 + rng() * 10, h = 8 + rng() * (rad < 45 ? 28 : 44);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm); b.position.set(x, h / 2, z); S.add(b); blocks++;
      const rows = Math.floor(h / 3.2), cz = Math.floor(w / 2.6), cx = Math.floor(d / 2.6), dens = 0.14 + rng() * 0.22, tint = rng.chance(0.55) ? cool : warm;
      for (let r = 0; r < rows; r++) { const y = 1.6 + r * 3.2;
        for (let c = 0; c < cz; c++) if (rng.chance(dens)) win(x + (c - (cz - 1) / 2) * 2.6, y, z + d / 2 + 0.03, 0, rng.pick(tint), 1.15, 1.9);
        for (let c = 0; c < cx; c++) if (rng.chance(dens)) win(x + w / 2 + 0.03, y, z - (c - (cx - 1) / 2) * 2.6, Math.PI / 2, rng.pick(tint), 1.15, 1.9);
      }
    }
    const inst = T.inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), W.length);
    W.forEach((w, i) => { inst.setMatrixAt(i, w.m); inst.setColorAt(i, _c.setHex(w.col)); }); inst.instanceMatrix.needsUpdate = true; S.add(inst); T.wins = W;
    // mullions (vertical, between panes) and slab edges (horizontal, between floors) on the four faces: one instanced mesh
    const bars = []; const bar = (x, y, z, ry, sx, sy) => { _p.set(x, y, z); _q.setFromAxisAngle(_up, ry); _s.set(sx, sy, 1); bars.push(new THREE.Matrix4().compose(_p, _q, _s)); };
    const faces = [[0, TD / 2 + 0.05, 0], [TW / 2 + 0.05, 0, Math.PI / 2], [0, -TD / 2 - 0.05, Math.PI], [-TW / 2 - 0.05, 0, -Math.PI / 2]];
    faces.forEach(([fx, fz, ry]) => {
      const ax = Math.cos(ry), az = -Math.sin(ry); // the face's horizontal axis
      for (let c = 1; c < COLS; c++) { const o = (c - COLS / 2) * PW; bar(fx + ax * o, 0.3 + ROWS * FH / 2, fz + az * o, ry, 0.14, ROWS * FH); }
      for (let r = 1; r <= ROWS; r++) bar(fx, 0.3 + r * FH, fz, ry, TW, r % 2 ? 0.1 : 0.4); // slab edge at each floor, a thin transom between its rows
    });
    const binst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), slab, bars.length);
    bars.forEach((m, i) => binst.setMatrixAt(i, m)); binst.instanceMatrix.needsUpdate = true; tw.add(binst);
    // drizzle
    const N = 500, pos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { pos[i * 3] = -10 + rng() * 50; pos[i * 3 + 1] = rng() * 70; pos[i * 3 + 2] = 10 + rng() * 50; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    T.rain = new THREE.Points(rg, new THREE.PointsMaterial({ map: streakTex(), size: 0.7, transparent: true, opacity: 0.45, depthWrite: false, color: 0xcfd8ee })); S.add(T.rain);
    T.lab = lab; T.lit = lit; T.flickT = 0;
    // the display face may still be loading: redraw the plate once it is in (same texture)
    try { if (document.fonts && document.fonts.load) document.fonts.load('800 150px Archivo').then(() => { if (T.signTex === st && st.image) { drawSign(st.image, 'FRONTIER'); st.needsUpdate = true; } }).catch(() => {}); } catch (e) { /* no FontFace API */ }
  };

  T.update = function (dt) {
    T.t += dt; const k = smooth(T.t / CRANE), idle = Math.max(0, T.t - CRANE);
    eye.lerpVectors(A.eye, B.eye, k); look.lerpVectors(A.look, B.look, k);
    if (idle > 0) { eye.x += Math.sin(idle * 0.21) * 1.6; eye.y += Math.sin(idle * 0.13) * 0.7; eye.z += Math.cos(idle * 0.17) * 1.2; }
    const cam = T.cam; const asp = window.innerWidth / window.innerHeight; if (Math.abs(cam.aspect - asp) > 1e-3) { cam.aspect = asp; cam.updateProjectionMatrix(); }
    cam.position.copy(eye); cam.lookAt(look);
    // portrait: lens-shift the tower up so the screen's text (bottom half) sits over the street, not the sign
    const W = window.innerWidth, H = window.innerHeight, sh = asp < 1 ? Math.round(H * 0.16) : 0;
    if (sh !== T.shift || W !== T.vw || H !== T.vh) { T.shift = sh; T.vw = W; T.vh = H; if (sh) cam.setViewOffset(W, H, 0, sh, W, H); else cam.clearViewOffset(); }
    // the beacon: a slow steady blink, like the real thing (1 s on, 1 s off, soft edges)
    const pulse = 0.5 + 0.5 * Math.sin(T.t * 3.1); T.beacon.material.color.setHex(pulse > 0.55 ? 0xff3a40 : 0x4a1014); T.beaconHalo.material.opacity = 0.1 + pulse * 0.75;
    T.halo.material.opacity = 0.4 + 0.05 * Math.sin(T.t * 1.3);
    const p = T.rain.geometry.attributes.position.array; for (let i = 1; i < p.length; i += 3) { p[i] -= 26 * dt; if (p[i] < 0) p[i] += 70; } T.rain.geometry.attributes.position.needsUpdate = true;
    // a window somewhere in the tower switches every 0.35 s: someone leaves a desk, a screen wakes
    T.flickT += dt; if (T.flickT > 0.35) { T.flickT = 0; const i = Math.floor(Math.random() * T.towerWins); const w = T.wins[i];
      if (w && GLASS.indexOf(w.base) < 0) { w.col = w.col === DIM ? w.base : (Math.random() < 0.3 ? DIM : w.base); T.inst.setColorAt(i, _c.setHex(w.col)); T.inst.instanceColor.needsUpdate = true; } }
    R.renderer.render(T.scene, cam);
  };
  const still = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  T.start = function () {
    if (T.active || !R.renderer) return; if (!T.scene) T.build();
    T.t = still() ? CRANE : 0; T.shift = -1; T.active = true; R.cinematic = T.update; document.body.classList.add('title-on');
  };
  T.stop = function () {
    if (!T.active) return; T.active = false; if (R.cinematic === T.update) R.cinematic = null; document.body.classList.remove('title-on');
    if (T.scene) { R.disposeGroup(T.scene); T.scene = null; } T.cam = T.inst = T.wins = T.rain = T.beacon = T.beaconHalo = T.halo = T.signTex = null;
  };
  // the menu shows after a career changed (save and quit, delete, import): rebuild so the lit floors match the latest save
  T.restart = function () { const on = T.active; T.stop(); if (on || R.renderer) T.start(); };
  T.debug = () => ({ active: T.active, t: +T.t.toFixed(2), phase: T.t < CRANE ? 'crane' : 'idle', windows: T.wins ? T.wins.length : 0, built: !!T.scene, lab: T.lab || null, lit: T.lit, fps: R.fps });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// HQ floors (HQ-B): the nine floor builders FR.r.floors[id], bottom → top: lobby, serving, training, safety, research,
// proj1..proj3, boardroom. Ported from Mogul's render/floors/*.js (label.js and reality.js set the density and the kit).
// Floor contract (08_hq_world.js): build(id) → { group, elevator, light, update(dt, t), refresh(state), debug(),
//   view:{pos,look,fov,shift?}, targets:[Target], hint, lookSpill? }. Target ids are '<floorId>.<thing>' plus 'elevator'.
// Readers only: a floor reads FR.state and the pure sim getters (FR.sim.allocate, FR.model.outlook, FR.money.demandPF...)
// and never writes either. world.js runs refresh(FR.state) once per frame after 'turn:ended' / 'state:changed' /
// 'game:loaded'; refresh redraws the canvas screens (each only when its own data changed) and moves lights and people in
// place. A project floor whose project changed (greenlit, finished, cancelled) rebuilds itself in place instead.
// People: headcount × slider share on that allocation (FLOOR_K curve, capped at FLOOR_K.maxPeople) drawn as R.crowd
// instanced figures (seated at instanced desks, standing) plus a few walking R.person props. Lights: FR.look.dim() and the
// rack / desk screen brightness follow the allocation's share of free compute. Incidents in the last FLOOR_K.incidentTurns
// turns: the serving floor goes dark under a slow red strobe and a press pack gathers outside the lobby glass.
// No per-frame allocation: update() only writes preallocated objects.
(function (FR) {
  const R = FR.r; if (!R) return;
  const W = 16, D = 14, H = 4, HD = D / 2, PI = Math.PI;
  const K = R.FLOOR_K = {
    maxPeople: 24,        // figures per floor at most (instanced), whatever the headcount
    oneToOne: 10,         // up to this many staff on an allocation, one figure each
    curve: 60,            // past oneToOne, each further `curve` staff close ~63% of the remaining room to maxPeople
    fullShare: 0.4,       // an allocation holding this share of total compute (or more) runs at full activity
    incidentTurns: 3,     // serving dark + press at the lobby for this many turns after any incident
    pressMin: 6, pressMax: 10,
    rackRef: 1000         // PF of capacity at which every rack slot on the training / serving floors is installed
  };
  const META = FR.HQ_FLOOR_META || {};
  const SANS = R.FONT || '"IBM Plex Sans",system-ui,sans-serif', MONO = R.FONT_MONO || '"IBM Plex Mono",ui-monospace,monospace',
    DISP = R.FONT_DISPLAY || 'Archivo,"IBM Plex Sans",system-ui,sans-serif';
  // shell tokens (contracts_ui.md): capability = brand-bright, safety = good, gap = warn above 10, bad above 20
  const HX = { ink: '#eef2f6', ink2: '#c5cfd9', ink3: '#97a5b4', sunken: '#0a0e13', bg: '#0f141a', surface: '#171e27', raised: '#202a35',
    raised2: '#2a3642', line: '#3a4756', brand: '#2d6aa8', brandB: '#4f93d9', brandT: '#8ec0f2', gold: '#e6c15a', good: '#5fcf9a',
    warn: '#f0a24a', bad: '#ef6b5b', info: '#9cc0ff' };
  // 3D materials: concrete, glass, graphite, pale ash desks
  const GRAPH = 0x2b3137, GRAPH_L = 0x3b434b, STEEL = 0x9aa4ae, ASH = 0xd6cbb8, ASH_D = 0xb3a78f, BLACK = 0x12161b, RACK = 0x20262c,
    FABRIC = 0x3e4d5e, PLANT = 0x3f6b4a, PLANT_L = 0x4f7f5a, POT = 0xcfc8bc, GLASS = 0x9cc0ff, WOOD = 0x8a6a4a;
  const SHIRTS = [0x3d5a80, 0x5b6b7a, 0x2f4858, 0x7a8b99, 0x4a5d6e, 0x8c7a6b, 0x39424e, 0x6b7c8f, 0x2d6aa8];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const S = () => FR.state || null;
  const tryf = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch (e) { return d; } };
  const money = (n) => FR.fmtMoney(Math.round(+n || 0));
  const fmtPF = (n) => { n = +n || 0; return (n >= 100 ? String(Math.round(n)) : n.toFixed(1)) + ' PF'; };
  const wk = (t) => 'Wk ' + FR.weekOfYear(t);
  const cap1 = (v) => (Math.round((+v || 0) * 10) / 10).toFixed(1);

  // ======================= kit (build time) =======================
  const _o = new THREE.Object3D(), _m = new THREE.Matrix4(), _eu = new THREE.Euler(), _col = new THREE.Color();
  // several boxes [[w,h,d,x,y,z,ry?,rx?], ...] merged into one indexed geometry: one draw call for a repeated prop
  function boxes(parts) {
    const pos = [], nor = [], uv = [], idx = []; let off = 0;
    parts.forEach(p => {
      const b = new THREE.BoxGeometry(p[0], p[1], p[2]); _m.makeRotationFromEuler(_eu.set(p[7] || 0, p[6] || 0, 0)); _m.setPosition(p[3], p[4], p[5]); b.applyMatrix4(_m);
      const a = b.attributes; for (let i = 0; i < a.position.array.length; i++) { pos.push(a.position.array[i]); nor.push(a.normal.array[i]); }
      for (let i = 0; i < a.uv.array.length; i++) uv.push(a.uv.array[i]);
      const ix = b.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); off += a.position.count; b.dispose();
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere(); return g;
  }
  // InstancedMesh (count n). frustumCulled off: r128 culls an InstancedMesh by its geometry's sphere at the origin, so a
  // focus view that leaves the room centre out of frame would drop every instance.
  function inst(g, geo, mat, n, tint) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.frustumCulled = false;
    if (tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3); // r128: sized now
    m.count = n; g.add(m); return m;
  }
  function place(m, i, x, y, z, ry, sx, sy, sz) { _o.position.set(x, y, z); _o.rotation.set(0, ry || 0, 0); _o.scale.set(sx || 1, sy || 1, sz || 1); _o.updateMatrix(); m.setMatrixAt(i, _o.matrix); }
  function grp(g, x, z, ry, y) { const o = new THREE.Group(); o.position.set(x, y || 0, z); o.rotation.y = ry || 0; g.add(o); return o; }
  function keep(t) { t.userData = Object.assign(t.userData || {}, { keep: true }); return t; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // canvas sign whose canvas we redraw in place (opts go to R.sign: bg/fg steer look's halo, glow:false drops it)
  function csign(g, w, h, cw, ch, x, y, z, ry, opts, list) {
    const m = R.sign(g, [''], w, h, x, y, z, ry, Object.assign({ w: cw, h: ch }, opts || {}));
    m.cv = m.material.map.image; m.cx = m.cv.getContext('2d'); if (list) list.push(m); return m;
  }
  // redraw a screen only when its data changed (the sig is the data); returns true when it drew
  function paint(m, data, draw) {
    const sig = JSON.stringify(data); if (m._sig === sig) return false; m._sig = sig;
    const x = m.cx; x.save(); x.textBaseline = 'middle'; draw(x, m.cv.width, m.cv.height, data); x.restore(); m.material.map.needsUpdate = true; return true;
  }
  const fnt = (wt, px, fam) => wt + ' ' + px + 'px ' + (fam || SANS);
  function T(x, s, px, py, size, col, al, wt, fam, max) {
    s = String(s == null ? '' : s); let f = size; x.font = fnt(wt || 600, f, fam);
    if (max) while (f > 12 && x.measureText(s).width > max) { f -= 2; x.font = fnt(wt || 600, f, fam); }
    x.fillStyle = col || HX.ink; x.textAlign = al || 'left'; x.fillText(s, px, py); return f;
  }
  function fit(x, s, max) { s = String(s == null ? '' : s); if (x.measureText(s).width <= max) return s; while (s.length > 1 && x.measureText(s + '…').width > max) s = s.slice(0, -1); return s.trim() + '…'; }
  // word wrap to max px in the current font; more than n lines: the last one ends with an ellipsis
  function wrap(x, s, max, n) {
    const out = []; let line = ''; String(s || '').split(/\s+/).forEach(w => { const t = line ? line + ' ' + w : w; if (line && x.measureText(t).width > max) { out.push(line); line = w; } else line = t; });
    if (line) out.push(line); if (n && out.length > n) { const rest = out.slice(n - 1).join(' '); out.length = n; out[n - 1] = fit(x, rest, max); } return out;
  }
  function rect(x, px, py, w, h, col) { x.fillStyle = col; x.fillRect(px, py, w, h); }
  function rrect(x, px, py, w, h, r, col) { x.fillStyle = col; x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); x.fill(); }
  function bar(x, px, py, w, h, frac, col, back) { rect(x, px, py, w, h, back || 'rgba(255,255,255,.08)'); if (frac > 0) rect(x, px, py, Math.max(2, w * clamp(frac, 0, 1)), h, col); }
  const gapCol = (g) => (g > 20 ? HX.bad : g > 10 ? HX.warn : HX.good);
  const LEVEL = { ok: ['OK', HX.good], watch: ['WATCH', HX.warn], warning: ['WARNING', HX.warn], critical: ['CRITICAL', HX.bad] };
  const NEWSC = { rival: HX.info, you: HX.brandT, market: HX.ink3, incident: HX.bad, record: HX.gold };

  // ---------- shared textures (flagged keep: disposeGroup never frees them) ----------
  const TEX = {};
  // rack face: 16 units of 1U-ish panels, vents, dim status LEDs (static; the sparkle overlay carries the activity)
  function faceTex() {
    if (TEX.face) return TEX.face; const c = canvas(64, 256), x = c.getContext('2d'), rnd = FR.rng(5);
    rect(x, 0, 0, 64, 256, '#0b0f14');
    for (let u = 0; u < 16; u++) { const y = u * 16; rect(x, 2, y + 1, 60, 14, u % 4 === 0 ? '#1c242d' : '#151b22'); for (let k = 0; k < 6; k++) rect(x, 24 + k * 6, y + 4, 4, 8, '#0a0d11');
      for (let k = 0; k < 2; k++) rect(x, 6 + k * 6, y + 6, 3, 3, rnd() < 0.5 ? '#2a4a3a' : '#23384e'); }
    const t = keep(new THREE.CanvasTexture(c)); t.minFilter = THREE.LinearFilter; TEX.face = t; return t;
  }
  // rack sparkle: sparse bright LEDs on transparent, scrolled upward at a speed that follows the allocation's compute
  function sparkTex(kind) {
    const key = 'spark' + kind; if (TEX[key]) return TEX[key]; const c = canvas(32, 256), x = c.getContext('2d'), rnd = FR.rng(kind === 'serve' ? 11 : kind === 'eval' ? 23 : 7);
    const pal = kind === 'serve' ? ['#5fcf9a', '#5fcf9a', '#f0a24a', '#8ec0f2'] : kind === 'eval' ? ['#5fcf9a', '#9cc0ff', '#5fcf9a'] : ['#4f93d9', '#8ec0f2', '#9cc0ff', '#5fcf9a'];
    x.clearRect(0, 0, 32, 256);
    for (let u = 0; u < 16; u++) for (let k = 0; k < 4; k++) if (rnd() < 0.55) { x.fillStyle = pal[Math.floor(rnd() * pal.length)]; x.fillRect(3 + k * 7, u * 16 + 5, 3, 3); }
    const t = keep(new THREE.CanvasTexture(c)); t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; TEX[key] = t; return t;
  }
  // request trace for the serving wall: periodic over the width, so the scroll never seams
  function waveTex() {
    if (TEX.wave) return TEX.wave; const c = canvas(512, 96), x = c.getContext('2d');
    const f = (i) => 52 - (Math.sin(i / 512 * PI * 6) * 14 + Math.sin(i / 512 * PI * 14 + 1) * 8 + Math.sin(i / 512 * PI * 34 + 2) * 5 + Math.sin(i / 512 * PI * 62) * 3);
    x.beginPath(); x.moveTo(0, 96); for (let i = 0; i <= 512; i += 2) x.lineTo(i, f(i)); x.lineTo(512, 96); x.closePath(); x.fillStyle = 'rgba(79,147,217,.28)'; x.fill();
    x.beginPath(); for (let i = 0; i <= 512; i += 2) { if (i) x.lineTo(i, f(i)); else x.moveTo(i, f(i)); } x.strokeStyle = '#8ec0f2'; x.lineWidth = 3; x.stroke();
    const t = keep(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; TEX.wave = t; return t;
  }
  // city windows: 8 × 8 windows, the bottom-left cell is roof (tower tops sample it)
  function winTex() {
    if (TEX.win) return TEX.win; const c = canvas(64, 64), x = c.getContext('2d'), rnd = FR.rng(77);
    rect(x, 0, 0, 64, 64, '#0d131b');
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const v = rnd(); x.fillStyle = v < 0.28 ? '#f2d29a' : v < 0.4 ? '#c9dcff' : '#18212c'; x.fillRect(i * 8 + 2, j * 8 + 2, 4, 5); }
    rect(x, 0, 56, 8, 8, '#0a0e13');
    const t = keep(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; TEX.win = t; return t;
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const f = R.current; if (f && f._frScreens) { f._frScreens.forEach(m => { m._sig = null; }); R.dirty = R.dirty || true; } }).catch(() => {});

  // ---------- props ----------
  // desks: slots [{x, z, ry}] = desk centre; the monitor on the local -z edge, the chair on +z (ry 0 faces -z).
  // Four draw calls for every desk on the floor; seats[i] = [x, z, ry] of the figure sitting at desk i.
  const TINTS = [0x9cc0ff, 0x8ec0f2, 0xbcd4ff, 0x7fd0c0, 0xd6e4ff, 0x6fa8dc];
  function deskKit(g, slots, opts) {
    opts = opts || {}; const n = slots.length;
    const top = inst(g, boxes([[1.44, 0.05, 0.72, 0, 0.745, 0]]), R.mat(opts.top || ASH), n);
    const dark = inst(g, boxes([[1.38, 0.54, 0.03, 0, 0.45, -0.32], [0.04, 0.72, 0.66, -0.68, 0.36, 0], [0.04, 0.72, 0.66, 0.68, 0.36, 0], [0.6, 0.37, 0.035, 0, 1.07, -0.2],
      [0.05, 0.26, 0.05, 0, 0.87, -0.22], [0.24, 0.02, 0.16, 0, 0.78, -0.22], [0.06, 0.4, 0.06, 0, 0.22, 0.7], [0.46, 0.04, 0.46, 0, 0.02, 0.7]]), R.mat(GRAPH), n);
    const fab = inst(g, boxes([[0.5, 0.08, 0.48, 0, 0.46, 0.7], [0.48, 0.5, 0.07, 0, 0.78, 0.95]]), R.mat(opts.chair || FABRIC), n);
    const sg = new THREE.PlaneGeometry(0.54, 0.31); sg.translate(0, 1.07, -0.178);
    const sm = new THREE.MeshBasicMaterial({ color: 0xffffff }), scr = inst(g, sg, sm, n, true);
    for (let i = 0; i < n; i++) { const s = slots[i]; [top, dark, fab, scr].forEach(m => place(m, i, s.x, 0, s.z, s.ry)); scr.setColorAt(i, _col.set(TINTS[(i * 7 + 3) % TINTS.length])); }
    scr.instanceColor.needsUpdate = true;
    return { n, scrMat: sm, seats: slots.map(s => [s.x + Math.sin(s.ry || 0) * 0.7, s.z + Math.cos(s.ry || 0) * 0.7, (s.ry || 0) + PI]),
      set(k) { k = clamp(k, 0, n); top.count = dark.count = fab.count = scr.count = k; }, get count() { return top.count; } };
  }
  // racks: slots [{x, z, ry}], the LED face on local +z. set(visible, lit): the first `lit` faces sparkle
  function rackKit(g, slots, kind) {
    const n = slots.length;
    const body = inst(g, boxes([[0.6, 2.1, 1.0, 0, 1.05, 0], [0.64, 0.05, 1.04, 0, 2.125, 0]]), R.mat(RACK), n);
    const fg = new THREE.PlaneGeometry(0.5, 1.86); fg.translate(0, 1.08, 0.503);
    const face = inst(g, fg, new THREE.MeshBasicMaterial({ map: faceTex(), color: 0xffffff }), n, true);
    const sg = new THREE.PlaneGeometry(0.5, 1.86); sg.translate(0, 1.08, 0.508);
    const tex = sparkTex(kind), sm = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const spark = inst(g, sg, sm, n, true); spark.userData.look = 1;
    for (let i = 0; i < n; i++) { const s = slots[i]; place(body, i, s.x, 0, s.z, s.ry); place(face, i, s.x, 0, s.z, s.ry); place(spark, i, s.x, 0, s.z, s.ry); }
    let vis = -1, lit = -1;
    return { n, tex, mat: sm, get vis() { return vis; }, get lit() { return lit; },
      set(v, l) { v = clamp(Math.round(v), 0, n); l = clamp(Math.round(l), 0, v); body.count = face.count = spark.count = v; if (v === vis && l === lit) return; vis = v; lit = l;
        for (let i = 0; i < n; i++) { spark.setColorAt(i, _col.setScalar(i < l ? 1 : 0)); face.setColorAt(i, _col.setScalar(i < l ? 1 : 0.45)); }
        spark.instanceColor.needsUpdate = true; face.instanceColor.needsUpdate = true; } };
  }
  // rack count for a capacity: log scale, half the slots at ~20 PF, all of them at K.rackRef
  const racksFor = (cap, n) => clamp(Math.round(n * (0.35 + 0.65 * Math.log10(1 + (cap || 0) / 10) / Math.log10(1 + K.rackRef / 10))), Math.min(4, n), n);
  function panels(g, pts, k) {
    const m = new THREE.MeshLambertMaterial({ color: 0xf2f4f8, emissive: 0xf4f7ff, emissiveIntensity: k == null ? 0.7 : k });
    pts.forEach(p => { R.box(g, 1.2, 0.06, 1.2, 0xf2f4f8, p[0], H - 0.05, p[1]).material = m; }); return m;
  }
  // focus pose: look at c from yaw (deg; 0 = from +z, 90 = from +x), pitch (deg above), distance d. world.js lens-shifts a
  // focus so c sits at ~y 160 of 844: the object has to fit the strip between the top chips and the sheet.
  function aim(c, yaw, pitch, d, fov) { const a = yaw * PI / 180, q = pitch * PI / 180;
    return { pos: [c[0] + Math.sin(a) * Math.cos(q) * d, c[1] + Math.sin(q) * d, c[2] + Math.cos(a) * Math.cos(q) * d].map(v => +v.toFixed(2)), look: c, fov: fov || 60 }; }
  // distance that fits a w × h face in that strip (~190 px tall, ~375 px wide at fov 60)
  const fitD = (w, h) => Math.max(3.9 * h, 1.95 * w, 3);
  function plant(g, x, z, s) { s = s || 1; R.cyl(g, 0.28 * s, 0.22 * s, 0.5 * s, POT, x, 0.25 * s, z, 10); R.cyl(g, 0.42 * s, 0.3 * s, 0.7 * s, PLANT, x, 0.85 * s, z, 8); R.cyl(g, 0.26 * s, 0.4 * s, 0.5 * s, PLANT_L, x, 1.4 * s, z, 8); }
  function frame(g, w, h, x, y, z, ry) { const f = R.box(g, w + 0.2, h + 0.2, 0.1, BLACK, x, y, z); f.rotation.y = ry || 0; return f; }
  // department plate above the elevator: '2   TRAINING'
  function deptSign(g, id, x) {
    const m = META[id] || { n: '', name: id }; const name = String(m.name || id).split(' / ')[0].toUpperCase();
    return R.sign(g, [(m.n ? m.n + '   ' : '') + name], 3.3, 0.44, x, 3.46, -HD + 0.02, 0, { bg: '#1b232c', fg: HX.ink2, w: 1024, h: 136, size: 74, font: 'display', weight: '700', glow: false });
  }
  function hideFront(g) { const r = g.userData.room, list = r ? r.walls : g.children; list.forEach(c => { if (c.geometry && c.geometry.parameters && Math.abs(c.position.z - (HD + 0.1)) < 0.01 && c.geometry.parameters.width === W) c.visible = false; }); }
  // a floor's room: its look key ('vacant' for an empty project floor), then the shell
  function start(look) { if (look && FR.look && FR.look.use) FR.look.use(look); const g = new THREE.Group(); R.room(g, W, D, H, {}); return g; }
  // walking R.person props pacing [x0, z0, x1, z1, speed, phase]
  function walkers(g, paths, seed) { return paths.map((p, i) => { const w = R.person(g, SHIRTS[(i * 5 + (seed || 0)) % SHIRTS.length], p[0], p[1], 0, R.SKIN ? R.SKIN[(i * 3 + (seed || 0)) % R.SKIN.length] : undefined); w.userData.path = p; w.visible = false; return w; }); }
  function stepWalkers(list, n, t) {
    for (let i = 0; i < list.length; i++) { const w = list[i], on = i < n; if (w.visible !== on) w.visible = on; if (!on) continue;
      const p = w.userData.path, a = t * p[4] + p[5], u = 0.5 - 0.5 * Math.cos(a), dx = p[2] - p[0], dz = p[3] - p[1];
      w.position.x = p[0] + dx * u; w.position.z = p[1] + dz * u; w.rotation.y = Math.atan2(dx, dz) + (Math.sin(a) < 0 ? PI : 0); w.position.y = Math.abs(Math.sin(a * 9)) * 0.03; }
  }
  // static instanced figures (R.crowd, HQ-A): spots [[x, z, ry], ...]
  function crowd(g, spots, pose, seed) {
    if (!spots.length || !R.crowd) return { max: 0, count: 0, set() {} };
    const c = R.crowd(g, spots, { pose, seed, colors: SHIRTS }); (c.meshes || []).forEach(m => { m.frustumCulled = false; }); c.set(0); return c;
  }
  // figures for `staff` people on an allocation: one each up to oneToOne, then a curve toward maxPeople
  function heads(staff) {
    if (!(staff > 0.25)) return 0; if (staff <= K.oneToOne) return Math.max(1, Math.round(staff));
    return Math.min(K.maxPeople, Math.round(K.oneToOne + (K.maxPeople - K.oneToOne) * (1 - Math.exp(-(staff - K.oneToOne) / K.curve))));
  }
  // split n figures into walkers, seated and standing (seats fill first, a walker for every five)
  function split(n, seats, stands, walks) {
    const w = Math.min(walks, Math.floor(n / 5)); let r = n - w; let si = Math.min(seats, Math.ceil(r * 0.7)); r -= si;
    const st = Math.min(stands, r); r -= st; si = Math.min(seats, si + r); return { walk: w, sit: si, stand: st };
  }

  // ---------- state readers (pure; FR.state is never written) ----------
  function allocOf(s) {
    if (!s || !s.sliders) return null;
    const a = tryf(() => (FR.sim && FR.sim.allocate && FR.projects && FR.projects.pfDemand ? FR.sim.allocate(s) : null), null); if (a) return a;
    const last = s.lastReport && s.lastReport.flows && s.lastReport.flows.alloc;
    const cap = tryf(() => FR.compute.capacity(s).total, last ? last.capacity : 0), hc = s.staff ? s.staff.headcount : 0, out = { capacity: cap };
    FR.ALLOCS.forEach(k => { out[k] = { pf: cap * (s.sliders[k] || 0) / 100, staff: hc * (s.sliders[k] || 0) / 100 }; }); return out;
  }
  function part(s, a, k) { if (a && a[k]) return a[k]; const hc = s && s.staff ? s.staff.headcount : 0; return { pf: 0, staff: hc * (s && s.sliders ? (s.sliders[k] || 0) / 100 : 0) }; }
  // 0..1: the allocation's PF as a share of total compute, full at K.fullShare
  function activity(s, a, k) { const cap = a ? a.capacity : 0; return cap > 0 ? clamp(part(s, a, k).pf / (cap * K.fullShare), 0, 1) : 0; }
  function recentIncidents(s) {
    const out = []; if (!s || !s.model || !s.model.skills) return out;
    FR.SKILLS.forEach(k => { const sk = s.model.skills[k]; ((sk && sk.incidents) || []).forEach(t => { if (t >= s.turn - K.incidentTurns) out.push({ skill: k, turn: t }); }); });
    return out.sort((a, b) => b.turn - a.turn);
  }
  const avg3 = (o) => (o ? FR.SKILLS.reduce((t, k) => t + (+o[k] || 0), 0) / FR.SKILLS.length : 0);
  function labName(s) { return (s && s.lab && s.lab.name) || 'Prairie Blue Labs'; }
  function whoName(s, id) { if (id === 'player' || id === 'you') return labName(s); const r = s && s.market && (s.market.rivals || []).find(x => x.id === id); return r ? r.name : String(id || ''); }
  const capacityOf = (s) => tryf(() => FR.compute.capacity(s), { total: 0, owned: 0, rented: 0, deals: 0 });

  // light rig: a floor's update() calls rig(k, red) every frame; red (0..1) tints the hemisphere light for the strobe.
  // look resets the rig and its colour on every floor load, so nothing leaks to the next floor.
  const RIG = { sky: new THREE.Color(), red: new THREE.Color(0xff2a1f), tinted: false, floor: null };
  function rig(f, k, red) {
    if (FR.look && FR.look.dim) FR.look.dim(k);
    if (!R.hemi) return;
    if (RIG.floor !== f) { RIG.floor = f; RIG.sky.copy(R.hemi.color); RIG.tinted = false; }
    if (red > 0.001) { R.hemi.color.copy(RIG.sky).lerp(RIG.red, red); RIG.tinted = true; } else if (RIG.tinted) { R.hemi.color.copy(RIG.sky); RIG.tinted = false; }
  }
  // finish a floor object: shared fields, the first refresh
  function finish(f, id, scr) {
    f._fr = true; f._frScreens = scr; f.light = f.light || { hemi: 0.8, sun: 0.5, bg: 0x0a0e13 };
    if (f.refresh) try { f.refresh(S()); } catch (e) { console.error('floor refresh failed', id, e); }
    return f;
  }

  // ======================= LOBBY (G): reception, news wall, trust + record totems, the street =======================
  function drawNews(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken); rect(x, 0, 0, w, 88, HX.surface); rect(x, 0, 88, w, 4, HX.brand);
    T(x, 'WIRE', 36, 46, 48, HX.ink, 'left', 700, DISP); T(x, d.date, w - 36, 46, 30, HX.ink3, 'right', 500, MONO);
    if (!d.items.length) { T(x, 'No wire items yet.', w / 2, h / 2 + 40, 40, HX.ink3, 'center', 500); return; }
    d.items.forEach((it, i) => {
      const y0 = 118 + i * 140, col = NEWSC[it[1]] || HX.ink3;
      rrect(x, 36, y0, 116, 46, 8, col); T(x, wk(it[0]), 94, y0 + 24, 26, HX.sunken, 'center', 600, MONO);
      x.font = fnt(500, 36); x.fillStyle = HX.ink; x.textAlign = 'left';
      wrap(x, it[2], w - 220, 3).forEach((l, j) => x.fillText(l, 176, y0 + 22 + j * 42));
      if (i < d.items.length - 1) rect(x, 36, y0 + 128, w - 72, 2, HX.raised);
    });
  }
  function drawTrust(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'PUBLIC TRUST', w / 2, 50, 36, HX.ink2, 'center', 700, DISP, w - 40);
    const col = d.v >= 60 ? HX.good : d.v >= 40 ? HX.ink : d.v >= 25 ? HX.warn : HX.bad;
    T(x, String(Math.round(d.v)), w / 2, 168, 150, col, 'center', 500, MONO); T(x, 'of 100', w / 2, 256, 28, HX.ink3, 'center', 500);
    bar(x, 36, 292, w - 72, 20, d.v / 100, HX.brandB); rect(x, w / 2 - 1, 286, 3, 32, HX.ink3);
    const dl = d.delta; T(x, (dl > 0 ? '+' : '') + dl.toFixed(1) + ' last week', w / 2, 352, 28, dl > 0.05 ? HX.good : dl < -0.05 ? HX.bad : HX.ink3, 'center', 600, MONO);
    const x0 = 36, x1 = w - 36, y0 = 400, y1 = 516; rect(x, x0, y0, x1 - x0, y1 - y0, HX.surface);
    x.strokeStyle = HX.line; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(x0, (y0 + y1) / 2); x.lineTo(x1, (y0 + y1) / 2); x.stroke(); x.setLineDash([]);
    if (d.hist.length > 1) { x.strokeStyle = HX.brandT; x.lineWidth = 4; x.beginPath(); d.hist.forEach((v, i) => { const px = x0 + 8 + (x1 - x0 - 16) * i / (d.hist.length - 1), py = y1 - 6 - (y1 - y0 - 12) * v / 100; if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke(); }
    T(x, 'Last ' + Math.max(1, d.hist.length) + ' weeks', w / 2, 540, 22, HX.ink3, 'center', 500);
  }
  function drawRecord(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'FRONTIER RECORD', w / 2, 46, 34, HX.ink2, 'center', 700, DISP, w - 40);
    T(x, 'First lab to average capability', w / 2, 88, 22, HX.ink3, 'center', 500, SANS, w - 40);
    d.rows.forEach((r, i) => {
      const y = 150 + i * 84, you = r[1] === 'player', col = !r[1] ? HX.ink3 : you ? HX.gold : HX.ink2;
      rect(x, 24, y - 34, w - 48, 72, you ? 'rgba(230,193,90,.12)' : HX.surface);
      T(x, String(r[0]), 44, y, 46, col, 'left', 500, MONO);
      T(x, r[1] ? r[3] : 'Open', 124, y - 10, 26, r[1] ? HX.ink : HX.ink3, 'left', 600, SANS, 200);
      T(x, r[1] ? wk(r[2]) + ' · Y' + FR.year(r[2]) : 'Not yet reached', 124, y + 20, 20, HX.ink3, 'left', 500, SANS, 200);
    });
  }
  R.floors.lobby = { build(id) {
    const g = start(), scr = [];
    hideFront(g);
    const ev = R.elevatorBank(g, 0, -HD, H);
    R.plane(g, 3.0, 9.8, 0x7c848b, 0, 0.006, 0.9, -PI / 2);                 // stone runner, doors to gates (floor bake)
    R.plane(g, 3.2, 0.9, 0x2a3036, 0, 0.012, 5.7, -PI / 2);                 // entrance mat
    // glass line with a revolving door, set back from the room edge so the cutaway never hides it
    const GZ = 6.3, gl = { transparent: true, opacity: 0.14, depthWrite: false };
    R.plane(g, 6.6, 3.7, GLASS, -4.7, 1.85, GZ, null, gl); R.plane(g, 6.6, 3.7, GLASS, 4.7, 1.85, GZ, null, gl);
    [-7.9, -6.7, -2.9, -1.4, 1.4, 2.9, 6.7, 7.9].forEach(x => R.box(g, 0.1, 3.7, 0.12, GRAPH, x, 1.85, GZ));
    R.box(g, W, 0.26, 0.3, GRAPH, 0, 3.8, GZ); R.box(g, W, 0.08, 0.3, GRAPH, 0, 0.04, GZ);
    const rd = grp(g, 0, GZ); const ring = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.06, 6, 28), R.mat(GRAPH)); ring.rotation.x = PI / 2; ring.position.y = 3.62; rd.add(ring);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.26, 1.26, 3.5, 20, 1, true), new THREE.MeshLambertMaterial({ color: GLASS, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    drum.position.y = 1.75; rd.add(drum);
    const wings = grp(rd, 0, 0); for (let i = 0; i < 4; i++) { const a = i * PI / 2, b = R.box(wings, 1.18, 2.5, 0.05, 0xb8c6d4, Math.cos(a) * 0.6, 1.3, Math.sin(a) * 0.6); b.rotation.y = -a; }
    // outside: pavement a step below the lobby floor, kerb, street, the block opposite
    const out = grp(g, 0, 0);
    R.plane(out, 36, 4.0, 0x3f454b, 0, -0.03, 9.0, -PI / 2);
    R.box(out, 36, 0.22, 0.3, 0x6a7178, 0, -0.1, 11.1);
    R.plane(out, 36, 7.6, 0x1b2025, 0, -0.2, 15.0, -PI / 2);
    const dash = inst(out, new THREE.BoxGeometry(1.6, 0.02, 0.14), R.mat(0xc9ccd0), 10); for (let i = 0; i < 10; i++) place(dash, i, -18 + i * 4, -0.18, 15.0, 0);
    [-5.8, 5.8].forEach(x => { R.cyl(out, 0.06, 0.09, 4.4, 0x3a424a, x, 2.2, 10.7, 8); R.box(out, 0.1, 0.08, 0.9, 0x3a424a, x, 4.35, 10.3); R.box(out, 0.42, 0.1, 0.3, 0xffe2b8, x, 4.28, 9.9, { emissive: 0xffd9a0, emissiveIntensity: 0.9 }); });
    [-4.4, 4.4].forEach(x => { R.box(out, 2.6, 0.5, 0.8, 0x4a5058, x, 0.22, 7.4); R.cyl(out, 0.5, 0.4, 0.5, PLANT, x - 0.6, 0.7, 7.4, 8); R.cyl(out, 0.45, 0.4, 0.45, PLANT_L, x + 0.6, 0.68, 7.4, 8); });
    const bol = inst(out, new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), R.mat(0x6a737c), 6); [-2.6, -1.6, -0.6, 0.6, 1.6, 2.6].forEach((x, i) => place(bol, i, x, 0.37, 10.6, 0));
    city(out, 'lobby');
    // news wall (back wall left of the elevators)
    frame(g, 5.0, 2.6, -4.6, 2.15, -HD + 0.05);
    const news = csign(g, 5.0, 2.6, 1024, 532, -4.6, 2.15, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    // the lab's name over reception, a blue light line under it
    const name = csign(g, 5.4, 0.86, 1024, 164, 4.6, 3.0, -HD + 0.06, 0, { bg: '#1b232c', glow: false }, scr);
    R.box(g, 5.4, 0.04, 0.04, 0x8ec0f2, 4.6, 2.5, -HD + 0.06).material = new THREE.MeshBasicMaterial({ color: 0x8ec0f2 });
    // reception desk + receptionist
    const rc = grp(g, 4.6, -3.7);
    R.box(rc, 4.0, 1.0, 0.8, ASH, 0, 0.5, 0); R.box(rc, 4.2, 0.06, 1.0, GRAPH, 0, 1.03, -0.05);
    R.box(rc, 4.02, 0.04, 0.02, 0x8ec0f2, 0, 0.22, 0.41).material = new THREE.MeshBasicMaterial({ color: 0x4f93d9 });
    R.box(rc, 0.7, 0.44, 0.04, BLACK, -0.9, 1.3, -0.3); R.box(rc, 0.7, 0.44, 0.04, BLACK, 0.9, 1.3, -0.3);
    R.person(g, 0x2d6aa8, 4.9, -4.6, 0, R.SKIN && R.SKIN[1]);
    // security gates in front of the elevators + the guard
    const gate = inst(g, boxes([[0.22, 1.0, 1.2, 0, 0.5, 0], [0.24, 0.04, 0.3, 0, 1.02, 0.35]]), R.mat(STEEL), 4); [-1.9, -0.64, 0.64, 1.9].forEach((x, i) => place(gate, i, x, 0, -3.6, 0));
    R.person(g, 0x2a3642, -2.9, -3.9, 0.4, R.SKIN && R.SKIN[2]);
    // waiting area: two sofas, a low table, a rug; plants
    R.plane(g, 3.8, 4.6, 0x5a6470, -5.4, 0.01, -0.1, -PI / 2);
    const sofa = (x, z, ry) => { const s = grp(g, x, z, ry); R.box(s, 2.4, 0.42, 0.9, FABRIC, 0, 0.21, 0); R.box(s, 2.4, 0.5, 0.24, FABRIC, 0, 0.62, -0.33); R.box(s, 0.2, 0.56, 0.9, 0x34414f, -1.2, 0.3, 0); R.box(s, 0.2, 0.56, 0.9, 0x34414f, 1.2, 0.3, 0); };
    sofa(-5.4, -1.7, 0); sofa(-5.4, 1.5, PI); R.box(g, 1.3, 0.36, 0.8, ASH_D, -5.4, 0.18, -0.1);
    plant(g, -7.3, -6.3); plant(g, 7.3, -6.2); plant(g, -7.3, 3.4); plant(g, 7.3, 3.4);
    R.box(g, 2.6, 0.44, 0.6, ASH_D, 6.9, 0.22, 0.6).rotation.y = PI / 2;
    // totems either side of the entrance, facing the street: trust (left), the frontier record (right)
    const totem = (x) => { const t = grp(g, x, 4.5); R.box(t, 1.9, 2.8, 0.3, GRAPH, 0, 1.5, 0); R.box(t, 2.1, 0.12, 0.6, GRAPH_L, 0, 0.06, 0); return t; };
    const tl = totem(-4.9), tr = totem(4.9);
    const trust = csign(tl, 1.7, 2.5, 384, 564, 0, 1.55, 0.16, 0, { bg: HX.sunken }, scr);
    const record = csign(tr, 1.7, 2.5, 384, 564, 0, 1.55, 0.16, 0, { bg: HX.sunken }, scr);
    panels(g, [[-5, -4.2], [0, -4.2], [5, -4.2], [-5, 0.5], [0, 0.5], [5, 0.5], [-5, 4.4], [0, 4.4], [5, 4.4]]);
    // visitors: two walk the runner and the hall, two wait on the sofas, two pass outside
    const walk = walkers(g, [[0.4, 5.4, 0.4, -2.6, 0.26, 0], [-3.0, 2.9, 3.2, 2.9, 0.2, 1.5], [-12, 8.3, 12, 8.3, 0.07, 0.3], [12, 9.7, -12, 9.7, 0.06, 2.1]], 2);
    const sitters = crowd(g, [[-5.9, -1.55, 0], [-4.8, 1.35, PI]], 'sit', 31); sitters.set(2);
    // press pack on the pavement, facing the glass: 6..10 figures with cameras, two tripods, a van
    const PRESS = [[-2.7, 7.5, PI + 0.3], [-1.6, 7.4, PI + 0.1], [-0.5, 7.45, PI], [0.6, 7.4, PI - 0.1], [1.7, 7.5, PI - 0.2], [2.8, 7.6, PI - 0.3],
      [-2.1, 8.4, PI + 0.15], [-1.0, 8.3, PI], [0.2, 8.4, PI], [1.3, 8.35, PI - 0.15]];
    const press = crowd(g, PRESS, 'stand', 91);
    const pressG = grp(g, 0, 0); pressG.visible = false;
    const gear = inst(g, boxes([[0.26, 0.2, 0.32, 0.12, 1.42, 0.3], [0.11, 0.11, 0.16, 0.12, 1.42, 0.52], [0.05, 0.14, 0.05, 0.12, 1.58, 0.26]]), R.mat(BLACK), PRESS.length);
    PRESS.forEach((p, i) => place(gear, i, p[0], 0, p[1], p[2])); gear.count = 0;
    const legs = [];
    [[-4.0, 8.9], [4.0, 8.9]].forEach(([x, z]) => { const t = grp(pressG, x, z, PI); R.box(t, 0.3, 0.3, 0.55, BLACK, 0, 1.55, 0); const l = R.cyl(t, 0.1, 0.12, 0.26, 0x2a3036, 0, 1.55, 0.36, 10); l.rotation.x = PI / 2;
      [0, 2.1, 4.2].forEach(a => legs.push([x + Math.sin(a) * 0.22, 0.7, z + Math.cos(a) * 0.22, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3])); });
    const leg = inst(pressG, new THREE.CylinderGeometry(0.018, 0.018, 1.45, 5), R.mat(BLACK), legs.length);
    legs.forEach((p, i) => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(p[3], 0, p[5]); _o.scale.set(1, 1, 1); _o.updateMatrix(); leg.setMatrixAt(i, _o.matrix); });
    const van = grp(pressG, -6.8, 13.2, 0); R.box(van, 4.6, 2.0, 2.0, 0xdfe3e8, 0, 1.2, 0); R.box(van, 1.2, 0.8, 1.9, 0x1b232c, 1.7, 1.7, 0);
    R.cyl(van, 0.05, 0.05, 1.0, 0x9aa4ae, -0.8, 2.7, 0, 6); const dish = R.cyl(van, 0.6, 0.6, 0.06, 0xe6ebf0, -0.8, 3.2, 0, 16); dish.rotation.z = 0.8;
    [[-1.4, 0.5, 1], [1.4, 0.5, 1], [-1.4, 0.5, -1], [1.4, 0.5, -1]].forEach(([x, y, z]) => { const wh = R.cyl(van, 0.36, 0.36, 0.24, 0x14181c, x, 0.36, z, 12); wh.rotation.x = PI / 2; });
    R.sign(van, ['NEWS'], 1.6, 0.46, -0.6, 1.4, 1.01, 0, { bg: '#dfe3e8', fg: '#1b232c', w: 256, h: 76, size: 56, font: 'display', weight: '800', glow: false });
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FR.look && FR.look.glowTex ? FR.look.glowTex() : null, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    flash.scale.set(0.9, 0.9, 1); flash.visible = false; flash.userData.look = 1; g.add(flash);

    const targets = [
      ev.target,
      { id: 'lobby.news', label: 'News wall', box: [-7.25, 0.8, -7, -1.95, 3.5, -6.8], focus: aim([-4.6, 2.15, -6.9], 0, 6, fitD(5.2, 2.8)) },
      { id: 'lobby.trust', label: 'Public trust', box: R.aabb([tl]), focus: aim([-4.9, 1.55, 4.66], 0, 16, fitD(1.9, 2.8)) },
      { id: 'lobby.record', label: 'Frontier record', box: R.aabb([tr]), focus: aim([4.9, 1.55, 4.66], 0, 16, fitD(1.9, 2.8)) }
    ];
    let nPress = 0, flashT = 0.5, flashLife = 0;
    const f = { group: g, elevator: ev, targets, hint: 'Tap the news wall for the wire. The elevator goes up to the lab floors.',
      view: { pos: [0, 20.3, 13.65], look: [0, 0.8, 0], fov: 62, shift: 0.036 }, // front, over the street: the press pack sits under the room
      light: { hemi: 0.8, sun: 0.5, bg: 0x0b1016 },
      refresh(s) {
        s = s || S();
        paint(news, { date: s ? FR.dateLabel(s.turn) : '', items: (s && s.news ? s.news.slice(-3).reverse() : []).map(n => [n.turn, n.kind, n.text]) }, drawNews);
        const hist = (s && s.history ? s.history.slice(-13) : []).map(r => r.trust), v = s && s.market ? s.market.trust : 50;
        paint(trust, { v: FR.round(v, 1), hist, delta: hist.length > 1 ? FR.round(hist[hist.length - 1] - hist[hist.length - 2], 1) : 0 }, drawTrust);
        const marks = tryf(() => FR.market.K.marks, [30, 45, 60, 75, 90]), firsts = (s && s.market && s.market.firsts) || [];
        paint(record, { rows: marks.map(mk => { const q = firsts.find(r => r.mark === mk); return q ? [mk, q.by, q.turn, whoName(s, q.by)] : [mk, null, null, null]; }) }, drawRecord);
        paint(name, { n: labName(s) }, (x, w, h, d) => { rect(x, 0, 0, w, h, '#1b232c'); T(x, d.n.toUpperCase(), w / 2, h / 2 + 4, 92, HX.ink, 'center', 700, DISP, w - 64); });
        const inc = recentIncidents(s), ago = inc.length ? s.turn - inc[0].turn : 99;
        nPress = inc.length ? clamp(K.pressMax + 2 - 2 * ago, K.pressMin, K.pressMax) : 0;
        press.set(nPress); gear.count = nPress; pressG.visible = nPress > 0; if (!nPress) flash.visible = false;
      },
      update(dt, t) {
        wings.rotation.y = t * 0.35;
        stepWalkers(walk, walk.length, t);
        if (!nPress) return;
        // camera flashes: one at a time, at a random photographer, every 0.2-1.1 s
        if (flashLife > 0) { flashLife -= dt; if (flashLife <= 0) flash.visible = false; }
        flashT -= dt; if (flashT <= 0) { const p = PRESS[Math.floor(Math.random() * nPress)]; flash.position.set(p[0] + Math.sin(p[2]) * 0.62 + Math.cos(p[2]) * 0.12, 1.45, p[1] + Math.cos(p[2]) * 0.62); flash.visible = true; flashLife = 0.07; flashT = 0.2 + Math.random() * 0.9; }
      },
      debug() { return { press: nPress, pressVisible: pressG.visible, walkers: walk.filter(w => w.visible).length, screens: scr.length, targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  // city blocks (instanced, 3 height buckets so the window texture keeps its scale): the block across the lobby street,
  // the skyline below the boardroom and behind it
  function towerGeo(h) {
    const b = new THREE.BoxGeometry(1, h, 1); b.translate(0, h / 2, 0); const uv = b.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const face = Math.floor(i / 4); if (face === 2 || face === 3) uv.setXY(i, 0.03, 0.03); else uv.setY(i, uv.getY(i) * h / 4); }
    return b;
  }
  function city(g, kind) {
    const rnd = FR.rng(kind === 'lobby' ? 404 : 808), tex = winTex();
    const sets = kind === 'lobby'
      ? [{ hs: [5, 7, 10], n: 12, x: [-20, 20], z: [19.5, 21], y0: () => -0.2, w: [2.6, 4], color: 0xffffff }]
      : [{ hs: [22, 30, 38], n: 44, x: [-30, 30], z: [9.5, 30], y0: (h) => -42 + (h - 22) * 0.5 + rnd() * 6, w: [2, 4.2], color: 0xffffff },
        { hs: [22, 30, 38], n: 36, x: [-40, 40], z: [-12, -40], y0: () => -30 + rnd() * 14, w: [2.4, 5], color: 0x6a7280 }];
    sets.forEach(st => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: st.color });
      const per = st.hs.map(() => []);
      for (let i = 0; i < st.n; i++) { const b = Math.floor(rnd() * st.hs.length), x = st.x[0] + rnd() * (st.x[1] - st.x[0]); if (kind === 'lobby' && Math.abs(x) < 1) continue;
        const z = st.z[0] + rnd() * (st.z[1] - st.z[0]); let y0 = st.y0(st.hs[b]);
        // towers in front of the boardroom stay under the camera's sight line to the window wall
        if (kind !== 'lobby' && z > 7) y0 = Math.min(y0, -1.5 + (z - 9.5) * 0.8 - st.hs[b]);
        per[b].push([x, y0, z, st.w[0] + rnd() * (st.w[1] - st.w[0]), st.w[0] + rnd() * (st.w[1] - st.w[0])]); }
      st.hs.forEach((h, b) => { if (!per[b].length) return; const m = inst(g, towerGeo(h), mat, per[b].length); per[b].forEach((p, i) => place(m, i, p[0], p[1], p[2], 0, p[3], 1, p[4])); });
    });
    if (kind !== 'lobby') { const st = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ color: 0x05080c })); st.rotation.x = -PI / 2; st.position.y = -42; g.add(st); }
  }

  // ======================= SERVING (1): status wall, ops desks, rack row; dark + red strobe after an incident =======================
  function drawStatus(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    if (d.dark) {
      rect(x, 0, 0, w, 250, '#2a0d0c');
      T(x, 'MODEL PULLED', w / 2, 86, 92, HX.bad, 'center', 800, DISP, w - 80);
      T(x, d.skill + ' incident · ' + d.when + ' · serving suspended pending review', w / 2, 164, 32, HX.ink2, 'center', 500, SANS, w - 80);
      T(x, 'Status reverts ' + d.until, w / 2, 210, 26, HX.ink3, 'center', 500, SANS, w - 80);
      rect(x, 0, 250, w, h - 250, '#140606'); T(x, 'REQUESTS · HALTED', 24, 272, 20, HX.bad, 'left', 600, MONO); return;
    }
    T(x, 'SERVING', 28, 40, 44, HX.ink, 'left', 700, DISP);
    rrect(x, w - 300, 16, 272, 48, 24, d.pf > 0 ? 'rgba(95,207,154,.18)' : 'rgba(240,162,74,.18)');
    T(x, d.pf > 0 ? 'OPERATIONAL' : 'NO CAPACITY', w - 164, 41, 26, d.pf > 0 ? HX.good : HX.warn, 'center', 700, MONO);
    const col = (i, label, val, c) => { const px = 28 + i * 330; T(x, label, px, 100, 22, HX.ink3, 'left', 600); T(x, val, px, 148, 52, c || HX.ink, 'left', 500, MONO, 300); };
    col(0, 'SERVING', fmtPF(d.pf), HX.brandT); col(1, 'DEMAND', fmtPF(d.demand)); col(2, 'REVENUE / WEEK', money(d.rev), HX.gold);
    const cover = d.demand > 0 ? d.pf / d.demand : 0;
    bar(x, 28, 196, w - 56, 16, cover, cover >= 1 ? HX.good : HX.brandB);
    T(x, d.demand > 0 ? (cover >= 1 ? 'Serving covers all demand. ' + Math.round((cover - 1) * 100) + '% spare capacity.' : 'Serving covers ' + Math.round(cover * 100) + '% of demand.') : 'No demand yet.', 28, 232, 22, HX.ink2, 'left', 500, SANS, w - 56);
    rect(x, 0, 250, w, 2, HX.raised); T(x, 'REQUESTS · LIVE', 24, 272, 20, HX.ink3, 'left', 600, MONO);
  }
  function drawRent(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'COMPUTE', 28, 42, 36, HX.ink, 'left', 700, DISP);
    if (d.scarcity) { rrect(x, w - 250, 20, 222, 44, 22, 'rgba(240,162,74,.2)'); T(x, 'SCARCITY · ' + d.scarcity + ' WK', w - 139, 43, 22, HX.warn, 'center', 700, MONO); }
    const row = (y, a, b, c) => { T(x, a, 28, y, 26, HX.ink3, 'left', 600); T(x, b, w - 28, y, 36, c || HX.ink, 'right', 500, MONO); };
    row(112, 'Capacity', fmtPF(d.cap), HX.brandT); row(170, 'Rented', fmtPF(d.rent)); row(228, 'Spot price', money(d.price) + '/PF'); row(286, 'Weekly bill', money(d.bill), HX.gold);
  }
  R.floors.serving = { build(id) {
    const g = start(), scr = [];
    const EX = -5.2, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    // status wall (back wall) with a scrolling request trace in its lower band, and two beacons on top
    frame(g, 7.6, 2.6, 2.6, 2.15, -HD + 0.05);
    const wall = csign(g, 7.6, 2.6, 1024, 350, 2.6, 2.15, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    const wt = waveTex(), waveMat = new THREE.MeshBasicMaterial({ map: wt, transparent: true, depthWrite: false });
    const wave = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.6), waveMat); wave.position.set(2.6, 1.2, -HD + 0.13); g.add(wave); wt.repeat.x = 2;
    const beacon = new THREE.MeshLambertMaterial({ color: 0x5a1a16, emissive: 0xff3b2f, emissiveIntensity: 1 });
    [-1.1, 6.3].forEach(x => { R.cyl(g, 0.12, 0.14, 0.24, 0x5a1a16, x, 3.62, -HD + 0.22, 12).material = beacon; });
    // red wash for the strobe: additive pools on the floor and the back wall
    const washMat = FR.look && FR.look.glowMat ? FR.look.glowMat(0xff2a1f, 0) : new THREE.MeshBasicMaterial({ color: 0xff2a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(15, 12), washMat); w1.rotation.x = -PI / 2; w1.position.set(0, 0.03, -0.5); w1.userData.look = 1; g.add(w1);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), washMat); w2.position.set(1.5, 2.2, -HD + 0.2); w2.userData.look = 1; g.add(w2);
    // rack row on the left wall, fronts facing the room
    const rs = []; for (let i = 0; i < 15; i++) rs.push({ x: -6.3, z: -4.0 + i * 0.64, ry: PI / 2 });
    const racks = rackKit(g, rs, 'serve');
    R.box(g, 0.5, 0.08, 10.0, 0xc8a03a, -6.3, 2.55, 0.5); R.plane(g, 0.07, 9.8, 0xc8a03a, -5.55, 0.008, 0.5, -PI / 2); R.plane(g, 1.2, 9.8, 0x353c44, -7.3, 0.008, 0.5, -PI / 2);
    // ops desks: three rows of five facing the wall
    const ds = []; [-3.4, -1.1, 1.2].forEach(z => [2.6, 1.0, 4.2, -0.6, 5.8].forEach(x => ds.push({ x, z, ry: 0 })));
    R.plane(g, 8.2, 6.2, 0x434b54, 2.6, 0.01, -1.0, -PI / 2);
    const desks = deskKit(g, ds);
    // rent / compute board (right wall), coffee counter, plants
    frame(g, 3.0, 1.7, 7.9, 2.15, -3.0, -PI / 2).position.x = 7.95;
    const rent = csign(g, 3.0, 1.7, 640, 362, 7.88, 2.15, -3.0, -PI / 2, { bg: HX.sunken }, scr);
    R.box(g, 0.7, 0.95, 2.6, ASH, 7.4, 0.475, 4.6); R.box(g, 0.5, 0.5, 0.4, BLACK, 7.4, 1.2, 4.0);
    plant(g, -7.3, 6.2); plant(g, 7.3, 6.3); plant(g, -2.6, -6.4, 0.9);
    const pm = panels(g, [[-4.5, -3.5], [0, -3.5], [4.5, -3.5], [-4.5, 1.5], [0, 1.5], [4.5, 1.5], [0, 5.2], [4.5, 5.2]]);
    // people
    const stands = [[1.0, -5.4, PI], [3.6, -5.5, PI], [5.6, -5.3, PI + 0.3], [-5.4, -2.0, -PI / 2], [-5.4, 2.6, -PI / 2], [6.6, 4.3, -PI / 2 + 0.3], [-1.9, -4.6, PI * 0.85], [6.3, 5.4, PI * 0.8]];
    const sit = crowd(g, desks.seats, 'sit', 11), stand = crowd(g, stands, 'stand', 12);
    const walk = walkers(g, [[-3.8, -4.6, -3.8, 5.4, 0.22, 0], [7.0, -4.2, 7.0, 2.6, 0.18, 1.2], [-2.4, 3.4, 6.0, 3.4, 0.2, 2.4]], 1);
    const targets = [
      ev.target,
      { id: 'serving.wall', label: 'Status wall', box: [-1.3, 0.75, -7, 6.5, 3.8, -6.8], focus: aim([2.6, 2.15, -6.9], 0, 10, fitD(7.8, 2.8)) },
      { id: 'serving.racks', label: 'Rack row', box: [-6.85, 0, -4.4, -5.75, 2.3, 5.4], focus: aim([-6.3, 1.1, 0.5], 68, 18, 10.5) },
      { id: 'serving.ops', label: 'Ops desks', labelAt: [2.6, 1.5, 1.6], box: [-1.4, 0, -4.1, 6.6, 1.5, 2.3], focus: aim([2.6, 0.8, -2.0], 0, 45, 11) }
    ];
    let act = 0, dark = false, nWalk = 0, split0 = { walk: 0, sit: 0, stand: 0 }, scroll = 0;
    const f = { group: g, elevator: ev, targets, get hint() { return dark ? 'The model is pulled after an incident. Tap the status wall for serving.' : 'Tap the status wall for the serving share, demand and rented compute.'; },
      view: { pos: [3.1, 26.61, 14.57], look: [0, 0.8, 0], fov: 60, shift: -0.029, shiftX: 0.012 },
      light: { hemi: 0.62, sun: 0.5, bg: 0x070b10 },
      refresh(s) {
        s = s || S(); const a = allocOf(s), p = part(s, a, 'serving'), inc = recentIncidents(s);
        act = activity(s, a, 'serving'); dark = inc.length > 0;
        const demand = tryf(() => FR.money.demandPF(s), 0), rev = tryf(() => FR.money.revenue(s, p.pf), s && s.money ? s.money.revenue : 0);
        paint(wall, dark ? { dark, skill: FR.SKILL_NAME[inc[0].skill] || inc[0].skill, when: FR.dateLabel(inc[0].turn), until: FR.dateLabel(inc[0].turn + K.incidentTurns + 1) }
          : { pf: FR.round(p.pf, 1), demand: FR.round(demand, 1), rev: Math.round(rev) }, drawStatus);
        const c = s && s.compute, cap = capacityOf(s);
        paint(rent, { cap: FR.round(cap.total || 0, 1), rent: c ? c.rentPF : 0, price: c ? Math.round(c.rentPrice) : 0, bill: tryf(() => FR.compute.rentCost(s), c ? c.rentPF * c.rentPrice : 0), scarcity: c ? c.scarcity : 0 }, drawRent);
        const nr = racksFor(cap.total, racks.n); racks.set(nr, dark ? 0 : nr * act);
        split0 = split(heads(p.staff), desks.n, stands.length, walk.length);
        sit.set(split0.sit); stand.set(split0.stand); nWalk = split0.walk; desks.set(Math.max(4, split0.sit + 2));
        if (dark) desks.scrMat.color.setRGB(0.28, 0.04, 0.03); else desks.scrMat.color.setScalar(0.35 + 0.65 * act);
        pm.emissiveIntensity = dark ? 0.05 : 0.7; waveMat.opacity = dark ? 0 : 0.35 + 0.65 * act;
      },
      update(dt, t) {
        stepWalkers(walk, nWalk, t);
        scroll = (scroll + dt * (dark ? 0 : 0.03 + 0.25 * act)) % 1; wt.offset.x = scroll;
        racks.tex.offset.y = (racks.tex.offset.y + dt * (0.05 + 0.5 * act)) % 1;
        if (dark) { const pulse = Math.pow(Math.max(0, Math.sin(t * 2.4)), 2); beacon.emissiveIntensity = 0.15 + 0.85 * pulse; washMat.opacity = 0.05 + 0.3 * pulse; rig(f, 0.2 + 0.16 * pulse, 0.25 + 0.55 * pulse); }
        else { beacon.emissiveIntensity = 0; washMat.opacity = 0; rig(f, 0.72 + 0.28 * act, 0); }
      },
      debug() { return { dark, activity: +act.toFixed(2), people: split0, racks: racks.vis, racksLit: racks.lit, desks: desks.count, beacon: +beacon.emissiveIntensity.toFixed(2), targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  // ======================= TRAINING (2): the cluster hall, the run board, the engineers' console =======================
  function drawRun(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'TRAINING RUN', 28, 40, 40, HX.ink2, 'left', 700, DISP); T(x, d.date, w - 28, 40, 26, HX.ink3, 'right', 500, MONO);
    rect(x, 28, 70, w - 56, 2, HX.raised);
    T(x, 'TARGET', 28, 104, 22, HX.ink3, 'left', 600); T(x, d.name.toUpperCase(), 28, 158, 76, HX.brandT, 'left', 800, DISP, 520);
    T(x, 'CAPABILITY', w - 28, 104, 22, HX.ink3, 'right', 600); T(x, cap1(d.cap), w - 28, 160, 80, HX.ink, 'right', 500, MONO);
    T(x, d.pf > 0 ? (d.gain != null ? '+' + d.gain.toFixed(2) + ' capability a week at this allocation' : 'Run in progress') : 'No training compute allocated. The run is idle.', 28, 214, 26, d.pf > 0 ? HX.ink2 : HX.warn, 'left', 500, SANS, w - 56);
    d.skills.forEach((r, i) => {
      const y = 262 + i * 30, on = r[0] === d.target;
      T(x, r[1], 28, y, 22, on ? HX.ink : HX.ink3, 'left', on ? 700 : 500, SANS, 150);
      bar(x, 190, y - 8, w - 330, 16, r[2] / 100, on ? HX.brandB : 'rgba(79,147,217,.45)'); T(x, cap1(r[2]), w - 28, y, 22, on ? HX.ink : HX.ink3, 'right', 500, MONO);
    });
    rect(x, 0, h - 44, w, 44, HX.surface); T(x, fmtPF(d.pf) + ' · ' + d.staff + ' staff · ' + fmtPF(d.capacity) + ' total capacity', w / 2, h - 22, 22, HX.ink3, 'center', 500, MONO, w - 40);
  }
  R.floors.training = { build(id) {
    const g = start(), scr = [];
    const EX = -5.4, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    frame(g, 6.4, 2.0, 2.9, 2.45, -HD + 0.05);
    const board = csign(g, 6.4, 2.0, 1024, 320, 2.9, 2.45, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    // racks: three rows of twelve facing the room, filled back row first from the right
    const rs = []; [-4.4, -1.9, 0.6].forEach(z => { for (let i = 0; i < 12; i++) rs.push({ x: 7.1 - i * 0.64, z, ry: 0 }); });
    const racks = rackKit(g, rs, 'train');
    [-4.4, -1.9, 0.6].forEach((z, r) => {
      R.box(g, 7.8, 0.06, 0.4, 0xc8a03a, 3.6, 2.55, z); R.plane(g, 7.7, 0.6, 0x353c44, 3.55, 0.01, z + 1.2, -PI / 2);
      R.box(g, 0.3, 2.2, 1.04, GRAPH_L, -0.5, 1.1, z);
      R.sign(g, ['ROW ' + 'ABC'[r]], 0.7, 0.3, -0.5, 2.0, z + 0.53, 0, { bg: '#1b232c', fg: HX.ink2, w: 256, h: 108, size: 64, font: 'mono', glow: false });
    });
    // console: two columns of three desks, facing the back wall
    const ds = []; [-2.2, 0.2, 2.6].forEach(z => [-3.2, -5.0].forEach(x => ds.push({ x, z, ry: 0 })));
    R.plane(g, 4.4, 7.0, 0x3a4550, -4.1, 0.012, 0.4, -PI / 2);
    const desks = deskKit(g, ds);
    // cooling units on the left wall, a staging bench front right
    const crac = inst(g, boxes([[0.9, 2.3, 1.6, 0, 1.15, 0], [0.02, 1.6, 1.3, 0.46, 1.3, 0]]), R.mat(0xb8c0c8), 3); [-4.0, -1.0, 2.0].forEach((z, i) => place(crac, i, -7.45, 0, z, 0));
    const bench = grp(g, 4.6, 4.8); R.box(bench, 3.2, 0.06, 0.9, ASH, 0, 0.9, 0); R.box(bench, 3.0, 0.86, 0.06, GRAPH, 0, 0.45, -0.4);
    const brd = inst(bench, new THREE.BoxGeometry(0.34, 0.03, 0.2), R.mat(0x2d5a3a), 6); for (let i = 0; i < 6; i++) place(brd, i, -1.2 + i * 0.48, 0.95, 0.05, (i % 2) * 0.2);
    R.box(g, 0.8, 0.9, 0.6, STEEL, 2.2, 0.45, 5.3);
    plant(g, -7.3, 6.2); plant(g, -2.1, -6.4, 0.9);
    panels(g, [[-4.5, -3.5], [3.5, -5.8], [-4.5, 1.5], [3.5, 3.2], [-4.5, 5.2], [0.5, 5.2]], 0.6);
    const stands = [[1.6, -5.9, PI], [4.2, -5.9, PI], [5.8, -3.1, PI], [2.2, -3.1, PI], [4.0, -0.6, PI], [6.3, 1.9, PI], [1.2, 1.9, PI], [3.6, 5.5, PI], [5.4, 5.5, PI], [-4.1, 4.2, PI * 0.9], [-6.3, -2.6, PI / 2], [-6.4, 4.4, PI / 2]];
    const sit = crowd(g, desks.seats, 'sit', 21), stand = crowd(g, stands, 'stand', 22);
    const walk = walkers(g, [[0.6, -3.2, 6.8, -3.2, 0.16, 0], [6.8, -0.7, 0.6, -0.7, 0.14, 1.3], [-1.3, -5.0, -1.3, 5.6, 0.2, 2.2], [0.6, 3.3, 6.8, 3.3, 0.15, 3.1]], 3);
    const targets = [
      ev.target,
      { id: 'training.board', label: 'Run board', box: [-0.4, 1.35, -7, 6.2, 3.55, -6.8], focus: aim([2.9, 2.45, -6.9], 0, 12, fitD(6.6, 2.2)) },
      { id: 'training.racks', label: 'Cluster', labelAt: [3.6, 2.3, 0.6], box: [-0.7, 0, -4.95, 7.45, 2.3, 1.15], focus: aim([3.6, 1.1, -0.4], -30, 28, 13.5) },
      { id: 'training.console', label: 'Console', box: [-5.8, 0, -2.6, -2.4, 1.5, 3.4], focus: aim([-4.1, 0.8, 0.4], 0, 50, 10) }
    ];
    let act = 0, nWalk = 0, sp = { walk: 0, sit: 0, stand: 0 };
    const f = { group: g, elevator: ev, targets, hint: 'Tap the run board to pick the target skill.',
      view: { pos: [4.48, 25.91, 13.79], look: [0, 0.8, 0], fov: 60, shift: -0.027, shiftX: 0.045 }, // front right, steep: the rows read
      light: { hemi: 0.56, sun: 0.45, bg: 0x06090d },
      refresh(s) {
        s = s || S(); const a = allocOf(s), p = part(s, a, 'training'); act = activity(s, a, 'training');
        const tgt = (s && s.target) || 'coding', sk = s && s.model ? s.model.skills : null, gains = tryf(() => FR.model.gains(s, a), null);
        paint(board, { date: s ? FR.dateLabel(s.turn) : '', target: tgt, name: FR.SKILL_NAME[tgt] || tgt, cap: sk ? FR.round(sk[tgt].cap, 1) : 0,
          gain: gains && gains.cap && gains.cap[tgt] != null ? FR.round(gains.cap[tgt], 2) : null, pf: FR.round(p.pf, 1), staff: Math.round(p.staff), capacity: FR.round(a ? a.capacity : 0, 1),
          skills: FR.SKILLS.map(k => [k, FR.SKILL_NAME[k], sk ? FR.round(sk[k].cap, 1) : 0]) }, drawRun);
        const nr = racksFor(a ? a.capacity : 0, racks.n); racks.set(nr, nr * act);
        sp = split(heads(p.staff), desks.n, stands.length, walk.length); sit.set(sp.sit); stand.set(sp.stand); nWalk = sp.walk; desks.set(Math.max(4, sp.sit + 2));
        desks.scrMat.color.setScalar(0.35 + 0.65 * act); racks.mat.color.setScalar(0.4 + 0.6 * act);
      },
      update(dt, t) {
        stepWalkers(walk, nWalk, t);
        racks.tex.offset.y = (racks.tex.offset.y + dt * (0.04 + 0.6 * act)) % 1;
        rig(f, 0.72 + 0.28 * act, 0);
      },
      debug() { return { activity: +act.toFixed(2), people: sp, racks: racks.vis, racksLit: racks.lit, desks: desks.count, targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  // ======================= SAFETY (3): three skill screens, eval benches, red-team room, incident log =======================
  function drawSkill(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, d.name.toUpperCase(), 24, 38, 40, HX.ink, 'left', 700, DISP, 250);
    const lv = LEVEL[d.level] || LEVEL.ok; rrect(x, w - 190, 16, 166, 42, 21, lv[1]); T(x, lv[0], w - 107, 38, 22, HX.sunken, 'center', 700, MONO);
    T(x, 'CAPABILITY', 24, 96, 20, HX.ink3, 'left', 600); T(x, cap1(d.cap), w - 24, 96, 30, HX.ink, 'right', 500, MONO); bar(x, 24, 114, w - 48, 22, d.cap / 100, HX.brandB);
    T(x, 'SAFETY', 24, 170, 20, HX.ink3, 'left', 600); T(x, cap1(d.safe), w - 24, 170, 30, HX.ink, 'right', 500, MONO); bar(x, 24, 188, w - 48, 22, d.safe / 100, HX.good);
    rect(x, 24 + (w - 48) * clamp(d.safe / 100, 0, 1), 110, 3, 104, 'rgba(238,242,246,.5)');
    T(x, 'GAP', 24, 262, 22, HX.ink3, 'left', 600); T(x, cap1(d.gap), 90, 264, 56, gapCol(d.gap), 'left', 500, MONO);
    T(x, d.inc ? d.inc + (d.inc === 1 ? ' incident' : ' incidents') + ' in 52 wks' : 'No incidents', w - 24, 256, 20, d.inc ? HX.bad : HX.ink3, 'right', 600, SANS, 250);
    T(x, d.final ? 'Final incident in ' + d.final + (d.final === 1 ? ' week' : ' weeks') : d.gap > 10 ? 'Above 10: warnings' : 'Within tolerance', w - 24, 282, 20, d.final ? HX.bad : d.gap > 10 ? HX.warn : HX.ink3, 'right', 600, SANS, 250);
    rect(x, 0, h - 26, w, 26, HX.surface); T(x, d.run ? 'EVAL SUITE RUNNING' : 'EVALS PAUSED · NO SAFETY COMPUTE', w / 2, h - 13, 16, d.run ? HX.good : HX.warn, 'center', 600, MONO);
  }
  // the incident log (768 × 452): title and date, one row per skill, the pressure gauge (FR.ui.pressure, the safety panel's
  // reading), warnings and incidents to date, the safe-hold bar. The gauge sits mid-screen: the focus view frames the
  // screen just under the HUD strip, which covers the title row.
  function drawLog(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'INCIDENT LOG', 28, 40, 40, HX.ink, 'left', 700, DISP); T(x, d.date, w - 28, 40, 22, HX.ink3, 'right', 500, MONO);
    rect(x, 28, 70, w - 56, 2, HX.raised);
    const gap = d.pr ? 54 : 70, y0 = d.pr ? 104 : 118;
    d.rows.forEach((r, i) => {
      const y = y0 + i * gap; T(x, r[0], 28, y, 30, HX.ink, 'left', 600, SANS, 200);
      T(x, r[1].length ? r[1].map(t => wk(t) + ' Y' + FR.year(t)).slice(-3).join(', ') : 'None', 240, y, 24, r[1].length ? HX.bad : HX.ink3, 'left', 500, MONO, w - 280);
      rect(x, 28, y + 26, w - 56, 1, HX.raised);
    });
    let y = 336;
    if (d.pr) {
      const col = HX[d.pr.hue] || HX.warn; y = 282;
      T(x, 'PRESSURE', 28, y, 24, HX.ink3, 'left', 600); T(x, cap1(d.pr.v), 214, y, 34, col, 'left', 500, MONO);
      rrect(x, w - 198, y - 21, 170, 42, 21, col); T(x, d.pr.label, w - 113, y + 1, 22, HX.sunken, 'center', 700, MONO, 150);
      bar(x, 28, y + 30, w - 56, 14, d.pr.pct / 100, col);
      (d.pr.bands || []).forEach(b => rect(x, 28 + (w - 56) * b / 100 - 1, y + 26, 3, 22, HX.line));
      y = 362;
    }
    T(x, 'Warnings to date ' + d.warnings + ' · Incidents ' + d.incidents, 28, y, 24, HX.ink2, 'left', 500, SANS, w - 56);
    T(x, 'Safe frontier hold', 28, y + 44, 24, HX.ink3, 'left', 600); T(x, d.streak + ' / 52 wks', w - 28, y + 44, 30, d.streak > 0 ? HX.good : HX.ink3, 'right', 500, MONO);
    bar(x, 28, y + 64, w - 56, 14, d.streak / 52, HX.good);
  }
  function scribble(x, w, h, seed, title, dark) { // whiteboard: title, boxes and arrows, marker lines
    const rnd = FR.rng(seed); rect(x, 0, 0, w, h, dark ? '#e9ecef' : '#f1f3f5');
    x.strokeStyle = '#3a4756'; x.lineWidth = 4; x.fillStyle = '#1b232c'; T(x, title, 30, 40, 36, '#1b232c', 'left', 700, SANS, w - 60);
    for (let i = 0; i < 5; i++) { const bx = 40 + rnd() * (w - 240), by = 90 + rnd() * (h - 180); x.strokeRect(bx, by, 150, 60); x.beginPath(); x.moveTo(bx + 150, by + 30); x.lineTo(bx + 150 + 40 + rnd() * 60, by + 30 + (rnd() - 0.5) * 80); x.stroke(); }
    x.strokeStyle = '#2d6aa8'; x.lineWidth = 3; for (let i = 0; i < 7; i++) { const y = 90 + rnd() * (h - 120), x0 = 30 + rnd() * (w * 0.5); x.beginPath(); x.moveTo(x0, y); for (let k = 0; k < 8; k++) x.lineTo(x0 + k * 18, y + Math.sin(k + i) * 4); x.stroke(); }
    x.strokeStyle = '#ef6b5b'; x.beginPath(); x.arc(w * 0.75, h * 0.62, 50, 0, 7); x.stroke();
  }
  R.floors.safety = { build(id) {
    const g = start(), scr = [];
    const EX = -5.4, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    // three skill screens on the back wall, an eval progress strip under each
    const XS = [0.3, 3.1, 5.9], skillScr = [], evalBars = [];
    const evalMat = new THREE.MeshBasicMaterial({ color: 0x5fcf9a });
    XS.forEach((x, i) => {
      frame(g, 2.6, 1.76, x, 2.36, -HD + 0.05);
      skillScr.push(csign(g, 2.6, 1.76, 512, 346, x, 2.36, -HD + 0.11, 0, { bg: HX.sunken }, scr));
      R.box(g, 2.4, 0.06, 0.03, GRAPH, x, 1.3, -HD + 0.08);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.03), evalMat); b.geometry.translate(1.2, 0, 0); b.position.set(x - 1.2, 1.3, -HD + 0.1); g.add(b); evalBars.push(b);
    });
    // eval benches: three rows of four facing the screens; the red-team room's three desks share the kit
    const ds = [], rt = [{ x: -5.8, z: 3.6, ry: 0 }, { x: -4.2, z: 3.6, ry: 0 }, { x: -5.0, z: 5.9, ry: PI }];
    [-3.3, -1.1, 1.1].forEach((z, r) => { [2.1, 3.8, 0.4, 5.5].forEach(x => ds.push({ x, z, ry: 0 })); if (r < 3) ds.push(rt[r]); });
    R.plane(g, 7.4, 6.4, 0x7d8791, 2.95, 0.01, -1.1, -PI / 2);
    const desks = deskKit(g, ds);
    // red-team room (front left): glass on two sides, red rails, its own sign and whiteboard
    const gl = { transparent: true, opacity: 0.16, depthWrite: false };
    R.plane(g, 5.3, 2.9, GLASS, -5.25, 1.45, 2.2, null, gl); const gx = R.plane(g, 4.7, 2.9, GLASS, -2.6, 1.45, 4.55, null, gl); gx.rotation.y = PI / 2;
    const redMat = new THREE.MeshBasicMaterial({ color: 0xd9544a });
    R.box(g, 5.3, 0.07, 0.07, 0xd9544a, -5.25, 2.93, 2.2).material = redMat; R.box(g, 0.07, 0.07, 4.7, 0xd9544a, -2.6, 2.93, 4.55).material = redMat;
    [[-2.6, 2.2], [-2.6, 6.85], [-7.9, 2.2]].forEach(([x, z]) => R.box(g, 0.09, 2.95, 0.09, GRAPH, x, 1.47, z));
    R.plane(g, 5.2, 4.6, 0x5a3a3a, -5.25, 0.01, 4.55, -PI / 2);
    R.sign(g, ['RED TEAM'], 2.2, 0.42, -5.25, 3.3, 2.24, 0, { bg: '#1b232c', fg: HX.bad, w: 512, h: 98, size: 64, font: 'display', weight: '800' });
    const rlamp = new THREE.MeshLambertMaterial({ color: 0x5a1a16, emissive: 0xff3b2f, emissiveIntensity: 1 });
    R.box(g, 0.16, 0.16, 0.16, 0x5a1a16, -2.6, 3.08, 2.2).material = rlamp;
    const rwb = csign(g, 2.6, 1.4, 640, 344, -7.88, 1.95, 4.6, PI / 2, { bg: '#f1f3f5', glow: false }, null); paint(rwb, { s: 1 }, (x, w, h) => scribble(x, w, h, 51, 'Attack tree · agents', false));
    // incident log (left wall), eval racks (right wall)
    frame(g, 3.4, 2.0, -7.95, 2.3, -2.6, PI / 2);
    const log = csign(g, 3.4, 2.0, 768, 452, -7.88, 2.3, -2.6, PI / 2, { bg: HX.sunken }, scr);
    const rs = []; for (let i = 0; i < 6; i++) rs.push({ x: 7.25, z: -3.4 + i * 0.64, ry: -PI / 2 });
    const racks = rackKit(g, rs, 'eval'); racks.set(6, 6);
    plant(g, 7.3, 6.2); plant(g, -2.1, -6.4, 0.9); R.box(g, 0.7, 0.95, 2.2, ASH, 7.4, 0.475, 3.6);
    panels(g, [[-4.5, -3.5], [0, -3.5], [4.5, -3.5], [0, 1.5], [4.5, 1.5], [-5, 4.5], [0, 5.2], [4.5, 5.2]]);
    const stands = [[0.3, -5.6, PI], [3.1, -5.7, PI], [5.9, -5.6, PI], [-6.4, -4.6, -PI / 2], [6.5, -1.6, PI / 2], [-3.6, 5.2, -PI * 0.7]];
    const sit = crowd(g, desks.seats, 'sit', 41), stand = crowd(g, stands, 'stand', 42);
    const walk = walkers(g, [[-1.6, -5.0, -1.6, 1.6, 0.2, 0], [-1.6, 3.0, 6.4, 3.0, 0.16, 1.4], [-1.2, -5.2, 6.4, -5.2, 0.13, 2.5]], 4);
    const targets = [
      ev.target,
      { id: 'safety.evals', label: 'Skill screens', box: [-1.1, 1.2, -7, 7.3, 3.35, -6.8], focus: aim([3.1, 2.36, -6.9], 0, 10, fitD(8.4, 1.9)) },
      { id: 'safety.redteam', label: 'Red team', labelAt: [-5.25, 3.5, 2.3], box: [-7.9, 0, 2.1, -2.5, 3.1, 6.9], focus: aim([-5.2, 0.9, 4.5], 18, 50, 10) },
      { id: 'safety.log', label: 'Incident log', box: [-7.95, 1.25, -4.35, -7.8, 3.35, -0.85], focus: aim([-7.9, 2.3, -2.6], 90, 8, fitD(3.4, 2.0)) }
    ];
    let act = 0, nWalk = 0, sp = { walk: 0, sit: 0, stand: 0 }, worst = 'ok';
    const f = { group: g, elevator: ev, targets, hint: 'Tap the skill screens for each gap and its outlook.',
      view: { pos: [3.23, 25.65, 15.19], look: [0, 0.8, 0], fov: 62, shift: -0.037, shiftX: -0.057 },
      light: { hemi: 0.8, sun: 0.55, bg: 0x0b1015 },
      refresh(s) {
        s = s || S(); const a = allocOf(s), p = part(s, a, 'safety'); act = activity(s, a, 'safety'); worst = 'ok';
        const rank = { ok: 0, watch: 1, warning: 2, critical: 3 };
        FR.SKILLS.forEach((k, i) => {
          const sk = s && s.model ? s.model.skills[k] : { cap: 0, safe: 0, incidents: [] }, o = tryf(() => FR.model.outlook(s, k), null), gap = Math.max(0, sk.cap - sk.safe);
          const level = o ? o.level : gap > 20 ? 'warning' : gap > 10 ? 'watch' : 'ok'; if (rank[level] > rank[worst]) worst = level;
          paint(skillScr[i], { name: FR.SKILL_NAME[k], cap: FR.round(sk.cap, 1), safe: FR.round(sk.safe, 1), gap: FR.round(gap, 1), level,
            inc: s ? (sk.incidents || []).filter(t => t > s.turn - 52).length : 0, final: o ? o.turnsToFinal : null, run: p.pf > 0 }, drawSkill);
        });
        const pr = s && FR.ui && FR.ui.pressure ? tryf(() => FR.ui.pressure(s), null) : null;
        paint(log, { date: s ? FR.dateLabel(s.turn) : '', pr: pr ? { v: FR.round(pr.value, 1), label: String(pr.label).toUpperCase(), hue: pr.hue, pct: Math.round(pr.pct), bands: pr.bands || [] } : null, rows: FR.SKILLS.map(k => [FR.SKILL_NAME[k], s && s.model ? (s.model.skills[k].incidents || []).slice() : []]),
          warnings: s && s.stats ? s.stats.warnings : 0, incidents: s && s.stats ? s.stats.incidents : 0, streak: s && s.win ? s.win.streak : 0 }, drawLog);
        sp = split(heads(p.staff), desks.n, stands.length, walk.length); sit.set(sp.sit); stand.set(sp.stand); nWalk = sp.walk; desks.set(Math.max(5, sp.sit + 2));
        desks.scrMat.color.setScalar(0.35 + 0.65 * act); racks.set(6, Math.round(6 * act)); racks.mat.color.setScalar(0.4 + 0.6 * act);
        evalMat.color.set(p.pf > 0 ? 0x5fcf9a : 0xf0a24a);
      },
      update(dt, t) {
        stepWalkers(walk, nWalk, t);
        const k = act > 0 ? ((t * (0.05 + 0.25 * act)) % 1) : 0.02;
        for (let i = 0; i < evalBars.length; i++) evalBars[i].scale.x = Math.max(0.02, (k + i * 0.29) % 1);
        racks.tex.offset.y = (racks.tex.offset.y + dt * (0.04 + 0.4 * act)) % 1;
        rlamp.emissiveIntensity = worst === 'critical' ? 0.5 + 0.5 * Math.sin(t * 5) : worst === 'warning' ? 0.6 : 0.15;
        rig(f, 0.74 + 0.26 * act, 0);
      },
      debug() { return { activity: +act.toFixed(2), worst, people: sp, desks: desks.count, targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  // ======================= RESEARCH (4): offer board, whiteboards, long tables, reading room, tier plaque =======================
  function drawOffers(x, w, h, d) {
    const rnd = FR.rng(4242); rect(x, 0, 0, w, h, '#a98158');
    for (let i = 0; i < 700; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(80,50,28,.3)' : 'rgba(225,190,140,.28)'; x.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 4, 2 + rnd() * 3); }
    rect(x, 24, 18, 460, 62, '#f3f1ea'); T(x, 'PROJECT OFFERS', 44, 50, 40, '#1b232c', 'left', 700, DISP, 420);
    rect(x, w - 344, 18, 320, 62, '#f3f1ea'); T(x, d.refresh ? 'New offers ' + wk(d.refresh) : '', w - 184, 50, 24, '#3a4756', 'center', 600, SANS, 300);
    if (!d.rows.length) { rect(x, w / 2 - 260, 170, 520, 120, '#f3f1ea'); T(x, 'No offers on the board', w / 2, 212, 34, '#1b232c', 'center', 600); T(x, d.refresh ? 'New offers ' + wk(d.refresh) : '', w / 2, 256, 26, '#3a4756', 'center', 500); return; }
    const cw = (w - 24 * 5) / 4;
    d.rows.forEach((r, i) => {
      const px = 24 + i * (cw + 24), py = 104, ch = h - py - 60, lock = r[5] > d.tier;
      x.save(); x.translate(px + cw / 2, py + ch / 2); x.rotate(((i * 37) % 7 - 3) * 0.006); x.translate(-cw / 2, -ch / 2);
      rect(x, 5, 7, cw, ch, 'rgba(0,0,0,.25)'); rect(x, 0, 0, cw, ch, lock ? '#d9d6ce' : '#fbfaf6');
      rect(x, 0, 0, cw, 10, r[6]);
      x.font = fnt(700, 26); x.fillStyle = '#1b232c'; x.textAlign = 'left'; wrap(x, r[0], cw - 28, 3).forEach((l, j) => x.fillText(l, 14, 44 + j * 30));
      T(x, r[1], 14, 146, 18, '#5b6b7a', 'left', 600, SANS, cw - 28);
      T(x, r[2] + ' wks', 14, 184, 26, '#1b232c', 'left', 500, MONO); T(x, money(r[3]), cw - 14, 184, 26, '#1b232c', 'right', 500, MONO, cw / 2);
      T(x, lock ? 'Needs tier ' + r[5] : r[4] != null ? 'Risk ' + Math.round(r[4] * (r[4] <= 1 ? 100 : 1)) + '%' : '', 14, 218, 20, lock ? '#a0402f' : '#3a4756', 'left', 600, SANS, cw - 28);
      x.restore(); rrect(x, px + cw / 2 - 8, py - 4, 16, 16, 8, lock ? '#8a8f96' : '#ef6b5b');
    });
    rect(x, 0, h - 44, w, 44, 'rgba(20,24,30,.55)'); T(x, d.free + ' of ' + d.slots + ' project slots free · research tier ' + d.tier, w / 2, h - 22, 22, HX.ink, 'center', 600, SANS, w - 40);
  }
  const KIND_COL = { racks: '#4f93d9', evals: '#5fcf9a', launch: '#e6c15a', data: '#9cc0ff', crates: '#f0a24a' };
  R.floors.research = { build(id) {
    const g = start(), scr = [];
    const EX = -5.4, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    // tier plaque (brass) between the elevator and the offer board
    R.box(g, 1.9, 1.34, 0.06, 0x8a7440, -2.1, 2.2, -HD + 0.04);
    const tier = csign(g, 1.76, 1.2, 384, 262, -2.1, 2.2, -HD + 0.08, 0, { bg: '#b89a58', glow: false }, scr);
    // offer board: cork in a wood frame
    R.box(g, 6.0, 2.56, 0.08, WOOD, 4.3, 2.2, -HD + 0.04);
    const offers = csign(g, 5.8, 2.4, 1024, 424, 4.3, 2.2, -HD + 0.09, 0, { bg: '#a98158', glow: false }, scr);
    // whiteboards (left wall)
    const wb1 = csign(g, 2.8, 1.5, 640, 344, -7.88, 2.0, -3.3, PI / 2, { bg: '#f1f3f5', glow: false }, null); paint(wb1, { s: 1 }, (x, w, h) => scribble(x, w, h, 61, 'Scaling notes', false));
    const wb2 = csign(g, 2.8, 1.5, 640, 344, -7.88, 2.0, 0.1, PI / 2, { bg: '#f1f3f5', glow: false }, scr);
    [-3.3, 0.1].forEach(z => { R.box(g, 0.05, 1.6, 2.9, 0x9aa4ae, -7.97, 2.0, z); R.box(g, 0.14, 0.04, 2.5, 0x9aa4ae, -7.88, 1.2, z); });
    // two long tables, desks back to back, desk lamps along the middle
    const ds = [];
    [[-2.6], [0.9]].forEach(([zc]) => [0.1, 1.6, -1.4, 3.1].forEach(x => { ds.push({ x, z: zc + 0.36, ry: 0 }); ds.push({ x, z: zc - 0.36, ry: PI }); }));
    const desks = deskKit(g, ds, { chair: 0x5a4a3e });
    const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe2b8, emissive: 0xffc88a, emissiveIntensity: 1 }), lamps = [];
    [-2.6, 0.9].forEach(zc => [-0.65, 2.35].forEach(x => { R.cyl(g, 0.015, 0.015, 0.4, GRAPH, x, 0.97, zc, 6); const l = R.cyl(g, 0.08, 0.14, 0.12, 0xffe2b8, x, 1.2, zc, 10); l.material = lampMat; lamps.push(l); }));
    // reading room (front right): shelves on the right wall, armchairs, floor lamps, a rug
    R.plane(g, 4.2, 4.4, 0x7a5a48, 5.6, 0.01, 4.4, -PI / 2);
    const bk = []; [2.4, 4.0, 5.6].forEach(z => { R.box(g, 0.45, 2.3, 1.5, 0x5a4636, 7.55, 1.15, z); [0.45, 0.95, 1.45, 1.95].forEach(y => { for (let i = 0; i < 9; i++) bk.push([7.42, y + 0.18, z - 0.62 + i * 0.155]); }); });
    const rndB = FR.rng(9), bcols = [0x8a3a30, 0x2f4858, 0xc9b27a, 0x3d5a80, 0x5a6a3a, 0x7a6a8a, 0xd8d0c0];
    const books = inst(g, new THREE.BoxGeometry(0.2, 0.34, 0.12), new THREE.MeshLambertMaterial({ color: 0xffffff }), bk.length, true);
    bk.forEach((p, i) => { place(books, i, p[0], p[1], p[2], 0, 1, 0.8 + rndB() * 0.3, 1); books.setColorAt(i, _col.set(bcols[Math.floor(rndB() * bcols.length)])); }); books.instanceColor.needsUpdate = true;
    const arm = (x, z, ry) => { const a = grp(g, x, z, ry); R.box(a, 0.9, 0.42, 0.85, 0x7a5a4a, 0, 0.21, 0); R.box(a, 0.9, 0.6, 0.2, 0x7a5a4a, 0, 0.7, -0.33); R.box(a, 0.16, 0.6, 0.85, 0x6a4a3a, -0.45, 0.3, 0); R.box(a, 0.16, 0.6, 0.85, 0x6a4a3a, 0.45, 0.3, 0); };
    arm(5.0, 3.2, PI / 2 + 0.3); arm(5.0, 5.4, PI / 2 - 0.3);
    [[4.4, 4.3], [6.6, 6.4]].forEach(([x, z]) => { R.cyl(g, 0.02, 0.02, 1.5, GRAPH, x, 0.75, z, 6); const l = R.cyl(g, 0.16, 0.24, 0.28, 0xffe2b8, x, 1.55, z, 12); l.material = lampMat; lamps.push(l); });
    // round meeting table (front left), plants
    R.cyl(g, 0.7, 0.7, 0.05, ASH, -5.2, 0.74, 4.2, 20); R.cyl(g, 0.08, 0.2, 0.72, GRAPH, -5.2, 0.36, 4.2, 10);
    const rtc = [[-5.2, 3.2, 0], [-6.1, 4.6, 2.1], [-4.3, 4.6, -2.1]], rch = inst(g, boxes([[0.5, 0.08, 0.48, 0, 0.46, 0], [0.48, 0.5, 0.07, 0, 0.78, -0.25], [0.06, 0.4, 0.06, 0, 0.22, 0], [0.46, 0.04, 0.46, 0, 0.02, 0]]), R.mat(0x5a4a3e), 3);
    rtc.forEach((c, i) => place(rch, i, c[0], 0, c[1], c[2]));
    plant(g, -7.3, 6.2); plant(g, 0.6, -6.4, 0.8); plant(g, 7.3, 0.6);
    panels(g, [[-4.5, -3.5], [0.8, -4.6], [0.8, -0.8], [4.5, -3.5], [0.8, 2.8], [-4.5, 1.5], [5.4, 4.4]], 0.6);
    const seats = desks.seats.concat([[5.0, 3.2, PI / 2 + 0.3], [5.0, 5.4, PI / 2 - 0.3], [-5.2, 3.2, 0], [-6.1, 4.6, 2.1], [-4.3, 4.6, -2.1]]);
    const stands = [[-6.7, -3.3, -PI / 2], [-6.6, 0.1, -PI / 2], [6.9, 5.8, PI / 2], [4.3, -5.6, PI]];
    const sit = crowd(g, seats, 'sit', 51), stand = crowd(g, stands, 'stand', 52);
    const walk = walkers(g, [[-3.4, -5.2, -3.4, 5.4, 0.18, 0], [-2.4, 2.6, 4.4, 2.6, 0.15, 1.6], [4.6, -4.6, -2.6, -4.6, 0.14, 2.8]], 5);
    const targets = [
      ev.target,
      { id: 'research.offers', label: 'Offer board', box: [1.25, 0.9, -7, 7.35, 3.5, -6.8], focus: aim([4.3, 2.2, -6.9], 0, 10, fitD(6.0, 2.6)) },
      { id: 'research.whiteboard', label: 'Whiteboards', box: [-7.95, 1.15, -4.8, -7.8, 2.85, 1.6], focus: aim([-7.9, 2.0, -1.6], 90, 12, fitD(6.4, 1.6)) },
      { id: 'research.tier', label: 'Tier', box: [-3.1, 1.45, -7, -1.1, 2.95, -6.8], focus: aim([-2.1, 2.2, -6.9], 0, 6, fitD(1.9, 1.34)) }
    ];
    let act = 0, nWalk = 0, sp = { walk: 0, sit: 0, stand: 0 };
    const f = { group: g, elevator: ev, targets, hint: 'Tap the offer board to greenlight a project.',
      view: { pos: [2.94, 25.31, 13.84], look: [0, 0.8, 0], fov: 60, shift: -0.029, shiftX: 0.018 },
      light: { hemi: 0.72, sun: 0.6, bg: 0x0e1014 },
      refresh(s) {
        s = s || S(); const a = allocOf(s), p = part(s, a, 'research'); act = activity(s, a, 'research');
        const rs = (s && s.research) || { points: 0, tier: 1 }, pr = (s && s.projects) || { slots: 3, active: [], offers: [] };
        const nt = tryf(() => FR.projects.nextTier(s), null);
        paint(tier, { t: rs.tier, p: Math.round(rs.points || 0), left: nt ? Math.ceil(nt.left) : null }, (x, w, h, d) => {
          rect(x, 0, 0, w, h, '#b89a58'); x.strokeStyle = '#6a5428'; x.lineWidth = 6; x.strokeRect(12, 12, w - 24, h - 24);
          T(x, 'RESEARCH TIER', w / 2, 54, 30, '#2a2010', 'center', 700, DISP); T(x, String(d.t), w / 2, 128, 92, '#2a2010', 'center', 700, MONO);
          T(x, d.p + ' points', w / 2, 194, 26, '#3a2e18', 'center', 600, SANS, w - 40);
          T(x, d.left != null ? d.left + ' to tier ' + (d.t + 1) : 'Top tier', w / 2, 228, 22, '#3a2e18', 'center', 500, SANS, w - 40);
        });
        paint(offers, { tier: rs.tier || 1, refresh: pr.refreshAt || 0, slots: pr.slots || 3, free: Math.max(0, (pr.slots || 3) - (pr.active || []).length),
          rows: (pr.offers || []).slice(0, 4).map(o => [o.name, (KIND_LABEL[o.kind] || String(o.kind || '')) + (o.pfPerTurn ? ' · ' + o.pfPerTurn + ' PF a week' : ''), o.turns, o.cost, o.risk, o.tier || 1, KIND_COL[themeOf(o)]]) }, drawOffers);
        paint(wb2, { staff: Math.round(p.staff), pf: FR.round(p.pf, 1), share: s && s.sliders ? s.sliders.research : 0, rate: FR.round(tryf(() => FR.projects.researchRate(s), 0), 1) }, (x, w, h, d) => {
          scribble(x, w, h, 71, 'Research', false); rect(x, 24, h - 110, w - 48, 92, 'rgba(45,106,168,.12)');
          T(x, d.share + '% of compute · ' + fmtPF(d.pf) + ' · ' + d.staff + ' staff', w / 2, h - 82, 28, '#1b232c', 'center', 600, SANS, w - 70);
          T(x, '+' + d.rate + ' research points a week', w / 2, h - 44, 26, '#2d6aa8', 'center', 600, SANS, w - 70);
        });
        sp = split(heads(p.staff), desks.n, stands.length, walk.length); sit.set(sp.sit); stand.set(sp.stand); nWalk = sp.walk; desks.set(Math.max(4, Math.min(desks.n, sp.sit + 2)));
        desks.scrMat.color.setScalar(0.35 + 0.65 * act);
      },
      // lamps dim in update, not refresh: look's glow bake (after the build) only gives a glow to a lamp that is lit then
      update(dt, t) { stepWalkers(walk, nWalk, t); lampMat.emissiveIntensity = 0.15 + 0.85 * act; rig(f, 0.74 + 0.26 * act, 0); },
      debug() { return { activity: +act.toFixed(2), people: sp, desks: desks.count, lamps: +lampMat.emissiveIntensity.toFixed(2), targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  // ======================= PROJECT FLOORS (5..7): a war room themed by the slot's project; empty = dust sheets =======================
  // theme from the project: its template id (07_projects), then its kind, then words in kind / tpl / name.
  // training run: racks · safety, research, interpretability: eval screens · product: launch wall · data and business
  // deals: file boxes · chip pre-order, supply contracts: crates
  const TPL_THEME = { train: 'racks', train2: 'racks', frontier: 'racks', efficiency: 'racks', preorder: 'crates', supply: 'crates',
    data: 'data', enterprise: 'data', platform: 'data', card: 'launch', launch: 'launch', flagship: 'launch' };
  const KIND_THEME = { training: 'racks', safety: 'evals', research: 'evals', product: 'launch', business: 'data', compute: 'crates' };
  const KIND_NAME = { racks: 'Training run', evals: 'Safety and evals', launch: 'Product launch', data: 'Data deal', crates: 'Chip pre-order' };
  const KIND_LABEL = { training: 'Training', safety: 'Safety', research: 'Research', product: 'Product', business: 'Business', compute: 'Compute' };
  function themeOf(p) {
    if (!p) return null; if (TPL_THEME[p.tpl]) return TPL_THEME[p.tpl];
    const k = String(p.kind || '').toLowerCase(); if (KIND_THEME[k]) return KIND_THEME[k];
    const t = (k + ' ' + String(p.tpl || '') + ' ' + String(p.name || '')).toLowerCase();
    if (/chip|pre-?order|cluster|hardware|gpu/.test(t)) return 'crates';
    if (/data/.test(t)) return 'data';
    if (/train|efficien|distill/.test(t)) return 'racks';
    if (/product|launch|enterprise|contract|api|customer/.test(t)) return 'launch';
    return 'evals';
  }
  function payoffText(p) {
    const d = tryf(() => FR.projects.describe(p, S()), ''); if (d) return d;   // with the state: a safety payoff says what it adds today
    const v = p && p.payoff; if (v == null) return ''; if (typeof v === 'string') return v; if (typeof v === 'number') return '+' + v;
    const out = []; const add = (label, n) => { if (typeof n === 'number' && n) out.push(label + ' ' + (n > 0 ? '+' : '') + (Math.abs(n) >= 1000 ? money(n) : FR.round(n, 1))); };
    Object.keys(v).forEach(key => { const n = v[key]; if (key === 'text' && typeof n === 'string') { out.length = 0; out.push(n); return; }
      if (n && typeof n === 'object') Object.keys(n).forEach(s2 => add((FR.SKILL_NAME[s2] || s2) + ' ' + key, n[s2]));
      else if (typeof n === 'number') add(key === 'cap' || key === 'safe' ? (FR.SKILL_NAME[v.skill || p.skill] || '') + ' ' + (key === 'cap' ? 'capability' : 'safety') : key, n); });
    return out.join(' · ');
  }
  function drawProgress(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'PROJECT FLOOR ' + d.slot, 28, 40, 30, HX.ink3, 'left', 700, DISP);
    if (!d.p) { T(x, 'No project in this slot', w / 2, h / 2 - 10, 52, HX.ink3, 'center', 600, SANS, w - 80); T(x, 'Greenlight one from the offer board on Research', w / 2, h / 2 + 50, 28, HX.ink3, 'center', 500, SANS, w - 80); return; }
    rrect(x, w - 320, 16, 292, 48, 24, d.col); T(x, d.kind.toUpperCase(), w - 174, 41, 22, HX.sunken, 'center', 700, MONO, 270);
    T(x, d.name, 28, 106, 58, HX.ink, 'left', 700, DISP, w - 56);
    bar(x, 28, 150, w - 56, 30, d.done, d.col); T(x, Math.round(d.done * 100) + '% done · ' + d.turns + ' weeks of work', 28, 210, 30, HX.ink2, 'left', 600, SANS, w * 0.6);
    T(x, d.left + (d.left === 1 ? ' week left' : ' weeks left'), w - 28, 210, 30, HX.ink, 'right', 500, MONO);
    const cell = (i, a, b, c) => { const px = 28 + i * ((w - 56) / 3); T(x, a, px, 264, 20, HX.ink3, 'left', 600); T(x, b, px, 300, 32, c || HX.ink, 'left', 500, MONO, (w - 56) / 3 - 20); };
    cell(0, 'RISK', d.risk != null ? Math.round(d.risk * (d.risk <= 1 ? 100 : 1)) + '%' : '-', d.risk > 0.3 ? HX.warn : HX.ink); cell(1, 'COST', money(d.cost), HX.gold); cell(2, 'COMPUTE', fmtPF(d.pf), HX.brandT);
    if (d.payoff) T(x, 'Payoff: ' + d.payoff, 28, 356, 26, HX.ink2, 'left', 500, SANS, w - 56);
    if (d.overrun) { rect(x, 0, h - 48, w, 48, 'rgba(240,162,74,.18)'); T(x, 'OVERRUN · schedule extended', w / 2, h - 24, 24, HX.warn, 'center', 700, MONO); }
  }
  function drawLaunch(x, w, h, d) {
    const gr = x.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#16304f'); gr.addColorStop(1, '#0a0e13'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
    rrect(x, w * 0.62, h * 0.18, w * 0.26, h * 0.64, 26, '#202a35'); rrect(x, w * 0.64, h * 0.23, w * 0.22, h * 0.52, 12, '#4f93d9');
    for (let i = 0; i < 4; i++) rect(x, w * 0.66, h * (0.3 + i * 0.1), w * (0.18 - i * 0.03), 12, 'rgba(238,242,246,.7)');
    T(x, 'LAUNCH', 50, 90, 44, HX.brandT, 'left', 700, DISP); T(x, d.name, 50, 170, 60, HX.ink, 'left', 800, DISP, w * 0.55);
    T(x, d.left + (d.left === 1 ? ' week' : ' weeks') + ' to launch', 50, 250, 40, HX.gold, 'left', 600, MONO, w * 0.55);
  }
  function drawEvalWall(x, w, h, d) {
    const rnd = FR.rng(d.seed); rect(x, 0, 0, w, h, '#05080c'); const cw = (w - 40) / 3, ch = (h - 30) / 2;
    for (let i = 0; i < 6; i++) { const px = 10 + (i % 3) * (cw + 10), py = 10 + Math.floor(i / 3) * (ch + 10); rect(x, px, py, cw, ch, HX.surface);
      T(x, ['EVAL', 'PROBE', 'RED TEAM', 'ATTRIB', 'REFUSAL', 'JAILBRK'][i] + ' ' + (i + 1), px + 12, py + 22, 18, HX.ink3, 'left', 600, MONO);
      if (i % 2) { x.strokeStyle = i === 3 ? HX.warn : HX.good; x.lineWidth = 3; x.beginPath(); for (let k = 0; k < 14; k++) { const X = px + 12 + k * (cw - 24) / 13, Y = py + ch - 20 - (ch - 60) * (0.3 + 0.6 * rnd()); if (k) x.lineTo(X, Y); else x.moveTo(X, Y); } x.stroke(); }
      else for (let k = 0; k < 8; k++) { const bh = (ch - 60) * (0.2 + 0.8 * rnd()); rect(x, px + 14 + k * (cw - 28) / 8, py + ch - 14 - bh, (cw - 28) / 8 - 6, bh, k % 3 ? HX.brandB : HX.good); } }
  }
  function buildProject(id) {
    const slot = META[id] && META[id].slot != null ? META[id].slot : Math.max(0, (+String(id).slice(-1) || 1) - 1);
    const s0 = S(), p = s0 && s0.projects && s0.projects.active ? s0.projects.active[slot] || null : null, theme = themeOf(p);
    const g = start(p ? null : 'vacant'), scr = [];
    const EX = 0.4, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    frame(g, 4.6, 2.3, 5.0, 2.25, -HD + 0.05);
    const board = csign(g, 4.6, 2.3, 1024, 512, 5.0, 2.25, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    // war room table (right half), chairs, laptops; the themed setup fills the left half (x -7..-1.6)
    const tb = grp(g, 4.0, 1.4); R.box(tb, 4.4, 0.07, 1.5, p ? ASH : 0xa9a49a, 0, 0.75, 0); [-1.5, 1.5].forEach(x => R.box(tb, 0.5, 0.72, 0.9, GRAPH, x, 0.36, 0));
    const CH = []; [2.4, 3.5, 4.6, 5.7].forEach(x => { CH.push([x, 2.45, PI]); CH.push([x, 0.35, 0]); });
    const chairs = inst(g, boxes([[0.5, 0.08, 0.48, 0, 0.46, 0], [0.48, 0.5, 0.07, 0, 0.78, -0.25], [0.06, 0.4, 0.06, 0, 0.22, 0], [0.46, 0.04, 0.46, 0, 0.02, 0]]), R.mat(FABRIC), CH.length);
    CH.forEach((c, i) => place(chairs, i, c[0], 0, c[1], c[2]));
    const setG = grp(g, 0, 0); let setupBox = null, setupLabel = '', setupFocus = null, tex = null, act2 = 0, stands = [], extra = null;
    let emptySign = null;
    if (!p) {
      // dust sheets over the table and chairs, stacked chairs, a ladder, paint, a work light; the Available sign
      R.box(g, 4.8, 0.9, 2.9, 0xcfccc4, 4.0, 0.45, 1.4); R.box(g, 4.6, 0.06, 2.7, 0xdad7cf, 4.0, 0.92, 1.4);
      chairs.count = 0;
      const st = inst(g, boxes([[0.5, 0.06, 0.48, 0, 0, 0], [0.48, 0.4, 0.05, 0, 0.2, -0.24]]), R.mat(0x4a5058), 6); for (let i = 0; i < 6; i++) place(st, i, -5.0, 0.46 + i * 0.1, -3.8, 0.1 * (i % 2));
      [-0.2, 0.2].forEach(dx => { const r = R.box(g, 0.06, 2.6, 0.06, 0xc9a13b, -3.4 + dx, 1.25, -5.4); r.rotation.x = 0.18; }); for (let i = 0; i < 6; i++) R.box(g, 0.46, 0.04, 0.05, 0xc9a13b, -3.4, 0.3 + i * 0.4, -5.4 + 0.06 * i - 0.2);
      R.cyl(g, 0.16, 0.16, 0.3, 0xe6ebf0, -2.3, 0.15, -4.6, 12); R.cyl(g, 0.16, 0.16, 0.3, 0xe6ebf0, -1.9, 0.15, -4.8, 12);
      R.plane(g, 3.0, 2.4, 0xd8d5cc, -4.4, 0.012, -1.0, -PI / 2);
      R.cyl(g, 0.02, 0.02, 1.6, GRAPH, -5.4, 0.8, 1.6, 6); R.box(g, 0.34, 0.24, 0.14, 0xfff0d0, -5.4, 1.66, 1.6, { emissive: 0xffe0b0, emissiveIntensity: 0.9 });
      const sg = grp(g, -1.6, 2.8); sg.rotation.x = -0.32; R.box(sg, 3.76, 1.54, 0.06, 0x1e252c, 0, 1.55, -0.05);
      emptySign = csign(sg, 3.6, 1.4, 1024, 398, 0, 1.55, 0, 0, { bg: '#1b232c' }, scr);
      [-1.55, 1.55].forEach(x => { R.box(sg, 0.08, 1.75, 0.08, 0x6a737c, x, 0.87, -0.12); R.box(sg, 0.1, 0.05, 0.7, 0x6a737c, x, 0.025, -0.12); });
      panels(g, [[-4.5, 1.5], [4.5, -3.5]], 0.35);
    } else {
      stands = [[4.0, -5.6, PI], [6.2, -5.5, PI]];
      panels(g, [[-4.5, -3.5], [0, -3.5], [4.5, -3.5], [-4.5, 1.5], [0, 1.5], [4.5, 1.5], [0, 5.2], [4.5, 5.2]]);
      const laps = inst(g, boxes([[0.36, 0.02, 0.26, 0, 0.79, 0], [0.36, 0.24, 0.02, 0, 0.9, 0.13, 0, 0.2]]), R.mat(0x3a424a), CH.length);
      CH.forEach((c, i) => place(laps, i, c[0], 0, c[1] + (c[2] ? -0.45 : 0.45), c[2]));
      R.plane(g, 5.8, 3.8, 0x3a4450, 4.0, 0.01, 1.4, -PI / 2);
      R.plane(g, 6.2, 7.6, { racks: 0x2f3a48, evals: 0x2f4038, launch: 0x3e3a2c, data: 0x33404c, crates: 0x40372c }[theme] || 0x33404c, -4.3, 0.008, -2.4, -PI / 2);
      const fc = grp(g, 6.9, -1.3, -0.6); R.box(fc, 0.9, 1.1, 0.04, 0xf1f3f5, 0, 1.45, 0); [-0.4, 0.4].forEach(x => R.box(fc, 0.04, 1.9, 0.04, GRAPH, x, 0.95, -0.1));
      if (theme === 'racks') {
        const rs = []; [-5.2, -2.8, -0.4].forEach(z => { for (let i = 0; i < 8; i++) rs.push({ x: -6.6 + i * 0.64, z, ry: 0 }); });
        const racks = rackKit(setG, rs, 'train'); racks.set(rs.length, rs.length); tex = racks.tex; act2 = 0.8;
        [-5.2, -2.8, -0.4].forEach(z => R.box(setG, 5.4, 0.06, 0.4, 0xc8a03a, -4.36, 2.55, z));
        setupBox = [-7.0, 0, -5.8, -1.7, 2.3, 0.2]; setupLabel = 'Run hardware'; setupFocus = aim([-4.4, 1.1, -2.8], -20, 32, 12);
        stands.push([-5.6, -4.0, PI], [-3.4, -1.6, PI], [-4.8, 0.8, PI]);
      } else if (theme === 'evals') {
        const vw = grp(setG, -4.3, -4.6); frame(vw, 4.6, 2.3, 0, 1.95, -0.06);
        const ew = csign(vw, 4.6, 2.3, 1024, 512, 0, 1.95, 0, 0, { bg: '#05080c' }, null); paint(ew, { seed: FR.hash(String(p.uid || p.name)) }, drawEvalWall);
        [-2.0, 2.0].forEach(x => { R.box(vw, 0.1, 0.8, 0.1, STEEL, x, 0.4, -0.08); R.box(vw, 0.12, 0.05, 0.9, STEEL, x, 0.025, -0.08); });
        [-6.0, -2.6].forEach((x, i) => { const st = grp(setG, x, 0.4); R.box(st, 1.3, 0.8, 0.08, BLACK, 0, 1.6, 0); R.box(st, 0.08, 1.2, 0.08, STEEL, 0, 0.6, -0.02); R.box(st, 0.8, 0.05, 0.6, GRAPH, 0, 0.03, 0);
          const sc = csign(st, 1.2, 0.7, 256, 150, 0, 1.6, 0.05, 0, { bg: '#05080c' }, null); paint(sc, { seed: 3 + i }, drawEvalWall); });
        const dk = deskKit(setG, [{ x: -5.2, z: -2.3, ry: 0 }, { x: -3.4, z: -2.3, ry: 0 }]); dk.set(2); extra = dk;
        setupBox = [-6.9, 0, -5.0, -1.7, 3.2, 1.0]; setupLabel = 'Eval screens'; setupFocus = aim([-4.3, 1.95, -4.6], 0, 14, fitD(4.8, 2.5));
        stands.push([-4.3, -3.6, PI], [-6.0, 1.4, PI], [-2.6, 1.4, PI]);
      } else if (theme === 'launch') {
        frame(setG, 5.0, 2.5, -4.4, 2.15, -HD + 0.05);
        const lw = csign(setG, 5.0, 2.5, 1024, 512, -4.4, 2.15, -HD + 0.11, 0, { bg: '#0a0e13' }, scr); extra = lw;
        R.box(setG, 4.2, 0.22, 1.8, GRAPH_L, -4.4, 0.11, -5.6); R.box(setG, 0.6, 1.1, 0.5, ASH, -4.4, 0.77, -5.3);
        const seatsL = []; [-3.2, -2.0].forEach(z => [-6.2, -5.3, -4.4, -3.5, -2.6].forEach(x => seatsL.push([x, z, PI])));
        const lc = inst(setG, boxes([[0.46, 0.06, 0.44, 0, 0.45, 0], [0.44, 0.44, 0.05, 0, 0.7, -0.22], [0.05, 0.42, 0.05, -0.2, 0.21, 0], [0.05, 0.42, 0.05, 0.2, 0.21, 0]]), R.mat(0x4a5d6e), seatsL.length);
        seatsL.forEach((c, i) => place(lc, i, c[0], 0, c[1], c[2]));
        [-7.0, -1.8].forEach(x => { R.box(setG, 0.8, 2.0, 0.06, 0x2d6aa8, x, 1.0, -5.6); });
        setupBox = [-7.1, 0, -7, -1.7, 3.45, -1.5]; setupLabel = 'Launch wall'; setupFocus = aim([-4.4, 2.15, -6.9], 0, 12, fitD(5.2, 2.7));
        stands.push([-4.4, -5.6, 0], [-6.6, -4.4, 0.6], [-2.2, -4.4, -0.6]);
      } else if (theme === 'data') {
        const bx = [];
        [-5.4, -3.2].forEach(z => [-6.1, -4.5, -2.9].forEach(x => { R.box(setG, 1.5, 2.2, 0.06, 0x6a737c, x, 1.1, z - 0.22);
          [0.1, 0.62, 1.14, 1.66].forEach(y => { R.box(setG, 1.5, 0.03, 0.5, 0x8a939c, x, y, z); for (let i = 0; i < 3; i++) bx.push([x - 0.48 + i * 0.48, y + 0.2, z, 0]); });
          [-0.74, 0.74].forEach(dx => R.box(setG, 0.04, 2.2, 0.5, 0x5a636c, x + dx, 1.1, z)); }));
        [[-5.6, -1.0], [-3.6, -1.2], [-4.6, 0.6]].forEach(([x, z], k) => { for (let i = 0; i < 4 + k; i++) bx.push([x + (i % 2) * 0.46, 0.18 + Math.floor(i / 2) * 0.36, z, (i * 0.13) % 0.3]); });
        const rb = FR.rng(13), boxesM = inst(setG, new THREE.BoxGeometry(0.44, 0.34, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), bx.length, true);
        bx.forEach((q, i) => { place(boxesM, i, q[0], q[1], q[2], q[3]); boxesM.setColorAt(i, _col.set(rb() < 0.7 ? 0xc9a878 : 0xe6e2d6)); }); boxesM.instanceColor.needsUpdate = true;
        R.box(setG, 0.06, 1.2, 0.06, 0x3a424a, -2.2, 0.6, 0.4); R.box(setG, 0.5, 0.06, 0.4, 0x3a424a, -2.2, 0.05, 0.55);
        const deal = p.tpl !== 'data';
        R.sign(setG, [deal ? 'DEAL ROOM' : 'DATA ROOM'], 1.8, 0.36, -4.5, 2.75, -5.1, 0, { bg: '#1b232c', fg: HX.info, w: 512, h: 104, size: 64, font: 'display', weight: '700' });
        setupBox = [-6.9, 0, -5.8, -1.8, 2.4, 1.1]; setupLabel = deal ? 'Deal room' : 'Data room'; setupFocus = aim([-4.5, 1.1, -3.6], -15, 30, 11);
        stands.push([-4.5, -4.2, PI], [-3.0, -2.2, PI], [-5.8, 0.0, 0.6]);
      } else {
        const cr = [[-5.8, 0.6, -4.8, 0.1], [-5.8, 1.8, -4.8, -0.05], [-4.2, 0.6, -4.9, 0], [-4.2, 0.6, -3.2, 0.2], [-5.8, 0.6, -3.1, -0.1], [-5.7, 1.8, -3.1, 0.05], [-3.0, 0.6, -1.4, 0.35], [-5.4, 0.6, -0.8, -0.2], [-4.1, 0.6, 0.6, 0.1]];
        const crM = inst(setG, boxes([[1.4, 1.2, 1.2, 0, 0, 0]]), R.mat(0xa07a4a), cr.length), bat = inst(setG, boxes([[1.44, 0.12, 0.08, 0, 0.5, 0.6], [1.44, 0.12, 0.08, 0, -0.5, 0.6], [0.1, 1.2, 0.08, -0.66, 0, 0.6], [0.1, 1.2, 0.08, 0.66, 0, 0.6], [1.44, 0.12, 0.08, 0, 0.5, -0.6], [1.44, 0.12, 0.08, 0, -0.5, -0.6]]), R.mat(0x6a4a2a), cr.length);
        cr.forEach((c, i) => { place(crM, i, c[0], c[1], c[2], c[3]); place(bat, i, c[0], c[1], c[2], c[3]); });
        R.sign(setG, ['HANDLE WITH CARE'], 1.1, 0.26, -4.2, 0.7, -4.28, 0, { bg: '#a07a4a', fg: '#1b1a17', w: 512, h: 120, size: 60, font: 'display', weight: '800', glow: false });
        R.box(setG, 0.6, 0.12, 1.4, 0xc8a03a, -2.2, 0.12, -3.6); R.box(setG, 0.1, 1.1, 0.1, 0x2a3036, -2.2, 0.65, -4.25);
        R.sign(setG, ['RECEIVING'], 1.8, 0.36, -4.4, 3.46, -HD + 0.02, 0, { bg: '#1b232c', fg: HX.warn, w: 512, h: 104, size: 64, font: 'display', weight: '700' });
        setupBox = [-6.6, 0, -5.5, -2.2, 2.5, 1.3]; setupLabel = 'Crates'; setupFocus = aim([-4.4, 1.0, -2.6], -20, 32, 11);
        stands.push([-4.4, -2.2, 0.4], [-2.6, -2.2, -0.8], [-3.2, 1.6, PI]);
      }
    }
    plant(g, 7.3, 6.2); plant(g, -7.3, 6.2);
    const sit = crowd(g, CH, 'sit', 61 + slot), stand = crowd(g, stands, 'stand', 62 + slot);
    const walk = walkers(g, [[1.8, 4.2, 6.8, 4.2, 0.16, 0], [-0.8, -4.4, -0.8, 4.6, 0.18, 1.7]], 6 + slot);
    const targets = [ev.target];
    if (p) {
      targets.push({ id: id + '.board', label: 'Progress', box: [2.6, 1.0, -7, 7.4, 3.5, -6.8], focus: aim([5.0, 2.25, -6.9], 0, 14, fitD(4.8, 2.5)) });
      targets.push({ id: id + '.setup', label: setupLabel, box: setupBox, focus: setupFocus });
      targets.push({ id: id + '.table', label: 'War room', box: [1.6, 0, 0.0, 6.4, 1.4, 2.8], focus: aim([4.0, 0.8, 1.4], 0, 45, 9) });
    } else {
      targets.push({ id: id + '.board', label: 'Available', box: [-3.55, 0, 2.1, 0.35, 2.3, 3.1], focus: aim([-1.6, 1.55, 2.8], 0, 24, fitD(3.8, 1.6)) });
      targets.push({ id: id + '.table', label: 'War room', box: [1.5, 0, -0.1, 6.5, 1.0, 2.9], focus: aim([4.0, 0.6, 1.4], 0, 45, 9) });
    }
    const sig = p ? p.uid + '|' + theme : 'empty';
    let pending = 0, nWalk = 0, sp = { walk: 0, sit: 0, stand: 0 };
    const f = { group: g, elevator: ev, targets, _psig: sig,
      hint: p ? 'Tap the progress board for this project.' : 'This floor is free. Tap the sign to greenlight a project into it.',
      view: { pos: [-1.4, 23.92, 13.28], look: [0, 0.8, 0], fov: 60, shift: -0.031, shiftX: -0.028 }, // front, a little left: the setup faces the camera
      light: { hemi: 0.68, sun: 0.55, bg: 0x090d12 },
      refresh(s) {
        s = s || S(); const q = s && s.projects && s.projects.active ? s.projects.active[slot] || null : null;
        const now = q ? q.uid + '|' + themeOf(q) : 'empty';
        if (now !== f._psig) { // the slot's project changed: rebuild the floor in place (after this frame)
          if (!pending) pending = setTimeout(() => { pending = 0; if (R.current === f && !(FR.elevator && FR.elevator.riding)) R.loadFloor(id, { keep: true }); }, 0); return;
        }
        const th = themeOf(q);
        paint(board, q ? { slot: slot + 1, p: 1, name: q.name, kind: KIND_LABEL[q.kind] || KIND_NAME[th] || String(q.kind || ''), col: KIND_COL[th] || HX.brandB, turns: q.turns || 1,
          left: q.turnsLeft != null ? q.turnsLeft : q.turns, done: FR.round(clamp(q.progress != null ? q.progress / Math.max(1, q.turns) : 1 - (q.turnsLeft || 0) / Math.max(1, q.turns), 0, 1), 3),
          risk: q.risk, cost: q.cost, pf: q.pfPerTurn || 0, payoff: payoffText(q), overrun: !!q.overrun } : { slot: slot + 1, p: 0 }, drawProgress);
        if (emptySign) paint(emptySign, { slot: slot + 1, free: s && s.projects ? Math.max(0, (s.projects.slots || 3) - (s.projects.active || []).length) : 3 }, (x, w, h, d) => {
          rect(x, 0, 0, w, h, '#1b232c'); rect(x, 0, 0, w, 14, HX.brandB);
          T(x, 'AVAILABLE', w / 2, 120, 118, HX.ink, 'center', 800, DISP, w - 80);
          T(x, 'Project floor ' + d.slot + ' · no project in this slot', w / 2, 226, 40, HX.ink2, 'center', 500, SANS, w - 80);
          T(x, 'Greenlight from the offer board on Research', w / 2, 300, 34, HX.ink3, 'center', 500, SANS, w - 80);
        });
        if (q && theme === 'launch' && extra && extra.cx) paint(extra, { name: q.name, left: q.turnsLeft != null ? q.turnsLeft : q.turns }, drawLaunch);
        const hc = s && s.staff ? s.staff.headcount : 0, n = q ? clamp(3 + Math.round(hc * 0.03), 3, 12) : 0;
        sp = split(n, CH.length, stands.length, walk.length); sit.set(sp.sit); stand.set(sp.stand); nWalk = sp.walk;
      },
      update(dt, t) { stepWalkers(walk, nWalk, t); if (tex) tex.offset.y = (tex.offset.y + dt * 0.45) % 1; rig(f, p ? 0.9 + 0.1 * act2 : 0.62, 0); },
      debug() { return { slot, project: p ? p.uid : null, theme, people: sp, targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  }
  ['proj1', 'proj2', 'proj3'].forEach(id => { R.floors[id] = { build: buildProject }; });

  // ======================= BOARDROOM (8): long table, valuation screen, rival wall, window wall over the city =======================
  const RIVAL_COL = { opal: '#c5cfd9', entropic: '#d9a47a', deepfield: '#6fa8dc', zeta: '#9a8fe0', player: '#4f93d9' };
  const STYLE = { racer: 'Cap-first racer', 'safety-first': 'Safety-first', giant: 'Platform giant', 'open-weights': 'Open weights' };
  function mark(x, id, cx, cy, r) { // plain geometric marks, one per lab
    x.fillStyle = RIVAL_COL[id] || HX.ink2; x.strokeStyle = x.fillStyle; x.lineWidth = r * 0.28;
    if (id === 'opal') { x.beginPath(); x.arc(cx, cy, r * 0.75, 0, 7); x.stroke(); }
    else if (id === 'entropic') { for (let i = 0; i < 3; i++) { x.save(); x.translate(cx, cy); x.rotate(i * PI / 3); x.fillRect(-r * 0.9, -r * 0.12, r * 1.8, r * 0.24); x.restore(); } }
    else if (id === 'deepfield') { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.fillRect(cx - r * 0.8 + i * r * 0.9, cy - r * 0.8 + j * r * 0.9, r * 0.7, r * 0.7); }
    else if (id === 'zeta') { x.beginPath(); x.moveTo(cx - r * 0.8, cy - r * 0.7); x.lineTo(cx + r * 0.8, cy - r * 0.7); x.lineTo(cx - r * 0.8, cy + r * 0.7); x.lineTo(cx + r * 0.8, cy + r * 0.7); x.stroke(); }
    else { x.beginPath(); x.moveTo(cx, cy - r * 0.85); x.lineTo(cx + r * 0.85, cy + r * 0.7); x.lineTo(cx - r * 0.85, cy + r * 0.7); x.closePath(); x.fill(); }
  }
  function drawRivals(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'THE FRONTIER', 28, 42, 40, HX.ink, 'left', 700, DISP); T(x, 'average capability', w - 28, 42, 24, HX.ink3, 'right', 500);
    rect(x, 28, 74, w - 56, 2, HX.raised);
    d.rows.forEach((r, i) => {
      const y = 122 + i * 76, you = r[0] === 'player';
      if (you) rect(x, 16, y - 34, w - 32, 68, 'rgba(79,147,217,.12)');
      mark(x, r[0], 58, y, 24); T(x, r[1], 102, y - 10, 30, you ? HX.brandT : HX.ink, 'left', 600, SANS, 300); T(x, r[2], 102, y + 20, 18, HX.ink3, 'left', 500, SANS, 300);
      bar(x, 420, y - 9, w - 560, 18, r[3] / 100, you ? HX.brandB : 'rgba(197,207,217,.5)'); T(x, cap1(r[3]), w - 28, y, 36, you ? HX.ink : HX.ink2, 'right', 500, MONO);
    });
  }
  function drawValuation(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'VALUATION', 30, 40, 26, HX.ink3, 'left', 600); T(x, money(d.val), 30, 104, 88, HX.gold, 'left', 500, MONO, w - 60);
    rect(x, 30, 150, w - 60, 2, HX.raised);
    const cell = (i, a, b, c) => { const px = 30 + i * ((w - 60) / 3); T(x, a, px, 184, 20, HX.ink3, 'left', 600); T(x, b, px, 222, 34, c || HX.ink, 'left', 500, MONO, (w - 60) / 3 - 16); };
    cell(0, 'CASH', money(d.cash), HX.gold); cell(1, 'NET / WEEK', (d.net >= 0 ? '+' : '') + money(d.net), d.net >= 0 ? HX.good : HX.ink);
    cell(2, 'RUNWAY', d.runway == null ? 'Cash positive' : d.runway + ' wks', d.runway != null && d.runway < 13 ? HX.warn : HX.ink);
    T(x, 'Founder stake ' + d.stake + '%', 30, 282, 24, HX.ink2, 'left', 500, SANS, w - 60);
    if (d.offer) { rect(x, 0, h - 116, w, 116, 'rgba(230,193,90,.12)'); T(x, d.offer, 30, h - 82, 26, HX.gold, 'left', 600, SANS, w - 60); T(x, d.offer2, 30, h - 42, 22, HX.ink2, 'left', 500, SANS, w - 60); }
    else if (d.ms) { rect(x, 0, h - 90, w, 90, HX.surface); T(x, d.ms, 30, h - 45, 22, HX.ink2, 'left', 500, SANS, w - 60); }
  }
  function drawCompute(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'COMPUTE', 28, 42, 40, HX.ink, 'left', 700, DISP); T(x, fmtPF(d.total), w - 28, 44, 44, HX.brandT, 'right', 500, MONO);
    const parts = [['Owned', d.owned, HX.brandB], ['Rented', d.rented, HX.info], ['Rival deals', d.deals, HX.warn]]; let px = 28; const bw = w - 56;
    parts.forEach(pt => { const ww = d.total > 0 ? bw * pt[1] / d.total : 0; if (ww > 0) rect(x, px, 86, ww, 26, pt[2]); px += ww; }); if (!(d.total > 0)) rect(x, 28, 86, bw, 26, HX.raised);
    parts.forEach((pt, i) => { const y = 160 + i * 52; rect(x, 28, y - 10, 20, 20, pt[2]); T(x, pt[0], 60, y, 26, HX.ink2, 'left', 500); T(x, fmtPF(pt[1]), w - 28, y, 30, HX.ink, 'right', 500, MONO); });
    T(x, d.clusters + (d.clusters === 1 ? ' cluster owned' : ' clusters owned') + (d.installing ? ' · ' + d.installing + ' installing' : ''), 28, 330, 24, HX.ink3, 'left', 500, SANS, w - 56);
    T(x, 'Weekly compute bill ' + money(d.bill), 28, 376, 24, HX.ink3, 'left', 500, SANS, w - 56);
  }
  function drawTeam(x, w, h, d) {
    rect(x, 0, 0, w, h, HX.sunken);
    T(x, 'HEADCOUNT', 28, 42, 40, HX.ink, 'left', 700, DISP); T(x, String(d.hc), w - 28, 46, 56, HX.ink, 'right', 500, MONO);
    d.rows.forEach((r, i) => { const y = 112 + i * 56; T(x, r[0], 28, y, 26, HX.ink2, 'left', 500, SANS, 170); bar(x, 210, y - 10, w - 380, 20, r[1] / 100, HX.brandB); T(x, r[2] + ' · ' + r[1] + '%', w - 28, y, 24, HX.ink, 'right', 500, MONO); });
    T(x, d.hiring ? '+' + d.hiring + ' hired, joining ' + wk(d.next) : 'No hires in the pipeline', 28, 356, 24, d.hiring ? HX.good : HX.ink3, 'left', 500, SANS, w - 56);
    T(x, 'Payroll ' + money(d.payroll) + ' a week', 28, 396, 24, HX.ink3, 'left', 500, SANS, w - 56);
  }
  R.floors.boardroom = { build(id) {
    const g = start(), scr = [];
    hideFront(g);
    const EX = -5.6, ev = R.elevatorBank(g, EX, -HD, H); deptSign(g, id, EX);
    // window wall set back from the room edge (the cutaway keeps it), the city far below
    const GZ = 6.4; R.plane(g, W, 3.9, GLASS, 0, 1.95, GZ, null, { transparent: true, opacity: 0.1, depthWrite: false });
    [-7.9, -4, 0, 4, 7.9].forEach(x => R.box(g, 0.1, 3.9, 0.1, GRAPH, x, 1.95, GZ)); R.box(g, W, 0.35, 0.36, GRAPH, 0, 0.17, GZ); R.box(g, W, 0.2, 0.3, GRAPH, 0, 3.9, GZ);
    city(g, 'boardroom');
    // valuation screen at the head of the table, rival wall beside it
    frame(g, 3.6, 2.0, 0.2, 2.3, -HD + 0.05);
    const val = csign(g, 3.6, 2.0, 768, 426, 0.2, 2.3, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    frame(g, 4.4, 2.2, 5.1, 2.2, -HD + 0.05);
    const riv = csign(g, 4.4, 2.2, 1024, 512, 5.1, 2.2, -HD + 0.11, 0, { bg: HX.sunken }, scr);
    // compute (left wall), team (right wall), credenzas
    frame(g, 3.2, 1.8, -7.95, 2.2, -1.0, PI / 2); const cmp = csign(g, 3.2, 1.8, 768, 432, -7.88, 2.2, -1.0, PI / 2, { bg: HX.sunken }, scr);
    frame(g, 3.2, 1.8, 7.95, 2.2, -1.0, -PI / 2); const team = csign(g, 3.2, 1.8, 768, 432, 7.88, 2.2, -1.0, -PI / 2, { bg: HX.sunken }, scr);
    R.box(g, 0.5, 0.75, 3.4, GRAPH_L, -7.6, 0.375, -1.0); R.box(g, 0.5, 0.75, 3.4, GRAPH_L, 7.6, 0.375, -1.0);
    // the table: stone top on two pedestals, twelve chairs, laptops and glasses
    R.plane(g, 4.6, 9.4, 0x2f3640, 0.2, 0.01, -1.6, -PI / 2);
    R.box(g, 1.8, 0.07, 6.2, 0xcfc6b6, 0.2, 0.76, -1.6); [-3.2, 0.0].forEach(z => R.box(g, 0.9, 0.72, 1.2, GRAPH, 0.2, 0.36, z));
    const CH = [[0.2, 2.35, PI], [0.2, -5.45, 0]]; [-4.1, -2.9, -1.7, -0.5, 0.7].forEach(z => { CH.push([-1.0, z, PI / 2]); CH.push([1.4, z, -PI / 2]); });
    const chairs = inst(g, boxes([[0.54, 0.08, 0.52, 0, 0.47, 0], [0.52, 0.62, 0.08, 0, 0.86, -0.27], [0.07, 0.42, 0.07, 0, 0.22, 0], [0.5, 0.04, 0.5, 0, 0.02, 0]]), R.mat(0x1f262e), CH.length);
    CH.forEach((c, i) => place(chairs, i, c[0], 0, c[1], c[2]));
    const laps = inst(g, boxes([[0.34, 0.02, 0.24, 0, 0.81, 0.02], [0.34, 0.22, 0.02, 0, 0.92, 0.12, 0, 0.25]]), R.mat(0x9aa4ae), CH.length);
    CH.forEach((c, i) => place(laps, i, c[0] + Math.sin(c[2]) * 0.55, 0, c[1] + Math.cos(c[2]) * 0.55, c[2]));
    // pendants over the table (cables above the cutaway line vanish with the ceiling)
    [-3.6, -1.6, 0.4].forEach(z => { R.box(g, 0.02, 0.9, 0.02, GRAPH, 0.2, 3.45, z); R.cyl(g, 0.26, 0.34, 0.22, 0xffe2b8, 0.2, 2.95, z, 16).material = R.mat(0xffe2b8, { emissive: 0xffc890, emissiveIntensity: 0.9 }); });
    plant(g, -7.2, 5.6); plant(g, 7.2, 5.6); plant(g, -2.9, -6.4, 0.9);
    R.box(g, 1.2, 0.9, 0.5, WOOD, 5.8, 0.45, 5.6); R.cyl(g, 0.05, 0.05, 0.28, 0xd8e0e8, 5.6, 1.04, 5.6, 8); R.cyl(g, 0.05, 0.05, 0.22, 0xd8e0e8, 5.9, 1.01, 5.5, 8);
    panels(g, [[-5, -4], [5, -4], [-5, 2], [5, 2]], 0.5);
    const board = crowd(g, CH, 'sit', 81);
    const aide = walkers(g, [[-3.6, 4.6, 3.6, 4.6, 0.1, 0.5]], 7);
    const targets = [
      ev.target,
      { id: 'boardroom.table', label: 'Board table', labelAt: [0.2, 1.1, 1.2], box: [-1.45, 0, -7, 1.85, 3.3, 2.75], focus: aim([0.2, 2.0, -5.2], 0, 22, 10) },
      { id: 'boardroom.rivals', label: 'Rivals', box: [2.8, 1.0, -7, 7.4, 3.4, -6.8], focus: aim([5.1, 2.2, -6.9], 0, 14, fitD(4.6, 2.4)) },
      { id: 'boardroom.compute', label: 'Compute', box: [-7.95, 1.2, -2.7, -7.8, 3.2, 0.7], focus: aim([-7.9, 2.2, -1.0], 90, 18, fitD(3.4, 2.0)) },
      { id: 'boardroom.team', label: 'Team', box: [7.8, 1.2, -2.7, 7.95, 3.2, 0.7], focus: aim([7.9, 2.2, -1.0], -90, 18, fitD(3.4, 2.0)) }
    ];
    let nBoard = 0;
    const f = { group: g, elevator: ev, targets, hint: 'Tap the board table for money and rounds.',
      view: { pos: [-2.41, 24.79, 13.64], look: [0, 0.8, 0], fov: 60, shift: -0.034, shiftX: -0.015 }, // from above the window wall, the skyline behind
      light: { hemi: 0.6, sun: 0.55, bg: 0x08101c },
      refresh(s) {
        s = s || S(); const m = (s && s.money) || { cash: 0, founderPct: 100, valuation: 0, roundsDone: [], revenue: 0, burn: 0, net: 0 };
        const burn = tryf(() => FR.money.burnEstimate(s), m.burn || 0), net = (m.revenue || 0) - burn, runway = net >= 0 ? null : Math.max(0, Math.floor(m.cash / -net));
        const o = m.offer, ms = m.milestone;
        paint(val, { val: Math.round(m.valuation || tryf(() => FR.money.valuation(s), 0)), cash: Math.round(m.cash), net: Math.round(net), runway, stake: FR.round(m.founderPct, 1),
          offer: o ? (o.round === 'a' ? 'Series A' : o.round === 'seed' ? 'Seed round' : String(o.round)) + ' on the table: ' + money(o.amount) + ' for ' + FR.round(o.pct * (o.pct <= 1 ? 100 : 1), 1) + '%' : null,
          offer2: o ? 'Post-money ' + money(o.valuation) + (o.expires ? ' · open until ' + FR.dateLabel(o.expires) : '') : null,
          ms: !o && ms ? 'Next round: ' + (ms.text || '') : null }, drawValuation);
        const rows = [['player', labName(s), 'Your lab', FR.round(s && s.model ? FR.sim.avgCap(s) : 0, 1)]]
          .concat(((s && s.market && s.market.rivals) || []).map(r => [r.id, r.name, STYLE[r.style] || String(r.style || ''), FR.round(avg3(r.cap), 1)]));
        rows.sort((a, b) => b[3] - a[3]); paint(riv, { rows: rows.slice(0, 5) }, drawRivals);
        const cap = capacityOf(s), c = s && s.compute;
        paint(cmp, { total: FR.round(cap.total || 0, 1), owned: FR.round(cap.owned || 0, 1), rented: FR.round(cap.rented || 0, 1), deals: FR.round(cap.deals || 0, 1),
          clusters: c ? (c.clusters || []).length : 0, installing: c ? (c.installing || []).length : 0, bill: tryf(() => FR.compute.cost(s), 0) }, drawCompute);
        const hc = s && s.staff ? s.staff.headcount : 0, hire = s && s.staff ? s.staff.hiring || [] : [];
        paint(team, { hc, rows: FR.ALLOCS.map(k => [FR.ALLOC_NAME[k], s && s.sliders ? s.sliders[k] : 0, Math.round(hc * (s && s.sliders ? s.sliders[k] : 0) / 100)]),
          hiring: hire.reduce((t, x) => t + (x.n || 0), 0), next: hire.length ? Math.min.apply(null, hire.map(x => x.arrives)) : 0, payroll: tryf(() => FR.money.payroll(s), 0) }, drawTeam);
        nBoard = clamp(3 + 2 * ((m.roundsDone || []).length), 3, CH.length); board.set(nBoard);
      },
      update(dt, t) { stepWalkers(aide, 1, t); rig(f, 1, 0); },
      debug() { return { board: nBoard, targets: targets.map(t => t.id) }; }
    };
    return finish(f, id, scr);
  } };

  R.floorsDebug = () => ({ floors: Object.keys(R.floors), K });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

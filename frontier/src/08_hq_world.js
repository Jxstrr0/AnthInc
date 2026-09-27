// HQ world (ported from Mogul render/world.js + render/props.js + render/look.js, merged). Reader: reads FR.state, listens
// on the bus, changes the game only through FR.cmd.*.
// three.js world: scene, diorama camera rig (room view fitted to the screen + focus poses, eased glides), tap targets
// (ray + padded screen rect), press flash, floating tags, wall/ceiling cutaway by layers, floor loader. One floor in memory.
// A floor build(id) returns { group, elevator, light, update?(dt,t), refresh?(state), debug?, view:{pos,look,fov,shift?},
//   targets:[Target], hint?, room?, autoRefresh?, lookWindow?, lookSpill? }.
// Target = { id, label, box:[x0,y0,z0,x1,y1,z1], focus:{pos,look,fov,shift?,rest?}|null, pri?, labelAt?, labelNudge?,
//   stay?, onlyIn?, hint? }. stay: closing the sheet keeps the camera on this focus (Back returns); onlyIn:
//   [ids] = live (pickable) only while focused on one of those targets, and no tag in the room view; hint: one-time line
//   shown the first time the camera rests on this focus with nothing open.
// Tapping a target glides the camera to its focus pose, then emits 'hq:hotspot' {hotspotId}. Floors name their target ids
// '<floorId>.<thing>' (training.board); the elevator doors are 'elevator'. The HUD routes hq:hotspot to FR.ui.panel(id).
(function (FR) {
  // ---------- floors (bottom → top) ----------
  FR.HQ_FLOORS = ['lobby', 'serving', 'training', 'safety', 'research', 'proj1', 'proj2', 'proj3', 'boardroom'];
  // n: the elevator LED / button label; alloc: the slider this floor shows; slot: the project slot index (0..2)
  FR.HQ_FLOOR_META = {
    lobby:     { n: 'G', name: 'Lobby / Press' },
    serving:   { n: '1', name: 'Serving', alloc: 'serving' },
    training:  { n: '2', name: 'Training', alloc: 'training' },
    safety:    { n: '3', name: 'Safety', alloc: 'safety' },
    research:  { n: '4', name: 'Research', alloc: 'research' },
    proj1:     { n: '5', name: 'Project floor 1', slot: 0 },
    proj2:     { n: '6', name: 'Project floor 2', slot: 1 },
    proj3:     { n: '7', name: 'Project floor 3', slot: 2 },
    boardroom: { n: '8', name: 'Boardroom' }
  };

  // three.js missing (the CDN script failed): a do-nothing FR.r so the rest of the one-script build (menu, sim, main) still
  // runs; floors register into it harmlessly and nothing renders. The look and title modules skip themselves.
  if (typeof THREE === 'undefined') {
    console.error('three.js did not load: the HQ view is off');
    const no = () => false;
    FR.r = { floors: {}, stub: true, current: null, mode: 'room', focusId: null, paused: true, cinematic: null, t: 0, LED: {},
      init() {}, loadFloor(id) { FR.emit('hq:floor', { floorId: id }); }, home() {}, back() { if (FR.ui && FR.ui.sheetId) FR.ui.sheet(null); },
      focus: no, tapAt: no, glideTo: no, snap() {}, setMode() {}, target: () => null, poseOf: () => null, screenOf: () => null, pick: () => null,
      live: no, targets: () => [], relabel() {}, setText() {}, staffOn: () => 0, disposeGroup() {}, debug: () => ({ stub: true }) };
    return;
  }
  const R = FR.r = { floors: {}, current: null, t: 0, mode: 'room', focusId: null, view: null, paused: true, cinematic: null, settled: null, dirty: false };
  R.FOCUS_MS = 600; R.HOME_MS = 550; R.FOCUS_SHIFT = 0.31; R.MIN_HIT = 48; R.DESIGN_ASPECT = 390 / 844;
  R.PR_CAP = 1.5; // pixel-ratio cap (the look module adapts below it)
  R.SAFE_TOP = 84; R.SAFE_BOTTOM = 76; // HUD-safe band (CSS px) a fitted room view fills: below the top chips + frontier strip, above the dock
  R.TAG_ROOM = 26; R.FIT_ASPECT = 0.6; // headroom for the tag above the top target; fitView only for screens wider than this
  // HUD boxes the floating tags keep clear of (UI-A's shell: top chips, the frontier strip, the dock buttons)
  R.HUD_SEL = '#hud .top .chip, #hud .strip, #hud .bottom .btn, #hud .bottom button, #hud [data-hud-solid]';
  R.FONT = '"IBM Plex Sans",system-ui,sans-serif'; R.FONT_MONO = '"IBM Plex Mono",ui-monospace,monospace'; R.FONT_DISPLAY = 'Archivo,"IBM Plex Sans",system-ui,sans-serif';
  const matCache = {}, cachedMats = new Set();
  R.mat = function (color, opts) {
    const k = color + '|' + (opts ? JSON.stringify(opts) : '');
    if (!matCache[k]) { matCache[k] = new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {})); cachedMats.add(matCache[k]); }
    return matCache[k];
  };
  R.box = function (g, w, h, d, color, x, y, z, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), R.mat(color, opts)); m.position.set(x, y, z); g.add(m); return m;
  };
  R.cyl = function (g, rt, rb, h, color, x, y, z, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), R.mat(color)); m.position.set(x, y, z); g.add(m); return m;
  };
  R.plane = function (g, w, h, color, x, y, z, rx, opts) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), R.mat(color, opts)); m.position.set(x, y, z); if (rx != null) m.rotation.x = rx; g.add(m); return m;
  };
  // ---------- canvas text (signs, screens) ----------
  // opts: w, h (canvas px), bg, fg, size, weight, font ('mono' | 'display' | a CSS family), align ('center' | 'left'), pad
  function fontOf(o) { return o.font === 'mono' ? R.FONT_MONO : o.font === 'display' ? R.FONT_DISPLAY : (o.font || R.FONT); }
  function drawText(c, lines, opts) {
    opts = opts || {}; const x = c.getContext('2d'); x.fillStyle = opts.bg || '#0f141a'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = opts.fg || '#eef2f6'; const left = opts.align === 'left', pad = opts.pad != null ? opts.pad : c.width * 0.05;
    x.textAlign = left ? 'left' : 'center'; x.textBaseline = 'middle';
    const ls = Array.isArray(lines) ? lines : [lines], fam = fontOf(opts), font = s => (opts.weight || '600') + ' ' + s + 'px ' + fam;
    // fit: the widest line shrinks the font (down to half size) so no line is cut at the canvas edges (#57)
    let fs = opts.size || 48; x.font = font(fs);
    let wide = 1; for (let i = 0; i < ls.length; i++) wide = Math.max(wide, x.measureText(String(ls[i])).width);
    const room = left ? c.width - 2 * pad : c.width * 0.92;
    if (wide > room) { fs = Math.max(Math.floor(fs / 2), Math.floor(fs * room / wide)); x.font = font(fs); }
    ls.forEach((l, i) => x.fillText(String(l), left ? pad : c.width / 2, c.height / 2 + (i - (ls.length - 1) / 2) * fs * 1.25));
  }
  R.textTex = function (lines, opts) {
    opts = opts || {}; const c = document.createElement('canvas'); c.width = opts.w || 512; c.height = opts.h || 256;
    drawText(c, lines, opts);
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
  };
  // redraw a sign or screen in place: same canvas and texture when the size matches (no new GPU texture object)
  R.setText = function (mesh, lines, opts) {
    if (!mesh || !mesh.material) return; opts = opts || {}; const m = mesh.material, t = m.map, c = t && t.image;
    if (c && c.getContext && c.width === (opts.w || c.width) && c.height === (opts.h || c.height)) { drawText(c, lines, opts); t.needsUpdate = true; return; }
    if (t && !(t.userData && t.userData.keep)) t.dispose(); m.map = R.textTex(lines, opts); m.needsUpdate = true;
  };
  R.wrap = function (text, n) { const out = []; let line = ''; String(text || '').split(' ').forEach(w => { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; }); if (line.trim()) out.push(line.trim()); return out; };
  R.sign = function (g, lines, w, h, x, y, z, ry, opts) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: R.textTex(lines, opts) }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; g.add(m); return m;
  };
  // generic room shell centred on the origin: floor, ceiling, 4 walls. Returns legacy bounds plus w, d, h (the cutaway reads them).
  R.room = function (g, w, d, h, colors) {
    colors = colors || {}; const fl = colors.floor || 0x3a4148, wl = colors.wall || 0x5a646e, ce = colors.ceil || 0x2a3036;
    R.plane(g, w, d, fl, 0, 0, 0, -Math.PI / 2); R.plane(g, w, d, ce, 0, h, 0, Math.PI / 2);
    R.box(g, w, h, 0.2, wl, 0, h / 2, -d / 2 - 0.1); R.box(g, w, h, 0.2, wl, 0, h / 2, d / 2 + 0.1);
    R.box(g, 0.2, h, d, wl, -w / 2 - 0.1, h / 2, 0); R.box(g, 0.2, h, d, wl, w / 2 + 0.1, h / 2, 0);
    R._room = { w, d, h };
    return { minX: -w / 2 + 0.4, maxX: w / 2 - 0.4, minZ: -d / 2 + 0.4, maxZ: d / 2 - 0.4, w, d, h };
  };
  // elevator bank prop used by every floor (doors in the z wall, centred on x). target is the tap target for the doors.
  // Brushed steel doors in a graphite surround; the LED over the doors shows the floor number (elevator.js redraws it).
  R.LED = { bg: '#0a0e13', fg: '#8ec0f2', w: 256, h: 128, size: 84, font: 'mono', weight: '500' };
  R.elevatorBank = function (g, x, z, h) {
    const frame = 0x59626b;
    R.box(g, 3.2, h, 0.62, 0x252c34, x, h / 2, z - 0.3); // front face 1 cm proud of the wall: no z-fighting when seen head-on
    R.box(g, 0.15, 2.4, 0.1, frame, x - 1.05, 1.2, z + 0.05); R.box(g, 0.15, 2.4, 0.1, frame, x + 1.05, 1.2, z + 0.05);
    R.box(g, 2.25, 0.15, 0.1, frame, x, 2.45, z + 0.05);
    const dl = R.box(g, 1.0, 2.3, 0.08, 0xa7b0b8, x - 0.5, 1.15, z + 0.02);
    const dr = R.box(g, 1.0, 2.3, 0.08, 0xa7b0b8, x + 0.5, 1.15, z + 0.02);
    // call button + LED
    R.box(g, 0.12, 0.12, 0.05, 0x8ec0f2, x + 1.35, 1.2, z + 0.06, { emissive: 0x4f93d9, emissiveIntensity: 0.8 });
    const led = R.sign(g, ['G'], 0.6, 0.3, x, 2.75, z + 0.08, 0, R.LED);
    return { doors: [dl, dr], led, x, collider: { x, z: z - 0.3, w: 3.2, d: 0.6 },
      target: { id: 'elevator', label: 'Elevator', box: [x - 1.6, 0, z - 0.05, x + 1.6, 3.0, z + 0.15], focus: { pos: [x, 2.2, z + 14], look: [x, 1.2, z], fov: 60 } } }; // far enough that doors + LED fit above the tall floor list
  };
  // one standing figure (5 meshes). For more than a handful use R.crowd (instanced).
  R.SKIN = [0xd9b48f, 0xc49a74, 0x8d5f43, 0xe6c7a8, 0x6b4630]; R.PANTS = 0x2a3038;
  R.person = function (g, color, x, z, ry, skin) {
    const p = new THREE.Group();
    R.box(p, 0.42, 0.7, 0.26, color, 0, 0.85, 0); R.cyl(p, 0.16, 0.16, 0.16, skin || R.SKIN[0], 0, 1.36, 0, 10);
    R.box(p, 0.14, 0.5, 0.18, R.PANTS, -0.1, 0.25, 0); R.box(p, 0.14, 0.5, 0.18, R.PANTS, 0.1, 0.25, 0);
    p.position.set(x, 0, z); p.rotation.y = ry || 0; g.add(p); return p;
  };
  // InstancedMesh of one geometry/colour (build-time only): pts = [[x,y,z,rx,ry,rz,sx,sy,sz], ...]; cols = per-instance colours
  R.inst = function (parent, geo, color, pts, cols) {
    const m = new THREE.InstancedMesh(geo, cols ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : R.mat(color), Math.max(1, pts.length)); const o = new THREE.Object3D();
    pts.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.rotation.set(p[3] || 0, p[4] || 0, p[5] || 0); o.scale.set(p[6] || 1, p[7] || 1, p[8] || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    if (cols) { const c = new THREE.Color(); cols.forEach((v, i) => m.setColorAt(i, c.set(v))); }
    m.count = pts.length; parent.add(m); return m;
  };
  // world AABB of objects (tap target boxes): [x0,y0,z0,x1,y1,z1], padded; opaque meshes only (look halos and glows are transparent)
  const _ab = new THREE.Box3(), _am = new THREE.Box3();
  R.aabb = function (objs, pad) {
    _ab.makeEmpty(); (Array.isArray(objs) ? objs : [objs]).forEach(o => { o.updateMatrixWorld(true); o.traverse(m => { if (m.isMesh && !m.isInstancedMesh && m.visible !== false && !(m.material && m.material.transparent)) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); _ab.union(_am.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); } }); });
    const p = pad || 0.05; return [_ab.min.x - p, 0, _ab.min.z - p, _ab.max.x + p, _ab.max.y + p, _ab.max.z + p].map(v => +v.toFixed(2));
  };
  // Staff on a floor's allocation: headcount × slider / 100 (FR.state read only). 0 without a game.
  R.staffOn = function (alloc) { const s = FR.state; if (!s || !s.staff || !s.sliders || s.sliders[alloc] == null) return 0; return Math.round(s.staff.headcount * s.sliders[alloc] / 100); };
  // Instanced crowd: up to spots.length cheap figures in 4 draw calls (body, head, legs, blob shadow), whatever the headcount.
  // spots = [[x, z, ry], ...] (floor positions, facing ry); opts = { pose: 'stand'|'sit', colors: [hex...], seed }.
  // Returns { max, count, set(n) } — set(n) shows the first n spots (no allocation; call it from refresh()). Figures are
  // static: animate a few R.person props for life, not the crowd.
  R.crowd = function (g, spots, opts) {
    opts = opts || {}; const n = Math.max(1, spots.length), sit = opts.pose === 'sit', rnd = FR.rng(opts.seed || 7);
    const cols = opts.colors || [0x3d5a80, 0x5b6b7a, 0x2f4858, 0x7a8b99, 0x4a5d6e, 0x8c7a6b, 0x39424e];
    const parts = sit
      ? [[0.42, 0.56, 0.24, 0, 0.84, 0, true], [0.2, 0.22, 0.2, 0, 1.25, 0, 'skin'], [0.34, 0.14, 0.44, 0, 0.5, 0.18, false], [0.32, 0.46, 0.14, 0, 0.25, 0.4, false]]
      : [[0.42, 0.7, 0.26, 0, 0.85, 0, true], [0.2, 0.22, 0.2, 0, 1.33, 0, 'skin'], [0.34, 0.5, 0.18, 0, 0.25, 0, false]];
    const o = new THREE.Object3D(), q = new THREE.Object3D(), c = new THREE.Color(); o.add(q);
    const ims = parts.map(p => {
      const tint = p[6] !== false, m = new THREE.InstancedMesh(new THREE.BoxGeometry(p[0], p[1], p[2]), tint ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : R.mat(R.PANTS), n);
      // r128: sized for n now, or setColorAt sizes instanceColor from count
      if (tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      for (let i = 0; i < n; i++) {
        const s = spots[i] || spots[0]; o.position.set(s[0], 0, s[1]); o.rotation.set(0, s[2] || 0, 0); q.position.set(p[3], p[4], p[5]); o.updateMatrixWorld(true);
        m.setMatrixAt(i, q.matrixWorld); if (tint) m.setColorAt(i, c.set(p[6] === 'skin' ? R.SKIN[Math.floor(rnd() * R.SKIN.length)] : cols[Math.floor(rnd() * cols.length)]));
      }
      m.count = spots.length; g.add(m); return m;
    });
    const blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshBasicMaterial({ map: FR.look && FR.look.blobTex ? FR.look.blobTex() : null, color: FR.look && FR.look.blobTex ? 0xffffff : 0x000000, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false }), n);
    for (let i = 0; i < n; i++) { const s = spots[i] || spots[0]; o.position.set(s[0], 0.035, s[1]); o.rotation.set(-Math.PI / 2, 0, 0); q.position.set(0, 0, 0); o.updateMatrixWorld(true); blob.setMatrixAt(i, q.matrixWorld); }
    blob.count = spots.length; blob.userData.look = 1; g.add(blob); ims.push(blob);
    return { max: spots.length, meshes: ims, get count() { return ims[0].count; },
      set(k) { k = Math.max(0, Math.min(spots.length, Math.round(k || 0))); for (let i = 0; i < ims.length; i++) ims[i].count = k; } };
  };

  // ---------- camera rig ----------
  const DEFAULT_VIEW = { pos: [0, 19, 19], look: [0, 0.5, -3.5], fov: 75 };
  const rig = { pos: null, look: null, fov: 70, shift: 0, sx: 0 }; // live pose (Vector3s after init); sx = horizontal lens shift
  let glide = null;            // { from, to, t0, ms, done }
  let covered = false;         // in focus, something covered the scene (sheet) since the focus began
  let targets = [], byId = {};
  let hudEl = null, tagsEl = null, tagEls = {}, ui = { tags: null, back: null, focus: null }, hintFloor = null;
  let flash = null, flashT0 = -1, fitCam = null, rippleEl = null;
  const V = () => new THREE.Vector3();
  const _v = V(), _c = V(), _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _box = new THREE.Box3(), _hit = V(), _dir = V();
  function arr(v) { return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  // pose objects use arrays; shift (vertical lens shift, fraction of the screen height) defaults to 0 (room views) unless
  // given; shiftX (horizontal, fraction of the width) is 0 except in a fitted room view
  function norm(p, defShift) {
    if (!p || !p.pos || !p.look) return null;
    return { pos: p.pos.slice(0, 3), look: p.look.slice(0, 3), fov: num(p.fov, 60), shift: num(p.shift, defShift || 0), shiftX: num(p.shiftX, 0) };
  }
  function setRig(p) { rig.pos.set(p.pos[0], p.pos[1], p.pos[2]); rig.look.set(p.look[0], p.look[1], p.look[2]); rig.fov = p.fov; rig.shift = p.shift; rig.sx = p.shiftX || 0; }
  function rigPose() { return { pos: rig.pos.toArray(), look: rig.look.toArray(), fov: rig.fov, shift: rig.shift, shiftX: rig.sx }; }
  function near(p) { return rig.pos.distanceTo(_v.set(p.pos[0], p.pos[1], p.pos[2])) < 1e-3 && rig.look.distanceTo(_c.set(p.look[0], p.look[1], p.look[2])) < 1e-3 && Math.abs(rig.fov - p.fov) < 1e-3 && Math.abs(rig.shift - p.shift) < 1e-4 && Math.abs(rig.sx - (p.shiftX || 0)) < 1e-4; }
  const ease = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  function W() { return window.innerWidth || 1; }
  function H() { return window.innerHeight || 1; }
  // narrower than the 390x844 design aspect: widen the vertical fov so the horizontal coverage never shrinks
  function effFov(fov) { const a = W() / H(); if (a >= R.DESIGN_ASPECT) return fov; return 2 * Math.atan(Math.tan(fov * Math.PI / 360) * R.DESIGN_ASPECT / a) * 180 / Math.PI; }
  // Room view for this screen. Floors frame their view for 390x844 portrait; a wider screen (landscape, desktop) would
  // keep that vertical fov and shrink the room to a small patch in the middle. There the room's content (every target
  // box and the top corners of the walls the cutaway keeps), clipped to what the portrait framing shows, is fitted into
  // the HUD-safe rect instead: the fov narrows until the content fills the rect, and a lens shift centres it. Bare floor
  // in front of the nearest target may crop. It never zooms out past the portrait framing.
  function fitView(p) {
    if (!p || W() / H() <= R.FIT_ASPECT) return p; // near-portrait phones (360x740) keep the hand-framed portrait view
    const rm = R.roomDims || { w: 16, d: 14, h: 4 }, w2 = rm.w / 2, d2 = rm.d / 2, cx = p.pos[0], cz = p.pos[2], pts = [];
    const wall = (x0, z0, x1, z1) => pts.push([x0, rm.h, z0], [x1, rm.h, z1]);
    if (!(cz > d2)) wall(-w2, d2, w2, d2);
    if (!(cz < -d2)) wall(-w2, -d2, w2, -d2);
    if (!(cx < -w2)) wall(-w2, -d2, -w2, d2);
    if (!(cx > w2)) wall(w2, -d2, w2, d2);
    targets.forEach(t => { if (!live(t, 'room')) return; const b = t.box; for (let i = 0; i < 8; i++) pts.push([i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]]); });
    if (!fitCam) fitCam = new THREE.PerspectiveCamera();
    fitCam.position.set(p.pos[0], p.pos[1], p.pos[2]); fitCam.lookAt(p.look[0], p.look[1], p.look[2]); fitCam.updateMatrixWorld(true);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    pts.forEach(q => {
      _v.set(q[0], q[1], q[2]).applyMatrix4(fitCam.matrixWorldInverse); if (_v.z > -0.1) return;
      const u = _v.x / -_v.z, v = _v.y / -_v.z; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    });
    const T = Math.tan(p.fov * Math.PI / 360), Tu = T * R.DESIGN_ASPECT; // the portrait framing's half-extents
    u0 = Math.max(u0, -Tu); u1 = Math.min(u1, Tu); v0 = Math.max(v0, -T); v1 = Math.min(v1, T);
    const top = R.SAFE_TOP + R.TAG_ROOM, sw = W() - 24, sh = H() - top - R.SAFE_BOTTOM; // tags sit above their target: keep them under the top chips
    if (!(u1 > u0 && v1 > v0) || sw <= 0 || sh <= 0) return p;
    // s = CSS px per unit of view-plane tangent; 85% of the portrait framing's s is the floor (a tight portrait framing may
    // zoom out a little so its top tag clears the chips)
    const s = Math.max(0.85 * H() / (2 * T), Math.min(sw / (u1 - u0), sh / (v1 - v0)));
    const ys = (top + H() - R.SAFE_BOTTOM) / 2;
    return { pos: p.pos, look: p.look, fov: 2 * Math.atan(H() / (2 * s)) * 180 / Math.PI,
      shift: (H() / 2 - (v0 + v1) / 2 * s - ys) / H(), shiftX: (u0 + u1) / 2 * s / W() };
  }
  // re-fit the room view after a resize; a camera resting in (or gliding to) the room view jumps to the new one
  function refit() {
    if (!R.base) return; R.view = fitView(R.base);
    if (R.mode === 'room' && R.view) { glide = null; setRig(R.view); settle(); }
  }
  function applyPose() {
    const cam = R.camera; if (!cam) return;
    cam.position.copy(rig.pos); cam.fov = effFov(rig.fov); cam.aspect = W() / H();
    cam.lookAt(rig.look);
    if (rig.shift || rig.sx) cam.setViewOffset(W(), H(), rig.sx * W(), rig.shift * H(), W(), H()); else if (cam.view && cam.view.enabled) cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // cutaway: layer 0 always; a wall/ceiling bucket is hidden while the camera is outside it
    const rm = R.roomDims || { w: 16, d: 14, h: 4 }, c = rig.pos; let mask = 1;
    if (!(c.z > rm.d / 2)) mask |= 1 << 1;
    if (!(c.z < -rm.d / 2)) mask |= 1 << 2;
    if (!(c.x < -rm.w / 2)) mask |= 1 << 3;
    if (!(c.x > rm.w / 2)) mask |= 1 << 4;
    if (!(c.y > rm.h - 0.05)) mask |= 1 << 5;
    cam.layers.mask = mask;
  }
  // the last settled camera pose (x, z, heading): informational only (Mogul wrote it into the save; Frontier's state is
  // the sim's, so it stays here)
  function settle() {
    R.settled = { pos: [+rig.pos.x.toFixed(2), +rig.pos.z.toFixed(2)], yaw: +Math.atan2(-(rig.look.x - rig.pos.x), -(rig.look.z - rig.pos.z)).toFixed(3) };
  }
  // view direction (unit) and look distance of a pose
  function aim(p) { const d = new THREE.Vector3(p.look[0] - p.pos[0], p.look[1] - p.pos[1], p.look[2] - p.pos[2]), l = d.length(); return { d: l > 1e-6 ? d.divideScalar(l) : d.set(0, 0, -1), l }; }
  // The position moves on a straight line; the view direction turns on a great circle (slerp) and the look distance
  // lerps, so the heading turns smoothly instead of swinging round when the camera passes over its look point.
  function stepGlide(now) {
    if (!glide) return;
    const g = glide, k = Math.min(1, (now - g.t0) / g.ms);
    if (k >= 1) { setRig(g.to); glide = null; settle(); if (g.done) { try { g.done(); } catch (e) { console.error('glide done', e); } } return; }
    const e = ease(k), a = g.from, b = g.to, da = g.aa.d, db = g.ab.d;
    rig.pos.set(a.pos[0] + (b.pos[0] - a.pos[0]) * e, a.pos[1] + (b.pos[1] - a.pos[1]) * e, a.pos[2] + (b.pos[2] - a.pos[2]) * e);
    const th = Math.acos(Math.max(-1, Math.min(1, da.dot(db))));
    if (th < 1e-4 || th > Math.PI - 1e-3) { _dir.copy(da).lerp(db, e); if (_dir.lengthSq() < 1e-12) _dir.copy(db); _dir.normalize(); }
    else { const sn = Math.sin(th); _dir.copy(da).multiplyScalar(Math.sin((1 - e) * th) / sn).addScaledVector(db, Math.sin(e * th) / sn); }
    rig.look.copy(rig.pos).addScaledVector(_dir, g.aa.l + (g.ab.l - g.aa.l) * e);
    rig.fov = a.fov + (b.fov - a.fov) * e; rig.shift = a.shift + (b.shift - a.shift) * e; rig.sx = a.shiftX + (b.shiftX - a.shiftX) * e;
  }
  // tween pos, look, fov and shift; cancels a running glide (its done never fires). ms <= 0 or already there: instant.
  R.glideTo = function (pose, ms, done) {
    const to = norm(pose, pose && pose.shift); if (!to) return false;
    glide = null;
    if (!(ms > 0) || near(to)) { setRig(to); applyPose(); settle(); if (done) done(); return true; }
    const from = rigPose();
    glide = { from, to, aa: aim(from), ab: aim(to), t0: performance.now(), ms, done: done || null };
    return true;
  };
  R.snap = function (pose) { const p = norm(pose, pose && pose.shift); if (!p) return; glide = null; setRig(p); applyPose(); settle(); };
  Object.defineProperty(R, 'gliding', { get: () => !!glide });
  R.setMode = function (mode, targetId) {
    const fid = mode === 'focus' ? (targetId || null) : null;
    if (mode === 'focus') covered = false;
    if (mode === R.mode && fid === R.focusId) return;
    R.mode = mode; R.focusId = fid;
    FR.emit('hq:view', { mode, targetId: fid, floorId: R.current ? R.current.id : null });
  };
  R.target = function (id) { return byId[id] || null; };
  // a target with onlyIn is live (pickable) only while the camera is on one of those focus targets; mode overrides R.mode
  function live(t, mode) { return !t.onlyIn || ((mode || R.mode) === 'focus' && t.onlyIn.indexOf(R.focusId) >= 0); }
  R.live = function (id) { const t = byId[id]; return !!t && live(t); };
  R.targets = function () { return targets.slice(); };
  // a target's focus pose (shift defaults to FOCUS_SHIFT); null when the target is missing or has no focus
  R.poseOf = function (id) { const t = byId[id]; return t && t.focus ? norm(t.focus, R.FOCUS_SHIFT) : null; };

  // ---------- picking ----------
  function toScreen(x, y, z, out) {
    const cam = R.camera; _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    if (_v.z > -cam.near) return false;
    _v.applyMatrix4(cam.projectionMatrix);
    out.x = (_v.x + 1) / 2 * W(); out.y = (1 - _v.y) / 2 * H(); return true;
  }
  const _s = { x: 0, y: 0 };
  R.screenOf = function (id) {
    const t = byId[id]; if (!t || !R.camera) return null; const b = t.box;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      if (!toScreen(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2], _s)) return null;
      if (_s.x < x0) x0 = _s.x; if (_s.x > x1) x1 = _s.x; if (_s.y < y0) y0 = _s.y; if (_s.y > y1) y1 = _s.y;
    }
    if (!toScreen((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, _s)) return null;
    return { x0, y0, x1, y1, cx: _s.x, cy: _s.y };
  };
  // pure: ray against target boxes (highest pri, then nearest); else the padded screen rect (MIN_HIT) with the nearest centre
  R.pick = function (clientX, clientY) {
    if (!R.camera || !targets.length) return null;
    _ndc.set(clientX / W() * 2 - 1, -(clientY / H()) * 2 + 1); _ray.setFromCamera(_ndc, R.camera);
    let best = null, bp = -1e9, bd = 1e9; const hits = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i], b = t.box; if (!live(t)) continue; _box.min.set(b[0], b[1], b[2]); _box.max.set(b[3], b[4], b[5]);
      if (!_ray.ray.intersectBox(_box, _hit)) continue;
      const d = _hit.distanceTo(_ray.ray.origin), p = t.pri || 0; hits.push(t);
      if (p > bp || (p === bp && d < bd)) { best = t; bp = p; bd = d; }
    }
    // overlapping boxes (a person seated behind a desk): the target whose box holds the first visible surface wins;
    // pri, then distance, only decide when that surface is in none of them
    if (hits.length > 1) { const q = firstSurface(); if (q) { const e = 0.05, inq = hits.filter(t => { const b = t.box; return q.x > b[0] - e && q.x < b[3] + e && q.y > b[1] - e && q.y < b[4] + e && q.z > b[2] - e && q.z < b[5] + e; });
      // several boxes hold that surface (a desk around its screen): the most specific, smallest box wins
      const vol = (t) => (t.box[3] - t.box[0]) * (t.box[4] - t.box[1]) * (t.box[5] - t.box[2]);
      if (inq.length) return inq.reduce((a, t) => (vol(t) < vol(a) ? t : a)); } }
    if (best) return best;
    let bc = 1e9;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]; if (!live(t)) continue; const s = R.screenOf(t.id); if (!s) continue;
      const pw = Math.max(0, (R.MIN_HIT - (s.x1 - s.x0)) / 2), ph = Math.max(0, (R.MIN_HIT - (s.y1 - s.y0)) / 2);
      if (clientX < s.x0 - pw || clientX > s.x1 + pw || clientY < s.y0 - ph || clientY > s.y1 + ph) continue;
      const d = Math.hypot(clientX - s.cx, clientY - s.cy); if (d < bc) { bc = d; best = t; }
    }
    return best;
  };
  // first opaque, visible, not cut-away mesh surface under the current pick ray (glows, halos and blob shadows skipped)
  function firstSurface() {
    const cam = R.camera, hs = _ray.intersectObject(R.current.group, true);
    for (let i = 0; i < hs.length; i++) { const o = hs[i].object, m = o.material; if (!o.isMesh || (m && m.transparent && !m.depthWrite) || !o.layers.test(cam.layers)) continue;
      let vis = true; for (let a = o; a; a = a.parent) if (!a.visible) { vis = false; break; } if (vis) return hs[i].point; }
    return null;
  }
  function busy() { return R.paused || !!R.cinematic || !R.current || !FR.state || R.mode === 'ride' || (FR.elevator && FR.elevator.riding); }
  const sfx = (n) => { try { if (FR.audio && FR.audio.play) FR.audio.play(n); } catch (e) { /* audio never breaks input */ } };
  // canvas tap: pick, then focus; an empty tap while in focus goes home, in the room view it shows a ripple so the tap
  // visibly landed. Any tap hides the first-visit hint. Ignored while gliding, paused or riding.
  R.tapAt = function (clientX, clientY) {
    if (glide || busy()) return false;
    if (FR.ui && FR.ui.hideHint) FR.ui.hideHint();
    const t = R.pick(clientX, clientY);
    if (t) return R.focus(t.id);
    if (R.mode === 'focus') { R.home(); return true; }
    ripple(clientX, clientY);
    return false;
  };
  function ripple(x, y) {
    if (!rippleEl) { rippleEl = document.createElement('div'); rippleEl.id = 'ripple'; document.body.appendChild(rippleEl); }
    rippleEl.classList.remove('on'); void rippleEl.offsetWidth;
    rippleEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; rippleEl.classList.add('on');
  }
  // long glides (a corner view to a far desk is ~20 m) get a little more time
  function glideMs(pose, ms) { return rig.pos.distanceTo(_v.set(pose.pos[0], pose.pos[1], pose.pos[2])) > 15 ? ms + 150 : ms; }
  // press feedback, mode 'focus', glide, then emit hq:hotspot. A target without focus fires at once and the camera stays.
  R.focus = function (id) {
    const t = byId[id]; if (!t || busy() || !live(t)) return false;
    sfx('tap');
    press(t);
    const fire = () => { if (!R.paused && !(FR.elevator && FR.elevator.riding)) FR.emit('hq:hotspot', { hotspotId: id }); };
    const pose = R.poseOf(id);
    if (!pose) { fire(); return true; }
    R.setMode('focus', id);
    if (!near(pose)) sfx('glide');
    R.glideTo(pose, glideMs(pose, R.FOCUS_MS), fire);
    return true;
  };
  R.home = function (ms) {
    R.setMode('room', null);
    if (!R.view) return;
    if (ms !== 0 && !near(R.view)) sfx('glide');
    R.glideTo(R.view, ms == null ? glideMs(R.view, R.HOME_MS) : ms);
  };
  // Escape / the HUD Back chip: close the open sheet first (the camera then returns by itself), else glide home
  R.back = function () {
    if (FR.ui && FR.ui.sheetId) { FR.ui.sheet(null); return; }
    if (R.mode === 'ride' || R.paused) return;
    if (R.mode === 'focus') R.home();
  };

  // ---------- press feedback: flash box + lit tag ----------
  function press(t) {
    const b = t.box;
    if (flash) {
      flash.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      flash.scale.set(Math.max(0.05, b[3] - b[0]) * 1.04, Math.max(0.05, b[4] - b[1]) * 1.04, Math.max(0.05, b[5] - b[2]) * 1.04);
      flash.visible = true; flash.material.opacity = 0; flashT0 = performance.now();
    }
    const el = tagEls[t.id]; if (el) { el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 250); }
  }
  function stepFlash(now) {
    if (!flash || flashT0 < 0) return;
    const k = (now - flashT0) / 250;
    if (k >= 1) { flash.visible = false; flash.material.opacity = 0; flashT0 = -1; return; }
    flash.material.opacity = 0.18 * (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75);
  }

  // ---------- tags + HUD state ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // one tag per target, except onlyIn targets (they are never live in the room view, where tags show)
  function buildTags() {
    tagEls = {}; if (!tagsEl) return;
    tagsEl.innerHTML = targets.filter(t => !t.onlyIn).map(t => `<button class="tag" data-t="${esc(t.id)}" aria-label="${esc(t.label)}"><i></i><span>${esc(t.label)}</span></button>`).join('');
    tagsEl.querySelectorAll('.tag').forEach(el => { tagEls[el.dataset.t] = el; el._k = null; el._off = false; el._w = 0; });
    tagStale = true;
  }
  // re-label one target's tag in place (a project floor's tag after a greenlight); placement re-runs on the next frame
  R.relabel = function (id, label) {
    const t = byId[id]; if (!t) return; t.label = label; const el = tagEls[id]; if (!el) return;
    const sp = el.querySelector('span'); if (sp) sp.textContent = label; el.setAttribute('aria-label', label); el._w = 0; tagStale = true;
  };
  // Tags hang above their anchors, or below when every spot above is taken. Each tag takes the cheapest spot near its
  // anchor that is on screen, clear of the HUD and of the tags already placed, and covers no other target's centre;
  // spots overlapping another target's screen rect (plus 8 px of touch slop) cost the most, so a tap anywhere on an
  // object reaches that object rather than a neighbour's tag. A tag with no legal spot hides (its object still takes
  // taps). Runs only when the camera or the viewport changed (the room view is static).
  // last camera + viewport the tags were placed for (numbers, compared in place: no per-frame string); NaN = stale
  const tagSig = new Float64Array(11); let tagStale = true;
  function sig(i, v, ch) { if (tagSig[i] !== v) { tagSig[i] = v; return true; } return ch; }
  function camChanged() {
    let ch = tagStale; tagStale = false;
    ch = sig(0, rig.pos.x, ch); ch = sig(1, rig.pos.y, ch); ch = sig(2, rig.pos.z, ch); ch = sig(3, rig.look.x, ch); ch = sig(4, rig.look.y, ch);
    ch = sig(5, rig.look.z, ch); ch = sig(6, rig.fov, ch); ch = sig(7, rig.shift, ch); ch = sig(8, rig.sx, ch); ch = sig(9, W(), ch); ch = sig(10, H(), ch);
    return ch;
  }
  const SLOP = 8, EDGE = 4;
  const ovl = (a, b) => { const x = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), y = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return x > 0 && y > 0 ? x * y : 0; };
  function hudRects() {
    const out = []; document.querySelectorAll(R.HUD_SEL).forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.height) out.push([r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]); });
    return out;
  }
  function hideTag(el) { if (!el._off) { el.classList.add('off'); el._off = true; el._k = null; } }
  function placeTags() {
    if (!camChanged()) return;
    const w = W(), h = H(), hud = hudRects(), placed = [];
    const rects = targets.map(t => { if (!live(t)) return null; const s = R.screenOf(t.id); return s ? { r: [s.x0 - SLOP, s.y0 - SLOP, s.x1 + SLOP, s.y1 + SLOP], cx: s.cx, cy: s.cy } : null; });
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i], el = tagEls[t.id]; if (!el) continue; const b = t.box, a = t.labelAt;
      const ok = a ? toScreen(a[0], a[1], a[2], _s) : toScreen((b[0] + b[3]) / 2, b[4] + 0.15, (b[2] + b[5]) / 2, _s);
      if (!ok || _s.x < -40 || _s.x > w + 40 || _s.y < 0 || _s.y > h + 20) { hideTag(el); continue; }
      const n = t.labelNudge, ax = _s.x + (n ? n[0] : 0), ay = _s.y + (n ? n[1] : 0);
      if (el._off) { el.classList.remove('off'); el._off = false; }
      if (!el._w) { el._w = el.offsetWidth || 0; el._h = el.offsetHeight || 28; }
      const tw = el._w, th = el._h, hw = tw / 2, reach = Math.max(0, hw - 10);
      // pill centres: on the anchor, slid half or all the way (the stem must still meet the pill), clamped on screen
      const xs = [ax, ax - reach / 2, ax + reach / 2, ax - reach, ax + reach], cl = Math.min(Math.max(ax, EDGE + hw), w - EDGE - hw);
      if (Math.abs(cl - ax) <= hw - 8 && xs.indexOf(cl) < 0) xs.push(cl);
      let best = null;
      for (let side = 0; side < 2; side++) for (let lift = 0; lift <= 48; lift += 12) for (let q = 0; q < xs.length; q++) {
        const x = xs[q], y0 = side ? ay + 6 + lift : ay - 6 - lift - th, box = [x - hw, y0, x + hw, y0 + th];
        if (box[0] < EDGE || box[2] > w - EDGE || box[1] < EDGE || box[3] > h - EDGE) continue;
        let bad = false, over = 0;
        for (let k = 0; k < hud.length && !bad; k++) if (ovl(box, hud[k])) bad = true;
        for (let k = 0; k < placed.length && !bad; k++) if (ovl(box, placed[k])) bad = true;
        for (let j = 0; j < rects.length && !bad; j++) {
          const o = rects[j]; if (j === i || !o) continue;
          if (o.cx > box[0] - SLOP && o.cx < box[2] + SLOP && o.cy > box[1] - SLOP && o.cy < box[3] + SLOP) bad = true;
          else over += ovl(box, o.r);
        }
        if (bad) continue;
        const cost = over / (tw * th) * 1000 + lift + Math.abs(x - ax) * 0.5 + side * 40;
        if (!best || cost < best.cost) best = { cost, x, y0, side, stem: 6 + lift };
      }
      if (!best) { hideTag(el); continue; }
      placed.push([best.x - hw - 3, best.y0 - 3, best.x + hw + 3, best.y0 + th + 3]);
      const L = Math.round(best.x - hw), T = Math.round(best.y0), sx = Math.round(ax - best.x), key = L + ',' + T + ',' + best.side + ',' + sx + ',' + best.stem;
      if (key !== el._k) {
        el._k = key; el.style.transform = `translate(${L}px,${T}px)`; el.classList.toggle('dn', !!best.side);
        el.style.setProperty('--sx', sx + 'px'); el.style.setProperty('--sh', best.stem + 'px');
      }
    }
  }
  function syncUi() {
    const hudOn = !!(hudEl && hudEl.classList.contains('on'));
    const idle = !glide && !R.paused && !R.cinematic && hudOn && !!FR.state;
    const tagsOn = idle && R.mode === 'room', backOn = idle && R.mode === 'focus', focusOn = R.mode === 'focus';
    if (tagsOn !== ui.tags) { ui.tags = tagsOn; if (tagsEl) tagsEl.classList.toggle('on', tagsOn); }
    if (backOn !== ui.back) {
      ui.back = backOn; document.body.classList.toggle('hq-back', backOn);
      // first rest on a focus that carries a hint
      const t = backOn && byId[R.focusId], f = R.current;
      if (t && t.hint && f && FR.ui && FR.ui.hint) FR.ui.hint(f.id + '.' + t.id, t.hint);
    }
    if (focusOn !== ui.focus) { ui.focus = focusOn; document.body.classList.toggle('hq-focus', focusOn); }
    if (tagsOn) {
      placeTags();
      const f = R.current;
      if (f && hintFloor !== f.id) { hintFloor = f.id; if (FR.ui && FR.ui.hint) FR.ui.hint(f.id, f.hint || 'Tap anything with a label.'); }
    }
  }

  // ---------- init ----------
  // the shell's layers, made here when the shell lacks them (a harness page): #tags (tag pills), #fade (elevator ride)
  function layer(id, css) { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; if (css) el.style.cssText = css; document.body.appendChild(el); } return el; }
  R.init = function (el) {
    if (R.renderer) return;
    R.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    R.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, R.PR_CAP));
    R.renderer.setSize(W(), H()); el.appendChild(R.renderer.domElement);
    R.scene = new THREE.Scene(); R.scene.background = new THREE.Color(0x0a0e13);
    R.camera = new THREE.PerspectiveCamera(70, W() / H(), 0.1, 120);
    R.hemi = new THREE.HemisphereLight(0xf2f6ff, 0x2a3036, 0.85); R.scene.add(R.hemi);
    R.sun = new THREE.DirectionalLight(0xffe8cc, 0.55); R.sun.position.set(3, 8, 4); R.scene.add(R.sun);
    rig.pos = V(); rig.look = V(); setRig(norm(DEFAULT_VIEW));
    flash = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.visible = false; flash.renderOrder = 10; R.scene.add(flash);
    hudEl = document.getElementById('hud');
    tagsEl = layer('tags', 'position:fixed;inset:0;pointer-events:none;overflow:hidden');
    layer('fade', 'position:fixed;inset:0;z-index:12;background:#0a0e13;opacity:0;pointer-events:none;transition:opacity .25s');
    R.paused = true; R.frames = 0; R.fps = 0; R.fpsT = 0;
    window.addEventListener('resize', () => { R.renderer.setSize(W(), H()); refit(); applyPose(); for (const k in tagEls) tagEls[k]._w = 0; tagStale = true; });
    R.bindInput(R.renderer.domElement);
    R.clock = new THREE.Clock();
    R.renderer.setAnimationLoop(R.frame);
  };

  // ---------- input: one primary pointer; a tap moves < 12 px and lasts < 500 ms; drags do nothing ----------
  R.bindInput = function (cv) {
    let down = null;
    cv.addEventListener('pointerdown', e => { if (!e.isPrimary || (e.button != null && e.button > 0)) return; down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; });
    cv.addEventListener('pointermove', e => {
      if (down && e.pointerId === down.id) down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      else if (e.pointerType === 'mouse' && !down) cv.style.cursor = (!glide && !busy() && R.pick(e.clientX, e.clientY)) ? 'pointer' : '';
    });
    cv.addEventListener('pointerup', e => {
      if (!down || e.pointerId !== down.id) return; const d = down; down = null;
      const moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
      if (moved < 12 && performance.now() - d.t < 500) R.tapAt(e.clientX, e.clientY);
    });
    cv.addEventListener('pointercancel', e => { if (down && e.pointerId === down.id) down = null; });
    // Touch adjustment: Chromium snaps a touch (pointerdown and click alike) onto a nearby tap-responsive element (a tag,
    // a HUD button) when the element under the finger does not respond to taps. A click listener makes the canvas one,
    // so a touch on the scene stays on the scene and only a touch on a tag's pill reaches the tag.
    cv.addEventListener('click', () => {});
    // The canvas never needs the click a touch tap makes afterwards, and that click would land on whatever the tap just
    // opened (an instant glide shows the sheet's #dim inside pointerup). Cancelling touchend stops the click.
    cv.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    if (tagsEl) {
      // Tags act on pointerdown + pointerup on the tag itself (the canvas's tap rule: < 12 px, < 500 ms) and cancel the
      // touch's click, like the canvas; click only serves the keyboard (Enter / Space on a focused tag).
      let td = null; const tagOf = (e) => (e.target && e.target.closest ? e.target.closest('.tag') : null);
      tagsEl.addEventListener('pointerdown', e => { const el = tagOf(e); td = el && e.isPrimary && !(e.button > 0) ? { el, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null; });
      tagsEl.addEventListener('pointerup', e => {
        const d = td; td = null; if (!d || e.pointerId !== d.id || tagOf(e) !== d.el) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12 && performance.now() - d.t < 500) { if (FR.ui && FR.ui.hideHint) FR.ui.hideHint(); R.focus(d.el.dataset.t); }
      });
      tagsEl.addEventListener('pointercancel', () => { td = null; });
      tagsEl.addEventListener('touchend', e => { if (e.cancelable && tagOf(e)) e.preventDefault(); }, { passive: false });
      tagsEl.addEventListener('click', e => { const el = tagOf(e); if (!el) return; e.stopPropagation(); if (e.detail === 0) R.focus(el.dataset.t); });
    }
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return; const tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      if (document.querySelector('.screen.on')) return; // a menu screen owns Escape
      R.back();
    });
  };

  // ---------- floors ----------
  // put wall / ceiling meshes on layers 1..5 so the camera can cut away the walls it is outside of
  function bucketLayers(g, rm) {
    g.updateMatrixWorld(true); const w2 = rm.w / 2, d2 = rm.d / 2;
    g.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return; _v.setFromMatrixPosition(o.matrixWorld);
      let L = 0;
      if (_v.y > rm.h - 0.15) L = 5;
      else if (_v.z > d2 - 0.1 && _v.z < d2 + 0.5) L = 1;
      else if (_v.z < -d2 + 0.1 && _v.z > -d2 - 0.5) L = 2;
      else if (_v.x < -w2 + 0.1 && _v.x > -w2 - 0.5) L = 3;
      else if (_v.x > w2 - 0.1 && _v.x < w2 + 0.5) L = 4;
      if (L) o.layers.set(L);
    });
  }
  // Fallback for a floor id with no builder (or a builder that threw): bare concrete, the elevator bank, a name plate.
  // It keeps the game playable while 08_hq_floors.js is missing a floor; it is never the intended look.
  R.blankFloor = { build(id) {
    const g = new THREE.Group(), W = 16, D = 14, H = 4, m = FR.HQ_FLOOR_META[id] || { n: '?', name: String(id) };
    R.room(g, W, D, H, { floor: 0x4a4f54, wall: 0x5d6368, ceil: 0x2e3236 });
    const ev = R.elevatorBank(g, 0, -D / 2, H);
    [[-5, -3], [5, -3], [-5, 3], [5, 3]].forEach(([x, z]) => R.box(g, 0.6, H, 0.6, 0x5a6066, x, H / 2, z));
    for (let x = -5; x <= 5; x += 5) R.box(g, 1.2, 0.06, 1.2, 0xf0f4ff, x, H - 0.05, 0, { emissive: 0xf0f4ff, emissiveIntensity: 0.9 });
    R.sign(g, ['FLOOR ' + m.n, m.name.toUpperCase()], 2.6, 0.9, 3.4, 2.4, -D / 2 + 0.12, 0, { bg: '#1b232c', fg: '#c5cfd9', w: 1024, h: 354, size: 80 });
    return { group: g, elevator: ev, targets: [ev.target], hint: 'Tap the elevator to change floors.',
      view: { pos: [0, 24.15, 9.22], look: [0, 0.5, -5.3], fov: 75, shift: 0.14 } };
  } };
  // opts.keep: keep the camera pose, mode, focusId and any running glide (in-place rebuild)
  R.loadFloor = function (id, opts) {
    const keep = !!(opts && opts.keep);
    if (R.current) { R.scene.remove(R.current.group); R.disposeGroup(R.current.group); }
    if (FR.props && FR.props.unbindAll) FR.props.unbindAll();
    const def = R.floors[id] || R.blankFloor;
    R._room = null;
    let f = null;
    try { f = def.build(id); } catch (e) { console.error('floor build failed', id, e); }
    if (!f || !f.group) { if (FR.props && FR.props.unbindAll) FR.props.unbindAll(); R._room = null; f = R.blankFloor.build(id); }
    R.scene.add(f.group); R.current = f; R.current.id = id;
    R.roomDims = f.room || R._room || { w: 16, d: 14, h: 4 };
    bucketLayers(f.group, R.roomDims);
    targets = (Array.isArray(f.targets) ? f.targets : f.elevator && f.elevator.target ? [f.elevator.target] : []).filter(t => t && t.id && t.box);
    byId = {}; targets.forEach(t => { byId[t.id] = t; });
    R.base = norm(f.view || DEFAULT_VIEW, 0); R.view = fitView(R.base);
    buildTags(); ui.tags = null; R.dirty = false;
    if (f.light) { R.hemi.intensity = f.light.hemi; R.sun.intensity = f.light.sun; R.scene.background.set(f.light.bg); } else { R.hemi.intensity = 0.85; R.sun.intensity = 0.55; R.scene.background.set(0x0a0e13); }
    if (!keep) { glide = null; R.snap(R.view); R.setMode(R.mode === 'ride' ? 'ride' : 'room', null); }
    else if (R.mode === 'focus' && !byId[R.focusId]) R.home();
    FR.emit('hq:floor', { floorId: id });
  };
  // frees geometry, every material a floor made itself (with its map) and textures; shared R.mat materials and
  // materials or maps flagged userData.keep (module-level shared ones, the look kit's textures) survive
  const shared = m => m.userData.keep || cachedMats.has(m);
  R.disposeGroup = function (g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => { if (shared(m)) return; if (m.map && !(m.map.userData && m.map.userData.keep)) m.map.dispose(); m.dispose(); });
    });
  };
  // Live data on the loaded floor: after End Turn, any applied command or a load, the floor's refresh(FR.state) runs once
  // on the next frame (events coalesce). A floor with no refresh is rebuilt in place after End Turn and loads (camera
  // kept). autoRefresh:false opts a floor out (it binds FR.props itself).
  function markDirty(rebuild) { const f = R.current; if (!f || f.autoRefresh === false) return; if (f.refresh) R.dirty = true; else if (rebuild) R.dirty = 'rebuild'; }
  FR.on('turn:ended', () => markDirty(true)); FR.on('game:loaded', () => markDirty(true)); FR.on('state:changed', () => markDirty(false));
  function stepDirty() {
    if (!R.dirty || !R.current || !FR.state) return; const d = R.dirty;
    if (d === 'rebuild') { if (!(FR.elevator && FR.elevator.riding)) { R.dirty = false; R.loadFloor(R.current.id, { keep: true }); } return; } // after the ride
    R.dirty = false;
    try { R.current.refresh(FR.state); } catch (e) { console.error('floor refresh failed', R.current.id, e); }
  }

  // ---------- loop ----------
  R.frame = function () {
    const raw = R.clock.getDelta(), dt = Math.min(raw, 0.1); R.t += dt; const now = performance.now();
    // a cinematic (the title scene) renders its own scene and camera; the floor, glides, tags and hints wait
    if (R.cinematic) { R.cinematic(dt); syncUi(); countFps(raw); return; }
    stepDirty();
    if (R.current && R.current.update) R.current.update(dt, R.t);
    stepGlide(now);
    // auto-return: in focus, once whatever covered the scene (a sheet) has closed, glide home
    // (a stay target keeps the camera: Back / Escape / an empty tap leave it; one with focus.rest
    // eases to that lighter lens shift, since nothing covers the lower screen any more)
    if (R.mode === 'focus') { if (R.paused) covered = true; else if (covered && !glide) { covered = false; const t = byId[R.focusId];
      if (!(t && t.stay)) R.home(); else if (t.focus && t.focus.rest != null) R.glideTo(Object.assign({}, t.focus, { shift: t.focus.rest }), R.HOME_MS * 0.6); } }
    applyPose(); stepFlash(now); syncUi();
    R.renderer.render(R.scene, R.camera); countFps(raw);
  };
  /* unclamped, so a slow device reads below 10 */
  function countFps(raw) { R.frames++; R.fpsT += raw; if (R.fpsT >= 1) { R.fps = R.frames / R.fpsT; R.frames = 0; R.fpsT = 0; } }
  R.debug = () => ({ floor: R.current && R.current.id, fps: R.fps, mode: R.mode, focus: R.focusId, gliding: !!glide,
    cam: rig.pos ? { pos: arr(rig.pos), look: arr(rig.look), fov: +rig.fov.toFixed(2) } : null,
    targets: targets.map(t => t.id), paused: R.paused, cinematic: !!R.cinematic, objects: R.current ? R.current.group.children.length : 0,
    floorDebug: R.current && R.current.debug ? R.current.debug() : null });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// ---------- FR.props: reactive prop registry ----------
// Floors bind bus events to in-place prop updates; R.loadFloor calls unbindAll() on every floor change.
(function (FR) {
  const P = FR.props = { list: [] };
  // spec = { event, update(data, floorCtx) }. Fires only while floorId is the loaded floor. Returns the binding (pass to unbind).
  P.bind = function (floorId, spec) {
    if (!spec || !spec.event || typeof spec.update !== 'function') return null;
    const b = { floorId, event: spec.event, fires: 0, spec };
    b.fn = function (data) {
      const cur = FR.r && FR.r.current;
      if (!cur || cur.id !== floorId) return;
      b.fires++; spec.update(data, cur);
    };
    b.off = FR.on(spec.event, b.fn); P.list.push(b); return b;
  };
  P.unbind = function (b) { const i = P.list.indexOf(b); if (i >= 0) { P.list.splice(i, 1); b.off(); } };
  P.unbindAll = function () { const l = P.list; P.list = []; for (let i = 0; i < l.length; i++) l[i].off(); };
  P.debug = () => ({ count: P.list.length, bindings: P.list.map(b => ({ floor: b.floorId, event: b.event, fires: b.fires })) });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// ---------- FR.look: pixel-ratio budget, per-floor light rig + palette, baked floor/ceiling shading, wall AO, contact
// shadows, glows. It only wraps world helpers (R.init, R.loadFloor, R.room, R.plane, R.sign, R.person) and listens to
// 'hq:floor', so it never touches gameplay, input or the camera. Floors read FR.look.hex(floorId, 'wall') for sign plates.
// Headless screenshots: set FR.look.adaptive = false.
(function (FR) {
  const R = FR.r; if (!R || R.stub) return;
  const LK = FR.look = { cap: R.PR_CAP || 1.5, min: 1, pr: 1.5, adaptive: true, ema: 16, fps: 0, floor: null, level: 1 };

  // ---------- per-floor look (legacy lighting: no sRGB output, no tone mapping; colours are the hexes you see) ----------
  // Cool office: concrete, glass, graphite, pale ash; warm task light (key), blue screen glow (fill, spill).
  // rugs: remap for flat floor decals painted into the floor bake; pat: floor pattern ('tile' | 'plank' | 'carpet' | 'grate');
  // key/fill/rim: [colour, intensity, x, y, z]; spill: [[x, z, radius, rgba]] light pools on the floor; panel: 'r,g,b' of the
  // ceiling panel halos; window: a window wall's light on the floor { z, depth, mullions, color }
  const LOOK = {
    lobby: { floor: 0x7a8086, wall: 0x939ba3, ceil: 0x6c747c, pat: 'tile', rugs: {}, panel: '240,244,255',
      sky: 0xf4f7ff, ground: 0x5d646b, hemi: 0.72, key: [0xffe8cc, 0.6, 3, 9, 5], fill: [0xaec8ff, 0.32, -7, 3, -3], rim: [0xd6e4ff, 0.3, 2, 4, -10], bg: 0x0b1016,
      window: { z: 7, depth: 3.2, mullions: [-6, -2, 2, 6], color: 'rgba(120,160,230,.24)' } },
    // the ops room: dark raised-floor tiles, the status wall's blue spill on the back half
    serving: { floor: 0x4c545d, wall: 0x5d6771, ceil: 0x3b424a, pat: 'grate', rugs: {}, panel: '230,238,255',
      sky: 0xdfe8ff, ground: 0x3a4048, hemi: 0.62, key: [0xe6eeff, 0.5, -3, 9, 4], fill: [0x6f9cff, 0.42, 6, 3, 2], rim: [0x9cc0ff, 0.32, 0, 4, -10], bg: 0x070b10,
      spill: [[0, -5.2, 4.2, 'rgba(79,147,217,.30)']] },
    // the cluster hall: dark epoxy, cold rim, rack-LED pools (blue compute, a little green)
    training: { floor: 0x40474f, wall: 0x505963, ceil: 0x2e343b, pat: 'grate', rugs: {}, panel: '225,235,255',
      sky: 0xd8e4ff, ground: 0x30363d, hemi: 0.56, key: [0xdfe8ff, 0.45, 2, 9, 3], fill: [0x5f8fe0, 0.45, -7, 3, 0], rim: [0x7fd0ff, 0.3, 0, 4, -10], bg: 0x06090d,
      spill: [[-4, -3, 3, 'rgba(79,147,217,.22)'], [4, -3, 3, 'rgba(95,207,154,.12)']] },
    // the evals lab: pale vinyl, white light, the safety green on the screen wall
    safety: { floor: 0x98a0a6, wall: 0xadb5bc, ceil: 0x7e868e, pat: 'tile', rugs: {}, panel: '244,248,255',
      sky: 0xf6f9ff, ground: 0x646b72, hemi: 0.8, key: [0xf2f5ff, 0.55, -3, 9, 4], fill: [0xbfd6ff, 0.3, 7, 3, 2], rim: [0xd8ffe8, 0.25, 0, 4, -10], bg: 0x0b1015,
      spill: [[0, -5.5, 3.6, 'rgba(95,207,154,.18)']] },
    // whiteboards and the reading room: pale ash planks, warm lamps
    research: { floor: 0xa08f79, wall: 0x979fa6, ceil: 0x6f767d, pat: 'plank', rugs: {}, panel: '255,232,204',
      sky: 0xfff3e4, ground: 0x5e5850, hemi: 0.72, key: [0xffe2bc, 0.65, 3, 9, 4], fill: [0xa8c0ff, 0.28, -8, 3, 2], rim: [0xffd2a0, 0.3, 1, 4, -10], bg: 0x0e1014 },
    // project war rooms: graphite carpet tiles
    project: { floor: 0x5c636b, wall: 0x7d868f, ceil: 0x4d545b, pat: 'carpet', rugs: {}, panel: '240,244,255',
      sky: 0xeef3ff, ground: 0x464c53, hemi: 0.68, key: [0xffe6c8, 0.55, -3, 9, -4], fill: [0x8fb0ff, 0.36, 6, 3, 4], rim: [0xcfe0ff, 0.28, 0, 4, -10], bg: 0x090d12,
      spill: [[0, -5.4, 3.4, 'rgba(79,147,217,.18)']] },
    // an empty project floor: dust sheets, bare concrete, one work light (a builder picks it with FR.look.use('vacant'))
    vacant: { floor: 0x575b60, wall: 0x686e74, ceil: 0x383c40, pat: 'tile', rugs: {}, panel: '240,236,226',
      sky: 0xf0f0ea, ground: 0x3a3d40, hemi: 0.5, key: [0xfff0d8, 0.38, 0, 9, 2], fill: [0x9ab0d0, 0.2, -6, 3, -3], rim: [0xd0d8e0, 0.2, 0, 4, -9], bg: 0x08090b },
    // the boardroom: charcoal carpet, warm pendants, the city through the window wall
    boardroom: { floor: 0x3f4650, wall: 0x6c757e, ceil: 0x454c54, pat: 'carpet', rugs: {}, panel: '255,228,196',
      sky: 0xe4ecff, ground: 0x3b4047, hemi: 0.6, key: [0xffdcb0, 0.55, -3, 9, -4], fill: [0x7f9cff, 0.45, 0, 3, 10], rim: [0xffc890, 0.28, 6, 4, -8], bg: 0x08101c,
      window: { z: 7, depth: 3.4, mullions: [-6, -2, 2, 6], color: 'rgba(110,150,230,.30)' } },
    blank: { floor: 0x4a4f54, wall: 0x5d6368, ceil: 0x2e3236, pat: 'tile', rugs: {}, panel: '240,244,255',
      sky: 0xf0f4ff, ground: 0x3a3e42, hemi: 0.5, key: [0xfff0d8, 0.4, 0, 9, 2], fill: [0x9ab0d0, 0.2, -6, 3, -3], rim: [0xd0d8e0, 0.2, 0, 4, -9], bg: 0x080a0c }
  };
  LOOK.proj1 = LOOK.proj2 = LOOK.proj3 = LOOK.project;
  LK.table = LOOK;
  const lookOf = id => LOOK[id] || LOOK.blank;
  // the look a floor id gets: its own entry, else the bare fallback. A builder may switch it with FR.look.use(key) before R.room.
  const keyOf = id => (LOOK[id] ? id : 'blank');
  LK.keyOf = keyOf;
  const hex = c => '#' + new THREE.Color(c).getHexString();
  LK.hex = (id, part) => hex(lookOf(id)[part || 'wall']);

  // ---------- small texture kit (shared textures are flagged userData.keep) ----------
  function tex(c, o) {
    o = o || {}; const t = new THREE.CanvasTexture(c);
    if (o.mip !== false) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; } else t.minFilter = THREE.LinearFilter;
    if (o.aniso) t.anisotropy = Math.min(o.aniso, R.renderer ? R.renderer.capabilities.getMaxAnisotropy() : 1);
    if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  let shared = null;
  function kit() {
    if (shared) return shared;
    const g = canvas(128), gx = g.getContext('2d'), gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
    const b = canvas(64), bx = b.getContext('2d'); bx.fillStyle = '#fff'; bx.fillRect(0, 0, 64, 64);
    const br = bx.createRadialGradient(32, 32, 2, 32, 32, 32); br.addColorStop(0, 'rgba(0,0,0,.55)'); br.addColorStop(1, 'rgba(0,0,0,0)'); bx.fillStyle = br; bx.fillRect(0, 0, 64, 64);
    // wall AO: row 0 = top of wall (v=1). floor seam dark, ceiling seam darker line, corners (u=0/1) dark
    const w = canvas(64, 256), wx = w.getContext('2d'); wx.fillStyle = '#fff'; wx.fillRect(0, 0, 64, 256);
    const shade = (x0, y0, x1, y1, a) => { const q = wx.createLinearGradient(x0, y0, x1, y1); q.addColorStop(0, `rgba(0,0,0,${a})`); q.addColorStop(1, 'rgba(0,0,0,0)'); wx.fillStyle = q; wx.fillRect(0, 0, 64, 256); };
    shade(0, 256, 0, 160, 0.5); shade(0, 0, 0, 36, 0.35); shade(0, 0, 4, 0, 0.35); shade(64, 0, 60, 0, 0.35);
    shared = { glow: tex(g, { mip: false }), blob: tex(b, { mip: false }), wallAO: tex(w) };
    Object.values(shared).forEach(t => { t.userData = Object.assign(t.userData || {}, { keep: true }); }); // shared: disposeGroup frees the materials, never these
    return shared;
  }
  LK.blobTex = () => kit().blob; LK.glowTex = () => kit().glow;
  function glowMat(color, opacity) { return (new THREE.MeshBasicMaterial({ map: kit().glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); }
  LK.glowMat = glowMat;

  function pattern(kind, seed) {
    // 256 px = 2 m of floor, grayscale multiplier (~0.8..1)
    const c = canvas(256), x = c.getContext('2d'), rnd = FR.rng(seed); x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
    if (kind === 'tile') {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 222 + Math.floor(rnd() * 30); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i * 128, j * 128, 128, 128);
        for (let k = 0; k < 40; k++) { const s = 200 + Math.floor(rnd() * 55); x.fillStyle = `rgba(${s},${s},${s},.25)`; x.fillRect(i * 128 + rnd() * 120, j * 128 + rnd() * 120, 6 + rnd() * 20, 2 + rnd() * 8); } }
      x.fillStyle = 'rgba(0,0,0,.35)'; for (let i = 0; i <= 2; i++) { x.fillRect(i * 128 - 1, 0, 2, 256); x.fillRect(0, i * 128 - 1, 256, 2); }
    } else if (kind === 'grate') {
      // raised access floor: 0.6 m panels (77 px), a perforated panel every few, bevelled seams
      const p = 256 / 3.33;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 214 + Math.floor(rnd() * 26); x.fillStyle = `rgb(${v},${v},${v + 3})`; x.fillRect(i * p, j * p, p, p);
        if (rnd() < 0.3) { x.fillStyle = 'rgba(0,0,0,.22)'; for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) x.fillRect(i * p + 8 + a * 9.5, j * p + 8 + b * 9.5, 3, 3); } }
      x.fillStyle = 'rgba(0,0,0,.4)'; for (let i = 0; i <= 4; i++) { x.fillRect(i * p - 1, 0, 2, 256); x.fillRect(0, i * p - 1, 256, 2); }
    } else if (kind === 'carpet') {
      // carpet tiles: 0.5 m squares laid quarter-turned (a faint nap stripe alternates), fine speckle
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 226 + Math.floor(rnd() * 16); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i * 64, j * 64, 64, 64);
        x.fillStyle = 'rgba(0,0,0,.05)'; for (let k = 0; k < 8; k++) { if ((i + j) % 2) x.fillRect(i * 64, j * 64 + k * 8, 64, 3); else x.fillRect(i * 64 + k * 8, j * 64, 3, 64); } }
      for (let k = 0; k < 1400; k++) { const s = rnd() < 0.5 ? 0 : 255; x.fillStyle = `rgba(${s},${s},${s},${0.05 + rnd() * 0.08})`; x.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5); }
      x.fillStyle = 'rgba(0,0,0,.14)'; for (let i = 0; i <= 4; i++) { x.fillRect(i * 64 - 0.5, 0, 1, 256); x.fillRect(0, i * 64 - 0.5, 256, 1); }
    } else {
      const pw = 25.6; // 0.2 m planks, staggered butt joints, faint grain
      for (let i = 0; i < 10; i++) { const off = rnd() * 256, v = 205 + Math.floor(rnd() * 45);
        x.fillStyle = `rgb(${v},${v - 4},${v - 8})`; x.fillRect(i * pw, 0, pw, 256);
        for (let k = 0; k < 6; k++) { x.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; x.fillRect(i * pw + rnd() * pw, 0, 1 + rnd() * 2, 256); }
        x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(i * pw, 0, 1.5, 256); x.fillRect(i * pw, off % 256, pw, 2); x.fillRect(i * pw, (off + 128) % 256, pw, 2); }
    }
    return c;
  }

  // ---------- helper wraps ----------
  let building = null, glows = [];
  // glows follow their lamp: a swapped or dimmed material (status lamps, a pulsing button) dims its glow
  function stepGlows() {
    for (let i = 0; i < glows.length; i++) { const sp = glows[i], m = sp.userData.src.material, e = m && m.emissive;
      const k = e ? Math.max(e.r, e.g, e.b) * (m.emissiveIntensity == null ? 1 : m.emissiveIntensity) : 0;
      sp.visible = k > 0.05 && sp.userData.src.visible; if (sp.visible) { sp.material.opacity = 0.55 * Math.min(1, k / 0.8); sp.material.color.copy(e); } }
  }
  // floor look key while its builder runs (set in the loadFloor wrap; the hq:floor bake runs inside it, so it still reads it)
  const _loadFloor = R.loadFloor;
  R.loadFloor = function (id) { building = keyOf(id); try { return _loadFloor.apply(this, arguments); } finally { building = null; } };
  // a builder switches its floor's look before R.room (an empty project floor: FR.look.use('vacant')); no-op outside a build
  LK.use = function (key) { if (building && LOOK[key]) building = key; return lookOf(building || key); };

  const _room = R.room;
  R.room = function (g, w, d, h, colors) {
    const lk = building ? lookOf(building) : null;
    if (lk) colors = Object.assign({}, colors, { floor: lk.floor, wall: lk.wall, ceil: lk.ceil });
    const n0 = g.children.length; const b = _room.call(this, g, w, d, h, colors); const p = g.children.slice(n0);
    g.userData.room = { w, d, h, colors: colors || {}, floor: p[0], ceil: p[1], walls: p.slice(2), rugs: [], baking: !!lk };
    const wm = (new THREE.MeshLambertMaterial({ color: (colors && colors.wall) || 0x5a646e, map: kit().wallAO }));
    p.slice(2).forEach(m => { m.material = wm; });
    return b;
  };
  // flat floor decals added during the build are painted into the floor bake (no mesh, no overdraw).
  // Anything that must change at runtime: add it after load, or make it transparent.
  const _plane = R.plane;
  R.plane = function (g, w, h, color, x, y, z, rx, opts) {
    const room = g && g.userData.room;
    if (room && room.baking && rx === -Math.PI / 2 && y > 0 && y < 0.03 && !(opts && (opts.transparent || opts.emissive))) {
      room.rugs.push({ w, d: h, color: lookOf(building).rugs[color] != null ? lookOf(building).rugs[color] : color, x, z, y }); return new THREE.Mesh();
    }
    return _plane.apply(this, arguments);
  };
  // coloured-text signs get a soft backlight on the wall; dark screens a cool spill
  const _sign = R.sign;
  R.sign = function (g, lines, w, h, x, y, z, ry, opts) {
    const m = _sign.apply(this, arguments); opts = opts || {};
    const col = c => { const v = new THREE.Color(c || '#000'); const mx = Math.max(v.r, v.g, v.b), mn = Math.min(v.r, v.g, v.b); return { s: mx ? (mx - mn) / mx : 0, v: mx }; };
    const fg = col(opts.fg), bg = col(opts.bg || '#0f141a'); let c = null, op = 0.5;
    if (opts.glow !== false && fg.s > 0.45 && fg.v > 0.5) c = new THREE.Color(opts.fg);
    else if (opts.glow !== false && bg.v < 0.12 && w * h > 2) { c = new THREE.Color(0x4f7fd0); op = 0.35; }
    if (c) { const hm = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.3 + 0.4, h * 1.3 + 0.5), glowMat(c, op)); const nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
      hm.position.set(x - nx * 0.012, y, z - nz * 0.012); hm.rotation.y = ry || 0; hm.renderOrder = -1; g.add(hm); m.userData.halo = hm; }
    return m;
  };
  const _person = R.person;
  R.person = function (g) {
    const p = _person.apply(this, arguments); p.userData.person = true;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), (new THREE.MeshBasicMaterial({ map: kit().blob, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, fog: false })));
    b.rotation.x = -Math.PI / 2; b.position.y = 0.035; b.userData.look = 1; p.add(b); return p;
  };

  // ---------- renderer + rig ----------
  const base = { hemi: 1, key: 1, fill: 1, rim: 1, bg: new THREE.Color(0x0a0e13) };
  const _init = R.init;
  R.init = function (el) {
    if (R.renderer) return;
    _init.apply(this, arguments);
    const r = R.renderer; LK.pr = Math.min(window.devicePixelRatio || 1, LK.cap); r.setPixelRatio(LK.pr); r.setSize(window.innerWidth, window.innerHeight);
    R.fill = new THREE.DirectionalLight(0xffffff, 0); R.rim = new THREE.DirectionalLight(0xffffff, 0); R.scene.add(R.fill, R.rim);
    // adaptive resolution: unclamped frame interval EMA, re-evaluated every 2 s; steps of 0.25 between LK.min and LK.cap
    const render = r.render.bind(r); let last = 0, since = 0;
    r.render = function (s, c) {
      const now = performance.now(), dt = last ? now - last : 16; last = now;
      if (dt < 250) { LK.ema += (dt - LK.ema) * 0.05; since += dt; }
      LK.fps = 1000 / LK.ema;
      if (LK.adaptive && since > 2000) { since = 0; const want = LK.ema > 24 ? LK.pr - 0.25 : LK.ema < 14 ? LK.pr + 0.25 : LK.pr;
        const next = Math.max(LK.min, Math.min(want, LK.cap, window.devicePixelRatio || 1)); if (next !== LK.pr) { LK.pr = next; r.setPixelRatio(next); r.setSize(window.innerWidth, window.innerHeight); } }
      stepGlows(); return render(s, c);
    };
  };
  // Dim the floor's light rig (1 = the look's rig, 0.2 = lights out): an incident floor going dark, a strobe. Cheap
  // (four intensities and the background), safe to call every frame from a floor's update(). Resets on every floor load.
  const _bg = new THREE.Color();
  LK.dim = function (k) {
    k = Math.max(0, Math.min(1.5, +k)); if (!(k >= 0)) k = 1; if (k === LK.level || !R.hemi) return; LK.level = k;
    R.hemi.intensity = base.hemi * k; R.sun.intensity = base.key * k; if (R.fill) R.fill.intensity = base.fill * k; if (R.rim) R.rim.intensity = base.rim * k;
    R.scene.background.copy(_bg.copy(base.bg).multiplyScalar(Math.min(1, 0.5 + k / 2)));
  };

  // ---------- per-floor bake (runs after the builder, on hq:floor) ----------
  FR.on('hq:floor', ({ floorId }) => {
    const f = R.current; if (!f || !f.group) return; const g = f.group, room = g.userData.room; const id = building || keyOf(floorId), lk = lookOf(id);
    LK.floor = id; glows = []; LK.level = 1;
    // rig (a floor without a look room keeps its own f.light)
    if (room) {
      R.hemi.color.set(lk.sky); R.hemi.groundColor.set(lk.ground); R.hemi.intensity = lk.hemi;
      [[R.sun, lk.key], [R.fill, lk.fill], [R.rim, lk.rim]].forEach(([l, k]) => { if (!l) return; l.color.set(k[0]); l.intensity = k[1]; l.position.set(k[2], k[3], k[4]); });
      R.scene.background.set(lk.bg);
    }
    base.hemi = R.hemi.intensity; base.key = R.sun.intensity; base.fill = R.fill ? R.fill.intensity : 0; base.rim = R.rim ? R.rim.intensity : 0; base.bg.copy(R.scene.background);
    if (!room) return; room.baking = false;
    g.updateMatrixWorld(true);
    // emissive fixtures: flat boxes near the ceiling are light panels, everything else lit gets a glow sprite
    const panels = [], lamps = []; const wp = new THREE.Vector3();
    g.traverse(o => { const m = o.material; if (!o.isMesh || o.isInstancedMesh || !m || !m.emissive || o.userData.look) return;
      if (Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * (m.emissiveIntensity == null ? 1 : m.emissiveIntensity) < 0.3) return;
      o.getWorldPosition(wp); const gp = o.geometry.parameters || {};
      if (wp.y > room.h - 0.5 && o.geometry.type === 'BoxGeometry' && gp.height < 0.1) panels.push({ x: wp.x, z: wp.z, s: Math.max(gp.width, gp.depth) }); else if (wp.y > 0) lamps.push({ o, p: wp.clone(), s: gp.radiusTop || gp.width || 0.3 }); });
    glows = lamps.map(l => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit().glow, color: l.o.material.emissive.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false }));
      const s = Math.max(0.35, l.s * 3.2); sp.scale.set(s, s, 1); sp.position.copy(l.p); sp.layers.mask = l.o.layers.mask; sp.userData.look = 1; sp.userData.src = l.o; g.add(sp); return sp; });
    // floor: colour x pattern, rugs, edge AO, contact shadows, light pools, window spill -> one 1024^2 texture
    const N = 1024, sx = N / room.w, sz = N / room.d, P = (x, z) => [(x + room.w / 2) * sx, (z + room.d / 2) * sz];
    const c = canvas(N), x = c.getContext('2d');
    x.fillStyle = hex(room.colors.floor || 0x3a4148); x.fillRect(0, 0, N, N);
    const pat = x.createPattern(pattern(lk.pat, FR.hash(id)), 'repeat'); pat.setTransform(new DOMMatrix().scale(2 * sx / 256, 2 * sz / 256));
    x.globalCompositeOperation = 'multiply'; x.fillStyle = pat; x.fillRect(0, 0, N, N); x.globalCompositeOperation = 'source-over';
    room.rugs.sort((a, b) => a.y - b.y).forEach(r => { const [ax, az] = P(r.x - r.w / 2, r.z - r.d / 2); x.fillStyle = hex(r.color); x.fillRect(ax, az, r.w * sx, r.d * sz);
      if (r.w * r.d > 4) { x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 0.08 * sx; x.strokeRect(ax + 0.12 * sx, az + 0.12 * sz, (r.w - 0.24) * sx, (r.d - 0.24) * sz); } });
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { const q = x.createLinearGradient(x0, y0, x1, y1); q.addColorStop(0, 'rgba(0,0,0,.45)'); q.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = q; x.fillRect(rx, ry, rw, rh); };
    const e = 0.9; edge(0, 0, e * sx, 0, 0, 0, e * sx, N); edge(N, 0, N - e * sx, 0, N - e * sx, 0, e * sx, N); edge(0, 0, 0, e * sz, 0, 0, N, e * sz); edge(0, N, 0, N - e * sz, 0, N - e * sz, N, e * sz);
    const box = new THREE.Box3();
    g.traverse(o => { // contact shadows under anything standing on the floor
      if (!o.isMesh || o.isInstancedMesh || o.userData.look || !o.visible || (o.material && o.material.transparent)) return;
      for (let p = o.parent; p && p !== g; p = p.parent) if (p.userData.person) return;
      if (o === room.floor || o === room.ceil || room.walls.includes(o)) return;
      box.setFromObject(o); const hgt = box.max.y - box.min.y, dx = box.max.x - box.min.x, dz = box.max.z - box.min.z;
      if (box.min.y > 0.12 || hgt < 0.12 || dx > 7 || dz > 7 || dx * dz < 0.004) return;
      const a = Math.min(0.7, 0.4 + hgt * 0.15), pad = Math.min(0.45, 0.18 + hgt * 0.12);
      const [ax, az] = P(box.min.x - pad / 2, box.min.z - pad / 2), [bx, bz] = P(box.max.x + pad / 2, box.max.z + pad / 2);
      x.save(); x.shadowColor = `rgba(0,0,0,${a})`; x.shadowBlur = pad * sx; x.shadowOffsetX = 20000; x.fillStyle = '#000'; x.fillRect(ax - 20000, az, bx - ax, bz - az); x.restore();
    });
    x.globalCompositeOperation = 'lighter';
    const pc = lk.panel || '240,244,255';
    panels.forEach(pn => { const [px, pz] = P(pn.x, pn.z), r = 2.3 * sx; const q = x.createRadialGradient(px, pz, 0, px, pz, r); q.addColorStop(0, `rgba(${pc},.15)`); q.addColorStop(1, `rgba(${pc},0)`); x.fillStyle = q; x.fillRect(px - r, pz - r, 2 * r, 2 * r); });
    (lk.spill || []).concat(f.lookSpill || []).forEach(([sx0, sz0, rad, col]) => { const [px, pz] = P(sx0, sz0), r = rad * sx; const q = x.createRadialGradient(px, pz, 0, px, pz, r); q.addColorStop(0, col); q.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = q; x.fillRect(px - r, pz - r, 2 * r, 2 * r); });
    const wv = f.lookWindow !== undefined ? f.lookWindow : lk.window;
    if (wv) { const [, y1] = P(0, wv.z), y0 = y1 - wv.depth * sz; const q = x.createLinearGradient(0, y1, 0, y0); q.addColorStop(0, wv.color); q.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = q; x.fillRect(0, y0, N, y1 - y0);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = 'rgb(120,120,130)'; (wv.mullions || []).forEach(mx => { const [px] = P(mx, 0); x.save(); x.translate(px, y1); x.transform(1, 0, -0.35, 1, 0, 0); x.fillRect(-0.05 * sx, y0 - y1, 0.1 * sx, y1 - y0); x.restore(); }); }
    x.globalCompositeOperation = 'source-over';
    room.floor.material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex(c, { aniso: 4 }) });
    // ceiling: unlit so it never reads as a black void; cove AO + a halo around each panel (canvas top = +z: plane is rotated +PI/2)
    const M = 512, cx = M / room.w, cz = M / room.d, Q = (px, pz) => [(px + room.w / 2) * cx, (room.d / 2 - pz) * cz];
    const cc = canvas(M), y = cc.getContext('2d'); y.fillStyle = hex(room.colors.ceil || 0x2a3036); y.fillRect(0, 0, M, M);
    [[0, 0, 0.8 * cx, 0], [M, 0, M - 0.8 * cx, 0], [0, 0, 0, 0.8 * cz], [0, M, 0, M - 0.8 * cz]].forEach(([a0, b0, a1, b1]) => { const q = y.createLinearGradient(a0, b0, a1, b1); q.addColorStop(0, 'rgba(0,0,0,.5)'); q.addColorStop(1, 'rgba(0,0,0,0)'); y.fillStyle = q; y.fillRect(0, 0, M, M); });
    y.globalCompositeOperation = 'lighter';
    panels.forEach(pn => { const [px, pz] = Q(pn.x, pn.z), r = pn.s * 1.5 * cx; const q = y.createRadialGradient(px, pz, 0, px, pz, r); q.addColorStop(0, `rgba(${pc},.5)`); q.addColorStop(0.35, `rgba(${pc},.2)`); q.addColorStop(1, `rgba(${pc},0)`); y.fillStyle = q; y.fillRect(px - r, pz - r, 2 * r, 2 * r); });
    room.ceil.material = new THREE.MeshBasicMaterial({ color: 0xffffff, map: tex(cc) });
  });
  LK.debug = () => ({ floor: LK.floor, pr: LK.pr, glows: glows.length, frameMs: +LK.ema.toFixed(1), fps: +LK.fps.toFixed(1), adaptive: LK.adaptive, level: LK.level });
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

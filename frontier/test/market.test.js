// 06_market: init shape, rival determinism and curves, trust drift/clamp/mult, rival incidents, the frontier record,
// best()/frontierCap(), DeepField deal offers, wire feed voice and variety, purity.
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')(['01_core.js', '02_sim.js', '06_market.js']);
const M = FR.market, K = M.K;

// small fake for the model module being written in parallel
const skill = (v) => ({ cap: v, safe: v, warnStreak: 0, critStreak: 0, warned: false, incidents: [] });
FR.model = { init: s => { s.model = { skills: { coding: skill(8), reasoning: skill(8), agents: skill(8) }, peakCap: 8 }; } };

const game = (seed) => FR.sim.newGame({ seed: seed || 7 });
const rep = (t) => ({ turn: t, events: [], memo: [], news: [], flows: {} });
// one market week outside the full resolver: step, file the news, advance the turn
function week(s, rng) {
  const r = rep(s.turn); M.step(s, rng, r);
  r.news.forEach(n => s.news.push({ turn: s.turn, text: n.text, kind: n.kind })); if (s.news.length > 60) s.news.splice(0, s.news.length - 60);
  s.turn++; return r;
}
function run(seed, n, each) { const s = game(seed), rng = FR.rng(s.rngState); for (let i = 0; i < n; i++) { const r = week(s, rng); if (each) each(s, r); } return s; }
const setYou = (s, v) => FR.SKILLS.forEach(k => { s.model.skills[k].cap = v; });
const setRival = (s, id, v) => { const r = s.market.rivals.find(x => x.id === id); FR.SKILLS.forEach(k => { r.cap[k] = v; r.safe[k] = v; }); };
function withK(over, fn) { const old = {}; Object.keys(over).forEach(k => { old[k] = K[k]; K[k] = over[k]; }); try { fn(); } finally { Object.assign(K, old); } }
const QUIET = { gainBase: 0, incBase: 0, incSlope: 0, dealChance: 0 };

// ---- init shape (contracts §1) ----
let s = game();
assert.deepStrictEqual(Object.keys(s.market).sort(), ['dealOffer', 'firsts', 'rivals', 'trust']);
assert.strictEqual(s.market.trust, 50); assert.deepStrictEqual(s.market.firsts, []); assert.strictEqual(s.market.dealOffer, null);
assert.deepStrictEqual(s.market.rivals.map(r => r.id), ['opal', 'entropic', 'deepfield', 'zeta']);
assert.deepStrictEqual(s.market.rivals.map(r => r.name), ['Opal AI', 'Entropic', 'DeepField', 'Zeta']);
s.market.rivals.forEach(r => {
  assert.deepStrictEqual(Object.keys(r).sort(), ['cap', 'dealOpen', 'id', 'incidents', 'name', 'safe', 'speed', 'style']);
  assert.deepStrictEqual(Object.keys(r.cap), FR.SKILLS); assert.deepStrictEqual(Object.keys(r.safe), FR.SKILLS);
  assert.strictEqual(r.incidents, 0); assert.strictEqual(r.dealOpen, r.id === 'deepfield');
});
assert.deepStrictEqual(Object.keys(M.DEALS).map(id => M.DEALS[id].kind), ['acquisition', 'distribution', 'compute', 'licence']);

// ---- determinism: same seed, same market and wire; another seed differs ----
const a = run(3, 150), b = run(3, 150), c = run(4, 150);
assert.deepStrictEqual(a.market, b.market); assert.deepStrictEqual(a.news, b.news);
assert.notDeepStrictEqual(a.market.rivals, c.market.rivals);

// ---- trust: drift toward 50, clamp, multiplier ----
withK(QUIET, () => {
  s = game(); const rng = FR.rng(1);
  s.market.trust = 80; week(s, rng); assert.ok(Math.abs(s.market.trust - (80 - 30 * K.trustRevert)) < 1e-9);
  s.market.trust = 20; week(s, rng); assert.ok(Math.abs(s.market.trust - (20 + 30 * K.trustRevert)) < 1e-9);
  for (let i = 0; i < 200; i++) week(s, rng); assert.ok(Math.abs(s.market.trust - 50) < 0.1);
});
s = game(); let r = rep(1);
assert.strictEqual(M.nudgeTrust(s, 80, 'test', r), 50); assert.strictEqual(s.market.trust, 100);
assert.strictEqual(M.nudgeTrust(s, -500, 'test', r), -100); assert.strictEqual(s.market.trust, 0);
assert.strictEqual(M.nudgeTrust(s, 5), 5);                                   // report is optional
assert.deepStrictEqual(r.flows.trust, [{ delta: 50, why: 'test' }, { delta: -100, why: 'test' }]);
[[0, 0.5], [50, 1], [100, 1.5]].forEach(([t, m]) => { s.market.trust = t; assert.strictEqual(M.trustMult(s), m); });

// ---- rival incidents move trust for everyone ----
withK(Object.assign({}, QUIET, { incBase: 10 }), () => {
  s = game(); const t0 = s.market.trust; r = week(s, FR.rng(2));
  assert.strictEqual(r.events.filter(e => e.type === 'market:rivalIncident').length, 4);
  assert.strictEqual(r.news.filter(n => n.kind === 'incident').length, 4);
  assert.ok(s.market.rivals.every(x => x.incidents === 1));
  const lost = t0 - s.market.trust; assert.ok(lost >= 4 * K.incTrust[0] && lost <= 4 * K.incTrust[1], 'trust lost ' + lost);
});

// ---- frontier record: once per mark; player / rival / same-week tie-breaks ----
withK(QUIET, () => {
  s = game(); const rng = FR.rng(5);
  M.ORDER.forEach(id => setRival(s, id, 20)); setYou(s, 31);
  r = week(s, rng);
  assert.deepStrictEqual(s.market.firsts, [{ mark: 30, turn: 1, by: 'player' }]);
  assert.strictEqual(s.stats.firstsWon, 1); assert.ok(r.news.some(n => n.kind === 'record'));
  assert.deepStrictEqual(r.events.filter(e => e.type === 'market:first'), [{ type: 'market:first', mark: 30, by: 'player' }]);
  assert.ok(r.memo.some(m => m.kind === 'good' && /^Record 30 set/.test(m.text)));
  r = week(s, rng); assert.strictEqual(s.market.firsts.length, 1); assert.ok(!r.events.some(e => e.type === 'market:first'));
  setRival(s, 'zeta', 46); setYou(s, 40); r = week(s, rng);
  assert.deepStrictEqual(s.market.firsts[1], { mark: 45, turn: 3, by: 'zeta' });
  assert.strictEqual(s.stats.firstsLost, 1); assert.ok(r.memo.some(m => m.kind === 'flag' && /Record 45 lost to Zeta/.test(m.text)));
  setRival(s, 'opal', 62); setYou(s, 61); week(s, rng); assert.strictEqual(s.market.firsts[2].by, 'opal');   // higher avg wins the week
  setRival(s, 'opal', 75); setYou(s, 75); week(s, rng); assert.strictEqual(s.market.firsts[3].by, 'player'); // a tie goes to the player
  setRival(s, 'deepfield', 95); r = week(s, rng); assert.strictEqual(s.market.firsts[4].by, 'deepfield');
  for (let i = 0; i < 5; i++) week(s, rng);
  assert.deepStrictEqual(s.market.firsts.map(f => f.mark), K.marks); assert.strictEqual(s.stats.firstsWon, 2); assert.strictEqual(s.stats.firstsLost, 3);
});

// ---- best() and frontierCap() ----
s = game(); setRival(s, 'opal', 30); setRival(s, 'entropic', 44); setRival(s, 'deepfield', 40); setRival(s, 'zeta', 10);
s.market.rivals[2].cap.reasoning = 70;                        // DeepField: avg (40+70+40)/3 = 50
assert.deepStrictEqual(M.best(s), { rivalId: 'deepfield', avgCap: 50 });
assert.strictEqual(M.frontierCap(s, 'reasoning'), 70); assert.strictEqual(M.frontierCap(s, 'coding'), 44);
s.model.skills.coding.cap = 81; assert.strictEqual(M.frontierCap(s, 'coding'), 81);  // the player counts
assert.strictEqual(FR.sim.atFrontier(s), false);
setYou(s, 51); assert.strictEqual(FR.sim.atFrontier(s), true);

// ---- DeepField compute-share offer: shape, timing, expiry, not while a deal runs ----
withK(Object.assign({}, QUIET, { dealChance: 1 }), () => {
  s = game(); const rng = FR.rng(9);
  s.turn = K.dealFirst - 1; week(s, rng); assert.strictEqual(s.market.dealOffer, null);
  r = week(s, rng); const o = s.market.dealOffer, at = s.turn - 1;
  assert.deepStrictEqual(Object.keys(o).sort(), ['expires', 'kind', 'pf', 'revShare', 'rivalId', 'turns']);
  assert.strictEqual(o.rivalId, 'deepfield'); assert.strictEqual(o.kind, 'compute'); assert.strictEqual(o.turns, K.dealTurns);
  assert.strictEqual(o.expires, at + K.dealExpire); assert.ok(o.pf > 0 && o.pf % 5 === 0);
  assert.ok(o.revShare >= 0.1 && o.revShare <= 0.2); assert.ok(r.memo.some(m => m.kind === 'due' && /^DeepField offers/.test(m.text)));
  while (s.turn < o.expires) { week(s, rng); assert.deepStrictEqual(s.market.dealOffer, o); }   // open through its last week
  r = week(s, rng); assert.strictEqual(s.market.dealOffer, null); assert.ok(r.memo.some(m => /^Offer lapsed/.test(m.text)));
  s.compute = { deals: [{ rivalId: 'deepfield', kind: 'compute', pf: 40, revShare: 0.1, ends: 999 }] };
  for (let i = 0; i < 20; i++) week(s, rng); assert.strictEqual(s.market.dealOffer, null);
  s.compute.deals = []; week(s, rng); assert.strictEqual(s.market.dealOffer.rivalId, 'deepfield');
});

// ---- curves over 6 years, incidents by style, the wire ----
const best130 = [], best300 = [], inc = {}, texts = new Set(); let weeks = 0;
for (let seed = 1; seed <= 10; seed++) {
  run(seed, 312, (st, rp) => {
    weeks++;
    if (st.turn === 131) best130.push(M.best(st).avgCap);
    if (st.turn === 301) best300.push(M.best(st).avgCap);
    const e = st.market.rivals[1]; FR.SKILLS.forEach(k => assert.ok(e.safe[k] >= e.cap[k], 'Entropic safe below cap'));
    assert.ok(rp.news.length >= K.newsMin);
    rp.news.forEach(n => { assert.ok(!/!/.test(n.text) && /\.$/.test(n.text), n.text); assert.ok(!/\{\w+\}/.test(n.text), n.text); texts.add(n.text); });
    rp.memo.forEach(m => assert.ok(!/!/.test(m.text) && /\.$/.test(m.text), m.text));
  }).market.rivals.forEach(x => { inc[x.id] = (inc[x.id] || 0) + x.incidents; });
}
const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
assert.ok(mean(best130) > 52 && mean(best130) < 70, 'best rival at week 130: ' + mean(best130));
assert.ok(mean(best300) > 82 && mean(best300) < 97, 'best rival at week 300: ' + mean(best300));
assert.ok(inc.opal > inc.zeta && inc.zeta > inc.deepfield && inc.deepfield >= inc.entropic, JSON.stringify(inc));
assert.ok(M.NEWS.length >= 40 && texts.size > 1000);

// ---- purity and debug ----
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '06_market.js'), 'utf8');
['Math.random', 'Date.now', 'document.', 'localStorage', 'performance.', 'FR.emit', 'FR.on('].forEach(w => assert.ok(src.indexOf(w) < 0, w));
const d = M.debug(run(1, 60));
assert.ok(typeof d.trust === 'number' && typeof d.best === 'string' && typeof d.opal.avg === 'number');

console.log('market ok: best rival ' + mean(best130).toFixed(0) + ' at week 130, ' + mean(best300).toFixed(0) + ' at week 300; incidents ' + JSON.stringify(inc));

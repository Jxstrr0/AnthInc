// 03_model: init shape, training (spillover, drift, diminishing returns), safety spread and lead cap, the ladder.
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')(['01_core.js', '02_sim.js', '03_model.js']);
const M = FR.model, K = M.K;
let trustLog = [];
FR.market = { nudgeTrust: (s, d, why) => { trustLog.push(d); s.market.trust += d; } };   // stub for the market module
const YES = Object.assign(() => 0, { chance: () => true, range: (a, b) => (a + b) / 2 });
const NO = Object.assign(() => 0.99, { chance: () => false, range: (a, b) => (a + b) / 2 });
const rep = () => ({ turn: 0, events: [], memo: [], news: [], flows: {} });
const alloc = (tpf, spf, staff) => ({ training: { pf: tpf, staff: staff || 0 }, safety: { pf: spf, staff: staff || 0 } });
function fresh(turn) {
  const s = { turn: turn || 1, status: 'playing', end: null, lab: { name: 'Test Lab' }, money: { cash: 10e6 }, market: { trust: 50 },
    stats: { incidents: 0, warnings: 0 } };
  M.init(s, FR.rng(1)); return s;
}
const set = (s, k, cap, safe) => { s.model.skills[k].cap = cap; s.model.skills[k].safe = safe; };
const turn = (s, rng) => { const r = rep(); M.ladder(s, rng, r); if (s.status === 'playing') s.turn++; return r; };

// init: exactly the §1 shape
{ const s = fresh();
  assert.deepStrictEqual(Object.keys(s.model).sort(), ['peakCap', 'skills']);
  assert.deepStrictEqual(Object.keys(s.model.skills), FR.SKILLS);
  assert.deepStrictEqual(s.model.skills.agents, { cap: 8, safe: 8, warnStreak: 0, critStreak: 0, warned: false, incidents: [] });
  assert.strictEqual(s.target, 'coding'); assert.strictEqual(s.model.peakCap, 8);
  assert.ok(FR.sim.newGame({ seed: 3 }).model.skills.coding); }

// warning: gap > 10 for 2 turns, once per episode, re-arms at gap <= 10
{ const s = fresh(); set(s, 'agents', 46, 31);
  let r = turn(s, NO); assert.strictEqual(r.events.length, 0); assert.strictEqual(s.stats.warnings, 0);
  r = turn(s, NO); assert.deepStrictEqual(r.events, [{ type: 'model:warning', skill: 'agents', gap: 15 }]);
  assert.strictEqual(r.memo[0].text, 'Agents: capability 46, safety 31. Gap 15, second week above 10. Safety review requested.');
  assert.strictEqual(r.memo[0].kind, 'flag');
  r = turn(s, NO); assert.strictEqual(r.events.length, 0); assert.strictEqual(s.stats.warnings, 1);
  set(s, 'agents', 46, 36); turn(s, NO); assert.strictEqual(s.model.skills.agents.warned, false);
  set(s, 'agents', 46, 31.5); turn(s, NO); r = turn(s, NO); assert.strictEqual(r.events[0].type, 'model:warning'); assert.strictEqual(s.stats.warnings, 2);
  set(s, 'coding', 20.4, 10); turn(s, NO); r = turn(s, NO); assert.ok(r.memo.some(m => m.text.includes('Gap 10.4, second week above 10')), 'gap shows decimals at a threshold'); }

// incident only above 20; costs cash and trust; news + event + record
{ const s = fresh(); set(s, 'coding', 40, 20);
  for (let i = 0; i < 5; i++) turn(s, YES);
  assert.strictEqual(s.stats.incidents, 0); assert.deepStrictEqual(s.model.skills.coding.incidents, []);
  set(s, 'coding', 40, 19.5); trustLog = []; const t = s.turn; const r = turn(s, YES);
  const cost = K.incidentCash + 10e6 * K.incidentCashPct;
  assert.strictEqual(s.money.cash, 10e6 - cost); assert.deepStrictEqual(trustLog, [-K.incidentTrust]);
  assert.deepStrictEqual(s.model.skills.coding.incidents, [t]); assert.strictEqual(s.stats.incidents, 1);
  assert.ok(r.events.some(e => e.type === 'model:incident' && e.skill === 'coding' && e.cost === cost));
  assert.ok(r.news.some(n => n.kind === 'incident'));
  assert.strictEqual(M.incidentChance(20), 0); assert.ok(Math.abs(M.incidentChance(25) - (K.incidentBase + 5 * K.incidentSlope)) < 1e-12);
  assert.strictEqual(M.outlook(s, 'coding').level, 'warning'); }

// final after exactly 4 turns above 30, with a countdown in the memo; resets if the gap closes
{ const s = fresh(); set(s, 'agents', 70, 36);
  const want = ['Final incident in 3 weeks', 'Final incident in 2 weeks', 'Final incident next week'];
  for (let i = 0; i < 3; i++) { const r = turn(s, NO); assert.strictEqual(s.status, 'playing');
    assert.ok(r.memo.some(m => m.text.includes(want[i])), want[i]); assert.strictEqual(M.outlook(s, 'agents').turnsToFinal, 3 - i); }
  set(s, 'agents', 70, 40); turn(s, NO); assert.strictEqual(s.model.skills.agents.critStreak, 0);
  set(s, 'agents', 70, 36); for (let i = 0; i < 3; i++) turn(s, NO); assert.strictEqual(s.status, 'playing');
  const t = s.turn, r = turn(s, NO);
  assert.strictEqual(s.status, 'dead'); assert.strictEqual(s.end.cause, 'final'); assert.strictEqual(s.end.skill, 'agents'); assert.strictEqual(s.end.turn, t);
  assert.ok(r.events.some(e => e.type === 'model:final' && e.skill === 'agents')); assert.ok(s.end.text.length > 10); }

// third incident on a skill within 52 turns ends the run; one outside the window does not
{ const s = fresh(80); set(s, 'reasoning', 45, 22); s.model.skills.reasoning.incidents = [29, 60]; s.model.skills.reasoning.warned = true;
  const r = turn(s, YES); assert.strictEqual(s.status, 'dead'); assert.strictEqual(s.end.skill, 'reasoning');
  assert.ok(/third incident in 52 weeks/.test(s.end.text));
  const s2 = fresh(81); set(s2, 'reasoning', 45, 22); s2.model.skills.reasoning.incidents = [29, 60]; s2.model.skills.reasoning.warned = true;
  const r2 = turn(s2, YES); assert.strictEqual(s2.status, 'playing'); assert.deepStrictEqual(s2.model.skills.reasoning.incidents, [29, 60, 81]);
  // after the roll at 81, incidents 60 and 81 count through turn 111; the memo says one more ends the lab
  assert.ok(r2.memo.some(m => m.text.includes('2 incidents in the past 52 weeks. One more by ' + FR.dateLabel(111) + ' ends the lab.')));
  assert.strictEqual(M.outlook(s2, 'reasoning').level, 'critical'); }

// warnings come first: a gap that jumps past 20 unwarned is warned that week and rolls only from the next
{ const s = fresh(); set(s, 'coding', 30, 21); turn(s, YES); set(s, 'coding', 40, 18);
  let r = turn(s, YES); assert.deepStrictEqual(r.events.map(e => e.type), ['model:warning']); assert.strictEqual(s.stats.incidents, 0);
  assert.ok(r.memo.some(m => /Gap 22, incident risk \d+% a week\. Safety review requested\.$/.test(m.text)));
  r = turn(s, YES); assert.deepStrictEqual(r.events.map(e => e.type), ['model:incident']); }
// two incidents inside the year: the memo flags it every week even with the gap in hand
{ const s = fresh(40); set(s, 'reasoning', 30, 21); s.model.skills.reasoning.incidents = [30, 35];
  const r = turn(s, NO); assert.ok(r.memo.some(m => m.kind === 'flag' && m.text === 'Reasoning: 2 incidents in the past 52 weeks. One more by ' + FR.dateLabel(81) + ' ends the lab.')); }
// pressure is the weighted sum of the gaps
{ const s = fresh(); FR.SKILLS.forEach(k => set(s, k, 20, 10)); assert.strictEqual(M.pressure(s), 10 * (K.weights.coding + K.weights.reasoning + K.weights.agents)); }
// weights: agents > reasoning = coding; incident odds and trust cost scale with the weight
{ const W = K.weights; assert.ok(W.agents > W.reasoning && W.reasoning === W.coding);
  assert.ok(Math.abs(M.incidentChance(25, 'agents') - W.agents * M.incidentChance(25)) < 1e-12);
  assert.strictEqual(M.incidentChance(25, 'coding'), M.incidentChance(25)); assert.strictEqual(M.incidentChance(20, 'agents'), 0);
  assert.strictEqual(M.incidentChance(80, 'agents'), 1);
  assert.strictEqual(M.incidentTrust('agents'), K.incidentTrust * W.agents); assert.strictEqual(M.incidentTrust('coding'), K.incidentTrust);
  const s = fresh(); set(s, 'agents', 40, 19.5); s.model.skills.agents.warned = true; trustLog = [];
  const r = turn(s, YES), t = K.incidentTrust * W.agents;
  assert.deepStrictEqual(trustLog, [-t]); assert.strictEqual(r.events.find(e => e.type === 'model:incident').trust, t);
  assert.ok(r.memo.some(m => m.text.includes(' and ' + t + ' points of public trust.')));
  assert.ok(M.outlook(s, 'agents').text.includes('incident risk ' + Math.round(M.incidentChance(20.5, 'agents') * 100) + '% a week')); }
// the pressure gauge: bands on the weighted sum, never calmer than the worst skill's outlook
{ const s = fresh(), P = () => M.pressureLevel(s), B = K.pressureBands;
  assert.deepStrictEqual(P(), { value: 0, level: 'ok', text: 'Pressure 0, in hand. Safety is at or above capability on every skill.' });
  set(s, 'coding', 12, 8); set(s, 'agents', 12, 9);   // 4 + 3 × 1.5
  assert.deepStrictEqual(P(), { value: 8.5, level: 'ok', text: 'Pressure 9, in hand. Agents carries the most: gap 3 at weight 1.5.' });
  set(s, 'agents', 18, 8); assert.strictEqual(P().value, 4 + 15); assert.strictEqual(P().level, 'watch');   // agents gap 10 → 15 alone
  assert.strictEqual(P().text, 'Pressure 19, watch. Agents carries the most: gap 10 at weight 1.5.');
  set(s, 'coding', 13, 8); set(s, 'reasoning', 13, 8); set(s, 'agents', 8 + 10 / 3, 8); assert.strictEqual(P().value, B[0]); assert.strictEqual(P().level, 'ok', 'at the band is not above it (every gap at or below the watch line)');
  set(s, 'coding', 8, 8); set(s, 'reasoning', 8, 8); set(s, 'agents', 18, 8); assert.strictEqual(P().level, 'watch', 'a skill gap above 5 shows watch');
  set(s, 'agents', 30.1, 8); assert.strictEqual(P().level, 'warning'); set(s, 'agents', 40, 8); assert.strictEqual(P().level, 'critical');
  set(s, 'agents', 8, 8); set(s, 'coding', 29, 8); assert.strictEqual(P().value, 21); assert.strictEqual(P().level, 'warning', 'coding gap 21 alone is past the incident line');
  set(s, 'coding', 40, 8); assert.strictEqual(P().level, 'critical'); assert.strictEqual(P().value, 32);
  set(s, 'coding', 23.4, 8); assert.ok(/^Pressure 15\.4, watch\./.test(P().text), P().text);   // a decimal when rounding would cross a band
  set(s, 'coding', 8.4, 8); assert.strictEqual(P().text, 'Pressure 0.4, in hand. Coding carries the most: gap 0.4 at weight 1.');   // and under 1
  set(s, 'coding', 30.4, 10); assert.ok(P().text.endsWith('gap 20.4 at weight 1.'), P().text);
  assert.strictEqual(M.debug(s).pressureLevel, P().level); }

// safety: spread toward the biggest gap, never above cap + safeLead (training, spread and boost)
{ const s = fresh(); set(s, 'coding', 30, 10); set(s, 'reasoning', 30, 28); set(s, 'agents', 30, 28);
  const g = M.gains(s, alloc(0, 50, 5));
  assert.ok(g.safe.coding > g.safe.reasoning * 2, 'weighted toward the gap'); assert.strictEqual(g.cap.coding, 0);
  M.train(s, alloc(0, 5e6, 5000), NO, rep());
  FR.SKILLS.forEach(k => assert.ok(s.model.skills[k].safe <= s.model.skills[k].cap + K.safeLead + 1e-9));
  assert.ok(Math.abs(s.model.skills.coding.safe - 33) < 1e-9, 'huge safety output fills to the lead cap');
  const b = M.boost(s, 'agents', { safe: 50 }); assert.strictEqual(s.model.skills.agents.safe, 33); assert.ok(b.safe <= 3);
  M.boost(s, 'agents', { cap: -10 }); assert.strictEqual(s.model.skills.agents.safe, 23);
  M.boost(s, 'agents', { cap: 500 }); assert.strictEqual(s.model.skills.agents.cap, 100); }

// training: diminishing returns near 100, ~25% spillover, drift
{ const s = fresh(), a = alloc(40, 0, 10);
  const g10 = (set(s, 'coding', 10, 10), M.gains(s, a)), g50 = (set(s, 'coding', 50, 50), M.gains(s, a)).cap.coding, g90 = (set(s, 'coding', 90, 90), M.gains(s, a)).cap.coding;
  assert.ok(g10.cap.coding > g50 && g50 > g90 && g90 < g10.cap.coding * 0.05, 'last points are expensive');
  set(s, 'coding', 8, 8); const g = M.gains(s, a);
  assert.ok(Math.abs(g.cap.reasoning / g.cap.coding - K.spill) < 1e-9);
  assert.ok(Math.abs(g.safe.coding + g.cap.coding * K.drift) < 1e-9, 'drift = fraction of the gain');
  const before = FR.clone(s.model); M.gains(s, a); assert.deepStrictEqual(s.model, before, 'gains does not mutate');
  const r = rep(); M.train(s, a, YES, r);   // YES.range gives noise 1, so train matches the forecast
  FR.SKILLS.forEach(k => assert.ok(Math.abs(s.model.skills[k].cap - before.skills[k].cap - g.cap[k]) < 1e-9));
  assert.strictEqual(r.memo[0].kind, 'change'); }

// pressure weights agents highest
{ const s = fresh(); set(s, 'agents', 30, 20); const pa = M.pressure(s); set(s, 'agents', 8, 8); set(s, 'coding', 30, 20);
  assert.ok(pa > M.pressure(s)); }

// determinism with a fixed rng; no impure calls in the source
{ const play = () => { const s = fresh(), rng = FR.rng(1234), a = { training: { pf: 200, staff: 40 }, safety: { pf: 5, staff: 2 } }; const log = [];
    for (let i = 0; i < 60 && s.status === 'playing'; i++) { const r = rep(); s.target = FR.SKILLS[i % 3]; M.train(s, a, rng, r); M.ladder(s, rng, r); log.push(r); s.turn++; }
    return { s, log }; };
  const x = play(), y = play(); assert.deepStrictEqual(x.s, y.s); assert.deepStrictEqual(x.log, y.log);
  assert.ok(x.s.stats.incidents > 0 || x.s.status === 'dead', 'the race line reaches the ladder');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '03_model.js'), 'utf8').split('\n').slice(2).join('\n');
  assert.ok(!/document|localStorage|Date\.now|Math\.random|performance|FR\.emit|window\./.test(src.replace(/typeof window[^\n]*$/m, ''))); }

// the incident line names the rule that ends the lab: the first names the third-incident rule, the second the gap that stops the rolls
{ const s = fresh(40); set(s, 'agents', 40, 18); s.model.skills.agents.warned = true;
  let r = turn(s, YES); const l1 = r.memo.find(m => /incident at gap/.test(m.text)).text;
  assert.ok(l1.endsWith(' A third Agents incident within 52 weeks ends the lab.'), l1);
  if (s.status === 'playing') { r = turn(s, YES); const l2 = r.memo.find(m => /incident at gap/.test(m.text)).text;
    assert.ok(l2.endsWith(' Incident odds fall to zero once the gap is 20 or below.'), l2); } }
// the training line shows capability to one decimal, like the Due line beside it
{ const s = fresh(); set(s, 'coding', 19.2, 19.2); const r = rep(); M.train(s, alloc(200, 0, 20), YES, r);
  const line = r.memo.find(m => /^Training on Coding/.test(m.text)).text, c = FR.round(s.model.skills.coding.cap, 1);
  assert.ok(line.startsWith('Training on Coding: capability ' + c + ','), line); }

// debug returns plain numbers
{ const d = M.debug(fresh()); assert.strictEqual(d.coding.cap, 8); assert.strictEqual(d.agents.level, 'ok'); }
console.log('model ok');

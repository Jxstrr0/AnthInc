// Full sim, all modules wired: long runs stay finite and in range, determinism, save-code round trip, applyCommands and
// forecast purity, command memo/event forwarding, and every ending (final incident, bankruptcy, a scripted win).
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')();
const S = FR.sim, SK = FR.SKILLS;
const J = (s) => JSON.stringify(s);
const game = (seed) => S.newGame({ seed });
const ev = (s, type) => s.lastReport.events.filter(e => e.type === type);

// every number finite, nothing undefined, anywhere in the state
function scan(o, p, bad) {
  if (o === undefined) bad.push(p + ' undefined');
  else if (typeof o === 'number' && !isFinite(o)) bad.push(p + ' ' + o);
  else if (o && typeof o === 'object') for (const k in o) scan(o[k], p + '.' + k, bad);
  return bad;
}
function check(s, was) {
  const bad = scan(s, 's', []), cap = FR.compute.capacity(s);
  assert.deepStrictEqual(bad.slice(0, 3), [], 'turn ' + s.turn);
  assert.ok(cap.total >= 0 && cap.owned >= 0 && cap.rented >= 0, 'capacity ' + J(cap));
  assert.strictEqual(FR.ALLOCS.reduce((t, k) => t + s.sliders[k], 0), 100);
  assert.ok(s.market.trust >= 0 && s.market.trust <= 100 && s.staff.headcount >= FR.money.K.minHead);
  SK.forEach(k => { const x = s.model.skills[k]; assert.ok(x.cap >= 0 && x.cap <= 100 && x.safe >= 0 && x.safe <= x.cap + FR.model.K.safeLead + 1e-9, k + ' ' + J(x)); });
  assert.ok(s.news.length <= S.K.newsKeep && s.history.length <= S.K.historyKeep);
  s.memo.lines.forEach(m => assert.ok(typeof m.text === 'string' && m.text.length && /^(change|flag|due|good)$/.test(m.kind), J(m)));
  assert.strictEqual(s.turn, s.status === 'playing' ? was.turn + 1 : was.turn);
  // cash math: the week's change is net + project payouts − incident bills; money charges exactly the compute and project bills
  const r = s.lastReport, f = r.flows;
  assert.strictEqual(r.deltas.cash, f.money.net + (f.projectPayout || 0) - (f.incidentCost || 0), 'cash turn ' + r.turn);
  assert.strictEqual(f.money.compute, f.compute.bill); assert.strictEqual(f.money.projects, f.projects.cash);
}

// random but valid-looking commands from the live board, drawn from a separate rng
function randomCmds(s, r) {
  const c = [], pick = (a) => a.length ? r.pick(a) : {};
  for (let i = r.int(0, 3); i > 0; i--) {
    const t = r.pick(['sliders', 'target', 'rent', 'buy', 'hire', 'layoff', 'greenlight', 'cancel', 'acceptRound', 'declineRound', 'acceptDeal', 'declineDeal', 'endDeal', 'bogus']);
    if (t === 'sliders') c.push({ type: t, training: r.int(0, 60), serving: r.int(0, 60), safety: r.int(0, 60), research: r.int(0, 60) });
    else if (t === 'target') c.push({ type: t, skill: r.pick(SK) });
    else if (t === 'rent') c.push({ type: t, pf: r.int(0, 150) });
    else if (t === 'buy') c.push({ type: t, offerId: pick(s.compute.offers).id });
    else if (t === 'hire' || t === 'layoff') c.push({ type: t, n: r.int(1, 8) });
    else if (t === 'greenlight') c.push({ type: t, offerId: pick(s.projects.offers).id });
    else if (t === 'cancel') c.push({ type: t, uid: pick(s.projects.active).uid });
    else if (t === 'endDeal') c.push({ type: t, rivalId: 'deepfield' });
    else c.push({ type: t });
  }
  return c;
}
// keeps a random run alive to 400 turns: tops up cash, pins gaps under the incident line, never lets the hold reach a win
function rescue(s) {
  if (s.money.cash < 15e6 + Math.max(0, ...s.compute.offers.map(o => o.cost))) s.money.cash += 40e6;   // room for a cluster buy and a costly week
  SK.forEach(k => { const x = s.model.skills[k]; if (x.cap - x.safe > 15) x.safe = x.cap - 8; });
  s.win.streak = 0;
  return s;
}

// 1. long runs: 10 seeds, do-nothing until the run ends, and random commands (with the rescue) for 400 turns
let longest = 0, ends = {};
for (let seed = 1; seed <= 10; seed++) {
  let s = game(seed);
  for (let t = 0; t < 400 && s.status === 'playing'; t++) { const was = s; s = S.endTurn(s, []); check(s, was); }
  ends[s.end.cause] = (ends[s.end.cause] || 0) + 1;
  s = game(seed); const r = FR.rng(seed * 7919);
  for (let t = 0; t < 400 && s.status === 'playing'; t++) { const was = rescue(s); s = S.endTurn(was, randomCmds(was, r)); check(s, was); }
  assert.strictEqual(s.status, 'playing'); longest = Math.max(longest, s.turn - 1);
}
assert.strictEqual(longest, 400);
assert.deepStrictEqual(Object.keys(ends), ['cash'], 'a lab that does nothing runs out of cash');

// 2. determinism: same seed and commands give the same JSON, turn by turn
function scripted(seed, n) {
  let s = game(seed); const r = FR.rng(99), states = [];
  for (let t = 0; t < n && s.status === 'playing'; t++) { s = S.endTurn(rescue(s), randomCmds(s, r)); states.push(J(s)); }
  return states;
}
const A = scripted(4, 150), B = scripted(4, 150);
assert.strictEqual(A.length, 150); assert.ok(A.every((x, i) => x === B[i]), 'same seed, same commands, same state');
assert.notStrictEqual(J(scripted(5, 3)[2]), J(A[2]), 'a different seed plays differently');

// 3. save code round trip: export at turn 60, import, continue 40 turns; identical to the uninterrupted run
{ const cmds = [], r = FR.rng(123); let s = game(8), mid = null;
  for (let t = 0; t < 100; t++) {
    if (t === 60) mid = FR.save.exportCode(s);
    const c = randomCmds(rescue(s), r); cmds.push(c); s = S.endTurn(s, c);
  }
  let t2 = FR.save.importCode(mid); assert.ok(t2 && t2.turn === 61);
  for (let t = 60; t < 100; t++) t2 = S.endTurn(rescue(t2), cmds[t]);
  const strip = (x) => Object.assign({}, x, { history: null, news: x.news.filter(n => n.turn > 60) });
  assert.strictEqual(J(strip(t2)), J(strip(s)));
  assert.ok(FR.save.write(2, s) && J(FR.save.read(2).model) === J(s.model), 'slot save round trip'); }

// 4. applyCommands is pure and does not advance time
{ const s = game(2), before = J(s);
  const r = S.applyCommands(s, [{ type: 'sliders', training: 10, serving: 10, safety: 70, research: 10 }, { type: 'rent', pf: 55 }, { type: 'acceptRound' }, { type: 'nope' }]);
  assert.strictEqual(J(s), before, 'input state untouched');
  assert.deepStrictEqual(r.results.map(x => x.ok), [true, true, true, false]);
  const n = r.state;
  assert.strictEqual(n.turn, s.turn); assert.strictEqual(n.rngState, s.rngState); assert.strictEqual(J(n.market), J(s.market)); assert.strictEqual(J(n.model), J(s.model));
  assert.strictEqual(n.compute.rentPF, 55); assert.strictEqual(n.sliders.safety, 70); assert.strictEqual(n.money.cash, s.money.cash + s.money.offer.amount);
  // a command's memo line waits for the weekly memo; its event rides on the result
  assert.strictEqual(r.results[2].event.type, 'money:round');
  assert.ok(n.pendingMemo.some(m => /^Seed round closed/.test(m.text)));
  const viaApply = S.endTurn(n, []), viaEnd = S.endTurn(s, [{ type: 'sliders', training: 10, serving: 10, safety: 70, research: 10 }, { type: 'rent', pf: 55 }, { type: 'acceptRound' }]);
  assert.ok(viaApply.memo.lines.some(m => /^Seed round closed/.test(m.text)) && viaEnd.memo.lines.some(m => /^Seed round closed/.test(m.text)));
  assert.strictEqual(ev(viaEnd, 'money:round').length, 1); assert.strictEqual(viaApply.pendingMemo.length, 0);
  assert.strictEqual(ev(viaApply, 'money:round').length, 1, 'an event from a command applied at once rides on the next End Turn');
  assert.deepStrictEqual(viaApply.pendingEvents, []);
  const strip = (x) => Object.assign({}, x, { lastReport: null });
  assert.strictEqual(J(strip(viaApply)), J(strip(viaEnd)), 'applied now or at End Turn, the week resolves the same');
  assert.strictEqual(S.endTurn(Object.assign(FR.clone(s), { status: 'dead' }), []).turn, s.turn, 'a finished run does not move'); }

// 5. forecast has no side effects and matches the money module's own numbers
{ let s = game(3); for (let t = 0; t < 20; t++) s = S.endTurn(s, t ? [] : [{ type: 'acceptRound' }, { type: 'rent', pf: 60 }]);
  const before = J(s), f = S.forecast(s), g = S.forecast(s);
  assert.strictEqual(J(s), before); assert.deepStrictEqual(f, g);
  assert.ok([f.capacity, f.revenue, f.burn, f.net].every(isFinite) && f.capacity > 0 && f.burn > 0);
  assert.strictEqual(f.burn, FR.money.burnEstimate(s)); assert.strictEqual(f.net, f.revenue - f.burn);
  SK.forEach(k => assert.ok(f.capGain[k] >= 0 && isFinite(f.safeGain[k])));
  const next = S.endTurn(s, []);
  assert.strictEqual(next.money.burn, f.burn, 'no hires, projects or incidents: the burn forecast is exact'); }

// 6. the ladder can kill a run: a sustained gap above 30 ends it on the 4th week, with the countdown in the memo
{ let s = S.applyCommands(game(6), [{ type: 'acceptRound' }, { type: 'sliders', training: 90, serving: 10, safety: 0, research: 0 }, { type: 'target', skill: 'agents' }]).state;
  s.model.skills.agents.cap = 60; s.model.skills.agents.safe = 22;
  const texts = [];
  for (let t = 0; t < 10 && s.status === 'playing'; t++) { s = S.endTurn(s, []); texts.push(s.memo.lines.map(m => m.text).join(' ')); }
  assert.strictEqual(s.status, 'dead'); assert.strictEqual(s.end.cause, 'final'); assert.strictEqual(s.end.skill, 'agents');
  assert.ok(ev(s, 'model:final').length === 1 && ev(s, 'run:dead')[0].cause === 'final');
  assert.ok(texts.some(x => /Final incident in 3 weeks unless the gap falls to 30 or below/.test(x)), 'countdown shown');
  assert.ok(s.model.skills.agents.critStreak >= 4 || s.model.skills.agents.incidents.length >= 3); }

// 7. bankruptcy can kill a run, at the money step or when an incident bill empties the bank after it
{ let s = game(9); s.money.cash = 1000;
  s = S.endTurn(s, [{ type: 'declineRound' }]);
  assert.strictEqual(s.status, 'dead'); assert.strictEqual(s.end.cause, 'cash'); assert.strictEqual(ev(s, 'money:bankrupt').length, 1);
  assert.ok(s.money.cash <= 0 && ev(s, 'run:dead')[0].cause === 'cash'); assert.strictEqual(S.score(s).parts[0].value, s.turn);
  let t = S.applyCommands(game(9), [{ type: 'declineRound' }, { type: 'sliders', training: 50, serving: 0, safety: 0, research: 50 }]).state;
  t.model.skills.coding.cap = 90; t.model.skills.coding.safe = 20; t.model.skills.coding.warned = true;   // incident chance 100%
  t.money.cash = FR.money.burnEstimate(t) + 1000;                        // survives the money step, not the incident bill
  t = S.endTurn(t, []);
  assert.ok(ev(t, 'model:incident').length === 1 && t.lastReport.flows.money.cash > 0);
  assert.strictEqual(t.status, 'dead'); assert.strictEqual(t.end.cause, 'cash'); assert.strictEqual(t.turn, 1, 'same turn, not the next'); }

// 8. a win is possible: hold caps above the best rival with safety in step for 52 turns (a scripted cheat)
{ let s = S.applyCommands(game(11), [{ type: 'acceptRound' }]).state, first = 0;
  for (let t = 0; t < 80 && s.status === 'playing'; t++) {
    const top = FR.market.best(s).avgCap + 2;
    SK.forEach(k => { const x = s.model.skills[k]; x.cap = Math.min(100, Math.max(x.cap, top)); x.safe = x.cap; });
    s.money.cash = Math.max(s.money.cash, 20e6);
    s = S.endTurn(s, []);
    if (s.win.streak === 1 && !first) first = s.turn - 1;
  }
  assert.strictEqual(s.status, 'won'); assert.strictEqual(s.end.cause, 'win'); assert.strictEqual(s.win.streak, S.K.winTurns);
  assert.strictEqual(s.turn, first + S.K.winTurns - 1, 'won on the 52nd safe frontier turn');
  assert.strictEqual(ev(s, 'run:won').length, 1); assert.ok(S.score(s).parts.some(p => /safely for a year/.test(p.label)));
  assert.strictEqual(S.endTurn(s, []), s, 'no turns after the end'); }

// 9. review regressions: slider junk, declined deal memo, hold memos name the cause, score never rewards a later win
{ const s = game(2);
  [[1e308, 1], [Infinity, 1], [NaN, 5], [-5, 250]].forEach(([a, b]) => {
    const r = S.applyCommands(s, [{ type: 'sliders', training: a, serving: b, safety: 0, research: 0 }]);
    const v = FR.ALLOCS.map(k => r.state.sliders[k]); assert.ok(v.every(Number.isInteger) && v.reduce((x, y) => x + y) === 100, J(v)); });
  const d = FR.clone(s); d.market.dealOffer = { rivalId: 'deepfield', kind: 'compute', pf: 45, revShare: 0.15, turns: 26, expires: 5 };
  const n = S.endTurn(d, [{ type: 'declineDeal' }]);
  assert.ok(n.memo.lines.some(m => m.text === 'DeepField compute share declined: 45 PF for 26 weeks at 15% of revenue.'));
  // a hold that breaks on safety while still leading says so, even after one week
  let h = S.applyCommands(game(11), [{ type: 'acceptRound' }]).state;
  const lift = (x) => { const top = FR.market.best(x).avgCap + 2; SK.forEach(k => { const q = x.model.skills[k]; q.cap = Math.max(q.cap, top); q.safe = q.cap; }); };
  lift(h); h = S.endTurn(h, []); assert.ok(h.memo.lines.some(m => m.text === 'The lab is at the frontier with safety in step. Hold it for ' + S.K.winTurns + ' weeks.'));
  lift(h); h.model.skills.coding.safe = h.model.skills.coding.cap - 8; h = S.endTurn(h, []);
  assert.ok(h.memo.lines.some(m => /^Coding safety [\d.]+ against capability [\d.]+\. Safety more than 5 below capability\. The 52-week hold restarts after 1 week\.$/.test(m.text)), J(h.memo.lines));
  // scoring: the same run won later scores less; the founder stake is capped
  const w = FR.clone(h); w.status = 'won'; w.win.best = 52; const late = FR.clone(w); late.turn = w.turn + 100;
  assert.ok(S.score(w).total > S.score(late).total, 'winning sooner scores more');
  const rich = FR.clone(w); rich.money.valuation = 1e15;
  assert.strictEqual(S.score(rich).parts.find(p => /Founder stake/.test(p.label)).value, S.K.score.stakeMax); }

// 10. the sim files stay pure
['02_sim.js', '03_model.js', '04_compute.js', '05_money.js', '06_market.js', '07_projects.js'].forEach(f => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').split('\n').filter(l => !l.startsWith('})(typeof window')).join('\n');
  ['Math.random', 'Date.now', 'document.', 'window.', 'localStorage', 'performance.', 'FR.emit', 'FR.on('].forEach(w => assert.ok(!src.includes(w), f + ' uses ' + w));
});

console.log('sim ok (do-nothing ends: ' + J(ends) + ', random runs to ' + longest + ' turns)');

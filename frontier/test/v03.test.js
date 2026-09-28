// V0.3: the Series B opens on a weekly-revenue milestone set when the A closes; it is optional (declining or letting it
// lapse costs nothing beyond the re-offer delay); a missed B milestone comes back as a fresh revenue milestone; a run that
// declines the B still reaches the frontier in some seeds.
const assert = require('assert');
const FR = require('./_load')();
const M = FR.money, K = M.K;

const cmd = (s, c) => { const r = FR.sim.applyCommands(s, [c]); assert.ok(r.results[0].ok, JSON.stringify(r.results[0])); return r.state; };
const run = (s, n) => { for (let i = 0; i < n; i++) s = FR.sim.endTurn(s, []); return s; };
const ev = (s, type) => s.lastReport.events.filter(e => e.type === type);
const memo = (s, re) => s.lastReport.memo.some(m => re.test(m.text));
const sig2 = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };
const setCap = (s, c) => FR.SKILLS.forEach(k => { s.model.skills[k].cap = c; s.model.skills[k].safe = c; });
const DATE = 'Year \\d+, Week \\d+';

// ---- K ----
assert.deepStrictEqual(K.rounds.b, { name: 'Series B', amount: K.rounds.b.amount, pctMin: 0.10, pctMax: 0.20 });
assert.ok(K.rounds.b.amount >= 120e6);
assert.deepStrictEqual(K.order, ['seed', 'a', 'b']);
assert.deepStrictEqual(K.msKindsFor.b, [['revenue', 1]]);

// a lab through seed and A: seed accepted, the A milestone met by hand, the A accepted
function throughA(seed) {
  let s = cmd(FR.sim.newGame({ seed }), { type: 'acceptRound' });
  const ms = s.money.milestone; setCap(s, ms.value + 1); s.model.skills[ms.skill || 'coding'].cap = ms.value + 1;
  s = run(s, 1); assert.strictEqual(s.money.offer.round, 'a');
  s = cmd(s, { type: 'acceptRound' });
  return s;
}

// ---- the A closes: the B milestone is weekly revenue, max(bRevMin, revenue × bRevMult), 36 weeks ----
let s = throughA(4);
let ms = s.money.milestone;
assert.deepStrictEqual([ms.round, ms.kind, ms.skill], ['b', 'revenue', null]);
assert.strictEqual(ms.value, sig2(Math.max(K.ms.bRevMin, M.trailRevenue(s) * K.ms.bRevMult)));
assert.strictEqual(ms.opens, s.turn + K.ms.bWait); assert.strictEqual(ms.due, s.turn + K.ms.bWait + K.msTurns);
assert.ok(new RegExp('^Series B opens if weekly revenue reaches \\$[\\d.]+[kM] between ' + DATE + ' and ' + DATE + '\\.$').test(ms.text), ms.text);
assert.ok(new RegExp('^Series A closed: \\$[\\d.]+M for \\d+%\\. Series B opens if weekly revenue reaches').test(s.pendingMemo.slice(-1)[0].text));
const afterA = FR.clone(s);

// ---- revenue reaches the milestone: the B offer, inside the bounds, and the money:milestone event for round 'b' ----
setCap(s, 45); s.compute.rentPF = 900; s.sliders = { training: 10, serving: 80, safety: 5, research: 5 };
let guard = 0;
s = run(s, 1); assert.ok(!s.money.offer, 'no B before the window opens'); assert.ok(M.progress(s).early);
while (!s.money.offer && guard++ < 60) s = run(s, 1);
assert.ok(s.turn >= ms.opens, 'the B milestone counts only from ' + ms.opens);
assert.ok(s.money.offer && s.money.offer.round === 'b', 'B offered once weekly revenue reaches the mark');
assert.ok(s.money.revenue >= ms.value);
assert.deepStrictEqual(ev(s, 'money:milestone'), [{ type: 'money:milestone', round: 'b', hit: true }]);
let o = s.money.offer;
// in bounds, or (at this forced high valuation) the capped amount for under 10%
assert.ok(o.pct <= 0.20 && (o.pct >= 0.10 || o.amount === K.rounds.b.amount * K.amountCap), JSON.stringify(o)); assert.ok(Math.abs(o.amount / o.valuation - o.pct) < 1e-3); assert.ok(o.amount >= K.rounds.b.amount);
assert.strictEqual(o.expires, s.turn + K.offerTurns - 1);
assert.ok(memo(s, new RegExp('^Series B milestone met: weekly revenue \\$[\\d.]+[kM] against \\$[\\d.]+[kM]\\. Series B offer: \\$[\\d.]+[MB] for [\\d.]+% at a \\$[\\d.]+[MB] valuation\\. Open until ' + DATE + '\\.$')),
  s.lastReport.memo.map(m => m.text).join(' | '));
const offered = FR.clone(s);

// ---- accept: cash in, dilution, no further rounds, the account book widens to 6 ----
const pct0 = s.money.founderPct, cash0 = s.money.cash;
s = cmd(s, { type: 'acceptRound' });
assert.deepStrictEqual(s.money.roundsDone, ['seed', 'a', 'b']);
assert.ok(Math.abs(s.money.founderPct - pct0 * (1 - o.pct)) < 1e-3); assert.strictEqual(s.money.cash, cash0 + o.amount);
assert.strictEqual(s.money.milestone, null); assert.strictEqual(M.nextRound(s), null);
assert.ok(/No further rounds are open\.$/.test(s.pendingMemo.slice(-1)[0].text));
assert.deepStrictEqual(s.pendingEvents.slice(-1), [{ type: 'money:round', round: 'b', amount: o.amount, pct: o.pct }]);
assert.strictEqual(FR.accounts.maxActive(s), 6);
// the sector raise: rivals train FR.market.K.raiseLift faster from the week after the B closes (declining leaves them alone)
assert.strictEqual(s.market.raised, 0);
const bT = s.turn; s = run(s, 1);
assert.strictEqual(s.market.raised, bT);
assert.ok(memo(s, new RegExp('^Rivals have raised in step with our Series B\\. Their training pace rises ' + Math.round(FR.market.K.raiseLift * 100) + '% from ' + FR.dateLabel(bT + FR.market.K.raiseLag) + ' for the rest of the run\\.$')));
assert.ok(s.lastReport.news.some(n => n.text === 'Opal AI, Entropic, DeepField and Zeta close new funding rounds within weeks of ' + s.lab.name + '\'s Series B.'));
{ const a = FR.clone(s), b = FR.clone(s); a.market.raised = b.market.raised = a.turn - FR.market.K.raiseLag;
  const c = FR.clone(s); c.market.raised = c.turn - FR.market.K.raiseLag + 1; const rC = FR.rng(11); const rA = FR.rng(11), rB = FR.rng(11);
  FR.market.step(a, rA, { turn: a.turn, events: [], memo: [], news: [], flows: {} }); const L = FR.market.K.raiseLift; FR.market.K.raiseLift = 0; FR.market.step(b, rB, { turn: b.turn, events: [], memo: [], news: [], flows: {} }); FR.market.K.raiseLift = L;
  const gain = (x, y) => x.market.rivals.reduce((t, r, i) => t + FR.SKILLS.reduce((u, k) => u + r.cap[k] - y.market.rivals[i].cap[k], 0), 0);
  const g1 = gain(a, s), g0 = gain(b, s); assert.ok(Math.abs(g1 / g0 - (1 + FR.market.K.raiseLift)) < 0.05, g1 + ' vs ' + g0);
  FR.market.step(c, rC, { turn: c.turn, events: [], memo: [], news: [], flows: {} }); assert.ok(Math.abs(gain(c, s) - g0) < 1e-9, 'no lift before the lag'); }
s = run(s, 60); assert.strictEqual(s.money.offer, null); assert.strictEqual(s.money.milestone, null); assert.strictEqual(s.money.lockedUntil, 0);

// ---- B optional: declining costs nothing beyond the re-offer delay ----
s = FR.clone(offered);
const r = FR.sim.applyCommands(s, [{ type: 'declineRound' }]), d = r.state;
assert.ok(r.results[0].ok);
assert.strictEqual(d.money.cash, s.money.cash); assert.strictEqual(d.money.founderPct, s.money.founderPct);
assert.strictEqual(d.market.trust, s.market.trust); assert.strictEqual(d.money.valuation, s.money.valuation);
assert.deepStrictEqual(d.money.roundsDone, ['seed', 'a']); assert.deepStrictEqual(d.money.milestone, s.money.milestone);
assert.strictEqual(d.money.lockedUntil, s.turn + K.reofferTurns); assert.strictEqual(FR.accounts.maxActive(d), FR.accounts.K.maxActive);
assert.strictEqual(FR.sim.endTurn(d, []).market.raised, 0, 'declining the B leaves the rivals as they were');
assert.ok(new RegExp('^Series B offer declined\\. Investors expect to return ' + DATE + '\\.$').test(r.results[0].memo.text));
let t = d;
while (t.turn < d.money.lockedUntil) { t = run(t, 1); if (t.turn < d.money.lockedUntil) assert.strictEqual(t.money.offer, null); }
assert.strictEqual(t.money.offer.round, 'b'); assert.ok(memo(t, /^Investors are back\. Series B offer: /));
// letting it lapse is the same
s = FR.clone(offered); const cashL = s.money.cash, pctL = s.money.founderPct;
while (s.money.offer) s = run(s, 1);
assert.ok(memo(s, /^Series B offer lapsed unanswered\. Investors expect to return /));
assert.strictEqual(s.money.founderPct, pctL); assert.strictEqual(s.money.lockedUntil, s.lastReport.turn + K.reofferTurns);
assert.ok(s.money.cash > cashL - 20 * (s.money.burn + 1), 'no charge for the lapse beyond the weeks run');

// ---- a missed B milestone: locked 52 weeks, then a fresh milestone, always weekly revenue ----
s = FR.clone(afterA); s.money.milestone.value = 1e12;
s = run(s, s.money.milestone.due - s.turn + 1);
assert.ok(memo(s, /^Series B milestone missed \(weekly revenue reaches /)); assert.deepStrictEqual(ev(s, 'money:milestone'), [{ type: 'money:milestone', round: 'b', hit: false }]);
const lock = s.money.lockedUntil; assert.strictEqual(s.money.milestone, null);
s = run(s, lock - s.turn);
assert.ok(s.money.milestone && s.money.milestone.round === 'b' && s.money.milestone.kind === 'revenue', JSON.stringify(s.money.milestone));
assert.ok(memo(s, /^Investors are back\. Series B opens if weekly revenue reaches /));
for (let i = 1; i < 25; i++) {   // fresh B milestones never draw another kind
  const g = FR.clone(afterA); g.money.milestone = null; g.money.lockedUntil = g.turn + 1; g.rngState = i * 7919;
  const q = FR.sim.endTurn(g, []); assert.strictEqual(q.money.milestone.kind, 'revenue');
}

// a fresh B milestone after a miss is trailing revenue × bRevAgain: one starved week cannot rig it
{ const g = FR.clone(afterA); g.money.milestone = null; g.money.lockedUntil = g.turn + 1;
  g.history = []; for (let i = 0; i < 8; i++) g.history.push({ turn: g.turn - 8 + i, revenue: i === 7 ? 0 : 2e6 });
  g.money.revenue = 0; const q = FR.sim.endTurn(g, []);
  assert.strictEqual(q.money.milestone.value, sig2(Math.max(K.ms.bRevMin, (7 * 2e6 / 8) * K.ms.bRevAgain)), JSON.stringify(q.money.milestone)); }
// a 0.2 save past its Series A (no B in 0.2): migrate opens the B on a trailing-revenue milestone, with its memo line
{ const g = FR.clone(afterA); g.money.milestone = null; g.money.lockedUntil = 0; delete g.money.passes; delete g.accounts; g.pendingMemo = [];
  g.history = [{ turn: g.turn - 1, revenue: 3e6 }];
  const mg = FR.sim.migrate(g); assert.strictEqual(mg.money.passes, 0);
  assert.deepStrictEqual([mg.money.milestone.round, mg.money.milestone.kind, mg.money.milestone.value], ['b', 'revenue', sig2(3e6 * K.ms.bRevAgain)]);
  assert.ok(/^Series B opens if weekly revenue reaches \$3\.9M by /.test(mg.pendingMemo.slice(-1)[0].text), mg.pendingMemo.slice(-1)[0].text);
  const nx = FR.sim.endTurn(mg, []); assert.ok(!nx.lastReport.memo.some(m => /Investors are back/.test(m.text)));
  // a 0.3 save locked after a missed B is left alone
  const L = FR.clone(afterA); L.money.milestone = null; L.money.lockedUntil = L.turn + 30; FR.sim.migrate(L); assert.strictEqual(L.money.milestone, null); }

// ---- founder stake after seed + A + B in the balance bots' runs, and a run that declines the B still reaches the frontier ----
const bal = require('../tools/balance.js'), noB = Object.assign({}, bal.BOTS.balanced, { lastRound: 'a' });
let reached = 0;
for (let seed = 1; seed <= 8 && !reached; seed++) { const p = bal.play(noB, seed); assert.strictEqual(p.bAt, null); if (p.front != null) reached++; }
assert.ok(reached > 0, 'a lab that declines the B reaches the frontier in some seeds');
const withB = bal.play(bal.BOTS.balanced, 2);
// V0.4: client work lifts capability and the B-era valuation, so the B sells a little less (upper bound 56 -> 58)
if (withB.rounds === 'seedab') assert.ok(withB.stake >= 45 && withB.stake <= 58, 'founder stake after seed, A and B: ' + withB.stake);
console.log('v03 ok');

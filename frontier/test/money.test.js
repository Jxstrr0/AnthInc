// 05_money: init shape, payroll and burn, hiring delay, layoffs, dilution, milestones (hit, miss, lock), offer expiry,
// revenue capped at demand, runway warnings, bankruptcy.
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')(['01_core.js', '02_sim.js', '05_money.js']);
const M = FR.money, K = M.K;

// small fakes for the modules being written in parallel
const skill = (c) => ({ cap: c, safe: c, warnStreak: 0, critStreak: 0, warned: false, incidents: [] });
FR.model = { init: s => { s.model = { skills: { coding: skill(8), reasoning: skill(8), agents: skill(8) }, peakCap: 8 }; s.target = 'coding'; },
  train() {}, ladder() {}, gains: () => ({ cap: {}, safe: {} }) };
FR.compute = { init: s => { s.compute = { rentPF: 20, deals: [] }; }, step() {}, capacity: s => ({ total: s.compute.rentPF }),
  cost: s => s.compute.rentPF * 2000, revShare: s => s.compute.deals.reduce((t, d) => t + d.revShare, 0) };
const nudges = [];
FR.market = { init: s => { s.market = { trust: 50, rivals: [{ id: 'zeta', name: 'Zeta', cap: { coding: 0, reasoning: 0, agents: 0 } }] }; },
  step() {}, best: () => ({ rivalId: 'opal', avgCap: 99 }), trustMult: s => 0.5 + s.market.trust / 100,
  nudgeTrust: (s, d, why) => { nudges.push({ d, why }); s.market.trust = FR.clamp(s.market.trust + d, 0, 100); } };
FR.projects = { init: s => { s.projects = { cash: 0 }; }, pfDemand: () => 0, step() {}, cashDemand: s => s.projects.cash };

const game = (seed) => FR.sim.newGame({ seed: seed || 3 });
const rep = (t) => ({ turn: t || 1, events: [], memo: [], news: [], flows: {}, commands: [] });
const run = (s, n, cmds) => { for (let i = 0; i < n; i++) s = FR.sim.endTurn(s, i ? [] : cmds); return s; };
const cmd = (s, c) => { const r = FR.sim.applyCommands(s, [c]); assert.ok(r.results[0].ok, JSON.stringify(r.results[0])); return r.state; };
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-6), a + ' vs ' + b);
const setCap = (s, c) => FR.SKILLS.forEach(k => { s.model.skills[k].cap = c; s.model.skills[k].safe = c; });
const ev = (s, type) => s.lastReport.events.filter(e => e.type === type);
const memo = (s, re) => s.lastReport.memo.some(m => re.test(m.text));
const burnAt = (hc, s) => hc * K.wage + K.opsBase + K.opsPerHead * hc + s.compute.rentPF * 2000 + s.projects.cash;
function meet(s, ms) {   // make a milestone true for the next resolution
  if (ms.kind === 'trust') s.market.trust = ms.value;
  else if (ms.kind === 'revenue') { setCap(s, 90); s.sliders = { training: 0, serving: 100, safety: 0, research: 0 }; s.compute.rentPF = 500; }
  else setCap(s, ms.value);
}

// init: exactly the §1 shape, seed on the table at turn 1, 9-12 months of runway before any round
let s = game();
assert.deepStrictEqual(Object.keys(s.money).sort(), ['burn', 'cash', 'founderPct', 'lockedUntil', 'milestone', 'net', 'offer', 'revenue', 'roundsDone', 'valuation']);
assert.deepStrictEqual(s.staff, { headcount: K.startHead, hiring: [] });
assert.strictEqual(s.money.founderPct, 100); assert.deepStrictEqual(s.money.roundsDone, []);
assert.strictEqual(s.money.milestone, null); assert.strictEqual(s.money.lockedUntil, 0); assert.strictEqual(s.money.cash, K.startCash);
const seed = s.money.offer;
assert.deepStrictEqual(Object.keys(seed).sort(), ['amount', 'expires', 'pct', 'round', 'valuation']);
assert.deepStrictEqual(seed, { round: 'seed', amount: 18e6, pct: 0.2, valuation: 90e6, expires: K.offerTurns });
const fc = FR.sim.forecast(s);
assert.ok(fc.runway >= 39 && fc.runway <= 52, 'starting runway ' + fc.runway);
assert.ok(Math.abs(M.debug(s).runway - fc.runway) <= 1);   // debug uses last revenue (0), the forecast next turn's
assert.deepStrictEqual(JSON.parse(JSON.stringify(M.debug(s))), M.debug(s));

// payroll and burn: payroll + compute + project cash + ops
assert.strictEqual(M.payroll(s), K.startHead * K.wage);
s.projects.cash = 7000;
assert.strictEqual(M.burnEstimate(s), burnAt(K.startHead, s));
let rp = rep(), c0 = s.money.cash;
M.step(s, { serving: { pf: 0, staff: 0 } }, FR.rng(1), rp);
assert.strictEqual(s.money.burn, burnAt(K.startHead, s)); assert.strictEqual(s.money.revenue, 0);
assert.strictEqual(s.money.net, -s.money.burn); assert.strictEqual(s.money.cash, c0 - s.money.burn);
assert.strictEqual(rp.flows.money.burn, s.money.burn);

// hiring: validation, fee up front, arrives after hireTurns, payroll follows
s = game();
[0, -1, 2.5, K.maxHire + 1, 'x', null, undefined, NaN].forEach(v => assert.strictEqual(M.hire(FR.clone(s), v).ok, false, String(v)));
let poor = FR.clone(s); poor.money.cash = 5 * K.hireFee - 1; assert.strictEqual(M.hire(poor, 5).ok, false);
let t = cmd(s, { type: 'hire', n: 5 });
assert.strictEqual(t.money.cash, s.money.cash - 5 * K.hireFee);
assert.deepStrictEqual(t.staff.hiring, [{ n: 5, arrives: 1 + K.hireTurns }]);
assert.deepStrictEqual(cmd(t, { type: 'hire', n: '2' }).staff.hiring, [{ n: 7, arrives: 1 + K.hireTurns }]);
s = run(s, 1, [{ type: 'hire', n: 5 }]);
assert.ok(memo(s, /^Hiring 5: recruiting fees \$100k/));
while (s.turn < 1 + K.hireTurns) {
  assert.strictEqual(s.staff.headcount, K.startHead); assert.strictEqual(s.money.burn, burnAt(K.startHead, s));
  s = run(s, 1);
}
assert.strictEqual(s.staff.headcount, K.startHead + 5); assert.strictEqual(s.staff.hiring.length, 0);
assert.ok(memo(s, /^5 hires join next week\. Headcount 15/));
s = run(s, 1); assert.strictEqual(s.money.burn, burnAt(K.startHead + 5, s));

// layoffs: severance, a little trust, floor on headcount
s = game(); nudges.length = 0; c0 = s.money.cash;
[0, -2, 1.5, 'x', K.startHead - K.minHead + 1].forEach(v => assert.strictEqual(M.layoff(FR.clone(s), v).ok, false, String(v)));
poor = FR.clone(s); poor.money.cash = 3 * K.wage * K.severanceWeeks - 1; assert.strictEqual(M.layoff(poor, 3).ok, false);
assert.ok(M.layoff(s, 3).ok);
assert.strictEqual(s.money.cash, c0 - 3 * K.wage * K.severanceWeeks); assert.strictEqual(s.staff.headcount, K.startHead - 3);
assert.strictEqual(nudges.length, 1); assert.ok(nudges[0].d < 0 && nudges[0].d >= -K.layoffTrust[1]); assert.ok(s.market.trust < 50);

// dilution: seed then A; each close adds cash, dilutes by pct, sets the next milestone; after A no more rounds
s = run(game(), 1, [{ type: 'acceptRound' }]);
assert.deepStrictEqual(ev(s, 'money:round'), [{ type: 'money:round', round: 'seed', amount: 18e6, pct: 0.2 }]);
assert.ok(memo(s, /^Seed round closed: \$18\.0M for 20%\. Series A opens if any skill reaches capability \d+ by Year 1, Week \d+\.$/));
assert.strictEqual(s.money.founderPct, 80); assert.deepStrictEqual(s.money.roundsDone, ['seed']); assert.strictEqual(s.money.offer, null);
assert.strictEqual(s.money.cash, K.startCash + 18e6 + s.money.net);
let ms = s.money.milestone;
assert.deepStrictEqual([ms.round, ms.kind, ms.skill, ms.due], ['a', 'cap', null, 1 + K.msTurns]);
assert.ok(ms.value > 8 && ms.value % 5 === 0 && ms.value <= 100);
assert.strictEqual(M.acceptRound(s).ok, false); assert.strictEqual(M.declineRound(s).ok, false);
setCap(s, ms.value); s = run(s, 1);
assert.deepStrictEqual(ev(s, 'money:milestone'), [{ type: 'money:milestone', round: 'a', hit: true }]);
assert.ok(memo(s, /^Series A milestone met: .* Series A offer: \$[\d.]+M for [\d.]+% at a \$[\d.]+M valuation\. Open until/));
const A = s.money.offer;
assert.strictEqual(A.round, 'a'); assert.strictEqual(A.expires, s.turn + K.offerTurns - 1);
assert.ok(A.pct >= K.rounds.a.pctMin && A.pct <= K.rounds.a.pctMax); near(A.amount / A.valuation, A.pct, 1e-4);
const cashA = s.money.cash;
s = cmd(s, { type: 'acceptRound' });
near(s.money.founderPct, 80 * (1 - A.pct), 1e-4); assert.strictEqual(s.money.cash, cashA + A.amount);
assert.deepStrictEqual(s.money.roundsDone, ['seed', 'a']); assert.strictEqual(s.money.milestone, null); assert.strictEqual(s.money.valuation, A.valuation);
setCap(s, 95);
for (let i = 0; i < 120; i++) { s = run(s, 1); assert.strictEqual(s.money.offer, null); assert.strictEqual(s.money.milestone, null); assert.strictEqual(s.money.lockedUntil, 0); }

// milestone miss: due-soon memos, miss at due, rounds locked 52 turns even at high cap, then a fresh milestone
s = cmd(game(), { type: 'acceptRound' }); ms = s.money.milestone;
const dues = [];
while (s.turn <= ms.due) { s = run(s, 1); s.lastReport.memo.filter(m => m.kind === 'due').forEach(m => dues.push(m.text)); }
assert.ok(dues.some(x => /^Series A milestone due in 4 weeks: any skill reaches capability \d+\. Now Coding capability 8\.$/.test(x)), dues.join('|'));
assert.ok(dues.some(x => /milestone due next week/.test(x)));
assert.deepStrictEqual(ev(s, 'money:milestone'), [{ type: 'money:milestone', round: 'a', hit: false }]);
assert.ok(memo(s, /^Series A milestone missed \(.*\)\. Coding capability 8\. No round can be raised until/));
assert.strictEqual(s.money.milestone, null); assert.strictEqual(s.money.lockedUntil, ms.due + 1 + K.lockTurns);
const lock = s.money.lockedUntil;
setCap(s, 95);
while (s.turn < lock) { assert.strictEqual(s.money.offer, null); assert.strictEqual(s.money.milestone, null); s = run(s, 1); }
assert.strictEqual(s.money.lockedUntil, 0); assert.strictEqual(s.money.offer, null);
const fresh = s.money.milestone;
assert.ok(fresh && fresh.round === 'a' && fresh.due === lock + K.msTurns && /^Series A opens if /.test(fresh.text));
assert.ok(memo(s, /^Investors are back\. Series A opens if/));
meet(s, fresh); s = run(s, 1);
assert.strictEqual(s.money.offer.round, 'a'); assert.deepStrictEqual(ev(s, 'money:milestone'), [{ type: 'money:milestone', round: 'a', hit: true }]);
// fresh milestone kinds come from the rng: every kind shows up over a spread of rolls
const kinds = new Set(); for (let i = 1; i < 60; i++) {
  const g = cmd(game(i), { type: 'acceptRound' }); g.money.milestone = null; g.money.lockedUntil = g.turn + 1;
  M.step(g, null, FR.rng(i), rep()); kinds.add(g.money.milestone.kind);
}
assert.deepStrictEqual([...kinds].sort(), ['avgCap', 'cap', 'revenue', 'trust']);

// offer expiry: seed lapses after offerTurns, returns reofferTurns later, re-priced at the new valuation
s = run(game(), K.offerTurns - 1);
assert.strictEqual(s.turn, K.offerTurns); assert.ok(s.money.offer); assert.ok(memo(s, /^Seed round offer \(\$18\.0M for 20%\) lapses after next week\.$/));
assert.ok(FR.sim.applyCommands(s, [{ type: 'acceptRound' }]).results[0].ok);     // the last week is still open
s = run(s, 1);
assert.strictEqual(s.money.offer, null); assert.strictEqual(s.money.lockedUntil, K.offerTurns + K.reofferTurns);
assert.ok(memo(s, /^Seed round offer lapsed unanswered/)); assert.strictEqual(M.acceptRound(s).ok, false);
setCap(s, 20);
while (s.turn < K.offerTurns + K.reofferTurns) { assert.strictEqual(s.money.offer, null); s = run(s, 1); }
assert.strictEqual(s.money.offer.round, 'seed'); assert.strictEqual(s.money.offer.expires, s.turn + K.offerTurns - 1);
assert.ok(s.money.offer.pct < 0.2); assert.ok(memo(s, /^Investors are back\. Seed round offer:/));
// decline works the same way
t = cmd(s, { type: 'declineRound' }); assert.strictEqual(t.money.offer, null); assert.strictEqual(t.money.lockedUntil, s.turn + K.reofferTurns);
// Series A offer lapses and returns on the same met milestone, even after its due date and with cap back down
s = cmd(game(), { type: 'acceptRound' }); ms = s.money.milestone; setCap(s, ms.value); s = run(s, 1);
const kept = FR.clone(s.money.milestone); setCap(s, 8);
const seen = [];
while (s.turn < ms.due + 20) { s = run(s, 1); s.lastReport.events.forEach(e => seen.push(e.type + (e.hit === false ? ':miss' : ''))); }
assert.ok(!seen.includes('money:milestone:miss')); assert.deepStrictEqual(s.money.milestone, kept);
assert.ok(s.money.offer && s.money.offer.round === 'a' || s.money.lockedUntil > s.turn);

// revenue: capped at demand, scaled by trust, revenue share and Zeta's lead
s = game(); setCap(s, 40);
const d = M.demandPF(s), pr = M.pricePerPF(40);
near(d, K.demandBase * Math.pow(4, K.demandExp)); near(pr, K.priceBase * Math.pow(4, K.priceExp));
near(M.revenue(s, d / 2), d / 2 * pr); near(M.revenue(s, d * 10), d * pr); near(M.revenue(s, d), M.revenue(s, d + 1));
assert.strictEqual(M.revenue(s, -5), 0);
s.compute.deals = [{ revShare: 0.1 }]; near(M.revenue(s, 1e4), d * pr * 0.9);
s.market.trust = 80; near(M.revenue(s, 1e4), d * Math.sqrt(1.3) * pr * 1.3 * 0.9, 1e-3);
s.market.trust = 50; s.compute.deals = [];
s.market.rivals[0].cap = { coding: 50, reasoning: 50, agents: 50 }; near(M.zetaFactor(s), 1 - 10 * K.zetaDrag); near(M.revenue(s, 1e4), d * pr * (1 - 10 * K.zetaDrag));
s.market.rivals[0].cap = { coding: 30, reasoning: 30, agents: 30 }; assert.strictEqual(M.zetaFactor(s), 1);
setCap(s, 50); assert.ok(M.demandPF(s) > d); s.market.trust = 70; assert.ok(M.demandPF(s) > K.demandBase * 25);
// through the turn: serving beyond demand earns nothing extra
s = game(); setCap(s, 40); s.sliders = { training: 0, serving: 100, safety: 0, research: 0 }; s.compute.rentPF = 400;
s = run(s, 1); assert.strictEqual(s.money.revenue, Math.round(d * pr)); assert.strictEqual(s.lastReport.flows.money.servedPF, FR.round(d, 1));
// valuation rises with capability, trust and revenue
s = game(); const v0 = M.valuation(s); setCap(s, 30); const v1 = M.valuation(s); s.market.trust = 70; const v2 = M.valuation(s);
s.money.revenue = 1e5; assert.ok(v0 < v1 && v1 < v2 && v2 < M.valuation(s));

// runway warnings: once on crossing 26 and 13, every week under 6
s = game(); let b = M.burnEstimate(s); s.money.cash = Math.round(26.5 * b);
s = run(s, 1); assert.ok(memo(s, /^Runway 25 weeks at current burn/)); assert.ok(memo(s, /Seed round offer open until/));
s = run(s, 1); assert.ok(!memo(s, /^Runway/));
s.money.cash = Math.round(13.5 * b); s = run(s, 1); assert.ok(memo(s, /^Runway 12 weeks/));
s.money.cash = Math.round(5.5 * b); s = run(s, 1); assert.ok(memo(s, /^Runway 4 weeks/)); s = run(s, 1); assert.ok(memo(s, /^Runway 3 weeks/));

// bankruptcy: cash <= 0 after the turn ends the run
s = game(); s.money.cash = 50000; s = run(s, 1);
assert.strictEqual(s.status, 'dead'); assert.strictEqual(s.end.cause, 'cash'); assert.strictEqual(s.end.turn, 1); assert.strictEqual(s.turn, 1);
assert.strictEqual(ev(s, 'money:bankrupt').length, 1); assert.deepStrictEqual(ev(s, 'run:dead'), [{ type: 'run:dead', cause: 'cash' }]);
assert.ok(/wound up/.test(s.end.text) && memo(s, /wound up/)); assert.strictEqual(FR.sim.endTurn(s, []), s);
s = game(); s.sliders = { training: 50, serving: 0, safety: 50, research: 0 }; s.money.cash = M.burnEstimate(s); s = run(s, 1);
assert.strictEqual(s.money.cash, 0); assert.strictEqual(s.status, 'dead');   // exactly zero is bankrupt

// determinism and purity
const a1 = run(game(9), 40, [{ type: 'acceptRound' }]), a2 = run(game(9), 40, [{ type: 'acceptRound' }]);
assert.deepStrictEqual(a1.money, a2.money);
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '05_money.js'), 'utf8');
assert.ok(!/Math\.random|Date\.now|document\.|localStorage|performance\.|FR\.emit/.test(src));
console.log('money ok');

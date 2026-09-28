// 04_compute: capacity and cost math, validation, buying and install timing, ageing and retirement, deals, price drift.
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')(['01_core.js', '02_sim.js', '04_compute.js']);
const C = FR.compute, K = C.K, base = K.basePrice;

// small fakes for the modules being written in parallel
const skill = () => ({ cap: 8, safe: 8, warnStreak: 0, critStreak: 0, warned: false, incidents: [] });
FR.model = { init: s => { s.model = { skills: { coding: skill(), reasoning: skill(), agents: skill() }, peakCap: 0 }; }, train() {}, ladder() {} };
FR.money = {
  init: s => { s.money = { cash: 1e9, founderPct: 100, valuation: 0, revenue: 0, burn: 0, net: 0 }; s.staff = { headcount: 10, hiring: [] }; },
  step: s => { const b = C.cost(s); s.money.burn = b; s.money.cash -= b; s.money.share = C.revShare(s); }
};
FR.market = { init: s => { s.market = { trust: 50, rivals: [{ id: 'deepfield', name: 'DeepField' }], firsts: [], dealOffer: null }; }, step() {}, best: () => ({ rivalId: 'deepfield', avgCap: 99 }) };
FR.projects = { init() {}, pfDemand: () => 0, step() {} };

const game = (seed) => FR.sim.newGame({ seed: seed || 7 });
const rep = (t) => ({ turn: t, events: [], memo: [], news: [], flows: {} });
const run = (s, n, cmds) => { for (let i = 0; i < n; i++) s = FR.sim.endTurn(s, i ? [] : cmds); return s; };
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-6), a + ' vs ' + b);

// init shape
let s = game();
assert.deepStrictEqual(Object.keys(s.compute).sort(), ['bill', 'clusters', 'deals', 'installing', 'offers', 'rentPF', 'rentPrice', 'scarcity']);
assert.strictEqual(s.compute.rentPF, K.startRent); assert.strictEqual(s.compute.rentPrice, base); assert.strictEqual(s.compute.scarcity, 0);
assert.ok(s.compute.offers.length >= 2 && s.compute.offers.length <= 3);
s.compute.offers.forEach((o, i, a) => {
  assert.deepStrictEqual(Object.keys(o).sort(), ['cost', 'id', 'installTurns', 'name', 'pf']);
  if (i) assert.ok(o.pf > a[i - 1].pf && o.name !== a[i - 1].name);
});

// setRent validation (year 1: the ceiling is K.maxRent)
assert.strictEqual(C.maxRent(s), K.maxRent);
[-1, K.maxRent + 1, 2.5, NaN, Infinity, 'abc', '', null, undefined, {}].forEach(v => assert.strictEqual(C.setRent(s, v).ok, false, String(v)));
assert.strictEqual(s.compute.rentPF, K.startRent);
assert.ok(C.setRent(s, 0).ok && s.compute.rentPF === 0);
assert.ok(C.setRent(s, K.maxRent).ok && s.compute.rentPF === K.maxRent);
assert.ok(C.setRent(s, '40').ok && s.compute.rentPF === 40);
let r = FR.sim.applyCommands(s, [{ type: 'rent', pf: 60 }]);
assert.ok(r.results[0].ok); assert.strictEqual(r.state.compute.rentPF, 60); assert.strictEqual(s.compute.rentPF, 40);

// the compute ceiling grows each year (rent cap and cluster sizes), capped at ceilMax
{ const y = (n) => (n - 1) * 52 + 1, t = FR.clone(s);
  assert.strictEqual(C.ceiling(52), 1); assert.strictEqual(C.ceiling(53), K.ceilGrowth);
  near(C.ceiling(y(3)), K.ceilGrowth * K.ceilGrowth); assert.strictEqual(C.ceiling(y(40)), K.ceilMax);
  let last = 0;
  for (let n = 1; n <= 8; n++) {
    t.turn = y(n); const max = C.maxRent(t);
    assert.strictEqual(max, Math.round(K.maxRent * Math.min(K.ceilMax, Math.pow(K.ceilGrowth, n - 1)) / 10) * 10);
    assert.ok(max >= last && max % 10 === 0 && max <= K.maxRent * K.ceilMax); last = max;
    assert.ok(C.setRent(t, max).ok && t.compute.rentPF === max, 'year ' + n + ' rents ' + max);
    assert.ok(!C.setRent(t, max + 1).ok && /from 0 to \d+$/.test(C.setRent(t, max + 1).why) && t.compute.rentPF === max);
  }
  assert.ok(C.maxRent({ turn: y(3) }) > K.maxRent * 1.8 && C.maxRent({ turn: y(20) }) === K.maxRent * K.ceilMax);
  // the new year's memo names the new ceiling
  t.turn = 52; const rp0 = rep(52); C.step(t, FR.rng(3), rp0);
  assert.ok(rp0.memo.some(m => m.text === 'Compute ceiling for Year 2: the spot market rents up to ' + C.maxRent({ turn: 53 }) + ' PF, up from ' + K.maxRent + '. Cluster offers grow in step.'));
  t.turn = 60; const rp1 = rep(60); C.step(t, FR.rng(3), rp1); assert.ok(!rp1.memo.some(m => /Compute ceiling/.test(m.text)));
  // late clusters are bigger: every offer's PF sits in its tier's range × the year's ceiling, and cost follows PF
  const pfLo = K.tiers[0].pf[0], pfHi = K.tiers[K.tiers.length - 1].pf[1];
  [1, 3, 6].forEach(n => {
    const u = game(n); u.turn = y(n) + 12 - (y(n) + 12) % K.quarter; const g = C.ceiling(u.turn + 1); C.step(u, FR.rng(n), rep());
    u.compute.offers.forEach(o => {
      assert.ok(o.pf >= Math.round(pfLo * g) && o.pf <= Math.round(pfHi * g), 'year ' + n + ' offer ' + o.pf + ' PF');
      const per = o.cost / o.pf / (u.compute.rentPrice / base);
      assert.ok(per > K.buyPerPF * 0.8 && per < K.buyPerPF * 1.25, 'cost per PF ' + per);
    });
  });
  const big = (n) => { const u = game(9); u.turn = n * 52 - 52 + 13; C.step(u, FR.rng(9), rep()); return Math.max(...u.compute.offers.map(o => o.pf)); };
  assert.ok(big(5) > 2.5 * big(1), 'year-5 clusters are much bigger: ' + big(5) + ' vs ' + big(1)); }

// capacity and cost math: one cluster 2 years old, one new, a deal, some rent
s = game(); s.turn = 105; s.compute.rentPF = 30; s.compute.rentPrice = 2100;
s.compute.clusters = [{ id: 'x', name: 'X', pf: 100, bought: 1, cost: 1 }, { id: 'y', name: 'Y', pf: 50, bought: 105, cost: 1 }];
s.compute.deals = [{ rivalId: 'deepfield', kind: 'compute', pf: 40, revShare: 0.1, ends: 200 }];
const owned = 100 * (1 - 2 * K.decayPerYear) + 50;
assert.deepStrictEqual(C.capacity(s), { total: FR.round(owned + 70, 1), owned: FR.round(owned, 1), rented: 30, deals: 40 });
assert.strictEqual(C.cost(s), Math.round(30 * 2100 + 100 * K.power * (1 + 2 * K.powerRise) + 50 * K.power));
assert.strictEqual(C.revShare(s), 0.1);
assert.strictEqual(C.clusterInfo(s, s.compute.clusters[0]).retiresIn, 1 + K.retireTurns - 105);

// buy: validation, cash upfront, install timing through endTurn
s = game(); const o = s.compute.offers[0];
assert.strictEqual(C.buy(s, 'nope').ok, false);
let poor = FR.clone(s); poor.money.cash = o.cost - 1;
assert.strictEqual(C.buy(poor, o.id).ok, false); assert.strictEqual(poor.money.cash, o.cost - 1); assert.strictEqual(poor.compute.offers.length, s.compute.offers.length);
r = FR.sim.applyCommands(s, [{ type: 'buy', offerId: o.id }]); assert.ok(r.results[0].ok);
const cash0 = s.money.cash; s = r.state;
assert.strictEqual(s.money.cash, cash0 - o.cost); assert.ok(!s.compute.offers.some(x => x.id === o.id));
assert.deepStrictEqual(s.compute.installing, [{ id: o.id, name: o.name, pf: o.pf, ready: 1 + o.installTurns, cost: o.cost }]);
assert.strictEqual(C.buy(s, o.id).ok, false);
const ready = 1 + o.installTurns;
while (s.turn < ready) { assert.strictEqual(C.capacity(s).owned, 0); s = run(s, 1); }
assert.strictEqual(s.turn, ready); assert.strictEqual(C.capacity(s).owned, o.pf); assert.strictEqual(s.compute.clusters[0].bought, ready);
assert.ok(s.lastReport.events.some(e => e.type === 'compute:installed' && e.id === o.id && e.pf === o.pf));
assert.strictEqual(s.compute.installing.length, 0);

// ageing and retirement
s = game(); s.compute.clusters = [{ id: 'z', name: 'Z', pf: 100, bought: 1, cost: 1 }];
s.turn = 53; near(C.capacity(s).owned, 100 * (1 - K.decayPerYear), 0.05);
s.turn = 1 + 3 * 52; near(C.capacity(s).owned, 100 * (1 - 3 * K.decayPerYear), 0.05);
near(C.powerCost(s), 100 * K.power * (1 + 3 * K.powerRise));
let rp = rep(); s.turn = 1 + K.retireTurns - 1 - K.retireWarn; C.step(s, FR.rng(1), rp);
assert.ok(rp.memo.some(m => m.kind === 'due' && /retires in/.test(m.text)));
s.turn = K.retireTurns - 1; s = run(s, 1);
assert.strictEqual(s.turn, K.retireTurns); assert.strictEqual(s.compute.clusters.length, 1);   // live for turns 1..208
s = run(s, 1);
assert.strictEqual(s.compute.clusters.length, 0);
assert.ok(s.lastReport.events.some(e => e.type === 'compute:retired' && e.id === 'z'));
assert.ok(s.lastReport.memo.some(m => /retired/.test(m.text)));

// deals: accept, validation, expiry, end early
s = game(); s.market.dealOffer = { rivalId: 'deepfield', kind: 'compute', pf: 80, revShare: 0.12, turns: 26, expires: 3 };
let late = FR.clone(s); late.turn = 4; assert.strictEqual(C.acceptDeal(late).ok, false);
let other = FR.clone(s); other.market.dealOffer.kind = 'licence'; assert.strictEqual(C.acceptDeal(other).ok, false);
r = FR.sim.applyCommands(s, [{ type: 'acceptDeal' }]); assert.ok(r.results[0].ok); s = r.state;
assert.deepStrictEqual(s.compute.deals, [{ rivalId: 'deepfield', kind: 'compute', pf: 80, revShare: 0.12, ends: 27 }]);
assert.strictEqual(s.market.dealOffer, null); assert.strictEqual(C.acceptDeal(s).ok, false);
assert.strictEqual(C.capacity(s).deals, 80); assert.strictEqual(C.revShare(s), 0.12);
const nd = FR.clone(s); nd.compute.deals = []; assert.strictEqual(C.cost(s), C.cost(nd));   // deals cost nothing directly
s = run(s, 23); assert.strictEqual(s.turn, 24);
s = run(s, 1); assert.ok(s.lastReport.memo.some(m => m.kind === 'due' && /DeepField compute share ends in/.test(m.text)));
s = run(s, 1); assert.strictEqual(s.turn, 26); assert.strictEqual(s.compute.deals.length, 1);   // live for turns 1..26
s = run(s, 1); assert.strictEqual(s.compute.deals.length, 0); assert.strictEqual(C.revShare(s), 0);
assert.strictEqual(s.money.share, 0.12, 'the last week the deal PF is used still pays its share');
assert.ok(s.lastReport.memo.some(m => /DeepField compute share ended: 80 PF/.test(m.text)));
s.market.dealOffer = { rivalId: 'deepfield', kind: 'compute', pf: 50, revShare: 0.1, turns: 52, expires: 99 };
assert.ok(C.acceptDeal(s).ok); assert.strictEqual(C.endDeal(s, 'opal').ok, false);
{ const cash = s.money.cash, trust = s.market.trust, r = C.endDeal(s, 'deepfield');   // free to end: no fee, no trust cost
  assert.ok(r.ok); assert.strictEqual(s.compute.deals.length, 0); assert.strictEqual(s.money.cash, cash); assert.strictEqual(s.market.trust, trust);
  assert.strictEqual(r.memo.text, 'DeepField compute share ended early: 50 PF withdrawn, revenue share stops.'); }

// price drift and scarcity shocks
s = game(); s.compute.rentPF = 10;
const rng = FR.rng(99); let lo = Infinity, hi = 0, tot = 0, shocks = 0, eases = 0;
for (let t = 1; t <= 3000; t++) {
  s.turn = t; const was = s.compute.rentPrice, rp2 = rep(t); C.step(s, rng, rp2);
  const p = s.compute.rentPrice; lo = Math.min(lo, p); hi = Math.max(hi, p); tot += p;
  const ev = rp2.events.find(e => e.type === 'compute:scarcity');
  if (ev) {
    shocks++; assert.ok(was <= K.scarcityCalm * base); assert.ok(ev.turns >= K.scarcityTurns[0] && ev.turns <= K.scarcityTurns[1] && ev.turns === s.compute.scarcity);
    assert.ok(p / was >= 1 + K.scarcityLift[0] - 0.01 && (p / was <= 1 + K.scarcityLift[1] + 0.01 || p === Math.round(K.priceMax * base)), 'shock ' + p / was); assert.strictEqual(rp2.news.length, 1); assert.strictEqual(rp2.memo.filter(m => m.kind === 'flag').length, 1);
  }
  if (rp2.news.some(n => /eases/.test(n.text))) { eases++; assert.strictEqual(s.compute.scarcity, 0); }
}
assert.ok(lo >= K.priceMin * base && hi <= K.priceMax * base);
assert.ok(shocks > 20 && Math.abs(eases - shocks) <= 1, shocks + ' shocks, ' + eases + ' eases');
assert.ok(tot / 3000 > 0.95 * base && tot / 3000 < 1.15 * base, 'mean ' + tot / 3000);

// offers refresh every 13 turns, not between
s = game(); const ids0 = s.compute.offers.map(x => x.id).join();
for (let t = 1; t < K.quarter; t++) { s.turn = t; C.step(s, FR.rng(t), rep(t)); }
assert.strictEqual(s.compute.offers.map(x => x.id).join(), ids0);
s.turn = K.quarter; rp = rep(); C.step(s, FR.rng(5), rp);
assert.ok(s.compute.offers.every(x => x.id.startsWith('cl' + (K.quarter + 1))) && rp.memo.some(m => /Cluster offers/.test(m.text)));

// buying is a real saving: payback 1.5-2.5 years, positive over the 4-year life, a big cash hit
let pbLo = Infinity, pbHi = 0;
for (let seed = 1; seed <= 60; seed++) {
  s = game(seed); s.turn = 13 * seed; C.step(s, FR.rng(seed), rep());
  s.compute.offers.forEach(x => {
    const w = C.payback(s, x); pbLo = Math.min(pbLo, w); pbHi = Math.max(pbHi, w);
    let life = 0; for (let a = 0; a < K.retireTurns; a++) life += x.pf * ((1 - K.decayPerYear * a / 52) * s.compute.rentPrice - K.power * (1 + K.powerRise * a / 52));
    assert.ok(life > 1.3 * x.cost, 'lifetime saving');
    assert.ok(x.cost >= 40 * x.pf * s.compute.rentPrice, 'cash hit');   // at least 40 weeks of renting the same PF
  });
}
assert.ok(pbLo >= 78 && pbHi <= 130, 'payback ' + pbLo + '..' + pbHi);

// determinism and purity
const a = run(game(3), 40, [{ type: 'rent', pf: 90 }]), b = run(game(3), 40, [{ type: 'rent', pf: 90 }]);
assert.strictEqual(JSON.stringify(a.compute), JSON.stringify(b.compute));
assert.deepStrictEqual(Object.keys(C.debug(a)).length, 13);
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '04_compute.js'), 'utf8');
assert.ok(!/Math\.random|Date\.now|document\.|localStorage|performance\.|FR\.emit/.test(src), 'impure source');

console.log('compute ok (payback ' + pbLo + '-' + pbHi + ' weeks, ' + shocks + ' shocks in 3000 weeks)');

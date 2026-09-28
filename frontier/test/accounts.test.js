// 05b_accounts (V0.3): offer gating and the board, signing, reserved PF and the revenue split, fees, mood arithmetic, churn
// on an incident (gone for the run), renewal and quiet expiry, maxActive after the B, valuation backlog, the two project
// templates, the memo cap, 0.2 save migration.
const assert = require('assert');
const FR = require('./_load')();
const A = FR.accounts, K = A.K, MK = FR.money.K;

const rep = (t) => ({ turn: t, events: [], memo: [], news: [], flows: {}, commands: [] });
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-6), a + ' vs ' + b);
const setCap = (s, c, gap) => FR.SKILLS.forEach(k => { s.model.skills[k].cap = c; s.model.skills[k].safe = c - (gap || 0); });
const cmd = (s, c) => { const r = FR.sim.applyCommands(s, [c]); return { s: r.state, r: r.results[0] }; };
const serve = (pf) => ({ serving: { pf } });
function game(seed) {
  const s = FR.sim.newGame({ seed: seed || 5 });
  s.money.cash = 50e6; s.market.trust = 60; setCap(s, 30);
  return s;
}
// put one offer on the board by hand (fields as deal() makes them)
function offer(s, tier, extra) {
  const o = Object.assign({ id: 'x' + s.accounts.offers.length + 't' + s.turn, name: 'Test Buyer ' + s.accounts.offers.length, sector: 'Banking', tier,
    pfPerWeek: 10 * tier, feePerWeek: A.fee(tier, s.turn), turns: K.turns[tier - 1], minCap: K.minCap[tier - 1], minSafe: K.minSafe[tier - 1],
    minTrust: K.minTrust[tier - 1], expires: s.turn + 7 }, extra || {});
  s.accounts.offers.push(o); return o;
}
// a live contract (fee started) straight into the book
function live(s, tier, extra) {
  const a = Object.assign({ id: 'L' + s.accounts.active.length, name: 'Live Buyer ' + s.accounts.active.length, sector: 'Retail', tier, pfPerWeek: 10 * tier,
    feePerWeek: A.fee(tier, s.turn), ends: s.turn + 50, signed: s.turn - 2, starts: s.turn, mood: K.mood.start, served: 0 }, extra || {});
  s.accounts.active.push(a); return a;
}

// ---- K and names: first-pass numbers from the handoff; ~30 fictional names, no repeats ----
assert.strictEqual(K.unlockCap, 20); assert.strictEqual(K.unlockTrust, 45); assert.strictEqual(K.refreshTurns, 8);
assert.deepStrictEqual(K.turns, [52, 104, 156]); assert.strictEqual(K.signCost, 150000); assert.strictEqual(K.signWeeks, 2);
assert.strictEqual(K.maxActive, 4); assert.strictEqual(K.maxActiveB, 6);
assert.ok(K.NAMES.length >= 28 && K.NAMES.length <= 34, 'about 30 names');
assert.strictEqual(new Set(K.NAMES.map(n => n[0])).size, K.NAMES.length, 'no duplicate names');
assert.ok(K.NAMES.every(n => /^[A-Z][A-Za-z&' ]+$/.test(n[0]) && n[1]), 'plain names with a sector');
// fee = tier × feeBase × (1 + 0.1 × year), rounded to $1k
assert.strictEqual(A.fee(1, 1), Math.round(K.feeBase * 1.1 / 1000) * 1000);
assert.strictEqual(A.fee(3, 105), Math.round(3 * K.feeBase * 1.3 / 1000) * 1000);

// ---- init shape and 0.2 save migration ----
let s = FR.sim.newGame({ seed: 2 });
assert.deepStrictEqual(Object.keys(s.accounts).sort(), ['active', 'boost', 'lost', 'offers', 'readyUntil', 'refreshAt', 'unlocked', 'used']);
assert.strictEqual(s.accounts.unlocked, false); assert.strictEqual(A.reservedPF(s), 0); assert.strictEqual(A.maxActive(s), 4);
const old = FR.clone(s); delete old.accounts; delete old.money.revMarket; delete old.money.revContracts;
const mig = FR.sim.migrate(old);
assert.ok(mig.accounts && Array.isArray(mig.accounts.active) && mig.accounts.unlocked === false); assert.strictEqual(mig.money.revContracts, 0);
const next = FR.sim.endTurn(mig, []); assert.strictEqual(next.status, 'playing');

// ---- offer gating: nothing below average cap 20 or trust 45; then one memo line and 1..3 offers on the board ----
s = game(); setCap(s, 19.9);
let r = rep(s.turn); A.step(s, serve(0), FR.rng(1), r);
assert.strictEqual(s.accounts.unlocked, false); assert.strictEqual(s.accounts.offers.length, 0); assert.strictEqual(r.memo.length, 0);
setCap(s, 20); s.market.trust = 44.9; r = rep(s.turn); A.step(s, serve(0), FR.rng(1), r);
assert.strictEqual(s.accounts.unlocked, false); assert.strictEqual(s.accounts.offers.length, 0);
s.market.trust = 45; r = rep(s.turn); A.step(s, serve(0), FR.rng(1), r);
assert.strictEqual(s.accounts.unlocked, true);
assert.deepStrictEqual(r.memo, [{ kind: 'good', text: 'Enterprise buyers are asking for meetings. First account offers on the Serving floor.' }]);
let n = s.accounts.offers.length; assert.ok(n >= 1 && n <= 3);
assert.deepStrictEqual(r.events.filter(e => e.type === 'account:offers'), [{ type: 'account:offers', n }]);
assert.strictEqual(s.accounts.refreshAt, s.turn + 1 + K.refreshTurns);
s.accounts.offers.forEach(o => {
  assert.ok(o.tier >= 1 && o.tier <= 3); assert.strictEqual(o.turns, K.turns[o.tier - 1]); assert.strictEqual(o.feePerWeek, A.fee(o.tier, s.turn + 1));
  assert.strictEqual(o.minCap, K.minCap[o.tier - 1]); assert.strictEqual(o.minSafe, K.minSafe[o.tier - 1]); assert.strictEqual(o.minTrust, K.minTrust[o.tier - 1]);
  assert.ok(o.pfPerWeek >= K.pf[o.tier - 1][0] && o.pfPerWeek <= K.pf[o.tier - 1][1]); assert.strictEqual(o.expires, s.accounts.refreshAt - 1);
  assert.ok(K.NAMES.some(x => x[0] === o.name && x[1] === o.sector));
});
// higher tiers ask more
for (let t = 1; t < 3; t++) { assert.ok(K.minCap[t] > K.minCap[t - 1]); assert.ok(K.minSafe[t] < K.minSafe[t - 1]); assert.ok(K.minTrust[t] > K.minTrust[t - 1]); }
// the board refreshes every 8 weeks, not in between
const first = s.accounts.offers.map(o => o.id).join(), at = s.accounts.refreshAt;
for (s.turn = s.turn + 1; s.turn + 1 < at; s.turn++) { A.step(s, serve(0), FR.rng(s.turn), rep(s.turn)); assert.strictEqual(s.accounts.offers.map(o => o.id).join(), first); }
r = rep(s.turn); A.step(s, serve(0), FR.rng(9), r);
assert.notStrictEqual(s.accounts.offers.map(o => o.id).join(), first); assert.strictEqual(s.accounts.refreshAt, at + K.refreshTurns);
assert.ok(r.memo.some(m => /^Account board: [123] offers? on the Serving floor until Year \d+, Week \d+\.$/.test(m.text)));

// ---- qualifies and signing ----
s = game(); s.accounts.unlocked = true;
let o = offer(s, 2);
setCap(s, 29); assert.deepStrictEqual(A.qualifies(s, o), { ok: false, why: 'Needs average capability 30; the lab is at 29' });
setCap(s, 30, 8); assert.strictEqual(A.qualifies(s, o).ok, false); assert.ok(/within 7 of capability; the widest gap is 8/.test(A.qualifies(s, o).why));
setCap(s, 30, 7); s.market.trust = 49; assert.strictEqual(A.qualifies(s, o).ok, false);
s.market.trust = 60; assert.deepStrictEqual(A.qualifies(s, o), { ok: true, why: '' });
s.market.trust = 60; const cash0 = s.money.cash, tr0 = s.market.trust;
let c = cmd(s, { type: 'signAccount', id: o.id }); assert.ok(c.r.ok, c.r.why); s = c.s;
assert.strictEqual(s.money.cash, cash0 - 2 * K.signCost); near(s.market.trust, tr0 + 1);
assert.strictEqual(s.accounts.offers.length, 0); assert.strictEqual(s.accounts.active.length, 1);
let a = s.accounts.active[0];
assert.deepStrictEqual([a.tier, a.mood, a.signed, a.starts, a.ends], [2, 70, s.turn, s.turn + 2, s.turn + 2 + 104 - 1]);
assert.deepStrictEqual(s.pendingEvents.slice(-1), [{ type: 'account:signed', id: o.id, name: o.name, tier: 2 }]);
assert.ok(/^Signed Test Buyer 0 \(Banking, tier 2\): 20 PF reserved and \$\d+k a week from Year \d+, Week \d+ for 104 weeks\. Onboarding \$300k\. Public trust up 1\.$/
  .test(s.pendingMemo.slice(-1)[0].text), s.pendingMemo.slice(-1)[0].text);
assert.ok(s.accounts.used.indexOf(o.name) >= 0);
// tier 3 signs for +2 trust; declining costs nothing and takes the card off the board
o = offer(s, 3); setCap(s, 45, 4); s.market.trust = 60;
c = cmd(s, { type: 'signAccount', id: o.id }); assert.ok(c.r.ok, c.r.why); near(c.s.market.trust, 62); s = c.s;
o = offer(s, 1); const before = FR.clone(s);
c = cmd(s, { type: 'declineAccount', id: o.id }); assert.ok(c.r.ok); s = c.s;
assert.strictEqual(s.money.cash, before.money.cash); assert.strictEqual(s.market.trust, before.market.trust);
assert.strictEqual(s.accounts.offers.length, 0); assert.strictEqual(s.accounts.active.length, 2);
assert.strictEqual(cmd(s, { type: 'signAccount', id: o.id }).r.ok, false);
assert.strictEqual(cmd(s, { type: 'declineAccount', id: 'nope' }).r.ok, false);
// not enough cash
o = offer(s, 1); s.money.cash = 100; assert.ok(/^Onboarding .* costs \$150k/.test(cmd(s, { type: 'signAccount', id: o.id }).r.why));

// ---- maxActive: 4, and 6 once the Series B has closed ----
s = game(); s.accounts.unlocked = true; setCap(s, 45);
for (let i = 0; i < 4; i++) live(s, 1);
o = offer(s, 1); c = cmd(s, { type: 'signAccount', id: o.id });
assert.strictEqual(c.r.ok, false); assert.strictEqual(c.r.why, 'The book is full: at most 4 accounts at once');
s.money.roundsDone = ['seed', 'a', 'b']; assert.strictEqual(A.maxActive(s), 6);
c = cmd(s, { type: 'signAccount', id: o.id }); assert.ok(c.r.ok); s = c.s; live(s, 1);
o = offer(s, 1); assert.strictEqual(cmd(s, { type: 'signAccount', id: o.id }).r.why, 'The book is full: at most 6 accounts at once');

// ---- reserved PF: contract PF of live accounts comes out of serving before the open market ----
s = game(); s.accounts.unlocked = true;
o = offer(s, 2, { pfPerWeek: 14 }); s = cmd(s, { type: 'signAccount', id: o.id }).s;
assert.strictEqual(A.reservedPF(s), 0, 'onboarding: nothing reserved for 2 weeks'); assert.strictEqual(A.feeRevenue(s), 0);
s.turn += 2; assert.strictEqual(A.reservedPF(s), 14);
s.sliders = { training: 40, serving: 30, safety: 20, research: 10 }; s.compute.rentPF = 200;
const al = FR.sim.allocate(s);
near(al.serving.reserved, 14); near(al.serving.open, al.serving.pf - 14);
const sp = FR.money.revenueSplit(s, 38);
assert.deepStrictEqual([sp.reserved, sp.open], [14, 24]);
near(sp.market, FR.money.marketRevenue(s, 24)); near(sp.contracts, A.feeRevenue(s)); near(sp.total, sp.market + sp.contracts);
near(FR.money.revenue(s, 38), sp.total);
// serving below the reservation: contracts first, the open market gets nothing, the fee pays for the PF served
const low = FR.money.revenueSplit(s, 7);
assert.deepStrictEqual([low.open, low.market], [0, 0]); near(low.contracts, A.feeRevenue(s) / 2);
// the forecast carries contract fees
const f = FR.sim.forecast(s);
near(f.contracts, A.feeRevenue(s, Math.min(14, f.alloc.serving.pf))); near(f.revenue, f.market + f.contracts);
assert.ok(f.contracts > 0);

// ---- fees: incident factor halves them, the DeepField share applies, Zeta's drag does not ----
s = game(); a = live(s, 2);
const fee = A.feeRevenue(s); near(fee, a.feePerWeek); near(A.contracted(s), a.feePerWeek);
s.model.skills.coding.incidents.push(s.turn); near(A.feeRevenue(s), fee * MK.incidentRevenue); s.model.skills.coding.incidents = [];
s.compute.deals.push({ rivalId: 'deepfield', kind: 'compute', pf: 40, revShare: 0.15, ends: s.turn + 20 });
near(A.feeRevenue(s), fee * 0.85); s.compute.deals = [];
const z = s.market.rivals.find(x => x.id === 'zeta'); FR.SKILLS.forEach(k => { z.cap[k] = 90; });
assert.ok(FR.money.zetaFactor(s) < 1); near(A.feeRevenue(s), fee);

// ---- valuation: fees count as revenue at revMultiple; the contracted backlog at backlogMultiple ----
s = game(); a = live(s, 3, { ends: FR.sim.newGame({ seed: 5 }).turn + 99 });
assert.strictEqual(MK.backlogMultiple, 4);
assert.strictEqual(A.backlog(s), a.feePerWeek * (a.ends - s.turn + 1));
s.money.revenue = 0; const v1 = FR.money.valuation(s);
s.accounts.active = []; const v0 = FR.money.valuation(s);
near(v1 - v0, MK.backlogMultiple * a.feePerWeek * 100 * FR.money.trustMult(s), 2);

// ---- mood arithmetic ----
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = 999; a = live(s, 1, { pfPerWeek: 10 });
const step = (pf) => { const q = rep(s.turn); A.step(s, serve(pf), FR.rng(s.turn), q); return q; };
step(10); assert.strictEqual(a.mood, 71, 'served in full and in step: +1');
setCap(s, 30, 6); step(10); assert.strictEqual(a.mood, 71, 'out of step: no rise');
setCap(s, 30); for (let i = 0; i < 20; i++) step(10); assert.strictEqual(a.mood, 80, 'rises toward 80 and stops');
a.mood = 85; step(10); assert.strictEqual(a.mood, 84, 'above 80 drifts back');
a.mood = 70; step(4); assert.strictEqual(a.mood, 67, 'unserved PF: -3'); assert.strictEqual(a.served, 4);
A.lift(s, 10, 26); assert.strictEqual(a.mood, 77); assert.ok(A.ready(s));
step(4); assert.strictEqual(a.mood, 75.5, 'readiness work halves the unserved penalty');
s.turn += 26; assert.ok(!A.ready(s)); a.starts = 0; step(4); assert.strictEqual(a.mood, 72.5);
// incidents: -25 for the lab, -10 for a rival, after the ladder
a.mood = 70; let q = rep(s.turn); q.events.push({ type: 'model:incident', skill: 'agents', gap: 22 }); A.shock(s, q); assert.strictEqual(a.mood, 45);
q = rep(s.turn); q.events.push({ type: 'market:rivalIncident', rivalId: 'opal', trust: 2 }); A.shock(s, q); assert.strictEqual(a.mood, 35);
assert.ok(/^Account mood down 10 after the Opal AI incident: Live Buyer 0 35\.$/.test(q.memo[0].text), q.memo[0].text);
a.mood = 70; q = rep(s.turn); q.events.push({ type: 'market:rivalIncident', rivalId: 'opal', trust: 2 }, { type: 'market:rivalIncident', rivalId: 'zeta', trust: 2 }); A.shock(s, q);
assert.ok(/^Account mood down 20 after incidents at Opal AI and Zeta: Live Buyer 0 50\.$/.test(q.memo[0].text), q.memo[0].text);

// ---- churn on an incident: below 30 the account leaves next turn, trust -2, memo and news, gone for the run ----
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = s.turn + 3; a = live(s, 2, { mood: 50, name: 'Halden Mutual' });
q = rep(s.turn); q.events.push({ type: 'model:incident', skill: 'coding', gap: 21 }); A.shock(s, q);
assert.strictEqual(a.mood, 25); assert.strictEqual(s.accounts.active.length, 1, 'still in the book this week');
assert.ok(q.memo.some(m => m.kind === 'flag' && /Below 30, Halden Mutual ends its contract next week\.$/.test(m.text)));
s.turn++; const t0 = s.market.trust; q = step(0);
assert.strictEqual(s.accounts.active.length, 0); near(s.market.trust, t0 - 2);
assert.deepStrictEqual(q.events.filter(e => e.type === 'account:churned'), [{ type: 'account:churned', id: a.id, name: 'Halden Mutual', why: 'churn' }]);
assert.deepStrictEqual(s.accounts.lost.map(x => [x.name, x.why]), [['Halden Mutual', 'churn']]);
assert.ok(q.memo.some(m => /^Halden Mutual has ended its contract, citing reliability concerns\./.test(m.text)));
assert.ok(q.news.some(x => x.text === 'Halden Mutual ends its contract with ' + s.lab.name + ' citing reliability concerns.'));
// never re-offered: deal the board many times, the name never comes back
for (let i = 0; i < 60; i++) { s.accounts.refreshAt = s.turn + 1; step(0); assert.ok(!s.accounts.offers.some(x => x.name === 'Halden Mutual')); s.accounts.offers = []; }
// through the full turn: an incident in endTurn moves mood; unserved PF churns a neglected account
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = 999; a = live(s, 1, { mood: 31, pfPerWeek: 20 });
s.sliders = { training: 90, serving: 0, safety: 5, research: 5 };
s = FR.sim.endTurn(s, []); assert.strictEqual(s.accounts.active[0].mood, 28);
s = FR.sim.endTurn(s, []); assert.strictEqual(s.accounts.active.length, 0); assert.strictEqual(s.accounts.lost[0].why, 'churn');
assert.ok(s.lastReport.events.some(e => e.type === 'account:churned'));

// ---- renewal at the next tier's fee when mood >= 60; otherwise the account leaves quietly ----
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = 999;
a = live(s, 1, { ends: s.turn, mood: 65 }); const b = live(s, 2, { ends: s.turn, mood: 55 });
q = step(1000);
assert.strictEqual(a.tier, 2); assert.strictEqual(a.feePerWeek, A.fee(2, s.turn + 1)); assert.strictEqual(a.ends, s.turn + K.turns[1]);
assert.ok(s.accounts.active.indexOf(a) >= 0); assert.ok(s.accounts.active.indexOf(b) < 0);
assert.deepStrictEqual(s.accounts.lost.map(x => [x.name, x.why]), [[b.name, 'expired']]);
assert.ok(q.events.some(e => e.type === 'account:churned' && e.why === 'expired'));
assert.ok(q.memo.some(m => m.text.indexOf(a.name + ' renews for 104 weeks at ') === 0));
assert.strictEqual(q.memo.filter(m => /renews|without renewal/.test(m.text)).length, 2);
// a tier 3 renews at tier 3 (this year's fee)
s.turn = 60; a.tier = 3; a.ends = 60; a.mood = 70; step(1000); assert.strictEqual(a.tier, 3); assert.strictEqual(a.ends, 60 + 156);
// the renewal-due line 8 weeks out
a.ends = s.turn + K.dueWarn + 1; s.turn++; q = step(1000); assert.ok(q.memo.some(m => m.kind === 'due' && m.text.indexOf(a.name + ' contract ends') === 0));

// ---- at most two account memo lines a week, the urgent ones first ----
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = s.turn + 1;
for (let i = 0; i < 4; i++) live(s, 1, { ends: s.turn, mood: 70 });
live(s, 1, { mood: 10 });
q = step(1000);
assert.strictEqual(q.memo.length, K.memoMax); assert.ok(/has ended its contract/.test(q.memo[0].text));
q.events.push({ type: 'model:incident', skill: 'coding', gap: 21 }); A.shock(s, q);
assert.strictEqual(q.memo.length, K.memoMax, 'the week already used both lines');
// two accounts leaving in the same week share one memo line (none is lost under the two-line cap)
s = game(); s.accounts.unlocked = true; s.accounts.refreshAt = s.turn + 50;
live(s, 1, { mood: 10 }); live(s, 1, { mood: 12 }); live(s, 1, { mood: 11 });
q = step(1000);
assert.strictEqual(s.accounts.lost.length, 3);
assert.strictEqual(q.memo.filter(m => /have ended their contracts, citing reliability concerns\. \$[\d.]+k a week and \d+ reserved PF released\. Public trust down 6\.$/.test(m.text) && /, .+ and /.test(m.text)).length, 1, JSON.stringify(q.memo));

// ---- through endTurn: account lines come after the money lines ----
s = game(); s.accounts.unlocked = false; setCap(s, 25);
s = FR.sim.endTurn(s, []);
const lines = s.lastReport.memo.map(m => m.text), iu = lines.indexOf('Enterprise buyers are asking for meetings. First account offers on the Serving floor.');
assert.ok(iu >= 0); assert.ok(s.accounts.offers.length >= 1);
assert.ok(s.lastReport.events.some(e => e.type === 'account:offers'));

// ---- projects: exactly two account templates, tier 2, dealt only once accounts have unlocked ----
const PT = FR.projects.K.T.filter(t => t.needs === 'accounts');
assert.deepStrictEqual(PT.map(t => [t.name, t.tier, t.turns.join('-')]), [['Enterprise readiness work', 2, '4-6'], ['Reference customer program', 2, '3-5']]);
assert.deepStrictEqual(PT[0].pay.accounts, { mood: 10, turns: 26 }); assert.strictEqual(PT[1].pay.refs, 2);
s = game(); s.research.tier = 3; s.accounts.unlocked = false;
for (let i = 0; i < 40; i++) { s.projects.refreshAt = s.turn; FR.projects.step(s, FR.sim.allocate(s), FR.rng(100 + i), rep(s.turn)); assert.ok(!s.projects.offers.some(o => o.tpl === 'readiness' || o.tpl === 'reference')); }
s.accounts.unlocked = true; let seen = new Set();
for (let i = 0; i < 80; i++) { s.projects.refreshAt = s.turn; FR.projects.step(s, FR.sim.allocate(s), FR.rng(200 + i), rep(s.turn)); s.projects.offers.forEach(o => seen.add(o.tpl)); }
assert.ok(seen.has('readiness') && seen.has('reference'));
// completion effects
s = game(); s.accounts.unlocked = true; a = live(s, 1, { mood: 50 });
s.projects.active = [{ uid: 'p1', tpl: 'readiness', name: 'Enterprise readiness work', kind: 'business', skill: null, turnsLeft: 1, turns: 4, pfPerTurn: 0, cost: 0,
  risk: 0, payoff: { accounts: { mood: 10, turns: 26 } }, started: s.turn - 4, overrun: false, progress: 3.999999 }];
q = rep(s.turn); FR.projects.step(s, FR.sim.allocate(s), FR.rng(3), q);
assert.strictEqual(a.mood, 60); assert.strictEqual(s.accounts.readyUntil, s.turn + 25);
assert.ok(q.memo.some(m => /^Enterprise readiness work complete\. Account mood up 10; unserved-PF penalty halved through/.test(m.text)));
s.projects.active = [{ uid: 'p2', tpl: 'reference', name: 'Reference customer program', kind: 'business', skill: null, turnsLeft: 1, turns: 3, pfPerTurn: 0, cost: 0,
  risk: 0, payoff: { refs: 2 }, started: s.turn - 3, overrun: false, progress: 2.999999 }];
FR.projects.step(s, FR.sim.allocate(s), FR.rng(4), rep(s.turn)); assert.strictEqual(s.accounts.boost, 2);
// the next two offers arrive one tier higher: at average cap 20 only tier 1 is in reach
s.accounts.offers = []; setCap(s, 20); s.accounts.refreshAt = s.turn + 1;
let tiers = []; for (let i = 0; i < 6 && tiers.length < 3; i++) { s.accounts.refreshAt = s.turn + 1; step(0); tiers = tiers.concat(s.accounts.offers.map(x => x.tier)); }
assert.deepStrictEqual(tiers.slice(0, 3), [2, 2, 1]); assert.strictEqual(s.accounts.boost, 0);

// ---- debug ----
const d = A.debug(s);
['active', 'contracted', 'avgMood', 'unservedPF', 'lost'].forEach(k => assert.ok(k in d, k));
console.log('accounts ok');

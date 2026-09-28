// V0.4 (docs/frontier-handoff-v0.4.html §6): client work trains the sector's skill (field PF, no spillover, drift), renewal
// meetings (each choice at mood 44 / 64 / 72, push up failing on tier minimums, the unanswered rule), client asks (each type
// met and missed, the decline window, the cold cost ask, unwinnable asks skipped), sector swings (exclusivity, cooldown,
// hot dealing and fees, cold dealing and drift), memoMax 3, the commands, events and the 0.3 save migration.
const assert = require('assert');
const FR = require('./_load')();
const A = FR.accounts, K = A.K;

const rep = (t) => ({ turn: t, events: [], memo: [], news: [], flows: {}, commands: [] });
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-6), a + ' vs ' + b);
const setCap = (s, c, gap) => FR.SKILLS.forEach(k => { s.model.skills[k].cap = c; s.model.skills[k].safe = c - (gap || 0); });
const cmd = (s, c) => { const r = FR.sim.applyCommands(s, [c]); return { s: r.state, r: r.results[0] }; };
const serve = (pf) => ({ serving: { pf } });
function game(seed) {
  const s = FR.sim.newGame({ seed: seed || 5 });
  s.money.cash = 50e6; s.market.trust = 60; setCap(s, 30); s.accounts.unlocked = true; s.accounts.refreshAt = 9999;
  s.accounts.sectors.nextAt = 9999;
  return s;
}
let n = 0;
function live(s, tier, extra) {
  const a = Object.assign({ id: 'L' + (n++), name: 'Live Buyer ' + n, sector: 'Retail', tier, pfPerWeek: 10 * tier, feePerWeek: A.fee(tier, s.turn),
    ends: s.turn + 50, signed: s.turn - 2, starts: s.turn, mood: K.mood.start, served: 0, turns: K.turns[tier - 1], meeting: null, ask: null, field: 0 }, extra || {});
  s.accounts.active.push(a); return a;
}
const step = (s, pf, seed) => { const q = rep(s.turn); A.step(s, serve(pf == null ? 1000 : pf), FR.rng(seed || s.turn), q); return q; };

// ---- K: the design numbers ----
assert.deepStrictEqual(K.sectorSkill, { Banking: 'coding', Retail: 'coding', Energy: 'coding', Telecoms: 'coding',
  Insurance: 'reasoning', Pharma: 'reasoning', Legal: 'reasoning', Logistics: 'agents', 'Public sector': 'agents' });
assert.ok(K.NAMES.every(x => K.sectorSkill[x[1]]), 'every sector maps to a skill');
assert.deepStrictEqual([K.NAMES.filter(x => A.skillOf(x[1]) === 'coding').length, K.NAMES.filter(x => A.skillOf(x[1]) === 'reasoning').length,
  K.NAMES.filter(x => A.skillOf(x[1]) === 'agents').length], [11, 9, 10]);
assert.ok(K.field.rate > 0 && K.field.rate <= 0.35);
assert.deepStrictEqual([K.meet.renewMood, K.meet.upMood, K.meet.upSure, K.meet.upOdds, K.meet.coldAdd], [45, 60, 70, 0.5, 10]);
assert.deepStrictEqual([K.ask.chance, K.ask.maxOpen, K.ask.every, K.ask.quiet, K.ask.declineWeeks, K.ask.bonusWeeks, K.ask.metMood, K.ask.missMood, K.ask.declineMood],
  [0.35, 2, 13, 12, 2, 4, 10, 15, 5]);
assert.deepStrictEqual(K.ask.weights, { cap: 35, inStep: 25, peak: 20, clean: 20 });
assert.deepStrictEqual([K.sector.every, K.sector.hotChance, K.sector.hotWeight, K.sector.hotFee, K.sector.hotTop], [26, 0.6, 3, 1.25, 85]);
assert.strictEqual(K.memoMax, 3);

// ---- §3.1 field PF: last week's served PF × rate on the sector's skill; applied with no spillover, with drift ----
let s = game(); setCap(s, 30);
const lg = live(s, 1, { sector: 'Logistics', served: 20 }), bk = live(s, 1, { sector: 'Banking', served: 10 });
live(s, 1, { sector: 'Pharma', served: 6, starts: s.turn + 1 });            // onboarding: no field work yet
live(s, 1, { sector: 'Legal', served: 8, mood: 20 });                         // leaving: none either
let f = A.fieldPF(s);
near(f.agents, 20 * K.field.rate, 0.01); near(f.coding, 10 * K.field.rate, 0.01); assert.strictEqual(f.reasoning, 0);
let alloc = FR.sim.allocate(s), g1 = FR.model.gains(s, alloc);
const s0 = FR.clone(s); s0.accounts.active = []; const g0 = FR.model.gains(s0, alloc);
assert.ok(g1.field.agents > 0 && g1.field.coding > 0 && g1.field.reasoning === 0);
assert.ok(g1.field.agents > g1.field.coding, 'more served PF, more gain');
near(g1.cap.agents - g0.cap.agents, g1.field.agents, 1e-9); near(g1.cap.reasoning, g0.cap.reasoning, 1e-9);   // no spillover
assert.ok(g1.safe.agents < g0.safe.agents, 'client work drifts safety like any training');
// equals what field PF of training would produce (staff per training PF), diminishing returns included
const spp = alloc.training.staff / alloc.training.pf, dim = Math.pow(1 - (30 + g0.cap.agents) / 100, FR.model.K.dimExp);
near(g1.field.agents, FR.sim.output(FR.model.K.trainBase, f.agents, spp * f.agents) * dim, 1e-9);
// the forecast carries it; endTurn applies it (flows.model.field) and records a.field for the readout
const fc = FR.sim.forecast(s); near(fc.fieldGain.agents, g1.field.agents, 1e-9); near(fc.fieldPF.agents, f.agents, 1e-9);
assert.ok(/^Client work: \+[\d.]+ agents, \+[\d.]+ coding a week\.$/.test(FR.model.fieldText(g1.field)), FR.model.fieldText(g1.field));
let t = FR.sim.endTurn(s, []);
assert.ok(t.lastReport.flows.model.field.agents > 0);
const lg2 = t.accounts.active.find(a => a.id === lg.id); near(lg2.field, lg2.served * K.field.rate, 0.01);
assert.ok(A.debug(t).field && 'asksOpen' in A.debug(t) && 'meetingsOpen' in A.debug(t) && Array.isArray(A.debug(t).sectors));
// an underserved account trains less
s = game(); live(s, 1, { sector: 'Logistics', pfPerWeek: 10 }); step(s, 4);
near(A.fieldPF(s).agents, 4 * K.field.rate, 0.01);

// ---- §3.2 renewal meetings ----
// the meeting opens 8 weeks out (event, 'due' line), the memo warns at 4 and 1 weeks, unanswered
s = game(); let a = live(s, 1, { ends: s.turn + 8 });
let q = step(s); assert.deepStrictEqual(a.meeting, { opens: s.turn, answer: null });
assert.ok(q.events.some(e => e.type === 'account:meeting' && e.id === a.id && e.ends === a.ends));
assert.ok(q.memo.some(m => m.kind === 'due' && /contract ends .*Renewal meeting open: Renew, Push up or Let go/.test(m.text)), JSON.stringify(q.memo));
const warned = [];
for (let i = 0; i < 7; i++) { s.turn++; q = step(s); if (q.memo.some(m => m.kind === 'due' && m.text.indexOf(a.name) === 0)) warned.push(a.ends - s.turn); }
assert.deepStrictEqual(warned, [4, 1]);
assert.ok(A.meetings(s).length === 1 && A.debug(s).meetingsOpen === 1);
// commands: before the window, unknown choice, tier 3 push up
s = game(); a = live(s, 1, { ends: s.turn + 20 });
assert.ok(!cmd(s, { type: 'renewAccount', id: a.id, choice: 'renew' }).r.ok, 'no meeting yet');
a.ends = s.turn + 5; a.meeting = { opens: s.turn, answer: null };
assert.ok(!cmd(s, { type: 'renewAccount', id: a.id, choice: 'maybe' }).r.ok);
let c = cmd(s, { type: 'renewAccount', id: a.id, choice: 'up' }); assert.ok(c.r.ok); assert.strictEqual(c.s.accounts.active.find(x => x.id === a.id).meeting.answer, 'up');
assert.ok(/renewal meeting: Push up\./.test(c.s.pendingMemo.slice(-1)[0].text));
c = cmd(c.s, { type: 'renewAccount', id: a.id, choice: 'go' }); assert.strictEqual(c.s.pendingMemo.filter(m => m.key === 'meeting:' + a.id).length, 1, 'the choice can change; one line');
a.tier = 3; assert.ok(!cmd(s, { type: 'renewAccount', id: a.id, choice: 'up' }).r.ok);

// resolve one account at its last week with choice `pick` and mood `m` (the week's +1 in-step rise is undone by
// starting it 1 lower). Returns { a, s, q, lost }.
function end(pick, m, opts) {
  opts = opts || {};
  const s = game(opts.seed); if (opts.trust != null) s.market.trust = opts.trust;
  if (opts.cold) s.accounts.sectors.cold = { name: 'Retail', until: s.turn + 10, from: s.turn - 3 };
  const a = live(s, opts.tier || 1, { ends: s.turn, mood: m - (opts.cold ? 0 : 1), meeting: { opens: s.turn - 8, answer: pick } });
  const tr = s.market.trust, q = step(s, 1000, opts.seed);
  const lost = s.accounts.lost.find(x => x.name === a.name);
  return { a, s, q, lost, dTrust: s.market.trust - tr };
}
// Renew: 44 lapses ('expired', why in the memo), 64 and 72 renew at the same tier, PF unchanged, fee repriced
let r = end('renew', 44); assert.strictEqual(r.lost.why, 'expired'); assert.ok(r.q.memo.some(m => /contract ended without renewal: mood 44, renewal needs 45\./.test(m.text)), JSON.stringify(r.q.memo));
r = end('renew', 64); assert.deepStrictEqual([r.a.tier, r.a.pfPerWeek, r.a.feePerWeek, r.a.ends, r.a.meeting], [1, 10, A.fee(1, r.s.turn + 1), r.s.turn + 52, null]);
assert.ok(r.q.events.some(e => e.type === 'account:renewed' && e.tier === 1 && e.up === false));
r = end('renew', 72); assert.strictEqual(r.a.tier, 1); assert.ok(!r.lost);
// Push up: 44 lapses (Renew does not qualify either), 64 is even odds (a refusal renews at the same tier; never lost),
// 72 goes one tier up with PF scaled
r = end('up', 44); assert.strictEqual(r.lost.why, 'expired');
const tiers = new Set();
for (let sd = 1; sd <= 30; sd++) { r = end('up', 64, { seed: sd }); assert.ok(!r.lost, 'a push up never loses the client'); tiers.add(r.a.tier);
  if (r.a.tier === 1) assert.ok(r.q.memo.some(m => /declined the push to tier 2 at mood 64/.test(m.text))); }
assert.deepStrictEqual([...tiers].sort(), [1, 2], 'mood 64: sometimes up, sometimes the same tier');
r = end('up', 72); assert.deepStrictEqual([r.a.tier, r.a.pfPerWeek, r.a.feePerWeek, r.a.ends], [2, 19, A.fee(2, r.s.turn + 1), r.s.turn + 104]);
assert.ok(r.q.events.some(e => e.type === 'account:renewed' && e.tier === 2 && e.up === true));
// Let go: at any mood; leaves at ends, why 'let go', no trust cost, rests K.cooldown weeks
[44, 64, 72].forEach(m => {
  r = end('go', m); assert.strictEqual(r.lost.why, 'let go'); assert.strictEqual(r.dTrust, 0);
  assert.ok(r.s.accounts.cool.some(x => x.name === r.a.name && x.why === 'let go' && x.until === r.s.turn + K.cooldown));
  assert.ok(r.q.events.some(e => e.type === 'account:churned' && e.why === 'let go'));
});
// a push up failing on the tier minimums (trust under tier 2's 48) falls back to Renew; below 45 it lapses
r = end('up', 72, { trust: 47 }); assert.deepStrictEqual([r.a.tier, r.a.pfPerWeek], [1, 10]);
assert.ok(r.q.memo.some(m => /Push up to tier 2 not possible: Needs public trust 48/.test(m.text)), JSON.stringify(r.q.memo));
r = end('up', 44, { trust: 47 }); assert.strictEqual(r.lost.why, 'expired');
// the meeting view quotes the odds plainly
s = game(); a = live(s, 1, { ends: s.turn + 3, mood: 64, meeting: { opens: s.turn - 5, answer: 'up' } });
let v = A.meetingView(s, a.id);
assert.strictEqual(v.up.text, 'Push up to tier 2: accepts at mood 70+ (now 64: even odds; a refusal renews at tier 1).');
assert.deepStrictEqual([v.up.chance, v.renew.ok, v.weeksLeft], [0.5, true, 4]);
a.mood = 72; assert.strictEqual(A.meetingView(s, a.id).up.chance, 1); a.mood = 50; assert.strictEqual(A.meetingView(s, a.id).up.chance, 0);
// unanswered (owner call): same tier when mood allows (45; 55 in a cold sector), otherwise 'expired'
r = end(null, 44); assert.strictEqual(r.lost.why, 'expired'); assert.ok(r.q.memo.some(m => /No answer to the renewal meeting\./.test(m.text)));
r = end(null, 50); assert.deepStrictEqual([r.a.tier, r.a.ends], [1, r.s.turn + 52]); assert.ok(r.q.memo.some(m => /No answer to the renewal meeting: same tier\./.test(m.text)));
r = end(null, 50, { cold: true }); assert.strictEqual(r.lost.why, 'expired');
r = end('up', 72, { cold: true }); assert.strictEqual(r.a.tier, 1, 'cold: push up needs 70, sure at 80; 72 is even odds or a same-tier renewal');
r = end(null, 56, { cold: true }); assert.strictEqual(r.a.tier, 1); assert.ok(!r.lost);

// ---- §3.3 client asks ----
// put an ask on an account by hand (fields as makeAsk writes them)
function ask(s, a, o) {
  a.ask = Object.assign({ skill: A.skillOf(a), arrived: s.turn - 1, from: s.turn - 1, progress: 0, answered: null, declineBy: s.turn + 1,
    reward: Math.round(K.ask.bonusWeeks * a.feePerWeek / 1000) * 1000 }, o);
  return a.ask;
}
// cap: met the week the skill reaches the target (bonus 4 × fee, mood +10); missed at due (mood −15)
s = game(); a = live(s, 1, { sector: 'Logistics', mood: 60 }); ask(s, a, { type: 'cap', target: 31, weeks: 10, due: s.turn + 5 });
q = step(s); assert.strictEqual(a.ask.progress, 30); s.model.skills.agents.cap = 31.2; s.turn++; q = step(s);
assert.strictEqual(a.ask, null); assert.strictEqual(a.mood, 60 + 1 + 1 + 10);
assert.strictEqual(q.flows.accounts.bonus, 4 * a.feePerWeek); assert.ok(q.events.some(e => e.type === 'account:askMet' && e.bonus === 4 * a.feePerWeek));
assert.ok(q.memo.some(m => /^Live Buyer \d+ ask met: Agents capability 31\.2 against 31\. Bonus \$[\d.]+k paid this week; mood 72\.$/.test(m.text)), JSON.stringify(q.memo));
s = game(); a = live(s, 1, { sector: 'Logistics', mood: 60 }); ask(s, a, { type: 'cap', target: 40, weeks: 10, due: s.turn });
q = step(s); assert.strictEqual(a.ask, null); assert.strictEqual(a.mood, 60 + 1 - 15); assert.ok(q.events.some(e => e.type === 'account:askMissed'));
// inStep: consecutive weeks with every gap ≤ 3; missed once the weeks left cannot make it
s = game(); a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'inStep', skill: null, target: 3, weeks: 2, due: s.turn + 5 });
step(s); assert.strictEqual(a.ask.progress, 1); s.turn++; q = step(s); assert.strictEqual(a.ask, null); assert.ok(q.flows.accounts.bonus > 0);
s = game(); a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'inStep', skill: null, target: 3, weeks: 3, due: s.turn + 2 }); setCap(s, 30, 4);
q = step(s); assert.strictEqual(a.ask, null, '0 + 2 weeks left < 3: missed'); assert.ok(q.events.some(e => e.type === 'account:askMissed'));
// peak: reserved PF rises by the amount for the window; any unserved week misses; served through due is met
s = game(); a = live(s, 1, { mood: 60, pfPerWeek: 10 }); ask(s, a, { type: 'peak', target: 6, weeks: 2, from: s.turn + 1, due: s.turn + 2 });
assert.strictEqual(A.reservedPF(s), 10); s.turn++; assert.strictEqual(A.reservedPF(s), 16); assert.strictEqual(A.pfOf(s, a), 16);
near(A.feeRevenue(s, 16), a.feePerWeek * FR.money.incidentFactor(s), 1, 'the extra PF is unpaid; the fee stays whole');
step(s, 16); assert.strictEqual(a.ask.progress, 1); s.turn++; q = step(s, 16); assert.strictEqual(a.ask, null); assert.ok(q.flows.accounts.bonus > 0);
s.turn++; assert.strictEqual(A.reservedPF(s), 10);
s = game(); a = live(s, 1, { mood: 60, pfPerWeek: 10 }); ask(s, a, { type: 'peak', target: 6, weeks: 2, from: s.turn, due: s.turn + 1 });
q = step(s, 12); assert.strictEqual(a.ask, null); assert.strictEqual(a.mood, 60 - 3 - 15, 'unserved penalty and the miss');
assert.ok(q.memo.some(m => /ask missed: 12 of 16 PF served this week/.test(m.text)), JSON.stringify(q.memo));
// clean: met at due with no incident; a lab incident (shock) fails it
s = game(); a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'clean', target: 0, weeks: 13, due: s.turn });
q = step(s); assert.strictEqual(a.ask, null); assert.ok(q.events.some(e => e.type === 'account:askMet'));
s = game(); a = live(s, 1, { mood: 70 }); ask(s, a, { type: 'clean', target: 0, weeks: 13, due: s.turn + 5 });
q = rep(s.turn); q.events.push({ type: 'model:incident', skill: 'coding', gap: 22 }); A.shock(s, q);
assert.strictEqual(a.ask, null); assert.strictEqual(a.mood, 70 - 25 - 15); assert.ok(q.events.some(e => e.type === 'account:askMissed'));
// the bonus lands in this week's revenue through endTurn (contract revenue, cash)
s = game(); s.sliders = { training: 30, serving: 40, safety: 20, research: 10 }; s.compute.rentPF = 200;
a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'clean', target: 0, weeks: 13, due: s.turn });
t = FR.sim.endTurn(s, []);
const mf = t.lastReport.flows.money; assert.ok(mf.askBonus > 0); assert.strictEqual(mf.askBonus, Math.round(a.ask.reward * FR.money.incidentFactor(s)));
assert.strictEqual(t.money.revContracts, mf.contracts); assert.ok(t.money.revContracts >= mf.askBonus);
// the decline window: 2 weeks from arrival, mood −5; after it, refused; unanswered counts as accepted (it still runs)
s = game(); a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'clean', target: 0, weeks: 13, due: s.turn + 10, arrived: s.turn, declineBy: s.turn + 2 });
c = cmd(s, { type: 'answerAsk', id: a.id, accept: false }); assert.ok(c.r.ok);
let a2 = c.s.accounts.active.find(x => x.id === a.id); assert.strictEqual(a2.ask, null); assert.strictEqual(a2.mood, 55);
s.turn += 3; c = cmd(s, { type: 'answerAsk', id: a.id, accept: false }); assert.ok(!c.r.ok && /window to decline/.test(c.r.why));
c = cmd(s, { type: 'answerAsk', id: a.id, accept: true }); assert.ok(c.r.ok); assert.strictEqual(c.s.accounts.active.find(x => x.id === a.id).ask.answered, true);
assert.ok(A.askView(s, a.id).declinable === false);
// the cold cost ask: accept = fee × 0.85 for the term and mood +10; decline = mood −10; unanswered past the window = accepted
s = game(); a = live(s, 1, { mood: 60 }); const fee0 = a.feePerWeek;
ask(s, a, { type: 'cost', target: 0.15, due: a.ends, weeks: 50, arrived: s.turn, declineBy: s.turn + 2 });
c = cmd(s, { type: 'answerAsk', id: a.id, accept: true }); a2 = c.s.accounts.active.find(x => x.id === a.id);
assert.deepStrictEqual([a2.feePerWeek, a2.mood, a2.ask], [Math.round(fee0 * 0.85 / 1000) * 1000, 70, null]);
c = cmd(s, { type: 'answerAsk', id: a.id, accept: false }); a2 = c.s.accounts.active.find(x => x.id === a.id);
assert.deepStrictEqual([a2.feePerWeek, a2.mood, a2.ask], [fee0, 50, null]);
s.turn += 2; q = step(s); assert.strictEqual(a.feePerWeek, Math.round(fee0 * 0.85 / 1000) * 1000); assert.strictEqual(a.ask, null);
assert.ok(q.memo.some(m => /fee cut applied, unanswered/.test(m.text)));
// arrival: 13 weeks after go-live, every 13 weeks, 35%; in a cold sector always cost; at most 2 open; none in the last 12
function arrivals(setup, seeds) {
  const out = [];
  for (let sd = 1; sd <= (seeds || 60); sd++) {
    const s = game(sd); const as = setup(s); const q = step(s, 1000, sd);
    as.forEach(a => { if (a.ask) out.push({ a, q, type: a.ask.type, s }); });
  }
  return out;
}
let got = arrivals(s => [live(s, 1, { starts: s.turn - 13, ends: s.turn + 60, sector: 'Banking' })], 100);
assert.ok(got.length > 15 && got.length < 55, 'about 35%: ' + got.length);
assert.ok(got.every(x => x.q.events.some(e => e.type === 'account:ask' && e.ask === x.type)));
assert.ok(got.every(x => x.q.memo.some(m => m.text.indexOf(x.a.name + ' asks ') === 0)));
const types = new Set(got.map(x => x.type)); assert.ok(types.has('cap') && types.has('inStep') && types.has('peak') && types.has('clean'), [...types].join());
assert.ok(!types.has('cost'));
got.forEach(x => { const q = x.a.ask; assert.ok(q.due <= x.a.ends - K.ask.quiet, 'no ask due in the last 12 weeks'); assert.strictEqual(q.declineBy, x.s.turn + 2); assert.strictEqual(q.reward, 4 * x.a.feePerWeek); });
got.filter(x => x.type === 'cap').forEach(x => { const d = x.a.ask.target - x.s.model.skills.coding.cap; assert.ok(d >= 3 && d <= 5 && x.a.ask.weeks >= 8 && x.a.ask.weeks <= 16); });
assert.strictEqual(arrivals(s => [live(s, 1, { starts: s.turn - 12, ends: s.turn + 60 })]).length, 0, 'no sooner than 13 weeks');
assert.strictEqual(arrivals(s => [live(s, 1, { starts: s.turn - 14, ends: s.turn + 60 })]).length, 0, 'every 13 weeks');
assert.strictEqual(arrivals(s => [live(s, 1, { starts: s.turn - 26, ends: s.turn + 12 })]).length, 0, 'not in the last 12 weeks');
got = arrivals(s => { s.accounts.sectors.cold = { name: 'Banking', until: s.turn + 20, from: s.turn }; return [live(s, 1, { starts: s.turn - 13, sector: 'Banking' })]; });
assert.ok(got.length > 5 && got.every(x => x.type === 'cost' && x.a.ask.target === 0.15));
assert.ok(/asks for a 15% fee cut for the rest of its term/.test(got[0].q.memo.find(m => / asks /.test(m.text)).text));
got = arrivals(s => [live(s, 1, { starts: s.turn - 13 }), live(s, 1, { starts: s.turn - 13 }), live(s, 1, { starts: s.turn - 13 }), live(s, 1, { starts: s.turn - 13 })], 60);
const perWeek = {}; got.forEach(x => { perWeek[x.s.seed] = (perWeek[x.s.seed] || 0) + 1; });
assert.ok(Object.keys(perWeek).length && Object.values(perWeek).every(v => v <= K.ask.maxOpen), 'at most 2 open');
// unwinnable asks are skipped: with no training, safety or research share, no cap ask (the target is out of reach)
got = arrivals(s => { s.sliders = { training: 0, serving: 100, safety: 0, research: 0 }; return [live(s, 1, { starts: s.turn - 13 })]; }, 120);
assert.ok(got.length > 0 && !got.some(x => x.type === 'cap'));
// with a gap past the incident line, no clean ask
got = arrivals(s => { s.model.skills.agents.cap = s.model.skills.agents.safe + 22; return [live(s, 1, { starts: s.turn - 13 })]; }, 120);
assert.ok(!got.some(x => x.type === 'clean'));
// askView: progress text and onTrack for the UI and the bots
s = game(); s.compute.rentPF = 300; a = live(s, 1, { sector: 'Logistics' }); ask(s, a, { type: 'cap', target: 31, weeks: 10, due: s.turn + 9 });
v = A.askView(s, a.id); assert.strictEqual(v.progressText, '30 / 31 · 10 weeks left'); assert.strictEqual(v.onTrack, true); assert.strictEqual(v.declinable, true);
a.ask.target = 60; assert.strictEqual(A.askView(s, a.id).onTrack, false);
assert.strictEqual(A.debug(s).asksOpen, 1);

// ---- §3.4 sector swings ----
// rolled every 26 weeks from the unlock; at most one hot and one cold; never the same sector twice at once
s = FR.sim.newGame({ seed: 3 }); s.market.trust = 60; setCap(s, 25);
q = step(s); assert.strictEqual(s.accounts.unlocked, true); assert.strictEqual(s.accounts.sectors.nextAt, s.turn + 26);
s = game(); s.accounts.sectors.nextAt = s.turn; let seen = { hot: 0, cold: 0 };
for (let i = 0; i < 400; i++) {
  s.turn++; s.accounts.sectors.nextAt = s.turn; q = step(s, 0, i + 1);
  const sc = s.accounts.sectors;
  if (sc.hot && sc.cold) assert.notStrictEqual(sc.hot.name, sc.cold.name);
  q.events.filter(e => e.type === 'account:sector').forEach(e => {
    seen[e.kind]++; assert.ok(e.until - s.turn >= 13 && e.until - s.turn <= 26);
    const last = sc.last[e.name]; assert.ok(last == null || s.turn - last >= K.sector.cooldown, 'cooldown: ' + e.name);
  });
}
assert.ok(seen.hot > seen.cold && seen.cold > 0, JSON.stringify(seen));
// a swing already in its slot blocks another of that kind
s = game(); s.accounts.sectors.hot = { name: 'Legal', until: s.turn + 20, from: s.turn };
for (let i = 0; i < 40; i++) { s.accounts.sectors.nextAt = s.turn; step(s, 0, i + 7); assert.strictEqual(s.accounts.sectors.hot.name, 'Legal'); }
// the memo line and the news line (06_market prints it through endTurn)
s = game(); s.accounts.sectors.nextAt = s.turn;
for (let sd = 1; ; sd++) { const s1 = FR.clone(s); s1.rngState = sd; const t1 = FR.sim.endTurn(s1, []); const e = t1.lastReport.events.find(x => x.type === 'account:sector');
  if (!e) continue;
  assert.ok(t1.lastReport.news.some(x => x.text === FR.market.SECTOR_NEWS[e.kind][e.name]), 'news line');
  assert.ok(t1.lastReport.memo.some(m => m.text.indexOf(e.name + ' turns ' + e.kind + ' through ') === 0), JSON.stringify(t1.lastReport.memo));
  assert.deepStrictEqual(A.sectorStrip(t1).map(x => [x.name, x.kind]), [[e.name, e.kind]]);
  break; }
assert.ok(Object.keys(FR.market.SECTOR_NEWS.hot).length === A.SECTORS.length && Object.keys(FR.market.SECTOR_NEWS.cold).length === A.SECTORS.length);
// hot: dealt at 3× weight with fees +25% for the term; cold: never dealt
s = game(); s.accounts.sectors.hot = { name: 'Logistics', until: s.turn + 20, from: s.turn }; s.accounts.sectors.cold = { name: 'Banking', until: s.turn + 20, from: s.turn };
let dealt = { hot: 0, all: 0, cold: 0 };
for (let i = 0; i < 150; i++) {
  s.accounts.refreshAt = s.turn + 1; s.accounts.cool = []; step(s, 0, i + 11);
  s.accounts.offers.forEach(o => { dealt.all++; if (o.sector === 'Banking') dealt.cold++;
    if (o.sector === 'Logistics') { dealt.hot++; assert.strictEqual(o.hot, true); assert.strictEqual(o.feePerWeek, Math.round(A.fee(o.tier, s.turn + 1) * 1.25 / 1000) * 1000); }
    else assert.strictEqual(o.feePerWeek, A.fee(o.tier, s.turn + 1)); });
}
assert.strictEqual(dealt.cold, 0);
// Logistics is 5 of the 26 non-cold names: uniform ~19%, at 3× ~42%
assert.ok(dealt.hot / dealt.all > 0.32, 'hot share ' + (dealt.hot / dealt.all).toFixed(2));
// hot mood: +1 extra a week to 85; cold: −1 a week out of step (in step it rises as usual)
s = game(); a = live(s, 1, { sector: 'Logistics', mood: 80 }); const cl = live(s, 1, { sector: 'Banking', mood: 60 });
s.accounts.sectors.hot = { name: 'Logistics', until: s.turn + 20, from: s.turn }; s.accounts.sectors.cold = { name: 'Banking', until: s.turn + 20, from: s.turn };
step(s); assert.strictEqual(a.mood, 82); assert.strictEqual(cl.mood, 61);
for (let i = 0; i < 5; i++) step(s); assert.strictEqual(a.mood, 85);
setCap(s, 30, 6); step(s); assert.strictEqual(a.mood, 85); assert.strictEqual(cl.mood, 65);
// a swing ends after `until`
s.turn += 21; q = step(s); assert.strictEqual(s.accounts.sectors.hot, null); assert.strictEqual(s.accounts.sectors.last.Logistics, s.turn - 21 + 20);

// ---- memo: at most 3 account lines a week; meetings before asks before sectors before go-live ----
s = game(); s.accounts.sectors.nextAt = s.turn;
live(s, 1, { ends: s.turn, mood: 70 }); live(s, 1, { starts: s.turn });
a = live(s, 1, { mood: 60 }); ask(s, a, { type: 'clean', target: 0, weeks: 13, due: s.turn });
q = step(s, 1000, 4);
assert.ok(q.memo.length <= K.memoMax);
assert.ok(/renews/.test(q.memo[0].text) && /ask met/.test(q.memo[1].text), JSON.stringify(q.memo));

// ---- 0.3 save migration: no meetings, asks or sectors; swings from turn + 13; a contract inside 8 weeks gets its meeting ----
s = game(); s.turn = 90; a = live(s, 1, { ends: 95 }); const far = live(s, 1, { ends: 140 });
const old = FR.clone(s); delete old.accounts.sectors; old.accounts.active.forEach(x => { delete x.meeting; delete x.ask; delete x.field; });
const mg = FR.sim.migrate(old);
assert.deepStrictEqual(mg.accounts.sectors, { hot: null, cold: null, nextAt: 103, last: {} });
assert.deepStrictEqual(mg.accounts.active.find(x => x.id === a.id).meeting, { opens: 90, answer: null });
assert.strictEqual(mg.accounts.active.find(x => x.id === far.id).meeting, null);
assert.strictEqual(mg.accounts.active.find(x => x.id === far.id).ask, null);
t = FR.sim.endTurn(mg, [{ type: 'renewAccount', id: a.id, choice: 'renew' }]); assert.strictEqual(t.status, 'playing');
assert.strictEqual(t.accounts.active.find(x => x.id === a.id).meeting.answer, 'renew');
// a locked (not unlocked) 0.3 save: swings start at the unlock
const o2 = FR.sim.newGame({ seed: 4 }); delete o2.accounts.sectors; assert.strictEqual(FR.sim.migrate(o2).accounts.sectors.nextAt, 0);

// ---- a full run stays pure and consistent: no NaN, events typed ----
s = FR.sim.newGame({ seed: 9 }); s.money.cash = 80e6; s.market.trust = 60; setCap(s, 32); s.compute.rentPF = 300;
s.sliders = { training: 30, serving: 45, safety: 20, research: 5 };
for (let i = 0; i < 160 && s.status === 'playing'; i++) {
  const cmds = [];
  s.accounts.offers.forEach(o => { if (A.qualifies(s, o).ok) cmds.push({ type: 'signAccount', id: o.id }); });
  A.meetings(s).forEach(x => { if (!x.meeting.answer) cmds.push({ type: 'renewAccount', id: x.id, choice: 'up' }); });
  s = FR.sim.endTurn(s, cmds);
  assert.ok(Number.isFinite(s.money.cash) && Number.isFinite(s.money.revenue));
  s.accounts.active.forEach(x => assert.ok(Number.isFinite(x.mood) && Number.isFinite(x.feePerWeek)));
}
console.log('v04 ok');

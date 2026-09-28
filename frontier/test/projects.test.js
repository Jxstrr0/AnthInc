// 07_projects: init shape, research tiers, slots, PF and cash demand, overrun and failure, payoffs, effects, offer board.
const assert = require('assert'), fs = require('fs'), path = require('path');
const FR = require('./_load')(['01_core.js', '02_sim.js', '07_projects.js']);
const P = FR.projects, K = P.K;
// stubs for modules written in parallel
let boosts = [], trusts = [], CAP = 100;
function boost1(s, k, d) { const sk = s.model.skills[k], c = sk.cap, v = sk.safe; sk.cap = FR.clamp(c + d.cap, 0, 100); sk.safe = FR.clamp(v + d.safe, 0, sk.cap + 3); return { cap: sk.cap - c, safe: sk.safe - v }; }
FR.model = { boost: (s, k, d) => { boosts.push([k, d]); if (k !== 'all') return boost1(s, k, d); const r = {}; FR.SKILLS.forEach(x => { r[x] = boost1(s, x, d); }); return r; } };
FR.market = { nudgeTrust: (s, d) => { trusts.push(d); s.market.trust += d; return d; } };
FR.compute = { capacity: () => ({ total: CAP }) };
// fake rng: r() walks `seq`; chance(p) = r() < p
function fake(seq) { let i = 0; const r = () => seq[i++ % seq.length]; r.int = (a, b) => a + Math.floor(r() * (b - a + 1)); r.range = (a, b) => a + r() * (b - a);
  r.pick = (a) => a[Math.floor(r() * a.length)]; r.chance = (p) => r() < p; r.state = () => 1; return r; }
const CALM = fake([0.99]);
const rep = (turn) => ({ turn, events: [], memo: [], news: [], flows: {} });
const alloc = (rpf, rstaff, ppf, need) => ({ research: { pf: rpf, staff: rstaff }, projects: { pf: ppf, need } });
function fresh(seed, research) {
  const sk = (c, v) => ({ cap: c, safe: v, warnStreak: 0, critStreak: 0, warned: false, incidents: [] });
  const s = { turn: 1, status: 'playing', lab: { name: 'Test Lab' }, sliders: { training: 45, serving: 20, safety: 35, research: research || 0 },
    model: { skills: { coding: sk(20, 15), reasoning: sk(20, 15), agents: sk(10, 10) } }, money: { cash: 1e7 }, market: { trust: 50 },
    staff: { headcount: 10, hiring: [] }, compute: {}, stats: { projectsDone: 0 } };
  P.init(s, FR.rng(seed || 7)); return s;
}
// put a known offer on the board and greenlight it
let nid = 0;
function add(s, o) {
  const id = 'x' + (++nid);
  s.projects.offers.push(Object.assign({ id, tpl: 'train', name: 'Coding training run', kind: 'training', skill: 'coding', tier: 1, turns: 4, pfPerTurn: 6,
    cost: 400000, risk: 0, payoff: { cap: 5, safe: -1.5 }, blurb: '' }, o));
  const r = P.greenlight(s, id); assert.ok(r.ok, r.why); return id;
}
// one turn of this module: step, then advance the turn as endTurn does
function turn(s, a, rng) { const r = rep(s.turn); P.step(s, a || alloc(0, 0, P.pfDemand(s), P.pfDemand(s)), rng || CALM, r); s.turn++; return r; }

// init: the §1 shape plus effects/spend
{ const s = fresh();
  assert.deepStrictEqual(s.research, { points: 0, tier: 1 });
  assert.deepStrictEqual(Object.keys(s.projects).sort(), ['active', 'done', 'effects', 'offers', 'refreshAt', 'slots', 'spend']);
  assert.strictEqual(s.projects.slots, 3); assert.strictEqual(s.projects.refreshAt, 9); assert.strictEqual(s.projects.offers.length, 4);
  const keys = ['id', 'tpl', 'name', 'kind', 'skill', 'tier', 'turns', 'pfPerTurn', 'cost', 'risk', 'payoff', 'blurb'];
  s.projects.offers.forEach(o => { assert.deepStrictEqual(Object.keys(o), keys); assert.ok(o.tier <= 2); assert.ok(o.cost > 0 && o.turns > 0 && P.describe(o).endsWith('.')); });
  assert.deepStrictEqual(s.projects.effects, { demandMult: 1, priceMult: 1, rentDiscount: 0, until: 0, grants: [] });
  assert.ok(K.T.length >= 20); [1, 2, 3].forEach(t => assert.ok(K.T.filter(x => x.tier === t).length >= 5));
  assert.deepStrictEqual(fresh(7).projects.offers, s.projects.offers, 'same seed, same board');
  assert.ok(FR.sim.newGame({ seed: 3 }).projects.offers.length === 4); }

// research: points from sim.output on the research allocation; tier 2 opens at its threshold, board refreshes
{ const s = fresh(); const pts = FR.sim.output(K.researchBase, 10, 5);
  let r = turn(s, alloc(10, 5, 0, 0));
  assert.strictEqual(s.research.points, FR.round(pts, 2)); assert.strictEqual(s.research.tier, 1); assert.strictEqual(r.events.length, 0);
  const lock = Object.assign({}, s.projects.offers[0], { id: 'lock', tier: 2 }); s.projects.offers.push(lock);
  const no = P.greenlight(s, 'lock'); assert.ok(!no.ok && /tier 2/.test(no.why), 'locked tier refused');
  s.research.points = K.tiers[1] - 1; r = turn(s, alloc(10, 5, 0, 0));
  assert.strictEqual(s.research.tier, 2); assert.deepStrictEqual(r.events, [{ type: 'research:tier', tier: 2 }]);
  assert.ok(r.memo.some(m => m.kind === 'good' && /^Research tier 2 reached at \d+ points\./.test(m.text)));
  assert.ok(s.projects.offers.every(o => o.id.startsWith('o' + s.turn)), 'board refreshed for the new tier');
  s.research.points = K.tiers[2] + 5; turn(s, alloc(0, 0, 0, 0)); assert.strictEqual(s.research.tier, 3); assert.strictEqual(P.nextTier(s), null);
  // research speeds work: 1 + min(speedMax, points × speedPer)
  const fast = fresh(); add(fast, { turns: 10 }); turn(fast, alloc(10, 5, 6, 6));
  assert.ok(Math.abs(fast.projects.active[0].progress - (1 + Math.min(K.speedMax, pts * K.speedPer))) < 1e-6); }

// slots: three at most; cancel frees one and refunds nothing
{ const s = fresh(); const ids = [add(s, {}), add(s, {}), add(s, {})];
  s.projects.offers.push({ id: 'four', tpl: 'card', name: 'Model card release', kind: 'product', skill: null, tier: 1, turns: 1, pfPerTurn: 0, cost: 5e4, risk: 0, payoff: { trust: 3 }, blurb: '' });
  const r = P.greenlight(s, 'four'); assert.ok(!r.ok && /slots/.test(r.why));
  turn(s); const cash = s.money.cash;
  assert.ok(P.cancel(s, ids[1]).ok); assert.strictEqual(s.money.cash, cash); assert.strictEqual(s.projects.active.length, 2);
  const d = s.projects.done[s.projects.done.length - 1]; assert.deepStrictEqual([d.ok, d.why, d.spent], [false, 'cancelled', 100000]);
  assert.ok(P.greenlight(s, 'four').ok); assert.ok(!P.cancel(s, 'nope').ok); assert.ok(!P.greenlight(s, 'gone').ok);
  const m = turn(s).memo; assert.ok(m.some(x => x.text === 'Cancelled: Coding training run. $100k spent, no refund.'));
  assert.ok(m.some(x => x.text.startsWith('Started: Model card release.'))); }

// PF and cash demand: reserved PF; cost charged evenly per week of work; the bill for the week holds through 05_money's call
{ const s = fresh(); add(s, { turns: 4, pfPerTurn: 6, cost: 400000 }); add(s, { turns: 5, pfPerTurn: 3, cost: 250000 });
  assert.strictEqual(P.pfDemand(s), 9);
  assert.strictEqual(P.cashDemand(s), 150000, 'forecast: 100k + 50k a week at speed 1');
  assert.strictEqual(FR.sim.allocate(s).projects.pf, 9);
  turn(s); assert.strictEqual(s.projects.spend.cash, 150000);
  s.turn--; assert.strictEqual(P.cashDemand(s), 150000, 'same turn: the bill just worked'); s.turn++;
  // compute short: work and cash at the available share
  const r = turn(s, alloc(0, 0, 4.5, 9)); assert.strictEqual(s.projects.spend.cash, 75000);
  assert.ok(Math.abs(s.projects.active[0].progress - 1.5) < 1e-9); assert.ok(r.memo.some(m => /50% pace/.test(m.text)));
  // a finished project's last week is still billed
  const t = fresh(); add(t, { turns: 1, pfPerTurn: 2, cost: 90000 }); turn(t);
  assert.strictEqual(t.projects.active.length, 0); t.turn--; assert.strictEqual(P.cashDemand(t), 90000); }

// overrun at the halfway roll: +50% weeks and budget, event, then completes; total billed = new budget
{ const s = fresh(); const uid = add(s, { turns: 4, cost: 400000, risk: 0.5 }); const rng = fake([0, 0.99]);
  let billed = 0, r = turn(s, null, rng); billed += s.projects.spend.cash; assert.strictEqual(r.events.length, 0);
  r = turn(s, null, rng); billed += s.projects.spend.cash;
  assert.deepStrictEqual(r.events, [{ type: 'project:overrun', uid }]);
  const p = s.projects.active[0]; assert.deepStrictEqual([p.turns, p.cost, p.overrun, p.turnsLeft], [6, 600000, true, 4]);
  assert.ok(r.memo.some(m => m.kind === 'flag' && m.text === 'Coding training run overran: 2 more weeks, 6 in total. Budget up $200k to $600k.'));
  for (let i = 0; i < 4; i++) { r = turn(s, null, fake([0])); billed += s.projects.spend.cash; }
  assert.strictEqual(s.projects.active.length, 0); assert.strictEqual(billed, 600000);
  assert.ok(r.events.some(e => e.type === 'project:done' && e.ok)); assert.ok(!r.events.some(e => e.type === 'project:overrun'), 'one roll per project'); }

// failure at the halfway roll: no payoff, done record, event ok:false
{ const s = fresh(); boosts = []; const uid = add(s, { turns: 4, cost: 400000, risk: 0.5 }); const rng = fake([0, 0]);
  turn(s, null, rng); const r = turn(s, null, rng);
  assert.deepStrictEqual(r.events, [{ type: 'project:done', uid, name: 'Coding training run', ok: false }]);
  assert.strictEqual(s.projects.active.length, 0); assert.strictEqual(boosts.length, 0); assert.strictEqual(s.stats.projectsDone, 0);
  assert.deepStrictEqual(s.projects.done.slice(-1)[0], { name: 'Coding training run', turn: 2, ok: false, why: 'failed', spent: 200000 });
  assert.ok(r.memo.some(m => m.text === 'Coding training run failed after 2 weeks. $200k spent, no payoff.')); }

// payoffs: model boost, trust, cash, effects with expiry; stats and events
{ const s = fresh(); boosts = []; trusts = [];
  const uid = add(s, { turns: 2 }); turn(s); const r = turn(s);
  assert.deepStrictEqual(boosts, [['coding', { cap: 5, safe: -1.5 }]]);
  assert.deepStrictEqual([s.model.skills.coding.cap, s.model.skills.coding.safe], [25, 13.5]);
  assert.ok(r.events.some(e => e.type === 'project:done' && e.uid === uid && e.ok)); assert.strictEqual(s.stats.projectsDone, 1);
  assert.ok(r.memo.some(m => m.kind === 'good' && m.text === 'Coding training run complete. Coding capability up 5 to 25, safety down 1.5 to 14.'));
  add(s, { tpl: 'paper', name: 'Alignment research paper', kind: 'research', skill: 'all', turns: 1, payoff: { safe: 1, trust: 3 } });
  const r2 = turn(s); assert.deepStrictEqual(trusts, [3]); assert.strictEqual(s.market.trust, 53); assert.deepStrictEqual(boosts[1], ['all', { cap: 0, safe: 1 }]);
  assert.ok(r2.news.some(n => n.kind === 'you' && n.text.includes('Test Lab')));
  const cash = s.money.cash; add(s, { tpl: 'enterprise', name: 'Enterprise contract', skill: null, turns: 1, payoff: { cash: 800000 } }); turn(s);
  assert.strictEqual(s.money.cash, cash + 800000, 'cash payoff (the weekly bill is 05_money\'s to charge)');
  const T = s.turn; add(s, { tpl: 'launch', name: 'Product launch', skill: null, turns: 1, payoff: { trust: 2, fx: { demandMult: 1.3, turns: 3 } } });
  add(s, { tpl: 'preorder', name: 'Chip pre-order', skill: null, turns: 1, pfPerTurn: 0, payoff: { fx: { rentDiscount: 0.2, turns: 5 } } }); turn(s);
  const e = s.projects.effects; assert.deepStrictEqual([e.demandMult, e.priceMult, e.rentDiscount, e.until], [1.3, 1, 0.2, T + 4]);
  assert.deepStrictEqual(P.fx(s), { demandMult: 1.3, priceMult: 1, rentDiscount: 0.2, until: T + 4 });
  turn(s); const r3a = turn(s), r3 = turn(s);
  assert.strictEqual(s.projects.effects.demandMult, 1); assert.strictEqual(s.projects.effects.rentDiscount, 0.2);
  // announced after the last week it applies, not a week late
  assert.ok(r3a.memo.some(m => m.text === 'Product launch effect ends: demand +30% no longer applies from next week.'));
  assert.ok(!r3.memo.some(m => /Product launch effect/.test(m.text)));
  // data deal: trust risk rolls on completion
  trusts = []; add(s, { tpl: 'data', name: 'Agents data licensing deal', skill: 'agents', turns: 1, payoff: { cap: 3, safe: -0.5, trustRisk: { chance: 0.35, trust: 4 } } }); turn(s, null, fake([0]));
  assert.deepStrictEqual(trusts, [-4]); }

// offer board: refresh every 8 turns, when empty; weighted to unlocked tiers; skills picked; no repeats on a board
{ const s = fresh(); const first = s.projects.offers.map(o => o.id).join();
  for (let i = 0; i < 7; i++) turn(s); assert.strictEqual(s.projects.offers.map(o => o.id).join(), first);
  const r = turn(s); assert.strictEqual(s.turn, 9); assert.strictEqual(s.projects.refreshAt, 17);
  assert.ok(s.projects.offers.every(o => o.id.startsWith('o9'))); assert.ok(r.memo.some(m => m.text.startsWith('Project board refreshed: 4 offers until Year 1, Week 16')));
  s.projects.offers = []; turn(s); assert.strictEqual(s.projects.offers.length, 4); assert.strictEqual(s.projects.refreshAt, 18);
  const rng = FR.rng(11), count = (tier) => { const n = { 1: 0, 2: 0, 3: 0 }; s.research.tier = tier;
    for (let i = 0; i < 300; i++) { s.projects.offers = []; turn(s, null, rng);
      const tp = s.projects.offers.map(o => o.tpl); assert.strictEqual(new Set(tp).size, tp.length);
      s.projects.offers.forEach(o => { n[o.tier]++; const t = K.T.find(x => x.id === o.tpl);
        assert.ok(t.skill === 'one' ? FR.SKILLS.includes(o.skill) : o.skill === t.skill); }); }
    return n; };
  const n1 = count(1); assert.strictEqual(n1[3], 0); assert.ok(n1[1] > n1[2] * 2, 'tier 1: mostly tier 1, some tier 2 teasers');
  const n3 = count(3); assert.ok(n3[3] > n3[2] && n3[2] > n3[1] && n3[1] > 0, 'tier 3: weighted to the top tier'); }

// review regressions: a zero-progress cancel returns the card (no free reroll); only locked teasers left refreshes the
// board; a safety payoff above today's ceiling is shown and reported
{ const s = fresh(), ids = s.projects.offers.filter(o => o.tier <= s.research.tier).map(o => o.id), refreshAt = s.projects.refreshAt;
  ids.forEach(id => { assert.ok(P.greenlight(s, id).ok || true); });
  s.projects.active.slice().forEach(p => assert.ok(P.cancel(s, p.uid).ok));
  assert.deepStrictEqual(s.projects.offers.map(o => o.id).sort(), ids.slice().sort()); assert.strictEqual(s.projects.done.length, 0);
  const o = s.projects.offers.find(x => x.id === ids[0]), again = fresh().projects.offers.find(x => x.id === ids[0]);
  assert.deepStrictEqual(o, again, 'the returned card is the card that was dealt');
  turn(s); assert.strictEqual(s.projects.refreshAt, refreshAt, 'no fresh board from cancels');
  s.projects.offers.forEach(x => { x.tier = 3; }); turn(s, null, FR.rng(5)); assert.ok(s.projects.offers.some(x => x.tier <= s.research.tier), 'teasers only: fresh board');
  const t = fresh(); t.model.skills.coding.safe = 21;   // cap 20: ceiling 23, room 2
  const card = { tpl: 'evals', name: 'Coding safety eval suite', kind: 'safety', skill: 'coding', tier: 1, turns: 1, pfPerTurn: 1, cost: 1e5, risk: 0, payoff: { safe: 5 } };
  assert.strictEqual(P.describe(card), 'Coding safety +5.');
  assert.strictEqual(P.describe(card, t), 'Coding safety +5 (+2 at today\'s levels: safety stops at capability + 3).');
  add(t, card); const r = turn(t);
  assert.ok(r.memo.some(m => /Coding safety up 2 to 23\. 3 of the safety payoff unused: safety stops at capability \+ 3\.$/.test(m.text)), JSON.stringify(r.memo)); }

// debug and purity
{ const s = fresh(); add(s, {}); const d = P.debug(s);
  assert.deepStrictEqual([d.tier, d.active, d.pfDemand, d.cashDemand, d.slots], [1, 1, 6, 100000, 3]);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '07_projects.js'), 'utf8').split('\n').filter(l => !l.startsWith('})(typeof window')).join('\n');
  ['Math.random', 'Date.now', 'document', 'window', 'localStorage', 'performance', 'FR.emit', '!\''].forEach(w => assert.ok(!src.includes(w), 'sim must not use ' + w)); }

console.log('projects ok');

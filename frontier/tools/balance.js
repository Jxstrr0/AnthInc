// Bot probe: plays seeds through the real sim with four strategies (race, safe, balanced, revenue-first) and prints one
// table per bot plus a summary line. Usage: node tools/balance.js [--seeds N] [--turns N] [--bot name]
const FR = require('../test/_load')();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : d; };
const SEEDS = +arg('seeds', 10), TURNS = +arg('turns', 312), ONLY = arg('bot', null);

const SK = FR.SKILLS, sk = (s, k) => s.model.skills[k], CK = FR.compute.K, MK = FR.money.K;
const gap = (s, k) => Math.max(0, sk(s, k).cap - sk(s, k).safe);
const weakest = (s) => SK.reduce((b, k) => sk(s, k).cap < sk(s, b).cap ? k : b, SK[0]);
const strongest = (s) => SK.reduce((b, k) => sk(s, k).cap > sk(s, b).cap ? k : b, SK[0]);
const pending = (s) => s.staff.hiring.reduce((t, h) => t + h.n, 0);
const round5 = (v) => Math.ceil(v / 5) * 5;
// a what-if view for the sim's pure reads: shallow copies, never the live state
function view(s, o) {
  const t = Object.assign({}, s);
  if (o.sliders) t.sliders = o.sliders;
  if (o.rent != null) t.compute = Object.assign({}, s.compute, { rentPF: o.rent });
  if (o.head != null) t.staff = Object.assign({}, s.staff, { headcount: o.head });
  return t;
}
const net = (t) => FR.money.revenue(t, FR.sim.allocate(t).serving.pf) - FR.money.burnEstimate(t);
const free = (t) => Math.max(1, FR.compute.capacity(t).total - FR.projects.pfDemand(t));

// ---- the shared manager: rent within runway, staff to match the compute, clusters when flush, layoffs when short ----
const M = { horizon: 40, pfPerHead: 4.35, rentStep: 5, buyReserve: 26, buyFloor: 2e6, buyShare: 0.5, payMax: 120, projShare: 0.08, cut: 15 };
const headPF = (MK.wage + MK.opsPerHead) / CK.basePrice;   // PF of rent one head costs
function manage(bot, s, cash, cmds) {
  const allow = -Math.max(0, cash) / M.horizon, hc = s.staff.headcount + pending(s), cp = FR.compute.capacity(s);
  let pj = s.projects;
  const at = (rent) => { const t = view(s, { rent, head: hc }); t.projects = pj; t.sliders = bot.quick(s, t); return t; };
  // rent enough for the projects' PF, or cancel the costliest project when the runway cannot carry it
  const floor = () => Math.min(CK.maxRent, round5(Math.max(0, FR.projects.pfDemand(at(0)) - cp.owned - cp.deals)));
  while (pj.active.length && net(at(floor())) < allow) {
    const p = pj.active.slice().sort((a, b) => b.cost / b.turns - a.cost / a.turns)[0];
    cmds.push({ type: 'cancel', uid: p.uid }); pj = Object.assign({}, pj, { active: pj.active.filter(x => x !== p) });
  }
  // the most rent the runway allows (weekly loss no worse than cash / horizon); failing that, the rent with the best net
  let fit = -1, top = -Infinity, arg = 0;
  for (let r = floor(); r <= CK.maxRent; r += M.rentStep) { const n = net(at(r)); if (n >= allow) fit = r; if (n > top) { top = n; arg = r; } }
  const rent = fit >= 0 ? fit : arg, t = at(rent), loss = Math.max(0, -net(t));
  if (rent !== s.compute.rentPF) cmds.push({ type: 'rent', pf: rent });
  // staff: trade rent for heads until PF per head is near the cost-optimal ratio; cut heads when short
  const n = Math.floor((FR.compute.capacity(t).total - M.pfPerHead * hc) / (M.pfPerHead + headPF));
  if (fit >= 0 && n >= 2 && cash > 3 * n * MK.hireFee) cmds.push({ type: 'hire', n: Math.min(MK.maxHire, n) });
  else if (fit < 0 && !s.money.offer && loss > 0 && cash / loss < M.cut && s.staff.headcount > MK.minHead)
    cmds.push({ type: 'layoff', n: FR.clamp(Math.ceil((loss - cash / M.cut) / (MK.wage + MK.opsPerHead)), 1, s.staff.headcount - MK.minHead) });
  // a cluster when flush and it pays back well inside its life
  const room = (cash - M.buyReserve * loss - M.buyFloor) * M.buyShare;
  const buy = s.compute.offers.filter(o => o.cost <= room).map(o => ({ o, pb: FR.compute.payback(s, o) }))
    .filter(x => x.pb && x.pb <= M.payMax && s.turn + x.pb < TURNS).sort((a, b) => b.o.pf - a.o.pf)[0];
  if (buy) cmds.push({ type: 'buy', offerId: buy.o.id });
  t.budget = net(t) - allow;   // weekly room left for new project spend
  return t;
}

// ---- projects: each bot scores the board; greenlight the best card above zero into a free slot ----
function greenlight(s, score, cash, room, cmds) {
  const pj = s.projects; if (pj.active.length >= pj.slots || cmds.some(c => c.type === 'cancel')) return;
  const ok = pj.offers.filter(o => o.tier <= s.research.tier && o.cost <= cash * M.projShare && o.cost / o.turns <= Math.max(0, room))
    .map(o => ({ o, v: score(s, o) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)[0];
  if (ok) cmds.push({ type: 'greenlight', offerId: ok.o.id });
}
const byKind = (w) => (s, o) => w[o.kind] || 0;
function smart(s, o) {
  const q = o.payoff, k = o.skill, worst = Math.max.apply(null, SK.map(x => gap(s, x)));
  const g = k && k !== 'all' ? gap(s, k) : worst, fx = q.fx || {};
  let v = 0;
  if (q.safe > 0) v += q.safe * (g > 2 ? 2 : 0.3) * (k === 'all' ? 3 : 1);
  if (q.cap) v += q.cap * (g + q.cap - (q.safe || 0) <= 5 + (s.win.streak ? 0 : 3) && worst <= 4 ? 1 : -1);
  if (q.cash) v += (q.cash - o.cost) / 2e5;
  if (q.trust) v += q.trust * 0.3;
  if (q.trustRisk) v -= 2;
  if (fx.demandMult) v += s.money.revenue > 0 ? 3 : -1;
  if (fx.priceMult) v += s.money.revenue * 52 * (fx.priceMult - 1) / o.cost - 1;
  if (fx.rentDiscount) v += FR.compute.rentCost(s) * fx.rentDiscount * fx.turns / o.cost - 1.5;
  return v;
}

// ---- sliders. quick(s, t) is used while scanning rent (t has the candidate capacity); full(s, t) sets the week ----
const fixed = (training, serving, safety, research) => { const f = () => ({ training, serving, safety, research }); return { quick: f, full: f }; };
// balanced: serve the demand, research while tiers remain, and the least safety that keeps every gap at 3 or under
const serveShare = (s, t) => FR.clamp(round5(FR.money.demandPF(t) / free(t) * 100), 5, 45);
const researchShare = (s) => s.research.tier < 3 ? 10 : 5;
function quickBalanced(s, t) {
  const serving = serveShare(s, t), research = researchShare(s), rest = 100 - serving - research, sl = s.sliders;
  const safety = FR.clamp(Math.round(rest * sl.safety / Math.max(1, sl.training + sl.safety)), 0, rest);
  return { training: rest - safety, serving, safety, research };
}
function fullBalanced(s, t) {
  const serving = serveShare(s, t), research = researchShare(s), rest = 100 - serving - research, goal = chasing(s) ? 8 : 3;
  for (let sf = 5; sf <= rest - 5; sf += 5) {
    const sl = { training: rest - sf, serving, safety: sf, research }, v = view(t, { sliders: sl });
    const g = FR.model.gains(v, FR.sim.allocate(v));
    if (SK.every(k => sk(s, k).cap + g.cap[k] - sk(s, k).safe - g.safe[k] <= goal)) return sl;
  }
  return { training: 5, serving, safety: rest - 5, research };
}

const BOTS = {
  race: Object.assign(fixed(70, 15, 5, 10), { score: byKind({ training: 3, business: 1 }) }),
  safe: Object.assign(fixed(25, 20, 45, 10), { score: byKind({ safety: 3, research: 2 }) }),
  balanced: { quick: quickBalanced, full: fullBalanced, score: smart },
  'revenue-first': Object.assign(fixed(25, 50, 15, 10), { score: byKind({ product: 3, business: 2, compute: 1 }) })
};
// a capability milestone on one skill is open and not yet met
function chasing(s) { const ms = s.money.milestone, p = ms && FR.money.progress(s, ms); return !!(p && ms.kind === 'cap' && !p.met && !s.money.offer); }
function decide(bot, s) {
  const cmds = [], m = s.money, cash = m.cash + (m.offer ? m.offer.amount : 0);
  if (m.offer) cmds.push({ type: 'acceptRound' });
  // chase a capability milestone on the best skill; otherwise lift the weakest
  const tgt = chasing(s) ? m.milestone.skill || strongest(s) : weakest(s);
  if (tgt !== s.target) cmds.push({ type: 'target', skill: tgt });
  const t = manage(bot, s, cash, cmds);
  cmds.unshift(Object.assign({ type: 'sliders' }, bot.full(s, t)));
  greenlight(s, bot.score, cash, t.budget, cmds);
  return cmds;
}

function play(bot, seed) {
  let s = FR.sim.newGame({ seed });
  while (s.status === 'playing' && s.turn <= TURNS) s = FR.sim.endTurn(s, decide(bot, s));
  const live = s.status === 'playing';
  return { seed, outcome: live ? 'alive' : s.status === 'dead' ? 'dead:' + s.end.cause + (s.end.skill ? '/' + s.end.skill : '') : s.status,
    turn: live ? s.turn - 1 : s.turn, peak: s.model.peakCap, inc: s.stats.incidents, fw: s.stats.firstsWon, fl: s.stats.firstsLost,
    hold: s.win.best, cash: s.money.cash, dead: s.status === 'dead' ? s.end.cause : null };
}

if (require.main === module) {
  const pad = (v, n) => String(v).padEnd(n), lpad = (v, n) => String(v).padStart(n);
  const median = (a) => { if (!a.length) return '-'; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2); };
  const t0 = Date.now(), lines = [];
  Object.keys(BOTS).filter(n => !ONLY || n === ONLY).forEach(name => {
    console.log('\n' + name + ' (' + SEEDS + ' seeds, ' + TURNS + ' turns)\nseed outcome              turn  peak  inc  firsts  hold  cash');
    const rows = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = play(BOTS[name], seed); rows.push(r);
      console.log(pad(r.seed, 5) + pad(r.outcome, 21) + lpad(r.turn, 4) + lpad(r.peak.toFixed(1), 6) + lpad(r.inc, 5) + lpad(r.fw + '/' + r.fl, 8) + lpad(r.hold, 6) + '  ' + FR.fmtMoney(r.cash));
    }
    const won = rows.filter(r => r.outcome === 'won').length, dead = rows.filter(r => r.dead), causes = {};
    dead.forEach(r => { causes[r.dead] = (causes[r.dead] || 0) + 1; });
    const line = name + ': win ' + Math.round(won * 100 / rows.length) + '% | alive ' + rows.filter(r => r.outcome === 'alive').length + ' | deaths ' +
      (dead.length ? Object.keys(causes).map(c => c + ' ' + causes[c]).join(', ') : 'none') + ' | median death turn ' + median(dead.map(r => r.turn));
    console.log(line); lines.push(line);
  });
  console.log('\nSUMMARY (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)\n' + lines.join('\n'));
}
module.exports = { BOTS, decide, play, FR };

// Projects and research: research points from the research allocation open tiers 2 and 3 and speed project work;
// greenlit projects reserve PF and cash each week, roll risk once at the halfway mark and pay off on completion. Pure.
(function (FR) {
  const P = FR.projects = {};
  const K = P.K = {
    slots: 3, board: 4, refreshTurns: 8, doneKeep: 20,
    tiers: [0, 100, 500],              // cumulative research points that open tiers 1, 2, 3
    researchBase: 1,                   // research points a week = sim.output(researchBase, research pf, research staff)
    speedPer: 0.015, speedMax: 0.4,    // project work a week = 1 + min(speedMax, research points this week × speedPer)
    tierW: [3, 2, 1],                  // offer weight per tier: current tier 3, one tier below 2, two below 1
    teaserW: 0.6,                      // the next locked tier shows on the board at this weight (cannot be greenlit yet)
    overrunFrac: 0.5,                  // an overrun adds 50% to the weeks and to the budget
    failShare: 0.35,                   // when the halfway risk roll hits: 35% failure (no payoff), else overrun
    growth: 0.2,                       // cost, PF and cash payoffs grow 20% per game year
    dimFloor: 0.3,                     // cap and safe payoffs × max(dimFloor, 1 − level/100) of the skill at offer time
    cashCapDiv: 25,                    // cash payoffs × (1 + avgCap / cashCapDiv)
    fxMax: { demandMult: 1.5, priceMult: 1.25, rentDiscount: 0.5 },  // limits when effects stack
    // perRev: cards whose payoff scales with revenue (demand, price, trust) also cost perRev × the lab's weekly revenue when
    // dealt, so their return stays near 1.5x at most whatever the lab earns
    // templates. skill: 'one' picks a skill per offer, 'all' pays on every skill, null none. turns, pf (per week) and cost
    // (total $) are ranges. pay: cap (with drift = share of the cap gain lost from safe), safe, trust, cash,
    // trustRisk [chance, points], fx {demandMult, priceMult, rentDiscount, turns}, accounts {mood, turns} (mood on every
    // enterprise account and the unserved-PF penalty halved for turns), refs (the next n account offers one tier higher).
    // news: wire line on completion ({L} = lab). needs: 'accounts' = dealt only once enterprise accounts have unlocked.
    T: [
      { id: 'train', tier: 1, kind: 'training', skill: 'one', name: '{S} training run', turns: [5, 7], pf: [4, 8], cost: [3e5, 5e5], risk: 0.15, pay: { cap: 5, drift: 0.3 },
        blurb: 'A dedicated run on {s} data. Capability rises faster than the slider gives; safety drifts with it.' },
      { id: 'evals', tier: 1, kind: 'safety', skill: 'one', name: '{S} safety eval suite', turns: [3, 5], pf: [2, 4], cost: [1.5e5, 3e5], risk: 0.08, pay: { safe: 5 },
        blurb: 'A standing evaluation suite for {s}. Closes the gap and keeps it measured.' },
      { id: 'redteam', tier: 1, kind: 'safety', skill: 'one', name: '{S} red-team exercise', turns: [2, 3], pf: [1, 3], cost: [1e5, 2e5], risk: 0.1, pay: { safe: 3, trust: 1 },
        blurb: 'An internal team attacks the {s} model and patches what it finds.' },
      { id: 'card', tier: 1, kind: 'product', skill: null, name: 'Model card release', turns: [1, 2], pf: [0, 1], cost: [5e4, 1e5], perRev: 0.6, risk: 0.05, pay: { trust: 3 },
        blurb: 'Publish evaluation results and known limits for the current model.', news: '{L} publishes a model card with evaluation results for its current model.' },
      { id: 'paper', tier: 1, kind: 'research', skill: 'all', name: 'Alignment research paper', turns: [3, 5], pf: [2, 4], cost: [2e5, 4e5], risk: 0.15, pay: { safe: 1, trust: 3 },
        blurb: 'Write up the lab\'s alignment work for peer review.', news: '{L} publishes alignment research for peer review.' },
      { id: 'enterprise', tier: 1, kind: 'business', skill: null, name: 'Enterprise contract', turns: [4, 6], pf: [3, 5], cost: [1.5e5, 2.5e5], risk: 0.2, pay: { cash: 6e5 },
        blurb: 'A fixed-scope deployment for one large customer. Paid on delivery.' },
      { id: 'data', tier: 1, kind: 'business', skill: 'one', name: '{S} data licensing deal', turns: [2, 3], pf: [1, 2], cost: [2e5, 4e5], risk: 0.1, pay: { cap: 3, drift: 0.2, trustRisk: [0.35, 4] },
        blurb: 'License a large {s} dataset from a broker. Provenance is uncertain.' },

      { id: 'train2', tier: 2, kind: 'training', skill: 'one', name: 'Large {s} training run', turns: [7, 9], pf: [14, 24], cost: [1.5e6, 2.5e6], risk: 0.2, pay: { cap: 9, drift: 0.3 },
        blurb: 'A large run on {s}. More compute, a bigger gain, more drift.' },
      { id: 'interp', tier: 2, kind: 'research', skill: 'all', name: 'Interpretability push', turns: [6, 8], pf: [6, 12], cost: [1e6, 1.8e6], risk: 0.2, pay: { safe: 4 },
        blurb: 'The interpretability team maps internal features across all three skills.' },
      { id: 'bounty', tier: 2, kind: 'safety', skill: 'one', name: '{S} bug bounty', turns: [4, 6], pf: [2, 4], cost: [4e5, 8e5], risk: 0.1, pay: { safe: 5, trust: 2 },
        blurb: 'Pay outside researchers for {s} failures they find and report.' },
      { id: 'launch', tier: 2, kind: 'product', skill: null, name: 'Product launch', turns: [5, 7], pf: [8, 12], cost: [1.2e6, 2e6], perRev: 2.5, risk: 0.2, pay: { trust: 2, fx: { demandMult: 1.15, turns: 26 } },
        blurb: 'Ship the model to a wider market with sales and support behind it.', news: '{L} launches its model to a wider market.' },
      { id: 'efficiency', tier: 2, kind: 'compute', skill: null, name: 'Inference efficiency work', turns: [4, 6], pf: [6, 10], cost: [8e5, 1.4e6], perRev: 1.4, risk: 0.15, pay: { fx: { priceMult: 1.08, turns: 26 } },
        blurb: 'Distillation and serving work. More revenue from each PF served.' },
      { id: 'preorder', tier: 2, kind: 'compute', skill: null, name: 'Chip pre-order', turns: [3, 5], pf: [0, 0], cost: [1e6, 2e6], risk: 0.1, pay: { fx: { rentDiscount: 0.2, turns: 39 } },
        blurb: 'Commit to chip supply ahead of need at a fixed discount on rent.' },
      { id: 'fellowship', tier: 2, kind: 'safety', skill: 'all', name: 'Safety fellowship', turns: [8, 10], pf: [2, 4], cost: [6e5, 1e6], risk: 0.1, pay: { safe: 2.5, trust: 2 },
        blurb: 'Fund outside safety researchers for a term inside the lab.', news: '{L} funds a safety fellowship for outside researchers.' },
      { id: 'readiness', tier: 2, kind: 'business', skill: null, name: 'Enterprise readiness work', needs: 'accounts', turns: [4, 6], pf: [4, 8], cost: [6e5, 1e6],
        risk: 0.1, pay: { accounts: { mood: 10, turns: 26 } },
        blurb: 'Support rotas, uptime commitments and audit trails for enterprise buyers.' },
      { id: 'reference', tier: 2, kind: 'business', skill: null, name: 'Reference customer program', needs: 'accounts', turns: [3, 5], pf: [1, 3], cost: [3e5, 6e5],
        risk: 0.1, pay: { refs: 2 },
        blurb: 'Case studies and site visits with current customers. Larger buyers take the next meetings.' },
      { id: 'platform', tier: 2, kind: 'business', skill: null, name: 'Enterprise platform deal', turns: [6, 8], pf: [8, 14], cost: [5e5, 9e5], risk: 0.25, pay: { cash: 2.5e6 },
        blurb: 'A platform agreement with a large enterprise. Integration work up front, paid on delivery.' },

      { id: 'frontier', tier: 3, kind: 'training', skill: 'one', name: 'Frontier {s} run', turns: [10, 13], pf: [30, 50], cost: [5e6, 8e6], risk: 0.25, pay: { cap: 14, drift: 0.3 },
        blurb: 'A frontier-scale run on {s}. The largest gain available, with the drift to match.' },
      { id: 'mech', tier: 3, kind: 'research', skill: 'all', name: 'Mechanistic interpretability program', turns: [9, 12], pf: [16, 26], cost: [3e6, 5e6], risk: 0.2, pay: { safe: 7 },
        blurb: 'A full interpretability program across every skill. Slow, and the gains hold.' },
      { id: 'autoalign', tier: 3, kind: 'research', skill: 'all', name: 'Automated alignment research', turns: [5, 7], pf: [20, 30], cost: [2.5e6, 4e6], risk: 0.35, pay: { safe: 6 },
        blurb: 'The model runs alignment experiments on itself under supervision. Fast and less certain.' },
      { id: 'evalpartner', tier: 3, kind: 'safety', skill: 'all', name: 'Frontier eval partnership', turns: [5, 7], pf: [6, 10], cost: [1.5e6, 2.5e6], risk: 0.1, pay: { safe: 3, trust: 5 },
        blurb: 'Independent evaluators test each release before it ships and publish the results.', news: 'Independent evaluators publish pre-release test results for {L}.' },
      { id: 'flagship', tier: 3, kind: 'product', skill: null, name: 'Flagship model launch', turns: [6, 8], pf: [20, 30], cost: [4e6, 6e6], perRev: 5, risk: 0.25,
        pay: { trust: 3, fx: { demandMult: 1.25, priceMult: 1.05, turns: 26 } },
        blurb: 'Launch the flagship model with a full commercial push.', news: '{L} launches its flagship model.' },
      { id: 'supply', tier: 3, kind: 'compute', skill: null, name: 'Compute supply contract', turns: [4, 6], pf: [0, 0], cost: [5e6, 8e6], risk: 0.15, pay: { fx: { rentDiscount: 0.3, turns: 104 } },
        blurb: 'A two-year supply contract at a fixed discount on rented compute.' }
    ]
  };

  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const money = FR.fmtMoney, n1 = (v) => String(FR.round(v, 1)), no = (why) => ({ ok: false, why });
  const wk = (n) => n + (n === 1 ? ' week' : ' weeks');
  const sg = (v) => (v < 0 ? '-' : '+') + n1(Math.abs(v));
  const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const half = (v) => Math.max(0.5, Math.round(v * 2) / 2);
  const tpl = (id) => K.T.find(t => t.id === id);
  const rate = (p) => p.cost / p.turns;
  const grow = (turn) => 1 + K.growth * (FR.year(turn) - 1);
  const lvl = (s, sk, key) => !s.model || !sk ? 0 : sk === 'all' ? sum(FR.SKILLS, k => s.model.skills[k][key]) / FR.SKILLS.length : s.model.skills[sk][key];
  const dim = (s, sk, key) => Math.max(K.dimFloor, 1 - lvl(s, sk, key) / 100);
  const FX = ['demandMult', 'priceMult', 'rentDiscount'];
  const fxText = (f) => [f.demandMult && 'demand +' + Math.round((f.demandMult - 1) * 100) + '%',
    f.priceMult && 'revenue per PF served +' + Math.round((f.priceMult - 1) * 100) + '%',
    f.rentDiscount && 'rent ' + Math.round(f.rentDiscount * 100) + '% cheaper'].filter(Boolean).join(', ');

  // ---- research ----
  P.tierFor = (pts) => K.tiers.reduce((t, need, i) => pts >= need ? i + 1 : t, 1);
  P.nextTier = function (s) {
    const r = s.research; if (r.tier >= K.tiers.length) return null;
    const at = K.tiers[r.tier]; return { tier: r.tier + 1, at, points: r.points, left: Math.max(0, at - r.points) };
  };
  // research points, work speed and compute stall for an allocation; with none, the allocation next turn would get
  function pace(s, alloc) {
    if (!alloc && FR.compute && FR.compute.capacity && s.compute && s.staff && s.sliders) alloc = FR.sim.allocate(s);
    const r = (alloc && alloc.research) || {}, pr = alloc && alloc.projects;
    const pts = FR.sim.output(K.researchBase, r.pf || 0, r.staff || 0);
    return { pts, speed: 1 + Math.min(K.speedMax, pts * K.speedPer), stall: pr && pr.need > 0 ? FR.clamp(pr.pf / pr.need, 0, 1) : 1 };
  }
  P.speed = (s) => pace(s).speed;
  P.researchRate = (s) => pace(s).pts;
  const work = (p, k) => Math.max(0, Math.min(p.turns - p.progress, k.speed * k.stall));
  const weeksLeft = (p, speed) => Math.max(1, Math.ceil((p.turns - p.progress) / speed - 1e-9));

  // ---- demand on compute and cash ----
  P.pfDemand = (s) => s.projects ? sum(s.projects.active, p => p.pfPerTurn) : 0;
  // $ this turn. After step (same turn, 05_money) it is the bill for the week just worked, including projects that finished;
  // otherwise the projection for next turn's work.
  P.cashDemand = function (s) {
    const pj = s.projects; if (!pj) return 0;
    if (pj.spend && pj.spend.turn === s.turn) return pj.spend.cash;
    if (!pj.active.length) return 0;
    const k = pace(s); return Math.round(sum(pj.active, p => rate(p) * work(p, k)));
  };

  // ---- effects that 05_money (demandMult, priceMult) and 04_compute (rentDiscount) read ----
  function fxOf(grants, turn) {
    let d = 1, p = 1, r = 1, until = 0;
    grants.forEach(g => { if (g.until < turn) return; d *= g.demandMult || 1; p *= g.priceMult || 1; r *= 1 - (g.rentDiscount || 0); until = Math.max(until, g.until); });
    return { demandMult: FR.round(Math.min(K.fxMax.demandMult, d), 4), priceMult: FR.round(Math.min(K.fxMax.priceMult, p), 4),
      rentDiscount: FR.round(Math.min(K.fxMax.rentDiscount, 1 - r), 4), until };
  }
  P.fx = (s) => fxOf((s.projects && s.projects.effects && s.projects.effects.grants) || [], s.turn);
  function setFx(s, report) {
    const e = s.projects.effects;
    // announced after the last week it applies, so the player can plan the week without it
    e.grants.forEach(g => { if (g.until === s.turn) report.memo.push({ kind: 'change', text: g.name + ' effect ends: ' + fxText(g) + ' no longer applies from next week.' }); });
    e.grants = e.grants.filter(g => g.until >= s.turn);
    Object.assign(e, fxOf(e.grants, s.turn));
  }

  // ---- offers ----
  function pay(s, q, sk, g) {
    const o = {};
    if (q.cap) { o.cap = half(q.cap * dim(s, sk, 'cap')); if (q.drift) o.safe = -half(o.cap * q.drift); }
    if (q.safe) o.safe = half(q.safe * dim(s, sk, 'safe'));
    if (q.trust) o.trust = q.trust;
    if (q.cash) o.cash = Math.round(q.cash * g * (1 + (s.model ? FR.sim.avgCap(s) : 0) / K.cashCapDiv) / 1e4) * 1e4;
    if (q.trustRisk) o.trustRisk = { chance: q.trustRisk[0], trust: q.trustRisk[1] };
    if (q.fx) o.fx = Object.assign({}, q.fx);
    if (q.accounts) o.accounts = Object.assign({}, q.accounts);
    if (q.refs) o.refs = q.refs;
    return o;
  }
  const fill = (x, sk) => { const S = sk && sk !== 'all' ? FR.SKILL_NAME[sk] : ''; return x.replace('{S}', S).replace('{s}', S.toLowerCase()); };
  function makeOffer(s, rng, t, turn, i) {
    const g = grow(turn), sk = t.skill === 'one' ? rng.pick(FR.SKILLS) : t.skill === 'all' ? 'all' : null;
    return { id: 'o' + turn + String.fromCharCode(97 + i), tpl: t.id, name: fill(t.name, sk), kind: t.kind, skill: sk, tier: t.tier,
      turns: rng.int(t.turns[0], t.turns[1]), pfPerTurn: Math.round(rng.range(t.pf[0], t.pf[1]) * g),
      cost: Math.round((rng.range(t.cost[0], t.cost[1]) * g + (t.perRev || 0) * Math.max(0, (s.money && s.money.revenue) || 0)) / 1e4) * 1e4, risk: t.risk, payoff: pay(s, t.pay, sk, g), blurb: fill(t.blurb, sk) };
  }
  const open = (s, t) => t.needs !== 'accounts' || !!(s.accounts && s.accounts.unlocked);
  // a tier's weight is shared by its templates, so the board's tier mix follows tierW whatever the template counts
  // (templates gated on accounts count only once they can be dealt)
  const weight = (t, tier, s) => (t.tier <= tier ? K.tierW[tier - t.tier] || 0 : t.tier === tier + 1 ? K.teaserW : 0) /
    K.T.filter(x => x.tier === t.tier && open(s, x)).length;
  // a fresh board of K.board offers for `turn`, drawn without repeats, weighted to the unlocked tiers
  function refresh(s, rng, turn) {
    const pj = s.projects, tier = s.research.tier, pool = K.T.filter(t => open(s, t) && weight(t, tier, s) > 0);
    pj.offers = [];
    for (let i = 0; i < K.board && pool.length; i++) {
      let x = rng() * sum(pool, t => weight(t, tier, s)), j = 0;
      while (j < pool.length - 1 && (x -= weight(pool[j], tier, s)) >= 0) j++;
      pj.offers.push(makeOffer(s, rng, pool.splice(j, 1)[0], turn, i));
    }
    pj.refreshAt = turn + K.refreshTurns;
  }

  // safety a payoff would add today, per skill: safe never rises above cap + the model's safeLead
  const lead = () => (FR.model && FR.model.K ? FR.model.K.safeLead : 3);
  const room = (s, k) => { const x = s.model.skills[k]; return Math.max(0, Math.min(100, x.cap + lead()) - x.safe); };
  P.safeToday = function (s, o) {
    const q = o.payoff || {}; if (!(q.safe > 0) || !o.skill || !s || !s.model) return null;
    const ks = o.skill === 'all' ? FR.SKILLS : [o.skill], got = sum(ks, k => Math.min(q.safe, room(s, k)));
    return { full: q.safe * ks.length, now: got, each: got / ks.length };
  };
  // the payoff as one line for cards: "Coding capability +5, safety -1.5." With the state, a safety payoff that today's
  // ceiling (capability + 3) would cut is shown with what it would add now.
  P.describe = function (o, s) {
    const q = o.payoff || {}, b = [], sk = o.skill, S = sk && sk !== 'all' ? FR.SKILL_NAME[sk] + ' ' : '';
    const st = P.safeToday(s, o), cut = st && st.now < st.full - 0.05 ?
      ' (' + sg(st.each) + (sk === 'all' ? ' on average' : '') + ' at today\'s levels: safety stops at capability + ' + lead() + ')' : '';
    if (q.cap) b.push(S + 'capability ' + sg(q.cap) + (q.safe ? ', safety ' + sg(q.safe) : ''));
    else if (q.safe) b.push((sk === 'all' ? 'safety ' + sg(q.safe) + ' on every skill' : S + 'safety ' + sg(q.safe)) + cut);
    if (q.trust) b.push('public trust ' + sg(q.trust));
    if (q.cash) b.push(money(q.cash) + ' on delivery');
    if (q.fx) b.push(fxText(q.fx) + ' for ' + wk(q.fx.turns));
    if (q.trustRisk) b.push(Math.round(q.trustRisk.chance * 100) + '% chance of losing ' + q.trustRisk.trust + ' points of public trust');
    if (q.accounts) b.push('mood +' + q.accounts.mood + ' on every enterprise account, unserved-PF penalty halved for ' + wk(q.accounts.turns));
    if (q.refs) b.push('the next ' + q.refs + ' account offers arrive one tier higher');
    return b.length ? cap1(b.join(', ')) + '.' : '';
  };

  // ---- commands ----
  P.greenlight = function (s, offerId) {
    const pj = s.projects, i = pj.offers.findIndex(o => o.id === offerId), o = pj.offers[i];
    if (!o) return no('That project offer is no longer on the board');
    if (pj.active.length >= pj.slots) return no('All ' + pj.slots + ' project slots are in use');
    if (o.tier > s.research.tier) return no(o.name + ' needs research tier ' + o.tier + ', the lab is at tier ' + s.research.tier);
    pj.offers.splice(i, 1);
    const p = { uid: o.id, tpl: o.tpl, name: o.name, kind: o.kind, skill: o.skill, turnsLeft: o.turns, turns: o.turns, pfPerTurn: o.pfPerTurn,
      cost: o.cost, risk: o.risk, payoff: o.payoff, started: s.turn, overrun: false, progress: 0 };
    pj.active.push(p);
    p.turnsLeft = weeksLeft(p, pace(s).speed);
    return { ok: true, from: 'projects', uid: p.uid };
  };
  // no work done yet: the card goes back on the board (so cancelling cannot empty the board and force a fresh one);
  // otherwise the card is spent and nothing is refunded
  P.cancel = function (s, uid) {
    const pj = s.projects, i = pj.active.findIndex(p => p.uid === uid);
    if (i < 0) return no('No active project with that id');
    const p = pj.active.splice(i, 1)[0], t = tpl(p.tpl);
    if (!p.progress && t) {
      pj.offers.push({ id: p.uid, tpl: p.tpl, name: p.name, kind: p.kind, skill: p.skill, tier: t.tier, turns: p.turns, pfPerTurn: p.pfPerTurn,
        cost: p.cost, risk: p.risk, payoff: p.payoff, blurb: fill(t.blurb, p.skill) });
      return { ok: true, from: 'projects', memo: p.started < s.turn ? { kind: 'change', text: 'Withdrawn before work began: ' + p.name + '. No cost; the offer is back on the board.' } : null };
    }
    record(s, p, false, 'cancelled', Math.round(rate(p) * p.progress));
    return { ok: true, from: 'projects' };
  };
  function record(s, p, ok, why, spent) {
    const d = s.projects.done; d.push({ name: p.name, turn: s.turn, ok, why, spent });
    if (d.length > K.doneKeep) d.splice(0, d.length - K.doneKeep);
  }

  // ---- outcomes ----
  function nudge(s, d, why, report) {
    if (FR.market && FR.market.nudgeTrust) { const r = FR.market.nudgeTrust(s, d, why, report); return typeof r === 'number' ? r : d; }
    if (!s.market) return 0;
    const was = s.market.trust; s.market.trust = FR.clamp(was + d, 0, 100); return s.market.trust - was;
  }
  const trustText = (s, d) => 'Public trust ' + (d < 0 ? 'down ' : 'up ') + n1(Math.abs(d)) + (s.market ? ' to ' + Math.round(s.market.trust) : '');
  function modelText(s, p, d) {
    const move = (what, v, now) => what + (v < 0 ? ' down ' : ' up ') + n1(Math.abs(v)) + ' to ' + Math.round(now);
    if (p.skill === 'all') return 'Safety: ' + FR.SKILLS.map(k => k + ' ' + sg(d[k].safe) + ' to ' + Math.round(s.model.skills[k].safe)).join(', ');
    const sk = s.model.skills[p.skill], b = [];
    if (p.payoff.cap) b.push(move('capability', d.cap, sk.cap));
    if (p.payoff.safe) b.push(d.safe ? move('safety', d.safe, sk.safe) : 'safety unchanged at ' + Math.round(sk.safe));
    return FR.SKILL_NAME[p.skill] + ' ' + b.join(', ');
  }
  function finish(s, p, rng, report) {
    const q = p.payoff, b = [], t = tpl(p.tpl);
    if ((q.cap || q.safe) && p.skill && FR.model && FR.model.boost) {
      const d = FR.model.boost(s, p.skill, { cap: q.cap || 0, safe: q.safe || 0 });
      b.push(modelText(s, p, d));
      const got = p.skill === 'all' ? sum(FR.SKILLS, k => d[k].safe) : d.safe, full = q.safe * (p.skill === 'all' ? FR.SKILLS.length : 1);
      if (q.safe > 0 && !q.cap && got < full - 0.05) b.push(n1(full - got) + ' of the safety payoff unused: safety stops at capability + ' + lead());
    }
    if (q.trust) b.push(trustText(s, nudge(s, q.trust, p.name, report)));
    if (q.cash && s.money) { s.money.cash += q.cash; report.flows.projectPayout = (report.flows.projectPayout || 0) + q.cash; b.push(money(q.cash) + ' received'); }
    if (q.fx) {
      const g = { name: p.name, until: s.turn + q.fx.turns - 1 };
      FX.forEach(k => { if (q.fx[k]) g[k] = q.fx[k]; });
      s.projects.effects.grants.push(g);
      b.push(cap1(fxText(q.fx)) + ' through ' + FR.dateLabel(g.until));
    }
    if (q.accounts && FR.accounts) {
      FR.accounts.lift(s, q.accounts.mood, q.accounts.turns);
      b.push('Account mood up ' + q.accounts.mood + '; unserved-PF penalty halved through ' + FR.dateLabel(s.turn + q.accounts.turns - 1));
    }
    if (q.refs && FR.accounts) { FR.accounts.refer(s, q.refs); b.push('The next ' + q.refs + ' account offers arrive one tier higher'); }
    if (q.trustRisk && rng.chance(q.trustRisk.chance)) {
      b.push('Press questions over the data source. ' + trustText(s, nudge(s, -q.trustRisk.trust, p.name, report)));
      report.news.push({ kind: 'you', text: s.lab.name + ' faces questions over the provenance of licensed training data.' });
    }
    record(s, p, true, 'done', Math.round(p.cost));
    if (s.stats) s.stats.projectsDone = (s.stats.projectsDone || 0) + 1;
    report.events.push({ type: 'project:done', uid: p.uid, name: p.name, ok: true });
    report.memo.push({ kind: 'good', text: p.name + ' complete. ' + b.map(x => x + '.').join(' ') });
    if (t && t.news) report.news.push({ kind: 'you', text: t.news.replace('{L}', s.lab.name) });
  }
  function fail(s, p, report) {
    const spent = Math.round(rate(p) * p.progress);
    record(s, p, false, 'failed', spent);
    report.events.push({ type: 'project:done', uid: p.uid, name: p.name, ok: false });
    report.memo.push({ kind: 'flag', text: p.name + ' failed after ' + wk(s.turn - p.started + 1) + '. ' + money(spent) + ' spent, no payoff.' });
  }
  function overrun(s, p, report) {
    const extra = Math.ceil(p.turns * K.overrunFrac), add = Math.round(p.cost * extra / p.turns);
    p.turns += extra; p.cost += add; p.overrun = true;
    report.events.push({ type: 'project:overrun', uid: p.uid });
    report.memo.push({ kind: 'flag', text: p.name + ' overran: ' + wk(extra).replace(' w', ' more w') + ', ' + p.turns + ' in total. Budget up ' + money(add) + ' to ' + money(p.cost) + '.' });
  }

  // ---- init and the turn ----
  P.init = function (s, rng) {
    s.research = { points: 0, tier: 1 };
    s.projects = { slots: K.slots, active: [], offers: [], refreshAt: 0, done: [],
      effects: { demandMult: 1, priceMult: 1, rentDiscount: 0, until: 0, grants: [] }, spend: { turn: 0, cash: 0 } };
    refresh(s, rng, s.turn);
  };

  P.step = function (s, alloc, rng, report) {
    const pj = s.projects, r = s.research, T = s.turn, k = pace(s, alloc);
    if (!pj.effects) pj.effects = { demandMult: 1, priceMult: 1, rentDiscount: 0, until: 0, grants: [] };
    // research points and tiers
    r.points = FR.round(r.points + k.pts, 2);
    let opened = false;
    while (r.tier < K.tiers.length && r.points >= K.tiers[r.tier]) {
      r.tier++; opened = true;
      report.events.push({ type: 'research:tier', tier: r.tier });
      report.memo.push({ kind: 'good', text: 'Research tier ' + r.tier + ' reached at ' + Math.floor(r.points) + ' points. Tier ' + r.tier + ' projects join the offer board.' });
    }
    // what the player did since the last turn
    pj.done.forEach(d => { if (d.turn === T && d.why === 'cancelled') report.memo.push({ kind: 'change', text: 'Cancelled: ' + d.name + '. ' + money(d.spent) + ' spent, no refund.' }); });
    pj.active.forEach(p => { if (p.started === T && !p.progress) report.memo.push({ kind: 'change', text: 'Started: ' + p.name + '. ' + wk(p.turns) + ' of work, ' + p.pfPerTurn + ' PF a week, ' + money(p.cost) + ' in total.' }); });
    if (k.stall < 1 && pj.active.length) report.memo.push({ kind: 'flag', text: 'Projects need ' + Math.round(alloc.projects.need) + ' PF, ' + Math.round(alloc.projects.pf) +
      ' PF available. Project work at ' + Math.round(k.stall * 100) + '% pace this week.' });
    // work, the halfway risk roll, completion
    let cash = 0; const keep = [];
    pj.active.forEach(p => {
      const w = work(p, k), was = p.progress;
      cash += rate(p) * w; p.progress = FR.round(p.progress + w, 6);
      if (!p.overrun && was < p.turns / 2 && p.progress >= p.turns / 2 - 1e-9 && rng.chance(p.risk)) {
        if (rng.chance(K.failShare)) return fail(s, p, report);
        overrun(s, p, report);
      }
      if (p.progress >= p.turns - 1e-9) return finish(s, p, rng, report);
      keep.push(p);
    });
    pj.active = keep;
    keep.forEach(p => { p.turnsLeft = weeksLeft(p, k.speed); });
    pj.spend = { turn: T, cash: Math.round(cash) };
    setFx(s, report);
    // the offer board: every K.refreshTurns, when nothing on it can be greenlit, or when a tier opens
    if (opened || !pj.offers.some(o => o.tier <= r.tier) || T + 1 >= pj.refreshAt) {
      refresh(s, rng, T + 1);
      if (!opened) report.memo.push({ kind: 'change', text: 'Project board refreshed: ' + pj.offers.length + ' offers until ' + FR.dateLabel(pj.refreshAt - 1) + '.' });
    }
    report.flows.projects = { research: FR.round(k.pts, 2), points: r.points, tier: r.tier, speed: FR.round(k.speed, 3), stall: FR.round(k.stall, 3),
      cash: pj.spend.cash, pf: alloc && alloc.projects ? FR.round(alloc.projects.pf, 1) : 0 };
  };

  P.debug = function (s) {
    const pj = s.projects, r = s.research, nt = P.nextTier(s), f = P.fx(s);
    return { tier: r.tier, points: FR.round(r.points, 1), nextAt: nt ? nt.at : null, speed: FR.round(P.speed(s), 3), slots: pj.slots,
      active: pj.active.length, activeList: pj.active.map(p => p.name + ' ' + p.turnsLeft + 'w' + (p.overrun ? ' overrun' : '')).join('; '),
      offers: pj.offers.length, offerTiers: pj.offers.map(o => o.tier).join(','), refreshAt: pj.refreshAt, pfDemand: P.pfDemand(s),
      cashDemand: P.cashDemand(s), demandMult: f.demandMult, priceMult: f.priceMult, rentDiscount: f.rentDiscount, done: pj.done.length,
      doneOk: pj.done.filter(d => d.ok).length };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

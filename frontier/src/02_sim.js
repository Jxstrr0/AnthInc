// Turn resolver: newGame, applyCommands, endTurn, forecast, score. Pure: never touches the DOM or the bus; runs in node.
// The binding turn order is plan/contracts.md §3. Each system lives in its own module (03..07); this file only wires them.
(function (FR) {
  const S = FR.sim = {};
  S.K = {
    winTurns: 52,          // consecutive turns safely at the frontier to win
    safeMargin: 5,         // "safely": every safe >= cap - safeMargin
    newsKeep: 60, historyKeep: 312, doneKeep: 20,
    allocExp: 0.36, staffExp: 0.24   // out = base * pf^allocExp * (staff+1)^staffExp (modules read these). Sum < 1: returns
                                     // to scale fall, so a raise buys less than proportional progress
  };
  const mods = () => [FR.model, FR.compute, FR.money, FR.market, FR.projects];

  S.avgCap = (s) => FR.SKILLS.reduce((t, k) => t + s.model.skills[k].cap, 0) / FR.SKILLS.length;
  S.avgSafe = (s) => FR.SKILLS.reduce((t, k) => t + s.model.skills[k].safe, 0) / FR.SKILLS.length;
  // the shared production curve every allocation uses
  S.output = (base, pf, staff) => pf <= 0 ? 0 : base * Math.pow(pf, S.K.allocExp) * Math.pow((staff || 0) + 1, S.K.staffExp);

  S.newGame = function ({ seed, labName, slot } = {}) {
    seed = (seed == null ? 1 : seed) >>> 0;
    const s = {
      version: FR.VERSION, seed, rngState: (seed ^ 0x5eed1234) >>> 0 || 1, slot: slot || 0,
      lab: { name: labName || 'Prairie Blue Labs' },
      turn: 1, status: 'playing', end: null,
      sliders: { training: 40, serving: 20, safety: 25, research: 15 }, target: 'coding',
      win: { streak: 0, best: 0 }, news: [], memo: { turn: 0, lines: [] }, history: [],
      stats: { incidents: 0, warnings: 0, firstsWon: 0, firstsLost: 0, projectsDone: 0, peakValuation: 0 },
      pendingMemo: [], lastReport: null
    };
    const rng = FR.rng(s.rngState);
    mods().forEach(m => m && m.init && m.init(s, rng));
    s.rngState = rng.state();
    s.memo = { turn: 0, lines: [{ kind: 'change', text: s.lab.name + ' is incorporated. Seed funding is on the table in the boardroom.' }] };
    return s;
  };

  S.migrate = function (d) {
    if (!d.stats) d.stats = { incidents: 0, warnings: 0, firstsWon: 0, firstsLost: 0, projectsDone: 0, peakValuation: 0 };
    if (!d.win) d.win = { streak: 0, best: 0 };
    if (!d.history) d.history = []; if (!d.news) d.news = []; if (!d.pendingMemo) d.pendingMemo = [];
    if (d.projects && !d.projects.spend) d.projects.spend = { turn: 0, cash: 0 };
    if (d.compute && !d.compute.bill) d.compute.bill = { turn: 0, cash: 0 };
    return d;
  };

  function normSliders(c) {
    const v = FR.ALLOCS.map(k => Math.max(0, Math.round(+c[k] || 0)));
    let tot = v.reduce((a, b) => a + b, 0);
    if (tot <= 0) return { training: 25, serving: 25, safety: 25, research: 25 };
    const out = {}; let sum = 0;
    FR.ALLOCS.forEach((k, i) => { out[k] = Math.floor(v[i] * 100 / tot); sum += out[k]; });
    // hand the rounding remainder to the largest share so the sum is exactly 100
    const big = FR.ALLOCS.reduce((b, k) => out[k] > out[b] ? k : b, FR.ALLOCS[0]); out[big] += 100 - sum;
    return out;
  }

  // one command → {ok, why} (modules may add `event` and `memo`). Mutates s. A command's memo line waits in
  // s.pendingMemo for the next weekly memo; its event goes out with End Turn, or from 99_main when applied at once.
  function apply1(s, c) {
    const r = run1(s, c);
    if (r && r.ok && r.memo) (s.pendingMemo || (s.pendingMemo = [])).push(r.memo);
    return r;
  }
  function run1(s, c) {
    if (!c || !c.type) return { ok: false, why: 'Unknown command' };
    if (s.status !== 'playing') return { ok: false, why: 'The run is over' };
    switch (c.type) {
      case 'sliders': s.sliders = normSliders(c); return { ok: true };
      case 'target': if (FR.SKILLS.indexOf(c.skill) < 0) return { ok: false, why: 'Unknown skill' }; s.target = c.skill; return { ok: true };
      case 'rent': return FR.compute.setRent(s, c.pf);
      case 'buy': return FR.compute.buy(s, c.offerId);
      case 'acceptDeal': return FR.compute.acceptDeal(s);
      case 'declineDeal': if (!s.market.dealOffer) return { ok: false, why: 'No deal on the table' }; s.market.dealOffer = null; return { ok: true };
      case 'endDeal': return FR.compute.endDeal(s, c.rivalId);
      case 'hire': return FR.money.hire(s, c.n);
      case 'layoff': return FR.money.layoff(s, c.n);
      case 'acceptRound': return FR.money.acceptRound(s);
      case 'declineRound': return FR.money.declineRound(s);
      case 'greenlight': return FR.projects.greenlight(s, c.offerId);
      case 'cancel': return FR.projects.cancel(s, c.uid);
    }
    return { ok: false, why: 'Unknown command ' + c.type };
  }

  S.applyCommands = function (state, commands) {
    const s = FR.clone(state);
    const results = (commands || []).map(c => apply1(s, c));
    return { state: s, results };
  };

  S.allocate = function (s) {
    const capInfo = FR.compute.capacity(s), cap = capInfo.total;
    const need = FR.projects.pfDemand(s), projPF = Math.min(cap, need), free = Math.max(0, cap - projPF);
    const hc = s.staff.headcount, alloc = { capacity: cap, capInfo, projects: { pf: projPF, need } };
    FR.ALLOCS.forEach(k => { alloc[k] = { pf: free * s.sliders[k] / 100, staff: hc * s.sliders[k] / 100 }; });
    return alloc;
  };

  // frontier: your average cap >= the best rival's; safely: also every safe >= cap - safeMargin
  S.atFrontier = function (s) { const b = FR.market.best(s); return S.avgCap(s) >= b.avgCap; };
  S.safelyAtFrontier = function (s) {
    return S.atFrontier(s) && FR.SKILLS.every(k => s.model.skills[k].safe >= s.model.skills[k].cap - S.K.safeMargin);
  };

  S.endTurn = function (state, commands) {
    if (state.status !== 'playing') return state;
    const s = FR.clone(state);
    const rng = FR.rng(s.rngState);
    const report = { turn: s.turn, events: [], memo: [], news: [], flows: {}, commands: [] };
    report.commands = (commands || []).map(c => apply1(s, c));
    report.memo = (s.pendingMemo || []).slice(); s.pendingMemo = [];
    report.commands.forEach(r => { if (!r.ok) report.memo.push({ kind: 'flag', text: 'Not done: ' + r.why + '.' }); else if (r.event) report.events.push(r.event); });
    const before = { cash: s.money.cash, trust: s.market.trust, cap: {}, safe: {} };
    FR.SKILLS.forEach(k => { before.cap[k] = s.model.skills[k].cap; before.safe[k] = s.model.skills[k].safe; });

    const alloc = S.allocate(s); report.flows.alloc = alloc;
    FR.model.train(s, alloc, rng, report);
    FR.projects.step(s, alloc, rng, report);
    FR.compute.step(s, rng, report);
    FR.money.step(s, alloc, rng, report);
    FR.market.step(s, rng, report);
    if (s.status === 'playing') FR.model.ladder(s, rng, report);
    if (s.status === 'playing' && s.money.cash <= 0) FR.money.bankrupt(s, report);   // an incident bill can empty the bank

    // win check
    if (s.status === 'playing') {
      if (S.safelyAtFrontier(s)) { s.win.streak++; if (s.win.streak === 1) report.memo.push({ kind: 'good', text: 'The lab is at the frontier with safety in step. Hold it for 52 weeks.' }); }
      else { if (s.win.streak >= 4) report.memo.push({ kind: 'flag', text: 'Frontier position lost after ' + s.win.streak + ' weeks. The count restarts.' }); s.win.streak = 0; }
      s.win.best = Math.max(s.win.best, s.win.streak);
      if (s.win.streak >= S.K.winTurns) {
        s.status = 'won'; s.end = { turn: s.turn, cause: 'win', text: s.lab.name + ' held the frontier safely for a full year.' };
        report.events.push({ type: 'run:won' });
      }
    }
    if (s.status === 'dead' && !report.events.some(e => e.type === 'run:dead')) report.events.push({ type: 'run:dead', cause: s.end && s.end.cause });

    // bookkeeping
    s.model.peakCap = Math.max(s.model.peakCap || 0, S.avgCap(s));
    s.stats.peakValuation = Math.max(s.stats.peakValuation || 0, s.money.valuation || 0);
    report.news.forEach(n => s.news.push({ turn: s.turn, text: n.text, kind: n.kind || 'market' }));
    if (s.news.length > S.K.newsKeep) s.news.splice(0, s.news.length - S.K.newsKeep);
    report.deltas = { cash: s.money.cash - before.cash, trust: s.market.trust - before.trust, cap: {}, safe: {} };
    FR.SKILLS.forEach(k => { report.deltas.cap[k] = s.model.skills[k].cap - before.cap[k]; report.deltas.safe[k] = s.model.skills[k].safe - before.safe[k]; });
    s.memo = { turn: s.turn, lines: report.memo };
    const b = FR.market.best(s);
    s.history.push({ turn: s.turn, cash: Math.round(s.money.cash), revenue: Math.round(s.money.revenue), burn: Math.round(s.money.burn),
      avgCap: FR.round(S.avgCap(s), 1), avgSafe: FR.round(S.avgSafe(s), 1), trust: FR.round(s.market.trust, 1), bestRival: FR.round(b.avgCap, 1) });
    if (s.history.length > S.K.historyKeep) s.history.splice(0, s.history.length - S.K.historyKeep);
    if (s.status === 'playing') s.turn++;
    s.rngState = rng.state();
    s.lastReport = report;
    return s;
  };

  // next-turn projection with no randomness (UI previews). Never mutates.
  S.forecast = function (state) {
    const s = FR.clone(state), alloc = S.allocate(s);
    const revenue = FR.money.revenue(s, alloc.serving.pf);
    const burn = FR.money.burnEstimate(s);
    const g = FR.model.gains(s, alloc);
    const net = revenue - burn;
    return { capacity: alloc.capacity, alloc, revenue, burn, net, runway: net >= 0 ? Infinity : Math.floor(s.money.cash / -net), capGain: g.cap, safeGain: g.safe };
  };

  // end-of-run sheet. Plain, explainable parts.
  S.score = function (s) {
    const parts = [
      { label: 'Weeks operated', value: s.turn },
      { label: 'Peak average capability', value: Math.round((s.model.peakCap || 0) * 10) },
      { label: 'Frontier records set', value: (s.stats.firstsWon || 0) * 150 },
      { label: 'Frontier records lost to rivals', value: -(s.stats.firstsLost || 0) * 50 },
      { label: 'Incidents', value: -(s.stats.incidents || 0) * 60 },
      { label: 'Founder stake at peak valuation', value: Math.round((s.stats.peakValuation || 0) * (s.money.founderPct || 0) / 100 / 1e7) },
      { label: 'Longest safe frontier hold (weeks)', value: (s.win.best || 0) * 5 }
    ];
    if (s.status === 'won') parts.push({ label: 'Held the frontier safely for a year', value: 2000 });
    if (s.status === 'exited') parts.push({ label: 'Acquired', value: 500 });
    return { total: parts.reduce((t, p) => t + p.value, 0), parts };
  };

  S.debug = function (s) {
    return { turn: s.turn, status: s.status, cash: Math.round(s.money.cash), avgCap: FR.round(S.avgCap(s), 2), avgSafe: FR.round(S.avgSafe(s), 2),
      trust: FR.round(s.market.trust, 1), streak: s.win.streak, capacity: FR.compute.capacity(s).total };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

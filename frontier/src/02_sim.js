// Turn resolver: newGame, applyCommands, endTurn, forecast, score. Pure: never touches the DOM or the bus; runs in node.
// The binding turn order is plan/contracts.md §3. Each system lives in its own module (03..07); this file only wires them.
(function (FR) {
  const S = FR.sim = {};
  S.K = {
    winTurns: 52,          // consecutive turns safely at the frontier to win
    safeMargin: 5,         // "safely": every safe >= cap - safeMargin
    newsKeep: 60, historyKeep: 312, doneKeep: 20,
    allocExp: 0.36, staffExp: 0.24,  // out = base * pf^allocExp * (staff+1)^staffExp (modules read these). Sum < 1: returns
                                     // to scale fall, so a raise buys less than proportional progress
    startSliders: { training: 40, serving: 20, safety: 25, research: 15 },
    // end-of-run score. Weeks count up to `horizon`; the win bonus shrinks by `winFast` per week the win took, so a later win
    // never outscores an earlier one; the founder stake is log-compressed and capped so a cash pile cannot outgrow a win
    score: { horizon: 312, capPer: 10, firstWon: 150, firstLost: -50, incident: -60, holdPer: 5, win: 2000, winFast: 10,
      exit: 500, stakePer: 100, stakeUnit: 1e6, stakeMax: 500 }
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
      sliders: Object.assign({}, S.K.startSliders), target: 'coding',
      win: { streak: 0, best: 0 }, news: [], memo: { turn: 0, lines: [] }, history: [],
      stats: { incidents: 0, warnings: 0, firstsWon: 0, firstsLost: 0, projectsDone: 0, peakValuation: 0 },
      pendingMemo: [], pendingEvents: [], lastReport: null
    };
    const rng = FR.rng(s.rngState);
    mods().forEach(m => m && m.init && m.init(s, rng));
    s.rngState = rng.state();
    s.memo = { turn: 0, lines: [{ kind: 'change', text: s.lab.name + ' is incorporated. Seed funding is on the table in the boardroom.' },
      { kind: 'change', text: 'Training output grows with compute and staff. Rent PF on Serving or in the Boardroom; hire in Boardroom > Team.' }] };
    return s;
  };

  S.migrate = function (d) {
    if (!d.stats) d.stats = { incidents: 0, warnings: 0, firstsWon: 0, firstsLost: 0, projectsDone: 0, peakValuation: 0 };
    if (!d.win) d.win = { streak: 0, best: 0 };
    if (!d.history) d.history = []; if (!d.news) d.news = []; if (!d.pendingMemo) d.pendingMemo = []; if (!d.pendingEvents) d.pendingEvents = [];
    if (d.projects && !d.projects.spend) d.projects.spend = { turn: 0, cash: 0 };
    if (d.compute && !d.compute.bill) d.compute.bill = { turn: 0, cash: 0 };
    // V0.3: enterprise accounts and the revenue split (0.2 saves have neither)
    if (d.money && !d.accounts && FR.accounts) FR.accounts.init(d);
    if (d.accounts) ['active', 'offers', 'lost', 'used'].forEach(k => { if (!d.accounts[k]) d.accounts[k] = []; });
    if (d.money && d.money.revMarket == null) { d.money.revMarket = d.money.revenue || 0; d.money.revContracts = 0; }
    return d;
  };

  function normSliders(c) {
    const v = FR.ALLOCS.map(k => { const x = +c[k]; return Number.isFinite(x) ? FR.clamp(Math.round(x), 0, 100) : 0; });
    let tot = v.reduce((a, b) => a + b, 0);
    if (tot <= 0) return { training: 25, serving: 25, safety: 25, research: 25 };
    const out = {}; let sum = 0;
    FR.ALLOCS.forEach((k, i) => { out[k] = Math.floor(v[i] * 100 / tot); sum += out[k]; });
    // hand the rounding remainder to the largest share so the sum is exactly 100
    const big = FR.ALLOCS.reduce((b, k) => out[k] > out[b] ? k : b, FR.ALLOCS[0]); out[big] += 100 - sum;
    return out;
  }

  // one command → {ok, why} (modules may add `event` and `memo`). Mutates s. A command's memo line waits in
  // s.pendingMemo for the next weekly memo and its event waits in s.pendingEvents for the next report.events, so an event
  // from a command applied at once (FR.cmd.do) still reaches the bus with End Turn.
  function apply1(s, c) {
    const r = run1(s, c);
    if (r && r.ok && r.memo) {
      const pm = s.pendingMemo || (s.pendingMemo = []), i = r.memo.key ? pm.findIndex(l => l.key === r.memo.key) : -1;
      if (i >= 0) pm[i] = r.memo; else pm.push(r.memo);   // a keyed line (the week's hires) replaces its earlier version
    }
    if (r && r.ok && r.event && r.event.type) (s.pendingEvents || (s.pendingEvents = [])).push(r.event);
    return r;
  }
  const rivalName = (s, id) => { const r = s.market && s.market.rivals.find(x => x.id === id); return r ? r.name : String(id); };
  function declineDeal(s) {
    const o = s.market.dealOffer; if (!o) return { ok: false, why: 'No deal on the table' };
    s.market.dealOffer = null;
    return { ok: true, memo: { kind: 'change', text: rivalName(s, o.rivalId) + ' compute share declined: ' + o.pf + ' PF for ' + o.turns + ' weeks at ' + FR.fmtPct(o.revShare) + ' of revenue.' } };
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
      case 'declineDeal': return declineDeal(s);
      case 'endDeal': return FR.compute.endDeal(s, c.rivalId);
      case 'hire': return FR.money.hire(s, c.n);
      case 'layoff': return FR.money.layoff(s, c.n);
      case 'acceptRound': return FR.money.acceptRound(s);
      case 'declineRound': return FR.money.declineRound(s);
      case 'greenlight': return FR.projects.greenlight(s, c.offerId);
      case 'signAccount': return FR.accounts.sign(s, c.id);
      case 'declineAccount': return FR.accounts.decline(s, c.id);
      case 'cancel': return FR.projects.cancel(s, c.uid);
      case 'retire': {
        const text = s.lab.name + ' closed by its founders in ' + FR.dateLabel(s.turn) + '. The record stands as filed.';
        s.status = 'exited'; s.end = { turn: s.turn, cause: 'retired', text };
        return { ok: true, event: { type: 'run:retired' }, memo: text };
      }
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
    // serving: contract PF of live accounts first, the open market on the rest
    const reserved = FR.accounts && s.accounts ? FR.accounts.reservedPF(s) : 0;
    alloc.serving.reserved = Math.min(reserved, alloc.serving.pf); alloc.serving.open = alloc.serving.pf - alloc.serving.reserved;
    return alloc;
  };

  // frontier: your average cap >= the best rival's; in step: every safe >= cap - safeMargin; safely: both
  S.atFrontier = function (s) { const b = FR.market.best(s); return S.avgCap(s) >= b.avgCap; };
  S.inStep = (s) => !!(s.model && s.model.skills) && FR.SKILLS.every(k => s.model.skills[k].safe >= s.model.skills[k].cap - S.K.safeMargin);
  S.safelyAtFrontier = (s) => S.atFrontier(s) && S.inStep(s);

  S.endTurn = function (state, commands) {
    if (state.status !== 'playing') return state;
    const s = FR.clone(state);
    const rng = FR.rng(s.rngState);
    const report = { turn: s.turn, events: [], memo: [], news: [], flows: {}, commands: [] };
    report.commands = (commands || []).map(c => apply1(s, c));
    report.memo = (s.pendingMemo || []).slice(); s.pendingMemo = [];
    report.events = (s.pendingEvents || []).slice(); s.pendingEvents = [];
    report.commands.forEach(r => { if (!r.ok) report.memo.push({ kind: 'flag', text: 'Not done: ' + r.why + '.' }); });
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
    if (s.status === 'playing' && FR.accounts) FR.accounts.shock(s, report);          // this week's incidents move account mood

    // win check
    if (s.status === 'playing') {
      if (S.safelyAtFrontier(s)) { s.win.streak++; if (s.win.streak === 1) report.memo.push({ kind: 'good', text: 'The lab is at the frontier with safety in step. Hold it for ' + S.K.winTurns + ' weeks.' }); }
      else {
        if (s.win.streak >= 1) report.memo.push({ kind: 'flag', text: holdLost(s) });
        else if (S.atFrontier(s)) report.memo.push({ kind: 'flag', text: S.holdBlocked(s) });   // ahead, but safety out of step
        s.win.streak = 0;
      }
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

  // why a safe frontier hold broke: the lead, or the skills whose safety fell out of step
  function holdLost(s) {
    const n = s.win.streak, tail = ' The ' + S.K.winTurns + '-week hold restarts after ' + n + (n === 1 ? ' week.' : ' weeks.');
    if (!S.atFrontier(s)) {
      const b = FR.market.best(s);
      return 'Frontier position lost: average capability ' + FR.round(S.avgCap(s), 1) + ' against ' + rivalName(s, b.rivalId) + ' ' + FR.round(b.avgCap, 1) + '.' + tail;
    }
    const out = FR.SKILLS.filter(k => s.model.skills[k].safe < s.model.skills[k].cap - S.K.safeMargin).map(k => FR.SKILL_NAME[k] + ' safety ' +
      FR.round(s.model.skills[k].safe, 1) + ' against capability ' + FR.round(s.model.skills[k].cap, 1));
    return out.join('; ') + '. Safety more than ' + S.K.safeMargin + ' below capability.' + tail;
  }

  // at the frontier with a skill out of step: what keeps the hold from starting (memo, HUD). null when nothing blocks it.
  S.holdBlocked = function (s) {
    const out = FR.SKILLS.filter(k => s.model.skills[k].safe < s.model.skills[k].cap - S.K.safeMargin);
    if (!out.length) return null;
    const bits = out.map(k => FR.SKILL_NAME[k] + ' safety is ' + FR.round(s.model.skills[k].cap - s.model.skills[k].safe, 1) + ' below capability');
    return 'At the frontier, but ' + bits.join('; ') + '. The ' + S.K.winTurns + '-week hold starts when every gap is ' + S.K.safeMargin + ' or less.';
  };

  // next-turn projection with no randomness (UI previews). Never mutates.
  S.forecast = function (state) {
    const s = FR.clone(state), alloc = S.allocate(s);
    const revenue = FR.money.revenue(s, alloc.serving.pf);
    const burn = FR.money.burnEstimate(s);
    const g = FR.model.gains(s, alloc);
    const net = revenue - burn;
    const split = FR.money.revenueSplit(s, alloc.serving.pf);
    return { capacity: alloc.capacity, alloc, revenue, market: split.market, contracts: split.contracts, burn, net, runway: net >= 0 ? Infinity : Math.floor(s.money.cash / -net), capGain: g.cap, safeGain: g.safe };
  };

  // end-of-run sheet. Plain, explainable parts.
  S.score = function (s) {
    // a lab wound up for want of cash leaves its founder nothing: the stake scores 0 on cause 'cash'
    const Q = S.K.score, broke = s.status === 'dead' && s.end && s.end.cause === 'cash';
    const stake = broke ? 0 : (s.money.valuation || 0) * (s.money.founderPct || 0) / 100;
    const parts = [
      { label: 'Weeks operated', value: Math.min(s.turn, Q.horizon) },
      { label: 'Peak average capability', value: Math.round((s.model.peakCap || 0) * Q.capPer) },
      { label: 'Frontier records set', value: (s.stats.firstsWon || 0) * Q.firstWon },
      { label: 'Frontier records lost to rivals', value: (s.stats.firstsLost || 0) * Q.firstLost },
      { label: 'Incidents', value: (s.stats.incidents || 0) * Q.incident },
      { label: 'Founder stake at the end', value: Math.min(Q.stakeMax, Math.round(Q.stakePer * Math.log10(1 + stake / Q.stakeUnit))) },
      { label: 'Longest safe frontier hold (weeks)', value: (s.win.best || 0) * Q.holdPer }
    ];
    if (s.status === 'won') parts.push({ label: 'Held the frontier safely for a year', value: Q.win + Q.winFast * Math.max(0, Q.horizon - s.turn) });
    if (s.status === 'exited' && !(s.end && s.end.cause === 'retired')) parts.push({ label: 'Acquired', value: Q.exit });
    return { total: parts.reduce((t, p) => t + p.value, 0), parts };
  };

  S.debug = function (s) {
    return { turn: s.turn, status: s.status, cash: Math.round(s.money.cash), avgCap: FR.round(S.avgCap(s), 2), avgSafe: FR.round(S.avgSafe(s), 2),
      trust: FR.round(s.market.trust, 1), streak: s.win.streak, capacity: FR.compute.capacity(s).total };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// Money: cash, burn (payroll, compute, projects, ops), customer revenue, valuation, the seed and Series A rounds with
// dilution and milestones, hiring and layoffs, bankruptcy. Pure: randomness only from the rng passed in.
(function (FR) {
  const M = FR.money = {};
  const K = M.K = {
    startCash: 5000000, startHead: 10,       // about 47 weeks of runway at the starting burn, before any round
    minHead: 2, maxHire: 50, maxHead: 1000,
    wage: 5000,                              // $ per head per week, fully loaded
    hireFee: 20000, hireTurns: 4,            // recruiting fee per head, paid at hire; hires join 4 turns later
    severanceWeeks: 4,                       // layoffs pay 4 weeks of wages per head
    layoffTrustPer: 0.1, layoffTrust: [0.5, 3],   // trust cost of a layoff = clamp(n × per, lo, hi)
    opsBase: 8000, opsPerHead: 800,          // offices, legal, tooling: $ per week
    priceBase: 500, priceExp: 1.6,           // $ per PF-week served = priceBase × (avgCap / 10)^priceExp
    demandBase: 8, demandExp: 2,             // demand PF = demandBase × (avgCap / 10)^demandExp × trustMult^demandTrustExp
    demandTrustExp: 0.5,
    trustLo: 0.5, trustHi: 1.5,              // fallback trust multiplier (no 06_market): lo..hi over trust 0..100
    zetaDrag: 0.01, zetaMax: 0.25,           // fallback Zeta price pressure: −1% per point Zeta is ahead, at most −25%
    valBase: 40e6, valCap: 2.2e6, valCapExp: 1.5,   // valuation = (valBase + valCap × avgCap^valCapExp
    revMultiple: 20,                         //   + revMultiple × 52 × weekly revenue) × trustMult
    rounds: {
      seed: { name: 'Seed round', amount: 18e6, pctMin: 0.1, pctMax: 0.3 },
      a: { name: 'Series A', amount: 75e6, pctMin: 0.1, pctMax: 0.35 }
    },
    order: ['seed', 'a'],                    // after the last, no further rounds (B and C are back-burner)
    offerTurns: 8, offerWarn: [3, 1],        // an offer stays open 8 turns; memo when 3 and 1 remain
    reofferTurns: 13,                        // a lapsed or declined offer returns 13 turns later on the same milestone
    lockTurns: 52,                           // a missed milestone closes rounds for 52 turns, then a fresh milestone
    msTurns: 30, msWarn: [8, 4, 1],          // milestone window; memo when 8, 4 and 1 weeks remain
    ms: { capFrac: 0.25, avgFrac: 0.18, revMin: 50000, revMult: 2.5, trustAdd: 10, trustMax: 80 },
    msKinds: [['cap', 4], ['avgCap', 3], ['revenue', 2], ['trust', 1]],   // weights for a fresh milestone after a miss
    runwayWarn: [26, 13, 6]                  // memo flag on crossing each; every week below the last
  };

  const money = FR.fmtMoney, no = (why) => ({ ok: false, why });
  const pct = (f) => FR.fmtPct(f, Math.round(f * 1000) % 10 ? 1 : 0);
  const RN = (r) => K.rounds[r].name;
  const avg = (s) => s.model ? FR.sim.avgCap(s) : 0;
  const best = (s) => FR.SKILLS.reduce((b, k) => s.model.skills[k].cap > s.model.skills[b].cap ? k : b, FR.SKILLS[0]);
  const trust = (s) => s.market ? s.market.trust : 50;
  const int = (n) => typeof n === 'string' && /^\s*\d+\s*$/.test(n) ? +n : n;
  const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const ceil5 = (v) => Math.ceil(v / 5) * 5;
  const sig2 = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };
  const weeksOf = (cash, net) => net >= 0 ? Infinity : Math.max(0, Math.floor(cash / -net));
  const pending = (s) => s.staff.hiring.reduce((t, h) => t + h.n, 0);
  function nudge(s, d, why) {
    if (!s.market) return;
    if (FR.market && FR.market.nudgeTrust) FR.market.nudgeTrust(s, d, why, { turn: s.turn, events: [], memo: [], news: [], flows: {} });
    else s.market.trust = FR.clamp(s.market.trust + d, 0, 100);
  }

  // ---- revenue ----
  M.trustMult = (s) => FR.market && FR.market.trustMult && s.market ? FR.market.trustMult(s) : K.trustLo + (K.trustHi - K.trustLo) * trust(s) / 100;
  M.pricePerPF = (avgCap) => K.priceBase * Math.pow(Math.max(0, avgCap) / 10, K.priceExp);
  M.price = M.pricePerPF;
  // project effects (product launch, efficiency work): demandMult and priceMult from 07_projects, 1 when none
  const fx = (s) => FR.projects && FR.projects.fx && s.projects ? FR.projects.fx(s) : { demandMult: 1, priceMult: 1 };
  M.demandPF = (s) => K.demandBase * Math.pow(avg(s) / 10, K.demandExp) * Math.pow(M.trustMult(s), K.demandTrustExp) * fx(s).demandMult;
  // open weights: price factor when Zeta's average cap is ahead of yours (1 when level or behind)
  M.zetaFactor = function (s) {
    if (!s.market) return 1;
    if (FR.market && FR.market.priceDrag) return 1 - FR.market.priceDrag(s);
    const z = (s.market.rivals || []).find(r => r.id === 'zeta'); if (!z || !z.cap) return 1;
    const ahead = FR.SKILLS.reduce((t, k) => t + (z.cap[k] || 0), 0) / FR.SKILLS.length - avg(s);
    return 1 - FR.clamp(ahead * K.zetaDrag, 0, K.zetaMax);
  };
  const share = (s) => FR.compute && FR.compute.revShare && s.compute ? FR.compute.revShare(s) : 0;
  M.revenue = function (s, servingPF) {
    const pf = Math.min(Math.max(0, +servingPF || 0), M.demandPF(s));
    return pf * M.pricePerPF(avg(s)) * fx(s).priceMult * M.trustMult(s) * Math.max(0, 1 - share(s)) * M.zetaFactor(s);
  };

  // ---- costs ----
  M.payroll = (s) => s.staff.headcount * K.wage;
  M.ops = (s) => K.opsBase + K.opsPerHead * s.staff.headcount;
  M.burnParts = (s) => ({
    payroll: M.payroll(s), ops: M.ops(s),
    compute: FR.compute && FR.compute.cost && s.compute ? FR.compute.cost(s) : 0,
    projects: FR.projects && FR.projects.cashDemand && s.projects ? FR.projects.cashDemand(s) : 0
  });
  M.burnEstimate = (s) => { const p = M.burnParts(s); return Math.round(p.payroll + p.ops + p.compute + p.projects); };
  M.runway = (s) => weeksOf(s.money.cash, s.money.revenue - M.burnEstimate(s));   // weeks, Infinity when net ≥ 0
  M.valuation = (s) => Math.round((K.valBase + K.valCap * Math.pow(avg(s), K.valCapExp) + K.revMultiple * 52 * Math.max(0, s.money ? s.money.revenue : 0)) * M.trustMult(s));

  // ---- rounds and milestones ----
  M.nextRound = (s) => K.order.find(r => s.money.roundsDone.indexOf(r) < 0) || null;
  // fixed raise at the current valuation; dilution rounded to 0.5% and held inside the round's bounds
  function makeOffer(s, round, from) {
    const r = K.rounds[round], v = Math.max(1, M.valuation(s)), raw = r.amount / v;
    const p = FR.clamp(Math.round(raw * 200) / 200, r.pctMin, r.pctMax);
    const amount = raw >= r.pctMin && raw <= r.pctMax ? r.amount : Math.round(p * v / 1e5) * 1e5;
    return (s.money.offer = { round, amount, pct: p, valuation: Math.round(amount / p), expires: from + K.offerTurns - 1 });
  }
  const offerText = (o) => RN(o.round) + ' offer: ' + money(o.amount) + ' for ' + pct(o.pct) + ' at a ' + money(o.valuation) +
    ' valuation. Open until ' + FR.dateLabel(o.expires) + '.';
  function offer(s, round, from, report, lead) {
    report.memo.push({ kind: 'good', text: (lead ? lead + ' ' : '') + offerText(makeOffer(s, round, from)) });
  }

  const REACH = {
    cap: (m) => (m.skill ? FR.SKILL_NAME[m.skill] : 'any skill') + ' reaches capability ' + m.value,
    avgCap: (m) => 'average capability reaches ' + m.value,
    revenue: (m) => 'weekly revenue reaches ' + money(m.value),
    trust: (m) => 'public trust reaches ' + m.value
  };
  // current value against a milestone, for the memo and the UI
  M.progress = function (s, m) {
    m = m || s.money.milestone; if (!m) return null;
    const cur = m.kind === 'cap' ? s.model.skills[m.skill || best(s)].cap : m.kind === 'avgCap' ? avg(s) : m.kind === 'revenue' ? s.money.revenue : trust(s);
    return { current: cur, value: m.value, met: cur >= m.value, weeksLeft: m.due - s.turn };
  };
  function nowText(s, m) {
    if (m.kind === 'cap') { const k = m.skill || best(s); return FR.SKILL_NAME[k] + ' capability ' + Math.floor(s.model.skills[k].cap); }
    if (m.kind === 'avgCap') return 'average capability ' + Math.floor(avg(s) * 10) / 10;
    if (m.kind === 'revenue') return 'weekly revenue ' + money(s.money.revenue);
    return 'public trust ' + Math.floor(trust(s));
  }
  function setMilestone(s, round, kind, from) {
    const Q = K.ms; let value;
    if (kind === 'cap') { const c = s.model.skills[best(s)].cap; value = Math.min(100, ceil5(c + Q.capFrac * (100 - c))); }
    else if (kind === 'avgCap') { const a = avg(s); value = Math.min(100, ceil5(a + Q.avgFrac * (100 - a))); }
    else if (kind === 'revenue') value = sig2(Math.max(Q.revMin, s.money.revenue * Q.revMult));
    else value = Math.min(Q.trustMax, ceil5(trust(s) + Q.trustAdd));
    const m = { round, kind, skill: null, value, due: from + K.msTurns, text: '' };
    m.text = RN(round) + ' opens if ' + REACH[kind](m) + ' by ' + FR.dateLabel(m.due) + '.';
    return (s.money.milestone = m);
  }
  function pickKind(rng) {
    let x = rng() * K.msKinds.reduce((t, k) => t + k[1], 0);
    for (const k of K.msKinds) if ((x -= k[1]) < 0) return k[0];
    return K.msKinds[0][0];
  }

  function checkMilestone(s, report) {
    const m = s.money, ms = m.milestone, T = s.turn;
    if (M.progress(s, ms).met) {
      report.events.push({ type: 'money:milestone', round: ms.round, hit: true });
      return offer(s, ms.round, T + 1, report, RN(ms.round) + ' milestone met: ' + nowText(s, ms) + ' against ' + ms.value + '.');
    }
    if (T >= ms.due) {
      m.milestone = null; m.lockedUntil = T + 1 + K.lockTurns;
      report.events.push({ type: 'money:milestone', round: ms.round, hit: false });
      report.memo.push({ kind: 'flag', text: RN(ms.round) + ' milestone missed (' + REACH[ms.kind](ms) + ' by ' + FR.dateLabel(ms.due) + '). ' +
        cap1(nowText(s, ms)) + '. No round can be raised until ' + FR.dateLabel(m.lockedUntil) + '.' });
      return;
    }
    const left = ms.due - T;
    if (K.msWarn.indexOf(left) >= 0) report.memo.push({ kind: 'due', text: RN(ms.round) + ' milestone due ' + (left === 1 ? 'next week' : 'in ' + left + ' weeks') +
      ': ' + REACH[ms.kind](ms) + '. Now ' + nowText(s, ms) + '.' });
  }

  function rounds(s, rng, report) {
    const m = s.money, T = s.turn, next = T + 1;
    if (m.offer) {
      const o = m.offer, left = o.expires - T;
      if (left <= 0) {
        m.offer = null; m.lockedUntil = T + K.reofferTurns;
        report.memo.push({ kind: 'change', text: RN(o.round) + ' offer lapsed unanswered. Investors expect to return ' + FR.dateLabel(m.lockedUntil) + '.' });
      } else if (K.offerWarn.indexOf(left) >= 0) report.memo.push({ kind: 'due', text: RN(o.round) + ' offer (' + money(o.amount) + ' for ' + pct(o.pct) + ') lapses ' +
        (left === 1 ? 'after next week' : 'in ' + left + ' weeks') + '.' });
      return;
    }
    const r = M.nextRound(s);
    if (m.lockedUntil) {
      if (next < m.lockedUntil) return;
      m.lockedUntil = 0;
      if (r && (m.milestone || r === K.order[0])) return offer(s, r, next, report, 'Investors are back.');   // a met milestone stands
    }
    if (!r) return;
    if (r === K.order[0]) return offer(s, r, next, report);
    if (!m.milestone) { setMilestone(s, r, pickKind(rng), next); report.memo.push({ kind: 'change', text: 'Investors are back. ' + m.milestone.text }); return; }
    checkMilestone(s, report);
  }

  // ---- commands. Results carry the event and memo line; 02_sim queues the memo line and sends the event. ----
  const done = (event, text) => ({ ok: true, from: 'money', event, memo: text ? { kind: 'change', text } : null });
  M.acceptRound = function (s) {
    const m = s.money, o = m.offer;
    if (!o) return no('No round on the table');
    if (s.turn > o.expires) return no('The ' + RN(o.round) + ' offer has lapsed');
    m.cash += o.amount; m.founderPct = FR.round(m.founderPct * (1 - o.pct), 4); m.valuation = o.valuation;
    m.roundsDone.push(o.round); m.offer = null; m.milestone = null; m.lockedUntil = 0;
    const next = M.nextRound(s);
    if (next) setMilestone(s, next, 'cap', s.turn);
    const r = done({ type: 'money:round', round: o.round, amount: o.amount, pct: o.pct },
      RN(o.round) + ' closed: ' + money(o.amount) + ' for ' + pct(o.pct) + '. ' + (next ? m.milestone.text : 'No further rounds are open.'));
    r.memo.kind = 'good'; return r;
  };
  M.declineRound = function (s) {
    const m = s.money; if (!m.offer) return no('No round on the table');
    const r = m.offer.round; m.offer = null; m.lockedUntil = s.turn + K.reofferTurns;
    return done(null, RN(r) + ' offer declined. Investors expect to return ' + FR.dateLabel(m.lockedUntil) + '.');
  };
  M.hire = function (s, n) {
    n = int(n);
    if (!Number.isInteger(n) || n < 1 || n > K.maxHire) return no('Hire a whole number from 1 to ' + K.maxHire);
    if (s.staff.headcount + pending(s) + n > K.maxHead) return no('Headcount is capped at ' + K.maxHead);
    const fee = n * K.hireFee;
    if (s.money.cash < fee) return no('Recruiting ' + n + ' costs ' + money(fee) + ', cash is ' + money(s.money.cash));
    s.money.cash -= fee;
    const at = s.turn + K.hireTurns, h = s.staff.hiring.find(x => x.arrives === at);
    if (h) h.n += n; else s.staff.hiring.push({ n, arrives: at });
    return done(null, 'Hiring ' + n + ': recruiting fees ' + money(fee) + ', joining ' + FR.dateLabel(at) + '.');
  };
  M.layoff = function (s, n) {
    n = int(n); const room = Math.max(0, s.staff.headcount - K.minHead);
    if (!Number.isInteger(n) || n < 1) return no('Lay off a whole number of staff');
    if (n > room) return no('Headcount cannot fall below ' + K.minHead + '; at most ' + room + ' can go');
    const sev = n * K.wage * K.severanceWeeks;
    if (s.money.cash < sev) return no('Severance for ' + n + ' is ' + money(sev) + ', cash is ' + money(s.money.cash));
    s.money.cash -= sev; s.staff.headcount -= n;
    const t = FR.clamp(n * K.layoffTrustPer, K.layoffTrust[0], K.layoffTrust[1]);
    nudge(s, -t, 'Layoffs');
    return done(null, 'Laid off ' + n + ': severance ' + money(sev) + '. Headcount ' + s.staff.headcount + ', payroll ' + money(M.payroll(s)) + ' a week.');
  };

  // ---- init and the turn ----
  M.init = function (s, rng) {
    s.staff = { headcount: K.startHead, hiring: [] };
    s.money = { cash: K.startCash, founderPct: 100, valuation: 0, roundsDone: [], offer: null, milestone: null, lockedUntil: 0, revenue: 0, burn: 0, net: 0 };
    s.money.valuation = M.valuation(s);
    makeOffer(s, K.order[0], s.turn);
  };

  function arrivals(s, next, report) {
    const st = s.staff; let n = 0;
    st.hiring = st.hiring.filter(h => { if (h.arrives > next) return true; n += h.n; return false; });
    if (!n) return;
    st.headcount += n;
    report.memo.push({ kind: 'change', text: n + (n === 1 ? ' hire joins' : ' hires join') + ' next week. Headcount ' + st.headcount + ', payroll ' + money(M.payroll(s)) + ' a week.' });
  }

  function runwayMemo(s, was, report) {
    const m = s.money, w = M.runway(s), W = K.runwayWarn, band = (x) => W.filter(t => x < t).length;
    if (!(w < W[W.length - 1]) && band(w) <= band(was)) return;
    let text = 'Runway ' + w + ' weeks at current burn: ' + money(M.burnEstimate(s)) + ' a week out, ' + money(m.revenue) + ' in, cash ' + money(m.cash) + '.';
    if (m.offer) text += ' ' + RN(m.offer.round) + ' offer open until ' + FR.dateLabel(m.offer.expires) + '.';
    report.memo.push({ kind: 'flag', text });
  }

  function bankrupt(s, report) {
    const name = (s.lab && s.lab.name) || 'The lab';
    const text = 'Cash ' + money(s.money.cash) + ' at the close of ' + FR.dateLabel(s.turn) + '. Payroll and compute bills cannot be met. The board has wound up ' + name + '.';
    s.status = 'dead'; s.end = { turn: s.turn, cause: 'cash', text };
    report.events.push({ type: 'money:bankrupt' });
    report.memo.push({ kind: 'flag', text });
    report.news.push({ kind: 'you', text: name + ' winds down after running out of cash.' });
  }

  // cash at or below zero ends the run; 02_sim calls this again after the ladder, since an incident bill lands late
  M.bankrupt = function (s, report) { if (s.status === 'playing' && s.money.cash <= 0) bankrupt(s, report); return s.status === 'dead'; };

  M.step = function (s, alloc, rng, report) {
    const m = s.money, next = s.turn + 1;
    const was = weeksOf(m.cash, m.net);                 // runway as it stood coming into the turn
    const served = alloc && alloc.serving ? Math.max(0, alloc.serving.pf) : 0, demand = M.demandPF(s);
    const p = M.burnParts(s), burn = Math.round(p.payroll + p.ops + p.compute + p.projects), revenue = Math.round(M.revenue(s, served));
    m.revenue = revenue; m.burn = burn; m.net = revenue - burn; m.cash += m.net;
    report.flows.money = { revenue, burn, net: m.net, payroll: p.payroll, ops: p.ops, compute: Math.round(p.compute), projects: Math.round(p.projects),
      servedPF: FR.round(Math.min(served, demand), 1), demandPF: FR.round(demand, 1), price: Math.round(M.pricePerPF(avg(s))), cash: m.cash };
    arrivals(s, next, report);
    m.valuation = M.valuation(s);
    if (m.cash <= 0) { if (s.status === 'playing') bankrupt(s, report); return; }
    rounds(s, rng, report);
    runwayMemo(s, was, report);
  };

  M.debug = function (s) {
    const m = s.money, o = m.offer, ms = m.milestone, w = M.runway(s);
    return { cash: Math.round(m.cash), founderPct: FR.round(m.founderPct, 2), valuation: m.valuation, revenue: m.revenue, burn: m.burn, net: m.net,
      runway: isFinite(w) ? w : null, burnEstimate: M.burnEstimate(s), headcount: s.staff.headcount, hiring: pending(s), payroll: M.payroll(s),
      demandPF: FR.round(M.demandPF(s), 1), pricePerPF: Math.round(M.pricePerPF(avg(s))), trustMult: FR.round(M.trustMult(s), 3), zeta: FR.round(M.zetaFactor(s), 3),
      rounds: m.roundsDone.join(','), offer: o ? o.round + ' ' + money(o.amount) + ' for ' + pct(o.pct) + ' until ' + o.expires : null,
      milestone: ms ? ms.kind + ' ' + ms.value + ' due ' + ms.due : null, lockedUntil: m.lockedUntil };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

// Market: four rivals on their own capability curves, public trust, the weekly wire feed, the frontier record and rival
// deal offers (v1: only DeepField's compute share is live). Pure: all randomness from the rng passed in.
(function (FR) {
  const M = FR.market = {};
  const K = M.K = {
    trustStart: 50, trustMid: 50, trustRevert: 0.05,   // trust closes 5% of its distance to trustMid each week
    trustMultBase: 0.5, trustMultPer: 0.01,             // trustMult = 0.5 + trust / 100  (0.5 .. 1.5)
    // rival weekly gain per skill = gainBase × speed × (1 + ramp × years) × weight × (1 − cap/100)^dimExp;
    // a `steady` share arrives every week, the rest in releases (chance `ship` a week) so the expected pace is the same
    gainBase: 0.38, dimExp: 1, gainNoise: 0.3, shipJitter: 0.4,
    startJitter: 1.5, safeJitter: 2, speedJitter: 0.06,  // start cap ± points, start safe ± points, base speed ± fraction
    speedMin: 0.85, speedMax: 1.15,                     // speed bounds, multiples of the rival's base speed
    fundLift: 0.02, incSlow: 0.015,                     // a funding line speeds a rival up 2%; its own incident slows it 1.5%
    safeFollow: 0.1,                                    // rival safe closes 10% of the way to cap − margin each week, never falls
    incBase: 0.004, incGap: 8, incSlope: 0.004,         // rival incident chance = risk × (incBase + (worst gap − incGap) × incSlope)
    incTrust: [2, 4], incPatch: 0.5,                    // trust points lost by everyone; share of the gap the rival then closes
    marks: [30, 45, 60, 75, 90],                        // the frontier record
    newsMin: 1, newsMax: 3, newsRecent: 12,             // wire lines a week; no filler template repeats within 12 lines
    newsGrow: 0.3,                                      // money and user figures in wire lines grow 30% per game year
    releaseNews: 1,                                     // a release makes the wire when it adds at least 1 point of average cap
    dealFirst: 10, dealChance: 0.06, dealPF: [30, 60], dealGrowth: 0.35,   // offer PF grows 35% per game year
    dealShare: [0.10, 0.20], dealTurns: 26, dealExpire: 6,
    dragPer: 0.01, dragMax: 0.25,                       // Zeta ahead of you: price per PF falls 1% per point, at most 25%
    RIVALS: {
      opal: { name: 'Opal AI', style: 'racer', model: 'Prism', blurb: 'The cap-first racer. Ships fastest, safety runs thin, most incidents.',
        start: { coding: 22, reasoning: 24, agents: 21 }, w: { coding: 1, reasoning: 1.05, agents: 1.1 },
        speed: 1.2, ramp: 0.12, steady: 0.6, ship: 1 / 8, margin: 15, risk: 1.6 },
      entropic: { name: 'Entropic', style: 'safety-first', model: 'Cairn', blurb: 'The safety-first slow mover. Safety at or above capability, steady releases.',
        start: { coding: 23, reasoning: 19, agents: 18 }, w: { coding: 1.15, reasoning: 0.95, agents: 1 },
        speed: 0.9, ramp: 0.12, steady: 0.85, ship: 1 / 10, margin: -2, risk: 0.25, safeFirst: true },
      deepfield: { name: 'DeepField', style: 'giant', model: 'Castor', blurb: 'The platform giant. Huge compute, slow to ship, then lurches forward.',
        start: { coding: 18, reasoning: 23, agents: 15 }, w: { coding: 0.95, reasoning: 1.15, agents: 0.9 },
        speed: 0.8, ramp: 0.3, steady: 0.3, ship: 1 / 16, margin: 5, risk: 1.4 },
      zeta: { name: 'Zeta', style: 'open-weights', model: 'Llano', blurb: 'Open weights. Mid capability; drags prices down when ahead of you.',
        start: { coding: 16, reasoning: 16, agents: 13 }, w: { coding: 1, reasoning: 0.95, agents: 0.9 },
        speed: 0.85, ramp: 0.12, steady: 0.5, ship: 1 / 10, margin: 10, risk: 1 }
    },
    sites: ['Abilene', 'Columbus', 'Phoenix', 'Reno', 'Des Moines', 'Omaha', 'Atlanta', 'Richmond', 'Tulsa', 'Cheyenne'],
    cities: ['London', 'Toronto', 'Zurich', 'Tokyo', 'Paris', 'Bangalore', 'Seoul', 'Singapore', 'Dublin', 'Seattle'],
    states: ['California', 'New York', 'Texas', 'Colorado', 'Illinois', 'Washington']
  };
  M.ORDER = ['opal', 'entropic', 'deepfield', 'zeta'];
  // one deal style per rival; only `live` kinds are ever offered (v1: DeepField's compute share)
  M.DEALS = { opal: { kind: 'acquisition', live: false }, entropic: { kind: 'distribution', live: false },
    deepfield: { kind: 'compute', live: true }, zeta: { kind: 'licence', live: false } };

  // wire templates, kind|text|effect. r = rival, m = market, y = you. {R} a rival, {R2} another rival.
  M.NEWS = [
    'r|{R} raises {B} in new funding at a {V} valuation.|fund',
    'r|{R} is in talks to raise {B}, according to people familiar with the matter.',
    'r|{R} secures a {B} chip supply agreement through next year.|fund',
    'r|{R} signs a long-term power agreement for a new data center near {C}.',
    'r|{R} seeks permits for a {G}-gigawatt campus near {C}.',
    'r|{R} cuts API prices {P}% on its flagship model.',
    'r|{R} reports {U} million weekly users, up {P}% on the quarter.',
    'r|{R} reports annualized revenue of {B}.',
    'r|{R} adds {H} researchers from university labs this quarter.',
    'r|{R} opens an engineering office in {W}.',
    'r|{R} delays its next model release to extend testing.',
    'r|{R} says its next model is in training. No release date given.',
    'r|{R} publishes an evaluation suite for agent autonomy.',
    'r|{R} publishes a system card for its latest model.',
    'r|{R} signs a multi-year agreement to supply models to a global bank.',
    'r|{R} lists {N}0 enterprise customers paying more than $1M a year.',
    'r|{R} and {R2} announce a joint program on model security research.',
    'r|{R} expands its bug bounty to cover model misuse reports.',
    'r|{R} restructures its product group. Release schedule unchanged, the company says.',
    'r|{R} lowers its compute spending forecast for the year by {P}%.',
    'r|{R} says serving cost per query is down {P}% since January.',
    'r|{R} wins a government contract for document analysis, value undisclosed.',
    'm|Accelerator shipments to data centers up {P}% on the quarter, industry data shows.',
    'm|High-bandwidth memory prices rise {P}% on data-center demand.',
    'm|A new foundry line for AI accelerators slips to next year.',
    'm|Chipmaker raises full-year data-center guidance by {P}%.',
    'm|Spot GPU rental rates steady this week, brokers report.',
    'm|State utility board in {ST} approves a {G}-gigawatt line for data-center load.',
    'm|Enterprise AI spending up {P}% year on year, analyst survey finds.',
    'm|Venture funding for AI labs reaches {B} this quarter.',
    'm|Pay for machine-learning researchers up {P}% this year, recruiter data shows.',
    'm|Cloud providers report AI workloads at {P2}% of new capacity.',
    'm|Analysts estimate compute cost per unit of capability fell {P}% over the past year.',
    'm|Senate committee schedules a hearing on frontier model evaluations.',
    'm|EU officials publish draft guidance on disclosures for general-purpose models.',
    'm|White House convenes lab executives on model security. No new rules announced.',
    'm|Lawmakers in {ST} introduce a bill on AI incident reporting.',
    'm|G7 ministers issue a joint statement on AI safety testing.',
    'm|Export controls on advanced chips extended for another year.',
    'm|A government AI safety institute publishes results from its latest model evaluations.',
    'm|Standards body opens comment on a benchmark for agent reliability.',
    'm|Poll: public trust in AI labs at {T} out of 100.',
    'm|Survey: {P2}% of adults say AI is advancing too fast.',
    'm|Researchers report a jailbreak technique affecting several deployed models. Patches under way.',
    'm|Insurers begin offering cover for AI deployment failures.',
    'm|University study finds agent benchmarks overstate real-world task completion.',
    'm|Open-source developers release a benchmark for long-horizon coding tasks.',
    'm|Frontier average capability on public evals reaches {F}, analysts estimate.',
    'm|Several large employers pause agent pilots pending security reviews.',
    'm|Unions call for consultation on workplace AI deployments.',
    'y|Analysts place {L} {RANK} of five labs on average capability.'
  ];
  const KIND = { r: 'rival', m: 'market', y: 'you' };
  const REL = {
    opal: '{R} ships {X}. Coding {c}, reasoning {r}, agents {a} on public evals.',
    entropic: '{R} releases {X} with a published safety case. Coding {c}, reasoning {r}, agents {a}.',
    deepfield: '{R} ships {X} across its platform. Average capability {v}, up {d} in one release.',
    zeta: '{R} publishes open weights for {X}. Coding {c}, reasoning {r}, agents {a}.'
  };
  const INC = {
    coding: ['{R} pulls a code-generation update after customers report security flaws.', '{R} discloses that its coding model shipped vulnerable code to production systems.'],
    reasoning: ['{R} withdraws a research tool after it fabricated analysis in client reports.', '{R} retracts benchmark claims after its model gave false answers in audited tests.'],
    agents: ['{R} suspends its agent service after automated actions exceeded user instructions.', '{R} discloses that its agents moved customer funds without approval.']
  };

  const RV = (id) => K.RIVALS[id];
  const avg = (r) => FR.SKILLS.reduce((t, k) => t + r.cap[k], 0) / FR.SKILLS.length;
  const worst = (r) => FR.SKILLS.reduce((b, k) => (r.cap[k] - r.safe[k] > r.cap[b] - r.safe[b] ? k : b), FR.SKILLS[0]);
  const gapOf = (r, k) => Math.max(0, r.cap[k] - r.safe[k]);
  const you = (s) => (s.model && s.model.skills ? FR.sim.avgCap(s) : 0);
  const r2 = (v) => FR.round(v, 2);
  const cl = (v) => FR.clamp(v, 0, 100);
  const sub = (t, map) => t.replace(/\{(\w+)\}/g, (x, v) => (v in map ? map[v] : x));
  const byId = (s, id) => s.market.rivals.find(r => r.id === id);
  const bil = (b) => '$' + b.toFixed(b < 10 ? 1 : 0) + 'B';
  const grow = (s) => 1 + K.newsGrow * (FR.year(s.turn) - 1);
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
  const version = (r) => RV(r.id).model + ' ' + (avg(r) / 10).toFixed(1);   // a release adds >= 1 point, so names never repeat
  const bump = (r, f) => { const b = RV(r.id).speed; r.speed = FR.round(FR.clamp(r.speed * (1 + f), b * K.speedMin, b * K.speedMax), 4); };

  // ---- reads ----
  M.trustMult = (s) => K.trustMultBase + s.market.trust * K.trustMultPer;
  M.avgCap = (r) => avg(r);                            // one rival's average cap (UI rival table)
  M.best = function (s) {
    let id = null, top = -1;
    s.market.rivals.forEach(r => { const a = avg(r); if (a > top) { top = a; id = r.id; } });
    return { rivalId: id, avgCap: Math.max(0, top) };
  };
  M.frontierCap = function (s, skill) {
    const mine = s.model && s.model.skills && s.model.skills[skill] ? s.model.skills[skill].cap : 0;
    return s.market.rivals.reduce((m, r) => Math.max(m, r.cap[skill] || 0), mine);
  };
  // open weights: how much Zeta's lead over you cuts the price per PF (0 when you are level or ahead). 05_money may read it.
  M.priceDrag = function (s) {
    const z = byId(s, 'zeta'); if (!z) return 0;
    return FR.clamp((avg(z) - you(s)) * K.dragPer, 0, K.dragMax);
  };

  // ---- trust ----
  M.nudgeTrust = function (s, delta, why, report) {
    const m = s.market, was = m.trust;
    m.trust = cl(was + (+delta || 0));
    const d = m.trust - was;
    if (report && report.flows) (report.flows.trust || (report.flows.trust = [])).push({ delta: r2(d), why: why || '' });
    return d;
  };

  // ---- init ----
  function make(id, rng) {
    const d = RV(id), cap = {}, safe = {};
    FR.SKILLS.forEach(k => {
      cap[k] = r2(d.start[k] + rng.range(-K.startJitter, K.startJitter));
      safe[k] = r2(cl(d.safeFirst ? cap[k] - d.margin : cap[k] - d.margin + rng.range(-K.safeJitter, K.safeJitter)));
    });
    return { id, name: d.name, style: d.style, cap, safe, speed: FR.round(d.speed * rng.range(1 - K.speedJitter, 1 + K.speedJitter), 4),
      dealOpen: M.DEALS[id].live, incidents: 0 };
  }
  M.init = function (s, rng) {
    s.market = { trust: K.trustStart, rivals: M.ORDER.map(id => make(id, rng)), firsts: [], dealOffer: null };
  };

  // ---- the week ----
  function advance(s, r, rng, report) {
    const d = RV(r.id), rate = K.gainBase * r.speed * (1 + d.ramp * (s.turn - 1) / 52), a0 = avg(r);
    const gain = (k) => rate * d.w[k] * Math.pow(Math.max(0, 1 - r.cap[k] / 100), K.dimExp);
    const noise = FR.clamp(1 + rng.normal() * K.gainNoise, 0.2, 1.8);
    FR.SKILLS.forEach(k => { r.cap[k] = r2(Math.min(100, r.cap[k] + gain(k) * d.steady * noise)); });
    const a1 = avg(r);
    if (rng.chance(d.ship)) {
      const size = rng.range(1 - K.shipJitter, 1 + K.shipJitter) * (1 - d.steady) / d.ship;
      FR.SKILLS.forEach(k => { r.cap[k] = r2(Math.min(100, r.cap[k] + gain(k) * size)); });
      if (avg(r) - a1 >= K.releaseNews) {
        const c = r.cap;
        report.news.push({ kind: 'rival', text: sub(REL[r.id], { R: r.name, X: version(r), c: Math.round(c.coding), r: Math.round(c.reasoning),
          a: Math.round(c.agents), v: Math.round(avg(r)), d: Math.round(avg(r) - a0) }) });
      }
    }
    FR.SKILLS.forEach(k => {
      r.safe[k] = r2(cl(r.safe[k] + Math.max(0, r.cap[k] - d.margin - r.safe[k]) * K.safeFollow));
      if (d.safeFirst) r.safe[k] = Math.max(r.safe[k], r.cap[k]);
    });
  }

  function incident(s, r, rng, report) {
    const d = RV(r.id), k = worst(r), g = gapOf(r, k);
    const p = d.risk * (K.incBase + Math.max(0, g - K.incGap) * K.incSlope);
    if (!rng.chance(p)) return;
    r.incidents++;
    r.safe[k] = r2(cl(r.safe[k] + g * K.incPatch));
    bump(r, -K.incSlow);
    const lost = -M.nudgeTrust(s, -rng.int(K.incTrust[0], K.incTrust[1]), r.name + ' incident', report), t = Math.round(s.market.trust);
    report.events.push({ type: 'market:rivalIncident', rivalId: r.id });
    report.news.push({ kind: 'incident', text: sub(rng.pick(INC[k]), { R: r.name }) + ' Public trust in AI labs down ' + Math.round(lost) + ' to ' + t + '.' });
    report.memo.push({ kind: 'change', text: 'Public trust ' + t + ', down ' + Math.round(lost) + ' after the ' + r.name + ' ' + FR.SKILL_NAME[k].toLowerCase() + ' incident.' });
  }

  function records(s, report) {
    const m = s.market, mine = you(s);
    K.marks.forEach(mark => {
      if (m.firsts.some(f => f.mark === mark)) return;
      let by = mine >= mark ? 'player' : null, top = by ? mine : -1;
      m.rivals.forEach(r => { const a = avg(r); if (a >= mark && a > top) { by = r.id; top = a; } });
      if (!by) return;
      m.firsts.push({ mark, turn: s.turn, by });
      report.events.push({ type: 'market:first', mark, by });
      const key = by === 'player' ? 'firstsWon' : 'firstsLost';
      if (s.stats) s.stats[key] = (s.stats[key] || 0) + 1;
      const who = by === 'player' ? s.lab.name : byId(s, by).name;
      report.news.push({ kind: 'record', text: who + ' becomes the first lab to average capability ' + mark + ' on public evals.' });
      if (by === 'player') {
        const b = M.best(s);
        report.memo.push({ kind: 'good', text: 'Record ' + mark + ' set: first lab to average capability ' + mark + '. Nearest rival ' + byId(s, b.rivalId).name + ' at ' + Math.round(b.avgCap) + '.' });
      } else report.memo.push({ kind: 'flag', text: 'Record ' + mark + ' lost to ' + who + ', first to average capability ' + mark + '. Ours: ' + Math.round(mine) + '.' });
    });
  }

  function running(s, id) { return !!(s.compute && s.compute.deals && s.compute.deals.some(x => x.rivalId === id)); }
  function offerFrom(s, r, rng) {
    const pf = Math.max(5, Math.round(rng.int(K.dealPF[0], K.dealPF[1]) * (1 + K.dealGrowth * (FR.year(s.turn) - 1)) / 5) * 5);
    return { rivalId: r.id, kind: M.DEALS[r.id].kind, pf, revShare: FR.round(rng.range(K.dealShare[0], K.dealShare[1]), 2),
      turns: K.dealTurns, expires: s.turn + K.dealExpire };
  }
  function deals(s, rng, report) {
    const m = s.market, o = m.dealOffer;
    if (o && s.turn >= o.expires) {
      m.dealOffer = null;
      report.memo.push({ kind: 'change', text: 'Offer lapsed: ' + byId(s, o.rivalId).name + ' compute share, ' + o.pf + ' PF for ' + FR.fmtPct(o.revShare) + ' of revenue.' });
      return;
    }
    if (o || s.status !== 'playing' || s.turn < K.dealFirst) return;
    for (const r of m.rivals) {
      if (!r.dealOpen || !M.DEALS[r.id].live || running(s, r.id) || !rng.chance(K.dealChance)) continue;
      const n = m.dealOffer = offerFrom(s, r, rng);
      report.memo.push({ kind: 'due', text: r.name + ' offers ' + n.pf + ' PF of compute for ' + n.turns + ' weeks at ' + FR.fmtPct(n.revShare) +
        ' of revenue. Open until ' + FR.dateLabel(n.expires) + '.' });
      return;
    }
  }

  // filler lines: pick templates until the week has 1..3 wire lines in all; skip a template seen in the last few lines
  const sig = (s, t) => s.market.rivals.reduce((x, r) => x.split(r.name).join(''), t).replace(/\b[A-Z]\w*|[^a-z ]/g, '').slice(0, 32);
  function fill(s, tpl, rng) {
    const [k, text, fx] = tpl.split('|'), m = s.market; let rival = null;
    const V = {
      R: () => (rival = rng.pick(m.rivals)).name, R2: () => rng.pick(m.rivals.filter(r => r !== rival)).name,
      B: () => bil(rng.range(1, 6) * grow(s)), V: () => bil(rng.range(30, 150) * grow(s)),
      P: () => rng.int(5, 35), P2: () => rng.int(40, 70), N: () => rng.int(2, 9), G: () => rng.int(1, 5), H: () => rng.int(20, 80),
      U: () => Math.round(rng.int(20, 120) * grow(s)), C: () => rng.pick(K.sites), W: () => rng.pick(K.cities), ST: () => rng.pick(K.states),
      T: () => Math.round(m.trust), F: () => Math.round(M.best(s).avgCap), L: () => s.lab.name,
      RANK: () => ORD[m.rivals.filter(r => avg(r) > you(s)).length]
    };
    return { kind: KIND[k], text: text.replace(/\{(\w+)\}/g, (x, v) => (V[v] ? V[v]() : x)), fx, rival };
  }
  function wire(s, rng, report) {
    const n = rng.int(K.newsMin, K.newsMax), seen = new Set();
    s.news.slice(-K.newsRecent).concat(report.news).forEach(x => seen.add(sig(s, x.text)));
    for (let tries = 0; report.news.length < n && tries < 8; tries++) {
      const line = fill(s, rng.pick(M.NEWS), rng), g = sig(s, line.text);
      if (seen.has(g)) continue;
      seen.add(g);
      report.news.push({ kind: line.kind, text: line.text });
      if (line.fx === 'fund' && line.rival) bump(line.rival, K.fundLift);
    }
  }

  M.step = function (s, rng, report) {
    const m = s.market;
    M.nudgeTrust(s, (K.trustMid - m.trust) * K.trustRevert, 'drift', report);
    m.rivals.forEach(r => advance(s, r, rng, report));
    m.rivals.forEach(r => incident(s, r, rng, report));
    records(s, report);
    deals(s, rng, report);
    wire(s, rng, report);
    const b = M.best(s);
    report.flows.market = { trust: FR.round(m.trust, 1), best: b.rivalId, bestCap: FR.round(b.avgCap, 1) };
  };

  M.debug = function (s) {
    const m = s.market, b = M.best(s), o = m.dealOffer;
    const d = { trust: FR.round(m.trust, 1), trustMult: FR.round(M.trustMult(s), 3), best: b.rivalId, bestCap: FR.round(b.avgCap, 1),
      firsts: m.firsts.map(f => f.mark + ':' + f.by).join(' '), deal: o ? o.rivalId + ' ' + o.pf + ' PF ' + FR.fmtPct(o.revShare) + ' until ' + o.expires : 'none',
      drag: FR.round(M.priceDrag(s), 3) };
    m.rivals.forEach(r => {
      d[r.id] = { avg: FR.round(avg(r), 1), gap: FR.round(gapOf(r, worst(r)), 1), speed: r.speed, incidents: r.incidents };
      FR.SKILLS.forEach(k => { d[r.id][k] = Math.round(r.cap[k]) + '/' + Math.round(r.safe[k]); });
    });
    return d;
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

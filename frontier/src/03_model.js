// The model: capability and safety per skill, training with spillover and drift, safety spread by gap, and the
// slow-burn ladder (warning → incident → final). Pure: all randomness from the rng passed in.
(function (FR) {
  const M = FR.model = {};
  const K = M.K = {
    startCap: 8, startSafe: 8,
    trainBase: 0.11,       // training output = sim.output(trainBase, pf, staff) × noise × dim(cap)
    spill: 0.25,           // share of training output that also lands on each non-target skill
    dimExp: 2,             // diminishing returns: gain × (1 − level/100)^dimExp, for cap and for safe
    trainNoise: 0.2,       // training output × uniform(1 − n, 1 + n); forecasts use 1
    drift: 0.2,            // safe on a skill drops by this fraction of its cap gain
    safeBase: 0.36,        // safety output = sim.output(safeBase, pf, staff), spread over skills
    safeLead: 3,           // safe never above cap + safeLead
    spreadFloor: 2,        // safety spread weight per skill = gap + spreadFloor
    watchGap: 5,            // gaps above this show as 'watch' (the safe-hold line; owner call V0.2)
    warnGap: 10, warnTurns: 2,
    incidentGap: 20, incidentBase: 0.08, incidentSlope: 0.02,   // incident chance = (base + (gap − 20) × slope) × weight
    incidentCash: 500000, incidentCashPct: 0.05, incidentTrust: 6,  // trust lost = incidentTrust × weight
    critGap: 30, critTurns: 4, finalIncidents: 3, incidentWindow: 52,
    // skill weights (handoff §4.2): pressure is the weighted sum of the gaps; an incident's odds and its trust cost scale
    // with the skill's weight, so an agents gap bites hardest
    weights: { coding: 1, reasoning: 1, agents: 1.5 },
    pressureBands: [15, 30, 45]   // pressure above each: watch, warning, critical (the agents weight × 10, 20, 30)
  };

  const NAME = (k) => FR.SKILL_NAME[k] || k;
  const dim = (v) => Math.pow(Math.max(0, 1 - v / 100), K.dimExp);
  const lid = (sk) => Math.min(100, sk.cap + K.safeLead);
  const part = (alloc, a) => (alloc && alloc[a]) || { pf: 0, staff: 0 };
  const out = (base, p) => FR.sim.output(base, p.pf || 0, p.staff || 0);
  const r1 = (v) => FR.round(v, 1);
  const TH = () => [K.warnGap, K.incidentGap, K.critGap];
  // whole numbers unless rounding would put the gap on the wrong side of a ladder threshold
  const fmtGap = (g) => TH().some(t => (g > t) !== (Math.round(g) > t)) ? g.toFixed(1) : String(Math.round(g));
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ordinal = (n) => ORD[n - 1] || (n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')));
  const weeks = (n) => n === 1 ? 'next week' : 'in ' + n + ' weeks';

  M.init = function (state, rng) {
    const skills = {};
    FR.SKILLS.forEach(k => { skills[k] = { cap: K.startCap, safe: K.startSafe, warnStreak: 0, critStreak: 0, warned: false, incidents: [] }; });
    state.model = { skills, peakCap: K.startCap };
    state.target = 'coding';
  };

  M.gap = (state, skill) => { const sk = state.model.skills[skill]; return Math.max(0, sk.cap - sk.safe); };
  M.weight = (skill) => (K.weights && K.weights[skill]) || 1;
  // total pressure: weighted sum of the gaps (handoff §4.2); agents weigh most
  M.pressure = (state) => FR.SKILLS.reduce((t, k) => t + M.weight(k) * M.gap(state, k), 0);
  // weekly incident chance at gap g; with a skill, scaled by its weight (no skill: weight 1)
  M.incidentChance = (g, skill) => g > K.incidentGap ? FR.clamp((K.incidentBase + (g - K.incidentGap) * K.incidentSlope) * (skill ? M.weight(skill) : 1), 0, 1) : 0;
  M.incidentTrust = (skill) => FR.round(K.incidentTrust * M.weight(skill), 1);
  // incidents on a skill that still count toward the final rule at resolution turn `at`
  const recent = (sk, at) => sk.incidents.filter(t => t > at - K.incidentWindow);

  // ---- training and safety ----
  // spread `pool` of safety output over skills, weighted by gap; skills at their lead cap pass the rest on
  function spread(skills, pool) {
    for (let pass = 0; pass < 3 && pool > 1e-9; pass++) {
      const open = FR.SKILLS.filter(k => lid(skills[k]) - skills[k].safe > 1e-9);
      if (!open.length) return;
      const w = open.map(k => Math.max(0, skills[k].cap - skills[k].safe) + K.spreadFloor), tw = w.reduce((a, b) => a + b, 0);
      let left = 0;
      open.forEach((k, i) => {
        const sk = skills[k], raw = pool * w[i] / tw, m = dim(sk.safe), g = Math.min(lid(sk) - sk.safe, raw * m);
        sk.safe += g; left += m > 0 ? raw - g / m : raw;
      });
      pool = left;
    }
  }
  // mutates `skills`; returns { cap:{}, safe:{} } deltas plus totals for the memo
  // field: training PF from client work by skill (FR.accounts.fieldPF, V0.4 §3.1). Each skill's field PF trains it as that
  // many training PF would (staff = the lab's training staff per training PF), with no spillover, the same noise,
  // diminishing returns and drift. d.field = the capability it added by skill.
  function run(skills, target, alloc, noise, field) {
    const before = {}, d = { cap: {}, safe: {}, drift: 0, field: {} };
    FR.SKILLS.forEach(k => { before[k] = { cap: skills[k].cap, safe: skills[k].safe }; });
    const tr = part(alloc, 'training'), tOut = out(K.trainBase, tr) * noise, spp = tr.pf > 0 ? (tr.staff || 0) / tr.pf : 0;
    FR.SKILLS.forEach(k => {
      const sk = skills[k], g = Math.min(100 - sk.cap, tOut * (k === target ? 1 : K.spill) * dim(sk.cap));
      sk.cap += g; const dr = Math.min(sk.safe, g * K.drift); sk.safe -= dr; d.drift += dr;
    });
    FR.SKILLS.forEach(k => {
      const f = (field && field[k]) || 0; d.field[k] = 0; if (f <= 0) return;
      const sk = skills[k], g = Math.min(100 - sk.cap, FR.sim.output(K.trainBase, f, spp * f) * noise * dim(sk.cap));
      sk.cap += g; const dr = Math.min(sk.safe, g * K.drift); sk.safe -= dr; d.drift += dr; d.field[k] = g;
    });
    spread(skills, out(K.safeBase, part(alloc, 'safety')));
    FR.SKILLS.forEach(k => { d.cap[k] = skills[k].cap - before[k].cap; d.safe[k] = skills[k].safe - before[k].safe; });
    return d;
  }

  // field training PF by skill this week (client work, V0.4); zeros without accounts
  M.fieldPF = function (state) {
    if (FR.accounts && FR.accounts.fieldPF && state.accounts) return FR.accounts.fieldPF(state);
    const f = {}; FR.SKILLS.forEach(k => { f[k] = 0; }); return f;
  };
  // expected gains (no noise). cap/safe include client work; field = the capability client work adds by skill
  M.gains = function (state, alloc) {
    const d = run(FR.clone(state.model.skills), state.target, alloc, 1, M.fieldPF(state));
    return { cap: d.cap, safe: d.safe, field: d.field };
  };
  // "Client work: +0.4 agents, +0.2 coding a week." from a field map ('' when nothing reaches 0.05)
  M.fieldText = function (field) {
    const bits = FR.SKILLS.filter(k => field && field[k] >= 0.05).sort((a, b) => field[b] - field[a]).map(k => '+' + r1(field[k]) + ' ' + NAME(k).toLowerCase());
    return bits.length ? 'Client work: ' + bits.join(', ') + ' a week.' : '';
  };

  M.train = function (state, alloc, rng, report) {
    const noise = rng.range(1 - K.trainNoise, 1 + K.trainNoise);
    const d = run(state.model.skills, state.target, alloc, noise, M.fieldPF(state));
    report.flows.model = { cap: d.cap, safe: d.safe, drift: d.drift, noise, field: d.field };
    const t = state.target, up = d.cap[t], added = FR.SKILLS.reduce((a, k) => a + d.safe[k], 0) + d.drift, bits = [];
    if (up > 0.05) bits.push('Training on ' + NAME(t) + ': capability ' + r1(state.model.skills[t].cap) + ', up ' + r1(up) + '.');
    const fb = FR.SKILLS.filter(k => d.field[k] >= 0.05).map(k => '+' + r1(d.field[k]) + ' ' + NAME(k).toLowerCase());
    if (fb.length) bits.push('Client work: ' + fb.join(', ') + '.');
    if (added > 0.05 || d.drift > 0.05) bits.push('Safety work added ' + r1(added) + ' across skills; drift took ' + r1(d.drift) + '.');
    if (bits.length) report.memo.push({ kind: 'change', text: bits.join(' ') });
  };

  // project payoffs: flat deltas, no drift. skill may be 'all'. Returns the applied deltas.
  M.boost = function (state, skill, delta) {
    if (skill === 'all') { const r = {}; FR.SKILLS.forEach(k => { r[k] = M.boost(state, k, delta); }); return r; }
    const sk = state.model.skills[skill]; if (!sk) return { cap: 0, safe: 0 };
    const c0 = sk.cap, s0 = sk.safe;
    sk.cap = FR.clamp(sk.cap + ((delta && delta.cap) || 0), 0, 100);
    sk.safe = FR.clamp(sk.safe + ((delta && delta.safe) || 0), 0, lid(sk));
    return { cap: sk.cap - c0, safe: sk.safe - s0 };
  };

  // ---- outlook: what the UI and the memo say about a skill. `at` = the turn the next ladder check resolves. ----
  function look(state, skill, at) {
    const sk = state.model.skills[skill], g = M.gap(state, skill), rec = recent(sk, at);
    const lastStand = rec.length >= K.finalIncidents - 1;
    const level = (g > K.critGap || (lastStand && g > K.incidentGap)) ? 'critical'
      : (g > K.incidentGap || (g > K.warnGap && sk.warned)) ? 'warning' : g > K.watchGap ? 'watch' : 'ok';
    const turnsToFinal = g > K.critGap ? Math.max(1, K.critTurns - sk.critStreak) : null;
    let text = NAME(skill) + ': capability ' + Math.round(sk.cap) + ', safety ' + Math.round(sk.safe) + '. Gap ' + fmtGap(g);
    if (g > K.critGap && sk.critStreak >= 1) text += ', ' + ordinal(sk.critStreak) + ' week above ' + K.critGap;
    else if (g > K.warnGap && g <= K.incidentGap && sk.warnStreak >= 1) text += ', ' + ordinal(sk.warnStreak) + ' week above ' + K.warnGap;
    if (g > K.incidentGap) text += ', incident risk ' + Math.round(M.incidentChance(g, skill) * 100) + '% a week';
    text += '.';
    if (turnsToFinal) text += ' Final incident ' + weeks(turnsToFinal) + ' unless the gap falls to ' + K.critGap + ' or below.';
    let stand = '';
    if (lastStand) {
      const n = rec.length, last = Math.min.apply(null, rec.slice(-(K.finalIncidents - 1))) + K.incidentWindow - 1;
      stand = n + ' incidents in the past ' + K.incidentWindow + ' weeks. One more by ' + FR.dateLabel(last) + ' ends the lab.';
      text += ' ' + stand;
    }
    return { level, gap: g, turnsToFinal, text, stand, incidents: rec.length };
  }
  M.outlook = (state, skill) => look(state, skill, state.turn);

  // the Safety floor gauge: weighted pressure against K.pressureBands, never calmer than the worst skill's own outlook
  const LEVELS = ['ok', 'watch', 'warning', 'critical'], LEVEL_TEXT = { ok: 'in hand', watch: 'watch', warning: 'warning', critical: 'critical' };
  // whole numbers, with a decimal under 1 or when rounding would cross a band
  const fmtP = (v, th) => v > 0 && v < 1 ? v.toFixed(1) : th.some(t => (v > t) !== (Math.round(v) > t)) ? v.toFixed(1) : String(Math.round(v));
  M.pressureLevel = function (state) {
    const value = FR.round(M.pressure(state), 1);
    let i = K.pressureBands.filter(b => value > b).length;
    FR.SKILLS.forEach(k => { i = Math.max(i, LEVELS.indexOf(M.outlook(state, k).level)); });
    const level = LEVELS[i];
    const top = FR.SKILLS.reduce((b, k) => M.weight(k) * M.gap(state, k) > M.weight(b) * M.gap(state, b) ? k : b, FR.SKILLS[0]);
    const g = M.gap(state, top);
    const text = 'Pressure ' + fmtP(value, K.pressureBands) + ', ' + LEVEL_TEXT[level] + '. ' + (g > 0 ?
      NAME(top) + ' carries the most: gap ' + fmtP(FR.round(g, 1), TH()) + ' at weight ' + M.weight(top) + '.' : 'Safety is at or above capability on every skill.');
    return { value, level, text };
  };

  // ---- the slow-burn ladder, once per turn after the market resolves ----
  function incident(state, k, g, report) {
    const sk = state.model.skills[k], cash = state.money ? state.money.cash : 0, trust = M.incidentTrust(k);
    const cost = Math.round(K.incidentCash + Math.max(0, cash) * K.incidentCashPct);
    if (state.money) state.money.cash -= cost;
    if (FR.market && FR.market.nudgeTrust) FR.market.nudgeTrust(state, -trust, NAME(k) + ' incident', report);
    else if (state.market) state.market.trust = FR.clamp(state.market.trust - trust, 0, 100);
    sk.incidents.push(state.turn);
    if (state.stats) state.stats.incidents = (state.stats.incidents || 0) + 1;
    report.flows.incidentCost = (report.flows.incidentCost || 0) + cost;
    report.events.push({ type: 'model:incident', skill: k, gap: r1(g), cost, trust });
    report.news.push({ kind: 'incident', text: state.lab.name + ' discloses an incident in its ' + NAME(k).toLowerCase() + ' model. Review under way.' });
    // the rule that ends the lab, named with the first incident; with the second, the gap that stops the rolls
    const n = recent(sk, state.turn).length, rule = n < K.finalIncidents - 1
      ? ' A ' + ordinal(K.finalIncidents) + ' ' + NAME(k) + ' incident within ' + K.incidentWindow + ' weeks ends the lab.'
      : ' Incident odds fall to zero once the gap is ' + K.incidentGap + ' or below.';
    report.memo.push({ kind: 'flag', text: NAME(k) + ' incident at gap ' + fmtGap(g) + '. Cost ' + FR.fmtMoney(cost) + ' and ' + trust + ' points of public trust. Serving revenue is halved for 3 weeks while the model is under review.' + rule });
  }

  function final(state, k, g, why, report) {
    const text = NAME(k) + ': ' + why + '. Final incident. The board has shut down ' + state.lab.name + '.';
    state.status = 'dead';
    state.end = { turn: state.turn, cause: 'final', skill: k, text };
    report.events.push({ type: 'model:final', skill: k });
    report.news.push({ kind: 'incident', text: state.lab.name + ' halts operations after a severe incident in its ' + NAME(k).toLowerCase() + ' model.' });
    report.memo.push({ kind: 'flag', text });
  }

  M.ladder = function (state, rng, report) {
    const T = state.turn;
    for (const k of FR.SKILLS) {
      const sk = state.model.skills[k], g = M.gap(state, k);
      sk.warnStreak = g > K.warnGap ? sk.warnStreak + 1 : 0;
      if (g <= K.warnGap) sk.warned = false;
      sk.critStreak = g > K.critGap ? sk.critStreak + 1 : 0;
      // warnings come first: a gap that jumps past the incident line unwarned is warned now and rolls from next week
      const armed = sk.warned;
      let newWarn = false, hit = false;
      if (!sk.warned && (sk.warnStreak >= K.warnTurns || g > K.incidentGap)) {
        sk.warned = newWarn = true;
        if (state.stats) state.stats.warnings = (state.stats.warnings || 0) + 1;
        report.events.push({ type: 'model:warning', skill: k, gap: r1(g) });
      }
      if (armed && g > K.incidentGap && rng.chance(M.incidentChance(g, k))) { hit = true; incident(state, k, g, report); }
      if (sk.critStreak >= K.critTurns) { final(state, k, g, 'gap ' + fmtGap(g) + ', above ' + K.critGap + ' for ' + sk.critStreak + ' weeks', report); return; }
      if (recent(sk, T).length >= K.finalIncidents) { final(state, k, g, ordinal(K.finalIncidents) + ' incident in ' + K.incidentWindow + ' weeks, gap ' + fmtGap(g), report); return; }
      // forewarning: the status line for the next turn whenever the skill is in danger
      const o = look(state, k, T + 1);
      if (newWarn || hit || g > K.incidentGap || (o.stand && g > K.warnGap))
        report.memo.push({ kind: 'flag', text: o.text + (newWarn ? ' Safety review requested.' : '') });
      else if (o.stand) report.memo.push({ kind: 'flag', text: NAME(k) + ': ' + o.stand });   // gap in hand, the count still stands
    }
  };

  M.debug = function (state) {
    const d = { target: state.target, pressure: r1(M.pressure(state)), pressureLevel: M.pressureLevel(state).level, peakCap: r1(state.model.peakCap || 0) };
    FR.SKILLS.forEach(k => {
      const sk = state.model.skills[k];
      d[k] = { cap: FR.round(sk.cap, 2), safe: FR.round(sk.safe, 2), gap: FR.round(M.gap(state, k), 2), warnStreak: sk.warnStreak,
        critStreak: sk.critStreak, warned: sk.warned, incidents: sk.incidents.length, level: M.outlook(state, k).level };
    });
    return d;
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

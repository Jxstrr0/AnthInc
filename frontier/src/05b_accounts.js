// Enterprise accounts (V0.3, V0.4): named buyers sign multi-year contracts that reserve serving PF and pay a fixed weekly fee
// on top of open-market revenue. Mood rises with safe, fully served weeks and falls on unserved PF and incidents; an account
// below the churn line is marked leaving (off the book's PF and fees at once) and leaves the next week, never to return.
// V0.4: client work trains the sector's skill (fieldPF, applied by 03_model), a renewal meeting decides each contract end
// (Renew / Push up / Let go), live accounts put goals to the lab (asks), and sectors swing hot or cold for months.
// 05_money owns the state block (s.accounts) and calls step() after revenue resolves; 02_sim calls shock() after the
// ladder. Pure: randomness only from the rng passed in.
(function (FR) {
  const A = FR.accounts = {};
  const K = A.K = {
    unlockCap: 20, unlockTrust: 45,          // the first offers arrive once average capability and public trust reach these
    refreshTurns: 8, board: [1, 3],          // the offer board refreshes every 8 weeks with 1..3 offers
    maxActive: 5, maxActiveB: 6,             // live accounts at once; 6 once the Series B has closed (5: the no-B path)
    turns: [52, 104, 156],                   // contract length by tier
    feeBase: 60000, feeYear: 0.1,            // fee a week = tier × feeBase × (1 + feeYear × year)
    pf: [[8, 14], [16, 26], [28, 42]],       // reserved PF a week by tier
    minCap: [20, 30, 40],                    // requirements by tier: average capability,
    minSafe: [10, 7, 5],                     //   every skill's safety within this of its capability,
    minTrust: [45, 48, 52],                  //   public trust (trust drifts back to 50: tier 3 needs a lab above the drift)
    reach: 5, trustReach: 2,                 // a tier is dealt once average capability and trust are within these of its
                                             //   minimums; a Reference customer program boost reaches twice as far
    cooldown: 52,                            // a declined, expired or let-go buyer can be dealt again this many weeks later
    signCost: 150000, signWeeks: 2,          // onboarding $ × tier at signing; the fee starts 2 weeks later
    signTrust: [1, 1, 2],                    // public trust on signing, by tier
    // mood. `renew` is retired (V0.4: the renewal meeting reads K.meet); it stays as the UI's colour mark (= K.meet.upMood)
    mood: { start: 70, top: 80, up: 1, unserved: 3, incident: 25, rival: 10, rivalShield: 0.5, churn: 30, renew: 60, watch: 45 },
    readyShare: 0.5,                         // Enterprise readiness work: the unserved-PF penalty × this while it runs
    churnTrust: 2,                           // public trust lost when an account churns
    dueWarn: 8,                              // the renewal meeting opens this many weeks before the contract ends
    memoMax: 3, lostKeep: 10,                // account memo lines a week (after the money lines); lost accounts kept
    // V0.4 §3.1: client work trains the sector's skill. Each week a live account's served PF (last week's) × field.rate
    // trains its skill as that many training PF would, with no spillover (03_model applies it)
    sectorSkill: { Banking: 'coding', Retail: 'coding', Energy: 'coding', Telecoms: 'coding',
      Insurance: 'reasoning', Pharma: 'reasoning', Legal: 'reasoning', Logistics: 'agents', 'Public sector': 'agents' },
    field: { rate: 0.25 },                   // first pass 0.35: customer-first won 30% on the 20-seed probe (target 15-25%)
    // V0.4 §3.2: the renewal meeting. Thresholds +coldAdd in a cold sector. Push up: sure at upSure, upOdds between upMood
    // and upSure; a refused push up renews at the same tier. Unanswered at the last week (owner call): renews at the same
    // tier if mood allows, otherwise lapses as 'expired'. Memo warnings at these weeks left.
    meet: { renewMood: 45, upMood: 60, upSure: 70, upOdds: 0.5, coldAdd: 10, warnAt: [8, 4, 1] },
    // V0.4 §3.3: client asks. Rolled every `every` weeks of a live contract from `after` weeks after go-live; `quiet` = no
    // ask due in a contract's last 12 weeks; decline within `declineWeeks` of arrival; unanswered counts as accepted.
    ask: { chance: 0.35, maxOpen: 2, after: 13, every: 13, quiet: 12, declineWeeks: 2,
      weights: { cap: 35, inStep: 25, peak: 20, clean: 20 },
      bonusWeeks: 4, metMood: 10, missMood: 15, declineMood: 5,
      capAdd: [[3, 4], [4, 5], [5, 6]], capWeeks: [8, 16],          // cap: target = skill cap + capAdd[tier], due 8-16 weeks
      stepGap: 3, stepWeeks: 8, stepSpare: 4,                      // inStep: every gap ≤ 3 for 8 weeks in a row, due 8 + 4
      peakShare: [0.3, 0.5], peakMin: 3, peakLead: [2, 4], peakWeeks: 8,   // peak: +30-50% PF from 2-4 weeks out, 8 weeks
      cleanWeeks: [13, 26],                                        // clean: no lab incident for 13-26 weeks
      costCut: 0.15, costMood: 10, costDecline: 10 },              // cost (cold only): fee × 0.85 for the rest of the term
    // V0.4 §3.4: sector swings. Rolled every `every` weeks from the unlock: hotChance hot, otherwise cold, 13-26 weeks,
    // at most one hot and one cold; a sector rests `cooldown` weeks after a swing ends
    sector: { every: 26, hotChance: 0.6, weeks: [13, 26], cooldown: 26, hotWeight: 3, hotFee: 1.25, hotMood: 1, hotTop: 85, coldMood: 1 },
    // fictional buyers, straight tone. A churned name is never dealt again in the run (owner call); a declined, expired or
    // let-go name returns after K.cooldown weeks; a live account's name is not dealt while it is in the book.
    NAMES: [
      ['Halden Mutual', 'Insurance'], ['Westmark Assurance', 'Insurance'], ['Cedar Point Insurance', 'Insurance'], ['Keel Underwriters', 'Insurance'],
      ['Northgate Savings Bank', 'Banking'], ['Arbor Trust Bank', 'Banking'], ['Ridgeline Credit Union', 'Banking'], ['Carrow & Pike', 'Banking'],
      ['Brightwell Stores', 'Retail'], ['Marlow Home Supply', 'Retail'], ['Fairway Grocers', 'Retail'], ['Oakden Outfitters', 'Retail'],
      ['Coastline Freight', 'Logistics'], ['Tern Logistics', 'Logistics'], ['Prairie Rail Freight', 'Logistics'], ['Harbor Line Shipping', 'Logistics'],
      ['Meridian Parcel', 'Logistics'],
      ['Province Health Authority', 'Public sector'], ['State Revenue Office', 'Public sector'], ['Metro Transit Authority', 'Public sector'],
      ['Northern Water Board', 'Public sector'], ['Civil Records Agency', 'Public sector'],
      ['Ashby Therapeutics', 'Pharma'], ['Linden Pharma', 'Pharma'], ['Corvel Biosciences', 'Pharma'], ['Stanmore Clinical', 'Pharma'],
      ['Greyfield Energy', 'Energy'], ['Tidewater Power', 'Energy'], ['Kestrel Telecom', 'Telecoms'], ['Bramwell & Oakes', 'Legal']
    ]
  };
  A.SECTORS = K.NAMES.map(n => n[1]).filter((x, i, a) => a.indexOf(x) === i);

  const money = FR.fmtMoney, no = (why) => ({ ok: false, why }), sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const avg = (s) => s.model ? FR.sim.avgCap(s) : 0;
  const trust = (s) => s.market ? s.market.trust : 50;
  const wk = (n) => n + (n === 1 ? ' week' : ' weeks');
  const list = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const n1 = (v) => String(FR.round(v, 1));
  const cap$ = (v) => Math.round(v / 1000) * 1000;
  const worstGap = (s) => s.model ? Math.max.apply(null, FR.SKILLS.map(k => Math.max(0, s.model.skills[k].cap - s.model.skills[k].safe))) : 0;
  const inStep = (s) => FR.sim && FR.sim.inStep ? FR.sim.inStep(s) : worstGap(s) <= 5;
  const blankSectors = () => ({ hot: null, cold: null, nextAt: 0, last: {} });
  const blank = () => ({ active: [], offers: [], refreshAt: 0, unlocked: false, lost: [], used: [], cool: [], boost: 0, readyUntil: 0, sectors: blankSectors() });
  const out = (s, a) => a.leaving || a.mood < K.mood.churn;          // below the churn line: leaves next week
  const skillName = (k) => (FR.SKILL_NAME[k] || k).toLowerCase();
  function nudge(s, d, why, report) {
    if (!s.market) return 0;
    if (FR.market && FR.market.nudgeTrust) return FR.market.nudgeTrust(s, d, why, report || { flows: {} });
    const was = s.market.trust; s.market.trust = FR.clamp(was + d, 0, 100); return s.market.trust - was;
  }

  // ---- sectors (V0.4 §3.4) ----
  A.skillOf = (x) => K.sectorSkill[x && typeof x === 'object' ? x.sector : x] || null;
  // 'hot' | 'cold' | null for a sector this week
  A.swing = function (s, sector) {
    const sc = s.accounts && s.accounts.sectors; if (!sc) return null;
    if (sc.hot && sc.hot.name === sector && sc.hot.until >= s.turn) return 'hot';
    if (sc.cold && sc.cold.name === sector && sc.cold.until >= s.turn) return 'cold';
    return null;
  };
  // the Serving panel strip: swinging sectors, hot first
  A.sectorStrip = function (s) {
    const sc = s.accounts && s.accounts.sectors; if (!sc) return [];
    return ['hot', 'cold'].filter(k => sc[k] && sc[k].until >= s.turn).map(k => ({ name: sc[k].name, kind: k, skill: A.skillOf(sc[k].name),
      from: sc[k].from, until: sc[k].until, weeksLeft: sc[k].until - s.turn + 1 }));
  };
  const coldAdd = (s, a) => A.swing(s, a.sector) === 'cold' ? K.meet.coldAdd : 0;

  // ---- reads ----
  A.fee = (tier, turn) => Math.round(tier * K.feeBase * (1 + K.feeYear * FR.year(turn)) / 1000) * 1000;
  A.maxActive = (s) => s.money && s.money.roundsDone.indexOf('b') >= 0 ? K.maxActiveB : K.maxActive;
  // fee started and not leaving: PF reserved, fee paid. An account below the churn line is off the book at once.
  A.live = (s) => (s.accounts ? s.accounts.active : []).filter(a => a.starts <= s.turn && !out(s, a));
  // PF an account reserves this week: its contract PF plus a running peak ask (V0.4)
  A.peakPF = (s, a) => { const q = a.ask; return q && q.type === 'peak' && q.answered !== false && s.turn >= q.from && s.turn <= q.due ? q.target : 0; };
  A.pfOf = (s, a) => a.pfPerWeek + A.peakPF(s, a);
  A.reservedPF = (s) => sum(A.live(s), a => A.pfOf(s, a));
  A.pending = (s) => sum((s.accounts ? s.accounts.active : []).filter(a => a.starts > s.turn), a => a.pfPerWeek);   // signed, onboarding
  // PF each live account gets from `servingPF`, oldest contract first (pf includes a running peak ask)
  A.serve = function (s, servingPF) {
    let left = Math.max(0, servingPF == null ? Infinity : +servingPF || 0);
    return A.live(s).map(a => { const pf = A.pfOf(s, a), got = Math.min(pf, left); left -= got; return { id: a.id, pf, served: got }; });
  };
  const factor = (s) => (FR.money && FR.money.incidentFactor ? FR.money.incidentFactor(s) : 1) *
    Math.max(0, 1 - (FR.compute && FR.compute.revShare && s.compute ? FR.compute.revShare(s) : 0));
  // fees this week: each live account pays in proportion to the contract PF it was served (a peak ask's extra PF is
  // unpaid); × the incident factor and the DeepField share (contracts are locked: no Zeta drag). servedPF omitted = all served.
  A.feeRevenue = function (s, servedPF) {
    if (!s.accounts) return 0;
    const byId = {}; A.live(s).forEach(a => { byId[a.id] = a; });
    const gross = sum(A.serve(s, servedPF == null ? A.reservedPF(s) : servedPF), x => { const a = byId[x.id]; return a.pfPerWeek > 0 ? a.feePerWeek * Math.min(1, x.served / a.pfPerWeek) : 0; });
    return gross * factor(s);
  };
  A.contracted = (s) => sum(A.live(s), a => a.feePerWeek);           // $ a week the live book pays in full
  // remaining fees of the live book (onboarding and leaving accounts do not count: signing the week a milestone is met
  // cannot lift the round's terms)
  A.backlog = (s) => sum(A.live(s), a => a.feePerWeek * Math.max(0, a.ends - s.turn + 1));
  A.ready = (s) => !!(s.accounts && s.accounts.readyUntil >= s.turn);
  A.qualifies = function (s, o) {
    const c = avg(s), g = worstGap(s), t = trust(s);
    if (c < o.minCap) return no('Needs average capability ' + o.minCap + '; the lab is at ' + n1(c));
    if (g > o.minSafe) return no('Needs every skill\'s safety within ' + o.minSafe + ' of capability; the widest gap is ' + n1(g));
    if (t < o.minTrust) return no('Needs public trust ' + o.minTrust + '; trust is ' + Math.floor(t));
    return { ok: true, why: '' };
  };
  const tierReq = (t) => ({ minCap: K.minCap[t - 1], minSafe: K.minSafe[t - 1], minTrust: K.minTrust[t - 1] });

  // V0.4 §3.1: field PF by skill for this week's training: last week's served PF of every live account × K.field.rate
  A.fieldPF = function (s) {
    const f = {}; FR.SKILLS.forEach(k => { f[k] = 0; });
    A.live(s).forEach(a => { const k = A.skillOf(a); if (k && k in f) f[k] += (a.served || 0) * K.field.rate; });
    FR.SKILLS.forEach(k => { f[k] = FR.round(f[k], 2); });
    return f;
  };

  // ---- the board ----
  // a tier is in reach when average capability and trust are near its minimums (w = 2: the Reference program's wider reach)
  const inReach = (s, t, w) => avg(s) >= K.minCap[t - 1] - K.reach * (w || 1) && trust(s) >= K.minTrust[t - 1] - K.trustReach * (w || 1);
  function tierFor(s, rng) {
    const ok = [1, 2, 3].filter(t => inReach(s, t));
    const top = ok.length ? ok[ok.length - 1] : 1;
    let tier = top > 1 && rng() < 1 / 3 ? rng.int(1, top - 1) : top;   // mostly the highest tier in reach
    // Reference customer program: one tier up while that tier is within the wider reach; otherwise the boost waits
    if (s.accounts.boost > 0 && tier < 3 && inReach(s, tier + 1, 2)) { s.accounts.boost--; tier++; }
    return tier;
  }
  const cooling = (st, T) => (st.cool || []).filter(c => c.until > T).map(c => c.name);
  // a hot sector's names weigh K.sector.hotWeight; with no swing the draw is the plain uniform one
  function pickName(s, pool, rng) {
    const w = pool.map(n => A.swing(s, n[1]) === 'hot' ? K.sector.hotWeight : 1);
    if (w.every(x => x === 1)) return pool.splice(rng.int(0, pool.length - 1), 1)[0];
    let r = rng() * sum(w, x => x), i = 0;
    for (; i < pool.length - 1 && r >= w[i]; i++) r -= w[i];
    return pool.splice(i, 1)[0];
  }
  function deal(s, rng, from, report) {
    const st = s.accounts; st.cool = (st.cool || []).filter(c => c.until > from);
    const taken = st.used.concat(st.active.map(a => a.name), cooling(st, from));
    const pool = K.NAMES.filter(n => taken.indexOf(n[0]) < 0 && A.swing(s, n[1]) !== 'cold');   // a cold sector deals no offers
    st.offers = []; st.refreshAt = from + K.refreshTurns;
    const n = Math.min(pool.length, rng.int(K.board[0], K.board[1]));
    for (let i = 0; i < n; i++) {
      const nm = pickName(s, pool, rng), tier = tierFor(s, rng), r = K.pf[tier - 1], hot = A.swing(s, nm[1]) === 'hot';
      const o = { id: 'a' + from + String.fromCharCode(97 + i), name: nm[0], sector: nm[1], tier, pfPerWeek: rng.int(r[0], r[1]),
        feePerWeek: hot ? cap$(A.fee(tier, from) * K.sector.hotFee) : A.fee(tier, from), turns: K.turns[tier - 1], minCap: K.minCap[tier - 1], minSafe: K.minSafe[tier - 1],
        minTrust: K.minTrust[tier - 1], expires: st.refreshAt - 1 };
      if (hot) o.hot = true;   // dealt while its sector is hot: +25% for the whole term
      st.offers.push(o);
    }
    report.events.push({ type: 'account:offers', n: st.offers.length });
    return st.offers.length;
  }

  // ---- commands ----
  A.sign = function (s, id) {
    const st = s.accounts; if (!st) return no('No account offers yet');
    const i = st.offers.findIndex(o => o.id === id), o = st.offers[i];
    if (!o) return no('That account offer is no longer on the board');
    if (s.turn > o.expires) return no('The ' + o.name + ' offer has lapsed');
    const q = A.qualifies(s, o); if (!q.ok) return q;
    const max = A.maxActive(s);
    if (st.active.length >= max) return no('The book is full: at most ' + max + ' accounts at once');
    const cost = K.signCost * o.tier;
    if (s.money.cash < cost) return no('Onboarding ' + o.name + ' costs ' + money(cost) + ', cash is ' + money(s.money.cash));
    s.money.cash -= cost; st.offers.splice(i, 1);
    const starts = s.turn + K.signWeeks, a = { id: o.id, name: o.name, sector: o.sector, tier: o.tier, pfPerWeek: o.pfPerWeek, feePerWeek: o.feePerWeek,
      ends: starts + o.turns - 1, signed: s.turn, starts, mood: K.mood.start, served: 0, turns: o.turns, meeting: null, ask: null, field: 0 };
    if (o.hot) a.hot = true;
    st.active.push(a);
    nudge(s, K.signTrust[o.tier - 1], o.name + ' signed');
    return { ok: true, from: 'accounts', event: { type: 'account:signed', id: a.id, name: a.name, tier: a.tier }, memo: weekLine(s) };
  };
  A.decline = function (s, id) {
    const st = s.accounts; if (!st) return no('No account offers yet');
    const i = st.offers.findIndex(o => o.id === id), o = st.offers[i];
    if (!o) return no('That account offer is no longer on the board');
    st.offers.splice(i, 1); rest(st, o.name, s.turn, 'declined', { pfPerWeek: o.pfPerWeek, feePerWeek: o.feePerWeek, turns: o.turns });
    return { ok: true, from: 'accounts', memo: weekLine(s) };
  };
  // a declined, expired or let-go buyer rests for K.cooldown weeks, then may be dealt again
  function rest(st, name, T, why, terms) {
    st.cool = (st.cool || []).filter(c => c.name !== name).concat([Object.assign({ name, until: T + K.cooldown, why, at: T }, terms || {})]);
  }
  // the week's signings and declines share one memo line (key 'accounts:<turn>': 02_sim replaces the earlier version);
  // it counts against the week's K.memoMax account lines
  function weekLine(s) {
    const st = s.accounts, T = s.turn, sg = st.active.filter(a => a.signed === T), dc = (st.cool || []).filter(d => d.at === T && d.why === 'declined');
    let text = '';
    if (sg.length === 1) {
      const a = sg[0];
      text = 'Signed ' + a.name + ' (' + a.sector + ', tier ' + a.tier + '): ' + a.pfPerWeek + ' PF reserved and ' + money(a.feePerWeek) + ' a week from ' +
        FR.dateLabel(a.starts) + ' for ' + wk(a.turns || (a.ends - a.starts + 1)) + '. Onboarding ' + money(K.signCost * a.tier) + '. Public trust up ' + n1(K.signTrust[a.tier - 1]) + '.';
    } else if (sg.length > 1) {
      text = 'Signed ' + list(sg.map(a => a.name + ' (tier ' + a.tier + ')')) + ': ' + sum(sg, a => a.pfPerWeek) + ' PF reserved and ' + money(sum(sg, a => a.feePerWeek)) +
        ' a week from ' + FR.dateLabel(T + K.signWeeks) + '. Onboarding ' + money(sum(sg, a => K.signCost * a.tier)) + '. Public trust up ' + n1(sum(sg, a => K.signTrust[a.tier - 1])) + '.';
    }
    if (dc.length === 1 && !sg.length) text = 'Declined ' + dc[0].name + ': ' + dc[0].pfPerWeek + ' PF for ' + money(dc[0].feePerWeek) + ' a week over ' + wk(dc[0].turns) + '.';
    else if (dc.length) text += (text ? ' ' : '') + 'Declined ' + list(dc.map(d => d.name)) + '.';
    return { kind: sg.length ? 'good' : 'change', text, key: 'accounts:' + T };
  }
  const findLive = (s, id) => (s.accounts ? s.accounts.active : []).find(a => a.id === id);

  // ---- renewal meetings (V0.4 §3.2) ----
  const CHOICE = { renew: 'Renew', up: 'Push up', go: 'Let go' };
  // what each choice would do if the contract ended now: thresholds, odds, the unanswered default. For the meeting card.
  // Mood is shown floored (the readiness penalty can leave a half point), so 'now 44' never reads as meeting 'needs 45'.
  A.meetingView = function (s, id) {
    const a = typeof id === 'object' ? id : findLive(s, id); if (!a || !a.meeting) return null;
    const c = coldAdd(s, a), M = K.meet, mood = Math.floor(a.mood), up = a.tier + 1, left = a.ends - s.turn + 1;
    const renewNeed = M.renewMood + c, upNeed = M.upMood + c, sure = M.upSure + c;
    const renewOk = a.mood >= renewNeed, reqUp = up <= 3 ? A.qualifies(s, tierReq(up)) : no('Tier 3 is the top tier');
    const chance = up > 3 || !reqUp.ok || a.mood < upNeed ? 0 : a.mood >= sure ? 1 : M.upOdds;
    const lc = (x) => x.charAt(0).toLowerCase() + x.slice(1);
    // the terms a renewal at `tier` would carry (what resolve() writes): fee repriced to the week after ends, PF scaled
    const terms = (tier) => { const pf = scalePF(a.pfPerWeek, a.tier, tier), d = pf - a.pfPerWeek;
      return money(A.fee(tier, a.ends + 1)) + ' a week from ' + FR.dateLabel(a.ends + 1) + ', ' + pf + ' PF' + (d ? ' (' + (d > 0 ? '+' : '') + d + ')' : '') + ', ' + wk(K.turns[tier - 1]); };
    const stands = renewOk ? 'renews at tier ' + a.tier : 'ends: renewal needs mood ' + renewNeed;
    const upText = up > 3 ? 'Push up: tier 3 is the top tier; it renews at tier 3.'
      : !reqUp.ok ? 'Push up to tier ' + up + ' ' + lc(reqUp.why) + '. As things stand it ' + stands + '.'
      : chance === 0 ? 'Push up needs mood ' + upNeed + ' (now ' + mood + '); as things stand it ' + stands + '.'
      : 'Push up to tier ' + up + ': accepts at mood ' + sure + '+ (now ' + mood + (chance === 1 ? ': accepts' : ': even odds; a refusal ' + stands) + '). Tier ' + up + ': ' + terms(up) + '.';
    const renewText = 'Renew at tier ' + a.tier + ': needs mood ' + renewNeed + ' (now ' + mood + ')' + (renewOk ? '. ' + terms(a.tier) + '.' : '; below it the contract ends.');
    const goText = 'Let go: leaves ' + FR.dateLabel(a.ends) + ', ' + a.pfPerWeek + ' PF freed, no trust cost.';
    const dflt = 'Unanswered, it ' + stands + '.';
    const pick = a.meeting.answer, text = pick === 'up' ? upText : pick === 'go' ? goText : pick === 'renew' ? renewText : dflt;
    return { id: a.id, name: a.name, opens: a.meeting.opens, answer: pick, ends: a.ends, weeksLeft: left, cold: c > 0, mood, stands,
      renew: { ok: renewOk, need: renewNeed, text: renewText },
      up: { ok: chance > 0, tier: up <= 3 ? up : null, need: upNeed, sure, chance, qualifies: reqUp.ok, why: reqUp.ok ? '' : reqUp.why, text: upText },
      go: { ok: true, text: goText }, unanswered: dflt, text };
  };
  A.meetings = (s) => (s.accounts ? s.accounts.active : []).filter(a => a.meeting && !out(s, a));
  A.renew = function (s, id, choice) {
    const a = findLive(s, id); if (!a) return no('That account is not in the book');
    if (!a.meeting) return no('The ' + a.name + ' renewal meeting opens ' + FR.dateLabel(a.ends - K.dueWarn));
    if (out(s, a)) return no(a.name + ' is leaving');
    if (!Object.prototype.hasOwnProperty.call(CHOICE, choice)) return no('Unknown renewal choice');
    if (choice === 'up' && a.tier >= 3) return no('Tier 3 is the top tier');
    a.meeting.answer = choice;
    const v = A.meetingView(s, a);
    return { ok: true, from: 'accounts', memo: { kind: 'change', key: 'meeting:' + a.id,
      text: a.name + ' renewal meeting: ' + v.text + ' Settled ' + FR.dateLabel(a.ends) + '; changeable until then.' } };
  };
  function scalePF(pf, from, to) {
    const a = K.pf[from - 1], b = K.pf[to - 1], x = FR.clamp((pf - a[0]) / Math.max(1, a[1] - a[0]), 0, 1);
    return Math.round(b[0] + x * (b[1] - b[0]));
  }
  // the last contract week: resolve the meeting. Returns nothing; pushes lines, events.
  function resolve(s, a, rng, L, report) {
    const T = s.turn, c = coldAdd(s, a), M = K.meet, pick = a.meeting ? a.meeting.answer : null, mood = Math.floor(a.mood);
    const renewOk = a.mood >= M.renewMood + c;
    if (pick === 'go') {
      lose(s, a, 'let go', report);
      L.push({ p: 1, kind: 'change', text: a.name + ' let go at term end: ' + a.pfPerWeek + ' PF and ' + money(a.feePerWeek) + ' a week released. No trust cost.' });
      return;
    }
    let tier = a.tier, note = '';
    if (pick === 'up') {
      const up = a.tier + 1, q = up <= 3 ? A.qualifies(s, tierReq(up)) : no('tier 3 is the top tier');
      if (up <= 3 && q.ok && a.mood >= M.upMood + c) {
        if (a.mood >= M.upSure + c || rng.chance(M.upOdds)) tier = up;
        else note = ' It declined the push to tier ' + up + ' at mood ' + mood + '.';
      } else if (up <= 3) note = ' Push up to tier ' + up + ' not possible: ' + (q.ok ? 'needs mood ' + (M.upMood + c) + ', mood ' + mood : q.why.charAt(0).toLowerCase() + q.why.slice(1)) + '.';
    }
    if (tier === a.tier && !renewOk) {
      lose(s, a, 'expired', report);
      L.push({ p: 1, kind: 'flag', text: a.name + ' contract ended without renewal: mood ' + mood + ', renewal needs ' + (M.renewMood + c) + (c ? ' in a cold sector' : '') + '.' +
        (pick ? note : ' No answer to the renewal meeting.') + ' ' + a.pfPerWeek + ' PF released.' });
      return;
    }
    const was = a.feePerWeek, pf0 = a.pfPerWeek, up = tier > a.tier;
    a.pfPerWeek = scalePF(pf0, a.tier, tier); a.tier = tier; a.feePerWeek = A.fee(tier, T + 1); a.ends = T + K.turns[tier - 1]; a.turns = K.turns[tier - 1];
    a.meeting = null; a.ask = null; delete a.hot;
    report.events.push({ type: 'account:renewed', id: a.id, name: a.name, tier, up });
    L.push({ p: 1, kind: 'good', text: a.name + ' renews' + (up ? ' at tier ' + tier : '') + ' for ' + wk(K.turns[tier - 1]) + ' at ' + money(a.feePerWeek) + ' a week, ' +
      (a.feePerWeek === was ? 'unchanged' : (a.feePerWeek > was ? 'up' : 'down') + ' from ' + money(was)) + (a.pfPerWeek !== pf0 ? ', reserving ' + a.pfPerWeek + ' PF, up from ' + pf0 : '') +
      ', through ' + FR.dateLabel(a.ends) + '. Mood ' + mood + '.' + (pick ? note : ' No answer to the renewal meeting: same tier.') });
  }

  // ---- client asks (V0.4 §3.3) ----
  // project the lab `weeks` weeks ahead on sliders `sl` and target `target` (no randomness; field training included)
  function project(s, sl, target, weeks) {
    const v = Object.assign({}, s, { sliders: sl, target, model: FR.clone(s.model) }), alloc = FR.sim.allocate(v);
    for (let i = 0; i < weeks; i++) {
      const g = FR.model.gains(v, alloc);
      FR.SKILLS.forEach(k => { v.model.skills[k].cap += g.cap[k]; v.model.skills[k].safe += g.safe[k]; });
    }
    return v.model.skills;
  }
  const gapOf = (sk) => Math.max.apply(null, FR.SKILLS.map(k => Math.max(0, sk[k].cap - sk[k].safe)));
  const freePF = (s) => { const al = FR.sim.allocate(s); return Math.max(0, al.capacity - al.projects.pf); };
  // the best plan for one ask, whatever the sliders are this week: Serving just covers the book (live + onboarding), every
  // other free PF goes to `into` (training for a cap ask, safety for an inStep ask)
  function bestPlan(s, into) {
    const free = freePF(s), need = A.reservedPF(s) + A.pending(s);
    const sv = free > 0 ? Math.min(100, Math.ceil(need / free * 100)) : 100, sl = { training: 0, serving: sv, safety: 0, research: 0 };
    sl[into] = 100 - sv; return sl;
  }
  // a new ask for account a at turn T, or null when no type can be met in time. Asks already open elsewhere in the book
  // count: two asks that no single plan meets together are not dealt (a cap ask and an inStep ask pull the free PF
  // opposite ways; cap asks on two skills split the training; peaks add up)
  function makeAsk(s, a, rng) {
    const T = s.turn, Q = K.ask, room = a.ends - Q.quiet - T, skill = A.skillOf(a) || 'coding';
    const base = { skill, arrived: T, from: T, progress: 0, answered: null, declineBy: T + Q.declineWeeks, reward: 0 };
    if (A.swing(s, a.sector) === 'cold') return Object.assign(base, { type: 'cost', target: Q.costCut, due: a.ends, weeks: a.ends - T });
    const open = A.asks(s).filter(x => x !== a).map(x => x.ask), has = (f) => open.some(f);
    const opts = [];
    const capW = Math.min(rng.int(Q.capWeeks[0], Q.capWeeks[1]), room), add = rng.int(Q.capAdd[a.tier - 1][0], Q.capAdd[a.tier - 1][1]);
    const cur = s.model.skills[skill].cap, tgt = Math.ceil(cur + add);
    if (capW >= Q.capWeeks[0] && tgt <= 100 && !has(q => q.type === 'inStep' || (q.type === 'cap' && q.skill !== skill))) {
      const top = project(s, bestPlan(s, 'training'), skill, capW)[skill].cap;
      if (top >= tgt) opts.push({ type: 'cap', target: tgt, weeks: capW, due: T + capW, progress: FR.round(cur, 1) });
    }
    if (Q.stepWeeks + Q.stepSpare <= room && !has(q => q.type === 'cap')) {
      const sk = project(s, bestPlan(s, 'safety'), s.target, Q.stepSpare);
      if (gapOf(sk) <= Q.stepGap) opts.push({ type: 'inStep', target: Q.stepGap, weeks: Q.stepWeeks, due: T + Q.stepWeeks + Q.stepSpare });
    }
    // peak: free PF covers the book, onboarding, every other open peak not yet counted in reservedPF, and this amount
    const lead = rng.int(Q.peakLead[0], Q.peakLead[1]), amt = Math.max(Q.peakMin, Math.round(a.pfPerWeek * rng.range(Q.peakShare[0], Q.peakShare[1])));
    const otherPeaks = sum(A.asks(s).filter(x => x !== a && x.ask.type === 'peak' && !A.peakPF(s, x)), x => x.ask.target);
    if (lead + Q.peakWeeks <= room && freePF(s) >= A.reservedPF(s) + A.pending(s) + otherPeaks + amt)
      opts.push({ type: 'peak', target: amt, weeks: Q.peakWeeks, from: T + lead, due: T + lead + Q.peakWeeks - 1 });
    const cw = Math.min(rng.int(Q.cleanWeeks[0], Q.cleanWeeks[1]), room);
    if (cw >= Q.cleanWeeks[0] && worstGap(s) <= FR.model.K.incidentGap) opts.push({ type: 'clean', target: 0, weeks: cw, due: T + cw });
    if (!opts.length) return null;
    let r = rng() * sum(opts, o => Q.weights[o.type]), i = 0;
    for (; i < opts.length - 1 && r >= Q.weights[opts[i].type]; i++) r -= Q.weights[opts[i].type];
    const o = Object.assign(base, opts[i]);
    if (o.type === 'inStep') o.skill = null;
    o.reward = cap$(Q.bonusWeeks * a.feePerWeek);
    return o;
  }
  // memo text of an arriving ask (straight tone)
  function askText(s, a) {
    const q = a.ask, Q = K.ask, d = FR.dateLabel, by = ' Declining by ' + d(q.declineBy) + ' costs ' + (q.type === 'cost' ? Q.costDecline : Q.declineMood) + ' mood.';
    const terms = ' Met: ' + money(q.reward) + ' bonus and mood up ' + Q.metMood + '; missed: mood down ' + Q.missMood + '.';
    if (q.type === 'cap') return a.name + ' asks for ' + skillName(q.skill) + ' capability ' + q.target + ' by ' + d(q.due) + ' (now ' + n1(s.model.skills[q.skill].cap) + ').' + terms + by;
    if (q.type === 'inStep') return a.name + ' asks that every safety stay within ' + q.target + ' of capability for ' + wk(q.weeks) + ', starting now, by ' + d(q.due) + '.' + terms + by;
    if (q.type === 'peak') return a.name + ' asks for ' + q.target + ' more PF from ' + d(q.from) + ' for ' + wk(q.weeks) + '.' + terms + by;
    if (q.type === 'clean') return a.name + ' asks for no lab incident through ' + d(q.due) + '.' + terms + by;
    return a.name + ' asks for a ' + Math.round(q.target * 100) + '% fee cut for the rest of its term: ' + money(a.feePerWeek) + ' to ' + money(cap$(a.feePerWeek * (1 - q.target))) +
      ' a week. Accepting lifts mood ' + Q.costMood + '.' + by + ' Unanswered, it is accepted.';
  }
  // progress and outlook of an open ask, for the UI row and the bots. onTrack: the forecast says it can be met on today's plan.
  A.askView = function (s, id) {
    const a = typeof id === 'object' ? id : findLive(s, id); if (!a || !a.ask) return null;
    const q = a.ask, T = s.turn, left = Math.max(0, q.due - T + 1), declinable = q.answered == null && T <= q.declineBy;
    let progress = q.progress, target = q.target, onTrack = true, progressText = '';
    if (q.type === 'cap') {
      progress = FR.round(s.model.skills[q.skill].cap, 1);
      const top = project(s, s.sliders, s.target, left)[q.skill].cap;
      onTrack = top >= q.target;
      progressText = progress + ' / ' + q.target + ' · ' + wk(left) + ' left';
    } else if (q.type === 'inStep') {
      const g = gapOf(project(s, s.sliders, s.target, 1));
      onTrack = g <= q.target && q.progress + left >= q.weeks;
      progressText = q.progress + ' / ' + q.weeks + ' weeks in step · ' + wk(left) + ' left';
      target = q.weeks;
    } else if (q.type === 'peak') {
      const need = A.reservedPF(s) + A.pending(s) + (T < q.from ? q.target : 0), have = FR.sim.allocate(s).serving.pf;
      onTrack = have >= need - 0.05;
      progressText = T < q.from ? 'Starts in ' + wk(q.from - T) : q.progress + ' / ' + q.weeks + ' weeks served · ' + wk(left) + ' left';
      target = q.weeks;
    } else if (q.type === 'clean') {
      onTrack = worstGap(s) <= FR.model.K.incidentGap;
      progress = Math.min(q.weeks, T - q.arrived); target = q.weeks;
      progressText = wk(progress) + ' clean · ' + wk(left) + ' left';
    } else {
      progressText = 'Fee ' + money(a.feePerWeek) + ' to ' + money(cap$(a.feePerWeek * (1 - q.target))) + ' a week';
      onTrack = true;
    }
    return { id: a.id, name: a.name, type: q.type, skill: q.skill, target, progress, due: q.due, from: q.from, weeksLeft: left, declinable,
      declineBy: q.declineBy, answered: q.answered, reward: q.reward, onTrack, progressText };
  };
  A.asks = (s) => (s.accounts ? s.accounts.active : []).filter(a => a.ask && !out(s, a));
  function applyCut(s, a) {
    const q = a.ask; a.feePerWeek = cap$(a.feePerWeek * (1 - q.target)); a.cut = q.target;
    a.mood = FR.clamp(a.mood + K.ask.costMood, 0, 100); a.ask = null;
  }
  A.answerAsk = function (s, id, accept) {
    const a = findLive(s, id); if (!a) return no('That account is not in the book');
    const q = a.ask; if (!q) return no(a.name + ' has no open ask');
    if (out(s, a)) return no(a.name + ' is leaving');
    if (accept) {
      if (q.type === 'cost') {
        const was = a.feePerWeek; applyCut(s, a);
        return { ok: true, from: 'accounts', memo: { kind: 'change', key: 'ask:' + a.id, text: a.name + ' fee cut accepted: ' + money(was) + ' to ' + money(a.feePerWeek) +
          ' a week through ' + FR.dateLabel(a.ends) + '. Mood ' + Math.floor(a.mood) + '.' } };
      }
      q.answered = true;
      return { ok: true, from: 'accounts', memo: { kind: 'change', key: 'ask:' + a.id, text: a.name + ' ask accepted: due ' + FR.dateLabel(q.due) + '.' } };
    }
    if (q.answered === true) return no('The ' + a.name + ' ask is already accepted');
    if (s.turn > q.declineBy) return no('The window to decline the ' + a.name + ' ask closed ' + FR.dateLabel(q.declineBy));
    const d = q.type === 'cost' ? K.ask.costDecline : K.ask.declineMood;
    a.mood = FR.clamp(a.mood - d, 0, 100); a.ask = null;
    if (a.mood < K.mood.churn) a.leaving = true;
    return { ok: true, from: 'accounts', memo: { kind: 'change', key: 'ask:' + a.id, text: a.name + ' ask declined: mood down ' + d + ' to ' + Math.floor(a.mood) + '.' +
      (a.leaving ? ' Below ' + K.mood.churn + ', it ends its contract next week.' : '') } };
  };

  // ---- effects from projects (07_projects: Enterprise readiness work, Reference customer program) ----
  A.lift = function (s, mood, weeks) {
    const st = s.accounts; if (!st) return;
    st.active.forEach(a => { if (out(s, a)) a.leaving = true; a.mood = FR.clamp(a.mood + mood, 0, 100); });   // told it leaves: it still does
    st.readyUntil = Math.max(st.readyUntil || 0, s.turn + weeks - 1);
  };
  A.refer = function (s, n) { if (s.accounts) s.accounts.boost = (s.accounts.boost || 0) + n; };

  // ---- the week ----
  A.init = function (s) { s.accounts = blank(); };
  // V0.3 → V0.4 save: no meetings, asks or sectors; swings roll from 13 weeks on; a contract inside its meeting window
  // gets its meeting now (02_sim's migrate calls this)
  A.migrate = function (s) {
    const st = s.accounts; if (!st) return;
    if (!st.sectors) st.sectors = Object.assign(blankSectors(), { nextAt: st.unlocked ? s.turn + 13 : 0 });
    if (!st.sectors.last) st.sectors.last = {};
    st.active.forEach(a => {
      if (a.meeting === undefined) a.meeting = null;
      if (a.ask === undefined) a.ask = null;
      if (a.field == null) a.field = 0;
      if (!a.meeting && a.starts <= s.turn && a.ends - s.turn < K.dueWarn && a.ends >= s.turn) a.meeting = { opens: s.turn, answer: null };
    });
  };
  // report lines: step() and shock() collect them; flush() writes the week's K.memoMax most urgent (lower p) once, after
  // shock (02_sim calls it; report.deferAccounts). The week's sign/decline line (key 'accounts:<turn>') takes one of the
  // places. A line's text may be a function, read at flush time (the meeting line quotes mood after the week's shocks).
  // Priority: p0 an account leaving (always gets a place), p1 meetings, p2 asks, p3 sector swings, p4 go-live and mood
  // flags, p5 the board.
  function lines(report) { const f = report.flows.accounts || (report.flows.accounts = {}); return f.lines || (f.lines = []); }
  function flush(report) {
    const L = lines(report), f = report.flows.accounts, target = report.memo;
    const cmd = target.some(l => l && typeof l.key === 'string' && l.key.indexOf('accounts:') === 0) ? 1 : 0;
    const room = Math.max(L.some(l => l.p === 0) ? 1 : 0, K.memoMax - cmd - (f.said || 0));
    // function lines are read first; one that comes back empty (a meeting whose account is now leaving) takes no place
    const all = L.map(l => typeof l.text === 'function' ? Object.assign({}, l, { text: l.text() }) : l).filter(l => l.text).sort((a, b) => a.p - b.p);
    let out = all.slice(0, Math.max(0, room)).map(l => ({ kind: l.kind, text: l.text }));
    // more lines than places: the last place becomes one 'Also this week' line naming the rest, so no news is lost
    if (all.length > room && room >= 2) {
      out = out.slice(0, room - 1);
      out.push({ kind: 'change', text: 'Also this week: ' + all.slice(room - 1).map(shortOf).join('; ') + '.' });
    }
    f.said = (f.said || 0) + out.length; f.lines = [];
    const at = f.at != null && f.at <= target.length ? f.at : target.length;
    target.splice.apply(target, [at, 0].concat(out));
  }
  // a line's short form for the 'Also this week' line: its own `short`, else its text up to the first sentence or colon
  const shortOf = (l) => l.short || String(l.text).split(/[.:] /)[0].replace(/\.$/, '');
  A.flush = function (report) { if (report.flows && report.flows.accounts) flush(report); };
  const auto = (report) => { if (!report.deferAccounts) flush(report); };
  function lose(s, a, why, report) {
    const st = s.accounts;
    st.active = st.active.filter(x => x !== a);
    if (why === 'churn') { if (st.used.indexOf(a.name) < 0) st.used.push(a.name); }   // gone for the run
    else rest(st, a.name, s.turn, why);
    st.lost.push({ name: a.name, turn: s.turn, why, signed: a.signed });
    if (st.lost.length > K.lostKeep) st.lost.splice(0, st.lost.length - K.lostKeep);
    report.events.push({ type: 'account:churned', id: a.id, name: a.name, why });
  }
  const moodLine = (s, a, why) => ({ p: 0, kind: 'flag', text: a.name + ' mood ' + Math.floor(a.mood) + ' ' + why + '. The account ends its contract next week.' });
  // mood down d; crossing the churn line marks it leaving (one p0 line), crossing the watch line flags it
  function drop(s, a, d, why, L, watchText) {
    const was = a.mood; a.mood = FR.clamp(a.mood - d, 0, 100);
    if (a.mood < K.mood.churn && was >= K.mood.churn) { a.leaving = true; L.push(moodLine(s, a, why)); }
    else if (watchText && a.mood < K.mood.watch && was >= K.mood.watch) L.push({ p: 4, kind: 'flag', text: watchText() });
  }

  // sector swings: expire, then roll every K.sector.every weeks
  function swings(s, rng, L, report) {
    const sc = s.accounts.sectors || (s.accounts.sectors = blankSectors()), T = s.turn, S = K.sector;
    if (!sc.last) sc.last = {};
    ['hot', 'cold'].forEach(k => {
      const w = sc[k]; if (!w || w.until >= T) return;
      sc.last[w.name] = w.until; sc[k] = null;
      L.push({ p: 4, kind: 'change', text: w.name + ' ' + (k === 'hot' ? 'demand' : 'budgets') + ' back to normal: ' + (k === 'hot' ? 'offers at the usual rate and fees.' : 'offers resume.') });
    });
    if (!sc.nextAt) sc.nextAt = T + S.every;
    if (T < sc.nextAt) return;
    sc.nextAt = T + S.every;
    const kind = rng() < S.hotChance ? 'hot' : 'cold';
    if (sc[kind]) return;
    const busy = [sc.hot, sc.cold].filter(Boolean).map(w => w.name);
    const pool = A.SECTORS.filter(n => busy.indexOf(n) < 0 && !(sc.last[n] != null && T - sc.last[n] < S.cooldown));
    if (!pool.length) return;
    const name = rng.pick(pool), until = T + rng.int(S.weeks[0], S.weeks[1]), skill = skillName(A.skillOf(name));
    sc[kind] = { name, until, from: T };
    report.events.push({ type: 'account:sector', name, kind, until });
    L.push({ p: 3, kind: kind === 'hot' ? 'good' : 'flag', text: kind === 'hot'
      ? name + ' turns hot through ' + FR.dateLabel(until) + ': ' + name + ' offers come ' + S.hotWeight + '× as often at fees ' + Math.round((S.hotFee - 1) * 100) +
        '% higher for their term; ' + name + ' accounts gain ' + S.hotMood + ' more mood a week (top ' + S.hotTop + '). Client work trains ' + skill + '.'
      : name + ' turns cold through ' + FR.dateLabel(until) + ': no new ' + name + ' offers; ' + name + ' accounts lose ' + S.coldMood +
        ' mood a week unless every safety is within ' + (FR.sim && FR.sim.K ? FR.sim.K.safeMargin : 5) + ' of capability, and their renewals need ' + K.meet.coldAdd + ' more mood.' });
  }

  // called by 05_money.step after revenue resolves; pushes its memo lines into report.memo (05_money puts them after its
  // own). Order (V0.4 §4): sector swing → mood → asks → meetings at ends → churn → the board → new asks → meeting warnings.
  // An ask met this week pays report.flows.accounts.bonus (05_money adds it to this week's revenue).
  A.step = function (s, alloc, rng, report) {
    if (!s.accounts) A.init(s);
    const st = s.accounts, T = s.turn, M = K.mood, L = lines(report), Q = K.ask;
    report.flows.accounts.bonus = 0;
    if (!st.unlocked) {
      if (avg(s) >= K.unlockCap && trust(s) >= K.unlockTrust) {
        st.unlocked = true; deal(s, rng, T + 1, report);
        if (!st.sectors) st.sectors = blankSectors();
        st.sectors.nextAt = T + K.sector.every;
        L.push({ p: 0, kind: 'good', text: 'Enterprise buyers are asking for meetings. First account offers on the Serving floor.' });
      }
      report.flows.accounts.active = 0;
      return auto(report);
    }
    // accounts marked leaving before this week leave at the churn stage, whatever happens in between
    const gone = st.active.filter(a => out(s, a));
    swings(s, rng, L, report);
    // service and mood, contracts whose fee has started
    const served = {}; A.serve(s, alloc && alloc.serving ? alloc.serving.pf : 0).forEach(x => { served[x.id] = x.served; });
    const step = inStep(s), penalty = M.unserved * (A.ready(s) ? K.readyShare : 1), S = K.sector;
    let unserved = 0;
    st.active.forEach(a => {
      if (!(a.id in served)) return;
      a.served = FR.round(served[a.id], 1); a.field = FR.round(a.served * K.field.rate, 2);
      const pf = A.pfOf(s, a), short = pf - served[a.id], sw = A.swing(s, a.sector), top = sw === 'hot' ? S.hotTop : M.top;
      a.pfLast = FR.round(pf, 1);   // the PF it was due this week (a running peak ask included), for the UI's short-week check
      if (short > 0.05) {
        unserved += short;
        drop(s, a, penalty, 'after weeks of unserved capacity (' + a.served + ' of ' + pf + ' PF this week)', L,
          () => a.name + ' mood ' + Math.floor(a.mood) + ': ' + a.served + ' of ' + pf + ' reserved PF served this week. Raise Serving or rent PF; below ' + M.churn + ' the account leaves.');
      } else {
        if (step && a.mood !== top) a.mood = a.mood < top ? Math.min(top, a.mood + M.up) : Math.max(top, a.mood - M.up);
        if (sw === 'hot' && a.mood < top) a.mood = Math.min(top, a.mood + S.hotMood);
      }
      if (sw === 'cold' && !step) drop(s, a, S.coldMood, 'in a cold sector with safety out of step', L);
    });
    // asks: met, missed, a cost ask accepted by silence
    let bonus = 0;
    st.active.forEach(a => {
      const q = a.ask; if (!q || out(s, a) || !(a.id in served) || T <= q.arrived) return;
      if (q.type === 'cost') {
        if (T >= q.declineBy) {
          const was = a.feePerWeek; applyCut(s, a);
          L.push({ p: 2, kind: 'change', short: a.name + ' fee cut applied (' + money(a.feePerWeek) + ' a week)', text: a.name + ' fee cut applied, unanswered: ' + money(was) + ' to ' + money(a.feePerWeek) + ' a week through ' + FR.dateLabel(a.ends) + '. Mood ' + Math.floor(a.mood) + '.' });
        }
        return;
      }
      let met = false, miss = '';
      if (q.type === 'cap') {
        q.progress = FR.round(s.model.skills[q.skill].cap, 1);
        if (s.model.skills[q.skill].cap >= q.target) met = true; else if (T >= q.due) miss = FR.SKILL_NAME[q.skill] + ' capability ' + q.progress + ' against ' + q.target;
      } else if (q.type === 'inStep') {
        q.progress = worstGap(s) <= q.target ? q.progress + 1 : 0;
        if (q.progress >= q.weeks) met = true;
        else if (q.progress + (q.due - T) < q.weeks) miss = 'the widest gap is ' + n1(worstGap(s)) + ', over ' + q.target;
      } else if (q.type === 'peak') {
        if (T >= q.from && T <= q.due) {
          if (served[a.id] < A.pfOf(s, a) - 0.05) miss = n1(served[a.id]) + ' of ' + A.pfOf(s, a) + ' PF served this week';
          else q.progress++;
        }
        if (!miss && T >= q.due) met = true;
      } else if (q.type === 'clean') {
        // met the week after due: that week's ladder has rolled, so the promise covers the due week itself
        q.progress = Math.min(q.weeks, T - q.arrived);
        if (T > q.due) met = true;
      }
      if (met) {
        const pay = Math.round(q.reward * factor(s)); bonus += pay;
        a.mood = FR.clamp(a.mood + Q.metMood, 0, 100); a.ask = null;
        report.events.push({ type: 'account:askMet', id: a.id, name: a.name, bonus: pay });
        L.push({ p: 2, kind: 'good', short: a.name + ' ask met, bonus ' + money(pay) + ' paid', text: a.name + ' ask met: ' + metWhat(s, q) + '. Bonus ' + money(pay) + ' paid this week; mood ' + Math.floor(a.mood) + '.' });
      } else if (miss) missAsk(s, a, miss, L, report);
    });
    report.flows.accounts.bonus = bonus;
    // contracts that reached their last week: the renewal meeting decides
    st.active.slice().forEach(a => { if (a.ends <= T && !out(s, a) && st.active.indexOf(a) >= 0) resolve(s, a, rng, L, report); });
    // churn: an account marked leaving (below the line before this week) leaves now, gone for the run. One line for all.
    const left = gone.filter(a => st.active.indexOf(a) >= 0);
    if (left.length) {
      let t = 0;
      left.forEach(a => {
        lose(s, a, 'churn', report);
        t += -nudge(s, -K.churnTrust, a.name + ' churned', report);
        report.news.push({ kind: 'you', text: a.name + ' ends its contract with ' + s.lab.name + ' citing reliability concerns.' });
      });
      const one = left.length === 1;
      L.push({ p: 0, kind: 'flag', text: list(left.map(a => a.name)) + (one ? ' has ended its contract' : ' have ended their contracts') + ', citing reliability concerns. ' +
        money(sum(left, a => a.feePerWeek)) + ' a week and ' + sum(left, a => a.pfPerWeek) + ' reserved PF released. Public trust down ' + n1(t) + '.' });
    }
    // contracts whose fee starts this week share one line; a short first week is a flag, not good news
    const golive = st.active.filter(a => a.starts === T && !out(s, a));
    if (golive.length) {
      const pf = sum(golive, a => a.pfPerWeek), got = sum(golive, a => Math.min(a.pfPerWeek, served[a.id] || 0)), one = golive.length === 1;
      const head = list(golive.map(a => a.name)) + (one ? ' contract live' : ' contracts live');
      L.push(got < pf - 0.05
        ? { p: 4, kind: 'flag', text: head + ' but short: ' + n1(got) + ' of ' + pf + ' reserved PF served this week; fees are paid in proportion. Raise Serving or rent PF.' }
        : { p: 4, kind: 'good', text: head + ': ' + pf + ' PF reserved, ' + money(sum(golive, a => a.feePerWeek)) + ' a week' + (one ? ' through ' + FR.dateLabel(golive[0].ends) : '') + '.' });
    }
    // the offer board (no line while the book is full: nothing on it could be signed)
    if (T + 1 >= st.refreshAt) {
      const n = deal(s, rng, T + 1, report), room = A.maxActive(s) - st.active.length;
      if (n && room > 0) L.push({ p: 5, kind: 'change', short: 'account board: ' + n + (n === 1 ? ' offer' : ' offers'), text: 'Account board: ' + n + (n === 1 ? ' offer' : ' offers') + ' on the Serving floor until ' + FR.dateLabel(st.refreshAt - 1) + '.' });
      else if (!n) L.push({ p: 5, kind: 'change', text: 'Account board: no new buyers this round. Every name is in the book, resting after a decline or expiry, in a cold sector, or gone. Next board ' + FR.dateLabel(st.refreshAt) + '.' });
    }
    // new asks: every 13 weeks of a live contract from 13 weeks after go-live; at most K.ask.maxOpen open across the book
    st.active.forEach(a => {
      const age = T - a.starts;
      if (a.ask || out(s, a) || a.starts > T || age < Q.after || age % Q.every || a.ends - T <= Q.quiet) return;
      if (A.asks(s).length >= Q.maxOpen || !rng.chance(Q.chance)) return;
      const q = makeAsk(s, a, rng); if (!q) return;
      a.ask = q;
      report.events.push({ type: 'account:ask', id: a.id, name: a.name, ask: q.type });   // ask = the ask's type (type is the event's)
      L.push({ p: 2, kind: 'due', short: a.name + ' put an ask to the lab (Serving floor)', text: askText(s, a) });
    });
    // renewal meetings: open K.dueWarn weeks out; the memo warns at 8, 4 and 1 weeks left
    st.active.forEach(a => {
      if (out(s, a) || a.starts > T) return;
      const w = a.ends - T;
      if (!a.meeting && w <= K.dueWarn && w > 0) {
        a.meeting = { opens: T, answer: null };
        report.events.push({ type: 'account:meeting', id: a.id, name: a.name, ends: a.ends });
      }
      if (a.meeting && K.meet.warnAt.indexOf(w) >= 0) L.push({ p: 1, kind: 'due', short: a.name + ' renewal meeting, ' + wk(w) + ' left', text: () => meetLine(s, a, w) });
    });
    Object.assign(report.flows.accounts, { active: st.active.length, contracted: Math.round(A.contracted(s)), unservedPF: FR.round(unserved, 1),
      reservedPF: FR.round(A.reservedPF(s), 1), field: A.fieldPF(s) });
    auto(report);
  };
  function metWhat(s, q) {
    if (q.type === 'cap') return FR.SKILL_NAME[q.skill] + ' capability ' + n1(s.model.skills[q.skill].cap) + ' against ' + q.target;
    if (q.type === 'inStep') return wk(q.weeks) + ' with every gap within ' + q.target;
    if (q.type === 'peak') return q.target + ' more PF served for ' + wk(q.weeks);
    return 'no incident through ' + FR.dateLabel(q.due);
  }
  function missAsk(s, a, why, L, report) {
    a.ask = null;
    report.events.push({ type: 'account:askMissed', id: a.id, name: a.name });
    const was = a.mood; a.mood = FR.clamp(a.mood - K.ask.missMood, 0, 100);
    const leaving = a.mood < K.mood.churn && was >= K.mood.churn; if (leaving) a.leaving = true;
    L.push({ p: leaving ? 0 : 2, kind: 'flag', short: a.name + ' ask missed, mood ' + Math.floor(a.mood), text: a.name + ' ask missed: ' + why + '. Mood down ' + K.ask.missMood + ' to ' + Math.floor(a.mood) + '.' +
      (leaving ? ' Below ' + K.mood.churn + ', the account ends its contract next week.' : '') });
  }
  function meetLine(s, a, w) {
    if (out(s, a)) return '';   // a shock this week took it below the churn line: its leaving line says so
    const v = A.meetingView(s, a);
    const head = a.name + ' contract ends ' + FR.dateLabel(a.ends) + '. Mood ' + Math.floor(a.mood) + '. ';
    if (!v) return head;
    if (!v.answer) return head + (w === K.dueWarn ? 'Renewal meeting open: Renew, Push up or Let go on the Serving floor. ' + v.unanswered : 'No answer yet: it ' + v.stands + '.');
    return head + 'Renewal meeting: ' + v.text;
  }

  // after the ladder (02_sim): this week's incidents move every account's mood. A lab incident −25, a rival incident −10,
  // halved (K.mood.rivalShield) when every skill's safety is within 5 of capability (owner call V0.3, like the trust shield).
  // A lab incident also fails every open 'clean' ask (V0.4).
  A.shock = function (s, report) {
    const st = s.accounts; if (!st || !st.active.length || s.status !== 'playing') return auto(report);
    const lab = report.events.filter(e => e.type === 'model:incident'), rival = report.events.filter(e => e.type === 'market:rivalIncident');
    const inStep = FR.sim && FR.sim.inStep ? FR.sim.inStep(s) : false;
    const hit = K.mood.incident * lab.length + K.mood.rival * (inStep ? K.mood.rivalShield : 1) * rival.length; if (!hit) return auto(report);
    const leaving = [];
    st.active.forEach(a => { const was = a.mood; a.mood = FR.clamp(a.mood - hit, 0, 100); if (a.mood < K.mood.churn && was >= K.mood.churn) { a.leaving = true; leaving.push(a.name); } });
    const rivals = rival.map(e => { const r = s.market && s.market.rivals.find(x => x.id === e.rivalId); return r ? r.name : 'a rival'; });
    const what = lab.length ? 'the ' + list(lab.map(e => FR.SKILL_NAME[e.skill])) + (lab.length === 1 ? ' incident' : ' incidents') +
      (rival.length ? ' and ' + (rival.length === 1 ? 'a rival incident' : rival.length + ' rival incidents') : '')
      : (rival.length === 1 ? 'the ' + rivals[0] + ' incident' : 'incidents at ' + list(rivals));
    // up to 3 accounts by name; a bigger book as its average (the leaving names are listed anyway)
    const act = st.active, moods = act.length <= 3 ? act.map(a => a.name + ' ' + Math.floor(a.mood)).join(', ')
      : 'average ' + Math.round(sum(act, a => a.mood) / act.length) + ' across ' + act.length + ' accounts';
    const L = lines(report);
    L.push({ p: leaving.length ? 0 : 4, kind: leaving.length ? 'flag' : 'change', text: 'Account mood down ' + hit + ' after ' + what + ': ' +
      moods + '.' + (leaving.length ? ' Below ' + K.mood.churn + ', ' + list(leaving) + (leaving.length === 1 ? ' ends its contract' : ' end their contracts') + ' next week.' : '') });
    if (lab.length) act.forEach(a => { if (a.ask && a.ask.type === 'clean' && !a.leaving) missAsk(s, a, 'a lab incident ' + FR.dateLabel(s.turn), L, report); });
    auto(report);
  };

  A.debug = function (s) {
    const st = s.accounts || blank(), act = st.active;
    return { active: act.length, contracted: Math.round(A.contracted(s)), avgMood: act.length ? FR.round(sum(act, a => a.mood) / act.length, 1) : null,
      unservedPF: FR.round(sum(act.filter(a => a.starts < s.turn && !out(s, a)), a => Math.max(0, a.pfPerWeek - (a.served || 0))), 1), lost: st.lost.length,
      leaving: act.filter(a => out(s, a)).length, cooling: cooling(st, s.turn).length,
      offers: st.offers.length, unlocked: st.unlocked, reservedPF: A.reservedPF(s), backlog: Math.round(A.backlog(s)), maxActive: A.maxActive(s),
      field: A.fieldPF(s), asksOpen: A.asks(s).length, meetingsOpen: A.meetings(s).length, sectors: A.sectorStrip(s) };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

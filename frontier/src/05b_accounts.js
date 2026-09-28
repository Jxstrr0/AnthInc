// Enterprise accounts (V0.3): named buyers sign multi-year contracts that reserve serving PF and pay a fixed weekly fee on
// top of open-market revenue. Mood rises with safe, fully served weeks and falls on unserved PF and incidents; an account
// below the churn line leaves the next week and never returns. 05_money owns the state block (s.accounts) and calls
// step() after revenue resolves; 02_sim calls shock() after the ladder. Pure: randomness only from the rng passed in.
(function (FR) {
  const A = FR.accounts = {};
  const K = A.K = {
    unlockCap: 20, unlockTrust: 45,          // the first offers arrive once average capability and public trust reach these
    refreshTurns: 8, board: [1, 3],          // the offer board refreshes every 8 weeks with 1..3 offers
    maxActive: 4, maxActiveB: 6,             // live accounts at once; 6 once the Series B has closed
    turns: [52, 104, 156],                   // contract length by tier
    feeBase: 60000, feeYear: 0.1,            // fee a week = tier × feeBase × (1 + feeYear × year)
    pf: [[8, 14], [16, 26], [28, 42]],       // reserved PF a week by tier
    minCap: [20, 30, 40],                    // requirements by tier: average capability,
    minSafe: [10, 7, 5],                     //   every skill's safety within this of its capability,
    minTrust: [45, 50, 55],                  //   public trust
    reach: 5,                                // a tier is dealt once average capability is within this of its minCap
    signCost: 150000, signWeeks: 2,          // onboarding $ × tier at signing; the fee starts 2 weeks later
    signTrust: [1, 1, 2],                    // public trust on signing, by tier
    mood: { start: 70, top: 80, up: 1, unserved: 3, incident: 25, rival: 10, churn: 30, renew: 60, watch: 45 },
    readyShare: 0.5,                         // Enterprise readiness work: the unserved-PF penalty × this while it runs
    churnTrust: 2,                           // public trust lost when an account churns
    dueWarn: 8,                              // memo when a contract has this many weeks left
    memoMax: 2, lostKeep: 10,                // account memo lines a week (after the money lines); lost accounts kept
    // fictional buyers, straight tone. A name signed, declined or lost is never dealt again in the run.
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

  const money = FR.fmtMoney, no = (why) => ({ ok: false, why }), sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const avg = (s) => s.model ? FR.sim.avgCap(s) : 0;
  const trust = (s) => s.market ? s.market.trust : 50;
  const wk = (n) => n + (n === 1 ? ' week' : ' weeks');
  const list = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const n1 = (v) => String(FR.round(v, 1));
  const worstGap = (s) => s.model ? Math.max.apply(null, FR.SKILLS.map(k => Math.max(0, s.model.skills[k].cap - s.model.skills[k].safe))) : 0;
  const inStep = (s) => FR.sim && FR.sim.inStep ? FR.sim.inStep(s) : worstGap(s) <= 5;
  const blank = () => ({ active: [], offers: [], refreshAt: 0, unlocked: false, lost: [], used: [], boost: 0, readyUntil: 0 });
  function nudge(s, d, why, report) {
    if (!s.market) return 0;
    if (FR.market && FR.market.nudgeTrust) return FR.market.nudgeTrust(s, d, why, report || { flows: {} });
    const was = s.market.trust; s.market.trust = FR.clamp(was + d, 0, 100); return s.market.trust - was;
  }

  // ---- reads ----
  A.fee = (tier, turn) => Math.round(tier * K.feeBase * (1 + K.feeYear * FR.year(turn)) / 1000) * 1000;
  A.maxActive = (s) => s.money && s.money.roundsDone.indexOf('b') >= 0 ? K.maxActiveB : K.maxActive;
  A.live = (s) => (s.accounts ? s.accounts.active : []).filter(a => a.starts <= s.turn);   // fee started: PF reserved
  A.reservedPF = (s) => sum(A.live(s), a => a.pfPerWeek);
  A.pending = (s) => sum((s.accounts ? s.accounts.active : []).filter(a => a.starts > s.turn), a => a.pfPerWeek);   // signed, onboarding
  // PF each live account gets from `servingPF`, oldest contract first
  A.serve = function (s, servingPF) {
    let left = Math.max(0, servingPF == null ? Infinity : +servingPF || 0);
    return A.live(s).map(a => { const got = Math.min(a.pfPerWeek, left); left -= got; return { id: a.id, pf: a.pfPerWeek, served: got }; });
  };
  const factor = (s) => (FR.money && FR.money.incidentFactor ? FR.money.incidentFactor(s) : 1) *
    Math.max(0, 1 - (FR.compute && FR.compute.revShare && s.compute ? FR.compute.revShare(s) : 0));
  // fees this week: each live account pays in proportion to the PF it was served; × the incident factor and the
  // DeepField share (contracts are locked: no Zeta drag). servedPF omitted = every contract served in full.
  A.feeRevenue = function (s, servedPF) {
    if (!s.accounts) return 0;
    const byId = {}; A.live(s).forEach(a => { byId[a.id] = a; });
    const gross = sum(A.serve(s, servedPF == null ? A.reservedPF(s) : servedPF), x => x.pf > 0 ? byId[x.id].feePerWeek * x.served / x.pf : 0);
    return gross * factor(s);
  };
  A.contracted = (s) => sum(A.live(s), a => a.feePerWeek);           // $ a week the live book pays in full
  A.backlog = (s) => s.accounts ? sum(s.accounts.active, a => a.feePerWeek * Math.max(0, a.ends - Math.max(s.turn, a.starts) + 1)) : 0;
  A.ready = (s) => !!(s.accounts && s.accounts.readyUntil >= s.turn);
  A.qualifies = function (s, o) {
    const c = avg(s), g = worstGap(s), t = trust(s);
    if (c < o.minCap) return no('Needs average capability ' + o.minCap + '; the lab is at ' + n1(c));
    if (g > o.minSafe) return no('Needs every skill\'s safety within ' + o.minSafe + ' of capability; the widest gap is ' + n1(g));
    if (t < o.minTrust) return no('Needs public trust ' + o.minTrust + '; trust is ' + Math.floor(t));
    return { ok: true, why: '' };
  };

  // ---- the board ----
  function tierFor(s, rng) {
    const c = avg(s), ok = [1, 2, 3].filter(t => c >= K.minCap[t - 1] - K.reach);
    const top = ok.length ? ok[ok.length - 1] : 1;
    let tier = top > 1 && rng() < 1 / 3 ? rng.int(1, top - 1) : top;   // mostly the highest tier in reach
    if (s.accounts.boost > 0) { s.accounts.boost--; tier = Math.min(3, tier + 1); }
    return tier;
  }
  function deal(s, rng, from, report) {
    const st = s.accounts, taken = st.used.concat(st.active.map(a => a.name));
    const pool = K.NAMES.filter(n => taken.indexOf(n[0]) < 0);
    st.offers = []; st.refreshAt = from + K.refreshTurns;
    const n = Math.min(pool.length, rng.int(K.board[0], K.board[1]));
    for (let i = 0; i < n; i++) {
      const nm = pool.splice(rng.int(0, pool.length - 1), 1)[0], tier = tierFor(s, rng), r = K.pf[tier - 1];
      st.offers.push({ id: 'a' + from + String.fromCharCode(97 + i), name: nm[0], sector: nm[1], tier, pfPerWeek: rng.int(r[0], r[1]),
        feePerWeek: A.fee(tier, from), turns: K.turns[tier - 1], minCap: K.minCap[tier - 1], minSafe: K.minSafe[tier - 1],
        minTrust: K.minTrust[tier - 1], expires: st.refreshAt - 1 });
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
    s.money.cash -= cost; st.offers.splice(i, 1); st.used.push(o.name);
    const starts = s.turn + K.signWeeks, a = { id: o.id, name: o.name, sector: o.sector, tier: o.tier, pfPerWeek: o.pfPerWeek, feePerWeek: o.feePerWeek,
      ends: starts + o.turns - 1, signed: s.turn, starts, mood: K.mood.start, served: 0 };
    st.active.push(a);
    const t = nudge(s, K.signTrust[o.tier - 1], o.name + ' signed');
    return { ok: true, from: 'accounts', event: { type: 'account:signed', id: a.id, name: a.name, tier: a.tier },
      memo: { kind: 'good', text: 'Signed ' + a.name + ' (' + a.sector + ', tier ' + a.tier + '): ' + a.pfPerWeek + ' PF reserved and ' + money(a.feePerWeek) +
        ' a week from ' + FR.dateLabel(starts) + ' for ' + wk(o.turns) + '. Onboarding ' + money(cost) + '. Public trust up ' + n1(t) + '.' } };
  };
  A.decline = function (s, id) {
    const st = s.accounts; if (!st) return no('No account offers yet');
    const i = st.offers.findIndex(o => o.id === id), o = st.offers[i];
    if (!o) return no('That account offer is no longer on the board');
    st.offers.splice(i, 1); st.used.push(o.name);
    return { ok: true, from: 'accounts', memo: { kind: 'change', text: 'Declined ' + o.name + ': ' + o.pfPerWeek + ' PF for ' + money(o.feePerWeek) + ' a week over ' + wk(o.turns) + '.' } };
  };

  // ---- effects from projects (07_projects: Enterprise readiness work, Reference customer program) ----
  A.lift = function (s, mood, weeks) {
    const st = s.accounts; if (!st) return;
    st.active.forEach(a => { a.mood = FR.clamp(a.mood + mood, 0, 100); });
    st.readyUntil = Math.max(st.readyUntil || 0, s.turn + weeks - 1);
  };
  A.refer = function (s, n) { if (s.accounts) s.accounts.boost = (s.accounts.boost || 0) + n; };

  // ---- the week ----
  A.init = function (s) { s.accounts = blank(); };
  // report lines: at most K.memoMax a week, the most urgent first (lower p)
  function lines(report) { const f = report.flows.accounts || (report.flows.accounts = {}); return f.lines || (f.lines = []); }
  function flush(report, target) {
    const L = lines(report), f = report.flows.accounts, room = K.memoMax - (f.said || 0);
    const out = L.sort((a, b) => a.p - b.p).slice(0, Math.max(0, room));
    f.said = (f.said || 0) + out.length; f.lines = [];
    out.forEach(l => target.push({ kind: l.kind, text: l.text }));
  }
  function lose(s, a, why, report) {
    const st = s.accounts;
    st.active = st.active.filter(x => x !== a);
    if (st.used.indexOf(a.name) < 0) st.used.push(a.name);
    st.lost.push({ name: a.name, turn: s.turn, why });
    if (st.lost.length > K.lostKeep) st.lost.splice(0, st.lost.length - K.lostKeep);
    report.events.push({ type: 'account:churned', id: a.id, name: a.name, why });
  }
  const moodLine = (s, a, why) => ({ p: 1, kind: 'flag', text: a.name + ' mood ' + Math.round(a.mood) + ' ' + why + '. The account ends its contract next week.' });

  // called by 05_money.step after revenue resolves; pushes its memo lines into report.memo (05_money puts them after its own)
  A.step = function (s, alloc, rng, report) {
    if (!s.accounts) A.init(s);
    const st = s.accounts, T = s.turn, M = K.mood, L = lines(report);
    if (!st.unlocked) {
      if (avg(s) >= K.unlockCap && trust(s) >= K.unlockTrust) {
        st.unlocked = true; deal(s, rng, T + 1, report);
        L.push({ p: 0, kind: 'good', text: 'Enterprise buyers are asking for meetings. First account offers on the Serving floor.' });
      }
      report.flows.accounts.active = 0;
      return flush(report, report.memo);
    }
    // churn: an account below the line last week leaves now, gone for the run. One memo line for all that leave this week.
    const gone = st.active.filter(a => a.mood < M.churn);
    if (gone.length) {
      let t = 0;
      gone.forEach(a => {
        lose(s, a, 'churn', report);
        t += -nudge(s, -K.churnTrust, a.name + ' churned', report);
        report.news.push({ kind: 'you', text: a.name + ' ends its contract with ' + s.lab.name + ' citing reliability concerns.' });
      });
      const one = gone.length === 1;
      L.push({ p: 0, kind: 'flag', text: list(gone.map(a => a.name)) + (one ? ' has ended its contract' : ' have ended their contracts') + ', citing reliability concerns. ' +
        money(sum(gone, a => a.feePerWeek)) + ' a week and ' + sum(gone, a => a.pfPerWeek) + ' reserved PF released. Public trust down ' + n1(t) + '.' });
    }
    // service and mood, contracts whose fee has started
    const served = {}; A.serve(s, alloc && alloc.serving ? alloc.serving.pf : 0).forEach(x => { served[x.id] = x.served; });
    const step = inStep(s), penalty = M.unserved * (A.ready(s) ? K.readyShare : 1);
    let unserved = 0;
    st.active.forEach(a => {
      if (!(a.id in served)) return;
      a.served = FR.round(served[a.id], 1);
      const short = a.pfPerWeek - served[a.id], was = a.mood;
      if (short > 0.05) {
        unserved += short; a.mood = FR.clamp(a.mood - penalty, 0, 100);
        if (a.mood < M.churn && was >= M.churn) L.push(moodLine(s, a, 'after weeks of unserved capacity (' + a.served + ' of ' + a.pfPerWeek + ' PF this week)'));
        else if (a.mood < M.watch && was >= M.watch) L.push({ p: 2, kind: 'flag', text: a.name + ' mood ' + Math.round(a.mood) + ': ' + a.served + ' of ' + a.pfPerWeek +
          ' reserved PF served this week. Raise Serving or rent PF; below ' + M.churn + ' the account leaves.' });
      } else if (step && a.mood !== M.top) a.mood = a.mood < M.top ? Math.min(M.top, a.mood + M.up) : Math.max(M.top, a.mood - M.up);
    });
    // contracts that reached their last week: renew one tier up when mood holds, otherwise leave quietly
    st.active.slice().forEach(a => {
      if (a.ends !== T) return;
      if (a.mood >= M.renew) {
        const tier = Math.min(3, a.tier + 1), was = a.feePerWeek;
        a.tier = tier; a.feePerWeek = A.fee(tier, T + 1); a.ends = T + K.turns[tier - 1];
        L.push({ p: 1, kind: 'good', text: a.name + ' renews for ' + wk(K.turns[tier - 1]) + ' at ' + money(a.feePerWeek) + ' a week, up from ' + money(was) +
          ', through ' + FR.dateLabel(a.ends) + '. Mood ' + Math.round(a.mood) + '.' });
      } else {
        lose(s, a, 'expired', report);
        L.push({ p: 2, kind: 'change', text: a.name + ' contract ended without renewal (mood ' + Math.round(a.mood) + ', renewal needs ' + M.renew + '). ' +
          a.pfPerWeek + ' PF released.' });
      }
    });
    st.active.forEach(a => {
      if (a.starts === T) L.push({ p: 3, kind: 'good', text: a.name + ' contract live: ' + a.pfPerWeek + ' PF reserved, ' + money(a.feePerWeek) + ' a week through ' + FR.dateLabel(a.ends) + '.' });
      if (a.ends - T === K.dueWarn) L.push({ p: 3, kind: 'due', text: a.name + ' contract ends ' + FR.dateLabel(a.ends) + '. Mood ' + Math.round(a.mood) +
        (a.mood >= M.renew ? '; it renews at ' + money(A.fee(Math.min(3, a.tier + 1), a.ends + 1)) + ' a week if mood holds at ' + M.renew + ' or above.' : '; renewal needs ' + M.renew + '.') });
    });
    // the offer board
    if (T + 1 >= st.refreshAt) {
      const n = deal(s, rng, T + 1, report);
      if (n) L.push({ p: 4, kind: 'change', text: 'Account board: ' + n + (n === 1 ? ' offer' : ' offers') + ' on the Serving floor until ' + FR.dateLabel(st.refreshAt - 1) + '.' });
    }
    Object.assign(report.flows.accounts, { active: st.active.length, contracted: Math.round(A.contracted(s)), unservedPF: FR.round(unserved, 1),
      reservedPF: FR.round(A.reservedPF(s), 1) });
    flush(report, report.memo);
  };

  // after the ladder (02_sim): this week's incidents move every account's mood. A lab incident −25, a rival incident −10.
  A.shock = function (s, report) {
    const st = s.accounts; if (!st || !st.active.length || s.status !== 'playing') return;
    const lab = report.events.filter(e => e.type === 'model:incident'), rival = report.events.filter(e => e.type === 'market:rivalIncident');
    const hit = K.mood.incident * lab.length + K.mood.rival * rival.length; if (!hit) return;
    const leaving = [];
    st.active.forEach(a => { const was = a.mood; a.mood = FR.clamp(a.mood - hit, 0, 100); if (a.mood < K.mood.churn && was >= K.mood.churn) leaving.push(a.name); });
    const rivals = rival.map(e => { const r = s.market && s.market.rivals.find(x => x.id === e.rivalId); return r ? r.name : 'a rival'; });
    const what = lab.length ? 'the ' + list(lab.map(e => FR.SKILL_NAME[e.skill])) + (lab.length === 1 ? ' incident' : ' incidents') +
      (rival.length ? ' and ' + (rival.length === 1 ? 'a rival incident' : rival.length + ' rival incidents') : '')
      : (rival.length === 1 ? 'the ' + rivals[0] + ' incident' : 'incidents at ' + list(rivals));
    lines(report).push({ p: leaving.length ? 0 : 3, kind: leaving.length ? 'flag' : 'change', text: 'Account mood down ' + hit + ' after ' + what + ': ' +
      st.active.map(a => a.name + ' ' + Math.round(a.mood)).join(', ') + '.' + (leaving.length ? ' Below ' + K.mood.churn + ', ' + list(leaving) +
      (leaving.length === 1 ? ' ends its' : ' end their') + ' contract next week.' : '') });
    flush(report, report.memo);
  };

  A.debug = function (s) {
    const st = s.accounts || blank(), act = st.active;
    return { active: act.length, contracted: Math.round(A.contracted(s)), avgMood: act.length ? FR.round(sum(act, a => a.mood) / act.length, 1) : null,
      unservedPF: FR.round(sum(act.filter(a => a.starts < s.turn), a => Math.max(0, a.pfPerWeek - (a.served || 0))), 1), lost: st.lost.length,
      offers: st.offers.length, unlocked: st.unlocked, reservedPF: A.reservedPF(s), backlog: Math.round(A.backlog(s)), maxActive: A.maxActive(s) };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

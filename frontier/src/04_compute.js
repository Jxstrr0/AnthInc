// Compute: rented capacity at a drifting spot price with scarcity shocks, bought clusters that install, age and retire,
// and rival compute-share deals paid for with a cut of revenue (05_money applies revShare). Pure: randomness from rng only.
(function (FR) {
  const C = FR.compute = {};
  const K = C.K = {
    startRent: 20, maxRent: 500,              // PF rented at the start; the most the spot market will rent you
    basePrice: 2000,                          // $ per PF-week the spot price reverts to
    priceVol: 0.02, priceRevert: 0.1,         // weekly noise (fraction of base); pull back toward base per week
    priceMin: 0.75, priceMax: 1.9,            // spot price bounds, multiples of base
    scarcityChance: 0.025,                    // per week while no shock is running (about 1 a year)
    scarcityCalm: 1.1,                        // a new shock starts only once spot is back within 10% of base
    scarcityLift: [0.25, 0.40], scarcityTurns: [6, 10],
    quarter: 13,                              // cluster offers refresh every 13 turns
    offers: [2, 3],                           // offers per quarter (one per size tier)
    tiers: [
      { pf: [16, 32], mult: 1.08, install: [3, 5] },
      { pf: [40, 80], mult: 1.00, install: [5, 8] },
      { pf: [100, 200], mult: 0.93, install: [8, 12] }
    ],
    sizeGrowth: 0.2,                          // offer sizes grow 20% per year of game time
    buyPerPF: 130000, costJitter: 0.08,       // $ per PF upfront × tier mult × jitter × (spot / base)
    decayPerYear: 0.08,                       // capacity lost per year of age, linear
    power: 400, powerRise: 0.15,              // $ per nominal PF-week at age 0; +15% per year of age
    retireTurns: 208, retireWarn: 4, dealWarn: 2,
    sites: ['Salina', 'Hays', 'Kearney', 'Abilene', 'Pueblo', 'Laramie', 'Casper', 'Minot', 'Enid', 'Amarillo',
      'Dodge City', 'Garden City', 'Scottsbluff', 'Pierre', 'Guymon', 'Lubbock']
  };

  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const fac = (a) => Math.max(0, 1 - K.decayPerYear * a / 52);          // capacity factor at age a (weeks)
  const pwr = (a) => K.power * (1 + K.powerRise * a / 52);               // power $ per nominal PF-week at age a
  const age = (t, c) => Math.max(0, t - c.bought);
  const money = FR.fmtMoney, pct = (f) => FR.fmtPct(f);
  const no = (why) => ({ ok: false, why });
  function rivalName(s, id) {
    const r = s.market && s.market.rivals && s.market.rivals.find(x => x.id === id);
    return r ? r.name : String(id);
  }

  // ---- reads ----
  function capAt(s, t) {
    const c = s.compute, owned = FR.round(sum(c.clusters, x => x.pf * fac(age(t, x))), 1);
    const rented = c.rentPF, deals = sum(c.deals, d => d.pf);
    return { total: FR.round(owned + rented + deals, 1), owned, rented, deals };
  }
  C.capacity = (s) => capAt(s, s.turn);
  C.rentCost = (s) => s.compute.rentPF * s.compute.rentPrice;
  C.powerCost = (s) => sum(s.compute.clusters, x => x.pf * pwr(age(s.turn, x)));
  C.cost = (s) => Math.round(C.rentCost(s) + C.powerCost(s));
  C.revShare = (s) => sum(s.compute.deals, d => d.revShare);
  // one cluster for the UI: effective PF now, power $/week, age and weeks left
  C.clusterInfo = function (s, x) {
    const a = age(s.turn, x);
    return { pf: FR.round(x.pf * fac(a), 1), factor: FR.round(fac(a), 3), power: Math.round(x.pf * pwr(a)), age: a, retiresIn: x.bought + K.retireTurns - s.turn };
  };
  // weeks from purchase until an offer has saved its price vs renting the same capacity at today's spot price; null = never
  C.payback = function (s, o) {
    const p = s.compute.rentPrice; let acc = -o.cost;
    for (let a = 0; a < K.retireTurns; a++) { acc += o.pf * (fac(a) * p - pwr(a)); if (acc >= 0) return o.installTurns + a + 1; }
    return null;
  };

  // ---- offers ----
  function siteName(s, rng) {
    const c = s.compute, used = new Set([].concat(c.clusters, c.installing, c.offers).map(x => x.name));
    const free = K.sites.filter(n => !used.has(n));
    if (free.length) return rng.pick(free);
    const n = rng.pick(K.sites); let i = 2; while (used.has(n + ' ' + i)) i++;
    return n + ' ' + i;
  }
  function makeOffers(s, rng, turn) {
    const c = s.compute, tiers = K.tiers.slice(), n = rng.int(K.offers[0], K.offers[1]);
    while (tiers.length > n) tiers.splice(rng.int(0, tiers.length - 1), 1);
    const grow = 1 + K.sizeGrowth * (FR.year(turn) - 1), idx = c.rentPrice / K.basePrice;
    c.offers = [];
    tiers.forEach((t, i) => {
      const pf = Math.round(rng.int(t.pf[0], t.pf[1]) * grow);
      const cost = Math.round(pf * K.buyPerPF * t.mult * rng.range(1 - K.costJitter, 1 + K.costJitter) * idx / 1e4) * 1e4;
      c.offers.push({ id: 'cl' + turn + 'abc'[i], name: siteName(s, rng), pf, cost, installTurns: rng.int(t.install[0], t.install[1]) });
    });
  }

  C.init = function (s, rng) {
    s.compute = { rentPF: K.startRent, rentPrice: K.basePrice, scarcity: 0, clusters: [], deals: [], offers: [], installing: [] };
    makeOffers(s, rng, s.turn);
  };

  // ---- commands ----
  C.setRent = function (s, pf) {
    const n = typeof pf === 'string' && /^\s*\d+\s*$/.test(pf) ? +pf : pf;
    if (!Number.isInteger(n) || n < 0 || n > K.maxRent) return no('Rent must be a whole number of PF from 0 to ' + K.maxRent);
    s.compute.rentPF = n; return { ok: true };
  };
  C.buy = function (s, offerId) {
    const c = s.compute, i = c.offers.findIndex(o => o.id === offerId);
    if (i < 0) return no('That cluster is no longer for sale');
    const o = c.offers[i], cash = s.money ? s.money.cash : 0;
    if (cash < o.cost) return no(o.name + ' costs ' + money(o.cost) + ', cash is ' + money(cash));
    s.money.cash -= o.cost; c.offers.splice(i, 1);
    c.installing.push({ id: o.id, name: o.name, pf: o.pf, ready: s.turn + o.installTurns, cost: o.cost });
    return { ok: true };
  };
  C.acceptDeal = function (s) {
    const o = s.market && s.market.dealOffer;
    if (!o) return no('No deal on the table');
    if (o.kind !== 'compute') return no('Only compute-share deals are open');
    if (o.expires != null && s.turn > o.expires) return no('The offer has expired');
    if (s.compute.deals.some(d => d.rivalId === o.rivalId)) return no('A deal with ' + rivalName(s, o.rivalId) + ' is already running');
    s.compute.deals.push({ rivalId: o.rivalId, kind: 'compute', pf: o.pf, revShare: o.revShare, ends: s.turn + o.turns });
    s.market.dealOffer = null; return { ok: true };
  };
  C.endDeal = function (s, rivalId) {
    const i = s.compute.deals.findIndex(d => d.rivalId === rivalId);
    if (i < 0) return no('No running deal with ' + rivalName(s, rivalId));
    s.compute.deals.splice(i, 1); return { ok: true };
  };

  // ---- the turn ----
  function price(s, rng, report) {
    const c = s.compute, base = K.basePrice, was = c.rentPrice, shocked = c.scarcity > 0;
    let p = was + (shocked ? 0 : K.priceRevert * (base - was)) + rng.normal() * K.priceVol * base;
    if (shocked) {
      c.scarcity--;
      c.rentPrice = Math.round(FR.clamp(p, K.priceMin * base, K.priceMax * base));
      if (!c.scarcity) report.news.push({ kind: 'market', text: 'Chip supply eases. Spot compute at ' + money(c.rentPrice) + ' per PF-week, expected to settle near ' + money(base) + '.' });
      return;
    }
    const hit = was <= K.scarcityCalm * base && rng.chance(K.scarcityChance);
    if (hit) { p = was * (1 + rng.range(K.scarcityLift[0], K.scarcityLift[1])); c.scarcity = rng.int(K.scarcityTurns[0], K.scarcityTurns[1]); }
    c.rentPrice = Math.round(FR.clamp(p, K.priceMin * base, K.priceMax * base));
    if (!hit) return;
    const up = Math.round((c.rentPrice / was - 1) * 100);
    report.events.push({ type: 'compute:scarcity', turns: c.scarcity });
    report.news.push({ kind: 'market', text: 'Chip shortage: spot compute up ' + up + '% to ' + money(c.rentPrice) + ' per PF-week. Supply tight for about ' + c.scarcity + ' weeks.' });
    if (c.rentPF > 0) report.memo.push({ kind: 'flag', text: 'Rent price up ' + up + '% to ' + money(c.rentPrice) + ' per PF-week for about ' + c.scarcity + ' weeks. Rented ' + c.rentPF + ' PF now costs ' + money(C.rentCost(s)) + ' a week.' });
  }

  function installs(s, next, report) {
    const c = s.compute;
    c.installing = c.installing.filter(x => {
      if (x.ready > next) return true;
      c.clusters.push({ id: x.id, name: x.name, pf: x.pf, bought: next, cost: x.cost });
      report.events.push({ type: 'compute:installed', id: x.id, pf: x.pf });
      report.memo.push({ kind: 'good', text: x.name + ' cluster online: ' + x.pf + ' PF. Capacity next week ' + Math.round(capAt(s, next).total) + ' PF.' });
      return false;
    });
  }

  function retirements(s, next, report) {
    const c = s.compute, gone = [];
    c.clusters = c.clusters.filter(x => {
      const end = x.bought + K.retireTurns;
      if (end === next + K.retireWarn) report.memo.push({ kind: 'due', text: x.name + ' cluster retires in ' + K.retireWarn + ' weeks: ' + Math.round(x.pf * fac(age(s.turn, x))) + ' PF of capacity.' });
      if (end > next) return true;
      gone.push(x); return false;
    });
    gone.forEach(x => {
      report.events.push({ type: 'compute:retired', id: x.id });
      report.memo.push({ kind: 'change', text: x.name + ' cluster retired at ' + K.retireTurns / 52 + ' years: ' + Math.round(x.pf * fac(age(s.turn, x))) + ' PF off. Capacity next week ' + Math.round(capAt(s, next).total) + ' PF.' });
    });
  }

  function deals(s, next, report) {
    const c = s.compute, gone = [];
    c.deals = c.deals.filter(d => {
      if (d.ends === next + K.dealWarn) report.memo.push({ kind: 'due', text: rivalName(s, d.rivalId) + ' compute share ends in ' + K.dealWarn + ' weeks: ' + d.pf + ' PF will be withdrawn.' });
      if (d.ends > next) return true;
      gone.push(d); return false;
    });
    gone.forEach(d => report.memo.push({ kind: 'change', text: rivalName(s, d.rivalId) + ' compute share ended: ' + d.pf + ' PF withdrawn, ' + pct(d.revShare) + ' revenue share stops. Capacity next week ' + Math.round(capAt(s, next).total) + ' PF.' }));
  }

  C.step = function (s, rng, report) {
    const c = s.compute, next = s.turn + 1;
    price(s, rng, report);
    installs(s, next, report);
    retirements(s, next, report);
    deals(s, next, report);
    if (s.turn % K.quarter === 0) {
      makeOffers(s, rng, next);
      report.memo.push({ kind: 'change', text: 'Cluster offers this quarter: ' + c.offers.map(o => o.name + ' ' + o.pf + ' PF for ' + money(o.cost)).join(', ') + '.' });
    }
    report.flows.compute = { rent: Math.round(C.rentCost(s)), power: Math.round(C.powerCost(s)), price: c.rentPrice, capacity: capAt(s, next).total };
  };

  C.debug = function (s) {
    const c = s.compute, cap = C.capacity(s);
    return { rentPF: c.rentPF, rentPrice: c.rentPrice, scarcity: c.scarcity, total: cap.total, owned: cap.owned, rented: cap.rented,
      deals: cap.deals, cost: C.cost(s), revShare: C.revShare(s), clusters: c.clusters.length, installing: c.installing.length, offers: c.offers.length };
  };
})(typeof window !== 'undefined' ? window.FR : globalThis.FR);

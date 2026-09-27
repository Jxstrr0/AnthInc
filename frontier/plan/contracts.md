# Frontier contracts (binding for every module and agent)

Names here are binding. Grow this file; never rename silently. Numbers marked *first pass* are tuning
constants: they live in each module's `K` object so `tools/balance.js` tuning touches one place per module.

## 0. Ground rules

- Namespace `window.FR` (node: `globalThis.FR`). Every src file is an IIFE:
  `(function (FR) { ... })(typeof window !== 'undefined' ? window.FR : globalThis.FR);`
- **The sim is pure.** Files `02_sim.js`–`07_projects.js` never touch `document`, `window` (beyond the IIFE
  line), `localStorage`, `Date.now()`, `Math.random()`, `performance` or the bus. All randomness comes from the
  `rng` passed in. They run in node.
- **Readers only read.** `08_hq*.js`, `09_ui*.js`, `10_audio.js` read `FR.state` and listen on the bus. They
  change the game only through `FR.cmd.*` (defined in `99_main.js`).
- Every module exposes `debug(state)` returning plain numbers/strings for tests.
- Each sim module keeps its tuning constants in `FR.<module>.K` (a plain object). No magic numbers elsewhere.
- Money is plain dollars (numbers). Compute is **PF** = petaflop-weeks per week of capacity.
- One turn = one week. `state.turn` starts at 1. Year = `FR.year(turn)`.

## 1. State (`FR.state`) — full shape

```
{
  version, seed, rngState,           // rngState: uint32; sim creates FR.rng(state.rngState) per turn, writes it back
  slot,                              // 0..2
  lab: { name },
  turn,                              // 1..
  status: 'playing' | 'won' | 'dead' | 'exited',
  end: null | { turn, cause, text },  // cause: 'cash' | 'final' | 'win' | 'acquired'; skill set when cause==='final'
                                      //   e.g. { turn: 140, cause: 'final', skill: 'agents', text: '...' }
  sliders: { training, serving, safety, research },   // integers, sum exactly 100
  target: 'coding' | 'reasoning' | 'agents',          // the skill the current training run targets

  model: {                           // 03_model owns
    skills: {
      coding:    { cap, safe, warnStreak, critStreak, warned, incidents: [turn...] },
      reasoning: { ... }, agents: { ... }
    },
    peakCap                           // best average cap ever reached
  },

  compute: {                         // 04_compute owns
    rentPF,                          // player-set rented capacity (PF), applied immediately
    rentPrice,                       // $ per PF-week, drifts
    scarcity,                        // turns of scarcity left (price shock), 0 = none
    clusters: [ { id, name, pf, bought, cost } ],        // bought = turn bought; retire at bought + K.retireTurns
    deals: [ { rivalId, kind: 'compute', pf, revShare, ends } ],
    offers: [ { id, name, pf, cost, installTurns } ],    // clusters for sale this quarter
    installing: [ { id, name, pf, ready, cost } ]       // bought, arrives at turn `ready`
  },

  money: {                           // 05_money owns
    cash,
    founderPct,                      // 0..100, the player's ownership; dilutes on each round
    valuation,                       // last computed post-money valuation
    roundsDone: [ 'seed', ... ],
    offer: null | { round, amount, pct, valuation, expires },     // a round on the table
    milestone: null | { round, kind, skill, value, due, text },  // what unlocks `round`; kind: 'cap'|'avgCap'|'revenue'|'trust'
    lockedUntil,                     // turn before which no round is offered (missed milestone), 0 = none
    revenue, burn, net               // last resolved turn, $/week
  },

  staff: { headcount, hiring: [ { n, arrives } ] },   // 05_money owns (payroll lives there)

  research: { points, tier },        // 07_projects owns. tier 1..3, from cumulative points

  projects: {                        // 07_projects owns
    slots,                           // 3 at start
    active: [ { uid, tpl, name, kind, skill, turnsLeft, turns, pfPerTurn, cost, risk, payoff, started, overrun } ],
    offers: [ { id, tpl, name, kind, skill, tier, turns, pfPerTurn, cost, risk, payoff, blurb } ],
    refreshAt,                       // turn the offer board refreshes
    done: [ { name, turn, ok } ]     // last 20
  },

  market: {                          // 06_market owns
    trust,                           // public trust 0..100
    rivals: [ { id, name, style, cap: {coding,reasoning,agents}, safe: {coding,reasoning,agents},
                speed, dealOpen, incidents } ],
    firsts: [ { mark, turn, by } ],  // frontier record: first lab to average cap >= mark; by = 'player' | rivalId
    dealOffer: null | { rivalId, kind, pf, revShare, turns, expires }    // v1: only DeepField's compute share is live
  },

  win: { streak, best },             // consecutive turns safely at the frontier; 52 wins
  news: [ { turn, text, kind } ],    // wire feed, newest last, keep last 60. kind: 'rival'|'you'|'market'|'incident'|'record'
  memo: { turn, lines: [ { kind, text } ] },   // the weekly memo of the turn just resolved. kind: 'change'|'flag'|'due'|'good'
  history: [ { turn, cash, revenue, burn, avgCap, avgSafe, trust, bestRival } ],  // one row per turn, keep last 312
  stats: { incidents, warnings, firstsWon, firstsLost, projectsDone, peakValuation }
}
```

Derived helpers (pure, in `02_sim.js`): `FR.sim.avgCap(state)`, `FR.sim.avgSafe(state)`.

## 2. Module APIs

All `step` functions mutate the (already cloned) state in place and push into `report`.

`report = { turn, events: [ {type, ...} ], memo: [ {kind, text} ], news: [ {text, kind} ], flows: {} }`

### 01_core.js (lead, done)
`FR.on/off/emit`, `FR.rng(seed)` → fn with `.int .range .pick .chance .normal .state()`, `FR.hash`, `FR.clamp`,
`FR.round`, `FR.clone`, `FR.fmtMoney`, `FR.fmtPct`, `FR.SKILLS`, `FR.SKILL_NAME`, `FR.ALLOCS`, `FR.ALLOC_NAME`,
`FR.year(turn)`, `FR.weekOfYear(turn)`, `FR.dateLabel(turn)`,
`FR.save.{write(slot,state), read(slot), clear(slot), info(slot), exportCode(state), importCode(code), useStore(s), SLOTS}`.

### 02_sim.js (lead) — the turn resolver
- `FR.sim.newGame({ seed, labName, slot }) → state` — calls each module's `init(state, rng)` in file order.
- `FR.sim.applyCommands(state, commands) → { state, results: [ {ok, why} ] }` — pure, no time passes. Used by the UI for
  immediate changes (sliders, rent, greenlight...) and by `endTurn`.
- `FR.sim.endTurn(state, commands) → state'` — pure. `state'.lastReport` holds the report (events, memo, news, flows).
  `99_main.js` emits `report.events` on the bus after swapping `FR.state`.
- `FR.sim.forecast(state) → { capacity, alloc, revenue, burn, net, runway, capGain:{}, safeGain:{} }` — next-turn projection
  with no randomness (for UI previews).
- `FR.sim.allocate(state) → alloc` — see §3.
- `FR.sim.score(state) → { total, parts: [ {label, value} ] }` — end-of-run sheet.
- `FR.sim.migrate(d)` — fill missing fields on old saves.
- `FR.sim.avgCap(state)`, `FR.sim.avgSafe(state)`, `FR.sim.debug(state)`.
- `FR.sim.output(base, pf, staff)` — the shared production curve every allocation uses (see §3).
- `FR.sim.atFrontier(state)`, `FR.sim.safelyAtFrontier(state)`.

### 03_model.js — skills, drift, slow-burn ladder
- `init(state, rng)` — `state.model` (all skills cap 8, safe 8 *first pass*), `state.target='coding'`.
- `train(state, alloc, rng, report)` — training raises `cap` on `state.target` (+ spillover to other skills); drift lowers
  `safe` a little on skills whose cap rose; safety output raises `safe` spread over skills by gap; research does nothing here.
- `ladder(state, rng, report)` — per skill: warning / incident / final. May set `state.status='dead'` and `state.end`.
- `boost(state, skill, {cap, safe})` — used by project payoffs (clamps 0..100, safe never above cap + K.safeLead).
- `gap(state, skill)` = `max(0, cap - safe)`; `pressure(state)` = weighted gaps (agents weighted highest);
  `outlook(state, skill) → { level: 'ok'|'watch'|'warning'|'critical', gap, turnsToFinal|null, text }` (UI + memo read this).
- `gains(state, alloc) → { cap:{}, safe:{} }` — deterministic expected gains for the forecast.
- `debug(state)`.

Ladder rules (from the handoff, binding):
- gap > 10 for 2 consecutive turns → **Warning**: memo line (kind 'flag'), `stats.warnings++`, event `model:warning`. Once per
  episode; re-arms when gap ≤ 10.
- gap > 20 → roll each turn, chance `K.incidentBase + (gap-20)*K.incidentSlope` → **Incident**: costs cash
  (`K.incidentCash + cash*K.incidentCashPct`) and trust (`K.incidentTrust`), headline in the news (kind 'incident'),
  event `model:incident`, push turn to `skills[s].incidents`, `stats.incidents++`.
- gap > 30 sustained 4 turns (critStreak ≥ 4) **or** a third incident on the same skill within 52 turns → **Final**:
  `status='dead'`, `end={turn, cause:'final', skill, text}`, event `model:final`.
- The player always sees it coming: memo flags when critStreak ≥ 1 ("final incident in N weeks unless the gap closes")
  and when a skill has 2 incidents inside a year.

### 04_compute.js — rent / buy / share, ageing
- `init(state, rng)`; `capacity(state) → { total, owned, rented, deals }` (owned = sum of cluster pf × age factor);
- `cost(state) → $/week` (rent × price + cluster power cost + nothing for deals);
- `step(state, rng, report)` — price drift and scarcity events, installs arrive, clusters retire at 4 years, deals expire,
  offers refresh every 13 turns;
- commands: `setRent(state, pf)`, `buy(state, offerId)` (cash upfront → `installing`), `acceptDeal(state)` (from
  `state.market.dealOffer`), `endDeal(state, rivalId)` → `{ok, why}`;
- `revShare(state)` → total fraction of revenue owed to deals; `debug(state)`.
- Ageing: capacity −8%/year of age, power cost rises with age, retire at 208 turns.

### 05_money.js — cash, burn, rounds, dilution, milestones, revenue, hiring
- `init(state, rng)` — cash, founderPct 100, headcount, first round offer ('seed');
- `revenue(state, servingPF) → $/week` = `min(servingPF, demandPF) × price(avgCap) × trustMult(trust)`, minus deal revShare;
  `demandPF(state)` grows with avg cap and trust;
- `payroll(state)`; `step(state, alloc, rng, report)` — revenue in, payroll + compute cost + project cash costs +
  ops out, hires arrive, milestone checks, round offers/expiry; writes `money.revenue/burn/net`; if cash ≤ 0 after the
  turn: `status='dead'`, `end={cause:'cash'}`, event `money:bankrupt`;
- `burnEstimate(state)` → expected $/week out next turn (payroll + compute cost + project cash + ops), no randomness;
- `valuation(state)`; commands: `acceptRound(state)`, `declineRound(state)`, `hire(state, n)`, `layoff(state, n)`;
- rounds v1: `seed` then `a`. Closing a round adds cash, dilutes `founderPct` by `pct`, sets the milestone that unlocks
  the next round. Missing a milestone locks rounds for 52 turns (`lockedUntil`), then a fresh milestone is set.
  After `a`, `milestone=null` and no further rounds (B/C are back-burner);
- `debug(state)`.

### 06_market.js — rivals, trust, news, the frontier record, deal offers
- `init(state, rng)`; `step(state, rng, report)` — rivals advance on their curves plus events; rival incidents move trust
  for everyone; trust drifts to 50; news lines; frontier record (`firsts`) at marks 30, 45, 60, 75, 90;
  `dealOffer` refresh;
- `best(state) → { rivalId, avgCap }` — the rival with the highest average cap;
- `frontierCap(state, skill)` — highest cap in the market on that skill (player included);
- `trustMult(state)`, `nudgeTrust(state, delta, why, report)`;
- `debug(state)`.
- Rivals (binding names, fictional rhymes):

| id | name | style | nod | deal (v1) |
|---|---|---|---|---|
| `opal` | Opal AI | the cap-first racer: fastest, thin safety, most rival incidents | OpenAI | acquisition (stub) |
| `entropic` | Entropic | the safety-first slow mover: safe ≥ cap, steady | Anthropic | distribution (stub) |
| `deepfield` | DeepField | the platform giant: huge compute, slow to ship, lurches forward | Google DeepMind | **compute share (live)** |
| `zeta` | Zeta | open weights: mid cap, drags prices (lowers revenue price per PF when ahead) | Meta | licence (stub) |

### 07_projects.js — greenlit bets, research tiers, the generator
- `init(state, rng)` — slots 3, research points 0 tier 1, first offers;
- `pfDemand(state)` — PF reserved this turn by active projects;
- `step(state, alloc, rng, report)` — research points from the research allocation → tier; active projects progress
  (research speeds them), risk rolls (overrun: +50% turns; fail: no payoff), completion pays off via `FR.model.boost`,
  `FR.market.nudgeTrust`, money or compute effects; offers refresh every 8 turns or when empty;
- commands: `greenlight(state, offerId)` (needs a free slot and research tier; `cost` is the total cash, charged evenly
  each turn the project runs via `cashDemand(state)`, which 05_money subtracts), `cancel(state, uid)` (no refund);
- `cashDemand(state)` — $ this turn for active projects (05_money calls it in `step`);
- ~20 templates across 3 tiers (training run per skill, safety eval suite, interpretability push, product launch, data
  deal, chip pre-order, red-team, alignment research paper, enterprise contract, efficiency work, ...);
- `debug(state)`.

## 3. The turn (`FR.sim.endTurn`) — binding order

```
s = clone(state); rng = FR.rng(s.rngState); report = {turn: s.turn, ...}
0. if s.status !== 'playing' → return s unchanged
1. applyCommands(s, commands)
2. alloc = allocate(s)
      cap = FR.compute.capacity(s).total
      projPF = min(cap, FR.projects.pfDemand(s)); free = cap - projPF
      for a in ALLOCS: alloc[a] = { pf: free * sliders[a]/100, staff: headcount * sliders[a]/100 }
      alloc.projects = { pf: projPF, need: pfDemand }  // projects stall proportionally if need > cap
      alloc.capacity = cap
3. FR.model.train(s, alloc, rng, report)
4. FR.projects.step(s, alloc, rng, report)
5. FR.compute.step(s, rng, report)
6. FR.money.step(s, alloc, rng, report)          // may set dead:'cash'
7. FR.market.step(s, rng, report)
8. FR.model.ladder(s, rng, report)               // may set dead:'final'
9. win check: at frontier = avgCap(s) >= best rival avgCap; safely = at frontier && every safe >= cap - 5
      streak++ or 0; best = max; streak >= 52 → status 'won', end {cause:'win'}
10. s.memo = {turn, lines: report.memo}; s.news += report.news (tagged with turn); history row; s.turn++
11. s.rngState = rng.state(); s.lastReport = report; return s
```

Output of each allocation (Cobb-Douglas, *first pass*): `out = K.base × pf^0.6 × (staff+1)^0.4`.

## 4. Commands (`commands` array items; also what `FR.cmd.*` queues)

```
{ type: 'sliders', training, serving, safety, research }     // integers, must sum 100 (sim normalises otherwise)
{ type: 'target', skill }
{ type: 'rent', pf }
{ type: 'buy', offerId }
{ type: 'hire', n }            { type: 'layoff', n }
{ type: 'greenlight', offerId }  { type: 'cancel', uid }
{ type: 'acceptRound' }        { type: 'declineRound' }
{ type: 'acceptDeal' }         { type: 'declineDeal' }        { type: 'endDeal', rivalId }
```

## 5. Bus events (emitted by 99_main after endTurn, from `report.events`, plus UI/HQ events)

```
'game:new' {state}   'game:loaded' {state}   'game:saved' {slot}   'game:save:failed' {slot, reason}
'turn:ended' {turn, report}                 // after every End Turn, once FR.state is the new state
'state:changed' {}                          // after any command applied with applyCommands (UI refresh)
'model:warning' {skill, gap}   'model:incident' {skill, gap, cost, trust}   'model:final' {skill}
'money:round' {round, amount, pct}   'money:milestone' {round, hit}   'money:bankrupt' {}
'compute:installed' {id, pf}   'compute:retired' {id}   'compute:scarcity' {turns}
'project:done' {uid, name, ok}   'project:overrun' {uid}   'research:tier' {tier}
'market:first' {mark, by}   'market:rivalIncident' {rivalId}
'run:won' {}   'run:dead' {cause}
'hq:floor' {floorId}   'hq:hotspot' {hotspotId}   'hq:view' {mode, targetId, floorId}
'elevator:ride' {from, to}   'elevator:arrived' {floorId}
'ui:sheet' {id|null}   'ui:toast' {text}
```

## 6. HQ floors (the Mogul HQ: one floor in memory, diorama camera, elevator between floors)

Bottom → top: `lobby` (Lobby / Press), `serving`, `training`, `safety`, `research`, `proj1`, `proj2`, `proj3`
(one per project slot; empty floors read "No project"), `boardroom`. Tap a floor's targets → that floor's panel.
End Turn is a fixed bottom button. The weekly memo is a sheet that slides up after End Turn.
Incidents show on the building: the affected floor goes dark, press gathers in the lobby. Warnings are memo-only.

## 7. Text

Straight board-memo voice everywhere. No jokes. Numbers first. Example memo lines:
"Agents: capability 46, safety 31. Gap 15, second week above 10. Safety review requested."
"Seed round closed: $18.0M for 20%. Series A opens if any skill reaches capability 40 by Week 30."

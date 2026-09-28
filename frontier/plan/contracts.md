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
    rentPF,                          // player-set rented capacity (PF), applied immediately; 0..FR.compute.maxRent(state)
    rentPrice,                       // $ per PF-week, drifts
    scarcity,                        // turns of scarcity left (price shock), 0 = none
    clusters: [ { id, name, pf, bought, cost } ],        // bought = the turn it came online (= the installing `ready`
                                                         //   turn); age counts from it; retires at bought + K.retireTurns
    deals: [ { rivalId, kind: 'compute', pf, revShare, ends } ],   // live for turns up to `ends`
    offers: [ { id, name, pf, cost, installTurns } ],    // clusters for sale this quarter; pf and cost × the year's ceiling
    installing: [ { id, name, pf, ready, cost } ],      // bought, online from turn `ready`
    bill: { turn, cash, revShare }   // written by compute.step: the compute bill ($) and revenue share for the week `turn`
                                     //   just worked; FR.compute.cost/revShare return it for that turn (05_money charges it)
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
    active: [ { uid, tpl, name, kind, skill, turnsLeft, turns, pfPerTurn, cost, risk, payoff, started, overrun, progress } ],
                                     //   progress: weeks of work done (research speeds it); turnsLeft: weeks at today's pace
    offers: [ { id, tpl, name, kind, skill, tier, turns, pfPerTurn, cost, risk, payoff, blurb } ],
                                     //   skill: a skill id, 'all' or null. payoff: { cap?, safe?, trust?, cash?,
                                     //   trustRisk?: {chance, trust}, fx?: {demandMult?, priceMult?, rentDiscount?, turns} }
    refreshAt,                       // turn the offer board refreshes
    done: [ { name, turn, ok, why, spent } ],   // last 20. why: 'done'|'failed'|'cancelled'; spent: $ spent
    effects: { demandMult, priceMult, rentDiscount, until, grants: [ { name, until, demandMult?, priceMult?, rentDiscount? } ] },
                                     //   live project effects (product launch, efficiency work, chip pre-order...), combined
                                     //   and capped by K.fxMax; read through FR.projects.fx(state)
    spend: { turn, cash }            // written by projects.step: project cash for the week `turn` just worked
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
  stats: { incidents, warnings, firstsWon, firstsLost, projectsDone, peakValuation },
  pendingMemo: [ { kind, text, key? } ],   // memo lines from commands applied since the last End Turn (FR.cmd.do); the next
                                     //   End Turn puts them at the top of its memo, then empties the list. A line with a
                                     //   `key` replaces the pending line with the same key (the week's hires: one line
                                     //   'Hiring 8: recruiting fees $160k, joining Year 1, Week 6.')
  pendingEvents: [ { type, ... } ],  // bus events from those commands (e.g. money:round); the next End Turn puts them at the
                                     //   front of report.events, then empties the list
  lastReport,                        // the report of the last End Turn (§2), null before the first. Not in save codes.
  hq: { floor }                      // UI-owned (99_main): the HQ floor last ridden to; the sim carries it through untouched
}
```

`FR.sim.migrate(d)` fills `stats`, `win`, `history`, `news`, `pendingMemo`, `pendingEvents`, `projects.spend` and
`compute.bill` on old saves.

Derived helpers (pure, in `02_sim.js`): `FR.sim.avgCap(state)`, `FR.sim.avgSafe(state)`.

## 2. Module APIs

All `step` functions mutate the (already cloned) state in place and push into `report`.

`report = { turn, events: [ {type, ...} ], memo: [ {kind, text} ], news: [ {text, kind} ], flows: {}, commands: [ {ok, why} ],
deltas: { cash, trust, cap: {}, safe: {} } }` — `flows` holds each module's numbers for the week (alloc, model, projects,
compute, money, trust, market, plus incidentCost and projectPayout when they happen); `deltas` is the week's change.

Commands return `{ok, why}`; a module may add `event` (a bus event) and `memo` (a memo line). `02_sim` queues both
(`pendingEvents`, `pendingMemo`); nothing in the sim emits on the bus.

### 01_core.js (lead, done)
`FR.on/off/emit`, `FR.rng(seed)` → fn with `.int .range .pick .chance .normal .state()`, `FR.hash`, `FR.clamp`,
`FR.round`, `FR.clone`, `FR.fmtMoney` (negative amounts with a true minus sign, U+2212: "−$102k"), `FR.fmtPct`, `FR.SKILLS`, `FR.SKILL_NAME`, `FR.ALLOCS`, `FR.ALLOC_NAME`,
`FR.year(turn)`, `FR.weekOfYear(turn)`, `FR.dateLabel(turn)`,
`FR.save.{write(slot,state), read(slot), clear(slot), info(slot), exportCode(state), importCode(code), useStore(s), SLOTS}`.

### 02_sim.js (lead) — the turn resolver
- `FR.sim.newGame({ seed, labName, slot }) → state` — calls each module's `init(state, rng)` in file order.
- `FR.sim.applyCommands(state, commands) → { state, results: [ {ok, why, event?, memo?} ] }` — pure, no time passes. Used by
  the UI for immediate changes (sliders, rent, greenlight...) and by `endTurn`. A successful command's `memo` goes to
  `state.pendingMemo` and its `event` to `state.pendingEvents`; both come out with the next End Turn. `FR.cmd.do` must not
  emit `results[i].event` itself (it would fire twice).
- `FR.sim.endTurn(state, commands) → state'` — pure. `state'.lastReport` holds the report (events, memo, news, flows).
  `99_main.js` emits `report.events` on the bus after swapping `FR.state`.
- `FR.sim.forecast(state) → { capacity, alloc, revenue, burn, net, runway, capGain:{}, safeGain:{} }` — next-turn projection
  with no randomness (for UI previews).
- `FR.sim.allocate(state) → alloc` — see §3.
- `FR.sim.score(state) → { total, parts: [ {label, value} ] }` — end-of-run sheet. "Founder stake at the end" scores the
  stake's value then (valuation × founderPct), log-compressed and capped; a lab wound up for want of cash (`end.cause
  === 'cash'`) scores 0 for it (2026-09-28).
- `FR.sim.holdBlocked(state) → string | null` — at the frontier with a skill out of step: the memo flag
  "At the frontier, but Agents safety is 7 below capability. The 52-week hold starts when every gap is 5 or less." The
  win check pushes it each week the lab leads the best rival with no hold running.
- The founding memo has a second line: "Training output grows with compute and staff. Rent PF on Serving or in the
  Boardroom; hire in Boardroom > Team."
- `FR.sim.migrate(d)` — fill missing fields on old saves.
- `FR.sim.avgCap(state)`, `FR.sim.avgSafe(state)`, `FR.sim.debug(state)`.
- `FR.sim.output(base, pf, staff)` — the shared production curve every allocation uses (see §3).
- `FR.sim.atFrontier(state)` (average cap ≥ best rival's), `FR.sim.inStep(state)` (every safe ≥ cap − `K.safeMargin`),
  `FR.sim.safelyAtFrontier(state)` (both). `inStep` also halves the trust hit from rival incidents (06_market).
- `FR.sim.K`: `winTurns` 52, `safeMargin` 5, `allocExp`, `staffExp`, `startSliders`, `score` (end-of-run weights).

### 03_model.js — skills, drift, slow-burn ladder
- `init(state, rng)` — `state.model` (all skills cap 8, safe 8 *first pass*), `state.target='coding'`.
- `train(state, alloc, rng, report)` — training raises `cap` on `state.target` (+ spillover to other skills); drift lowers
  `safe` a little on skills whose cap rose; safety output raises `safe` spread over skills by gap; research does nothing here.
- `ladder(state, rng, report)` — per skill: warning / incident / final. May set `state.status='dead'` and `state.end`.
- `boost(state, skill, {cap, safe})` — used by project payoffs (clamps 0..100, safe never above cap + K.safeLead).
- `gap(state, skill)` = `max(0, cap - safe)`.
- Skill weights `K.weights = { coding: 1, reasoning: 1, agents: 1.5 }` (agents > reasoning = coding; this was `pressureW`
  before 2026-09-28). `weight(skill)` reads it (1 for an unknown skill).
- `pressure(state)` = Σ weight × gap. `pressureLevel(state) → { value, level: 'ok'|'watch'|'warning'|'critical', text }`
  for the Safety floor gauge: `value` = pressure (1 decimal); level = the band of `value` against
  `K.pressureBands = [15, 30, 45]` (above each: watch, warning, critical — the agents weight × the ladder's 10/20/30),
  raised to the worst skill's `outlook` level if that is higher. Gauge scale: 0 to `K.pressureBands[2]` and beyond.
  Text e.g. `"Pressure 19, watch. Agents carries the most: gap 10 at weight 1.5."`,
  `"Pressure 0, in hand. Safety is at or above capability on every skill."`
- `incidentChance(gap, skill?)` — weekly odds at a gap, × the skill's weight when a skill is given (the ladder always
  passes it); `incidentTrust(skill)` = `K.incidentTrust × weight` (6 for coding and reasoning, 9 for agents).
- `outlook(state, skill) → { level: 'ok'|'watch'|'warning'|'critical', gap, turnsToFinal|null, text, stand, incidents }`
  (UI + memo read this; the text quotes the weighted incident risk).
- Memo lines: the training line gives capability to one decimal ("Training on Coding: capability 19.7, up 0.9."). An
  incident line names the rule that ends the lab: with the first incident on a skill in the window, "A third Agents
  incident within 52 weeks ends the lab."; from the second, "Incident odds fall to zero once the gap is 20 or below."
- `gains(state, alloc) → { cap:{}, safe:{} }` — deterministic expected gains for the forecast.
- `debug(state)` (includes `pressure` and `pressureLevel`).

Ladder rules (from the handoff, binding):
- gap > 10 for 2 consecutive turns → **Warning**: memo line (kind 'flag'), `stats.warnings++`, event `model:warning`. Once per
  episode; re-arms when gap ≤ 10. A gap that jumps past 20 before it was warned is warned that week.
- gap > 20 → roll each turn, **but only once the skill was warned in an earlier week** (the week a warning lands never
  rolls), chance `(K.incidentBase + (gap-20)*K.incidentSlope) × weight` → **Incident**: costs cash
  (`K.incidentCash + cash*K.incidentCashPct`) and trust (`K.incidentTrust × weight`), headline in the news (kind
  'incident'), event `model:incident`, push turn to `skills[s].incidents`, `stats.incidents++`. The cash bill lands after
  05_money's step, so 02_sim checks for bankruptcy again after the ladder.
- gap > 30 sustained 4 turns (critStreak ≥ 4) **or** a third incident on the same skill within 52 turns → **Final**:
  `status='dead'`, `end={turn, cause:'final', skill, text}`, event `model:final`.
- The player always sees it coming: memo flags when critStreak ≥ 1 ("Final incident in 3 weeks unless the gap falls to 30
  or below.") and when a skill has 2 incidents inside a year ("2 incidents in the past 52 weeks. One more by Year 3,
  Week 5 ends the lab.").

### 04_compute.js — rent / buy / share, ageing, the compute ceiling
- `init(state, rng)`; `capacity(state) → { total, owned, rented, deals }` (owned = sum of cluster pf × age factor);
- `cost(state) → $/week` (rent × price × (1 − project rent discount) + cluster power cost + nothing for deals). During End
  Turn, once `step` has run, it returns `compute.bill.cash` (the week just worked); otherwise next week's projection.
  `rentCost(state)`, `powerCost(state)` are the parts.
- **The compute ceiling** (the late-game cash sink): `ceiling(turn)` = `min(K.ceilMax, K.ceilGrowth^(year − 1))` =
  1, 1.35, 1.82, 2.46, 3.32, then 4 from year 6. `maxRent(state)` = `K.maxRent × ceiling(state.turn)`, rounded to 10 PF:
  1000, 1350, 1820, 2460, 3320, 4000. `setRent` validates against `maxRent(state)`, never `K.maxRent` (that is the year-1
  base) — UI steppers read `FR.compute.maxRent(FR.state)`. Cluster offers dealt for a turn have `pf` = tier range ×
  `ceiling(turn)`, and cost follows PF (`K.buyPerPF` × tier mult × jitter × spot/base), so late clusters are bigger and
  dearer at the same payback. On the week a new year starts the memo names the new ceiling.
- `step(state, rng, report)` — writes `compute.bill` for the week, then price drift and scarcity events, installs arrive
  (online from `ready`; `bought` = that turn), clusters retire at 4 years, deals expire, offers refresh every 13 turns;
- commands: `setRent(state, pf)` (whole PF, 0..`maxRent(state)`), `buy(state, offerId)` (cash upfront → `installing`),
  `acceptDeal(state)` (from `state.market.dealOffer`), `endDeal(state, rivalId)` → `{ok, why}`. Lead's call: the DeepField
  share **stays free to end** — `endDeal` costs no cash and no trust; the PF and the revenue share stop at once.
- `revShare(state)` → total fraction of revenue owed to deals (during End Turn, `compute.bill.revShare`: a deal ending this
  week still takes its cut for the week its PF was used);
- `clusterInfo(state, cluster) → { pf, factor, power, age, retiresIn }`; `payback(state, offer) → weeks | null` (weeks until
  buying has saved its price against renting at today's spot price, install time included); `debug(state)`.
- Ageing: capacity −8%/year of age, power cost rises with age, retire at 208 turns.

### 05_money.js — cash, burn, rounds, dilution, milestones, revenue, hiring
- `init(state, rng)` — cash, founderPct 100, headcount, first round offer ('seed');
- `revenue(state, servingPF) → $/week` = `min(servingPF, demandPF) × pricePerPF(avgCap) × project priceMult × trustMult ×
  (1 − deal revShare) × zetaFactor`; `demandPF(state)` grows with avg cap, trust and the project demandMult;
- `payroll(state)`; `step(state, alloc, rng, report)` — revenue in, payroll + compute cost + project cash costs +
  ops out, hires arrive, milestone checks, round offers/expiry; writes `money.revenue/burn/net`; if cash ≤ 0 after the
  turn: `status='dead'`, `end={cause:'cash'}`, event `money:bankrupt`;
- `burnEstimate(state)` → expected $/week out next turn (payroll + compute cost + project cash + ops), no randomness;
  `burnParts(state) → { payroll, ops, compute, projects }`; `runway(state)` → weeks (Infinity when net ≥ 0);
- `valuation(state)` = `(K.valBase + K.valCap × avgCap^K.valCapExp + K.revMultiple × 52 × weekly revenue) × trustMult`
  (`10e6 + 1.25e6 × avgCap² + 20 × annual revenue`): $90M at the start, so the seed prices at 20%, and about $300-370M
  where a lab meets the Series A milestone (one skill at 20, average near 14, ~$50k a week of revenue), so the Series A
  ($75M) prices near 20-25% (lead's call), not at the 35% cap;
- `progress(state, milestone?) → { current, value, met, weeksLeft }`; `pace(state, milestone?) → { projected, short, skill,
  weeksLeft } | null` (capability milestones only: today's `FR.sim.forecast` gains held flat to the due week; null for
  revenue and trust milestones). The milestone's due lines (8/4/1 weeks) add "At this pace: Coding 18.2 by Year 1,
  Week 37, short by 1.8."; at `K.msPaceAt` (30, 24, 18, 12 weeks left) an off-pace milestone gets a flag line
  "Series A milestone off pace: ... Training output grows with compute and staff: ...". `nextRound(state)`; `pricePerPF(avgCap)`,
  `demandPF(state)`, `trustMult(state)`, `zetaFactor(state)`, `payroll(state)`, `ops(state)`;
- memo flag when revenue falls and serving leaves more than `K.unservedFlag` (10%) of demand: "Serving covers 75.4 of
  106.3 PF of demand: about $1.0M a week unserved. Revenue $2.41M, down from $3.35M.";
- commands: `acceptRound(state)` (result carries the `money:round` event), `declineRound(state)`, `hire(state, n)`,
  `layoff(state, n)`;
- hiring: at most `K.maxHire` (20) recruits ordered per week. `hiredThisWeek(state)` = recruits already ordered this week
  (they all join on turn + `K.hireTurns`); `hireRoom(state)` = `K.maxHire − hiredThisWeek`. `hire` accepts a whole n in
  1..`hireRoom(state)` (and within `K.maxHead`, with the fee `n × K.hireFee` in cash); the UI's hire stepper tops out at
  `hireRoom`; the memo line (keyed 'hire:<arrival turn>') carries the week's running total;
- rounds v1: `seed` then `a`. Closing a round adds cash, dilutes `founderPct` by `pct`, sets the milestone that unlocks
  the next round. Missing a milestone locks rounds for 52 turns (`lockedUntil`), then a fresh milestone is set.
  After `a`, `milestone=null` and no further rounds (B/C are back-burner);
- `debug(state)`.

### 06_market.js — rivals, trust, news, the frontier record, deal offers
- `init(state, rng)`; `step(state, rng, report)` — rivals advance on their curves plus events; rival incidents move trust
  for everyone; trust drifts to 50; news lines; frontier record (`firsts`) at marks 30, 45, 60, 75, 90;
  `dealOffer` refresh;
- rival incidents: every lab loses `K.incTrust` (2..4) points — except that a lab **in step** (`FR.sim.inStep`: every safe
  ≥ cap − 5 when the market resolves) takes `K.incShield` (half) of it. The memo then says so: "Public trust 48 after the
  Opal AI agents incident, which cost AI labs 3 points. Our evaluations are current; trust impact limited to 1.5." The
  event carries `{ rivalId, trust (points this lab lost), shielded }`;
- `best(state) → { rivalId, avgCap }` — the rival with the highest average cap; `avgCap(rival)`;
- `frontierCap(state, skill)` — highest cap in the market on that skill (player included);
- `trustMult(state)`, `nudgeTrust(state, delta, why, report)` → the applied delta; `priceDrag(state)` (Zeta's price cut);
- `ORDER`, `DEALS`, `NEWS` (wire templates); `debug(state)`.
- Rival pace: weekly gain per skill = `K.gainBase × speed × (1 + ramp × years) × weight × (1 − cap/100)`; `K.gainBase` 0.44
  (0.42 → 0.43 on 2026-09-28 so the race stays tight once the compute ceiling grows; → 0.44 the same day once the
  balance bots accept the DeepField share when its revenue cut costs under half of renting the PF, as a reading player does).
- Wire templates may carry a third field: `calm` lines ("Spot GPU rental rates steady") never run while `compute.scarcity > 0`.
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
  `FR.market.nudgeTrust`, money or compute effects; the board refreshes every 8 turns, when nothing on it can be
  greenlit, or when a research tier opens;
- commands: `greenlight(state, offerId)` (needs a free slot and research tier; `cost` is the total cash, charged per week of
  work done via `cashDemand(state)`, which 05_money subtracts), `cancel(state, uid)` (before any work: the card returns to
  the board at no cost; after: no refund);
- `cashDemand(state)` — $ this turn for active projects (05_money calls it in `step`; once `step` has run it returns
  `projects.spend.cash` for the week just worked);
- reads for the UI: `describe(offer, state?)` → the payoff as one board-memo sentence, e.g. "Coding capability +5, safety
  -1.5."; with the state, a safety payoff that today's ceiling (cap + `FR.model.K.safeLead`) would cut says what it adds
  now: "Coding safety +5 (+2 at today's levels: safety stops at capability + 3)."; `safeToday(state, offer) → { full, now,
  each } | null` (null when the card has no safety payoff); `fx(state) → { demandMult, priceMult, rentDiscount, until }`;
  `tierFor(points)`, `nextTier(state) → { tier, at, points, left } | null`, `speed(state)`, `researchRate(state)`,
  `pfDemand(state)`;
- ~20 templates across 3 tiers (training run per skill, safety eval suite, interpretability push, product launch, data
  deal, chip pre-order, red-team, alignment research paper, enterprise contract, efficiency work, ...);
- `debug(state)`.

## 3. The turn (`FR.sim.endTurn`) — binding order

```
0. if state.status !== 'playing' → return state unchanged (the same object; no turn passes after the end)
   s = clone(state); rng = FR.rng(s.rngState); report = {turn: s.turn, ...}
1. apply commands (as applyCommands); report.memo = s.pendingMemo, report.events = s.pendingEvents (commands applied
   before End Turn, e.g. by FR.cmd.do, then this End Turn's own), both emptied; a failed command adds a 'Not done: ...' flag
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
8. if playing: FR.model.ladder(s, rng, report)   // may set dead:'final'
   if playing and cash <= 0: FR.money.bankrupt(s, report)   // an incident bill can empty the bank after step 6
9. win check (if playing): safely = FR.sim.safelyAtFrontier(s) (avg cap >= best rival's and every safe >= cap - 5)
      streak++ or 0; best = max; streak >= 52 → status 'won', end {cause:'win'}, event 'run:won'
   dead → event 'run:dead' {cause}
10. s.memo = {turn, lines: report.memo}; s.news += report.news (tagged with turn); report.deltas; history row;
    s.turn++ ONLY while status is 'playing' (a run that ends this week keeps the turn it ended on; end.turn === s.turn)
11. s.rngState = rng.state(); s.lastReport = report; return s
```

Output of each allocation (`FR.sim.output`, Cobb-Douglas with falling returns to scale):
`out = base × pf^allocExp × (staff+1)^staffExp`, with `FR.sim.K.allocExp = 0.36` and `FR.sim.K.staffExp = 0.24`; 0 when
pf <= 0. Bases: training `FR.model.K.trainBase` 0.11, safety `FR.model.K.safeBase` 0.36, research
`FR.projects.K.researchBase` 1 (points a week); serving is not a curve: revenue = min(serving PF, demand) × price.

## 4. Commands (`commands` array items; also what `FR.cmd.*` queues)

```
{ type: 'sliders', training, serving, safety, research }     // integers, must sum 100 (sim normalises otherwise)
{ type: 'target', skill }
{ type: 'rent', pf }           // whole PF, 0..FR.compute.maxRent(state) (grows each year)
{ type: 'buy', offerId }
{ type: 'hire', n }            // whole n, 1..FR.money.hireRoom(state)
{ type: 'layoff', n }          // whole n, 1..headcount − K.minHead
{ type: 'greenlight', offerId }  { type: 'cancel', uid }
{ type: 'acceptRound' }        { type: 'declineRound' }
{ type: 'acceptDeal' }         { type: 'declineDeal' }        { type: 'endDeal', rivalId }
```

## 5. Bus events (emitted by 99_main after endTurn, from `report.events`, plus UI/HQ events)

Every sim event reaches the bus only through `report.events` at End Turn. Events from commands (`money:round` from
`acceptRound`, and any other command `event`) ride in `state.pendingEvents` and are emitted with the **next** End Turn,
first in `report.events`; `FR.cmd.do` emits only `state:changed` (never a command's own event).

```
'game:new' {state}   'game:loaded' {state}   'game:saved' {slot}   'game:save:failed' {slot, reason}
'turn:ended' {turn, report}                 // after every End Turn, once FR.state is the new state
'state:changed' {}                          // after any command applied with applyCommands (UI refresh)
'model:warning' {skill, gap}   'model:incident' {skill, gap, cost, trust}   'model:final' {skill}   // trust: points lost
                                                                                                    //   (K.incidentTrust × weight)
'money:round' {round, amount, pct}   'money:milestone' {round, hit}   'money:bankrupt' {}
'compute:installed' {id, pf}   'compute:retired' {id}   'compute:scarcity' {turns}
'project:done' {uid, name, ok}   'project:overrun' {uid}   'research:tier' {tier}
'market:first' {mark, by}   'market:rivalIncident' {rivalId, trust, shielded}   // trust: points this lab lost
'run:won' {}   'run:dead' {cause}
'hq:floor' {floorId}   'hq:hotspot' {hotspotId}   'hq:view' {mode, targetId, floorId}
'elevator:ride' {from, to}   'elevator:arrived' {floorId}
'ui:sheet' {id|null}   'ui:toast' {text}   'ui:panel' {floorId, tab, hotspotId}
```

## 6. HQ floors (the Mogul HQ: one floor in memory, diorama camera, elevator between floors)

Bottom → top: `lobby` (Lobby / Press), `serving`, `training`, `safety`, `research`, `proj1`, `proj2`, `proj3`
(one per project slot; empty floors read "No project"), `boardroom`. Tap a floor's targets → that floor's panel.
End Turn is a fixed bottom button. The weekly memo is a sheet that slides up after End Turn.
Incidents show on the building: the affected floor goes dark, press gathers in the lobby. Warnings are memo-only.

## 7. Text

Straight board-memo voice everywhere. No jokes. No exclamation marks. Numbers first. Dates as `FR.dateLabel` ("Year 1,
Week 37"). Example memo lines (current text, as the sim writes them):
"Agents: capability 46, safety 31. Gap 15, second week above 10. Safety review requested."
"Seed round closed: $18.0M for 20%. Series A opens if any skill reaches capability 20 by Year 1, Week 37."
"Series A milestone met: Coding capability 20 against 20. Series A offer: $75.0M for 23% at a $326M valuation. Open until Year 1, Week 24."
"Agents incident at gap 22. Cost $1.1M and 9 points of public trust. A third Agents incident within 52 weeks ends the lab."
"Public trust 48 after the Opal AI agents incident, which cost AI labs 3 points. Our evaluations are current; trust impact limited to 1.5."
"Compute ceiling for Year 2: the spot market rents up to 1350 PF, up from 1000. Cluster offers grow in step."
Gauge text (`FR.model.pressureLevel`): "Pressure 19, watch. Agents carries the most: gap 10 at weight 1.5."

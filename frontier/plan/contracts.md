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
- rounds: `seed`, `a`, then `b` (V0.3, below). Closing a round adds cash, dilutes `founderPct` by `pct`, sets the milestone
  that unlocks the next round. Missing a milestone locks rounds for 52 turns (`lockedUntil`), then a fresh milestone is set.
  After `b`, `milestone=null` and no further rounds (C and IPO are back-burner);
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
  balance bots accept the DeepField share when its revenue cut costs under half of renting the PF, as a reading player does);
  0.48 for V0.3 (enterprise accounts lift every lab's revenue), with the sector raise after the lab's Series B (V0.3 below).
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
  deal, chip pre-order, red-team, alignment research paper, fixed-scope deployment, efficiency work, ...);
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
   if playing: FR.accounts.shock(s, report)       // V0.3: this week's lab and rival incidents move account mood
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


## V0.3 — Series B and enterprise accounts (binding for the V0.3 build; design: docs/frontier-handoff-v0.3.html)

Owner calls: Series B unlocks on a **weekly revenue** milestone and is optional; accounts are **fully fictional** sector
names (~30, e.g. Halden Mutual, Coastline Freight, Province Health Authority); a churned account is **gone for the run**.

State (05_money owns the block, 05b_accounts owns the logic):
```
accounts: { active: [ { id, name, sector, tier, pfPerWeek, feePerWeek, ends, signed, starts, mood, served } ],
            offers: [ { id, name, sector, tier, pfPerWeek, feePerWeek, turns, minCap, minSafe, minTrust, expires } ],
            refreshAt, unlocked, lost: [ { name, turn, why } ], used: [name...],   // why: 'churn'|'expired'|'dropped'
            boost, readyUntil }
money: { ..., revMarket, revContracts }   // last resolved turn's revenue split, $/week (revenue = revMarket + revContracts)
market: { ..., raised }                   // turn the rivals raised in step with the lab's Series B, 0 = not yet
money.roundsDone may contain 'b'; money.milestone.kind is always 'revenue' for round 'b'.
```
- `starts` = first turn the fee is paid and the PF is reserved (signed + `K.signWeeks`). `ends` = last turn under contract.
  `served` = PF actually served to it last turn. `mood` 0..100.
- `used` = churned names: never dealt again (owner call: gone for the run). `cool: [ { name, until, why, at, ... } ]` =
  declined ('declined', with the offer's pfPerWeek/feePerWeek/turns) or expired ('expired') names, dealt again from
  `until` (`K.cooldown` 52 weeks later). A live account's name is not dealt while it is in the book. An offer that lapses
  unanswered can come back on a later board. (Review round: `used` held signed and declined names too, which emptied the
  30-name pool for a player who declines by week ~125.)
- `active[].leaving` = the account fell below the churn line (step or shock); it is off the book at once (no reserved PF,
  no fee, no backlog) and leaves at the next step whatever its mood does in between. `active[].turns` = contract length.
  `lost[].signed` = the week it was signed (the client wall darkens it in its place).
- `boost` = offers still to arrive one tier higher (Reference customer program). `readyUntil` = last turn the Enterprise
  readiness work halves the unserved-PF mood penalty.
- `lost` keeps the last `K.lostKeep` (10). 'dropped' is reserved (not produced in V0.3).

APIs (05b_accounts.js, `FR.accounts`):
- `init(s, rng)`; `step(s, alloc, rng, report)` — called by `FR.money.step` after revenue resolves: unlock, churn (accounts
  below the line last week leave), service and mood, expiry / renewal, the offer board; its memo lines follow the money
  lines. `shock(s, report)` — called by 02_sim after the ladder: this week's `model:incident` (−25 each) and
  `market:rivalIncident` (−10 each) events move every account's mood. `K`.
- `debug(s) → { active, contracted, avgMood, unservedPF, lost, offers, unlocked, reservedPF, backlog, maxActive }`.
- `reservedPF(s) → PF` — contract PF of live accounts (fee started), taken from serving before the open market.
  `pending(s) → PF` — PF of accounts signed but still onboarding. `live(s) → [account]` — accounts whose fee has started.
- `serve(s, servingPF) → [ { id, pf, served } ]` — serving PF split over live accounts, oldest contract first.
- `feeRevenue(s, servedPF?) → $/week` — each live account pays its fee × the share of its PF served (omitted = all served),
  × `FR.money.incidentFactor` × (1 − DeepField revenue share). Never the Zeta drag (contracts are locked).
- `fee(tier, turn) → $/week` = tier × `K.feeBase` × (1 + `K.feeYear` × year), rounded to $1k.
- `contracted(s) → $/week` — the live book's fees in full. `backlog(s) → $` — remaining contracted fees (fee × weeks left).
- `sign(s, id) → {ok, why, memo?, event?}`, `decline(s, id) → {ok, why, memo?}`.
- `qualifies(s, offer) → { ok, why }` — minCap (average capability), minSafe (every skill's safety within N of its cap),
  minTrust against the lab now. why e.g. "Needs average capability 30; the lab is at 29".
- `maxActive(s)` — `K.maxActive` 5 (4 in the first pass; 5 so the no-B path can carry a book), or `K.maxActiveB` 6 once 'b'
  is in roundsDone.
- `ready(s)` — readiness work running. `lift(s, mood, weeks)` / `refer(s, n)` — project payoffs (07_projects).

Rules and K (first pass, `FR.accounts.K`):
- Unlock when average cap ≥ `unlockCap` 20 and trust ≥ `unlockTrust` 45: one memo line "Enterprise buyers are asking for
  meetings. First account offers on the Serving floor." and the first board.
- Board: `board` [1, 3] offers every `refreshTurns` 8 weeks (expires = the week before the next refresh). A tier is dealt once
  average cap is within `reach` 5 of its minCap; mostly the highest tier in reach. PF a week by tier `pf` [[8,14],[16,26],
  [28,42]]; contract `turns` [52, 104, 156]; requirements `minCap` [20, 30, 40], `minSafe` [10, 7, 5], `minTrust` [45, 48, 52].
- Fee: `feeBase` 60000, `feeYear` 0.1. Signing: `signCost` 150000 × tier cash at once, fee and reservation from
  `signWeeks` 2 weeks later, trust `signTrust` [1, 1, 2] by tier. Declining costs nothing.
- Mood (`K.mood`): start 70; +1 toward `top` 80 each week the account is served in full and the lab is in step
  (`FR.sim.inStep`); −3 (`unserved`) each week its PF is short (× `readyShare` 0.5 while readiness work runs); −25 per lab
  incident, −10 per rival incident. Below `churn` 30 → the account leaves at the next turn: memo, news "X ends its contract
  with <lab> citing reliability concerns.", trust −`churnTrust` 2, event `account:churned {why:'churn'}`; gone for the run.
- Expiry: on `ends`, mood ≥ `renew` 60 → renews one tier up (tier 3 stays 3) at `fee(tier, next week)` for that tier's
  length; otherwise leaves quietly (why 'expired'). Memo 'due' line `dueWarn` 8 weeks before the end.
- Memo: at most `memoMax` 2 account lines a week (churn / mood flags first, then renewals and expiries, then new contracts,
  due lines and the board line), after the money lines.

APIs (05_money.js additions):
- `revenueSplit(s, servingPF) → { market, contracts, total, reserved, open }` — contract PF first, open market on the rest.
  `M.revenue(s, pf)` keeps returning the total (market + contracts) so existing callers and the forecast stay right.
  `marketRevenue(s, pf)` — the open-market part alone. `backlog(s)` = `FR.accounts.backlog(s)`.
- `valuation(s)` = (valBase + valCap × avgCap² + revMultiple × 52 × weekly revenue (fees included) + `backlogMultiple` 4 ×
  backlog) × trustMult.
- Series B: `K.rounds.b = { name: 'Series B', amount: 150e6, pctMin: 0.10, pctMax: 0.20 }`, `K.order = ['seed','a','b']`.
  When the A closes the B milestone is set: weekly revenue `sig2(max(K.ms.bRevMin 400000, revenue × K.ms.bRevMult 3))`, 36
  weeks, the A's warn cadence. `K.msKindsFor.b = [['revenue', 1]]`: a fresh B milestone after a miss is revenue too (no rng
  draw). Declining or a lapse: re-offer after `reofferTurns` 13 on the same met milestone, nothing else changes. The B amount
  (180e6) keeps the raise inside 10-20% at the valuations where the bots meet the milestone (about $1.3-1.5B, week ~34), so
  the founder stake after seed + A + B lands near 53%.
- `FR.sim.forecast(s)` also returns `market` and `contracts` (the revenue split for next week).

Sector raise (06_market.js, lead's balance call 2026-09-28): once the lab's Series B has closed, every rival trains
`FR.market.K.raiseLift` (0.48) faster from `K.raiseLag` (13) weeks later for the rest of the run; `market.raised` = the turn
the B closed (set by the market step of that End Turn). That week: news "Opal AI, Entropic, DeepField and Zeta close new funding
rounds within weeks of <lab>'s Series B." and a memo flag "Rivals have raised in step with our Series B. Their training pace
rises 48% from Year 1, Week 49 for the rest of the run." Declining the B leaves the rivals as they were. Why: the B roughly
doubles a lab's compute for two years; without a response the balanced bot won 95% and the no-B path could not be tuned to
stay viable (the owner's call: a lab that never raises again is a valid path). Rival base pace `K.gainBase` 0.48 (0.44 in V0.2).

Commands: `{ type: 'signAccount', id }`, `{ type: 'declineAccount', id }` (02_sim apply1 → FR.accounts).
`FR.cmd.signAccount(id)` / `FR.cmd.declineAccount(id)` in 99_main wrap `FR.cmd.do`.
Events: `account:signed {id, name, tier}` (from the sign command, with the next End Turn), `account:churned {id, name, why}`
(why 'churn' or 'expired'), `account:offers {n}` (each time a board is dealt); `money:milestone` also fires for round 'b'.
Turn order: 02_sim step 2 puts `alloc.serving.reserved` (contract PF, capped at serving) and `alloc.serving.open`; step 6
(money) resolves open-market revenue and fees, then `FR.accounts.step`, then rounds and milestones; after the ladder
`FR.accounts.shock`. `FR.sim.migrate` fills `accounts` and `money.revMarket/revContracts` on 0.2 saves.
Projects (07_projects.js): two tier-2 templates dealt only once accounts have unlocked (`needs: 'accounts'`): "Enterprise
readiness work" (4-6 turns; payoff `accounts: {mood: 10, turns: 26}`: +10 mood on every account, unserved-PF penalty halved
for 26 weeks) and "Reference customer program" (3-5 turns; payoff `refs: 2`: the next 2 offers one tier higher).
HQ: Serving floor hotspot `serving.accounts` (client wall with one plaque per active account). Floor 1 panel gains an
Accounts section (rows + offer board, Sign / Decline). Serving slider readout: "Serving 38 PF · 14 reserved for accounts
· 24 open market". HUD revenue splits into open market / contracts on tap.

Balance probe (tools/balance.js): bots race, safe, balanced (signs offers when in step, not under review and the onboarding
fee is under 1/12 of cash; takes the B), revenue-first, customer-first (serves demand + book × 1.15, at least 30%; signs
every offer it qualifies for; declines the B); `--noB` adds balanced-noB (balanced that declines the B). The summary line
prints wins, deaths, runs past year 4, the median first-frontier week, the B (week, amount, pct), the founder stake and the
account counts.

### V0.3 review round (2026-09-28; supersedes the lines above where they differ)

Money (05_money.js):
- `makeOffer`: above pctMax the amount shrinks (unchanged); inside the bounds the amount is fixed; below pctMin the amount
  grows to at most `amount × K.amountCap` (1.25) and the stake sold falls below pctMin (floor `K.pctFloor` 0.5%). Waiting
  out a round never buys a bigger one (the late-B exploit: declining until week 80-100 won 50-60% with a $500-700M B).
  Applies to every round.
- Re-offer delay after a decline or lapse: `K.reofferBack` [13, 26, 52] by `money.passes` (count for the current round,
  reset to 0 when a round closes; `K.reofferTurns` 13 stays as the first step).
- B milestone value: `sig2(max(bRevMin, M.trailRevenue(s) × m))`, trailing = mean revenue of the last `K.ms.bRevWeeks` 8
  history rows; m = `bRevMult` 3 when the A closes, `bRevAgain` 1.3 after a miss. One starved week cannot rig the target;
  an honest lab can reach a fresh one in 36 weeks.
- `milestone.metAt` / `metValue`: the week and value it was met (the Money tab says "Met Year 1, Week 30: ...").
- `M.openB(s)` / `FR.sim.migrate`: a 0.2 save past its A (no milestone, no offer, not locked) gets the B milestone on the
  bRevAgain rule and its "Series B opens if ..." line in pendingMemo. `money.passes` defaults to 0.
- `K.rounds.b.amount` 150e6 (balance: 180e6 won balanced 45% after the fixes below; 150M is 10-11.5% at the B-era
  valuations and still buys a year-3 200-PF cluster, about $45M, with runway to spare).

Accounts (05b_accounts.js):
- Dealing: a tier is in reach when average capability ≥ minCap − `K.reach` 5 and trust ≥ minTrust − `K.trustReach` 2.
  The Reference customer program's boost lifts an offer one tier only when that tier is within twice the reach; otherwise
  the boost waits for a later offer.
- Renewal at `ends` with mood ≥ 60: one tier up when the lab meets that tier's minimums (reserved PF scaled into the new
  tier's PF range, so fee per PF stays in line), else the same tier at this year's fee. Line: "X renews at tier 2 for 104
  weeks at $144k a week, up from $66k, reserving 26 PF, up from 14, through ...".
- `live(s)` excludes leaving accounts (mood < 30 or `leaving`); `backlog(s)` counts live accounts only (onboarding and
  leaving ones do not lift a round's terms). `lift()` does not rescue a leaving account.
- Memo: `step` and `shock` collect lines; 02_sim calls `FR.accounts.flush(report)` once after shock (`report.deferAccounts`)
  and they go in right after the money lines (`flows.accounts.at`). At most `memoMax` 2, most urgent first; the week's
  sign/decline line (one keyed line, `key: 'accounts:<turn>'`, e.g. "Signed A (tier 1) and B (tier 2): 34 PF reserved and
  $198k a week from ... Declined C.") takes one place; a p0 line (churn, below-30 warning) always gets one. Contracts going
  live the same week share one line; a live contract short in its first week is a flag ("... contract live but short: 0 of
  26 reserved PF served this week; fees are paid in proportion."). The due line quotes mood after the week's shocks. The
  shock line lists up to 3 accounts by name, a bigger book by its average, and "end their contracts" in the plural.
- Board line: none while the book is full; an empty board says so ("Account board: no new buyers this round. ...").
- `debug()` adds `leaving`, `cooling`.

Projects (07_projects.js): "Reference customer program" has `room: true` (dealt only while the book has a free place);
its payoff text names the wider reach. The V0.1 template "Enterprise contract" is renamed "Fixed-scope deployment".

Balance tool: `--noB` also adds `balanced-lateB` (declines the B until week 80, then takes it).

## V0.4 — the late-game book (binding; design: docs/frontier-handoff-v0.4.html §3-§5)

Owner calls: renewal meetings (Renew / Push up / Let go) replace the automatic renewal; client asks and sector swings;
client work trains the sector's skill (map kept as the handoff's first pass). **An unanswered meeting at the last contract
week renews at the same tier if mood allows (≥ `K.meet.renewMood` 45, +10 in a cold sector), otherwise it lapses as
'expired'.**

State (05b_accounts owns; all new fields exist on new games and after `FR.sim.migrate`):
```
accounts: { ..., sectors: { hot: { name, until, from } | null, cold: { name, until, from } | null, nextAt, last: { [sector]: turn } } }
                                   // until = last week of the swing (inclusive); last = the week each sector's last swing ended
active[]: { ..., meeting: null | { opens, answer: null | 'renew' | 'up' | 'go' },
            ask: null | { type: 'cap'|'inStep'|'peak'|'clean'|'cost', skill, target, arrived, from, due, weeks, progress,
                          reward, answered: null | true, declineBy },
            field,                 // last week's field PF (served × K.field.rate), for the readout
            hot?, cut? }           // hot: signed from an offer dealt while its sector was hot (+25% for the term);
                                   // cut: the fee cut a cost ask applied
offers[]: { ..., hot? }            // dealt while its sector is hot: fee already × K.sector.hotFee
lost[].why / cool[].why            // adds 'let go' (rests K.cooldown weeks like 'expired'; no trust cost)
```
Ask fields by type: `cap` — skill = the sector's skill, target = capability, due = arrived + 8..16, progress = current cap
(1 dp). `inStep` — skill null, target = 3 (every gap ≤ 3), weeks = 8 consecutive, due = arrived + 12, progress = weeks in
a row so far. `peak` — target = extra PF (30-50% of the contract PF, min 3), from = arrived + 2..4, weeks = 8, due =
from + 7, progress = weeks served in full. `clean` — target 0, weeks = 13..26, due = arrived + weeks. `cost` (cold sector
only) — target = 0.15 (the cut), due = ends. reward = 4 × feePerWeek (rounded to $1k; paid × incident factor × (1 −
DeepField share)). declineBy = arrived + 2 (commands on turns ≤ declineBy may decline).

APIs (05b_accounts.js, `FR.accounts`), new or changed:
- `K.sectorSkill` { Banking, Retail, Energy, Telecoms → 'coding'; Insurance, Pharma, Legal → 'reasoning'; Logistics,
  'Public sector' → 'agents' }. `A.SECTORS` (the 9 sector names). `skillOf(sectorOrAccount) → skill | null`.
- `fieldPF(s) → { coding, reasoning, agents }` — training-PF equivalent from client work this week: Σ over live accounts
  of last week's `served` × `K.field.rate`, by the sector's skill (2 dp). Onboarding and leaving accounts give 0.
- `pfOf(s, a)` = pfPerWeek + `peakPF(s, a)` (a running, not-declined peak ask's extra PF from `from` to `due`).
  `reservedPF`, `serve` and `feeRevenue` use it; the peak's extra PF is unpaid (the fee is paid on the contract PF share).
- `swing(s, sector) → 'hot'|'cold'|null`; `sectorStrip(s) → [ { name, kind, skill, from, until, weeksLeft } ]` (hot first;
  the Serving strip: hot in board blue, cold in grey, weeks left).
- `meetings(s) → [account]` (open meetings, not leaving). `meetingView(s, idOrAccount) → { id, name, opens, answer, ends,
  weeksLeft, cold, mood, renew: { ok, need, text }, up: { ok, tier, need, sure, chance, qualifies, why, text },
  go: { ok, text }, unanswered, text }` — `chance` is 0, 0.5 or 1 with the lab as it is now; `text` = the line for the
  current answer (or `unanswered`). e.g. up.text "Push up to tier 2: accepts at mood 70+ (now 64: even odds; a refusal
  renews at tier 1)."
- `renew(s, id, choice) → {ok, why, memo}` — choice 'renew' | 'up' | 'go'; refused before the meeting opens, for a leaving
  account, 'up' at tier 3. Changeable until the last contract week (commands in that week still count). Memo key
  'meeting:<id>' (one pending line per account).
- `asks(s) → [account]` (open asks). `askView(s, idOrAccount) → { id, name, type, skill, target, progress, due, from,
  weeksLeft, declinable, declineBy, answered, reward, onTrack, progressText }` — progressText e.g. "35 / 38 · 6 weeks left",
  "3 / 8 weeks in step · 5 weeks left", "6 PF more from Year 2, Week 8", "4 weeks clean · 9 weeks left"; onTrack = the
  forecast on today's sliders and target meets it (cap: projected to due; inStep: gap after a week ≤ 3 and weeks remain;
  peak: serving PF covers the book + the peak; clean: no gap over the incident line).
- `answerAsk(s, id, accept) → {ok, why, memo}` — accept: cost asks apply at once (fee × 0.85 for the term, mood +10, ask
  cleared); other asks set `answered = true` and run on. Decline: only while `s.turn ≤ declineBy` and not yet accepted;
  mood −5 (cost: −10), ask cleared. Memo key 'ask:<id>'.
- `migrate(s)` — 0.3 → 0.4 fill (see below). `debug(s)` adds `field` (fieldPF), `asksOpen`, `meetingsOpen`, `sectors`
  (the strip).
- Retired: the automatic renewal. `K.mood.renew` (60) stays only as the UI's mood colour mark (= `K.meet.upMood`).

03_model.js: `train` adds field training after the target's training: each skill with field PF f gains
`FR.sim.output(trainBase, f, f × trainingStaff / trainingPF) × noise × dim(cap)` (no spillover; the week's training
noise; drift `K.drift` of the gain). `gains(s, alloc) → { cap, safe, field }` (cap/safe include client work; field =
capability from client work by skill). `fieldPF(s)` (zeros without accounts). `fieldText(field) → "Client work: +0.4
agents, +0.2 coding a week."` ('' when nothing reaches 0.05). The weekly training memo line appends "Client work: +0.1
coding, +0.1 reasoning." `report.flows.model.field`.

02_sim.js: `forecast(s)` adds `fieldGain` (= gains.field) and `fieldPF`; `capGain` includes the field gain. apply1:
`{ type: 'renewAccount', id, choice }`, `{ type: 'answerAsk', id, accept }`. `migrate` calls `FR.accounts.migrate`.
05_money.js: after `FR.accounts.step`, `report.flows.accounts.bonus` (asks met this week) is added to revenue,
revContracts, net and cash; `report.flows.money.askBonus`.
06_market.js: `FR.market.SECTOR_NEWS[kind][sector]` — the wire line printed the week a swing starts (from the
`account:sector` event), e.g. "Banking budgets tighten; lenders pause new AI contracts."

K (first pass, `FR.accounts.K`):
- `field.rate` **0.25** (handoff first pass 0.35: customer-first won 30% on the 20-seed probe; lowered per §6).
- `meet` { renewMood 45, upMood 60, upSure 70, upOdds 0.5, coldAdd 10, warnAt [8, 4, 1] }; `dueWarn` 8 (the meeting opens).
- `ask` { chance 0.35, maxOpen 2, after 13, every 13, quiet 12, declineWeeks 2, weights { cap 35, inStep 25, peak 20,
  clean 20 }, bonusWeeks 4, metMood 10, missMood 15, declineMood 5, capAdd [[3,4],[4,5],[5,6]] by tier, capWeeks [8,16],
  stepGap 3, stepWeeks 8, stepSpare 4, peakShare [0.3,0.5], peakMin 3, peakLead [2,4], peakWeeks 8, cleanWeeks [13,26],
  costCut 0.15, costMood 10, costDecline 10 }.
- `sector` { every 26, hotChance 0.6, weeks [13,26], cooldown 26, hotWeight 3, hotFee 1.25, hotMood 1, hotTop 85, coldMood 1 }.
- `memoMax` 3.

Rules:
- Meeting: opens when a live contract has `dueWarn` 8 weeks left (event `account:meeting`, a 'due' line "X contract ends
  <date>. Mood 72. Renewal meeting open: Renew, Push up or Let go on the Serving floor. Unanswered, it renews at tier 1.");
  'due' lines again at 4 and 1 weeks left. Resolved in the step of `ends` (after this week's mood): 'go' → leaves, why 'let
  go', rests 52 weeks, no trust cost. 'up' → needs tier < 3, mood ≥ 60 (+10 cold) and the next tier's minimums now; mood ≥
  70 (+10 cold) goes up (PF scaled with scalePF, next tier's fee and length), 60-69 goes up on `rng.chance(0.5)`, else the
  same tier (memo says it declined). A push up that cannot happen falls back to Renew. Renew / unanswered / fallback →
  same tier and length, fee = fee(tier, next week), PF unchanged, if mood ≥ 45 (+10 cold); otherwise 'expired' with the
  reason in the memo. A renewal clears meeting, ask and `hot` (the renewed fee is the plain fee).
- Asks: a live account rolls `chance` when (turn − starts) ≥ 13 and is a multiple of 13, it has no ask, fewer than 2 asks
  are open and ends − turn > 12. The type is drawn by weight among types it can meet in time (cap: the projected skill cap
  at full training on that skill by due reaches the target; inStep: full safety for 4 weeks brings every gap ≤ 3; peak:
  free PF covers the book + onboarding + the amount; clean: no gap over the incident line; each needs its due ≤ ends − 12).
  In a cold sector the ask is always 'cost'. Checks run from the week after arrival: cap met the week the cap reaches the
  target, missed at due; inStep met at 8 consecutive weeks, missed once the weeks left cannot make it; peak missed on any
  week short in the window, met at due; clean met at due, failed by `shock()` on a lab incident; cost accepted by silence
  in the step of `declineBy`. Met: bonus × factor into this week's revenue, mood +10. Missed: mood −15 (below 30: leaving).
- Sectors: `nextAt` = unlock + 26, then every 26 weeks: 60% hot, else cold; nothing if that slot is taken; the sector is
  one not swinging and not within 26 weeks of its last swing's end; 13-26 weeks. Hot: its names weigh 3 in dealing, its
  offers carry fee × 1.25 (rounded to $1k) for the term, its live accounts served in full gain +1 more mood a week toward
  85. Cold: no offers dealt from it, its live accounts lose 1 mood a week while the lab is out of step, asks are 'cost',
  meeting thresholds +10. A swing past `until` ends with a memo line ("Banking budgets back to normal: offers resume.").
- Step order (§4): unlock → sector swings → service and mood (hot/cold drift; a.served, a.field) → asks → meetings at ends
  → churn (accounts marked leaving before this week) → go-live line → the board → new asks → meetings open / warnings.
  `shock()` after the ladder also fails open clean asks.
- Memo priority (at most 3 a week): p0 an account leaving (always one place, as V0.3) → p1 meetings (open, warnings,
  results) → p2 asks (arrived, met, missed, cost applied) → p3 sector swings → p4 go-live, mood-watch flags, the shock line
  → p5 the board.

Commands: `{ type: 'renewAccount', id, choice: 'renew'|'up'|'go' }`, `{ type: 'answerAsk', id, accept: true|false }`
(02_sim apply1 → FR.accounts). 99_main should wrap them as `FR.cmd.renewAccount(id, choice)` / `FR.cmd.answerAsk(id,
accept)` through `FR.cmd.do`.

Events: `account:meeting {id, name, ends}`, `account:renewed {id, name, tier, up}`, `account:ask {id, name, ask}` (ask =
the ask's type; `type` is the event's own), `account:askMet {id, name, bonus}`, `account:askMissed {id, name}`,
`account:sector {name, kind: 'hot'|'cold', until}`; `account:churned` why adds 'let go'.

Save migration (0.3 → 0.4, `FR.accounts.migrate` via `FR.sim.migrate`): `sectors` = { hot: null, cold: null, nextAt:
turn + 13 (0 while locked: set at unlock), last: {} }; every active account gets `meeting: null`, `ask: null`, `field: 0`;
a live account with fewer than 8 weeks left gets `meeting = { opens: turn, answer: null }`.

Balance tool: the bots answer meetings (Push up when `meetingView().up.chance > 0`, Renew otherwise, Let go below 45 only
when the board holds a qualifying offer at a better fee per PF) and asks (accept when `askView().onTrack`, else decline
inside the window). The summary line adds renewals (ups) and asks met / missed.

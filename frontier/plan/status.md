# Frontier — status (read this first every session)

- **Version:** 0.3.0.0 built and tested, not yet published (0.2.0.0 published 2026-09-28 is what the artifact and Pages serve)
- **Artifact URL:** https://claude.ai/artifact/AFXyxwEKHRKuKf9oMy5Ms5 (title "Frontier", label = version; republish dist/game.artifact.html to it)
- **Repo:** `Jxstrr0/AnthInc`, folder `frontier/`. Design: `docs/frontier-handoff-v0.1.html`. Contracts: `plan/contracts.md` (sim), `plan/contracts_ui.md` (HQ + UI).
- **GitHub Pages:** https://jxstrr0.github.io/AnthInc/ serves `/index.html` at the repo root = the last PUBLISHED build.
  On every publish, also copy `frontier/dist/game.html` to `/index.html` (never a work-in-progress build).
- **Build:** `node build.js` → `dist/game.html`, `dist/game.artifact.html`, `Frontier - V<ver>.html`
- **Tests:** `node test/run.js [name]` (node, sim) · `node tools/balance.js --seeds 20 [--noB]` (bot probe, five bots) · `NODE_PATH=$(npm root -g) node test/browser.js` (Playwright; `SECTION=boot|flow|floors|save|end|review|accounts`, `SKIP_SHOTS=1`; three.js served from `tools/vendor/`)
- **HQ reference:** the owner's Mogul game (artifact V8LMpKH1RBp2UTiFcz7m77). Local split copy in `.ref/mogul/src`
  (gitignored; rebuild with the Artifact read tool + the split script in the session notes if missing).

## Owner decisions (locked, 2026-09-27)
- HQ camera: **same as Mogul** — one floor at a time as a lit diorama, tap targets glide the camera, an elevator rides
  between floors (doors, LED count, chime).
- Rivals: **rhyming fictional names** — Opal AI, Entropic, DeepField, Zeta.
- After the 52-week safe frontier hold: **the run ends** (end-of-run sheet, then a new lab).
- Accepting an acquisition: **exit with a score** (not a win, not a death). Acquisition deals are back-burner in v1.
- Everything in the handoff §2 table.
- First visual pass (2026-09-28): owner kept the HQ look as built; sliders move by dragging the thumb only; elevator LED in board blue.
- Sim review calls (2026-09-28): late-game cash sink = the compute ceiling (rent cap and cluster sizes) grows each year;
  agents gaps bite harder (pressure weights incident odds and trust cost; gauge on the Safety floor); a lab with every safe
  within 5 of cap takes half the trust hit from rival incidents. Lead's calls: Series A dilution ~20-25%; DeepField share
  stays free to end.
- V0.3 extras (2026-09-28): a **company overview** sheet opened from a new dock button on any floor (09_ui_overview.js; each
  section's Open rides to the floor that manages it); sliders get **Undo** (back to this week's start) and **Default** (40/20/25/15).
- V0.3 build calls (2026-09-28): account names fully fictional sector names (30, straight tone); a churned account is gone
  for the run. Lapsed (unanswered) offers may come back on a later board; signed, declined and lost names never do.
- **Pending owner call: the sector raise.** Once the lab's Series B closes, every rival trains 48% faster from 13 weeks later
  (`FR.market.K.raiseLift` 0.48, `raiseLag` 13; set `raiseLift` 0 to remove). Added in the build because the B cash (at least
  10% of valuation, then ~$180M, now $150M) otherwise won balanced 95%, and a global rival speed-up killed the no-B path. The B offer and B
  milestone cards say so before the player decides. Rival pace `gainBase` 0.44 → 0.48 for accounts. Owner: keep or veto.
- Still to ask (handoff §7): first visual pass of the client wall (plaques, as built, vs a ledger board). Contact sheets:
  `test/shots/contact-clientwall-390.png` (reworked plaques, 390x844) and `test/shots/contact-accounts.png`.
- V0.3 review round, lead's calls (2026-09-28): a declined or expired buyer returns after 52 weeks (churned: never);
  B re-offer waits 13, then 26, then 52 weeks; a round's amount grows at most 25% past its base, then the stake sold falls
  below pctMin; the B milestone uses 8-week trailing revenue (×1.3 after a miss); renewals go one tier up only when the lab
  meets that tier (PF scaled with the tier); deals within trust reach (minTrust 45/48/52); book of 5 before the B (was 4);
  Series B $150M (was $180M); an account below 30 is off the book at once and always leaves the next week.
- Pending owner calls from the review round: (1) Series B timing: the B milestone ($400k weekly revenue) is met about 10
  weeks after the A (bots: week 31-35), so the funding track ends inside Year 1; keep, or raise bRevMin / require the A to
  have closed 26+ weeks? (2) Rival incidents cost every account 10 mood even when the lab is in step (trust is shielded,
  mood is not); keep −10, shield it, or change the copy? (3) The account era goes quiet once the book is full and renews
  itself: add a term-end decision, a drop option, sector-specific sensitivity, or leave it? (4) Keying the sector raise to
  the B closing still rewards a short delay a little (the late-B bot now wins 15% against 25%, so no longer an exploit).
- PR flow: one PR per milestone; the owner merges once the game builds, passes tests and is published.

## Build log
- 0.3.0.0 — Series B and the customer era (docs/frontier-handoff-v0.3.html). Series B ($150M, 10-20%) opens on a weekly
  revenue milestone (max($400k, 3× trailing 8-week revenue)) after the A; optional. Enterprise accounts (src/05b_accounts.js): unlock at avg
  cap 20 + trust 45, board of 1-3 every 8 weeks, tiers 1-3 (52/104/156 weeks, reserved PF, fee tier × $60k × (1 + 0.1 ×
  year)), mood/churn/renewal, max 5 live (6 after the B); fees count in revenue and valuation (+4× backlog). Two tier-2
  projects (Enterprise readiness work, Reference customer program). Serving floor client wall (plaques), Accounts section
  with Sign / Decline, serving readout split, HUD Cash chip split card, Series B in the Boardroom. Sector raise after the
  B (pending owner call, above). Slider Undo / Default buttons; company overview sheet. Same-week churns share one memo line.
  Tests: test/accounts.test.js, test/v03.test.js; browser SECTION=accounts; balance bot customer-first and --noB.
  Review round (37 sim/playtest/visual findings): capped late rounds, re-offer backoff, trailing B milestone and 0.2-save
  migration, trust-reach dealing, renewal PF scaling, name cooldown, leaving flag, one memo flush after shock, merged
  sign/decline and contract-live lines, Company dock button, readable plaques (mipmaps, name + mood bar), onboarding PF in
  the serving readout and offer warnings, received-vs-contracted rows, nextStep for a short book. Balance tool adds
  balanced-lateB under --noB.
- 0.2.0.0 — owner's V0.2 calls: an incident halves serving revenue for 3 weeks (FR.money.incidentFactor/underReview);
  'retire' command + Boardroom "Close the lab" (status 'exited', cause 'retired', no acquisition bonus); outlook 'watch'
  from gap 5 (model.K.watchGap); ±1/±5 nudge buttons on every allocation slider. test/v02.test.js.
- 0.1.0.0 — first playable. Sim: 5 modules (model/ladder, compute, money/rounds, market/rivals/news, projects ~20 templates),
  tuned with 4 bots (20 seeds: balanced wins 20-33%, race dies of the final incident ~week 76, safe/revenue-first stall).
  HQ: Mogul-style diorama, 9 floors, elevator, title tower. UI: HUD + frontier strip, floor panels, weekly memo, 3 careers,
  save codes, end-of-run score. Two adversarial review rounds: 27 sim findings + 37 playtest/wiring/visual findings fixed.
  Tests: node ALL PASS; browser boot/flow/floors/save/end/review ALL PASS.

## Owner answers after V0.1 (2026-09-28)
- Incidents cut revenue (done V0.2). Run end = Close the lab button (done V0.2). Warn colour from gap 5 (done V0.2).
  Slider nudge buttons (done V0.2). Not picked: founder-stake discount after a final incident; DeepField minimum fee.

## Back-burner (not v1)
- Rival deal types: distribution (Entropic), licence (Zeta), acquisition (Opal) — stubs only.
- Series C, IPO. Audio pack. Regions / jurisdictions (only if the market feels thin).
- V0.3 pitched, not picked: self-funded status (net positive 13 weeks ends milestones); pricing slider. Also: founding
  presets, career ledger and shared seed, first-week onboarding memo.

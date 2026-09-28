# Frontier — status (read this first every session)

- **Version:** 0.2.0.0 (published 2026-09-28)
- **Artifact URL:** https://claude.ai/artifact/AFXyxwEKHRKuKf9oMy5Ms5 (title "Frontier", label = version; republish dist/game.artifact.html to it)
- **Repo:** `Jxstrr0/AnthInc`, folder `frontier/`. Design: `docs/frontier-handoff-v0.1.html`. Contracts: `plan/contracts.md` (sim), `plan/contracts_ui.md` (HQ + UI).
- **GitHub Pages:** https://jxstrr0.github.io/AnthInc/ serves `/index.html` at the repo root = the last PUBLISHED build.
  On every publish, also copy `frontier/dist/game.html` to `/index.html` (never a work-in-progress build).
- **Build:** `node build.js` → `dist/game.html`, `dist/game.artifact.html`, `Frontier - V<ver>.html`
- **Tests:** `node test/run.js [name]` (node, sim) · `node tools/balance.js --seeds 20` (bot probe) · `NODE_PATH=$(npm root -g) node test/browser.js` (Playwright; `SECTION=boot|flow|floors|save|end|review`, `SKIP_SHOTS=1`; three.js served from `tools/vendor/`)
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
- PR flow: one PR per milestone; the owner merges once the game builds, passes tests and is published.

## Build log
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
- Rounds B and C, IPO. Audio pack. Regions / jurisdictions (only if the market feels thin).

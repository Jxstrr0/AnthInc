# Frontier — status (read this first every session)

- **Version:** 0.1.0.0 (pre-release, building v1)
- **Artifact URL:** not published yet (title "Frontier", label = version)
- **Repo:** `Jxstrr0/AnthInc`, folder `frontier/`. Design: `docs/frontier-handoff-v0.1.html`. Contracts: `plan/contracts.md` (sim), `plan/contracts_ui.md` (HQ + UI).
- **Build:** `node build.js` → `dist/game.html`, `dist/game.artifact.html`, `Frontier - V<ver>.html`
- **Tests:** `node test/run.js [name]` (node, sim) · `node tools/balance.js` (bot probe)
- **HQ reference:** the owner's Mogul game (artifact V8LMpKH1RBp2UTiFcz7m77). Local split copy in `.ref/mogul/src`
  (gitignored; rebuild with the Artifact read tool + the split script in the session notes if missing).

## Owner decisions (locked, 2026-09-27)
- HQ camera: **same as Mogul** — one floor at a time as a lit diorama, tap targets glide the camera, an elevator rides
  between floors (doors, LED count, chime).
- Rivals: **rhyming fictional names** — Opal AI, Entropic, DeepField, Zeta.
- After the 52-week safe frontier hold: **the run ends** (end-of-run sheet, then a new lab).
- Accepting an acquisition: **exit with a score** (not a win, not a death). Acquisition deals are back-burner in v1.
- Everything in the handoff §2 table.

## Build log
- 0.1.0.0 — scaffold: core (bus, rng, save codes), sim resolver, contracts.

## Back-burner (not v1)
- Rival deal types: distribution (Entropic), licence (Zeta), acquisition (Opal) — stubs only.
- Rounds B and C, IPO. Audio pack. Regions / jurisdictions (only if the market feels thin).

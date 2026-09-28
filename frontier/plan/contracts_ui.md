# Frontier presentation contract (HQ, UI, main) — binding for the presentation agents

Read with `plan/contracts.md` (sim state, commands, events). The presentation **ports the owner's Mogul game** (local
split copy: `/home/user/AnthInc/.ref/mogul/src/`, shell + CSS in `.ref/mogul/shell_head.html`). Mogul's APIs are the
model: keep their names and behaviour, swap the `MG` namespace for `FR`, the record-label content for the AI lab.
Owner's call: "Same 3D HQ as Mogul" — one floor in memory, lit diorama with wall cutaway, tap targets glide the camera
to a focus pose and open that floor's panel in a bottom sheet, an elevator rides between floors (doors, LED count, chime).

## Files and owners (no overlaps; the lead edits build.js ORDER)

| file | owner | ports from Mogul |
|---|---|---|
| `src/00_shell.html` | UI-A | shell_head.html (CSS tokens re-themed, markup) |
| `src/08_hq_world.js` | HQ-A | render/world.js + render/look.js + render/props.js (merged; `FR.r`, `FR.look`) |
| `src/08_hq_elevator.js` | HQ-A | render/elevator.js (`FR.elevator`) |
| `src/08_hq_title.js` | HQ-A | render/title.js (`FR.title`: the tower at night behind boot/menu) |
| `src/08_hq_floors.js` | HQ-B | render/floors/*.js (`FR.r.floors[id]`, all nine floors) |
| `src/09_ui_chrome.js` | UI-A | ui/chrome.js + ui/icons.js + the sheet/toast/LED parts of ui/hud.js (`FR.ui` base) |
| `src/09_ui_hud.js` | UI-A | ui/hud.js (top chips, bottom dock, hotspot router) |
| `src/09_ui_menu.js` | UI-A | ui/menu.js (boot, menu, new career, 3 career slots, save codes, settings, how to play, end-of-run sheet) |
| `src/09_ui_panels.js` | UI-B | ui/panel_*.js patterns (every floor panel + the weekly memo sheet) |
| `src/10_audio.js` | HQ-A | audio/synth.js (`FR.audio`, **off by default**, a settings toggle turns it on) |
| `src/99_main.js` | UI-A | 99_main.js (`FR.cmd`, boot, wiring, autosave, `FR.debug()`) |

Build ORDER: 01_core, 02_sim, 03..07, 08_hq_world, 08_hq_floors, 08_hq_elevator, 08_hq_title, 09_ui_chrome, 09_ui_hud,
09_ui_panels, 09_ui_menu, 10_audio, 99_main. three.js **r128** from
`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (a `<script src>` in the shell before `<!-- SCRIPTS -->`).

## Floors (`FR.HQ_FLOORS`, defined in 08_hq_world.js) bottom → top

| id | n | name | what it shows | panel |
|---|---|---|---|---|
| `lobby` | G | Lobby / Press | reception, news wall (latest wire lines on a screen), trust board, the street; press pack outside the glass after an incident | news feed, public trust, frontier record |
| `serving` | 1 | Serving | the product ops room: status wall, request graphs, rack row; dark + red strobe for 3 turns after any incident ("INCIDENT REVIEW": the sim does not pull the model, so the wall says serving continues under review) | Serving slider, revenue, demand vs serving PF, rent stepper |
| `training` | 2 | Training | the cluster hall: GPU racks whose lights scale with training PF, a run board showing the target skill | Training slider, target skill picker, per-skill capability bars, forecast gain |
| `safety` | 3 | Safety | evals lab: three skill screens (cap vs safe bars, gap colour), red-team corner | Safety slider, per-skill cap/safe/gap + outlook, incident history |
| `research` | 4 | Research | whiteboards, reading room, tier plaque | Research slider, points to next tier, the project offer board (greenlight here) |
| `proj1` `proj2` `proj3` | 5 6 7 | Project floor 1..3 | one per project slot: a war room themed by the project kind, progress board; empty = dust sheets and "Available" sign | the slot's project (progress, turns left, risk, payoff, cancel) or offers to greenlight into it |
| `boardroom` | 8 | Boardroom | long table, window wall over the city, valuation screen, rival wall (four logos) | tabs: Money (cash, burn, runway, round offer + milestone), Team (headcount, hire/lay off), Compute (capacity, rent, buy clusters, the DeepField deal), Rivals (table of four + the record) |

Every floor: `R.elevatorBank`, people as instanced/cheap figures scaled by the staff on that allocation
(`headcount × slider/100`, capped for performance), lights/activity scaled by that allocation's PF. Floors read
`FR.state` only; they rebuild or `refresh()` on `turn:ended` and `state:changed`.

Floor builder contract (same as Mogul): `FR.r.floors[id] = { build() → { group, elevator, light, update?(dt), refresh?(),
debug?(), view:{pos,look,fov}, targets:[Target], hint?, fitExtra?() } }`. `fitExtra()` returns extra world points a fitted room
view keeps on screen (the lobby's press pack while it is there; the floor calls `FR.r.refit()` when they change).
Room views: landscape fits the room into the HUD-safe rect; portrait keeps the hand-framed view unless a live target's box
falls off a side edge, then a lens shift (or a wider fov) brings every box in with room for its tag. Focus poses are
lowered until the object's top edge clears the chips and the frontier strip (at most 16% of the screen).
No renderer (three.js blocked, or `R.init` throws for want of WebGL): `FR.rStub(FR.r)` turns FR.r into the stub in place;
the elevator sheet then arrives at once and opens the floor's panel. Target ids route through `hq:hotspot` → `FR.ui.panel(id)`.
Hotspot ids: `<floorId>.<thing>` e.g. `training.board`, `boardroom.table`, `lobby.news`; `elevator` opens the elevator sheet.

## UI APIs (FR.ui)

- chrome: `FR.ui.sheet(html|null, id)` (modal: focus moves to the sheet body, the HUD is inert while it is up, focus returns
  on close), `FR.ui.toast(text, ms)`, `FR.ui.led(text)`, `FR.ui.show(screenId|null)`,
  `FR.ui.hud(on)`, `FR.ui.icon(name)` → inline SVG string, `FR.ui.kmoney(n)`, `FR.ui.refresh()` (HUD chips),
  `FR.ui.debug()`.
- panels (09_ui_panels.js): `FR.ui.panel(hotspotId)` opens the right sheet; `FR.ui.memo()` opens the weekly memo sheet;
  `FR.ui.panels.refresh()` re-renders the open sheet in place after `state:changed` (keep scroll position).
  `FR.ui.pressure(state) → { value, level, label, hue, text, pct, bands }` — the Safety gauge reading (levels
  ok | watch | warning | critical from `FR.model.pressureLevel`; the meter runs to the top band × 4/3). The Safety panel and
  the safety floor's incident-log screen both draw it. `FR.compute.maxRent(s)` must depend only on `s.turn` (the rent box
  asks it for next year's first week).
  Sliders: four linked sliders that always sum to 100 (moving one rebalances the others proportionally), shown on each
  allocation floor but it is the same `sliders` command. Show the forecast delta (`FR.sim.forecast`) next to each control.
- menu (09_ui_menu.js): `FR.menu.open()`, boot screen, main menu (Continue, New career, Careers, How to play, Settings,
  Credits), new-career form (lab name, slot), careers screen (3 slots: continue / delete with inline confirm / export code
  / import code into a slot), end-of-run sheet (`FR.sim.score`, the frontier record, cause) with "Found a new lab".

## HUD (09_ui_hud.js)

Top chips: **Week** (`Year 2 · Week 14`), **Cash** (with runway in weeks under it, warn colour < 13), **Trust**.
A thin **frontier strip** under the chips: your avg cap vs best rival avg cap, and the safe-hold streak `n / 52` once > 0;
when you lead with no hold running because a gap is above 5, "Blocked Agents 7" in the warn colour.
Chips and strip are taps: Week opens the memo, Cash the Boardroom Money tab, Trust the lobby trust board, the strip Rivals.
Bottom dock: **Elevator**, **Memo** (dot when unread), **End Turn** (primary, `FR.cmd.endTurn()`; disabled while riding).
A game menu button (top right): how to play, sound on/off, save and quit.

## FR.cmd (99_main.js)

```
newCareer({ labName, slot })   load(slot)   save()   quit()   exportCode()   importCode(code, slot)
do(command) → {ok, why}        // FR.sim.applyCommands on FR.state now, emit 'state:changed', toast on failure
endTurn()                      // FR.state = FR.sim.endTurn(FR.state, []); emit report.events, 'turn:ended'; autosave;
                               // open the memo sheet; on status won/dead → end-of-run sheet
goFloor(floorId)               // elevator ride (FR.elevator.cancel() stops one under way: menu, end screen and enterWorld
                               //   call it, so a ride never lands behind the menu or in the next lab)
```

## Look (re-theme from Mogul's espresso/red to Frontier's)

Single committed dark look (a game; no light theme), explicit colours on `:root` and `body`.
Tokens (replace Mogul's values, keep the token names so ported CSS works):
`--sunken #0a0e13` `--bg #0f141a` `--surface #171e27` `--raised #202a35` `--raised-2 #2a3642` `--line #3a4756`
`--line-strong #6b7c8f` `--ink #eef2f6` `--ink-2 #c5cfd9` `--ink-3 #97a5b4`
brand (board blue): `--brand #2d6aa8` `--brand-press #245a8f` `--brand-bright #4f93d9` `--brand-text #8ec0f2`
semantic: `--gold #e6c15a` (money) `--good #5fcf9a` (safety, gains) `--warn #f0a24a` `--bad #ef6b5b` `--info #9cc0ff`
capability colour = `--brand-bright`; safety colour = `--good`; gap = `--warn` above 10, `--bad` above 20.
Type (Google Fonts): display **Archivo** (600–800, use `font-stretch` 87.5% for headings), body **IBM Plex Sans**
(400/500/600), numbers and the elevator LED **IBM Plex Mono** (500). Tabular numbers everywhere digits line up.
3D palette: cool office materials (concrete, glass, graphite, pale ash desks), warm task lights, blue screen glow;
each floor gets its own light rig like Mogul's look.js. `<title>Frontier</title>`. Straight tone in all copy.

## Tests (the integrate step writes them)

`test/browser.js` (Playwright, Chromium at `/opt/pw-browsers`, never `playwright install`): sections by env var
`SECTION=boot|flow|floors|save`; boot → new career → 10 End Turns → every floor via elevator → open each panel →
save → reload → load → no console errors; screenshots at 390×844 into `test/shots/` combined into one contact sheet.

## V0.3 additions (built 2026-09-28)

- Serving floor: hotspot `serving.accounts` (client wall, one plaque per active account on one instanced mesh with one
  canvas texture; a churned account's plaque is dark for the week after it leaves, then gone). `FR.r.debug().floorDebug`
  reports `plaques`, `plaquesLit`, `plaquesDark`, `clients`.
- Floor 1 panel: serving readout "Serving N PF · N reserved for accounts · N open market" (`[data-fpres]`, plus "N PF short
  of the contracts" in red); Accounts section (`[data-focus="accounts"]`: Contracted / Reserved / Backlog, one `.fp-acc` row
  per account with a mood bar), offer board (`.fp-aoff[data-acc]`, three requirement rows from `FR.accounts.qualifies`,
  `[data-fp="sign"]`, `[data-fp="accNo"]` → confirm `[data-fp="accNoOk"]`), locked state with progress meters.
- Allocation card: `[data-fp="slUndo"]` (back to the shares the week started with) and `[data-fp="slDefault"]`
  (`FR.sim.K.startSliders`, 40/20/25/15), disabled when they would change nothing.
- HUD: once the lab has an account, `#hudCashChip` opens `#hudSplit` (open market / contracts last week, next week's
  forecast, `#hsMoney` → Boardroom Money); `FR.ui.splitOpen()`. A tap on the 3D view that closes it opens nothing.
- Boardroom Money: Series B in the rounds list like the A; contracted revenue, backlog and a yearly figure; the B offer and
  B milestone cards state the sector raise (`FR.market.K.raiseLift` / `raiseLag`) when it is on.
- Commands `FR.cmd.signAccount(id)`, `FR.cmd.declineAccount(id)`. Browser section `SECTION=accounts` with its own contact
  sheet `test/shots/contact-accounts.png`.

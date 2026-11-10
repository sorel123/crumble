# Crumble — project handoff

A browser puzzle game (Block Blast genre) built for my daughter. `index.html`
holds the markup and CSS and loads plain scripts from `js/` — no build step,
no bundler, no dependencies, opens straight in a browser (serve over http or
open the file directly; both work). Hosted on GitHub Pages and played on her iPhone as a home-screen web
clip.

Last updated 2026-11-10, after recorded music (plan PR 7.4), the journey sky, anticipation, combo fire, chase your best and the mascot crumb (7.5).

**Points (8.0):** every point is `SCORE_SCALE` (10) times the old number. Score-valued constants and thresholds are written `old*SCORE_SCALE` (config.js, render.js skin unlocks, Adventure score goals in modes.js). `migrateScale()` (save.js) rescales best, totals, Daily history and a saved run once, tracked by `crumble.scale`. Tests that set a score think in boosted points. Leaderboards (Game Center) must use this scale.

---

## Workflow

- One change per branch → PR → merge to `main`. GitHub Pages serves `main`.
- **Deploys reach the phone by themselves now** (service worker, below): open the
  game, and when a new version has downloaded an "Update ready — tap to refresh"
  toast appears on the start / game-over screens. Tap it. (Force-quitting still
  works. The first launch after this PR ships still needs one force-quit.)
- **Every PR that touches a game file must run `npm run stamp`** (rewrites
  `ASSET_HASH` in `sw.js`); `npm test` fails if it is stale. Without it phones
  keep the old cached game. Adding a new js file also means adding it to `ASSETS`
  in `sw.js` (a test checks the list matches `index.html`).
- Test on a phone-sized viewport (390×844, touch).
- **Automated tests:** `npm install` once, then `npm test` (Playwright, headless
  Chromium at 390×844). `tests/harness.mjs` serves the game, injects real pointer
  events, and reads state (`grid`, `tray`, `score`, `state`…) straight from the
  page's top-level bindings, so **no test hook lives in the game** — don't add one.
  Math.random is seeded. Scenarios are in `tests/run.mjs`: load, start, place,
  refused drop, line clear, game over, the drag rules (50 scripted drags, two
  fingers, cancelled touch, board edges, lift height), the frame budget (3-line
  clear, sliced deals, particle budget, `?dev` readout, caches), offline and update.
  The tray is dealt a few frames after a drop: `dealt(page)` waits for it, and
  `watchFrames`/`frameLog` record per-frame work from outside the game.
  `fingers(page)` in the harness gives real multi-touch (one pointerId per finger). Add a scenario there when you change a rule.
  A GitHub Action (`.github/workflows/test.yml`) runs it on every PR and on `main`.
  Chromium needs a one-time `npx playwright install chromium` locally.

---

## Ground rules

- **Plain script files, no bundler.** `index.html` + `js/*.js`, loaded in a fixed
  order with `<script src>` tags. No framework, no modules. Files share globals
  (no IIFE), so load order in `index.html` matters.
- Vanilla JS + canvas. Only external resource is the Fredoka font from Google
  Fonts, and it degrades fine if that fails to load.
- Audio: recorded CC0 sound effects and jingles from Kenney (kenney.nl), trimmed,
  normalized and embedded as base64 MP3 in `SAMPLES`. The original synthesized
  sounds are the 'Original' set (and the later bells 'Bells'), switchable under
  Settings → Sound.
- **No `strokeText` on the live canvas** — overlay text goes through
  `sprite()`/`blit()` (see the performance rule below).
- Every visual effect has an `FX_*` switch in `CFG` and respects
  `prefers-reduced-motion`. No event effect may draw over live board gems.
- `localStorage` is used, always inside `try/catch`:
  - `crumble.skins` — her look and sound choices, unlocked skins, discovered
    worlds (`saveSkinSave` / `loadSkinSave`, `lookV` for one-time migrations).
  - `crumble.dev.5` — Admin panel tuning overrides. Bump the key when defaults
    change so old saved tuning doesn't mask them.
  - `crumble.run` — the run in progress (`js/save.js`): `snapshot()` / `restore(o)`, written after every placement, when a deal finishes, after a rescue, on `visibilitychange` hidden and `pagehide`; removed at game over. The game reopens straight into it (no opening is dealt, no start card). `restore()` validates and returns false on bad data (then the normal start card shows). Golden hand, star, `starForced` and cooldowns are saved, and so are the bonus meter and a live bonus (trays left, points it added; plan 6.2); a live transformation is not (it ends on restore). Effects in flight are not saved. Undo (3.2) reuses `snapshot()`/`restore()` (both pure, no storage); `undo()` saves the run afterwards.
  - `crumble.hes` — the hesitation log (3.4): the last 60 trays' `{pick, place, clr}` (ms from the tray appearing to her first pickup, ms from the pickup that led to the first drop to that drop, whether it cleared). Recorded in the player build too; only shown with `?dev`.
  - `crumble.mode`, `crumble.adv`, `crumble.run.adv`, `crumble.run.daily`, `crumble.daily` (4.1) — the mode she was in (`endless` / `adventure` / `daily`), Adventure progress `{v:1, lv:{"7":{s:stars,p:fewest pieces,n:times cleared,f:failed tries}}}` (plain data on purpose: 4.2's goals and streaks extend it), and the Adventure level in progress. Each mode has its own run key (`runStore(mode)`), so switching modes never loses a game; `crumble.run` is still Endless.
  - `crumble.stats` — best score and lifetime stats (`games, lines, placed, sweeps, bestCombo, totalScore, bonuses`; `bonuses` is bonus runs earned, for 4.2's goals), loaded in `main.js` before `checkUnlocks()` so skins open from the saved best.

---

## Features at a glance

- 8×8 board, drag-and-drop with magnet snap (one finger, one landing rule — see plan 2.1 below), line-clear preview in the piece's
  colour, 37 shapes (`RAW`).
- Hand solver + tension wave (below) — every tray is fully playable in some order.
- **Obvious moves (3.4):** the dealer prefers hands where one or two pieces have an *obvious* clear (a line already 5-7/8 full whose gap is one plain run the piece drops into), and where the hand's smallest piece of 2+ cells has room (`OBVIOUS`, `OBVIOUS_MAX`, `ALT`; see Hand solver). Measured with `tools/bot-sim.mjs`.
- **Relaxed opening (3.1):** a new game does not start empty. `seedOpening()` (`solver.js`, called by `start()`) lays a seeded pattern, one or two nearly-full lines each missing a 2-4 cell gap, and deals a first tray the solver has verified: one piece completes a line in a single drop, and all three pieces are playable. So every game begins with an obvious clear (a test checks 100 seeded games). Plan 6.0: 2-4 gems are scattered outside the seeded lines, so that first clear leaves blocks; about 1 in 8 openings (`CFG.OPENING_SWEEP_CHANCE`) keep the board bare and can sweep. No special (golden hand, star, transformation, bonus) appears in trays 1-5 (`CFG.SPECIAL_FROM_TRAY`, 6).
- **Calm by default (2.3):** a clear below combo `BIG_COMBO` (3) is a squash, a point value on each cell and one praise word. COMBO slam, score orbs, COLOR GONE (band and bonus), fireworks, punch zoom and the combo edge glow start at combo 3. They stay individual toggles.
- **Specials, one switch each (4.5):** `CFG.SPECIALS = {bonus:true, star:true, golden:true, transform:true}`; `special(name)` reads it (the old `SPECIALS` master and `*_ENABLED` keys are gone). Each comes back on once it is rebuilt to be a real highlight: **the Blast Round was replaced by automatic bonus trays (6.2)**, **the star gem is back (4.5b)**, **the golden hand is back (4.5c)**; **transformations are back as achievements (4.5d)**. Admin (`?dev`) has a toggle per special. The shared rules live in `specialOk()` (`game.js`): never in trays 1-5, at most one live (`specialLive()`), never two in a row (`specialEnd`, the tray one last ended in; the next tray carries none). Later 4.5 PRs should gate on it.
- Clears: `'crumble'` (default since 7.5), `'squash'` or `'burst'` (Admin); Settings → Look → Advanced has "Clear effect" Crumble / Classic (= squash) and "Glints while dragging" (`FX_ANTICIPATION`, shown only when the game has it), saved as `clear` / `glint` in `crumble.skins` and live mid-run; per-cell point tags, COMBO slam
  with fireworks, praise words, score orbs, COLOR GONE bonus, clean sweep bonus,
  NEW BEST moment.
- **Golden hand (4.5c)** — the rarest, biggest special: a gold tray whose target lines glow on the board; finding it pays ×3. See the 4.5c section at the end.
- **Star gem (4.5b)** — a 1-cell piece that clears its row and column. Dealt only when a cross is worth it; see the 4.5b section at the end.
- **Achievements and transformations (4.5d)** — four named achievements, one per special, each unlocking a look for good: clean sweep = Rainbow, combo 5 (`TRANSFORM_COMBO`) = Volcano, a star clearing 10+ gems (`TRANSFORM_STAR_GEMS`) = Starfield, completing a golden hand = Gold Vault. See the 4.5d section at the end.
- **Journey sky (7.5b, Endless and Daily)** — the sky travels with the score (dawn → space) and every clean sweep jumps a stage with a whole-sky wipe. On by default; Settings → Look → Advanced has the switch (off = her chosen world). See the 7.5b section at the end.
- **Anticipation (7.5c)** — while she holds a piece, a line it could complete shivers and glints as she brings it near the landing. (It had a rising hum; Jay found it annoying and it was removed.) See the 7.5c section at the end.
- **Combo fire (7.5d)** — from combo 3 the board rim burns (hotter each step), the held piece sheds embers and the tray glows; a drop that does not clear snuffs it in a puff of smoke. Settings → Look → Advanced "Combo fire". See the 7.5d section at the end.
- **Chase your best (7.5e)** — in Endless a slim bar under the score fills toward her best, "N to beat" from 75%, a glow from 90%; passing it raises NEW BEST and jumps the journey sky a stage. Settings → Look → Advanced "Chase your best". See the 7.5e section at the end.
- **Mascot crumb (7.5f)** — a cookie crumb on the board's top-left corner nods, hops or smirks on clears, sweats when the board is tight and faints on game over. Settings → Look → Advanced "Mascot". See the 7.5f section at the end.
- **Timelapse (7.5g)** — the run replays on a small board on the game-over card in a few seconds; the share picture gets a four-board strip of the run. Settings → Look → Advanced "Timelapse". See the 7.5g section at the end.
- **Bonus trays (6.2)** — clears fill a small meter (the chip under the board); full, the next three trays pay ×2 automatically, with a violet sky, a pulsing rim and a `+N bonus` tag at the end. Nothing to tap. Replaced the Blast Round. See the 6.2 section at the end.
- **No Undo, no mid-run Rescue (plan 7.1):** the Undo button, the mid-run Rescue button and End run were removed. `snapshot()` / `restore()` in `save.js` stay: they are how save and resume work.
- **Stuck (plan 7.1):** when no tray piece fits, the pieces dim and "No moves" shows while the last drop lands; 700 ms later the run ends (`checkStuck()`). The game-over card carries the one rescue.
- **Pressure and recovery (6.1, Endless and Daily):** the dealer reads the *room* left on the board (`roomOf()`), not how full it is, and moves through phases: calm and building deal honest hands (no help), a cramped board is held on the edge for 2-3 trays, then a recovery hand she has to spot, and getting out earns guided relief trays. Losses are real now. See the 6.1 section at the end. Adventure keeps the old tension wave.
- **Rescues** — on game over (if the run is worth saving): one per run (`MAX_RESCUES`). `rescueAllowed()` is the single gate, so an ad can gate it later. A rescue deals a recovery hand
  (Endless/Daily; Adventure still gets the sweep/jackpot hand from `genRescue`) — she still has to find the play.
- **Look**: themes (Classic default, Night, Daylight, Cotton Candy, Mint,
  Paper), home worlds (10, each with an ambient effect), tile skins (Blocks
  default, Jewels, Clay; Candy/Glass/Neon/Pixel unlock by best score), motifs.
- **Look presets (4.3):** Settings opens on a grid of complete looks (`LOOKS` in `ui.js`: theme + world + skin + motif, each tile a little board drawn by `lookPreview`). Settings fits one 390×844 screen (a test checks it does not scroll); mixing theme/world/skin/motif one by one lives under **Advanced: mix your own**. No separate save: the chosen look is the four saved settings, and `currentLook()` lights the preset they match (none lit = she mixed her own). To add a look (4.5d's unlockable transformation looks), append a `LOOKS` entry; an optional `need()` returns a lock label (e.g. `'1600 pts'`) while locked, and the tile then shows it and cannot be picked. Neon is the example, locked until its skin is earned. Previews build lazily on first Settings open.
- **Settings** (player-facing, pauses the game): look + sound, saved as her
  defaults. **Admin** panel (all tuning sliders and test buttons) is reached
  from Settings' footer only when the URL has `?dev` (`CFG.DEV_MODE`).
- No ads, ever. Crumble is a family game; there is no ad code in the game.
- PWA: `manifest.json`, apple-touch icons, `viewport-fit=cover` with
  safe-area insets in the CSS and `layout()` (via the `#safe` probe).
  `tools/make-icon.html` regenerates the icons.

---

## How the code is organised

`index.html` loads these in order (the sections below follow the same order):

| File | Contents |
|---|---|
| `js/config.js` | `el` helper, `CFG` |
| `js/worlds.js` | `GEMS`, worlds, themes, ambient particles, flip |
| `js/shapes.js` | `RAW`/`SHAPES`, shared state vars, helpers |
| `js/solver.js` | solver, `genTray`/`genRescue`, praise, `updateDbg` |
| `js/render.js` | `layout`, tile renderers, `SKINS`, `buildCache` |
| `js/samples.js` | `SAMPLES` base64 MP3 data (~190 KB, data only) |
| `js/audio.js` | synth sets, recorded bank, `Sfx` |
| `js/music.js` | recorded music loops (`music/*.m4a`), picker, pressure response, ducking (7.4) |
| `js/game.js` | `place`, bonus trays, input |
| `js/draw.js` | `frame` and effects |
| `js/flow.js` | `gameOver`, `rescue`, `start` |
| `js/save.js` | `snapshot`/`restore`, run autosave, best + stats |
| `js/home.js` | the front menu's showpiece: gem logo, crumb, travelling sky (8.3) |
| `js/goals.js` | Goals card, unlock progress, play streak (4.2) |
| `js/modes.js` | Adventure levels, goals, map, mode menu, saved progress (4.1) |
| `js/ui.js` | persistence, unlocks, Settings |
| `js/admin.js` | Admin panel |
| `js/main.js` | boot |

Top to bottom:

1. **`CFG`** — every tunable constant, commented. Start here.
2. **`GEMS`** — six `{hue, saturation}` pairs plus a gold gem (golden hands
   only) and a prismatic star gem (star pieces only).
3. **Worlds and themes** — `HOME_WORLDS`, `TRANSFORMS`, `BONUS_WORLD`,
   `THEMES`, `applyTheme`, ambient particles.
5. **`SHAPES`** — 37 pieces parsed from ASCII art (`RAW`), plus `STAR`.
6. **The solver** — `packGrid` / `placeMasks` / `applyBits` / `evalHand`,
   `planSweep` and friends, `pickTier`, `genGolden`, `genTray`, `genRescue`.
7. **Layout + tiles** — `layout`, the tile renderers (`blockTile`,
   `jewelTile`, `clayTile`, the unlockable and event skins), `SKINS`,
   `MOTIFS`, `buildCache`.
8. **Audio** — `buildChain` (buses), the synth sets, the recorded bank
   (`SAMPLES`, `smp`, `recordedSet`), then the `Sfx` dispatcher.
9. **Game logic** — `place`, `linesFor`, `mobility`, `triggerTransform`.
10. **Bonus trays** — `chargeBonus`, `startBonus`, `endBonus`, `drawBonusRim`.
11. **Input** — pointer handlers, `ghost`, the magnet.
12. **Draw** — `sprite`/`blit` text cache, then `frame`, the render loop,
    drawn in layers.
13. **Flow** — `gameOver`, `rescue`, `start`.
14. **Persistence** — skins/worlds/look save and unlocks.
15. **Settings** (player) and the **developer/Admin panel** (`DEV_TOGGLES`,
    `DEV_SLIDERS`, …, saved to `crumble.dev.5`).

---

## Change log

| PR | What |
|---|---|
| #1 | Juice pass: burst clear, score orbs, landing thump, pickup grow, line preview |
| #2 | Blast Round |
| #3 | Block Blast's beat: squash clear, COMBO slam, COLOR GONE, Classic theme, Blocks skin |
| #4 | iPhone slowdown fix: text sprites instead of per-frame `strokeText` |
| #5 | Kid feedback: magnet snap, Classic + Blocks default, guided hands |
| #6 | Magnet tune: seats only near the slot, tighter finger tracking |
| (1.2) | Playwright harness (`tests/`) + GitHub Action; no game changes |
| (1.3) | Player build: Admin only with `?dev`, tension readout off, ads removed, both rescues free |
| (1.4) | Service worker (`sw.js`): offline launch, versioned cache, "Update ready" toast (`js/update.js`) |
| (2.1) | Drag rewrite: one finger, one landing rule, piece seated or exactly at the finger, bottom-anchored lift |
| (2.1b) | Drag glides: piece always exactly at the finger, a ghost marks the landing slot (seating was "sticky, jumpy" on the phone) |
| (2.2) | Frame budget: next tray dealt in slices after the clear, particle budget follows frame time, `?dev` frame readout, cache churn fixes |
| (2.3) | Calm clears: everyday clears are a squash + point tags + one praise word; slam, orbs, COLOR GONE, fireworks, punch zoom from combo 3 (`CFG.BIG_COMBO`); `CFG.SPECIALS` (default off) pauses golden hands, star gems, transformations and Blast Round |
| (3.1) | Relaxed opening: seeded opening board + verified first tray (a clear within the first move); no special in trays 1-5 (`SPECIAL_FROM_TRAY`); Blast meter, idle drain and auto-start removed |
| (3.3) | Save and resume: `js/save.js` (`snapshot`/`restore`, autosave, `crumble.run`), best score and lifetime stats persisted (`crumble.stats`), `clearRunFx()` split out of `start()` |
| (3.2) | Undo and a mid-run Rescue button (both removed in 7.1) |
| (3.4) | Dealer for obvious moves: `OBVIOUS`/`ALT` hand scoring, hesitation log in the `?dev` readout (`crumble.hes`), `tools/bot-sim.mjs` |
| (4.5a) | Blast as a tap-to-start reward: combo-charged `⚡ Blast` button, own sting/look/3-2-1, results card, Best Blast; per-special flags `CFG.SPECIALS.{blast,star,golden,transform}` and `specialOk()`; a live round survives save/resume |
| (4.5b) | Star gem rebuilt: dealt only when a cross is worth it (`starBest`, `STAR_MIN`), cooldown, beam in the tray + hint ring + drag count, charge-then-beams clear with star sparkles, per-gem points, own sounds, Blast button held while it is in the tray |
| (4.1a) | Adventure: 30 goal levels on a map (no timer), mode menu, one saved run per mode, `rnd()`/`seeded()` seam for seeded dealing, `tools/adventure-sim.mjs` |
| (4.1b) | Daily: date-seeded opening and trays, results calendar, third mode in the menu; Adventure/Daily scores no longer leak into the saved best |
| (6.0) | Opening no longer sweeps on move one: 2-4 scattered gems outside the seeded lines, and about 1 in 8 openings keep the board bare (`CFG.OPENING_SWEEP_CHANCE`); the opening test counts sweeps |
| (6.4) | Audio routing: the Original synth chain has its own speaker filter (`ohp1`/`ohp2`, set by `setSpeaker` with the other pair), so phone-speaker mode cuts its bass too; `ORIG_SFX.pickup/place` take the Admin volumes (`SND_PICKUP_VOL`, `SND_PLACE_VOL`). `PHONE_SPEAKER` defaults on for touch devices (`speakerDefault()`, run in `ac()`) unless a choice is saved: `crumble.speaker` (written by the Admin toggle) or `PHONE_SPEAKER` in `crumble.dev.6` |
| (6.2) | Bonus trays replace the Blast Round: a clear meter, then ×2 for the next 3 trays, automatically; Blast's button, timer, results card, big-piece hands and `canBlast` gating are gone. See the 6.2 section |
| (6.5) | One sound family: an arbiter in `audio.js` gives each moment one main sound (priority, ducking, deferral); every clear has a dry impact under its glass tail; narrow escape (`Sfx.phew`) and NEW BEST / LEVEL CLEARED (`Sfx.fanfare`) are their own events; the Strings set, soft pickup tick and drop click are the default for everyone once (`sndV`). Section at the end |
| (6.1) | Pressure and recovery: `roomOf()` measures room on the board; phases calm/building/edge/recovery/relief pick the tray (`paceTier`); honest trays return, edge trays only promise each piece a spot, recovery is a sequence she must see; the second rescue is earned; strong bot added to `tools/bot-sim.mjs`. See the 6.1 section |
| (6.6) | Pressure on screen: one eased `scr` layer (sky wash, vignette, board rim, tray band, relief flash) driven by the room metric and phase in Endless/Daily. See the 6.6 section |
| (7.3) | Payoff waves, setups and closers (Endless/Daily): a payoff tray every 4-6 trays, the exact piece for a hole she squared off, earned closers (planned sweep, tray shimmer), no three-small-piece trays. See the 7.3 section |
| (8.2) | More clearing hands (Endless/Daily): payoff every 3-5 trays, a behind-the-scenes jackpot hand (3+ lines) every 8-12, the tray before a payoff builds toward it, a queued golden hand waits out a bonus instead of being lost. See the 8.2 section |
| (7.5b) | Journey sky (Endless/Daily): the sky travels dawn, day, golden hour, night, aurora, space as the score climbs; a clean sweep jumps a stage; stage changes wipe down the whole sky. See the 7.5b section |
| (7.5c) | Anticipation: a line the held piece can complete shivers and glints as the piece nears that landing. See the 7.5c section |
| (7.5d) | Combo fire: from combo 3 the rim burns hotter each step, the held piece sheds embers, the tray glows; a miss snuffs it in a puff. See the 7.5d section |
| (7.5e) | Chase your best: a bar under the score fills toward her best; passing it raises NEW BEST and jumps the journey sky a stage. See the 7.5e section |
| (7.5f) | Mascot crumb: a crumb on the board's corner reacts to clears (sized by the 6.3 hierarchy), sweats when it is tight, faints on game over. See the 7.5f section |
| (7.5g) | Timelapse: the run's boards are recorded with the save (capped) and replay on the game-over card; the share picture shows four of them. See the 7.5g section |
| (8.3) | Front menu showpiece: the start card and the mode menu share one look (gem logo in her skin, the crumb, the journey sky travelling behind, a 2x2 of mode tiles). See the 8.3 section |
| (1.1) | Split `index.html` (365 KB) into `index.html` (12 KB) + `js/*.js`; no behaviour change |

Details for each, oldest first:

---

## The juice layer (2026-10-30, PR #1)

> Partly superseded by PR #3: the default clear is now `'squash'` with no blink.
> The blink → pop → chunk timeline below is still there as `CLEAR_STYLE: 'burst'`.

The feel pass that chases Block Blast's snappiness. All of it is in `place()`
and `frame()`, every piece has an `FX_*` switch in `CFG` (and the Admin panel),
and all of it respects `prefers-reduced-motion`.

**A line clear is now a timeline, in frames** (`CLEAR_BLINK`, `CLEAR_STAGGER`):

1. The whole line blinks white in unison (on 3, off 2, on) — about 7 frames.
2. Each gem pops (swells 40%, whites out) with a delay proportional to its
   distance from where the piece landed, so the pop radiates outward.
3. On popping, the gem becomes a **chunk** — a whole rounded block in its colour,
   flung away from the placed piece, tumbling and shrinking, gone in ~half a
   second — plus three white specks. (The old triangular shards are gone.)
4. Shake, punch zoom, the light sweep, the line flare, the score popup and the
   sound all wait for the blink to end (`hitWait`), so they hit on the pop.

**Score orbs** (`FX_SCORE_ORBS`): every cleared gem sends a glowing orb on a
bezier to the score counter (`stepOrbs`). The HUD number holds (`scoreHold`)
until the first orb lands, then counts up fast and bumps (`.score.bump`, CSS).

**Placement** (`FX_LAND_BUMP`): a landed piece squashes wide-and-short and
springs back over ~8 frames (`g.l` on the cell), with a spreading outline ring
and a little sideways dust. **Pickup** (`FX_PICKUP_GROW`): the piece grows from
tray size to board size and lifts over ~5 frames (`drag.g`), then stays rigid.

**Line preview** (`FX_LINE_PREVIEW`): lines the held piece would clear light up
in the piece's own colour, under and (additively, faintly) over the gems in it.

**Praise** starts at combo ×2 now (was ×3). **Point popups** are ~45% bigger,
slam in with overshoot and are gone in ~1.3 s.

**NEW BEST!** fires the moment a run passes the old best (once per run,
`bestBeaten`): banner, confetti, rings, and the Best counter then follows live.

**Banners are a real queue** — only the head runs, the next starts when it is
nearly gone. (Before, "CLEAN SWEEP" and "RAINBOW" drew on top of each other.)

Board: empty cells are a little brighter with a shallow inset shadow, so the
grid reads at a glance.

Tune first: `CLEAR_BLINK` (lower = snappier, 0 = no blink), chunk speed/gravity
in the `chunks` loop, `ORB_MS` (orb flight time).

---

## Kid-feedback pass (2026-10-30 night, PR #5) — "doesn't snap, blocks aren't solid, too much work"

- **Magnet snap** (`FX_MAGNET`): the held piece is drawn at `drag.mx/my`, which
  glides to the slot it will land in and back to floating above the finger when
  it leaves; the lift shadow fades as it seats (`drag.snapK`). This is the single
  biggest feel change — Block Blast does exactly this.
  **Retuned in PR #6** ("sticky, doesn't move"), then **replaced in plan 2.1**
  (below): one landing rule, no ghost when the magnet is on, no lerp on the finger.
- **Solid blocks**: `blockTile` is now edge-to-edge (pad 0, hairline seam), board
  slots nearly gap-free (`p = cell*.025`). Defaults are now **Classic + Blocks**;
  `lookV:2` in the skin save migrates every phone to that once (Settings still
  changes it; Night + Jewels remain selectable).
- **Guided hands** (`GUIDE`): `evalHand` now also reports `imm` (most lines one
  piece can clear *right now*, no sequence) and `immPieces`. Hand scoring adds
  `GUIDE*(imm*9 + immPieces*5 + 3 per 5+ cell piece)`, and the early-break wants
  `imm>0`. `TIER_SOLVABLE` is 0 (no 'honest' tier any more), `TIER_JACKPOT` 0.30.
  On random 40%-full boards: hands with an immediate clear went 55% → 85%,
  ~5.5 ms per tray.
- Every clear gets a word now (`PRAISE[0]` = GOOD!/NICE!, smaller, no sound)
  and one firework; a combo still gets the slam.
- Perf: the sky gradient is cached per colour pair (`skyFill`) and the board
  glow is a cached half-res radial sprite (`glowSprite`) — the two full-screen
  gradients that were rebuilt every frame are gone.

---

## Performance rule: no `strokeText` on the live canvas (2026-10-30, PR #4)

The first version of the celebration drew ~30 outlined texts per frame and the
iPhone crawled. iOS Safari re-strokes glyph outlines on every `strokeText`, so
**every overlay word is now a sprite**: `sprite(key,w,h,draw)` rasterises it
once (strokes, gradients, all) into its own canvas and `blit()` draws it each
frame with scale/rotation/alpha. `outlined()` and `vgrad()` are the helpers used
inside `draw`. The cache (`SPRITES`) is cleared on relayout and capped at 160.
If you add a new word to the screen, build it this way. Fireworks are plain
squares for the same reason, and the particle count is capped.

---

## Matching Block Blast's beat (2026-10-30, PR #3, from a 60 fps screen recording)

Measured from Jay's recording of Block Blast (frames in `tools/` are not kept;
the numbers are what matter):

- Drop → the whole line squashes into a thin glowing bar and is gone in
  **~100 ms**. No blink, nothing flies. The celebration happens *afterwards*,
  over the already-empty cells.
- +150 ms: a point value appears on every cleared cell; small square sparkles.
- +450 ms: a huge yellow **Combo N** slams in (oversized, settles), fireworks
  (yellow / green / pink / blue fountains), "Great!" above it, "2 Colors Gone!"
  banded across the middle. Hold 0.5–1.2 s each, then zip out. Board border
  flashes pink on big combos.
- The score ticks up slowly for ~2 s.
- The hover preview is loud: the whole line, existing blocks included, turns
  solid piece-colour with a glow outline.
- Big pieces constantly (3×3, 2×5, wide Ls); the board is kept open for them.

What changed to match:

- `CLEAR_STYLE: 'squash'` (the default until 7.5's crumble) — each cleared gem thins to a white-hot
  sliver along its line (`horiz` on the shatter decides the axis) over 6
  frames; `CLEAR_BLINK` default 0; `CLEAR_STAGGER` 0.35. `'burst'` keeps the
  flying blocks from the first juice pass.
- `FX_CELL_TAGS` — the per-cell point tags (`tags`).
- `FX_COMBO_SLAM` — "COMBO n" headline (`slams`) at `by+B*0.66`, fireworks
  (`spawnFirework` → `bursts`, with a `wait`), `borderFlash` on combo ≥3. The
  "+N" popup moved to the board's top-right so it stays clear of the slam.
  Praise word sits at `by+B*0.27`.
- **COLOR GONE** (`COLOR_GONE_BONUS` per colour): a clear that removes the last
  gems of a colour pays a bonus and shows a band (`bands`) at `by+B*0.46` with
  the words in the lost colours. Skipped on a clean sweep (that's the bigger
  moment). Colours are counted after the piece lands, before the clear.
- Hover preview: gems already in a would-clear line are recoloured solid in
  the held piece's colour with a gloss and a glowing outline; the ghost is 90%.
- Score count-up slowed (9% of the gap per frame) so it ticks through the
  celebration.
- **Classic** theme (steel-blue sky, navy board, `whiteInk` → Night's white UI
  on a light sky) and **Blocks** skin (`blockTile`: flat face, light top-left
  bevel, dark bottom-right bevel, gloss). Both selectable in Settings. (PR #5
  then made Classic + Blocks the default.)

---

## Blast Round (2026-10-30, PR #2) — REMOVED in 6.2, kept as history

> Everything about Blast (this section and "Blast as a tap-to-start reward" below) is gone from the code; see "Bonus trays (plan 6.2)" at the end.

The bonus round, and the answer to "I want chains built to clear the board,
with big pieces, and a reason to move fast."

- **Started by her (plan 4.5a, see the end of this file).** The old meter filled with clears and drained after
  `METER_IDLE` ms of thinking (removed in 3.1); now combos charge the `⚡ Blast` button and she taps it.
- **`startBlast()`**: look flips to the `blast` world (hot magenta,
  sparks) with the rainbow skin, banner, confetti, the leftover tray is
  replaced by a blast hand, and a timer starts at `BLAST_SECONDS`. Each line
  adds `BLAST_ADD` s (a sweep +5 s), capped at the start length. Points
  ×`BLAST_MULT`.
- **Blast hands** (`genTray`, `if(blast)`): a planned sweep if one can be
  built (no cooldown), else `pickHand('jackpot')` in `bigMode` — the crowd
  penalty nearly off, 5+ cell pieces ×2.5 in the draw, 60 candidates, and a
  per-cell bonus in the hand score so the chunkiest *playable clearing* hand
  wins. If no big hand is playable it falls back to a normal jackpot hand.
- **Ends** when the timer hits 0 (`stepBlast`): the results card (4.5a; was a "BLAST OVER" banner),
  look flips home (or back to a live transformation). Game over kills it
  silently. No golden hand, star, or transformation can start during a round;
  a round can't start while a transformation is live.
- Admin panel: "Fill Blast" and "Blast Round" buttons; sliders for all of the above.

Also in this pass: `TIER_SOLVABLE` 0.20→0.15 and `TIER_JACKPOT` 0.50→0.40
(helpful hands come sooner — since lowered again in PR #5 to 0 / 0.30), and `BIG_CAP` — the crowded-board small-piece
bias stops growing past 4 cells, so 5–9 cell pieces keep showing up in normal
play too. Empty cells and the coloured line preview were dimmed from the first
juice pass (too bright on the phone).

---

## The two non-obvious systems

### Hand solver

Tray pieces are not picked independently. `genTray` generates candidate hands,
scores each with `evalHand`, and serves the best fit for the current tier.

`evalHand` packs the board into a bitboard (two 32-bit ints, rows 0-3 and 4-7) and runs DFS over **all six
orderings** of the three pieces and every legal position, **applying line
clears between placements**. That's the important part — it finds hands that
only work in one specific sequence (piece 1 clears a row, which opens the space
piece 2 needs, and so on). Node-budgeted via `CFG.NODE_BUDGET` so it can never
stall a frame.

Baseline guarantee: all three pieces are playable in some order. The old
version only guaranteed one piece fit, so you could burn two and be stuck.

### Tension

> Since plan 6.1 this wave only deals Adventure. Endless and Daily use the room metric and phases (6.1 section at
> the end); there `tension` is just a display value (1 − room, eased) for the board's border glow.

A 0–1 value that rises when you place without clearing (and as mobility drops),
falls when you clear. `pickTier` maps it to what you get served:

| tension | tier | meaning |
|---|---|---|
| ≥ `TIER_SOLVABLE` (0) | solvable | two or more clears reachable |
| > `TIER_JACKPOT` (0.30) | jackpot | three or more clears reachable, favors emptier boards |
| > `TIER_SWEEP` (0.85) | sweep | try to build a board-emptying hand (when off cooldown) |

With `TIER_SOLVABLE` at 0 there is no 'honest' tier any more — every tray can
clear something. On top of the tier, `GUIDE` favours hands with a piece that
clears a line *right now* (see the kid-feedback pass). During a Blast Round the
tiers are bypassed (`bigMode`).

History: retuned 2026-09-24 for ebb and flow (`TENSION_UP` 0.10, `TENSION_DOWN` 0.30): measured
with bot players, a strong player now sees ~48% honest / 38% solvable / 10% jackpot
trays instead of ~75% jackpot, while a struggling player still gets jackpot help on
~40% of trays. Golden hands and star gems are each ~1 in 33 trays, and neither is
dealt while a transformation is live (one spotlight at a time).

**Clean sweep** hands are built backwards, not found by random search:
`coverAll` picks rows/columns covering every gem on the board, `targetCells`
takes their empty cells as a target, `tileExact` tries to tile that target with
up to three shapes, then `evalHand` verifies before it's served. Falls back
silently if any step fails. Gated by `SWEEP_COOLDOWN`.

**Obvious moves (plan 3.4).** `evalHand` also returns `obvPieces`, the number of pieces with an obvious clear,
and `alt`, the legal spots (capped at 8) for the hand's smallest piece of 2 or more cells. An obvious clear completes
a line that already had 5-7 of its 8 cells filled with its empty cells in one single run (`RUN_OK`,
`obviousLines()`), so the gap is one plain slot the piece drops into; a clear that needs cells scattered along the
line, or a half-empty line, is not obvious. `pickHandSteps` adds `OBVIOUS × min(obvPieces, OBVIOUS_MAX) + ALT × alt`
to every playable hand (`GUIDE` is unchanged), and its early stop wants one obvious piece, not just any clear.
`OBVIOUS_MAX` (2) is the guard against over-generosity: one or two easy moves a tray, not three. Singles are left
out of `alt` so it does not fight `SINGLE_WEIGHT` by rewarding dots.

**Measure dealer changes with `tools/bot-sim.mjs`** (`node tools/bot-sim.mjs [trays] [seed] [KEY=value …]`, the
overrides go into `CFG`, so `OBVIOUS=0 ALT=0` is the dealer before 3.4). A bot that plays an obvious clear when one
exists, else the biggest piece where it sits most flush, plays the real game; trays are bucketed by board fill when
dealt. It reports, per bucket: obvious clear available at deal, what the board allows (any shape), 2+ obvious
pieces, all 3 obvious (too generous), clear per tray, clears per tray; and median fill and deal cost overall.
Measured at 3.4 (seeds 2-4, 4000 trays each, before = `OBVIOUS=0 ALT=0`, averages of the three):

| fill | obvious at deal | board allows | 2+ obvious | all 3 obvious | clear / tray |
|---|---|---|---|---|---|
| 30% | 64% → 65% | 67% → 65% | 39% → 50% | 13% → 14% | 93% → 93% |
| 45% | 92% → 94% | 95% → 95% | 69% → 81% | 32% → 35% | 99% → 99% |
| 60% (~55 trays) | 100% → 100% | 100% | 93% → 95% | noisy | 100% |

Median board fill 34% before and after, 1.46 clears per tray before and after. Deal cost (desktop Chromium)
median 3.9 → 4.0 ms, p95 6.6 → 6.7 ms; a rare deal (a sweep plan) takes ~50 ms before and after, spread over
frames by `stepDeal`. The plan's "80% at 45% fill" already held before 3.4; the dealer gets nearly everything the
board allows, so at low fill the board is the limit (see the next lever under the 3.4 notes).

A debug readout (top-left, under the score) shows live tension and the tier
just served. Off by default (`CFG.SHOW_TENSION: false`); Admin can turn it on.

---

## Current state

Everything in "Features at a glance" works on her phone. The last several
passes were driven by her feedback: it should snap, feel solid, and be
relaxing rather than work. Open questions from that:

- Does the drag snap now (plan 2.1)? `MAGNET_REACH`, `MAGNET_HOLD` and `LIFT`
  are the knobs.
- Is guided dealing too generous now? Watch the debug readout; if every tray is
  a gift, lower `GUIDE` or raise `TIER_JACKPOT`.
- The opening (3.1): does the first move feel like a gift or like the game is
  playing itself? The pattern is in `seedOpening()`.

---

## Tasks, in the order I'd do them

Done since the first handoff: safe-area insets, PWA wrapper, rescues.

### 1. Save / resume + best score

Thin `Save` wrapper, same pattern — one place to change, and
it should no-op cleanly when storage is unavailable rather than throwing.

Persist on every placement: board, score, combo, tension, sweepCool, tray,
rescuesUsed, golden/blast/transformation state (or simply end those on
resume). Separately persist `best` — it currently resets every launch, which
also means skin unlocks only count the current session's best. On load, resume
automatically (she wants auto-resume, not save slots). Must survive a
force-close, so write on `visibilitychange` too, not only on placement.

### 2. Mid-run "stuck" rescue button

Rescues exist on the game-over card only. Add the mid-run version: dimmed
until genuinely out of moves, then spends a rescue the same way.

### 3. The iPhone app (Capacitor, plan 5.1 to 5.3)

The `ios/` folder is the Xcode project (Capacitor 8, Swift Package Manager, no CocoaPods). Bundle id
`win.crumble.app`, iPhone only, portrait only. The web build stays the development build; the app wraps the
same files.

```
npm ci
npm run build:www && npx cap sync ios     # after any change to js/ or index.html
npx cap open ios                          # or xcodebuild -project ios/App/App.xcodeproj -scheme App ...
```

Native code of our own lives in `ios/App/App/GameCenter.swift`: `MainViewController` (Capacitor's bridge,
registering our in-app plugins) and `GameCenterPlugin`. JS calls it through `js/native.js`.

#### Game Center (plan 5.3)

Quiet by design: no sign-in sheet at launch and no new buttons. If the phone is signed in to Game Center, the
app sends the Endless best (after every Endless game and at launch), today's Daily score (after every Daily),
and every goal rung reached (as achievements). People see them in Apple's Games app. If not signed in, nothing
is sent and the game is unchanged.

Sign-in is checked at launch, again whenever the app comes back to the front, and whenever Game Center
reports a change (signed in or out in Settings). A new sign-in sends everything again, in case it is another
player.

One-time setup (needs Jay's account; ids must match `GC` in `js/native.js` exactly):

1. App Store Connect: create the app record for `win.crumble.app` (Apps, +, New App).
2. Make the 2 leaderboards and the 32 achievements (one per goal rung, 910 points) with the script:

   ```
   node tools/gc-setup.mjs --dry-run      # lists every id, name and point value
   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_FILE=~/AuthKey_XXXX.p8 node tools/gc-setup.mjs
   ```

   The key comes from App Store Connect, Users and Access, Integrations, App Store Connect API (role App
   Manager); keep the .p8 out of the repo. The script reads the goal names from `js/goals.js` and skips ids
   that already exist, so it can be re-run after goals change. Achievement images are not uploaded; Apple only
   needs them for App Store review, not for TestFlight.
   By hand instead: Features, Game Center: a Classic leaderboard `crumble.endless.best`, a Recurring one
   `crumble.daily` (1 day), both integer, high to low, best score; then the achievement ids the dry run lists.

Until those exist, the calls fail quietly (they are caught) and nothing shows.

#### Icon, splash, signing and TestFlight (plan 5.4)

The app icon is `tools/make-icon.html` at 1024 px (alpha removed, as Apple requires); the launch screen is the
game's background `#150B26` with the same three gems, and `capacitor.config.json` uses that colour too, so
there is no black flash between the launch screen and the game. Change the art in `make-icon.html`, then
replace `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and the three `Splash.imageset`
files.

First TestFlight build (Jay at the Mac, once):

1. `npm ci && npm run build:www && npx cap sync ios && npx cap open ios`
2. Xcode, target App, Signing & Capabilities: tick "Automatically manage signing", pick Jay's team. Check that
   the Game Center capability shows (it comes from `App.entitlements`).
3. Each upload needs a higher build number: General, Identity, Build (1, 2, 3...). Version stays 1.0.
4. Device menu: Any iOS Device (arm64). Product, Archive. In the Organizer: Distribute App, App Store
   Connect, Upload.
5. App Store Connect, the app, TestFlight: once the build finishes processing (export compliance is
   already answered by `ITSAppUsesNonExemptEncryption` in Info.plist), add an Internal Testing group with the family's
   Apple IDs (they must be users on the team), and they install through the TestFlight app.

**If this is ever aimed at kids officially:** COPPA and Apple's Kids Category rules apply: no behavioural
ad targeting, limited analytics.

### Release checklist (before anyone but her plays it)

- Nothing to flip: Admin needs `?dev` in the URL, and the debug readout is off by default.

---

## Tuning quick reference

| Knob | Does what |
|---|---|
| `ROOM_OK` / `ROOM_EDGE` | (6.1) where calm ends and the edge starts, in room (0-1) |
| `EDGE_HOLD_MIN/MAX` / `RECOVERY_TRIES` / `RELIEF_TRAYS` | (6.1) how long the edge holds, how many tries at a way out, how long the relief lasts |
| `HONEST_TRIES` / `BUILD_BIAS` / `GIFT_CHANCE` | (6.1) how light an honest hand is (the main difficulty knob), big pieces while building, guided hands in calm |
| `TENSION_UP` / `TENSION_DOWN` / `TENSION_DRIFT` | (Adventure only) how fast the difficulty wave swings |
| `TIER_SOLVABLE` / `TIER_JACKPOT` / `TIER_SWEEP` | where each help tier kicks in |
| `GUIDE` | favour hands that can clear right now (0 = off) |
| `SWEEP_COOLDOWN` | how rare clean sweeps are |
| `CANDIDATES` / `NODE_BUDGET` | how hard the solver thinks (slower = smarter) |
| `SMALL_BIAS` / `BIG_CAP` | small-piece bias on a crowded board, and where it stops growing |
| `TIDY` / `PAIR_CHANCE` | favour compact boards / partner pieces for awkward shapes |
| `MAGNET_REACH` / `MAGNET_HOLD` / `LIFT` | drag feel (see plan 2.1) |
| `CLEAR_STYLE` / `CLEAR_BLINK` / `CLEAR_STAGGER` | how a line clear looks |
| `BONUS_*` | Bonus meter size (`BONUS_METER`), combo share (`BONUS_COMBO_MAX`), trays it lasts and multiplier |
| `WAVE_MIN/MAX` / `JACKPOT_MIN/MAX` / `DRY_TRAYS` | (7.3, 8.2) how often a payoff (one big 2-line drop) and a jackpot hand (3+ lines over the tray) come: the main "enough clears" knobs |
| `GOLDEN_*` / `STAR_*` / `TRANSFORM_*` | special-event frequency and payout |
| `SHAKE` / `SPARKLE_RATE` / `FX_*` | visual intensity, each effect switchable |
| `GEMS` hues | recolor everything |
| `THEME` / `STYLE` / `HOME_WORLD` / `MOTIF` | default look (a saved Settings choice overrides) |
| `SHOW_TENSION` / `DEV_MODE` | debug readout (off by default) / Admin panel (needs `?dev`) |

Most of these are live sliders in the Admin panel, with a "Copy settings"
button to paste back into `CFG`.

---

## Open tuning notes (come back to these)

- **L/J pieces vs. density bias.** The 8 L/J orientations are liked and should
  stay common. `weightedShape` biases toward small pieces as the board fills;
  `BIG_CAP` now stops that bias growing past 4 cells, which keeps L/J (4
  cells) at a fixed weight. Watch whether they still get squeezed out.
- **Board tidiness (`CFG.TIDY`).** Hand choice penalizes hands whose best play
  leaves a ragged board (`roughFlat`, tracked in `evalHand`). In a bot sim it
  cut average fill about 10% at TIDY 2. A placement hint (highlight the flush
  spot) would be the next lever.
- **Piece partners (`PAIR_CHANCE`).** Each L/J/T/S/Z/corner piece has partners
  (`PARTNERS`, built at load by `pairHoles`). Awkward pieces from one tray are
  remembered in `carry`, and the next tray seeds a partner into most candidate
  hands. In a bot sim, a partner showed up next tray 69% of the time vs 48% by
  chance.

## Known gaps

- Best score and the current run reset on every launch (task 1).
- No mid-run rescue button (task 2).
- No pause button — opening Settings pauses the game.
- Resizing mid-game re-runs `layout()` and rebuilds the tile cache; lightly tested.

## First thing to do in a new session

Read this file, then `CFG` and `genTray` in `index.html`. Ask what she said
about the last build before changing anything — her feedback has driven every
recent pass.

---

## Offline + update toast (plan PR 1.4)

- `sw.js` precaches `index.html`, `manifest.json`, icons and every `js/` file into
  cache `crumble-<ASSET_HASH>`, and serves them cache-first (ignoring `?dev`).
  The Google font is not cached; it degrades as before. Offline launch works
  after one online visit.
- A new deploy changes `ASSET_HASH` → the browser installs the new worker in the
  background and it **waits** (no `skipWaiting` on its own, so a run is never
  swapped out from under her). `js/update.js` shows `#updateToast` once a worker
  is waiting and `state!=='play'`; tapping it sends `skipWaiting`, the page
  reloads on `controllerchange`, and old caches are deleted on activate.
- The page also calls `reg.update()` whenever the web clip becomes visible, since
  iOS resumes it without reloading.
- Only runs over http(s); `file://` just plays without it.
- Tests: worker takes control, precache list matches `index.html`, offline
  reload plays, update toast is held during a run then reloads onto the new cache.

---

## The drag: one finger, one destination (plan PR 2.1)

Her "it's not smooth" was partly the drag disagreeing with itself: the ghost
search (`SNAP_RADIUS`/`SNAP_STICKY`) and the seat rule (Euclidean 0.6) were
different, a 150 ms `SNAP_GRACE` could place a piece where nothing was shown,
the piece lagged the finger (~88%/frame), and any second finger moved or dropped
the piece. All in `js/game.js` (input section) and the drag block of `frame()`.

- **One pointer.** `drag.id` is the `pointerId` that picked the piece up; moves,
  releases and cancels from any other pointer are ignored, and a second finger
  can't pick up another piece. A `pointercancel` for it sends the piece home.
- **One answer: `drag.slot`.** `updateSlot()` (run on every move, and each frame
  while the pickup lift eases in) picks the nearest legal spot whose top-left is
  within `MAGNET_REACH` (0.75) cells of the floating piece's top-left *on both
  axes*. The current slot is kept until it is more than `MAGNET_HOLD` (0.15)
  past reach, or another legal spot is nearer by more than `MAGNET_HOLD`, so it
  doesn't flicker. `frame()` draws from `drag.slot` and `onUp()` places from it,
  so what she sees is where it lands. No slot → no ghost, the piece floats, and
  release sends it back. `SNAP_RADIUS`, `SNAP_STICKY`, `SNAP_GRACE` are gone.
- **Drawn position** = lerp(float, seat, `drag.snapK`). The float (`floatPos`)
  is exactly the finger sideways, with `LIFT` (now 1.0) cells between the finger
  and the piece's **bottom edge**, so a 1-row and a 3-row piece sit equally
  above the thumb. Only the seat/unseat change eases (`snapK`, ~4 frames), and a
  seated piece slides to a neighbouring slot over the same few frames.
- `FX_MAGNET` off: the piece always floats and a faint ghost marks `drag.slot`.
- Admin: Snap radius/stickiness sliders removed, Magnet hold added; the Admin
  store key is now `crumble.dev.5` because `LIFT` changed meaning.
- Tests (`tests/run.mjs`): 50 seeded random drags check the piece is drawn
  exactly in the slot (or exactly at the finger when there is none), that the
  slot obeys the rule, and that release calls `place` with that slot; plus two
  fingers, a cancelled touch, releases just past each board edge, a finger
  between four cells, and equal lift for 1- and 3-row pieces.

### Follow-up: glide + ghost (2.1b)

Jay on the phone after 2.1: "sticky moving it, a little jumpy/edgy". Cause: over
the board there is almost always a legal slot within reach, so the piece was
*always* seated and moved in whole-cell hops, holding each slot `MAGNET_HOLD`
past the halfway point before jumping. Now `FX_MAGNET` defaults to **off**: the
piece is always drawn exactly at the finger (smooth), and a ghost at
`GHOST_ALPHA` (0.6) plus the line preview marks `drag.slot` — still the one
answer, so release lands exactly on the ghost. `MAGNET_HOLD` is 0.05 (just
enough to stop the ghost flickering). `FX_MAGNET` on brings back the 2.1 seat.
Also: backgrounding the app mid-drag (`visibilitychange` hidden) now sends the
piece home, since iOS may not send a `pointercancel`. Admin store `crumble.dev.6`.

---

## Frame budget (plan PR 2.2)

Goal: no frame over 20 ms during a 3-line clear on her iPhone. Measured in headless Chromium first: the
drop (`place()` in the pointerup) cost 7-25 ms, about two thirds of it `genTray`, and a Blast Round hand
~19 ms (4x that with CPU throttling). That all landed before the clear's first frame.

- **The next tray is dealt after the clear starts.** `genTray` is now a wrapper that runs the generator
  `dealSteps()` straight through (start, boot). When the tray empties in `place()`, or a Blast Round starts,
  `dealLater()` queues it instead: it waits one frame, then `stepDeal()` runs at the end of each `frame()`
  for up to `DEAL_SLICE_MS` (4 ms) until done, then the game-over check (`checkStuck`). The candidate
  search (`pickHandSteps`), the sweep planner (`planSweepSteps`/`tileExactSteps`) and golden hands yield
  between candidates, so a slice overruns by well under a millisecond. Same search as one go (a test checks
  it); a deal takes 2-8 frames. Pickups wait while `dealing`, and so does the Blast Round clock; `start()` and `rescue()` cancel a pending one.
- **Particle budget.** Fireworks, praise bursts, clear specks/chunks, landing dust and confetti share
  `PARTICLE_CAP` (260) × `perf.fx`. A frame over `FRAME_BUDGET_MS` (20), or over 1.5x the device's own frame interval
  (so a 30 Hz Low Power Mode phone isn't cut on every frame), cuts `perf.fx` by 0.15 (floor 0.3);
  on-time frames grow it back by 0.01 (about a second). A slow moment sheds sparkle, not frames.
- **`?dev` frame readout** (bottom-left): slowest frame of the last 2 s, count of frames over 20 ms (tap to
  reset), the game's own JS time last frame, particle budget and live count. Not in the player build.
- **Cache churn:** tile textures are kept per skin + motif (`TILES`), so a transformation flip and back
  no longer re-renders 16 tile canvases inside the clear that triggered it; the board-glow sprites for every
  gem colour are built at layout; text sprites evict the oldest one instead of clearing all 160.
- Measured after (headless, unthrottled): drop 2-6 ms, slowest frame of ours ~10 ms, no long frames on a
  normal 3-line clear. A Blast Round start can still show one long frame in the container's software
  renderer while the world flip draws; its sounds and first rainbow tiles (~5 ms) are still in the drop.
- What to check on the phone: open with `?dev`, play some 3-line clears and a Blast Round, and read the
  count of frames over 20 ms.

### Dealer for obvious moves (plan 3.4)

- **Hesitation log** (`save.js`, `hes*`): for every tray, deal to first pickup, the pickup that led to the
  first drop to that drop, and whether the first drop cleared. A sample is thrown away when the tray came back
  through `restore()` (resume or Undo), or the app was hidden or Settings / Admin opened before the first drop.
  Kept in `crumble.hes` (last 60), recorded in the player build; the `?dev` readout's third line shows the
  medians of the last 20 and `n used/kept`: `hes pick 1.8s  place 0.9s  clr 55%  n 20/41`. **This is the
  real metric**: the plan's "done" is the median pick time dropping on her phone. Her home-screen app has its
  own storage and no URL bar, so to read her numbers there: open Settings and tap the note at the bottom
  ("Saved as your default…") five times quickly; it turns into the same medians and counts.
- **Dealer:** `OBVIOUS`/`OBVIOUS_MAX`/`ALT` (Hand solver above), Admin sliders for all three.
- **Next lever (not built):** at low fill (15-30%) the board usually has no 5/8 line, so the bot finds an
  obvious clear on only ~18% / ~64% of trays however the hand is chosen. Dealing a piece that *builds* a setup
  line is the next step, in its own PR.

---

## Blast as a tap-to-start reward (plan 4.5a) — REMOVED in 6.2, kept as history

The first special to come back, rebuilt so it is earned, legible, chosen by her, and the loudest thing on screen.
All of it is in the Blast section of `js/game.js` (plus `stepBlastFx` called from `frame()`, the button and card in
`index.html`, and four sounds at the end of `js/audio.js`).

- **Charge:** only combos. A clear at combo 2+ adds `min(combo-1, BLAST_CHARGE_MAX)` (3) to `blastCharge`; a lone
  clear adds nothing, nothing charges in trays 1-5 or during a round, and nothing ever drains it. `BLAST_CHARGE` (12)
  fills it. Measured with a bot (scratch copy of `tools/bot-sim.mjs`, seed 1, 20 000 placements): the "kid" bot
  (obvious clear else most flush) earns ~0.39 charge per tray and a median game of 57 trays, so the first fill comes
  around tray 35 and a typical game fills it once or twice; a clear-hunting bot earns ~0.72 per tray (every ~17 trays).
  Tune `BLAST_CHARGE` against what she actually does.
- **The button is the meter.** `#blastBtn` sits between Undo and Rescue; `--f` scales its fill. Each charging clear
  sends one small spark (`blastSparks`, a single particle, no trail) from the clear into the button, and the fill
  steps up when it lands (`blastShown` lags `blastCharge` until then). Full: the button turns hot pink/orange with a
  white ring and a slow shimmer, `Sfx.blastReady` chimes once, and it then waits silently, for the rest of the run
  if she ignores it. Hidden while stuck (End run takes its place).
- **Tap** (`canBlast()`: full, nothing else live, `specialOk()`, not mid-deal / mid-drag / stuck / paused) →
  `startBlast()`: charge to 0, Undo cleared (it can never give charge back or replay a round), `stats.blasts++`, the
  look flips to the `blast` world with the rainbow skin, "BLAST!" slams into the gap above the board, two lights race
  round the board's rim for the whole round, and `Sfx.blastStart` (rising whoosh into a low hit and a fast saw run;
  no other moment uses it). The leftover tray is replaced by a blast hand.
- **The round:** `BLAST_SECONDS` (20), big-piece sweep/jackpot hands (`bigMode`, unchanged), ×`BLAST_MULT`, +`BLAST_ADD`
  s per line (capped at the start length), a timer bar above the board and the button draining with it. The clock
  stops while a hand is dealt, while Settings/Admin is open, and while the app is hidden (`document.hidden`; the
  `dt` cap in `frame()` covers the rest). 3-2-1 pops above the board with a tick (`Sfx.blastTick`).
- **Never ends her run:** stuck mid-round, `checkStuck()` swaps in a fresh blast hand, at most twice per round
  (`blast.swaps`), then ends the round early; after the card, the normal stuck rules apply.
- **End:** at 0 s (a drag in flight lands first; no new pickup starts) `endBlast()` sets `specialEnd`, records
  `stats.bestBlast`, flips the look home, plays `Sfx.blastEnd` and shows `#blastCard`: the round's points, lines,
  best combo, and Best Blast (or NEW BEST BLAST!). The game is paused under it; a tap anywhere (or 8 s) dismisses it.
- **Save/resume:** `snapshot()` carries `blastCharge`, `specialEnd` and a live round `{t, pts, lines, best, swaps}`;
  `restore()` puts the round back in the blast look with its time left. Round trays give no hesitation sample.
- **Admin:** per-special toggles, "Fill Blast" and "Blast Round" buttons, sliders for `BLAST_CHARGE`,
  `BLAST_CHARGE_MAX`, `BLAST_SECONDS`, `BLAST_ADD`, `BLAST_MULT`, and sound previews for start/ready/over.
- `.overlay` now has `z-index:3`, so the action row no longer shows through the start, settings and game-over cards.
- Tests (`tests/run.mjs`, "Blast as a tap-to-start reward"): charge rules, spark → glow → one chime → tap starts,
  the shared gate, the results card and stats, a drag finishing before the card, the clock while hidden and in
  Settings, the bounded stuck swap, save/resume of charge and a live round, Undo and the hesitation log.
- **What to check on the phone:** chain two or three clears in a row and watch a spark fly into the Blast button;
  once it glows, tap it whenever she wants. Does she ask for it again?

---

## Star gem rebuilt (plan 4.5b)

A rare, mid-game, full-board moment. The star is a 1-cell piece that leaves no gem and clears its whole row and column.

- **When it is dealt.** `dealSteps()` asks `special('star') && specialOk() && starCool<=0 && starBest(grid).n>=STAR_MIN && (starForced || random<STAR_CHANCE)`. `starBest(grid)` (solver.js) is the most gems any empty cell's row + column would clear (plus up to 3 cells that reach it); `starAt(r,c)` is the count for one cell. Defaults: `STAR_MIN` 9 (of at most 15), `STAR_CHANCE` 0.15 per eligible tray, `STAR_COOL` 8 trays (`starCool`, saved), a combo >= `STAR_COMBO` sets `starForced` but it still waits for a worthwhile board. A sweep tray still takes precedence. The hand is graded with the star in it (unchanged), so the other two pieces stay playable.
- **Special rules.** Placing it sets `specialEnd=trayNo`, so the next tray carries none. It is never dealt in trays 1-5, during Blast or a transformation. While a star sits in the tray a full Blast button reads as disabled (`.held`, dimmed, no glow; derived in `syncBlastBtn` from `specialLive()`). A star tray records no hesitation sample (`hesVoid`).
- **Seeing it.** In the tray a prismatic beam runs through the gem the whole width and height of its slot. On the board a soft ring pulses on the best cell(s), so she need not count. While dragging, the beams run the full board, a twinkle sits on each gem that would go, and a label over the landing cell reads `N gems` (a star after it when that is the best available). The first star ever shows a one-line note under the tray ("The star clears its row and column") until she has placed one (`stats.starSeen`, persisted in `crumble.stats`).
- **The clear** (under ~600 ms): `STAR_CHARGE` (8 frames) of a ring pulling in and the star swelling, then beams to the four edges (`blasts`, `b.t` starts negative = the charge), the cross gems go white-hot outward from the star (`STAR_STAGGER` frames per cell) and burst into star sparkles instead of the line squash, edge flash, a bigger shake, and a `STAR BLAST / N gems` banner (the praise word is skipped for it). Reduced motion: no charge, no stagger, no shake. Switch: `FX_STAR_BURST` (also covers the tray beam and hint).
- **Sound.** `Sfx.starIn` (dealt), `starPick` (picked up), `star(n)` (rising charge, low hit, falling zap, chime cascade timed to the ripple), in all four sound sets. Admin has preview buttons.
- **Points.** `STAR_PER_GEM` (14) per gem cleared x the usual combo factor, never less than the line formula. It counts as a clear for combo and Blast charge.
- **Compatibility.** Save/resume stores the star piece and `starCool`; Undo restores the star and `specialEnd`; `stats.starSeen` rides along with the Undo stats copy.
- Admin: toggle plus `STAR_MIN`, `STAR_CHANCE`, `STAR_COOL`, `STAR_PER_GEM`. Tests: "star gem" scenarios in `tests/run.mjs` (deal rules, clear and score, Undo/resume, label/Blast/hesitation, animation under 700 ms).

## Golden hand rebuilt (plan 4.5c)

The rarest and biggest special: about one per game. A tray of gold pieces; the lines it can complete glow gold on the board, and finding them pays x3 on the tray's points with the biggest celebration in the game.

- **When it is dealt.** `goldenNext` is set when a tray empties: a clean sweep, a combo >= `GOLDEN_COMBO` (5) or a `GOLDEN_CHANCE` (0.03) roll, and `goldenCool <= 0` (`GOLDEN_COOLDOWN` 12 trays, saved). `dealSteps()` then needs `special('golden') && specialOk() && !blast`, so never trays 1-5, never beside another special, never two in a row. `genGoldenSteps` builds a planned sweep if it can, else the best jackpot hand with `pickHandSteps(..., puzzle=true)`: no GUIDE/OBVIOUS/ALT terms (it is meant to be a puzzle) but still all-three-playable and TIDY-scored, so a miss does not leave a ragged board. It must offer a sweep or `GOLDEN_MIN_LINES` (3) lines, otherwise nothing golden is dealt. Measured with `tools/bot-sim.mjs` (it now reports `goldens`/`goldensPerGame`): about 1.6% of trays, ~0.9 per 57-tray game. (The bot-sim keeps the specials' bookkeeping across `clearRunFx()`, which used to wipe `goldenNext` and `starForced`.)
- **The live plan.** `goldenSolve(a, shapes)` (solver.js) tries every order and spot for the pieces still in the tray, with clears applied between drops, and returns the most lines (a sweep wins) and WHICH lines (`ids` 0-7 rows, 8-15 columns). `goldenReplan()` stores it on `golden.plan` after the deal and after every placement, and on restore/Undo (the plan is not saved, it is worked out again). `goldenState()`: `alive` (still reachable), `locked` (full multiplier earned: sweep, or `want.lines-1` lines, min 1; a planned sweep needs a sweep or 3 lines), `dead` (only the x2 consolation is left).
- **Seeing it.** `drawGoldPlan()` paints the planned lines UNDER the gems (gold tint on the empty cells, gold outline in the gaps, a marker outside the board edge) so nothing draws over a gem; the lines light one after another when the hand arrives (`goldenArrive`, frames; input is never blocked). While dragging the glow dims and the ordinary line preview of the held piece is drawn after it, so the preview wins where they overlap. A pill under the tray (`#goldChip`, `syncGoldChip()` in `syncActions`) reads `Gold: N more lines for x3`, `x3 locked in!`, or `x2 for any clear` when the plan is dead (the glow goes out then, the hand carries on). Each planned line she completes flares gold and plays `Sfx.goldenStep(n)`.
- **The payoff.** `goldenCelebrate()` (game.js): banner `GOLDEN HAND COMPLETE x3 +bonus`, a gold wash behind the board and gold edge glow (~1.5 s), sparkles on empty cells, a gold rain only in the margins above and below the board (`goldRain`, each particle's `lim` keeps it off the board), a long shake, rings, and a layered sting (`goldenWin` + `goldenGong`). It does not start Gold Vault any more (that is 4.5d). A near miss pays the x2 consolation with a small version; a total miss pays nothing extra. Ending it sets `specialEnd`, so the next tray carries no special. Everything is cosmetic: the next tray is dealt as usual and is playable within ~1.5 s. Switch `FX_GOLDEN_FANFARE`; reduced motion has the glow and banner only (no rain, sparkles or sequence).
- **Compatibility.** The snapshot now copies `want`/`got` (Undo used to share the live objects, so Undoing mid-hand kept the new progress). Blast cannot be tapped while a hand is live (`specialLive()`); the golden tray records the normal hesitation sample.
- Admin: toggle plus `GOLDEN_COMBO/CHANCE/COOLDOWN/MIN_LINES/MULT/PARTIAL`. Tests: the "golden hand" scenarios in `tests/run.mjs` (deal rules and verified plan, re-plan and dead state, x3 and miss, celebration timing and placement, input during arrival, save/resume and Undo).

---

## Transformations as achievements (plan 4.5d)

`ACHIEVE` (`game.js`) names the four: `rainbow` (clean sweep), `volcano` (combo `TRANSFORM_COMBO`, 5), `starfield` (a star clear of `TRANSFORM_STAR_GEMS`, 10+ gems; STAR_MIN is 9), `goldvault` (a golden hand completed, called from `goldenCelebrate`). Storm and the random "mystery" roll are gone as triggers (Storm's world stays defined so an already-discovered one still shows in the world picker).

`triggerTransform(id)` does two separate things:
1. **Unlock, always** (when `CFG.SPECIALS.transform` is on): adds `id` to `discoveredWorlds` (the saved record, `crumble.skins.discovered`), sets `newLook` (a dot on the gear until Settings opens; saved), and the look appears in Settings.
2. **Go live, only if free**: `canGoLive()`: not Gold Vault, no Blast, none live, `transformCool` 0, tray 6+, no golden hand live, no star in the tray, and the tray after another special has not just ended (`specialEnd`; Starfield is exempt, the star's own clear is its parent). Live = the world+skin flip for `TRANSFORM_PLACEMENTS` (9) placements at x`TRANSFORM_MULT` (1.5). Ending sets `transformCool` (8) and `specialEnd`, so the next tray carries no special. A blocked achievement still unlocks (that rule outranks the flip).

The card is a queued banner (`pushBanner(txt,sub,col,k)`; `k>1` runs faster): first earn "NAME / NEW LOOK UNLOCKED" with `Sfx.achieve(i)` (a rising run in a different key per achievement, in all four sets); repeats "NAME / x1.5 · 9 MOVES" at 1.6x speed; blocked repeats and repeat Gold Vault show nothing. It never pauses or blocks play. Switch `FX_TRANSFORM_MOMENT`.

**Looks:** `LOOKS` has four earned entries (Rainbow, Volcano, Starfield, Gold Vault), locked with the achievement as the label until `discoveredWorlds` has them; picking one saves world+skin as her look. `isUnlocked(id)` treats an event skin as owned when its world is discovered, so the saved style loads. The Settings looks grid is now 9 tiles at 300 px wide (a test checks it still fits 390x844).

**Save/resume/Undo:** a live transformation is not saved (resume ends it); the cooldown is. `snapshot()` carries `tf` and `restore(o,true)` (Undo only) brings the live look back, so undoing the earning move removes it and undoing inside one keeps it. Admin: buttons for the four plus "Reset unlocks", sliders for combo and star gems.

Check on the iPhone: clear the board once (or hit a 5 combo): a card says NEW LOOK UNLOCKED, the sky flips, the gear has a dot, and the look is open in Settings afterwards.


## Adventure (plan 4.1a)

`js/modes.js`. Endless is still the default and untouched; the `Endless ▾` / `Level 7 ▾` chip under the HUD buttons (`#modeTag`) opens the mode menu (Endless, Adventure), and the start card has an Adventure button.

**A level is a normal run with a goal.** `mode` is `'endless'|'adventure'`, `lvl` the level, `lv` the level run's counters `{lines, pieces, combo, swept}`. Goals (`LEVEL_DEFS`: `[type, n, fill]`): `lines` (clear n), `score` (reach n), `combo` (a combo of n), `sweep` (empty the board). `place()` ends by calling `goalStep(total, swept)`, which updates the counters and calls `levelWin()` when the goal is met (state `'won'`, a win card after the clear plays out). The HUD's right-hand box is Best in Endless and the goal progress in Adventure (`syncHud()`); Adventure never touches `best`, the NEW BEST moment or skin unlocks, but lifetime `stats` count every mode.

**Boards.** Level 1-6 style `fill 0` levels open like Endless (`seedOpening`; that first clear is also a clean sweep, which is why every score level has a scatter instead). Otherwise `levelBoard(L)` scatters small pieces, seeded by the level id, so the board is identical on every phone, with no full line. A sweep level's board is a nearly-full line or two, retried until `planSweep` can empty it with three pieces, and `dealSteps` keeps dealing a planned sweep on those levels whenever one can be built.

**Stars.** 1 for clearing, 2 within `par[1]` pieces, 3 within `par[0]`. `LEVEL_PAR` came from `node tools/adventure-sim.mjs [runs] [seed]` (a keen bot, no Undo or Rescue): 3 stars = its 85th percentile, 2 stars = 1.6x that. Levels 25 and 29 were retuned after the run, so their pars are estimates. Re-run the sim after any dealer change. The bot wins nearly every level; a child will be slower, so expect 1-2 stars at first.

**Progress and unlocks.** `adv.lv[id] = {s,p,n,f}`. A level opens when the one before is cleared, or after three failed tries on it (`levelOpen`), so nobody is walled. A failed try (stuck, nothing left) shows the game-over card as "Level N · out of moves" with Try again / Map; a Rescue is always offered on a level (`rescueAllowed`).

**Save/resume/Undo.** `snapshot()` carries `lv` in Adventure; `validSnapshot` refuses an Adventure snapshot without it; Undo rewinds the counters with the move. Boot reopens the mode she left (an Adventure run, else Endless). `playLevel(id)` resumes a saved run of that same level, else starts it.

**Seeded dealing (for 4.1b, the Daily).** `rnd()` replaces `Math.random()` in `solver.js` and the golden chance in `place()`; `seeded(key, fn)` runs `fn` on a stream seeded from a string. `hashStr` and `mulberry` are in `shapes.js`.

Check on the iPhone: open Adventure from the start card or the chip, play level 1 (clear 3 lines), see the stars, tap Next level; switch to Endless from the chip and find the old run waiting; force-quit mid-level and reopen into it.

## Daily (plan 4.1b)

Third mode (`mode==='daily'`), in `js/modes.js`. An Endless-style run (Undo, Rescue, specials all work) on a board that is the same on every phone for a given day.

**Same board.** `dailyKey()` is the phone's local date, `YYYY-MM-DD`. `openBoard()` seeds the stream from `crumble-daily-<date>-open` before `seedOpening()`, and `dealSteps()` reseeds from `crumble-daily-<date>-<trayNo>` at every tray (via `rndSrc`), so the opening board, the first tray and each tray's dice are identical on two phones. Later trays also depend on how she played, so they match only while two players make the same moves. A test deals two phones with different `Math.random` seeds and checks the opening matches. Leaving the mode clears `rndSrc` (`leaveMode`).

**Results.** `crumble.daily` = `{v:1, d:{"2026-11-09":{s:best score, l:most lines, n:times played}}}`, written at game over (`dailyOver`; a Rescue then a second game over counts as one play). The Daily card shows today's status, Play / Play again / Continue, and a month calendar (score under each played day, arrows back to the first played month). The HUD's right box is "Today" (today's best). The Daily never touches the Endless best; `saveStats` now only saves a live score into `best` in Endless (Adventure and the Daily were leaking into it).

**Save/resume.** `snapshot()` carries `dk` and `lv.{lines,pieces}`; `loadRun()` for a Daily from an earlier date records its score and drops the run (a new day is a new board). A resumed Daily reseeds the stream, so a Rescue after a force-quit is still seeded.

**For 4.2:** `daily.d` and `adv.lv` are plain per-day / per-level records; streaks and rotating goals can be derived from them plus lifetime `stats`. Tests set the phone's date with `setDay(page, iso)` in `tests/run.mjs`.

Check on the iPhone: Daily from the start card or the mode chip; play a few moves, force-quit and reopen into it; compare the opening board with another phone on the same date.

### 4.2 Goals, unlock progress, streak
`js/goals.js`, store `crumble.goals` = `{v:1, streak:{cur,best,last}, days, done:[ids]}`. The streak counts days with at least one piece placed (`playedToday()` in `place()`); a missed day only pauses it (`streakNow()` is 0 until she plays, `best` is kept). Goals are lifetime ladders (`GOAL_FAMILIES`: lines, games, combo, sweeps, Adventure stars, play days, Blast rounds) derived from `stats`/`adv`; one rung per family shows, `checkGoals()` banners a reached rung once. First load with no save marks passed rungs done silently. Goals card (start card and mode menu) also shows the next score skin with a bar and the locked achievement looks with their hint. To add a goal, append a family.

## Bonus trays (plan 6.2)

Replaces the Blast Round (Jay: it was confusing; a bonus should just happen). Code is the "Bonus trays" block in `js/game.js`
(plus `startSky` in `worlds.js`, `drawBonusRim` called from `frame()`, the chip in `index.html`).

- **Meter.** `bonusMeter`, size `CFG.BONUS_METER` (10). Every clear in `place()` calls `chargeBonus(total, combo)`: it adds the
  lines cleared, plus 1 per combo step above the first (at most `BONUS_COMBO_MAX`, 2). Nothing fills it in trays 1-5, while a
  bonus runs, or past full; nothing ever drains it. Roughly one bonus every 5-8 trays of normal play: tune `BONUS_METER` first.
- **Start.** Only at a deal: `dealSteps()` calls `bonusDue()` (switch on, meter full, `specialOk()`) and `startBonus()`, so the
  tray being dealt is bonus tray 1 of `BONUS_TRAYS` (3). A full meter waits (chip says "×2 bonus next") while a transformation
  is live or the tray after another special. Dealing itself is untouched (a test deals the same tray with and without a live
  bonus). While a bonus runs `specialOk()` is false, so no star, golden hand or live transformation comes with it (the
  achievement still unlocks its look); the golden hand stays the only other multiplier.
- **Pay.** `gained*BONUS_MULT` at the end of `place()`'s scoring, after the transformation multiplier; `bonus.extra` collects
  the doubling's share. A tray counts down when it is emptied (`bonus.left--`); at 0 `endBonus()` sets `specialEnd`, returns the
  sky home, and the chip shows `+N bonus` (N = `extra`) for 3 s.
- **What she sees.** `#bonusChip` between Undo and Rescue (a div, not a button): meter fill, then "×2 bonus next" glowing, then
  "×2 · 3 trays left" counting down, then "+N bonus". Starting a bonus also queues a "BONUS ×2 / NEXT 3 TRAYS" banner and a sting
  (`Sfx.bonusStart`; `bonusReady` chimes once when the meter fills, `bonusEnd` at the end). Whole-screen treatment: `startSky('bonus')`
  crossfades only the sky and ambient particles (violet, `BONUS_WORLD`) over ~70 frames, ambient particles get a boost, and the
  board's rim pulses (`drawBonusRim`, faster on the last tray). The tile skin and board are never touched (no tile flip).
  Reduced motion: the sky snaps, the rim is static. Hidden while stuck (End run needs the room).
- **Save/resume/Undo.** `snapshot()` carries `bonusMeter` and `bonus:{left,extra}`; `restore()` puts the sky back at once. Undo
  takes the move back with its points, `extra` and trays left (the start of a bonus is a deal, so Undo before it is also fine).
- **Gone:** `blast`, `bigMode`, `blastCharge`, the Blast button/card/timer/3-2-1/sparks, `stats.blasts/bestBlast` (now
  `stats.bonuses`, which feeds the goal "Earn a ×2 bonus"), `CFG.BLAST_*`, `CFG.SPECIALS.blast`.
- **Admin:** toggle, "Fill bonus meter" and "Bonus trays" buttons, sliders for `BONUS_METER`, `BONUS_COMBO_MAX`, `BONUS_TRAYS`,
  `BONUS_MULT`. Tests: "Bonus trays" block in `tests/run.mjs`.
- **What to check on the phone:** chain a few clears and watch the chip fill; when it is full the next tray should bring the
  banner, the violet sky and the pulsing rim, and the chip counting 3, 2, 1; ask her what the chip means without telling her.

---

## Pressure and recovery (plan 6.1)

Jay after Phase 4: "pretty difficult to lose now... doesn't get hard then you save it." The dealer stacked every
advantage on every tray (no honest tier, GUIDE + OBVIOUS + ALT + TIDY, jackpot hands from tension 0.3, two free
rescues): the casual bot lost once every ~300 trays and cleared something on 92% of them. 6.1 gives Endless and Daily
a rhythm instead. Adventure is untouched (its levels and stars are calibrated on the old wave; `paced()` is false there).

- **Room, not fullness** (`roomOf(a)` / `roomBits(lo,hi)`, `solver.js`). For a reference set (`ROOM_REF`: the
  rectangles of 4+ cells and the four 3-cell corners) the share of each one's empty-board placements still legal,
  square-rooted, averaged. 1 = empty; 17 spread-out gems ≈ 0.38; 36 gems in neat blocks ≈ 0.26; 23 scattered gems ≈ 0.10.
  About 5 µs a call.
- **Phases** (`pace = {ph, n, hold, len}`, `paceStep()` at each deal, `paceTier()` maps it to a tier):

  | phase | when | tray |
  |---|---|---|
  | calm | room ≥ `ROOM_OK` (0.55) | `honest`: the tidiest playable of `HONEST_TRIES` (2) random hands, no GUIDE/OBVIOUS/ALT; `GIFT_CHANCE` (0.12) a guided `solvable` hand |
  | building | `ROOM_EDGE` ≤ room < `ROOM_OK` | `honest`, with the small-piece bias × `BUILD_BIAS` (0.3), so big pieces keep coming |
  | edge | room < `ROOM_EDGE` (0.30) | held a rolled `EDGE_HOLD_MIN..MAX` (2-3) trays; `edge` hands: every piece has a spot when dealt, but the three are **not** promised to fit in sequence (Block Blast-honest; the plan owner's call) |
  | recovery | after the hold, still cramped | 2+ lines reachable as a sequence, at most one piece clearing on its own, never a star; at most `RECOVERY_TRIES` (2) in a row, then back to edge |
  | relief | the deal after she gets out of edge or recovery | `RELIEF_TRAYS` (2) guided trays: the first tries a planned sweep, else `jackpot`; the second `solvable` |

  No star on edge or recovery trays. Golden hands and bonus trays work as before. The labels (`EDGE`, `RECOVERY`,
  `HONEST`, …) show in the debug readout with phase and room; the `?dev` frame overlay has a phase line too.
- **`tension`** is a display value in Endless/Daily now: `1 - room`, eased, after each placement (border glow; 6.6 builds on it).
- **Rescues.** `rescueEarned()`: the first is free, the second needs `RESCUE_EARN_LINES` (30) lines cleared since the first
  (`rescueLines`, "RESCUE EARNED" banner; the game-over card says how to earn it). Endless/Daily rescues deal a recovery
  hand and set the phase to the last recovery try: clear out and relief follows, miss and it is the edge again.
- **Saved:** `snapshot()` carries `pace` and `rescueLines` (resume and Undo keep the rhythm); an older save starts calm.
  Hesitation samples carry `ph`, so the log shows where she pauses.
- **Measured** with `tools/bot-sim.mjs` (`BOT=strong` and `RESCUE=1` are new; the pace line reports trays per game,
  phase mix, recovery cleared, relief per game and the trays between relief moments, where games were lost):

  | bot | trays to first stuck (p25 / median / p75) | relief moments a game | trays between them | lost in |
  |---|---|---|---|---|
  | casual, seeds 4/6/8 | 33-46 / 78-104 / 152-176 | 3-5 | 14-17 | ~half edge, ~40% building |
  | casual + rescues (seed 9) | 246 / 303 / 485 | ~16 | 16 | mostly edge |
  | strong (seeds 5, 6) | never stuck in 4000 trays | (93% of trays calm) | | |

  Before 6.1 the casual bot's median game was ~200-300 trays. Deal cost median 0.4-0.5 ms, p95 6.2 ms (a sweep plan
  is the max, ~30-80 ms, spread over frames as before). The casual bot rarely reaches a recovery tray: it gets out
  during the hold or loses there; when it does reach one it clears it nearly every time.
- **Knobs, in order:** `HONEST_TRIES` is the main difficulty dial (1 = casual median ~45 trays, 2 = ~85, 4 = ~200);
  then `ROOM_EDGE` (higher = edge sooner, relief more often), `RESCUE_EARN_LINES`, `GIFT_CHANCE`. All are Admin sliders.
- **Open:** rescues still roughly triple a casual run (each is close to a new life); if her runs feel endless, raise
  `RESCUE_EARN_LINES` or go to one rescue. The strong bot never loses: fine for "a strong player can get through", but
  a late-run creep (e.g. `BUILD_BIAS` falling with trays) is the lever if a long run needs an end.
- Tests: the "(6.1)" block in `tests/run.mjs` (room, phase sequence, hands by phase, rescues, save/Undo, overlay).

## Animation hierarchy (plan 6.3)

Four tiers, so the big moments stand out. In `place()` (`game.js`), `single` = one line, no star:
- **Single clear:** crisp and quiet. A ~100 ms squash collapse (6 frames), one speck per gem, one `+N` score label. No per-cell tags, ring, line flash or screen shake; glow at half strength.
- **Multi-line (2+) and star:** the old full set: point tags, ring, line flash, shake scaled by lines, squash squares plus three specks. Combo 3+ still adds slam, orbs, fireworks as before.
- **Narrow escape** (`CFG.FX_NARROW_ESCAPE`, Admin toggle): room was below `ROOM_EDGE` before the drop and is back above it after the clear (so it fires once, not on every clear in an edge tray) (never on a sweep): a cyan board rim, two soft rings and a `PHEW!` banner. Counts `stats.escapes`.
- **Clean sweep:** unchanged and still the biggest (confetti, four rings, banner, shake 16, a world).
- **Placement:** compress/settle `q` 0.11 over ~100 ms (was 0.16 over ~130 ms), 3 dust bits instead of 6, same ring. Board and block material are untouched.
Tests: `calm clears` (single is quiet) and `6.3 animation hierarchy`.

## One sound family (plan 6.5)

**The idea:** one main sound per moment. Pickup is a very quiet tick, placement a short dry click, a clear is that click's impact plus a pitched glass tail, a combo is the *same* clear a step higher up the pentatonic scale, a narrow escape (PHEW) is that clear plus one stronger accent, and a clean sweep is one short rising phrase that owns the mix. No pile of jingles.

- **The arbiter (`audio.js`, `EVT`, `sfxEvent`, `arbFlush`).** Every `Sfx.*` event except pickup/place goes through it. Events raised in the same tick are collected (a microtask) and the highest priority `p` plays at full level; the others are dropped, ducked (`DUCK` .4), or deferred until the winner is over (`same`: `drop` / `duck` / `defer`). A winner then holds the mix for `hold` seconds (`arbLead`), so the next clear after a sweep is heard, ducked, not on top of it. Priorities, lowest to highest: star pickup tick 0, clear 1, combo 2, deals 2, praise (tier 3+ only; smaller praise is just the word on screen) 3, achievements / bonus ready / bonus over / rescue 3, star / phew / bonus start 4, fanfare 5, sweep and golden win 6. To add an event: write it in each set, add an `EVT` row, and raise it with `Sfx.name(...)`.
- **Ducking works by `sfxGain`**, a module variable the arbiter sets while one event schedules its notes; `smp`, `noiseHit`, `voice`, `tone`, `bell`, `oNoise` and `oVoice` multiply their level by it. Keep any new primitive honest: multiply by `sfxGain`.
- **New events:** `Sfx.phew(total,delay,combo)` (the clear plus an accent, raised next to the plain clear; the arbiter drops the plain one) and `Sfx.fanfare()` (NEW BEST, LEVEL CLEARED; it used to be `praise(3)`). The golden hand's extra gong layer is gone (`goldenGong`); `goldenWin` is the one sound.
- **Defaults.** `CFG.SND_SET` is `'strings'` (recorded), `SND_PICKUP` `'soft'`, `SND_PLACE` `'drop'`. `saveSkinSave` writes `sndV:2`; a save without it is moved to Strings once on load (like `lookV`), and her later choice sticks. Original, Steel drum and Bells are still in Settings → Sound and all work with the arbiter. The recorded clear is `pl_drop` (rate .85) plus up to three `glass` tings; the recorded `phew` adds a glass chord and a low swell.
- **Not done here:** music (6.8), the sound for mode / whole-screen states (6.7). I could not listen to it; the levels are chosen by ear-of-the-numbers (impact about a placement's loudness, glass unchanged). Retune `pl_drop` volume/rate in `recordedSet().clear` first if clears sound thin or boomy on the phone.
- Tests: the "sound family (6.5)" block in `tests/run.mjs` uses a stand-in set (`spySet`) that records `event:sfxGain`, so priority and ducking are tested without audio hardware.

## Pressure on screen (plan 6.6)

The board now *looks* like the room metric from 6.1: she should feel it getting tense without a number. Code is the "Pressure on screen"
block in `js/draw.js` (`scr`, `pressureTarget`, `stepPressure`, `drawPressureWash`, `drawPressureRim`, `drawTrayBand`); switch
`CFG.FX_PRESSURE_SCREEN` (Admin toggle). Endless and Daily only (`paced()`); Adventure keeps the old `FX_TENSION_BORDER` glow.

- **State.** `scr = {p, warm, relief, ph}`, eased each frame. `p` 0 calm .. 1 tight, `warm` 0 cool .. 1 red-orange, `relief` a 1 -> 0 flash.
  Targets (`pressureTarget`): calm ~0; building a faint warming that follows `roomNow` between `ROOM_OK` and 0.1 (max p .55); edge p >= .72, warm 1;
  recovery p >= .8, warm .45 (amber: tight but she can get out); relief 0. It tightens slowly (~0.05/frame) and lets go faster (~0.09).
  Game over, the switch off and Adventure all target 0.
- **Look.** Behind the gems or around the board only, so no block or board material changes (a test compares a gem pixel at calm and edge):
  a warm sky wash (<= 10%), a cached dark-red vignette (<= 50%, clear over the whole board so only the margins darken), the board rim (cool blue -> amber/red-orange, wider and breathing faster as `p`
  rises; static under reduced motion), and a soft dark band behind the tray (<= 28%, drawn in the board layer before any flying chunks) so the tray "dims" as room shrinks; the pieces themselves are
  never dimmed (that still means "stuck", 0.3 alpha). No new text.
- **Relief.** Entering `relief` from edge or recovery sets `scr.relief = 1`: a pale cyan wash and a cyan rim ring fade over ~55 frames (reduced motion: the rim ring only, no full-screen flash). `resetPressure()` runs on a new run (eases from calm) and on restore (snaps to where the saved phase says).
  The narrow-escape cyan `borderFlash` and PHEW from 6.3 still fire on top.
- **Bonus compatibility (for 6.7).** While `bonus` runs, `drawBonusRim` owns the rim and the pressure wash is halved; the bonus sky/ambient
  (`startSky('bonus')`) is untouched, and pressure never changes the sky world. 6.7's golden, Adventure and Daily looks should read `scr` the same
  way (add terms in `drawPressureWash`, or give them their own function called next to it) rather than start a second layer. Rim priority in `frame()`:
  bonus, then `borderFlash`, then the pressure rim.
- **Cost.** One fillRect, one drawImage of a 1/4-res cached vignette, one rim path with three strokes, one band fill. No per-frame allocations.
- **Check on the phone:** play toward a cramped board: the rim should warm, the corners darken and the tray band deepen; clear out and a pale flash
  should wash the screen. Tune `p` caps in `pressureTarget` if it is too loud or too faint. Test: "pressure on screen (6.6)".

## Whole-screen mode looks (plan 6.7)

Jay: "during bonus type rounds, maybe whole screen animations". Four states readable from across the room, built on the 6.6 layer.
Code is the "Whole-screen mode looks" block in `js/draw.js` (`lk`, `stepLooks`, `drawModeWash`, `drawModeRing`); no new switch except the
existing `FX_GOLD_TINT` (gold). Everything is behind the gems (a tinted vignette that is clear over the whole board) or in a ring just *outside*
the board frame (15 px out; the pressure / bonus rim is inside it), so gems and board material are never touched and no text is added.

- **Bonus (violet):** violet wash and vignette pulsing with the rim, a soft band of light sweeping across the screen (period 4.2 s, 2.6 s on the last tray), a one-off flash when it starts. Extends 6.2's sky and rim; the sky world is unchanged.
- **Golden hand (gold):** gold vignette on top of the old faint wash, plus a shimmering gold ring around the frame. Gone when the hand ends or is dead.
- **Adventure (mint):** mint vignette and a ring that *fills with the goal* (`goalProgress()/goal.n`, eased) over a faint track: her progress, no numbers.
- **Daily (coral):** coral vignette and a dashed ring that turns slowly (a "today only" ticket).
- The ring is 15 px outside the frame but capped to the ~13 px phone margin (`o=max(6,min(15,bx-5))`), so it stays on screen. Bonus and gold are gated on `state==='play'` (nothing animates behind the game-over card); gold is skipped during Gold Vault; `resetLooks()` runs with `resetPressure()` and on a restored bonus.
- All weights are eased (`lk.bonus/gold/adv/daily`, `dt*0.07`), so entering and leaving crossfade. Reduced motion: no sweep, no flash, static ring.
- Pressure (6.6) still owns the board frame in Endless/Daily; a bonus halves the pressure wash as before. Colours are `TINTS`; tune the alphas in `drawModeWash` first if a look is too loud.
- Test: "whole-screen mode looks (6.7)" (corner margin changes, a gem pixel does not, each fades out).

## Recorded music (plan 7.4; replaces the generated score of 6.8)

Jay found the synthesised music "pretty bad" and asked for much better, tween-friendly, with a few options to choose from. `js/music.js`
now plays four recorded loops in `music/` (loaded after `audio.js`; also in `sw.js` `ASSETS`). Nothing is synthesised; if a file cannot be
fetched the game is quiet (no fallback). Ducking, the intensity hook (`musicTarget`/`musicTick`), `musicSync`/`musicNewRun`/`musicDuck` and the 7.0 audio unlock are unchanged.

- **Tracks.** All by Abstraction Music / Tallbeard Studios (Ben Burnes), "Music Loop Bundle", https://tallbeard.itch.io/music-loop-bundle, dedicated to
  the public domain under **CC0 1.0** (the bundle's licence text; no attribution needed, commercial use fine; it only asks not to use the music for NFTs or AI training, or to resell it unmodified).
  We got the files through the `jfpx/cc0-media-library` music-v1 release zip (sha256 checked against its SHA256SUMS), because kenney.nl, opengameart, itch and
  archive.org are blocked from the cloud sandbox. The `jfpx` catalog is the provenance record: it lists the OpenGameArt/itch source and a licence file per track.

  | file | name | mood | catalog id (original title) | length |
  |---|---|---|---|---|
  | `music/sunny-lofi.m4a` | Sunny Lo-fi | warm, bright, laid-back (~86 bpm) | `abstraction-4e6836606331898f144502c1` ("Sketchbook 2024-09-25", LoFi) | 90 s |
  | `music/bounce.m4a` | Bounce | playful, funky (~92 bpm) | `abstraction-36d4672d475a362f4c61d313` ("Sketchbook 2024-05-22", Funk) | 50 s |
  | `music/daydream.m4a` | Daydream | dreamy, calm | `abstraction-6b13391bc1b3862dbf2cd5c9` ("Sketchbook 2024-06-12", Ambient) | 48 s |
  | `music/momentum.m4a` | Momentum | a little more driving (~129 bpm) | `abstraction-417fa91b83fab8b8be52a4e5` ("Sketchbook 2024-10-30", Electronic) | 54 s |

  Transcoded from the creator's Ogg loops with `ffmpeg -map 0:a:0 -map_metadata -1 -c:a aac -b:a 96k -ar 44100 -movflags +faststart` (80k for Sunny Lo-fi), which also drops the
  embedded album art. Each is under 1 MB. The AAC edit list keeps the exact length, so decodeAudioData's buffer is the same number of samples as the original loop (checked in Chromium).
  **To swap a track**, drop in a new file under a NEW name (the music cache never clears) and edit `MUSIC_TRACKS`; add its source and licence to this table.
- **Chosen by metadata, not by ear.** There is no audio in the cloud, so I picked by style tags, tempo, brightness and a measured loop seam (the end meets the start within ~0.03 of full scale),
  and I trimmed the level of each loop (`gain` in `MUSIC_TRACKS`) towards the same loudness. Jay vetoes by ear; to swap, see above. Other loops in that release that could be tried:
  the Chiptune, Silly and Jazz styles. Safari's loop seam is unchecked: if it clicks there, loop with `loopStart/loopEnd` or crossfade the ends.
- **Picker.** Settings -> Sound: the Music control is a dropdown next to Sound effects (`#musicPick`: Shuffle / Sunny / Bounce / Daydream / Momentum / Off; `CFG.MUSIC_PICK`, saved as `musicPick` in `crumble.skins`; Shuffle by default).
  Off is the old music switch (`CFG.MUSIC`, so a saved `music:false` still means Off). It is a dropdown rather than chips because a chip row made Settings scroll (the "Settings fits one screen" test). Shuffle moves to another loop at each new run (crossfade ~1.4 s); a chosen track stays across runs.
- **Pressure.** `musicTarget()` (from `scr.p`, 6.6) feeds `setI`: the low-pass opens from 6.5 kHz (calm) to 18 kHz (tight) and the level lifts by up to 30% (`musicLpHz`, `musicLift`). No extra layer.
- **Loading.** Lazy: `musicLoad(idx)` fetches and decodes a loop the first time it is wanted; only the playing loop stays decoded (a 90 s stereo loop is ~30 MB of float samples).
  `sw.js` serves `/music/` from its own cache, `crumble-music`, filled on first play and kept across game updates (not precached, so installing the game stays small).
- **Level.** Unchanged: `CFG.MUSIC_VOL` (.5; Admin slider) x .5 through the phone-speaker high-pass on `musBus`, not the limiter. The loops are louder than the old synth bed (about -17 dB rms before that gain), so if they sit too loud, lower `MUSIC_VOL` first.
- **Tests.** Offline rendering with a stand-in loop (quiet, pressure brightens and lifts, ducking dips > 6 dB), the real files decode and are under 1 MB with a closed seam, the picker/switch/saving, the arbiter hook, the cache name.

## Calm music (plan 6.8, superseded by 7.4)

The generated score that 7.4 replaced (Web Audio pads and bells; kenney.nl could not be reached then). Kept for history; its code is gone.

Jay asked if music was worthwhile; a quiet bed under a puzzle game is, as long as it stays out of the way of the sound family and
gets tense with the board. Code is `js/music.js` (loaded after `audio.js`; also in `sw.js` `ASSETS`).

- **Generated, not recorded.** The plan said "CC0 loops from Kenney", but kenney.nl could not be reached from the build sandbox, so
  the music is made in Web Audio like the original synth sounds: no download, no licence, nothing to attribute, and it can follow the
  board. Three pieces in `MUSIC_TRACKS` (Morning in C, Drift in D, Lantern in F; 60-68 bpm), each an 8-bar loop of slow chords (a
  four-voice sine+triangle pad and a triangle bass) with sparse bells and a soft echo, all in a major pentatonic so nothing can
  clash. `musicPlan(track,bar)` is pure and seeded: the loop is identical every time round. If Jay would rather have recorded loops,
  drop CC0 files in as base64 and play them through `createMusic`'s `mix` node; the intensity layer and ducking would not change.
- **Intensity layer.** `musicTarget()` reads `scr.p` (6.6) so music and screen agree: calm ~0, building barely registers, an edge is
  ~1, game over 0, Adventure 0 (it has no room phases). The engine eases it (1.8 s up, 1.1 s down, so relief lets go quickly) and
  `setI` fades in a low triangle drone with a faint minor-ninth beating against it, a soft two-thump heartbeat on beats 1 and 3
  (from intensity .28), a pad filter that closes from 2600 to 1500 Hz, and thins the bells (`musicDensity`). It is a layer on the same
  chords, so nothing starts or stops.
- **Ducking.** `arbFlush` (audio.js) calls `musicDuck(priority,hold)` for the event that won the tick: `musicDuckLevel` is .64 for a
  clear, .5 for combos / deals / achievements, .38 for star / phew / bonus start / fanfare, .28 for a sweep or golden win; it dips in
  ~40 ms and comes back over ~0.45 s after the event's `hold`. The star pickup tick (priority 0) does not duck. Overlapping ducks keep the deeper one.
- **Settings.** Settings -> Sound has a Music switch (`CFG.MUSIC`, on by default; saved as `music` in `crumble.skins`). It is independent of
  Sound effects (the mute button). Level is `CFG.MUSIC_VOL` (.5; Admin slider) x .5 and sits near -29 dBFS rms, about 12 dB under a placed block. It goes through the
  phone-speaker high-pass (6.4) on its own filter pair, not through the limiter.
- **Lifecycle.** `ac()` calls `musicSync()` when the context is first made (the first tap), so it begins on the start card with a ~4 s fade. A new run (`start()`)
  picks another piece, taking over at the next 8-bar phrase. Backgrounding the tab stops it (`visibilitychange`); returning restarts it.
- **Not done / could not check.** Nobody has listened to it (no audio in the cloud). Tests render it offline: loop is identical, bells stay in the scale, a
  tight board differs from a calm one, levels (peak < -12 dBFS), ducking dips it > 6 dB, the switch, the intensity easing, the arbiter hook. If it
  is too quiet or too present on the phone, change `MUSIC_VOL` (or the `.5` in `musicLevel()`) first; if the heartbeat is annoying raise the `.28` threshold in `E.sched`.
  Whole-screen mode states (6.7) have no music of their own yet; a bonus or golden hand would be a natural place for a brighter variant.

---

## Payoff waves, setups and closers (plan 7.3)

Jay (round three): "it doesn't get easy and try to clear often enough", "background triggers to give great blocks to close it out for a
full reset", and, from Block Blast, set up then pay off: square an area off, then the perfect 2x2 or 2x3 arrives "not all the time,
just sometimes". Too many 2-3 cell pieces are "annoying". Endless and Daily only (`paced()`); Adventure keeps its tension wave. All of it is
in `solver.js` (the block after `roomOf`/`paceTier`), on top of the 6.1 phases: edge and recovery trays stay honest and never carry any of it.

- **The wave clock** (`wave`, `waveTick`, `waveTier`). Every `WAVE_MIN`..`WAVE_MAX` (4-6) trays a payoff is due. Ordinary trays weight the
  squaring-off pieces up (`BUILD_SET`: 2x2, 2x3, 3x2, 1x3/3x1, 1x4/4x1; `BUILD_W` 1.6 in `weightedShape`). The payoff tray (`payoffSteps`,
  label `PAYOFF`) is one big block (`PAYOFF_SET`: 2x2, 2x3, 3x2, 3x3, bars of 4-5) that completes `PAYOFF_LINES` (2)+ lines in a single drop,
  plus two ordinary pieces, all playable. No TIDY/GUIDE on it. It pays only what the board offers: if no big block has a 2-line drop, the tray
  is an ordinary one and the clock tries again next tray. A relief tray, a closer or a golden hand counts as the payoff (`waveDone`).
- **Setups** (`findHoles`, `waveAfterDrop`, `offerSetup`). After every drop, `findHoles` lists empty exact rectangles (`SETUP_RECTS`) whose
  filling completes a line and whose edge neighbours are at least `SETUP_WALLED` (85%) filled or wall; the biggest, not its parts. A hole that
  her drop just made (it was not a hole before) is a setup, at most 3 open. Each of the next `SETUP_TRAYS` (3) trays has `SETUP_CHANCE` (0.75) of
  carrying the exact piece, swapped into the smallest slot only if the hand stays playable. One offer per setup: once its piece is in a
  tray (rolled or by chance) it is never forced again. A setup closes when filled or broken.
- **Closers** (earned). A clear that leaves `CLOSER_GEMS` (14) or fewer gems, reaching combo `CLOSER_COMBO` (3), or a clear that gets her
  out of the edge sets `closerNext`. The next tray (if no star/golden hand is due or live and the last tray carried no special) tries
  `closerSteps`: the exact-tiling planner (`planSweepSteps` with `CLOSER_TARGET` 20 cells and `tilesSweep`, which checks drop orders instead
  of the budgeted solver, which missed sweeps that need singles) then `sweepSeqSteps` (three drops that each complete a line, clears
  between them). Found: label `CLOSER`, a soft pale shimmer behind the tray (`closerTray`, `drawTrayBand`, `FX_CLOSER_GLOW`, still under
  reduced motion), `specialEnd=trayNo` (it counts as the special: the next tray carries none), cooldown `CLOSER_COOL` (5). Not found: a
  close-in payoff (the payoff hand that clears the most gems), and if the board is still small the closer tries again next tray. The
  relief tray's planned sweep (6.1) uses the same planner and shimmers too.
- **Dry spell.** `DRY_TRAYS` (6) trays without a clear make the payoff due now: lines, never a sweep, so stalling earns no reset.
- **No tedium** (`noTedium`). While a 4+ cell piece fits the board, a hand is never three pieces of 3 cells or fewer, and the 4+ pieces in
  any five trays are at least `BIG_FLOOR` (5) (`bigHist` holds the last four trays). Swaps keep the hand playable (edge: every piece fits).
- **Saved** with the run (`wave` in the snapshot); older saves start a fresh wave. Every roll is `rnd()`, so the Daily is the same for everyone.
- **Admin:** sliders for every key above and a toggle for the shimmer. `waveStats` (setups made / dealt, closer tries; not saved) feeds the sim.

Measured with `tools/bot-sim.mjs` (casual bot, 4 seeds x 4000 trays; the casual bot now takes the obvious drop that clears the most lines,
and the baseline was re-run with the same bot). New columns: trays per multi-line clear, full resets per game, closers and payoffs per game,
trays between payoffs, setups paid (share of setups that got their piece within three trays, not counting holes she filled herself before
the next tray), setups per tray, small-only trays and the longest run, fewest 4+ pieces in any five trays, games ended, 10th percentile
game length, edge holds per game.

| | before (main) | after |
|---|---|---|
| median trays per game (4 seeds) | 109, 124, 104, 78 | 95, 114, 118, 70 |
| 10th percentile game | 21, 32, 12, 21 | 23, 27, 9, 18 |
| games ended in 16000 trays | 100 | 96 |
| edge holds per game | 5.4 | 5.8 |
| trays per multi-line clear | 8.1 | 6.0 |
| full resets per game | 0.13 | 0.18 |
| closers per game | - | 0.15 |
| trays between payoffs (median) | 14 (relief only) | 6 |
| setups paid within 3 trays | - | 54-58% |
| small-only trays / longest run | 4% / 2-3 | 0% / 1 |
| deal cost p95 / max (ms, whole deal, sliced in game) | 5.5 / 28 | 7.6 / 51 |

Missed target: 1-3 full resets per game. A 3-piece sweep needs the gems in a few lines; in casual play the board at a closer's deal
holds 12-24 gems spread over many lines and only a few percent are sweepable in three drops, by either planner. Making resets common would
mean keeping the board much emptier, i.e. an easier game. Levers if Jay wants more: `CLOSER_GEMS` up, `CLOSER_COOL` down, or a lower
`ROOM_OK`/`ROOM_EDGE` so the board runs emptier.


## More clearing hands (plan 8.2)

Jay after the first TestFlight build: "still not giving enough clearing blocks, like behind the scenes jackpot rounds", the second time he
asked. The plan owner relaxed the difficulty guard: the median game may grow to about 2x. Endless and Daily only; Adventure untouched.

- **Payoff clock** `WAVE_MIN`..`WAVE_MAX` 3-5 (was 4-6), `DRY_TRAYS` 4 (was 6). When no big block has a 2-line drop, the payoff key may be any piece
  that has one (a corner piece or a dot where a row and a column cross).
- **Build-up** (`BUILD_UP` 4, `BUILD_TRIES` 6). The honest tray before a due payoff (and while a due payoff waits for the board) looks at
  6 hands, not 2, and favours the one whose tidiest play (`evalHand` now keeps that board in `flo`/`fhi`) leaves a gap some big block
  clears 2+ lines in (`payoffRoom`). Tried and dropped: dealing a guided or 1-line tray whenever the payoff could not pay. Guided trays
  clear single lines and keep the board too empty for multi-line drops (6% of them had one vs 100% of payoffs), and games got shorter.
- **Jackpot hand** (`jack` clock, `jackpotSteps`, label `JACKPOT`). Every `JACKPOT_MIN`..`JACKPOT_MAX` (8-12) trays, and a tray with no
  clear runs the clock `JACKPOT_DRY` (1) extra. Never on edge or recovery trays; a closer wins over it. `JACKPOT_TRIES` (48) hands, most
  seeded with a piece that has a 2-line drop now; accepted only if the three clear `JACKPOT_LINES` (3)+ lines in some order (or sweep),
  scored to pay drop by drop (2-line single drops, `JACKPOT_EACH` per piece that clears right now, obvious drops, tidiness). Nothing on
  screen marks it: no banner, no multiplier. None on this board: it stays due and the tray falls back to the payoff. A jackpot, a golden
  hand, a closer or a relief sweep restarts both clocks (`jackDone`). Saved with the run (`wave.jn`, `wave.ja`).
- **Golden hand fix.** The tray-end roll used to overwrite `goldenNext`, so a golden hand queued while a bonus, star or transform kept the
  special gate shut was thrown away. It now waits for the gate. The x10 points (8.0) touched nothing in the dealer.

Measured with `tools/bot-sim.mjs` (casual bot, 4 seeds x 4000 trays, both runs with the same bot; new columns `traysPer3Lines`,
`jackpotsPerGame`, `traysPerBigHand`, `traysPerOffer2` and `byTier`, trays and multi-line rate by tray label).

| | before (main) | after |
|---|---|---|
| median trays per game (4 seeds) | 96, 106, 107, 161 | 155, 213, 204, 229 |
| 10th percentile game | 23, 16, 31, 29 | 33, 17, 7, 18 |
| games ended in 16000 trays | 104 | 54 |
| trays per multi-line clear | 5.9-6.5 | 4.8-5.0 |
| trays per tray clearing 3+ lines | 8.3-8.5 | 6.8-7.3 |
| trays per big hand (jackpot, golden, closer, sweep) | 20 | 9 |
| payoffs per game | 9-17 | 25-39 |
| full resets per game | 0.04-0.27 | 0.33-0.53 |
| trays with a clear | 88% | 88% |
| deal cost median / p95 (ms, 8 sims sharing the CPU, sliced in game) | 0.7 / 15 | 1.8 / 22 |

Missed target: a multi-line clear every 4 trays (got about 1 in 5). A single drop that clears two lines needs two nearly full lines
with their gaps lined up, and the casual bot's flush play rarely leaves that: payoffs are limited by the board, not the clock (a 2-3
tray clock dealt no more of them). Levers if Jay still wants more: `BUILD_UP` higher, or setups (`SETUP_CHANCE` 1) which also lengthen games.

## Blocks that crumble (plan 7.5, first zazz idea)

The name of the game, on screen: a cleared gem cracks and breaks into pieces of itself that fall off the screen. `CFG.CLEAR_STYLE` `'crumble'` is the default; `'squash'` and `'burst'` stay in Admin (Clear style). Code is the "(7.5) blocks that crumble" block in `js/draw.js` (`crack`, `spawnRubble`, `drawRubble`, `CRUMBLE_CRACK`, `RUBBLE_*`). Second pass 2026-11-10 (Jay: "not great"): the first version drew flat-colour shards behind the gems, so the block seemed to vanish while unrelated bits fell behind the board.

- **The block itself breaks.** Two white zigzag cracks draw through the gem (across the line, then along it) over `CRUMBLE_CRACK` (4) frames while it shudders; then it splits into four quarters cut from its own cached tile (`drawImage` of a sub-rectangle of `gemBig[gi]`, so every skin keeps its shading). At the split the quarters sit exactly where the gem was, then pop a few px apart and fall with spin and gravity (`RUBBLE_G`) off the bottom of the screen, fading over their last ~10 frames. No floor bounce.
- **A wave.** With crumble on, each gem's crack starts `CFG.CRUMBLE_STAGGER` (0.75 frames, ~12 ms; Admin "Crumble: crack wave") per cell along its line from the piece she placed (`place()` in `js/game.js`), so the line breaks outward from her piece. A whole 8-cell line takes ~170 ms (the squash's was ~145 ms). Tags, slams and orbs key off the same delays.
- **Over the board, under the tray.** `drawRubble` runs after the board's gems and the clear effects and just before the tray pieces, so pieces fall in front of the board and behind the tray, the held piece and the HUD. Each piece composes its turn with the frame's transform (`setTransform`), so no save/restore per piece and screen shake still applies.
- **6.3 tiers** (`shatters[].tier`, set in `place()`): 1 single line = four pieces, little pop, short life (~0.55 s), no dust or specks (crisp); 2 multi-line or star = more pop, a pale dust puff (2 bits) and 2 specks per gem, pieces fall off the screen; 3 combo `BIG_COMBO`+ = more kick away from the piece, 3 dust and 3 specks; 4 clean sweep = the most. `RUBBLE_POP` / `RUBBLE_KICK` / `RUBBLE_LIFE` / `RUBBLE_FADE` are per tier. A star keeps its own cross blast.
- **Budget.** Pieces count in `fxLive()` (`PARTICLE_CAP` x `perf.fx`). Short of room for four, a gem breaks in two halves, then falls whole, then just goes. Raster-inclusive frame gaps at 4x CPU throttle during a 3-line clear and a sweep matched the first version (p50 33-50 ms, p90 50 ms, max 67-100 ms in headless Chromium).
- **Reduced motion** falls back to the squash (no wave). **Admin store:** `devSave` writes `clearV:1`; a saved tuning without it drops its `CLEAR_STYLE` once (it held the old `'squash'` default), keeping the rest.
- Tests: the two "7.5 crumble" scenarios in `tests/run.mjs`.

## Journey sky (plan 7.5, second zazz idea)

The background travels as the run goes: dawn, day, golden hour, night, aurora, space. Code is the "(7.5b) journey sky" block in `js/draw.js` (state, triggers, decor, wipe) and `JOURNEY` in `js/worlds.js` (the six stages as worlds). Endless and Daily only (`journeyOn()` = `CFG.JOURNEY_SKY && paced()`); Adventure keeps her world and its mint look.

- **Stages.** `CFG.JOURNEY_AT` = 0 / 500 / 1500 / 3000 / 6000 / 10000. The casual bot's finished games have a median score of about 3500, so a typical game reaches night and a great one space. Every clean sweep adds one stage on top (`jJumps`, saved in the snapshot as `jy`; older saves follow the score). Space is the last.
- **A stage is a world:** gradient + one ambient effect (day has a new `clouds` effect, golden hour `embers`, night and space `stars`, aurora `ribbons`) + a decor sprite cached per stage at half resolution (`decorSprite`: low sun at dawn, small sun by day, big low sun at golden hour, crescent moon, aurora glow, ringed planet and nebula in space). Suns, moon and planet sit in the gap between the HUD and the board or low behind the tray, never behind the score or the buttons; clouds drift only there too. `isJourney(id)`; `worldDef('j3')` resolves like any world.
- **Her look.** Colours are mid-to-dark so white HUD text (Classic, Night) reads on every stage. A light theme with dark ink (Daylight, Cotton Candy, Mint, Paper) gets a pale version, each stage mixed 70% into her theme's own sky (`bgOf`, `paleTheme()`), decor at 55%. Board, tiles and motif are untouched. `homeSky()` is where the sky goes home to: the journey stage, or `CFG.HOME_WORLD` with it off or in Adventure. `syncHomeSky()` snaps there (Settings changes, reduced motion).
- **Changing stage (6.3 hierarchy).** A score threshold is calm: checked when a tray has been dealt (`journeyDealt`, from `stepDeal`), then `JOURNEY_WAIT` (30) frames later the new sky wipes down from the top over ~1.4 s with a feathered edge and a faint band of light; no sound, no text. A sweep (`journeySweep`, from `place()`) waits for its confetti and wipes in ~0.8 s with a bright leading edge. The wipe (`drawWipe`) draws the old sky, then the new one clipped above the line; it is all in the sky layer, so pressure (6.6), the mode looks (6.7) and everything on the board draw on top as before (a test checks a gem pixel mid-wipe).
- **Bonus and transformations** still take the sky over (`startSky('bonus')`, `startFlip`); while they own it a stage passed moves on quietly, and when they hand back (`endBonus`/`endTransform` -> `journeyHandBack`) the new stage wipes in instead of the crossfade. A sweep usually starts a Rainbow transformation, so its jump is often seen when the Rainbow ends.
- **Settings:** Settings → Look → Advanced, "Journey sky" (saved as `journey` in `crumble.skins`). Admin has a "Next sky (7.5b)" button.
- **Cost:** a steady sky (journey or not) is one cached full-pixel plate (`skyPlate()`: gradient + decor baked together), drawn 1:1 with one blit; the last two plates are kept so a wipe draws both skies plus one gradient for the edge (~80 frames). Before this (2026-11-10) the gradient was filled and a half-size decor sprite scaled over the whole screen every frame, which made drawing about 40% dearer (raster-inclusive frame p90 at 4x CPU throttle: idle 61-84 ms vs 40-45 before 7.5; now 34-38). The "frame budget: a drag toward a completing line" test checks one plate blit a frame.
- **Check on the phone:** play an Endless game past 500 (day) and 1500 (golden hour), and watch a clean sweep jump a stage. If a stage is too bright behind white text, darken its `top` in `JOURNEY`; if the stages come too slowly or fast, change `JOURNEY_AT`.
- Tests: the two "journey sky (7.5b)" scenarios.

## Anticipation (plan 7.5, third zazz idea)

A line one piece from clearing comes alive as she brings the right piece to it. Code is the "(7.5c) anticipation" block in `js/draw.js` (`antList`, `stepAnticipation`, `antCell`).All modes.

- **When.** Only while a piece is held, never at rest, so it is not a hint before she picks one up. On pickup, `antList` lists every legal landing of the held piece that completes a line (and which lines; star pieces skipped, they have their own cross preview). Each frame, a line's target is the closeness of the floating piece to the nearest landing that completes it: 0 at `ANTIC_REACH` (2.5) cells, smoothstep up to 1 on arrival. The wrong piece (one that cannot complete it anywhere) wakes nothing.
- **Look (6.3: below a single clear).** The line's gems shiver (at most `ANTIC_SHIVER`, 1.2 px, a ~13 Hz wobble scaled by closeness) and a glint runs along the line about once a second, through `gem()`'s own flash value, so nothing is drawn over the board as a layer. Once the piece is seated in a completing slot the coloured line preview takes over: those lines stop shivering. Reduced motion: no shiver, no travelling glint, a steady soft brightening.
- **No sound.** There was a rising hum; Jay found it very annoying (2026-11-10) and the code, the `ANTICIPATION_HUM` and `HUM_VOL` settings and their tests were removed. The cue is visual only.
- **Switches.** `CFG.FX_ANTICIPATION` is the whole cue (it is Settings → Look → Advanced "Glints while dragging", from #48, saved as `glint`). Admin sliders for reach and shiver.
- **Cost.** One pass over the board on pickup; per frame one distance per completing landing and a couple of `sin` per gem in a live line, no allocations. Measured in the test with five live rows: our JS per frame p90 0.4 ms.
- **Check on the phone:** pick up a piece that finishes a nearly-full line and move it slowly toward the gap; the line should start to tremble about two cells out. If the shiver starts too early, lower `ANTIC_REACH`.
- Tests: the two "7.5c anticipation" scenarios.

## Combo fire (plan 7.5, fourth zazz idea)

A streak catches fire. Code is the "Combo fire (plan 7.5d)" block in `js/draw.js` (`fire`, `fireCombo`, `fireSnuff`, `stepFire`, `drawFireRim`, `drawFireParticles`), the tray glow in `drawTrayBand`, the two calls in `place()` (`js/game.js`) and `Sfx.snuff` in `js/audio.js`. All modes.

- **When.** From combo `BIG_COMBO` (3), the same line where the loud celebration starts (6.3), so nothing below combo 3 changes. Heat `fire.k` eases to .4 at combo 3, .6 at 4, .8 at 5, 1 from 6; each new step adds a short flare and a burst of sparks off the top. Colour by tier: orange at 3, gold at 4, white-hot from 5.
- **Look.** Tongues of fire stand outward from the board frame (tall on top, short underneath where the tray is; the sides burn only when the screen leaves room beside the board) over a hot frame line; a dragged piece sheds embers by distance moved (and smoulders when still); the tray band glows warm, breathing. All of it is drawn in the board layer under the gems: embers and smoke pass behind pieces, never over one. A bonus's violet rim owns the frame, so the fire waits during bonus trays.
- **Snuff.** A drop that does not clear with the fire lit: the flames drop over about a third of a second, sixteen smoke puffs rise off the rim, and a soft falling "pff" (`snuff`, an arbiter event at priority 1, the same in every sound set). A new run or a restored one starts cold and silent; a rescue resets the combo without a puff.
- **Reduced motion.** A steady rim and tray glow (one still flicker phase), no embers, no smoke; the snuff is a fade.
- **Switch.** `CFG.FX_COMBO_FIRE`, Settings → Look → Advanced "Combo fire: the board burns on a streak" (saved as `fire`), also in Admin. Off mid-streak, the flames fade out.
- **Cost.** One cached flame sprite per tier at full resolution, drawn only smaller and with image smoothing off (filtered blits were most of the cost in the 4x-throttled raster check); one stroke; embers capped at 36 (scaled by `perf.fx`). At 4x CPU throttle with raster included, combo 6 while dragging: p50 about +3 ms over the same build with the fire off (drag p90 ~47 vs ~45 ms).
- **Check on the phone:** make three clears in a row; the rim should catch, then grow and whiten at 4 and 5, with sparks off the piece as you drag. Then drop a piece that clears nothing: the flames should go out in a puff with a soft breath. If it is too much, lower the heat curve in `fireTarget`, or turn it off in Settings.
- Tests: the three "7.5d combo fire" scenarios.

## Chase your best (plan 7.5, fifth zazz idea)

A run has a visible target. Code is the "Chase your best (7.5e)" block in `js/modes.js` (`chaseSync`), the `#chase` element and its CSS in `index.html`, `chaseBest` (set in `start()`, saved with the run as `cb`) and one line in `place()` (`js/game.js`). Endless only.

- **The marker.** A 76 px bar under the Score number fills as the shown score counts up toward `chaseBest`, the best she started this run with. From `CFG.CHASE_NEAR` (75%) "N to beat" shows beside it; from `CFG.CHASE_HOT` (90%) the bar glows, breathing. When the shown score passes it, the bar flashes white and pops away (~0.7 s). Hidden on her very first run (no best yet), in Daily and Adventure. A plain DOM element: it costs no canvas drawing and writes to the DOM only when what it shows changes (half-percent steps).
- **Why `chaseBest` and not `best`.** `saveStats()` writes `max(best, score)` during an Endless run, so after a resume the stored best can already be this run's score. The target is saved with the run (`cb`); an older save chases the stored best.
- **Passing it.** The existing NEW BEST banner, confetti and fanfare in `place()` are unchanged. With the switch on and a best of at least `CFG.CHASE_SKY_MIN` (500, the first journey stage) the journey sky also jumps one stage with the bright sweep wipe (`journeySweep()`, so it is saved in `jJumps` and waits for the banner like a sweep's). At space, or with the journey sky off, the banner carries it alone. Once a run.
- **Reduced motion.** A steady glow, and the pass is a fade instead of the pop.
- **Switch.** `CFG.FX_CHASE`, Settings → Look → Advanced "Chase your best: a bar to your best score" (saved as `chase`), also in Admin. Off: the bar hides at once and the sky does not jump; NEW BEST stays.
- **Check on the phone:** in Endless, the bar should be under the score from the start of a run; near the best it says how many points are left and glows; beating it should pop the bar, raise NEW BEST and wipe the sky to the next stage.
- Tests: the three "7.5e chase your best" scenarios.

## Mascot crumb (plan 7.5, sixth zazz idea)

A sidekick on the board. Code is `js/mascot.js` (the SVG, `mascotStep` called from `frame()`, `mascotClear`/`mascotAct` called from `place()`), the `#mascot` CSS in `index.html`, `mascotPlace()` in `layout()` and `mascotInit()` in `main.js`. All modes.

- **Character.** A cookie crumb with chocolate chips; the eyes and brows do the acting. Aimed at a tween: wry rather than cute (no blush, a smirk on a combo, a flat stare when a streak dies). Mood sheet: `design/mascot-moods-7.5f.png` in the project files.
- **Where.** Feet on the top edge of the board frame at its left corner, never over gems or the HUD. Its size fits the gap above the board (28-46 px). It dims while the held piece is near it (DOM sits over the canvas).
- **Moods.** idle (breathes, blinks, its pupils follow the held piece); clears by the 6.3 hierarchy: 1 line `nod`, 2+ lines `hop`, combo 3+ `smug`, a narrow escape `phew` (wipes its brow), a clean sweep or a won level `sweep` (star eyes and a flip); a drop that ends a streak of 3+ `flat` (eye-roll); `tight` while the pace is edge or recovery (Adventure: room below `ROOM_EDGE`): worried brows, a sweat drop; `faint` from "No moves" through the game-over card: X eyes, tips over onto the rim; a rescue or a new run stands it up. No sound of its own.
- **Cost.** Plain DOM: faces are class swaps written only when the mood changes; motion is CSS / Web Animations on transform and opacity; the pupils are one attribute write per quantised step. At 4x CPU throttle, drag + three-line clears measured the same frame intervals with it on and off.
- **Reduced motion.** Faces change; nothing moves.
- **Switch.** `CFG.FX_MASCOT`, Settings → Look → Advanced "Mascot: a crumb that reacts to your game" (saved as `mascot`), also in Admin.
- **Check on the phone:** the crumb should stand on the board's top-left corner; clear one line (nod), two (hop), three in a row (smirk), then miss (flat stare); fill the board until it sweats; run out of moves and it should faint. If it is too busy, turn it off in Settings, or shorten the `ms` holds in `MASCOT_ACT`.
- Tests: the three "7.5f mascot" scenarios.

## Timelapse (plan 7.5, seventh zazz idea)

The whole run in a few seconds on the game-over card. Code is `js/timelapse.js`; it is fed by `tlReset()` in `start()`, `tlRecord()` at the end of `place()`, `tlSnap()`/`tlLoad()` in the run save, and `tlShow()` in `gameOver()`. All modes.

- **Recording.** After the opening and after every drop the board is kept as a 64-character string ('.' or the gem index). Pictures, not moves, so stars, rescues and specials need no re-simulation. Saved in the run snapshot as `tl: {s, n, f}`, at most `TL_MAX` (96) pictures, about 6 KB: at the cap every other picture is dropped and the stride doubles, so a long run still spans start to end. An older save starts its timelapse at the resumed board.
- **Replay.** A 148 px board under the message plays the pictures over 2 to 4.5 s (70 ms a picture), easing out; a landing gem pops in, a cleared one shrinks away; at the end the rim flashes gold once and it stops drawing. A tap skips to the end, a tap after that plays it again. The buttons are live from the first frame: Keep going, Share and Start over never wait for it. A run with under three pictures shows none. Reduced motion: the final board only.
- **Share.** The share picture keeps the final board (a little smaller) and adds the opening, a third, two thirds and the end as a strip of four small boards.
- **Cost.** Recording is one short string per drop. The replay has its own rAF loop on a small canvas (empty slots in one path). At 4x CPU throttle on the game-over card, p90 frame (code + raster) was 43 ms with the replay against 39 ms without.
- **Switch.** `CFG.FX_TIMELAPSE`, Settings → Look → Advanced "Timelapse: replay your run on game over" (saved as `tl`), also in Admin. Off: nothing is recorded, no replay, no strip.
- **Check on the phone:** play a run out; the small board should replay it while the buttons already work; tap it to jump to the end; Share should show the four-board strip.
- Tests: the three "7.5g timelapse" scenarios.

## Front menu showpiece (plan 8.3)

The start card (launch with no saved run) and the mode menu (Home after a game, or the mode chip) share one look. Code is `js/home.js` and the `.home` / `.hero` / `.lt` / `button.tile` CSS in `index.html`.

- **Gem logo.** CRUMBLE on two rows of tiles drawn from her skin's gem sprites (`gemBig`; Crum in colours, ble in gold), redrawn when the skin changes. The tiles drop in when a menu opens (Web Animations on `.lf`), then a ripple and glint run along them every 4.2 s (CSS on `.lt` and `.lf::after`). A tapped tile flips and plays a place sound.
- **The crumb.** `#heroCrumb` reuses `MASCOT_SVG` and the mascot CSS (selectors are `:is(#mascot,#heroCrumb)`), stands on the M, blinks, looks toward touches, smirks when tapped. The in-game `#mascot` hides while a menu is up.
- **The sky.** `homeFrame()` runs at the top of `frame()`: while a home card is up it paints the journey stages in turn (`SKY_HOLD` ms each, a top-down wipe between) and `frame()` returns early, so the board, tray and effects are not drawn. `#stage.homeUp` hides the HUD. The overlay has no backdrop blur, so the menu is cheaper to draw than the old card.
- **Words.** `homeFill()` writes her best and streak chips and each tile's progress; the how-to line shows only before her first game.
- **Play crumbles the logo.** `homeCrumble()` (called by Play and the menu's Endless before the run starts) cuts each tile into four canvas shards in a `.crumbleFx` layer over the stage; they burst and fall over the opening board while the game starts underneath, and the crumb tumbles with them (`hero.falling` keeps the in-game crumb hidden until it has). The layer is removed when its own animations finish.
- Settings opened from the menu sits above it (`#setPanel` z-index 4), and Done keeps the game paused while the menu is still up.
- Reduced motion: no drops, ripples, flips or sky travel.
- Tests: the three "front menu (8.3)" scenarios.

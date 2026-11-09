# Crumble — project handoff

A browser puzzle game (Block Blast genre) built for my daughter. `index.html`
holds the markup and CSS and loads plain scripts from `js/` — no build step,
no bundler, no dependencies, opens straight in a browser (serve over http or
open the file directly; both work). Hosted on GitHub Pages and played on her iPhone as a home-screen web
clip.

Last updated 2026-11-09, after the animation hierarchy (plan PR 6.3).

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
- Clears: `'squash'` (default) or `'burst'`; per-cell point tags, COMBO slam
  with fireworks, praise words, score orbs, COLOR GONE bonus, clean sweep bonus,
  NEW BEST moment.
- **Golden hand (4.5c)** — the rarest, biggest special: a gold tray whose target lines glow on the board; finding it pays ×3. See the 4.5c section at the end.
- **Star gem (4.5b)** — a 1-cell piece that clears its row and column. Dealt only when a cross is worth it; see the 4.5b section at the end.
- **Achievements and transformations (4.5d)** — four named achievements, one per special, each unlocking a look for good: clean sweep = Rainbow, combo 5 (`TRANSFORM_COMBO`) = Volcano, a star clearing 10+ gems (`TRANSFORM_STAR_GEMS`) = Starfield, completing a golden hand = Gold Vault. See the 4.5d section at the end.
- **Bonus trays (6.2)** — clears fill a small meter (the chip under the board); full, the next three trays pay ×2 automatically, with a violet sky, a pulsing rim and a `+N bonus` tag at the end. Nothing to tap. Replaced the Blast Round. See the 6.2 section at the end.
- **Undo (3.2):** the `↩ Undo` button under the tray puts the run back to just before the last placement, exactly (`snapshot()` taken first thing in `place()` via `noteUndo()`, restored by `undo()` in `save.js`; lifetime stats are rewound too). One move back, once per placement: a new run, a rescue and game over clear it (so it can never refund a rescue), and a bonus in progress is undone with the move (trays left and points come back).
- **Stuck (3.2):** when no tray piece fits, the run waits instead of ending: pieces dim, "No moves" shows, and Undo, `🛟 Rescue` (needs a rescue left and `rescueAllowed()`, shared with the game-over card) and `End run` are offered. Only when neither Undo nor Rescue is available does it end on its own, 700 ms after the last drop (`checkStuck()` / `canExit()`). `syncActions()` keeps the buttons current.
- **Pressure and recovery (6.1, Endless and Daily):** the dealer reads the *room* left on the board (`roomOf()`), not how full it is, and moves through phases: calm and building deal honest hands (no help), a cramped board is held on the edge for 2-3 trays, then a recovery hand she has to spot, and getting out earns guided relief trays. Losses are real now. See the 6.1 section at the end. Adventure keeps the old tension wave.
- **Rescues** — on game over (if the run is worth saving): up to 2 per run. The first is free; the second is earned by clearing
  `RESCUE_EARN_LINES` (30) lines after it ("RESCUE EARNED" banner); Adventure keeps both free. A rescue deals a recovery hand
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
| `js/game.js` | `place`, bonus trays, input |
| `js/draw.js` | `frame` and effects |
| `js/flow.js` | `gameOver`, `rescue`, `start` |
| `js/save.js` | `snapshot`/`restore`, run autosave, best + stats |
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
| (3.2) | Undo (one move, exact round-trip, saved) and a mid-run Rescue button, dimmed until nothing fits |
| (3.4) | Dealer for obvious moves: `OBVIOUS`/`ALT` hand scoring, hesitation log in the `?dev` readout (`crumble.hes`), `tools/bot-sim.mjs` |
| (4.5a) | Blast as a tap-to-start reward: combo-charged `⚡ Blast` button, own sting/look/3-2-1, results card, Best Blast; per-special flags `CFG.SPECIALS.{blast,star,golden,transform}` and `specialOk()`; a live round survives save/resume |
| (4.5b) | Star gem rebuilt: dealt only when a cross is worth it (`starBest`, `STAR_MIN`), cooldown, beam in the tray + hint ring + drag count, charge-then-beams clear with star sparkles, per-gem points, own sounds, Blast button held while it is in the tray |
| (4.1a) | Adventure: 30 goal levels on a map (no timer), mode menu, one saved run per mode, `rnd()`/`seeded()` seam for seeded dealing, `tools/adventure-sim.mjs` |
| (4.1b) | Daily: date-seeded opening and trays, results calendar, third mode in the menu; Adventure/Daily scores no longer leak into the saved best |
| (6.0) | Opening no longer sweeps on move one: 2-4 scattered gems outside the seeded lines, and about 1 in 8 openings keep the board bare (`CFG.OPENING_SWEEP_CHANCE`); the opening test counts sweeps |
| (6.4) | Audio routing: the Original synth chain has its own speaker filter (`ohp1`/`ohp2`, set by `setSpeaker` with the other pair), so phone-speaker mode cuts its bass too; `ORIG_SFX.pickup/place` take the Admin volumes (`SND_PICKUP_VOL`, `SND_PLACE_VOL`). `PHONE_SPEAKER` defaults on for touch devices (`speakerDefault()`, run in `ac()`) unless a choice is saved: `crumble.speaker` (written by the Admin toggle) or `PHONE_SPEAKER` in `crumble.dev.6` |
| (6.2) | Bonus trays replace the Blast Round: a clear meter, then ×2 for the next 3 trays, automatically; Blast's button, timer, results card, big-piece hands and `canBlast` gating are gone. See the 6.2 section |
| (6.1) | Pressure and recovery: `roomOf()` measures room on the board; phases calm/building/edge/recovery/relief pick the tray (`paceTier`); honest trays return, edge trays only promise each piece a spot, recovery is a sequence she must see; the second rescue is earned; strong bot added to `tools/bot-sim.mjs`. See the 6.1 section |
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

- `CLEAR_STYLE: 'squash'` (default) — each cleared gem thins to a white-hot
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

### 3. Capacitor / native iOS (only if the PWA proves it's worth it)

```
npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap init
# index.html + js/ -> www/
npx cap add ios && npx cap open ios
```

Needs a Mac with Xcode. Free Apple ID allows 7-day sideloading to your own
device; $99/yr Apple Developer only for TestFlight / the App Store.

**If this is ever aimed at kids officially:** COPPA and Google Play Families
policy mean contextual-only ads, certified networks, no behavioral targeting —
which cuts ad revenue substantially. Decide that before building toward IAP.

### Release checklist (before anyone but her plays it)

- Nothing to flip: Admin needs `?dev` in the URL, and the debug readout is off by default.

---

## Tuning quick reference

| Knob | Does what |
|---|---|
| `ROOM_OK` / `ROOM_EDGE` | (6.1) where calm ends and the edge starts, in room (0-1) |
| `EDGE_HOLD_MIN/MAX` / `RECOVERY_TRIES` / `RELIEF_TRAYS` | (6.1) how long the edge holds, how many tries at a way out, how long the relief lasts |
| `HONEST_TRIES` / `BUILD_BIAS` / `GIFT_CHANCE` | (6.1) how light an honest hand is (the main difficulty knob), big pieces while building, guided hands in calm |
| `RESCUE_EARN_LINES` | (6.1) lines after the first rescue that earn the second |
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
- **Narrow escape** (`CFG.FX_NARROW_ESCAPE`, Admin toggle): the pace phase was edge or recovery before the drop and room is back above `ROOM_EDGE` after the clear (never on a sweep): a cyan board rim, two soft rings and a `PHEW!` banner. Counts `stats.escapes`.
- **Clean sweep:** unchanged and still the biggest (confetti, four rings, banner, shake 16, a world).
- **Placement:** compress/settle `q` 0.11 over ~100 ms (was 0.16 over ~130 ms), 3 dust bits instead of 6, same ring. Board and block material are untouched.
Tests: `calm clears` (single is quiet) and `6.3 animation hierarchy`.

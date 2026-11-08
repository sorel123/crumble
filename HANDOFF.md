# Crumble — project handoff

A browser puzzle game (Block Blast genre) built for my daughter. `index.html`
holds the markup and CSS and loads plain scripts from `js/` — no build step,
no bundler, no dependencies, opens straight in a browser (serve over http or
open the file directly; both work). Hosted on GitHub Pages and played on her iPhone as a home-screen web
clip.

Last updated 2026-11-08, after offline + update toast (plan PR 1.4).

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
  refused drop, line clear, game over. Add a scenario there when you change a rule.
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
  - `crumble.dev.4` — Admin panel tuning overrides. Bump the key when defaults
    change so old saved tuning doesn't mask them.
  - **Not saved yet:** the current run and the best score (task 1).

---

## Features at a glance

- 8×8 board, drag-and-drop with magnet snap, line-clear preview in the piece's
  colour, 37 shapes (`RAW`).
- Hand solver + tension wave (below) — every tray is fully playable in some order.
- Clears: `'squash'` (default) or `'burst'`; per-cell point tags, COMBO slam
  with fireworks, praise words, score orbs, COLOR GONE bonus, clean sweep bonus,
  NEW BEST moment.
- **Golden hand** — a bonus tray that multiplies its points (`GOLDEN_*`).
- **Star gem** — a 1-cell piece that clears its row and column (`STAR_*`).
- **Transformations** — achievement-triggered temporary looks (Rainbow, Gold
  Vault, Volcano, Starfield, Storm) that also multiply points; discovering one
  adds its world to the home picker (`TRANSFORM_*`).
- **Blast Round** — meter-triggered timed bonus round (below).
- **Rescues** — on game over (if the run is worth saving): up to 2 per run, both
  free ("Keep going"). A rescue serves a sweep/jackpot
  hand from `genRescue` — she still has to find the play.
- **Look**: themes (Classic default, Night, Daylight, Cotton Candy, Mint,
  Paper), home worlds (10, each with an ambient effect), tile skins (Blocks
  default, Jewels, Clay; Candy/Glass/Neon/Pixel unlock by best score), motifs.
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
| `js/game.js` | `place`, Blast Round, input |
| `js/draw.js` | `frame` and effects |
| `js/flow.js` | `gameOver`, `rescue`, `start` |
| `js/ui.js` | persistence, unlocks, Settings |
| `js/admin.js` | Admin panel |
| `js/main.js` | boot |

Top to bottom:

1. **`CFG`** — every tunable constant, commented. Start here.
2. **`GEMS`** — six `{hue, saturation}` pairs plus a gold gem (golden hands
   only) and a prismatic star gem (star pieces only).
3. **Worlds and themes** — `HOME_WORLDS`, `TRANSFORMS`, `BLAST_WORLD`,
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
10. **Blast Round** — `startBlast`, `stepBlast`.
11. **Input** — pointer handlers, `ghost`, the magnet.
12. **Draw** — `sprite`/`blit` text cache, then `frame`, the render loop,
    drawn in layers.
13. **Flow** — `gameOver`, `rescue`, `start`.
14. **Persistence** — skins/worlds/look save and unlocks.
15. **Settings** (player) and the **developer/Admin panel** (`DEV_TOGGLES`,
    `DEV_SLIDERS`, …, saved to `crumble.dev.4`).

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
  **Retuned in PR #6** ("sticky, doesn't move"): it only seats when the slot is
  within `MAGNET_REACH` (0.6) cells of the finger, a farther valid slot just
  shows a ghost, and the piece follows the finger at ~88%/frame.
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

## Blast Round (2026-10-30, PR #2)

The bonus round, and the answer to "I want chains built to clear the board,
with big pieces, and a reason to move fast."

- **Meter** (`blastMeter`, the thin bar by the board): `METER_LINE` per line
  cleared, `METER_COMBO` extra on a combo, a clean sweep fills it outright.
  After `METER_IDLE` ms without a clear it drains at `METER_DRAIN` per frame —
  dawdle and it slips away. That drain is the "move fast" pressure; tune it
  first if it feels mean.
- **Full → `startBlast()`**: look flips to the `blast` world (hot magenta,
  sparks) with the rainbow skin, banner, confetti, the leftover tray is
  replaced by a blast hand, and a timer starts at `BLAST_SECONDS`. Each line
  adds `BLAST_ADD` s (a sweep +5 s), capped at the start length. Points
  ×`BLAST_MULT`.
- **Blast hands** (`genTray`, `if(blast)`): a planned sweep if one can be
  built (no cooldown), else `pickHand('jackpot')` in `bigMode` — the crowd
  penalty nearly off, 5+ cell pieces ×2.5 in the draw, 60 candidates, and a
  per-cell bonus in the hand score so the chunkiest *playable clearing* hand
  wins. If no big hand is playable it falls back to a normal jackpot hand.
- **Ends** when the timer hits 0 (`stepBlast`): "BLAST OVER +pts · n lines",
  look flips home (or back to a live transformation). Game over kills it
  silently. No golden hand, star, or transformation can start during a round;
  a round can't start while a transformation is live (the meter waits at 1).
- Admin panel: a "Blast Round" button triggers one instantly; sliders for all
  of the above.

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

A debug readout (top-left, under the score) shows live tension and the tier
just served. Off by default (`CFG.SHOW_TENSION: false`); Admin can turn it on.

---

## Current state

Everything in "Features at a glance" works on her phone. The last several
passes were driven by her feedback: it should snap, feel solid, and be
relaxing rather than work. Open questions from that:

- Does the magnet now feel right (not sticky, still snappy)? `MAGNET_REACH`
  and the follow rate are the knobs.
- Is guided dealing too generous now? Watch the debug readout; if every tray is
  a gift, lower `GUIDE` or raise `TIER_JACKPOT`.
- Blast Round meter: is the idle drain fun pressure or mean? `METER_IDLE` /
  `METER_DRAIN`.

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
| `TENSION_UP` / `TENSION_DOWN` / `TENSION_DRIFT` | how fast the difficulty wave swings |
| `TIER_SOLVABLE` / `TIER_JACKPOT` / `TIER_SWEEP` | where each help tier kicks in |
| `GUIDE` | favour hands that can clear right now (0 = off) |
| `SWEEP_COOLDOWN` | how rare clean sweeps are |
| `CANDIDATES` / `NODE_BUDGET` | how hard the solver thinks (slower = smarter) |
| `SMALL_BIAS` / `BIG_CAP` | small-piece bias on a crowded board, and where it stops growing |
| `TIDY` / `PAIR_CHANCE` | favour compact boards / partner pieces for awkward shapes |
| `MAGNET_REACH` / `SNAP_*` / `LIFT` | drag feel |
| `CLEAR_STYLE` / `CLEAR_BLINK` / `CLEAR_STAGGER` | how a line clear looks |
| `BLAST_*` / `METER_*` | Blast Round length, payout, and meter pressure |
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

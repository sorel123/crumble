# Crumble — project handoff

A single-file browser puzzle game (Block Blast genre) built for my daughter.
Everything lives in `index.html` — no build step, no dependencies, opens
straight in a browser.

Goal: get it running as an app on an iPhone, add save/resume, then real ads.

---

## Ground rules

- **Stays a single self-contained HTML file** unless there's a real reason to
  split. No framework, no bundler. It should keep working by double-clicking it.
- Vanilla JS + canvas. Only external resource is the Fredoka font from Google
  Fonts, and it degrades fine if that fails to load.
- Audio: recorded CC0 sound effects and jingles from Kenney (kenney.nl), trimmed,
  normalized and embedded as base64 MP3 in `SAMPLES`, so it's still one file. The
  original synthesized sounds are kept as the 'Original' set (and the later bells
  as 'Bells'), all switchable under Settings → Sound.
- No `localStorage` calls exist yet (the preview environment it was built in
  blocked them). Adding them is a task below, not a bug.

---

## How the file is organised

Top to bottom inside the one `<script>`:

1. **`CFG`** — every tunable constant, commented. Start here.
2. **`GEMS`** — six `{hue, saturation}` pairs plus a gold gem (golden hands only) and a prismatic star gem (star pieces only). Changing a hue recolors that gem
   everywhere including its facets.
3. **`Ads`** — three methods, currently faked. The *only* ad code in the file.
4. **`SHAPES`** — 37 pieces parsed from ASCII art.
5. **The solver** — `packGrid` / `placeMasks` / `applyBits` / `evalHand`,
   `planSweep` and friends, then `genTray`.
6. **Tile renderers** — `jewelTile`, `clayTile`, `buildCache`, `layout`.
7. **Audio** — `buildChain` (buses), the synth sets (`BELLS_SFX`, `ORIG_SFX`), the recorded bank (`SAMPLES`, `smp`, `recordedSet`), then the `Sfx` dispatcher the game calls.
8. **Game logic** — `place`, `linesFor`, `mobility`.
9. **Input** — pointer handlers, `ghost`.
10. **`frame`** — the whole render loop, drawn in layers.
11. **Flow** — `gameOver`, `revive`, `start`, button wiring.

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
| < 0.05 | honest | any fully-playable hand |
| 0.05–0.25 | solvable | two or more clears reachable |
| 0.25–0.70 | jackpot | three or more clears reachable, favors emptier boards |
| > 0.70 | sweep | try to build a board-emptying hand |

**Clean sweep** hands are built backwards, not found by random search:
`coverAll` picks rows/columns covering every gem on the board, `targetCells`
takes their empty cells as a target, `tileExact` tries to tile that target with
up to three shapes, then `evalHand` verifies before it's served. Falls back
silently if any step fails. Gated by `SWEEP_COOLDOWN`.

A debug readout (top-left, under the score) shows live tension and the tier
just served. `CFG.SHOW_TENSION: false` hides it. **Turn this off before
shipping.**

---

## Current state

Working: 8×8 grid, drag-and-drop with lifted piece and ghost preview, line
clears with a staged shatter sequence, combo scoring, clean sweep with bonus,
two visual styles (Jewels / Clay, toggled on the start screen), synthesized
audio with mute, game over detection, faked interstitial and rewarded-video
flows.

Just retuned for difficulty — `TENSION_UP` 0.18, `TENSION_DOWN` 0.18, tier
thresholds lowered, honest tier made neutral instead of actively withholding
clears. **This retune is untested.** Play several rounds watching the debug
readout: tension should live mostly in the 0.3–0.7 band. Pinned at 1.0 means
still too hard; pinned low means too easy.

---

## Tasks, in the order I'd do them

### 1. Safe-area insets (do first — it's visibly broken on a real iPhone)

`layout()` hardcodes `const HUD=92` and computes the tray position from the
bottom of the viewport. On a notched iPhone the score slides under the status
bar and the tray can collide with the home indicator. `viewport-fit=cover` is
already set but nothing consumes the insets.

Read `env(safe-area-inset-top)` and `-bottom` (easiest: a hidden probe div with
that padding, read via `getComputedStyle`, or a CSS custom property) and add
them into `layout()`'s vertical math and the `.hud` padding.

### 2. PWA wrapper

Add to `<head>`:

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icon-180.png">
```

Plus a `manifest.json` and an icon. Host on GitHub Pages, open in Safari,
Add to Home Screen. This is the fastest route to "it's an app on her phone"
and needs no Mac.

### 3. Save / resume

Thin `Save` wrapper alongside `Ads`, same pattern — one place to change, and it
should no-op cleanly when storage is unavailable rather than throwing.

Persist on every placement: board, score, combo, tension, sweepCool, tray,
revives, chosen style. Separately persist `best`. On load, offer to resume if a
saved run exists. Must survive a force-close, so write on `visibilitychange`
too, not only on placement.

### 4. Rescues

Replace the current `revive()` (which clears the three fullest rows — that's
charity) with a **rescue**: serve a jackpot or sweep hand from the existing
generator. She still has to find the placement, which is the whole point.

Design decided:
- It's an inventory count (`rescues`), separate from where it came from.
- **First one per run is free.** Do not gate a kid's first rescue behind an ad.
- Second costs a rewarded video.
- Only offer when the run is worth saving (above a score floor, or above half
  her best) — offering on a 40-point run is noise.
- Also expose mid-run as a "stuck" button, dimmed until genuinely out of moves.

### 5. Real ads

Swap the two method bodies in `Ads`. Nothing else should need to change.

- **Web:** Poki / CrazyGames / GameDistribution SDK. `commercialBreak()` and
  `rewardedBreak()`. No app store, no review.
- **iOS native:** Capacitor + `@capacitor-community/admob`.

Interstitials stay capped (`ADS_EVERY`) and never fire mid-round. Rewarded
video is the one that actually pays.

### 6. Capacitor / native iOS (only if the PWA proves it's worth it)

```
npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap init
# index.html -> www/index.html
npx cap add ios && npx cap open ios
```

Needs a Mac with Xcode. Free Apple ID allows 7-day sideloading to your own
device; $99/yr Apple Developer only when you want the App Store.

**If this is ever aimed at kids officially:** COPPA and Google Play Families
policy mean contextual-only ads, certified networks, no behavioral targeting —
which cuts ad revenue substantially. Decide that before building toward IAP.

---

## Tuning quick reference

| Knob | Does what |
|---|---|
| `TENSION_UP` / `TENSION_DOWN` | how fast the difficulty wave swings |
| `SWEEP_COOLDOWN` | how rare clean sweeps are |
| `CANDIDATES` / `NODE_BUDGET` | how hard the solver thinks (slower = smarter) |
| `SMALL_BIAS` | bias toward small pieces on a crowded board |
| `SHARDS` / `SHAKE` / `SPARKLE_RATE` | visual intensity |
| `GEMS` hues | recolor everything |
| `STYLE` | `'jewel'` or `'clay'` default |
| `SHOW_TENSION` | debug readout — off before shipping |

---

## Open tuning notes (come back to these)

- **Tension is too easy.** After the 71d91ee retune (`TENSION_DOWN` 0.18,
  jackpot wants 3 lines, thresholds 0.05/0.25/0.70, `SWEEP_COOLDOWN` 3) it plays
  too generous. Dial back: `TENSION_DOWN` toward 0.25–0.30, jackpot `want` back
  to 2, `SWEEP_COOLDOWN` back to 4. Change one at a time and watch the debug readout.
- **L/J pieces vs. density bias.** The 8 L/J orientations (4 cells each) are
  liked and should stay common. `weightedShape` weights by `1/(1+n*density*3.0)`,
  so on a crowded board it favors 1–3 cell pieces and L/J get squeezed out. Goal:
  high density should not always mean small easy pieces. Ideas: exempt L/J from
  the size penalty, cap the penalty so 4-cell pieces stay at a fixed weight, or
  bias by "fits somewhere" instead of raw cell count.

- **Board tidiness (`CFG.TIDY`).** Hand choice now penalizes hands whose best
  play leaves a ragged board (`roughFlat` = filled/empty edge count, tracked in
  `evalHand`), so pieces tend to fit the current gaps and help square things
  off. In a bot sim it cut average fill about 10% at TIDY 2. Effect is modest;
  a placement hint (highlight the flush spot) would be the next lever.

- **Piece partners (`PAIR_CHANCE`).** Each L/J/T/S/Z/corner piece has partners
  (`PARTNERS`, built at load by `pairHoles`) that sit against it to make a solid
  2-4 wide block, allowing one single-cell hole. Awkward pieces from one tray
  are remembered in `carry`, and the next tray seeds a partner into most
  candidate hands. In a bot sim, a partner showed up next tray 69% of the time
  vs 48% by chance, with fill up slightly. It can't force *where* she places the
  first piece, so the fit is only as good as the board she made.

## Known gaps

- Best score resets on refresh (no storage yet — task 3).
- Resizing mid-game re-runs `layout()` and rebuilds the tile cache; lightly tested.
- No pause.
- `revive()` still uses the old clear-three-rows behaviour (task 4 replaces it).
- The difficulty retune above has not been played yet.

## First thing to do in a new session

Open `index.html`, read `CFG` and `genTray`, then play a few rounds with the
debug readout visible and judge whether the retune landed before changing
anything else.

// Crumble — Tunable constants (CFG) — start here.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════════════════════════════════════════════════════════════
   TUNE THESE
   ═══════════════════════════════════════════════════════════════ */
// shared DOM lookup, used by every js/ file (defined here because this file loads first)
function el(id){ return document.getElementById(id); }

const CFG = {
  GRID: 8,
  DEV_MODE: new URLSearchParams(location.search).has('dev'), // Admin panel only when the URL has ?dev (also ignores saved panel overrides otherwise)
  THEME: 'classic',      // a THEMES id — Classic (steel sky, navy board) by default; Night and the light modes in Settings → Look
  STYLE: 'blocks',       // a SKINS id — Blocks (edge-to-edge, bevelled) by default; picked in Settings; some are unlockable
  MOTIF: 'none',         // a MOTIFS id — face motif stamped on every tile, independent of skin
  UNLOCK_ALL: false,     // dev: pretend every skin is unlocked
  HOME_WORLD: 'night',   // a HOME_WORLDS id, or a discovered TRANSFORMS id — her default background
  UNLOCK_ALL_WORLDS: false, // dev: every world selectable regardless of discovery

  // difficulty wave
  TENSION_UP:    0.10,   // added each placement that clears nothing (slower build = calm stretches before help arrives)
  TENSION_DRIFT: 0.07,   // extra rise when the board is getting cramped
  TENSION_DOWN:  0.30,   // subtracted when you clear (a clear releases the tension — the wave's downswing)
  CANDIDATES:    36,   // random hands tried per tray before settling
  NODE_BUDGET:   2600,   // search cap per hand (raise = smarter, slower)
  SWEEP_COOLDOWN: 3,    // trays that must pass before another sweep hand
  SINGLE_WEIGHT: 0.35,   // multiplier on the 1-cell piece (density bias otherwise floods the tray with them)
  EARLY_TRAYS:   4,      // opening trays that favor stackable pieces (bars and rectangles)
  EARLY_AWKWARD: 0.15,   // weight multiplier for non-rectangles during those trays
  PAIR_CHANCE:   0.7,    // odds a tray carries a partner for an awkward piece (L/J/T/S/Z) from the previous tray
  TIDY:          2.0,    // how much hand choice favors a compact board (0 = ignore; higher = flatter, fewer holes)
  SWEEP_MIN: 6, SWEEP_MAX: 30,  // gem count range where a sweep is plausible

  // scoring
  LINE_POINTS: 10, COMBO_STEP: 0.5,
  SWEEP_BONUS: 300, SWEEP_PER_GEM: 25,

  // golden hand: a bonus tray that multiplies the points it earns
  GOLDEN_COMBO:    4,    // a combo this high (or higher) queues one for the next tray (so does a clean sweep)
  GOLDEN_CHANCE:   0.04, // random roll after every tray
  GOLDEN_COOLDOWN: 8,    // trays that must pass before another golden hand
  GOLDEN_MULT:     3,    // multiplier when she finds it: clears at least (planned lines - 1), min 1 (a planned sweep: 3+ lines)
  GOLDEN_PARTIAL:  2,    // consolation multiplier for any other clear during the hand; a miss costs nothing

  MAX_RESCUES: 2,        // most rescues one run can use; both are free
  RESCUE_FLOOR: 300,     // offer a rescue only above this score...
  RESCUE_BEST_FRAC: 0.5, // ...or above this fraction of her best
  SHARDS: 8, SHAKE: 1.0, SPARKLE_RATE: 620,
  // juice — the feel layer (all toggleable from the Admin panel)
  FX_CHUNKS:      true,   // cleared gems burst outward as whole blocks (not slivers), away from where you placed
  FX_SCORE_ORBS:  true,   // every cleared gem sends a glowing orb to the score, which bumps when they land
  FX_LAND_BUMP:   true,   // a placed piece thumps in (quick squash + ring) instead of appearing
  FX_PICKUP_GROW: true,   // a picked-up piece grows to board size over a few frames instead of snapping
  FX_LINE_PREVIEW:true,   // lines the held piece would clear light up in its colour
  FX_MAGNET:      false,  // on: the held piece seats into its landing slot and hops cell to cell. Off (default): it glides with the finger and a ghost marks the slot
  GHOST_ALPHA:    0.6,    // how solid the landing ghost is (the "snap" she sees on the board while the piece glides)
  MAGNET_REACH:   0.75,   // the slot is the nearest valid spot within this many cells of the floating piece, per axis; none in reach = no slot, release returns it
  MAGNET_HOLD:    0.05,   // hysteresis: the current slot is kept until the piece is this much farther out than REACH (or this much nearer another slot)
  GUIDE:          1.0,    // how much hand choice favours pieces that clear something RIGHT NOW, no sequence needed (0 = off)
  CLEAR_STYLE:    'squash', // 'squash': the line collapses to a glowing bar and is gone in ~100 ms (Block Blast's beat); 'burst': blocks fly out
  CLEAR_BLINK:    0,      // frames the whole line flashes white before it goes (0 = instant, like Block Blast)
  CLEAR_STAGGER:  0.35,   // frames of delay per cell of distance from the placed piece (the collapse ripples outward)
  FX_CELL_TAGS:   true,   // a little point value appears on every cleared cell
  FX_COMBO_SLAM:  true,   // headline "COMBO n" slams in on every consecutive clear, with fireworks
  COLOR_GONE_BONUS: 60,   // points per colour wiped off the board by a clear ("COLOR GONE!")

  // Blast Round — the bonus round. A meter fills with clears (and drains while you dawdle);
  // full = a timed round of big-piece sweep/jackpot hands, a hot new look, and doubled points.
  BLAST_ENABLED:  true,
  BLAST_SECONDS:  20,     // round length when it starts
  BLAST_ADD:      2.5,    // seconds added per line cleared during the round (capped at BLAST_SECONDS)
  BLAST_MULT:     2,      // score multiplier during the round
  METER_LINE:     0.14,   // meter gained per line cleared
  METER_COMBO:    0.06,   // extra per clear while on a combo
  METER_IDLE:     2500,   // ms without a clear before the meter starts draining
  METER_DRAIN:    0.0004, // meter lost per frame once draining (~40 s from full to empty)
  BIG_CAP:        4,      // the crowded-board small-piece bias stops growing past this many cells, so 5-9 cell pieces keep coming
  // star gem: a single-cell piece that clears its whole row and column
  STAR_ENABLED:  true,   // master switch for star gems
  STAR_CHANCE:   0.035,  // odds each tray carries one, replacing a normal piece
  STAR_COMBO:    6,      // a combo this high (or higher) guarantees one in the next normal tray

  GOLDEN_ENABLED: true,  // master switch for golden hands

  LIFT:          1.0,    // cells between the finger and the bottom edge of the dragged piece (same gap for every piece height)
  SMALL_BIAS:    3.0,    // density bias in weightedShape: higher = fewer big pieces as the board fills
  TIER_SOLVABLE: 0.0,    // tension above this deals 'solvable' hands (2+ lines); at 0 there are no 'honest' hands — every tray can clear
  TIER_JACKPOT:  0.30,   // ...above this 'jackpot' hands (3+ lines)
  TIER_SWEEP:    0.85,   // ...above this a planned clean sweep (when off cooldown)

  // transformations — achievement-triggered event looks (own world + own tile skin), temporary
  TRANSFORM_ENABLED:    true,  // master switch
  TRANSFORM_PLACEMENTS: 9,     // how many placements one lasts
  TRANSFORM_MULT:       1.5,   // score multiplier while active
  TRANSFORM_COOLDOWN:   8,     // trays that must pass after one ends before another can start
  MYSTERY_CHANCE:       0.015, // odds a fresh tray triggers a random one anyway (blocked by the cooldown too)

  // event screen effects — each independently toggleable; none may ever draw over live board gems
  FX_COMBO_GLOW:     true,   // screen-edge glow in the combo colour, intensifying with the streak
  FX_GOLD_TINT:      true,   // faint full-screen gold wash while a golden hand is live
  FX_SWEEP_FX:       true,   // full-screen colour wash + confetti on a clean sweep
  FX_TENSION_BORDER: true,   // board border glow: calm (cool) -> warm as tension rises
  FX_PUNCH_ZOOM:     true,   // brief 2-3% punch zoom on a 2+ line clear

  // sound — variant + volume for the two most-heard effects, set on the settings panel
  SND_SET:        'original', // everything but pickup/place: 'original' | 'strings' | 'steel' (recorded) | 'bells' (synth)
  SND_PICKUP:     'original', // 'original' | 'slide' | 'soft' | 'swish' (recorded) | 'off'
  SND_PLACE:      'original', // 'original' | 'drop' | 'wood' | 'soft' (recorded) | 'off'
  SND_PICKUP_VOL: 1,
  SND_PLACE_VOL:  1,
  PHONE_SPEAKER:  false,      // synth sounds only: cut the bass a phone speaker can't play (it just distorts)

  SHOW_TENSION: false    // debug readout; off for the player (Admin can turn it on)
};

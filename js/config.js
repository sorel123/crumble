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

  // pressure and recovery (plan 6.1, Endless and Daily): the dealer reads the ROOM left on the board (room(), solver.js:
  // how many placements a set of mid and big reference pieces still has, 1 = empty, 0 = only small pieces fit) and
  // moves through phases: calm -> building -> edge (held a few trays, no help) -> recovery (a sequence to spot) -> relief.
  ROOM_OK:        0.55,  // room at or above this is calm; below it the pressure is building
  ROOM_EDGE:      0.30,  // room below this is the edge: cramped, honest trays, no help, held EDGE_HOLD_MIN..MAX trays
  EDGE_HOLD_MIN:  2,
  EDGE_HOLD_MAX:  3,
  RECOVERY_TRIES: 2,     // recovery hands in a row before the dealer goes back to edge trays (a miss can really lose)
  RELIEF_TRAYS:   2,     // guided trays earned by the clear that gets her out of the edge (the first may be a planned sweep)
  GIFT_CHANCE:    0.12,  // odds a calm tray is a guided one anyway, so a strong player still meets directed hands
  HONEST_TRIES:   2,     // candidate hands an honest tray looks at (the tidiest playable of these): a light hand, not a search
  BUILD_BIAS:     0.3,   // building phase: the crowded-board small-piece bias is scaled by this, so big pieces keep coming

  // payoff waves, setups and closers (plan 7.3, Endless and Daily; see solver.js)
  WAVE_MIN:       4,     // a payoff tray (big blocks, PAYOFF_LINES+ lines) is due every WAVE_MIN..WAVE_MAX trays
  WAVE_MAX:       6,
  PAYOFF_LINES:   2,     // a payoff hand must offer at least this many lines, or the tray is an ordinary one and the clock retries
  PAYOFF_TRIES:   12,    // candidate payoff hands looked at
  BUILD_W:        1.6,   // weight on the squaring-off pieces (2x2, 2x3, 3x2, 1x3/3x1, 1x4/4x1) in ordinary trays
  SETUP_CHANCE:   0.75,   // per tray, odds an open setup's exact piece is dealt (one offer per setup)
  SETUP_TRAYS:    3,     // trays a setup stays open
  SETUP_WALLED:   0.85,  // share of a hole's edge neighbours that must be filled or wall for it to count as squared off
  CLOSER_GEMS:    14,    // a clear leaving this many gems or fewer earns a closer (a planned sweep with a shimmer on the tray)
  CLOSER_COMBO:   3,     // ...so does reaching this combo (and getting out of an edge hold)
  CLOSER_TARGET:  20,    // most empty cells a closer's three pieces may fill
  CLOSER_COOL:    5,     // trays after a closer before the next
  DRY_TRAYS:      6,     // trays with no clear that make a payoff tray due now (lines, never a sweep)
  BIG_FLOOR:      5,     // pieces of 4+ cells across any five trays, kept where they fit
  FX_CLOSER_GLOW: true,  // the shimmer behind a closer tray

  // difficulty wave (Adventure only since plan 6.1: its levels and stars are calibrated on it)
  TENSION_UP:    0.10,   // added each placement that clears nothing (slower build = calm stretches before help arrives)
  TENSION_DRIFT: 0.07,   // extra rise when the board is getting cramped
  TENSION_DOWN:  0.30,   // subtracted when you clear (a clear releases the tension — the wave's downswing)
  CANDIDATES:    36,   // random hands tried per tray before settling
  NODE_BUDGET:   2600,   // search cap per hand (raise = smarter, slower)
  SWEEP_COOLDOWN: 3,    // trays that must pass before another sweep hand
  SINGLE_WEIGHT: 0.35,   // multiplier on the 1-cell piece (density bias otherwise floods the tray with them)
  EARLY_TRAYS:   4,      // opening trays that favor stackable pieces (bars and rectangles)
  OPENING_SWEEP_CHANCE: 0.125, // plan 6.0: odds an opening has no scattered gems, so its first clear can sweep (~1 in 8)
  OPENING_LIGHT: 0.6,    // plan 7.2: odds an opening is light (3-8 loose gems, nothing near complete)
  OPENING_GIFT:  0.25,   // plan 7.2: odds it is a gift (one obvious clear, sometimes a sweep); the rest (~15%) are busy (the 6.0 opening)
  EARLY_AWKWARD: 0.15,   // weight multiplier for non-rectangles during those trays
  PAIR_CHANCE:   0.7,    // odds a tray carries a partner for an awkward piece (L/J/T/S/Z) from the previous tray
  TIDY:          2.0,    // how much hand choice favors a compact board (0 = ignore; higher = flatter, fewer holes)
  SWEEP_MIN: 6, SWEEP_MAX: 30,  // gem count range where a sweep is plausible

  // scoring
  LINE_POINTS: 10, COMBO_STEP: 0.5,
  SWEEP_BONUS: 300, SWEEP_PER_GEM: 25,

  // golden hand: a bonus tray that multiplies the points it earns
  GOLDEN_COMBO:    5,    // a combo this high (or higher) queues one for the next tray (so does a clean sweep)
  GOLDEN_CHANCE:   0.03, // random roll after every tray
  GOLDEN_COOLDOWN: 12,   // trays that must pass before another golden hand
  GOLDEN_MULT:     3,    // multiplier when she finds it: clears at least (planned lines - 1), min 1 (a planned sweep: 3+ lines)
  GOLDEN_MIN_LINES:3,    // a jackpot-style golden hand must offer at least this many lines (a planned sweep always qualifies)
  GOLDEN_PARTIAL:  2,    // consolation multiplier for any other clear during the hand; a miss costs nothing

  MAX_RESCUES: 1,        // rescues one run gets: one, offered on the game-over card (plan 7.1; rescueAllowed is the single gate, the ad hook)
  RESCUE_FLOOR: 300,     // offer a rescue only above this score...
  RESCUE_BEST_FRAC: 0.5, // ...or above this fraction of her best
  SHARDS: 8, SHAKE: 1.0, SPARKLE_RATE: 620,
  // juice — the feel layer (all toggleable from the Admin panel)
  FX_CHUNKS:      true,   // cleared gems burst outward as whole blocks (not slivers), away from where you placed
  FX_SCORE_ORBS:  true,   // (combo BIG_COMBO+) every cleared gem sends a glowing orb to the score, which bumps when they land
  FX_LAND_BUMP:   true,   // a placed piece thumps in (quick squash + ring) instead of appearing
  FX_PICKUP_GROW: true,   // a picked-up piece grows to board size over a few frames instead of snapping
  FX_LINE_PREVIEW:true,   // lines the held piece would clear light up in its colour
  FX_MAGNET:      false,  // on: the held piece seats into its landing slot and hops cell to cell. Off (default): it glides with the finger and a ghost marks the slot
  GHOST_ALPHA:    0.6,    // how solid the landing ghost is (the "snap" she sees on the board while the piece glides)
  MAGNET_REACH:   0.75,   // the slot is the nearest valid spot within this many cells of the floating piece, per axis; none in reach = no slot, release returns it
  MAGNET_HOLD:    0.05,   // hysteresis: the current slot is kept until the piece is this much farther out than REACH (or this much nearer another slot)
  GUIDE:          1.0,    // how much hand choice favours pieces that clear something RIGHT NOW, no sequence needed (0 = off)
  OBVIOUS:        12,     // plan 3.4: score per piece in a hand with an OBVIOUS clear (a 5-7/8 full line with one plain gap it drops into); 0 = off
  OBVIOUS_MAX:    2,      // ...counted for at most this many pieces: one or two easy moves a tray, not three (every tray a gift is too much)
  ALT:            0.5,    // plan 3.4: score per legal spot (up to 8) for the hand's smallest piece of 2+ cells: room to put the awkward one
  CLEAR_STYLE:    'crumble', // (7.5) 'crumble': a crack ripples along the line from the piece and each gem breaks into four pieces of itself that fall off the screen; 'squash': the line collapses to a glowing bar and is gone in ~100 ms (Block Blast's beat); 'burst': blocks fly out
  CLEAR_BLINK:    0,      // frames the whole line flashes white before it goes (0 = instant, like Block Blast)
  CRUMBLE_STAGGER:0.75,   // (7.5) crumble only: frames between one gem's crack and the next along the line, out from the placed piece (~12 ms)
  CLEAR_STAGGER:  0.35,   // frames of delay per cell of distance from the placed piece (the collapse ripples outward)
  FX_NARROW_ESCAPE: true, // (6.3) a short flourish when a clear lifts her out of the edge / a recovery
  FX_CELL_TAGS:   true,   // a little point value appears on every cleared cell
  FX_COMBO_SLAM:  true,   // (combo BIG_COMBO+) headline "COMBO n" slams in on every consecutive clear, with fireworks
  COLOR_GONE_BONUS: 60,   // points per colour wiped off the board by a clear ("COLOR GONE!")

  // Bonus trays (plan 6.2, replaces the Blast Round). Clears fill a small meter; when it is full the next BONUS_TRAYS
  // trays pay x BONUS_MULT automatically. Dealing is untouched: the bonus only multiplies points.
  BONUS_METER:    10,     // meter to fill: each clear adds its lines, plus 1 per combo step above the first (at most BONUS_COMBO_MAX)
  BONUS_COMBO_MAX: 2,     // most extra meter one clear can add for its combo
  BONUS_TRAYS:    3,      // trays the bonus lasts
  BONUS_MULT:     2,      // score multiplier while it lasts
  BIG_CAP:        4,      // the crowded-board small-piece bias stops growing past this many cells, so 5-9 cell pieces keep coming
  // star gem (4.5b): a single-cell piece that clears its whole row and column. Dealt only when a cross is worth it.
  STAR_MIN:      9,      // a star is dealt only if some empty cell's row + column would clear at least this many gems
  STAR_CHANCE:   0.15,   // odds per eligible tray (the board qualifies, specialOk(), cooldown over)
  STAR_COOL:     8,      // trays after a star is dealt before the next may be
  STAR_COMBO:    6,      // a combo this high (or higher) guarantees one in the next eligible tray
  STAR_PER_GEM:  14,     // points per gem cleared (x the combo factor); never less than the line formula
  STAR_CHARGE:   8,      // frames the star charges before its beams fire (drop to empty board, charge included, stays under ~600 ms)
  STAR_STAGGER:  0.7,    // frames of delay per cell of distance for its cross to go white-hot

  // the specials, one switch each (plan 4.5). Each comes back on once it has been rebuilt to be a real highlight:
  // All four specials are back (bonus trays 6.2, star 4.5b, golden hand 4.5c, transformations-as-achievements 4.5d). special(name) reads these.
  SPECIALS: {bonus:true, star:true, golden:true, transform:true},
  SPECIAL_FROM_TRAY: 6,  // no special before this tray number (plan 3.1: the opening is calm); see specialOk()
  BIG_COMBO: 3,          // the loud celebration (COMBO slam, score orbs, COLOR GONE band, fireworks, punch zoom) starts at this combo; every clear below it is calm: a squash, point tags and one praise word

  LIFT:          1.0,    // cells between the finger and the bottom edge of the dragged piece (same gap for every piece height)
  SMALL_BIAS:    3.0,    // density bias in weightedShape: higher = fewer big pieces as the board fills
  TIER_SOLVABLE: 0.0,    // (Adventure; Endless and Daily use the 6.1 phases) tension above this deals 'solvable' hands (2+ lines); at 0 there are no 'honest' hands — every tray can clear
  TIER_JACKPOT:  0.30,   // ...above this 'jackpot' hands (3+ lines)
  TIER_SWEEP:    0.85,   // ...above this a planned clean sweep (when off cooldown)

  // transformations — achievement-triggered event looks (own world + own tile skin), temporary
  TRANSFORM_PLACEMENTS: 9,     // how many placements one lasts
  TRANSFORM_MULT:       1.5,   // score multiplier while active
  TRANSFORM_COOLDOWN:   8,     // trays that must pass after one ends before another can start
  TRANSFORM_COMBO:      5,     // the combo that earns Volcano
  TRANSFORM_STAR_GEMS:  10,    // a star clearing at least this many gems earns Starfield (STAR_MIN is 9)
  FX_TRANSFORM_MOMENT:  true,  // the achievement card + sting (reduced motion: card and flip only)

  // event screen effects — each independently toggleable; none may ever draw over live board gems
  FX_COMBO_GLOW:     true,   // screen-edge glow in the combo colour, intensifying with the streak
  FX_GOLDEN_FANFARE: true,   // (4.5c) golden hand: planned-line glow, arrival sequence, completion celebration
  FX_GOLD_TINT:      true,   // faint full-screen gold wash while a golden hand is live
  FX_SWEEP_FX:       true,   // full-screen colour wash + confetti on a clean sweep
  FX_PRESSURE_SCREEN: true, // (6.6) Endless/Daily: sky wash, vignette, board rim and tray band follow the room and phase (Adventure keeps the tension border)
  FX_TENSION_BORDER: true,   // board border glow: calm (cool) -> warm as tension rises
  FX_STAR_BURST:     true,   // star gem: beam through it in the tray, hint ring on the best cell, charge + beams + sparkles on the clear
  FX_PUNCH_ZOOM:     true,   // (combo BIG_COMBO+) brief 2-3% punch zoom
  FX_ANTICIPATION:   true,   // (7.5c) while she drags a piece near a landing that completes a line, that line's gems shiver and a glint runs along it
  ANTIC_REACH:       2.5,    // (7.5c) cells from a completing landing where the shiver starts; it peaks as the piece arrives
  ANTIC_SHIVER:      1.2,    // (7.5c) most the gems move, in px (reduced motion: no movement, a steady soft glow)

  // sound — variant + volume for the two most-heard effects, set on the settings panel
  SND_SET:        'strings',  // everything but pickup/place: 'original' | 'strings' | 'steel' (recorded) | 'bells' (synth)
  SND_PICKUP:     'soft',     // 'original' | 'slide' | 'soft' | 'swish' (recorded) | 'off'
  SND_PLACE:      'drop',     // 'original' | 'drop' | 'wood' | 'soft' (recorded) | 'off'
  JOURNEY_SKY:    true,       // (7.5b) Endless/Daily: the sky travels dawn -> day -> golden hour -> night -> aurora -> space (Settings -> Look, Advanced)
  JOURNEY_AT:     [0,500,1500,3000,6000,10000],   // score where each journey stage starts; every clean sweep also jumps one stage
  JOURNEY_WAIT:   30,         // frames after a deal (or a sweep's confetti) before a stage change starts, so it never lands on a clear
  MUSIC:          true,       // (6.8) calm background music (Settings -> Sound); its own switch, independent of Sound effects
  MUSIC_PICK:     'shuffle', // (7.4) 'shuffle' or a MUSIC_TRACKS id (js/music.js); Off is the switch above
  MUSIC_VOL:      .5,         // 0..1; the music is quiet at .5 on purpose
  SND_PICKUP_VOL: 1,
  SND_PLACE_VOL:  1,
  ANTICIPATION_HUM: true,     // (7.5c) a soft tone that rises as she drags a piece toward a landing that completes a line (under Sound effects)
  HUM_VOL:        1,          // (7.5c) its level; 1 is very quiet on purpose
  PHONE_SPEAKER:  false,      // synth sounds only: cut the bass a phone speaker can't play (it just distorts)

  // frame budget (plan 2.2): the phone should never show a frame over FRAME_BUDGET_MS during a clear
  FRAME_BUDGET_MS: 20,   // a frame slower than this counts as long (the ?dev overlay counts them) and shrinks the particle budget
  PARTICLE_CAP:   260,   // most effect particles alive at once (fireworks, specks, dust, confetti); scaled down while frames run long
  DEAL_SLICE_MS:  4,     // ms of tray dealing per frame after a drop (the deal is spread over frames, never inside the clear's first one)

  SHOW_TENSION: false    // debug readout; off for the player (Admin can turn it on)
};

// Crumble — Tunable constants (CFG) — start here.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════════════════════════════════════════════════════════════
   TUNE THESE
   ═══════════════════════════════════════════════════════════════ */
// shared DOM lookup, used by every js/ file (defined here because this file loads first)
function el(id){ return document.getElementById(id); }

/* (8.0) Every point in the game is SCORE_SCALE times the old number, so a score reads as a big satisfying figure (a 40-point
   clear is now 400). Score-valued constants below are written as old*SCORE_SCALE; migrateScale() (save.js) rescales saves once. */
const SCORE_SCALE = 10;

const CFG = {
  GRID: 8,
  REC_PLAY: false,   // the play recorder (save.js): one record per tray in localStorage (Admin: Copy play log); always on with ?dev
  DEV_MODE: new URLSearchParams(location.search).has('dev'), // Admin panel only when the URL has ?dev (also ignores saved panel overrides otherwise)
  APP_STORE_ID: '',      // the app's Apple ID, 6833015504 (App Store Connect, App Information). Set it here ON LAUNCH DAY: the web start card then
                         // links to the App Store (before release that link would show Apple's "not available" page). Safari's banner is index.html's apple-itunes-app tag.
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
  WAVE_MIN:       3,     // a payoff tray is due every WAVE_MIN..WAVE_MAX trays (8.2: was 4..6)
  WAVE_MAX:       5,
  PAYOFF_LINES:   2,     // a payoff hand: a big block clearing this many lines in one drop (8.2: failing that, any piece that does)
  PAYOFF_TRIES:   12,    // candidate payoff hands looked at
  BUILD_UP:       4,     // (8.2) the honest tray before a payoff favours a hand whose tidiest play leaves a gap a big block clears 2+ lines in (score per such block)
  BUILD_TRIES:    6,     // ...and looks at this many candidate hands, not HONEST_TRIES
  BUILD_W:        1.6,   // weight on the squaring-off pieces (2x2, 2x3, 3x2, 1x3/3x1, 1x4/4x1) in ordinary trays
  SETUP_CHANCE:   0.75,   // per tray, odds an open setup's exact piece is dealt (one offer per setup)
  SETUP_TRAYS:    3,     // trays a setup stays open
  SETUP_WALLED:   0.85,  // share of a hole's edge neighbours that must be filled or wall for it to count as squared off
  CLOSER_GEMS:    14,    // a clear leaving this many gems or fewer earns a closer (a planned sweep with a shimmer on the tray)
  CLOSER_COMBO:   3,     // ...so does reaching this combo (and getting out of an edge hold)
  CLOSER_TARGET:  20,    // most empty cells a closer's three pieces may fill
  CLOSER_COOL:    5,     // trays after a closer before the next
  SWEEP_HUNT_CELLS: 22,  // (1.1 A) the sweep hunt: most empty cells in a cover (the rows/columns a sweep completes)
  SWEEP_HUNT_NODES: 4000,//   search cap per hunt
  SWEEP_HUNT_COVERS: 16, //   most covers tried per hunt (tightest first)
  CHASE_GEMS:     26,    // (1.1 A) two-tray chase: no sweep on a board of this many gems or fewer deals a set-up hand toward one
  CHASE_TRIES:    0,     //   candidate set-up hands looked at (0 = off: measured too small a gain for its cost; see chaseSteps)
  CHASE_NODES:    1500,  //   hunt cap per candidate
  CHASE_COOL:     5,     //   trays after a chase that found nothing before the next search
  CHASE_EVAL:     1200,  //   solver budget per candidate (only the boards it can leave are wanted)
  RUN_TRAYS:      3,     // (1.1) the sweep run: most trays dealt toward a sweep on a low calm board (0 = off; see runHandSteps)
  RUN_GEMS:       20,    //   ...starts on a board of this many gems or fewer
  RUN_SLACK:      4,     //   ...and ends if the board grows past RUN_GEMS + this
  RUN_TRIES:      48,    //   candidate hands per run tray (each played out the quick way, predictPlay)
  RUN_HUNTS:      8,     //   ...of which the closest to a sweep are hunted
  RUN_COOL:       6,     //   trays after a run (paid or not) before the next run or closer
  SWEEP_AIM:      0,     // (1.1 A) off cooldown, ordinary hands lean toward boards close to a sweep: score per empty cell of the gap (0 = off).
                         //   Off: it is help on honest trays, so it belongs to the Endless pacing decision. Measured at 1 (with the chase on):
                         //   sweep hands 1 per 120-210 trays instead of 1 per 190-220, games longer; at 4 games got much shorter (boards worse).
  AIM_GEMS:       30,    //   ...on boards of this many gems or fewer
  AIM_TRIES:      6,     //   ...and an honest tray looks at this many candidates, not HONEST_TRIES
  DRY_TRAYS:      4,     // trays with no clear that make a payoff tray due now (lines, never a sweep; 8.2: was 6)
  JACKPOT_MIN:    8,     // (8.2) a jackpot hand, behind the scenes (no banner, no multiplier): all three pieces clear JACKPOT_LINES+
  JACKPOT_MAX:    12,    //   lines in sequence (or a planned sweep), due every JACKPOT_MIN..MAX trays; it waits while the board is on the edge
  JACKPOT_LINES:  3,
  JACKPOT_DRY:    1,     //   each tray with no clear brings it this many trays sooner (a dry spell runs it forward)
  JACKPOT_TRIES:  48,    //   candidate hands the jackpot search looks at
  JACKPOT_EACH:   15,    //   score per piece of the hand that clears a line right now (so it pays drop by drop, not only to a planned order)
  BIG_FLOOR:      5,     // pieces of 4+ cells across any five trays, kept where they fit
  FX_CLOSER_GLOW: true,  // the shimmer behind a closer tray

  // (1.1 G) coaster dealing, Endless and Daily: the tide deals EASY stretches (big pieces that fit, lines everywhere) and
  // LEAN ones (awkward pieces, few free clears), and every tray has a solution; see solver.js "Coaster dealing". Challenge,
  // Adventure and the guided first game do not use it. Nothing on screen shows the stretch.
  TIDE:           true,  // off = the 1.0 dealer (payoff waves, jackpots, setups, gifts) for Endless and Daily too
  TIDE_EASY_MIN:  10,    // an EASY stretch lasts this many trays at least...
  TIDE_EASY_MAX:  18,    //   ...and at most (rolled per stretch)
  TIDE_LEAN_MIN:  6,     // a LEAN stretch, the same
  TIDE_LEAN_MAX:  10,
  TIDE_SMALL:     0.4,   // weight on pieces of 3 cells or fewer, both stretches (lower = bigger pieces overall)
  TIDE_FIT:       0.6,   // EASY: how much a piece's fit to the board (lines its best drop clears, how flush it sits) raises its odds
  EASY_BIG:       2.5,   // EASY: score per cell of the hand (higher = bigger pieces win more of the search)
  EASY_ROOM:      15,    // EASY: score for the room left by her likely play (0..1 room), so big pieces come where they leave space
  EASY_CASH:      2,     // (round 2) EASY: score per gem the hand can clear (a cash-in tray)
  EASY_SWEEP:     60,    //   ...a hand her quick play would sweep with
  EASY_STEER:     3,     //   ...late in the stretch, minus this per cell of distance to a sweep on the board she will leave
  EASY_LOW:       2,     //   ...minus this per gem left on the board her quick play leaves (EASY drives the board down)
  EASY_RUN_GEMS:  28,    // (round 2) in EASY the sweep run starts on boards this low (0 = as in calm), and neither it nor the sweep hunt waits for a cooldown
  EASY_RUN_TRAYS: 5,     //   ...and an EASY sweep run lasts up to this many trays
  BIG_SOLVE: 18,         // (round 3) an EASY tray on a board with BIG_READY nearly-done lines hunts the hand that clears the most lines at once (points per line past 2; 0 = off)
  BIG_READY: 3,          //   ...nearly-done lines it takes
  BIG_FIRST: 2,          //   ...the first this many EASY trays of a stretch skip the sweep run for it
  BIG_READY_CELLS: 5,    //   ...cells of 8 a line needs to count as nearly done
  SWEEP_EASE_K: 8,       // (round 5) plays a sweep hand is tried with, varied like a person (sweepEase); 0 = off
  SWEEP_EASE: 0.5,       //   ...share of them that must sweep for a run hand to count as a sweep
  SWEEP_EASE_W: 4,       //   ...the sweep hunt's score for a hand every such play sweeps
  SWEEP_EASE_HUNT: 0,    //   ...a hunted sweep hand is only dealt if this share of those plays sweep (0 = always)
  EASY_RECT: true,       // (round 5) EASY stretches deal rectangles and bars only: boards stay blocky, so big clears and board clears line up for a person
  CROWD_ROOM: 0.35,      // (round 6) a board tighter than this (roomBits) or with CROWD_GEMS gems is crowded: every tray brings a piece that finishes a line (0 = off)
  CROWD_GEMS: 34,        //   ...gems that count as crowded whatever the room
  CROWD_TWO: 0.5,        //   ...odds a crowded-board candidate carries two such keys
  CROWD_KEY: 20,         //   ...score per key piece (up to two), and three times it off for a tray with none
  CHAIN_BUILD: 0.8,      // (round 6) odds the tray after a board clear is big matching pieces that rebuild rows (Block Blast's chain of clears)
  OPEN_BUILD: 0.7,       // (round 4) odds an Endless or Daily game opens on an empty board with three of one piece (rectangle, bar or big L) to build off
  MATCH: 25,             // (round 4) EASY score for a tray of three alike (60% of it for two alike): a tray she reads as one plan
  MATCH_TRY: 0.35,       //   ...odds an EASY candidate is built that way
  FOLLOW: 40,            // (round 4) EASY penalty for a tray with no piece that clears right now, when the board has one
  SMALL_CAP: 30,         // (round 3) EASY penalty per small piece (3 cells or fewer) past the first in a tray, unless the tray clears the board; any value above 0 also keeps sweep-run trays to one small piece
  LEAN_PUZZLE:    25,    // (round 2) LEAN: score for a tray where a piece only fits after another clears (hard, then you see it)
  LEAN_PUZZLE_TRY: 0.35, //   ...odds a LEAN candidate carries such a piece
  EASY_TRIES:     24,    // candidate hands an EASY tray looks at
  LEAN_TRIES:     16,    // candidate hands a LEAN tray looks at
  LEAN_LINES:     1,     // a LEAN tray offers at most about this many lines (unless it is a rescue)
  LEAN_DRY:       3,     // LEAN's quiet rescue: after this many trays with no clear a piece that clears comes...
  LEAN_ROOM:      0.3,   //   ...and on any board with less room than this (she made a mess: the dealer helps instead of holding to the stretch)
  SOUND_ROOM:     0.12,  // a piece's sound spot may cost at most this much room (0..1) when it clears nothing

  // the home dealer (solver.js "The home dealer"): every piece has a home and the tray is cut from the board. Replaces the
  // tide in Endless and Daily when on; Challenge and Adventure never use it. Also on with ?dealer=home in the URL (off: ?dealer=tide).
  DEALER_HOME: /[?&]dealer=home(&|$)/.test(location.search),   // off by default
  HOME_BUMP:      2,     // a home that clears nothing may raise the raggedness (walls count as filled) by at most this (0 = only snug spots)
  HOME_COOL_MIN:  8,     // after win mode, this many cool trays at least (TWIST and STEADY, never a gift)...
  HOME_COOL_MAX:  12,    //   ...and at most (rolled per stretch)
  HOME_EARN:      3,     // after the cool stretch win mode starts once this many lines are nearly done (or a crowded or low board)
  HOME_WIN_WAIT:  4,     // ...or anyway after this many warm trays
  HOME_WIN_MAX:   8,     // win mode lasts until the board is wiped (and its BUILD tray), or this many trays...
  HOME_WIN_DRY:   2,     //   ...or this many trays in a row in which she cleared no line
  HOME_TWIST:     0.95,   // odds a cool tray is a TWIST (builds the board up, 0-1 lines) rather than a STEADY (1-2 lines)
  HOME_RESCUE_ROOM: 0.1,  // a board with less room than this gets a rescue tray whatever the phase (in a cool stretch no gift)
  HOME_FINISH_GEMS: 18,  // a board this low (and not empty) is low: FINISH trays may come, and a home that clears nothing must sit flush
  HOME_FINISH:    0.6,   // odds a low board gets a FINISH tray (the pieces that clear it, or leave the least), any phase
  HOME_FINISH_HOT: 0.85, //   ...the odds in win mode (the heater)
  HOME_FINISH_MAX: 3,    // at most this many FINISH trays in a row, then the phase's own kind
  HOME_BLOCKY:    false, // (experiment) the cool stretch deals TIGHT trays: big pieces at strictly flush homes that keep the gems in few lines (no scatter); win mode prefers big multi-line drops
  HOME_WIPE_KEEP: 0.75,  // after the n-th board wipe in a row (each within 4 trays of the last) the chain's help carries on with odds this^n, else a cool stretch without it

  // the Block Blast curve (solver.js "The Block Blast curve"): no phases, every slot's class is rolled from what 253 Block Blast trays
  // showed. Endless and Daily only; beats DEALER_HOME when both are on. Also on with ?dealer=curve in the URL.
  DEALER_CURVE: /[?&]dealer=curve(&|$)/.test(location.search),   // off by default
  CURVE_TABLE: [26,70, 50,46, 70,25, 80,6],   // per gems bucket 0-12, 13-24, 25-36, 37+: % of slots rolled CLEAR, FLUSH (the rest FREE)
  CURVE_MIX: [['1x5',108],['3x3',105],['2x3',101],['L4',80],['1x4',72],['L5',60],['2x2',52],['S4',38],['T4',24],['1x3',23],['1x1',17],['L3',10],['1x2',5]],   // Block Blast's shape counts (rotations pooled; its 3 diagonals have no shape here)
  CURVE_SMALL: [5,6,12,21],   // % of pieces of 3 cells or fewer, per gems bucket (scales the small shapes of CURVE_MIX)
  CURVE_MULTI:  2,       // a CLEAR piece's odds go with (1 + lines its best drop clears) to this power (big multi-line drops)
  CURVE_DENSE:  1,       // a FLUSH piece's odds go with e^(this x its best flush spot's density: nearly-done lines gained, less half the new lines it opens)
  CURVE_HEAT:   0.5,     // the luck dial: how far the slow random walk `heat` (-1..1) shifts the table (0 = the table alone)
  CURVE_GIVE:   0,       // generosity: added to every bucket's CLEAR share (taken from FLUSH and FREE), -0.3..0.3
  CURVE_TWINS:  0.11,    // odds the tray dealt on an emptied board is three of one big piece
  CURVE_EASE:   0.75,    // share of 8 person-like plays (personPlays) that must get all three pieces down, else the pieces are re-picked (0 = off)

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
  LINE_POINTS: 10*SCORE_SCALE, COMBO_STEP: 0.5,
  COMBO_CARRY: true,     // (round 6) Endless and Daily: the combo survives drops that clear nothing while she clears again within COMBO_GRACE drops (Block Blast's streak)
  COMBO_GRACE: 3,        //   ...drops in a row without a clear that end the streak
  SWEEP_BONUS: 300*SCORE_SCALE, SWEEP_PER_GEM: 25*SCORE_SCALE,

  // golden hand: a bonus tray that multiplies the points it earns
  GOLDEN_COMBO:    5,    // a combo this high (or higher) queues one for the next tray (so does a clean sweep)
  GOLDEN_CHANCE:   0.03, // random roll after every tray
  GOLDEN_COOLDOWN: 12,   // trays that must pass before another golden hand
  GOLDEN_MULT:     3,    // multiplier when she finds it: clears at least (planned lines - 1), min 1 (a planned sweep: 3+ lines)
  GOLDEN_MIN_LINES:3,    // a jackpot-style golden hand must offer at least this many lines (a planned sweep always qualifies)
  GOLDEN_PARTIAL:  2,    // consolation multiplier for any other clear during the hand; a miss costs nothing

  MAX_RESCUES: 1,        // rescues one run gets: one, offered on the game-over card (plan 7.1; rescueAllowed is the single gate, the ad hook)
  RESCUE_FLOOR: 300*SCORE_SCALE,     // offer a rescue only above this score...
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
  CRUMBLE_STAGGER:0.4,    // (7.5) crumble only: frames between one gem's crack and the next along the line, out from the placed piece (~7 ms; was 0.75)
  CLEAR_STAGGER:  0.35,   // frames of delay per cell of distance from the placed piece (the collapse ripples outward)
  FX_NARROW_ESCAPE: true, // (6.3) a short flourish when a clear lifts her out of the edge / a recovery
  FX_PIECE_COLOR_CLEAR: true, // (D) a cleared line turns the colour of the piece that cleared it and breaks in that colour
  FX_ONE_VOICE:   true,   // (A) one headline at a time: praise or COMBO n, then COLOR GONE, then a banner, each with the board to itself
  FX_HERO_STAMP:  true,
  FX_SWEEP_SHOW:  true,   // (B) a clean sweep is a ~2 s show: the board floods with gems and drains, two crumbs cheer SWEEP ×N, then the new world (sky / look) arrives
  SWEEP_SHOW_LEN: 118,    // (B) frames from the last gem breaking to the new world   // (C) a big moment stamps a little crumb on each gem of the piece that made it
  FX_CELL_TAGS:   true,   // a little point value appears on every cleared cell
  FX_COMBO_SLAM:  true,   // (combo BIG_COMBO+) headline "COMBO n" slams in on every consecutive clear, with fireworks
  COLOR_GONE_BONUS: 60*SCORE_SCALE,   // points per colour wiped off the board by a clear ("COLOR GONE!")

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
  STAR_PER_GEM:  14*SCORE_SCALE,     // points per gem cleared (x the combo factor); never less than the line formula
  STAR_CHARGE:   8,      // frames the star charges before its beams fire (drop to empty board, charge included, stays under ~600 ms)
  STAR_STAGGER:  0.7,    // frames of delay per cell of distance for its cross to go white-hot

  // the specials, one switch each (plan 4.5). Each comes back on once it has been rebuilt to be a real highlight:
  // All four specials are back (bonus trays 6.2, star 4.5b, golden hand 4.5c, transformations-as-achievements 4.5d). special(name) reads these.
  SPECIALS: {bonus:true, star:true, golden:true, transform:true},
  SPECIAL_FROM_TRAY: 6,  // no special before this tray number (plan 3.1: the opening is calm); see specialOk()
  BIG_COMBO: 3,          // the loud celebration (COMBO slam, score orbs, COLOR GONE band, fireworks, punch zoom) starts at this combo; every clear below it is calm: a squash, point tags and one praise word

  MOUSE_LIFT:    0.15,   // (C2) the lift for a mouse drag (a cursor is a point, not a thumb); touch and pen use LIFT
  SLOT_TICK_MS:  40,     // (C1) at most one selection tick this often as the landing cell changes (app only)
  PICKUP_GROW:   0.5,    // (speed) share of the pickup grow + lift per frame: 0.5 = 2 frames (~33 ms). Was 0.2 (5 frames), the piece trailed the thumb
  SCORE_COUNT:   0.25,   // (speed) share of the gap the score counts up each frame: done in ~300 ms. Was 0.09 (~1 s)
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
  FX_COMBO_FIRE:     true,   // (7.5d) from combo BIG_COMBO the board rim burns (hotter each step), the dragged piece sheds embers, the tray glows; a miss snuffs it in a puff
  FX_CHASE:          true,   // (7.5e) Endless: a bar under the score fills toward her best ("N to beat" near the end); passing it jumps the journey sky a stage
  CHASE_NEAR:        .75,    // (7.5e) from this share of her best the "N to beat" shows
  CHASE_HOT:         .9,     // (7.5e) from this share the bar glows
  CHASE_SKY_MIN:     500*SCORE_SCALE,    // (7.5e) a best below this beats with the banner only, so a tiny early best does not skip dawn
  FX_MASCOT:         true,   // (7.5f) a cookie crumb on the board's top-left corner: nods/hops/smirks on clears, sweats when it is tight, faints on game over (js/mascot.js)
  FX_TIMELAPSE:      true,   // (7.5g) the run's boards are recorded (capped, in the run save) and replay on the game-over card (js/timelapse.js)
  FX_ANTICIPATION:   true,   // (7.5c) while she drags a piece near a landing that completes a line, that line's gems shiver and a glint runs along it
  ANTIC_REACH:       2.5,    // (7.5c) cells from a completing landing where the shiver starts; it peaks as the piece arrives
  ANTIC_SHIVER:      1.2,    // (7.5c) most the gems move, in px (reduced motion: no movement, a steady soft glow)

  // sound — variant + volume for the two most-heard effects, set on the settings panel
  SND_SET:        'original',   // everything but pickup/place: 'original' | 'strings' | 'steel' (recorded) | 'bells' (synth)
  SND_PICKUP:     'soft',     // 'original' | 'slide' | 'soft' | 'swish' (recorded) | 'off'
  SND_PLACE:      'drop',     // 'original' | 'drop' | 'wood' | 'soft' (recorded) | 'off'
  JOURNEY_SKY:    true,       // (7.5b) Endless/Daily: the sky travels dawn -> day -> golden hour -> night -> aurora -> space (Settings -> Look, Advanced)
  JOURNEY_AT:     [0,500,1500,3000,6000,10000].map(n=>n*SCORE_SCALE),   // score where each journey stage starts; every clean sweep also jumps one stage
  JOURNEY_WAIT:   30,         // frames after a deal (or a sweep's confetti) before a stage change starts, so it never lands on a clear
  HAPTICS:        true,       // (5.1) the iPhone app buzzes on pickup, place, clears, combos (js/native.js); the web build has nothing to buzz
  MUSIC:          true,       // (6.8) calm background music (Settings -> Sound); its own switch, independent of Sound effects
  MUSIC_PICK:     'shuffle', // (7.4) 'shuffle' or a MUSIC_TRACKS id (js/music.js); Off is the switch above
  MUSIC_VOL:      .5,         // 0..1; the music is quiet at .5 on purpose
  MUSIC_ROTATE:   180,        // (8.5) Shuffle: seconds on one loop before it crossfades to another at the loop's end (0 = only on a new game)
  SND_PICKUP_VOL: 1,
  SND_PLACE_VOL:  1,
  PHONE_SPEAKER:  false,      // synth sounds only: cut the bass a phone speaker can't play (it just distorts)

  // frame budget (plan 2.2): the phone should never show a frame over FRAME_BUDGET_MS during a clear
  FRAME_BUDGET_MS: 20,   // a frame slower than this counts as long (the ?dev overlay counts them) and shrinks the particle budget
  PARTICLE_CAP:   260,   // most effect particles alive at once (fireworks, specks, dust, confetti); scaled down while frames run long
  DEAL_SLICE_MS:  12,    // ms of tray dealing per frame after a drop (never inside the clear's first one). (speed) Was 4: a deal is ~2 ms (9 ms on a
                         // hard tray), so 12 finishes almost every deal in one frame; 4 ms slices tied to slow frames left the tray empty for 150-800 ms
  // (8.5) frame pacing, for battery and heat: full speed only while something moves fast (see frameGap in draw.js)
  FRAME_PACING:   true,  // off = redraw the whole screen every frame, as before
  FRAME_FULL_MS:  2500,  // full speed for this long after any touch (and after a deal, a score or the run's state changes)
  FRAME_DOZE_MS:  20000, // then 30 frames a second; after this long with no touch, 15

  // (1.1 D) the guided first game: a brand-new player's first three trays are hand-built lessons (js/guide.js)
  GUIDE:          true,  // off = a new player opens like everyone else
  GUIDE_HINT_MS:  6000,  // a lesson's target cells pulse after this long with no piece picked up
  GUIDE_WAIT:     20,    // frames between a lesson's last drop and the next board (the clear plays out first)

  SHOW_TENSION: false    // debug readout; off for the player (Admin can turn it on)
};

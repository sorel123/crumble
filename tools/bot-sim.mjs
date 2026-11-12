// Bot sim for the dealer (plan 3.4). Plays the real game in headless Chromium with a simple "kid" bot
// and reports how often a tray offers her an obvious clear, by how full the board was when it was dealt.
//
//   node tools/bot-sim.mjs [trays=4000] [seed=1] [KEY=value ...]
//
// KEY=value pairs override CFG for the run (e.g. OBVIOUS=0 ALT=0 measures the dealer without plan 3.4's terms).
//
// The bot plays like someone who is not thinking: if a piece has an obvious clear (plan 3.4's definition,
// below) it plays that (since 7.3 the obvious drop that clears the most lines); otherwise it puts the biggest piece where it sits most flush (most filled or wall
// neighbours). Game over starts a new game. Each tray is bucketed by the board fill when it was dealt
// (30%, 45%, 60%, each +-5 points). For every bucket it reports:
//   obvious@deal  the tray as dealt holds a piece with an obvious clear (she can clear with her first drop)
//   clear/tray    the bot cleared at least one line while playing the tray
// plus the median board fill over all trays and the dealer's cost per tray (ms, this machine).
//
// Obvious clear: a piece that completes a line right now, where that line already had at least 5 of 8
// cells filled and its empty cells were one single run (which the piece fills exactly). The bot carries
// its own copy of the rule so the same bot measures the dealer before and after it learned the rule.
//
// Plan 6.1 (pressure and recovery) adds:
//   BOT=square     (1.1) the casual bot, but after an obvious clear it first takes a square-off: a piece that fills a notch
//                  exactly (every side flush) or fills its own bounding box up with gems already there (an L into a corner).
//   BOT=strong     a strong bot instead: it searches the tray (every piece, every spot, a beam of the best 10 boards
//                  per step, scored on the room left, roomBits) and plays the first move of the best sequence.
//   RESCUE=1       use rescues when stuck (the game's own rule: one rescue per run, on the game-over card).
// and reports, per game (a game ends when no tray piece fits, so without RESCUE=1 it is "trays to the first stuck"):
// the median and quartiles of trays per game, the share of trays dealt in each phase, how often a recovery
// tray was cleared, relief moments (a relief phase starting) per game and the median trays between them,
// and planned sweeps and golden hands per game.
// Plan 7.3 (payoff waves, setups, closers) adds to the pace line: traysPerMulti (trays per multi-line clear), resetsPerGame (full
// sweeps), closersPerGame / payoffsPerGame, traysBetweenPayoffs, setupsPaid (setups whose piece came within three trays, not counting
// holes she filled before the next tray), setupsPerTray, smallOnlyTrays / longestSmallRun (trays of pieces of 3 cells or fewer),
// big4Per5 (fewest 4+ pieces in any five trays), and the difficulty guards gamesEnded, p10 (10th percentile game length), edgeHoldsPerGame.
// Plan 8.2 (more clearing hands) adds traysPer3Lines (trays per tray in which the bot cleared 3+ lines in all), jackpotsPerGame
// (behind-the-scenes jackpot trays) and traysPerBigHand (trays per jackpot, golden, closer or planned-sweep tray).
// The home dealer (DEALER_HOME=1 to try it) adds a 'home:' line for any dealer: traysPerSweep, gemsAtDeal and gemsAfterClear
// (medians: gems on the board when a tray is dealt, and right after a drop that cleared lines), noHome (share of dealt pieces with no
// home, solver.js homeAt, on the board as dealt or after one or two tray-mates are dropped at homes; noHomeNow: none on the board as
// dealt), meanPiece, share3plus (trays the bot cleared 3+ lines in), runs3plus (in finished games, how many runs of consecutive such
// trays had each length), games (length quantiles), dealMs, finish (FINISH trays dealt, the share that can empty the board, ·CLEAR,
// and the share of those the bot emptied), and the home dealer's kinds; win (win modes started, the share that ended in a board wipe,
// at the cap and dry, games that ended in one (over), mean length, flat: win-mode trays with no WIN tray), low8 (trays dealt on a board
// of 8 gems or fewer) and byPhase (per coaster phase: trays, share the bot cleared a line in, lines per tray, median gems at deal).
// wipes (finished games: board wipes, trays per wipe, the median and p90 trays between wipes, the longest wipe-less stretch, and rows of
// wipes each within 4 trays of the one before, by length) and blocky (per phase, boards of 10+ gems at deal: lines holding gems, roughBits, each per gem).
// 1.1 A (sweep chase) adds sweepHands (trays dealt with the sweep shimmer: a closer or planned sweep), traysPerSweepHand,
// sweepHandsConverted (share of those the bot swept), chases (two-tray set-up hands), sweepsAll / traysPerSweep (every clean sweep).
import { serve, openGame, play } from '../tests/harness.mjs';

const args = process.argv.slice(2), kv = args.filter(a => a.includes('=')), pos = args.filter(a => !a.includes('='));
const TRAYS = +(pos[0] || 4000), SEED = +(pos[1] || 1);
const OVR = Object.fromEntries(kv.map(a => { const [k, v] = a.split('='); return [k, isNaN(+v) ? v : +v]; }));
const BOT = OVR.BOT || 'casual', RESCUE = !!OVR.RESCUE; delete OVR.BOT; delete OVR.RESCUE;
const srv = await serve();
const { browser, page } = await openGame(srv.url, { seed: SEED });
await page.evaluate(o => Object.assign(CFG, o), OVR);
await play(page);
const out = await page.evaluate(([TRAYS, BOT, RESCUE]) => {
  const obviousLine = cells => {           // cells: 8 booleans along the line
    let n = 0, runs = 0;
    for (let i = 0; i < 8; i++) { if (cells[i]) n++; else if (i === 0 || cells[i - 1]) runs++; }
    return n >= 5 && n < 8 && runs === 1;
  };
  // does placing s at (r,c) on g complete a line that was obvious before the drop?
  const obviousAt = (s, r, c, g) => {
    const rows = new Set(), cols = new Set();
    for (const [dr, dc] of s.cells) { rows.add(r + dr); cols.add(c + dc); }
    const after = (rr, cc) => g[rr][cc] || s.cells.some(([dr, dc]) => r + dr === rr && c + dc === cc);
    for (const rr of rows) {
      const before = g[rr].map(Boolean);
      if (obviousLine(before) && before.every((v, cc) => after(rr, cc))) return true;
    }
    for (const cc of cols) {
      const before = g.map(row => !!row[cc]);
      if (obviousLine(before) && before.every((v, rr) => after(rr, cc))) return true;
    }
    return false;
  };
  const flush = (s, r, c, g) => {
    let k = 0;
    for (const [dr, dc] of s.cells) for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr + a, cc = c + dc + b;
      if (s.cells.some(([x, y]) => x === dr + a && y === dc + b)) continue;
      if (rr < 0 || cc < 0 || rr >= N || cc >= N || g[rr][cc]) k++;
    }
    return k;
  };
  let hs = 12345; const hr = () => { hs = (hs + 0x6D2B79F5) >>> 0; let t = hs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // BOT=human's own dice (never the dealer's)
  const choose = () => {                    // [trayIdx, r, c, obvious] or null
    let ob = null, obL = 0;                 // (7.3) of the obvious drops, the one that clears the most lines: a big gap a big block drops into is what she sees first
    for (let i = 0; i < 3; i++) {
      const t = tray[i]; if (!t) continue;
      for (let r = 0; r <= N - t.s.rows; r++) for (let c = 0; c <= N - t.s.cols; c++)
        if (canPlace(t.s, r, c, grid) && obviousAt(t.s, r, c, grid)) {
          const g2 = grid.map(row => row.slice()); for (const [dr, dc] of t.s.cells) g2[r + dr][c + dc] = 1;
          const l = linesFor(g2); const n = l.rows.length + l.cols.length;
          if (n > obL) { obL = n; ob = [i, r, c, true]; }
        }
    }
    if (ob && (BOT !== 'human' || hr() < 0.85)) return ob;   // (round 5) BOT=human misses some obvious clears
    if (BOT === 'square') {                 // (1.1 sweep run) a player who sees a square-off: a piece that fills a notch exactly, or
      let sq = null, sqN = 0;               // whose bounding box it fills up with gems already there (an L into a corner); the biggest one
      for (let i = 0; i < 3; i++) {
        const t = tray[i]; if (!t || t.s.star || t.s.n <= sqN) continue;
        for (let r = 0; r <= N - t.s.rows; r++) for (let c = 0; c <= N - t.s.cols; c++) {
          if (!canPlace(t.s, r, c, grid)) continue;
          const own = (rr, cc) => t.s.cells.some(([dr, dc]) => r + dr === rr && c + dc === cc);
          let per = 0; for (const [dr, dc] of t.s.cells) for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (!t.s.cells.some(([x, y]) => x === dr + a && y === dc + b)) per++;
          let box = t.s.n < t.s.rows * t.s.cols;
          for (let rr = r; box && rr < r + t.s.rows; rr++) for (let cc = c; cc < c + t.s.cols; cc++) if (!grid[rr][cc] && !own(rr, cc)) { box = false; break; }
          if (box || flush(t.s, r, c, grid) === per) { sq = [i, r, c, false]; sqN = t.s.n; break; }
        }
      }
      if (sq) return sq;
    }
    if (BOT === 'human') {                  // (round 5) a person: any piece first, a snug spot, not always the snuggest (up to three spots within one of the snuggest)
      const order = [0, 1, 2].filter(i => tray[i]).sort(() => hr() - 0.5);
      for (const i of order) {
        const s = tray[i].s, c3 = [];
        for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) if (canPlace(s, r, c, grid)) c3.push([flush(s, r, c, grid), r, c]);
        if (!c3.length) continue;
        c3.sort((a, b) => b[0] - a[0]); const top = c3.filter(x => x[0] >= c3[0][0] - 1), p = top[(hr() * Math.min(3, top.length)) | 0];
        return [i, p[1], p[2], false];
      }
      return ob;
    }
    const order = [0, 1, 2].filter(i => tray[i]).sort((a, b) => tray[b].s.n - tray[a].s.n);
    for (const i of order) {
      const s = tray[i].s; let best = null, bk = -1;
      for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++)
        if (canPlace(s, r, c, grid)) { const k = flush(s, r, c, grid); if (k > bk) { bk = k; best = [i, r, c, false]; } }
      if (best) return best;
    }
    return null;
  };
  // the strong bot: a beam search over the tray, scored on room (plan 6.1) plus lines, dead ends ruled out
  const strong = () => {
    const [lo0, hi0] = packBits(packGrid(grid));
    const left0 = [0, 1, 2].filter(i => tray[i]);
    const value = (lo, hi, left, lines) => {
      for (const i of left) if (!placeMasks(tray[i].s).some(m => !(lo & m.lo) && !(hi & m.hi))) return -1000 + lines;
      return roomBits(lo, hi) * 100 + lines * 4 - roughBits(lo, hi) * 0.3;
    };
    let beam = [{ lo: lo0, hi: hi0, left: left0, lines: 0, first: null }];
    let best = null;
    while (beam.length && beam[0].left.length) {
      const next = [];
      for (const st of beam) for (const i of st.left) {
        const s = tray[i].s;
        for (const m of placeMasks(s)) {
          if ((st.lo & m.lo) || (st.hi & m.hi)) continue;
          const l = applyBits(st.lo, st.hi, s, m), left = st.left.filter(j => j !== i);
          const n = { lo: _lo, hi: _hi, left, lines: st.lines + l, first: st.first || [i, m.r, m.c, false] };
          n.v = value(n.lo, n.hi, left, n.lines);
          next.push(n);
        }
      }
      next.sort((a, b) => b.v - a.v);
      beam = next.slice(0, 10);
      if (beam.length && (!best || beam[0].v > best.v || beam[0].left.length === 0)) best = beam[0];
    }
    return best ? best.first : null;
  };
  const fillOf = () => grid.flat().filter(Boolean).length / (N * N);
  const finishDeal = () => { if (dealing) { const t0 = performance.now(); runSteps(dealing.it); dealing = null; costs.push(performance.now() - t0); } };
  const costs = [], trays = [], afterClear = [];
  let cur = null, games = 0, goldens = 0, rescues = 0;
  const newTray = () => {
    const obvN = tray.filter(t => { if (!t) return false; for (let r = 0; r <= N - t.s.rows; r++) for (let c = 0; c <= N - t.s.cols; c++) if (canPlace(t.s, r, c, grid) && obviousAt(t.s, r, c, grid)) return true; return false; }).length, obv = obvN > 0;
    const possible = SHAPES.some(s => { for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) if (canPlace(s, r, c, grid) && obviousAt(s, r, c, grid)) return true; return false; });
    const offers2 = (() => { const [lo, hi] = packBits(packGrid(grid)); return tray.some(t => t && !t.s.star && placeMasks(t.s).some(m => !(lo & m.lo) && !(hi & m.hi) && applyBits(lo, hi, t.s, m) >= 2)); })();
    // (1.1 G) the fit numbers and the coaster: what the tray is as dealt, from the board it was dealt on
    const a0 = packGrid(grid), [glo, ghi] = packBits(a0), shp = tray.filter(Boolean).map(t => t.s);
    const awkK = s => !s.star && s.n !== s.rows * s.cols && s.n !== 5;     // S, Z, T, L, J, hooks (the 5-cell corners count as big L's)
    const full = shp.length === 3 ? evalHand(a0, shp, 200000) : null;
    const tideSt = typeof hdOn === 'function' && hdOn() ? 'home' : typeof tideOn === 'function' && tideOn() ? tide.st : 'flat';
    const fit = { st: tideSt, avail: full ? full.lines : 0, solvable: full ? full.ok : true, awk: shp.filter(awkK).length,
      sizes: shp.filter(s => !s.star).map(s => s.n), multiPieces: shp.filter(s => !s.star && bestDrop(glo, ghi, s) >= 2).length,
      puzzle: shp.some(s => !s.star && !placeMasks(s).some(m => !(glo & m.lo) && !(ghi & m.hi))), clearable: shp.some(s => !s.star && bestDrop(glo, ghi, s) >= 1), roomAtDeal: roomOf(a0), matched: shp.some(s => !s.star && s.n >= 3 && shp.filter(x => x === s).length >= 2), ready: typeof readyLines === 'function' ? readyLines(glo, ghi) : 0,
      sound: typeof soundBits === 'function' ? shp.every(s => soundBits(glo, ghi, s, roomOf(a0))) : null };
    cur = { ...fit, sweepHand: closerTray, offers2, lines: 0, small: tray.every(t => !t || t.s.n <= 3), big4: tray.filter(t => t && t.s.n >= 4).length, multi: 0, sweeps: 0, fill: fillOf(), obv, obvN, possible, cleared: false, clears: 0, firstObv: null, ph: pace.ph, phN: pace.n, room: roomNow, tier: lastTier, game: games };
    cur.gems = pop32(glo) + pop32(ghi);
    { let occ = 0; for (let j = 0; j < 16; j++) if ((glo & LINE_MASKS[j * 2]) | (ghi & LINE_MASKS[j * 2 + 1])) occ++; cur.occ = occ; cur.rough = roughBits(glo, ghi); }   // blockiness at deal: lines holding gems, filled/empty edges
    cur.noHomeNow = typeof hasHome === 'function' ? shp.filter(s => !s.star && !hasHome(glo, ghi, s)).length : 0;
    cur.noHome = typeof homeAfterMates === 'function' ? shp.filter((s, k) => !homeAfterMates(glo, ghi, shp, k)).length : 0;
    trays.push(cur);
    if (golden) goldens++;                     // golden hands dealt (plan 4.5c rarity: about one per game)
  };
  let swing = 0, nearClear = 0;   // (round 5) placements that drop the board by 12+ gems (Block Blast's big swings), and those leaving 9 or fewer
  newTray();
  while (trays.length < TRAYS) {
    let m = BOT === 'strong' ? strong() : choose();
    if (!m && RESCUE && rescueAllowed(best)) { rescue(); rescues++; cur.tier = lastTier; m = BOT === 'strong' ? strong() : choose(); }
    if (!m) { games++; start(); finishDeal(); newTray(); continue; }
    const before = stats.lines, sw0 = stats.sweeps;
    if (cur.firstObv === null) cur.firstObv = m[3];
    const g0n = countFlat(packGrid(grid));
    place(m[0], m[1], m[2]);
    { const g1n = countFlat(packGrid(grid)); if (g0n - g1n >= 12) { swing++; if (g1n <= 9) nearClear++; } }
    { const k = { goldenNext, goldenCool, golden, trayHadSweep, trayCombo, starForced, starCool, transform, transformCool }; clearRunFx(); ({ goldenNext, goldenCool, golden, trayHadSweep, trayCombo, starForced, starCool, transform, transformCool } = k); }   // drop the effects, keep the specials' bookkeeping
    if (stats.lines > before) afterClear.push(countFlat(packGrid(grid)));
    if (stats.lines > before) { cur.lines += stats.lines - before; cur.cleared = true; cur.clears++; if (stats.lines - before >= 2) cur.multi++; }
    if (stats.sweeps > sw0) cur.sweeps++;
    if (dealing) { finishDeal(); newTray(); }
  }
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const mean = (a, f) => a.length ? +(a.reduce((x, t) => x + f(t), 0) / a.length).toFixed(2) : NaN;
  const pct = (a, f) => a.length ? Math.round(100 * a.filter(f).length / a.length) : NaN;
  const buckets = [0.15, 0.30, 0.45, 0.60].map(f => {
    const b = trays.filter(t => Math.abs(t.fill - f) <= 0.05);
    return { fill: Math.round(f * 100) + '%', trays: b.length, obviousAtDeal: pct(b, t => t.obv), boardAllows: pct(b, t => t.possible), twoPlus: pct(b, t => t.obvN >= 2), allThree: pct(b, t => t.obvN === 3), clearPerTray: pct(b, t => t.cleared), clearsPerTray: mean(b, t => t.clears), sweepHands: b.filter(t => t.sweepHand).length, swept: b.filter(t => t.sweepHand && t.sweeps).length };
  });
  const sorted = costs.slice().sort((a, b) => a - b);
  // (6.1) per game: length, relief moments and the trays between them; the last game is cut off, so it is left out
  const perGame = [];
  for (let g = 0; g < games; g++) perGame.push(trays.filter(t => t.game === g));
  const lens = perGame.map(a => a.length).sort((a, b) => a - b), q = f => lens.length ? lens[Math.floor((lens.length - 1) * f)] : 0;
  const reliefStarts = a => a.map((t, i) => t.ph === 'relief' && t.phN === 1 ? i : -1).filter(i => i >= 0);
  const gaps = []; perGame.forEach(a => { const r = reliefStarts(a); for (let i = 1; i < r.length; i++) gaps.push(r[i] - r[i - 1]); });
  const phases = {}; for (const t of trays) phases[t.ph] = (phases[t.ph] || 0) + 1;
  for (const k in phases) phases[k] = Math.round(100 * phases[k] / trays.length) + '%';
  const rec = trays.filter(t => t.ph === 'recovery');
  const pace6 = {
    gamesDone: games, traysPerGame: { p25: q(0.25), median: q(0.5), p75: q(0.75) }, phases,
    recoveryCleared: pct(rec, t => t.cleared), reliefPerGame: mean(perGame, a => reliefStarts(a).length),
    gamesWithRelief: pct(perGame, a => reliefStarts(a).length > 0), traysBetweenRelief: median(gaps),
    room: [0.1, 0.25, 0.5, 0.75, 0.9].map(f => { const r = trays.map(t => t.room).sort((a, b) => a - b); return +r[Math.floor((r.length - 1) * f)].toFixed(2); }),
    lostIn: (() => { const o = {}; perGame.forEach(a => { const p = a[a.length - 1].ph; o[p] = (o[p] || 0) + 1; }); return o; })(),
    sweepsPerGame: mean(perGame, a => a.filter(t => t.tier === 'SWEEP').length), rescues,
    resetsPerGame: mean(perGame, a => a.reduce((x, t) => x + t.sweeps, 0)),
    traysPerMulti: +(trays.length / Math.max(1, trays.reduce((x, t) => x + (t.multi ? 1 : 0), 0))).toFixed(1),
    smallOnlyTrays: pct(trays, t => t.small), longestSmallRun: (() => { let b = 0, r = 0; for (const t of trays) { r = t.small ? r + 1 : 0; b = Math.max(b, r); } return b; })(),
    traysPerOffer2: +(trays.length / Math.max(1, trays.filter(t => t.offers2).length)).toFixed(1),
    traysPer3Lines: +(trays.length / Math.max(1, trays.filter(t => t.lines >= 3).length)).toFixed(1),
    byTier: (() => { const o = {}; for (const t of trays) { const k = t.tier.split('+')[0]; o[k] = o[k] || [0, 0]; o[k][0]++; if (t.multi) o[k][1]++; if (t.offers2) o[k][2] = (o[k][2] || 0) + 1; } for (const k in o) o[k] = o[k][0] + ' trays, ' + Math.round(100 * o[k][1] / o[k][0]) + '% multi, ' + Math.round(100 * (o[k][2] || 0) / o[k][0]) + '% offer one'; return o; })(),
    jackpotsPerGame: mean(perGame, a => a.filter(t => t.tier === 'JACKPOT').length),
    traysPerBigHand: +(trays.length / Math.max(1, trays.filter(t => /JACKPOT|GOLDEN|CLOSER|SWEEP/.test(t.tier)).length)).toFixed(1),
    closersPerGame: mean(perGame, a => a.filter(t => t.tier === 'CLOSER').length), payoffsPerGame: mean(perGame, a => a.filter(t => t.tier === 'PAYOFF').length),
    traysBetweenPayoffs: (() => { const g = []; perGame.forEach(a => { let last = -1; a.forEach((t, i) => { if (/PAYOFF|CLOSER|SWEEP|GOLDEN/.test(t.tier) || (t.ph === 'relief' && t.phN === 1)) { if (last >= 0) g.push(i - last); last = i; } }); }); return median(g); })(),
    closerTries: waveStats.closerTries, chases: waveStats.chases, runs: waveStats.runs, runSwept: waveStats.runSwept, runTrays: trays.filter(t => /^RUN/.test(t.tier)).length, chaseHits: trays.filter((t, i) => i && trays[i - 1].tier === 'SETUP' && t.sweepHand).length,
    sweepHands: trays.filter(t => t.sweepHand).length, traysPerSweepHand: +(trays.length / Math.max(1, trays.filter(t => t.sweepHand).length)).toFixed(1),
    sweepHandsConverted: pct(trays.filter(t => t.sweepHand), t => t.sweeps > 0) + '%',
    sweepsAll: trays.reduce((x, t) => x + t.sweeps, 0), traysPerSweep: +(trays.length / Math.max(1, trays.reduce((x, t) => x + t.sweeps, 0))).toFixed(1),
    setupsMade: waveStats.setups, setupsPaid: Math.round(100 * waveStats.dealt / Math.max(1, waveStats.setups - waveStats.closed)) + '%', setupsPerTray: +(waveStats.setups / trays.length).toFixed(2),
    gamesEnded: games, p10: lens.length ? lens[Math.floor((lens.length - 1) * 0.1)] : 0, edgeShare: phases.edge || '0%', edgeHoldsPerGame: mean(perGame, a => a.filter(t => t.ph === 'edge' && t.phN === 1).length),
    big4Per5: (() => { let lo = 99; for (let i = 4; i < trays.length; i++) { let n = 0; for (let j = i - 4; j <= i; j++) n += trays[j].big4; lo = Math.min(lo, n); } return lo; })(),
  };
  // (1.1 G) fit numbers, overall and by stretch; the invariant; lean set-ups resolved within two trays; one game's series
  const fitOf = a => { const ps = a.flatMap(t => t.sizes); return { trays: a.length, meanPiece: +(ps.reduce((x, y) => x + y, 0) / Math.max(1, ps.length)).toFixed(2),
    small3: pct(ps, n => n <= 3) + '%', ones: pct(ps, n => n === 1) + '%', tray4plus: pct(a, t => t.avail >= 4) + '%', tray2plus: pct(a, t => t.avail >= 2) + '%',
    piece2plus: Math.round(100 * a.reduce((x, t) => x + t.multiPieces, 0) / Math.max(1, ps.length)) + '%', awkPerTray: mean(a, t => t.awk),
    linesAvail: mean(a, t => t.avail), clearedPerTray: mean(a, t => t.lines), puzzle: pct(a, t => t.puzzle) + '%', sweeps: a.reduce((x, t) => x + t.sweeps, 0),
    bot3plus: pct(a, t => t.lines >= 3) + '%', bot4plus: pct(a, t => t.lines >= 4) + '%', bigSolve: pct(a, t => t.fill >= 0.4 && t.lines >= 3) + '%', twoSmall: pct(a, t => t.sizes.filter(n => n <= 3).length >= 2) + '%', matched: pct(a, t => t.matched) + '%', clearNow: pct(a, t => t.clearable) + '%' }; };   // (round 3) big solves: 3+ lines from a crowded board; trays with 2+ small pieces
  const leanSet = [], soundT = trays.filter(t => t.sound !== null);
  trays.forEach((t, i) => { if (t.st !== 'lean') return; const n1 = trays[i + 1], n2 = trays[i + 2];
    if (!n1 || n1.game !== t.game) return; const need = !t.cleared || n1.roomAtDeal < CFG.ROOM_OK; if (!need) return;
    leanSet.push(n1.clearable || (n2 && n2.game === t.game && n2.clearable)); });
  const g0 = perGame.find(a => a.length >= 60) || perGame[0] || trays;
  const g1 = {
    overall: fitOf(trays), easy: fitOf(trays.filter(t => t.st === 'easy')), lean: fitOf(trays.filter(t => t.st === 'lean')),
    bigEasy: (() => { const b = trays.filter(t => t.st === 'easy' && t.ready >= CFG.BIG_READY && /^EASY/.test(t.tier)); return { n: b.length, avail: mean(b, t => t.avail), bot: mean(b, t => t.lines), bot3: pct(b, t => t.lines >= 3) + '%' }; })(),
    readyAtDeal: (() => { const o = {}; trays.forEach(t => { const k = Math.min(t.ready, 6); o[k] = (o[k] || 0) + 1; }); return o; })(),
    swings: { perTray: +(swing / Math.max(1, trays.length)).toFixed(3), nearClearPerTray: +(nearClear / Math.max(1, trays.length)).toFixed(3) },
    lowBoards: { le12: pct(trays, t => t.fill * 64 <= 12) + '%', le20: pct(trays, t => t.fill * 64 <= 20) + '%', sweepHands: trays.filter(t => t.sweepHand).length, sweptOfThem: trays.filter(t => t.sweepHand && t.sweeps).length, runTrays: trays.filter(t => /^RUN/.test(t.tier)).length },
    opening: (() => { const o = perGame.filter(g => g.length >= 4).map(g => g.slice(0, 4).reduce((x, t) => x + t.lines, 0)); return { games: o.length, lines4: mean(o, x => x), anyClear: pct(o, x => x > 0) + '%' }; })(),
    unsolvableTrays: trays.filter(t => !t.solvable).length, guarded: waveStats.guarded || 0, bigSolveTrays: waveStats.bigSolves || 0, guardBy: waveStats.guardBy || {}, rescues: waveStats.rescues || 0,
    soundAll: soundT.length ? pct(soundT, t => t.sound) + '%' : 'n/a', soundLean: soundT.length ? pct(soundT.filter(t => t.st === 'lean'), t => t.sound) + '%' : 'n/a',
    leanSetups: leanSet.length, leanResolvedIn2: pct(leanSet, x => x) + '%',
    games: { gamesEnded: games, p10: q(0.1), median: q(0.5), p90: q(0.9) },
    lostIn: (() => { const o = {}; perGame.forEach(a => { const t = a[a.length - 1], k = t.st + '/' + t.ph; o[k] = (o[k] || 0) + 1; }); return o; })(),
    lostAfterLeanTrays: (() => { const r = []; perGame.forEach(a => { let k = 0; for (let i = a.length - 1; i >= 0 && a[i].st === 'lean'; i--) k++; if (k) r.push(k); }); return r.sort((x, y) => x - y); })(),
  };
  const series = g0.map(t => ({ gems: t.gems, st: t.st, ph: t.ph, avail: t.avail, awk: t.awk, tier: t.tier, cleared: t.lines, sw: t.sweeps }));
  const runs3 = {}; perGame.forEach(a => { let k = 0; for (const t of a.concat([{ lines: 0 }])) { if (t.lines >= 3) k++; else if (k) { runs3[k] = (runs3[k] || 0) + 1; k = 0; } } });
  const pieces = trays.reduce((x, t) => x + t.sizes.length, 0), sweepsN = trays.reduce((x, t) => x + t.sweeps, 0);
  const homeLine = { traysPerSweep: +(trays.length / Math.max(1, sweepsN)).toFixed(1), gemsAtDeal: median(trays.map(t => t.gems)), gemsAfterClear: median(afterClear),
    noHome: +(100 * trays.reduce((x, t) => x + t.noHome, 0) / Math.max(1, pieces)).toFixed(2) + '%', noHomeNow: +(100 * trays.reduce((x, t) => x + t.noHomeNow, 0) / Math.max(1, pieces)).toFixed(1) + '%', meanPiece: +(trays.reduce((x, t) => x + t.sizes.reduce((a, b) => a + b, 0), 0) / Math.max(1, pieces)).toFixed(2),
    share3plus: pct(trays, t => t.lines >= 3) + '%', runs3plus: runs3, games: { ended: games, p10: q(0.1), median: q(0.5), p90: q(0.9) }, dealMs: { median: +median(costs).toFixed(2), p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2) },
    finish: (() => { const f = trays.filter(t => /^HOME FINISH/.test(t.tier)), c = f.filter(t => /·CLEAR/.test(t.tier)); return { trays: f.length, clearShare: pct(f, t => /·CLEAR/.test(t.tier)) + '%', clearSwept: pct(c, t => t.sweeps > 0) + '%' }; })(),
    win: (() => { const w = typeof hdStats === 'object' && hdStats.win; if (!w) return null; const ended = (w.wipe || 0) + (w.cap || 0) + (w.dry || 0);
      return { started: w.started, wipe: Math.round(100 * (w.wipe || 0) / Math.max(1, ended)) + '%', cap: Math.round(100 * (w.cap || 0) / Math.max(1, ended)) + '%', dry: Math.round(100 * (w.dry || 0) / Math.max(1, ended)) + '%', over: w.over || 0,
        meanLen: +(w.lens.reduce((a, b) => a + b, 0) / Math.max(1, w.lens.length)).toFixed(1), flat: hdStats.winFlat }; })(),
    wipes: (() => {                          // finished games: trays between board wipes (the game's start counts as one end of a stretch), rows of wipes each within 4 trays of the one before
      const gaps = [], rows = {}, stretch = []; let longest = 0, n = 0;
      perGame.forEach(a => { const at = []; a.forEach((t, i) => { for (let k = 0; k < t.sweeps; k++) at.push(i); }); n += at.length;
        for (let i = 1; i < at.length; i++) gaps.push(at[i] - at[i - 1]);
        const ends = [0, ...at, a.length]; for (let i = 1; i < ends.length; i++) longest = Math.max(longest, ends[i] - ends[i - 1]);
        let k = 0; at.forEach((x, i) => { if (i && x - at[i - 1] <= 4) k++; else { if (k) rows[k] = (rows[k] || 0) + 1; k = 1; } }); if (k) rows[k] = (rows[k] || 0) + 1; });
      const g = gaps.slice().sort((x, y) => x - y), qq = f => g.length ? g[Math.floor((g.length - 1) * f)] : null;
      return { n, traysPerWipe: +(perGame.reduce((x, a) => x + a.length, 0) / Math.max(1, n)).toFixed(1), gapMedian: qq(0.5), gapP90: qq(0.9), longestStretch: longest, rows }; })(),
    blocky: (() => { const o = {}; for (const t of trays) { const m = /^HOME \S+ (warm|win|cool)/.exec(t.tier); const k = m ? m[1] : 'other'; if (t.gems < 10) continue; (o[k] = o[k] || []).push(t); }
      for (const k in o) { const a = o[k]; o[k] = { trays: a.length, occLines: mean(a, t => t.occ), occPerGem: mean(a, t => t.occ / t.gems), rough: mean(a, t => t.rough), roughPerGem: mean(a, t => t.rough / t.gems) }; } return o; })(),
    low8: pct(trays, t => t.gems <= 8) + '%', lostIn: (() => { const o = {}; perGame.forEach(a => { const m = /^HOME (\S+) (warm|win|cool)/.exec(a[a.length - 1].tier); const k = m ? m[2] + '/' + m[1].split('·')[0] : 'other'; o[k] = (o[k] || 0) + 1; }); return o; })(),
    byPhase: (() => { const o = {}; for (const t of trays) { const m = /^HOME \S+ (warm|win|cool)/.exec(t.tier); if (!m) continue; (o[m[1]] = o[m[1]] || []).push(t); }
      for (const k in o) { const a = o[k]; o[k] = { trays: a.length, clearPerTray: pct(a, t => t.cleared) + '%', linesPerTray: mean(a, t => t.lines), gemsAtDeal: median(a.map(t => t.gems)), clearHands: a.filter(t => /·CLEAR/.test(t.tier)).length, sweeps: a.reduce((x, t) => x + t.sweeps, 0) }; } return o; })(),
    kinds: typeof hdStats === 'object' ? { ...hdStats, win: undefined } : null };
  return { homeLine, g1, series, pace6,
    trays: trays.length, games, goldens, goldensPerGame: +(goldens / (games + 1)).toFixed(2), traysPerGame: Math.round(trays.length / (games + 1)), buckets,
    obviousAtDealAll: pct(trays, t => t.obv), boardAllowsAll: pct(trays, t => t.possible), clearPerTrayAll: pct(trays, t => t.cleared), allThreeAll: pct(trays, t => t.obvN === 3), clearsPerTrayAll: mean(trays, t => t.clears),
    medianFill: Math.round(100 * median(trays.map(t => t.fill))),
    meanFill: Math.round(100 * trays.reduce((a, t) => a + t.fill, 0) / trays.length),
    dealMs: { median: +median(costs).toFixed(2), p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2), max: +(sorted[sorted.length - 1] || 0).toFixed(2) },
  };
}, [TRAYS, BOT, RESCUE]);
console.log(JSON.stringify({ bot: BOT, rescue: RESCUE, overrides: OVR, ...out, buckets: undefined, pace6: undefined, g1: undefined, series: undefined, homeLine: undefined }));
console.log('home:', JSON.stringify(out.homeLine));
console.log('pace (6.1):', JSON.stringify(out.pace6));
console.log('coaster (1.1 G):', JSON.stringify(out.g1));
if (process.env.SERIES) (await import('node:fs')).writeFileSync(process.env.SERIES, JSON.stringify(out.series));
console.log('fill  trays  obvious@deal  board-allows  2+obvious  all-3  clear/tray  clears/tray  sweep-hands  swept');
for (const b of out.buckets) console.log([b.fill, b.trays, b.obviousAtDeal + '%', b.boardAllows + '%', b.twoPlus + '%', b.allThree + '%', b.clearPerTray + '%', b.clearsPerTray, b.sweepHands, b.swept].map(String).map(x => x.padEnd(12)).join(''));
await browser.close(); await srv.close();

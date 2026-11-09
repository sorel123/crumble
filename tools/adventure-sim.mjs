// Adventure sim (plan 4.1): plays every level with a bot that plays like a keen kid and reports, per level,
// how often it wins and in how many pieces. Used to set LEVEL_PAR (3-star and 2-star piece counts) and to
// check no level is a wall.
//
//   node tools/adventure-sim.mjs [runs=40] [seed=1]
//
// The bot: takes the placement that clears the most lines (a sweep counts extra), else the biggest piece where
// it sits most flush. No Undo, no Rescue. Stuck = the try is lost. A try is also lost past 400 pieces.
// Prints a table and the suggested LEVEL_PAR: 3 stars at the bot's median, 2 stars at its 85th percentile.
import { serve, openGame } from '../tests/harness.mjs';

const RUNS = +(process.argv[2] || 40), SEED = +(process.argv[3] || 1);
const srv = await serve();
const { browser, page } = await openGame(srv.url, { seed: SEED });
const out = await page.evaluate(RUNS => {
  CFG.SPECIALS.golden = CFG.SPECIALS.star = CFG.SPECIALS.blast = CFG.SPECIALS.transform = false;
  const flush = (s, r, c, g) => {
    let k = 0;
    for (const [dr, dc] of s.cells) for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr + a, cc = c + dc + b;
      if (s.cells.some(([x, y]) => x === dr + a && y === dc + b)) continue;
      if (rr < 0 || cc < 0 || rr >= N || cc >= N || g[rr][cc]) k++;
    }
    return k;
  };
  const clearsAt = (s, r, c) => {                       // lines this placement would clear
    const g = grid.map(row => row.slice());
    for (const [dr, dc] of s.cells) g[r + dr][c + dc] = { gi: 0 };
    const x = linesFor(g), n = x.rows.length + x.cols.length;
    if (!n) return 0;
    const left = g.flat().filter(Boolean).length - (x.rows.length + x.cols.length) * N;      // (approximate: crossings counted twice)
    return n * 10 + (left <= 0 ? 15 : 0);
  };
  const choose = () => {
    let best = null, bk = -1;
    for (let i = 0; i < 3; i++) {
      const t = tray[i]; if (!t) continue; const s = t.s;
      for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) {
        if (!canPlace(s, r, c, grid)) continue;
        const k = clearsAt(s, r, c) * 100 + s.n * 3 + flush(s, r, c, grid);
        if (k > bk) { bk = k; best = [i, r, c]; }
      }
    }
    return best;
  };
  const finishDeal = () => { if (dealing) { runSteps(dealing.it); dealing = null; } };
  const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * f))] : null; };
  const res = [];
  for (const L of LEVELS) {
    mode = 'adventure'; lvl = L; const pieces = []; let wins = 0;
    for (let run = 0; run < RUNS; run++) {
      start(); finishDeal();
      let n = 0, won = false;
      while (n < 400) {
        const m = choose(); if (!m) break;
        place(m[0], m[1], m[2]); n++;
        { const k = { goldenNext, goldenCool, golden, trayHadSweep, trayCombo, starForced, starCool, transform, transformCool }; clearRunFx(); ({ goldenNext, goldenCool, golden, trayHadSweep, trayCombo, starForced, starCool, transform, transformCool } = k); }
        if (state === 'won') { won = true; break; }
        finishDeal();
      }
      if (won) { wins++; pieces.push(lv.pieces); }
    }
    res.push({ id: L.id, goal: L.goal.type + ' ' + L.goal.n, fill: L.fill, win: Math.round(100 * wins / RUNS), p50: q(pieces, 0.5), p85: q(pieces, 0.85) });
  }
  state = 'idle'; return res;
}, RUNS);
console.log('lvl  goal          fill  win%  p50  p85');
for (const r of out) console.log([r.id, r.goal, r.fill, r.win + '%', r.p50 ?? '-', r.p85 ?? '-'].map(String).map((x, i) => x.padEnd([5, 14, 6, 6, 5, 4][i])).join(''));
console.log('\nconst LEVEL_PAR=' + JSON.stringify(out.map(r => r.p50 == null ? [99, 99] : [r.p50, Math.max(r.p85, r.p50 + 1)])) + ';');
await browser.close(); await srv.close();

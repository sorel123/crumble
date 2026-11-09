// Bot sim for the dealer (plan 3.4). Plays the real game in headless Chromium with a simple "kid" bot
// and reports how often a tray offers her an obvious clear, by how full the board was when it was dealt.
//
//   node tools/bot-sim.mjs [trays=4000] [seed=1] [KEY=value ...]
//
// KEY=value pairs override CFG for the run (e.g. OBVIOUS=0 ALT=0 measures the dealer without plan 3.4's terms).
//
// The bot plays like someone who is not thinking: if a piece has an obvious clear (plan 3.4's definition,
// below) it plays that; otherwise it puts the biggest piece where it sits most flush (most filled or wall
// neighbours). Game over starts a new game. Each tray is bucketed by the board fill when it was dealt
// (30%, 45%, 60%, each +-5 points). For every bucket it reports:
//   obvious@deal  the tray as dealt holds a piece with an obvious clear (she can clear with her first drop)
//   clear/tray    the bot cleared at least one line while playing the tray
// plus the median board fill over all trays and the dealer's cost per tray (ms, this machine).
//
// Obvious clear: a piece that completes a line right now, where that line already had at least 5 of 8
// cells filled and its empty cells were one single run (which the piece fills exactly). The bot carries
// its own copy of the rule so the same bot measures the dealer before and after it learned the rule.
import { serve, openGame, play } from '../tests/harness.mjs';

const args = process.argv.slice(2), kv = args.filter(a => a.includes('=')), pos = args.filter(a => !a.includes('='));
const TRAYS = +(pos[0] || 4000), SEED = +(pos[1] || 1);
const OVR = Object.fromEntries(kv.map(a => { const [k, v] = a.split('='); return [k, isNaN(+v) ? v : +v]; }));
const srv = await serve();
const { browser, page } = await openGame(srv.url, { seed: SEED });
await page.evaluate(o => Object.assign(CFG, o), OVR);
await play(page);
const out = await page.evaluate(TRAYS => {
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
  const choose = () => {                    // [trayIdx, r, c, obvious] or null
    for (let i = 0; i < 3; i++) {
      const t = tray[i]; if (!t) continue;
      for (let r = 0; r <= N - t.s.rows; r++) for (let c = 0; c <= N - t.s.cols; c++)
        if (canPlace(t.s, r, c, grid) && obviousAt(t.s, r, c, grid)) return [i, r, c, true];
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
  const fillOf = () => grid.flat().filter(Boolean).length / (N * N);
  const finishDeal = () => { if (dealing) { const t0 = performance.now(); runSteps(dealing.it); dealing = null; costs.push(performance.now() - t0); } };
  const costs = [], trays = [];
  let cur = null, games = 0;
  const newTray = () => {
    const obvN = tray.filter(t => { if (!t) return false; for (let r = 0; r <= N - t.s.rows; r++) for (let c = 0; c <= N - t.s.cols; c++) if (canPlace(t.s, r, c, grid) && obviousAt(t.s, r, c, grid)) return true; return false; }).length, obv = obvN > 0;
    const possible = SHAPES.some(s => { for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) if (canPlace(s, r, c, grid) && obviousAt(s, r, c, grid)) return true; return false; });
    cur = { fill: fillOf(), obv, obvN, possible, cleared: false, clears: 0, firstObv: null };
    trays.push(cur);
  };
  newTray();
  while (trays.length < TRAYS) {
    const m = choose();
    if (!m) { games++; start(); finishDeal(); newTray(); continue; }
    const before = stats.lines;
    if (cur.firstObv === null) cur.firstObv = m[3];
    place(m[0], m[1], m[2]);
    clearRunFx();
    if (stats.lines > before) { cur.cleared = true; cur.clears++; }
    if (dealing) { finishDeal(); newTray(); }
  }
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const mean = (a, f) => a.length ? +(a.reduce((x, t) => x + f(t), 0) / a.length).toFixed(2) : NaN;
  const pct = (a, f) => a.length ? Math.round(100 * a.filter(f).length / a.length) : NaN;
  const buckets = [0.15, 0.30, 0.45, 0.60].map(f => {
    const b = trays.filter(t => Math.abs(t.fill - f) <= 0.05);
    return { fill: Math.round(f * 100) + '%', trays: b.length, obviousAtDeal: pct(b, t => t.obv), boardAllows: pct(b, t => t.possible), twoPlus: pct(b, t => t.obvN >= 2), allThree: pct(b, t => t.obvN === 3), clearPerTray: pct(b, t => t.cleared), clearsPerTray: mean(b, t => t.clears) };
  });
  const sorted = costs.slice().sort((a, b) => a - b);
  return {
    trays: trays.length, games, buckets,
    obviousAtDealAll: pct(trays, t => t.obv), boardAllowsAll: pct(trays, t => t.possible), clearPerTrayAll: pct(trays, t => t.cleared), allThreeAll: pct(trays, t => t.obvN === 3), clearsPerTrayAll: mean(trays, t => t.clears),
    medianFill: Math.round(100 * median(trays.map(t => t.fill))),
    meanFill: Math.round(100 * trays.reduce((a, t) => a + t.fill, 0) / trays.length),
    dealMs: { median: +median(costs).toFixed(2), p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2), max: +(sorted[sorted.length - 1] || 0).toFixed(2) },
  };
}, TRAYS);
console.log(JSON.stringify({ overrides: OVR, ...out, buckets: undefined }));
console.log('fill  trays  obvious@deal  board-allows  2+obvious  all-3  clear/tray  clears/tray');
for (const b of out.buckets) console.log([b.fill, b.trays, b.obviousAtDeal + '%', b.boardAllows + '%', b.twoPlus + '%', b.allThree + '%', b.clearPerTray + '%', b.clearsPerTray].map(String).map(x => x.padEnd(12)).join(''));
await browser.close(); await srv.close();

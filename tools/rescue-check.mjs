// Checks the Lab's "Rescue the Crumbs" boards (RS_BOARDS in js/rescue.js) with the game's own rules and solver.
//   node tools/rescue-check.mjs          every board: the fewest pieces that win (proved), against its par and stored solution
//   node tools/rescue-check.mjs 2        just board 2 (1-3)
// For each board rsSolve searches every order and seat of the board's queue (clears and crumb falls between drops, a
// stuck tray a dead end), deeper and deeper, so the first win it finds uses the fewest pieces; also printed: whether the
// crumbs rest where the board puts them, and that the stored solution wins in par pieces. Exit code 1 if a board is off.
// Needs Playwright (npm install).
import { serve, openGame } from '../tests/harness.mjs';

const only = process.argv[2] ? [Number(process.argv[2]) - 1] : null;
const srv = await serve();
const { browser, page } = await openGame(srv.url);
const out = await page.evaluate(only => {
  const res = [];
  for (let k = 0; k < RS_COUNT; k++) {
    if (only && !only.includes(k)) continue;
    const b = RS_BOARDS[k], c = rsCells(k), t = performance.now();
    const s = rsSolve(k, 12, 300000), ms = Math.round(performance.now() - t), rep = rsReplay(k, b.sol);
    res.push({ k, rows: b.rows, q: b.q.map(([si]) => RAW[si].join('/')), par: b.par, min: s.min, proved: !s.over, nodes: s.nodes, ms, seq: s.seq,
      rest: JSON.stringify(rsFallBits(c.lo, c.hi, c.cr)) === JSON.stringify(c.cr.slice().sort((x, y) => x - y)),
      sol: !!rep && rep.won && rep.n === b.par });
  }
  return res;
}, only);
let bad = 0;
for (const r of out) {
  const ok = r.proved && r.min === r.par && r.rest && r.sol;
  if (!ok) bad++;
  console.log(`Board ${r.k + 1}: par ${r.par}, fewest pieces ${r.min}${r.proved ? '' : ' (time ran out: no win in fewer than this)'} · ${r.nodes} positions, ${r.ms} ms · ${ok ? 'ok' : 'OFF'}`);
  console.log('  ' + r.rows.join('\n  '));
  console.log(`  queue: ${r.q.join('  ')}`);
  console.log(`  crumbs rest at the start: ${r.rest} · stored solution wins in par: ${r.sol} · a solver solution: ${JSON.stringify(r.seq)}`);
}
await browser.close(); await srv.close();
process.exit(bad ? 1 : 0);

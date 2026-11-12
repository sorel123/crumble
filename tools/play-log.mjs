// Reads a play log (Admin: Copy play log; the recorder in js/save.js) and prints what the dealer did to a real player.
//
//   node tools/play-log.mjs <file.json> [--all]
//
// Prints: games and trays; board wipes, per game the tray numbers they came on and the trays between them (and rows of
// wipes each within 4 trays of the one before); gems on the board at deal, per game as a sparkline (one character per
// tray, ▁ empty .. █ full; a | marks a wipe); the share of trays dealt in each phase and by dealer kind; the knobs each
// game was dealt under when they differ from the first; and for the longest wipe-less stretch (--all: every tray of it,
// else its first and last 8) the boards at deal as 8x8 ASCII (# a gem) beside the tray's shapes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/play-log.mjs <file.json> [--all]'); process.exit(1); }
const ALL = process.argv.includes('--all');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = Function('return ' + fs.readFileSync(path.join(ROOT, 'js/shapes.js'), 'utf8').match(/const RAW=(\[[\s\S]*?\n\]);/)[1])();
const shapeRows = i => i < 0 ? ['*'] : RAW[i].map(r => r.replace(/X/g, '#'));
const log = JSON.parse(fs.readFileSync(file, 'utf8'));
const E = log.e || [];

const games = new Map();                     // g -> {cfg, m, trays: [], over}
const game = g => games.get(g) || games.set(g, { g, trays: [], cfg: null, m: null, over: null }).get(g);
for (const e of E) {
  const G = game(e.g);
  if (e.k === 'g') { G.cfg = e.cfg; G.m = e.m; G.resumed = !!e.r; }
  else if (e.k === 't') G.trays.push(e);
  else if (e.k === 'o') G.over = e;
}
const gems = b => [...b].reduce((n, h) => n + [...parseInt(h, 16).toString(2)].filter(x => x === '1').length, 0);
const boardRows = b => Array.from({ length: 8 }, (_, r) => parseInt(b.slice(r * 2, r * 2 + 2), 16).toString(2).padStart(8, '0').replace(/1/g, '#').replace(/0/g, '.'));
const wipesOf = t => t.x.reduce((n, d) => n + (d[4] ? 1 : 0), 0);
const kindOf = t => { const m = /^HOME (\w+)/.exec(t.d); return m ? m[1] : t.d.split(/[·+ ]/)[0]; };
const SPARK = '▁▂▃▄▅▆▇█';

const all = [...games.values()].filter(G => G.trays.length);
const trays = all.flatMap(G => G.trays);
console.log(`play log: ${all.length} games, ${trays.length} trays, ${trays.reduce((n, t) => n + t.x.length, 0)} drops; ${all.filter(G => G.over).length} games ended in the log`);

// wipes and the gaps between them
let wipesN = 0; const gaps = [], rows = {};
console.log('\nwipes (tray numbers in the game; gaps in trays):');
for (const G of all) {
  const at = []; G.trays.forEach((t, i) => { for (let k = 0; k < wipesOf(t); k++) at.push(i); });
  wipesN += at.length;
  const gg = at.slice(1).map((x, i) => x - at[i]); gaps.push(...gg);
  let k = 0; at.forEach((x, i) => { if (i && x - at[i - 1] <= 4) k++; else { if (k) rows[k] = (rows[k] || 0) + 1; k = 1; } }); if (k) rows[k] = (rows[k] || 0) + 1;
  console.log(`  game ${G.g}${G.resumed ? ' (resumed)' : ''}: ${G.trays.length} trays${G.over ? ', score ' + G.over.sc : ''}; wipes at ${at.length ? at.map(i => G.trays[i].n).join(',') : '-'}${gg.length ? '; gaps ' + gg.join(',') : ''}`);
}
const s = gaps.slice().sort((a, b) => a - b), q = f => s.length ? s[Math.floor((s.length - 1) * f)] : '-';
console.log(`  all: ${wipesN} wipes, a wipe every ${wipesN ? (trays.length / wipesN).toFixed(1) : '-'} trays; gap median ${q(0.5)}, p90 ${q(0.9)}, longest ${s.length ? s[s.length - 1] : '-'}; rows of wipes (each within 4 trays) by length ${JSON.stringify(rows)}`);

// gems at deal over time
console.log('\ngems at deal (▁ 0 .. █ 64, | a wipe in that tray):');
for (const G of all) {
  const line = G.trays.map(t => SPARK[Math.min(7, Math.floor(gems(t.b) / 8))] + (wipesOf(t) ? '|' : '')).join('');
  for (let i = 0; i < line.length; i += 100) console.log(`  ${i ? '      ' : ('g' + G.g).padEnd(6)}${line.slice(i, i + 100)}`);
}

// phase and kind shares
const share = f => { const o = {}; for (const t of trays) { const k = f(t); o[k] = (o[k] || 0) + 1; } return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${Math.round(100 * n / trays.length)}%`).join(', '); };
console.log('\nphase: ' + share(t => t.p));
console.log('kind:  ' + share(kindOf));

// knobs
const c0 = all.find(G => G.cfg)?.cfg;
if (c0) {
  console.log('\nknobs: ' + Object.entries(c0).map(([k, v]) => `${k}=${v}`).join(' '));
  for (const G of all) if (G.cfg && JSON.stringify(G.cfg) !== JSON.stringify(c0)) console.log(`  game ${G.g} differs: ` + Object.entries(G.cfg).filter(([k, v]) => c0[k] !== v).map(([k, v]) => `${k}=${v}`).join(' '));
}

// the longest wipe-less stretch, board by board
let best = null;
for (const G of all) {
  let a = 0;
  G.trays.forEach((t, i) => { const end = wipesOf(t) || i === G.trays.length - 1; if (end) { const b = i; if (!best || b - a + 1 > best.b - best.a + 1) best = { G, a, b }; a = i + 1; } });
}
if (best) {
  const run = best.G.trays.slice(best.a, best.b + 1);
  console.log(`\nlongest wipe-less stretch: game ${best.G.g}, trays ${run[0].n}-${run[run.length - 1].n} (${run.length} trays)`);
  const show = ALL || run.length <= 16 ? run.map((t, i) => [t, i]) : [...run.slice(0, 8).map((t, i) => [t, i]), null, ...run.slice(-8).map((t, i) => [t, run.length - 8 + i])];
  for (const it of show) {
    if (!it) { console.log(`  ... ${run.length - 16} trays ...`); continue; }
    const [t] = it, rowsB = boardRows(t.b), sh = t.s.map(shapeRows), w = sh.map(x => Math.max(...x.map(r => r.length)));
    const drops = t.x.map(d => `${d[0]}@${d[1]},${d[2]}${d[3] ? ' +' + d[3] : ''}${d[4] ? ' WIPE' : ''}`).join('  ');
    console.log(`\n  tray ${t.n} · ${t.d} · ${t.p} · ${gems(t.b)} gems${drops ? ' · drops ' + drops : ''}`);
    for (let r = 0; r < 8; r++) console.log('    ' + rowsB[r] + '   ' + sh.map((x, k) => (x[r] || '').padEnd(w[k])).join('  '));
  }
}

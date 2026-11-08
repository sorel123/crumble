// Test harness: serves the game, opens it at an iPhone-sized viewport, and gives tests
// pointer-event input plus a read-only view of the game's state.
//
// No hook is added to the game itself. The game's state lives in top-level `let`/`const`
// bindings of classic scripts, which `page.evaluate` can read by name, so the tests look
// at `grid`, `tray`, `score`, `state` etc. directly and index.html stays free of test code.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };

// `patches` lets a test change what the server returns for a path (e.g. pretend a new deploy):
//   srv.patches['/sw.js'] = text => text + '// v2'
export function serve() {
  const patches = {};
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (patches[rel]) { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); return res.end(patches[rel](fs.readFileSync(file, 'utf8'))); }
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    patches,
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(r => server.close(r)),
  })));
}

// Seeded Math.random so a run of the game is repeatable (mulberry32).
const SEED_SCRIPT = seed => `(()=>{let a=${seed}>>>0;Math.random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};})();`;

export async function openGame(url, { seed = 1 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // the game degrades fine without its font
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(SEED_SCRIPT(seed));
  await page.goto(url);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
  return { browser, page, errors };
}

export const play = page => page.click('#startBtn').then(() => page.waitForFunction(() => state === 'play'));

// Board and tray state as plain data.
export const snap = page => page.evaluate(() => ({
  state, score, best,
  filled: grid.flat().filter(Boolean).length,
  rows: grid.map(r => r.map(v => (v ? 1 : 0)).join('')),
  tray: tray.map(t => (t ? { n: t.s.n, rows: t.s.rows, cols: t.s.cols } : null)),
  overVisible: !el('overCard').hidden,
}));

// Overwrite the board (rows of '0'/'1') and/or the tray (indices into SHAPES) from inside the page.
export const setup = (page, { rows, trayShapes }) => page.evaluate(({ rows, trayShapes }) => {
  if (rows) grid = rows.map(r => [...r].map(ch => (ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
  if (trayShapes) tray = trayShapes.map(i => (i == null ? null : { s: SHAPES[i], gi: 1 }));
}, { rows, trayShapes });

// Screen coordinates, derived from the game's own layout so tests follow it if the layout changes.
export const geometry = page => page.evaluate(() => ({
  bx, by, cell, trayCenters: [0, 1, 2].map(i => { const R = slotRect(i); return { x: R.x + R.w / 2, y: R.y + R.h / 2 }; }),
  lift: CFG.LIFT,
}));

// Drag tray piece `i` so it lands with its top-left cell on board cell (r, c): real pointer events.
export async function dragPiece(page, i, r, c, { dx = 0, dy = 0 } = {}) {
  const g = await geometry(page);
  const s = await page.evaluate(i => ({ rows: tray[i].s.rows, cols: tray[i].s.cols }), i);
  const from = g.trayCenters[i];
  const to = {
    x: g.bx + (c + s.cols / 2) * g.cell + dx,
    y: g.by + (r + s.rows / 2) * g.cell + g.cell * g.lift + dy,   // the piece floats `lift` cells above the finger
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

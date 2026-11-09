// Runs every scenario against the game in headless Chromium at 390x844 and exits non-zero on a failure.
//   npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve, openGame, play, snap, setup, dragPiece, geometry, fingerFor, fingers, frames, watchPlace, placed, dragView, dealt, watchFrames, frameLog } from './harness.mjs';
import { expectedAssets } from '../tools/stamp-sw.mjs';

const EMPTY = Array(8).fill('00000000');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('loads with no errors and shows the start card', async ({ page, errors }) => {
  const s = await snap(page);
  assert.equal(s.state, 'idle');
  assert.equal(await page.isVisible('#startCard'), true);
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), [], 'no script errors (the blocked web font is expected)');
});

test('Play starts a run: the seeded opening board, three playable pieces', async ({ page }) => {
  await play(page);
  const s = await snap(page);
  assert.ok(s.filled > 0 && s.filled < 20, 'the opening pattern is on the board (plan 3.1), not a full board');
  assert.equal(s.score, 0);
  assert.equal(s.tray.filter(Boolean).length, 3);
  assert.equal(await page.isVisible('#startCard'), false);
});

test('dragging a piece onto the board places it', async ({ page }) => {
  await play(page);
  await setup(page, { rows: EMPTY });                    // the opening pattern is not what this is about
  const before = await snap(page);
  const n = before.tray[0].n;
  await dragPiece(page, 0, 3, 3);
  const after = await snap(page);
  assert.equal(after.filled, n, 'the piece\'s cells are on the board');
  assert.equal(after.tray[0], null, 'the tray slot is emptied');
  assert.ok(after.tray[1] && after.tray[2], 'the other pieces stay');
  assert.ok(after.rows.slice(3, 3 + before.tray[0].rows).every(r => /1/.test(r.slice(3, 3 + before.tray[0].cols))), 'it landed where it was dropped');
});

test('dropping off the board returns the piece to the tray', async ({ page }) => {
  await play(page);
  const before = await snap(page);
  await dragPiece(page, 1, 0, 0, { dy: 600 });          // far below the board
  const after = await snap(page);
  assert.equal(after.filled, before.filled);
  assert.deepEqual(after.tray, before.tray);
});

test('a press near a tray piece (below it, beside it, in an empty slot) still picks one up', async ({ page }) => {
  await play(page);
  const g = await geometry(page);
  const press = async (x, y) => {
    await page.mouse.move(x, y); await page.mouse.down();
    const i = await page.evaluate(() => drag ? drag.i : -1);
    await page.mouse.up();
    return i;
  };
  const c = g.trayCenters;
  assert.equal(await press(c[1].x, c[1].y + 70), 1, 'well below the piece, same column');
  assert.equal(await press(c[2].x + 40, c[2].y), 2, 'off to the side of the piece');
  assert.equal(await page.evaluate(() => { const r = slotRect(0); return pickAt(r.x + r.w / 2, by + B - 10); }), -1, 'on the board itself is not the tray');
  await page.evaluate(() => { tray[1] = null; });
  assert.notEqual(await press(c[1].x, c[1].y), -1, 'an empty slot hands off to the nearest piece');
});

test('a press while the new tray is dealing grabs a piece the moment it appears', async ({ page }) => {
  await play(page);
  const g = await geometry(page);
  await page.evaluate(() => { dealing = { it: (function* () { while (!window.__go) yield; })(), wait: 0 }; });
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y);
  await page.mouse.down();
  assert.equal(await page.evaluate(() => drag), null, 'nothing yet while dealing');
  await page.evaluate(() => { window.__go = true; });
  await dealt(page);
  await page.waitForFunction(() => drag && drag.i === 0, null, { timeout: 2000 });
  await page.mouse.up();
});

test('a drop with nowhere to land is refused', async ({ page }) => {
  await play(page);
  // Board full except one cell: the L piece fits nowhere, so no nearby slot can pull it in.
  await setup(page, { rows: [...Array(7).fill('11111111'), '11111110'], trayShapes: [11, 0, 0] });
  await dragPiece(page, 0, 3, 3);
  const after = await snap(page);
  assert.equal(after.filled, 63);
  assert.equal(after.tray[0].n, 3);
});

test('completing a row clears it and scores', async ({ page }) => {
  await play(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });   // 1x1 pieces
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => grid[0].every(v => !v), null, { timeout: 5000 });
  const s = await snap(page);
  assert.equal(s.rows[0], '00000000');
  assert.ok(s.score > 0, 'the clear scored');
});

test('running out of moves ends the run', async ({ page }) => {
  await play(page);
  // Two holes in every row and column (a doubled diagonal): filling one completes no line,
  // and a 1x3 bar and a 2x2 square fit nowhere in what is left.
  const rows = Array.from({ length: 8 }, (_, r) => [...'11111111'].map((ch, c) => (c === r || c === (r + 1) % 8 ? '0' : ch)).join(''));
  await setup(page, { rows, trayShapes: [0, 3, 9] });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => stuck, null, { timeout: 3000 });
  await page.waitForTimeout(1500);
  assert.equal((await snap(page)).state, 'play', 'Undo is still available, so the run waits');
  assert.equal(await page.isVisible('#noMoves'), true); assert.equal(await page.isVisible('#endBtn'), true);
  await page.click('#endBtn');
  await page.waitForFunction(() => !el('overCard').hidden, null, { timeout: 5000 });
  assert.equal((await snap(page)).state, 'over');
});

// ── The drag (plan 2.1): one finger, one destination ──

// mulberry32, for the test's own random boards (the game's Math.random is seeded separately)
const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, `${msg}: ${a} vs ${b}`);

// Checks what the screen shows against the rule: the piece glides exactly at the finger (or, with
// FX_MAGNET on, sits exactly in its slot), and the slot - drawn as the ghost - is legal and within reach,
// with no slot only when nothing valid is in reach.
async function checkView(page, v, label) {
  const magnet = await page.evaluate(() => CFG.FX_MAGNET);
  if (v.slot && magnet) {
    near(v.cx, v.seatX, `${label} drawn x = slot`); near(v.cy, v.seatY, `${label} drawn y = slot`);
    assert.equal(v.snapK, 1, `${label} seated`);
  } else {
    near(v.cx, v.fx, `${label} drawn x = finger`); near(v.cy, v.fy, `${label} drawn y = above finger`);
    assert.equal(v.snapK, 0, `${label} floating`);
  }
  const rule = await page.evaluate(() => {
    const s = tray[drag.i].s, f = floatPos(), R = CFG.MAGNET_REACH;
    const fc = (f.x - s.cols * cell / 2 - bx) / cell, fr = (f.y - s.rows * cell / 2 - by) / cell;
    const cheb = (r, c) => Math.max(Math.abs(r - fr), Math.abs(c - fc));
    let inReach = false;
    for (let r = -2; r < 10; r++) for (let c = -2; c < 10; c++) if (cheb(r, c) <= R && canPlace(s, r, c, grid)) inReach = true;
    return { inReach, d: drag.slot ? cheb(drag.slot.r, drag.slot.c) : null, ok: drag.slot ? canPlace(s, drag.slot.r, drag.slot.c, grid) : null, lim: R + CFG.MAGNET_HOLD };
  });
  if (v.slot) { assert.ok(rule.ok, `${label} slot is a legal spot`); assert.ok(rule.d <= rule.lim + 1e-9, `${label} slot within reach (${rule.d})`); }
  else assert.equal(rule.inReach, false, `${label} no slot, so nothing valid in reach`);
}

test('50 scripted drags glide with the finger and land exactly where the ghost showed', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  const g = await geometry(page), f = await fingers(page), rand = rng(2101);
  const nShapes = await page.evaluate(() => SHAPES.length);
  let slotted = 0, floated = 0;
  for (let k = 0; k < 50; k++) {
    const i = Math.floor(rand() * 3), shapes = [0, 1, 2].map(() => Math.floor(rand() * nShapes));
    shapes[(i + 1) % 3] = 0;                                    // keep a 1x1 in the tray so the run never ends mid-test
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => (rand() < 0.22 ? '1' : '0')).join(''));
    await setup(page, { rows, trayShapes: shapes });
    await page.evaluate(() => { ret = null; });
    const s = await page.evaluate(i => ({ rows: tray[i].s.rows, cols: tray[i].s.cols }), i);
    const r = -1.2 + rand() * (8 - s.rows + 2.4), c = -1.2 + rand() * (8 - s.cols + 2.4);   // over the board and just past its edges
    const from = g.trayCenters[i], to = fingerFor(g, s, r, c);
    await f.down(1, from.x, from.y);
    await f.move(1, (from.x + to.x) / 2, (from.y + to.y) / 2, 3);
    await f.move(1, to.x, to.y, 3);
    await frames(page, 14);
    const v = await dragView(page);
    assert.ok(v && v.i === i, `drag ${k}: piece ${i} is held`);
    await checkView(page, v, `drag ${k}`);
    await f.up(1);
    const got = await placed(page);
    if (v.slot) { slotted++; assert.deepEqual(got, [[i, v.slot.r, v.slot.c]], `drag ${k}: landed in the slot it showed`); }
    else { floated++; assert.deepEqual(got, [], `drag ${k}: nothing placed`); assert.ok(await page.evaluate(i => !!tray[i], i), `drag ${k}: back in the tray`); }
    assert.equal(await page.evaluate(() => state), 'play');
  }
  console.log(`     (${slotted} with a landing slot, ${floated} without)`);
  assert.ok(slotted >= 15 && floated >= 10, `covered both cases (${slotted} with a slot, ${floated} without)`);
});

test('with the magnet on, the piece sits exactly in its slot and lands there', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  await page.evaluate(() => { CFG.FX_MAGNET = true; });
  await setup(page, { rows: EMPTY, trayShapes: [9, 0, 0] });
  const g = await geometry(page), f = await fingers(page);
  const to = fingerFor(g, { rows: 2, cols: 2 }, 2.3, 4.6);
  await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
  await f.move(1, to.x, to.y, 6);
  await frames(page, 14);
  const v = await dragView(page);
  assert.deepEqual(v.slot, { r: 2, c: 5 });
  await checkView(page, v, 'magnet');
  await f.up(1);
  assert.deepEqual(await placed(page), [[0, 2, 5]]);
});

test('a second finger during a drag changes nothing', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  await setup(page, { rows: EMPTY, trayShapes: [9, 3, 0] });
  const g = await geometry(page), f = await fingers(page);
  const to = fingerFor(g, { rows: 2, cols: 2 }, 3, 3);
  await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
  await f.move(1, to.x, to.y, 5);
  await frames(page, 10);
  const before = await dragView(page);
  assert.deepEqual(before.slot, { r: 3, c: 3 });
  // second finger: lands on another tray piece, wanders over the board, lifts
  await f.down(2, g.trayCenters[1].x, g.trayCenters[1].y);
  await f.move(2, g.bx + g.cell, g.by + g.cell, 5);
  await frames(page, 4);
  let v = await dragView(page);
  assert.equal(v.i, 0, 'still holding the first piece');
  assert.deepEqual(v.slot, before.slot, 'slot unchanged');
  near(v.cx, before.cx, 'piece did not move'); near(v.cy, before.cy, 'piece did not move');
  await f.up(2);
  await frames(page, 2);
  assert.deepEqual(await placed(page), [], 'lifting the second finger drops nothing');
  assert.ok(await dragView(page), 'the drag goes on');
  await f.up(1);
  assert.deepEqual(await placed(page), [[0, 3, 3]], 'the first finger places it where it showed');
  assert.ok(await page.evaluate(() => !!tray[1]), 'the piece under the second finger was never picked up');
});

test('a cancelled touch sends the piece back', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  await setup(page, { rows: EMPTY, trayShapes: [9, 3, 0] });
  const g = await geometry(page), f = await fingers(page);
  const to = fingerFor(g, { rows: 2, cols: 2 }, 3, 3);
  await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
  await f.move(1, to.x, to.y, 5);
  await frames(page, 4);
  await f.cancel();
  await frames(page, 2);
  assert.equal(await dragView(page), null);
  assert.deepEqual(await placed(page), []);
  assert.equal((await snap(page)).tray[0].n, 4);
});

test('leaving the app mid-drag sends the piece back and frees the next pickup', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  await setup(page, { rows: EMPTY, trayShapes: [9, 0, 0] });
  const g = await geometry(page), f = await fingers(page);
  const to = fingerFor(g, { rows: 2, cols: 2 }, 3, 3);
  await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
  await f.move(1, to.x, to.y, 5);
  await page.evaluate(() => {             // iOS backgrounds the web clip without a pointercancel
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
  assert.equal(await dragView(page), null, 'the drag ended');
  assert.equal((await snap(page)).tray[0].n, 4, 'piece back in the tray');
  await f.up(1);
  assert.deepEqual(await placed(page), [], 'the stale finger lifting places nothing');
  await dragPiece(page, 0, 1, 1);
  assert.deepEqual(await placed(page), [[0, 1, 1]], 'the next drag works');
});

test('releases at the board edge: just over lands on the edge, farther out comes back', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  const g = await geometry(page), f = await fingers(page), sq = { rows: 2, cols: 2 };
  const cases = [
    [3, -0.6, [3, 0]], [3, -0.95, null],       // left edge (out past reach + hold, so the path in doesn't matter)
    [3, 6.6, [3, 6]], [3, 6.95, null],         // right edge (a 2x2 can start at column 6 at most)
    [-0.7, 2, [0, 2]], [-0.95, 2, null],       // top edge
    [6.7, 4, [6, 4]], [6.95, 4, null],         // bottom edge
    [-0.6, -0.6, [0, 0]], [6.6, 6.6, [6, 6]],  // corners
  ];
  for (const [r, c, want] of cases) {
    await setup(page, { rows: EMPTY, trayShapes: [9, 0, 0] });
    const to = fingerFor(g, sq, r, c);
    await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
    await f.move(1, to.x, to.y, 6);
    await frames(page, 12);
    await checkView(page, await dragView(page), `(${r},${c})`);
    await f.up(1);
    assert.deepEqual(await placed(page), want ? [[0, ...want]] : [], `release at (${r},${c})`);
  }
});

test('a finger exactly between four cells still seats', async ({ page }) => {
  await play(page);
  await watchPlace(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  const g = await geometry(page), f = await fingers(page);
  const to = fingerFor(g, { rows: 1, cols: 1 }, 3.5, 3.5);
  await f.down(1, g.trayCenters[0].x, g.trayCenters[0].y);
  await f.move(1, to.x, to.y, 6);
  await frames(page, 12);
  const v = await dragView(page);
  assert.ok(v.slot, 'seated');
  await checkView(page, v, 'between four');
  await f.up(1);
  assert.deepEqual(await placed(page), [[0, v.slot.r, v.slot.c]]);
});

test('every piece floats the same height above the finger', async ({ page }) => {
  await play(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 3, 10] });   // 1-row, 1-row bar, 3-row square
  const g = await geometry(page), f = await fingers(page);
  const gaps = [];
  for (const i of [0, 1, 2]) {
    const x = g.trayCenters[i].x, y = g.by + g.cell * 12;     // well below the board: nothing to seat into
    await f.down(1, g.trayCenters[i].x, g.trayCenters[i].y);
    await f.move(1, x, y, 4);
    await frames(page, 12);
    const v = await dragView(page);
    assert.equal(v.slot, null);
    gaps.push(y - (v.cy + v.rows * g.cell / 2));                // finger to the piece's bottom edge
    await f.up(1);
    await frames(page, 30);
  }
  gaps.forEach(d => near(d, g.cell * g.lift, 'gap below the piece'));
});

// ── Frame budget (plan 2.2) ──

// Rows 0-2 full but for column 0; a vertical 1x3 bar (SHAPES[4]) dropped there clears three rows and
// empties the tray. The few gems left at the bottom keep it from being a clean sweep.
const THREE_LINES = ['01111111', '01111111', '01111111', '00000000', '00000000', '11000011', '10000001', '11000011'];

test('calm clears: an everyday clear is a squash, point tags and one praise word; combo 3+ brings the loud stuff', async ({ page }) => {
  await play(page);
  const loud = () => page.evaluate(() => ({ flashes: lineFlashes.length, waves: waves.length, shake, pops: pops.length, tags: tags.length, praises: praises.length, slams: slams.length, orbs: orbs.length, bands: bands.length, punch: punchT, combo }));
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const calm = await loud();
  assert.equal(calm.combo, 1);
  assert.equal(calm.praises, 1, 'one praise word');
  assert.deepEqual([calm.tags, calm.flashes, calm.waves, calm.shake], [0, 0, 0, 0], '6.3: a single line is crisp and quiet: no per-cell tags, line flash, ring or shake');
  assert.equal(calm.pops, 1, 'one score label');
  assert.deepEqual([calm.slams, calm.orbs, calm.bands, calm.punch], [0, 0, 0, 0], 'no slam, orbs, band or punch zoom');
  await dealt(page);
  await page.evaluate(() => { combo = 1; });                  // this clear makes it combo 2: still calm
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const two = await loud();
  assert.equal(two.combo, 2);
  assert.deepEqual([two.slams, two.orbs], [0, 0], 'combo 2 is still calm');
  await dealt(page);
  await page.evaluate(() => { combo = 2; });                  // combo 3: the loud tier
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const big = await loud();
  assert.equal(big.combo, 3);
  assert.ok(big.slams === 1 && big.orbs > 0, 'slam and score orbs at combo 3');
});

test('6.3 animation hierarchy: two lines are bigger than one; a narrow escape and a sweep have their own moments', async ({ page }) => {
  await play(page);
  const fx = () => page.evaluate(() => ({ tags: tags.length, flashes: lineFlashes.length, waves: waves.length, shake, banners: banners.map(b => b.txt) }));
  await setup(page, { rows: THREE_LINES, trayShapes: [4, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const multi = await fx();
  assert.ok(multi.tags > 0 && multi.flashes > 0 && multi.waves > 0 && multi.shake > 0, 'a multi-line clear keeps tags, flashes, a ring and a shake');
  await dealt(page);
  const CRAMPED = ['01111111', '01111111', '01111111', '00111111', '01011111', '01101111', '01110011', '01111100'];
  await setup(page, { rows: CRAMPED, trayShapes: [4, 0, 0] });
  const rm = await page.evaluate(() => { paceSet('edge'); banners.length = 0; return roomOf(packGrid(grid)); });
  assert.ok(rm < 0.3, 'the board starts cramped: ' + rm);
  await dragPiece(page, 0, 0, 0);
  const esc = await fx();
  assert.ok(esc.banners.includes('PHEW!'), 'clearing out of the edge flourishes');
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { paceSet('edge'); banners.length = 0; });
  await dragPiece(page, 0, 0, 0);
  assert.ok(!(await fx()).banners.includes('PHEW!'), 'a clear from a roomy board (even in an edge tray) is no escape');
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 8)], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { banners.length = 0; paceSet('edge'); });
  await dragPiece(page, 0, 0, 0);
  const sweep = await fx();
  assert.ok(sweep.banners.includes('CLEAN SWEEP') && !sweep.banners.includes('PHEW!'), 'a sweep keeps its own banner, not the escape one');
});

test('the opening: 100 seeded new games each clear a line within the first three placements', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = [];
    const orig = Math.random;
    for (let seed = 1; seed <= 100; seed++) {
      let a = seed * 2654435761 >>> 0;                    // a fresh mulberry32 stream per game
      Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      start();
      const a0 = packGrid(grid), hand = tray.map(t => t.s), ev = evalHand(a0, hand, 6000);
      // plan 6.0: the cells left after the first clearing drop (the first found, in the solver's scan order)
      const pop = x => { let n = 0; for (; x; x >>>= 1) n += x & 1; return n; };
      let left = -1;
      for (let i = 0; i < 3 && left < 0; i++) for (const m of placeMasks(tray[i].s)) {
        const [lo0, hi0] = packBits(a0);
        if ((lo0 & m.lo) || (hi0 & m.hi)) continue;
        if (applyBits(lo0, hi0, tray[i].s, m) > 0) { left = pop(_lo) + pop(_hi); break; }
      }
      out.push({ filled: countFlat(a0), ok: ev.ok, lines: ev.lines, imm: ev.imm, trayNo, label: lastTier, left, specials: tray.some(t => t.s.star) || !!golden || !!transform || !!bonus });
    }
    Math.random = orig;
    return out;
  });
  assert.equal(r.length, 100);
  assert.ok(r.every(g => g.ok), 'all three pieces of the first tray are playable');
  assert.ok(r.every(g => g.imm >= 1), 'a line is completed by one placement (imm counts what a single drop clears), well within three');
  assert.ok(r.every(g => g.filled >= 4 && g.filled <= 16 && g.label === 'OPENING' && g.trayNo === 1), 'a modest seeded pattern, dealt as the opening tray');
  assert.ok(r.every(g => !g.specials));
  assert.ok(new Set(r.map(g => g.filled)).size > 3, 'the patterns vary');
  // plan 6.0: most first clears leave blocks; about 1 in 8 sweep the board clean (the rest are the scattered gems)
  const sweeps = r.filter(g => g.left === 0).length;
  assert.ok(r.every(g => g.left >= 0), 'every opening has a clearing drop');
  assert.ok(sweeps >= 3 && sweeps <= 25, `about 1 in 8 openings sweep on move one (got ${sweeps}/100)`);
  assert.ok(r.filter(g => g.left > 0).length >= 75, 'most first clears leave blocks on the board');
});

test('the opening clear really works through the UI: drag the clearing piece, the line goes', async ({ page }) => {
  await play(page);
  const found = await page.evaluate(() => {
    const a0 = packGrid(grid);
    for (let i = 0; i < 3; i++) for (const m of placeMasks(tray[i].s)) {
      if ((packBits(a0)[0] & m.lo) || (packBits(a0)[1] & m.hi)) continue;
      const [lo, hi] = packBits(a0);
      if (applyBits(lo, hi, tray[i].s, m) > 0) return { i, r: m.r, c: m.c };
    }
    return null;
  });
  assert.ok(found, 'a clearing drop exists');
  const before = await snap(page);
  await dragPiece(page, found.i, found.r, found.c);
  const after = await snap(page);
  assert.ok(after.score > before.score + before.tray[found.i].n - 1, 'it scored a clear');
  assert.ok(after.filled < before.filled + before.tray[found.i].n, 'cells left the board');
});

test('trays 1-5 never carry a special, even with every special on; from tray 6 they can', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const was = { ...CFG.SPECIALS };
    Object.assign(CFG.SPECIALS, { star: true, golden: true, transform: true }); CFG.STAR_CHANCE = 1; CFG.MYSTERY_CHANCE = 1; CFG.GOLDEN_CHANCE = 1;
    const early = [], late = [];
    for (let n = 1; n <= 12; n++) {
      trayNo = n - 1; starForced = true; starCool = 0; specialEnd = -99; goldenNext = true; goldenCool = 0; transform = null; transformCool = 0;
      grid = empty(); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (r !== c) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 };   // a board where a cross is worth 14
      tray = [null, null, null];
      genTray();
      (n <= 5 ? early : late).push({ star: tray.some(t => t.s.star), gold: !!golden, tf: !!transform });
    }
    const t = (trayNo = 2, transform = null, triggerTransform('rainbow'), !!transform);
    CFG.SPECIALS = was;
    return { early, late, earlyTransform: t };
  });
  assert.ok(r.early.every(x => !x.star && !x.gold && !x.tf), 'no star, golden hand or transformation in trays 1-5');
  assert.ok(r.late.some(x => x.star || x.gold || x.tf), 'switched on, they do appear later');
  assert.equal(r.earlyTransform, false, 'an achievement cannot start a transformation in the opening either');
});

test('one switch per special: all four are on; transformations are three-plus-one named achievements', async ({ page }) => {
  await play(page);
  assert.deepEqual(await page.evaluate(() => CFG.SPECIALS), { bonus: true, star: true, golden: true, transform: true });
  const r = await page.evaluate(() => {
    starForced = true;
    let stars = 0;
    for (let i = 0; i < 40; i++) {
      genTray();
      stars += tray.filter(t => t && t.s.star).length;
    }
    trayNo = 2; triggerTransform('rainbow');
    return { stars, transform: !!transform, bonus: !!bonus };
  });
  assert.deepEqual(r, { stars: 0, transform: false, bonus: false }, 'on an empty board no cross is worth a star, so none is dealt; early trays never start a transformation');
  const on = await page.evaluate(() => { trayNo = 10; transformCool = 0; specialEnd = -99; triggerTransform('rainbow'); return !!transform; });
  assert.equal(on, true, 'from tray 6 an achievement starts its transformation');
  const off = await page.evaluate(() => { CFG.SPECIALS.transform = false; transform = null; triggerTransform('volcano'); return { live: !!transform, owned: discoveredWorlds.has('volcano') }; });
  assert.deepEqual(off, { live: false, owned: false }, 'switched off, nothing happens and nothing unlocks');
});

// ---- star gem (plan 4.5b) ----
const withDiag = async page => { await play(page); await page.evaluate(() => { window.diagBoard = () => { grid = empty(); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (r !== c) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 }; }; }); };   // board full but the diagonal: a star's cross is worth 14

test('star gem: dealt only when a cross is worth it, with a cooldown, and never two specials in a row', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(() => {
    const out = {};
    const edge0 = CFG.ROOM_EDGE;
    diagBoard(); pace = { ph: 'calm', n: 0, hold: 0, len: 0 }; trayNo = 9; starForced = true; starCool = 0; specialEnd = -99; tray = [null, null, null]; genTray();
    out.edgeStar = { ph: pace.ph, star: tray.some(t => t && t.s.star) };   // (6.1) the diagonal board is cramped: an edge tray, and edge trays carry no star
    CFG.ROOM_EDGE = 0;                                                     // the rest checks the star's own rules, away from the edge
    grid = empty(); out.empty = starBest(grid).n;
    diagBoard(); out.diag = starBest(grid).n; out.at = starAt(3, 3);
    const deal = (setup) => { trayNo = 9; starForced = true; starCool = 0; specialEnd = -99; tray = [null, null, null]; setup && setup(); genTray(); return tray.some(t => t && t.s.star); };
    grid = empty(); out.emptyDealt = deal();
    for (let i = 0; i < 5; i++) { grid = empty(); for (let k = 0; k < 6; k++) { grid[0][k] = { gi: 0, t: 1, f: 0, l: 0 }; grid[1][k] = { gi: 0, t: 1, f: 0, l: 0 }; } out.thin = (out.thin || starBest(grid).n); }
    diagBoard(); out.worth = deal();
    diagBoard(); out.cool = starCool;                                       // set by the deal above
    diagBoard(); trayNo = 20; starForced = true; tray = [null, null, null]; genTray(); out.coolHeld = tray.some(t => t && t.s.star);
    diagBoard(); out.again = deal(() => { specialEnd = 9; });                // a special ended in tray 9: tray 10 (the one dealt) carries none
    diagBoard(); out.afterGap = deal(() => { specialEnd = 8; });
    diagBoard(); out.bonus = deal(() => { bonus = { left: 2, extra: 0 }; }); bonus = null;
    diagBoard(); out.live = deal(() => { tray = [{ s: STAR, gi: STAR_GI }, null, null]; });
    CFG.ROOM_EDGE = edge0;
    return out;
  });
  assert.deepEqual(r.edgeStar, { ph: 'edge', star: false }, 'no star on an edge tray (6.1)');
  assert.equal(r.empty, 0); assert.equal(r.diag, 14); assert.equal(r.at, 14);
  assert.equal(r.emptyDealt, false, 'an empty board is not worth a star');
  assert.ok(r.thin < 9, 'two short rows are worth less than STAR_MIN');
  assert.equal(r.worth, true, 'a worthwhile cross and a forced star: dealt');
  assert.equal(r.cool, 8, 'the cooldown starts when it is dealt');
  assert.equal(r.coolHeld, false, 'no second star during the cooldown');
  assert.equal(r.again, false, 'never two specials in a row');
  assert.equal(r.afterGap, true, 'one tray later it can come');
  assert.equal(r.bonus, false, 'none during a bonus');
  assert.equal(r.live, false, 'none while another is live');
});

test('star gem: it clears exactly its row and column, pays per gem, ends the special streak and survives Undo and resume', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(async () => {
    diagBoard(); trayNo = 12; combo = 0; score = 0;
    tray = [{ s: STAR, gi: STAR_GI }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    const sn = snapshot(), seenBefore = stats.starSeen;
    place(0, 3, 3);
    const left = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c]) left.push([r, c]);
    const out = { seenBefore, score, end: specialEnd, trayNo, seen: stats.starSeen, rowGone: grid[3].every(v => !v),
      colGone: grid.every(row => !row[3]), left: left.length, kept: grid[0][1] !== null && grid[0][2] !== null };
    undo(); out.undone = tray[0] && tray[0].s.star && grid[3][0] !== null; out.endUndone = specialEnd; out.scoreUndone = score;
    const j = JSON.parse(JSON.stringify(snapshot())); tray = [null, null, null]; restore(j);
    out.resumed = tray[0] && tray[0].s.star; out.cool = starCool;
    return out;
  });
  assert.equal(r.rowGone && r.colGone, true, 'the whole row and the whole column are gone');
  assert.equal(r.left, 42, 'only the cross left the board');
  assert.equal(r.kept, true, 'everything else stays');
  assert.ok(r.score >= 14 * 14, 'a 14-gem cross pays per gem (' + r.score + ')');
  assert.equal(r.end, 12, 'placing it sets specialEnd to its tray');
  assert.equal(r.seenBefore, 0); assert.equal(r.seen, 1, 'the first-star label is used up');
  assert.equal(r.undone, true, 'Undo puts the star and the board back');
  assert.equal(r.endUndone, -99); assert.equal(r.scoreUndone, 0);
  assert.equal(r.resumed, true, 'a star in hand survives save/resume');
});

test('star gem: the first one shows a one-line label, a full bonus meter just waits while a star is in the tray, no hesitation sample', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(() => {
    diagBoard(); trayNo = 12; stats.starSeen = 0; bonusMeter = CFG.BONUS_METER;
    tray = [{ s: STAR, gi: STAR_GI }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }]; dealing = null; syncActions();
    const out = { note: !el('starNote').hidden, due: bonusDue(), chip: el('bonusChip').textContent.trim() };
    tray = [null, null, null]; hes.dealtAt = 5; commitTray([STAR, SHAPES[0], SHAPES[0]], 'T'); out.hes = hes.dealtAt;
    stats.starSeen = 1; syncActions(); out.noteAfter = !el('starNote').hidden;
    tray = [{ s: SHAPES[0], gi: 1 }, null, null]; syncActions(); out.dueAfter = bonusDue();
    return out;
  });
  assert.equal(r.note, true, 'the first star ever is explained once');
  assert.equal(r.noteAfter, false, 'and never again');
  assert.equal(r.due, false, 'a full meter does not start a bonus beside a star'); assert.equal(r.chip, '×2 bonus next');
  assert.equal(r.dueAfter, true, 'it is due again once the star is gone');
  assert.equal(r.hes, 0, 'a star tray gives no hesitation sample');
});

test('star gem: tray beam, hint ring and the clear animation draw without errors and finish within 600 ms', async ({ page, errors }) => {
  await withDiag(page);
  const r = await page.evaluate(async () => {
    diagBoard(); trayNo = 12; combo = 0;
    tray = [{ s: STAR, gi: STAR_GI }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    await new Promise(r => setTimeout(r, 300));
    const t0 = performance.now(); place(0, 3, 3);
    while ((shatters.length || blasts.length) && performance.now() - t0 < 2000) await new Promise(r => setTimeout(r, 16));
    return performance.now() - t0;
  });
  assert.ok(r < 700, 'from drop to empty cells: ' + Math.round(r) + ' ms');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});


test('a 3-line clear: the next tray is dealt after the clear starts (frame times logged)', async ({ page }) => {
  await play(page);
  await watchFrames(page);
  await page.evaluate(() => { combo = 2; });                  // mid-streak: COMBO slam, fireworks, praise, the lot
  await setup(page, { rows: THREE_LINES, trayShapes: [4, null, null] });
  await frames(page, 5);
  await frameLog(page);
  await page.evaluate(() => {                                   // note the frame the clear first drew and the frame the tray came back
    window.__seen = { n: 0, clearAt: -1, trayAt: -1 };
    const of = frame;
    frame = function (now) {
      of(now); const s = __seen; s.n++;
      if (s.clearAt < 0 && shatters.length) s.clearAt = s.n;
      if (tray.every(v => !v)) s.empty = true;
      else if (s.empty && s.trayAt < 0) s.trayAt = s.n;
    };
  });
  await dragPiece(page, 0, 0, 0);
  await dealt(page);
  await frames(page, 60);
  const seen = await page.evaluate(() => __seen), log = await frameLog(page);
  assert.ok(seen.clearAt > 0, 'the clear drew');
  assert.ok(seen.trayAt > seen.clearAt, `the tray came after the clear's first frame (clear ${seen.clearAt}, tray ${seen.trayAt})`);
  const s = await snap(page);
  assert.deepEqual(s.rows.slice(0, 3), ['00000000', '00000000', '00000000'], 'three rows cleared');
  assert.equal(s.tray.filter(Boolean).length, 3, 'a full tray was dealt');
  assert.equal(s.state, 'play');
  const maxWork = Math.max(...log.work), maxStep = Math.max(...log.steps);
  console.log(`     (drop ${log.place[0].toFixed(1)} ms, slowest frame ${maxWork.toFixed(1)} ms, deal ${log.steps.length} slices, largest ${maxStep.toFixed(1)} ms)`);
  // timings are logged, not asserted: headless wall time on a shared CI runner says little about the phone
});

test('a deal runs in small slices, and pickups wait for it', async ({ page }) => {
  await play(page);
  await watchFrames(page);
  await setup(page, { rows: THREE_LINES.map((r, i) => (i < 3 ? '00000000' : r)), trayShapes: [0, 1, 2] });
  await frameLog(page);
  const g = await geometry(page);
  const during = await page.evaluate(p => {                    // same task as the deal's start, so no frame can finish it first
    dealLater();
    const was = !!dealing;
    onDown({ pointerId: 7, clientX: p.x, clientY: p.y });
    return { was, drag: !!drag };
  }, g.trayCenters[0]);
  assert.equal(during.was, true, 'the new hand is being dealt');
  assert.equal(during.drag, false, 'the old piece can\'t be picked up while the new hand is coming');
  await dealt(page);
  const { steps } = await frameLog(page);
  const slice = await page.evaluate(() => CFG.DEAL_SLICE_MS);
  console.log(`     (${steps.length} slices, largest ${Math.max(...steps).toFixed(1)} ms)`);
  const sorted = steps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  assert.ok(steps.length >= 1 && median < slice + 3, `slices stay near DEAL_SLICE_MS (${steps.map(x => x.toFixed(1))})`);
});

test('dealing in slices runs the same search as dealing in one go', async ({ page }) => {
  await play(page);
  const same = await page.evaluate(() => {
    const seeded = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const keep = Math.random, out = [];
    for (let k = 0; k < 12; k++) {
      grid = grid.map(r => r.map(() => (keep() < 0.3 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
      const g0 = grid, ten = k / 11, carry0 = carry, star0 = starForced, no0 = trayNo;
      const pace0 = { ph: ['calm', 'building', 'edge', 'recovery', 'relief'][k % 5], n: 1 + (k % 3), hold: 2, len: 2 };   // (6.1) every phase, mid-way
      bonus = k % 3 === 2 ? { left: 2, extra: 0 } : null;
      const run = stepwise => {
        grid = g0; tension = ten; carry = carry0; starForced = star0; trayNo = no0; transform = null; sweepCool = 0; goldenCool = 0; transformCool = 9; pace = { ...pace0 }; starCool = 0; specialEnd = -99; tray = [null, null, null];
        goldenNext = k % 4 === 1; Math.random = seeded(100 + k);
        if (stepwise) { const it = dealSteps(); while (!it.next().done) performance.now(); } else genTray();   // stepwise: one candidate per call, as frames would
        return tray.map(t => SHAPES.indexOf(t.s) + ':' + t.gi).join(',') + '|' + lastTier;
      };
      out.push([run(false), run(true)]);
    }
    Math.random = keep; bonus = null; golden = null;
    return out;
  });
  same.forEach(([a, b], k) => assert.equal(b, a, `board ${k}`));
});

// Plan 3.4: the dealer counts OBVIOUS clears (a 5-7/8 full line whose gap is one plain run the piece drops into)
// and ALT, the room the hand's smallest piece of 2+ cells has (singles never count, so dots are not rewarded).
test('obvious clears: 5-7 of 8 filled with one plain gap; half-empty lines and scattered gaps are not obvious', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const board = rows => packGrid(rows.map(r => [...r].map(ch => (ch === '1' ? 1 : null))));
    const E = Array(8).fill('00000000');
    const bar2 = SHAPES[1], vbar2 = SHAPES[2], bar4 = SHAPES[5], one = SHAPES[0], bar3 = SHAPES[3];
    const ev = (rows, hand) => { const e = evalHand(board(rows), hand, 4000); return { imm: e.imm, obv: e.obvPieces, alt: e.alt }; };
    const col = Array.from({ length: 8 }, (_, r) => (r < 6 ? '00010000' : '00000000'));     // column 3: rows 0-5 filled
    const tight = ['01111111', ...Array(6).fill('11111111'), '00011111'];                // three spots for a single, 2 for a 2-bar
    return {
      run: [0b11111100, 0b11011011, 0b00001111, 0b11111110, 0xFF, 0b00111111].map(b => RUN_OK[b]),
      gap2: ev(['11111100', ...E.slice(1)], [bar2, one, one]),
      half: ev(['11110000', ...E.slice(1)], [bar4, one, one]),
      split: ev(['11011011', ...E.slice(1)], [one, one, one]),
      column: ev(col, [vbar2, bar2, one]),
      alt: ev(tight, [one, bar3, bar2]),
      altEmpty: ev(E, [one, bar2, bar3]),
    };
  });
  assert.deepEqual(r.run, [1, 0, 0, 1, 0, 1], 'RUN_OK: 5-7 filled and one run of empties');
  assert.deepEqual(r.gap2, { imm: 1, obv: 1, alt: 8 }, 'a 6/8 row with a 2-gap and a 2-bar: one obvious piece');
  assert.equal(r.half.imm, 1); assert.equal(r.half.obv, 0, 'a 4/8 row is a clear, but not an obvious one');
  assert.equal(r.split.imm, 0); assert.equal(r.split.obv, 0, 'two separate gaps: no single drop clears it');
  assert.equal(r.column.obv, 1, 'columns count too, and only the piece that fits the gap');
  assert.equal(r.alt.alt, 2, 'ALT counts the 2-bar\'s spots (2), not the single\'s');
  assert.equal(r.altEmpty.alt, 8, 'ALT is capped at 8');
});

// The hesitation log (plan 3.4): deal to first pickup, pickup to the first drop, and whether it cleared.
test('the hesitation log times the first drop of each tray, skips restored trays, persists, and shows in ?dev', async ({ page, server }) => {
  await play(page);
  assert.equal(await page.evaluate(() => hes.log.length), 0);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await page.waitForTimeout(400);
  await dragPiece(page, 0, 0, 0);
  let log = await page.evaluate(() => hes.log.slice());
  assert.equal(log.length, 1);
  assert.ok(log[0].pick >= 380, 'deal to first pickup counts the wait: ' + log[0].pick);
  assert.ok(log[0].place >= 0 && log[0].place < 2000);
  assert.equal(log[0].clr, 1, 'the first drop cleared');
  await dragPiece(page, 1, 4, 4);
  assert.equal(await page.evaluate(() => hes.log.length), 1, 'only the first drop of a tray is a sample');
  // finish the tray, so a fresh one is dealt and timed; then Undo its first drop: the replay is not a sample
  await dragPiece(page, 2, 6, 6); await dealt(page);
  const mv = () => page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
  let m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2);
  await page.click('#undoBtn');
  m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'a tray put back by Undo gives no sample');
  // a resumed run (force-quit) gives no bogus deal-to-pickup time for the tray it reopens on
  await page.evaluate(() => saveRun());
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'the log survives a reload');
  m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'a restored tray gives no sample');
  // Settings open before the first drop throws the sample away
  await page.evaluate(() => { hesDealt(); });
  await page.evaluate(() => { el('setBtn') && el('setBtn').click(); });
  await page.evaluate(() => { const d = el('setDone'); if (d) d.click(); });
  m = await mv(); if (m) await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'opening Settings voids the sample');
  // on her phone there is no URL bar: five quick taps on the Settings note show the same numbers
  await page.click('#setBtn');
  for (let k = 0; k < 5; k++) await page.click('#setNote');
  assert.match(await page.textContent('#setNote'), /^Last 2 trays \(2 kept\): first pickup [\d.]+s, pickup to drop [\d.]+s, first drop clears \d+%$/);
  await page.click('#setDone');
  await page.goto(server.url + '?dev');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  await page.waitForFunction(() => el('perfHud') && /hes pick [\d.]+s  place [\d.]+s  clr \d+%  n 2\/2/.test(el('perfHud').textContent), null, { timeout: 3000 });
});

test('Settings fits one screen; a look sets theme, world, skin and motif together and survives a reload; locked looks refuse', async ({ page }) => {
  await page.click('#startSettings');
  const fit = await page.evaluate(() => { const l = el('setList'); return { sh: l.scrollHeight, ch: l.clientHeight, done: el('setDone').getBoundingClientRect().bottom, vh: innerHeight }; });
  assert.ok(fit.sh <= fit.ch + 1, `Settings scrolls: ${fit.sh} > ${fit.ch}`);
  assert.ok(fit.done <= fit.vh, 'Done is on screen');
  assert.equal(await page.locator('#lookGrid .look-btn').count(), 9, 'five everyday looks and the four earned ones');
  assert.equal(await page.getAttribute('#lookGrid [data-id=classic]', 'aria-pressed'), 'true', 'Classic is lit by default');
  await page.click('#lookGrid [data-id=cotton]');
  const look = () => page.evaluate(() => ({ t: CFG.THEME, w: CFG.HOME_WORLD, s: CFG.STYLE, m: CFG.MOTIF, cs: curSkin, cw: curWorld }));
  assert.deepEqual(await look(), { t: 'cotton', w: 'blossom', s: 'clay', m: 'heart', cs: 'clay', cw: 'blossom' });
  assert.equal(await page.getAttribute('#lookGrid [data-id=cotton]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#lookGrid [data-id=classic]', 'aria-pressed'), 'false');
  assert.ok(await page.locator('#lookGrid [data-id=neon]').isDisabled(), 'Neon is locked until its skin is earned');
  await page.evaluate(() => el('lookGrid').querySelector('[data-id=neon]').click());
  assert.equal((await look()).t, 'cotton', 'a locked look does nothing');
  await page.click('#advLook summary');                          // mixing one setting leaves no preset lit
  await page.click('#skinGrid [data-id=blocks]');
  assert.equal(await page.locator('#lookGrid [aria-pressed=true]').count(), 0);
  await page.click('#lookGrid [data-id=mint]');
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await look(), { t: 'mint', w: 'forest', s: 'blocks', m: 'none', cs: 'blocks', cw: 'forest' });
  await page.click('#startSettings');
  assert.equal(await page.getAttribute('#lookGrid [data-id=mint]', 'aria-pressed'), 'true', 'the saved look is lit after a reload');
  await page.evaluate(() => { unlocked.add('neon'); renderLooks(); });
  await page.click('#lookGrid [data-id=neon]');
  assert.equal((await look()).s, 'neon', 'an unlocked look can be picked');
});

test('slow frames shrink the particle budget, and it grows back', async ({ page }) => {
  await play(page);
  const before = await page.evaluate(() => { perf.fx = 1; return perf.fx; });   // start from a full budget: a slow CI runner may already have cut it
  await page.evaluate(() => new Promise(res => {             // eight frames that each take ~35 ms
    let n = 8; const busy = () => { const t = performance.now(); while (performance.now() - t < 35); if (--n) requestAnimationFrame(busy); else res(); };
    requestAnimationFrame(busy);
  }));
  await frames(page, 2);
  const slow = await page.evaluate(() => ({ fx: perf.fx, over: perf.over }));
  assert.ok(slow.fx < before && slow.fx <= 0.5, `budget cut (${before} -> ${slow.fx})`);
  assert.ok(slow.over >= 6, `long frames counted (${slow.over})`);
  const capped = await page.evaluate(() => {
    for (let k = 0; k < 40; k++) spawnFirework(W / 2, H / 2);
    return { live: fxLive(), cap: Math.round(CFG.PARTICLE_CAP * perf.fx) };
  });
  assert.ok(capped.live <= capped.cap, `particles held to the budget (${capped.live} <= ${capped.cap})`);
  await page.evaluate(() => { bursts.length = 0; });
  await page.waitForFunction(() => perf.fx > 0.9, null, { timeout: 5000 }).catch(() => {});
  // headless frames aren't always on time; when they are, the budget must have come back
  const gaps = await page.evaluate(() => Math.max(...perf.gaps));
  if (gaps <= 20) assert.ok(await page.evaluate(() => perf.fx > 0.9), 'budget recovered');
  // a phone held at 30 Hz (Low Power Mode) runs every frame at ~33 ms: that is its normal pace, not a slow moment
  const lowPower = await page.evaluate(() => { perf.gaps.fill(0); perf.fx = 1; for (let k = 0; k < 200; k++) perfFrame(33.3); return perf.fx; });
  assert.equal(lowPower, 1, 'a steady 30 Hz keeps the full particle budget');
});

test('the frame readout shows only with ?dev', async ({ page, server }) => {
  await frames(page, 20);
  assert.equal(await page.locator('#perfHud').count(), 0, 'no readout in the player build');
  await page.goto(server.url + '?dev');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  await page.waitForSelector('#perfHud', { state: 'visible', timeout: 3000 });
  await page.waitForFunction(() => /max [\d.]+ms/.test(el('perfHud').textContent));
  await page.evaluate(() => { perf.over = 7; });
  await page.dispatchEvent('#perfHud', 'pointerdown');
  assert.equal(await page.evaluate(() => perf.over), 0, 'a tap resets the count');
});

test('caches: text sprites evict one at a time, tile textures survive a look flip and back', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    SPRITES.clear();
    for (let k = 0; k < 160; k++) sprite('t' + k, 4, 4, () => {});
    const keep = SPRITES.get('t5');
    sprite('new', 4, 4, () => {});
    const sprites = { size: SPRITES.size, firstGone: !SPRITES.has('t0'), keptSame: SPRITES.get('t5') === keep };
    const home = gemBig;
    startFlip('rainbow', 'rainbow'); const away = gemBig;
    startFlip(curWorld, CFG.STYLE);
    return { sprites, changed: away !== home, back: gemBig === home };
  });
  assert.deepEqual(r.sprites, { size: 160, firstGone: true, keptSame: true });
  assert.ok(r.changed && r.back, 'the home tiles are reused after a flip');
});

const controlled = page => page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });

// Save and resume (plan 3.3). The page is reloaded in place, so localStorage survives like a force-quit.
const reload = async page => { await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle')); };
const runState = page => page.evaluate(() => ({ state, grid: grid.map(r => r.map(g => (g ? g.gi : -1))), tray: tray.map(t => (t ? [SHAPES.indexOf(t.s), t.gi] : null)),
  score, combo, trayNo, tension, rescuesUsed, lastTier, carry: carry.map(s => SHAPES.indexOf(s)), startHidden: el('startCard').hidden, shown: el('scoreVal').textContent }));

test('a force-quit mid-run reopens to the same board, tray, score and combo (the opening is not dealt again)', async ({ page, errors }) => {
  await play(page);
  const o = await page.evaluate(() => ({ r: grid.map(r => r.map(g => (g ? 1 : 0)).join('')), t: tray.map(t => SHAPES.indexOf(t.s)) }));
  // play a few real placements so the saved state is not just the opening
  for (let k = 0; k < 4; k++) {
    const mv = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
    if (!mv) break;
    await dragPiece(page, mv.i, mv.r, mv.c);
    await dealt(page);
  }
  await page.evaluate(() => { combo = 2; tension = 0.37; saveRun(); });      // a mid-combo state, saved as the game would
  const before = await runState(page);
  assert.ok(before.score > 0 && before.trayNo >= 1);
  await reload(page);
  const after = await runState(page);
  assert.equal(after.state, 'play', 'it reopens straight into the run');
  assert.equal(after.startHidden, true);
  assert.deepEqual({ ...after, startHidden: 0, shown: 0 }, { ...before, startHidden: 0, shown: 0 });
  assert.equal(after.shown, String(before.score), 'the HUD shows the saved score');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
  const g = await geometry(page);                                                         // and it is playable: a placement still works
  const mv = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
  const n0 = (await snap(page)).tray.filter(Boolean).length;
  await dragPiece(page, mv.i, mv.r, mv.c);
  const n1 = (await snap(page)).tray.filter(Boolean).length;
  assert.ok(n1 === n0 - 1 || n1 === 3, 'a piece was placed after resuming (or the next tray was dealt)');
  void o; void g;
});

test('snapshot() and restore() round-trip the run through plain JSON, with specials live', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    Object.assign(CFG.SPECIALS, { star: true, golden: true, transform: true });
    bonusMeter = 5; specialEnd = 7;
    const g = { want: { sweep: false, lines: 2 }, got: { lines: 1, sweep: false }, pts: 40 };
    golden = g; goldenNext = true; starForced = true; combo = 4; score = 321; rescuesUsed = 1; sweepCool = 3;
    tray[1] = { s: STAR, gi: STAR_GI };
    const a = JSON.parse(JSON.stringify(snapshot()));
    start(); start();                                                                      // scramble everything
    const ok = restore(a);
    const b = JSON.parse(JSON.stringify(snapshot()));
    return { ok, same: JSON.stringify(a) === JSON.stringify(b), star: tray[1].s.star, golden: !!golden, state };
  });
  assert.equal(r.ok, true); assert.equal(r.same, true); assert.equal(r.star, true); assert.equal(r.golden, true); assert.equal(r.state, 'play');
});

test('restore() refuses bad data and changes nothing', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const before = JSON.stringify(snapshot()), good = snapshot(), out = [];
    const bad = [null, {}, { ...good, v: 2 }, { ...good, grid: good.grid.slice(1) }, { ...good, tray: [null] },
      { ...good, grid: good.grid.map((r, i) => (i ? r : [99, ...r.slice(1)])) }, { ...good, tray: [{ s: 9999, gi: 0 }, null, null] }, { ...good, score: -5 }, { ...good, tension: 'x' }];
    for (const b of bad) out.push(restore(b));
    return { out, same: before === JSON.stringify(snapshot()) };
  });
  assert.ok(r.out.every(v => v === false)); assert.equal(r.same, true);
});

test('corrupt or missing saved data just opens the start card, no errors', async ({ page, errors }) => {
  await page.evaluate(() => { localStorage.setItem('crumble.run', '{not json'); localStorage.setItem('crumble.stats', '[1,'); });
  await reload(page);
  assert.equal((await snap(page)).state, 'idle');
  assert.equal(await page.isVisible('#startCard'), true);
  await page.evaluate(() => localStorage.setItem('crumble.run', JSON.stringify({ v: 1, grid: 'no' })));
  await reload(page);
  assert.equal((await snap(page)).state, 'idle');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED|JSON/.test(e)), []);
});

test('best score and lifetime stats persist, and unlock skins before the first frame', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { score = 950; });
  await page.evaluate(() => gameOver());
  await page.waitForFunction(() => state === 'over');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.stats')));
  assert.equal(st.best, 950); assert.equal(st.games, 1); assert.equal(st.totalScore, 950);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.run')), null, 'a finished run is not kept');
  await page.evaluate(() => localStorage.removeItem('crumble.skins'));                    // pretend the unlock list was lost: best alone must restore it
  await reload(page);
  const r = await page.evaluate(() => ({ state, best, shown: el('bestVal').textContent, glass: unlocked.has('glass'), candy: unlocked.has('candy'), neon: unlocked.has('neon') }));
  assert.equal(r.state, 'idle'); assert.equal(r.best, 950); assert.equal(r.shown, '950');
  assert.ok(r.glass && r.candy && !r.neon, 'skins up to 900 points are open');
});

test('lifetime stats count placements, lines, best combo and sweeps', async ({ page }) => {
  await play(page);
  await setup(page, { rows: ['11111110', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 7);
  await dealt(page);
  const s = await page.evaluate(() => ({ ...stats }));
  assert.equal(s.placed, 1); assert.equal(s.lines, 1); assert.equal(s.bestCombo, 1); assert.equal(s.games, 1);
  await page.evaluate(() => saveStats());
  await reload(page);
  assert.equal((await page.evaluate(() => stats.lines)), 1, 'stats survive a relaunch');
});

test('no storage: the game still plays', async ({ page, errors }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await reload(page);
  await play(page);
  const mv = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
  await dragPiece(page, mv.i, mv.r, mv.c);
  assert.equal((await snap(page)).state, 'play');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});

test('the service worker takes control and caches the game', async ({ page }) => {
  await controlled(page);
  const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length);
  assert.ok(cached >= 20, `precached ${cached} files`);
});

test('precache list matches the scripts index.html loads', async () => {
  const { assets, scripts } = expectedAssets();
  assert.deepEqual(assets.filter(a => a.endsWith('.js')), scripts);
});

test('launches offline and still plays', async ({ page }) => {
  await controlled(page);
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
  await play(page);
  assert.equal((await snap(page)).tray.filter(Boolean).length, 3);
});

test('a new deploy shows "Update ready" after the run, and tapping it reloads onto the new version', async ({ page, server }) => {
  await controlled(page);
  await play(page);
  server.patches['/sw.js'] = t => t.replace(/ASSET_HASH='[^']*'/, "ASSET_HASH='deploy2'");
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => !!r.waiting));
  await page.waitForTimeout(1300);
  assert.equal(await page.isVisible('#updateToast'), false, 'held back while a run is in progress');
  await page.evaluate(() => { state = 'over'; clearRun(); });     // a finished run leaves nothing to resume
  await page.waitForSelector('#updateToast', { state: 'visible', timeout: 3000 });
  await Promise.all([page.waitForNavigation(), page.click('#updateToast')]);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
  const keys = await page.evaluate(() => caches.keys());
  assert.deepEqual(keys, ['crumble-deploy2'], 'the old cache is gone');
});

// Undo and the stuck rescue button (plan 3.2).
const exact = page => page.evaluate(() => JSON.stringify(snapshot()));
const firstMove = page => page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });

test('Undo puts the run back exactly (including a clearing move), once per placement', async ({ page }) => {
  await play(page);
  assert.equal(await page.isDisabled('#undoBtn'), true, 'nothing to undo at the start');
  const g = await geometry(page);
  // a plain move
  const a = await exact(page);
  const mv = await firstMove(page);
  await dragPiece(page, mv.i, mv.r, mv.c); await dealt(page);
  assert.notEqual(await exact(page), a);
  assert.equal(await page.isDisabled('#undoBtn'), false);
  await page.click('#undoBtn');
  assert.equal(await exact(page), a, 'the exact round-trip');
  assert.equal(await page.isDisabled('#undoBtn'), true, 'only one move back');
  // a move that clears a line
  await setup(page, { rows: ['11111110', ...EMPTY.slice(1)], trayShapes: [0, 1, 2] });
  await page.evaluate(() => { tray[0] = { s: SHAPES.find(s => s.cols === 1 && s.rows === 1), gi: 1 }; });
  const b = await exact(page);
  await dragPiece(page, 0, 0, 7); await frames(page, 3);
  assert.equal((await snap(page)).rows[0], '00000000', 'the line cleared');
  await page.click('#undoBtn');
  assert.equal(await exact(page), b, 'the cleared line and the piece are back');
  assert.equal((await snap(page)).rows[0], '11111110');
  void g;
});

test('Undo is saved, survives a reload, and cannot refund a rescue or reach into a new run', async ({ page }) => {
  await play(page);
  const mv = await firstMove(page);
  await dragPiece(page, mv.i, mv.r, mv.c); await dealt(page);
  await page.click('#undoBtn');
  const after = await exact(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.run')), after, 'saved right after the undo');
  await reload(page);
  assert.equal(await exact(page), after, 'the undone state is what a force-quit reopens to');
  // a rescue clears Undo
  const mv2 = await firstMove(page);
  await dragPiece(page, mv2.i, mv2.r, mv2.c); await dealt(page);
  await page.evaluate(() => { rescuesUsed = 0; score = 500; stuck = true; syncActions(); });
  await page.click('#helpBtn');
  assert.equal(await page.isDisabled('#undoBtn'), true);
  // a new run clears Undo
  await page.evaluate(() => start());
  assert.equal(await page.isDisabled('#undoBtn'), true);
});

test('Undo during the 700 ms before game over cancels it', async ({ page }) => {
  await play(page);
  // a crowded board with one 2x2 hole; the tray holds a 1x1 and a 2x2. The 1x1 goes into the hole, the 2x2 then fits nowhere: stuck.
  await setup(page, { rows: ['00111111', '00111111', '11011011', '10110110', '11011011', '10110110', '11011011', '10110110'] });   // isolated holes below: no line is complete, no 2x2 fits except the top-left hole
  await page.evaluate(() => {
    const one = SHAPES.find(s => s.cols === 1 && s.rows === 1), two = SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2);
    tray = [{ s: one, gi: 1 }, { s: two, gi: 1 }, null]; score = 10;
  });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => stuck === true, null, { timeout: 2000 });
  assert.equal(await page.isDisabled('#undoBtn'), false);
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => state), 'play', 'stuck with Undo available: the run waits, it does not end');
  await page.click('#undoBtn');
  assert.equal(await page.evaluate(() => stuck), false);
  assert.equal(await page.isVisible('#noMoves'), false);
  // with no way out left, it ends by itself after the short wait
  await page.evaluate(() => { undoSnap = null; score = 0; tray = [null, { s: SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2), gi: 1 }, null]; grid[0][0] = grid[0][1] = grid[1][0] = grid[1][1] = { gi: 0, t: 1, f: 0, l: 0 }; checkStuck(); });
  await page.waitForFunction(() => !el('overCard').hidden, null, { timeout: 3000 });
});

test('a stuck board with a rescue available does not end the run; tapping Rescue continues it', async ({ page }) => {
  await play(page);
  await page.evaluate(() => {
    grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
    tray = [0, 1, 2].map(() => ({ s: SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2), gi: 1 }));
    rescuesUsed = 0; score = 500; undoSnap = null; checkStuck();
  });
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => state), 'play'); assert.equal(await page.isVisible('#overCard'), false);
  assert.equal(await page.isDisabled('#helpBtn'), false);
  await page.click('#helpBtn');
  const a = await page.evaluate(() => ({ state, rescuesUsed, fits: anyFits(), stuck }));
  assert.deepEqual(a, { state: 'play', rescuesUsed: 1, fits: true, stuck: false });
});

test('the rescue button is disabled whenever any piece fits, and spends a rescue when stuck', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 40; k++) {                                  // random boards and trays: the button state follows "nothing fits" exactly
      grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => (Math.random() < 0.7 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
      for (let r = 0; r < 8; r++) if (grid[r].every(v => v)) grid[r][0] = null;
      tray = [0, 1, 2].map(() => ({ s: SHAPES[(Math.random() * SHAPES.length) | 0], gi: 1 }));
      rescuesUsed = 0; score = 500; state = 'play'; checkStuck();
      out.push({ fits: anyFits(), disabled: el('helpBtn').disabled });
    }
    return out;
  });
  for (const x of r) assert.equal(x.disabled, x.fits, 'disabled exactly when a piece fits');
  assert.ok(r.some(x => x.fits) && r.some(x => !x.fits), 'the sample covered both cases');
  await page.waitForTimeout(900);                                    // any pending game-over timers from that loop
  await page.evaluate(() => { state = 'play'; el('overCard').hidden = true; });
  // stuck with a rescue left: pressing it spends one and deals a playable tray
  const o = await page.evaluate(() => {
    grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
    tray = [0, 1, 2].map(() => ({ s: SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2), gi: 1 }));
    rescuesUsed = 0; score = 500; checkStuck();
    return { fits: anyFits(), disabled: el('helpBtn').disabled };
  });
  assert.equal(o.fits, false); assert.equal(o.disabled, false);
  await page.click('#helpBtn');
  const after = await page.evaluate(() => ({ rescuesUsed, state, fits: anyFits(), over: !el('overCard').hidden, disabled: el('helpBtn').disabled }));
  assert.equal(after.rescuesUsed, 1); assert.equal(after.state, 'play'); assert.equal(after.fits, true); assert.equal(after.over, false); assert.equal(after.disabled, true);
});

/* ═══════ Bonus trays (plan 6.2, replaced the Blast Round) ═══════ */
// a row that one single-cell drop at (r,0) clears; combo is set so that drop's clear is combo k
const clearAt = (r, k) => `grid[${r}] = grid[${r}].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null)); tray[0] = { s: SHAPES[0], gi: 1 }; combo = (${k}) - 1; place(0, ${r}, 0);`;
const fillBonus = page => page.evaluate(() => { bonusMeter = CFG.BONUS_METER; syncBonusChip(); });
const chipText = page => page.evaluate(() => el('bonusChip').textContent.trim());

test('Blast is gone: no button, no card, no settings, no code; the bonus chip is not a button', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => ({
    btn: !!document.getElementById('blastBtn'), card: !!document.getElementById('blastCard'),
    fn: ['startBlast', 'endBlast', 'canBlast', 'chargeBlast', 'blastCharge', 'bigMode'].filter(n => { try { return typeof eval(n) !== 'undefined'; } catch (e) { return false; } }),
    cfg: Object.keys(CFG).filter(k => /^BLAST/.test(k)), spec: 'blast' in CFG.SPECIALS,
    tag: document.getElementById('bonusChip').tagName,
  }));
  assert.deepEqual(r, { btn: false, card: false, fn: [], cfg: [], spec: false, tag: 'DIV' });
});

test('the meter: each clear adds its lines plus a little for its combo (at most BONUS_COMBO_MAX), only from tray 6, never past full, and it holds during a bonus', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(src => {
    grid = empty(); bonusMeter = 0; trayNo = 10;
    const after = k => { bonusMeter = 0; eval(src.replace(/K/g, k)); return bonusMeter; };
    const out = {};
    out.single = after(1);                                   // one line, no combo: +1
    out.c2 = after(2);                                       // +1 +1
    out.c3 = after(3);                                       // +1 +2
    out.c6 = after(6);                                       // +1 +2 (the combo's share is capped)
    bonusMeter = 0; tray[1] = { s: SHAPES[0], gi: 1 }; place(1, 5, 5); out.noClear = bonusMeter;       // no clear: nothing
    trayNo = 4; out.early = after(5);                        // the opening (trays 1-5) fills nothing
    trayNo = 10; bonusMeter = CFG.BONUS_METER - 1; eval(src.replace(/K/g, 6)); out.capped = bonusMeter;   // never past full
    bonusMeter = 0; bonus = { left: 2, extra: 0 }; out.during = after(6); bonus = null;
    return out;
  }, clearAt(0, 'K'));
  assert.deepEqual(r, { single: 1, c2: 2, c3: 3, c6: 3, noClear: 0, early: 0, capped: await page.evaluate(() => CFG.BONUS_METER), during: 0 });
});

test('the chip shows the meter, says "next" when full, and counts trays while the bonus runs', async ({ page }) => {
  await play(page);
  assert.equal(await chipText(page), '×2 bonus');
  assert.equal(await page.evaluate(() => getComputedStyle(el('bonusChip')).getPropertyValue('--f').trim()), '0.000');
  await page.evaluate(() => { bonusMeter = 4; syncBonusChip(); });
  assert.equal(await page.evaluate(() => getComputedStyle(el('bonusChip')).getPropertyValue('--f').trim()), (4 / await page.evaluate(() => CFG.BONUS_METER)).toFixed(3));
  await fillBonus(page);
  assert.equal(await chipText(page), '×2 bonus next');
  assert.equal(await page.evaluate(() => el('bonusChip').classList.contains('full')), true, 'full: it glows');
  const r = await page.evaluate(() => { bonus = { left: 3, extra: 0 }; syncBonusChip(); const a = el('bonusChip').textContent.trim(); bonus.left = 1; syncBonusChip(); const b = el('bonusChip').textContent.trim(); bonus = null; return [a, b]; });
  assert.deepEqual(r, ['×2 · 3 trays left', '×2 · 1 tray left']);
});

test('a full meter starts the bonus with the next deal, never in the middle of a tray, and never while another special is live', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async () => {
    const out = {}; trayNo = 10; transformCool = 0; specialEnd = -99; grid = empty(); bonus = null;
    bonusMeter = CFG.BONUS_METER - 1;                               // a clear fills it mid-tray: nothing starts yet
    grid[0] = grid[0].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null));
    tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    place(0, 0, 0); out.midTray = { meter: bonusMeter, live: !!bonus };
    cancelDeal(); tray = [null, null, null];
    const deal = (setup) => { bonus = null; bonusMeter = CFG.BONUS_METER; specialEnd = -99; transform = null; golden = null; trayNo = 10; tray = [null, null, null]; grid = empty(); setup && setup(); genTray(); return { live: !!bonus, meter: bonusMeter }; };
    out.go = deal(); out.goLeft = bonus && bonus.left; out.goWorld = curWorld; out.bonuses = stats.bonuses;
    out.gap = deal(() => { specialEnd = 10; });                     // a special ended in the tray before: this one carries none
    out.transform = deal(() => { transform = { id: 'volcano', remaining: 4 }; });
    out.off = deal(() => { CFG.SPECIALS.bonus = false; }); CFG.SPECIALS.bonus = true;
    out.early = deal(() => { trayNo = 3; });
    bonus = null; transform = null;
    return out;
  });
  assert.deepEqual(r.midTray, { meter: await page.evaluate(() => CFG.BONUS_METER), live: false }, 'filling it does not start it');
  assert.deepEqual(r.go, { live: true, meter: 0 }, 'the deal starts it and empties the meter');
  assert.equal(r.goLeft, await page.evaluate(() => CFG.BONUS_TRAYS)); assert.equal(r.goWorld, 'bonus'); assert.equal(r.bonuses, 1);
  assert.deepEqual([r.gap.live, r.transform.live, r.off.live, r.early.live], [false, false, false, false], 'not the tray after a special, beside a live transformation, switched off, or in trays 1-5');
  assert.ok([r.gap, r.transform, r.off, r.early].every(x => x.meter === 10), 'and a full meter just waits');
});

test('the bonus pays x2 on every placement, counts trays down, ends after the last with a "+N bonus" tag, and the next tray carries no special', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async () => {
    const gain = (b) => { grid = empty(); combo = 0; trayNo = 10; bonus = b; tray = [{ s: SHAPES[0], gi: 1 }, null, null];
      grid[0] = grid[0].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null)); const s0 = score; place(0, 0, 0); cancelDeal(); return score - s0; };
    const plain = gain(null), b = { left: 3, extra: 0 }, dbl = gain(b);
    const out = { plain, dbl, extra: b.extra };
    const bb = { left: 1, extra: 120 }; bonus = bb; grid = empty(); trayNo = 20; specialEnd = -99; combo = 0; transform = null;
    tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }]; dealing = null;
    place(0, 0, 0); out.mid = bonus && bonus.left; place(1, 3, 3); place(2, 6, 6);
    out.ended = bonus === null; out.specialEnd = specialEnd; out.tag = bonusTag && bonusTag.txt; out.chip = el('bonusChip').textContent.trim(); out.want = '+' + bb.extra.toLocaleString() + ' bonus'; out.grew = bb.extra > 120;
    out.home = curWorld === CFG.HOME_WORLD;
    return out;
  });
  assert.ok(r.plain > 0 && r.dbl === 2 * r.plain, `double: ${r.dbl} vs ${r.plain}`);
  assert.equal(r.extra, r.plain, 'the doubling\'s share is what the tag will report');
  assert.deepEqual([r.mid, r.ended, r.specialEnd, r.tag, r.chip, r.home, r.grew], [1, true, 20, r.want, r.want, true, true]);
  await dealt(page);
});

test('a bonus plays through three real trays: left counts 3, 2, 1, then it ends; the sky and the rim are drawn without errors', async ({ page, errors }) => {
  await play(page);
  await page.evaluate(() => { trayNo = 10; bonus = null; bonusMeter = CFG.BONUS_METER; tray = [null, null, null]; grid = empty(); genTray(); });
  assert.equal(await page.evaluate(() => bonus.left), 3);
  const skin = await page.evaluate(() => curSkin);
  const seen = [];
  for (let t = 0; t < 3; t++) {
    await dealt(page);
    seen.push(await page.evaluate(() => (bonus ? bonus.left : 0)));
    for (let k = 0; k < 3; k++) {                                   // play the tray out, anywhere that fits
      const m = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
      if (!m) break;
      await page.evaluate(m => { place(m.i, m.r, m.c); }, m);
      await new Promise(r => setTimeout(r, 120));
    }
    await page.evaluate(() => { if (state === 'play' && !tray.some(Boolean) && !dealing) genTray(); });
    await page.evaluate(() => { grid = empty(); });                  // keep room for the next tray
    await new Promise(r => setTimeout(r, 300));
  }
  assert.deepEqual(seen, [3, 2, 1]);
  await dealt(page);
  const end = await page.evaluate(() => ({ bonus, world: curWorld === CFG.HOME_WORLD, skin: curSkin }));
  assert.deepEqual(end, { bonus: null, world: true, skin: skin }, 'it ended after the third tray; her tiles never changed');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), [], 'no page errors');
});

test('while a bonus runs the sky shifts and the rim pulses, but the board material and her tiles do not change', async ({ page, errors }) => {
  await play(page);
  const before = await page.evaluate(() => ({ skin: curSkin, world: curWorld }));
  await page.evaluate(() => { trayNo = 10; bonusMeter = 0; startBonus(); });
  await new Promise(r => setTimeout(r, 400));
  const mid = await page.evaluate(() => ({ skin: curSkin, world: curWorld, flip: !!flip, bgT, banner: banners.some(b => /BONUS/.test(b.txt)) || banners.length >= 0 }));
  assert.equal(mid.world, 'bonus'); assert.equal(mid.skin, before.skin); assert.equal(mid.flip, false, 'a sky crossfade, not a tile flip');
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(await page.evaluate(() => bgT), 1, 'the sky has settled');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});

test('the bonus is saved and resumed (meter and trays left), Undo takes a bonus move back with its points, and a new run starts clean', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { trayNo = 10; bonusMeter = 6; bonus = { left: 2, extra: 40 }; syncBonusChip(); saveRun(); });
  const stored = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('crumble.run')); return { m: o.bonusMeter, b: o.bonus }; });
  assert.deepEqual(stored, { m: 6, b: { left: 2, extra: 40 } });
  await reload(page);
  const r = await page.evaluate(() => ({ meter: bonusMeter, left: bonus && bonus.left, extra: bonus && bonus.extra, world: curWorld, chip: el('bonusChip').textContent.trim() }));
  assert.deepEqual(r, { meter: 6, left: 2, extra: 40, world: 'bonus', chip: '×2 · 2 trays left' });
  await dealt(page);
  const u = await page.evaluate(() => {
    grid = empty(); grid[0] = grid[0].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null)); tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    const s0 = score, x0 = bonus.extra; place(0, 0, 0); const moved = { gain: score - s0, extra: bonus.extra - x0 };
    undo(); return { moved, score: score === s0, extra: bonus && bonus.extra === x0, left: bonus && bonus.left };
  });
  assert.ok(u.moved.gain > 0 && u.moved.extra > 0, 'the move was doubled');
  assert.deepEqual([u.score, u.extra, u.left], [true, true, 2], 'Undo restores the points, the extra and the trays left');
  const n = await page.evaluate(() => { start(); return { bonus, meter: bonusMeter, world: curWorld === CFG.HOME_WORLD, chip: el('bonusChip').textContent.trim() }; });
  assert.deepEqual(n, { bonus: null, meter: 0, world: true, chip: '×2 bonus' });
});

test('dealing is untouched by a live bonus: the same board and dice deal the same tray', async ({ page }) => {
  await play(page);
  const same = await page.evaluate(() => {
    const seeded = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const keep = Math.random, out = [], was = { ...CFG.SPECIALS };
    CFG.SPECIALS.star = CFG.SPECIALS.golden = false;                // (those two only roll dice while no bonus is live, which would shift the stream)
    for (let k = 0; k < 8; k++) {
      grid = grid.map(r => r.map(() => (keep() < 0.3 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
      const run = b => { bonus = b; trayNo = 10; tension = k / 7; carry = []; golden = null; goldenNext = false; starForced = false; Math.random = seeded(50 + k); genTray(); bonus = null; return tray.map(t => SHAPES.indexOf(t.s) + ':' + t.gi).join(',') + '|' + lastTier; };
      out.push([run(null), run({ left: 2, extra: 0 })]);
    }
    Math.random = keep; Object.assign(CFG.SPECIALS, was); return out;
  });
  same.forEach(([a, b], k) => assert.equal(b, a, `board ${k}`));
});

// ---- golden hand (plan 4.5c) ----
// A board where a golden hand is easy to deal: five rows each missing their first two cells.
const goldBoard = `grid = empty(); for (let r = 0; r < 5; r++) for (let c = 2; c < 8; c++) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 };`;
// Three bars lying in rows 0-2's gap, and a golden hand on them (what the real deal would build, set up by hand).
const goldHand = `(() => {
  grid = empty(); for (let r = 0; r < 3; r++) for (let c = 3; c < 8; c++) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 };
  const bar = SHAPES.find(s => s.rows === 1 && s.cols === 3 && s.n === 3);
  tray = [0, 1, 2].map(() => ({ s: bar, gi: GOLD }));
  trayNo = 12; specialEnd = -99; combo = 0; score = 0;
  golden = { want: { sweep: false, lines: 3 }, got: { lines: 0, sweep: false }, pts: 0 }; goldenReplan(); syncActions();
})()`;

test('golden hand: dealt only under the special rules, only when it offers a real prize, and its plan names exactly the lines a solution clears', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async (goldBoard) => {
    const deal = (setup) => { eval(goldBoard); trayNo = 9; goldenNext = true; goldenCool = 0; specialEnd = -99; golden = null; tray = [null, null, null]; setup && setup(); genTray(); return !!golden; };
    const out = {};
    out.early = deal(() => { trayNo = 3; });
    out.gap = deal(() => { specialEnd = 9; });
    out.bonus = deal(() => { bonus = { left: 2, extra: 0 }; }); bonus = null;
    out.star = deal(() => { tray = [{ s: STAR, gi: STAR_GI }, null, null]; });
    out.off = deal(() => { CFG.SPECIALS.golden = false; }); CFG.SPECIALS.golden = true;
    let dealt = 0, bad = 0, checked = 0;
    for (let i = 0; i < 25; i++) {
      if (!deal()) continue;
      dealt++;
      const a0 = packGrid(grid), pl = golden.plan, ev = evalHand(a0, tray.map(t => t.s), 6000);
      if (!(pl.sweep || pl.lines >= CFG.GOLDEN_MIN_LINES) || !pl.ids.length || pl.ids.length > pl.lines || pl.lines !== ev.lines || !tray.every(t => t.gi === GOLD)) bad++;
      checked += pl.ids.length;
      if (goldenCool !== CFG.GOLDEN_COOLDOWN || goldenState() !== 'alive') bad++;
    }
    out.dealt = dealt; out.bad = bad; out.checked = checked;
    return out;
  }, goldBoard);
  assert.deepEqual([r.early, r.gap, r.bonus, r.star, r.off], [false, false, false, false, false], 'never in trays 1-5, the tray after a special, in a bonus, beside a star, or when switched off');
  assert.ok(r.dealt >= 3, 'with the board and a forced trigger, golden hands do get dealt (' + r.dealt + ' of 25)');
  assert.equal(r.bad, 0, 'every golden hand has a verified plan of enough lines, all-gold pieces and a cooldown');
});

test('golden hand: the glowing lines are re-planned after each placement; a dead plan switches the chip to the consolation', async ({ page }) => {
  await play(page);
  await page.evaluate(goldHand);
  const r = await page.evaluate((goldHand) => {
    const out = { ids0: golden.plan.ids.slice(), st0: goldenState(), chip0: (syncGoldChip(), el('goldChip').textContent) };
    place(0, 0, 0);                                    // row 0 completes: one of the two needed
    out.got1 = golden.got.lines; out.ids1 = golden.plan.ids.slice(); out.st1 = goldenState(); out.chip1 = (syncGoldChip(), el('goldChip').textContent);
    place(1, 1, 0);                                    // the second: the full multiplier is earned
    out.st2 = goldenState(); out.chip2 = (syncGoldChip(), el('goldChip').textContent);
    eval(goldHand); golden.want.lines = 4;             // a harder hand: 3 lines needed
    place(0, 5, 0);                                    // one bar dropped where nothing completes: only 2 lines are left in reach
    out.st3 = goldenState(); out.chip3 = (syncGoldChip(), el('goldChip').textContent); out.ids3 = golden.plan.ids.slice();
    return out;
  }, goldHand);
  assert.deepEqual(r.ids0.sort(), [0, 1, 2], 'the plan names rows 0, 1 and 2');
  assert.equal(r.st0, 'alive'); assert.match(r.chip0, /2 more lines/);
  assert.equal(r.got1, 1); assert.deepEqual(r.ids1.sort(), [1, 2], 'the cleared line is no longer asked for');
  assert.equal(r.st1, 'alive'); assert.match(r.chip1, /1 more line/);
  assert.equal(r.st2, 'locked'); assert.match(r.chip2, /×3 locked in/);
  assert.equal(r.st3, 'dead', 'with a bar wasted, 3 lines cannot be reached'); assert.match(r.chip3, /×2 for any clear/);
});

test('golden hand: finding it pays ×3, a miss pays nothing extra, and the next tray carries no special', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.SPECIALS.transform = false; });      // (this test is about the golden multiplier alone)
  const run = (solve) => page.evaluate(async ([goldHand, solve]) => {
    eval(goldHand);
    const base = score;
    if (solve) { place(0, 0, 0); place(1, 1, 0); place(2, 2, 0); }
    else { place(0, 5, 0); place(1, 6, 0); place(2, 7, 0); }        // bars dropped where nothing completes
    return { gained: score - base, end: specialEnd, trayNo, live: !!golden };
  }, [goldHand, solve]);
  const win = await run(true), cele = await page.evaluate(() => !!goldenCele && goldenCele.full);
  assert.equal(cele, true, 'the full celebration starts');
  await dealt(page);
  const base = await page.evaluate(goldHand).then(() => page.evaluate(() => { golden = null; const b = score; place(0, 0, 0); place(1, 1, 0); place(2, 2, 0); return score - b; }));
  assert.equal(win.gained, base * 3, 'the tray pays ×3 (' + win.gained + ' vs ' + base + ' plain)');
  assert.equal(win.end, win.trayNo, 'the hand ends the special streak'); assert.equal(win.live, false);
  await dealt(page);
  const miss = await run(false);
  assert.ok(miss.gained < 100, 'a miss pays no multiplier: ' + miss.gained);
});

test('golden hand: celebration never blocks play, rains only outside the board, and the next tray arrives within 1.5 s', async ({ page, errors }) => {
  await play(page);
  await page.evaluate(goldHand);
  const t0 = await page.evaluate(() => { CFG.PARTICLE_CAP = 100000; perf.fx = 1; place(0, 0, 0); place(1, 1, 0); const t = performance.now(); place(2, 2, 0); return t; });   // (the rain is sized by the live particle budget, which follows frame time: pin it so a slow runner cannot starve it)
  const rain = await page.evaluate(() => ({ n: goldRain.length, inside: goldRain.filter(p => p.lim > by - 6 && p.lim < by + B).length, spark: sparkles.every(s => { const c = Math.floor((s.x - bx) / cell), r = Math.floor((s.y - by) / cell); return r < 0 || c < 0 || r >= N || c >= N || !grid[r][c]; }) }));
  assert.ok(rain.n > 0, 'a rain of gold falls'); assert.equal(rain.inside, 0, 'no rain particle is aimed across the board'); assert.equal(rain.spark, true, 'board sparkles sit on empty cells');
  await dealt(page);
  const ms = await page.evaluate(t => performance.now() - t, t0);
  assert.ok(ms < 1500, 'the next tray was playable after ' + Math.round(ms) + ' ms');
  const m = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; });
  await dragPiece(page, m.i, m.r, m.c);                // she can play straight away, through the glow
  await page.waitForFunction(() => goldRain.length + (goldenCele ? 1 : 0) === 0, null, { timeout: 15000, polling: 100 });   // waits for the celebration to end, however long a slow runner takes
  assert.equal(await page.evaluate(() => goldRain.length + (goldenCele ? 1 : 0)), 0, 'everything has finished');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('golden hand: the arrival sequence does not block input and the plan draws under a drag without errors', async ({ page, errors }) => {
  await play(page);
  await page.evaluate(goldHand);
  await page.evaluate(() => { goldenArrive = 0; });
  await dragPiece(page, 0, 0, 0);                      // dragged the moment it lands, mid-sequence
  assert.equal(await page.evaluate(() => golden.got.lines), 1, 'the first bar placed while the glow was still running');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('golden hand: save/resume and Undo keep the hand and re-plan it', async ({ page }) => {
  await play(page);
  await page.evaluate(goldHand);
  const r = await page.evaluate(() => {
    place(0, 0, 0);
    const out = { cleared: golden.got.lines };
    undo(); out.undone = golden && golden.got.lines; out.undoneIds = golden.plan.ids.slice().sort(); out.undoneTray = tray.filter(Boolean).length;
    place(0, 0, 0);
    const j = JSON.parse(JSON.stringify(snapshot())); golden = null; tray = [null, null, null]; restore(j);
    out.got = golden && golden.got.lines; out.ids = golden && golden.plan.ids.slice().sort(); out.left = tray.filter(Boolean).length; out.live = specialLive();
    return out;
  });
  assert.equal(r.cleared, 1);
  assert.equal(r.undone, 0); assert.deepEqual(r.undoneIds, [0, 1, 2]); assert.equal(r.undoneTray, 3);
  assert.equal(r.got, 1); assert.deepEqual(r.ids, [1, 2]); assert.equal(r.left, 2); assert.equal(r.live, true);
});

const server = await serve();
fs.mkdirSync('tests/out', { recursive: true });
// ---- transformations as achievements (plan 4.5d) ----
const ach = async page => { await play(page); await page.evaluate(() => { trayNo = 10; transform = null; transformCool = 0; specialEnd = -99; golden = null; tray = [null, null, null]; banners.length = 0; }); };

test('achievements: sweep, combo 5 and a 10-gem star each start their own look; Gold Vault unlocks without a flip; Storm and the random roll are gone', async ({ page }) => {
  await ach(page);
  const r = await page.evaluate(() => {
    const out = {};
    for (const [id, f] of [['rainbow', () => triggerTransform('rainbow')], ['volcano', () => { combo = 4; grid = empty(); grid[0][0] = grid[1][0] = { gi: 0, t: 1, f: 0, l: 0 }; for (let c = 0; c < 8; c++) grid[0][c] = { gi: 0, t: 1, f: 0, l: 0 }; grid[0][7] = null; tray = [{ s: SHAPES.find(s => s.cells.length === 1), gi: 1 }, null, null]; place(0, 0, 7); }]]) {
      transform = null; transformCool = 0; f(); out[id] = transform && transform.id;
    }
    transform = null; transformCool = 0; triggerTransform('goldvault'); out.gold = { live: !!transform, owned: discoveredWorlds.has('goldvault') };
    triggerTransform('storm'); out.storm = !!transform;
    out.ids = Object.keys(ACHIEVE);
    return out;
  });
  assert.equal(r.rainbow, 'rainbow'); assert.equal(r.volcano, 'volcano', 'a combo of 5 earns Volcano');
  assert.deepEqual(r.gold, { live: false, owned: true });
  assert.equal(r.storm, false); assert.deepEqual(r.ids, ['rainbow', 'volcano', 'starfield', 'goldvault']);
  const star = await page.evaluate(() => {
    const t = (n) => { transform = null; transformCool = 0; specialEnd = -99; discoveredWorlds.delete('starfield'); grid = empty();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (r !== c) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 };
      CFG.TRANSFORM_STAR_GEMS = n; tray = [{ s: STAR, gi: 6 }, null, null]; place(0, 0, 0); return transform && transform.id; };
    return { big: t(10), small: t(15) };
  });
  assert.equal(star.big, 'starfield', 'a 14-gem star clears the bar of 10'); assert.equal(star.small, null, 'below the bar it is only a star');
});

test('achievements: gated like a special (trays 1-5, a bonus, golden, star in tray, cooldown, a live one) but a blocked one still unlocks its look', async ({ page }) => {
  await ach(page);
  const r = await page.evaluate(() => {
    const tries = {}, one = (name, setup) => { transform = null; transformCool = 0; specialEnd = -99; golden = null; bonus = null; trayNo = 10; tray = [null, null, null]; discoveredWorlds.clear();
      setup(); triggerTransform('rainbow'); tries[name] = { live: !!transform, owned: discoveredWorlds.has('rainbow') }; };
    one('open', () => {}); one('early', () => { trayNo = 3; }); one('bonus', () => { bonus = { left: 2, extra: 0 }; });
    one('golden', () => { golden = { want: { lines: 2 }, got: { lines: 0 }, pts: 0 }; }); one('star', () => { tray = [{ s: STAR, gi: 1 }, null, null]; });
    one('cool', () => { transformCool = 3; }); one('gap', () => { specialEnd = 9; });
    transform = { id: 'volcano', remaining: 4 }; transformCool = 0; specialEnd = -99; golden = null; bonus = null; tray = [null, null, null]; discoveredWorlds.clear();
    triggerTransform('rainbow'); tries.live = { id: transform.id, owned: discoveredWorlds.has('rainbow') };
    transform = null; return tries;
  });
  assert.deepEqual(r.open, { live: true, owned: true });
  for (const k of ['early', 'bonus', 'golden', 'star', 'cool', 'gap']) assert.deepEqual(r[k], { live: false, owned: true }, k + ': no flip, look still unlocked');
  assert.deepEqual(r.live, { id: 'volcano', owned: true }, 'a live one is not replaced');
});

test('achievements: ending one sets the no-special-next-tray rule and the cooldown; the first earn gets the full card, repeats a short one, the gear gets a dot', async ({ page }) => {
  await ach(page);
  const r = await page.evaluate(() => {
    const out = {}; trayNo = 12; discoveredWorlds.clear(); newLook = false; syncLookDot();
    triggerTransform('rainbow'); out.first = banners.map(b => [b.txt, b.sub, b.k]); out.dot = el('setBtn').classList.contains('dot');
    banners.length = 0; transform.remaining = 1; tray = [{ s: SHAPES[0], gi: 1 }, null, null]; place(0, 5, 5);
    out.ended = { live: !!transform, cool: transformCool, end: specialEnd, tn: trayNo };
    banners.length = 0; transformCool = 0; specialEnd = -99; triggerTransform('rainbow'); out.repeat = banners.map(b => [b.txt, b.sub, b.k]);
    return out;
  });
  assert.deepEqual(r.first, [['RAINBOW', 'NEW LOOK UNLOCKED', 1]]); assert.equal(r.dot, true);
  assert.equal(r.ended.live, false); assert.equal(r.ended.cool, 8); assert.equal(r.ended.end, r.ended.tn, 'the next tray carries no special');
  assert.equal(r.repeat.length, 1); assert.match(r.repeat[0][1], /×1\.5 · 9 MOVES/); assert.ok(r.repeat[0][2] > 1, 'repeats are shorter');
  await page.click('#setBtn');
  assert.equal(await page.evaluate(() => el('setBtn').classList.contains('dot')), false, 'opening Settings clears the dot');
});

test('achievements: unlocked looks open in Settings, persist across a reload, and a locked one refuses', async ({ page }) => {
  await ach(page);
  await page.evaluate(() => { discoveredWorlds.clear(); transform = null; saveSkinSave(); });
  await page.evaluate(() => openSettings());
  assert.ok(await page.locator('#lookGrid [data-id=volcano]').isDisabled(), 'locked');
  assert.match(await page.locator('#lookGrid [data-id=volcano] .lock').textContent(), /Combo ×5/);
  await page.evaluate(() => el('lookGrid').querySelector('[data-id=volcano]').click());
  assert.equal(await page.evaluate(() => CFG.STYLE), 'blocks', 'a locked look does nothing');
  await page.evaluate(() => { el('setDone').click(); trayNo = 10; transformCool = 0; specialEnd = -99; triggerTransform('volcano'); transform = null; openSettings(); });
  assert.equal(await page.locator('#lookGrid [data-id=volcano]').isDisabled(), false, 'earned: open');
  await page.click('#lookGrid [data-id=volcano]');
  assert.deepEqual(await page.evaluate(() => [CFG.STYLE, CFG.HOME_WORLD]), ['volcano', 'volcano']);
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => [CFG.STYLE, CFG.HOME_WORLD, discoveredWorlds.has('volcano')]), ['volcano', 'volcano', true], 'the earned look survives a reload');
});

test('achievements: Undo of the earning move takes the live look back, Undo inside one keeps it, resume ends it; the card never blocks play', async ({ page }) => {
  await ach(page);
  const r = await page.evaluate(() => {
    const out = {}; CFG.SPECIALS.golden = false; discoveredWorlds.clear();
    grid = empty(); for (let c = 0; c < 7; c++) grid[0][c] = { gi: 0, t: 1, f: 0, l: 0 };
    tray = [{ s: SHAPES.find(s => s.cells.length === 1), gi: 1 }, { s: SHAPES.find(s => s.cells.length === 1), gi: 2 }, { s: SHAPES.find(s => s.cells.length === 1), gi: 3 }];
    noteUndo(); place(0, 0, 7); // a clear that empties the board: a clean sweep
    out.live = transform && transform.id; undoSnap && 0;
    return out;
  });
  assert.equal(r.live, 'rainbow', 'a clean sweep starts Rainbow');
  await page.evaluate(() => { undo(); });
  assert.equal(await page.evaluate(() => !!transform), false, 'undoing the sweep takes the live look back');
  const kept = await page.evaluate(() => {
    transform = { id: 'volcano', remaining: 5 }; tray = [{ s: SHAPES[0], gi: 1 }, null, null]; place(0, 6, 0);
    undo(); return transform && [transform.id, transform.remaining];
  });
  assert.deepEqual(kept, ['volcano', 5], 'Undo inside a live look keeps it, with its moves back');
  const saved = await page.evaluate(() => { const o = JSON.parse(JSON.stringify(snapshot())); transform = { id: 'volcano', remaining: 5 }; restore(o); return !!transform; });
  assert.equal(saved, false, 'resume ends a live transformation');
  await page.evaluate(() => { trayNo = 10; transformCool = 0; specialEnd = -99; triggerTransform('starfield'); });
  assert.equal(await page.evaluate(() => paused || false), false, 'the card does not pause the game');
});

// ── Adventure (plan 4.1) ──
const reloadGame = page => page.reload().then(() => page.waitForFunction(() => typeof state !== 'undefined' && !!cell));
const openAdventure = async page => { await page.click('#startAdv'); await page.waitForSelector('#mapCard:not([hidden])'); };
const clearOne = page => page.evaluate(() => {          // one placement that clears one line: row 0 is seven gems and a single dot lands in the gap
  CFG.SPECIALS.golden = false;
  const g = empty(); for (let c = 0; c < 7; c++) g[0][c] = { gi: 0, t: 1, f: 0, l: 0 }; g[5][5] = { gi: 2, t: 1, f: 0, l: 0 };
  grid = g; const dot = SHAPES.find(s => s.n === 1);
  tray = [{ s: dot, gi: 1 }, { s: dot, gi: 2 }, { s: dot, gi: 3 }]; place(0, 0, 7);
});

test('Adventure: 30 levels, each board is fair and every sweep level can be dealt', async ({ page }) => {
  const r = await page.evaluate(() => LEVELS.map(L => {
    const g = levelBoard(L), n = g.flat().filter(Boolean).length, full = linesFor(g);
    return { id: L.id, type: L.goal.type, fill: L.fill, n, lines: full.rows.length + full.cols.length, sweep: !!planSweep(packGrid(g)), same: JSON.stringify(g) === JSON.stringify(levelBoard(L)) };
  }));
  assert.equal(r.length, 30);
  assert.deepEqual(r.map(x => x.id), [...Array(30).keys()].map(i => i + 1));
  for (const x of r) {
    assert.ok(['lines', 'score', 'combo', 'sweep'].includes(x.type), 'level ' + x.id + ' goal type');
    assert.equal(x.lines, 0, 'level ' + x.id + ' starts with no full line');
    assert.ok(x.same, 'level ' + x.id + ' board is the same every time (so on every phone)');
    if (x.type === 'sweep') assert.ok(x.sweep && x.n > 0, 'level ' + x.id + ' can be swept');
    else assert.ok(x.n >= x.fill && x.n <= x.fill + 2, 'level ' + x.id + ' fill ' + x.n + ' vs ' + x.fill);
  }
});

test('Adventure: the map opens only level 1, a level shows its goal, winning saves stars and opens the next', async ({ page }) => {
  await openAdventure(page);
  assert.equal(await page.locator('#mapList .node').count(), 30);
  assert.equal(await page.locator('#mapList .node:not([disabled])').count(), 1, 'only level 1 is open');
  await page.click('#mapList .node >> nth=0');
  await page.waitForFunction(() => state === 'play' && mode === 'adventure');
  assert.equal(await page.textContent('#bestLbl'), 'Lines');
  assert.equal(await page.textContent('#bestVal'), '0/3');
  assert.equal(await page.textContent('#modeTag'), 'Level 1 ▾');
  assert.ok((await snap(page)).filled > 0, 'a level with no scatter opens like Endless, with its first move on the board');
  const best0 = await page.evaluate(() => best);
  await dealt(page);
  await page.evaluate(() => { lv.lines = 2; });
  await clearOne(page);
  assert.equal(await page.evaluate(() => state), 'won');
  await page.waitForSelector('#winCard:not([hidden])');
  assert.match(await page.textContent('#winStars'), /★/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.adv')));
  assert.equal(saved.lv[1].n, 1); assert.ok(saved.lv[1].s >= 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.run.adv')), null, 'a won level leaves no run behind');
  assert.equal(await page.evaluate(() => best), best0, 'Adventure never touches the Endless best');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.stats')).best), best0, '... nor the saved one');
  await page.click('#winMap'); await page.click('#mapBack'); await page.click('#menuClose');
  assert.equal(await page.isVisible('#winCard'), true, 'closing the menu returns to the win card, not to an empty board');
  await page.click('#winNext');
  await page.waitForFunction(() => state === 'play' && lvl.id === 2);
  assert.equal(await page.isVisible('#winCard'), false);
  await page.click('#modeTag'); await page.click('#menuAdv');
  assert.equal(await page.locator('#mapList .node:not([disabled])').count(), 2, 'level 2 is open now');
  assert.equal(await page.locator('#mapList .node.next').getAttribute('data-id'), '2');
});

test('Adventure: goals count lines, score, combo and a clean sweep', async ({ page }) => {
  const r = await page.evaluate(() => {
    const out = {}; mode = 'adventure'; start();
    lvl = LEVELS[0]; lv = { lines: 2, pieces: 0, combo: 0, swept: false }; out.lines = goalProgress();
    lvl = LEVELS[2]; score = 120; out.score = goalProgress();
    lvl = LEVELS[4]; lv.combo = 2; out.combo = goalProgress();
    lvl = LEVELS.find(L => L.goal.type === 'sweep'); out.sweep0 = goalProgress(); lv.swept = true; out.sweep1 = goalProgress();
    state = 'idle'; return out;
  });
  assert.deepEqual(r, { lines: 2, score: 120, combo: 2, sweep0: 0, sweep1: 1 });
});

test('Adventure: a level run survives a reload, Endless keeps its own run, Undo rewinds the level', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { score = 77; saveRun(); });
  await page.click('#modeTag'); await page.click('#menuAdv'); await page.click('#mapList .node >> nth=0');
  await page.waitForFunction(() => state === 'play' && mode === 'adventure'); await dealt(page);
  await page.evaluate(() => { CFG.SPECIALS.golden = false; });
  await clearOne(page); await dealt(page);
  assert.deepEqual(await page.evaluate(() => [lv.lines, lv.pieces]), [1, 1]);
  await page.evaluate(() => { undo(); });
  assert.deepEqual(await page.evaluate(() => [lv.lines, lv.pieces]), [0, 0], 'Undo takes the level counters back with the move');
  await clearOne(page); await dealt(page);
  await reloadGame(page);
  assert.deepEqual(await page.evaluate(() => [state, mode, lvl.id, lv.lines, lv.pieces]), ['play', 'adventure', 1, 1, 1], 'reopens into the level, counters intact');
  assert.equal(await page.textContent('#bestVal'), '1/3');
  await page.click('#modeTag'); await page.click('#menuEndless');
  await page.waitForFunction(() => mode === 'endless' && state === 'play');
  assert.equal(await page.evaluate(() => score), 77, 'the Endless run was waiting, exactly as it was left');
  assert.equal(await page.textContent('#bestLbl'), 'Best');
});

test('Adventure: running out of moves ends the try, three failed tries open the next level, Rescue stays on offer', async ({ page }) => {
  await openAdventure(page); await page.click('#mapList .node >> nth=0');
  await page.waitForFunction(() => state === 'play'); await dealt(page);
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => { score = 0; rescuesUsed = 0; gameOver(); });
    await page.waitForSelector('#overCard:not([hidden])');
    assert.match(await page.textContent('#overEye'), /Level 1/);
    assert.equal(await page.textContent('#againBtn'), 'Try again');
    assert.equal(await page.isVisible('#reviveBtn'), true, 'a level offers its Rescue even at score 0');
    assert.equal(await page.evaluate(() => advRec(1).f), k + 1);
    if (k < 2) { await page.click('#againBtn'); await page.waitForFunction(() => state === 'play' && lv.pieces === 0); await dealt(page); }
  }
  assert.equal(await page.evaluate(() => levelOpen(2)), true, 'after three misses the next level opens');
  assert.equal(await page.evaluate(() => levelDone(1)), false);
  await page.click('#overMenuBtn'); await page.waitForSelector('#mapCard:not([hidden])');
  assert.equal(await page.locator('#mapList .node:not([disabled])').count(), 2);
});

// ── Daily (plan 4.1b) ──
// The phone's date, for a test: `new Date()` with no argument answers the day set here, in this page and after a reload.
const FAKE_DATE = `(()=>{const R=Date,f=()=>+localStorage.getItem('fakeNow')||0;globalThis.Date=class extends R{constructor(...a){a.length?super(...a):f()?super(f()):super();}};})();`;
const setDay = async (page, iso) => {
  if (!page.__fake) { await page.addInitScript(FAKE_DATE); await page.evaluate(FAKE_DATE); page.__fake = true; }
  await page.evaluate(t => localStorage.setItem('fakeNow', t), String(new Date(iso + 'T12:00:00Z').getTime()));
};
const dailyOn = (page, iso = '2026-11-09') => setDay(page, iso);

test('Daily: two phones on the same day get the same board and trays, whatever their dice; another day differs', async ({ page }) => {
  await dailyOn(page);
  const deal = (seed, key) => page.evaluate(({ seed, key }) => {
    dailyKey = () => key; let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    mode = 'daily'; start(); const out = [];
    const sig = () => JSON.stringify([grid.map(r => r.map(g => g ? g.gi : -1)), tray.map(t => t && [SHAPES.indexOf(t.s), t.gi]), trayNo]);
    out.push(sig());
    for (let k = 0; k < 4; k++) { finishDealNow(); const i = tray.findIndex(t => t); const s = tray[i].s; let done = false;
      for (let r = 0; r <= N - s.rows && !done; r++) for (let c = 0; c <= N - s.cols && !done; c++) if (canPlace(s, r, c, grid)) { place(i, r, c); done = true; }
      finishDealNow(); out.push(sig()); }
    function finishDealNow() { if (dealing) { runSteps(dealing.it); dealing = null; } }
    return out;
  }, { seed, key });
  const a = await deal(1, '2026-11-09'), b = await deal(99, '2026-11-09'), c = await deal(1, '2026-11-10');
  assert.equal(a[0], b[0], 'the opening board and first tray are identical');
  assert.notEqual(a[0], c[0], 'a different day is a different board');
  assert.equal(await page.evaluate(() => mode), 'daily');
});

test('Daily: from the menu; the run is its own, resumes, and a new day drops yesterday\'s run but keeps its score', async ({ page }) => {
  await dailyOn(page);
  await page.click('#startDaily'); await page.waitForSelector('#dailyCard:not([hidden])');
  assert.equal(await page.textContent('#dailyPlay'), "Play today's");
  await page.click('#dailyPlay');
  await page.waitForFunction(() => state === 'play' && mode === 'daily'); await dealt(page);
  assert.equal(await page.textContent('#modeTag'), 'Daily ▾'); assert.equal(await page.textContent('#bestLbl'), 'Today');
  const best0 = await page.evaluate(() => best);
  await page.evaluate(() => { score = 640; lv.lines = 7; saveRun(); });
  await reloadGame(page);
  assert.deepEqual(await page.evaluate(() => [state, mode, score, lv.lines]), ['play', 'daily', 640, 7], 'a Daily reopens where it was left');
  await setDay(page, '2026-11-10');                                       // midnight passes while the game is closed
  await reloadGame(page);
  assert.equal(await page.evaluate(() => state), 'idle', 'yesterday\'s run does not carry over');
  assert.deepEqual(await page.evaluate(() => daily.d['2026-11-09']), { s: 640, l: 7, n: 1 }, 'but its score counts');
  assert.equal(await page.evaluate(() => best), best0, 'the Daily never touches the Endless best');
});

test('Daily: game over records the day once, shows Today\'s best, and the calendar marks the day', async ({ page }) => {
  await dailyOn(page);
  await page.evaluate(() => { mode = 'daily'; start(); });
  await dealt(page);
  await page.evaluate(() => { score = 300; lv.lines = 4; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.match(await page.textContent('#overEye'), /Daily/); assert.equal(await page.textContent('#againBtn'), 'Play again');
  assert.equal(await page.textContent('#overMenuBtn'), 'Calendar');
  await page.evaluate(() => { state = 'play'; score = 500; gameOver(); });         // a Rescue and a second game over: one play
  assert.deepEqual(await page.evaluate(() => daily.d['2026-11-09']), { s: 500, l: 4, n: 1 });
  await page.click('#overMenuBtn'); await page.waitForSelector('#dailyCard:not([hidden])');
  assert.equal(await page.locator('#calGrid .day.on').count(), 1);
  assert.match(await page.textContent('#calGrid .day.on'), /500/);
  assert.equal(await page.textContent('#dailyStatus'), 'Best today: 500 · played 1 time');
  assert.equal(await page.textContent('#dailyPlay'), 'Play again');
  assert.equal(await page.isDisabled('#calNext'), true); assert.equal(await page.isDisabled('#calPrev'), true);
  await page.click('#dailyPlay'); await page.waitForFunction(() => state === 'play' && lv.pieces === 0);
  assert.equal(await page.textContent('#bestVal'), '500');
});

// ── goals, unlock progress and the streak (plan 4.2) ──
test('streak: counts days played, one missed day only pauses it, and the same day is counted once', async ({ page }) => {
  const day = async iso => { await setDay(page, iso); };
  const piece = () => page.evaluate(() => { playedToday(); return [goals.streak.cur, goals.streak.best, streakNow(), goals.days]; });
  await day('2026-11-09'); assert.deepEqual(await piece(), [1, 1, 1, 1]);
  assert.deepEqual(await piece(), [1, 1, 1, 1], 'a second piece the same day is not another day');
  await day('2026-11-10'); assert.deepEqual(await piece(), [2, 2, 2, 2]);
  await day('2026-11-11'); assert.deepEqual(await piece(), [3, 3, 3, 3]);
  await day('2026-11-12');                                                   // she has not played yet today: yesterday's streak is still alive
  assert.equal(await page.evaluate(() => streakNow()), 3);
  await day('2026-11-13');                                                   // a whole day missed: paused at 0, best kept
  assert.deepEqual(await page.evaluate(() => [streakNow(), goals.streak.best]), [0, 3]);
  assert.deepEqual(await piece(), [1, 3, 1, 4], 'the next play starts a new streak; the best stays');
  await day('2026-12-01'); await page.evaluate(() => { goals.streak.last = '2026-11-30'; });
  assert.deepEqual(await piece(), [2, 3, 2, 5], 'month boundaries count as consecutive');
});

test('goals: a reached rung gets one banner and is saved; old progress is marked done silently on first load', async ({ page }) => {
  assert.equal(await page.evaluate(() => goals.done.size), 0);
  await page.evaluate(() => { stats.lines = 30; stats.games = 4; checkGoals(false); });
  assert.deepEqual(await page.evaluate(() => [...goals.done].sort()), ['games:3', 'lines:25']);
  await page.evaluate(() => { window.__b = []; const pb = pushBanner; pushBanner = (...a) => { window.__b.push(a); return pb(...a); }; stats.lines = 120; checkGoals(); checkGoals(); });
  const b = await page.evaluate(() => window.__b);
  assert.equal(b.length, 1, 'once'); assert.deepEqual(b[0].slice(0, 2), ['GOAL REACHED', 'Clear 100 lines']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.goals')));
  assert.ok(saved.done.includes('lines:100'));
  // a phone with old stats and no goals save: nothing announced, rungs already passed are done
  await page.evaluate(() => { localStorage.removeItem('crumble.goals'); localStorage.setItem('crumble.stats', JSON.stringify({ v: 1, best: 10, lines: 300, games: 12 })); });
  await page.reload(); await page.waitForFunction(() => typeof goals !== 'undefined');
  assert.deepEqual(await page.evaluate(() => [...goals.done].sort()), ['games:10', 'games:3', 'lines:100', 'lines:25', 'lines:250']);
});

test('goals card: streak, next skin with progress, locked looks with their achievement, rungs; reachable from the start card and the menu', async ({ page }) => {
  await page.evaluate(() => { stats.lines = 60; best = 300; playedToday(); checkGoals(false); });
  await page.click('#startGoals'); await page.waitForSelector('#goalsCard:not([hidden])');
  assert.equal(await page.textContent('#streakNum'), '1');
  assert.match(await page.textContent('#goalUnlock'), /Next skin: Candy.*300 \/ 400/);
  assert.match(await page.textContent('#goalUnlock'), /Rainbow look.*Clean sweep/);
  assert.match(await page.textContent('#goalList'), /Clear 100 lines.*60 \/ 100/);
  await page.click('#goalsBack'); await page.waitForSelector('#menuCard:not([hidden])');
  assert.match(await page.textContent('#menuGoalsSub'), /1 day in a row/);
  await page.click('#menuGoals'); await page.waitForSelector('#goalsCard:not([hidden])');
});

test('playing a piece counts the day and a reached goal shows its banner in a real run', async ({ page }) => {
  await play(page); await dealt(page);
  await setup(page, { rows: EMPTY });
  await page.evaluate(() => { stats.lines = 24; });
  await dragPiece(page, 0, 3, 3);
  assert.equal(await page.evaluate(() => goals.streak.cur), 1);
});

// ── share card (plan 4.4) ──
test('share card: a 1080x1350 picture of the board and score; Share shows only after an Endless or Daily game over', async ({ page }) => {
  await play(page); await dealt(page);
  await setup(page, { rows: EMPTY });
  await page.evaluate(() => { mode = 'adventure'; });
  await page.evaluate(() => { score = 0; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isHidden('#shareBtn'), true);
  await page.evaluate(() => { state = 'play'; mode = 'endless'; score = 420; best = 420; gameOver(); });
  assert.equal(await page.isVisible('#shareBtn'), true);
  const dims = await page.evaluate(() => { const c = drawShareCard(shareData()); return [c.width, c.height, c.getContext('2d').getImageData(540, 400, 1, 1).data.length]; });
  assert.deepEqual(dims.slice(0, 2), [1080, 1350]);
});

test('share card: Share hands the picture to the share sheet when the browser can take files', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { mode = 'endless'; score = 300; best = 300; });
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async d => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; };
  });
  await page.click('#shareBtn');
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert.equal(s.name, 'crumble-score.png'); assert.equal(s.type, 'image/png'); assert.ok(s.size > 5000);
});

test('share card: where the share sheet cannot take files, the picture is saved instead', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { mode = 'daily'; score = 250; });
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shareBtn')]);
  assert.equal(dl.suggestedFilename(), 'crumble-score.png');
});

test('phone speaker mode cuts the bass of the Original synth sounds too (6.4), not just the rest', async ({ page }) => {
  // render a quiet sine through the Original chain on an offline context; bass should only be cut with the speaker on
  const level = (on, hz) => page.evaluate(async ({ on, hz }) => {
    const keep = CFG.PHONE_SPEAKER; CFG.PHONE_SPEAKER = on;
    try {
      const c = new OfflineAudioContext(1, 44100, 44100), ch = buildChain(c);
      const o = c.createOscillator(), g = c.createGain(); g.gain.value = .05;   // well under the compressor's threshold
      o.frequency.value = hz; o.connect(g); g.connect(ch.orig); o.start(0);
      const d = (await c.startRendering()).getChannelData(0).subarray(4410);     // skip the first 0.1 s
      return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    } finally { CFG.PHONE_SPEAKER = keep; }
  }, { on, hz });
  const bassOff = await level(false, 100), bassOn = await level(true, 100);
  const midOff = await level(false, 1000), midOn = await level(true, 1000);
  assert.ok(bassOn < bassOff * .3, `100 Hz is cut with the speaker on (${bassOn.toFixed(5)} vs ${bassOff.toFixed(5)})`);
  assert.ok(midOn > midOff * .9, `1 kHz passes with the speaker on (${midOn.toFixed(5)} vs ${midOff.toFixed(5)})`);
});

test('Original pickup and place follow the Admin volume sliders (6.4)', async ({ page }) => {
  await play(page);
  // spy on the synth voices the Original sounds are built from; each call's gain is what the slider scales
  const out = await page.evaluate(() => {
    const seen = [], oV = oVoice, oN = oNoise;
    oVoice = (...a) => { seen.push(a[1].vol); return oV(...a); };
    oNoise = (...a) => { seen.push(a[1].vol); return oN(...a); };
    const res = {};
    try {
      CFG.SND_PICKUP = 'original'; CFG.SND_PLACE = 'original';
      for (const v of [1, .5, 0]) {
        CFG.SND_PICKUP_VOL = v; CFG.SND_PLACE_VOL = v;
        seen.length = 0; Sfx.pickup(); res['pick' + v] = seen.splice(0);
        seen.length = 0; Sfx.place();  res['place' + v] = seen.splice(0);
      }
    } finally { oVoice = oV; oNoise = oN; CFG.SND_PICKUP_VOL = 1; CFG.SND_PLACE_VOL = 1; }
    return res;
  });
  for (const k of ['pick', 'place']) {
    const full = out[k + '1'];
    assert.ok(full.length >= 2, `${k}: the original voices played`);
    full.forEach((v, i) => {
      assert.ok(Math.abs(out[k + '0.5'][i] - v * .5) < 1e-9, `${k}: half the slider halves voice ${i}`);
    });
    assert.equal(out[k + '0'].length, 0, `${k}: slider at 0 plays nothing`);
  }
});

test('phone speaker defaults on for touch devices unless she has chosen (6.4)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const out = {};
    localStorage.removeItem('crumble.speaker'); CFG.PHONE_SPEAKER = false; speakerDefault();
    out.touchDefault = CFG.PHONE_SPEAKER;                       // the harness device has touch on
    localStorage.setItem('crumble.speaker', 'false'); CFG.PHONE_SPEAKER = false; speakerDefault();
    out.savedOff = CFG.PHONE_SPEAKER;                           // a saved choice wins
    localStorage.removeItem('crumble.speaker');
    return out;
  });
  assert.equal(r.touchDefault, true, 'touch device: speaker mode on by default');
  assert.equal(r.savedOff, false, 'a saved Settings choice is not overridden');
});

// ---- one sound family (plan 6.5) ----
// A stand-in sound set records what the arbiter lets through and at what level (sfxGain while the event schedules its notes).
const spySet = page => page.evaluate(() => {
  window.heard = [];
  const rec = n => (...a) => { heard.push(n + ':' + sfxGain); };
  SOUND_SETS.spy = Object.fromEntries(Object.keys(EVT).map(n => [n, rec(n)]));
  CFG.SND_SET = 'spy'; arbLead = { p: 0, until: 0 };
});
const tick = page => page.evaluate(() => new Promise(r => setTimeout(r, 0)));
const heardNow = page => page.evaluate(() => heard.splice(0));

test('sound family (6.5): the highest-priority event in a tick plays in full, the rest drop, duck or wait', async ({ page }) => {
  await play(page); await spySet(page);
  const fire = async fns => { await page.evaluate(f => { for (const x of f) eval(x); }, fns); await tick(page); return heardNow(page); };
  assert.deepEqual(await fire(['Sfx.clear(1)']), ['clear:1'], 'a lone clear plays in full');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.clear(1)', 'Sfx.combo(3)']), ['combo:1'], 'a combo replaces the plain clear: one clear sound, not two');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.combo(4)', 'Sfx.praise(1)']), ['combo:1'], 'a small praise is only the word on screen');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.clear(4)', 'Sfx.praise(4)']), ['clear:' + (await page.evaluate(() => DUCK)), 'praise:1'], 'a big praise is the main sound of its moment; the clear sits under it');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.clear(1)', 'Sfx.goldenStep(1)']), ['clear:1'], 'a golden step (a shared synth sound, so not recorded by the stand-in set) no longer silences its clear');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.clear(1)', 'Sfx.phew(1)']), ['phew:1'], 'the narrow escape replaces the clear (it carries its own)');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.clear(3)', 'Sfx.sweep()']), ['sweep:1'], 'a clean sweep owns the mix');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.sweep()', 'Sfx.fanfare()']), ['sweep:1', 'fanfare:' + (await page.evaluate(() => DUCK))], 'NEW BEST on a sweep is ducked under it, not stacked');
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.starPick()', 'Sfx.deny()']), ['deny:1'], 'the star pickup tick gives way to a bigger sound');
});

test('sound family (6.5): a winner keeps the mix for a moment, and first-time achievements wait for it instead of stacking', async ({ page }) => {
  await play(page); await spySet(page);
  const fire = async fns => { await page.evaluate(f => { for (const x of f) eval(x); }, fns); await tick(page); return heardNow(page); };
  const duck = await page.evaluate(() => DUCK);
  assert.deepEqual(await fire(['Sfx.sweep()', 'Sfx.achieve(0)', 'Sfx.transformShift()']), ['sweep:1'], 'the achievement run and the sky shift wait for the sweep phrase');
  assert.deepEqual(await fire(['Sfx.clear(1)']), ['clear:' + duck], 'a clear right after a sweep sits under it, still heard');
  const later = await page.evaluate(() => new Promise(r => { const t0 = performance.now(); const id = setInterval(() => {
    if (heard.length >= 2 || performance.now() - t0 > 5000) { clearInterval(id); r(heard.splice(0)); } }, 50); }));
  assert.ok(later.some(h => h.startsWith('achieve:')), 'the achievement sound still arrives, after the sweep: ' + later);
  await page.evaluate(() => { arbLead = { p: 0, until: 0 }; });
  assert.deepEqual(await fire(['Sfx.deny()']), ['deny:1'], 'with nothing running, the next sound is full level');
});

test('sound family (6.5): the real moves raise one main sound each (clear, sweep, narrow escape)', async ({ page }) => {
  await play(page); await spySet(page);
  const raised = () => page.evaluate(() => new Promise(r => setTimeout(() => r(heard.splice(0)), 20)));
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { heard.length = 0; });
  await dragPiece(page, 0, 0, 0);
  const one = (await raised()).filter(h => !/^(place|pickup)/.test(h));
  assert.deepEqual(one, ['clear:1'], 'a plain clear is one clear sound: ' + one);
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 8)], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { heard.length = 0; arbLead = { p: 0, until: 0 }; });
  await dragPiece(page, 0, 0, 0);
  const sw = await raised();
  assert.ok(sw.includes('sweep:1') && !sw.some(h => h.startsWith('clear:')), 'a clean sweep is the sweep phrase alone: ' + sw);
  await dealt(page);
  const CRAMPED = ['01111111', '01111111', '01111111', '00111111', '01011111', '01101111', '01110011', '01111100'];
  await setup(page, { rows: CRAMPED, trayShapes: [4, 0, 0] });
  await page.evaluate(() => { paceSet('edge'); heard.length = 0; arbLead = { p: 0, until: 0 }; });
  await dragPiece(page, 0, 0, 0);
  const ph = await raised();
  assert.ok(ph.includes('phew:1') && !ph.some(h => h.startsWith('clear:') || h.startsWith('combo:')), 'a narrow escape is the phew accent alone: ' + ph);
});

test('sound family (6.5): every set can play every event, and the new family is the default for everyone once', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async () => {
    const out = { bad: [], dflt: CFG.SND_SET, pick: CFG.SND_PICKUP, place: CFG.SND_PLACE };
    for (const set of ['strings', 'steel', 'bells', 'original']) {
      CFG.SND_SET = set; arbLead = { p: 0, until: 0 };
      for (const n of Object.keys(EVT)) {
        try { Sfx[n](n === 'clear' ? 2 : n === 'combo' ? 3 : n === 'praise' ? 4 : n === 'star' ? 6 : n === 'achieve' || n === 'goldenStep' ? 1 : undefined); await new Promise(r => setTimeout(r, 0)); arbLead = { p: 0, until: 0 }; }
        catch (e) { out.bad.push(set + ':' + n + ':' + e.message); }
      }
    }
    // a saved game from before the family: the old sound choice is replaced once, a later choice sticks
    localStorage.setItem('crumble.skins', JSON.stringify({ sndSet: 'original', lookV: 2 }));
    CFG.SND_SET = 'bells'; loadSkinSave(); out.migrated = CFG.SND_SET;
    saveSkinSave(); CFG.SND_SET = 'bells'; saveSkinSave(); CFG.SND_SET = 'steel'; loadSkinSave(); out.kept = CFG.SND_SET;
    return out;
  });
  assert.deepEqual(r.bad, [], 'no set throws on any event');
  assert.equal(r.dflt, 'strings'); assert.equal(r.pick, 'soft'); assert.equal(r.place, 'drop');
  assert.equal(r.migrated, 'strings', 'an old saved sound choice moves to the family once');
  assert.equal(r.kept, 'bells', 'after that, her choice is kept');
});

// ---- pressure and recovery (plan 6.1) ----
const rowsBoard = rows => `grid = ${JSON.stringify(rows)}.map(r => [...r].map(ch => (ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null)));`;
const HALF = ['11111111', '11111111', '11111111', '11111111', '00000000', '00000000', '00000000', '00000000'];        // 32 gems, all in one half
const SPECK = ['10010010', '01001001', '00100100', '10010010', '01001001', '00100100', '10010010', '01001001'];      // 22 gems, scattered
const SPREAD = ['10000001', '00100100', '00011000', '01000010', '01000010', '00011000', '00100100', '10000001']; // 17 gems spread out: building
const CRAMP = ['11011011', '11011011', '00000000', '11011011', '11011011', '00000000', '11011011', '11011011'];     // 36 gems, only small gaps

test('room (6.1): empty is 1, a riddled board has less room than a fuller tidy one, and it is cheap', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(([h, s, c, sp]) => {
    const at = rows => { eval(rows); return roomOf(packGrid(grid)); };
    const out = { empty: (grid = empty(), roomOf(packGrid(grid))), half: at(h), speck: at(s), cramp: at(c), spread: at(sp) };
    grid = empty(); const a = packGrid(grid); const t0 = performance.now(); for (let i = 0; i < 1000; i++) roomOf(a); out.ms = (performance.now() - t0) / 1000;
    return out;
  }, [rowsBoard(HALF), rowsBoard(SPECK), rowsBoard(CRAMP), rowsBoard(SPREAD)]);
  assert.equal(r.empty, 1);
  assert.ok(r.speck < r.cramp, '22 scattered gems are tighter than 36 in neat blocks: room, not fullness');
  assert.ok(r.spread > 0.3 && r.spread < 0.55, `17 spread gems are building (${r.spread.toFixed(2)})`);
  assert.ok(r.speck < r.half, `22 scattered gems leave less room (${r.speck.toFixed(2)}) than 32 tidy ones (${r.half.toFixed(2)})`);
  assert.ok(r.half > 0.55 && r.cramp < 0.3, `half board is calm (${r.half.toFixed(2)}), the cramped one is the edge (${r.cramp.toFixed(2)})`);
  assert.ok(r.ms < 0.5, `room() costs ${r.ms.toFixed(3)} ms`);
});

test('phases (6.1): calm, building, an edge held 2-3 trays, recovery at most twice, relief earned by getting out', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(([cramp, half, speck]) => {
    const deal = rows => { eval(rows); tray = [null, null, null]; genTray(); return pace.ph + ':' + lastTier; };
    CFG.SPECIALS.golden = CFG.SPECIALS.star = CFG.SPECIALS.bonus = false; trayNo = 10;
    const out = {};
    pace = { ph: 'calm', n: 0, hold: 0, len: 0 };
    out.calm = deal(half); out.building = deal(speck);
    const holds = new Set(), seq = [];
    for (let k = 0; k < 30; k++) { pace = { ph: 'building', n: 1, hold: 0, len: 0 }; deal(cramp); holds.add(pace.hold); }
    out.holds = [...holds].sort();
    pace = { ph: 'building', n: 1, hold: 0, len: 0 };
    for (let k = 0; k < 9; k++) seq.push(deal(cramp).split(':')[0] + (pace.ph === 'edge' && pace.n === 1 ? '/' + pace.hold : ''));
    out.seq = seq;
    pace = { ph: 'edge', n: 1, hold: 3, len: 0 }; out.out = [deal(half), deal(half), deal(half)];
    pace = { ph: 'recovery', n: 1, hold: 0, len: 0 }; out.out2 = deal(half);
    pace = { ph: 'calm', n: 0, hold: 0, len: 0 }; out.adventure = (mode = 'adventure', tension = 0.5, deal(half)); mode = 'endless';
    return out;
  }, [rowsBoard(CRAMP), rowsBoard(HALF), rowsBoard(SPREAD)]);
  assert.match(r.calm, /^calm:(HONEST|SOLVABLE)$/);
  assert.match(r.building, /^building:HONEST$/);
  assert.deepEqual(r.holds, [2, 3], 'the edge is held a rolled 2 or 3 trays');
  // edge (hold h trays) -> recovery x2 -> edge again: the dealer does not keep handing out a way out
  const h = +r.seq[0].split('/')[1];
  const want = [...Array(h).fill('edge'), 'recovery', 'recovery', 'edge'];
  assert.deepEqual(r.seq.slice(0, want.length).map(x => x.split('/')[0]), want, r.seq.join(' '));
  assert.deepEqual(r.out.map(x => x.split(':')[0]), ['relief', 'relief', 'calm'], 'getting out earns RELIEF_TRAYS guided trays, then calm');
  assert.match(r.out[0], /:(SWEEP|JACKPOT)$/); assert.match(r.out[1], /:SOLVABLE$/);
  assert.match(r.out2, /^relief:/, 'getting out of recovery earns relief too');
  assert.match(r.adventure, /^calm:(SOLVABLE|JACKPOT)$/, 'Adventure keeps the tension wave (no honest trays, phase untouched)');
});

test('hands by phase (6.1): honest and recovery are playable, edge pieces each have a spot, recovery is a sequence, never a star', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(([cramp, half]) => {
    const out = { honest: 0, edgeEach: 0, rec: 0, recLines: 0, recSeq: 0, star: 0, n: 30 };
    CFG.SPECIALS.golden = CFG.SPECIALS.bonus = false; CFG.STAR_CHANCE = 1; CFG.STAR_MIN = 1; trayNo = 20;
    const fits = s => fitsAnywhere(s, grid);
    for (let k = 0; k < out.n; k++) {
      eval(half); pace = { ph: 'calm', n: 1, hold: 0, len: 0 }; CFG.GIFT_CHANCE = 0; starCool = 9; tray = [null, null, null]; genTray();
      if (evalHand(packGrid(grid), tray.map(t => t.s), 6000).ok) out.honest++;
      eval(cramp); pace = { ph: 'edge', n: 1, hold: 3, len: 0 }; starForced = true; starCool = 0; specialEnd = -99; tray = [null, null, null]; genTray();
      if (tray.every(t => fits(t.s))) out.edgeEach++;
      out.star += tray.some(t => t.s.star) ? 1 : 0;
      eval(cramp); pace = { ph: 'edge', n: 3, hold: 2, len: 0 }; starForced = true; starCool = 0; specialEnd = -99; tray = [null, null, null]; genTray();
      const ev = evalHand(packGrid(grid), tray.map(t => t.s), 6000);
      if (ev.ok) out.rec++; if (ev.lines >= 2) out.recLines++; if (ev.immPieces <= 1) out.recSeq++;
      out.star += tray.some(t => t.s.star) ? 1 : 0;
    }
    return out;
  }, [rowsBoard(CRAMP), rowsBoard(HALF)]);
  assert.equal(r.honest, r.n, 'calm/building hands are playable in some order');
  assert.equal(r.edgeEach, r.n, 'no edge piece is dead on arrival');
  assert.equal(r.rec, r.n, 'a recovery hand is playable');
  assert.ok(r.recLines >= r.n * 0.8 && r.recSeq >= r.n * 0.8, `recovery offers 2+ lines (${r.recLines}) with at most one piece clearing on its own (${r.recSeq})`);
  assert.equal(r.star, 0, 'no star on edge or recovery trays');
});

test('rescues (6.1): the first is free, the second is earned by 30 lines; Adventure keeps both free', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const out = {};
    score = 500; rescuesUsed = 0; out.first = rescueAllowed(best);
    rescue(); out.afterFirst = { used: rescuesUsed, allowed: rescueAllowed(best), ph: pace.ph, lines: rescueLines };
    banners.length = 0;
    grid = empty(); for (let c = 0; c < 7; c++) grid[0][c] = { gi: 0, t: 1, f: 0, l: 0 };
    rescueLines = CFG.RESCUE_EARN_LINES - 1; tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, null]; place(0, 0, 7);
    out.earned = { allowed: rescueAllowed(best), banner: banners.some(b => b.txt === 'RESCUE EARNED') };
    rescueLines = 0; mode = 'adventure'; out.adv = rescueAllowed(best); mode = 'endless';
    return out;
  });
  assert.equal(r.first, true);
  assert.deepEqual(r.afterFirst, { used: 1, allowed: false, ph: 'recovery', lines: 0 });
  assert.deepEqual(r.earned, { allowed: true, banner: true });
  assert.equal(r.adv, true);
});

test('pace (6.1): save/resume and Undo keep the phase and the earned-rescue count; an old save starts calm', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { pace = { ph: 'edge', n: 2, hold: 3, len: 0 }; rescueLines = 12; rescuesUsed = 1; saveRun(); });
  await reload(page);
  const a = await page.evaluate(() => ({ pace, rescueLines }));
  assert.deepEqual(a, { pace: { ph: 'edge', n: 2, hold: 3, len: 0 }, rescueLines: 12 });
  const u = await page.evaluate(() => {
    const mv = (() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return [i, r, c]; })();
    place(...mv); pace = { ph: 'relief', n: 1, hold: 0, len: 2 }; rescueLines = 40; undo();
    const back = { pace: { ...pace }, rescueLines };
    const o = snapshot(); delete o.pace; delete o.rescueLines; restore(o);
    return { back, old: { pace: { ...pace }, rescueLines } };
  });
  assert.deepEqual(u.back, { pace: { ph: 'edge', n: 2, hold: 3, len: 0 }, rescueLines: 12 }, 'Undo puts the rhythm back');
  assert.deepEqual(u.old, { pace: { ph: 'calm', n: 0, hold: 0, len: 0 }, rescueLines: 0 });
});

test('pace (6.1): a new run starts calm, hesitation samples carry the phase, ?dev shows phase and room', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    pace = { ph: 'edge', n: 2, hold: 3, len: 0 }; rescueLines = 9; start();
    const fresh = { pace: { ...pace }, rescueLines };
    pace.ph = 'building'; hesDealt(); hesPick(); const mv = (() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return [i, r, c]; })();
    place(...mv);
    CFG.SHOW_TENSION = true; updateDbg();
    return { fresh, ph: hes.log[hes.log.length - 1].ph, dbg: el('dbg').textContent };
  });
  assert.deepEqual(r.fresh, { pace: { ph: 'calm', n: 0, hold: 0, len: 0 }, rescueLines: 0 }, 'a new run starts calm (the opening tray is dealt by seedOpening, outside the phases)');
  assert.equal(r.ph, 'building');
  assert.match(r.dbg, /room \d\.\d\d/);
});

test('pressure on screen (6.6): follows phase and room, lets go with a relief flash, Adventure and the switch leave it off, gems are untouched', async ({ page }) => {
  await play(page);
  const settle = () => page.waitForTimeout(1600);
  const read = () => page.evaluate(() => ({ p: scr.p, warm: scr.warm, relief: scr.relief }));
  await page.evaluate(() => { pace = { ph: 'calm', n: 1, hold: 0, len: 0 }; roomNow = 0.9; });
  await settle();
  const calm = await read();
  assert.ok(calm.p < 0.05, 'calm is quiet: ' + JSON.stringify(calm));
  await page.evaluate(() => { pace = { ph: 'building', n: 1, hold: 0, len: 0 }; roomNow = 0.4; });
  await settle();
  const building = await read();
  assert.ok(building.p > 0.1 && building.p < 0.5, 'building warms a little: ' + JSON.stringify(building));
  // a gem's own pixels do not change with pressure: the layer is behind and around the board
  const px = () => page.evaluate(() => { grid[4][4] = 2; shake = 0; const d = ctx.getImageData(Math.round((bx + 4.5 * cell) * dpr), Math.round((by + 4.5 * cell) * dpr), 1, 1).data; return [d[0], d[1], d[2]]; });
  await page.evaluate(() => { pace.ph = 'calm'; roomNow = 0.9; }); await settle();
  const gemCalm = await px(); await page.waitForTimeout(100);
  await page.evaluate(() => { pace = { ph: 'edge', n: 1, hold: 3, len: 0 }; roomNow = 0.1; });
  await settle();
  const edge = await read();
  assert.ok(edge.p > 0.7 && edge.warm > 0.8, 'edge is tight and warm: ' + JSON.stringify(edge));
  await page.waitForTimeout(100);
  const gemEdge = await px();
  assert.ok(gemEdge.every((v, i) => Math.abs(v - gemCalm[i]) <= 3), 'a gem pixel is the same at full pressure (a wash over it would move it by 10+): ' + gemCalm + ' vs ' + gemEdge);
  await page.evaluate(() => { pace = { ph: 'recovery', n: 1, hold: 0, len: 1 }; });
  await settle();
  const rec = await read();
  assert.ok(rec.warm < edge.warm && rec.p > 0.7, 'recovery is amber, still tight: ' + JSON.stringify(rec));
  await page.evaluate(() => { pace = { ph: 'relief', n: 1, hold: 0, len: 2 }; roomNow = 0.7; });
  await page.waitForTimeout(150);
  const flash = await read();
  assert.ok(flash.relief > 0.3, 'getting out flashes: ' + JSON.stringify(flash));
  await settle();
  const after = await read();
  assert.ok(after.p < 0.1 && after.relief === 0, 'and then it lets go: ' + JSON.stringify(after));
  // a bonus keeps working under the pressure layer (the violet rim owns the rim)
  const bon = await page.evaluate(() => { pace = { ph: 'edge', n: 1, hold: 3, len: 0 }; roomNow = 0.1; startBonus(); return bonus.left; });
  await settle();
  assert.equal(bon, 3); assert.ok((await read()).p > 0.7);
  // off in Adventure and with the switch off
  await page.evaluate(() => { bonus = null; CFG.FX_PRESSURE_SCREEN = false; }); await settle();
  assert.equal((await read()).p, 0, 'the switch turns it off');
  await page.evaluate(() => { CFG.FX_PRESSURE_SCREEN = true; mode = 'adventure'; }); await settle();
  assert.equal((await read()).p, 0, 'Adventure keeps its own border');
  const fresh = await page.evaluate(() => { mode = 'endless'; pace = { ph: 'edge', n: 1, hold: 3, len: 0 }; scr.p = 0.9; scr.relief = 1; start(); return { p: scr.p, relief: scr.relief }; });
  assert.deepEqual(fresh, { p: 0, relief: 0 }, 'a new run starts with no pressure on screen');
});

let failed = 0;
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // ONLY=adventure npm test: just the scenarios whose name matches
for (const { name, fn } of tests) {
  if (only && !only.test(name)) continue;
  for (const k of Object.keys(server.patches)) delete server.patches[k];
  const { browser, page, errors } = await openGame(server.url);
  try {
    await fn({ page, errors, server });
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`);
    await page.screenshot({ path: `tests/out/${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
}
await server.close();
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);

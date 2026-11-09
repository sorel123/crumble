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
  const loud = () => page.evaluate(() => ({ tags: tags.length, praises: praises.length, slams: slams.length, orbs: orbs.length, bands: bands.length, punch: punchT, combo }));
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const calm = await loud();
  assert.equal(calm.combo, 1);
  assert.ok(calm.tags > 0 && calm.praises === 1, 'point tags and one praise word');
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

test('the opening: 100 seeded new games each clear a line within the first three placements', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = [];
    const orig = Math.random;
    for (let seed = 1; seed <= 100; seed++) {
      let a = seed * 2654435761 >>> 0;                    // a fresh mulberry32 stream per game
      Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      start();
      const a0 = packGrid(grid), hand = tray.map(t => t.s), ev = evalHand(a0, hand, 6000);
      out.push({ filled: countFlat(a0), ok: ev.ok, lines: ev.lines, imm: ev.imm, trayNo, label: lastTier, specials: tray.some(t => t.s.star) || !!golden || !!transform || !!blast });
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

test('trays 1-5 never carry a special, even with SPECIALS on; from tray 6 they can', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    CFG.SPECIALS = true; CFG.STAR_CHANCE = 1; CFG.MYSTERY_CHANCE = 1; CFG.GOLDEN_CHANCE = 1;
    const early = [], late = [];
    for (let n = 1; n <= 12; n++) {
      trayNo = n - 1; starForced = true; goldenNext = true; goldenCool = 0; transform = null; transformCool = 0; grid = empty();
      genTray();
      (n <= 5 ? early : late).push({ star: tray.some(t => t.s.star), gold: !!golden, tf: !!transform });
    }
    const t = (trayNo = 2, transform = null, triggerTransform('rainbow'), !!transform);
    CFG.SPECIALS = false;
    return { early, late, earlyTransform: t };
  });
  assert.ok(r.early.every(x => !x.star && !x.gold && !x.tf), 'no star, golden hand or transformation in trays 1-5');
  assert.ok(r.late.some(x => x.star || x.gold || x.tf), 'with SPECIALS on they do appear later');
  assert.equal(r.earlyTransform, false, 'an achievement cannot start a transformation in the opening either');
});

test('Blast Round has no meter: clearing fills nothing, waiting drains nothing, nothing auto-starts', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async () => {
    CFG.SPECIALS = true; trayNo = 10; transformCool = 0;
    const had = typeof blastMeter !== 'undefined' || 'METER_LINE' in CFG || 'METER_DRAIN' in CFG || 'METER_IDLE' in CFG;
    grid = empty(); grid[0] = grid[0].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null));
    tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    place(0, 0, 0); place(1, 3, 3); place(2, 4, 4);        // a clear and the end of the tray
    await new Promise(r => setTimeout(r, 400));
    return { had, blast: !!blast };
  });
  assert.equal(r.had, false, 'no meter state or settings remain');
  assert.equal(r.blast, false, 'a Blast Round never starts by itself');
  await page.evaluate(() => { CFG.SPECIALS = false; });
});

test('specials are paused by one switch: no golden hand, star, transformation or Blast Round', async ({ page }) => {
  await play(page);
  assert.equal(await page.evaluate(() => CFG.SPECIALS), false, 'default is off');
  const r = await page.evaluate(() => {
    starForced = true; goldenNext = true; goldenCool = 0;
    let stars = 0, golds = 0;
    for (let i = 0; i < 40; i++) {
      genTray();
      stars += tray.filter(t => t && t.s.star).length; golds += golden ? 1 : 0;
    }
    triggerTransform('rainbow');
    return { stars, golds, transform: !!transform, blast: !!blast };
  });
  assert.deepEqual(r, { stars: 0, golds: 0, transform: false, blast: false });
  // ...and the switch brings them back
  const on = await page.evaluate(() => { CFG.SPECIALS = true; triggerTransform('rainbow'); const t = !!transform; CFG.SPECIALS = false; return t; });
  assert.equal(on, true, 'with SPECIALS on a transformation starts');
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

test('a Blast Round hand is dealt in small slices, and pickups wait for it', async ({ page }) => {
  await play(page);
  await watchFrames(page);
  await setup(page, { rows: THREE_LINES.map((r, i) => (i < 3 ? '00000000' : r)), trayShapes: [0, 1, 2] });
  await frameLog(page);
  const g = await geometry(page);
  const during = await page.evaluate(p => {                    // same task as startBlast, so no frame can finish the deal first
    startBlast();
    const t0 = blast.t, was = !!dealing;
    onDown({ pointerId: 7, clientX: p.x, clientY: p.y });
    return { was, drag: !!drag, t0 };
  }, g.trayCenters[0]);
  assert.equal(during.was, true, 'the blast hand is being dealt');
  assert.equal(during.drag, false, 'the old piece can\'t be picked up while the new hand is coming');
  await dealt(page);
  assert.ok(await page.evaluate(t0 => blast.t >= t0 - 100, during.t0), 'the round clock waited for the deal');
  const { steps } = await frameLog(page);
  const slice = await page.evaluate(() => CFG.DEAL_SLICE_MS);
  console.log(`     (${steps.length} slices, largest ${Math.max(...steps).toFixed(1)} ms)`);
  const sorted = steps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  assert.ok(steps.length >= 1 && median < slice + 3, `slices stay near DEAL_SLICE_MS (${steps.map(x => x.toFixed(1))})`);
  assert.match(await page.evaluate(() => lastTier), /^BLAST/);
});

test('dealing in slices runs the same search as dealing in one go', async ({ page }) => {
  await play(page);
  const same = await page.evaluate(() => {
    const seeded = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const keep = Math.random, out = [];
    for (let k = 0; k < 12; k++) {
      grid = grid.map(r => r.map(() => (keep() < 0.3 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
      const g0 = grid, ten = k / 11, carry0 = carry, star0 = starForced, no0 = trayNo;
      blast = k % 3 === 2 ? { t: 1e4, pts: 0, lines: 0 } : null;
      const run = stepwise => {
        grid = g0; tension = ten; carry = carry0; starForced = star0; trayNo = no0; transform = null; sweepCool = 0; goldenCool = 0; transformCool = 9;
        goldenNext = k % 4 === 1; Math.random = seeded(100 + k);
        if (stepwise) { const it = dealSteps(); while (!it.next().done) performance.now(); } else genTray();   // stepwise: one candidate per call, as frames would
        return tray.map(t => SHAPES.indexOf(t.s) + ':' + t.gi).join(',') + '|' + lastTier;
      };
      out.push([run(false), run(true)]);
    }
    Math.random = keep; blast = null; golden = null;
    return out;
  });
  same.forEach(([a, b], k) => assert.equal(b, a, `board ${k}`));
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
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
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
    CFG.SPECIALS = true;
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
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
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

const server = await serve();
fs.mkdirSync('tests/out', { recursive: true });
let failed = 0;
for (const { name, fn } of tests) {
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

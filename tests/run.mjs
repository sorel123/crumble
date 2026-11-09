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

test('Blast never starts by itself: a full button waits, and the old meter is gone', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(async () => {
    trayNo = 10; transformCool = 0; blastCharge = blastShown = CFG.BLAST_CHARGE; syncBlastBtn();
    const had = typeof blastMeter !== 'undefined' || 'METER_LINE' in CFG || 'METER_DRAIN' in CFG || 'METER_IDLE' in CFG;
    grid = empty(); grid[0] = grid[0].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null));
    tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    place(0, 0, 0); place(1, 3, 3); place(2, 4, 4);        // a clear and the end of the tray
    await new Promise(r => setTimeout(r, 2500));
    return { had, blast: !!blast, charge: blastCharge };
  });
  assert.equal(r.had, false, 'no meter state or settings remain');
  assert.equal(r.blast, false, 'a Blast Round never starts by itself');
  assert.equal(r.charge, await page.evaluate(() => CFG.BLAST_CHARGE), 'waiting drains nothing');
});

test('one switch per special: Blast and the star gem are on, golden hand and transformations stay off', async ({ page }) => {
  await play(page);
  assert.deepEqual(await page.evaluate(() => CFG.SPECIALS), { blast: true, star: true, golden: false, transform: false });
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
  assert.deepEqual(r, { stars: 0, golds: 0, transform: false, blast: false }, 'on an empty board no cross is worth a star, so none is dealt');
  // ...and its own switch brings one back
  const on = await page.evaluate(() => { CFG.SPECIALS.transform = true; triggerTransform('rainbow'); const t = !!transform; CFG.SPECIALS.transform = false; return t; });
  assert.equal(on, true, 'switched on, a transformation starts');
});

// ---- star gem (plan 4.5b) ----
const withDiag = async page => { await play(page); await page.evaluate(() => { window.diagBoard = () => { grid = empty(); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (r !== c) grid[r][c] = { gi: 0, t: 1, f: 0, l: 0 }; }; }); };   // board full but the diagonal: a star's cross is worth 14

test('star gem: dealt only when a cross is worth it, with a cooldown, and never two specials in a row', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(() => {
    const out = {};
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
    diagBoard(); out.blast = deal(() => { blast = { t: 5000, pts: 0, lines: 0, best: 0, swaps: 0, tick: 0 }; }); blast = null;
    diagBoard(); out.live = deal(() => { tray = [{ s: STAR, gi: STAR_GI }, null, null]; });
    return out;
  });
  assert.equal(r.empty, 0); assert.equal(r.diag, 14); assert.equal(r.at, 14);
  assert.equal(r.emptyDealt, false, 'an empty board is not worth a star');
  assert.ok(r.thin < 9, 'two short rows are worth less than STAR_MIN');
  assert.equal(r.worth, true, 'a worthwhile cross and a forced star: dealt');
  assert.equal(r.cool, 8, 'the cooldown starts when it is dealt');
  assert.equal(r.coolHeld, false, 'no second star during the cooldown');
  assert.equal(r.again, false, 'never two specials in a row');
  assert.equal(r.afterGap, true, 'one tray later it can come');
  assert.equal(r.blast, false, 'none during a Blast Round');
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

test('star gem: the first one shows a one-line label, Blast reads as held while a star is in the tray, no hesitation sample', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(() => {
    diagBoard(); trayNo = 12; stats.starSeen = 0; blastCharge = blastShown = CFG.BLAST_CHARGE;
    tray = [{ s: STAR, gi: STAR_GI }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }]; dealing = null; syncActions();
    const out = { note: !el('starNote').hidden, btnDisabled: el('blastBtn').disabled, held: el('blastBtn').classList.contains('held'), full: el('blastBtn').classList.contains('full') };
    tray = [null, null, null]; hes.dealtAt = 5; commitTray([STAR, SHAPES[0], SHAPES[0]], 'T'); out.hes = hes.dealtAt;
    stats.starSeen = 1; syncActions(); out.noteAfter = !el('starNote').hidden;
    tray = [{ s: SHAPES[0], gi: 1 }, null, null]; syncActions(); out.btnFree = !el('blastBtn').disabled;
    return out;
  });
  assert.equal(r.note, true, 'the first star ever is explained once');
  assert.equal(r.noteAfter, false, 'and never again');
  assert.equal(r.btnDisabled, true); assert.equal(r.held, true); assert.equal(r.full, false);
  assert.equal(r.btnFree, true, 'Blast is tappable again once the star is gone');
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
  assert.equal(await page.locator('#lookGrid .look-btn').count(), 5);
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
    blastCharge = 5; specialEnd = 7;
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

/* ═══════ Blast as a tap-to-start reward (plan 4.5a) ═══════ */
// a row that one single-cell drop at (r,0) clears; combo is set so that drop's clear is combo k
const clearAt = (r, k) => `grid[${r}] = grid[${r}].map((_, c) => (c ? { gi: 0, t: 1, f: 0, l: 0 } : null)); tray[0] = { s: SHAPES[0], gi: 1 }; combo = (${k}) - 1; place(0, ${r}, 0);`;
const fillBlast = page => page.evaluate(() => { blastCharge = blastShown = CFG.BLAST_CHARGE; syncBlastBtn(); });

test('only combos charge Blast (combo 2+ adds combo-1, at most 3), only from tray 6, and never during a round', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(src => {
    grid = empty(); blastCharge = 0; trayNo = 10;
    const after = k => { eval(src.replace(/K/g, k)); return blastCharge; };
    const out = {};
    out.single = after(1);                                   // a lone clear: nothing
    out.c2 = after(2);                                       // +1
    out.c3 = after(3);                                       // +2
    out.c6 = after(6);                                       // +3 (capped)
    const plain = blastCharge; tray[1] = { s: SHAPES[0], gi: 1 }; place(1, 5, 5); out.noClear = blastCharge - plain;   // no clear: nothing
    blastCharge = 0; trayNo = 4; out.early = after(5);       // the opening (trays 1-5) charges nothing
    trayNo = 10; blastCharge = CFG.BLAST_CHARGE - 1; out.capped = after(6);   // never past full
    blastCharge = 0; blast = { t: 9e9, pts: 0, lines: 0, best: 0, swaps: 0, tick: 0 }; out.during = after(6); blast = null;
    return out;
  }, clearAt(0, 'K'));
  assert.deepEqual(r, { single: 0, c2: 1, c3: 3, c6: 6, noClear: 0, early: 0, capped: await page.evaluate(() => CFG.BLAST_CHARGE), during: 0 });
});

test('a charging combo flies one spark to the button; full, it glows and chimes once, then a tap starts the round', async ({ page }) => {
  await play(page);
  assert.equal(await page.isDisabled('#blastBtn'), true, 'empty: not tappable');
  await page.evaluate(src => {
    window.__chimes = 0; const f = Sfx.blastReady; Sfx.blastReady = () => { window.__chimes++; f(); };
    trayNo = 10; grid = empty(); blastCharge = blastShown = CFG.BLAST_CHARGE - 1; syncBlastBtn();
    eval(src);
  }, clearAt(0, 4));
  assert.equal(await page.evaluate(() => blastSparks.length), 1, 'one spark in flight');
  assert.equal(await page.isDisabled('#blastBtn'), true, 'the button fills when the spark lands, not before');
  await page.waitForFunction(() => !blastSparks.length);
  assert.equal(await page.evaluate(() => el('blastBtn').classList.contains('full')), true, 'full: it glows');
  assert.equal(await page.isDisabled('#blastBtn'), false);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__chimes), 1, 'one chime, no nagging');
  await page.evaluate(() => { tray[1] = { s: SHAPES[0], gi: 1 }; place(1, 6, 6); });   // a normal move, so Undo has something
  await dealt(page);
  await page.click('#blastBtn');
  const r = await page.evaluate(() => ({ blast: !!blast, charge: blastCharge, undo: el('undoBtn').disabled, world: curWorld, live: el('blastBtn').classList.contains('live') }));
  assert.deepEqual(r, { blast: true, charge: 0, undo: true, world: 'blast', live: true });
  await dealt(page);
  assert.match(await page.evaluate(() => lastTier), /^BLAST/, 'the leftover tray was replaced by a blast hand');
});

test('the button only works when nothing else is live and not on the tray right after a special', async ({ page }) => {
  await play(page);
  await fillBlast(page);
  const r = await page.evaluate(() => {
    const out = {};
    trayNo = 10; specialEnd = 9; out.rightAfter = canBlast();
    specialEnd = 8; out.later = canBlast();
    transform = { id: 'rainbow', remaining: 3 }; out.withTransform = canBlast(); transform = null;
    tray[2] = { s: STAR, gi: STAR_GI }; out.withStar = canBlast();
    return out;
  });
  assert.deepEqual(r, { rightAfter: false, later: true, withTransform: false, withStar: false });
});

test('the round ends at 0 s with a results card; a tap anywhere dismisses it; rounds and Best Blast are counted', async ({ page }) => {
  await play(page);
  await fillBlast(page);
  await page.evaluate(() => { trayNo = 10; });
  await page.click('#blastBtn'); await dealt(page);
  await page.evaluate(() => { blast.pts = 480; blast.lines = 6; blast.best = 3; blast.t = 200; });
  await page.waitForFunction(() => !el('blastCard').hidden);
  const r = await page.evaluate(() => ({ blast: !!blast, paused, state, pts: el('bcPts').textContent, best: el('bcBest').textContent,
    stats: { blasts: stats.blasts, bestBlast: stats.bestBlast }, end: specialEnd === trayNo, home: curWorld !== 'blast' }));
  assert.deepEqual(r, { blast: false, paused: true, state: 'play', pts: '+480', best: 'NEW BEST BLAST!', stats: { blasts: 1, bestBlast: 480 }, end: true, home: true });
  await page.mouse.click(30, 300);                         // anywhere
  assert.equal(await page.evaluate(() => el('blastCard').hidden && !paused), true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.stats')).bestBlast), 480, 'saved for later goals (4.2)');
  // the next tray carries no special
  assert.equal(await page.evaluate(() => { trayNo = specialEnd + 1; return specialOk(); }), false);
});

test('a drag in flight when the clock runs out lands first, then the card shows', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { trayNo = 10; startBlast(); });
  await dealt(page);
  const g = await geometry(page);
  await page.evaluate(p => { onDown({ pointerId: 3, clientX: p.x, clientY: p.y }); blast.t = 0; }, g.trayCenters[0]);
  await frames(page, 5);
  assert.deepEqual(await page.evaluate(() => ({ blast: !!blast, card: !el('blastCard').hidden, drag: !!drag })), { blast: true, card: false, drag: true });
  await page.evaluate(() => onUp({ pointerId: 3 }));
  await page.waitForFunction(() => !el('blastCard').hidden);
  assert.equal(await page.evaluate(() => blast), null);
});

test('the round clock does not run while the app is hidden, or while Settings is open', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { trayNo = 10; startBlast(); });
  await dealt(page);
  const t0 = await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); return blast.t; });
  await page.waitForTimeout(3000);
  const t1 = await page.evaluate(() => { delete document.hidden; return blast.t; });
  assert.ok(Math.abs(t1 - t0) < 50, `hidden 3 s: ${t0} -> ${t1}`);
  await page.click('#setBtn');
  await page.waitForTimeout(1000);
  const t2 = await page.evaluate(() => blast.t);
  assert.ok(Math.abs(t2 - t1) < 100, `Settings open 1 s: ${t1} -> ${t2}`);
});

test('stuck mid-round: the hand is swapped twice at most, then the round ends early; the run goes on', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { trayNo = 10; startBlast(); });
  await dealt(page);
  const r = await page.evaluate(() => {
    const out = [];
    const jam = () => { grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
      tray = [0, 1, 2].map(() => ({ s: SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2), gi: 1 })); };
    for (let k = 0; k < 3; k++) { jam(); checkStuck(); out.push({ swaps: blast.swaps, dealing: !!dealing, t: blast.t, stuck }); cancelDeal(); }
    return out;
  });
  assert.deepEqual(r.map(x => [x.swaps, x.dealing, x.stuck]), [[1, true, false], [2, true, false], [2, false, false]]);
  assert.equal(r[2].t, 0, 'the third time the round ends early');
  await page.waitForFunction(() => !el('blastCard').hidden);
  assert.equal(await page.evaluate(() => state), 'play', 'a round never ends the run');
});

test('save/resume keeps the charge and a live round with the time it had left', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { blastCharge = blastShown = 7; trayNo = 10; saveRun(); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  assert.equal(await page.evaluate(() => blastCharge), 7);
  assert.equal(await page.evaluate(() => getComputedStyle(el('blastBtn')).getPropertyValue('--f').trim()), (7 / await page.evaluate(() => CFG.BLAST_CHARGE)).toFixed(3));
  await page.evaluate(() => { startBlast(); });
  await dealt(page);
  await page.evaluate(() => { blast.t = 12000; blast.pts = 90; paused = true; saveRun(); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  const r = await page.evaluate(() => ({ t: blast && blast.t, pts: blast && blast.pts, world: curWorld, charge: blastCharge, undo: !!undoSnap }));
  assert.ok(r.t > 11000 && r.t <= 12000, 'the round carries on: ' + r.t);
  assert.deepEqual({ ...r, t: 0 }, { t: 0, pts: 90, world: 'blast', charge: 0, undo: false });
});

test('Undo cannot give back spent charge or replay a round, and round trays give no hesitation sample', async ({ page }) => {
  await play(page);
  await fillBlast(page);
  await page.evaluate(() => { trayNo = 10; tray[1] = { s: SHAPES[0], gi: 1 }; grid = empty(); place(1, 6, 6); });
  await dealt(page);
  assert.equal(await page.isDisabled('#undoBtn'), false);
  await page.click('#blastBtn'); await dealt(page);
  assert.equal(await page.isDisabled('#undoBtn'), true, 'starting a round clears Undo');
  const n = await page.evaluate(() => hes.log.length);
  const m = await page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
  await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.isDisabled('#undoBtn'), true, 'a move in a round cannot be undone');
  assert.equal(await page.evaluate(() => hes.log.length), n, 'no hesitation sample from a round tray');
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

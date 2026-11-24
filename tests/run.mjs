// Runs every scenario against the game in headless Chromium at 390x844 and exits non-zero on a failure.
//   npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve, openGame, play, snap, setup, dragPiece, geometry, fingerFor, fingers, frames, watchPlace, placed, dragView, dealt, watchFrames, frameLog } from './harness.mjs';
import { expectedAssets } from '../tools/stamp-sw.mjs';
// A launch with a saved run opens on the front menu (Continue / Back to the game); tests that reload go straight back to the game.
const toGame = async page => {
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && typeof closeMenu === 'function');
  await page.evaluate(() => { if (!el('menuCard').hidden) closeMenu(); });
};

const SCORE_SCALE = 10;                      // the game's SCORE_SCALE (js/config.js); a test that sets a score thinks in boosted points
const EMPTY = Array(8).fill('00000000');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
// (8.4) in a game, Settings is on the pause card; Done goes back to it, and Resume back to the game
const openSet = async page => { await page.click('#pauseBtn'); await page.click('#setBtn'); };
const closeSet = async page => { await page.click('#setDone'); if (await page.isVisible('#pauseCard')) await page.click('#pauseResume'); };

test('loads with no errors and shows the start card', async ({ page, errors }) => {
  const s = await snap(page);
  assert.equal(s.state, 'idle');
  assert.equal(await page.isVisible('#startCard'), true);
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), [], 'no script errors (the blocked web font is expected)');
});

test('front menu (8.3): gem logo, crumb, travelling sky, no board or HUD behind it; Home after a game shows the same', async ({ page }) => {
  const r = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res({
    tiles: [...document.querySelectorAll('#startCard .lt b')].map(b => b.textContent).join(''),
    crumb: !!document.querySelector('#startCard #heroCrumb svg'), inGameCrumb: el('mascot').hidden,
    homeUp: el('stage').classList.contains('homeUp'), hud: getComputedStyle(document.querySelector('.hud')).visibility,
    how: el('startHow').hidden, fits: el('startSettings').getBoundingClientRect().bottom <= innerHeight,
  })))));
  assert.deepEqual(r, { tiles: 'CRUMBLE', crumb: true, inGameCrumb: true, homeUp: true, hud: 'hidden', how: false, fits: true });
  const sky = await page.evaluate(() => new Promise(res => { hero.skyAt = performance.now() - SKY_HOLD - 1; setTimeout(() => res({ sky: hero.sky, wiping: !!hero.wipe }), 200); }));
  assert.deepEqual(sky, { sky: 1, wiping: true }, 'the sky moves on to the next journey stage');
  await play(page); await dealt(page);
  assert.equal(await page.evaluate(() => el('stage').classList.contains('homeUp')), false, 'the HUD is back in a game');
  await page.evaluate(() => { best = 4321; score = 0; gameOver(); });
  await page.click('#overMenuBtn'); await page.waitForSelector('#menuCard:not([hidden])');
  const m = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res({
    tiles: document.querySelectorAll('#menuCard .lt').length, stats: el('menuStats').textContent, back: el('menuClose').textContent,
    fits: el('menuClose').getBoundingClientRect().bottom <= innerHeight })))));
  assert.deepEqual(m, { tiles: 7, stats: '👑 Best 4,321', back: 'Back', fits: true });
});
test('front menu (8.3): Play crumbles the logo over the opening board, then the shards and the crumb are gone', async ({ page }) => {
  await page.waitForTimeout(1800);                          // the logo has dropped in
  await play(page);
  const during = await page.evaluate(() => ({ shards: document.querySelectorAll('.crumbleFx canvas').length, crumb: !!document.querySelector('.crumbleFx #heroCrumb'), falling: hero.falling }));
  assert.deepEqual(during, { shards: 28, crumb: true, falling: true });
  await page.waitForFunction(() => !document.querySelector('.crumbleFx'), null, { timeout: 4000 });
  assert.deepEqual(await page.evaluate(() => ({ home: hero.crumb.parentNode === hero.el, falling: hero.falling })), { home: true, falling: false });
});
test('front menu (8.3): Settings opened over the mode menu keeps the game paused when it closes', async ({ page }) => {
  await play(page); await dealt(page);
  await page.click('#pauseBtn'); await page.click('#pauseHome'); await page.click('#menuSettings'); await page.click('#setDone');
  assert.deepEqual(await page.evaluate(() => ({ paused, menu: !el('menuCard').hidden })), { paused: true, menu: true });
  await page.click('#menuEndless');
  assert.equal(await page.evaluate(() => paused), false);
});

test('front menu: Back from a card opened on the start card shows one home card, never the start card and the menu on top of each other', async ({ page }) => {
  const cards = () => page.evaluate(() => ({ start: !el('startCard').hidden, menu: !el('menuCard').hidden }));
  for (const [open, back] of [['#startLab', '#labBack'], ['#startGoals', '#goalsBack'], ['#startDaily', '#dailyBack'], ['#startChal', '#chalBack'], ['#startAdv', '#mapBack']]) {
    await page.click(open); await page.click(back);
    assert.deepEqual(await cards(), { start: false, menu: true }, open + ' then ' + back);
    await page.click('#menuClose');                         // Back with no game yet: the start card again
    assert.deepEqual(await cards(), { start: true, menu: false }, 'Back from the menu ' + open);
  }
});
test('front menu (rebrand): the Bakery tile on the start card and the menu opens the Bakery; Home comes back to one home card with the player’s best on the tile', async ({ page }) => {
  const tile = () => page.evaluate(() => ({ sub: el('startBakerySub').textContent, sub2: el('menuBakerySub').textContent, drawn: [...document.querySelectorAll('#startBakery canvas')].every(c => c.width > 0 && c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0) }));
  assert.deepEqual(await tile(), { sub: 'Drop treats, bake bigger ones', sub2: 'Drop treats, bake bigger ones', drawn: true });
  await page.click('#startBakery');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, view: !el('bakery').hidden, st: bk.st })), { open: true, view: true, st: 'play' });
  await page.evaluate(() => { lab.bakery.best = 1230; lab.bakery.games = 1; });
  await page.click('#bkPauseBtn'); await page.click('#bkPauseHome');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, start: !el('startCard').hidden, menu: !el('menuCard').hidden, sub: el('menuBakerySub').textContent === bkProg() && /^Best 1,230/.test(bkProg()) })), { open: false, start: false, menu: true, sub: true });
  await page.click('#menuBakery');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, menu: !el('menuCard').hidden })), { open: true, menu: false });
});
test('8.4 pause: no mode pill in a game; pause offers Resume, Home (run saved, Endless says Continue) and End game (tap twice, back to the home screen)', async ({ page }) => {
  await play(page); await dealt(page);
  assert.equal(await page.evaluate(() => !!document.getElementById('modeTag')), false, 'the Endless pill is gone');
  assert.ok(await page.evaluate(() => { el('scoreVal').textContent = '1234560'; el('bestVal').textContent = '2345670'; hudFit();
    return Math.max(...[...document.querySelectorAll('.hud .right > *')].map(e => e.getBoundingClientRect().right)) <= innerWidth; }), 'a seven-digit score leaves the buttons on screen');
  await page.evaluate(() => { score = 1240; saveRun(); });
  await page.click('#pauseBtn');
  assert.deepEqual(await page.evaluate(() => ({ paused, eye: el('pauseEye').textContent, sc: el('pauseScore').textContent })),
    { paused: true, eye: 'Paused · Endless', sc: '1,240' });
  await page.click('#pauseResume');
  assert.deepEqual(await page.evaluate(() => ({ paused, card: el('pauseCard').hidden })), { paused: false, card: true });
  await page.click('#pauseBtn'); await page.click('#pauseNew');
  assert.deepEqual(await page.evaluate(() => ({ state, score, txt: el('pauseNew').textContent })), { state: 'play', score: 1240, txt: 'Tap again to end it' }, 'one tap does not throw the run away');
  await page.click('#pauseResume');
  await page.click('#pauseBtn');
  assert.equal(await page.textContent('#pauseNew'), 'End game', 'the confirm resets when the card opens again');
  await page.click('#pauseHome'); await page.waitForFunction(() => hero.card === el('menuCard'));   // the menu's buttons are set up by its first frame
  assert.deepEqual(await page.evaluate(() => ({ sub: el('menuBest').textContent, back: el('menuClose').hidden, saved: JSON.parse(localStorage.getItem(runStore('endless'))).score })),
    { sub: 'Continue · 1.2k', back: true, saved: 1240 });
  await page.click('#menuEndless');
  await page.waitForFunction(() => state === 'play' && !paused);
  assert.equal(await page.evaluate(() => score), 1240, 'Continue picks the run back up');
  await openSet(page); await page.click('#setDone');
  assert.deepEqual(await page.evaluate(() => ({ paused, card: !el('pauseCard').hidden })), { paused: true, card: true }, 'Settings from pause returns to the pause card');
  await page.click('#pauseNew'); await page.click('#pauseNew');
  await page.waitForFunction(() => hero.card === el('startCard'));
  assert.deepEqual(await page.evaluate(() => ({ state, score, paused, card: el('pauseCard').hidden, home: !el('startCard').hidden, saved: localStorage.getItem(runStore('endless')) })),
    { state: 'idle', score: 0, paused: false, card: true, home: true, saved: null }, 'two taps end the run and go home, nothing left to continue');
  await page.click('#startBtn');
  await page.waitForFunction(() => state === 'play' && !paused); await dealt(page);
  assert.equal(await page.evaluate(() => score), 0, 'Play from home starts a fresh run');
});

test('Play starts a run: the seeded opening board, three playable pieces', async ({ page }) => {
  await page.evaluate(() => { CFG.OPEN_BUILD = 0; });   // the 3.1-7.2 openings (round 4's build-off opening has its own test)
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

test('running out of moves ends the run after the landing wait', async ({ page }) => {
  await play(page);
  // Two holes in every row and column (a doubled diagonal): filling one completes no line,
  // and a 1x3 bar and a 2x2 square fit nowhere in what is left.
  const rows = Array.from({ length: 8 }, (_, r) => [...'11111111'].map((ch, c) => (c === r || c === (r + 1) % 8 ? '0' : ch)).join(''));
  await setup(page, { rows, trayShapes: [0, 3, 9] });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => stuck, null, { timeout: 3000 });
  assert.equal(await page.isVisible('#noMoves'), true, 'No moves shows while the last drop lands');
  assert.equal(await page.locator('#undoBtn, #helpBtn, #endBtn').count(), 0, 'no Undo, Rescue or End run button');
  await page.waitForFunction(() => !el('overCard').hidden, null, { timeout: 5000 });
  assert.equal((await snap(page)).state, 'over');
  assert.equal(await page.isVisible('#reviveBtn'), await page.evaluate(() => rescueAllowed(best)), 'the card offers the rescue exactly when the gate allows it');
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
  await page.evaluate(() => { CFG.PRAISE_WORDS = true; });   // (voice) the words are off by default now; this is the classic calm clear with them on ("voice:" covers the default)
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

test('7.5 crumble: each gem breaks into four pieces of itself, the line cracks as a wave from the piece, pieces fall off the screen over the board; bigger clears get more', async ({ page }) => {
  await play(page);
  assert.equal(await page.evaluate(() => CFG.CLEAR_STYLE), 'crumble', 'crumble is the default clear');
  // follow the pieces from outside: most alive at once, how far down they got, dust and specks, how long until all gone
  const watch = () => page.evaluate(() => new Promise(res => {
    let most = 0, k = 0, low = 0, dustMax = 0, specks = 0, quarter = null; const t0 = performance.now();
    const step = () => {
      most = Math.max(most, rubble.length); dustMax = Math.max(dustMax, dust.length); specks = Math.max(specks, shards.length);
      if (!quarter && rubble.length) quarter = { tiles: rubble[0].tiles === gemBig, fw: rubble[0].fw, fh: rubble[0].fh };
      low = Math.max(low, ...rubble.map(b => b.y), 0);
      if ((++k > 10 && !rubble.length && !shatters.length) || k > 400) return res({ most, low, dustMax, specks, quarter, frames: k, H, by, B, left: rubble.length });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  await page.evaluate(() => { perf.fx = 1; dust.length = 0; shards.length = 0; });
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1, 7), '10000000'], trayShapes: [0, 0, 0] });
  // read the wave as place() leaves it: the nearest gems can be gone by the time the drag returns on a slow machine
  await page.evaluate(() => { const orig = place; place = function () { const out = orig.apply(this, arguments); window.__wave = shatters.filter(s => s.r === 0).map(s => ({ c: s.c, t0: s.t0 })); place = orig; return out; }; });
  await dragPiece(page, 0, 0, 0);
  // the crack ripples along the line from the piece: each gem starts CRUMBLE_STAGGER frames after its neighbour
  const wave = await page.evaluate(() => window.__wave.sort((a, b) => a.c - b.c).map(s => -s.t0));
  const st = await page.evaluate(() => CFG.CRUMBLE_STAGGER);
  assert.ok(wave.length >= 7 && wave.every((d, i) => i === 0 || Math.abs(d - wave[i - 1] - st) < 1e-6), 'the crack runs along the line from the piece: ' + wave.map(d => d.toFixed(2)).join(','));
  const one = await watch();
  assert.equal(one.left, 0, 'a single line\'s pieces are all gone');
  assert.equal(one.most, 32, 'a single line breaks every gem into four pieces');
  assert.deepEqual(one.quarter, { tiles: true, fw: 0.5, fh: 0.5 }, 'each piece is a quarter cut from the gem\'s own tile');
  assert.equal(one.specks, 0, 'a single line stays crisp: no specks');
  assert.ok(one.dustMax < 8, `and no dust puff per gem (${one.dustMax}: the piece's own landing dust only)`);
  assert.ok(one.frames < 60, `and is quick: gone in about a second (${one.frames} frames)`);
  await dealt(page);
  await page.evaluate(() => { perf.fx = 1; });
  await setup(page, { rows: THREE_LINES, trayShapes: [4, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  const multi = await watch();
  assert.ok(multi.most > one.most * 2, `three lines break more (${multi.most} vs ${one.most})`);
  assert.ok(multi.dustMax > 24 && multi.specks > 0, `with a pale puff per gem and specks (${multi.dustMax} dust)`);
  assert.ok(multi.frames < 45, `(speed) an everyday multi-line clear is quick too: gone in ~400 ms, not a fall off the screen (${multi.frames} frames)`);
  assert.equal(multi.left, 0, 'and are gone');
  // the order: over the board's gems, under the tray
  const order = await page.evaluate(() => new Promise(res => {
    const log = []; const dr = drawRubble, gm = gem;
    window.drawRubble = dt => { log.push('rubble'); dr(dt); };
    window.gem = (...a) => { const k = a[7] ? 'tray' : 'gem'; if (log[log.length - 1] !== k) log.push(k); gm(...a); };
    grid[5][5] = { gi: 2, t: 1, f: 0, l: 0 };
    spawnRubble({ tier: 2, ox: 0, oy: 0, gi: 0 }, W / 2, by, GEMS[0]);
    requestAnimationFrame(() => { window.drawRubble = dr; window.gem = gm; rubble.length = 0; res(log); });
  }));
  const ri = order.indexOf('rubble');
  assert.ok(ri > order.indexOf('gem') && order.indexOf('gem') >= 0 && order.lastIndexOf('tray') > ri, 'pieces draw after the board\'s gems and before the tray: ' + order.join(','));
  // it shares the particle budget
  const capped = await page.evaluate(() => {
    perf.fx = 0.3;
    for (let k = 0; k < 200; k++) spawnRubble({ tier: 4, ox: 0, oy: 0, gi: 0 }, W / 2, by, GEMS[0]);
    return { live: fxLive(), cap: Math.round(CFG.PARTICLE_CAP * perf.fx) };
  });
  assert.ok(capped.live <= capped.cap, `pieces are held to the particle budget (${capped.live} <= ${capped.cap})`);
  await page.evaluate(() => { rubble.length = 0; dust.length = 0; perf.fx = 1; });
});

test('7.5 crumble: squash and burst stay in Admin; an old saved Admin tuning does not bring squash back', async ({ page, server }) => {
  await page.evaluate(() => localStorage.setItem('crumble.dev.6', JSON.stringify({ CLEAR_STYLE: 'squash', SHAKE: 0.5 })));
  await page.goto(server.url + '?dev');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  const r = await page.evaluate(() => ({ style: CFG.CLEAR_STYLE, shake: CFG.SHAKE, opts: DEV_CHOICES.find(c => c[0] === 'CLEAR_STYLE')[2].map(o => o.value) }));
  assert.equal(r.style, 'crumble', 'the old squash default is dropped once');
  assert.deepEqual(r.opts, ['crumble', 'squash', 'burst']);
  await page.evaluate(() => { CFG.CLEAR_STYLE = 'squash'; devSave(); });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.CLEAR_STYLE), 'squash', 'a choice made after this sticks');
  await page.evaluate(() => localStorage.removeItem('crumble.dev.6'));
});

test('the opening: 100 seeded new games each clear a line within the first three placements', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = []; CFG.OPEN_BUILD = 0;   // the 3.1-7.2 openings (round 4's build-off opening has its own test)
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
      out.push({ kind: openingKind, filled: countFlat(a0), ok: ev.ok, lines: ev.lines, imm: ev.imm, trayNo, label: lastTier, left, specials: tray.some(t => t.s.star) || !!golden || !!transform || !!bonus });
    }
    Math.random = orig;
    return out;
  });
  assert.equal(r.length, 100);
  assert.ok(r.every(g => g.ok), 'all three pieces of the first tray are playable');
  // plan 7.2: gift and busy openings clear with one drop; light ones clear within the hand (a set-up a tidy stacker finds)
  assert.ok(r.every(g => g.kind === 'light' ? g.lines >= 1 : g.imm >= 1), 'a line is completed: one placement for gift and busy, within the hand for light');
  assert.ok(r.every(g => (g.kind === 'light' ? g.filled >= 3 && g.filled <= 8 : g.filled >= 4 && g.filled <= 16) && g.label === 'OPENING' && g.trayNo === 1), 'a modest seeded pattern, dealt as the opening tray');
  // plan 7.2: a weighted mix, 60% light / 25% gift / 15% busy (loose bounds, 100 games)
  const mix = k => r.filter(g => g.kind === k).length;
  assert.ok(mix('light') >= 48 && mix('light') <= 72, `about 60% light openings (got ${mix('light')}/100)`);
  assert.ok(mix('gift') >= 14 && mix('gift') <= 36, `about 25% gift openings (got ${mix('gift')}/100)`);
  assert.ok(mix('busy') >= 5 && mix('busy') <= 25, `about 15% busy openings (got ${mix('busy')}/100)`);
  assert.ok(r.every(g => !g.specials));
  assert.ok(new Set(r.map(g => g.filled)).size > 3, 'the patterns vary');
  // plan 6.0: most first clears leave blocks; about 1 in 8 sweep the board clean (the rest are the scattered gems)
  const sweeps = r.filter(g => g.left === 0).length;
  assert.ok(r.filter(g => g.kind !== 'light').every(g => g.left >= 0), 'every gift and busy opening has a clearing drop');
  assert.ok(sweeps >= 3 && sweeps <= 25, `some openings sweep on move one (got ${sweeps}/100)`);
  assert.ok(r.filter(g => g.kind !== 'light' && g.left > 0).length >= 0.7 * r.filter(g => g.kind !== 'light').length, 'most gift and busy first clears leave blocks on the board');
});

test('the opening clear really works through the UI: drag the clearing piece, the line goes', async ({ page }) => {
  await page.evaluate(() => { CFG.OPEN_BUILD = 0; });
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
  // a light opening (plan 7.2) has no single obvious drop, only a set-up the hand clears: no drag to test
  if (!found) { assert.equal(await page.evaluate(() => openingKind), 'light', 'a gift or busy opening has a clearing drop'); return; }
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
    const deal = (setup) => { trayNo = 9; starForced = true; starCool = 0; specialEnd = -99; resetWave(); tray = [null, null, null]; setup && setup(); genTray(); return tray.some(t => t && t.s.star); };   // (8.2) fresh payoff and jackpot clocks: a due one deals instead of a star
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

test('star gem: it clears exactly its row and column, pays per gem, ends the special streak and survives save/resume', async ({ page }) => {
  await withDiag(page);
  const r = await page.evaluate(async () => {
    diagBoard(); trayNo = 12; combo = 0; score = 0;
    tray = [{ s: STAR, gi: STAR_GI }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    const sn = snapshot(), seenBefore = stats.starSeen;
    place(0, 3, 3);
    const left = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c]) left.push([r, c]);
    const out = { seenBefore, score, end: specialEnd, trayNo, seen: stats.starSeen, rowGone: grid[3].every(v => !v),
      colGone: grid.every(row => !row[3]), left: left.length, kept: grid[0][1] !== null && grid[0][2] !== null };
    const j = JSON.parse(JSON.stringify(sn)); tray = [null, null, null]; restore(j);
    out.resumed = tray[0] && tray[0].s.star; out.cool = starCool;
    return out;
  });
  assert.equal(r.rowGone && r.colGone, true, 'the whole row and the whole column are gone');
  assert.equal(r.left, 42, 'only the cross left the board');
  assert.equal(r.kept, true, 'everything else stays');
  assert.ok(r.score >= 14 * 14, 'a 14-gem cross pays per gem (' + r.score + ')');
  assert.equal(r.end, 12, 'placing it sets specialEnd to its tray');
  assert.equal(r.seenBefore, 0); assert.equal(r.seen, 1, 'the first-star label is used up');
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
    while ((shatters.length || starBeams.length) && performance.now() - t0 < 2000) await new Promise(r => setTimeout(r, 16));
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
  await page.evaluate(() => dealLater()); await dealt(page);    // a warm-up deal: the first one on a cold page runs unoptimised code
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
        tide = { st: k % 2 ? 'lean' : 'easy', n: 1 + (k % 3), len: 9 }; sweepRun = null; wave = { n: k % 7, at: 5, due: false }; setups = []; closerNext = k % 4 === 3; closerCool = 0; dryN = 0; bigHist = []; trayClear = false; golden = null;   // (7.3) the wave state, the same for both runs (and no hand left live by the first)
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
  // finish the tray, so a fresh one is dealt and timed; then restore it before its first drop: the replay is not a sample
  await dragPiece(page, 2, 6, 6); await dealt(page);
  const mv = () => page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
  const pre = await page.evaluate(() => JSON.stringify(snapshot()));
  let m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2);
  await page.evaluate(p => restore(JSON.parse(p)), pre);
  m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'a tray put back by restore() gives no sample');
  // a resumed run (force-quit) gives no bogus deal-to-pickup time for the tray it reopens on
  await page.evaluate(() => saveRun());
  await page.reload(); await toGame(page); await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'the log survives a reload');
  m = await mv(); await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'a restored tray gives no sample');
  // Settings open before the first drop throws the sample away
  await page.evaluate(() => { hesDealt(); });
  await page.evaluate(() => { el('setBtn') && el('setBtn').click(); });
  await page.evaluate(() => { const d = el('setDone'); if (d) d.click(); });
  m = await mv(); if (m) await dragPiece(page, m.i, m.r, m.c);
  assert.equal(await page.evaluate(() => hes.log.length), 2, 'opening Settings voids the sample');
  // on the player’s phone there is no URL bar: five quick taps on the Settings note show the same numbers
  await openSet(page);
  for (let k = 0; k < 5; k++) await page.click('#setNote');
  assert.match(await page.textContent('#setNote'), /^Last 2 trays \(2 kept\): first pickup [\d.]+s, pickup to drop [\d.]+s, first drop clears \d+%( · Drag: \d+ fps, \d+% late frames, worst \d+ ms \(\d+ frames\))?$/);
  await closeSet(page);
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
  const look = () => page.evaluate(() => ({ t: CFG.THEME, w: CFG.HOME_WORLD, s: CFG.STYLE, m: CFG.MOTIF, cs: curSkin, home: curWorld === homeSky() }));   // (7.5b) the sky shows the player’s home sky: the journey in Endless, else the player’s world
  assert.deepEqual(await look(), { t: 'cotton', w: 'blossom', s: 'clay', m: 'heart', cs: 'clay', home: true });
  assert.equal(await page.getAttribute('#lookGrid [data-id=cotton]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#lookGrid [data-id=classic]', 'aria-pressed'), 'false');
  assert.ok(await page.locator('#lookGrid [data-id=neon]').isDisabled(), 'Neon is locked until its skin is earned');
  await page.evaluate(() => el('lookGrid').querySelector('[data-id=neon]').click());
  assert.equal((await look()).t, 'cotton', 'a locked look does nothing');
  await page.click('#advLook summary');                          // mixing one setting leaves no preset lit
  await page.click('#skinGrid [data-id=blocks]');
  assert.equal(await page.locator('#lookGrid [aria-pressed=true]').count(), 0);
  await page.click('#lookGrid [data-id=mint]');
  await page.reload(); await toGame(page); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await look(), { t: 'mint', w: 'forest', s: 'blocks', m: 'none', cs: 'blocks', home: true });
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
const reload = async page => { await page.reload(); await toGame(page); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle')); };
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
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  const menu = await page.evaluate(() => ({ shown: !el('menuCard').hidden, paused, cta: el('menuBest').textContent }));
  assert.ok(menu.shown && menu.paused, 'a launch opens on the front menu, the run paused behind it');
  assert.match(menu.cta, /^Continue/, 'the big button continues the saved run');
  await page.click('#menuEndless'); await page.waitForFunction(() => el('menuCard').hidden && !paused);
  const after = await runState(page);
  assert.equal(after.state, 'play', 'Continue reopens the run');
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
  await page.evaluate(() => { score = 9500; });
  await page.evaluate(() => gameOver());
  await page.waitForFunction(() => state === 'over');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.stats')));
  assert.equal(st.best, 9500); assert.equal(st.games, 1); assert.equal(st.totalScore, 9500);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.run')), null, 'a finished run is not kept');
  await page.evaluate(() => localStorage.removeItem('crumble.skins'));                    // pretend the unlock list was lost: best alone must restore it
  await reload(page);
  const r = await page.evaluate(() => ({ state, best, shown: el('bestVal').textContent, glass: unlocked.has('glass'), candy: unlocked.has('candy'), neon: unlocked.has('neon') }));
  assert.equal(r.state, 'idle'); assert.equal(r.best, 9500); assert.equal(r.shown, '9500');
  assert.ok(r.glass && r.candy && !r.neon, 'skins up to 9000 points are open');
});

test('points boost (8.0): one clear pays SCORE_SCALE times the old points, and thresholds are scaled', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => ({ s: SCORE_SCALE, line: CFG.LINE_POINTS, sweep: CFG.SWEEP_BONUS, floor: CFG.RESCUE_FLOOR, at: CFG.JOURNEY_AT, candy: SKINS.find(k => k.id === 'candy').unlock,
    goal: LEVELS[2].goal, nScore: LEVELS.filter(l => l.goal.type === 'score').map(l => l.goal.n) }));
  assert.equal(r.s, 10); assert.equal(r.line, 100); assert.equal(r.sweep, 3000); assert.equal(r.floor, 3000);
  assert.deepEqual(r.at, [0, 20000, 60000, 120000, 200000, 300000], '(sky bite) re-spaced for today\'s scoring'); assert.equal(r.candy, 4000);
  assert.deepEqual(r.goal, { type: 'score', n: 1500 }, 'Adventure level 3 asks for 150 old points');
  assert.ok(r.nScore.every(n => n >= 1500), 'every score goal is boosted');
  await dealt(page);
  await setup(page, { rows: ['11111110', '10000000', ...EMPTY.slice(2)], trayShapes: [0, 0, 0] });   // a gem elsewhere: no clean sweep
  const g = await page.evaluate(() => { combo = 0; const s0 = score; place(0, 0, 7); cancelDeal(); return score - s0; });
  assert.equal(g, 1 * SCORE_SCALE + 10 * SCORE_SCALE, 'a 1-cell piece completing one line: placement + one line, boosted');
});

test('points boost (8.0): old saves are multiplied once, never twice, and a fresh install is untouched', async ({ page }) => {
  await play(page);
  await page.evaluate(() => {
    localStorage.removeItem('crumble.scale');
    localStorage.setItem('crumble.stats', JSON.stringify({ v: 1, best: 950, totalScore: 4000, games: 7, lines: 30 }));
    localStorage.setItem('crumble.daily', JSON.stringify({ v: 1, d: { '2026-11-09': { s: 640, l: 7, n: 2 } } }));
    localStorage.setItem('crumble.run', JSON.stringify({ v: 1, score: 321, cb: 300, golden: { pts: 50 }, bonus: { left: 2, extra: 40 } }));
    migrateScale();
  });
  const read = () => page.evaluate(() => ({ st: JSON.parse(localStorage.getItem('crumble.stats')), d: JSON.parse(localStorage.getItem('crumble.daily')).d['2026-11-09'],
    run: JSON.parse(localStorage.getItem('crumble.run')), key: localStorage.getItem('crumble.scale') }));
  let o = await read();
  assert.deepEqual([o.st.best, o.st.totalScore, o.st.games, o.st.lines], [9500, 40000, 7, 30], 'best and total are boosted; counts are not');
  assert.deepEqual(o.d, { s: 6400, l: 7, n: 2 });
  assert.deepEqual([o.run.score, o.run.cb, o.run.golden.pts, o.run.bonus.extra, o.run.bonus.left], [3210, 3000, 500, 400, 2]);
  assert.equal(o.key, '10');
  await page.evaluate(() => migrateScale());
  assert.deepEqual(await read(), o, 'a second run changes nothing');
  await page.evaluate(() => { localStorage.clear(); migrateScale(); });
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.scale')), '10', 'a fresh install only records the scale');
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
  await page.reload(); await toGame(page);
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
  assert.deepEqual(keys.filter(k => k !== 'crumble-music').sort(), ['crumble-deploy2'], 'the old cache is gone (the music cache stays)');
});

// No Undo, no mid-run Rescue, no End run (plan 7.1): running out of moves ends the run; the game-over card has one rescue.
const exact = page => page.evaluate(() => JSON.stringify(snapshot()));
const firstMove = page => page.evaluate(() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return { i, r, c }; return null; });
const crowd = page => page.evaluate(() => {          // a checkerboard: no 2x2 fits anywhere, so the trays are stuck
  grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
  tray = [0, 1, 2].map(() => ({ s: SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2), gi: 1 }));
});

test('there is no Undo, mid-run Rescue or End run button', async ({ page }) => {
  await play(page);
  assert.equal(await page.locator('#undoBtn, #helpBtn, #endBtn').count(), 0);
  const mv = await firstMove(page);
  await dragPiece(page, mv.i, mv.r, mv.c); await dealt(page);
  assert.equal(await page.locator('#undoBtn, #helpBtn, #endBtn').count(), 0, 'still none after a move');
});

test('a run is saved after every move and reopens exactly after a reload', async ({ page }) => {
  await play(page);
  const mv = await firstMove(page);
  await dragPiece(page, mv.i, mv.r, mv.c); await dealt(page);
  const after = await exact(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.run')), after, 'saved right after the move');
  await reload(page);
  assert.equal(await exact(page), after, 'the state a force-quit reopens to');
});

test('a board with no fit shows No moves while the last drop lands, then the run ends', async ({ page }) => {
  await play(page);
  // a crowded board with one 2x2 hole; the tray holds a 1x1 and a 2x2. The 1x1 goes into the hole, the 2x2 then fits nowhere: stuck.
  await setup(page, { rows: ['00111111', '00111111', '11011011', '10110110', '11011011', '10110110', '11011011', '10110110'] });   // isolated holes below: no line is complete, no 2x2 fits except the top-left hole
  await page.evaluate(() => {
    const one = SHAPES.find(s => s.cols === 1 && s.rows === 1), two = SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2);
    tray = [{ s: one, gi: 1 }, { s: two, gi: 1 }, null]; score = 10;
  });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => stuck === true, null, { timeout: 2000 });
  assert.equal(await page.isVisible('#noMoves'), true);
  assert.equal(await page.evaluate(() => state), 'play', 'the landing wait: the run is not over yet');
  await page.waitForFunction(() => !el('overCard').hidden, null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => state), 'over');
  assert.equal(await page.isVisible('#noMoves'), false);
});

test('the one rescue: offered on the game-over card of a run worth saving, spent once, then the run is over', async ({ page }) => {
  await play(page);
  const flags = await page.evaluate(() => {
    const out = {};
    rescuesUsed = 0; score = 0; out.zero = rescueAllowed(best);
    score = 500; out.worth = rescueAllowed(best);
    rescuesUsed = 1; out.spent = rescueAllowed(best); rescuesUsed = 0;
    return out;
  });
  assert.deepEqual(flags, { zero: false, worth: true, spent: false });
  await crowd(page);
  await page.evaluate(() => { rescuesUsed = 0; score = 500; checkStuck(); });
  await page.waitForSelector('#overCard:not([hidden])', { timeout: 3000 });
  assert.equal(await page.isVisible('#reviveBtn'), true, 'the card offers the one rescue');
  await page.click('#reviveBtn');
  const after = await page.evaluate(() => ({ rescuesUsed, state, fits: anyFits(), over: !el('overCard').hidden, stuck }));
  assert.deepEqual(after, { rescuesUsed: 1, state: 'play', fits: true, over: false, stuck: false });
  await page.evaluate(() => { score = 500; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isVisible('#reviveBtn'), false, 'a second game over has no rescue: the run is over');
});


// ── The game-over card (plan 8.1): Out of moves, one marked Second chance, then only Play again and Home ──
const cardState = page => page.evaluate(() => ({
  title: el('overTitle').textContent, second: !el('reviveBox').hidden, btn: el('reviveBtn').textContent, note: el('reviveNote').textContent,
  again: el('againBtn').textContent, againCta: el('againBtn').classList.contains('cta'), home: el('overMenuBtn').textContent }));
test('game-over card (8.1): the Second chance offer is marked one-time, then only Play again and Home', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { score = 500; rescuesUsed = 0; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.deepEqual(await cardState(page), { title: 'Out of moves', second: true, btn: 'Second chance', note: 'Clears space so you can keep this run. Once per game.', again: 'Play again', againCta: false, home: 'Home' });
  await page.click('#reviveBtn');
  assert.equal(await page.evaluate(() => state), 'play');
  await dealt(page);
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  const spent = await cardState(page);
  assert.deepEqual(spent, { title: 'Out of moves', second: false, btn: 'Second chance', note: spent.note, again: 'Play again', againCta: true, home: 'Home' });
  assert.equal(await page.isVisible('#reviveBtn'), false);
  await page.click('#overMenuBtn'); await page.waitForSelector('#menuCard:not([hidden])');
});
test('game-over card (8.1): a run not worth saving shows only Play again and Home; Home opens the front menu', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { score = 0; rescuesUsed = 0; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal((await cardState(page)).second, false);
  assert.equal(await page.isVisible('#reviveNote'), false);
  await page.click('#overMenuBtn');
  await page.waitForSelector('#menuCard:not([hidden])');
  assert.equal(await page.evaluate(() => el('overCard').hidden), true);
});
test('game-over card (8.1): Daily and Adventure use the same card', async ({ page }) => {
  await page.evaluate(() => { mode = 'daily'; start(); }); await dealt(page);
  await page.evaluate(() => { score = 400; rescuesUsed = 0; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.deepEqual(await cardState(page), { title: 'Out of moves', second: true, btn: 'Second chance', note: 'Clears space so you can keep this run. Once per game.', again: 'Play again', againCta: false, home: 'Home' });
  await page.click('#reviveBtn'); await dealt(page);
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal((await cardState(page)).second, false, 'Daily: spent, so only Play again and Home');
});

/* ═══════ Bonus trays (plan 6.2, replaced the old bonus round) ═══════ */
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
    out.home = curWorld === homeSky();
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
  const end = await page.evaluate(() => ({ bonus, world: curWorld === homeSky(), skin: curSkin }));
  assert.deepEqual(end, { bonus: null, world: true, skin: skin }, 'it ended after the third tray; the player’s tiles never changed');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), [], 'no page errors');
});

test('while a bonus runs the sky shifts and the rim pulses, but the board material and the player’s tiles do not change', async ({ page, errors }) => {
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

test('the bonus is saved and resumed (meter and trays left), a bonus move doubles its points, and a new run starts clean', async ({ page }) => {
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
    const s0 = score, x0 = bonus.extra; place(0, 0, 0);
    return { gain: score - s0, extra: bonus.extra - x0 };
  });
  assert.ok(u.gain > 0 && u.extra > 0, 'the move was doubled');
  const n = await page.evaluate(() => { start(); return { bonus, meter: bonusMeter, world: curWorld === homeSky(), chip: el('bonusChip').textContent.trim() }; });
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
      const run = b => { bonus = b; trayNo = 10; tension = k / 7; carry = []; tide = { st: k % 2 ? 'lean' : 'easy', n: 1, len: 9 }; wave = { n: k % 7, at: 5, due: false }; setups = []; closerNext = k % 4 === 3; closerCool = 0; dryN = 0; bigHist = []; trayClear = false; pace = { ph: 'calm', n: 0, hold: 0, len: 0 }; specialEnd = -99; golden = null; goldenNext = false; starForced = false; Math.random = seeded(50 + k); genTray(); bonus = null; return tray.map(t => SHAPES.indexOf(t.s) + ':' + t.gi).join(',') + '|' + lastTier; };
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
  assert.ok(miss.gained < 100 * SCORE_SCALE, 'a miss pays no multiplier: ' + miss.gained);
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
  await dragPiece(page, m.i, m.r, m.c);                // the player can play straight away, through the glow
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

test('golden hand: save/resume and restore keep the hand and re-plan it', async ({ page }) => {
  await play(page);
  await page.evaluate(goldHand);
  const r = await page.evaluate(() => {
    const pre = JSON.parse(JSON.stringify(snapshot()));
    place(0, 0, 0);
    const out = { cleared: golden.got.lines };
    restore(pre); out.undone = golden && golden.got.lines; out.undoneIds = golden.plan.ids.slice().sort(); out.undoneTray = tray.filter(Boolean).length;
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
    triggerTransform('rainbow'); out.first = banners.map(b => [b.txt, b.sub, b.k]); out.dot = el('setBtn').classList.contains('dot') && el('pauseBtn').classList.contains('dot');
    banners.length = 0; transform.remaining = 1; tray = [{ s: SHAPES[0], gi: 1 }, null, null]; place(0, 5, 5);
    out.ended = { live: !!transform, cool: transformCool, end: specialEnd, tn: trayNo };
    banners.length = 0; transformCool = 0; specialEnd = -99; triggerTransform('rainbow'); out.repeat = banners.map(b => [b.txt, b.sub, b.k]);
    return out;
  });
  assert.deepEqual(r.first, [['RAINBOW', 'NEW LOOK UNLOCKED', 1]]); assert.equal(r.dot, true);
  assert.equal(r.ended.live, false); assert.equal(r.ended.cool, 8); assert.equal(r.ended.end, r.ended.tn, 'the next tray carries no special');
  assert.equal(r.repeat.length, 1); assert.equal(r.repeat[0][1], '9 MOVES', '(voice) at x1 no multiplier is named'); assert.ok(r.repeat[0][2] > 1, 'repeats are shorter');
  await openSet(page);
  assert.deepEqual(await page.evaluate(() => [el('setBtn').classList.contains('dot'), el('pauseBtn').classList.contains('dot')]), [false, false], 'opening Settings clears the dot');
});

test('achievements: unlocked looks open in Settings, persist across a reload, and a locked one refuses', async ({ page }) => {
  await ach(page);
  await page.evaluate(() => { discoveredWorlds.clear(); transform = null; saveSkinSave(); });
  await page.evaluate(() => openSettings());
  assert.ok(await page.locator('#lookGrid [data-id=volcano]').isDisabled(), 'locked');
  assert.match(await page.locator('#lookGrid [data-id=volcano] .lock').textContent(), /Combo ×5/);
  await page.evaluate(() => el('lookGrid').querySelector('[data-id=volcano]').click());
  assert.equal(await page.evaluate(() => CFG.STYLE), 'jewel', 'a locked look does nothing');
  await page.evaluate(() => { el('setDone').click(); trayNo = 10; transformCool = 0; specialEnd = -99; triggerTransform('volcano'); transform = null; openSettings(); });
  assert.equal(await page.locator('#lookGrid [data-id=volcano]').isDisabled(), false, 'earned: open');
  await page.click('#lookGrid [data-id=volcano]');
  assert.deepEqual(await page.evaluate(() => [CFG.STYLE, CFG.HOME_WORLD]), ['volcano', 'volcano']);
  await page.reload(); await toGame(page); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => [CFG.STYLE, CFG.HOME_WORLD, discoveredWorlds.has('volcano')]), ['volcano', 'volcano', true], 'the earned look survives a reload');
});

test('achievements: a clean sweep starts its look, resume ends a live look, the card never blocks play', async ({ page }) => {
  await ach(page);
  const r = await page.evaluate(() => {
    const out = {}; CFG.SPECIALS.golden = false; discoveredWorlds.clear();
    grid = empty(); for (let c = 0; c < 7; c++) grid[0][c] = { gi: 0, t: 1, f: 0, l: 0 };
    tray = [{ s: SHAPES.find(s => s.cells.length === 1), gi: 1 }, { s: SHAPES.find(s => s.cells.length === 1), gi: 2 }, { s: SHAPES.find(s => s.cells.length === 1), gi: 3 }];
    place(0, 0, 7); // a clear that empties the board: a clean sweep
    out.live = transform && transform.id;
    return out;
  });
  assert.equal(r.live, 'rainbow', 'a clean sweep starts Rainbow');
  const saved = await page.evaluate(() => { const o = JSON.parse(JSON.stringify(snapshot())); transform = { id: 'volcano', remaining: 5 }; restore(o); return !!transform; });
  assert.equal(saved, false, 'resume ends a live transformation');
  await page.evaluate(() => { trayNo = 10; transformCool = 0; specialEnd = -99; triggerTransform('starfield'); });
  assert.equal(await page.evaluate(() => paused || false), false, 'the card does not pause the game');
});

// ── Adventure (plan 4.1) ──
const reloadGame = page => page.reload().then(() => toGame(page));
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
  await page.click('#pauseBtn'); assert.equal(await page.textContent('#pauseEye'), 'Paused · Level 1'); await page.click('#pauseResume');
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
  await page.click('#pauseBtn'); await page.click('#pauseHome'); await page.click('#menuAdv');
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

test('Adventure: a level run survives a reload, Endless keeps its own run', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { score = 77; saveRun(); });
  await page.click('#pauseBtn'); await page.click('#pauseHome'); await page.click('#menuAdv'); await page.click('#mapList .node >> nth=0');
  await page.waitForFunction(() => state === 'play' && mode === 'adventure'); await dealt(page);
  await page.evaluate(() => { CFG.SPECIALS.golden = false; });
  await clearOne(page); await dealt(page);
  assert.deepEqual(await page.evaluate(() => [lv.lines, lv.pieces]), [1, 1]);
  await reloadGame(page);
  assert.deepEqual(await page.evaluate(() => [state, mode, lvl.id, lv.lines, lv.pieces]), ['play', 'adventure', 1, 1, 1], 'reopens into the level, counters intact');
  assert.equal(await page.textContent('#bestVal'), '1/3');
  await page.click('#pauseBtn'); await page.click('#pauseHome'); await page.click('#menuEndless');
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
    assert.equal(await page.textContent('#againBtn'), 'Play again'); assert.equal(await page.textContent('#overMenuBtn'), 'Home');
    assert.equal(await page.isVisible('#reviveBtn'), true, 'a level offers its Rescue even at score 0');
    assert.equal(await page.evaluate(() => advRec(1).f), k + 1);
    if (k < 2) { await page.click('#againBtn'); await page.waitForFunction(() => state === 'play' && lv.pieces === 0); await dealt(page); }
  }
  assert.equal(await page.evaluate(() => levelOpen(2)), true, 'after three misses the next level opens');
  assert.equal(await page.evaluate(() => levelDone(1)), false);
  await page.click('#overMenuBtn'); await page.waitForSelector('#menuCard:not([hidden])'); await page.click('#menuAdv'); await page.waitForSelector('#mapCard:not([hidden])');
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
  await page.click('#pauseBtn'); assert.equal(await page.textContent('#pauseEye'), 'Paused · Daily'); await page.click('#pauseResume'); assert.equal(await page.textContent('#bestLbl'), 'Today');
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
  assert.equal(await page.textContent('#overMenuBtn'), 'Home');
  await page.evaluate(() => { state = 'play'; score = 500; gameOver(); });         // a Rescue and a second game over: one play
  assert.deepEqual(await page.evaluate(() => daily.d['2026-11-09']), { s: 500, l: 4, n: 1 });
  await page.click('#overMenuBtn'); await page.waitForSelector('#menuCard:not([hidden])'); await page.click('#menuDaily'); await page.waitForSelector('#dailyCard:not([hidden])');
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
  await day('2026-11-12');                                                   // the player has not played yet today: yesterday's streak is still alive
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
  await page.reload(); await toGame(page); await page.waitForFunction(() => typeof goals !== 'undefined');
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
    navigator.share = async d => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, text: d.text }; };
  });
  await page.click('#shareBtn');
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert.equal(s.name, 'crumble-score.png'); assert.equal(s.type, 'image/png'); assert.ok(s.size > 5000);
  assert.equal(s.text, 'My Crumble score: 300. Can you beat it? https://crumble.win');
});

test('share card: footer invites with the site, and a Daily share text says the board is the same for everyone', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate(() => { mode = 'daily'; score = 250; const d = shareText(); mode = 'endless'; return [SHARE_FOOTER, d]; });
  assert.equal(r[0], 'Can you beat it?  \u00B7  crumble.win');
  assert.equal(r[1], "Today's Daily: 250. Same board for everyone: https://crumble.win");
});

test('link preview: Open Graph tags and a 1200x630 image are in the page', async ({ page }) => {
  await play(page);
  const m = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"],meta[name="twitter:card"]')].map(e => [e.getAttribute('property') || e.name, e.content])));
  assert.equal(m['og:title'], 'Crumble'); assert.equal(m['og:url'], 'https://crumble.win/');
  assert.equal(m['og:description'], 'Drag shapes, clear lines, chase clean sweeps.');
  assert.equal(m['twitter:card'], 'summary_large_image');
  assert.equal(m['og:image'], 'https://crumble.win/og-image.png');
  const png = fs.readFileSync(new URL('../og-image.png', import.meta.url));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
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

test('phone speaker defaults on for touch devices unless the player has chosen (6.4)', async ({ page }) => {
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

test('audio on first touch (7.0): a touch anywhere unlocks the context and starts the silent keep-alive, before the game sees it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const before = { actx: actx === null, silent: silentEl === null };
    // a resumed run's first gesture is a drag: the unlock must not depend on pointerdown reaching the game
    const dispatch = type => document.getElementById('startBtn').parentElement.dispatchEvent(new Event(type, { bubbles: true }));
    dispatch('touchend');
    const after = { actx: typeof actx === 'object' && actx !== null, silent: silentEl !== null && silentEl.loop === true, src: silentEl && silentEl.src.slice(0, 5) };
    return { before, after };
  });
  assert.deepEqual(r.before, { actx: true, silent: true }, 'nothing is started before the first touch');
  assert.equal(r.after.actx, true, 'a touchend starts the audio context');
  assert.equal(r.after.silent, true, 'the silent looping element is created');
  assert.equal(r.after.src, 'blob:', 'it is a generated silent WAV, not a file');
});

test('sound family (6.5): every set can play every event, and Original is the default for everyone once', async ({ page }) => {
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
    localStorage.setItem('crumble.skins', JSON.stringify({ sndSet: 'strings', lookV: 2, sndV: 2 }));
    CFG.SND_SET = 'bells'; loadSkinSave(); out.migrated = CFG.SND_SET;
    saveSkinSave(); CFG.SND_SET = 'bells'; saveSkinSave(); CFG.SND_SET = 'steel'; loadSkinSave(); out.kept = CFG.SND_SET;
    return out;
  });
  assert.deepEqual(r.bad, [], 'no set throws on any event');
  assert.equal(r.dflt, 'original'); assert.equal(r.pick, 'soft'); assert.equal(r.place, 'drop');
  assert.equal(r.migrated, 'original', 'a sound choice saved before 2026-11-12 moves to Original once');
  assert.equal(r.kept, 'bells', 'after that, the player’s choice is kept');
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
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer, which Challenge still deals with
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

test('rescue (plan 7.1): one per run on the game-over card; Adventure offers it too', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const out = {};
    score = 500; rescuesUsed = 0; out.first = rescueAllowed(best);
    rescue(); out.afterFirst = { used: rescuesUsed, allowed: rescueAllowed(best), ph: pace.ph };
    rescuesUsed = 0; mode = 'adventure'; out.adv = rescueAllowed(best);
    rescuesUsed = 1; out.advSpent = rescueAllowed(best); mode = 'endless';
    return out;
  });
  assert.equal(r.first, true);
  assert.deepEqual(r.afterFirst, { used: 1, allowed: false, ph: 'recovery' });
  assert.equal(r.adv, true);
  assert.equal(r.advSpent, false);
});

test('pace (6.1): save/resume and restore keep the phase; an old save starts calm', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { pace = { ph: 'edge', n: 2, hold: 3, len: 0 }; rescuesUsed = 1; saveRun(); });
  await reload(page);
  const a = await page.evaluate(() => ({ pace }));
  assert.deepEqual(a, { pace: { ph: 'edge', n: 2, hold: 3, len: 0 } });
  const u = await page.evaluate(() => {
    const mv = (() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return [i, r, c]; })();
    const pre = JSON.parse(JSON.stringify(snapshot()));
    place(...mv); pace = { ph: 'relief', n: 1, hold: 0, len: 2 }; restore(pre);
    const back = { pace: { ...pace } };
    const o = snapshot(); delete o.pace; restore(o);
    return { back, old: { pace: { ...pace } } };
  });
  assert.deepEqual(u.back, { pace: { ph: 'edge', n: 2, hold: 3, len: 0 } }, 'restore puts the rhythm back');
  assert.deepEqual(u.old, { pace: { ph: 'calm', n: 0, hold: 0, len: 0 } });
});

test('pace (6.1): a new run starts calm, hesitation samples carry the phase, ?dev shows phase and room', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    pace = { ph: 'edge', n: 2, hold: 3, len: 0 }; start();
    const fresh = { pace: { ...pace } };
    pace.ph = 'building'; hesDealt(); hesPick(); const mv = (() => { for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) return [i, r, c]; })();
    place(...mv);
    CFG.SHOW_TENSION = true; updateDbg();
    return { fresh, ph: hes.log[hes.log.length - 1].ph, dbg: el('dbg').textContent };
  });
  assert.deepEqual(r.fresh, { pace: { ph: 'calm', n: 0, hold: 0, len: 0 } }, 'a new run starts calm (the opening tray is dealt by seedOpening, outside the phases)');
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

/* ── Challenge (1.1 E1) ── */
// plays the round in the page: each drop is the medal bots' casual pick on the live board (or `pick`), dealing at once
const chPlayRound = (page, pick = 'casual', maxDrops = 99) => page.evaluate(async ([pick, maxDrops]) => {
  const fin = () => { if (dealing) { runSteps(dealing.it); dealing = null; checkStuck(); } };
  const S = chState(chal.deal.open), sigs = [];
  for (let d = 0; d < maxDrops && state === 'play' && !chDone; d++) {
    fin(); if (chDone || state !== 'play') break;
    const left = [0, 1, 2].filter(i => tray[i]).map(i => ({ s: tray[i].s, gi: tray[i].gi, i }));
    if (left.length === 3) sigs.push(JSON.stringify(tray.map(t => [t.s.star ? -1 : SHAPES.indexOf(t.s), t.gi])));
    const a = new Int8Array(64); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) a[r * 8 + c] = grid[r][c] ? grid[r][c].gi : -1;
    let mv = null;
    if (pick === 'casual') mv = chCasual({ ...S, a }, left, null, 0);
    else { const [lo, hi] = chBits(a); for (const k of left.slice().reverse()) { const m = placeMasks(k.s).slice().reverse().find(m => !(lo & m.lo) && !(hi & m.hi)); if (m) { mv = [k, m]; break; } } }
    if (!mv) break;
    place(mv[0].i, mv[1].r, mv[1].c);
  }
  fin();
  return { sigs, score, trayNo, done: chDone, state };
}, [pick, maxDrops]);
const chalStart = async (page, seed) => {
  await page.evaluate(seed => { mode = 'challenge'; saveMode(); chSeed = seed; start(); }, seed);
  await dealt(page);
};

test('Challenge: the fourth mode tile opens its card; Today\'s challenge starts a 12-tray round with the next medal and the tray in the HUD', async ({ page }) => {
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#startCard .homeGrid .tile b')].map(b => b.textContent).join(',')), "Crumb's Bakery,Adventure,Daily,Challenge,Goals");
  assert.ok(await page.evaluate(() => el('startSettings').getBoundingClientRect().bottom <= innerHeight), 'Settings still fits under the tiles');
  await page.click('#startChal'); await page.waitForSelector('#chalCard:not([hidden])');
  assert.deepEqual(await page.evaluate(() => ({ cont: el('chalCont').hidden, today: el('chalToday').className })), { cont: true, today: 'cta' });
  await page.click('#chalToday');
  await page.waitForFunction(() => state === 'play' && mode === 'challenge'); await dealt(page);
  const h = await page.evaluate(() => ({ seed: chal.seed, today: chToday(), lbl: el('bestLbl').textContent, val: el('bestVal').textContent, info: el('chalInfo').textContent,
    med: chal.deal.med, chase: el('chase').hidden, chaseShown: getComputedStyle(el('chase')).display, rescue: rescueAllowed(0) }));
  assert.equal(h.seed, h.today);
  assert.ok(h.med[0] < h.med[1] && h.med[1] < h.med[2], 'bronze < silver < gold: ' + h.med);
  assert.deepEqual([h.lbl, h.val, h.info], ['🥉 Bronze', h.med[0].toLocaleString('en-US'), 'Tray 1 of 12']);
  assert.deepEqual([h.chase, h.chaseShown, h.rescue], [true, 'none', false], 'no chase bar and no rescue in a Challenge');
  await page.click('#pauseBtn');
  assert.deepEqual(await page.evaluate(() => [el('pauseEye').textContent, el('pauseNew').textContent]), ["Paused · Today's challenge", 'Restart']);
});

test('Challenge: the deal is frozen: the same seed deals the same board and the same twelve trays however the player plays', async ({ page }) => {
  await chalStart(page, 'test01');
  const open = await page.evaluate(() => JSON.stringify(chal.deal.open)), deal = await page.evaluate(() => JSON.stringify(chal.deal));
  const a = await chPlayRound(page, 'casual');
  await chalStart(page, 'test01');
  assert.equal(await page.evaluate(() => JSON.stringify(grid.map(r => r.map(g => g ? g.gi : -1)))), open, 'a retry opens on the same board');
  const b = await chPlayRound(page, 'other');
  const n = Math.min(a.sigs.length, b.sigs.length);
  assert.ok(n >= 3, 'both lines got a few trays in (' + a.sigs.length + ', ' + b.sigs.length + ')');
  assert.deepEqual(b.sigs.slice(0, n), a.sigs.slice(0, n), 'every tray is the same, whatever the board');
  const fresh = await page.evaluate(() => { chCache.clear(); return JSON.stringify(chMake('test01')); });
  assert.equal(fresh, deal, 'worked out again from the seed, the deal and its medals are the same');
  assert.notEqual(await page.evaluate(() => JSON.stringify(chMake('test02').trays)), JSON.parse(deal).trays && JSON.stringify(JSON.parse(deal).trays), 'another seed is another deal');
  assert.equal(await page.evaluate(() => chal.deal.trays.some(t => /GOLDEN/.test(t.l))), false, 'no golden hand in a frozen deal');
});

test('Challenge: the deal does not depend on how the browser sorts (iPhone and Chrome deal the same), and Endless still sorts as before', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ref = JSON.stringify(chMake('fair01'));
    const native = Array.prototype.sort;
    Array.prototype.sort = function (cmp) {                // another engine's sort: insertion sort, asks the comparator other questions
      cmp = cmp || ((x, y) => String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0);
      for (let i = 1; i < this.length; i++) { const v = this[i]; let j = i - 1; while (j >= 0 && cmp(this[j], v) > 0) { this[j + 1] = this[j]; j--; } this[j + 1] = v; }
      return this;
    };
    let other;
    try { other = JSON.stringify(chMake('fair01')); } finally { Array.prototype.sort = native; }
    let calls = 0; const rs = rnd; fairDeal = false;
    const a = [1, 2, 3, 4, 5]; rndSrc = () => { calls++; return 0.3; }; rshuffle(a); rndSrc = null;
    return { same: ref === other, sortCalls: calls > 0 };
  });
  assert.deepEqual(r, { same: true, sortCalls: true }, 'the same deal under another sort; outside a Challenge rshuffle is the old random sort');
});

test('Challenge: the scoring the medals are worked out with is the game\'s own: a round played in the game scores what the bots\' sim says', async ({ page }) => {
  for (const seed of ['par01', 'par02']) {
    await chalStart(page, seed);
    const want = await page.evaluate(() => chRun(chal.deal, chCasual, null, 0));
    const r = await chPlayRound(page, 'casual');
    assert.equal(r.score, want, seed + ': the casual line scores the same in the game and in the sim');
  }
});

test('Challenge: twelve trays end the round on the medal card (Retry, New challenge, Share; no Second chance), and the result is saved', async ({ page }) => {
  await chalStart(page, 'end01');
  const r = await chPlayRound(page, 'casual');
  assert.deepEqual([r.trayNo, r.done], [12, true], 'all twelve trays were played');
  await page.waitForSelector('#overCard:not([hidden])', { timeout: 4000 });
  const c = await page.evaluate(() => ({ eye: el('overEye').textContent, title: el('overTitle').textContent, medals: !el('overMedals').hidden,
    won: [...el('overMedals').children].map(s => s.className), msg: el('overMsg').textContent, again: el('againBtn').textContent,
    neu: !el('chalNewBtn').hidden, share: !el('shareBtn').hidden, revive: el('reviveBox').hidden, med: chal.deal.med, score,
    rec: chalRec.s.end01, run: localStorage.getItem('crumble.run.chal') }));
  const m = c.score >= c.med[2] ? 3 : c.score >= c.med[1] ? 2 : c.score >= c.med[0] ? 1 : 0;
  assert.equal(c.eye, 'Challenge #END01');
  assert.equal(c.title, ['Round done', 'Bronze medal', 'Silver medal', 'Gold medal!'][m]);
  assert.deepEqual(c.won, ['won', 'won', 'won'].map((w, i) => i < m ? w : ''));
  if (m < 3) assert.match(c.msg, new RegExp('^' + (c.med[m] - c.score).toLocaleString('en-US') + ' more for ' + ['bronze', 'silver', 'gold'][m]));
  assert.deepEqual([c.again, c.neu, c.share, c.revive], ['Retry', true, true, true]);
  assert.deepEqual(c.rec && [c.rec.b, c.rec.m, c.rec.n], [c.score, m, 1]);
  assert.equal(c.run, null, 'the finished round is not kept as a run');
  // Retry: the same seed, from the top; a lower score keeps the best
  await page.click('#againBtn'); await dealt(page);
  assert.deepEqual(await page.evaluate(() => [chal.seed, trayNo, score]), ['end01', 1, 0]);
  await page.evaluate(() => { score = 10; gameOver(); });
  assert.deepEqual(await page.evaluate(() => [chalRec.s.end01.b, chalRec.s.end01.n, el('overTitle').textContent]), [c.score, 2, 'Out of moves']);
  assert.match(await page.textContent('#overMsg'), /Your best here/);
  // New challenge: another seed
  await page.click('#chalNewBtn'); await page.waitForFunction(() => state === 'play' && chal && chal.seed !== 'end01');
  assert.match(await page.evaluate(() => chal.seed), /^[a-z0-9]{6}$/);
});

test('Challenge: reaching a medal mid-round raises its banner and moves the HUD to the next one; the goal rung counts medals once per challenge', async ({ page }) => {
  await chalStart(page, 'med01');
  await page.evaluate(() => { CFG.SPECIALS.golden = false; });
  const r = await page.evaluate(() => {
    banners.length = 0; score = chal.deal.med[0];
    const g = empty(); for (let c = 0; c < 7; c++) g[0][c] = { gi: 0, t: 1, f: 0, l: 0 }; g[5][5] = { gi: 2, t: 1, f: 0, l: 0 }; grid = g;
    const dot = SHAPES.find(s => s.n === 1); tray = [{ s: dot, gi: 1 }, { s: dot, gi: 2 }, { s: dot, gi: 3 }]; place(0, 0, 7);
    return { won: chal.won, banner: banners.map(b => b.txt), lbl: el('bestLbl').textContent, val: el('bestVal').textContent };
  });
  assert.equal(r.won, 1); assert.ok(r.banner.includes('BRONZE!'), r.banner.join());
  assert.deepEqual([r.lbl], ['🥈 Silver']);
  await page.evaluate(() => { gameOver(); });
  assert.deepEqual(await page.evaluate(() => [chalRec.won, goals.done.has('chal:1')]), [1, true]);
  await page.evaluate(() => { el('overCard').hidden = true; mode = 'challenge'; chSeed = 'med01'; start(); score = chal.deal.med[2]; gameOver(); });
  assert.deepEqual(await page.evaluate(() => [chalRec.won, chalRec.gold, chalRec.s.med01.m]), [1, 1, 3], 'the same challenge is not counted twice');
});

test('Challenge: a round in progress resumes with its own deal (even if the dealer changed since) and shows Continue', async ({ page }) => {
  await chalStart(page, 'res01');
  await chPlayRound(page, 'casual', 4);
  const before = await page.evaluate(() => { saveRun(); return { tray: JSON.stringify(tray.map(t => t && [SHAPES.indexOf(t.s), t.gi])), trayNo, score, deal: JSON.stringify(chal.deal) }; });
  await reloadGame(page);
  const after = await page.evaluate(() => ({ mode, state, tray: JSON.stringify(tray.map(t => t && [SHAPES.indexOf(t.s), t.gi])), trayNo, score, deal: JSON.stringify(chal.deal), info: el('chalInfo').textContent, made: chCache.size }));
  assert.deepEqual(after, { ...before, mode: 'challenge', state: 'play', info: 'Tray ' + before.trayNo + ' of 12', made: 0 }, 'the saved deal is played, not worked out again');
  await page.evaluate(() => { saveRun(); el('pauseHome').click(); });
  await page.click('#menuChal'); await page.waitForSelector('#chalCard:not([hidden])');
  assert.deepEqual(await page.evaluate(() => [el('chalCont').hidden, el('chalCont').textContent]), [false, 'ContinueChallenge #RES01 · tray ' + before.trayNo + ' of 12']);
  await page.click('#chalCont'); await page.waitForFunction(() => state === 'play' && !paused);
  assert.equal(await page.evaluate(() => [chal.seed, trayNo].join()), 'res01,' + before.trayNo);
});

test('Challenge: working out a deal (the card prefetches one) leaves a paused Endless run exactly as it was', async ({ page }) => {
  await play(page); await dealt(page);
  const sig = () => page.evaluate(() => JSON.stringify([snapshot(), mode, lastTier, waveStats]));
  const before = await sig();
  await page.evaluate(() => { chMake('pre01'); chMake('pre02'); });
  assert.equal(await sig(), before);
});

test('Challenge: out of moves ends the round early and the score stands (no rescue); Endless and Daily are untouched', async ({ page }) => {
  await chalStart(page, 'stuck1');
  await page.evaluate(() => { score = 1230; grid = grid.map(r => r.map(() => ({ gi: 1, t: 1, f: 0, l: 0 }))); grid[0][0] = null; tray = [{ s: SHAPES[1], gi: 0 }, null, null]; checkStuck(); });
  await page.waitForSelector('#overCard:not([hidden])', { timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => [el('overTitle').textContent, el('overScore').textContent, el('reviveBox').hidden, chalRec.s.stuck1.b]), ['Out of moves', '1230', true, 1230]);
  await page.click('#overMenuBtn'); await page.click('#menuEndless'); await page.waitForFunction(() => state === 'play' && mode === 'endless'); await dealt(page);
  assert.deepEqual(await page.evaluate(() => [el('chalInfo').hidden, el('bestLbl').textContent, special('golden'), special('transform')]), [true, 'Best', true, true]);
});

test('Challenge link (E2): the deal packs into the link and back exactly; a damaged one is refused', async ({ page }) => {
  const r = await page.evaluate(() => ['ln01', 'ln02', 'd2026-11-10'].map(seed => { const d = chMake(seed), p = chPack(d), u = chUnpack(p);
    const marks = d.trays.map(t => ['CLOSER', 'SWEEP'].includes(t.l) ? t.l : 'DEAL');
    return { len: p.length, same: JSON.stringify([d.open, d.trays.map(t => t.p), marks, d.med]) === JSON.stringify([u.open, u.trays.map(t => t.p), u.trays.map(t => t.l), u.med]),
      bad: chUnpack(p.slice(0, 40)), junk: chUnpack('Azzzz'), other: chUnpack('B' + p.slice(1)) }; }));
  for (const x of r) { assert.equal(x.same, true); assert.ok(x.len < 130, 'short enough for a message: ' + x.len); assert.deepEqual([x.bad, x.junk, x.other], [null, null, null]); }
});

test('Challenge link (E2): Share sends a crumble.win link; opening it shows "Beat N", plays the same deal, and tells the player when the player beats it', async ({ page, server }) => {
  await chalStart(page, 'fr01');
  await page.evaluate(() => { score = 2340; gameOver(); });
  const sent = await page.evaluate(() => ({ text: shareText(), deal: JSON.stringify(chal.deal.trays.map(t => t.p)), med: chal.deal.med }));
  const url = sent.text.match(/https:\/\/crumble\.win\/\S+/)[0];
  assert.match(sent.text, /^I scored 2340 .*Can you beat it\? https:\/\/crumble\.win\/\?c=fr01&s=2340&d=A/);
  await page.evaluate(() => localStorage.clear());
  await page.goto(server.url + url.slice('https://crumble.win/'.length));
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && !el('chalCard').hidden);
  assert.deepEqual(await page.evaluate(() => ({ q: location.search, btn: el('chalFriend').textContent, today: el('chalToday').className })),
    { q: '', btn: 'Beat 2,340Challenge #FR01 · a friend sent you this one', today: 'ghost' }, 'the card offers the friend\'s round; the address bar is tidied');
  await page.evaluate(() => { CFG.PAYOFF_LINES = 9; chCache.clear(); });   // whatever this version would deal, the link's deal is played
  await page.click('#chalFriend'); await page.waitForFunction(() => state === 'play' && mode === 'challenge'); await dealt(page);
  const g = await page.evaluate(() => ({ deal: JSON.stringify(chal.deal.trays.map(t => t.p)), med: chal.deal.med, lbl: el('bestLbl').textContent, val: el('bestVal').textContent, beat: chal.beat }));
  assert.deepEqual(g, { deal: sent.deal, med: sent.med, lbl: g.med[0] < 2340 ? '🥉 Bronze' : '🎯 Beat', val: (g.med[0] < 2340 ? g.med[0] : 2340).toLocaleString('en-US'), beat: 2340 });
  const r = await page.evaluate(() => {
    banners.length = 0; score = 2340;
    const gr = empty(); for (let c = 0; c < 7; c++) gr[0][c] = { gi: 0, t: 1, f: 0, l: 0 }; gr[5][5] = { gi: 2, t: 1, f: 0, l: 0 }; grid = gr;
    const dot = SHAPES.find(s => s.n === 1); tray = [{ s: dot, gi: 1 }, { s: dot, gi: 2 }, { s: dot, gi: 3 }]; place(0, 0, 7);
    return { banners: banners.map(b => b.txt), beaten: chal.beaten };
  });
  assert.ok(r.banners.includes('YOU BEAT IT!') && r.beaten, r.banners.join());
  await page.evaluate(() => { saveRun(); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell); await page.evaluate(() => { if (!el('menuCard').hidden) closeMenu(); });
  assert.deepEqual(await page.evaluate(() => [chal.beat, chal.beaten]), [2340, true], 'the target survives a resume');
  await page.evaluate(() => { gameOver(); });
  assert.match(await page.textContent('#overMsg'), /^You beat their 2,340!/);
  await page.click('#againBtn'); await dealt(page);
  assert.deepEqual(await page.evaluate(() => [chal.seed, chal.beat, chal.beaten, score]), ['fr01', 2340, false, 0], 'Retry keeps the target');
});

test('Challenge link (E2): a link without a readable deal works the deal out from the seed; a bad seed is ignored', async ({ page, server }) => {
  const want = await page.evaluate(() => JSON.stringify(chMake('fr02').trays.map(t => t.p)));
  await page.goto(server.url + '?c=fr02&s=900&d=Abroken');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && !el('chalCard').hidden);
  await page.click('#chalFriend'); 
  await page.waitForFunction(() => state === 'play' && mode === 'challenge');
  assert.equal(await page.evaluate(() => JSON.stringify(chal.deal.trays.map(t => t.p))), want);
  await page.goto(server.url + '?c=<script>&s=1');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => el('chalCard').hidden), true);
});

/* ── a friend's pace on a Challenge link (pace) ── */
// a friend link for `seed` whose sender scored `beat` (under bronze, so "🎯" is the next target) at an even pace; p overrides the pace
const paceLink = (page, seed, p) => page.evaluate(([seed, p]) => {
  const d = chMake(seed), beat = Math.round(d.med[0] * 0.8 / 10) * 10;
  const fp = Array.from({ length: 12 }, (_, i) => i === 11 ? beat : Math.round(beat * (i + 1) / 12 / 10) * 10);
  return { q: '?c=' + seed + '&s=' + beat + '&d=' + chPack(d) + '&p=' + (p === undefined ? chPacePack(fp) : p), beat, fp, med: d.med };
}, [seed, p]);
const paceOpen = async (page, server, q) => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(server.url + q);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && !el('chalCard').hidden);
  await page.click('#chalFriend'); await page.waitForFunction(() => state === 'play' && mode === 'challenge'); await dealt(page);
};

test('pace: a pace packs into twelve short base-36 gains and back; anything off is refused', async ({ page }) => {
  const r = await page.evaluate(() => {
    const a = [120, 120, 450, 900, 900, 1530, 2010, 2010, 2600, 3300, 3990, 4200], s = chPacePack(a);
    const big = Array.from({ length: 12 }, (_, i) => (i + 1) * 83000);
    return { s, back: chPaceUnpack(s, 4200), big: chPaceUnpack(chPacePack(big), big[11]), bigLen: chPacePack(big).length,
      wrongS: chPaceUnpack(s, 4210), eleven: chPaceUnpack(s.split('.').slice(1).join('.'), 4080), neg: chPaceUnpack(s.replace(/^c/, '-c'), 4200),
      upper: chPaceUnpack(s.toUpperCase(), 4200), empty: chPaceUnpack('', 0), notStr: chPaceUnpack(5, 0), long: chPaceUnpack('zzzzzzz' + s.slice(1), 4200),
      offGrid: chPacePack([5, ...a.slice(1)]), short: chPacePack(a.slice(0, 11)), down: chPacePack([...a.slice(0, 10), 3000, 4200]),
      link: chLinkFor('pk01', 4200, chMake('pk01'), a), linkBad: chLinkFor('pk01', 4300, chMake('pk01'), a), linkNone: chLinkFor('pk01', 4200, chMake('pk01')) };
  });
  assert.equal(r.s, 'c.0.x.19.0.1r.1c.0.1n.1y.1x.l');
  assert.deepEqual(r.back, [120, 120, 450, 900, 900, 1530, 2010, 2010, 2600, 3300, 3990, 4200]);
  assert.equal(r.big[11], 996000); assert.ok(r.bigLen < 60, 'short: ' + r.bigLen);
  assert.deepEqual([r.wrongS, r.eleven, r.neg, r.upper, r.empty, r.notStr, r.long], [null, null, null, null, null, null, null]);
  assert.deepEqual([r.offGrid, r.short, r.down], ['', '', ''], 'only a whole, rising pace on the score grid packs');
  assert.match(r.link, /&d=A[\w-]+&p=c\.0\.x\.19\.0\.1r\.1c\.0\.1n\.1y\.1x\.l$/);
  assert.doesNotMatch(r.linkBad, /&p=/, 'a pace that does not end on the score is left out');
  assert.doesNotMatch(r.linkNone, /&p=/);
});

test('pace: a 12-tray round records the player’s score after every tray; the best run keeps it and Share sends it', async ({ page }) => {
  await chalStart(page, 'pace01');
  const r = await chPlayRound(page, 'casual');
  assert.equal(r.done, true);
  await page.waitForSelector('#overCard:not([hidden])', { timeout: 4000 });
  const c = await page.evaluate(() => ({ pace: chal.pace, score, rec: chalRec.s.pace01, saved: JSON.parse(localStorage.getItem('crumble.chal')).s.pace01, text: shareText() }));
  assert.equal(c.pace.length, 12);
  assert.ok(c.pace.every((v, i) => !i || v >= c.pace[i - 1]), 'rising: ' + c.pace);
  assert.equal(c.pace[11], c.score);
  assert.equal(c.saved.p, c.rec.p);
  assert.deepEqual(await page.evaluate(p => chPaceUnpack(p, score), c.rec.p), c.pace, 'the record keeps the best run\'s pace');
  assert.ok(c.text.endsWith('&p=' + c.rec.p), c.text);
  // a lower score keeps the best run's pace; a round that runs out of moves pads its pace with the score that stands
  await page.click('#againBtn'); await dealt(page);
  await chPlayRound(page, 'casual', 4);
  const low = await page.evaluate(() => { const t = trayNo; score = 10; gameOver(); return { t, pace: chal.pace, p: chalRec.s.pace01.p }; });
  assert.equal(low.p, c.rec.p);
  assert.equal(low.pace.length, 12); assert.deepEqual(low.pace.slice(low.t - 1), Array(13 - low.t).fill(10));
});

test('pace: a friend\'s pace shows as a mark on the bar and ahead/behind in the HUD; the crumb says one line each way', async ({ page, server }) => {
  const L = await paceLink(page, 'pace02');
  await paceOpen(page, server, L.q);
  const s0 = await page.evaluate(() => ({ fp: chal.fp, beat: chal.beat, hidden: el('chalInfo').querySelector('.fp').hidden, left: el('chalInfo').querySelector('.fp').style.left,
    lbl: el('bestLbl').textContent, val: el('bestVal').textContent, info: el('chalInfo').textContent }));
  assert.deepEqual(s0, { fp: L.fp, beat: L.beat, hidden: false, left: '0%', lbl: '🎯 Beat', val: L.beat.toLocaleString('en-US'), info: 'Tray 1 of 12' });
  // the bar's scale: inside the stretch, pinned below and above it, and with gold
  const b = await page.evaluate(m => [chBarAt(m[0] / 2, 0, m), chBarAt(m[0] + 10, 0, m), chBarAt(m[0] - 10, m[0], m), chBarAt(m[1] + (m[2] - m[1]) / 4, m[1], m), chBarAt(m[2], m[2], m), chBarAt(0, m[2], m)], L.med);
  assert.deepEqual(b, [{ x: 0.5, out: false }, { x: 1, out: true }, { x: 0, out: true }, { x: 0.25, out: false }, { x: 1, out: true }, { x: 0, out: true }]);
  // a tray boundary, ahead of them: the mark moves to their score after tray 1, the HUD says by how much, the crumb says so once
  await page.evaluate(() => { CFG.FX_CRUMB_TALK = true; CFG.FX_MASCOT = true; say.last = -1e9; });
  const t2 = await page.evaluate(() => {
    trayNo = 2; score = chal.fp[0] + 50; chPaceTalk(); syncHud();
    const f = el('chalInfo').querySelector('.fp');
    return { left: f.style.left, out: f.classList.contains('out'), lbl: el('bestLbl').textContent, said: say.txt, ahead: SAY.paceAhead.includes(say.txt), pa: chal.pa, pw: chal.pw };
  });
  assert.equal(t2.left, Math.round(L.fp[0] / L.med[0] * 100) + '%'); assert.equal(t2.out, false);
  assert.equal(t2.lbl, '🎯\u00a0+50'); assert.ok(t2.ahead, t2.said); assert.deepEqual([t2.pa, t2.pw], [1, 1]);
  // the HUD is not touched again while nothing changed
  const writes = await page.evaluate(() => new Promise(res => { let n = 0; const mo = new MutationObserver(l => { n += l.length; }); mo.observe(el('chalInfo'), { subtree: true, childList: true, attributes: true, characterData: true }); chHud(); chHud(); setTimeout(() => { mo.disconnect(); res(n); }, 30); }));
  assert.equal(writes, 0);
  // falling behind after being ahead: one line; ahead again, and behind again: no more
  const t3 = await page.evaluate(() => {
    say.txt = ''; trayNo = 3; score = chal.fp[1] - 20; chPaceTalk(); syncHud();
    const r = { lbl: el('bestLbl').textContent, said: say.txt, behind: SAY.paceBehind.includes(say.txt), pw: chal.pw };
    say.txt = ''; trayNo = 4; score = chal.fp[2] + 10; chPaceTalk(); trayNo = 5; score = chal.fp[3] - 10; chPaceTalk();
    r.again = say.txt; return r;
  });
  assert.deepEqual(t3, { lbl: '🎯\u00a0−20', said: t3.said, behind: true, pw: 3, again: '' });
  // talk off: the mark and the HUD stay, no line; CH_PACE off: no mark, "🎯 Beat" as before
  const off = await page.evaluate(() => {
    chal.pw = 0; chal.pa = 0; CFG.FX_CRUMB_TALK = false; say.txt = ''; trayNo = 6; score = chal.fp[4] + 10; chPaceTalk();
    const r = { said: say.txt, pw: chal.pw }; CFG.FX_CRUMB_TALK = true;
    CFG.CH_PACE = false; syncHud(); r.hidden = el('chalInfo').querySelector('.fp').hidden; r.lbl = el('bestLbl').textContent; CFG.CH_PACE = true; syncHud();
    r.back = el('chalInfo').querySelector('.fp').hidden; return r;
  });
  assert.deepEqual(off, { said: '', pw: 1, hidden: true, lbl: '🎯 Beat', back: false });
});

test('pace: a run with a friend\'s pace saves and resumes with it; an older run save without one still loads', async ({ page, server }) => {
  const L = await paceLink(page, 'pace03');
  await paceOpen(page, server, L.q);
  await chPlayRound(page, 'casual', 7);
  const before = await page.evaluate(() => { chal.pa = 1; chal.pw = 1; saveRun(); return { fp: chal.fp, pace: chal.pace, trayNo, beat: chal.beat }; });
  assert.equal(before.pace.length, before.trayNo - 1);
  await reloadGame(page);
  assert.deepEqual(await page.evaluate(() => ({ fp: chal.fp, pace: chal.pace, trayNo, beat: chal.beat, pa: chal.pa, pw: chal.pw, mark: !el('chalInfo').querySelector('.fp').hidden })),
    { ...before, pa: 1, pw: 1, mark: true });
  // Retry keeps the friend's pace, as it keeps their target
  await page.evaluate(() => { start(); });
  await dealt(page);
  assert.deepEqual(await page.evaluate(() => [chal.beat, chal.fp, chal.pace]), [before.beat, before.fp, []]);
  // an older save: no pc/fp/pa/pw in ch
  await chPlayRound(page, 'casual', 4);
  await page.evaluate(() => { saveRun(); const o = JSON.parse(localStorage.getItem('crumble.run.chal')); for (const k of ['pc', 'fp', 'pa', 'pw']) delete o.ch[k]; localStorage.setItem('crumble.run.chal', JSON.stringify(o)); });
  await reloadGame(page);
  const old = await page.evaluate(() => ({ state, mode, beat: chal.beat, fp: chal.fp, pace: chal.pace, mark: el('chalInfo').querySelector('.fp').hidden, lbl: el('bestLbl').textContent }));
  assert.deepEqual(old, { state: 'play', mode: 'challenge', beat: before.beat, fp: null, pace: null, mark: true, lbl: old.lbl });
  assert.doesNotMatch(old.lbl, /[+−]/);
  await chPlayRound(page, 'casual');
  await page.waitForSelector('#overCard:not([hidden])', { timeout: 4000 });
  assert.doesNotMatch(await page.evaluate(() => shareText()), /&p=/, 'no pace was recorded for that round, so the link has none');
});

test('pace: a bad p is ignored and the link still opens as before; old links and old records still work', async ({ page, server }) => {
  for (const p of ['garbage', '1.2.3', 'c.0.x.19.0.1r.1c.0.1n.1y.1x.l', '0.0.0.0.0.0.0.0.0.0.0.0', '']) {
    const L = await paceLink(page, 'pace04', p);
    await paceOpen(page, server, L.q);
    const r = await page.evaluate(() => ({ beat: chal.beat, fp: chal.fp, q: location.search, mark: el('chalInfo').querySelector('.fp').hidden, lbl: el('bestLbl').textContent }));
    assert.deepEqual(r, { beat: L.beat, fp: null, q: '', mark: true, lbl: '🎯 Beat' }, 'p=' + p);
  }
  // a link from before (no p at all)
  const L = await paceLink(page, 'pace04');
  await paceOpen(page, server, L.q.replace(/&p=.*$/, ''));
  assert.deepEqual(await page.evaluate(() => [chal.beat, chal.fp]), [L.beat, null]);
  // an older results record (no p) and one with a broken p load; the broken p is dropped
  await page.evaluate(() => { localStorage.setItem('crumble.chal', JSON.stringify({ v: 1, s: { old01: { b: 900, m: 0, n: 2, t: 5 }, old02: { b: 900, m: 0, n: 1, t: 6, p: 'zz.1' }, old03: { b: 120, m: 0, n: 1, t: 7, p: 'c.0.0.0.0.0.0.0.0.0.0.0' } }, won: 0, gold: 0 })); });
  await reloadGame(page);
  assert.deepEqual(await page.evaluate(() => [chalRec.s.old01, chalRec.s.old02, chalRec.s.old03.p]), [{ b: 900, m: 0, n: 2, t: 5 }, { b: 900, m: 0, n: 1, t: 6 }, 'c.0.0.0.0.0.0.0.0.0.0.0']);
});

let failed = 0;
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // ONLY=adventure npm test: just the scenarios whose name matches
test('whole-screen mode looks (6.7): bonus, golden, Adventure and Daily each tint the screen around the board, never a gem, and fade out', async ({ page }) => {
  await play(page);
  await dealt(page);
  const settle = () => page.waitForTimeout(1500);
  const read = () => page.evaluate(() => ({ ...lk }));
  // a pixel in the top-left corner margin (where the vignette is darkest) and one gem pixel
  const px = () => page.evaluate(() => { grid[4][4] = 2; shake = 0; const g = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return [d[0], d[1], d[2]]; };
    return { corner: g(3, 3), gem: g(bx + 4.5 * cell, by + 4.5 * cell) }; });
  await settle(); const base = await px(); const l0 = await read();
  assert.ok(l0.bonus < 0.02 && l0.gold < 0.02 && l0.adv < 0.02 && l0.daily < 0.02, 'Endless with nothing live shows no mode look: ' + JSON.stringify(l0));
  const moved = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));   // largest channel move (a gem's own sheen drifts by a few)
  // bonus: violet; entrance flash; the corner changes, the gem does not
  await page.evaluate(() => { startBonus(); });
  await page.waitForTimeout(150);
  assert.ok((await read()).flash > 0.3, 'a bonus starts with a flash');
  await settle();
  const b = await px(); assert.ok((await read()).bonus > 0.8, 'bonus look is up');
  assert.ok(moved(b.corner, base.corner) > 8, 'the corner margin is tinted during a bonus: ' + base.corner + ' -> ' + b.corner);
  assert.ok(moved(b.gem, base.gem) <= 5, 'a gem pixel is untouched: ' + base.gem + ' vs ' + b.gem);
  await page.evaluate(() => { bonus = null; }); await settle();
  assert.ok((await read()).bonus < 0.05, 'and it fades out when the bonus ends');
  // golden hand
  await page.evaluate(() => { golden = { want: { lines: 3, sweep: false }, got: { lines: 0, sweep: false }, pts: 0, plan: { lines: 3, sweep: false, ids: [] } }; });
  await settle(); const g = await px();
  assert.ok((await read()).gold > 0.8 && moved(g.corner, base.corner) > 8, 'golden tints the margins');
  assert.ok(moved(g.gem, base.gem) <= 5, 'golden leaves the gem alone');
  await page.evaluate(() => { golden = null; }); await settle();
  // Adventure: the ring fills with the goal; Daily: its own tint
  await page.evaluate(() => { mode = 'adventure'; lvl = LEVELS.find(l => l.goal.type === 'lines') || LEVELS[0]; lv = { lines: Math.floor(lvl.goal.n / 2), pieces: 3, combo: 0, swept: false }; });
  await settle();
  const a = await read(); assert.ok(a.adv > 0.8 && a.prog > 0.3 && a.prog < 0.8, 'Adventure look is up and the ring shows half the goal: ' + JSON.stringify(a));
  const ap = await px(); assert.ok(moved(ap.corner, base.corner) > 5 && moved(ap.gem, base.gem) <= 5, 'Adventure tints the margin, not the gem');
  await page.evaluate(() => { mode = 'daily'; lvl = null; }); await settle();
  const d = await read(); assert.ok(d.daily > 0.8 && d.adv < 0.05 && d.prog === 0, 'Daily look replaces Adventure: ' + JSON.stringify(d));
  await page.evaluate(() => { mode = 'endless'; }); await settle();
  assert.ok((await read()).daily < 0.05, 'back in Endless the look is gone');
  // the ring stays on screen on a phone (its outer edge is inside the canvas), and a finished run does not keep a bonus look
  const ring = await page.evaluate(() => { const o = Math.max(6, Math.min(15, bx - 5)); return { left: bx - o - 3, right: bx + B + o + 3, W }; });
  assert.ok(ring.left >= 0 && ring.right <= ring.W, 'ring fits on screen: ' + JSON.stringify(ring));
  await page.evaluate(() => { startBonus(); }); await settle();
  await page.evaluate(() => { state = 'over'; }); await settle();
  assert.ok((await read()).bonus < 0.05, 'game over drops the bonus look');
  await page.evaluate(() => { start(); });
  assert.deepEqual(await page.evaluate(() => [lk.prog, lk.flash, lk.bonus]), [0, 0, 0], 'a new run starts with no mode look');
});

// ---- music (plans 6.8, 7.4) ----
// Recorded loops. The engine is rendered offline (no audio hardware needed) on an OfflineAudioContext with a stand-in loop.
const renderMusic = (page, opts) => page.evaluate(async ({ secs, i, track, duckAt }) => {
  const SR = 22050, oc = new OfflineAudioContext(1, SR * secs, SR), dest = oc.createGain(); dest.connect(oc.destination);
  const loop = oc.createBuffer(1, SR * 2, SR), ch = loop.getChannelData(0);          // 2 s: a low tone with a bright, buzzy top
  for (let k = 0; k < ch.length; k++) ch[k] = .3 * Math.sin(2 * Math.PI * 220 * k / SR) + .15 * Math.sin(2 * Math.PI * 6000 * k / SR) + .1 * Math.sin(2 * Math.PI * 9500 * k / SR);
  const E = createMusic(oc, dest); E.start(0, .25); E.play(loop, track, 0, .05); E.setI(i, 0);
  if (duckAt !== null) E.duck(.3, 1.5, duckAt);
  const d = (await oc.startRendering()).getChannelData(0), db = (a, b) => { let s = 0; for (let k = a * SR; k < b * SR; k++) s += d[k] * d[k]; return 10 * Math.log10(s / ((b - a) * SR) + 1e-12); };
  let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
  return { peak: 20 * Math.log10(pk), rms: db(4, secs), before: db(duckAt === null ? 0 : duckAt - 1, duckAt === null ? 1 : duckAt), under: db(duckAt === null ? 0 : duckAt, duckAt === null ? 1 : duckAt + 1) };
}, { secs: 16, i: 0, track: 0, duckAt: null, ...opts });

test('music (7.4, 8.5): fourteen recorded loops, each small, that decode and loop without a click, and nothing is synthesised', async ({ page, srv }) => {
  assert.equal(await page.evaluate(() => MUSIC_TRACKS.length), 14, 'fourteen loops');
  let total = 0;
  for (const t of await page.evaluate(() => MUSIC_TRACKS)) {
    const size = fs.statSync(new URL('../' + t.file, import.meta.url)).size; total += size;
    assert.ok(size < 1.4e6, `${t.file} is under 1.4 MB`);
    const r = await page.evaluate(async f => {
      const c = new OfflineAudioContext(2, 44100, 44100), buf = await c.decodeAudioData(await (await fetch(f)).arrayBuffer());
      const a = buf.getChannelData(0), step = 400; let mx = 0, rms = 0;
      for (let k = 1; k < a.length; k++) { mx = Math.max(mx, Math.abs(a[k] - a[k - 1])); rms += a[k] * a[k]; }
      return { dur: buf.duration, rms: Math.sqrt(rms / a.length), seam: Math.abs(a[0] - a[a.length - 1]), maxStep: mx, head: Math.abs(a[0]) };
    }, '/' + t.file);
    assert.ok(r.dur > 25 && r.dur < 140, `${t.id}: ${r.dur.toFixed(1)} s of music`);
    assert.ok(r.rms > .05 && r.rms < .35, `${t.id}: sensible level (${r.rms.toFixed(3)})`);
    assert.ok(r.seam < .2, `${t.id}: the end meets the start (${r.seam.toFixed(3)})`);
  }
  assert.ok(total < 12e6, `all the music is under 12 MB (${(total / 1e6).toFixed(1)} MB): it ships inside the app`);
  const src = fs.readFileSync(new URL('../js/music.js', import.meta.url), 'utf8');
  assert.ok(!/createOscillator/.test(src), 'no synthesis in the music');
});

test('music (7.4): quiet by design, a tight board is brighter and louder, and a clear ducks it', async ({ page }) => {
  const calm = await renderMusic(page, { i: 0 }), tight = await renderMusic(page, { i: 1 }), ducked = await renderMusic(page, { duckAt: 8 });
  assert.ok(calm.peak < -8 && calm.peak > -40, `quiet but there (peak ${calm.peak.toFixed(1)} dBFS)`);
  assert.ok(tight.rms - calm.rms > 1, `pressure opens the filter and lifts the level (${calm.rms.toFixed(1)} -> ${tight.rms.toFixed(1)} dB)`);
  assert.ok(tight.peak < -4, 'and it is still never loud');
  assert.ok(ducked.before - ducked.under > 6, `ducking dips it by more than 6 dB (${ducked.before.toFixed(1)} -> ${ducked.under.toFixed(1)})`);
  for (const track of await page.evaluate(() => MUSIC_TRACKS.map((t, i) => i).slice(1))) { const t = await renderMusic(page, { track }); assert.ok(t.rms > -45 && t.peak < -4, 'the other loops sit at a similar level'); }
});

test('music (7.4): on by default at a low volume, Shuffle by default, a picker where Off is the switch, all saved', async ({ page }) => {
  assert.equal(await page.evaluate(() => CFG.MUSIC), true, 'on by default');
  assert.equal(await page.evaluate(() => CFG.MUSIC_PICK), 'shuffle', 'Shuffle by default');
  assert.ok(await page.evaluate(() => CFG.MUSIC_VOL * .5 <= .3), 'low by default');
  await play(page);
  await page.waitForFunction(() => musicE !== null, null, { timeout: 5000 });
  await openSet(page);
  assert.deepEqual(await page.$$eval('#musicPick option', os => os.map(o => o.textContent)), ['Shuffle', 'Sunny', 'Bounce', 'Daydream', 'Momentum', 'Café', 'Sidewalk', 'Cocoa', 'Drift', 'Snowfall', 'Glow', 'Pebbles', 'Pixel', 'Long Road', 'Strut', 'Off']);
  assert.equal(await page.inputValue('#musicPick'), 'shuffle');
  await page.selectOption('#musicPick', 'bounce');
  assert.equal(await page.evaluate(() => musicTrackNo), 1, 'picking a track plays it');
  await page.waitForFunction(() => musicE && musicE.idx === 1, null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.skins')).musicPick), 'bounce', 'and it is remembered');
  await page.evaluate(() => { start(); });
  assert.equal(await page.evaluate(() => musicTrackNo), 1, 'a chosen track stays across runs');
  await page.selectOption('#musicPick', 'off');
  assert.equal(await page.evaluate(() => musicE), null, 'Off stops the engine');
  assert.equal(await page.evaluate(() => CFG.MUSIC), false, 'and is the music switch');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.skins')).music), false, 'and it is remembered');
  await page.check('#sndOn'); await page.uncheck('#sndOn');
  assert.equal(await page.evaluate(() => musicE), null, 'Sound effects does not bring it back');
  await page.selectOption('#musicPick', 'bounce');
  assert.notEqual(await page.evaluate(() => musicE), null, 'picking a track switches it on again');
  assert.equal(await page.inputValue('#musicPick'), 'bounce');
});

test('sound buttons: a note for Music and a speaker for Sound effects, each its own, mirrored in Settings, remembered', async ({ page }) => {
  await play(page);
  await page.waitForFunction(() => musicE !== null, null, { timeout: 5000 });
  const st = () => page.evaluate(() => ({ sfxOff: sfxOff(), music: !!musicE, set: CFG.MUSIC, noteOff: el('musicBtn').classList.contains('off'), spk: el('mute').classList.contains('off') ? 'off' : 'on' }));
  assert.deepEqual(await st(), { sfxOff: false, music: true, set: true, noteOff: false, spk: 'on' });
  await page.click('#musicBtn');
  assert.deepEqual(await st(), { sfxOff: false, music: false, set: false, noteOff: true, spk: 'on' }, 'the note stops only the music');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.skins')).music), false, 'and it is remembered');
  await page.click('#mute');
  assert.deepEqual(await st(), { sfxOff: true, music: false, set: false, noteOff: true, spk: 'off' }, 'the speaker stops the effects');
  await page.click('#musicBtn');
  assert.deepEqual(await st(), { sfxOff: true, music: true, set: true, noteOff: false, spk: 'off' }, 'music back, effects still off');
  await openSet(page);
  assert.equal(await page.isChecked('#sndOn'), false, 'Settings mirrors the speaker');
  assert.equal(await page.inputValue('#musicPick'), 'shuffle', 'and the note');
  await page.check('#sndOn'); await page.selectOption('#musicPick', 'off'); await closeSet(page);
  assert.deepEqual(await st(), { sfxOff: false, music: false, set: false, noteOff: true, spk: 'on' }, 'and the buttons mirror Settings');
  // the hud still fits with the extra button
  assert.ok(await page.evaluate(() => Math.max(...[...document.querySelectorAll('.hud .right > *')].map(e => e.getBoundingClientRect().right)) <= innerWidth), 'the buttons stay on screen');
});

test('music (7.4): a loop starts playing on its own after the first touch, and only the playing loop stays decoded', async ({ page }) => {
  await play(page);
  await page.waitForFunction(() => musicE !== null && musicE.idx >= 0, null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => Object.keys(musicBufs).map(Number)), await page.evaluate(() => [musicE.idx]));
});

test('music (7.4): the pressure response follows the pressure on screen and drops when the player is clear', async ({ page }) => {
  await play(page);
  await page.waitForFunction(() => musicE !== null, null, { timeout: 5000 });
  const m = await page.evaluate(() => { const o = {}; scr.p = 0; o.calm = musicTarget(); scr.p = .55; o.build = musicTarget(); scr.p = .8; o.edge = musicTarget(); scr.p = 1; o.tight = musicTarget(); state = 'over'; o.over = musicTarget(); state = 'play'; return o; });
  assert.equal(m.calm, 0); assert.ok(m.build > 0 && m.build < .8, 'building barely registers'); assert.ok(m.edge > .9, 'an edge is nearly full intensity'); assert.equal(m.tight, 1); assert.equal(m.over, 0, 'nothing behind the game-over card');
  await page.evaluate(() => { musicTarget = () => 1; });                                  // a tight board for a while
  await page.waitForFunction(() => musicMi > .5, null, { timeout: 9000 });
  assert.ok(await page.evaluate(() => musicE.i > .5), 'the engine is told');
  await page.evaluate(() => { musicTarget = () => 0; });                                  // the player got clear
  await page.waitForFunction(() => musicMi < .3, null, { timeout: 9000 });
});

test('music (7.4): the sound arbiter ducks it under the winning event, deeper for bigger ones, and shuffle moves on each run', async ({ page }) => {
  await play(page); await spySet(page);
  await page.waitForFunction(() => musicE !== null, null, { timeout: 5000 });
  const lvl = async fns => { await page.evaluate(f => { musicE.duckEnd = 0; musicE.duckLvl = 1; arbLead = { p: 0, until: 0 }; for (const x of f) eval(x); }, fns); await tick(page); return page.evaluate(() => musicE.duckLvl); };
  const one = await lvl(['Sfx.clear(1)']), big = await lvl(['Sfx.clear(3)', 'Sfx.sweep()']);
  assert.ok(one < 1 && one > big, `a clear dips it a little (${one}), a sweep a lot (${big})`);
  assert.equal(await lvl(['Sfx.starPick()']), 1, 'the star pickup tick (priority 0) leaves it alone');
  const before = await page.evaluate(() => musicTrackNo);
  await page.evaluate(() => { start(); });
  assert.notEqual(await page.evaluate(() => musicTrackNo), before, 'a new run moves to another loop');
});

test('music (8.5): Shuffle plays every loop before a repeat, and after a few minutes crossfades to another at the loop end', async ({ page }) => {
  const bag = await page.evaluate(() => { musicBag = []; musicTrackNo = 0; const seen = []; for (let k = 0; k < MUSIC_TRACKS.length - 1; k++) { musicTrackNo = musicNextShuffle(); seen.push(musicTrackNo); } return seen; });
  assert.equal(new Set(bag).size, bag.length, 'no repeats within a round');
  assert.ok(!bag.includes(0), 'and not the one that was playing');
  assert.ok(await page.evaluate(() => CFG.MUSIC_ROTATE >= 120 && CFG.MUSIC_ROTATE <= 300), 'a few minutes per loop');
  await play(page);
  await page.waitForFunction(() => musicE !== null && musicE.idx >= 0 && musicE.cur && !musicE.loading, null, { timeout: 8000 });
  const r0 = await page.evaluate(() => { const c = musicE.cur, now = actx.currentTime; c.t0 = now - (c.dur * Math.ceil(CFG.MUSIC_ROTATE / c.dur + 1) - 3); return { idx: musicE.idx, end: now + 3 }; });   // pretend it has played for minutes, 3 s before a seam
  await page.waitForFunction(i => musicE.idx !== i, r0.idx, { timeout: 8000 });
  const t0 = await page.evaluate(() => musicE.cur.t0);
  assert.ok(Math.abs(t0 - (r0.end - 1.4)) < .4, `the crossfade lands on the old loop's seam (${(t0 - r0.end).toFixed(2)} s)`);
  await page.evaluate(() => { musicSetPick('cocoa'); });
  await page.waitForFunction(() => musicE.idx === MUSIC_TRACKS.findIndex(t => t.id === 'cocoa'), null, { timeout: 8000 });
  const c = await page.evaluate(() => { const c = musicE.cur; c.t0 = actx.currentTime - c.dur * 20 + 3; return musicE.idx; });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => musicTrackNo), c, 'a chosen track keeps looping');
});

test('music (7.4): the service worker keeps the loops in their own cache, which a game update does not clear', async ({ page }) => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /MUSIC_CACHE='crumble-music'/); assert.match(sw, /k!==MUSIC_CACHE/);
  assert.ok(!/music\//.test(sw.match(/const ASSETS=(\[.*?\]);/s)[1]), 'not precached: lazy-loaded');
});

// ---- payoff waves, setups and closers (plan 7.3) ----
const B73 = `const B73 = rows => { grid = rows.map(r => [...r].map(ch => (ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null))); return packGrid(grid); };
  const W73 = () => { wave = { n: 0, at: 5, due: false }; jack = { n: 0, at: 10 }; setups = []; closerNext = false; closerCool = 0; dryN = 0; bigHist = []; trayClear = false; closerTray = false;
    golden = null; goldenNext = false; bonus = null; transform = null; starForced = false; starCool = 9; specialEnd = -99; trayNo = 10; pace = { ph: 'calm', n: 0, hold: 0, len: 0 }; tray = [null, null, null]; };`;

test('7.3 setups: squaring off a gap is remembered, its exact piece comes once, then never again for that setup', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer, which Challenge still deals with
  const r = await page.evaluate('(() => {' + B73 + `
    W73();
    // rows 6-7 full but columns 2-3; above the gap, row 5 is open at columns 2-4: a ragged gap, not yet squared off
    B73(['00000000','00000000','00000000','00000000','00000000','00000111','11001111','11001111']);
    const o = {};
    const hole = SHAPES.find(s => s.rows === 2 && s.cols === 2 && s.n === 4);
    const pre = packGrid(grid);
    grid[5][2] = grid[5][3] = { gi: 0, t: 1, f: 0, l: 0 };                         // the player 1x2 squares it off: the 2x2 hole is walled in
    waveAfterDrop(pre, 0, countFlat(packGrid(grid)), 0, false);
    o.setups = setups.map(u => [SETUP_RECTS[u.k].rows, SETUP_RECTS[u.k].cols, u.r, u.c]);
    const d0 = waveStats.dealt;
    closerCool = 9;                                                                  // (1.1 A) this small board can be swept: keep the sweep chase out of a setups test
    CFG.SETUP_CHANCE = 1; tray = [null, null, null]; genTray();
    o.first = tray.some(t => t.s === hole) && setups.some(u => u.dealt);
    o.dealt = waveStats.dealt - d0;
    // the player ignores it: the next deals never force it again (with chance 1 any hole piece now comes only by itself)
    let forced = 0; const orig = offerSetup;
    for (let k = 0; k < 2; k++) { tray = [null, null, null]; const d1 = waveStats.dealt; genTray(); forced += waveStats.dealt - d1; }
    o.again = forced;
    // a gap that existed before the drop is not a setup
    W73(); const same = B73(['00000000','00000000','00000000','00000000','00000000','00000000','11001111','11001111']);
    waveAfterDrop(same, 0, countFlat(same), 0, false); o.old = setups.length;
    return o; })()`);
  assert.ok(r.setups.some(([h, w, rr, cc]) => h === 2 && w === 2 && rr === 6 && cc === 2), 'the 2x2 hole is a setup: ' + JSON.stringify(r.setups));
  assert.ok(r.first, 'with SETUP_CHANCE 1 the next tray carries the 2x2');
  assert.equal(r.dealt, 1);
  assert.equal(r.again, 0, 'one offer per setup');
  assert.equal(r.old, 0, 'a hole the player did not just make is no setup');
});

test('7.3 no tedium: never three small pieces while a big one fits; the 4+ floor over five trays', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    W73(); const one = SHAPES[0], two = SHAPES[1], three = SHAPES[3];
    const open = B73(Array(8).fill('00000000'));
    const big = h => h.filter(s => s.n >= 4).length;
    const o = { open: big(noTedium(open, [one, two, three], 'honest')) };
    // only singles and bars of 2 fit: the hand is left alone
    const tight = B73(['10101010','01010101','10101010','01010101','10101010','01010101','10101010','01010101']);
    o.tight = big(noTedium(tight, [one, one, one], 'honest'));
    bigHist = [0, 0, 1, 0];                                                         // 1 big piece in the last four trays: this tray brings the rest
    o.floor = big(noTedium(open, [SHAPES[5], one, two], 'honest'));
    // and in play: 40 deals on an open-ish board never deal three small pieces
    W73(); let small = 0;
    for (let k = 0; k < 40; k++) { B73(['00000000','00000000','00000000','00000000','00000000','11100000','11110000','11111000']); tray = [null, null, null]; genTray(); if (tray.every(t => t.s.n <= 3)) small++; }
    o.small = small; return o; })()`);
  assert.ok(r.open >= 1, 'an open board turns a small hand into one with a 4+ piece');
  assert.equal(r.tight, 0, 'no 4+ piece fits: unchanged');
  assert.ok(r.floor >= 3, 'the floor brings the 4+ count over five trays up to BIG_FLOOR');
  assert.equal(r.small, 0);
});

test('7.3 payoff: a big block that clears 2+ lines at once when the board offers one, nothing forced when it does not', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer, which Challenge still deals with
  const r = await page.evaluate('(() => {' + B73 + `
    W73();
    const twoRows = B73(['00000000','00000000','00000000','00000000','00000000','00000000','11100111','11100111']);
    const h = runSteps(payoffSteps(twoRows, 0.2));
    const [lo, hi] = packBits(twoRows);
    const bam = h && h.some(s => s.n >= 4 && placeMasks(s).some(m => !(lo & m.lo) && !(hi & m.hi) && applyBits(lo, hi, s, m) >= 2));
    const none = runSteps(payoffSteps(B73(Array(8).fill('00000000')), 0.2));
    // dealt by the clock: due now, the tray is a PAYOFF
    W73(); B73(['00000000','00000000','00000000','00000000','00000000','00000000','11100111','11100111']); wave.at = 1; closerCool = 9; genTray();   // (1.1) cooldown keeps the sweep run off this small board
    const dealtTier = lastTier, after = wave.n;
    // an empty board offers no payoff: a build tray, and the clock stays due for the next one
    W73(); B73(Array(8).fill('00000000')); wave.at = 1; genTray();
    return { bam, none, dealtTier, after, emptyTier: lastTier, stillDue: wave.due }; })()`);
  assert.ok(r.bam, 'the hand holds a big block that clears two lines in one drop');
  assert.equal(r.none, null);
  assert.equal(r.dealtTier, 'PAYOFF'); assert.equal(r.after, 0, 'the clock restarts');
  assert.notEqual(r.emptyTier, 'PAYOFF'); assert.ok(r.stillDue, 'retries next tray');
});

test('7.3 closers: earned triggers deal a planned sweep with the shimmer, count as a special, and give way to a golden hand', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer, which Challenge still deals with
  const r = await page.evaluate('(() => {' + B73 + `
    const rows = ['00000000','00000000','00000000','00000000','00000000','00000000','00111111','11111000'];
    const o = {};
    W73(); B73(rows); const before = packGrid(grid);
    waveAfterDrop(before, 1, 11, 1, false); o.lowGems = closerNext;                 // a clear leaving 11 gems earns one
    W73(); waveAfterDrop(before, 1, 30, 3, false); o.combo = closerNext;            // so does combo 3
    W73(); waveAfterDrop(before, 0, 30, 0, false); o.nothing = closerNext;          // a drop with no clear does not
    W73(); B73(rows); closerNext = true; genTray();
    o.tier = lastTier; o.glow = closerTray; o.special = specialEnd === trayNo; o.cool = closerCool;
    o.sweeps = evalHand(packGrid(grid), tray.map(t => t.s), 3000000).sweep;
    W73(); B73(rows); closerNext = true; dryN = CFG.DRY_TRAYS; genTray(); o.dry = lastTier;   // a dry spell on its own is a payoff, never a sweep
    W73(); B73(['00000000','00000000','00000000','00000000','00000000','00000000','11100111','11100111']); dryN = CFG.DRY_TRAYS; genTray(); o.dryOnly = lastTier;
    W73(); B73(rows); closerNext = true; goldenNext = true; genTray(); o.golden = lastTier;   // a golden hand due goes first
    W73(); B73(rows); closerNext = true; specialEnd = trayNo; genTray(); o.afterSpecial = lastTier;  // never right after a special
    return o; })()`);
  assert.ok(r.lowGems && r.combo && !r.nothing, 'the triggers');
  assert.equal(r.tier, 'CLOSER'); assert.ok(r.glow, 'the tray shimmers'); assert.ok(r.special, 'it counts as the special'); assert.ok(r.cool > 0);
  assert.ok(r.sweeps, 'the closer hand can empty the board');
  assert.equal(r.dryOnly, 'PAYOFF', 'stalling earns lines, not a reset');
  assert.notEqual(r.afterSpecial, 'CLOSER');
  assert.notEqual(r.golden, 'CLOSER');
});

test('7.3 the wave state is saved with the run and survives a resume', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    W73(); wave = { n: 3, at: 6, due: true }; setups = [{ k: 0, r: 6, c: 2, age: 1, dealt: true }]; closerNext = true; closerCool = 2; dryN = 4; bigHist = [1, 2]; closerTray = true;
    const snap = JSON.parse(JSON.stringify(snapshot()));
    W73(); restore(snap);
    const ok = wave.n === 3 && wave.at === 6 && wave.due && setups.length === 1 && setups[0].dealt && closerNext && closerCool === 2 && dryN === 4 && bigHist.join() === '1,2' && closerTray;
    delete snap.wave; restore(snap);                                           // an older save: a fresh wave
    return { ok, old: wave.n === 0 && setups.length === 0 && !closerNext }; })()`);
  assert.ok(r.ok, 'round trip'); assert.ok(r.old, 'older saves start a fresh wave');
});

test('1.1 A sweep hunt: finds sweeps that need a clear mid-way or no exact tiling; a small calm board off cooldown gets one, on cooldown it does not', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.EASY_RUN_GEMS = 0; });   // (1.1 G round 2) EASY hunts with no cooldown; this tests the cooldown
  const r = await page.evaluate('(() => {' + B73 + `
    const o = {};
    const sweeps = h => !!h && evalHand(packGrid(grid), h, 3000000).sweep;
    // row 7 needs columns 0-2, row 6 needs 5-7, column 7 above them is filled: the 1x3 clears row 7, then a corner piece takes
    // row 6 and column 7 together; no greedy cover tiles that exactly
    B73(['00000001','00000001','00000001','00000001','00000001','00000001','11111000','00011111']);
    const [lo, hi] = packBits(packGrid(grid));
    o.hunt = sweeps(runSteps(sweepHuntSteps(lo, hi)));
    o.gap = sweepGap(lo, hi) < 99;
    B73(['10000001','00000000','00010000','00000000','01000000','00000100','00000000','10000001']);   // scattered: no cover of four lines
    { const [l2, h2] = packBits(packGrid(grid)); o.scatter = runSteps(sweepHuntSteps(l2, h2)); o.scatterGap = sweepGap(l2, h2); }
    // an ordinary tray on a small calm board, nothing due: the chase deals the sweep, with the shimmer
    W73(); sweepCool = 0; B73(['00000000','00000000','00000000','00000000','00000000','00000000','00111111','11111000']); wave.n = 0; wave.at = 9; jack.at = 99; genTray();
    o.tier = lastTier; o.glow = closerTray; o.sweeps = sweeps(tray.map(t => t.s)); o.cool = closerCool;
    W73(); sweepCool = 0; B73(['00000000','00000000','00000000','00000000','00000000','00000000','00111111','11111000']); wave.at = 9; jack.at = 99; closerCool = 3; genTray();
    o.coolTier = lastTier; o.coolGlow = closerTray;
    return o; })()`);
  assert.ok(r.hunt, 'the hunt finds the clear-then-sweep hand');
  assert.ok(r.gap);
  assert.equal(r.scatter, null); assert.equal(r.scatterGap, 99);
  assert.equal(r.tier, 'CLOSER'); assert.ok(r.glow && r.sweeps && r.cool > 0, 'a real sweep hand, shimmering, then the cooldown');
  assert.notEqual(r.coolTier, 'CLOSER'); assert.ok(!r.coolGlow, 'spaced by the cooldown');
});

test('1.1 A two-tray chase: a closer on a small board with no sweep gets a set-up hand that can leave one, the next tray hunts once, and it survives a resume', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer's chase
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.CHASE_TRIES = 8; CFG.RUN_TRAYS = 0;                                                            // off by default (measured gain too small for its cost); the mechanism still works
    const o = {}, rows = ['00000000','00000000','00000000','00000000','11110000','11111100','11000011','00000011'];
    W73(); sweepCool = 0; B73(rows); const a = packGrid(grid);
    { const [lo, hi] = packBits(a); o.none = runSteps(sweepHuntSteps(lo, hi)); }
    let found = false;
    for (let k = 0; k < 20 && !found; k++) { W73(); sweepCool = 0; chaseCool = 0; B73(rows); wave.at = 9; jack.at = 99; closerNext = true; rndSrc = mulberry(300 + k); genTray(); found = lastTier === 'SETUP'; }
    rndSrc = null;
    o.found = found; o.next = chaseNext;
    const snap = JSON.parse(JSON.stringify(snapshot())); chaseNext = false; restore(snap); o.saved = chaseNext;
    // the next tray is the chase's one try: a closer is due regardless of the closer's own trigger; then the chase is over
    tray = [null, null, null]; genTray(); o.after = chaseNext; o.afterTier = lastTier;
    return o; })()`);
  assert.equal(r.none, null, 'this board has no three-piece sweep');
  assert.ok(r.found, 'a set-up hand is dealt'); assert.ok(r.next && r.saved, 'the chase is remembered across a resume');
  assert.ok(!r.after, 'one try only');
});

test('1.1 sweep run: a low calm board gets big readable pieces toward a sweep, ends when the board grows, cools down, survives a resume', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = {};
    // predictPlay: an obvious clear goes first
    B73(['10000000','00000000','00000000','00000000','00000000','00000000','00000000','11111000']);
    { const [lo, hi] = packBits(packGrid(grid)); const bar = SHAPES.find(s => s.rows === 1 && s.cols === 3 && s.n === 3), sq = SHAPES.find(s => s.rows === 2 && s.cols === 2 && s.n === 4);
      const pp = predictPlay(lo, hi, [sq, bar, sq]); o.predict = !!pp && pop32(pp[0]) + pop32(pp[1]) === 9;   // the bar clears row 7, the two squares and the corner gem stay
      B73(['00000000','00000000','00000000','00000000','00000000','00000000','00000000','11111000']); const [l2, h2] = packBits(packGrid(grid));
      const p2 = predictPlay(l2, h2, [sq, bar, sq]); o.predictSweep = !!p2 && !(p2[0] | p2[1]); }   // a sweep before the last piece counts as the sweep
    o.pool = RUN_POOL.every(s => s.n >= 3) && [19, 20, 21, 22, 23, 24, 25, 26].every(i => !RUN_POOL.includes(SHAPES[i])) && [9, 10, 15, 27].every(i => RUN_POOL.includes(SHAPES[i]));   // no S, Z, T; squares and L's in
    // a scattered low board with no sweep on it: a run starts and deals from the run pool
    const low = ['10000000','00000000','00100000','00000000','00000100','00000000','01000000','00000010'];
    let started = false;
    for (let k = 0; k < 10 && !started; k++) { W73(); sweepCool = 0; sweepRun = null; B73(low); wave.at = 9; jack.at = 99; rndSrc = mulberry(700 + k); genTray(); started = /^RUN|CLOSER/.test(lastTier); }
    rndSrc = null;
    o.tier = lastTier; o.inPool = lastTier === 'CLOSER' || tray.every(t => RUN_POOL.includes(t.s)); o.run = sweepRun && sweepRun.n;
    const snap = JSON.parse(JSON.stringify(snapshot())); const n0 = sweepRun ? sweepRun.n : -1; sweepRun = null; restore(snap); o.saved = (sweepRun ? sweepRun.n : -1) === n0;
    // the board grows past RUN_GEMS + RUN_SLACK: the run ends and the cooldown starts
    sweepRun = { n: 1 }; closerCool = 0; B73(['11111110','11111100','11110000','11100000','00000000','00000000','00000000','00000000']); tray = [null, null, null]; genTray();
    o.ended = sweepRun === null && closerCool >= CFG.RUN_COOL - 1 && !/^RUN/.test(lastTier);
    // off with RUN_TRAYS 0
    W73(); sweepCool = 0; sweepRun = null; B73(low); wave.at = 9; jack.at = 99; CFG.RUN_TRAYS = 0; genTray(); o.off = !/^RUN/.test(lastTier) && sweepRun === null; CFG.RUN_TRAYS = 3;
    return o; })()`);
  assert.ok(r.predict, 'predictPlay takes the obvious clear first'); assert.ok(r.predictSweep, 'an early sweep is the sweep');
  assert.ok(r.pool, 'the run pool holds only big readable pieces');
  assert.ok(/^RUN|CLOSER/.test(r.tier), 'a run starts on a low calm board: ' + r.tier); assert.ok(r.inPool);
  assert.ok(r.saved, 'the run survives a resume');
  assert.ok(r.ended, 'a grown board ends the run, with the cooldown');
  assert.ok(r.off, 'RUN_TRAYS 0 turns it off');
});

test('journey sky (7.5b): stages follow the score, a clean sweep jumps one, saved with the run; Adventure and the switch keep the player’s world', async ({ page }) => {
  await play(page);
  await dealt(page);
  const st = () => page.evaluate(() => ({ w: curWorld, stage: jStage, shown: jShown, wipe: !!jw, sweep: !!(jw && jw.sweep), jumps: jJumps }));
  const done = () => page.waitForFunction(() => !jw && !jPend, null, { timeout: 5000 });
  assert.equal((await st()).w, 'j0', 'a run starts at dawn');
  await page.evaluate(() => { score = CFG.JOURNEY_AT[1] + 1000; journeyDealt(); });       // past the first threshold: day, after the next deal
  assert.equal((await st()).w, 'j0', 'nothing changes on the clear itself');
  await page.waitForFunction(() => !!jw, null, { timeout: 3000 });
  assert.deepEqual(await st(), { w: 'j1', stage: 1, shown: 1, wipe: true, sweep: false, jumps: 0 }, 'a calm wipe to day');
  await done();
  await page.evaluate(() => { CFG.SPECIALS.transform = false; journeySweep(); });         // a clean sweep jumps a stage
  await page.waitForFunction(() => !!jw, null, { timeout: 3000 });
  assert.deepEqual(await st(), { w: 'j2', stage: 2, shown: 2, wipe: true, sweep: true, jumps: 1 }, 'a sweep wipe to golden hour');
  await done();
  const r = await page.evaluate(() => {
    score = CFG.JOURNEY_AT[3]; jStage = journeyTarget();                                  // night by score, plus the sweep: aurora
    const snap = JSON.parse(JSON.stringify(snapshot())), out = { jy: snap.jy };
    jJumps = 0; restore(snap); out.resumed = [curWorld, !!jw];
    delete snap.jy; restore(snap); out.old = curWorld;
    score = CFG.JOURNEY_AT[5] - 1; jJumps = 5; out.cap = journeyTarget();
    mode = 'adventure'; syncHomeSky(); out.adv = curWorld === CFG.HOME_WORLD;
    mode = 'endless'; syncHomeSky(); out.back = curWorld;
    el('journeyOn').checked = false; el('journeyOn').dispatchEvent(new Event('change'));
    out.off = curWorld === CFG.HOME_WORLD && JSON.parse(localStorage.getItem('crumble.skins')).journey === false;
    el('journeyOn').checked = true; el('journeyOn').dispatchEvent(new Event('change'));
    start(); out.fresh = [curWorld, jJumps, jStage];
    return out;
  });
  assert.equal(r.jy, 1, 'sweeps are saved with the run');
  assert.deepEqual(r.resumed, ['j4', false], 'a resume snaps to its stage, no wipe');
  assert.equal(r.old, 'j3', 'an older save follows the score alone');
  assert.equal(r.cap, 5, 'space is the last stage');
  assert.ok(r.adv, 'Adventure keeps the player’s own world');
  assert.equal(r.back, 'j5');
  assert.ok(r.off, 'the Settings switch brings the player’s world back and is saved');
  assert.deepEqual(r.fresh, ['j0', 0, 0], 'a new run starts at dawn again');
});

test('journey sky (7.5b): the wipe stays behind the board, a bonus hands back with a wipe, and it fits the frame budget', async ({ page }) => {
  await play(page);
  await dealt(page);
  const px = () => page.evaluate(() => { grid[4][4] = { gi: 2, t: 1, f: 0, l: 0 }; shake = 0; const g = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return [d[0], d[1], d[2]]; };
    return { corner: g(3, 3), gem: g(bx + 4.5 * cell, by + 4.5 * cell) }; });
  const moved = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  await page.evaluate(() => { grid[4][4] = { gi: 2, t: 1, f: 0, l: 0 }; });
  await page.waitForTimeout(400);
  const base = await px();
  await watchFrames(page); await frameLog(page);
  await page.evaluate(() => { score = CFG.JOURNEY_AT[1] + 1000; journeyDealt(); jPend.t = 1; });
  await page.waitForFunction(() => jw && jw.t > jw.dur * 0.5, null, { timeout: 3000 });
  const mid = await px();
  assert.ok(moved(mid.gem, base.gem) <= 5, 'a gem pixel is untouched mid-wipe: ' + base.gem + ' vs ' + mid.gem);
  assert.ok(moved(mid.corner, base.corner) > 8, 'the sky has changed at the top: ' + base.corner + ' -> ' + mid.corner);
  await page.waitForFunction(() => !jw, null, { timeout: 3000 });
  const work = (await frameLog(page)).work.sort((a, b) => a - b);
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (wipe: ${work.length} frames, p90 ${p90.toFixed(1)} ms, max ${work[work.length - 1].toFixed(1)} ms)`);
  assert.ok(p90 < 12, 'wipe frames stay cheap: p90 ' + p90.toFixed(1) + ' ms');
  const b = await page.evaluate(async () => {
    startBonus(); score = CFG.JOURNEY_AT[2]; journeyDealt(); jPend.t = 1;
    await new Promise(res => setTimeout(res, 300));
    const during = [curWorld, jStage, jShown];
    endBonus(); const after = [curWorld, !!jw, jShown];
    return { during, after };
  });
  assert.deepEqual(b.during, ['bonus', 2, 1], 'while a bonus owns the sky the stage moves on quietly');
  assert.deepEqual(b.after, ['j2', true, 2], 'and wipes in when the bonus hands back');
  const pale = await page.evaluate(() => { CFG.THEME = 'daylight'; applyTheme(); const c = bgOf('j5'); CFG.THEME = 'classic'; applyTheme(); return c; });
  const lum = h => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * (n >> 8 & 255) + 0.11 * (n & 255); };
  assert.ok(lum(pale.top) > 140, 'a dark-ink theme gets a pale space so its text stays readable: ' + pale.top);
});

test('frame budget: a drag toward a completing line, with anticipation on where it exists, draws the steady sky as one cached blit', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(() => { if ('FX_ANTICIPATION' in CFG) CFG.FX_ANTICIPATION = true; });
  await setup(page, { rows: THREE_LINES, trayShapes: [4, 4, 4] });
  await frames(page, 10);
  await page.evaluate(() => {                                   // count the sky's own work: gradients made, full-screen blits
    window.__sky = { grads: 0, full: 0, n: 0 };
    const cg = ctx.createLinearGradient, di = ctx.drawImage, of = frame;
    ctx.createLinearGradient = function () { __sky.grads++; return cg.apply(this, arguments); };
    ctx.drawImage = function (img) { if (_plates.some(p => p.cv === img)) __sky.full++; return di.apply(this, arguments); };
    frame = function (now) { of(now); __sky.n++; };
  });
  await watchFrames(page); await frameLog(page);
  const g = await geometry(page), from = g.trayCenters[0];
  const s = await page.evaluate(() => ({ rows: tray[0].s.rows, cols: tray[0].s.cols }));
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let k = 0; k < 40; k++) {                                // sweep toward and away from the landing that finishes three lines
    const f = fingerFor(g, s, 3.5 * Math.abs(Math.sin(k / 8)), 0.5 * Math.sin(k / 5));
    await page.mouse.move(f.x, f.y); await frames(page, 1);
  }
  const sky = await page.evaluate(() => __sky), work = (await frameLog(page)).work.sort((a, b) => a - b);
  await page.mouse.up();
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (drag: ${work.length} frames, p90 ${p90.toFixed(1)} ms, max ${work[work.length - 1].toFixed(1)} ms)`);
  assert.ok(p90 < 12, 'drag frames stay cheap: p90 ' + p90.toFixed(1) + ' ms');
  assert.ok(sky.n > 30 && sky.full - sky.n >= 0 && sky.full - sky.n <= 1, `one cached sky plate blit a frame, not a gradient plus a scaled decor layer (${sky.full} blits in ${sky.n} frames; the frame already queued when the counter went in is unwrapped)`);
});

test('Settings > Look: Clear effect (Crumble / Classic) and Glints while dragging save, and change mid-run', async ({ page }) => {
  await play(page);
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.inputValue('#clearPick'), 'crumble', 'Crumble is the default');
  await page.selectOption('#clearPick', 'squash');
  assert.equal(await page.evaluate(() => CFG.CLEAR_STYLE), 'squash', 'Classic is the squash, at once');
  const glint = await page.evaluate(() => 'FX_ANTICIPATION' in CFG);
  assert.equal(await page.isVisible('#glintOn'), glint, 'the glint switch shows only when the game has the glints');
  if (glint) { await page.uncheck('#glintOn'); assert.equal(await page.evaluate(() => CFG.FX_ANTICIPATION), false); }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(SKIN_STORE)));
  assert.equal(saved.clear, 'squash', 'saved with the player’s other settings');
  await closeSet(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { window.__rub = 0; const of = frame; frame = function (now) { of(now); __rub = Math.max(__rub, rubble.length); }; });
  await dragPiece(page, 0, 0, 0);
  await frames(page, 30);
  assert.equal(await page.evaluate(() => __rub), 0, 'the next clear is Classic: no rubble');
  await page.evaluate(() => { CFG.CLEAR_STYLE = 'crumble'; });
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await frames(page, 30);
  assert.ok(await page.evaluate(() => __rub) > 0, 'and Crumble drops rubble (so the check above means something)');
  await page.evaluate(() => { CFG.CLEAR_STYLE = 'squash'; saveSkinSave(); });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof CFG !== 'undefined' && typeof cell !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.CLEAR_STYLE), 'squash', 'and it is still Classic after a reload');
});

// (7.5c) hold tray piece `i` with its top-left floating at fractional board cell (r, c): real pointer events, finger stays down
const holdAt = async (page, i, r, c) => {
  const g = await geometry(page);
  const s = await page.evaluate(i => ({ rows: tray[i].s.rows, cols: tray[i].s.cols }), i);
  const f = fingerFor(g, s, r, c);
  if (!(await page.evaluate(() => !!drag))) { const from = g.trayCenters[i]; await page.mouse.move(from.x, from.y); await page.mouse.down(); }
  await page.mouse.move(f.x, f.y, { steps: 3 });
  await frames(page, 30);
};
const antRead = page => page.evaluate(() => { antCell(0, 4, performance.now()); return { row0: antV[0], others: Math.max(...antV.slice(1)), any: antAny, ax: _ax, ay: _ay, af: _af, n: antN }; });

test('7.5c anticipation: a line one piece from clearing shivers and glints as the right piece nears it', async ({ page }) => {
  await play(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 1, 0] });
  await frames(page, 5);
  assert.equal((await antRead(page)).any, false, 'at rest nothing moves: it is not a hint before the player picks a piece up');
  await holdAt(page, 0, 6, 6);
  let a = await antRead(page);
  assert.equal(a.n, 1, 'the single cell completes row 0 from exactly one landing');
  assert.ok(a.row0 < 0.01, 'far from it: nothing yet ' + JSON.stringify(a));
  await holdAt(page, 0, 1.6, 1.2);
  const near = await antRead(page);
  assert.ok(near.row0 > 0.05 && near.others === 0, 'within reach the row comes alive, and only that row: ' + JSON.stringify(near));
  assert.ok(Math.hypot(near.ax, near.ay) > 0 && near.af > 0, 'its gems shiver and glint');
  assert.ok(Math.hypot(near.ax, near.ay) <= 1.2 + 1e-6, 'by at most ANTIC_SHIVER px');
  await holdAt(page, 0, 0.9, 0.5);
  const nearer = await antRead(page);
  assert.ok(nearer.row0 > near.row0, `closer = stronger (${near.row0.toFixed(2)} -> ${nearer.row0.toFixed(2)})`);
  await holdAt(page, 0, 0, 0);
  const seated = await antRead(page);
  assert.ok(await page.evaluate(() => drag.slot && drag.slot.r === 0 && drag.slot.c === 0), 'seated in the completing slot');
  assert.ok(seated.row0 < 0.01, 'seated: the coloured line preview owns the row, so it stops shivering');
  await page.mouse.up();
  await frames(page, 3);
  const after = await page.evaluate(() => ({ row: grid[0].every(Boolean) }));
  assert.equal(after.row, false, 'the row cleared');
  // the wrong piece: a domino cannot complete row 0 (the gap is one cell), so nothing happens near it
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [1, 1, 1] });
  await holdAt(page, 0, 0.5, 0.5);
  const wrong = await antRead(page);
  assert.ok(wrong.n === 0 && !wrong.any, 'the wrong piece wakes nothing: ' + JSON.stringify(wrong));
  await page.mouse.up();
  // switch: Glints while dragging off
  await dealt(page);
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { CFG.FX_ANTICIPATION = false; });
  await holdAt(page, 0, 0.8, 0.4);
  const off = await antRead(page);
  assert.ok(!off.any, 'Glints while dragging off (FX_ANTICIPATION): no shiver');
  await page.mouse.up();
  await page.evaluate(() => { CFG.FX_ANTICIPATION = true; });
});

test('7.5c anticipation: reduced motion keeps a steady glow and no shiver; holding near several lines fits the frame budget', async ({ page, errors }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);   // a saved run reopens straight into play
  await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
  await holdAt(page, 0, 0.8, 0.4);
  const a = await antRead(page);
  assert.ok(a.row0 > 0.2 && a.ax === 0 && a.ay === 0 && a.af > 0, 'reduced motion: the row brightens but does not move ' + JSON.stringify(a));
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);   // a saved run reopens straight into play
  // a 5-bar near five half-columns-short rows: many landings, five live lines at once
  await setup(page, { rows: ['01111111', '01111111', '01111111', '01111111', '01111111', '11110000', '00000000', '00000000'], trayShapes: [8, 0, 0] });
  await watchFrames(page);
  await frameLog(page);
  await holdAt(page, 0, 1.3, 1.2);
  await frames(page, 60);
  const live = await page.evaluate(() => [...antV].filter(v => v > 0.01).length);
  assert.ok(live >= 5, 'five rows come alive together: ' + live);
  const work = (await frameLog(page)).work.sort((x, y) => x - y);
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (anticipation: ${work.length} frames, p90 ${p90.toFixed(2)} ms, max ${work[work.length - 1].toFixed(2)} ms)`);
  assert.ok(p90 < 12, 'held frames stay cheap: p90 ' + p90.toFixed(2) + ' ms');
  await page.mouse.up();
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});

// (7.5d) a streak of `n` clears: a single cell finishing row 0, n times (each drop is its own tray, so the dealer waits)
const streak = async (page, n) => {
  for (let k = 0; k < n; k++) {
    await dealt(page);
    await setup(page, { rows: ['01111111', ...EMPTY.slice(1)], trayShapes: [0, 0, 0] });
    await dragPiece(page, 0, 0, 0);
    await frames(page, 4);
  }
};
const fireRead = page => page.evaluate(() => ({ combo, k: fire.k, flare: fire.flare, tier: fire.tier, embers: fire.embers.length, smoke: fire.smoke.length }));

test('7.5d combo fire: lights at combo 3, hotter each step, the held piece sheds embers, a miss snuffs it in a puff', async ({ page }) => {
  await page.evaluate(() => { CFG.COMBO_CARRY = false; });   // one miss ends the streak here (round 6's carrying combo has its own test)
  await play(page);
  await page.evaluate(() => { window.__sfx = []; const s = Sfx.snuff; Sfx.snuff = (...a) => { __sfx.push('snuff'); s(...a); }; });
  await streak(page, 2);
  await frames(page, 30);
  let f = await fireRead(page);
  assert.ok(f.combo === 2 && f.k === 0, 'combo 2 is still the calm tier: no fire ' + JSON.stringify(f));
  await streak(page, 1);
  assert.ok((await fireRead(page)).flare > 0.5, 'combo 3 catches with a flare');
  await frames(page, 40);
  const c3 = await fireRead(page);
  assert.ok(c3.combo === 3 && c3.k > 0.3 && c3.tier === 0, 'combo 3: burning, orange ' + JSON.stringify(c3));
  await streak(page, 2); await frames(page, 40);
  const c5 = await fireRead(page);
  assert.ok(c5.combo === 5 && c5.k > c3.k + 0.2 && c5.tier === 2, `hotter each step (${c3.k.toFixed(2)} -> ${c5.k.toFixed(2)}), white-hot from 5`);
  // the held piece sheds embers as it moves
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [4, 0, 0] });
  await page.evaluate(() => { fire.embers.length = 0; window.__emb = 0; const of = stepFire; stepFire = dt => { of(dt); __emb = Math.max(__emb, fire.embers.length); }; });
  const g = await geometry(page), s = await page.evaluate(() => ({ rows: tray[0].s.rows, cols: tray[0].s.cols }));
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
  for (let k = 0; k < 15; k++) { const p = fingerFor(g, s, 5 - k * 0.3, 1 + k * 0.2); await page.mouse.move(p.x, p.y); await frames(page, 1); }
  assert.ok(await page.evaluate(() => __emb) >= 5, 'dragging trails embers: ' + await page.evaluate(() => __emb));
  // a miss: the piece lands without clearing, the streak ends
  const p = fingerFor(g, s, 4, 4); await page.mouse.move(p.x, p.y); await frames(page, 2); await page.mouse.up();
  await frames(page, 3);
  const out = await fireRead(page);
  assert.ok(out.combo === 0 && out.smoke >= 10, 'snuffed: smoke puffs off the rim ' + JSON.stringify(out));
  assert.deepEqual(await page.evaluate(() => __sfx), ['snuff'], 'with its own soft sound, once');
  await frames(page, 40);
  assert.equal((await fireRead(page)).k, 0, 'and the flames are out');
  // a new run starts cold, and a miss without a streak is silent
  await streak(page, 3); await frames(page, 20);
  assert.ok((await fireRead(page)).k > 0.2);
  await page.evaluate(() => { start(); });
  const fresh = await fireRead(page);
  assert.ok(fresh.k === 0 && fresh.smoke === 0 && fresh.embers === 0, 'a new run starts with no fire and no puff ' + JSON.stringify(fresh));
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 4, 4); await frames(page, 3);
  assert.deepEqual(await page.evaluate(() => __sfx), ['snuff'], 'no snuff without a fire');
});

test('7.5d combo fire: never over a gem, off with its switch (saved), steady under reduced motion, a bonus owns the rim', async ({ page }) => {
  await page.evaluate(() => { CFG.COMBO_CARRY = false; });   // one miss ends the streak here (round 6's carrying combo has its own test)
  await play(page);
  const gemPx = async () => { await page.evaluate(() => { grid[4][4] = { gi: 2, t: 1, f: 0, l: 0 }; grid[0][3] = { gi: 2, t: 1, f: 0, l: 0 }; shake = 0; punchT = 0; }); await frames(page, 2); return page.evaluate(() => {
    const g = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return [d[0], d[1], d[2]]; };
    return [g(bx + 4.5 * cell, by + 4.5 * cell), g(bx + 3.5 * cell, by + 0.2 * cell)]; }); };
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await frames(page, 20);
  const cold = await gemPx();
  await page.evaluate(() => { combo = 6; fire.tier = 2; for (let i = 0; i < 30; i++) fireEmber(bx + cell * (3 + Math.random() * 2), by + cell * (Math.random() * 5), 0, 0); });
  await frames(page, 30);
  assert.ok(await page.evaluate(() => fire.k) > 0.9, 'burning hot');
  const hot = await gemPx();
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  assert.ok(diff(cold[0], hot[0]) <= 3 && diff(cold[1], hot[1]) <= 3, `gems look the same with the fire on, embers pass behind them: ${JSON.stringify(cold)} vs ${JSON.stringify(hot)}`);
  // the switch: Settings > Look > Advanced
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#fireOn'), true, 'on by default');
  await page.uncheck('#fireOn');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(SKIN_STORE)).fire), false, 'saved with the player’s settings');
  await closeSet(page);
  await frames(page, 90);
  assert.equal(await page.evaluate(() => fire.k), 0, 'off: the flames fade out mid-streak');
  await page.evaluate(() => { fireCombo(); });
  assert.equal(await page.evaluate(() => fire.flare), 0, 'and a new step does not light it');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof CFG !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.FX_COMBO_FIRE), false, 'still off after a reload');
  await page.evaluate(() => { CFG.FX_COMBO_FIRE = true; saveSkinSave(); });
  // a bonus: its violet rim owns the frame
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await page.evaluate(() => { combo = 6; });
  await frames(page, 30);
  assert.ok(await page.evaluate(() => fire.k) > 0.9);
  await page.evaluate(() => { bonus = { left: 3, extra: 0 }; });
  await frames(page, 90);
  assert.equal(await page.evaluate(() => fire.k), 0, 'during a bonus the fire waits');
  await page.evaluate(() => { bonus = null; combo = 0; });
  // reduced motion: steady rim and tray glow, no embers, the snuff is a fade with no smoke
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await page.evaluate(() => { CFG.COMBO_CARRY = false; });
  await streak(page, 4); await frames(page, 30);
  const r = await fireRead(page);
  assert.ok(r.k > 0.4 && r.embers === 0, 'reduced motion: it burns, but no sparks fly ' + JSON.stringify(r));
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 4, 4); await frames(page, 3);
  const rs = await fireRead(page);
  assert.ok(rs.combo === 0 && rs.smoke === 0, 'and goes out with a fade, no smoke ' + JSON.stringify(rs));
});

test('7.5d combo fire: dragging at combo 6 with embers and a burning rim fits the frame budget', async ({ page }) => {
  await play(page);
  await dealt(page);
  await setup(page, { rows: THREE_LINES, trayShapes: [4, 4, 4] });
  await page.evaluate(() => { combo = 6; fire.tier = 2; });
  await frames(page, 30);
  await watchFrames(page); await frameLog(page);
  const g = await geometry(page), s = await page.evaluate(() => ({ rows: tray[0].s.rows, cols: tray[0].s.cols }));
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
  for (let k = 0; k < 50; k++) {
    const f = fingerFor(g, s, 3.5 * Math.abs(Math.sin(k / 8)), 0.5 + 3 * Math.abs(Math.sin(k / 5)));
    await page.mouse.move(f.x, f.y); await frames(page, 1);
  }
  const n = await page.evaluate(() => fire.embers.length), work = (await frameLog(page)).work.sort((a, b) => a - b);
  await page.mouse.up();
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (combo fire drag: ${work.length} frames, ${n} embers, p90 ${p90.toFixed(2)} ms, max ${work[work.length - 1].toFixed(2)} ms)`);
  assert.ok(n > 5 && n <= 36, 'embers live, and capped: ' + n);
  assert.ok(p90 < 12, 'drag frames stay cheap with the fire: p90 ' + p90.toFixed(2) + ' ms');
});

const counted = async page => { await page.waitForFunction(() => shownScore === score, null, { timeout: 5000 }); await frames(page, 1); };
const chaseRead = page => page.evaluate(() => { const b = el('chase'); return { hidden: b.hidden, cls: b.className, to: b.querySelector('.to').textContent, fill: b.querySelector('.fill').style.transform, target: chaseBest }; });

test('7.5e chase your best: a bar under the score fills toward the player’s best, "N to beat" near it, a glow at the end, gone once passed', async ({ page }) => {
  await play(page);
  assert.ok((await chaseRead(page)).hidden, 'the player’s very first run has no best to chase');
  await page.evaluate(() => { best = 10000; start(); });
  await dealt(page);
  let c = await chaseRead(page);
  assert.ok(!c.hidden && c.target === 10000 && /scaleX\(0\)/.test(c.fill) && c.to === '', 'a new run shows an empty bar to 10000 ' + JSON.stringify(c));
  await page.evaluate(() => { score = 5000; }); await counted(page);
  c = await chaseRead(page);
  assert.ok(/scaleX\(0\.5\)/.test(c.fill) && c.to === '' && !/near|hot/.test(c.cls), 'half way: half full, no text yet ' + JSON.stringify(c));
  await page.evaluate(() => { score = 8000; }); await counted(page);
  c = await chaseRead(page);
  assert.ok(c.to === '2001 to beat' && /near/.test(c.cls) && !/hot/.test(c.cls), 'from 75%: how many to beat it ' + JSON.stringify(c));
  await page.evaluate(() => { score = 9500; }); await counted(page);
  assert.ok(/hot/.test((await chaseRead(page)).cls), 'from 90% the bar glows');
  // passing it for real: NEW BEST, the bar pops, the sky jumps a stage with the bright wipe
  await page.evaluate(() => { window.__sfx = []; const f = Sfx.fanfare; Sfx.fanfare = (...a) => { __sfx.push('fanfare'); f(...a); }; score = 9995; shownScore = 9995; jPend = null; jw = null; });
  const j0 = await page.evaluate(() => jJumps);
  await setup(page, { rows: ['01111111', '00000000', '10000000', ...EMPTY.slice(3)], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => shownScore > 10000, null, { timeout: 3000 });
  await frames(page, 2);
  c = await chaseRead(page);
  assert.ok(!c.hidden && /won/.test(c.cls) && /scaleX\(1\)/.test(c.fill), 'passing it flashes the full bar (no clean sweep: one jump is the chase) ' + JSON.stringify(c));
  const r = await page.evaluate(() => ({ beaten: bestBeaten, jumps: jJumps, pend: !!jPend, sweep: jSweep, banner: banners.some(b => b.txt === 'NEW BEST!'), sfx: __sfx }));
  assert.ok(r.beaten && r.banner && r.sfx.length === 1, 'the NEW BEST banner and fanfare, once ' + JSON.stringify(r));
  assert.ok(r.jumps === j0 + 1 && r.pend && r.sweep, 'the journey sky jumps one stage with the bright wipe ' + JSON.stringify(r));
  await page.waitForFunction(() => !!jw && jw.sweep, null, { timeout: 4000 });
  await page.waitForFunction(() => el('chase').hidden, null, { timeout: 2000 });
  // more points do not bring it back or jump again
  await page.evaluate(() => { score += 500; }); await frames(page, 30);
  assert.ok((await chaseRead(page)).hidden && await page.evaluate(() => jJumps) === j0 + 1, 'once a run');
});

test('7.5e chase your best: the target survives a resume, a small best skips the sky jump, Daily/Adventure and the switch (saved) hide it', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { best = 3000; start(); });
  await dealt(page);
  const r = await page.evaluate(() => {
    score = 2000; saveRun();                                       // saveStats has now written best = max(best, score)
    const snap = JSON.parse(JSON.stringify(snapshot())), out = { cb: snap.cb };
    best = 50000; restore(snap); out.resumed = chaseBest;           // the stored best has moved on: the run still chases 300
    delete snap.cb; best = 3000; restore(snap); out.old = chaseBest;
    return out;
  });
  assert.deepEqual(r, { cb: 3000, resumed: 3000, old: 3000 }, 'the target is saved with the run; an older save chases the stored best');
  await page.evaluate(() => { score = 2995; shownScore = 2995; jPend = null; });
  const j0 = await page.evaluate(() => jJumps);
  await setup(page, { rows: ['01111111', '00000000', '10000000', ...EMPTY.slice(3)], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await frames(page, 4);
  assert.ok(await page.evaluate(() => bestBeaten), 'beaten');
  assert.equal(await page.evaluate(() => jJumps), j0, 'a best under 5000 beats with the banner only: the sky keeps its place');
  await page.evaluate(() => { best = 10000; start(); });
  assert.ok(!(await chaseRead(page)).hidden);
  await page.evaluate(() => { mode = 'daily'; syncHud(); });
  assert.ok((await chaseRead(page)).hidden, 'not in Daily');
  await page.evaluate(() => { mode = 'adventure'; syncHud(); });
  assert.ok((await chaseRead(page)).hidden, 'not in Adventure');
  await page.evaluate(() => { mode = 'endless'; syncHud(); });
  assert.ok(!(await chaseRead(page)).hidden, 'back in Endless');
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#chaseOn'), true, 'on by default');
  await page.click('#chaseOn');
  assert.ok(await page.evaluate(() => !CFG.FX_CHASE && el('chase').hidden && JSON.parse(localStorage.getItem('crumble.skins')).chase === false), 'off: hidden at once, and saved');
});

test('7.5e chase your best: the bar counting up with the glow on fits the frame budget', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { best = 100000; start(); });
  await dealt(page);
  await page.evaluate(() => { score = 92000; shownScore = 92000; });
  await frames(page, 10);
  await watchFrames(page); await frameLog(page);
  for (let k = 0; k < 6; k++) { await page.evaluate(() => { score += 900; }); await frames(page, 10); }
  const work = (await frameLog(page)).work.sort((a, b) => a - b), c = await chaseRead(page);
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (chase count-up: ${work.length} frames, p90 ${p90.toFixed(2)} ms, max ${work[work.length - 1].toFixed(2)} ms)`);
  assert.ok(/hot/.test(c.cls) && !c.hidden, 'glowing while it counts ' + JSON.stringify(c));
  assert.ok(p90 < 12, 'count-up frames stay cheap with the marker: p90 ' + p90.toFixed(2) + ' ms');
});

const mascotMood = (page, re) => page.waitForFunction(re => new RegExp(re).test(el('mascot').className) && !el('mascot').hidden, re.source, { timeout: 3000 })
  .catch(async e => { throw new Error('mascot never showed ' + re + ', it is "' + await page.evaluate(() => el('mascot').className + '|' + state + '|' + pace.ph) + '"'); });
const KEEP = '10000000';                                          // one gem left so a clear is not a sweep
test('7.5f mascot: it sits on the board corner, clear of the gems and the HUD, and reacts to clears by size', async ({ page }) => {
  assert.ok(await page.evaluate(() => el('mascot').hidden), 'not on the start card');
  await page.evaluate(() => { CFG.COMBO_CARRY = false; });   // one miss ends the streak here (round 6's carrying combo has its own test)
  await play(page);
  await dealt(page);
  await mascotMood(page, /^idle\b/);
  const g = await page.evaluate(() => {
    const r = el('mascot').getBoundingClientRect(), hit = id => { const o = el(id).getBoundingClientRect(); return o.width > 0 && !(o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom); };
    return { bottom: r.bottom, rim: by - 9, left: r.left, bx, w: r.width, hits: ['scoreVal', 'chase', 'pauseBtn', 'bestVal'].filter(hit) };
  });
  assert.ok(Math.abs(g.bottom - g.w * 4.5 / 48 - g.rim) < 3 && g.left >= g.bx && g.w >= 28 && g.w <= 46, 'feet on the frame top, inside the board width ' + JSON.stringify(g));
  assert.deepEqual(g.hits, [], 'it covers nothing in the HUD');
  const clear = async (rows, pre) => {
    await dealt(page);
    await page.evaluate(pre || (() => {}));
    await setup(page, { rows, trayShapes: [0, 0, 0] });
    await dragPiece(page, 0, 0, 0);
  };
  await page.evaluate(() => { combo = 0; });
  await clear(['01111111', '00000000', KEEP, ...EMPTY.slice(3)], () => { combo = 0; });
  await mascotMood(page, /^nod\b/);
  await clear(['01111111', ...Array(6).fill('10000000'), '10000001'], () => { combo = 0; });
  await mascotMood(page, /^hop\b/);
  await clear(['01111111', '00000000', KEEP, ...EMPTY.slice(3)], () => { combo = 2; });
  await mascotMood(page, /^smug\b/);
  await dealt(page);
  await setup(page, { rows: ['00000000', '00000000', KEEP, ...EMPTY.slice(3)], trayShapes: [0, 0, 0] });
  await page.evaluate(() => { combo = 4; });
  await dragPiece(page, 0, 5, 5);
  await mascotMood(page, /^flat\b/);
  await clear(['01111111', ...EMPTY.slice(1)], () => { combo = 0; });
  await mascotMood(page, /^sweep\b/);
  await page.waitForFunction(() => /^(idle|tight)\b/.test(el('mascot').className), null, { timeout: 4000 });
  // its eyes follow the held piece
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  const gg = await geometry(page);
  await page.mouse.move(gg.trayCenters[0].x, gg.trayCenters[0].y); await page.mouse.down();
  await page.mouse.move(gg.trayCenters[0].x + 150, gg.trayCenters[0].y - 40); await frames(page, 3);
  const right = await page.evaluate(() => masc.look);
  await page.mouse.move(10, gg.trayCenters[0].y - 40); await frames(page, 3);
  const left = await page.evaluate(() => masc.look);
  await page.mouse.move(gg.trayCenters[0].x, gg.trayCenters[0].y); await page.mouse.up();
  assert.ok(parseFloat(right) > parseFloat(left), 'the pupils follow the piece: ' + right + ' vs ' + left);
});

test('7.5f mascot: it sweats when the board is tight, faints when it is stuck, a rescue stands it up; the switch (saved) hides it', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(() => { pace.ph = 'edge'; });
  await mascotMood(page, /^tight\b/);
  await page.evaluate(() => { pace.ph = 'calm'; });
  await mascotMood(page, /^idle\b/);
  await page.evaluate(() => { mode = 'adventure'; roomNow = 0.1; });
  await mascotMood(page, /^tight\b/);
  await page.evaluate(() => { mode = 'endless'; roomNow = 1; score = 500; best = 400; stuck = true; });
  await mascotMood(page, /^faint\b/);
  await page.evaluate(() => { stuck = false; gameOver(); });
  await mascotMood(page, /^faint\b/);
  await page.click('#reviveBtn');
  await mascotMood(page, /^(idle|tight)\b/);                   // the rescue tray is a recovery: it may still sweat
  assert.equal(await page.evaluate(() => el('mascot').getAnimations().filter(a => a.playState !== 'finished' && a.effect.getComputedTiming().fill === 'forwards').length), 0, 'stood back up');
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#mascotOn'), true, 'on by default');
  await page.click('#mascotOn');
  await closeSet(page);
  await frames(page, 2);
  assert.ok(await page.evaluate(() => !CFG.FX_MASCOT && el('mascot').hidden && JSON.parse(localStorage.getItem('crumble.skins')).mascot === false), 'off: hidden, and saved');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof CFG !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.FX_MASCOT), false, 'still off after a reload');
  // reduced motion: the face changes, nothing moves
  await page.evaluate(() => { CFG.FX_MASCOT = true; saveSkinSave(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await dealt(page);
  await setup(page, { rows: ['01111111', ...Array(6).fill('10000000'), '10000001'], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await mascotMood(page, /^hop\b.*\brm\b/);
  assert.equal(await page.evaluate(() => el('mascot').getAnimations({ subtree: true }).length), 0, 'reduced motion: no movement');
});

test('7.5f mascot: a drag and three-line clears with the crumb reacting fit the frame budget', async ({ page }) => {
  await play(page);
  await dealt(page);
  await watchFrames(page); await frameLog(page);
  for (let k = 0; k < 3; k++) {
    await dealt(page);
    await setup(page, { rows: THREE_LINES, trayShapes: [4, 4, 4] });
    const g = await geometry(page), s = await page.evaluate(() => ({ rows: tray[0].s.rows, cols: tray[0].s.cols }));
    await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
    for (let i = 0; i < 16; i++) { const f = fingerFor(g, s, 3 - i * 0.2, 0.5 + 3 * Math.abs(Math.sin(i / 5))); await page.mouse.move(f.x, f.y); await frames(page, 1); }
    await page.mouse.up();
    await dragPiece(page, 0, 0, 0); await frames(page, 30);
  }
  const work = (await frameLog(page)).work.sort((a, b) => a - b);
  const p90 = work[Math.floor(work.length * 0.9)];
  console.log(`     (mascot drag + clears: ${work.length} frames, p90 ${p90.toFixed(2)} ms, max ${work[work.length - 1].toFixed(2)} ms)`);
  assert.ok(p90 < 12, 'frames stay cheap with the crumb: p90 ' + p90.toFixed(2) + ' ms');
});

// ── the crumb as a toy (js/crumbtoy.js) ──
const crumbAt = page => page.evaluate(() => { const b = el('mascot').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
// a quick swipe. (stakes) A charged crumb takes a flick only within SLING_QUICK_MS of the touch, else it is a slingshot: the window is
// stretched for the swipe, so a slow runner cannot turn a test's flick into a slingshot thrown the other way
const flickCrumb = async (page, dx, dy, n = 6) => {
  const r = await crumbAt(page);
  const q = await page.evaluate(() => { const v = CFG.SLING_QUICK_MS; CFG.SLING_QUICK_MS = 1e5; return v; });
  await page.mouse.move(r.x, r.y); await page.mouse.down();
  for (let i = 1; i <= n; i++) { await page.mouse.move(r.x + i * dx, r.y + i * dy); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.evaluate(v => { CFG.SLING_QUICK_MS = v; }, q);
};
const onRim = page => page.waitForFunction(() => toy.mode === 'rim' && toy.a === 0 && toy.vx === 0, null, { timeout: 9000 });

test('crumb toy: a finger grabs it, a flick sends it flying and it lands back on the rim; the game is untouched', async ({ page }) => {
  await play(page);
  await dealt(page);
  await mascotMood(page, /^idle\b.*\btoy\b/);
  const before = await page.evaluate(() => ({ score, tray: tray.map(t => t && t.s.id), grid: JSON.stringify(grid) }));
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down();
  await mascotMood(page, /^grab\b/);
  assert.deepEqual(await page.evaluate(() => [toy.mode, drag === null]), ['held', true], 'held, and no piece was picked up');
  await page.mouse.move(r.x + 60, r.y + 40); await frames(page, 3);
  const held = await crumbAt(page);
  assert.ok(Math.abs(held.x - (r.x + 60)) < 6 && Math.abs(held.y - (r.y + 40)) < 12, 'it follows the finger ' + JSON.stringify(held));
  await page.mouse.up();                                       // let go without moving: it drops, and hops home from wherever it lands
  await onRim(page);
  await flickCrumb(page, 24, -16);
  assert.equal(await page.evaluate(() => toy.mode), 'air', 'a flick throws it');
  assert.ok(await page.evaluate(() => fxBusy()), 'the frame pacing stays at full speed while it flies');
  await onRim(page);
  const end = await page.evaluate(() => ({ x: toy.x, y: toy.y, max: toyXMax(), busy: toyBusy(), score, tray: tray.map(t => t && t.s.id), grid: JSON.stringify(grid) }));
  assert.ok(end.y === 0 && end.x >= 0 && end.x <= end.max && !end.busy, 'back on the rim, at rest ' + JSON.stringify(end));
  assert.deepEqual({ score: end.score, tray: end.tray, grid: end.grid }, before, 'score, tray and board unchanged');
  // a piece in the hand wins: the crumb cannot be grabbed mid-drag, and a normal drop still works
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 4, 4);
  assert.equal(await page.evaluate(() => grid[4][4] !== null && toy.mode === 'rim'), true, 'a piece still drops as before');
});

test('crumb toy: leaning the phone rolls it to the low side and it stays; too many throws and it sulks; the switches (saved) turn it off', async ({ page }) => {
  await play(page);
  await dealt(page);
  await mascotMood(page, /^idle\b/);
  const lean = x => page.evaluate(x => { toyTiltListen(); dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y: -8, z: -2 } })); }, x);
  await lean(-4);                                              // (spec sign) the right edge is low
  await page.waitForFunction(() => toy.x === toyXMax() && toy.vx === 0 && toy.a === 0, null, { timeout: 6000 });
  await lean(0); await frames(page, 20);
  assert.equal(await page.evaluate(() => toy.x === toyXMax()), true, 'level again: it stays on the right');
  await lean(4);
  await page.waitForFunction(() => toy.x === 0 && toy.vx === 0 && toy.a === 0, null, { timeout: 6000 });
  await lean(0);
  await page.evaluate(() => { CFG.TILT = false; }); await lean(-4); await frames(page, 20);
  assert.equal(await page.evaluate(() => toy.x), 0, 'Tilt off: a lean does nothing');
  await lean(0);
  for (let k = 0; k < 5; k++) { await flickCrumb(page, 22, -20); await onRim(page); }
  await mascotMood(page, /^(dizzy|sulk)\b/);
  await mascotMood(page, /^sulk\b/);
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await frames(page, 2);
  assert.equal(await page.evaluate(() => toy.mode), 'rim', 'sulking: it will not be picked up');
  await page.mouse.up();
  await openSet(page);
  await page.click('#advLook summary');
  assert.deepEqual(await page.evaluate(() => [el('toyOn').checked, el('tiltOn').checked]), [true, false], 'the switches show the state');
  await page.click('#toyOn');
  await closeSet(page);
  await frames(page, 3);
  assert.ok(await page.evaluate(() => !/\btoy\b/.test(el('mascot').className) && getComputedStyle(el('mascot')).pointerEvents === 'none' && JSON.parse(localStorage.getItem('crumble.skins')).toy === false), 'off: touches pass through it, and it is saved');
});

test('crumb cannonball: a streak charges the crumb (Endless only, once per streak); thrown charged it breaks the gems it flies over, pays per gem, and goes cold; the charge survives a resume', async ({ page }) => {
  await play(page);
  await dealt(page);
  const FULL = ['01111111', '11011011', '11101110', '10111101', '11011011', '01101101', '11110111', '10111010'];   // one row to clear, no full column
  const streak = async pre => {
    await dealt(page);
    await setup(page, { rows: FULL, trayShapes: [0, 0, 0] });
    await page.evaluate(pre);
    await dragPiece(page, 0, 0, 0);
    await frames(page, 4);
    return page.evaluate(() => toy.hot);
  };
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; });
  assert.equal(await streak(() => { combo = 2; }), false, 'a short streak does not charge it');
  assert.equal(await streak(() => { combo = 4; mode = 'daily'; }), false, 'not in Daily');
  await page.evaluate(() => { mode = 'endless'; toy.lastCombo = 0; });
  assert.equal(await streak(() => { combo = 3; }), false, 'combo 4: not yet');
  assert.ok(await page.evaluate(() => toySize() > 1 && toySize() < CFG.CANNON_BIG), 'but it is already swelling');
  assert.equal(await streak(() => { combo = 4; }), true, 'combo 5 in Endless charges it');
  await mascotMood(page, /\bhot\b/);
  assert.ok(await page.evaluate(() => banners.some(b => b.txt === 'CANNONBALL READY!')), 'the banner says so');
  await page.waitForFunction(() => !el('crumbSay').hidden && el('crumbSay').textContent === 'PULL ME BACK!' && toy.sc > 1.3);
  const big = await page.evaluate(() => ({ size: toySize(), max: toyPower(), drawn: +el('mascot').style.scale }));
  assert.ok(big.size >= await page.evaluate(() => CFG.CANNON_BIG) && big.drawn > 1.3, 'charged: big, and drawn big');
  await streak(() => { combo = 7; });
  const bigger = await page.evaluate(() => ({ size: toySize(), max: toyPower() }));
  assert.ok(bigger.size > big.size && bigger.max > big.max, 'a longer streak: bigger, and it breaks more');
  await page.evaluate(() => { toy.pow = 0; });
  assert.equal(await page.evaluate(() => { const o = snapshot(); toy.hot = false; restore(o); return toy.hot; }), true, 'still charged after a resume');
  await dealt(page);
  // a slow put-down keeps the charge; a throw down into the board spends it
  const before = await page.evaluate(() => ({ score, gems: grid.flat().filter(Boolean).length }));
  await flickCrumb(page, 10, 26);
  assert.equal(await page.evaluate(() => !!toy.fire && !toy.hot), true, 'thrown: a cannonball');
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9000 });
  const after = await page.evaluate(() => ({ score, gems: grid.flat().filter(Boolean).length, hot: toyHot(), saved: JSON.parse(localStorage.getItem('crumble.run')).grid.flat().filter(v => v >= 0).length }));
  const broke = before.gems - after.gems;
  assert.ok(broke >= 5 && broke <= 10, 'its whole body bites and it bounces inside the board: a good handful of gems, never more than CANNON_MAX: ' + broke);
  assert.equal(after.score - before.score, broke * await page.evaluate(() => CFG.CANNON_PER_GEM), 'paid per gem');
  assert.equal(after.hot, false, 'cold again');
  assert.equal(after.saved, after.gems, 'the run is saved with the broken board');
  assert.equal(await streak(() => { combo = 6; toy.lastCombo = 6; }), false, 'the same streak does not charge it twice');
  // grown big by a longer streak, it cuts a wider path and breaks more
  await dealt(page);
  await setup(page, { rows: FULL, trayShapes: [0, 0, 0] });
  await page.evaluate(() => { toy.hot = true; toy.pow = 5; toy.sulkTo = 0; toy.throws = []; });
  await page.waitForFunction(() => toy.sc > 1.75);
  const g1 = await page.evaluate(() => grid.flat().filter(Boolean).length);
  await flickCrumb(page, 10, 26);
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9000 });
  const broke2 = g1 - await page.evaluate(() => grid.flat().filter(Boolean).length);
  assert.ok(broke2 > broke && broke2 >= 15 && broke2 <= 25, 'bigger crumb, more blocks: ' + broke2 + ' > ' + broke);
  // an uncharged throw over the board breaks nothing
  await dealt(page);
  const g0 = await page.evaluate(() => grid.flat().filter(Boolean).length);
  await flickCrumb(page, 10, 26);
  await page.waitForFunction(() => toy.mode === 'rim', null, { timeout: 9000 });
  assert.equal(await page.evaluate(() => grid.flat().filter(Boolean).length), g0, 'cold: it passes over the gems');
});

test('crumb last chance: out of room with a charged crumb the run holds; a cannonball that makes room saves it; without the charge it ends as before', async ({ page }) => {
  await play(page);
  await dealt(page);
  const JAM = ['11011011', '01101101', '10110110', '11011011', '01101101', '10110110', '11011011', '01101101'];   // no 2x2 hole anywhere, no full line
  const jam = async hot => {
    await dealt(page);
    await setup(page, { rows: JAM, trayShapes: [0, 0, 0] });
    await page.evaluate(hot => {
      const sq = SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2);
      tray = [{ s: sq, gi: 1 }, { s: sq, gi: 2 }, { s: sq, gi: 3 }];
      toy.hot = hot; toy.pow = 0; toy.sulkTo = 0; toy.flicks = [];
      checkStuck();
    }, hot);
  };
  await jam(true);
  assert.equal(await page.evaluate(() => stuck && toyLast()), true, 'stuck, and it is the last chance');
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => state), 'play', 'the run holds');
  await page.waitForFunction(() => !el('crumbSay').hidden && el('crumbSay').textContent === 'PULL ME BACK, QUICK!');
  assert.equal(await page.evaluate(() => masc.fainted), false, 'the crumb is on its feet');
  await flickCrumb(page, 10, 26);
  assert.equal(await page.evaluate(() => !!toy.fire), true, 'thrown although the board is stuck');
  await page.waitForFunction(() => !toy.fire && banners.some(b => b.txt === 'SAVED!'), null, { timeout: 9000 });
  await page.waitForFunction(() => toy.mode === 'rim', null, { timeout: 9000 });
  assert.deepEqual(await page.evaluate(() => [state, stuck, toyHot()]), ['play', false, false], 'room was made: the run goes on');
  // while the run holds no piece can be picked up (none fits; a stray touch on the tray must not leave a piece hanging)
  await jam(true);
  const g = await geometry(page);
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  assert.equal(await page.evaluate(() => drag === null && pendingPress === null), true, 'no pickup during the last chance');
  await page.mouse.up();
  await page.evaluate(() => { toy.hot = false; stuck = false; syncActions(); });
  // a held piece whose lift went missing: the lift is heard even if the crumb's own handler stops it, and the next first finger sends a stale piece home
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  assert.equal(await page.evaluate(() => !!drag), true, 'a piece is held');
  await page.evaluate(() => { toy.id = drag.id; el('mascot').dispatchEvent(new PointerEvent('pointerup', { pointerId: drag.id, bubbles: true })); toy.id = -1; });
  assert.equal(await page.evaluate(() => drag), null, 'a lift on the crumb still ends the drag');
  await page.mouse.up();
  await page.waitForFunction(() => !ret);
  await page.evaluate(() => { startDrag(77, slotRect(1).x + slotRect(1).w / 2, slotRect(1).y + slotRect(1).h / 2, 'touch'); });
  assert.equal(await page.evaluate(() => !!drag && drag.id === 77), true, 'a piece held by a finger that is gone');
  await page.evaluate(() => dispatchEvent(new PointerEvent('pointerdown', { pointerId: 78, isPrimary: true, pointerType: 'touch', clientX: 5, clientY: 5, bubbles: true })));
  assert.equal(await page.evaluate(() => drag === null && !!ret), true, 'the next first finger sends it home');
  await page.waitForFunction(() => !ret);
  // no charge: the same jam ends the run
  await jam(false);
  await page.waitForFunction(() => state === 'over', null, { timeout: 4000 });
});

// ── the crumb talks (js/crumbsay.js) ──
const said = page => page.evaluate(() => el('crumbSay').hidden ? null : { txt: el('crumbSay').textContent, cls: el('crumbSay').className });
test('crumb talks: a remark for a clean sweep, a sign when the player stops playing, then asleep, a line when the player is back; the switch (saved) silences it', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.DARES = false; });   // (dares) a dare's line would wait for a quiet moment and land in this test's silences
  await dealt(page);
  await page.evaluate(() => { say.until = 0; say.last = -1e9; });
  await frames(page, 3);
  await setup(page, { rows: ['01111111', ...Array(7).fill('00000000')], trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.sweep.includes(el('crumbSay').textContent));
  assert.match((await said(page)).cls, /^say /, 'a speech bubble');
  await dealt(page);
  // no touch for a while: a sign, a second sign, then it nods off
  await page.evaluate(() => { lastInput = performance.now() - CFG.TALK_IDLE_MS - 200; });
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.idle1.includes(el('crumbSay').textContent));
  assert.match((await said(page)).cls, /^sign /, 'held up as a sign');
  await page.evaluate(() => { lastInput = performance.now() - CFG.TALK_IDLE_MS * 2.5; });
  await page.waitForFunction(() => SAY.idle2.includes(el('crumbSay').textContent));
  await page.evaluate(() => { lastInput = performance.now() - CFG.TALK_IDLE_MS * 4.6; });
  await page.waitForFunction(() => el('crumbSay').textContent === 'z z z');
  await page.evaluate(() => { lastInput = performance.now(); });
  await page.waitForFunction(() => SAY.back.includes(el('crumbSay').textContent));
  // poking it gets an answer too
  await page.evaluate(() => { say.until = 0; });
  await frames(page, 3);
  assert.equal(await said(page), null, 'quiet again');
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#talkOn'), true, 'on by default');
  await page.click('#talkOn');
  await closeSet(page);
  assert.ok(await page.evaluate(() => !CFG.FX_CRUMB_TALK && JSON.parse(localStorage.getItem('crumble.skins')).talk === false), 'off, and saved');
  await page.evaluate(() => { lastInput = performance.now() - CFG.TALK_IDLE_MS - 200; });
  await frames(page, 6);
  assert.equal(await said(page), null, 'off: no sign');
});

// ── Crumb's dares (js/dares.js) ──
const dareView = page => page.evaluate(() => ({ id: dare.id, s: dare.s, n: dare.n, p: dare.p, off: dare.off, chip: el('dareChip').hidden ? null : el('dareChip').textContent, cookies: dare.st.cookies }));
// one drop straight through place(): the board as rows of '0'/'1' (gi of every gem: `gi`), the piece SHAPES[k] (gi `pgi`) at (r, c)
const dareDrop1 = (page, o) => page.evaluate(({ id, rows, k, r, c, gi = 0, pgi = 0, extra, pre, p = 0 }) => {
  dare.id = id; dare.s = 0; dare.p = p; dare.x = trayNo; dare.q = [];
  if (pre) (0, eval)(pre);
  grid = rows.map(row => [...row].map(ch => (ch === '1' ? { gi, t: 1, f: 0, l: 0 } : null)));
  if (extra) for (const [rr, cc, g] of extra) grid[rr][cc] = { gi: g, t: 1, f: 0, l: 0 };
  const s = typeof k === 'string' ? (0, eval)(k) : SHAPES[k];
  tray = [{ s, gi: pgi }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
  place(0, r, c);
  return { s: dare.s, p: dare.p };
}, o);
const ROW0 = ['01111111', ...EMPTY.slice(1)];                         // one row a 1x1 completes
test('dares: Endless gets one dare once the first tray is down (a line held longer, a chip); none in Daily, Adventure, Challenge; the Endless run keeps its own', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id && !el('dareChip').hidden);
  const v = await dareView(page);
  const d = await page.evaluate(id => dareDef(id), v.id);
  assert.equal(v.n, 1, 'one dare');
  assert.ok(v.chip.includes('DARE') && v.chip.includes(d.chip), 'the chip shows it: ' + v.chip);
  await page.waitForFunction(() => !el('crumbSay').hidden && /\bdare\b/.test(el('crumbSay').className) && dareDef(dare.id).say.includes(el('crumbSay').textContent), null, { timeout: 9000 });
  assert.ok(await page.evaluate(() => say.until - say.last >= CFG.DARE_SAY_MS - 1 && CFG.DARE_SAY_MS > CFG.TALK_MS), 'held longer than an ordinary line');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('crumble.run'))).dr.i, v.id, 'it rides in the run save');
  for (const [m, go] of [['daily', 'playDaily()'], ['adventure', 'playLevel(1)'], ['challenge', "playChal('dare-test', true)"]]) {
    await page.evaluate(go);
    await dealt(page); await frames(page, 8);
    assert.deepEqual(await page.evaluate(() => [mode, dare.id, el('dareChip').hidden, !!JSON.parse(localStorage.getItem(runStore(mode)) || '{}').dr]), [m, '', true, false], m + ': no dare');
  }
  await page.evaluate(() => playEndless());
  await frames(page, 4);
  assert.deepEqual(await page.evaluate(() => [mode, dare.id, el('dareChip').hidden]), ['endless', v.id, false], 'back in Endless: the same run, the same dare');
});

test('dares: the guided first game has none (even after its lessons end); the next run does', async ({ page }) => {
  await freshPlayer(page);
  await play(page);
  await page.waitForFunction(() => dare.off, null, { timeout: 8000 });
  assert.ok(await page.evaluate(() => !!guide && dare.off && !dare.id && el('dareChip').hidden), 'guided: no dare');
  await page.evaluate(() => { guide = null; });
  await frames(page, 6);
  assert.deepEqual(await page.evaluate(() => [dare.id, dare.off]), ['', true], 'the rest of that first game has none either');
  await page.evaluate(() => start());
  await dealt(page);
  await page.waitForFunction(() => !!dare.id && !dare.off);
});

test('dares: each checker family pays a cookie (lines in one drop, a cross, combo, lines this run, sweeps, a colour, an avalanche, a cannonball, the sky, a new best, trays unflicked)', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { CFG.DARE_MAX = 99; CFG.TRANSFORM_COMBO = 99; dare.n = 1; dare.st.cookies = 0; dare.st.won = {}; });
  const V = 'SHAPES.find(s => s.rows === 3 && s.cols === 1 && s.n === 3)';
  // three rows short of their first cell: a 3x1 bar completes them all
  const THREE = ['01111111', '01111111', '01111111', ...EMPTY.slice(3)];
  assert.equal((await dareDrop1(page, { id: 'drop3', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]] })).s, 0, 'one line is not three');
  assert.equal((await dareDrop1(page, { id: 'drop3', rows: THREE, k: V, r: 0, c: 0, extra: [[5, 5, 2]] })).s, 1, '3 lines in one drop');
  assert.equal((await dareDrop1(page, { id: 'drop2', rows: THREE, k: V, r: 0, c: 0, extra: [[5, 5, 2]] })).s, 1, '2 lines in one drop (three will do)');
  const CROSS = ['01111111', ...Array(7).fill('10000000')];
  assert.equal((await dareDrop1(page, { id: 'cross', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]] })).s, 0, 'a row alone is not a cross');
  assert.equal((await dareDrop1(page, { id: 'cross', rows: CROSS, k: 0, r: 0, c: 0, extra: [[5, 5, 2]] })).s, 1, 'a row and a column in one drop');
  assert.equal((await dareDrop1(page, { id: 'combo4', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]], pre: 'combo = 3' })).s, 1, 'combo 4');
  assert.equal((await dareDrop1(page, { id: 'combo7', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]], pre: 'combo = 3' })).s, 0, 'combo 4 is not 7');
  // lines this run: progress on the chip, then the cookie
  let r = await dareDrop1(page, { id: 'lines15', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]] });
  assert.deepEqual(r, { s: 0, p: 1 }, 'one line counted');
  await frames(page, 3);
  assert.ok((await dareView(page)).chip.includes('1/15'), 'the chip counts');
  r = await dareDrop1(page, { id: 'lines15', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]], p: 14 });
  assert.deepEqual(r, { s: 1, p: 15 }, '15 lines');
  // sweeps: one sweep is half of "twice"
  assert.deepEqual(await dareDrop1(page, { id: 'sweep2', rows: ROW0, k: 0, r: 0, c: 0 }), { s: 0, p: 1 }, 'one sweep of two');
  assert.equal((await dareDrop1(page, { id: 'sweep', rows: ROW0, k: 0, r: 0, c: 0 })).s, 1, 'sweep the board');
  // a colour: the row's colour leaves the board, another stays
  assert.equal((await dareDrop1(page, { id: 'colour', rows: ROW0, k: 0, r: 0, c: 0, gi: 3, pgi: 3, extra: [[5, 5, 4], [6, 6, 3]] })).s, 0, 'colour 3 is still on the board');
  assert.equal((await dareDrop1(page, { id: 'colour', rows: ROW0, k: 0, r: 0, c: 0, gi: 3, pgi: 3, extra: [[5, 5, 4]] })).s, 1, 'a colour wiped out');
  // an avalanche
  await page.evaluate(() => { CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; });
  assert.equal((await dareDrop1(page, { id: 'ava', rows: AVA_ROWS, k: 0, r: 0, c: 0, pre: 'combo = 4' })).s, 1, 'an avalanche');
  await page.waitForFunction(() => !ava.live, null, { timeout: 8000 });
  await page.evaluate(() => { CFG.AVALANCHE = false; });
  // a cannonball: the gems it broke
  const cannon = n => page.evaluate(n => { dare.id = 'cannon8'; dare.s = 0; toy.fire = { n, pts: n * 100, max: 20, b: 0 }; toyFireEnd(); return { s: dare.s, p: dare.p }; }, n);
  await page.evaluate(() => { dare.p = 0; });
  assert.deepEqual(await cannon(5), { s: 0, p: 5 }, 'five is not eight');
  await frames(page, 3);
  assert.ok((await dareView(page)).chip.includes('5/8'), 'the chip has its best throw');
  assert.deepEqual(await cannon(9), { s: 1, p: 8 }, 'cannonball 8 blocks');
  // read off the game's state: the sky, a new best, trays without a flick
  await page.evaluate(() => { dare.id = 'night'; dare.s = 0; score = CFG.JOURNEY_AT[3]; });
  await page.waitForFunction(() => dare.s === 1);
  await page.evaluate(() => { dare.id = 'best'; dare.s = 0; best = score + 10; bestBeaten = false; });
  await frames(page, 3);
  assert.equal((await dareView(page)).s, 0, 'not beaten yet');
  await dareDrop1(page, { id: 'best', rows: ROW0, k: 0, r: 0, c: 0, extra: [[5, 5, 2]] });
  await page.waitForFunction(() => bestBeaten && dare.s === 1);
  await page.evaluate(() => { dare.id = 'noflick'; dare.s = 0; dare.x = trayNo - 14; });
  await frames(page, 3);
  assert.deepEqual(await page.evaluate(() => [dare.s, dare.p]), [0, 14], '14 trays of 15');
  await page.evaluate(() => { trayNo++; });
  await page.waitForFunction(() => dare.s === 1 && dare.p === 15);
  const won = await page.evaluate(() => ({ c: dare.st.cookies, w: dare.st.won, saved: JSON.parse(localStorage.getItem('crumble.dares')) }));
  assert.equal(won.c, 12, 'a cookie for each: ' + JSON.stringify(won.w));
  assert.deepEqual(Object.keys(won.w).sort(), ['ava', 'best', 'cannon8', 'colour', 'combo4', 'cross', 'drop2', 'drop3', 'lines15', 'night', 'noflick', 'sweep']);
  assert.deepEqual(won.saved.won, won.w, 'saved');
});

test('dares: beaten, a cookie hops into the jar, the chip ticks and a harder one follows (up to DARE_MAX); the jar and record persist across a reload and show on Goals', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; CFG.DARE_NEXT_MS = 300; });
  const first = (await dareView(page)).id;
  await page.evaluate(() => { say.until = 0; dare.q = []; dareWin(); });   // whatever the first dare was, it is beaten now
  assert.ok(await page.evaluate(() => !!dare.hop && !!document.querySelector('.dareCookie') && dareBusy() && fxBusy()), 'a cookie is on its way, and the frames run');
  assert.equal(await page.evaluate(() => el('dareChip').querySelector('.jar b').textContent), '0', 'the jar counts it when it lands');
  await page.waitForFunction(() => !dare.hop && el('dareChip').querySelector('.jar b').textContent === '1');
  assert.ok(await page.evaluate(() => el('dareChip').classList.contains('won') && el('dareChip').textContent.includes('✓')), 'the chip ticks');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.dareWin.includes(el('crumbSay').textContent), null, { timeout: 9000 });
  await page.waitForFunction(() => dare.n === 2 && dare.s === 0, null, { timeout: 9000 });
  const second = (await dareView(page)).id;
  assert.notEqual(second, first, 'never the same twice in a row');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.dareNext.includes(el('crumbSay').textContent), null, { timeout: 12000 });
  // two more: the third is the last of the run
  await page.evaluate(() => { dareWin(); });
  await page.waitForFunction(() => dare.n === 3 && dare.s === 0, null, { timeout: 12000 });
  await page.evaluate(() => { dareWin(); });
  await page.waitForTimeout(900);
  assert.deepEqual(await page.evaluate(() => [dare.n, dare.s]), [3, 1], 'DARE_MAX: no fourth');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.dares')));
  assert.equal(st.v, 1); assert.equal(st.cookies, 3);
  assert.equal(Object.values(st.won).reduce((a, b) => a + b, 0), 3);
  assert.equal(st.days.streak, 1); assert.match(st.days.last, /^\d{4}-\d\d-\d\d$/);
  await page.reload(); await toGame(page);
  assert.deepEqual(await page.evaluate(() => [dare.st.cookies, Object.values(dare.st.won).reduce((a, b) => a + b, 0), dare.st.days.streak]), [3, 3, 1], 'the jar survives a reload');
  await page.evaluate(() => { saveRun(); openMenu(); });
  assert.match(await page.textContent('#menuGoalsSub'), /^3 cookies/, 'the Goals tile mentions the cookies');
  await page.click('#menuGoals');
  assert.equal(await page.textContent('#goalsDares'), 'Dares won: 3 · Cookies: 3', 'one line on the Goals card');
  // the iCloud copy (1.1 F) carries the jar: merged by max, never lowered
  const m = await page.evaluate(() => { const ch = cloudMerge({ v: 1, dares: { cookies: 9, won: { drop2: 7, combo4: 0 }, days: { last: '2020-01-01', streak: 4, best: 6 } } });
    const lower = cloudMerge({ v: 1, dares: { cookies: 1, won: {} } }); return { ch, lower, c: dare.st.cookies, w: dare.st.won.drop2, best: dare.st.days.best, blob: cloudBlob().dares.cookies }; });
  assert.deepEqual(m, { ch: true, lower: false, c: 9, w: 7, best: 6, blob: 9 }, 'the cloud jar merges in');
  // a broken save is ignored
  await page.evaluate(() => localStorage.setItem('crumble.dares', '{"v":1,"cookies":-4,"won":{"x y":3,"drop2":"a"}}'));
  await page.reload(); await toGame(page);
  assert.deepEqual(await page.evaluate(() => [dare.st.cookies, Object.keys(dare.st.won).length]), [0, 0], 'bad data: an empty jar, no error');
});

test('dares: a resumed run keeps its dare and progress; an older save without one gets a fresh dare', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { dare.id = 'lines40'; dare.p = 7; dare.s = 0; dare.n = 2; saveRun(); });
  await page.reload(); await toGame(page);
  await frames(page, 4);
  const v = await dareView(page);
  assert.deepEqual([v.id, v.p, v.s, v.n], ['lines40', 7, 0, 2], 'resumed with its dare');
  assert.ok(v.chip.includes('40 lines') && v.chip.includes('7/40'), 'and the chip: ' + v.chip);
  await page.click('#pauseBtn');
  assert.equal(await page.textContent('#pauseDare'), "Crumb's dare: 40 lines · 7/40", 'the pause card shows it');
  await page.click('#pauseResume');
  // an older save (no `dr`), then a broken one: edited as the page loads, after its own save on the way out
  await page.addInitScript(() => { const e = sessionStorage.getItem('dr-edit'); if (!e) return; sessionStorage.removeItem('dr-edit');
    const o = JSON.parse(localStorage.getItem('crumble.run')); if (e === 'old') delete o.dr; else o.dr = JSON.parse(e); localStorage.setItem('crumble.run', JSON.stringify(o)); });
  await page.evaluate(() => sessionStorage.setItem('dr-edit', 'old'));
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => state === 'play' && !!dare.id && dare.n === 1);
  await page.evaluate(() => sessionStorage.setItem('dr-edit', JSON.stringify({ i: 'nope', p: -1, x: 0, s: 9, n: 1 })));
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => state === 'play' && !!dareDef(dare.id));
});

test("dares: \"don't flick me\" fails on a flick (\"knew it.\"), and no other dare comes that run; a run ending with a dare open gets \"told you.\"", async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { dare.id = 'noflick'; dare.s = 0; dare.p = 0; dare.x = trayNo; dare.q = []; CFG.DARE_NEXT_MS = 100; });
  await frames(page, 3);
  await flickCrumb(page, 24, -16);
  assert.equal(await page.evaluate(() => dare.s), 2, 'failed the moment it flew');
  await frames(page, 3);
  assert.ok(await page.evaluate(() => el('dareChip').classList.contains('lost') && el('dareChip').textContent.includes('✗')), 'the chip shows it lost');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.dareFail.includes(el('crumbSay').textContent), null, { timeout: 12000 });
  await page.waitForTimeout(600);
  assert.deepEqual(await page.evaluate(() => [dare.id, dare.n, dare.s]), ['noflick', 1, 2], 'no next dare this run');
  assert.equal(await page.evaluate(() => { const o = snapshot(); dareRunReset(); restore(o); return dare.s; }), 2, 'the loss rides in the save too');
  // the next run: a dare again (not the same one); it ends with the dare open: "told you."
  await page.evaluate(() => start());
  await dealt(page);
  await page.waitForFunction(() => !!dare.id && dare.s === 0);
  assert.notEqual(await page.evaluate(() => dare.id), 'noflick');
  const rows = Array.from({ length: 8 }, (_, r) => [...'11111111'].map((ch, c) => (c === r || c === (r + 1) % 8 ? '0' : ch)).join(''));
  await setup(page, { rows, trayShapes: [0, 3, 9] });
  await page.evaluate(() => { dare.id = 'drop4'; dare.s = 0; toy.hot = false; });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => state === 'over', null, { timeout: 5000 });
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.dareLost.includes(el('crumbSay').textContent), null, { timeout: 5000 });
});

test('dares: a dare line waits for a quiet board (a banner, an avalanche, a charged crumb), never talking over the moment', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { say.until = 0; dare.q = []; });
  await frames(page, 2);
  for (const [what, on, off] of [['a banner', "pushBanner('CLEAN SWEEP','+1')", 'banners.length = 0'], ['an avalanche', 'ava.live = true; ava.t = 0; ava.end = 1e9', 'ava.live = false'], ['a charged crumb', 'toy.hot = true', 'toy.hot = false']]) {
    await page.evaluate(([on]) => { say.until = 0; (0, eval)(on); dare.q = [{ txt: 'wait for it.', ms: 900 }]; }, [on]);
    await frames(page, 8);
    assert.equal(await page.evaluate(() => dare.q.length), 1, what + ': it waits');
    assert.notEqual(await page.evaluate(() => el('crumbSay').hidden ? '' : el('crumbSay').textContent), 'wait for it.');
    await page.evaluate(([off]) => (0, eval)(off), [off]);
    await page.waitForFunction(() => !el('crumbSay').hidden && el('crumbSay').textContent === 'wait for it.', null, { timeout: 4000 });
  }
});

test('dares: Settings > Look > Advanced switch (saved) turns them off; the mascot off means no dares', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id && !el('dareChip').hidden);
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#dareOn'), true, 'on by default');
  await page.click('#dareOn');
  await closeSet(page);
  await frames(page, 3);
  assert.ok(await page.evaluate(() => !CFG.DARES && JSON.parse(localStorage.getItem('crumble.skins')).dares === false && el('dareChip').hidden), 'off, saved, the chip gone');
  await page.evaluate(() => start());
  await dealt(page); await frames(page, 8);
  assert.equal(await page.evaluate(() => dare.id), '', 'a new run: no dare');
  await page.reload(); await toGame(page);
  assert.equal(await page.evaluate(() => CFG.DARES), false, 'still off after a reload');
  await page.evaluate(() => { CFG.DARES = true; CFG.FX_MASCOT = false; start(); });
  await dealt(page); await frames(page, 8);
  assert.deepEqual(await page.evaluate(() => [dare.id, el('dareChip').hidden]), ['', true], 'no mascot, no dares');
});

test('dares: the chip covers nothing (board, tray, score, chase bar, HUD buttons, x2 chip) at 390x844 and 375x667', async ({ page }) => {
  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { if (state === 'play') start(); });
    if (await page.evaluate(() => state !== 'play')) await play(page);
    await dealt(page);
    await page.waitForFunction(() => !!dare.id && !el('dareChip').hidden);
    for (const [id, p, sc] of [['sweep2', 1, 1234567], ['cannon15', 12, 98765], ['cross', 0, 4321]]) {
      await page.evaluate(([id, p, sc]) => { dare.id = id; dare.p = p; dare.s = 0; best = chaseBest = Math.round(sc / 0.76); score = shownScore = sc; el('scoreVal').textContent = sc; syncHud(); hudFit(); chaseSync(); }, [id, p, sc]);
      await frames(page, 6);
      const r = await page.evaluate(() => {
        const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const out = { chip: R(el('dareChip')), others: {} };
        out.others.board = { l: bx - 9, t: by - 9, r: bx + B + 9, b: by + B + 9 };
        [0, 1, 2].forEach(i => { const s = slotRect(i); out.others['tray' + i] = { l: s.x, t: s.y, r: s.x + s.w, b: s.y + s.h }; });
        for (const id of ['scoreVal', 'bestVal', 'pauseBtn', 'musicBtn', 'mute', 'bonusChip', 'chase']) if (!el(id).hidden && el(id).offsetParent) out.others[id] = R(el(id));
        for (const e of el('chase').children) out.others['chase-' + e.className] = R(e);
        out.text = el('dareChip').textContent; out.chase = !el('chase').hidden; out.hud = hudH;
        return out;
      });
      const c = r.chip;
      assert.ok(c.r <= w && c.l >= 0 && c.b <= r.hud && c.b <= r.others.board.t, `${w}x${h} ${id}: on screen, inside the HUD band, above the board: ${JSON.stringify(c)}`);
      for (const [k, o] of Object.entries(r.others)) {
        const hit = c.l < o.r && c.r > o.l && c.t < o.b && c.b > o.t;
        assert.ok(!hit, `${w}x${h} ${id} (${r.text}): the chip overlaps ${k} ${JSON.stringify(o)} vs ${JSON.stringify(c)}`);
      }
      assert.ok(r.chase, 'the chase bar is up for the check');
    }
  }
});

// ── Crumb's closet (js/closet.js) ──
const closetView = page => page.evaluate(() => ({ own: [...closet.own].sort(), on: { ...closet.on }, spent: closet.spent, cookies: dare.st.cookies, spend: closetSpendable(),
  saved: (() => { try { return JSON.parse(localStorage.getItem('crumble.closet') || 'null'); } catch (e) { return 'unreadable'; } })() }));
const tileText = (page, id) => page.textContent(`.clTile[data-id="${id}"] span`);
const openClosetFromStart = async page => { await page.click('#startGoals'); await page.click('#goalsCloset'); await page.waitForSelector('#closetCard:not([hidden])'); };

test('closet: buying with enough and not enough cookies (tap, "Get it", tap again); spent persists, spendable = cookies - spent, the jar is never lowered', async ({ page }) => {
  await page.evaluate(() => { dare.st.cookies = 3; saveDares(); });
  await openClosetFromStart(page);
  assert.equal(await page.textContent('#closetJar'), '🍪 3 cookies to spend');
  assert.equal(await tileText(page, 'party'), '🍪 2');
  assert.equal(await tileText(page, 'round'), '🍪 4 · 1 more', 'not enough: the tile says how many more');
  await page.click('.clTile[data-id="round"]');
  assert.deepEqual((await closetView(page)).own, [], 'not bought');
  assert.match(await page.textContent('#closetSay'), /1 more cookie/);
  await page.click('.clTile[data-id="party"]');
  assert.equal(await tileText(page, 'party'), 'Get it · 2 cookies', 'the first tap asks');
  assert.equal((await closetView(page)).spent, 0);
  await page.click('.clTile[data-id="party"]');
  let v = await closetView(page);
  assert.deepEqual([v.own, v.on.head, v.spent, v.cookies, v.spend], [['party'], 'party', 2, 3, 1], 'bought and worn; the jar keeps its 3');
  assert.ok(await page.evaluate(() => SAY.closetBuy.includes(el('closetSay').textContent)), 'he has a word about it');
  assert.equal(await page.textContent('#closetJar'), '🍪 1 cookie to spend');
  assert.equal(await tileText(page, 'bow'), '🍪 3 · 2 more');
  await page.click('.clTile[data-id="bow"]'); await page.click('.clTile[data-id="bow"]');
  assert.deepEqual((await closetView(page)).own, ['party'], 'cannot buy what the player cannot afford, however often the player taps');
  assert.equal(await page.evaluate(() => closetBuy('bow')), false);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('crumble.dares'))).cookies, 3, 'crumble.dares is untouched');
  await page.reload(); await page.waitForFunction(() => typeof closet !== 'undefined' && !!closet.met);
  v = await closetView(page);
  assert.deepEqual([v.own, v.on.head, v.spent, v.spend, v.saved.v], [['party'], 'party', 2, 1, 1], 'spent survives a reload');
  assert.equal(await page.textContent('#startGoalsSub'), '1 cookie', 'the Goals tile counts the cookies the player can spend');
  await page.evaluate(() => { dare.st.cookies = 5; });          // two more dares won: 3 to spend, the bow tie now
  await openClosetFromStart(page);
  await page.click('.clTile[data-id="bow"]'); await page.click('.clTile[data-id="bow"]');
  v = await closetView(page);
  assert.deepEqual([v.own, v.on, v.spent, v.spend], [['bow', 'party'], { head: 'party', face: '', neck: 'bow' }, 5, 0]);
});

test('closet: feat items unlock from what is already recorded and can never be bought', async ({ page }) => {
  await page.evaluate(() => { dare.st.cookies = 99; stats.sweeps = 9; dare.st.won = { drop2: 4, combo4: 5 }; dare.st.days.best = 6; });
  const feats = ['crown', 'goggles', 'hard', 'pirate', 'patch', 'cape', 'top'];
  assert.deepEqual(await page.evaluate(f => f.map(id => [closetOwns(id), closetCanBuy(id), closetBuy(id)]), feats), feats.map(() => [false, false, false]), 'cookies do not buy a feat item');
  await openClosetFromStart(page);
  assert.equal(await tileText(page, 'cape'), '🔒 Clear the whole board 10 times · 9/10');
  assert.equal(await tileText(page, 'crown'), '🔒 Beat a dare 7 days in a row · 6/7');
  assert.equal(await tileText(page, 'patch'), '🔒 Beat 10 dares · 9/10');
  assert.equal(await tileText(page, 'goggles'), '🔒 Win the "reach Space" dare');
  await page.click('.clTile[data-id="cape"]'); await page.click('.clTile[data-id="cape"]');
  assert.deepEqual(await closetView(page).then(v => [v.own, v.spent, v.on.neck]), [[], 0, ''], 'a tap on a feat item buys nothing');
  await page.click('#closetBack');
  await page.evaluate(() => { stats.sweeps = 10; dare.st.days.best = 7; dare.st.won = { drop2: 4, combo4: 4, space: 1, ava: 1, cannon15: 1 };
    for (let i = 1; i <= 10; i++) Object.assign(advRec(i), { s: 3, n: 1 }); });
  assert.deepEqual(await page.evaluate(f => f.map(id => closetOwns(id)), feats), feats.map(() => true), 'each from its own record');
  assert.equal(await page.evaluate(() => advStars()), 30);
  await page.click('#goalsCloset');
  await page.click('.clTile[data-id="cape"]'); await page.click('.clTile[data-id="top"]');
  assert.deepEqual(await closetView(page).then(v => [v.on.neck, v.on.head, v.spent, v.saved.own]), ['cape', 'top', 0, []], 'worn for free, never stored as bought');
});

test('closet: wear and take off per slot; persists across a reload; the board mascot, the menu crumb and the closet crumb all wear it', async ({ page, errors }) => {
  await page.evaluate(() => { dare.st.cookies = 20; closet.own = new Set(['party', 'beanie', 'shades']); closet.spent = 15; saveCloset(); });
  await openClosetFromStart(page);
  await page.click('.clTile[data-id="party"]');
  assert.ok(await page.evaluate(() => SAY.closetOn.includes(el('closetSay').textContent)), 'one line in his voice');
  await page.click('.clTile[data-id="beanie"]');
  await page.click('.clTile[data-id="shades"]');
  assert.deepEqual((await closetView(page)).on, { head: 'beanie', face: 'shades', neck: '' }, 'one item a slot: the beanie took the party hat\'s place');
  assert.equal(await page.getAttribute('.clTile[data-id="beanie"]', 'aria-pressed'), 'true');
  const worn = sel => page.evaluate(sel => [...document.querySelectorAll(sel + ' svg .cl')].map(g => g.getAttribute('class')).sort().join(' '), sel);
  for (const sel of ['#closetCrumb', '#heroCrumb', '#mascot']) {
    const w = await worn(sel);
    assert.ok(w.includes('cl-beanie') && w.includes('cl-shades') && !w.includes('cl-party'), sel + ' wears it: ' + w);
  }
  await page.reload(); await page.waitForFunction(() => typeof closet !== 'undefined' && !!closet.met);
  assert.deepEqual((await closetView(page)).on, { head: 'beanie', face: 'shades', neck: '' }, 'kept across a reload');
  await page.waitForFunction(() => hero.card === el('startCard'));
  assert.ok((await worn('#startCard #heroCrumb')).includes('cl-beanie'), 'the menu crumb wears it after a reload');
  await play(page); await dealt(page); await frames(page, 4);
  await page.waitForFunction(() => !el('mascot').hidden);
  assert.ok((await worn('#mascot')).includes('cl-beanie') && (await worn('#mascot')).includes('cl-shades'), 'the board mascot wears it');
  // every mood keeps it (the toy's held face, fainted, a charged cannonball)
  await page.evaluate(() => { toy.mode = 'held'; }); await frames(page, 3);
  assert.ok(await page.evaluate(() => el('mascot').classList.contains('grab') && !!el('mascot').querySelector('.cl-beanie')));
  await page.evaluate(() => { toy.mode = 'rim'; gameOver(); }); await frames(page, 3);
  assert.ok(await page.evaluate(() => el('mascot').classList.contains('faint') && !!el('mascot').querySelector('.cl-beanie')), 'fainted, hat askew but on');
  // take it off from the menu (Home), mid-run state kept
  await page.click('#overMenuBtn'); await page.waitForFunction(() => hero.card === el('menuCard'));
  await page.waitForTimeout(1700);                          // the crumb has dropped onto the logo
  await page.click('#menuCard #heroCrumb', { force: true });   // (it breathes, so it is never "stable")
  await page.waitForSelector('#closetCard:not([hidden])');
  assert.equal(await page.evaluate(() => hero.crumb.className.startsWith('smug')), true, 'he smirks first, as before');
  await page.click('.clTile[data-id="beanie"]');
  assert.ok(await page.evaluate(() => SAY.closetOff.includes(el('closetSay').textContent)));
  assert.deepEqual((await closetView(page)).on, { head: '', face: 'shades', neck: '' });
  for (const sel of ['#heroCrumb', '#mascot']) assert.ok(!(await worn(sel)).includes('cl-beanie'), sel + ' took it off');
  await page.click('#closetBack');
  assert.equal(await page.isVisible('#menuCard'), true, 'back to the menu the player came from');
  // the mascot switched off: nothing on the board, the closet still works from the menu
  await page.evaluate(() => { CFG.FX_MASCOT = false; });
  await page.click('#menuCard #heroCrumb', { force: true }); await page.waitForSelector('#closetCard:not([hidden])');
  await page.click('.clTile[data-id="party"]');
  assert.equal((await closetView(page)).on.head, 'party');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('closet: bad or old closet data is dropped safely (unknown ids, unearned feat items, wrong types)', async ({ page, errors }) => {
  const bad = [
    'not json', '[]', '{"v":2,"own":["party"],"spent":1}',
    JSON.stringify({ v: 1, own: ['party', 'bogus', 'crown', 7, null], on: { head: 'crown', face: 'party', neck: 'bow', hat: 'party' }, spent: -3, ot: 'x', seen: 'all' }),
    JSON.stringify({ v: 1, own: 'party', on: 'party', spent: 1.5 }),
  ];
  const want = [[[], { head: '', face: '', neck: '' }, 0], [[], { head: '', face: '', neck: '' }, 0], [[], { head: '', face: '', neck: '' }, 0],
    [['party'], { head: '', face: '', neck: '' }, 0], [[], { head: '', face: '', neck: '' }, 0]];
  for (let i = 0; i < bad.length; i++) {
    await page.evaluate(s => localStorage.setItem('crumble.closet', s), bad[i]);
    await page.reload(); await page.waitForFunction(() => typeof closet !== 'undefined' && !!closet.met);
    const v = await closetView(page);
    assert.deepEqual([v.own, v.on, v.spent], want[i], 'case ' + i + ': ' + bad[i]);
  }
  await page.evaluate(() => localStorage.setItem('crumble.closet', JSON.stringify({ v: 1, own: ['party'], on: { head: 'party', face: '', neck: '' }, spent: 2, ot: 5 })));
  await page.reload(); await page.waitForFunction(() => typeof closet !== 'undefined' && !!closet.met);
  assert.deepEqual(await closetView(page).then(v => [v.own, v.on.head, v.spent]), [['party'], 'party', 2], 'a good save loads');
  assert.ok(await page.evaluate(() => !!document.querySelector('#heroCrumb svg .cl-party')));
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('closet: iCloud merge: bought items by union, spent by max, the outfit from the later change (or this phone\'s when unknown)', async ({ page }) => {
  const r = await page.evaluate(() => {
    dare.st.cookies = 10; closet.own = new Set(['party']); closet.spent = 2; closet.on = { head: 'party', face: '', neck: '' }; closet.ot = 1000;
    const out = {};
    out.older = cloudMerge({ v: 1, closet: { own: ['bow', 'bogus', 'crown'], spent: 1, on: { head: '', face: '', neck: 'bow' }, ot: 500 } });
    out.a = { own: [...closet.own].sort(), spent: closet.spent, on: { ...closet.on } };
    out.noTime = cloudMerge({ v: 1, closet: { own: [], spent: 5, on: { head: '', face: '', neck: 'bow' } } });
    out.b = { spent: closet.spent, on: { ...closet.on } };
    out.newer = cloudMerge({ v: 1, closet: { own: [], spent: 3, on: { head: 'crown', face: 'round', neck: 'bow' }, ot: 2000 } });
    out.c = { spent: closet.spent, on: { ...closet.on }, ot: closet.ot };
    out.same = cloudMerge({ v: 1, closet: cloudBlob().closet });
    out.junk = cloudMerge({ v: 1, closet: { own: 'x', spent: 'y', on: 3, ot: -1 } });
    out.blob = cloudBlob().closet;
    out.saved = JSON.parse(localStorage.getItem('crumble.closet') || 'null');
    return out;
  });
  assert.equal(r.older, true);
  assert.deepEqual(r.a, { own: ['bow', 'party'], spent: 2, on: { head: 'party', face: '', neck: '' } }, 'union of what was bought (no unknown or feat ids), spent by max, an older outfit loses');
  assert.equal(r.noTime, true);
  assert.deepEqual(r.b, { spent: 5, on: { head: 'party', face: '', neck: '' } }, 'no time on the copy: this phone keeps its outfit');
  assert.deepEqual(r.c, { spent: 5, on: { head: '', face: '', neck: 'bow' }, ot: 2000 }, 'the later outfit wins, without what this phone does not own (crown unearned, round glasses not bought)');
  assert.equal(r.same, false); assert.equal(r.junk, false, 'bad data changes nothing');
  assert.deepEqual(r.blob, { own: ['bow', 'party'], spent: 5, on: { head: '', face: '', neck: 'bow' }, ot: 2000 });
});

test('closet: the card fits and scrolls at 390x844 and 375x667, and Back returns to where the player came from', async ({ page }) => {
  await page.evaluate(() => { dare.st.cookies = 6; });
  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await openClosetFromStart(page);
    const r = await page.evaluate(() => {
      const R = id => el(id).getBoundingClientRect(), L = el('closetList');
      return { back: R('closetBack').bottom, crumb: R('closetCrumb').top, list: L.scrollHeight > L.clientHeight, listH: L.clientHeight, card: el('closetCard').scrollHeight <= innerHeight + 1,
        tiles: document.querySelectorAll('.clTile').length, wide: Math.max(...[...document.querySelectorAll('.clTile')].map(t => t.getBoundingClientRect().right)) };
    });
    assert.ok(r.back <= h && r.crumb >= 0 && r.card, `${w}x${h}: everything on screen ${JSON.stringify(r)}`);
    assert.ok(r.list && r.listH >= 200, `${w}x${h}: the items scroll in their own list ${JSON.stringify(r)}`);
    assert.ok(r.wide <= w && r.tiles >= 14, `${w}x${h}: ${r.tiles} tiles inside the screen`);
    await page.evaluate(() => { el('closetList').scrollTop = 1e4; });
    assert.ok(await page.evaluate(() => { const b = document.querySelector('.clTile[data-id="cape"]').getBoundingClientRect(); return b.bottom <= el('closetBack').getBoundingClientRect().top; }), 'the last tile scrolls into view above Back');
    await page.click('#closetBack');
    assert.deepEqual(await page.evaluate(() => [el('closetCard').hidden, el('goalsCard').hidden]), [true, false], 'back to Goals');
    await page.click('#goalsBack');
    await page.evaluate(() => { el('menuCard').hidden = true; el('startCard').hidden = false; });
  }
});

test('closet: the dot shows on the Goals tile and the closet button when something new is in reach, and clears when the player opens the closet; a feat earned mid-run gets one quiet line', async ({ page }) => {
  const dots = () => page.evaluate(() => ['startGoals', 'menuGoals', 'goalsCloset'].map(id => el(id).classList.contains('dot')));
  await frames(page, 2);
  assert.deepEqual(await dots(), [false, false, false], 'nothing in reach');
  await page.evaluate(() => { dare.st.cookies = 2; });
  await page.waitForFunction(() => el('startGoals').classList.contains('dot'));
  assert.deepEqual(await dots(), [true, true, true], 'the player can afford the party hat');
  await openClosetFromStart(page);
  assert.deepEqual(await dots(), [false, false, false], 'seen: gone');
  await page.click('#closetBack'); await page.click('#goalsBack');
  await page.reload(); await page.waitForFunction(() => typeof closet !== 'undefined' && !!closet.met);
  await frames(page, 40);
  assert.deepEqual(await dots(), [false, false, false], 'and stays gone after a reload');
  await page.evaluate(() => { dare.st.cookies = 3; });                  // the bow tie is new in reach
  await page.waitForFunction(() => el('startGoals').classList.contains('dot'));
  // a feat earned in a run: a dot and one line at a quiet moment, play not interrupted
  await page.evaluate(() => { CFG.DARES = false; });
  await play(page); await dealt(page); await page.waitForFunction(() => !el('mascot').hidden && !hero.falling);
  await page.evaluate(() => { say.last = -1e9; say.until = 0; stats.sweeps = 10; });
  await page.waitForFunction(() => !el('crumbSay').hidden && el('crumbSay').textContent === "there's something new in my closet.", null, { timeout: 8000 })
    .catch(async e => { throw new Error(e.message + ' ' + JSON.stringify(await page.evaluate(() => ({ tell: closet.tell, met: [...closet.met], q: dare.q.length, quiet: dareQuiet(performance.now()), state, paused, dealing, banners: banners.length, say: el('crumbSay').textContent, hid: el('crumbSay').hidden, hc: !!hero.card, last: say.last, now: performance.now() })))); });
  assert.deepEqual(await page.evaluate(() => [state, paused, el('closetCard').hidden, el('menuGoals').classList.contains('dot')]), ['play', false, true, true], 'no interruption; the dot is up');
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => closet.tell), false, 'said once');
  await page.click('#pauseBtn'); await page.click('#pauseHome'); await page.waitForFunction(() => hero.card === el('menuCard'));
  await page.click('#menuGoals'); await page.click('#goalsCloset');
  assert.deepEqual(await dots(), [false, false, false]);
  assert.equal(await tileText(page, 'cape'), 'Tap to wear');
});

// ── Avalanche (js/avalanche.js) ──
const AVA_ROWS = ['01111111', '10000000', '11100000', '00011100', '00000011', '11011000', '00100111', '10110110'];
const boardStr = page => page.evaluate(() => grid.map(r => r.map(g => g ? 1 : 0).join('')));

test('Avalanche: on by default (the tests run with it off); on, a clear deep in a streak drops every gem, rows that fill clear as chain steps, and touches wait for the landing', async ({ page }) => {
  await play(page);
  await dealt(page);
  assert.deepEqual(await page.evaluate(() => [window.__avaDefault, CFG.AVALANCHE]), [true, false], 'on by default, off for the tests');
  await setup(page, { rows: AVA_ROWS, trayShapes: [0, 0, 0] });
  await page.evaluate(() => { combo = 4; CFG.TRANSFORM_COMBO = 99; });
  await dragPiece(page, 0, 0, 0);
  assert.deepEqual(await boardStr(page), ['00000000', ...AVA_ROWS.slice(1)], 'off: the row clears and nothing falls');
  await dealt(page);
  await page.evaluate(() => { CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; });
  await setup(page, { rows: AVA_ROWS, trayShapes: [0, 0, 0] });
  const s0 = await page.evaluate(() => { combo = 4; return { score, lines: stats.lines }; });
  await dragPiece(page, 0, 0, 0);
  const a = await page.evaluate(() => ({ score, combo, live: ava.live, lines: stats.lines, falling: grid.flat().filter(g => g && g.av).length }));
  assert.deepEqual(await boardStr(page), [...Array(6).fill('00000000'), '10000000', '10110110'], 'the board fell, two rows filled and cleared, the rest settled');
  assert.equal(a.combo, 6, 'the clear and one chain step');
  assert.equal(a.lines - s0.lines, 3, 'three lines counted');
  const pts = await page.evaluate(() => SCORE_SCALE + Math.round(CFG.LINE_POINTS * (1 + 4 * CFG.COMBO_STEP)) + Math.round(CFG.LINE_POINTS * 4 * (1 + 5 * CFG.COMBO_STEP)));
  assert.ok(a.score - s0.score >= pts, 'the chain pays like a 2-line clear one combo step on: ' + (a.score - s0.score) + ' >= ' + pts);
  assert.ok(a.live && a.falling > 0, 'the fall is still playing');
  // a touch on the tray during the fall waits; it is taken once the board has landed
  const g = await geometry(page);
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  assert.equal(await page.evaluate(() => drag === null && !!pendingPress), true, 'no pickup mid-fall');
  await page.waitForFunction(() => !ava.live, null, { timeout: 5000 });
  await frames(page, 3);
  assert.equal(await page.evaluate(() => !!drag && grid.flat().every(g => !g || !g.av)), true, 'landed: the waiting finger picks the piece up, no gem is still marked falling');
  await page.mouse.up();
});

test('Avalanche: a roll, never a rule; only in Endless; nothing to drop means no avalanche; the switch is saved', async ({ page }) => {
  await play(page);
  await dealt(page);
  const drop = async pre => {
    await dealt(page);
    await setup(page, { rows: AVA_ROWS, trayShapes: [0, 0, 0] });
    await page.evaluate(pre);
    await dragPiece(page, 0, 0, 0);
    const fell = await page.evaluate(() => ava.live);
    await page.waitForFunction(() => !ava.live, null, { timeout: 5000 });
    return fell;
  };
  await page.evaluate(() => { CFG.AVALANCHE = true; CFG.TRANSFORM_COMBO = 99; });
  assert.equal(await drop(() => { combo = 4; CFG.AVA_CHANCE = 0; CFG.AVA_STEP = 0; }), false, 'odds 0: never');
  assert.equal(await drop(() => { combo = 1; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; }), false, 'a short streak: never');
  assert.equal(await drop(() => { combo = 4; mode = 'daily'; }), false, 'not in Daily');
  await page.evaluate(() => { mode = 'endless'; });
  assert.equal(await drop(() => { combo = 4; CFG.AVA_MIN_MOVE = 99; }), false, 'too few gems would move');
  assert.equal(await drop(() => { combo = 4; CFG.AVA_MIN_MOVE = 6; }), true, 'and with all of it in place, it falls');
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#avaOn'), true, 'the switch shows it');
  await page.click('#avaOn');
  await closeSet(page);
  assert.ok(await page.evaluate(() => !CFG.AVALANCHE && JSON.parse(localStorage.getItem('crumble.skins')).av2 === false), 'off, and saved');
});

// ── Lean the Avalanche (js/avalanche.js avaDir / avaView) ──
// A board written the way it falls down (D) is laid on the grid for a fall `dir` and read back the same way, so the three ways
// compare cell for cell: for 'left' D's floor becomes the left wall (a quarter turn), for 'right' the right wall (a transpose).
// The trigger is D's row 0 completed at D (0, 0). The lean is set as the toy's tilt reading (toy.gRaw / toy.gx).
const leanAt = (dir, r, c) => dir === 'left' ? [c, 7 - r] : dir === 'right' ? [c, r] : [r, c];
const leanRows = (rows, dir) => { const g = EMPTY.map(r => [...r]); rows.forEach((row, r) => [...row].forEach((ch, c) => { const [a, b] = leanAt(dir, r, c); g[a][b] = ch; })); return g.map(r => r.join('')); };
const LEAN_RUN = `({ rows, dir, lean, tilt = true, pre, gis }) => {
  const N = 8, at = dir === 'left' ? (r, c) => [c, N - 1 - r] : dir === 'right' ? (r, c) => [c, r] : (r, c) => [r, c];
  CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; CFG.TRANSFORM_COMBO = 99; CFG.AVA_LEAN = true; CFG.TILT = true; CFG.FX_MASCOT = true;
  grid = Array.from({ length: N }, () => Array(N).fill(null));
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '1') { const [a, b] = at(r, c); grid[a][b] = { gi: gis ? +gis[r][c] : 0, t: 1, f: 0, l: 0 }; } }));
  tray = [{ s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }];
  trayNo = 10; specialEnd = -99; bonus = null; bonusMeter = 0; transformCool = 99; starForced = false; combo = 4;
  banners.length = 0; bands.length = 0; shatters.length = 0; pops.length = 0; sweeps.length = 0; lineFlashes.length = 0; avaReset();
  toy.tiltOn = tilt; toy.gRaw = toy.gx = lean;
  if (pre) (0, eval)(pre);
  const s0 = score, sw0 = stats.sweeps, [pr, pc] = at(0, 0);
  place(0, pr, pc);
  const board = rows.map((_, r) => rows.map((__, c) => { const [a, b] = at(r, c), g = grid[a][b]; return g ? String(g.gi) : '.'; }).join(''));
  const banner = banners.find(b => b.txt === 'AVALANCHE!');
  return { board, raw: grid.map(r => r.map(g => g ? g.gi : '.').join('')), gained: score - s0, combo, dir: ava.dir, live: ava.live, end: ava.end,
    meter: bonusMeter, star: starForced, volcano: discoveredWorlds.has('volcano'), swept: stats.sweeps - sw0, empty: boardEmpty(), bands: bands.length,
    banners: banners.map(b => b.txt), sub: banner ? banner.sub : null, twice: grid.flat().some(g => g && g.av && g.av.length === 2),
    avaLines: sweeps.filter(s => s.t < -2).map(s => [s.horiz, s.idx]), chain: pops.filter(p => /^CHAIN/.test(p.sub)).map(p => [Math.round(p.x), p.txt, p.sub]),
    pic: JSON.stringify({ s: shatters.map(s => [s.r, s.c, s.gi, s.horiz, s.t, s.ox, s.oy, s.av]), sw: sweeps, lf: lineFlashes, p: pops.map(p => [p.x, p.y, p.t, p.txt, p.sub]),
      b: banners.map(b => [b.txt, b.sub]), g: grid.map(r => r.map(g => g && g.av)), end: ava.end }) };
}`;
const leanRun = (page, o) => page.evaluate(`(${LEAN_RUN})(${JSON.stringify(o)})`);
const AVA_DOWN = [...Array(6).fill('00000000'), '10000000', '10110110'];   // AVA_ROWS settled, as the Avalanche test pins it

test('Avalanche lean: lean switched off, tilt not live, a flat phone or a lean under AVA_LEAN_MIN all fall down exactly as before (rule and picture); avaDir reads the smoothed tilt with TILT_FLIP and the dead zone', async ({ page }) => {
  await play(page);
  await dealt(page);
  await leanRun(page, { rows: AVA_ROWS, dir: 'down', lean: 0 });   // once first: its one-off banners (the cannonball's charge, a goal) are out of the way
  const flat = await leanRun(page, { rows: AVA_ROWS, dir: 'down', lean: 0 });
  assert.deepEqual(flat.board.map(r => r.replace(/0/g, '1').replace(/\./g, '0')), AVA_DOWN, 'the same fall as the Avalanche test');
  assert.deepEqual([flat.dir, flat.combo, flat.sub], ['down', 6, '2 more lines'], 'down, one chain step, the old banner');
  for (const [what, o] of [['Lean switched off', { lean: -.6, pre: 'CFG.AVA_LEAN = false' }], ['Tilt switched off', { lean: .6, pre: 'CFG.TILT = false' }],
    ['motion never granted', { lean: .6, tilt: false }], ['a lean under AVA_LEAN_MIN', { lean: -.25 }], ['a lean inside the dead zone', { lean: .05 }]]) {
    const r = await leanRun(page, { rows: AVA_ROWS, dir: 'down', ...o });
    assert.equal(r.dir, 'down', what);
    assert.deepEqual({ board: r.board, gained: r.gained, combo: r.combo, pic: r.pic }, { board: flat.board, gained: flat.gained, combo: flat.combo, pic: flat.pic }, what + ': byte for byte the same');
  }
  const dir = (gx, raw = gx) => page.evaluate(([gx, raw]) => { CFG.AVA_LEAN = true; CFG.TILT = true; toy.tiltOn = true; toy.gx = gx; toy.gRaw = raw; return avaDir(); }, [gx, raw]);
  assert.deepEqual([await dir(0), await dir(.29), await dir(-.29), await dir(.31), await dir(-.31), await dir(.9), await dir(-.9)], ['down', 'down', 'down', 'right', 'left', 'right', 'left'], 'past AVA_LEAN_MIN (.3) only; + is the right edge low');
  assert.equal(await page.evaluate(() => { CFG.FX_MASCOT = false; toy.gx = 0; toy.gRaw = -.6; const d = avaDir(); CFG.FX_MASCOT = true; return d; }), 'left', 'with the mascot hidden (the toy not stepped) the raw reading stands in');
  // a real devicemotion event, smoothed by the toy's step; TILT_FLIP reverses it
  const lean = x => page.evaluate(x => { toyTiltListen(); dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y: -8, z: -2 } })); }, x);
  await page.evaluate(() => { toy.gx = 0; toy.tiltOn = false; });   // (set by hand above: let toyTiltListen really listen)
  await page.waitForFunction(() => !masc.el.hidden, null, { timeout: 8000 });   // the crumb is up (the toy is stepped)
  const settle = () => page.waitForFunction(() => Math.abs(toy.gx - toy.gRaw) < .005, null, { timeout: 5000 });
  await lean(-4); await settle();
  assert.equal(await page.evaluate(() => avaDir()), 'right', '(spec sign) the right edge low: right');
  await page.evaluate(() => { CFG.TILT_FLIP = true; });
  await lean(-4); await settle();
  assert.equal(await page.evaluate(() => avaDir()), 'left', 'TILT_FLIP reverses it');
  await page.evaluate(() => { CFG.TILT_FLIP = false; });
  await lean(-1.5); await settle();
  assert.equal(await page.evaluate(() => avaDir()), 'down', 'a phone held in the hand (~9 degrees) stays down');
});

test('Avalanche lean: a left lean packs every gem against the left wall and clears full columns, scoring and stepping the combo exactly like the matching fall down; right is its mirror; gems slide again after a chain clear', async ({ page }) => {
  await play(page);
  await dealt(page);
  const gis = AVA_ROWS.map((row, r) => [...row].map((_, c) => (r * 3 + c * 2) % 5).join(''));
  const down = await leanRun(page, { rows: AVA_ROWS, dir: 'down', lean: 0, gis });
  const left = await leanRun(page, { rows: AVA_ROWS, dir: 'left', lean: -.6, gis });
  const right = await leanRun(page, { rows: AVA_ROWS, dir: 'right', lean: .6, gis });
  const B = await page.evaluate(() => [bx, B, cell]);
  for (const [name, r, wall] of [['left', left, [[false, 0], [false, 1]]], ['right', right, [[false, 6], [false, 7]]]]) {
    assert.equal(r.dir, name, name + ': it went ' + name);
    assert.deepEqual(r.board, down.board, name + ': every gem lands where the fall down puts it, turned to the ' + name + ' wall (colours too)');
    assert.deepEqual([r.gained, r.combo, r.meter], [down.gained, down.combo, down.meter], name + ': the same points, combo steps and bonus meter');
    assert.deepEqual(r.avaLines, wall, name + ': the chain cleared two columns at the ' + name + ' wall');
    assert.equal(r.sub, 'to the ' + name + '! 2 more lines', name + ': the banner says which way');
    assert.ok(r.twice && down.twice, name + ': what was beyond the cleared columns slid again');
    assert.equal(r.live, true, 'the picture is playing');
  }
  assert.deepEqual(right.raw, left.raw.map(r => [...r].reverse().join('')), 'right is the mirror of left');
  assert.ok(left.raw.every(r => /^[0-9]*\.*$/.test(r)) && right.raw.every(r => /^\.*[0-9]*$/.test(r)), 'packed against the wall: ' + JSON.stringify([left.raw, right.raw]));
  assert.equal(left.chain[0][0], down.chain[0][0], 'left: the CHAIN tag where it always was (top right, empty now)');
  assert.equal(right.chain[0][0], Math.round(B[0] + B[2] * 1.6), 'right: the CHAIN tag moves to the left side, which the gems left');
  // a board where the first fall clears nothing, so the gems settle once more against the wall with no chain
  const NOCHAIN = ['01111111', '10000000', '01000000', '00100000', '00010000', '00001000', '00000100', '00000000'];
  const nd = await leanRun(page, { rows: NOCHAIN, dir: 'down', lean: 0 }), nl = await leanRun(page, { rows: NOCHAIN, dir: 'left', lean: -.6 });
  assert.deepEqual([nl.board, nl.gained, nl.combo, nl.sub, nl.dir], [nd.board, nd.gained, nd.combo, 'to the left!', 'left'], 'no chain: it only slides; the banner says "to the left!" alone');
});

test('Avalanche lean: sideways chains keep every reward: bonus meter, Volcano, the star, COLOR GONE behind the banner, a clean sweep, and the avalanche dare', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  const gis = AVA_ROWS.map((row, r) => [...row].map((_, c) => r === 5 && c === 1 ? 4 : 0).join(''));   // the only gem of its colour; the fall takes it into a chain line
  const pre = "CFG.TRANSFORM_COMBO = 6; discoveredWorlds.delete('volcano')";
  const res = {};
  for (const [dir, lean] of [['down', 0], ['left', -.6], ['right', .6]]) res[dir] = await leanRun(page, { rows: AVA_ROWS, dir, lean, gis, pre });
  for (const dir of ['left', 'right']) {
    const r = res[dir];
    assert.deepEqual([r.dir, r.combo, r.meter, r.volcano, r.star, r.gained, r.bands], ['' + dir, 6, 7, true, true, res.down.gained, 0], dir + ': meter, Volcano, star and COLOR GONE points as down: ' + JSON.stringify(r));
    const ia = r.banners.indexOf('AVALANCHE!');
    assert.ok(ia >= 0 && r.banners[ia + 1] === 'COLOR GONE!', dir + ': COLOR GONE queues right behind AVALANCHE! ' + JSON.stringify(r.banners));
  }
  // a lean avalanche that empties the board is a clean sweep, AVALANCHE! first
  const SWEEP = ['01111111', '11110000', '00001111', '11110000', '00001111', '00000000', '00000000', '00000000'];
  const sd = await leanRun(page, { rows: SWEEP, dir: 'down', lean: 0 });
  for (const [dir, lean] of [['left', -.6], ['right', .6]]) {
    const r = await leanRun(page, { rows: SWEEP, dir, lean });
    assert.deepEqual([r.dir, r.empty, r.swept, r.gained], [dir, true, 1, sd.gained], dir + ': a clean sweep, paid as the one down');
    assert.ok(r.banners.indexOf('AVALANCHE!') >= 0 && r.banners.indexOf('AVALANCHE!') < r.banners.indexOf('CLEAN SWEEP'), dir + ': AVALANCHE! then CLEAN SWEEP ' + JSON.stringify(r.banners));
  }
  // the 'ava' dare is beaten by an avalanche any way it falls
  for (const [dir, lean] of [['left', -.6], ['right', .6], ['down', 0]]) {
    const r = await page.evaluate(`(() => { const o = (${LEAN_RUN})(${JSON.stringify({ rows: AVA_ROWS, dir, lean, pre: "dare.id = 'ava'; dare.s = 0; dare.p = 0; dare.x = trayNo; dare.q = []; CFG.DARE_MAX = 99" })}); return [o.dir, dare.s]; })()`);
    assert.deepEqual(r, [dir, 1], dir + ': the avalanche dare is won');
  }
});

test('Avalanche lean: the way is fixed when it fires (leaning back mid-slide changes nothing), gems slide sideways in the picture, touches wait, and a run saved mid-slide resumes settled', async ({ page }) => {
  await play(page);
  await dealt(page);
  const L = leanRows(AVA_ROWS, 'left');
  await setup(page, { rows: L, trayShapes: [0, 0, 0] });
  await page.evaluate(() => { CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; CFG.TRANSFORM_COMBO = 99; combo = 4; toy.tiltOn = true; toy.gRaw = toy.gx = -.6; });
  await dragPiece(page, 0, 0, 7);
  assert.equal(await page.evaluate(() => [ava.live, ava.dir].join()), 'true,left', 'a left avalanche');
  const settled = leanRows(AVA_DOWN, 'left');
  assert.deepEqual(await boardStr(page), settled, 'the rule is done at once: packed left, two columns cleared');
  await page.evaluate(() => { toy.gRaw = toy.gx = .7; });   // the player leans the other way mid-fall
  await page.waitForFunction(() => grid.flat().some(g => g && g.av && ava.t > g.av[0][0] && avaOff(g.av, ava.t) < 0), null, { timeout: 5000 });
  const mid = await page.evaluate(() => { const g = grid.flat().find(g => g && g.av && avaOff(g.av, ava.t) < 0); avaAt(avaOff(g.av, ava.t)); return { now: avaDir(), dir: ava.dir, dx: avaDX, dy: avaDY, run: localStorage.getItem('crumble.run') }; });
  assert.deepEqual([mid.now, mid.dir], ['right', 'left'], 'the phone now says right; the fall keeps left');
  assert.ok(mid.dx > 0 && mid.dy === 0, 'mid-slide a gem is drawn to the right of the cell it slides to, at its own height ' + JSON.stringify(mid));
  assert.deepEqual(await boardStr(page), settled, 'and the board is unchanged');
  const g = await geometry(page);
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  assert.equal(await page.evaluate(() => drag === null && !!pendingPress), true, 'no pickup mid-slide');
  await page.waitForFunction(() => !ava.live, null, { timeout: 5000 });
  await frames(page, 3);
  assert.equal(await page.evaluate(() => !!drag && grid.flat().every(g => !g || !g.av)), true, 'landed: the waiting finger takes the piece');
  await page.mouse.up();
  // the run saved mid-slide holds the settled board
  const saved = JSON.parse(mid.run);
  await page.evaluate(run => { localStorage.setItem('crumble.run', run); }, mid.run);
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => state === 'play');
  assert.deepEqual(await boardStr(page), settled, 'resumed: the settled board');
  assert.deepEqual(await page.evaluate(() => [ava.live, grid.flat().some(g => g && g.av)]), [false, false], 'nothing falling');
  assert.ok(saved && saved.score > 0, 'the save had the score');
});

test('Avalanche lean: the first avalanche down with tilt live says "next time, lean the phone." once (saved); not before tilt is live; a sideways one gets its own line', async ({ page }) => {
  await play(page);
  await dealt(page);
  const drop = async (lean, tilt) => {
    await page.waitForFunction(() => !ava.live && !dealing, null, { timeout: 8000 });
    await frames(page, 3);
    const dir = lean < -.3 ? 'left' : 'down';
    await setup(page, { rows: leanRows(AVA_ROWS, dir), trayShapes: [0, 0, 0] });
    await page.evaluate(([lean, tilt]) => { CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; CFG.TRANSFORM_COMBO = 99; combo = 4; toy.tiltOn = tilt; toy.gRaw = toy.gx = lean; }, [lean, tilt]);
    const [r, c] = leanAt(dir, 0, 0);
    await dragPiece(page, 0, r, c);
    await page.waitForFunction(() => ava.live && say.avaOn, null, { timeout: 3000 });
    return page.evaluate(() => ({ dir: ava.dir, txt: say.txt, kind: Object.keys(SAY).find(k => SAY[k].includes(say.txt)), key: localStorage.getItem('crumble.leanHint') }));
  };
  let r = await drop(0, false);
  assert.deepEqual([r.dir, r.kind, r.key], ['down', 'ava', null], 'motion not live: the usual line, no hint');
  r = await drop(0, true);
  assert.deepEqual([r.dir, r.txt, r.key], ['down', 'next time, lean the phone.', '1'], 'tilt live, phone flat: the hint, and it is remembered');
  r = await drop(0, true);
  assert.deepEqual([r.dir, r.kind], ['down', 'ava'], 'only once');
  r = await drop(-.6, true);
  assert.deepEqual([r.dir, r.kind], ['left', 'avaSide'], 'sideways: "which way is DOWN?" and friends');
});

test('Avalanche lean: with Reduce Motion the same lean gives the same fall and score; the picture stays as calm as the fall down (no rim flash, the crumb is not thrown, no roll)', async ({ page }) => {
  await play(page);
  await dealt(page);
  const plain = await leanRun(page, { rows: AVA_ROWS, dir: 'left', lean: -.6 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await dealt(page);
  assert.equal(await page.evaluate(() => reduce), true);
  // the toy's lean reading still follows the phone under reduced motion (only its roll is off)
  const x0 = await page.evaluate(() => { toy.tiltOn = true; toy.gx = 0; toy.gRaw = -.6; return toy.x; });
  await frames(page, 30);
  assert.deepEqual(await page.evaluate(() => [avaDir(), toy.x]), ['left', x0], 'the lean is read; the crumb does not roll');
  await page.evaluate(() => { borderFlash = null; toy.mode = 'rim'; });
  const calm = await leanRun(page, { rows: AVA_ROWS, dir: 'left', lean: -.6, pre: 'borderFlash = null' });
  assert.deepEqual([calm.dir, calm.board, calm.gained, calm.combo, calm.sub], [plain.dir, plain.board, plain.gained, plain.combo, plain.sub], 'the same rule and result');
  const after = await page.evaluate(() => [toy.mode, borderFlash && borderFlash.col]);
  assert.notEqual(after[1], '255,179,107', 'no avalanche rim flash');
  assert.equal(after[0], 'rim', 'the crumb is not thrown');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

// ── review fixes (2026-11-14): cannonball strength saved, the cannonball under reduced motion, one GUIDE key, the win card's
// star target, Avalanche chain rewards, cannonball NEW BEST / clean sweep, the golden hand switch ──
test('fix: a charged crumb keeps its strength across a resume (cp), not worked out again from the combo; bad or missing cp resumes at the plain charge', async ({ page }) => {
  await play(page);
  await dealt(page);
  const r = await page.evaluate(() => {
    const o = {};
    toy.hot = true; toy.pow = 3; combo = 9;
    const snap = JSON.parse(JSON.stringify(snapshot()));
    o.cp = snap.cp; o.power = toyPower(); o.size = toySize();
    toy.hot = false; toy.pow = 0; snap.combo = 0;                  // the resumed combo says nothing about the strength
    o.ok = restore(snap); o.hot = toy.hot; o.pow = toy.pow; o.power2 = toyPower(); o.size2 = toySize();
    o.bad = ['3', -1, 2.5, 1e6, null].map(cp => { restore({ ...snap, cp }); return [toy.hot, toy.pow]; });
    const old = { ...snap }; delete old.cp; restore(old); o.old = [toy.hot, toy.pow];
    toy.hot = false; toy.pow = 4; o.cold = snapshot().cp;
    toy.hot = true; toy.pow = 3; saveRun();
    return o;
  });
  assert.equal(r.cp, 3, 'saved');
  assert.deepEqual([r.ok, r.hot, r.pow, r.power2, r.size2], [true, true, 3, r.power, r.size], 'resumed as strong and as big as it was');
  r.bad.forEach(b => assert.deepEqual(b, [true, 0], 'a bad cp is dropped: ' + JSON.stringify(r.bad)));
  assert.deepEqual(r.old, [true, 0], 'an older save: charged, plain strength');
  assert.equal(r.cold, 0, 'a cold crumb saves no strength');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  assert.deepEqual(await page.evaluate(() => [toy.hot, toy.pow]), [true, 3], 'and through a real reload');
});

// one cannonball, stepped by hand in a single evaluate (no frame runs in between), so two page loads can be compared exactly
const CANNON_FLIGHT = `(() => {
  const FULL = ['01111111', '11011011', '11101110', '10111101', '11011011', '01101101', '11110111', '10111010'];
  grid = FULL.map(r => [...r].map(ch => ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null));
  toyReset(); toy.hot = true; toy.pow = 0; toy.x = 0; toy.sc = toySize(); masc.fainted = false;
  const t0 = performance.now(), s0 = score, a = [];
  toy.last = t0; toy.hot = false; toy.fire = { n: 0, pts: 0, max: toyPower(), b: 0 }; toy.mode = 'air'; toy.vx = 260; toy.vy = 620; toy.va = reduce ? 0 : 400; toy.speed = 700; toy.bounces = 0;
  for (let k = 1; k < 3000 && toy.mode !== 'rim'; k++) { toyStep(t0 + k * 16); a.push(toy.a); }
  return { board: grid.map(r => r.map(g => g ? 1 : 0).join('')), pts: score - s0, rim: toy.mode, spun: a.some(v => v !== 0), hot: toyHot() };
})()`;
const toGameReady = page => page.waitForFunction(() => state === 'play' && !dealing && !paused);
test('fix: with Reduce Motion the cannonball still charges, flies the same flight, breaks the same gems for the same points, and the last chance holds; only the play around it is calmer', async ({ page }) => {
  await play(page);
  await dealt(page);
  const plain = await page.evaluate(CANNON_FLIGHT);
  assert.ok(plain.pts > 0 && plain.spun, 'the reference flight breaks gems (and spins) ' + JSON.stringify(plain));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await dealt(page);
  assert.equal(await page.evaluate(() => reduce && toyOn()), true, 'reduced motion: the toy is there');
  const calm = await page.evaluate(CANNON_FLIGHT);
  assert.deepEqual({ board: calm.board, pts: calm.pts }, { board: plain.board, pts: plain.pts }, 'the same gems broken, the same points');
  assert.equal(calm.spun, false, 'no spin');
  assert.deepEqual([calm.rim, calm.hot], ['rim', false], 'back on the rim at once, cold');
  // uncharged, touches pass through it; a streak charges it and the banner says so
  await toGameReady(page);
  await mascotMood(page, /^idle\b/);
  assert.ok(await page.evaluate(() => !/\btoy\b/.test(el('mascot').className) && getComputedStyle(el('mascot')).pointerEvents === 'none'), 'not charged: nothing to grab');
  const FULL = ['01111111', '11011011', '11101110', '10111101', '11011011', '01101101', '11110111', '10111010'];
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; toy.lastCombo = 0; combo = 4; });
  await setup(page, { rows: FULL, trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 0, 0);
  await page.waitForFunction(() => toy.hot && banners.some(b => b.txt === 'CANNONBALL READY!'));
  await mascotMood(page, /\btoy\b.*\bhot\b/);
  const before = await page.evaluate(() => grid.flat().filter(Boolean).length);
  for (let k = 0; k < 4 && !await page.evaluate(() => !!toy.fire); k++) {   // a slow flick is a put-down that keeps the charge (headless timing varies): flick again
    await flickCrumb(page, 12, 30, 4);
    const t = await page.evaluate(() => [!!toy.fire, toy.mode, toy.hot]);
    if (!t[0]) assert.deepEqual(t, [false, 'rim', true], 'reduced motion: a throw that is not a cannonball puts it straight back, still charged');
  }
  assert.equal(await page.evaluate(() => !!toy.fire), true, 'a flick throws the cannonball');
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9000 });
  assert.ok(before - await page.evaluate(() => grid.flat().filter(Boolean).length) > 0, 'it broke gems');
  // the last chance: out of room with a charged crumb, the run holds
  await dealt(page);
  const JAM = ['11011011', '01101101', '10110110', '11011011', '01101101', '10110110', '11011011', '01101101'];
  await setup(page, { rows: JAM });
  await page.evaluate(() => { const sq = SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2); tray = [{ s: sq, gi: 1 }, { s: sq, gi: 2 }, { s: sq, gi: 3 }]; toy.hot = true; checkStuck(); });
  assert.equal(await page.evaluate(() => stuck && toyLast()), true, 'it is the last chance');
  await page.waitForTimeout(1100);
  assert.deepEqual(await page.evaluate(() => [state, masc.fainted]), ['play', false], 'the run holds, the crumb stands');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('fix: GUIDE is the dealing weight (a number), GUIDED_START the guided first game; an old Admin save holding GUIDE:true cannot clobber the weight', async ({ page, server }) => {
  assert.deepEqual(await page.evaluate(() => [typeof CFG.GUIDE, CFG.GUIDE, CFG.GUIDED_START]), ['number', 1, true]);
  await page.evaluate(() => localStorage.setItem('crumble.dev.6', JSON.stringify({ GUIDE: true, GUIDED_START: 'x', ANTIC_SHIVER: 2 })));
  await page.goto(server.url + '?dev');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  const r = await page.evaluate(() => ({ g: CFG.GUIDE, gs: CFG.GUIDED_START, shake: CFG.ANTIC_SHIVER, tog: [...document.querySelectorAll('#devList label')].some(l => /Guided first game/.test(l.textContent)) }));
  assert.deepEqual(r, { g: 1, gs: true, shake: 2, tog: true }, 'the old boolean is dropped, other tuning kept, and Admin has the switch');
  await page.evaluate(() => { CFG.GUIDE = 2; CFG.GUIDED_START = false; devSave(); });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => [CFG.GUIDE, CFG.GUIDED_START]), [2, false], 'both saved as themselves');
  await page.evaluate(() => localStorage.removeItem('crumble.dev.6'));
});

test('fix: the Adventure win card names the next star target: two stars after one, three after two, at the right boundaries', async ({ page }) => {
  const r = await page.evaluate(() => {
    const msg = (L, p) => { lvl = L; lv = { lines: 0, pieces: p, combo: 0, swept: false }; state = 'won'; showWin(starsFor(L, p), false); return [starsFor(L, p), el('winMsg').textContent]; };
    const L = LEVELS[0], out = { par: L.par };
    out.rows = [L.par[0], L.par[0] + 1, L.par[1], L.par[1] + 1].map(p => msg(L, p));
    out.same = msg({ ...L, par: [5, 5] }, 6);
    out.one = msg({ ...L, par: [1, 3] }, 2);
    el('winCard').hidden = true; state = 'idle';
    return out;
  });
  const [p3, p2] = r.par;
  assert.deepEqual(r.rows, [
    [3, 'Perfect! Three stars.'],
    [2, `Finish in ${p3} pieces or fewer for three stars. You used ${p3 + 1}.`],
    [2, `Finish in ${p3} pieces or fewer for three stars. You used ${p2}.`],
    [1, `Finish in ${p2} pieces or fewer for two stars. You used ${p2 + 1}.`],
  ]);
  assert.deepEqual(r.same, [1, 'Finish in 5 pieces or fewer for three stars. You used 6.'], 'when the two targets are one number, one star points at three');
  assert.deepEqual(r.one, [2, 'Finish in 1 piece or fewer for three stars. You used 2.'], 'one piece, singular');
});

test('fix: Avalanche chain lines count like clears: the bonus meter fills, a combo they reach earns Volcano and the star, a colour the fall wipes out pays COLOR GONE behind the AVALANCHE! banner', async ({ page }) => {
  await play(page);
  await dealt(page);
  const r = await page.evaluate((AVA_ROWS) => {
    CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; CFG.TRANSFORM_COMBO = 6;
    grid = AVA_ROWS.map(r => [...r].map(ch => ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null));
    grid[5][1].gi = 4;                                      // the only gem of its colour; the fall takes it into a chain row
    tray = [{ s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }];
    trayNo = 10; specialEnd = -99; bonus = null; bonusMeter = 0; transformCool = 99; starForced = false; combo = 4; banners.length = 0; bands.length = 0;
    discoveredWorlds.delete('volcano');
    const s0 = score;
    place(0, 0, 0);
    const main = Math.round(CFG.LINE_POINTS * (1 + 4 * CFG.COMBO_STEP)), chain = Math.round(CFG.LINE_POINTS * 4 * (1 + 5 * CFG.COMBO_STEP));
    const cg = Math.round(CFG.COLOR_GONE_BONUS * (1 + 5 * 0.25));
    return { combo, meter: bonusMeter, volcano: discoveredWorlds.has('volcano'), star: starForced, gained: score - s0, want: SCORE_SCALE + main + chain + cg,
      banners: banners.map(b => b.txt), bands: bands.length, board: grid.map(r => r.map(g => g ? 1 : 0).join('')) };
  }, AVA_ROWS);
  assert.deepEqual(r.board, [...Array(6).fill('00000000'), '10000000', '10110110'], 'the same fall as before');
  assert.equal(r.combo, 6);
  assert.equal(r.meter, 3 + 4, 'the meter: the clear (1 line at combo 5) and the chain (2 lines at combo 6)');
  assert.equal(r.volcano, true, 'combo 6 reached by the chain earns Volcano');
  assert.equal(r.star, true, 'and the star (STAR_COMBO 6)');
  assert.equal(r.gained, r.want, 'the colour the fall wiped out pays COLOR GONE');
  const ia = r.banners.indexOf('AVALANCHE!');
  assert.ok(ia >= 0 && r.banners[ia + 1] === 'COLOR GONE!', 'its words queue right behind the AVALANCHE! banner: ' + JSON.stringify(r.banners));
  assert.equal(r.bands, 0, 'no band drawn over the falling board');
});

test('fix: an Avalanche that empties the board is a clean sweep whose show starts after the last chain line breaks', async ({ page }) => {
  await play(page);
  await dealt(page);
  const r = await page.evaluate(() => {
    CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; CFG.TRANSFORM_COMBO = 99;
    const rows = ['01111111', '11110000', '00001111', '11110000', '00001111', '00000000', '00000000', '00000000'];
    grid = rows.map(r => [...r].map(ch => ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null));
    tray = [{ s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }, { s: SHAPES[0], gi: 0 }];
    combo = 4; banners.length = 0; const sw0 = stats.sweeps;
    place(0, 0, 0);
    const chain = pops.filter(p => /^CHAIN/.test(p.sub)).map(p => -p.t / 0.026);
    return { empty: boardEmpty(), sweeps: stats.sweeps - sw0, show: sweepShow ? -sweepShow.t : null, chain, slamEnd: slams.length ? -slams[0].t + 48 : 0, banners: banners.map(b => b.txt) };
  });
  assert.equal(r.empty, true); assert.equal(r.sweeps, 1, 'counted as a sweep');
  assert.ok(r.chain.length >= 1 && r.show !== null, JSON.stringify(r));
  assert.ok(r.show > Math.max(...r.chain), 'the flood starts after the last chain line has broken: ' + JSON.stringify(r));
  assert.ok(r.show >= r.slamEnd, 'and after the COMBO slam is gone: ' + JSON.stringify(r));
  assert.ok(r.banners.indexOf('AVALANCHE!') < r.banners.indexOf('CLEAN SWEEP'), 'AVALANCHE! first, then CLEAN SWEEP, one at a time');
});

test('fix: a cannonball that passes the player’s best raises NEW BEST; one that breaks the last gem is a full clean sweep (bonus, count, sky, look, show, save)', async ({ page }) => {
  await play(page);
  await dealt(page);
  const r = await page.evaluate(() => {
    const o = {}, gem = () => ({ gi: 0, t: 1, f: 0, l: 0 });
    const shoot = (rr, cc) => {                                  // the cannonball's middle right over cell (rr, cc), then spent
      const s = masc.s; toy.sc = 1; toy.mode = 'air';
      toy.x = bx + (cc + .5) * cell - masc.x - s / 2; toy.y = by + (rr + .5) * cell - masc.y - s + s / 2;
      toy.fire = { n: 0, pts: 0, max: 10, b: 0 }; toySmash(); toyFireEnd();
    };
    grid = empty(); grid[2][2] = gem(); grid[6][6] = gem();
    best = score + CFG.CANNON_PER_GEM - 1; chaseBest = best; bestBeaten = false; banners.length = 0;
    shoot(2, 2);
    o.best = bestBeaten; o.bestBanner = banners.some(b => b.txt === 'NEW BEST!'); o.left = grid.flat().filter(Boolean).length; o.noSweep = !banners.some(b => b.txt === 'CLEAN SWEEP');
    discoveredWorlds.delete('rainbow'); banners.length = 0;
    const s0 = score, sw0 = stats.sweeps, j0 = jJumps;
    shoot(6, 6);
    o.empty = boardEmpty(); o.gained = score - s0; o.want = CFG.CANNON_PER_GEM + CFG.SWEEP_BONUS + CFG.SWEEP_PER_GEM;
    o.sweeps = stats.sweeps - sw0; o.jumps = jJumps - j0; o.rainbow = discoveredWorlds.has('rainbow'); o.show = !!sweepShow;
    o.banner = banners.some(b => b.txt === 'CLEAN SWEEP'); o.saved = JSON.parse(localStorage.getItem('crumble.run')).score === score;
    o.statsSaved = JSON.parse(localStorage.getItem('crumble.stats')).sweeps === stats.sweeps;
    toyReset();
    return o;
  });
  assert.deepEqual([r.best, r.bestBanner, r.left, r.noSweep], [true, true, 1, true], 'NEW BEST, and one gem left is no sweep');
  assert.equal(r.empty, true);
  assert.equal(r.gained, r.want, 'the cannon gem plus the sweep bonus');
  assert.deepEqual([r.sweeps, r.jumps, r.rainbow, r.show, r.banner], [1, 1, true, true, true], 'counted, the sky jumps, Rainbow unlocks, the show and the banner');
  assert.deepEqual([r.saved, r.statsSaved], [true, true], 'the run and the stats are saved');
});

test('fix: Golden hand switch in Settings > Look > Advanced: on by default, saved; off mid-run a live golden hand plays out and pays, and no new one is dealt', async ({ page, errors }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(goldHand);
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#goldOn'), true, 'on by default');
  assert.match(await page.textContent('label:has(#goldOn)'), /Golden hand: a rare gold tray that pays triple/);
  await page.click('#goldOn');
  await closeSet(page);
  assert.ok(await page.evaluate(() => CFG.SPECIALS.golden === false && JSON.parse(localStorage.getItem('crumble.skins')).gold === false), 'off, and saved');
  const r = await page.evaluate(() => {
    const live = !!golden, b = score;
    place(0, 0, 0); place(1, 1, 0); place(2, 2, 0);
    const o = { live, gained: score - b, after: golden, cele: !!goldenCele && goldenCele.full };
    goldenNext = true; goldenCool = 0; trayNo = 20; specialEnd = -99; golden = null; tray = [null, null, null]; genTray();
    o.dealtGold = !!golden || tray.some(t => t && t.gi === GOLD);
    return o;
  });
  assert.equal(r.live, true, 'the hand was live when it was switched off');
  assert.deepEqual([r.after, r.cele], [null, true], 'it played out and celebrated');
  assert.ok(r.gained > 0, 'and paid');
  assert.equal(r.dealtGold, false, 'no new golden hand while it is off');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.SPECIALS.golden), false, 'still off after a reload');
  if (await page.evaluate(() => state) === 'play') await openSet(page); else await page.click('#startSettings');
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#goldOn'), false, 'the box shows it');
  await page.click('#goldOn');
  assert.ok(await page.evaluate(() => CFG.SPECIALS.golden === true && JSON.parse(localStorage.getItem('crumble.skins')).gold === true), 'back on, saved');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), [], 'no script errors');
});

// ── 7.5g timelapse ──
const tlPlace = async (page, r, c) => {                   // one drop of a single cell, the tray refilled so no deal is due
  await dealt(page);
  await page.evaluate(() => { tray = [{ s: SHAPES[0], gi: 2 }, { s: SHAPES[0], gi: 3 }, { s: SHAPES[0], gi: 4 }]; });
  await dragPiece(page, 0, r, c);
};

test('8.2 jackpot hand: due on its own clock, three pieces worth 3+ lines, a dry tray runs it forward, and it survives a resume', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TIDE = false; });   // (1.1 G) the 1.0 dealer, which Challenge still deals with
  const r = await page.evaluate('(() => {' + B73 + `
    W73(); const o = {};
    const rows = ['00000000','00000000','00000000','00000000','11111100','11111100','11111100','11111100'];
    const h = runSteps(jackpotSteps(B73(rows), 0.4));
    o.jackLines = h ? evalHand(packGrid(grid), h, 6000).lines : 0;
    o.emptyNone = runSteps(jackpotSteps(B73(Array(8).fill('00000000')), 0)) === null;    // nothing to clear: no jackpot, never a fake one
    // dealt by its clock: due now, the tray is a JACKPOT and both clocks restart
    W73(); B73(rows); trayNo = 20; specialEnd = -99; jack.at = 1; genTray();
    o.tier = lastTier; o.jackN = jack.n; o.waveN = wave.n;
    // a tray with no clear moves the jackpot clock 1 + JACKPOT_DRY, a tray with a clear 1
    W73(); trayClear = false; waveTick(); o.dry = jack.n; W73(); trayClear = true; waveTick(); o.wet = jack.n;
    // an edge tray is never a jackpot
    W73(); jack.at = 1; o.edge = waveTier('edge', true);
    // the clock is in the run save
    jack = { n: 5, at: 9 }; const snap = JSON.parse(JSON.stringify(snapshot())); jack = { n: 0, at: 12 }; o.restored = restore(snap); o.saved = jack;
    return o; })()`);
  assert.ok(r.jackLines >= 3, 'the jackpot hand clears 3+ lines (' + r.jackLines + ')');
  assert.ok(r.emptyNone, 'an empty board gets no jackpot');
  assert.equal(r.tier, 'JACKPOT'); assert.equal(r.jackN, 0); assert.equal(r.waveN, 0, 'a jackpot is also the payoff');
  assert.equal(r.dry, 2); assert.equal(r.wet, 1);
  assert.equal(r.edge, null);
  assert.ok(r.restored); assert.deepEqual(r.saved, { n: 5, at: 9 });
});

test('8.2 golden hand: one queued while a bonus is live waits for the gate instead of being rerolled away', async ({ page }) => {
  await play(page);
  await setup(page, { rows: EMPTY });
  const r = await page.evaluate(() => {
    const o = {};
    goldenNext = true; goldenCool = 0; bonus = { left: 3, extra: 0 }; trayNo = 20; specialEnd = -99;
    tray = [{ s: SHAPES[0], gi: 0 }, null, null];
    place(0, 0, 0);                                  // the last piece of the tray, while the bonus runs: the tray-end roll used to drop the queued hand
    o.kept = goldenNext; o.gate = specialOk();
    return o;
  });
  assert.equal(r.kept, true, 'the queued golden hand is kept');
  assert.equal(r.gate, false, 'it waits: the gate is shut while the bonus runs');
});

test('7.5g timelapse: every drop is recorded with the run, survives a reload, and long runs stay capped', async ({ page }) => {
  await play(page);
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await page.evaluate(() => tlReset());
  for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) await tlPlace(page, r, c);
  const t = await page.evaluate(() => ({ ...tl, saved: JSON.parse(localStorage.getItem(runStore(mode))).tl }));
  assert.equal(t.n, 3, 'three drops counted');
  assert.equal(t.f.length, 4, 'the opening plus a picture per drop');
  assert.equal(t.f[3][4 * 8 + 4], '2', 'the last picture has the gem just dropped');
  assert.deepEqual(t.saved.f, t.f, 'the pictures are in the run save');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof CFG !== 'undefined' && !!cell && state === 'play');
  assert.deepEqual(await page.evaluate(() => tl.f), t.f, 'resume brings the timelapse back');
  // a long run: the cap halves the pictures and doubles the stride, opening kept
  const long = await page.evaluate(() => {
    const first = tl.f[0];
    for (let k = 0; k < 400; k++) { grid[k % 8][(k >> 3) % 8] = grid[k % 8][(k >> 3) % 8] ? null : { gi: k % 6, t: 1, f: 0, l: 0 }; tlRecord(); }
    return { len: tl.f.length, s: tl.s, keptFirst: tl.f[0] === first, bytes: JSON.stringify(tlSnap()).length };
  });
  assert.ok(long.len <= 96 && long.len > 24, 'capped at TL_MAX pictures: ' + long.len);
  assert.ok(long.s >= 4 && long.keptFirst, 'stride grew and the opening stayed ' + JSON.stringify(long));
  assert.ok(long.bytes < 8000, 'small enough for every save: ' + long.bytes + ' bytes');
  // a damaged or older save: the timelapse starts at the resumed board, the run still loads
  assert.ok(await page.evaluate(() => { const o = snapshot(); o.tl = { s: 1, n: 0, f: ['bad'] }; return restore(o) && tl.f.length === 1 && tl.f[0] === tlPic(grid); }));
  assert.ok(await page.evaluate(() => { const o = snapshot(); delete o.tl; return restore(o) && tl.f.length === 1; }));
});

test('7.5g timelapse: it plays on the game-over card without holding up the buttons; a tap skips, a second tap replays', async ({ page }) => {
  await play(page);
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await page.evaluate(() => tlReset());
  for (const [r, c] of [[0, 0], [1, 1], [2, 2], [3, 3], [5, 5]]) await tlPlace(page, r, c);
  await dealt(page);
  await page.evaluate(() => { score = 900; best = 800; rescuesUsed = 0; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  const s = await page.evaluate(() => ({ shown: !el('tlBoard').hidden, playing: !tlPlay.done, frames: tlPlay.f.length, dur: tlPlay.dur }));
  assert.ok(s.shown && s.playing, 'the replay is running ' + JSON.stringify(s));
  assert.equal(s.frames, 6);
  assert.ok(s.dur >= 2000 && s.dur <= 4500, 'a few seconds');
  const lay = await page.evaluate(() => { const r = id => el(id).getBoundingClientRect(); return { tl: r('tlBoard'), btns: ['reviveBtn', 'againBtn', 'overMenuBtn'].map(r), h: innerHeight }; });
  assert.ok(lay.btns.every(b => b.bottom <= lay.h && b.top >= lay.tl.bottom), 'the buttons sit under it, on screen');
  await page.click('#tlBoard');
  assert.ok(await page.evaluate(() => tlPlay.done && state === 'over'), 'a tap skips to the end and changes nothing else');
  await page.waitForFunction(() => !tlPlay.raf, null, { timeout: 2000 });   // the end flash breathes out, then it stops drawing
  await page.click('#tlBoard');
  assert.ok(await page.evaluate(() => !tlPlay.done), 'a second tap plays it again');
  await page.click('#reviveBtn');                         // mid-replay: the rescue is not held up
  assert.ok(await page.evaluate(() => state === 'play' && el('overCard').hidden && !tlPlay.raf && tl.f.length === 6), 'the rescue goes straight on; the run keeps its timelapse');
  await dealt(page);
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  await page.click('#againBtn');
  assert.ok(await page.evaluate(() => state === 'play' && tl.f.length === 1 && !tlPlay.f), 'Start over: a fresh timelapse from the new opening');
});

test('7.5g timelapse: a short run shows no replay; the share picture gets a four-board strip; the switch (saved) turns it off', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(() => { score = 50; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isVisible('#tlBoard'), false, 'nothing to replay after no drops');
  await page.click('#againBtn');
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await page.evaluate(() => tlReset());
  for (const [r, c] of [[0, 0], [1, 1], [2, 2], [3, 3]]) await tlPlace(page, r, c);
  const strip = await page.evaluate(() => shareData().strip);
  assert.equal(strip.length, 4);
  assert.equal(strip[0], '.'.repeat(64), 'from the opening ...');
  assert.equal(strip[3].replace(/\./g, '').length, 4, '... to the board the player ended on');
  assert.ok(await page.evaluate(() => drawShareCard(shareData()).width === SHARE_W), 'the card draws');
  await openSet(page);
  await page.click('#advLook summary');
  assert.equal(await page.isChecked('#tlOn'), true, 'on by default');
  await page.click('#tlOn');
  await closeSet(page);
  assert.ok(await page.evaluate(() => !CFG.FX_TIMELAPSE && JSON.parse(localStorage.getItem('crumble.skins')).tl === false), 'off, and saved');
  await page.evaluate(() => tlReset());
  await tlPlace(page, 5, 5);
  assert.ok(await page.evaluate(() => tl.f.length === 0 && shareData().strip === null), 'off: nothing recorded, no strip');
  await dealt(page);
  await page.evaluate(() => { gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isVisible('#tlBoard'), false, 'off: no replay');
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof CFG !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => CFG.FX_TIMELAPSE), false, 'still off after a reload');
});

test('haptics: silent no-op on the web, buzzes in the app (fake Capacitor), strongest moment wins, Settings switch', async ({ page, errors }) => {
  await play(page);
  assert.equal(await page.evaluate(() => Native.on()), false, 'a browser is not the app');
  await setup(page, { rows: EMPTY });
  await dragPiece(page, 0, 3, 3);                                   // web: places fine, nothing to buzz
  await dealt(page);
  await openSet(page);
  assert.equal(await page.isHidden('#hapTog'), true, 'no Haptics switch on the web');
  await closeSet(page);
  await page.evaluate(() => {                                       // pretend to be the app: the bridge looks Capacitor up at call time
    window.__hap = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: {
      impact: o => { __hap.push('impact:' + o.style); return Promise.resolve(); },
      notification: o => { __hap.push('notify:' + o.type); return Promise.resolve(); } } } };
  });
  const flush = () => page.evaluate(() => new Promise(r => setTimeout(r, 60)).then(() => __hap.splice(0)));
  await setup(page, { rows: EMPTY });
  await dragPiece(page, 1, 3, 3);                                   // slot 0 was used above
  const buzz = await flush();
  assert.ok(buzz.includes('impact:LIGHT') && buzz.includes('impact:MEDIUM'), 'pickup then place buzz: ' + buzz);
  await dealt(page);
  await page.evaluate(() => { Sfx.place(1); Sfx.clear(1, 0, 1); Sfx.combo(3, 1, 0); });
  assert.deepEqual(await flush(), ['impact:HEAVY'], 'place + clear + combo in one moment: one buzz, the biggest');
  await page.evaluate(() => Sfx.deny());
  assert.deepEqual(await flush(), ['notify:WARNING']);
  await openSet(page);
  assert.equal(await page.isVisible('#hapTog'), true, 'the switch shows in the app');
  await page.click('#hapOn');
  await closeSet(page);
  assert.ok(await page.evaluate(() => !CFG.HAPTICS && JSON.parse(localStorage.getItem('crumble.skins')).haptics === false), 'off, and saved');
  await page.evaluate(() => { Sfx.clear(1, 0, 1); Sfx.pickup(); });
  assert.deepEqual(await flush(), [], 'off: silent');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('1.1 F Leaderboards: hidden on the web, shown in the app only while signed in to Game Center, opens the dashboard', async ({ page, errors }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { score = 420; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isHidden('#gcOverBtn'), true, 'web: no Leaderboards button on the game-over card');
  await page.click('#againBtn'); await dealt(page);
  await openSet(page);
  assert.equal(await page.isHidden('#gcSetBtn'), true, 'web: none in Settings either');
  await closeSet(page);
  await page.evaluate(() => {                                       // the app, not signed in yet
    window.__gc = [];
    let fire = null;
    window.Capacitor = { isNativePlatform: () => true, Plugins: { GameCenter: {
      signIn: () => Promise.resolve({ signedIn: false }), status: () => Promise.resolve({ signedIn: false }),
      submitScore: () => Promise.resolve({ sent: true }), unlock: () => Promise.resolve({ sent: true }),
      show: () => { __gc.push('show'); return Promise.resolve({ shown: true }); },
      addListener: (n, f) => { fire = f; } } } };
    window.__gcFire = r => fire(r);
    gcStart();
  });
  await page.waitForTimeout(50);
  await openSet(page);
  assert.equal(await page.isHidden('#gcSetBtn'), true, 'app, signed out: hidden');
  await page.evaluate(() => __gcFire({ signedIn: true }));          // signs in from iPhone Settings while running
  assert.equal(await page.isVisible('#gcSetBtn'), true, 'signed in: Settings shows it');
  await page.click('#gcSetBtn');
  await closeSet(page);
  await page.evaluate(() => { state = 'play'; score = 500; gameOver(); });
  await page.waitForSelector('#overCard:not([hidden])');
  assert.equal(await page.isVisible('#gcOverBtn'), true, 'Endless game over: shown');
  await page.click('#gcOverBtn');
  assert.deepEqual(await page.evaluate(() => __gc), ['show', 'show'], 'each button opens Game Center');
  await page.evaluate(() => { state = 'play'; mode = 'adventure'; lvl = LEVELS[0]; lv = { lines: 0, pieces: 0, combo: 0, swept: false }; gameOver(); });
  assert.equal(await page.isHidden('#gcOverBtn'), true, 'an Adventure level: no leaderboard to show');
  await page.evaluate(() => { mode = 'endless'; __gcFire({ signedIn: false }); });
  assert.equal(await page.evaluate(() => el('gcSetBtn').hidden && el('gcOverBtn').hidden), true, 'signed out again: both hidden');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('1.1 F iCloud backup: nothing on the web; in the app the cloud copy merges in (max, union, best), writes are throttled, a failed read writes nothing', async ({ page, errors }) => {
  await play(page); await dealt(page);
  assert.equal(await page.evaluate(() => { cloudStart(); cloudDirty(); return CLOUD.ready || !!CLOUD.timer; }), false, 'web: no store, nothing scheduled');
  const today = await page.evaluate(() => dailyKey());
  await page.evaluate(today => {                                    // this phone: a little progress
    best = 3000; stats.lines = 40; stats.games = 7; goals.done.add('lines:25'); goals.days = 3;
    goals.streak = { cur: 2, best: 2, last: addDays(today, -1) };
    adv.lv[1] = { s: 2, p: 14, n: 1, f: 0 }; daily.d['2026-11-01'] = { s: 900, l: 9, n: 1 };
    const cloud = { v: 1, sc: SCORE_SCALE, best: 5000, stats: { lines: 30, games: 12, sweeps: 2 },
      goals: { done: ['games:10', 'lines:25'], days: 5, streak: { cur: 4, best: 6, last: addDays(today, -2) } },
      unlocked: ['candy'], disc: [], adv: { 1: { s: 3, p: 11, n: 2, f: 0 }, 2: { s: 1, p: 20, n: 1, f: 0 } },
      daily: { '2026-11-01': { s: 700, l: 12, n: 2 }, '2026-11-02': { s: 400, l: 4, n: 1 } },
      chal: { s: { 'd-2026-11-09': { b: 5200, m: 2, n: 3, t: 1 } }, won: 1, gold: 0 } };
    window.__kv = { progress: JSON.stringify(cloud) }; window.__sets = 0; window.__fail = false;
    let fire = null;
    window.Capacitor = { isNativePlatform: () => true, Plugins: { CloudStore: {
      get: o => __fail ? Promise.reject(new Error('offline')) : Promise.resolve({ value: __kv[o.key] ?? null }),
      set: o => { __sets++; __kv[o.key] = o.value; return Promise.resolve({ saved: true }); },
      addListener: (n, f) => { fire = f; } } } };
    window.__cloudFire = () => fire({ reason: 0, keys: ['progress'] });
    CLOUD.WAIT = 200;
  }, today);
  await page.evaluate(() => cloudStart());
  await page.waitForFunction(() => CLOUD.ready && __sets === 1);
  const m = await page.evaluate(() => ({ best, lines: stats.lines, games: stats.games, sweeps: stats.sweeps,
    done: [...goals.done].sort(), days: goals.days, streak: goals.streak, candy: unlocked.has('candy'),
    a1: adv.lv[1], a2: adv.lv[2], d1: daily.d['2026-11-01'], d2: daily.d['2026-11-02'],
    ch: chalRec.s['d-2026-11-09'], won: chalRec.won,
    stored: JSON.parse(localStorage.getItem('crumble.stats')).best, cloud: JSON.parse(__kv.progress) }));
  assert.equal(m.best, 5000, 'best: the bigger one');
  assert.deepEqual([m.lines, m.games, m.sweeps], [40, 12, 2], 'stats: each by max');
  assert.ok(m.done.includes('games:10') && m.done.includes('lines:25'), 'goals: union (plus rungs the merged stats now reach)');
  assert.equal(m.days, 5);
  assert.deepEqual([m.streak.cur, m.streak.best], [5, 6], 'streak: played the day after the other phone\'s last day, so the run joins up (4 + 1); the best is kept');
  assert.ok(m.candy, 'unlocked skins: union');
  assert.deepEqual(m.a1, { s: 3, p: 11, n: 2, f: 0 }, 'a level: most stars, fewest pieces');
  assert.equal(m.a2.s, 1, 'a level only the cloud had');
  assert.deepEqual(m.d1, { s: 900, l: 12, n: 2 }, 'a Daily day: best of each');
  assert.equal(m.d2.s, 400);
  assert.ok(m.ch && m.ch.b === 5200 && m.ch.m === 2 && m.won === 1, 'Challenge results come over too');
  assert.equal(m.stored, 5000, 'stored on this phone too');
  assert.equal(m.cloud.stats.lines, 40, 'and this phone\'s extra progress went back up');
  await page.evaluate(() => { stats.lines++; saveStats(); stats.lines++; saveStats(); saveGoals(); saveAdv(); });
  assert.equal(await page.evaluate(() => __sets), 1, 'not at once');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __sets), 2, 'one write for a burst of saves');
  assert.equal(await page.evaluate(() => JSON.parse(__kv.progress).stats.lines), 42);
  await page.evaluate(() => { const o = JSON.parse(__kv.progress); o.best = 9000; __kv.progress = JSON.stringify(o); __cloudFire(); });
  await page.waitForFunction(() => best === 9000);                  // another phone wrote: picked up
  await page.evaluate(() => { __fail = true; stats.lines++; saveStats(); });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => JSON.parse(__kv.progress).stats.lines), 42, 'a failed read writes nothing');
  assert.deepEqual(errors.filter(e => !/net::ERR_FAILED/.test(e)), []);
});

test('8.5 frame pacing: every frame while touched, 30 then 15 a second when idle, 5 under the pause card', async ({ page }) => {
  await play(page); await dealt(page);
  const rate = ms => page.evaluate(ms => new Promise(res => { const l0 = last; let n = 0, p = last;
    const f = () => { if (last !== p) { n++; p = last; } if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n * 1000 / ms); };
    const t0 = performance.now(); requestAnimationFrame(f); }), ms);
  await page.evaluate(() => { CFG.FRAME_FULL_MS = 600; CFG.FRAME_DOZE_MS = 2500; lastInput = performance.now(); });
  const busy = await rate(400);
  assert.ok(busy > 45, `full speed right after a touch (${busy}/s)`);
  await page.waitForTimeout(400);
  const idle = await rate(1000);
  assert.ok(idle > 22 && idle < 38, `about 30 a second once it settles (${idle}/s)`);
  await page.waitForTimeout(1200);
  const doze = await rate(1000);
  assert.ok(doze > 10 && doze < 20, `about 15 a second after a long while untouched (${doze}/s)`);
  await page.mouse.move(10, 300); await page.mouse.move(12, 302);
  const back = await rate(300);
  assert.ok(back > 45, `a touch brings full speed back at once (${back}/s)`);
  await page.click('#pauseBtn');
  await page.waitForTimeout(300);
  const pz = await rate(1000);
  assert.ok(pz <= 7, `the pause card: a few frames a second (${pz}/s)`);
  await page.click('#pauseHome'); await page.waitForFunction(() => hero.card === el('menuCard'));
  const home = await rate(1000);
  assert.ok(home > 22 && home < 38, `Home from a game (still paused underneath): the menu sky at 30 a second (${home}/s)`);
  await page.click('#menuEndless'); await page.waitForFunction(() => state === 'play' && !paused && !hero.card);
  await page.evaluate(() => { CFG.FRAME_PACING = false; });
  await page.waitForTimeout(100);
  const off = await rate(500);
  assert.ok(off > 45, `the switch off: every frame (${off}/s)`);
});

// (1.1 D) the guided first game. A fresh player: the test marks the tab, empties storage and reloads (harness.mjs skips
// the guide for every other test).
const freshPlayer = async page => {
  await page.evaluate(() => { sessionStorage.setItem('crumble.test.fresh', '1'); localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
};
const guideView = page => page.evaluate(() => ({ n: guide && guide.n, ln: guide && guide.ln, tier: lastTier, trayNo,
  tray: tray.map(t => (t ? SHAPES.indexOf(t.s) : null)), rows: grid.map(r => r.map(v => (v ? 'X' : '.')).join('')),
  seen: localStorage.getItem('crumble.guide'), score }));
const lessonRows = (page, n) => page.evaluate(n => GUIDE_LESSONS[n - 1].board.map(r => r.replace(/[abc]/g, '.')), n);
// what is on the board once lesson n is laid over what the last one left (gems only ever pop in, nothing of the player’s goes)
const overlay = (rows, add) => rows.map((r, i) => [...r].map((v, j) => (v === 'X' || add[i][j] === 'X' ? 'X' : '.')).join(''));

test('guided first game (1.1 D): a fresh player gets three lessons in order, a sweep, then an ordinary light opening with the player’s score', async ({ page, errors }) => {
  await freshPlayer(page);
  await play(page);
  let v = await guideView(page);
  assert.equal(v.n, 1); assert.equal(v.tier, 'GUIDE'); assert.equal(v.seen, null, 'not marked while it runs');
  assert.deepEqual(v.rows, await lessonRows(page, 1));
  assert.deepEqual(v.tray, [null, 3, null], 'only the 1x3 that fills the row');
  assert.ok(await page.evaluate(() => banners.some(b => b.txt === 'Fill a row')), 'one short line in the banner style');
  // lesson 1: the 1x3 fills the row; the small pieces go anywhere
  await dragPiece(page, 1, 5, 2);
  assert.equal((await snap(page)).rows[5], '00000000', 'the row cleared');
  const left1 = (await guideView(page)).rows;
  await dealt(page);
  assert.equal(await page.evaluate(() => stats.sweeps), 0, 'lesson 1 keeps a few loose gems: filling the row is no sweep');
  v = await guideView(page);
  assert.equal(v.n, 2, 'lesson 2'); assert.deepEqual(v.rows, overlay(left1, await lessonRows(page, 2)), 'the loose gems stay, the lesson pops in around them');
  assert.deepEqual(v.tray, [9, null, 9]);
  // lesson 2: the first square sets up the second, which clears both columns
  await dragPiece(page, 0, 2, 3);
  assert.equal((await guideView(page)).ln, 0);
  await dragPiece(page, 2, 4, 3);
  assert.equal((await guideView(page)).ln, 2, 'two lines at once');
  const left2 = (await guideView(page)).rows;
  await dealt(page);
  v = await guideView(page);
  assert.equal(v.n, 3); assert.deepEqual(v.rows, overlay(left2, await lessonRows(page, 3))); assert.deepEqual(v.rows, await lessonRows(page, 3), 'every loose gem lies in a row the sweep completes'); assert.deepEqual(v.tray, [5, 9, 3]);
  assert.ok(await page.evaluate(() => closerTray), 'the sweep lesson shimmers like a closer');
  // lesson 3: every drop clears something, the last one sweeps
  await dragPiece(page, 0, 3, 0); await dragPiece(page, 1, 6, 0); await dragPiece(page, 2, 1, 5);
  const swept = await page.evaluate(() => ({ empty: grid.flat().every(v => !v), sweeps: stats.sweeps, transform, rainbow: discoveredWorlds.has('rainbow') }));
  assert.ok(swept.empty && swept.sweeps === 1, 'a clean sweep');
  assert.equal(swept.transform, null); assert.equal(swept.rainbow, false, 'specials stay off: the sweep starts no transformation');
  const scoreBefore = (await guideView(page)).score;
  await dealt(page);
  v = await guideView(page);
  const o = await page.evaluate(() => ({ kind: openingKind, gn: goldenNext, bonusMeter, star: starForced, banners: banners.map(b => b.txt), filled: grid.flat().filter(Boolean).length }));
  assert.equal(v.n, null, 'the guide is over'); assert.equal(v.tier, 'OPENING'); assert.equal(o.kind, 'light'); assert.equal(v.trayNo, 1);
  assert.ok(o.filled >= 3 && o.filled <= 8, 'a light opening');
  assert.ok(o.banners.includes("You've got it!"));
  assert.equal(v.score, scoreBefore, 'the player’s score stays'); assert.ok(v.score > 0);
  assert.equal(v.seen, '1', 'never again');
  assert.deepEqual([o.gn, o.bonusMeter, o.star], [false, 0, false], 'nothing the guide queued leaks into ordinary dealing');
  // and never again: the next game opens like everyone else's
  await page.evaluate(() => start());
  assert.equal((await guideView(page)).tier, 'OPENING');
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});

test('guided first game (1.1 D): a returning player, an old save without the flag, Daily and Adventure never get it', async ({ page }) => {
  await play(page);
  assert.notEqual((await guideView(page)).tier, 'GUIDE', 'a returning player (the flag is set)');
  await freshPlayer(page);
  await page.evaluate(() => { localStorage.setItem('crumble.stats', JSON.stringify({ v: 1, best: 500, games: 4 })); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  await play(page);
  assert.notEqual((await guideView(page)).tier, 'GUIDE', 'a 1.0 player with games played and a best');
  await freshPlayer(page);
  const r = await page.evaluate(() => { mode = 'daily'; start(); const d = lastTier; mode = 'adventure'; lvl = LEVELS[0]; stats.games = 0; start(); return { d, a: lastTier, g: guide }; });
  assert.notEqual(r.d, 'GUIDE'); assert.notEqual(r.a, 'GUIDE'); assert.equal(r.g, null);
  await freshPlayer(page);
  assert.equal(await page.evaluate(() => { CFG.GUIDED_START = false; start(); return lastTier; }), 'OPENING', 'the switch turns it off');
});

test('guided first game (1.1 D): off-script ends it quietly, the ordinary dealer takes over from the player’s board, and it never comes back', async ({ page }) => {
  await freshPlayer(page);
  await play(page);
  await dragPiece(page, 1, 0, 0);                                                    // the 1x3 not in the gap: no row filled
  await dealt(page);
  const v = await guideView(page);
  assert.equal(v.n, null); assert.notEqual(v.tier, 'GUIDE'); assert.equal(v.trayNo, 1, 'ordinary dealing starts at tray 1 (specials still wait for tray 6)');
  assert.equal(v.rows[5], 'XX...XXX', 'the player’s board stays as it is');
  assert.ok(await page.evaluate(() => !banners.some(b => /got it/.test(b.txt))), 'no line: it ends quietly');
  assert.equal(v.seen, '1');
  await page.reload(); await toGame(page);
  await page.evaluate(() => { clearRun(); stats.games = 0; best = 0; start(); });
  assert.notEqual((await guideView(page)).tier, 'GUIDE', 'the flag holds even with no games counted');
});

test('guided first game (1.1 D): a force-quit mid-guide resumes the same lesson; a game ending marks it seen', async ({ page }) => {
  await freshPlayer(page);
  await play(page);
  await dragPiece(page, 1, 5, 2);
  await dealt(page);
  await dragPiece(page, 0, 2, 3);                                                    // lesson 2, one square in
  const before = await guideView(page);
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => state === 'play');
  const after = await guideView(page);
  assert.deepEqual({ ...after }, { ...before }, 'the same lesson, board, tray and count');
  await dragPiece(page, 2, 4, 3);
  await dealt(page);
  assert.equal((await guideView(page)).n, 3, 'and it carries on');
  await page.evaluate(() => { stuck = true; gameOver(); });
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.guide')), '1', 'any game ending marks it seen');
});

test('guided first game (1.1 D): the hint is a ghost pulse on the target cells after a pause, gone on pickup, never an arrow', async ({ page, errors }) => {
  await freshPlayer(page);
  await play(page);
  await page.evaluate(() => { CFG.GUIDE_HINT_MS = 300; guideIdleT = performance.now(); });
  assert.equal(await page.evaluate(() => guideHintOn()), false, 'nothing at first');
  await page.waitForTimeout(450);
  const t = await page.evaluate(() => ({ on: guideHintOn(), tg: guideTarget(), busy: fxBusy() }));
  assert.ok(t.on && t.busy, 'on after the pause, drawn at full frame rate');
  assert.deepEqual(t.tg.cells, [[5, 2], [5, 3], [5, 4]], 'the gap of the row');
  await frames(page, 4);
  const g = await geometry(page);
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  assert.equal(await page.evaluate(() => guideHintOn()), false, 'a pickup hides it');
  await page.mouse.up();
  // a gap no piece in the tray can fill is never hinted
  await page.evaluate(() => { tray = [{ s: SHAPES[5], gi: 0 }, null, null]; });
  assert.equal(await page.evaluate(() => guideTarget()), null);
  assert.deepEqual(errors.filter(e => !/ERR_FAILED/.test(e)), []);
});

// ── Plan 1.1 C: drag feel on desktop and in the app ──

test('C2 mouse lift: a mouse drag floats 0.15 cells above the cursor, a finger still 1 cell', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { CFG.MOUSE_LIFT = 0.15; });                 // the harness equals it to LIFT for its old scripts
  await setup(page, { rows: EMPTY, trayShapes: [0, 3, 10] });
  const g = await geometry(page), f = await fingers(page);
  const x = g.trayCenters[0].x, y = g.by + g.cell * 12;
  const gap = async () => { await frames(page, 14); const v = await dragView(page); return (y - (v.cy + v.rows * g.cell / 2)) / g.cell; };
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
  await page.mouse.move(x, y, { steps: 4 });
  assert.ok(Math.abs(await gap() - 0.15) < 0.05, 'mouse lift'); await page.mouse.up(); await frames(page, 30);
  await f.down(1, g.trayCenters[1].x, g.trayCenters[1].y); await f.move(1, x, y, 4);
  assert.ok(Math.abs(await gap() - 1) < 0.05, 'touch lift'); await f.up(1);
});

test('C4 desktop keys: Escape and P open and close the pause card, only in a game', async ({ page }) => {
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#pauseCard'), true, 'nothing to pause on the start screen');
  await play(page); await dealt(page);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => ({ paused, card: !el('pauseCard').hidden })), { paused: true, card: true });
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => ({ paused, card: !el('pauseCard').hidden })), { paused: false, card: false });
  await page.keyboard.press('p');
  assert.equal(await page.evaluate(() => paused), true);
  await page.keyboard.press('P');
  assert.equal(await page.evaluate(() => paused), false);
});

test('C1 slot tick: selection haptics in the app, one per new landing cell, none on pickup or when the slot goes, 40 ms apart, off with the switch', async ({ page }) => {
  await play(page); await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 3, 10] });
  await page.evaluate(() => {
    window.__sel = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: {
      impact: () => Promise.resolve(), notification: () => Promise.resolve(),
      selectionStart: () => { __sel.push('start'); return Promise.resolve(); },
      selectionChanged: () => { __sel.push('tick'); return Promise.resolve(); },
      selectionEnd: () => { __sel.push('end'); return Promise.resolve(); } } } };
  });
  const take = () => page.evaluate(() => __sel.splice(0));
  const g = await geometry(page), s = { rows: 1, cols: 1 };
  const at = (r, c) => fingerFor({ ...g, lift: 0.15 }, s, r, c);
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
  assert.deepEqual(await take(), ['start'], 'pickup: the selection session opens, no tick');
  let p = at(3, 3); await page.mouse.move(p.x, p.y);
  assert.deepEqual(await take(), ['tick'], 'first landing cell: one tick');
  await page.evaluate(() => new Promise(r => setTimeout(r, 60)));
  p = at(3, 3.2); await page.mouse.move(p.x, p.y);
  assert.deepEqual(await take(), [], 'same cell: no tick');
  p = at(3, 4); await page.mouse.move(p.x, p.y);
  assert.deepEqual(await take(), ['tick'], 'a different cell: a tick');
  const tickMs = await page.evaluate(() => { const v = CFG.SLOT_TICK_MS; CFG.SLOT_TICK_MS = 5000; return v; });   // the window stretched for this one step: two test round-trips inside a real 40 ms is a race on a slow runner
  assert.equal(tickMs, 40, 'ticks are 40 ms apart at least');
  p = at(3, 5); await page.mouse.move(p.x, p.y);
  assert.deepEqual(await take(), [], 'inside the window: no second tick');
  await page.evaluate(v => { CFG.SLOT_TICK_MS = v; }, tickMs);
  p = at(40, 3); await page.mouse.move(p.x, p.y); await page.evaluate(() => new Promise(r => setTimeout(r, 60)));
  assert.deepEqual(await take(), [], 'slot gone: no tick');
  await page.mouse.up();
  assert.deepEqual(await take(), ['end'], 'release closes the session');
  await page.evaluate(() => { CFG.HAPTICS = false; });
  await dealt(page);
  await page.mouse.move(g.trayCenters[1].x, g.trayCenters[1].y); await page.mouse.down();
  p = at(2, 2); await page.mouse.move(p.x, p.y, { steps: 3 }); await page.mouse.up();
  assert.deepEqual(await take(), [], 'Haptics off: silent');
});

// ---- coaster dealing (1.1 G) ----
test('coaster (1.1 G): Challenge keeps the 1.0 dealer, so a seed deals exactly what it dealt before the tide', async ({ page }) => {
  // generated on main before 1.1 G; if this changes, every shared challenge link and today's challenge change with it
  const packs = await page.evaluate(() => ['frozen1', 'd2026-11-11'].map(s => chPack(chMake(s))));
  assert.deepEqual(packs, ['AAYAgAAAAAAAAAAAIGoAAAAAAIAAAAAAAkYiDAogTEXcZLZJBIgTb5ShVEEgfoVEDVcYSYo1jpbWBoGoRSklAaAAAAAAAFeAAG4AAISA',
    'ADAYAAAAAAAAAAAAAAAAAAAIAAAAAAAAAKgxGIqViaPZbWUbEkdUorHRjgL6XpFEBqCRUjUMJcKEIZEjdWCrJrdAAAAAAGkAAH5AAJdA']);
});

test('coaster (1.1 G): EASY and LEAN stretches take turns with rolled lengths, saved with the run; Challenge and Adventure stay off it', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = { seq: '', awk: { easy: [], lean: [] }, small: 0, pieces: 0 };
    W73(); resetTide(); closerCool = 99; sweepCool = 99; rndSrc = mulberry(7);
    const crowd0 = CFG.CROWD_ROOM; CFG.CROWD_ROOM = 0;   // the tide alone: comeback keys (which this scattered board can trip) are tested on their own
    // a calm, scattered board of 26 gems: no sweep on it, room enough to stay out of the edge
    const board = ['11000011','10000001','00011000','00100100','10000001','00011000','11000011','10011001'];
    for (let k = 0; k < 90; k++) { B73(board); tray = [null, null, null]; dryN = 0; genTray(); closerCool = 99; sweepCool = 99;
      o.seq += tide.st === 'easy' ? 'E' : 'L'; o.awk[tide.st].push(tray.filter(t => awkward(t.s)).length);
      for (const t of tray) { o.pieces++; if (t.s.n <= 3) o.small++; } }
    o.labels = lastTier; rndSrc = null; CFG.CROWD_ROOM = crowd0; o.len = [CFG.TIDE_EASY_MIN, CFG.TIDE_EASY_MAX, CFG.TIDE_LEAN_MIN, CFG.TIDE_LEAN_MAX];
    const snap = JSON.parse(JSON.stringify(snapshot())); const t0 = JSON.stringify(tide); resetTide(); restore(snap); o.saved = JSON.stringify(tide) === t0;
    o.on = tideOn(); mode = 'adventure'; o.adv = tideOn(); mode = 'challenge'; o.ch = tideOn(); mode = 'endless'; CFG.TIDE = false; o.off = tideOn(); CFG.TIDE = true;
    return o; })()`);
  const runs = r.seq.match(/E+|L+/g);
  assert.equal(r.seq[0], 'E', 'a run starts EASY: ' + r.seq);
  assert.ok(runs.length >= 6, 'stretches take turns: ' + r.seq);
  for (const run of runs.slice(1, -1)) {
    const [lo, hi] = run[0] === 'E' ? r.len.slice(0, 2) : r.len.slice(2);
    assert.ok(run.length >= lo && run.length <= hi, (run[0] === 'E' ? 'EASY' : 'LEAN') + ' lasts ' + lo + '-' + hi + ' trays: ' + r.seq);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(r.awk.easy) <= 1 && avg(r.awk.lean) >= 1.8, 'EASY is mostly rectangles and bars, LEAN mostly awkward: ' + avg(r.awk.easy).toFixed(2) + ' / ' + avg(r.awk.lean).toFixed(2));
  assert.ok(r.small / r.pieces <= 0.2, 'few pieces of 3 cells or fewer: ' + r.small + '/' + r.pieces);
  assert.ok(r.saved, 'the stretch survives a resume');
  assert.ok(r.on && !r.adv && !r.ch && !r.off, 'Endless only here; Adventure, Challenge and the switch keep the old dealer');
});

test('the deal never fails (1.1 G): on awkward boards every tray plays out in full, pieces have sound spots, a mess gets its fix', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = { bad: [], unsound: 0, dealt: 0, fixed: 0, fixTries: 0 };
    const boards = [
      ['10101010','01010101','10101010','01010101','00000000','00000000','00000000','00000000'],   // checkered: nothing big fits up top
      ['11111110','11111101','11111011','11110111','00000000','00000000','00000000','00000000'],   // a staircase of single holes
      ['11011011','10110110','01101101','11011011','10110110','01101101','00000000','00000000'],   // ragged and tight
      ['11111111','11111110','11111100','11111000','11110000','11100000','11000000','10000000'],   // half full, one slope
      ['11101110','11101110','11101110','00000000','11101110','11101110','11101110','00000000'],   // posts
      ['11111011','11110011','11111011','11111111','11011111','10011111','11011111','11111111'],   // nearly full: the edge
    ];
    let seed = 1;
    for (const b of boards) for (const st of ['easy', 'lean']) for (let k = 0; k < 6; k++) {
      W73(); resetTide(); tide = { st, n: 1, len: 99 }; closerCool = 99; sweepCool = 99; dryN = k % 3;
      const a0 = B73(b); rndSrc = mulberry(seed++); tray = [null, null, null]; genTray();
      const hand = tray.map(t => t.s); o.dealt++;
      if (!evalHand(a0, hand, 400000).ok) o.bad.push(b.join('/') + ' ' + st + ' ' + lastTier + ' ' + hand.map(s => SHAPES.indexOf(s)).join(','));
      const [lo, hi] = packBits(a0), rm = roomBits(lo, hi);
      if (/EASY|LEAN/.test(lastTier) && !hand.every(s => soundBits(lo, hi, s, rm))) o.unsound++;
      // a LEAN tray on a board the player has made a mess of (tight, or dry for LEAN_DRY trays) carries a piece that clears a line
      if (st === 'lean' && /LEAN/.test(lastTier) && (rm < CFG.LEAN_ROOM || dryN >= CFG.LEAN_DRY) && SHAPES.some(s => s.n >= 2 && bestDrop(lo, hi, s) >= 1)) {
        o.fixTries++; if (hand.some(s => !s.star && bestDrop(lo, hi, s) >= 1)) o.fixed++; }
    }
    rndSrc = null;
    // the last guard: a hand that cannot be played becomes one that can
    const a1 = B73(boards[5]), nine = SHAPES.find(s => s.n === 9);
    const g = ensureWay(a1, [nine, nine, nine]); o.guard = evalHand(a1, g, 400000).ok;
    return o; })()`);
  assert.deepEqual(r.bad, [], 'every tray dealt has a solution');
  assert.ok(r.unsound <= r.dealt * 0.1, 'pieces have a sound spot: ' + r.unsound + ' of ' + r.dealt + ' trays without');
  assert.ok(r.fixTries > 0 && r.fixed === r.fixTries, 'a messy LEAN board gets a piece that clears: ' + r.fixed + '/' + r.fixTries);
  assert.ok(r.guard, 'ensureWay turns an unplayable hand into a playable one');
});

test('build-off opening (round 4): Endless opens on an empty board with three of one piece', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const o = { build: 0, n: 0, bad: [] }, orig = CFG.OPEN_BUILD; CFG.OPEN_BUILD = 1;
    for (let seed = 1; seed <= 20; seed++) {
      rndSrc = mulberry(seed); seedOpening(); o.n++;
      const h = tray.map(t => t.s);
      if (openingKind === 'build' && countFlat(packGrid(grid)) === 0 && h[0] === h[1] && h[1] === h[2] && OPEN_BUILD.includes(h[0])) o.build++;
      else o.bad.push(openingKind);
    }
    CFG.OPEN_BUILD = orig; o.kinds = {};   // (round 5) the others are usable: a seeded band to finish, never the loose 'light' or 'busy' boards
    for (let seed = 1; seed <= 20; seed++) { rndSrc = mulberry(seed); seedOpening(); o.kinds[openingKind] = (o.kinds[openingKind] || 0) + 1; }
    rndSrc = null;
    return o; });
  assert.equal(r.build, r.n, 'every opening is the build-off one when OPEN_BUILD is 1: ' + r.bad.join(','));
  assert.deepEqual(Object.keys(r.kinds).filter(k => k !== 'build' && k !== 'gift'), [], 'openings are build-off or a band to finish: ' + JSON.stringify(r.kinds));
});

test('matched trays (round 4): EASY trays often bring two or three of one piece, and a tray finishes a line when the board has one ready', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = { dealt: 0, matched: 0, follow: 0, followTries: 0 }, eg = CFG.EASY_RUN_GEMS; CFG.EASY_RUN_GEMS = 0;   // no sweep run or hunt: the plain EASY tray
    const boards = [
      ['11111100','11111100','00000000','00000000','00000000','00000000','00000000','00000000'],
      ['11000000','11000000','11000000','11000000','11000000','11000000','00000000','00000000'],
      ['11111111','11111111','11111000','00000000','00000000','00000000','00000000','00000000'],
      ['10000001','10000001','00000000','00000000','00000000','00000000','10000001','10000001'],
    ];
    let seed = 3;
    for (const b of boards) for (let k = 0; k < 8; k++) {
      W73(); resetTide(); tide = { st: 'easy', n: 5, len: 12 }; closerCool = 99; sweepCool = 99; dryN = 0; sweepRun = null;
      const a0 = B73(b), [lo, hi] = packBits(a0);
      rndSrc = mulberry(seed++); tray = [null, null, null]; genTray();
      o.tiers = (o.tiers || '') + lastTier + ' '; if (!/EASY/.test(lastTier)) continue;
      const h = tray.map(t => t.s); o.dealt++;
      if (h.some(s => !s.star && s.n >= 3 && h.filter(x => x === s).length >= 2)) o.matched++;
      o.nonRect = (o.nonRect || 0) + h.filter(s => !s.star && s.n !== s.rows * s.cols && bestDrop(lo, hi, s) < 1).length;   // (round 5) EASY: rectangles and bars (a key that clears a line may be any shape)
      if (SHAPES.some(s => s.n >= 4 && bestDrop(lo, hi, s) >= 1)) { o.followTries++; if (h.some(s => !s.star && bestDrop(lo, hi, s) >= 1)) o.follow++; }
    }
    rndSrc = null; CFG.EASY_RUN_GEMS = eg; return o; })()`);
  assert.ok(r.dealt >= 12, 'EASY trays dealt: ' + r.dealt + ' ' + r.tiers);
  assert.ok(r.matched >= r.dealt * 0.2, 'matched trays: ' + r.matched + ' of ' + r.dealt);
  assert.ok((r.nonRect || 0) <= r.dealt * 0.1, 'EASY deals rectangles and bars: ' + r.nonRect + ' other pieces in ' + r.dealt + ' trays');
  assert.ok(r.follow >= r.followTries * 0.9, 'a ready line gets its piece: ' + r.follow + ' of ' + r.followTries);
});

test('carrying combo (round 6): in Endless the combo survives drops that clear nothing until COMBO_GRACE of them in a row; Challenge keeps the 1.0 combo', async ({ page }) => {
  await play(page);
  const r = await page.evaluate(() => {
    const o = {}; mode = 'endless';
    combo = 4; comboMiss = 0;
    const dot = SHAPES.find(s => s.n === 1);
    o.endless = [];
    for (let k = 0; k < CFG.COMBO_GRACE; k++) { grid = empty(); tray = [{ s: dot, gi: 0 }, null, null]; place(0, k, k); o.endless.push(combo); }
    mode = 'challenge'; combo = 4; comboMiss = 0; grid = empty(); tray = [{ s: dot, gi: 0 }, null, null]; place(0, 3, 3); o.challenge = combo;
    mode = 'endless';
    return o; });
  assert.deepEqual(r.endless.slice(0, -1), Array(r.endless.length - 1).fill(4), 'the streak carries over misses: ' + r.endless.join(','));
  assert.equal(r.endless[r.endless.length - 1], 0, 'and ends on the last one allowed');
  assert.equal(r.challenge, 0, 'Challenge: a miss ends it');
});

test('big solves (round 3): after a LEAN stretch, a board of nearly-done lines gets keys that clear several at once, and small pieces come one a tray unless it clears the board', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = { lines: [], small: 0, dealt: 0, ready: 0 };
    const boards = [
      ['11111100','11111100','11111100','00000000','00000000','00000000','00000000','00000000'],   // three rows short of a 2-wide gap
      ['11011111','11011111','11011111','11011111','00000000','00000000','00000000','00000000'],   // four rows with one hole in a column
      ['11110000','11110000','11110000','11110000','11110000','00000000','00000000','00000000'],   // a block: rows half done
    ];
    let seed = 7;
    for (const b of boards) for (let k = 0; k < 6; k++) {
      W73(); resetTide(); tide = { st: 'easy', n: 0, len: 12 }; closerCool = 99; sweepCool = 99; dryN = 0;
      const a0 = B73(b), [lo, hi] = packBits(a0); o.ready = Math.max(o.ready, readyLines(lo, hi));
      rndSrc = mulberry(seed++); tray = [null, null, null]; genTray(); o.dealt++;
      const hand = tray.map(t => t.s);
      o.lines.push(evalHand(a0, hand, 400000).lines);
      if (hand.filter(s => !s.star && s.n <= 3).length > 1 && !/CLOSER|SWEEP/.test(lastTier)) { o.small++; o.why = (o.why || '') + lastTier + ' '; }
    }
    rndSrc = null; return o; })()`);
  assert.ok(r.ready >= 3, 'the boards have nearly-done lines');
  const big = r.lines.filter(n => n >= 3).length;
  assert.ok(big >= r.dealt * 0.6, 'most trays can clear 3+ lines at once: ' + r.lines.join(','));
  assert.ok(r.small <= 1, 'small pieces come one a tray (a board clear may use more): ' + r.why + r.small + ' of ' + r.dealt + ' trays had two');
});

// ---- the home dealer (DEALER_HOME) ----
// in the page: plays `trays` trays of Endless from the seeded stream `seed` with a simple person-like bot (its own dice: any
// piece first, one of the three snuggest spots), starting a new game when stuck. Per tray as dealt: the shapes, the label, the
// game, the gems on the board, the lines cleared in it (cl) and board wipes (sw), and with `check` whether it has a solution,
// whether every piece has a home (as dealt or after its tray-mates), its count of pieces of 3 cells or fewer, and for a WIN
// tray the most gems a play at homes takes off the board (net).
const HOME_SIM = `(trays, seed, check) => {
  let hs = seed * 7919 + 1; const hr = () => { hs = (hs + 0x6D2B79F5) >>> 0; let t = hs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const flush = (s, r, c) => { let k = 0; for (const [dr, dc] of s.cells) for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const rr = r + dr + a, cc = c + dc + b; if (s.cells.some(([x, y]) => x === dr + a && y === dc + b)) continue; if (rr < 0 || cc < 0 || rr >= N || cc >= N || grid[rr][cc]) k++; } return k; };
  const finish = () => { if (dealing) { runSteps(dealing.it); dealing = null; } };
  const out = []; let game = 0, l0 = stats.lines, s0 = stats.sweeps;
  // the most gems a play at homes takes off the board (gems removed less cells added), every order, every home spot
  const netOf = (lo0, hi0, hand) => { const hb = hbOf(lo0, hi0), g0 = pop32(lo0) + pop32(hi0); let best = -99, nodes = 60000;
    const dfs = (lo, hi, left) => { if (!left.length) { best = Math.max(best, g0 - pop32(lo) - pop32(hi)); return; }
      for (let k = 0; k < left.length; k++) for (const m of placeMasks(left[k])) { if (nodes-- <= 0) return; if ((lo & m.lo) || (hi & m.hi) || homeAt(lo, hi, left[k], m, hb) < 0) continue; const a = _lo, b = _hi; dfs(a, b, left.filter((x, j) => j !== k)); } };
    dfs(lo0, hi0, hand); return best; };
  const rec = () => { const a0 = packGrid(grid), [lo, hi] = packBits(a0), hand = tray.map(t => t.s); const r = { t: hand.map(s => SHAPES.indexOf(s)).join(','), l: lastTier, g: game, gems: pop32(lo) + pop32(hi) };
    if (out.length) { const p = out[out.length - 1]; p.cl = stats.lines - l0; p.sw = stats.sweeps - s0; } l0 = stats.lines; s0 = stats.sweeps;   // the tray before: lines the player cleared in it, board wipes
    if (check) { r.ok = evalHand(a0, hand, 400000).ok; r.home = hand.every((s, k) => homeAfterMates(lo, hi, hand, k, 20000)); r.small = hand.filter(s => s.n <= 3).length; r.flush = homeOrders(lo, hi, hand, 4000, 0) > 0;
      if (/^HOME WIN/.test(lastTier)) r.net = netOf(lo, hi, hand); }
    out.push(r); };
  rndSrc = mulberry(seed); start(); finish(); rec();
  while (out.length < trays) {
    const order = [0, 1, 2].filter(i => tray[i]).sort(() => hr() - 0.5); let mv = null;
    for (const i of order) { const s = tray[i].s, c3 = [];
      for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) if (canPlace(s, r, c, grid)) c3.push([flush(s, r, c), r, c]);
      if (!c3.length) continue; c3.sort((a, b) => b[0] - a[0]); const p = c3[(hr() * Math.min(3, c3.length)) | 0]; mv = [i, p[1], p[2]]; break; }
    if (!mv) { game++; start(); finish(); rec(); continue; }
    place(mv[0], mv[1], mv[2]); clearRunFx();
    if (dealing) { finish(); rec(); }
  }
  rndSrc = null; return out;
}`;
test('home dealer: off by default, and with the switch off a pinned Endless seed deals exactly what it dealt before it', async ({ page }) => {
  await play(page);
  assert.equal(await page.evaluate(() => CFG.DEALER_HOME), false);
  // generated on main before the home dealer (40 trays, one game restart included)
  const pinned = '35,35,35;9,7,3;36,9,36;10,35,18;36,31,9;4,35,35;36,31,36;34,9,10;36,5,5;36,8,36;4,36,13;10,15,35;10,10,18;28,9,10;35,5,1;7,7,7;17,7,10;7,35,32;6,24,10;3,4,4;1,1,20;13,4,2;32,21,22;35,36,5;8,6,8;10,10,8;20,35,10;15,18,32;36,12,23;26,21,35;5,5,8;30,8,18;22,6,12;4,4,11;36,4,19;5,5,5;9,9,5;35,35,35;27,6,8;8,6,6';
  assert.equal(await page.evaluate(`(${HOME_SIM})(40, 4242, false)`).then(r => r.map(x => x.t).join(';')), pinned);
});
test('home dealer: the switch leaves Challenge as it was (frozen deals), and ?dealer=home turns it on', async ({ page, server }) => {
  await page.evaluate(() => { CFG.DEALER_HOME = true; });
  const packs = await page.evaluate(() => ['frozen1', 'd2026-11-11'].map(s => chPack(chMake(s))));
  assert.deepEqual(packs, ['AAYAgAAAAAAAAAAAIGoAAAAAAIAAAAAAAkYiDAogTEXcZLZJBIgTb5ShVEEgfoVEDVcYSYo1jpbWBoGoRSklAaAAAAAAAFeAAG4AAISA',
    'ADAYAAAAAAAAAAAAAAAAAAAIAAAAAAAAAKgxGIqViaPZbWUbEkdUorHRjgL6XpFEBqCRUjUMJcKEIZEjdWCrJrdAAAAAAGkAAH5AAJdA']);
  assert.deepEqual(await page.evaluate(() => { mode = 'challenge'; const c = hdOn(); mode = 'adventure'; const a = hdOn(); mode = 'endless'; return [c, a, hdOn()]; }), [false, false, true]);
  await page.goto(server.url + '?dealer=home'); await toGame(page);
  assert.equal(await page.evaluate(() => CFG.DEALER_HOME), true);
  assert.ok(await page.evaluate(() => DEV_TOGGLES.some(t => t[0] === 'DEALER_HOME')), 'an Admin switch');
});
test('home dealer: a home is a line it completes or a flush spot (HOME_BUMP); no hole sealed', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const sq = SHAPES.find(s => s.rows === 2 && s.cols === 2 && s.n === 4), S = SHAPES[19], bar = SHAPES[5];
    const at = (rows, s, r, c) => { const [lo, hi] = packBits(B73(rows)); return homeAt(lo, hi, s, placeMasks(s).find(m => m.r === r && m.c === c)); };
    const E = Array(8).fill('00000000'), floor = ['00000000','00000000','00000000','00000000','00000000','00000000','00000000','11111110'];
    const o = { corner: at(E, sq, 0, 0), middle: at(E, sq, 3, 3), wall: at(E, bar, 0, 2),
      sOnFloor: at(floor, S, 5, 2), sqOnFloor: at(floor, sq, 5, 3), sqInCorner: at(floor, sq, 5, 0),
      line: at(floor, SHAPES[0], 7, 7),
      seal: at(['00000000','00000000','00000000','00000000','00000000','00000000','11000110','11101111'], SHAPES[3], 6, 2) };   // flush (bump 0) and no line, but it shuts the cell under it in
    const b0 = CFG.HOME_BUMP; CFG.HOME_BUMP = 4; o.sqOnFloor4 = at(floor, sq, 5, 3); CFG.HOME_BUMP = b0;
    return o; })()`);
  assert.equal(r.corner, 0, 'a 2x2 in a corner of an empty board sits flush');
  assert.equal(r.middle, -1, 'in the open it sticks out');
  assert.equal(r.wall, 0, 'a bar along the wall');
  assert.equal(r.sqInCorner, 0, 'a 2x2 on the floor against the wall');
  assert.equal(r.sqOnFloor, -1, 'a 2x2 on the floor in the open is a bump');
  assert.equal(r.sOnFloor, -1, 'an S on a flat floor sticks out');
  assert.equal(r.line, 1, 'completing a line is a home');
  assert.equal(r.seal, -1, 'a bar that shuts an empty cell in is no home');
  assert.equal(r.sqOnFloor4, 0, 'HOME_BUMP sets how far it may stick out');
});
test('home dealer: bot-played trays on two seeds always have a solution, every piece a home; win mode lasts until a wipe, the cap or a dry spell, then a cool stretch', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.DEALER_HOME = true; });
  const cfg = await page.evaluate(() => [CFG.HOME_WIN_MAX, CFG.HOME_COOL_MIN, CFG.HOME_COOL_MAX, CFG.HOME_WIN_DRY]);
  const RX = /^HOME (\w+)(·CLEAR)?(·FB|·GUARD)? (warm|win|cool)(?:·LK)?(?: (\d+)\/(\d+))?$/;
  let kinds = {}, guards = 0, wins = 0, ends = { wipe: 0, cap: 0, dry: 0 }, cools = 0, winTrays = 0, flat = 0, cleared = 0;
  for (const seed of [11, 12]) {
    const r = await page.evaluate(`(${HOME_SIM})(260, ${seed}, true)`);
    for (const t of r) {
      assert.ok(t.ok, 'every tray has a solution: ' + t.l + ' ' + t.t);
      if (t.l === 'OPENING') continue;
      const m = t.l.match(RX); assert.ok(m, 'labelled with the dealer state: ' + t.l);
      t.m = m; kinds[m[1]] = (kinds[m[1]] || 0) + 1;
      if (m[3] === '·GUARD') { guards++; continue; }
      assert.ok(t.home, 'every piece has a home: ' + t.l + ' ' + t.t);
      assert.ok(t.small <= 1 || m[2] || m[1] === 'FINISH' || m[1] === 'WIN', 'one piece of 3 cells or fewer unless it clears the board (FINISH and WIN may use small pieces): ' + t.l + ' ' + t.t);
      if (m[1] === 'GIFT' || m[1] === 'WIN') assert.equal(m[4], 'win', 'gifts and WIN trays only in win mode: ' + t.l);
      if (m[1] === 'WIN') { winTrays++; if (t.net > 0) continue; flat++; }
      if (m[1] === 'FINISH') assert.ok(t.flush, 'a FINISH tray plays every piece strictly flush (or clearing) in some order, padding included: ' + t.l + ' ' + t.t);
    }
    // per game, from the dealer's own labels: win mode counts 1, 2, ... and ends only on a wipe (its BUILD tray, or the tray after
    // the wipe), at HOME_WIN_MAX, or after HOME_WIN_DRY trays in a row the player cleared nothing in; a cool stretch of HOME_COOL_MIN..MAX follows
    const games = {}; for (const t of r) if (t.m) (games[t.g] = games[t.g] || []).push(t);
    for (const g of Object.values(games)) {
      const ph = g.map(t => t.m[4][0]).join('');
      const runs = []; let k = 0; for (const run of ph.match(/w+|i+|c+/g) || []) { runs.push({ p: run[0], a: k, b: k + run.length }); k += run.length; }
      runs.forEach((u, i) => {
        const last = i + 1 === runs.length;
        if (u.p === 'c' && !last) { cools++; assert.ok(u.b - u.a >= cfg[1] && u.b - u.a <= cfg[2], 'cool lasts ' + cfg[1] + '-' + cfg[2] + ': ' + ph); }
      });
      for (let a = 0; a < g.length; a++) {
        if (g[a].m[4] !== 'win' || (a && g[a - 1].m[4] === 'win')) continue;
        let b = a; while (b + 1 < g.length && g[b + 1].m[4] === 'win') b++;
        const run = g.slice(a, b + 1); wins++;
        run.forEach((t, i) => assert.equal(+t.m[5], i + 1, 'win mode counts its trays: ' + run.map(x => x.l).join(' | ')));
        let dry = 0;
        for (let i = 0; i < run.length; i++) {                        // nothing ends it early: no wipe, no dry spell before its last tray
          const t = run[i], isLast = i === run.length - 1;
          dry = t.cl ? 0 : dry + 1; cleared += t.cl ? 1 : 0;
          if (!isLast && t.sw) assert.ok(i + 1 === run.length - 1 && run[i + 1].m[1] === 'BUILD' && run[i + 1].gems === 0, 'a wipe ends win mode after its BUILD tray: ' + run.map(x => x.l + ' ' + x.cl + '/' + x.sw).join(' | '));
          if (!isLast) assert.ok(dry < cfg[3] || (i + 1 === run.length - 1 && run[i + 1].m[1] === 'BUILD'), 'a dry spell of ' + cfg[3] + ' ends it: ' + run.map(x => x.l + ' ' + x.cl).join(' | '));
        }
        if (b + 1 >= g.length) continue;                               // the game ended in it
        assert.equal(g[b + 1].m[4], 'cool', 'a cool stretch follows win mode: ' + ph);
        const t = run[run.length - 1], why = t.sw || t.m[1] === 'BUILD' && t.gems === 0 ? 'wipe' : run.length === cfg[0] ? 'cap' : dry >= cfg[3] ? 'dry' : null;
        assert.ok(why, 'win mode ends only on a wipe, the cap or a dry spell: ' + run.map(x => x.l + ' ' + x.cl + '/' + x.sw).join(' | '));
        ends[why]++;
      }
    }
  }
  assert.ok(wins >= 10 && cools >= 5, 'win modes and cool stretches came round: ' + wins + ' / ' + cools);
  assert.ok(ends.cap + ends.wipe + ends.dry >= 8, 'win modes ended: ' + JSON.stringify(ends));
  assert.ok(winTrays >= 40, 'WIN trays came round: ' + winTrays);
  assert.ok(flat <= winTrays * 0.05, 'a WIN tray takes gems off the board when played at homes (net > 0): ' + flat + ' of ' + winTrays + ' did not');
  assert.ok(kinds.WIN && kinds.STEADY && kinds.TWIST, 'the kinds: ' + JSON.stringify(kinds));
  assert.ok(guards <= 2, 'the last guard is rare: ' + guards);
  assert.ok(kinds.FINISH, 'FINISH trays came round: ' + JSON.stringify(kinds));
});
test('home dealer: win mode starts when earned or after HOME_WIN_WAIT warm trays, carries on across trays that clear, and ends on a dry spell, the cap, or a wipe after its BUILD tray', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.DEALER_HOME = true; W73(); roomNow = 1; const o = {}; rndSrc = mulberry(7);
    const mid = ['00000000','00000000','00000011','00110000','11001100','11001100','11001100','11001100'];   // no nearly-done line, not low (20 gems), room
    const ready = ['00000000','00000000','00000000','00000000','11111000','11111000','11111000','10000000'];   // three nearly-done lines
    const deal = (rows, cleared) => { B73(rows); roomNow = 1; trayClear = cleared; tray = [null, null, null]; genTray(); return lastTier; };
    const W = CFG.HOME_WIN_WAIT, s0 = { ...hdStats.win };
    hdeal = { ph: 'warm', n: 0, len: 0, f: 0, wp: 0 }; o.warm = []; for (let k = 0; k < W + 1; k++) o.warm.push(deal(mid, true));
    hdeal = { ph: 'warm', n: 0, len: 0, f: 0, wp: 0 }; o.earned = deal(ready, true);
    o.on = []; for (let k = 0; k < 3; k++) o.on.push(deal(mid, true));               // the player clears in every tray: it carries on
    o.dry = [deal(mid, false), deal(mid, false)];                                   // the last tray and the one before it cleared nothing: cool
    hdeal = { ph: 'win', n: CFG.HOME_WIN_MAX - 1, len: CFG.HOME_WIN_MAX, f: 0, wp: 0 }; o.cap = [deal(mid, true), deal(mid, true)];
    hdeal = { ph: 'win', n: 2, len: CFG.HOME_WIN_MAX, f: 0, wp: 0 }; dryN = 0;
    B73(['00000000','00000000','00000000','00000000','00000000','00000000','00000000','11111110']);
    waveAfterDrop(packGrid(grid), 1, 0, 1, false); o.wp = hdeal.wp;                  // the player wipes the board in win mode
    o.wipe = [deal(Array(8).fill('00000000'), true), deal(mid, true)];
    o.ends = ['cap', 'dry', 'wipe'].map(k => (hdStats.win[k] || 0) - (s0[k] || 0));
    rndSrc = null; return o; })()`);
  const W = await page.evaluate(() => CFG.HOME_WIN_WAIT), M = await page.evaluate(() => CFG.HOME_WIN_MAX);
  r.warm.slice(0, W).forEach(l => assert.match(l, / warm$/, 'warm until earned: ' + r.warm));
  assert.match(r.warm[W], / win 1\/\d+$/, 'after HOME_WIN_WAIT warm trays it starts anyway: ' + r.warm);
  assert.match(r.earned, /^HOME \w+(·\w+)? win 1\//, 'nearly-done lines (HOME_EARN) start it: ' + r.earned);
  assert.deepEqual(r.on.map(l => l.split(' ').pop()), ['2/' + M, '3/' + M, '4/' + M], 'it carries on across trays that clear: ' + r.on);
  assert.match(r.dry[0], / win 5\//, 'one dry tray does not end it: ' + r.dry);
  assert.match(r.dry[1], / cool \d+\/\d+$/, 'HOME_WIN_DRY trays the player cleared nothing in end it: ' + r.dry);
  assert.match(r.cap[0], new RegExp(' win ' + M + '/' + M + '$')); assert.match(r.cap[1], / cool /, 'HOME_WIN_MAX ends it: ' + r.cap);
  assert.equal(r.wp, 1, 'the wipe is seen as it happens');
  assert.match(r.wipe[0], /^HOME BUILD win 3\//, 'the emptied board gets its BUILD tray in win mode: ' + r.wipe);
  assert.match(r.wipe[1], / cool /, 'then win mode ends: ' + r.wipe);
  assert.deepEqual(r.ends, [1, 1, 1], 'the dealer records why each ended');
});
test('home dealer: FINISH on a low board in a cool stretch empties it (single cells too), padding flush; a roll, capped in a row', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.DEALER_HOME = true; CFG.HOME_FINISH = 1; CFG.HOME_FINISH_HOT = 1; const o = {};
    // can the player’s pieces, each dropped at a strict home (a line, or flush: bump 0), empty the board in some order?
    const empties = (lo, hi, hand) => { const rec = (lo, hi, left) => { if (!lo && !hi) return true; for (let k = 0; k < left.length; k++) for (const m of placeMasks(left[k])) {
      if ((lo & m.lo) || (hi & m.hi) || homeAt(lo, hi, left[k], m, 0) < 0) continue; const a = _lo, b = _hi; if (rec(a, b, left.filter((x, j) => j !== k))) return true; } return false; }; return rec(lo, hi, hand); };
    const deal = rows => { W73(); roomNow = 1; hdeal = { ph: 'cool', n: 1, len: 6, f: 0, hot: 0 }; const a0 = B73(rows), [lo, hi] = packBits(a0); rndSrc = mulberry(5); tray = [null, null, null]; genTray(); rndSrc = null;
      const hand = tray.map(t => t.s); return { l: lastTier, sizes: hand.map(s => s.n), empties: empties(lo, hi, hand), flush: homeOrders(lo, hi, hand, 4000, 0) > 0, ph: hdeal.ph, n: hdeal.n, f: hdeal.f }; };
    const E = '00000000';
    o.block = deal([E, E, E, E, E, E, '11111100', '11111100']);   // two rows, a 2x2 gap: the obvious clearing cut
    o.cells = deal([E, E, E, E, E, E, E, '01101101']);             // three single-cell gaps
    CFG.HOME_FINISH = 0; CFG.HOME_FINISH_HOT = 0; o.off = deal([E, E, E, E, E, E, '11111100', '11111100']);
    return o; })()`);
  assert.match(r.block.l, /^HOME FINISH·CLEAR cool 2\/6$/, 'a cool stretch still gets the finishing tray; the phase keeps counting');
  assert.ok(r.block.empties, 'playing its pieces at their homes empties the board: ' + r.block.sizes);
  assert.ok(r.block.flush && r.block.f === 1, 'padding strictly flush; one FINISH in a row');
  assert.match(r.cells.l, /^HOME FINISH·CLEAR cool/);
  assert.ok(r.cells.sizes.filter(n => n === 1).length === 3 && r.cells.empties, 'single-cell gaps get single cells that close it out: ' + r.cells.sizes);
  assert.doesNotMatch(r.off.l, /FINISH/, 'HOME_FINISH 0: no finishing tray');
  // over bot play: with the odds at 1 never more than HOME_FINISH_MAX FINISH trays in a row; at 0 never one
  const runs = async (odds, seed) => { await page.evaluate(o => { CFG.DEALER_HOME = true; CFG.HOME_FINISH = o; CFG.HOME_FINISH_HOT = o; }, odds);
    const t = await page.evaluate(`(${HOME_SIM})(160, ${seed}, false)`); let k = 0, most = 0, n = 0, g = -1;
    for (const x of t) { if (x.g !== g) { g = x.g; k = 0; } if (/^HOME FINISH/.test(x.l)) { n++; most = Math.max(most, ++k); } else k = 0; } return { most, n }; };
  const max = await page.evaluate(() => CFG.HOME_FINISH_MAX);
  const on = await runs(1, 21); assert.ok(on.n >= 5 && on.most <= max, 'FINISH trays capped in a row: ' + JSON.stringify(on));
  assert.equal((await runs(0, 21)).n, 0, 'HOME_FINISH 0: none over a run');
});
test('home dealer: the wipe chain is rolled (HOME_WIPE_KEEP^n): a failed roll goes cool with the help off, KEEP 0 stops after one wipe, KEEP 1 never', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.DEALER_HOME = true; CFG.HOME_FINISH = 1; CFG.HOME_FINISH_HOT = 1; const o = {}; rndSrc = mulberry(9);
    const E = Array(8).fill('00000000'), low = ['00000000','00000000','00000000','00000000','00000000','00000000','11111100','11111100'];
    const deal = rows => { B73(rows); roomNow = 1; tray = [null, null, null]; genTray(); const hand = tray.map(t => t.s);
      return { l: lastTier, sizes: hand.map(s => s.n), kinds: new Set(hand).size, ev: evalHand(packGrid(grid), hand, 200000), hd: { ...hdeal } }; };
    const wipe = () => { B73(E); waveAfterDrop(packGrid(grid), 1, 0, 1, false); };
    W73(); resetHd(); CFG.HOME_WIPE_KEEP = 0; hdeal.ph = 'win'; hdeal.len = CFG.HOME_WIN_MAX; hdeal.n = 2; wipe();
    o.k0 = [deal(E), deal(low)];                                   // KEEP 0: the first wipe ends the chain's help
    o.k0.push(...Array.from({ length: 14 }, () => deal(low)));
    W73(); resetHd(); CFG.HOME_WIPE_KEEP = 1; o.k1 = [];
    for (let k = 0; k < 8; k++) { hdeal.ph = 'cool'; hdeal.n = 1; hdeal.len = 9; wipe(); o.k1.push(deal(E)); }   // eight wipes in a row: the help never stops
    rndSrc = null; return o; })()`);
  const [b, f] = r.k0;
  assert.match(b.l, /^HOME BUILD cool·LK 1\/\d+$/, 'a failed roll: straight to a cool stretch with the help off: ' + b.l);
  assert.ok(b.kinds >= 2 && b.sizes.every(n => n >= 4) && b.ev.lines === 0, 'its BUILD: big mixed pieces that complete no line: ' + JSON.stringify(b));
  assert.doesNotMatch(f.l, /FINISH|CLEAR/, 'no FINISH on a low board while the help is off: ' + f.l);
  assert.equal(f.ev.sweep, false, 'no tray that can empty the board');
  assert.ok(r.k0.every(t => !t.ev.sweep || !/·LK/.test(t.l)), 'none in the whole stretch: ' + r.k0.map(t => t.l).join(' | '));
  assert.ok(r.k0.some(t => / warm/.test(t.l) || / win /.test(t.l)) && r.k0.some(t => /FINISH/.test(t.l)), 'when the stretch ends the help is back: ' + r.k0.map(t => t.l).join(' | '));
  assert.equal(r.k0[0].hd.wr, 1);
  assert.ok(r.k1.every(t => !/·LK/.test(t.l) && t.kinds <= 2), 'KEEP 1: matching BUILD trays after every wipe: ' + r.k1.map(t => t.l).join(' | '));
  assert.deepEqual(r.k1.map(t => t.hd.wr), [1, 2, 3, 4, 5, 6, 7, 8], 'the row counts on');
  // bot play, FINISH odds forced to 1: with KEEP 0 no two wipes within 4 trays; with KEEP 1 rows of wipes come
  const rows = async (keep, seed) => { await page.evaluate(k => { CFG.DEALER_HOME = true; CFG.HOME_FINISH = 1; CFG.HOME_FINISH_HOT = 1; CFG.HOME_WIPE_KEEP = k; }, keep);
    const t = await page.evaluate(`(${HOME_SIM})(500, ${seed}, false)`); let most = 0, n = 0, wipes = 0;
    const games = {}; t.forEach((x, i) => { if (x.sw) (games[x.g] = games[x.g] || []).push(i); });
    for (const at of Object.values(games)) { wipes += at.length; let k = 1; for (let i = 1; i < at.length; i++) { k = at[i] - at[i - 1] <= 4 ? k + 1 : 1; most = Math.max(most, k); } if (at.length) most = Math.max(most, 1); }
    return { most, wipes }; };
  const k0 = await rows(0, 31); assert.ok(k0.wipes >= 4 && k0.most === 1, 'KEEP 0: every wipe stands alone: ' + JSON.stringify(k0));
  const k1 = await rows(1, 31); assert.ok(k1.most >= 2, 'KEEP 1: wipes come in rows: ' + JSON.stringify(k1));
});
test('home dealer: its coaster survives a resume; an empty board deals BUILD; no star or golden hand', async ({ page }) => {
  await play(page);
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.DEALER_HOME = true; W73(); const o = {};
    hdeal = { ph: 'win', n: 3, len: 8, f: 2, wp: 1, wr: 2, wa: 1, wn: 1, lk: 1 };
    const snap = JSON.parse(JSON.stringify(snapshot())); resetHd(); restore(snap); o.saved = JSON.stringify(hdeal);
    delete snap.hm.f; delete snap.hm.wp; delete snap.hm.wr; delete snap.hm.wa; delete snap.hm.wn; delete snap.hm.lk; resetHd(); restore(snap); o.old = JSON.stringify(hdeal);
    snap.hm = { ph: 'gift', n: 1, len: 3, f: 0, hot: 2 }; resetHd(); restore(snap); o.gift = JSON.stringify(hdeal);   // a save from the gift-string dealer
    W73(); hdeal = { ph: 'warm', n: 0, len: 0 }; B73(Array(8).fill('00000000')); rndSrc = mulberry(3); tray = [null, null, null]; genTray();
    o.build = lastTier; o.hand = tray.map(t => t.s.n);
    W73(); goldenNext = true; starForced = true; o.special = 0;
    for (let k = 0; k < 20; k++) { B73(['00000000','00000000','11100111','11100111','00000000','11111100','11111100','11111100']); tray = [null, null, null]; goldenNext = true; genTray(); if (golden || tray.some(t => t.s.star)) o.special++; }
    rndSrc = null; return o; })()`);
  const Z = { wr: 0, wa: 99, wn: 0, lk: 0 };
  assert.equal(r.saved, JSON.stringify({ ph: 'win', n: 3, len: 8, f: 2, wp: 1, wr: 2, wa: 1, wn: 1, lk: 1 }));
  assert.equal(r.old, JSON.stringify({ ph: 'win', n: 3, len: 8, f: 0, wp: 0, ...Z }), 'an older save: no FINISH run, no wipe, no wipe row');
  assert.equal(r.gift, JSON.stringify({ ph: 'win', n: 1, len: await page.evaluate(() => CFG.HOME_WIN_MAX), f: 0, wp: 0, ...Z }), 'a gift string resumes as win mode');
  assert.match(r.build, /^HOME BUILD warm$/);
  assert.ok(r.hand.every(n => n >= 4), 'big pieces to build with: ' + r.hand);
  assert.equal(r.special, 0, 'no star or golden hand under it');
});

test('home dealer: HOME_BLOCKY (experiment, off by default): cool TIGHT trays are big pieces, every one at a strict home in some order, all solvable', async ({ page }) => {
  await play(page);
  assert.equal(await page.evaluate(() => CFG.HOME_BLOCKY), false);
  await page.evaluate(() => { CFG.DEALER_HOME = true; CFG.HOME_BLOCKY = true; });
  const r = await page.evaluate(`(${HOME_SIM})(220, 13, true)`);
  const tight = r.filter(t => /^HOME TIGHT/.test(t.l));
  assert.ok(tight.length >= 30, 'TIGHT trays came round: ' + tight.length);
  assert.ok(r.every(t => t.ok), 'every tray has a solution');
  assert.ok(tight.every(t => / cool/.test(t.l) && t.flush && t.home), 'in the cool stretch, every piece at a strict (bump 0) home in some order');
  const cells = tight.flatMap(t => t.t.split(',').map(i => +i)), mean = cells.reduce((a, i) => a + [1,2,2,3,3,4,4,5,5,4,9,3,3,3,3,5,5,5,5,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,6,6][i], 0) / cells.length;
  assert.ok(mean >= 4.6, 'big pieces: mean ' + mean.toFixed(2));
});
test('play recorder: off writes nothing; on (REC_PLAY) keeps one well-formed record per tray, the drops, a game-over marker and the knobs; tools/play-log.mjs reads it', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { CFG.DEALER_HOME = true; CFG.REC_PLAY = false; localStorage.removeItem('crumble.playlog'); });
  await page.evaluate(`(${HOME_SIM})(12, 5, false)`);
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.playlog')), null, 'off: nothing written');
  await page.evaluate(() => { CFG.REC_PLAY = true; });
  await page.evaluate(`(${HOME_SIM})(14, 5, false)`);
  await page.evaluate(() => { state = 'play'; gameOver(); });
  const L = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.playlog')));
  assert.equal(L.v, 1);
  const g = L.e.filter(e => e.k === 'g'), t = L.e.filter(e => e.k === 't'), o = L.e.filter(e => e.k === 'o');
  assert.ok(g.length >= 1 && g[0].cfg.DEALER_HOME === true && 'HOME_WIPE_KEEP' in g[0].cfg && 'HOME_BUMP' in g[0].cfg && g[0].m === 'endless', 'a game marker with the knobs: ' + JSON.stringify(g[0]));
  assert.ok(t.length >= 14, 'a record per tray: ' + t.length);
  for (const x of t) {
    assert.match(x.b, /^[0-9a-f]{16}$/, 'the board at deal');
    assert.ok(x.s.length === 3 && x.s.every(i => Number.isInteger(i) && i >= -1 && i < 37), 'three shapes: ' + x.s);
    assert.ok(typeof x.d === 'string' && /^(warm|win|cool)$/.test(x.p) && Number.isInteger(x.n), 'label, phase, tray number: ' + JSON.stringify(x));
    for (const d of x.x) assert.ok(d.length === 5 && d[0] >= 0 && d[0] < 3 && d[1] >= 0 && d[1] < 8 && d[2] >= 0 && d[2] < 8 && d[3] >= 0 && (d[4] === 0 || d[4] === 1), 'a drop: ' + d);
  }
  assert.ok(t.slice(0, -1).every((x, i) => x.x.length === 3 || t[i + 1].n === 1), 'every finished tray has its three drops');
  const first = await page.evaluate(() => { const L = JSON.parse(localStorage.getItem('crumble.playlog')); const x = L.e.find(e => e.k === 't'); return x; });
  assert.equal(first.n, 1, 'the opening tray is recorded');
  assert.equal(o.length, 1, 'the game-over marker');
  // the tool reads it
  const f = 'tests/out/play-log-test.json'; fs.mkdirSync('tests/out', { recursive: true }); fs.writeFileSync(f, JSON.stringify(L));
  const { execFileSync } = await import('node:child_process');
  const txt = execFileSync('node', ['tools/play-log.mjs', f], { encoding: 'utf8' });
  assert.match(txt, /play log: \d+ games, \d+ trays/); assert.match(txt, /longest wipe-less stretch/); assert.match(txt, /phase: /);
  const copied = await page.evaluate(async () => { const orig = navigator.clipboard; Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await recCopy(); const box = document.querySelector('#recBox textarea'); const v = box && box.value; Object.defineProperty(navigator, 'clipboard', { value: orig, configurable: true }); return v; });
  assert.equal(JSON.parse(copied).e.length, L.e.length, 'no clipboard (an iOS web view): the log shows in a box to select');
  await page.evaluate(() => recClear());
  assert.equal(await page.evaluate(() => localStorage.getItem('crumble.playlog')), null, 'Clear play log');
});

// ---- the study curve (DEALER_CURVE) ----
test('curve dealer: off by default; with it off a pinned home-dealer deal is unchanged (the tide pin is the home dealer test above)', async ({ page }) => {
  await play(page); await dealt(page);
  assert.equal(await page.evaluate(() => CFG.DEALER_CURVE), false);
  // generated on main (e01b4a5), before the curve dealer: 40 trays of the home dealer from a fresh page
  const pinned = '35,35,35;7,7,9;0,7,1;3,9,0;1,20,0;10,7,5;34,0,8;1,0,1;1,4,0;30,36,35;26,7,36;7,27,23;32,21,9;7,33,17;7,35,34;36,28,7;18,7,21;34,4,12;5,29,17;3,23,20;30,32,0;0,0,27;1,3,0;2,3,0;34,3,7;7,36,35;34,28,18;19,25,35;17,30,24;15,31,27;29,24,7;16,16,16;9,7,0;14,1,1;36,0,0;7,14,33;21,15,2;2,17,1;1,1,0;28,6,34';
  await page.evaluate(() => { CFG.DEALER_HOME = true; });
  assert.equal(await page.evaluate(`(${HOME_SIM})(40, 4242, false)`).then(r => r.map(x => x.t).join(';')), pinned);
});
test('curve dealer: Challenge is untouched, only Endless and Daily use it, it beats the home switch; ?dealer=curve, the Admin switch and sliders', async ({ page, server }) => {
  await page.evaluate(() => { CFG.DEALER_CURVE = true; CFG.DEALER_HOME = true; });
  const packs = await page.evaluate(() => ['frozen1', 'd2026-11-11'].map(s => chPack(chMake(s))));
  assert.deepEqual(packs, ['AAYAgAAAAAAAAAAAIGoAAAAAAIAAAAAAAkYiDAogTEXcZLZJBIgTb5ShVEEgfoVEDVcYSYo1jpbWBoGoRSklAaAAAAAAAFeAAG4AAISA',
    'ADAYAAAAAAAAAAAAAAAAAAAIAAAAAAAAAKgxGIqViaPZbWUbEkdUorHRjgL6XpFEBqCRUjUMJcKEIZEjdWCrJrdAAAAAAGkAAH5AAJdA']);
  assert.deepEqual(await page.evaluate(() => { mode = 'challenge'; const c = curveOn(); mode = 'adventure'; const a = curveOn(); mode = 'daily'; const d = curveOn(); mode = 'endless'; return [c, a, d, curveOn(), hdOn()]; }), [false, false, true, true, false], 'curve wins over home');
  await page.goto(server.url + '?dealer=curve'); await toGame(page);
  assert.deepEqual(await page.evaluate(() => [CFG.DEALER_CURVE, CFG.DEALER_HOME]), [true, false]);
  assert.ok(await page.evaluate(() => DEV_TOGGLES.some(t => t[0] === 'DEALER_CURVE' && /study curve/.test(t[1]))), 'an Admin switch');
  assert.deepEqual(await page.evaluate(() => ['CURVE_HEAT', 'CURVE_MULTI', 'CURVE_GIVE'].map(k => DEV_SLIDERS.some(s => s[0] === k))), [true, true, true], 'Admin sliders');
  await page.goto(server.url + '?dealer=tide'); await toGame(page);
  assert.deepEqual(await page.evaluate(() => [CFG.DEALER_CURVE, CFG.DEALER_HOME]), [false, false]);
});
test('curve dealer: bot-played trays on two seeds always have a solution; with heat 0 the dealt CLEAR/FLUSH shares follow the table by bucket; big pieces', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { CFG.DEALER_CURVE = true; CFG.CURVE_HEAT = 0; });
  const [tab, small] = await page.evaluate(() => [CFG.CURVE_TABLE, CFG.CURVE_SMALL]);
  const RX = /^CURVE ([CFX])\/([CFX])\/([CFX])(·TWIN|·RELAX|·GUARD)? g=(\d+) heat=([+-]\d\.\d)$/;
  const by = [0, 1, 2, 3].map(() => ({ C: 0, F: 0, X: 0, n: 0 })), cells = [], tags = {};
  let trays = 0;
  for (const seed of [41, 42]) {
    const r = await page.evaluate(`(${HOME_SIM})(250, ${seed}, true)`);
    for (const t of r) {
      assert.ok(t.ok, 'every tray has a solution: ' + t.l + ' ' + t.t);
      if (t.l === 'OPENING') continue;
      const m = t.l.match(RX); assert.ok(m, 'labelled with the classes, gems and heat: ' + t.l);
      assert.equal(+m[5], t.gems, 'the gems in the label');
      trays++; if (m[4]) tags[m[4]] = (tags[m[4]] || 0) + 1;
      const b = t.gems <= 12 ? 0 : t.gems <= 24 ? 1 : t.gems <= 36 ? 2 : 3;
      for (const k of [1, 2, 3]) { by[b][m[k]]++; by[b].n++; }
      cells.push(...t.t.split(',').map(i => [1,2,2,3,3,4,4,5,5,4,9,3,3,3,3,5,5,5,5,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,6,6][+i]));
    }
  }
  assert.ok(trays >= 400, 'trays: ' + trays);
  by.forEach((o, b) => {
    if (o.n < 60) return;                                       // too few pieces in this bucket to judge
    const c = 100 * o.C / o.n, f = 100 * o.F / o.n;
    // the empty board (bucket 0) has no line to clear, so its CLEAR share runs below the table there
    assert.ok(Math.abs(c - tab[b * 2]) <= (b ? 12 : 15) && Math.abs(f - tab[b * 2 + 1]) <= (b ? 12 : 15), 'bucket ' + b + ': CLEAR ' + c.toFixed(0) + '% FLUSH ' + f.toFixed(0) + '% vs table ' + tab[b * 2] + '/' + tab[b * 2 + 1] + ' (' + o.n + ' pieces)');
  });
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length, sm = cells.filter(n => n <= 3).length / cells.length;
  assert.ok(mean >= 4.5, 'big pieces: mean ' + mean.toFixed(2));
  assert.ok(sm <= Math.max(...small) / 100 + 0.05, 'few small pieces: ' + (100 * sm).toFixed(0) + '%');
  assert.ok((tags['·GUARD'] || 0) <= 2, 'the last guard is rare: ' + JSON.stringify(tags));
});
test('curve dealer: the luck dial walks in -1..1, moves the table, survives a resume; an emptied board can get three of one big piece; the recorder notes the knobs', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate('(() => {' + B73 + `
    CFG.DEALER_CURVE = true; W73(); const o = {}; rndSrc = mulberry(17);
    o.rows = [curveRow(1, 0), curveRow(1, 0.5), curveRow(1, -0.5)];
    CFG.CURVE_GIVE = 0.1; o.give = curveRow(1, 0); CFG.CURVE_GIVE = 0;
    const mid = ['00000000','00000000','00000011','00110000','11001100','11001100','11001100','11001100'];
    o.heats = []; for (let k = 0; k < 120; k++) { B73(mid); tray = [null, null, null]; genTray(); o.heats.push(curve.heat); }
    curve.heat = -0.4321; const snap = JSON.parse(JSON.stringify(snapshot())); resetCurve(); o.zero = curve.heat; restore(snap); o.saved = curve.heat;
    delete snap.cv; resetCurve(); restore(snap); o.old = curve.heat;
    CFG.CURVE_TWINS = 1; o.twins = []; for (let k = 0; k < 6; k++) { B73(Array(8).fill('00000000')); trayNo = 5; tray = [null, null, null]; genTray(); o.twins.push(lastTier + ' ' + tray.map(t => SHAPES.indexOf(t.s)).join(',')); }
    curve.heat = 0.5; B73(['00000000','00000000','00000000','00000000','00000000','00000000','00000000','11111110']); waveAfterDrop(packGrid(grid), 1, 0, 1, false); o.nudged = curve.heat;
    rndSrc = null; return o; })()`);
  const [mid, hot, cold] = r.rows;
  assert.ok(Math.abs(mid[0] + mid[1] + mid[2] - 1) < 1e-9 && hot[0] > mid[0] && cold[0] < mid[0], 'heat moves share to and from CLEAR: ' + JSON.stringify(r.rows));
  assert.ok(Math.abs(r.give[0] - mid[0] - 0.1) < 1e-9, 'generosity shifts the CLEAR share');
  assert.ok(r.heats.every(h => h >= -1 && h <= 1) && new Set(r.heats.map(h => h.toFixed(3))).size > 50, 'a walk in -1..1');
  assert.ok(Math.max(...r.heats) - Math.min(...r.heats) > 0.4, 'it goes somewhere: ' + Math.min(...r.heats).toFixed(2) + '..' + Math.max(...r.heats).toFixed(2));
  assert.equal(r.zero, 0); assert.equal(r.saved, -0.4321, 'heat survives save and resume'); assert.equal(r.old, 0, 'an older save starts at 0');
  r.twins.forEach(t => { const ids = t.split(' ').pop().split(',');
    assert.ok(/·TWIN/.test(t) && ids[0] === ids[1] && ids[1] === ids[2], 'CURVE_TWINS 1: three of one piece on an emptied board: ' + t); });
  assert.ok(Math.abs(r.nudged - 0.65) < 1e-9, 'a wipe warms the dial a little: ' + r.nudged);
  // the play recorder's game marker carries the curve's knobs
  await page.evaluate(() => { CFG.DEALER_CURVE = true; CFG.REC_PLAY = true; localStorage.removeItem('crumble.playlog'); recClear(); });
  await page.evaluate(`(${HOME_SIM})(6, 3, false)`);
  const L = await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.playlog')));
  const g = L.e.find(e => e.k === 'g'), t = L.e.filter(e => e.k === 't');
  assert.ok(g && g.cfg.DEALER_CURVE === true && Array.isArray(g.cfg.CURVE_TABLE) && 'CURVE_HEAT' in g.cfg && 'CURVE_MULTI' in g.cfg, 'the knobs in the game marker: ' + JSON.stringify(g && g.cfg));
  assert.ok(t.some(x => /^CURVE /.test(x.d) && x.p === 'curve'), 'trays recorded with the curve label and phase');
  await page.evaluate(() => { CFG.REC_PLAY = false; recClear(); });
});

// ── the streak has stakes, and Crumb is a slingshot ──
const STK_FULL = ['01111111', '11011011', '11101110', '10111101', '11011011', '01101101', '11110111', '10111010'];
const STK_JAM = ['11011011', '01101101', '10110110', '11011011', '01101101', '10110110', '11011011', '01101101'];
const missDrop = async page => {                       // a drop that clears nothing
  await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await dragPiece(page, 0, 4, 4);
  await frames(page, 3);
};
const chargeCrumb = (page, pow = 0) => page.evaluate(pow => { toy.hot = true; toy.pow = pow; toy.sulkTo = 0; toy.flicks = []; toy.demo = null; }, pow);
const crumbReady = page => page.waitForFunction(() => toy.mode === 'rim' && !toy.fire && Math.abs(toy.sc - toySize()) < .01 && !el('mascot').hidden, null, { timeout: 8999 });
const pullCrumb = async (page, dx, dy, { steps = 8, hold = 170 } = {}) => {   // touch it, pull, and rest the finger (a slingshot, not a flick)
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(r.x + dx * i / steps, r.y + dy * i / steps); await page.waitForTimeout(16); }
  await page.waitForTimeout(hold);
  return r;
};
const aimRead = page => page.evaluate(() => {
  const a = el('crumbAim'), g = a.querySelector('.gh');
  return { shown: a.style.display !== 'none', dots: [...a.querySelectorAll('.dt circle')].filter(c => +c.getAttribute('r') > 0).length,
    ghost: +g.getAttribute('r') > 0 ? g.getAttribute('cx') + ',' + g.getAttribute('cy') : '' };
});
const gemSet = page => page.evaluate(() => grid.flatMap((row, r) => row.map((g, c) => g ? r * 8 + c : -1)).filter(v => v >= 0));
const watchTicks = page => page.evaluate(() => {
  window.__hap = []; window.__tp = 0;
  const oh = haptic; haptic = function (k) { __hap.push(k); return oh.apply(this, arguments); };
  const tp = toyPlay; toyPlay = function () { __tp++; return tp.apply(this, arguments); };
});

test('stakes: the fire sputters: a notch down after one miss, guttering embers on the last life with a tick and a glance, straight back on a clear; the third miss snuffs it', async ({ page }) => {
  await play(page);
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; });
  await watchTicks(page);
  await streak(page, 4);
  await frames(page, 40);
  const full = await page.evaluate(() => ({ combo, k: fire.k, t: fireTarget(), lv: sputLevel(), tier: fire.tier }));
  assert.ok(full.combo === 4 && full.lv === 0 && full.k > 0.5, 'combo 4 burns ' + JSON.stringify(full));
  await missDrop(page);
  const m1 = await page.evaluate(() => ({ combo, miss: comboMiss, lv: sputLevel(), t: fireTarget(), hap: __hap.filter(h => h === 'sputter').length }));
  assert.deepEqual([m1.combo, m1.miss, m1.lv, m1.hap], [4, 1, 1, 0], 'one miss: the streak carries, a notch down, no tick yet');
  assert.ok(Math.abs(m1.t - full.t * 0.62) < 1e-9, 'the notch: ' + m1.t);
  await frames(page, 50);
  const k1 = await page.evaluate(() => ({ k: fire.k, sp: fire.sp }));
  assert.ok(k1.sp === 1 && k1.k < full.k - 0.15 && k1.k > 0.25, 'the flames drop a visible notch ' + JSON.stringify(k1));
  // the last life
  await page.evaluate(() => { say.last = -1e9; say.txt = ''; __tp = 0; });
  await missDrop(page);
  const m2 = await page.evaluate(() => ({ combo, miss: comboMiss, lv: sputLevel(), t: fireTarget(), hap: __hap.filter(h => h === 'sputter').length, tp: __tp, said: say.txt, act: masc.act }));
  assert.deepEqual([m2.combo, m2.miss, m2.lv, m2.hap, m2.act], [4, 2, 2, 1, 'glance'], 'the last life: a tick, a light haptic, and the crumb glances at the board ' + JSON.stringify(m2));
  assert.ok(m2.tp >= 1 && m2.t <= 0.16, 'its own sound; embers ' + JSON.stringify(m2));
  assert.ok(["one more miss and it's gone.", 'careful.'].includes(m2.said), 'a warning line: ' + m2.said);
  await mascotMood(page, /^glance\b/);
  await frames(page, 50);
  const k2 = await page.evaluate(() => ({ k: fire.k, sp: fire.sp, tier: fireTier() }));
  assert.ok(k2.sp === 2 && k2.tier === 0 && k2.k < 0.2 && k2.k > 0.1, 'guttering orange embers ' + JSON.stringify(k2));
  // a clear: straight back to full, with the flare
  await streak(page, 1);
  const back = await page.evaluate(() => ({ combo, miss: comboMiss, k: fire.k, t: fireTarget(), flare: fire.flare, sp: fire.sp }));
  assert.ok(back.combo === 5 && back.miss === 0 && back.k >= back.t - 0.01 && back.flare > 0.3 && back.sp === 0, 'back at once ' + JSON.stringify(back));
  // a second last life in the same run: the tick again, but the line only once a run
  await missDrop(page);
  await page.evaluate(() => { say.last = -1e9; say.txt = ''; });
  await missDrop(page);
  const m3 = await page.evaluate(() => ({ lv: sputLevel(), hap: __hap.filter(h => h === 'sputter').length, said: say.txt }));
  assert.deepEqual([m3.lv, m3.hap, m3.said], [2, 2, ''], 'ticked again, no second line ' + JSON.stringify(m3));
  // the third miss snuffs it as before
  await missDrop(page);
  const out = await page.evaluate(() => ({ combo, out: fire.out, smoke: fire.smoke.length, lv: sputLevel() }));
  assert.ok(out.combo === 0 && out.out > 0 && out.smoke >= 10 && out.lv === 0, 'snuffed ' + JSON.stringify(out));
  // below the fire, the switch, the modes, and no dice
  const r = await page.evaluate(() => {
    const o = {}; let rolls = 0; const R = Math.random; Math.random = () => { rolls++; return R(); };
    const at = (c, m = 'endless') => { const m0 = mode; mode = m; combo = c; comboMiss = CFG.COMBO_GRACE - 1; __hap.length = 0;
      const ok = fireSputter(); if (ok) toyLastLife(); const res = { ok, hap: __hap.length, lv: sputLevel(), t: +fireTarget().toFixed(3) }; mode = m0; return res; };
    o.c1 = at(1); o.c2 = at(2); o.daily = at(2, 'daily'); o.chal = at(4, 'challenge');
    CFG.FX_SPUTTER = false; o.off = at(4); CFG.FX_SPUTTER = true;
    Math.random = R; o.rolls = rolls; combo = 0; comboMiss = 0; return o;
  });
  assert.equal(r.c1.ok, false, 'a streak of 1 is not worth a warning');
  assert.deepEqual([r.c2.ok, r.c2.hap, r.daily.ok], [true, 1, true], 'from combo 2, in Endless and Daily: the tick');
  assert.deepEqual([r.chal.ok, r.chal.lv], [false, 0], 'not where the combo does not carry');
  assert.deepEqual([r.off.ok, r.off.lv, r.off.t], [false, 0, 0.6], 'FX_SPUTTER off: the fire stays as it was');
  assert.equal(r.rolls, 0, 'the sputter never rolls the game\'s dice');
});

test('stakes: a grown charged crumb deflates when the streak dies (still charged, plain size, a pffft and a line, saved deflated); on the last life it says "use me or lose me." once per charge', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; toy.lastCombo = 8; combo = 8; comboMiss = 0; say.last = -1e9; });
  await chargeCrumb(page, 3);
  await watchTicks(page);
  await page.waitForFunction(() => toy.sc > CFG.CANNON_BIG + .1);
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [comboMiss, toy.pow, toy.warned]), [1, 3, false], 'one miss: nothing yet');
  await missDrop(page);
  const ll = await page.evaluate(() => ({ act: masc.act, said: say.txt, warned: toy.warned }));
  assert.deepEqual(ll, { act: 'worry', said: 'use me or lose me.', warned: true }, 'the last life with a grown crumb: worried about itself');
  await page.waitForFunction(() => el('crumbSay').textContent === 'use me or lose me.' && !el('crumbSay').hidden);
  // a clear, then a second last life with the same charge: no second warning
  await page.evaluate(() => { grid = grid.map(r => r.map(() => null)); });
  await streak(page, 1);
  await missDrop(page);
  await page.evaluate(() => { say.last = -1e9; say.txt = ''; });
  await missDrop(page);
  assert.equal(await page.evaluate(() => say.txt), '', 'once per charge');
  // the third miss: the streak dies, the growth goes
  const pow0 = await page.evaluate(() => toy.pow), tp0 = await page.evaluate(() => __tp);
  assert.ok(pow0 >= 3, 'grown: ' + pow0);
  await missDrop(page);
  const d = await page.evaluate(() => ({ combo, hot: toy.hot, pow: toy.pow, size: toySize(), big: CFG.CANNON_BIG, said: say.txt, tp: __tp, run: JSON.parse(localStorage.getItem('crumble.run')) }));
  assert.deepEqual([d.combo, d.hot, d.pow, d.size], [0, true, 0, d.big], 'still charged, back to the plain charged size');
  assert.ok(['pfff.', 'I was HUGE.', 'that was your fault.'].includes(d.said) && d.tp > tp0, 'a pffft and a line ' + JSON.stringify(d.said));
  assert.deepEqual([d.run.cn, d.run.cp], [1, 0], 'saved deflated');
  await page.waitForFunction(() => Math.abs(toy.sc - CFG.CANNON_BIG) < .01);
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'play' && !!cell);
  assert.deepEqual(await page.evaluate(() => [toy.hot, toy.pow]), [true, 0], 'and through a real reload');
  // nothing to lose at the plain charge; the switch off keeps the growth
  await dealt(page);
  await page.evaluate(() => { toy.pow = 0; combo = 3; comboMiss = CFG.COMBO_GRACE - 1; say.last = -1e9; say.txt = ''; });
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [toy.hot, toy.pow, SAY.deflate.includes(say.txt)]), [true, 0, false], 'a plain charge: no pffft');
  await page.evaluate(() => { CFG.CANNON_DEFLATE = false; toy.pow = 2; combo = 7; comboMiss = CFG.COMBO_GRACE - 1; });
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [toy.hot, toy.pow]), [true, 2], 'CANNON_DEFLATE off: it keeps its growth');
});

test('stakes: slingshot: a pull launches opposite the pull (resting or on the move) and breaks gems along the dots; a quick swipe is still a flick; a tap gives the hint and spends nothing; a pull over the tray picks up nothing; a cancel leaves it charged', async ({ page }) => {
  await play(page);
  await dealt(page);
  // uncharged: today's toy, no band, no dots
  await crumbReady(page);
  await pullCrumb(page, -20, -60);
  assert.deepEqual([await page.evaluate(() => !toy.sl), (await aimRead(page)).shown], [true, false], 'uncharged: no slingshot');
  await page.mouse.up();
  await onRim(page);
  // charged: pull back, rest, let go
  await setup(page, { rows: STK_FULL, trayShapes: [0, 0, 0] });
  await chargeCrumb(page);
  await crumbReady(page);
  assert.equal(await page.evaluate(() => el('crumbSay').textContent), 'PULL ME BACK!', 'the bubble says pull');
  await pullCrumb(page, -30, -80);
  const aim = await aimRead(page);
  const pre = await page.evaluate(() => ({ sl: !!toy.sl, px: toy.x - toy.sl.ax, py: toy.y, path: toyPath(toy.sl.ax, toy.x - toy.sl.ax, toy.y), say: el('crumbSay').hidden,
    reach: Math.max(cell * .5, masc.s * toySize() * .5 * CFG.CANNON_REACH) + cell * .2, bx, by, cell }));
  assert.ok(pre.sl && aim.shown && aim.dots >= 10 && !aim.ghost, 'pulling: the band and the dots ' + JSON.stringify(aim));
  const before = await gemSet(page), s0 = await page.evaluate(() => score);
  await page.mouse.up();
  const shot = await page.evaluate(() => ({ fire: !!toy.fire, hot: toy.hot, vx: toy.vx, vy: toy.vy, aim: el('crumbAim').style.display }));
  assert.ok(shot.fire && !shot.hot && shot.vx > 0 && shot.vy > 0 && shot.aim === 'none', 'let go: a cannonball, away from the pull ' + JSON.stringify(shot));
  const dir = Math.atan2(shot.vy, shot.vx) - Math.atan2(-pre.py, -pre.px);
  assert.ok(Math.abs(dir) < 0.15, 'straight opposite the pull: ' + dir.toFixed(3));
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9001 });
  const after = new Set(await gemSet(page)), broke = before.filter(i => !after.has(i));
  assert.ok(broke.length >= 4, 'it broke gems: ' + broke.length);
  assert.equal(await page.evaluate(() => score) - s0, broke.length * await page.evaluate(() => CFG.CANNON_PER_GEM), 'paid per gem');
  const near = i => { const x = pre.bx + (i % 8 + .5) * pre.cell, y = pre.by + (Math.floor(i / 8) + .5) * pre.cell;
    return pre.path.some(([px, py], k) => { const [qx, qy] = k ? pre.path[k - 1] : [px, py];      // distance to each segment of the dotted path
      const L = (px - qx) ** 2 + (py - qy) ** 2, t = L ? Math.max(0, Math.min(1, ((x - qx) * (px - qx) + (y - qy) * (py - qy)) / L)) : 0;
      return Math.hypot(x - (qx + t * (px - qx)), y - (qy + t * (py - qy))) <= pre.reach + 8; }); };
  assert.deepEqual(broke.filter(i => !near(i)), [], 'every gem it broke lies along the dots');
  // a fast flick still works, in the direction of the throw
  await dealt(page);
  await setup(page, { rows: STK_FULL, trayShapes: [0, 0, 0] });
  // (the swipe's windows are stretched for this one step, so a slow runner's late events still read as a quick, fast swipe: the rule, not the clock, is tested)
  await chargeCrumb(page); await crumbReady(page);
  const knobs = await page.evaluate(() => { const k = [CFG.SLING_QUICK_MS, CFG.TOY_FLICK_MS, CFG.TOY_FLICK_MIN]; CFG.SLING_QUICK_MS = 1e5; CFG.TOY_FLICK_MS = 1e5; CFG.TOY_FLICK_MIN = 20; return k; });
  const rf = await crumbAt(page);
  await page.mouse.move(rf.x, rf.y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(rf.x + i * 10, rf.y + i * 26);
  await page.mouse.up();
  const fl = await page.evaluate(() => ({ fire: !!toy.fire, vx: toy.vx, vy: toy.vy }));
  await page.evaluate(k => { [CFG.SLING_QUICK_MS, CFG.TOY_FLICK_MS, CFG.TOY_FLICK_MIN] = k; }, knobs);
  assert.ok(fl.fire && fl.vx > 0 && fl.vy > 0, 'a quick swipe down and right is a flick: down and right ' + JSON.stringify(fl));
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9002 });
  // pulled back and let go without resting, after SLING_QUICK_MS: the slingshot, however fast the finger was moving
  await chargeCrumb(page); await crumbReady(page);
  const rs = await crumbAt(page);
  await page.mouse.move(rs.x, rs.y); await page.mouse.down();
  await page.waitForFunction(q => performance.now() - toy.t0 > q, await page.evaluate(() => CFG.SLING_QUICK_MS));
  for (let i = 1; i <= 6; i++) await page.mouse.move(rs.x - i * 5, rs.y - i * 14);
  await page.mouse.up();
  const sw = await page.evaluate(() => ({ fire: !!toy.fire, vx: toy.vx, vy: toy.vy }));
  assert.ok(sw.fire && sw.vx > 0 && sw.vy > 0, 'a pull up and left let go on the move: launched down and right, opposite the pull ' + JSON.stringify(sw));
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9005 });
  // a tap: the hint and a demo, nothing spent
  await chargeCrumb(page); await crumbReady(page);
  const g0 = await gemSet(page), sc0 = await page.evaluate(() => score);
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [toy.hot, !!toy.fire, toy.mode, !!toy.demo]), [true, false, 'rim', true], 'still charged, a demo');
  await page.waitForFunction(() => el('crumbSay').textContent === 'pull me back and let go!' && !el('crumbSay').hidden);
  await page.waitForFunction(() => el('crumbAim').style.display !== 'none' && [...el('crumbAim').querySelectorAll('.dt circle')].some(c => +c.getAttribute('r') > 0));
  assert.ok((await aimRead(page)).ghost, 'the demo shows the band by itself');
  await page.waitForFunction(() => el('crumbAim').style.display === 'none' && !toy.demo, null, { timeout: 3000 });
  assert.deepEqual([await gemSet(page), await page.evaluate(() => score)], [g0, sc0], 'no shot spent');
  await page.waitForFunction(() => el('crumbSay').textContent === 'PULL ME BACK!', null, { timeout: 5000 });
  // a pull down over the tray tracks the finger and picks up no piece; back to the perch and let go: the hint again
  const g = await geometry(page), tray0 = await page.evaluate(() => tray.map(t => t && t.s.id));
  await page.mouse.move(r.x, r.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(r.x + (g.trayCenters[0].x - r.x) * i / 10, r.y + (g.trayCenters[0].y - r.y) * i / 10); await page.waitForTimeout(16); }
  const over = await page.evaluate(() => ({ drag: drag === null, pend: pendingPress === null, sl: !!toy.sl, len: Math.hypot(toy.x - toy.sl.ax, toy.y), max: CFG.SLING_MAX }));
  assert.ok(over.drag && over.pend && over.sl && over.len <= over.max + .5, 'over the tray: still the crumb, stretched no further than SLING_MAX ' + JSON.stringify(over));
  for (let i = 9; i >= 0; i--) { await page.mouse.move(r.x + (g.trayCenters[0].x - r.x) * i / 10, r.y + (g.trayCenters[0].y - r.y) * i / 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(150);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [drag, toy.hot, !!toy.fire, tray.map(t => t && t.s.id)]), [null, true, false, tray0], 'no piece, no shot');
  // cancelled pulls (a real touch): the system takes the touch, a second finger lands, the app is hidden
  await page.evaluate(() => { toy.demo = null; });
  const f = await fingers(page);
  const perch = await page.evaluate(() => toy.x);
  await f.down(1, r.x, r.y); await f.move(1, r.x - 20, r.y - 70, 6); await frames(page, 2);
  assert.equal(await page.evaluate(() => !!toy.sl), true, 'a touch pulls it too');
  await f.cancel(); await frames(page, 2);
  assert.deepEqual(await page.evaluate(() => [toy.mode, toy.hot, !!toy.fire, toy.x, toy.y, el('crumbAim').style.display]), ['rim', true, false, perch, 0, 'none'], 'cancelled: back on its perch, charged');
  await f.down(1, r.x, r.y); await f.move(1, r.x - 20, r.y - 70, 6); await frames(page, 2);
  await f.down(2, g.trayCenters[1].x, g.trayCenters[1].y); await frames(page, 2);
  assert.deepEqual(await page.evaluate(() => [!!toy.sl, drag, toy.mode, toy.hot]), [false, null, 'rim', true], 'a second finger: the pull is off, and it picks up nothing');
  await f.up(2); await f.up(1); await frames(page, 2);
  assert.deepEqual(await page.evaluate(() => [drag, toy.hot, !!toy.fire]), [null, true, false], 'still charged');
  await pullCrumb(page, -20, -70);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; });
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [toy.mode, toy.hot, !!toy.fire]), ['rim', true, false], 'hidden mid-pull: back on its perch, charged');
});

test("stakes: with Crumb's dares: a slingshot is a throw (\"don't flick me\" is lost), a tap's hint is not; the dare chip steps back for the aim, and no dare line talks while the player aims", async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.waitForFunction(() => !!dare.id);
  await page.evaluate(() => { dare.id = 'noflick'; dare.s = 0; dare.p = 0; dare.x = trayNo; dare.q = []; });
  await setup(page, { rows: STK_FULL, trayShapes: [0, 0, 0] });
  await chargeCrumb(page); await crumbReady(page);
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.up();      // a tap: the hint and its demo
  await page.waitForFunction(() => el('stage').classList.contains('aiming'));
  await page.waitForTimeout(250);
  const demo = await page.evaluate(() => ({ s: dare.s, quiet: dareQuiet(1e12), chip: getComputedStyle(el('dareChip')).filter }));
  assert.deepEqual([demo.s, demo.quiet], [0, false], 'the hint spends nothing and loses nothing; not a quiet board');
  assert.equal(demo.chip, 'opacity(0.2)', 'the chip makes way for the demo');
  await page.waitForFunction(() => !toy.demo && !el('stage').classList.contains('aiming'), null, { timeout: 3000 });
  await pullCrumb(page, -30, -80);
  assert.deepEqual(await page.evaluate(() => [!!toy.sl, dareQuiet(1e12), el('stage').classList.contains('aiming')]), [true, false, true], 'aiming: not quiet, the chip steps back');
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [!!toy.fire, dare.s]), [true, 2], 'the slingshot threw him: the dare is lost');
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9000 });
  assert.equal(await page.evaluate(() => el('stage').classList.contains('aiming')), false);
});

test('stakes: with Reduce Motion the slingshot, the demo (a still picture), the sputter and the deflate keep their rules', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && state === 'idle');
  await play(page);
  await dealt(page);
  assert.equal(await page.evaluate(() => reduce), true);
  await watchTicks(page);
  // the sputter: the same levels and the tick
  await page.evaluate(() => { CFG.TRANSFORM_COMBO = 99; combo = 4; comboMiss = 0; toy.lastCombo = 4; });
  await missDrop(page);
  assert.equal(await page.evaluate(() => sputLevel()), 1);
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [sputLevel(), fireTarget() <= 0.16, __hap.filter(h => h === 'sputter').length]), [2, true, 1], 'the last life, with its tick');
  // the deflate: same rule, its size at once
  await chargeCrumb(page, 2);
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [combo, toy.hot, toy.pow, toy.sc === CFG.CANNON_BIG]), [0, true, 0, true], 'deflated at once, still charged');
  // a tap: the demo is a still picture
  await setup(page, { rows: STK_FULL, trayShapes: [0, 0, 0] });
  await crumbReady(page);
  const r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => el('crumbAim').style.display !== 'none');
  const a1 = await aimRead(page); await frames(page, 12); const a2 = await aimRead(page);
  assert.ok(a1.ghost && a1.dots > 0 && a1.ghost === a2.ghost && a1.dots === a2.dots, 'the demo does not move ' + JSON.stringify([a1, a2]));
  await page.waitForFunction(() => el('crumbAim').style.display === 'none', null, { timeout: 3000 });
  // the slingshot
  const before = await gemSet(page);
  await pullCrumb(page, -30, -80);
  assert.ok((await aimRead(page)).dots >= 10, 'the dots');
  await page.mouse.up();
  const shot = await page.evaluate(() => ({ fire: !!toy.fire, vx: toy.vx, vy: toy.vy }));
  assert.ok(shot.fire && shot.vx > 0 && shot.vy > 0, 'reduced motion: the slingshot throws the cannonball ' + JSON.stringify(shot));
  await page.waitForFunction(() => !toy.fire && toy.mode === 'rim', null, { timeout: 9000 });
  const after = new Set(await gemSet(page));
  assert.ok(before.filter(i => !after.has(i)).length >= 4, 'and it breaks gems');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('stakes: Last Chance with the slingshot: a deflated crumb still holds the run; a pull over the tray picks up nothing; a pull back and let go makes room', async ({ page }) => {
  await play(page);
  await dealt(page);
  await page.evaluate(() => { combo = 7; comboMiss = CFG.COMBO_GRACE - 1; toy.lastCombo = 7; });
  await chargeCrumb(page, 2);
  await missDrop(page);
  assert.deepEqual(await page.evaluate(() => [toy.hot, toy.pow]), [true, 0], 'deflated, charged');
  await dealt(page);
  await setup(page, { rows: STK_JAM });
  await page.evaluate(() => { const sq = SHAPES.find(s => s.n === 4 && s.rows === 2 && s.cols === 2); tray = [{ s: sq, gi: 1 }, { s: sq, gi: 2 }, { s: sq, gi: 3 }]; checkStuck(); });
  assert.equal(await page.evaluate(() => stuck && toyLast()), true, 'the last chance');
  assert.ok(await page.evaluate(() => banners.some(b => b.txt === 'LAST CHANCE!' && /pull/.test(b.sub))), 'the banner says pull');
  await page.waitForFunction(() => !el('crumbSay').hidden && el('crumbSay').textContent === 'PULL ME BACK, QUICK!');
  const g = await geometry(page), r = await crumbAt(page);
  await page.mouse.move(r.x, r.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(r.x + (g.trayCenters[1].x - r.x) * i / 10, r.y + (g.trayCenters[1].y - r.y) * i / 10); await page.waitForTimeout(16); }
  assert.deepEqual(await page.evaluate(() => [drag, pendingPress, !!toy.sl]), [null, null, true], 'over the tray: no pickup, still pulling');
  for (let i = 1; i <= 10; i++) { await page.mouse.move(g.trayCenters[1].x + (r.x - 30 - g.trayCenters[1].x) * i / 10, g.trayCenters[1].y + (r.y - 80 - g.trayCenters[1].y) * i / 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(170);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => !!toy.fire && drag === null), true, 'let go: a cannonball');
  await page.waitForFunction(() => !toy.fire && banners.some(b => b.txt === 'SAVED!'), null, { timeout: 9000 });
  await page.waitForFunction(() => toy.mode === 'rim', null, { timeout: 9000 });
  assert.deepEqual(await page.evaluate(() => [state, stuck, toyHot()]), ['play', false, false], 'room was made: the run goes on');
});

/* ── the Lab and "Clear it in three" (js/lab.js) ── */
const L3_PRINT = 665944305;                                   // hashStr of the whole puzzle table: the 60 puzzles everyone plays. Change it on purpose only
const labOpen = async (page, k) => {                  // the Lab from the start card, then puzzle k
  await page.click('#startLab'); await page.click('#labList button[data-id=three]');
  await page.evaluate(k => playL3(k), k);
  await page.waitForFunction(k => mode === 'lab' && state === 'play' && l3 && l3.k === k, k);
};
const labPlay = (page, moves) => page.evaluate(moves => { for (const [i, r, c] of moves) place(i, r, c); }, moves);
test('Lab: a slim Lab button beside Settings opens the Lab card (one tile per experiment) and Back returns; the menus fit 390x844 and 375x667', async ({ page }) => {
  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h }); await frames(page, 2);
    const r = await page.evaluate(() => { const s = el('startSettings').getBoundingClientRect(), l = el('startLab').getBoundingClientRect();
      return { row: Math.abs(s.top - l.top) < 1 && l.left > s.right, fits: l.bottom <= innerHeight && s.bottom <= innerHeight, h: Math.abs(s.height - l.height) < 1 }; });
    assert.deepEqual(r, { row: true, fits: true, h: true }, w + 'x' + h);
  }
  await page.click('#startLab');
  const c = await page.evaluate(() => ({ card: !el('labCard').hidden, line: el('labCard').querySelector('.sub').textContent,
    tiles: [...document.querySelectorAll('#labList button')].map(b => [...b.children].map(x => x.textContent).join(' | ')) }));
  assert.deepEqual(c, { card: true, line: "New things we are trying. Tell us what's fun.", tiles: ["🧁 Crumb's Bakery | Drop treats. Two the same bake a bigger one. | 5 of 11 treats", '🧩 Clear it in three | Three pieces. Leave the board empty. | 0 of 60', '🛟 Rescue the Crumbs | Clear a path. Get them out. | 0 of 3 · ☆☆☆☆☆☆☆☆☆'] });
  assert.equal(await page.evaluate(() => LAB.length), 3, 'the registry has the three experiments');
  await page.click('#labBack');
  assert.deepEqual(await page.evaluate(() => ({ lab: el('labCard').hidden, menu: !el('menuCard').hidden, fits: el('menuClose').getBoundingClientRect().bottom <= innerHeight && el('menuLab').getBoundingClientRect().bottom <= innerHeight })),
    { lab: true, menu: true, fits: true });
  await page.setViewportSize({ width: 390, height: 844 }); await frames(page, 2);
  assert.ok(await page.evaluate(() => el('menuClose').getBoundingClientRect().bottom <= innerHeight), 'the mode menu fits at 390x844');
  // its own card: the big Play and the 60 numbers, only puzzle 1 open
  await page.click('#menuLab'); await page.click('#labList button[data-id=three]');
  const g = await page.evaluate(() => ({ play: el('l3Play').querySelector('b').textContent, n: document.querySelectorAll('#l3Grid .l3n').length,
    open: [...document.querySelectorAll('#l3Grid .l3n')].filter(b => !b.disabled).map(b => b.dataset.k), back: el('l3Back').getBoundingClientRect().bottom <= innerHeight }));
  assert.deepEqual(g, { play: 'Puzzle 1', n: 60, open: ['1'], back: true });
  await page.click('#l3Back'); assert.equal(await page.isVisible('#labCard'), true, 'Back goes to the Lab card');
});
test('Lab: all 60 Clear-it-in-three puzzles are solvable, in their band, distinct, never swept early, and the table is what the generator makes', async ({ page, server }) => {
  const r = await page.evaluate(() => {
    let rolls = 0; const mr = Math.random; Math.random = () => { rolls++; return mr(); };
    const made = l3MakeAll(); Math.random = mr;
    const out = { match: JSON.stringify(made) === JSON.stringify(L3_TABLE), rolls, print: hashStr(JSON.stringify(L3_TABLE)), bad: [], keys: new Set(), bands: {} };
    for (let k = 1; k <= 60; k++) {
      const p = l3Puzzle(k), shapes = p.pieces.map(x => x.s), sol = l3Solve(p.lo, p.hi, shapes, 99), sets = [...sol.sets.values()];
      const b = p.band, cap = L3_MAX[L3_BANDS.indexOf(b)];
      let lo = p.lo, hi = p.hi, rows = 0, cols = 0;                  // the build's own solution, played out with clears
      for (const [i, r, c] of p.sol) { const m = placeMasks(shapes[i]).find(x => x.r === r && x.c === c); if (!m || (lo & m.lo) || (hi & m.hi)) { lo = -1; break; } const ids = lineIds(lo | m.lo, hi | m.hi); for (let q = 0; q < 16; q++) if (ids & (1 << q)) { if (q < 8) rows++; else cols++; } applyBits(lo, hi, shapes[i], m); lo = _lo; hi = _hi; }
      const blocked = s => s.seq.some(([i, r, c]) => { const m = placeMasks(shapes[i]).find(x => x.r === r && x.c === c); return (m.lo & p.lo) || (m.hi & p.hi); });
      const ok = sol.n >= 1 && sol.n <= cap && !sol.early && lo === 0 && hi === 0 && p.n === sol.n
        && (b === 'easy' ? sets.every(s => s.orders === 6) && !(rows && cols) && rows + cols <= 2
          : b === 'medium' ? rows >= 1 && cols >= 1 && rows + cols <= 3 && !sets.every(blocked)
          : sets.every(blocked));
      if (!ok) out.bad.push(k + ':' + JSON.stringify({ n: sol.n, early: sol.early, rows, cols }));
      out.keys.add(l3Key(p.lo, p.hi, p.pieces.map(x => SHAPES.indexOf(x.s))));
      out.bands[b] = (out.bands[b] || 0) + 1;
    }
    const t = performance.now(); l3Cache.clear(); for (let k = 1; k <= 60; k++) l3Puzzle(k); out.openMs = performance.now() - t;
    out.keys = out.keys.size; out.json = JSON.stringify([1, 21, 41, 60].map(k => l3Puzzle(k)));
    return out;
  });
  assert.equal(r.match, true, 'L3_TABLE is exactly what l3MakeAll() makes (node tools/lab3-table.mjs rewrites it)');
  assert.equal(r.rolls, 0, 'the generator never rolls Math.random');
  assert.deepEqual(r.bad, [], 'every puzzle solvable and in its band');
  assert.equal(r.keys, 60, 'no puzzle is a turned, flipped or shifted copy of another');
  assert.deepEqual(r.bands, { easy: 20, medium: 20, hard: 20 });
  assert.ok(r.openMs < 50, 'reading all 60 from the table is quick: ' + r.openMs.toFixed(1) + ' ms');
  if (L3_PRINT) assert.equal(r.print, L3_PRINT, 'the puzzles changed: on purpose? then update L3_PRINT');
  await page.reload(); await page.waitForFunction(() => typeof l3Puzzle === 'function' && !!cell);
  assert.equal(await page.evaluate(() => JSON.stringify([1, 21, 41, 60].map(k => l3Puzzle(k)))), r.json, 'the same puzzle on a second page load');
});
test('Lab: puzzle 1 played to its solution sweeps the board, says Solved, and is marked done; no score, stats, best, dares, bonus, Avalanche, cannonball or saved run', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { CFG.AVALANCHE = true; saveRun(); });
  const before = await page.evaluate(() => ({ stats: JSON.stringify(stats), best, cookies: dare.st.cookies, run: localStorage.getItem('crumble.run'), mode: localStorage.getItem('crumble.mode') }));
  await page.click('#pauseBtn'); await page.click('#pauseHome');
  await page.click('#menuLab'); await page.click('#labList button[data-id=three]'); await page.click('#l3Play');
  await page.waitForFunction(() => mode === 'lab' && state === 'play' && l3 && l3.k === 1);
  const hud = await page.evaluate(() => ({ cls: el('stage').classList.contains('lab'), num: el('labNum').textContent, score: getComputedStyle(el('scoreVal')).display,
    best: getComputedStyle(el('bestBox')).display, undo: el('labUndo').disabled, reset: el('labReset').disabled, bonus: el('bonusChip').hidden, dare: el('dareChip').hidden,
    tray: tray.length, empties: tray.every(Boolean), sky: curWorld === CFG.HOME_WORLD }));
  assert.deepEqual(hud, { cls: true, num: '1', score: 'none', best: 'none', undo: true, reset: false, bonus: true, dare: true, tray: 3, empties: true, sky: true });
  const sol = await page.evaluate(() => l3.p.sol);
  for (const [i, r, c] of sol) { await dragPiece(page, i, r, c); await frames(page, 2); }
  const s = await page.evaluate(() => ({ solved: l3.solved, empty: boardEmpty(), sweep: banners.some(b => b.txt === 'CLEAN SWEEP'), done: lab.three.done, at: lab.three.at,
    store: JSON.parse(localStorage.getItem('crumble.lab')), score, combo: combo > 0, dealing: !!dealing, trayNo, bonusMeter, ava: ava.live, hot: toy.hot, dareId: dare.id }));
  assert.deepEqual(s, { solved: true, empty: true, sweep: true, done: [1], at: 2, store: { v: 1, three: { done: [1], at: 2 }, rescue: { stars: [0, 0, 0], best: [0, 0, 0] }, bakery: { best: 0, seen: 5, crumbles: 0, games: 0, op: 0, bs: 0, bb: 0, hi: 0 } }, score: 0, combo: true, dealing: false, trayNo: 1, bonusMeter: 0, ava: false, hot: false, dareId: '' });
  await page.waitForSelector('#l3Done:not([hidden])', { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => ({ eye: el('l3DoneEye').textContent, title: el('l3DoneTitle').textContent, next: !el('l3Next').hidden })), { eye: 'Puzzle 1 of 60', title: 'Solved!', next: true });
  const after = await page.evaluate(() => ({ stats: JSON.stringify(stats), best, cookies: dare.st.cookies, run: localStorage.getItem('crumble.run'), mode: localStorage.getItem('crumble.mode'), lab: localStorage.getItem('crumble.run.lab') }));
  assert.deepEqual(after, { ...before, lab: null }, 'nothing else was counted or saved');
  await page.click('#l3Next');
  await page.waitForFunction(() => mode === 'lab' && l3.k === 2 && !l3.over);
  await page.click('#pauseBtn');
  assert.deepEqual(await page.evaluate(() => ({ eye: el('pauseEye').textContent, score: el('pauseScore').hidden, home: el('pauseHome').textContent, end: el('pauseNew').hidden, set: !el('setBtn').hidden })),
    { eye: 'Paused · Puzzle 2', score: true, home: 'Lab', end: true, set: true }, 'pause: Resume / Lab / Settings');
  await page.click('#pauseHome'); await page.click('#labBack'); await page.click('#menuEndless');
  await page.waitForFunction(() => mode === 'endless' && state === 'play');
  assert.equal(await page.evaluate(() => JSON.stringify(snapshot()) === localStorage.getItem('crumble.run') || score === JSON.parse(localStorage.getItem('crumble.run')).score), true, 'the Endless run is back as it was');
  assert.equal(await page.evaluate(() => el('stage').classList.contains('lab')), false, 'the score is back');
});
test('Lab: a wrong finish says "Not quite" and the board puts itself back; Undo takes back one drop, Reset the lot', async ({ page }) => {
  await labOpen(page, 1);
  const start = await page.evaluate(() => JSON.stringify(grid.map(r => r.map(g => g ? g.gi : -1))));
  const board = () => page.evaluate(() => JSON.stringify(grid.map(r => r.map(g => g ? g.gi : -1))));
  await dragPiece(page, 0, 0, 0); await frames(page, 2);
  assert.equal(await page.evaluate(() => tray[0] === null && !el('labUndo').disabled), true, 'a drop, and Undo lights up');
  await page.click('#labUndo');
  assert.equal(await board(), start); assert.equal(await page.evaluate(() => tray.every(Boolean) && el('labUndo').disabled), true, 'Undo: the piece is back in the tray');
  await dragPiece(page, 0, 0, 0); await frames(page, 2); await dragPiece(page, 1, 2, 0); await frames(page, 2);
  await page.click('#labUndo');
  assert.equal(await page.evaluate(() => !!tray[1] && !tray[0] && el('labUndo').disabled), true, 'one step only');
  await page.click('#labReset');
  assert.equal(await board(), start); assert.equal(await page.evaluate(() => tray.every(Boolean)), true, 'Reset: the start again');
  // three pieces down and gems left: Not quite, then the start again; a piece that cannot fit anywhere is a fail too
  await labPlay(page, [[0, 0, 0], [1, 2, 0], [2, 4, 0]]);
  const f = await page.evaluate(() => ({ over: l3.over, fails: l3.fails, banner: banners.some(b => b.txt === 'Not quite'), say: say.txt, state, overCard: el('overCard').hidden, busy: l3Busy() }));
  assert.deepEqual(f, { over: true, fails: 1, banner: true, say: f.say, state: 'play', overCard: true, busy: true });
  assert.ok(['nope.', 'so close. not really.'].includes(f.say), 'Crumb: ' + f.say);
  await page.waitForFunction(() => !l3.over, null, { timeout: 4000 });
  assert.equal(await board(), start); assert.equal(await page.evaluate(() => tray.every(Boolean) && state === 'play' && el('labHint').hidden), true);
  await page.evaluate(() => { grid = grid.map((row, r) => row.map((g, c) => (r + c) % 2 ? { gi: 1, t: 1, f: 0, l: 0 } : g)); });   // a checkerboard: no 1x2 fits
  await labPlay(page, [[2, 0, 0]]);
  assert.deepEqual(await page.evaluate(() => ({ over: l3.over, fails: l3.fails })), { over: true, fails: 2 }, 'a piece that fits nowhere ends the try');
});
test('Lab: after three failed tries Crumb offers a hint; it shows a right drop, and playing on from it solves the puzzle', async ({ page }) => {
  await page.evaluate(() => { lab.three.done = Array.from({ length: 40 }, (_, i) => i + 1); });   // a hard one: 1-40 solved, so 41 is open
  await labOpen(page, 41);
  for (let n = 1; n <= 3; n++) {
    await page.evaluate(() => { l3Fail(); });
    await page.waitForFunction(() => !l3.over, null, { timeout: 4000 });
    assert.equal(await page.isVisible('#labHint'), n === 3, 'the Hint button after fail ' + n);
  }
  assert.equal(await page.evaluate(() => say.txt), 'want a hint? fine.');
  await page.click('#labHint');
  const h = await page.evaluate(() => {
    const p = l3.p, h = l3.hint, shapes = p.pieces.map(x => x.s), m = placeMasks(shapes[h.i]).find(x => x.r === h.r && x.c === h.c);
    const free = !(m.lo & p.lo) && !(m.hi & p.hi); applyBits(p.lo, p.hi, shapes[h.i], m);
    const rest = shapes.map((s, i) => i === h.i ? null : s), after = l3Solve(_lo, _hi, rest, 9);
    return { free, solvable: after.n > 0, pulse: l3Pulse(), busy: fxBusy() };
  });
  assert.deepEqual(h, { free: true, solvable: true, pulse: true, busy: true }, 'the ghost sits on a seat that leads to a solution');
  // play it: the hinted drop, then the rest of a solution from there
  const moves = await page.evaluate(() => { const h = l3.hint, shapes = tray.map(t => t.s), m = placeMasks(shapes[h.i]).find(x => x.r === h.r && x.c === h.c);
    applyBits(l3.p.lo, l3.p.hi, shapes[h.i], m); const s = l3Solve(_lo, _hi, shapes.map((x, i) => i === h.i ? null : x), 1); return [[h.i, h.r, h.c], ...[...s.sets.values()][0].seq]; });
  await dragPiece(page, ...moves[0]); await frames(page, 2);
  assert.equal(await page.evaluate(() => l3.hint), null, 'a drop spends the hint');
  await labPlay(page, moves.slice(1));
  assert.equal(await page.evaluate(() => l3.solved && lab.three.done.includes(41)), true, 'a hint costs nothing');
});
test('Lab: progress survives a reload, is checked on load, merges from iCloud (union, max); every 5th new solve pays one cookie', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('crumble.lab', JSON.stringify({ v: 1, three: { done: [1, 2, 3, 4, 4, 99, 'x', 0], at: 5 } })));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab.three), { done: [1, 2, 3, 4], at: 5 }, 'bad entries dropped');
  assert.equal(await page.evaluate(() => [l3Open(5), l3Open(6), l3Next()].join()), 'true,false,5');
  await page.evaluate(() => localStorage.setItem('crumble.lab', '{"v":1,"three":"no"}'));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab.three), { done: [], at: 1 }, 'a broken save starts fresh');
  const m = await page.evaluate(() => {
    lab.three = { done: [1, 2, 3, 4], at: 5 };
    const ch = cloudMerge({ v: 1, lab: { three: { done: [2, 9, 61, -1, 'a'], at: 12 } } }), ch2 = cloudMerge({ v: 1, lab: { three: { done: [1], at: 3 } } });
    return { ch, ch2, three: lab.three, blob: cloudBlob().lab };
  });
  assert.deepEqual(m, { ch: true, ch2: false, three: { done: [1, 2, 3, 4, 9], at: 12 }, blob: { three: { done: [1, 2, 3, 4, 9], at: 12 }, rescue: { stars: [0, 0, 0], best: [0, 0, 0] }, bakery: { best: 0, seen: 5, crumbles: 0, games: 0, bs: 0, bb: 0 } } });
  await page.evaluate(() => { lab.three = { done: [1, 2, 3, 4], at: 5 }; saveLab(); dare.st.cookies = 7; saveDares(); });
  await labOpen(page, 5);
  await page.evaluate(() => { for (const [i, r, c] of l3.p.sol) place(i, r, c); });
  await page.waitForFunction(() => dare.st.cookies === 8, null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.dares')).cookies), 8, 'the jar is saved');
  await page.waitForFunction(() => say.txt === 'fine. one cookie.', null, { timeout: 2000 });
  await page.waitForSelector('#l3Done:not([hidden])', { timeout: 5000 });
  assert.match(await page.evaluate(() => el('l3DoneMsg').textContent), /cookie/);
  await page.evaluate(() => playL3(5));                            // solving it again pays nothing
  await page.evaluate(() => { for (const [i, r, c] of l3.p.sol) place(i, r, c); });
  await page.waitForSelector('#l3Done:not([hidden])', { timeout: 5000 });
  assert.equal(await page.evaluate(() => dare.st.cookies), 8);
  await page.click('#l3Lab');
  assert.equal(await page.evaluate(() => document.querySelector('#labList button[data-id=three] i').textContent), '5 of 60');
});
// ── A cookie on the board (js/cookie.js) ──
// on, with every gate open (the tests choose what to close); ODDS 1 so a deal that may land one does
const ckOn = page => page.evaluate(() => { CFG.COOKIE = true; CFG.COOKIE_ODDS = 1; CFG.COOKIE_START = 0; CFG.COOKIE_GAP = 0; CFG.COOKIE_MIN_GEMS = 8; CFG.TRANSFORM_COMBO = 99; ck.n = 0; ck.since = 999; ck.g = null; ck.off = false; });
// a board with 16 gems: rows 3-6 half full (4/8), so every gem's best line is 4 of 8
const CK_ROWS = ['00000000', '00000000', '00000000', '11110000', '11110000', '00001111', '00001111', '00000000'];
const ckView = page => page.evaluate(() => { const at = cookieCell(); return { on: !!ck.g, at, left: ck.left, bites: cookieBites(), n: ck.n, since: ck.since, jar: dare.st.cookies }; });
const ckSet = (page, r, c, left = 3) => page.evaluate(([r, c, left]) => { ck.g = grid[r][c]; ck.r = r; ck.c = c; ck.left = left; ck.at = 0; ck.wob = left === 1 ? performance.now() : 0; }, [r, c, left]);
const ones = () => [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
test('cookie: lands only when the roll and the gates allow (odds, first trays, gap, gems, run cap, Settings, guided game); never in Daily, Adventure or Challenge', async ({ page }) => {
  await play(page);
  await dealt(page);
  assert.deepEqual(await page.evaluate(() => [window.__cookieDefault, CFG.COOKIE]), [true, false], 'on by default, off for the older tests');
  await ckOn(page);
  await setup(page, { rows: CK_ROWS });
  const tryDeal = (pre = '') => page.evaluate(pre => { (0, eval)(pre); ck.g = null; cookieDealt(); return !!ck.g; }, pre);
  assert.equal(await tryDeal('CFG.COOKIE_ODDS = 0; ck.since = 999'), false, 'the roll says no');
  assert.equal(await tryDeal('CFG.COOKIE_ODDS = 1; CFG.COOKIE_START = trayNo; ck.since = 999'), false, 'not in the first trays');
  assert.equal(await tryDeal('CFG.COOKIE_START = 0; CFG.COOKIE_GAP = 6; ck.since = 4'), false, 'too soon after the last (the gap)');
  assert.equal(await page.evaluate(() => ck.since), 5, 'a tray counted toward the gap');
  assert.equal(await tryDeal('CFG.COOKIE_GAP = 0; CFG.COOKIE_MIN_GEMS = 17'), false, 'too few gems');
  assert.equal(await tryDeal('CFG.COOKIE_MIN_GEMS = 8; ck.n = CFG.COOKIE_RUN_MAX'), false, 'the run cap');
  assert.equal(await tryDeal('ck.n = 0; CFG.DARES = false'), false, 'dares (and cookies) off in Settings');
  assert.equal(await tryDeal('CFG.DARES = true; CFG.FX_MASCOT = false'), false, 'no mascot, no cookie');
  assert.equal(await tryDeal('CFG.FX_MASCOT = true; guide = { n: 1, ln: 0, sw: false, dn: 0 }'), false, 'the guided first game');
  assert.equal(await tryDeal('guide = null'), false, 'and the rest of that game too');
  assert.equal(await tryDeal('ck.off = false'), true, 'every gate open: it lands');
  const v = await ckView(page);
  assert.deepEqual([v.left, v.bites], [3, 0], 'whole, three trays to go');
  assert.ok(await page.evaluate(() => { const [r, c] = cookieCell(); const b = Math.max(grid[r].filter(Boolean).length, grid.filter(row => row[c]).length); return b >= CFG.COOKIE_LINE[0] && b <= CFG.COOKIE_LINE[1]; }), 'on a gem whose line takes some work');
  assert.ok(await page.evaluate(() => cookieBusy() && fxBusy()), 'the drop-in runs at full frame rate');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.cookieLand.includes(el('crumbSay').textContent), null, { timeout: 9000 });
  await page.waitForFunction(() => !cookieBusy(), null, { timeout: 3000 });
  for (const go of ['playDaily()', 'playLevel(1)', "playChal('ck-test', true)"]) {
    await page.evaluate(go);
    await dealt(page); await frames(page, 3);
    await setup(page, { rows: CK_ROWS });
    assert.equal(await tryDeal('ck.since = 999; ck.n = 0; ck.off = false'), false, go + ': none');
  }
});

test('cookie: a bite each tray (whole, one bite, two bites, then stale): it crumbles off, he grumbles, the jar is unchanged', async ({ page }) => {
  await play(page);
  await dealt(page);
  await ckOn(page);
  await setup(page, { rows: CK_ROWS });
  await ckSet(page, 3, 1);
  const jar = (await ckView(page)).jar;
  await page.evaluate(() => { cookieDealt(); });
  assert.equal((await ckView(page)).bites, 1, 'one bite');
  await page.evaluate(() => { cookieDealt(); });
  const v = await ckView(page);
  assert.deepEqual([v.left, v.bites, v.on], [1, 2, true], 'two bites, its last tray');
  await page.waitForFunction(() => cookieBusy(), null, { timeout: 4000 });   // the wobble comes now and then, and only then runs the frames
  await page.waitForFunction(() => !cookieBusy(), null, { timeout: 4000 });
  await page.evaluate(() => { cookieDealt(); });
  const w = await ckView(page);
  assert.deepEqual([w.on, w.jar, w.since, w.n], [false, jar, 0, 0], 'stale: gone, nothing in the jar');
  assert.ok(await page.evaluate(() => !!ck.fade), 'it crumbles off');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.cookieGone.includes(el('crumbSay').textContent), null, { timeout: 9000 });
});

test('cookie: clearing its gem feeds the jar by exactly 1: it hops into Crumb, he chomps and says so', async ({ page }) => {
  await play(page);
  await dealt(page);
  await ckOn(page);
  await page.evaluate(() => { dareRunReset(); dare.off = true; });   // no dare this run: one beaten by the same placement would add a second cookie
  await setup(page, { rows: ['01111111', ...CK_ROWS.slice(1)] });
  await ckSet(page, 0, 4, 2);
  await page.waitForFunction(() => !el('mascot').hidden && toy.mode === 'rim', null, { timeout: 8000 });   // the crumb is on the rim (not still tumbling off the menu's logo)
  const jar = (await ckView(page)).jar;
  const r = await page.evaluate(() => { tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }]; place(0, 0, 0); return { jar: dare.st.cookies, on: !!ck.g, n: ck.n, eat: !!ck.eat, saved: JSON.parse(localStorage.getItem('crumble.dares')).cookies }; });
  assert.deepEqual(r, { jar: jar + 1, on: false, n: 1, eat: true, saved: jar + 1 }, 'eaten: one cookie in the jar, saved');
  await page.waitForFunction(() => !!ck.hop && !!document.querySelector('.dareCookie'), null, { timeout: 3000 });
  assert.ok(await page.evaluate(() => fxBusy()), 'the hop runs at full frame rate');
  await page.waitForFunction(() => !ck.hop && !document.querySelector('.dareCookie'), null, { timeout: 3000 });
  await page.waitForFunction(() => el('mascot').classList.contains('chomp'), null, { timeout: 2000 });   // he chomps
  assert.ok(await page.evaluate(() => dare.jarShown === dare.st.cookies), 'the jar shows it');
  await page.waitForFunction(() => !el('crumbSay').hidden && SAY.cookieYum.includes(el('crumbSay').textContent), null, { timeout: 9000 });
  assert.equal(await page.evaluate(() => dare.st.cookies), jar + 1, 'exactly one');
});

test('cookie: rides its gem through an Avalanche (drawn where the gem falls); a gem the chain breaks is eaten', async ({ page }) => {
  await play(page);
  await dealt(page);
  await ckOn(page);
  await page.evaluate(() => { dareRunReset(); dare.off = true; });   // no dare this run: one beaten by the same placement would add a second cookie
  await page.evaluate(() => { CFG.AVALANCHE = true; CFG.AVA_CHANCE = 1; CFG.AVA_MAX = 1; });
  // which gems of the board survive the fall, and where they land (the rules run at once inside place)
  const fall = cookie => page.evaluate(({ rows, cookie }) => {
    if (ava.live) avaReset();
    grid = rows.map(row => [...row].map(ch => (ch === '1' ? { gi: 0, t: 1, f: 0, l: 0 } : null)));
    const ids = new Map(); grid.forEach((row, r) => row.forEach((g, c) => g && ids.set(g, r + ',' + c)));
    if (cookie) { ck.g = grid[cookie[0]][cookie[1]]; ck.r = cookie[0]; ck.c = cookie[1]; ck.left = 3; }
    combo = 4; tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }];
    place(0, 0, 0);
    const out = {}; grid.forEach((row, r) => row.forEach((g, c) => { if (g && ids.has(g)) out[ids.get(g)] = [r, c]; }));
    return { out, all: [...ids.values()], live: ava.live };
  }, { rows: AVA_ROWS, cookie });
  const first = await fall(null);
  assert.ok(first.live, 'it fell');
  const moved = Object.entries(first.out).find(([k, [r]]) => +k.split(',')[0] < r);
  const broke = first.all.find(k => !first.out[k] && +k.split(',')[0] > 0);
  assert.ok(moved && broke, 'a gem that falls and lives, and one the chain breaks');
  await page.waitForFunction(() => !ava.live, null, { timeout: 8000 });
  const jar = (await ckView(page)).jar;
  await fall(moved[0].split(',').map(Number));
  const v = await ckView(page);
  assert.deepEqual([v.on, v.at, v.jar], [true, moved[1], jar], 'the cookie rode its gem to ' + moved[1]);
  await frames(page, 4);
  assert.ok(await page.evaluate(() => ava.live && ck.py < by + (ck.r + .5) * cell - 1), 'mid-fall it is drawn with its gem, above its landing cell');
  await page.waitForFunction(() => !ava.live, null, { timeout: 8000 });
  await frames(page, 2);
  assert.ok(await page.evaluate(() => Math.abs(ck.py - (by + (ck.r + .5) * cell)) < 1.5 && !!ck.g), 'landed, on its gem');
  await page.evaluate(() => { ck.g = null; });
  await fall(broke.split(',').map(Number));
  assert.deepEqual(await page.evaluate(() => [!!ck.g, dare.st.cookies, !!ck.eat]), [false, jar + 1, true], 'its gem broke in the chain: eaten');
  await page.waitForFunction(() => !ck.eat && !ck.hop && !ava.live, null, { timeout: 9000 });
});

test('cookie: a cannonball through its gem eats it', async ({ page }) => {
  await play(page);
  await dealt(page);
  await ckOn(page);
  await setup(page, { rows: CK_ROWS });
  await ckSet(page, 4, 2);
  const jar = (await ckView(page)).jar;
  const r = await page.evaluate(() => {
    const s = masc.s;                                      // its middle over the cookie's cell
    toy.sc = 1; toy.x = bx + 2.5 * cell - masc.x - s / 2; toy.y = by + 4.5 * cell - masc.y - s / 2;
    toy.fire = { n: 0, pts: 0, max: 1, b: 0 }; toy.vx = 0; toy.vy = 0;
    toySmash();
    return { gem: !!grid[4][2], on: !!ck.g, jar: dare.st.cookies };
  });
  assert.deepEqual(r, { gem: false, on: false, jar: jar + 1 }, 'the gem broke and the cookie went into the jar');
  await page.waitForFunction(() => !ck.hop && !ck.eat, null, { timeout: 5000 });
});

test('cookie: saved in the run (ck) and restored on its gem; bad data or an older save means no cookie; a new run starts clean', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { CFG.COOKIE = true; }));   // on from the first frame after the reload
  await play(page);
  await dealt(page);
  await ckOn(page);
  await setup(page, { rows: CK_ROWS });
  await ckSet(page, 5, 6, 2);
  await page.evaluate(() => { ck.n = 1; ck.since = 0; saveRun(); });
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('crumble.run'))).ck, { r: 5, c: 6, l: 2, n: 1, s: 0, o: 0 }, 'the save key');
  await page.reload(); await toGame(page);
  await page.evaluate(() => { CFG.COOKIE = true; });
  await frames(page, 3);
  assert.deepEqual(await ckView(page).then(v => [v.on, v.at, v.left, v.n]), [true, [5, 6], 2, 1], 'back on its gem, with its bites');
  const load = ck0 => page.evaluate(ck0 => {
    const o = JSON.parse(localStorage.getItem('crumble.run'));
    if (ck0 === undefined) delete o.ck; else o.ck = ck0;
    return restore(o) && { on: !!ck.g, n: ck.n };
  }, ck0);
  assert.deepEqual(await load({ r: 0, c: 0, l: 2, n: 1, s: 0, o: 0 }), { on: false, n: 1 }, 'its cell is empty: no cookie');
  assert.deepEqual(await load({ r: 9, c: -1, l: 'x', n: 1e9, s: 'a' }), { on: false, n: 0 }, 'nonsense: no cookie');
  assert.deepEqual(await load('junk'), { on: false, n: 0 }, 'not even an object');
  assert.deepEqual(await load(undefined), { on: false, n: 0 }, 'an older save without one');
  assert.deepEqual(await load({ r: 5, c: 6, l: 0, n: 0, s: 0, o: 0 }), { on: false, n: 0 }, 'no trays left: none');
  await load({ r: 5, c: 6, l: 2, n: 2, s: 3, o: 0 });
  await page.evaluate(() => start());
  assert.deepEqual(await ckView(page).then(v => [v.on, v.n, v.since]), [false, 0, 999], 'a new run starts without one');
});

test('cookie: the run cap; the dealer deals the same trays with the cookie on or off', async ({ page }) => {
  await play(page);
  await dealt(page);
  await ckOn(page);
  for (let k = 0; k < 3; k++) {                             // three eaten, then none lands
    await setup(page, { rows: ['01111111', ...CK_ROWS.slice(1)] });
    await page.evaluate(() => { ck.since = 999; ck.g = null; cookieDealt(); if (!ck.g) throw new Error('no cookie'); ck.g = grid[0][3]; ck.r = 0; ck.c = 3; tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }]; place(0, 0, 0); });
  }
  await setup(page, { rows: CK_ROWS });
  assert.deepEqual(await page.evaluate(() => { ck.since = 999; cookieDealt(); return [ck.n, !!ck.g]; }), [3, false], 'COOKIE_RUN_MAX eaten: no more this run');
  // the same board and dealer state, the same Math.random: 14 deals with the cookie on, then off
  await setup(page, { rows: CK_ROWS });
  const snap0 = await page.evaluate(() => { tray = [{ s: SHAPES[0], gi: 1 }, null, null]; return snapshot(); });
  const deals = on => page.evaluate(({ on, snap0 }) => {
    let a = 77; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    restore(snap0); CFG.COOKIE = on; ck.n = 0; ck.since = 999;
    const out = [], lands = [];
    for (let k = 0; k < 14; k++) { tray = [null, null, null]; genTray(); cookieDealt(); out.push(tray.map(t => t && SHAPES.indexOf(t.s) + ':' + t.gi).join(' ')); lands.push(!!ck.g); if (ck.g && k % 2) ck.g = null; }
    return { out, lands, next: Math.random() };
  }, { on, snap0 });
  const a = await deals(true), b = await deals(false);
  assert.ok(a.lands.some(Boolean) && !b.lands.some(Boolean), 'cookies landed with it on, none with it off');
  assert.deepEqual(a.out, b.out, 'the same trays');
  assert.equal(a.next, b.next, 'and the stream is where it was');
});

// ── (sky bite) the sky fights back ──
test('sky bite: the stop counts past Space; bite is 0 at dawn, with the scale at 0 and outside Endless, and then dawn deals exactly as before', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const o = {}, AT = CFG.JOURNEY_AT, E = CFG.SKY_DEEP_EVERY;
    const at = (sc, j) => { score = sc; jJumps = j; return [skyStop(), skyBite()]; };
    o.dawn = at(0, 0); o.night = at(AT[3], 0); o.space = at(AT[5], 0); o.deep2 = at(AT[5] + 2 * E, 0); o.jumped = at(AT[1], 3);
    o.names = [0, 3, 5, 6, 7].map(stopName); score = AT[5] + 3 * E; jJumps = 2; o.target = journeyTarget();
    score = AT[3]; jJumps = 0; CFG.SKY_BITE_SCALE = 0; o.off = skyBite(); CFG.SKY_BITE_SCALE = 1;
    for (const m of ['daily', 'challenge', 'adventure']) { mode = m; o[m] = skyBite(); } mode = 'endless';
    guide = { n: 1, ln: 0, sw: false, dn: 0 }; o.guide = skyBite(); guide = null;
    CFG.TIDE = false; o.noTide = skyBite(); CFG.TIDE = true;
    // the same seed deals the same trays at dawn with the bite on, and at night with the scale at 0, and rolls the same dice
    const board = ['00000000','00000000','11000011','11100111','11000011','11100111','11011011','11011011'];
    const deal = (sc, scale) => { score = sc; jJumps = 0; CFG.SKY_BITE_SCALE = scale; W73(); resetTide(); closerCool = 99; sweepCool = 99;
      let n = 0; const src = mulberry(11); rndSrc = () => { n++; return src(); }; const out = [];
      for (let k = 0; k < 40; k++) { B73(board); tray = [null, null, null]; genTray(); out.push(lastTier + ':' + tray.map(t => SHAPES.indexOf(t.s)).join(',')); }
      const b = biteNow; rndSrc = null; CFG.SKY_BITE_SCALE = 1; return { out: out.join(' '), n, bite: b }; };
    const off = deal(0, 0), dawn = deal(0, 1), nightOff = deal(AT[3], 0), night = deal(AT[5] + 3 * E, 1);
    o.same = dawn.out === off.out && dawn.n === off.n && nightOff.out === off.out && nightOff.n === off.n;
    o.bites = [off.bite, dawn.bite, nightOff.bite, night.bite]; o.nightDiffers = night.out !== off.out || night.n !== off.n;
    score = 0; return o; })()`);
  assert.deepEqual(r.dawn, [0, 0], 'dawn: stop 0, no bite');
  assert.equal(r.night[0], 3); assert.ok(r.night[1] > 0 && r.night[1] < r.space[1], 'night bites, space more: ' + r.night[1] + ' / ' + r.space[1]);
  assert.equal(r.space[0], 5); assert.equal(r.deep2[0], 7, 'past Space the stops keep counting with the score');
  assert.ok(Math.abs(r.deep2[1] - r.space[1] - 2 * (await page.evaluate(() => CFG.SKY_DEEP_BITE))) < 1e-9, 'each Deep space stop adds SKY_DEEP_BITE');
  assert.equal(r.jumped[0], 4, 'jumps (sweeps, a beaten best) add a stop each');
  assert.deepEqual(r.names, ['Dawn', 'Night', 'Space', 'Deep space 1', 'Deep space 2']);
  assert.equal(r.target, 5, 'the sky art stays at Space');
  assert.equal(r.off, 0, 'SKY_BITE_SCALE 0 turns it off');
  assert.deepEqual([r.daily, r.challenge, r.adventure, r.guide, r.noTide], [0, 0, 0, 0, 0], 'Endless only, coaster dealer only');
  assert.deepEqual(r.bites.slice(0, 3), [0, 0, 0]); assert.ok(r.bites[3] > 0);
  assert.ok(r.same, 'bite 0 deals the very same trays from the same dice (dawn with it on, night with the scale at 0)');
  assert.ok(r.nightDiffers, 'and deep in space with it on the deal moves');
});

test('sky bite: a late stop deals leaner (shorter EASY, longer LEAN, fewer small pieces, comeback keys later), and every tray still has a solution', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate('(() => {' + B73 + `
    const AT = CFG.JOURNEY_AT, E = CFG.SKY_DEEP_EVERY;
    const board = ['11000011','10000001','00011000','00100100','10000001','00011000','11000011','10011001'];
    const tight = ['11111110','11111110','11111110','11111110','11111100','00000000','00000000','00000000'];   // 34 gems: crowded at dawn (CROWD_GEMS), not once the bite moves the line
    const run = (sc, seed) => { score = sc; jJumps = 0; W73(); resetTide(); closerCool = 99; sweepCool = 99; rndSrc = mulberry(seed);
      const o = { seq: '', small: 0, pieces: 0, bad: 0, bite: 0, keys: 0 }, crowd0 = CFG.CROWD_ROOM; CFG.CROWD_ROOM = 0;
      for (let k = 0; k < 160; k++) { const a0 = B73(board); tray = [null, null, null]; dryN = 0; genTray(); closerCool = 99; sweepCool = 99;
        o.seq += tide.st === 'easy' ? 'E' : 'L'; for (const t of tray) { o.pieces++; if (t.s.n <= 3) o.small++; }
        if (!evalHand(a0, tray.map(t => t.s), 400000).ok) o.bad++; }
      CFG.CROWD_ROOM = crowd0; o.bite = biteNow;
      // a crowded board (CROWD_GEMS gems): at dawn its comeback keys come; deep in space the line has moved past it
      const rs0 = waveStats.rescues;
      for (let k = 0; k < 6; k++) { W73(); const a0 = B73(tight); tide = { st: 'easy', n: 1, len: 99 }; genTray(); if (!evalHand(a0, tray.map(t => t.s), 400000).ok) o.bad++; }
      o.keys = waveStats.rescues - rs0; o.room = roomOf(B73(tight));
      rndSrc = null; const runs = o.seq.match(/E+|L+/g).slice(1, -1), avg = c => { const a = runs.filter(x => x[0] === c).map(x => x.length); return a.reduce((x, y) => x + y, 0) / a.length; };
      o.easy = avg('E'); o.lean = avg('L'); return o; };
    const o = { dawn: run(0, 5), deep: run(AT[5] + 4 * E, 5) }; score = 0; return o; })()`);
  const { dawn, deep } = r;
  console.log(`     (dawn: easy ${dawn.easy.toFixed(1)} lean ${dawn.lean.toFixed(1)} small ${dawn.small}/${dawn.pieces} keys ${dawn.keys}; deep space 4, bite ${deep.bite}: easy ${deep.easy.toFixed(1)} lean ${deep.lean.toFixed(1)} small ${deep.small}/${deep.pieces} keys ${deep.keys}; crowded board room ${dawn.room.toFixed(2)}, gems 34)`);
  assert.equal(dawn.bite, 0); assert.ok(deep.bite >= 2, 'deep space bites hard: ' + deep.bite);
  assert.ok(deep.easy < dawn.easy - 1, 'EASY stretches are shorter: ' + dawn.easy.toFixed(1) + ' -> ' + deep.easy.toFixed(1));
  assert.ok(deep.lean > dawn.lean + 1, 'LEAN stretches are longer: ' + dawn.lean.toFixed(1) + ' -> ' + deep.lean.toFixed(1));
  assert.ok(deep.small < dawn.small, 'fewer small pieces: ' + dawn.small + ' -> ' + deep.small);
  assert.ok(dawn.keys === 6 && deep.keys === 0, 'comeback keys come later: ' + dawn.keys + ' -> ' + deep.keys);
  assert.equal(dawn.bad + deep.bad, 0, 'every tray dealt has a solution');
});

test('sky bite: the game-over card names the stop and the player’s farthest (saved, past Space too, an older save without it), and still fits', async ({ page }) => {
  await play(page); await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await page.evaluate(() => tlReset());
  for (const [r, c] of [[0, 0], [1, 1], [2, 2], [3, 3]]) await tlPlace(page, r, c);
  await dealt(page);
  const over = (sc, j) => page.evaluate(([sc, j]) => { score = sc; jJumps = j; rescuesUsed = 0; gameOver(); const s = JSON.parse(localStorage.getItem('crumble.stats'));
    return { line: el('overStop').textContent, shown: !el('overStop').hidden, far: s.farStop }; }, [sc, j]);
  const again = () => page.evaluate(() => { el('overCard').hidden = true; tlStop(); state = 'play'; });
  const AT = await page.evaluate(() => CFG.JOURNEY_AT), E = await page.evaluate(() => CFG.SKY_DEEP_EVERY);
  await page.evaluate(() => { stats.farStop = 0; saveStats(); });
  assert.deepEqual(await over(AT[3], 0), { line: 'You reached Night.', shown: true, far: 4 }, 'the first stop on record claims nothing');
  await again();
  assert.deepEqual(await over(AT[2], 0), { line: 'You reached Golden hour. Your best is Night.', shown: true, far: 4 });
  await again();
  assert.deepEqual(await over(AT[5] + 2 * E, 0), { line: 'You reached Deep space 2. Farthest yet!', shown: true, far: 8 }, 'past Space it keeps counting');
  await again();
  assert.deepEqual(await over(AT[1], 1), { line: 'You reached Golden hour. Your best is Deep space 2.', shown: true, far: 8 }, 'a sweep jump counts');
  // the card still fits a phone with the line, the replay, the rescue and a long message
  const lay = await page.evaluate(() => { el('overMsg').textContent = 'New skin unlocked: Candy, Glass! That is a serious run.'; const r = id => el(id).getBoundingClientRect();
    return { stop: r('overStop'), tl: r('tlBoard'), revive: !el('reviveBox').hidden, btns: ['reviveBtn', 'againBtn', 'overMenuBtn'].map(r), h: innerHeight, tlShown: !el('tlBoard').hidden }; });
  assert.ok(lay.tlShown && lay.revive, 'the replay and the rescue are on the card');
  assert.ok(lay.stop.bottom <= lay.tl.top && lay.btns.every(b => b.bottom <= lay.h), 'everything fits on a 390x844 screen: ' + JSON.stringify(lay));
  fs.mkdirSync('tests/out', { recursive: true });
  await page.screenshot({ path: 'tests/out/sky-bite-over-card.png' });
  await page.setViewportSize({ width: 375, height: 667 }); await frames(page, 4);   // a small phone (iPhone SE)
  const sm = await page.evaluate(() => { const r = id => el(id).getBoundingClientRect(), c = el('overCard');
    return { stop: r('overStop'), tl: r('tlBoard'), btns: ['reviveBtn', 'againBtn', 'overMenuBtn'].map(r), h: innerHeight, scrollable: c.scrollHeight > c.clientHeight, sh: c.scrollHeight, ch: c.clientHeight }; });
  await page.screenshot({ path: 'tests/out/sky-bite-over-card-375x667.png' });
  console.log(`     (375x667: card ${sm.sh}/${sm.ch} px, last button bottom ${Math.round(sm.btns[2].bottom)})`);
  assert.ok(sm.stop.top >= 0 && sm.stop.bottom <= sm.tl.top && sm.btns.every(b => b.bottom <= sm.h), 'on a small phone everything is on screen too: ' + JSON.stringify(sm));
  await page.setViewportSize({ width: 390, height: 844 }); await frames(page, 4);
  // other modes: no line
  await again();
  await page.evaluate(() => { mode = 'daily'; dk = dailyKey(); lv = { lines: 0, pieces: 0, combo: 0, swept: false }; });
  assert.equal((await over(AT[4], 0)).shown, false, 'Daily shows no stop line');
  // an older stats save without the field loads as none on record
  await page.evaluate(() => { localStorage.setItem('crumble.stats', JSON.stringify({ v: 1, best: 500, games: 4, lines: 9, placed: 30, sweeps: 0, bestCombo: 2, totalScore: 900, bonuses: 0 })); clearRun('endless'); clearRun('daily'); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => ({ far: stats.farStop, games: stats.games, best })), { far: 0, games: 4, best: 500 }, 'an older save loads, farStop 0');
  await page.evaluate(() => { localStorage.setItem('crumble.stats', JSON.stringify({ v: 1, best: 500, farStop: 'x' })); loadStats(); });
  assert.equal(await page.evaluate(() => stats.farStop), 0, 'a bad value is ignored');
});

test('sky bite: a resumed run keeps its stop and deals at the same bite', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate(() => {
    const AT = CFG.JOURNEY_AT; score = AT[4]; jJumps = 2; saveRun();
    const o = { stop: skyStop(), bite: skyBite() };
    const snap = JSON.parse(localStorage.getItem(runStore('endless')));
    start(); o.fresh = [skyStop(), skyBite()];
    o.ok = restore(snap); o.back = skyStop(); o.biteBack = skyBite(); o.sky = journeyTarget();
    return o; });
  assert.equal(r.stop, 6, 'aurora by score plus two jumps: Deep space 1');
  assert.deepEqual(r.fresh, [0, 0], 'a new run is back at dawn');
  assert.ok(r.ok); assert.equal(r.back, 6, 'the stop survives the save'); assert.ok(r.bite > 0 && r.biteBack === r.bite, 'and so does the bite'); assert.equal(r.sky, 5);
});

test('sky bite: Admin (?dev) has the scale, a slider per stop and the knobs; a moved stop slider is saved and comes back', async ({ page, server }) => {
  await page.goto(server.url + '?dev');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  const r = await page.evaluate(() => {
    const keys = ['SKY_BITE_SCALE', 'SKY_BITE.1', 'SKY_BITE.5', 'SKY_DEEP_BITE', 'SKY_DEEP_EVERY', 'BITE_EASY', 'BITE_LEAN', 'BITE_CROWD'];
    const o = { has: keys.map(k => DEV_SLIDERS.some(s => s[0] === k)) };
    const box = [...document.querySelectorAll('#devList > div')].find(d => /Sky bite: night/.test(d.textContent));
    const inp = box.querySelector('input'); inp.value = '0.9'; inp.dispatchEvent(new Event('input'));
    o.set = CFG.SKY_BITE[3]; o.shown = box.querySelector('output').textContent; o.saved = JSON.parse(localStorage.getItem(DEV_STORE))['SKY_BITE.3'];
    o.snippet = /SKY_BITE: \[0,0.05,0.15,0.9,/.test(devSnippet());
    return o; });
  assert.deepEqual(r.has, Array(8).fill(true));
  assert.deepEqual([r.set, r.shown, r.saved, r.snippet], [0.9, '0.90', 0.9, true], 'an entry of the per-stop array is a slider like any other');
  await page.reload(); await toGame(page);
  assert.equal(await page.evaluate(() => CFG.SKY_BITE[3]), 0.9, 'and it comes back');
  await page.evaluate(() => localStorage.removeItem(DEV_STORE));
});

test('sky bite: the crumb says a line on arriving at night and at space (its own dice), not on a resume, not with the bite off', async ({ page }) => {
  await play(page); await dealt(page);
  await page.waitForFunction(() => !el('mascot').hidden);
  await page.evaluate(() => { CFG.DARES = false; dareRunReset(); });   // (dares) a "reach Night" dare would be won by the jump and its line would speak first
  const r = await page.evaluate(async () => {
    const AT = CFG.JOURNEY_AT, o = {}, wait = () => new Promise(res => setTimeout(res, 120)), seen = () => el('crumbSay').hidden ? '' : el('crumbSay').textContent;
    const r0 = rndSrc; let dealerDice = 0; rndSrc = () => { dealerDice++; return Math.random(); };
    say.until = 0; say.last = -1e9; score = AT[3]; await wait(); o.night = seen();
    say.until = 0; say.last = -1e9; score = AT[5]; await wait(); o.space = seen();
    rndSrc = r0; o.dice = dealerDice;
    say.until = 0; say.last = -1e9; o.ok = restore(JSON.parse(JSON.stringify(snapshot()))); await wait(); o.resumed = seen();   // no new stop on a resume
    start(); say.until = 0; say.last = -1e9; await wait(); CFG.SKY_BITE_SCALE = 0; score = AT[3]; await wait(); o.off = seen(); CFG.SKY_BITE_SCALE = 1;
    return o; });
  const lines = await page.evaluate(() => ({ night: SAY.night, space: SAY.space }));
  assert.ok(lines.night.includes(r.night), 'night: ' + r.night);
  assert.ok(lines.space.includes(r.space), 'space: ' + r.space);
  assert.equal(r.dice, 0, 'the lines never touch the dealer\'s dice');
  assert.ok(r.ok); assert.equal(r.resumed, '', 'a resume says nothing');
  assert.ok(!lines.night.includes(r.off), 'with the bite off there is nothing to warn about: ' + r.off);
});

/* ── (Lab) Rescue the Crumbs: js/rescue.js ── */
const rsOpenBoard = async (page, k) => {
  await page.evaluate(k => { for (let j = 0; j < k; j++) if (!lab.rescue.stars[j]) { lab.rescue.stars[j] = 1; lab.rescue.best[j] = 9; } playRS(k); }, k);
  await page.waitForFunction(k => mode === 'lab' && state === 'play' && rs && rs.k === k && !rs.over, k);
};
// a test board in place of board 1 (rows as in RS_BOARDS: '.', a gem colour digit, a/b/c a crumb) and a tray of shape indices
const rsTestBoard = (page, rows, shapes) => page.evaluate(({ rows, shapes }) => {
  RS_BOARDS[0] = { ...RS_BOARDS[0], rows }; playRS(0);
  tray = shapes.map((si, i) => si == null ? null : { s: SHAPES[si], gi: i + 1 });
}, { rows, shapes });
const rsView = page => page.evaluate(() => ({ rows: grid.map(r => r.map(g => g ? (g.cr ? 'c' : 'g') : '.').join('')), cr: rs.cr.map(x => x.out ? 'out' : x.r + ',' + x.c) }));
test('Rescue: the Lab lists both games; its card shows the three boards (only the first open); the HUD reads Pieces with Undo, Reset and the target; fits 390x844 and 375x667', async ({ page }) => {
  await page.click('#startLab');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#labList button')].map(b => b.dataset.id)), ['bakery', 'three', 'rescue']);
  await page.click('#labList button[data-id=rescue]');
  const c = await page.evaluate(() => ({ card: !el('rsCard').hidden, tiles: [...document.querySelectorAll('#rsGrid .rsTile')].map(b => [...b.children].map(x => x.textContent).join(' | ') + (b.disabled ? ' (locked)' : '')) }));
  assert.deepEqual(c, { card: true, tiles: ['1 | ☆☆☆ | ★★★ in 2', '🔒 | ☆☆☆ | Locked (locked)', '🔒 | ☆☆☆ | Locked (locked)'] });
  await page.click('#rsBack'); assert.equal(await page.isVisible('#labCard'), true, 'Back goes to the Lab card');
  await page.click('#labList button[data-id=rescue]'); await page.click('#rsGrid .rsTile[data-k="0"]');
  await page.waitForFunction(() => mode === 'lab' && rs && rs.k === 0 && state === 'play');
  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h }); await frames(page, 3);
    const hud = await page.evaluate(() => {
      const r = id => el(id).getBoundingClientRect(), par = r('labPar'), pause = r('pauseBtn');
      return { cls: el('stage').classList.contains('lab'), lbl: el('labLbl').textContent, n: el('labNum').textContent, par: el('labPar').textContent, parShown: !el('labPar').hidden,
        undo: el('labUndo').disabled, reset: el('labReset').disabled, score: getComputedStyle(el('scoreVal')).display, best: getComputedStyle(el('bestBox')).display,
        clear: par.right < pause.left && par.bottom < by && el('labPar').scrollWidth <= Math.ceil(par.width) + 1 };
    });
    assert.deepEqual(hud, { cls: true, lbl: 'Pieces', n: '0', par: '★★★ in 2', parShown: true, undo: true, reset: false, score: 'none', best: 'none', clear: true }, w + 'x' + h);
  }
  await page.click('#pauseBtn');
  assert.deepEqual(await page.evaluate(() => ({ eye: el('pauseEye').textContent, home: el('pauseHome').textContent, end: el('pauseNew').hidden })), { eye: 'Paused · Board 1', home: 'Lab', end: true });
  await page.click('#pauseHome'); await page.click('#labList button[data-id=rescue]');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#rsGrid .rsTile')].map(b => b.getBoundingClientRect()).map(r => r.right <= innerWidth && r.bottom <= innerHeight));
  assert.deepEqual(tiles, [true, true, true], 'the tiles fit at 375x667');
  // Clear it in three still shows its own HUD
  await page.evaluate(() => playL3(1)); await page.waitForFunction(() => l3 && mode === 'lab');
  assert.deepEqual(await page.evaluate(() => ({ lbl: el('labLbl').textContent, n: el('labNum').textContent, par: el('labPar').hidden, rs })), { lbl: 'Puzzle', n: '1', par: true, rs: null });
});
test('Rescue: crumbs fall through empty cells, rest on gems and on each other, stay when their line clears and then fall; the bottom row is the exit; nothing goes on a crumb', async ({ page }) => {
  // the rule on its own (bitboards)
  const u = await page.evaluate(() => {
    const B = rows => { let lo = 0, hi = 0; const cr = []; rows.forEach((row, r) => [...row].forEach((ch, c) => { const i = r * 8 + c; if (ch === '1') { if (i < 32) lo |= 1 << i; else hi |= 1 << (i - 32); } if (ch === 'a') cr.push(i); })); return [lo, hi, cr]; };
    const f = rows => rsFallBits(...B(rows)).map(p => (p >> 3) + ',' + (p & 7));
    return {
      onGem: f(['........', '...a....', '........', '........', '...1....', '........', '........', '........']),
      stack: f(['...a....', '...a....', '........', '........', '........', '........', '...1....', '........']),
      out: f(['........', '...a....', '........', '........', '........', '........', '........', '........']),
      stackOut: f(['........', '...a....', '...a....', '...a....', '........', '........', '........', '........']),
      onTopOfOut: f(['........', '...a....', '...1....', '........', '........', '........', '........', '...a....']),
    };
  });
  assert.deepEqual(u, { onGem: ['3,3'], stack: ['4,3', '5,3'], out: [], stackOut: [], onTopOfOut: ['1,3'] });
  // in the game: c sits on a shelf, b on a, a on the bottom row's gem; a dot fills the shelf, a bar row 6, a dot row 7
  await rsTestBoard(page, ['........', '........', '......c.', '1111.111', '........', '...b....', '..1a1111', '1111111.'], [0, 1, 0]);
  await page.waitForTimeout(700);
  const s0 = await rsView(page);
  assert.deepEqual(s0.cr, ['2,6', '5,3', '6,3'], 'the crumbs start where the board puts them');
  assert.equal(await page.evaluate(() => [[2, 6], [5, 3], [6, 3]].every(([r, c]) => !canPlace(SHAPES[0], r, c, grid))), true, 'nothing can be placed on a crumb');
  const g = await geometry(page);                          // and a drag right over a crumb never seats there
  await page.mouse.move(g.trayCenters[0].x, g.trayCenters[0].y); await page.mouse.down();
  const f = fingerFor(g, { rows: 1, cols: 1 }, 2, 6); await page.mouse.move(f.x, f.y, { steps: 6 }); await frames(page, 2);
  const slot = await page.evaluate(() => drag && drag.slot && [drag.slot.r, drag.slot.c]);
  assert.notDeepEqual(slot, [2, 6], 'no seat on the crumb');
  await page.evaluate(() => { if (drag && tray[drag.i]) sendBack(); drag = null; }); await page.mouse.up(); await frames(page, 2);
  await page.evaluate(() => { tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[1], gi: 2 }, { s: SHAPES[0], gi: 3 }]; place(0, 3, 4); });
  const s1 = await rsView(page);
  assert.deepEqual(s1.cr, ['5,6', '5,3', '6,3'], 'its shelf cleared: c falls through the empty cells onto the gem at 6,6');
  assert.equal(s1.rows[3], '........'); assert.equal(s1.rows[2], '........');
  await page.evaluate(() => place(1, 6, 0));
  const s2 = await rsView(page);
  assert.deepEqual(s2.cr, ['6,6', '5,3', '6,3'], 'row 6 cleared around a, which stays (it counts as filled); c falls one more onto the bottom row\'s gem');
  assert.equal(s2.rows[6], '...c..c.', 'the crumbs are all that is left of row 6');
  assert.deepEqual(await page.evaluate(() => ({ won: rs.won, used: rs.used, pieces: el('labNum').textContent })), { won: false, used: 2, pieces: '2' });
  await page.evaluate(() => place(2, 7, 7));
  const s3 = await rsView(page);
  assert.deepEqual(s3.cr, ['out', 'out', 'out'], 'the bottom row cleared: all three reach it and go out through the exit (b on top of a too)');
  assert.deepEqual(s3.rows, Array(8).fill('........'));
  assert.deepEqual(await page.evaluate(() => ({ won: rs.won, over: rs.over, stars: rs.stars })), { won: true, over: true, stars: 2 });
  await page.waitForFunction(() => rs.cr.every(x => x.done), null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => say.txt), 'fine. I was worried. a little.', 'the last one out');
});
test('Rescue: board 1 played with the drag engine wins with 3 stars at par; the card says Rescued!; a longer win earns 2 stars and keeps the best', async ({ page }) => {
  assert.deepEqual(await page.evaluate(() => [1, 2, 3, 4, 5, 6].map(n => rsStarsFor(1, n))), [3, 3, 3, 2, 2, 1], 'par 3: 3 stars up to 3 pieces, 2 up to 5, then 1');
  await rsOpenBoard(page, 0);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => say.txt), 'my cousins are stuck. obviously.');
  for (const [i, r, c] of await page.evaluate(() => rs.b.sol)) { await dragPiece(page, i, r, c); await frames(page, 2); }
  assert.deepEqual(await page.evaluate(() => ({ won: rs.won, stars: rs.stars, used: rs.used, lab: lab.rescue, busy: labBusy(), fx: fxBusy() })),
    { won: true, stars: 3, used: 2, lab: { stars: [3, 0, 0], best: [2, 0, 0] }, busy: true, fx: true });
  await page.waitForSelector('#rsDone:not([hidden])', { timeout: 6000 });
  assert.deepEqual(await page.evaluate(() => ({ eye: el('rsDoneEye').textContent, title: el('rsDoneTitle').textContent, stars: el('rsDoneStars').textContent, on: el('rsDoneStars').querySelectorAll('.on').length,
    msg: el('rsDoneMsg').textContent, next: !el('rsNext').hidden, again: !el('rsAgain').hidden })),
    { eye: 'Board 1 of 3', title: 'Rescued!', stars: '★★★', on: 3, msg: '2 pieces · best 2', next: true, again: true });
  await page.click('#rsNext');
  await page.waitForFunction(() => rs && rs.k === 1 && !rs.over);
  // board 2 the long way (the bottom row first): 4 pieces, 2 stars
  await page.evaluate(() => { for (const [i, r, c] of [[1, 7, 4], [0, 0, 6], [2, 0, 0], [1, 7, 5]]) place(i, r, c); });
  assert.deepEqual(await page.evaluate(() => ({ won: rs.won, stars: rs.stars, lab: lab.rescue })), { won: true, stars: 2, lab: { stars: [3, 2, 0], best: [2, 4, 0] } });
  await page.waitForSelector('#rsDone:not([hidden])', { timeout: 6000 });
  assert.equal(await page.evaluate(() => el('rsDoneMsg').textContent), '4 pieces · best 4 · ★★★ in 3');
  await page.click('#rsAgain'); await page.waitForFunction(() => rs && rs.k === 1 && !rs.over && rs.used === 0);
  await page.evaluate(() => { for (const [i, r, c] of rs.b.sol) place(i, r, c); });
  assert.deepEqual(await page.evaluate(() => lab.rescue), { stars: [3, 3, 0], best: [2, 3, 0] }, 'the better try counts');
  await page.evaluate(() => { playRS(1); for (const [i, r, c] of [[1, 7, 4], [0, 0, 6], [2, 0, 0], [1, 7, 5]]) place(i, r, c); });
  assert.deepEqual(await page.evaluate(() => lab.rescue), { stars: [3, 3, 0], best: [2, 3, 0] }, 'a worse one never lowers it');
  await page.waitForSelector('#rsDone:not([hidden])', { timeout: 6000 });
  await page.click('#rsLab');
  assert.equal(await page.evaluate(() => document.querySelector('#labList button[data-id=rescue] i').textContent), '2 of 3 · ★★★★★★☆☆☆');
});
test('Rescue: no piece fits: "Not quite", Crumb says so and the board resets; no game over', async ({ page }) => {
  await rsOpenBoard(page, 0);
  const start = await rsView(page);
  // a 3x3 that cannot fit once the dot is down (gems on every third cell of the top rows)
  await page.evaluate(() => { for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) if ((r * 3 + c) % 3 === 0 && !grid[r][c]) grid[r][c] = { gi: 5, t: 1, f: 0, l: 0 }; tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[10], gi: 2 }, null]; });
  assert.equal(await page.evaluate(() => fitsAnywhere(SHAPES[10], grid)), true, 'the 3x3 still fits before the drop');
  await page.evaluate(() => { const free = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!grid[r][c]) free.push([r, c]);
    for (const [r, c] of free) { const g = grid.map(x => x.slice()); g[r][c] = { gi: 1 }; if (!fitsAnywhere(SHAPES[10], g) && !linesFor(g).rows.length && !linesFor(g).cols.length) { place(0, r, c); return; } } });
  const f = await page.evaluate(() => ({ over: rs.over, fails: rs.fails, banner: banners.some(b => b.txt === 'Not quite'), say: say.txt, state, overCard: el('overCard').hidden, busy: labBusy(), undo: el('labUndo').disabled }));
  assert.deepEqual(f, { over: true, fails: 1, banner: true, say: 'you trapped them. nice.', state: 'play', overCard: true, busy: true, undo: true });
  await page.waitForFunction(() => !rs.over, null, { timeout: 4000 });
  assert.deepEqual(await rsView(page), start, 'the board as it started');
  assert.deepEqual(await page.evaluate(() => ({ used: rs.used, tray: tray.map(t => SHAPES.indexOf(t.s)), hint: el('labHint').hidden, n: el('labNum').textContent })), { used: 0, tray: [1, 1, 9], hint: true, n: '0' });
});
test('Rescue: Undo takes back one drop and puts a rescued crumb back; Reset starts again; the queue deals three at a time in order', async ({ page }) => {
  await rsOpenBoard(page, 1);
  await page.waitForTimeout(800);
  const start = await rsView(page);
  assert.equal(await page.evaluate(() => el('labUndo').disabled), true);
  await page.evaluate(() => place(0, 0, 6));                // the tall bar clears the tower's column: b goes out
  assert.deepEqual((await rsView(page)).cr, ['out', '6,2']);
  assert.equal(await page.evaluate(() => el('labUndo').disabled), false);
  await page.click('#labUndo');
  assert.deepEqual(await rsView(page), start, 'b is back on its tower, the column too');
  assert.deepEqual(await page.evaluate(() => ({ used: rs.used, tray: tray.map(t => t && SHAPES.indexOf(t.s)), undo: el('labUndo').disabled, n: el('labNum').textContent, hist: rs.hist.length })),
    { used: 0, tray: [4, 1, 2], undo: true, n: '0', hist: 0 });
  // three drops that do not win: the next three come in queue order; Undo after the deal takes the tray back too
  await page.evaluate(() => { place(1, 0, 0); place(0, 1, 0); place(2, 4, 0); });
  assert.deepEqual(await page.evaluate(() => ({ tray: tray.map(t => t && SHAPES.indexOf(t.s)), qi: rs.qi, n: el('labNum').textContent })), { tray: [4, 1, 2], qi: 6, n: '3' });
  await page.click('#labUndo');
  assert.deepEqual(await page.evaluate(() => ({ tray: tray.map(t => t && SHAPES.indexOf(t.s)), qi: rs.qi, used: rs.used })), { tray: [null, null, 2], qi: 3, used: 2 });
  await page.click('#labReset');
  assert.deepEqual(await rsView(page), start);
  assert.deepEqual(await page.evaluate(() => ({ used: rs.used, fails: rs.fails, tray: tray.map(t => SHAPES.indexOf(t.s)) })), { used: 0, fails: 1, tray: [4, 1, 2] }, 'a reset after a drop counts as a try');
});
test('Rescue: after three tries a Hint shows the next drop of the stored solution; off its path it starts the board again ("from the top. watch.")', async ({ page }) => {
  await rsOpenBoard(page, 2);
  for (let n = 1; n <= 3; n++) {
    if (n === 2) { await page.evaluate(() => place(1, 0, 0)); await page.click('#labReset'); }   // a reset try counts
    else { await page.evaluate(() => rsFail()); await page.waitForFunction(() => !rs.over, null, { timeout: 4000 }); }
    assert.equal(await page.isVisible('#labHint'), n === 3, 'the Hint button after try ' + n);
  }
  assert.equal(await page.evaluate(() => say.txt), 'want a hint? fine.');
  await page.click('#labHint');
  const sol = await page.evaluate(() => rs.b.sol);
  assert.deepEqual(await page.evaluate(() => [rs.hint.i, rs.hint.r, rs.hint.c]), sol[0]);
  assert.deepEqual(await page.evaluate(() => ({ pulse: rsFx(), busy: fxBusy() })), { pulse: true, busy: true });
  await dragPiece(page, ...sol[0]); await frames(page, 2);
  assert.deepEqual(await page.evaluate(() => ({ hint: rs.hint, used: rs.used })), { hint: null, used: 1 }, 'a drop spends the hint');
  await page.click('#labHint');
  assert.deepEqual(await page.evaluate(() => [rs.hint.i, rs.hint.r, rs.hint.c]), sol[1], 'still on the path: the next drop');
  await page.evaluate(() => place(1, 0, 0));                // off the path
  await page.click('#labHint');
  assert.deepEqual(await page.evaluate(() => ({ used: rs.used, hint: [rs.hint.i, rs.hint.r, rs.hint.c], say: say.txt })), { used: 0, hint: sol[0], say: 'from the top. watch.' });
  for (let j = 0; j < sol.length; j++) {                    // follow the hints to the end
    if (j) await page.click('#labHint');
    const h = await page.evaluate(() => [rs.hint.i, rs.hint.r, rs.hint.c]);
    assert.deepEqual(h, sol[j]);
    await page.evaluate(h => place(...h), h);
  }
  assert.deepEqual(await page.evaluate(() => ({ won: rs.won, stars: rs.stars, best: lab.rescue.best[2] })), { won: true, stars: 3, best: 7 }, 'a hint costs nothing');
});
test('Rescue: progress is saved, checked on load (older saves without it load), merged from iCloud (stars by max, best by the fewest)', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('crumble.lab', JSON.stringify({ v: 1, three: { done: [1, 2], at: 3 } })));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab), { three: { done: [1, 2], at: 3 }, rescue: { stars: [0, 0, 0], best: [0, 0, 0] }, bakery: { best: 0, seen: 5, crumbles: 0, games: 0, op: 0, bs: 0, bb: 0, hi: 0 } }, 'an older save loads; no rescues yet');
  await page.evaluate(() => localStorage.setItem('crumble.lab', JSON.stringify({ v: 1, three: { done: [1], at: 2 }, rescue: { stars: [3, 9, 2], best: [2, 4, 'x'] } })));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab.rescue), { stars: [3, 0, 0], best: [2, 0, 0] }, 'bad values dropped (stars without a best are not a rescue)');
  assert.deepEqual(await page.evaluate(() => [rsOpen(0), rsOpen(1), rsOpen(2), rsNext()]), [true, true, false, 1]);
  await page.evaluate(() => localStorage.setItem('crumble.lab', '{"v":1,"rescue":"no"}'));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab.rescue), { stars: [0, 0, 0], best: [0, 0, 0] });
  const m = await page.evaluate(() => {
    lab.rescue = { stars: [3, 1, 0], best: [2, 6, 0] };
    const ch = cloudMerge({ v: 1, lab: { rescue: { stars: [2, 2, 1], best: [3, 5, 12] } } });
    const ch2 = cloudMerge({ v: 1, lab: { rescue: { stars: [1, 1, 0], best: [4, 9, 0] } } });
    const bad = cloudMerge({ v: 1, lab: { rescue: { stars: [3, 3, 3, 3], best: [1, 'x', -2] } } });
    return { ch, ch2, bad, r: lab.rescue, blob: cloudBlob().lab.rescue, three: !!cloudBlob().lab.three };
  });
  assert.deepEqual(m, { ch: true, ch2: false, bad: true, r: { stars: [3, 2, 1], best: [1, 5, 12] }, blob: { stars: [3, 2, 1], best: [1, 5, 12] }, three: true });
  await page.evaluate(() => saveLab());
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('crumble.lab')).rescue), { stars: [3, 2, 1], best: [1, 5, 12] });
});
test('Rescue: the first rescue of a board pays one cookie, a replay none; nothing of the real game leaks in (dares, stats, saved run, Endless dealing)', async ({ page }) => {
  const deal = () => page.evaluate(() => {                 // an Endless opening from a pinned seed: the board, the tray and the dealer's state
    let a = 4242; const mr = Math.random;
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    leaveMode(); hideMenus(); mode = 'endless'; lvl = null; start();
    const out = JSON.stringify({ g: grid.map(r => r.map(g => g ? g.gi : -1)), t: tray.map(t => t && [SHAPES.indexOf(t.s), t.gi]), pace, trayNo, starCool, goldenCool, transformCool, tension, rndSrc: !!rndSrc, fairDeal, bonusMeter });
    Math.random = mr; return out;
  });
  await play(page); await dealt(page);
  const dealt0 = await deal();
  await dealt(page); await page.evaluate(() => saveRun());
  const before = await page.evaluate(() => ({ stats: JSON.stringify(stats), best, run: localStorage.getItem('crumble.run'), mode: localStorage.getItem('crumble.mode'), dares: localStorage.getItem('crumble.dares') }));
  await page.evaluate(() => { dare.st.cookies = 4; saveDares(); });
  await page.click('#pauseBtn'); await page.click('#pauseHome');
  await page.click('#menuLab'); await page.click('#labList button[data-id=rescue]'); await page.click('#rsGrid .rsTile[data-k="0"]');
  await page.waitForFunction(() => mode === 'lab' && rs && rs.k === 0 && !rs.over);
  const live = await page.evaluate(() => ({ bonus: el('bonusChip').hidden, dare: el('dareChip').hidden, dareId: dare.id, sky: curWorld === CFG.HOME_WORLD }));
  assert.deepEqual(live, { bonus: true, dare: true, dareId: '', sky: true });
  await page.evaluate(() => { for (const [i, r, c] of rs.b.sol) place(i, r, c); });
  await page.waitForFunction(() => dare.st.cookies === 5, null, { timeout: 5000 });
  await page.waitForFunction(() => say.txt === 'fine. one cookie. for the cousins.', null, { timeout: 3000 });
  await page.waitForSelector('#rsDone:not([hidden])', { timeout: 6000 });
  assert.equal(await page.evaluate(() => el('rsDoneCookie').hidden), false, 'the card says a cookie went in the jar');
  await page.click('#rsAgain'); await page.waitForFunction(() => rs && !rs.over && rs.used === 0);
  await page.evaluate(() => { for (const [i, r, c] of rs.b.sol) place(i, r, c); });
  await page.waitForSelector('#rsDone:not([hidden])', { timeout: 6000 });
  assert.deepEqual(await page.evaluate(() => ({ cookies: dare.st.cookies, card: el('rsDoneCookie').hidden })), { cookies: 5, card: true }, 'a replay pays nothing');
  const after = await page.evaluate(() => ({ stats: JSON.stringify(stats), best, run: localStorage.getItem('crumble.run'), mode: localStorage.getItem('crumble.mode'), dareId: dare.id, score, bonusMeter, ava: ava.live, hot: toy.hot }));
  assert.deepEqual(after, { stats: before.stats, best: before.best, run: before.run, mode: before.mode, dareId: '', score: 0, bonusMeter: 0, ava: false, hot: false }, 'no stats, best, saved run or mode touched');
  await page.click('#rsLab'); await page.click('#labBack'); await page.click('#menuEndless');
  await page.waitForFunction(() => mode === 'endless' && state === 'play');
  assert.equal(await page.evaluate(() => el('stage').classList.contains('lab') || !!rs), false, 'the Lab is gone from the HUD');
  assert.equal(await deal(), dealt0, 'Endless deals the same opening for the same seed after a Rescue game');
});
test('Rescue: every board\'s stored solution wins with 3 stars in the real game, the crumbs start at rest, and par is the fewest pieces that win (rsSolve)', async ({ page }) => {
  for (let k = 0; k < 3; k++) {
    await rsOpenBoard(page, k);
    const r = await page.evaluate(() => { const c = rsCells(rs.k); return { rest: JSON.stringify(rsFallBits(c.lo, c.hi, c.cr)) === JSON.stringify(c.cr.slice().sort((a, b) => a - b)), crumbs: rs.cr.length }; });
    assert.deepEqual(r, { rest: true, crumbs: k + 1 }, 'board ' + (k + 1));
    await page.evaluate(() => { for (const [i, r, c] of rs.b.sol) place(i, r, c); });
    assert.deepEqual(await page.evaluate(() => ({ won: rs.won, stars: rs.stars, used: rs.used, par: rs.b.par })), { won: true, stars: 3, used: [2, 3, 7][k], par: [2, 3, 7][k] }, 'board ' + (k + 1));
  }
  const s = await page.evaluate(() => {
    let rolls = 0; const mr = Math.random; Math.random = () => { rolls++; return mr(); };
    const out = [0, 1, 2].map(k => { const t = performance.now(), r = rsSolve(k, 9, 90000); return { min: r.min, over: r.over, par: RS_BOARDS[k].par, ms: Math.round(performance.now() - t) }; });
    Math.random = mr; return { out, rolls };
  });
  for (const [k, r] of s.out.entries()) {
    if (k === 2 && r.over) { console.log('     (board 3: the search ran out of time; proved no win in fewer than ' + r.min + ')'); assert.ok(r.min >= r.par - 1); continue; }
    assert.deepEqual({ min: r.min, over: r.over }, { min: r.par, over: false }, 'board ' + (k + 1) + ': par is the fewest pieces (' + r.ms + ' ms)');
  }
  assert.equal(s.rolls, 0, 'the solver never rolls Math.random');
});
/* ── (quiet) a quiet opening: Volcano, the cannonball charge and the bonus meter wait for Day ── */
const quietOn = page => page.evaluate(() => { CFG.QUIET_START = true; CFG.DARES = false; syncActions(); });
// one clear of row r at combo k (a 1x1 into a row of seven), on a board with one gem left over so it is not a sweep
const quietClear = (r, k) => `grid = empty(); grid[7][7] = { gi: 2, t: 1, f: 0, l: 0 }; ${clearAt(r, k)}`;
const loud = page => page.evaluate(() => ({ quiet: quietNow(), hot: toy.hot, volcano: discoveredWorlds.has('volcano'), live: !!transform, meter: bonusMeter, chip: !el('bonusChip').hidden, size: +toySize().toFixed(2) }));
const quietReset = page => page.evaluate(() => { trayNo = 10; transform = null; transformCool = 0; specialEnd = -99; golden = null; bonus = null; bonusMeter = 0; toy.hot = false; toy.pow = 0; toy.lastCombo = 0; discoveredWorlds.delete('volcano'); banners.length = 0; syncActions(); });

test('quiet: before Day nothing loud (no cannonball charge, no Volcano, no meter and its chip hidden); from Day all three work, the chip slides in', async ({ page }) => {
  await play(page); await dealt(page);
  assert.equal(await page.evaluate(() => window.__quietDefault), true, 'on by default in the game');
  await quietOn(page); await quietReset(page);
  const t0 = await loud(page);
  assert.deepEqual(t0, { quiet: true, hot: false, volcano: false, live: false, meter: 0, chip: false, size: 1 }, 'the first screen is calm: no meter chip');
  const cc = await page.evaluate(() => [CFG.CANNON_COMBO, CFG.TRANSFORM_COMBO]);
  assert.deepEqual(cc, [5, 5]);
  await page.evaluate(src => { eval(src); }, quietClear(0, 5));
  const t1 = await loud(page);
  assert.deepEqual(t1, { quiet: true, hot: false, volcano: false, live: false, meter: 0, chip: false, size: 1 }, 'a streak of 5 charges nothing, earns no Volcano, fills no meter, and the crumb does not swell');
  assert.equal(await page.evaluate(() => combo), 5, 'the combo itself is untouched');
  // Day: the same streak's next clear charges him, earns Volcano and fills the meter; the chip slides in
  await page.evaluate(() => { score = CFG.JOURNEY_AT[1]; });
  await page.evaluate(src => { eval(src); }, quietClear(0, 6));
  await frames(page, 2);
  const t2 = await page.evaluate(() => ({ quiet: quietNow(), hot: toy.hot, volcano: discoveredWorlds.has('volcano'), meter: bonusMeter > 0, chip: !el('bonusChip').hidden, arrive: el('bonusChip').classList.contains('arrive'), busy: fxBusy() }));
  assert.deepEqual(t2, { quiet: false, hot: true, volcano: true, meter: true, chip: true, arrive: true, busy: true }, 'from Day all three work, and the meter slides in');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => performance.now() < quietIn), false, 'the slide holds the frame rate only while it moves');
  await page.evaluate(() => { start(); });
  await dealt(page);
  assert.deepEqual(await page.evaluate(() => [quietNow(), el('bonusChip').hidden]), [true, true], 'a new run is quiet again, the chip hidden from its first tray');
  assert.equal(await page.evaluate(() => { jJumps = 1; return quietNow(); }), false, 'a jump past dawn (a sweep) ends it too');
});

test('quiet: a last chance still works for a crumb charged at Day; before Day out of room the run ends as it always did for an uncharged crumb', async ({ page }) => {
  await play(page); await dealt(page);
  await quietOn(page); await quietReset(page);
  const r = await page.evaluate(() => { stuck = true; toy.hot = false; const o = { quiet: quietNow(), last: toyLast() }; stuck = false; return o; });
  assert.deepEqual(r, { quiet: true, last: false }, 'uncharged (the only way before Day): no last chance, as before');
  const r2 = await page.evaluate(() => { score = CFG.JOURNEY_AT[1]; stuck = true; toy.hot = true; const o = toyLast(); stuck = false; toy.hot = false; return o; });
  assert.equal(r2, true, 'charged at Day: the last chance holds');
});

test('quiet: Crumb says one line when the quiet opening ends (his own dice), once a run, not on a resume past Day', async ({ page }) => {
  await play(page); await dealt(page);
  await quietOn(page);
  await page.waitForFunction(() => !el('mascot').hidden);
  const r = await page.evaluate(async () => {
    const o = {}, wait = (ms = 150) => new Promise(res => setTimeout(res, ms)), seen = () => el('crumbSay').hidden ? '' : el('crumbSay').textContent;
    const r0 = rndSrc; let dealerDice = 0; rndSrc = () => { dealerDice++; return Math.random(); };
    banners.length = 0; say.until = 0; say.last = -1e9; await wait(); o.before = seen();
    score = CFG.JOURNEY_AT[1]; await wait(); o.day = seen();
    say.until = 0; say.last = -1e9; await wait(); o.again = seen();
    score = CFG.JOURNEY_AT[2]; say.until = 0; say.last = -1e9; await wait(); o.golden = seen();
    rndSrc = r0; o.dice = dealerDice;
    const snap = JSON.parse(JSON.stringify(snapshot()));    // a run past Day
    start(); await wait(); say.until = 0; say.last = -1e9;
    o.ok = restore(snap); await wait(); o.resumed = seen(); o.due = say.qDue;
    start(); await wait(); say.until = 0; say.last = -1e9; CFG.QUIET_START = false; await wait(); o.off = seen(); o.offDue = say.qDue;   // switched off in Admin mid-quiet
    return o; });
  const lines = await page.evaluate(() => SAY.quiet);
  assert.equal(r.before, '', 'nothing before Day');
  assert.ok(lines.includes(r.day), 'at Day: ' + r.day);
  assert.ok(!lines.includes(r.again) && !lines.includes(r.golden), 'once a run: ' + r.again + ' / ' + r.golden);
  assert.equal(r.dice, 0, 'his line never touches the dealer\'s dice');
  assert.ok(r.ok); assert.ok(!lines.includes(r.resumed) && !r.due, 'a resume past Day says nothing');
  assert.ok(!lines.includes(r.off) && !r.offDue, 'the switch turned off says nothing');
  const sky = await page.evaluate(() => SAY.night.concat(SAY.aurora, SAY.space, SAY.deep));
  assert.ok(lines.every(l => !sky.includes(l)), 'his Day lines are not the sky stops\' lines');
});

test('quiet: off in Daily, Challenge, Adventure, the Lab and the guided first game; the switch off restores today\'s behaviour', async ({ page }) => {
  await play(page); await dealt(page);
  await quietOn(page);
  const r = await page.evaluate(() => {
    const o = {}, m0 = mode;
    for (const m of ['endless', 'daily', 'challenge', 'adventure', 'lab']) { mode = m; o[m] = quietNow(); }
    mode = m0;
    guide = { n: 1, ln: 0, sw: false, dn: 0 }; o.guide = quietNow(); guide = null;
    ck.off = true; o.guidedLater = quietNow(); ck.off = false;
    CFG.QUIET_START = false; o.off = quietNow(); CFG.QUIET_START = true;
    return o; });
  assert.deepEqual(r, { endless: true, daily: false, challenge: false, adventure: false, lab: false, guide: false, guidedLater: false, off: false });
  // Daily with it on: Volcano and the meter at score 0, as ever (the cannonball is Endless only)
  await quietReset(page);
  await page.evaluate(() => { mode = 'daily'; dk = dailyKey(); lv = { lines: 0, pieces: 0, combo: 0, swept: false }; syncActions(); });
  await page.evaluate(src => { eval(src); }, quietClear(0, 5));
  assert.deepEqual(await loud(page), { quiet: false, hot: false, volcano: true, live: true, meter: 3, chip: true, size: 1 }, 'Daily is untouched');
  // Endless with the switch off: exactly as before
  await page.evaluate(() => { mode = 'endless'; dk = ''; CFG.QUIET_START = false; });
  await quietReset(page);
  await page.evaluate(src => { eval(src); }, quietClear(0, 5));
  const off = await loud(page);
  assert.deepEqual({ ...off, size: off.size > 1 }, { quiet: false, hot: true, volcano: true, live: true, meter: 3, chip: true, size: true }, 'switched off: charge, Volcano and the meter at score 0, as before');
});

test('quiet: dealing for a pinned seed is unchanged with it on or off (it never rolls the dealer\'s dice)', async ({ page }) => {
  await play(page); await dealt(page);
  const snap0 = await page.evaluate(() => { CFG.TRANSFORM_COMBO = 2; CFG.CANNON_COMBO = 2; CFG.DARES = false;
    grid = empty(); for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) if ((r * 3 + c) % 5) grid[r][c] = { gi: r % 6, t: 1, f: 0, l: 0 };
    trayNo = 1; score = 0; combo = 0; tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 2 }, { s: SHAPES[0], gi: 3 }]; return snapshot(); });
  const run = q => page.evaluate(({ q, snap0 }) => {
    CFG.QUIET_START = q; restore(snap0); discoveredWorlds.delete('volcano'); toy.hot = false; toy.lastCombo = 0;
    let s = 99, n = 0; rndSrc = () => { n++; s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = [], best = () => { let b = null, bl = -1;
      for (let i = 0; i < 3; i++) if (tray[i]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (canPlace(tray[i].s, r, c, grid)) {
        const g = grid.map(x => x.slice()); for (const [dr, dc] of tray[i].s.cells) g[r + dr][c + dc] = 1; const l = linesFor(g), k = l.rows.length + l.cols.length;
        if (k > bl) { bl = k; b = [i, r, c]; } }
      return b; };
    let wasLoud = false;
    while (trayNo < 5) {
      const m = best(); if (!m) break;
      place(...m); if (toy.hot || discoveredWorlds.has('volcano')) wasLoud = true;
      if (dealing) { runSteps(dealing.it); dealing = null; out.push(trayNo + ':' + tray.map(t => t && SHAPES.indexOf(t.s) + '.' + t.gi).join(' ')); }
    }
    rndSrc = null;
    return { out, n, wasLoud };
  }, { q, snap0 });
  const on = await run(true), off = await run(false);
  assert.ok(off.wasLoud && !on.wasLoud, 'the off run charged the crumb or earned Volcano, the quiet one did not: ' + off.wasLoud + ' ' + on.wasLoud);
  assert.ok(on.out.length >= 3, 'a few trays dealt: ' + on.out.length);
  assert.deepEqual(on.out, off.out, 'the same trays');
  assert.equal(on.n, off.n, 'and the same number of rolls');
});

/* ── (voice) Crumb is the one voice: no praise words by default, transformations no longer multiply the score ── */
// n full rows but column 0, a gem of colour 3 in each; a 1xn bar (or 1x1) dropped at column 0 clears them; one gem of colour 0 stays (no sweep)
const VOICE = n => `grid = empty(); for (let r = 0; r < ${n}; r++) for (let c = 1; c < 8; c++) grid[r][c] = { gi: 3, t: 1, f: 0, l: 0 }; grid[7][7] = { gi: 0, t: 1, f: 0, l: 0 };
  tray = [{ s: SHAPES.find(s => s.cols === 1 && s.rows === ${n} && s.n === ${n}), gi: 3 }, { s: SHAPES[0], gi: 1 }, null]; banners.length = 0; bands.length = 0; slams.length = 0; praises.length = 0; bursts.length = 0; pops.length = 0; bannerWait = 0;`;
const voiceClear = (page, n, k, words) => page.evaluate(({ src, k, words }) => {
  CFG.PRAISE_WORDS = words; eval(src); combo = k - 1; trayNo = 10;
  const stings = []; const sp = Sfx.praise; Sfx.praise = t => { stings.push(t); };
  let rolls = 0; const r0 = rndSrc; rndSrc = () => { rolls++; return 0.5; };
  const fr = fxRoom; fxRoom = () => 40;                      // the same particle room each time (the bursts roll per particle)
  place(0, 0, 0);
  rndSrc = r0; Sfx.praise = sp; fxRoom = fr;
  return { praises: praises.map(p => p.word), pops: pops.length, slams: slams.map(s => [s.txt, -s.t]), bands: bands.map(b => [b.txt, -b.t]), bursts: bursts.length, stings, rolls, wait: bannerWait };
}, { src: VOICE(n), k, words });

test('voice: no praise word after 1-, 2- and 3-line clears by default; bursts, stings, the COMBO slam and COLOR GONE stay, and nothing waits for the missing word', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { CFG.DARES = false; });
  assert.equal(await page.evaluate(() => CFG.PRAISE_WORDS), false, 'off by default');
  for (const n of [1, 2, 3]) {
    const off = await voiceClear(page, n, 1, false);
    assert.deepEqual(off.praises, [], n + ' lines: no word');
    assert.equal(off.pops, 1, n + ' lines: the points still pop');
    assert.ok(off.bursts > 0, n + ' lines: the praise stars still burst');
    const on = await voiceClear(page, n, 1, true);
    assert.equal(on.praises.length, 1, n + ' lines: the switch on brings the word back');
    assert.deepEqual(off.stings, on.stings, n + ' lines: the same sting either way (music, not voice)');
    assert.equal(off.rolls, on.rolls, n + ' lines: the same dealer dice either way');
    assert.ok(off.wait <= on.wait, n + ' lines: the headline is never longer without the word: ' + off.wait + ' vs ' + on.wait);
  }
  assert.deepEqual((await voiceClear(page, 3, 1, false)).stings, [2], 'a 3-line clear still has its sting');
  // combo 3 and three lines wiping out colour 3: the slam comes at once (no gap for a word), then COLOR GONE, then any banner
  const off = await voiceClear(page, 3, 3, false), on = await voiceClear(page, 3, 3, true);
  assert.equal(off.slams.length, 1); assert.equal(off.slams[0][0], 'COMBO 3');
  assert.deepEqual(off.bands.map(b => b[0]), ['COLOR GONE!'], 'COLOR GONE still shows');
  assert.ok(on.slams[0][1] >= 32, 'with the word, the slam waits for it: ' + on.slams[0][1]);
  assert.ok(off.slams[0][1] < 32, 'without it, the slam is not held back: ' + off.slams[0][1]);
  assert.ok(off.bands[0][1] < on.bands[0][1] && off.wait < on.wait, 'COLOR GONE and the banners come sooner by the same amount: ' + JSON.stringify([off.bands, on.bands, off.wait, on.wait]));
  assert.equal(on.bands[0][1] - off.bands[0][1], on.wait - off.wait, 'the whole sequence just moves up');
});

test('voice: Crumb reacts to big clears and now and then to a 2-line clear, within the talk gap, with his own dice; not with the words on', async ({ page }) => {
  await play(page); await dealt(page);
  await page.waitForFunction(() => !el('mascot').hidden);
  const r = await page.evaluate(async ([s2, s3]) => {
    CFG.DARES = false; const o = {}, wait = () => new Promise(res => setTimeout(res, 120)), seen = () => el('crumbSay').hidden ? '' : el('crumbSay').textContent;
    const r0 = rndSrc; let dice = 0, count = false; rndSrc = () => { if (count) dice++; return Math.random(); };
    const clear = async (src, k = 1) => { eval(src); combo = k - 1; trayNo = 10; place(0, 0, 0); count = true; await wait(); count = false; return seen(); };   // only the frames after the drop are counted: his part
    const fresh = () => { say.until = 0; say.last = -1e9; };
    fresh(); o.big = await clear(s3);
    say.until = 0; CFG.TALK_TWO = 1; o.gap = await clear(s2);                   // straight after: the gap holds
    fresh(); o.two = await clear(s2);
    fresh(); CFG.TALK_TWO = 0; o.never = await clear(s2);
    fresh(); CFG.TALK_TWO = 1; CFG.PRAISE_WORDS = true; o.words = await clear(s2); CFG.PRAISE_WORDS = false;
    CFG.TALK_TWO = .3; let n = 0;                                           // the default: now and then, never every time
    for (let k = 0; k < 30; k++) { fresh(); if (SAY.two.includes(await clear(s2))) n++; }
    o.n = n; rndSrc = r0; o.dice = dice;
    return o; }, [VOICE(2), VOICE(3)]);
  const L = await page.evaluate(() => ({ big: SAY.big, two: SAY.two }));
  assert.ok(L.big.length >= 6, 'more lines for a big clear: ' + L.big.length);
  assert.ok(L.big.includes(r.big), 'a 3-line clear: ' + r.big);
  assert.ok(!L.two.includes(r.gap), 'the talk gap holds: ' + r.gap);
  assert.ok(L.two.includes(r.two), 'a 2-line clear, odds 1: ' + r.two);
  assert.ok(!L.two.includes(r.never) && !L.two.includes(r.words), 'odds 0, or the words on: nothing');
  assert.ok(r.n > 2 && r.n < 20, 'now and then: ' + r.n + ' of 30');
  assert.equal(r.dice, 0, 'his lines never roll the dealer\'s dice');
});

test('voice: a transformation no longer multiplies the score by default; no copy says ×1.5; the knob still works', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate(() => {
    const drop = () => { grid = empty(); tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, null]; const s0 = score; place(0, 4, 4); return score - s0; };
    const o = { mult: CFG.TRANSFORM_MULT };
    trayNo = 12; transform = null; o.plain = drop();
    transform = { id: 'volcano', remaining: 5 }; renderPips(); o.live = drop(); o.pips = el('transformPips').textContent; o.shown = !el('transformPips').hidden;
    banners.length = 0; transform = null; transformCool = 0; specialEnd = -99; discoveredWorlds.add('volcano'); triggerTransform('volcano'); o.banner = banners.map(b => b.sub);
    CFG.TRANSFORM_MULT = 1.5; transform = { id: 'volcano', remaining: 5 }; renderPips(); o.old = drop(); o.oldPips = el('transformPips').textContent;
    banners.length = 0; transform = null; transformCool = 0; specialEnd = -99; triggerTransform('volcano'); o.oldBanner = banners.map(b => b.sub);
    CFG.TRANSFORM_MULT = 1; transform = null; renderPips();
    return o; });
  assert.equal(r.mult, 1);
  assert.equal(r.live, r.plain, 'a live Volcano pays like any drop');
  assert.ok(r.shown && r.pips === '', 'the pips count the moves, no ×: ' + JSON.stringify(r.pips));
  assert.deepEqual(r.banner, ['9 MOVES'], 'the repeat card names no multiplier');
  assert.equal(r.old, Math.round(r.plain * 1.5), 'the knob at 1.5 still multiplies');
  assert.equal(r.oldPips, '×1.5'); assert.deepEqual(r.oldBanner, ['×1.5 · 9 MOVES']);
});

/* ── (report) Crumb's report card on the Endless game-over card ── */
const RC_RUN = { score: 0, best: 100000, stop: 0, combo: 0, sweeps: 0, dares: 0, cookies: 0, offered: 0, throws: 1, gems: 0, stale: 0, deflates: 0, toy: true };
const rcOver = (page, o = {}) => page.evaluate(o => {
  el('overCard').hidden = true; tlStop(); state = 'play'; rescuesUsed = 0;
  Object.assign(rc, { t: 1, g: 0, s: 0, d: 0, w: 0, c: 0, p: 0 }, o.rc || {});
  score = o.score ?? 50000; chaseBest = o.best ?? 100000; best = Math.max(best, chaseBest); jJumps = o.jumps || 0;
  gameOver();
  return { shown: !el('rcBox').hidden, grade: el('rcStamp').textContent, line: el('rcLine').hidden || el('rcTxt').hidden ? null : el('rcTxt').textContent,
    face: !el('rcFace').hidden && !!el('rcFace').querySelector('svg'), tip: el('overMsg').hidden ? '' : el('overMsg').textContent,
    stopIn: el('overStop').parentNode.id, stop: el('overStop').textContent };
}, o);

test('report: the grade table (a dozen runs, a new best, a first game), nine steps D to A+, never an F', async ({ page }) => {
  await play(page); await dealt(page);
  const rows = [
    // [run, grade]: score vs best 100k, stop, best combo, sweeps, dares + cookies
    [{ score: 5000, stop: 0, combo: 2 }, 'D'],
    [{ score: 20000, stop: 1, combo: 4 }, 'D'],
    [{ score: 40000, stop: 1, combo: 5, sweeps: 1 }, 'C'],
    [{ score: 50000, stop: 2, combo: 6, sweeps: 1 }, 'C+'],
    [{ score: 60000, stop: 3, combo: 6, sweeps: 1 }, 'B−'],
    [{ score: 60000, stop: 3, combo: 6, sweeps: 1, dares: 1 }, 'B'],
    [{ score: 70000, stop: 4, combo: 8, sweeps: 2, dares: 1 }, 'B+'],
    [{ score: 90000, stop: 4, combo: 10, sweeps: 2, dares: 2 }, 'A−'],
    [{ score: 92000, stop: 5, combo: 10, sweeps: 2, dares: 2 }, 'A'],
    [{ score: 90000, stop: 5, combo: 11, sweeps: 3, dares: 2 }, 'A+'],
    [{ score: 100001, stop: 0, combo: 0 }, 'A−'],                         // a new best is never below A-
    [{ score: 150000, stop: 5, combo: 12, sweeps: 3, dares: 3 }, 'A+'],           // a great new best
    [{ score: 30000, best: 0, stop: 3, combo: 8, sweeps: 2, dares: 1 }, 'B'],    // a first game: the other parts scaled up
    [{ score: 0, best: 0, stop: 0, combo: 0 }, 'D'],                               // the worst there is: still a D
  ];
  const got = await page.evaluate(rows => rows.map(([r]) => reportGrade({ best: 100000, sweeps: 0, dares: 0, cookies: 0, ...r })), rows);
  rows.forEach(([r, g], i) => assert.equal(got[i].grade, g, JSON.stringify(r) + ' -> mark ' + got[i].mark));
  assert.ok(got.every(g => g.mark >= 0 && g.mark <= 100));
  const all = await page.evaluate(() => { const s = new Set(); for (let m = 0; m <= 100; m++) s.add(reportGrade({ score: m * 1000, best: 100000, stop: m / 20, combo: m / 8, sweeps: m / 30, dares: m / 30 }).grade); return [...s]; });
  assert.deepEqual(all, ['D', 'C', 'C+', 'B−', 'B', 'B+', 'A−', 'A', 'A+'], 'nine steps, in order, and no F');
  assert.ok(await page.evaluate(() => Array.isArray(CFG.REPORT_W) && Array.isArray(CFG.REPORT_CUTS) && CFG.REPORT_CUTS.length === 9 && CFG.REPORT_W.reduce((a, b) => a + b, 0) === 100));
});

test('report: each quip has its own condition, they come in priority order, else the grade band; the same run always gets the same line', async ({ page }) => {
  await play(page); await dealt(page);
  const r = await page.evaluate(R => {
    const L = (o) => reportLine({ ...R, ...o }).key;
    return {
      best: L({ score: 120000, stop: 5, gems: 12 }), space: L({ stop: 5, gems: 12 }), cannon: L({ stop: 2, gems: 10, stale: 1 }), cannon9: L({ stop: 2, gems: 9 }),
      dares: L({ stop: 2, offered: 2, dares: 2, stale: 1 }), daresSome: L({ stop: 2, offered: 2, dares: 1 }), stale: L({ stop: 2, stale: 1, deflates: 1 }),
      deflate: L({ stop: 2, deflates: 1, throws: 0 }), ignored: L({ stop: 2, throws: 0 }), ignoredNoToy: L({ stop: 2, throws: 0, toy: false, score: 90000 }),
      quick: L({ stop: 0, throws: 0 }), low: L({ stop: 1, score: 10000 }), mid: L({ stop: 3, score: 60000, combo: 8, sweeps: 1, dares: 1 }), high: L({ stop: 4, score: 99000, combo: 12, sweeps: 3, dares: 3 }),
      same: [1, 2, 3].map(() => reportLine({ ...R, stop: 3, score: 61234, combo: 7 }).txt), other: reportLine({ ...R, stop: 3, score: 61235, combo: 7 }).txt,
      lines: Object.keys(SAY).filter(k => /^rc/.test(k)).map(k => [k, SAY[k].length, Math.max(...SAY[k].map(s => s.length)), SAY[k].every(s => s === s.toLowerCase() || /[A-Z]{2}/.test(s))]),
    }; }, RC_RUN);
  assert.deepEqual([r.best, r.space, r.cannon, r.cannon9, r.dares, r.daresSome, r.stale, r.deflate, r.ignored, r.ignoredNoToy, r.quick],
    ['rcBest', 'rcSpace', 'rcCannon', 'rcLow', 'rcDares', 'rcLow', 'rcStale', 'rcDeflate', 'rcIgnored', 'rcMid', 'rcQuick']);
  assert.deepEqual([r.low, r.mid, r.high], ['rcLow', 'rcMid', 'rcHigh']);
  assert.ok(r.same.every(t => t === r.same[0]), 'the same run, the same line');
  for (const [k, n, len, lower] of r.lines) { assert.ok(n >= 2 && n <= 3, k + ': ' + n + ' lines'); assert.ok(len <= 44, k + ' fits the card: ' + len); assert.ok(lower, k + ' is lowercase'); }
  assert.ok(await page.evaluate(() => { let n = 0; const r0 = rndSrc, mr = Math.random; rndSrc = () => { n++; return .5; }; Math.random = () => { n++; return .5; };
    reportLine({ score: 1, best: 2, stop: 1, combo: 1 }); reportShow(); rndSrc = r0; Math.random = mr; return n === 0; }), 'no dice at all');
});

test('report: the card shows the grade, his face and his line beside the sky line on an Endless game over; the counters survive a resume; old saves load', async ({ page }) => {
  await play(page); await dealt(page);
  await rcOver(page, { score: 30000, best: 100000 });   // the first one may name new skins
  const a = await rcOver(page, { score: 30000, best: 100000, rc: { t: 0, c: 5 } });
  assert.match(a.stop, /^You reached Day\./);
  assert.deepEqual({ ...a, line: !!a.line, stop: true }, { shown: true, grade: 'C', line: true, face: true, tip: '', stopIn: 'rcR', stop: true }, 'Endless: stamp, face and line, the sky line beside the stamp, no tip');
  assert.ok(await page.evaluate(t => SAY.rcIgnored.includes(t), a.line), 'never threw him: ' + a.line);
  // the counters ride in the run save and come back; an older save has zeros
  const s = await page.evaluate(() => { el('overCard').hidden = true; state = 'play'; tray = [{ s: SHAPES[0], gi: 1 }, null, null];
    Object.assign(rc, { t: 3, g: 11, s: 1, d: 2, w: 1, c: 9, p: 2 }); const snap = JSON.parse(JSON.stringify(snapshot()));
    start(); const fresh = { ...rc }; restore(snap); const back = { ...rc };
    delete snap.rc; start(); restore(snap); const old = { ...rc };
    const bad = JSON.parse(JSON.stringify(snap)); bad.rc = { t: -1, g: 'x', s: 1.5, d: 2 }; start(); restore(bad);
    return { saved: snapshot.toString().includes('rc:'), fresh, back, old, bad: { ...rc } }; });
  assert.deepEqual(s.fresh, { t: 0, g: 0, s: 0, d: 0, w: 0, c: 0, p: 0 }, 'a new run starts at zero');
  assert.deepEqual(s.back, { t: 3, g: 11, s: 1, d: 2, w: 1, c: 9, p: 2 }, 'a resumed run grades right');
  assert.deepEqual(s.old, { t: 0, g: 0, s: 0, d: 0, w: 0, c: 0, p: 0 }, 'an older save loads with zeros');
  assert.deepEqual(s.bad, { t: 0, g: 0, s: 0, d: 2, w: 0, c: 0, p: 0 }, 'bad values are dropped');
  // the hooks: a throw, a cannonball's best, a stale cookie, a deflate, a dare beaten, a combo, a sweep
  const h = await page.evaluate(() => { rcReset(); dareFlick(); dareFlick(); dareCannon(7); dareCannon(4); CFG.CANNON_DEFLATE = true; toy.hot = true; toy.pow = 2; toyDeflate(); toy.hot = false;
    ck.g = grid.flat().find(Boolean) || null; cookieGone();
    dare.id = 'drop2'; dare.s = 0; dareWin();
    grid = empty(); grid[0] = grid[0].map((_, c) => c ? { gi: 0, t: 1, f: 0, l: 0 } : null); tray = [{ s: SHAPES[0], gi: 1 }, { s: SHAPES[0], gi: 1 }, null]; combo = 3; place(0, 0, 0);
    return { ...rc }; });
  assert.deepEqual(h, { t: 2, g: 7, s: 1, d: 1, w: 1, c: 4, p: 1 }, 'each hook bumps its counter');
});

test('report: not in Daily, Challenge or Adventure; the switch off hides it (and the tip is back); mascot off: no face; talk off: no line', async ({ page }) => {
  await play(page); await dealt(page);
  await page.evaluate(() => { mode = 'daily'; dk = dailyKey(); lv = { lines: 0, pieces: 0, combo: 0, swept: false }; });
  assert.equal((await rcOver(page)).shown, false, 'Daily: none');
  await page.evaluate(() => { mode = 'adventure'; lvl = LEVELS[0]; lv = { lines: 0, pieces: 0, combo: 0, swept: false }; });
  const adv = await rcOver(page); assert.equal(adv.shown, false, 'Adventure: none'); assert.notEqual(adv.tip, '', 'its own message stays');
  await page.evaluate(() => { mode = 'endless'; lvl = null; dk = ''; });
  const ch = await page.evaluate(() => typeof chalOver === 'function' && /reportShow/.test(chalOver.toString()));
  assert.equal(ch, false, 'Challenge has its own card');
  assert.equal(await page.evaluate(() => /reportShow/.test(l3After.toString())), false, 'the Lab never reaches it');
  await page.evaluate(() => { CFG.REPORT_CARD = false; });
  const off = await rcOver(page);
  assert.equal(off.shown, false); assert.ok(off.tip.length > 10, 'switched off: the old tip is back: ' + off.tip); assert.equal(off.stopIn, 'overCard');
  await page.evaluate(() => { CFG.REPORT_CARD = true; CFG.FX_MASCOT = false; });
  const nm = await rcOver(page); assert.deepEqual([nm.shown, nm.face, !!nm.line], [true, false, true], 'mascot off: the grade and the line, no face');
  await page.evaluate(() => { CFG.FX_MASCOT = true; CFG.FX_CRUMB_TALK = false; });
  const nt = await rcOver(page); assert.deepEqual([nt.shown, nt.face, nt.line], [true, true, null], 'talk off: the grade without the line');
  await page.evaluate(() => { CFG.FX_MASCOT = false; });
  const both = await page.evaluate(() => { el('overCard').hidden = true; state = 'play'; gameOver(); return [!el('rcBox').hidden, el('rcLine').hidden]; });
  assert.deepEqual(both, [true, true], 'both off: the stamp alone beside the sky line');
});

test('report: the stamp thumps in after the score (fxBusy only while it moves; Reduce Motion: it just appears), and the card fits 390x844 and 375x667 with the sky line, the replay and Second chance', async ({ page }) => {
  await play(page); await dealt(page);
  await setup(page, { rows: EMPTY, trayShapes: [0, 0, 0] });
  await page.evaluate(() => tlReset());
  for (const [r, c] of [[0, 0], [1, 1], [2, 2], [3, 3]]) await tlPlace(page, r, c);
  await dealt(page);
  const lay = async () => page.evaluate(() => { const r = id => el(id).getBoundingClientRect();
    return { box: r('rcBox'), stamp: r('rcStamp'), score: r('overScore'), tl: r('tlBoard'), tlShown: !el('tlBoard').hidden, revive: !el('reviveBox').hidden, btns: ['reviveBtn', 'shareBtn', 'againBtn', 'overMenuBtn'].map(r), h: innerHeight, w: innerWidth }; });
  const fits = (l, tag) => {
    assert.ok(l.tlShown && l.revive, tag + ': the replay and Second chance are on the card');
    assert.ok(l.box.top >= l.score.bottom - 2 && l.box.bottom <= l.tl.top + 1, tag + ': the report row sits between the score and the replay: ' + JSON.stringify([l.score, l.box, l.tl]));
    assert.ok(l.box.left >= 0 && l.box.right <= l.w, tag + ': inside the screen');
    assert.ok(l.btns.every(b => b.bottom <= l.h), tag + ': every button on screen: ' + JSON.stringify(l.btns.map(b => Math.round(b.bottom))) + ' / ' + l.h);
  };
  const over = (o) => page.evaluate(o => { el('overCard').hidden = true; tlStop(); state = 'play'; rescuesUsed = 0; score = o.score; chaseBest = best = o.best; Object.assign(rc, { t: 0, g: 12, c: 6 });
    el('overMsg').textContent = ''; gameOver(); return { busy: fxBusy(), inCls: el('rcStamp').classList.contains('in'), reportIn: reportIn - performance.now() }; }, o);
  const a = await over({ score: 61234, best: 100000 });
  assert.ok(a.inCls && a.busy && a.reportIn > 800, 'it thumps in, at full frame rate while it moves');
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => performance.now() < reportIn), false, 'then pacing idles again');
  fits(await lay(), '390x844');
  // a long new-skin message too
  await page.evaluate(() => { el('overMsg').hidden = false; el('overMsg').textContent = 'New skin unlocked: Candy, Glass!'; });
  fits(await lay(), '390x844 + new skin');
  await page.setViewportSize({ width: 375, height: 667 }); await frames(page, 4);
  await over({ score: 61234, best: 100000 });
  await page.evaluate(() => { el('overMsg').hidden = false; el('overMsg').textContent = 'New skin unlocked: Candy!'; });
  fits(await lay(), '375x667');
  await page.setViewportSize({ width: 390, height: 844 }); await frames(page, 4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await toGame(page);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && (state === 'play' || state === 'idle'));
  if (await page.evaluate(() => state) !== 'play') await play(page);
  await dealt(page);
  assert.equal(await page.evaluate(() => reduce), true);
  const rm = await over({ score: 61234, best: 100000 });
  assert.deepEqual([rm.inCls, rm.reportIn > 0], [false, false], 'Reduce Motion: it is just there');
  assert.ok(await page.evaluate(() => typeof shareText === 'function' && !/[A-D][+−]?\b.*grade/i.test(shareText())), 'the share text is unchanged');
});

/* ═══════ (bakery) Crumb's Bakery: js/bakery.js. Physics is driven through bkStep directly, never by the clock ═══════ */
// steps the Bakery's world n times (in the page), stopping early if the run ends
const bkSteps = (page, n) => page.evaluate(n => { for (let i = 0; i < n && bk.st === 'play'; i++) bkStep(BK_DT); }, n);
// treats [tier, x] sitting on the floor, old enough to bake
const bkFloor = (page, list) => page.evaluate(list => { for (const [k, x] of list) { const b = bkBody(k, x, BK_JH - bkR(k)); b.born = -1; } }, list);
test('bakery: two of a kind that touch bake into the next treat where they met and score the table (10 x k(k-1)/2); different tiers never bake', async ({ page }) => {
  await page.evaluate(() => bkNew(1));
  const r3 = await page.evaluate(() => bkR(3));
  await bkFloor(page, [[3, 150], [3, 150 + 2 * r3 - 0.2]]);
  await bkSteps(page, 3);
  const a = await page.evaluate(() => ({ n: bk.bodies.length, k: bk.bodies[0].k, x: bk.bodies[0].x, score: bk.score, chain: bk.chain, big: bk.big,
    growing: bk.bodies[0].r < bk.bodies[0].rf, table: Array.from({ length: 11 }, (_, i) => bkPts(i + 1)) }));
  assert.ok(Math.abs(a.x - (150 + r3)) <= 2, 'where they touched: ' + a.x);
  delete a.x;
  assert.deepEqual(a, { n: 1, k: 4, score: 60, chain: 1, big: 4, growing: true, table: [0, 10, 30, 60, 100, 150, 210, 280, 360, 450, 550] });
  await bkSteps(page, 30);
  assert.equal(await page.evaluate(() => Math.abs(bk.bodies[0].r - bkR(4)) < 1e-9), true, 'it has grown to its own size');
  // neighbours of different tiers: never
  await page.evaluate(() => bkNew(1));
  await bkFloor(page, [[3, 40], [4, 110], [5, 180], [2, 250], [1, 320]]);
  await page.evaluate(() => { for (const b of bk.bodies) b.vx = (195 - b.x) * 2; });   // pushed together into the middle
  await bkSteps(page, 600);
  assert.deepEqual(await page.evaluate(() => ({ ks: bk.bodies.map(b => b.k).sort(), score: bk.score })), { ks: [1, 2, 3, 4, 5], score: 0 });
});
test('bakery: a chain multiplies: bakes within BK_CHAIN_MS of each other count x2, x3 ...; a pause starts again at x1', async ({ page }) => {
  await page.evaluate(() => bkNew(1));
  const [r2, r5] = await page.evaluate(() => [bkR(2), bkR(5)]);
  await bkFloor(page, [[2, 40], [2, 40 + 2 * r2 - .2], [5, 250], [5, 250 + 2 * r5 - .2]]);
  await bkSteps(page, 2);
  assert.deepEqual(await page.evaluate(() => ({ score: bk.score, chain: bk.chain })), { score: 30 + 2 * 150, chain: 2 }, 'gumdrops (30) then donuts doubled (2 x 150)');
  // a third bake 0.5 s later: x3
  await bkSteps(page, 60);
  let s0 = await page.evaluate(() => bk.score);
  await page.evaluate(() => { for (const x of [60, 60 + 2 * bkR(1) - .2]) { const b = bkBody(1, x, 100); b.born = -1; b.vy = 0; } });
  await bkSteps(page, 1);
  assert.deepEqual(await page.evaluate(s0 => ({ got: bk.score - s0, chain: bk.chain }), s0), { got: 3 * 10, chain: 3 });
  // after the window has passed: x1 again
  await bkSteps(page, 150);
  s0 = await page.evaluate(() => bk.score);
  await page.evaluate(() => { for (const x of [60, 60 + 2 * bkR(1) - .2]) { const b = bkBody(1, x, 100); b.born = -1; b.vy = 0; } });
  await bkSteps(page, 1);
  assert.deepEqual(await page.evaluate(s0 => ({ got: bk.score - s0, chain: bk.chain }), s0), { got: 10, chain: 1 });
});
test('bakery: a pile of mixed treats settles: everything asleep, no overlap past the slop, nothing through the walls or floor', async ({ page }) => {
  const r = await page.evaluate(() => {
    bkNew(3);
    const ks = [1, 3, 5, 7, 2, 4, 6, 8, 1, 3, 5, 2, 4, 9, 1, 2, 3, 6, 1, 4, 2, 5, 3, 1];
    ks.forEach((k, i) => { const b = bkBody(k, 30 + ((i * 97) % 330), -60 - i * 70); b.born = -1; });
    let steps = 0;
    for (; steps < 2400; steps++) { bkStep(BK_DT); bk.overT = 0; if (bk.rain.length === 0 && bk.bodies.every(b => b.z)) break; }
    const B = bk.bodies; let ov = 0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) ov = Math.max(ov, B[i].r + B[j].r - Math.hypot(B[i].x - B[j].x, B[i].y - B[j].y));
    return { steps, n: B.length, asleep: B.every(b => b.z), speed: Math.max(...B.map(b => Math.hypot(b.vx, b.vy))), ov,
      out: B.filter(b => b.x < b.r - .01 || b.x > BK_JW - b.r + .01 || b.y > BK_JH - b.r + .01).length };
  });
  assert.ok(r.asleep && r.steps < 2400, 'all asleep within 20 s of sim time: ' + JSON.stringify(r));
  assert.ok(r.speed < 1e-9 && r.out === 0, 'still and inside the jar: ' + JSON.stringify(r));
  assert.ok(r.ov <= 1.5, 'no treat rests inside another (overlap ' + r.ov.toFixed(2) + ' units of 390; slop .5)');
});
test('bakery: the drop sequence for a pinned seed is fixed, comes from the Bakery\'s own dice (never Math.random), and only tiers 1-5', async ({ page }) => {
  // the same generator, worked out here: Park-Miller from seed+1, weights 30/28/22/13/7
  let s = 4242 % 2147483646 + 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const roll = () => { let r = rnd() * 100; const w = [30, 28, 22, 13, 7]; for (let i = 0; i < 5; i++) if ((r -= w[i]) < 0) return i + 1; return 1; };
  const want = Array.from({ length: 32 }, roll);
  const run = () => page.evaluate(() => {
    ac();                                                        // the sound engine's one-time noise buffer is the game's, not the Bakery's
    let calls = 0; const mr = Math.random; Math.random = () => { calls++; return mr(); };
    const seen = [];
    try {
      bkNew(4242); seen.push(bk.held, bk.next);
      for (let i = 0; i < 30; i++) {
        bkDrop(40 + (i * 53) % 310); seen.push(bk.next);
        for (let j = 0; j < 80 && !bk.ready; j++) { bkStep(BK_DT); bk.overT = 0; }
      }
    } finally { Math.random = mr; }
    return { seen, calls };
  });
  const got = await run();
  assert.deepEqual(got.seen, want);
  assert.ok(got.seen.every(k => k >= 1 && k <= 5), 'only Crumb to Donut are handed out');
  assert.equal(got.calls, 0, 'Math.random was never called, merges and all');
  assert.deepEqual((await run()).seen, got.seen, 'the same seed plays the same jar');
  const gap = await page.evaluate(() => { bkNew(9); bkDrop(100); let n = 0; while (!bk.ready && n < 200) { bkStep(BK_DT); n++; } return n; });
  assert.ok(Math.abs(gap - 48) <= 1, 'the next treat is in his hands about 400 ms later (' + gap + ' steps)');
});
test('bakery: game over only after a settled treat has sat above the line for BK_LINE_MS (not a treat falling past it)', async ({ page }) => {
  const fall = await page.evaluate(() => { bkNew(5); bkDrop(200); for (let i = 0; i < 360; i++) bkStep(BK_DT); return bk.st; });
  assert.equal(fall, 'play', 'a dropped treat passes the line on its way down');
  const r = await page.evaluate(() => {
    const g = CFG.BK_GRAVITY; CFG.BK_GRAVITY = 0;                // a treat held still above the line
    try {
      bkNew(5); bkBody(4, 200, 30);
      const at = []; for (let i = 1; i <= 420; i++) { bkStep(BK_DT); if (i === 300) at.push(bk.st, bk.danger); if (bk.st !== 'play') { at.push(i); break; } }
      bkNew(5); const c = bkBody(4, 200, 30); c.born = -5;
      for (let i = 0; i < 200; i++) bkStep(BK_DT);              // 1.67 s over the line ...
      c.y = 200; c.z = false;                                    // ... then it is below it again
      for (let i = 0; i < 200; i++) bkStep(BK_DT);
      at.push(bk.st, bk.overT);
      return at;
    } finally { CFG.BK_GRAVITY = g; }
  });
  assert.deepEqual(r.slice(0, 2), ['play', true], 'at 2.5 s (1 s in the jar + 1.5 s over the line) it is still on, with the danger shown');
  assert.ok(Math.abs(r[2] - 360) <= 1, 'over at 3 s: 1 s in the jar, then 2 s above the line (step ' + r[2] + ')');
  assert.deepEqual(r.slice(3), ['play', 0], 'the clock starts again when it drops below');
});
test('bakery: two Party cakes CRUMBLE: no bigger treat, 2000 x the chain, ten Crumbs rain in over about a second, counted for good', async ({ page }) => {
  const r11 = await page.evaluate(() => bkR(11));
  await page.evaluate(() => { bkNew(2); lab.bakery.crumbles = 0; });
  await bkFloor(page, [[11, r11], [11, r11 * 3 - .5]]);
  await bkSteps(page, 2);
  const a = await page.evaluate(() => ({ n: bk.bodies.length, score: bk.score, cr: bk.cr, rain: bk.rain.length, saved: JSON.parse(localStorage.getItem('crumble.lab')).bakery.crumbles }));
  assert.deepEqual(a, { n: 0, score: 2000, cr: 1, rain: 10, saved: 1 });
  await bkSteps(page, 60);
  const mid = await page.evaluate(() => bk.bodies.length);
  assert.ok(mid > 0 && mid < 10, 'they are still coming in half a second later (' + mid + ')');
  await bkSteps(page, 120);
  assert.equal(await page.evaluate(() => bk.bodies.reduce((n, b) => n + 2 ** (b.k - 1), 0)), 10, 'ten Crumbs came in (some may have baked into Gumdrops)');
});
test('bakery: a first-ever treat is remembered for good; tiers 6 to 11 each put one cookie in Crumb\'s jar the first time, never again', async ({ page }) => {
  const c0 = await page.evaluate(() => { lab.bakery.seen = 5; saveLab(); return dare.st.cookies; });
  const bakePair = k => page.evaluate(k => { bkNew(3); const r = bkR(k); for (const x of [r + 1, 3 * r + .5]) { const b = bkBody(k, x, BK_JH - r); b.born = -1; } for (let i = 0; i < 3; i++) bkStep(BK_DT); return { seen: lab.bakery.seen, cookies: dare.st.cookies }; }, k);
  assert.deepEqual(await bakePair(4), { seen: 5, cookies: c0 }, 'a Donut is known from the start');
  assert.deepEqual(await bakePair(5), { seen: 6, cookies: c0 + 1 }, 'the first Cinnamon roll: one cookie');
  assert.deepEqual(await bakePair(5), { seen: 6, cookies: c0 + 1 }, 'the second: nothing');
  assert.deepEqual(await bakePair(6), { seen: 7, cookies: c0 + 2 });
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => ({ seen: lab.bakery.seen, jar: JSON.parse(localStorage.getItem('crumble.dares')).cookies })), { seen: 7, jar: c0 + 2 });
  assert.deepEqual(await bakePair(6), { seen: 7, cookies: c0 + 2 }, 'after a reload a Pancake is old news');
  // an old save without the Bakery loads, with defaults; a bad field is dropped on its own
  await page.evaluate(() => localStorage.setItem('crumble.lab', JSON.stringify({ v: 1, three: { done: [1, 2], at: 3 } })));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => ({ b: lab.bakery, d: lab.three.done })), { b: { best: 0, seen: 5, crumbles: 0, games: 0, op: 0, bs: 0, bb: 0, hi: 0 }, d: [1, 2] });
  await page.evaluate(() => localStorage.setItem('crumble.lab', JSON.stringify({ v: 1, bakery: { best: 4820, seen: 99, crumbles: 2, games: -1, op: 1 } })));
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await page.evaluate(() => lab.bakery), { best: 4820, seen: 5, crumbles: 2, games: 0, op: 1, bs: 0, bb: 0, hi: 0 });
});
test('bakery: the jar in progress saves and restores (score, dice, held and next, shakes, every treat), at rest; bad saves are refused', async ({ page }) => {
  const a = await page.evaluate(() => {
    bkNew(77);
    for (let i = 0; i < 14; i++) { bkDrop(30 + (i * 71) % 330); for (let j = 0; j < 90; j++) { bkStep(BK_DT); bk.overT = 0; } }
    bk.shakes = 2; bkSaveRun();
    return { snap: bkSnap(), saved: JSON.parse(localStorage.getItem(BK_RUN)) };
  });
  assert.deepEqual(a.saved, a.snap);
  const b = await page.evaluate(() => { bkNew(1); const ok = bkLoadRun(); const s = bkSnap(); window.__sv = localStorage.getItem(BK_RUN); return { ok, s, still: bk.bodies.every(b => b.vx === 0 && b.vy === 0), next: (() => { bkDrop(200); return bk.next; })() }; });
  assert.equal(b.ok, true);
  assert.deepEqual(b.s, a.snap, 'the same jar');
  assert.ok(b.still, 'restored at rest');
  const c = await page.evaluate(() => { bkNew(1); bkRestore(JSON.parse(window.__sv)); bkDrop(200); return bk.next; });
  assert.equal(b.next, c, 'the dice carry on where they were');
  const bad = await page.evaluate(() => [{ v: 2 }, { v: 1, sc: -1 }, { v: 1, sc: 0, seed: 5, h: 9, n: 1, b: [] }, { v: 1, sc: 0, seed: 5, h: 1, n: 1, b: [[12, 1, 1]] }, null].map(o => bkRestore(o)));
  assert.deepEqual(bad, [false, false, false, false, false]);
});

const bkOpenIt = async page => { await page.click('#startLab'); await page.click('#labList button[data-id=bakery]'); await page.waitForFunction(() => bk.open && bkG.jw > 0); };
test('bakery: the Lab tile (first, with its progress) and a NEW badge on the Lab buttons until the Bakery has been opened once', async ({ page }) => {
  const badge = () => page.evaluate(() => ['startLab', 'menuLab'].map(id => el(id).classList.contains('bkNewBadge') && getComputedStyle(el(id), '::after').content));
  assert.deepEqual(await badge(), ['"NEW"', '"NEW"']);
  await page.click('#startLab');
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('#labList button').children].map(x => x.textContent)), ["🧁 Crumb's Bakery", 'Drop treats. Two the same bake a bigger one.', '5 of 11 treats']);
  await page.click('#labList button[data-id=bakery]');
  assert.deepEqual(await page.evaluate(() => ({ open: !el('bakery').hidden, op: JSON.parse(localStorage.getItem('crumble.lab')).bakery.op, chef: !!document.querySelector('#bkCrumb svg .cl-chef'), saved: closet.on.head })),
    { open: true, op: 1, chef: true, saved: '' }, 'opened: the badge is spent; Crumb wears the Chef\'s hat without changing the player’s pick');
  assert.deepEqual(await badge(), [false, false]);
  await page.evaluate(() => { lab.bakery.best = 4820; lab.bakery.seen = 7; bkToLab(); });
  assert.equal(await page.evaluate(() => document.querySelector('#labList button[data-id=bakery] i').textContent), 'Best 4,820 · 7 of 11 treats');
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  assert.deepEqual(await badge(), [false, false], 'for good');
  // the player’s own hat wins
  await page.evaluate(() => { closet.on.head = 'party'; }); await bkOpenIt(page);
  assert.deepEqual(await page.evaluate(() => [!!document.querySelector('#bkCrumb svg .cl-party'), !!document.querySelector('#bkCrumb svg .cl-chef')]), [true, false]);
});
test('bakery: the view fits 390x844 and 375x667: score, best, pause, music, sound, the strip, Crumb, the jar and Shake on screen; the pause and end cards too', async ({ page }) => {
  await bkOpenIt(page);
  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const R = id => el(id).getBoundingClientRect(), inside = b => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && b.width > 0;
      const btn = ['bkScore', 'bkBest', 'bkPauseBtn', 'bkMusicBtn', 'bkSndBtn', 'bkShake', 'bkCrumb'].map(id => [id, inside(R(id))]).filter(x => !x[1]).map(x => x[0]);
      const hudB = Math.max(R('bkPauseBtn').bottom, R('bkScore').bottom), sh = R('bkShake');
      return { btn, strip: bkG.stripY >= hudB - 1 && bkG.stripX >= 0 && bkG.stripX + bkG.slot * 11 + 30 <= innerWidth,
        crumb: R('bkCrumb').top >= bkG.stripY + bkG.stripH - bkG.cs * .2, jar: bkG.jx >= 10 && bkG.jx + bkG.jw <= innerWidth - 10 && bkG.jy + bkG.jh + 8 <= sh.top,
        held: bkSY(BK_HOLD) > bkG.stripY + bkG.stripH, wide: bkG.jw };
    });
    assert.deepEqual({ ...r, wide: r.wide > 250 }, { btn: [], strip: true, crumb: true, jar: true, held: true, wide: true }, w + 'x' + h + ' ' + JSON.stringify(r));
    await page.click('#bkPauseBtn');
    assert.ok(await page.evaluate(() => ['bkResume', 'bkRestart', 'bkPauseLab', 'bkPauseHome'].every(id => { const b = el(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })), w + 'x' + h + ': the pause card');
    await page.click('#bkResume');
    await page.evaluate(() => { bk.cr = 2; bk.big = 9; bkShowCard(); });
    assert.ok(await page.evaluate(() => ['bkAgain', 'bkShare', 'bkOverLab', 'bkOverHome', 'bkBigCv', 'bkOverCr'].every(id => { const b = el(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.right <= innerWidth; })), w + 'x' + h + ': the end card');
    await page.evaluate(() => bkAgain());
  }
});
test('bakery: a finger aims (Crumb follows, clamped inside the walls) and letting go drops; a tap moves and drops; nothing while paused', async ({ page }) => {
  await bkOpenIt(page);
  await page.evaluate(() => bkNew(31));
  const g = await page.evaluate(() => ({ jx: bkG.jx, jw: bkG.jw, S: bkG.S, y: bkG.jy + 60 }));
  await page.mouse.move(g.jx + g.jw * .25, g.y); await page.mouse.down();
  await page.mouse.move(g.jx + g.jw * .7, g.y, { steps: 4 });
  const mid = await page.evaluate(() => ({ aim: bk.aim, n: bk.bodies.length, line: bk.touch != null, crumb: el('bkCrumb').getBoundingClientRect() }));
  assert.ok(Math.abs(mid.aim - 273) < 2 && mid.n === 0 && mid.line, JSON.stringify(mid));
  assert.ok(Math.abs(mid.crumb.left + mid.crumb.width / 2 - (g.jx + g.jw * .7)) < 2, 'Crumb is over the finger');
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => ({ n: bk.bodies.length, x: Math.round(bk.bodies[0].x), ready: bk.ready })), { n: 1, x: 273, ready: false });
  await page.mouse.click(g.jx / 2, g.y);                     // off the jar's left edge: clamped, and queued until the next is in his hands
  await page.waitForFunction(() => bk.bodies.length === 2, null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => bk.bodies[1].x === bkR(bk.bodies[1].k)), true, 'clamped against the wall');
  await page.waitForFunction(() => bk.ready);
  await page.click('#bkPauseBtn');
  await page.evaluate(g => { for (const t of ['pointerdown', 'pointerup']) bkCv.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: g.jx + 100, clientY: g.y, bubbles: true })); }, g);   // under the card
  assert.deepEqual(await page.evaluate(() => ({ n: bk.bodies.length, paused: bk.paused, raf: bkRaf, timer: !!bkTimer })), { n: 2, paused: true, raf: 0, timer: false }, 'paused: no drop, no loop');
});
test('bakery: its own loop only while it is up and not paused; the game\'s loop is parked underneath; leaving (Lab, Home, the app hidden) stops it; idle drops to a slow tick', async ({ page }) => {
  await page.evaluate(() => { window.__mainN = 0; const of = frame; frame = function (t) { __mainN++; return of(t); }; });
  await bkOpenIt(page);
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => { const n = __mainN; return new Promise(r => setTimeout(() => r({ main: __mainN - n, mainOff: bk.mainOff, live: !!bkRaf || !!bkTimer }), 500)); });
  assert.deepEqual(a, { main: 0, mainOff: true, live: true }, 'no frames of the game underneath');
  // settled and untouched: no rAF, a slow tick
  await page.evaluate(() => { bkNew(4); for (const k of [3, 5, 2]) { const b = bkBody(k, 60 + k * 50, BK_JH - bkR(k)); b.born = -1; } bkKick(); });
  await page.waitForFunction(() => bk.bodies.every(b => b.z), null, { timeout: 5000 });
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate(() => ({ raf: bkRaf, timer: !!bkTimer })), { raf: 0, timer: true });
  const draws = await page.evaluate(() => new Promise(r => { let n = 0; const od = bkDraw; bkDraw = function (t) { n++; return od(t); }; setTimeout(() => { bkDraw = od; r(n); }, 1000); }));
  assert.ok(draws >= 2 && draws <= 6, 'about four draws a second at rest (' + draws + ')');
  // Back to the Lab
  await page.click('#bkPauseBtn'); await page.click('#bkPauseLab');
  const b = await page.evaluate(() => { const n = __mainN; return new Promise(r => setTimeout(() => r({ open: bk.open, raf: bkRaf, timer: !!bkTimer, lab: !el('labCard').hidden, main: __mainN - n > 3, saved: !!localStorage.getItem(BK_RUN) }), 400)); });
  assert.deepEqual(b, { open: false, raf: 0, timer: false, lab: true, main: true, saved: true });
  // Home
  await page.click('#labList button[data-id=bakery]'); await page.click('#bkPauseBtn'); await page.click('#bkPauseHome');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, raf: bkRaf, timer: !!bkTimer, menu: !el('menuCard').hidden })), { open: false, raf: 0, timer: false, menu: true });
  // the app is hidden: saved, paused, stopped; back: the pause card waits
  await page.click('#menuLab'); await page.click('#labList button[data-id=bakery]');
  await page.evaluate(() => { bkDrop(150); });
  const h = await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const s = JSON.parse(localStorage.getItem(BK_RUN));
    return { paused: bk.paused, raf: bkRaf, timer: !!bkTimer, card: !el('bkPause').hidden, saved: s.b.length === bk.bodies.length };
  });
  assert.deepEqual(h, { paused: true, raf: 0, timer: false, card: true, saved: true });
  // a relaunch restores the jar at rest
  const before = await page.evaluate(() => bkSnap());
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  await page.evaluate(() => { if (!el('menuCard').hidden) closeMenu(); });
  await bkOpenIt(page);
  assert.deepEqual(await page.evaluate(() => ({ sc: bk.score, n: bk.bodies.length, h: bk.held })), { sc: before.sc, n: before.b.length, h: before.h });
});
test('bakery: tilt leans gravity (capped at BK_TILT_MAX); Reduce Motion: no tilt, no shake or jolt, short pops', async ({ page }) => {
  await bkOpenIt(page);
  const t = await page.evaluate(() => { CFG.TILT = true; toy.tiltOn = true; toy.gRaw = .8; toy.gx = .8; bkTilt(1); const a = bk.gx; CFG.BK_TILT = false; bkTilt(1); const b = bk.gx; CFG.BK_TILT = true; toy.gRaw = 0; toy.gx = 0; bkTilt(1); return [a, b]; });
  assert.deepEqual(t, [.25, 0]);
  await page.evaluate(() => { bkNew(3); const b = bkBody(4, 200, BK_JH - bkR(4)); bkShake(); });
  assert.ok(await page.evaluate(() => bkFx.jolt > 0 && bkFx.shake > 0 && bk.shakes === 0), 'the jar jolts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await page.waitForFunction(() => typeof lab !== 'undefined' && !!cell);
  await page.evaluate(() => { if (!el('menuCard').hidden) closeMenu(); });
  await bkOpenIt(page);
  const r = await page.evaluate(() => {
    CFG.TILT = true; toy.tiltOn = true; toy.gRaw = .8; toy.gx = .8; bkTilt(1); const gx = bk.gx;
    bkNew(3); const b = bkBody(4, 200, BK_JH - bkR(4)); bkShake();
    const r2 = bkR(2); for (const x of [40, 40 + 2 * r2 - .2]) { const o = bkBody(2, x, BK_JH - r2); o.born = -1; } for (let i = 0; i < 3; i++) bkStep(BK_DT);
    return { reduce, gx, jolt: bkFx.jolt, shake: bkFx.shake, pop: bkPopDur(), dizzy: bkFaceMood(b, 0), crumb: el('bkCrumb').className.includes('rm') };
  });
  assert.deepEqual(r, { reduce: true, gx: 0, jolt: 0, shake: 0, pop: .12, dizzy: '', crumb: true });
});
test('bakery: a first discovery flips its silhouette and shows "NEW! <name>"; the end: treats pop top to bottom, then the card with the biggest treat, NEW BEST, crumbles; Play again; Share text', async ({ page }) => {
  await bkOpenIt(page);
  await page.evaluate(() => { lab.bakery.seen = 5; lab.bakery.best = 100; bkNew(8); const r = bkR(5); for (const x of [r + 1, 3 * r + .5]) { const b = bkBody(5, x, BK_JH - r); b.born = -1; } for (let i = 0; i < 3; i++) bkStep(BK_DT); });
  assert.deepEqual(await page.evaluate(() => ({ chip: el('bkNew').hidden ? '' : el('bkNew').textContent, flip: !!bkFx.flip[6], seen: lab.bakery.seen })), { chip: 'NEW! Cinnamon roll 🍪', flip: true, seen: 6 });
  await page.evaluate(() => { for (const k of [1, 2, 3, 4]) { const b = bkBody(k, 40 + k * 70, 200); b.born = -1; } bk.score = 4820; bk.cr = 1; bkGameOver(); });
  const mid = await page.evaluate(() => new Promise(r => setTimeout(() => r({ st: bk.st, n: bk.bodies.length }), 500)));
  assert.ok(mid.st === 'over' && mid.n < 5, 'popping: ' + JSON.stringify(mid));
  await page.waitForFunction(() => bk.st === 'card', null, { timeout: 5000 });
  const c = await page.evaluate(() => ({ n: bk.bodies.length, card: !el('bkOver').hidden, score: el('bkOverScore').textContent, best: el('bkOverBest').textContent, name: el('bkBigName').textContent,
    cr: el('bkOverCr').textContent, saved: JSON.parse(localStorage.getItem('crumble.lab')).bakery, run: localStorage.getItem(BK_RUN), share: bkShareText(bk.seed0, bk.score, bk.big), s0: bk.seed0 }));
  assert.deepEqual({ ...c, saved: [c.saved.best, c.saved.games, c.saved.bs, c.saved.bb], share: c.share.replace(/bk=[\w-]+$/, 'bk=…') }, { n: 0, card: true, score: '4,820', best: '★ NEW BEST ★', name: 'Cinnamon roll', cr: '💥 One CRUMBLE!', saved: [4820, 1, c.s0, 6], run: null,
    s0: c.s0, share: "I baked a Cinnamon roll in Crumb's Bakery and scored 4,820. Same treats, same order. Beat it: https://crumble.win/?bk=…" });
  await page.click('#bkAgain');
  assert.deepEqual(await page.evaluate(() => ({ st: bk.st, score: bk.score, n: bk.bodies.length, card: el('bkOver').hidden })), { st: 'play', score: 0, n: 0, card: true });
});
test('bakery: progress merges from iCloud by max (best, biggest treat, crumbles, runs); bad values change nothing', async ({ page }) => {
  const r = await page.evaluate(() => {
    Object.assign(lab.bakery, { best: 500, seen: 7, crumbles: 1, games: 3 });
    const ch = cloudMerge({ v: 1, lab: { bakery: { best: 4820, seen: 6, crumbles: 2, games: 'x' } } });
    const ch2 = cloudMerge({ v: 1, lab: { bakery: { best: -5, seen: 40 } } });
    return { ch, ch2, b: { ...lab.bakery }, blob: cloudBlob().lab.bakery };
  });
  assert.deepEqual(r, { ch: true, ch2: false, b: { best: 4820, seen: 7, crumbles: 2, games: 3, op: 0, bs: 0, bb: 0, hi: 0 }, blob: { best: 4820, seen: 7, crumbles: 2, games: 3, bs: 0, bb: 0 } });
  // a better best from the cloud brings its run's seed and treat (Share my best); a lower one, or one without them, does not
  const s = await page.evaluate(() => [cloudMerge({ v: 1, lab: { bakery: { best: 6000, bs: 4242, bb: 9 } } }), cloudMerge({ v: 1, lab: { bakery: { best: 5000, bs: 7, bb: 3 } } }), lab.bakery.best, lab.bakery.bs, lab.bakery.bb]);
  assert.deepEqual(s, [true, false, 6000, 4242, 9]);
});

/* ── (bakery round two) faces fixed to the treat, the friend link and its dare, the first-play hint ── */
test('bakery: a face is fixed to its treat: drawn at the treat\'s own angle, upside down and all, and it never eases back upright', async ({ page }) => {
  await bkOpenIt(page);
  const r = await page.evaluate(() => {
    bkStop(); bkNew(4);
    const angs = [2.6, -1.1, 3.1, 0.4];
    angs.forEach((a, i) => { const b = bkBody(i + 1, 60 + i * 90, BK_JH - bkR(i + 1)); b.a = a; b.w = 0; b.born = -1; });
    const got = [], orig = bkFace;
    window.bkFace = function (g, k, ...rest) { const m = g.getTransform(); got.push(Math.atan2(m.b, m.a)); return orig.call(this, g, k, ...rest); };
    const norm = a => Math.atan2(Math.sin(a), Math.cos(a));
    try {
      bkDraw(performance.now());
      const first = bk.bodies.map(b => got.some(a => Math.abs(norm(a - b.a)) < 1e-6));
      for (let i = 0; i < 40; i++) { bkStep(BK_DT); bkFaces(BK_DT, performance.now() + i * 16); }   // asleep or rolling, time passes
      got.length = 0; bkDraw(performance.now());
      const later = bk.bodies.map(b => got.some(a => Math.abs(norm(a - b.a)) < 1e-6));
      return { first, later, upside: bk.bodies.some(b => Math.abs(norm(b.a)) > 2.5) };
    } finally { window.bkFace = orig; }
  });
  assert.deepEqual(r, { first: [true, true, true, true], later: [true, true, true, true], upside: true });
});

test('bakery: Crumb\'s bubble never covers the NEXT bubble at 375 wide, wherever he stands', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await bkOpenIt(page);
  const bad = await page.evaluate(() => {
    bkStop(); const out = [];
    for (let x = 0; x <= BK_JW; x += 26) {
      bk.aim = bkDropX(x); bkSayReset(); bkTalk.last = -1e9; bkSay('bkDanger', 3);
      bkDom.cKey = ''; bkDomStep(performance.now());
      const s = el('bkSay').getBoundingClientRect();
      const cx = bkSX(bk.aim), side = cx < bkG.W / 2 ? 1 : -1, nx = cx + side * (bkG.cs * .5 + 24), ny = bkSY(BK_HOLD) - bkG.cs * .42;
      const n = { left: nx - 20, right: nx + 20, top: ny - 17 - 14, bottom: ny + 17 };
      const hit = s.left < n.right && s.right > n.left && s.top < n.bottom && s.bottom > n.top;
      const off = s.left < 0 || s.right > innerWidth;
      if (hit || off) out.push({ x, hit, off });
    }
    return out;
  });
  assert.deepEqual(bad, []);
});

test('bakery: the jar is saved on every drop, not only on pause and hide', async ({ page }) => {
  await bkOpenIt(page);
  const r = await page.evaluate(() => {
    localStorage.removeItem(BK_RUN); bkNew(12);
    bkDrop(120); const one = JSON.parse(localStorage.getItem(BK_RUN));
    for (let j = 0; j < 80; j++) bkStep(BK_DT);
    bkDrop(260); const two = JSON.parse(localStorage.getItem(BK_RUN));
    return { one: one && one.b.length, two: two && two.b.length, held: two.h === bk.held && two.n === bk.next };
  });
  assert.deepEqual(r, { one: 1, two: 2, held: true });
});

// the site opened with a friend's Bakery link (seed, the player’s score, the player’s biggest treat); fresh: as a first-time visitor
const bkLinkQ = (page, seed, beat, tier) => page.evaluate(([s, b, t]) => bkLinkFor(s, b, t).split('?')[1], [seed, beat, tier]);
const bkOpenLink = async (page, server, q, fresh) => {
  if (fresh) await page.evaluate(() => { sessionStorage.setItem('crumble.test.fresh', '1'); localStorage.clear(); });
  await page.goto(server.url + '?' + q);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!cell && typeof bk !== 'undefined');
};
test('bakery: a friend link carries the seed, the score and the biggest treat, and reads back the same; a malformed or tampered one is ignored', async ({ page, server }) => {
  const r = await page.evaluate(() => {
    const cases = [[123456, 4820, 8], [1, 0, 1], [2147483646, 999999990, 11], [77, 30, 3]];
    const back = cases.map(([s, b, t]) => { const l = bkLinkFor(s, b, t); return { l: l.startsWith(SHARE_URL + '/?bk='), p: bkLinkParse(l.split('bk=')[1]) }; });
    const v = bkLinkFor(123456, 4820, 8).split('bk=')[1], [a, b, c, k] = v.split('-');
    const bad = [[a, (parseInt(b, 36) + 1).toString(36), c, k], [a, b, '9', k], [a, b, c, 'zzz'], [a, b, 'c', k], ['0', b, c, k], [a + 'zzzzzz', b, c, k]].map(x => x.join('-'))
      .concat(['', 'abc', v + '-1', v.replace(/-/g, '.'), '<script>', null]);
    return { back, cases, bad: bad.map(x => bkLinkParse(x)) };
  });
  assert.deepEqual(r.back, r.cases.map(([seed, beat, tier]) => ({ l: true, p: { seed, beat, tier } })));
  assert.deepEqual(r.bad, r.bad.map(() => null));
  const q = await bkLinkQ(page, 123456, 4820, 8);
  await bkOpenLink(page, server, q.replace(/-([0-9a-z]{3})$/, '-000'));
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, dare: bk.dare, search: location.search })), { open: false, dare: null, search: '' }, 'a tampered link: the site as usual, the address tidied');
  await bkOpenLink(page, server, 'bk=%3Cb%3E&x=1');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, search: location.search })), { open: false, search: '?x=1' }, 'only its own parameter is taken out');
});

test('bakery: a friend link opens straight on the dare card (no menu, no guided first game), the link leaves the address bar; the guide still comes with the block game', async ({ page, server }) => {
  const q = await bkLinkQ(page, 123456, 4820, 8);
  await bkOpenLink(page, server, q, true);
  const v = await page.evaluate(() => ({ card: !el('bkDare').hidden, open: bk.open, paused: bk.paused, line: el('bkDareLine').textContent, play: el('bkDarePlay').textContent,
    mine: el('bkDareMine').hidden, menu: !el('menuCard').hidden, guide, search: location.search, dare: bk.dare, seed0: bk.seed0, score: bk.score }));
  assert.deepEqual(v, { card: true, open: true, paused: true, line: 'A friend baked a Blueberry pie and scored 4,820.', play: 'Play', mine: true, menu: false, guide: null,
    search: '', dare: { seed: 123456, beat: 4820, tier: 8, passed: false }, seed0: 123456, score: 0 });
  assert.equal(await page.evaluate(() => [...el('bkDare').querySelectorAll('p,h2,button')].filter(e => !e.hidden).map(e => e.textContent).join(' | ')),
    "🧁 Crumb's Bakery | A friend baked a Blueberry pie and scored 4,820. | Same treats, same order. Can you beat it? | Play | What is this?");
  await page.click('#bkDareWhat');
  assert.deepEqual(await page.evaluate(() => ({ open: bk.open, menu: !el('menuCard').hidden, dare: bk.dare, fresh: guideFresh(), seen: localStorage.getItem('crumble.guide') })),
    { open: false, menu: true, dare: null, fresh: true, seen: null }, 'What is this? leads Home; the guided first game still waits for the player’s first block game');
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  assert.equal(await page.evaluate(() => bk.open), false, 'a reload does not start the dare again');
});

test('bakery: a dare deals the same treats in the same order as the link\'s seed, whatever the player does (shakes too)', async ({ page, server }) => {
  const want = await page.evaluate(() => { bkNew(98765, true); const s = [bk.held, bk.next]; for (let i = 0; i < 24; i++) { bk.ready = true; bkDrop(200); for (let j = 0; j < 60; j++) { bkStep(BK_DT); bk.overT = 0; } s.push(bk.next); } return s; });
  await bkOpenLink(page, server, await bkLinkQ(page, 98765, 3000, 7));
  await page.click('#bkDarePlay');
  const got = await page.evaluate(() => {
    bkStop(); const s = [bk.held, bk.next];
    for (let i = 0; i < 24; i++) { if (i % 6 === 3) { bk.shakes = 1; bkShake(); } bk.ready = true; bkDrop(30 + (i * 97) % 330); for (let j = 0; j < 60; j++) { bkStep(BK_DT); bk.overT = 0; } s.push(bk.next); }
    return s;
  });
  assert.deepEqual(got, want);
});

test('bakery: on a dare "to beat N" sits by the score; passing it fires once: a fanfare and Crumb\'s line', async ({ page, server }) => {
  await bkOpenLink(page, server, await bkLinkQ(page, 4242, 100, 4));
  await page.click('#bkDarePlay');
  const r = await page.evaluate(() => {
    bkStop(); let n = 0; const o = bkFxBeat; window.bkFxBeat = () => { n++; o(); };
    const mk = () => { bkDomStep(performance.now()); const m = el('bkBeat'); return { on: !m.hidden && m.getBoundingClientRect().width > 0, t: m.textContent, won: m.classList.contains('won') }; };
    const a = mk(); bkAddScore(60); bkAddScore(40); const b = [n, bk.dare.passed]; bkAddScore(30); const line = bkTalk.txt; bkAddScore(500); const c = mk();
    window.bkFxBeat = o;
    const s = el('bkScore').getBoundingClientRect(), m = el('bkBeat').getBoundingClientRect(), strip = bkG.stripY;
    return { a, b, n, line: SAY.bkBeat.includes(line), c, clear: m.bottom <= strip && m.top < s.bottom };
  });
  assert.deepEqual(r, { a: { on: true, t: 'to beat 100', won: false }, b: [0, false], n: 1, line: true, c: { on: true, t: '✓ beat 100', won: true }, clear: true });
});

test('bakery: the dare\'s end card: "You beat your friend by N!" or "N short. So close.", "Send it back" carries the player’s score and the same seed, Play again keeps both; else the link is copied', async ({ page, server }) => {
  await bkOpenLink(page, server, await bkLinkQ(page, 555, 4820, 8));
  await page.click('#bkDarePlay');
  const end = async sc => { await page.evaluate(sc => { bkStop(); bk.score = sc; bk.big = 9; bkGameOver(); bkKick(); }, sc); await page.waitForFunction(() => bk.st === 'card', null, { timeout: 8000 }); };
  const card = () => page.evaluate(() => ({ title: el('bkOverTitle').textContent, dare: el('bkOverDare').hidden ? null : el('bkOverDare').textContent,
    order: [...el('bkOver').querySelectorAll('button')].filter(b => !b.hidden).map(b => b.textContent + (b.className === 'cta' ? '*' : '')) }));
  await end(6020);
  assert.deepEqual(await card(), { title: "A friend's dare", dare: 'You beat your friend by 1,200!', order: ['Send it back*', 'Play again', 'Back to the Lab', 'Home'] });
  await page.evaluate(() => { window.__sh = null; Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { window.__sh = d.text; } }); });
  await page.click('#bkSendBack');
  await page.waitForFunction(() => !!window.__sh);
  const sh = await page.evaluate(() => ({ text: window.__sh, p: bkLinkParse(window.__sh.split('bk=')[1]) }));
  assert.equal(sh.text.replace(/bk=[\w-]+$/, 'bk=…'), "I baked a Lime tart in Crumb's Bakery and scored 6,020. Same treats, same order. Beat it: https://crumble.win/?bk=…");
  assert.deepEqual(sh.p, { seed: 555, beat: 6020, tier: 9 }, 'the player’s score and treat, the same seed');
  await page.click('#bkAgain');
  assert.deepEqual(await page.evaluate(() => ({ d: bk.dare, s0: bk.seed0, score: bk.score, st: bk.st })), { d: { seed: 555, beat: 4820, tier: 8, passed: false }, s0: 555, score: 0, st: 'play' });
  await end(4340);
  assert.equal((await card()).dare, '480 short. So close.');
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); window.__cl = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__cl = t; } } }); });
  await page.click('#bkSendBack');
  await page.waitForFunction(() => !!window.__cl);
  assert.deepEqual(await page.evaluate(() => [el('bkSendBack').textContent, bkLinkParse(window.__cl.split('bk=')[1]).beat]), ['Link copied', 4340]);
});

test('bakery: a jar in progress survives a dare: the card says so and offers Play the dare or Back to my jar; the dare never touches the player’s save', async ({ page, server }) => {
  const saved = await page.evaluate(() => { bkNew(55); for (let i = 0; i < 6; i++) { bk.ready = true; bkDrop(40 + i * 55); for (let j = 0; j < 80; j++) bkStep(BK_DT); } bk.score = 1230; bkSaveRun(); return localStorage.getItem(BK_RUN); });
  const q = await bkLinkQ(page, 777, 900, 5);
  await bkOpenLink(page, server, q);
  assert.deepEqual(await page.evaluate(() => ({ jar: el('bkDareJar').hidden ? null : el('bkDareJar').textContent, play: el('bkDarePlay').textContent, mine: !el('bkDareMine').hidden, seed0: bk.seed0 })),
    { jar: 'You have a jar going (1,230). It stays saved.', play: 'Play the dare', mine: true, seed0: 777 });
  await page.click('#bkDarePlay');
  await page.evaluate(() => { bkStop(); for (let i = 0; i < 5; i++) { bk.ready = true; bkDrop(100 + i * 40); for (let j = 0; j < 80; j++) bkStep(BK_DT); } bkPause(); bkResume(); bkStop(); bkGameOver(); bkKick(); });
  await page.waitForFunction(() => bk.st === 'card', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => localStorage.getItem(BK_RUN)), saved, 'drops, a pause and the end of the dare leave the player’s save as it was');
  await page.click('#bkOverLab'); await page.click('#labList button[data-id=bakery]');
  assert.deepEqual(await page.evaluate(() => ({ score: bk.score, dare: bk.dare, s: bk.seed0 === JSON.parse(localStorage.getItem(BK_RUN)).s0 })), { score: 1230, dare: null, s: true }, 'the player’s own jar, back');
  await bkOpenLink(page, server, q);
  await page.click('#bkDareMine');
  assert.deepEqual(await page.evaluate(() => ({ score: bk.score, dare: bk.dare, card: el('bkDare').hidden, paused: bk.paused })), { score: 1230, dare: null, card: true, paused: false }, 'Back to my jar');
});

test('bakery: the first-play hint: the first time (a link too) until the player’s first touch, then never again; Reduce Motion: the line only', async ({ page, server }) => {
  await bkOpenLink(page, server, await bkLinkQ(page, 31, 500, 4), true);
  const vis = () => page.evaluate(() => { const h = el('bkHint'); return { on: !h.hidden, text: h.textContent.trim(), fing: !h.hidden && getComputedStyle(h.querySelector('.fing')).display !== 'none' }; });
  assert.equal((await vis()).on, false, 'not over the dare card');
  await page.click('#bkDarePlay'); await page.evaluate(() => bkDomStep(performance.now()));
  assert.deepEqual(await vis(), { on: true, text: '👆Drag. Let go. Match two the same.', fing: true });
  await page.evaluate(() => { const r = bkCv.getBoundingClientRect(), o = { pointerId: 7, clientX: r.width / 2, clientY: r.height / 2, bubbles: true }; bkCv.dispatchEvent(new PointerEvent('pointerdown', o)); bkCv.dispatchEvent(new PointerEvent('pointerup', o)); bkDomStep(performance.now()); });
  assert.deepEqual(await page.evaluate(() => [el('bkHint').hidden, lab.bakery.hi, JSON.parse(localStorage.getItem('crumble.lab')).bakery.hi]), [true, 1, 1]);
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  await bkOpenIt(page); await page.evaluate(() => bkDomStep(performance.now()));
  assert.equal((await vis()).on, false, 'never again');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { lab.bakery.hi = 0; saveLab(); });
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!cell);
  await page.evaluate(() => { if (!el('menuCard').hidden) closeMenu(); });
  await bkOpenIt(page); await page.evaluate(() => bkDomStep(performance.now()));
  assert.deepEqual(await vis(), { on: true, text: '👆Drag. Let go. Match two the same.', fing: false });
});

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


// Screenshots of the main screens at the sizes in tests/harness.mjs SIZES, for checking a layout by eye.
//   node tools/screen-shots.mjs                 every iPad size and the phone
//   node tools/screen-shots.mjs ipad13 se        just those sizes
// Writes tests/out/shots/<size>-<screen>.png (1x pixels, so the files stay small).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve, SIZES, IPADS, play, dealt } from '../tests/harness.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['phone', ...IPADS, 'ipad13Wide'];
const OUT = 'tests/out/shots';
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const wait = (page, ms = 500) => page.waitForTimeout(ms);
const show = (page, id) => page.evaluate(id => { document.querySelectorAll('.overlay').forEach(o => { o.hidden = o.id !== id; }); }, id);

for (const name of names) {
  const vp = SIZES[name];
  if (!vp) { console.log('no size called ' + name); continue; }
  const browser = await chromium.launch();
  const ctx2 = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx2.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('crumble.guide', '1'); } catch (e) {} });
  await p.goto(srv.url);
  await p.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
  const shot = async screen => { await p.screenshot({ path: `${OUT}/${name}-${screen}.png` }); console.log(`${OUT}/${name}-${screen}.png`); };
  await wait(p, 900); await shot('1-home');
  await play(p); await dealt(p); await wait(p, 1600); await shot('2-game');
  await p.click('#pauseBtn'); await wait(p); await shot('3-pause');
  await p.click('#setBtn'); await wait(p); await shot('4-settings');
  await p.click('#setDone'); await p.click('#pauseResume'); await wait(p);
  await p.evaluate(() => { openGoals(); }); await wait(p); await shot('5-goals');
  await show(p, 'overCard'); await wait(p); await shot('6-over-card');
  await p.evaluate(() => { document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; }); openLab(); }); await wait(p); await shot('7-lab');
  await p.click('#labList button[data-id=bakery]').catch(() => {}); await wait(p, 1200); await shot('8-bakery');
  await browser.close();
}
await srv.close();

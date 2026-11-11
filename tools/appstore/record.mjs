// Records a bot game frame by frame with a manual clock. Usage: node record.mjs seed drops outdir [scale]
import fs from 'node:fs';
import { serve } from '../../tests/harness.mjs';
import { chromium } from 'playwright';
const [seed = 1, drops = 24, out = '/tmp/claude-0/shots/run', scale = 3] = process.argv.slice(2);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const SEED = `(()=>{let a=${seed}>>>0;Math.random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};})();`;
const CLOCK = `(()=>{let T=1000;const q=[];window.requestAnimationFrame=cb=>{q.push(cb);return q.length};window.cancelAnimationFrame=()=>{};performance.now=()=>T;
window.__step=n=>{for(let k=0;k<n;k++){T+=1000/60;const c=q.splice(0);for(const f of c){try{f(T)}catch(e){console.error(e)}}}};})();`;
const srv = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 443, height: 960 }, deviceScaleFactor: +scale, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', String(e)));
await page.addInitScript(SEED); await page.addInitScript(CLOCK);
await page.addInitScript(() => { try { localStorage.setItem('crumble.guide', '1'); } catch (e) {} });   // a returning player: no guided first game
await page.goto(srv.url);
await page.waitForFunction(() => typeof state !== 'undefined' && state === 'idle' && !!cell);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { const pb = pushBanner; pushBanner = function (t) { if (t === 'GOAL REACHED') return; return pb.apply(this, arguments); }; });
let f = 0; const log = [];
const shot = async (tag = '') => {
  const p = `${out}/f${String(f).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: p, type: 'jpeg', quality: 92 });
  const s = await page.evaluate(() => ({ best, chaseBest, state, score, combo, lines: stats.lines, fill: grid.flat().filter(Boolean).length, golden: !!golden }));
  log.push({ f, tag, ...s }); f++;
};
const step = n => page.evaluate(n => __step(n), n);
const run = async (frames, tag) => { for (let k = 0; k < frames; k++) { await step(2); await shot(tag); } };   // 30 fps capture of a 60 fps game
// home screen
await page.waitForTimeout(2500);   // CSS logo drop-in runs on real time
await run(+(process.env.HOME_F||45), 'home');
await page.evaluate(b => { best = b; chaseBest = b; }, +(process.env.BEST||2400));
await page.click(process.env.START||'#startBtn'); await page.waitForFunction(() => state === 'play');
await run(25, 'start');
for (let d = 0; d < drops; d++) {
  await page.evaluate(() => { if (dealing) { runSteps(dealing.it); } });
  const m = await page.evaluate(() => {
    const [lo0, hi0] = packBits(packGrid(grid)); const left0 = [0, 1, 2].filter(i => tray[i]);
    const value = (lo, hi, left, lines) => { for (const i of left) if (!placeMasks(tray[i].s).some(m => !(lo & m.lo) && !(hi & m.hi))) return -1000 + lines; return roomBits(lo, hi) * 60 + lines * 60 - roughBits(lo, hi) * 0.3; };
    let beam = [{ lo: lo0, hi: hi0, left: left0, lines: 0, first: null }], best = null;
    while (beam.length && beam[0].left.length) { const next = [];
      for (const st of beam) for (const i of st.left) { const s = tray[i].s;
        for (const m of placeMasks(s)) { if ((st.lo & m.lo) || (st.hi & m.hi)) continue;
          const l = applyBits(st.lo, st.hi, s, m), left = st.left.filter(j => j !== i);
          const n = { lo: _lo, hi: _hi, left, lines: st.lines + l, first: st.first || [i, m.r, m.c] }; n.v = value(n.lo, n.hi, left, n.lines); next.push(n); } }
      next.sort((a, b) => b.v - a.v); beam = next.slice(0, 10); if (beam.length && (!best || beam[0].v > best.v || beam[0].left.length === 0)) best = beam[0]; }
    if (!best) return null;
    const [i, r, c] = best.first, s = tray[i].s, R = slotRect(i);
    return { i, r, c, from: { x: R.x + R.w / 2, y: R.y + R.h / 2 }, to: { x: bx + (c + s.cols / 2) * cell, y: by + (r + s.rows) * cell + cell * CFG.LIFT } };
  });
  if (!m) { console.log('stuck at drop', d); break; }
  await page.mouse.move(m.from.x, m.from.y); await page.mouse.down(); await run(2, 'pick');
  const N = 9;
  for (let k = 1; k <= N; k++) { const e = 1 - Math.pow(1 - k / N, 3); await page.mouse.move(m.from.x + (m.to.x - m.from.x) * e, m.from.y + (m.to.y - m.from.y) * e); await run(1, 'drag'); }
  await run(2, 'hover'); await page.mouse.up();
  await run(16, 'drop');
}
await run(30, 'end');
fs.writeFileSync(`${out}/log.json`, JSON.stringify(log));
console.log('frames', f, 'final', log.at(-1));
await browser.close(); await srv.close();

// Draws og-image.png (1200x630), the picture link previews show. Same sky and gold board as the share card.
//   node tools/make-og.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icon-512.png')).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent('<canvas id=c width=1200 height=630></canvas>');
const png = await page.evaluate(async (icon) => {
  const cv = document.getElementById('c'), g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 630); sky.addColorStop(0, '#7E9FBA'); sky.addColorStop(1, '#34495F');
  g.fillStyle = sky; g.fillRect(0, 0, 1200, 630);
  // board on the right: a mostly-empty 8x8 with a few gold cells
  const n = 8, size = 440, x = 700, y = 95, cs = size / n, pad = cs * .08;
  g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.roundRect(x - 12, y - 12, size + 24, size + 24, 24); g.fill();
  const on = new Set(['7,0','7,1','7,2','7,3','7,5','7,6','7,7','6,0','6,1','6,2','6,6','6,7','5,0','5,1','5,7','4,0','4,7','3,3','3,4']);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    g.fillStyle = on.has(r + ',' + c) ? '#FFD86B' : 'rgba(255,255,255,.08)';
    g.beginPath(); g.roundRect(x + c * cs + pad, y + r * cs + pad, cs - pad * 2, cs - pad * 2, cs * .22); g.fill();
  }
  const img = new Image(); img.src = icon; await img.decode();
  g.save(); g.beginPath(); g.roundRect(80, 90, 150, 150, 34); g.clip(); g.drawImage(img, 80, 90, 150, 150); g.restore();
  const f = '"Helvetica Neue", Arial, sans-serif';
  g.fillStyle = '#fff'; g.textAlign = 'left';
  g.font = '800 120px ' + f; g.fillText('Crumble', 76, 360);
  g.globalAlpha = .85; g.font = '600 36px ' + f;
  g.fillText('Drag shapes, clear lines,', 80, 430); g.fillText('chase clean sweeps.', 80, 478); g.globalAlpha = 1;
  g.font = '700 38px ' + f; g.fillStyle = '#FFD86B'; g.fillText('crumble.win', 80, 560);
  return cv.toDataURL('image/png').split(',')[1];
}, icon);
fs.writeFileSync(path.join(ROOT, 'og-image.png'), Buffer.from(png, 'base64'));
await browser.close();
console.log('og-image.png written');

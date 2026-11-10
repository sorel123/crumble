// Composes captioned App Store screenshots (1320x2868). Usage: node compose.mjs spec.json outdir
import fs from 'node:fs';
import { chromium } from 'playwright';
const [specFile, out] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
for (const [n, s] of spec.entries()) {
  const img = 'data:image/jpeg;base64,' + fs.readFileSync(s.img).toString('base64');
  await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1320px;height:2868px;overflow:hidden}
body{background:radial-gradient(120% 60% at 50% 0%,${s.glow||'#5b2a86'} 0%,#2a1446 45%,#150B26 100%);font-family:Fredoka,sans-serif;color:#fff;text-align:center}
h1{margin:150px 60px 0;font-size:124px;font-weight:700;line-height:1.02;letter-spacing:-1px;text-shadow:0 6px 0 rgba(0,0,0,.25)}
h1 em{font-style:normal;color:#ffd35c}
p{margin:26px 80px 0;font-size:54px;font-weight:500;opacity:.82}
.ph{position:absolute;left:50%;top:${s.top||520}px;transform:translateX(-50%);width:1060px;height:2297px;border-radius:92px;
 background:#0b0614;padding:22px;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 4px rgba(255,255,255,.12)}
.ph img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:72px;display:block}
</style></head><body><h1>${s.title}</h1><p>${s.sub}</p><div class="ph"><img src="${img}"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const name = `${out}/${String(n + 1).padStart(2, '0')}-${s.slug}.png`;
  await page.screenshot({ path: name });
  console.log(name);
}
await browser.close();

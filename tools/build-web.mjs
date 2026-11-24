// Builds the public website into site/: only the files a visitor needs (the game, its service worker, music,
// the privacy and support pages). Tests, tools, notes and the iOS project are left out.
//   npm run build:web      (Cloudflare Pages: build command "npm run build:web", output directory "site")
// site/ is generated and git-ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = JSON.parse(sw.match(/const ASSETS=(\[.*?\]);/s)[1]).filter(a => a !== './');
const extra = ['sw.js', 'music', 'privacy', 'support', 'site.css', 'og-image.png'];
for (const a of [...assets, ...extra]) fs.cpSync(path.join(ROOT, a), path.join(OUT, a), { recursive: true });
console.log(`site/ built: ${assets.length} game files + ${extra.join(', ')}`);

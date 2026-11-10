// Copies the game into www/, the folder Capacitor wraps into the iPhone app (webDir in capacitor.config.json).
//   npm run build:www
// The web build is unchanged: GitHub Pages still serves the repo root. www/ is generated and git-ignored.
// sw.js is left out on purpose: the app ships its files inside, so it has nothing to cache or update
// (js/update.js already does nothing outside http/https).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = JSON.parse(sw.match(/const ASSETS=(\[.*?\]);/s)[1]).filter(a => a !== './');
for (const a of [...assets, 'music']) {                       // the precache list + the lazily fetched music folder
  fs.cpSync(path.join(ROOT, a), path.join(OUT, a), { recursive: true });
}
console.log(`www/ built: ${assets.length} files + music/`);

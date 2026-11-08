// Keeps sw.js's ASSET_HASH in step with the files it precaches.
//   npm run stamp        rewrite the hash
//   node tools/stamp-sw.mjs --check   exit 1 if it is stale (npm test runs this)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(ROOT, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const assets = JSON.parse(sw.match(/const ASSETS=(\[.*?\]);/s)[1]);

export const expectedAssets = () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  return { assets, scripts };
};

const h = crypto.createHash('sha256');
for (const a of assets) {
  if (a === './') continue;
  h.update(a + '\0'); h.update(fs.readFileSync(path.join(ROOT, a)));
}
export const hash = h.digest('hex').slice(0, 10);
const current = sw.match(/const ASSET_HASH='([^']*)'/)[1];

if (process.argv.includes('--check')) {
  if (current !== hash) { console.error(`sw.js ASSET_HASH is stale (${current}, files hash to ${hash}). Run: npm run stamp`); process.exit(1); }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(swPath, sw.replace(/const ASSET_HASH='[^']*'/, `const ASSET_HASH='${hash}'`));
  console.log(`sw.js ASSET_HASH = ${hash}`);
}

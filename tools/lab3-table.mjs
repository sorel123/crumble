// Regenerates the Lab's "Clear it in three" puzzle table (L3_TABLE in js/lab.js) from the game's own generator.
//   node tools/lab3-table.mjs          rewrite the table in js/lab.js
//   node tools/lab3-table.mjs --check  only say whether the table still matches the generator
// The generator (l3MakeAll in js/lab.js) is deterministic: puzzle k is built from seeds derived from k alone. It is too
// slow to run on a phone when a puzzle opens (a few seconds for all 60 on a laptop), so the game reads this table and a
// test checks the table against the generator. Changing the generator changes the puzzles everyone plays: on purpose only.
// Needs Playwright (npm install).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, openGame } from '../tests/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'js', 'lab.js');
const srv = await serve();
const { browser, page } = await openGame(srv.url);
const all = await page.evaluate(() => l3MakeAll());
const stale = await page.evaluate(t => JSON.stringify(t) !== JSON.stringify(L3_TABLE), all);
await browser.close(); await srv.close();

if (process.argv.includes('--check')) { console.log(stale ? 'L3_TABLE is stale: run node tools/lab3-table.mjs' : 'L3_TABLE matches the generator'); process.exit(stale ? 1 : 0); }
const body = 'const L3_TABLE=[\n' + all.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n];';
const src = fs.readFileSync(FILE, 'utf8').replace(/const L3_TABLE=\[[\s\S]*?\n?\];/, body);
fs.writeFileSync(FILE, src);
console.log(stale ? 'L3_TABLE rewritten (' + all.length + ' puzzles)' : 'L3_TABLE already matched; rewritten anyway');

// Creates Crumble's Game Center leaderboards and achievements in App Store Connect, through its API.
//   node tools/gc-setup.mjs --dry-run                       # print what it would make, touch nothing
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_FILE=~/AuthKey_XXXX.p8 node tools/gc-setup.mjs
// Needs: the app record for win.crumble.app in App Store Connect, and an API key (Users and Access ->
// Integrations -> App Store Connect API, role App Manager). The .p8 key stays on the Mac; never commit it.
// Safe to run again: anything whose id already exists is left alone.
// The ids must match GC in js/native.js. Achievement names come from GOAL_FAMILIES in js/goals.js, so the two
// never drift. Achievement images are not uploaded here; Apple only needs them for App Store review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const BUNDLE = 'win.crumble.app';
const API = 'https://api.appstoreconnect.apple.com/v1';

/* ── what to make ── */
const src = fs.readFileSync(path.join(ROOT, 'js/goals.js'), 'utf8');
const famSrc = src.match(/const GOAL_FAMILIES=(\[[\s\S]*?\n\]);/)[1];
const FAMILIES = new Function('return ' + famSrc)();          // val() closures are never called here
const native = fs.readFileSync(path.join(ROOT, 'js/native.js'), 'utf8');
const BEST = native.match(/BEST:'([^']+)'/)[1], DAILY = native.match(/DAILY:'([^']+)'/)[1];
const ACH_PREFIX = native.match(/ach:id=>'([^']+)'/)[1];

const LEADERBOARDS = [
  { id: BEST, name: 'Best score', recurring: false },
  { id: DAILY, name: 'Daily', recurring: true }
];
const ACHIEVEMENTS = [];
for (const f of FAMILIES) f.rungs.forEach((n, i) => {
  const text = f.text(n);
  ACHIEVEMENTS.push({ id: ACH_PREFIX + f.id + '.' + n, name: text, desc: text + '.', points: Math.min(50, 10 * (i + 1)) });
});
const total = ACHIEVEMENTS.reduce((s, a) => s + a.points, 0);
if (total > 1000) throw new Error('Game Center allows 1000 achievement points in all; this plan has ' + total);

if (DRY) {
  console.log('Leaderboards:'); LEADERBOARDS.forEach(l => console.log('  ' + l.id + '  "' + l.name + '"' + (l.recurring ? '  (resets daily)' : '')));
  console.log(`Achievements (${ACHIEVEMENTS.length}, ${total} points):`);
  ACHIEVEMENTS.forEach(a => console.log(`  ${a.id.padEnd(30)} ${String(a.points).padStart(3)}  "${a.name}"`));
  process.exit(0);
}

/* ── App Store Connect API ── */
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_FILE } = process.env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_FILE) { console.error('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_FILE (or use --dry-run).'); process.exit(1); }
const key = fs.readFileSync(ASC_KEY_FILE.replace(/^~/, process.env.HOME), 'utf8');
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return head + '.' + body + '.' + sig;
}
// Apple's API sometimes stalls or answers 500. Reads are retried; a write that fails is not (it may have
// landed), so the run stops and a re-run picks up where it left off: existing ids are skipped and any
// missing en-US localization is filled in.
async function api(method, url, data, tries = method === 'GET' ? 4 : 1) {
  let res;
  try {
    res = await fetch(url.startsWith('http') ? url : API + url, {
      method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify({ data }) : undefined, signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    if (tries > 1) { await new Promise(r => setTimeout(r, 3000)); return api(method, url, data, tries - 1); }
    throw new Error(`${method} ${url} -> no answer (${e.cause?.code || e.name}). Run the script again; it skips what is already made.`);
  }
  if (res.status >= 500 && tries > 1) { await new Promise(r => setTimeout(r, 3000)); return api(method, url, data, tries - 1); }
  const text = await res.text(), json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${(json.errors || []).map(e => e.detail || e.title).join('; ') || text}`);
  return json;
}
async function all(url) {                                   // follows paging
  const out = []; let next = url;
  while (next) { const j = await api('GET', next); out.push(...j.data); next = j.links && j.links.next; }
  return out;
}
const rel = (type, id) => ({ data: { type, id } });

const apps = (await api('GET', '/apps?filter[bundleId]=' + BUNDLE)).data;
if (!apps.length) { console.error('No App Store Connect app with bundle id ' + BUNDLE + '. Make the app record first.'); process.exit(1); }
const appId = apps[0].id;

let detail = (await api('GET', `/apps/${appId}/gameCenterDetail`).catch(() => ({ data: null }))).data;
if (!detail) {
  detail = (await api('POST', '/gameCenterDetails', { type: 'gameCenterDetails', relationships: { app: rel('apps', appId) } })).data;
  console.log('Game Center switched on for the app');
}

const hasLocale = async url => (await all(url)).some(d => d.attributes.locale === 'en-US');
const haveLb = new Map((await all(`/gameCenterDetails/${detail.id}/gameCenterLeaderboards?limit=200`)).map(d => [d.attributes.vendorIdentifier, d.id]));
const lbLocale = (id, name) => api('POST', '/gameCenterLeaderboardLocalizations', { type: 'gameCenterLeaderboardLocalizations', attributes: { locale: 'en-US', name }, relationships: { gameCenterLeaderboard: rel('gameCenterLeaderboards', id) } });
for (const l of LEADERBOARDS) {
  if (haveLb.has(l.id)) {
    const id = haveLb.get(l.id);
    if (await hasLocale(`/gameCenterLeaderboards/${id}/localizations`)) console.log('leaderboard ' + l.id + ' already there');
    else { await lbLocale(id, l.name); console.log('leaderboard ' + l.id + ' already there, name added'); }
    continue;
  }
  const attributes = { referenceName: l.name, vendorIdentifier: l.id, defaultFormatter: 'INTEGER', submissionType: 'BEST_SCORE', scoreSortType: 'DESC' };
  // starts at the next local midnight (Apple refuses a start in the past), so it resets at midnight on this Mac's clock
  if (l.recurring) Object.assign(attributes, { recurrenceStartDate: new Date(new Date(new Date().toDateString()).getTime() + 864e5).toISOString(), recurrenceDuration: 'PT24H', recurrenceRule: 'FREQ=DAILY' });
  const lb = (await api('POST', '/gameCenterLeaderboards', { type: 'gameCenterLeaderboards', attributes, relationships: { gameCenterDetail: rel('gameCenterDetails', detail.id) } })).data;
  await lbLocale(lb.id, l.name);
  console.log('leaderboard ' + l.id + ' made');
}

const haveAch = new Map((await all(`/gameCenterDetails/${detail.id}/gameCenterAchievements?limit=200`)).map(d => [d.attributes.vendorIdentifier, d.id]));
const achLocale = (id, a) => api('POST', '/gameCenterAchievementLocalizations', { type: 'gameCenterAchievementLocalizations',
  attributes: { locale: 'en-US', name: a.name, beforeEarnedDescription: a.desc, afterEarnedDescription: a.desc },
  relationships: { gameCenterAchievement: rel('gameCenterAchievements', id) } });
for (const a of ACHIEVEMENTS) {
  if (haveAch.has(a.id)) {
    const id = haveAch.get(a.id);
    if (await hasLocale(`/gameCenterAchievements/${id}/localizations`)) console.log('achievement ' + a.id + ' already there');
    else { await achLocale(id, a); console.log('achievement ' + a.id + ' already there, name added'); }
    continue;
  }
  const ach = (await api('POST', '/gameCenterAchievements', { type: 'gameCenterAchievements',
    attributes: { referenceName: a.name, vendorIdentifier: a.id, points: a.points, showBeforeEarned: true, repeatable: false },
    relationships: { gameCenterDetail: rel('gameCenterDetails', detail.id) } })).data;
  await achLocale(ach.id, a);
  console.log('achievement ' + a.id + ' made');
}
console.log('Done.');

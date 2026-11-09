// Crumble service worker: caches the game so it launches offline, and waits (never takes over
// mid-run) when a new version is deployed. js/update.js shows the "Update ready" toast.
//
// ASSET_HASH must change whenever a precached file changes, or phones keep the old game.
// `npm run stamp` rewrites it; `npm test` fails if it is stale.
const ASSET_HASH='978eee8638';
const CACHE='crumble-'+ASSET_HASH;
const ASSETS=["./","index.html","manifest.json","icon-120.png","icon-152.png","icon-180.png","icon-192.png","icon-512.png","js/config.js","js/worlds.js","js/shapes.js","js/solver.js","js/render.js","js/samples.js","js/audio.js","js/game.js","js/draw.js","js/flow.js","js/save.js","js/modes.js","js/goals.js","js/share.js","js/ui.js","js/admin.js","js/main.js","js/update.js"];

self.addEventListener('install',e=>{
  // `reload` skips the browser HTTP cache, so a new version never precaches a stale file.
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(a=>new Request(a,{cache:'reload'})))));
});

self.addEventListener('message',e=>{ if(e.data==='skipWaiting') self.skipWaiting(); });

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('crumble-') && k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const req=e.request, url=new URL(req.url);
  if(req.method!=='GET' || url.origin!==location.origin) return;     // the web font goes straight to the network
  e.respondWith(caches.open(CACHE).then(async c=>
    (await c.match(req,{ignoreSearch:true}))                         // ?dev still hits the cached index.html
    || (req.mode==='navigate' && await c.match('index.html'))
    || fetch(req)));
});

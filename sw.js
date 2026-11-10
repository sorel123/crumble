// Crumble service worker: caches the game so it launches offline, and waits (never takes over
// mid-run) when a new version is deployed. js/update.js shows the "Update ready" toast.
//
// ASSET_HASH must change whenever a precached file changes, or phones keep the old game.
// `npm run stamp` rewrites it; `npm test` fails if it is stale.
const ASSET_HASH='4b86c7d0e4';
const CACHE='crumble-'+ASSET_HASH;
const MUSIC_CACHE='crumble-music';          // recorded loops (7.4): fetched when first played, kept across game updates (rename a file if its audio changes)
const ASSETS=["./","index.html","manifest.json","icon-120.png","icon-152.png","icon-180.png","icon-192.png","icon-512.png","js/config.js","js/native.js","js/worlds.js","js/shapes.js","js/solver.js","js/render.js","js/samples.js","js/audio.js","js/music.js","js/game.js","js/draw.js","js/flow.js","js/save.js","js/timelapse.js","js/modes.js","js/mascot.js","js/home.js","js/goals.js","js/share.js","js/ui.js","js/admin.js","js/main.js","js/update.js"];

self.addEventListener('install',e=>{
  // `reload` skips the browser HTTP cache, so a new version never precaches a stale file.
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(a=>new Request(a,{cache:'reload'})))));
});

self.addEventListener('message',e=>{ if(e.data==='skipWaiting') self.skipWaiting(); });

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('crumble-') && k!==CACHE && k!==MUSIC_CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const req=e.request, url=new URL(req.url);
  if(req.method!=='GET' || url.origin!==location.origin) return;     // the web font goes straight to the network
  if(url.pathname.includes('/music/')){                              // lazy: cached the first time a loop is played
    e.respondWith(caches.open(MUSIC_CACHE).then(async c=>{
      const hit=await c.match(req); if(hit) return hit;
      const res=await fetch(req); if(res.ok) c.put(req,res.clone()); return res; }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c=>
    (await c.match(req,{ignoreSearch:true}))                         // ?dev still hits the cached index.html
    || (req.mode==='navigate'                                         // other pages (crumble.win/privacy/, /support/) load from the
        ? fetch(req).catch(()=>c.match('index.html'))                 // network; the game is the fallback only when offline
        : fetch(req))));
});

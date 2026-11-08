// Crumble — Offline + "Update ready" toast.
// Plain script, loaded last by index.html; shares globals with the other js/ files.
// sw.js keeps a versioned cache so the game launches offline. A new deploy installs in the
// background and waits; this shows a toast (never mid-run) and swaps on tap, so a deploy
// reaches the phone without force-quitting the home-screen web clip.
(function(){
  if(!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const toast=el('updateToast');
  let reg=null, tapped=false;

  const sync=()=>{ toast.hidden=!(reg && reg.waiting && navigator.serviceWorker.controller && state!=='play'); };

  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(tapped) location.reload(); });
  toast.addEventListener('click',()=>{
    if(!reg || !reg.waiting) return;
    tapped=true; toast.hidden=true;
    reg.waiting.postMessage('skipWaiting');
  });

  navigator.serviceWorker.register('sw.js').then(r=>{
    reg=r;
    r.addEventListener('updatefound',()=>{
      const w=r.installing;
      if(w) w.addEventListener('statechange',sync);
    });
    sync();
  }).catch(()=>{});                                   // no service worker just means no offline play

  setInterval(sync,1000);                              // a run in progress holds the toast back until it ends
  document.addEventListener('visibilitychange',()=>{   // a web clip resumes without reloading: look for a deploy
    if(document.visibilityState==='visible' && reg) reg.update().catch(()=>{});
  });
})();

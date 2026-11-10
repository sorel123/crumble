// Crumble — Native bridge (Capacitor iPhone app). A no-op everywhere else.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
// The web build never touches Capacitor: `Native.on()` is false in a browser, so every call returns at once.
// Inside the app, Capacitor injects window.Capacitor and the native plugins (Haptics, later Game Center);
// they are looked up at call time so nothing here can fail at load.
const Native={
  on(){ const c=window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); },
  plugin(name){ const c=window.Capacitor; return this.on() && c.Plugins && c.Plugins[name] || null; }
};

/* ═══════ haptics: the game's sound events, felt. One buzz per moment, the strongest one wins ═══════ */
// kind -> [priority, impact style | notification type, optional follow-up after ms]
const HAPTIC={
  pickup:    [1,'LIGHT'],
  place:     [2,'MEDIUM'],
  clear:     [3,'MEDIUM'],
  combo:     [4,'HEAVY'],
  deny:      [3,'WARNING'],
  rescue:    [5,'SUCCESS'],
  praise:    [5,'SUCCESS'],
  achieve:   [5,'SUCCESS'],
  bonusReady:[5,'SUCCESS'],
  star:      [6,'HEAVY'],
  phew:      [6,'SUCCESS'],
  bonusStart:[6,'HEAVY'],
  fanfare:   [7,'SUCCESS',140],
  sweep:     [7,'HEAVY',140],
  goldenWin: [7,'SUCCESS',140]
};
const NOTIFY={SUCCESS:1,WARNING:1,ERROR:1};
let hapQ=null, hapLast=0;
function haptic(kind,arg){                              // called from the same places that call Sfx, via sfxEvent/Sfx.pickup/Sfx.place
  if(!CFG.HAPTICS || !Native.on()) return;
  const d=HAPTIC[kind]; if(!d) return;
  if(kind==='praise' && !(arg>=3)) return;              // small praise is just a word on screen, like its sound
  if(!hapQ){ hapQ=d; queueMicrotask(hapFlush); }        // everything in one tick (place + clear + combo) -> only the biggest
  else if(d[0]>hapQ[0]) hapQ=d;
}
function hapFlush(){
  const d=hapQ; hapQ=null; if(!d) return;
  const now=performance.now(); if(now-hapLast<35) return;   // never a machine-gun stutter
  hapLast=now; hapFire(d[1]);
  if(d[2]) setTimeout(()=>hapFire(d[1]==='SUCCESS'?'SUCCESS':'MEDIUM'),d[2]);
}
function hapFire(t){
  const h=Native.plugin('Haptics'); if(!h) return;
  try{ (NOTIFY[t]?h.notification({type:t}):h.impact({style:t}))?.catch?.(()=>{}); }catch(e){}
}

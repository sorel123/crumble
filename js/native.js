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

/* ═══════ Game Center (plan 5.3): leaderboards and achievements, iPhone app only ═══════
   Quiet: no sign-in sheet. The only buttons are "🏆 Leaderboards" (1.1 F) on the game-over card (Endless and Daily)
   and in Settings' footer, and they show only in the app while signed in (gcButtons). If the phone is signed in to Game Center, scores and reached goals
   go up in the background and show in Apple's Games app; otherwise nothing happens. The ids below must match
   the ones made in App Store Connect (HANDOFF.md, "Game Center"). */
const GC={
  BEST:'crumble.endless.best',            // classic leaderboard, all-time: the Endless best
  DAILY:'crumble.daily',                  // recurring leaderboard, resets daily: today's Daily score
  ach:id=>'crumble.goal.'+id.replace(':','.'),   // a goal rung "lines:25" -> achievement "crumble.goal.lines.25"
  on:false, sent:new Set()
};
function gcCall(method,arg){
  const p=Native.plugin('GameCenter'); if(!p) return Promise.resolve(null);
  try{ return p[method](arg).catch(()=>null); }catch(e){ return Promise.resolve(null); }
}
function gcStart(){                                  // once at launch, from main.js
  if(!Native.on()) return;
  gcCall('signIn').then(r=>gcSet(r));
  try{ Native.plugin('GameCenter')?.addListener('change',gcSet); }catch(e){}   // signed in or out in Settings while running
  document.addEventListener('visibilitychange',()=>{                          // back from the background: ask again
    if(document.visibilityState==='visible') gcCall('status').then(gcSet);
  });
}
function gcSet(r){
  if(!r) return;
  const on=!!r.signedIn;
  if(on && !GC.on){ GC.sent.clear(); GC.on=true; gcSync(); }   // newly signed in (maybe another player): send it all again
  else GC.on=on;
  gcButtons();
}
// "🏆 Leaderboards" (1.1 F): opens Game Center's own dashboard over the game. Only while signed in, in the app.
function gcButtons(){
  const on=GC.on&&Native.on(), b=document.getElementById('gcOverBtn'), s=document.getElementById('gcSetBtn');
  if(b) b.hidden=!(on&&(mode==='endless'||mode==='daily'));
  if(s) s.hidden=!on;
}
function gcShow(){ if(GC.on) gcCall('show'); }
function gcSync(){                                   // the Endless best and every goal reached so far; cheap, idempotent
  if(!GC.on) return;
  if(best>0) gcCall('submitScore',{id:GC.BEST,score:best});
  const ids=[...goals.done].filter(id=>!GC.sent.has(id));
  if(ids.length) gcCall('unlock',{ids:ids.map(GC.ach)}).then(r=>{ if(r&&r.sent) ids.forEach(id=>GC.sent.add(id)); });
}
function gcDaily(sc){ if(GC.on && sc>0) gcCall('submitScore',{id:GC.DAILY,score:sc}); }

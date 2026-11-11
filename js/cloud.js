// Crumble — iCloud backup of progress (plan 1.1 F), iPhone app only. A no-op everywhere else.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ iCloud key-value backup ═══════
   Progress, not runs: the best score, lifetime stats, goals and the streak, unlocked skins and discovered looks,
   Adventure records and Daily results. One JSON value under one key in the player's own iCloud key-value store
   (NSUbiquitousKeyValueStore, through the in-app CloudStore plugin, ios/App/App/CloudStore.swift). It never reaches us.
   No UI: a new phone (or a reinstall) signed in to the same Apple account picks her progress up by itself.

   Merge, never overwrite: on launch, when the app comes back to the front, when iCloud says another device changed
   it, and just before every write, the cloud copy is read and folded into this phone's progress:
   numbers by max, sets by union, per-level and per-day records by best (fewest pieces is the smallest one).
   So two phones played on the same day both keep everything, and neither can wipe the other.

   Writes ride on the saves that already happen (saveStats, saveGoals, saveAdv, recordDaily, saveSkinSave call
   cloudDirty) and go out at most once every CLOUD.WAIT ms, and right away when the app is hidden.
   Nothing is written before the first read has come back, so a fresh install can never push empty progress. */
const CLOUD={KEY:'progress', WAIT:5000, ready:false, timer:0, busy:null, last:''};
const cloudStore=()=>Native.plugin('CloudStore');
function cloudCall(method,arg){
  const p=cloudStore(); if(!p) return Promise.resolve(null);
  try{ return p[method](arg).catch(()=>null); }catch(e){ return Promise.resolve(null); }
}

// this phone's progress, as plain data
function cloudBlob(){
  return {v:1, sc:SCORE_SCALE, best:Math.max(best,state==='play'&&mode==='endless'?score:0), stats:{...stats},
    goals:{streak:{...goals.streak}, days:goals.days, done:[...goals.done].sort()},
    unlocked:[...unlocked].sort(), disc:[...discoveredWorlds].sort(), adv:adv.lv, daily:daily.d,
    chal:{s:chalRec.s, won:chalRec.won, gold:chalRec.gold}, gd:guideSeen()?1:0};
}

// Folds a cloud copy into this phone's progress. Returns true if anything here changed. Bad data changes nothing.
function cloudMerge(o){
  if(!o||o.v!==1||typeof o!=='object') return false;
  const k=isNum(o.sc)&&o.sc>0?SCORE_SCALE/o.sc:1;       // (8.0) a copy written at another points scale is rescaled
  const pts=n=>isInt(n,0,1e12)?Math.round(n*k):0;
  let ch=false;
  const up=(obj,key,v)=>{ if(v>obj[key]){ obj[key]=v; ch=true; } };
  if(isInt(o.best,0,1e12)&&pts(o.best)>best){ best=pts(o.best); ch=true; }
  if(o.stats&&typeof o.stats==='object') for(const key in stats){
    const v=o.stats[key]; if(isInt(v,0,1e12)) up(stats,key,key==='totalScore'?pts(v):v);
  }
  const g=o.goals;
  if(g&&typeof g==='object'){
    if(Array.isArray(g.done)) for(const id of g.done) if(typeof id==='string'&&/^\w+:\d+$/.test(id)&&!goals.done.has(id)){ goals.done.add(id); ch=true; }
    if(isInt(g.days,0,1e5)) up(goals,'days',g.days);
    const s=g.streak, me=goals.streak;
    if(s&&/^\d{4}-\d\d-\d\d$/.test(s.last||'')&&isInt(s.cur,0,1e5)&&isInt(s.best,0,1e5)){
      let cur=me.cur, last=me.last;
      if(s.last>me.last){ cur=me.last&&addDays(me.last,1)===s.last?Math.max(s.cur,me.cur+1):s.cur; last=s.last; }   // the later day wins; played on the day before it too? the run carries on
      else if(s.last===me.last) cur=Math.max(cur,s.cur);
      else if(addDays(s.last,1)===me.last) cur=Math.max(cur,s.cur+1);
      const bst=Math.max(me.best,s.best,cur);
      if(cur!==me.cur||last!==me.last||bst!==me.best){ goals.streak={cur,best:bst,last}; ch=true; }
    }
  }
  if(Array.isArray(o.unlocked)) for(const id of o.unlocked) if(!unlocked.has(id)&&SKINS.some(s=>s.id===id&&!s.event)){ unlocked.add(id); ch=true; }
  if(Array.isArray(o.disc)) for(const id of o.disc) if(!discoveredWorlds.has(id)&&TRANSFORMS[id]){ discoveredWorlds.add(id); ch=true; }
  if(o.adv&&typeof o.adv==='object') for(const id in o.adv){
    const d=o.adv[id]; if(!LEVELS[id-1]||!d) continue;
    const s=isInt(d.s,0,3)?d.s:0, p=isInt(d.p,0,1e4)?d.p:0, n=isInt(d.n,0,1e6)?d.n:0, f=isInt(d.f,0,1e6)?d.f:0;
    if(!(s||p||n||f)) continue;
    const r=advRec(id);
    up(r,'s',s); up(r,'n',n); up(r,'f',f);
    if(p&&(!r.p||p<r.p)){ r.p=p; ch=true; }                // fewest pieces: the smaller one is the better record
  }
  if(o.daily&&typeof o.daily==='object') for(const day in o.daily){
    const d=o.daily[day]; if(!/^\d{4}-\d\d-\d\d$/.test(day)||!d) continue;
    const s=pts(d.s), l=isInt(d.l,0,1e6)?d.l:0, n=isInt(d.n,0,1e6)?d.n:0;
    if(!(s||l||n)) continue;
    const r=daily.d[day]||(daily.d[day]={s:0,l:0,n:0});
    up(r,'s',s); up(r,'l',l); up(r,'n',n);
  }
  const c=o.chal;                                        // Challenge results (1.1 E): per seed by best, medal counts by max
  if(c&&typeof c==='object'){
    if(c.s&&typeof c.s==='object') for(const seed in c.s){
      const d=c.s[seed]; if(!d||!/^[\w-]{1,24}$/.test(seed)) continue;
      const b=pts(d.b), m=isInt(d.m,0,3)?d.m:0, n=isInt(d.n,0,1e6)?d.n:0, t=isInt(d.t,0,1e15)?d.t:0;
      if(!(b||n)) continue;
      const r=chalRec.s[seed]||(chalRec.s[seed]={b:0,m:0,n:0,t:0});
      up(r,'b',b); up(r,'m',m); up(r,'n',n); up(r,'t',t);
    }
    if(isInt(c.won,0,1e6)) up(chalRec,'won',c.won);
    if(isInt(c.gold,0,1e6)) up(chalRec,'gold',c.gold);
  }
  if(o.gd===1&&!guideSeen()){ guideMark(); ch=true; }   // (1.1 D) she has had the guided first game on another phone
  return ch;
}

// after a merge changed something: store it here, and let the screens that show it catch up
function cloudApply(){
  saveStats(); saveGoals(); saveAdv(); saveSkinSave(); saveChal();
  try{ localStorage.setItem(DAILY_STORE,JSON.stringify({v:1,d:daily.d})); }catch(e){}
  checkUnlocks(); checkGoals(false); gcSync(); syncHud();
  if(!el('menuCard').hidden) openMenu();
  if(!el('goalsCard').hidden) renderGoals();
}

// read the cloud copy and fold it in; then, if this phone has anything the cloud lacks, write it back
function cloudPull(){
  if(!cloudStore()) return Promise.resolve();
  if(CLOUD.busy) return CLOUD.busy;
  CLOUD.busy=cloudCall('get',{key:CLOUD.KEY}).then(r=>{
    if(!r){ CLOUD.busy=null; return; }                  // could not read: write nothing (it might be an older copy we would overwrite)
    let o=null; try{ o=r&&typeof r.value==='string'?JSON.parse(r.value):null; }catch(e){}
    if(cloudMerge(o)) cloudApply();
    CLOUD.ready=true; CLOUD.busy=null;
    const j=JSON.stringify(cloudBlob());
    if(r.value!==j) return cloudPut(j);
  });
  return CLOUD.busy;
}
function cloudPut(j){
  if(j===CLOUD.last) return Promise.resolve();
  return cloudCall('set',{key:CLOUD.KEY,value:j}).then(r=>{ if(r) CLOUD.last=j; });
}
// a save happened: write within CLOUD.WAIT ms (one write however many saves land in between)
function cloudDirty(){
  if(!CLOUD.ready||CLOUD.timer||!Native.on()) return;
  CLOUD.timer=setTimeout(cloudFlush,CLOUD.WAIT);
}
function cloudFlush(){
  clearTimeout(CLOUD.timer); CLOUD.timer=0;
  return cloudPull();                                  // read-merge-write: another phone may have written since
}
function cloudStart(){                                 // once at launch, from main.js, after progress has loaded
  const p=cloudStore(); if(!p) return;
  try{ p.addListener('change',()=>cloudPull()); }catch(e){}   // another device (or a new iCloud account) changed it
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){ if(CLOUD.timer) cloudFlush(); }
    else if(CLOUD.ready) cloudPull();
  });
  cloudPull();
}

// Crumble — Save and resume (plan 3.3): the run, the best score and lifetime stats.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ run snapshot ═══════
   snapshot() returns the whole run as plain JSON data; restore(o) puts it back and returns true, or false (and
   changes nothing) if the data does not look right. Both are pure with respect to storage. saveRun()/loadRun() are the
   localStorage side. Not captured: effects in flight (they are cosmetic) and a live transformation (it ends on resume). The bonus meter and a live bonus (trays left, points it added) are kept (plan 6.2).
   restore() never deals an opening: the saved board and tray are exactly what she left. */
const STATS_STORE='crumble.stats';   // the run's own key depends on the mode (modes.js: runStore)
function snapshot(){
  return {
    v:1,
    grid:grid.map(r=>r.map(g=>g?g.gi:-1)),
    tray:tray.map(t=>t?{s:t.s.star?-1:SHAPES.indexOf(t.s),gi:t.gi}:null),
    score, combo, tension, sweepCool, trayNo, rescuesUsed, bestBeaten, lastTier,
    carry:carry.map(s=>SHAPES.indexOf(s)).filter(i=>i>=0),
    golden:golden?{want:{...golden.want},got:{...golden.got},pts:golden.pts}:null,   // copies, so the snapshot does not move while the live hand goes on
    goldenNext, goldenCool, trayHadSweep, trayCombo, starForced, starCool, transformCool,
    bonusMeter, specialEnd,
    pace:{...pace},
    td:{st:tide.st,n:tide.n,len:tide.len},          // (1.1 G) the coaster's stretch
    hm:{ph:hdeal.ph,n:hdeal.n,len:hdeal.len},          // the home dealer's coaster (DEALER_HOME)
    wave:{n:wave.n,at:wave.at,due:wave.due?1:0,setups:setups.map(u=>({...u,dealt:u.dealt?1:0})),closerNext:closerNext?1:0,chaseNext:chaseNext?1:0,chaseCool,sr:sweepRun?sweepRun.n:-1,closerCool,dryN,bigHist:bigHist.slice(),closerTray:closerTray?1:0,trayClear:trayClear?1:0,jn:jack.n,ja:jack.at},   // (7.3)                                 // (6.1) the dealer's phase, so resume keeps the rhythm
    lv:mode==='adventure'&&lvl?{id:lvl.id,lines:lv.lines,pieces:lv.pieces,combo:lv.combo,swept:lv.swept?1:0}:mode==='daily'||mode==='challenge'?{id:0,lines:lv.lines,pieces:lv.pieces,combo:0,swept:0}:null,
    dk:mode==='daily'?dk:null,   // (4.1) this level run's counters
    ch:mode==='challenge'&&chal?{seed:chal.seed,deal:chal.deal,won:chal.won,beat:chal.beat||0,bt:chal.beaten?1:0}:null,   // (E1) the round's seed and its whole frozen deal
    bonus:bonus?{left:bonus.left,extra:bonus.extra}:null,
    jy:jJumps,                                        // (7.5b) sweeps this run: the journey sky's extra stages
    cb:chaseBest,                                     // (7.5e) the best this run chases (the live `best` is rewritten mid-run by saveStats)
    tl:tlSnap(),                                      // (7.5g) the timelapse's board pictures, capped (timelapse.js)
    gd:guide?{n:guide.n,ln:guide.ln,sw:guide.sw?1:0,dn:guide.dn}:null   // (1.1 D) the guided first game's lesson
  };
}
const isInt=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const isNum=v=>typeof v==='number'&&isFinite(v);
function validSnapshot(o){
  if(!o||o.v!==1||!Array.isArray(o.grid)||o.grid.length!==N||!Array.isArray(o.tray)||o.tray.length!==3) return false;
  if(!o.grid.every(r=>Array.isArray(r)&&r.length===N&&r.every(v=>isInt(v,-1,GEMS.length-1)))) return false;
  if(!o.tray.every(t=>t===null||(t&&isInt(t.s,-1,SHAPES.length-1)&&isInt(t.gi,0,GEMS.length-1)))) return false;
  if(!isInt(o.score,0,1e9)||!isInt(o.combo,0,1e4)||!isInt(o.trayNo,0,1e6)||!isInt(o.rescuesUsed,0,100)) return false;
  if(mode==='adventure'){ const l=o.lv; if(!(l&&LEVELS[l.id-1]&&isInt(l.lines,0,1e6)&&isInt(l.pieces,0,1e6)&&isInt(l.combo,0,1e4))) return false; }
  if(mode==='daily'&&!(typeof o.dk==='string'&&/^\d{4}-\d\d-\d\d$/.test(o.dk)&&o.lv&&isInt(o.lv.lines,0,1e6)&&isInt(o.lv.pieces,0,1e6))) return false;
  if(mode==='challenge'&&!(o.ch&&typeof o.ch.seed==='string'&&/^[\w-]{1,24}$/.test(o.ch.seed)&&validDeal(o.ch.deal)&&isInt(o.ch.won,0,3)&&o.lv&&isInt(o.lv.lines,0,1e6)&&isInt(o.lv.pieces,0,1e6))) return false;
  return isNum(o.tension)&&isNum(o.sweepCool);
}
function restore(o){
  if(!validSnapshot(o)) return false;
  cancelDeal(); clearRunFx(); stuck=false; hesVoid();   // a restored tray (resume) gives no hesitation sample
  grid=o.grid.map(r=>r.map(gi=>gi<0?null:{gi,t:1,f:0,l:0}));
  tray=o.tray.map(t=>t&&{s:t.s<0?STAR:SHAPES[t.s],gi:t.gi});
  score=o.score; combo=o.combo; comboMiss=0; tension=clamp(o.tension,0,1); sweepCool=Math.max(0,o.sweepCool|0); trayNo=o.trayNo;
  rescuesUsed=o.rescuesUsed; bestBeaten=!!o.bestBeaten; lastTier=typeof o.lastTier==='string'?o.lastTier:'—';
  carry=(Array.isArray(o.carry)?o.carry:[]).filter(i=>isInt(i,0,SHAPES.length-1)).map(i=>SHAPES[i]);
  golden=o.golden&&o.golden.want&&o.golden.got?{want:{...o.golden.want},got:{...o.golden.got},pts:o.golden.pts|0}:null;
  goldenReplan(); goldenArrive=999;                  // the plan is not stored: it is worked out again from the board and the pieces left
  goldenNext=!!o.goldenNext; goldenCool=Math.max(0,o.goldenCool|0); trayHadSweep=!!o.trayHadSweep;
  trayCombo=o.trayCombo|0; starForced=!!o.starForced; starCool=isInt(o.starCool,0,1e3)?o.starCool:0; transformCool=Math.max(0,o.transformCool|0);
  chaseBest=isInt(o.cb,0,1e9)?o.cb:best;            // (7.5e) older saves: the stored best
  jJumps=isInt(o.jy,0,99)?o.jy:0;                   // (7.5b) older saves: no jumps, the stage follows the score
  const gd=o.gd; guide=gd&&isInt(gd.n,1,GUIDE_LESSONS.length)?{n:gd.n,ln:isInt(gd.ln,0,99)?gd.ln:0,sw:!!gd.sw,dn:isInt(gd.dn,0,7)?gd.dn:0}:null; guideIdleT=performance.now();   // (1.1 D) resume mid-guide
  tlLoad(o.tl);                                     // (7.5g) after the grid is back: an older save starts its timelapse here
  resetWorld(); transformCool=Math.max(0,o.transformCool|0);   // (resetWorld clears the cooldown)
  renderPips();
  bonusMeter=isInt(o.bonusMeter,0,1e4)?Math.min(o.bonusMeter,CFG.BONUS_METER):0; bonusTag=null;
  specialEnd=isInt(o.specialEnd,-99,1e6)?o.specialEnd:-99;
  const pc=o.pace, PH=['calm','building','edge','recovery','relief'];   // (6.1) older saves have none: start calm
  pace=pc&&PH.includes(pc.ph)&&isInt(pc.n,0,1e6)&&isInt(pc.hold,0,99)&&isInt(pc.len,0,99)?{ph:pc.ph,n:pc.n,hold:pc.hold,len:pc.len}:{ph:'calm',n:0,hold:0,len:0};
  resetWave(); const w=o.wave;                       // (7.3) older saves have none: a fresh wave
  if(w&&isInt(w.n,0,1e6)&&isInt(w.at,1,99)&&Array.isArray(w.setups)&&isInt(w.closerCool,0,99)&&isInt(w.dryN,0,1e6)&&Array.isArray(w.bigHist)){
    wave={n:w.n,at:w.at,due:!!w.due}; closerNext=!!w.closerNext; chaseNext=!!w.chaseNext; chaseCool=Math.min(Math.max(w.chaseCool|0,0),99); sweepRun=w.sr>=0&&w.sr<9?{n:w.sr|0}:null; closerCool=w.closerCool; dryN=w.dryN; closerTray=!!w.closerTray; trayClear=!!w.trayClear;
    if(isInt(w.jn,0,1e6)&&isInt(w.ja,1,99)) jack={n:w.jn,at:w.ja};   // (8.2) the jackpot clock; older saves start a fresh one
    bigHist=w.bigHist.filter(v=>isInt(v,0,3)).slice(-4);
    setups=w.setups.filter(u=>u&&isInt(u.k,0,SETUP_RECTS.length-1)&&isInt(u.r,0,N-1)&&isInt(u.c,0,N-1)&&isInt(u.age,0,99)).slice(0,3)
      .filter(u=>u.r+SETUP_RECTS[u.k].rows<=N&&u.c+SETUP_RECTS[u.k].cols<=N).map(u=>({k:u.k,r:u.r,c:u.c,age:u.age,dealt:!!u.dealt}));
  }
  const td=o.td; if(td&&(td.st==='easy'||td.st==='lean')&&isInt(td.n,0,99)&&isInt(td.len,0,99)) tide={st:td.st,n:td.n,len:td.len};   // (1.1 G) older saves: a fresh EASY stretch (resetWave)
  const hm=o.hm; if(hm&&['warm','gift','cool'].includes(hm.ph)&&isInt(hm.n,0,99)&&isInt(hm.len,0,99)) hdeal={ph:hm.ph,n:hm.n,len:hm.len};   // the home dealer's coaster; older saves: warm (resetWave)
  roomNow=roomOf(packGrid(grid)); resetPressure(true);
  const b=o.bonus;                                  // a live bonus carries on with the trays it had left (the sky is back at once)
  if(b&&isInt(b.left,1,CFG.BONUS_TRAYS)&&isInt(b.extra,0,1e9)){
    bonus={left:b.left,extra:b.extra};
    curWorld='bonus'; ambient=spawnAmbient(worldDef('bonus').effect); ambientOld=[]; bgFrom='bonus'; bgT=1;
    resetLooks(true);
  }
  syncBonusChip();
  if(mode==='adventure'){ lvl=LEVELS[o.lv.id-1]; lv={lines:o.lv.lines,pieces:o.lv.pieces,combo:o.lv.combo,swept:!!o.lv.swept}; }
  if(mode==='daily'){ dk=o.dk; lv={lines:o.lv.lines,pieces:o.lv.pieces,combo:0,swept:false}; rndSrc=mulberry(hashStr(dailySeed(trayNo+'-resume'))); }
  chal=mode==='challenge'?{seed:o.ch.seed,deal:o.ch.deal,won:o.ch.won,beat:isInt(o.ch.beat,0,1e9)?o.ch.beat:0,beaten:!!o.ch.bt}:null; chDone=false;
  if(chal){ chSeed=chal.seed; lv={lines:o.lv.lines,pieces:o.lv.pieces,combo:0,swept:false}; }
  shownScore=score; el('scoreVal').textContent=score; syncHud();
  el('startCard').hidden=true; el('overCard').hidden=true; state='play';
  updateDbg();
  if(tray.every(v=>!v)) dealLater(); else checkStuck();
  syncActions();
  return true;
}
/* ═══════ the board's own state ═══════
   No Undo and no mid-run Rescue (plan 7.1). `stuck` is only the landing wait: no tray piece fits, the pieces dim and
   "No moves" shows for a moment, then the run ends (checkStuck). */
let stuck=false;
let goldChipTxt='';
function syncGoldChip(){                          // (4.5c) what the golden hand still needs, always one short line under the tray
  const st=golden&&state==='play'&&!dealing?goldenState():null, c=el('goldChip');
  let txt='';
  if(st==='locked') txt='×'+(+CFG.GOLDEN_MULT.toFixed(1))+' locked in!';
  else if(st==='alive'){ const n=goldenLeft(golden); txt=golden.want.sweep&&!golden.got.lines?'Gold: clear the board for ×'+(+CFG.GOLDEN_MULT.toFixed(1)):'Gold: '+n+(n===1?' more line':' more lines')+' for ×'+(+CFG.GOLDEN_MULT.toFixed(1)); }
  else if(st==='dead') txt='×'+(+CFG.GOLDEN_PARTIAL.toFixed(1))+' for any clear';
  c.hidden=!txt;
  if(txt&&txt!==goldChipTxt){ c.textContent=txt; c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  goldChipTxt=txt;
}
function syncActions(){
  const live=state==='play'&&!dealing;
  el('noMoves').hidden=!(stuck&&live);
  el('starNote').hidden=!(live&&!stats.starSeen&&tray.some(t=>t&&t.s.star));   // the very first star ever: one line, until she has used one
  syncGoldChip();
  syncBonusChip();
}
let lastRunJson=null;
function saveRun(){
  if(state!=='play'||dealing||tray.every(v=>!v)) return;          // mid-deal there is nothing consistent to keep; the deal saves when it ends
  try{ const j=JSON.stringify(snapshot()); if(j!==lastRunJson){ localStorage.setItem(runStore(mode),j); lastRunJson=j; } }catch(e){}
  saveStats();
}
function clearRun(m=mode){ lastRunJson=null; try{ localStorage.removeItem(runStore(m)); }catch(e){} }
function loadRun(){
  try{ const s=localStorage.getItem(runStore(mode)); if(!s) return false; const o=JSON.parse(s);
    if(mode==='daily'&&o&&o.dk!==dailyKey()){ if(o.dk&&/^\d{4}-\d\d-\d\d$/.test(o.dk)&&o.lv) recordDaily(o.dk,o.score|0,o.lv.lines|0); clearRun(); return false; }   // yesterday's unfinished Daily: its score counts, the run does not carry over
    return restore(o); }
  catch(e){ clearRun(); return false; }
}

/* ═══════ points boost migration (8.0) ═══════
   Scores became SCORE_SCALE times bigger. Everything already saved in the old size is multiplied once; `crumble.scale`
   remembers the scale the saves are in, so a reload never multiplies again (and a later scale change would only
   apply the ratio). Touches: best + total score, the Daily history, and the score fields of a saved run in each mode.
   A first install has nothing to scale and just records the scale. Adventure stars, lines and combos are not points. */
const SCALE_STORE='crumble.scale';
function migrateScale(){
  try{
    const prev=+localStorage.getItem(SCALE_STORE)||1;
    if(prev===SCORE_SCALE) return;
    const k=SCORE_SCALE/prev, up=n=>isInt(n,0,1e12)?Math.round(n*k):n;
    const edit=(key,fn)=>{ const raw=localStorage.getItem(key); if(!raw) return; try{ const o=JSON.parse(raw); if(o&&typeof o==='object'){ fn(o); localStorage.setItem(key,JSON.stringify(o)); } }catch(e){} };
    edit(STATS_STORE,o=>{ o.best=up(o.best); o.totalScore=up(o.totalScore); });
    edit('crumble.daily',o=>{ if(o.d&&typeof o.d==='object') for(const d in o.d) if(o.d[d]) o.d[d].s=up(o.d[d].s); });
    for(const m of ['endless','adventure','daily']) edit(runStore(m),o=>{
      o.score=up(o.score); if('cb' in o) o.cb=up(o.cb);
      if(o.golden) o.golden.pts=up(o.golden.pts);
      if(o.bonus) o.bonus.extra=up(o.bonus.extra);
    });
    localStorage.setItem(SCALE_STORE,String(SCORE_SCALE));
  }catch(e){}
}

/* ═══════ best score + lifetime stats — their own key, loaded before the unlock check ═══════ */
const stats={games:0,lines:0,placed:0,sweeps:0,bestCombo:0,totalScore:0,bonuses:0,starSeen:0,escapes:0};   // bonuses: bonus runs earned
function saveStats(){
  try{ localStorage.setItem(STATS_STORE,JSON.stringify({v:1,best:Math.max(best,state==='play'&&mode==='endless'?score:0),...stats})); }catch(e){}
  cloudDirty();                                     // (1.1 F) the iCloud backup follows, a few seconds later
}
function loadStats(){
  try{
    const o=JSON.parse(localStorage.getItem(STATS_STORE)||'{}');
    if(isInt(o.best,0,1e9)) best=o.best;
    for(const k in stats) if(isInt(o[k],0,1e12)) stats[k]=o[k];
  }catch(e){}
}

// App backgrounded (or about to be killed): keep the run as it stands. iOS can end a hidden web clip at any time.
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveRun(); });
addEventListener('pagehide',saveRun);

/* ═══════ hesitation log (plan 3.4) ═══════
   The measurement the dealer is tuned against: for every tray, how long from the tray appearing to her first
   pickup, how long from the pickup that led to the first drop to that drop, and whether that first drop cleared.
   Recorded always (a few numbers per tray), shown only with ?dev, in the frame readout: rolling medians of the
   last HES_WINDOW samples, with the sample count. The last HES_KEEP samples persist in `crumble.hes`, so after
   she has played normally Jay can open ?dev on her phone and read them.
   A sample is thrown away when it would not be a real hesitation: the tray came back through restore() (resume
   after a force-quit), or the app was hidden or Settings / Admin were open before the first drop. */
const HES_STORE='crumble.hes', HES_KEEP=60, HES_WINDOW=20;
const hes={log:[],dealtAt:0,firstPick:0,lastPick:0};
function hesLoad(){
  try{ const a=JSON.parse(localStorage.getItem(HES_STORE)||'[]');
    if(Array.isArray(a)) hes.log=a.filter(s=>s&&isNum(s.pick)&&isNum(s.place)).slice(-HES_KEEP); }catch(e){}
}
function hesDealt(){ hes.dealtAt=performance.now(); hes.firstPick=hes.lastPick=0; }   // commitTray: a fresh tray is on screen
function hesVoid(){ hes.dealtAt=0; }                  // this tray's sample is no longer honest
function hesPick(){ if(!hes.dealtAt) return; const t=performance.now(); if(!hes.firstPick) hes.firstPick=t; hes.lastPick=t; }
function hesPlace(cleared){                           // place(): only the tray's first drop makes a sample
  if(!hes.dealtAt||!hes.firstPick){ hes.dealtAt=0; return; }
  const now=performance.now();
  hes.log.push({pick:Math.round(hes.firstPick-hes.dealtAt),place:Math.round(now-hes.lastPick),clr:cleared?1:0,ph:paced()?pace.ph:'adv'});   // (6.1) tagged with the dealer's phase
  if(hes.log.length>HES_KEEP) hes.log.splice(0,hes.log.length-HES_KEEP);
  hes.dealtAt=0;
  try{ localStorage.setItem(HES_STORE,JSON.stringify(hes.log)); }catch(e){}
}
function hesSummary(){                                // {n, total, pick, place, clr} over the last HES_WINDOW samples (medians in ms)
  const w=hes.log.slice(-HES_WINDOW), med=k=>{ const a=w.map(s=>s[k]).sort((x,y)=>x-y); return a.length?a[a.length>>1]:0; };
  return {n:w.length,total:hes.log.length,pick:med('pick'),place:med('place'),clr:w.length?Math.round(100*w.filter(s=>s.clr).length/w.length):0};
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') hesVoid(); });

// Crumble — Save and resume (plan 3.3): the run, the best score and lifetime stats.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ run snapshot ═══════
   snapshot() returns the whole run as plain JSON data; restore(o) puts it back and returns true, or false (and
   changes nothing) if the data does not look right. Both are pure with respect to storage, so Undo (plan 3.2) can
   keep them in memory. saveRun()/loadRun() are the localStorage side. Not captured: effects in flight (they are
   cosmetic) and a live transformation (it ends on resume; Undo keeps it). A live Blast Round is kept and carries on (plan 4.5a).
   restore() never deals an opening: the saved board and tray are exactly what she left. */
const RUN_STORE='crumble.run', STATS_STORE='crumble.stats';
function snapshot(){
  return {
    v:1,
    grid:grid.map(r=>r.map(g=>g?g.gi:-1)),
    tray:tray.map(t=>t?{s:t.s.star?-1:SHAPES.indexOf(t.s),gi:t.gi}:null),
    score, combo, tension, sweepCool, trayNo, rescuesUsed, bestBeaten, lastTier,
    carry:carry.map(s=>SHAPES.indexOf(s)).filter(i=>i>=0),
    golden:golden?{want:{...golden.want},got:{...golden.got},pts:golden.pts}:null,   // copies: Undo keeps the snapshot while the live hand goes on mutating its own
    goldenNext, goldenCool, trayHadSweep, trayCombo, starForced, starCool, transformCool,
    blastCharge, specialEnd,
    tf:transform?{id:transform.id,remaining:transform.remaining}:null,   // Undo keeps a live look; resume (loadRun) ends it
    blast:blast?{t:Math.max(0,Math.round(blast.t)),pts:blast.pts,lines:blast.lines,best:blast.best,swaps:blast.swaps}:null
  };
}
const isInt=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const isNum=v=>typeof v==='number'&&isFinite(v);
function validSnapshot(o){
  if(!o||o.v!==1||!Array.isArray(o.grid)||o.grid.length!==N||!Array.isArray(o.tray)||o.tray.length!==3) return false;
  if(!o.grid.every(r=>Array.isArray(r)&&r.length===N&&r.every(v=>isInt(v,-1,GEMS.length-1)))) return false;
  if(!o.tray.every(t=>t===null||(t&&isInt(t.s,-1,SHAPES.length-1)&&isInt(t.gi,0,GEMS.length-1)))) return false;
  if(!isInt(o.score,0,1e9)||!isInt(o.combo,0,1e4)||!isInt(o.trayNo,0,1e6)||!isInt(o.rescuesUsed,0,100)) return false;
  return isNum(o.tension)&&isNum(o.sweepCool);
}
function restore(o,keepLive){
  if(!validSnapshot(o)) return false;
  cancelDeal(); clearRunFx(); undoSnap=null; stuck=false; hesVoid();   // a restored tray (resume, Undo) gives no hesitation sample
  grid=o.grid.map(r=>r.map(gi=>gi<0?null:{gi,t:1,f:0,l:0}));
  tray=o.tray.map(t=>t&&{s:t.s<0?STAR:SHAPES[t.s],gi:t.gi});
  score=o.score; combo=o.combo; tension=clamp(o.tension,0,1); sweepCool=Math.max(0,o.sweepCool|0); trayNo=o.trayNo;
  rescuesUsed=o.rescuesUsed; bestBeaten=!!o.bestBeaten; lastTier=typeof o.lastTier==='string'?o.lastTier:'—';
  carry=(Array.isArray(o.carry)?o.carry:[]).filter(i=>isInt(i,0,SHAPES.length-1)).map(i=>SHAPES[i]);
  golden=o.golden&&o.golden.want&&o.golden.got?{want:{...o.golden.want},got:{...o.golden.got},pts:o.golden.pts|0}:null;
  goldenReplan(); goldenArrive=999;                  // the plan is not stored: it is worked out again from the board and the pieces left
  goldenNext=!!o.goldenNext; goldenCool=Math.max(0,o.goldenCool|0); trayHadSweep=!!o.trayHadSweep;
  trayCombo=o.trayCombo|0; starForced=!!o.starForced; starCool=isInt(o.starCool,0,1e3)?o.starCool:0; transformCool=Math.max(0,o.transformCool|0);
  resetWorld(); transformCool=Math.max(0,o.transformCool|0);   // (resetWorld clears the cooldown)
  const tf=o.tf;
  if(keepLive&&tf&&TRANSFORMS[tf.id]&&isInt(tf.remaining,1,99)){    // Undo: the look she had is still live
    transform={id:tf.id,remaining:tf.remaining}; curWorld=tf.id; curSkin=TRANSFORMS[tf.id].skin; buildCache();
    ambient=spawnAmbient(worldDef(tf.id).effect); bgFrom=tf.id;
  }
  renderPips();
  blastCharge=isInt(o.blastCharge,0,1e4)?Math.min(o.blastCharge,CFG.BLAST_CHARGE):0; blastShown=blastCharge;
  specialEnd=isInt(o.specialEnd,-99,1e6)?o.specialEnd:-99;
  const b=o.blast;                                  // a live Blast Round carries on with the time it had left
  if(b&&isNum(b.t)&&b.t>0&&isInt(b.pts,0,1e9)&&isInt(b.lines,0,1e6)){
    blast={t:Math.min(b.t,CFG.BLAST_SECONDS*1000),pts:b.pts,lines:b.lines,best:b.best|0,swaps:b.swaps|0,tick:0};
    curWorld='blast'; curSkin='rainbow'; buildCache(); ambient=spawnAmbient(worldDef('blast').effect);
  }
  shownScore=score; el('scoreVal').textContent=score; el('bestVal').textContent=best;
  el('startCard').hidden=true; el('overCard').hidden=true; state='play';
  updateDbg();
  if(tray.every(v=>!v)) dealLater(); else checkStuck();
  syncActions();
  return true;
}
/* ═══════ Undo (plan 3.2) and the mid-run rescue button ═══════
   place() calls noteUndo() first, so undoSnap is the whole run as it stood before the last placement (plus the
   lifetime counters, so a replayed move is not counted twice). undo() puts it back through restore() and clears
   it: one move back, once per placement. A rescue, a new run and game over also clear it, so Undo can never
   refund a rescue or reach into another run. The board goes back exactly; a Blast Round in progress cannot be undone. */
let undoSnap=null, stuck=false;
function noteUndo(){ undoSnap=blast?null:{run:snapshot(),stats:{...stats}}; syncActions(); }
function undo(){
  if(!undoSnap||state!=='play'||paused) return false;
  const u=undoSnap; undoSnap=null;
  if(!restore(u.run,true)){ syncActions(); return false; }
  Object.assign(stats,u.stats);
  syncActions(); saveRun();
  return true;
}
let goldChipTxt='';
function syncGoldChip(){                          // (4.5c) what the golden hand still needs, always one short line under the tray
  const st=golden&&!blast&&state==='play'&&!dealing?goldenState():null, c=el('goldChip');
  let txt='';
  if(st==='locked') txt='×'+(+CFG.GOLDEN_MULT.toFixed(1))+' locked in!';
  else if(st==='alive'){ const n=goldenLeft(golden); txt=golden.want.sweep&&!golden.got.lines?'Gold: clear the board for ×'+(+CFG.GOLDEN_MULT.toFixed(1)):'Gold: '+n+(n===1?' more line':' more lines')+' for ×'+(+CFG.GOLDEN_MULT.toFixed(1)); }
  else if(st==='dead') txt='×'+(+CFG.GOLDEN_PARTIAL.toFixed(1))+' for any clear';
  c.hidden=!txt;
  if(txt&&txt!==goldChipTxt){ c.textContent=txt; c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  goldChipTxt=txt;
}
const canExit=()=>!!undoSnap||rescueAllowed(best);               // a way out of being stuck other than ending the run
function syncActions(){
  const live=state==='play'&&!dealing;
  el('undoBtn').disabled=!(undoSnap&&state==='play');
  el('helpBtn').disabled=!(stuck&&live&&rescueAllowed(best));
  const wait=stuck&&live&&canExit();
  el('endBtn').hidden=!wait; el('noMoves').hidden=!wait;
  el('starNote').hidden=!(live&&!stats.starSeen&&!blast&&tray.some(t=>t&&t.s.star));   // the very first star ever: one line, until she has used one
  syncGoldChip();
  syncBlastBtn();
}
el('endBtn').onclick=e=>{ e.stopPropagation(); if(stuck&&state==='play') gameOver(); };
el('undoBtn').onclick=e=>{ e.stopPropagation(); undo(); };
el('helpBtn').onclick=e=>{ e.stopPropagation(); if(!el('helpBtn').disabled) rescue(); };
let lastRunJson=null;
function saveRun(){
  if(state!=='play'||dealing||tray.every(v=>!v)) return;          // mid-deal there is nothing consistent to keep; the deal saves when it ends
  try{ const j=JSON.stringify(snapshot()); if(j!==lastRunJson){ localStorage.setItem(RUN_STORE,j); lastRunJson=j; } }catch(e){}
  saveStats();
}
function clearRun(){ lastRunJson=null; try{ localStorage.removeItem(RUN_STORE); }catch(e){} }
function loadRun(){
  try{ const s=localStorage.getItem(RUN_STORE); if(!s) return false; return restore(JSON.parse(s)); }
  catch(e){ clearRun(); return false; }
}

/* ═══════ best score + lifetime stats — their own key, loaded before the unlock check ═══════ */
const stats={games:0,lines:0,placed:0,sweeps:0,bestCombo:0,totalScore:0,blasts:0,bestBlast:0,starSeen:0};   // blasts: rounds played; bestBlast: most points in one
function saveStats(){
  try{ localStorage.setItem(STATS_STORE,JSON.stringify({v:1,best:Math.max(best,state==='play'?score:0),...stats})); }catch(e){}
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
   after a force-quit, or Undo), or the app was hidden or Settings / Admin were open before the first drop. */
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
  hes.log.push({pick:Math.round(hes.firstPick-hes.dealtAt),place:Math.round(now-hes.lastPick),clr:cleared?1:0});
  if(hes.log.length>HES_KEEP) hes.log.splice(0,hes.log.length-HES_KEEP);
  hes.dealtAt=0;
  try{ localStorage.setItem(HES_STORE,JSON.stringify(hes.log)); }catch(e){}
}
function hesSummary(){                                // {n, total, pick, place, clr} over the last HES_WINDOW samples (medians in ms)
  const w=hes.log.slice(-HES_WINDOW), med=k=>{ const a=w.map(s=>s[k]).sort((x,y)=>x-y); return a.length?a[a.length>>1]:0; };
  return {n:w.length,total:hes.log.length,pick:med('pick'),place:med('place'),clr:w.length?Math.round(100*w.filter(s=>s.clr).length/w.length):0};
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') hesVoid(); });

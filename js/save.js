// Crumble — Save and resume (plan 3.3): the run, the best score and lifetime stats.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ run snapshot ═══════
   snapshot() returns the whole run as plain JSON data; restore(o) puts it back and returns true, or false (and
   changes nothing) if the data does not look right. Both are pure with respect to storage, so Undo (plan 3.2) can
   keep them in memory. saveRun()/loadRun() are the localStorage side. Not captured: effects in flight (they are
   cosmetic), a live transformation and a live Blast Round (both end on restore; the board is unaffected).
   restore() never deals an opening: the saved board and tray are exactly what she left. */
const RUN_STORE='crumble.run', STATS_STORE='crumble.stats';
function snapshot(){
  return {
    v:1,
    grid:grid.map(r=>r.map(g=>g?g.gi:-1)),
    tray:tray.map(t=>t?{s:t.s.star?-1:SHAPES.indexOf(t.s),gi:t.gi}:null),
    score, combo, tension, sweepCool, trayNo, rescuesUsed, bestBeaten, lastTier,
    carry:carry.map(s=>SHAPES.indexOf(s)).filter(i=>i>=0),
    golden:golden?{want:golden.want,got:golden.got,pts:golden.pts}:null,
    goldenNext, goldenCool, trayHadSweep, trayCombo, starForced, transformCool
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
function restore(o){
  if(!validSnapshot(o)) return false;
  cancelDeal(); clearRunFx(); undoSnap=null; stuck=false;
  grid=o.grid.map(r=>r.map(gi=>gi<0?null:{gi,t:1,f:0,l:0}));
  tray=o.tray.map(t=>t&&{s:t.s<0?STAR:SHAPES[t.s],gi:t.gi});
  score=o.score; combo=o.combo; tension=clamp(o.tension,0,1); sweepCool=Math.max(0,o.sweepCool|0); trayNo=o.trayNo;
  rescuesUsed=o.rescuesUsed; bestBeaten=!!o.bestBeaten; lastTier=typeof o.lastTier==='string'?o.lastTier:'—';
  carry=(Array.isArray(o.carry)?o.carry:[]).filter(i=>isInt(i,0,SHAPES.length-1)).map(i=>SHAPES[i]);
  golden=o.golden&&o.golden.want&&o.golden.got?{want:o.golden.want,got:o.golden.got,pts:o.golden.pts|0}:null;
  goldenNext=!!o.goldenNext; goldenCool=Math.max(0,o.goldenCool|0); trayHadSweep=!!o.trayHadSweep;
  trayCombo=o.trayCombo|0; starForced=!!o.starForced; transformCool=Math.max(0,o.transformCool|0);
  resetWorld(); renderPips();
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
  if(!restore(u.run)){ syncActions(); return false; }
  Object.assign(stats,u.stats);
  syncActions(); saveRun();
  return true;
}
const canExit=()=>!!undoSnap||rescueAllowed(best);               // a way out of being stuck other than ending the run
function syncActions(){
  const live=state==='play'&&!dealing;
  el('undoBtn').disabled=!(undoSnap&&state==='play');
  el('helpBtn').disabled=!(stuck&&live&&rescueAllowed(best));
  const wait=stuck&&live&&canExit();
  el('endBtn').hidden=!wait; el('noMoves').hidden=!wait;
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
const stats={games:0,lines:0,placed:0,sweeps:0,bestCombo:0,totalScore:0};
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

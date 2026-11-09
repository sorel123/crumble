// Crumble — Game over, rescue, start.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ flow ═══════ */
async function gameOver(){
  if(state!=='play') return;
  if(paused){ setTimeout(gameOver,300); return; }
  state='over'; clearRun(); undoSnap=null; stuck=false; syncActions();
  bonus=null; bonusTag=null;                         // the bonus dies with the run; resetWorld() restores the look on restart
  const prevBest=best;
  stats.totalScore+=score;
  el('overEye').textContent='No room left'; el('againBtn').textContent='Start over'; el('overMenuBtn').textContent='Modes';
  if(mode==='adventure'&&lvl) levelFailed();
  else if(mode==='daily') dailyOver();
  else {
    best=Math.max(best,score); syncHud(); saveStats();
    const newSkins=checkUnlocks();
    el('overScore').textContent=score;
    el('overMsg').textContent=(newSkins.length?'New skin unlocked: '+newSkins.join(', ')+'! ':'')
      +(score>=1500?'That is a serious run.'
      :score>=600?'Good chains. Save the big shapes for open space.'
      :'Clear rows early — do not let the board fill up.');
  }
  const btn=el('reviveBtn');
  btn.hidden=!rescueAllowed(prevBest);
  btn.textContent='Keep going';
  shareSetup();                                      // (4.4) Share shows for Endless and Daily runs only
  el('overCard').hidden=false;
}
// a rescue is on offer while she has one left and the run is worth saving (the game-over card and the mid-run button share this)
const rescueAllowed=(bestRef)=>rescuesUsed<CFG.MAX_RESCUES && (mode==='adventure' || ((score>=CFG.RESCUE_FLOOR || score>=bestRef*CFG.RESCUE_BEST_FRAC) && score>0));   // a level always offers its rescues
async function rescue(){
  if(rescuesUsed>=CFG.MAX_RESCUES) return;
  rescuesUsed++; undoSnap=null; stuck=false;
  waves.push({x:W/2,y:by+B/2,t:0}); glowT=1;
  Sfx.rescue();
  combo=0; tension=0.5; goldenNext=false; cancelDeal(); genRescue();
  el('overCard').hidden=true; state='play';
  syncActions(); saveRun();
}
// everything in flight that a new run, or a restored one, starts without (effects, banners, drag, the bonus)
function clearRunFx(){
  golden=null; goldenNext=false; goldenCool=0; trayHadSweep=false; trayCombo=0; starForced=false; starCool=0; transform=null; transformCool=0;
  shatters=[];shards=[];pops=[];sweeps=[];waves=[];sparkles=[];banners=[];blasts=[];drag=null;ret=null;
  praises=[];bursts=[];lineFlashes=[];
  chunks=[];orbs=[];rings=[];dust=[]; scoreHold=0; bestBeaten=false; hitWait=0;
  bonus=null; bonusTag=null; clearTimeout(bonusTagT);
  tags=[]; slams=[]; bands=[]; borderFlash=null;
  confetti=[]; goldenCele=null; goldRain=[]; goldenArrive=999; comboGlowV=0; goldTintV=0; sweepFxT=0; punchT=0;
}
function start(){
  layout();
  grid=empty(); score=0; combo=0; rescuesUsed=0; tension=0; sweepCool=0; trayNo=0; carry=[]; bonusMeter=0; specialEnd=-99;
  clearRunFx(); stats.games++;
  resetWorld();
  shownScore=0; el('scoreVal').textContent='0';
  undoSnap=null; stuck=false; cancelDeal(); openBoard(); syncHud(); el('startCard').hidden=true; el('overCard').hidden=true; state='play';
  syncActions(); saveRun();
}

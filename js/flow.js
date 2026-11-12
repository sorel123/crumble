// Crumble — Game over, rescue, start.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ flow ═══════ */
async function gameOver(){
  if(state!=='play') return;
  if(paused){ setTimeout(gameOver,300); return; }
  state='over'; clearRun(); stuck=false; syncActions(); guideMark();   // (1.1 D) once any game has ended, the guide never shows
  const prevBest=best;
  stats.totalScore+=score;
  el('overEye').textContent='Endless'; el('overTitle').textContent='Out of moves'; el('againBtn').textContent='Play again'; el('overMenuBtn').textContent='Home';
  el('overMedals').hidden=true; el('chalNewBtn').hidden=true;
  if(mode==='adventure'&&lvl) levelFailed();
  else if(mode==='daily') dailyOver();
  else if(mode==='challenge'&&chal) chalOver();   // (E1) the round's medal card
  else {
    best=Math.max(best,score); syncHud(); saveStats(); gcSync();
    const newSkins=checkUnlocks();
    el('overScore').textContent=score;
    el('overMsg').textContent=(newSkins.length?'New skin unlocked: '+newSkins.join(', ')+'! ':'')
      +(score>=1500*SCORE_SCALE?'That is a serious run.'
      :score>=600*SCORE_SCALE?'Good chains. Save the big shapes for open space.'
      :'Clear rows early — do not let the board fill up.');
  }
  const offer=rescueAllowed(prevBest);              // (8.1) one marked one-time offer; otherwise only Play again and Home
  el('reviveBox').hidden=!offer;
  el('againBtn').className=offer?'ghost':'cta';
  shareSetup();                                      // (4.4) Share shows for Endless and Daily runs only
  el('overCard').hidden=false;
  tlShow();                                          // (7.5g) the run replays on the card; the buttons above are already live
}
// The one rescue of a run (plan 7.1): offered on the game-over card while she has it and the run is worth saving.
// Every check for it goes through here, so an ad can gate it later in one place. A level always offers its rescue.
const rescueAllowed=(bestRef)=>rescuesUsed<CFG.MAX_RESCUES && mode!=='challenge' && (mode==='adventure' || ((score>=CFG.RESCUE_FLOOR || score>=bestRef*CFG.RESCUE_BEST_FRAC) && score>0));
async function rescue(){
  if(!rescueAllowed(best)) return;
  rescuesUsed++; stuck=false;
  waves.push({x:W/2,y:by+B/2,t:0}); glowT=1;
  Sfx.rescue();
  combo=0; comboMiss=0; goldenNext=false; cancelDeal(); genRescue();
  if(paced()){ paceSet('recovery'); pace.n=CFG.RECOVERY_TRIES; } else tension=0.5;   // (6.1) the rescue tray is her last recovery try: clear out and relief follows, miss and it is the edge again
  el('overCard').hidden=true; tlStop(); state='play';
  syncActions(); saveRun();
}
// everything in flight that a new run, or a restored one, starts without (effects, banners, drag, the bonus)
function clearRunFx(){
  golden=null; goldenNext=false; goldenCool=0; trayHadSweep=false; trayCombo=0; starForced=false; starCool=0; transform=null; transformCool=0;
  shatters=[];shards=[];pops=[];sweeps=[];waves=[];sparkles=[];banners=[];blasts=[];drag=null;ret=null;
  praises=[];bursts=[];lineFlashes=[];stamps=[];bannerWait=0;
  chunks=[];rubble=[];orbs=[];rings=[];dust=[]; scoreHold=0; bestBeaten=false; hitWait=0;
  bonus=null; bonusTag=null; clearTimeout(bonusTagT);
  tags=[]; slams=[]; bands=[]; borderFlash=null;
  confetti=[]; goldenCele=null; goldRain=[]; goldenArrive=999; comboGlowV=0; goldTintV=0; sweepFxT=0; punchT=0;
  fireReset(); chaseKey=''; guide=null;                         // (7.5e) a new or restored run's marker appears without the pop
}
function start(){
  const fresh=guideFresh();                         // (1.1 D) asked before this game is counted
  layout();
  grid=empty(); score=0; combo=0; comboMiss=0; rescuesUsed=0; pace={ph:'calm',n:0,hold:0,len:0}; roomNow=1; resetPressure(false); tension=0; sweepCool=0; trayNo=0; carry=[]; bonusMeter=0; specialEnd=-99; resetWave();
  clearRunFx(); stats.games++; musicNewRun();
  if(chal&&mode==='challenge'&&chSeed===chal.seed&&!chBeat) chBeat=chal.beat||0;   // (E2) Retry and Restart keep a friend's target
  chal=null; chDone=false;
  jJumps=0; resetWorld();                           // (7.5b) the journey starts at dawn
  chaseBest=mode==='endless'?best:0;                // (7.5e) the best this run chases
  shownScore=0; el('scoreVal').textContent='0';
  stuck=false; cancelDeal(); openBoard(fresh); tlReset(); syncHud(); el('startCard').hidden=true; el('overCard').hidden=true; state='play';
  syncActions(); saveRun();
}

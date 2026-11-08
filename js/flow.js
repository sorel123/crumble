// Crumble — Game over, rescue, start.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ flow ═══════ */
async function gameOver(){
  if(state!=='play') return;
  if(paused){ setTimeout(gameOver,300); return; }
  state='over';
  blast=null;                                        // the round dies with the run; resetWorld() restores the look on restart
  const prevBest=best;
  best=Math.max(best,score); el('bestVal').textContent=best;
  const newSkins=checkUnlocks();
  deaths++;
  if(deaths%CFG.ADS_EVERY===0) await Ads.showInterstitial();
  el('overScore').textContent=score;
  el('overMsg').textContent=(newSkins.length?'New skin unlocked: '+newSkins.join(', ')+'! ':'')
    +(score>=1500?'That is a serious run.'
    :score>=600?'Good chains. Save the big shapes for open space.'
    :'Clear rows early — do not let the board fill up.');
  const btn=el('reviveBtn');
  const canRescue=rescuesUsed<CFG.MAX_RESCUES
    && (score>=CFG.RESCUE_FLOOR || score>=prevBest*CFG.RESCUE_BEST_FRAC) && score>0;
  btn.hidden=!canRescue;
  btn.textContent=rescues>0?'Use a rescue':'Watch an ad for a rescue';
  el('overCard').hidden=false;
}
async function rescue(){
  if(rescuesUsed>=CFG.MAX_RESCUES) return;
  if(rescues<=0){
    if(!await Ads.showRewarded()) return;
    rescues++;
  }
  rescues--; rescuesUsed++;
  waves.push({x:W/2,y:by+B/2,t:0}); glowT=1;
  Sfx.rescue();
  combo=0; tension=0.5; goldenNext=false; genRescue();
  el('overCard').hidden=true; state='play';
}
function start(){
  layout();
  grid=empty(); score=0; combo=0; rescues=CFG.FREE_RESCUES; rescuesUsed=0; tension=0; sweepCool=0; trayNo=0; carry=[];
  golden=null; goldenNext=false; goldenCool=0; trayHadSweep=false; trayCombo=0; starForced=false;
  shatters=[];shards=[];pops=[];sweeps=[];waves=[];sparkles=[];banners=[];blasts=[];drag=null;ret=null;
  praises=[];bursts=[];lineFlashes=[];
  chunks=[];orbs=[];rings=[];dust=[]; scoreHold=0; bestBeaten=false; hitWait=0;
  blast=null; blastMeter=0; lastClearAt=performance.now(); bigMode=false;
  tags=[]; slams=[]; bands=[]; borderFlash=null;
  confetti=[]; comboGlowV=0; goldTintV=0; sweepFxT=0; punchT=0;
  resetWorld();
  shownScore=0; el('scoreVal').textContent='0'; el('bestVal').textContent=best;
  genTray(); el('startCard').hidden=true; el('overCard').hidden=true; state='play';
}

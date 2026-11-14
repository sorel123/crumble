// Crumble — Game over, rescue, start.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ flow ═══════ */
async function gameOver(){
  if(state!=='play') return;
  if(paused){ setTimeout(gameOver,300); return; }
  state='over'; recOver(); clearRun(); stuck=false; syncActions(); guideMark();   // (1.1 D) once any game has ended, the guide never shows
  const prevBest=best;
  stats.totalScore+=score;
  el('overEye').textContent='Endless'; el('overTitle').textContent='Out of moves'; el('againBtn').textContent='Play again'; el('overMenuBtn').textContent='Home';
  el('overMedals').hidden=true; el('chalNewBtn').hidden=true; el('overStop').hidden=true; el('overMsg').hidden=false; reportHide();
  if(mode==='adventure'&&lvl) levelFailed();
  else if(mode==='daily') dailyOver();
  else if(mode==='challenge'&&chal) chalOver();   // (E1) the round's medal card
  else {
    best=Math.max(best,score); syncHud(); saveStats(); gcSync();
    const newSkins=checkUnlocks();
    el('overScore').textContent=score;
    const rcOn=!!CFG.REPORT_CARD;                     // (report) Crumb's line takes the place of the tip; a new skin is still named
    el('overMsg').textContent=(newSkins.length?'New skin unlocked: '+newSkins.join(', ')+'! ':'')
      +(rcOn?'':score>=1500*SCORE_SCALE?'That is a serious run.'
      :score>=600*SCORE_SCALE?'Good chains. Save the big shapes for open space.'
      :'Clear rows early — do not let the board fill up.');
    el('overMsg').hidden=!el('overMsg').textContent;
    stopLine();                                      // (sky bite) how far the sky went, and her farthest
    if(rcOn) reportShow();                           // (report) the grade and Crumb's line, beside the sky line
  }
  const offer=rescueAllowed(prevBest);              // (8.1) one marked one-time offer; otherwise only Play again and Home
  el('reviveBox').hidden=!offer;
  el('againBtn').className=offer?'ghost':'cta';
  shareSetup();                                      // (4.4) Share shows for Endless and Daily runs only
  el('overCard').hidden=false;
  tlShow();                                          // (7.5g) the run replays on the card; the buttons above are already live
}
/* (sky bite) Endless: one line on the game-over card, "You reached Night." then "Your best is Aurora." or, past her
   record, "Farthest yet!". The farthest stop is kept in the saved stats as farStop = stop + 1 (0: none recorded yet, so an
   older save's first game names the stop and claims no record). Past Space the stop reads "Deep space 2". */
function stopLine(){
  const st=skyStop(), prev=stats.farStop|0;
  let t='You reached '+stopName(st)+'.';
  if(prev&&st+1>prev) t+=' Farthest yet!';
  else if(prev) t+=' Your best is '+stopName(prev-1)+'.';
  if(st+1>prev){ stats.farStop=st+1; saveStats(); }
  el('overStop').textContent=t; el('overStop').hidden=false;
}
/* (report) Crumb's report card (Endless): a grade stamped beside the sky line and one line from Crumb, to soften a loss with
   a laugh and to show someone. reportGrade is pure: a 0-100 mark from the run (CFG.REPORT_W parts: score against her best
   before this run, the sky stop, the best combo, sweeps, dares beaten + cookies eaten; each part full at CFG.REPORT_TOP), then
   nine grades D .. A+ by CFG.REPORT_CUTS. Never an F. A new best is never below A-. A first game (no best yet) is graded on
   the other parts, scaled up to 100. The line is a quip when one clearly applies (REPORT_QUIPS, in priority order), else one
   for the grade's band; picked by a hash of the run's numbers, so the same run always gets the same line (no dice). The run's
   counters the quips need live in `rc`, reset in clearRunFx, bumped from the existing hooks, saved in the run as `rc`. */
const rc={t:0,g:0,s:0,d:0,w:0,c:0,p:0};              // this run: throws of the crumb, most gems one cannonball broke, cookies gone stale, deflates, dares beaten, best combo, sweeps
let reportIn=0;                                     // the stamp's thump (ms, fxBusy)
function rcReset(){ for(const k in rc) rc[k]=0; }
const rcSnap=()=>mode==='endless'?{...rc}:null;       // save.js snapshot `rc`
function rcLoad(o){ if(!o||typeof o!=='object'||mode!=='endless') return; for(const k in rc) if(isInt(o[k],0,1e6)) rc[k]=o[k]; }   // older saves: zeros
const REPORT_GRADES=['D','C','C+','B\u2212','B','B+','A\u2212','A','A+'];
function reportGrade(r){
  const W=CFG.REPORT_W, T=CFG.REPORT_TOP, C=CFG.REPORT_CUTS, part=(v,top)=>top>0?Math.max(0,Math.min(1,(+v||0)/top)):0;
  const rest=W[1]*part(r.stop,T[1])+W[2]*part(r.combo,T[2])+W[3]*part(r.sweeps,T[3])+W[4]*part((r.dares|0)+(r.cookies|0),T[4]);
  const all=W.reduce((a,b)=>a+b,0), first=!(r.best>0), newBest=!first&&r.score>r.best;
  let mark=first?100*rest/Math.max(1,all-W[0]):100*(W[0]*(newBest?1:part(r.score,r.best))+rest)/Math.max(1,all);
  if(newBest) mark=Math.max(mark,C[6]);
  mark=Math.round(Math.max(0,Math.min(100,mark)));
  let i=0; for(let k=0;k<C.length&&k<REPORT_GRADES.length;k++) if(mark>=C[k]) i=k;
  return {mark,grade:REPORT_GRADES[i],i,band:i<=2?'low':i<=5?'mid':'high',newBest,first};
}
// the quips, in priority order: [SAY key, does it clearly apply]
const REPORT_QUIPS=[
  ['rcBest',  r=>r.best>0&&r.score>r.best],
  ['rcSpace', r=>r.stop>=5],
  ['rcCannon',r=>r.gems>=CFG.REPORT_CANNON],
  ['rcDares', r=>r.offered>=1&&r.dares>=r.offered],
  ['rcStale', r=>r.stale>0],
  ['rcDeflate',r=>r.deflates>0],
  ['rcIgnored',r=>!!r.toy&&r.throws===0&&r.stop>=1],   // he was there to throw (past the quiet opening) and she never did
  ['rcQuick', r=>r.stop<1],
];
function reportLine(r){                             // {key, txt}: the same run always gets the same line
  const g=reportGrade(r), q=REPORT_QUIPS.find(([,f])=>f(r)), key=q?q[0]:'rc'+g.band[0].toUpperCase()+g.band.slice(1);
  const a=SAY[key], h=hashStr([r.score|0,r.stop|0,r.combo|0,r.sweeps|0,r.throws|0,r.gems|0].join('|'));
  return {key,txt:a[h%a.length]};
}
function reportRun(){                               // the live run, for the card
  return {score,best:chaseBest,stop:skyStop(),combo:rc.c,sweeps:rc.p,dares:rc.w,cookies:ck.n|0,offered:daresOn()?dare.n:0,
    throws:rc.t,gems:rc.g,stale:rc.s,deflates:rc.d,toy:toyOn()};
}
function reportHide(){
  const b=el('rcBox'); if(!b) return;
  b.hidden=true; reportIn=0;
  const s=el('overStop'); if(s.parentNode!==el('overCard')) el('overMsg').after(s);   // the sky line back in its own place
}
function reportShow(){
  const r=reportRun(), g=reportGrade(r), b=el('rcBox'), st=el('rcStamp');
  st.textContent=g.grade; st.className='rcStamp '+g.band; st.setAttribute('aria-label','Crumb\'s grade: '+g.grade.replace('\u2212',' minus').replace('+',' plus'));
  const talk=!!CFG.FX_CRUMB_TALK, face=!!CFG.FX_MASCOT, ln=el('rcLine'), f=el('rcFace');
  ln.hidden=!talk&&!face;
  el('rcTxt').textContent=talk?reportLine(r).txt:''; el('rcTxt').hidden=!talk;
  f.hidden=!face;
  if(face){
    const mood=g.band==='high'?'sweep':g.band==='mid'?'smug':'flat';
    f.innerHTML='<div class="crumbFig '+mood+' rm"><div class="mb">'+MASCOT_SVG+'</div></div>';
    closetDress(f.querySelector('svg'));          // in his outfit
  }
  el('rcR').appendChild(el('overStop'));            // the sky line sits under his line, beside the stamp
  b.hidden=false;
  st.classList.remove('in'); void st.offsetWidth;
  if(!reduce){ st.classList.add('in'); reportIn=performance.now()+1050; }   // it thumps in after the score has shown; Reduce Motion: it is just there
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
  praises=[];bursts=[];lineFlashes=[];stamps=[];bannerWait=0;sweepShow=null;
  chunks=[];rubble=[];orbs=[];rings=[];dust=[]; scoreHold=0; bestBeaten=false; hitWait=0;
  bonus=null; bonusTag=null; clearTimeout(bonusTagT); quietHid=false; quietIn=0; say.qSync=true; rcReset();   // (quiet) a new or restored run: the meter's slide-in and Crumb's line start from where it is
  tags=[]; slams=[]; bands=[]; borderFlash=null; avaReset(); toyRunReset(); dareRunReset(); cookieRunReset();
  confetti=[]; goldenCele=null; goldRain=[]; goldenArrive=999; comboGlowV=0; goldTintV=0; sweepFxT=0; punchT=0;
  fireReset(); chaseKey=''; guide=null;                         // (7.5e) a new or restored run's marker appears without the pop
}
function start(){
  const fresh=guideFresh();                         // (1.1 D) asked before this game is counted
  layout();
  grid=empty(); score=0; combo=0; comboMiss=0; rescuesUsed=0; pace={ph:'calm',n:0,hold:0,len:0}; roomNow=1; resetPressure(false); tension=0; sweepCool=0; trayNo=0; carry=[]; bonusMeter=0; specialEnd=-99; resetWave();
  clearRunFx(); stats.games++; musicNewRun(); recGame(false);
  if(chal&&mode==='challenge'&&chSeed===chal.seed&&!chBeat){ chBeat=chal.beat||0; chFp=chal.fp||null; }   // (E2) Retry and Restart keep a friend's target (and pace)
  chal=null; chDone=false;
  jJumps=0; resetWorld();                           // (7.5b) the journey starts at dawn
  chaseBest=mode==='endless'?best:0;                // (7.5e) the best this run chases
  shownScore=0; el('scoreVal').textContent='0';
  stuck=false; cancelDeal(); openBoard(fresh); tlReset(); syncHud(); el('startCard').hidden=true; el('overCard').hidden=true; state='play';
  syncActions(); saveRun();
}

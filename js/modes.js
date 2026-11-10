// Crumble — Modes (plan 4.1): Adventure levels, the mode menu and their saved progress.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ modes ═══════
   Endless is the default and unchanged. Adventure is 30 short goal levels (no timer) on a map; each level is a
   normal run with a goal, so the dealer, save/resume, specials and looks all work as they do anywhere.
   Every mode keeps its own saved run (`crumble.run` endless, `crumble.run.adv`, `crumble.run.daily`), so
   switching never loses a game. Progress lives in `crumble.adv`, plain data meant to be extended:
     {v:1, lv:{ "7":{s:2, p:14, n:3, f:1} }}    s best stars (0-3), p fewest pieces, n times cleared, f failed tries */
const MODE_STORE='crumble.mode', ADV_STORE='crumble.adv', DAILY_STORE='crumble.daily';
const runStore=m=>m==='adventure'?'crumble.run.adv':m==='daily'?'crumble.run.daily':m==='challenge'?'crumble.run.chal':'crumble.run';
const CHAPTERS=['First steps','Warming up','Getting good','Tricky boards','Crumble master'];
// [goal type, goal n, gems already on the board]: fill 0 opens like Endless (a nearly full line and a first move that clears it,
// which is also a clean sweep, so a score level always has a scatter instead);
// a sweep level's board is built so a sweep can be dealt, and the dealer keeps offering one (dealSteps)
const LEVEL_DEFS=[
  ['lines',3,0],['lines',5,0],['score',150,6],['lines',8,0],['combo',2,0],['lines',10,6],
  ['lines',6,8],['score',300,8],['combo',2,10],['sweep',1,6],['lines',10,10],['score',450,12],
  ['lines',10,14],['combo',3,12],['sweep',1,8],['score',550,14],['lines',12,16],['combo',3,16],
  ['lines',12,20],['sweep',1,10],['score',700,18],['combo',3,16],['lines',15,20],['score',850,22],
  ['combo',3,20],['sweep',1,12],['lines',18,22],['score',1000,22],['lines',20,20],['score',1500,24]
];
// par: pieces placed for 3 stars and for 2 stars (1 star is just clearing the level). 3 stars = the sim bot's 85th percentile, 2 stars =
// 1.6x that (tools/adventure-sim.mjs prints the bot's numbers; levels 25 and 29 were retuned after the run and are estimates).
const LEVEL_PAR=[[7,12],[12,20],[15,24],[19,31],[17,28],[22,36],[13,21],[31,50],[9,15],[6,10],[20,32],[40,64],[20,32],[57,92],[4,7],[47,76],[22,36],[48,77],[22,36],[6,10],[61,98],[47,76],[30,48],[67,108],[50,80],[6,10],[35,56],[84,135],[38,61],[117,188]];
const LEVELS=LEVEL_DEFS.map(([type,n,fill],i)=>({id:i+1,ch:(i/6)|0,goal:{type,n:type==='score'?n*SCORE_SCALE:n},fill,par:LEVEL_PAR[i]||[99,99]}));   // (8.0) a score goal is in boosted points
const goalText=g=>g.type==='lines'?'Clear '+g.n+' lines':g.type==='score'?'Score '+g.n:g.type==='combo'?'Make a combo of '+g.n:'Clear the whole board';

/* ── progress ── */
const adv={lv:{}};
function loadAdv(){
  try{
    const o=JSON.parse(localStorage.getItem(ADV_STORE)||'{}');
    if(o&&o.lv&&typeof o.lv==='object') for(const k in o.lv){
      const d=o.lv[k]; if(!LEVELS[k-1]||!d) continue;
      adv.lv[k]={s:isInt(d.s,0,3)?d.s:0,p:isInt(d.p,0,1e4)?d.p:0,n:isInt(d.n,0,1e6)?d.n:0,f:isInt(d.f,0,1e6)?d.f:0};
    }
  }catch(e){}
}
function saveAdv(){ try{ localStorage.setItem(ADV_STORE,JSON.stringify({v:1,lv:adv.lv})); }catch(e){} }
const advRec=id=>adv.lv[id]||(adv.lv[id]={s:0,p:0,n:0,f:0});
const levelDone=id=>!!(adv.lv[id]&&adv.lv[id].n>0);
// a level is open once the one before it is cleared; after three failed tries on a level the next one opens too (nobody gets stuck)
const levelOpen=id=>id===1||levelDone(id-1)||!!(adv.lv[id-1]&&adv.lv[id-1].f>=3);
const nextLevel=()=>LEVELS.find(L=>levelOpen(L.id)&&!levelDone(L.id))||LEVELS[LEVELS.length-1];
const advStars=()=>LEVELS.reduce((a,L)=>a+(adv.lv[L.id]?adv.lv[L.id].s:0),0);
const starsFor=(L,pieces)=>pieces<=L.par[0]?3:pieces<=L.par[1]?2:1;
const starStr=n=>'★'.repeat(n)+'☆'.repeat(3-n);

function loadModes(){
  try{ const m=localStorage.getItem(MODE_STORE); if(m==='adventure'||m==='daily'||m==='challenge') mode=m; }catch(e){}
  loadAdv(); loadDaily(); loadChal();
}
const saveMode=()=>{ try{ localStorage.setItem(MODE_STORE,mode); }catch(e){} };

/* ── Daily (plan 4.1b) ──
   One board a day, the same on every phone: the opening and every tray are dealt from a stream seeded by the date
   (and the tray number), so two phones on the same day start with the same board and tray. It is a normal Endless-style
   run (the one Rescue and the specials work). Results: `crumble.daily` = {v:1, d:{"2026-11-09":{s:best score, l:most lines, n:times played}}},
   plain data for 4.2's streaks. The date is the phone's local date. */
const daily={d:{}};
let dk='';                                           // the date key of the Daily run in progress
function dailyKey(d=new Date()){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function loadDaily(){
  try{
    const o=JSON.parse(localStorage.getItem(DAILY_STORE)||'{}');
    if(o&&o.d&&typeof o.d==='object') for(const k in o.d){
      const r=o.d[k]; if(!/^\d{4}-\d\d-\d\d$/.test(k)||!r) continue;
      daily.d[k]={s:isInt(r.s,0,1e9)?r.s:0,l:isInt(r.l,0,1e6)?r.l:0,n:isInt(r.n,0,1e6)?r.n:0};
    }
  }catch(e){}
}
function recordDaily(key,sc,lines,again){        // again: the same run reaching game over a second time (after a Rescue) is not another play
  const r=daily.d[key]||(daily.d[key]={s:0,l:0,n:0});
  if(!again) r.n++; r.s=Math.max(r.s,sc|0); r.l=Math.max(r.l,lines|0);
  try{ localStorage.setItem(DAILY_STORE,JSON.stringify({v:1,d:daily.d})); }catch(e){}
  return r;
}
const dailyBest=()=>(daily.d[dk||dailyKey()]||{s:0}).s;
const dailySeed=tag=>'crumble-daily-'+dk+'-'+tag;
const fmtScore=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=10000?Math.round(n/1000)+'k':n>=1000?(n/1000).toFixed(1)+'k':String(n);
function dailyOver(){                                // the game-over card, for a Daily
  const r=recordDaily(dk,score,lv.lines,lv.rec); lv.rec=true; gcDaily(score);
  el('overEye').textContent='Daily · '+new Date(dk+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
  el('overScore').textContent=score;
  el('overMsg').textContent=score>=r.s&&score>0?'Your best today!':'Best today: '+r.s+'. Same board, try again.';
  el('againBtn').textContent='Play again'; el('overMenuBtn').textContent='Home';
  syncHud();
}

/* ── the level's board ── */
// A scatter of small pieces, no full line, the same on every phone (seeded by the level). A sweep level gets one or
// two nearly-full lines instead, tried until the sweep planner can empty the board with three pieces.
function levelBoard(L){
  const sweep=L.goal.type==='sweep';
  for(let salt=0;salt<300;salt++){
    const rng=mulberry(hashStr('crumble-level-'+L.id+'-'+salt)), g=empty();
    if(sweep){
      const rowsN=L.fill<=7?1:2, vert=rng()<0.5, l0=(rng()*(N-rowsN+1))|0, per=Math.round(L.fill/rowsN);
      for(let k=0;k<rowsN;k++){
        const idx=[...Array(N).keys()].sort(()=>rng()-0.5).slice(0,Math.min(per,N-2)), gi=(rng()*NCOLOR)|0;
        for(const j of idx){ const r=vert?j:l0+k, c=vert?l0+k:j; g[r][c]={gi,t:1,f:0,l:0}; }
      }
      if(seeded('crumble-sweep-'+L.id+'-'+salt,()=>planSweep(packGrid(g)))) return g;   // seeded: the planner's own dice must not decide which board a level gets
      continue;
    }
    let filled=0;
    for(let tries=0;filled<L.fill&&tries<300;tries++){
      const s=SHAPES[(rng()*SHAPES.length)|0], r=(rng()*(N-s.rows+1))|0, c=(rng()*(N-s.cols+1))|0;
      if(filled+s.n>L.fill+2||!canPlace(s,r,c,g)) continue;
      const gi=(rng()*NCOLOR)|0;
      s.cells.forEach(([dr,dc])=>{ g[r+dr][c+dc]={gi,t:1,f:0,l:0}; }); filled+=s.n;
    }
    const full=linesFor(g);
    if(filled>=L.fill&&!full.rows.length&&!full.cols.length) return g;
  }
  return empty();
}
// called by start(): the board a new run opens with
function openBoard(){
  lv={lines:0,pieces:0,combo:0,swept:false}; rndSrc=null;
  if(mode==='daily'){ dk=dailyKey(); rndSrc=mulberry(hashStr(dailySeed('open'))); seedOpening(); rndSrc=null; return; }
  if(mode==='challenge'){ chOpen(); return; }          // (E1) the round's frozen deal (challenge.js)
  if(mode==='adventure'&&lvl&&lvl.fill>0){ grid=levelBoard(lvl); trayNo=0; genTray(); }
  else seedOpening();
  if(mode==='adventure'&&lvl) pushBanner('LEVEL '+lvl.id,goalText(lvl.goal));
}

/* ── goal ── */
function goalProgress(){
  const t=lvl.goal.type;
  return t==='lines'?lv.lines:t==='score'?score:t==='combo'?lv.combo:lv.swept?1:0;
}
// the HUD's right-hand box: Best in Endless, the goal in Adventure
/* (7.5e) Chase your best. In Endless, a slim bar under the score fills as the shown score counts up toward the best she
   started the run with (chaseBest). From CFG.CHASE_NEAR of it "N to beat" shows beside it; from CFG.CHASE_HOT the bar
   glows. When the shown score passes it the bar flashes and pops away; place() has already raised the NEW BEST banner
   and, with the journey sky on and a best of CFG.CHASE_SKY_MIN or more, jumped the sky a stage (journeySweep).
   Plain DOM in the HUD: no canvas drawing, and it writes only when what it shows changes. Hidden on her very first run
   (no best yet), in Daily and Adventure, and with Settings > Look > Advanced "Chase your best" off. */
let chaseKey='', chaseT=0;
function chaseSync(){
  const box=el('chase'); if(!box) return;
  const on=CFG.FX_CHASE&&mode==='endless'&&chaseBest>0;
  const f=on?Math.min(1,shownScore/chaseBest):0, won=on&&shownScore>chaseBest;
  const near=f>=CFG.CHASE_NEAR, hot=f>=CFG.CHASE_HOT, need=chaseBest+1-shownScore;
  const q=Math.round(f*200)/200;                     // the bar moves in half-percent steps: a DOM write only when it shows a change
  const key=!on?'off':won?'won':(q+'|'+(near?need:'')+'|'+(hot?1:0));
  if(key===chaseKey) return;
  const was=chaseKey; chaseKey=key; clearTimeout(chaseT);
  if(key==='off'){ box.hidden=true; box.className=''; return; }
  if(key==='won'){                                   // passed: a flash and a pop if she saw it happen, else simply gone
    box.querySelector('.fill').style.transform='scaleX(1)';
    if(was&&was!=='off'&&!box.hidden){ box.className='won'+(reduce?' rm':''); chaseT=setTimeout(()=>{ box.hidden=true; },reduce?400:750); }
    else box.hidden=true;
    return;
  }
  box.hidden=false; box.className=(near?'near':'')+(hot?' hot':'')+(reduce?' rm':'');
  box.querySelector('.fill').style.transform='scaleX('+q+')';
  box.querySelector('.to').textContent=near?need+' to beat':'';
}
function hudFit(){                                 // (8.4) six- and seven-digit scores step down a size so the top bar fits
  const sv=el('scoreVal'), n=sv.textContent.length;
  sv.classList.toggle('long',n>=6); sv.classList.toggle('xlong',n>=7);
  el('bestVal').classList.toggle('long',el('bestVal').textContent.length>=7);
}
function syncHud(){
  const adventure=mode==='adventure'&&lvl;
  let lbl='Best', val=best;
  if(mode==='daily'){ lbl='Today'; val=dailyBest(); }
  if(mode==='challenge'&&chal) [lbl,val]=chHudRight();   // (E1) the next medal and its target
  if(adventure){
    const g=lvl.goal, p=Math.min(goalProgress(),g.n);
    if(g.type==='lines'){ lbl='Lines'; val=p+'/'+g.n; }
    else if(g.type==='combo'){ lbl='Combo'; val=p+'/'+g.n; }
    else if(g.type==='score'){ lbl='Goal'; val=g.n; }
    else { lbl='Goal'; val='Empty it'; }
  }
  el('bestLbl').textContent=lbl; el('bestVal').textContent=val; hudFit();
  chaseSync(); chHud();
}
// place() calls this after every placement
function goalStep(total,swept){
  if(mode==='daily'&&state==='play'){ lv.pieces++; lv.lines+=total; return; }
  if(mode==='challenge'&&state==='play'){ lv.pieces++; lv.lines+=total; chStep(); syncHud(); return; }
  if(mode!=='adventure'||!lvl||state!=='play') return;
  lv.pieces++; lv.lines+=total; lv.combo=Math.max(lv.combo,combo); if(swept) lv.swept=true;
  syncHud();
  if(goalProgress()>=lvl.goal.n) levelWin();
}
function levelWin(){
  state='won'; stuck=false; clearRun('adventure'); syncActions();
  const L=lvl, stars=starsFor(L,lv.pieces), rec=advRec(L.id), first=rec.n===0;
  rec.n++; rec.s=Math.max(rec.s,stars); rec.p=rec.p?Math.min(rec.p,lv.pieces):lv.pieces; rec.f=0;
  saveAdv(); saveStats(); checkGoals();
  pushBanner('LEVEL CLEARED','','#8FF7FF'); if(!reduce) spawnConfetti(); glowT=Math.max(glowT,1.4); Sfx.fanfare();
  setTimeout(()=>showWin(stars,first),reduce?300:1200);
}
function showWin(stars,first){
  if(state!=='won') return;
  const L=lvl, last=L.id===LEVELS.length;
  el('winEye').textContent='Level '+L.id+' · '+goalText(L.goal);
  el('winTitle').textContent=last?'You did it!':'Cleared!';
  el('winStars').textContent=starStr(stars);
  el('winMsg').textContent=last?'That is every level. You are a Crumble master.'
    :stars===3?'Perfect! Three stars.':'Beat '+L.par[1]+' pieces or fewer for more stars. You used '+lv.pieces+'.';
  el('winNext').hidden=last; el('winNext').textContent='Next level';
  el('winCard').hidden=false;
}
// the game-over card, for a level
function levelFailed(){
  const rec=advRec(lvl.id); rec.f++; saveAdv();
  const g=lvl.goal, p=Math.min(goalProgress(),g.n);
  el('overEye').textContent='Level '+lvl.id;
  el('overScore').textContent=p+'/'+g.n;
  el('overMsg').textContent=p>=g.n*0.7?'So close! One more try.':'You can do it. Try again!';
  el('againBtn').textContent='Play again'; el('overMenuBtn').textContent='Home';
}

/* ── switching modes ── */
function overlayOpen(){ return ['pauseCard','setPanel','menuCard','mapCard','dailyCard','goalsCard','chalCard','devPanel'].some(id=>!el(id).hidden); }
function pauseForMenu(){ if(state==='play'){ paused=true; hapSelect('end'); drag=null; shake=0; hesVoid(); } }
function hideMenus(){ el('goalsCard').hidden=true; el('menuCard').hidden=true; el('mapCard').hidden=true; el('dailyCard').hidden=true; el('chalCard').hidden=true; el('winCard').hidden=true; paused=false; }
function leaveMode(){ if(state==='play') saveRun(); lastRunJson=null; rndSrc=null; }      // keep what she was doing; it is waiting when she comes back
function openMenu(){
  pauseForMenu(); el('winCard').hidden=true; el('mapCard').hidden=true; el('dailyCard').hidden=true; el('goalsCard').hidden=true; el('chalCard').hidden=true;
  el('menuChalSub').textContent=chTileSub();
  const today=daily.d[dailyKey()], liveD=peekRun('daily');
  el('menuDailySub').textContent=liveD&&liveD.dk===dailyKey()?'Today: in progress':today?'Today: best '+today.s:'New board today';
  el('menuAdvSub').textContent=advStars()?'Level '+nextLevel().id+' · ★ '+advStars():'Goal levels, no timer';
  el('menuGoalsSub').textContent=streakNow()?'🔥 '+streakNow()+(streakNow()===1?' day':' days')+' in a row':'Streak and unlocks';
  const liveE=mode==='endless'&&state==='play'?{score}:peekRun('endless');   // (8.4) a saved endless run waits here
  el('menuBest').textContent=liveE&&liveE.score?'Continue · '+fmtScore(liveE.score):liveE?'Continue':'Play as long as you can';
  el('menuCard').hidden=false;
}
function closeMenu(){                              // back to wherever she came from: the game, or the card that was up (a won level, game over)
  el('menuCard').hidden=true;
  if(state==='won') el('winCard').hidden=false; else if(state==='over'){ el('overCard').hidden=false; tlResume(); }
  if(!overlayOpen()) paused=false;
}
function playEndless(){
  leaveMode(); hideMenus(); mode='endless'; lvl=null; saveMode();
  if(!loadRun()) start(); else syncHud();
}
function peekRun(m){ try{ return JSON.parse(localStorage.getItem(runStore(m))||'null'); }catch(e){ return null; } }
function playLevel(id){
  if(!levelOpen(id)) return;
  leaveMode(); hideMenus(); mode='adventure'; lvl=LEVELS[id-1]; saveMode();
  const o=peekRun('adventure');
  if(!(o&&o.lv&&o.lv.id===id&&loadRun())) start();
  syncHud();
}
function openMap(){
  pauseForMenu(); el('menuCard').hidden=true; el('winCard').hidden=true; el('dailyCard').hidden=true; el('chalCard').hidden=true;
  const list=el('mapList'); list.textContent='';
  const nxt=nextLevel().id, live=peekRun('adventure'), liveId=live&&live.lv?live.lv.id:0;
  el('mapStars').textContent='★ '+advStars()+' / '+LEVELS.length*3;
  CHAPTERS.forEach((name,ci)=>{
    const h=document.createElement('p'); h.className='setgroup'; h.textContent=(ci+1)+'. '+name; list.append(h);
    const row=document.createElement('div'); row.className='nodes'; list.append(row);
    for(const L of LEVELS.filter(x=>x.ch===ci)){
      const d=adv.lv[L.id], open=levelOpen(L.id), b=document.createElement('button');
      b.type='button'; b.dataset.id=L.id; b.disabled=!open;
      b.className='node'+(levelDone(L.id)?' done':'')+(L.id===nxt?' next':'');
      b.setAttribute('aria-label','Level '+L.id+': '+goalText(L.goal)+(open?'':', locked'));
      b.innerHTML='<span class="num"></span><span class="st"></span>';
      b.firstChild.textContent=open?L.id:'🔒';
      b.lastChild.textContent=L.id===liveId?'▶':levelDone(L.id)?starStr(d.s):'';
      b.onclick=e=>{ e.stopPropagation(); playLevel(L.id); };
      row.append(b);
    }
  });
  el('mapCard').hidden=false;
  const n=list.querySelector('.next'); if(n) n.scrollIntoView({block:'center'});
}
/* ── (8.4) pause: Resume, Home (the run is saved), or New game (tap twice) ── */
let pauseNewT=0;
function pauseNewReset(){ clearTimeout(pauseNewT); const b=el('pauseNew'); b.textContent=b.dataset.lbl||'New game'; b.classList.remove('confirm'); }
function openPause(){
  if(state!=='play'||overlayOpen()) return;
  pauseForMenu(); pauseNewReset();
  const adventure=mode==='adventure'&&lvl;
  el('pauseEye').textContent='Paused · '+(adventure?'Level '+lvl.id:mode==='daily'?'Daily':mode==='challenge'&&chal?chLabel(chal.seed):'Endless');
  el('pauseScore').textContent=score.toLocaleString('en-US');
  el('pauseMsg').textContent=adventure?goalText(lvl.goal)+'. Your game is saved.':mode==='challenge'&&chal?'Tray '+Math.min(trayNo,CH_TRAYS)+' of '+CH_TRAYS+'. Your game is saved.':'Your game is saved.';
  el('pauseNew').dataset.lbl=mode==='challenge'?'Restart':'New game'; pauseNewReset();
  el('pauseCard').hidden=false;
}
function closePause(){ pauseNewReset(); el('pauseCard').hidden=true; if(!overlayOpen()) paused=false; }
addEventListener('keydown',e=>{                          // (C4) desktop: Escape or P opens and closes the pause card
  if(e.ctrlKey||e.metaKey||e.altKey||e.repeat) return;
  const k=e.key; if(k!=='Escape'&&k!=='p'&&k!=='P') return;
  if(!el('pauseCard').hidden){ closePause(); return; }
  if(state==='play'&&!overlayOpen()) openPause();
});
el('pauseBtn').onclick=e=>{ e.stopPropagation(); openPause(); };
el('pauseResume').onclick=e=>{ e.stopPropagation(); closePause(); };
el('pauseHome').onclick=e=>{ e.stopPropagation(); pauseNewReset(); el('pauseCard').hidden=true; saveRun(); openMenu(); };
el('pauseNew').onclick=e=>{
  e.stopPropagation(); const b=el('pauseNew');
  if(!b.classList.contains('confirm')){ b.textContent='Tap again to start over'; b.classList.add('confirm'); pauseNewT=setTimeout(pauseNewReset,3000); return; }
  closePause(); start();
};
el('menuEndless').onclick=e=>{ e.stopPropagation(); homeCrumble(); playEndless(); };
el('menuAdv').onclick=e=>{ e.stopPropagation(); openMap(); };
el('menuClose').onclick=e=>{ e.stopPropagation(); closeMenu(); };
el('mapBack').onclick=e=>{ e.stopPropagation(); openMenu(); };
el('winNext').onclick=e=>{ e.stopPropagation(); playLevel(Math.min(lvl.id+1,LEVELS.length)); };
el('winMap').onclick=e=>{ e.stopPropagation(); openMap(); };
el('winAgain').onclick=e=>{ e.stopPropagation(); el('winCard').hidden=true; start(); };
el('overMenuBtn').onclick=e=>{ e.stopPropagation(); el('overCard').hidden=true; openMenu(); };   // (8.1) Home is the front menu, whatever the mode
el('startAdv').onclick=e=>{ e.stopPropagation(); ac(); openMap(); };

/* ── the Daily card: today's board and a results calendar ── */
let calY=0, calM=0;
function playDaily(){
  leaveMode(); hideMenus(); mode='daily'; lvl=null; saveMode();
  const o=peekRun('daily');
  if(!(o&&o.dk===dailyKey()&&loadRun())) start();
  syncHud();
}
function openDaily(month){
  pauseForMenu(); el('menuCard').hidden=true; el('mapCard').hidden=true; el('winCard').hidden=true; el('chalCard').hidden=true;
  const now=new Date(), key=dailyKey(now), today=daily.d[key], live=peekRun('daily');
  if(!month){ calY=now.getFullYear(); calM=now.getMonth(); }
  const inProg=live&&live.dk===key;
  el('dailyDate').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  el('dailyStatus').textContent=inProg?'In progress · '+live.score+' points':today?'Best today: '+today.s+' · played '+today.n+(today.n===1?' time':' times'):'Not played yet';
  el('dailyPlay').textContent=inProg?'Continue':today?'Play again':"Play today's";
  const days=Object.keys(daily.d).filter(k=>daily.d[k].n>0), top=days.reduce((a,k)=>Math.max(a,daily.d[k].s),0);
  el('dailyTotals').textContent=days.length?days.length+(days.length===1?' day':' days')+' played · best day '+top:'Play today and your first day lands here';
  const first=days.sort()[0], fy=first?+first.slice(0,4):now.getFullYear(), fm=first?+first.slice(5,7)-1:now.getMonth();
  el('calTitle').textContent=new Date(calY,calM,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  el('calPrev').disabled=calY*12+calM<=fy*12+fm; el('calNext').disabled=calY*12+calM>=now.getFullYear()*12+now.getMonth();
  const g=el('calGrid'); g.textContent='';
  for(const d of 'SMTWTFS'){ const h=document.createElement('span'); h.className='dow'; h.textContent=d; g.append(h); }
  const lead=new Date(calY,calM,1).getDay(), n=new Date(calY,calM+1,0).getDate();
  for(let i=0;i<lead;i++) g.append(document.createElement('span'));
  for(let d=1;d<=n;d++){
    const k=dailyKey(new Date(calY,calM,d)), r=daily.d[k], c=document.createElement('span');
    c.className='day'+(r&&r.n?' on':'')+(k===key?' today':'')+(k>key?' future':'');
    c.innerHTML='<b></b><i></i>'; c.firstChild.textContent=d; c.lastChild.textContent=r&&r.n?fmtScore(r.s):'';
    g.append(c);
  }
  el('dailyCard').hidden=false;
}
el('menuDaily').onclick=e=>{ e.stopPropagation(); openDaily(); };
el('startDaily').onclick=e=>{ e.stopPropagation(); ac(); openDaily(); };
el('dailyPlay').onclick=e=>{ e.stopPropagation(); playDaily(); };
el('dailyBack').onclick=e=>{ e.stopPropagation(); openMenu(); };
el('calPrev').onclick=e=>{ e.stopPropagation(); calM--; if(calM<0){ calM=11; calY--; } openDaily(true); };
el('calNext').onclick=e=>{ e.stopPropagation(); calM++; if(calM>11){ calM=0; calY++; } openDaily(true); };

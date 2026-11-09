// Crumble — Modes (plan 4.1): Adventure levels, the mode menu and their saved progress.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ modes ═══════
   Endless is the default and unchanged. Adventure is 30 short goal levels (no timer) on a map; each level is a
   normal run with a goal, so Undo, the dealer, save/resume, specials and looks all work as they do anywhere.
   Every mode keeps its own saved run (`crumble.run` endless, `crumble.run.adv`, `crumble.run.daily`), so
   switching never loses a game. Progress lives in `crumble.adv`, plain data meant to be extended:
     {v:1, lv:{ "7":{s:2, p:14, n:3, f:1} }}    s best stars (0-3), p fewest pieces, n times cleared, f failed tries */
const MODE_STORE='crumble.mode', ADV_STORE='crumble.adv';
const runStore=m=>m==='adventure'?'crumble.run.adv':m==='daily'?'crumble.run.daily':'crumble.run';
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
const LEVELS=LEVEL_DEFS.map(([type,n,fill],i)=>({id:i+1,ch:(i/6)|0,goal:{type,n},fill,par:LEVEL_PAR[i]||[99,99]}));
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
  try{ const m=localStorage.getItem(MODE_STORE); if(m==='adventure') mode=m; }catch(e){}
  loadAdv();
}
const saveMode=()=>{ try{ localStorage.setItem(MODE_STORE,mode); }catch(e){} };

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
  lv={lines:0,pieces:0,combo:0,swept:false};
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
function syncHud(){
  const adventure=mode==='adventure'&&lvl;
  let lbl='Best', val=best;
  if(adventure){
    const g=lvl.goal, p=Math.min(goalProgress(),g.n);
    if(g.type==='lines'){ lbl='Lines'; val=p+'/'+g.n; }
    else if(g.type==='combo'){ lbl='Combo'; val=p+'/'+g.n; }
    else if(g.type==='score'){ lbl='Goal'; val=g.n; }
    else { lbl='Goal'; val='Empty it'; }
  }
  el('bestLbl').textContent=lbl; el('bestVal').textContent=val;
  el('modeTag').textContent=adventure?'Level '+lvl.id+' ▾':'Endless ▾';
}
// place() calls this after every placement
function goalStep(total,swept){
  if(mode!=='adventure'||!lvl||state!=='play') return;
  lv.pieces++; lv.lines+=total; lv.combo=Math.max(lv.combo,combo); if(swept) lv.swept=true;
  syncHud();
  if(goalProgress()>=lvl.goal.n) levelWin();
}
function levelWin(){
  state='won'; undoSnap=null; stuck=false; clearRun('adventure'); syncActions();
  const L=lvl, stars=starsFor(L,lv.pieces), rec=advRec(L.id), first=rec.n===0;
  rec.n++; rec.s=Math.max(rec.s,stars); rec.p=rec.p?Math.min(rec.p,lv.pieces):lv.pieces; rec.f=0;
  saveAdv(); saveStats();
  pushBanner('LEVEL CLEARED','','#8FF7FF'); if(!reduce) spawnConfetti(); glowT=Math.max(glowT,1.4); Sfx.praise(3);
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
  el('overEye').textContent='Level '+lvl.id+' · out of moves';
  el('overScore').textContent=p+'/'+g.n;
  el('overMsg').textContent=p>=g.n*0.7?'So close! One more try.':'You can do it. Try again!';
  el('againBtn').textContent='Try again'; el('overMenuBtn').textContent='Map';
}

/* ── switching modes ── */
function overlayOpen(){ return ['setPanel','menuCard','mapCard','blastCard'].some(id=>!el(id).hidden); }
function pauseForMenu(){ if(state==='play'){ paused=true; drag=null; shake=0; hesVoid(); } }
function hideMenus(){ el('menuCard').hidden=true; el('mapCard').hidden=true; el('winCard').hidden=true; paused=false; }
function leaveMode(){ if(state==='play') saveRun(); lastRunJson=null; }      // keep what she was doing; it is waiting when she comes back
function openMenu(){
  pauseForMenu(); el('winCard').hidden=true; el('mapCard').hidden=true;
  el('menuAdvSub').textContent=advStars()?'★ '+advStars()+' of '+LEVELS.length*3+' · level '+nextLevel().id:'Goal levels, no timer';
  el('menuBest').textContent=best?'Best '+best:'Play as long as you can';
  el('menuCard').hidden=false;
}
function closeMenu(){                              // back to wherever she came from: the game, or the card that was up (a won level, game over)
  el('menuCard').hidden=true;
  if(state==='won') el('winCard').hidden=false; else if(state==='over') el('overCard').hidden=false;
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
  pauseForMenu(); el('menuCard').hidden=true; el('winCard').hidden=true;
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
el('modeTag').onclick=e=>{ e.stopPropagation(); openMenu(); };
el('menuEndless').onclick=e=>{ e.stopPropagation(); playEndless(); };
el('menuAdv').onclick=e=>{ e.stopPropagation(); openMap(); };
el('menuClose').onclick=e=>{ e.stopPropagation(); closeMenu(); };
el('mapBack').onclick=e=>{ e.stopPropagation(); openMenu(); };
el('winNext').onclick=e=>{ e.stopPropagation(); playLevel(Math.min(lvl.id+1,LEVELS.length)); };
el('winMap').onclick=e=>{ e.stopPropagation(); openMap(); };
el('winAgain').onclick=e=>{ e.stopPropagation(); el('winCard').hidden=true; start(); };
el('overMenuBtn').onclick=e=>{ e.stopPropagation(); el('overCard').hidden=true; if(mode==='adventure') openMap(); else openMenu(); };
el('startAdv').onclick=e=>{ e.stopPropagation(); ac(); openMap(); };

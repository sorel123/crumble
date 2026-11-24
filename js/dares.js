// Crumble — Crumb's dares: one small dare a run, in his voice; beating it pays a cookie into the jar.
// Plain script, loaded in order by index.html (after crumbsay.js); shares globals with the other js/ files.
/* Runs had no goal but a bigger score. In Endless (not Daily, Adventure, Challenge or the guided first game), once the
   first tray is on the board, the crumb dares her: he says it (a bubble held DARE_SAY_MS) and a small chip under the HUD
   buttons keeps the dare and its progress up for the rest of the run. Beaten: he pays up grudgingly, a cookie hops from him
   into the jar on the chip (a clink, a haptic), the chip ticks, and DARE_NEXT_MS later he issues the next, harder one
   ("double or nothing."), up to DARE_MAX a run. A dare that can no longer be beaten this run ("don't flick me") fails with
   "knew it." and no other is offered until the next run. A run that ends with a dare open gets one line ("told you.").
   Nothing is ever lost: no penalty, ever.
   Picking: a tier is rolled first (DARE_TIERS: the first dare of a run leans easy, later ones harder), then a dare in it;
   one she has beaten often is less likely (DARE_FADE), the last one is never picked twice in a row, and dares whose
   feature is off are not offered. Its own dice (dareRnd): the dealer's Math.random never moves, so pinned deals stay put.
   Checkers are fed from the game's events: place() calls dareDrop() once per drop, the cannonball's end calls
   dareCannon(), a throw of the crumb calls dareFlick(); the sky stage, the trays played and a new best are read in dareStep.
   Lines never land on a bigger moment: they queue (dare.q) until the board is quiet (no sweep show, banner, avalanche,
   charged crumb, last chance, deal, or another line still up), then speak through crumbSay.
   Saved: `crumble.dares` = {v:1, cookies, won:{id:count}, days:{last:'YYYY-MM-DD', streak, best}, prev:id} (prev: the last dare,
   so the next run does not repeat it). The open dare rides in the run save (`dr`). iCloud (cloud.js) backs the jar up.
   Switch: CFG.DARES (Settings > Look > Advanced "Crumb's dares", saved `dares`); with the mascot off there are none. */
const DARE_STORE='crumble.dares';
// kind: drop (lines in one drop), cross (a row and a column in one drop), combo, lines (this run), sweep, colour, ava,
// cannon (gems one cannonball breaks), noflick (trays without a throw), sky (journey stop, skyStop: Night ~tray 28, Space ~tray 53 for the
// person-like bot since the stops were re-spaced, so night is medium and space hard), best. tier: 0 easy, 1 medium, 2 hard
const DARES=[
  {id:'drop2',   tier:0, kind:'drop',   need:2,  chip:'2 lines in one drop', say:["bet you can't clear two at once.","two lines. one drop. go on."]},
  {id:'drop3',   tier:1, kind:'drop',   need:3,  chip:'3 lines in one drop', say:["bet you can't clear three at once.","three lines, one drop. I'll wait."]},
  {id:'drop4',   tier:2, kind:'drop',   need:4,  chip:'4 lines in one drop', say:["four lines at once. ha. no.","clear four in one go. I dare you."]},
  {id:'cross',   tier:1, kind:'cross',  need:1,  chip:'row + column, one drop', say:["a row AND a column. one drop.","clear a cross. bet you can't."]},
  {id:'combo4',  tier:0, kind:'combo',  need:4,  chip:'combo 4', say:["combo 4. not holding my breath.","get a combo of 4. go on."]},
  {id:'combo7',  tier:1, kind:'combo',  need:7,  chip:'combo 7', say:["combo 7. I'll be over here.","bet you can't make it to combo 7."]},
  {id:'combo12', tier:2, kind:'combo',  need:12, chip:'combo 12', say:["combo 12. not a chance.","combo 12. I'll get comfy."]},
  {id:'lines15', tier:0, kind:'lines',  need:15, chip:'15 lines', say:["clear 15 lines. take your time.","15 lines. I'm counting."]},
  {id:'lines40', tier:1, kind:'lines',  need:40, chip:'40 lines', say:["40 lines this run. I dare you.","40 lines. I'll keep score."]},
  {id:'sweep',   tier:1, kind:'sweep',  need:1,  chip:'sweep the board', say:["sweep the board. I'll wait.","empty the whole board. go on."]},
  {id:'sweep2',  tier:2, kind:'sweep',  need:2,  chip:'sweep the board twice', say:["sweep the board. twice. ha.","two clean sweeps. I dare you."]},
  {id:'colour',  tier:0, kind:'colour', need:1,  chip:'wipe out a colour', say:["make a colour vanish. bet you can't.","wipe out a whole colour. go on."]},
  {id:'ava',     tier:1, kind:'ava',    need:1,  chip:'set off an Avalanche', say:["bring the board down. I dare you.","start an avalanche. I'll hold on."]},
  {id:'cannon8', tier:1, kind:'cannon', need:8,  chip:'cannonball 8 gems', say:["throw me through 8 gems.","8 gems with one throw of me. go."]},
  {id:'cannon15',tier:2, kind:'cannon', need:15, chip:'cannonball 15 gems', say:["15 gems with one throw. ha.","throw me through 15. bet you can't."]},
  {id:'noflick', tier:1, kind:'noflick',need:15, chip:"don't flick me", say:["don't flick me for 15 trays. I dare you.","don't flick me. I dare you."]},
  {id:'night',   tier:1, kind:'sky',    need:3,  chip:'reach Night', say:["get us to night. I'm sleepy.","bet you can't reach night."]},
  {id:'space',   tier:2, kind:'sky',    need:5,  chip:'reach Space', say:["take me to space. I'll wait.","space. bet you can't."]},
  {id:'best',    tier:2, kind:'best',   need:1,  chip:'beat your best', say:["beat your best. no pressure.","beat your best. I'll watch."]},
];
const dareDef=id=>DARES.find(d=>d.id===id)||null;
// the jar (persistent) and this run's dare: id, progress p, x (the tray it began on: noflick), s (0 open, 1 beaten, 2 failed),
// n (dares issued this run), off (no dares this run: the guided first game). q: lines waiting for a quiet board
const dare={st:{cookies:0,won:{},days:{last:'',streak:0,best:0},prev:''},
  id:'',p:0,x:0,s:0,n:0,off:false,q:[],nextAt:0,el:null,jar:null,key:'',hop:null,jarShown:0};
let dareSeed=(Date.now()%2147483646)+1;                // its own dice: the game's Math.random (seeded in tests) stays untouched
const dareRnd=()=>(dareSeed=(dareSeed*16807)%2147483647)/2147483647;
const daresOn=()=>!!CFG.DARES&&!!CFG.FX_MASCOT&&mode==='endless';
const dareOpen=()=>daresOn()&&!!dare.id&&dare.s===0;
const dareBusy=()=>!!dare.hop;                         // draw.js fxBusy: full frame rate while the cookie hops

/* ── the jar: crumble.dares ── */
function loadDares(){
  try{
    const o=JSON.parse(localStorage.getItem(DARE_STORE)||'null');
    if(!o||o.v!==1) return;
    if(isInt(o.cookies,0,1e6)) dare.st.cookies=o.cookies;
    if(o.won&&typeof o.won==='object') for(const id in o.won) if(/^[a-z0-9]{1,16}$/.test(id)&&isInt(o.won[id],0,1e6)) dare.st.won[id]=o.won[id];
    const d=o.days;
    if(d&&/^\d{4}-\d\d-\d\d$/.test(d.last||'')&&isInt(d.streak,0,1e5)&&isInt(d.best,0,1e5)) dare.st.days={last:d.last,streak:d.streak,best:Math.max(d.best,d.streak)};
    if(typeof o.prev==='string'&&dareDef(o.prev)) dare.st.prev=o.prev;
  }catch(e){}
  dare.jarShown=dare.st.cookies;
}
function saveDares(){
  const s=dare.st;
  try{ localStorage.setItem(DARE_STORE,JSON.stringify({v:1,cookies:s.cookies,won:s.won,days:s.days,prev:s.prev})); }catch(e){}
  if(typeof cloudDirty==='function') cloudDirty();
}
const daresWon=()=>Object.values(dare.st.won).reduce((a,b)=>a+b,0);
function dareStreak(){                                 // days in a row with a dare beaten (alive while the last one was today or yesterday)
  const d=dare.st.days, t=dailyKey();
  return d.last===t||d.last===addDays(t,-1)?d.streak:0;
}

/* ── the run's dare ── */
function dareRunReset(){ dare.id=''; dare.p=0; dare.x=0; dare.s=0; dare.n=0; dare.off=false; dare.q=[]; dare.nextAt=0; }   // flow.js clearRunFx
const dareSnap=()=>mode==='endless'&&(dare.id||dare.off)?{i:dare.id,p:dare.p,x:dare.x,s:dare.s,n:dare.n,o:dare.off?1:0}:null;   // save.js snapshot `dr`
function dareLoad(o){                                  // save.js restore (after clearRunFx); an older save starts without one and gets a fresh dare
  if(!o||typeof o!=='object'||mode!=='endless') return;
  if(o.o===1){ dare.off=true; return; }
  if(!dareDef(o.i)||!isInt(o.p,0,1e6)||!isInt(o.x,0,1e6)||!isInt(o.s,0,2)||!isInt(o.n,1,CFG.DARE_MAX)) return;
  dare.id=o.i; dare.p=o.p; dare.x=o.x; dare.s=o.s; dare.n=o.n;
}
function darePick(){                                   // the roll: a tier by the run's odds, then a dare in it, never the last one again
  const live=combo, ok=d=>{
    if(d.id===dare.st.prev||d.id===dare.id) return false;
    if(d.kind==='combo') return live<d.need;
    if(d.kind==='ava') return !!CFG.AVALANCHE;
    if(d.kind==='cannon') return !!CFG.CRUMB_CANNON&&toyOn();
    if(d.kind==='noflick') return toyOn();
    if(d.kind==='sky') return !!CFG.JOURNEY_SKY&&skyStop()<d.need;   // (sky bite) the same stop count as the end card's "You reached Night."
    if(d.kind==='best') return best>0&&!bestBeaten;
    return true;
  };
  const pool=DARES.filter(ok); if(!pool.length) return null;
  const odds=CFG.DARE_TIERS[Math.min(dare.n,CFG.DARE_TIERS.length-1)]||[1,1,1];
  const tw=[0,1,2].map(t=>pool.some(d=>d.tier===t)?odds[t]||0:0), sum=tw.reduce((a,b)=>a+b,0);
  let tier=pool[0].tier;
  if(sum>0){ let r=dareRnd()*sum; for(let t=0;t<3;t++){ if(tw[t]<=0) continue; tier=t; if((r-=tw[t])<0) break; } }
  const set=pool.filter(d=>d.tier===tier), w=set.map(d=>1/(1+CFG.DARE_FADE*(dare.st.won[d.id]|0))), ws=w.reduce((a,b)=>a+b,0);
  let r=dareRnd()*ws; for(let i=0;i<set.length;i++){ if((r-=w[i])<0) return set[i]; }
  return set[set.length-1];
}
const sayOf=d=>d.say[Math.floor(dareRnd()*d.say.length)%d.say.length];
function dareQueue(txt,ms,ttl){ if(CFG.FX_CRUMB_TALK) dare.q.push({txt,ms:ms||0,exp:ttl?performance.now()+ttl:0}); }   // ttl: a line that is stale after this long is dropped (cookie.js)
function dareIssue(){
  const d=darePick(); if(!d){ dare.off=true; return; }
  const next=dare.n>0;
  dare.id=d.id; dare.p=0; dare.x=trayNo; dare.s=0; dare.n++;
  dare.st.prev=d.id; saveDares();
  if(next) dareQueue(sayPick('dareNext'),1800);
  dareQueue(sayOf(d),CFG.DARE_SAY_MS);
  if(state==='play'&&!dealing) saveRun();
}
function dareWin(){
  const d=dareDef(dare.id); if(!d||dare.s!==0) return;
  dare.s=1; dare.nextAt=performance.now()+CFG.DARE_NEXT_MS; rc.w++;   // (report) dares beaten this run
  const s=dare.st; s.cookies++; s.won[d.id]=(s.won[d.id]|0)+1;
  const t=dailyKey(), dy=s.days;
  if(dy.last!==t){ dy.streak=dy.last===addDays(t,-1)?dy.streak+1:1; dy.last=t; dy.best=Math.max(dy.best,dy.streak); }
  saveDares();
  dare.q=[]; dareQueue(sayPick('dareWin'),2600);
  dareCookie();
}
// (Lab) a cookie into the jar from outside the dares (Clear it in three pays one for every 5th puzzle solved): the clink and
// the haptic, a hop if the chip is up. It only ever adds: cookies merge across devices by max (cloud.js)
function dareGift(){ dare.st.cookies++; saveDares(); dareCookie(); return dare.st.cookies; }
function dareFail(){ if(dare.s!==0) return; dare.s=2; dare.q=[]; dareQueue(sayPick('dareFail'),2600); if(state==='play'&&!dealing) saveRun(); }

/* ── the checkers, fed by the game ── */
// place(): every drop. lines = this drop's own lines (rows, cols), all = with the avalanche's, gone = a colour wiped out, avaHit = an avalanche fell
function dareDrop(rows,cols,all,swept,gone,avaHit,star){
  if(!dareOpen()) return;
  const d=dareDef(dare.id), k=d.kind;
  if(k==='drop'){ if(!star&&rows+cols>=d.need) dareWin(); }
  else if(k==='cross'){ if(!star&&rows>0&&cols>0) dareWin(); }
  else if(k==='combo'){ if(combo>=d.need) dareWin(); }
  else if(k==='lines'){ dare.p=Math.min(d.need,dare.p+all); if(dare.p>=d.need) dareWin(); }
  else if(k==='sweep'){ if(swept){ dare.p++; if(dare.p>=d.need) dareWin(); } }
  else if(k==='colour'){ if(gone) dareWin(); }
  else if(k==='ava'){ if(avaHit) dareWin(); }
  else dareTick();
}
function dareCannon(n){                                // crumbtoy.js toyFireEnd: a cannonball broke n gems
  rc.g=Math.max(rc.g,n);                               // (report) the run's best throw
  if(!dareOpen()) return;
  const d=dareDef(dare.id); if(d.kind!=='cannon') return;
  dare.p=Math.max(dare.p,Math.min(n,d.need)); if(n>=d.need) dareWin();
}
function dareFlick(){                                  // crumbtoy.js toyUp: she threw the crumb
  rc.t++;                                              // (report) throws this run
  if(dareOpen()&&dareDef(dare.id).kind==='noflick') dareFail();
}
function dareTick(){                                   // the ones read off the game's state
  if(!dareOpen()) return;
  const d=dareDef(dare.id), k=d.kind;
  if(k==='noflick'){ dare.p=Math.min(d.need,Math.max(0,trayNo-dare.x)); if(dare.p>=d.need) dareWin(); }
  else if(k==='sky'){ if(skyStop()>=d.need) dareWin(); }
  else if(k==='best'){ if(bestBeaten) dareWin(); }
  if(dare.s===1&&state==='play'&&!dealing) saveRun();
}

/* ── the chip, the cookie, the lines: mascot.js mascotStep calls this every drawn frame ── */
const JAR_SVG='<svg viewBox="0 0 20 20" aria-hidden="true"><path class="jl" d="M5 3.5h10v2.2H5z"/><path class="jb" d="M5.6 5.7h8.8c1.2 1.3 1.9 2.8 1.9 4.6v4.6c0 1.6-1.2 2.6-2.8 2.6H6.5c-1.6 0-2.8-1-2.8-2.6v-4.6c0-1.8.7-3.3 1.9-4.6z"/><circle class="jc" cx="10" cy="12.4" r="3.4"/><circle class="jd" cx="9" cy="11.6" r=".7"/><circle class="jd" cx="11.2" cy="13.3" r=".6"/></svg>';
const COOKIE_SVG='<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="#D9A05B" stroke="#6E4220" stroke-width="1.4"/><circle cx="7" cy="8" r="1.4" fill="#4A2A12"/><circle cx="12.6" cy="7" r="1.1" fill="#4A2A12"/><circle cx="11.5" cy="12.6" r="1.4" fill="#4A2A12"/><circle cx="6.6" cy="13" r=".9" fill="#4A2A12"/></svg>';
function dareInit(){
  const c=el('dareChip'); if(!c) return;
  c.innerHTML='<span class="jar">'+JAR_SVG+'<b>0</b></span><span class="w"><span class="k">DARE</span> <span class="t"></span> <span class="p"></span></span>';
  dare.el=c; dare.jar=c.querySelector('.jar');
}
function dareText(){                                   // the chip's words and progress, and the pause card's line
  const d=dareDef(dare.id); if(!d) return null;
  const counted=d.kind==='lines'||d.kind==='noflick'||(d.kind==='sweep'&&d.need>1)||(d.kind==='cannon'&&dare.p>0);
  return {t:d.chip,p:dare.s===1?'✓':dare.s===2?'✗':counted?dare.p+'/'+d.need:''};
}
// one cookie animation for the whole game: a cookie hops from (x0,y0) to (x1,y1), its scale [start, top of the hop, end], then done(). Dares: from the crumb
// into the jar; a cookie on the board (cookie.js): from its gem into the crumb. Web Animations on one DOM element (~0.7 s)
function cookieHop(x0,y0,x1,y1,[s0,sm,s1],done){
  const ck=document.createElement('div'); ck.className='dareCookie'; ck.innerHTML=COOKIE_SVG;
  ck.style.left=x0-9+'px'; ck.style.top=y0-9+'px';
  el('stage').appendChild(ck);
  const dx=x1-x0, dy=y1-y0, up=Math.min(y0,y1)-y0-60;
  const a=ck.animate([
    {transform:`translate(0,0) scale(${s0}) rotate(0deg)`},
    {transform:`translate(${dx*.35}px,${up}px) scale(${sm}) rotate(200deg)`,offset:.4},
    {transform:`translate(${dx}px,${dy}px) scale(${s1}) rotate(420deg)`}],{duration:720,easing:'cubic-bezier(.35,.1,.5,1)'});
  toyPlay(0,t=>tone(t,{f0:700,f1:1300,pdur:.12,dur:.16,vol:.04,type:'triangle'}));
  a.onfinish=()=>{ ck.remove(); done(); };
  a.oncancel=()=>{ ck.remove(); done(); };
  return a;
}
function jarTick(hap){                                 // the cookie is in: the jar counts it, a clink, a tap of haptics
  dare.jarShown=dare.st.cookies; dare.key='';
  toyPlay(0,t=>{ tone(t,{f0:1568,pdur:.02,dur:.12,vol:.05,type:'triangle'}); tone(t+.06,{f0:2093,pdur:.02,dur:.18,vol:.04,type:'triangle'}); });
  haptic(hap);
  if(dare.jar&&!reduce&&dare.el&&!dare.el.hidden) dare.jar.animate([{transform:'none'},{transform:'scale(1.35)'},{transform:'none'}],{duration:320,easing:'ease-out'});
}
function dareCookie(){                                 // a cookie hops from the crumb into the jar, a clink, a tap of haptics
  const land=()=>{ dare.hop=null; jarTick('achieve'); };
  if(reduce||!dare.el||dare.el.hidden||!masc.el||masc.el.hidden){ land(); return; }
  const j=dare.jar.getBoundingClientRect(), s=masc.s*toy.sc;
  dare.hop=cookieHop(masc.x+toy.x+masc.s/2,masc.y+toy.y+masc.s-s*.6,j.left+j.width/2,j.top+j.height/2,[.6,1.15,.7],land);
}
function dareQuiet(now){                               // nothing bigger is going on: a dare line may speak
  return state==='play'&&!paused&&!dealing&&!stuck&&!ava.live&&!toyHot()&&toy.mode==='rim'&&!masc.fainted&&!toy.sl&&!toy.demo   // (stakes) not while she aims the slingshot or its demo shows
    &&!banners.length&&!sweepShow&&!bands.length&&now>=say.until+350;
}
function dareStep(now,shown){
  const c=dare.el; if(!c) return;
  const on=shown&&daresOn()&&state==='play';
  if(on&&!paused){
    if(dare.id&&dare.s===0) dareTick();
    const ready=!dealing&&tray.some(Boolean)&&!stuck;
    if(!dare.off&&ready&&(!dare.id||(dare.s===1&&dare.n<CFG.DARE_MAX&&now>=dare.nextAt&&!dare.q.length&&!dare.hop&&dareQuiet(now)))){   // the next one waits until he has paid up
      if(guide&&!dare.id) dare.off=true;               // the guided first game: no dares this run
      else dareIssue();
    }
    if(dare.q.length&&!CFG.FX_CRUMB_TALK) dare.q=[];
    while(dare.q.length&&dare.q[0].exp&&now>dare.q[0].exp) dare.q.shift();   // (cookie) a cookie line that waited too long is old news
    if(dare.q.length&&dareQuiet(now)){ const l=dare.q.shift(); crumbSay(l.txt,l.ms,'say dare',true); }
  }
  const tx=on&&dare.id?dareText():null;
  const key=tx?tx.t+'|'+tx.p+'|'+dare.s+'|'+dare.jarShown:'';
  if(key===dare.key) return; dare.key=key;
  if(!tx){ c.hidden=true; return; }
  c.hidden=false; c.className=(dare.s===1?'won':dare.s===2?'lost':'')+(reduce?' rm':'');
  c.querySelector('.t').textContent=tx.t; c.querySelector('.p').textContent=tx.p;
  c.querySelector('.jar b').textContent=dare.jarShown;
  c.setAttribute('aria-label','Crumb\'s dare: '+tx.t+(tx.p?' '+tx.p:'')+'. Cookies: '+dare.jarShown);
}
function darePauseText(){                              // modes.js openPause
  if(!daresOn()||!dare.id) return '';
  const tx=dareText(), d=dareDef(dare.id);
  return dare.s===1?'Crumb\'s dare beaten: '+d.chip+' 🍪':dare.s===2?'Crumb\'s dare: '+d.chip+' (lost, next run)':'Crumb\'s dare: '+tx.t+(tx.p?' · '+tx.p:'');
}

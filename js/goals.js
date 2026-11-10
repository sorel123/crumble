// Crumble — Goals, unlock progress and the play streak (plan 4.2).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ goals ═══════
   Calm on purpose: nothing here can be lost or failed. A streak is "days she played", and one missed day only
   pauses it (the card says "play today to keep going", never a warning). Goals are lifetime ladders derived from
   `stats`, the Adventure record and the play days, one rung showing at a time; a reached rung gets one quiet banner.
   Saved in `crumble.goals` = {v:1, streak:{cur, best, last:"2026-11-09"}, done:["lines:25", ...]}. The first load
   marks every rung she has already passed as done without a banner, so nobody is greeted with a pile of old news. */
const GOALS_STORE='crumble.goals';
const goals={streak:{cur:0,best:0,last:''},done:new Set(),fresh:true,days:0};
const GOAL_FAMILIES=[
  {id:'lines',  rungs:[25,100,250,500,1000,2500], text:n=>'Clear '+n+' lines',            val:()=>stats.lines},
  {id:'games',  rungs:[3,10,25,50,100],           text:n=>'Play '+n+' games',             val:()=>stats.games},
  {id:'combo',  rungs:[3,4,5,6,8],                text:n=>'Make a combo of '+n,           val:()=>stats.bestCombo},
  {id:'sweeps', rungs:[1,3,10,25],                text:n=>n===1?'Clear the whole board':'Clear the whole board '+n+' times', val:()=>stats.sweeps},
  {id:'stars',  rungs:[10,30,60,90],              text:n=>'Earn '+n+' Adventure stars',   val:()=>advStars()},
  {id:'days',   rungs:[3,7,14,30,60],             text:n=>'Play on '+n+' different days', val:()=>goals.days},
  {id:'bonus',  rungs:[1,5,15],                   text:n=>n===1?'Earn a x2 bonus':'Earn '+n+' x2 bonuses', val:()=>stats.bonuses},
  {id:'chal',   rungs:[1,5,15],                   text:n=>n===1?'Win a challenge medal':'Win medals on '+n+' challenges', val:()=>chalRec.won}   // (E1)
];
const rungId=(f,n)=>f.id+':'+n;
const addDays=(key,n)=>{ const d=new Date(+key.slice(0,4),+key.slice(5,7)-1,+key.slice(8,10)+n); return dailyKey(d); };

function loadGoals(){
  try{
    const raw=localStorage.getItem(GOALS_STORE), o=JSON.parse(raw||'{}');
    goals.fresh=!raw;
    const s=o&&o.streak;
    if(s&&/^\d{4}-\d\d-\d\d$/.test(s.last||'')&&isInt(s.cur,0,1e5)&&isInt(s.best,0,1e5)) goals.streak={cur:s.cur,best:Math.max(s.best,s.cur),last:s.last};
    if(o&&isInt(o.days,0,1e5)) goals.days=o.days;
    if(o&&Array.isArray(o.done)) o.done.forEach(id=>{ if(typeof id==='string') goals.done.add(id); });
  }catch(e){}
  if(goals.fresh){ goals.days=Math.max(goals.days,Object.keys(daily.d).length,goals.streak.cur); checkGoals(false); saveGoals(); }
}
function saveGoals(){
  try{ localStorage.setItem(GOALS_STORE,JSON.stringify({v:1,streak:goals.streak,days:goals.days,done:[...goals.done]})); }catch(e){}
}
// the streak she is on right now: alive while she played today or yesterday
function streakNow(){
  const s=goals.streak, t=dailyKey();
  return s.last===t||s.last===addDays(t,-1)?s.cur:0;
}
// place() calls this: the first piece of a day counts the day
function playedToday(){
  const s=goals.streak, t=dailyKey();
  if(s.last===t) return;
  s.cur=s.last===addDays(t,-1)?s.cur+1:1; s.best=Math.max(s.best,s.cur); s.last=t; goals.days++;
  saveGoals();
}
// the rung she is working on in a family: the first one not yet reached
const goalRung=f=>f.rungs.find(n=>!goals.done.has(rungId(f,n)))||0;
function checkGoals(announce=true){
  let top=null, any=false;
  for(const f of GOAL_FAMILIES) for(const n of f.rungs){
    if(goals.done.has(rungId(f,n))||f.val()<n) continue;
    goals.done.add(rungId(f,n)); any=true; top=f.text(n);
  }
  if(any){ saveGoals(); gcSync(); if(announce&&top) pushBanner('GOAL REACHED',top,'#FFE9A8'); if(el('goalsCard')&&!el('goalsCard').hidden) renderGoals(); }
}

/* ── the card ── */
function nextSkin(){ return PICKABLE_SKINS.filter(s=>!isUnlocked(s.id)).sort((a,b)=>a.unlock-b.unlock)[0]||null; }
function goalRow(text,v,n){
  const r=document.createElement('div'); r.className='goal';
  const t=document.createElement('span'); t.textContent=text;
  const c=document.createElement('i'); c.textContent=Math.min(v,n)+' / '+n;
  const bar=document.createElement('div'); bar.className='bar'; const f=document.createElement('b'); f.style.width=Math.round(100*Math.min(1,v/n))+'%'; bar.append(f);
  r.append(t,c,bar); return r;
}
function streakText(){
  const cur=streakNow(), s=goals.streak;
  if(!s.last) return 'Play today to start a streak';
  if(cur===0) return 'Play today to start a new streak';
  return s.last===dailyKey()?'You played today. See you tomorrow!':'Play today to keep it going';
}
function renderGoals(){
  el('streakNum').textContent=streakNow(); el('streakSub').textContent=streakText();
  el('streakBest').textContent=goals.streak.best>1?'Best streak: '+goals.streak.best+' days':'';
  const un=el('goalUnlock'); un.textContent='';
  const sk=nextSkin();
  if(sk) un.append(goalRow('Next skin: '+sk.name,best,sk.unlock));
  for(const id of Object.keys(ACHIEVE)) if(!isWorldUnlocked(id)){
    const r=document.createElement('div'); r.className='goal lockrow';
    r.append(Object.assign(document.createElement('span'),{textContent:'🔒 '+TRANSFORMS[id].name+' look'}),Object.assign(document.createElement('i'),{textContent:ACHIEVE[id]}));
    un.append(r);
  }
  if(!un.children.length) un.append(Object.assign(document.createElement('p'),{className:'setnote',textContent:'Every look is yours.'}));
  const gl=el('goalList'); gl.textContent='';
  for(const f of GOAL_FAMILIES){ const n=goalRung(f); if(n) gl.append(goalRow(f.text(n),f.val(),n)); }
  if(!gl.children.length) gl.append(Object.assign(document.createElement('p'),{className:'setnote',textContent:'Every goal done. Wow.'}));
  el('goalsDone').textContent=goals.done.size?goals.done.size+(goals.done.size===1?' goal':' goals')+' reached':'';
}
function openGoals(){
  pauseForMenu(); el('menuCard').hidden=true; el('mapCard').hidden=true; el('dailyCard').hidden=true; el('winCard').hidden=true;
  renderGoals(); el('goalsCard').hidden=false;
}
el('menuGoals').onclick=e=>{ e.stopPropagation(); openGoals(); };
el('startGoals').onclick=e=>{ e.stopPropagation(); ac(); openGoals(); };
el('goalsBack').onclick=e=>{ e.stopPropagation(); openMenu(); };

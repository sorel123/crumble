// Crumble — the crumb talks back: a speech bubble or a little sign beside the mascot.
// Plain script, loaded in order by index.html (after crumbtoy.js); shares globals with the other js/ files.
/* Jay, 2026-11-14: "more snarky animations... if you stop playing for a bit, he holds a sign hey where'd you go...
   maybe even when you do something good too". The crumb is wry, never mean, and never long: one short line at a time.
     hot     charged for a cannonball: a bouncing "FLICK ME!" stays up until it is thrown (the one line that is a hint)
     idle    no touch for TALK_IDLE_MS: it holds up a sign ("hey, where'd you go?"), then a second one, then it nods off (zzz);
             the next touch gets a "you're back" line
     good    a clean sweep, a long streak, a 3+ line clear, a new best, an avalanche, a cannonball that broke a lot
     meh     many drops without a clear, a piece picked up and put back again and again, a cramped board, game over
     toy     poked, thrown hard (dizzy), sulking
   Everything is found by watching the game's own state from sayStep (called by mascotStep), so game.js is untouched; the
   toy's own moments call crumbSay directly. Lines are picked with the mascot's own dice (mascotRnd), never Math.random.
   One DOM element (#crumbSay), text and class written only when they change. At most one line per TALK_GAP ms, except the
   idle signs and the cannonball hint. Switch: CFG.FX_CRUMB_TALK (Settings > Look > Advanced "Crumb talks", saved `talk`). */
const SAY={
  idle1:["hey, where'd you go?","hello? anyone?","I can wait. I'm a crumb."],
  idle2:["still here. just saying.","take your time. really.","this is fine. I love waiting."],
  back:["oh. you're back.","finally.","I wasn't asleep."],
  start:["ok. try to keep up.","let's see what you've got.","no pressure."],
  sweep:["ok, that was actually good.","...did you mean to do that?","fine. I'm impressed."],
  combo:["show-off.","ok ok, we get it.","who ARE you?","don't stop now."],
  big:["not bad.","I taught you that.","clean."],
  best:["new best. I'll allow it.","look at you go."],
  ava:["WHOA.","I did NOT sign up for this.","warn me next time!"],
  cannon:["that was ME.","you're welcome.","ow. worth it."],
  dry:["bold strategy.","interesting choice.","sure, put it there."],
  dither:["any day now.","it's a block. just pick.","make up your mind."],
  tight:["this is fine.","I'm not worried. you worried?","deep breaths."],
  over:["well. that happened.","we don't talk about that one.","again?"],
  poke:["hey!","rude.","do you mind?","I'm working here."],
  dizzy:["not. cool.","the room is spinning.","why."],
  sulk:["nope.","I'm on a break.","ask nicely."],
};
const say={el:null,txt:'',kind:'',until:0,last:-1e9,key:'',idle:0,placed:-1,lines:0,dry:0,backs:0,retOn:false,state:'',tight:false,best:false,sweeps:0,avaOn:false,fireN:-1};
function sayInit(){
  const d=document.createElement('div'); d.id='crumbSay'; d.hidden=true; d.setAttribute('aria-hidden','true');
  el('stage').appendChild(d); say.el=d;
}
const sayPick=k=>{ const a=SAY[k]; return a[Math.floor(mascotRnd()*a.length)%a.length]; };
// show a line for ms. kind: 'say' (bubble) or 'sign'. force skips the gap between lines (the toy's own moments, the idle signs)
function crumbSay(txt,ms,kind,force){
  if(!CFG.FX_CRUMB_TALK||!say.el) return false;
  const now=performance.now();
  if(!force&&now-say.last<CFG.TALK_GAP) return false;
  say.txt=txt; say.kind=kind||'say'; say.until=now+(ms||CFG.TALK_MS); say.last=now;
  return true;
}
const sayLine=(k,force)=>crumbSay(sayPick(k),0,'say',force);
function sayStep(now,shown,faint){                         // mascot.js mascotStep: `shown` = the crumb is on screen
  const e=say.el; if(!e) return;
  const sync=()=>{ say.placed=stats.placed; say.lines=stats.lines; say.sweeps=stats.sweeps; say.dry=0; say.backs=0; say.best=bestBeaten; };
  if(!shown||!CFG.FX_CRUMB_TALK){                          // hidden (the menu, the logo still crumbling) or switched off
    if(say.key!=='off'){ say.key='off'; e.hidden=true; } say.until=0;
    if(state==='idle'||!CFG.FX_CRUMB_TALK){ say.state=state; say.placed=-1; }
    else if(say.placed<0||stats.placed<say.placed) sync();   // a run has begun behind the falling logo: count from here, so a first drop is not missed
    return;
  }
  // ── what just happened, read off the game's own state ──
  if(state!==say.state){
    if(state==='over') sayLine('over',true);
    else if(state==='play'&&say.state==='idle'&&mascotRnd()<.5) sayLine('start');
    say.state=state;
  }
  if(say.placed<0||stats.placed<say.placed) sync();
  if(stats.placed!==say.placed){                           // a drop
    const got=stats.lines-say.lines; say.backs=0;
    if(stats.sweeps>say.sweeps) sayLine('sweep',true);
    else if(ava.live&&!say.avaOn) sayLine('ava',true);
    else if(bestBeaten&&!say.best) sayLine('best',true);
    else if(got>0&&combo>=CFG.TALK_COMBO&&combo%2===0) sayLine('combo');
    else if(got>=3) sayLine('big');
    say.dry=got>0?0:say.dry+1;
    if(say.dry>=CFG.TALK_DRY){ say.dry=0; sayLine('dry'); }
    say.placed=stats.placed; say.lines=stats.lines; say.sweeps=stats.sweeps; say.best=bestBeaten;
  }
  say.avaOn=ava.live;
  if(!!ret!==say.retOn){ say.retOn=!!ret; if(ret&&++say.backs>=CFG.TALK_DITHER){ say.backs=0; sayLine('dither'); } }   // a piece picked up and sent back
  const tight=state==='play'&&mascotTight(); if(tight&&!say.tight) sayLine('tight'); say.tight=tight;
  // ── idle: a sign, a second one, then asleep; the next touch wakes it ──
  const playing=state==='play'&&!paused&&!stuck&&!dealing&&!ava.live&&toy.mode==='rim';
  const away=playing?now-lastInput:0, I=CFG.TALK_IDLE_MS;
  const stage=away>I*4.5?3:away>I*2.4?2:away>I?1:0;
  if(stage!==say.idle){
    if(stage===0&&say.idle>0&&playing) sayLine('back',true);
    else if(stage===1) crumbSay(sayPick('idle1'),I*1.4,'sign',true);
    else if(stage===2) crumbSay(sayPick('idle2'),I*2.1,'sign',true);
    else if(stage===3) crumbSay('z z z',1e9,'say zz',true);
    say.idle=stage;
  }
  if(stage===0&&say.kind==='say zz') say.until=0;
  // ── what shows ──
  const hot=toy.hot&&toy.mode==='rim'&&state==='play'&&!faint;
  const txt=hot?'FLICK ME!':now<say.until&&toy.mode!=='held'&&toy.mode!=='air'?say.txt:'';
  const kind=hot?'say hot':say.kind;
  const s=masc.s*toy.sc, x=masc.x+toy.x, right=x+s/2<W/2;       // the bubble sits on the side with more room
  const px=Math.round(right?x+s+5:W-x+5), py=Math.round(masc.y+toy.y+masc.s-s*.86);
  const key=txt?txt+'|'+kind+'|'+(right?'L':'R')+px+','+py:'none';
  if(key===say.key) return; say.key=key;
  if(!txt){ e.hidden=true; return; }
  e.hidden=false; e.textContent=txt; e.className=kind+(right?' fromL':' fromR')+(reduce?' rm':'');
  e.style.left=right?px+'px':''; e.style.right=right?'':px+'px'; e.style.top=py+'px';
}

// Crumble — the crumb talks back: a speech bubble or a little sign beside the mascot.
// Plain script, loaded in order by index.html (after crumbtoy.js); shares globals with the other js/ files.
/* Jay, 2026-11-14: "more snarky animations... if you stop playing for a bit, he holds a sign hey where'd you go...
   maybe even when you do something good too". The crumb is wry, never mean, and never long: one short line at a time.
     hot     charged for a cannonball: a bouncing "PULL ME BACK!" stays up until it is thrown (the one line that is a hint;
             "FLICK ME!" with the slingshot switched off). A tap on it says how ("pull me back and let go!")
     idle    no touch for TALK_IDLE_MS: it holds up a sign ("hey, where'd you go?"), then a second one, then it nods off (zzz);
             the next touch gets a "you're back" line
     good    a clean sweep, a long streak, a 3+ line clear, a new best, an avalanche, a cannonball that broke a lot
     meh     many drops without a clear, a piece picked up and put back again and again, a cramped board, game over
     toy     poked, thrown hard (dizzy), sulking
     stakes  the streak's last life ("careful.", once a run), a grown crumb on it ("use me or lose me.", once a charge),
             the growth lost when the streak dies ("I was HUGE.")
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
  big:["not bad.","I taught you that.","clean.","ok, who ARE you?","three at once. sure. fine.","did you practice? be honest.","that was my move. you stole it."],
  two:["two. cute.","a double. noted.","ok, that one was fine.","not bad. not great."],   // (voice) a 2-line clear, now and then (TALK_TWO), with the praise words off
  best:["new best. I'll allow it.","look at you go."],
  ava:["WHOA.","I did NOT sign up for this.","warn me next time!"],
  avaSide:["which way is DOWN?","you did that on purpose.","whoa, sideways!"],   // (lean) an avalanche that fell toward a leaned phone
  avaHint:["next time, lean the phone."],                                         // (lean) once ever: tilt is live, the phone was flat
  cannon:["that was ME.","you're welcome.","ow. worth it."],
  dry:["bold strategy.","interesting choice.","sure, put it there."],
  dither:["any day now.","it's a block. just pick.","make up your mind."],
  tight:["this is fine.","I'm not worried. you worried?","deep breaths."],
  over:["well. that happened.","we don't talk about that one.","again?"],
  poke:["hey!","rude.","do you mind?","I'm working here."],
  dizzy:["not. cool.","the room is spinning.","why."],
  sulk:["nope.","I'm on a break.","ask nicely."],
  // (dares) js/dares.js: each dare's own line lives with it in DARES; these are how he takes the result
  dareWin:["fine. one cookie.","ugh. you earned it.","I didn't think you'd do it."],
  dareNext:["double or nothing.","beginner's luck. again.","ok. a harder one."],
  dareFail:["knew it.","ha. knew it.","couldn't resist, huh?"],
  dareLost:["told you.","next time. maybe."],
  // (closet) js/closet.js: dressing up, and a feat item earned mid-run
  closetOn:["I look ridiculous.","...fine. I like it.","don't tell anyone.","this was your idea.","is this a look? it's a look."],
  closetOff:["finally.","free at last.","...I kind of miss it."],
  closetBuy:["you spent cookies on THIS?","worth every crumb.","ok. it's mine now."],
  closetNew:["there's something new in my closet."],
  hint:["pull me back and let go!"],
  sputter:["one more miss and it's gone.","careful."],
  useme:["use me or lose me."],
  deflate:["pfff.","I was HUGE.","that was your fault."],
  // (Lab) Clear it in three: js/lab.js
  l3Open:["three pieces. empty board. go."],
  l3Fail:["nope.","so close. not really."],
  l3Solve:["...ok, that was clean."],
  l3Hint:["want a hint? fine."],
  l3Cookie:["fine. one cookie."],
  // (pace) js/challenge.js: a friend's Challenge link with their pace, at the end of a tray
  paceAhead:["ahead. don't look back.","ahead of them. keep going.","they were slower here. heh.","look at you, winning."],
  paceBehind:["they were faster here.","behind them. no panic.","they're pulling ahead. hmm.","catch up. I believe. mostly."],
  // (cookie) js/cookie.js: a cookie on the board
  cookieLand:["cookie! get it before it goes stale.","ooh. a cookie. clear it for me.","that cookie's mine. go get it.","cookie on the board. don't let it go stale."],
  cookieYum:["mine. thank you.","okay that was worth it.","mmf. crunchy.","best part of my day.","nom. don't tell anyone.","into the jar. well. into me."],
  cookieGone:["that was my cookie.","it's fine. i wasn't hungry.","stale. great.","bye, cookie."],
  night:["it gets harder from here.","lights out. good luck.","night shift. no more freebies."],   // (sky bite) arriving at a harder stop
  aurora:["pretty, huh? don't look.","it's not getting easier."],
  space:["nobody gets past space.","space. it bites.","this is where runs go to die."],
  deep:["ok, now you're showing off.","how are you still here?","nobody's been out this far."],
  // (Lab) Rescue the Crumbs: js/rescue.js
  rsOpen:["my cousins are stuck. obviously."],
  rsOut:["one out.","go go go."],
  rsLast:["fine. I was worried. a little."],
  rsStuck:["you trapped them. nice."],
  rsStar3:["perfect. don't get smug."],
  rsTop:["from the top. watch."],
  rsCookie:["fine. one cookie. for the cousins."],
  // (report) Crumb's report card on the game-over card (flow.js reportLine): a quip when one applies, else the grade's band
  rcBest:["new best. don't let it go to your head.","new best. i'll allow it.","new best. i'm telling everyone."],
  rcSpace:["space. fine. i'm impressed.","you took me to space. wow.","space! okay, that was cool."],
  rcCannon:["that cannonball carried you. you're welcome.","that was all me. the cannonball.","you're welcome. for the cannonball."],
  rcDares:["every dare. fine. you win.","all my dares. who ARE you?","beat them all. show-off."],
  rcStale:["you let my cookie go stale. noted.","my cookie went stale. i saw.","a stale cookie. unforgivable."],
  rcDeflate:["i was HUGE once. remember?","you let me deflate. hmm.","i had so much air in me."],
  rcIgnored:["you ignored me the whole time.","not one throw. rude.","i'm a toy. throw me sometimes."],
  rcQuick:["that was quick.","blink and you missed it.","warm-up. right?"],
  rcLow:["we'll call that practice.","the board won. this time.","deep breath. go again."],
  rcMid:["solid. not legendary.","decent. i've seen worse.","respectable. barely."],
  rcHigh:["okay. that was really good.","i'd frame that one.","you're kind of good at this."],
  quiet:["ok. now it gets interesting.","warm-up's over.","fine. now the fun stuff."],   // (quiet) Day: Volcano, the cannonball and the x2 meter are awake
};
const say={stop:0,stopDue:'',stopT:0,quiet:false,qSync:true,qDue:false,qT:0,el:null,txt:'',kind:'',until:0,over:false,last:-1e9,key:'',idle:0,placed:-1,lines:0,dry:0,backs:0,retOn:false,state:'',tight:false,best:false,sweeps:0,avaOn:false,fireN:-1};
function sayInit(){
  const d=document.createElement('div'); d.id='crumbSay'; d.hidden=true; d.setAttribute('aria-hidden','true');
  el('stage').appendChild(d); say.el=d;
}
const sayPick=k=>{ const a=SAY[k]; return a[Math.floor(mascotRnd()*a.length)%a.length]; };
// show a line for ms. kind: 'say' (bubble) or 'sign'. force skips the gap between lines (the toy's own moments, the idle signs).
// over: the line shows even while the crumb is charged (in place of the "PULL ME BACK!" bubble), in the charged bubble's colours
function crumbSay(txt,ms,kind,force,over){
  if(!CFG.FX_CRUMB_TALK||!say.el) return false;
  const now=performance.now();
  if(!force&&now-say.last<CFG.TALK_GAP) return false;
  say.txt=txt; say.kind=kind||'say'; say.until=now+(ms||CFG.TALK_MS); say.last=now; say.over=!!over;
  return true;
}
const sayLine=(k,force,over)=>crumbSay(sayPick(k),0,over?'say hot':'say',force,over);
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
    if(state==='over') sayLine(dareOpen()?'dareLost':'over',true);   // (dares) a run that ends with a dare open: "told you."
    else if(state==='play'&&say.state==='idle'&&mascotRnd()<.5) sayLine('start');
    say.state=state; say.stop=skyStop(); say.stopDue='';   // (sky bite) a new or resumed run starts counting stops from where it is
    say.qSync=true;
  }
  if(say.qSync){ say.qSync=false; say.quiet=quietNow(); say.qDue=false; }   // (quiet) a new or restored run: no line for a stop it was already past
  if(say.placed<0||stats.placed<say.placed) sync();
  if(stats.placed!==say.placed){                           // a drop
    const got=stats.lines-say.lines; say.backs=0;
    if(stats.sweeps>say.sweeps) sayLine('sweep',true);
    else if(ava.live&&!say.avaOn){ if(ava.hint){ if(sayLine('avaHint',true)) avaHintDone(); } else sayLine(ava.dir!=='down'?'avaSide':'ava',true); }   // (lean) sideways has its own lines; the hint is spent only once it shows
    else if(bestBeaten&&!say.best) sayLine('best',true);
    else if(got>0&&combo>=CFG.TALK_COMBO&&combo%2===0) sayLine('combo');
    else if(got>=3) sayLine('big');
    else if(got===2&&!CFG.PRAISE_WORDS&&now-say.last>=CFG.TALK_GAP&&mascotRnd()<CFG.TALK_TWO) sayLine('two');   // (voice) only when the gap allows, and only now and then
    say.dry=got>0?0:say.dry+1;
    if(say.dry>=CFG.TALK_DRY){ say.dry=0; sayLine('dry'); }
    say.placed=stats.placed; say.lines=stats.lines; say.sweeps=stats.sweeps; say.best=bestBeaten;
  }
  say.avaOn=ava.live;
  // (sky bite) Endless, with the sky biting: a line on arriving at a harder stop (night, aurora, space, then each Deep space
  // stop now and then). It waits its turn behind the forced lines (a sweep's jump comes with the sweep's own line), and like the
  // dares (dareQuiet) behind dare lines, a charged crumb and the slingshot; dare lines in turn wait for it (say.until).
  if(state==='play'&&mode==='endless'&&CFG.SKY_BITE_SCALE>0&&!guide){
    const st=skyStop();
    if(st<say.stop) say.stop=st;                           // a new run
    else if(st>say.stop){
      const k=st>=6?(mascotRnd()<.35?'deep':''):st>=5&&say.stop<5?'space':st>=4&&say.stop<4?'aurora':st>=3&&say.stop<3?'night':'';
      if(k){ say.stopDue=k; say.stopT=now; }
      say.stop=st;
    }
    if(say.stopDue&&(now-say.stopT>8000||!dare.q.length&&dareQuiet(now)&&sayLine(say.stopDue))) say.stopDue='';   // (dares, stakes) only when a dare line, the charged crumb or the slingshot is not speaking; it never forces
  } else { say.stop=state==='play'?skyStop():0; say.stopDue=''; }
  // (quiet) the quiet opening ends at Day: one line, once a run, waiting its turn like the stop lines (never forced). A jump
  // straight past Day to a stop that has its own line says that one instead
  if(state==='play'){
    const q=quietNow();
    if(say.quiet&&!q&&CFG.QUIET_START&&!say.stopDue){ say.qDue=true; say.qT=now; }   // (switched off in Admin: no line)
    say.quiet=q;
    if(say.qDue&&(now-say.qT>8000||!dare.q.length&&dareQuiet(now)&&sayLine('quiet'))) say.qDue=false;
  }
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
  const hot=toy.hot&&toy.mode==='rim'&&state==='play'&&!faint&&!(say.over&&now<say.until);   // (a charged crumb's own line shows for a moment in its place)
  const how=CFG.CANNON_SLING?['PULL ME BACK, QUICK!','PULL ME BACK!']:['FLICK ME, QUICK!','FLICK ME!'];
  const txt=hot?(toyLast()?how[0]:how[1]):now<say.until&&toy.mode!=='held'&&toy.mode!=='air'?say.txt:'';
  const kind=hot?'say hot':say.kind;
  const s=masc.s*toy.sc, x=masc.x+toy.x, right=x+s/2<W/2;       // the bubble sits on the side with more room
  const px=Math.round(right?x+s+5:W-x+5), py=Math.round(masc.y+toy.y+masc.s-s*.86);
  const key=txt?txt+'|'+kind+'|'+(right?'L':'R')+px+','+py:'none';
  if(key===say.key) return; say.key=key;
  if(!txt){ e.hidden=true; return; }
  e.hidden=false; e.textContent=txt; e.className=kind+(right?' fromL':' fromR')+(reduce?' rm':'');
  e.style.left=right?px+'px':''; e.style.right=right?'':px+'px'; e.style.top=py+'px';
}

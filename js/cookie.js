// Crumble — a cookie on the board: now and then a cookie lands on one gem; clear that gem in time and Crumb eats it.
// Plain script, loaded in order by index.html (after dares.js); shares globals with the other js/ files.
/* The lightest goal there is in Endless: it steers where the player clears, with no new mode, and it feeds the hats (the cookie goes
   into the dares jar, `crumble.dares`, which the closet spends).
   Lands: when a tray is dealt (stepDeal calls cookieDealt), if no cookie is on the board, at least COOKIE_GAP trays have passed
   since the last one left, the run is past its first COOKIE_START trays, the board holds COOKIE_MIN_GEMS gems and fewer than
   COOKIE_RUN_MAX have been eaten this run: a roll of COOKIE_ODDS. A roll, never a rule. It picks a gem whose best line is
   partly filled (COOKIE_LINE: 3 to 6 of 8), so it takes a little work. It drops onto the gem and Crumb says so.
   Stays: COOKIE_TRAYS full trays. Each new tray takes a bite out of it (whole, one bite, two bites), so the time left is
   on the cookie itself; on its last tray it wobbles now and then.
   Eaten: its gem is cleared by anything (a line, a star, an Avalanche chain, a cannonball, a sweep, the last chance). The
   cookie rides the gem's break, hops into Crumb (the dares' cookieHop), he chomps and says a line, and the jar gets one.
   Missed: when time runs out it crumbles off its gem and he grumbles. No penalty.
   It is a reference to its gem's own object (ck.g), so it moves with the gem wherever the grid moves it (an Avalanche
   moves the objects); the gem gone from the grid is the gem cleared. Its own dice (ckRnd), never Math.random or rnd(), so
   the dealer deals the same trays with it on or off; nothing in dealing or scoring changes.
   Endless only (not Daily, Adventure, Challenge or the guided first game); needs the mascot and Crumb's dares
   (Settings > Look > Advanced "Crumb's dares and cookies"). Switch: CFG.COOKIE (Admin). Saved in the run as `ck`. */
const ck={seen:false,g:null,r:-1,c:-1,left:0,n:0,since:999,off:false,at:0,wob:0,eat:null,hop:null,bits:[],fade:null,px:0,py:0};
let ckSeed=(Date.now()%2147483646)+1;                    // its own dice: the dealer's stream (rnd, Math.random in tests) never moves
const ckRnd=()=>(ckSeed=(ckSeed*16807)%2147483647)/2147483647;
const cookieOn=()=>!!CFG.COOKIE&&daresOn()&&!ck.off&&!guide;
const COOKIE_DROP_MS=380, COOKIE_WOB_MS=520, COOKIE_WOB_EVERY=2600;
const cookieBites=()=>Math.max(0,Math.min(2,3-ck.left));   // whole, one bite, two bites (the last tray)
function cookieBusy(){                                  // draw.js fxBusy: full frame rate only while it moves
  const now=performance.now();
  return !!ck.hop||!!ck.eat||!!ck.fade||ck.bits.length>0||(!!ck.g&&!reduce&&(now-ck.at<COOKIE_DROP_MS||(ck.left===1&&now>=ck.wob&&now<ck.wob+COOKIE_WOB_MS)));
}

/* ── the run ── */
function cookieRunReset(){                              // flow.js clearRunFx: a new or restored run starts without one
  ck.g=null; ck.r=ck.c=-1; ck.left=0; ck.n=0; ck.since=999; ck.off=false; ck.eat=null; ck.bits=[]; ck.fade=null;
  if(ck.hop) ck.hop.cancel();                           // (a cookie already eaten still lands in the jar)
}
function cookieCell(){                                  // where its gem is now, or null
  if(!ck.g) return null;
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]===ck.g){ ck.r=r; ck.c=c; return [r,c]; }
  return null;
}
const cookieSnap=()=>mode==='endless'?{r:ck.g&&cookieCell()?ck.r:-1,c:ck.g?ck.c:-1,l:ck.g?ck.left:0,n:ck.n,s:Math.min(999,ck.since),o:ck.off?1:0}:null;   // save.js snapshot `ck`
function cookieLoad(o){                                 // save.js restore, after the grid: bad data means no cookie; an older save has none
  if(!o||typeof o!=='object'||mode!=='endless') return;
  if(isInt(o.n,0,99)) ck.n=o.n;
  if(isInt(o.s,0,999)) ck.since=o.s;
  if(o.o===1) ck.off=true;
  if(isInt(o.r,0,N-1)&&isInt(o.c,0,N-1)&&isInt(o.l,1,9)&&grid[o.r]&&grid[o.r][o.c]){ ck.g=grid[o.r][o.c]; ck.r=o.r; ck.c=o.c; ck.left=o.l; ck.at=0; ck.wob=o.l===1?performance.now()+700:0; }
}
function cookiePick(){                                  // a gem whose best line takes a little work: COOKIE_LINE filled, else any gem
  const rowN=grid.map(row=>row.reduce((a,v)=>a+(v?1:0),0)), colN=[];
  for(let c=0;c<N;c++){ let k=0; for(let r=0;r<N;r++) if(grid[r][c]) k++; colN.push(k); }
  const [lo,hi]=CFG.COOKIE_LINE, good=[], ok=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const g=grid[r][c]; if(!g||g.t<1) continue;
    const b=Math.max(rowN[r],colN[c]);
    (b>=lo&&b<=hi?good:ok).push([r,c]);
  }
  const set=good.length?good:ok;
  return set.length?set[Math.floor(ckRnd()*set.length)%set.length]:null;
}
function cookieSay(k,ttl){ if(SAY[k]) dareQueue(sayPick(k),0,ttl); }   // through the dares' queue: it waits for a quiet board, never over a bigger moment
// stepDeal (game.js): a new tray is on the board. A bite out of a cookie that is there, or perhaps a new one
function cookieDealt(){
  if(guide) ck.off=true;
  if(state!=='play') return;
  if(!cookieOn()){ if(ck.g){ ck.g=null; ck.since=0; } return; }   // switched off mid-run: it just goes
  if(ck.g){
    if(!cookieCell()){ cookieEat(); return; }
    ck.left--;
    if(ck.left<=0){ cookieGone(); return; }
    cookieCrumbs(3);                                     // a bite: a few crumbs fall off it
    if(ck.left===1) ck.wob=performance.now()+700;
    return;
  }
  ck.since++;
  if(trayNo<=CFG.COOKIE_START||ck.since<CFG.COOKIE_GAP||ck.n>=CFG.COOKIE_RUN_MAX||stuck||ava.live) return;
  let gems=0; for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]) gems++;
  if(gems<CFG.COOKIE_MIN_GEMS||ckRnd()>=CFG.COOKIE_ODDS) return;
  const at=cookiePick(); if(!at) return;
  ck.g=grid[at[0]][at[1]]; ck.r=at[0]; ck.c=at[1]; ck.left=CFG.COOKIE_TRAYS; ck.at=performance.now(); ck.wob=0;
  toyPlay(.08,t=>{ tone(t,{f0:520,f1:340,pdur:.08,dur:.1,vol:.05,type:'triangle'}); });   // a soft tok as it lands
  cookieSay('cookieLand',7000);
}
// place() after every drop, toyFireEnd after a cannonball, and every frame: its gem gone from the board is the gem cleared
function cookieCheck(){ if(ck.g&&state==='play'&&!cookieCell()) cookieEat(); }
function cookieEat(){
  const g=ck.g, left=ck.left; ck.g=null; ck.n++; ck.since=0;
  dare.st.cookies++; saveDares();                       // into the jar now (the closet can spend it); the jar shows it when it lands
  let sh=null;                                          // the gem's own break: the cookie rides it until it pops (a line, an Avalanche row)
  if(!toy.fire) for(const s of shatters) if(s.t<0&&(g.av?s.av===g.av:s.r===ck.r&&s.c===ck.c&&!(s.av&&s.av.length))) sh=s;
  ck.eat={sh,left,until:performance.now()+4000};
}
function cookieGone(){                                  // stale: it crumbles off its gem
  ck.fade={x:ck.px,y:ck.py,b:cookieBites(),t:0};
  ck.g=null; ck.since=0; rc.s++;                         // (report) a cookie gone stale this run
  cookieCrumbs(7);
  cookieSay('cookieGone',6000);
}
function cookieCrumbs(n){                               // little brown bits, on its own dice; they count in the particle budget
  if(reduce) return;
  const x=ck.px||bx+(ck.c+.5)*cell, y=ck.py||by+(ck.r+.5)*cell;
  for(let k=0;k<n&&fxRoom()>0&&ck.bits.length<16;k++){
    const a=-Math.PI*(.15+.7*ckRnd());
    ck.bits.push({x:x+(ckRnd()-.5)*cell*.3,y:y-cell*.1,vx:Math.cos(a)*(.6+ckRnd()*1.4)*(k%2?1:-1),vy:Math.sin(a)*(1+ckRnd()*1.5),r:cell*(.035+ckRnd()*.035),life:1});
  }
}
function cookieLanded(){                                // in his mouth: a chomp, a line, the jar counts it
  ck.hop=null;
  mascotAct('chomp');
  jarTick('cookie');
  cookieSay('cookieYum',5000);
}

/* ── the picture: draw.js frame() calls cookieDraw over the board's gems, under the tray and the held piece ── */
function cookieSprite(b){                               // one cookie, whole or bitten, cached per cell size (no per-frame gradients or shadows)
  const R=Math.round(cell*.33), ow=Math.max(1.4,cell*.045);
  return sprite('cookie|'+b+'|'+R,R*2+6,R*2+6,x=>{
    x.beginPath(); x.arc(0,0,R,0,6.283);
    x.fillStyle='#D9A05B'; x.fill();
    x.lineWidth=ow; x.strokeStyle='#3A2010'; x.stroke();
    x.fillStyle='rgba(255,226,170,.75)'; x.beginPath(); x.arc(-R*.3,-R*.36,R*.28,0,6.283); x.fill();   // a highlight
    x.fillStyle='#4A2A12';
    for(const [u,v,s] of [[-.38,.1,.17],[.12,-.42,.14],[.4,.05,.15],[-.05,.45,.16],[.1,.08,.11],[-.45,-.4,.1]]){ x.beginPath(); x.arc(u*R,v*R,s*R,0,6.283); x.fill(); }   // chocolate chips
    const bites=[[-.95,1.0],[.75,1.02]].slice(0,b);     // one out of the top right, then one out of the bottom right: two clear notches
    if(!bites.length) return;
    x.globalCompositeOperation='destination-out';
    for(const [a,d] of bites){ x.beginPath(); x.arc(Math.cos(a)*R*d,Math.sin(a)*R*d,R*.4,0,6.283); x.fill(); }
    x.globalCompositeOperation='source-atop';            // the bite's edge gets the outline too (only where cookie is left)
    x.lineWidth=ow*2; x.strokeStyle='#3A2010';
    for(const [a,d] of bites){ x.beginPath(); x.arc(Math.cos(a)*R*d,Math.sin(a)*R*d,R*.4,0,6.283); x.stroke(); }
    x.globalCompositeOperation='source-over';
  });
}
function cookieDraw(now,dt){
  if(ck.g){
    if(!cookieCell()){ if(state==='play') cookieEat(); }
    else {
      if(!ck.seen){ ck.px=bx+(ck.c+.5)*cell; ck.py=by+(ck.r+.5)*cell; }   // (its gem was not drawn plainly this frame: a flip, a grow-in)
      ck.seen=false; const x=ck.px, y=ck.py;
      let sc=1, a=1, rot=0, oy=0;
      const k=reduce?1:(now-ck.at)/COOKIE_DROP_MS;
      if(k<1){ const e=easeOutBack(Math.max(0,k)); sc=1.35-.35*e; oy=-cell*.9*(1-Math.min(1,k*1.4)); a=Math.min(1,k*3); }   // the drop-in
      if(!reduce&&ck.left===1&&ck.wob){                  // its last tray: a wobble now and then
        if(now>=ck.wob+COOKIE_WOB_MS) ck.wob+=COOKIE_WOB_EVERY;
        const w=(now-ck.wob)/COOKIE_WOB_MS;
        if(w>=0&&w<1) rot=Math.sin(w*Math.PI*5)*.22*(1-w);
      }
      if(a>0) blit(cookieSprite(cookieBites()),x,y+oy,sc,a,rot);
    }
  }
  if(ck.eat){                                           // eaten: it rides its gem's break, then hops into Crumb
    const e=ck.eat, sh=e.sh&&e.sh.t<0&&shatters.includes(e.sh)?e.sh:null;
    const fell=sh&&sh.av&&sh.av.length>0;
    if(sh&&!fell) blit(cookieSprite(Math.max(0,Math.min(2,3-e.left))),ck.px,ck.py);   // a line's gem breaks in place
    if(fell){ ck.px=bx+(sh.c+.5)*cell; ck.py=by+(sh.r+.5)*cell; }   // an Avalanche row: it pops out where the gem landed and broke
    if(!sh||now>e.until){
      ck.eat=null;
      const s=masc.s*toy.sc, show=!reduce&&masc.el&&!masc.el.hidden;
      if(show) ck.hop=cookieHop(ck.px,ck.py,masc.x+toy.x+masc.s/2,masc.y+toy.y+masc.s-s*.4,[cell*.62/18,cell*.75/18,.45],cookieLanded);
      else cookieLanded();
    }
  }
  if(ck.fade){                                          // stale: it shrinks and fades off its gem
    const f=ck.fade; f.t+=dt/22;
    if(f.t>=1||reduce) ck.fade=null;
    else blit(cookieSprite(f.b),f.x,f.y+cell*.15*f.t,1-.5*f.t,1-f.t);
  }
  for(let i=ck.bits.length-1;i>=0;i--){                 // crumbs
    const b=ck.bits[i]; b.x+=b.vx*dt; b.y+=b.vy*dt; b.vy+=.18*dt; b.life-=dt*.04;
    if(b.life<=0){ ck.bits.splice(i,1); continue; }
    ctx.globalAlpha=Math.min(1,b.life*1.5); ctx.fillStyle='#B57A3E'; ctx.fillRect(b.x-b.r,b.y-b.r,b.r*2,b.r*2);
  }
  ctx.globalAlpha=1;
}
// draw.js, the gem loop: where its gem was just drawn (top-left), so the cookie sits exactly on it, shiver, Avalanche fall and all
function cookieAt(x,y){ ck.px=x+cell/2; ck.py=y+cell/2; ck.seen=true; }
// mascot.js mascotStep, every frame: the guided first game has none; switched off mid-run, it goes; a cannonball can eat it mid-flight
function cookieStep(now){
  if(guide&&state==='play') ck.off=true;
  if(ck.g&&state==='play'&&!cookieOn()){ ck.g=null; ck.since=0; }
  cookieCheck();
}

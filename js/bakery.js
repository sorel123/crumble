// Crumble — Crumb's Bakery (Lab): drop treats into a jar; two the same that touch bake into the next bigger one.
// Plain script, loaded in order by index.html (after rescue.js); shares globals with the other js/ files. Everything here is
// prefixed bk / BK_.
/* The game in one paragraph: Crumb holds a treat over a glass jar and follows the player's finger; let go and he drops it. Treats are
   circles in a little physics world of our own (no library): gravity, a low bounce, friction that makes them roll, and a
   solver that lets a pile settle and sleep. Two treats of the same tier that touch become the next tier where they met
   (it grows in over BK_GROW_MS, so its neighbours are pushed, not launched). Merges within BK_CHAIN_MS of each other are a
   chain, and the chain multiplies the points. Eleven tiers, Crumb to Party cake; two Party cakes CRUMBLE (a big bonus and a
   rain of Crumbs). A treat that sits above the dashed line for BK_LINE_MS ends the run.

   The world: the jar's inside is BK_JW (390) units wide and BK_JH tall, y down, 0 at the jar's top edge; the treats are held
   and dropped from just above it. Every speed and size is in these units, so a phone of any width plays the same game. A
   fixed step of BK_DT (1/120 s) through bkStep(dt), which tests call directly. All randomness (the next treat, a shake's
   kick, the decorations on the treats) comes from the Bakery's own dice (bkRnd / bkVisRnd): Math.random and the game's rnd
   are never touched. */

const BK_N=11;                                              // treats, smallest to largest (tier 1..11)
const BK_RAD=[.040,.052,.066,.083,.102,.124,.148,.174,.202,.232,.265];   // radius as a share of the jar's inside width
const BK_NAMES=['Crumb','Gumdrop','Macaron','Cookie','Donut','Cinnamon roll','Pancake','Blueberry pie','Lime tart','Chocolate cake','Party cake'];
const BK_JW=390, BK_JH=507;                                 // the jar's inside in world units (BK_JH = 1.3 x the width)
const BK_LINE=64;                                           // the dashed fill line, units down from the jar's top edge
const BK_DT=1/120;                                          // the physics step
const BK_VMAX=1500;                                         // speed cap (units/s): a step never moves a treat further than a Crumb's radius
const BK_SLOP=.5, BK_ITER=10, BK_PITER=4;                   // overlap left alone, velocity iterations, position passes
const BK_SLEEP_V=20, BK_SLEEP_W=1, BK_SLEEP_T=.4, BK_WAKE_V=45;   // at rest below these for BK_SLEEP_T s: asleep; a hit faster than BK_WAKE_V wakes it
const BK_REST_V=40;                                         // "nearly at rest" for the line rule
const BK_HOLD=-2*BK_RAD[4]*BK_JW-8;                         // the top of the treat Crumb holds (units; above the jar): a Donut just clears the rim
const BK_RUN='crumble.bakery.run';                          // the jar in progress (localStorage)
const bkPts=k=>10*k*(k-1)/2;                                // points for baking tier k (tier 2 = 10 ... tier 11 = 550)
const bkR=k=>BK_RAD[k-1]*BK_JW;                             // a tier's full radius in units

/* ── the Bakery's own dice (Park-Miller generators like dareRnd); their state rides in the run save ──
   Two streams: bkDealRnd hands out the treats and nothing else, so a run's seed (bk.seed0, what a friend link carries) always
   deals the same treats in the same order, shakes or not; bkRnd moves things (the shake's kick, the CRUMBLE rain). */
let bkSeed=1, bkDealSeed=1;
const bkRnd=()=>(bkSeed=(bkSeed*16807)%2147483647)/2147483647;
const bkDealRnd=()=>(bkDealSeed=(bkDealSeed*16807)%2147483647)/2147483647;
let bkVisSeed=4242;                                         // looks only (sparkles, crumbs flying, blinks): never changes what the player gets
const bkVisRnd=()=>(bkVisSeed=(bkVisSeed*16807)%2147483647)/2147483647;
function bkRoll(){                                          // the next treat: tiers 1..5 by CFG.BK_WEIGHTS
  const w=CFG.BK_WEIGHTS, sum=w.reduce((a,b)=>a+b,0);
  let r=bkDealRnd()*sum;
  for(let i=0;i<w.length;i++){ if((r-=w[i])<0) return i+1; }
  return 1;
}

/* ── the run ── */
const bk={
  open:false, paused:false, st:'play',                      // st: 'play' | 'over' (the treats pop) | 'card'
  bodies:[], nid:1, t:0,                                    // treats in the jar, the next id, sim time (s)
  score:0, held:1, next:1, ready:true, readyAt:0, aim:BK_JW/2, queued:false,
  chain:0, lastMerge:-9, big:1, cr:0, shakes:1, shakeNext:0,   // chain length, sim time of the last merge, biggest tier this run, crumbles this run, shake charges, points for the next charge
  overT:0, danger:false, rain:[], gx:0, warm:new Map(), warm2:new Map(), seed0:1,
  dare:null,                                                // a friend's dare: {seed, beat, tier, passed} (never saved over the player's own jar)
};
function bkNew(seed,raw){                                   // a fresh jar (seed pins the dice: tests; raw: seed is the dice state itself, a link's)
  bkDealSeed=bk.seed0=raw&&isInt(seed,1,2147483646)?seed:seed>0?Math.floor(seed)%2147483646+1:(Date.now()%2147483646)+1;
  bkSeed=(bk.seed0*48271)%2147483647||1;
  bk.bodies=[]; bk.nid=1; bk.t=0; bk.score=0; bk.chain=0; bk.lastMerge=-9; bk.big=1; bk.cr=0;
  bk.shakes=1; bk.shakeNext=CFG.BK_SHAKE_PTS; bk.overT=0; bk.danger=false; bk.rain=[]; bk.warm.clear();
  bk.st='play'; bk.queued=false;
  bk.held=bkRoll(); bk.next=bkRoll(); bk.ready=true; bk.readyAt=0; bk.aim=BK_JW/2;
  bk.big=Math.max(bk.held,bk.next);
  if(typeof bkFresh==='function') bkFresh();               // the view's own bits (effects, faces): js below
}
function bkBody(k,x,y,vx=0,vy=0){                           // a treat of tier k at (x, y), full size, awake
  const r=bkR(k);
  const b={id:bk.nid++,k,x,y,vx,vy,a:0,w:0,r,r0:r,rf:r,m:r*r,im:1/(r*r),iI:2/(r*r*r*r),born:bk.t,sl:0,z:false,ct:false,
    blink:0,pop:-9,ooh:-9,dz:-9,dead:false};
  bk.bodies.push(b);
  return b;
}
const bkMass=b=>{ b.m=b.r*b.r; b.im=1/b.m; b.iI=2/(b.m*b.r*b.r); };
const bkWake=b=>{ b.z=false; b.sl=0; };

/* ── one physics step ──
   Contacts (pairs found by a sweep along x, plus the two walls and the floor) are solved with sequential impulses, warm
   started from the last step's, with friction that turns sliding into rolling. Then positions move, and a few passes push
   overlaps apart without adding speed (so a pile never gains energy and never jitters). A treat that stays slow for
   BK_SLEEP_T sleeps: it stops falling and other treats meet it as if it were the jar, until something hits it hard, grows
   into it or is baked next to it. Then merges, the rain of a crumble and the fill line. */
const bkCs=[];                                              // contact pool, reused every step
let bkCn=0;
function bkContact(){ let c=bkCs[bkCn]; if(!c) c=bkCs[bkCn]={a:null,b:null,w:0,nx:0,ny:0,pen:0,jn:0,jt:0,tg:0,key:0}; bkCn++; return c; }
function bkStep(dt){
  const B=bk.bodies, g=CFG.BK_GRAVITY, gxa=bk.gx*g;
  bk.t+=dt;
  // the rain of Crumbs after a crumble
  while(bk.rain.length&&bk.rain[0].at<=bk.t){ const q=bk.rain.shift(); const b=bkBody(1,q.x,q.y,q.vx,260); b.pop=bk.t; }
  // growing treats (just baked), gravity
  for(const b of B){
    if(b.r<b.rf){
      const k=Math.min(1,(bk.t-b.born)/(CFG.BK_GROW_MS/1000));
      b.r=b.r0+(b.rf-b.r0)*(1-(1-k)*(1-k)); if(k>=1) b.r=b.rf; bkMass(b); bkWake(b);
    }
    if(b.z) continue;
    b.vy+=g*dt; b.vx+=gxa*dt;
    const sp=b.vx*b.vx+b.vy*b.vy; if(sp>BK_VMAX*BK_VMAX){ const s=BK_VMAX/Math.sqrt(sp); b.vx*=s; b.vy*=s; }
  }
  // contacts
  bkCn=0;
  const order=B.slice().sort((p,q)=>(p.x-p.r)-(q.x-q.r));
  const M=6;                                                 // a speculative margin: a contact starts a little before they touch
  for(let i=0;i<order.length;i++){
    const a=order[i]; a.ct=false;
    for(let j=i+1;j<order.length;j++){
      const b=order[j]; if(b.x-b.r>a.x+a.r+M) break;
      if(a.z&&b.z) continue;
      const dx=b.x-a.x, dy=b.y-a.y, rr=a.r+b.r+M;
      if(dy>rr||dy<-rr) continue;
      const d2=dx*dx+dy*dy; if(d2>=rr*rr) continue;
      const d=Math.sqrt(d2)||1e-6, nx=d2?dx/d:0, ny=d2?dy/d:1;
      const c=bkContact(); c.a=a; c.b=b; c.w=0; c.nx=nx; c.ny=ny; c.pen=a.r+b.r-d;
      c.key=a.id<b.id?a.id*65536+b.id:b.id*65536+a.id;
      if(a.z!==b.z){                                         // asleep meets awake: a hit, a push or a moving neighbour wakes it
        const o=a.z?b:a, vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(vn<-BK_WAKE_V||c.pen>2||o.vx*o.vx+o.vy*o.vy>4*BK_SLEEP_V*BK_SLEEP_V) { bkWake(a); bkWake(b); }
      }
    }
  }
  for(const b of B){
    if(b.z) continue;
    if(b.x-b.r<M) bkWall(b,1,1,0,b.r-b.x);
    if(b.x+b.r>BK_JW-M) bkWall(b,2,-1,0,b.x+b.r-BK_JW);
    if(b.y+b.r>BK_JH-M) bkWall(b,3,0,-1,b.y+b.r-BK_JH);
  }
  const cs=bkCs.slice(0,bkCn).sort((p,q)=>Math.max(q.b.y,q.a?q.a.y:1e9)-Math.max(p.b.y,p.a?p.a.y:1e9));   // the floor and walls first, then from the bottom of the pile up
  // targets and warm start
  const e=CFG.BK_BOUNCE, prev=bk.warm, next=bk.warm2; next.clear();
  for(let i=0;i<bkCn;i++){
    const c=bkCs[i], a=c.a, b=c.b;
    const vn=(b.vx-(a?a.vx:0))*c.nx+(b.vy-(a?a.vy:0))*c.ny;
    const w=prev.get(c.key);
    c.tg=c.pen<0?c.pen/dt:(!w&&vn<-120?-e*vn:0);           // only a new touch bounces (a pile never feeds itself)
    if(w&&c.pen>=0){ c.jn=w[0]*.9; c.jt=w[1]*.9; bkApply(c,c.jn,c.jt); } else { c.jn=0; c.jt=0; }
  }
  // velocity iterations
  const mu=CFG.BK_FRICTION;
  for(let it=0;it<BK_ITER;it++) for(const c of cs){
    const a=c.a, b=c.b;
    const ima=a&&!a.z?a.im:0, imb=b.z?0:b.im, iIa=a&&!a.z?a.iI:0, iIb=b.z?0:b.iI;
    if(ima+imb===0) continue;
    const ra=a?a.r:0, rb=b.r, nx=c.nx, ny=c.ny, tx=-ny, ty=nx;
    const rvx=b.vx-(a?a.vx:0), rvy=b.vy-(a?a.vy:0);
    // normal
    const vn=rvx*nx+rvy*ny;
    let jn=(c.tg-vn)/(ima+imb), acc=Math.max(0,c.jn+jn); jn=acc-c.jn; c.jn=acc;
    // friction (only against a real touch)
    let jt=0;
    if(c.pen>-1){
      const vt=rvx*tx+rvy*ty-(b.z?0:b.w)*rb-(a&&!a.z?a.w:0)*ra;
      const k=ima+imb+ra*ra*iIa+rb*rb*iIb;
      jt=-vt/k; const lim=mu*c.jn; const at=Math.max(-lim,Math.min(lim,c.jt+jt)); jt=at-c.jt; c.jt=at;
    }
    bkApply(c,jn,jt);
  }
  for(let i=0;i<bkCn;i++){ const c=bkCs[i]; if(c.jn>0||c.jt) next.set(c.key,[c.jn,c.jt]); }
  bk.warm=next; bk.warm2=prev;
  // move
  const rollK=Math.max(0,1-CFG.BK_ROLL*dt), airK=Math.max(0,1-.04*dt);
  for(let i=0;i<bkCn;i++){ const c=bkCs[i]; if(c.pen>-1){ if(c.a) c.a.ct=true; c.b.ct=true; } }
  for(const b of B){
    if(b.z) continue;
    b.vx*=airK; b.vy*=airK; if(b.ct) b.w*=rollK;
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.a+=b.w*dt;
  }
  // push overlaps apart (no speed is added)
  for(let it=0;it<BK_PITER;it++){
    for(let i=0;i<bkCn;i++){
      const c=bkCs[i]; if(!c.a) continue;
      const a=c.a, b=c.b, ima=a.z?0:a.im, imb=b.z?0:b.im; if(ima+imb===0) continue;
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1e-6, pen=a.r+b.r-d;
      if(pen<=BK_SLOP) continue;
      const s=(pen-BK_SLOP)*.6/(ima+imb)/d;
      a.x-=dx*s*ima; a.y-=dy*s*ima; b.x+=dx*s*imb; b.y+=dy*s*imb;
    }
    for(const b of B){ if(b.z) continue; bkKeepIn(b); }
  }
  // sleep
  for(const b of B){
    if(b.z) continue;
    if(b.ct&&b.r>=b.rf&&b.vx*b.vx+b.vy*b.vy<BK_SLEEP_V*BK_SLEEP_V&&Math.abs(b.w)<BK_SLEEP_W){   // slow, and it has not really moved (a pile's leftover speed is not motion)
      if(!b.sl){ b.sx=b.x; b.sy=b.y; b.sa=b.a; }
      b.sl+=dt;
      if(Math.abs(b.x-b.sx)+Math.abs(b.y-b.sy)>1.2||Math.abs(b.a-b.sa)>.15) b.sl=0;
      else if(b.sl>=BK_SLEEP_T){ b.z=true; b.vx=b.vy=b.w=0; }
    } else b.sl=0;
  }
  bkMerges();
  bkLineCheck(dt);
  bkTickReady();
}
function bkWall(b,w,nx,ny,pen){
  const c=bkContact(); c.a=null; c.b=b; c.w=w; c.nx=nx; c.ny=ny; c.pen=pen; c.key=-(b.id*4+w);
}
function bkApply(c,jn,jt){                                  // an impulse at the contact: jn along the normal, jt along the tangent
  const a=c.a, b=c.b, px=c.nx*jn-c.ny*jt, py=c.ny*jn+c.nx*jt;
  if(!b.z){ b.vx+=px*b.im; b.vy+=py*b.im; b.w-=jt*b.r*b.iI; }
  if(a&&!a.z){ a.vx-=px*a.im; a.vy-=py*a.im; a.w-=jt*a.r*a.iI; }
}
function bkKeepIn(b){                                       // the jar's walls and floor are hard
  if(b.x<b.r) b.x=b.r; else if(b.x>BK_JW-b.r) b.x=BK_JW-b.r;
  if(b.y>BK_JH-b.r) b.y=BK_JH-b.r;
}

/* ── baking: two of a kind that touch ── */
function bkMerges(){
  const cool=CFG.BK_MERGE_COOL_MS/1000;
  let any=false;
  for(let i=0;i<bkCn;i++){
    const c=bkCs[i], a=c.a, b=c.b;
    if(!a||a.dead||b.dead||a.k!==b.k) continue;
    if(bk.t-a.born<cool||bk.t-b.born<cool) continue;
    const dx=b.x-a.x, dy=b.y-a.y;
    if(dx*dx+dy*dy>(a.r+b.r+.75)*(a.r+b.r+.75)) continue;
    a.dead=b.dead=true; any=true;
    bkBake(a,b);
  }
  if(any) bk.bodies=bk.bodies.filter(b=>!b.dead);
}
function bkBake(a,b){
  const k=a.k, x=(a.x*b.r+b.x*a.r)/(a.r+b.r), y=(a.y*b.r+b.y*a.r)/(a.r+b.r);   // where they touch
  bk.chain=bk.t-bk.lastMerge<=CFG.BK_CHAIN_MS/1000?bk.chain+1:1;
  bk.lastMerge=bk.t;
  const mult=Math.min(8,bk.chain);
  let nb=null, pts;
  if(k>=BK_N){                                              // CRUMBLE: two Party cakes crumble into a rain of Crumbs
    pts=CFG.BK_CRUMBLE_PTS*mult; bk.cr++;
    for(let i=0;i<10;i++) bk.rain.push({at:bk.t+.12+i*.09,x:24+bkRnd()*(BK_JW-48),y:-20-bkRnd()*30,vx:(bkRnd()-.5)*120});
    bkWakeNear(x,y,bkR(BK_N)*2.2);
  } else {
    pts=bkPts(k+1)*mult;
    nb=bkBody(k+1,x,y,(a.vx+b.vx)/2,(a.vy+b.vy)/2);
    nb.w=(a.w+b.w)/2; nb.a=(a.a+b.a)/2;
    nb.r0=Math.max(a.r,b.r); nb.r=nb.r0; bkMass(nb); nb.pop=nb.ooh=bk.t;
    bkKeepIn(nb);
    if(k+1>bk.big) bk.big=k+1;
    bkWakeNear(x,y,nb.rf*2);
  }
  bkAddScore(pts);
  if(typeof bkFxBake==='function') bkFxBake(k,nb,x,y,pts,mult);   // the pop, the sounds, Crumb, a discovery: the view
  if(nb) bkDiscover(k+1);
  if(k>=BK_N) bkCrumbled();
}
function bkWakeNear(x,y,reach){ for(const o of bk.bodies) if(!o.dead&&Math.hypot(o.x-x,o.y-y)<reach+o.r) bkWake(o); }
function bkAddScore(p){
  bk.score+=p;
  if(bk.dare&&!bk.dare.passed&&bk.score>bk.dare.beat){ bk.dare.passed=true; if(typeof bkFxBeat==='function') bkFxBeat(); }   // past the friend's score: once
  while(bk.score>=bk.shakeNext){ bk.shakeNext+=CFG.BK_SHAKE_PTS; if(bk.shakes<CFG.BK_SHAKE_MAX){ bk.shakes++; if(typeof bkFxCharge==='function') bkFxCharge(); } }
}

/* ── the fill line: a settled treat above it for BK_LINE_MS ends the run ── */
function bkLineCheck(dt){
  let over=false, danger=false;
  for(const b of bk.bodies){
    if(bk.t-b.born<1||b.y-b.r>=BK_LINE) continue;
    danger=true;
    if(b.vx*b.vx+b.vy*b.vy<BK_REST_V*BK_REST_V) over=true;
  }
  bk.danger=danger&&bk.st==='play';
  bk.overT=over&&bk.st==='play'?bk.overT+dt:0;
  if(bk.st==='play'&&bk.overT>=CFG.BK_LINE_MS/1000) bkGameOver();
}

/* ── the player's drops ── */
function bkDropX(x){ const r=bkR(bk.held); return Math.max(r,Math.min(BK_JW-r,x)); }
function bkDrop(x){                                         // Crumb lets go of the treat he holds, at x (units)
  if(bk.st!=='play'||!bk.ready) return null;
  const k=bk.held, r=bkR(k), b=bkBody(k,bkDropX(x),BK_HOLD+r,0,140);
  b.pop=-9;
  bk.held=bk.next; bk.next=bkRoll(); bk.ready=false; bk.readyAt=bk.t+CFG.BK_DROP_MS/1000;
  if(bk.held>bk.big) bk.big=bk.held;
  if(typeof bkFxDrop==='function') bkFxDrop(b);
  bkSaveRun();                                              // the jar is saved on every drop (cheap), as well as on pause and hide
  return b;
}
function bkTickReady(){                                     // the next treat pops into his hands
  if(!bk.ready&&bk.t>=bk.readyAt){ bk.ready=true; if(typeof bkFxReady==='function') bkFxReady(); }
}

/* ── shake: every treat is kicked up and a little sideways ── */
function bkShake(){
  if(bk.st!=='play'||bk.shakes<=0) return false;
  bk.shakes--;
  for(const b of bk.bodies){
    bkWake(b);
    const s=Math.sqrt(bkR(1)/b.rf);                         // the small ones fly a bit higher
    b.vy-=(520+bkRnd()*380)*(.6+.4*s); b.vx+=(bkRnd()-.5)*360; b.w+=(bkRnd()-.5)*14; b.dz=bk.t;
  }
  bk.overT=0;
  if(typeof bkFxShake==='function') bkFxShake();
  return true;
}

/* ── discovery (crumble.lab .bakery.seen: the biggest tier ever baked; 1-5 are known from the start) ── */
function bkDiscover(k){
  const s=lab.bakery;
  if(k<=s.seen) return false;
  s.seen=k; saveLab();
  const cookie=k>=6;
  if(cookie) dareGift();
  if(typeof bkFxDiscover==='function') bkFxDiscover(k,cookie);
  return true;
}
function bkCrumbled(){ lab.bakery.crumbles++; saveLab(); }

/* ── the end ── */
function bkGameOver(){
  if(bk.st!=='play') return;
  bk.st='over'; bk.danger=false; bk.queued=false;
  const s=lab.bakery, newBest=bk.score>s.best;
  bk.wasBest=s.best; bk.newBest=newBest&&bk.score>0;
  if(newBest){ s.best=bk.score; s.bs=bk.seed0; s.bb=bk.big; }   // the best run's seed and biggest treat: Share my best sends them
  s.games++; saveLab();
  if(!bk.dare) bkClearRun();
  if(typeof playedToday==='function') playedToday();
  if(typeof bkFxOver==='function') bkFxOver();
}

/* ── the jar in progress, saved (on each drop, on pause and when the app is hidden) and restored at rest ── */
function bkSnap(){
  return {v:1,sc:bk.score,seed:bkSeed,ds:bkDealSeed,s0:bk.seed0,h:bk.held,n:bk.next,sh:bk.shakes,sn:bk.shakeNext,big:bk.big,cr:bk.cr,
    b:bk.bodies.filter(b=>!b.dead).map(b=>[b.k,Math.round(b.x*10)/10,Math.round(Math.max(b.y,-200)*10)/10,Math.round(b.a*100)/100])};
}
function bkSaveRun(){
  if(bk.st!=='play'||bk.dare) return;                       // a dare is never saved: the player's own jar keeps its save
  try{ localStorage.setItem(BK_RUN,JSON.stringify(bkSnap())); }catch(e){}
}
function bkClearRun(){ try{ localStorage.removeItem(BK_RUN); }catch(e){} }
function bkRestore(o){                                      // true if o was a good save and is now the jar
  if(!o||o.v!==1||!isInt(o.sc,0,1e9)||!isInt(o.seed,1,2147483646)||!isInt(o.h,1,5)||!isInt(o.n,1,5)||!Array.isArray(o.b)||o.b.length>200) return false;
  for(const q of o.b) if(!Array.isArray(q)||!isInt(q[0],1,BK_N)||!isNum(q[1])||!isNum(q[2])) return false;
  bkNew(o.seed); bkSeed=o.seed; bk.dare=null;
  bkDealSeed=isInt(o.ds,1,2147483646)?o.ds:o.seed;          // a save from before the two streams: one state for both
  bk.seed0=isInt(o.s0,1,2147483646)?o.s0:bkDealSeed;
  bk.score=o.sc; bk.held=o.h; bk.next=o.n;
  bk.shakes=isInt(o.sh,0,CFG.BK_SHAKE_MAX)?o.sh:0;
  bk.shakeNext=isInt(o.sn,1,1e9)&&o.sn>bk.score?o.sn:(Math.floor(bk.score/CFG.BK_SHAKE_PTS)+1)*CFG.BK_SHAKE_PTS;
  bk.cr=isInt(o.cr,0,1e6)?o.cr:0;
  for(const q of o.b){
    const r=bkR(q[0]), b=bkBody(q[0],Math.max(r,Math.min(BK_JW-r,q[1])),Math.min(BK_JH-r,q[2]));
    b.a=isNum(q[3])?q[3]:0; b.born=-2;               // at rest, and old enough for the line and to bake
  }
  bk.big=Math.max(isInt(o.big,1,BK_N)?o.big:1,bk.held,bk.next,...bk.bodies.map(b=>b.k));
  return true;
}
function bkLoadRun(){ try{ return bkRestore(JSON.parse(localStorage.getItem(BK_RUN)||'null')); }catch(e){ return false; } }

/* ═══════ the treats' looks ═══════
   Each treat is painted once per layout into a sprite at device pixels (DPR capped at CFG.BK_DPR) and drawn rotated with
   drawImage. The light is fixed (top left): one soft shadow and one gloss sprite, both unrotated, serve every treat. The
   outline is a darker shade of the treat's own colour, never black. Decorations are placed by bkVisRnd, seeded per tier, so a
   Cookie always has the same chips. Faces are drawn live on top (they react), in the treat's own frame. */
const BK_LOOK=[   // base, light, outline, face ink; face: eyes at (+-ex, ey), eye size es, mouth at my (shares of r)
  {base:'#D8A26A',light:'#F1D1A6',dark:'#8E5A2C',ink:'#4A2A10',ex:.36,ey:.06,es:.15,my:.34},     // 1 Crumb
  {base:'#FF4F86',light:'#FF9DC0',dark:'#C21F56',ink:'#5C0A26',ex:.36,ey:.08,es:.14,my:.34},     // 2 Gumdrop
  {base:'#B89BFF',light:'#DCCBFF',dark:'#6F4FD0',ink:'#2E1A66',ex:.38,ey:-.24,es:.13,my:-.02},   // 3 Macaron (face on the top shell)
  {base:'#EDAE45',light:'#FBD98E',dark:'#A0601A',ink:'#4A2A10',ex:.36,ey:.06,es:.125,my:.3},     // 4 Cookie
  {base:'#E4A262',light:'#F6C98E',dark:'#9A5A22',ink:'#5A1636',ex:.44,ey:.02,es:.11,my:.38},     // 5 Donut (either side of the hole)
  {base:'#F4D7A6',light:'#FFF0D2',dark:'#A8662E',ink:'#4A2A10',ex:.36,ey:.1,es:.105,my:.33},     // 6 Cinnamon roll
  {base:'#F5B43F',light:'#FFDD88',dark:'#A8651B',ink:'#5A3008',ex:.36,ey:.16,es:.1,my:.38},      // 7 Pancake
  {base:'#E4A35C',light:'#F7CD90',dark:'#9A5E22',ink:'#4A2A10',ex:.19,ey:-.03,es:.082,my:.19},     // 8 Blueberry pie (face on the crust lid)
  {base:'#E8BC70',light:'#FFE3A8',dark:'#9C7026',ink:'#24400A',ex:.33,ey:.12,es:.09,my:.33},     // 9 Lime tart
  {base:'#6E3B23',light:'#9A6040',dark:'#3A190B',ink:'#170803',ex:.33,ey:.2,es:.088,my:.4,wh:1},      // 10 Chocolate cake
  {base:'#FFF3F8',light:'#FFFFFF',dark:'#D9609A',ink:'#5A1636',ex:.32,ey:.2,es:.085,my:.4},    // 11 Party cake
];
const BK_FILL={2:'#FF4F86',3:'#B89BFF',4:'#E9B15A',5:'#FF8FC8',6:'#F4D7A6',7:'#F5B43F',8:'#5845C8',9:'#9BDD45',10:'#6E3B23',11:'#FF8FC8',1:'#E3A95E'};   // the colour a treat reads as (crumbs, rings, the strip's glow)
function bkCircle(g,r){ g.beginPath(); g.arc(0,0,r,0,Math.PI*2); }
function bkBlob(g,cx,cy,r,n,j,ph){                          // a soft lumpy round shape (chips, dollops, the crumb itself)
  g.beginPath();
  for(let i=0;i<=n*3;i++){ const a=i/(n*3)*Math.PI*2, rr=r*(1+j*Math.sin(a*n+ph)); i?g.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr):g.moveTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr); }
  g.closePath();
}
const BK_RAINBOW=['#FF5A6E','#FFB13B','#FFE14D','#5BD67A','#4FB3FF','#A57BFF','#FFFFFF'];
function bkSprinkles(g,R,n,inner,cols){                     // little rounded sticks, any colour, any angle, inside radius inner
  g.lineCap='round'; g.lineWidth=Math.max(1,R*.06);
  for(let i=0;i<n;i++){
    const a=bkVisRnd()*Math.PI*2, d=Math.sqrt(bkVisRnd())*inner, x=Math.cos(a)*d, y=Math.sin(a)*d, t=bkVisRnd()*Math.PI, l=R*.07;
    g.strokeStyle=cols[i%cols.length]; g.beginPath(); g.moveTo(x-Math.cos(t)*l,y-Math.sin(t)*l); g.lineTo(x+Math.cos(t)*l,y+Math.sin(t)*l); g.stroke();
  }
}
// paints treat k at the origin with radius R (device px): body, decorations, outline. Not the face, shadow or gloss.
function bkPaint(g,k,R){
  const L=BK_LOOK[k-1];
  bkVisSeed=1000+k*7919;
  const fillBody=(c1,c2)=>{ const gr=g.createRadialGradient(-R*.3,-R*.35,R*.1,0,0,R*1.05); gr.addColorStop(0,c1); gr.addColorStop(1,c2); g.fillStyle=gr; };
  g.save();
  if(k===1){                                               // Crumb: a lumpy bit of cookie, like the mascot's little cousin
    bkBlob(g,0,0,R*.94,5,.05,1.1); fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
    g.fillStyle='#5B3417'; for(const [x,y,r] of [[-.42,.38,.13],[.46,.34,.11],[.38,-.5,.1],[-.1,.6,.07]]){ bkBlob(g,x*R,y*R,r*R,4,.18,x*9); g.fill(); }
    g.restore(); bkBlob(g,0,0,R*.94,5,.05,1.1);
  } else {
    bkCircle(g,R*.97);
    if(k===2){ fillBody('#FF8FB5',L.base); g.fill(); g.save(); g.clip();
      g.fillStyle='rgba(255,255,255,.75)'; for(let i=0;i<46;i++){ const a=bkVisRnd()*6.283, d=Math.sqrt(bkVisRnd())*R*.9; g.fillRect(Math.cos(a)*d,Math.sin(a)*d,R*.045,R*.045); }
      g.fillStyle='rgba(150,0,50,.18)'; g.beginPath(); g.ellipse(0,R*.62,R*.9,R*.4,0,0,6.283); g.fill();   // the gumdrop's darker bottom
      g.restore();
    } else if(k===3){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.fillStyle='#FFF4E6'; g.fillRect(-R,R*.05,R*2,R*.3);                             // the cream line
      for(let x=-R;x<R;x+=R*.12){ g.beginPath(); g.arc(x,R*.05,R*.06,Math.PI,0); g.arc(x+R*.06,R*.35,R*.06,0,Math.PI); g.fill(); }   // a frilly cream edge
      g.fillStyle='rgba(80,40,160,.16)'; g.fillRect(-R,R*.35,R*2,R*.7);                 // the bottom shell, in shade
      g.restore();
    } else if(k===4){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.strokeStyle='rgba(150,90,20,.35)'; g.lineWidth=R*.03; for(let i=0;i<5;i++){ const a=bkVisRnd()*6.283, d=R*(.3+bkVisRnd()*.5); g.beginPath(); g.moveTo(Math.cos(a)*d,Math.sin(a)*d); g.lineTo(Math.cos(a+.25)*(d+R*.12),Math.sin(a+.25)*(d+R*.12)); g.stroke(); }
      for(const [x,y,r] of [[-.5,-.35,.15],[.12,-.6,.12],[.55,-.15,.14],[-.6,.42,.12],[.5,.55,.13],[.0,.68,.1],[-.2,-.05,.09]]){
        g.fillStyle='#5B3417'; bkBlob(g,x*R,y*R,r*R,5,.15,x*7+y); g.fill();
        g.fillStyle='rgba(255,255,255,.22)'; g.beginPath(); g.arc((x-.04)*R,(y-.05)*R,r*R*.35,0,6.283); g.fill();
      }
      g.restore();
    } else if(k===5){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.fillStyle='#FF8FC8'; bkBlob(g,0,0,R*.8,7,.07,.5); g.fill();                     // icing
      g.fillStyle='rgba(255,255,255,.35)'; bkBlob(g,-R*.12,-R*.14,R*.6,7,.07,.5); g.globalCompositeOperation='source-atop'; g.globalAlpha=.4; g.fill(); g.globalAlpha=1; g.globalCompositeOperation='source-over';
      g.save(); bkBlob(g,0,0,R*.78,7,.07,.5); g.clip(); bkSprinkles(g,R,26,R*.74,BK_RAINBOW.slice(0,6)); g.restore();
      const hg=g.createRadialGradient(0,-R*.04,R*.02,0,0,R*.22); hg.addColorStop(0,'#5A2E10'); hg.addColorStop(1,'#B9783E');   // the hole
      g.fillStyle='#FF8FC8'; bkCircle(g,R*.28); g.fill();
      g.fillStyle=hg; bkCircle(g,R*.2); g.fill();
      g.strokeStyle='#C2558E'; g.lineWidth=Math.max(1,R*.03); bkCircle(g,R*.2); g.stroke();
      g.restore();
    } else if(k===6){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.strokeStyle='#B8743A'; g.lineWidth=R*.13; g.lineCap='round'; g.beginPath();     // the cinnamon swirl
      for(let i=0;i<=240;i++){ const t=i/240, a=t*Math.PI*2*2.6+.4, d=R*(.06+.84*t); i?g.lineTo(Math.cos(a)*d,Math.sin(a)*d):g.moveTo(Math.cos(a)*d,Math.sin(a)*d); }
      g.stroke();
      g.strokeStyle='rgba(120,60,20,.35)'; g.lineWidth=R*.03; g.stroke();
      g.strokeStyle='rgba(255,255,255,.9)'; g.lineWidth=R*.05;                         // icing, in a few soft strokes along the swirl
      for(const [a0,a1,d] of [[3.6,4.5,.62],[.3,1.2,.48],[5.2,5.9,.8]]){ g.beginPath(); g.arc(0,0,R*d,a0,a1); g.stroke(); }
      g.restore();
    } else if(k===7){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.strokeStyle='rgba(170,95,20,.4)'; g.lineWidth=R*.07; bkCircle(g,R*.86); g.stroke();   // the browned edge
      g.strokeStyle='rgba(255,240,190,.45)'; g.lineWidth=R*.03; bkCircle(g,R*.7); g.stroke();
      const sy=g.createRadialGradient(-R*.05,-R*.6,R*.03,0,-R*.5,R*.42); sy.addColorStop(0,'#E8913A'); sy.addColorStop(1,'#B5561A');
      g.fillStyle=sy; bkBlob(g,0,-R*.5,R*.36,5,.12,2); g.fill();                         // a pool of syrup on top ...
      for(const [x,w,y0,l] of [[-.36,.08,-.42,.42],[.34,.07,-.44,.34]]){ g.beginPath(); g.roundRect((x-w)*R,y0*R,w*2*R,l*R,w*R); g.fill(); }   // ... running down the sides
      g.fillStyle='#FFF2A8'; g.save(); g.translate(R*.02,-R*.56); g.rotate(.18); g.beginPath(); g.roundRect(-R*.2,-R*.14,R*.4,R*.28,R*.07); g.fill();   // the butter pat
      g.fillStyle='rgba(255,255,255,.75)'; g.fillRect(-R*.14,-R*.09,R*.16,R*.06); g.restore();
      g.restore();
    } else if(k===8){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.fillStyle='#4B3BB0'; bkCircle(g,R*.8); g.fill();                                  // the filling
      g.fillStyle='#2E2280'; for(let i=0;i<20;i++){ const a=bkVisRnd()*6.283, d=Math.sqrt(bkVisRnd())*R*.72; g.beginPath(); g.arc(Math.cos(a)*d,Math.sin(a)*d,R*.07,0,6.283); g.fill(); }
      g.fillStyle='rgba(170,160,255,.5)'; for(let i=0;i<12;i++){ const a=bkVisRnd()*6.283, d=Math.sqrt(bkVisRnd())*R*.72; g.beginPath(); g.arc(Math.cos(a)*d,Math.sin(a)*d,R*.025,0,6.283); g.fill(); }
      g.save(); bkCircle(g,R*.82); g.clip();
      const strip=(x,y,w,h)=>{ g.fillStyle=L.base; g.fillRect(x,y,w,h); g.strokeStyle=L.dark; g.lineWidth=Math.max(1,R*.025); g.strokeRect(x,y,w,h); };
      for(const v of [-.5,0,.5]) strip(v*R-R*.08,-R,R*.16,R*2);                         // the lattice: three down ...
      for(const v of [-.5,0,.5]) strip(-R,v*R-R*.08,R*2,R*.16);                         // ... three across ...
      for(const v of [-.5,.5]) for(const u of [-.5,0,.5]) if((Math.round(v*2)+Math.round(u*2))%2===0) strip(v*R-R*.08,u*R-R*.08,R*.16,R*.16);   // ... woven
      g.restore();
      const md=g.createRadialGradient(-R*.12,-R*.16,R*.04,0,0,R*.48); md.addColorStop(0,'#FFE7B8'); md.addColorStop(1,L.light);
      g.fillStyle=md; bkBlob(g,0,0,R*.46,12,.03,.4); g.fill();                             // a round crust lid in the middle, for the face
      g.strokeStyle=L.dark; g.lineWidth=Math.max(1,R*.03); g.stroke();
      g.strokeStyle=L.dark; g.lineWidth=R*.03; bkCircle(g,R*.82); g.stroke();
      g.strokeStyle='rgba(255,255,255,.25)'; g.setLineDash([R*.06,R*.08]); bkCircle(g,R*.9); g.stroke(); g.setLineDash([]);   // a pinched crust
      g.restore();
    } else if(k===9){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      const lf=g.createRadialGradient(-R*.2,-R*.25,R*.05,0,0,R*.8); lf.addColorStop(0,'#C9F27A'); lf.addColorStop(1,'#7CC52C');
      g.fillStyle=lf; bkBlob(g,0,0,R*.79,14,.025,0); g.fill();                         // the lime curd, in a crimped crust
      g.save(); g.translate(R*.2,-R*.38); g.rotate(-.5);                                  // a slice of lime
      g.fillStyle='#E9FFC4'; g.beginPath(); g.arc(0,0,R*.3,Math.PI,0); g.closePath(); g.fill();
      g.strokeStyle='#4E9A1A'; g.lineWidth=R*.05; g.beginPath(); g.arc(0,0,R*.3,Math.PI,0); g.stroke();
      g.strokeStyle='#A9DD5E'; g.lineWidth=R*.025; for(let i=1;i<5;i++){ const a=Math.PI+i*Math.PI/5; g.beginPath(); g.moveTo(0,0); g.lineTo(Math.cos(a)*R*.25,Math.sin(a)*R*.25); g.stroke(); }
      g.restore();
      for(const [x,y] of [[-.5,-.3],[-.25,-.55],[.6,.1]]){ g.fillStyle='#FFFFFF'; bkBlob(g,x*R,y*R,R*.1,5,.12,x*5); g.fill(); g.fillStyle='rgba(200,230,255,.6)'; g.beginPath(); g.arc((x+.03)*R,(y+.03)*R,R*.05,0,6.283); g.fill(); }
      g.restore();
    } else if(k===10){ fillBody(L.light,L.base); g.fill(); g.save(); g.clip();
      g.fillStyle='#3E1A0B'; g.beginPath(); g.moveTo(-R,-R); g.lineTo(R,-R); g.lineTo(R,-R*.12);   // glossy icing with drips
      for(let i=0;i<=10;i++){ const x=R-i*R*.2, y=-R*.12+(i%2?R*(.12+.16*((i*7)%3)/2):-R*.02); g.quadraticCurveTo(x+R*.1,y+R*.06,x,y); }
      g.lineTo(-R,-R); g.fill();
      g.strokeStyle='rgba(255,220,200,.35)'; g.lineWidth=R*.04; g.lineCap='round';
      g.beginPath(); g.arc(-R*.1,-R*.1,R*.62,Math.PI*1.12,Math.PI*1.4); g.stroke();
      g.fillStyle='rgba(255,255,255,.18)'; for(let i=0;i<4;i++){ g.fillRect(-R*.9,R*(.25+i*.18),R*1.8,R*.03); }   // the layers
      g.restore();
      g.fillStyle='#E8243C'; g.beginPath(); g.arc(R*.02,-R*.62,R*.2,0,6.283); g.fill();     // the cherry
      g.strokeStyle='#9E0F22'; g.lineWidth=R*.025; g.stroke();
      g.fillStyle='rgba(255,255,255,.75)'; g.beginPath(); g.arc(-R*.05,-R*.69,R*.06,0,6.283); g.fill();
      g.strokeStyle='#4E7A1C'; g.lineWidth=R*.035; g.lineCap='round'; g.beginPath(); g.moveTo(R*.04,-R*.8); g.quadraticCurveTo(R*.1,-R*.95,R*.24,-R*.94); g.stroke();
      bkCircle(g,R*.97);
    } else if(k===11){ fillBody('#FFFFFF','#FFE6F1'); g.fill(); g.save(); g.clip();
      g.fillStyle='#FF8FC8'; g.beginPath(); g.moveTo(-R,R*.66);                          // a pink frosting band below the face ...
      for(let i=0;i<=12;i++){ const x=-R+i*R/6; g.quadraticCurveTo(x-R/12,R*(i%2?.76:.6),x,R*.66); }
      g.lineTo(R,R); g.lineTo(-R,R); g.closePath(); g.fill();
      g.fillStyle='rgba(255,255,255,.45)'; g.fillRect(-R,R*.74,R*2,R*.04);
      bkVisSeed=1000+11*7919; g.lineCap='round'; g.lineWidth=Math.max(1,R*.06);           // ... rainbow sprinkles on top, clear of the face
      for(let i=0;i<26;i++){ const x=(bkVisRnd()*1.7-.85)*R, y=(-.34+bkVisRnd()*.32)*R, t=bkVisRnd()*Math.PI, l=R*.07;
        if(x*x+y*y>R*R*.8) continue;
        g.strokeStyle=BK_RAINBOW[i%6]; g.beginPath(); g.moveTo(x-Math.cos(t)*l,y-Math.sin(t)*l); g.lineTo(x+Math.cos(t)*l,y+Math.sin(t)*l); g.stroke(); }
      g.restore();
      for(const [x,c] of [[-.32,'#7FD8FF'],[0,'#FFD45C'],[.32,'#A57BFF']]){                // three candles
        g.fillStyle=c; g.beginPath(); g.roundRect((x-.05)*R,-R*.72,R*.1,R*.36,R*.03); g.fill();
        g.strokeStyle='rgba(255,255,255,.75)'; g.lineWidth=R*.025; for(let j=0;j<3;j++){ g.beginPath(); g.moveTo((x-.05)*R,-R*(.66-j*.1)); g.lineTo((x+.05)*R,-R*(.7-j*.1)); g.stroke(); }
        const fg=g.createRadialGradient(x*R,-R*.79,0,x*R,-R*.79,R*.11); fg.addColorStop(0,'#FFFDE0'); fg.addColorStop(.5,'#FFC53A'); fg.addColorStop(1,'rgba(255,120,40,0)');
        g.fillStyle=fg; g.beginPath(); g.ellipse(x*R,-R*.8,R*.07,R*.1,0,0,6.283); g.fill();
      }
      bkCircle(g,R*.97);
    }
  }
  g.restore();
  if(k===1) bkBlob(g,0,0,R*.94,5,.05,1.1); else bkCircle(g,R*.97);
  g.lineWidth=Math.max(1.5,R*.06); g.strokeStyle=L.dark; g.stroke();                   // the outline: the treat's own colour, darker
  g.lineWidth=Math.max(1,R*.03); g.strokeStyle='rgba(255,255,255,.35)';                  // a thin light rim just inside it
  g.beginPath(); g.arc(0,0,R*.9,Math.PI*1.05,Math.PI*1.55); g.stroke();
}
// a face, in the treat's frame, radius r (css px). mood: '' | 'happy' | 'ooh' | 'scared' | 'dizzy'; (lx, ly) where the pupils look (-1..1)
function bkFace(g,k,r,mood,lx,ly,blink,t){
  const L=BK_LOOK[k-1], ex=L.ex*r, ey=L.ey*r, er=Math.max(1.25,r*L.es), my=L.my*r, ink=L.ink;
  g.fillStyle='rgba(255,105,150,.42)';                       // cheeks
  for(const s of [-1,1]){ g.beginPath(); g.ellipse(s*(ex+er*1.35),ey+er*1.55,er*1.25,er*.75,0,0,6.283); g.fill(); }
  g.fillStyle=ink; g.strokeStyle=L.wh?'#FFF1E0':ink; g.lineCap='round'; g.lineJoin='round';
  const lw=Math.max(1,er*.55);
  if(mood==='happy'){                                       // ^ ^ and an open smile: this one is the same as the one he holds
    g.lineWidth=lw;
    for(const s of [-1,1]){ g.beginPath(); g.arc(s*ex,ey+er*.4,er*.9,Math.PI*1.15,Math.PI*1.85); g.stroke(); }
    g.fillStyle=L.wh?'#FFF1E0':ink; g.beginPath(); g.moveTo(-er*1.1,my-er*.3); g.quadraticCurveTo(0,my+er*1.6,er*1.1,my-er*.3); g.closePath(); g.fill();
    g.fillStyle='#FF7D9C'; g.beginPath(); g.ellipse(0,my+er*.45,er*.5,er*.3,0,0,6.283); g.fill();
    return;
  }
  if(mood==='dizzy'){                                       // spirals
    g.lineWidth=Math.max(.9,er*.35);
    for(const s of [-1,1]){ g.beginPath(); for(let i=0;i<=24;i++){ const a=i/24*Math.PI*3.4+t*9*s, d=er*1.15*i/24; i?g.lineTo(s*ex+Math.cos(a)*d,ey+Math.sin(a)*d):g.moveTo(s*ex,ey); } g.stroke(); }
    g.lineWidth=lw*.8; g.beginPath(); g.moveTo(-er,my); g.quadraticCurveTo(-er*.5,my-er*.5,0,my); g.quadraticCurveTo(er*.5,my+er*.5,er,my); g.stroke();
    return;
  }
  if(blink&&mood!=='scared'&&mood!=='ooh'){                 // a blink: two little lines
    g.lineWidth=lw;
    for(const s of [-1,1]){ g.beginPath(); g.moveTo(s*ex-er*.8,ey+er*.15); g.quadraticCurveTo(s*ex,ey+er*.6,s*ex+er*.8,ey+er*.15); g.stroke(); }
  } else {
    const big=mood==='scared'?1.35:mood==='ooh'?1.25:1, R=er*big;
    for(const s of [-1,1]){
      const x=s*ex, y=ey;
      if(mood==='scared'){                                    // wide whites, tiny pupils
        g.fillStyle='#fff'; g.beginPath(); g.arc(x,y,R,0,6.283); g.fill(); g.lineWidth=Math.max(.8,er*.28); g.stroke();
        g.fillStyle=ink; g.beginPath(); g.arc(x+lx*R*.3,y+ly*R*.3,R*.42,0,6.283); g.fill();
      } else {
        if(L.wh){ g.fillStyle='#FFF8EE'; g.beginPath(); g.arc(x,y,R*1.3,0,6.283); g.fill(); }   // a dark top (pie, chocolate): the eyes get whites so they read
        g.fillStyle=ink; g.beginPath(); g.arc(x+lx*er*.3,y+ly*er*.3,R,0,6.283); g.fill();
        g.fillStyle='#fff'; g.beginPath(); g.arc(x+lx*er*.3-R*.35,y+ly*er*.3-R*.38,Math.max(.6,R*.38),0,6.283); g.fill();
        if(R>3){ g.beginPath(); g.arc(x+lx*er*.3+R*.3,y+ly*er*.3+R*.32,R*.16,0,6.283); g.fill(); }
      }
    }
  }
  g.fillStyle=L.wh?'#FFF1E0':ink; g.lineWidth=lw*.8;
  if(mood==='ooh'){ g.beginPath(); g.ellipse(0,my+er*.2,er*.55,er*.7,0,0,6.283); g.fill(); }
  else if(mood==='scared'){ g.beginPath(); g.moveTo(-er*1.1,my+er*.3); for(let i=1;i<=4;i++) g.lineTo(-er*1.1+i*er*.55,my+er*.3+(i%2?-1:1)*er*.35); g.stroke();
    g.fillStyle='#8FD3FF'; g.beginPath(); const sx=ex+er*2.2, sy=ey-er*1.6; g.moveTo(sx,sy-er*1.1); g.quadraticCurveTo(sx+er*.8,sy+er*.2,sx,sy+er*.6); g.quadraticCurveTo(sx-er*.8,sy+er*.2,sx,sy-er*1.1); g.fill(); }
  else { g.beginPath(); g.moveTo(-er*.75,my); g.quadraticCurveTo(0,my+er*.95,er*.75,my); g.stroke(); }
}

/* ═══════ the view: layout, sprites, drawing ═══════ */
const bkCv=el('bkCv'), bkCtx=bkCv.getContext('2d');
const bkG={W:0,H:0,dpr:1,S:1,jx:0,jy:0,jw:0,jh:0,slot:30,stripX:0,stripY:0,stripH:40,cs:44,top:0,spr:[],ico:[],sil:[],shadow:null,gloss:null,plate:null,front:null};
function bkLayout(){
  const W=innerWidth, H=innerHeight, dpr=Math.min(devicePixelRatio||1,CFG.BK_DPR);
  const cs=getComputedStyle(safeProbe), iT=parseFloat(cs.paddingTop)||0, iB=parseFloat(cs.paddingBottom)||0;
  const slot=Math.max(22,Math.min(34,Math.floor((W-28)/11)-3)), stripY=iT+62, stripH=slot+10;
  const crumbS=Math.round(Math.max(36,Math.min(50,W*.12)));
  const top=stripY+stripH+8, bottom=H-iB-12-46-16;           // under the cookbook strip; over the Shake button
  const perW=(-BK_HOLD+BK_JH)/BK_JW;                         // the zone Crumb holds treats in, and the jar, per unit of width
  const jw=Math.max(150,Math.min(W-40,(bottom-top-crumbS*1.05-10)/perW,470));
  const S=jw/BK_JW, jh=BK_JH*S, need=crumbS*1.05+(-BK_HOLD)*S+jh+10, extra=Math.max(0,bottom-top-need);
  Object.assign(bkG,{W,H,dpr,S,jw,jh,cs:crumbS,slot,stripY,stripH,top,iB,
    jx:Math.round((W-jw)/2), jy:Math.round(top+crumbS*1.05+(-BK_HOLD)*S+extra*.3),
    stripX:Math.round((W-(slot*11+3*10))/2)});
  bkCv.width=Math.round(W*dpr); bkCv.height=Math.round(H*dpr);
  bkSprites(); bkPlate();
  const c=el('bkCrumb'); c.style.width=c.style.height=crumbS+'px';
  bkDom.key=''; bkDom.cKey='';
}
function bkSprites(){
  const {dpr,jw,slot}=bkG;
  const mk=(R,fn)=>{ const h=Math.ceil(R*1.12)+2, c=document.createElement('canvas'); c.width=c.height=Math.ceil(h*2*dpr); const g=c.getContext('2d'); g.setTransform(dpr,0,0,dpr,h*dpr,h*dpr); fn(g); return {c,h,R}; };
  bkG.spr=[]; bkG.ico=[]; bkG.sil=[];
  for(let k=1;k<=BK_N;k++){
    const R=BK_RAD[k-1]*jw;
    bkG.spr[k]=mk(R,g=>bkPaint(g,k,R));
    const ir=slot*.42;
    bkG.ico[k]=mk(ir,g=>{ bkPaint(g,k,ir); g.save(); g.scale(1,1); bkFace(g,k,ir,'',0,0,false,0); g.restore(); });
    bkG.sil[k]=mk(ir,g=>{ bkPaint(g,k,ir); g.globalCompositeOperation='source-in'; g.fillStyle='#2A1B4A'; g.fillRect(-ir*2,-ir*2,ir*4,ir*4); });
  }
  bkG.shadow=mk(50,g=>{ const gr=g.createRadialGradient(0,0,20,0,0,56); gr.addColorStop(0,'rgba(20,6,30,.5)'); gr.addColorStop(.75,'rgba(20,6,30,.22)'); gr.addColorStop(1,'rgba(20,6,30,0)'); g.fillStyle=gr; g.fillRect(-56,-56,112,112); });
  bkG.gloss=mk(50,g=>{ g.save(); g.translate(-17,-21); g.rotate(-.6); g.scale(1,.62);
    const gr=g.createRadialGradient(0,0,0,0,0,22); gr.addColorStop(0,'rgba(255,255,255,.62)'); gr.addColorStop(.6,'rgba(255,255,255,.2)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=gr; g.beginPath(); g.arc(0,0,22,0,6.283); g.fill(); g.restore();
    g.fillStyle='rgba(255,255,255,.85)'; g.beginPath(); g.arc(-22,-24,3.4,0,6.283); g.fill(); });
}
// the still parts, painted once per layout: the dusk sky, the counter the jar stands on, the glass behind the treats (plate),
// and the glass in front of them (front)
function bkPlate(){
  const {W,H,dpr,jx,jy,jw,jh}=bkG;
  const mk=fn=>{ const c=document.createElement('canvas'); c.width=Math.round(W*dpr); c.height=Math.round(H*dpr); const g=c.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); fn(g); return c; };
  const wall=Math.max(4,jw*.014), rad=Math.max(10,jw*.05), floorY=jy+jh;
  bkG.plate=mk(g=>{
    const sk=g.createLinearGradient(0,0,0,H);
    sk.addColorStop(0,'#160D2E'); sk.addColorStop(.34,'#3A2266'); sk.addColorStop(.68,'#8A4682'); sk.addColorStop(1,'#F08A6C');
    g.fillStyle=sk; g.fillRect(0,0,W,H);
    bkVisSeed=777;
    for(let i=0;i<70;i++){ const x=bkVisRnd()*W, y=bkVisRnd()*H*.5, r=bkVisRnd()*1.3+.3; g.globalAlpha=(1-y/(H*.5))*.8*bkVisRnd()+.1; g.fillStyle='#fff'; g.beginPath(); g.arc(x,y,r,0,6.283); g.fill(); }
    g.globalAlpha=1;
    const gl=g.createRadialGradient(W/2,floorY,10,W/2,floorY,W*.8); gl.addColorStop(0,'rgba(255,190,120,.35)'); gl.addColorStop(1,'rgba(255,190,120,0)');   // a warm glow behind the jar
    g.fillStyle=gl; g.fillRect(0,0,W,H);
    const cy=floorY+wall+2;                                   // the counter
    const wd=g.createLinearGradient(0,cy,0,H); wd.addColorStop(0,'#8A5434'); wd.addColorStop(.08,'#6E3F25'); wd.addColorStop(1,'#3E2013');
    g.fillStyle=wd; g.fillRect(0,cy,W,H-cy);
    g.fillStyle='rgba(255,220,170,.35)'; g.fillRect(0,cy,W,2);
    g.strokeStyle='rgba(30,10,0,.18)'; g.lineWidth=1.5; for(let i=1;i<6;i++){ g.beginPath(); g.moveTo(0,cy+i*(H-cy)/6+4); g.bezierCurveTo(W*.3,cy+i*(H-cy)/6-3,W*.6,cy+i*(H-cy)/6+6,W,cy+i*(H-cy)/6); g.stroke(); }
    g.fillStyle='rgba(20,5,0,.35)'; g.beginPath(); g.ellipse(W/2,cy+3,jw*.56,7,0,0,6.283); g.fill();   // the jar's shadow on the counter
  });
  const fx=jx-wall*2-4, fy=jy-14, fw=jw+wall*4+8, fh=jh+wall+20;     // the glass in front: just the jar's box
  const fc=document.createElement('canvas'); fc.width=Math.round(fw*dpr); fc.height=Math.round(fh*dpr);
  const fg=fc.getContext('2d'); fg.setTransform(dpr,0,0,dpr,-fx*dpr,-fy*dpr);
  bkG.front={c:fc,x:fx,y:fy,w:fw,h:fh};
  (g=>{
    g.lineJoin='round';
    g.strokeStyle='rgba(225,240,255,.55)'; g.lineWidth=wall;
    g.beginPath(); g.moveTo(jx-wall/2,jy-6); g.lineTo(jx-wall/2,floorY-rad+wall/2); g.quadraticCurveTo(jx-wall/2,floorY+wall/2,jx+rad,floorY+wall/2);
    g.lineTo(jx+jw-rad,floorY+wall/2); g.quadraticCurveTo(jx+jw+wall/2,floorY+wall/2,jx+jw+wall/2,floorY-rad+wall/2); g.lineTo(jx+jw+wall/2,jy-6); g.stroke();
    g.strokeStyle='rgba(255,255,255,.85)'; g.lineWidth=1.2;                                // a bright edge on the glass
    g.beginPath(); g.moveTo(jx-wall,jy-6); g.lineTo(jx-wall,floorY-rad); g.stroke();
    g.beginPath(); g.moveTo(jx+jw+wall,jy-6); g.lineTo(jx+jw+wall,floorY-rad); g.stroke();
    for(const x of [jx-wall/2,jx+jw+wall/2]){ g.fillStyle='rgba(235,245,255,.9)'; g.beginPath(); g.roundRect(x-wall*1.1,jy-10,wall*2.2,8,4); g.fill(); }   // the lip
    const st=g.createLinearGradient(jx,0,jx+jw*.12,0); st.addColorStop(0,'rgba(255,255,255,.22)'); st.addColorStop(1,'rgba(255,255,255,0)');   // reflections
    g.fillStyle=st; g.fillRect(jx+jw*.03,jy+jh*.06,jw*.07,jh*.8);
    g.fillStyle='rgba(255,255,255,.1)'; g.fillRect(jx+jw*.9,jy+jh*.12,jw*.025,jh*.6);
  })(fg);
}
const bkSX=x=>bkG.jx+x*bkG.S, bkSY=y=>bkG.jy+y*bkG.S;

/* ── what moves on screen besides the treats (particles and words live in the juice section below) ── */
const bkFx={parts:[],rings:[],texts:[],flash:0,shake:0,jolt:0,word:0,flip:{},dangerTick:0,cascade:null};
const bkCm={act:'',until:0,blinkAt:0,blinkTo:0};             // Crumb's face in the Bakery
function bkFresh(){
  bkFx.parts.length=0; bkFx.rings.length=0; bkFx.texts.length=0; bkFx.flash=0; bkFx.shake=0; bkFx.jolt=0; bkFx.word=0; bkFx.flip={}; bkFx.cascade=null;
  bk.touch=null; bkCm.act=''; bkDom.key=''; bkDom.cKey='';
  if(typeof bkSayReset==='function') bkSayReset();
}
const bkPopDur=()=>reduce?.12:.3;
function bkFaceMood(b,ft){                                  // the face a treat makes now
  if(bk.t-b.dz<1.6&&!reduce) return 'dizzy';
  if(bk.t-b.ooh<.3) return 'ooh';
  if(bk.danger&&bk.t-b.born>=1&&b.y-b.r<BK_LINE) return 'scared';
  if(bk.st==='play'&&bk.ready&&b.k===bk.held) return 'happy';
  return '';
}
function bkDrawTreat(g,b,x,y,r,now,ft){                     // one treat: its sprite turned by its spin, the fixed gloss, its face
  const sp=bkG.spr[b.k], sc=r/sp.R;
  let sx=1, sy=1;
  const pk=(bk.t-b.pop)/bkPopDur();
  if(pk>=0&&pk<1){ const s=1+(reduce?.06:.26)*Math.sin(pk*Math.PI)*(1-pk), q=reduce?0:.14*Math.sin(pk*Math.PI*2)*(1-pk)*(1-pk); sx=s*(1+q); sy=s*(1-q); }
  const mood=b.mood=bkFaceMood(b,ft);
  if(mood==='happy'&&bk.touch!=null&&!reduce){ const w=.035*Math.sin(now*.012+b.id); sx*=1+w; sy*=1-w; }
  g.save(); g.translate(x,y); g.scale(sx,sy);
  if(mood==='happy'&&bk.touch!=null){ g.globalAlpha=.35+.2*Math.sin(now*.01); g.fillStyle='#FFF3B0'; g.beginPath(); g.arc(0,0,r*1.12,0,6.283); g.fill(); g.globalAlpha=1; }
  g.save(); g.rotate(b.a); g.drawImage(sp.c,-sp.h*sc,-sp.h*sc,sp.h*2*sc,sp.h*2*sc); g.restore();
  const gl=bkG.gloss, gs=r/50; g.drawImage(gl.c,-gl.h*gs,-gl.h*gs,gl.h*2*gs,gl.h*2*gs);
  if(mood==='scared'&&!reduce) g.translate(Math.sin(now*.09+b.id)*r*.03,0);
  g.rotate(b.a);                                               // the face is part of the treat: it rolls with it, upside down and all
  let lx=0, ly=-.4;                                            // the eyes go to the treat he holds
  if(bk.st==='play'){ const hx=bk.aim-b.x, hy=BK_HOLD+bkR(bk.held)-b.y, d=Math.hypot(hx,hy)||1, c=Math.cos(-b.a), s=Math.sin(-b.a); lx=(hx*c-hy*s)/d; ly=(hx*s+hy*c)/d; }
  bkFace(g,b.k,r,mood,lx,ly,now<b.blinkTo&&now>=b.blinkAt,ft);
  g.restore();
}
function bkFaces(dt,now){                                    // blinks now and then (looks only); the face turns with the treat (bkDrawTreat)
  let busy=false;
  for(const b of bk.bodies){
    if(now>b.blinkTo+50){ b.blinkAt=now+1800+bkVisRnd()*5200; b.blinkTo=b.blinkAt+140; }
  }
  return busy;
}
function bkDraw(now){
  const g=bkCtx, {dpr,W,H,S,jx,jy,jw,jh}=bkG, ft=now/1000;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.drawImage(bkG.plate,0,0,W,H);
  let ox=0, oy=0;                                              // the jar jolts (a shake, a crumble); none with Reduce Motion
  if(!reduce&&bkFx.shake>.3){ ox=(bkVisRnd()-.5)*bkFx.shake; oy=(bkVisRnd()-.5)*bkFx.shake; }
  if(!reduce&&bkFx.jolt>.01) ox+=Math.sin(bkFx.jolt*26)*bkFx.jolt*9;
  g.translate(ox,oy);
  const wall=Math.max(4,jw*.014), rad=Math.max(10,jw*.05);
  g.fillStyle='rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(jx-wall,jy-4,jw+wall*2,jh+wall+4,[6,6,rad,rad]); g.fill();
  // the aim line: faint dots straight down from the treat he holds
  if(bk.touch!=null&&bk.st==='play'&&!bk.paused){
    const x=bkSX(bk.aim); g.fillStyle='rgba(255,255,255,.4)';
    for(let y=bkSY(BK_HOLD+2*bkR(bk.held))+6;y<jy+jh-2;y+=11){ g.beginPath(); g.arc(x,y,1.6,0,6.283); g.fill(); }
  }
  // the fill line
  { const y=bkSY(BK_LINE);
    if(bk.danger){ const p=.5+.5*Math.sin(now*.016); g.strokeStyle=`rgba(255,${70+60*p|0},${80+40*p|0},${.65+.35*p})`; g.lineWidth=2.6+p*1.4; }
    else { g.strokeStyle='rgba(255,255,255,.42)'; g.lineWidth=2; }
    g.setLineDash([9,7]); g.beginPath(); g.moveTo(jx+3,y); g.lineTo(jx+jw-3,y); g.stroke(); g.setLineDash([]); }
  // shadows, then treats
  const sh=bkG.shadow;
  for(const b of bk.bodies){ const r=b.r*S, s=r/50*1.04; g.drawImage(sh.c,bkSX(b.x)+r*.06-sh.h*s,bkSY(b.y)+r*.14-sh.h*s,sh.h*2*s,sh.h*2*s); }
  for(const b of bk.bodies) bkDrawTreat(g,b,bkSX(b.x),bkSY(b.y),b.r*S,now,ft);
  // the treat he holds, and the next one in a bubble beside him
  if(bk.st==='play'&&bk.ready){
    const k=bk.held, r=bkR(k)*S, p=Math.min(1,(bk.t-bk.readyAt)/(reduce?.08:.24)), s=reduce?1:p<1?easeOutBack(p):1;
    const hb=bkHeldBody||(bkHeldBody={id:0,k,a:0,pop:-9,ooh:-9,dz:-9,born:0,r:0,y:0,blinkAt:0,blinkTo:0});
    hb.k=k; hb.r=bkR(k); hb.y=BK_HOLD+hb.r; hb.x=bk.aim;
    g.save(); g.translate(bkSX(bk.aim),bkSY(BK_HOLD)+r); g.scale(s,s);
    const sp=bkG.spr[k], sc=r/sp.R; g.drawImage(sh.c,r*.06-sh.h*r/50,r*.14-sh.h*r/50,sh.h*r/25,sh.h*r/25);
    g.drawImage(sp.c,-sp.h*sc,-sp.h*sc,sp.h*2*sc,sp.h*2*sc);
    const gl=bkG.gloss, gs=r/50; g.drawImage(gl.c,-gl.h*gs,-gl.h*gs,gl.h*2*gs,gl.h*2*gs);
    bkFace(g,k,r,'',0,.9,now<hb.blinkTo&&now>=hb.blinkAt,ft);
    g.restore();
    if(now>hb.blinkTo+50){ hb.blinkAt=now+2200+bkVisRnd()*4000; hb.blinkTo=hb.blinkAt+140; }
  }
  g.drawImage(bkG.front.c,bkG.front.x,bkG.front.y,bkG.front.w,bkG.front.h);
  if(typeof bkDrawFx==='function') bkDrawFx(g,now);
  g.setTransform(dpr,0,0,dpr,0,0);
  bkDrawNext(g);
  bkDrawStrip(g,now);
  if(typeof bkDrawTop==='function') bkDrawTop(g,now);
}
let bkHeldBody=null;
function bkDrawNext(g){                                      // "next": a small bubble on Crumb's roomier side
  if(bk.st!=='play') return;
  const cx=bkSX(bk.aim), side=cx<bkG.W/2?1:-1, cs=bkG.cs;
  const x=cx+side*(cs*.5+24), y=bkSY(BK_HOLD)-cs*.42, R=17;
  g.fillStyle='rgba(255,250,240,.92)'; g.strokeStyle='rgba(110,66,32,.75)'; g.lineWidth=1.5;
  g.beginPath(); g.arc(x,y,R,0,6.283); g.fill(); g.stroke();
  g.beginPath(); g.arc(x-side*(R+3),y+R*.55,3,0,6.283); g.fill(); g.stroke();      // a thought-bubble tail toward him
  const ic=bkG.ico[bk.next], s=(R*.72)/(bkG.slot*.42);
  g.drawImage(ic.c,x-ic.h*s,y-ic.h*s,ic.h*2*s,ic.h*2*s);
  g.font='700 8.5px '+BK_FONT; g.textAlign='center'; g.fillStyle='rgba(255,255,255,.85)'; g.fillText('NEXT',x,y-R-4);
}
const BK_FONT='Fredoka,"Trebuchet MS",Verdana,system-ui,sans-serif';
// the cookbook: every treat in a row, the ones the player has never baked dark with a "?"
function bkDrawStrip(g,now){
  const {slot,stripX,stripY,stripH}=bkG, seen=lab.bakery.seen, gap=3, w=slot*11+gap*10;
  g.fillStyle='rgba(20,10,40,.45)'; g.strokeStyle='rgba(255,255,255,.14)'; g.lineWidth=1.5;
  g.beginPath(); g.roundRect(stripX-8,stripY,w+16,stripH,stripH/2); g.fill(); g.stroke();
  for(let k=1;k<=BK_N;k++){
    const cx=stripX+(k-1)*(slot+gap)+slot/2, cy=stripY+stripH/2;
    const f=bkFx.flip[k], p=f!=null?Math.min(1,(now-f)/(reduce?150:650)):1;
    const known=k<=seen&&!(p<.5);
    const sx=reduce||p>=1?1:Math.abs(Math.cos(p*Math.PI));
    if(k===bk.big&&known&&bk.st!=='card'){ g.fillStyle='rgba(255,212,92,.28)'; g.beginPath(); g.arc(cx,cy,slot*.5,0,6.283); g.fill(); }
    if(!known&&k===seen+1){ g.fillStyle='rgba(180,150,255,.16)'; g.beginPath(); g.arc(cx,cy,slot*.5,0,6.283); g.fill(); }   // the next mystery
    const ic=known?bkG.ico[k]:bkG.sil[k];
    g.save(); g.translate(cx,cy); g.scale(Math.max(.02,sx)*(p<1?1+.25*Math.sin(p*Math.PI):1),1);
    g.drawImage(ic.c,-ic.h,-ic.h,ic.h*2,ic.h*2);
    if(!known){ g.fillStyle='rgba(235,225,255,.75)'; g.font='700 '+Math.round(slot*.46)+'px '+BK_FONT; g.textAlign='center'; g.textBaseline='middle'; g.fillText('?',0,1); g.textBaseline='alphabetic'; }
    g.restore();
  }
}

/* ── the DOM parts: score, best, the Shake button, Crumb and his bubble (written only when they change) ── */
const bkDom={key:'',cKey:'',x:0,y:0,shown:0,wr:-1};
function bkCrumbAct(name,ms){ bkCm.act=name; bkCm.until=performance.now()+ms;
  const c=el('bkCrumb'), a=MASCOT_ACT[name];
  if(a&&a.move&&!reduce&&c.firstChild) c.firstChild.animate(a.move,{duration:a.dur,easing:'ease-out'}); }
function bkDomStep(now){
  if(bkDom.shown!==bk.score){ const d=bk.score-bkDom.shown; bkDom.shown=d>0?Math.min(bk.score,bkDom.shown+Math.max(1,Math.ceil(d*.2))):bk.score; }   // a quick count-up
  if(bkDom.wr!==bkDom.shown){ bkDom.wr=bkDom.shown; el('bkScore').textContent=bkDom.shown.toLocaleString('en-US'); }
  const best=Math.max(lab.bakery.best,bk.st==='play'?bk.score:0), nb=bk.st==='play'&&bk.score>lab.bakery.best&&lab.bakery.best>0;
  const D=bk.dare, hint=bk.open&&!bk.paused&&bk.st==='play'&&!lab.bakery.hi;
  const key=best+'|'+nb+'|'+bk.shakes+'|'+(bk.st==='play'&&!bk.paused)+'|'+muted+'|'+CFG.MUSIC+'|'+(D?D.beat+(D.passed?'p':''):'')+'|'+hint+'|'+bkG.W;
  if(key!==bkDom.key){
    bkDom.key=key;
    const m=el('bkBeat'); m.hidden=!D;                         // a dare: "to beat N" by the score, then ticked once passed
    if(D){ m.textContent=D.passed?'✓ beat '+D.beat.toLocaleString('en-US'):'to beat '+D.beat.toLocaleString('en-US'); m.classList.toggle('won',D.passed); }
    const h=el('bkHint'); h.hidden=!hint;                        // the first-play hint, under Crumb, until the player's first touch
    if(hint){ h.style.top=Math.round(bkSY(BK_LINE)+12)+'px'; h.classList.toggle('rm',reduce); }
    el('bkBest').textContent=best.toLocaleString('en-US'); el('bkBestLbl').textContent=nb?'New best':'Best'; el('bkBestLbl').classList.toggle('nb',nb);
    [...el('bkPips').children].forEach((p,i)=>p.classList.toggle('on',i<bk.shakes));
    el('bkShake').disabled=!(bk.shakes>0&&bk.st==='play'&&!bk.paused);
    el('bkSndBtn').classList.toggle('off',muted); el('bkMusicBtn').classList.toggle('off',!CFG.MUSIC);
  }
  // Crumb: over the treat he holds, feet on it
  const cs=bkG.cs, x=Math.round(bkSX(bk.aim)-cs/2), y=Math.round(bkSY(BK_HOLD)-cs*.84);
  if(now>=bkCm.blinkTo&&now>bkCm.blinkAt+150){ bkCm.blinkAt=now+2400+bkVisRnd()*3200; bkCm.blinkTo=bkCm.blinkAt+130; }
  let mood=bk.st==='over'||bk.st==='card'?'faint':bkCm.act&&now<bkCm.until?bkCm.act:bk.danger?'tight':'idle';
  if(bkCm.act&&now>=bkCm.until) bkCm.act='';
  const blink=now>=bkCm.blinkAt&&now<bkCm.blinkTo&&(mood==='idle'||mood==='tight');
  const ck=x+','+y+'|'+mood+(blink?' blink':'')+(reduce?' rm':'');
  if(ck!==bkDom.cKey){
    bkDom.cKey=ck; const c=el('bkCrumb');
    c.style.transform='translate('+x+'px,'+y+'px)'; c.className='crumbFig '+mood+(blink?' blink':'')+(reduce?' rm':'');
    bkDom.x=x; bkDom.y=y;
  }
  if(typeof bkSayStep==='function') bkSayStep(now);
}

/* ═══════ the loop: its own, only while the Bakery is up and not paused ═══════
   Fixed steps from an accumulator (at most 12 a frame, so a slow frame never tunnels or spirals). When every treat is asleep
   and nothing is animating it stops drawing every frame: a slow tick (4 a second) keeps the blinks going. The main game's
   loop is parked the whole time (bkParked, called first thing in draw.js frame()) and started again by bkClose. */
let bkRaf=0, bkTimer=0, bkLast=0, bkAcc=0, bkGxAt=0;
function bkKick(){
  if(!bk.open||bk.paused||document.hidden) return;
  if(bkTimer){ clearTimeout(bkTimer); bkTimer=0; }
  if(!bkRaf){ bkLast=performance.now(); bkRaf=requestAnimationFrame(bkFrame); }
}
function bkStop(){ if(bkRaf) cancelAnimationFrame(bkRaf); bkRaf=0; if(bkTimer) clearTimeout(bkTimer); bkTimer=0; }
const bkParked=()=>{ if(!bk.open) return false; bk.mainOff=true; return true; };   // draw.js frame(): the Bakery has the screen
function bkFrame(now){
  bkRaf=0;
  if(!bk.open||document.hidden) return;
  const dt=Math.min(.1,Math.max(0,(now-bkLast)/1000)); bkLast=now;
  let busy=false;
  if(!bk.paused&&bk.st==='play'){
    bkTilt(dt);
    bkAcc+=dt; let n=0;
    while(bkAcc>=BK_DT&&n<12){ bkStep(BK_DT); bkAcc-=BK_DT; n++; }
    if(n>=12) bkAcc=0;
    if(bk.queued&&bk.ready&&bk.touch==null){ bk.queued=false; bkDrop(bk.aim); }
  }
  if(typeof bkFxStep==='function') busy=bkFxStep(dt,now)||busy;
  busy=bkFaces(dt,now)||busy;
  bkDraw(now);
  bkDomStep(now);
  if(bk.paused) return;
  const idle=!busy&&bk.st!=='over'&&bk.touch==null&&!bk.queued&&bk.ready&&!bk.danger&&!bk.rain.length&&bk.bodies.every(b=>b.z)
    &&bk.t-bk.readyAt>.3&&now>=bkCm.until;
  if(idle) bkTimer=setTimeout(()=>{ bkTimer=0; if(!bk.open||bk.paused||document.hidden) return; bkLast=performance.now()-16; bkFrame(performance.now()); },250);
  else bkRaf=requestAnimationFrame(bkFrame);
}
function bkTilt(dt){                                         // gravity leans with the phone (the crumb toy's tilt), never with Reduce Motion
  toy.gx+=((CFG.TILT&&toy.tiltOn?toy.gRaw:0)-toy.gx)*Math.min(1,dt*10);
  const m=CFG.BK_TILT_MAX, gx=CFG.BK_TILT&&CFG.TILT&&!reduce?Math.max(-m,Math.min(m,toyGx())):0;
  bk.gx=gx;
  if(Math.abs(gx-bkGxAt)>.02){ bkGxAt=gx; for(const b of bk.bodies) bkWake(b); }   // a new lean wakes the pile
}

/* ── the player's finger: Crumb follows it; letting go drops the treat (a tap moves and drops) ── */
const bkCanAim=()=>bk.open&&!bk.paused&&bk.st==='play';
function bkAimAt(cx){ bk.aim=bkDropX((cx-bkG.jx)/bkG.S); }
bkCv.addEventListener('pointerdown',e=>{
  if(!bkCanAim()||bk.touch!=null) return;
  e.preventDefault(); bk.touch=e.pointerId;
  if(!lab.bakery.hi){ lab.bakery.hi=1; saveLab(); bkDom.key=''; }   // the first-play hint goes for good
  try{ bkCv.setPointerCapture(e.pointerId); }catch(_){}
  bkAimAt(e.clientX); ac();
  if(CFG.BK_TILT) toyAskTilt();
  bkKick();
});
bkCv.addEventListener('pointermove',e=>{ if(e.pointerId!==bk.touch) return; bkAimAt(e.clientX); bkKick(); });
bkCv.addEventListener('pointerup',e=>{
  if(e.pointerId!==bk.touch) return;
  bk.touch=null; if(!bkCanAim()) return;
  bkAimAt(e.clientX);
  if(bk.ready) bkDrop(bk.aim); else bk.queued=true;           // too soon after the last one: it goes as soon as he has the next
  bkKick();
});
bkCv.addEventListener('pointercancel',e=>{ if(e.pointerId===bk.touch){ bk.touch=null; bkKick(); } });

/* ── opening and leaving ── */
function bkOpen(){
  pauseForMenu(); labHide();
  bk.open=true; bk.paused=false; el('bakery').hidden=false; el('bkPause').hidden=true; el('bkOver').hidden=true;
  if(!lab.bakery.op){ lab.bakery.op=1; saveLab(); }
  bkBadge();
  if(!bk.live||bk.st!=='play'){ if(!bkLoadRun()) bkNew(); bk.live=true; }
  bkLayout();
  const c=el('bkCrumb'); if(!c.firstChild) c.innerHTML='<div class="mb">'+MASCOT_SVG+'</div>';
  closetDress(c.querySelector('svg'),{...closet.on,head:closet.on.head||'chef'});   // the Chef's hat here if the player has no hat on (the player's pick is not changed)
  bkDom.shown=bk.score; bkDom.wr=-1; bkDom.key=''; bkDom.cKey='';
  if(typeof bkSayOpen==='function') bkSayOpen();
  bkKick();
}
function bkClose(){
  if(!bk.open) return;
  if(bk.st==='play') bkSaveRun();
  bk.open=false; bk.paused=false; bk.touch=null; bkStop();
  el('bakery').hidden=true; el('bkDare').hidden=true;
  if(bk.st!=='play'||bk.dare){ bk.live=false; bk.dare=null; }   // a finished jar, or a dare the player walked away from: next time it is the player's own jar
  if(bk.mainOff){ bk.mainOff=false; requestAnimationFrame(frame); }   // the game's own loop again
}
function bkPause(){
  if(!bk.open||bk.paused||bk.st!=='play') return;
  bk.paused=true; bk.touch=null; bk.queued=false; bkSaveRun();
  el('bkPauseScore').textContent=bk.score.toLocaleString('en-US'); bkRestartReset();
  el('bkPauseSub').textContent=bk.dare?"A friend's dare: to beat "+bk.dare.beat.toLocaleString('en-US')+'. Leaving ends it.':'Your jar is saved.';
  const b=lab.bakery, ps=el('bkPauseShare'); ps.hidden=!(b.best>0&&b.bs&&b.bb);   // Share my best: the player's best run's seed, score and treat
  ps.textContent='Share my best · '+b.best.toLocaleString('en-US'); bkShareReset(ps);
  el('bkPause').hidden=false; bkStop(); bkDraw(performance.now()); bkDomStep(performance.now());
}
function bkResume(){ el('bkPause').hidden=true; bkRestartReset(); bk.paused=false; bkKick(); }
let bkRestartT=0;
function bkRestartReset(){ clearTimeout(bkRestartT); const b=el('bkRestart'); b.textContent='Restart'; b.classList.remove('confirm'); }
function bkAgain(){                                         // a fresh jar; on a dare, the same seed and the same score to beat
  if(bk.dare){ bkNew(bk.dare.seed,true); bk.dare.passed=false; } else { bkClearRun(); bkNew(); }
  bk.live=true; el('bkOver').hidden=true; el('bkPause').hidden=true; bk.paused=false; bkDom.shown=0; bkDom.wr=-1;
  if(typeof bkSayOpen==='function') bkSayOpen(true); bkKick(); }
function bkToLab(){ bkClose(); openLab(); }
function bkToHome(){ bkClose(); bkTiles(); openMenu(); }
function bkBadge(){ for(const id of ['startLab','menuLab']) el(id).classList.toggle('bkNewBadge',!lab.bakery.op);  bkTiles(); }
function bkTiles(){                                         // (rebrand) the Bakery's own tile on both home cards: three treats, and the player's best once the player has one
  const b=lab.bakery, sub=b.best||b.games?bkProg():'Drop treats, bake bigger ones';
  for(const p of ['start','menu']){
    const t=el(p+'Bakery'); el(p+'BakerySub').textContent=sub;
    if(!t._ico){ t._ico=1; [4,5,3].forEach((k,i)=>bkTreatIcon(t.querySelectorAll('canvas')[i],k)); }
  }
}
function bkProg(){ const b=lab.bakery; return (b.best?'Best '+b.best.toLocaleString('en-US')+' · ':'')+b.seen+' of '+BK_N+' treats'; }
el('bkPauseBtn').onclick=e=>{ e.stopPropagation(); bkPause(); };
el('bkResume').onclick=e=>{ e.stopPropagation(); bkResume(); };
el('bkRestart').onclick=e=>{ e.stopPropagation(); const b=el('bkRestart');
  if(!b.classList.contains('confirm')){ b.textContent='Tap again to start over'; b.classList.add('confirm'); bkRestartT=setTimeout(bkRestartReset,3000); return; }
  bkAgain(); };
el('bkPauseLab').onclick=e=>{ e.stopPropagation(); bkToLab(); };
el('bkPauseHome').onclick=e=>{ e.stopPropagation(); bkToHome(); };
el('bkAgain').onclick=e=>{ e.stopPropagation(); bkAgain(); };
el('bkOverLab').onclick=e=>{ e.stopPropagation(); bkToLab(); };
el('bkOverHome').onclick=e=>{ e.stopPropagation(); bkToHome(); };
el('bkShake').onclick=e=>{ e.stopPropagation(); if(bkCanAim()&&bkShake()) bkKick(); };
el('bkSndBtn').onclick=e=>{ e.stopPropagation(); setMuted(!muted); bkDom.key=''; bkDomStep(performance.now()); };
el('startBakery').onclick=e=>{ e.stopPropagation(); ac(); bkOpen(); };
el('menuBakery').onclick=e=>{ e.stopPropagation(); el('menuCard').hidden=true; bkOpen(); };
el('bkMusicBtn').onclick=e=>{ e.stopPropagation(); el('musicBtn').click(); bkDom.key=''; bkDomStep(performance.now()); };
addEventListener('resize',()=>{ if(bk.open){ bkLayout(); bkKick(); if(bk.paused) bkDraw(performance.now()); } });
document.addEventListener('visibilitychange',()=>{
  if(!bk.open) return;
  if(document.visibilityState==='hidden'){ bkSaveRun(); bkPause(); bkStop(); }   // the app goes to the background: saved, paused, the loop stopped
});
addEventListener('pagehide',()=>{ if(bk.open) bkSaveRun(); });
bkBadge();

/* ═══════ juice: pops, crumbs, words, sounds, haptics and Crumb's lines ═══════
   Called from the physics through the bkFx* hooks (so tests that drive bkStep with the view closed get the same game, and
   nothing here changes it). Sounds go through toyPlay (silent when Sound effects are off; the music keeps playing) with the
   synth's tone / bell / boom; every chain link climbs one step of the major pentatonic scale the game's sounds share
   (note() in audio.js). Haptics through haptic(). Reduce Motion: no screen shake or jolt, short pops, fewer crumbs. */
const BK_PART_CAP=240;
function bkBurst(x,y,n,cols,spd,size){                    // crumbs flying out (screen px)
  if(reduce) n=Math.ceil(n/3);
  for(let i=0;i<n&&bkFx.parts.length<BK_PART_CAP;i++){
    const a=bkVisRnd()*6.283, v=spd*(.35+bkVisRnd()*.75);
    bkFx.parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-spd*.35,t:0,d:.5+bkVisRnd()*.5,s:size*(.5+bkVisRnd()*.8),c:cols[i%cols.length],sq:bkVisRnd()<.5});
  }
}
function bkText(x,y,txt,size,col,dur,rise){ bkFx.texts.push({x,y,txt,size,col,t:0,d:dur||.9,rise:rise==null?46:rise}); }
const bkHap=k=>{ try{ haptic(k); }catch(e){} };
function bkFxDrop(b){
  const f=440*Math.pow(.86,b.k-1);                         // a soft bloop, lower for bigger treats
  toyPlay(0,t=>{ tone(t,{f0:f*1.5,f1:f,pdur:.07,dur:.13,vol:.07}); tone(t+.01,{f0:f*3,f1:f*2,pdur:.05,dur:.06,vol:.015,type:'triangle'}); });
  bkHap('place');
}
function bkFxReady(){ bk.aim=bkDropX(bk.aim); }
function bkFxBake(k,nb,x,y,pts,mult){
  const sx=bkSX(x), sy=bkSY(y), crumble=k>=BK_N, nk=crumble?BK_N:k+1, r=bkR(nk)*bkG.S, col=BK_FILL[nk], L=BK_LOOK[nk-1];
  bkFx.rings.push({x:sx,y:sy,r0:r*.6,r1:r*1.7,t:0,d:reduce?.2:.38,c:col});
  bkBurst(sx,sy,8+nk*2,[col,L.light,L.dark,'#FFFFFF'],140+nk*14,2.4+nk*.25);
  if(mult>=2) for(const q of bkFx.texts) q.d=Math.min(q.d,q.t+.16);   // in a chain the last link's numbers take over, the old ones fade fast
  bkText(sx,sy-r*.3,'+'+pts.toLocaleString('en-US'),Math.min(30,15+nk*1.4),'#FFFFFF');
  if(mult>=2) bkText(sx,sy-r*.3-24,'×'+mult,22+Math.min(6,mult)*3,mult>=4?'#FF8FC8':'#FFD45C',1.1,60);
  if(!reduce&&nk>=7) bkFx.shake=Math.max(bkFx.shake,nk*1.1);
  const step=Math.min(14,2+bk.chain);                      // the bell climbs the scale with the chain
  toyPlay(0,t=>{
    tone(t,{f0:900+nk*30,f1:260,pdur:.05,dur:.08,vol:.07,type:'triangle'});   // the pop
    bell(t+.012,{f:note(step),dur:.8,vol:.075,wet:.3});
    if(nk>=7) boom(t,.06+.012*(nk-7));                      // a low thump under the big ones
  });
  bkHap(bk.chain>=3||nk>=7?'combo':'clear');
  if(crumble) bkFxCrumble(sx,sy);
  else if(bk.chain>=3){ bkSay('bkChain',2); bkCrumbAct('smug',1300); }
  else if(nk>=8){ bkSay('bkBig',2); bkCrumbAct('hop',950); }
  else bkCrumbAct(nk>=5?'hop':'nod',nk>=5?950:700);
}
function bkFxCrumble(sx,sy){
  bkFx.flash=1; bkFx.word=performance.now();
  if(!reduce){ bkFx.shake=Math.max(bkFx.shake,22); bkFx.jolt=1; }
  const {jx,jy,jw,jh}=bkG;
  for(let i=0;i<6;i++) bkBurst(jx+jw*(.15+.14*i),jy+jh*.35,10,BK_RAINBOW,260,3.4);
  toyPlay(0,t=>{ boom(t,.22); for(let i=0;i<12;i++) bell(t+.08+i*.04,{f:note(4+i),dur:.6,vol:.05,wet:.4}); });
  bkHap('sweep'); bkSay('bkCrumble',3); bkCrumbAct('sweep',1700);
}
function bkFxShake(){
  if(!reduce){ bkFx.jolt=1; bkFx.shake=Math.max(bkFx.shake,10); }
  toyPlay(0,t=>{ for(let i=0;i<9;i++){ const q=t+i*.035+bkVisRnd()*.012; noiseHit(q,{dur:.03,f0:2400+bkVisRnd()*2400,q:4,vol:.05}); tone(q,{f0:700+bkVisRnd()*900,pdur:.01,dur:.04,vol:.02,type:'triangle'}); } });
  bkHap('combo'); bkSay('bkShake',2); bkCrumbAct('dizzy',1600);
}
function bkFxCharge(){
  const b=el('bkShake'); b.classList.remove('got'); void b.offsetWidth; if(!reduce) b.classList.add('got');
  toyPlay(0,t=>{ bell(t,{f:note(9),dur:.5,vol:.05}); bell(t+.07,{f:note(11),dur:.6,vol:.05}); });
}
function bkFxBeat(){                                        // a dare: the player just passed the player's friend's score
  const m=el('bkBeat'); m.classList.remove('pop'); void m.offsetWidth; if(!reduce) m.classList.add('pop');
  toyPlay(.05,t=>{ [0,2,4,7].forEach((s,i)=>bell(t+i*.08,{f:note(9+s),dur:.7,vol:.07,wet:.3})); });   // a little fanfare
  bkHap('achieve'); bkSay('bkBeat',3); bkCrumbAct('hop',950); bkDom.key='';
}
function bkFxDiscover(k,cookie){
  bkFx.flip[k]=performance.now();
  const c=el('bkNew'); c.innerHTML='NEW! <b></b>'+(cookie?' 🍪':''); c.querySelector('b').textContent=BK_NAMES[k-1];
  c.hidden=true; void c.offsetWidth; c.hidden=false; c.className=reduce?'rm':'';
  c.style.top=Math.round(bkG.jy+BK_LINE*bkG.S+14)+'px';           // in the jar, under the line: clear of Crumb and the next treat
  clearTimeout(bkFxDiscover.t); bkFxDiscover.t=setTimeout(()=>{ c.hidden=true; },reduce?1500:1900);
  const sx=bkG.stripX+(k-1)*(bkG.slot+3)+bkG.slot/2, sy=bkG.stripY+bkG.stripH/2;
  bkFx.sparks=(bkFx.sparks||[]).concat(Array.from({length:reduce?4:14},()=>({x:sx,y:sy,a:bkVisRnd()*6.283,v:30+bkVisRnd()*60,t:0})));
  toyPlay(.18,t=>{ [0,2,4].forEach((s,i)=>bell(t+i*.09,{f:note(7+s),dur:.9,vol:.07,wet:.35})); });   // a three-note arpeggio
  bkHap('achieve'); bkSay('bkNew',3);
}
function bkFxOver(){
  bk.touch=null;
  const order=bk.bodies.slice().sort((a,b)=>(a.y-a.r)-(b.y-b.r));   // top to bottom
  const gap=Math.max(.035,Math.min(.09,1.4/Math.max(1,order.length)))*(reduce?.5:1);
  bkFx.cascade={order,i:0,t:-.45,gap,done:0};
  toyPlay(.05,t=>{ [9,7,4,2,0].forEach((s,i)=>bell(t+i*.16,{f:note(s),dur:.9,vol:.06,kind:'marimba',wet:.3})); });
  bkHap('deny');
  bkSay(bk.newBest?'bkBest':'bkOver',3);
}
function bkFxStep(dt,now){                                  // moves everything above; true while anything still moves
  const F=bkFx;
  for(let i=F.parts.length-1;i>=0;i--){ const p=F.parts[i]; p.t+=dt; if(p.t>=p.d){ F.parts.splice(i,1); continue; } p.vy+=520*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=1-1.5*dt; }
  for(let i=F.texts.length-1;i>=0;i--){ const q=F.texts[i]; q.t+=dt; if(q.t>=q.d) F.texts.splice(i,1); }
  for(let i=F.rings.length-1;i>=0;i--){ const q=F.rings[i]; q.t+=dt; if(q.t>=q.d) F.rings.splice(i,1); }
  if(F.sparks){ for(const s of F.sparks) s.t+=dt; F.sparks=F.sparks.filter(s=>s.t<.7); if(!F.sparks.length) F.sparks=null; }
  F.flash=Math.max(0,F.flash-dt*3); F.shake*=Math.pow(.02,dt); if(F.shake<.3) F.shake=0; F.jolt=Math.max(0,F.jolt-dt*2.2);
  // danger: a soft tick that speeds up, and one worried line
  if(bk.danger&&!bk.paused&&bk.st==='play'){
    const k=Math.min(1,bk.overT/(CFG.BK_LINE_MS/1000)), iv=.55-.38*k;
    F.dangerTick-=dt;
    if(F.dangerTick<=0){ F.dangerTick=iv; toyPlay(0,t=>tone(t,{f0:1250+500*k,pdur:.01,dur:.05,vol:.028+.02*k,type:'square'})); }
    if(!F.dangerSaid){ F.dangerSaid=true; bkSay('bkDanger',2); }
  } else { F.dangerTick=0; if(!bk.danger) F.dangerSaid=false; }
  // game over: the treats pop one after another, top to bottom, then the card
  const C=F.cascade;
  if(C&&bk.st==='over'){
    C.t+=dt;
    while(C.i<C.order.length&&C.t>=C.i*C.gap){
      const b=C.order[C.i++], sx=bkSX(b.x), sy=bkSY(b.y), r=b.r*bkG.S;
      bkBurst(sx,sy,6+b.k,[BK_FILL[b.k],BK_LOOK[b.k-1].light,'#fff'],120+b.k*10,2.2+b.k*.2);
      F.rings.push({x:sx,y:sy,r0:r*.4,r1:r*1.3,t:0,d:.25,c:BK_FILL[b.k]});
      b.dead=true; const ci=C.i;
      toyPlay(0,t=>tone(t,{f0:300+ci*25,f1:140,pdur:.05,dur:.07,vol:.04,type:'triangle'}));
    }
    bk.bodies=bk.bodies.filter(b=>!b.dead);
    if(C.i>=C.order.length&&C.t>=C.i*C.gap+.45){ F.cascade=null; bkShowCard(); }
  }
  return !!(F.parts.length||F.texts.length||F.rings.length||F.sparks||F.flash>0||F.shake>0||F.jolt>0||F.cascade||now-(F.word||-9e9)<1400
    ||Object.values(F.flip).some(t=>now-t<700));
}
function bkDrawFx(g,now){                                   // in the jar's frame (it jolts with the treats)
  const F=bkFx;
  for(const q of F.rings){ const p=q.t/q.d; g.globalAlpha=(1-p)*.8; g.strokeStyle=q.c; g.lineWidth=4*(1-p)+1; g.beginPath(); g.arc(q.x,q.y,q.r0+(q.r1-q.r0)*easeOutCubic(p),0,6.283); g.stroke();
    g.globalAlpha=(1-p)*.35; g.fillStyle='#fff'; g.beginPath(); g.arc(q.x,q.y,(q.r0+(q.r1-q.r0)*p)*.8,0,6.283); g.fill(); }
  for(const p of F.parts){ g.globalAlpha=Math.min(1,(1-p.t/p.d)*1.6); g.fillStyle=p.c; if(p.sq) g.fillRect(p.x-p.s/2,p.y-p.s/2,p.s,p.s); else { g.beginPath(); g.arc(p.x,p.y,p.s/2,0,6.283); g.fill(); } }
  g.globalAlpha=1; g.textAlign='center';
  for(const q of F.texts){
    const p=q.t/q.d, s=p<.15?easeOutBack(p/.15):1;
    g.globalAlpha=p>.65?(1-p)/.35:1; g.font='700 '+Math.round(q.size*s)+'px '+BK_FONT;
    const y=q.y-q.rise*easeOutCubic(p);
    g.fillStyle='rgba(40,10,50,.55)'; g.fillText(q.txt,q.x+1.5,y+2);
    g.fillStyle=q.col; g.fillText(q.txt,q.x,y);
  }
  g.globalAlpha=1;
}
function bkDrawTop(g,now){                                  // over everything: the crumble's flash and its word, a discovery's sparkles
  const F=bkFx, {W,H}=bkG;
  if(F.sparks) for(const s of F.sparks){ const p=s.t/.7, d=s.v*easeOutCubic(p); g.globalAlpha=1-p; g.fillStyle=p<.5?'#FFF6C0':'#FFD45C';
    const x=s.x+Math.cos(s.a)*d, y=s.y+Math.sin(s.a)*d, r=3*(1-p)+1; g.beginPath(); g.moveTo(x,y-r*2); g.lineTo(x+r*.6,y); g.lineTo(x,y+r*2); g.lineTo(x-r*.6,y); g.closePath(); g.fill(); }
  g.globalAlpha=1;
  if(F.flash>0){ g.globalAlpha=F.flash*.7; g.fillStyle='#FFF8E8'; g.fillRect(0,0,W,H); g.globalAlpha=1; }
  const wt=(now-(F.word||-9e9))/1400;
  if(wt>=0&&wt<1){
    const s=reduce?1:wt<.18?easeOutBack(wt/.18)*1.0:1+.06*Math.sin(wt*20)*(1-wt);
    g.save(); g.translate(W/2,bkSY(BK_JH*.38)); g.scale(s,s); g.rotate(-.06);
    g.globalAlpha=wt>.75?(1-wt)/.25:1; g.textAlign='center'; g.font='700 '+Math.round(Math.min(64,W*.15))+'px '+BK_FONT;
    g.fillStyle='#5A1E5A'; g.fillText('CRUMBLE!',3,5);
    const gr=g.createLinearGradient(0,-40,0,10); gr.addColorStop(0,'#FFF3A0'); gr.addColorStop(1,'#FF8FC8'); g.fillStyle=gr; g.fillText('CRUMBLE!',0,0);
    g.restore(); g.globalAlpha=1;
  }
}

/* ── Crumb talks (the SAY bank in crumbsay.js, picked with the Bakery's own dice). One line every BK_TALK_GAP at most; a
   bigger moment (higher prio) may cut in. His bubble sits on the side away from the "next" bubble. ── */
const bkTalk={until:0,last:-1e9,prio:0,key:''};
function bkSayReset(){ bkTalk.until=0; bkTalk.prio=0; bkTalk.key=''; const e=el('bkSay'); if(e) e.hidden=true; }
function bkSay(k,prio){
  if(!CFG.FX_CRUMB_TALK||!SAY[k]) return false;
  const now=performance.now(), up=now<bkTalk.until;
  if(up&&prio<=bkTalk.prio) return false;                  // he does not talk over himself ...
  if(!up&&now-bkTalk.last<CFG.BK_TALK_GAP&&prio<3) return false;   // ... and keeps quiet a while after a line, unless it is a big moment
  const a=SAY[k], txt=a[Math.floor(bkVisRnd()*a.length)%a.length];
  bkTalk.txt=txt; bkTalk.until=now+CFG.TALK_MS; bkTalk.last=now; bkTalk.prio=prio||1; bkTalk.big=prio>=3;
  return true;
}
function bkSayOpen(again){ bkSayReset(); bkTalk.last=-1e9; bkSay(again?'bkAgain':'bkOpen',1); }
function bkSayStep(now){
  const e=el('bkSay'), on=now<bkTalk.until&&bk.open;
  if(!on){ if(bkTalk.key!==''){ bkTalk.key=''; e.hidden=true; bkTalk.prio=0; } return; }
  const cs=bkG.cs, roomL=bkDom.x-4-8, roomR=bkG.W-(bkDom.x+cs+4)-8;   // room beside him, keeping 8px off the screen edge
  const nextR=bkSX(bk.aim)<bkG.W/2;                          // the next bubble is on his roomier side (bkDrawNext) ...
  let right=nextR, under=false;                              // ... he talks on the other (right = the bubble ends at his left)
  if((right?roomL:roomR)<130){ right=!right; under=bk.st==='play'; }   // too tight there: the next bubble's side, under it
  const ny=bkSY(BK_HOLD)-cs*.42;
  const y=Math.round(under?ny+17+6:Math.max(bkG.stripY+bkG.stripH+4,bkDom.y-6));
  const x=right?Math.round(bkG.W-bkDom.x+4):Math.round(bkDom.x+cs+4), mw=Math.round(Math.max(90,Math.min(190,right?roomL:roomR)));
  const key=bkTalk.txt+'|'+right+x+','+y+','+mw;
  if(key===bkTalk.key) return; bkTalk.key=key;
  e.hidden=false; e.textContent=bkTalk.txt; e.className=(right?'fromR':'fromL')+(bkTalk.big?' big':'')+(reduce?' rm':'');
  e.style.top=y+'px'; e.style.left=right?'':x+'px'; e.style.right=right?x+'px':''; e.style.maxWidth=mw+'px';
}

/* ── the card at the end ── */
function bkShowCard(){
  bk.st='card';
  const s=lab.bakery, D=bk.dare;
  el('bkOverScore').textContent=bk.score.toLocaleString('en-US');
  const ob=el('bkOverBest'); ob.textContent=bk.newBest?'★ NEW BEST ★':'Best '+s.best.toLocaleString('en-US'); ob.classList.toggle('nb',!!bk.newBest);
  el('bkBigName').textContent=BK_NAMES[bk.big-1];
  bkTreatIcon(el('bkBigCv'),bk.big);
  const cr=el('bkOverCr'); cr.hidden=!bk.cr; cr.textContent=bk.cr?'💥 '+(bk.cr===1?'One CRUMBLE!':bk.cr+' CRUMBLES!'):'';
  // a dare: how it went against the friend, and "Send it back" (the player's score, the same seed) comes first
  const dl=el('bkOverDare'), diff=D?bk.score-D.beat:0;
  dl.hidden=!D; dl.classList.toggle('won',diff>0);
  dl.textContent=!D?'':diff>0?'You beat your friend by '+diff.toLocaleString('en-US')+'!':diff<0?(-diff).toLocaleString('en-US')+' short. So close.':'A tie! So close.';
  el('bkOverTitle').textContent=D?"A friend's dare":'The jar is full';
  el('bkSendBack').hidden=!D; el('bkShare').hidden=!!D;
  el('bkAgain').className=D?'ghost':'cta';
  bkShareReset(el('bkSendBack')); bkShareReset(el('bkShare'));
  el('bkOver').hidden=false;
  if(bk.newBest&&!reduce) bkBurst(bkG.W/2,bkG.H*.3,40,BK_RAINBOW,320,4);
}
function bkTreatIcon(c,k){                                  // a treat on a small card canvas (72 css px), smiling
  const d=Math.min(3,devicePixelRatio||1); c.width=c.height=72*d;
  const g=c.getContext('2d'); g.setTransform(d,0,0,d,36*d,36*d); bkPaint(g,k,31);
  const gl=bkG.gloss; if(gl) g.drawImage(gl.c,-gl.h*31/50,-gl.h*31/50,gl.h*2*31/50,gl.h*2*31/50);
  bkFace(g,k,31,'happy',0,0,false,0);
}
const bkArticle=n=>/^[AEIOU]/.test(n)?'an':'a';

/* ═══════ the friend link: a dare ═══════
   ?bk=SEED-SCORE-TIER-CHECK on the site the game already shares (SHARE_URL): the run's dice seed (bk.seed0: the deal stream's
   state at the start, so the same treats come in the same order), the player's score in tens, the player's biggest treat, all base 36, and a
   3-character check of the three. No name, nothing about the player. Read once at launch (bkReadLink, main.js) and taken out of the
   address bar; a link that does not parse, or whose check does not match, is ignored and the site opens as usual. */
const BK_LINK_KEY='bk';
function bkLinkCheck(seed,sc,k){ let h=7; for(const ch of seed+'|'+sc+'|'+k+'|bakery') h=(h*131+ch.charCodeAt(0))%46656; return h.toString(36).padStart(3,'0'); }
function bkLinkFor(seed,sc,k){
  return SHARE_URL+'/?'+BK_LINK_KEY+'='+[seed.toString(36),(sc/10|0).toString(36),k.toString(36),bkLinkCheck(seed,sc,k)].join('-');
}
function bkLinkParse(v){                                    // {seed, beat, tier} or null
  if(typeof v!=='string'||!/^[0-9a-z]{1,6}-[0-9a-z]{1,6}-[1-9ab]-[0-9a-z]{3}$/.test(v)) return null;
  const [a,b,c,ck]=v.split('-'), seed=parseInt(a,36), beat=parseInt(b,36)*10, tier=parseInt(c,36);
  if(!isInt(seed,1,2147483646)||!isInt(beat,0,1e9)||!isInt(tier,1,BK_N)||bkLinkCheck(seed,beat,tier)!==ck) return null;
  return {seed,beat,tier};
}
function bkReadLink(){                                      // the dare the player arrived with, if any; the address bar is tidied either way
  try{
    const q=new URLSearchParams(location.search); if(!q.has(BK_LINK_KEY)) return null;
    const d=bkLinkParse(q.get(BK_LINK_KEY));
    q.delete(BK_LINK_KEY);
    const rest=q.toString(); history.replaceState(null,'',location.pathname+(rest?'?'+rest:'')+location.hash);
    return d;
  }catch(e){ return null; }
}
function bkShareText(seed,sc,k){
  const n=BK_NAMES[k-1];
  return 'I baked '+bkArticle(n)+' '+n+" in Crumb's Bakery and scored "+sc.toLocaleString('en-US')+'. Same treats, same order. Beat it: '+bkLinkFor(seed,sc,k);
}
function bkShareCard(sc,k){                                 // the picture: the biggest treat, big, and the score
  const cv=document.createElement('canvas'); cv.width=SHARE_W; cv.height=SHARE_H; const g=cv.getContext('2d');
  const sk=g.createLinearGradient(0,0,0,SHARE_H); sk.addColorStop(0,'#1E1238'); sk.addColorStop(.55,'#7A3F7E'); sk.addColorStop(1,'#F08A6C');
  g.fillStyle=sk; g.fillRect(0,0,SHARE_W,SHARE_H);
  g.textAlign='center'; g.fillStyle='#fff'; g.font='700 92px '+BK_FONT; g.fillText("Crumb's Bakery",SHARE_W/2,170);
  g.font='600 44px '+BK_FONT; g.globalAlpha=.85; g.fillText('I baked '+bkArticle(BK_NAMES[k-1])+' '+BK_NAMES[k-1],SHARE_W/2,250); g.globalAlpha=1;
  g.save(); g.translate(SHARE_W/2,640); bkPaint(g,k,270); bkFace(g,k,270,'happy',0,0,false,0); g.restore();
  g.font='700 160px '+BK_FONT; g.fillStyle='#FFE07A'; g.fillText(sc.toLocaleString('en-US'),SHARE_W/2,1110);
  g.font='600 44px '+BK_FONT; g.fillStyle='#fff'; g.globalAlpha=.9; g.fillText(SHARE_FOOTER,SHARE_W/2,SHARE_H-70); g.globalAlpha=1;
  return cv;
}
// the game's share path: the share sheet (the app's web view, Safari) with the picture and the words; else the words alone; else the
// link is copied ('copied', the button says "Link copied"). 'cancelled' when the player closes the sheet.
async function bkShare(seed,sc,k){
  const text=bkShareText(seed,sc,k);
  if(navigator.share){
    let file=null;
    try{ const blob=await new Promise(res=>bkShareCard(sc,k).toBlob(res,'image/png')); if(blob) file=new File([blob],'crumbs-bakery.png',{type:'image/png'}); }catch(e){}
    const data=file&&navigator.canShare&&navigator.canShare({files:[file],text})?{files:[file],title:"Crumb's Bakery",text}:{title:"Crumb's Bakery",text};
    try{ await navigator.share(data); return 'shared'; }
    catch(e){ if(e&&e.name==='AbortError') return 'cancelled'; }
  }
  try{ await navigator.clipboard.writeText(text); return 'copied'; }catch(e){ return 'failed'; }
}
function bkShareReset(b){ clearTimeout(b._t); if(b._lbl!=null){ b.textContent=b._lbl; b._lbl=null; } b.classList.remove('done'); }
async function bkShareBtn(b,seed,sc,k){
  bkShareReset(b);
  const r=await bkShare(seed,sc,k).catch(()=>'failed');
  if(r!=='copied'&&r!=='failed') return r;
  b._lbl=b.textContent; b.textContent=r==='copied'?'Link copied':"Couldn't share"; b.classList.add('done');
  b._t=setTimeout(()=>bkShareReset(b),2400);
  return r;
}
el('bkShare').onclick=e=>{ e.stopPropagation(); bkShareBtn(e.currentTarget,bk.seed0,bk.score,bk.big); };
el('bkSendBack').onclick=e=>{ e.stopPropagation(); if(bk.dare) bkShareBtn(e.currentTarget,bk.dare.seed,bk.score,bk.big); };
el('bkPauseShare').onclick=e=>{ e.stopPropagation(); const b=lab.bakery; if(b.best>0&&b.bs&&b.bb) bkShareBtn(e.currentTarget,b.bs,b.best,b.bb); };

/* ── the dare card: over the Bakery, before anything else (no menu, no guided first game: those wait for the block game) ── */
function bkPeekRun(){                                      // the player's saved jar, if there is one worth asking about (an empty jar is not)
  try{ const o=JSON.parse(localStorage.getItem(BK_RUN)||'null'); return o&&o.v===1&&isInt(o.sc,0,1e9)&&Array.isArray(o.b)&&(o.b.length||o.sc)?o:null; }catch(e){ return null; }
}
function bkOpenDare(d){
  bk.live=true; bkNew(d.seed,true); bk.dare={seed:d.seed,beat:d.beat,tier:d.tier,passed:false};   // the dare's jar waits behind the card
  bkOpen();
  bk.paused=true; bkStop();
  const n=BK_NAMES[d.tier-1], mine=bkPeekRun();
  el('bkDareLine').textContent='A friend baked '+bkArticle(n)+' '+n+' and scored '+d.beat.toLocaleString('en-US')+'.';
  bkTreatIcon(el('bkDareCv'),d.tier);
  el('bkDareJar').hidden=el('bkDareMine').hidden=!mine;
  el('bkDareJar').textContent=mine?'You have a jar going ('+mine.sc.toLocaleString('en-US')+'). It stays saved.':'';
  el('bkDarePlay').textContent=mine?'Play the dare':'Play';
  el('bkDare').hidden=false; bkSayReset();
  bkDraw(performance.now()); bkDomStep(performance.now());
}
function bkDareGo(){ el('bkDare').hidden=true; bk.paused=false; bkDom.key=''; bkSayOpen(); bkKick(); }
function bkDareMine(){                                      // back to the player's own jar: the dare is dropped
  el('bkDare').hidden=true; bk.dare=null;
  if(!bkLoadRun()) bkNew();
  bk.paused=false; bkDom.shown=bk.score; bkDom.wr=-1; bkDom.key=''; bkSayOpen(); bkKick();
}
el('bkDarePlay').onclick=e=>{ e.stopPropagation(); bkDareGo(); };
el('bkDareMine').onclick=e=>{ e.stopPropagation(); bkDareMine(); };
el('bkDareWhat').onclick=e=>{ e.stopPropagation(); bkToHome(); };

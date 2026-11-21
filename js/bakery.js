// Crumble — Crumb's Bakery (Lab): drop treats into a jar; two the same that touch bake into the next bigger one.
// Plain script, loaded in order by index.html (after rescue.js); shares globals with the other js/ files. Everything here is
// prefixed bk / BK_.
/* The game in one paragraph: Crumb holds a treat over a glass jar and follows her finger; let go and he drops it. Treats are
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
const BK_RUN='crumble.bakery.run';                          // the jar in progress (localStorage)
const bkPts=k=>10*k*(k-1)/2;                                // points for baking tier k (tier 2 = 10 ... tier 11 = 550)
const bkR=k=>BK_RAD[k-1]*BK_JW;                             // a tier's full radius in units

/* ── the Bakery's own dice (a Park-Miller generator like dareRnd); its state rides in the run save ── */
let bkSeed=1;
const bkRnd=()=>(bkSeed=(bkSeed*16807)%2147483647)/2147483647;
let bkVisSeed=4242;                                         // looks only (sparkles, crumbs flying, blinks): never changes what she gets
const bkVisRnd=()=>(bkVisSeed=(bkVisSeed*16807)%2147483647)/2147483647;
function bkRoll(){                                          // the next treat: tiers 1..5 by CFG.BK_WEIGHTS
  const w=CFG.BK_WEIGHTS, sum=w.reduce((a,b)=>a+b,0);
  let r=bkRnd()*sum;
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
};
function bkNew(seed){                                       // a fresh jar (seed pins the dice: tests)
  bkSeed=bk.seed0=seed>0?Math.floor(seed)%2147483646+1:(Date.now()%2147483646)+1;
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
    fa:0,blink:0,pop:-9,ooh:-9,dz:-9,dead:false};
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
    nb.w=(a.w+b.w)/2; nb.a=(a.a+b.a)/2; nb.fa=nb.a;
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

/* ── her drops ── */
function bkDropX(x){ const r=bkR(bk.held); return Math.max(r,Math.min(BK_JW-r,x)); }
function bkDrop(x){                                         // Crumb lets go of the treat he holds, at x (units)
  if(bk.st!=='play'||!bk.ready) return null;
  const k=bk.held, r=bkR(k), b=bkBody(k,bkDropX(x),-r-6,0,140);
  b.pop=-9;
  bk.held=bk.next; bk.next=bkRoll(); bk.ready=false; bk.readyAt=bk.t+CFG.BK_DROP_MS/1000;
  if(bk.held>bk.big) bk.big=bk.held;
  if(typeof bkFxDrop==='function') bkFxDrop(b);
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
  if(newBest) s.best=bk.score;
  s.games++; saveLab();
  bkClearRun();
  if(typeof playedToday==='function') playedToday();
  if(typeof bkFxOver==='function') bkFxOver();
}

/* ── the jar in progress, saved (on each drop, on pause and when the app is hidden) and restored at rest ── */
function bkSnap(){
  return {v:1,sc:bk.score,seed:bkSeed,h:bk.held,n:bk.next,sh:bk.shakes,sn:bk.shakeNext,big:bk.big,cr:bk.cr,
    b:bk.bodies.filter(b=>!b.dead).map(b=>[b.k,Math.round(b.x*10)/10,Math.round(Math.max(b.y,-200)*10)/10,Math.round(b.a*100)/100])};
}
function bkSaveRun(){
  if(bk.st!=='play') return;
  try{ localStorage.setItem(BK_RUN,JSON.stringify(bkSnap())); }catch(e){}
}
function bkClearRun(){ try{ localStorage.removeItem(BK_RUN); }catch(e){} }
function bkRestore(o){                                      // true if o was a good save and is now the jar
  if(!o||o.v!==1||!isInt(o.sc,0,1e9)||!isInt(o.seed,1,2147483646)||!isInt(o.h,1,5)||!isInt(o.n,1,5)||!Array.isArray(o.b)||o.b.length>200) return false;
  for(const q of o.b) if(!Array.isArray(q)||!isInt(q[0],1,BK_N)||!isNum(q[1])||!isNum(q[2])) return false;
  bkNew(o.seed); bkSeed=o.seed;
  bk.score=o.sc; bk.held=o.h; bk.next=o.n;
  bk.shakes=isInt(o.sh,0,CFG.BK_SHAKE_MAX)?o.sh:0;
  bk.shakeNext=isInt(o.sn,1,1e9)&&o.sn>bk.score?o.sn:(Math.floor(bk.score/CFG.BK_SHAKE_PTS)+1)*CFG.BK_SHAKE_PTS;
  bk.cr=isInt(o.cr,0,1e6)?o.cr:0;
  for(const q of o.b){
    const r=bkR(q[0]), b=bkBody(q[0],Math.max(r,Math.min(BK_JW-r,q[1])),Math.min(BK_JH-r,q[2]));
    b.a=isNum(q[3])?q[3]:0; b.fa=0; b.born=-2;               // at rest, and old enough for the line and to bake
  }
  bk.big=Math.max(isInt(o.big,1,BK_N)?o.big:1,bk.held,bk.next,...bk.bodies.map(b=>b.k));
  return true;
}
function bkLoadRun(){ try{ return bkRestore(JSON.parse(localStorage.getItem(BK_RUN)||'null')); }catch(e){ return false; } }

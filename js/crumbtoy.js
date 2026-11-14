// Crumble — the crumb as a toy: grab it, flick it, tilt the phone and it rolls.
// Plain script, loaded in order by index.html (after mascot.js); shares globals with the other js/ files.
/* The mascot crumb (js/mascot.js) lives on the board frame's top rim. This file makes it a toy that never touches the game:
     grab    a finger on the crumb picks it up: wide eyes, arms up, it dangles from the finger
     flick   let go while moving and it flies: gravity, it spins, it bounces off the screen edges and lands on the rim
             (a one-way ledge) or on the floor under the tray; from the floor it hops back up to the rim
     dizzy   after a hard throw it lands with spiral eyes and wobbles for a moment
     sulk    thrown TOY_SULK_N times within TOY_SULK_MS it sits with a frown and shakes its head at the next grabs
     cannon  (Endless) a streak of CANNON_COMBO charges it: it glows. Thrown while charged it is a cannonball: every gem it
             flies over breaks (CANNON_PER_GEM points each) and slows it, up to CANNON_MAX gems. The one way the toy touches the board.
             Breaking the last gem is a clean sweep and passing her best is NEW BEST (game.js sweepPayoff / bestCheck).
     sling   (stakes) charged, it is a slingshot (CANNON_SLING): touch it, pull away from where it should go and let go; it leaves
             its perch the other way, faster for a longer pull (SLING_SCALE px/s per px, SLING_MIN..SLING_MAX). While she pulls a
             band runs from the perch to it and dots run along its real path (toyPath: the flight's own physics, toyFly, with the
             gems it would break taken out of a copy) for the first second. A flick still works, but only as a quick swipe
             (touch to lift within SLING_QUICK_MS, and fast at the lift); a longer gesture pulled past SLING_MIN is always the
             slingshot, whatever the finger's speed at the lift. A tap or a tiny pull gives the hint ("pull me back and let
             go!") and a one-second demo of the band and dots; no shot is spent. A cancelled pull (pointercancel, a second finger, the app hidden) puts it back on its perch, charged.
     deflate (stakes) the streak dies while it is charged (CANNON_DEFLATE): it keeps the charge but loses the growth (toy.pow 0)
             with a "pffft"; on the streak's last life a grown crumb looks worried and says "use me or lose me." once per charge
     tilt    with motion allowed, leaning the phone rolls the crumb along the rim and it stays on the low side
   Apart from the cannonball, score, tray and board are never touched; the piece drag wins (one finger on a piece: the crumb cannot be grabbed).
   The crumb moves with the CSS `translate` and `rotate` properties, so mascot.js's own transform animations still play.
   Reduced motion: the cannonball is a game ability, so it stays (charge, throw, the last chance: same flight, same gems, same
   points); the play around it is off: the crumb can only be picked up while it is charged, a throw that is not a cannonball puts
   it straight back, and there is no spin, sway, dizzy, tilt roll or hop home (it lands and is back on the rim at once).
   Switches: CFG.FX_CRUMB_TOY (Settings > Look > Advanced "Crumb is a toy", saved `toy`) and CFG.TILT ("Tilt", saved `tilt`). iOS asks once for motion: the request rides on the first finger lifted off the crumb. */
const toy={mode:'rim',x:0,y:0,vx:0,vy:0,a:0,va:0,last:0,id:-1,ox:0,oy:0,pts:[],speed:0,bounces:0,
           dizzyTo:0,sulkTo:0,hot:false,fire:null,lastCombo:0,pow:0,sc:1,sl:null,demo:null,warned:false,sputSaid:false,aimKey:'',flicks:[],bx0:0,by0:0,bt:0,btx:0,restT:0,css:'',gx:0,gRaw:0,tiltOn:false,tiltAsked:false,hapAt:0,sndAt:0};
const toyOn=()=>CFG.FX_CRUMB_TOY&&CFG.FX_MASCOT&&!!masc.el;           // the toy exists (the cannonball and the last chance need only this)
const toyGrabbable=()=>toyOn()&&(!reduce||toy.hot||toy.mode==='held');   // reduced motion: a finger takes it only while it is charged
const toyXMax=()=>Math.max(0,(B||0)-12-(masc.s||0));                       // the rim runs the board's width; home is its left end
function toyReset(){                                                // back on the rim where it stood, upright, calm
  if(toy.id>=0&&masc.el){ try{ masc.el.releasePointerCapture(toy.id); }catch(e){} }
  toy.sl=null; toy.demo=null; toyAimHide();
  toyFireEnd(); toy.mode='rim'; toy.id=-1; toy.y=0; toy.vx=toy.vy=toy.va=0; toy.a=0; toy.dizzyTo=0; toy.x=Math.max(0,Math.min(toyXMax(),toy.x)); toyWrite();
}
/* ── the cannonball ── */
const toyHot=()=>toy.hot||!!toy.fire;
function toyRunReset(){ toy.lastAsked=false; toy.hot=false; toy.fire=null; toy.lastCombo=0; toy.pow=0; toy.warned=false; toy.sputSaid=false; toy.demo=null; }          // flow.js clearRunFx: a new run starts cold
function toyCharge(comboNow){                                       // mascot.js mascotClear: every clear reports its combo
  const th=CFG.CANNON_COMBO, was=toy.lastCombo; toy.lastCombo=comboNow;
  if(toy.hot) toy.pow=Math.max(toy.pow,comboNow-th);              // already charged: a longer streak makes it bigger and stronger
  if(!CFG.CRUMB_CANNON||!toyOn()||mode!=='endless'||guide||toyHot()||comboNow<th||was>=th) return;
  toy.hot=true; toy.pow=comboNow-th; toy.warned=false;
  banners.splice(banners.length&&banners[0].t>0?1:0,0,{t:0,txt:'CANNONBALL READY!',sub:toyHow(),col:'#FFB347',k:.8});   // next in the queue: the news belongs to the clear that earned it
  haptic('bonusReady');
  toyPlay(.25,t=>{ tone(t,{f0:330,f1:660,pdur:.18,dur:.22,vol:.06,type:'triangle'}); tone(t+.16,{f0:660,f1:990,pdur:.14,dur:.2,vol:.05,type:'triangle'}); });
}
const toyHow=()=>CFG.CANNON_SLING?'pull Crumb back and let go':'flick Crumb at the blocks';   // the banners' second line
/* (stakes) Fire now, or get greedy: the growth a charged crumb gained on this streak is lost when the streak dies (game.js place) */
function toyDeflate(){
  if(!CFG.CANNON_DEFLATE||!toy.hot||toy.pow<1) return;
  toy.pow=0;                                                        // the charge stays; toySize() eases it back to the plain charged size; place() saves the run after
  toyPlay(0,t=>{ tone(t,{f0:620,f1:110,pdur:.36,dur:.4,vol:.022,type:'square'}); tone(t+.02,{f0:300,f1:80,pdur:.34,dur:.38,vol:.03,type:'triangle'}); });   // pffft
  if(!reduce&&masc.body) masc.body.animate([{transform:'scale(1.06,.9)'},{transform:'scale(.95,1.04)',offset:.5},{transform:'none'}],{duration:460,easing:'ease-out'});
  sayLine('deflate',true,true);
}
function toyLastLife(){                                             // (stakes) game.js: this drop put the streak on its last life (fireSputter)
  const grown=CFG.CANNON_DEFLATE&&toy.hot&&toy.pow>=1&&toyOn();
  mascotAct(grown?'worry':'glance');                                // a nervous glance at the board; grown, it worries about itself
  const first=!toy.sputSaid; toy.sputSaid=true;
  if(grown&&!toy.warned){ toy.warned=true; if(sayLine('useme',true,true)) return; }   // once per charge: throw now, or risk one more drop
  if(first) sayLine('sputter');                                     // once per run, on the first last life, if the talk gap allows
}
/* in flight, charged: every gem its body covers breaks (a bigger crumb cuts a wider path). p is the toy itself, or the aim's copy
   of it (toyPath) with `virt`, the cells that copy has already broken: then nothing in the game changes */
function toySmash(p=toy,virt=null){
  const f=p.fire, s=masc.s, cx=masc.x+p.x+s/2, cy=masc.y+p.y+s-s*p.sc/2;   // it grows from its feet, so its middle rides higher
  const reach=Math.max(cell*.5,s*p.sc*.5*CFG.CANNON_REACH);
  const c0=Math.max(0,Math.floor((cx-reach-bx)/cell)), c1=Math.min(N-1,Math.floor((cx+reach-bx)/cell));
  const r0=Math.max(0,Math.floor((cy-reach-by)/cell)), r1=Math.min(N-1,Math.floor((cy+reach-by)/cell));
  let hit=0;
  for(let r=r0;r<=r1&&p.fire&&f.n<f.max;r++) for(let c=c0;c<=c1&&f.n<f.max;c++){
    const g=grid[r][c]; if(!g||(virt&&virt.has(r*N+c))) continue;
    const gx=bx+(c+.5)*cell, gy=by+(r+.5)*cell;
    if(Math.hypot(gx-cx,gy-cy)>reach+cell*.2) continue;
    hit++; f.n++;
    if(virt){ virt.add(r*N+c); continue; }
    grid[r][c]=null;
    shatters.push({r,c,gi:g.gi,horiz:Math.abs(p.vx)>Math.abs(p.vy),star:false,big:true,tier:3,t:0,t0:0,ox:cx,oy:cy});
    const pts=CFG.CANNON_PER_GEM; score+=pts; f.pts+=pts;
    tags.push({x:gx,y:gy,txt:String(pts),t:0});
  }
  if(!hit) return;
  p.vx*=CFG.CANNON_KEEP; p.vy*=CFG.CANNON_KEEP;                    // one bite slows it once, however many gems were in it
  if(!virt){ shake=Math.max(shake,3*CFG.SHAKE); toy.sndAt=0; toySnd('boing',.9); toyPlay(0,t=>tone(t,{f0:1500,f1:500,pdur:.05,dur:.07,vol:.05,type:'square'})); }
  if(f.n>=f.max){ if(virt) p.fire=null; else toyFireEnd(); }
}
/* one step of flight: gravity, and while charged the bites and the ricochets inside the board. The real flight (toyStep) and the
   aim's dots (toyPath) both run this, so the dots are where it really goes */
function toyFly(p,dt,gx,virt){
  const s=masc.s, G=CFG.TOY_GRAVITY;
  p.vy+=G*dt; p.vx+=G*gx*.6*dt;
  if(!p.fire){ p.x+=p.vx*dt; p.y+=p.vy*dt; return; }
  const n=Math.max(1,Math.ceil(Math.hypot(p.vx,p.vy)*dt/(cell*.45)));   // charged: step in pieces smaller than a cell so no gem is jumped
  for(let k=0;k<n&&p.fire;k++){ p.x+=p.vx*dt/n; p.y+=p.vy*dt/n; toySmash(p,virt); }   // (spent mid-step: the rest of the flight is an ordinary one)
  if(!p.fire) return;
  const f=p.fire, bl=bx-masc.x, br=bx+B-s-masc.x, bb=by+B-s-masc.y;   // still hot: it ricochets inside the board (CANNON_BOUNCES times off the bottom) instead of dropping straight through
  if(p.y>0&&p.y<bb+s){
    if(p.x<bl&&p.vx<0){ p.x=bl; p.vx=-p.vx; if(!virt) toySnd('boing',.6); }
    if(p.x>br&&p.vx>0){ p.x=br; p.vx=-p.vx; if(!virt) toySnd('boing',.6); }
    if(p.y>bb&&p.vy>0&&f.b<CFG.CANNON_BOUNCES){ f.b++; p.y=bb; p.vy=-Math.max(p.vy*.85,cell*22); if(!virt){ toy.va=toy.vx*1.2; toySnd('boing',.8); } }
  }
}
const toyGx=()=>reduce?0:Math.abs(toy.gx)>CFG.TILT_DEAD?toy.gx-Math.sign(toy.gx)*CFG.TILT_DEAD:0;   // the tilt's pull along the screen, past its dead zone (reduced motion: no tilt roll; toy.gx itself still reads the lean for avaDir())
function toyFireEnd(){                                              // out of steam, or landed: the board is the player's again
  const f=toy.fire; if(!f) return; toy.fire=null; toy.shotN=f.n;
  if(stuck&&state==='play'&&!f.n){ toy.hot=true; return; }           // the last chance missed the board entirely: it is still charged, try again
  if(!f.n) return;
  dareCannon(f.n);                                                  // (dares) "cannonball 8 blocks"
  cookieCheck();                                                    // (cookie) it ate the cookie's gem
  if(f.n>=4) sayLine('cannon',true);
  pops.push({x:bx+B/2,y:by+cell*1.2,t:0,txt:'+'+f.pts,sub:'CANNONBALL ×'+f.n,combo:1,lines:1});
  glowT=Math.max(glowT,.8);
  if(state==='play'&&boardEmpty()){                                 // it broke the last gem: a clean sweep, with everything a drop's sweep brings (game.js)
    score+=sweepPayoff(f.n,6,true); stats.sweeps++; mascotAct('sweep'); checkGoals(); dareDrop(0,0,0,true,false,false,false);   // (dares) a cannonball's sweep counts for a sweep dare
  }
  if(state==='play') bestCheck(true);                               // and passing her best is NEW BEST, as for a drop
  updateDbg(); tlRecord();
  if(state==='play'&&stuck){                                        // the last chance is spent: room for a piece and the run goes on, otherwise it ends as it would have
    toy.lastAsked=false; checkStuck();
    if(!stuck){ pushBanner('SAVED!','Crumb made room','#7CFFB2',1); glowT=1; toyPlay(.1,t=>{ tone(t,{f0:440,f1:660,pdur:.12,dur:.16,vol:.06,type:'triangle'}); tone(t+.14,{f0:660,f1:880,pdur:.12,dur:.22,vol:.06,type:'triangle'}); }); }
  }
  if(state==='play'&&!dealing) saveRun();
}
/* The last chance (Jay 2026-11-14: "I had crumb charged and ran out of space and the game ended. should we let you clear
   space with him?"). Out of room with a charged crumb, the run does not end: checkStuck (game.js) holds, the crumb stays on
   its feet, and it can be thrown even though the board is stuck. When the cannonball is spent the board is checked again. */
const toyLast=()=>CFG.CANNON_SAVE&&stuck&&state==='play'&&toyHot()&&toyOn()&&mode==='endless';
function toyLastAsk(){
  if(toy.lastAsked) return; toy.lastAsked=true;
  banners.splice(banners.length&&banners[0].t>0?1:0,0,{t:0,txt:'LAST CHANCE!',sub:toyHow(),col:'#FFB347',k:1});
  haptic('bonusReady');
}
const toyPower=()=>Math.min(CFG.CANNON_MAX_TOP,CFG.CANNON_MAX+CFG.CANNON_GROW*toy.pow);   // gems this cannonball can break
function toySize(){                                                 // how big the crumb should be: it swells as the streak builds, more once charged
  if(toy.fire||toy.hot) return Math.min(CFG.CANNON_BIG_TOP,CFG.CANNON_BIG+CFG.CANNON_BIG_STEP*toy.pow);
  if(!CFG.CRUMB_CANNON||mode!=='endless'||guide||state!=='play') return 1;
  const th=CFG.CANNON_COMBO;
  return 1+(CFG.CANNON_BIG-1)*.55*Math.max(0,Math.min(1,(combo-1)/(th-1)));
}
function toyBusy(){ return !!toy.demo||toy.mode!=='rim'||Math.abs(toy.vx)>2||(toy.a%360!==0)||Math.abs(toy.sc-toySize())>.004; }   // draw.js fxBusy: full frame rate while it moves
function toyMood(now){                                              // mascot.js asks: the face the toy wants, or ''
  if(toy.mode==='held'||toy.mode==='air') return 'grab';
  if(now<toy.dizzyTo) return 'dizzy';
  if(now<toy.sulkTo&&toy.mode==='rim') return 'sulk';
  return '';
}
function toyWrite(){
  const el0=masc.el; if(!el0) return;
  const x=Math.round(toy.x*10)/10, y=Math.round(toy.y*10)/10, a=Math.round(toy.a*10)/10;
  const sc=Math.round(toy.sc*200)/200;
  const css=x+','+y+','+a+','+sc;
  if(css===toy.css) return; toy.css=css;
  const st=el0.style;
  st.translate=(x||y)?x+'px '+y+'px':'';
  st.rotate=a?a+'deg':'';
  st.scale=sc!==1?String(sc):'';                                   // (cannonball) it grows from its feet as it charges
  st.transformOrigin=a?'50% 54%':'';                               // it spins about its middle; at rest the mascot's own origin (its feet) is back
}
/* ── sounds and a tap of haptics: tiny, its own, and quiet under the game's ── */
// its own play(): audio.js play() rolls Math.random for a pitch jitter, and the dealer's dice must not move for a cosmetic sound
function toyPlay(delay,fn){ if(sfxOff()) return; try{ const c=ac(); fn(c.currentTime+delay); }catch(e){} }
function toyFanfare(){ toyPlay(.05,t=>{ [523,659,784,1047].forEach((f,i)=>tone(t+i*.09,{f0:f,f1:f,pdur:.05,dur:i===3?.4:.14,vol:.06,type:'triangle'})); }); }   // NEW BEST from a cannonball
function toySweepSnd(){ toyPlay(.1,t=>{ [392,523,659,784,1047].forEach((f,i)=>tone(t+i*.07,{f0:f,f1:f*1.01,pdur:.05,dur:i===4?.5:.16,vol:.06,type:'triangle'})); }); }   // a cannonball's clean sweep
function toySnd(kind,k=1){
  const now=performance.now(); if(now-toy.sndAt<60) return; toy.sndAt=now;
  if(kind==='squeak') toyPlay(0,t=>{ tone(t,{f0:620,f1:1180,pdur:.07,dur:.1,vol:.05,type:'triangle'}); });
  else if(kind==='whee') toyPlay(0,t=>{ tone(t,{f0:520,f1:1500,pdur:.22,dur:.26,vol:.045,type:'triangle'}); });
  else if(kind==='boing') toyPlay(0,t=>{ tone(t,{f0:300+220*k,f1:150,pdur:.11,dur:.15,vol:.035+.05*k,type:'sine'}); });
  else if(kind==='dizzy') toyPlay(0,t=>{ for(let i=0;i<4;i++) tone(t+i*.11,{f0:760-i*70,f1:560-i*60,pdur:.09,dur:.1,vol:.035,type:'triangle'}); });
  else if(kind==='hmph') toyPlay(0,t=>{ tone(t,{f0:210,f1:150,pdur:.12,dur:.16,vol:.07,type:'triangle'}); });
  if((kind==='boing'||kind==='squeak')&&CFG.HAPTICS&&Native.on()&&now-toy.hapAt>70){ toy.hapAt=now; hapFire(k>.6?'MEDIUM':'LIGHT'); }
}
/* ── the slingshot (stakes): the aim is one SVG over the canvas (DOM, like the crumb): a band from the perch to the crumb, and dots ── */
const AIM_DOTS=30, AIM_EVERY=2;                                  // a dot every 2 frames (1/30 s) for the first second of flight
function toyAimInit(){
  const NS='http://www.w3.org/2000/svg', g=document.createElementNS(NS,'svg');
  g.id='crumbAim'; g.setAttribute('aria-hidden','true'); g.style.display='none';
  let h='<path class="fk"/><line class="b1"/><line class="b2"/><circle class="gh"/><g class="dt">';
  for(let i=0;i<AIM_DOTS;i++) h+='<circle r="0"/>';
  g.innerHTML=h+'</g>';
  el('stage').insertBefore(g,masc.el);                               // under the crumb, over the canvas
  toy.aim=g;
}
function toyAimHide(){ if(toy.aim&&toy.aimKey!==''){ toy.aim.style.display='none'; toy.aimKey=''; el('stage').classList.remove('aiming'); } }
function toySlingV(px,py){                                           // a pull of (px,py) from the perch launches the other way
  const d=Math.hypot(px,py)||1, sp=Math.min(CFG.TOY_MAX_SPEED,CFG.SLING_SCALE*Math.min(d,CFG.SLING_MAX));
  return {vx:-px/d*sp, vy:-py/d*sp};
}
// where a slingshot from the perch at ax with this pull really goes, for about a second: the crumb's middle every few frames.
// The flight's own step (toyFly) on a copy, so gravity, tilt, every bite that slows it and the bounces inside the board are in it.
function toyPath(ax,px,py){
  const s=masc.s, v=toySlingV(px,py), xmax=toyXMax(), gx=toyGx();
  const p={x:ax,y:0,vx:v.vx,vy:v.vy,sc:toySize(),fire:{n:0,pts:0,max:toyPower(),b:0}}, virt=new Set(), out=[];
  const L=-masc.x, R=W-s-masc.x, T=-masc.y, F=H-s-masc.y, e=CFG.TOY_BOUNCE, dt=1/60;
  for(let i=1;i<=AIM_DOTS*AIM_EVERY;i++){
    const py0=p.y; toyFly(p,dt,gx,virt);
    if(p.x<L){ p.x=L; if(p.vx<0) p.vx=-p.vx*e; }
    if(p.x>R){ p.x=R; if(p.vx>0) p.vx=-p.vx*e; }
    if(p.y<T){ p.y=T; if(p.vy<0) p.vy=-p.vy*e; }
    if(i%AIM_EVERY===0) out.push([masc.x+p.x+s/2, masc.y+p.y+s-s*p.sc/2]);
    const onRim=!p.fire&&p.vy>0&&py0<=0&&p.y>=0&&p.x>-s*.6&&p.x<xmax+s*.6;
    if(onRim||p.y>=F) break;                                         // it lands: the dots stop there
  }
  return out;
}
function toyAimDraw(ax,px,py,ghost){                                  // the band from the perch to (perch + pull), and the dots once the pull is a shot
  const g=toy.aim; if(!g) return;
  const key=ax.toFixed(1)+','+px.toFixed(1)+','+py.toFixed(1)+(ghost?'g':'')+toy.sc.toFixed(2);
  if(key===toy.aimKey) return; toy.aimKey=key;
  const s=masc.s, sc=toy.sc, cx=masc.x+ax+s/2, cy=masc.y+s-s*sc/2, ux=cx+px, uy=cy+py, d=Math.hypot(px,py);
  const set=(n,a)=>{ for(const k in a) n.setAttribute(k,a[k]); };
  const rim=by-9, yb=rim-s*.95, fy=rim-s*.4, half=s*.5;                 // a little wooden fork on the rim, hidden behind the crumb at rest
  const w=Math.max(2,5-3*Math.min(1,d/CFG.SLING_MAX));                  // the band thins as it stretches
  set(g.querySelector('.fk'),{d:`M${cx} ${rim}V${fy}L${cx-half} ${yb}M${cx} ${fy}L${cx+half} ${yb}`});
  set(g.querySelector('.b1'),{x1:cx-half,y1:yb,x2:ux,y2:uy,'stroke-width':w});
  set(g.querySelector('.b2'),{x1:cx+half,y1:yb,x2:ux,y2:uy,'stroke-width':w});
  set(g.querySelector('.gh'),{cx:ux,cy:uy,r:ghost?s*sc*.42:0});
  const pts=d>=CFG.SLING_MIN?toyPath(ax,px,py):[], dots=g.querySelector('.dt').children;
  for(let i=0;i<AIM_DOTS;i++){
    const q=pts[i], c=dots[i];
    if(!q){ c.setAttribute('r',0); continue; }
    set(c,{cx:q[0].toFixed(1),cy:q[1].toFixed(1),r:(4.2-2.2*i/AIM_DOTS).toFixed(2),opacity:(1-.6*i/AIM_DOTS).toFixed(2)});
  }
  if(g.style.display){ g.style.display=''; el('stage').classList.add('aiming'); }   // (the dare chip steps back while the aim is up)
}
function toyDemoPull(ax){                                            // the demo's pull: back from the board's middle, kept on screen
  const s=masc.s, sc=toySize(), cx=masc.x+ax+s/2, cy=masc.y+s-s*sc/2;
  let ux=bx+B/2-cx, uy=by+B/2-cy; const d=Math.hypot(ux,uy)||1; ux/=d; uy/=d;
  let L=CFG.SLING_MIN+.45*(CFG.SLING_MAX-CFG.SLING_MIN), px=-ux*L, py=-uy*L, k=1;
  if(cx+px<8) k=Math.min(k,(cx-8)/-px); if(cx+px>W-8) k=Math.min(k,(W-8-cx)/px);
  if(cy+py<8) k=Math.min(k,(cy-8)/-py); if(cy+py>H-8) k=Math.min(k,(H-8-cy)/py);
  k=Math.max(CFG.SLING_MIN/L,k);
  return {px:px*k, py:py*k};
}
function toyHint(now){                                               // a tap or a tiny pull on a charged crumb: how to do it, and a demo; nothing is spent
  sayLine('hint',true,true);
  toy.demo={t0:now,until:now+1100};
}
function toySlingCancel(){                                           // a pull that did not finish: back on the perch, still charged
  const sl=toy.sl; if(!sl) return;
  if(toy.id>=0&&masc.el){ try{ masc.el.releasePointerCapture(toy.id); }catch(e){} }
  toy.sl=null; toy.id=-1; toyAimHide();
  toy.mode='rim'; toy.x=sl.ax; toy.y=0; toy.vx=toy.vy=toy.va=0; toy.a=0; toyWrite();
}
/* ── the finger ── */
function toyDown(e){
  if(!toyGrabbable()||state!=='play'||paused||drag) return;
  e.stopPropagation();                                            // the game's own pointerdown never sees a touch on the crumb, grabbed or not (a tap on it down by the tray must not pick up a piece)
  if((stuck&&!toyLast())||masc.fainted||toy.id>=0) return;
  const now=performance.now();
  if(now<toy.sulkTo&&toy.mode==='rim'&&!toyLast()){                           // sulking: it shakes its head and stays put
    toySnd('hmph'); sayLine('sulk',true);
    masc.body.animate([{transform:'none'},{transform:'rotate(-9deg)'},{transform:'rotate(8deg)'},{transform:'rotate(-6deg)'},{transform:'none'}],{duration:420,easing:'ease-in-out'});
    return;
  }
  if(toy.mode==='back') return;
  const rim=toy.mode==='rim';
  toy.id=e.pointerId; try{ masc.el.setPointerCapture(e.pointerId); }catch(err){}   // (the pull keeps tracking over the tray or off the crumb)
  toy.demo=null; toyAimHide();
  toy.sl=toy.hot&&rim&&CFG.CANNON_SLING?{ax:Math.max(0,Math.min(toyXMax(),toy.x))}:null;   // (stakes) charged on its perch: a slingshot
  toy.ox=e.clientX-(masc.x+toy.x); toy.oy=e.clientY-(masc.y+toy.y);
  toy.pts=[{t:now,x:e.clientX,y:e.clientY}]; toy.t0=now; toy.mode='held'; toy.vx=toy.vy=0; toy.dizzyTo=0;
  toySnd('squeak');
}
function toyMove(e){
  if(e.pointerId!==toy.id||toy.mode!=='held') return;
  e.stopPropagation();
  const now=performance.now(), p=toy.pts;
  p.push({t:now,x:e.clientX,y:e.clientY}); while(p.length>2&&now-p[0].t>CFG.TOY_FLICK_MS+10) p.shift();
  let x=e.clientX-toy.ox-masc.x, y=e.clientY-toy.oy-masc.y;
  if(toy.sl){                                                       // the band stretches no further than SLING_MAX
    const dx=x-toy.sl.ax, d=Math.hypot(dx,y), M=CFG.SLING_MAX;
    if(d>M){ x=toy.sl.ax+dx*M/d; y=y*M/d; }
  }
  toy.x=x; toy.y=y;
}
function toyUp(e){
  if(e.pointerId!==toy.id) return;
  e.stopPropagation();
  try{ masc.el.releasePointerCapture(toy.id); }catch(err){}
  toy.id=-1;
  if(e.type==='pointerup') toyAskTilt();                          // iOS only grants motion from a lifted finger
  if(toy.mode!=='held') return;
  const now=performance.now(), p=toy.pts, a=p[0], b=p[p.length-1], dt=Math.max(16,b.t-a.t)/1000;
  let vx=0, vy=0;
  if(e.type==='pointerup'&&p.length>1&&now-b.t<CFG.TOY_FLICK_MS){ vx=(b.x-a.x)/dt; vy=(b.y-a.y)/dt; }
  const sp=Math.hypot(vx,vy), cap=CFG.TOY_MAX_SPEED;
  if(sp>cap){ vx*=cap/sp; vy*=cap/sp; }
  toy.speed=Math.min(sp,cap); toy.bounces=0; toy.restT=0; toy.shotN=0;
  const sl=toy.sl;
  if(sl){                                                           // (stakes) the slingshot
    toy.sl=null; toyAimHide();
    const home=()=>{ toy.mode='rim'; toy.x=sl.ax; toy.y=0; toy.vx=toy.vy=toy.va=0; toy.a=0; };
    const can=toy.hot&&state==='play'&&(!stuck||toyLast());
    if(e.type!=='pointerup'||!can){ home(); return; }               // cancelled: back on the perch, still charged
    const quick=now-toy.t0<CFG.SLING_QUICK_MS&&toy.speed>=CFG.TOY_FLICK_MIN*3;   // a quick swipe is a flick; anything longer (the band and dots were up) is the slingshot, however the finger left
    if(!quick){
      const px=toy.x-sl.ax, py=toy.y;
      if(Math.hypot(px,py)<CFG.SLING_MIN){ home(); toyHint(now); return; }   // a tap or a tiny pull: the hint, no shot spent
      const v=toySlingV(px,py);
      home(); toy.mode='air'; toy.vx=v.vx; toy.vy=v.vy; toy.speed=Math.hypot(v.vx,v.vy);   // it leaves from its perch, the way the dots showed
      toy.hot=false; toy.fire={n:0,pts:0,max:toyPower(),b:0};
      toy.va=reduce?0:(v.vx*.5+(v.vy<0?v.vx:-v.vx)*.2)+(v.vx>=0?90:-90);
      dareFlick();                                                  // (dares) a slingshot is a throw too: "don't flick me" is lost
      toySnd('whee'); toyPlay(0,t=>tone(t,{f0:180,f1:520,pdur:.06,dur:.12,vol:.05,type:'triangle'}));   // twang
      return;
    }
  }                                                                 // a quick fast swipe: a flick, as always
  const shot=toy.hot&&toy.speed>=CFG.TOY_FLICK_MIN*3&&state==='play'&&(!stuck||toyLast());   // charged and thrown: a cannonball
  if(shot){ toy.hot=false; toy.fire={n:0,pts:0,max:toyPower(),b:0}; }
  if(reduce&&!shot){ toy.mode='rim'; toy.y=0; toy.vx=toy.vy=toy.va=0; toy.a=0; toy.x=Math.max(0,Math.min(toyXMax(),toy.x)); return; }   // reduced motion: only a cannonball flies
  if(toy.speed<CFG.TOY_FLICK_MIN&&Math.abs(toy.y)<10&&toy.x>-masc.s*.5&&toy.x<toyXMax()+masc.s*.5){   // put down where it stood: a poke
    toy.mode='rim'; toy.y=0; toy.vx=0; toy.x=Math.max(0,Math.min(toyXMax(),toy.x)); mascotAct('nod'); sayLine('poke'); return;
  }
  if(toy.speed>=CFG.TOY_FLICK_MIN) dareFlick();                   // (dares) "don't flick me": a throw ends it
  toy.mode='air'; toy.vx=vx; toy.vy=vy; toy.va=reduce?0:(vx*.5+(vy<0?vx:-vx)*.2)+(vx>=0?90:-90);
  if(toy.speed>=CFG.TOY_FLICK_MIN*3){
    toySnd('whee');
    if(!shot) toy.flicks.push(now); toy.flicks=toy.flicks.filter(t=>now-t<CFG.TOY_SULK_MS);
  }
}
/* ── tilt: the phone's own gravity ── */
function toyMotion(e){
  const g=e.accelerationIncludingGravity; if(!g||g.x==null) return;
  const ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Mac/.test(navigator.userAgent));
  toy.gRaw=Math.max(-1,Math.min(1,(ios?1:-1)*(CFG.TILT_FLIP?-1:1)*g.x/9.81));     // + = the phone's right edge is the low one (iOS reports the opposite sign to the spec)
}
function toyTiltListen(){ if(toy.tiltOn) return; toy.tiltOn=true; addEventListener('devicemotion',toyMotion,{passive:true}); }
function toyAskTilt(fromSwitch){                                   // must run inside a user gesture
  if(!CFG.TILT||toy.tiltOn||(toy.tiltAsked&&!fromSwitch)||typeof DeviceMotionEvent==='undefined') return;
  toy.tiltAsked=true;
  const rp=DeviceMotionEvent.requestPermission;
  if(typeof rp!=='function'){ toyTiltListen(); return; }
  try{ rp.call(DeviceMotionEvent).then(r=>{ if(r==='denied'){ CFG.TILT=false; saveSkinSave(); renderFxPicks(); } else toyTiltListen(); }).catch(()=>{}); }catch(e){}
}
/* ── the step: mascot.js mascotStep calls this every drawn frame while the crumb shows ── */
function toyLand(now,hard){                                         // on the rim (or the floor) after a flight
  if(reduce){ if(toy.mode==='floor'){ toy.mode='rim'; toy.y=0; toy.vx=0; toy.x=Math.max(0,Math.min(toyXMax(),toy.x)); } toy.a=0; return; }   // reduced motion: no dizzy spell, no roll and hop home
  if(hard||toy.bounces>=3) { toy.dizzyTo=now+CFG.TOY_DIZZY_MS; toySnd('dizzy'); if(!toy.shotN) sayLine('dizzy'); }
  if(toy.flicks.length>=CFG.TOY_SULK_N){ toy.flicks=[]; toy.sulkTo=now+CFG.TOY_DIZZY_MS+CFG.TOY_SULK_HOLD; }
}
function toyStep(now){
  const dt=Math.min(.05,Math.max(0,(now-toy.last)/1000)); toy.last=now;
  if(!paused) toy.gx+=((CFG.TILT&&toy.tiltOn?toy.gRaw:0)-toy.gx)*Math.min(1,dt*10);   // the smoothed lean: the roll below, and (lean) avaDir() for an Avalanche, toy or not, Reduce Motion or not
  if(!toyOn()){ toy.sc=1; if(toy.mode!=='rim'||toy.a||toy.y||toy.css.slice(-2)!==',1') toyReset(); return; }
  { const tg=toySize(); toy.sc=reduce||Math.abs(tg-toy.sc)<.004?tg:toy.sc+(tg-toy.sc)*Math.min(1,dt*7); }   // reduced motion: it is its size at once, no swelling
  if(paused||!dt) return;
  const s=masc.s, xmax=toyXMax(), G=CFG.TOY_GRAVITY;
  const gx=toyGx();
  if(masc.fainted&&toy.mode!=='rim'){ toyReset(); return; }
  if(toy.demo){                                                     // (stakes) the hint's demo: the band and the dots by themselves, about a second
    const d=toy.demo;
    if(now>=d.until||!toy.hot||toy.mode!=='rim'||state!=='play'){ toy.demo=null; toyAimHide(); }
    else { const q=toyDemoPull(toy.x), k=reduce?1:1-Math.pow(1-Math.min(1,(now-d.t0)/420),3); toyAimDraw(toy.x,q.px*k,q.py*k,true); }   // reduced motion: a still picture
  }
  if(toy.mode==='held'){
    const p=toy.pts, a=p[0], b=p[p.length-1], vx=p.length>1?(b.x-a.x)/Math.max(.016,(b.t-a.t)/1000):0;
    if(toy.sl){ toy.a=0; toyAimDraw(toy.sl.ax,toy.x-toy.sl.ax,toy.y,false); }   // (stakes) in the band it holds still; the aim follows the pull
    else if(!reduce) toy.a+=((Math.max(-28,Math.min(28,-vx*.03)))-toy.a)*Math.min(1,dt*12);        // it swings behind the finger
  }else if(toy.mode==='air'){
    const py=toy.y;
    toyFly(toy,dt,gx,null);                                         // gravity; charged, the bites and the ricochets inside the board
    if(!reduce) toy.a+=toy.va*dt;                                   // (reduced motion: the same flight, without the spin)
    const L=-masc.x, R=W-s-masc.x, T=-masc.y, F=H-s-masc.y, e=CFG.TOY_BOUNCE;
    const hit=(v)=>{ toy.bounces++; toySnd('boing',Math.min(1,Math.abs(v)/1400)); };
    if(toy.x<L){ toy.x=L; if(toy.vx<0){ hit(toy.vx); toy.vx=-toy.vx*e; toy.va=toy.vy*.4; } }
    if(toy.x>R){ toy.x=R; if(toy.vx>0){ hit(toy.vx); toy.vx=-toy.vx*e; toy.va=-toy.vy*.4; } }
    if(toy.y<T){ toy.y=T; if(toy.vy<0){ hit(toy.vy); toy.vy=-toy.vy*e; } }
    const onRim=!toy.fire&&toy.vy>0&&py<=0&&toy.y>=0&&toy.x>-s*.6&&toy.x<xmax+s*.6;         // the board's top rim: a ledge from above only
    if(onRim||toy.y>=F){
      const v=toy.vy; toy.y=onRim?0:F;
      if(v>CFG.TOY_REST_V){ hit(v); toy.vy=-v*e*.75; toy.vx*=.8; toy.va=toy.vx*1.2; }
      else if(onRim){ toyFireEnd(); toy.mode='rim'; toy.vy=0; toy.x=Math.max(0,Math.min(xmax,toy.x)); toyLand(now,toy.speed>=CFG.TOY_DIZZY_V); }
      else { toyFireEnd(); toy.mode='floor'; toy.vy=0; toy.restT=now; toyLand(now,toy.speed>=CFG.TOY_DIZZY_V); }
    }
  }else if(toy.mode==='floor'){                                      // under the tray: it rolls to a stop, then hops home
    toy.vx*=Math.exp(-3*dt); toy.x+=toy.vx*dt; toy.a+=toy.vx*dt/(s*.5)*57.3;
    toy.x=Math.max(-masc.x,Math.min(W-s-masc.x,toy.x));
    if(Math.abs(toy.vx)<12&&now>=toy.dizzyTo&&now-toy.restT>350){ toy.mode='back'; toy.bt=now; toy.bx0=toy.x; toy.by0=toy.y; toy.btx=Math.max(0,Math.min(xmax,toy.x)); toy.vx=0; toySnd('boing',.3); }
  }else if(toy.mode==='back'){                                       // one hop back up onto the rim
    const k=Math.min(1,(now-toy.bt)/CFG.TOY_BACK_MS), ek=k*k*(3-2*k);
    toy.x=toy.bx0+(toy.btx-toy.bx0)*ek;
    toy.y=toy.by0*(1-ek)-Math.sin(Math.PI*k)*s*1.6;
    toy.a=toy.a*(1-ek);
    if(k>=1){ toy.mode='rim'; toy.y=0; toy.a=0; toy.vx=0; masc.body.animate([{transform:'scale(1.12,.84)'},{transform:'none'}],{duration:260,easing:'ease-out'}); }
  }else{                                                             // on the rim: the tilt rolls it, friction stops it
    if(toy.y) toy.y=0;
    if(!masc.fainted) toy.vx+=G*gx*CFG.TILT_PUSH*dt; toy.vx*=Math.exp(-CFG.TOY_RIM_DRAG*dt);
    if(Math.abs(toy.vx)<3&&!gx) toy.vx=0;
    const x0=toy.x; toy.x+=toy.vx*dt;
    if(toy.x<0){ toy.x=0; if(toy.vx<-60) toySnd('boing',.2); toy.vx=toy.vx<-60?-toy.vx*.3:0; }
    if(toy.x>xmax){ toy.x=xmax; if(toy.vx>60) toySnd('boing',.2); toy.vx=toy.vx>60?-toy.vx*.3:0; }
    const dx=toy.x-x0;
    if(dx) toy.a+=dx/(s*.5)*57.3;                              // it rolls: one turn per circumference
    else if(toy.a){                                                 // stopped: it rights itself the short way
      const tgt=Math.round(toy.a/360)*360, d=tgt-toy.a;
      toy.a=Math.abs(d)<1.5?0:toy.a+d*Math.min(1,dt*9);
    }
  }
  toyWrite();
}
function toyInit(){
  const m=masc.el; if(!m) return;
  toyAimInit();
  addEventListener('pointerdown',e=>{ if(toy.sl&&toy.id>=0&&e.pointerId!==toy.id){ e.stopPropagation(); toySlingCancel(); } },{capture:true});   // a second finger mid-pull: the pull is off, and that finger picks up nothing
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') toySlingCancel(); });
  m.addEventListener('pointerdown',toyDown);
  m.addEventListener('pointermove',toyMove);
  m.addEventListener('pointerup',toyUp);
  m.addEventListener('pointercancel',toyUp);
}

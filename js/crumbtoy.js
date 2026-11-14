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
     tilt    with motion allowed, leaning the phone rolls the crumb along the rim and it stays on the low side
   Apart from the cannonball, score, tray and board are never touched; the piece drag wins (one finger on a piece: the crumb cannot be grabbed).
   The crumb moves with the CSS `translate` and `rotate` properties, so mascot.js's own transform animations still play.
   Reduced motion: the cannonball is a game ability, so it stays (charge, throw, the last chance: same flight, same gems, same
   points); the play around it is off: the crumb can only be picked up while it is charged, a throw that is not a cannonball puts
   it straight back, and there is no spin, sway, dizzy, tilt roll or hop home (it lands and is back on the rim at once).
   Switches: CFG.FX_CRUMB_TOY (Settings > Look > Advanced "Crumb is a toy", saved `toy`) and CFG.TILT ("Tilt", saved `tilt`). iOS asks once for motion: the request rides on the first finger lifted off the crumb. */
const toy={mode:'rim',x:0,y:0,vx:0,vy:0,a:0,va:0,last:0,id:-1,ox:0,oy:0,pts:[],speed:0,bounces:0,
           dizzyTo:0,sulkTo:0,hot:false,fire:null,lastCombo:0,pow:0,sc:1,flicks:[],bx0:0,by0:0,bt:0,btx:0,restT:0,css:'',gx:0,gRaw:0,tiltOn:false,tiltAsked:false,hapAt:0,sndAt:0};
const toyOn=()=>CFG.FX_CRUMB_TOY&&CFG.FX_MASCOT&&!!masc.el;           // the toy exists (the cannonball and the last chance need only this)
const toyGrabbable=()=>toyOn()&&(!reduce||toy.hot||toy.mode==='held');   // reduced motion: a finger takes it only while it is charged
const toyXMax=()=>Math.max(0,(B||0)-12-(masc.s||0));                       // the rim runs the board's width; home is its left end
function toyReset(){                                                // back on the rim where it stood, upright, calm
  if(toy.id>=0&&masc.el){ try{ masc.el.releasePointerCapture(toy.id); }catch(e){} }
  toyFireEnd(); toy.mode='rim'; toy.id=-1; toy.y=0; toy.vx=toy.vy=toy.va=0; toy.a=0; toy.dizzyTo=0; toy.x=Math.max(0,Math.min(toyXMax(),toy.x)); toyWrite();
}
/* ── the cannonball ── */
const toyHot=()=>toy.hot||!!toy.fire;
function toyRunReset(){ toy.lastAsked=false; toy.hot=false; toy.fire=null; toy.lastCombo=0; toy.pow=0; }          // flow.js clearRunFx: a new run starts cold
function toyCharge(comboNow){                                       // mascot.js mascotClear: every clear reports its combo
  const th=CFG.CANNON_COMBO, was=toy.lastCombo; toy.lastCombo=comboNow;
  if(toy.hot) toy.pow=Math.max(toy.pow,comboNow-th);              // already charged: a longer streak makes it bigger and stronger
  if(!CFG.CRUMB_CANNON||!toyOn()||mode!=='endless'||guide||toyHot()||comboNow<th||was>=th) return;
  toy.hot=true; toy.pow=comboNow-th;
  banners.splice(banners.length&&banners[0].t>0?1:0,0,{t:0,txt:'CANNONBALL READY!',sub:'flick Crumb at the blocks',col:'#FFB347',k:.8});   // next in the queue: the news belongs to the clear that earned it
  haptic('bonusReady');
  toyPlay(.25,t=>{ tone(t,{f0:330,f1:660,pdur:.18,dur:.22,vol:.06,type:'triangle'}); tone(t+.16,{f0:660,f1:990,pdur:.14,dur:.2,vol:.05,type:'triangle'}); });
}
function toySmash(){                                                // in flight, charged: every gem its body covers breaks (a bigger crumb cuts a wider path)
  const f=toy.fire, s=masc.s, cx=masc.x+toy.x+s/2, cy=masc.y+toy.y+s-s*toy.sc/2;   // it grows from its feet, so its middle rides higher
  const reach=Math.max(cell*.5,s*toy.sc*.5*CFG.CANNON_REACH);
  const c0=Math.max(0,Math.floor((cx-reach-bx)/cell)), c1=Math.min(N-1,Math.floor((cx+reach-bx)/cell));
  const r0=Math.max(0,Math.floor((cy-reach-by)/cell)), r1=Math.min(N-1,Math.floor((cy+reach-by)/cell));
  let hit=0;
  for(let r=r0;r<=r1&&toy.fire&&f.n<f.max;r++) for(let c=c0;c<=c1&&f.n<f.max;c++){
    const g=grid[r][c]; if(!g) continue;
    const gx=bx+(c+.5)*cell, gy=by+(r+.5)*cell;
    if(Math.hypot(gx-cx,gy-cy)>reach+cell*.2) continue;
    grid[r][c]=null; hit++;
    shatters.push({r,c,gi:g.gi,horiz:Math.abs(toy.vx)>Math.abs(toy.vy),star:false,big:true,tier:3,t:0,t0:0,ox:cx,oy:cy});
    const pts=CFG.CANNON_PER_GEM; score+=pts; f.n++; f.pts+=pts;
    tags.push({x:gx,y:gy,txt:String(pts),t:0});
  }
  if(!hit) return;
  toy.vx*=CFG.CANNON_KEEP; toy.vy*=CFG.CANNON_KEEP; shake=Math.max(shake,3*CFG.SHAKE);   // one bite slows it once, however many gems were in it
  toy.sndAt=0; toySnd('boing',.9); toyPlay(0,t=>tone(t,{f0:1500,f1:500,pdur:.05,dur:.07,vol:.05,type:'square'}));
  if(f.n>=f.max) toyFireEnd();
}
function toyFireEnd(){                                              // out of steam, or landed: the board is the player's again
  const f=toy.fire; if(!f) return; toy.fire=null; toy.shotN=f.n;
  if(stuck&&state==='play'&&!f.n){ toy.hot=true; return; }           // the last chance missed the board entirely: it is still charged, try again
  if(!f.n) return;
  dareCannon(f.n);                                                  // (dares) "cannonball 8 blocks"
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
  banners.splice(banners.length&&banners[0].t>0?1:0,0,{t:0,txt:'LAST CHANCE!',sub:'flick Crumb at the blocks',col:'#FFB347',k:1});
  haptic('bonusReady');
}
const toyPower=()=>Math.min(CFG.CANNON_MAX_TOP,CFG.CANNON_MAX+CFG.CANNON_GROW*toy.pow);   // gems this cannonball can break
function toySize(){                                                 // how big the crumb should be: it swells as the streak builds, more once charged
  if(toy.fire||toy.hot) return Math.min(CFG.CANNON_BIG_TOP,CFG.CANNON_BIG+CFG.CANNON_BIG_STEP*toy.pow);
  if(!CFG.CRUMB_CANNON||mode!=='endless'||guide||state!=='play') return 1;
  const th=CFG.CANNON_COMBO;
  return 1+(CFG.CANNON_BIG-1)*.55*Math.max(0,Math.min(1,(combo-1)/(th-1)));
}
function toyBusy(){ return toy.mode!=='rim'||Math.abs(toy.vx)>2||(toy.a%360!==0)||Math.abs(toy.sc-toySize())>.004; }   // draw.js fxBusy: full frame rate while it moves
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
  toy.id=e.pointerId; try{ masc.el.setPointerCapture(e.pointerId); }catch(err){}
  toy.ox=e.clientX-(masc.x+toy.x); toy.oy=e.clientY-(masc.y+toy.y);
  toy.pts=[{t:now,x:e.clientX,y:e.clientY}]; toy.mode='held'; toy.vx=toy.vy=0; toy.dizzyTo=0;
  toySnd('squeak');
}
function toyMove(e){
  if(e.pointerId!==toy.id||toy.mode!=='held') return;
  e.stopPropagation();
  const now=performance.now(), p=toy.pts;
  p.push({t:now,x:e.clientX,y:e.clientY}); while(p.length>2&&now-p[0].t>90) p.shift();
  toy.x=e.clientX-toy.ox-masc.x; toy.y=e.clientY-toy.oy-masc.y;
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
  if(e.type==='pointerup'&&p.length>1&&now-b.t<80){ vx=(b.x-a.x)/dt; vy=(b.y-a.y)/dt; }
  const sp=Math.hypot(vx,vy), cap=CFG.TOY_MAX_SPEED;
  if(sp>cap){ vx*=cap/sp; vy*=cap/sp; }
  toy.speed=Math.min(sp,cap); toy.bounces=0; toy.restT=0; toy.shotN=0;
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
  if(!toyOn()){ toy.sc=1; if(toy.mode!=='rim'||toy.a||toy.y||toy.css.slice(-2)!==',1') toyReset(); return; }
  { const tg=toySize(); toy.sc=reduce||Math.abs(tg-toy.sc)<.004?tg:toy.sc+(tg-toy.sc)*Math.min(1,dt*7); }   // reduced motion: it is its size at once, no swelling
  if(paused||!dt) return;
  const s=masc.s, xmax=toyXMax(), G=CFG.TOY_GRAVITY;
  toy.gx+=(( CFG.TILT&&toy.tiltOn&&!reduce?toy.gRaw:0)-toy.gx)*Math.min(1,dt*10);   // reduced motion: no tilt roll
  const gx=Math.abs(toy.gx)>CFG.TILT_DEAD?toy.gx-Math.sign(toy.gx)*CFG.TILT_DEAD:0;
  if(masc.fainted&&toy.mode!=='rim'){ toyReset(); return; }
  if(toy.mode==='held'){
    const p=toy.pts, a=p[0], b=p[p.length-1], vx=p.length>1?(b.x-a.x)/Math.max(.016,(b.t-a.t)/1000):0;
    if(!reduce) toy.a+=((Math.max(-28,Math.min(28,-vx*.03)))-toy.a)*Math.min(1,dt*12);        // it swings behind the finger
  }else if(toy.mode==='air'){
    toy.vy+=G*dt; toy.vx+=G*gx*.6*dt;
    const py=toy.y;
    if(toy.fire){                                                   // charged: step in pieces smaller than a cell so no gem is jumped
      const n=Math.max(1,Math.ceil(Math.hypot(toy.vx,toy.vy)*dt/(cell*.45)));
      for(let k=0;k<n&&toy.fire;k++){ toy.x+=toy.vx*dt/n; toy.y+=toy.vy*dt/n; toySmash(); }
      if(!toy.fire){ /* spent mid-step: the rest of the flight is an ordinary one */ }
      if(toy.fire){                                                 // still hot: it ricochets inside the board (CANNON_BOUNCES times off the bottom) instead of dropping straight through
        const f=toy.fire, bl=bx-masc.x, br=bx+B-s-masc.x, bb=by+B-s-masc.y;
        if(toy.y>0&&toy.y<bb+s){
          if(toy.x<bl&&toy.vx<0){ toy.x=bl; toy.vx=-toy.vx; toySnd('boing',.6); }
          if(toy.x>br&&toy.vx>0){ toy.x=br; toy.vx=-toy.vx; toySnd('boing',.6); }
          if(toy.y>bb&&toy.vy>0&&f.b<CFG.CANNON_BOUNCES){ f.b++; toy.y=bb; toy.vy=-Math.max(toy.vy*.85,cell*22); toy.va=toy.vx*1.2; toySnd('boing',.8); }
        }
      }
    } else { toy.x+=toy.vx*dt; toy.y+=toy.vy*dt; }
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
  m.addEventListener('pointerdown',toyDown);
  m.addEventListener('pointermove',toyMove);
  m.addEventListener('pointerup',toyUp);
  m.addEventListener('pointercancel',toyUp);
}

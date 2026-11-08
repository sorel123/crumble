// Crumble — Per-frame drawing and effects.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ draw ═══════ */
function gem(gi,x,y,sz,sx,alpha,flash,small,syArg,src){
  const scx=sx||1, scy=syArg===undefined?scx:syArg;
  const w=sz*scx, h=sz*scy;
  const a=alpha===undefined?1:alpha;
  if(a<=0||w<=0||h<=0) return;
  ctx.globalAlpha=a;
  const arr=(src||{big:gemBig,small:gemSmall})[small?'small':'big'];
  ctx.drawImage(arr[gi],x+(sz-w)/2,y+(sz-h)/2,w,h);
  if(flash>0.01){
    ctx.globalAlpha=a*flash; ctx.fillStyle='#fff';
    roundPath(ctx,x+(sz-w)/2+w*.06,y+(sz-h)/2+h*.06,w*.88,h*.88,w*.25); ctx.fill();
  }
  ctx.globalAlpha=1;
}
function star(x,y,r,a){
  ctx.globalAlpha=a; ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.moveTo(x,y-r);
  ctx.quadraticCurveTo(x,y,x+r,y); ctx.quadraticCurveTo(x,y,x,y+r);
  ctx.quadraticCurveTo(x,y,x-r,y); ctx.quadraticCurveTo(x,y,x,y-r);
  ctx.fill(); ctx.globalAlpha=1;
}

// golden pieces: a soft pulsing halo behind, and a light band sweeping across the cells
function goldGlow(cx,cy,r,now,ph,rgb='255,206,72'){
  const pulse=reduce?0.6:0.5+0.5*Math.sin(now*0.005+ph);
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,`rgba(${rgb},${0.3+0.32*pulse})`); g.addColorStop(1,`rgba(${rgb},0)`);
  ctx.fillStyle=g; ctx.fillRect(cx-r,cy-r,r*2,r*2);
}
// a lifted piece's drop shadow, rendered with shadowBlur once into its own canvas
function pieceShadow(s){
  const pad=24, w=s.cols*cell+pad*2, h=s.rows*cell+pad*2, cv=document.createElement('canvas');
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  const x=cv.getContext('2d'); x.scale(dpr,dpr);
  x.shadowColor='rgba(0,0,0,.55)'; x.shadowBlur=18; x.shadowOffsetX=0; x.fillStyle='rgba(0,0,0,.55)';
  x.translate(-1000,0); x.shadowOffsetX=1000*dpr;                 // draw the shape off-canvas so only its shadow lands
  for(const [dr,dc] of s.cells){ roundPath(x,pad+dc*cell+cell*.08,pad+dr*cell+cell*.08,cell*.84,cell*.84,cell*.22); x.fill(); }
  return {cv,pad,w,h};
}
function goldShimmer(now,s,dr,dc){
  if(reduce) return 0;
  const pos=((now*0.0009)%1)*(s.rows+s.cols+3)-1.5;
  return Math.max(0,1-Math.abs(dr+dc-pos)/1.2)*0.6;
}

// screen-edge vignette: bands from each edge only, clamped to stay outside the
// board panel so it can never draw over live gems, however narrow the layout.
function edgeGlow(rgb,strength){
  if(strength<=0.01) return;
  const base=40+strength*70;
  const dT=Math.max(0,Math.min(base,by-12));
  const dB=Math.max(0,Math.min(base,H-(by+B)-12));
  const dL=Math.max(0,Math.min(base,bx-12));
  const dR=dL;
  const mk=(x0,y0,x1,y1)=>{
    const g=ctx.createLinearGradient(x0,y0,x1,y1);
    g.addColorStop(0,`rgba(${rgb},${0.5*strength})`); g.addColorStop(1,`rgba(${rgb},0)`);
    return g;
  };
  if(dT>2){ ctx.fillStyle=mk(0,0,0,dT); ctx.fillRect(0,0,W,dT); }
  if(dB>2){ ctx.fillStyle=mk(0,H,0,H-dB); ctx.fillRect(0,H-dB,W,dB); }
  if(dL>2){ ctx.fillStyle=mk(0,0,dL,0); ctx.fillRect(0,0,dL,H); }
  if(dR>2){ ctx.fillStyle=mk(W,0,W-dR,0); ctx.fillRect(W-dR,0,dR,H); }
}
// the sky gradient and the board glow are rebuilt only when their colours change — not per frame
let _sky=null;
function skyFill(top,bot){
  if(_sky&&_sky.top===top&&_sky.bot===bot&&_sky.H===H) return _sky.g;
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,top); g.addColorStop(1,bot);
  _sky={top,bot,H,g}; return g;
}
const GLOWS=new Map();
function glowSprite(hue){
  hue=Math.round(hue/10)*10;
  let sp=GLOWS.get(hue); if(sp&&sp.r===B*0.95) return sp;
  const r=B*0.95, cv=document.createElement('canvas'); cv.width=cv.height=Math.max(1,Math.round(r*2*dpr*0.5));   // half-res is plenty for a soft glow
  const x=cv.getContext('2d'); x.scale(dpr*0.5,dpr*0.5);
  const g=x.createRadialGradient(r,r,0,r,r,r); g.addColorStop(0,`hsla(${hue} 90% 60% / 1)`); g.addColorStop(1,`hsla(${hue} 90% 60% / 0)`);
  x.fillStyle=g; x.fillRect(0,0,r*2,r*2);
  sp={cv,r}; if(GLOWS.size>40) GLOWS.clear(); GLOWS.set(hue,sp); return sp;
}

/* text sprites. Every overlay word (popups, tags, COMBO, COLOR GONE, praise, banners) is
   rasterised ONCE — strokes, gradients and all — into its own little canvas, then blitted
   each frame with a transform. strokeText every frame is the single thing that makes iOS
   Safari crawl, so nothing below this line calls it on the live canvas. */
const SPRITES=new Map();
const FONT=px=>'700 '+px+'px "Fredoka",Verdana,sans-serif';
const mctx=document.createElement('canvas').getContext('2d');
function textW(txt,px){ mctx.font=FONT(px); return mctx.measureText(txt).width; }
function sprite(key,w,h,draw){                       // draw(x) renders centred on (0,0) with middle baseline
  let sp=SPRITES.get(key); if(sp) return sp;
  w=Math.ceil(w); h=Math.ceil(h);
  const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr));
  const x=cv.getContext('2d'); x.scale(dpr,dpr); x.translate(w/2,h/2);
  x.textAlign='center'; x.textBaseline='middle'; x.lineJoin='round';
  draw(x);
  sp={cv,w,h}; if(SPRITES.size>=160) SPRITES.delete(SPRITES.keys().next().value);   // evict the oldest one, not the lot (a full clear re-rasterised every word on screen in one frame)
  SPRITES.set(key,sp); return sp;
}
function blit(sp,x,y,sc=1,alpha=1,rot=0){
  ctx.save(); ctx.translate(x,y); if(rot) ctx.rotate(rot); if(sc!==1) ctx.scale(sc,sc);
  ctx.globalAlpha=alpha; ctx.drawImage(sp.cv,-sp.w/2,-sp.h/2,sp.w,sp.h); ctx.restore(); ctx.globalAlpha=1;
}
function outlined(x,txt,px,fill,strokes,dx=0,dy=0){   // strokes: [[width, colour, alpha?], ...] outermost first, then the fill
  x.font=FONT(px);
  for(const [w,col,a] of strokes){ x.globalAlpha=a===undefined?1:a; x.lineWidth=w; x.strokeStyle=col; x.strokeText(txt,dx,dy); }
  x.globalAlpha=1; x.fillStyle=fill; x.fillText(txt,dx,dy);
}
function vgrad(x,y0,y1,stops){ const g=x.createLinearGradient(0,y0,0,y1); stops.forEach(([o,c])=>g.addColorStop(o,c)); return g; }

// a firework: a fountain of little stars in yellow / green / pink / blue from one point (drawn by the bursts loop)
const FIRE_COLS=['#FFE45C','#7CF59A','#FF8AD8','#8FD8FF'];
function spawnFirework(x,y,col,delay=0){
  const n=Math.min(16,fxRoom()); if(n<=0) return;                  // enough on screen already
  const c=col||FIRE_COLS[(Math.random()*FIRE_COLS.length)|0];
  for(let k=0;k<n;k++){
    const ang=Math.random()*6.283, sp=1.5+Math.random()*4.5;
    bursts.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp*0.8-1,life:1,wait:delay,r:cell*(0.06+Math.random()*0.08),col:Math.random()<.8?c:'#fff',sq:true});
  }
}
// clean-sweep confetti: falls in front, only ever over an already-emptied board
function spawnConfetti(){
  if(reduce) return;
  const cols=['#FFD45C','#FF7BD5','#8FD8FF','#9CF0B5','#FFFFFF'];
  for(let k=Math.min(28,fxRoom());k>0;k--) confetti.push({
    x:Math.random()*W, y:-20-Math.random()*80, vx:(Math.random()-.5)*1.6, vy:1.4+Math.random()*1.8,
    rot:Math.random()*6.283, vr:(Math.random()-.5)*.3, w:4+Math.random()*4, h:7+Math.random()*6,
    col:cols[(Math.random()*cols.length)|0], life:1
  });
}
function stepConfetti(dt){
  for(let i=confetti.length-1;i>=0;i--){
    const c=confetti[i];
    c.x+=c.vx*dt; c.y+=c.vy*dt; c.vy+=0.03*dt; c.rot+=c.vr*dt; c.life-=dt*0.012;
    if(c.life<=0||c.y>H+30){ confetti.splice(i,1); continue; }
    ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.rot);
    ctx.globalAlpha=Math.min(1,c.life*2); ctx.fillStyle=c.col;
    ctx.fillRect(-c.w/2,-c.h/2,c.w,c.h);
    ctx.restore();
  }
  ctx.globalAlpha=1;
}

/* frame budget (plan 2.2). Every frame measures the gap since the one before. Effect particles share one
   budget, PARTICLE_CAP scaled by perf.fx: a frame over FRAME_BUDGET_MS (or 1.5x the device's own frame
   interval, so a 30 Hz Low Power Mode phone isn't punished for every frame) cuts it, frames on time grow it back
   over about a second, so a slow moment sheds sparkle instead of frames. With ?dev a corner readout shows the
   slowest frame of the last two seconds, how many frames have run long (tap it to reset), the time the game's
   own code took in the last frame, and the particle budget. */
const perf={gaps:new Float32Array(120),gi:0,over:0,work:0,fx:1,hud:null};
const fxLive=()=>bursts.length+shards.length+sparkles.length+dust.length+chunks.length+confetti.length;
function fxRoom(){ return Math.round(CFG.PARTICLE_CAP*perf.fx)-fxLive(); }
function perfFrame(gap){
  if(!(gap>0&&gap<250)) return;                     // the first frame, or back from the background: not a frame she saw
  perf.gaps[perf.gi]=gap; perf.gi=(perf.gi+1)%perf.gaps.length;
  if(gap>CFG.FRAME_BUDGET_MS) perf.over++;
  let base=Infinity; for(const g of perf.gaps) if(g>0&&g<base) base=g;   // the device's own frame interval (33 ms in Low Power Mode)
  if(gap>Math.max(CFG.FRAME_BUDGET_MS,base*1.5)) perf.fx=Math.max(0.3,perf.fx-0.15);   // a frame late for this device
  else perf.fx=Math.min(1,perf.fx+0.01);
}
function perfHud(now){
  if(!CFG.DEV_MODE) return;
  if(!perf.hud){
    perf.hud=document.createElement('div'); perf.hud.id='perfHud';
    perf.hud.style.cssText='position:fixed;left:4px;bottom:calc(env(safe-area-inset-bottom) + 2px);z-index:50;font:600 10px/1.3 ui-monospace,Menlo,monospace;'
      +'color:#fff;background:rgba(0,0,0,.45);padding:2px 5px;border-radius:4px;white-space:pre;-webkit-user-select:none;user-select:none';
    perf.hud.addEventListener('pointerdown',e=>{ e.stopPropagation(); perf.over=0; perf.gaps.fill(0); });
    document.body.append(perf.hud); perf.hudAt=0;
  }
  if(now-perf.hudAt<250) return;                     // a few updates a second: text changes cost layout too
  perf.hudAt=now;
  let mx=0; for(const g of perf.gaps) if(g>mx) mx=g;
  perf.hud.textContent='max '+mx.toFixed(1)+'ms  >'+CFG.FRAME_BUDGET_MS+'ms: '+perf.over+'\nwork '+perf.work.toFixed(1)+'ms  fx '+Math.round(perf.fx*100)+'% ('+fxLive()+')';
  perf.hud.style.color=mx>CFG.FRAME_BUDGET_MS?'#FFB3B3':'#fff';
}

let last=0;
function frame(now){
  requestAnimationFrame(frame);
  const t0=performance.now();
  perfFrame(now-last);
  const dt=paused?0:Math.min(2.5,(now-last)/16.67)||1; last=now;
  if(hitWait>0) hitWait-=dt; else shake*=Math.pow(.85,dt);
  glowT*=Math.pow(.93,dt);

  const comboTarget=combo>=2?Math.min(1,(combo-1)/6):0;
  comboGlowV+=(comboTarget-comboGlowV)*Math.min(1,dt*0.15);
  const goldTarget=golden?1:0;
  goldTintV+=(goldTarget-goldTintV)*Math.min(1,dt*0.15);
  sweepFxT=Math.max(0,sweepFxT-dt/48);
  if(bestBeaten && shownScore>best){ best=shownScore; const bv=el('bestVal'); bv.textContent=best; if(!bv.classList.contains('bump')){ bv.classList.add('bump'); setTimeout(()=>bv.classList.remove('bump'),140); } }
  if(shownScore!==score && now>=scoreHold){         // quick count-up (held until the first score orb lands): ~30% of the gap a frame, at least 1
    shownScore=shownScore<score?Math.min(score,shownScore+Math.max(1,Math.ceil((score-shownScore)*0.09*dt))):score;
    el('scoreVal').textContent=shownScore;
  }
  if(hitWait<=0) punchT=Math.max(0,punchT-dt/22);

  stepFlip(dt); stepBlast(now,dt);
  const [bgTop,bgBot]=bgT>=1 ? [bgOf(curWorld).top,bgOf(curWorld).bottom]
    : [lerpCol(bgOf(bgFrom).top,bgOf(curWorld).top,easeOutCubic(bgT)),
       lerpCol(bgOf(bgFrom).bottom,bgOf(curWorld).bottom,easeOutCubic(bgT))];
  ctx.fillStyle=skyFill(bgTop,bgBot); ctx.fillRect(0,0,W,H);     // gradient object cached per colour pair (a new one each frame is slow on iOS)

  ambientBurst*=Math.pow(.88,dt);
  const aboost=1+ambientBurst*1.8;
  if(bgT<1) stepAmbient(ambientOld,worldDef(bgFrom).effect,dt,aboost,1-easeOutCubic(bgT),false);
  stepAmbient(ambient,worldDef(curWorld).effect,dt,aboost,bgT<1?easeOutCubic(bgT):1,true);

  if(worldDef(curWorld).flash && !reduce && Math.random()<0.006*dt) lightningT=1;
  lightningT=Math.max(0,lightningT-dt/10);
  if(lightningT>0.01){ ctx.globalAlpha=lightningT*0.5; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }

  { const gl=glowSprite(glowH); ctx.globalAlpha=0.10+glowT*0.34; ctx.drawImage(gl.cv,W/2-gl.r,by+B/2-gl.r,gl.r*2,gl.r*2); ctx.globalAlpha=1; }   // cached radial glow, one blit

  // background-layer washes: drawn behind the gems, so they tint the scene without ever sitting over a piece
  if(CFG.FX_GOLD_TINT && goldTintV>0.02 && !(transform&&transform.id==='goldvault')){  // Gold Vault's own look already reads gold — don't double it

    const pulse=reduce?0.7:0.6+0.4*Math.sin(now*0.004);
    ctx.globalAlpha=goldTintV*0.09*pulse; ctx.fillStyle='#FFCE48'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }
  if(CFG.FX_SWEEP_FX && sweepFxT>0){
    ctx.globalAlpha=sweepFxT*0.4; ctx.fillStyle=`hsl(${glowH} 85% 70%)`; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }
  if(flip && flip.t<14){                          // a brief flash right as a flip begins
    ctx.globalAlpha=(1-flip.t/14)*0.5; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }

  ctx.save();
  if(shake>.2 && hitWait<=0) ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
  if(CFG.FX_PUNCH_ZOOM && punchT>0.01 && hitWait<=0){
    const pz=1+0.025*punchT;
    ctx.translate(bx+B/2,by+B/2); ctx.scale(pz,pz); ctx.translate(-(bx+B/2),-(by+B/2));
  }

  ctx.drawImage(boardBg.cv,bx-boardBg.pad,by-boardBg.pad,boardBg.w,boardBg.w);
  drawBlastBar(now);
  if(blast && !reduce){                                  // the round's own border: hot and pulsing
    const p=0.5+0.5*Math.sin(now*(blast.t<5000?0.02:0.005));
    roundPath(ctx,bx-9,by-9,B+18,B+18,20);
    ctx.strokeStyle=`rgba(255,123,213,${0.25+0.35*p})`; ctx.lineWidth=10+8*p; ctx.stroke();
    ctx.strokeStyle=`rgba(255,255,255,${0.5+0.4*p})`; ctx.lineWidth=2.5; ctx.stroke();
  } else if(borderFlash && (borderFlash.t+=dt)>=0){      // combo flash: the board edge lights in the streak colour, then fades
    const f=1-borderFlash.t/26;
    if(f<=0) borderFlash=null;
    else { roundPath(ctx,bx-9,by-9,B+18,B+18,20); ctx.strokeStyle=`rgba(${borderFlash.col},${0.9*f})`; ctx.lineWidth=5+6*f; ctx.stroke(); }
  } else if(CFG.FX_TENSION_BORDER){                            // board border glow: calm (cool) -> warm as tension climbs
    const hue=200-185*tension, a=0.45+0.4*tension;       // layered strokes fake the glow — shadowBlur every frame is slow on iOS
    roundPath(ctx,bx-9,by-9,B+18,B+18,20);
    ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.12})`; ctx.lineWidth=12+14*tension; ctx.stroke();
    ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.28})`; ctx.lineWidth=5+6*tension;  ctx.stroke();
    ctx.strokeStyle=`hsla(${hue} 85% 66% / ${a})`;      ctx.lineWidth=2+2*tension;  ctx.stroke();
  }

  if(drag&&tray[drag.i]){ drag.g=Math.min(1,drag.g+dt*0.2); updateSlot(); }   // the pickup lift moves the piece without a pointer event
  const gh=drag&&tray[drag.i]&&drag.slot?{r:drag.slot.r,c:drag.slot.c,s:tray[drag.i].s}:null;   // the one landing answer (see updateSlot)
  if(gh){
    let L;
    if(gh.s.star) L={rows:[gh.r],cols:[gh.c]};                 // preview the whole cross
    else{
      const test=grid.map(row=>row.slice());
      for(const [dr,dc] of gh.s.cells) test[gh.r+dr][gh.c+dc]=1;
      L=linesFor(test);
    }
    const pulse=Math.sin(now*0.008)*0.5+0.5, hue=GEMS[tray[drag.i].gi].h;
    if(CFG.FX_LINE_PREVIEW){                      // the lines about to clear fill with the held piece's colour (gems recoloured after they're drawn)
      ctx.globalAlpha=0.5+0.2*pulse; ctx.fillStyle=`hsl(${hue} 85% ${theme().light&&!theme().whiteInk?52:62}%)`;
    } else { ctx.globalAlpha=0.14+0.18*pulse; ctx.fillStyle=theme().light?'#FFB020':'#fff'; }
    L.rows.forEach(r=>ctx.fillRect(bx,by+r*cell,B,cell));
    L.cols.forEach(c=>ctx.fillRect(bx+c*cell,by,cell,B));
    ctx.globalAlpha=1;
    if(!CFG.FX_MAGNET)                                          // gliding (default): a ghost marks exactly where it lands; with the magnet on, the piece itself sits there
      for(const [dr,dc] of gh.s.cells) gem(tray[drag.i].gi,bx+(gh.c+dc)*cell,by+(gh.r+dr)*cell,cell,1,CFG.GHOST_ALPHA,0);
    gh.lines=L; gh.hue=hue; gh.pulse=pulse;
  }

  const claySquash=curSkin==='clay';
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const g=grid[r][c]; if(!g) continue;
    if(g.t<1) g.t=Math.min(1,g.t+dt*0.085);
    if(g.t<=0) continue;
    if(g.f>0) g.f=Math.max(0,g.f-dt*0.14);            // the landing glint, gone in ~7 frames
    const base=0.5+0.5*easeOutBack(g.t);
    const fp=flip?clamp((flip.t-(r+c)/(2*(N-1))*FLIP_WAVE)/FLIP_CELL,0,1):1;
    if(flip && fp<1){                              // mid-flip: squash to a line, swap texture, unsquash
      const half=fp<0.5, sq=half?1-fp*2:(fp-0.5)*2;
      gem(g.gi,bx+c*cell,by+r*cell,cell,base*sq,1,0,false,base,half?{big:flip.fromBig,small:flip.fromSmall}:undefined);
    } else if(claySquash&&g.t<1){
      const q=Math.sin(g.t*Math.PI)*0.17;
      gem(g.gi,bx+c*cell,by+r*cell,cell,base*(1+q),1,0,false,base*(1-q));
    } else if(g.l>0){                               // landing thump: wide-and-short on impact, springs back over ~8 frames
      g.l=Math.max(0,g.l-dt*0.13);
      const q=Math.sin(g.l*Math.PI)*0.16;
      gem(g.gi,bx+c*cell,by+r*cell,cell,base*(1+q),1,g.f?g.f*g.f*0.45:0,false,base*(1-q*0.7));
    } else gem(g.gi,bx+c*cell,by+r*cell,cell,base,1,g.f?g.f*g.f*0.45:0);
  }

  if(gh && gh.lines && CFG.FX_LINE_PREVIEW && (gh.lines.rows.length||gh.lines.cols.length)){
    // every gem already in a would-clear line is recoloured to the held piece — the whole line reads as one colour, about to go
    const p=cell*.05, inL=(r,c)=>gh.lines.rows.includes(r)||gh.lines.cols.includes(c);
    ctx.globalAlpha=0.72; ctx.fillStyle=`hsl(${gh.hue} 85% 60%)`;
    for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]&&inL(r,c)){ roundPath(ctx,bx+c*cell+p,by+r*cell+p,cell-p*2,cell-p*2,cell*.16); ctx.fill(); }
    ctx.globalAlpha=0.22; ctx.fillStyle='#fff';
    for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]&&inL(r,c)){ roundPath(ctx,bx+c*cell+p*2,by+r*cell+p*2,cell-p*4,(cell-p*4)*0.3,cell*.1); ctx.fill(); }
    ctx.globalAlpha=0.55+0.35*gh.pulse; ctx.strokeStyle=`hsl(${gh.hue} 95% 78%)`; ctx.lineWidth=3;   // and a glowing outline around each line
    gh.lines.rows.forEach(r=>{ roundPath(ctx,bx+1,by+r*cell+1,B-2,cell-2,cell*.18); ctx.stroke(); });
    gh.lines.cols.forEach(c=>{ roundPath(ctx,bx+c*cell+1,by+1,cell-2,B-2,cell*.18); ctx.stroke(); });
    ctx.globalAlpha=1;
  }
  for(let i=rings.length-1;i>=0;i--){                 // landing ring: an outline that spreads out and fades
    const g=rings[i]; g.t+=dt*0.1;
    if(g.t>=1){ rings.splice(i,1); continue; }
    const e=easeOutCubic(g.t), grow=cell*0.55*e;
    ctx.globalAlpha=(1-g.t)*0.5; ctx.strokeStyle='#fff'; ctx.lineWidth=Math.max(1,cell*0.1*(1-g.t));
    roundPath(ctx,g.x-grow,g.y-grow,g.w+grow*2,g.h+grow*2,cell*0.3); ctx.stroke();
  }
  for(let i=dust.length-1;i>=0;i--){                  // landing dust
    const d=dust[i]; d.x+=d.vx*dt; d.y+=d.vy*dt; d.vy+=0.12*dt; d.vx*=Math.pow(.9,dt); d.life-=dt*0.07;
    if(d.life<=0){ dust.splice(i,1); continue; }
    ctx.globalAlpha=d.life*0.7; ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(d.x,d.y,d.r*d.life,0,6.283); ctx.fill();
  }
  ctx.globalAlpha=1;

  if(!reduce && now-lastSpark>CFG.SPARKLE_RATE && state==='play' && !paused && curSkin==='jewel'){
    lastSpark=now;
    const f=[];
    for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]&&grid[r][c].t>=1) f.push([r,c]);
    if(f.length){
      const [r,c]=f[(Math.random()*f.length)|0];
      sparkles.push({x:bx+(c+.2+Math.random()*.6)*cell,y:by+(r+.2+Math.random()*.6)*cell,t:0});
    }
  }
  for(let i=sparkles.length-1;i>=0;i--){
    const s=sparkles[i]; s.t+=dt*0.045;
    if(s.t>=1){ sparkles.splice(i,1); continue; }
    const k=Math.sin(s.t*Math.PI); star(s.x,s.y,cell*0.26*k,k*0.9);
  }

  for(let i=sweeps.length-1;i>=0;i--){
    const s=sweeps[i]; s.t+=dt*0.16;
    if(s.t<0) continue;
    if(s.t>=1){ sweeps.splice(i,1); continue; }
    const p=easeOutCubic(s.t), a=(1-s.t)*0.85;
    if(s.horiz){
      const x=bx+p*B, g=ctx.createLinearGradient(x-cell*1.6,0,x+cell*0.4,0);
      g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,`rgba(255,255,255,${a})`);
      ctx.fillStyle=g; ctx.fillRect(bx,by+s.idx*cell,p*B,cell);
    } else {
      const y=by+p*B, g=ctx.createLinearGradient(0,y-cell*1.6,0,y+cell*0.4);
      g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,`rgba(255,255,255,${a})`);
      ctx.fillStyle=g; ctx.fillRect(bx+s.idx*cell,by,cell,p*B);
    }
  }

  for(let i=blasts.length-1;i>=0;i--){                 // star blast: prismatic beams out along the row and column
    const b=blasts[i]; b.t+=dt*0.045;
    if(b.t>=1){ blasts.splice(i,1); continue; }
    const p=easeOutCubic(b.t), a=(1-b.t)*0.95, reach=p*B*1.25;
    const cx=bx+(b.c+.5)*cell, cy=by+(b.r+.5)*cell, hue=(b.t*300+200)%360;
    const th=cell*(1.1-0.6*b.t);
    const beam=(x0,y0,x1,y1,horiz)=>{
      const g=horiz?ctx.createLinearGradient(x0,0,x1,0):ctx.createLinearGradient(0,y0,0,y1);
      g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(.5,`rgba(255,255,255,${a})`); g.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=`hsla(${hue} 100% 70% / ${a*0.5})`;                // colored halo under a white core
      if(horiz) ctx.fillRect(x0,y0-th*0.9,x1-x0,th*1.8); else ctx.fillRect(x0-th*0.9,y0,th*1.8,y1-y0);
      ctx.fillStyle=g;
      if(horiz) ctx.fillRect(x0,y0-th/2,x1-x0,th); else ctx.fillRect(x0-th/2,y0,th,y1-y0);
    };
    beam(Math.max(bx,cx-reach),cy,Math.min(bx+B,cx+reach),cy,true);
    beam(cx,Math.max(by,cy-reach),cx,Math.min(by+B,cy+reach),false);
    const fr=cell*(0.6+1.6*p), fg=ctx.createRadialGradient(cx,cy,0,cx,cy,fr);
    fg.addColorStop(0,`rgba(255,255,255,${a})`); fg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=fg; ctx.fillRect(cx-fr,cy-fr,fr*2,fr*2);
    ctx.globalAlpha=1;
  }

  /* line clear, in frames. Optional blink, then either:
     squash — each gem collapses to a white-hot sliver along its line and is gone in ~6 frames (Block Blast's beat), or
     burst  — each gem pops and becomes a whole block flung away from where the piece landed */
  const squash=CFG.CLEAR_STYLE==='squash', POP=squash?6:7;
  for(let i=shatters.length-1;i>=0;i--){
    const s=shatters[i]; s.t+=dt;
    if(s.t<0){                                       // blink phase, timed from the clear itself so the line flashes in unison
      const since=s.t-s.t0, on=since<3||since>=5;
      gem(s.gi,bx+s.c*cell,by+s.r*cell,cell,1,1,CFG.CLEAR_BLINK>0&&on?0.95:0.15); continue;
    }
    if(s.t>=POP){
      const g=GEMS[s.gi], cx=bx+(s.c+.5)*cell, cy=by+(s.r+.5)*cell;
      const room=fxRoom()>0;                               // the bits below are skipped once the particle budget is spent
      if(room && squash && !reduce){                       // two little squares drift off the bar
        for(let k=0;k<2;k++) shards.push({x:cx+(Math.random()-.5)*cell*.6,y:cy+(Math.random()-.5)*cell*.3,vx:(Math.random()-.5)*2,vy:-1-Math.random()*2,r:cell*(.05+Math.random()*.05),life:1,sq:true});
      } else if(room && !squash && CFG.FX_CHUNKS && !reduce){
        const ang=Math.atan2(cy-s.oy,cx-s.ox)+(Math.random()-.5)*.5;   // away from the placed piece
        const sp=4.5+Math.random()*4;
        chunks.push({x:cx,y:cy,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp-3,rot:(Math.random()-.5)*.4,
          vr:(Math.random()-.5)*.5,sz:cell*.86,life:1,gi:s.gi,
          col:`hsl(${g.h} ${g.s}% 60%)`,hi:`hsl(${g.h} ${g.s}% 84%)`});
      }
      for(let k=0;room&&k<(reduce?1:3);k++){               // a few bright specks per gem
        const a=Math.random()*6.283,sp=2+Math.random()*4;
        shards.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-2,r:cell*(.05+Math.random()*.08),life:1});
      }
      shatters.splice(i,1); continue;
    }
    const p=s.t/POP, e=easeOutCubic(p);
    if(squash){                                          // thins to a bright sliver along the line, stretching slightly into it
      const thin=Math.max(0.04,1-e*0.97), wide=1+0.12*e;
      if(s.horiz) gem(s.gi,bx+s.c*cell,by+s.r*cell,cell,wide,1,0.55+0.45*e,false,thin);
      else        gem(s.gi,bx+s.c*cell,by+s.r*cell,cell,thin,1,0.55+0.45*e,false,wide);
    } else gem(s.gi,bx+s.c*cell,by+s.r*cell,cell,1+0.42*e,1-p*p,0.6+0.4*e);   // the pop: swells and whites out
  }

  for(let i=chunks.length-1;i>=0;i--){                 // flung blocks: tumble, shrink, fade — gone in ~half a second
    const b=chunks[i];
    b.vy+=.42*dt; b.x+=b.vx*dt; b.y+=b.vy*dt; b.rot+=b.vr*dt; b.life-=.045*dt;
    if(b.life<=0){ chunks.splice(i,1); continue; }
    const sz=b.sz*(0.35+0.65*b.life);
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.rot);
    ctx.globalAlpha=Math.min(1,b.life*1.8);
    ctx.fillStyle=b.col; roundPath(ctx,-sz/2,-sz/2,sz,sz,sz*.22); ctx.fill();
    ctx.fillStyle=b.hi; ctx.globalAlpha=Math.min(1,b.life*1.8)*.7;
    roundPath(ctx,-sz/2+sz*.14,-sz/2+sz*.12,sz*.72,sz*.3,sz*.14); ctx.fill();
    ctx.restore();
  }
  for(let i=shards.length-1;i>=0;i--){                 // specks (stars) and the squash's little squares
    const b=shards[i];
    b.vy+=(b.sq?.08:.3)*dt; b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=(b.sq?.035:.05)*dt;
    if(b.life<=0){ shards.splice(i,1); continue; }
    if(b.sq){ const r=b.r*(0.5+0.5*b.life); ctx.globalAlpha=Math.max(0,b.life)*0.9; ctx.fillStyle='#fff'; ctx.fillRect(b.x-r,b.y-r,r*2,r*2); }
    else star(b.x,b.y,b.r*(0.4+0.6*b.life)*2,Math.max(0,b.life));
  }
  ctx.globalAlpha=1;

  if(lineFlashes.length){                          // cleared lines flare, additively, in their gem colour
    ctx.globalCompositeOperation='lighter';
    for(let i=lineFlashes.length-1;i>=0;i--){
      const f=lineFlashes[i]; f.t+=dt*0.075;
      if(f.t<0) continue;
      if(f.t>=1){ lineFlashes.splice(i,1); continue; }
      const a=(1-f.t)*(1-f.t)*0.5*f.k, grow=cell*(0.1+0.55*easeOutCubic(f.t));
      ctx.fillStyle=`hsla(${f.hue} 100% 66% / ${a})`;
      if(f.horiz) ctx.fillRect(bx-4,by+f.idx*cell-grow/2,B+8,cell+grow);
      else ctx.fillRect(bx+f.idx*cell-grow/2,by-4,cell+grow,B+8);
    }
    ctx.globalCompositeOperation='source-over';
  }

  for(let i=waves.length-1;i>=0;i--){
    const w=waves[i]; w.t+=dt*0.07;
    if(w.t<0) continue;
    if(w.t>=1){ waves.splice(i,1); continue; }
    ctx.globalAlpha=(1-w.t)*0.5; ctx.strokeStyle='#fff';
    ctx.lineWidth=Math.max(1,cell*0.14*(1-w.t));
    ctx.beginPath(); ctx.arc(w.x,w.y,easeOutCubic(w.t)*B*0.62,0,6.283); ctx.stroke();
    ctx.globalAlpha=1;
  }

  for(let i=0;i<3;i++){
    const t=tray[i]; if(!t) continue;
    if(drag&&drag.i===i) continue;
    if(ret&&ret.i===i) continue;
    const R=slotRect(i),s=t.s;
    const bob=reduce?0:Math.sin(now*0.0022+i*2.1)*cell*0.045;
    const tc=trayFit(s), ox=R.x+(R.w-s.cols*tc)/2, oy=R.y+(R.h-s.rows*tc)/2+bob;
    const gold=t.gi===GOLD;
    if(gold) goldGlow(ox+s.cols*tc/2,oy+s.rows*tc/2,Math.max(s.cols,s.rows)*tc*0.95+tc*0.6,now,i);
    if(s.star) goldGlow(ox+tc/2,oy+tc/2,tc*1.5,now,i,'235,225,255');
    const pulse=s.star&&!reduce?1+0.08*Math.sin(now*0.004+i*2):1;         // star breathes gently
    let tp=1, trSrc;                                                     // tray flips after the board, staggered per slot
    if(flip){
      const delay=FLIP_WAVE+FLIP_CELL+FLIP_GAP+i*FLIP_STAGGER;
      tp=clamp((flip.t-delay)/FLIP_TRAY,0,1);
      if(tp<1){ const half=tp<0.5; if(half) trSrc={big:flip.fromBig,small:flip.fromSmall}; }
    }
    const tsq=tp<1?(tp<0.5?1-tp*2:(tp-0.5)*2):1;
    for(const [dr,dc] of s.cells)
      gem(t.gi,ox+dc*tc,oy+dr*tc,tc,pulse*tsq,1,gold?goldShimmer(now,s,dr,dc):0,true,pulse,trSrc);
  }

  if(ret){
    ret.t=Math.min(1,ret.t+dt*0.18);
    const e=easeOutBack(ret.t), t=tray[ret.i];
    if(t){
      const x=ret.fx+(ret.tx-ret.fx)*e, y=ret.fy+(ret.ty-ret.fy)*e, sz=ret.fs+(ret.ts-ret.fs)*e;
      for(const [dr,dc] of t.s.cells) gem(t.gi,x+dc*sz,y+dr*sz,sz,1,1,0,sz<cell*0.8);
    }
    if(ret.t>=1) ret=null;
  }

  if(drag&&tray[drag.i]){
    const t=tray[drag.i],s=t.s;
    const gold=t.gi===GOLD;
    ctx.save();
    const gk=easeOutBack(drag.g), gs=drag.s0+(1-drag.s0)*gk;     // grows from tray size to board size over ~5 frames (drag.g steps above)
    // the magnet: seated in the slot when there is one, otherwise exactly at the finger. Only the change between
    // the two eases (snapK); the floating piece itself never lags the finger.
    const seat=CFG.FX_MAGNET&&gh, k=reduce?1:1-Math.pow(0.35,dt);
    if(seat){
      const tx=bx+gh.c*cell+s.cols*cell/2, ty=by+gh.r*cell+s.rows*cell/2;
      if(drag.snapK<0.05){ drag.sx=tx; drag.sy=ty; }               // seating fresh: start from this slot
      else { drag.sx+=(tx-drag.sx)*k; drag.sy+=(ty-drag.sy)*k; }  // already seated: slide to the neighbouring slot
    }
    drag.snapK+=((seat?1:0)-drag.snapK)*k;
    if(drag.snapK<0.002) drag.snapK=0; else if(drag.snapK>0.998) drag.snapK=1;
    const p=drawnPos();
    drag.cx=p.x; drag.cy=p.y;                                      // where it is on screen (the tests read this)
    ctx.translate(p.x,p.y);
    ctx.scale(gs,gs);                                            // then rigid under the finger: no tilt
    if(gold) goldGlow(0,0,Math.max(s.cols,s.rows)*cell*0.95+cell*0.6,now,0);
    else if(s.star) goldGlow(0,0,cell*1.5,now,0,'235,225,255');
    const ox=-(s.cols*cell)/2, oy=-(s.rows*cell)/2;
    if(!drag.shadow) drag.shadow=pieceShadow(s);                 // blurred once per drag, not every frame
    if(drag.snapK<0.95){ ctx.globalAlpha=1-drag.snapK; ctx.drawImage(drag.shadow.cv,ox-drag.shadow.pad,oy-drag.shadow.pad+8,drag.shadow.w,drag.shadow.h); ctx.globalAlpha=1; }   // the lift shadow fades as it seats
    for(const [dr,dc] of s.cells) gem(t.gi,ox+dc*cell,oy+dr*cell,cell,1,1,gold?goldShimmer(now,s,dr,dc):0);
    ctx.restore();
  }

  for(let i=pops.length-1;i>=0;i--){
    const p=pops[i]; p.t+=dt*0.026;
    if(p.t<0) continue;
    if(p.t>=1){ pops.splice(i,1); continue; }
    const sc=0.3+0.7*easeOutBack(Math.min(1,p.t*4));            // slams in, then drifts up and fades
    const rise=easeOutCubic(p.t)*cell*1.2, a=1-Math.pow(p.t,3);
    const fs=Math.round(cell*0.9*(1+0.12*Math.min(4,(p.lines||1)-1))*(p.combo>1?1.1:1)), ss=Math.round(cell*0.42);
    const col=p.combo>3?'#FF7BD5':p.combo>1?'#FFD45C':'#FFFFFF';
    const sp=sprite('pop|'+p.txt+'|'+p.sub+'|'+fs+'|'+col, Math.max(textW(p.txt,fs),p.sub?textW(p.sub,ss):0)+fs*0.6, fs*1.3+(p.sub?ss*1.5:0), x=>{
      const dy=p.sub?-ss*0.75:0;
      outlined(x,p.txt,fs,vgrad(x,dy-fs*0.5,dy+fs*0.4,[[0,'#FFFFFF'],[1,col]]),[[fs*0.18,'rgba(24,8,40,.85)']],0,dy);   // white-hot top, colour below
      if(p.sub) outlined(x,p.sub,ss,col,[[ss*0.28,'rgba(24,8,40,.85)']],0,dy+fs*0.55+ss*0.45);
    });
    const half=sp.w/2;                                                  // keep a popup from an edge column on screen
    blit(sp,clamp(p.x,half+6,W-half-6),p.y-rise,sc,a);
  }

  for(let i=tags.length-1;i>=0;i--){               // per-cell point tags: pop in, sit, lift away
    const g=tags[i]; g.t+=dt;
    if(g.t<0) continue;
    if(g.t>=38){ tags.splice(i,1); continue; }
    const pin=Math.min(1,g.t/5), out=g.t>26?(g.t-26)/12:0, fs=Math.round(cell*0.42);
    const sp=sprite('tag|'+g.txt+'|'+fs, textW(g.txt,fs)+fs*0.5, fs*1.4, x=>outlined(x,g.txt,fs,'#FFB347',[[fs*0.22,'rgba(40,16,10,.85)']]));
    blit(sp,g.x,g.y-out*cell*0.5,0.4+0.6*easeOutBack(pin),1-out);
  }
  for(let i=bands.length-1;i>=0;i--){              // COLOR GONE: a dark band across the board with the words in the lost colours
    const b=bands[i]; b.t+=dt;
    if(b.t<0) continue;
    if(b.t>=80){ bands.splice(i,1); continue; }
    const pin=Math.min(1,b.t/6), out=b.t>66?(b.t-66)/14:0, y=by+B*0.46, h=cell*1.15;
    ctx.globalAlpha=(1-out); ctx.fillStyle='rgba(12,8,30,.55)'; ctx.fillRect(bx-9,y-h/2,B+18,h); ctx.globalAlpha=1;
    const fs=Math.round(Math.min(W*0.095,cell*0.95)), ss=Math.round(fs*0.45);
    const tw=textW(b.txt,fs), sw=textW(b.sub,ss), side=ss*0.9+sw+fs*0.3;   // the bonus sits to the right; pad both sides so the words stay centred
    const sp=sprite('band|'+b.txt+'|'+b.sub+'|'+b.hues.join(',')+'|'+fs, tw+side*2, fs*1.5, x=>{
      const tg=x.createLinearGradient(-tw/2,0,tw/2,0), hs=b.hues.length?b.hues:[320];
      hs.forEach((hh,k)=>tg.addColorStop(hs.length>1?k/(hs.length-1):0.5,`hsl(${hh} 95% 72%)`));
      if(hs.length===1){ tg.addColorStop(0,`hsl(${hs[0]} 95% 80%)`); tg.addColorStop(1,`hsl(${(hs[0]+60)%360} 95% 72%)`); }
      outlined(x,b.txt,fs,tg,[[fs*0.18,'rgba(20,8,40,.9)']]);
      outlined(x,b.sub,ss,'#FFB347',[[ss*0.25,'rgba(20,8,40,.9)']],tw/2+ss*0.9+sw/2,-fs*0.25);
    });
    blit(sp,W/2,y,0.5+0.5*easeOutBack(pin),1-out);
  }
  for(let i=slams.length-1;i>=0;i--){              // COMBO n: slams in oversized, holds, zips out
    const p=slams[i]; p.t+=dt;
    if(p.t<0) continue;
    if(p.t>=48){ slams.splice(i,1); continue; }
    const pin=Math.min(1,p.t/6), out=p.t>40?(p.t-40)/8:0;
    const sc=(1.7-0.7*easeOutCubic(pin))*(1-0.5*out);
    const fs=Math.round(Math.min(W*0.15,cell*1.35)*(1+0.05*Math.min(6,p.n-2))), nfs=Math.round(fs*1.35);
    const word='COMBO ', num=String(p.n), ww=textW(word,fs), nw=textW(num,nfs);
    const sp=sprite('slam|'+num+'|'+fs, ww+nw+fs*0.9, nfs*1.5, x=>{
      x.textAlign='left'; const x0=-(ww+nw)/2;
      outlined(x,word,fs,vgrad(x,-fs*0.5,fs*0.5,[[0,'#FFFFFF'],[0.35,'#FFE66B'],[1,'#FFA726']]),[[fs*0.3,'rgba(255,255,255,.35)'],[fs*0.16,'rgba(40,20,60,.95)']],x0,0);
      outlined(x,num,nfs,vgrad(x,-fs*0.7,fs*0.6,[[0,'#FFFFFF'],[0.3,p.n>=5?'#FF9CE0':'#FFE66B'],[1,p.n>=5?'#E040A0':'#FF8F1F']]),[[fs*0.36,'rgba(255,255,255,.35)'],[fs*0.2,'rgba(40,20,60,.95)']],x0+ww,fs*0.05);
    });
    blit(sp,W/2,by+B*0.66,sc,Math.min(1,pin*1.5)*(1-out),-0.06+0.06*pin);
  }
  for(let i=bursts.length-1;i>=0;i--){             // praise stars + fireworks
    const b=bursts[i];
    if(b.wait>0){ b.wait-=dt; continue; }
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.vx*=Math.pow(.94,dt); b.vy=b.vy*Math.pow(.94,dt)+0.04*dt; b.life-=dt*0.022;
    if(b.life<=0){ bursts.splice(i,1); continue; }
    const r=b.r*(0.5+0.5*Math.min(1,b.life));
    ctx.globalAlpha=Math.min(1,b.life*1.6); ctx.fillStyle=b.col;
    if(b.sq){ ctx.fillRect(b.x-r*0.7,b.y-r*0.7,r*1.4,r*1.4); continue; }      // fireworks: plain squares (cheap on iOS)
    ctx.beginPath(); ctx.moveTo(b.x,b.y-r);
    ctx.quadraticCurveTo(b.x,b.y,b.x+r,b.y); ctx.quadraticCurveTo(b.x,b.y,b.x,b.y+r);
    ctx.quadraticCurveTo(b.x,b.y,b.x-r,b.y); ctx.quadraticCurveTo(b.x,b.y,b.x,b.y-r); ctx.fill();
  }
  ctx.globalAlpha=1;
  for(let i=praises.length-1;i>=0;i--){            // the praise word: pops in, holds, lifts away
    const p=praises[i]; p.t+=dt*0.024;
    if(p.t>=1){ praises.splice(i,1); continue; }
    const pin=Math.min(1,p.t/0.2), out=p.t>0.72?(p.t-0.72)/0.28:0;
    const size=Math.round(Math.min(W*0.13,cell*1.1)*(p.tier?1+0.1*(p.tier-1):0.8)), tw=textW(p.word,size);
    const fit=Math.min(1,W*0.88/tw);                                 // long words shrink to fit the screen
    const sc=(reduce?1:0.3+0.7*easeOutBack(pin))*fit;
    const sp=sprite('praise|'+p.word+'|'+size+'|'+p.a+p.b, tw+size*0.7, size*1.6, x=>
      outlined(x,p.word,size,vgrad(x,-size*0.45,size*0.45,[[0,'#FFFFFF'],[0.28,p.a],[1,p.b]]),[[size*0.3,p.b,0.35],[size*0.16,'rgba(28,8,46,.92)']]));   // soft coloured halo, dark edge, bright fill
    blit(sp,W/2,by+B*0.27-out*cell*0.9,sc,1-out,reduce?0:Math.sin(p.t*18)*0.05*(1-pin));
  }

  for(let i=0;i<banners.length;i++){               // head banner runs; the one behind it starts once the head is fading
    const b=banners[i];
    if(i>0 && banners[i-1].t<0.97) break;
    b.t+=dt*0.017;
    if(b.t>=1){ banners.splice(i,1); i--; continue; }
    const sc=0.6+0.4*easeOutBack(Math.min(1,b.t*2.4));
    const a=b.t>0.8?(1-b.t)/0.2:1;
    const bs=Math.round(Math.min(W*0.13,62)), ss=Math.round(Math.min(W*0.07,34)), gap=Math.min(W*0.1,48);
    const tw=textW(b.txt,bs), bfit=Math.min(1,W*0.9/tw);
    const sp=sprite('banner|'+b.txt+'|'+b.sub+'|'+b.col+'|'+bs, Math.max(tw,textW(b.sub,ss))+bs*0.8, bs*1.4+(b.sub?gap+ss:0), x=>{
      const dy=b.sub?-(gap+ss)/2+bs*0.1:0;
      outlined(x,b.txt,bs,b.col,[[bs*0.34,'#FFB020',0.3],[bs*0.16,'rgba(40,14,50,.92)']],0,dy);
      if(b.sub) outlined(x,b.sub,ss,'#fff',[[ss*0.22,'rgba(40,14,50,.92)']],0,dy+gap);
    });
    blit(sp,W/2,by+B/2,sc*bfit,a);
  }

  ctx.restore();

  // foreground overlay — screen edges and an already-empty board only, never a live piece
  if(CFG.FX_COMBO_GLOW && comboGlowV>0.02) edgeGlow(combo>4?'255,123,213':'255,212,92',comboGlowV);
  if(CFG.FX_SWEEP_FX) stepConfetti(dt);
  stepOrbs(now,dt);
  stepDeal();                                        // the next tray, a slice at a time, after this frame's drawing
  perf.work=performance.now()-t0;
  perfHud(now);
}

/* score orbs: one per cleared gem. Each kicks out from the line (away from the placed
   piece), then curves up to the score counter, which bumps as they land. The HUD number
   holds still until the first one arrives, so the points visibly travel. */
const ORB_MS=430;
let orbTarget=null, orbTargetAt=0, bumpUntil=0;
function stepOrbs(now,dt){
  if(!orbs.length) return;
  if(now-orbTargetAt>500){ const r=el('scoreVal').getBoundingClientRect(); orbTarget={x:r.left+r.width/2,y:r.top+r.height/2}; orbTargetAt=now; }
  const T=orbTarget, sec=dt/60;
  ctx.save(); ctx.globalCompositeOperation='lighter';
  for(let i=orbs.length-1;i>=0;i--){
    const o=orbs[i];
    if(o.t<0){ o.t+=sec; continue; }                       // waiting for its gem to pop
    if(!o.sx){ o.sx=o.x; o.sy=o.y; o.cx=o.x+Math.cos(o.dir)*cell*1.6; o.cy=o.y+Math.sin(o.dir)*cell*1.6-cell*1.2; }
    o.t+=sec*1000/ORB_MS;
    if(o.t>=1){                                             // landed: bump the counter, free the count-up
      orbs.splice(i,1);
      bumpUntil=now+140; el('scoreVal').classList.add('bump');
      if(scoreHold>now) scoreHold=now;
      sparkles.push({x:T.x+(Math.random()-.5)*30,y:T.y+(Math.random()-.5)*16,t:0.1});
      continue;
    }
    const u=easeInOutQuad(o.t), v=1-u;                      // quadratic bezier: start -> kick-out control -> counter
    const x=v*v*o.sx+2*v*u*o.cx+u*u*T.x, y=v*v*o.sy+2*v*u*o.cy+u*u*T.y;
    o.trail.push(x,y); if(o.trail.length>10) o.trail.splice(0,2);
    const g=GEMS[o.gi], r=cell*0.2*(1-0.35*o.t);
    for(let k=0;k<o.trail.length;k+=2){                     // trail
      const f=(k/2+1)/(o.trail.length/2+1);
      ctx.globalAlpha=f*0.35; ctx.fillStyle=`hsl(${g.h} ${g.s}% 70%)`;
      ctx.beginPath(); ctx.arc(o.trail[k],o.trail[k+1],r*f*0.8,0,6.283); ctx.fill();
    }
    ctx.globalAlpha=0.35; ctx.fillStyle=`hsl(${g.h} ${g.s}% 75%)`; ctx.beginPath(); ctx.arc(x,y,r*1.9,0,6.283); ctx.fill();   // halo
    ctx.globalAlpha=0.8; ctx.beginPath(); ctx.arc(x,y,r*1.1,0,6.283); ctx.fill();
    ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x,y,r*0.55,0,6.283); ctx.fill();
  }
  ctx.restore();
  if(bumpUntil && now>bumpUntil){ el('scoreVal').classList.remove('bump'); bumpUntil=0; }
}
const easeInOutQuad=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

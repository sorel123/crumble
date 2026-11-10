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
function star(x,y,r,a,col='#fff'){
  ctx.globalAlpha=a; ctx.fillStyle=col;
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
/* golden hand (4.5c): the lines the pieces left in the tray can still complete, painted UNDER the gems (a gold tint on
   the empty cells, a gold outline in the gaps) plus a marker outside the board edge. They light up one after another
   when the hand arrives. Nothing here ever draws over a gem. */
function drawGoldPlan(now,held){
  if(!golden||!CFG.FX_GOLDEN_FANFARE||!golden.plan||goldenState()==='dead') return;
  const pulse=reduce?0.7:0.55+0.45*Math.sin(now*0.005), kHeld=held?0.5:1;
  golden.plan.ids.forEach((id,k)=>{
    const a=reduce?1:clamp((goldenArrive-k*7)/12,0,1); if(a<=0) return;
    const row=id<8, i=row?id:id-8, x=row?bx:bx+i*cell, y=row?by+i*cell:by, w=row?B:cell, h=row?cell:B;
    ctx.globalAlpha=a*kHeld*(0.2+0.14*pulse); ctx.fillStyle='#FFCE48'; ctx.fillRect(x,y,w,h);
    ctx.globalAlpha=a*kHeld*(0.6+0.3*pulse); ctx.strokeStyle='#FFD45C'; ctx.lineWidth=2.5;
    roundPath(ctx,x+1.5,y+1.5,w-3,h-3,cell*.18); ctx.stroke();
    ctx.globalAlpha=a*(0.75+0.25*pulse); ctx.fillStyle='#FFD45C';
    if(row) roundPath(ctx,bx-8,y+cell*.2,4,cell*.6,2); else roundPath(ctx,x+cell*.2,by-8,cell*.6,4,2);
    ctx.fill();
  });
  ctx.globalAlpha=1;
}
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
const _sky=new Map();                                  // a few colour pairs (a journey wipe draws two skies a frame)
function skyFill(top,bot){
  const k=top+bot+H; let g=_sky.get(k); if(g) return g;
  g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,top); g.addColorStop(1,bot);
  if(_sky.size>12) _sky.clear(); _sky.set(k,g); return g;
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

/* Pressure on screen (plan 6.6). One eased state, `scr`, that the room metric and the dealer's phase drive in Endless and Daily
   (Adventure keeps its old border glow). 6.7 puts the bonus / golden / mode looks on this same layer: it reads `scr.p` (0 calm .. 1 tight),
   `scr.warm` (0 cool .. 1 amber: a recovery is amber, an edge is red-orange) and `scr.relief` (a 1 -> 0 flash when she gets out).
   Everything is drawn BEHIND the gems or around them (sky wash, vignette, board rim, a band behind the tray): no block or board
   material is touched, and there is no number on screen. While a bonus runs its violet rim owns the rim and the wash is halved. */
const scr={p:0,warm:0,relief:0,ph:'calm'};
function pressureTarget(){                              // {p, warm} for the current phase and room
  if(!CFG.FX_PRESSURE_SCREEN||!paced()||state==='over') return {p:0,warm:0};
  const ph=pace.ph, lo=0.1, k=Math.max(0,Math.min(1,(CFG.ROOM_OK-roomNow)/(CFG.ROOM_OK-lo)));   // continuous with the room
  if(ph==='relief') return {p:0,warm:0};               // the release: everything eases away
  if(ph==='edge') return {p:Math.max(0.72,k),warm:1};
  if(ph==='recovery') return {p:Math.max(0.8,k),warm:0.45};
  return {p:k*0.55,warm:0.6*k};                        // calm: ~0; building: a faint warming
}
function resetPressure(snap){                         // a new run (snap=false: eases from nothing) or a restored one (snap=true: already where it should be)
  const t=snap?pressureTarget():{p:0,warm:0};
  scr.p=t.p; scr.warm=t.warm; scr.relief=0; scr.ph=pace.ph;
  resetLooks(snap);
}
function stepPressure(dt){
  const t=pressureTarget();
  if(pace.ph!==scr.ph){                                // phase change: leaving edge/recovery into relief is the flash
    if(pace.ph==='relief'&&(scr.ph==='edge'||scr.ph==='recovery')&&CFG.FX_PRESSURE_SCREEN&&paced()) scr.relief=1;
    scr.ph=pace.ph;
  }
  const f=Math.min(1,dt*(t.p>scr.p?0.05:0.09));        // tightens slowly, lets go a bit faster
  scr.p+=(t.p-scr.p)*f; scr.warm+=(t.warm-scr.warm)*f;
  if(Math.abs(t.p-scr.p)<0.002) scr.p=t.p;
  scr.relief=Math.max(0,scr.relief-dt/55);
}
let _vig=null;
function vignetteSprite(){                              // one cached dark-warm vignette (clear in the middle), rebuilt only on resize
  if(_vig&&_vig.W===W&&_vig.H===H&&_vig.B===B) return _vig.cv;
  const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(W*0.25)); cv.height=Math.max(1,Math.round(H*0.25));
  const x=cv.getContext('2d'), w=cv.width, h=cv.height, g=x.createRadialGradient(w/2,h/2,Math.min(Math.hypot(w,h)/2-2,B*0.75*0.25),w/2,h/2,Math.hypot(w,h)/2);   // clear over the whole board (its half-diagonal), dark only in the margins
  g.addColorStop(0,'rgba(40,0,0,0)'); g.addColorStop(1,'rgba(40,0,0,1)'); x.fillStyle=g; x.fillRect(0,0,w,h);
  _vig={W,H,B,cv}; return cv;
}
function drawPressureWash(){                           // behind the board: a warm sky wash, a vignette, and the relief flash
  const k=bonus?0.5:1;
  if(scr.p>0.01){
    ctx.globalAlpha=scr.p*0.10*k; ctx.fillStyle=`hsl(${28-18*scr.warm} 95% 55%)`; ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=scr.p*0.5*k; ctx.drawImage(vignetteSprite(),0,0,W,H);
    ctx.globalAlpha=1;
  }
  if(scr.relief>0.01&&!reduce){ ctx.globalAlpha=scr.relief*0.2; ctx.fillStyle='#BFF6FF'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
}
function drawPressureRim(now){                         // the board frame: cool and still when comfortable, warm and breathing when tight
  const p=scr.p, hue=200-(200-(12+28*(1-scr.warm)))*Math.min(1,p*1.1);   // cool blue -> amber (recovery) / red-orange (edge)
  const beat=reduce?0.5:0.5+0.5*Math.sin(now*(0.0025+0.004*p)), a=0.45+0.4*p, w=p*(0.6+0.4*beat);
  roundPath(ctx,bx-9,by-9,B+18,B+18,20);
  ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.12*(1+w)})`; ctx.lineWidth=12+14*p+6*w; ctx.stroke();
  ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.28})`;       ctx.lineWidth=5+6*p+2*w;  ctx.stroke();
  ctx.strokeStyle=`hsla(${hue} 85% 66% / ${a})`;            ctx.lineWidth=2+2*p;      ctx.stroke();
  if(scr.relief>0.01){ ctx.strokeStyle=`rgba(143,247,255,${scr.relief*0.8})`; ctx.lineWidth=4+8*scr.relief; ctx.stroke(); }
}
let closerK=0;                                         // (7.3) the closer shimmer, eased in and out
function drawTrayBand(){                               // the tray dims as the room shrinks: a soft dark band behind the pieces (never over them)
  const a=slotRect(0), z=slotRect(2);
  closerK+=((CFG.FX_CLOSER_GLOW&&closerTray&&state==='play'&&tray.some(t=>t)?1:0)-closerK)*0.08;
  if(closerK<0.01) closerK=0;
  const fk=fire.k*(state==='play'&&tray.some(t=>t)?1:0);
  if(scr.p<0.02&&!closerK&&fk<0.01) return;
  roundPath(ctx,a.x-6,a.y,z.x+z.w-a.x+12,a.h,14);
  if(scr.p>=0.02){ ctx.globalAlpha=scr.p*0.28; ctx.fillStyle='#1a0a05'; ctx.fill(); }
  if(fk>=0.01){                                       // (7.5d) combo fire: the tray glows warm behind the pieces, breathing with the flames
    const b=reduce?0.6:0.5+0.5*Math.sin(performance.now()*0.006), [core,edge]=FIRE_TINTS[fire.tier];
    ctx.globalAlpha=fk*(0.12+0.08*b); ctx.fillStyle=`rgb(${edge})`; ctx.fill();
    ctx.globalAlpha=fk*(0.45+0.3*b); ctx.strokeStyle=`rgb(${core})`; ctx.lineWidth=2+fire.flare*2; ctx.stroke();
  }
  if(closerK){                                         // (7.3) a closer: a soft pale glow behind the pieces, breathing; reduced motion holds still
    const b=reduce?0.6:0.5+0.5*Math.sin(performance.now()*0.004);
    ctx.globalAlpha=closerK*(0.10+0.08*b); ctx.fillStyle='#BFF6FF'; ctx.fill();
    ctx.globalAlpha=closerK*(0.35+0.3*b); ctx.strokeStyle='#DFFBFF'; ctx.lineWidth=2; ctx.stroke();
  }
  ctx.globalAlpha=1;
}

/* Combo fire (plan 7.5d). From combo BIG_COMBO (3) the streak burns: flame tongues lick outward from the board frame, hotter
   with each step (orange at 3, gold at 4, white-hot from 5); the piece she drags sheds embers; the tray glows warm behind the
   pieces. When a drop does not clear, the streak is over: the flames drop and a ring of smoke puffs off the rim with a soft "pff".
   One eased heat, `fire.k` (combo 3 = .4 .. combo 6+ = 1), plus `fire.flare`, a short kick on every new step. Everything sits in
   the board layer under the gems: the rim, the tray band, and capped lists of cheap sprites (embers, smoke); a bonus's own rim
   owns the frame, so the fire waits. Reduced motion: a steady warm rim and tray glow, no embers, and the snuff is a fade.
   Settings > Look > Advanced "Combo fire" (FX_COMBO_FIRE) turns all of it off. */
const fire={k:0,flare:0,tier:0,out:0,embers:[],smoke:[],px:null,py:0,acc:0,idle:0};
const FIRE_TINTS=[['255,150,40','255,90,20'],['255,210,80','255,140,30'],['255,250,225','255,190,90']];   // [core, edge] per tier
const _flames={};
function flameSprite(tier){                              // one soft tongue of fire, tip up, cached per tier and cell size, full-res at its tallest (see drawFireRim)
  const key=tier+'|'+cell; let sp=_flames[key]; if(sp) return sp;
  const w=cell*0.9, h=cell*1.75, cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr));
  const x=cv.getContext('2d'); x.scale(cv.width/w,cv.height/h); x.globalCompositeOperation='lighter';
  const [core,edge]=FIRE_TINTS[tier];
  const blob=(cy,rx,ry,stops)=>{                         // a radial glow stretched upward into a tongue
    x.save(); x.translate(w/2,cy); x.scale(1,ry/rx);
    const g=x.createRadialGradient(0,0,0,0,0,rx); stops.forEach(([o,c])=>g.addColorStop(o,c));
    x.fillStyle=g; x.beginPath(); x.arc(0,0,rx,0,6.283); x.fill(); x.restore();
  };
  blob(h*0.74,w*0.5,h*0.62,[[0,`rgba(${edge},0.75)`],[0.45,`rgba(${edge},0.45)`],[1,`rgba(${edge},0)`]]);   // the body, tapering to a tip
  blob(h*0.8,w*0.24,h*0.3,[[0,`rgba(${core},0.95)`],[0.6,`rgba(${core},0.4)`],[1,`rgba(${core},0)`]]);       // the hot heart near the base
  for(const k in _flames) if(!k.endsWith('|'+cell)) delete _flames[k];   // a resize drops the old sizes
  sp={cv,w,h}; _flames[key]=sp; return sp;
}
let _ember=null, _puff=null;
function emberSprite(){                                  // a hot dot with a soft halo
  if(_ember&&_ember.c===cell) return _ember.cv;
  const r=Math.max(4,cell*0.16), cv=document.createElement('canvas'); cv.width=cv.height=Math.max(2,Math.round(r*2*dpr));
  const x=cv.getContext('2d'), m=cv.width/2, g=x.createRadialGradient(m,m,0,m,m,m);
  g.addColorStop(0,'rgba(255,245,210,1)'); g.addColorStop(0.3,'rgba(255,170,60,.85)'); g.addColorStop(1,'rgba(255,90,20,0)');
  x.fillStyle=g; x.fillRect(0,0,cv.width,cv.width); _ember={c:cell,cv}; return cv;
}
function puffSprite(){                                   // a soft grey ball of smoke
  if(_puff&&_puff.c===cell) return _puff.cv;
  const r=cell*0.5, cv=document.createElement('canvas'); cv.width=cv.height=Math.max(2,Math.round(r*2*dpr*0.5));
  const x=cv.getContext('2d'), m=cv.width/2, g=x.createRadialGradient(m,m,0,m,m,m);
  g.addColorStop(0,'rgba(235,232,240,.95)'); g.addColorStop(0.55,'rgba(195,190,205,.55)'); g.addColorStop(1,'rgba(150,146,160,0)');
  x.fillStyle=g; x.fillRect(0,0,cv.width,cv.width); _puff={c:cell,cv}; return cv;
}
const fireOn=()=>CFG.FX_COMBO_FIRE&&!bonus&&state==='play';
function fireTarget(){ return fireOn()&&combo>=CFG.BIG_COMBO?Math.min(1,0.4+0.2*(combo-CFG.BIG_COMBO)):0; }   // combo 3 = .4, 4 = .6, 5 = .8, 6+ = 1
function fireReset(){ fire.k=0; fire.flare=0; fire.out=0; fire.embers.length=0; fire.smoke.length=0; fire.px=null; fire.acc=0; }
function fireCombo(){                                   // place(): a clear made combo `combo`
  if(!fireOn()||combo<CFG.BIG_COMBO) return;
  fire.flare=1; fire.out=0; fire.tier=combo>=5?2:combo>=4?1:0;
  if(!reduce) for(let i=0;i<6;i++) fireEmber(bx-9+Math.random()*(B+18),by-9,(Math.random()-.5)*1.5,-2-Math.random()*2.5);   // a burst of sparks off the top
}
function fireSnuff(){                                   // place(): a drop that did not clear, with the streak burning
  if(fire.k<0.05) return;
  fire.out=1; fire.flare=0;
  Sfx.snuff();
  if(reduce) return;
  const n=16, P=2*(B+18)*2;
  for(let i=0;i<n;i++){
    const [x,y,nx,ny]=rimPoint((i+Math.random()*0.5)/n*P);
    fire.smoke.push({x:x+nx*4,y:y+ny*4,vx:nx*0.5+(Math.random()-.5)*0.3,vy:ny*0.5-0.6-Math.random()*0.4,s:0.5+Math.random()*0.3,life:1});
  }
}
function fireEmber(x,y,vx,vy){
  if(fire.embers.length>=Math.round(36*perf.fx)) return;
  fire.embers.push({x,y,vx,vy,life:1,r:0.6+Math.random()*0.5});
}
function rimPoint(d){                                     // a point at distance d around the board frame, clockwise from the top-left: [x, y, outward nx, ny]
  const L=B+18, x0=bx-9, y0=by-9;
  d=((d%(4*L))+4*L)%(4*L);
  if(d<L) return [x0+d,y0,0,-1];
  if(d<2*L) return [x0+L,y0+d-L,1,0];
  if(d<3*L) return [x0+L-(d-2*L),y0+L,0,1];
  return [x0,y0+L-(d-3*L),-1,0];
}
function stepFire(dt){
  const t=fireTarget();
  if(fire.out>0){ fire.k*=Math.pow(0.82,dt); fire.out=Math.max(0,fire.out-dt/40); }
  else fire.k+=(t-fire.k)*Math.min(1,dt*(t>fire.k?0.12:0.08));
  if(fire.k<0.004) fire.k=0;
  fire.flare=Math.max(0,fire.flare-dt/28);
  if(fire.k>0.05&&!reduce&&drag&&tray[drag.i]&&drag.cx!=null){   // embers shed by the dragged piece, by distance moved, and a slow smoulder when it is still
    const s=tray[drag.i].s;
    if(fire.px!=null) fire.acc+=Math.hypot(drag.cx-fire.px,drag.cy-fire.py);
    fire.px=drag.cx; fire.py=drag.cy; fire.idle+=dt;
    const step=cell*(0.45-0.2*fire.k);
    while(fire.acc>=step||fire.idle>=14){
      if(fire.acc>=step) fire.acc-=step; else fire.idle=0;
      const [dr,dc]=s.cells[(Math.random()*s.cells.length)|0];
      fireEmber(drag.cx+(dc+Math.random()-s.cols/2)*cell,drag.cy+(dr+Math.random()-s.rows/2)*cell,(Math.random()-.5)*1.2,-0.6-Math.random()*1.4);
      fire.idle=0;
    }
  } else { fire.px=null; fire.acc=0; }
  if(fire.k>0.05&&!reduce&&Math.random()<0.25*fire.k*dt){   // a few sparks lift off the top of the rim
    fireEmber(bx-9+Math.random()*(B+18),by-9-cell*0.3*Math.random(),(Math.random()-.5)*0.8,-1.2-Math.random()*1.8);
  }
}
function drawFireRim(now){                             // the board layer, after the rim: a warm stroke and the tongues, all outside the frame
  const k=fire.k; if(k<=0.01) return;
  const fl=fire.flare, [core,edge]=FIRE_TINTS[fire.tier];
  roundPath(ctx,bx-9,by-9,B+18,B+18,20);                // the frame itself glows hot: one stroke (wide strokes are what cost)
  ctx.strokeStyle=`rgba(${core},${0.55+0.35*k})`; ctx.lineWidth=3+3*k+3*fl; ctx.stroke();
  const sp=flameSprite(fire.tier), L=B+18, side=bx-9>cell*0.4, n=side?30:16, P=side?4*L:2*L;   // with no margin beside the board (a phone), only top and bottom burn
  const M=ctx.getTransform(), a=Math.min(1,0.35+0.65*k);
  ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=a;
  ctx.imageSmoothingEnabled=false;                       // (perf) the sprite is full-res and only ever drawn smaller, so no filtering is needed; filtered blits were most of the cost
  for(let i=0;i<n;i++){
    let d=(i+0.5)/n*P; if(!side&&d>=L) d+=L;            // top edge, then (skipping the right side) the bottom edge
    const [x,y,nx,ny]=rimPoint(d);
    const fx=reduce?0.7:0.5+0.3*Math.sin(now*0.013+i*1.7)+0.2*Math.sin(now*0.029+i*2.9);
    let h=cell*(0.45+0.85*k)*(0.7+0.45*fx)*(1+0.5*fl);
    if(ny>0) h*=0.45; else if(ny<0) h*=1.15; else h*=0.7;   // short under the board (the tray lives there), tallest on top, sides in between
    const w=sp.w*(h/sp.h)*(1.15+0.3*k);
    if(ny<0){ ctx.drawImage(sp.cv,x-w/2,y-h*0.85,w,h); continue; }   // the top burns straight up: no transform
    let dx=nx, dy=ny-0.7; const m=Math.hypot(dx,dy)||1; dx/=m; dy/=m;   // outward, leaning up like real fire
    ctx.translate(x,y); ctx.rotate(Math.atan2(dx,-dy));
    ctx.drawImage(sp.cv,-w/2,-h*0.85,w,h);
    ctx.setTransform(M);
  }
  ctx.imageSmoothingEnabled=true; ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
}
function drawFireParticles(dt){                        // embers (additive) and smoke: in the board layer, under the gems, the tray and the held piece
  const E=fire.embers, S=fire.smoke;
  if(E.length){
    const sp=emberSprite(), r0=Math.max(4,cell*0.16);
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for(let i=E.length-1;i>=0;i--){
      const e=E[i]; e.x+=e.vx*dt; e.y+=e.vy*dt; e.vy-=0.02*dt; e.vx*=Math.pow(0.97,dt); e.life-=dt*0.03;
      if(e.life<=0){ E[i]=E[E.length-1]; E.pop(); continue; }
      const r=r0*e.r*(0.4+0.6*e.life);
      ctx.globalAlpha=Math.min(1,e.life*1.4); ctx.drawImage(sp,e.x-r,e.y-r,r*2,r*2);
    }
    ctx.restore();
  }
  if(S.length){
    const sp=puffSprite();
    for(let i=S.length-1;i>=0;i--){
      const p=S[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=Math.pow(0.96,dt); p.vy*=Math.pow(0.985,dt); p.life-=dt*0.022; p.s+=dt*0.018;
      if(p.life<=0){ S[i]=S[S.length-1]; S.pop(); continue; }
      const r=cell*0.5*p.s;
      ctx.globalAlpha=0.85*p.life*Math.min(1,(1-p.life)*6+0.3); ctx.drawImage(sp,p.x-r,p.y-r,r*2,r*2);
    }
  }
  ctx.globalAlpha=1;
}

/* Whole-screen mode looks (plan 6.7). Four states she can read from across the room, each one eased weight in `lk`, drawn on the same
   layer as the 6.6 pressure wash: BEHIND the gems (a tinted vignette that is clear over the whole board, a faint wash) and in a ring just
   OUTSIDE the board frame. Block and board material are never touched, there is no new text.
     bonus   violet: vignette, a slow band of light sweeping the screen (faster on the last tray), an entrance flash
     golden  gold: vignette on top of the old gold wash, a shimmering gold ring
     adventure  mint: vignette and a ring around the board that fills with the level's goal (her progress, readable without numbers)
     daily   coral: vignette and a dashed ring that turns slowly (a "today only" ticket)
   Reduced motion: no sweep, no flash, a static ring. Pressure (6.6) keeps the frame itself, so these never fight it. */
const lk={bonus:0,gold:0,adv:0,daily:0,flash:0,was:false,prog:0};
const TINTS={bonus:'110,60,230',gold:'200,140,10',adv:'20,150,120',daily:'230,90,80'};
const _tv={};
function tintVignette(key){                             // cached 1/4-res vignette per colour, rebuilt on resize
  let t=_tv[key]; if(t&&t.W===W&&t.H===H&&t.B===B) return t.cv;
  const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(W*0.25)); cv.height=Math.max(1,Math.round(H*0.25));
  const x=cv.getContext('2d'), w=cv.width, h=cv.height, g=x.createRadialGradient(w/2,h/2,Math.min(Math.hypot(w,h)/2-2,B*0.75*0.25),w/2,h/2,Math.hypot(w,h)/2);
  g.addColorStop(0,`rgba(${TINTS[key]},0)`); g.addColorStop(1,`rgba(${TINTS[key]},1)`); x.fillStyle=g; x.fillRect(0,0,w,h);
  _tv[key]={W,H,B,cv}; return cv;
}
let _band=null;
function bandSprite(){                                  // a soft vertical band of light, one cached sprite
  if(_band&&_band.H===H) return _band.cv;
  const cv=document.createElement('canvas'); cv.width=64; cv.height=Math.max(1,Math.round(H*0.25));
  const x=cv.getContext('2d'), g=x.createLinearGradient(0,0,64,0);
  g.addColorStop(0,'rgba(220,190,255,0)'); g.addColorStop(.5,'rgba(235,215,255,1)'); g.addColorStop(1,'rgba(220,190,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,cv.height);
  _band={H,cv}; return cv;
}
function resetLooks(snap){                              // a new run (snap=false: fades in from nothing) or a restored one (snap=true: already up, no entrance flash)
  lk.bonus=lk.gold=lk.adv=lk.daily=lk.flash=lk.prog=0; lk.was=!!(snap&&bonus);
  if(snap&&bonus) lk.bonus=1;
}
function stepLooks(dt){
  const play=state==='play', gl=golden&&goldenState()!=='dead';
  const f=Math.min(1,dt*0.07);
  lk.bonus+=((bonus&&play?1:0)-lk.bonus)*f;
  lk.gold+=((gl&&play&&CFG.FX_GOLD_TINT&&!(transform&&transform.id==='goldvault')?1:0)-lk.gold)*f;   // Gold Vault is already gold: not doubled
  lk.adv+=((mode==='adventure'&&lvl&&play?1:0)-lk.adv)*f;
  lk.daily+=((mode==='daily'&&play?1:0)-lk.daily)*f;
  if(bonus&&play&&!lk.was&&!reduce) lk.flash=1;
  lk.was=!!bonus; lk.flash=Math.max(0,lk.flash-dt/40);
  if(mode==='adventure'&&lvl&&lvl.goal) lk.prog+=(clamp(goalProgress()/lvl.goal.n,0,1)-lk.prog)*Math.min(1,dt*0.12);
  else lk.prog=0;
}
function drawModeWash(now){                             // behind the board, after the pressure wash
  const tv=(key,a)=>{ if(a>0.01){ ctx.globalAlpha=a; ctx.drawImage(tintVignette(key),0,0,W,H); } };
  if(lk.bonus>0.01){
    const last=bonus&&bonus.left===1, pulse=reduce?0.6:0.5+0.5*Math.sin(now*(last?0.007:0.004));
    ctx.globalAlpha=lk.bonus*(0.07+0.06*pulse); ctx.fillStyle='#8A5CFF'; ctx.fillRect(0,0,W,H);
    tv('bonus',lk.bonus*(0.5+0.2*pulse));
    if(!reduce){ const per=last?2600:4200, u=((now%per)/per), bw=W*0.55;   // the sweep: one band crossing the screen
      ctx.globalAlpha=lk.bonus*0.16; ctx.drawImage(bandSprite(),-bw+u*(W+bw*2),0,bw,H); }
  }
  if(lk.gold>0.01) tv('gold',lk.gold*0.42);
  if(lk.adv>0.01) tv('adv',lk.adv*0.3);
  if(lk.daily>0.01) tv('daily',lk.daily*0.3);
  ctx.globalAlpha=1;
  if(lk.flash>0.01){ ctx.globalAlpha=lk.flash*0.32; ctx.fillStyle='#E6D8FF'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
}
function drawModeRing(now){                             // just outside the board frame (the pressure / bonus rim sits inside it)
  const o=Math.max(6,Math.min(15,bx-5)), w=B+2*o, rr=Math.min(24,20+o-6),   // on a phone the margin is ~13 px: keep the ring on screen
     per=4*(w-2*rr)+2*Math.PI*rr;
  const ring=(col,lw,dash,off)=>{ roundPath(ctx,bx-o,by-o,w,w,rr); ctx.setLineDash(dash||[]); ctx.lineDashOffset=off||0; ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.stroke(); ctx.setLineDash([]); };
  if(lk.adv>0.01){                                       // the goal ring: faint track, bright fill = progress
    ring(`rgba(120,240,210,${0.18*lk.adv})`,3);
    if(lk.prog>0.005){ const sh=reduce?0.8:0.75+0.25*Math.sin(now*0.004);
      ring(`rgba(150,255,225,${(0.5+0.4*sh)*lk.adv})`,4,[per*lk.prog,per]); }
  }
  if(lk.daily>0.01) ring(`rgba(255,150,130,${0.7*lk.daily})`,3,[3,9],reduce?0:-now*0.012);
  if(lk.gold>0.01){ const sh=reduce?0.7:0.6+0.4*Math.sin(now*0.005);
    ring(`rgba(255,206,72,${(0.3+0.4*sh)*lk.gold})`,4); ring(`rgba(255,244,190,${0.8*lk.gold})`,1.5); }
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

/* (7.5) blocks that crumble, second pass. The block itself breaks: a crack runs through the gem along and across its
   line (crack(), in the clear's ~4 frames), then the gem splits into four quarters cut from its own cached tile
   (spawnRubble: drawImage of a sub-rectangle, so every skin keeps its shading). At the moment of the split the
   quarters sit exactly where the gem was, then pop a few px apart and fall with spin and gravity off the bottom of
   the screen, fading near the end. The line breaks as a wave: each gem's crack starts CRUMBLE_STAGGER frames per
   cell along the line from the piece she just placed (game.js). Rubble is drawn over the board and the gems left on
   it, and under the tray and everything after it (drawRubble). How big it gets follows the 6.3 hierarchy, by the
   shatter's tier: 1 single line (four quarters, a little pop, short life, no dust or specks: crisp), 2 multi-line or
   star (more pop, a pale dust puff and a few specks per gem), 3 combo BIG_COMBO+ (more kick away from the piece),
   4 clean sweep (the most). Every quarter counts against the particle budget (fxLive): when it is short a gem breaks
   in two halves, or falls whole, or (budget spent) just goes. */
const CRUMBLE_CRACK=4, RUBBLE_G=0.6, RUBBLE_POP=[0,.7,1.3,1.7,2.1], RUBBLE_KICK=[0,.3,.9,1.6,2], RUBBLE_LIFE=[0,34,56,60,66], RUBBLE_FADE=[0,12,10,10,10];
const RUBBLE_CUTS={4:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]],2:null,1:[[0,0,1,1]]};
function crack(s,x,y,k){                             // two zigzags through the gem, drawn in as k goes 0 -> 1: the lines it breaks along
  if(!s.ck){
    const zig=(along)=>{ const pts=[]; for(let j=0;j<=4;j++){ const a=j/4, w=(j===0||j===4)?0:(Math.random()-.5)*.2; pts.push(along?[a,.5+w]:[.5+w,a]); } return pts; };
    s.ck=[zig(!s.horiz),zig(s.horiz)];               // first across the line (it splits side to side), then along it
  }
  ctx.lineCap='round';
  for(let z=0;z<2;z++){
    const kk=z?clamp(k*1.6-.5,0,1):Math.min(1,k*1.6); if(kk<=0) continue;
    const pts=s.ck[z], m=Math.max(1,Math.ceil(kk*(pts.length-1)));
    ctx.beginPath(); ctx.moveTo(x+pts[0][0]*cell,y+pts[0][1]*cell);
    for(let j=1;j<=m;j++) ctx.lineTo(x+pts[j][0]*cell,y+pts[j][1]*cell);
    ctx.globalAlpha=0.5*kk; ctx.strokeStyle='rgba(20,10,40,1)'; ctx.lineWidth=Math.max(1.5,cell*.07); ctx.stroke();
    ctx.globalAlpha=0.9*kk; ctx.strokeStyle='#fff';             ctx.lineWidth=Math.max(1,cell*.03);  ctx.stroke();
  }
  ctx.globalAlpha=1; ctx.lineCap='butt';
}
function spawnRubble(s,cx,cy,g){
  const room=fxRoom(), tier=s.tier||2; if(room<=0) return;
  const cuts=room>=4?RUBBLE_CUTS[4]:room>=2?(s.horiz?[[0,0,.5,1],[.5,0,.5,1]]:[[0,0,1,.5],[0,.5,1,.5]]):RUBBLE_CUTS[1];
  const away=Math.atan2(cy-s.oy,cx-s.ox), pop=RUBBLE_POP[tier]||1.3, kick=RUBBLE_KICK[tier]||.9, life=RUBBLE_LIFE[tier]||34;
  const tiles=gemBig;                               // the tile set right now: a transformation may swap gemBig mid-fall
  for(const [fx,fy,fw,fh] of cuts){
    const dx=fx+fw/2-.5, dy=fy+fh/2-.5;              // this piece's offset from the gem's centre, in cells (+-0.25 for a quarter)
    rubble.push({x:cx+dx*cell,y:cy+dy*cell,
      vx:dx*4*pop+Math.cos(away)*kick*(.5+Math.random()*.5)+(Math.random()-.5)*.6,
      vy:dy*4*pop+Math.sin(away)*kick*.4-1.1-Math.random()*(.6+kick*.6),
      rot:0,vr:(dx||.25)*(dy>0?-1:1)*(.12+Math.random()*.1)*(tier>1?1.4:1),
      tiles,gi:s.gi,fx,fy,fw,fh,age:0,life,fade:RUBBLE_FADE[tier]||10});
  }
  if(tier>=2){                                       // a small pale puff where the gem broke
    for(let k=Math.min(tier>=3?3:2,fxRoom());k>0;k--){
      const a=Math.random()*6.283;
      dust.push({x:cx+Math.cos(a)*cell*.15,y:cy+Math.sin(a)*cell*.15,vx:Math.cos(a)*(.6+Math.random()*.6),vy:Math.sin(a)*.6-.5,r:cell*(.12+Math.random()*.06),life:.8});
    }
  }
}
function drawRubble(dt){
  if(!rubble.length) return;
  const T=ctx.getTransform(), a=T.a,b=T.b,c=T.c,d=T.d,e=T.e,f=T.f;   // compose each piece's turn with the frame's own transform (shake): no save/restore per piece
  for(let i=rubble.length-1;i>=0;i--){
    const p=rubble[i];
    p.age+=dt; p.vy+=RUBBLE_G*dt; p.vx*=Math.pow(.985,dt); p.x+=p.vx*dt; p.y+=p.vy*dt; p.rot+=p.vr*dt;
    const left=p.life-p.age;                          // the last few frames fade out (a single line's pieces go sooner; bigger clears fall off the screen first)
    if(left<=0||p.y>H+cell||p.x<-cell||p.x>W+cell){ rubble.splice(i,1); continue; }
    const tile=p.tiles[p.gi]; if(!tile) continue;
    const pw=p.fw*cell, ph=p.fh*cell, sc=1-0.18*Math.min(1,p.age/p.life);
    const cs=Math.cos(p.rot)*sc, sn=Math.sin(p.rot)*sc;
    ctx.setTransform(a*cs+c*sn,b*cs+d*sn,c*cs-a*sn,d*cs-b*sn,a*p.x+c*p.y+e,b*p.x+d*p.y+f);
    ctx.globalAlpha=Math.min(1,left/p.fade);
    const tw=tile.width, th=tile.height;
    ctx.drawImage(tile,p.fx*tw,p.fy*th,p.fw*tw,p.fh*th,-pw/2,-ph/2,pw,ph);
  }
  ctx.setTransform(T); ctx.globalAlpha=1;
}

/* frame budget (plan 2.2). Every frame measures the gap since the one before. Effect particles share one
   budget, PARTICLE_CAP scaled by perf.fx: a frame over FRAME_BUDGET_MS (or 1.5x the device's own frame
   interval, so a 30 Hz Low Power Mode phone isn't punished for every frame) cuts it, frames on time grow it back
   over about a second, so a slow moment sheds sparkle instead of frames. With ?dev a corner readout shows the
   slowest frame of the last two seconds, how many frames have run long (tap it to reset), the time the game's
   own code took in the last frame, and the particle budget. */
const perf={gaps:new Float32Array(120),gi:0,over:0,work:0,fx:1,hud:null};
const fxLive=()=>goldRain.length+bursts.length+shards.length+sparkles.length+dust.length+chunks.length+confetti.length+rubble.length;
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
  const h=hesSummary(), sec=ms=>(ms/1000).toFixed(1)+'s';   // the hesitation log (plan 3.4): medians of the last 20 trays, n = samples used / kept
  perf.hud.textContent='max '+mx.toFixed(1)+'ms  >'+CFG.FRAME_BUDGET_MS+'ms: '+perf.over+'\nwork '+perf.work.toFixed(1)+'ms  fx '+Math.round(perf.fx*100)+'% ('+fxLive()+')'
    +'\nhes pick '+sec(h.pick)+'  place '+sec(h.place)+'  clr '+h.clr+'%  n '+h.n+'/'+h.total
    +(paced()?'\n'+pace.ph+' '+pace.n+(pace.ph==='edge'?'/'+pace.hold:'')+'  room '+roomNow.toFixed(2)+'  '+lastTier:'');   // (6.1) the dealer's phase
  perf.hud.style.color=mx>CFG.FRAME_BUDGET_MS?'#FFB3B3':'#fff';
}


/* (7.5b) The journey sky, Endless and Daily (CFG.JOURNEY_SKY; Settings -> Look -> Advanced). The sky travels as the score
   climbs, dawn -> day -> golden hour -> night -> aurora -> space (CFG.JOURNEY_AT), and every clean sweep jumps one stage on
   top (jJumps, saved with the run). A stage is a JOURNEY world (worlds.js) plus a cached decor sprite. It is drawn in the sky
   layer only, so pressure (6.6) and the mode looks (6.7) sit on top as before and no gem, board or tray pixel changes.
   A stage change is a top-down wipe of the whole sky: calm after a score threshold (it waits for the next deal plus
   JOURNEY_WAIT frames, ~1.4 s, a faint edge), quicker with a bright leading edge after a sweep (once its confetti settles).
   Bonus trays and transformations take the sky over as before; a stage passed meanwhile wipes in when they hand back.
   Reduced motion: no wipe, the stage simply changes. */
let jStage=0, jJumps=0, jShown=0, jw=null, jPend=null, jSweep=false;   // target stage, sweeps this run, stage on screen, the wipe, a pending change
const journeyOn=()=>!!CFG.JOURNEY_SKY&&paced();
function journeyTarget(){
  const at=CFG.JOURNEY_AT; let k=0;
  for(let i=1;i<at.length;i++) if(score>=at[i]) k=i;
  return Math.min(JOURNEY.length-1,k+jJumps);
}
const homeSky=()=>journeyOn()?JOURNEY[jStage].id:CFG.HOME_WORLD;   // where the sky goes back to when nothing else owns it
function journeySweep(){ jJumps++; if(journeyOn()){ jSweep=true; jPend={t:CFG.JOURNEY_WAIT+30}; } }   // place(): a clean sweep
function journeyDealt(){ if(journeyOn()&&!jPend&&journeyTarget()>jStage) jPend={t:CFG.JOURNEY_WAIT}; } // stepDeal(): a tray was dealt
function stepJourney(dt){
  if(!jPend) return;
  if((jPend.t-=dt)>0) return;
  jPend=null; journeyAdvance();
}
function journeyAdvance(){
  if(!journeyOn()) return;
  jStage=Math.max(jStage,journeyTarget());
  if(jStage===jShown||!isJourney(curWorld)) return;    // a bonus or transformation owns the sky: it wipes in at the hand-back
  const to=JOURNEY[jStage].id;
  if(reduce){ syncHomeSky(); return; }
  bgFrom=curWorld; ambientOld=ambient; curWorld=to; ambient=spawnAmbient(worldDef(to).effect);
  beginWipe();
}
function beginWipe(){                                  // bgFrom/ambientOld = the old sky, curWorld/ambient = the new one
  jw={from:bgFrom,t:0,dur:jSweep?50:84,sweep:jSweep}; jSweep=false; jShown=jStage; bgT=1;
}
function journeyHandBack(){                            // right after endBonus/endTransform sent the sky home
  if(!journeyOn()||!isJourney(curWorld)) return;
  if(jStage!==jShown&&!reduce&&bgFrom!==curWorld) beginWipe(); else { jShown=jStage; jSweep=false; }
}
function syncHomeSky(){                                // snap to her home sky (a Settings change, reduced motion): no animation
  jStage=Math.max(jStage,journeyTarget());
  if(transform||bonus) return;
  const id=homeSky(); jw=null; jShown=jStage; jSweep=false;
  curWorld=id; ambient=spawnAmbient(worldDef(id).effect); ambientOld=[]; bgFrom=id; bgT=1;
}
// the decor: one cached sprite per stage (and pale or not), at half the screen's pixels, drawn with one drawImage
const _decor={};
function decorSprite(id){
  const pale=paleTheme(), k=id+(pale?'p':''); let d=_decor[k];
  if(d&&d.W===W&&d.H===H) return d.cv;
  const sc=Math.max(0.5,dpr*0.5), cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(W*sc)); cv.height=Math.max(1,Math.round(H*sc));
  const x=cv.getContext('2d'); x.scale(sc,sc);
  let seed=7; const r=()=>((seed=(seed*16807)%2147483647)/2147483647);   // the same stars every time
  const glow=(cx,cy,rad,col,a)=>{ const g=x.createRadialGradient(cx,cy,0,cx,cy,rad); g.addColorStop(0,`rgba(${col},${a})`); g.addColorStop(1,`rgba(${col},0)`); x.fillStyle=g; x.fillRect(cx-rad,cy-rad,rad*2,rad*2); };
  const disc=(cx,cy,rad,fill)=>{ x.fillStyle=fill; x.beginPath(); x.arc(cx,cy,rad,0,6.283); x.fill(); };
  const stars=(n,y1,amax)=>{ for(let i=0;i<n;i++){ x.globalAlpha=(0.25+r()*0.75)*amax; disc(r()*W,r()*H*y1,0.5+r()*1.1,'#fff'); } x.globalAlpha=1; };
  const haze=(col,a,hgt)=>{ const g=x.createLinearGradient(0,H-hgt,0,H); g.addColorStop(0,`rgba(${col},0)`); g.addColorStop(1,`rgba(${col},${a})`); x.fillStyle=g; x.fillRect(0,H-hgt,W,hgt); };
  const S=Math.min(W,H*0.6);
  switch(worldDef(id).decor){
    case 'dawn':                                       // the last stars fading, a sun just over the horizon
      stars(26,0.35,0.6); haze('255,170,120',0.55,H*0.35);
      glow(W*0.78,H*0.97,S*0.55,'255,190,140',0.55); disc(W*0.78,H*0.97,S*0.1,'rgba(255,226,170,.95)'); break;
    case 'day':                                        // a small bright sun high up, a light haze low down
      glow(W*0.3,H*0.145,S*0.32,'255,250,220',0.6); disc(W*0.3,H*0.145,S*0.055,'rgba(255,252,235,.95)'); haze('235,245,255',0.35,H*0.3); break;
    case 'golden':                                     // a big low sun and a warm horizon
      haze('255,170,60',0.5,H*0.4); glow(W*0.2,H*0.98,S*0.7,'255,190,90',0.6); disc(W*0.2,H*0.98,S*0.15,'rgba(255,214,130,.9)'); break;
    case 'night':                                      // a crescent moon
      stars(30,0.9,0.5); glow(W*0.62,H*0.145,S*0.3,'190,210,255',0.25);
      { const mr=S*0.06, m=document.createElement('canvas'); m.width=m.height=Math.ceil(mr*2*sc)+2; const mx=m.getContext('2d'); mx.scale(sc,sc);   // the crescent on its own little canvas
        mx.fillStyle='rgba(236,240,255,.95)'; mx.beginPath(); mx.arc(mr,mr,mr,0,6.283); mx.fill();
        mx.globalCompositeOperation='destination-out'; mx.beginPath(); mx.arc(mr*1.45,mr*0.75,mr*0.92,0,6.283); mx.fill();
        x.drawImage(m,W*0.62-mr,H*0.145-mr,m.width/sc,m.height/sc); } break;
    case 'aurora':                                     // stars and a green glow over a dark horizon
      stars(45,0.8,0.6); glow(W*0.5,H*0.05,S*0.9,'60,255,170',0.16); glow(W*0.15,H*0.2,S*0.5,'120,140,255',0.12); haze('0,8,12',0.6,H*0.18); break;
    case 'space':                                      // nebula clouds, dense stars, a ringed planet
      glow(W*0.25,H*0.3,S*0.8,'150,60,220',0.22); glow(W*0.8,H*0.62,S*0.7,'30,170,200',0.16); stars(90,1,0.8);
      glow(W*0.66,H*0.145,S*0.18,'255,190,140',0.25); disc(W*0.66,H*0.145,S*0.06,'rgba(232,150,110,1)');
      x.strokeStyle='rgba(255,220,180,.7)'; x.lineWidth=2; x.beginPath(); x.ellipse(W*0.66,H*0.145,S*0.115,S*0.028,-0.3,0,6.283); x.stroke(); break;
  }
  _decor[k]={W,H,cv}; return cv;
}
// (perf) a steady sky is one cached plate (gradient + decor at full pixels), drawn 1:1 with one opaque blit.
// Filling the gradient and then scaling a half-size decor sprite over the whole screen every frame made each frame's
// drawing about 40% dearer (7.5b; ~20 ms at 4x CPU throttle). Rebuilt when the stage, theme or size changes.
const _plates=[];                                     // the last two plates: a wipe draws the old sky and the new one each frame
function skyPlate(id){
  const c=bgOf(id), k=id+(paleTheme()?'p':'')+c.top+c.bottom+W+'x'+H+'@'+dpr;
  const hit=_plates.find(p=>p.k===k); if(hit) return hit.cv;
  const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(W*dpr)); cv.height=Math.max(1,Math.round(H*dpr));
  const x=cv.getContext('2d',{alpha:false}); x.scale(cv.width/W,cv.height/H);
  const g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,c.top); g.addColorStop(1,c.bottom); x.fillStyle=g; x.fillRect(0,0,W,H);
  if(isJourney(id)){ x.globalAlpha=paleTheme()?0.55:1; x.drawImage(decorSprite(id),0,0,W,H); x.globalAlpha=1; }
  _plates.unshift({k,cv}); if(_plates.length>2) _plates.pop(); return cv;
}
function drawDecor(id,a){
  if(!isJourney(id)||a<=0.01) return;
  ctx.globalAlpha=a*(paleTheme()?0.55:1); ctx.drawImage(decorSprite(id),0,0,W,H); ctx.globalAlpha=1;
}
let _jband=null;
function wipeBand(){                                   // a soft horizontal band of light: the wipe's leading edge
  if(_jband) return _jband;
  const cv=document.createElement('canvas'); cv.width=4; cv.height=64; const x=cv.getContext('2d'), g=x.createLinearGradient(0,0,0,64);
  g.addColorStop(0,'rgba(255,250,235,0)'); g.addColorStop(.5,'rgba(255,250,235,1)'); g.addColorStop(1,'rgba(255,250,235,0)'); x.fillStyle=g; x.fillRect(0,0,4,64);
  return _jband=cv;
}
function paintSky(id,list,respawn,dt,aboost){          // one whole sky: gradient, decor, ambient
  ctx.drawImage(skyPlate(id),0,0,W,H);
  stepAmbient(list,worldDef(id).effect,dt,aboost,1,respawn);
}
function drawWipe(dt,aboost){                          // the new sky comes down from the top over the old one
  jw.t+=dt;
  const u=Math.min(1,jw.t/jw.dur), e=u<0.5?2*u*u:1-2*(1-u)*(1-u), fe=H*0.16, y=e*(H+fe)-fe;   // y: where the solid new sky ends
  paintSky(jw.from,ambientOld,false,dt,aboost);
  if(y>0){ ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,y); ctx.clip(); paintSky(curWorld,ambient,true,dt,aboost); ctx.restore(); }
  else stepAmbient(ambient,worldDef(curWorld).effect,dt,aboost,0,true);
  const c=bgOf(curWorld), mid=lerpCol(c.top,c.bottom,clamp(y/H,0,1));   // the feathered edge: the new sky's colour fading out below the line
  const g=ctx.createLinearGradient(0,y,0,y+fe); g.addColorStop(0,mid); g.addColorStop(1,mid.replace('rgb','rgba').replace(')',',0)'));
  ctx.fillStyle=g; ctx.fillRect(0,y,W,fe);
  ctx.globalAlpha=(jw.sweep?0.55:0.14)*Math.sin(Math.PI*u); ctx.drawImage(wipeBand(),0,y-fe*0.2,W,fe*(jw.sweep?1.1:0.8)); ctx.globalAlpha=1;
  if(u>=1){ jw=null; ambientOld=[]; bgFrom=curWorld; bgT=1; }
}

/* (7.5c) Anticipation. While she holds a piece, every line it could complete somewhere on the board is "live"; as the
   floating piece comes within CFG.ANTIC_REACH cells of a landing that completes it, that line's gems shiver (at most
   CFG.ANTIC_SHIVER px) and a glint runs along it through gem()'s own flash. Nothing is
   drawn over the board as a layer of its own (6.3: a pre-placement cue sits below a single clear). Once the piece is seated
   in a completing slot the coloured line preview takes over: those lines stop shivering.
   Only while a piece is held, never at rest, so it is not a hint before she picks one up. The completing landings are
   listed once per pickup (antList); each frame is one distance per landing plus a sin or two per gem in a live line.
   Reduced motion: no shiver and no travelling glint, a steady soft brightening. */
const antV=new Float32Array(2*N), antT=new Float32Array(2*N);   // per line (rows 0..N-1, then columns): eased value, this frame's target
const antR=new Int8Array(N*N), antC=new Int8Array(N*N), antM=new Int32Array(N*N);   // completing landings: top-left and a bitmask of the lines
let antN=0, antKey=null, antAny=false;
function antList(s){                                   // every legal landing of `s` that completes a line, with the lines it completes
  antN=0;
  if(s.star) return;                                   // the star has its own cross preview
  const rowN=new Int8Array(N), colN=new Int8Array(N);
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]){ rowN[r]++; colN[c]++; }
  const addR=new Int8Array(N), addC=new Int8Array(N);
  for(let r=0;r<=N-s.rows;r++) for(let c=0;c<=N-s.cols;c++){
    if(!canPlace(s,r,c,grid)) continue;
    addR.fill(0); addC.fill(0);
    for(const [dr,dc] of s.cells){ addR[r+dr]++; addC[c+dc]++; }
    let m=0;
    for(let q=0;q<N;q++){ if(addR[q]&&rowN[q]+addR[q]===N) m|=1<<q; if(addC[q]&&colN[q]+addC[q]===N) m|=1<<(N+q); }
    if(m){ antR[antN]=r; antC[antN]=c; antM[antN]=m; antN++; }
  }
}
function stepAnticipation(dt){
  antT.fill(0);
  const t=drag&&tray[drag.i];
  if(t&&state==='play'&&!paused&&CFG.FX_ANTICIPATION){       // Settings > Look > "Glints while dragging" turns the whole cue off
    if(antKey!==t){ antKey=t; antList(t.s); }           // a new pickup (the tray entry object is new per piece)
    if(antN){
      const s=t.s, f=floatPos(), fc=(f.x-s.cols*cell/2-bx)/cell, fr=(f.y-s.rows*cell/2-by)/cell, R=Math.max(.5,CFG.ANTIC_REACH);
      const sl=drag.slot;
      for(let i=0;i<antN;i++){
        const seated=sl&&sl.r===antR[i]&&sl.c===antC[i];
        let k=seated?1:Math.max(0,1-Math.hypot(antR[i]-fr,antC[i]-fc)/R);
        if(k<=0) continue;
        k=k*k*(3-2*k);
        if(seated&&CFG.FX_LINE_PREVIEW) continue;          // the line preview owns these lines now
        for(let l=0,m=antM[i];m;l++,m>>>=1) if((m&1)&&k>antT[l]) antT[l]=k;
      }
    }
  } else antKey=null;
  antAny=false;
  const vis=CFG.FX_ANTICIPATION;
  for(let l=0;l<2*N;l++){
    const tg=vis?antT[l]:0, v=antV[l];
    antV[l]=Math.abs(tg-v)<.004?tg:v+(tg-v)*Math.min(1,dt*(tg>v?.3:.2));
    if(antV[l]>.01) antAny=true;
  }
}
let _ax=0,_ay=0,_af=0;                                 // one gem's shiver offset and glint, written by antCell (no allocation per gem)
function antCell(r,c,now){
  const vr=antV[r], vc=antV[N+c], v=vr>vc?vr:vc;
  if(v<=.01){ _ax=_ay=_af=0; return; }
  if(reduce){ _ax=_ay=0; _af=v*.16; return; }
  const A=CFG.ANTIC_SHIVER*v;
  _ax=A*Math.sin(now*.085+r*1.9+c*2.7); _ay=A*.6*Math.sin(now*.071+r*2.3+c*1.1);
  const along=vr>=vc?c:r, head=(now*.011)%(N+5)-2.5;   // the glint runs along the line, once a second
  _af=v*(.08+.34*Math.max(0,1-Math.abs(along-head)/1.3));
}

/* (8.5) Frame pacing, for battery and heat. The canvas used to redraw the whole screen every frame forever, even under the
   pause card. Now it draws every frame only while something moves fast (a drag, a clear and its effects, a deal, the score
   counting, a sky wipe, and for CFG.FRAME_FULL_MS after any touch); 30 a second when only the slow things move (the sky's
   drift, the tray's bob, the fire rim); 15 after CFG.FRAME_DOZE_MS with no touch; 5 under the pause card or Settings (the
   game is frozen there, the few frames only pick up a new look); 30 on the front menu. dt still measures real time, so
   nothing moves slower, it only moves in bigger steps. Paced frames are not counted by perfFrame (they are not late). */
let lastInput=0, paceSig='', paceFull=true;
['pointerdown','pointermove','pointerup','keydown'].forEach(t=>addEventListener(t,()=>{ lastInput=performance.now(); },{passive:true,capture:true}));
function fxBusy(){
  return !!(drag||ret||jw||flip||goldenCele||borderFlash||shownScore!==score||hitWait>0||shake>.2||punchT>.01||sweepFxT>0||lightningT>.01
    ||shatters.length||chunks.length||shards.length||lineFlashes.length||waves.length||pops.length||tags.length||bands.length
    ||slams.length||bursts.length||praises.length||banners.length||goldRain.length||orbs.length||rings.length||dust.length
    ||sweeps.length||blasts.length||rubble.length||confetti.length||fire.embers.length||fire.smoke.length);
}
function frameGap(now){                                // ms between drawn frames; 0 = every frame
  if(!CFG.FRAME_PACING) return 0;
  if(homeCard()!==hero.card) return 0;                 // the front menu opening or closing: at once (homeFrame sets up its card)
  if(hero.card) return 33;                             // first: Home from a game keeps the game paused, the menu's sky still drifts
  if(paused) return 200;
  const sig=state+'|'+score+'|'+(tray[0]?1:0)+(tray[1]?1:0)+(tray[2]?1:0)+'|'+(bonus?1:0)+'|'+combo;
  if(sig!==paceSig){ paceSig=sig; lastInput=now; }     // something happened on its own (a deal, the run ending): full speed for a moment
  if(now-lastInput<CFG.FRAME_FULL_MS||fxBusy()) return 0;
  return now-lastInput<CFG.FRAME_DOZE_MS?33:66;
}

let last=0;
function frame(now){
  requestAnimationFrame(frame);
  const gap=frameGap(now);
  if(gap&&now-last<gap-4) return;                     // not yet: a paced frame (the 4 ms slack lands it on the display's own tick)
  const t0=performance.now();
  if(paceFull&&!gap) perfFrame(now-last); paceFull=!gap;
  const dt=paused?0:Math.min(gap?gap/16.67+.5:2.5,(now-last)/16.67)||1; last=now;
  if(hitWait>0) hitWait-=dt; else shake*=Math.pow(.85,dt);
  glowT*=Math.pow(.93,dt);

  const comboTarget=combo>=CFG.BIG_COMBO?Math.min(1,(combo-1)/6):0;
  comboGlowV+=(comboTarget-comboGlowV)*Math.min(1,dt*0.15);
  const goldTarget=golden?1:0;
  goldTintV+=(goldTarget-goldTintV)*Math.min(1,dt*0.15);
  if(goldenArrive<999) goldenArrive+=dt;
  sweepFxT=Math.max(0,sweepFxT-dt/48);
  if(bestBeaten && shownScore>best){ best=shownScore; const bv=el('bestVal'); bv.textContent=best; if(!bv.classList.contains('bump')){ bv.classList.add('bump'); setTimeout(()=>bv.classList.remove('bump'),140); } }
  if(shownScore!==score && now>=scoreHold){         // quick count-up (held until the first score orb lands): ~30% of the gap a frame, at least 1
    shownScore=shownScore<score?Math.min(score,shownScore+Math.max(1,Math.ceil((score-shownScore)*0.09*dt))):score;
    el('scoreVal').textContent=shownScore; hudFit(); chaseSync();
  }
  if(hitWait<=0) punchT=Math.max(0,punchT-dt/22);

  stepFlip(dt); stepJourney(dt); mascotStep(now);   // (7.5f) the crumb: DOM, writes only on a change
  ambientBurst*=Math.pow(.88,dt);
  const aboost=1+ambientBurst*1.8+(bonus&&!reduce?0.6:0);   // a bonus keeps the sky's particles livelier
  if(homeFrame(now,dt)){                              // (8.3) the front menu: its own travelling sky, no board behind it
    stepDeal(); stepPending(); perf.work=performance.now()-t0; perfHud(now); return;
  }
  if(jw) drawWipe(dt,aboost);                         // (7.5b) a journey stage coming in
  else if(bgT>=1) ctx.drawImage(skyPlate(curWorld),0,0,W,H),   // (perf) a steady sky (journey or not) is one cached blit
    stepAmbient(ambient,worldDef(curWorld).effect,dt,aboost,1,true);
  else {
    const [bgTop,bgBot]=bgT>=1 ? [bgOf(curWorld).top,bgOf(curWorld).bottom]
      : [lerpCol(bgOf(bgFrom).top,bgOf(curWorld).top,easeOutCubic(bgT)),
         lerpCol(bgOf(bgFrom).bottom,bgOf(curWorld).bottom,easeOutCubic(bgT))];
    ctx.fillStyle=skyFill(bgTop,bgBot); ctx.fillRect(0,0,W,H);     // gradient object cached per colour pair (a new one each frame is slow on iOS)
    if(bgT<1){ drawDecor(bgFrom,1-easeOutCubic(bgT)); drawDecor(curWorld,easeOutCubic(bgT)); } else drawDecor(curWorld,1);
    if(bgT<1) stepAmbient(ambientOld,worldDef(bgFrom).effect,dt,aboost,1-easeOutCubic(bgT),false);
    stepAmbient(ambient,worldDef(curWorld).effect,dt,aboost,bgT<1?easeOutCubic(bgT):1,true);
  }

  if(worldDef(curWorld).flash && !reduce && Math.random()<0.006*dt) lightningT=1;
  lightningT=Math.max(0,lightningT-dt/10);
  if(lightningT>0.01){ ctx.globalAlpha=lightningT*0.5; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }

  { const gl=glowSprite(glowH); ctx.globalAlpha=0.10+glowT*0.34; ctx.drawImage(gl.cv,W/2-gl.r,by+B/2-gl.r,gl.r*2,gl.r*2); ctx.globalAlpha=1; }   // cached radial glow, one blit

  // background-layer washes: drawn behind the gems, so they tint the scene without ever sitting over a piece
  if(CFG.FX_GOLD_TINT && goldTintV>0.02 && !(transform&&transform.id==='goldvault')){  // Gold Vault's own look already reads gold — don't double it

    const pulse=reduce?0.7:0.6+0.4*Math.sin(now*0.004);
    ctx.globalAlpha=goldTintV*0.09*pulse; ctx.fillStyle='#FFCE48'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }
  if(goldenCele){                                  // the golden hand's payoff: a gold wash behind the board
    goldenCele.t+=dt/60;
    const f=1-goldenCele.t/(goldenCele.full?1.5:0.8);
    if(f<=0) goldenCele=null;
    else { goldenCele.f=f; ctx.globalAlpha=f*(goldenCele.full?0.4:0.16)*(reduce?0.7:0.8+0.2*Math.sin(now*0.02)); ctx.fillStyle='#FFCE48'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
  }
  if(CFG.FX_SWEEP_FX && sweepFxT>0){
    ctx.globalAlpha=sweepFxT*0.4; ctx.fillStyle=`hsl(${glowH} 85% 70%)`; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }
  if(flip && flip.t<14){                          // a brief flash right as a flip begins
    ctx.globalAlpha=(1-flip.t/14)*0.5; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
  }

  stepPressure(dt); drawPressureWash(); stepLooks(dt); drawModeWash(now);            // (6.6) pressure on screen, behind everything on the board
  ctx.save();
  if(shake>.2 && hitWait<=0) ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
  if(CFG.FX_PUNCH_ZOOM && punchT>0.01 && hitWait<=0){
    const pz=1+0.025*punchT;
    ctx.translate(bx+B/2,by+B/2); ctx.scale(pz,pz); ctx.translate(-(bx+B/2),-(by+B/2));
  }

  ctx.drawImage(boardBg.cv,bx-boardBg.pad,by-boardBg.pad,boardBg.w,boardBg.w);
  if(bonus){ drawBonusRim(now); }                          // the bonus trays' pulsing rim
  else if(borderFlash && (borderFlash.t+=dt)>=0){      // combo flash: the board edge lights in the streak colour, then fades
    const f=1-borderFlash.t/26;
    if(f<=0) borderFlash=null;
    else { roundPath(ctx,bx-9,by-9,B+18,B+18,20); ctx.strokeStyle=`rgba(${borderFlash.col},${0.9*f})`; ctx.lineWidth=5+6*f; ctx.stroke(); }
  } else if(paced()&&CFG.FX_PRESSURE_SCREEN){ drawPressureRim(now);   // (6.6) Endless / Daily: the rim follows the room and the phase
  } else if(CFG.FX_TENSION_BORDER){                            // board border glow: calm (cool) -> warm as tension climbs
    const hue=200-185*tension, a=0.45+0.4*tension;       // layered strokes fake the glow — shadowBlur every frame is slow on iOS
    roundPath(ctx,bx-9,by-9,B+18,B+18,20);
    ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.12})`; ctx.lineWidth=12+14*tension; ctx.stroke();
    ctx.strokeStyle=`hsla(${hue} 85% 62% / ${a*0.28})`; ctx.lineWidth=5+6*tension;  ctx.stroke();
    ctx.strokeStyle=`hsla(${hue} 85% 66% / ${a})`;      ctx.lineWidth=2+2*tension;  ctx.stroke();
  }

  drawModeRing(now);                                 // (6.7) the mode ring outside the frame
  stepFire(dt); if(CFG.FX_COMBO_FIRE) drawFireRim(now);   // (7.5d) combo fire: over the rim, under the gems
  drawFireParticles(dt);                             // (7.5d) embers and the snuff's smoke: under the gems too, so a spark never covers a piece
  drawTrayBand();                                    // (6.6) in the board layer, so nothing that flies over the tray (chunks, shards) is ever dimmed by it
  drawGoldPlan(now,!!(drag&&tray[drag.i]));           // (4.5c) before the held piece's preview, so the preview wins where they overlap

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
    if(gh.s.star && CFG.FX_STAR_BURST){            // (4.5b) full-length beams, a twinkle on every gem that would go, and the count
      const bn=starAt(gh.r,gh.c), best=starBest(grid).n, tw=reduce?0.7:0.6+0.4*Math.sin(now*0.012);
      ctx.globalAlpha=0.55*tw; ctx.fillStyle='#fff';
      ctx.fillRect(bx,by+(gh.r+.5)*cell-1.5,B,3); ctx.fillRect(bx+(gh.c+.5)*cell-1.5,by,3,B);
      for(let q=0;q<N;q++){
        if(grid[gh.r][q]) star(bx+(q+.5)*cell,by+(gh.r+.5)*cell,cell*0.3*tw,0.95);
        if(grid[q][gh.c]) star(bx+(gh.c+.5)*cell,by+(q+.5)*cell,cell*0.3*tw,0.95);
      }
      ctx.globalAlpha=1;
      const txt=bn+(bn===1?' gem':' gems')+(bn>=best&&bn>0?' ★':''), fs=Math.round(cell*0.5);
      const sp=sprite('stn|'+txt+'|'+fs,textW(txt,fs)+fs,fs*1.5,x=>outlined(x,txt,fs,bn>=best&&bn>0?'#FFE66B':'#fff',[[fs*0.25,'rgba(30,10,50,.9)']]));
      blit(sp,bx+(gh.c+.5)*cell,Math.max(by+fs*0.6,by+gh.r*cell-cell*0.55),1,1);
    }
    gh.lines=L; gh.hue=hue; gh.pulse=pulse;
  }

  stepAnticipation(dt);                              // (7.5c) after the slot is known, before the gems read it
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
    } else {
      if(antAny) antCell(r,c,now); else _ax=_ay=_af=0;   // (7.5c) a line one piece from clearing shivers and glints
      const lf=g.f?g.f*g.f*0.45:0, fl=lf>_af?lf:_af;
      if(g.l>0){                                    // landing thump: wide-and-short on impact, springs back over ~8 frames
        g.l=Math.max(0,g.l-dt*0.17);                // ~6 frames, about 100 ms
        const q=Math.sin(g.l*Math.PI)*0.11;
        gem(g.gi,bx+c*cell+_ax,by+r*cell+_ay,cell,base*(1+q),1,fl,false,base*(1-q*0.7));
      } else gem(g.gi,bx+c*cell+_ax,by+r*cell+_ay,cell,base,1,fl);
    }
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
    const b=blasts[i]; b.t+=dt*0.06;                   // ~17 frames of beams, after the charge (b.t starts below 0)
    if(b.t>=1){ blasts.splice(i,1); continue; }
    const cx=bx+(b.c+.5)*cell, cy=by+(b.r+.5)*cell;
    if(b.t<0){                                         // the charge: a ring pulls in to the star and it swells white
      const k=1+b.t/(CFG.STAR_CHARGE*0.06);            // 0 -> 1 over the charge
      const rr=cell*(2.4-1.8*k);
      ctx.globalAlpha=0.35+0.5*k; ctx.strokeStyle='#fff'; ctx.lineWidth=Math.max(1,cell*0.12*k);
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.283); ctx.stroke();
      const fr=cell*(0.5+1.1*k), fg=ctx.createRadialGradient(cx,cy,0,cx,cy,fr);
      fg.addColorStop(0,`rgba(255,255,255,${0.4+0.6*k})`); fg.addColorStop(1,'rgba(235,225,255,0)');
      ctx.globalAlpha=1; ctx.fillStyle=fg; ctx.fillRect(cx-fr,cy-fr,fr*2,fr*2);
      continue;
    }
    const p=easeOutCubic(b.t), a=(1-b.t)*0.95, reach=p*B*1.25, hue=(b.t*300+200)%360;
    const th=cell*(1.1-0.6*b.t);
    const beam=(x0,y0,x1,y1,horiz)=>{
      const g=horiz?ctx.createLinearGradient(x0,0,x1,0):ctx.createLinearGradient(0,y0,0,y1);
      g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(.5,`rgba(255,255,255,${a})`); g.addColorStop(1,'rgba(255,255,255,0)');
      const rb=horiz?ctx.createLinearGradient(x0,0,x1,0):ctx.createLinearGradient(0,y0,0,y1);   // a rainbow halo under the white core
      for(let q=0;q<=4;q++) rb.addColorStop(q/4,`hsla(${(hue+q*55)%360} 100% 68% / ${a*0.55})`);
      ctx.fillStyle=rb;
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
  const crumble=CFG.CLEAR_STYLE==='crumble'&&!reduce;     // (7.5) reduced motion: crumble falls back to the squash
  const squash=CFG.CLEAR_STYLE==='squash'||(CFG.CLEAR_STYLE==='crumble'&&reduce), POP=crumble?CRUMBLE_CRACK:squash?6:7;
  for(let i=shatters.length-1;i>=0;i--){
    const s=shatters[i]; s.t+=dt;
    if(s.t<0){                                       // blink phase, timed from the clear itself so the line flashes in unison
      const since=s.t-s.t0, on=since<3||since>=5;
      gem(s.gi,bx+s.c*cell,by+s.r*cell,cell,1,1,s.star?(since<(reduce?0:CFG.STAR_CHARGE)?0.15:0.95):CFG.CLEAR_BLINK>0&&on?0.95:0.15); continue;   // a star's cross waits, then goes white-hot as the beam reaches it
    }
    if(s.t>=POP){
      const g=GEMS[s.gi], cx=bx+(s.c+.5)*cell, cy=by+(s.r+.5)*cell;
      const room=fxRoom()>0;                               // the bits below are skipped once the particle budget is spent
      if(crumble){ if(room) spawnRubble(s,cx,cy,g); }
      else if(room && squash && !reduce && !s.star && s.big){                       // two little squares drift off the bar (a bigger clear only)
        for(let k=0;k<2;k++) shards.push({x:cx+(Math.random()-.5)*cell*.6,y:cy+(Math.random()-.5)*cell*.3,vx:(Math.random()-.5)*2,vy:-1-Math.random()*2,r:cell*(.05+Math.random()*.05),life:1,sq:true});
      } else if(room && !squash && CFG.FX_CHUNKS && !reduce){
        const ang=Math.atan2(cy-s.oy,cx-s.ox)+(Math.random()-.5)*.5;   // away from the placed piece
        const sp=4.5+Math.random()*4;
        chunks.push({x:cx,y:cy,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp-3,rot:(Math.random()-.5)*.4,
          vr:(Math.random()-.5)*.5,sz:cell*.86,life:1,gi:s.gi,
          col:`hsl(${g.h} ${g.s}% 60%)`,hi:`hsl(${g.h} ${g.s}% 84%)`});
      }
      for(let k=0;fxRoom()>0&&k<(reduce?1:crumble?(s.tier===1?0:s.star?4:s.tier>=3?3:2):s.star?4:s.big?3:1);k++){   // a few bright specks per gem ((7.5) a crumbled single line drops its pieces only)
        const a=Math.random()*6.283,sp=2+Math.random()*4;
        shards.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-2,r:cell*(.05+Math.random()*.08),life:1});
      }
      shatters.splice(i,1); continue;
    }
    const p=s.t/POP, e=easeOutCubic(p);
    if(crumble&&!s.star){                                // (7.5) cracks run through the gem and it shudders, a little brighter, about to break
      const jx=p>.4?(Math.random()-.5)*cell*.05:0;
      gem(s.gi,bx+s.c*cell+jx,by+s.r*cell,cell,1,1,0.25*e);
      crack(s,bx+s.c*cell+jx,by+s.r*cell,Math.min(1,p*1.6));
    } else if(squash&&!s.star){                                 // thins to a bright sliver along the line, stretching slightly into it
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

  if(CFG.FX_STAR_BURST && !reduce && tray.some(t=>t&&t.s.star)){   // (4.5b) a soft ring on the best cell(s), so she need not count
    const sb=starBest(grid), k=0.5+0.5*Math.sin(now*0.006);
    for(const [r,c] of sb.cells){
      const x=bx+(c+.5)*cell, y=by+(r+.5)*cell;
      ctx.globalAlpha=0.35+0.4*k; ctx.strokeStyle='#fff'; ctx.lineWidth=Math.max(1.5,cell*0.07);
      ctx.beginPath(); ctx.arc(x,y,cell*(0.3+0.12*k),0,6.283); ctx.stroke();
      star(x,y,cell*0.2,0.35+0.4*k);
    }
    ctx.globalAlpha=1;
  }
  drawRubble(dt);                                    // (7.5) the broken pieces: over the board and its gems, under the tray and the held piece
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
    if(s.star && CFG.FX_STAR_BURST){                                     // (4.5b) its reach, drawn through it: a beam along the whole slot each way
      const cx=ox+tc/2, cy=oy+tc/2, ph=reduce?0.5:0.5+0.5*Math.sin(now*0.005+i), hh=(now*0.05)%360;
      const hb=ctx.createLinearGradient(R.x,0,R.x+R.w,0), vb=ctx.createLinearGradient(0,R.y,0,R.y+R.h);
      for(const gr of [hb,vb]){
        gr.addColorStop(0,'rgba(255,255,255,0)'); gr.addColorStop(.3,`hsla(${hh} 100% 75% / ${0.35+0.3*ph})`);
        gr.addColorStop(.5,`rgba(255,255,255,${0.8+0.2*ph})`); gr.addColorStop(.7,`hsla(${(hh+120)%360} 100% 75% / ${0.35+0.3*ph})`);
        gr.addColorStop(1,'rgba(255,255,255,0)');
      }
      const th=Math.max(2,tc*0.12);
      ctx.fillStyle=hb; ctx.fillRect(R.x,cy-th/2,R.w,th);
      ctx.fillStyle=vb; ctx.fillRect(cx-th/2,R.y,th,R.h);
    }
    const pulse=s.star&&!reduce?1+0.08*Math.sin(now*0.004+i*2):1;         // star breathes gently
    let tp=1, trSrc;                                                     // tray flips after the board, staggered per slot
    if(flip){
      const delay=FLIP_WAVE+FLIP_CELL+FLIP_GAP+i*FLIP_STAGGER;
      tp=clamp((flip.t-delay)/FLIP_TRAY,0,1);
      if(tp<1){ const half=tp<0.5; if(half) trSrc={big:flip.fromBig,small:flip.fromSmall}; }
    }
    const tsq=tp<1?(tp<0.5?1-tp*2:(tp-0.5)*2):1;
    for(const [dr,dc] of s.cells)
      gem(t.gi,ox+dc*tc,oy+dr*tc,tc,pulse*tsq,stuck?0.3:1,gold?goldShimmer(now,s,dr,dc):0,true,pulse,trSrc);
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
    b.t+=dt*0.017*(b.k||1);
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
  if(goldenCele&&goldenCele.f) edgeGlow('255,206,72',Math.min(1,goldenCele.f*1.3));
  if(goldRain.length){                               // the golden rain: only in the margins above and below the board
    for(let i=goldRain.length-1;i>=0;i--){
      const p=goldRain[i]; p.t+=dt; if(p.t<0) continue;
      p.y+=p.vy*dt;
      if(p.y>p.lim){ goldRain.splice(i,1); continue; }
      star(p.x,p.y,p.r*(1+0.3*Math.sin(p.t*0.3)),p.a,i%3?'#FFD45C':'#FFF3B0');
    }
  }
  if(CFG.FX_SWEEP_FX) stepConfetti(dt);
  stepOrbs(now,dt);
  stepDeal(); stepPending();                                        // the next tray, a slice at a time, after this frame's drawing
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

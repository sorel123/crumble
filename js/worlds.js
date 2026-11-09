// Crumble — Gems, worlds, themes, ambient particles, world flip.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
const GEMS=[
  {h:344,s:88},{h: 32,s:96},{h:150,s:72},
  {h:188,s:85},{h:226,s:88},{h:278,s:82},
  {h: 47,s:100,gold:true},                // golden hands only — never dealt in a normal tray
  {h:255,s:30,star:true}                  // star gem only
];
const GOLD=6, STAR_GI=7, NCOLOR=6;        // NCOLOR = the ordinary colours dealt at random

/* ═══════ worlds — Home (picked) + Transformations (earned) ═══════
   A world is a background gradient + an ambient particle effect, drawn
   behind the board. HOME_WORLDS are always available; she picks one plus
   a tile skin on the start screen — that's the look for the whole run.
   TRANSFORMS are temporary: an achievement swaps both the world AND the
   tile skin for a few placements (see genGolden.. no — see place()/
   triggerTransform below), then flips back. The first time one triggers,
   its world is 'discovered' and joins the home picker; its tile skin
   stays event-only and is never independently selectable.            */
const HOME_WORLDS=[
  {id:'night',   name:'Night',          top:'#1B0E30', bottom:'#0E0719', effect:'none'},
  {id:'ocean',   name:'Ocean',          top:'#0A3A52', bottom:'#041F30', effect:'bubbles'},
  {id:'sunset',  name:'Sunset',         top:'#4A1E3D', bottom:'#22091C', effect:'embers'},
  {id:'aurora',  name:'Aurora',         top:'#0C2E28', bottom:'#081526', effect:'ribbons'},
  {id:'forest',  name:'Forest',         top:'#0E2A18', bottom:'#071409', effect:'fireflies'},
  {id:'arctic',  name:'Arctic',         top:'#1C3A4A', bottom:'#0B1E2A', effect:'snowfall'},
  {id:'blossom', name:'Cherry Blossom', top:'#3A1E2E', bottom:'#1C0E18', effect:'petals'},
  {id:'reef',    name:'Reef',           top:'#063440', bottom:'#021820', effect:'rays'},
  {id:'desert',  name:'Desert Night',   top:'#2A1B12', bottom:'#140D08', effect:'shootingstars'},
  {id:'neon',    name:'Neon City',      top:'#1A0B2E', bottom:'#05030C', effect:'grid'}
];
const TRANSFORMS={
  rainbow:  {name:'Rainbow',    world:{top:'#4A1050',bottom:'#200828',effect:'confetti'},          skin:'rainbow'},
  goldvault:{name:'Gold Vault', world:{top:'#3A2A10',bottom:'#1A1206',effect:'sparks'},             skin:'goldvault'},
  volcano:  {name:'Volcano',    world:{top:'#4A1408',bottom:'#1A0602',effect:'embers'},             skin:'volcano'},
  starfield:{name:'Starfield',  world:{top:'#0A0A1C',bottom:'#020208',effect:'stars'},              skin:'starfield'},
  storm:    {name:'Storm',      world:{top:'#232B38',bottom:'#0C1016',effect:'storm',flash:true},   skin:'storm'}
};
const TRANSFORM_IDS=Object.keys(TRANSFORMS);
const BONUS_WORLD={top:'#3A1170',bottom:'#12062B',effect:'sparks'};   // the bonus trays' sky: deep violet, rising sparks (the board and tiles keep her look)
function worldDef(id){    // resolves a HOME_WORLDS id, a TRANSFORMS id, or 'bonus' to {top,bottom,effect,flash?}
  if(id==='bonus') return BONUS_WORLD;
  const t=TRANSFORMS[id]; if(t) return t.world;
  return HOME_WORLDS.find(w=>w.id===id) || HOME_WORLDS[0];
}
function hex2rgb(h){ const n=parseInt(h.slice(1),16); return [n>>16&255,n>>8&255,n&255]; }
/* ── themes: Night (the dark look, where each world brings its own sky) or a
   light mode. A light theme swaps the page tokens (text, buttons, overlays),
   the board panel, and the sky; worlds keep their ambient effects, and a
   transformation still takes over the sky while it lasts. */
const THEMES=[
  {id:'night',    name:'Night'},
  {id:'daylight', name:'Daylight',     light:true, top:'#EEF6FF', bot:'#C6DCF6', panel:'rgba(255,255,255,.62)', stroke:'rgba(40,70,120,.14)', slot:'rgba(60,100,170,.11)', ink:'#22324F'},
  {id:'cotton',   name:'Cotton Candy', light:true, top:'#FFEAF4', bot:'#E3D6FF', panel:'rgba(255,255,255,.58)', stroke:'rgba(120,70,150,.14)', slot:'rgba(150,90,175,.11)', ink:'#4B2B61'},
  {id:'mint',     name:'Mint',         light:true, top:'#EAFFF7', bot:'#C4ECDD', panel:'rgba(255,255,255,.58)', stroke:'rgba(30,100,80,.14)', slot:'rgba(40,120,95,.11)', ink:'#1D4A3D'},
  {id:'paper',    name:'Paper',        light:true, top:'#FFF4DE', bot:'#EED6A6', panel:'rgba(214,180,128,.95)', stroke:'rgba(90,55,20,.28)', slot:'rgba(90,55,20,.17)', ink:'#5A3A17'},
  // Classic: the steel-blue sky / navy board of the arcade block games — light sky, but white UI text like Night
  {id:'classic',  name:'Classic',      light:true, whiteInk:true, top:'#7E9FBA', bot:'#587A97', panel:'rgba(40,54,76,.97)', stroke:'rgba(255,255,255,.10)', slot:'rgba(255,255,255,.065)', ink:'#FFFFFF'}
];
const theme=()=>THEMES.find(t=>t.id===CFG.THEME)||THEMES[0];
const rgba=(hex,a)=>{ const [r,g,b]=hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function bgOf(id){                      // the sky: a light theme's own gradient, except during a transformation
  const t=theme(); return t.light&&!TRANSFORMS[id]&&id!=='bonus'?{top:t.top,bottom:t.bot}:worldDef(id);
}
function applyTheme(){
  const t=theme(), st=document.documentElement.style;
  const v=t.whiteInk?{                                            // Classic: Night's white UI on its own sky
    '--bg':t.bot, '--glow':'rgba(255,255,255,.25)', '--btn':'rgba(20,32,50,.28)', '--chip':'rgba(20,32,50,.28)', '--divider':'rgba(255,255,255,.18)',
    '--overlay':`radial-gradient(120% 90% at 50% 40%,${rgba('#3B4F6B',.86)},${rgba('#22304A',.97)})`
  }:t.light?{
    '--bg':t.bot, '--fg':t.ink, '--btn':rgba(t.ink,.08), '--chip':'rgba(255,255,255,.55)', '--chip-line':rgba(t.ink,.16),
    '--ghost-line':rgba(t.ink,.3), '--sel-fg':'#9A6400', '--sel-bg':'rgba(255,196,46,.28)', '--best':'#B7790A',
    '--glow':'transparent', '--pip':rgba(t.ink,.2), '--divider':rgba(t.ink,.12), '--accent':'#E39200',
    '--overlay':`radial-gradient(120% 90% at 50% 40%,${rgba(t.top,.86)},${rgba(t.bot,.97)})`
  }:{};
  for(const k of ['--bg','--fg','--btn','--chip','--chip-line','--ghost-line','--sel-fg','--sel-bg','--best','--glow','--pip','--divider','--overlay','--accent'])
    v[k]?st.setProperty(k,v[k]):st.removeProperty(k);          // Night: fall back to the stylesheet's own values
  const mc=document.querySelector('meta[name=theme-color]'); if(mc) mc.content=t.light?t.bot:'#150B26';
  if(boardBg) buildBoardBg();
}
function lerpCol(a,b,t){
  const A=hex2rgb(a),B2=hex2rgb(b);
  return `rgb(${Math.round(A[0]+(B2[0]-A[0])*t)},${Math.round(A[1]+(B2[1]-A[1])*t)},${Math.round(A[2]+(B2[2]-A[2])*t)})`;
}

const AMBIENT_N={none:0,bubbles:22,embers:20,ribbons:5,stars:55,fireflies:16,snowfall:26,petals:16,
  rays:4,shootingstars:4,grid:14,confetti:24,sparks:18,storm:40};
function ambientParticle(effect,initial){
  switch(effect){
    case 'bubbles': return {x:Math.random()*W,y:initial?Math.random()*H:H+20,r:3+Math.random()*7,
      vy:-(0.12+Math.random()*0.28),ph:Math.random()*6.283,ps:0.01+Math.random()*0.02,a:0.12+Math.random()*0.22};
    case 'embers': return {x:Math.random()*W,y:initial?Math.random()*H:H+15,r:1.4+Math.random()*2.3,
      vy:-(0.1+Math.random()*0.2),vx:(Math.random()-.5)*0.2,ph:Math.random()*6.283,ps:0.015+Math.random()*0.02,
      a:0.25+Math.random()*0.35,hue:20+Math.random()*30};
    case 'ribbons': return {y:Math.random()*H*0.55+H*0.05,amp:26+Math.random()*38,speed:0.12+Math.random()*0.1,
      ph:Math.random()*6.283,hue:140+Math.random()*90,a:0.07+Math.random()*0.06,w:2+Math.random()*2};
    case 'stars': return {x:Math.random()*W,y:Math.random()*H,r:0.5+Math.random()*1.5,
      ph:Math.random()*6.283,ps:0.02+Math.random()*0.05,a:0.35+Math.random()*0.5};
    case 'fireflies': return {x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*0.15,vy:(Math.random()-.5)*0.15,
      ph:Math.random()*6.283,ps:0.02+Math.random()*0.03,r:1.5+Math.random()*1.8,a:0.3+Math.random()*0.4};
    case 'snowfall': return {x:Math.random()*W,y:initial?Math.random()*H:-10,r:1.5+Math.random()*2.5,
      vy:0.3+Math.random()*0.5,ph:Math.random()*6.283,ps:0.01+Math.random()*0.02,a:0.3+Math.random()*0.4};
    case 'petals': return {x:Math.random()*W,y:initial?Math.random()*H:-10,vy:0.35+Math.random()*0.4,
      vx:(Math.random()-.3)*0.3,rot:Math.random()*6.283,vr:(Math.random()-.5)*0.03,
      w:4+Math.random()*3,h:2.5+Math.random()*2,a:0.4+Math.random()*0.35};
    case 'rays': return {x:Math.random()*W,ph:Math.random()*6.283,speed:0.15+Math.random()*0.1,
      w:W*0.12+Math.random()*W*0.08,a:0.05+Math.random()*0.05};
    case 'shootingstars': return {x:-50,y:Math.random()*H*0.4,vx:0,vy:0,life:0,wait:40+Math.random()*200};
    case 'grid': return {y:Math.random()*H,hue:280+Math.random()*40,a:0.1+Math.random()*0.08};
    case 'confetti': return {x:Math.random()*W,y:initial?Math.random()*H:-10,vy:0.5+Math.random()*0.6,
      vx:(Math.random()-.5)*0.3,rot:Math.random()*6.283,vr:(Math.random()-.5)*.08,
      w:4+Math.random()*3,h:6+Math.random()*4,hue:Math.random()*360,a:0.5+Math.random()*0.3};
    case 'sparks': return {x:Math.random()*W,y:initial?Math.random()*H:H+10,r:1+Math.random()*1.6,
      vy:-(0.15+Math.random()*0.2),ph:Math.random()*6.283,ps:0.02+Math.random()*0.02,a:0.3+Math.random()*0.3};
    case 'storm': return {x:Math.random()*W,y:initial?Math.random()*H:-10,vy:3+Math.random()*2,
      len:10+Math.random()*8,a:0.2+Math.random()*0.15};
    default: return {};
  }
}
function spawnAmbient(effect){
  const n=AMBIENT_N[effect]||0, out=[];
  for(let i=0;i<n;i++) out.push(ambientParticle(effect,true));
  return out;
}
// advances/draws one particle set; alphaMul crossfades it in or out, respawn=false lets a dying set drain away
function stepAmbient(list,effect,dt,boost,alphaMul,respawn){
  if(alphaMul<=0) return;
  for(let i=list.length-1;i>=0;i--){
    const p=list[i];
    if(effect==='bubbles'){
      p.y+=p.vy*dt*boost; p.ph+=p.ps*dt*boost;
      if(p.y<-20){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      const x=p.x+Math.sin(p.ph)*6;
      ctx.globalAlpha=p.a*alphaMul; ctx.strokeStyle='rgba(255,255,255,.8)'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.arc(x,p.y,p.r,0,6.283); ctx.stroke();
      ctx.globalAlpha=p.a*alphaMul*0.35; ctx.fillStyle='rgba(180,230,255,1)'; ctx.fill();
    } else if(effect==='embers'||effect==='sparks'){
      p.y+=p.vy*dt*boost; p.x+=(p.vx||0)*dt*boost+Math.sin(p.ph)*0.15; p.ph+=p.ps*dt*boost;
      if(p.y<-15){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      ctx.globalAlpha=p.a*alphaMul;
      ctx.fillStyle=effect==='sparks'?'hsl(46 95% 65%)':`hsl(${p.hue} 90% 62%)`;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.283); ctx.fill();
    } else if(effect==='ribbons'){
      p.ph+=p.speed*dt*boost*0.02;
      ctx.globalAlpha=alphaMul; ctx.strokeStyle=`hsla(${p.hue} 80% 65% / ${p.a})`; ctx.lineWidth=p.w;
      ctx.beginPath();
      for(let x=0;x<=W;x+=16){ const y=p.y+Math.sin(x*0.012+p.ph)*p.amp; x===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }
      ctx.stroke();
    } else if(effect==='stars'){
      p.ph+=p.ps*dt*boost;
      const tw=0.6+0.4*Math.sin(p.ph);
      ctx.globalAlpha=p.a*tw*alphaMul; ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(boost>1.3?1.6:1),0,6.283); ctx.fill();
    } else if(effect==='fireflies'){
      p.x+=p.vx*dt*boost; p.y+=p.vy*dt*boost; p.ph+=p.ps*dt*boost;
      if(p.x<-10)p.x=W+10; if(p.x>W+10)p.x=-10; if(p.y<-10)p.y=H+10; if(p.y>H+10)p.y=-10;
      const tw=0.4+0.6*Math.max(0,Math.sin(p.ph));
      ctx.globalAlpha=p.a*tw*alphaMul; ctx.fillStyle='hsl(70 90% 65%)';
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.283); ctx.fill();
    } else if(effect==='snowfall'){
      p.y+=p.vy*dt*boost; p.ph+=p.ps*dt*boost;
      if(p.y>H+10){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      const x=p.x+Math.sin(p.ph)*10;
      ctx.globalAlpha=p.a*alphaMul; ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(x,p.y,p.r,0,6.283); ctx.fill();
    } else if(effect==='petals'){
      p.y+=p.vy*dt*boost; p.x+=p.vx*dt*boost; p.rot+=p.vr*dt*boost;
      if(p.y>H+10){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.globalAlpha=p.a*alphaMul; ctx.fillStyle='#FFB6D5';
      ctx.beginPath(); ctx.ellipse(0,0,p.w,p.h,0,0,6.283); ctx.fill(); ctx.restore();
    } else if(effect==='rays'){
      p.ph+=p.speed*dt*boost*0.01;
      const x=p.x+Math.sin(p.ph)*30;
      const g=ctx.createLinearGradient(x-p.w/2,0,x+p.w/2,0);
      g.addColorStop(0,'rgba(180,230,255,0)'); g.addColorStop(.5,`rgba(180,230,255,${p.a*alphaMul})`); g.addColorStop(1,'rgba(180,230,255,0)');
      ctx.fillStyle=g; ctx.fillRect(x-p.w/2,0,p.w,H);
    } else if(effect==='shootingstars'){
      if(p.life<=0){
        p.wait-=dt*boost;
        if(p.wait<=0){ p.x=Math.random()*W*0.3; p.y=Math.random()*H*0.25; p.vx=4+Math.random()*3; p.vy=2+Math.random()*1.5; p.life=1; }
      } else {
        p.x+=p.vx*dt*boost; p.y+=p.vy*dt*boost; p.life-=dt*0.025*boost;
        if(p.life<=0||p.x>W+50){ p.life=0; p.wait=40+Math.random()*200; p.x=-50; }
        else{
          ctx.globalAlpha=alphaMul*Math.min(1,p.life*2); ctx.strokeStyle='#fff'; ctx.lineWidth=1.6;
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-p.vx*4,p.y-p.vy*4); ctx.stroke();
        }
      }
    } else if(effect==='grid'){
      p.y-=0.4*dt*boost; if(p.y<0) p.y=H;
      ctx.globalAlpha=p.a*alphaMul; ctx.strokeStyle=`hsl(${p.hue} 90% 65%)`; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(0,p.y); ctx.lineTo(W,p.y); ctx.stroke();
    } else if(effect==='confetti'){
      p.y+=p.vy*dt*boost; p.x+=p.vx*dt*boost; p.rot+=p.vr*dt*boost;
      if(p.y>H+10){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.globalAlpha=p.a*alphaMul; ctx.fillStyle=`hsl(${p.hue} 90% 65%)`;
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    } else if(effect==='storm'){
      p.y+=p.vy*dt*boost;
      if(p.y>H+20){ if(respawn) Object.assign(p,ambientParticle(effect,false)); else{ list.splice(i,1); continue; } }
      ctx.globalAlpha=p.a*alphaMul; ctx.strokeStyle='rgba(200,220,255,.8)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-2,p.y+p.len); ctx.stroke();
    }
  }
  ctx.globalAlpha=1;
}

/* ── flip transition: a diagonal card-flip wave across the board, then the
   tray, swapping from one world+skin to another. All timings in frames
   (~60/s). Skipped (snapped instantly) under prefers-reduced-motion.    */
const FLIP_WAVE=28, FLIP_CELL=16, FLIP_GAP=6, FLIP_STAGGER=5, FLIP_TRAY=14;
const FLIP_BG_DUR=FLIP_WAVE+FLIP_CELL;
const FLIP_TOTAL=FLIP_WAVE+FLIP_CELL+FLIP_GAP+2*FLIP_STAGGER+FLIP_TRAY;
function resetWorld(){
  curWorld=CFG.HOME_WORLD; curSkin=CFG.STYLE;
  buildCache();                     // curSkin may have just changed (a fresh run can follow a skin pick)
  ambient=spawnAmbient(worldDef(curWorld).effect); ambientOld=[]; ambientBurst=0;
  bgFrom=curWorld; bgT=1; flip=null; transform=null; transformCool=0; lightningT=0;
  renderPips();
}
function startFlip(toWorld,toSkin){
  if(reduce){                                    // snap straight there, no animation
    curWorld=toWorld; curSkin=toSkin; buildCache();
    ambient=spawnAmbient(worldDef(curWorld).effect); ambientOld=[];
    bgFrom=curWorld; bgT=1; flip=null; return;
  }
  bgFrom=curWorld; bgT=0; ambientOld=ambient;
  const fromBig=gemBig, fromSmall=gemSmall;        // snapshot the outgoing tile textures
  curWorld=toWorld; curSkin=toSkin;
  buildCache();                                    // rebuild gemBig/gemSmall to the target now
  ambient=spawnAmbient(worldDef(curWorld).effect);
  flip={t:0,fromBig,fromSmall};
}
// the bonus trays' sky: only the background and its particles change, over ~BONUS_SKY_FRAMES; her tiles are never touched
const BONUS_SKY_FRAMES=70;
function startSky(toWorld){
  if(reduce){ curWorld=toWorld; ambient=spawnAmbient(worldDef(toWorld).effect); ambientOld=[]; bgFrom=toWorld; bgT=1; return; }
  bgFrom=curWorld; bgT=0; ambientOld=ambient; curWorld=toWorld; ambient=spawnAmbient(worldDef(toWorld).effect);
}
function stepFlip(dt){
  if(!flip){ if(bgT<1){ bgT=Math.min(1,bgT+dt/BONUS_SKY_FRAMES); if(bgT>=1) ambientOld=[]; } return; }
  flip.t+=dt;
  if(bgT<1){ bgT=Math.min(1,flip.t/FLIP_BG_DUR); if(bgT>=1) ambientOld=[]; }
  if(flip.t>=FLIP_TOTAL) flip=null;
}

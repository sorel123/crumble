// Crumble — the front menu's showpiece (plan 8.3).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* The start card (launch with no saved run) and the mode menu (Home after a game, or the mode chip) share one look:
     a gem logo   CRUMBLE spelled in her own gem skin (Crum in colours, ble in gold): the tiles drop in one by one when the
                  menu opens, then a ripple and a glint run along them every few seconds; tap a tile and it flips
     the crumb    the mascot (7.5f) perched on the last tile: it blinks, watches where she taps, hops when the logo lands,
                  smirks when poked
     the sky      the journey sky (7.5b) travelling dawn -> day -> golden hour -> night -> aurora -> space and round again,
                  a stage every SKY_HOLD ms, drawn instead of the blurred board (frame() skips the board, tray and effects)
     the buttons  a big Play, then Adventure / Daily / Goals / Settings as a 2x2 of tiles with her progress on each
   Cost: the sky is the same cached plate blit as in a game (two during a wipe); the logo and crumb are DOM, animated with
   CSS / Web Animations on transform and opacity only. The overlay drops its backdrop blur, so the menu is cheaper to draw
   than the old blurred card. Reduced motion: no drops, ripples, flips or sky travel; the sky stays on one stage. */
const HOME_WORD=[['C',0],['R',1],['U',2],['M',3],['B',GOLD],['L',GOLD],['E',GOLD]];   // letter, gem
const SKY_HOLD=4200;                                   // ms each sky stage stays before the next wipes in
const hero={el:null,tiles:[],crumb:null,pp:null,gems:null,card:null,up:false,
            sky:0,skyAt:0,wipe:null,amb:[],ambOld:[],from:0,blinkAt:0,act:'',actUntil:0};

function homeInit(){
  const h=document.createElement('div'); h.className='hero';
  const logo=document.createElement('div'); logo.className='logo'; logo.setAttribute('role','img'); logo.setAttribute('aria-label','Crumble');
  const rows=[document.createElement('div'),document.createElement('div')]; rows[0].className='lr'; rows[1].className='lr r2'; logo.append(...rows);
  HOME_WORD.forEach(([ch,gi],i)=>{
    const t=document.createElement('span'); t.className='lt'+(gi===GOLD?' gold':''); t.style.setProperty('--i',i); t.setAttribute('aria-hidden','true');
    t.innerHTML='<span class="lf"><canvas></canvas><b></b></span>'; t.style.setProperty('--r',[-3,2,-2,3,2,-3,2][i]+'deg'); t.querySelector('b').textContent=ch;
    t.onclick=e=>{ e.stopPropagation(); homeTapTile(i); };
    rows[i<4?0:1].append(t); hero.tiles.push(t);
  });
  const c=document.createElement('div'); c.id='heroCrumb'; c.className='idle'; c.setAttribute('aria-hidden','true');
  c.innerHTML='<div class="mb">'+MASCOT_SVG+'</div>';
  c.onclick=e=>{ e.stopPropagation(); homeCrumbAct('smug',1300); };
  h.append(logo,c);
  hero.el=h; hero.crumb=c; hero.pp=c.querySelector('.pp');
  el('menuSettings').onclick=e=>{ e.stopPropagation(); openSettings(); };
  // the crumb watches where she touches the menu
  for(const id of ['startCard','menuCard']) el(id).addEventListener('pointerdown',e=>homeLook(e.clientX,e.clientY));
}

const homeCard=()=>!el('startCard').hidden?el('startCard'):!el('menuCard').hidden?el('menuCard'):null;
// the tiles' faces: her skin's gem sprites, redrawn when the skin (or the screen) changes
function homeTiles(){
  hero.gems=gemBig;
  const px=Math.round(hero.tiles[0].offsetWidth*Math.min(devicePixelRatio||1,3))||132;
  for(let i=0;i<hero.tiles.length;i++){
    const cv=hero.tiles[i].querySelector('canvas'), src=gemBig[HOME_WORD[i][1]];
    cv.width=cv.height=px;
    if(src){ const x=cv.getContext('2d'); x.clearRect(0,0,px,px); x.drawImage(src,0,0,px,px); }
  }
}
function homeStats(){
  const k=[], st=streakNow();
  if(best) k.push('<span>👑 Best '+best.toLocaleString()+'</span>');
  if(st) k.push('<span>🔥 '+st+(st===1?' day':' days')+'</span>');
  return k.join('');
}
function homeFill(card){                               // the words on the card: her best, her streak, each mode's progress
  const today=daily.d[dailyKey()], liveD=peekRun('daily'), st=streakNow();
  const advS=advStars()?'Level '+nextLevel().id+' · ★ '+advStars():'Goal levels, no timer';
  const dayS=liveD&&liveD.dk===dailyKey()?'Today: in progress':today?'Today: best '+today.s:'New board today';
  const golS=st?'🔥 '+st+(st===1?' day':' days')+' in a row':'Streak and unlocks';
  const stats=homeStats(), sEl=card.querySelector('.homeStats');
  sEl.innerHTML=stats; sEl.hidden=!stats;
  if(card.id==='startCard'){
    el('startAdvSub').textContent=advS; el('startDailySub').textContent=dayS; el('startGoalsSub').textContent=golS;
    el('startHow').hidden=!!(best||stats);           // the how-to is for her first game; after that the stats take its place
  } else {
    el('menuClose').textContent=state==='play'?'Back to the game':'Back';
  }
}
function homeEnter(card){
  hero.card=card; card.querySelector('.heroSlot').append(hero.el);
  if(hero.crumb.parentNode!==hero.el){ hero.crumb.style.cssText=''; hero.el.append(hero.crumb); }   // back from crumbling with the logo
  homeFill(card);
  if(hero.gems!==gemBig) homeTiles();                  // after it is in the page, so the tiles have a size
  el('stage').classList.add('homeUp');
  const now=performance.now();
  hero.skyAt=now; hero.wipe=null;
  if(!hero.amb.length) hero.amb=spawnAmbient(worldDef(JOURNEY[hero.sky].id).effect);
  hero.blinkAt=now+1800;
  if(reduce) return;
  hero.tiles.forEach((t,i)=>{                          // the drop: each tile falls in, squashes, settles
    t.firstChild.animate([
      {transform:'translateY(-160px) rotate('+(i%2?8:-8)+'deg)',opacity:0},
      {transform:'translateY(4px) scale(1.12,.84)',opacity:1,offset:.62},
      {transform:'translateY(-5px) scale(.96,1.05)',offset:.8},
      {transform:'none',opacity:1}],{duration:560,delay:90+i*75,easing:'cubic-bezier(.45,0,.6,1)',fill:'backwards'});
  });
  hero.crumb.firstChild.animate([                      // the crumb drops onto the last tile once it has landed
    {transform:'translateY(-220px)',opacity:0},
    {transform:'translateY(2px) scale(1.14,.82)',opacity:1,offset:.6},
    {transform:'translateY(-14%) scale(.94,1.06)',offset:.8},
    {transform:'none',opacity:1}],{duration:620,delay:90+HOME_WORD.length*75+120,easing:'cubic-bezier(.45,0,.6,1)',fill:'backwards'});
  homeCrumbAct('hop',900,90+HOME_WORD.length*75+520,false);
}
function homeLeave(){ el('stage').classList.remove('homeUp'); hero.card=null; }
function homeTapTile(i){
  homeLook(...homeCenter(hero.tiles[i]));
  try{ Sfx.place(1+i%3); }catch(e){}
  if(reduce) return;
  hero.tiles[i].firstChild.animate([
    {transform:'none'},{transform:'translateY(-26px) rotate(180deg) scale(1.1)',offset:.45},
    {transform:'translateY(3px) rotate(360deg) scale(1.1,.88)',offset:.85},{transform:'rotate(360deg)'}],{duration:620,easing:'ease-out'});
  if(i===HOME_WORD.length-1) homeCrumbAct('hop',900);  // the crumb rides the last tile
}
function homeCenter(n){ const r=n.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; }
function homeLook(x,y){                                // the pupils turn towards a touch (quantised, like the game's crumb)
  if(!hero.card) return;
  const [cx,cy]=homeCenter(hero.crumb), dx=x-cx, dy=y-cy, d=Math.hypot(dx,dy)||1;
  hero.pp.setAttribute('transform','translate('+Math.round(dx/d*1.3*4)/4+','+Math.round(dy/d*1.1*4)/4+')');
  clearTimeout(homeLook.t); homeLook.t=setTimeout(()=>hero.pp.setAttribute('transform','translate(.3,.5)'),1600);
}
function homeCrumbAct(name,ms,delay=0,move=true){     // a face for `ms` (and its movement, unless the crumb is landing)
  const a=MASCOT_ACT[name], now=performance.now();
  hero.act=name; hero.actFrom=now+delay; hero.actUntil=now+delay+ms;
  if(move&&a&&a.move&&!reduce) hero.crumb.firstChild.animate(a.move,{duration:a.dur,delay,easing:'ease-out'});
}
// frame() calls this before it draws anything: true while a home card is up, after painting the menu's sky
function homeFrame(now,dt){
  const card=homeCard();
  if(card!==hero.card){ if(card) homeEnter(card); else homeLeave(); }
  if(!card) return false;
  if(hero.gems!==gemBig) homeTiles();                  // a new skin picked in Settings over the menu
  // the crumb's face: a class swap only when it changes
  const blink=now>=hero.blinkAt&&now<hero.blinkAt+130;
  if(now>=hero.blinkAt+130) hero.blinkAt=now+2200+mascotRnd()*3000;
  const act=hero.act&&now>=hero.actFrom&&now<hero.actUntil?hero.act:'idle';
  const key=act+(blink&&act==='idle'?' blink':'')+(reduce?' rm':'');
  if(hero.crumb.className!==key) hero.crumb.className=key;
  // the sky: one stage, then the next wipes down from the top
  if(!reduce&&!hero.wipe&&now-hero.skyAt>SKY_HOLD){
    hero.from=hero.sky; hero.sky=(hero.sky+1)%JOURNEY.length; hero.skyAt=now;
    hero.ambOld=hero.amb; hero.amb=spawnAmbient(worldDef(JOURNEY[hero.sky].id).effect); hero.wipe={t:0,dur:90};
  }
  const to=JOURNEY[hero.sky].id;
  if(hero.wipe){
    const w=hero.wipe, from=JOURNEY[hero.from].id; w.t+=dt;
    const u=Math.min(1,w.t/w.dur), e=u<0.5?2*u*u:1-2*(1-u)*(1-u), fe=H*0.16, y=e*(H+fe)-fe;
    ctx.drawImage(skyPlate(from),0,0,W,H); stepAmbient(hero.ambOld,worldDef(from).effect,dt,1,1,false);
    if(y>0){ ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,y); ctx.clip(); ctx.drawImage(skyPlate(to),0,0,W,H); stepAmbient(hero.amb,worldDef(to).effect,dt,1,1,true); ctx.restore(); }
    const c=bgOf(to), mid=lerpCol(c.top,c.bottom,clamp(y/H,0,1)), g=ctx.createLinearGradient(0,y,0,y+fe);
    g.addColorStop(0,mid); g.addColorStop(1,mid.replace('rgb','rgba').replace(')',',0)'));
    ctx.fillStyle=g; ctx.fillRect(0,y,W,fe);
    ctx.globalAlpha=0.3*Math.sin(Math.PI*u); ctx.drawImage(wipeBand(),0,y-fe*0.2,W,fe); ctx.globalAlpha=1;
    if(u>=1){ hero.wipe=null; hero.ambOld=[]; }
  } else {
    ctx.drawImage(skyPlate(to),0,0,W,H); stepAmbient(hero.amb,worldDef(to).effect,dt,1,1,true);
  }
  return true;
}
/* Play: the logo crumbles. Each tile (gem and letter) is cut into four shards that burst out and fall over the opening
   board, the crumb tumbles down with them, and the game starts underneath at once (nothing waits on the effect).
   One-off DOM in a layer over the stage, removed when it has fallen. Reduced motion: the menu simply closes. */
function homeCrumble(){
  if(reduce||!hero.card) return;
  const st=el('stage'), sr=st.getBoundingClientRect(), fx=document.createElement('div'); fx.className='crumbleFx';
  const dp=Math.min(devicePixelRatio||1,2), anims=[];
  hero.tiles.forEach((t,i)=>{
    const r=t.getBoundingClientRect(), w=r.width, src=t.querySelector('canvas'), b=t.querySelector('b'), cs=getComputedStyle(b);
    const face=document.createElement('canvas'); face.width=face.height=Math.round(w*dp);   // the tile as she sees it: gem, then letter
    const x=face.getContext('2d'); x.scale(dp,dp); x.drawImage(src,0,0,w,w);
    x.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily; x.textAlign='center'; x.textBaseline='middle';
    const gold=t.classList.contains('gold');
    x.fillStyle=gold?'rgba(255,250,220,.7)':'rgba(40,14,60,.55)'; x.fillText(b.textContent,w/2,w/2+(gold?0:1)+1);
    x.fillStyle=cs.color; x.fillText(b.textContent,w/2,w/2);
    const h=w/2;
    for(let q=0;q<4;q++){
      const qx=q%2, qy=q>>1, c=document.createElement('canvas'); c.width=c.height=Math.round(h*dp);
      c.getContext('2d').drawImage(face,qx*h*dp,qy*h*dp,h*dp,h*dp,0,0,c.width,c.height);
      c.style.cssText='left:'+(r.left-sr.left+qx*h)+'px;top:'+(r.top-sr.top+qy*h)+'px;width:'+h+'px;height:'+h+'px';
      fx.append(c);
      const dx=(qx?1:-1)*(14+mascotRnd()*46)+(i-3)*6, up=30+mascotRnd()*50, fall=sr.height-r.top+60+mascotRnd()*80, rot=(qx?1:-1)*(90+mascotRnd()*260);
      anims.push(c.animate([{transform:'none',opacity:1},
        {transform:'translate('+dx*.45+'px,'+(-up)+'px) rotate('+rot*.3+'deg)',opacity:1,offset:.25},
        {transform:'translate('+dx+'px,'+fall+'px) rotate('+rot+'deg)',opacity:.85}],
        {duration:820+mascotRnd()*260,delay:i*45+q*12,easing:'cubic-bezier(.35,0,.75,.6)',fill:'both'}));
    }
  });
  const cr=hero.crumb.getBoundingClientRect();             // the crumb rides the fall
  hero.crumb.style.cssText='position:absolute;left:'+(cr.left-sr.left)+'px;top:'+(cr.top-sr.top)+'px;right:auto';
  hero.crumb.className='hop'; fx.append(hero.crumb);
  anims.push(hero.crumb.animate([{transform:'none'},{transform:'translate(-10px,-46px) rotate(-90deg)',offset:.3},
    {transform:'translate(-40px,'+(sr.height-cr.top+40)+'px) rotate(-540deg)'}],
    {duration:1100,delay:200,easing:'cubic-bezier(.35,0,.75,.6)',fill:'both'}));
  st.append(fx);
  hero.falling=true;
  Promise.all(anims.map(a=>a.finished))   // only ours: the crumb's breathing loops forever
    .catch(()=>{}).then(()=>{
    fx.remove(); hero.falling=false;
    if(hero.crumb.parentNode!==hero.el){ hero.crumb.getAnimations().forEach(a=>a.cancel()); hero.crumb.style.cssText=''; hero.el.append(hero.crumb); }
  });
}
homeInit();
/* crumble.win: in a browser (never inside the app) the start card links to the iPhone app once CFG.APP_STORE_ID is set. */
(()=>{ const a=el('storeLink'); if(!a||!CFG.APP_STORE_ID||Native.on()) return; a.href='https://apps.apple.com/app/id'+CFG.APP_STORE_ID; a.hidden=false; })();

// Crumble — Game logic, Blast Round, input.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ game logic ═══════ */
const empty=()=>Array.from({length:N},()=>Array(N).fill(null));
function canPlace(s,r,c,g){
  if(r<0||c<0||r+s.rows>N||c+s.cols>N) return false;
  for(const [dr,dc] of s.cells) if(g[r+dr][c+dc]) return false;
  return true;
}
function fitsAnywhere(s,g){
  for(let r=0;r<=N-s.rows;r++) for(let c=0;c<=N-s.cols;c++) if(canPlace(s,r,c,g)) return true;
  return false;
}
function linesFor(g){
  const rows=[],cols=[];
  for(let r=0;r<N;r++) if(g[r].every(v=>v)) rows.push(r);
  for(let c=0;c<N;c++){let f=true;for(let r=0;r<N;r++) if(!g[r][c]){f=false;break;} if(f) cols.push(c);}
  return {rows,cols};
}
function mobility(){
  let n=0; for(const s of SHAPES) if(fitsAnywhere(s,grid)) n++;
  return n/SHAPES.length;
}

// ═══ transformations — achievement-triggered event looks (own world + own tile skin) ═══
function triggerTransform(id){
  if(!special('transform') || blast || trayNo<CFG.SPECIAL_FROM_TRAY) return;    // a Blast Round owns the screen while it runs
  if(!transform && transformCool>0) return;   // quiet period after one ends — makes the next feel earned
  const first=!discoveredWorlds.has(id);
  transform={id,remaining:CFG.TRANSFORM_PLACEMENTS};
  startFlip(id,TRANSFORMS[id].skin);
  Sfx.transformShift();
  if(first){ discoveredWorlds.add(id); saveSkinSave(); renderWorlds(); }
  pushBanner(TRANSFORMS[id].name.toUpperCase(),first?'New world discovered!':'×'+CFG.TRANSFORM_MULT+' SCORE');
  renderPips();
}
function endTransform(){
  transform=null;
  transformCool=CFG.TRANSFORM_COOLDOWN;
  startFlip(CFG.HOME_WORLD,CFG.STYLE);
  renderPips();
}
/* ═══════ the specials (plan 4.5) ═══════
   One switch each in CFG.SPECIALS. Rules shared by all of them: never in trays 1-5, at most one live at a time,
   and never two in a row (the tray right after one ends carries none). specialOk() is that gate. */
const special=name=>!!(CFG.SPECIALS&&CFG.SPECIALS[name]);
const specialLive=()=>!!(blast||transform||golden||tray.some(t=>t&&t.s.star));
const specialOk=()=>trayNo>=CFG.SPECIAL_FROM_TRAY && !specialLive() && trayNo>specialEnd+1;

/* ═══════ Blast Round (plan 4.5a): a reward she starts herself ═══════
   Combos charge the ⚡ Blast button under the tray: a clear at combo 2+ adds min(combo-1, BLAST_CHARGE_MAX), one
   small spark flies from the clear into the button, and nothing ever drains it. Full, it glows (one chime) and waits
   for as long as she likes, through trays and save/resume. Tapping it starts a BLAST_SECONDS round: its own look
   (hot magenta sky, rainbow gems, a light racing round the board), its own sting, big-piece sweep/jackpot hands,
   ×BLAST_MULT points, +BLAST_ADD s per line. The clock waits while a hand is dealt, while Settings is open and
   while the app is hidden. A round never ends her run: stuck mid-round, the hand is swapped (twice at most), then
   the round ends early. At 0 s a results card shows points, lines, best combo and her Best Blast. */
let blastCharge=0, blastShown=0, specialEnd=-99;  // charge (saved); what the button shows (catches up as sparks land); tray a special last ended in
let blastIntro=null, blastSparks=[];               // the start effect; sparks flying to the button
function blastBtnCentre(){
  const r=el('blastBtn').getBoundingClientRect(), c=cvs.getBoundingClientRect();
  return {x:r.left-c.left+r.width/2, y:r.top-c.top+r.height/2};
}
function chargeBlast(n,x,y){                       // place(): a combo clear at (x,y) adds n
  if(!special('blast')||blast||trayNo<CFG.SPECIAL_FROM_TRAY||blastCharge>=CFG.BLAST_CHARGE) return;
  n=Math.min(n,CFG.BLAST_CHARGE-blastCharge);
  blastCharge+=n;
  if(reduce||el('blastBtn').hidden) landSpark(n);
  else blastSparks.push({x0:x,y0:y,t:0,n});
}
function landSpark(n){                             // a spark reached the button (or there was no flight)
  const was=blastShown>=CFG.BLAST_CHARGE;
  blastShown=Math.min(blastCharge,blastShown+n);
  if(!was && blastShown>=CFG.BLAST_CHARGE) Sfx.blastReady();   // the one chime; after that it only glows
  syncBlastBtn();
}
const blastReady=()=>blastCharge>=CFG.BLAST_CHARGE;
// tappable right now: full, nothing else live, not mid-deal, mid-drag, stuck or paused
const canBlast=()=>special('blast')&&blastReady()&&!blast&&state==='play'&&!paused&&!dealing&&!drag&&!stuck&&specialOk();
function syncBlastBtn(){
  const b=el('blastBtn'), on=special('blast')||!!blast;
  b.hidden=!on||(stuck&&!blast);                  // stuck shows End run instead (no room for four buttons)
  const f=blast?clamp(blast.t/(CFG.BLAST_SECONDS*1000),0,1):clamp(blastShown/CFG.BLAST_CHARGE,0,1);
  b.style.setProperty('--f',f.toFixed(3));
  const full=!blast&&blastShown>=CFG.BLAST_CHARGE;
  const held=full&&specialLive();                  // full but another special is on (a star in the tray): it reads as disabled until that is over
  b.classList.toggle('full',full&&!held); b.classList.toggle('live',!!blast); b.classList.toggle('held',held);
  b.disabled=!(full&&state==='play')||held;
  b.setAttribute('aria-label',blast?'Blast round running':held?'Blast waits until the star gem is used':full?'Start a Blast round':'Blast: combos charge it');
}
el('blastBtn').onclick=e=>{                         // full but not right now (the tray after a special, mid-deal): a small "not yet" shake
  e.stopPropagation();
  if(canBlast()) return startBlast();
  const b=el('blastBtn'); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
};
function startBlast(){
  if(blast) return;
  blastCharge=0; blastShown=0; blastSparks=[]; undoSnap=null;   // Undo can never give the charge back or replay the round
  blast={t:CFG.BLAST_SECONDS*1000,pts:0,lines:0,best:0,swaps:0,tick:0};
  stats.blasts++;
  startFlip('blast','rainbow');
  blastIntro={t:0};
  shake=Math.max(shake,10*CFG.SHAKE); glowT=1.8; glowH=320;
  Sfx.blastStart();
  hesVoid(); dealLater();                           // the leftover pieces are replaced by a blast hand (pickups wait for it)
  syncActions();
}
function endBlast(){
  const b=blast; blast=null; specialEnd=trayNo;
  const newBest=b.pts>stats.bestBlast;
  stats.bestBlast=Math.max(stats.bestBlast,b.pts);
  startFlip(transform?transform.id:CFG.HOME_WORLD,transform?TRANSFORMS[transform.id].skin:CFG.STYLE);
  Sfx.blastEnd();
  showBlastCard(b,newBest);
  syncActions(); saveRun();
}
// the results card: a reward moment, not a modal. Tap anywhere (or wait) and play goes on.
let blastCardT=0;
function showBlastCard(b,newBest){
  if(state!=='play') return;
  paused=true; drag=null;
  el('bcPts').textContent='+'+b.pts.toLocaleString();
  el('bcLines').textContent=b.lines+(b.lines===1?' line':' lines');
  el('bcCombo').textContent=b.best>=2?'· best combo ×'+b.best:'';
  el('bcBest').textContent=newBest&&b.pts>0?'NEW BEST BLAST!':'Best Blast '+stats.bestBlast.toLocaleString();
  el('bcBest').classList.toggle('new',newBest&&b.pts>0);
  el('blastCard').hidden=false;
  clearTimeout(blastCardT); blastCardT=setTimeout(hideBlastCard,8000);
}
function hideBlastCard(){
  clearTimeout(blastCardT);
  if(el('blastCard').hidden) return;
  el('blastCard').hidden=true; paused=false;
  checkStuck();                                     // the leftover blast pieces may not fit the board she has now
}
el('blastCard').addEventListener('pointerdown',e=>{ e.stopPropagation(); hideBlastCard(); });
// the round's timer, as a bar by the board (the button drains with it too)
function drawBlastBar(now){
  if(!blast) return;
  const above=by-hudH>=26, h=6, y=above?by-14:by+B+10, x0=bx+4, w=B-8;
  const f=clamp(blast.t/(CFG.BLAST_SECONDS*1000),0,1);
  const urgent=blast.t<5000, pulse=0.5+0.5*Math.sin(now*(urgent?0.02:0.006));
  roundPath(ctx,x0,y,w,h,h/2); ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fill();
  const g=ctx.createLinearGradient(x0,0,x0+w,0);
  g.addColorStop(0,'#FF7BD5'); g.addColorStop(1,urgent?'#FF3B3B':'#FFB020');
  ctx.save(); roundPath(ctx,x0,y,w,h,h/2); ctx.clip();
  ctx.fillStyle=g; ctx.globalAlpha=0.75+0.25*pulse; ctx.fillRect(x0,y,w*f,h);
  ctx.globalAlpha=0.35*pulse; ctx.fillStyle='#fff'; ctx.fillRect(x0+w*f-10,y,10,h);   // glowing tip
  ctx.restore(); ctx.globalAlpha=1;
  ctx.font='700 11px "Fredoka",Verdana,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillStyle='#FF9DE3';
  ctx.fillText('BLAST  '+Math.max(0,Math.ceil(blast.t/1000))+'s',x0,above?y-4:y+h+13);
}
// Blast's own effects, drawn in the foreground layer and never over the board's gems: two lights racing round the
// board's rim while a round runs, "BLAST!" slamming into the gap above the board, 3-2-1 there at the end, and the
// charge sparks (one small particle each, combo clears only) flying from the clear into the button.
function stepBlastFx(now,dt){
  if(blast && !reduce){
    const per=4*(B+18), seg=per*0.12, off=(now*0.0006%1)*per*(blast.t<5000?2:1);
    ctx.save(); roundPath(ctx,bx-9,by-9,B+18,B+18,20);
    ctx.setLineDash([seg,per/2-seg]); ctx.lineDashOffset=-off;
    ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=4; ctx.stroke();
    ctx.strokeStyle='rgba(255,123,213,.5)'; ctx.lineWidth=12; ctx.stroke();
    ctx.restore();
  }
  const gapY=hudH+(by-hudH)*0.52, fs=Math.round(Math.min(W*0.13,(by-hudH)*0.62,58));
  if(blastIntro){
    const p=blastIntro; p.t+=dt;
    if(p.t>=70||reduce) blastIntro=null;
    else{
      const pin=Math.min(1,p.t/7), out=p.t>58?(p.t-58)/12:0;
      const sp=sprite('blastword|'+fs, textW('BLAST!',fs)+fs, fs*1.5, x=>
        outlined(x,'BLAST!',fs,vgrad(x,-fs*0.5,fs*0.5,[[0,'#FFFFFF'],[0.35,'#FF9DE3'],[1,'#FF4FB8']]),[[fs*0.34,'rgba(255,176,32,.5)'],[fs*0.16,'rgba(40,6,30,.95)']]));
      blit(sp,W/2,gapY,(2.4-1.4*easeOutBack(pin))*(1+0.3*out),Math.min(1,pin*2)*(1-out));
    }
  } else if(blast && blast.t>0 && blast.t<=3000){   // 3, 2, 1: each number pops in and shrinks away
    const n=Math.ceil(blast.t/1000), k=1-(blast.t/1000-(n-1));   // 0 -> 1 over each second
    const sp=sprite('blastnum|'+n+'|'+fs, fs*1.4, fs*1.5, x=>
      outlined(x,String(n),fs,vgrad(x,-fs*0.5,fs*0.5,[[0,'#FFFFFF'],[0.4,'#FFE66B'],[1,'#FF7A3D']]),[[fs*0.16,'rgba(40,6,30,.95)']]));
    blit(sp,W/2,gapY,reduce?1:1.4-0.5*easeOutCubic(Math.min(1,k*3)),reduce?1:1-Math.max(0,k-0.7)/0.3);
  }
  if(blastSparks.length){
    const T=blastBtnCentre();
    for(let i=blastSparks.length-1;i>=0;i--){
      const s=blastSparks[i]; s.t+=dt/36;                     // ~0.6 s to the button
      if(s.t>=1){ blastSparks.splice(i,1); landSpark(s.n); continue; }
      const u=easeInOutQuad(s.t), v=1-u, cx=(s.x0+T.x)/2+cell*1.5, cy=Math.min(s.y0,T.y)-cell;
      const x=v*v*s.x0+2*v*u*cx+u*u*T.x, y=v*v*s.y0+2*v*u*cy+u*u*T.y, r=cell*0.13;
      ctx.globalAlpha=0.45; ctx.fillStyle='#FF9DE3'; ctx.beginPath(); ctx.arc(x,y,r*2,0,6.283); ctx.fill();
      ctx.globalAlpha=1; ctx.fillStyle='#FFF4C2'; ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.fill();
    }
  }
}
function stepBlast(now,dt){
  if(!blast || state!=='play' || paused || document.hidden) return;   // hidden: iOS may still run a frame or two
  if(blast.t>0 && !dealing) blast.t-=dt*16.67;      // the clock waits while her next hand is being dealt (she can't pick up)
  const sec=Math.ceil(blast.t/1000);
  if(sec<=3 && sec>=1 && sec!==blast.tick){ blast.tick=sec; Sfx.blastTick(sec); }
  if(blast.t<=0 && !drag) endBlast();               // a drag in flight finishes first
  else if(Math.round(now/250)!==stepBlast.q){ stepBlast.q=Math.round(now/250); syncBlastBtn(); }   // the button drains with the clock (4×/s is plenty)
}
function renderPips(){
  const box=el('transformPips'), n=CFG.TRANSFORM_PLACEMENTS;
  if(!transform){ box.hidden=true; return; }
  box.hidden=false;
  if(box.dataset.n!==String(n)){                    // n pips, then the multiplier label
    box.innerHTML=''; box.dataset.n=n;
    for(let i=0;i<n;i++) box.append(document.createElement('div'));
    const m=document.createElement('span'); m.className='mult'; box.append(m);
  }
  const kids=[...box.children];
  for(let i=0;i<n;i++) kids[i].className='pip'+(i<transform.remaining?' on':'');
  kids[n].textContent='×'+CFG.TRANSFORM_MULT;
}
/* the golden hand's payoff (4.5c): the biggest celebration in the game. A gold wash behind the board and glow on the
   screen edges, sparkles on the empty cells and a rain in the margins above and below the board (never across a gem),
   a long shake, a layered sting. All cosmetic, so the next tray is dealt as usual (about 1.5 s). */
function goldenCelebrate(full,mult,extra){
  pushBanner(full?'GOLDEN HAND COMPLETE':'GOLDEN ×'+(+mult.toFixed(1)),(full?'×'+(+mult.toFixed(1))+'  ':'')+'+'+extra);
  const fx=CFG.FX_GOLDEN_FANFARE;
  if(full){
    if(fx) goldenCele={t:0,full:true};
    for(let k=0;k<5;k++) waves.push({x:W/2,y:by+B/2,t:-k*0.14});
    shake=Math.max(shake,18*CFG.SHAKE); glowT=2.2;
    Sfx.goldenWin(); Sfx.goldenGong();
    if(fx&&!reduce){
      goldenSparkle(18);
      for(let k=Math.min(70,fxRoom());k>0;k--){
        const top=k%2===0;
        goldRain.push({x:W*(0.03+0.94*Math.random()),y:top?-6-Math.random()*by*0.4:by+B+6,lim:top?by-6:H+8,vy:2.2+Math.random()*3.2,r:cell*(0.1+Math.random()*0.16),t:-Math.random()*45,a:0.7+Math.random()*0.3});
      }
    }
  } else {                                             // partial credit: a smaller version
    if(fx) goldenCele={t:0,full:false};
    for(let k=0;k<2;k++) waves.push({x:W/2,y:by+B/2,t:-k*0.14});
    if(fx&&!reduce) goldenSparkle(6);
    glowT=1.3; Sfx.goldenIn();
  }
  glowH=GEMS[GOLD].h;
}
function goldenSparkle(n){                             // twinkles only on empty cells, so nothing ever sits over a gem
  const free=[]; for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(!grid[r][c]) free.push([r,c]);
  for(let k=0;k<n&&free.length;k++){ const [r,c]=free.splice((Math.random()*free.length)|0,1)[0];
    sparkles.push({x:bx+(c+.2+Math.random()*.6)*cell,y:by+(r+.2+Math.random()*.6)*cell,t:Math.random()*0.5}); }
}
function place(idx,r,c){
  noteUndo();                                      // the state just before this placement, for the one-move Undo (save.js)
  // countdown first, on whatever was already active — a fresh trigger below overrides this placement's result
  if(transform){ transform.remaining--; if(transform.remaining<=0) endTransform(); }
  const t=tray[idx],s=t.s;
  const bump=CFG.FX_LAND_BUMP&&!reduce;
  if(!s.star) s.cells.forEach(([dr,dc])=>{ grid[r+dr][c+dc]={gi:t.gi,t:1,f:1,l:bump?1:0}; });   // f = a brief glint, l = the landing thump; a star leaves no gem
  if(bump){                                        // the thump: a ring spreads out from under the piece, dust kicks out sideways
    const px=bx+c*cell, py=by+r*cell, pw=s.cols*cell, ph=s.rows*cell;
    rings.push({x:px,y:py,w:pw,h:ph,t:0});
    for(let k=Math.min(6,fxRoom())-1;k>=0;k--){
      const left=k%2===0, yy=py+ph-cell*0.15-Math.random()*ph*0.5;
      dust.push({x:left?px+cell*0.1:px+pw-cell*0.1,y:yy,vx:(left?-1:1)*(1.2+Math.random()*2),vy:-(0.4+Math.random()*1.2),r:cell*(0.05+Math.random()*0.05),life:1});
    }
  }
  tray[idx]=null;
  if(!s.star) Sfx.place(s.n);
  let starGems=0, starMs=0;                        // the star (4.5b): gems its cross takes, and its own timing
  if(s.star){ starGems=starAt(r,c); specialEnd=trayNo; stats.starSeen=1; starMs=CFG.FX_STAR_BURST&&!reduce?CFG.STAR_CHARGE:0; }

  let rows,cols;
  if(s.star){                                     // its whole row and column, full or not (each counts if it held a gem)
    rows=grid[r].some(v=>v)?[r]:[];
    cols=grid.some(row=>row[c])?[c]:[];
  } else ({rows,cols}=linesFor(grid));
  const total=rows.length+cols.length;
  let gained=s.n, swept=false;
  hesPlace(total>0);                               // the hesitation log (save.js): the tray's first drop, timed

  if(s.star){
    blasts.push({r,c,t:-starMs*0.06});               // the beams fire after the charge (b.t runs 0.06 per frame)
    waves.push({x:bx+(c+.5)*cell,y:by+(r+.5)*cell,t:-starMs*0.026});
    for(let k=0;!reduce&&k<10;k++){
      const along=Math.random()*B, onRow=k%2===0;
      sparkles.push({x:onRow?bx+along:bx+(c+.5)*cell,y:onRow?by+(r+.5)*cell:by+along,t:Math.random()*0.5});
    }
    if(starGems>0) Sfx.star(starGems);
  }

  if(total>0){
    ambientBurst=1;
    const loud=combo+1>=CFG.BIG_COMBO;                // combo is bumped just below; this clear's own number
    if(CFG.FX_PUNCH_ZOOM && !reduce && loud && total>=2) punchT=1;
    hitWait=reduce?0:s.star?starMs:CFG.CLEAR_BLINK;                 // shake + punch hold until the blink turns into the pop
    if(s.star && total>=2) triggerTransform('starfield');
    combo++; trayCombo=Math.max(trayCombo,combo);
    if(combo>=2) chargeBlast(Math.min(combo-1,CFG.BLAST_CHARGE_MAX),bx+(c+s.cols/2)*cell,by+(r+s.rows/2)*cell);   // only combos charge Blast
    if(blast) blast.best=Math.max(blast.best,combo);
    if(special('star') && combo>=CFG.STAR_COMBO) starForced=true;
    if(combo>=5) triggerTransform('volcano');
    if(combo>=7) triggerTransform('storm');
    gained+=Math.round(CFG.LINE_POINTS*total*total*(1+(combo-1)*CFG.COMBO_STEP));
    if(s.star) gained=s.n+Math.max(gained-s.n,Math.round(CFG.STAR_PER_GEM*starGems*(1+(combo-1)*CFG.COMBO_STEP)));   // a star pays per gem
    if(s.star&&starGems>0) pushBanner('STAR BLAST',starGems+(starGems===1?' gem':' gems'),'#E6D8FF');
    if(!s.star){                                   // a star gets its own cross-shaped blast instead
      const st=-(reduce?0:CFG.CLEAR_BLINK)*0.16;        // sweeps start with the pop, not the blink
      rows.forEach(r2=>sweeps.push({horiz:true,idx:r2,t:st}));
      cols.forEach(c2=>sweeps.push({horiz:false,idx:c2,t:st}));
    }

    const cr=r+s.rows/2, cc0=c+s.cols/2;         // where the piece landed: the clear radiates out from here
    const colorsBefore=new Set();                 // for COLOR GONE: which colours the board held, piece included
    for(let rr=0;rr<N;rr++) for(let cc=0;cc<N;cc++) if(grid[rr][cc]) colorsBefore.add(grid[rr][cc].gi);
    const marked=new Map();                       // value: true = part of a row (collapses vertically), false = column only
    rows.forEach(r2=>{for(let i=0;i<N;i++) marked.set(r2+','+i,true);});
    cols.forEach(c2=>{for(let i=0;i<N;i++) if(!marked.has(i+','+c2)) marked.set(i+','+c2,false);});
    let lastGi=t.gi, cleared=0, maxDelay=0; const cellsGone=[];
    marked.forEach((horiz,key)=>{
      const [rr,cc]=key.split(',').map(Number);
      const g=grid[rr][cc]; if(!g) return;
      lastGi=g.gi; cleared++;
      // optional blink, then the collapse ripples outward from the placed piece
      const d=Math.hypot(rr+0.5-cr,cc+0.5-cc0);
      const delay=s.star?starMs+d*(reduce?0:CFG.STAR_STAGGER):(reduce?0:CFG.CLEAR_BLINK)+d*CFG.CLEAR_STAGGER;   // a star's cross lights up from the star outward after its charge
      maxDelay=Math.max(maxDelay,delay);
      cellsGone.push([rr,cc,delay]);
      shatters.push({r:rr,c:cc,gi:g.gi,horiz,star:!!s.star,t:-delay,t0:-delay,ox:bx+cc0*cell,oy:by+cr*cell});
      if(CFG.FX_SCORE_ORBS && loud && !reduce) orbs.push({x:bx+(cc+.5)*cell,y:by+(rr+.5)*cell,gi:g.gi,t:-(delay+5)/60,
        dir:Math.atan2(rr+0.5-cr,cc+0.5-cc0),trail:[]});
      grid[rr][cc]=null;
    });
    if(CFG.FX_SCORE_ORBS && loud && !reduce) scoreHold=Math.max(scoreHold,performance.now()+(maxDelay+5)/60*1000+ORB_MS*0.8);
    // COLOR GONE — a clear that wipes the last of a colour off the board
    const colorsAfter=new Set();
    for(let rr=0;rr<N;rr++) for(let cc=0;cc<N;cc++) if(grid[rr][cc]) colorsAfter.add(grid[rr][cc].gi);
    const gone=[...colorsBefore].filter(gi=>!colorsAfter.has(gi));
    let colorBonus=0;
    if(loud && gone.length && colorsAfter.size>0 && CFG.COLOR_GONE_BONUS>0){
      colorBonus=Math.round(CFG.COLOR_GONE_BONUS*gone.length*(1+(combo-1)*0.25));
      gained+=colorBonus;
      bands.push({t:-(maxDelay+8),txt:gone.length>1?gone.length+' COLORS GONE!':'COLOR GONE!',sub:'+'+colorBonus,
        hues:gone.map(gi=>GEMS[gi].h)});
      if(!reduce) for(let k=0;k<gone.length+1;k++) spawnFirework(bx+B*(0.2+0.6*Math.random()),by+B*(0.15+0.4*Math.random()),null,maxDelay+10+k*5);
    }
    // the point value on every cleared cell, rippling out with the collapse
    if(CFG.FX_CELL_TAGS && !reduce && cleared){
      const per=Math.max(1,Math.round((gained-s.n-colorBonus)/cleared));
      cellsGone.forEach(([rr,cc,delay])=>tags.push({x:bx+(cc+.5)*cell,y:by+(rr+.5)*cell,txt:String(per),t:-(delay+4)}));
    }
    // the headline: COMBO n slams in under the board centre, with fireworks; bigger streak = bigger word
    if(CFG.FX_COMBO_SLAM && loud){
      slams.length=0;
      slams.push({t:-(reduce?0:maxDelay+7),txt:'COMBO '+combo,n:combo});
      if(!reduce) for(let k=0;k<Math.min(5,1+combo);k++) spawnFirework(bx+B*(0.15+0.7*Math.random()),by+B*(0.1+0.5*Math.random()),null,maxDelay+7+k*4);
      if(combo>=3) borderFlash={t:-(maxDelay+7),col:combo>=5?'255,123,213':'255,212,92'};
    } else if(!reduce && loud) spawnFirework(bx+cc0*cell,by+Math.min(cr,N-1.5)*cell,null,maxDelay+6);   // even a single clear gets a burst

    waves.push({x:bx+cc0*cell,y:by+cr*cell,t:-(reduce?0:CFG.CLEAR_BLINK)*0.07});
    glowT=1; glowH=GEMS[lastGi].h;
    if(!s.star){                                   // each cleared line flares in the colour it was cleared with
      const k=Math.min(1.7,0.8+0.3*total);
      const ft=-(reduce?0:CFG.CLEAR_BLINK)*0.075;
      rows.forEach(r2=>lineFlashes.push({horiz:true,idx:r2,t:ft,hue:glowH,k}));
      cols.forEach(c2=>lineFlashes.push({horiz:false,idx:c2,t:ft,hue:glowH,k}));
    }
    shake=Math.min(11,3.5+total*1.8)*CFG.SHAKE;
    if(s.star){ shake=Math.max(shake,12*CFG.SHAKE); if(!reduce) borderFlash={t:-starMs,col:'235,225,255'}; }
    const beat=(s.star?starMs:reduce?0:CFG.CLEAR_BLINK)/60+.02;                        // lands as the blink turns into the pop
    if(combo>1) Sfx.combo(combo,total,beat); else Sfx.clear(total,beat);
    // the points number sits high on the board's right side, clear of the COMBO slam and the COLOR GONE band
    const slammed=CFG.FX_COMBO_SLAM&&loud;
    const popY=slammed?by+cell*1.2:by+cr*cell, popX=slammed?bx+B-cell*1.6:bx+cc0*cell;
    pops.push({x:popX,y:popY,t:-(reduce?0:CFG.CLEAR_BLINK)*0.026,txt:'+'+(gained-s.n),
               sub:slammed?'':combo>1?'COMBO ×'+combo:(total>1?total+' LINES':''),combo,lines:total});

    // clean sweep — board completely emptied
    let anyLeft=false;
    for(let rr=0;rr<N&&!anyLeft;rr++) for(let cc=0;cc<N;cc++) if(grid[rr][cc]){anyLeft=true;break;}
    if(!anyLeft){
      const bonus=CFG.SWEEP_BONUS+cleared*CFG.SWEEP_PER_GEM;
      gained+=bonus;
      swept=true; trayHadSweep=true;
      ambientBurst=1.8;
      if(CFG.FX_SWEEP_FX){ sweepFxT=1; spawnConfetti(); }
      pushBanner('CLEAN SWEEP','+'+bonus);         // the achievement first, then the world it earns
      triggerTransform('rainbow');
      for(let k=0;k<4;k++) waves.push({x:W/2,y:by+B/2,t:-k*0.18});
      shake=16*CFG.SHAKE; glowT=1.6;
      Sfx.sweep();
      tension=0;
    }
    if(!swept&&!(s.star&&starGems>0)) praise(total,combo);   // a star has its own STAR BLAST banner
    tension=Math.max(0,tension-CFG.TENSION_DOWN);
    if(blast){ blast.t=Math.min(CFG.BLAST_SECONDS*1000,blast.t+total*CFG.BLAST_ADD*1000+(swept?5000:0)); blast.lines+=total; }
  } else {
    combo=0;
    tension=Math.min(1,tension+CFG.TENSION_UP);
  }

  tension=Math.min(1,tension+(1-mobility())*CFG.TENSION_DRIFT);

  if(golden){
    const planned=golden.plan?golden.plan.ids:[], hitPlan=[...rows,...cols.map(c2=>8+c2)].some(id=>planned.includes(id));
    golden.got.lines+=total; if(swept) golden.got.sweep=true;
    golden.pts+=gained;
    if(tray.every(v=>!v)){
      const {hit:full,mult}=goldenResult(golden);
      if(mult>1){                                      // any clear pays at least the partial multiplier
        const extra=Math.round(golden.pts*(mult-1));
        gained+=extra;
        goldenCelebrate(full,mult,extra);
      }
      specialEnd=trayNo; golden=null;                  // a miss costs nothing; the hand just ends (and the next tray carries no special)
    } else {
      goldenReplan();                                  // the glow always names lines that can still be completed with the pieces left
      if(total>0&&CFG.FX_GOLDEN_FANFARE){              // a step toward it: the cleared lines flare gold and a note rises
        const ft=-(reduce?0:CFG.CLEAR_BLINK)*0.075;
        rows.forEach(r2=>lineFlashes.push({horiz:true,idx:r2,t:ft,hue:47,k:1.4}));
        cols.forEach(c2=>lineFlashes.push({horiz:false,idx:c2,t:ft,hue:47,k:1.4}));
        if(hitPlan) Sfx.goldenStep(Math.min(golden.got.lines,6));
      }
    }
  }
  if(transform) gained=Math.round(gained*CFG.TRANSFORM_MULT);
  if(blast){ gained=Math.round(gained*CFG.BLAST_MULT); blast.pts+=gained; }
  updateDbg(); renderPips();

  score+=gained;                                     // the HUD counts up to it (frame)
  if(!bestBeaten && best>0 && score>best){           // the run just became her best: celebrate it now, not at game over
    bestBeaten=true;
    pushBanner('NEW BEST!','',"#8FF7FF");
    if(!reduce){ spawnConfetti(); for(let k=0;k<3;k++) waves.push({x:W/2,y:by+B/2,t:-k*0.15}); }
    glowT=Math.max(glowT,1.4); Sfx.praise(3);
  }
  if(tray.every(v=>!v) && !dealing){                // (a Blast Round that just started is already dealing its own hand)
    goldenNext = special('golden') && goldenCool<=0 && !transform      // a live transformation already is the moment
      && (trayHadSweep || trayCombo>=CFG.GOLDEN_COMBO || Math.random()<CFG.GOLDEN_CHANCE);
    trayHadSweep=false; trayCombo=0;
    dealLater();
  }
  stats.placed++; stats.lines+=total; stats.bestCombo=Math.max(stats.bestCombo,combo); if(swept) stats.sweeps++;
  if(!dealing){ checkStuck(); saveRun(); }            // otherwise checked and saved once the new tray is dealt
}
const anyFits=()=>tray.some(v=>v&&fitsAnywhere(v.s,grid));
// Stuck (plan 3.2): while Undo or a Rescue can get her out, the run waits for her (pieces dim, "No moves", End run offered).
// Only when neither is left does it end by itself, after 700 ms so the last drop finishes landing; the timer re-checks.
function checkStuck(){
  stuck=!anyFits();
  if(stuck&&blast&&!dealing){                       // a Blast Round never ends her run: swap in a fresh hand, twice at most, then end the round
    stuck=false;
    if(blast.swaps<2){ blast.swaps++; dealLater(); syncActions(); return; }
    blast.t=0; syncActions(); return;               // stepBlast ends it (results card); hiding the card checks again
  }
  syncActions();
  if(stuck&&!canExit()) setTimeout(()=>{ if(!dealing&&!anyFits()&&!canExit()) gameOver(); },700);
}

/* The next tray is dealt after the clear has started, not inside the drop (plan 2.2). Choosing a hand
   is the most expensive thing the game does (~5-15 ms; more for a Blast Round hand), and it used to run
   in the same input event as the clear, so the clear's first frame was the slowest frame of the game.
   Now the deal waits one frame, then runs in slices of DEAL_SLICE_MS at the end of each frame until it
   is done (a few frames; the same search as dealing it in one go). Pickups wait for it. */
let dealing=null;                                     // {it: dealSteps() generator, wait: frames before it starts}
function dealLater(){ if(!dealing) dealing={it:dealSteps(),wait:1}; }
function stepDeal(){
  if(!dealing) return;
  if(dealing.wait>0){ dealing.wait--; return; }
  const end=performance.now()+CFG.DEAL_SLICE_MS;
  let r;
  do r=dealing.it.next(); while(!r.done && performance.now()<end);
  if(r.done){ dealing=null; checkStuck(); syncActions(); saveRun(); }
}
function cancelDeal(){ if(dealing){ dealing.it.return(); dealing=null; } }   // a new run or a rescue deals its own tray

/* ═══════ input ═══════ */
// a tray piece's cell size: as big as trayCell allows, but a 5-long bar still fits its slot
const trayFit=s=>Math.min(trayCell,(B/3)*0.9/s.cols,trayH*0.9/s.rows);
function slotRect(i){ const w=B/3; return {x:bx+w*i,y:trayY,w,h:trayH}; }
// The drag. One rule decides everything the player sees and gets (plan 2.1, "one finger, one destination"):
//  - only the pointer that picked the piece up moves or drops it (a second finger changes nothing);
//  - the landing slot is the nearest valid board spot within MAGNET_REACH cells of where the floating piece
//    is, per axis, kept until it drifts MAGNET_HOLD past that (no flicker at the edge);
//  - with a slot the piece is drawn seated in it and the lines it would clear light up; release puts it
//    exactly there. Without one there is no ghost, it floats, and release sends it back to the tray.
// drag.slot is that one answer: frame() draws from it and onUp() places from it.
function onDown(e){
  if(state!=='play'||paused||drag||dealing||(blast&&blast.t<=0)) return;   // one drag at a time (a second finger can't pick up another piece); none while a tray is being dealt
  ac();
  for(let i=0;i<3;i++){
    const R=slotRect(i);
    if(tray[i]&&e.clientX>=R.x&&e.clientX<=R.x+R.w&&e.clientY>=R.y-12&&e.clientY<=R.y+R.h+12){
      const s0=tray[i].s;
      drag={i,id:e.pointerId,x:e.clientX,y:e.clientY,g:(CFG.FX_PICKUP_GROW&&!reduce)?0:1,s0:trayFit(s0)/cell,
            slot:null,snapK:0,sx:0,sy:0};             // snapK: 0 floating .. 1 seated; sx/sy: the seat being eased into
      updateSlot(); hesPick();
      Sfx.pickup(); if(tray[i]&&tray[i].s.star) Sfx.starPick(); return;
    }
  }
}
function onMove(e){
  if(!drag||paused||e.pointerId!==drag.id) return;
  drag.x=e.clientX; drag.y=e.clientY;
  updateSlot();
}
function onUp(e){
  if(!drag||paused||e.pointerId!==drag.id) return;
  const t=tray[drag.i];
  if(t){
    updateSlot();                                     // the same answer the last frame drew (the finger hasn't moved since)
    if(drag.slot) place(drag.i,drag.slot.r,drag.slot.c);
    else sendBack();
  }
  drag=null;
}
function onCancel(e){                                 // iOS took the touch away (a system gesture): the piece goes home
  if(!drag||e.pointerId!==drag.id) return;
  if(tray[drag.i]) sendBack();
  drag=null;
}
function sendBack(){
  const s=tray[drag.i].s, R=slotRect(drag.i), p=drawnPos(), ts=trayFit(s);
  ret={i:drag.i,t:0,fx:p.x-(s.cols*cell)/2,fy:p.y-(s.rows*cell)/2,fs:cell,
       tx:R.x+(R.w-s.cols*ts)/2,ty:R.y+(R.h-s.rows*ts)/2,ts};
  Sfx.deny();
}
// Where the floating piece's centre is: exactly at the finger sideways, and LIFT cells between the finger
// and the piece's bottom edge, so every piece sits the same height above the thumb. The lift eases in
// with the pickup grow (drag.g) — that is the only motion between the finger and the floating piece.
function floatPos(){
  const s=tray[drag.i].s;
  return {x:drag.x, y:drag.y-cell*CFG.LIFT*easeOutCubic(drag.g)-s.rows*cell/2};
}
// Where the piece is drawn: the float, or the seat, blended by snapK (the seat/unseat ease).
function drawnPos(){
  const f=floatPos(), k=drag.snapK;
  return k<=0?f:{x:f.x+(drag.sx-f.x)*k, y:f.y+(drag.sy-f.y)*k};
}
function updateSlot(){
  const t=tray[drag.i]; if(!t){ drag.slot=null; return; }
  const s=t.s, f=floatPos();
  const fc=(f.x-s.cols*cell/2-bx)/cell, fr=(f.y-s.rows*cell/2-by)/cell;   // the piece's top-left, in fractional cells
  const reach=CFG.MAGNET_REACH, cheb=(r,c)=>Math.max(Math.abs(r-fr),Math.abs(c-fc)), eu=(r,c)=>Math.hypot(r-fr,c-fc);
  let best=null, bd=Infinity;
  for(let r=Math.ceil(fr-reach);r<=Math.floor(fr+reach);r++)
    for(let c=Math.ceil(fc-reach);c<=Math.floor(fc+reach);c++){
      const d=eu(r,c);
      if(d<bd && canPlace(s,r,c,grid)){ bd=d; best={r,c}; }
    }
  const cur=drag.slot;                                 // hysteresis: the slot it's in holds until it is clearly out of reach or clearly not the nearest
  if(cur && canPlace(s,cur.r,cur.c,grid) && cheb(cur.r,cur.c)<=reach+CFG.MAGNET_HOLD && (!best || eu(cur.r,cur.c)<=bd+CFG.MAGNET_HOLD)) return;
  drag.slot=best;
}
addEventListener('pointerdown',onDown,{passive:true});
addEventListener('pointermove',onMove,{passive:true});
addEventListener('pointerup',onUp,{passive:true});
addEventListener('pointercancel',onCancel,{passive:true});
document.addEventListener('visibilitychange',()=>{      // backgrounded mid-drag: iOS may never send the cancel
  if(document.visibilityState==='hidden'&&drag){ if(tray[drag.i]) sendBack(); drag=null; }
});

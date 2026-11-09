// Crumble — Game logic, bonus trays, input.
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

// ═══ transformations as achievements (plan 4.5d) ═══
// Four named achievements, one per special. Earning one unlocks its look for good (it joins the Settings looks, see
// LOOKS in ui.js; `discoveredWorlds` is the saved record). Three of them also start a short live transformation
// (sky + tiles, x TRANSFORM_MULT for TRANSFORM_PLACEMENTS placements) when nothing else is going on. Gold Vault never
// goes live: the golden hand's own celebration owns that moment. An achievement that cannot go live (a bonus, a golden
// hand or a star in play, a live one already, the cooldown, trays 1-5) still unlocks the look; that rule matters more
// than the sky flip. The card is only drawn over the play (a banner), it never pauses or blocks anything.
const ACHIEVE={rainbow:'Clean sweep', volcano:'Combo ×'+CFG.TRANSFORM_COMBO, starfield:'Star blast', goldvault:'Golden hand'};
let newLook=false;                                // a look was just unlocked and Settings has not been opened since (the gear's dot)
function syncLookDot(){ el('setBtn').classList.toggle('dot',newLook); }
function canGoLive(id){
  return id!=='goldvault' && !bonus && !transform && transformCool<=0 && trayNo>=CFG.SPECIAL_FROM_TRAY
    && !golden && !tray.some(t=>t&&t.s.star) && (id==='starfield'||trayNo>specialEnd+1);   // a star's own clear is its parent: it may follow it
}
function triggerTransform(id){
  if(!special('transform') || !ACHIEVE[id]) return;
  const first=!discoveredWorlds.has(id), live=canGoLive(id), name=TRANSFORMS[id].name;
  if(first){
    discoveredWorlds.add(id); newLook=true; syncLookDot(); saveSkinSave(); renderWorlds();
    if(el('lookGrid').children.length) renderLooks();
  }
  if(live){
    transform={id,remaining:CFG.TRANSFORM_PLACEMENTS};
    startFlip(id,TRANSFORMS[id].skin);
    Sfx.transformShift(); renderPips();
  }
  if(!CFG.FX_TRANSFORM_MOMENT) return;
  if(first){ pushBanner(name.toUpperCase(),'NEW LOOK UNLOCKED','#FFE9A8'); Sfx.achieve(Object.keys(ACHIEVE).indexOf(id)); }
  else if(live){ pushBanner(name.toUpperCase(),'×'+CFG.TRANSFORM_MULT+' · '+CFG.TRANSFORM_PLACEMENTS+' MOVES','#FFE9A8',1.6); }
}
function endTransform(){
  transform=null;
  transformCool=CFG.TRANSFORM_COOLDOWN; specialEnd=Math.max(specialEnd,trayNo);   // the next tray carries no special
  startFlip(CFG.HOME_WORLD,CFG.STYLE);
  renderPips();
}
/* ═══════ the specials (plan 4.5) ═══════
   One switch each in CFG.SPECIALS. Rules shared by all of them: never in trays 1-5, at most one live at a time,
   and never two in a row (the tray right after one ends carries none). specialOk() is that gate. */
const special=name=>!!(CFG.SPECIALS&&CFG.SPECIALS[name]);
const specialLive=()=>!!(bonus||transform||golden||tray.some(t=>t&&t.s.star));
const specialOk=()=>trayNo>=CFG.SPECIAL_FROM_TRAY && !specialLive() && trayNo>specialEnd+1;

/* ═══════ Bonus trays (plan 6.2, replaces the Blast Round) ═══════
   Clears fill a small meter (the chip under the board): each clear adds its lines, plus a little for a combo. When it is
   full, the next BONUS_TRAYS trays pay x BONUS_MULT, automatically: the sky shifts to violet, the board's rim pulses,
   a banner says "BONUS x2 · NEXT 3 TRAYS" and the chip counts the trays down. Nothing to tap and nothing to lose: dealing
   is the ordinary dealing and her board and tiles are untouched. When the last tray is played a small "+N bonus" tag
   shows how much the doubling added. The meter holds while a bonus runs (it does not stack) and waits, full, if another
   special is live at the deal. Golden hand (x3) stays the only other multiplier a tray can carry. */
let bonusMeter=0, specialEnd=-99, bonusTag=null;   // meter (saved); tray a special last ended in; {txt} the "+N bonus" tag after a bonus
let bonusTagT=0;
function chargeBonus(lines,comboNow){               // place(): a clear of `lines` lines at combo `comboNow`
  if(!special('bonus')||bonus||trayNo<CFG.SPECIAL_FROM_TRAY||bonusMeter>=CFG.BONUS_METER) return;
  bonusMeter=Math.min(CFG.BONUS_METER,bonusMeter+lines+Math.min(Math.max(comboNow-1,0),CFG.BONUS_COMBO_MAX));
  const c=el('bonusChip'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  if(bonusMeter>=CFG.BONUS_METER) Sfx.bonusReady();   // the one chime; after that it only glows
  syncBonusChip();
}
function syncBonusChip(){
  const c=el('bonusChip'), on=special('bonus')||!!bonus||!!bonusTag;
  c.hidden=!on||stuck;                              // stuck shows End run instead (no room for four buttons)
  const full=!bonus&&bonusMeter>=CFG.BONUS_METER;
  const f=bonus?1:clamp(bonusMeter/CFG.BONUS_METER,0,1);
  c.style.setProperty('--f',f.toFixed(3));
  c.classList.toggle('live',!!bonus); c.classList.toggle('full',full); c.classList.toggle('tag',!bonus&&!!bonusTag);
  const x='×'+CFG.BONUS_MULT;
  const txt=bonus?x+' · '+bonus.left+(bonus.left===1?' tray left':' trays left'):bonusTag?bonusTag.txt:full?x+' bonus next':x+' bonus';
  if(c.dataset.txt!==txt){ c.dataset.txt=txt; c.querySelector('.txt').textContent=txt; }
  c.setAttribute('aria-label',bonus?'Bonus: '+bonus.left+' trays left at '+x:full?'Bonus is ready, it starts with the next tray':'Bonus meter: clear lines to earn '+x+' for '+CFG.BONUS_TRAYS+' trays');
}
// deal time (solver.js, dealSteps): a full meter starts the bonus with the new tray, unless another special is live
function bonusDue(){ return special('bonus')&&!bonus&&bonusMeter>=CFG.BONUS_METER&&specialOk(); }
function startBonus(){
  if(bonus) return;
  bonusMeter=0; bonusTag=null; clearTimeout(bonusTagT);
  bonus={left:CFG.BONUS_TRAYS,extra:0};
  stats.bonuses++;
  startSky('bonus');
  pushBanner('BONUS ×'+CFG.BONUS_MULT,'NEXT '+CFG.BONUS_TRAYS+' TRAYS','#E6D8FF');
  glowT=1.5; glowH=275;
  Sfx.bonusStart();
  syncBonusChip();
}
function endBonus(){                                // place(): the last bonus tray was just emptied
  const b=bonus; bonus=null; specialEnd=trayNo;
  startSky(CFG.HOME_WORLD);
  Sfx.bonusEnd();
  if(b.extra>0){
    bonusTag={txt:'+'+b.extra.toLocaleString()+' bonus'};
    clearTimeout(bonusTagT); bonusTagT=setTimeout(()=>{ bonusTag=null; syncBonusChip(); },3000);
  }
  syncBonusChip();
}
// the rim of the board pulses while a bonus runs (drawn in the board layer, behind the gems: it only ever strokes the frame)
function drawBonusRim(now){
  const p=reduce?0.6:0.5+0.5*Math.sin(now*(bonus.left===1?0.007:0.004));
  roundPath(ctx,bx-9,by-9,B+18,B+18,20);
  ctx.strokeStyle=`rgba(176,120,255,${0.22+0.3*p})`; ctx.lineWidth=10+8*p; ctx.stroke();
  ctx.strokeStyle=`rgba(255,240,255,${0.45+0.4*p})`; ctx.lineWidth=2.5; ctx.stroke();
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
    triggerTransform('goldvault');                      // unlocks the Gold Vault look; it never flips the sky (this moment is its own)
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
  const roomBefore=paced()?roomOf(packGrid(grid)):1;   // (6.3) how cramped the board was before this drop, for the narrow escape
  const bump=CFG.FX_LAND_BUMP&&!reduce;
  if(!s.star) s.cells.forEach(([dr,dc])=>{ grid[r+dr][c+dc]={gi:t.gi,t:1,f:1,l:bump?1:0}; });   // f = a brief glint, l = the landing thump; a star leaves no gem
  if(bump){                                        // the thump: a ring spreads out from under the piece, dust kicks out sideways
    const px=bx+c*cell, py=by+r*cell, pw=s.cols*cell, ph=s.rows*cell;
    rings.push({x:px,y:py,w:pw,h:ph,t:0});
    for(let k=Math.min(3,fxRoom())-1;k>=0;k--){
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
    const single=total===1&&!s.star;                  // (6.3) the everyday clear is crisp and quiet; 2+ lines, a star or a sweep are bigger
    const wasTight=roomBefore<CFG.ROOM_EDGE;   // (6.3) for the narrow escape, judged on the board after this clear
    const loud=combo+1>=CFG.BIG_COMBO;                // combo is bumped just below; this clear's own number
    if(CFG.FX_PUNCH_ZOOM && !reduce && loud && total>=2) punchT=1;
    hitWait=reduce?0:s.star?starMs:CFG.CLEAR_BLINK;                 // shake + punch hold until the blink turns into the pop
    
    combo++; trayCombo=Math.max(trayCombo,combo);
    chargeBonus(total,combo);                      // every clear fills the bonus meter
    if(special('star') && combo>=CFG.STAR_COMBO) starForced=true;
    if(combo>=CFG.TRANSFORM_COMBO) triggerTransform('volcano');
    if(s.star && starGems>=CFG.TRANSFORM_STAR_GEMS) triggerTransform('starfield');
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
      shatters.push({r:rr,c:cc,gi:g.gi,horiz,star:!!s.star,big:!single,t:-delay,t0:-delay,ox:bx+cc0*cell,oy:by+cr*cell});
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
    if(CFG.FX_CELL_TAGS && !reduce && cleared && !single){   // a single line gets just the one score label
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

    if(!single) waves.push({x:bx+cc0*cell,y:by+cr*cell,t:-(reduce?0:CFG.CLEAR_BLINK)*0.07});
    glowT=single?0.5:1; glowH=GEMS[lastGi].h;
    if(!s.star){                                   // each cleared line flares in the colour it was cleared with
      const k=Math.min(1.7,0.8+0.3*total);
      const ft=-(reduce?0:CFG.CLEAR_BLINK)*0.075;
      if(!single){ rows.forEach(r2=>lineFlashes.push({horiz:true,idx:r2,t:ft,hue:glowH,k}));
      cols.forEach(c2=>lineFlashes.push({horiz:false,idx:c2,t:ft,hue:glowH,k})); }
    }
    shake=single?0:Math.min(11,3.5+total*1.8)*CFG.SHAKE;
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
    if(CFG.FX_NARROW_ESCAPE&&wasTight&&!swept&&roomOf(packGrid(grid))>=CFG.ROOM_EDGE){   // (6.3) a narrow escape: out of the edge or a recovery. Its own short flourish: a gold rim, two soft rings, one word
      stats.escapes=(stats.escapes|0)+1;
      if(!reduce){ borderFlash={t:-(maxDelay+4),col:'143,247,255'}; for(let k=0;k<2;k++) waves.push({x:bx+B/2,y:by+B/2,t:-(maxDelay+4)/14-k*0.2}); }
      pushBanner('PHEW!','that was close',"#8FF7FF",1.3);
    }
    if(!swept&&!(s.star&&starGems>0)) praise(total,combo);   // a star has its own STAR BLAST banner
    if(!paced()) tension=Math.max(0,tension-CFG.TENSION_DOWN);
    if(paced()&&rescuesUsed===1&&rescueLines<CFG.RESCUE_EARN_LINES&&rescueLines+total>=CFG.RESCUE_EARN_LINES)
      pushBanner('RESCUE EARNED','🛟 one more save',"#8FF7FF");   // (6.1) the second rescue is earned, not given
    rescueLines+=total;
  } else {
    combo=0;
    if(!paced()) tension=Math.min(1,tension+CFG.TENSION_UP);
  }

  if(paced()) tension+=(1-roomOf(packGrid(grid))-tension)*0.5;   // (6.1) a display value now (the border glow): how cramped the board is, eased
  else tension=Math.min(1,tension+(1-mobility())*CFG.TENSION_DRIFT);

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
  if(bonus){ const g1=gained; gained=Math.round(gained*CFG.BONUS_MULT); bonus.extra+=gained-g1; }   // (the doubling's share is what the end tag reports)
  updateDbg(); renderPips();

  score+=gained;                                     // the HUD counts up to it (frame)
  if(!bestBeaten && mode==='endless' && best>0 && score>best){           // the run just became her best: celebrate it now, not at game over
    bestBeaten=true;
    pushBanner('NEW BEST!','',"#8FF7FF");
    if(!reduce){ spawnConfetti(); for(let k=0;k<3;k++) waves.push({x:W/2,y:by+B/2,t:-k*0.15}); }
    glowT=Math.max(glowT,1.4); Sfx.praise(3);
  }
  if(tray.every(v=>!v) && !dealing){
    if(bonus){ bonus.left--; if(bonus.left<=0) endBonus(); else syncBonusChip(); }   // one bonus tray played
    goldenNext = special('golden') && goldenCool<=0 && !transform && !bonus      // a live transformation already is the moment
      && (trayHadSweep || trayCombo>=CFG.GOLDEN_COMBO || rnd()<CFG.GOLDEN_CHANCE);
    trayHadSweep=false; trayCombo=0;
    dealLater();
  }
  stats.placed++; stats.lines+=total; stats.bestCombo=Math.max(stats.bestCombo,combo); if(swept) stats.sweeps++;
  playedToday(); checkGoals();                       // (4.2) the day counts, a reached goal gets its banner
  goalStep(total,swept);                             // (4.1) an Adventure level's goal; a win ends the level
  if(!dealing){ checkStuck(); saveRun(); }            // otherwise checked and saved once the new tray is dealt
}
const anyFits=()=>tray.some(v=>v&&fitsAnywhere(v.s,grid));
// Stuck (plan 3.2): while Undo or a Rescue can get her out, the run waits for her (pieces dim, "No moves", End run offered).
// Only when neither is left does it end by itself, after 700 ms so the last drop finishes landing; the timer re-checks.
function checkStuck(){
  stuck=!anyFits();
  syncActions();
  if(stuck&&!canExit()) setTimeout(()=>{ if(!dealing&&!anyFits()&&!canExit()) gameOver(); },700);
}

/* The next tray is dealt after the clear has started, not inside the drop (plan 2.2). Choosing a hand
   is the most expensive thing the game does (~5-15 ms), and it used to run
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
// Which tray piece a press at (x,y) takes (a small, quick finger lands near a piece, not on it): anywhere below
// the board counts, and the slot's whole column is its target. An empty column hands off to the nearest piece.
function pickAt(x,y){
  if(y<by+B||x<bx-B/6||x>bx+B+B/6) return -1;
  let best=-1, bd=Infinity;
  for(let i=0;i<3;i++){
    if(!tray[i]) continue;
    const R=slotRect(i), d=Math.abs(x-(R.x+R.w/2));
    if(d<bd){ bd=d; best=i; }
  }
  return best;
}
let pendingPress=null;                                // a press that came while the tray was dealing: {id,x,y}
function onDown(e){
  if(state!=='play'||paused||drag) return;   // one drag at a time (a second finger can't pick up another piece)
  if(e.target&&e.target.closest&&e.target.closest('button')) return;
  if(dealing){ pendingPress={id:e.pointerId,x:e.clientX,y:e.clientY}; return; }   // taken the moment the new tray appears (stepPending)
  startDrag(e.pointerId,e.clientX,e.clientY);
}
function startDrag(id,x,y){
  ac();
  const i=pickAt(x,y);
  if(i<0) return;
  const s0=tray[i].s;
  drag={i,id,x,y,g:(CFG.FX_PICKUP_GROW&&!reduce)?0:1,s0:trayFit(s0)/cell,
        slot:null,snapK:0,sx:0,sy:0};                 // snapK: 0 floating .. 1 seated; sx/sy: the seat being eased into
  updateSlot(); hesPick();
  Sfx.pickup(); if(tray[i]&&tray[i].s.star) Sfx.starPick();
}
function stepPending(){                               // called each frame: the deal finished and her finger is still down
  if(!pendingPress||dealing||drag) return;
  const p=pendingPress; pendingPress=null;
  if(state==='play'&&!paused) startDrag(p.id,p.x,p.y);
}
function onMove(e){
  if(pendingPress&&e.pointerId===pendingPress.id){ pendingPress.x=e.clientX; pendingPress.y=e.clientY; }
  if(!drag||paused||e.pointerId!==drag.id) return;
  drag.x=e.clientX; drag.y=e.clientY;
  updateSlot();
}
function onUp(e){
  if(pendingPress&&e.pointerId===pendingPress.id) pendingPress=null;
  if(!drag||paused||e.pointerId!==drag.id) return;
  const t=tray[drag.i];
  if(t){
    updateSlot();                                     // the same answer the last frame drew (the finger hasn't moved since)
    if(drag.slot) place(drag.i,drag.slot.r,drag.slot.c);
    else sendBack();
  }
  drag=null;
}
function onCancel(e){
  if(pendingPress&&e.pointerId===pendingPress.id) pendingPress=null;                                 // iOS took the touch away (a system gesture): the piece goes home
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

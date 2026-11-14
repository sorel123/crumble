// Crumble — Developer (Admin) panel.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ developer panel ═══════
   Everything is driven by the two tables below — a new toggle or slider is one line. */
const DEV_TOGGLES=[            // [CFG key, label]; 'A.b' is a key inside an object entry of CFG
  ['TIDE','Coaster dealing: easy and lean stretches (1.1 G)'],
  ['DEALER_HOME','Dealer: pieces have a home (new)'],
  ['DEALER_CURVE','Dealer: Block Blast curve'],
  ['HOME_BLOCKY','Home dealer: blocky cool stretch (TIGHT trays)'],
  ['REC_PLAY','Record play (stays on without ?dev)'],
  ['COMBO_CARRY','Combo carries across trays (round 6)'],
  ['EASY_RECT','Coaster: easy stretches deal rectangles and bars only (round 5)'],
  ['FX_CLOSER_GLOW','Closer shimmer on the tray (7.3)'],
  ['SPECIALS.bonus','Special: Bonus trays (x2)'],
  ['SPECIALS.star','Special: Star Gem'],
  ['SPECIALS.golden','Special: Golden Hand'],
  ['SPECIALS.transform','Special: Transformations'],
  ['UNLOCK_ALL','Unlock all skins'],
  ['UNLOCK_ALL_WORLDS','Unlock all worlds'],
  ['FX_COMBO_GLOW','Combo edge glow'],
  ['FX_STAR_BURST','Star gem beams and burst'],
  ['FX_GOLD_TINT','Gold screen tint'],
  ['FX_SWEEP_FX','Sweep wash + confetti'],
  ['FX_PRESSURE_SCREEN','Pressure on screen (6.6)'],
  ['FX_TENSION_BORDER','Tension border glow'],
  ['FX_PUNCH_ZOOM','Punch zoom on clears'],
  ['FX_CHUNKS','Clears burst into blocks'],
  ['FX_SCORE_ORBS','Score orbs fly to counter (combo 3+)'],
  ['FX_LAND_BUMP','Landing thump'],
  ['FX_PICKUP_GROW','Pickup grow-in'],
  ['FX_LINE_PREVIEW','Coloured line preview'],
  ['FX_ANTICIPATION','Anticipation: lines shiver and glint (7.5c)'],
  ['FX_NARROW_ESCAPE','Narrow-escape flourish'],
  ['FX_ONE_VOICE','One headline at a time'],
  ['FX_HERO_STAMP','Crumb stamps on the hero piece'],
  ['FX_PIECE_COLOR_CLEAR','Clear in the piece colour'],
  ['FX_CELL_TAGS','Point tags on cleared cells'],
  ['FX_MAGNET','Magnet: piece hops into its slot (off = glide + ghost)'],
  ['FX_COMBO_SLAM','COMBO slam + fireworks (combo 3+)'],
  ['FX_COMBO_FIRE','Combo fire: burning rim, embers, snuff (7.5d)'],
  ['FX_CHASE','Chase your best: score bar + sky jump (7.5e)'],
  ['FX_MASCOT','Mascot crumb (7.5f)'],
  ['FX_CRUMB_TOY','Crumb toy: grab + flick'],
  ['CRUMB_CANNON','Crumb cannonball: a streak charges it (Endless)'],
  ['TILT','Crumb toy: tilt to roll'],
  ['TILT_FLIP','Crumb toy: flip the tilt direction'],
  ['AVALANCHE','Avalanche: the board falls on a streak (Endless)'],
  ['FX_TIMELAPSE','Timelapse on game over (7.5g)'],
  ['SHOW_TENSION','Debug readout']
];
// instant-trigger buttons for testing — each just calls triggerTransform(id)
const DEV_ACTIONS=[['Fill bonus meter',()=>{ if(!bonus){ bonusMeter=CFG.BONUS_METER; syncBonusChip(); } }],
  ['Bonus trays',()=>{ if(!bonus){ if(transform) endTransform(); bonusMeter=0; startBonus(); } }],
  ...Object.keys(ACHIEVE).map(id=>[TRANSFORMS[id].name,()=>{ transformCool=0; triggerTransform(id); }]),
  ['Next sky (7.5b)',()=>{ journeySweep(); if(jPend) jPend.t=1; }],
  ['Copy play log',()=>recCopy()],
  ['Clear play log',()=>{ recClear(); }],
  ['Reset unlocks',()=>{ discoveredWorlds.clear(); newLook=false; saveSkinSave(); renderWorlds(); renderLooks(); syncLookDot(); }]];
// the play log to the clipboard; where there is no clipboard (an iOS web view) it shows in a box to select and copy by hand
async function recCopy(){
  const txt=recText();
  try{ await navigator.clipboard.writeText(txt); pushBanner('PLAY LOG COPIED',(txt.length/1024).toFixed(0)+' KB','#8FF7FF'); return; }catch(_){}
  const box=document.createElement('div'), ta=document.createElement('textarea'), b=document.createElement('button');
  box.id='recBox'; box.style.cssText='position:fixed;inset:8%;z-index:99;display:flex;flex-direction:column;gap:8px;background:#111;padding:10px;border-radius:12px';
  ta.readOnly=true; ta.value=txt; ta.style.cssText='flex:1;width:100%;font:11px monospace;user-select:text;-webkit-user-select:text';
  b.type='button'; b.textContent='Close'; b.onclick=e=>{ e.stopPropagation(); box.remove(); };
  box.onclick=e=>e.stopPropagation(); box.append(ta,b); document.body.append(box); ta.focus(); ta.select();
}
const opt=(...pairs)=>pairs.map(([value,label])=>({value,label}));
const DEV_CHOICES=[            // [CFG key, label, options, audition fn]
  ['CLEAR_STYLE','Clear style',opt(['crumble','Crumble to rubble'],['squash','Squash to a bar'],['burst','Blocks fly out']),()=>{}],
  ['SND_PICKUP','Pickup sound',opt(['slide','Slide'],['soft','Soft'],['swish','Swish'],['original','Original'],['off','Off']),()=>{ ac(); setTimeout(()=>Sfx.pickup(),60); }],
  ['SND_PLACE','Place sound',opt(['drop','Drop'],['wood','Wood'],['soft','Soft'],['original','Original'],['off','Off']),()=>{ ac(); setTimeout(()=>Sfx.place(1),60); }]
];
// one-tap previews of the chosen set's moments (Settings -> Sound)
const DEV_PREVIEWS=[['Clear',()=>Sfx.clear(1,0,1)],['Combo ×4',()=>Sfx.combo(4,2,0)],['Praise',()=>Sfx.praise(2)],
  ['Big praise',()=>Sfx.praise(4)],['Sweep',()=>Sfx.sweep(0)],['Golden',()=>Sfx.goldenWin()],
  ['Bonus start',()=>Sfx.bonusStart()],['Bonus ready',()=>Sfx.bonusReady()],['Bonus over',()=>Sfx.bonusEnd()],['Star dealt',()=>Sfx.starIn()],['Star blast',()=>Sfx.star(9)]];
const DEV_SOUND_TOGGLES=[       // shown in the Sound section
  ['PHONE_SPEAKER','Phone speaker mode (cut bass)']
];
const DEV_SLIDERS=[            // [CFG key, label, min, max, step]
  ['MUSIC_VOL','Music volume',0,1,0.05],
  ['SND_PICKUP_VOL','Pickup volume',0,1.5,0.05],
  ['SND_PLACE_VOL','Place volume',0,1.5,0.05],
  ['TRANSFORM_PLACEMENTS','Transform length (placements)',1,15,1],
  ['TRANSFORM_MULT','Transform score multiplier',1,4,0.1],
  ['TRANSFORM_COOLDOWN','Transform cooldown (trays)',0,15,1],
  ['TRANSFORM_COMBO','Volcano: combo needed',3,9,1],
  ['TRANSFORM_STAR_GEMS','Starfield: star gems needed',9,15,1],
  ['HOME_BUMP','Home dealer: how far a home may stick out',0,6,1],
  ['HOME_COOL_MIN','Home dealer: cool stretch min (trays)',0,15,1],
  ['HOME_COOL_MAX','Home dealer: cool stretch max (trays)',0,15,1],
  ['HOME_EARN','Home dealer: nearly-done lines that start win mode',1,8,1],
  ['HOME_WIN_WAIT','Home dealer: warm trays before win mode anyway',1,15,1],
  ['HOME_WIN_MAX','Home dealer: longest win mode (trays)',1,20,1],
  ['HOME_WIN_DRY','Home dealer: dry trays that end win mode',1,6,1],
  ['HOME_TWIST','Home dealer: twist odds in a cool stretch',0,1,0.05],
  ['HOME_RESCUE_ROOM','Home dealer: rescue below room',0,1,0.01],
  ['HOME_FINISH_GEMS','Home dealer: low board (gems) for FINISH',0,40,1],
  ['HOME_FINISH','Home dealer: FINISH odds on a low board',0,1,0.05],
  ['HOME_FINISH_HOT','Home dealer: FINISH odds in win mode',0,1,0.05],
  ['HOME_FINISH_MAX','Home dealer: most FINISH trays in a row',0,6,1],
  ['HOME_WIPE_KEEP','Home dealer: wipe chain carries on (odds^n)',0,1,0.05],
  ['CURVE_HEAT','Curve: heat strength (luck dial)',0,1,0.05],
  ['CURVE_MULTI','Curve: multi-line weight',0,4,0.1],
  ['CURVE_GIVE','Curve: generosity (CLEAR share offset)',-0.3,0.3,0.01],
  ['TIDE_EASY_MIN','Coaster: easy stretch min (trays)',2,30,1],
  ['TIDE_EASY_MAX','Coaster: easy stretch max (trays)',2,30,1],
  ['TIDE_LEAN_MIN','Coaster: lean stretch min (trays)',0,30,1],
  ['TIDE_LEAN_MAX','Coaster: lean stretch max (trays)',0,30,1],
  ['TIDE_SMALL','Coaster: small-piece weight',0,2,0.05],
  ['TIDE_FIT','Coaster: easy fit pull',0,3,0.1],
  ['LEAN_LINES','Coaster: lean lines at most',0,6,1],
  ['LEAN_DRY','Coaster: lean dry trays to a rescue',1,6,1],
  ['LEAN_ROOM','Coaster: lean rescue below room',0,1,0.01],
  ['SOUND_ROOM','Coaster: room a sound spot may cost',0,0.5,0.01],
  ['EASY_BIG','Coaster: easy pull to big hands',0,6,0.1],
  ['EASY_ROOM','Coaster: easy keeps room',0,100,1],
  ['EASY_CASH','Coaster: easy pull to big clears',0,8,0.5],
  ['EASY_SWEEP','Coaster: easy pull to a sweep',0,200,5],
  ['EASY_STEER','Coaster: easy steer to an empty board (late)',0,10,0.5],
  ['EASY_LOW','Coaster: easy drives the board down',0,10,0.5],
  ['LEAN_PUZZLE_TRY','Coaster: lean puzzle piece odds',0,1,0.05],
  ['EASY_RUN_GEMS','Coaster: easy sweep run from gems (0 = off)',0,40,1],
  ['EASY_RUN_TRAYS','Coaster: easy sweep run trays',0,8,1],
  ['BIG_SOLVE','Coaster: big solve pull',0,40,1],
  ['BIG_READY','Coaster: big solve nearly-done lines',1,8,1],
  ['BIG_FIRST','Coaster: big solve trays after lean',0,6,1],
  ['BIG_READY_CELLS','Coaster: nearly-done cells of 8',4,7,1],
  ['COMBO_GRACE','Combo: drops without a clear that end it',1,6,1],
  ['CROWD_ROOM','Coaster: crowded below this room (comeback keys)',0,1,0.05],
  ['CROWD_GEMS','Coaster: crowded at this many gems',10,64,1],
  ['CROWD_TWO','Coaster: two comeback keys odds',0,1,0.05],
  ['CROWD_KEY','Coaster: comeback key pull',0,60,1],
  ['CHAIN_BUILD','Coaster: matching pieces after a board clear',0,1,0.05],
  ['OPEN_BUILD','Coaster: build-off opening odds',0,1,0.05],
  ['SWEEP_EASE','Coaster: board-clear ease needed (run)',0,1,0.05],
  ['SWEEP_EASE_W','Coaster: board-clear ease pull (hunt)',0,10,0.5],
  ['MATCH','Coaster: matched tray pull',0,60,1],
  ['MATCH_TRY','Coaster: matched tray odds',0,1,0.05],
  ['FOLLOW','Coaster: follow-through pull',0,80,5],
  ['SMALL_CAP','Coaster: penalty per extra small piece',0,80,5],
  ['LEAN_PUZZLE','Coaster: lean puzzle trays',0,80,1],
  ['EASY_TRIES','Coaster: easy hands looked at',1,48,1],
  ['LEAN_TRIES','Coaster: lean hands looked at',1,48,1],
  ['ROOM_OK','Pace: calm at room above',0,1,0.01],
  ['ROOM_EDGE','Pace: edge at room below',0,1,0.01],
  ['EDGE_HOLD_MIN','Pace: edge hold min (trays)',0,6,1],
  ['EDGE_HOLD_MAX','Pace: edge hold max (trays)',0,6,1],
  ['RECOVERY_TRIES','Pace: recovery tries',1,4,1],
  ['RELIEF_TRAYS','Pace: relief trays',0,4,1],
  ['GIFT_CHANCE','Pace: calm gift chance',0,1,0.01],
  ['HONEST_TRIES','Pace: honest hands looked at',1,36,1],
  ['BUILD_BIAS','Pace: building small-piece bias',0,1,0.05],
  ['WAVE_MIN','Payoff: every (min trays)',1,10,1],
  ['WAVE_MAX','Payoff: every (max trays)',1,12,1],
  ['PAYOFF_LINES','Payoff: lines it must offer',1,4,1],
  ['BUILD_W','Payoff: build-piece weight',0,4,0.1],
  ['SETUP_CHANCE','Setup: piece chance per tray',0,1,0.05],
  ['SETUP_TRAYS','Setup: trays open',1,6,1],
  ['CLOSER_GEMS','Closer: gems left at most',0,30,1],
  ['CLOSER_COMBO','Closer: combo',2,8,1],
  ['CLOSER_TARGET','Closer: sweep cells at most',10,27,1],
  ['CLOSER_COOL','Closer: cooldown (trays)',0,15,1],
  ['RUN_TRAYS','Sweep run: trays dealt toward a sweep (0 = off)',0,5,1],
  ['RUN_GEMS','Sweep run: starts at gems at most',8,30,1],
  ['CHASE_TRIES','Sweep chase: set-up hands tried (0 = off)',0,16,1],
  ['SWEEP_AIM','Sweep aim: lean toward sweepable boards (0 = off)',0,4,1],
  ['DRY_TRAYS','Dry spell: trays to a payoff',2,12,1],
  ['JACKPOT_MIN','Jackpot: every (min trays)',2,30,1],
  ['JACKPOT_MAX','Jackpot: every (max trays)',2,30,1],
  ['JACKPOT_LINES','Jackpot: lines it must offer',2,6,1],
  ['JACKPOT_DRY','Jackpot: extra per dry tray',0,4,1],
  ['BUILD_UP','Payoff: build-up before it',0,12,1],
  ['BIG_FLOOR','4+ pieces per five trays',0,10,1],
  ['TENSION_UP','Adventure: tension up (no clear)',0,0.5,0.01],
  ['TENSION_DOWN','Tension down (clear)',0,0.5,0.01],
  ['TENSION_DRIFT','Tension drift (cramped)',0,0.3,0.01],
  ['TIER_SOLVABLE','Tier: solvable above',0,1,0.01],
  ['TIER_JACKPOT','Tier: jackpot above',0,1,0.01],
  ['TIER_SWEEP','Tier: sweep above',0,1,0.01],
  ['SMALL_BIAS','Small-piece bias',0,8,0.1],
  ['SINGLE_WEIGHT','Single-cell weight',0,1,0.05],
  ['TIDY','Tidiness',0,5,0.1],
  ['OBVIOUS','Obvious clears (per piece)',0,30,1],
  ['OBVIOUS_MAX','Obvious clears counted (pieces)',0,3,1],
  ['ALT','Room for the smallest piece',0,3,0.1],
  ['PAIR_CHANCE','Partner-piece chance',0,1,0.05],
  ['GOLDEN_COMBO','Golden hand at combo',1,10,1],
  ['GOLDEN_CHANCE','Golden hand chance (per tray)',0,0.5,0.01],
  ['GOLDEN_COOLDOWN','Golden hand cooldown (trays)',0,20,1],
  ['GOLDEN_MIN_LINES','Golden hand: least lines offered',1,5,1],
  ['GOLDEN_MULT','Golden multiplier (found it)',1,6,0.5],
  ['GOLDEN_PARTIAL','Golden multiplier (partial)',1,4,0.5],
  ['STAR_MIN','Star gem: gems the best cross must clear',1,15,1],
  ['STAR_CHANCE','Star gem chance (per eligible tray)',0,1,0.01],
  ['STAR_COOL','Star gem cooldown (trays)',0,20,1],
  ['STAR_PER_GEM','Star gem points per gem',0,40*SCORE_SCALE,SCORE_SCALE],
  ['STAR_COMBO','Star gem guaranteed at combo',2,10,1],
  ['SWEEP_COOLDOWN','Sweep cooldown (trays)',0,10,1],
  ['LIFT','Piece lift above finger (cells)',0,3,0.05],
  ['CLEAR_BLINK','Clear: blink frames',0,14,1],
  ['COLOR_GONE_BONUS','Colour-gone bonus (per colour)',0,200*SCORE_SCALE,10*SCORE_SCALE],
  ['CLEAR_STAGGER','Clear: pop spread (frames/cell)',0,3,0.1],
  ['CRUMBLE_STAGGER','Crumble: crack wave (frames/cell)',0,3,0.05],
  ['BONUS_METER','Bonus: meter to fill',3,30,1],
  ['BONUS_COMBO_MAX','Bonus: most extra meter per combo',0,5,1],
  ['BONUS_TRAYS','Bonus: trays it lasts',1,3,1],
  ['BONUS_MULT','Bonus: score multiplier',1,4,0.5],
  ['BIG_CAP','Big-piece bias cap (cells)',1,9,1],
  ['GUIDE','Guided hands (obvious drops)',0,3,0.1],
  ['MAGNET_REACH','Magnet reach (cells)',0.3,1.5,0.05],
  ['MAGNET_HOLD','Magnet hold (cells)',0,0.5,0.05],
  ['GHOST_ALPHA','Landing ghost strength',0.2,1,0.05],
  ['ANTIC_REACH','Anticipation reach (cells)',1,5,0.25],
  ['ANTIC_SHIVER','Anticipation shiver (px)',0,3,0.1]
];
const DEV_KEYS=[...DEV_TOGGLES.map(t=>t[0]),...DEV_SOUND_TOGGLES.map(t=>t[0]),...DEV_CHOICES.map(c=>c[0]),...DEV_SLIDERS.map(s=>s[0])];
const cfgGet=k=>{ const [a,b]=k.split('.'); return b?CFG[a][b]:CFG[a]; };
const cfgSet=(k,v)=>{ const [a,b]=k.split('.'); if(b) CFG[a][b]=v; else CFG[a]=v; };
const DEV_DEFAULTS=Object.fromEntries(DEV_KEYS.map(k=>[k,cfgGet(k)]));   // the values written in the file
const DEV_STORE='crumble.dev.6';   // bumped when the drag went to glide + ghost (after plan 2.1), so older saved tuning doesn't override the new defaults
function devSave(){
  try{ localStorage.setItem(DEV_STORE,JSON.stringify({...Object.fromEntries(DEV_KEYS.map(k=>[k,cfgGet(k)])),clearV:1,scaleV:SCORE_SCALE})); }catch(e){}
}
function devLoad(){
  try{
    const o=JSON.parse(localStorage.getItem(DEV_STORE)||'{}');
    if(o.scaleV!==SCORE_SCALE){ delete o.STAR_PER_GEM; delete o.COLOR_GONE_BONUS; }   // (8.0) tuning saved before the points boost holds old-size point values
    if(!o.clearV) delete o.CLEAR_STYLE;                  // (7.5) tuning saved before crumble was the default keeps its other values but not the old 'squash'
    for(const k of DEV_KEYS) if(typeof o[k]===typeof DEV_DEFAULTS[k]) cfgSet(k,o[k]);
    for(const [k,,options] of DEV_CHOICES) if(!options.some(x=>x.value===CFG[k])) CFG[k]=DEV_DEFAULTS[k];
    const dl=new URLSearchParams(location.search).get('dealer'); if(dl){ CFG.DEALER_HOME=dl==='home'; CFG.DEALER_CURVE=dl==='curve'; }   // ?dealer=home|curve|tide beats the saved switches
  }catch(e){}
}
function devSnippet(){
  const f=v=>typeof v==='number'?+v.toFixed(4):typeof v==='string'?JSON.stringify(v):v;
  return '// dev panel snapshot — paste over the matching CFG entries\n'+DEV_KEYS.filter(k=>!k.includes('.')).map(k=>`  ${k}: ${f(CFG[k])},`).join('\n')
    +`\n  SPECIALS: ${JSON.stringify(CFG.SPECIALS).replace(/"/g,'')},`;
}
function initDev(){
  el('adminBtn').hidden=!CFG.DEV_MODE;                   // the admin panel is reached from Settings, in dev mode only
  if(!CFG.DEV_MODE) return;
  devLoad();
  const list=el('devList'), refresh=[];
  const make=(tag,cls)=>{ const n=document.createElement(tag); if(cls) n.className=cls; return n; };
  for(const [k,label] of DEV_TOGGLES){
    const row=make('label','tog'), name=make('span'), inp=make('input');
    name.textContent=label; inp.type='checkbox';
    inp.onchange=()=>{
      cfgSet(k,inp.checked); devSave(); updateDbg(); syncBonusChip();
      if(k==='UNLOCK_ALL') renderSkins();
      if(k==='REC_PLAY') try{ localStorage.setItem('crumble.rec',inp.checked?'1':'0'); }catch(_){}
      if(k==='UNLOCK_ALL_WORLDS') renderWorlds();
    };
    refresh.push(()=>{ inp.checked=!!cfgGet(k); });
    row.append(name,inp); list.append(row);
  }
  const actions=make('div','devbtns');
  for(const [label,fn] of DEV_ACTIONS){
    const b=make('button','ghost'); b.type='button'; b.textContent=label;
    b.onclick=e=>{ e.stopPropagation(); fn(); };
    actions.append(b);
  }
  list.append(actions);
  const soundHead=make('div','devhead'); soundHead.textContent='Sound'; list.append(soundHead);
  for(const [k,label] of DEV_SOUND_TOGGLES){
    const row=make('label','tog'), name=make('span'), inp=make('input');
    name.textContent=label; inp.type='checkbox';
    inp.onchange=()=>{ CFG[k]=inp.checked; devSave(); setSpeaker(CFG.PHONE_SPEAKER); try{ localStorage.setItem('crumble.speaker',String(inp.checked)); }catch(e){} };
    refresh.push(()=>{ inp.checked=!!CFG[k]; });
    row.append(name,inp); list.append(row);
  }
  {                                                // speaker test: which of these sound distorted tells us why
    const box=make('div'), head=make('div','head'), name=make('span'), rate=make('output'), row=make('div','choices');
    name.textContent='Speaker test'; head.append(name,rate); box.append(head);
    const showAudio=()=>{ rate.textContent=actx?`${actx.sampleRate} Hz · ${actx.state} · recorded ${Object.keys(bank).length}/${Object.keys(SAMPLES).length}${bankFail?' ('+bankFail+' failed)':''}`:'audio not started'; };
    refresh.push(showAudio);
    for(const [kind,label] of [['clean','Plain tone'],['chain','Through game'],['low','Low tone']]){
      const b=make('button'); b.type='button'; b.textContent='▶ '+label;
      b.onclick=e=>{ e.stopPropagation(); testTone(kind); showAudio(); };
      row.append(b);
    }
    box.append(row); list.append(box);
  }
  for(const [k,label,options,audition] of DEV_CHOICES){
    const box=make('div'), head=make('div','head'), name=make('span'), row=make('div','choices');
    name.textContent=label; head.append(name); box.append(head);
    const btns=options.map(o=>{
      const b=make('button'); b.type='button'; b.textContent=o.label;
      b.onclick=e=>{ e.stopPropagation(); CFG[k]=o.value; devSave(); btns.forEach(x=>x.setAttribute('aria-pressed',String(x===b))); };
      row.append(b); return b;
    });
    const play=make('button','play'); play.type='button'; play.textContent='▶';
    play.setAttribute('aria-label','Play '+label);
    play.onclick=e=>{ e.stopPropagation(); audition(); };
    row.append(play);
    box.append(row); list.append(box);
    refresh.push(()=>{ btns.forEach((b,i)=>b.setAttribute('aria-pressed',String(CFG[k]===options[i].value))); });
  }
  {
    const box=make('div'), head=make('div','head'), name=make('span'), row=make('div','choices');
    name.textContent='Preview game sounds'; head.append(name); box.append(head);
    for(const [label,fn] of DEV_PREVIEWS){
      const b=make('button'); b.type='button'; b.textContent='▶ '+label;
      b.onclick=e=>{ e.stopPropagation(); ac(); setTimeout(fn,60); };
      row.append(b);
    }
    box.append(row); list.append(box);
  }
  for(const [k,label,min,max,step] of DEV_SLIDERS){
    const box=make('div'), head=make('div','head'), name=make('span'), out=make('output'), inp=make('input');
    const dp=(String(step).split('.')[1]||'').length;
    name.textContent=label;
    Object.assign(inp,{type:'range',min,max,step});
    const show=()=>{ out.textContent=(+CFG[k]).toFixed(dp); };
    inp.oninput=()=>{ CFG[k]=+inp.value; show(); devSave(); };
    refresh.push(()=>{ inp.value=CFG[k]; show(); });
    head.append(name,out); box.append(head,inp); list.append(box);
  }
  const sync=()=>refresh.forEach(f=>f());
  el('adminBtn').onclick=e=>{
    e.stopPropagation();
    paused=true; hapSelect('end'); drag=null; shake=0; hesVoid();          // freeze the game while the panel is up
    el('setPanel').hidden=true; sync(); el('devPanel').hidden=false;
  };
  el('devClose').onclick=e=>{ e.stopPropagation(); el('devPanel').hidden=true; paused=false; };
  el('devReset').onclick=e=>{
    e.stopPropagation();
    for(const k of DEV_KEYS) cfgSet(k,DEV_DEFAULTS[k]);
    try{ localStorage.removeItem(DEV_STORE); }catch(_){}
    sync(); updateDbg(); renderSkins(); renderWorlds(); setSpeaker(CFG.PHONE_SPEAKER); syncBonusChip();
  };
  el('devCopy').onclick=async e=>{
    e.stopPropagation();
    const txt=devSnippet(), btn=e.currentTarget;
    try{ await navigator.clipboard.writeText(txt); }
    catch(_){
      const ta=document.createElement('textarea'); ta.value=txt; document.body.append(ta); ta.select();
      try{ document.execCommand('copy'); }catch(__){}
      ta.remove();
    }
    btn.textContent='Copied!'; setTimeout(()=>{ btn.textContent='Copy settings'; },1200);
  };
}

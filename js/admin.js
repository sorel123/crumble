// Crumble — Developer (Admin) panel.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ developer panel ═══════
   Everything is driven by the two tables below — a new toggle or slider is one line. */
const DEV_TOGGLES=[            // [CFG key, label]
  ['SPECIALS','Specials (golden, star, transformations, Blast) — master'],
  ['GOLDEN_ENABLED','Golden Hand'],
  ['STAR_ENABLED','Star Gem'],
  ['TRANSFORM_ENABLED','Transformations'],
  ['UNLOCK_ALL','Unlock all skins'],
  ['UNLOCK_ALL_WORLDS','Unlock all worlds'],
  ['FX_COMBO_GLOW','Combo edge glow'],
  ['FX_GOLD_TINT','Gold screen tint'],
  ['FX_SWEEP_FX','Sweep wash + confetti'],
  ['FX_TENSION_BORDER','Tension border glow'],
  ['FX_PUNCH_ZOOM','Punch zoom on clears'],
  ['FX_CHUNKS','Clears burst into blocks'],
  ['FX_SCORE_ORBS','Score orbs fly to counter (combo 3+)'],
  ['FX_LAND_BUMP','Landing thump'],
  ['FX_PICKUP_GROW','Pickup grow-in'],
  ['FX_LINE_PREVIEW','Coloured line preview'],
  ['FX_CELL_TAGS','Point tags on cleared cells'],
  ['FX_MAGNET','Magnet: piece hops into its slot (off = glide + ghost)'],
  ['FX_COMBO_SLAM','COMBO slam + fireworks (combo 3+)'],
  ['BLAST_ENABLED','Blast Round'],
  ['SHOW_TENSION','Debug readout']
];
// instant-trigger buttons for testing — each just calls triggerTransform(id)
const DEV_ACTIONS=[['Blast Round',()=>{ if(!blast){ if(transform) endTransform(); startBlast(); } }],
  ...Object.keys(TRANSFORMS).map(id=>[TRANSFORMS[id].name,()=>{ transformCool=0; triggerTransform(id); }])];
const opt=(...pairs)=>pairs.map(([value,label])=>({value,label}));
const DEV_CHOICES=[            // [CFG key, label, options, audition fn]
  ['CLEAR_STYLE','Clear style',opt(['squash','Squash to a bar'],['burst','Blocks fly out']),()=>{}],
  ['SND_PICKUP','Pickup sound',opt(['slide','Slide'],['soft','Soft'],['swish','Swish'],['original','Original'],['off','Off']),()=>{ ac(); setTimeout(()=>Sfx.pickup(),60); }],
  ['SND_PLACE','Place sound',opt(['drop','Drop'],['wood','Wood'],['soft','Soft'],['original','Original'],['off','Off']),()=>{ ac(); setTimeout(()=>Sfx.place(1),60); }]
];
// one-tap previews of the chosen set's moments (Settings -> Sound)
const DEV_PREVIEWS=[['Clear',()=>Sfx.clear(1,0,1)],['Combo ×4',()=>Sfx.combo(4,2,0)],['Praise',()=>Sfx.praise(2)],
  ['Big praise',()=>Sfx.praise(4)],['Sweep',()=>Sfx.sweep(0)],['Golden',()=>Sfx.goldenWin()]];
const DEV_SOUND_TOGGLES=[       // shown in the Sound section
  ['PHONE_SPEAKER','Phone speaker mode (cut bass)']
];
const DEV_SLIDERS=[            // [CFG key, label, min, max, step]
  ['SND_PICKUP_VOL','Pickup volume',0,1.5,0.05],
  ['SND_PLACE_VOL','Place volume',0,1.5,0.05],
  ['TRANSFORM_PLACEMENTS','Transform length (placements)',1,15,1],
  ['TRANSFORM_MULT','Transform score multiplier',1,4,0.1],
  ['TRANSFORM_COOLDOWN','Transform cooldown (trays)',0,15,1],
  ['MYSTERY_CHANCE','Mystery trigger chance (per tray)',0,0.3,0.01],
  ['TENSION_UP','Tension up (no clear)',0,0.5,0.01],
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
  ['GOLDEN_COOLDOWN','Golden hand cooldown (trays)',0,10,1],
  ['GOLDEN_MULT','Golden multiplier (found it)',1,6,0.5],
  ['GOLDEN_PARTIAL','Golden multiplier (partial)',1,4,0.5],
  ['STAR_CHANCE','Star gem chance (per tray)',0,0.5,0.01],
  ['STAR_COMBO','Star gem guaranteed at combo',2,10,1],
  ['SWEEP_COOLDOWN','Sweep cooldown (trays)',0,10,1],
  ['LIFT','Piece lift above finger (cells)',0,3,0.05],
  ['CLEAR_BLINK','Clear: blink frames',0,14,1],
  ['COLOR_GONE_BONUS','Colour-gone bonus (per colour)',0,200,10],
  ['CLEAR_STAGGER','Clear: pop spread (frames/cell)',0,3,0.1],
  ['BLAST_SECONDS','Blast: round length (s)',8,40,1],
  ['BLAST_ADD','Blast: seconds per line',0,6,0.5],
  ['BLAST_MULT','Blast: score multiplier',1,4,0.5],
  ['BIG_CAP','Big-piece bias cap (cells)',1,9,1],
  ['GUIDE','Guided hands (obvious drops)',0,3,0.1],
  ['MAGNET_REACH','Magnet reach (cells)',0.3,1.5,0.05],
  ['MAGNET_HOLD','Magnet hold (cells)',0,0.5,0.05],
  ['GHOST_ALPHA','Landing ghost strength',0.2,1,0.05]
];
const DEV_KEYS=[...DEV_TOGGLES.map(t=>t[0]),...DEV_SOUND_TOGGLES.map(t=>t[0]),...DEV_CHOICES.map(c=>c[0]),...DEV_SLIDERS.map(s=>s[0])];
const DEV_DEFAULTS=Object.fromEntries(DEV_KEYS.map(k=>[k,CFG[k]]));   // the values written in the file
const DEV_STORE='crumble.dev.6';   // bumped when the drag went to glide + ghost (after plan 2.1), so older saved tuning doesn't override the new defaults
function devSave(){
  try{ localStorage.setItem(DEV_STORE,JSON.stringify(Object.fromEntries(DEV_KEYS.map(k=>[k,CFG[k]])))); }catch(e){}
}
function devLoad(){
  try{
    const o=JSON.parse(localStorage.getItem(DEV_STORE)||'{}');
    for(const k of DEV_KEYS) if(typeof o[k]===typeof DEV_DEFAULTS[k]) CFG[k]=o[k];
    for(const [k,,options] of DEV_CHOICES) if(!options.some(x=>x.value===CFG[k])) CFG[k]=DEV_DEFAULTS[k];
  }catch(e){}
}
function devSnippet(){
  const f=v=>typeof v==='number'?+v.toFixed(4):typeof v==='string'?JSON.stringify(v):v;
  return '// dev panel snapshot — paste over the matching CFG entries\n'+DEV_KEYS.map(k=>`  ${k}: ${f(CFG[k])},`).join('\n');
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
      CFG[k]=inp.checked; devSave(); updateDbg();
      if(k==='UNLOCK_ALL') renderSkins();
      if(k==='UNLOCK_ALL_WORLDS') renderWorlds();
    };
    refresh.push(()=>{ inp.checked=!!CFG[k]; });
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
    inp.onchange=()=>{ CFG[k]=inp.checked; devSave(); setSpeaker(CFG.PHONE_SPEAKER); };
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
    paused=true; drag=null; shake=0; hesVoid();          // freeze the game while the panel is up
    el('setPanel').hidden=true; sync(); el('devPanel').hidden=false;
  };
  el('devClose').onclick=e=>{ e.stopPropagation(); el('devPanel').hidden=true; paused=false; };
  el('devReset').onclick=e=>{
    e.stopPropagation();
    Object.assign(CFG,DEV_DEFAULTS);
    try{ localStorage.removeItem(DEV_STORE); }catch(_){}
    sync(); updateDbg(); renderSkins(); renderWorlds(); setSpeaker(CFG.PHONE_SPEAKER);
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

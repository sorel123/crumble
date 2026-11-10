// Crumble — Skins/worlds persistence and the player Settings panel.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ skins + worlds — unlockable/discoverable, persisted in localStorage ═══════ */
const SKIN_STORE='crumble.skins';
const PICKABLE_SKINS=SKINS.filter(s=>!s.event);       // transformation skins never appear here
let unlocked=new Set(SKINS.filter(s=>s.unlock<=0 && !s.event).map(s=>s.id));
function isUnlocked(id){
  const k=SKINS.find(s=>s.id===id);
  if(k&&k.event) return CFG.UNLOCK_ALL_WORLDS||discoveredWorlds.has(id);       // an earned transformation look (plan 4.5d)
  return CFG.UNLOCK_ALL || unlocked.has(id);
}
function isWorldUnlocked(id){ return !TRANSFORMS[id] || CFG.UNLOCK_ALL_WORLDS || discoveredWorlds.has(id); }
function saveSkinSave(){
  try{ localStorage.setItem(SKIN_STORE,JSON.stringify({
    unlocked:[...unlocked], style:CFG.STYLE, motif:CFG.MOTIF,
    homeWorld:CFG.HOME_WORLD, discovered:[...discoveredWorlds], newLook,
    theme:CFG.THEME, sndSet:CFG.SND_SET, muted, music:CFG.MUSIC, musicPick:CFG.MUSIC_PICK, journey:CFG.JOURNEY_SKY, clear:CFG.CLEAR_STYLE, haptics:CFG.HAPTICS, glint:CFG.FX_ANTICIPATION, fire:CFG.FX_COMBO_FIRE, chase:CFG.FX_CHASE, mascot:CFG.FX_MASCOT, tl:CFG.FX_TIMELAPSE, lookV:2, sndV:2
  })); }catch(e){}
}
function loadSkinSave(){
  try{
    const o=JSON.parse(localStorage.getItem(SKIN_STORE)||'{}');
    if(Array.isArray(o.unlocked)) o.unlocked.forEach(id=>{ if(SKINS.some(s=>s.id===id)) unlocked.add(id); });
    if(Array.isArray(o.discovered)) o.discovered.forEach(id=>{ if(TRANSFORMS[id]) discoveredWorlds.add(id); });
    newLook=!!o.newLook; syncLookDot();
    if(typeof o.style==='string' && isUnlocked(o.style)) CFG.STYLE=o.style;
    if(typeof o.motif==='string' && MOTIFS.some(m=>m.id===o.motif)) CFG.MOTIF=o.motif;
    if(typeof o.homeWorld==='string' && isWorldUnlocked(o.homeWorld)
      && (HOME_WORLDS.some(w=>w.id===o.homeWorld)||TRANSFORMS[o.homeWorld])) CFG.HOME_WORLD=o.homeWorld;
    if(THEMES.some(t=>t.id===o.theme)) CFG.THEME=o.theme;
    if(o.lookV!==2){ CFG.THEME='classic'; CFG.STYLE='blocks'; }   // 2026-10-30: everyone gets the new look once; Settings still changes it
    if(o.sndV!==2) CFG.SND_SET='strings';                          // 6.5: everyone starts on the new sound family once; Settings still changes it
    else if(typeof o.sndSet==='string' && SOUND_SETS[o.sndSet]) CFG.SND_SET=o.sndSet;
    if(typeof o.muted==='boolean') setMuted(o.muted,false);
    if(o.musicPick==='shuffle'||MUSIC_TRACKS.some(t=>t.id===o.musicPick)) CFG.MUSIC_PICK=o.musicPick;   // 7.4
    if(typeof o.journey==='boolean') CFG.JOURNEY_SKY=o.journey;     // (7.5b)
    if(o.clear==='crumble'||o.clear==='squash') CFG.CLEAR_STYLE=o.clear;   // Settings > Look > Clear effect: Crumble or Classic (the squash)
    if(typeof o.glint==='boolean'&&'FX_ANTICIPATION' in CFG) CFG.FX_ANTICIPATION=o.glint;   // Glints while dragging (7.5c)
    if(typeof o.haptics==='boolean') CFG.HAPTICS=o.haptics;           // (5.1) Settings > Sound > Haptics (app only)
    if(typeof o.fire==='boolean') CFG.FX_COMBO_FIRE=o.fire;            // Combo fire (7.5d)
    if(typeof o.chase==='boolean') CFG.FX_CHASE=o.chase;              // Chase your best (7.5e)
    if(typeof o.mascot==='boolean') CFG.FX_MASCOT=o.mascot;           // the mascot crumb (7.5f)
    if(typeof o.tl==='boolean') CFG.FX_TIMELAPSE=o.tl;                // the game-over timelapse (7.5g)
    if(typeof o.music==='boolean') CFG.MUSIC=o.music; else if(o.muted===true) CFG.MUSIC=false;   // she chose silence before music existed: keep it                // 6.8: music is on for everyone until she turns it off
  }catch(e){}
}
// call whenever `best` changes; returns the names of any skins newly earned
function checkUnlocks(){
  const news=[];
  for(const s of PICKABLE_SKINS) if(!unlocked.has(s.id) && best>=s.unlock){ unlocked.add(s.id); news.push(s.name); }
  if(news.length){ saveSkinSave(); renderSkins(); if(el('lookGrid').children.length) renderLooks(); }
  return news;
}
function setSkin(id){
  if(!isUnlocked(id)) return;
  CFG.STYLE=id; if(!transform){ curSkin=id; buildCache(); }       // mid-transformation it applies when that ends
  renderSkins(); renderLooks(); saveSkinSave();
}
function setMotif(id){ CFG.MOTIF=id; buildCache(); renderMotifs(); renderLooks(); saveSkinSave(); }
function setWorld(id){
  if(!isWorldUnlocked(id)) return;
  CFG.HOME_WORLD=id;
  syncHomeSky();                                    // (with the journey sky on, her world shows in Adventure and when it is off)
  renderWorlds(); renderLooks(); saveSkinSave();
}
function renderSkins(){
  el('skinGrid').querySelectorAll('button').forEach(b=>{
    const s=SKINS.find(x=>x.id===b.dataset.id), ok=isUnlocked(s.id);
    b.disabled=!ok; b.setAttribute('aria-pressed',String(CFG.STYLE===s.id));
    const old=b.querySelector('.lock'); if(old) old.remove();
    if(!ok){ const l=document.createElement('span'); l.className='lock'; l.textContent=s.unlock+' pts'; b.append(l); }
  });
}
function renderMotifs(){
  el('motifRow').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(CFG.MOTIF===b.dataset.id)));
}
// (re)builds the world grid — called at init and again whenever a new one is discovered
function renderWorlds(){
  const grid=el('worldGrid');
  grid.innerHTML='';
  const list=[...HOME_WORLDS, ...TRANSFORM_IDS.filter(isWorldUnlocked).map(id=>({id,name:TRANSFORMS[id].name}))];
  list.forEach(wDef=>{
    const b=document.createElement('button');
    b.className='skin-btn'; b.type='button'; b.dataset.id=wDef.id;
    b.append(Object.assign(document.createElement('span'),{textContent:wDef.name}));
    b.setAttribute('aria-pressed',String(CFG.HOME_WORLD===wDef.id));
    b.onclick=e=>{ e.stopPropagation(); setWorld(wDef.id); };
    grid.append(b);
  });
}
function buildSkinsUI(){
  const grid=el('skinGrid');
  PICKABLE_SKINS.forEach(s=>{
    const b=document.createElement('button');
    b.className='skin-btn'; b.type='button'; b.dataset.id=s.id;
    b.append(Object.assign(document.createElement('span'),{textContent:s.name}));
    b.onclick=e=>{ e.stopPropagation(); setSkin(s.id); };
    grid.append(b);
  });
  const row=el('motifRow');
  MOTIFS.forEach(m=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=m.name; b.dataset.id=m.id;
    b.onclick=e=>{ e.stopPropagation(); setMotif(m.id); };
    row.append(b);
  });
  renderWorlds(); renderSkins(); renderMotifs();
}
/* ═══════ looks: complete presets (plan 4.3). A look is a theme + world + skin + motif picked together; the Advanced
   panel still mixes them one by one. To add one (e.g. a 4.5d transformation reward), append an entry: `need()` returns
   a short label while it is locked ('' / absent = open), and its tile shows that label and cannot be picked. The
   chosen look is not stored on its own: it is the four saved settings, so `currentLook()` finds the preset they match
   (none = she mixed her own, no tile lit). */
const LOOKS=[
  {id:'classic', name:'Classic',      theme:'classic',  world:'night',   style:'blocks', motif:'none'},
  {id:'night',   name:'Night Jewels', theme:'night',    world:'ocean',   style:'jewel',  motif:'none'},
  {id:'cotton',  name:'Cotton Candy', theme:'cotton',   world:'blossom', style:'clay',   motif:'heart'},
  {id:'mint',    name:'Mint Garden',  theme:'mint',     world:'forest',  style:'blocks', motif:'none'},
  {id:'neon',    name:'Neon',         theme:'night',    world:'neon',    style:'neon',   motif:'none',
    need:()=>isUnlocked('neon')?'':SKINS.find(s=>s.id==='neon').unlock+' pts'},
  // the earned transformation looks (4.5d): locked with the achievement that opens them
  ...['rainbow','volcano','starfield','goldvault'].map(id=>({id,name:TRANSFORMS[id].name,theme:'night',world:id,style:id,motif:'none',
    need:()=>isUnlocked(id)?'':ACHIEVE[id]}))
];
const lookLocked=l=>l.need?l.need():'';
function currentLook(){
  return LOOKS.find(l=>l.theme===CFG.THEME && l.world===CFG.HOME_WORLD && l.style===CFG.STYLE && l.motif===CFG.MOTIF)||null;
}
function setLook(id){
  const l=LOOKS.find(x=>x.id===id); if(!l || lookLocked(l)) return;
  CFG.THEME=l.theme; CFG.STYLE=l.style; CFG.MOTIF=l.motif; CFG.HOME_WORLD=l.world;
  applyTheme();
  if(!transform){                                  // mid-transformation the skin and world apply when it ends
    curSkin=l.style; buildCache();
  }
  syncHomeSky();
  renderLooks(); renderThemes(); renderWorlds(); renderSkins(); renderMotifs(); saveSkinSave();
}
function lookPreview(cv,l){            // a little board in the look's own sky, panel and tiles
  const S=Math.round(96*Math.min(2,dpr||1)); cv.width=cv.height=S; const x=cv.getContext('2d');
  const t=THEMES.find(h=>h.id===l.theme)||THEMES[0], w=worldDef(l.world);
  const sky=t.light?{top:t.top,bottom:t.bot}:w;
  const g=x.createLinearGradient(0,0,0,S); g.addColorStop(0,sky.top); g.addColorStop(1,sky.bottom);
  x.fillStyle=g; x.fillRect(0,0,S,S);
  const m=S*.12, bw=S-m*2, n=5, c=bw/n;
  x.fillStyle=t.light?t.panel:'rgba(0,0,0,.34)'; roundPath(x,m,m,bw,bw,S*.07); x.fill();
  const skin=SKINS.find(k=>k.id===l.style)||SKINS[0], tiles=GEMS.slice(0,6).map(gm=>{
    const tc=skin.render(c,gm); if(l.motif!=='none') stampMotif(tc,c,l.motif); return tc; });
  const pat=[[0,0,1,1,0],[0,2,2,1,0],[3,2,0,0,4],[3,0,0,4,4],[5,5,5,0,0]];
  pat.forEach((row,r)=>row.forEach((k,col)=>{
    if(!k && (r+col)%2===0) return;                            // empty cells stay slots
    if(!k){ x.fillStyle=t.light?t.slot:'rgba(255,255,255,.055)'; roundPath(x,m+col*c+1,m+r*c+1,c-2,c-2,c*.1); x.fill(); return; }
    x.drawImage(tiles[k%6],m+col*c,m+r*c,c,c);
  }));
}
function renderLooks(){
  const grid=el('lookGrid'), cur=currentLook();
  if(!grid.children.length) for(const l of LOOKS){
    const b=document.createElement('button'); b.type='button'; b.className='look-btn'; b.dataset.id=l.id;
    const cv=document.createElement('canvas'); b.append(cv, Object.assign(document.createElement('span'),{textContent:l.name}));
    b.onclick=e=>{ e.stopPropagation(); setLook(l.id); };
    grid.append(b); lookPreview(cv,l);
  }
  grid.querySelectorAll('button').forEach(b=>{
    const l=LOOKS.find(x=>x.id===b.dataset.id), lock=lookLocked(l);
    b.disabled=!!lock; b.setAttribute('aria-pressed',String(cur===l));
    let s=b.querySelector('.lock'); if(s) s.remove();
    if(lock){ s=document.createElement('span'); s.className='lock'; s.textContent='🔒 '+lock; b.append(s); }
  });
}
/* ═══════ the player's Settings: look + sound, saved as her defaults.
   (The admin panel — tuning, testing — opens from its footer in dev mode.) */
const SOUND_STYLES=[['original','Original'],['strings','Strings'],['steel','Steel drum'],['bells','Bells']];
function renderThemes(){
  el('themeGrid').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(CFG.THEME===b.dataset.id)));
}
function renderSndSet(){
  el('sndSetRow').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(CFG.SND_SET===b.dataset.id)));
}
function renderFxPicks(){                             // Settings > Look: Clear effect and Glints while dragging
  el('clearPick').value=CFG.CLEAR_STYLE==='crumble'?'crumble':'squash';   // 'burst' (Admin only) shows as Classic
  el('glintTog').hidden=!('FX_ANTICIPATION' in CFG); el('glintOn').checked=!!CFG.FX_ANTICIPATION;
  el('fireOn').checked=!!CFG.FX_COMBO_FIRE;
  el('hapTog').hidden=!Native.on(); el('hapOn').checked=!!CFG.HAPTICS;
  el('chaseOn').checked=!!CFG.FX_CHASE;
  el('mascotOn').checked=!!CFG.FX_MASCOT;
  el('tlOn').checked=!!CFG.FX_TIMELAPSE;
}
function renderMusicPick(){
  const cur=CFG.MUSIC?CFG.MUSIC_PICK:'off';
  el('musicPick').value=cur;
}
function buildSettingsUI(){
  const make=(label,id,fn)=>{ const b=document.createElement('button'); b.type='button'; b.dataset.id=id;
    b.textContent=label; b.onclick=e=>{ e.stopPropagation(); fn(id); }; return b; };
  for(const t of THEMES) el('themeGrid').append(Object.assign(make(t.name,t.id,id=>{
    CFG.THEME=id; applyTheme(); renderThemes(); renderLooks(); saveSkinSave(); }),{className:'skin-btn'}));
  for(const [id,label] of SOUND_STYLES) el('sndSetRow').append(make(label,id,v=>{
    CFG.SND_SET=v; renderSndSet(); saveSkinSave(); ac(); setTimeout(()=>Sfx.clear(1,0,1),60); }));   // a quick taste of the style
  el('sndOn').onchange=()=>setMuted(!el('sndOn').checked);
  for(const [id,label] of MUSIC_PICKS) el('musicPick').append(Object.assign(document.createElement('option'),{value:id,textContent:label}));
  el('musicPick').onchange=()=>{ const v=el('musicPick').value; if(v!=='off') ac(); musicSetPick(v); renderMusicPick(); saveSkinSave(); };   // Off is the music switch
  el('clearPick').onchange=()=>{ CFG.CLEAR_STYLE=el('clearPick').value; saveSkinSave(); };     // takes effect from the next clear, mid-run too
  el('glintOn').onchange=()=>{ CFG.FX_ANTICIPATION=el('glintOn').checked; saveSkinSave(); };
  el('hapOn').onchange=()=>{ CFG.HAPTICS=el('hapOn').checked; saveSkinSave(); if(CFG.HAPTICS) haptic('place'); };   // a taste when switched on
  el('fireOn').onchange=()=>{ CFG.FX_COMBO_FIRE=el('fireOn').checked; saveSkinSave(); };   // (7.5d) off mid-streak: the flames fade
  el('chaseOn').onchange=()=>{ CFG.FX_CHASE=el('chaseOn').checked; saveSkinSave(); chaseSync(); };   // (7.5e) the marker shows or hides at once
  el('mascotOn').onchange=()=>{ CFG.FX_MASCOT=el('mascotOn').checked; saveSkinSave(); };   // (7.5f) the crumb shows or hides on the next frame
  el('tlOn').onchange=()=>{ CFG.FX_TIMELAPSE=el('tlOn').checked; saveSkinSave(); };   // (7.5g) from the next drop; on mid-run, it starts from there
  el('journeyOn').onchange=()=>{ CFG.JOURNEY_SKY=el('journeyOn').checked; saveSkinSave(); syncHomeSky(); };   // (7.5b)
  renderThemes(); renderSndSet(); el('sndOn').checked=!muted; renderMusicPick(); el('journeyOn').checked=CFG.JOURNEY_SKY; renderFxPicks();
}
function openSettings(){
  if(newLook){ newLook=false; syncLookDot(); saveSkinSave(); }
  if(state==='play'){ paused=true; drag=null; shake=0; hesVoid(); }           // the game waits while Settings is open
  renderLooks(); renderThemes(); renderWorlds(); renderSkins(); renderMotifs(); renderSndSet(); el('sndOn').checked=!muted; renderMusicPick(); el('journeyOn').checked=CFG.JOURNEY_SKY; renderFxPicks();
  el('setPanel').hidden=false;
}
el('setBtn').onclick=e=>{ e.stopPropagation(); openSettings(); };
el('startSettings').onclick=e=>{ e.stopPropagation(); openSettings(); };
el('setDone').onclick=e=>{ e.stopPropagation(); el('setPanel').hidden=true; if(!overlayOpen()) paused=false; };   // opened over the mode menu, the game still waits
// The hesitation log (plan 3.4) for Jay on her phone, where the home-screen app has no URL bar for ?dev: five quick
// taps on the note at the bottom of Settings turn it into the log's medians. Nothing changes for her otherwise.
let hesTaps=[];
el('setNote').onclick=e=>{
  e.stopPropagation();
  const now=performance.now(); hesTaps=hesTaps.filter(t=>now-t<3000); hesTaps.push(now);
  if(hesTaps.length<5) return;
  hesTaps=[]; const h=hesSummary(), sec=ms=>(ms/1000).toFixed(1)+'s';
  el('setNote').textContent=h.n?`Last ${h.n} trays (${h.total} kept): first pickup ${sec(h.pick)}, pickup to drop ${sec(h.place)}, first drop clears ${h.clr}%`:'No hesitation samples yet';
};
el('startBtn').onclick=e=>{e.stopPropagation();ac();mode='endless';lvl=null;saveMode();start();};
el('againBtn').onclick=e=>{e.stopPropagation();el('overCard').hidden=true;start();};
el('reviveBtn').onclick=e=>{e.stopPropagation();rescue();};

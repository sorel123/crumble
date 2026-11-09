// Crumble — Skins/worlds persistence and the player Settings panel.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ skins + worlds — unlockable/discoverable, persisted in localStorage ═══════ */
const SKIN_STORE='crumble.skins';
const PICKABLE_SKINS=SKINS.filter(s=>!s.event);       // transformation skins never appear here
let unlocked=new Set(SKINS.filter(s=>s.unlock<=0 && !s.event).map(s=>s.id));
function isUnlocked(id){ return CFG.UNLOCK_ALL || unlocked.has(id); }
function isWorldUnlocked(id){ return !TRANSFORMS[id] || CFG.UNLOCK_ALL_WORLDS || discoveredWorlds.has(id); }
function saveSkinSave(){
  try{ localStorage.setItem(SKIN_STORE,JSON.stringify({
    unlocked:[...unlocked], style:CFG.STYLE, motif:CFG.MOTIF,
    homeWorld:CFG.HOME_WORLD, discovered:[...discoveredWorlds],
    theme:CFG.THEME, sndSet:CFG.SND_SET, muted, lookV:2
  })); }catch(e){}
}
function loadSkinSave(){
  try{
    const o=JSON.parse(localStorage.getItem(SKIN_STORE)||'{}');
    if(Array.isArray(o.unlocked)) o.unlocked.forEach(id=>{ if(SKINS.some(s=>s.id===id)) unlocked.add(id); });
    if(Array.isArray(o.discovered)) o.discovered.forEach(id=>{ if(TRANSFORMS[id]) discoveredWorlds.add(id); });
    if(typeof o.style==='string' && unlocked.has(o.style)) CFG.STYLE=o.style;
    if(typeof o.motif==='string' && MOTIFS.some(m=>m.id===o.motif)) CFG.MOTIF=o.motif;
    if(typeof o.homeWorld==='string' && isWorldUnlocked(o.homeWorld)
      && (HOME_WORLDS.some(w=>w.id===o.homeWorld)||TRANSFORMS[o.homeWorld])) CFG.HOME_WORLD=o.homeWorld;
    if(THEMES.some(t=>t.id===o.theme)) CFG.THEME=o.theme;
    if(o.lookV!==2){ CFG.THEME='classic'; CFG.STYLE='blocks'; }   // 2026-10-30: everyone gets the new look once; Settings still changes it
    if(typeof o.sndSet==='string' && SOUND_SETS[o.sndSet]) CFG.SND_SET=o.sndSet;
    if(typeof o.muted==='boolean') setMuted(o.muted,false);
  }catch(e){}
}
// call whenever `best` changes; returns the names of any skins newly earned
function checkUnlocks(){
  const news=[];
  for(const s of PICKABLE_SKINS) if(!unlocked.has(s.id) && best>=s.unlock){ unlocked.add(s.id); news.push(s.name); }
  if(news.length){ saveSkinSave(); renderSkins(); }
  return news;
}
function setSkin(id){
  if(!isUnlocked(id)) return;
  CFG.STYLE=id; if(!transform){ curSkin=id; buildCache(); }       // mid-transformation it applies when that ends
  renderSkins(); saveSkinSave();
}
function setMotif(id){ CFG.MOTIF=id; buildCache(); renderMotifs(); saveSkinSave(); }
function setWorld(id){
  if(!isWorldUnlocked(id)) return;
  CFG.HOME_WORLD=id;
  if(!transform){ curWorld=id; ambient=spawnAmbient(worldDef(id).effect); ambientOld=[]; bgFrom=id; bgT=1; }
  renderWorlds(); saveSkinSave();
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
/* ═══════ the player's Settings: look + sound, saved as her defaults.
   (The admin panel — tuning, testing — opens from its footer in dev mode.) */
const SOUND_STYLES=[['original','Original'],['strings','Strings'],['steel','Steel drum'],['bells','Bells']];
function renderThemes(){
  el('themeGrid').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(CFG.THEME===b.dataset.id)));
}
function renderSndSet(){
  el('sndSetRow').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(CFG.SND_SET===b.dataset.id)));
}
function buildSettingsUI(){
  const make=(label,id,fn)=>{ const b=document.createElement('button'); b.type='button'; b.dataset.id=id;
    b.textContent=label; b.onclick=e=>{ e.stopPropagation(); fn(id); }; return b; };
  for(const t of THEMES) el('themeGrid').append(Object.assign(make(t.name,t.id,id=>{
    CFG.THEME=id; applyTheme(); renderThemes(); saveSkinSave(); }),{className:'skin-btn'}));
  for(const [id,label] of SOUND_STYLES) el('sndSetRow').append(make(label,id,v=>{
    CFG.SND_SET=v; renderSndSet(); saveSkinSave(); ac(); setTimeout(()=>Sfx.clear(1,0,1),60); }));   // a quick taste of the style
  el('sndOn').onchange=()=>setMuted(!el('sndOn').checked);
  renderThemes(); renderSndSet(); el('sndOn').checked=!muted;
}
function openSettings(){
  if(state==='play'){ paused=true; drag=null; shake=0; hesVoid(); }           // the game waits while Settings is open
  renderThemes(); renderWorlds(); renderSkins(); renderMotifs(); renderSndSet(); el('sndOn').checked=!muted;
  el('setPanel').hidden=false;
}
el('setBtn').onclick=e=>{ e.stopPropagation(); openSettings(); };
el('startSettings').onclick=e=>{ e.stopPropagation(); openSettings(); };
el('setDone').onclick=e=>{ e.stopPropagation(); el('setPanel').hidden=true; paused=false; };
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
el('startBtn').onclick=e=>{e.stopPropagation();ac();start();};
el('againBtn').onclick=e=>{e.stopPropagation();start();};
el('reviveBtn').onclick=e=>{e.stopPropagation();rescue();};

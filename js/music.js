// Crumble — Music (plan 7.4): real recorded loops, a picker, a quiet pressure response, ducking under the sound family.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ music ═══════
   Four recorded loops (music/*.m4a, CC0, see HANDOFF.md for source and licence), picked by mood for tweens. Nothing is
   synthesised any more: if a file cannot be fetched the game is simply quiet.
   - `createMusic(ctx,out)` builds the graph on any context (the live one, or an offline one in the tests): looping buffer
     source -> track trim -> low-pass -> lift -> duck -> volume -> `out`. `play(buf,idx)` crossfades to another loop.
   - Intensity (0 calm .. 1 tight) opens the low-pass (the room gets brighter) and lifts the level a touch. It follows
     `scr.p` (6.6) and eases back when she gets clear.
   - `duck(level,secs)` dips the whole music under a clear or a special; `arbFlush` in audio.js calls it with the winning event.
   - Settings > Sound has a switch (`CFG.MUSIC`), a picker (`CFG.MUSIC_PICK`: shuffle, one track, or Off which is the switch)
     and the Admin volume. Files are fetched on first use only (the service worker keeps them), and only the playing
     track is kept decoded. */
const MUSIC_TRACKS=[
  {id:'sunny',   name:'Sunny',       file:'music/sunny-lofi.m4a', gain:1.1 },    // warm, bright, laid-back
  {id:'bounce',  name:'Bounce',      file:'music/bounce.m4a',     gain:.85 },    // playful, funky
  {id:'daydream',name:'Daydream',    file:'music/daydream.m4a',   gain:1.0 },    // dreamy and calm
  {id:'momentum',name:'Momentum',    file:'music/momentum.m4a',   gain:.7  }     // a little more driving
];
const MUSIC_PICKS=[['shuffle','Shuffle'],...MUSIC_TRACKS.map(t=>[t.id,t.name]),['off','Off']];
const musicLpHz=i=>6500+11500*i, musicLift=i=>1+.3*i;       // the pressure response: brighter and a touch louder
const musicDuckLevel=p=>p>=6?.28:p>=4?.38:p>=2?.5:.64;       // how far the music dips under an event of this priority (audio.js EVT)

function createMusic(c,out){
  const E={c,i:0,idx:-1,cur:null,running:true,duckLvl:1,duckEnd:0};
  const vol=c.createGain(); vol.gain.value=0; vol.connect(out);
  const duck=c.createGain(); duck.connect(vol);
  const lift=c.createGain(); lift.connect(duck);
  const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=musicLpHz(0); lp.Q.value=.5; lp.connect(lift);
  E.nodes={vol,duck,lift,lp};
  E.start=(t,level)=>{ vol.gain.cancelScheduledValues(t); vol.gain.setValueAtTime(0,t); vol.gain.setTargetAtTime(level,t,.9); };   // a slow fade in
  E.play=(buf,idx,t=c.currentTime,fade=1.4)=>{                  // start a loop; any loop already playing fades out under it
    const g=c.createGain(), s=c.createBufferSource();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(MUSIC_TRACKS[idx].gain,t+fade);
    s.buffer=buf; s.loop=true; s.connect(g); g.connect(lp); s.start(t);
    const old=E.cur;
    if(old){ old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value,t); old.g.gain.linearRampToValueAtTime(0,t+fade); try{ old.s.stop(t+fade+.05); }catch(e){} }
    E.cur={s,g,idx}; E.idx=idx;
  };
  E.setLevel=(level,at=c.currentTime)=>{ vol.gain.setTargetAtTime(level,at,.3); };
  E.setI=(i,at=c.currentTime)=>{ E.i=i; lp.frequency.setTargetAtTime(musicLpHz(i),at,.6); lift.gain.setTargetAtTime(musicLift(i),at,.6); };
  E.duck=(level,secs,at=c.currentTime)=>{
    const g=duck.gain;
    if(at<E.duckEnd&&level>E.duckLvl) level=E.duckLvl;           // already ducked deeper: keep that, just stretch it
    E.duckLvl0=at<E.duckEnd?E.duckLvl:1; E.duckLvl=level; E.duckEnd=Math.max(E.duckEnd,at+secs);
    const cur=at>c.currentTime?1:(at<E.duckEnd?E.duckLvl0:1);   // where it is now, tracked here rather than read back from the param
    g.cancelScheduledValues(at); g.setValueAtTime(cur,at);
    g.setTargetAtTime(level,at,.04); g.setTargetAtTime(1,E.duckEnd,.45);
  };
  E.stop=(secs=.6)=>{
    if(!E.running) return; E.running=false;
    const t=c.currentTime; vol.gain.cancelScheduledValues(t); vol.gain.setValueAtTime(vol.gain.value,t); vol.gain.setTargetAtTime(0,t,secs/3);
    if(E.cur) try{ E.cur.s.stop(t+secs*2); }catch(e){}
    setTimeout(()=>{ try{ vol.disconnect(); }catch(e){} },secs*3000+800);
  };
  return E;
}

/* ── live: one engine at a time, on the live context, driven by a 120 ms timer ── */
let musicE=null, musicTimer=0, musicMi=0, musicLast=0, musicLvl=0, musicTrackNo=Date.now()%MUSIC_TRACKS.length;   // (not Math.random: the tests seed it and a dealt tray depends on it)
const musicBufs={};                                              // track index -> promise of its decoded buffer (only the playing one is kept)
const musicLevel=()=>CFG.MUSIC_VOL*.5;
const musicPickIdx=()=>MUSIC_TRACKS.findIndex(t=>t.id===CFG.MUSIC_PICK);   // -1 while shuffling
function musicLoad(idx){
  if(!musicBufs[idx]) musicBufs[idx]=fetch(MUSIC_TRACKS[idx].file).then(r=>{ if(!r.ok&&r.status!==0) throw new Error('music '+r.status); return r.arrayBuffer(); })   // the iPhone app's capacitor:// files answer with status 0
    .then(ab=>new Promise((ok,no)=>{ const p=actx.decodeAudioData(ab,ok,no); if(p&&p.catch) p.catch(no); }))   // the callback form works on older Safari
    .catch(()=>{ delete musicBufs[idx]; return null; });          // offline and never played before: quiet, and tried again next run
  return musicBufs[idx];
}
async function musicPlay(){                                      // make the engine play musicTrackNo (crossfading if something else plays)
  const E=musicE, idx=musicTrackNo; if(!E||E.idx===idx) return;
  const buf=await musicLoad(idx);
  if(!buf||musicE!==E||musicTrackNo!==idx||E.idx===idx) return;
  E.play(buf,idx,actx.currentTime+.05,E.idx<0?.05:1.4);
  for(const k of Object.keys(musicBufs)) if(+k!==idx) delete musicBufs[k];
}
function musicTarget(){ return state==='play'?Math.max(0,Math.min(1,(scr.p-.15)/.6)):0; }   // calm and building barely register; an edge is ~1
function musicTick(){
  if(!musicE||!actx) return;
  const now=actx.currentTime, dt=Math.max(0,Math.min(1,now-musicLast)); musicLast=now;
  const t=musicTarget(); musicMi+=(t-musicMi)*(1-Math.exp(-dt/(t>musicMi?1.8:1.1)));       // tightens slowly, lets go a little faster
  if(musicLvl!==musicLevel()){ musicLvl=musicLevel(); musicE.setLevel(musicLvl); }   // the Admin slider
  if(Math.abs(musicMi-musicE.i)>.003||(t===0&&musicE.i!==0)) musicE.setI(musicMi<.003&&t===0?0:musicMi,now);   // not every tick forever
  if(musicE.idx!==musicTrackNo&&!musicE.loading){ musicE.loading=true; musicPlay().finally(()=>{ if(musicE) musicE.loading=false; }); }   // also retries a failed fetch
}
function musicSync(){                                           // call whenever the switch, the tab or the context changes
  const want=CFG.MUSIC&&actx&&!document.hidden;
  if(!want){ if(musicE){ musicE.stop(); musicE=null; clearInterval(musicTimer); } return; }
  if(musicE){ musicE.setLevel(musicLevel()); return; }
  if(musicPickIdx()>=0) musicTrackNo=musicPickIdx();
  musicE=createMusic(actx,musBus); musicMi=0; musicLast=actx.currentTime;
  musicLvl=musicLevel(); musicE.start(actx.currentTime+.15,musicLvl);
  musicTick(); musicTimer=setInterval(musicTick,120);
}
function musicNewRun(){                                         // shuffling, a new game gets another loop; a chosen track stays
  if(musicPickIdx()>=0) musicTrackNo=musicPickIdx();
  else musicTrackNo=(musicTrackNo+1+(stats.games%(MUSIC_TRACKS.length-1)))%MUSIC_TRACKS.length;
}
function musicSetPick(id){                                      // the Settings picker: 'shuffle', a track id, or 'off' (the switch)
  if(id==='off'){ CFG.MUSIC=false; }
  else{ CFG.MUSIC_PICK=id; CFG.MUSIC=true; if(musicPickIdx()>=0) musicTrackNo=musicPickIdx(); }
  musicSync(); syncSoundBtns();
}
function musicDuck(p,secs){ if(musicE&&p>0) musicE.duck(musicDuckLevel(p),Math.min(2,secs)); }
document.addEventListener('visibilitychange',musicSync);

// Crumble — Calm music (plan 6.8): a small generative score, a quiet tension layer, ducking under the sound family.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ music ═══════
   Not recorded: the game makes it, like the original synth sounds. Three short pieces (`MUSIC_TRACKS`), each an 8-bar loop of
   slow chords (a soft pad and a bass note) with a few bell notes on top, all in a major pentatonic so nothing can clash. It
   costs no download and no licence, and it can do what a loop cannot: follow the room on the board.
   - `musicPlan(track,bar)` is pure (the same notes every time round) and is what the tests read.
   - `createMusic(ctx,out)` builds the voices on any context (the live one, or an offline one in the tests) and `sched()` fills
     the time ahead of it, a beat at a time, so a change in intensity is heard within a beat.
   - Intensity (0 calm .. 1 tight) fades in a second layer: a low drone with a faint minor-ninth beating against it, a soft
     heartbeat, a darker pad filter and thinner bells. It follows `scr.p` (6.6) and eases back out when she gets clear.
   - `duck(level,secs)` dips the whole music under a clear or a special; `arbFlush` in audio.js calls it with the winning event.
   - Music has its own Settings toggle (`CFG.MUSIC`, on by default at a low `CFG.MUSIC_VOL`) and is independent of Sound effects. */
const MUSIC_TRACKS=[
  {name:'Morning',bpm:64,scale:[72,74,76,79,81,84,86,88],            // C major pentatonic
   chords:[{bass:48,pad:[64,67,71,76]},{bass:45,pad:[64,67,72,76]},{bass:41,pad:[65,69,72,76]},{bass:43,pad:[62,67,71,76]}]},
  {name:'Drift',bpm:60,scale:[74,76,78,81,83,86,88,90],               // D major pentatonic
   chords:[{bass:50,pad:[66,69,73,78]},{bass:47,pad:[66,69,74,78]},{bass:43,pad:[67,71,74,78]},{bass:45,pad:[66,69,73,76]}]},
  {name:'Lantern',bpm:68,scale:[69,72,74,77,79,81,84,86],             // F major pentatonic
   chords:[{bass:41,pad:[64,67,72,76]},{bass:38,pad:[65,69,72,77]},{bass:46,pad:[62,65,69,74]},{bass:48,pad:[64,67,72,76]}]}
];
const MUSIC_BARS=8, MUSIC_SLOTS=[0,1,1.5,2,3,3.5], mtof=m=>440*Math.pow(2,(m-69)/12);
function musicRng(seed){                                  // small seeded generator: a loop must come out the same every time
  let a=seed>>>0;
  return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; };
}
/* One bar of one track: its chord and the bell slots. A slot plays when its `q` is below `p0` scaled by the density,
   so calm music keeps more of them and tense music keeps only the strongest (the beat-0 and beat-2 bells). */
function musicPlan(tr,bar){
  const T=MUSIC_TRACKS[((tr%MUSIC_TRACKS.length)+MUSIC_TRACKS.length)%MUSIC_TRACKS.length];
  const b=((bar%MUSIC_BARS)+MUSIC_BARS)%MUSIC_BARS, rnd=musicRng(tr*977+b*131+7), n=T.scale.length;
  let idx=Math.floor(rnd()*n/2)+(b>=4?2:0);                // the second half of the phrase sits a little higher
  const bells=[];
  for(const beat of MUSIC_SLOTS){
    idx=Math.max(0,Math.min(n-1,idx+Math.floor(rnd()*5)-2));   // a gentle walk, never a leap
    const p0=(beat===0||beat===2)?.65:.3;
    bells.push({beat,midi:T.scale[idx],p0,q:rnd()});
  }
  return {chord:T.chords[b%4],bells,bpm:T.bpm};
}
const musicDensity=i=>1-.65*i;
const musicDuckLevel=p=>p>=6?.28:p>=4?.38:p>=2?.5:.64;       // how far the music dips under an event of this priority (audio.js EVT)

function createMusic(c,out){
  const E={c,i:0,track:0,nextTrack:0,bar:0,beat:0,next:0,running:false,duckLvl:1,duckEnd:0};
  const vol=c.createGain(); vol.gain.value=0; vol.connect(out);
  const duck=c.createGain(); duck.connect(vol);
  const mix=c.createGain(); mix.connect(duck);
  const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2600; lp.Q.value=.3; lp.connect(mix);   // the pad's filter: darker as it gets tight
  const bellOut=c.createGain(); bellOut.connect(mix);                                                          // bells: dry plus a soft echo
  const dl=c.createDelay(1), fb=c.createGain(), dlp=c.createBiquadFilter();
  dl.delayTime.value=.46; fb.gain.value=.3; dlp.type='lowpass'; dlp.frequency.value=2200;
  bellOut.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(mix);
  // the tension layer: persistent voices, only their levels move
  const tg=c.createGain(); tg.gain.value=0; tg.connect(mix);
  const n9=c.createGain(); n9.gain.value=0; n9.connect(mix);
  const drone=[-6,6].map(cents=>{ const o=c.createOscillator(); o.type='triangle'; o.detune.value=cents; o.frequency.value=mtof(60); o.connect(tg); return o; });
  const ninth=c.createOscillator(); ninth.type='sine'; ninth.frequency.value=mtof(73); ninth.connect(n9);          // root + minor ninth: a faint unease
  for(const o of [...drone,ninth]) o.start();
  E.nodes={vol,duck,mix,lp,tg,n9};

  const env=(g,t,peak,atk,end,rel)=>{                          // fade up, hold, fade out ending around `end`
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+atk);
    g.gain.setTargetAtTime(0,end,rel);
  };
  E.chord=(t,bar)=>{                                            // pad + bass for one bar; also retunes the drone to the bass
    const P=musicPlan(E.track,bar), spb=60/P.bpm, len=4*spb;
    for(const m of P.chord.pad){
      const g=c.createGain(); g.connect(lp);
      env(g,t,.075,1.6,t+len-.1,.5);
      for(const [type,det] of [['sine',-4],['triangle',5]]){
        const o=c.createOscillator(); o.type=type; o.detune.value=det; o.frequency.value=mtof(m); o.connect(g); o.start(t); o.stop(t+len+3);
      }
    }
    const b=c.createGain(); b.connect(mix); env(b,t,.11,.5,t+len-.4,.45);
    const bo=c.createOscillator(); bo.type='triangle'; bo.frequency.value=mtof(P.chord.bass); bo.connect(b); bo.start(t); bo.stop(t+len+3);
    for(const o of drone) o.frequency.setTargetAtTime(mtof(P.chord.bass+12),t,.4);
    ninth.frequency.setTargetAtTime(mtof(P.chord.bass+13+12),t,.4);
    return P;
  };
  E.bell=(t,midi,vel)=>{
    const f=mtof(midi), g=c.createGain(), o=c.createOscillator(), o2=c.createOscillator(), g2=c.createGain();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.05*vel,t+.006); g.gain.setTargetAtTime(0,t+.006,.55);
    o.type='sine'; o.frequency.value=f; o2.type='sine'; o2.frequency.value=f*2.76; g2.gain.value=.14;     // a hint of glass overtone
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bellOut);
    o.start(t); o2.start(t); o.stop(t+3.4); o2.stop(t+3.4);
  };
  E.beat1=(t,vel)=>{                                            // one soft heartbeat thump (two close together on the beat)
    for(const [dt,v] of [[0,1],[.2,.6]]){
      const o=c.createOscillator(), g=c.createGain();
      o.type='triangle'; o.frequency.setValueAtTime(190,t+dt); o.frequency.exponentialRampToValueAtTime(110,t+dt+.18);
      g.gain.setValueAtTime(0,t+dt); g.gain.linearRampToValueAtTime(.16*vel*v,t+dt+.01); g.gain.setTargetAtTime(0,t+dt+.01,.07);
      o.connect(g); g.connect(mix); o.start(t+dt); o.stop(t+dt+.7);
    }
  };
  E.start=(t,track,level)=>{
    E.track=E.nextTrack=track; E.bar=0; E.beat=0; E.next=t; E.running=true;
    vol.gain.cancelScheduledValues(t); vol.gain.setValueAtTime(0,t); vol.gain.setTargetAtTime(level,t,1.3);   // a slow fade in
  };
  E.setLevel=(level,at=c.currentTime)=>{ vol.gain.setTargetAtTime(level,at,.3); };
  E.setI=(i,at=c.currentTime)=>{                                // intensity 0..1: the second layer and a darker pad
    E.i=i; tg.gain.setTargetAtTime(.1*i,at,.4); n9.gain.setTargetAtTime(.022*i*i,at,.4); lp.frequency.setTargetAtTime(2600-1100*i,at,.6);
  };
  E.duck=(level,secs,at=c.currentTime)=>{
    const g=duck.gain;
    if(at<E.duckEnd&&level>E.duckLvl) level=E.duckLvl;           // already ducked deeper: keep that, just stretch it
    E.duckLvl0=at<E.duckEnd?E.duckLvl:1; E.duckLvl=level; E.duckEnd=Math.max(E.duckEnd,at+secs);
    const cur=at>c.currentTime?1:(at<E.duckEnd?E.duckLvl0:1);   // where it is now, tracked here rather than read back from the param
    g.cancelScheduledValues(at); g.setValueAtTime(cur,at);
    g.setTargetAtTime(level,at,.04); g.setTargetAtTime(1,E.duckEnd,.45);
  };
  E.sched=until=>{                                              // schedule every beat that starts before `until`
    while(E.running&&E.next<until){
      const t=E.next, b=E.beat;
      if(b===0){ if(E.bar%MUSIC_BARS===0) E.track=E.nextTrack; E.cur=E.chord(t,E.bar); }
      const spb=60/MUSIC_TRACKS[E.track].bpm;
      const P=E.cur;
      for(const s of P.bells) if(s.beat>=b&&s.beat<b+1&&s.q<s.p0*musicDensity(E.i)) E.bell(t+(s.beat-b)*spb,s.midi,.7+.3*s.q/s.p0);
      if(E.i>.28&&(b===0||b===2)) E.beat1(t,Math.min(1,(E.i-.2)*1.3));
      E.next+=spb; E.beat++; if(E.beat===4){ E.beat=0; E.bar++; }
    }
  };
  E.stop=(secs=.6)=>{
    if(!E.running) return; E.running=false;
    const t=c.currentTime; vol.gain.cancelScheduledValues(t); vol.gain.setValueAtTime(vol.gain.value,t); vol.gain.setTargetAtTime(0,t,secs/3);
    for(const o of [...drone,ninth]) try{ o.stop(t+secs*2); }catch(e){}
    setTimeout(()=>{ try{ vol.disconnect(); fb.disconnect(); }catch(e){} },secs*3000+800);   // let a dead engine (and its echo loop) go
  };
  return E;
}

/* ── live: one engine at a time, on the live context, driven by a 120 ms timer ── */
let musicE=null, musicTimer=0, musicMi=0, musicLast=0, musicLvl=0, musicTrackNo=Date.now()%MUSIC_TRACKS.length;   // (not Math.random: the tests seed it and a dealt tray depends on it)
const musicLevel=()=>CFG.MUSIC_VOL*.5;
function musicTarget(){ return state==='play'?Math.max(0,Math.min(1,(scr.p-.15)/.6)):0; }   // calm and building barely register; an edge is ~1
function musicTick(){
  if(!musicE||!actx) return;
  const now=actx.currentTime, dt=Math.max(0,Math.min(1,now-musicLast)); musicLast=now;
  const t=musicTarget(); musicMi+=(t-musicMi)*(1-Math.exp(-dt/(t>musicMi?1.8:1.1)));       // tightens slowly, lets go a little faster
  if(musicLvl!==musicLevel()){ musicLvl=musicLevel(); musicE.setLevel(musicLvl); }   // the Admin slider
  if(Math.abs(musicMi-musicE.i)>.003||(t===0&&musicE.i!==0)) musicE.setI(musicMi<.003&&t===0?0:musicMi,now);   // not every tick forever
  musicE.sched(now+.7);
}
function musicSync(){                                           // call whenever the switch, the tab or the context changes
  const want=CFG.MUSIC&&actx&&!document.hidden;
  if(!want){ if(musicE){ musicE.stop(); musicE=null; clearInterval(musicTimer); } return; }
  if(musicE){ musicE.setLevel(musicLevel()); return; }
  musicE=createMusic(actx,musBus); musicMi=0; musicLast=actx.currentTime;
  musicLvl=musicLevel(); musicE.start(actx.currentTime+.15,musicTrackNo,musicLvl);
  musicTick(); musicTimer=setInterval(musicTick,120);
}
function musicNewRun(){                                         // a new game gets another piece, from the next 8-bar phrase
  musicTrackNo=(musicTrackNo+1+(stats.games%(MUSIC_TRACKS.length-1)))%MUSIC_TRACKS.length;
  if(musicE) musicE.nextTrack=musicTrackNo;
}
function musicDuck(p,secs){ if(musicE&&p>0) musicE.duck(musicDuckLevel(p),Math.min(2,secs)); }
document.addEventListener('visibilitychange',musicSync);

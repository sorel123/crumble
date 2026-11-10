// Crumble — Audio engine: synth sets, recorded bank, Sfx dispatcher.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ audio ═══════
   Fully synthesized. Chain: voices -> master gain -> compressor -> out,
   so stacked sounds (a sweep on top of a combo) don't clip. One shared
   noise buffer is built when the context is created (first user gesture,
   which browsers require) and reused by every noise hit.
   ═══════════════════════════════════════════════════════════════ */
let actx=null,sfxGain=1,muted=false,master=null,nbuf=null,revIn=null,setSpeaker=()=>{},origBus=null,smpBus=null,musBus=null;
/* The whole chain, built on whatever context it's handed (the live one, or an
   offline one for rendering/tests): sounds -> master -> soft high-shelf ->
   safety limiter -> out, plus a small reverb send any sound can feed via
   `wet` (a synthetic room — decaying stereo noise — so it costs no file). */
function buildChain(c){
  const m=c.createGain(); m.gain.value=.8;                           // headroom: peaks sit well under full scale
  const tame=c.createBiquadFilter(); tame.type='highshelf'; tame.frequency.value=7000; tame.gain.value=-5;
  const lim=c.createDynamicsCompressor();                            // a safety limiter only — it should almost never act.
  lim.threshold.value=-3; lim.knee.value=0; lim.ratio.value=20;      // (a real compressor here also adds automatic makeup
  lim.attack.value=.002; lim.release.value=.12;                      //  gain, which is what squashed the mix)
  const hp1=c.createBiquadFilter(), hp2=c.createBiquadFilter();   // phone-speaker mode: bass below ~220Hz can't be played
  for(const h of [hp1,hp2]){ h.type='highpass'; h.Q.value=.7; }    // by a tiny speaker — fed to one, it just buzzes and
  // the original synth sounds get their own copy of the same pair (ohp1/ohp2), so the speaker filter reaches them too
  const ohp1=c.createBiquadFilter(), ohp2=c.createBiquadFilter();
  for(const h of [ohp1,ohp2]){ h.type='highpass'; h.Q.value=.7; }
  // the music (6.8) gets its own pair too: it is level-controlled in music.js, so it skips the limiter, but it still goes through the speaker filter
  const mhp1=c.createBiquadFilter(), mhp2=c.createBiquadFilter();
  for(const h of [mhp1,mhp2]){ h.type='highpass'; h.Q.value=.7; }
  const setSpeaker=on=>{ for(const h of [hp1,hp2,ohp1,ohp2,mhp1,mhp2]) h.frequency.value=on?220:10; };   // distorts, like a blown speaker
  setSpeaker(CFG.PHONE_SPEAKER);
  m.connect(hp1); hp1.connect(hp2); hp2.connect(tame); tame.connect(lim); lim.connect(c.destination);
  const len=Math.floor(c.sampleRate*1.0), ir=c.createBuffer(2,len,c.sampleRate), fade=c.sampleRate*.006;
  for(let ch=0;ch<2;ch++){                                           // a small, dark room — a touch of air, not a hall
    const d=ir.getChannelData(ch);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,4.5)*(i<fade?i/fade:1);
  }
  const conv=c.createConvolver(); conv.buffer=ir;
  const rin=c.createGain(); rin.gain.value=.35;
  const dark=c.createBiquadFilter(); dark.type='lowpass'; dark.frequency.value=3500;
  const thin=c.createBiquadFilter(); thin.type='highpass'; thin.frequency.value=150;
  rin.connect(conv); conv.connect(dark); dark.connect(thin); thin.connect(lim);
  const nb=c.createBuffer(1,c.sampleRate,c.sampleRate), nd=nb.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;             // 1s of white noise, shared by every noise hit
  // recorded sounds: already mixed and mastered, so no processing at all — not even a limiter (a browser
  // compressor isn't transparent on short hits: it shaved ~5dB off one sitting well under its threshold).
  // Headroom comes from the levels instead: every sample is normalized to -1dBFS and played well below it.
  const smp=c.createGain(); smp.gain.value=1; smp.connect(c.destination);
  // the original synth sounds, on the exact chain they were written for
  const og=c.createGain(); og.gain.value=.9;
  const ocomp=c.createDynamicsCompressor();
  ocomp.threshold.value=-18; ocomp.knee.value=12; ocomp.ratio.value=6; ocomp.attack.value=.003; ocomp.release.value=.2;
  og.connect(ohp1); ohp1.connect(ohp2); ohp2.connect(ocomp); ocomp.connect(c.destination);
  const mus=c.createGain(); mus.gain.value=1; mus.connect(mhp1); mhp1.connect(mhp2); mhp2.connect(c.destination);
  return {master:m,revIn:rin,nbuf:nb,setSpeaker,smp,orig:og,mus};
}
/* phone-speaker default (6.4): on for touch devices unless she has chosen either way (the Settings toggle
   saves crumble.speaker; the Admin panel's saved tuning counts too). A web page can't tell headphones apart. */
function speakerDefault(){
  try{
    if(localStorage.getItem('crumble.speaker')!==null) return;
    const dev=JSON.parse(localStorage.getItem(DEV_STORE)||'{}');
    if(dev.PHONE_SPEAKER!==undefined) return;
  }catch(e){}
  CFG.PHONE_SPEAKER=matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0;
}
function ac(){
  if(!actx){
    speakerDefault();
    actx=new (window.AudioContext||window.webkitAudioContext)();
    ({master,revIn,nbuf,setSpeaker,smp:smpBus,orig:origBus,mus:musBus}=buildChain(actx));
    // iOS can interrupt the context (a call, Siri, the app switcher): ask for it back when it's not running
    actx.addEventListener('statechange',()=>{ if(actx.state!=='running') actx.resume().catch(()=>{}); });
    loadBank(); musicSync();
  }
  if(actx.state!=='running') actx.resume().catch(()=>{});
  return actx;
}
/* Phase 7.0: first touch unlocks sound, in Safari too. iOS only accepts a resume() made inside a touch or
   click; a pointerdown in the middle of a drag (a resumed run skips the start card) is not one of those. So
   every touchend/click/pointerup/key at document level, capture phase, runs unlockAudio() before the game sees
   it. A silent looping <audio> element is played after the first unlock: it keeps the ring/silent switch from
   muting Web Audio (iOS treats a playing media element as playback, not ambient). Re-played on every gesture
   and when the page comes back, in case iOS paused it. */
let silentEl=null;
function silentUrl(){                                  // a 0.25 s silent mono WAV, built once, no file to ship
  const n=11025, b=new DataView(new ArrayBuffer(44+n*2)), s=(o,t)=>{ for(let i=0;i<t.length;i++) b.setUint8(o+i,t.charCodeAt(i)); };
  s(0,'RIFF'); b.setUint32(4,36+n*2,true); s(8,'WAVE'); s(12,'fmt '); b.setUint32(16,16,true);
  b.setUint16(20,1,true); b.setUint16(22,1,true); b.setUint32(24,11025,true); b.setUint32(28,22050,true);
  b.setUint16(32,2,true); b.setUint16(34,16,true); s(36,'data'); b.setUint32(40,n*2,true);
  return URL.createObjectURL(new Blob([b.buffer],{type:'audio/wav'}));
}
function unlockAudio(){
  try{ ac(); }catch(e){}
  try{
    if(!silentEl){ silentEl=new Audio(silentUrl()); silentEl.loop=true; silentEl.preload='auto'; }
    if(silentEl.paused) silentEl.play().catch(()=>{});
  }catch(e){}
}
for(const ev of ['touchend','pointerup','click','keydown'])
  document.addEventListener(ev,unlockAudio,{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{      // back from the background: iOS may have paused both
  if(document.visibilityState==='visible'&&actx) unlockAudio();
});
const jit=()=>1+(Math.random()*.06-.03);            // ±3% pitch per trigger — physical sounds only, never musical ones
const hz=f=>clamp(f,20,12000);
function send(node,wet){                             // dry to master, plus `wet` of it into the reverb
  node.connect(master);
  if(wet){ const w=actx.createGain(); w.gain.value=wet; node.connect(w); w.connect(revIn); }
}

/* filtered noise slice with its own envelope; f0 -> f1 sweeps the filter.
   Used both as the attack transient on every sound and as bursts/washes. */
function noiseHit(t,{dur=.012,f0=3000,f1=f0,q=1,vol=.1,type='bandpass',wet=0,atk=Math.min(.004,dur/3)}){
  const c=actx, src=c.createBufferSource(), f=c.createBiquadFilter(), g=c.createGain();
  src.buffer=nbuf; f.type=type; f.Q.value=q;
  f.frequency.setValueAtTime(hz(f0),t);
  if(f1!==f0) f.frequency.exponentialRampToValueAtTime(hz(f1),t+dur);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol*sfxGain,t+atk);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(f); f.connect(g); send(g,wet);
  src.loop=true;                                                    // a long hit just wraps the 1s buffer
  src.start(t,Math.random()*Math.max(0,nbuf.duration-dur-.05)); src.stop(t+dur+.01);
}
/* 2-3 detuned oscillators with a pitch envelope (f0 -> f1 over `pdur`),
   through a resonant bandpass whose centre also sweeps (bp0 -> bp1 over
   `pdur`). `dur` is the amplitude decay and can outlast the pitch move —
   a short, sharp pitch drop under a longer ring (pdur defaults to dur). */
function voice(t,{f0,f1=f0,dur,pdur=dur,vol,bp0,bp1=bp0,q=4,type='sawtooth',det=[-8,0,8],atk=.005,wet=0}){
  const c=actx, out=c.createGain(), bp=c.createBiquadFilter();
  bp.type='bandpass'; bp.Q.value=q;
  bp.frequency.setValueAtTime(hz(bp0),t);
  bp.frequency.exponentialRampToValueAtTime(hz(bp1),t+pdur);
  out.gain.setValueAtTime(.0001,t);
  out.gain.exponentialRampToValueAtTime(vol*sfxGain/det.length,t+atk);
  out.gain.exponentialRampToValueAtTime(.0001,t+dur);
  bp.connect(out); send(out,wet);
  for(const cents of det){
    const o=c.createOscillator();
    o.type=type; o.detune.value=cents;
    o.frequency.setValueAtTime(hz(f0),t);
    o.frequency.exponentialRampToValueAtTime(hz(f1),t+pdur);
    o.connect(bp); o.start(t); o.stop(t+dur+.02);
  }
}
/* a clean hit: one oscillator, optional small pitch drop, and a natural
   exponential decay (setTarget, ~-35dB by `dur`) — no filter in the way, so
   a short thump actually reaches its level instead of being smeared out */
function tone(t,{f0,f1=f0,pdur=.03,dur=.1,vol=.1,atk=.002,type='sine',wet=0}){
  const o=actx.createOscillator(), g=actx.createGain();
  o.type=type; o.frequency.setValueAtTime(hz(f0),t);
  if(f1!==f0) o.frequency.exponentialRampToValueAtTime(hz(f1),t+pdur);
  g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol*sfxGain,t+atk); g.gain.setTargetAtTime(0,t+atk,dur/4);
  o.connect(g); send(g,wet); o.start(t); o.stop(t+atk+dur*1.4+.02);
}
function boom(t,vol,wet=.1){
  tone(t,{f0:130,f1:62,pdur:.25,dur:.55,vol,wet});
  tone(t,{f0:260,f1:124,pdur:.25,dur:.4,vol:vol*.3});             // a little harmonic so a phone still hears it
  tone(t,{f0:390,f1:186,pdur:.25,dur:.3,vol:vol*.12});
}
/* a struck bell: pure sine partials, each with its own exponential decay.
   glock = bright inharmonic chime; marimba = rounder, woody, short. */
const BELLS={            // [frequency ratio, amplitude, share of the note's decay]
  glock:  [[1,1,1],[2,.12,.55],[2.76,.09,.4],[5.4,.03,.22]],
  marimba:[[1,1,1],[3.99,.28,.3],[10.1,.07,.1]]
};
function bell(t,{f,dur=.9,vol=.08,wet=.25,kind='glock',atk=.003}){
  const c=actx, out=c.createGain(); out.gain.value=vol*sfxGain; send(out,wet);
  for(const [ratio,amp,share] of BELLS[kind]){
    const fr=f*ratio; if(fr>14000) continue;
    const o=c.createOscillator(), g=c.createGain(), d=dur*share;
    o.type='sine'; o.frequency.value=fr;
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(amp,t+atk);
    g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+d+.02);
  }
}
/* everything musical sits on one major pentatonic scale, so any two
   sounds that overlap — a clear, a praise sting, a combo — are consonant */
const PENTA=[0,2,4,7,9];
const note=step=>392*Math.pow(2,(Math.floor(step/5)*12+PENTA[((step%5)+5)%5])/12);      // step 0 = G4
/* speaker test (settings panel): plain steady tones to pin down distortion.
   'clean' goes straight to the output, bypassing everything this game does —
   if that one sounds blown out, the problem is the device, not the sounds. */
function testTone(kind){
  const c=ac(), t=c.currentTime+.03, o=c.createOscillator(), g=c.createGain();
  o.frequency.value=kind==='low'?150:440;
  g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.2,t+.03);
  g.gain.setValueAtTime(.2,t+.7); g.gain.linearRampToValueAtTime(0,t+.75);
  o.connect(g); g.connect(kind==='clean'?c.destination:master); o.start(t); o.stop(t+.8);
}
/* run a sound: skip when muted, start the clock at `delay`, never throw */
function play(delay,fn){
  if(muted) return;
  try{ const c=ac(); fn(c.currentTime+delay,jit()); }catch(e){}
}

/* ── 'bells' set: the synthesized bell sounds (pentatonic, reverb). */
const BELLS_SFX={
  /* a line clear: a quick bell arpeggio — one line rings two notes, each
     extra line adds another, and each link in a combo starts a step higher,
     so a streak climbs the scale */
  clear(total=1,delay=.07,combo=1){ play(delay,t=>{
    const s0=Math.min(8,combo-1), n=Math.min(6,1+total);
    noiseHit(t,{dur:.22,f0:900,f1:4500,q:.7,vol:.018,type:'bandpass',wet:.25});        // soft air
    for(let i=0;i<n;i++) bell(t+i*.055,{f:note(s0+i*2),dur:.9,vol:.07,wet:.3});
    bell(t,{f:note(s0)/2,dur:.5,vol:.12,wet:.1,kind:'marimba'});                        // low warmth under it
  }); },
  combo(combo=2,total=1,delay=.07){
    this.clear(total,delay,combo);
    play(delay+.03,t=>{ for(let i=0;i<Math.min(6,combo);i++)                          // a sparkle that grows with the streak
      noiseHit(t+i*.035,{dur:.035,f0:6500+i*500,q:10,vol:.014,wet:.35}); });
  },
  /* praise sting — the answer to a big clear: a quick run up into a chord,
     bigger and longer each tier. Lands just after the clear's own notes. */
  praise(tier){ play(.2,t=>{
    const run=[0,2,3,5,7][tier];
    for(let i=0;i<run;i++) bell(t+i*.045,{f:note(5+i),dur:.35,vol:.045,wet:.3});
    const tc=t+run*.045, chord=tier>=3?[5,7,8,10]:tier>=2?[5,7,8]:[5,8];
    chord.forEach((st,i)=>bell(tc+i*.014,{f:note(st),dur:1.1+tier*.25,vol:.06,wet:.38}));
    bell(tc,{f:note(0)/2,dur:.8,vol:.1,wet:.15,kind:'marimba'});
    if(tier>=3) for(let i=0;i<6+tier*2;i++)
      noiseHit(tc+.05+i*.055,{dur:.04,f0:6500+Math.random()*3000,q:9,vol:.016,wet:.45});
    if(tier>=4) boom(tc,.2);
  }); },
  sweep(delay=.1){ play(delay,t=>{
    boom(t,.28);                                                                             // boom
    noiseHit(t,{dur:1.0,f0:400,f1:7000,q:1.5,vol:.05,wet:.4});                              // rising wash
    for(let i=0;i<8;i++) bell(t+.04+i*.06,{f:note(i),dur:.5,vol:.05,wet:.35});               // run up two octaves
    const tc=t+.52;
    [5,7,8,10,12].forEach((st,i)=>bell(tc+i*.015,{f:note(st),dur:1.8,vol:.055,wet:.45}));
    bell(tc,{f:note(0)/2,dur:1,vol:.08,wet:.2,kind:'marimba'});
    for(let i=0;i<8;i++) noiseHit(tc+.06+i*.08,{dur:.045,f0:6500+Math.random()*3500,q:10,vol:.018,wet:.5});
  }); },
  phew(total=1,delay=.07,combo=1){ if(combo>1) this.combo(combo,total,delay); else this.clear(total,delay,combo); play(delay+.04,t=>{                // (6.5) the narrow escape: the clear plus one stronger accent
    [7,10,12].forEach((st,i)=>bell(t+i*.04,{f:note(st+5),dur:1,vol:.07,wet:.3})); }); },
  fanfare(){ this.praise(3); },                                                            // (6.5) NEW BEST / LEVEL CLEARED
  deny(){ play(0,(t,p)=>{
    tone(t,{f0:175*p,f1:125*p,pdur:.09,dur:.13,vol:.1,atk:.006});             // a soft 'nope', not a buzz
    tone(t+.07,{f0:150*p,f1:110*p,pdur:.08,dur:.1,vol:.07,atk:.006});
  }); },
  star(n=6){ play(.02,t=>{                                                                      // charge, then the hit at t+.14 as the beams fire
    noiseHit(t,{dur:.14,f0:900,f1:5200,q:3,vol:.03,wet:.3});                                 // rising whoosh while it charges
    boom(t+.14,.2,.2);                                                                       // the hit
    noiseHit(t+.14,{dur:.2,f0:4500,f1:700,q:2,vol:.05,wet:.25});                             // falling zap along the beams
    const k=Math.min(10,3+Math.ceil(n/2));
    for(let i=0;i<k;i++) bell(t+.17+i*.035,{f:note([0,2,4,7,9,12,14,16,19,21][i%10]+5),dur:.7,vol:.045,wet:.35});   // chime cascade, timed to the ripple
    for(let i=0;i<5;i++) noiseHit(t+.22+i*.05,{dur:.04,f0:7000+Math.random()*3000,q:10,vol:.016,wet:.4});
  }); },
  starIn(){ play(0,t=>{ [12,16,19,24].forEach((st,i)=>bell(t+i*.06,{f:note(st),dur:.9,vol:.045,wet:.4})); }); },   // it has been dealt
  starPick(){ play(0,t=>{ noiseHit(t,{dur:.12,f0:1800,f1:6000,q:4,vol:.018,wet:.3}); bell(t+.04,{f:note(19),dur:.5,vol:.03,wet:.3}); }); },
  goldenIn(){ play(.05,t=>{
    noiseHit(t,{dur:.18,f0:5000,f1:10000,q:6,vol:.02,wet:.4});
    [5,8,10,13].forEach((st,i)=>bell(t+i*.06,{f:note(st),dur:.7,vol:.05,wet:.4}));          // bright bell run
  }); },
  goldenWin(){ play(.15,t=>{
    boom(t,.24);
    for(let i=0;i<8;i++) bell(t+.04+i*.055,{f:note(3+i),dur:.5,vol:.05,wet:.35});           // rising run
    const tc=t+.5;
    [5,7,8,10,13].forEach((st,i)=>bell(tc+i*.015,{f:note(st),dur:1.9,vol:.055,wet:.45}));
    for(let i=0;i<9;i++) noiseHit(tc+.05+i*.07,{dur:.045,f0:6500+Math.random()*3500,q:10,vol:.018,wet:.5});
  }); },
  rescue(){ play(0,t=>{
    [0,2,4].forEach((st,i)=>bell(t+i*.07,{f:note(st+5),dur:i===2?.9:.4,vol:.06,wet:.3}));
  }); },
  achieve(i=0){ play(.05,t=>{                                                                  // an achievement card: a bright rising run, a different key for each of the four
    [0,4,7,12].forEach((st,k)=>bell(t+k*.075,{f:note(st+[2,5,7,9][i%4]),dur:k===3?1.1:.5,vol:.05,wet:.4}));
  }); },
  transformShift(){ play(0,t=>{
    noiseHit(t,{dur:.5,f0:600,f1:5000,q:1.2,vol:.03,wet:.45});                                // whoosh
    [0,4,7,10].forEach((st,i)=>bell(t+.08+i*.07,{f:note(st+2),dur:1,vol:.05,wet:.45}));
  }); }
};

/* ── 'original' set: the game's sounds as they were at 063f7f8, before the
   sound reworks — same code, on the same master/compressor chain (origBus).
   One fix: noise longer than the 1s buffer loops instead of throwing, which
   had been silently cutting the clean-sweep fanfare off after its boom. */
function oNoise(t,{dur=.012,f0=3000,f1=f0,q=1,vol=.1,type='bandpass'}){
  const c=actx, src=c.createBufferSource(), f=c.createBiquadFilter(), g=c.createGain();
  src.buffer=nbuf; src.loop=true; f.type=type; f.Q.value=q;
  f.frequency.setValueAtTime(hz(f0),t);
  if(f1!==f0) f.frequency.exponentialRampToValueAtTime(hz(f1),t+dur);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol*sfxGain,t+Math.min(.004,dur/3));
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(f); f.connect(g); g.connect(origBus);
  src.start(t,Math.random()*Math.max(0,nbuf.duration-dur-.05)); src.stop(t+dur+.01);
}
function oVoice(t,{f0,f1=f0,dur,vol,bp0,bp1=bp0,q=4,type='sawtooth',det=[-8,0,8],atk=.005}){
  const c=actx, out=c.createGain(), bp=c.createBiquadFilter();
  bp.type='bandpass'; bp.Q.value=q;
  bp.frequency.setValueAtTime(hz(bp0),t);
  bp.frequency.exponentialRampToValueAtTime(hz(bp1),t+dur);
  out.gain.setValueAtTime(.0001,t);
  out.gain.exponentialRampToValueAtTime(vol*sfxGain/det.length,t+atk);
  out.gain.exponentialRampToValueAtTime(.0001,t+dur);
  bp.connect(out); out.connect(origBus);
  for(const cents of det){
    const o=c.createOscillator();
    o.type=type; o.detune.value=cents;
    o.frequency.setValueAtTime(hz(f0),t);
    o.frequency.exponentialRampToValueAtTime(hz(f1),t+dur);
    o.connect(bp); o.start(t); o.stop(t+dur+.02);
  }
}
const ORIG_SFX={
  pickup(v=1){ if(v<=0) return; play(0,(t,p)=>{     // v = the Admin volume (CFG.SND_PICKUP_VOL); 0 = silent (a 0 ramp would throw)
    oNoise(t,{dur:.008,f0:7000*p,q:1,vol:.012*v});
    oVoice(t,{f0:880*p,f1:1050*p,dur:.06,vol:.05*v,bp0:1800*p,q:1.5,type:'triangle',det:[-5,5]});
  }); },
  place(v=1){ if(v<=0) return; play(0,(t,p)=>{      // v = the Admin volume (CFG.SND_PLACE_VOL); 0 = silent
    oNoise(t,{dur:.012,f0:3200*p,q:.9,vol:.045*v});
    oVoice(t,{f0:520*p,f1:200*p,dur:.09,vol:.1*v,bp0:1100*p,bp1:400*p,q:1.4,type:'triangle',det:[-6,0,6],atk:.002});
    oVoice(t,{f0:240*p,f1:150*p,dur:.08,vol:.04*v,bp0:400,q:.8,type:'sine',det:[0]});
  }); },
  clear(total=1,delay=.1){ play(delay,(t,p)=>{
    const k=1+.06*(total-1), base=392*p*k;
    oNoise(t,{dur:.28,f0:500*p,f1:2600*p,q:.7,vol:.035,type:'lowpass'});
    [1,1.25,1.5].forEach((m,i)=>{
      const f=base*m;
      oVoice(t+i*.05,{f0:f,f1:f*1.01,dur:.32,vol:.08,bp0:f*1.5,q:.7,type:'triangle',det:[-4,4],atk:.012});
      oVoice(t+i*.05,{f0:f*2,f1:f*2,dur:.22,vol:.025,bp0:f*2,q:.7,type:'sine',det:[0],atk:.012});
    });
    oVoice(t,{f0:base/2,f1:base/2,dur:.3,vol:.08,bp0:base,q:.6,type:'sine',det:[0],atk:.01});
  }); },
  combo(combo=2,total=1,delay=.1){ play(delay,(t,p)=>{
    const base=Math.min(880,330*Math.pow(1.12,combo-1))*p;
    oNoise(t,{dur:.4,f0:400*p,f1:3200*p,q:.7,vol:.04,type:'lowpass'});
    [1,1.25,1.5,2].forEach((m,i)=>{
      const f=base*m;
      oVoice(t+i*.06,{f0:f,f1:f*1.01,dur:.4,vol:.085,bp0:f*1.5,q:.7,type:'triangle',det:[-4,4],atk:.012});
      oVoice(t+i*.06,{f0:f*2,f1:f*2,dur:.28,vol:.025,bp0:f*2,q:.7,type:'sine',det:[0],atk:.012});
    });
    oVoice(t,{f0:base/2,f1:base/2,dur:.45,vol:.1,bp0:base,q:.6,type:'sine',det:[0],atk:.01});
  }); },
  phew(total=1,delay=.1,combo=1){ if(combo>1) this.combo(combo,total,delay); else this.clear(total,delay); play(delay+.04,(t,p)=>{                    // (6.5) the narrow escape: the clear plus one stronger accent
    [1.5,2,3].forEach((m,i)=>oVoice(t+i*.04,{f0:659*p*m,f1:659*p*m*1.01,dur:.45,vol:.07,bp0:1800,q:2,type:'triangle',det:[-4,4],atk:.006})); }); },
  fanfare(){ this.goldenIn(); },                                                           // (6.5) NEW BEST / LEVEL CLEARED
  praise(tier){ if(tier>=3) this.goldenIn(); },          // the original game had no praise words; the big ones borrow its bell run
  sweep(delay=.1){ play(delay,(t,p)=>{
    oNoise(t,{dur:.02,f0:3500*p,q:.8,vol:.2});
    oVoice(t,{f0:110*p,f1:38*p,dur:.9,vol:.7,bp0:300,bp1:90,q:1.2,type:'sine',det:[0]});
    oNoise(t,{dur:1.1,f0:300*p,f1:9000*p,q:5,vol:.2});
    for(let i=0;i<6;i++){
      const f=392*p*Math.pow(1.2,i);
      oVoice(t+.05+i*.07,{f0:f,f1:f*1.04,dur:.4,vol:.12,bp0:f*2,bp1:f*6,q:5,type:'triangle'});
    }
    const top=392*p*Math.pow(1.2,5);
    [1,1.25,1.5,2].forEach(m=>oVoice(t+.5,{f0:top*m/2,f1:top*m/2,dur:1.0,vol:.09,bp0:top*m,bp1:top*m*3,q:3,det:[-12,0,12]}));
    for(let i=0;i<7;i++) oNoise(t+.55+i*.09,{dur:.05,f0:(6000+Math.random()*4000)*p,q:10,vol:.05,type:'bandpass'});
  }); },
  deny(){ play(0,(t,p)=>{
    oNoise(t,{dur:.01,f0:1500*p,q:1,vol:.04});
    oVoice(t,{f0:130*p,f1:95*p,dur:.14,vol:.14,bp0:500*p,bp1:250*p,q:2});
  }); },
  star(n=6){ play(.02,(t,p)=>{
    oNoise(t,{dur:.14,f0:1000*p,f1:5000*p,q:2,vol:.05});                                     // charge
    oVoice(t+.14,{f0:150*p,f1:48*p,dur:.4,vol:.2,bp0:600,bp1:150,q:1.5,type:'sine'});        // the hit
    oVoice(t+.14,{f0:1800*p,f1:200*p,dur:.3,vol:.1,bp0:3200,bp1:500,q:3,type:'sawtooth'});   // zap
    const k=Math.min(9,3+Math.ceil(n/2));
    for(let i=0;i<k;i++){
      const f=784*p*[1,1.125,1.25,1.5,1.667,2,2.25,2.5,3][i%9];
      oVoice(t+.17+i*.035,{f0:f,f1:f*1.01,dur:.4,vol:.06,bp0:f*2,q:2,type:'triangle',det:[-4,4],atk:.006});
    }
    for(let i=0;i<6;i++) oNoise(t+.22+i*.05,{dur:.04,f0:(7000+Math.random()*4000)*p,q:10,vol:.04});
  }); },
  starIn(){ play(0,(t,p)=>{ [1.5,2,2.5,3].forEach((m,i)=>oVoice(t+i*.06,{f0:659*p*m,f1:659*p*m*1.01,dur:.5,vol:.05,bp0:1800,q:2,type:'triangle',det:[-4,4],atk:.006})); }); },
  starPick(){ play(0,(t,p)=>{ oNoise(t,{dur:.1,f0:2000*p,f1:6500*p,q:3,vol:.04}); }); },
  goldenIn(){ play(.05,(t,p)=>{
    oNoise(t,{dur:.18,f0:5000*p,f1:11000*p,q:6,vol:.03});
    [1,1.5,2,3].forEach((m,i)=>{
      const f=659*p*m;
      oVoice(t+i*.06,{f0:f,f1:f*1.005,dur:.5,vol:.06,bp0:f*2,q:2,type:'sine',det:[-3,3],atk:.008});
    });
  }); },
  goldenWin(){ play(.15,(t,p)=>{
    oNoise(t,{dur:.02,f0:4000*p,q:.8,vol:.15});
    oVoice(t,{f0:130*p,f1:55*p,dur:.7,vol:.5,bp0:300,bp1:100,q:1.2,type:'sine',det:[0]});
    [1,1.125,1.25,1.5,1.667,2,2.25,2.5].forEach((m,i)=>{
      const f=523*p*m;
      oVoice(t+.04+i*.06,{f0:f,f1:f*1.02,dur:.5,vol:.1,bp0:f*2,bp1:f*5,q:3,type:'triangle'});
    });
    const top=523*p*2.5;
    [1,1.25,1.5,2].forEach(m=>oVoice(t+.55,{f0:top*m/2,f1:top*m/2,dur:1.2,vol:.08,bp0:top*m,bp1:top*m*3,q:3,det:[-12,0,12]}));
    for(let i=0;i<9;i++) oNoise(t+.5+i*.08,{dur:.05,f0:(6000+Math.random()*5000)*p,q:10,vol:.05});
  }); },
  rescue(){ play(0,(t,p)=>{
    oNoise(t,{dur:.012,f0:4000*p,q:1,vol:.06});
    [523,659,784].forEach((f,i)=>oVoice(t+i*.07,{f0:f*p,f1:f*p*1.03,dur:i===2?.35:.2,vol:.12,bp0:f*p*2,bp1:f*p*5,q:4,type:'triangle'}));
  }); },
  achieve(i=0){ play(.05,(t,p)=>{
    [1,1.25,1.5,2].forEach((m,k)=>{ const f=440*p*m*Math.pow(2,[2,5,7,9][i%4]/12);
      oVoice(t+k*.075,{f0:f,f1:f*1.01,dur:k===3?.7:.3,vol:.06,bp0:f*1.6,q:2,type:'triangle',det:[-4,4],atk:.008}); });
  }); },
  transformShift(){ play(0,(t,p)=>{
    oNoise(t,{dur:.5,f0:800*p,f1:4000*p,q:2,vol:.03,type:'lowpass'});
    [1,1.33,1.6].forEach((m,i)=>{
      const f=440*p*m;
      oVoice(t+i*.09,{f0:f,f1:f*1.02,dur:.55,vol:.06,bp0:f*1.6,q:2,type:'sine',det:[-4,4],atk:.01});
    });
  }); }
};

let bank={}, bankLoading=false, bankFail=0;
function loadBank(){
  if(bankLoading) return; bankLoading=true;
  for(const [name,b64] of Object.entries(SAMPLES)){
    const bin=atob(b64), u=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
    actx.decodeAudioData(u.buffer,buf=>{
      const d=buf.getChannelData(0); let pk=0; for(const v of d) pk=Math.max(pk,Math.abs(v));
      let on=0; while(on<d.length&&Math.abs(d[on])<pk*.01) on++;            // skip the MP3 encoder's leading silence
      bank[name]={buf,off:Math.max(0,on-Math.floor(buf.sampleRate*.001))/buf.sampleRate};
    },()=>{ bankFail++; });
  }
}
// play one recorded sound: `rate` shifts pitch (and speed) the way a real sample does
function smp(name,{vol=1,rate=1,delay=0}={}){
  const b=bank[name]; if(!b||muted) return;
  try{
    const t=actx.currentTime+delay, src=actx.createBufferSource(), g=actx.createGain();
    src.buffer=b.buf; src.playbackRate.value=rate; g.gain.value=vol*sfxGain;
    src.connect(g); g.connect(smpBus); src.start(t,b.off);
  }catch(e){}
}
const semis=n=>Math.pow(2,n/12);
const PENTA_UP=[0,2,4,7,9,12,14,16,19,21];                  // combo links climb a major pentatonic scale
function recordedSet(jingle,other){                          // jingle: 'pz' | 'st'; other: the other instrument
  return {
    clear(total=1,delay=.07,combo=1){                        // (6.5) a crisp dry impact, then a glass tail per line, pitched up the scale by combo
      const step=PENTA_UP[Math.min(PENTA_UP.length-1,combo-1)];
      smp('pl_drop',{vol:.12*Math.min(1.6,1+.2*(total-1)),rate:.85,delay});                                                  // the impact (a placement's click, a touch lower and bigger with more lines)
      for(let i=0;i<Math.min(3,total);i++) smp('glass',{vol:[.18,.09,.06][i],rate:semis(step+[0,7,12][i]),delay:delay+.02+i*.06});   // ~-16dB
    },
    combo(combo=2,total=1,delay=.07){ this.clear(total,delay,combo); },     // the same sound, one step higher each link
    phew(total=1,delay=.07,combo=1){ this.clear(total,delay,combo);         // (6.5) the narrow escape: the clear plus one stronger accent
      [7,12,19].forEach((st,i)=>smp('glass',{vol:.13,rate:semis(st),delay:delay+.1+i*.045})); smp('swell',{vol:.1,rate:1.4,delay:delay+.08}); },
    fanfare(){ smp(jingle+'10',{vol:.26,delay:.05}); },                      // (6.5) NEW BEST / LEVEL CLEARED
    praise(tier){ smp(jingle+['16','08','10','15'][tier-1],{vol:.2+.03*tier,delay:.18}); },   // only rising, happy jingles; ~-13 to -10dB
    sweep(delay=.1){ smp('pl_drop',{vol:.2,rate:.7,delay}); smp(jingle+'02',{vol:.32,delay}); smp('glass',{vol:.1,rate:semis(12),delay}); },   // (6.5) one short rising phrase that resolves; it owns the mix
    deny(){ smp('err',{vol:.07}); },
    star(n=6){ smp('swell',{vol:.14,rate:1.6,delay:0});                                      // charge
      smp(jingle+'02',{vol:.3,delay:.14}); smp('swell',{vol:.2,rate:.6,delay:.14});         // the hit: a low swell under the bright jingle
      const k=Math.min(9,3+Math.ceil(n/2));
      for(let i=0;i<k;i++) smp('glass',{vol:.11,rate:semis(PENTA_UP[i%10]+7),delay:.17+i*.035}); },   // glass cascade up the scale
    starIn(){ [12,16,19,24].forEach((st,i)=>smp('glass',{vol:.1,rate:semis(st),delay:i*.06})); },
    starPick(){ smp('glass',{vol:.06,rate:semis(19)}); },
    goldenIn(){ smp('confirm',{vol:.16,delay:.05}); },
    goldenWin(){ smp(other+'02',{vol:.32,delay:.15}); smp('swell',{vol:.14,rate:.6,delay:.15}); },   // (6.5) the old gong layer is this low swell now
    rescue(){ smp('rescue',{vol:.18}); },
    achieve(i=0){ [0,4,7,12].forEach((st,k)=>smp('glass',{vol:.1,rate:semis(st+[2,5,7,9][i%4]),delay:k*.075})); },
    transformShift(){ smp('swell',{vol:.16}); }
  };
}
const SOUND_SETS={strings:recordedSet('pz','st'), steel:recordedSet('st','pz'), original:ORIG_SFX, bells:BELLS_SFX};
const PICKUP_SMP={slide:['pk_slide',.028], soft:['pk_soft',.018], swish:['pk_swish',.04]};  // [sample, level] — ~-32dB, the quietest thing in the game
const PLACE_SMP={drop:['pl_drop',.11], wood:['pl_wood',.11], soft:['pl_soft',.07]};       // ~-20dB

/* what the game calls: pickup/place follow their own choices; everything else follows the chosen set */
const Sfx={
  pickup(){
    const k=CFG.SND_PICKUP;
    if(k==='original') return ORIG_SFX.pickup(CFG.SND_PICKUP_VOL);
    const v=PICKUP_SMP[k]; if(v){ ac(); smp(v[0],{vol:v[1]*CFG.SND_PICKUP_VOL,rate:jit()}); }
  },
  place(n=1){                                                // bigger pieces land a touch lower
    const k=CFG.SND_PLACE;
    if(k==='original') return ORIG_SFX.place(CFG.SND_PLACE_VOL);
    const v=PLACE_SMP[k]; if(v){ ac(); smp(v[0],{vol:v[1]*CFG.SND_PLACE_VOL,rate:jit()*Math.pow(.97,Math.max(0,n-1))}); }
  }
};
function setMuted(on,save=true){
  muted=on; el('mute').textContent=muted?'🔈':'🔊';
  const box=el('sndOn'); if(box) box.checked=!muted;
  if(save) saveSkinSave();
}
el('mute').onclick=e=>{ e.stopPropagation(); setMuted(!muted); };
/* The bonus trays' own sounds (plan 6.2; they were the Blast Round's). Synthesized and the same in every sound set, so no
   other moment in the game shares them: a rising whoosh into a low hit and a fast saw run (start), a bright bell rise
   (meter full), and a bell cadence over a soft hit (bonus over). */
const SHARED_SFX={                                    // the same in every set (they are the bonus trays' and the golden hand's own)
  snuff(){ play(0,t=>{                                // (7.5d) combo fire goes out: a soft falling breath of air and a low puff
    noiseHit(t,{dur:.38,f0:2600,f1:450,q:.9,vol:.035,wet:.2,atk:.025});
    noiseHit(t+.01,{dur:.2,f0:380,f1:160,q:.7,vol:.03,type:'lowpass',atk:.01});
  }); },
  bonusReady(){ play(0,t=>{ [0,4,7,12].forEach((s,i)=>bell(t+i*.07,{f:784*semis(s),dur:.8,vol:.06,wet:.3})); }); },
  bonusStart(){ play(.02,t=>{
    noiseHit(t,{dur:.45,f0:300,f1:6000,q:1.2,vol:.06,wet:.2,atk:.38});                  // the whoosh up
    boom(t+.42,.3);
    noiseHit(t+.42,{dur:.3,f0:2600,f1:500,q:.8,vol:.08,wet:.25});
    [0,4,7,12,16,19].forEach((s,i)=>{ const f=392*semis(s);
      voice(t+.46+i*.055,{f0:f,dur:.24,vol:.07,bp0:f*2,q:2,type:'sawtooth',det:[-7,7],wet:.2}); });
  }); },
  goldenStep(n){ play(0,t=>{ bell(t,{f:659*semis([0,2,4,7,9,12][Math.max(0,n-1)%6]),dur:.7,vol:.06,wet:.35}); bell(t+.07,{f:1318*semis([0,2,4,7,9,12][Math.max(0,n-1)%6]),dur:.5,vol:.03,wet:.35}); }); },   // a rising note per planned line
  bonusEnd(){ play(.05,t=>{
    boom(t,.18);
    [19,16,12,7,12,19].forEach((s,i)=>bell(t+i*.09,{f:392*semis(s),dur:.9,vol:.065,wet:.3}));
  }); }
};

/* ═══ (7.5c) the anticipation hum ═══
   While she drags a piece toward a landing that completes a line, a soft tone fades in under everything and glides up
   from G4 to D5 (both on the game's pentatonic) as the piece gets there, with a light shimmer that quickens. It is not an
   event (no arbiter, no ducking): it is a held voice whose level follows `k` (0..1) every frame, and it is silent again
   the moment the piece lands, goes back, or the drag is cancelled. The same in every sound set, on the synth chain, so the
   phone-speaker filter reaches it. Never creates the audio context: until her first touch has made one, it does nothing. */
let hum=null, humK=0;
const HUM_LO=392, HUM_HI=392*Math.pow(2,7/12);
function humSet(k){
  k=CFG.ANTICIPATION_HUM&&!muted&&actx&&actx.state==='running'?Math.max(0,Math.min(1,k)):0;
  if(Math.abs(k-humK)<.01&&!(k===0&&humK!==0)) return;            // only move the voice when it really changes
  humK=k;
  if(!hum){
    if(k===0) return;
    const c=actx, g=c.createGain(), trem=c.createGain(), lfo=c.createOscillator(), depth=c.createGain();
    g.gain.value=0; trem.gain.value=1; depth.gain.value=0;
    lfo.type='sine'; lfo.frequency.value=5; lfo.connect(depth); depth.connect(trem.gain);
    const o1=c.createOscillator(), o2=c.createOscillator(), g2=c.createGain();
    o1.type='sine'; o2.type='triangle'; o1.frequency.value=HUM_LO; o2.frequency.value=HUM_LO*2; o2.detune.value=4; g2.gain.value=.22;
    o1.connect(trem); o2.connect(g2); g2.connect(trem); trem.connect(g); g.connect(master);
    for(const o of [o1,o2,lfo]) o.start();
    hum={g,o1,o2,lfo,depth};
  }
  const t=actx.currentTime, f=HUM_LO+(HUM_HI-HUM_LO)*k;
  hum.g.gain.setTargetAtTime(k>0?.05*CFG.HUM_VOL*Math.pow(k,1.4):0,t,k>0?.08:.05);
  hum.o1.frequency.setTargetAtTime(f,t,.06); hum.o2.frequency.setTargetAtTime(f*2,t,.06);
  hum.lfo.frequency.setTargetAtTime(5+5*k,t,.1); hum.depth.gain.setTargetAtTime(.25*k,t,.1);
}

/* ═══ one sound family: who gets the mix (plan 6.5) ═══
   Every event the game raises (all but pickup/place, which are quiet ticks of their own) goes through a small arbiter.
   Events raised in the same tick are collected and the highest priority plays in full; the others are dropped, played
   ducked, or deferred until it is over. A winner then keeps the mix for `hold` seconds, so a clear a moment after a
   clean sweep sits under it. Result: one main sound per moment, never a pile of jingles.
     p     priority (0 = never audible next to anything else)
     hold  seconds the event keeps the mix
     same  what happens when something outranks it in the same tick: drop | duck | defer (play once the winner is over)
   Outranked by a still-running winner from an earlier tick, a 'drop' event that matters (p>0) is ducked instead. */
const DUCK=.4;
const EVT={
  starPick:  {p:0,hold:0,  same:'drop'},
  snuff:     {p:1,hold:.3, same:'duck'},     // (7.5d) the combo fire goes out
  clear:     {p:1,hold:.5, same:'duck'},     // the impact + glass tail; ducked under a jingle, dropped by a moment that carries its own impact (see arbFlush)
  deny:      {p:1,hold:.2, same:'duck'},
  combo:     {p:2,hold:.7, same:'duck'},     // the same clear sound, a step higher
  goldenStep:{p:1,hold:.5, same:'duck'},     // sits beside the clear (same priority), under a combo
  goldenIn:  {p:2,hold:.4, same:'duck'},
  starIn:    {p:2,hold:.4, same:'duck'},
  transformShift:{p:2,hold:.8,same:'defer'},
  praise:    {p:a=>a[0]>=3?3:0,hold:.9,same:'drop'},   // small praise is just the word on screen; only the big tiers are heard
  achieve:   {p:3,hold:1,  same:'defer'},
  bonusReady:{p:3,hold:.9, same:'defer'},
  bonusEnd:  {p:3,hold:1,  same:'duck'},
  rescue:    {p:3,hold:.5, same:'duck'},
  star:      {p:4,hold:1.1,same:'duck'},
  phew:      {p:4,hold:.9, same:'duck'},       // a clear plus one stronger accent
  bonusStart:{p:4,hold:1.2,same:'duck'},
  fanfare:   {p:5,hold:1.3,same:'duck'},       // NEW BEST, LEVEL CLEARED
  sweep:     {p:6,hold:1.6,same:'duck'},       // the biggest thing the board does
  goldenWin: {p:6,hold:1.8,same:'duck'}
};
let arbQ=[], arbLead={p:0,until:0};
function arbPlay(e,gain){
  sfxGain=gain;                                      // the primitives scale their level by this while the event schedules its notes
  try{ const set=SOUND_SETS[CFG.SND_SET]||SOUND_SETS.original, o=SHARED_SFX[e.fn]?SHARED_SFX:set; o[e.fn]&&o[e.fn](...e.a); }
  catch(err){}
  finally{ sfxGain=1; }
}
function arbFlush(){
  const q=arbQ; arbQ=[]; if(!q.length||!actx) return;
  const now=actx.currentTime, lead=now<arbLead.until?arbLead.p:0;
  const top=Math.max(lead,...q.map(e=>e.p));
  let hold=0, win=0; const later=[];
  for(const e of q){
    if(e.p>=top){ arbPlay(e,1); if(e.p>0){ hold=Math.max(hold,e.hold); win=Math.max(win,e.p); } continue; }
    const sameTick=q.some(o=>o.p>e.p);
    const own=(e.fn==='clear'||e.fn==='combo')&&sameTick&&(top>=4||(e.fn==='clear'&&q.some(o=>o.fn==='combo')));   // a sweep, star, escape, bonus start... brings its own impact; a combo is the clear
    const how=e.p===0||own?'drop':sameTick?e.same:(e.same==='drop'?'duck':e.same);
    if(how==='duck') arbPlay(e,DUCK);
    else if(how==='defer'){ if(e.late) arbPlay(e,DUCK); else later.push(e); }
  }
  if(hold>0){ arbLead={p:top,until:Math.max(arbLead.until,now+hold)}; if(!muted) musicDuck(win,hold); }   // 6.8: the music dips under whatever won
  for(const e of later) setTimeout(()=>sfxEvent(e.fn,e.a,true),Math.max(0,(arbLead.until-now)*1000)+40);
}
function sfxEvent(fn,a,late=false){
  const d=EVT[fn]; ac();
  arbQ.push({fn,a,late,p:typeof d.p==='function'?d.p(a):d.p,hold:d.hold,same:d.same});
  if(arbQ.length===1) queueMicrotask(arbFlush);
}
for(const fn of Object.keys(EVT)) Sfx[fn]=(...a)=>sfxEvent(fn,a);

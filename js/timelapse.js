// Crumble — Timelapse of the run on the game-over card (plan 7.5g).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ recording ═══════
   After the opening and after every drop the board is kept as one N*N-character string: '.' for an empty cell, the
   gem index ('0'-'9') for a gem. Board pictures, not moves, so stars, rescues and specials need no re-simulation.
   tl = {s: stride (a picture every s drops), n: drops so far, f: [pictures]}. It rides in the run snapshot (save.js)
   and is capped at TL_MAX pictures (~6 KB): at the cap every other picture goes and the stride doubles, so a long run
   still spans start to end. Switch: Settings > Look > Advanced "Timelapse" (CFG.FX_TIMELAPSE, saved as `tl`); off,
   nothing is recorded and the card shows no board. */
const TL_MAX=96;
let tl={s:1,n:0,f:[]};
const tlPic=g=>g.map(r=>r.map(v=>v?String(v.gi):'.').join('')).join('');
function tlReset(){ tlStop(); tl={s:1,n:0,f:[]}; if(CFG.FX_TIMELAPSE) tl.f.push(tlPic(grid)); }   // start(): the opening board
function tlRecord(){                                  // place(): the board once this drop's clear is resolved
  if(!CFG.FX_TIMELAPSE) return;
  tl.n++; if(tl.n%tl.s) return;
  const p=tlPic(grid); if(p===tl.f[tl.f.length-1]) return;
  tl.f.push(p);
  if(tl.f.length>TL_MAX){ tl.f=tl.f.filter((_,i)=>i%2===0); tl.s*=2; }
}
function tlSnap(){ return {s:tl.s,n:tl.n,f:tl.f.slice()}; }
function tlLoad(o){                                   // restore(): older saves have none, so the timelapse starts at the resumed board
  const ok=o&&isInt(o.s,1,1e6)&&isInt(o.n,0,1e7)&&Array.isArray(o.f)&&o.f.length<=TL_MAX+1
    &&o.f.every(p=>typeof p==='string'&&p.length===N*N&&/^[.0-9]+$/.test(p));
  tl=ok?{s:o.s,n:o.n,f:o.f.slice()}:{s:1,n:0,f:[]};
  if(!tl.f.length&&CFG.FX_TIMELAPSE) tl.f.push(tlPic(grid));
}
// the run's pictures for the card and the share image: the recorded ones plus the board she ended on
function tlFrames(){
  const f=tl.f.slice(), end=tlPic(grid);
  if(f[f.length-1]!==end) f.push(end);
  return f;
}

/* ═══════ the replay ═══════
   A small board under the game-over message plays the pictures over TL_MIN_MS..TL_MAX_MS, easing out, each new
   gem popping in and each cleared one fading away, then holds on the final board with a soft gold flash. Its own
   short rAF loop draws only while it moves. The card's buttons are live from the first frame: nothing waits on it.
   A tap while it plays skips to the end; a tap after the end plays it again. Reduced motion: the final board only. */
const TL_MIN_MS=2000, TL_MAX_MS=4500, TL_PER_MS=70, TL_CSS=148;
const tlPlay={raf:0,t0:0,dur:0,f:null,done:true,flash:0};
function tlColor(ch,a){ const g=GEMS[+ch]||GEMS[0]; return 'hsla('+g.h+','+g.s+'%,'+(g.gold?58:62)+'%,'+a+')'; }
function tlDraw(pos){                                 // pos: 0..frames-1, fractional between two pictures
  const cv=el('tlBoard'), g=cv.getContext('2d'), f=tlPlay.f, dpr=Math.min(3,devicePixelRatio||1);
  const px=Math.round(TL_CSS*dpr); if(cv.width!==px){ cv.width=cv.height=px; }
  const i=Math.min(f.length-1,Math.floor(pos)), k=pos-i, a=f[i], b=f[Math.min(f.length-1,i+1)];
  const pad=px*0.05, cs=(px-pad*2)/N, gap=cs*0.09, rad=cs*0.22;
  g.clearRect(0,0,px,px);
  g.fillStyle='rgba(0,0,0,.28)'; g.beginPath(); g.roundRect(0,0,px,px,px*0.08); g.fill();
  g.fillStyle='rgba(255,255,255,.07)'; g.beginPath();   // every empty slot in one path, one fill
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) g.roundRect(pad+c*cs+gap,pad+r*cs+gap,cs-gap*2,cs-gap*2,rad);
  g.fill();
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    const j=r*N+c, x=pad+c*cs, y=pad+r*cs, was=a[j], now=b[j];
    let ch=was, sc=1, al=1;
    if(was==='.'&&now!=='.'){ ch=now; sc=0.4+0.6*k+Math.sin(k*Math.PI)*0.18; al=Math.min(1,k*2); }   // a gem lands: it pops in
    else if(was!=='.'&&now==='.'){ sc=1-0.35*k; al=1-k; }                                        // a gem is cleared: it shrinks away
    else if(was!==now&&now!=='.') ch=k<.5?was:now;
    if(ch==='.'||al<=0) continue;
    const w=(cs-gap*2)*sc, o=(cs-w)/2;
    g.fillStyle=tlColor(ch,al); g.beginPath(); g.roundRect(x+o,y+o,w,w,rad*sc); g.fill();
  }
  if(tlPlay.flash>0){                                  // the end: a gold rim breathes once
    g.strokeStyle='rgba(255,216,107,'+(tlPlay.flash*0.9).toFixed(3)+')'; g.lineWidth=px*0.03;
    g.beginPath(); g.roundRect(g.lineWidth/2,g.lineWidth/2,px-g.lineWidth,px-g.lineWidth,px*0.08); g.stroke();
  }
}
function tlStep(now){
  tlPlay.raf=0;
  if(el('overCard').hidden||!tlPlay.f) return;
  const last=tlPlay.f.length-1;
  if(!tlPlay.done){
    const u=Math.min(1,(now-tlPlay.t0)/tlPlay.dur), e=1-Math.pow(1-u,2.2);   // eases out: the end of the run lingers
    tlDraw(e*last);
    if(u>=1){ tlPlay.done=true; tlPlay.t0=now; }
  } else {
    tlPlay.flash=Math.max(0,1-(now-tlPlay.t0)/700); tlDraw(last);
    if(tlPlay.flash<=0) return;                        // still: no more frames
  }
  tlPlay.raf=requestAnimationFrame(tlStep);
}
function tlStart(){
  if(tlPlay.raf){ cancelAnimationFrame(tlPlay.raf); tlPlay.raf=0; }
  const f=tlPlay.f, last=f.length-1;
  tlPlay.dur=Math.max(TL_MIN_MS,Math.min(TL_MAX_MS,last*TL_PER_MS));
  if(reduce){ tlPlay.done=true; tlPlay.flash=0; tlDraw(last); return; }
  tlPlay.done=false; tlPlay.flash=0; tlPlay.t0=performance.now(); tlDraw(0);
  tlPlay.raf=requestAnimationFrame(tlStep);
}
function tlShow(){                                    // gameOver(): the card is showing
  const cv=el('tlBoard'), f=CFG.FX_TIMELAPSE?tlFrames():[];
  cv.hidden=f.length<3;                                // a run of one or two drops has nothing to replay
  if(cv.hidden){ tlStop(); return; }
  tlPlay.f=f; tlStart();
}
function tlResume(){                                 // the card is back after the menu: it shows the final board
  if(!tlPlay.f||tlPlay.raf) return;
  tlPlay.done=true; tlPlay.flash=0; tlDraw(tlPlay.f.length-1);
}
function tlStop(){ if(tlPlay.raf){ cancelAnimationFrame(tlPlay.raf); tlPlay.raf=0; } tlPlay.f=null; }
function tlTap(e){
  e.stopPropagation();
  if(!tlPlay.f) return;
  if(!tlPlay.done){ tlPlay.done=true; tlPlay.t0=performance.now(); if(!tlPlay.raf) tlPlay.raf=requestAnimationFrame(tlStep); }   // skip to the end
  else tlStart();                                     // play it again
}
el('tlBoard').addEventListener('click',tlTap);
el('tlBoard').addEventListener('pointerdown',e=>e.stopPropagation());

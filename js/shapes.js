// Crumble — Piece shapes, shared state variables and small helpers.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ shapes ═══════ */
const RAW=[
  ['X'],['XX'],['X','X'],['XXX'],['X','X','X'],['XXXX'],['X','X','X','X'],
  ['XXXXX'],['X','X','X','X','X'],['XX','XX'],['XXX','XXX','XXX'],
  ['XX','X.'],['XX','.X'],['X.','XX'],['.X','XX'],
  ['X..','X..','XXX'],['XXX','X..','X..'],['XXX','..X','..X'],['..X','..X','XXX'],
  ['.XX','XX.'],['XX.','.XX'],['X.','XX','.X'],['.X','XX','X.'],
  ['XXX','.X.'],['.X.','XXX'],['X.','XX','X.'],['.X','XX','.X'],
  ['X.','X.','XX'],['XXX','X..'],['XX','.X','.X'],['..X','XXX'],   // L, 4 angles
  ['.X','.X','XX'],['X..','XXX'],['XX','X.','X.'],['XXX','..X'],   // J, 4 angles
  ['XXX','XXX'],['XX','XX','XX']
];
const SHAPES=RAW.map(rows=>{
  const cells=[];
  rows.forEach((r,ri)=>[...r].forEach((ch,ci)=>{ if(ch==='X') cells.push([ri,ci]); }));
  return {cells,rows:rows.length,cols:rows[0].length,n:cells.length};
});

// star gem: one cell, but it doesn't rest on the board — it clears its row and column instead
const STAR={cells:[[0,0]],rows:1,cols:1,n:1,star:true};

/* ═══════ state ═══════ */
const cvs=el('c'), ctx=cvs.getContext('2d'), safeProbe=el('safe');
const N=CFG.GRID;
let W,H,dpr,cell,B,bx,by,trayY,trayH,trayCell;
let grid,tray,score=0,best=0,combo=0,rescuesUsed=0;
let tension=0, sweepCool=0, lastTier='—', trayNo=0;
let starCool=0;        // trays until another star gem may be dealt
let starForced=false;   // a big combo guaranteed the next normal tray a star gem
let golden=null, goldenNext=false, goldenCool=0, trayHadSweep=false, trayCombo=0;   // golden = live hand: {want,got,pts,plan}; plan = goldenSolve of the pieces left
let goldenArrive=999, goldenCele=null, goldRain=[];   // (4.5c) arrival fanfare clock (frames) and the completion celebration {t,full}; both cosmetic, never saved
let shatters=[],shards=[],pops=[],sweeps=[],waves=[],sparkles=[],banners=[],blasts=[];
let praises=[],bursts=[],lineFlashes=[];
let chunks=[],orbs=[],rings=[],dust=[];      // juice: block chunks, score orbs, landing rings, landing dust
let scoreHold=0, bestBeaten=false, hitWait=0;           // score count-up waits for the first orb; NEW BEST fires once a run
let blast=null, bigMode=false, hudH=92;   // blast = live round {t (ms left), pts, lines, best (combo), swaps, tick}
let tags=[], slams=[], bands=[], borderFlash=null;   // per-cell point tags, COMBO slams, COLOR GONE bands, board-border flash
let paused=false;
let mode='endless', lvl=null, lv={lines:0,pieces:0,combo:0,swept:false};   // (4.1) 'endless' | 'adventure' | 'daily'; lvl = the Adventure level being played; lv = this level run's counters (saved with the run)
let curWorld='night', curSkin='jewel', bgFrom='night', bgT=1, flip=null;
let ambient=[], ambientOld=[], ambientBurst=0, lightningT=0;
let transform=null, transformCool=0, discoveredWorlds=new Set();
let comboGlowV=0, goldTintV=0, sweepFxT=0, punchT=0, confetti=[];
let shake=0,glowT=0,glowH=280,drag=null,ret=null,state='idle',lastSpark=0,shownScore=0;
let gemBig=[],gemSmall=[];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const easeOutCubic=t=>1-Math.pow(1-t,3);
const easeOutBack=t=>{const c=1.9;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);};

/* seedable randomness (plan 4.1): a string in, the same numbers out on every phone. Level boards and the Daily use it. */
function hashStr(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function mulberry(a){ return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return((t^(t>>>14))>>>0)/4294967296; }; }
// The dealer's randomness goes through rnd(): Math.random, unless a seeded stream is switched on (a level board, the Daily).
let rndSrc=null;
const rnd=()=>rndSrc?rndSrc():Math.random();
const seeded=(seed,fn)=>{ const old=rndSrc; rndSrc=mulberry(hashStr(seed)); try{ return fn(); } finally{ rndSrc=old; } };

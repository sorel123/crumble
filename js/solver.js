// Crumble — Hand solver, tray generation, praise banners.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════════════════════════════════════════════════════════════
   THE SOLVER
   The board is packed into a flat Uint8Array for speed. evalHand
   tries all six orderings of the three pieces and every legal
   position, APPLYING CLEARS BETWEEN PLACEMENTS — so a hand where
   piece 1 must clear a row before piece 2 has anywhere to go is
   found as a valid line. Capped by a node budget so it can never
   stall a frame.
   ═══════════════════════════════════════════════════════════════ */
const PERMS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

function packGrid(g){
  const a=new Uint8Array(N*N);
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) a[r*N+c]=g[r][c]?1:0;
  return a;
}
/* The search runs on a bitboard: 64 cells as two 32-bit ints (rows 0-3
   in lo, rows 4-7 in hi), so a fit test is two ANDs and a placement is
   two ORs — no allocation per node. Same DFS order and node budget as
   the array version it replaced, so it returns identical answers, just
   ~20x faster (a tray refill used to cost a visible frame on a phone). */
const pop32=x=>{ x-=(x>>>1)&0x55555555; x=(x&0x33333333)+((x>>>2)&0x33333333); return (((x+(x>>>4))&0x0F0F0F0F)*0x01010101)>>>24; };
function packBits(a){ let lo=0,hi=0; for(let i=0;i<32;i++){ if(a[i]) lo|=1<<i; if(a[i+32]) hi|=1<<i; } return [lo,hi]; }
function placeMasks(s){                      // every legal (r,c) for a shape, in the solver's scan order, cached on the shape
  if(s._pm) return s._pm;
  const out=[];
  for(let r=0;r<=N-s.rows;r++) for(let c=0;c<=N-s.cols;c++){
    let lo=0,hi=0;
    for(const [dr,dc] of s.cells){ const i=(r+dr)*N+c+dc; if(i<32) lo|=1<<i; else hi|=1<<(i-32); }
    out.push({r,c,lo,hi});
  }
  return (s._pm=out);
}
const COL=0x01010101;
function roughBits(lo,hi){                   // filled/empty edges: low = compact, high = ragged
  return pop32((lo^(lo>>>1))&0x7F7F7F7F)+pop32((hi^(hi>>>1))&0x7F7F7F7F)
       + pop32((lo^(lo>>>8))&0x00FFFFFF)+pop32((hi^(hi>>>8))&0x00FFFFFF)
       + pop32(((lo>>>24)^hi)&0xFF);
}
let _lo=0,_hi=0;                             // applyBits' result board (avoids allocating a pair per node)
function applyBits(lo,hi,s,m){               // returns lines cleared; new board left in _lo/_hi
  if(s.star){                                // star: wipes its row and column; each counts if it held a gem
    const r=m.r,c=m.c, rm=0xFF<<((r&3)*8), cm=COL<<c;
    const rowHas=(r<4?lo&rm:hi&rm)?1:0, colHas=((lo&cm)|(hi&cm))?1:0;
    if(r<4) lo&=~rm; else hi&=~rm;
    _lo=lo&~cm; _hi=hi&~cm; return rowHas+colHas;
  }
  lo|=m.lo; hi|=m.hi;
  let clo=0,chi=0,n=0;
  for(let r=0;r<4;r++){ const rm=0xFF<<(r*8); if((lo&rm)===rm){ clo|=rm; n++; } if((hi&rm)===rm){ chi|=rm; n++; } }
  for(let c=0;c<8;c++){ const cm=COL<<c; if((lo&cm)===cm&&(hi&cm)===cm){ clo|=cm; chi|=cm; n++; } }
  _lo=lo&~clo; _hi=hi&~chi; return n;
}
const countFlat=a=>{ let n=0; for(let i=0;i<a.length;i++) if(a[i]) n++; return n; };

function evalHand(a0,shapes,budget){
  const res={ok:false,lines:0,sweep:false,cleared:0,rough:999};
  const base=countFlat(a0)+shapes.reduce((n,s)=>n+(s.star?0:s.n),0);   // a star adds no gem to the board
  const [lo0,hi0]=packBits(a0);
  const pm=shapes.map(placeMasks);
  let b=budget;
  function dfs(lo,hi,order,i,acc){
    if(b<=0||res.sweep) return;
    if(i===3){
      res.ok=true; if(acc>res.lines) res.lines=acc;
      const cl=base-pop32(lo)-pop32(hi); if(cl>res.cleared) res.cleared=cl;
      const rg=roughBits(lo,hi); if(rg<res.rough) res.rough=rg;
      return;
    }
    const k=order[i], s=shapes[k];
    for(const m of pm[k]){
      if(b<=0||res.sweep) return;
      if((lo&m.lo)||(hi&m.hi)) continue;
      b--;
      const lines=applyBits(lo,hi,s,m), nlo=_lo, nhi=_hi;
      if(lines&&!nlo&&!nhi){
        res.sweep=true; res.ok=true; res.cleared=base; res.rough=0; res.lines=Math.max(res.lines,acc+lines); return;
      }
      dfs(nlo,nhi,order,i+1,acc+lines);
    }
  }
  for(const p of PERMS){ dfs(lo0,hi0,p,0,0); if(res.sweep) break; }
  // 'guide': what clears RIGHT NOW with one obvious drop, no sequence — the easy, relaxing kind of hand
  res.imm=0; res.immPieces=0;
  for(let k=0;k<3;k++){
    let best=0;
    for(const m of pm[k]){ if((lo0&m.lo)||(hi0&m.hi)) continue; const l=applyBits(lo0,hi0,shapes[k],m); if(l>best) best=l; }
    if(best){ res.immPieces++; if(best>res.imm) res.imm=best; }
  }
  return res;
}

/* ── clean-sweep planner ───────────────────────────────────────
   Random hands almost never produce a sweep, so build one
   backwards: pick a set of rows/columns that covers every gem on
   the board, take their empty cells as a target, and try to tile
   that target exactly with up to three shapes. Then verify with
   the real solver before serving it.                            */
function coverAll(a,useRows,useCols){
  const occ=[]; for(let i=0;i<a.length;i++) if(a[i]) occ.push(i);
  const rows=new Set(), cols=new Set(), left=new Set(occ);
  while(left.size){
    let bestK=null,bestN=-1,bestIsRow=true;
    if(useRows) for(let r=0;r<N;r++){
      if(rows.has(r)) continue;
      let n=0; for(const i of left) if(((i/N)|0)===r) n++;
      if(n>bestN){bestN=n;bestK=r;bestIsRow=true;}
    }
    if(useCols) for(let c=0;c<N;c++){
      if(cols.has(c)) continue;
      let n=0; for(const i of left) if(i%N===c) n++;
      if(n>bestN){bestN=n;bestK=c;bestIsRow=false;}
    }
    if(bestK===null||bestN<=0) return null;
    if(bestIsRow){ rows.add(bestK); for(const i of [...left]) if(((i/N)|0)===bestK) left.delete(i); }
    else { cols.add(bestK); for(const i of [...left]) if(i%N===bestK) left.delete(i); }
  }
  return {rows:[...rows],cols:[...cols]};
}
function targetCells(a,cov){
  const T=new Set();
  cov.rows.forEach(r=>{ for(let c=0;c<N;c++) if(!a[r*N+c]) T.add(r*N+c); });
  cov.cols.forEach(c=>{ for(let r=0;r<N;r++) if(!a[r*N+c]) T.add(r*N+c); });
  return [...T];
}
// tileExact / planSweep also come as generators (…Steps), pausing between first pieces, so a dealt sweep
// can be spread over frames like the candidate search below (an awkward target can take several ms)
function tileExact(T){ return runSteps(tileExactSteps(T)); }
function* tileExactSteps(T){
  const pool=SHAPES.slice().sort(()=>Math.random()-0.5);
  const out=[];
  function rec(rem,only){                     // only: the shape to try first (the top level, one shape per step)
    if(rem.size===0) return true;
    if(out.length>=3) return false;
    let first=Infinity; for(const v of rem) if(v<first) first=v;
    const fr=(first/N)|0, fc=first%N;
    for(const s of only?[only]:pool){
      for(const [dr,dc] of s.cells){
        const r=fr-dr, c=fc-dc;
        if(r<0||c<0||r+s.rows>N||c+s.cols>N) continue;
        const idx=[]; let ok=true;
        for(const [ar,ac] of s.cells){
          const id=(r+ar)*N+(c+ac);
          if(!rem.has(id)){ ok=false; break; }
          idx.push(id);
        }
        if(!ok) continue;
        idx.forEach(i=>rem.delete(i)); out.push(s);
        if(rec(rem)) return true;
        out.pop(); idx.forEach(i=>rem.add(i));
      }
    }
    return false;
  }
  const rem=new Set(T);
  if(!rem.size) return [];
  for(const s of pool){ if(rec(rem,s)) return out.slice(); yield; }
  return null;
}
function planSweep(a){ return runSteps(planSweepSteps(a)); }
function* planSweepSteps(a){
  const n=countFlat(a);
  if(n<CFG.SWEEP_MIN||n>CFG.SWEEP_MAX) return null;
  for(const [ur,uc] of [[true,true],[true,false],[false,true]]){
    const cov=coverAll(a,ur,uc); if(!cov) continue;
    const T=targetCells(a,cov);
    if(!T.length||T.length>15) continue;
    const tiles=yield* tileExactSteps(T); if(!tiles) continue;
    const hand=tiles.slice(0,3);
    while(hand.length<3) hand.push(SHAPES[(Math.random()*4)|0]);
    yield;
    if(evalHand(a,hand,6000).sweep) return hand;
  }
  return null;
}

/* ── hand selection ─────────────────────────────────────────── */
const stackable=s=>s.n===s.rows*s.cols && s.n<=6;   // bars and small rectangles
/* partners: for each piece, the shapes that sit against it to form a
   solid 2-4 wide block (at most one hole, which a single fills) */
function pairHoles(A,B){
  let best=null;
  for(let dr=-4;dr<=4;dr++) for(let dc=-4;dc<=4;dc++){
    const set=new Set(); let ok=true;
    for(const [r,c] of A.cells) set.add(r+','+c);
    for(const [r,c] of B.cells){ const k=(r+dr)+','+(c+dc); if(set.has(k)){ok=false;break;} set.add(k); }
    if(!ok) continue;
    let r0=9,r1=-9,c0=9,c1=-9;
    for(const k of set){ const [r,c]=k.split(',').map(Number); r0=Math.min(r0,r);r1=Math.max(r1,r);c0=Math.min(c0,c);c1=Math.max(c1,c); }
    const h=r1-r0+1, w=c1-c0+1, holes=h*w-set.size;
    if(h>=2&&w>=2&&h<=4&&w<=4&&holes<=1&&(best===null||holes<best)) best=holes;
  }
  return best;
}
const PARTNERS=new Map();
SHAPES.forEach(A=>{ if(!stackable(A)) PARTNERS.set(A,SHAPES.filter(B=>B.n>1&&pairHoles(A,B)!==null)); });
let carry=[];   // awkward pieces from the last tray, whose partners should show up next
function makeHand(density){
  const h=[weightedShape(density),weightedShape(density),weightedShape(density)];
  if(carry.length && Math.random()<CFG.PAIR_CHANCE){
    const ps=PARTNERS.get(carry[(Math.random()*carry.length)|0]);
    if(ps&&ps.length) h[(Math.random()*3)|0]=ps[(Math.random()*ps.length)|0];
  }
  return h;
}
function weightedShape(density){
  const early=trayNo<=CFG.EARLY_TRAYS;
  // crowded boards favour small pieces, but the penalty is capped at BIG_CAP cells so the big ones never vanish;
  // in bigMode (Blast Round hands) the crowd penalty is nearly off and 5+ cell pieces are pushed hard
  const dens=bigMode?density*0.2:density;
  const w=SHAPES.map(s=>(1/(1+Math.min(s.n,CFG.BIG_CAP)*dens*CFG.SMALL_BIAS))*(s.n===1?CFG.SINGLE_WEIGHT*(bigMode?0.3:1):1)
    *(bigMode&&s.n>=5?2.5:1)
    *(early&&!stackable(s)?CFG.EARLY_AWKWARD:1));
  let r=Math.random()*w.reduce((x,y)=>x+y,0);
  for(let i=0;i<SHAPES.length;i++){ r-=w[i]; if(r<=0) return SHAPES[i]; }
  return SHAPES[0];
}
function pickTier(a){
  if(tension>CFG.TIER_SWEEP && sweepCool<=0) return 'sweep';
  if(tension>CFG.TIER_JACKPOT) return 'jackpot';
  if(tension>=CFG.TIER_SOLVABLE) return 'solvable';
  return 'honest';
}
/* the candidate search: the best-scoring playable hand for a tier, plus its solver result */
// The tray deal runs as a generator that yields after every candidate hand, so a deal can be
// spread over a few frames (dealLater) instead of landing in the frame a clear starts. Same
// search, step for step, as running it straight through (genTray / runSteps).
function runSteps(it){ let r; while(!(r=it.next()).done); return r.value; }
function pickHand(a0,density,tier,withStar){ return runSteps(pickHandSteps(a0,density,tier,withStar)); }
function* pickHandSteps(a0,density,tier,withStar,candidates=CFG.CANDIDATES){
  const want = tier==='jackpot'?3 : tier==='solvable'?2 : 0;
  let bestHand=null,bestEv=null,bestScore=-Infinity,bestRough=999;
  for(let i=0;i<candidates;i++){
    const hand=makeHand(density);
    if(withStar) hand[(Math.random()*3)|0]=STAR;      // graded with the star in it, so the score is honest
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    let sc;
    if(!ev.ok) sc=-100+ev.lines;                      // all three must be playable
    else if(tier==='honest') sc=10-CFG.TIDY*ev.rough;   // any playable hand, prefer the tidiest
    else sc=(ev.sweep?60:0)+ev.lines*10+ev.cleared*1.5-CFG.TIDY*ev.rough
      +(bigMode?hand.reduce((a,s)=>a+s.n,0)*1.5:0);   // Blast Round: among playable clearing hands, prefer the chunkiest pieces
    if(ev.ok) sc+=CFG.GUIDE*(ev.imm*9+ev.immPieces*5+hand.reduce((a,s)=>a+(s.n>=5?3:0),0));   // obvious drops and big pieces: the guided, easy feel
    if(sc>bestScore){ bestScore=sc; bestHand=hand; bestEv=ev; }
    if(ev.ok && i>=7 && tier!=='honest' && ev.lines>=want && ev.rough<=bestRough && (!CFG.GUIDE||ev.imm>0)) break;
    if(ev.ok && ev.rough<bestRough) bestRough=ev.rough;
    yield;
  }
  if(!bestHand){ bestHand=[weightedShape(density),weightedShape(density),weightedShape(density)]; bestEv=null; }
  return {hand:bestHand,ev:bestEv};
}
/* golden hand: a planned sweep if one can be built, else the best jackpot hand.
   Returns false (and deals nothing) if neither offers a real clear. */
function* genGoldenSteps(a0,density){
  let hand=yield* planSweepSteps(a0), ev=hand&&evalHand(a0,hand,6000);
  if(hand&&ev.sweep){ sweepCool=CFG.SWEEP_COOLDOWN; tension=0.5; }   // same bookkeeping as a normal sweep hand
  else { yield; ({hand,ev}=yield* pickHandSteps(a0,density,'jackpot')); }
  if(!ev||!ev.ok||(!ev.sweep&&ev.lines<1)) return false;
  commitTray(hand,'GOLDEN·'+(ev.sweep?'SWEEP':'JACKPOT'),{sweep:ev.sweep,lines:ev.lines});
  return true;
}
function genTray(){ runSteps(dealSteps()); }
function* dealSteps(){
  trayNo++;
  if(CFG.TRANSFORM_ENABLED && Math.random()<CFG.MYSTERY_CHANCE)
    triggerTransform(TRANSFORM_IDS[(Math.random()*TRANSFORM_IDS.length)|0]);
  const a0=packGrid(grid);
  const density=countFlat(a0)/(N*N);
  let tier=pickTier(a0);
  sweepCool=Math.max(0,sweepCool-1);
  goldenCool=Math.max(0,goldenCool-1);
  transformCool=Math.max(0,transformCool-1);

  // a star is dealt on ordinary trays only; a golden or sweep tray leaves a guaranteed one waiting
  const wantStar=CFG.STAR_ENABLED && !transform && !blast && (starForced || Math.random()<CFG.STAR_CHANCE);   // one spotlight at a time

  if(goldenNext && !blast){ goldenNext=false; if(yield* genGoldenSteps(a0,density)) return; }

  if(blast){                                        // Blast Round: a sweep if one can be built, else the best big-piece jackpot hand
    const h=yield* planSweepSteps(a0);
    if(h){ commitTray(h,'BLAST·SWEEP'); return; }
    bigMode=true;
    let r;
    try{ r=yield* pickHandSteps(a0,density,'jackpot',false,Math.max(CFG.CANDIDATES,60)); }
    finally{ bigMode=false; }                         // also reset if the deal is abandoned mid-way (a new run starts)
    if(!r.ev||!r.ev.ok) r=yield* pickHandSteps(a0,density,'jackpot');   // big pieces don't fit this board: fall back to a normal jackpot hand
    commitTray(r.hand,'BLAST·'+(r.ev&&r.ev.ok?'BIG':'JACKPOT'));
    return;
  }

  if(tier==='sweep'){
    const h=yield* planSweepSteps(a0);
    if(h){ commitTray(h,'SWEEP'); sweepCool=CFG.SWEEP_COOLDOWN; tension=0.5; return; }
    tier='jackpot';
  }

  const {hand}=yield* pickHandSteps(a0,density,tier,wantStar);
  if(hand.includes(STAR)) starForced=false;
  commitTray(hand,tier.toUpperCase()+(hand.includes(STAR)?'+STAR':''));
}
/* rescue hand: playable, and rich in clears (sweep if one can be built) */
function genRescue(){
  const a0=packGrid(grid);
  const density=countFlat(a0)/(N*N);
  const sw=planSweep(a0);
  if(sw){ commitTray(sw,'RESCUE·SWEEP'); return; }
  let bestHand=null,bestScore=-Infinity;
  for(let i=0;i<CFG.CANDIDATES*8;i++){
    const hand=[weightedShape(density),weightedShape(density),weightedShape(density)];
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    const sc=ev.ok ? 100+(ev.sweep?60:0)+ev.lines*10
                   : hand.filter(s=>fitsAnywhere(s,grid)).length;
    if(sc>bestScore){ bestScore=sc; bestHand=hand; }
    if(ev.ok && ev.lines>=2) break;
  }
  commitTray(bestHand,'RESCUE');
}
function pushBanner(txt,sub,col){   // queued: one on screen at a time, the next starts as this one fades (frame)
  banners.push({t:0,txt,sub,col:col||'#FFD45C'});
}
/* praise: a big word for a multi-line clear or a long combo — the bigger the
   moment, the bigger the word. A clean sweep has its own banner instead. */
const PRAISE=[
  {words:['GOOD!','NICE!'],            a:'#FFFFFF', b:'#4FC3F7'},        // tier 0: a single line, no streak — still a word

  {words:['GOOD JOB!','NICE!'],        a:'#C8FFB8', b:'#26B865'},
  {words:['GREAT!','SUPER!'],          a:'#C2F3FF', b:'#3478FF'},
  {words:['AMAZING!','FANTASTIC!'],    a:'#FFD0F4', b:'#A64BFF'},
  {words:['INCREDIBLE!','LEGENDARY!'], a:'#FFF7B0', b:'#FF6A2B'}
];
function praiseTier(lines,combo){
  const byLines=lines>=5?4:lines>=4?3:lines>=3?2:lines>=2?1:0;
  const byCombo=combo>=8?4:combo>=6?3:combo>=4?2:combo>=2?1:0;   // tier 1 at combo 2 — 'GREAT!' sits above the COMBO slam
  return Math.max(byLines,byCombo);
}
function praise(lines,combo){
  const tier=praiseTier(lines,combo);
  const P=PRAISE[tier], word=P.words[(Math.random()*P.words.length)|0];
  praises.length=0;                                 // newest wins — words never stack up
  praises.push({t:0,tier,word,a:P.a,b:P.b});
  const x=W/2, y=by+B*0.3, n=Math.min(6+tier*6,fxRoom());
  for(let k=0;!reduce&&k<n;k++){
    const ang=Math.random()*6.283, sp=2.5+Math.random()*(3+tier*1.6);
    bursts.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp*0.75,life:1,
      r:cell*(0.1+Math.random()*0.13),col:Math.random()<.5?P.a:P.b});
  }
  if(tier>=3) waves.push({x,y,t:0});
  if(tier) Sfx.praise(tier);
}
function commitTray(shapes,label,plan){
  tray=shapes.map(s=>({s,gi:s.star?STAR_GI:plan?GOLD:(Math.random()*NCOLOR)|0}));
  golden=plan?{want:plan,got:{lines:0,sweep:false},pts:0}:null;
  if(plan){
    goldenCool=CFG.GOLDEN_COOLDOWN;
    pushBanner('GOLDEN HAND','×'+CFG.GOLDEN_MULT+' if you find it');
    Sfx.goldenIn();
  }
  lastTier=label;
  carry=shapes.filter(x=>!stackable(x));
  updateDbg();
}
// forgiving success rule: one line short of the plan is fine (min 1); a planned sweep needs a sweep or 3+ lines
const goldenNeed=w=>w.sweep?'sweep or 3 lines':Math.max(1,w.lines-1)+' lines';
function goldenResult(g){         // {hit: found the plan, mult: 1 = missed entirely}
  const hit=g.want.sweep?(g.got.sweep||g.got.lines>=3):g.got.lines>=Math.max(1,g.want.lines-1);
  if(hit) return {hit,mult:Math.max(CFG.GOLDEN_MULT,CFG.GOLDEN_PARTIAL)};
  return {hit,mult:g.got.lines>0||g.got.sweep?CFG.GOLDEN_PARTIAL:1};
}
function updateDbg(){
  const d=el('dbg');
  d.hidden=!CFG.SHOW_TENSION;
  if(d.hidden) return;
  const gold=golden?`GOLDEN plan ${golden.want.sweep?'sweep':golden.want.lines+' lines'}, need ${goldenNeed(golden.want)}, got ${golden.got.sweep?'sweep+':''}${golden.got.lines} lines, ${golden.pts} pts`
    :goldenNext?'gold queued':goldenCool>0?`gold cooldown ${goldenCool}`:'gold ready';
  const star=!CFG.STAR_ENABLED?'star off':starForced?'star guaranteed':'star on';
  d.textContent=`tension ${tension.toFixed(2)} · ${lastTier} · ${gold} · ${star} · meter ${blastMeter.toFixed(2)}`;
}

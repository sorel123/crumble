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
  const res={ok:false,lines:0,sweep:false,cleared:0,rough:999,flo:undefined,fhi:undefined,glo:undefined,ghi:undefined};
  const base=countFlat(a0)+shapes.reduce((n,s)=>n+(s.star?0:s.n),0);   // a star adds no gem to the board
  const [lo0,hi0]=packBits(a0);
  const pm=shapes.map(placeMasks);
  let b=budget;
  function dfs(lo,hi,order,i,acc){
    if(b<=0||res.sweep) return;
    if(i===3){
      res.ok=true; if(acc>res.lines) res.lines=acc;
      const cl=base-pop32(lo)-pop32(hi); if(cl>res.cleared){ res.cleared=cl; res.glo=lo; res.ghi=hi; }   // (1.1 A) and the emptiest
      const rg=roughBits(lo,hi); if(rg<res.rough){ res.rough=rg; res.flo=lo; res.fhi=hi; }   // (8.2) the tidiest board it can leave
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
  // obvPieces (plan 3.4): how many pieces have an OBVIOUS clear (obviousLines below), the kind she sees without looking.
  // alt: legal spots for the smallest piece of 2+ cells, capped at 8 — room to put the awkward one somewhere harmless.
  // (Singles are left out of alt on purpose, or it would reward dots and fight SINGLE_WEIGHT.)
  res.imm=0; res.immPieces=0; res.obvPieces=0; res.alt=0;
  const ob=obviousLines(lo0,hi0);
  let small=-1;
  for(let k=0;k<3;k++) if(!shapes[k].star&&shapes[k].n>=2&&(small<0||shapes[k].n<shapes[small].n)) small=k;
  for(let k=0;k<3;k++){
    let best=0, obv=false, spots=0;
    for(const m of pm[k]){
      if((lo0&m.lo)||(hi0&m.hi)) continue;
      spots++;
      const l=applyBits(lo0,hi0,shapes[k],m); if(l>best) best=l;
      if(l&&!obv&&ob.length&&!shapes[k].star){
        const alo=lo0|m.lo, ahi=hi0|m.hi;
        for(let j=0;j<ob.length;j+=2) if((alo&ob[j])===ob[j]&&(ahi&ob[j+1])===ob[j+1]){ obv=true; break; }
      }
    }
    if(best){ res.immPieces++; if(best>res.imm) res.imm=best; }
    if(obv) res.obvPieces++;
    if(k===small) res.alt=Math.min(8,spots);
  }
  return res;
}
/* An obvious clear (plan 3.4): a drop that completes a line which already had 5-7 of its 8 cells filled, with
   its empty cells in one single run (so the gap is one plain slot the piece drops into). A clear that needs
   cells scattered along the line is not obvious. obviousLines returns those lines' full masks as a flat
   [lo,hi, lo,hi, …] list; a drop is obvious if afterwards one of them is full. */
const LINE_MASKS=[];
for(let r=0;r<8;r++) LINE_MASKS.push(r<4?(0xFF<<(r*8))|0:0, r<4?0:(0xFF<<((r-4)*8))|0);
for(let c=0;c<8;c++) LINE_MASKS.push((COL<<c)|0,(COL<<c)|0);
const RUN_OK=new Uint8Array(256);            // by a line's 8 filled bits: 5-7 filled and the empties are one run
for(let b=0;b<256;b++){ const e=~b&0xFF, x=e/(e&-e); RUN_OK[b]=(pop32(b)>=5&&e&&(x&(x+1))===0)?1:0; }
function obviousLines(lo,hi){
  const out=[];
  for(let r=0;r<8;r++){ const b=(r<4?lo>>>(r*8):hi>>>((r-4)*8))&0xFF; if(RUN_OK[b]) out.push(LINE_MASKS[r*2],LINE_MASKS[r*2+1]); }
  for(let c=0;c<8;c++){
    let b=0; for(let r=0;r<4;r++){ if(lo&(1<<(r*8+c))) b|=1<<r; if(hi&(1<<(r*8+c))) b|=1<<(r+4); }
    if(RUN_OK[b]) out.push(LINE_MASKS[16+c*2],LINE_MASKS[16+c*2+1]);
  }
  return out;
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
  const pool=rshuffle(SHAPES.slice());
  const out=[], at=[];                         // at: where each tile goes (plan 7.3 checks the drop orders with it)
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
        idx.forEach(i=>rem.delete(i)); out.push(s); at.push({r,c});
        if(rec(rem)) return true;
        out.pop(); at.pop(); idx.forEach(i=>rem.add(i));
      }
    }
    return false;
  }
  const rem=new Set(T);
  if(!rem.size) return [];
  for(const s of pool){ if(rec(rem,s)){ const t=out.slice(); t.at=at.slice(); return t; } yield; }
  return null;
}
function planSweep(a){ return runSteps(planSweepSteps(a)); }
/* (7.3) does some order of dropping the tiles at their spots sweep the board? (clears between drops can strand a
   later tile in a line already gone, so the order matters; evalHand's node budget often misses these with singles) */
function tilesSweep(a,tiles){
  const [lo0,hi0]=packBits(a), ms=tiles.map((s,i)=>placeMasks(s).find(m=>m.r===tiles.at[i].r&&m.c===tiles.at[i].c));
  for(const p of tiles.length===3?PERMS:tiles.length===2?[[0,1],[1,0]]:[[0]]){
    let lo=lo0,hi=hi0,ok=true;
    for(const k of p){ const m=ms[k]; if((lo&m.lo)||(hi&m.hi)){ ok=false; break; } applyBits(lo,hi,tiles[k],m); lo=_lo; hi=_hi; }
    if(ok&&!lo&&!hi) return true;
  }
  return false;
}
function* planSweepSteps(a,maxT=15,exact=false){   // maxT: most empty cells the three pieces may fill; exact (closers, plan 7.3): verify by drop order, not the budgeted solver
  const n=countFlat(a);
  if(n<CFG.SWEEP_MIN||n>CFG.SWEEP_MAX) return null;
  for(const [ur,uc] of [[true,true],[true,false],[false,true]]){
    const cov=coverAll(a,ur,uc); if(!cov) continue;
    const T=targetCells(a,cov);
    if(!T.length||T.length>maxT) continue;
    const tiles=yield* tileExactSteps(T); if(!tiles) continue;
    const hand=tiles.slice(0,3);
    while(hand.length<3) hand.push(SHAPES[(rnd()*4)|0]);
    yield;
    if(exact?tilesSweep(a,tiles):evalHand(a,hand,6000).sweep) return hand;
  }
  return null;
}

/* (1.1 A) The sweep hunt: the closer's main search. The planner above needs a lucky shape of board (an exact tiling of one
   greedy cover; 7.3 also had a sequential planner that needed a line cleared by every drop, which this replaces); this one
   asks the plain question: is there a hand of three whose best order of drops ends on an empty board? Drops may clear lines along the way and the pieces need not fill the
   cover exactly (a cell freed by an early clear can be filled again).
   How it stays cheap: every gem must go in some line the hand completes, so it first lists covers, sets of up to four
   rows and columns that hold every gem and whose empty cells three pieces could fill (SWEEP_HUNT_CELLS), smallest first.
   Within a cover every cell a piece fills must be cleared again, so a drop may only use cells of the cover's lines not
   yet cleared ("live"); a clear takes its lines out of the live set, and a gem left outside it ends that branch. That
   leaves a few dozen moves per cover, searched three deep. Each cover is one step (the deal yields between them), the
   whole hunt is capped at `budget` nodes. Prefers hands where every drop clears something (legible, drop by drop) and
   no single dots; a perfect one ends the hunt. Sweeps that need five or more lines cleared are out of its reach (rare with
   three pieces). Returns the hand shuffled (the tray order never gives the drop order away), padded with small fillers if
   the sweep takes fewer than three, or null. lo0/hi0: the packed board. Measured on the casual bot: only about 1 board in
   200 at deal time admits any three-piece sweep, so the search is not what limits sweeps; the board is. */
const HUNT_POOL=SHAPES.filter(s=>!s.star);
const LINE_SETS=[];                                  // every set of 1-4 of the 16 lines, as id lists, fewest lines first
(function(){ const rec=(from,ids)=>{ if(ids.length) LINE_SETS.push(ids.slice()); if(ids.length===4) return; for(let i=from;i<16;i++){ ids.push(i); rec(i+1,ids); ids.pop(); } }; rec(0,[]); LINE_SETS.sort((x,y)=>x.length-y.length); })();
function liveOf(ids,live){ let lo=0,hi=0; for(const i of ids) if(live&(1<<i)){ lo|=LINE_MASKS[i*2]; hi|=LINE_MASKS[i*2+1]; } return [lo,hi]; }
const SET_LO=new Int32Array(LINE_SETS.length), SET_HI=new Int32Array(LINE_SETS.length);
LINE_SETS.forEach((ids,k)=>{ [SET_LO[k],SET_HI[k]]=liveOf(ids,0xFFFF); });
/* how close a board is to a sweep: the fewest empty cells in any cover of up to four lines (99: none). Cheap (a few
   thousand mask tests), so the chase can ask it of every candidate. */
function sweepGap(lo,hi){
  let best=99;
  for(let k=0;k<SET_LO.length;k++){
    const L=SET_LO[k], H=SET_HI[k];
    if((lo&~L)||(hi&~H)) continue;
    const e=pop32(L&~lo)+pop32(H&~hi); if(e<best) best=e;
  }
  return best;
}
/* (1.1) a smooth "distance to a sweep" for steering: over every cover of up to four lines, its empty cells plus 3 for every gem
   outside it; the smallest. 0 = empty board; sweepGap's boards score their gap; a scattered board scores high but still
   ranks (sweepGap is 99 for all of them). */
function sweepDist(lo,hi){
  let best=999;
  for(let k=0;k<SET_LO.length;k++){
    const L=SET_LO[k], H=SET_HI[k];
    const d=pop32(L&~lo)+pop32(H&~hi)+3*(pop32(lo&~L)+pop32(hi&~H)); if(d<best) best=d;
  }
  return best;
}
function* sweepHuntSteps(lo0,hi0,budget=CFG.SWEEP_HUNT_NODES){
  const n=pop32(lo0)+pop32(hi0); if(!n||n>CFG.SWEEP_MAX) return null;
  const covers=[];
  for(let k=0;k<LINE_SETS.length;k++){
    const ids=LINE_SETS[k], ulo=SET_LO[k], uhi=SET_HI[k];
    if((lo0&~ulo)||(hi0&~uhi)) continue;
    const empty=pop32(ulo&~lo0)+pop32(uhi&~hi0);
    if(empty&&empty<=CFG.SWEEP_HUNT_CELLS) covers.push({ids,ulo,uhi,empty});
  }
  covers.sort((x,y)=>x.empty-y.empty||x.ids.length-y.ids.length);
  if(covers.length>CFG.SWEEP_HUNT_COVERS) covers.length=CFG.SWEEP_HUNT_COVERS;   // the tightest few: a loose cover rarely sweeps and each costs a move list
  const pool=HUNT_POOL.slice();                     // Fisher-Yates always (not rshuffle's sort): a fixed count of rnd() calls on every engine, so the Daily deals alike
  for(let k=pool.length-1;k>0;k--){ const j=(rnd()*(k+1))|0; [pool[k],pool[j]]=[pool[j],pool[k]]; }
  let nodes=budget, best=null, bestSc=-Infinity;
  const path=[];
  for(const cv of covers){
    const cand=[];                                     // the moves that stay inside this cover
    for(const s of pool) for(const m of placeMasks(s)) if(!(m.lo&~cv.ulo)&&!(m.hi&~cv.uhi)) cand.push({s,m});
    const all=(1<<16)-1;
    let liveAll=0; for(const i of cv.ids) liveAll|=1<<i;
    const dfs=(lo,hi,live,llo,lhi,depth)=>{
      for(const c of cand){
        if(nodes<=0||bestSc>=4.5) return;
        const m=c.m;
        if((m.lo&~llo)||(m.hi&~lhi)||(lo&m.lo)||(hi&m.hi)) continue;
        nodes--;
        const full=lineIds(lo|m.lo,hi|m.hi), lines=applyBits(lo,hi,c.s,m), nlo=_lo, nhi=_hi;
        path.push({s:c.s,lines});
        if(!nlo&&!nhi){                                // a sweep: score it (every drop clears = 1 each; a dot costs a little)
          let sc=path.reduce((a,p)=>a+(p.lines?1:0)-(p.s.n===1?0.4:0),0)+(3-path.length)*0.5;
          if(sc>bestSc-2){                             // (1.1) a sweep her quick play finds by itself (predictPlay) beats a cleverer one
            const h=path.map(p=>p.s); while(h.length<3) h.push(SHAPES[1+(path.length%4)]);
            const pp=predictPlay(lo0,hi0,h); if(pp&&!(pp[0]|pp[1])) sc+=2;
            if(sc>bestSc){ bestSc=sc; best=path.map(p=>p.s); }
          }
        }
        else if(depth<2){
          const nl=lines?live&~full&all:live;
          let L=llo,H=lhi; if(lines) [L,H]=liveOf(cv.ids,nl);
          if(!(nlo&~L)&&!(nhi&~H)) dfs(nlo,nhi,nl,L,H,depth+1);   // every gem left still sits in a line that can clear
        }
        path.pop();
      }
    };
    dfs(lo0,hi0,liveAll,cv.ulo,cv.uhi,0);
    if(bestSc>=4.5||nodes<=0) break;
    yield;
  }
  if(!best) return null;
  const pad=SHAPES[1+(best.length%4)];                // the same small filler the legibility check above played
  while(best.length<3) best.push(pad);
  for(let k=2;k>0;k--){ const j=(rnd()*(k+1))|0; [best[k],best[j]]=[best[j],best[k]]; }
  return best;
}
function* closerSteps(a){
  const [lo,hi]=packBits(a);
  return (yield* sweepHuntSteps(lo,hi)) || (yield* planSweepSteps(a,CFG.CLOSER_TARGET,true));   // (1.1 A) the hunt replaces 7.3's sweepSeqSteps (it finds every sweep that one did, within four lines)
}
/* (1.1 A) the two-tray chase, for an earned closer that finds no sweep on a small board (CHASE_GEMS). Of CHASE_TRIES candidate
   hands (most carrying a piece that clears a line now), deal one that can leave a board a three-piece sweep exists for (its
   tidiest play or its emptiest, both from evalHand; the closest to a sweep by sweepGap are hunted), and the next tray hunts
   again on the board she actually made. null if none turns up.
   OFF by default (CHASE_TRIES 0): on the casual bot (4000 trays, seeds 1-3) it dealt 40-80 set-up hands, but the bot reached
   the sweepable board only 0-15 times, so sweeps did not measurably rise while the deal cost p95 rose about 2 ms. Kept for
   tuning (Admin slider) and for the Endless pacing work, where steering the board is decided. */
function* chaseSteps(a0,density){
  const tried=[], [lo0,hi0]=packBits(a0), keys=SHAPES.filter(s=>!s.star&&bestDrop(lo0,hi0,s)>=1);   // pieces that clear a line now: the way to a small board
  for(let i=0;i<CFG.CHASE_TRIES;i++){
    const hand=makeHand(density);
    if(keys.length&&rnd()<0.7) hand[(rnd()*3)|0]=keys[(rnd()*keys.length)|0];
    const ev=evalHand(a0,hand,CFG.CHASE_EVAL);
    if(ev.ok&&!ev.sweep) for(const [lo,hi] of [[ev.flo,ev.fhi],[ev.glo,ev.ghi]]){
      if(lo===undefined||!(lo|hi)) continue;
      const g=sweepGap(lo,hi); if(g<=CFG.SWEEP_HUNT_CELLS) tried.push({hand,lo,hi,g});
    }
    yield;
  }
  tried.sort((x,y)=>x.g-y.g);
  for(const t of tried.slice(0,3)){ if(yield* sweepHuntSteps(t.lo,t.hi,CFG.CHASE_NODES)) return t.hand; }
  return null;
}
/* (1.1) The sweep run: Jay's steering ("when it gets low, send jackpot style ones where an L squares it off, then a 3x3 and a
   2x2 sweep it"). On a low calm board (RUN_GEMS or fewer gems, phase calm or relief, off cooldown, no special live) the
   dealer spends up to RUN_TRAYS trays dealing toward a sweep with big, readable pieces (RUN_POOL: bars, rectangles, corners
   and L's; no S, Z or T, no dots or dominoes). Each tray it first hunts: a sweep on the board is dealt as a closer and ends
   the run. Otherwise of RUN_TRIES candidate hands (most carrying a piece that clears a line now) it deals the one whose
   tidiest or emptiest play leaves a board a sweep hand exists for (checked with the hunt), else the one that leaves the
   board closest to a sweep (sweepGap), favouring clears. Off-script play needs no special case: the next tray reads the
   board she made; a board grown past RUN_GEMS+RUN_SLACK or a phase change ends the run. Cooldown RUN_COOL after a run,
   paid or not. Nothing on screen marks it (Jay: she spots the sweep herself). Not in a Challenge (its seeds stay as dealt). */
const RUN_POOL=SHAPES.filter(s=>{
  if(s.n<3) return false;
  if(s.n===s.rows*s.cols) return true;                                       // bars and rectangles
  const corner=s.cells.some(([r,c])=>r===0&&c===0)+s.cells.some(([r,c])=>r===0&&c===s.cols-1)+s.cells.some(([r,c])=>r===s.rows-1&&c===0)+s.cells.some(([r,c])=>r===s.rows-1&&c===s.cols-1);
  return corner===3;                                                         // L, J and corner pieces fill three corners of their box; S, Z and T do not
});
let sweepRun=null;                                    // {n: trays dealt in this run} or null
const runPhase=()=>pace.ph==='calm'||pace.ph==='relief';
/* (1.1) how a quick, greedy player is likely to play a hand (the run's guess at the board she will leave): an obvious
   clear first (plan 3.4's kind; the one clearing the most lines), otherwise the biggest piece where it sits most flush
   (most sides against gems or the wall). Clears applied between drops. Returns [lo,hi], or null if she would get stuck. */
const NB=[]; for(let i=0;i<64;i++){ const r=i>>3,c=i&7; NB.push([[r-1,c],[r+1,c],[r,c-1],[r,c+1]].map(([y,x])=>y<0||x<0||y>7||x>7?-1:y*8+x)); }
const bitAt=(lo,hi,i)=>i<32?(lo>>>i)&1:(hi>>>(i-32))&1;
function predictPlay(lo,hi,hand){
  const left=hand.slice();
  while(left.length){
    let pick=-1, pm=null, best=-1;
    const ob=obviousLines(lo,hi);
    if(ob.length) for(let k=0;k<left.length;k++) for(const m of placeMasks(left[k])){
      if((lo&m.lo)||(hi&m.hi)) continue;
      const alo=lo|m.lo, ahi=hi|m.hi; let n=0;
      for(let j=0;j<ob.length;j+=2) if((alo&ob[j])===ob[j]&&(ahi&ob[j+1])===ob[j+1]) n++;
      if(n>best&&n>0){ best=n; pick=k; pm=m; }
    }
    if(pick<0){
      const order=left.map((s,k)=>k).sort((x,y)=>left[y].n-left[x].n);
      for(const k of order){
        const s=left[k];
        for(const m of placeMasks(s)){
          if((lo&m.lo)||(hi&m.hi)) continue;
          let f=0;
          for(const [dr,dc] of s.cells){ const i=(m.r+dr)*8+m.c+dc; for(const j of NB[i]) if(j<0) f++; else if(!bitAt(m.lo,m.hi,j)&&bitAt(lo,hi,j)) f++; }
          if(f>best){ best=f; pick=k; pm=m; }
        }
        if(pick>=0) break;
      }
    }
    if(pick<0) return null;
    applyBits(lo,hi,left[pick],pm); lo=_lo; hi=_hi;
    if(!lo&&!hi) return [0,0];                         // swept: that is the moment (the pieces left go on an empty board)
    left.splice(pick,1);
  }
  return [lo,hi];
}
function* runHandSteps(a0){
  const [lo0,hi0]=packBits(a0), keys=RUN_POOL.filter(s=>bestDrop(lo0,hi0,s)>=1), tried=[];
  for(let i=0;i<CFG.RUN_TRIES;i++){
    const hand=[0,1,2].map(()=>RUN_POOL[(rnd()*RUN_POOL.length)|0]);
    if(keys.length&&rnd()<0.6) hand[(rnd()*3)|0]=keys[(rnd()*keys.length)|0];
    const pp=predictPlay(lo0,hi0,hand);
    if(pp){
      if(!(pp[0]|pp[1])) return {hand,sweep:true};      // her quick play sweeps it already
      tried.push({hand,lo:pp[0],hi:pp[1],g:sweepGap(pp[0],pp[1]),d:sweepDist(pp[0],pp[1])});
    }
    if(i%8===7) yield;
  }
  if(!tried.length) return null;
  tried.sort((x,y)=>x.g-y.g||x.d-y.d);
  for(const t of tried.slice(0,CFG.RUN_HUNTS)){ if(t.g>CFG.SWEEP_HUNT_CELLS) break; if(yield* sweepHuntSteps(t.lo,t.hi,CFG.CHASE_NODES)) return {hand:t.hand,set:true}; }
  tried.sort((x,y)=>x.d-y.d);
  return {hand:tried[0].hand};
}
function endRun(){ if(sweepRun){ sweepRun=null; closerCool=Math.max(closerCool,CFG.RUN_COOL); } }
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
  if(carry.length && rnd()<CFG.PAIR_CHANCE){
    const ps=PARTNERS.get(carry[(rnd()*carry.length)|0]);
    if(ps&&ps.length) h[(rnd()*3)|0]=ps[(rnd()*ps.length)|0];
  }
  return h;
}
function weightedShape(density){
  const early=trayNo<=CFG.EARLY_TRAYS;
  // crowded boards favour small pieces, but the penalty is capped at BIG_CAP cells so the big ones never vanish;
  const w=SHAPES.map(s=>(1/(1+Math.min(s.n,CFG.BIG_CAP)*density*CFG.SMALL_BIAS))*(s.n===1?CFG.SINGLE_WEIGHT:1)
    *(early&&!stackable(s)?CFG.EARLY_AWKWARD:1)*(paced()&&BUILD_SET.has(s)?CFG.BUILD_W:1));   // (7.3) feed the build: the pieces that square an area off
  let r=rnd()*w.reduce((x,y)=>x+y,0);
  for(let i=0;i<SHAPES.length;i++){ r-=w[i]; if(r<=0) return SHAPES[i]; }
  return SHAPES[0];
}
/* ═══ Pressure and recovery (plan 6.1) ═══
   Room, not fullness: a board can be half full and wide open, or a third full and riddled. roomOf() asks how many
   placements a reference set of mid and big pieces (the rectangles of 4+ cells and the four 3-cell corners) still
   has, as a share of what each has on an empty board, square-rooted (so the first losses register) and averaged.
   1 = empty, about 0.3 = cramped (only a few spots for anything bigger than a bar), 0 = only small pieces fit. */
const ROOM_REF=SHAPES.filter(s=>(s.n>=4&&s.n===s.rows*s.cols)||(s.n===3&&s.rows===2));
const ROOM_MAX=ROOM_REF.map(s=>placeMasks(s).length);
function roomOf(a){ const [lo,hi]=packBits(a); return roomBits(lo,hi); }
function roomBits(lo,hi){
  let sum=0;
  for(let k=0;k<ROOM_REF.length;k++){
    let n=0; for(const m of placeMasks(ROOM_REF[k])) if(!(lo&m.lo)&&!(hi&m.hi)) n++;
    sum+=Math.sqrt(n/ROOM_MAX[k]);
  }
  return sum/ROOM_REF.length;
}
/* The phase for the tray being dealt. calm (room >= ROOM_OK) and building deal honest hands; the edge (room <
   ROOM_EDGE) holds EDGE_HOLD_MIN..MAX honest trays; then up to RECOVERY_TRIES recovery hands (a sequence to
   spot); a miss goes back to the edge. The clear that lifts her out of edge or recovery earns RELIEF_TRAYS
   guided trays. pace.n counts the trays dealt in the phase so far. */
function paceSet(ph){ pace.ph=ph; pace.n=0; }
function paceStep(a0){
  const r=roomNow=roomOf(a0), cramped=r<CFG.ROOM_EDGE, ph=pace.ph;
  if((ph==='edge'||ph==='recovery')&&!cramped){ paceSet('relief'); pace.len=CFG.RELIEF_TRAYS; }
  else if(ph==='relief'&&pace.n<pace.len&&!cramped){}
  else if(cramped){
    if(ph==='edge'){ if(pace.n>=pace.hold) paceSet('recovery'); }
    else if(ph==='recovery'){ if(pace.n>=CFG.RECOVERY_TRIES) paceSet('edge'), pace.hold=edgeHold(); }
    else { paceSet('edge'); pace.hold=edgeHold(); }
  }
  else paceSet(r>=CFG.ROOM_OK?'calm':'building');
  pace.n++;
  return pace.ph;
}
const edgeHold=()=>CFG.EDGE_HOLD_MIN+((rnd()*(CFG.EDGE_HOLD_MAX-CFG.EDGE_HOLD_MIN+1))|0);
const paced=()=>mode!=='adventure';                    // Adventure keeps the tension wave its levels were tuned on
// what each phase deals: honest (calm, building), edge (every piece has a spot now, no promise the three fit in
// sequence), recovery, guided (relief; the first relief tray tries a planned sweep), and now and then a calm gift
function paceTier(a0){
  const ph=paceStep(a0);
  if(ph==='edge') return 'edge';
  if(ph==='recovery') return 'recovery';
  if(ph==='relief') return pace.n>1?'solvable':sweepCool<=0?'sweep':'jackpot';
  return ph==='calm'&&rnd()<CFG.GIFT_CHANCE?'solvable':'honest';
}
const fitsBits=(lo,hi,s)=>placeMasks(s).some(m=>!(lo&m.lo)&&!(hi&m.hi));
function pickTier(a){
  if(tension>CFG.TIER_SWEEP && sweepCool<=0) return 'sweep';
  if(tension>CFG.TIER_JACKPOT) return 'jackpot';
  if(tension>=CFG.TIER_SOLVABLE) return 'solvable';
  return 'honest';
}
/* ═══ Payoff waves, setups and closers (plan 7.3, Endless and Daily) ═══
   Block Blast's rhythm: build, build, bam. Four parts, all on top of the 6.1 phases (edge and recovery stay honest):
   - The wave clock: every WAVE_MIN..WAVE_MAX trays a payoff tray is due. The trays before it lean on the pieces that
     square an area off (2x3s, 2x2s, 1x3/1x4 bars, BUILD_W). The payoff tray is drawn from big blocks and must offer
     PAYOFF_LINES+ lines; it pays only what the board offers: if no big hand does, the tray is an ordinary build tray
     and the clock tries again next tray. A relief tray, a closer or a golden hand counts as the payoff.
   - Setups: after each drop, an empty exact rectangle (SETUP_RECTS), mostly walled in, whose filling completes a line,
     and which her drop just made, is a setup. Each of the next SETUP_TRAYS trays has SETUP_CHANCE of carrying the
     exact piece; once dealt it is never offered again for that setup, used or not.
   - Closers (earned): a clear leaving CLOSER_GEMS or fewer gems, reaching combo CLOSER_COMBO, or getting out of an edge
     hold queues a closer: a planned sweep (target up to CLOSER_TARGET cells), with a shimmer behind the tray. If no
     sweep can be built, a payoff tray is due instead. A closer counts as a special (the next tray carries none).
   - A dry spell (DRY_TRAYS trays with no clear) makes the payoff due now (lines, never a sweep: stalling earns no reset).
   - No tedium: a hand of three pieces of 3 cells or fewer is fixed up while a 4+ piece fits the board, and the 4+
     pieces in any five trays are kept at BIG_FLOOR or more where they fit.
   Every roll goes through rnd(), so the Daily stays the same for everyone. */
const SETUP_RECTS=[[2,2],[2,3],[3,2],[1,3],[3,1],[1,4],[4,1],[3,3]].map(([h,w])=>SHAPES.find(s=>s.rows===h&&s.cols===w&&s.n===h*w));
const BUILD_SET=new Set(SETUP_RECTS.filter(s=>s.n>=3&&s.n<=6));                          // the squaring-off pieces fed before a payoff
const PAYOFF_SET=SHAPES.filter(s=>s.n>=4&&s.n===s.rows*s.cols);                             // big blocks: 2x2, 2x3, 3x2, 3x3, bars of 4 and 5
const BIG_SHAPES=SHAPES.filter(s=>s.n>=4);
const waveStats={setups:0,dealt:0,missed:0,closed:0,closerTries:0,chases:0,runs:0,runSwept:0,guarded:0,guardBy:{},rescues:0};   // setups made / setup pieces dealt, this session only (the bot sim reads them)
let wave={n:0,at:5,due:false}, jack={n:0,at:10}, setups=[], closerNext=false, chaseNext=false, chaseNow=false, chaseCool=0, closerCool=0, dryN=0, bigHist=[], closerTray=false, trayClear=false;
const waveAt=()=>CFG.WAVE_MIN+((rnd()*(CFG.WAVE_MAX-CFG.WAVE_MIN+1))|0);
const jackAt=()=>CFG.JACKPOT_MIN+((rnd()*(CFG.JACKPOT_MAX-CFG.JACKPOT_MIN+1))|0);
function resetWave(){ resetTide(); wave={n:0,at:waveAt(),due:false}; jack={n:0,at:jackAt()}; setups=[]; closerNext=false; chaseNext=false; chaseNow=false; chaseCool=0; sweepRun=null; closerCool=0; dryN=0; bigHist=[]; closerTray=false; trayClear=false; }
/* every empty exact rectangle of SETUP_RECTS on the board whose filling completes a line, with at least SETUP_WALLED of
   the cells around it filled or wall. Returned as {k: index in SETUP_RECTS, r, c, lo, hi}. */
function findHoles(lo,hi){
  const out=[], full0=lineIds(lo,hi);
  SETUP_RECTS.forEach((s,k)=>{
    for(const m of placeMasks(s)){
      if((lo&m.lo)||(hi&m.hi)) continue;
      if(!(lineIds(lo|m.lo,hi|m.hi)&~full0)) continue;
      let walls=0, tot=0;
      for(let r=m.r-1;r<=m.r+s.rows;r++) for(let c=m.c-1;c<=m.c+s.cols;c++){
        const side=(r<m.r||r>=m.r+s.rows)!==(c<m.c||c>=m.c+s.cols);   // edge neighbours only, not the corners
        if(!side) continue;
        tot++;
        if(r<0||c<0||r>=N||c>=N) walls++; else { const i=r*N+c; if(i<32?lo&(1<<i):hi&(1<<(i-32))) walls++; }
      }
      if(walls>=tot*CFG.SETUP_WALLED) out.push({k,r:m.r,c:m.c,lo:m.lo,hi:m.hi});
    }
  });
  return out.filter(h=>!out.some(o=>o!==h&&SETUP_RECTS[o.k].n>SETUP_RECTS[h.k].n&&(o.lo&h.lo)===h.lo&&(o.hi&h.hi)===h.hi));   // the biggest hole, not its parts
}
const holeKey=h=>h.k+':'+h.r+':'+h.c;
/* place() calls this after a drop (and its clear): before = the packed board before the piece went down. */
function waveAfterDrop(before,lines,gemsLeft,comboNow,wasTight){
  if(!paced()) return;
  if(lines>0){
    trayClear=true;
    if(gemsLeft>0&&gemsLeft<=CFG.CLOSER_GEMS) closerNext=true;
    if(comboNow===CFG.CLOSER_COMBO) closerNext=true;
    if(wasTight&&roomOf(packGrid(grid))>=CFG.ROOM_EDGE) closerNext=true;   // out of the edge hold
  }
  const [lo,hi]=packBits(packGrid(grid)), [blo,bhi]=packBits(before);
  const old=new Set(findHoles(blo,bhi).map(holeKey));
  setups=setups.filter(u=>{ const s=SETUP_RECTS[u.k], m=placeMasks(s).find(p=>p.r===u.r&&p.c===u.c);
    const open=!((lo&m.lo)||(hi&m.hi)) && (lineIds(lo|m.lo,hi|m.hi)&~lineIds(lo,hi));
    if(!open&&!u.dealt&&u.age===0) waveStats.closed++;     // she filled or changed it herself before another tray came: it never had a chance
    return open; });
  for(const h of findHoles(lo,hi)){
    const key=holeKey(h);
    if(old.has(key)||setups.some(u=>holeKey(u)===key)) continue;
    if(setups.length>=3) break;
    setups.push({k:h.k,r:h.r,c:h.c,age:0,dealt:false});
    waveStats.setups++;
  }
}
/* the start of a deal: age setups, count the dry spell, and decide whether this tray is a closer, a jackpot or a payoff.
   Returns 'closer' | 'jackpot' | 'payoff' | null. tier is the 6.1 tier; edge and recovery trays are never either. */
function waveTick(){
  if(!paced()) return;
  setups=setups.filter(u=>{ if(++u.age<=CFG.SETUP_TRAYS) return true; if(!u.dealt) waveStats.missed++; return false; });
  jack.n+=1+(trayClear?0:CFG.JACKPOT_DRY);              // (8.2) a dry tray runs the jackpot clock forward
  dryN=trayClear?0:dryN+1; trayClear=false;
  closerCool=Math.max(0,closerCool-1);
  chaseNow=chaseNext; chaseNext=false;                 // (1.1 A) this tray is the second of a chase (its one try)
  chaseCool=Math.max(0,chaseCool-1);
  wave.n++;
  if(dryN>=CFG.DRY_TRAYS) wave.due=true;
  if(wave.n>=wave.at) wave.due=true;
}
function waveTier(tier,specialsFree){
  if(!paced()) return null;
  if(tier==='edge'||tier==='recovery') return null;
  if(tier==='sweep'||tier==='jackpot'&&pace.ph==='relief'){ jackDone(); return null; }   // relief is the payoff (and the jackpot)
  if(chaseNow&&specialsFree){ closerNext=false; return 'closer'; }   // (1.1 A) the second tray of a chase
  if(closerNext&&closerCool<=0&&specialsFree){ closerNext=false; return 'closer'; }
  if(jack.n>=jack.at) return 'jackpot';                 // (8.2) a behind-the-scenes jackpot; if the board has none it falls back to a payoff
  return wave.due?'payoff':null;
}
function waveDone(){ wave={n:0,at:waveAt(),due:false}; dryN=0; }
function jackDone(){ jack={n:0,at:jackAt()}; waveDone(); }   // a jackpot (or a golden hand, or a sweep) is also the payoff
// the most lines one drop of s completes on this board
const bestDrop=(lo,hi,s)=>{ let best=0; for(const m of placeMasks(s)){ if((lo&m.lo)||(hi&m.hi)) continue; const l=applyBits(lo,hi,s,m); if(l>best) best=l; } return best; };
/* (8.2) how many of the big blocks have a drop that completes 2+ lines on this board (0..PAYOFF_SET.length) */
const payoffRoom=(lo,hi)=>lo===undefined?0:PAYOFF_SET.reduce((n,s)=>n+(bestDrop(lo,hi,s)>=2?1:0),0);
/* (8.2) a jackpot hand: three pieces that together clear JACKPOT_LINES+ lines when played in the right order (or empty
   the board), scored so it also pays drop by drop. The golden hand's jackpot search, without the gold: nothing on screen
   says so, it just plays big. null if the board offers none this tray. */
function* jackpotSteps(a0,density){
  const [lo,hi]=packBits(a0), keys=SHAPES.filter(s=>!s.star&&bestDrop(lo,hi,s)>=2);   // pieces with a multi-line drop right now
  let best=null, bestSc=-Infinity;
  for(let i=0;i<CFG.JACKPOT_TRIES;i++){
    const hand=makeHand(density);
    if(keys.length&&rnd()<0.8) hand[(rnd()*3)|0]=keys[(rnd()*keys.length)|0];   // most tries carry one: the bam she can see
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    if(ev.ok&&(ev.sweep||ev.lines>=CFG.JACKPOT_LINES)){
      // played drop by drop it still pays: big single drops and obvious clears count, and the board it leaves stays tidy
      const sc=(ev.sweep?60:0)+ev.lines*10+(ev.imm>=2?30:0)+ev.imm*12+ev.immPieces*CFG.JACKPOT_EACH+ev.obvPieces*8-CFG.TIDY*ev.rough;
      if(sc>bestSc){ bestSc=sc; best=hand; }
    }
    yield;
  }
  return best;
}
/* a payoff hand: one big block that completes PAYOFF_LINES+ lines in a single drop (the bam), plus two ordinary pieces,
   all three playable (8.2: if no big block has such a drop, any piece that has one). Pays only what the board offers: null if
   no piece has such a drop, and the clock tries again next tray. closeIn (a closer that
   could not sweep): of those hands, the one that can clear the most gems, so the next closer has a smaller board. */
function* payoffSteps(a0,density,closeIn=false){
  const need=CFG.PAYOFF_LINES;
  const [lo,hi]=packBits(a0), keys=[];
  for(const s of PAYOFF_SET) if(bestDrop(lo,hi,s)>=need) keys.push(s);
  if(!keys.length) for(const s of SHAPES) if(!s.star&&bestDrop(lo,hi,s)>=need) keys.push(s);   // (8.2) no big block fits the gap: any piece that does (a corner piece or a dot where a row and a column cross)
  if(!keys.length) return null;
  let bestHand=null, bestSc=-Infinity;
  for(let i=0;i<CFG.PAYOFF_TRIES;i++){
    const hand=[keys[(rnd()*keys.length)|0],weightedShape(density),weightedShape(density)];
    for(let k=2;k>0;k--){ const j=(rnd()*(k+1))|0; [hand[k],hand[j]]=[hand[j],hand[k]]; }
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    if(ev.ok){ const sc=closeIn?ev.cleared+(ev.sweep?100:0):ev.lines; if(sc>bestSc){ bestSc=sc; bestHand=hand; } if(!closeIn) break; }
    yield;
  }
  return bestHand;
}
/* the setup piece: for each open setup not yet dealt, roll SETUP_CHANCE; on a hit swap the exact piece into the slot
   that keeps the hand playable (edge-style trays: every piece still fits). One per tray. */
function offerSetup(a0,hand,tier){
  if(!paced()) return hand;
  const mark=u=>{ u.dealt=true; waveStats.dealt++; };
  for(const u of setups) if(!u.dealt&&hand.includes(SETUP_RECTS[u.k])) mark(u);   // it came on its own: that was its one offer
  if(tier==='edge'||tier==='recovery') return hand;
  for(const u of setups){
    if(u.dealt||rnd()>=CFG.SETUP_CHANCE) continue;
    const s=SETUP_RECTS[u.k];
    for(const j of [0,1,2].sort((x,y)=>hand[x].n-hand[y].n)){
      if(hand[j].star) continue;
      const h2=hand.slice(); h2[j]=s;
      if(evalHand(a0,h2,CFG.NODE_BUDGET).ok){ mark(u); return h2; }
    }
  }
  return hand;
}
/* no tedium: while a 4+ piece fits, a hand is never three small pieces, and the last five trays hold BIG_FLOOR+ big ones */
function noTedium(a0,hand,tier){
  if(!paced()) return hand;
  const [lo,hi]=packBits(a0), fitBig=BIG_SHAPES.filter(s=>fitsBits(lo,hi,s));
  const big=h=>h.filter(s=>s.n>=4).length;
  let need=Math.max(big(hand)?0:1, CFG.BIG_FLOOR-bigHist.reduce((a,b)=>a+b,0)-big(hand));
  if(!fitBig.length||CFG.BIG_FLOOR<=0) need=0;   // 0 = off
  const ok=h=>tier==='edge'?h.every(s=>s.star||fitsBits(lo,hi,s)):evalHand(a0,h,CFG.NODE_BUDGET).ok;
  for(let tries=0;need>0&&tries<16;tries++){
    const j=[0,1,2].filter(x=>!hand[x].star&&hand[x].n<4).sort((x,y)=>hand[x].n-hand[y].n)[0];
    if(j===undefined) break;
    const h2=hand.slice(); h2[j]=fitBig[(rnd()*fitBig.length)|0];
    if(ok(h2)){ hand=h2; need--; }
  }
  return hand;
}
function waveDealt(hand){ bigHist.push(hand.filter(s=>s.n>=4).length); while(bigHist.length>4) bigHist.shift(); }
/* ═══ Coaster dealing (1.1 G, Endless and Daily) ═══
   Block Blast deals in stretches: a run of easy trays (big rectangles and bars that fit the board, lines everywhere),
   then a lean run (S, Z, T, hooks, small L's; few free clears; the board climbs), then easy again. The tide is that
   stretch state. It does not read the board: EASY lasts TIDE_EASY_MIN..MAX trays, LEAN TIDE_LEAN_MIN..MAX, lengths
   rolled per stretch, a run starts EASY. Nothing on screen shows it. The 6.1 edge, recovery and relief still apply
   on top (a relief starts a fresh EASY stretch).
   Jay's rule, checked at EVERY deal and in both stretches: the tray always has a solution. From the board she left
   (nothing is planned ahead or queued) the tray is only dealt if (a) some order and placement fits all three pieces
   (evalHand), (b) each piece on its own has a sound spot, one that clears a line or makes no sealed hole and costs
   little room (soundBits), and (c) the board her quick play is likely to leave (predictPlay) still has a way on:
   it is roomy, or some piece the dealer can deal next clears a line there (wayOut). If she made a mess anyway, the
   next tray is chosen fresh for that board, and in LEAN, once the board has gone LEAN_DRY trays without a clear (or
   is tight and dry for one), the tray carries a piece that clears a line (the quiet rescue). Only her placement
   can lose a run. ensureWay() is the last guard: a hand that is not solvable is replaced by one that is.
   What the older help became under the tide (Challenge still deals with all of it, so its frozen seeds stay):
   the payoff wave, jackpot clock, build-up, setups' piece offers, noTedium/BIG_FLOOR, the calm gift and BUILD_BIAS
   are not used: EASY is how payoffs happen now (its hands are scored on lines, big drops and fit), and a setup's
   exact piece is one of the "keys" EASY reaches for. Closers, the sweep hunt and the sweep run stay, in EASY only
   (an earned closer waits out a LEAN stretch). GUIDE/OBVIOUS terms live on in EASY's score; LEAN has none. */
const tideOn=()=>CFG.TIDE&&paced()&&mode!=='challenge';
let tide={st:'easy',n:0,len:0};                       // the stretch: 'easy' | 'lean', trays dealt in it, its rolled length
const tideLen=st=>st==='easy'?CFG.TIDE_EASY_MIN+((rnd()*(CFG.TIDE_EASY_MAX-CFG.TIDE_EASY_MIN+1))|0):CFG.TIDE_LEAN_MIN+((rnd()*(CFG.TIDE_LEAN_MAX-CFG.TIDE_LEAN_MIN+1))|0);
function tideSet(st){ tide={st,n:0,len:tideLen(st)}; }
function resetTide(){ tide={st:'easy',n:0,len:0}; }   // the first stretch's length is rolled at its first tray (no rnd() here: Challenge seeds stay as dealt)
function tideStep(){                                  // the stretch for the tray being dealt
  if(!tide.len) tide.len=tideLen(tide.st);
  if(pace.ph==='relief'&&pace.n===1&&tide.st==='lean') tideSet('easy');   // getting out of the edge in LEAN ends the stretch (in EASY it just carries on)
  else if(tide.n>=tide.len) tideSet(tide.st==='easy'?'lean':'easy');
  tide.n++;
  return tide.st;
}
// piece kinds: rectangles and bars; the five-cell corners (big L's into corners); everything else is awkward (S, Z, T, L, J, hooks)
const isRect=s=>s.n===s.rows*s.cols;
const isBigL=s=>s.n===5&&!isRect(s);
const awkward=s=>!s.star&&!isRect(s)&&!isBigL(s);
// base weights per stretch, by kind and size (TIDE_SMALL scales every piece of 3 cells or fewer, the 1-cell piece rarest of all)
function tideBase(s,st){
  let w;
  if(st==='easy') w=isRect(s)?({1:.04,2:.12,3:.4,4:1.1,5:1.4,6:1.8,9:1.8})[s.n]:isBigL(s)?.8:s.n===3?.15:.1;
  else w=isRect(s)?({1:.03,2:.1,3:.25,4:.45,5:.35,6:.35,9:.25})[s.n]:isBigL(s)?1.1:s.n===3?.2:1;
  return s.n<=3?w*CFG.TIDE_SMALL:w;
}
/* how well each shape fits this board's contours: its best drop's lines and its most flush spot (share of its outline
   against gems or the wall). 0 = no spot at all. One pass over every shape's spots, per deal. */
function fitTable(lo,hi){
  return SHAPES.map(s=>{
    let lines=0, flush=0, any=false, per=0;
    for(const [dr,dc] of s.cells) for(const [a,b] of [[-1,0],[1,0],[0,-1],[0,1]]) if(!s.cells.some(([x,y])=>x===dr+a&&y===dc+b)) per++;
    for(const m of placeMasks(s)){
      if((lo&m.lo)||(hi&m.hi)) continue;
      any=true;
      const l=applyBits(lo,hi,s,m); if(l>lines) lines=l;
      let f=0;
      for(const [dr,dc] of s.cells){ const i=(m.r+dr)*8+m.c+dc; for(const j of NB[i]) if(j<0) f++; else if(!bitAt(m.lo,m.hi,j)&&bitAt(lo,hi,j)) f++; }
      if(f/per>flush) flush=f/per;
    }
    return any?{lines,flush}:null;
  });
}
function tidePick(ws){ let r=rnd()*ws.reduce((x,y)=>x+y,0); for(let i=0;i<ws.length;i++){ if(!ws[i]) continue; r-=ws[i]; if(r<=0) return SHAPES[i]; } for(let i=ws.length-1;i>=0;i--) if(ws[i]>0) return SHAPES[i]; return SHAPES[0]; }
/* (b) a sound spot for one piece: a drop that clears a line, or one that seals no empty cell in (no hole with all four
   sides filled or wall) and costs at most SOUND_ROOM of the room. */
function sealedNear(lo,hi,m,s){
  for(const [dr,dc] of s.cells){ const i=(m.r+dr)*8+m.c+dc;
    for(const j of NB[i]){ if(j<0||bitAt(lo,hi,j)) continue; let shut=true; for(const k of NB[j]) if(k>=0&&!bitAt(lo,hi,k)){ shut=false; break; } if(shut) return true; } }
  return false;
}
function soundBits(lo,hi,s,room0){
  if(s.star) return true;
  let fallback=false;
  for(const m of placeMasks(s)){
    if((lo&m.lo)||(hi&m.hi)) continue;
    if(applyBits(lo,hi,s,m)) return true;
    const nlo=_lo, nhi=_hi;
    if(sealedNear(nlo,nhi,m,s)) continue;
    fallback=true;
    if(room0===undefined||roomBits(nlo,nhi)>=room0-CFG.SOUND_ROOM) return true;
  }
  return false;
}
/* (c) a way on from the board she is likely to leave: still roomy, or a piece of 2+ cells clears a line there */
function wayOut(lo,hi){
  if(roomBits(lo,hi)>=CFG.ROOM_OK) return true;
  for(const s of SHAPES) if(s.n>=2&&bestDrop(lo,hi,s)>=1) return true;
  return false;
}
/* the stretch's hand: a candidate search like pickHandSteps, its pieces drawn from the stretch's weights times how well
   each fits this board (a shape with no spot is never drawn), scored for the stretch, and checked (a)-(c) above. */
function* tideHandSteps(a0,st,withStar){
  const [lo,hi]=packBits(a0), room0=roomNow, fit=fitTable(lo,hi), easy=st==='easy';
  const ws=SHAPES.map((s,i)=>{ const f=fit[i]; if(!f) return 0;
    const b=tideBase(s,st); return easy?b*(1+CFG.TIDE_FIT*(Math.min(f.lines,3)+f.flush*f.flush)):b; });
  let keys=easy?SHAPES.filter((s,i)=>fit[i]&&fit[i].lines>=1&&s.n>=4):[];             // EASY: big pieces that clear a line right now (a setup's exact piece is one)
  if(easy&&!keys.length) keys=SHAPES.filter((s,i)=>fit[i]&&fit[i].lines>=1&&s.n>=2);
  const multi=keys.filter(s=>fit[SHAPES.indexOf(s)].lines>=2);
  // LEAN's quiet rescue: dry for LEAN_DRY trays, or on a board tighter than LEAN_ROOM, a piece that clears a line comes, the best of them first
  const rescue=!easy&&(dryN>=CFG.LEAN_DRY||room0<CFG.LEAN_ROOM);
  let fixers=[];
  if(rescue){
    const ranked=[];
    SHAPES.forEach((s,i)=>{ if(!fit[i]||!fit[i].lines||s.n<2) return; let best=-1;
      for(const m of placeMasks(s)){ if((lo&m.lo)||(hi&m.hi)) continue; const l=applyBits(lo,hi,s,m); if(!l) continue; const v=l+roomBits(_lo,_hi); if(v>best) best=v; }
      ranked.push({s,v:best}); });
    fixers=ranked.sort((x,y)=>y.v-x.v).slice(0,4).map(x=>x.s);
    if(fixers.length) waveStats.rescues++;
  }
  const later=easy?[]:SHAPES.filter((s,i)=>!fit[i]&&s.n>=4&&s.n<=6);               // (round 2) LEAN puzzle pieces: big ones that do not fit until a line clears
  yield;                                              // the tables above cost a slice of their own
  const tries=easy?CFG.EASY_TRIES:CFG.LEAN_TRIES;
  let bestHand=null, bestSc=-Infinity;
  for(let i=0;i<tries;i++){
    const hand=[tidePick(ws),tidePick(ws),tidePick(ws)];
    if(!easy&&carry.length&&rnd()<CFG.PAIR_CHANCE){                                      // LEAN keeps the partner piece: awkward shapes that sit together
      const ps=(PARTNERS.get(carry[(rnd()*carry.length)|0])||[]).filter(s=>s.n>=4&&fit[SHAPES.indexOf(s)]);
      if(ps.length) hand[(rnd()*3)|0]=ps[(rnd()*ps.length)|0];
    }
    if(easy&&keys.length&&rnd()<0.8){ const pool=multi.length&&rnd()<0.6?multi:keys, j=(rnd()*3)|0; hand[j]=pool[(rnd()*pool.length)|0]; if(rnd()<0.4) hand[(j+1)%3]=keys[(rnd()*keys.length)|0]; }
    if(fixers.length) hand[(rnd()*3)|0]=fixers[i%fixers.length];
    else if(!easy&&later.length&&rnd()<CFG.LEAN_PUZZLE_TRY) hand[(rnd()*3)|0]=later[(rnd()*later.length)|0];   // a big piece with no spot yet: room has to be made for it
    if(withStar) hand[(rnd()*3)|0]=STAR;
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    let sc;
    if(!ev.ok) sc=-1000+ev.lines;
    else {
      const waits=hand.filter(s=>!s.star&&!fitsBits(lo,hi,s)).length;              // pieces that only fit once another has cleared a line (Jay's 3x3 on a tight board)
      const sound=hand.every(s=>!fitsBits(lo,hi,s)&&!s.star||soundBits(lo,hi,s,room0));   // (such a piece has no spot yet: evalHand already proved its turn comes)
      const pp=ev.sweep?[0,0]:predictPlay(lo,hi,hand), left=pp||[ev.flo,ev.fhi];
      const way=left[0]===undefined||wayOut(left[0],left[1]);
      const awk=hand.filter(awkward).length, size=hand.reduce((a,s)=>a+(s.star?0:s.n),0);
      sc=(sound?0:-60)+(way?0:-40)+(pp?0:easy?-60:-25);                                   // pp null: her quick play gets stuck (fair in LEAN, not what EASY is)
      if(easy&&left[0]!==undefined) sc+=CFG.EASY_ROOM*roomBits(left[0],left[1]);   // EASY keeps the board she will leave open
      if(easy){                                                                        // (round 2) a cash-in: the most gems cleared, and late in the stretch, steer toward an empty board
        const late=tide.n>tide.len/2, swept=pp&&!(pp[0]|pp[1]);
        sc+=ev.cleared*CFG.EASY_CASH+(swept?CFG.EASY_SWEEP:0)-(pp&&!swept?CFG.EASY_LOW*(pop32(pp[0])+pop32(pp[1])):0);   // the board she will leave: the fewer gems the better
        if(late&&!swept&&left[0]!==undefined) sc-=CFG.EASY_STEER*Math.min(sweepDist(left[0],left[1]),40);
      }
      if(easy) sc+=(ev.sweep?40:0)+Math.min(ev.lines,6)*14+ev.imm*6+ev.immPieces*5+Math.min(ev.obvPieces,2)*4+size*CFG.EASY_BIG-CFG.TIDY*ev.rough*0.5-(awk>1?30*(awk-1):0);
      else sc+=(waits&&!rescue?CFG.LEAN_PUZZLE:0)+awk*4+size*0.8-CFG.TIDY*ev.rough*(rescue?1:0.5)-(rescue?Math.max(0,ev.lines-CFG.LEAN_LINES-1)*12:Math.max(0,ev.lines-CFG.LEAN_LINES)*25+Math.max(0,ev.immPieces-1)*10);
    }
    if(sc>bestSc){ bestSc=sc; bestHand=hand; }
    if(i>=5&&bestSc>=(easy?80:8)) break;
    yield;
  }
  return bestHand;
}
/* the last guard of the rule: if a hand cannot be played in full from this board (any order, any spots), deal one that
   can: candidate hands of pieces that fit, smaller and smaller, then dots. Returns the hand it keeps. */
function ensureWay(a0,hand,why='rescue'){ return runSteps(ensureWaySteps(a0,hand,why)); }
function* ensureWaySteps(a0,hand,why){
  if(evalHand(a0,hand,CFG.NODE_BUDGET*4).ok) return hand;
  waveStats.guarded++; waveStats.guardBy[why]=(waveStats.guardBy[why]||0)+1;   // (the bot sim reports these by stretch)
  const [lo,hi]=packBits(a0), fit=SHAPES.filter(s=>fitsBits(lo,hi,s));
  for(let cap=9;cap>=1;cap--){
    const pool=fit.filter(s=>s.n<=cap); if(!pool.length) continue;
    for(let i=0;i<24;i++){
      const h=hand.map(s=>s.star||(s.n<=cap&&fitsBits(lo,hi,s))?s:pool[(rnd()*pool.length)|0]);
      if(i>=8||h.every((s,k)=>s===hand[k])) h[(rnd()*3)|0]=pool[(rnd()*pool.length)|0];   // never re-test the hand that failed
      if(i%8===7) yield;
      if(evalHand(a0,h,CFG.NODE_BUDGET*4).ok) return h;
    }
    yield;
  }
  return [SHAPES[0],SHAPES[0],SHAPES[0]];
}
/* the candidate search: the best-scoring playable hand for a tier, plus its solver result */
// The tray deal runs as a generator that yields after every candidate hand, so a deal can be
// spread over a few frames (dealLater) instead of landing in the frame a clear starts. Same
// search, step for step, as running it straight through (genTray / runSteps).
function runSteps(it){ let r; while(!(r=it.next()).done); return r.value; }
function pickHand(a0,density,tier,withStar,candidates){ return runSteps(pickHandSteps(a0,density,tier,withStar,candidates)); }
function* pickHandSteps(a0,density,tier,withStar,candidates=CFG.CANDIDATES,puzzle=false){   // puzzle (golden hand): no GUIDE/OBVIOUS/ALT, still playable and tidy
  const want = tier==='jackpot'?3 : tier==='solvable'||tier==='recovery'?2 : 0;
  // (6.1) honest and edge hands get no help at all; a recovery hand is scored on the sequence, not on easy drops
  const guided = !puzzle && tier!=='honest' && tier!=='edge' && tier!=='recovery';
  const [blo,bhi]=packBits(a0);
  const buildUp=tier==='honest'&&paced()&&CFG.BUILD_UP>0&&trayNo>CFG.EARLY_TRAYS&&wave.n>=wave.at-1;   // (8.2) the tray before a payoff, or a payoff the board could not give yet (the opening trays keep their own light deal)
  // (1.1 A) aiming at a sweep: off cooldown on a small calm or building board, ordinary hands lean toward ones that leave the
  // board closer to a sweep (sweepGap of the tidiest or emptiest board the hand can leave), so the chase has boards to work with
  const aim=paced()&&!puzzle&&CFG.SWEEP_AIM>0&&(tier==='honest'||tier==='solvable')&&closerCool<=0&&sweepCool<=0&&trayNo>CFG.EARLY_TRAYS&&countFlat(a0)<=CFG.AIM_GEMS;
  let bestHand=null,bestEv=null,bestScore=-Infinity,bestRough=999;
  for(let i=0;i<candidates;i++){
    const hand=makeHand(density);
    if(withStar) hand[(rnd()*3)|0]=STAR;      // graded with the star in it, so the score is honest
    const ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    let sc;
    if(tier==='edge'){                                // Block Blast-honest: no piece is dead on arrival; the order and the space are hers
      const fit=hand.filter(s=>fitsBits(blo,bhi,s)).length;
      sc=fit===3?(tideOn()&&!ev.ok?-50:10):-200+fit;                 // (1.1 G) under the tide an edge tray must also play out in full (Jay: the deal never fails)
    }
    else if(!ev.ok) sc=-100+ev.lines;                      // all three must be playable
    else if(tier==='honest') sc=10-CFG.TIDY*ev.rough+(buildUp?CFG.BUILD_UP*payoffRoom(ev.flo,ev.fhi):0);   // any playable hand, prefer the tidiest of a few (8.2: before a payoff, one that leaves a multi-line gap)
    else if(tier==='recovery') sc=ev.lines*10+ev.cleared*1.5-CFG.TIDY*ev.rough+(ev.immPieces<=1?15:0)-(ev.obvPieces>1?15:0);   // the way out is a sequence she has to see
    else sc=(ev.sweep?60:0)+ev.lines*10+ev.cleared*1.5-CFG.TIDY*ev.rough;
    if(ev.ok&&guided) sc+=CFG.GUIDE*(ev.imm*9+ev.immPieces*5+hand.reduce((a,s)=>a+(s.n>=5?3:0),0));   // obvious drops and big pieces: the guided, easy feel
    if(ev.ok&&guided) sc+=CFG.OBVIOUS*Math.min(ev.obvPieces,CFG.OBVIOUS_MAX)+CFG.ALT*ev.alt;       // plan 3.4: clears she sees at a glance, and room for the awkward piece
    if(ev.ok&&aim&&!ev.sweep){ let g=99; if(ev.flo!==undefined) g=sweepGap(ev.flo,ev.fhi); if(ev.glo!==undefined) g=Math.min(g,sweepGap(ev.glo,ev.ghi)); sc-=CFG.SWEEP_AIM*Math.min(g,30); }
    if(sc>bestScore){ bestScore=sc; bestHand=hand; bestEv=ev; }
    if(tier==='edge'){ if(sc>0) break; }
    else if(tier==='honest'){ if(bestEv&&bestEv.ok&&i>=(aim?CFG.AIM_TRIES:buildUp?CFG.BUILD_TRIES:CFG.HONEST_TRIES)-1) break; }
    else if(tier==='recovery'){ if(ev.ok && i>=7 && ev.lines>=want && ev.immPieces<=1) break; }
    else if(ev.ok && i>=7 && ev.lines>=want && ev.rough<=bestRough && (puzzle||!CFG.GUIDE||ev.obvPieces>0)) break;
    if(ev.ok && ev.rough<bestRough) bestRough=ev.rough;
    yield;
  }
  if(!bestHand){ bestHand=[weightedShape(density),weightedShape(density),weightedShape(density)]; bestEv=null; }
  return {hand:bestHand,ev:bestEv};
}
/* Golden hand plan (4.5c): the best way to play the pieces still in the tray. Tries every order and spot (clears
   applied between placements, like evalHand) and returns the most lines (a sweep beats anything), plus WHICH
   lines: ids 0-7 are rows, 8-15 columns. The board paints exactly those, so she sees what to aim for but still
   solves the placement herself. Re-run after every placement so the glow only ever names lines still reachable. */
function lineIds(lo,hi){ let m=0; for(let i=0;i<16;i++){ const L=LINE_MASKS[i*2],H=LINE_MASKS[i*2+1]; if((lo&L)===L&&(hi&H)===H) m|=1<<i; } return m; }
function goldenSolve(a,shapes,budget=6000){
  const [lo0,hi0]=packBits(a), idx=[]; shapes.forEach((s,i)=>{ if(s&&!s.star) idx.push(i); });
  const pm=shapes.map(s=>s&&!s.star?placeMasks(s):null);
  const best={lines:0,sweep:false,mask:0};
  let b=budget;
  function dfs(lo,hi,left,acc,mask){
    if(acc>best.lines){ best.lines=acc; best.mask=mask; }
    for(let q=0;q<left.length;q++){
      const k=left[q], rest=left.filter((_,j)=>j!==q), s=shapes[k];
      for(const m of pm[k]){
        if(b<=0||best.sweep) return;
        if((lo&m.lo)||(hi&m.hi)) continue;
        b--;
        const ids=lineIds(lo|m.lo,hi|m.hi), lines=applyBits(lo,hi,s,m), nlo=_lo, nhi=_hi;
        if(lines&&!nlo&&!nhi){ best.sweep=true; best.lines=Math.max(best.lines,acc+lines); best.mask=mask|ids; return; }
        dfs(nlo,nhi,rest,acc+lines,mask|ids);
      }
    }
  }
  dfs(lo0,hi0,idx,0,0);
  const ids=[]; for(let i=0;i<16;i++) if(best.mask&(1<<i)) ids.push(i);
  return {lines:best.lines,sweep:best.sweep,ids};
}
/* golden hand: a planned sweep if one can be built, else the best jackpot hand.
   Returns false (and deals nothing) if neither offers a real clear. */
function* genGoldenSteps(a0,density){
  let hand=yield* planSweepSteps(a0), ev=hand&&evalHand(a0,hand,6000);
  if(hand&&ev.sweep){ sweepCool=CFG.SWEEP_COOLDOWN; if(!paced()) tension=0.5; }   // same bookkeeping as a normal sweep hand
  else { yield; ({hand,ev}=yield* pickHandSteps(a0,density,'jackpot',false,Math.max(CFG.CANDIDATES,40),true)); }
  if(!ev||!ev.ok||(!ev.sweep&&ev.lines<CFG.GOLDEN_MIN_LINES)) return false;   // a golden hand must be worth chasing; if none is on offer, nothing is dealt
  commitTray(hand,'GOLDEN·'+(ev.sweep?'SWEEP':'JACKPOT'),{sweep:ev.sweep,lines:ev.lines});
  return true;
}
/* Star gem (4.5b): what its cross is worth. For every empty cell, the gems in its row plus its column (the star
   itself leaves none). Returns the best total and up to 3 cells that reach it, so the board can point at them. */
function starBest(g=grid){
  const rowN=new Array(N).fill(0), colN=new Array(N).fill(0);
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(g[r][c]){ rowN[r]++; colN[c]++; }
  let n=0, cells=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(!g[r][c]){
    const v=rowN[r]+colN[c];
    if(v>n){ n=v; cells=[[r,c]]; } else if(v===n&&n>0&&cells.length<3) cells.push([r,c]);
  }
  return {n,cells};
}
const starAt=(r,c,g=grid)=>g[r].reduce((a,v)=>a+(v?1:0),0)+g.reduce((a,row)=>a+(row[c]?1:0),0);   // gems a star dropped on (r,c) would clear
function genTray(){ runSteps(dealSteps()); }
function dealCloser(h){ commitTray(h,'CLOSER'); specialEnd=trayNo; closerCool=CFG.CLOSER_COOL; sweepCool=CFG.SWEEP_COOLDOWN; jackDone(); waveDealt(h); }
function dealSetup(h){ commitTray(h,'SETUP'); chaseNext=true; waveStats.chases++; waveDealt(h); }
function* dealSteps(){
  if(guide&&guideDeal()) return;                       // (1.1 D) the guided first game deals its own lessons
  trayNo++;
  if(mode==='challenge'&&!chGen){ chDealNext(); return; }   // (E1) a Challenge plays its frozen deal (challenge.js); generating it runs the real dealer below
  if(mode==='daily') rndSrc=mulberry(hashStr(dailySeed(trayNo)));   // (4.1b) every tray of the Daily is dealt from the date's stream, so two phones see the same dice
  if(bonusDue()) startBonus();                         // (6.2) a full meter: this tray and the next two pay x2; dealing below is unchanged
  const specialsOk=trayNo>=CFG.SPECIAL_FROM_TRAY;      // trays 1-5 never carry a special
  const a0=packGrid(grid);
  const density=countFlat(a0)/(N*N);
  let tier=paced()?paceTier(a0):pickTier(a0);           // (6.1) Endless and Daily: the phase decides; Adventure: the tension wave
  sweepCool=Math.max(0,sweepCool-1);
  goldenCool=Math.max(0,goldenCool-1);
  transformCool=Math.max(0,transformCool-1);
  starCool=Math.max(0,starCool-1);

  waveTick();                                           // (7.3) setups age, the dry spell and the wave clock count
  const freeOfSpecials=specialsOk&&!goldenNext&&!golden&&trayNo>specialEnd+1;   // (7.3) a closer never shares a tray with a star or golden hand, nor follows a special (bonus trays and looks only change points and colours, so they allow one)
  const tideNow=tideOn()&&tier!=='edge'&&tier!=='recovery'?tideStep():null;   // (1.1 G) 'easy' | 'lean' (null: edge, recovery, or no tide)
  if(tideNow) tier=tideNow;                             // the stretch replaces calm/building/relief's tiers (relief started a fresh EASY one)
  // 'closer' | 'payoff' | 'jackpot' | null; under the tide only an earned closer, in EASY (LEAN keeps it waiting)
  let wt=tideOn()?(tideNow==='easy'&&freeOfSpecials&&(chaseNow||closerNext&&closerCool<=0)?(closerNext=false,'closer'):null):waveTier(tier,freeOfSpecials);

  // a star is dealt on ordinary trays only; a golden or sweep tray leaves a guaranteed one waiting
  // (4.5b) only when a cross is worth it, outside the specialOk() rules (trays 1-5, one live, never two in a row) and the cooldown
  const wantStar=!wt && tier!=='edge' && tier!=='recovery' && special('star') && specialOk() && starCool<=0 && starBest(grid).n>=CFG.STAR_MIN && (starForced || rnd()<CFG.STAR_CHANCE);

  if(goldenNext && special('golden') && specialOk()){ goldenNext=false; if(yield* genGoldenSteps(a0,density)){ jackDone(); waveDealt(tray.map(t=>t.s)); return; } }   // (4.5c) the shared special rules: trays 1-5, one live, never two in a row

  if(mode==='adventure'&&lvl&&lvl.goal.type==='sweep'){   // (4.1) a sweep level: a sweep is dealt whenever one can be built
    const h=yield* planSweepSteps(a0);
    if(h){ commitTray(h,'SWEEP'); sweepCool=CFG.SWEEP_COOLDOWN; return; }
  }
  let hunted=false;
  if(tier==='sweep'){
    const h=paced()?yield* closerSteps(a0):yield* planSweepSteps(a0);
    if(h){ commitTray(h,'SWEEP'); sweepCool=CFG.SWEEP_COOLDOWN; if(!paced()) tension=0.5; waveDealt(h); return; }
    tier='jackpot'; hunted=true;                         // (1.1 A) this board was just hunted: the between-closers path skips it
  }
  // (1.1) the sweep run (see runHandSteps): start or continue it on a low calm board, or end it
  if(paced()&&mode!=='challenge'&&CFG.RUN_TRAYS>0){
    const n=countFlat(a0), ok=!hunted&&(tideNow==='easy'?pace.ph!=='edge':runPhase())&&tideNow!=='lean'&&tier!=='edge'&&tier!=='recovery'&&freeOfSpecials&&n>0;
    const easyRun=tideNow==='easy'&&CFG.EASY_RUN_GEMS>0;      // (round 2) EASY chases board clears harder: bigger boards, no cooldown, longer runs
    const runGems=easyRun?Math.max(CFG.RUN_GEMS,CFG.EASY_RUN_GEMS):CFG.RUN_GEMS, runTrays=easyRun?Math.max(CFG.RUN_TRAYS,CFG.EASY_RUN_TRAYS):CFG.RUN_TRAYS;
    if(sweepRun&&(!ok||n>runGems+CFG.RUN_SLACK||sweepRun.n>=runTrays)) endRun();
    else if(!sweepRun&&ok&&n<=runGems&&(easyRun||closerCool<=0&&sweepCool<=0)&&trayNo>CFG.EARLY_TRAYS) sweepRun={n:0};
    if(sweepRun){
      const [lo,hi]=packBits(a0);
      const h=wt==='closer'?yield* closerSteps(a0):sweepGap(lo,hi)<=CFG.SWEEP_HUNT_CELLS?yield* sweepHuntSteps(lo,hi):null;   // an earned closer keeps its exact-tiling fallback
      if(h){ waveStats.runSwept++; sweepRun=null; dealCloser(h); closerCool=Math.max(closerCool,CFG.RUN_COOL); return; }
      const r=yield* runHandSteps(a0);
      if(r&&r.sweep){ waveStats.runSwept++; sweepRun=null; dealCloser(r.hand); closerCool=Math.max(closerCool,CFG.RUN_COOL); return; }
      if(r){ if(wt==='closer') closerNext=true;          // an earned closer the run could not pay yet stays on the hook
        if(!sweepRun.n) waveStats.runs++; sweepRun.n++; commitTray(r.hand,r.set?'RUN·SET':'RUN'); waveDealt(r.hand); return; }
      endRun();
    }
  }
  if(wt==='closer'){                                    // (7.3) an earned closer: a planned sweep, the tray shimmers
    waveStats.closerTries++;
    const h=yield* closerSteps(a0);
    if(h){ dealCloser(h); return; }
    if(!chaseNow&&chaseCool<=0&&countFlat(a0)<=CFG.CHASE_GEMS){   // (1.1 A) no sweep yet: a set-up hand that can leave one, and the closer comes next tray
      const c=yield* chaseSteps(a0,density);
      if(c){ dealSetup(c); return; }
      chaseCool=CFG.CHASE_COOL;                         // none on this board: a closer left on the hook does not search again every tray
    }
    wave.due=true; wt='closein';                        // no sweep on this board yet: a payoff that clears the most it can
    if(countFlat(a0)<=CFG.CLOSER_GEMS) closerNext=true;   // a small board stays on the hook: the closer tries again next tray
  }
  // (1.1 A) between closers: whenever the board is small enough, off cooldown and free of specials, a board that can be swept
  // gets its sweep hand (closer rules: shimmer, cooldown). Only the hunt, which costs next to nothing on a board with no cover;
  // the dearer set-up chase stays with the earned closers above.
  if(paced()&&!wt&&!hunted&&tideNow!=='lean'&&tier!=='edge'&&tier!=='recovery'&&freeOfSpecials&&(tideNow==='easy'&&CFG.EASY_RUN_GEMS>0||closerCool<=0&&sweepCool<=0)&&!chaseNow&&countFlat(a0)<=CFG.SWEEP_MAX){
    const [lo,hi]=packBits(a0);
    if(sweepGap(lo,hi)<=CFG.SWEEP_HUNT_CELLS){ const h=yield* sweepHuntSteps(lo,hi); if(h){ dealCloser(h); return; } }
  }
  if(wt==='jackpot'){                                   // (8.2) three pieces, 3+ lines; else the payoff below (the jackpot stays due)
    const h=yield* jackpotSteps(a0,density);
    if(h){ commitTray(h,'JACKPOT'); jackDone(); waveDealt(h); return; }
    wt='payoff';
  }
  if(wt==='payoff'||wt==='closein'){                    // (7.3) a big block that clears PAYOFF_LINES+ at once, if the board offers one; else build and retry next tray
    const h=yield* payoffSteps(a0,density,wt==='closein');
    if(h){ commitTray(h,'PAYOFF'); waveDone(); waveDealt(h); return; }

  }

  let hand;
  if(tideNow) hand=yield* ensureWaySteps(a0,yield* tideHandSteps(a0,tideNow,wantStar),tideNow);   // (1.1 G) the stretch's hand, and the rule's last guard
  else if(tideOn()) hand=yield* ensureWaySteps(a0,(yield* pickHandSteps(a0,density,tier,wantStar)).hand,tier);   // edge and recovery under the tide: as before, but always solvable
  else {
    ({hand}=yield* pickHandSteps(a0,paced()&&pace.ph==='building'?density*CFG.BUILD_BIAS:density,tier,wantStar));
    hand=offerSetup(a0,noTedium(a0,hand,tier),tier);     // (7.3) never three small pieces while a big one fits; the setup's piece, sometimes
  }
  waveDealt(hand);
  if(hand.includes(STAR)){ starForced=false; starCool=CFG.STAR_COOL; }
  commitTray(hand,tier.toUpperCase()+(hand.includes(STAR)?'+STAR':''));
}
/* The opening (plan 3.1): a new game does not start on an empty board with random pieces. The board holds a
   seeded pattern, one or two nearly-full lines each missing one gap of 2-4 cells, and the first tray is
   verified with the solver to complete a line with a single obvious drop (plus the other two pieces still
   playable). So her first move is a clear, and every game starts the same relaxed way.
   Plan 6.0: most openings also scatter 2-4 gems outside the seeded lines, so the first clear leaves blocks
   instead of emptying the board (no clean-sweep bonus on move one). About 1 in 8 keep the board bare, so a
   sweep is still possible sometimes, never always. */
let openingKind='busy';   // plan 7.2: which kind of opening the last game was dealt (light, gift or busy)
function seedOpening(force){                               // force: 'light' after the guided first game (1.1 D)
  const u=rnd();                                           // plan 7.2: a weighted roll, so most games open calm
  let kind=force||(u<CFG.OPENING_LIGHT?'light':u<CFG.OPENING_LIGHT+CFG.OPENING_GIFT?'gift':'busy');
  if(kind==='light'){                                      // 3-8 loose gems, at most 3 to a row or column: nothing is near complete
    for(let attempt=0;attempt<200;attempt++){
      const g=empty(), nLoose=3+((rnd()*6)|0), rowN=new Array(N).fill(0), colN=new Array(N).fill(0);
      for(let placed=0,tries=0;placed<nLoose&&tries<300;tries++){
        const r=(rnd()*N)|0, c=(rnd()*N)|0;
        if(g[r][c]||rowN[r]>=3||colN[c]>=3) continue;
        g[r][c]={gi:(rnd()*NCOLOR)|0,t:1,f:0,l:0}; rowN[r]++; colN[c]++; placed++;
      }
      const hand=[weightedShape(0.2),weightedShape(0.2),weightedShape(0.2)];
      const ev=evalHand(packGrid(g),hand,CFG.NODE_BUDGET);
      if(!ev.ok||ev.lines<1) continue;                     // a tidy stacker clears within the hand (a set-up, not a one-drop gift)
      grid=g; trayNo=1; openingKind='light'; commitTray(hand,'OPENING'); return;
    }
    kind='busy';                                           // no light board with a clearing drop turned up: fall back to the 6.0 opening
  }
  openingKind=kind;
  for(let attempt=0;attempt<200;attempt++){
    const g=empty(), vert=rnd()<0.5, rowsN=1+((rnd()*2)|0);
    const gap=rowsN===2?2+((rnd()*2)|0):2+((rnd()*3)|0);    // a 2-line gap is 2-3 wide: it takes one rectangle
    const gs=(rnd()*(N-gap+1))|0, l0=(rnd()*(N-rowsN+1))|0;
    // gift: one obvious clear, and a sweep about a third of the time (no scattered gems); busy: the 6.0 opening
    const scatter=kind==='gift' ? rnd()>=0.35 : rnd()>=CFG.OPENING_SWEEP_CHANCE;
    const nScatter=kind==='gift' ? 1 : 2+((rnd()*3)|0);
    for(let k=0;k<rowsN;k++) for(let j=0;j<N;j++){
      if(j>=gs&&j<gs+gap) continue;
      const r=vert?j:l0+k, c=vert?l0+k:j;
      g[r][c]={gi:(rnd()*NCOLOR)|0,t:1,f:0,l:0};
    }
    if(scatter){                                             // gems only outside the seeded band, so they survive the clear
      const free=[];
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        const line=vert?c:r;
        if(line>=l0&&line<l0+rowsN) continue;
        free.push([r,c]);
      }
      for(let i=0;i<nScatter&&free.length;i++){
        const [r,c]=free.splice((rnd()*free.length)|0,1)[0];
        g[r][c]={gi:(rnd()*NCOLOR)|0,t:1,f:0,l:0};
      }
    }
    const bar=n=>SHAPES.find(s=>s.n===n&&(vert?s.cols===1:s.rows===1)&&s.rows*s.cols===n);   // a straight piece n long, lying along the line
    const rect=SHAPES.find(s=>s.n===gap*rowsN&&(vert?s.rows===gap&&s.cols===rowsN:s.cols===gap&&s.rows===rowsN)&&s.rows*s.cols===s.n);
    const key=rect&&rowsN>1?rect:bar(gap);
    if(!key) continue;
    const hand=rshuffle([key,weightedShape(0.2),weightedShape(0.2)]);
    const a0=packGrid(g), ev=evalHand(a0,hand,CFG.NODE_BUDGET);
    if(!ev.ok||ev.imm<1) continue;
    grid=g; trayNo=1; commitTray(hand,'OPENING'); return;
  }
  grid=empty(); genTray();                                  // (unreachable in practice: 200 tries of a verified construction)
}
/* rescue hand: playable, and rich in clears (sweep if one can be built) */
function genRescue(){
  const a0=packGrid(grid);
  const density=countFlat(a0)/(N*N);
  if(paced()){                                      // (6.1) a recovery hand: a way out she has to see, not a jackpot
    const {hand,ev}=pickHand(a0,density,'recovery',false,CFG.CANDIDATES*4);
    if(ev&&ev.ok){ commitTray(hand,'RESCUE'); return; }
  }
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
  commitTray(tideOn()?ensureWay(a0,bestHand):bestHand,'RESCUE');   // (1.1 G) under the tide even the rescue's last resort has a solution
}
function pushBanner(txt,sub,col,k){   // queued: one on screen at a time, the next starts as this one fades (frame); k>1 runs it faster
  banners.push({t:0,txt,sub,col:col||'#FFD45C',k:k||1});
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
  const P=PRAISE[tier], word=P.words[(rnd()*P.words.length)|0];
  praises.length=0;                                 // newest wins — words never stack up
  praises.push({t:0,tier,word,a:P.a,b:P.b});
  const x=W/2, y=by+B*0.3, n=Math.min(6+tier*6,fxRoom());
  for(let k=0;!reduce&&k<n;k++){
    const ang=rnd()*6.283, sp=2.5+rnd()*(3+tier*1.6);
    bursts.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp*0.75,life:1,
      r:cell*(0.1+rnd()*0.13),col:rnd()<.5?P.a:P.b});
  }
  if(tier>=3) waves.push({x,y,t:0});
  if(tier) Sfx.praise(tier);
}
function commitTray(shapes,label,plan){
  tray=shapes.map(s=>({s,gi:s.star?STAR_GI:plan?GOLD:(rnd()*NCOLOR)|0}));
  if(chGen){ lastTier=label; carry=shapes.filter(x=>!stackable(x)); return; }   // (E1) generating a Challenge deal: only what the dealer reads back
  golden=plan?{want:plan,got:{lines:0,sweep:false},pts:0}:null;
  if(plan){
    goldenCool=CFG.GOLDEN_COOLDOWN;
    goldenReplan(); goldenArrive=0;
    pushBanner('GOLDEN HAND','×'+CFG.GOLDEN_MULT+' if you find it');
    Sfx.goldenIn();
  }
  lastTier=label;
  closerTray=label==='CLOSER'||(label==='SWEEP'&&paced());   // (7.3) the shimmer behind the tray: this hand can empty the board
  carry=shapes.filter(x=>!stackable(x));
  if(shapes.includes(STAR)) Sfx.starIn();
  if(shapes.includes(STAR)) hesVoid(); else hesDealt();   // a star tray is no normal hesitation sample
  updateDbg(); syncActions();
}
// forgiving success rule: one line short of the plan is fine (min 1); a planned sweep needs a sweep or 3+ lines
const goldenNeed=w=>w.sweep?'sweep or 3 lines':Math.max(1,w.lines-1)+' lines';
function goldenResult(g){         // {hit: found the plan, mult: 1 = missed entirely}
  const hit=g.want.sweep?(g.got.sweep||g.got.lines>=3):g.got.lines>=Math.max(1,g.want.lines-1);
  if(hit) return {hit,mult:Math.max(CFG.GOLDEN_MULT,CFG.GOLDEN_PARTIAL)};
  return {hit,mult:g.got.lines>0||g.got.sweep?CFG.GOLDEN_PARTIAL:1};
}
/* the live plan: re-run for the pieces still in the tray. `need` is the lines that pay the full multiplier (a planned
   sweep pays for a sweep or 3 lines; otherwise one short of the plan is fine). alive = still reachable, locked = already earned. */
function goldenReplan(){
  if(!golden) return;
  const left=tray.map(t=>t?t.s:null);
  golden.plan=goldenSolve(packGrid(grid),left);
}
function goldenState(g=golden){                 // 'alive' (lines still to go), 'locked' (full multiplier earned), 'dead' (only the consolation is left)
  if(!g) return null;
  const need=g.want.sweep?3:Math.max(1,g.want.lines-1);
  if(g.got.sweep||g.got.lines>=need) return 'locked';
  const p=g.plan||{lines:0,sweep:false};
  return (g.want.sweep&&p.sweep)||g.got.lines+p.lines>=need?'alive':'dead';
}
const goldenLeft=g=>Math.max(0,(g.want.sweep?3:Math.max(1,g.want.lines-1))-g.got.lines);
function updateDbg(){
  const d=el('dbg');
  d.hidden=!CFG.SHOW_TENSION;
  if(d.hidden) return;
  const gold=golden?`GOLDEN plan ${golden.want.sweep?'sweep':golden.want.lines+' lines'}, need ${goldenNeed(golden.want)}, got ${golden.got.sweep?'sweep+':''}${golden.got.lines} lines, ${golden.pts} pts`
    :goldenNext?'gold queued':goldenCool>0?`gold cooldown ${goldenCool}`:'gold ready';
  const star=!special('star')?'star off':starForced?'star guaranteed':'star on';
  const pc=paced()?`${pace.ph} ${pace.n}${pace.ph==='edge'?'/'+pace.hold:''} · room ${roomNow.toFixed(2)} · `:'';
  d.textContent=`${pc}tension ${tension.toFixed(2)} · ${lastTier} · ${gold} · ${star}`;
}

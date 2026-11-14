// Crumble — the Lab: new ways to play, tried without touching Endless. First experiment: "Clear it in three".
// Plain script, loaded in order by index.html (after dares.js); shares globals with the other js/ files.
/* ═══════ the Lab ═══════
   A slim "Lab" button on the front menu (beside Settings) opens the Lab card: one tile per experiment, built from the
   LAB registry below (a later experiment adds one line there). Each tile has a title, a one-line description and its
   progress; open() takes it from there.

   ═══════ Clear it in three ═══════
   A puzzle: a part-filled board, exactly three pieces in the tray, nothing more is dealt. Place all three so the board ends
   completely empty. No score, no timer, no losing: a drop that leaves her unable to finish (a piece that fits nowhere, or
   all three placed with gems left) gets "Not quite" and the board puts itself back after a beat. Reset and a one-step Undo
   are always there. After three failed tries on a puzzle Crumb offers a hint: a ghost of where one right piece goes.
   Solving plays the clean-sweep moment, then a small card.

   Puzzles. Puzzle #k is the same board and pieces for every player forever: generated from k alone with a private
   generator (mulberry seeded by 'crumble-lab3-k-salt'; never Math.random or the dealer's rnd()). 60 puzzles, three bands
   of 20 (easy, medium, hard). Built backwards from a solution (l3Build): pick the lines the last piece clears and carve
   its seat out of them, then the lines the middle piece clears (the board before it is the board after it plus those
   lines, minus the piece), then the first. Every gem lies in a line that clears, and the build's own play empties the
   board, so it always has a solution. Then the exhaustive solver (l3Solve: every order, every placement, line clears
   applied between drops, the same applyBits the dealer uses) counts the distinct solutions and grades it against its band:
     easy    1-2 parallel lines, any order works, at most L3_MAX[0] solutions, bars / squares / small Ls
     medium  2-3 lines, a row and a column, not order-bound, at most L3_MAX[1] solutions, a tempting wrong seat
     hard    every solution needs a piece whose seat is only free once an earlier piece's line has cleared, at most
             L3_MAX[2] solutions, a tempting wrong seat; S, Z and T pieces welcome
   (a tempting wrong seat: a first drop that clears a line or sits in a line's gap, after which no solution exists).
   No puzzle can sweep the board before its third piece. Distinct: a puzzle's key is its board up to rotation, reflection
   and shifting plus its pieces' shapes up to rotation; puzzles are made in order (l3MakeAll) and puzzle k skips any
   candidate whose key an earlier puzzle has; of the first L3_PICK good candidates it keeps the best (l3Score: bigger,
   more varied pieces). Making all 60 takes about 4 s on a laptop, too slow for a phone at open, so the result is kept as
   the table L3_TABLE below: tools/lab3-table.mjs rewrites it, and a test checks it is exactly what l3MakeAll() makes.
   Changing the generator changes the puzzles: the test pins a fingerprint of all 60, so do that on purpose or not at all.

   Mode `lab`: the real board, drag and clear effects, its own run. No dealer, specials, bonus meter, Avalanche, cannonball
   charge, dares, journey sky, best score, stats, Game Center or saved run (leaving mid-puzzle restarts it). The HUD shows
   "Puzzle 12" with Undo and Reset where the score would be. Progress: `crumble.lab` = {v:1, three:{done:[k...], at:k}}. */
const LAB_STORE='crumble.lab';
const L3_COUNT=60, L3_BAND=20, L3_BANDS=['easy','medium','hard'];
const L3_MAX=[8,4,2];                                  // most distinct solutions a puzzle of each band may have
// the 37 shapes by family (RAW's order, shapes.js); readable ones early, awkward ones later
const L3_CLASS=i=>i===0?'dot':i<=8?'bar':(i===9||i===10||i>=35)?'rect':i<=14?'l3':i<=18?'bigL':i<=22?'sz':i<=26?'t':'l4';
const L3_WT={easy:  {dot:.05,bar:3,  rect:3,  l3:1.2,bigL:.6, sz:0,  t:0,  l4:0},
             medium:{dot:.05,bar:1.6,rect:1.6,l3:1.6,bigL:1.4,sz:.8, t:1,  l4:1.4},
             hard:  {dot:.05,bar:1,  rect:1,  l3:1,  bigL:1.2,sz:1.8,t:1.8,l4:1.8}};
const l3Lo=i=>LINE_MASKS[i*2], l3Hi=i=>LINE_MASKS[i*2+1];
const l3Touch=(m,i)=>!!((m.lo&l3Lo(i))||(m.hi&l3Hi(i)));

/* ── building one candidate, backwards from its solution ── */
// the lines each step clears (step 2 = the last piece): picked by band, the later steps first
function l3Plan(rng,band,j){
  const any=o=>(o?8:0)+((rng()*8)|0), other=(o,not)=>{ let i; do i=any(o); while(not.includes(i)); return i; };
  const o=rng()<.5?0:1;
  if(band==='easy'){
    if(j<3||rng()<.25) return [[],[],[any(o)]];       // one line: three pieces fill its gaps, the last one clears it
    const a=any(o), b=other(o,[a]);
    return rng()<.75?[[],[],[a,b]]:[[],[b],[a]];
  }
  if(band==='medium'){
    const r=any(0), c=any(1), v=rng();
    if(v<.35) return [[],[],[r,c]];                      // the last piece fills the crossing
    if(v<.6) return o?[[],[r],[c]]:[[],[c],[r]];          // one line, then the one across it
    if(v<.8) return [[],[o?other(0,[r]):other(1,[c])],[r,c]];
    return [[o?other(0,[r]):other(1,[c])],[],[r,c]];
  }
  return null;                                           // hard: picked as it goes (l3Build), across the later pieces' seats
}
// lines across a placed piece's seat (hard): clearing one of them first is what frees that seat
function l3Across(rng,m,not){
  const ids=[]; for(let i=0;i<16;i++) if(!not.includes(i)&&l3Touch(m,i)) ids.push(i);
  return ids.length?ids[(rng()*ids.length)|0]:-1;
}
function l3Build(rng,band,j){
  const wt=L3_WT[band], plan=l3Plan(rng,band,j), steps=[null,null,null], lines=[[],[],[]];
  let lo=0, hi=0;
  for(let t=2;t>=0;t--){
    let S;
    if(plan) S=plan[t];
    else if(t===2){ const a=(rng()*16)|0; S=rng()<.5?[a]:[a,a<8?8+((rng()*8)|0):(rng()*8)|0]; }
    else{
      S=[];
      const a=l3Across(rng,steps[2].m,lines[2]); if(t===1&&a>=0) S.push(a);
      if(t===0&&rng()<.5){ const b=l3Across(rng,(rng()<.5?steps[1]:steps[2]).m,[...lines[1],...lines[2]]); if(b>=0) S.push(b); }
      if(t===1&&rng()<.3){ const b=l3Across(rng,steps[2].m,[...lines[2],...S]); if(b>=0) S.push(b); }
    }
    let ulo=0, uhi=0, sm=0; for(const i of S){ ulo|=l3Lo(i); uhi|=l3Hi(i); sm|=1<<i; }
    const plo=lo|ulo, phi=hi|uhi;
    if(lineIds(plo,phi)!==sm) return null;              // the board before the clear would complete other lines too
    const cs=[]; let tot=0;                              // every shape and seat inside that board, touching each line it clears
    for(let si=0;si<SHAPES.length;si++){
      const w=wt[L3_CLASS(si)]; if(!w) continue;
      for(const m of placeMasks(SHAPES[si])){
        if((m.lo&~plo)||(m.hi&~phi)) continue;
        if(!S.every(i=>l3Touch(m,i))) continue;
        cs.push(si,m,w); tot+=w;
      }
    }
    if(!tot) return null;
    let r=rng()*tot, k=0; for(;k<cs.length-3;k+=3){ r-=cs[k+2]; if(r<=0) break; }
    steps[t]={si:cs[k],m:cs[k+1]}; lines[t]=S;
    lo=plo&~cs[k+1].lo; hi=phi&~cs[k+1].hi;
  }
  if(pop32(lo)+pop32(hi)<3) return null;                 // a board worth looking at
  return {lo,hi,steps,lines};
}

/* ── the key: the board up to rotation, reflection and shifting, plus the pieces' families ── */
const L3_FAM=SHAPES.map(s=>{                             // a shape's family: its cells under all eight turns and flips, the smallest
  let best='';
  for(let t=0;t<8;t++){
    const c=s.cells.map(([r,q])=>{ let a=r,b=q; if(t&4){ const x=a; a=b; b=x; } if(t&1) a=-a; if(t&2) b=-b; return [a,b]; });
    const r0=Math.min(...c.map(x=>x[0])), c0=Math.min(...c.map(x=>x[1]));
    const k=c.map(([a,b])=>(a-r0)*8+(b-c0)).sort((x,y)=>x-y).join(',');
    if(!best||k<best) best=k;
  }
  return best;
});
function l3Key(lo,hi,sis){
  const on=[]; for(let i=0;i<64;i++) if(bitAt(lo,hi,i)) on.push([i>>3,i&7]);
  let best='';
  for(let t=0;t<8;t++){
    const c=on.map(([r,q])=>{ let a=r,b=q; if(t&4){ const x=a; a=b; b=x; } if(t&1) a=7-a; if(t&2) b=7-b; return [a,b]; });
    const r0=Math.min(...c.map(x=>x[0])), c0=Math.min(...c.map(x=>x[1]));
    const bits=new Array(64).fill(0); for(const [a,b] of c) bits[(a-r0)*8+b-c0]=1;
    const k=bits.join('');
    if(!best||k<best) best=k;
  }
  return best+'|'+sis.map(i=>L3_FAM[i]).sort().join('/');
}

/* ── the exhaustive solver ──
   Every order of the three pieces, every legal seat, line clears applied between drops. Two drops of one shape are one
   choice (no counting a twin twice). A solution is the set of seats (shape, row, col) whatever the order it was played
   in; `orders` counts the orders that work for it. Pruned only where no finish can exist: a gem whose row and column
   both have more empty cells than the pieces left can fill. `early`: some line of play sweeps the board before the
   third piece (a dead end that would look like a win). `first`: every first drop that can still lead to a solution.
   Stops once more than `cap` solutions are found (the puzzle is rejected then anyway). */
function l3Room(lo,hi,R){                                 // can every gem still be cleared with R cells of pieces?
  let badC=0;
  for(let c=0;c<8;c++) if(8-pop32(lo&l3Lo(8+c))-pop32(hi&l3Hi(8+c))>R) badC|=1<<c;
  if(!badC) return true;
  for(let r=0;r<8;r++){
    const row=(r<4?lo>>>(r*8):hi>>>((r-4)*8))&0xFF;
    if(row&&8-pop32(row)>R&&(row&badC)) return false;
  }
  return true;
}
function l3Solve(lo0,hi0,shapes,cap=99){
  const out={n:0,sets:new Map(),early:false,first:new Set(),over:false};
  const pm=shapes.map(s=>s?placeMasks(s):null), seq=[];
  const left0=shapes.reduce((a,s)=>a+(s?s.n:0),0), want=shapes.filter(Boolean).length;
  function dfs(lo,hi,used,depth,R){
    if(out.over) return;
    if(depth===want){
      if(lo||hi) return;
      const key=seq.map(([k,m])=>SHAPES.indexOf(shapes[k])*64+m.r*8+m.c).sort((a,b)=>a-b).join(',');
      let s=out.sets.get(key);
      if(!s){ s={orders:0,seq:seq.map(([k,m])=>[k,m.r,m.c])}; out.sets.set(key,s); out.n++; if(out.n>cap){ out.over=true; return; } }
      s.orders++; out.first.add(seq[0][0]+':'+seq[0][1].r+':'+seq[0][1].c);
      return;
    }
    if(!l3Room(lo,hi,R)) return;
    for(let k=0;k<shapes.length;k++){
      if(!shapes[k]||used&(1<<k)) continue;
      let twin=false; for(let q=0;q<k;q++) if(shapes[q]===shapes[k]&&!(used&(1<<q))) twin=true;
      if(twin) continue;
      const s=shapes[k];
      for(const m of pm[k]){
        if((lo&m.lo)||(hi&m.hi)) continue;
        applyBits(lo,hi,s,m); const nlo=_lo, nhi=_hi;
        if(!nlo&&!nhi&&depth<want-1){ out.early=true; continue; }
        seq.push([k,m]); dfs(nlo,nhi,used|1<<k,depth+1,R-s.n); seq.pop();
        if(out.over) return;
      }
    }
  }
  dfs(lo0,hi0,0,0,left0);
  return out;
}

/* ── grading against the band ── */
function l3Grade(lo,hi,sis,band){
  const shapes=sis.map(i=>SHAPES[i]), sol=l3Solve(lo,hi,shapes,L3_MAX[L3_BANDS.indexOf(band)]);
  if(sol.over||sol.early||!sol.n) return null;
  const sets=[...sol.sets.values()];
  const gems=pop32(lo)+pop32(hi);
  const blocked=s=>s.seq.some(([k,r,c])=>{ const m=placeMasks(shapes[k]).find(x=>x.r===r&&x.c===c); return (m.lo&lo)||(m.hi&hi); });   // a seat that holds gems at the start: free only after a clear
  // the lines a line of play clears (rows, columns), from the start
  const play=q=>{ let a=lo,b=hi,rows=0,cols=0; for(const [k,r,c] of q){ const m=placeMasks(shapes[k]).find(x=>x.r===r&&x.c===c), ids=lineIds(a|m.lo,b|m.hi); for(let i=0;i<16;i++) if(ids&(1<<i)){ if(i<8) rows++; else cols++; } applyBits(a,b,shapes[k],m); a=_lo; b=_hi; } return {rows,cols}; };
  // a tempting wrong first drop: it clears a line or sits in the gap of a line with 5+ gems, and nothing finishes from it
  const rowN=[], colN=[]; for(let i=0;i<8;i++){ rowN.push(pop32(lo&l3Lo(i))+pop32(hi&l3Hi(i))); colN.push(pop32(lo&l3Lo(8+i))+pop32(hi&l3Hi(8+i))); }
  let decoy=false;
  for(let k=0;k<3&&!decoy;k++) for(const m of placeMasks(shapes[k])){
    if((lo&m.lo)||(hi&m.hi)||sol.first.has(k+':'+m.r+':'+m.c)) continue;
    if(shapes.some((s,q)=>q<k&&s===shapes[k])) break;                       // a twin's seats were looked at already
    const clears=lineIds(lo|m.lo,hi|m.hi)!==0;
    const gap=shapes[k].cells.every(([dr,dc])=>rowN[m.r+dr]>=5||colN[m.c+dc]>=5);
    if(clears||gap){ decoy=true; break; }
  }
  const allFree=sets.every(s=>s.orders===6), forced=sets.every(blocked);
  const L=play(sets[0].seq);
  if(band==='easy') return allFree&&!(L.rows&&L.cols)&&L.rows+L.cols<=2?{sol,sets,decoy,L,gems}:null;
  if(band==='medium') return !forced&&L.rows&&L.cols&&L.rows+L.cols<=3&&decoy?{sol,sets,decoy,L,gems}:null;
  return forced&&decoy&&L.rows+L.cols>=2?{sol,sets,decoy,L,gems}:null;
}

/* ── the 60 puzzles ──
   l3MakeAll() generates them in order, deterministically: for puzzle k it builds candidates from the seeds
   'crumble-lab3-k-0', '-1', ... until L3_PICK of them pass the band's grade and are not a trivial duplicate (same key)
   of an earlier puzzle, and keeps the one that reads best (l3Score: bigger, more varied pieces, a gem count that climbs
   through the band, fewer solutions; awkward pieces in the hard band). It takes a second or two on a laptop, too slow to
   run on a phone when a puzzle opens, so its output is written down in L3_TABLE (tools/lab3-table.mjs prints it) and
   l3Puzzle(k) reads the table. A test regenerates all 60 and checks they still match the table exactly. */
const L3_PICK=8;
function l3Score(c,g,band,j){
  const sis=c.steps.map(s=>s.si);
  let v=0;
  for(const si of sis){ const n=SHAPES[si].n; v+=n<=1?-3:n===2?-1:n===3?.5:1.5; if(band==='hard'&&/sz|t|l4/.test(L3_CLASS(si))) v+=.8; }
  v+=new Set(sis.map(i=>L3_FAM[i])).size-1;
  const want=band==='easy'?4+j*0.3:band==='medium'?8+j*0.2:12+j*0.3;
  v-=Math.abs(g.gems-want)*0.3;
  v-=band==='easy'?0.15*g.sol.n:band==='medium'?0.5*(g.sol.n-1):1.2*(g.sol.n-1);
  return v;
}
function l3Make(k,keys){
  const b=Math.min(2,((k-1)/L3_BAND)|0), band=L3_BANDS[b], j=(k-1)%L3_BAND;
  let best=null, found=0;
  for(let salt=0;found<L3_PICK&&salt<50000;salt++){
    const rng=mulberry(hashStr('crumble-lab3-'+k+'-'+salt));
    const c=l3Build(rng,band,j); if(!c) continue;
    const sis=c.steps.map(s=>s.si), key=l3Key(c.lo,c.hi,sis);
    if(keys.has(key)) continue;                          // a trivial duplicate of an earlier puzzle
    const g=l3Grade(c.lo,c.hi,sis,band); if(!g) continue;
    found++;
    const v=l3Score(c,g,band,j); if(best&&v<=best.v) continue;
    // colours: each gem takes the colour of a line it clears with (the last piece's lines first), each piece its own
    const lc=new Map(), cols=[];
    for(const S of [c.lines[2],c.lines[1],c.lines[0]]) for(const i of S) if(!lc.has(i)) lc.set(i,(rng()*NCOLOR)|0);
    for(let i=0;i<64;i++) if(bitAt(c.lo,c.hi,i)){ let col=0; for(const S of [c.lines[2],c.lines[1],c.lines[0]]) for(const l of S) if(!col&&bitAt(l3Lo(l),l3Hi(l),i)) col=lc.get(l)+1; cols.push(col-1); }
    const order=[0,1,2]; for(let i=2;i>0;i--){ const q=(rng()*(i+1))|0; [order[i],order[q]]=[order[q],order[i]]; }   // the tray never gives the order away
    best={v,key,lo:c.lo|0,hi:c.hi|0,cols,pieces:order.map(t=>[sis[t],(rng()*NCOLOR)|0]),sol:c.steps.map((s,t)=>[order.indexOf(t),s.m.r,s.m.c]),n:g.sol.n};
  }
  return best;
}
// one puzzle as table data: [board lo, board hi, gem colours (a digit per gem, cell order), "shape,colour" x3, the build's solution "pRC" x3, solutions]
const l3Enc=p=>[p.lo,p.hi,p.cols.join(''),p.pieces.map(x=>x.join(',')).join(' '),p.sol.map(x=>x.join('')).join(' '),p.n];
function l3MakeAll(){
  const keys=new Set(), out=[];
  for(let k=1;k<=L3_COUNT;k++){ const p=l3Make(k,keys); keys.add(p.key); out.push(l3Enc(p)); }
  return out;
}
/* puzzle k (1-60) from the table: {k, band, grid: [8][8] gem colour or -1, pieces: [{s: shape, gi}] in tray order,
   sol: [[tray slot, row, col] x3] in the order the build plays them, n: distinct solutions} */
const l3Cache=new Map();
function l3Puzzle(k){
  if(l3Cache.has(k)) return l3Cache.get(k);
  const t=L3_TABLE[k-1]; if(!t) return null;
  const [lo,hi,cs,ps,ss,n]=t, grid=[]; let q=0;
  for(let r=0;r<N;r++){ const row=[]; for(let c=0;c<N;c++) row.push(bitAt(lo,hi,r*8+c)?+cs[q++]:-1); grid.push(row); }
  const p={k,band:L3_BANDS[Math.min(2,((k-1)/L3_BAND)|0)],lo,hi,grid,
    pieces:ps.split(' ').map(x=>{ const [si,gi]=x.split(',').map(Number); return {s:SHAPES[si],gi}; }),
    sol:ss.split(' ').map(x=>[+x[0],+x[1],+x[2]]),n};
  l3Cache.set(k,p);
  return p;
}
const L3_TABLE=[
  [0,1224736768,"333","1,2 1,1 0,3","277 174 071",1],
  [0,3407872,"222","0,5 1,4 1,3","266 160 063",1],
  [0,3584,"222","1,1 0,1 1,4","150 054 256",1],
  [57344,2048,"5555","5,4 3,5 7,0","150 210 054",1],
  [0,-2134900736,"000","9,0 5,0 7,3","060 162 272",1],
  [393216,262144,"155","36,5 13,5 9,2","201 161 031",1],
  [-1996488704,8847360,"2225555","1,5 3,5 5,5","031 134 263",1],
  [150994944,195,"110000","5,3 1,3 5,0","131 234 042",1],
  [67108864,201326592,"553","6,3 36,2 4,4","033 242 102",2],
  [193,1,"0004","3,0 7,0 5,2","045 101 241",2],
  [32960,-1073741824,"03303","6,1 1,2 8,4","027 216 166",1],
  [0,167903746,"44443","2,1 8,5 6,1","103 201 053",2],
  [64,16843008,"3111","6,3 4,1 8,4","016 156 200",2],
  [33942,0,"555533","13,0 9,2 13,0","203 000 105",1],
  [101056514,33554432,"552525","4,2 6,3 14,3","142 041 201",1],
  [147,14745600,"33330000","1,0 1,3 5,1","002 105 261",1],
  [0,45187,"333222","5,5 3,5 12,4","050 142 245",1],
  [248,768,"0000044","5,0 3,3 1,0","252 100 054",2],
  [-1608515584,0,"500","35,4 11,5 9,4","223 126 020",2],
  [0,428408832,"222444","13,0 9,2 12,1","161 066 264",1],
  [-536748031,0,"01110111","8,1 7,0 7,3","130 030 210",1],
  [1052688,268435468,"333113","3,4 6,1 1,1","045 240 134",1],
  [67898380,-1023410172,"202020225555","4,5 5,0 6,2","052 233 172",1],
  [592137,151585028,"010101200101","4,1 7,2 13,3","033 143 230",1],
  [1077952576,32832,"222224","4,1 5,4 1,0","254 150 056",2],
  [16843009,1046478848,"11112222222","6,2 14,2 7,2","260 166 040",1],
  [251691136,528482304,"330000311111","6,0 3,1 5,4","234 027 175",1],
  [33688074,167940352,"020200111002","32,3 8,3 1,2","123 255 041",1],
  [0,-486505724,"355522222","6,4 7,5 15,1","152 002 252",1],
  [8855584,538976263,"224444222222","33,3 1,5 7,2","243 123 025",1],
  [134744072,145822464,"222211111112","4,4 19,2 23,3","151 255 043",1],
  [10944519,1077952576,"555555554444","1,0 6,2 7,2","023 203 106",1],
  [0,61687,"55555552222","5,2 6,5 6,0","050 103 243",1],
  [-1061158784,-1073737792,"3434343000043","13,3 13,5 5,0","056 106 254",1],
  [-1602216160,538976416,"31111113131333","28,0 2,1 4,3","257 107 015",1],
  [134744586,-1073083894,"31311131313100","3,1 5,1 2,5","073 221 170",1],
  [268439825,286331152,"454555454545","5,0 33,2 3,2","222 024 120",1],
  [394758,63744,"353535000000","2,0 8,5 33,2","132 031 251",1],
  [33686018,-1048575486,"3333334111","7,1 23,1 5,2","071 263 160",1],
  [-2145452032,2130706432,"1111100000000","6,1 4,3 3,3","225 107 047",1],
  [-2144082176,0,"11111022220","19,4 31,3 6,2","247 012 106",1],
  [-234749434,100794370,"5055555555550","26,2 4,5 5,2","041 112 230",1],
  [33359111,117442049,"0110144444440011011","9,5 32,2 24,2","150 031 210",1],
  [201910523,3084,"333333322222121212","7,2 9,3 33,3","162 010 202",1],
  [269504592,1347458947,"121211333444441212","31,5 30,0 23,3","025 242 144",1],
  [67110912,67110135,"10111111100","26,3 31,5 33,0","202 052 122",1],
  [150438863,134744072,"555355111444444433333","20,5 23,1 4,3","004 112 203",1],
  [549441376,4194336,"553333333333353555","27,0 23,4 6,3","055 226 114",1],
  [33686018,-753336318,"1111144411111","28,3 4,1 20,2","065 261 151",1],
  [-2139062144,-943652736,"2222222255552","5,4 30,2 4,4","061 163 257",1],
  [2039840,536932807,"225555544444002002","16,2 29,2 30,5","241 144 025",1],
  [17106181,100204808,"53535351500000053","5,1 18,0 30,5","044 230 140",1],
  [84149767,117505031,"10202212102111111102","21,0 3,1 32,3","010 250 150",1],
  [33751811,-50216958,"353535555535555555","31,2 27,0 5,3","252 130 050",1],
  [807428160,930099248,"101020202020111111","6,2 7,3 33,4","026 204 173",1],
  [132383750,17041159,"555555515515515551","21,2 20,5 7,4","160 000 220",1],
  [336860180,121832468,"23232323232555111","18,3 30,2 5,5","165 262 052",1],
  [-610676976,269488144,"311111122320003003333","4,5 12,5 25,4","121 215 014",1],
  [-1056958440,404232436,"202033340444202020","33,3 23,4 19,2","230 023 133",1],
  [1111249,404232216,"222202000202020202","28,3 19,3 27,4","100 213 003",1]
];

/* ═══════ progress: crumble.lab ═══════
   {v:1, three:{done:[puzzle numbers solved], at:the puzzle last opened}}. Validated on load; iCloud (cloud.js) merges it
   by union (done) and max (at). */
const lab={three:{done:[],at:1}};
function loadLab(){
  try{
    const o=JSON.parse(localStorage.getItem(LAB_STORE)||'null'), t=o&&o.v===1&&o.three;
    if(!t||typeof t!=='object') return;
    if(Array.isArray(t.done)) lab.three.done=[...new Set(t.done.filter(k=>isInt(k,1,L3_COUNT)))].sort((a,b)=>a-b);
    if(isInt(t.at,1,L3_COUNT)) lab.three.at=t.at;
  }catch(e){}
}
function saveLab(){
  try{ localStorage.setItem(LAB_STORE,JSON.stringify({v:1,three:{done:lab.three.done,at:lab.three.at}})); }catch(e){}
  cloudDirty();
}
const l3IsDone=k=>lab.three.done.includes(k);
const l3Open=k=>isInt(k,1,L3_COUNT)&&(k===1||l3IsDone(k)||l3IsDone(k-1));   // in order, but any solved one can be replayed
function l3Next(){                                     // the puzzle the big button plays: the one she was on, else the first open unsolved one
  const at=lab.three.at;
  if(l3Open(at)&&!l3IsDone(at)) return at;
  for(let k=1;k<=L3_COUNT;k++) if(l3Open(k)&&!l3IsDone(k)) return k;
  return L3_COUNT;
}

/* ═══════ the Lab card ═══════ */
// the experiments: one line each (id, title, one-line description, progress, open)
const LAB=[
  {id:'three',title:'🧩 Clear it in three',sub:'Three pieces. Leave the board empty.',prog:()=>lab.three.done.length+' of '+L3_COUNT,open:()=>openL3()},
];
const LAB_CARDS=['labCard','l3Card','l3Done'];
function labHide(){ for(const id of LAB_CARDS) el(id).hidden=true; }   // modes.js openMenu / hideMenus
function openLab(){
  pauseForMenu(); el('menuCard').hidden=true; el('mapCard').hidden=true; el('dailyCard').hidden=true; el('winCard').hidden=true;
  el('goalsCard').hidden=true; el('chalCard').hidden=true; el('pauseCard').hidden=true; labHide();
  const list=el('labList'); list.textContent='';
  for(const x of LAB){
    const b=document.createElement('button'); b.type='button'; b.className='mode'; b.dataset.id=x.id;
    b.innerHTML='<b></b><span></span><i></i>';
    b.children[0].textContent=x.title; b.children[1].textContent=x.sub; b.children[2].textContent=x.prog();
    b.onclick=e=>{ e.stopPropagation(); x.open(); };
    list.append(b);
  }
  el('labCard').hidden=false;
}
// Clear it in three's own card: the big Play, and every puzzle as a number (solved ones ticked, the rest locked in order)
function openL3(){
  pauseForMenu(); labHide();
  const nx=l3Next(), done=lab.three.done.length;
  el('l3Play').querySelector('b').textContent='Puzzle '+nx;
  el('l3Play').querySelector('span').textContent=l3IsDone(nx)?'Play it again':L3_BANDS[Math.min(2,((nx-1)/L3_BAND)|0)].replace(/^./,c=>c.toUpperCase());
  const g=el('l3Grid'); g.textContent='';
  ['Easy','Medium','Hard'].forEach((name,bi)=>{
    const h=document.createElement('p'); h.className='setgroup'; h.textContent=name; g.append(h);
    const row=document.createElement('div'); row.className='l3nodes'; g.append(row);
    for(let k=bi*L3_BAND+1;k<=(bi+1)*L3_BAND;k++){
      const b=document.createElement('button'), open=l3Open(k), ok=l3IsDone(k);
      b.type='button'; b.dataset.k=k; b.disabled=!open; b.className='l3n'+(ok?' done':'')+(k===nx?' next':'');
      b.textContent=ok?'✓':k; b.setAttribute('aria-label','Puzzle '+k+(ok?', solved':open?'':', locked'));
      b.onclick=e=>{ e.stopPropagation(); playL3(k); };
      row.append(b);
    }
  });
  el('l3Note').textContent=done?done+' of '+L3_COUNT+' solved'+(done<L3_COUNT?' · every 5th earns Crumb\'s cookie':''):'Solve them in order. Replay any you have solved.';
  el('l3Card').hidden=false;
  const n=g.querySelector('.next'); if(n) n.scrollIntoView({block:'nearest'});
}

/* ═══════ playing a puzzle (mode 'lab') ═══════ */
let l3=null;              // the puzzle in play: {k, p, fails, undo, hint, hintOk, over, solved}
const l3Busy=()=>mode==='lab'&&!!l3&&l3.over;          // a try is being judged (Not quite, Solved): hands off the tray (game.js onDown)
const l3Pulse=()=>mode==='lab'&&!!l3&&!!l3.hint&&state==='play'&&!paused;   // draw.js fxBusy: the hint's ghost pulses
function playL3(k){
  const p=l3Puzzle(k); if(!p||!l3Open(k)) return;
  leaveMode(); hideMenus(); labHide();
  mode='lab'; lvl=null;                                 // not saved as the mode: a relaunch opens where she was before the Lab
  lab.three.at=k; saveLab();
  // a run of its own, from scratch (what start() resets, without counting a game, dealing, or the dealer's state)
  cancelDeal(); clearRunFx(); stuck=false; rndSrc=null; chal=null; chDone=false; dk='';
  score=0; shownScore=0; combo=0; comboMiss=0; rescuesUsed=0; tension=0; trayNo=1; bonusMeter=0; specialEnd=-99;
  pace={ph:'calm',n:0,hold:0,len:0}; roomNow=1; lv={lines:0,pieces:0,combo:0,swept:false};
  jJumps=0; resetWorld(); chaseBest=0; tlReset(); hesVoid(); recCur=null;
  el('scoreVal').textContent='0'; el('startCard').hidden=true; el('overCard').hidden=true;
  l3={k,p,fails:0,undo:null,hint:null,hintOk:false,over:false,solved:false};
  l3Lay(true);
  state='play'; paused=false;
  syncHud(); syncActions(); syncBonusChip();
  setTimeout(()=>{ if(l3&&l3.k===k&&mode==='lab') crumbSay(sayPick('l3Open'),0,'say dare',true); },reduce?50:450);
}
// the puzzle's start: its board (the gems grow back in) and its three pieces
function l3Lay(pop){
  const p=l3.p;
  grid=p.grid.map((row,r)=>row.map((gi,c)=>gi<0?null:{gi,t:pop&&!reduce?-0.15-(r+c)*0.03:1,f:0,l:0}));
  tray=p.pieces.map(x=>({s:x.s,gi:x.gi}));
  combo=0; comboMiss=0; stuck=false;
  l3.undo=null; l3.over=false; l3.hint=null;
  l3Sync();
}
// place() calls this first: the board as it was, for the one-step Undo; any hint is spent
function l3Before(){
  if(!l3) return;
  l3.undo={grid:grid.map(r=>r.map(g=>g?g.gi:-1)),tray:tray.slice(),combo};
  l3.hint=null;
}
// checkStuck() in this mode: after a drop, is the puzzle solved, or can it no longer be finished?
function l3After(){
  stuck=false;
  if(!l3||l3.over||mode!=='lab') return;
  const left=tray.filter(Boolean);
  if(!left.length){ if(boardEmpty()) l3Solved(); else l3Fail(); }
  else if(left.some(t=>!fitsAnywhere(t.s,grid))) l3Fail();
  l3Sync();
}
function l3Fail(){
  l3.over=true; l3.fails++; l3.undo=null;
  pushBanner('Not quite','','#FFD2B8',0.9);
  crumbSay(sayPick('l3Fail'),0,'say dare',true);
  const k=l3.k;
  setTimeout(()=>{
    if(!l3||l3.k!==k||mode!=='lab') return;
    clearRunFx(); l3Lay(true);
    if(l3.fails>=3&&!l3.hintOk){ l3.hintOk=true; crumbSay(sayPick('l3Hint'),0,'say dare',true); }
    l3Sync();
  },reduce?700:1500);
  l3Sync();
}
function l3Solved(){
  const k=l3.k, first=!l3IsDone(k);
  l3.over=true; l3.solved=true; l3.undo=null;
  if(first){ lab.three.done.push(k); lab.three.done.sort((a,b)=>a-b); }
  lab.three.at=Math.min(L3_COUNT,first?k+1:lab.three.at); saveLab();
  playedToday();                                        // she played today (the streak), nothing else is counted
  const cookie=first&&lab.three.done.length%5===0;
  crumbSay(sayPick('l3Solve'),0,'say dare',true);
  if(cookie) setTimeout(()=>{ if(l3&&l3.k===k){ dareGift(); crumbSay(sayPick('l3Cookie'),0,'say dare',true); } },reduce?300:1900);
  setTimeout(()=>{ if(l3&&l3.k===k&&mode==='lab') l3ShowDone(cookie); },reduce?700:cookie?3400:2300);
  l3Sync();
}
function l3ShowDone(cookie){
  pauseForMenu();
  const k=l3.k, last=k>=L3_COUNT, n=lab.three.done.length;
  el('l3DoneEye').textContent='Puzzle '+k+' of '+L3_COUNT;
  el('l3DoneTitle').textContent='Solved!';
  el('l3DoneMsg').textContent=(cookie?'🍪 A cookie for Crumb\'s jar. ':'')+(n>=L3_COUNT?'That is all '+L3_COUNT+'. You cleared every one!':n+' of '+L3_COUNT+' solved.');
  el('l3Next').hidden=last;
  el('l3Done').hidden=false;
}
function l3Undo(){
  if(!l3||l3.over||!l3.undo||drag||mode!=='lab') return;
  const u=l3.undo; l3.undo=null;
  clearRunFx();
  grid=u.grid.map(r=>r.map(gi=>gi<0?null:{gi,t:1,f:0,l:0})); tray=u.tray.slice(); combo=u.combo; comboMiss=0;
  Sfx.pickup(); l3Sync();
}
function l3Reset(){
  if(!l3||l3.over||drag||mode!=='lab') return;
  clearRunFx(); l3Lay(true); Sfx.pickup();
}
// the hint: one right next drop from the board as it is (from the start, if she has already gone wrong), as a ghost
function l3Hint(){
  if(!l3||l3.over||!l3.hintOk||drag||mode!=='lab') return;
  const [lo,hi]=packBits(packGrid(grid));
  let s=l3Solve(lo,hi,tray.map(t=>t?t.s:null),1);
  if(!s.n){ clearRunFx(); l3Lay(true); s=l3Solve(l3.p.lo,l3.p.hi,tray.map(t=>t.s),1); }
  const q=s.n?[...s.sets.values()][0].seq[0]:null;
  l3.hint=q?{i:q[0],r:q[1],c:q[2],t:performance.now()}:null;
  l3Sync();
}
function l3Draw(now){                                  // draw.js, over the board's gems layer: the hinted seat, pulsing, on empty cells
  if(!l3Pulse()) return;
  const h=l3.hint, t=tray[h.i]; if(!t){ l3.hint=null; return; }
  const k=reduce?0.6:0.5+0.5*Math.sin((now-h.t)*0.005-1.57);
  for(const [dr,dc] of t.s.cells){
    const r=h.r+dr, c=h.c+dc; if(grid[r][c]) continue;
    gem(t.gi,bx+c*cell,by+r*cell,cell,1,0.18+0.42*k,0);
  }
}
// the HUD, the buttons and the hint button follow the puzzle
function l3Sync(){
  const on=mode==='lab'&&!!l3;
  el('stage').classList.toggle('lab',on);
  el('labHint').hidden=!(on&&l3.hintOk&&!l3.over);
  if(!on) return;
  el('labNum').textContent=l3.k;
  el('labUndo').disabled=!l3.undo||l3.over;
  el('labReset').disabled=l3.over;
}
function labLeave(){ if(mode==='lab'){ l3=null; l3Sync(); } }   // another mode starts (modes.js leaveMode)

el('startLab').onclick=e=>{ e.stopPropagation(); ac(); openLab(); };
el('menuLab').onclick=e=>{ e.stopPropagation(); openLab(); };
el('labBack').onclick=e=>{ e.stopPropagation(); openMenu(); };
el('l3Back').onclick=e=>{ e.stopPropagation(); openLab(); };
el('l3Play').onclick=e=>{ e.stopPropagation(); playL3(l3Next()); };
el('l3Next').onclick=e=>{ e.stopPropagation(); if(l3) playL3(Math.min(L3_COUNT,l3.k+1)); };
el('l3Lab').onclick=e=>{ e.stopPropagation(); openLab(); };
el('labUndo').onclick=e=>{ e.stopPropagation(); l3Undo(); };
el('labReset').onclick=e=>{ e.stopPropagation(); l3Reset(); };
el('labHint').onclick=e=>{ e.stopPropagation(); l3Hint(); };


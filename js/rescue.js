// Crumble — the Lab's second experiment: "Rescue the Crumbs".
// Plain script, loaded in order by index.html (after lab.js); shares globals with the other js/ files.
/* ═══════ Rescue the Crumbs ═══════
   Small crumbs are stuck on top of gems. Clear the lines under them and they fall to the exit at the bottom of the
   board. Three hand-made boards, fewer pieces earns more stars.

   The rules:
     - A baby crumb fills one cell: nothing can be placed on it, and it counts as filled for a line. A line with a crumb
       in it clears its gems; the crumb stays (game.js place() leaves a cell with `cr` alone).
     - After every drop and its clears, each crumb falls straight down through empty cells until it sits on a gem or
       another crumb, or reaches the bottom row. Gems never fall. Falls go bottom-up and repeat until nothing moves.
     - A crumb in the bottom row is rescued: it hops out through the exit and its cell is empty again.
     - Pieces: each board has its own fixed queue, dealt three at a time in order (it repeats when it runs out).
     - Won: every crumb out. Stars by pieces used: 3 at or under par, 2 within par+2, else 1.
     - Stuck (no piece in the tray fits): "Not quite" and the board resets after a beat. No other way to lose, no timer.
     - Undo takes back one drop; Reset starts the board again. After the third failed or reset try a Hint button
       ghosts the next drop of the stored solution (from the start again if the player is off its path).
   Mode `lab` as Clear it in three (lab.js): no dealer, specials, bonus meter, Avalanche, cannonball charge, dares,
   journey sky, best, stats, Game Center or saved run. Progress: `crumble.lab` .rescue = {stars:[x3], best:[x3]}.
   The boards are checked by rsSolve (every order, every seat, clears and falls applied between drops) for the fewest
   pieces that win: tools/rescue-check.mjs prints it and a test holds each par to it. */
const RS_COUNT=3;
/* The boards: rows top to bottom ('.' empty, a digit a gem colour, a/b/c a crumb), the piece queue ([shape, colour] in
   RAW order, shapes.js), par (the fewest pieces that win, proved by rsSolve) and a winning line of play at par
   ([tray slot, row, col] per drop, tray slots as dealt). */
const RS_BOARDS=[
  // 1: one crumb on a row with a gap; fill the gap (two pieces), the row clears, it drops out
  {rows:['........','........','........','........','........','...a....','1111....','33.....3'],
   q:[[1,2],[1,4],[9,0]], par:2, sol:[[0,6,4],[1,6,6]]},
  // 2: one crumb low, one high on a tower. The bottom row first (as on board 1) and the tower keeps its foot: 4 pieces at
  //    best. The tall bar on the tower first clears its column, then the bottom row takes the other two: 3
  {rows:['........','........','........','......b.','......4.','......4.','..a...4.','1111..41'],
   q:[[4,3],[1,2],[2,5]], par:3, sol:[[0,0,6],[1,7,4],[2,6,6]]},
  // 3: c in a row on a shelf, a with b on top of it on a tower. Clear c's row (it stays), then the L fills the shelf and
  //    the tower's column at once: a and b drop out, c drops onto the ledge; then the ledge's row (three gaps, each one
  //    a tall piece) lets c out. The second tray's flat bar has nowhere useful to go
  {rows:['........','........','2c22.222','1111...1','......b.','......a.','33.3.333','4.4...4.'],
   q:[[2,0],[1,2],[18,1]], par:7, sol:[[0,1,4],[1,0,5],[2,1,4],[0,5,2],[1,0,0],[2,5,4],[0,5,4]]},
];
const RS_FALL_WAIT=170, RS_FALL_MS=150, RS_LAND_MS=170, RS_HOP_MS=560, RS_STAGGER=70;   // ms: a clear's break before the fall; per √row of fall; the squash; the hop out
const rsStarsFor=(k,n)=>n<=RS_BOARDS[k].par?3:n<=RS_BOARDS[k].par+2?2:1;

/* ── the rules on bitboards (the solver and the tests; the game plays them on `grid`, the same way) ── */
function rsCells(k){                                  // board k as {lo, hi: gems, cr: crumb cells (r*8+c), gi: colours by cell, v: crumb variants by cell}
  const b=RS_BOARDS[k]; let lo=0,hi=0; const cr=[], gi={}, v={};
  b.rows.forEach((row,r)=>[...row].forEach((ch,c)=>{
    const i=r*8+c;
    if(/[0-9]/.test(ch)){ if(i<32) lo|=1<<i; else hi|=1<<(i-32); gi[i]=+ch; }
    else if(/[a-c]/.test(ch)){ cr.push(i); v[i]='abc'.indexOf(ch); }
  }));
  return {lo,hi,cr,gi,v};
}
const rsBit=(lo,hi,i)=>i<32?(lo>>>i)&1:(hi>>>(i-32))&1;
// crumbs fall: returns the cells they rest on (the rescued ones gone), bottom-up and again until nothing moves
function rsFallBits(lo,hi,cr){
  const occ=new Uint8Array(64); for(let i=0;i<64;i++) occ[i]=rsBit(lo,hi,i); for(const p of cr) occ[p]=1;
  let a=cr.slice().sort((x,y)=>y-x), moved=true;
  while(moved){
    moved=false; const out=[];
    for(let p of a){
      while(p<56&&!occ[p+8]){ occ[p]=0; p+=8; occ[p]=1; moved=true; }
      if(p>=56){ occ[p]=0; moved=true; continue; }   // the bottom row: out through the exit
      out.push(p);
    }
    a=out.sort((x,y)=>y-x);
    if(!moved) break;
  }
  return a.sort((x,y)=>x-y);
}
// one drop: the piece, its clears (a crumb's cell counts as filled, the crumb stays), then the falls
function rsDropBits(lo,hi,cr,s,m){
  let clo=0,chi=0; for(const p of cr){ if(p<32) clo|=1<<p; else chi|=1<<(p-32); }
  applyBits(lo|clo,hi|chi,s,m);
  const nlo=_lo&~clo, nhi=_hi&~chi;
  return {lo:nlo,hi:nhi,cr:rsFallBits(nlo,nhi,cr)};
}
const rsFits=(lo,hi,cr,m)=>{ let clo=0,chi=0; for(const p of cr){ if(p<32) clo|=1<<p; else chi|=1<<(p-32); } return !((lo|clo)&m.lo)&&!((hi|chi)&m.hi); };
/* A floor on the pieces still needed. A crumb gets out only once every gem under it is gone: either its column fills
   up (at most colMax cells of it per piece) or every row holding one of those gems does (at most rowMax cells of a row,
   and nMax cells in all, per piece). A falling crumb can fill a gap too, so a gap with a crumb above it is not counted.
   The largest such floor over the crumbs (a crumb on top of another needs at least one more piece). Bitboards: gems
   lo/hi, crumbs cl/ch. */
function rsFloor(lo,hi,cl,ch,cr,rowMax,colMax,nMax){
  if(!cr.length) return 0;
  let vlo=lo|cl, vhi=hi|ch;                            // filled, or under a crumb (a crumb may fall there)
  for(const p of cr) for(let j=p+8;j<64;j+=8){ if(j<32) vlo|=1<<j; else vhi|=1<<(j-32); }
  const rowGap=r=>8-pop32((r<4?vlo>>>(r*8):vhi>>>((r-4)*8))&0xFF);
  let need=1;
  for(const p of cr){
    const r=p>>3, c=p&7;
    const ec=8-pop32(vlo&(COL<<c))-pop32(vhi&(COL<<c));
    let sum=0, most=0, below=false;
    for(let rr=r+1;rr<8;rr++){
      const i=rr*8+c;
      if(rsBit(cl,ch,i)){ below=true; continue; }
      if(!rsBit(lo,hi,i)) continue;
      const e=rowGap(rr); sum+=e; const k=Math.ceil(e/rowMax); if(k>most) most=k;
    }
    const n=Math.max(below?1:0,Math.min(Math.ceil(ec/colMax),Math.max(most,Math.ceil(sum/nMax))));
    if(n>need) need=n;
  }
  return need;
}
/* The fewest pieces that rescue everyone on board k: iterative deepening over every order and seat, the queue dealt as
   the game deals it, a stuck tray (nothing fits) a dead end, a line of play that cannot finish within its pieces
   (rsFloor) cut. A state that failed with n pieces left is not searched again with n or fewer. `pre`: start after these
   drops (counted in min). Returns {min, seq: [[slot,r,c]...] after pre, nodes, over (ran out of time: then min is only
   how far it proved there is no shorter win)}. */
function rsSolve(k,maxD=9,ms=20000,pre=[]){
  const b=RS_BOARDS[k], q=b.q.map(([si])=>SHAPES[si]), L=q.length, s0=rsReplay(k,pre), t0=performance.now();
  if(!s0) return {min:0,seq:null,nodes:0,over:false};
  if(s0.won) return {min:pre.length,seq:[],nodes:0,over:false};
  const seen=new Map(), seq=[]; let nodes=0, over=false;
  const per=f=>Math.max(...q.map(s=>Math.max(...[0,1,2,3,4].map(i=>s.cells.filter(x=>x[f]===i).length))));
  const rowMax=per(0), colMax=per(1), nMax=Math.max(...q.map(s=>s.n));
  const id=s=>s?SHAPES.indexOf(s):63;
  function dfs(lo,hi,cr,tray,qi,left){
    if(!cr.length) return true;
    if(left<=0) return false;
    if(++nodes%4096===0&&performance.now()-t0>ms) over=true;
    if(over) return false;
    let cl=0,ch=0; for(const p of cr){ if(p<32) cl|=1<<p; else ch|=1<<(p-32); }
    const t3=[id(tray[0]),id(tray[1]),id(tray[2])].sort((x,y)=>x-y);
    const key=lo+','+hi+','+cl+','+ch+','+(qi%L)+','+(t3[0]*4096+t3[1]*64+t3[2]);
    if((seen.get(key)||0)>=left) return false;
    seen.set(key,left);
    for(let i=0;i<3;i++){
      const s=tray[i]; if(!s) continue;
      let twin=false; for(let j=0;j<i;j++) if(tray[j]===s) twin=true;
      if(twin) continue;                                // two of one shape are one choice
      let nt=tray.slice(), nqi=qi; nt[i]=null;
      const deal=nt.every(x=>!x);
      for(const m of placeMasks(s)){
        if(((lo|cl)&m.lo)||((hi|ch)&m.hi)) continue;
        let nlo,nhi,ncr,ncl=cl,nch=ch;
        if(!applyBits(lo|cl,hi|ch,s,m)){ nlo=lo|m.lo; nhi=hi|m.hi; ncr=cr; }   // nothing cleared: nothing falls
        else{
          nlo=_lo&~cl; nhi=_hi&~ch; ncr=rsFallBits(nlo,nhi,cr);
          if(!ncr.length){ seq.push([i,m.r,m.c]); return true; }
          ncl=0; nch=0; for(const p of ncr){ if(p<32) ncl|=1<<p; else nch|=1<<(p-32); }
        }
        if(rsFloor(nlo,nhi,ncl,nch,ncr,rowMax,colMax,nMax)>left-1) continue;   // cannot finish in time
        const t2=deal?[q[qi%L],q[(qi+1)%L],q[(qi+2)%L]]:nt;
        if(!t2.some(x=>x&&placeMasks(x).some(mm=>!(((nlo|ncl)&mm.lo)||((nhi|nch)&mm.hi))))) continue;   // stuck: the board resets
        seq.push([i,m.r,m.c]);
        if(dfs(nlo,nhi,ncr,t2,deal?qi+3:qi,left-1)) return true;
        seq.pop();
        if(over) return false;
      }
    }
    return false;
  }
  for(let d=1;d<=maxD;d++){                            // (a state that failed with n pieces left fails again: the memo carries over)
    if(dfs(s0.lo,s0.hi,s0.cr,s0.tray,s0.qi,d)) return {min:pre.length+d,seq:seq.slice(),nodes,over:false};
    if(over) return {min:pre.length+d,seq:null,nodes,over:true};
  }
  return {min:0,seq:null,nodes,over};
}
// a line of play from the start, as the game deals it: {won, n pieces, the board, tray and queue after}; false if a drop does not fit
function rsReplay(k,moves){
  const b=RS_BOARDS[k], q=b.q.map(([si])=>SHAPES[si]), L=q.length;
  let {lo,hi,cr}=rsCells(k), tray=[q[0],q[1%L],q[2%L]], qi=3, n=0;
  for(const [i,r,c] of moves){
    const s=tray[i]; if(!s||!cr.length) return false;
    const m=placeMasks(s).find(x=>x.r===r&&x.c===c); if(!m||!rsFits(lo,hi,cr,m)) return false;
    ({lo,hi,cr}=rsDropBits(lo,hi,cr,s,m)); tray[i]=null; n++;
    if(cr.length&&tray.every(x=>!x)){ tray=[q[qi%L],q[(qi+1)%L],q[(qi+2)%L]]; qi+=3; }
  }
  return {won:!cr.length,n,lo,hi,cr,tray,qi};
}

/* ═══════ progress: crumble.lab .rescue = {stars:[0-3 x3], best:[pieces x3, 0 = not yet]} (lab.js loads and saves it) ═══════ */
const rsOpen=k=>isInt(k,0,RS_COUNT-1)&&(k===0||lab.rescue.stars[k-1]>0);   // in order; any rescued board can be played again
function rsNext(){ for(let k=0;k<RS_COUNT;k++) if(rsOpen(k)&&!lab.rescue.stars[k]) return k; return 0; }
const rsStarTxt=(n,of=3)=>'★'.repeat(n)+'☆'.repeat(of-n);
function rsProg(){ const s=lab.rescue.stars, n=s.reduce((a,b)=>a+b,0); return s.filter(Boolean).length+' of '+RS_COUNT+' · '+rsStarTxt(n,RS_COUNT*3); }

/* ═══════ its card: the three boards as big tiles, stars earned, unlocked in order ═══════ */
function openRS(){
  pauseForMenu(); labHide();
  const g=el('rsGrid'), nx=rsNext(); g.textContent='';
  for(let k=0;k<RS_COUNT;k++){
    const b=document.createElement('button'), open=rsOpen(k), st=lab.rescue.stars[k], best=lab.rescue.best[k];
    b.type='button'; b.dataset.k=k; b.disabled=!open; b.className='rsTile'+(st?' done':'')+(open&&!st&&k===nx?' next':'');
    b.innerHTML='<b></b><i></i><span></span>';
    b.children[0].textContent=open?k+1:'🔒';
    b.children[1].textContent=rsStarTxt(st);
    b.children[2].textContent=!open?'Locked':best?'Best '+best:'★★★ in '+RS_BOARDS[k].par;
    b.setAttribute('aria-label','Board '+(k+1)+(open?', '+st+' stars':', locked'));
    b.onclick=e=>{ e.stopPropagation(); playRS(k); };
    g.append(b);
  }
  const n=lab.rescue.stars.filter(Boolean).length;
  el('rsNote').textContent=n?n+' of '+RS_COUNT+' rescued'+(n<RS_COUNT?' · each new one earns Crumb\'s cookie':''):'Each board you rescue opens the next.';
  el('rsCard').hidden=false;
}

/* ═══════ playing a board (mode 'lab') ═══════ */
let rs=null;   // the board in play: {k, b, fails, undo, hint, hintOk, over, won, used, qi, hist, cr: the crumbs, until}
// a crumb: {id (its look), r, c (its cell now), out (rescued), fall: {y0, to, t0, dur, boing}, hop: {t0, cheer}, born, done}
const rsBusy=()=>mode==='lab'&&!!rs&&rs.over;                      // won or stuck: hands off the tray (game.js onDown)
const rsFx=()=>mode==='lab'&&!!rs&&state==='play'&&!paused&&(!!rs.hint||performance.now()<rs.until);   // draw.js fxBusy: something moves
function playRS(k){
  if(!rsOpen(k)) return;
  leaveMode(); hideMenus(); labHide();
  mode='lab'; lvl=null;                                // not saved as the mode, as Clear it in three
  labFresh();
  rs={k,b:RS_BOARDS[k],fails:0,undo:null,hint:null,hintOk:false,over:false,won:false,used:0,qi:3,hist:[],cr:[],until:0,gems:0,stars:0};
  rsLay(true);
  state='play'; paused=false;
  syncHud(); syncActions(); syncBonusChip();
  setTimeout(()=>{ if(rs&&rs.k===k&&mode==='lab') crumbSay(sayPick('rsOpen'),0,'say dare',true); },reduce?50:450);
}
const rsCell=()=>({gi:-1,cr:1,t:1,f:0,l:0});           // a crumb's cell: filled for placing and for lines, never cleared (game.js)
function rsLay(pop){
  const b=rs.b, now=performance.now(), q=b.q;
  rs.cr=[];
  grid=b.rows.map((row,r)=>[...row].map((ch,c)=>{
    if(/[0-9]/.test(ch)) return {gi:+ch,t:pop&&!reduce?-0.15-(r+c)*0.03:1,f:0,l:0};
    if(/[a-c]/.test(ch)){ rs.cr.push({id:'abc'.indexOf(ch),r,c,out:false,fall:null,hop:null,born:pop&&!reduce?now+260+rs.cr.length*90:0,done:false}); return rsCell(); }
    return null;
  }));
  tray=[0,1,2].map(j=>{ const [si,gi]=q[j%q.length]; return {s:SHAPES[si],gi}; });
  rs.qi=3; rs.used=0; rs.hist=[]; rs.undo=null; rs.over=false; rs.hint=null;
  rs.until=pop&&!reduce?now+260+rs.cr.length*90+420:0;
  combo=0; comboMiss=0; stuck=false;
  labSync();
}
const rsGems=()=>{ let n=0; for(const row of grid) for(const g of row) if(g&&!g.cr) n++; return n; };
// place() calls this first: the board as it was (for Undo), and the drop itself (for the count and the hint's path)
function rsBefore(i,r,c){
  if(!rs) return;
  rs.undo={grid:grid.map(row=>row.map(g=>g?(g.cr?-2:g.gi):-1)),cr:rs.cr.map(x=>({id:x.id,r:x.r,c:x.c,out:x.out})),
    tray:tray.slice(),qi:rs.qi,used:rs.used,hist:rs.hist.length};
  rs.gems=rsGems()+(tray[i]?tray[i].s.n:0);            // a clear leaves fewer than this
  rs.used++; rs.hist.push([i,r,c]); rs.hint=null;
}
// checkStuck() in this mode: the drop's clears are done; the crumbs fall, then is it won, or stuck?
function rsAfter(){
  stuck=false;
  if(!rs||rs.over||mode!=='lab') return;
  const now=performance.now(), cleared=rsGems()<rs.gems;
  const end=rsGravity(now+(cleared&&!reduce?RS_FALL_WAIT:0));
  if(rs.cr.every(x=>x.out)) rsWin(end);
  else{
    if(tray.every(v=>!v)){ const q=rs.b.q; tray=[0,1,2].map(j=>{ const [si,gi]=q[(rs.qi+j)%q.length]; return {s:SHAPES[si],gi}; }); rs.qi+=3; }
    if(!anyFits()) rsFail();
  }
  labSync();
}
// the rule: each crumb falls through empty cells, bottom-up, again until nothing moves; the bottom row is the exit.
// The grid changes at once; each crumb that moved gets its fall (and hop) to show from t0. Returns when it is all over.
function rsGravity(t0){
  const live=rs.cr.filter(x=>!x.out).sort((a,b)=>b.r-a.r||a.c-b.c), from=new Map(), now=performance.now();
  for(const x of live) from.set(x,rsY(x,now));
  let moved=true;
  while(moved){
    moved=false;
    for(const x of live){
      if(x.out) continue;
      while(x.r<N-1&&!grid[x.r+1][x.c]){ grid[x.r+1][x.c]=grid[x.r][x.c]; grid[x.r][x.c]=null; x.r++; moved=true; }
      if(x.r===N-1){ grid[x.r][x.c]=null; x.out=true; moved=true; }
    }
  }
  let end=t0; const col={};
  for(const x of live){                                // bottom-up, so in one column the lower one goes first
    const y0=from.get(x); if(x.r===y0&&!x.out) continue;
    const j=col[x.c]||0; col[x.c]=j+1;
    const st=t0+j*RS_STAGGER, dur=reduce?0:RS_FALL_MS*Math.sqrt(Math.max(0,x.r-y0));
    x.fall={y0,to:x.r,t0:st,dur,boing:false};
    x.hop=x.out?{t0:st+dur+(reduce?0:RS_LAND_MS*0.5),cheer:false}:null;
    end=Math.max(end,x.hop?x.hop.t0+RS_HOP_MS:st+dur+RS_LAND_MS);
  }
  rs.until=Math.max(rs.until,end+60);
  return end;
}
function rsWin(end){
  const k=rs.k, n=rs.used, st=rsStarsFor(k,n), R=lab.rescue, first=!R.stars[k];
  rs.over=true; rs.won=true; rs.undo=null; rs.hint=null; rs.stars=st;
  R.stars[k]=Math.max(R.stars[k],st); R.best[k]=R.best[k]?Math.min(R.best[k],n):n; saveLab();
  playedToday();                                       // the player played today (the streak); nothing else is counted
  const wait=Math.max(0,end-performance.now())+(reduce?100:250), mine=rs;
  setTimeout(()=>{
    if(rs!==mine||mode!=='lab') return;
    pushBanner('ALL OUT!','','#9CF0B5',1);
    if(!reduce) for(let j=0;j<3;j++) waves.push({x:W/2,y:by+B/2,t:-j*0.16});
    glowT=Math.max(glowT,1.2); glowH=140; toyFanfare();
    if(st===3) crumbSay(sayPick('rsStar3'),0,'say dare',true);
    if(first) setTimeout(()=>{ if(rs===mine){ dareGift(); crumbSay(sayPick('rsCookie'),0,'say dare',true); } },reduce?200:1100);
    setTimeout(()=>{ if(rs===mine&&mode==='lab'&&!overlayOpen()) rsShowDone(first); },reduce?600:first?2600:1700);   // (not over a card the player opened meanwhile)
  },wait);
  labSync();
}
function rsShowDone(cookie){
  pauseForMenu();
  const k=rs.k, n=rs.used, st=rs.stars;
  el('rsDoneEye').textContent='Board '+(k+1)+' of '+RS_COUNT;
  const s=el('rsDoneStars'); s.textContent='';
  for(let j=0;j<3;j++){ const i=document.createElement('span'); i.textContent=j<st?'★':'☆'; if(j<st) i.className='on'; i.style.animationDelay=(0.2+j*0.3)+'s'; s.append(i); }
  s.setAttribute('aria-label',st+' of 3 stars');
  el('rsDoneMsg').textContent=n+(n===1?' piece':' pieces')+' · best '+lab.rescue.best[k]+(st<3?' · ★★★ in '+rs.b.par:'');
  el('rsDoneCookie').hidden=!cookie;
  el('rsNext').hidden=k>=RS_COUNT-1;
  el('rsDone').hidden=false;
}
function rsFail(){
  rs.over=true; rs.fails++; rs.undo=null; rs.hint=null;
  pushBanner('Not quite','','#FFD2B8',0.9);
  crumbSay(sayPick('rsStuck'),0,'say dare',true);
  const mine=rs;
  setTimeout(()=>{ if(rs!==mine||mode!=='lab') return; clearRunFx(); rsLay(true); rsHintOk(); labSync(); },reduce?700:1500);
}
function rsHintOk(){ if(rs.fails>=3&&!rs.hintOk){ rs.hintOk=true; crumbSay(sayPick('l3Hint'),0,'say dare',true); } }   // the third try that went nowhere
function rsUndo(){
  if(!rs||rs.over||!rs.undo||drag||mode!=='lab') return;
  const u=rs.undo; rs.undo=null;
  clearRunFx();
  grid=u.grid.map(row=>row.map(v=>v===-1?null:v===-2?rsCell():{gi:v,t:1,f:0,l:0}));
  rs.cr=u.cr.map(x=>({...x,fall:null,hop:null,born:0,done:x.out}));
  tray=u.tray.slice(); rs.qi=u.qi; rs.used=u.used; rs.hist.length=u.hist; rs.hint=null; combo=0; comboMiss=0; rs.until=0;
  Sfx.pickup(); labSync();
}
function rsReset(){
  if(!rs||rs.over||drag||mode!=='lab') return;
  if(rs.used) rs.fails++;                               // a try the player gave up on counts toward the hint
  clearRunFx(); rsLay(true); Sfx.pickup(); rsHintOk(); labSync();
}
// the hint: the next drop of the stored solution while the player is still on its path, else the board from the top and its first drop
function rsHint(){
  if(!rs||rs.over||!rs.hintOk||drag||mode!=='lab') return;
  const sol=rs.b.sol, h=rs.hist;
  if(!(h.length<sol.length&&h.every((m,j)=>m.join()===sol[j].join()))){
    clearRunFx(); rsLay(true); crumbSay(sayPick('rsTop'),0,'say dare',true);
  }
  const m=sol[rs.hist.length];
  rs.hint={i:m[0],r:m[1],c:m[2],t:performance.now()};
  labSync();
}
// the HUD: "Pieces n" with Undo and Reset where the score was, and the three-star target under it (lab.js labSync)
function rsSyncHud(){
  el('labLbl').textContent='Pieces'; el('labNum').textContent=rs.used;
  el('labPar').textContent='★★★ in '+rs.b.par;
  el('labUndo').disabled=!rs.undo||rs.over;
  el('labReset').disabled=rs.over;
}

/* ═══════ drawing (draw.js, over the gems): the exit, the hint, the crumbs ═══════
   Each crumb is a sprite drawn once per cell size, look and face (worried, falling, happy, blinking), sitting in its own
   cell on the gem below. Per frame it is one blit; the slow bob and the blink ride on whatever frame rate the game is
   drawing at, and only a fall, a hop or the hint ask for full speed (rsFx). Reduce Motion: no bob, a fall is a step,
   the hop is a fade where it stands. */
const RS_LOOK=[                                         // three crumbs, three looks: tint and chips
  {b:'#D9A05B',e:'#6E4220',ch:'#5B3417',chips:[[-.64,.28,.11],[.62,.36,.09],[.24,-.66,.08],[-.36,.68,.07]]},
  {b:'#EEC27A',e:'#7A4A1E',ch:'#9A5A22',chips:[[-.1,-.7,.09],[.66,.12,.1],[-.66,.4,.08],[.4,.68,.08],[.56,-.5,.06]]},
  {b:'#C27F45',e:'#55300F',ch:'#3A200C',chips:[[.5,-.58,.11],[-.66,.18,.11],[.46,.62,.08]]}];
function rsSprite(sz,mood,v){
  return sprite('rsc|'+sz+'|'+mood+'|'+v,sz*1.3,sz*1.3,x=>{
    const L=RS_LOOK[v%3], r=sz*0.4, cy=-sz*0.05, lw=Math.max(1,sz*0.055);
    x.lineCap='round';
    const foot=dx=>{ x.beginPath(); x.ellipse(dx,sz*0.43,r*0.24,r*0.15,0,0,6.283); };
    x.fillStyle=L.e; foot(-r*0.42); x.fill(); foot(r*0.42); x.fill();     // tiny feet
    x.beginPath();                                      // a lumpy crumb of a body, a little wider than tall
    for(let k=0;k<=16;k++){ const a=k/16*6.283, rr=r*(k%2?0.95:1.03)*(k%5===2?0.94:1); x.lineTo(Math.cos(a)*rr*1.06,cy+Math.sin(a)*rr); }
    x.closePath();
    x.lineWidth=lw*2.6; x.strokeStyle='rgba(255,248,232,.92)'; x.stroke();   // a light rim, so it reads on any gem and any sky
    x.fillStyle=L.b; x.fill(); x.lineWidth=lw; x.strokeStyle=L.e; x.stroke();
    x.fillStyle='rgba(255,240,205,.55)'; x.beginPath(); x.ellipse(-r*0.42,cy-r*0.5,r*0.22,r*0.12,-0.5,0,6.283); x.fill();   // highlight
    x.fillStyle=L.ch;
    for(const [u,w,s] of L.chips){ x.beginPath(); x.ellipse(u*r,cy+w*r,s*r*1.1,s*r*0.85,u,0,6.283); x.fill(); }
    const ex=r*0.36, ey=cy-r*0.1, ink='#24150B';
    const white=(rx,ry)=>{ for(const s of [-1,1]){ x.beginPath(); x.ellipse(s*ex,ey,rx,ry,0,0,6.283); x.fillStyle='#FFF9EE'; x.fill(); x.lineWidth=lw*0.8; x.strokeStyle=L.e; x.stroke(); } };
    const dots=(rr,dy)=>{ x.fillStyle=ink; for(const s of [-1,1]){ x.beginPath(); x.arc(s*ex,ey+dy,rr,0,6.283); x.fill(); } };
    const brow=(inner,outer)=>{ x.lineWidth=lw*1.1; x.strokeStyle=L.e; for(const s of [-1,1]){ x.beginPath(); x.moveTo(s*ex*0.45,ey-r*inner); x.lineTo(s*ex*1.45,ey-r*outer); x.stroke(); } };
    x.lineWidth=lw*1.1; x.strokeStyle=ink;
    if(mood==='happy'){                                 // out! eyes squeezed shut in a grin
      for(const s of [-1,1]){ x.beginPath(); x.arc(s*ex,ey+r*0.06,r*0.17,3.5,5.93); x.stroke(); }
      x.fillStyle='rgba(255,130,130,.55)'; for(const s of [-1,1]){ x.beginPath(); x.ellipse(s*r*0.62,cy+r*0.2,r*0.13,r*0.08,0,0,6.283); x.fill(); }
      x.fillStyle=ink; x.beginPath(); x.moveTo(-r*0.26,cy+r*0.22); x.quadraticCurveTo(0,cy+r*0.7,r*0.26,cy+r*0.22); x.closePath(); x.fill();
    } else if(mood==='fall'){                           // wide eyes, an O
      white(r*0.25,r*0.3); dots(r*0.09,0); brow(0.56,0.48);
      x.fillStyle=ink; x.beginPath(); x.ellipse(0,cy+r*0.38,r*0.1,r*0.13,0,0,6.283); x.fill();
    } else {                                            // waiting: worried brows, a wobbly little mouth; 'blink' shuts the eyes
      if(mood==='blink') for(const s of [-1,1]){ x.beginPath(); x.moveTo(s*ex-r*0.15,ey+r*0.04); x.lineTo(s*ex+r*0.15,ey+r*0.04); x.stroke(); }
      else { white(r*0.21,r*0.26); dots(r*0.11,r*0.07); }
      brow(0.46,0.3);
      x.lineWidth=lw; x.strokeStyle=ink; x.beginPath(); x.moveTo(-r*0.2,cy+r*0.42); x.quadraticCurveTo(-r*0.1,cy+r*0.32,0,cy+r*0.4); x.quadraticCurveTo(r*0.1,cy+r*0.48,r*0.2,cy+r*0.38); x.stroke();
    }
  });
}
function rsExitSprite(){                                // the exit along the board's bottom edge: a soft green strip and little arrows
  const w=B, h=cell*0.62, key='rsexit|'+Math.round(w)+'|'+Math.round(cell);
  return sprite(key,w,h,x=>{
    const g=x.createLinearGradient(0,-h/2,0,h/2);
    g.addColorStop(0,'rgba(124,255,178,0)'); g.addColorStop(0.42,'rgba(124,255,178,.42)'); g.addColorStop(0.55,'rgba(124,255,178,.28)'); g.addColorStop(1,'rgba(124,255,178,0)');
    x.fillStyle=g; x.fillRect(-w/2+cell*0.1,-h/2,w-cell*0.2,h);
    x.fillStyle='rgba(205,255,222,.95)'; roundPath(x,-w/2+cell*0.25,-h*0.02,w-cell*0.5,Math.max(2,cell*0.06),cell*0.03); x.fill();
    x.lineWidth=Math.max(1.5,cell*0.06); x.lineCap='round'; x.lineJoin='round'; x.strokeStyle='rgba(205,255,222,.95)';
    for(let c=0;c<N;c++){ const cx=-w/2+(c+0.5)*cell, s=cell*0.11, y=h*0.22; x.beginPath(); x.moveTo(cx-s*1.3,y-s*0.6); x.lineTo(cx,y+s*0.6); x.lineTo(cx+s*1.3,y-s*0.6); x.stroke(); }
  });
}
const rsEase=t=>t*t;                                    // a fall speeds up
function rsY(x,now){                                    // a crumb's row on screen (fractional while it falls; past N-1 while it hops out)
  const f=x.fall;
  if(f&&f.dur>0&&now<f.t0+f.dur) return now<f.t0?f.y0:f.y0+(f.to-f.y0)*rsEase((now-f.t0)/f.dur);
  if(x.hop&&now>=x.hop.t0&&!reduce){ const u=Math.min(1,(now-x.hop.t0)/RS_HOP_MS); return N-1-2*u+3.6*u*u; }
  return f?f.to:x.r;
}
function rsDraw(now){
  if(mode!=='lab'||!rs) return;
  blit(rsExitSprite(),bx+B/2,by+B,1,rs.cr.every(x=>x.done)?0.5:1);
  if(rs.hint&&state==='play'&&!paused){                 // the hinted seat, pulsing, on empty cells only
    const h=rs.hint, t=tray[h.i];
    if(t){ const k=reduce?0.6:0.5+0.5*Math.sin((now-h.t)*0.005-1.57);
      for(const [dr,dc] of t.s.cells){ const r=h.r+dr, c=h.c+dc; if(!grid[r][c]) gem(t.gi,bx+c*cell,by+r*cell,cell,1,0.18+0.42*k,0); } }
  }
  const sz=Math.round(cell*0.8);
  for(const x of rs.cr){
    if(x.done) continue;
    const f=x.fall, y=rsY(x,now);
    let mood='worry', sx=1, sy=1, a=1, rot=0, lift=0;
    if(f&&now>=f.t0+f.dur&&!f.boing){                   // landed: a squash and a soft boing (in the bottom row it goes straight into the hop)
      f.boing=true;
      if(f.to!==f.y0) toyPlay(0,t=>tone(t,{f0:x.out?560:420,f1:x.out?300:180,pdur:.1,dur:.14,vol:.05,type:'sine'}));
    }
    if(x.hop&&now>=x.hop.t0){
      const u=Math.min(1,(now-x.hop.t0)/RS_HOP_MS);
      if(!x.hop.cheer){ x.hop.cheer=true; rsCheer(x); }
      if(u>=1){ x.done=true; continue; }
      mood='happy'; a=reduce?1-u:u<0.5?1:1-(u-0.5)/0.5; rot=reduce?0:Math.sin(u*Math.PI)*0.3*(x.id%2?1:-1);
    } else if(f&&now<f.t0+f.dur) mood='fall';
    else if(f&&now<f.t0+f.dur+RS_LAND_MS){ const q=Math.sin((now-f.t0-f.dur)/RS_LAND_MS*Math.PI)*(reduce||!f.dur?0:0.2); sx=1+q; sy=1-q; mood='fall'; }
    else if(!(rs.over&&!rs.won)&&(now+x.id*977)%3900<130) mood='blink';
    if(x.born&&now<x.born+300){ if(now<x.born) continue; const k=easeOutBack((now-x.born)/300); sx*=k; sy*=k; }
    if(mood==='worry'&&!reduce) lift=(0.5+0.5*Math.sin(now*0.0024+x.id*2.1))*cell*0.035;   // the slow bob
    const sp=rsSprite(sz,mood,x.id), cx=bx+(x.c+0.5)*cell, foot=by+(y+1)*cell-cell*0.06-lift;
    ctx.save(); ctx.translate(cx,foot); if(rot) ctx.rotate(rot); ctx.scale(sx,sy); ctx.globalAlpha=Math.max(0,a);
    ctx.drawImage(sp.cv,-sp.w/2,-sp.h/2-sz*0.5,sp.w,sp.h); ctx.restore(); ctx.globalAlpha=1;
  }
}
// a crumb goes out through the exit: a sparkle, a ring, a rising chirp, a buzz, and Crumb says something
function rsCheer(x){
  const cx=bx+(x.c+0.5)*cell, y=by+B;
  for(let j=0;j<4;j++) sparkles.push({x:cx+(j-1.5)*cell*0.32,y:y-cell*(0.15+0.25*(j%2)),t:-j*0.08});
  rings.push({x:bx+x.c*cell,y:by+(N-1)*cell,w:cell,h:cell,t:0});
  toyPlay(0,t=>{ tone(t,{f0:880,f1:1100,pdur:.07,dur:.1,vol:.05,type:'triangle'}); tone(t+.1,{f0:1320,f1:1760,pdur:.08,dur:.18,vol:.05,type:'triangle'}); });
  haptic('rescue');
  if(rs.over&&!rs.won) return;                          // stuck by the same drop: his "you trapped them." stays
  const left=rs.cr.some(o=>!o.out||(o.hop&&!o.hop.cheer));
  crumbSay(sayPick(left?'rsOut':'rsLast'),0,'say dare',true);
}

el('rsBack').onclick=e=>{ e.stopPropagation(); openLab(); };
el('rsNext').onclick=e=>{ e.stopPropagation(); if(rs) playRS(Math.min(RS_COUNT-1,rs.k+1)); };
el('rsAgain').onclick=e=>{ e.stopPropagation(); if(rs) playRS(rs.k); };
el('rsLab').onclick=e=>{ e.stopPropagation(); openLab(); };

// Crumble — Guided first game (1.1, task D).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ the guide ═══════
   A brand-new player (Endless, no best, no game played, never guided) opens on three hand-built boards instead of the
   seeded opening, one short line each in the banner style, then "You've got it!" and an ordinary light opening (her
   score stays). No arrows, no forced moves: any legal move is allowed. The only help is a ghost pulse on the target
   cells after CFG.GUIDE_HINT_MS with no piece picked up. If a lesson's tray ends without its lesson (no row filled, no
   two lines, no sweep) the guide ends quietly and the ordinary dealer takes over from the board as it stands.
   One board all the way through: a lesson's tray holds only the pieces the lesson needs, so nothing of hers is left
   lying about, and the next lesson only adds gems (popping in) around the loose ones already there. The loose gems of
   lessons 1 and 2 sit in the rows lesson 3 completes, so the sweep takes them too.
     1  "Fill a row"      one row with a 3-wide gap; the tray holds only the 1x3 that fills it
     2  "Plan two moves"  two columns with a 2-wide double gap: the first square sets up the second, which clears both
     3  "Empty the board!" three rows, each with a gap for one piece; every drop clears something and the last one sweeps
   Specials stay off while it runs (trays 1-3 carry none anyway; transformations are held, and a golden hand, star or
   bonus it queued is dropped when it ends). The live lesson is saved with the run (`gd` in the snapshot), so a
   force-quit resumes mid-guide. `crumble.guide` = '1' once it has ended, completed or not, or once any game has ended:
   it is never shown again. Daily and Adventure never show it. */
const GUIDE_STORE='crumble.guide';
// boards: X = a gem (lessons 1 and 2 add a few loose ones, so their clears are not sweeps; each lies in a row lesson 3 completes);
// a, b, c = the target gaps (the hint pulses them, in that order); dir = whether the gaps complete rows or columns. tray: null = an empty slot
const GUIDE_LESSONS=[
  {line:'Fill a row', tray:[null,3,null], dir:'r', won:g=>g.ln>=1, board:[
    '........',
    '.X......',
    '........',
    '......X.',
    '........',
    'XXaaaXXX',
    '........',
    '...X....']},
  {line:'Plan two moves', tray:[9,null,9], dir:'c', won:g=>g.ln>=2, board:[
    '...XX...',
    'X..XX...',
    '...aa...',
    '...aa...',
    '...aa...',
    '...aa...',
    '...XX..X',
    '...XX...']},
  {line:'Empty the board!', tray:[5,9,3], dir:'r', won:g=>!!g.sw, board:[
    '........',
    'XXXXXaaa',
    '........',
    'bbbbXXXX',
    '........',
    '........',
    'ccXXXXXX',
    'ccXXXXXX']}
];
// each lesson's gaps as {cells, lines}: the cells to fill and the rows (or columns) they complete
for(const L of GUIDE_LESSONS){
  L.groups=['a','b','c'].map(ch=>{
    const cells=[]; L.board.forEach((row,r)=>[...row].forEach((v,c)=>{ if(v===ch) cells.push([r,c]); }));
    return {cells,lines:[...new Set(cells.map(([r,c])=>L.dir==='r'?r:c))]};
  }).filter(g=>g.cells.length);
}
let guide=null;          // the live lesson: {n: 1-3, ln: lines cleared by this tray, sw: it swept, dn: bitmask of gaps already cleared}
let guideIdleT=0;        // when she last did something (the tray arrived, a pickup, a drop): the hint waits CFG.GUIDE_HINT_MS from here
function guideSeen(){ try{ return localStorage.getItem(GUIDE_STORE)==='1'; }catch(e){ return true; } }   // no storage: never (it would show every launch)
function guideMark(){ try{ localStorage.setItem(GUIDE_STORE,'1'); }catch(e){} }
const guideFresh=()=>CFG.GUIDE&&mode==='endless'&&stats.games===0&&!best&&!guideSeen();   // start() asks before it counts the game
// can lesson n be laid on this board? no gem already there may sit in one of its gaps
const guideFits=n=>GUIDE_LESSONS[n-1].board.every((row,r)=>[...row].every((v,c)=>v==='X'||v==='.'||!grid[r][c]));
// lay lesson n: the gems it needs pop in around what is already on the board, then its tray and its line
function guideLay(n){
  const L=GUIDE_LESSONS[n-1], first=n===1;
  if(first) grid=empty();
  L.board.forEach((row,r)=>[...row].forEach((v,c)=>{
    if(v==='X'&&!grid[r][c]) grid[r][c]={gi:(rnd()*NCOLOR)|0,t:first||reduce?1:-0.2-(r+c)*0.04,f:0,l:0};   // t<0: the gem waits, then grows in
  }));
  trayNo=n; guide={n,ln:0,sw:false,dn:0}; guideIdleT=performance.now();
  commitTray(L.tray.filter(i=>i!=null).map(i=>SHAPES[i]),'GUIDE');
  let k=0; tray=L.tray.map(i=>i==null?null:tray[k++]);   // the lesson's pieces in their own slots, the others empty
  hesVoid();                                         // a lesson is no hesitation sample
  closerTray=n===GUIDE_LESSONS.length;               // the sweep lesson's tray shimmers like a closer
  pushBanner(L.line,'',undefined,0.85);
}
// place() after every drop
function guideDrop(total,swept){
  if(!guide) return;
  guide.ln+=total; if(swept) guide.sw=true; guideIdleT=performance.now();
  GUIDE_LESSONS[guide.n-1].groups.forEach((g,i)=>{ if(guideLineEmpty(g)) guide.dn|=1<<i; });   // a cleared gap is never hinted again
}
function guideLineEmpty(g){
  const dir=GUIDE_LESSONS[guide.n-1].dir;
  return g.lines.every(k=>{ for(let j=0;j<N;j++) if(dir==='r'?grid[k][j]:grid[j][k]) return false; return true; });
}
const guideTouch=()=>{ guideIdleT=performance.now(); };   // a pickup
// dealSteps() asks first while a guide runs: true = it dealt the tray (the next lesson, or the light opening after the last)
function guideDeal(){
  const n=guide.n;
  if(!GUIDE_LESSONS[n-1].won(guide)){ guideEnd(); return false; }   // off-script: quietly, the ordinary dealer deals from this board
  if(n<GUIDE_LESSONS.length){ if(!guideFits(n+1)){ guideEnd(); return false; } guideLay(n+1); return true; }
  guideEnd();
  pushBanner("You've got it!",'','#8FF7FF',1);
  seedOpening('light');                              // an ordinary light opening, tray 1 (her score stays)
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]&&!reduce) grid[r][c].t=-0.2-(r+c)*0.04;
  return true;
}
// the guide is over (done, off-script): never again, and nothing it queued leaks into ordinary dealing
function guideEnd(){
  guide=null; guideMark();
  goldenNext=false; starForced=false; trayHadSweep=false; trayCombo=0; bonusMeter=0; syncBonusChip();
  pace={ph:'calm',n:0,hold:0,len:0}; resetWave(); sweepCool=0; specialEnd=-99; trayNo=0; carry=[];
}
/* the hint: after CFG.GUIDE_HINT_MS with nothing picked up, the first open gap a tray piece fits pulses as a ghost of
   that piece's colour. Never over a gem (only empty cells), never an arrow, and nothing once the lesson is off track. */
const guideHintOn=()=>!!guide&&state==='play'&&!paused&&!drag&&!ret&&!dealing&&performance.now()-guideIdleT>CFG.GUIDE_HINT_MS;
function guideTarget(){
  const L=GUIDE_LESSONS[guide.n-1];
  for(let i=0;i<L.groups.length;i++){
    if(guide.dn&(1<<i)) continue;
    const open=L.groups[i].cells.filter(([r,c])=>!grid[r][c]); if(!open.length) continue;
    const set=new Set(open.map(([r,c])=>r*N+c));
    for(const t of tray) if(t&&!t.s.star) for(let r=0;r+t.s.rows<=N;r++) for(let c=0;c+t.s.cols<=N;c++)
      if(t.s.cells.every(([dr,dc])=>set.has((r+dr)*N+c+dc))) return {cells:open,gi:t.gi};
  }
  return null;
}
function guideDraw(now){
  if(!guideHintOn()) return;
  const tg=guideTarget(); if(!tg) return;
  const k=reduce?0.5:0.5+0.5*Math.sin((now-guideIdleT-CFG.GUIDE_HINT_MS)*0.005-1.57);   // fades in from nothing
  for(const [r,c] of tg.cells) gem(tg.gi,bx+c*cell,by+r*cell,cell,1,0.12+0.38*k,0);
}

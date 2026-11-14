// Crumble — Avalanche: at the peak of a streak the whole board falls.
// Plain script, loaded in order by index.html (after game.js); shares globals with the other js/ files.
/* A clear at combo AVA_COMBO or more may set off an avalanche (a roll, likelier the longer the streak): every gem drops
   straight down as far as it can, rows that fill on landing clear, and what was above falls again, until nothing moves.
   Each chain step is one more combo step and pays like a clear of that many lines.
   (lean) With tilt live and the phone leaned past AVA_LEAN_MIN, it falls toward the low side instead: every gem slides
   along its row to that wall, columns that fill clear, and again. One rule over a view of the grid (avaView), three ways.
   The rules run at once inside place() (the grid and the score are final when place() returns, so saving, undo, the
   dealer and the stuck check see a settled board); only the picture plays out over the next second or two:
   every gem that moved carries `av`, a list of [start frame, cells] falls on the avalanche clock (ava.t), and a gem that
   fell into a clearing line is a shatter that falls first and breaks on landing. Touches wait until it has landed.
   Endless only. Switch: CFG.AVALANCHE (Settings > Look > Advanced "Avalanche", saved `av2`; on by default);
   the lean: CFG.AVA_LEAN (Admin). */
const ava={t:0,end:0,live:false,dir:'down',hint:false};
const avaBusy=()=>ava.live;
let avaSeed=20261114;                                    // its own dice: the dealer's (rnd) must deal the same trays with or without it
const avaRnd=()=>(avaSeed=(avaSeed*16807)%2147483647)/2147483647;
const avaOff=(av,t)=>{                                   // cells short of its resting cell, back along the fall, at clock t (<= 0)
  let o=0;
  for(const [t0,d] of av){ const k=t-t0; o-=k<=0?d:Math.max(0,d-.5*CFG.AVA_G*k*k); }
  return o;
};
let avaDX=0, avaDY=0;                                    // set by avaAt() without allocating (draw.js asks for every falling gem, every frame)
function avaAt(o){                                       // avaOff's distance as an x / y offset in cells, for the way this avalanche falls
  if(ava.dir==='left'){ avaDX=-o; avaDY=0; } else if(ava.dir==='right'){ avaDX=o; avaDY=0; } else { avaDX=0; avaDY=o; }
}
/* (lean) Which way the board falls: 'down', or 'left' / 'right' when the phone is leaned far enough. Resolved in ONE place,
   once, the moment place() rolls for an avalanche; the fall keeps it (ava.dir) to the last landing whatever the phone does.
   Reads the toy's smoothed sideways gravity (toy.gx, + = the right edge is low, TILT_FLIP already applied in toyMotion) and
   only while motion is live (CFG.TILT on and permission given: toy.tiltOn). With the mascot hidden the toy is not stepped,
   so the raw reading (toy.gRaw) stands in. Inside the dead zone or below AVA_LEAN_MIN, tilt off, motion never granted,
   a desktop: 'down', exactly as before. Reduce Motion keeps the rule (only the crumb's own roll is off there). */
const avaTiltLive=()=>!!(CFG.AVA_LEAN&&CFG.TILT&&toy.tiltOn);
function avaDir(){
  if(!avaTiltLive()) return 'down';
  const g=CFG.FX_MASCOT?toy.gx:toy.gRaw;
  if(!(Math.abs(g)>Math.max(CFG.TILT_DEAD,CFG.AVA_LEAN_MIN))) return 'down';
  return g>0?'right':'left';
}
/* The grid seen from the fall: lane k (a column when it falls down, a row when it falls sideways) and position p along it,
   p = N-1 being the floor (the bottom row, or the wall it falls toward). The rule below is written once against this view. */
const avaView=dir=>dir==='left'?{get:(k,p)=>grid[k][N-1-p],set:(k,p,v)=>{grid[k][N-1-p]=v;}}
  :dir==='right'?{get:(k,p)=>grid[k][p],set:(k,p,v)=>{grid[k][p]=v;}}
  :{get:(k,p)=>grid[p][k],set:(k,p,v)=>{grid[p][k]=v;}};
function avaWould(dir){                                  // gems that would move if the board fell now (that way)
  const v=avaView(dir); let n=0;
  for(let k=0;k<N;k++){ let hole=false; for(let p=N-1;p>=0;p--){ if(!v.get(k,p)) hole=true; else if(hole) n++; } }
  return n;
}
function avaDue(comboNow,dir){
  if(!CFG.AVALANCHE||mode!=='endless'||guide||comboNow<CFG.AVA_COMBO) return false;
  if(avaWould(dir)<CFG.AVA_MIN_MOVE) return false;
  return avaRnd()<Math.min(CFG.AVA_MAX,CFG.AVA_CHANCE+CFG.AVA_STEP*(comboNow-CFG.AVA_COMBO));
}
// (lean) the one-time hint: the first avalanche that falls down while tilt is live gets "next time, lean the phone." (crumbsay.js
// says it and calls avaHintDone; a line that never showed, say under a CLEAN SWEEP line or with the talk off, is not spent)
const AVA_HINT_KEY='crumble.leanHint';
function avaHintSeen(){ try{ return localStorage.getItem(AVA_HINT_KEY)==='1'; }catch(e){ return true; } }
function avaHintDone(){ ava.hint=false; try{ localStorage.setItem(AVA_HINT_KEY,'1'); }catch(e){} }
/* place() calls this after its own lines are gone. `lead` = frames until that clear has popped; `dir` from avaDir()
   ('down' when left out). Returns {gained, cleared, lines, end, steps, banner, dir}: points and gems the chain took, lines
   it cleared (rows when it falls down, columns sideways), frames until the last landing, [lines, combo] for each chain clear
   (place() gives each the rewards of an ordinary clear: the bonus meter, Volcano, the star), and the AVALANCHE! banner
   (a COLOR GONE from the fall queues right behind it). */
function avalanche(lead,gi0,dir){
  dir=dir==='left'||dir==='right'?dir:'down';
  const side=dir!=='down', sgn=dir==='right'?1:-1, v=avaView(dir);
  const out={gained:0,cleared:0,lines:0,end:0,steps:[],banner:null,dir};
  let T=lead+CFG.AVA_RUMBLE;                             // the board shakes for a beat, then lets go
  ava.t=0; ava.live=true; ava.dir=dir;
  ava.hint=!side&&avaTiltLive()&&!avaHintSeen();         // tilt is live but the phone was flat: the crumb may say so, once
  const full=i=>{ for(let k=0;k<N;k++) if(!(side?grid[k][i]:grid[i][k])) return false; return true; };   // row i (down) / column i (sideways)
  for(let step=0;step<N;step++){
    let far=0, moved=0;
    for(let k=0;k<N;k++){
      let w=N-1;
      for(let p=N-1;p>=0;p--){
        const g=v.get(k,p); if(!g) continue;
        if(w!==p){ v.set(k,w,g); v.set(k,p,null); (g.av||(g.av=[])).push([T,w-p]); far=Math.max(far,w-p); moved++; }
        w--;
      }
    }
    if(!moved) break;
    const land=T+Math.sqrt(2*far/CFG.AVA_G);
    out.end=land;
    const lines=[]; for(let i=0;i<N;i++) if(full(i)) lines.push(i);
    if(!lines.length) break;
    combo++; trayCombo=Math.max(trayCombo,combo); fireCombo();
    out.lines+=lines.length; out.steps.push([lines.length,combo]);
    out.gained+=Math.round(CFG.LINE_POINTS*lines.length*lines.length*(1+(combo-1)*CFG.COMBO_STEP));
    const pop=land+CFG.AVA_BEAT;
    for(const i of lines){
      for(let k=0;k<N;k++){
        const r=side?k:i, c=side?i:k, g=grid[r][c];
        // the pieces fly out along the row from its middle (down), or bounce back off the wall the column hit (sideways), then fall
        shatters.push({r,c,gi:g.gi,horiz:!side,star:false,big:true,tier:3,t:-pop,t0:-pop,
          ox:side?bx+(c+.5)*cell+sgn*B*.5:bx+B/2,oy:side?by+B/2:by+(r+.5)*cell,av:g.av||[]});
        grid[r][c]=null; out.cleared++;
      }
      sweeps.push({horiz:!side,idx:i,t:-pop*0.16});
      lineFlashes.push({horiz:!side,idx:i,t:-pop*0.075,hue:GEMS[gi0].h,k:1.4});
    }
    const beat=pop/60, n=lines.length, cmb=combo;
    Sfx.combo(cmb,n,beat);
    pops.push({x:dir==='right'?bx+cell*1.6:bx+B-cell*1.6,y:by+cell*(1.2+step*.9),t:-pop*0.026,   // on the side the gems left
      txt:'+'+Math.round(CFG.LINE_POINTS*n*n*(1+(cmb-1)*CFG.COMBO_STEP)),sub:'CHAIN ×'+(step+1),combo:cmb,lines:n});
    T=pop+CFG.AVA_GAP; out.end=T;
  }
  ava.end=out.end+6;
  // the show: a word, a shake that lasts through the rumble, a low boom, the crumb is thrown off its perch
  const more=out.lines?out.lines+(out.lines===1?' more line':' more lines'):'';
  out.banner={t:0,txt:'AVALANCHE!',sub:side?'to the '+dir+'!'+(more?' '+more:''):more,col:'#FFB36B',k:1.2};
  banners.splice(banners.length&&banners[0].t>0?1:0,0,out.banner);   // next in the queue (behind one already showing): the word belongs to the fall, not after it
  shake=Math.max(shake,13*CFG.SHAKE); hitWait=0;
  if(!reduce) borderFlash={t:-lead,col:'255,179,107'};
  toyPlay(lead/60,t=>{ boom(t,.2); tone(t+.05,{f0:90,f1:48,pdur:.4,dur:.5,vol:.12}); });
  haptic('sweep');
  if(typeof toyOn==='function'&&toyOn()&&!reduce&&toy.mode==='rim'&&!masc.fainted){   // a sideways one throws him the way it falls
    toy.mode='air'; toy.vy=-900; toy.vx=(side?sgn:(toy.x<toyXMax()/2?1:-1))*160; toy.va=420; toy.speed=0; toy.bounces=0;
  }
  return out;
}
function avaStep(dt){                                    // draw.js frame(): the avalanche clock
  if(!ava.live) return;
  ava.t+=dt;
  if(ava.t<ava.end) { if(ava.t<CFG.AVA_RUMBLE+8) shake=Math.max(shake,5*CFG.SHAKE); return; }
  ava.live=false;
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){ const g=grid[r][c]; if(g&&g.av) g.av=null; }
}
function avaReset(){ ava.live=false; ava.t=0; ava.dir='down'; ava.hint=false; for(let r=0;r<N;r++) for(let c=0;c<N;c++){ const g=grid[r]&&grid[r][c]; if(g&&g.av) g.av=null; } }

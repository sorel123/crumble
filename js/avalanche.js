// Crumble — Avalanche: at the peak of a streak the whole board falls.
// Plain script, loaded in order by index.html (after game.js); shares globals with the other js/ files.
/* A clear at combo AVA_COMBO or more may set off an avalanche (a roll, likelier the longer the streak): every gem drops
   straight down as far as it can, rows that fill on landing clear, and what was above falls again, until nothing moves.
   Each chain step is one more combo step and pays like a clear of that many lines.
   The rules run at once inside place() (the grid and the score are final when place() returns, so saving, undo, the
   dealer and the stuck check see a settled board); only the picture plays out over the next second or two:
   every gem that moved carries `av`, a list of [start frame, cells] falls on the avalanche clock (ava.t), and a gem that
   fell into a clearing row is a shatter that falls first and breaks on landing. Touches wait until it has landed.
   Endless only. Switch: CFG.AVALANCHE (Settings > Look > Advanced "Avalanche", saved `ava`; default off while it is tried). */
const ava={t:0,end:0,live:false};
const avaBusy=()=>ava.live;
const avaOff=(av,t)=>{                                   // rows above its resting cell at clock t (<= 0)
  let o=0;
  for(const [t0,d] of av){ const k=t-t0; o-=k<=0?d:Math.max(0,d-.5*CFG.AVA_G*k*k); }
  return o;
};
function avaWould(){                                     // gems that would move if the board fell now
  let n=0;
  for(let c=0;c<N;c++){ let hole=false; for(let r=N-1;r>=0;r--){ if(!grid[r][c]) hole=true; else if(hole) n++; } }
  return n;
}
function avaDue(comboNow){
  if(!CFG.AVALANCHE||mode!=='endless'||guide||comboNow<CFG.AVA_COMBO) return false;
  if(avaWould()<CFG.AVA_MIN_MOVE) return false;
  return rnd()<Math.min(CFG.AVA_MAX,CFG.AVA_CHANCE+CFG.AVA_STEP*(comboNow-CFG.AVA_COMBO));
}
/* place() calls this after its own lines are gone. `lead` = frames until that clear has popped.
   Returns {gained, cleared, lines, end}: points and gems the chain took, lines it cleared, frames until the last landing. */
function avalanche(lead,gi0){
  const out={gained:0,cleared:0,lines:0,end:0};
  let T=lead+CFG.AVA_RUMBLE;                             // the board shakes for a beat, then lets go
  ava.t=0; ava.live=true;
  for(let step=0;step<N;step++){
    let far=0, moved=0;
    for(let c=0;c<N;c++){
      let w=N-1;
      for(let r=N-1;r>=0;r--){
        const g=grid[r][c]; if(!g) continue;
        if(w!==r){ grid[w][c]=g; grid[r][c]=null; (g.av||(g.av=[])).push([T,w-r]); far=Math.max(far,w-r); moved++; }
        w--;
      }
    }
    if(!moved) break;
    const land=T+Math.sqrt(2*far/CFG.AVA_G);
    out.end=land;
    const rows=[]; for(let r=0;r<N;r++) if(grid[r].every(v=>v)) rows.push(r);
    if(!rows.length) break;
    combo++; trayCombo=Math.max(trayCombo,combo); fireCombo();
    out.lines+=rows.length;
    out.gained+=Math.round(CFG.LINE_POINTS*rows.length*rows.length*(1+(combo-1)*CFG.COMBO_STEP));
    const pop=land+CFG.AVA_BEAT;
    for(const r of rows){
      for(let c=0;c<N;c++){
        const g=grid[r][c];
        shatters.push({r,c,gi:g.gi,horiz:true,star:false,big:true,tier:3,t:-pop,t0:-pop,ox:bx+B/2,oy:by+(r+.5)*cell,av:g.av||[]});
        grid[r][c]=null; out.cleared++;
      }
      sweeps.push({horiz:true,idx:r,t:-pop*0.16});
      lineFlashes.push({horiz:true,idx:r,t:-pop*0.075,hue:GEMS[gi0].h,k:1.4});
    }
    const beat=pop/60, n=rows.length, cmb=combo;
    Sfx.combo(cmb,n,beat);
    pops.push({x:bx+B-cell*1.6,y:by+cell*(1.2+step*.9),t:-pop*0.026,txt:'+'+Math.round(CFG.LINE_POINTS*n*n*(1+(cmb-1)*CFG.COMBO_STEP)),sub:'CHAIN ×'+(step+1),combo:cmb,lines:n});
    T=pop+CFG.AVA_GAP; out.end=T;
  }
  ava.end=out.end+6;
  // the show: a word, a shake that lasts through the rumble, a low boom, the crumb is thrown off its perch
  pushBanner('AVALANCHE!',out.lines?out.lines+(out.lines===1?' more line':' more lines'):'','#FFB36B',1.2);
  shake=Math.max(shake,13*CFG.SHAKE); hitWait=0;
  if(!reduce) borderFlash={t:-lead,col:'255,179,107'};
  play(lead/60,t=>{ boom(t,.2); noiseHit(t,{dur:.5,f0:220,f1:90,q:.6,vol:.07,type:'lowpass'}); });
  haptic('sweep');
  if(typeof toyOn==='function'&&toyOn()&&toy.mode==='rim'&&!masc.fainted){ toy.mode='air'; toy.vy=-900; toy.vx=(toy.x<toyXMax()/2?1:-1)*160; toy.va=420; toy.speed=0; toy.bounces=0; }
  return out;
}
function avaStep(dt){                                    // draw.js frame(): the avalanche clock
  if(!ava.live) return;
  ava.t+=dt;
  if(ava.t<ava.end) { if(ava.t<CFG.AVA_RUMBLE+8) shake=Math.max(shake,5*CFG.SHAKE); return; }
  ava.live=false;
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){ const g=grid[r][c]; if(g&&g.av) g.av=null; }
}
function avaReset(){ ava.live=false; ava.t=0; for(let r=0;r<N;r++) for(let c=0;c<N;c++){ const g=grid[r]&&grid[r][c]; if(g&&g.av) g.av=null; } }

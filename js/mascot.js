// Crumble — the mascot crumb (plan 7.5f).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* A crumb of cookie perched on the top-left corner of the board frame, feet on the rim. It is the player's
   wry sidekick (she is a tween, so it acts with its eyes and brows rather than being toddler-cute):
     idle   breathes, blinks now and then, and watches the piece she is dragging
     nod    a single clear: a small nod and a smile                         (6.3: the everyday clear stays quiet)
     hop    2+ lines: a hop with its arms up
     smug   a clear at combo BIG_COMBO+: lidded eyes, one brow up, a smirk
     flat   a streak of BIG_COMBO+ ends with a drop that clears nothing: a flat stare and an eye-roll
     phew   the narrow escape: wipes its brow
     sweep  a clean sweep or a won level: star eyes and a flip (the biggest, as the sweep is)
     tight  the board is cramped (Endless/Daily: the pace is edge or recovery; Adventure: room below ROOM_EDGE): worried brows, a sweat drop
     faint  no moves / game over: X eyes, it tips over on the rim; a rescue or a new run stands it back up
   Plain DOM (an inline SVG) over the canvas: no canvas drawing. Faces are class swaps written only when the mood changes;
   motion is CSS / Web Animations on transform and opacity only. The pupils follow the drag in quantised steps (an attribute
   write only when the step changes). Reduced motion: the faces change, nothing moves. It dims when the held piece comes near
   it, so it never hides the piece. Switch: Settings > Look > Advanced "Mascot" (CFG.FX_MASCOT, saved as `mascot`). */
const MASCOT_SVG=`<svg viewBox="0 0 48 48" aria-hidden="true">
<g class="fe"><rect x="16" y="38.5" width="5.5" height="5" rx="2.4"/><rect x="26.5" y="38.5" width="5.5" height="5" rx="2.4"/></g>
<g class="ad"><path d="M10.5 26 L6.5 31.5"/><path d="M37.5 26 L41.5 31.5"/></g>
<g class="au"><path d="M10.5 23 L5 15.5"/><path d="M37.5 23 L43 15.5"/></g>
<path class="bd" d="M10 20.5C9.5 13 15.5 6.5 23.5 6.5c3 0 4.5 1.4 6.5.6 4.6-.8 8.6 4 9 9.4.3 2.3-1.2 3.6.4 6.1 1.4 3.4.4 9.3-4 12.6-4.4 3.6-13.4 4.3-19.4 1.3C10.3 34 8.4 30 9.3 26.7c.6-2.2 1.1-3.5.7-6.2z"/>
<path class="hl" d="M14 15.5c1.5-4.6 5.6-6.8 9.4-6.6"/>
<g class="ch"><ellipse cx="14.6" cy="31.6" rx="2" ry="1.6"/><ellipse cx="33.4" cy="32.4" rx="1.7" ry="1.5"/><ellipse cx="35.2" cy="12.6" rx="1.5" ry="1.3"/><circle cx="24" cy="36" r=".9"/><circle cx="12.4" cy="25" r=".7"/></g>
<g class="ey"><ellipse cx="18.6" cy="21.4" rx="3.6" ry="4.2"/><ellipse cx="29.4" cy="21.4" rx="3.6" ry="4.2"/>
<g class="pp"><circle cx="18.9" cy="22" r="1.9"/><circle cx="29.7" cy="22" r="1.9"/></g></g>
<g class="ld"><path d="M14.6 21.4a4 4.4 0 0 1 8 0z"/><path d="M25.4 21.4a4 4.4 0 0 1 8 0z"/><path class="ln" d="M14.8 21.4h7.6M25.6 21.4h7.6"/></g>
<g class="xe"><path d="M16.4 19.2l4.4 4.4M20.8 19.2l-4.4 4.4M27.2 19.2l4.4 4.4M31.6 19.2l-4.4 4.4"/></g>
<g class="se"><path d="M18.6 17.2l1.2 2.9 3 .2-2.3 1.9.8 3-2.7-1.7-2.7 1.7.8-3-2.3-1.9 3-.2z"/><path d="M29.4 17.2l1.2 2.9 3 .2-2.3 1.9.8 3-2.7-1.7-2.7 1.7.8-3-2.3-1.9 3-.2z"/></g>
<path class="bl bL" d="M15 15.6 21.8 15.2"/><path class="bl bR" d="M26.2 15.2 33 15.6"/>
<path class="mo m0" d="M21 29.3q3 2.2 6 0"/>
<path class="mo m1" d="M19.6 28.2q4.4 0 8.8 0q-.4 5.4-4.4 5.4t-4.4-5.4z"/>
<path class="mo m2" d="M20.8 30.4q4 .6 7-1.8"/>
<path class="mo m3" d="M21 30.2h6"/>
<path class="mo m4" d="M20 31.2q2-2 4 0t4 0"/>
<ellipse class="mo m5" cx="24" cy="30.4" rx="1.7" ry="2"/>
<g class="ab"><path d="M10.5 26 L6.5 31.5"/><path d="M38.6 25 Q40.5 17 36.5 14 L26.5 13"/></g>
<path class="sw" d="M38.6 11.5q2.2 3.3 0 4.6q-2.2-1.3 0-4.6z"/>
</svg>`;

// a mood is a face (classes on the root) and, for the events, one movement (Web Animations; none with reduced motion)
const MASCOT_ACT={                                   // ms the face holds, and the movement
  nod:  {ms:700,  move:[{transform:'none'},{transform:'translateY(1.5px) rotate(-4deg) scaleY(.94)'},{transform:'none'}], dur:420},
  hop:  {ms:950,  move:[{transform:'none'},{transform:'translateY(1px) scale(1.06,.9)',offset:.15},{transform:'translateY(-30%) scale(.95,1.06)',offset:.45},{transform:'translateY(1px) scale(1.05,.92)',offset:.8},{transform:'none'}], dur:620},
  smug: {ms:1300, move:[{transform:'none'},{transform:'translateY(-12%) rotate(-7deg)',offset:.35},{transform:'rotate(-5deg)',offset:.7},{transform:'none'}], dur:900},
  flat: {ms:1500, move:null},
  phew: {ms:1300, move:[{transform:'none'},{transform:'scale(1.04,.95)',offset:.3},{transform:'translateY(1px) scale(.98,1.02)',offset:.6},{transform:'none'}], dur:900},
  sweep:{ms:1700, move:[{transform:'none'},{transform:'translateY(2px) scale(1.08,.86)',offset:.12},{transform:'translateY(-55%) rotate(-180deg)',offset:.45},{transform:'translateY(-30%) rotate(-360deg)',offset:.7},{transform:'translateY(1px) scale(1.06,.92) rotate(-360deg)',offset:.88},{transform:'rotate(-360deg)'}], dur:1100},
};
const masc={el:null,body:null,pp:null,x:0,y:0,s:0,act:'',until:0,start:0,key:'',look:'',blinkAt:0,blinkTo:0,lastState:'',fainted:false};
let mascotSeed=7;                                   // its own little generator: the game's Math.random (seeded in tests) stays untouched
const mascotRnd=()=>(mascotSeed=(mascotSeed*16807)%2147483647)/2147483647;
function mascotInit(){
  const d=document.createElement('div'); d.id='mascot'; d.hidden=true; d.setAttribute('aria-hidden','true');
  d.innerHTML='<div class="mb">'+MASCOT_SVG+'</div>';
  el('stage').appendChild(d);
  masc.el=d; masc.body=d.firstChild; masc.pp=d.querySelector('.pp');
  mascotPlace();
}
function mascotPlace(){                               // layout() calls this: feet on the board frame's top edge, left corner
  if(!masc.el) return;
  const top=by-9, room=top-hudH;                    // the frame is drawn 9 px outside the cells (buildBoardBg)
  const s=Math.round(Math.max(28,Math.min(46,room+8)));
  masc.s=s; masc.x=bx+6; masc.y=top-s*44/48+1.5;
  const st=masc.el.style; st.width=st.height=s+'px'; st.left=masc.x+'px'; st.top=masc.y+'px';
}
function mascotReset(){ masc.act=''; masc.until=0; masc.fainted=false; masc.key=''; if(masc.el){ masc.el.getAnimations({subtree:true}).forEach(a=>a.cancel()); } }
// game.js calls this: an event mood ('nod','hop','smug','flat','phew','sweep'), shown just after the drop lands
function mascotAct(name){
  const a=MASCOT_ACT[name]; if(!a||!masc.el||!CFG.FX_MASCOT) return;
  const now=performance.now(), delay=110;
  masc.act=name; masc.start=now+delay; masc.until=now+delay+a.ms;
  if(a.move&&!reduce&&!masc.fainted) masc.body.animate(a.move,{duration:a.dur,delay,easing:'ease-out'});
}
function mascotClear(total,combo,swept,escaped){       // which mood a clear gets, by the 6.3 hierarchy
  mascotAct(swept?'sweep':escaped?'phew':combo>=CFG.BIG_COMBO?'smug':total>=2?'hop':'nod');
}
function mascotTight(){
  if(state!=='play'||stuck) return false;
  return paced()?(pace.ph==='edge'||pace.ph==='recovery'):roomNow<CFG.ROOM_EDGE;
}
function mascotStep(now){                             // draw.js frame(): writes only when something it shows changes
  const m=masc; if(!m.el) return;
  const on=CFG.FX_MASCOT&&state!=='idle'&&!hero.card;   // (8.3) the menu has its own crumb
  if(!on){ if(m.key!=='off'){ m.key='off'; m.el.hidden=true; mascotReset(); m.key='off'; } m.lastState=state; return; }
  if(state==='won'&&m.lastState!=='won') mascotAct('sweep');   // a level won: the big one
  m.lastState=state;
  const faint=stuck||state==='over';
  if(faint!==m.fainted){                            // tips over on the rim, or stands back up (rescue)
    m.fainted=faint; m.act=''; m.el.getAnimations({subtree:true}).forEach(a=>a.cancel());
    if(faint&&!reduce) m.el.animate([{transform:'none'},{transform:'rotate(-14deg)',offset:.25},{transform:'translate(4%,-38%) rotate(80deg)'}],{duration:650,easing:'cubic-bezier(.5,0,.7,1.4)',fill:'forwards'});
    if(!faint&&!reduce) m.body.animate([{transform:'translateY(-25%) scale(.9,1.1)'},{transform:'none'}],{duration:380,easing:'ease-out'});
  }
  let mood=faint?'faint':(m.act&&now>=m.start&&now<m.until)?m.act:mascotTight()?'tight':state==='won'?'hop':'idle';
  if(m.act&&now>=m.until) m.act='';
  if(now>=m.blinkTo&&now>m.blinkAt+150) m.blinkAt=now+2400+mascotRnd()*3200, m.blinkTo=m.blinkAt+130;
  const blink=now>=m.blinkAt&&now<m.blinkTo&&(mood==='idle'||mood==='tight'||mood==='nod');
  // the held piece: the pupils follow it, and the crumb dims if the piece comes near (it is DOM over the canvas)
  const held=drag&&tray[drag.i]&&drag.cx!=null;
  let dim=false, lx=.3, ly=.5;
  if(held){
    const cx=m.x+m.s/2, cy=m.y+m.s*.45, dx=drag.cx-cx, dy=drag.cy-cy, d=Math.hypot(dx,dy)||1;
    lx=dx/d; ly=dy/d; dim=d<m.s*1.6+cell*1.2;
  }
  const key=mood+(blink?' blink':'')+(dim?' dim':'')+(reduce?' rm':'');
  if(key!==m.key){ m.el.hidden=false; m.el.className=key; m.key=key; }
  const look=mood==='faint'||mood==='sweep'||mood==='flat'?'0,0':(Math.round(lx*1.3*4)/4)+','+(Math.round(ly*1.1*4)/4);
  if(look!==m.look){ m.look=look; m.pp.setAttribute('transform','translate('+look+')'); }
}

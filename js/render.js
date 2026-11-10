// Crumble — Layout and tile renderers.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ layout + tiles ═══════ */
function roundPath(x,px,py,w,h,r){
  const k=Math.min(r,w/2,h/2);
  x.beginPath(); x.moveTo(px+k,py);
  x.arcTo(px+w,py,px+w,py+h,k); x.arcTo(px+w,py+h,px,py+h,k);
  x.arcTo(px,py+h,px,py,k); x.arcTo(px,py,px+w,py,k); x.closePath();
}
function newTile(size){
  const cv=document.createElement('canvas');
  const px=Math.max(10,Math.round(size*dpr));
  cv.width=cv.height=px;
  const x=cv.getContext('2d'); x.scale(px/size,px/size);
  return {cv,x};
}
function starPath(x,cx,cy,R){
  x.beginPath();
  for(let k=0;k<10;k++){
    const a=-Math.PI/2+k*Math.PI/5, rad=k%2?R*0.46:R;
    k?x.lineTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad):x.moveTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);
  }
  x.closePath();
}
function heartPath(x,cx,cy,R){
  x.beginPath(); x.moveTo(cx,cy+R*0.85);
  x.bezierCurveTo(cx-R*1.3,cy+R*0.05, cx-R*0.9,cy-R*0.95, cx,cy-R*0.35);
  x.bezierCurveTo(cx+R*0.9,cy-R*0.95, cx+R*1.3,cy+R*0.05, cx,cy+R*0.85);
  x.closePath();
}
// prismatic five-point star, used by the star gem (shiny outline in jewel, none in clay)
function drawStar(x,cx,cy,R,shiny){
  starPath(x,cx,cy,R);
  const gr=x.createLinearGradient(cx-R,cy-R,cx+R,cy+R);
  ['#FF8FB8','#FFD98A','#9CF0B5','#8FD8FF','#B79CFF'].forEach((c,k,a)=>gr.addColorStop(k/(a.length-1),c));
  x.fillStyle=gr; x.fill();
  x.lineJoin='round'; x.lineWidth=Math.max(1,R*0.12);
  x.strokeStyle=shiny?'rgba(255,255,255,.95)':'rgba(120,90,170,.3)'; x.stroke();
}
// face motif: a plain translucent stamp, same on every skin/colour so it never fights the gem underneath
function stampMotif(cv,size,motif){
  if(motif==='none') return;
  const x=cv.getContext('2d'), cx=size/2, cy=size/2, R=size*0.24;
  x.save();
  x.globalAlpha=.55; x.fillStyle='rgba(255,255,255,.92)';
  x.strokeStyle='rgba(0,0,0,.22)'; x.lineWidth=Math.max(1,size*0.02);
  if(motif==='circle'){ x.beginPath(); x.arc(cx,cy,R,0,6.283); x.fill(); x.stroke(); }
  else if(motif==='star'){ starPath(x,cx,cy,R); x.fill(); x.stroke(); }
  else if(motif==='heart'){ heartPath(x,cx,cy,R); x.fill(); x.stroke(); }
  x.restore();
}
// Hard facets: lit top, shadowed bottom, angled sides, specular.
function jewelTile(size,g){
  const {cv,x}=newTile(size);
  const L=g.star?d=>`hsl(${g.h} ${g.s}% ${clamp(90+d*.5,40,99)}%)`     // near-white, facets kept subtle
                 :d=>`hsl(${g.h} ${g.s}% ${clamp(57+d,5,96)}%)`;
  const pad=size*0.03, S=size-pad*2, i=S*0.22;                        // tight: nearly fills its cell
  const o=[[pad,pad],[pad+S,pad],[pad+S,pad+S],[pad,pad+S]];
  const n=[[pad+i,pad+i],[pad+S-i,pad+i],[pad+S-i,pad+S-i],[pad+i,pad+S-i]];
  x.save(); roundPath(x,pad,pad,S,S,S*0.14); x.clip();
  x.fillStyle=L(0); x.fillRect(pad,pad,S,S);
  const face=(a,b,c,d,dl)=>{ x.beginPath(); x.moveTo(a[0],a[1]); x.lineTo(b[0],b[1]);
    x.lineTo(c[0],c[1]); x.lineTo(d[0],d[1]); x.closePath(); x.fillStyle=L(dl); x.fill(); };
  face(o[0],o[1],n[1],n[0],24); face(o[3],o[0],n[0],n[3],7);
  face(o[1],o[2],n[2],n[1],-13); face(o[2],o[3],n[3],n[2],-27);
  const gr=x.createLinearGradient(n[0][0],n[0][1],n[2][0],n[2][1]);
  gr.addColorStop(0,L(18)); gr.addColorStop(1,L(-5));
  x.fillStyle=gr; x.fillRect(n[0][0],n[0][1],S-i*2,S-i*2);
  if(g.star) drawStar(x,size/2,size/2,S*0.4,true);
  x.globalAlpha=g.gold?.8:.5; x.fillStyle='#fff';
  roundPath(x,pad+S*0.3,pad+S*0.29,S*0.22,S*0.13,S*0.065); x.fill();
  x.globalAlpha=1; x.restore();
  roundPath(x,pad,pad,S,S,S*0.14);
  x.strokeStyle=L(26); x.lineWidth=Math.max(1,size*0.035); x.stroke();
  return cv;
}
// Classic arcade block: flat face, light top-left bevel, dark bottom-right bevel, thin gloss. Reads at any size.
function blockTile(size,g){
  const {cv,x}=newTile(size);
  const L=d=>`hsl(${g.h} ${Math.min(96,g.s+4)}% ${clamp((g.star?88:57)+d,6,97)}%)`;
  const pad=0, S=size, b=S*0.16, r=S*0.05;                                             // edge to edge: a filled row reads as one solid bar
  x.save(); roundPath(x,pad,pad,S,S,r); x.clip();
  x.fillStyle=L(17); x.fillRect(pad,pad,S,S);                                        // light bevel (top + left)
  x.fillStyle=L(-16); x.beginPath(); x.moveTo(pad+S,pad); x.lineTo(pad+S,pad+S); x.lineTo(pad,pad+S);   // dark bevel (right + bottom)
  x.lineTo(pad+b,pad+S-b); x.lineTo(pad+S-b,pad+S-b); x.lineTo(pad+S-b,pad+b); x.closePath(); x.fill();
  x.fillStyle=L(0); x.fillRect(pad+b,pad+b,S-2*b,S-2*b);                             // the face
  x.globalAlpha=.2; x.fillStyle='#fff'; x.fillRect(pad+b,pad+b,S-2*b,(S-2*b)*0.3); x.globalAlpha=1;   // gloss
  if(g.star) drawStar(x,size/2,size/2,S*0.36,true);
  x.restore();
  roundPath(x,pad+0.5,pad+0.5,S-1,S-1,r); x.strokeStyle=L(-30); x.lineWidth=1; x.stroke();      // a hairline seam, not a gap
  return cv;
}
// Matte, fat corners, soft shadow underneath — no shine anywhere.
function clayTile(size,g){
  const {cv,x}=newTile(size);
  const L=d=>`hsl(${g.h} ${Math.round(g.s*(g.gold?0.92:0.6))}% ${clamp((g.star?90:61)+d,8,96)}%)`;
  const pad=size*0.1, S=size-pad*2, R=S*0.34;
  x.save();
  x.shadowColor=`hsla(${g.h} 55% 16% / .5)`;
  x.shadowBlur=size*0.14; x.shadowOffsetY=size*0.06;
  roundPath(x,pad,pad,S,S,R); x.fillStyle=L(0); x.fill();
  x.restore();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  const gr=x.createLinearGradient(0,pad,0,pad+S);
  gr.addColorStop(0,L(12)); gr.addColorStop(.58,L(0)); gr.addColorStop(1,L(-10));
  x.fillStyle=gr; x.fillRect(pad,pad,S,S);
  if(g.star) drawStar(x,size/2,size/2,S*0.4,false);
  x.globalAlpha=.16; x.fillStyle='#fff';
  roundPath(x,pad+S*0.12,pad+S*0.1,S*0.76,S*0.22,S*0.11); x.fill();
  x.globalAlpha=1; x.restore();
  return cv;
}
// Glossy near-circle with a candy-stripe twist and a bright gloss highlight.
function candyTile(size,g){
  const {cv,x}=newTile(size);
  const L=d=>`hsl(${g.h} ${g.s}% ${clamp((g.star?88:58)+d,8,97)}%)`;
  const pad=size*0.07, S=size-pad*2, R=S*0.5, cx=pad+S/2, cy=pad+S/2;
  x.save();
  x.shadowColor='rgba(0,0,0,.35)'; x.shadowBlur=size*0.08; x.shadowOffsetY=size*0.04;
  x.beginPath(); x.arc(cx,cy,R,0,6.283); x.fillStyle=L(0); x.fill();
  x.restore();
  x.save(); x.beginPath(); x.arc(cx,cy,R,0,6.283); x.clip();
  x.translate(cx,cy); x.rotate(-0.6);
  x.fillStyle=`hsla(${g.h} ${g.s}% 90% / .35)`;
  for(let i=-2;i<=2;i++) x.fillRect(i*S*0.32-S*0.07,-S,S*0.13,S*2);
  x.rotate(0.6); x.translate(-cx,-cy);
  const gr=x.createRadialGradient(cx-S*0.15,cy-S*0.2,1,cx-S*0.15,cy-S*0.2,S*0.5);
  gr.addColorStop(0,'rgba(255,255,255,.85)'); gr.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=gr; x.beginPath(); x.arc(cx,cy,R,0,6.283); x.fill();
  if(g.star) drawStar(x,size/2,size/2,S*0.32,true);
  x.restore();
  x.beginPath(); x.arc(cx,cy,R,0,6.283);
  x.strokeStyle=L(-18); x.lineWidth=Math.max(1,size*0.03); x.stroke();
  return cv;
}
// Translucent slab: a soft colour tint, a diagonal glossy streak, thin bright edge.
function glassTile(size,g){
  const {cv,x}=newTile(size);
  const pad=size*0.08, S=size-pad*2, R=S*0.22;
  roundPath(x,pad,pad,S,S,R);
  const grad=x.createLinearGradient(pad,pad,pad+S,pad+S);
  grad.addColorStop(0,`hsla(${g.h} ${g.s}% 75% / .55)`); grad.addColorStop(1,`hsla(${g.h} ${g.s}% 45% / .35)`);
  x.fillStyle=grad; x.fill();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  x.fillStyle='rgba(255,255,255,.5)'; x.beginPath();
  x.moveTo(pad+S*0.1,pad+S*0.85); x.lineTo(pad+S*0.4,pad+S*0.1);
  x.lineTo(pad+S*0.55,pad+S*0.1); x.lineTo(pad+S*0.25,pad+S*0.85); x.closePath(); x.fill();
  if(g.star) drawStar(x,size/2,size/2,S*0.34,true);
  x.restore();
  roundPath(x,pad,pad,S,S,R);
  x.strokeStyle=`hsla(${g.h} 40% 95% / .8)`; x.lineWidth=Math.max(1,size*0.035); x.stroke();
  return cv;
}
// Dark tile, glowing outline in the gem's own hue — a sign-tube look.
function neonTile(size,g){
  const {cv,x}=newTile(size);
  const pad=size*0.1, S=size-pad*2, R=S*0.22;
  x.fillStyle='rgba(10,8,18,.92)'; roundPath(x,pad,pad,S,S,R); x.fill();
  x.save();
  x.shadowColor=`hsl(${g.h} 100% 60%)`; x.shadowBlur=size*0.22;
  x.strokeStyle=`hsl(${g.h} 100% ${g.star?85:62}%)`; x.lineWidth=Math.max(1.5,size*0.045);
  roundPath(x,pad,pad,S,S,R); x.stroke(); x.stroke();
  x.restore();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  const inner=x.createRadialGradient(size/2,size/2,0,size/2,size/2,S*0.6);
  inner.addColorStop(0,`hsla(${g.h} 100% 60% / .28)`); inner.addColorStop(1,'hsla(0 0% 0% / 0)');
  x.fillStyle=inner; x.fillRect(pad,pad,S,S);
  if(g.star) drawStar(x,size/2,size/2,S*0.3,true);
  x.restore();
  return cv;
}
// Chunky retro blocks — flat colour, hard edges, a light/dark bevel pair.
function pixelTile(size,g){
  const {cv,x}=newTile(size);
  x.imageSmoothingEnabled=false;
  const L=d=>`hsl(${g.h} ${g.s}% ${clamp((g.star?85:55)+d,8,95)}%)`;
  const px=Math.max(4,Math.round(size/8)), cells=Math.round(size/px);
  for(let ry=0;ry<cells;ry++) for(let rx=0;rx<cells;rx++){
    const lo=rx===0||ry===0, hi=rx===cells-1||ry===cells-1;
    x.fillStyle=L(lo?16:hi?-16:0);
    x.fillRect(rx*px,ry*px,px,px);
  }
  if(g.star) drawStar(x,size/2,size/2,size*0.28,true);
  return cv;
}
// ─── transformation-only tile styles: each keeps the gem's own hue as its
// fill (so gems stay distinguishable), and layers on a theme accent. Never
// offered on the skins grid — event:true keeps them out of that picker.
// Rainbow: jewel facets plus a translucent rainbow sheen band.
function rainbowTile(size,g){
  const {cv,x}=newTile(size);
  const L=g.star?d=>`hsl(${g.h} ${g.s}% ${clamp(90+d*.5,40,99)}%)`
                 :d=>`hsl(${g.h} ${g.s}% ${clamp(57+d,5,96)}%)`;
  const pad=size*0.06, S=size-pad*2, R=S*0.28;
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  const gr=x.createLinearGradient(pad,pad,pad+S,pad+S);
  gr.addColorStop(0,L(20)); gr.addColorStop(1,L(-10));
  x.fillStyle=gr; x.fillRect(pad,pad,S,S);
  x.save(); x.translate(pad+S/2,pad+S/2); x.rotate(-0.55);
  const rb=x.createLinearGradient(-S,0,S,0);
  ['#FF6B8A','#FFC15C','#FFEB6B','#7DE38A','#6BC5FF','#B08BFF'].forEach((c,i,a)=>rb.addColorStop(i/(a.length-1),c));
  x.globalAlpha=0.4; x.fillStyle=rb; x.fillRect(-S,-S*0.16,S*2,S*0.32);
  x.restore();
  if(g.star) drawStar(x,size/2,size/2,S*0.36,true);
  x.globalAlpha=.5; x.fillStyle='#fff';
  roundPath(x,pad+S*0.3,pad+S*0.29,S*0.22,S*0.13,S*0.065); x.fill();
  x.globalAlpha=1; x.restore();
  roundPath(x,pad,pad,S,S,R);
  x.strokeStyle=L(26); x.lineWidth=Math.max(1,size*0.035); x.stroke();
  return cv;
}
// Gold Vault: the usual jewel facets, framed with ornate gold corner accents.
function goldVaultTile(size,g){
  const {cv,x}=newTile(size);
  const L=g.star?d=>`hsl(${g.h} ${g.s}% ${clamp(90+d*.5,40,99)}%)`
                 :d=>`hsl(${g.h} ${g.s}% ${clamp(57+d,5,96)}%)`;
  const pad=size*0.055, S=size-pad*2, i=S*0.25;
  const o=[[pad,pad],[pad+S,pad],[pad+S,pad+S],[pad,pad+S]];
  const n=[[pad+i,pad+i],[pad+S-i,pad+i],[pad+S-i,pad+S-i],[pad+i,pad+S-i]];
  x.save(); roundPath(x,pad,pad,S,S,S*0.25); x.clip();
  x.fillStyle=L(0); x.fillRect(pad,pad,S,S);
  const face=(a,b,c,d,dl)=>{ x.beginPath(); x.moveTo(a[0],a[1]); x.lineTo(b[0],b[1]);
    x.lineTo(c[0],c[1]); x.lineTo(d[0],d[1]); x.closePath(); x.fillStyle=L(dl); x.fill(); };
  face(o[0],o[1],n[1],n[0],24); face(o[3],o[0],n[0],n[3],7);
  face(o[1],o[2],n[2],n[1],-13); face(o[2],o[3],n[3],n[2],-27);
  const gr=x.createLinearGradient(n[0][0],n[0][1],n[2][0],n[2][1]);
  gr.addColorStop(0,L(18)); gr.addColorStop(1,L(-5));
  x.fillStyle=gr; x.fillRect(n[0][0],n[0][1],S-i*2,S-i*2);
  if(g.star) drawStar(x,size/2,size/2,S*0.4,true);
  x.globalAlpha=.5; x.fillStyle='#fff';
  roundPath(x,pad+S*0.3,pad+S*0.29,S*0.22,S*0.13,S*0.065); x.fill();
  x.globalAlpha=1; x.restore();
  x.globalAlpha=.8; x.fillStyle='#FFD45C';                 // small corner accents, not a full ring
  const k=S*0.13;
  [[pad,pad,1,1],[pad+S,pad,-1,1],[pad+S,pad+S,-1,-1],[pad,pad+S,1,-1]].forEach(([cx,cy,sx,sy])=>{
    x.beginPath(); x.moveTo(cx,cy); x.lineTo(cx+sx*k,cy); x.lineTo(cx,cy+sy*k); x.closePath(); x.fill();
  });
  x.globalAlpha=.6;
  roundPath(x,pad,pad,S,S,S*0.25);
  x.strokeStyle='#FFD45C'; x.lineWidth=Math.max(1,size*0.025); x.stroke();
  x.globalAlpha=1;
  return cv;
}
// Volcano: a richer, darker fill in the gem's hue, a heat-glow rim, bright cracks.
function volcanoTile(size,g){
  const {cv,x}=newTile(size);
  const L=d=>`hsl(${g.h} ${Math.round(g.s*0.75)}% ${clamp((g.star?85:46)+d,6,94)}%)`;
  const pad=size*0.09, S=size-pad*2, R=S*0.26;
  x.save();
  x.shadowColor='hsla(18 100% 55% / .8)'; x.shadowBlur=size*0.18;
  x.strokeStyle='hsl(22 100% 60%)'; x.lineWidth=Math.max(1.5,size*0.03);
  roundPath(x,pad,pad,S,S,R); x.fillStyle=L(0); x.fill(); x.stroke();
  x.restore();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  const gr=x.createLinearGradient(0,pad,0,pad+S);
  gr.addColorStop(0,L(14)); gr.addColorStop(.6,L(-4)); gr.addColorStop(1,L(-16));
  x.fillStyle=gr; x.fillRect(pad,pad,S,S);
  x.strokeStyle='hsl(30 100% 65%)'; x.lineWidth=Math.max(1,size*0.02); x.globalAlpha=.8;
  x.beginPath(); x.moveTo(pad+S*0.2,pad+S*0.15); x.lineTo(pad+S*0.45,pad+S*0.5); x.lineTo(pad+S*0.3,pad+S*0.85); x.stroke();
  x.beginPath(); x.moveTo(pad+S*0.75,pad+S*0.1); x.lineTo(pad+S*0.55,pad+S*0.55); x.lineTo(pad+S*0.8,pad+S*0.9); x.stroke();
  x.globalAlpha=1;
  if(g.star) drawStar(x,size/2,size/2,S*0.32,true);
  x.restore();
  return cv;
}
// Starfield: a dark tile with a hue-tinted glow orb and a scatter of tiny stars.
function starfieldTile(size,g){
  const {cv,x}=newTile(size);
  const pad=size*0.08, S=size-pad*2, R=S*0.24;
  x.fillStyle='rgba(4,4,16,.96)'; roundPath(x,pad,pad,S,S,R); x.fill();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  const gr=x.createRadialGradient(size/2,size/2,0,size/2,size/2,S*0.62);
  gr.addColorStop(0,`hsla(${g.h} 95% ${g.star?88:68}% / 1)`);
  gr.addColorStop(.5,`hsla(${g.h} 95% ${g.star?80:58}% / .55)`);
  gr.addColorStop(1,'hsla(0 0% 0% / 0)');
  x.fillStyle=gr; x.fillRect(pad,pad,S,S);
  x.fillStyle='#fff';
  for(let k=0;k<14;k++){
    const px=pad+Math.random()*S, py=pad+Math.random()*S, r=0.5+Math.random()*1.3;
    x.globalAlpha=0.5+Math.random()*0.5; x.beginPath(); x.arc(px,py,r,0,6.283); x.fill();
  }
  x.globalAlpha=1;
  drawStar(x,size*0.28,size*0.26,S*0.09,true);       // one small twinkle for sparkle, on top of the glow
  if(g.star) drawStar(x,size/2,size/2,S*0.3,true);
  x.restore();
  x.save();
  x.shadowColor=`hsl(${g.h} 95% 65%)`; x.shadowBlur=size*0.16;
  roundPath(x,pad,pad,S,S,R);
  x.strokeStyle=`hsl(${g.h} 95% 75%)`; x.lineWidth=Math.max(1.2,size*0.035); x.stroke(); x.stroke();
  x.restore();
  return cv;
}
// Storm: a stormy slab with a hue-tinted lightning-bolt accent.
function stormTile(size,g){
  const {cv,x}=newTile(size);
  const L=d=>`hsl(220 ${Math.round(12+g.s*0.15)}% ${clamp((g.star?82:36)+d,6,90)}%)`;
  const pad=size*0.085, S=size-pad*2, R=S*0.22;
  roundPath(x,pad,pad,S,S,R);
  const gr=x.createLinearGradient(0,pad,0,pad+S);
  gr.addColorStop(0,L(14)); gr.addColorStop(1,L(-14));
  x.fillStyle=gr; x.fill();
  x.save(); roundPath(x,pad,pad,S,S,R); x.clip();
  x.fillStyle=`hsl(${g.h} 95% 68%)`; x.shadowColor=`hsl(${g.h} 95% 60%)`; x.shadowBlur=size*0.12;
  x.beginPath();
  x.moveTo(pad+S*0.55,pad+S*0.08); x.lineTo(pad+S*0.32,pad+S*0.5); x.lineTo(pad+S*0.48,pad+S*0.5);
  x.lineTo(pad+S*0.3,pad+S*0.94); x.lineTo(pad+S*0.65,pad+S*0.44); x.lineTo(pad+S*0.48,pad+S*0.44); x.closePath();
  x.fill();
  if(g.star) drawStar(x,size/2,size/2,S*0.3,true);
  x.restore();
  roundPath(x,pad,pad,S,S,R);
  x.strokeStyle=L(22); x.lineWidth=Math.max(1,size*0.03); x.stroke();
  return cv;
}
const SKINS=[
  {id:'jewel', name:'Jewels', render:jewelTile, unlock:0},
  {id:'blocks',name:'Blocks', render:blockTile, unlock:0},
  {id:'clay',  name:'Clay',   render:clayTile,  unlock:0},
  {id:'candy', name:'Candy',  render:candyTile, unlock:400},
  {id:'glass', name:'Glass',  render:glassTile, unlock:900},
  {id:'neon',  name:'Neon',   render:neonTile,  unlock:1600},
  {id:'pixel', name:'Pixel',  render:pixelTile, unlock:2500},
  {id:'rainbow',  name:'Rainbow',    render:rainbowTile,   unlock:0, event:true},
  {id:'goldvault',name:'Gold Vault', render:goldVaultTile, unlock:0, event:true},
  {id:'volcano',  name:'Volcano',    render:volcanoTile,   unlock:0, event:true},
  {id:'starfield',name:'Starfield',  render:starfieldTile, unlock:0, event:true},
  {id:'storm',    name:'Storm',      render:stormTile,     unlock:0, event:true}
];
const MOTIFS=[
  {id:'none',  name:'None'},
  {id:'heart', name:'Heart'},
  {id:'star',  name:'Star'},
  {id:'circle',name:'Circle'}
];
// Tile textures, kept per skin + motif until the next relayout: a transformation flips to its own skin
// and back, and rebuilding 16 tile canvases each way used to land in the frame of the clear that set it off.
const TILES=new Map();
function buildCache(){
  const key=curSkin+'|'+CFG.MOTIF;
  let t=TILES.get(key);
  if(!t){
    const skin=SKINS.find(s=>s.id===curSkin)||SKINS[0];
    t={big:GEMS.map(g=>skin.render(cell,g)), small:GEMS.map(g=>skin.render(trayCell,g))};
    if(CFG.MOTIF!=='none'){
      t.big.forEach(cv=>stampMotif(cv,cell,CFG.MOTIF));
      t.small.forEach(cv=>stampMotif(cv,trayCell,CFG.MOTIF));
    }
    TILES.set(key,t);
  }
  gemBig=t.big; gemSmall=t.small;
}
function layout(){
  dpr=Math.min(devicePixelRatio||1,2);
  W=cvs.clientWidth; H=cvs.clientHeight;
  cvs.width=Math.round(W*dpr); cvs.height=Math.round(H*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const cs=getComputedStyle(safeProbe);
  const insetT=parseFloat(cs.paddingTop)||0, insetB=parseFloat(cs.paddingBottom)||0;
  const HUD=92+insetT, Hb=H-insetB; hudH=HUD; floorY=Hb-4;
  B=Math.min(W-26,Hb-HUD-190,520);
  cell=B/N; bx=(W-B)/2;
  by=HUD+Math.max(8,(Hb-HUD-B-cell*2.6-24)*0.34);
  trayH=cell*2.4;
  trayY=by+B+Math.max(16,(Hb-by-B-trayH-14)*0.5);
  trayCell=cell*0.66;                         // the size most tray pieces show at; long ones shrink to fit (trayFit)
  SPRITES.clear(); TILES.clear();
  buildCache();
  buildBoardBg();
  GEMS.forEach(g=>glowSprite(g.h));            // the board glow takes the cleared gem's colour: build those now, not mid-clear
}
addEventListener('resize',layout);
/* the board panel and its 64 empty-cell slots never change between layouts,
   so they're drawn once here instead of as 65 path fills every frame */
let boardBg=null;
function buildBoardBg(){
  const pad=9, w=B+pad*2, cv=document.createElement('canvas');
  cv.width=Math.round(w*dpr); cv.height=Math.round(w*dpr);
  const x=cv.getContext('2d'); x.scale(dpr,dpr);
  const t=theme();
  x.fillStyle=t.light?t.panel:'rgba(0,0,0,.34)'; roundPath(x,0,0,w,w,20); x.fill();
  x.strokeStyle=t.light?t.stroke:'rgba(255,255,255,.07)'; x.lineWidth=1.5; x.stroke();
  const p=cell*.025;
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    x.fillStyle=t.light?t.slot:'rgba(255,255,255,.055)';
    roundPath(x,pad+c*cell+p,pad+r*cell+p,cell-p*2,cell-p*2,cell*.1); x.fill();
    if(!t.light){ x.fillStyle='rgba(0,0,0,.14)'; roundPath(x,pad+c*cell+p,pad+r*cell+p,cell-p*2,cell*.22,cell*.16); x.fill(); }  // a shallow inset shadow
  }
  boardBg={cv,pad,w};
}

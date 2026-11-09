// Crumble — Share card (plan 4.4). Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ share card ═══════
   A picture of the final board and the score, drawn on a canvas here. Nothing is uploaded and no link or account
   is involved. On iPhone the image goes to the share sheet (Messages, Photos, ...). Where the share sheet cannot take
   files, the picture is saved instead. Shown on the game-over card for Endless and Daily runs only. */
const SHARE_W=1080, SHARE_H=1350;
const SHARE_FILE='crumble-score.png';

// the board as she left it: filled cells in a soft gold, empty ones as faint slots
function drawShareBoard(g,x,y,size){
  const n=N, cs=size/n, pad=cs*0.08;
  g.fillStyle='rgba(255,255,255,.10)';
  g.beginPath(); g.roundRect(x-18,y-18,size+36,size+36,36); g.fill();
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){
    const on=grid&&grid[r]&&grid[r][c];
    g.fillStyle=on?'#FFD86B':'rgba(255,255,255,.08)';
    g.beginPath(); g.roundRect(x+c*cs+pad,y+r*cs+pad,cs-pad*2,cs-pad*2,cs*0.22); g.fill();
  }
}

// the card: title, the score, the run's line, the board, and a quiet invitation
function drawShareCard(d){
  const cv=document.createElement('canvas'); cv.width=SHARE_W; cv.height=SHARE_H;
  const g=cv.getContext('2d');
  const sky=g.createLinearGradient(0,0,0,SHARE_H);
  sky.addColorStop(0,'#7E9FBA'); sky.addColorStop(1,'#34495F');
  g.fillStyle=sky; g.fillRect(0,0,SHARE_W,SHARE_H);
  g.textAlign='center'; g.textBaseline='alphabetic'; g.fillStyle='#FFFFFF';
  g.font='800 96px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.fillText('Crumble',SHARE_W/2,170);
  g.font='600 40px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.globalAlpha=.8; g.fillText(d.label,SHARE_W/2,235); g.globalAlpha=1;
  g.font='900 200px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.fillText(String(d.score),SHARE_W/2,430);
  g.font='600 42px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.globalAlpha=.85; g.fillText(d.sub,SHARE_W/2,500); g.globalAlpha=1;
  const size=640;
  drawShareBoard(g,(SHARE_W-size)/2,560,size);
  g.font='600 44px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.globalAlpha=.9; g.fillText("Can you beat it?",SHARE_W/2,SHARE_H-70); g.globalAlpha=1;
  return cv;
}

// what the card says, from the run that just ended
function shareData(){
  const daily=mode==='daily';
  return {
    score:score,
    label:daily?"Today's Daily board":'Endless run',
    sub:daily?'Daily challenge':(score>=best&&score>0?'New best!':'Best: '+best)
  };
}

function shareSetup(){
  const can=(mode==='endless'||mode==='daily')&&score>0;
  el('shareBtn').hidden=!can;
}

// the share sheet takes the picture when it can; otherwise (or if she closes the sheet with an error) it saves it
async function shareRun(){
  const cv=drawShareCard(shareData());
  const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
  if(!blob) return 'failed';
  const file=new File([blob],SHARE_FILE,{type:'image/png'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],title:'Crumble',text:'My Crumble score: '+score}); return 'shared'; }
    catch(e){ if(e&&e.name==='AbortError') return 'cancelled'; }
  }
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=SHARE_FILE; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  return 'saved';
}

el('shareBtn').onclick=async e=>{
  e.stopPropagation();
  try{ await shareRun(); }catch(err){ /* a failed share just leaves the card as it was */ }
};

// Crumble — Ads — the only ad code in the game (currently faked).
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
/* ═══════ ADS — the only ad code in the file ═══════ */
const Ads = {
  isReady(){ return true; },
  async showInterstitial(){ await fakeAd(5); },
  async showRewarded(){ await fakeAd(8); return true; }
};
function el(id){ return document.getElementById(id); }
const adScreen=el('adScreen'), adTimer=el('adTimer'), adClose=el('adClose');
function fakeAd(secs){
  return new Promise(res=>{
    let left=secs;
    adScreen.hidden=false; adTimer.textContent=left; adClose.disabled=true;
    const t=setInterval(()=>{ left--; adTimer.textContent=left>0?left:'';
      if(left<=0){ clearInterval(t); adClose.disabled=false; } },1000);
    adClose.onclick=()=>{ clearInterval(t); adScreen.hidden=true; res(); };
  });
}

// Crumble — Crumb's closet: hats (and glasses, and a cape) for the crumb, bought with dare cookies or earned by feats.
// Plain script, loaded in order by index.html (after goals.js); shares globals with the other js/ files.
/* The dares (js/dares.js) pay cookies into a jar; this is what they buy. Three slots, one item worn in each: head, face,
   neck. Most items have a cookie price (cheap first, so the player's first cookies buy something); some cannot be bought and come
   from a feat the game already records (a 7-day dare streak, the Space dare, 10 board sweeps...). Nothing is ever for sale
   for money.
   Drawing: each item is one or two small SVG groups put into the crumb's own SVG (closetDress): `back` goes in first (under
   the body: a cape), `front` goes in just before the brow-wipe arm (over the face). So an item inherits every transform the
   crumb has: its moods, blink and breath, the toy's spin, the cannonball's swell, the faint. One function dresses every
   crumb on screen (the board mascot, the menu's crumb, the closet's big crumb and the tiles' little ones).
   Spending: cookies in `crumble.dares` merge across devices by max, so they are never lowered. The closet keeps its own
   `spent`, and the player can spend `cookies - spent`.
   Saved: `crumble.closet` = {v:1, own:[ids bought], on:{head,face,neck}, spent, ot: when the outfit last changed (ms; for
   the iCloud merge), seen:[ids the player has seen on offer: the dot]}. Feat items are never stored as owned: they are worn while
   the feat holds, which (stats only grow) is for good. Validated on load; unknown ids are dropped.
   The dot: on the Goals tiles and the closet button while something is newly within reach (an item the player can now afford, or
   a feat item just earned) that the player has not seen in the closet yet. A feat earned mid-run gets one quiet line from the crumb. */
const CLOSET_STORE='crumble.closet';
const CLOSET_SLOTS=['head','face','neck'];
const CL_OL='stroke="#3B2414" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"';   // the items' outline: a touch darker than the crumb's
const CL_HALO=d=>`<path d="${d}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3.4" stroke-linejoin="round"/>`;   // a light rim under a dark item, so it reads on a night sky
const CLOSET=[
  // ── head ──
  {id:'party', slot:'head', name:'Party hat', price:2, front:
    `<path d="M16.6 9.6 27.2-7.4 30 7.6z" fill="#FF5FA2" ${CL_OL}/><path d="M20.4 3.6l7.4 1.2M23.8-1.8l4.4.8" fill="none" stroke="#FFE066" stroke-width="2.2" stroke-linecap="round"/>`+
    `<path d="M16.6 9.6 27.2-7.4 30 7.6z" fill="none" ${CL_OL}/><circle cx="27.2" cy="-7.6" r="2.6" fill="#7FE3FF" ${CL_OL}/>`},
  {id:'beanie', slot:'head', name:'Beanie', price:5, front:
    `<path d="M11.4 13.4C11 4.6 17 .4 24.4.4s13.4 3.6 13.2 11.6z" fill="#3FB6A8" ${CL_OL}/>`+
    `<path d="M19 2.2l-.6 7.8M24.4 1v8.8M29.8 1.8l.4 8.4" fill="none" stroke="#2A8C80" stroke-width="1.1" stroke-linecap="round"/>`+
    `<path d="M10.6 14.4c-.6-2.2-.2-3.8.6-4.8 8.4-1.4 18-1.8 26.6-.2.8 1 1 2.8.4 4.6-9.2-1.2-18.6-1-27.6.4z" fill="#2E8F84" ${CL_OL}/>`+
    `<circle cx="24.6" cy="-.4" r="2.9" fill="#F4F1EA" ${CL_OL}/>`},
  {id:'cowboy', slot:'head', name:'Cowboy hat', price:10, front:
    `<path d="M15.2 8.4C14.6 3.4 15.4-.8 18.6-1.4c2.4-.4 3.4 1.6 5.6 1.4 2.2-.2 3.4-2 5.6-1.4 3 .8 3.6 5 3 9.6z" fill="#C98B4A" ${CL_OL}/>`+
    `<path d="M15.4 6.2c5.8-1 11.6-1.2 17.4-.4l-.1 2.3c-5.8-.8-11.4-.6-17.2.4z" fill="#7A4524"/>`+
    `<path d="M4.4 6.6c2 2.4 5 3.6 9.4 3.4 7-.6 13.8-.8 20.4-.2 4.4.4 7.6-.6 9.6-3.4-.2 3.6-3.4 6.6-9 6.6-7.4-.8-14.4-.6-21 .2-5.4.4-9-2.6-9.4-6.6z" fill="#B57638" ${CL_OL}/>`},
  {id:'top', slot:'head', name:'Top hat', feat:{how:'30 Adventure stars', val:()=>advStars(), need:30}, front:
    CL_HALO('M16.6 7.8 17.4-8.6h13.4l.8 16.4zM11.4 9.2c0-1.8 5.6-2.6 12.6-2.6s12.6.8 12.6 2.6-5.6 2.4-12.6 2.4-12.6-.6-12.6-2.4z')+
    `<path d="M16.6 7.8 17.4-8.6h13.4l.8 16.4z" fill="#2D2A3A" ${CL_OL}/><path d="M17 2.6h14.2l.2 3.4H16.8z" fill="#E0454B"/>`+
    `<path d="M19.4-6.6l-.4 8" fill="none" stroke="#6B6585" stroke-width="1.3" stroke-linecap="round"/>`+
    `<path d="M11.4 9.2c0-1.8 5.6-2.6 12.6-2.6s12.6.8 12.6 2.6-5.6 2.4-12.6 2.4-12.6-.6-12.6-2.4z" fill="#2D2A3A" ${CL_OL}/>`},
  {id:'chef', slot:'head', name:"Chef's hat", price:12, front:
    `<path d="M15.6 9.8 15.2 2.4h17.8l-.4 7.4c-5.8-.8-11.8-.8-17 0z" fill="#FFFFFF" ${CL_OL}/>`+
    `<path d="M15.4 3C11.4 2.6 10 -2 12.8-4.4c1.8-1.6 4.4-1.2 5.6 0 .6-3.4 3.4-5.2 6.2-4.8 2.8.4 4.6 2.6 4.6 4.6 1.6-1.4 4.4-1.4 5.8.4 2.2 2.8.6 7.2-3.2 7.2z" fill="#FFFFFF" ${CL_OL}/>`+
    `<path d="M20.4 3.6v4.8M24.2 3.4v5M28 3.6v4.8" fill="none" stroke="#C9C3B8" stroke-width="1" stroke-linecap="round"/>`},
  {id:'pirate', slot:'head', name:'Pirate hat', feat:{how:'Win a cannonball dare', val:()=>(dare.st.won.cannon8|0)+(dare.st.won.cannon15|0), need:1}, front:
    CL_HALO('M5.8 11.2C7.4 6 9.6 3.4 12.8 3C14.8-3 19.4-5.6 24.2-5.6S33.6-3 35.6 3c3.2.4 5.4 3 7 8.2C37 8.8 30.8 7.8 24.2 7.8S11.4 8.8 5.8 11.2z')+`<path d="M5.8 11.2C7.4 6 9.6 3.4 12.8 3C14.8-3 19.4-5.6 24.2-5.6S33.6-3 35.6 3c3.2.4 5.4 3 7 8.2C37 8.8 30.8 7.8 24.2 7.8S11.4 8.8 5.8 11.2z" fill="#26222E" ${CL_OL}/>`+
    `<path d="M8.2 9.4C13.2 7.2 18.6 6.2 24.2 6.2s11 1 16 3.2" fill="none" stroke="#E8B84A" stroke-width="1.6" stroke-linecap="round"/>`+
    `<path d="M20.6 3.6l7.2 2.6M27.8 3.6l-7.2 2.6" stroke="#F4F1EA" stroke-width="1.3" stroke-linecap="round"/>`+
    `<circle cx="24.2" cy="0" r="3" fill="#F4F1EA"/><rect x="22.6" y="1.8" width="3.2" height="2" rx=".6" fill="#F4F1EA"/>`+
    `<circle cx="23" cy="-.1" r=".85" fill="#26222E"/><circle cx="25.4" cy="-.1" r=".85" fill="#26222E"/>`},
  {id:'hard', slot:'head', name:'Hard hat', feat:{how:'Win the Avalanche dare', val:()=>dare.st.won.ava|0, need:1}, front:
    `<path d="M13 8.8c0-6.6 4.8-10.4 11-10.4s11 3.8 11 10.4z" fill="#FFC93C" ${CL_OL}/>`+
    `<path d="M21.6-1.2c-.4 3.2-.4 6.4 0 9.6h4.8c.4-3.2.4-6.4 0-9.6z" fill="#F2A900" ${CL_OL}/>`+
    `<path d="M9.4 9.4c0-1.6 6.6-2 14.6-2s14.8.4 14.8 2c0 1.4-6.8 1.8-14.8 1.8s-14.6-.4-14.6-1.8z" fill="#FFC93C" ${CL_OL}/>`},
  {id:'crown', slot:'head', name:'Crown', feat:{how:'Beat a dare 7 days in a row', val:()=>dare.st.days.best, need:7}, front:
    `<g transform="translate(24 9.4) scale(1.18) translate(-24 -9.4)"><path d="M15.4 9.4 14 -.6l5 4.2 5-6.4 5 6.4 5-4.2-1.4 10z" fill="#FFD34D" ${CL_OL}/>`+
    `<path d="M15.2 6.4h17.6" fill="none" stroke="#C98E00" stroke-width="1.2"/>`+
    `<circle cx="24" cy="4.6" r="1.6" fill="#E0454B" stroke="#7A1D22" stroke-width=".7"/><circle cx="18.6" cy="5.4" r="1.1" fill="#4FA3FF" stroke="#1D4F8A" stroke-width=".6"/><circle cx="29.4" cy="5.4" r="1.1" fill="#4FA3FF" stroke="#1D4F8A" stroke-width=".6"/>`+
    `<circle cx="14" cy="-.8" r="1.2" fill="#FFF3B0" ${CL_OL}/><circle cx="24" cy="-2.4" r="1.2" fill="#FFF3B0" ${CL_OL}/><circle cx="34" cy="-.8" r="1.2" fill="#FFF3B0" ${CL_OL}/></g>`},
  {id:'space', slot:'head', name:'Space helmet', price:15, front:
    `<path d="M24 1.8v-4.4" stroke="#8A97A8" stroke-width="1.4" stroke-linecap="round"/><circle cx="24" cy="-3.6" r="1.8" fill="#FF6B6B" ${CL_OL}/>`+
    `<circle cx="24" cy="23" r="21.4" fill="rgba(170,225,255,.09)" stroke="#E9F7FF" stroke-width="2.4"/>`+
    `<circle cx="24" cy="23" r="21.4" fill="none" stroke="#3E6E92" stroke-width="1"/>`+
    `<path d="M9.4 14.6C11.6 9 16.4 5 22.4 4.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".85"/><circle cx="8.6" cy="18.6" r="1" fill="#fff" opacity=".85"/>`},
  // ── face ──
  {id:'shades', slot:'face', name:'Sunglasses', price:8, front:
    `<path d="M13.6 18.4h9.6l-.6 4.2c-.4 2-2 3-4.2 3s-3.8-1-4.2-3zM24.8 18.4h9.6l-.6 4.2c-.4 2-2 3-4.2 3s-3.8-1-4.2-3z" fill="#1E1B2B" ${CL_OL}/>`+
    `<path d="M23.2 19.2h1.6M13.6 18.8l-3.2-.6M34.4 18.8l3.4-.8" fill="none" stroke="#1E1B2B" stroke-width="1.4" stroke-linecap="round"/>`+
    `<path d="M15.6 20.2l2.4 0M26.8 20.2l2.4 0" fill="none" stroke="#9FD8FF" stroke-width="1.2" stroke-linecap="round" opacity=".9"/>`},
  {id:'round', slot:'face', name:'Round glasses', price:4, front:
    `<circle cx="18.6" cy="21.6" r="5.1" fill="rgba(255,255,255,.14)" stroke="#2A2638" stroke-width="1.4"/><circle cx="29.4" cy="21.6" r="5.1" fill="rgba(255,255,255,.14)" stroke="#2A2638" stroke-width="1.4"/>`+
    `<path d="M23.6 21c.3-.7 .5-.7.4-.7M23.7 20.8q.3-.6.6 0M13.5 21l-3.2-1.4M34.5 21l3.6-1.6" fill="none" stroke="#2A2638" stroke-width="1.3" stroke-linecap="round"/>`},
  {id:'goggles', slot:'face', name:'Aviator goggles', feat:{how:'Win the "reach Space" dare', val:()=>dare.st.won.space|0, need:1}, front:
    `<path d="M10.2 12.6c8.6-2.6 19.4-2.8 28.6-.6l.4 2.6c-9.4-2.2-20-2-28.8.6z" fill="#7A4A22" ${CL_OL}/>`+
    `<circle cx="18.8" cy="11.4" r="4" fill="#8FD8FF" stroke="#B07A2E" stroke-width="2"/><circle cx="29.4" cy="11.2" r="4" fill="#8FD8FF" stroke="#B07A2E" stroke-width="2"/>`+
    `<circle cx="18.8" cy="11.4" r="5" fill="none" stroke="#3B2414" stroke-width=".9"/><circle cx="29.4" cy="11.2" r="5" fill="none" stroke="#3B2414" stroke-width=".9"/>`+
    `<path d="M17 10l1.4-1.2M27.6 9.8 29 8.6" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`},
  {id:'patch', slot:'face', name:'Eye patch', feat:{how:'Beat 10 dares', val:()=>daresWon(), need:10}, front:
    `<path d="M32.4 18.6 39.4 12.8" stroke="#1E1B2B" stroke-width="1.4" stroke-linecap="round"/>`+
    `<path d="M25 19.6c.4-2.4 2.4-3.4 4.6-3.2 2.4.2 4.2 1.6 4.2 4.2 0 3.2-2 5.4-4.6 5.4s-4.6-2.6-4.2-6.4z" fill="#1E1B2B" ${CL_OL}/>`+
    `<path d="M27 19.4q1.6-1.4 3.6-.8" fill="none" stroke="#5B5670" stroke-width="1" stroke-linecap="round"/>`},
  // ── neck ──
  {id:'scarf', slot:'neck', name:'Scarf', price:6, front:
    `<path d="M29.4 35.2c1.4 2.6 1.6 5.6 1 8.6l4-.6c.4-3.2-.2-6.2-1.6-8.6z" fill="#E8484A" ${CL_OL}/><path d="M30.4 40.6l3.6-.6" stroke="#FFF1D6" stroke-width="1.3"/>`+
    `<path d="M10.6 32.4c8.4 3 18.4 3 27 0l.8 3.4c-9.2 3.4-19.6 3.4-28.4 0z" fill="#E8484A" ${CL_OL}/>`+
    `<path d="M16 34.2l-.4 3.2M22.2 35.2v3.2M28.4 35l.4 3.2M34 33.8l.6 3" stroke="#FFF1D6" stroke-width="1.3" stroke-linecap="round"/>`},
  {id:'bow', slot:'neck', name:'Bow tie', price:3, front:
    `<g transform="translate(24 36.2) scale(1.25) translate(-24 -36.2)"><path d="M24 36.2 17.8 33c-.8 1.8-.8 4.4 0 6.4zM24 36.2l6.2-3.2c.8 1.8.8 4.4 0 6.4z" fill="#4C7DFF" ${CL_OL}/>`+
    `<rect x="22.2" y="34.4" width="3.6" height="3.6" rx="1.2" fill="#3460D6" ${CL_OL}/></g>`},
  {id:'cape', slot:'neck', name:'Cape', feat:{how:'Clear the whole board 10 times', val:()=>stats.sweeps, need:10}, back:
    `<path d="M12 22c-3 6.4-6 13.4-7.6 21.2 2.4-1 4.6-.6 6.4.8 1.8-1.4 4-1.4 5.8 0h15c1.8-1.4 4-1.4 5.8 0 1.8-1.4 4-1.8 6.4-.8C42.2 35.4 39.2 28.4 36 22z" fill="#C42E3A" ${CL_OL}/>`+
    `<path d="M9.6 34.6c-1 2.6-1.8 5.2-2.4 7.8" fill="none" stroke="#E86A72" stroke-width="1.2" stroke-linecap="round"/>`+
    `<path d="M11.4 25.6 5.2 14.8l7.4 4.4zM36.6 25.6l6.2-10.8-7.4 4.4z" fill="#7A1622" ${CL_OL}/>`},
];
const closetDef=id=>CLOSET.find(d=>d.id===id)||null;
const closet={own:new Set(),on:{head:'',face:'',neck:''},spent:0,ot:0,seen:new Set(),
  el:null,big:null,from:'',armed:'',met:null,checkAt:0,tell:false,actUntil:0,sayUntil:0,t:0};

/* ── what the player has ── */
const closetMet=d=>!!d.feat&&d.feat.val()>=d.feat.need;          // a feat item: earned (stats only grow, so for good)
const closetOwns=id=>{ const d=closetDef(id); return !!d&&(d.feat?closetMet(d):closet.own.has(id)); };
const closetSpendable=()=>Math.max(0,dare.st.cookies-closet.spent);
const closetCanBuy=id=>{ const d=closetDef(id); return !!d&&!d.feat&&!closet.own.has(id)&&closetSpendable()>=d.price; };
// within reach: what the dot is about (an item the player can buy now, or a feat item the player has earned) and the player has not seen yet
const closetNew=()=>CLOSET.filter(d=>(d.feat?closetMet(d):closetCanBuy(d.id))&&!closet.seen.has(d.id)).map(d=>d.id);

function loadCloset(){                                   // main.js, after the stats, Adventure and the dare jar have loaded
  try{
    const o=JSON.parse(localStorage.getItem(CLOSET_STORE)||'null');
    if(o&&o.v===1){
      if(Array.isArray(o.own)) for(const id of o.own){ const d=closetDef(id); if(d&&!d.feat) closet.own.add(id); }
      if(isInt(o.spent,0,1e6)) closet.spent=o.spent;
      if(isInt(o.ot,0,1e15)) closet.ot=o.ot;
      if(Array.isArray(o.seen)) for(const id of o.seen) if(closetDef(id)) closet.seen.add(id);
      if(o.on&&typeof o.on==='object') for(const s of CLOSET_SLOTS){ const id=o.on[s], d=closetDef(id); if(d&&d.slot===s&&closetOwns(id)) closet.on[s]=id; }
    }
  }catch(e){}
  closet.met=new Set(CLOSET.filter(closetMet).map(d=>d.id));   // feats held at launch: no "something new" line for those
}
function saveCloset(){
  const c=closet;
  try{ localStorage.setItem(CLOSET_STORE,JSON.stringify({v:1,own:[...c.own].sort(),on:{...c.on},spent:c.spent,ot:c.ot,seen:[...c.seen].sort()})); }catch(e){}
  if(typeof cloudDirty==='function') cloudDirty();
}
function closetBuy(id){                                  // true if bought (and put on)
  if(!closetCanBuy(id)) return false;
  closet.spent+=closetDef(id).price; closet.own.add(id); closet.seen.add(id);
  closetPut(id,true);
  return true;
}
function closetPut(id,on){                               // wear it (taking off what was in its slot) or take it off
  const d=closetDef(id); if(!d||(on&&!closetOwns(id))) return;
  closet.on[d.slot]=on?id:''; closet.ot=Date.now();
  saveCloset(); closetDressAll();
}

/* ── dressing a crumb: one function for every crumb on screen ── */
function closetDress(svg,on=closet.on){
  if(!svg) return;
  svg.querySelectorAll('.cl').forEach(g=>g.remove());
  const arm=svg.querySelector('.ab'), first=svg.firstChild;
  for(const s of ['neck','face','head']){                // the head item goes on last: a hat sits over goggles
    const d=closetDef(on[s]); if(!d) continue;
    const mk=(html,where)=>{ const g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','cl cl-'+s+' cl-'+d.id+where); g.innerHTML=html; return g; };
    if(d.back) svg.insertBefore(mk(d.back,' clB'),first);
    if(d.front) svg.insertBefore(mk(d.front,''),arm);
  }
}
function closetDressAll(){ for(const e of [masc.el,hero.crumb,closet.big]) if(e) closetDress(e.querySelector('svg')); }   // (the menu's crumb is not in the page while no menu is up)

/* ── the card ── */
function closetInit(){
  const c=el('closetCrumb'); c.innerHTML='<div class="mb">'+MASCOT_SVG+'</div>';
  closet.big=c;
  el('closetBack').onclick=e=>{ e.stopPropagation(); closeCloset(); };
  el('goalsCloset').onclick=e=>{ e.stopPropagation(); openCloset('goals'); };
  el('closetCard').addEventListener('click',()=>{ if(closet.armed){ closet.armed=''; renderCloset(); } });   // a tap anywhere else puts "Get it" away
  c.onclick=e=>{ e.stopPropagation(); closetAct('smug'); closetLine(sayPick('poke')); };
}
function closetStatus(d){                               // the tile's second line: plainly how to get it, or what a tap does
  if(closet.on[d.slot]===d.id) return 'Wearing';
  if(closetOwns(d.id)) return 'Tap to wear';
  if(d.feat){ const v=Math.min(d.feat.val()|0,d.feat.need); return '🔒 '+d.feat.how+(d.feat.need>1?' · '+v+'/'+d.feat.need:''); }
  if(closet.armed===d.id) return 'Get it · '+d.price+(d.price===1?' cookie':' cookies');
  const more=d.price-closetSpendable();
  return '🍪 '+d.price+(more>0?' · '+more+' more':'');
}
function renderCloset(){
  closetDress(closet.big.querySelector('svg'));
  const sp=closetSpendable();
  el('closetJar').textContent='🍪 '+sp+(sp===1?' cookie':' cookies')+' to spend';
  const list=el('closetList'), top=list.scrollTop; list.textContent='';
  for(const s of CLOSET_SLOTS){
    list.append(Object.assign(document.createElement('p'),{className:'setgroup',textContent:{head:'Head',face:'Face',neck:'Neck'}[s]}));
    const g=document.createElement('div'); g.className='closetGrid';
    for(const d of CLOSET.filter(x=>x.slot===s)){
      const b=document.createElement('button'); b.type='button'; b.dataset.id=d.id;
      const own=closetOwns(d.id), on=closet.on[s]===d.id;
      b.className='clTile'+(on?' on':own?' own':d.feat?' feat':closet.armed===d.id?' armed':closetCanBuy(d.id)?' buy':' short');
      b.setAttribute('aria-pressed',on?'true':'false');
      b.innerHTML='<div class="crumbFig idle rm"><div class="mb">'+MASCOT_SVG+'</div></div><b></b><span></span>';
      closetDress(b.querySelector('svg'),{head:'',face:'',neck:'',[s]:d.id});
      b.querySelector('b').textContent=d.name; b.querySelector('span').textContent=closetStatus(d);
      b.onclick=e=>{ e.stopPropagation(); closetTap(d.id); };
      g.append(b);
    }
    list.append(g);
  }
  list.scrollTop=top;
}
function closetTap(id){
  const d=closetDef(id), was=closet.armed; closet.armed='';
  if(closetOwns(id)){                                    // wear it, or take it off
    const off=closet.on[d.slot]===id;
    closetPut(id,!off);
    closetAct(off?'flat':'smug'); closetLine(sayPick(off?'closetOff':'closetOn'));
    toyPlay(0,t=>tone(t,{f0:off?900:620,f1:off?520:1180,pdur:.07,dur:.1,vol:.05,type:'triangle'}));
  } else if(d.feat){
    closetAct('flat'); closetLine('earn it. '+d.feat.how.toLowerCase()+'.');
  } else if(closetCanBuy(id)){
    if(was!==id) closet.armed=id;                        // the first tap asks: "Get it · 4 cookies"; the second buys
    else {
      closetBuy(id); closetAct('hop'); closetLine(sayPick('closetBuy'));
      toyPlay(0,t=>{ tone(t,{f0:1568,pdur:.02,dur:.12,vol:.05,type:'triangle'}); tone(t+.06,{f0:2093,pdur:.02,dur:.18,vol:.04,type:'triangle'}); });
      haptic('achieve');
    }
  } else {
    const more=d.price-closetSpendable();
    closetAct('flat'); closetLine(more+' more '+(more===1?'cookie':'cookies')+'. go win a dare.');
  }
  renderCloset(); closetSyncDot();
}
function closetAct(name){                               // the big crumb's face, and its movement (none with reduced motion)
  const c=closet.big, a=MASCOT_ACT[name];
  c.className='crumbFig '+name+(reduce?' rm':'');
  clearTimeout(closetAct.t); closetAct.t=setTimeout(()=>{ c.className='crumbFig idle'+(reduce?' rm':''); },a?a.ms:1300);
  if(a&&a.move&&!reduce) c.firstChild.animate(a.move,{duration:a.dur,easing:'ease-out'});
}
function closetLine(txt){
  const b=el('closetSay'); b.textContent=txt; b.hidden=false;
  if(!reduce) b.animate([{transform:'scale(.6)',opacity:0},{transform:'none',opacity:1}],{duration:200,easing:'cubic-bezier(.3,1.5,.6,1)'});
  clearTimeout(closetLine.t); closetLine.t=setTimeout(()=>{ b.hidden=true; },2600);
}
function openCloset(from){                               // from: 'goals' (the Goals card's button) or 'home' (the menu's crumb)
  pauseForMenu();
  closet.from=from; closet.armed=''; closet.tell=false;
  for(const d of CLOSET) if(d.feat?closetMet(d):closetCanBuy(d.id)) closet.seen.add(d.id);   // seen: the dot goes
  saveCloset(); renderCloset();
  el('closetSay').hidden=true; closet.big.className='crumbFig idle'+(reduce?' rm':'');
  el('closetCard').hidden=false; el('closetList').scrollTop=0; closetSyncDot();
}
function closeCloset(){                                  // back to where the player came from: the card under it is still up
  el('closetCard').hidden=true; closet.armed='';
  if(!el('goalsCard').hidden) renderGoals();
  const g=goalsSub(); el('menuGoalsSub').textContent=g; el('startGoalsSub').textContent=g;
  closetSyncDot();
  if(!overlayOpen()) paused=false;
}
function closetFromHero(){                               // home.js: the menu's crumb was tapped; he smirks, then opens his closet
  setTimeout(()=>{ if(hero.card&&el('closetCard').hidden) openCloset('home'); },reduce?0:420);
}
let closetDotOn=null;
function closetSyncDot(){
  const on=closetNew().length>0; if(on===closetDotOn) return; closetDotOn=on;
  for(const id of ['startGoals','menuGoals','goalsCloset']) el(id).classList.toggle('dot',on);
}
// mascot.js mascotStep, every drawn frame (cheap: twice a second): the dot, and a feat item earned mid-run gets one quiet line
function closetStep(now){
  if(now<closet.checkAt||!closet.met) return; closet.checkAt=now+500;
  for(const d of CLOSET) if(d.feat&&!closet.met.has(d.id)&&closetMet(d)){ closet.met.add(d.id); if(!closet.seen.has(d.id)) closet.tell=true; }
  if(closet.tell&&state==='play'&&CFG.FX_MASCOT&&!hero.card&&!hero.falling&&!masc.el.hidden&&!dare.q.length&&dareQuiet(now)&&crumbSay(sayPick('closetNew'),2600,'say',false)) closet.tell=false;
  closetSyncDot();
}
closetInit();

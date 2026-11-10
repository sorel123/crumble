// Crumble — Boot.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
loadSkinSave(); applyTheme(); buildSkinsUI(); buildSettingsUI();
initDev();

migrateScale(); loadStats(); hesLoad(); checkUnlocks(); loadModes(); loadGoals(); gcStart();     // best score first: it decides which skins are open
mascotInit(); layout(); grid=empty(); resetWorld();
if(mode==='adventure'){ const o=peekRun('adventure'); if(o&&o.lv) lvl=LEVELS[o.lv.id-1]||null; if(!lvl) mode='endless'; }
let resumed=loadRun();
if(!resumed){ if(mode!=='endless'){ mode='endless'; lvl=null; } resumed=loadRun(); if(!resumed){ genTray(); updateDbg(); } }   // a saved run reopens exactly as it was (no opening is dealt)
if(resumed) openMenu();                          // ...behind the front menu: a launch always opens on the menu, with Continue and Back to the game
{ const link=chReadLink(); if(link) openFriend(link); }   // (E2) a friend's Challenge link: its card, with "Beat N"
syncHud(); requestAnimationFrame(frame);

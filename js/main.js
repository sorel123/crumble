// Crumble — Boot.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
loadSkinSave(); applyTheme(); buildSkinsUI(); buildSettingsUI();
initDev();

loadStats(); hesLoad(); checkUnlocks(); loadModes();     // best score first: it decides which skins are open
layout(); grid=empty(); resetWorld();
if(mode==='adventure'){ const o=peekRun('adventure'); if(o&&o.lv) lvl=LEVELS[o.lv.id-1]||null; if(!lvl) mode='endless'; }
if(!loadRun()){ if(mode!=='endless'){ mode='endless'; lvl=null; } if(!loadRun()){ genTray(); updateDbg(); } }                        // a saved run reopens exactly as it was (no opening is dealt)
syncHud(); requestAnimationFrame(frame);

// Crumble — Boot.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
loadSkinSave(); applyTheme(); buildSkinsUI(); buildSettingsUI();
initDev();

loadStats(); hesLoad(); checkUnlocks(); el('bestVal').textContent=best;     // best score first: it decides which skins are open
layout(); grid=empty(); resetWorld();
if(!loadRun()){ genTray(); updateDbg(); }                        // a saved run reopens exactly as it was (no opening is dealt)
requestAnimationFrame(frame);

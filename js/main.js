// Crumble — Boot.
// Plain script, loaded in order by index.html; shares globals with the other js/ files.
loadSkinSave(); applyTheme(); buildSkinsUI(); buildSettingsUI();
initDev();

layout(); grid=empty(); resetWorld(); genTray(); updateDbg(); requestAnimationFrame(frame);

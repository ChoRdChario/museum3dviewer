/* LociMyu v6.6 - sheet-rename.module.js (P0)
 * Single responsibility: detect spreadsheetId and publish once via 'materials:spreadsheetId' event.
 * No fetch patching. No UI creation.
 */
(function(){
  let published = false;

  function detectFromLocation(){
    try{
      const u = new URL(location.href);
      // Common param names used across prior builds
      const keys = ["spreadsheetId", "pinsId", "sheetId", "materialsId"];
      for (const k of keys) {
        const v = u.searchParams.get(k);
        if (v && /^[A-Za-z0-9_\-]{20,}$/.test(v)) return v;
      }
      return null;
    }catch(e){
      return null;
    }
  }

  function publish(id){
    if (published || !id) return;
    published = true;
    const detail = {id};
    console.log("[materials] spreadsheetId:", id);
    window.dispatchEvent(new CustomEvent("materials:spreadsheetId", {detail}));
  }

  function autodetectAndPublish(){
    if (published) return;
    const id = detectFromLocation();
    if (id) { publish(id); return; }
    // If page sets global later (e.g., after Create/Select), observe changes
    let tries = 0;
    const t = setInterval(()=>{
      tries++;
      const v = window.__LM_SHEET_ID || window.__LM_SPREADSHEET_ID || null;
      if (v) { clearInterval(t); publish(v); }
      if (tries > 200) { clearInterval(t); /* give up quietly */ }
    }, 250);
  }

  window.LM_SheetRename = { autodetectAndPublish, publish };
})();

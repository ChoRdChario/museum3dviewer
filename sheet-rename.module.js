/* sheet-rename.module.js — detect spreadsheetId and publish once */
(function(){
  let published = false;
  function detectFromLocation(){
    try{
      const u = new URL(location.href);
      const keys = ["spreadsheetId","pinsId","sheetId","materialsId"];
      for (const k of keys){ const v=u.searchParams.get(k); if (v && /^[A-Za-z0-9_\-]{20,}$/.test(v)) return v; }
    }catch(_){}
    return null;
  }
  function publish(id){
    if (published || !id) return;
    published = true;
    console.log("[materials] spreadsheetId:", id);
    window.dispatchEvent(new CustomEvent("materials:spreadsheetId", {detail:{id}}));
  }
  function autodetectAndPublish(){
    if (published) return;
    const id = detectFromLocation();
    if (id) return publish(id);
    let n=0, t=setInterval(()=>{
      n++;
      const v = window.__LM_SHEET_ID || window.__LM_SPREADSHEET_ID || null;
      if (v){ clearInterval(t); publish(v); }
      if (n>200){ clearInterval(t); }
    }, 250);
  }
  window.LM_SheetRename = { autodetectAndPublish, publish };
})();

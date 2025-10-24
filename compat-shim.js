// compat-shim.js
// Keep existing UI calls working by providing expected functions.
// We translate them to Data-layer operations. Non-destructive.

(async function(){
  // wait for Auth & Data
  function ready(){ return window.Auth && window.Data; }
  await new Promise((res)=>{
    if (ready()) return res();
    const t = setInterval(()=>{ if (ready()) { clearInterval(t); res(); } }, 50);
  });

  // Initialize Data using current GLB id (guessed)
  try {
    await window.Data.init({});
    console.log('[compat] Data.init complete: spreadsheet=', window.Data.getSpreadsheetId());
  } catch(e){
    console.warn('[compat] Data.init skipped', e);
  }

  // Provide functions that boot.esm.cdn.js expects to exist.
  // 1) findOrCreateLociMyuSpreadsheet
  window.findOrCreateLociMyuSpreadsheet = async function(parentFolderId, token, opts) {
    // Our Data.init already resolved spreadsheet; return it.
    if (!window.Data.getSpreadsheetId()) await window.Data.init({});
    return window.Data.getSpreadsheetId();
  };

  // 2) isLociMyuSpreadsheet
  window.isLociMyuSpreadsheet = async function(ssid){
    try {
      const r = await Auth.fetchJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent("'materials'!A1:K1")}`
      );
      return Array.isArray(r.values);
    } catch {
      return false;
    }
  };

  // 3) appendValues / putValues used by caption & materials
  // Detect target sheet from range. Route to Data-layer.
  window.appendValues = async function(spreadsheetId, rangeA1, values) {
    const rg = (rangeA1||'').toLowerCase();
    if (rg.includes('pins')) {
      return window.Data.appendPins(Array.isArray(values?.[0]) ? values : [values]);
    }
    if (rg.includes('materials')) {
      return window.Data.updateMaterialsRow(Array.isArray(values?.[0]) ? values[0] : values);
    }
    // default: route to pins
    return window.Data.appendPins(Array.isArray(values?.[0]) ? values : [values]);
  };

  window.putValues = async function(spreadsheetId, rangeA1, values) {
    // For now, treat put as append, because UI primarily appends new rows.
    return window.appendValues(spreadsheetId, rangeA1, values);
  };

  // 4) images grid helper for UI: refreshImagesGrid() reads Drive folder
  window.refreshImagesGrid = async function(){
    try {
      const list = await window.Data.listImages();
      document.dispatchEvent(new CustomEvent('lm:images:list', { detail: { files:list } }));
      console.log('[compat] images listed:', list.length);
      return list;
    } catch(e){
      console.warn('[compat] images list failed', e);
      return [];
    }
  };

  console.log('[compat] shim installed');
})();
// materials.sheet.persist.js
// [mat-sheet-persist v1.6] __LM_MATERIALS upsert with sheetGid column (N).

(function(){
  const TAG = "[mat-sheet-persist v1.6]";
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  let CTX = null;
  function setCtx(ctx){
    CTX = ctx || CTX;
    if (CTX) log("ctx set", CTX);
  }

  window.addEventListener("lm:sheet-context", (e)=> setCtx((e && e.detail) || {}), true);

  async function fetchJSONAuth(url, init){
    if (typeof window.__lm_fetchJSONAuth !== "function") {
      throw new Error("__lm_fetchJSONAuth missing");
    }
    return window.__lm_fetchJSONAuth(url, init || {});
  }

  async function ensureSheetAndHeaders(){
    if (!CTX || !CTX.spreadsheetId) throw new Error("no spreadsheetId in __LM_SHEET_CTX");
    const sheetId = CTX.spreadsheetId;
    try {
      const meta = await fetchJSONAuth("https://sheets.googleapis.com/v4/spreadsheets/"+sheetId);
      const titles = (meta.sheets||[]).map(s=>s.properties.title);
      if (!titles.includes("__LM_MATERIALS")){
        await fetchJSONAuth("https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+":batchUpdate", {
          method: "POST",
          body: { requests: [{ addSheet: { properties: { title: "__LM_MATERIALS" } } }] }
        });
        log("created __LM_MATERIALS");
      }
    } catch(e){ warn("sheet ensure warn", e); }

    const headers = [
      "materialKey","opacity","doubleSided","unlitLike",
      "chromaEnable","chromaColor","chromaTolerance","chromaFeather",
      "roughness","metalness","emissiveHex","updatedAt","updatedBy","sheetGid"
    ];
    await fetchJSONAuth(
      "https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+encodeURIComponent("__LM_MATERIALS!A1:N1")+"?valueInputOption=RAW",
      { method:"PUT", body:{ values:[headers] } }
    );
    log("headers ensured A:N");
  }

  async function upsert(rec){
    if (window.__LM_MAT_PERSIST_GUARD__ && window.__LM_MAT_PERSIST_GUARD__()) return;

    if (!CTX || !CTX.spreadsheetId) throw new Error("no spreadsheetId in __LM_SHEET_CTX");
    const sheetId = CTX.spreadsheetId;
    const sheetGid = String(CTX.sheetGid || "");

    await ensureSheetAndHeaders();

    const key = rec.materialKey;
    if (!key) throw new Error("materialKey required");

    const rngA = encodeURIComponent("__LM_MATERIALS!A:N");
    const grid = await fetchJSONAuth("https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+rngA);
    const rows = (grid && grid.values) || [];
    const hdr = rows[0] || [];
    const idx = (name)=>hdr.indexOf(name);
    const iKey = idx("materialKey");
    const iG  = idx("sheetGid");

    let rowNumber = null;
    for (let r=1;r<rows.length;r++){
      const v = rows[r] || [];
      if (((v[iKey]||"")===key) && (String(v[iG]||"")===sheetGid)) { rowNumber = r+1; break; }
    }
    if (!rowNumber) {
      rowNumber = rows.length + 1;
      await fetchJSONAuth(
        "https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+encodeURIComponent("__LM_MATERIALS!A"+rowNumber+":A"+rowNumber)+"?valueInputOption=RAW",
        { method:"PUT", body:{ values:[[key]] } }
      );
      await fetchJSONAuth(
        "https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+encodeURIComponent("__LM_MATERIALS!N"+rowNumber+":N"+rowNumber)+"?valueInputOption=RAW",
        { method:"PUT", body:{ values:[[sheetGid]] } }
      );
      log("append row", rowNumber, key, sheetGid);
    } else {
      log("found row", rowNumber, key, sheetGid);
    }

    const iso = new Date().toISOString();
    const v = [
      rec.opacity ?? "",
      rec.doubleSided ? "TRUE" : "FALSE",
      rec.unlitLike  ? "TRUE" : "FALSE",
      rec.chromaEnable ? "TRUE" : "FALSE",
      rec.chromaColor || "",
      String(rec.chromaTolerance ?? ""),
      String(rec.chromaFeather ?? ""),
      String(rec.roughness ?? ""),
      String(rec.metalness ?? ""),
      rec.emissiveHex || "",
      iso,
      rec.updatedBy || "mat-ui"
    ]; // B..M
    const rangeBM = "__LM_MATERIALS!B"+rowNumber+":M"+rowNumber;
    await fetchJSONAuth(
      "https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+encodeURIComponent(rangeBM)+"?valueInputOption=RAW",
      { method:"PUT", body:{ values:[v] } }
    );
    log("persisted", {rowNumber, key, sheetGid});
  }

  window.__LM_MATERIALS_PERSIST__ = {
    setCtx,
    upsert,
    ensureSheetAndHeaders
  };

  log("loaded");
})();
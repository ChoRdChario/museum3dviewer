// [mat-sheet-persist v1.4+sgid] single-file, global API (backward compatible)
// Exposes: window.LM_MaterialsPersist = { setCtx(spreadsheetId, sheetGid), ensureHeaders(), upsert(payload) }
// New: adds column N: sheetGid (optional) and internally uses __LM_SHEET_CTX if not provided.
// Safe to include multiple times; guards re-definition.

(function(){
  if (window.LM_MaterialsPersist && window.LM_MaterialsPersist.__ver && window.LM_MaterialsPersist.__ver.startsWith("1.4+sgid")) {
    console.log("[mat-sheet-persist v1.4+sgid] already defined; skipping reinit");
    return;
  }

  const state = {
    spreadsheetId: null,
    sheetGid: 0,
  };

  function assertAuthShim() {
    if (typeof window.__lm_fetchJSONAuth !== "function") throw new Error("__lm_fetchJSONAuth missing");
  }

  function resolveCtx() {
    const ctx = window.__LM_SHEET_CTX || {};
    state.spreadsheetId = state.spreadsheetId || ctx.spreadsheetId || null;
    state.sheetGid      = state.sheetGid ?? (ctx.sheetGid ?? 0);
    if (!state.spreadsheetId) throw new Error("no spreadsheetId (call setCtx or wait for __LM_SHEET_CTX)");
  }

  async function ensureHeaders() {
    assertAuthShim();
    resolveCtx();

    // Ensure sheet exists
    try {
      const meta = await __lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}`);
      const titles = (meta.sheets||[]).map(s=>s.properties.title);
      if (!titles.includes("__LM_MATERIALS")) {
        await __lm_fetchJSONAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}:batchUpdate`,
          { method:"POST", body:{ requests:[{ addSheet:{ properties:{ title:"__LM_MATERIALS" } } }] } }
        );
        console.log("[persist] created __LM_MATERIALS");
      }
    } catch(e) {
      console.warn("[persist] meta/ensure sheet failed (may already exist)", e);
    }

    // Ensure headers A:M (legacy) + N:sheetGid (new)
    const headers = [
      "materialKey","opacity","doubleSided","unlitLike",
      "chromaEnable","chromaColor","chromaTolerance","chromaFeather",
      "roughness","metalness","emissiveHex","updatedAt","updatedBy","sheetGid" // N
    ];
    const range = encodeURIComponent("__LM_MATERIALS!A1:N1");
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method:"PUT", body:{ values:[headers] } }
    );
    console.log("[persist] headers ensured A:N");
  }

  async function upsert(payload) {
    assertAuthShim();
    resolveCtx();
    await ensureHeaders();

    const {
      materialKey,
      opacity,
      doubleSided=false,
      unlitLike=false,
      chromaEnable=false,
      chromaColor="#000000",
      chromaTolerance=0,
      chromaFeather=0,
      roughness="",
      metalness="",
      emissiveHex="",
      updatedBy="mat-ui",
      sheetGid, // optional; default to ctx
    } = payload || {};

    if (!materialKey) throw new Error("materialKey required");
    const sgid = (sheetGid ?? state.sheetGid ?? 0);

    // Read A:N to locate row by (key, sheetGid) or fallback (key, sheetGid empty)
    const whole = await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent("__LM_MATERIALS!A:N")}`
    );
    const rows = whole.values || []; // [[hdr],[A..N]...]
    let matchRow = -1
    let fallbackRow = -1
    for (let i=1; i<rows.length; i++) {
      const r = rows[i] || [];
      const key = r[0]||"";
      const n = (r[13]||""); // N:sheetGid (0-based index 13)
      if (key === materialKey) {
        if (String(n) === String(sgid)) { matchRow = i+1; break; }
        if (n==="" && fallbackRow<0) fallbackRow = i+1;
      }
    }
    let rowNumber;
    if (matchRow > 0) {
      rowNumber = matchRow;
    } else if (fallbackRow > 0) {
      rowNumber = fallbackRow;
    } else {
      // append new row with A=key, N=sheetGid
      rowNumber = rows.length + 1;
      await __lm_fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(`__LM_MATERIALS!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
        { method:"PUT", body:{ values:[[materialKey]] } }
      );
    }

    const iso = new Date().toISOString();
    const bm = [
      opacity ?? "",
      (doubleSided ? "TRUE":"FALSE"),
      (unlitLike ? "TRUE":"FALSE"),
      (chromaEnable ? "TRUE":"FALSE"),
      chromaColor || "",
      String(chromaTolerance ?? ""),
      String(chromaFeather ?? ""),
      String(roughness ?? ""),
      String(metalness ?? ""),
      emissiveHex || "",
      iso,
      updatedBy
    ];
    // Write B..M
    const rangeBM = encodeURIComponent(`__LM_MATERIALS!B${rowNumber}:M${rowNumber}`);
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${rangeBM}?valueInputOption=RAW`,
      { method:"PUT", body:{ values:[bm] } }
    );
    // Ensure N=sheetGid (even when fallback used)
    const rangeN = encodeURIComponent(`__LM_MATERIALS!N${rowNumber}:N${rowNumber}`);
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${rangeN}?valueInputOption=RAW`,
      { method:"PUT", body:{ values:[[String(sgid)]] } }
    );

    console.log("[persist] wrote", { rowNumber, materialKey, sheetGid: sgid, values: bm });
  }

  function setCtx(spreadsheetId, sheetGid){
    state.spreadsheetId = spreadsheetId || state.spreadsheetId;
    state.sheetGid = (sheetGid ?? state.sheetGid ?? 0);
    console.log("[mat-sheet-persist v1.4+sgid] ctx set", { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });
  }

  window.LM_MaterialsPersist = {
    __ver: "1.4+sgid-" + (new Date()).toISOString().slice(0,10),
    setCtx, ensureHeaders, upsert,
  };

  // Auto-bind when lm:sheet-context arrives
  window.addEventListener("lm:sheet-context", (e)=>{
    const d = (e && e.detail) || {};
    try { setCtx(d.spreadsheetId, d.sheetGid); } catch(_){}
  });

  console.log("[mat-sheet-persist v1.4+sgid] loaded & exposed API");
})();

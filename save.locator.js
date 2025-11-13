// save.locator.js  — patched 2025-11-13 (JST)
// Goals:
//  - Fix prior SyntaxError: "Illegal return statement" caused by stray return outside a function
//  - Keep Captions sheet from being auto-created (return null if absent)
//  - Maintain existing console tags to avoid breaking log-based diagnostics
//  - Dispatch lm:sheet-context consistently
//
// External expectations (from other modules):
//  - window.postLoadEnsureSaveSheet({glbId, glbName}) is callable and resolves context
//  - __lm_fetchJSONAuth(token-aware) exists
//  - window.LM_SHEET_GIDMAP (optional) for fast gid/title resolution

(function(){
  const TAG = "[save.locator]";

  async function fetchSpreadsheetSheets(spreadsheetId){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;
    return await __lm_fetchJSONAuth(url);
  }

  async function resolveTitleToGid(spreadsheetId, title){
    // Prefer gid-map if available
    try {
      if (window.LM_SHEET_GIDMAP){
        const gid = await window.LM_SHEET_GIDMAP.resolveTitleToGid(spreadsheetId, title);
        if (gid != null) return gid;
      }
    } catch(e){
      console.warn(TAG, "gidmap resolveTitleToGid failed (non fatal)", e);
    }
    // Fallback: list sheets
    try {
      const meta = await fetchSpreadsheetSheets(spreadsheetId);
      const sheets = (meta && meta.sheets) || [];
      const hit = sheets.find(s => s.properties && s.properties.title === title);
      if (hit && hit.properties && typeof hit.properties.sheetId === "number"){
        return hit.properties.sheetId;
      }
    } catch(e){
      console.warn(TAG, "list sheets failed (non fatal)", e);
    }
    return null;
  }

  async function ensureMaterialsHeader(spreadsheetId, materialsTitle="__LM_MATERIALS"){
    // Header is created via values.update (PUT), never via append.
    const headerRange = `${materialsTitle}!A1:K1`;
    const header = [
      "KEY","targetMaterial","opacity","doubleSided","unlitLike",
      "chromaKeyEnabled","chromaKeyColor","#RRGGBB","chromaTolerance","feather","updatedAt"
    ];
    const gid = await resolveTitleToGid(spreadsheetId, materialsTitle);
    if (gid == null){
      // Do NOT auto-create the sheet here; the repo’s creation flow handles it elsewhere.
      console.log(TAG, "materials sheet missing; skip create (flow-owned)");
      return null;
    }
    // Read current header (light-touch; ignore errors)
    try {
      const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(headerRange)}?majorDimension=ROWS`;
      const cur = await __lm_fetchJSONAuth(getUrl);
      const hasHeader = Array.isArray(cur && cur.values) && cur.values.length > 0;
      if (hasHeader){
        console.log("[materials] ensure header -> SKIP (ready)");
        return gid;
      }
    } catch(e){/* proceed to set header */}

    try {
      const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`;
      const body = { range: headerRange, majorDimension: "ROWS", values: [header] };
      await __lm_fetchJSONAuth(putUrl, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
      console.log("[materials] header present -> SET");
    } catch(e){
      console.warn(TAG, "header set failed (non fatal)", e);
    }
    return gid;
  }

  // Captions: never auto-create here; only resolve existing
  async function ensureDefaultCaptionSheet(spreadsheetId){
    const title = "Captions";
    const gid = await resolveTitleToGid(spreadsheetId, title);
    if (gid != null) return gid;
    console.log(TAG, "no existing 'Captions' sheet; skip auto-create");
    return null;
  }

  // Core entry (compatible with existing callers)
  async function postLoadEnsureSaveSheet(params={}){
    try{
      const { glbId=null, glbName="GLB" } = params || {};
      console.log(TAG, "begin", { glbId, glbName });

      // The spreadsheet creation/selection logic is owned elsewhere in the app.
      // Here we expect window.__lm_ctx.spreadsheetId to be set by that flow.
      // If not present, we bail out (non-fatal) so that upstream can retry.
      const sid = window.__lm_ctx && window.__lm_ctx.spreadsheetId;
      if (!sid){
        throw new Error("spreadsheetId not available in __lm_ctx (upstream not finished yet)");
      }

      const materialsGid = await ensureMaterialsHeader(sid, "__LM_MATERIALS");
      const defaultCaptionGid = await ensureDefaultCaptionSheet(sid);

      // Expose on window and notify listeners
      window.__lm_ctx = Object.assign(window.__lm_ctx || {}, {
        spreadsheetId: sid,
        materialsGid: materialsGid,
        defaultCaptionGid: defaultCaptionGid ?? null
      });

      // Back-compat event (some listeners expect sheetGid for captions)
      document.dispatchEvent(new CustomEvent("lm:sheet-context", {
        detail: {
          spreadsheetId: sid,
          materialsGid: materialsGid,
          sheetGid: defaultCaptionGid ?? null,
          defaultCaptionGid: defaultCaptionGid ?? null
        }
      }));

      console.log(TAG, "ready", {
        spreadsheetId: sid,
        materialsGid,
        defaultCaptionGid
      });
      return window.__lm_ctx;

    }catch(err){
      console.error(TAG, "postLoadEnsureSaveSheet failed", err);
      throw err;
    }
  }

  // Public
  window.postLoadEnsureSaveSheet = postLoadEnsureSaveSheet;
  window.__LM_SAVE_LOCATOR__ = { postLoadEnsureSaveSheet };

})();

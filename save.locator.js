// save.locator.js — compat+shim edition (2025-11-13)
// - Fixes previous "Illegal return statement" by using IIFE
// - Adds window.loc.findOrCreateSaveSheetByGlbId() wrapper expected by glb.btn.bridge.v3.js
// - Keeps postLoadEnsureSaveSheet() for newer callers
// - Does NOT auto-create Captions sheets; only resolves existing ones
// - Emits "lm:sheet-context" event upon success

(function(){
  const LOG = (...a)=>console.log("[save.locator]", ...a);
  const WARN = (...a)=>console.warn("[save.locator]", ...a);
  const ERR  = (...a)=>console.error("[save.locator]", ...a);

  // Shared ctx helper
  function setCtx(ctx){
    if (!ctx) return;
    const { spreadsheetId, materialsGid, defaultCaptionGid=null, sheetGid } = ctx;
    if (!spreadsheetId) return;
    // stash to window
    window.__lm_ctx = Object.assign(window.__lm_ctx || {}, { spreadsheetId, materialsGid, defaultCaptionGid });
    // dispatch for listeners (both old/new shapes supported)
    const detail = { spreadsheetId, materialsGid, defaultCaptionGid };
    if (sheetGid != null) detail.sheetGid = sheetGid;
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail }));
  }

  // Legacy upstream creator (if any) → this function should do the real work
  async function _delegateEnsure(opts){
    // Prefer new API name first
    if (typeof window.postLoadEnsureSaveSheet === "function"){
      return await window.postLoadEnsureSaveSheet(opts);
    }
    // Fallback legacy namespace (if project defines it somewhere)
    if (window.LM_SAVE_LOCATOR && typeof window.LM_SAVE_LOCATOR.postLoadEnsureSaveSheet === "function"){
      return await window.LM_SAVE_LOCATOR.postLoadEnsureSaveSheet(opts);
    }
    // If nothing exists, bail with explicit message
    throw new Error("save.locator shim: upstream creator not found (postLoadEnsureSaveSheet missing)");
  }

  // Public API (new): do not break callers that already migrated
  async function postLoadEnsureSaveSheet({ glbId, glbName }){
    LOG("begin", { glbId, glbName });
    // If context already set, re-emit and exit
    if (window.__lm_ctx && window.__lm_ctx.spreadsheetId && window.__lm_ctx.materialsGid != null){
      LOG("ready (reuse ctx)", window.__lm_ctx);
      setCtx(window.__lm_ctx);
      return window.__lm_ctx;
    }

    // Delegate to upstream implementation (creates or finds, sets headers, etc.)
    const result = await _delegateEnsure({ glbId, glbName });

    // Normalize result shape and emit
    let ctx = null;
    if (result && typeof result === "object"){
      // Try common property names
      const spreadsheetId     = result.spreadsheetId || result.sid || result.id;
      const materialsGid      = result.materialsGid  ?? result.mgid  ?? null;
      const defaultCaptionGid = result.defaultCaptionGid ?? result.captionGid ?? null;
      const sheetGid          = result.sheetGid ?? null;
      ctx = { spreadsheetId, materialsGid, defaultCaptionGid, sheetGid };
    }
    if (!ctx || !ctx.spreadsheetId){
      throw new Error("save.locator: upstream did not return a valid context");
    }

    LOG("ready", ctx);
    setCtx(ctx);
    return ctx;
  }

  // Public API (legacy expected by glb.btn.bridge.v3.js)
  async function findOrCreateSaveSheetByGlbId(glbId, glbName){
    // Reuse new API so there is only one code path
    const ctx = await postLoadEnsureSaveSheet({ glbId, glbName });
    return ctx.spreadsheetId;
  }

  // Expose both shapes
  window.postLoadEnsureSaveSheet = postLoadEnsureSaveSheet;
  // Provide a simple namespace that older code expects
  window.loc = Object.assign(window.loc || {}, { findOrCreateSaveSheetByGlbId });

})();

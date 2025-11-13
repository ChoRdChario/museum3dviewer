// glb.btn.bridge.v3.js — safe caller patch (2025-11-13)
// Wrap the call site to support both legacy(window.loc.findOrCreateSaveSheetByGlbId)
// and new(window.postLoadEnsureSaveSheet) entry points without throwing.

(function(){
  const LOG = (...a)=>console.log("[glb-bridge-v3]", ...a);
  const ERR = (...a)=>console.error("[glb-bridge-v3]", ...a);

  // Guard against multiple injection
  if (window.__LM_GLB_BRIDGE_SAFE_PATCH_APPLIED) return;
  window.__LM_GLB_BRIDGE_SAFE_PATCH_APPLIED = true;

  // Patch helper
  async function postLoadEnsureSaveSheetSafe({ glbId, glbName }){
    try{
      if (window.loc && typeof window.loc.findOrCreateSaveSheetByGlbId === "function"){
        return await window.loc.findOrCreateSaveSheetByGlbId(glbId, glbName);
      }
      if (typeof window.postLoadEnsureSaveSheet === "function"){
        const ctx = await window.postLoadEnsureSaveSheet({ glbId, glbName });
        return (ctx && ctx.spreadsheetId) || null;
      }
      // Last resort: no-op with a single line log
      console.warn("[glb-bridge-v3] save-locator not available; skipping ensure");
      return null;
    }catch(e){
      ERR("postLoadEnsureSaveSheet failed", e);
      return null;
    }
  }

  // Export a tiny facade that existing code can call instead of the raw function
  window.__LM_postLoadEnsureSaveSheetSafe = postLoadEnsureSaveSheetSafe;
})();

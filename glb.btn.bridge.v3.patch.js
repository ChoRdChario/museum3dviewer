
// glb.btn.bridge.v3.patch.js
// A small glue script that reliably triggers save sheet creation right after a GLB loads.
(function(){
  const log = (...a)=>console.log("[glb-bridge-patch]", ...a);
  const warn = (...a)=>console.warn("[glb-bridge-patch]", ...a);

  async function postLoadEnsureSaveSheet(fileId, meta={}) {
    try {
      // capture current file id/name for downstream
      if (window.__LM_SAVE_LOCATOR && typeof window.__LM_SAVE_LOCATOR.installGlbIdCaptureShim === "function") {
        window.__LM_SAVE_LOCATOR.installGlbIdCaptureShim();
      }
      const name = meta && (meta.name || meta.fileName || meta.title);
      if (fileId) window.__LM_CURRENT_GLB_ID = fileId;
      if (name) window.__LM_CURRENT_GLB_NAME = name;

      if (!window.__LM_SAVE_LOCATOR || !window.__LM_SAVE_LOCATOR.findOrCreateSaveSheetByGlbId) {
        warn("save locator not ready; retrying soon...");
        await new Promise(r=>setTimeout(r, 150));
      }
      if (!window.__LM_SAVE_LOCATOR || !window.__LM_SAVE_LOCATOR.findOrCreateSaveSheetByGlbId) {
        throw new Error("save locator missing");
      }
      const { findOrCreateSaveSheetByGlbId } = window.__LM_SAVE_LOCATOR;
      const result = await findOrCreateSaveSheetByGlbId({ glbId: fileId, glbName: name });
      log("save sheet ready", result);
      return result;
    } catch (e) {
      console.error("[glb-bridge-patch] postLoadEnsureSaveSheet failed", e);
      throw e;
    }
  }

  // Make it globally available so glb.btn.bridge.v3.js can call it.
  window.__lm_postLoadEnsureSaveSheet = postLoadEnsureSaveSheet;
})();

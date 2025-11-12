/*! materials.ensure.js — __LM_MATERIALS header one-time ensure (no-module/UMD) */
(function(){
  window.ensureMaterialsHeader = async function(spreadsheetId){
    if (typeof window.__lm_ensureMaterialsHeader !== "function") {
      throw new Error("[materials.ensure] boot not loaded");
    }
    return window.__lm_ensureMaterialsHeader(spreadsheetId);
  };
})();
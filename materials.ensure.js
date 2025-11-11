/*! materials.ensure.js — __LM_MATERIALS header one-time ensure (no-module/UMD)
 * Fix: removes ES module `export` and attaches API to `window` for classic <script> usage.
 * VERSION_TAG:V6_12_FOUNDATION_AUTH_CTX_MAT_HDR
 */
(function(){
  window.ensureMaterialsHeader = async function(spreadsheetId){
    if (typeof window.__lm_ensureMaterialsHeader !== "function") {
      throw new Error("[materials.ensure] boot not loaded");
    }
    return window.__lm_ensureMaterialsHeader(spreadsheetId);
  };
})();
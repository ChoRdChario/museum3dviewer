/*! materials.ensure.js — __LM_MATERIALS header one-time ensure
 * VERSION_TAG:V6_12_FOUNDATION_AUTH_CTX_MAT_HDR
 */
export async function ensureMaterialsHeader(spreadsheetId) {
  if (typeof window.__lm_ensureMaterialsHeader !== "function") {
    throw new Error("[materials.ensure] boot not loaded");
  }
  await window.__lm_ensureMaterialsHeader(spreadsheetId);
}

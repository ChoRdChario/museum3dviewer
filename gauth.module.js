/*! gauth.module.js — LociMyu auth facade
 * VERSION_TAG:V6_12_FOUNDATION_AUTH_CTX_MAT_HDR
 * Provides: getAccessToken() as a stable facade around __lm_getAccessToken()
 */
export async function getAccessToken() {
  if (typeof window.__lm_getAccessToken !== "function") {
    throw new Error("[gauth] __lm_getAccessToken not found. Ensure boot.esm.cdn.js is loaded first.");
  }
  const tok = await window.__lm_getAccessToken();
  console.log("[gauth] token?", !!tok, (tok||"").slice(0,12)+"...");
  return tok;
}

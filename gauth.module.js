/*! gauth.module.js — facade */
export async function getAccessToken(){
  if (typeof window.__lm_getAccessToken !== "function") {
    throw new Error("[gauth] __lm_getAccessToken not found. Ensure boot.esm.cdn.js is loaded first.");
  }
  const tok = await window.__lm_getAccessToken();
  console.log("[gauth] token?", !!tok, (tok||"").slice(0,12)+"...");
  return tok;
}

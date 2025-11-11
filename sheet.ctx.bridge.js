/*! sheet.ctx.bridge.js — gid-based context bridge
 * VERSION_TAG:V6_12_FOUNDATION_AUTH_CTX_MAT_HDR
 */
export function startSheetContextPolling(getter, opt) {
  if (!window.sheetCtxBridge) throw new Error("[sheet-ctx] boot not loaded");
  window.sheetCtxBridge.start(getter, opt);
}
export function stopSheetContextPolling() {
  if (!window.sheetCtxBridge) return;
  window.sheetCtxBridge.stop();
}

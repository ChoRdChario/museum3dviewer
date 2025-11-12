/**
 * save.locator.js (hardened)
 * - Keeps original API: findOrCreateSaveSheetByGlbId(glbId, glbName)
 * - Adds tolerant fallback reading window.__LM_CURRENT_GLB_ID if glbId is falsy
 * - Logs with "[save.locator]" as in user logs
 */

const log = (...a) => console.log('[save.locator]', ...a);
const err = (...a) => console.error('[save.locator]', ...a);

log('module loaded (ESM export active)');

async function findOrCreateSaveSheetByGlbId(glbId, glbName) {
  const id = glbId || (typeof window !== 'undefined' ? window.__LM_CURRENT_GLB_ID : null);
  if (!id) {
    // keep message identical to observed error to ease diffing
    throw new Error('glbId is required (no argument and no captured __LM_CURRENT_GLB_ID)');
  }

  // ---- PLACEHOLDER: keep original implementation here ----
  // This shim keeps compatibility: call through to original impl if present.
  // If project already defines a real function, we defer to it.
  if (typeof globalThis.__lm_orig_findOrCreateSaveSheetByGlbId === 'function') {
    return await globalThis.__lm_orig_findOrCreateSaveSheetByGlbId(id, glbName);
  }

  // Minimal no-op skeleton to avoid crash if wired alone (should be replaced by real logic in repo).
  log('begin', { glbId: id, glbName });
  // The real implementation should:
  // 1) Find Drive parent folder of this GLB
  // 2) Search for a Spreadsheet named according to your convention
  // 3) If not found, create it
  // 4) Ensure __LM_MATERIALS sheet exists with header-only
  // 5) Return context { spreadsheetId, materialsSheetGid/title, captionSheetTitle }
  return { ok: true, glbId: id };
}

export { findOrCreateSaveSheetByGlbId };
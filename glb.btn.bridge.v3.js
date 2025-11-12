/**
 * glb.btn.bridge.v3.js (patched)
 * - Ensures __LM_CURRENT_GLB_ID is set on GLB load
 * - Passes glbId explicitly to save.locator.findOrCreateSaveSheetByGlbId()
 * - Keeps existing log signatures: "[glb-bridge-v3] ..."
 */

// Top-level await is used intentionally; this file must be loaded with type="module".
const log = (...a) => console.log('[glb-bridge-v3]', ...a);
const err = (...a) => console.error('[glb-bridge-v3]', ...a);

// Try to import viewer/module and save locator lazily.
const viewer = await import('./viewer.module.cdn.js').catch(e => {
  err('failed to import viewer.module.cdn.js', e);
  throw e;
});
const save = await import('./save.locator.js').catch(e => {
  err('failed to import save.locator.js', e);
  throw e;
});

function setCurrentGlbId(glbId) {
  try {
    // store to global (for other modules) and via viewer export (if exists)
    window.__LM_CURRENT_GLB_ID = glbId;
    if (typeof viewer.setCurrentGlbId === 'function') {
      viewer.setCurrentGlbId(glbId);
    }
  } catch (e) {
    err('setCurrentGlbId failed', e);
  }
}

async function postLoadEnsureSaveSheet(glbId, glbName) {
  try {
    if (!glbId) {
      // final fallback to global (older modules may rely on this)
      glbId = window.__LM_CURRENT_GLB_ID;
    }
    if (!glbId) {
      throw new Error('glbId is required (no argument and no captured __LM_CURRENT_GLB_ID)');
    }
    await save.findOrCreateSaveSheetByGlbId(glbId, glbName);
  } catch (e) {
    err('postLoadEnsureSaveSheet failed', e);
    throw e;
  }
}

function resolveGlbInput() {
  // Accept both Drive picker path and manual input (existing behavior kept as best-effort)
  const el = document.querySelector('#glbUrl') || document.querySelector('input[type="text"][data-glb]');
  if (!el) return null;
  const v = (el.value || '').trim();
  if (!v) return null;

  // Heuristic: Drive file id is 28~44 chars with - and _
  const m = v.match(/[-\w]{20,}/);
  return m ? m[0] : v;
}

async function loadById(glbId) {
  try {
    if (!glbId) throw new Error('missing glbId');
    log('load fileId', glbId);
    // Ensure viewer exists
    const canvas = document.querySelector('canvas#gl') || document.querySelector('canvas');
    log('calling ensureViewer with canvas', canvas ? canvas.id || 'gl' : '(none)');
    await viewer.ensureViewer(canvas);

    // Load the GLB from Drive
    await viewer.loadGlbFromDrive(glbId);

    // Record current GLB id for downstream modules
    setCurrentGlbId(glbId);

    // Trigger save-sheet discovery/creation explicitly with the id
    await postLoadEnsureSaveSheet(glbId);
  } catch (e) {
    err('loadById failed', e);
  }
}

(function wire() {
  const btn = document.querySelector('#btnGlb') || document.querySelector('button#btnGlb');
  if (!btn) {
    return err('GLB button not found (#btnGlb)');
  }
  log('button wired v3');
  btn.addEventListener('click', async (ev) => {
    try {
      log('event listener armed');
      let glbId = resolveGlbInput();
      // Allow a custom data attribute for direct fileId binding (optional)
      if (!glbId && btn.dataset && btn.dataset.fileId) glbId = btn.dataset.fileId;
      await loadById(glbId);
    } catch (e) {
      err('btn.click failed', e);
    }
  }, { passive: true });
})();

export { loadById, postLoadEnsureSaveSheet };
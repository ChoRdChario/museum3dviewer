// persist.guard.js
// Blocks persistence (write HTTP methods) when in view mode.
// Used by auth.fetch.bridge.js and auth.fetch.shim.js.

const WRITE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);

function isViewModeSafe() {
  try {
    if (window.__LM_IS_VIEW_MODE === true) return true;
    if (typeof window.isViewMode === 'function') return !!window.isViewMode();
  } catch(_) {}
  return false;
}

function normMethod(m) {
  return String(m || 'GET').toUpperCase();
}

export function shouldBlock(method) {
  return isViewModeSafe() && WRITE_METHODS.has(normMethod(method));
}

export function assertAllowed(method, url) {
  if (!shouldBlock(method)) return;
  const m = normMethod(method);
  const u = String(url || '');
  const err = new Error(`[persist.guard] blocked write in view mode: ${m} ${u}`);
  try {
    window.dispatchEvent(new CustomEvent('lm:persist-blocked', { detail: { method: m, url: u } }));
  } catch(_) {}
  throw err;
}

// Expose for non-module callers
window.__lm_persistGuard = { shouldBlock, assertAllowed };

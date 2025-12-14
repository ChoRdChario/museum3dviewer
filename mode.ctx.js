// mode.ctx.js
// URL-driven app mode/context (minimal, globally accessible)
// - mode=view : view-only experience (no persistence)
// - glb=<Drive fileId>
//
// This module intentionally avoids importing other modules.

function _parseLinkContext(loc = window.location) {
  try {
    const u = new URL(String(loc.href));
    const sp = u.searchParams;
    const modeRaw = (sp.get('mode') || '').trim().toLowerCase();
    const mode = modeRaw || 'edit';
    const glbId = (sp.get('glb') || '').trim();
    return { mode, glbId };
  } catch (e) {
    // Extremely defensive: in case URL parsing fails.
    return { mode: 'edit', glbId: '' };
  }
}

let __LM_LINK_CTX = _parseLinkContext();

export function getLinkContext() {
  // Return a shallow copy to discourage accidental mutation.
  return { ...__LM_LINK_CTX };
}

export function isViewMode() {
  return String(__LM_LINK_CTX?.mode || '').toLowerCase() === 'view';
}

export function refreshLinkContext() {
  __LM_LINK_CTX = _parseLinkContext();
  window.__LM_LINK_CTX = { ...__LM_LINK_CTX };
  window.__LM_IS_VIEW_MODE = isViewMode();
  return getLinkContext();
}

// Expose globally for non-module scripts.
// NOTE: keep names stable to reduce future refactors.
window.__LM_LINK_CTX = { ...__LM_LINK_CTX };
window.__LM_IS_VIEW_MODE = isViewMode();
window.isViewMode = isViewMode;
window.getLinkContext = getLinkContext;
window.refreshLinkContext = refreshLinkContext;

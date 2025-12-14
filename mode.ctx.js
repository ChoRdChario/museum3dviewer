// mode.ctx.js
// Centralized URL context (mode=view etc.) for LociMyu.
// Exposes:
//   window.__LM_LINK_CTX = { mode, glbId }
//   window.__LM_IS_VIEW_MODE = boolean
//   window.isViewMode(), window.getLinkContext(), window.refreshLinkContext()

function parseLinkContext() {
  try {
    const u = new URL(window.location.href);
    const sp = u.searchParams;
    const mode = (sp.get('mode') || '').toLowerCase();
    const glbId = sp.get('glb') || sp.get('glbId') || '';
    return { mode, glbId };
  } catch (e) {
    return { mode: '', glbId: '' };
  }
}

function applyLinkContext(ctx) {
  window.__LM_LINK_CTX = ctx;
  window.__LM_IS_VIEW_MODE = ctx.mode === 'view';
}

export function refreshLinkContext() {
  const ctx = parseLinkContext();
  applyLinkContext(ctx);
  return ctx;
}

export function getLinkContext() {
  if (!window.__LM_LINK_CTX) refreshLinkContext();
  return window.__LM_LINK_CTX;
}

export function isViewMode() {
  const ctx = getLinkContext();
  return ctx.mode === 'view';
}

// Back-compat: attach helpers to window so non-module scripts can use them.
window.refreshLinkContext = refreshLinkContext;
window.getLinkContext = getLinkContext;
window.isViewMode = isViewMode;

// Init immediately.
refreshLinkContext();

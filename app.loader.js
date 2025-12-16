// LociMyu - app.loader.js
// New policy: Share safety is ensured by not loading write-capable modules.
// Guard is a safety net (Share-only) and should not be relied on for correctness.

(function(){
  const q = new URLSearchParams(location.search || '');
  const raw = (q.get('mode') || '').toLowerCase();
  const isShare = (raw === 'share' || raw === 'view');
  const mode = isShare ? 'share' : 'edit';

  // Public mode flags (kept intentionally simple)
  window.__LM_IS_SHARE_MODE = isShare;
  window.__LM_IS_VIEW_MODE  = isShare; // legacy alias
  window.__LM_IS_EDIT_MODE  = !isShare;

  window.__LM_MODE_CTX = Object.freeze({
    mode,
    rawMode: raw || '',
    isShare,
    isEdit: !isShare
  });

  window.__lm_isShareMode = function(){ return !!window.__LM_MODE_CTX && window.__LM_MODE_CTX.isShare === true; };
  window.__lm_isEditMode  = function(){ return !!window.__LM_MODE_CTX && window.__LM_MODE_CTX.isEdit === true; };
  window.__lm_getModeCtx  = function(){ return window.__LM_MODE_CTX; };

  // Simple diagnostics to verify "what got loaded"
  const diag = window.__LM_DIAG = window.__LM_DIAG || { loaded: [] };
  diag.mode = mode;
  diag.rawMode = raw || '';
  diag.startedAt = diag.startedAt || new Date().toISOString();
  function markLoaded(src){
    try { (window.__LM_DIAG.loaded || (window.__LM_DIAG.loaded=[])).push(src); } catch(_){}
  }

  const entry = isShare ? './app.share.entry.js' : './app.edit.entry.js';
  markLoaded(entry);

  import(entry).catch(err => {
    console.error('[lm-loader] failed to load entry:', entry, err);
    // Minimal user-visible hint
    try {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;padding:12px;border:1px solid #a33;border-radius:10px;background:#1b1111;color:#f2d6d6;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;z-index:99999';
      el.textContent = 'Failed to start the app entry. Open DevTools Console for details.';
      document.body.appendChild(el);
    } catch(_){}
  });
})(); 

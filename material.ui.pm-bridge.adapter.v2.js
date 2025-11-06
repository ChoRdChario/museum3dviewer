// material.ui.pm-bridge.adapter.v2.js
// Bridge Gemini-reported native IDs to orchestrator expectations by *renaming IDs* safely.
// - #pm-material        -> id="materialSelect" (data-orig-id preserved)
// - #pm-opacity-range   -> id="opacityRange"   (data-orig-id preserved)
// Also removes any previous auto panels and triggers a rebind.
// Safe to include once; no external deps.

(function(){
  const NS='[pm-bridge v2]';
  if (window.__lm_pm_bridge_v2) return;
  window.__lm_pm_bridge_v2 = true;
  const log=(...a)=>console.log(NS, ...a);
  const warn=(...a)=>console.warn(NS, ...a);

  function renameId(el, targetId){
    if (!el) return false;
    try{
      if (el.id === targetId) return true;
      el.setAttribute('data-orig-id', el.id || '');
      el.id = targetId;
      return true;
    }catch(e){ warn('renameId failed', e); return false; }
  }

  function removeAutoPanels(){
    document.querySelectorAll('#lm-material-panel-autogen, [data-lm-autogen="material-panel"]')
      .forEach(n=>n.remove());
  }

  function apply(){
    const sel = document.getElementById('pm-material') 
             || document.querySelector('#pm-material, select[aria-label="Select material"]');
    const rng = document.getElementById('pm-opacity-range') 
             || document.querySelector('#pm-opacity-range, input[type="range"][aria-label="Opacity"]');

    // If the expected IDs already exist somewhere else, avoid duplicates by cleaning up stale autogen.
    removeAutoPanels();

    const okSel = sel ? renameId(sel, 'materialSelect') : false;
    const okRng = rng ? renameId(rng, 'opacityRange') : false;

    log('id-mapped', { okSel, okRng, selNow: sel?.id, rngNow: rng?.id });

    // Trigger immediate rebinds in whichever orchestrator is present
    if (typeof window.__lm_bindMaterialUI === 'function'){
      window.__lm_bindMaterialUI();
    }
    // Poke listeners that rely on deep-ready
    try{
      const scene = window.__lm_scene || (typeof getScene==='function' ? getScene() : null) || null;
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail:{ scene } }));
    }catch{}
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', apply, { once:true });
  } else {
    apply();
  }
})();
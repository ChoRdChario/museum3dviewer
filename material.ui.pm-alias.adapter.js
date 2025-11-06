// material.ui.pm-alias.adapter.js
// Purpose: bridge native IDs (pm-material / pm-opacity-range) to LociMyu orchestrator expectations
// without renaming DOM ids. Safe to include once; no external deps.

(function(){
  const NS='[pm-alias]';
  if (window.__lm_pm_alias_installed) return;
  window.__lm_pm_alias_installed = true;

  const log=(...a)=>console.log(NS, ...a);

  function apply(){
    const sel = document.getElementById('pm-material') 
             || document.querySelector('select[aria-label="Select material"]');
    const rng = document.getElementById('pm-opacity-range') 
             || document.querySelector('input[type="range"]#pm-opacity-range, input[type="range"][aria-label="Opacity"]');

    if (sel) sel.setAttribute('data-lm-role','materialSelect');
    if (rng) rng.setAttribute('data-lm-role','opacityRange');

    // Also tag the Material pane root so other adapters can find it
    const pane = document.getElementById('pane-material') 
              || document.querySelector('#tab-material, [data-tab="material"], .tab-material, .material-tab, #pane-material');
    if (pane) pane.setAttribute('data-lm-pane','material');

    log('applied', { sel: !!sel, rng: !!rng, pane: !!pane });

    // If vNext orchestrator is present, ask it to rebind now
    if (typeof window.__lm_bindMaterialUI === 'function'){
      window.__lm_bindMaterialUI();
    } else {
      // Fallback: poke deep-ready to stimulate listeners
      try {
        const scene = window.__lm_scene || (typeof getScene==='function' ? getScene() : null) || null;
        window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail:{ scene } }));
      } catch {}
    }
  }

  // Run after DOM is ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', apply, { once:true });
  } else {
    apply();
  }
})();
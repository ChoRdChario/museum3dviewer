// material.ui.relocator.bridge.js
// Purpose: place the autoinjected Material UI panel *inside* the visible Material tab,
// and rename native controls to expected IDs when they exist.
// Safe to load after DOMContentLoaded; idempotent.

(function(){
  const log = (...a)=>console.log('[lm-relocator]', ...a);
  const warn = (...a)=>console.warn('[lm-relocator]', ...a);
  if (window.__lm_relocator_installed) return;
  window.__lm_relocator_installed = true;

  function getVisibleMaterialPanel(){
    // 1) Try common ids/classes
    let root = document.querySelector('#tab-material, [data-tab="material"], .tab-material, .material-tab');
    // 2) Try visible tabpanel
    if (!root){
      const visiblePanel = [...document.querySelectorAll('[role="tabpanel"], .tab-panel, .tabs-content > *')]
        .find(el => el && el.offsetParent !== null && /material/i.test(el.getAttribute('id')||el.getAttribute('data-tab')||el.className||''));
      if (visiblePanel) root = visiblePanel;
    }
    // 3) Fallback to right sidebar
    if (!root){
      root = document.getElementById('right') || document.querySelector('aside, .right, #sidebar, .sidebar') || document.body;
    }
    return root || document.body;
  }

  function findNativeControls(scope){
    // Prefer controls inside a card-like container in the material scope
    const containers = [scope, ...scope.querySelectorAll('[data-section], .card, .panel, section, .group')];
    for (const c of containers){
      const sel = c.querySelector('select');
      const rng = c.querySelector('input[type="range"]');
      if (sel && rng) return {sel, rng, container: c};
    }
    // Fallback: first seen in scope
    return {
      sel: scope.querySelector('select') || null,
      rng: scope.querySelector('input[type="range"]') || null,
      container: scope
    };
  }

  function ensureExpectedIds(sel, rng){
    if (sel) sel.id = 'materialSelect';
    if (rng) rng.id = 'opacityRange';
  }

  function relocateAutoinjectPanel(scope){
    const auto = document.getElementById('lm-material-panel-autogen');
    if (!auto) return;
    // If scope already contains our panel, skip.
    if (auto.parentElement === scope) return;
    // Move panel to top of material panel scope
    scope.prepend(auto);
    log('autoinject panel moved under material panel');
  }

  function run(){
    const matPanel = getVisibleMaterialPanel();
    const {sel, rng} = findNativeControls(matPanel);
    ensureExpectedIds(sel, rng);
    relocateAutoinjectPanel(matPanel);
    // Kick rewire: send deep-ready again with best-known scene (if any)
    try{
      const scene = window.__lm_scene || null;
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene } }));
    }catch{}
    log('relocator done', { hasSelect: !!sel, hasRange: !!rng, matPanel });
  }

  // Run now and also after small delay (in case tabs render late)
  run();
  setTimeout(run, 300);
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) setTimeout(run, 0); });
})();
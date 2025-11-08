
/*! material.id.unify.v1.js
 * Purpose: eliminate ID mismatch and wrong-parent issues for Material UI.
 * Canonical IDs: #materialSelect, #opacityRange (both inside #pane-material)
 * Safe, minimal, no styling changes, no extra listeners.
 */
(() => {
  const TAG='[mat-id-unify]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  function ensureOnce(){
    const root = document.getElementById('pane-material') || document.querySelector('#pane-material, [role="tabpanel"][data-tab="material"], [data-panel="material"]');
    if (!root) return false;

    // 1) Resolve/select node for material dropdown
    let sel = document.getElementById('materialSelect') 
           || document.getElementById('pm-material') 
           || root.querySelector('select[aria-label*="material" i]');

    if (!sel) {
      // Create minimal select if truly missing
      sel = document.createElement('select');
      sel.id = 'materialSelect';
      sel.style.width = '100%';
      root.appendChild(sel);
    }

    // 2) Resolve range (opacity)
    let rng = document.getElementById('opacityRange') 
           || document.getElementById('pm-opacity-range') 
           || root.querySelector('input[type="range"]#opacityRange') 
           || root.querySelector('input[type="range"]');

    if (!rng) {
      rng = document.createElement('input');
      rng.type = 'range';
      rng.id = 'opacityRange';
      rng.min = '0'; rng.max = '1'; rng.step = '0.01'; rng.value = '1.0';
      rng.style.width = '100%';
      root.appendChild(rng);
    }

    // 3) Canonicalize IDs (rename legacy)
    if (sel.id !== 'materialSelect') sel.id = 'materialSelect';
    if (rng.id !== 'opacityRange')   rng.id = 'opacityRange';

    // 4) Ensure controls live under #pane-material (move if necessary)
    if (!root.contains(sel)) root.appendChild(sel);
    if (!root.contains(rng)) root.appendChild(rng);

    // 5) Make sure they are visible (in case of display:none via mistaken inheritance)
    if (sel.style.display === 'none') sel.style.display = '';
    if (rng.style.display === 'none') rng.style.display = '';

    // 6) Nudge any listeners waiting for UI readiness
    try { window.dispatchEvent(new Event('lm:mat-ui-ready')); } catch(_){}

    log('unified', { selectParent: sel.parentElement && (sel.parentElement.id || sel.parentElement.className || sel.parentElement.tagName),
                     rangeParent:  rng.parentElement && (rng.parentElement.id || rng.parentElement.className || rng.parentElement.tagName) });
    return true;
  }

  // Run after DOM, and retry a few times to catch late mounts.
  const kick = () => {
    let tries = 0;
    const MAX = 10;
    const timer = setInterval(() => {
      if (ensureOnce() || ++tries >= MAX) clearInterval(timer);
    }, 150);
    // Also try immediately
    ensureOnce();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kick, {once:true});
  } else {
    kick();
  }
})();

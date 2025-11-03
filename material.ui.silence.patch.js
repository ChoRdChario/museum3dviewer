
/*!
 * material.ui.silence.patch.js
 * Purpose: Prevent UI state carryover when switching materials by silencing input events
 * during programmatic UI updates. Non-destructive overlay; load AFTER material.orchestrator.js.
 */
(function(){
  const NS = '__MAT_UI_SILENCE__';
  if (window[NS]?.installed) return; // idempotent
  const state = window[NS] = { installed:true, guard:false, timer:null };

  const setGuard = (on, ms=120)=>{
    if (on) {
      state.guard = true;
      clearTimeout(state.timer);
      state.timer = setTimeout(()=>{ state.guard = false; }, ms);
    } else {
      clearTimeout(state.timer);
      state.guard = false;
    }
  };

  // Capture 'input' & 'change' on material-pane controls and stop propagation if guard is on.
  function installCaptureGuard(root){
    const pane = root || document;
    const candidates = [
      '#pm-material',
      'select[aria-label="Select material"]',
      'input[type="range"]',
      'input[type="checkbox"]'
    ];
    const sel = candidates.join(',');
    const handler = (ev)=>{
      if (state.guard) {
        ev.stopImmediatePropagation();
        // console.debug('[silence] blocked', ev.type, ev.target && ev.target.id || ev.target && ev.target.name);
      }
    };
    // Add capture listeners at the document level for robustness
    document.addEventListener('input', handler, true);
    document.addEventListener('change', handler, true);

    // On material select change, enable guard briefly to suppress programmatic UI writes that fire events.
    const matSel = document.querySelector('#pm-material, select[aria-label="Select material"]');
    if (matSel) {
      matSel.addEventListener('change', ()=> setGuard(true, 180), true); // capture before orchestrator
    }

    // As extra safety: whenever we detect programmatic value set (Mutation), enable short guard.
    const mo = new MutationObserver((list)=>{
      for (const m of list) {
        if (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'checked')) {
          setGuard(true, 100);
          break;
        }
      }
    });
    // Observe typical controls in the material pane
    const paneEl = matSel ? matSel.closest('section,div,form') || document.body : document.body;
    mo.observe(paneEl, {subtree:true, attributes:true, attributeFilter:['value','checked']});
    console.log('[silence-patch] installed');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>installCaptureGuard());
  } else {
    installCaptureGuard();
  }
})();

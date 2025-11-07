// material.orchestrator.js — minimal, panel‑only discovery (no tab-button anchoring)
// Logs prefixed with [mat-orch:min]
const log=(...a)=>console.log('[mat-orch:min]',...a);
const warn=(...a)=>console.warn('[mat-orch:min]',...a);

function findUI(){
  const pane = document.getElementById('panel-material');
  if (!pane) { warn('panel not found'); return null; }

  // Select & range MUST live inside panel (explicit anchors)
  const select = pane.querySelector('#materialSelect');
  const range  = pane.querySelector('#opacityRange');

  // If someone accidentally duplicated UI under the tab button, ignore it entirely
  const strayUnderTab = document.querySelector('#tab-material select, #tab-material input#opacityRange');
  if (strayUnderTab){
    strayUnderTab.remove(); // remove residue to prevent visual overlap
  }

  // If select exists but is not visible (collapsed panel), defer
  const visible = pane.classList.contains('active') && select && range;
  if (!visible){
    warn('select present but invisible (collapsed?)');
    return null;
  }
  return {pane, select, range};
}

function init(){
  const ui = findUI();
  if (!ui){
    log('waiting for UI in pane');
    // try again shortly (very light polling; avoids MO complexity)
    setTimeout(init, 300);
    return;
  }
  log('UI ready in panel', ui);
  // No material population here — existing boot/es modules will dispatch and populate.
}

document.addEventListener('DOMContentLoaded', init);
export {};

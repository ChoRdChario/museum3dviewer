/*! material.runtime.patch.js - v6.6 hotfix M2
 * Provides tiny runtime helpers used by the Material tab.
 */
(function(){
  const log = (...a)=>console.log('[mat-rt]', ...a);
  const warn = (...a)=>console.warn('[mat-rt]', ...a);

  // unify parents for select & range to keep them in the correct section
  function unifyParents(){
    const pane = document.querySelector('#pane-material') || document.querySelector('#panel-material');
    if(!pane){ return warn('pane missing'); }
    const select = pane.querySelector('#materialSelect');
    const range  = pane.querySelector('#opacityRange');
    if(!(select && range)){ return warn('missing:', {select: !!select, range: !!range, scene: !!window.__lm_viewer}); }

    // Ensure we have a single container for slider and its label
    let box = pane.querySelector('.pm-opacity');
    if(!box){
      box = document.createElement('div');
      box.className = 'pm-opacity';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.gap = '6px';
      // place it in the "Per-material opacity" card content
      const anchor = pane.querySelector('#pm-opacity') || select.closest('.card, section, div') || pane;
      (anchor.querySelector('.card-body') || anchor).appendChild(box);
    }
    // Move slider into the canonical container
    if(range.parentElement !== box){ box.appendChild(range); }
    // keep select in its line
    const selectRow = pane.querySelector('#pm-select') || select.parentElement;
    if(select.parentElement !== selectRow){ selectRow.appendChild(select); }

    log('wired');
  }

  unifyParents();
  // Also run after synth panel renders late
  let tries = 0;
  const iv = setInterval(()=>{
    unifyParents();
    tries++;
    if(tries>8) clearInterval(iv);
  }, 200);
})();

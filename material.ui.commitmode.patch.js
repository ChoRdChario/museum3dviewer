/*!
 * material.ui.commitmode.patch.js
 * Commit-on-release patch for opacity slider.
 * - During drag: preview only (no sheet write)
 * - On release: dispatch 'change' once to trigger persistence
 */
(function(){
  const TAG = "[commit-mode]";
  function ready(fn){ if (document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded', fn, {once:true}); }
  ready(()=>{
    const slider = document.querySelector('#pm-opacity-range, #opacityRange, input[type="range"][name="opacity"]');
    const select = document.querySelector('#pm-material, #materialSelect, select[name="materialKey"]');
    if(!slider || !select){ console.warn(TAG, "controls not found"); return; }
    console.log(TAG, "commit-mode wired for material UI");

    let dragging = false;
    // Track pointer drag
    slider.addEventListener('pointerdown', ()=>{ dragging = true; }, {passive:true});
    window.addEventListener('pointerup', ()=>{
      if (!dragging) return;
      dragging = false;
      // Fire a synthetic 'change' once to commit
      const ev = new Event('change', {bubbles:true});
      slider.dispatchEvent(ev);
    }, {passive:true});

    // During drag, stop flooding: block 'input' from bubbling to any sheet-save handlers.
    slider.addEventListener('input', (e)=>{
      if (dragging) e.stopPropagation();
    }, true /* capture: true so we can intercept early */);
  });
})();

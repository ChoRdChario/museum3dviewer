/* material.runtime.patch.js v3.0 (idempotent)
 * Purpose: Prepare Material pane UI handles once, wire basic UI behavior (range -> output)
 * Exposes: window.__LM_MAT_UI = { select, range, out }
 */
(function(){
  const TAG='[mat-rt v3.0]';
  if (window.__LM_MAT_UI && window.__LM_MAT_UI.__ready) {
    console.log(TAG,'already initialized');
    return;
  }
  function q(id){ return document.getElementById(id); }
  const sel = q('pm-material');
  const range = q('pm-opacity-range');
  const out = q('pm-opacity-val');
  if (!sel || !range || !out){
    console.warn(TAG,'UI controls missing',{hasSel:!!sel,hasRange:!!range,hasOut:!!out});
    return;
  }
  // Display sync
  function fmt(v){ try{ return Number(v).toFixed(2); }catch(_){ return String(v); } }
  function updateOut(){ out.value = fmt(range.value); out.textContent = fmt(range.value); }
  range.addEventListener('input', updateOut, {passive:true});
  updateOut();
  // Mark ready
  window.__LM_MAT_UI = { select: sel, range, out, __ready:true };
  window.dispatchEvent(new CustomEvent('lm:mat-ui-ready', { detail:{ready:true} }));
  console.log(TAG,'ready');
})();
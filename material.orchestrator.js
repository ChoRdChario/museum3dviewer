/*! material.orchestrator.js - v6.6 hotfix M2
 * Binds Material tab UI, keeps the single slider in the right place,
 * fixes 0.00 handling, and emits change events for sheet sync.
 */
(function(){
  const log = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  // --- Locate UI ---
  const pane = qs('#pane-material') || qs('#panel-material') || qs('section.lm-panel-material');
  if(!pane){ return warn('pane not found'); }

  // Old ghost sliders sometimes remain in DOM; remove everything except the canonical one we mount.
  function cleanupGhosts(){
    const ranges = qsa('input[type="range"]', pane);
    ranges.forEach(r => {
      if(r.id !== 'opacityRange' && r.dataset.lm !== 'keep'){
        r.closest('.pm-opacity') ? r.remove() : null;
      }
    });
    // remove bottom stray containers produced by earlier injections
    qsa('#pm-opacity-legacy, .pm-ghost, .lm-ghost', pane).forEach(n=>n.remove());
  }
  cleanupGhosts();

  // canonical container (created by recent synth panel)
  let select = qs('#materialSelect', pane);
  let range  = qs('#opacityRange', pane);
  if(!select || !range){
    return warn('UI missing', {select: !!select, range: !!range, pane});
  }

  // Ensure value label exists right next to the slider
  let valueBadge = qs('#opacityValue', pane);
  if(!valueBadge){
    valueBadge = document.createElement('span');
    valueBadge.id = 'opacityValue';
    valueBadge.className = 'lm-number-badge';
    valueBadge.style.marginLeft = '8px';
    valueBadge.style.minWidth = '3.5ch';
    valueBadge.style.display = 'inline-block';
    range.after(valueBadge);
  }

  function setBadge(val){
    // use nullish coalescing so 0 is respected
    const v = (val ?? Number(range.value) ?? 1);
    valueBadge.textContent = v.toFixed(2);
  }

  // restore persisted value (if any) on startup
  function restoreIfAny(){
    const mkey = select?.value;
    if(!mkey) return;
    const ev = new CustomEvent('lm:material-restore-request', {detail:{materialKey:mkey}});
    window.dispatchEvent(ev);
  }

  // --- State save + view apply --------------------------------------------
  function currentCtx(){
    // sheet.ctx.bridge.js is expected to have populated window.__lm_sheet_ctx
    const c = (window.__lm_sheet_ctx || {});
    return { spreadsheetId: c.spreadsheetId || null, sheetGid: c.sheetGid ?? null };
  }

  async function saveOpacity(val){
    const v = Number(val);
    // never coerce 0 to fallback
    const opacity = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    const materialKey = select.value;
    const ctx = currentCtx();

    // persist locally (module provided in material.state.local.v1.js) if present
    try{
      if(window.__lm_material_state && typeof window.__lm_material_state.save === 'function'){
        window.__lm_material_state.save(ctx, materialKey, {opacity});
      }
    }catch(e){ console.warn('[mat-orch] local state save skipped', e); }

    // notify listeners (viewer + sheet bridge)
    const detail = { materialKey, opacity, ...ctx, updatedAt: new Date().toISOString(), updatedBy: 'local' };
    window.dispatchEvent(new CustomEvent('lm:material-opacity-changed', {detail}));

    setBadge(opacity);
  }

  // --- Wiring --------------------------------------------------------------
  select.addEventListener('change', () => {
    // When material changes, badge should reflect currently selected slider value (no global opacity)
    setBadge(Number(range.value));
    // bubble a select-changed event for any listener to re-bind
    const ctx = currentCtx();
    window.dispatchEvent(new CustomEvent('lm:material-select-changed', {detail:{materialKey: select.value, ...ctx}}));
  });

  ['input','change'].forEach(ev => range.addEventListener(ev, (e)=>{
    // use valueAsNumber to keep precision and preserve 0
    const v = Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : Number(e.target.value);
    saveOpacity(v);
  }));

  // initial paint
  setBadge(Number(range.value));
  log('UI bound');
  // try to restore selection-specific data
  setTimeout(restoreIfAny, 0);
})();

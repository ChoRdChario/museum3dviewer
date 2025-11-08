/* material.orchestrator.js v2.2
 * Wires dropdown and range to local state, Sheets bridge, and viewer apply hook.
 */
(function(){
  const TAG='[mat-orch v2.2]';
  console.debug(TAG,'load');

  const qs=(s,r=document)=>r.querySelector(s);
  const on=(el,ev,fn,opt)=>el&&el.addEventListener(ev,fn,opt);

  function anchors(){
    // Prefer slots unified by material.id.unify.v2.js
    const a = window.__LM_MAT_ANCHORS || {};
    return {
      card: a.card || qs('#pm-opacity') || qs('#panel-material'),
      select: qs('#mat-select') || qs('.pm-slot-select select'),
      range:  qs('#mat-range')  || qs('.pm-slot-range input[type="range"]'),
      value:  a.valueEl || qs('#pm-value')
    };
  }

  // Best-effort viewer hook
  function applyToViewer(matName, opacity){
    // 1) Custom hook if provided by viewer bridge
    if (typeof window.__lm_applyOpacityHook === 'function'){
      try { window.__lm_applyOpacityHook({material: matName, opacity}); return true; } catch(e){}
    }
    // 2) Dispatch a custom event for any listener
    try {
      window.dispatchEvent(new CustomEvent('lm:apply-opacity', {detail:{material:matName,opacity}}));
    } catch(e){}
    return false;
  }

  // Local state mirror (simple)
  const _local = {
    save(name, val){
      try{
        localStorage.setItem('__lm_mat_'+name, JSON.stringify({updatedAt:new Date().toISOString(), updatedBy:'local', opacity:val}));
        console.debug('[mat-state v1] saved local', name, {opacity:val});
      }catch(e){}
    }
  };

  function bind(){
    const A = anchors();
    if (!A.card) return false;

    // ensure elements exist (runtime patch should have created them)
    if (!A.select){ A.card.querySelector('.pm-slot-select')?.appendChild(document.createElement('select')); A.select = A.card.querySelector('select'); }
    if (!A.range){ const r=document.createElement('input'); r.type='range'; r.min='0'; r.max='1'; r.step='0.01'; A.card.querySelector('.pm-slot-range')?.appendChild(r); A.range=r; }

    // Mirror value
    const setVal=(v)=>{ if (A.value) A.value.textContent=(+v||0).toFixed(2); };

    // Handlers
    on(A.select, 'change', () => {
      const name = (A.select.value || '').trim();
      const val = parseFloat(A.range.value || '1') || 1;
      setVal(val);
      _local.save(name, val);
      applyToViewer(name, val);
      // Notify sheet bridge if available
      try { window.dispatchEvent(new CustomEvent('lm:mat-opacity-change',{detail:{material:name,opacity:val}})); } catch(e){}
    }, {passive:true});

    on(A.range, 'input', () => {
      const name = (A.select && A.select.value || '').trim();
      const val = parseFloat(A.range.value || '1') || 1;
      setVal(val);
      _local.save(name, val);
      applyToViewer(name, val);
      try { window.dispatchEvent(new CustomEvent('lm:mat-opacity-change',{detail:{material:name,opacity:val}})); } catch(e){}
    }, {passive:true});

    console.debug(TAG,'UI bound');
    return true;
  }

  // try bind now and also when DOM is ready
  if (!bind()){
    document.addEventListener('DOMContentLoaded', bind, {once:true});
  }
})();

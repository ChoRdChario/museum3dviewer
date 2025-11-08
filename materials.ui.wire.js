
// materials.ui.wire.js
(function(){
  const LOG = (...args)=>console.log('[mat-ui-wire v1.3]', ...args);
  const WARN = (...args)=>console.warn('[mat-ui-wire v1.3]', ...args);

  function getEls(){
    return {
      sel: document.querySelector('#pm-material'),
      rng: document.querySelector('#pm-opacity-range'),
      val: document.querySelector('#pm-opacity-val'),
      ds : document.querySelector('#pm-flag-doublesided'),
      ul : document.querySelector('#pm-flag-unlit')
    };
  }

  async function persist(key, state){
    if (!window.__LM_MAT_PERSIST || !window.__LM_MAT_PERSIST.upsert) {
      WARN('persist not ready'); return;
    }
    const payload = {
      materialKey: key,
      opacity: state.opacity,
      doubleSided: !!state.doubleSided,
      unlitLike: !!state.unlitLike
    };
    try {
      await window.__LM_MAT_PERSIST.upsert(payload);
      LOG('persisted', payload);
    } catch(e){
      WARN('persist failed', e);
    }
  }

  function applyRender(state){
    if (window.__LM_MAT_RENDER && window.__LM_MAT_RENDER.apply) {
      window.__LM_MAT_RENDER.apply({
        key: state.key,
        opacity: state.opacity,
        doubleSided: state.doubleSided,
        unlitLike: state.unlitLike
      });
    }
  }

  function currentState(els){
    const key = els.sel?.value || els.sel?.selectedOptions?.[0]?.value || '';
    const opacity = els.rng ? parseFloat(els.rng.value) : undefined;
    const doubleSided = els.ds ? !!els.ds.checked : undefined;
    const unlitLike   = els.ul ? !!els.ul.checked : undefined;
    return {key, opacity, doubleSided, unlitLike};
  }

  function wire(){
    const els = getEls();
    if (!els.sel || !els.rng) { WARN('ui missing'); return; }

    const updateVal = ()=>{ if (els.val && els.rng) els.val.textContent = els.rng.value; };

    let t;
    const onChange = async ()=>{
      const st = currentState(els);
      applyRender(st);
      clearTimeout(t);
      t = setTimeout(()=> persist(st.key, st), 120);
      updateVal();
    };

    ['input','change','pointerup'].forEach(ev=> els.rng.addEventListener(ev, onChange, {passive:true}));
    ['change'].forEach(ev=> els.sel.addEventListener(ev, onChange, {passive:true}));
    if (els.ds) els.ds.addEventListener('change', onChange, {passive:true});
    if (els.ul) els.ul.addEventListener('change', onChange, {passive:true});

    updateVal();
    LOG('wired');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, {once:true});
  } else {
    wire();
  }
})();

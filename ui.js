
// ui.js tail guard: avoid calling viewer APIs before ready
(function(){
  const applyWhiteSlider = ()=>{
    const sl = document.getElementById('slWhiteKey');
    const chk = document.getElementById('chkWhiteKey');
    if (!sl) return;
    const apply = ()=>{
      if (!window.app || !app.viewer || !app.viewer.setWhiteKey) return;
      const t = Math.max(0, Math.min(1, parseFloat(sl.value)/100));
      app.viewer.setWhiteKey(t, (typeof getSelIndex==='function')?getSelIndex():null);
      if (chk && !chk.checked){ chk.checked = true; app.viewer.setWhiteKeyEnabled(true, (typeof getSelIndex==='function')?getSelIndex():null); }
    };
    sl.addEventListener('input', apply);
  };
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', applyWhiteSlider);
  } else {
    applyWhiteSlider();
  }
  window.addEventListener('lmy:model-loaded', applyWhiteSlider);
})();
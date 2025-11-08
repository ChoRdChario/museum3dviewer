// material.runtime.patch.js v3.1
(function(){
  const TAG='[mat-rt v3.1]';
  const $ = sel => document.querySelector(sel);
  const ui = {
    select: $('#pm-material'),
    range: $('#pm-opacity-range'),
    out:   $('#pm-opacity-val')
  };
  if(!ui.select || !ui.range || !ui.out){ console.warn(TAG,'ui not ready'); return; }
  console.log(TAG,'ready');

  // reflect range to output immediately
  const reflect = (v) => { ui.out.textContent = Number(v).toFixed(2); };
  ui.range.addEventListener('input', e => reflect(e.target.value), {passive:true});
  reflect(ui.range.value);

  // helper: emit a single custom event used by orchestrator/sheet bridge
  function emit(name, detail){ window.dispatchEvent(new CustomEvent(name,{detail,bubbles:false})); }
  ui.select.addEventListener('change', ()=>{
    emit('lm:pm-material-selected', { name: ui.select.value });
  });
  ui.range.addEventListener('input', ()=>{
    const v = parseFloat(ui.range.value);
    emit('lm:pm-opacity-input', { name: ui.select.value, opacity: v });
  });
  ui.range.addEventListener('change', ()=>{
    const v = parseFloat(ui.range.value);
    emit('lm:pm-opacity-change', { name: ui.select.value, opacity: v });
  });
})();

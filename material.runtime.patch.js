
// material.runtime.patch.js v3.2 (UI-only & events)
// - Keeps IDs stable, updates number readout, and emits input/change events.
// - No DOM duplication; expects existing Material pane with these IDs:
//   #pm-material (select), #pm-opacity-range (range), #pm-opacity-val (output)
(function(){
  const TAG='[mat-rt v3.2]';
  function $(id){ return document.getElementById(id); }

  function arm(){
    const sel = $('pm-material');
    const rng = $('pm-opacity-range');
    const out = $('pm-opacity-val');
    if(!sel || !rng || !out){ return false; }

    const syncOut = () => { out.value = Number(rng.value).toFixed(2); };

    // read persisted value attribute if present
    syncOut();

    // input: live preview
    rng.addEventListener('input', () => {
      syncOut();
      window.dispatchEvent(new CustomEvent('lm:pm-opacity-input', {
        detail: { value: Number(rng.value) }
      }));
    }, {passive:true});

    // change: commit intent
    rng.addEventListener('change', () => {
      window.dispatchEvent(new CustomEvent('lm:pm-opacity-change', {
        detail: { value: Number(rng.value) }
      }));
    });

    // material select
    sel.addEventListener('change', () => {
      window.dispatchEvent(new CustomEvent('lm:pm-material-selected', {
        detail: { key: sel.value, label: sel.options[sel.selectedIndex]?.text || sel.value }
      }));
    });

    console.log(TAG, 'ready');
    return true;
  }

  const ok = arm();
  if(!ok){
    // try once after load
    window.addEventListener('load', arm, {once:true});
  }
})(); 


// LociMyu per-material opacity runtime
(function(){
  const SELECT_ID = 'pm-material';
  const SLIDER_ID = 'pm-material-opacity';

  function qs(id){ return document.getElementById(id); }

  // Determine a stable save-id (sheet gid if available)
  function getSaveKey() {
    const sel = document.getElementById('save-target-sheet');
    const v = sel && sel.value ? sel.value : 'default';
    // many values are like "...gid=12345"; fall back to value
    const m = /gid=(\d+)/.exec(v);
    const gid = m ? m[1] : v;
    return 'LM:permat:opacity:'+ gid;
  }
  function readMap() { try { return JSON.parse(localStorage.getItem(getSaveKey())||'{}'); } catch(e){ return {}; } }
  function writeMap(map){ localStorage.setItem(getSaveKey(), JSON.stringify(map)); }

  // Build dropdown from scene
  function buildFromScene(scene){
    const select = qs(SELECT_ID);
    const slider = qs(SLIDER_ID);
    if (!select || !slider) return;

    const uniq = new Map();
    scene.traverse(o=>{
      if (!o || !o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{
        if (!m) return;
        if (!uniq.has(m.uuid)) uniq.set(m.uuid, m);
      });
    });

    // reset options
    select.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '— Select material —';
    select.appendChild(ph);

    const items = Array.from(uniq.values()).map(m=>{
      const label = (m.name && m.name.trim()) || (m.type||'Material') + '_' + m.uuid.slice(-6);
      return {uuid: m.uuid, label, ref: m};
    }).sort((a,b)=> a.label.localeCompare(b.label, 'en'));

    for(const it of items){
      const op=document.createElement('option');
      op.value = it.uuid;
      op.textContent = it.label;
      select.appendChild(op);
    }

    const saved = readMap();
    // apply saved
    Object.entries(saved).forEach(([uuid, val])=>{
      const m = uniq.get(uuid);
      if (m){
        m.transparent = true;
        m.opacity = +val;
        m.needsUpdate = true;
      }
    });

    // UI wiring
    select.onchange = ()=>{
      const uuid = select.value;
      const m = uniq.get(uuid);
      slider.value = String(m ? (m.opacity ?? 1) : 1);
    };
    slider.oninput = ()=>{
      const uuid = select.value;
      const m = uniq.get(uuid);
      if (!m) return;
      const v = +slider.value;
      m.transparent = true;
      m.opacity = v;
      m.needsUpdate = true;

      const map = readMap();
      map[uuid] = v;
      writeMap(map);
    };

    // expose for console
    window.__LM_PERMAT = { uniq, readMap, writeMap };
    console.log('[LM] per-material UI ready:', items.length, 'materials');
  }

  function maybeInit(){
    if (window.__LM_SCENE) buildFromScene(window.__LM_SCENE);
  }

  document.addEventListener('lm:scene-ready', (ev)=> buildFromScene(ev.detail.scene));
  // also try once on load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(maybeInit, 100);
  } else {
    window.addEventListener('DOMContentLoaded', maybeInit);
  }
})();

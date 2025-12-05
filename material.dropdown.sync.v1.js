// ==== LociMyu minimal material dropdown sync (v1) ====
// Goal: ensure ONE canonical select (#materialSelect) under #pane-material
// and populate it with scene material keys AFTER GLB load.
// Non-invasive: no heavy logs, no polling loops beyond a short backoff.

(() => {
  const TAG='[mat-dd-sync v1]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  const doc = document;
  const pane = doc.querySelector('#pane-material') || doc.querySelector('[data-panel="material"], [role="tabpanel"][data-tab="material"]');
  if (!pane) return;

  // ---- ensure single canonical select ----
  function ensureSelect() {
    // Prefer existing canonical select
    let sel = pane.querySelector('#materialSelect');
    // Fallbacks
    if (!sel) sel = pane.querySelector('#pm-material');
    if (!sel) sel = pane.querySelector('select[aria-label*="material" i]');
    if (!sel) {
      sel = doc.createElement('select');
      sel.id = 'materialSelect';
      sel.style.width = '100%';
      pane.prepend(sel);
    }
    // Normalize id to canonical
    if (sel.id !== 'materialSelect') sel.id = 'materialSelect';
    // Remove any duplicates left behind
    pane.querySelectorAll('select#pm-material, select#materialSelect:not(:first-of-type)').forEach((n,i)=>{
      if (n !== sel) n.remove();
    });
    return sel;
  }

  function ensureRange() {
    let rng = pane.querySelector('#opacityRange') || pane.querySelector('#pm-opacity-range');
    if (!rng) {
      rng = doc.createElement('input');
      rng.type = 'range';
      rng.id = 'opacityRange';
      rng.min='0'; rng.max='1'; rng.step='0.01'; rng.value='1.0';
      pane.appendChild(rng);
    }
    if (rng.id !== 'opacityRange') rng.id = 'opacityRange';
    return rng;
  }

  // ---- scene helpers ----
  function getScene() {
    return window.__LM_SCENE || window.__lm_scene ||
           (window.viewer && window.viewer.scene) ||
           (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene()) ||
           null;
  }

  function getMaterialKeys(scene) {
    const keys = new Set();
    if (!scene || !scene.traverse) return [];
    try {
      scene.traverse(o => {
        if (!o || !o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const name = (m && m.name || '').trim();
          if (name) keys.add(name);
        }
      });
    } catch(e) {}
    return Array.from(keys).sort();
  }

  function populate(sel, keys) {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    const opt0 = doc.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select material —';
    sel.appendChild(opt0);
    keys.forEach(k => {
      const opt = doc.createElement('option');
      opt.value = k; opt.textContent = k;
      sel.appendChild(opt);
    });
    if (prev && keys.includes(prev)) sel.value = prev;
  }

  let armed = false;
  async function run() {
    const sel = ensureSelect();
    ensureRange();
    // Notify orchestrator that canonical ids exist
    try { window.dispatchEvent(new Event('lm:mat-ui-ready')); } catch(_){}
    const scene = getScene();
    const keys = getMaterialKeys(scene);
    if (keys.length) {
      populate(sel, keys);
      log('populated', keys.length);
    } else {
      // short backoff retries (max 6 tries / ~1.5s)
      if (!armed) return;
      let tries = 0;
      const t = setInterval(() => {
        const keys2 = getMaterialKeys(getScene());
        if (keys2.length || ++tries >= 6) {
          clearInterval(t);
          if (keys2.length) {
            populate(sel, keys2);
            log('populated', keys2.length);
          } else {
            log('no-keys');
          }
        }
      }, 250);
    }
  }

  // Wire to GLB load completion and scene-ready
  const kick = () => { armed = true; setTimeout(run, 50); };

  window.addEventListener('lm:scene-ready', kick, { once:false });
  // Compatibility with existing glb load signal (if present)
  window.addEventListener('lm:glb-loaded', kick, { once:false });

  // Late load / already loaded scene
  setTimeout(kick, 200);
})();
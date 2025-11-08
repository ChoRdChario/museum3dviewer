// material.dropdown.patch.js  v2.1
// Adds 'lm:glb-loaded' trigger and stronger orchestration to populate material select
(() => {
  const TAG = '[mat-dd-fix v2.1]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  function getSelect() {
    const pane = document.querySelector('#pane-material') || document;
    return (
      pane.querySelector('#materialSelect') ||
      pane.querySelector('#pm-material')   ||
      pane.querySelector('select[aria-label*="material" i]') ||
      null
    );
  }
  function getScene() {
    return (
      window.__LM_SCENE ||
      window.__lm_scene ||
      (window.viewer && window.viewer.scene) ||
      (window.viewerBridge && typeof window.viewerBridge.getScene === 'function' && window.viewerBridge.getScene()) ||
      null
    );
  }
  function collectMaterialKeys(scene) {
    const keys = new Set();
    try {
      if (window.viewerBridge?.getMaterialKeys) {
        const r = window.viewerBridge.getMaterialKeys();
        if (Array.isArray(r)) r.forEach(k => keys.add(String(k)));
      }
    } catch {}
    try {
      if (scene?.traverse) {
        scene.traverse(o => {
          if (!o || !o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const name = (m && m.name ? String(m.name).trim() : '');
            if (name) keys.add(name);
          }
        });
      }
    } catch (e) { warn('traverse failed', e); }
    return Array.from(keys).sort();
  }
  function populate(sel, keys) {
    if (!sel) return 0;
    const current = sel.value;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select —';
    sel.appendChild(opt0);
    keys.forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      sel.appendChild(o);
    });
    if (current && keys.includes(current)) sel.value = current;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    log('dropdown populated:', keys.length);
    return keys.length;
  }

  let tries = 0, busy = false;
  async function attempt(reason='') {
    if (busy) return;
    busy = true;
    const sel = getSelect();
    const scene = getScene();
    if (!sel || !scene) { busy = false; return; }
    const n = populate(sel, collectMaterialKeys(scene));
    if (n === 0 && tries < 10) {
      tries++;
      setTimeout(() => attempt('retry'), 250 + tries * 150);
    } else if (n > 0) {
      tries = 0;
    }
    busy = false;
  }

  // Triggers
  setTimeout(() => attempt('initial'), 200);
  window.addEventListener('lm:scene-ready',  () => attempt('scene-ready'));
  window.addEventListener('lm:materials-changed', () => attempt('materials-changed'));
  window.addEventListener('lm:glb-loaded', () => attempt('glb-loaded')); // <— new

  const poll = setInterval(() => {
    const sc = getScene();
    if (!sc) return;
    const count = sc?.children?.length || 0;
    if (count > 2) attempt('poll');
  }, 500);
  setTimeout(() => clearInterval(poll), 30000);

  const matTabBtn = document.getElementById('tab-material');
  if (matTabBtn) matTabBtn.addEventListener('click', () => setTimeout(() => attempt('tab-click'), 50));

  const mo = new MutationObserver(() => {
    const sel = getSelect();
    if (sel && sel.options.length <= 1) attempt('dom-changed');
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 30000);

  log('installed');
})();
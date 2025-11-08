/**
 * material.dropdown.patch.js
 * Minimal, non-invasive patch to ensure the Material dropdown is populated.
 * - Does NOT move or create UI.
 * - Finds existing select in the Material pane.
 * - Waits for scene/model to be ready.
 * - Extracts material keys via the best available API with fallbacks.
 * - Populates options and keeps current selection when possible.
 *
 * Usage: include AFTER your existing scripts in index.html:
 *   <script type="module" src="./material.dropdown.patch.js"></script>
 */
(() => {
  const TAG = '[mat-dd-fix v1]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // --- tiny helpers ---
  const q = (sel, root = document) => root.querySelector(sel);
  const visible = (el) => !!el && el.offsetParent !== null;

  function findMaterialPane() {
    // The app uses #pane-material; don't synthesize anything here.
    return q('#pane-material') || q('[role="tabpanel"][data-tab="material"]') || q('[data-panel="material"]');
  }

  function findMaterialSelect() {
    const pane = findMaterialPane();
    if (!pane) return null;
    // Accept both legacy/new IDs and an aria-label fallback.
    const sel = pane.querySelector('#materialSelect, #pm-material, select[aria-label*="material" i]');
    if (!sel) return null;
    if (!visible(sel)) return null;
    return sel;
  }

  function getScene() {
    return window.__LM_SCENE || window.__lm_scene || window.viewer?.scene || (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene());
  }

  async function extractMaterialKeys() {
    const keys = new Set();

    // 1) viewerBridge.getMaterialKeys()
    try {
      const vb = window.viewerBridge;
      if (vb && typeof vb.getMaterialKeys === 'function') {
        const arr = await vb.getMaterialKeys();
        if (Array.isArray(arr)) arr.forEach(k => k && keys.add(String(k)));
        if (keys.size) {
          log('keys via viewerBridge.getMaterialKeys()', keys.size);
          return Array.from(keys).sort();
        }
      }
    } catch (e) {
      warn('viewerBridge.getMaterialKeys failed', e);
    }

    // 2) viewerBridge.listMaterials() or global listMaterials()
    try {
      const vb = window.viewerBridge;
      let list = null;
      if (vb && typeof vb.listMaterials === 'function') list = await vb.listMaterials();
      if (!list && typeof window.listMaterials === 'function') list = await window.listMaterials();
      if (Array.isArray(list)) {
        list.forEach(it => {
          const name = it?.name || it?.materialKey || it?.id;
          if (name) keys.add(String(name));
        });
        if (keys.size) {
          log('keys via listMaterials()', keys.size);
          return Array.from(keys).sort();
        }
      }
    } catch (e) {
      warn('listMaterials failed', e);
    }

    // 3) Traverse three.js scene
    try {
      const scene = getScene();
      if (scene && typeof scene.traverse === 'function') {
        scene.traverse((obj) => {
          const mats = obj && obj.material;
          if (!mats) return;
          (Array.isArray(mats) ? mats : [mats]).forEach(m => {
            if (m && m.name) keys.add(String(m.name));
          });
        });
      }
    } catch (e) {
      warn('scene traverse failed', e);
    }

    log('keys via traverse()', keys.size);
    return Array.from(keys).sort();
  }

  function populateSelect(sel, keys) {
    if (!sel || !Array.isArray(keys)) return;
    const prev = sel.value;
    sel.innerHTML = '';

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select —';
    sel.appendChild(opt0);

    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });

    if (prev && keys.includes(prev)) sel.value = prev;
    log('dropdown populated with', keys.length, 'items');
    // Signal for any listeners
    try {
      window.dispatchEvent(new CustomEvent('lm:materials-loaded', { detail: { keys, select: sel } }));
    } catch {}
  }

  // Wait logic: both the select and the scene need to be ready.
  let done = false;
  async function tryPopulate() {
    if (done) return;
    const sel = findMaterialSelect();
    if (!sel) return;

    // scene check: require some children (beyond lights)
    const scene = getScene();
    if (!scene || !scene.children || scene.children.length < 2) return;

    const keys = await extractMaterialKeys();
    if (!keys.length) return;
    populateSelect(sel, keys);
    done = true;
  }

  // Multi trigger strategy (non-invasive):
  // A) short delays for already-ready states
  setTimeout(tryPopulate, 150);
  setTimeout(tryPopulate, 500);
  setTimeout(tryPopulate, 1200);

  // B) observe pane mutations (e.g., when tab switches inject controls)
  const pane = findMaterialPane();
  if (pane) {
    const mo = new MutationObserver(() => tryPopulate());
    mo.observe(pane, { childList: true, subtree: true });
    // stop after a while
    setTimeout(() => mo.disconnect(), 30000);
  }

  // C) listen for app events if any
  window.addEventListener('lm:scene-ready', () => setTimeout(tryPopulate, 200));
  window.addEventListener('lm:mat-ui-ready', () => setTimeout(tryPopulate, 50));

  // D) provide manual refresh
  window.refreshMaterialDropdown = async () => { done = false; await tryPopulate(); };

  log('installed');
})();

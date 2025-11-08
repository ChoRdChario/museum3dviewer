
/* material.dropdown.patch.js — v2.2 (quiet)
 * Purpose: Populate #materialSelect reliably after GLB load,
 *          with debounced one-shot execution and quiet logging.
 */
(() => {
  const TAG = '[mat-dd-fix v2.2]';
  // ---- quiet logger (prints at most once per message key) ----
  const seen = new Set();
  function qlog(key, ...rest){
    if (seen.has(key)) return;
    seen.add(key);
    console.log(TAG, key, ...rest);
  }
  function qwarn(key, ...rest){
    if (seen.has(key)) return;
    seen.add(key);
    console.warn(TAG, key, ...rest);
  }

  // ---- state guards ----
  let armed = false;           // Avoid re-wiring listeners
  let lastSig = 0;             // Last handled signal timestamp
  let lastKeysHash = '';       // To avoid re-populating with same keys
  let observer = null;         // MutationObserver reference

  function hash(arr){
    try { return String(arr.join('|')); } catch(_) { return String(arr); }
  }

  function getScene(){
    return (
      window.__LM_SCENE ||
      window.__lm_scene ||
      (window.viewer && window.viewer.scene) ||
      (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene()) ||
      null
    );
  }

  function collectMaterialKeys(scene){
    const keys = new Set();
    if (!scene || !scene.traverse) return [];
    try {
      scene.traverse(obj => {
        const m = obj && obj.material;
        if (!m) return;
        const mats = Array.isArray(m) ? m : [m];
        mats.forEach(mm => {
          const name = (mm && mm.name ? String(mm.name).trim() : '');
          if (name) keys.add(name);
        });
      });
    } catch (e) {
      qwarn('collect-error', e);
    }
    return Array.from(keys).sort();
  }

  function getSelect(){
    // prefer #materialSelect; fallback to pm-material
    return (
      document.getElementById('materialSelect') ||
      document.getElementById('pm-material') ||
      document.querySelector('#pane-material select, #panel-material select')
    );
  }

  function populate(keys){
    const sel = getSelect();
    if (!sel) { qwarn('no-select'); return false; }
    const newHash = hash(keys);
    if (keys.length === 0) { qwarn('no-keys'); return false; }
    if (newHash === lastKeysHash) { return false; } // No change
    lastKeysHash = newHash;
    const prev = sel.value;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '— Select —';
    sel.appendChild(opt0);
    keys.forEach(k => {
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      sel.appendChild(o);
    });
    if (prev && keys.includes(prev)) sel.value = prev;
    qlog('populated', keys.length);
    return true;
  }

  // --- core pump ---
  let pumpTimer = null;
  async function pump(reason){
    // throttle calls in a frame
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; }, 0);

    const scene = getScene();
    if (!scene) return; // wait

    const keys = collectMaterialKeys(scene);
    const changed = populate(keys);
    if (changed && observer) { observer.disconnect(); observer = null; }
  }

  // ---- arm listeners once ----
  function arm(){
    if (armed) return;
    armed = true;

    // 1) our dedicated signal from glb.load.signal.js
    window.addEventListener('lm:glb-loaded', ev => {
      const t = (ev && ev.detail && ev.detail.ts) || Date.now();
      if (t <= lastSig) return;
      lastSig = t;
      pump('glb-signal');
    }, { passive: true });

    // 2) compatibility with existing event
    window.addEventListener('lm:scene-ready', () => pump('scene-ready'), { passive: true });

    // 3) fallback: observe scene changes once, stop after populated
    const scene = getScene();
    if (scene && scene.add) {
      // three.js scenes are not DOM Nodes; use rAF retry w/ limited attempts
      let tries = 60; // ~1s @60fps
      (function tick(){
        if (tries-- <= 0) return;
        const sz = scene.children ? scene.children.length : 0;
        if (sz > 2) pump('raf-detect');
        window.requestAnimationFrame(tick);
      })();
    } else {
      // DOM fallback: watch the pane-material subtree for the select creation
      const pane = document.getElementById('pane-material') || document.getElementById('panel-material');
      if (pane) {
        observer = new MutationObserver(() => pump('dom-mutation'));
        observer.observe(pane, {childList:true, subtree:true});
      }
    }

    // 4) manual safety net
    window.__lm_refreshMaterialDropdown = () => pump('manual');
    qlog('armed');
  }

  // Auto-arm after DOM is ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arm, { once:true });
  } else {
    arm();
  }
})();

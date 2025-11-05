/*
 * LociMyu — material.ui.populate.bridgepatch.js (v1.3)
 * Purpose:
 *   - Robustly obtain THREE.Scene from viewer bridge (window.lm.getScene || window.getScene)
 *   - Wait until scene actually has at least one material-bearing mesh
 *   - Populate the material <select> (id="pm-material" or legacy fallbacks) exactly once
 *   - Expose a readiness promise on window.lmReadyScene for other modules (no HTML change required)
 *   - Avoid infinite retry spam; bounded waits with multi-signal reattempts
 */
(function(){
  const TAG = '[populate-bridgepatch]';
  const log  = (...a)=>console.log(`%c${TAG}`, 'color:#0bf', ...a);
  const warn = (...a)=>console.warn(`%c${TAG}`, 'color:#d80', ...a);
  const err  = (...a)=>console.error(`%c${TAG}`, 'color:#e33', ...a);

  if (window.__lm_populate_patch_v13) {
    log('already installed; skipping');
    return;
  }
  window.__lm_populate_patch_v13 = true;
  log('script initialized');

  // ---------- small helpers ----------
  const now = ()=>performance.now();
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

  const getSelect = () => (
    document.querySelector('#pm-material')
    || document.querySelector('#materialSelect')
    || document.querySelector('select[name="materialKey"]')
    || document.querySelector('[data-lm="material-select"]')
    || document.querySelector('.lm-material-select')
    || document.querySelector('#materialPanel select')
    || document.querySelector('.material-panel select')
  );

  const getRange = () => (
    document.querySelector('#pm-opacity-range')
    || document.querySelector('#opacityRange')
    || document.querySelector('input[type="range"][name="opacity"]')
    || document.querySelector('[data-lm="opacity-range"]')
    || document.querySelector('.lm-opacity-range')
    || document.querySelector('#materialPanel input[type="range"]')
    || document.querySelector('.material-panel input[type="range"]')
  );

  const getSceneGetter = () => (window.lm && typeof window.lm.getScene === 'function')
    ? window.lm.getScene
    : (typeof window.getScene === 'function' ? window.getScene : null);

  const unwrapScene = (sLike) => {
    if (!sLike) return null;
    if (sLike.isScene && typeof sLike.traverse === 'function') return sLike; // THREE.Scene
    if (sLike.scene && sLike.scene.isScene) return sLike.scene;
    if (sLike.three && sLike.three.scene && sLike.three.scene.isScene) return sLike.three.scene;
    return null;
  };

  const sceneHasMaterials = (scene) => {
    if (!scene) return false;
    let has = false;
    scene.traverse(obj=>{
      if (has) return;
      const m = obj.material;
      if (!m) return;
      if (Array.isArray(m)) {
        if (m.some(mm=>!!mm)) has = true;
      } else {
        has = !!m;
      }
    });
    return has;
  };

  const summarizeMaterials = (scene) => {
    const mats = new Map();
    scene.traverse(obj=>{
      const m = obj.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      arr.forEach(mm=>{
        if (!mm) return;
        const name = (mm.name && String(mm.name).trim()) || '(no-name)';
        if (!mats.has(name)) mats.set(name, 0);
        mats.set(name, mats.get(name)+1);
      });
    });
    // Sort by usage desc, then name
    return Array.from(mats.entries())
      .sort((a,b)=> (b[1]-a[1]) || a[0].localeCompare(b[0]))
      .map(([name,_])=>name);
  };

  // ---------- scene readiness promise (no HTML edits needed) ----------
  // other modules can await window.lmReadyScene.then(scene=>{...})
  if (!window.lmReadyScene) {
    window.lmReadyScene = (async ()=>{
      const t0 = now();
      const deadline = t0 + 15000; // up to 15s total
      // multi-signal loop: try on events and small sleeps
      const signals = ['lm:scene-ready','lm:scene-stable','lm:viewer-ready','load'];
      const onSignal = new Promise(resolve=>{
        signals.forEach(s=>window.addEventListener(s, resolve, {once:false}));
      });

      while (now() < deadline) {
        const get = getSceneGetter();
        if (get) {
          try {
            const sLike = get();
            const scene = unwrapScene(sLike);
            if (scene && sceneHasMaterials(scene)) {
              log('scene ready (materials present)');
              return scene;
            }
          } catch(e) {
            // ignore & retry
          }
        }
        // whichever comes first: an event or a short timeout
        await Promise.race([onSignal, sleep(120)]);
      }
      throw new Error('scene not ready (timeout)');
    })();
  }

  // ---------- one-shot populate into <select> ----------
  (async function populateOnce(){
    const t0 = now();
    const deadline = t0 + 16000;
    const tried = [];
    try {
      const scene = await window.lmReadyScene; // may throw
      const $sel = await (async ()=>{
        while (now() < deadline) {
          const s = getSelect();
          tried.push({hasScene:!!scene, hasSelect:!!s});
          if (s) return s;
          await sleep(80);
        }
        return null;
      })();

      if (!scene || !$sel) {
        warn('done, reason= timeout', {tried});
        if (console && console.debug) console.debug(TAG, 'tried=', tried);
        return;
      }

      const names = summarizeMaterials(scene);
      // if select already has options other than placeholder, don't duplicate
      const currentValues = new Set(Array.from($sel.options||[]).map(o=>o.value));
      let inserted = 0;
      names.forEach(name=>{
        if (!currentValues.has(name)) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          $sel.appendChild(opt);
          inserted++;
        }
      });

      // enable range if present
      const $rng = getRange();
      if ($rng && $rng.disabled) $rng.disabled = false;

      log('populated', {count: names.length, inserted});
      window.dispatchEvent(new CustomEvent('pm:materials-populated', {detail:{count:names.length}}));
    } catch(e) {
      warn('done, reason= error', e);
    }
  })();

})();

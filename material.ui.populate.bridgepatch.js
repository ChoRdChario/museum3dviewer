
// material.ui.populate.bridgepatch.js — populate material select after deep-ready (v2.0)
(function(){
  const TAG = '[populate-bridgepatch+]';
  if (window.__populateBridgePlusInstalled) return;
  window.__populateBridgePlusInstalled = true;

  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  function qsMany(){
    // selectors (pm first, then fallbacks)
    const selSel = [
      '#pm-material', '#materialSelect', 'select[name="materialKey"]',
      '[data-lm="material-select"]', '.lm-material-select',
      '#materialPanel select', '.material-panel select'
    ];
    const rngSel = [
      '#pm-opacity-range', '#opacityRange', 'input[type="range"][name="opacity"]',
      '[data-lm="opacity-range"]', '.lm-opacity-range',
      '#materialPanel input[type="range"]', '.material-panel input[type="range"]'
    ];
    const $sel = selSel.map(s=>document.querySelector(s)).find(Boolean) || null;
    const $rng = rngSel.map(s=>document.querySelector(s)).find(Boolean) || null;
    return {$sel,$rng, tried:{sel:selSel, rng:rngSel}};
  }

  function extractSceneMaterials(scene){
    const map = new Map(); // name -> count
    scene.traverse(obj=>{
      const m = obj && obj.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      list.forEach(mm=>{
        if (!mm) return;
        const name = (mm.name && String(mm.name).trim()) || '(no-name)';
        map.set(name, (map.get(name)||0) + 1);
      });
    });
    return Array.from(map.entries())
      .sort((a,b)=>b[1]-a[1])
      .map(([name,count])=>({name,count}));
  }

  async function waitReadyScene(){
    const lm = (window.lm = window.lm || {});
    if (lm && lm.readyScenePromise) return lm.readyScenePromise;
    // soft fallback if bridge not loaded yet
    return new Promise((resolve, reject)=>{
      let to = setTimeout(()=>reject(new Error('scene not ready (timeout)')), 20000);
      function onDeep(e){ clearTimeout(to); resolve((e && e.detail && e.detail.scene) || (window.lm && window.lm.getScene && window.lm.getScene())); }
      window.addEventListener('pm:scene-deep-ready', onDeep, { once:true });
    });
  }

  async function populate(){
    const { $sel, $rng, tried } = qsMany();
    if (!$sel) {
      warn('material SELECT not found; tried=', tried.sel);
      return;
    }
    try {
      const scene = await waitReadyScene();
      if (!scene) throw new Error('no scene');
      const mats = extractSceneMaterials(scene);

      // Current options (preserve placeholder at index 0 if exists)
      const keepFirst = ($sel.options.length>0) ? $sel.options[0] : null;
      while ($sel.options.length) $sel.remove(0);
      if (keepFirst) $sel.add(keepFirst);

      let inserted = 0;
      mats.forEach(({name})=>{
        // avoid adding placeholder-ish empty values
        if (!name || name === '— Select material —') return;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        $sel.add(opt);
        inserted++;
      });

      if ($rng) { try{ $rng.disabled = false; }catch(e){} }
      window.dispatchEvent(new CustomEvent('pm:materials-populated', {detail:{count:mats.length, inserted}}));
      log('populated', {count:mats.length, inserted});
    } catch(e) {
      warn('done, reason=', 'error', e);
    }
  }

  // Kick once DOM is ready enough; also react to deep-ready event.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populate, { once:true });
  } else {
    setTimeout(populate, 0);
  }
  window.addEventListener('pm:scene-deep-ready', populate, { once:true });

  log('script initialized');
})();

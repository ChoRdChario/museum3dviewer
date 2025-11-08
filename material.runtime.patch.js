
/* material.runtime.patch.js
 * v1.1 — Apply UI changes (opacity / double-sided / unlit-like) to actual materials without relying on global THREE
 * Requires: a <select id="materialSelect"> and <input id="opacityRange"> somewhere in #pane-material
 */
(() => {
  const TAG='[mat-rt]'; const log=(...a)=>console.log(TAG, ...a), warn=(...a)=>console.warn(TAG, ...a);
  const FRONT_SIDE = 0, DOUBLE_SIDE = 2;

  function qs(sel){ return document.querySelector(sel); }
  function getScene(){
    return window.__LM_SCENE || window.__lm_scene ||
           (window.viewer && window.viewer.scene) ||
           (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene()) ||
           null;
  }

  // Build name -> materials[] index
  function buildIndex(scene){
    const byName = new Map();
    scene && scene.traverse && scene.traverse(o => {
      if (!o || !o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        const name = (m && m.name ? String(m.name).trim() : '');
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(m);
      }
    });
    return byName;
  }

  // Apply helpers
  function applyOpacity(mats, v){
    let touched = 0;
    for (const m of mats){
      if (!m) continue;
      const tr = v < 1.0;
      if (tr && m.transparent !== true) m.transparent = true;
      if (typeof m.depthWrite === 'boolean') m.depthWrite = !tr;
      if (typeof m.opacity === 'number') m.opacity = v; else continue;
      if ('needsUpdate' in m) m.needsUpdate = true;
      touched++;
    }
    return touched;
  }
  function applySide(mats, on){
    let touched = 0;
    for (const m of mats){
      if (!m) continue;
      m.side = on ? DOUBLE_SIDE : FRONT_SIDE;
      if ('needsUpdate' in m) m.needsUpdate = true;
      touched++;
    }
    return touched;
  }
  function applyUnlitLike(mats, on){
    let touched = 0;
    for (const m of mats){
      if (!m) continue;
      const ud = (m.userData ||= {});
      if (!ud.__lm_litBackup){
        ud.__lm_litBackup = {
          emissive: m.emissive ? (m.emissive.clone?.() || m.emissive) : null,
          emissiveIntensity: m.emissiveIntensity,
          metalness: m.metalness,
          roughness: m.roughness,
          toneMapped: m.toneMapped
        };
      }
      if (on){
        if (m.color && m.emissive){ m.emissive.copy ? m.emissive.copy(m.color) : (m.emissive = m.color.clone?.() || m.color); }
        if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 1.0;
        if (typeof m.metalness === 'number') m.metalness = 0.0;
        if (typeof m.roughness === 'number') m.roughness = 1.0;
        if ('toneMapped' in m) m.toneMapped = false;
      } else if (ud.__lm_litBackup){
        const b = ud.__lm_litBackup;
        if (m.emissive && b.emissive){ m.emissive.copy ? m.emissive.copy(b.emissive) : (m.emissive = b.emissive); }
        if (typeof b.emissiveIntensity === 'number') m.emissiveIntensity = b.emissiveIntensity;
        if (typeof b.metalness === 'number') m.metalness = b.metalness;
        if (typeof b.roughness === 'number') m.roughness = b.roughness;
        if ('toneMapped' in m && typeof b.toneMapped === 'boolean') m.toneMapped = b.toneMapped;
      }
      if ('needsUpdate' in m) m.needsUpdate = true;
      touched++;
    }
    return touched;
  }

  // Wire once
  let wired = false, INDEX = null;
  function wire(){
    if (wired) return;
    const sel = qs('#materialSelect, #pm-material');
    const rng = qs('#opacityRange');
    const chkDouble = qs('#doubleSided');
    const chkUnlit  = qs('#unlitLike');
    const scene = getScene();
    const missing = { select: !sel, range: !rng, scene: !scene };
    if (missing.select || missing.range || missing.scene){
      return warn('missing:', missing);
    }
    INDEX = buildIndex(scene);
    const currentKey = () => (sel.value || '').trim();
    const matsOf = () => INDEX.get(currentKey()) || [];

    rng.addEventListener('input', () => {
      const v = parseFloat(rng.value || '1') || 1;
      applyOpacity(matsOf(), v);
    }, false);
    sel.addEventListener('change', () => rng.dispatchEvent(new Event('input')), false);
    chkDouble && chkDouble.addEventListener('change', () => applySide(matsOf(), !!chkDouble.checked), false);
    chkUnlit  && chkUnlit.addEventListener('change', () => applyUnlitLike(matsOf(), !!chkUnlit.checked), false);

    // expose helpers
    window.__lm_mat_rt = {
      reindex(){ INDEX = buildIndex(getScene()); return INDEX; },
      applyOpacity(key, v){ return applyOpacity(INDEX.get(key)||[], v);},
      applySide(key, on){ return applySide(INDEX.get(key)||[], on);},
      applyUnlitLike(key, on){ return applyUnlitLike(INDEX.get(key)||[], on);},
    };

    wired = true;
    log('wired');
  }

  // multi-trigger
  setTimeout(wire, 250);
  window.addEventListener('lm:mat-ui-ready', () => setTimeout(wire, 50));
  window.addEventListener('lm:scene-ready',   () => setTimeout(() => { window.__lm_mat_rt && window.__lm_mat_rt.reindex(); wire(); }, 100));

  // As a fallback, retry until success
  let tries=0, t = setInterval(() => { wire(); if (++tries>80) clearInterval(t); }, 250);
})();


/* material.runtime.patch.js
 * LociMyu – runtime wiring for Material tab (opacity / double-sided / unlit-like)
 * - No dependency on global THREE reference (uses numeric side enums)
 * - Works with either #materialSelect or #pm-material and #opacityRange
 * - Safe to drop in; doesn't mutate existing UI layout
 */
(() => {
  const TAG='[mat-rt]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  // numeric enums to avoid depending on global THREE
  const FRONT_SIDE = 0;
  const BACK_SIDE = 1;
  const DOUBLE_SIDE = 2;

  // ---- resolve UI ----
  const doc = document;
  const sel = doc.querySelector('#materialSelect, #pm-material');
  const rng = doc.querySelector('#opacityRange');
  const chkDouble = doc.querySelector('#doubleSided');
  const chkUnlit  = doc.querySelector('#unlitLike');

  const scene =
    window.__LM_SCENE || window.__lm_scene ||
    (window.viewer && window.viewer.scene) ||
    (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene());

  if (!sel || !rng || !scene) {
    return warn('missing:', {select: !!sel, range: !!rng, scene: !!scene});
  }

  // ---- index materials by name ----
  function buildIndex(){
    const byName = new Map();
    scene.traverse(o=>{
      if (!o || !o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{
        const name = (m && m.name ? String(m.name).trim() : '');
        if (!name) return;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(m);
      });
    });
    return byName;
  }
  let INDEX = buildIndex();
  log('indexed', {keys:[...INDEX.keys()], count:[...INDEX.values()].reduce((a,v)=>a+v.length,0)});

  // ---- apply helpers ----
  function applyOpacity(key, v){
    const mats = INDEX.get(key) || [];
    let touched = 0;
    mats.forEach(m=>{
      if (!m) return;
      const wantsTransparent = (v < 1.0);
      if (wantsTransparent && m.transparent !== true) m.transparent = true;
      if (typeof m.depthWrite === 'boolean') m.depthWrite = !wantsTransparent;
      if (typeof m.opacity === 'number') {
        m.opacity = v;
        if ('needsUpdate' in m) m.needsUpdate = true;
        touched++;
      }
    });
    log('applyOpacity', {key, v, touched, mats: mats.length});
  }

  function applyDoubleSided(key, on){
    const mats = INDEX.get(key) || [];
    let touched = 0;
    mats.forEach(m=>{
      if (!m) return;
      m.side = on ? DOUBLE_SIDE : FRONT_SIDE;
      if ('needsUpdate' in m) m.needsUpdate = true;
      touched++;
    });
    log('applyDoubleSided', {key, on, touched});
  }

  function applyUnlitLike(key, on){
    const mats = INDEX.get(key) || [];
    let touched = 0;
    mats.forEach(m=>{
      if (!m) return;
      const ud = (m.userData ||= {});
      if (!ud.__lm_litBackup) {
        ud.__lm_litBackup = {
          emissive: m.emissive ? (m.emissive.clone ? m.emissive.clone() : null) : null,
          emissiveIntensity: m.emissiveIntensity,
          metalness: m.metalness,
          roughness: m.roughness,
          toneMapped: m.toneMapped
        };
      }
      if (on) {
        if (m.color && m.emissive) {
          if (m.emissive.copy) m.emissive.copy(m.color);
        }
        if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 1.0;
        if (typeof m.metalness === 'number') m.metalness = 0.0;
        if (typeof m.roughness === 'number') m.roughness = 1.0;
        if ('toneMapped' in m) m.toneMapped = false;
      } else if (ud.__lm_litBackup) {
        const b = ud.__lm_litBackup;
        if (m.emissive && b.emissive && m.emissive.copy) m.emissive.copy(b.emissive);
        if (typeof b.emissiveIntensity === 'number') m.emissiveIntensity = b.emissiveIntensity;
        if (typeof b.metalness === 'number') m.metalness = b.metalness;
        if (typeof b.roughness === 'number') m.roughness = b.roughness;
        if ('toneMapped' in m && typeof b.toneMapped === 'boolean') m.toneMapped = b.toneMapped;
      }
      if ('needsUpdate' in m) m.needsUpdate = true;
      touched++;
    });
    log('applyUnlitLike', {key, on, touched});
  }

  // ---- wire events ----
  const currentKey = () => (sel.value || '').trim();

  function onOpacityInput(){
    const key = currentKey();
    if (!key) return;
    const v = parseFloat(rng.value);
    applyOpacity(key, v);
  }

  function onDoubleChange(){
    const key = currentKey();
    if (!key || !chkDouble) return;
    applyDoubleSided(key, !!chkDouble.checked);
  }

  function onUnlitChange(){
    const key = currentKey();
    if (!key || !chkUnlit) return;
    applyUnlitLike(key, !!chkUnlit.checked);
  }

  // 防御: 既に同じハンドラがいる場合も二重適用しない（名前空間用プロパティ）
  if (!rng.__lm_wired) {
    rng.addEventListener('input', onOpacityInput, false);
    sel.addEventListener('change', ()=>rng.dispatchEvent(new Event('input')), false);
    chkDouble && chkDouble.addEventListener('change', onDoubleChange, false);
    chkUnlit  && chkUnlit.addEventListener('change',  onUnlitChange,  false);
    rng.__lm_wired = true;
  }

  // 初期一発
  setTimeout(()=>rng.dispatchEvent(new Event('input')), 0);

  // expose for debugging
  window.__lm_mat_rt = {reindex: () => (INDEX = buildIndex(), log('reindex', {keys:[...INDEX.keys()]}), INDEX),
    applyOpacity, applyDoubleSided, applyUnlitLike};
})();

/* material.dropdown.patch.js v3.3
 * Purpose: Populate the per‑material dropdown with ONLY original GLB materials,
 *          excluding runtime/generated Three.js materials (pins, helpers, sprites, UUID-ish).
 */
(function(){
  const TAG = '[mat-dd v3.3]';

  // Simple UUID-looking name detector (8-4-4-4-12 hex)
  const UUIDish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Decide if a material is a mesh surface material we care about
  function isRenderableSurfaceMaterial(mat){
    if (!mat) return false;
    // Exclude clearly non-surface / helper materials
    if (mat.isSpriteMaterial || mat.isPointsMaterial || mat.isLineBasicMaterial || mat.isLineDashedMaterial) return false;
    // Typical mesh materials we support
    if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isShaderMaterial) {
      return true;
    }
    return false;
  }

  // Decide if a material looks "generated" rather than authored in GLB
  function isGeneratedName(name){
    if (!name) return true; // empty names are treated as generated
    const n = String(name);
    if (UUIDish.test(n)) return true;
    // Common internal names we created on the app side
    if (n.startsWith('pin') || n.startsWith('lm-') || n.startsWith('__')) return true;
    // GLTFLoader sometimes gives "Material" or "material" with numeric suffixes: keep them
    return false;
  }

  function collectOriginalMaterials(scene){
    // Cache on first successful build
    if (window.__LM_ORIGINAL_MATS && window.__LM_ORIGINAL_MATS.size) return window.__LM_ORIGINAL_MATS;

    const map = new Map(); // name -> material
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      // Skip meshes we create for pins/helpers
      if (obj.userData && (obj.userData.__lm_generated || obj.userData.pin || obj.userData.helper)) return;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (!isRenderableSurfaceMaterial(mat)) return;
        const keep = !isGeneratedName(mat.name);
        if (!keep) return;
        const key = mat.name;
        if (!map.has(key)) map.set(key, mat);
      });
    });

    // Fallback: if nothing survived filtering, include unique mat.uuid short names
    if (map.size === 0) {
      const backup = new Map();
      scene.traverse(obj => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
          if (!isRenderableSurfaceMaterial(mat)) return;
          const key = mat.name && !UUIDish.test(mat.name) ? mat.name : ('Material_' + mat.uuid.slice(0,8));
          if (!backup.has(key)) backup.set(key, mat);
        });
      });
      window.__LM_ORIGINAL_MATS = backup;
      return backup;
    }

    window.__LM_ORIGINAL_MATS = map;
    return map;
  }

  function populateSelect(selectEl, map){
    // Preserve current selection if still present
    const prev = selectEl.value;
    selectEl.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select material —';
    selectEl.appendChild(opt0);

    const names = Array.from(map.keys()).sort((a,b)=>a.localeCompare(b, 'ja'));
    for (const name of names){
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    }
    if (prev && map.has(prev)) selectEl.value = prev;
  }

  function arm(){
    const sel = document.getElementById('pm-material');
    if (!sel) return console.warn(TAG, 'select not found');
    const scene = window.__LM_SCENE || (window.viewer && window.viewer.scene);
    if (!scene) {
      // Retry shortly if scene not yet bridged
      return setTimeout(arm, 200);
    }

    const map = collectOriginalMaterials(scene);
    populateSelect(sel, map);
    console.log(TAG, 'populated', map.size);
  }

  // Hook our known "glb loaded/stabilized" moments plus a safe fallback
  window.addEventListener('lm:glb-detected', arm);
  document.addEventListener('DOMContentLoaded', ()=> setTimeout(arm, 800));
  // In case viewer.bridge sets a custom event
  window.addEventListener('lm:scene-stabilized', arm);
})();

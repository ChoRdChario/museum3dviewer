// material.js — fix Unlit toggle + dedup material list + double side
export function setupMaterialPanel(app){
  const sel = document.getElementById('matTarget');
  const btnUnlit = document.getElementById('btnUnlit');
  const btnDouble = document.getElementById('btnDoubleSide');
  const rngOpacity = document.getElementById('matOpacity');
  if (!sel || !btnUnlit || !btnDouble) {
    console.warn('[material] controls not found'); 
    return;
  }
  function collectMaterials(){
    const map = new Map();
    app.viewer.scene.traverse(obj=>{
      if (!obj.isMesh) return;
      const put = (m)=>{
        if (!m) return;
        const key = m.uuid;
        if (!map.has(key)){
          map.set(key, { mat:m, name:(m.name||'(no name)'), users:new Set() });
        }
        map.get(key).users.add(obj);
      };
      if (Array.isArray(obj.material)) obj.material.forEach(put);
      else put(obj.material);
    });
    return map;
  }
  let materialMap = new Map();
  let target = new Set();
  const ALL = '*';
  function rebuildList(){
    materialMap = collectMaterials();
    sel.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = ALL; optAll.textContent = '(All)';
    sel.appendChild(optAll);
    let i=0;
    for (const [uuid, rec] of materialMap){
      const opt = document.createElement('option');
      opt.value = uuid;
      opt.textContent = `${i}: ${rec.name || '(no name)'}`;
      sel.appendChild(opt);
      i++;
    }
    sel.value = ALL;
    target = new Set([ALL]);
  }
  function isUnlitMesh(mesh){ return !!mesh.userData.__origMaterial; }
  function toUnlit(mesh){
    if (isUnlitMesh(mesh)) return;
    const THREE = app.viewer.THREE;
    const orig = mesh.material;
    function makeBasic(m){
      const basic = new THREE.MeshBasicMaterial();
      basic.name = m.name || 'unlit';
      if (m.color) basic.color.copy(m.color);
      basic.map = m.map || null;
      basic.opacity = (m.opacity!=null)? m.opacity : 1;
      basic.transparent = m.transparent || basic.opacity<1;
      basic.side = m.side;
      basic.depthWrite = m.depthWrite;
      basic.depthTest = m.depthTest;
      basic.alphaMap = m.alphaMap || null;
      basic.toneMapped = false;
      return basic;
    }
    if (Array.isArray(orig)){
      mesh.userData.__origMaterial = orig;
      mesh.material = orig.map(makeBasic);
    } else {
      mesh.userData.__origMaterial = orig;
      mesh.material = makeBasic(orig);
    }
    mesh.material.needsUpdate = true;
  }
  function fromUnlit(mesh){
    if (!isUnlitMesh(mesh)) return;
    mesh.material = mesh.userData.__origMaterial;
    delete mesh.userData.__origMaterial;
    if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true));
    else if (mesh.material) mesh.material.needsUpdate = true;
  }
  function forEachTarget(fn){
    const applyToAll = target.has(ALL);
    app.viewer.scene.traverse(obj=>{
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material)? obj.material : [obj.material];
      const uuids = mats.map(m=>m && m.uuid);
      const hit = applyToAll ? true : uuids.some(u=> target.has(u));
      if (!hit) return;
      fn(obj);
    });
  }
  function refreshButtonStates(){
    let anyUnlit=false, anyDouble=false;
    forEachTarget(mesh=>{
      anyUnlit = anyUnlit || isUnlitMesh(mesh);
      const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
      mats.forEach(m=>{ if (!m) return; anyDouble = anyDouble || (m.side === app.viewer.THREE.DoubleSide); });
    });
    btnUnlit.textContent = `Unlit: ${anyUnlit?'on':'off'}`;
    btnDouble.textContent = `DoubleSide: ${anyDouble?'on':'off'}`;
  }
  sel.addEventListener('change', ()=>{
    if (sel.value === ALL){ target = new Set([ALL]); }
    else { target = new Set([sel.value]); }
    refreshButtonStates();
  });
  btnUnlit.addEventListener('click', ()=>{
    let anyUnlit=false;
    forEachTarget(mesh=>{ if (isUnlitMesh(mesh)) anyUnlit=true; });
    if (anyUnlit){ forEachTarget(fromUnlit); } else { forEachTarget(toUnlit); }
    rebuildList();
    refreshButtonStates();
  });
  btnDouble.addEventListener('click', ()=>{
    const THREE = app.viewer.THREE;
    let toDouble = true;
    forEachTarget(mesh=>{
      const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
      for (const m of mats){ if (!m) continue; if (m.side === THREE.DoubleSide){ toDouble=false; break; } }
    });
    forEachTarget(mesh=>{
      const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
      mats.forEach(m=>{ if (!m) return; m.side = toDouble? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; });
    });
    refreshButtonStates();
  });
  if (rngOpacity){
    rngOpacity.addEventListener('input', ()=>{
      const v = parseFloat(rngOpacity.value);
      forEachTarget(mesh=>{
        const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
        mats.forEach(m=>{ if (!m) return; m.opacity = v; m.transparent = v<0.999; m.needsUpdate = true; });
      });
    });
  }
  window.addEventListener('lmy:model-loaded', ()=>{ rebuildList(); refreshButtonStates(); });
  rebuildList();
  refreshButtonStates();
}

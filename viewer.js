// viewer.js — unlit toggle fix + WhiteKey enable/disable (cut WHITE using alphaTest)
const THREE_URL = 'three';
const GLTF_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';
const ORBIT_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

export async function ensureViewer({ mount, spinner }) {
  const THREE = await import(THREE_URL);
  const { OrbitControls } = await import(ORBIT_URL);
  const { GLTFLoader } = await import(GLTF_URL);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha:false });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(45, mount.clientWidth/mount.clientHeight, 0.01, 1000);
  camera.position.set(0.6, 0.5, 1.1);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 5, 5);
  scene.add(dir);

  const state = {
    current: null,
    materials: [],
    spin: true,
    ortho: null,
    whiteKeyEnabled: false,
    whiteKeyThreshold: 1.0, // 0.70..1.00
  };

  (function loop(){
    requestAnimationFrame(loop);
    if (state.current && state.spin) {
      state.current.rotation.y += 0.015;
    }
    controls.update();
    renderer.render(scene, controls.object || camera);
  })();

  window.addEventListener('resize', ()=>{
    const w = mount.clientWidth, h = mount.clientHeight;
    renderer.setSize(w, h);
    if (state.ortho) {
      const fr = 0.8;
      state.ortho.left = -fr*w/h; state.ortho.right = fr*w/h; state.ortho.top = fr; state.ortho.bottom = -fr;
      state.ortho.updateProjectionMatrix();
    } else {
      camera.aspect = w/h; camera.updateProjectionMatrix();
    }
  });

  function frameToObject(obj){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const d = Math.max(size.x, size.y, size.z) * 1.8 || 1.0;
    camera.position.copy(center).add(new THREE.Vector3(d, d*0.6, d));
    camera.near = d/1000; camera.far = d*10; camera.updateProjectionMatrix();
    controls.target.copy(center); controls.update();
  }

  async function loadGLBFromArrayBuffer(buf) {
    const url = URL.createObjectURL(new Blob([buf]));
    try{
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) throw new Error('GLB has no scene');

      if (state.current) scene.remove(state.current);
      state.spin = false; scene.add(root); state.current = root;

      const uniq = new Map();
      root.traverse(o=>{
        if (!o.isMesh) return;
        const add=(m)=>{ if(m && !uniq.has(m.uuid)) uniq.set(m.uuid, m); };
        if (Array.isArray(o.material)) o.material.forEach(add); else add(o.material);
      });
      state.materials = Array.from(uniq.values());

      // re-apply white-key if enabled
      if (state.whiteKeyEnabled) applyWhiteKeyToMaterials(state.whiteKeyThreshold, null);

      frameToObject(root);
      const matInfos = state.materials.map((m,i)=>({ index:i, name:(m.name||`mat.${i}`) }));
      window.dispatchEvent(new CustomEvent('lmy:model-loaded', { detail: { materials: matInfos }}));
      console.log('[viewer] GLB loaded; unique materials:', state.materials.length);
      return { materials: matInfos };
    } finally {
      URL.revokeObjectURL(url);
      spinner?.remove?.();
    }
  }

  function forEachTarget(index, fn){
    const targets = (index==null) ? new Set(state.materials.map(m=>m.uuid))
                                  : new Set([state.materials[index]?.uuid].filter(Boolean));
    state.current?.traverse(obj=>{
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material)? obj.material : [obj.material];
      if (mats.some(m=> m && targets.has(m.uuid))) fn(obj, mats);
    });
  }

  function setHSL(h, s, l, index){
    const h01=h/360, s01=Math.max(0,Math.min(1,s/100)), l01=Math.max(0,Math.min(1,l/100));
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{ if(m && m.color){ m.color.setHSL(h01,s01,l01); m.needsUpdate=true; } });
    });
  }

  function setOpacity(val, index){
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{
        if (!m) return;
        m.opacity = val;
        const translucent = val < 0.999;
        m.transparent = translucent;
        m.depthWrite = !translucent;
        m.depthTest = true;
        m.needsUpdate = true;
      });
    });
  }

  function setDoubleSide(on, index){
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{ if (m){ m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; } });
    });
  }

  // ---- White Key helpers ----
  function patchWhiteKey(material, threshold){
    // 画像テクスチャが無い単色材は対象外（消えないように）
    if (!material || !material.map) return;
    material.userData.__whiteKeyThreshold = threshold;
    material.onBeforeCompile = function(shader){
      shader.uniforms.uWhiteCut = { value: this.userData.__whiteKeyThreshold ?? 1.0 };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uWhiteCut;\nvoid main() {')
        .replace(/gl_FragColor\s*=\s*vec4\(([^;]+)\);\s*$/m, (all, inner)=>{
          return `vec4 c = vec4(${inner});
float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
if (lum >= uWhiteCut) { discard; } // cut WHITE only
gl_FragColor = c;`;
        });
    };
    material.alphaTest = Math.max(0.0001, threshold - 0.001);
    material.transparent = false;
    material.depthWrite = true;
    material.needsUpdate = true;
  }
  function unpatchWhiteKey(material){
    if (!material) return;
    material.onBeforeCompile = null;
    material.alphaTest = 0.0;
    material.needsUpdate = true;
  }
  function applyWhiteKeyToMaterials(threshold, index){
    const mats = (index==null) ? state.materials : [state.materials[index]].filter(Boolean);
    mats.forEach(m=> patchWhiteKey(m, threshold));
  }
  function clearWhiteKeyFromMaterials(index){
    const mats = (index==null) ? state.materials : [state.materials[index]].filter(Boolean);
    mats.forEach(m=> unpatchWhiteKey(m));
  }
  function setWhiteKey(threshold, index){
    state.whiteKeyThreshold = threshold;
    if (state.whiteKeyEnabled) applyWhiteKeyToMaterials(threshold, index);
  }
  function setWhiteKeyEnabled(on, index=null){
    state.whiteKeyEnabled = !!on;
    if (on) applyWhiteKeyToMaterials(state.whiteKeyThreshold, index);
    else clearWhiteKeyFromMaterials(index);
  }

  // ---- Unlit (robust toggle) ----
  function cloneAsBasic(m){
    const b = new THREE.MeshBasicMaterial();
    if (m && m.color) b.color.copy(m.color);
    b.map = m && m.map || null;
    b.opacity = (m && m.opacity!=null)? m.opacity : 1;
    b.transparent = (m && m.transparent) || b.opacity<1;
    b.side = m && m.side || THREE.FrontSide;
    b.depthWrite = m && m.depthWrite;
    b.depthTest = m && m.depthTest;
    b.alphaMap = m && m.alphaMap || null;
    b.toneMapped = false;
    // white keyも有効なら適用（テクスチャがある場合のみ）
    if (state.whiteKeyEnabled) patchWhiteKey(b, state.whiteKeyThreshold);
    return b;
  }
  function setUnlit(on, index){
    if (on){
      forEachTarget(index, (mesh)=>{
        if (mesh.userData.__origMaterial) return;
        const orig = mesh.material;
        mesh.userData.__origMaterial = orig;
        mesh.material = Array.isArray(orig) ? orig.map(cloneAsBasic) : cloneAsBasic(orig);
        if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true)); else mesh.material.needsUpdate = true;
      });
    } else {
      // OFF時は index に関係なく「差し替え済みのメッシュ全部」を元に戻す（複数回切替に強い）
      state.current?.traverse(obj=>{
        if (!obj.isMesh) return;
        if (obj.userData.__origMaterial){
          obj.material = obj.userData.__origMaterial;
          delete obj.userData.__origMaterial;
          if (Array.isArray(obj.material)) obj.material.forEach(m=> m && (m.needsUpdate=true)); else obj.material.needsUpdate = true;
        }
      });
    }
  }

  function setBackground(hex){ scene.background = new THREE.Color(hex); }
  function setProjection(mode){
    if (mode === 'ortho'){
      if (!state.ortho){
        const w = mount.clientWidth, h = mount.clientHeight;
        const fr = 0.8;
        state.ortho = new THREE.OrthographicCamera(-fr*w/h, fr*w/h, fr, -fr, 0.01, 1000);
      }
      state.ortho.position.copy(camera.position);
      state.ortho.quaternion.copy(camera.quaternion);
      controls.object = state.ortho;
    } else {
      controls.object = camera;
    }
    controls.update();
  }
  function setViewPreset(vp){
    const target = controls.target.clone();
    const r = 1.2;
    if (vp==='top') camera.position.set(target.x, target.y + r, target.z);
    else if (vp==='bottom') camera.position.set(target.x, target.y - r, target.z);
    else if (vp==='left') camera.position.set(target.x - r, target.y, target.z);
    else if (vp==='right') camera.position.set(target.x + r, target.y, target.z);
    else if (vp==='front') camera.position.set(target.x, target.y, target.z + r);
    else if (vp==='back') camera.position.set(target.x, target.y, target.z - r);
    camera.lookAt(target); controls.update();
  }
  function raycastFromClientXY(clientX, clientY){
    if (!state.current) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ( (clientX - rect.left) / rect.width ) * 2 - 1;
    const y = -( (clientY - rect.top) / rect.height ) * 2 + 1;
    const mouse = new THREE.Vector2(x, y);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, controls.object || camera);
    const hits = raycaster.intersectObject(state.current, true);
    return hits && hits[0] || null;
  }
  function projectToScreen(vec3){
    const v = vec3.clone().project(controls.object || camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x:(v.x*0.5+0.5)*rect.width, y:(-v.y*0.5+0.5)*rect.height };
  }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    setWhiteKey, setWhiteKeyEnabled,
    raycastFromClientXY, projectToScreen,
    getMaterials: ()=> state.materials,
    setSpin: (on)=> state.spin = !!on,
    setBackground, setProjection, setViewPreset
  };
}

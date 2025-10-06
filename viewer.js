console.log('[viewer] ready');

if (!window.__threeSingleton){
  window.__threeSingleton = (async ()=>{
    if (window.THREE) { return { THREE: window.THREE, baseUrl: null, module: null }; }

    const candidates = [
      './lib/three/build/three.module.js',
      '../lib/three/build/three.module.js',
      'https://unpkg.com/three@0.160.1/build/three.module.js',
    ];

    let mod = null, chosen = null;
    for (const url of candidates){
      try{
        console.log('[viewer] trying', url);
        mod = await import(url);
        chosen = url;
        break;
      }catch(e){
        console.log('[viewer] three candidate failed:', url, e?.message || e);
      }
    }
    if (!mod) throw new Error('THREE unavailable');

    const baseUrl = chosen && chosen.includes('/build/three.module.js')
      ? chosen.replace('/build/three.module.js','')
      : 'https://unpkg.com/three@0.160.1';

    return { THREE: mod, baseUrl, module: mod };
  })();
}

async function ensureThree(){
  return await window.__threeSingleton;
}

async function importExample(path){
  const { baseUrl } = await ensureThree();
  const url = `${baseUrl}/examples/jsm/${path}`;
  return await import(url);
}

let _state = {
  scene: null,
  renderer: null,
  camera: null,
  controls: null,
  currentRoot: null,
  unlit: false,
  originalMaterials: new Map(), // mesh -> material
};

function makeAppApi(){
  return {
    ensure,
    loadByInput,
    setHSLOpacity,
    toggleUnlit,
    onceReady: async ()=>{},
  };
}

export async function ensureViewer(){
  const viewer = await ensure();
  window.app = window.app || {};
  window.app.viewer = viewer;
  return viewer;
}

export async function ensure(){
  const { THREE, module } = await ensureThree();

  // Canvas
  const canvas = document.getElementById('viewer');
  if (!canvas) {
    console.error('canvas#viewer not found');
    throw new Error('canvas#viewer not found');
  }

  // Renderer
  const renderer = new module.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.outputColorSpace = module.SRGBColorSpace;

  // Scene & Camera
  const scene = new module.Scene();
  const camera = new module.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(0, 1.5, 3);

  // Light
  const hemi = new module.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);
  const dir = new module.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  // Controls
  const { OrbitControls } = await importExample('controls/OrbitControls.js');
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Resize
  function resize(){
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight || window.innerHeight;
    if (canvas.width !== w || canvas.height !== h){
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // Animate
  function animate(){
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  _state = { ..._state, scene, renderer, camera, controls };

  return makeAppApi();
}

async function loadByInput({ urlInput, fileInput } = {}){
  const { module } = await ensureThree();
  const { GLTFLoader } = await importExample('loaders/GLTFLoader.js');

  const loader = new GLTFLoader();

  // cleanup old
  if (_state.currentRoot){
    _state.scene.remove(_state.currentRoot);
    _state.currentRoot.traverse(obj=>{
      if (obj.isMesh){
        obj.geometry?.dispose?.();
        if (obj.material?.dispose) obj.material.dispose();
      }
    });
    _state.currentRoot = null;
    _state.originalMaterials.clear();
  }

  let src = null;
  if (urlInput && urlInput.value) {
    src = urlInput.value.trim();
  } else if (fileInput && fileInput.files && fileInput.files[0]) {
    src = URL.createObjectURL(fileInput.files[0]);
  } else {
    console.warn('[viewer] no input to load');
    return;
  }

  const gltf = await loader.loadAsync(src);
  const root = gltf.scene || gltf.scenes?.[0];
  _state.scene.add(root);
  _state.currentRoot = root;
  root.updateMatrixWorld(true);

  // store originals for unlit toggle
  root.traverse(obj=>{
    if (obj.isMesh && obj.material){
      _state.originalMaterials.set(obj, obj.material);
    }
  });

  console.log('[viewer] GLB loaded');
}

function setHSLOpacity({h=0, s=0, l=0, opacity=1} = {}){
  const { module } = window.__threeSingleton ? {} : {};
  const root = _state.currentRoot;
  if (!root) return;

  root.traverse(obj=>{
    if (!obj.isMesh) return;
    const m = obj.material;
    if (!m) return;

    // 透明度
    m.transparent = opacity < 1 ? true : m.transparent;
    m.opacity = opacity;

    // HSL調整（元色がなければ保存してから調整）
    if (!m.userData.__baseColor){
      m.userData.__baseColor = m.color ? m.color.clone() : null;
    }
    if (m.color && m.userData.__baseColor){
      const base = m.userData.__baseColor.clone();
      let hh=0, ss=0, ll=0;
      base.getHSL({h:hh,s:ss,l:ll});
      const nh = (hh + h) % 1;
      const ns = Math.max(0, Math.min(1, ss + s));
      const nl = Math.max(0, Math.min(1, ll + l));
      m.color.setHSL(nh, ns, nl);
    }

    m.needsUpdate = true;
  });
}

async function toggleUnlit(){
  const { module } = await ensureThree();
  const root = _state.currentRoot;
  if (!root) return;

  _state.unlit = !_state.unlit;

  root.traverse(obj=>{
    if (!obj.isMesh) return;

    if (_state.unlit){
      // to unlit (MeshBasicMaterial)
      if (!_state.originalMaterials.has(obj) && obj.material){
        _state.originalMaterials.set(obj, obj.material);
      }
      const src = _state.originalMaterials.get(obj) || obj.material;
      const basic = new module.MeshBasicMaterial({
        map: src.map || null,
        color: src.color?.clone() || 0xffffff,
        transparent: src.transparent || src.opacity < 1,
        opacity: src.opacity ?? 1,
        side: src.side,
        depthWrite: src.depthWrite,
        depthTest: src.depthTest,
      });
      obj.material = basic;
    }else{
      // restore
      const orig = _state.originalMaterials.get(obj);
      if (orig) obj.material = orig;
    }
  });
}

export { ensure as __ensure_for_debug, loadByInput, setHSLOpacity, toggleUnlit };

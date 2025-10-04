// features/viewer_host.js
// Always-on three.js viewer host. Listens for 'lmy:load-glb-blob' and renders.
const log = (...a)=>console.log('[viewer_host]', ...a);

let THREE, GLTFLoader, OrbitControls;
let renderer, scene, camera, controls, loader;

function ensureStage() {
  let stage = document.getElementById('stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);
  }
  Object.assign(stage.style, { position:'fixed', inset:'0', zIndex:'0' });
  return stage;
}

async function boot() {
  log('boot');
  const stage = ensureStage();

  // Dynamic ESM imports (adjust paths if your libs are elsewhere)
  const threeMod = await import('../lib/three.module.js');
  THREE = threeMod;
  ({ GLTFLoader } = await import('../lib/GLTFLoader.js'));
  ({ OrbitControls } = await import('../lib/OrbitControls.js'));

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.01, 1e6);
  camera.position.set(2, 2, 2);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 1));

  loader = new GLTFLoader();

  window.addEventListener('resize', () => {
    const w = stage.clientWidth, h = stage.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  function tick(){
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  // Bridge: accept GLB blobs and render
  window.addEventListener('lmy:load-glb-blob', (ev) => {
    const blob = ev.detail?.blob;
    const name = ev.detail?.name || 'model.glb';
    if (!blob) return;
    log('loading blob…', name, blob.size);

    // Dispose previous
    scene.traverse(o => {
      if (o.isMesh) {
        o.geometry && o.geometry.dispose && o.geometry.dispose();
        if (Array.isArray(o.material)) {
          o.material.forEach(m => m && m.dispose && m.dispose());
        } else if (o.material) {
          o.material.dispose && o.material.dispose();
        }
      }
    });
    // Keep only lights
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const o = scene.children[i];
      if (!o.isLight) scene.remove(o);
    }

    const url = URL.createObjectURL(blob);
    loader.load(url, (gltf) => {
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) {
        console.error('[viewer] no scene in glTF');
        URL.revokeObjectURL(url);
        return;
      }
      scene.add(root);

      // Auto-fit
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = maxDim * 1.8;
      const dir = new THREE.Vector3(1, 0.6, 1).normalize();
      camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
      camera.near = Math.max(dist/1000, 0.01);
      camera.far = dist * 10;
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      controls.target.copy(center);

      URL.revokeObjectURL(url);
      log('model loaded', size);
    }, undefined, (err) => {
      console.error('[viewer] load error', err);
      URL.revokeObjectURL(url);
    });
  });

  log('armed');
}

boot().catch(e=>console.error('[viewer_host] boot failed', e));
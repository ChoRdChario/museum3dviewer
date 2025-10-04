// features/viewer_bootstrap.js
// Self-contained viewer bootstrap that does NOT depend on local three libs.
// - Creates/uses <canvas id="lmy-canvas"> inside #stage
// - Implements __LMY_viewer.loadBlob(blob) using GLTFLoader
// - Listens to 'lmy:load-glb-blob' dispatched by wiring_captions.js

const THREE_URL = 'https://esm.sh/three@0.160.0';
const ORBIT_URL = 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
const GLTF_URL  = 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

let THREE, OrbitControls, GLTFLoader;
let scene, camera, renderer, controls, rafId=null;

async function ensureThree() {
  if (THREE && OrbitControls && GLTFLoader) return;
  const [T, OC, GL] = await Promise.all([
    import(THREE_URL),
    import(ORBIT_URL),
    import(GLTF_URL),
  ]);
  THREE = T;
  OrbitControls = OC.OrbitControls;
  GLTFLoader = GL.GLTFLoader;
}

function ensureCanvas() {
  let canvas = document.getElementById('lmy-canvas');
  if (!canvas) {
    const stage = document.getElementById('stage') || document.body;
    canvas = document.createElement('canvas');
    canvas.id = 'lmy-canvas';
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    stage.appendChild(canvas);
  }
  return canvas;
}

function onResize() {
  if (!renderer || !camera) return;
  const parent = renderer.domElement.parentElement;
  const w = (parent?.clientWidth ?? window.innerWidth) || 1;
  const h = (parent?.clientHeight ?? window.innerHeight) || 1;
  if (camera.isPerspectiveCamera) {
    camera.aspect = w / h;
  } else if (camera.isOrthographicCamera) {
    const aspect = w / h, fr = 1.5;
    camera.left=-fr*aspect; camera.right=fr*aspect; camera.top=fr; camera.bottom=-fr;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
}

function animate(){
  rafId = requestAnimationFrame(animate);
  controls?.update?.();
  renderer.render(scene, camera);
}

function fitToObject(obj){
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = (camera.isPerspectiveCamera ? camera.fov : 60) * Math.PI/180;
  const dist = (maxDim / (2*Math.tan(fov/2))) * 1.4;
  const dir = new THREE.Vector3(0.7,0.5,1).normalize();
  controls.target.copy(center);
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist/100; camera.far = dist*100; camera.updateProjectionMatrix();
  controls.update();
  renderer.render(scene, camera);
}

async function initViewer(){
  await ensureThree();
  const canvas = ensureCanvas();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, canvas.clientWidth/canvas.clientHeight || 1, 0.01, 10000);
  camera.position.set(0,1,3);
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(canvas.clientWidth||1, canvas.clientHeight||1, false);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  window.addEventListener('resize', onResize, { passive:true });
  onResize();
  if (rafId==null) animate();
}

async function loadBlob(blob){
  await initViewer();
  const ab = await blob.arrayBuffer();
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject)=>{
    loader.parse(ab, '', (gltf)=>{
      // clear previous model
      for (let i = scene.children.length - 1; i >= 0; i--) {
        const c = scene.children[i];
        if (c?.userData?.isMainModel) scene.remove(c);
      }
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root){ reject(new Error('GLTF has no scene')); return; }
      root.userData.isMainModel = true;
      root.traverse(o=>{
        if (o.isMesh && o.material){
          o.material.depthWrite = true;
          if ('transparent' in o.material) {
            o.material.transparent = !!(o.material.alphaMap || o.material.opacity < 1.0);
          }
        }
      });
      scene.add(root);
      fitToObject(root);
      resolve(gltf);
    }, (err)=> reject(err));
  });
}

(function bootstrap(){
  // expose a stable viewer API for the rest of the app
  window.__LMY_viewer = {
    loadBlob,
    async setOrthographic(){
      await initViewer();
      if (camera.isOrthographicCamera) return;
      const { position, near, far } = camera;
      const aspect = (renderer.domElement.clientWidth/renderer.domElement.clientHeight) || 1;
      const fr=1.5;
      const cam = new THREE.OrthographicCamera(-fr*aspect, fr*aspect, fr, -fr, 0.01, 10000);
      cam.position.copy(position); cam.near=near; cam.far=far;
      controls.object = cam; camera = cam; onResize();
    },
    async setPerspective(){
      await initViewer();
      if (camera.isPerspectiveCamera) return;
      const { position, near, far } = camera;
      const cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10000);
      cam.position.copy(position); cam.near=near; cam.far=far;
      controls.object = cam; camera = cam; onResize();
    },
    get three(){ return { THREE, scene, camera, renderer, controls }; }
  };
  // listen for app event
  document.addEventListener('lmy:load-glb-blob', async (e)=>{
    try{
      const blob = e?.detail?.blob;
      if (!blob) return;
      await loadBlob(blob);
      console.log('[viewer] model loaded');
    }catch(err){
      console.warn('[viewer] load failed', err);
    }
  }, { passive: true });
  console.log('[viewer_bootstrap] ready');
})();

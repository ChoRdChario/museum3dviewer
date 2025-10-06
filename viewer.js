
// viewer.js — keeps existing UI; no DOM injection; exports a small Viewer API
// Logs
console.log('[viewer] module loaded');

let THREEMod = null;

async function importAttempt(url){
  try{
    const mod = await import(url);
    return mod;
  }catch(err){
    console.warn('[viewer] import failed:', url, err.message || err);
    return null;
  }
}

async function ensureThree() {
  if (THREEMod) return THREEMod;
  // Try repo-local candidates first (do not change UI/structure)
  const tries = [
    './lib/three/build/three.module.js',
    '../lib/three/build/three.module.js',
    'https://unpkg.com/three@0.160.1/build/three.module.js'
  ];
  for (const u of tries) {
    const mod = await importAttempt(u);
    if (mod && mod.WebGLRenderer) {
      THREEMod = mod;
      console.log('[viewer] three ok via', u);
      return THREEMod;
    }
  }
  throw new Error('three.js could not be loaded');
}

function
getCanvas() {
  const c = document.querySelector('canvas#viewer');
  if (!c) {
    throw new Error('canvas#viewer not found');
  }
  return c;
}

// very small material edit helpers — non-destructive shims
function applyHSLOpacityToMaterials(scene, {h=0,s=0,l=0,opacity=1}={}){
  scene.traverse((obj)=>{
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    if (m.color){
      // shift hue/sat/light approximately by converting to HSL
      const c = m.color.clone();
      c.getHSL(m._tmpHSL || (m._tmpHSL = {h:0,s:0,l:0}));
      m._tmpHSL.h = (m._tmpHSL.h + h) % 1;
      m._tmpHSL.s = Math.min(1, Math.max(0, m._tmpHSL.s + s));
      m._tmpHSL.l = Math.min(1, Math.max(0, m._tmpHSL.l + l));
      c.setHSL(m._tmpHSL.h, m._tmpHSL.s, m._tmpHSL.l);
      m.color.copy(c);
    }
    if ('opacity' in m) {
      m.transparent = opacity < 1 ? true : m.transparent;
      m.opacity = opacity;
    }
    m.needsUpdate = true;
  });
}

// Drive helpers (no UI changes)
async function fetchDriveArrayBuffer({fileId, token}){
  if (!fileId) throw new Error('fileId required');
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {headers});
  if (!res.ok) throw new Error(`Drive fetch failed ${res.status}`);
  return await res.arrayBuffer();
}

async function parseGLBToScene(THREE, arrayBuffer){
  const { GLTFLoader } = await import('https://esm.sh/three@0.160.1/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject)=>{
    loader.parse(arrayBuffer, '', (gltf)=>resolve(gltf.scene), reject);
  });
}

// minimal render loop
function startLoop(THREE, renderer, scene, camera){
  function loop(){
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
}

export async function ensureViewer(app){
  const THREE = await ensureThree();
  const canvas = getCanvas(); // throws if not found (UIは既存を尊重)
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth||800)/(canvas.clientHeight||600), 0.1, 5000);
  camera.position.set(0, 1, 3);
  scene.add(camera);

  // controls (import via esm.sh referencing same THREE)
  const { OrbitControls } = await import('https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js');
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  startLoop(THREE, renderer, scene, camera);

  // expose small api that matches existing UI expectations
  const api = {
    async loadByInput(){
      const input =
        document.querySelector('#drive-id') ||
        document.querySelector('#fileid') ||
        document.querySelector('input[name="fileid"]') ||
        document.querySelector('input[placeholder*="Drive"]') ||
        document.querySelector('input[type="text"]');
      const fileId = input && input.value ? input.value.trim() : '';
      if (!fileId) throw new Error('Enter Google Drive file id');

      const token = app?.auth?.getAccessToken ? app.auth.getAccessToken() : null;
      if (!token) throw new Error('Not signed in. Click "Sign in" first.');

      const abuf = await fetchDriveArrayBuffer({fileId, token});
      const obj = await parseGLBToScene(THREE, abuf);
      // reset scene
      while (scene.children.length) scene.remove(scene.children[0]);
      scene.add(camera);
      scene.add(obj);
      console.log('[viewer] GLB loaded');
    },
    setHSLOpacity(h=0,s=0,l=0,opacity=1){
      applyHSLOpacityToMaterials(scene, {h,s,l,opacity});
    },
    toggleUnlit(flag){
      // very conservative: just flip toneMapping
      renderer.toneMappingExposure = flag ? 1.0 : 1.0;
      scene.traverse(o=>{
        if (!o.isMesh || !o.material) return;
        o.material.needsUpdate = true;
      });
    },
    setDoubleSide(flag){
      scene.traverse(o=>{
        if (!o.isMesh || !o.material) return;
        o.material.side = flag ? THREE.DoubleSide : THREE.FrontSide;
        o.material.needsUpdate = true;
      });
    },
    setWhiteKey(v) { /* placeholder for UI compatibility */ },
    setWhiteKeyAlphaEnabled(flag){ /* placeholder */ },
  };

  app.viewer = api;
  return api;
}

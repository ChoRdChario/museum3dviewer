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

  const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 1000);
  camera.position.set(2.5, 2, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
  scene.add(hemi);

  const box = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({ color: 0x4da3ff, metalness:.2, roughness:.4 }));
  scene.add(box);

  const state = { current: box, materials: [], spin:true };

  function onResize() {
    const w = mount.clientWidth, h = mount.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(onResize).observe(mount);

  (function tick(){
    if (state.spin && state.current) state.current.rotation.y += 0.01;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();

  function frameToObject(obj){
    const box3 = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box3.getSize(size);
    const center = new THREE.Vector3(); box3.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.6;
    camera.position.copy(center).add(new THREE.Vector3(dist, dist*0.8, dist));
    controls.target.copy(center);
    camera.near = Math.max(0.01, maxDim/1000);
    camera.far = Math.max(1000, dist*10);
    camera.updateProjectionMatrix();
    controls.update();
  }

  async function loadGLBFromArrayBuffer(buf) {
    const url = URL.createObjectURL(new Blob([buf]));
    try{
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error('GLB has no scene');
      // Prepare materials list
      const mats = [];
      root.traverse((o)=>{ if (o.isMesh && o.material) {
        mats.push(o.material);
        if (!o.name) o.name = 'mesh_' + mats.length;
      }});
      // Swap into scene (stop cube spin)
      if (state.current) scene.remove(state.current);
      state.spin = false;
      scene.add(root);
      state.current = root;
      state.materials = mats;
      frameToObject(root);
      // notify UI
      const matInfos = mats.map((m,i)=>({ index:i, name:(m.name||('mat_'+i)) }));
      window.dispatchEvent(new CustomEvent('lmy:model-loaded', { detail: { materials: matInfos }}));
      console.log('[viewer] GLB loaded; meshes:', mats.length);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setHSL(h, s, l, index=null) {
    const arr = (index===null) ? state.materials : [state.materials[index]].filter(Boolean);
    for (const m of arr) {
      if (!m || !m.color) continue;
      const c = new THREE.Color(); c.setHSL(h/360, s/100, l/100);
      m.color.copy(c);
      m.needsUpdate = true;
    }
  }
  function setOpacity(p, index=null) {
    const arr = (index===null) ? state.materials : [state.materials[index]].filter(Boolean);
    for (const m of arr) {
      if (!m) continue;
      m.transparent = p < 1.0;
      m.opacity = p;
      m.needsUpdate = true;
    }
  }
  function setUnlit(on, index=null) {
    const arr = (index===null) ? state.materials : [state.materials[index]].filter(Boolean);
    for (const m of arr) {
      m.onBeforeCompile = (shader)=>{};
      m.needsUpdate = true;
    }
  }
  function setDoubleSide(on, index=null) {
    const arr = (index===null) ? state.materials : [state.materials[index]].filter(Boolean);
    for (const m of arr) {
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
  }

  const raycaster = new THREE.Raycaster();
  function raycastFromClientXY(clientX, clientY){
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({x,y}, camera);
    const hits = raycaster.intersectObjects([state.current], true);
    if (hits.length) return hits[0];
    return null;
  }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    raycastFromClientXY,
    getMaterials: ()=> state.materials,
    setSpin: (on)=> state.spin = !!on
  };
}

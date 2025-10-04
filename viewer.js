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

  // Cameras (persp + ortho)
  const persp = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 5000);
  persp.position.set(2.5, 2, 3);

  const frustum = 2.5;
  const ortho = new THREE.OrthographicCamera(-frustum, frustum, frustum, -frustum, 0.01, 5000);
  ortho.position.set(2.5, 2, 3);

  let camera = persp;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  function switchCamera(to){
    const prevTarget = controls.target.clone();
    camera = (to === 'ortho') ? ortho : persp;
    controls.object = camera;
    controls.target.copy(prevTarget);
    camera.updateProjectionMatrix();
  }

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
  scene.add(hemi);

  const box = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({ color: 0x4da3ff, metalness:.2, roughness:.4 }));
  scene.add(box);

  const state = { current: box, materials: [], spin:true };

  function onResize() {
    const w = mount.clientWidth, h = mount.clientHeight || 1;
    renderer.setSize(w, h);
    persp.aspect = w / h; persp.updateProjectionMatrix();
    const aspect = w / h;
    const height = frustum;
    ortho.left   = -height * aspect;
    ortho.right  =  height * aspect;
    ortho.top    =  height;
    ortho.bottom = -height;
    ortho.updateProjectionMatrix();
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
    persp.position.copy(center).add(new THREE.Vector3(dist, dist*0.8, dist));
    ortho.position.copy(persp.position);
    controls.target.copy(center);
    persp.near = Math.max(0.01, maxDim/1000);
    persp.far = Math.max(1000, dist*10);
    persp.updateProjectionMatrix();
    onResize();
    controls.update();
  }

  async function loadGLBFromArrayBuffer(buf) {
    const url = URL.createObjectURL(new Blob([buf]));
    try{
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error('GLB has no scene');
      const mats = [];
      root.traverse((o)=>{ if (o.isMesh && o.material) mats.push(o.material); });
      if (state.current) scene.remove(state.current);
      state.spin = false;
      scene.add(root);
      state.current = root;
      state.materials = mats;
      frameToObject(root);
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

  function setBackground(hex){ scene.background = new THREE.Color(hex); }
  function setProjection(mode){ switchCamera(mode==='ortho'?'ortho':'persp'); }
  function setViewPreset(preset){
    const t = controls.target.clone();
    const d = 3;
    if (preset==='front')   camera.position.set(t.x, t.y, t.z + d);
    if (preset==='back')    camera.position.set(t.x, t.y, t.z - d);
    if (preset==='left')    camera.position.set(t.x - d, t.y, t.z);
    if (preset==='right')   camera.position.set(t.x + d, t.y, t.z);
    if (preset==='top')     camera.position.set(t.x, t.y + d, t.z);
    if (preset==='bottom')  camera.position.set(t.x, t.y - d, t.z);
    if (preset==='iso')     camera.position.set(t.x + d, t.y + d*0.8, t.z + d);
    camera.updateProjectionMatrix();
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

  function projectToScreen(vec3){
    const v = vec3.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    return { x:sx, y:sy };
  }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    raycastFromClientXY, projectToScreen,
    getMaterials: ()=> state.materials,
    setSpin: (on)=> state.spin = !!on,
    setBackground, setProjection, setViewPreset
  };
}

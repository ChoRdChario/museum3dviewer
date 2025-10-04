// viewer.js — stable module, no syntax errors; implements required API
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

  // Lights (will be ignored in Unlit)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 5, 5);
  scene.add(dir);

  const state = {
    current: null,
    materials: [],           // unique materials
    spin: true,
    ortho: null
  };

  const clock = new THREE.Clock();
  (function loop(){
    requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    if (state.current && state.spin) {
      state.current.rotation.y += 0.15 * clock.getDelta();
    }
    controls.update();
    renderer.render(scene, camera);
  })();

  window.addEventListener('resize', ()=>{
    const w = mount.clientWidth, h = mount.clientHeight;
    renderer.setSize(w, h);
    if (state.ortho) {
      const frustum = 0.8;
      state.ortho.left = -frustum * w/h;
      state.ortho.right = frustum * w/h;
      state.ortho.top = frustum;
      state.ortho.bottom = -frustum;
      state.ortho.updateProjectionMatrix();
    } else {
      camera.aspect = w/h;
      camera.updateProjectionMatrix();
    }
  });

  function frameToObject(obj){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    camera.position.copy(center).add(new THREE.Vector3(dist, dist*0.6, dist));
    camera.near = dist/1000; camera.far = dist*10; camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  async function loadGLBFromArrayBuffer(buf) {
    const url = URL.createObjectURL(new Blob([buf]));
    try{
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) throw new Error('GLB has no scene');

      if (state.current) scene.remove(state.current);
      state.spin = false;
      scene.add(root);
      state.current = root;

      // gather unique materials by uuid
      const uniq = new Map();
      root.traverse(o=>{
        if (!o.isMesh) return;
        const add=(m)=>{ if(m && !uniq.has(m.uuid)) uniq.set(m.uuid, m); };
        if (Array.isArray(o.material)) o.material.forEach(add);
        else add(o.material);
      });
      state.materials = Array.from(uniq.values());

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
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{
        if (!m || !m.color) return;
        const c = m.color.clone();
        const hsl = {}; c.getHSL(hsl);
        hsl.h = (h/360 + hsl.h) % 1;
        hsl.s = Math.max(0, Math.min(1, s/100));
        hsl.l = Math.max(0, Math.min(1, l/100));
        m.color.setHSL(hsl.h, hsl.s, hsl.l);
        m.needsUpdate = true;
      });
    });
  }

  function setOpacity(val, index){
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{
        if (!m) return;
        m.opacity = val;
        m.transparent = val < 0.999;
        m.needsUpdate = true;
      });
    });
  }

  function setDoubleSide(on, index){
    forEachTarget(index, (mesh, mats)=>{
      mats.forEach(m=>{ if (!m) return; m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; });
    });
  }

  function setUnlit(on, index){
    forEachTarget(index, (mesh)=>{
      if (on){
        if (mesh.userData.__origMaterial) return;
        const mk = (m)=>{
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
          return b;
        };
        const orig = mesh.material;
        mesh.userData.__origMaterial = orig;
        mesh.material = Array.isArray(orig) ? orig.map(mk) : mk(orig);
        if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true));
        else mesh.material.needsUpdate = true;
      } else {
        if (!mesh.userData.__origMaterial) return;
        mesh.material = mesh.userData.__origMaterial;
        delete mesh.userData.__origMaterial;
        if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true));
        else mesh.material.needsUpdate = true;
      }
    });
  }

  function setBackground(hex){ scene.background = new THREE.Color(hex); }

  function setProjection(mode){
    if (mode === 'ortho'){
      if (!state.ortho){
        const w = mount.clientWidth, h = mount.clientHeight;
        const frustum = 0.8;
        state.ortho = new THREE.OrthographicCamera(-frustum*w/h, frustum*w/h, frustum, -frustum, 0.01, 1000);
      }
      // copy pose
      state.ortho.position.copy(camera.position);
      state.ortho.quaternion.copy(camera.quaternion);
      controls.object = state.ortho;
    }else{
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
    camera.lookAt(target);
    controls.update();
  }

  function raycastFromClientXY(clientX, clientY){
    if (!state.current) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ( (clientX - rect.left) / rect.width ) * 2 - 1;
    const y = -( (clientY - rect.top) / rect.height ) * 2 + 1;
    const mouse = new THREE.Vector2(x, y);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, controls.object);
    const hits = raycaster.intersectObject(state.current, true);
    return hits && hits[0] || null;
  }

  function projectToScreen(vec3){
    const v = vec3.clone().project(controls.object);
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

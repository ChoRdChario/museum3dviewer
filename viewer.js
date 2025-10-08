// viewer.js - v6.6 patched
const THREE_URL = 'https://unpkg.com/three@0.157.0/build/three.module.js';
const GLTF_URL  = 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';
const ORBIT_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

export async function ensureViewer({ mount, spinner }) {
  const THREE = await import(THREE_URL);
  const { OrbitControls } = await import(ORBIT_URL);
  const { GLTFLoader } = await import(GLTF_URL);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha:false });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.sortObjects = true;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / Math.max(1,mount.clientHeight), 0.1, 2000);
  camera.position.set(2.5, 2, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
  scene.add(hemi);

  const state = {
    current: null,
    materials: [],            // unique THREE.Material[]
    targetIndex: -1,          // -1 = all
  };

  function collectUniqueMaterials(root){
    const arr = [];
    const seen = new Set();
    root.traverse((o)=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats){
          const key = m.uuid;
          if (!seen.has(key)){
            seen.add(key);
            arr.push(m);
          }
          // transparent draw order safety
          m.depthWrite = !m.transparent;
        }
      }
    });
    return arr;
  }

  function applyToTargets(fn){
    const mats = state.targetIndex < 0 ? state.materials : [state.materials[state.targetIndex]].filter(Boolean);
    for (const m of mats) fn(m);
  }

  function animate(){
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  function onResize(){
    const w = mount.clientWidth, h = Math.max(1, mount.clientHeight);
    renderer.setSize(w,h);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(onResize).observe(mount);

  async function loadGLBFromArrayBuffer(buf){
    // clear previous
    if (state.current){
      scene.remove(state.current);
      state.current.traverse?.((o)=>{
        if (o.geometry) o.geometry.dispose();
      });
    }
    const { GLTFLoader } = await import(GLTF_URL);
    const blob = new Blob([buf], {type:'model/gltf-binary'});
    const url = URL.createObjectURL(blob);
    try{
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error('GLB has no scene');
      scene.add(root);
      state.current = root;
      state.materials = collectUniqueMaterials(root);
      state.targetIndex = -1;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // === material helpers ===
  function ensureBackup(m){
    if (!m.userData._lmy) m.userData._lmy = {};
    const u = m.userData._lmy;
    if (!u.backup){
      // minimal clone of togglable props
      u.backup = {
        type: m.type,
        color: m.color ? m.color.clone() : null,
        map: m.map || null,
        side: m.side,
        transparent: m.transparent,
        opacity: m.opacity,
        toneMapped: m.toneMapped,
        lights: m.lights ?? true,
        onBeforeCompile: m.onBeforeCompile || null,
      };
    }
    return u;
  }

  function setHSL(h, s, l){
    applyToTargets((m)=>{
      if (!m.color) return;
      const c = new THREE.Color();
      c.setHSL(h/360, s/100, l/100);
      m.color.copy(c);
      m.needsUpdate = true;
    });
  }

  function setOpacity(p){
    applyToTargets((m)=>{
      m.transparent = p < 1.0 || m.userData._lmy?.whiteKeyEnabled;
      m.opacity = p;
      m.depthWrite = !m.transparent;
      m.needsUpdate = true;
    });
  }

  function setUnlit(on){
    applyToTargets((m)=>{
      const u = ensureBackup(m);
      if (on){
        if (m.type !== 'MeshBasicMaterial'){
          // switch to basic while keeping map/opacity/etc
          const basic = new THREE.MeshBasicMaterial({
            map: m.map || null,
            color: m.color ? m.color.clone() : 0xffffff,
            transparent: m.transparent,
            opacity: m.opacity,
            side: m.side,
            depthWrite: m.depthWrite,
            toneMapped: false,
          });
          // mark & swap
          u.swapped = m;
          u.swappedOriginal = m; // keep reference
          Object.setPrototypeOf(m, THREE.MeshBasicMaterial.prototype);
          Object.assign(m, basic);
          m.needsUpdate = true;
        }
      } else {
        // restore by reapplying backup on the same instance
        if (u.backup){
          m.onBeforeCompile = u.backup.onBeforeCompile;
          m.toneMapped = u.backup.toneMapped;
          m.lights = u.backup.lights;
          m.transparent = u.backup.transparent;
          m.opacity = u.backup.opacity;
          m.side = u.backup.side;
          if (u.backup.color && m.color) m.color.copy(u.backup.color);
          m.map = u.backup.map;
          // revert prototype if needed
          if (m.type !== u.backup.type){
            // reconstruct original Standard material-ish
            const std = new THREE.MeshStandardMaterial({
              map: m.map,
              color: (u.backup.color||new THREE.Color(0xffffff)),
              transparent: m.transparent,
              opacity: m.opacity,
              side: m.side,
              depthWrite: m.depthWrite,
            });
            Object.setPrototypeOf(m, THREE.MeshStandardMaterial.prototype);
            Object.assign(m, std);
          }
          m.needsUpdate = true;
        }
      }
    });
  }

  function setDoubleSide(on){
    applyToTargets((m)=>{
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    });
  }

  // --- white key (white -> alpha) ---
  function installWhiteKeyShader(m){
    const u = ensureBackup(m);
    if (u.whiteKeyInstalled) return;
    u.whiteKeyInstalled = true;
    m.onBeforeCompile = (shader)=>{
      shader.uniforms.uWhiteKey = { value: (u.whiteKeyThreshold ?? 0.97) };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float w = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
         if (w >= uWhiteKey) { gl_FragColor.a = 0.0; }
        `
      );
    };
    m.transparent = true;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  function setWhiteKeyEnabled(on){
    applyToTargets((m)=>{
      const u = ensureBackup(m);
      u.whiteKeyEnabled = on;
      if (on) installWhiteKeyShader(m);
      else {
        // restore shader
        m.onBeforeCompile = u.backup?.onBeforeCompile || null;
        m.needsUpdate = true;
        // transparency might be controlled by opacity separately
        if (!m.transparent || (m.transparent && m.opacity>=1.0)){
          m.depthWrite = true;
        }
      }
    });
  }
  function setWhiteKeyThreshold(t){
    applyToTargets((m)=>{
      const u = ensureBackup(m);
      u.whiteKeyThreshold = t;
      installWhiteKeyShader(m);
      m.needsUpdate = true;
    });
  }

  function setMaterialTarget(index){
    state.targetIndex = index; // -1 = all
  }

  // === Picking: provide raycastFromClientXY used by pins.js ===
  // returns THREE.Intersection or null
  const _raycaster = new THREE.Raycaster();
  function raycastFromClientXY(evOrX, yOpt){
    const canvas = renderer?.domElement;
    if (!canvas || !camera) return null;

    // allow (event) or (x, y)
    let x, y;
    if (typeof evOrX === 'number') { x = evOrX; y = yOpt; }
    else { x = evOrX?.clientX; y = evOrX?.clientY; }
    if (typeof x !== 'number' || typeof y !== 'number') return null;

    const r = canvas.getBoundingClientRect();
    const ndcX = ((x - r.left) / r.width) * 2 - 1;
    const ndcY = -((y - r.top)  / r.height) * 2 + 1;

    _raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);

    // pick from the model root if loaded、未ロード時は scene 全体
    const root = state.current || scene;
    const hits = _raycaster.intersectObjects(root.children, true);
    return (hits && hits.length) ? hits[0] : null;
  }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    loadGLB: loadGLBFromArrayBuffer, // alias
    setMaterialTarget,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    setWhiteKeyEnabled, setWhiteKeyThreshold,
    raycastFromClientXY, // ← 追加
  };
}

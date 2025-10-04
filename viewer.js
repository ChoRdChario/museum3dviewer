// viewer.js — material slot–aware ops (opacity/unlit/white-key), robust APIs
const THREE_URL = 'three';
const GLTF_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';
const ORBIT_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

export async function ensureViewer({ mount, spinner }) {
  const THREE = await import(THREE_URL);
  const { OrbitControls } = await import(ORBIT_URL);
  const { GLTFLoader } = await import(GLTF_URL);

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const persp = new THREE.PerspectiveCamera(45, mount.clientWidth/mount.clientHeight, 0.01, 2000);
  persp.position.set(0.6, 0.5, 1.1);
  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5,5,5); scene.add(dir);

  const state = {
    current: null,
    materials: [],            // unique originals
    spin: false,
    ortho: null,
    whiteKeyEnabled: false,
    whiteKeyThreshold: 1.0,   // 0..1
  };

  function renderLoop(){
    requestAnimationFrame(renderLoop);
    if (state.current && state.spin) state.current.rotation.y += 0.01;
    controls.update();
    renderer.render(scene, controls.object || persp);
  }
  renderLoop();

  window.addEventListener('resize', ()=>{
    const w = mount.clientWidth, h = mount.clientHeight;
    renderer.setSize(w,h);
    if (state.ortho){
      const fr = 0.8;
      state.ortho.left = -fr*w/h; state.ortho.right = fr*w/h; state.ortho.top = fr; state.ortho.bottom = -fr;
      state.ortho.updateProjectionMatrix();
    }else{
      persp.aspect = w/h; persp.updateProjectionMatrix();
    }
  });

  function frame(obj){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const d = Math.max(size.x, size.y, size.z) * 1.8 || 1.0;
    persp.position.copy(center).add(new THREE.Vector3(d, d*0.6, d));
    persp.near = d/1000; persp.far = d*10; persp.updateProjectionMatrix();
    controls.target.copy(center); controls.update();
  }

  async function loadGLBFromArrayBuffer(buf){
    const url = URL.createObjectURL(new Blob([buf]));
    try{
      const { GLTFLoader } = await import(GLTF_URL);
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) throw new Error('no scene');

      if (state.current) scene.remove(state.current);
      scene.add(root); state.current = root;

      // collect unique original materials
      const uniq = new Map();
      root.traverse(o=>{
        if (!o.isMesh) return;
        // initialize slot bookkeeping
        if (!o.userData.__slots) o.userData.__slots = {}; // key: slot index -> {orig, current, unlit:boolean}
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m, idx)=>{
          if (!m) return;
          if (!uniq.has(m.uuid)) uniq.set(m.uuid, m);
          o.userData.__slots[idx] = { orig: m, current: m, unlit: false };
        });
      });
      state.materials = Array.from(uniq.values());

      // if whitekey is enabled, reapply to current materials
      if (state.whiteKeyEnabled){
        applyWhiteKeyToMaterials(state.whiteKeyThreshold, null);
      }

      frame(root);
      const matInfos = state.materials.map((m,i)=>({ index:i, name:(m.name||`mat.${i}`) }));
      console.log('[viewer] GLB loaded; unique materials:', matInfos.length);
      window.dispatchEvent(new CustomEvent('lmy:model-loaded', { detail:{ materials: matInfos }}));
      return { materials: matInfos };
    } finally {
      URL.revokeObjectURL(url);
      spinner?.remove?.();
    }
  }

  // resolve target slots for a material index (or all)
  function forEachTarget(index, fn){
    const targetUUIDs = (index==null) ? new Set(state.materials.map(m=>m.uuid))
                                      : new Set([state.materials[index]?.uuid].filter(Boolean));
    state.current?.traverse(mesh=>{
      if (!mesh.isMesh || !mesh.userData.__slots) return;
      const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
      const indices = [];
      mats.forEach((m, i)=>{
        const slot = mesh.userData.__slots[i];
        const origUUID = slot?.orig?.uuid;
        if (origUUID && targetUUIDs.has(origUUID)) indices.push(i);
      });
      if (indices.length) fn(mesh, mats, indices);
    });
  }

  // --- WhiteKey (cut WHITE via discard) ---
  function patchWhiteKey(material, threshold){
    if (!material || !material.map) return; // keep solid-color intact
    material.userData.__whiteCut = threshold;
    material.onBeforeCompile = function(shader){
      shader.uniforms.uWhiteCut = { value: this.userData.__whiteCut ?? 1.0 };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uWhiteCut;\nvoid main(){')
        .replace(/gl_FragColor\s*=\s*vec4\(([^;]+)\);\s*$/m, (all, inner)=>{
          return `vec4 c = vec4(${inner});
float lum = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
if (lum >= uWhiteCut) { discard; }
gl_FragColor = c;`;
        });
    };
    material.alphaTest = Math.max(0.0001, (threshold||1.0) - 0.001);
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
    forEachTarget(index, (mesh, mats, idxs)=>{
      idxs.forEach(i=> patchWhiteKey(mats[i], threshold));
    });
  }
  function clearWhiteKeyFromMaterials(index){
    forEachTarget(index, (mesh, mats, idxs)=>{
      idxs.forEach(i=> unpatchWhiteKey(mats[i]));
    });
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

  // --- Opacity per slot ---
  function setOpacity(val, index){
    const translucent = val < 0.999;
    forEachTarget(index, (mesh, mats, idxs)=>{
      idxs.forEach(i=>{
        const m = mats[i]; if (!m) return;
        m.opacity = val;
        m.transparent = translucent;
        m.depthWrite = !translucent;
        m.depthTest = true;
        m.needsUpdate = true;
      });
      // reflect array change back to mesh.material if needed
      if (Array.isArray(mesh.material)) mesh.material = mats;
    });
  }

  // --- Double-side per slot ---
  function setDoubleSide(on, index){
    forEachTarget(index, (mesh, mats, idxs)=>{
      idxs.forEach(i=>{ const m=mats[i]; if (m){ m.side = on? THREE.DoubleSide:THREE.FrontSide; m.needsUpdate=true; } });
      if (Array.isArray(mesh.material)) mesh.material = mats;
    });
  }

  // --- Unlit per slot (no cross-material leakage) ---
  function cloneAsBasic(src){
    const b = new THREE.MeshBasicMaterial();
    if (src && src.color) b.color.copy(src.color);
    b.map = src && src.map || null;
    b.opacity = (src && src.opacity!=null)? src.opacity : 1;
    b.transparent = (src && src.transparent) || b.opacity<1;
    b.side = src && src.side || THREE.FrontSide;
    b.depthWrite = src && src.depthWrite;
    b.depthTest = src && src.depthTest;
    b.alphaMap = src && src.alphaMap || null;
    b.toneMapped = false;
    if (state.whiteKeyEnabled) patchWhiteKey(b, state.whiteKeyThreshold);
    return b;
  }

  function setUnlit(on, index){
    forEachTarget(index, (mesh, mats, idxs)=>{
      if (!mesh.userData.__slots) mesh.userData.__slots = {};
      idxs.forEach(i=>{
        const slot = mesh.userData.__slots[i];
        if (!slot) return;
        if (on){
          if (slot.unlit) return;
          const basic = cloneAsBasic(slot.current);
          mats[i] = basic;
          slot.current = basic;
          slot.unlit = true;
        }else{
          if (!slot.unlit) return;
          mats[i] = slot.orig;    // restore original reference
          slot.current = slot.orig;
          slot.unlit = false;
        }
      });
      if (Array.isArray(mesh.material)) mesh.material = mats; else mesh.material = mats[0];
      mesh.needsUpdate = true;
    });
  }

  // --- Camera / view ---
  function setBackground(hex){ scene.background = new THREE.Color(hex); }
  function setProjection(mode){
    if (mode==='ortho'){
      if (!state.ortho){
        const w = mount.clientWidth, h = mount.clientHeight;
        const fr = 0.8;
        state.ortho = new THREE.OrthographicCamera(-fr*w/h, fr*w/h, fr, -fr, 0.01, 2000);
      }
      state.ortho.position.copy(persp.position);
      state.ortho.quaternion.copy(persp.quaternion);
      controls.object = state.ortho;
    }else{
      controls.object = persp;
    }
    controls.update();
  }

  function raycastFromClientXY(clientX, clientY){
    if (!state.current) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX-rect.left)/rect.width)*2-1;
    const y = -((clientY-rect.top)/rect.height)*2+1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x,y), controls.object || persp);
    const hits = ray.intersectObject(state.current, true);
    return hits && hits[0] || null;
  }

  function projectToScreen(v3){
    const v = v3.clone().project(controls.object || persp);
    const r = renderer.domElement.getBoundingClientRect();
    return { x:(v.x*0.5+0.5)*r.width, y:(-v.y*0.5+0.5)*r.height };
  }

  return {
    THREE, scene, renderer, controls,
    loadGLBFromArrayBuffer,
    // material ops
    setOpacity, setDoubleSide, setUnlit,
    setWhiteKey, setWhiteKeyEnabled,
    // color HSL
    setHSL: (h,s,l,i)=>{ /* optional external */
      const h01=h/360, s01=Math.max(0,Math.min(1,s/100)), l01=Math.max(0,Math.min(1,l/100));
      forEachTarget(i, (mesh, mats, idxs)=>{
        idxs.forEach(j=>{ const m=mats[j]; if (m && m.color){ m.color.setHSL(h01,s01,l01); m.needsUpdate=true; } });
      });
    },
    // misc
    setBackground, setProjection,
    raycastFromClientXY, projectToScreen,
    getMaterials: ()=> state.materials,
    setSpin: (on)=> state.spin = !!on,
  };
}

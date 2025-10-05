// three.js viewer & material helpers
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function ensureViewer(app){
  const container = document.getElementById('stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'webgl';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0f13);
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth/container.clientHeight, 0.01, 1000);
  camera.position.set(2.6, 1.2, 3.0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3,4,5);
  scene.add(dir);

  const grid = new THREE.GridHelper(10, 10, 0x444, 0x222);
  grid.visible = false;
  scene.add(grid);

  let raf;
  let firstFrame = false;
  function animate(){
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    if (!firstFrame){ firstFrame = true; readyCbs.forEach(f=>f()); readyCbs.length=0; }
  }
  animate();

  window.addEventListener('resize', ()=>{
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w,h);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  });

  // model & materials
  let root = null;
  let uniqueMaterials = []; // [{mat, name, original:{...}}]
  const loader = new GLTFLoader();

  async function loadDemo(){
    // permissive CORS sample
    const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';
    const gltf = await loader.loadAsync(url);
    setModel(gltf.scene);
  }

  async function loadFromDriveIdOrUrl(input){
    // best-effort parser (id or URL)。Drive直DLはCORS制限があるため、CORS許可URLのみ成功します。
    const m = String(input||'').match(/[\w-]{20,}/);
    if(!m) throw new Error('empty or invalid file id/url');
    const id = m[0];
    const url = `https://drive.google.com/uc?export=download&id=${id}`;
    const gltf = await loader.loadAsync(url); // CORS失敗時は例外
    setModel(gltf.scene);
  }

  function gatherUniqueMaterials(obj3d){
    const arr = [];
    const seen = new Set();
    obj3d.traverse(o=>{
      if(o.isMesh){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for(const m of mats){
          if(m && !seen.has(m.uuid)){
            seen.add(m.uuid);
            arr.push({ mat:m, name: m.name || '(mat)', original: snapshotMaterial(m) });
          }
        }
      }
    });
    return arr;
  }

  function snapshotMaterial(m){
    return {
      transparent: m.transparent,
      opacity: m.opacity,
      side: m.side,
      color: m.color ? m.color.clone() : null,
      emissive: m.emissive ? m.emissive.clone() : null,
      map: m.map || null
    };
  }

  function restoreMaterial(m, snap){
    m.transparent = snap.transparent;
    m.opacity = snap.opacity;
    m.side = snap.side;
    if(snap.color && m.color) m.color.copy(snap.color);
    if(snap.emissive && m.emissive) m.emissive.copy(snap.emissive);
    m.needsUpdate = true;
  }

  function setModel(obj){
    if(root){ scene.remove(root); root.traverse(o=>o.geometry&&o.geometry.dispose()); }
    root = obj;
    scene.add(root);
    // frame
    const bbox = new THREE.Box3().setFromObject(root);
    const size = bbox.getSize(new THREE.Vector3()).length();
    const center = bbox.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(1,0.5,1).normalize().multiplyScalar(size*0.8));
    camera.near = size/1000; camera.far = size*10; camera.updateProjectionMatrix();
    // mats
    uniqueMaterials = gatherUniqueMaterials(root);
    app.events?.dispatchEvent(new CustomEvent('viewer:materials',{detail:{list:uniqueMaterials}}));
  }

  // --- public API ---
  const api = {
    async loadDemo(){ await loadDemo(); },
    async loadByInput(v){ await loadFromDriveIdOrUrl(v); },
    getMaterials(){ return uniqueMaterials; },
    setHSLOpacity({target, h, s, l, opacity}){
      const targets = (target<0) ? uniqueMaterials : [uniqueMaterials[target]].filter(Boolean);
      for(const t of targets){
        const m = t.mat;
        if(m.color){
          const col = t.original.color.clone();
          col.offsetHSL(h-0.5, s-1.0, l-1.0);
          m.color.copy(col);
        }
        m.opacity = opacity;
        m.transparent = opacity < 0.999;
        m.depthWrite = m.opacity >= 0.999;
        m.needsUpdate = true;
      }
    },
    toggleUnlit(target){
      const targets = (target<0) ? uniqueMaterials : [uniqueMaterials[target]].filter(Boolean);
      for(const t of targets){
        const m = t.mat;
        const isUnlit = !!m.userData.__unlit;
        if(isUnlit){
          // restore
          restoreMaterial(m, t.original);
          delete m.userData.__unlit;
        }else{
          // approximate unlit: bake color, remove shading
          if(m.color){
            const c = (t.original.color || m.color).clone();
            m.color.copy(c);
          }
          m.emissive && m.emissive.setRGB(0,0,0);
          m.roughness !== undefined && (m.roughness = 1);
          m.metalness !== undefined && (m.metalness = 0);
          m.userData.__unlit = 1;
        }
        m.needsUpdate = true;
      }
    },
    setDoubleSide(target, on){
      const targets = (target<0) ? uniqueMaterials : [uniqueMaterials[target]].filter(Boolean);
      for(const t of targets){ t.mat.side = on ? THREE.DoubleSide : THREE.FrontSide; t.mat.needsUpdate = true; }
    },
    setWhiteKey(target, thr){
      // simple white-to-alpha keying: modify opacity based on fragment luminance via material.onBeforeCompile
      const targets = (target<0) ? uniqueMaterials : [uniqueMaterials[target]].filter(Boolean);
      for(const t of targets){
        const m = t.mat;
        m.userData.__whiteKey = thr;
        m.onBeforeCompile = (shader)=>{
          shader.uniforms.uWhiteThr = { value: thr };
          shader.fragmentShader = shader.fragmentShader.replace(
            'void main() {',
            'uniform float uWhiteThr;\nvoid main(){'
          ).replace(
            '#include <opaque_fragment>',
            '#include <opaque_fragment>\n  float lum = dot(gl_FragColor.rgb, vec3(0.299,0.587,0.114));\n  if(lum>=uWhiteThr){ gl_FragColor.a = 0.0; }'
          );
        };
        m.transparent = true;
        m.needsUpdate = true;
      }
    },
    onceReady(cb){ readyCbs.push(cb); }
  };
  const readyCbs = [];

  // expose on app
  return api;
}

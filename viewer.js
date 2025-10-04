
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
  renderer.sortObjects = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(50, (mount.clientWidth||1) / (mount.clientHeight||1), 0.1, 5000);
  camera.position.set(2.5, 1.4, 3.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(2, 3, 4);
  scene.add(dir);

  // Demo cube while idle
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1,1,1),
    new THREE.MeshStandardMaterial({ color: 0x304c78, roughness: .9, metalness: .05 })
  );
  scene.add(box);

  const state = {
    current: box,
    // Array<THREE.Material> (unique instances used in the model)
    materials: [],
    // live parameters
    hsl: { h:0, s:0, l:0 },
    opacity: 1,
    unlit: false,
    doubleSide: false,
    whiteKey: { enabled:false, threshold:0.95 },
  };

  function onResize() {
    const w = mount.clientWidth, h = mount.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(onResize).observe(mount);

  (function tick(){
    if (state.current === box) box.rotation.y += 0.01;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();

  // --- helpers ---
  function collectUniqueMaterials(root) {
    const set = new Set();
    root.traverse(obj => {
      if (obj.isMesh && obj.material) {
        const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of arr) set.add(m);
        // fix sorting/alpha oddities
        obj.renderOrder = 0;
      }
    });
    return [...set];
  }

  function applyMaterialFlags(m) {
    // transparency
    m.transparent = state.opacity < 1 || m.transparent;
    m.opacity = state.opacity;
    // double side
    m.side = state.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    // unlit handling via onBeforeCompile (idempotent)
    if (!m.userData._patched) {
      m.onBeforeCompile = (shader) => {
        // inject HSL + white-key in fragment
        shader.uniforms.uHsl = { value: new THREE.Vector3(state.hsl.h, state.hsl.s, state.hsl.l) };
        shader.uniforms.uWhiteEnable = { value: state.whiteKey.enabled ? 1 : 0 };
        shader.uniforms.uWhiteThresh = { value: state.whiteKey.threshold };

        shader.fragmentShader = shader.fragmentShader
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            // --- LociMyu HSL + white-key ---
            vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x); }
            vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1., 2./3., 1./3., 3.); vec3 p = abs(fract(c.xxx + K.xyz)*6. - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y); }
            vec3 hslAdj(vec3 rgb, vec3 hsl){ vec3 hsv = rgb2hsv(rgb); hsv.x = fract(hsv.x + hsl.x); hsv.y = clamp(hsv.y + hsl.y, 0., 1.); hsv.z = clamp(hsv.z + hsl.z, 0., 1.); return hsv2rgb(hsv); }
            vec3 c = gl_FragColor.rgb;
            c = hslAdj(c, uHsl);
            if (uWhiteEnable==1) {
              // whiteness key: fade alpha where near white (luminance high)
              float lum = max(max(c.r, c.g), c.b);
              float a = smoothstep(uWhiteThresh, 1.0, lum);
              gl_FragColor.a *= (1.0 - a);
            }
            gl_FragColor.rgb = c;
          `);
      };
      m.userData._patched = true;
    }
    m.needsUpdate = true;
  }

  async function loadGLBFromArrayBuffer(buf) {
    if (state.current && state.current !== box) {
      scene.remove(state.current);
    }
    const url = URL.createObjectURL(new Blob([buf]));
    const loader = new (await import(GLTF_URL)).GLTFLoader();
    const gltf = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('GLB has no scene');
    scene.add(root);
    state.current = root;
    state.materials = collectUniqueMaterials(root);
    // initialize flags on all
    for (const m of state.materials) applyMaterialFlags(m);

    console.log('[viewer] GLB loaded; unique materials:', state.materials.length);
  }

  function setHSL(h, s, l) {
    state.hsl = { h, s, l };
    for (const m of state.materials) { m.needsUpdate = true; }
  }

  function setOpacity(v) {
    state.opacity = v;
    for (const m of state.materials) { applyMaterialFlags(m); }
  }

  function setUnlit(on) {
    state.unlit = on;
    for (const m of state.materials) {
      // When unlit, disable env/lighting by switching to MeshBasicMaterial-like flags
      m.lightMap = null;
      m.emissive = m.emissive || new THREE.Color(0x000000);
      m.needsUpdate = true;
    }
  }

  function setDoubleSide(on) {
    state.doubleSide = on;
    for (const m of state.materials) { applyMaterialFlags(m); }
  }

  function setWhiteKeyEnabled(on){ state.whiteKey.enabled = on; for (const m of state.materials) applyMaterialFlags(m); }
  function setWhiteKeyThreshold(th){ state.whiteKey.threshold = th; for (const m of state.materials) applyMaterialFlags(m); }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    setWhiteKeyEnabled, setWhiteKeyThreshold
  };
}

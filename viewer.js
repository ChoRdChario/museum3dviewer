
// viewer.js — patched
// - Fixes: shader injection moved after output_fragment (before tonemapping) so compilation won't fail
// - Keeps: API surface (ensureViewer, setHSL, setOpacity, setUnlit, setDoubleSide, setWhiteKeyEnabled, setWhiteKeyThreshold)
// - Notes: This file does not handle Drive auth; it only renders and loads a GLB from an ArrayBuffer.

const THREE_URL = 'three';
const GLTF_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';
const ORBIT_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

export async function ensureViewer({ mount, spinner }) {
  // 1) libs
  const THREE = await import(THREE_URL);
  const { OrbitControls } = await import(ORBIT_URL);
  const { GLTFLoader } = await import(GLTF_URL);

  // 2) renderer/camera/scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha:false });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(50, (mount.clientWidth||1)/(mount.clientHeight||1), 0.1, 5000);
  camera.position.set(2.5, 1.4, 3.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(2, 3, 4);
  scene.add(dir);

  // Demo mesh while idle
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1,1,1),
    new THREE.MeshStandardMaterial({ color: 0x304c78, roughness: .9, metalness: .05 })
  );
  scene.add(box);

  const state = {
    current: box,
    materials: [],
    hsl: { h:0, s:0, l:0 },
    opacity: 1,
    unlit: false,
    doubleSide: false,
    whiteKey: { enabled:false, threshold:0.95 },
  };

  // 3) render loop + resize
  function onResize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  try:
      from js import ResizeObserver  # type: ignore
  except Exception:
      ResizeObserver = None
  if ResizeObserver:
      ResizeObserver(onResize).observe(mount)  # pseudo for browser; harmless in node-less env
  // Fallback: do nothing here (host page should handle resize)

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
        obj.renderOrder = 0;
      }
    });
    return [...set];
  }

  function applyMaterialFlags(m) {
    // transparency & double side
    m.transparent = state.opacity < 1 || m.transparent;
    m.opacity = state.opacity;
    m.side = state.doubleSide ? THREE.DoubleSide : THREE.FrontSide;

    // shader patch (idempotent)
    if (!m.userData._patched) {
      m.onBeforeCompile = (shader) => {
        // uniforms + helpers at header
        const header = `
uniform vec3 uHsl;
uniform int uWhiteEnable;
uniform float uWhiteThresh;

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1., 2./3., 1./3., 3.);
  vec3 p = abs(fract(c.xxx + K.xyz)*6. - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y);
}
vec3 hslAdj(vec3 rgb, vec3 hsl){
  vec3 hsv = rgb2hsv(rgb);
  hsv.x = fract(hsv.x + hsl.x);
  hsv.y = clamp(hsv.y + hsl.y, 0., 1.);
  hsv.z = clamp(hsv.z + hsl.z, 0., 1.);
  return hsv2rgb(hsv);
}
`;
        shader.fragmentShader = header + shader.fragmentShader;

        // update uniforms each compile
        shader.uniforms.uHsl = { value: new THREE.Vector3(state.hsl.h, state.hsl.s, state.hsl.l) };
        shader.uniforms.uWhiteEnable = { value: state.whiteKey.enabled ? 1 : 0 };
        shader.uniforms.uWhiteThresh = { value: state.whiteKey.threshold };

        // mutate color/alpha *before* tonemapping/colorspace
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `
  // --- LociMyu: HSL + white-key just before tonemapping ---
  {
    vec3 c = gl_FragColor.rgb;
    c = hslAdj(c, uHsl);
    if (uWhiteEnable==1) {
      float lum = max(max(c.r, c.g), c.b);
      float a = smoothstep(uWhiteThresh, 1.0, lum);
      gl_FragColor.a *= (1.0 - a);
    }
    gl_FragColor.rgb = c;
  }
  #include <tonemapping_fragment>
          `
        );
      };
      m.userData._patched = true;
    }

    // unlit: approximate by disabling lights influence
    if (state.unlit) {
      m.lights = false;
      m.emissive = m.emissive || new THREE.Color(0x000000);
      m.needsUpdate = true;
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

  // state mutators
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
    for (const m of state.materials) { applyMaterialFlags(m); }
  }
  function setDoubleSide(on) {
    state.doubleSide = on;
    for (const m of state.materials) { applyMaterialFlags(m); }
  }
  function setWhiteKeyEnabled(on){
    state.whiteKey.enabled = on;
    for (const m of state.materials) applyMaterialFlags(m);
  }
  function setWhiteKeyThreshold(th){
    state.whiteKey.threshold = th;
    for (const m of state.materials) applyMaterialFlags(m);
  }

  return {
    THREE, scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    setHSL, setOpacity, setUnlit, setDoubleSide,
    setWhiteKeyEnabled, setWhiteKeyThreshold
  };
}

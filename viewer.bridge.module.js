
// viewer.bridge.module.js (materials-ready emitter)
let __fired = false;
function fireOnce() {
  if (__fired) return;
  if (typeof document !== 'undefined' && window.__LM_SCENE) {
    try {
      document.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene: window.__LM_SCENE } }));
      } catch {}
    __fired = true;
  }
}
export function listMaterials() {
  const out = [];
  const s = window.__LM_SCENE;
  if (!s) return out;
  s.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, idx) => {
      out.push({ name: m?.name || '', materialKey: m?.uuid || null, meshUuid: o.uuid, index: idx });
    });
  });
  return out;
}
export function listMaterialNames() {
  const arr = listMaterials();
  return [...new Set(arr.map(r => r.name).filter(n => n && !/^#\d+$/.test(n)))];
}
export function applyMaterialPropsByName(name, props = {}) {
  const s = window.__LM_SCENE;
  if (!s) return 0;
  let count = 0;
  s.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if ((m?.name || '') === String(name)) {
        if ('opacity' in props) {
          const v = Math.max(0, Math.min(1, Number(props.opacity)));
          m.transparent = v < 1;
          m.opacity = v;
          m.depthWrite = v >= 1;
        }
        m.needsUpdate = true;
        count++;
      }
    });
  });
  return count;
}
// Poll for late publication and materials ready
const __timer = setInterval(() => {
  if (window.__LM_SCENE) fireOnce();
  try {
    const names = listMaterialNames();
    if (names.length > 0) {
      document.dispatchEvent(new CustomEvent('lm:materials-ready', { detail: { names } }));
    }
  } catch {}
}, 250);


// === viewer.bridge.module.js : Chroma Key support ===
function __ensureChromaHook(mat){
  if (!mat || typeof mat.onBeforeCompile !== 'function') return;
  if (mat.userData && mat.userData.__lmChromaHooked) return;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function(shader){
    shader.uniforms.uChromaColor = { value: (mat.userData?.__lmChromaColor || {r:0,g:1,b:0}) };
    shader.uniforms.uChromaTol = { value: (mat.userData?.__lmChromaTol ?? 0.15) };
    shader.uniforms.uChromaFeather = { value: (mat.userData?.__lmChromaFeather ?? 0.05) };
    shader.uniforms.uChromaEnable = { value: (mat.userData?.__lmChromaEnable ? 1 : 0) };
    const tag = '#include <output_fragment>';
    if (shader.fragmentShader.indexOf(tag) !== -1) {
      shader.fragmentShader = shader.fragmentShader.replace(tag, `
        ${tag}
        if (uChromaEnable > 0) {
          vec3 key = vec3(uChromaColor.r, uChromaColor.g, uChromaColor.b);
          float d = distance(gl_FragColor.rgb, key);
          float a = smoothstep(uChromaTol, uChromaTol + max(0.0001, uChromaFeather), d);
          gl_FragColor.a *= a;
        }
      `);
    }
    if (typeof prev === 'function') prev(shader);
    mat.userData.__lmChromaUniforms = shader.uniforms;
  };
  mat.userData = mat.userData || {};
  mat.userData.__lmChromaHooked = true;
  mat.transparent = true;
  mat.needsUpdate = true;
}
function __setChroma(mat, {enabled, color, tolerance, feather}){
  mat.userData = mat.userData || {};
  mat.userData.__lmChromaEnable = !!enabled;
  const c = Array.isArray(color) ? {r:color[0], g:color[1], b:color[2]} : (color||{r:0,g:1,b:0});
  mat.userData.__lmChromaColor = c;
  mat.userData.__lmChromaTol = Number(tolerance ?? 0.15);
  mat.userData.__lmChromaFeather = Number(feather ?? 0.05);
  const u = mat.userData.__lmChromaUniforms;
  if (u) {
    if (u.uChromaEnable) u.uChromaEnable.value = mat.userData.__lmChromaEnable ? 1 : 0;
    if (u.uChromaColor)  u.uChromaColor.value = c;
    if (u.uChromaTol)    u.uChromaTol.value = mat.userData.__lmChromaTol;
    if (u.uChromaFeather)u.uChromaFeather.value = mat.userData.__lmChromaFeather;
  }
  mat.transparent = mat.transparent || !!enabled;
  mat.depthWrite = !(!!enabled);
  mat.needsUpdate = mat.needsUpdate || !u;
}
export function applyChromaByName(name, params = {}){
  const s = window.__LM_SCENE; if (!s) return 0;
  let cnt = 0;
  s.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m => {
      if ((m?.name||'') === String(name)) {
        __ensureChromaHook(m);
        __setChroma(m, params);
        cnt++;
      }
    });
  });
  return cnt;
}
// helper exports (fallback for names)
export function listMaterials(){
  const out=[]; const s=window.__LM_SCENE; if(!s) return out;
  s.traverse(o=>{ if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach((m,i)=>{
      out.push({ name: m?.name || '', materialKey: m?.uuid || null, meshUuid: o.uuid, index:i });
    });
  });
  return out;
}
export function listMaterialNames(){
  const arr = listMaterials();
  return [...new Set(arr.map(r=>r.name).filter(n=>n && !/^#\d+$/.test(n)))];
}
